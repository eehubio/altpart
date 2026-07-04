// pipeline.js — v2.1 推荐流程编排
// 流程: 本地库优先 → AI推荐10个 → 本地库校验 → 算法评分 → 淘汰差异大的 → 输出Top5

const { queryLocalDB, queryLocalDBBatch } = require("./ezplm");
const { analyzeComponent, getCandidates, lookupPartSpecs } = require("./gemini");
const { fetchComponentFromAPIs } = require("./component");
const { cache } = require("./cache");

// 淘汰阈值: 综合分低于此值的候选直接淘汰
const ELIMINATION_THRESHOLD = 40;
// AI 推荐数量（多推荐，后筛选）
const AI_CANDIDATE_COUNT = 10;
// 最终输出数量
const FINAL_RESULT_COUNT = 5;

/**
 * Step 1: 获取原始器件参数
 * 优先级: ezPLM本地库 → 缓存 → AI联网搜索
 */
async function resolveOriginalPart(partNumber, onProgress) {
  // 1a. 查本地数据库
  onProgress?.("正在查询本地数据库...");
  const localData = await queryLocalDB(partNumber);
  if (localData?.parameters?.length) {
    console.log(`[Pipeline] ${partNumber}: found in local DB (${localData.parameters.length} params)`);
    return { ...localData, _dataPath: "local_db" };
  }

  // 1b. 查缓存
  const ck = `analyze:${partNumber.toLowerCase()}`;
  const cached = cache.get(ck);
  if (cached) {
    console.log(`[Pipeline] ${partNumber}: found in cache`);
    return { ...cached, _dataPath: "cache" };
  }

  // 1c. AI 联网搜索（兜底）
  onProgress?.("本地数据库未收录，正在联网搜索 Datasheet...");
  console.log(`[Pipeline] ${partNumber}: not in local DB, falling back to AI search`);
  const aiData = await analyzeComponent(partNumber);
  if (aiData?.parameters?.length) {
    // 标注数据来源为 AI
    aiData.parameters = aiData.parameters.map(p => ({
      ...p, source: "ai_search", sourceLabel: "AI搜索", confidence: "low",
    }));
    cache.set(ck, aiData, 7 * 86400);
    return { ...aiData, _dataPath: "ai_search" };
  }
  throw new Error("无法获取器件参数（本地库未收录且联网搜索失败）");
}

/**
 * Step 2-4: 完整推荐流程
 */
async function runPipeline({ partNumber, mode, scenario, preferredManufacturers = [], constraints = {}, priorityOrder, originalData, onProgress }) {
  const startTime = Date.now();
  const stats = { localDbHits: 0, apiHits: 0, aiLookups: 0 };

  // ─── Step 1: 解析原始器件（本地优先）───
  const original = (originalData?.parameters?.length)
    ? originalData                                     // 两段式流程：前端已通过 /analyze 拿到参数，直接复用
    : await resolveOriginalPart(partNumber, onProgress);
  const params = original.parameters;
  const isNAv = v => v === undefined || v === null || /^n\/?a$/i.test(String(v).trim());
  const order = priorityOrder || params.filter(p => !isNAv(p.value)).map(p => p.id);

  // ─── Step 2: AI 推荐 10 个候选 ───
  onProgress?.(`AI 正在搜索候选型号（目标 ${AI_CANDIDATE_COUNT} 个）...`);
  let candidatePNs = [], aiEliminated = [];
  const candCk = `cand10:${partNumber}:${mode}:${scenario || ""}`;
  const candCached = cache.get(candCk);
  if (candCached) {
    candidatePNs = candCached.candidates;
    aiEliminated = candCached.eliminated || [];
  } else {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const aiResult = await getCandidates(original, original.category, params, preferredManufacturers, mode, scenario, AI_CANDIDATE_COUNT);
        candidatePNs = (aiResult.candidates || []).slice(0, AI_CANDIDATE_COUNT);
        aiEliminated = aiResult.eliminated || [];
        if (candidatePNs.length) break;
      } catch (e) { console.warn(`[Pipeline] Candidates attempt ${attempt + 1} failed:`, e.message); }
      if (attempt < 1) await new Promise(r => setTimeout(r, 800));
    }
    if (candidatePNs.length) cache.set(candCk, { candidates: candidatePNs, eliminated: aiEliminated }, 86400);
  }
  if (!candidatePNs.length) throw new Error("AI 未找到候选型号");
  console.log(`[Pipeline] AI recommended ${candidatePNs.length} candidates:`, candidatePNs.join(", "));

  // ─── Step 3: 候选参数获取（本地库批量优先）───
  onProgress?.(`正在校验 ${candidatePNs.length} 个候选（本地库优先）...`);

  // 3a. 批量查本地库
  const localBatch = await queryLocalDBBatch(candidatePNs);
  console.log(`[Pipeline] Local DB batch: ${Object.keys(localBatch).length}/${candidatePNs.length} hits`);

  const fetchResults = [];
  const unverified = [];

  // 3b. 先分离：本地库命中的直接用；未命中的收集起来准备并发查询
  const needLookup = [];
  for (const pnRaw of candidatePNs) {
    const pn = String(pnRaw).trim();
    if (!pn) continue;
    const localHit = localBatch[pn.toUpperCase()];
    if (localHit) {
      stats.localDbHits++;
      fetchResults.push(alignLocalParams(localHit, params));
    } else {
      // 先查缓存
      const cached = cache.get(`comp:${pn.toLowerCase()}`);
      if (cached) { fetchResults.push(cached); }
      else needLookup.push(pn);
    }
  }

  // 3c. 未命中的候选：并发查询（避免串行超时），且限制数量控制在 Vercel 时限内
  // 本地库已命中的越多，越不需要联网；这里最多并发查 MAX_AI_LOOKUP 个
  const MAX_AI_LOOKUP = 8;
  const toLookup = needLookup.slice(0, MAX_AI_LOOKUP);
  const skipped = needLookup.slice(MAX_AI_LOOKUP);
  skipped.forEach(pn => unverified.push({ partNumber: pn, manufacturer: "", reason: "超出单次查询上限，未校验" }));

  if (toLookup.length) {
    onProgress?.(`正在并发校验 ${toLookup.length} 个候选...`);
    const results = await Promise.allSettled(
      toLookup.map(pn => fetchComponentFromAPIs(pn, params))
    );
    results.forEach((r, i) => {
      const pn = toLookup[i];
      if (r.status === "fulfilled" && r.value) {
        cache.set(`comp:${pn.toLowerCase()}`, r.value, 7 * 86400);
        stats.aiLookups++;
        fetchResults.push(r.value);
      } else {
        unverified.push({ partNumber: pn, manufacturer: "", reason: "本地库未收录且联网查询失败" });
      }
    });
  }

  if (!fetchResults.length) throw new Error("所有候选型号均无法获取参数");

  // ─── Step 4: 算法评分 + 淘汰 + 排序 ───
  onProgress?.("正在计算匹配评分并筛选...");
  const { calculateScore } = require("./scoring-node");
  const scored = [];
  const lowScored = [];   // 低于淘汰线的候选（若最终无合格者，从中救回Top3）
  const eliminated = [
    ...aiEliminated.map(e => ({ partNumber: e.pn || e.partNumber || "", manufacturer: "", reason: e.reason || "AI排除" })),
    ...unverified, // 查询失败的候选也计入淘汰列表
  ];

  for (const cand of fetchResults) {
    const result = calculateScore(params, cand, order, constraints);

    // 硬约束淘汰
    if (result.eliminated) {
      eliminated.push({ partNumber: cand.partNumber, manufacturer: cand.manufacturer, reason: result.elimReason });
      continue;
    }
    // 分数过低：先收集，最后统一决定是否淘汰（避免纯AI模式下全军覆没）
    if (result.overallScore < ELIMINATION_THRESHOLD) {
      lowScored.push({ cand, result });
      continue;
    }

    const isPreferred = preferredManufacturers.some(m =>
      cand.manufacturer.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(cand.manufacturer.toLowerCase())
    );
    scored.push({
      partNumber: cand.partNumber, manufacturer: cand.manufacturer, description: cand.description,
      internalPN: cand.internalPN || "", inPLM: cand._source === "ezplm", approved: cand.approved || false,
      isPreferred, overallScore: result.overallScore,
      technical: result.technical, evidenceCoverage: result.evidenceCoverage,
      sourceConfidence: result.sourceConfidence, confidence: result.confidence,
      pinVerified: result.pinVerified,
      paramScores: result.paramScores, dimensionScores: result.dimensionScores,
      replacementLevel: result.replacementLevel,
      dataSource: cand._source === "ezplm" ? "本地数据库" : cand._source === "digikey" ? "DigiKey" : "AI搜索",
    });
  }

  // 淘汰保底：合格者为空时，从低分候选中救回Top3（其P0/N/X等级已表达低可信度）
  if (!scored.length && lowScored.length) {
    lowScored.sort((a, b) => b.result.overallScore - a.result.overallScore);
    for (const { cand, result } of lowScored.slice(0, 3)) {
      const isPreferred = preferredManufacturers.some(m =>
        cand.manufacturer.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(cand.manufacturer.toLowerCase()));
      scored.push({
        partNumber: cand.partNumber, manufacturer: cand.manufacturer, description: cand.description,
        internalPN: cand.internalPN || "", inPLM: cand._source === "ezplm", approved: cand.approved || false,
        isPreferred, overallScore: result.overallScore,
        technical: result.technical, evidenceCoverage: result.evidenceCoverage,
        sourceConfidence: result.sourceConfidence, confidence: result.confidence,
        pinVerified: result.pinVerified, _lowConfidence: true,
        paramScores: result.paramScores, dimensionScores: result.dimensionScores,
        replacementLevel: result.replacementLevel,
        dataSource: cand._source === "ezplm" ? "本地数据库" : "AI搜索",
      });
    }
    for (const { cand, result } of lowScored.slice(3)) {
      eliminated.push({ partNumber: cand.partNumber, manufacturer: cand.manufacturer, reason: `综合可信度过低 (${result.overallScore}分)` });
    }
  } else {
    for (const { cand, result } of lowScored) {
      eliminated.push({ partNumber: cand.partNumber, manufacturer: cand.manufacturer, reason: `综合可信度过低 (${result.overallScore}分 < ${ELIMINATION_THRESHOLD}分)` });
    }
  }

  // 排序: 综合分优先，分差<=3 时优选厂商靠前
  scored.sort((a, b) => {
    const diff = b.overallScore - a.overallScore;
    if (Math.abs(diff) <= 3) {
      if (a.inPLM !== b.inPLM) return a.inPLM ? -1 : 1;          // 本地库已有的优先
      if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
    }
    return diff;
  });

  return {
    pipeline: {
      dataPath: original._dataPath,                              // local_db | cache | ai_search
      candidatesRequested: AI_CANDIDATE_COUNT,
      candidatesReceived: candidatePNs.length,
      candidatesVerified: fetchResults.length,
      candidatesEliminated: eliminated.length,
      finalCount: Math.min(scored.length, FINAL_RESULT_COUNT),
      localDbHits: stats.localDbHits,
      aiLookups: stats.aiLookups,
      executionTimeMs: Date.now() - startTime,
    },
    original,
    recommendations: scored.slice(0, FINAL_RESULT_COUNT),
    eliminated,
  };
}

/**
 * 本地库数据的参数 ID 对齐
 * 本地库的 param_N 顺序可能与原始器件不同，按参数名匹配对齐
 */
function alignLocalParams(localPart, referenceParams) {
  const aligned = {};
  for (const ref of referenceParams) {
    // 按名称匹配
    const match = localPart.parameters.find(p =>
      p.name === ref.name || p.nameEn === ref.nameEn ||
      p.name.includes(ref.name) || ref.name.includes(p.name)
    );
    aligned[ref.id] = match
      ? { value: match.value, unit: match.unit || ref.unit, source: "ezplm", sourceLabel: "本地数据库", confidence: "high", verified: match.verified }
      : { value: "N/A", unit: ref.unit || "", source: "", sourceLabel: "", confidence: "none" };
  }
  return { ...localPart, parameters: aligned };
}

module.exports = { runPipeline, resolveOriginalPart };
