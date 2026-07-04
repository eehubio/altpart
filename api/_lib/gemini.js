// gemini.js — v2.2: 真实 Gemini API 接入
// 改进点：
//  - 可配置模型（GEMINI_MODEL 环境变量，默认 gemini-2.5-flash）
//  - 调用重试（指数退避，应对 429/503）
//  - 超时控制（避免 Serverless 函数挂死）
//  - 标注 AI 来源（GPT诊断 #6：AI 数据低可信，由 scoring 显著降权）
//  - 单参数查询要求模型给出"数据来源说明"，便于后续证据链

const { matchCategory, buildParamGuide, guessCategory } = require("./category-templates");

// 默认用 gemini-2.5-flash（gemini-2.0已于2026-06-01下线）；可用 GEMINI_MODEL 覆盖
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const CALL_TIMEOUT_MS = 18000;
const MAX_RETRIES = 2;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callGemini(systemPrompt, userPrompt, maxTokens = 4096, useSearch = true) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 未配置");

  const url = `${API_BASE}/${GEMINI_MODEL}:generateContent?key=${key}`;
  const genConfig = { maxOutputTokens: maxTokens, temperature: 0.2 };
  // 不联网时强制 JSON 输出 + 关闭 thinking（2.5-flash 是思考模型，思考过程会吃光token导致空响应）
  if (!useSearch) {
    genConfig.responseMimeType = "application/json";
    genConfig.thinkingConfig = { thinkingBudget: 0 };
  } else {
    genConfig.responseMimeType = "text/plain";
  }
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: genConfig,
  };
  // google_search grounding（部分模型支持；失败时自动去掉重试）
  if (useSearch) body.tools = [{ google_search: {} }];

  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`Gemini ${res.status} 限流/过载`);
        await sleep(1000 * Math.pow(2, attempt)); // 1s,2s,4s
        continue;
      }

      const data = await res.json();
      if (data.error) {
        // 若是 search 工具不支持，去掉 search 重试一次
        if (useSearch && /search|tool/i.test(data.error.message || "")) {
          delete body.tools; useSearch = false;
          continue;
        }
        throw new Error(data.error.message || `Gemini error ${res.status}`);
      }

      const cand0 = data.candidates?.[0];
      const parts = cand0?.content?.parts || [];
      const text = parts.filter(p => p.text).map(p => p.text).join("\n");
      if (!text.trim()) {
        // 诊断：为何空响应（常见 finishReason: MAX_TOKENS / SAFETY / thinking吃光）
        const fr = cand0?.finishReason || "unknown";
        console.error(`[Gemini:${GEMINI_MODEL}] 空响应 finishReason=${fr}, parts=${parts.length}, raw=${JSON.stringify(data).slice(0, 300)}`);
        throw new Error(`Gemini 返回空响应 (finishReason=${fr})`);
      }
      console.log(`[Gemini:${GEMINI_MODEL}] ok, ${text.length} chars: ${text.slice(0, 120).replace(/\n/g, " ")}`);
      return text;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (e.name === "AbortError") lastErr = new Error("Gemini 调用超时");
      if (attempt < MAX_RETRIES - 1) { await sleep(800 * Math.pow(2, attempt)); continue; }
    }
  }
  throw lastErr || new Error("Gemini 调用失败");
}

function repairJSON(raw) {
  // 先直接解析（JSON 模式下 Gemini 返回干净 JSON，不应破坏它）
  try { return JSON.parse(raw.trim()); } catch (_) {}
  let s = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(s); } catch (_) {}
  s = s.replace(/\[source\]/gi, "");
  s = s.replace(/^[^{\[]+/, "");
  try { return JSON.parse(s); } catch (_) {}
  for (const pat of ['{"candidates"', '{"partNumber"', '{"params"', '{"recommendations"', '["']) {
    const idx = s.indexOf(pat);
    if (idx >= 0) {
      let sub = s.slice(idx), d = 0;
      for (let i = 0; i < sub.length; i++) {
        if (sub[i] === "{" || sub[i] === "[") d++;
        if (sub[i] === "}" || sub[i] === "]") d--;
        if (d === 0) { try { return JSON.parse(sub.slice(0, i + 1)); } catch (_) { break; } }
      }
    }
  }
  const ob = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  const os = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
  for (let i = 0; i < ob; i++) s += "}";
  for (let i = 0; i < os; i++) s += "]";
  s = s.replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(s); } catch (_) {}

  // 括号顺序错乱修复（如 "}]" 应为 "]}"）：把结尾连续的 }] ]} 混排规整后重试
  let s2 = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  s2 = s2.replace(/[\}\]\s]+$/,"");            // 去掉结尾所有闭合符和空白
  const opens = (s2.match(/[\{\[]/g) || []);
  const closes = (s2.match(/[\}\]]/g) || []);
  // 按开括号栈补正确的闭合顺序
  const stack = [];
  for (const ch of s2) { if (ch === "{" ) stack.push("}"); else if (ch === "[") stack.push("]"); else if (ch === "}" || ch === "]") stack.pop(); }
  while (stack.length) s2 += stack.pop();
  s2 = s2.replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(s2); } catch (_) {}

  // 终极兜底：直接抽取 candidates 数组里的字符串，重组合法 JSON
  const candMatch = raw.match(/"candidates"\s*:\s*\[([\s\S]*?)(?:\]|\}|$)/);
  if (candMatch) {
    const items = (candMatch[1].match(/"([^"]+)"/g) || []).map(x => x.replace(/"/g, ""));
    if (items.length) {
      console.warn("[JSON] 用兜底提取到候选:", items.length, "个");
      return { candidates: items, eliminated: [] };
    }
  }

  console.error("[JSON] 解析失败:", raw.slice(0, 300));
  throw new Error("AI 返回 JSON 解析失败");
}

// ─── 分析原始器件（品类模板约束）───
async function analyzeComponent(partNumber) {
  const guessed = guessCategory(partNumber);
  const template = guessed ? matchCategory(guessed) : null;
  const paramGuide = buildParamGuide(template);

  const sys = `你是资深电子元器件工程师。请根据你对 "${partNumber}" 的了解，提取真实参数。
严禁凭记忆编造数值。找不到的参数填 "N/A"。只返回 JSON，value 不含单位（单位放 unit）。

${paramGuide}

输出格式：
{"partNumber":"${partNumber}","category":"品类名","manufacturer":"厂商","description":"15字内",
"parameters":[{"id":"param_1","name":"参数名","nameEn":"English","value":"数值或N/A","unit":"单位"}]}

⚠ 参数必须严格属于该品类：MCU 不能出现运放参数，运放不能出现 MCU 参数。`;

  const raw = await callGemini(sys, `分析器件：${partNumber}`, 4096, false);
  const result = repairJSON(raw);

  // 标注数据来源（AI 搜索 → 低可信，scoring 会降权）
  if (Array.isArray(result.parameters)) {
    result.parameters = result.parameters.map(p => ({
      ...p, source: "ai_search", sourceLabel: "AI搜索", confidence: "low",
    }));
  }
  if (template) result._templateUsed = template.name;
  else if (result.category) {
    const d = matchCategory(result.category);
    if (d) result._templateUsed = d.name;
  }
  return result;
}

// ─── 候选发现（场景 + 数量可配）───
async function getCandidates(part, category, params, mfrs, mode, scenario, count = 10) {
  const modeDesc = { pin2pin:"严格 pin-to-pin", pkgCompat:"封装兼容", funcCompat:"功能兼容",
    domestic:"国产替代优先", lowCost:"低成本优先" }[mode] || "功能兼容";
  const mfrNote = mfrs?.length ? `\n优选厂商：${mfrs.join(",")}` : "";
  const keyParams = params.slice(0, 6).map(p => `${p.name}=${p.value}${p.unit || ""}`).join(", ");

  const scenarioHint = {
    shortage: "缺货替代：必须能直接焊接替换，不改 PCB",
    domestic: "国产替代：优先中国大陆品牌",
    costDown: "降本：功能够用即可，优先成本最低",
    newDesign: "新设计选型：不限封装，推荐最优性能",
    avlExpand: "量产 AVL 扩展：需多供应商保障",
    education: "教学/竞赛：价格低、资料丰富优先",
  }[scenario] || "";

  const sys = `你是元器件替代料专家。基于真实存在的型号推荐候选（不要编造订货型号）。
${scenarioHint ? "场景：" + scenarioHint : ""}
只返回 JSON：{"candidates":["型号1",...],"eliminated":[{"pn":"型号","reason":"原因"}]}
candidates 给 ${count} 个真实型号（系统会再校验筛选，宁多勿缺）。eliminated 最多 3 个。`;

  const prompt = `原始器件：${part.partNumber}（${category}，${part.manufacturer}）
关键参数：${keyParams}
替代模式：${modeDesc}${mfrNote}
请给出 ${count} 个候选替代型号。`;

  // 候选发现不需要联网搜索（靠模型知识即可，更快），关闭 google_search 避免超时
  const raw = await callGemini(sys, prompt, 2048, false);
  return repairJSON(raw);
}

// ─── 单候选参数查询 ───
async function lookupPartSpecs(partNumber, referenceParams) {
  const paramList = referenceParams.map((p, i) =>
    `param_${i + 1}: ${p.name}（${p.nameEn || p.name}）— 原型号参考: ${p.value}${p.unit ? " " + p.unit : ""}`
  ).join("\n");

  const sys = `你是元器件参数查询工具。联网搜索 "${partNumber} datasheet" / "${partNumber} specifications"。
每个参数：找到→填真实值，找不到→填 "N/A"。严禁编造，宁可 N/A。
只返回 JSON：
{"partNumber":"${partNumber}","manufacturer":"","description":"",
"params":{${referenceParams.map((_, i) => `"param_${i + 1}":{"value":"","unit":""}`).join(",")}}}
必须返回全部 ${referenceParams.length} 个参数。`;

  const prompt = `根据你对 "${partNumber}" 的了解，返回以下参数：\n${paramList}`;
  // 关闭联网搜索避免超时；参数靠模型知识，未知填N/A（scoring会据此降可信度）
  const raw = await callGemini(sys, prompt, 4096, false);
  return repairJSON(raw);
}

module.exports = { callGemini, repairJSON, analyzeComponent, getCandidates, lookupPartSpecs, GEMINI_MODEL };
