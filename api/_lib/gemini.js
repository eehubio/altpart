// gemini.js — v2: Uses category templates to constrain AI output
// v2.1: getCandidates 支持指定候选数量（默认10个，供后续筛选）

const { matchCategory, buildParamGuide, guessCategory } = require("./category-templates");

const GEMINI_MODEL = "gemini-3-flash-preview";

async function callGemini(systemPrompt, userPrompt, maxTokens = 4096) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "text/plain" },
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => p.text).map(p => p.text).join("\n");
  if (!text.trim()) throw new Error("Empty AI response");
  console.log(`[Gemini] Response: ${text.length} chars, ${parts.length} parts`);
  return text;
}

function repairJSON(raw) {
  let s = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  s = s.replace(/\[\d+\]/g, "").replace(/\[source\]/gi, "");
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
  const ob = (s.match(/\{/g)||[]).length - (s.match(/\}/g)||[]).length;
  const os = (s.match(/\[/g)||[]).length - (s.match(/\]/g)||[]).length;
  for (let i = 0; i < ob; i++) s += "}";
  for (let i = 0; i < os; i++) s += "]";
  s = s.replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(s); } catch (e) {
    console.error("[JSON] Parse failed:", s.slice(0, 300));
    throw new Error("JSON解析失败");
  }
}

// ─── P0: Analyze with category template ───
async function analyzeComponent(partNumber) {
  const guessed = guessCategory(partNumber);
  const template = guessed ? matchCategory(guessed) : null;
  const paramGuide = buildParamGuide(template);

  const sys = `你是电子元器件工程师。搜索"${partNumber} datasheet"，提取准确参数值。
不要凭记忆猜测！只返回JSON。value不含单位，unit单独。

${paramGuide}

输出格式：
{"partNumber":"${partNumber}","category":"品类名","manufacturer":"厂商","description":"15字内",
"parameters":[{"id":"param_1","name":"参数名","nameEn":"English","value":"数值","unit":"单位"}]}

⚠ 重要：参数必须严格属于该器件品类。MCU不能出现运放参数，运放不能出现MCU参数。`;

  const raw = await callGemini(sys, `搜索并分析：${partNumber}`, 4096);
  const result = repairJSON(raw);

  if (result.category && !template) {
    const detected = matchCategory(result.category);
    if (detected) {
      result._templateUsed = detected.name;
      console.log(`[Analyze] ${partNumber}: category="${result.category}", template="${detected.name}"`);
    }
  } else if (template) {
    result._templateUsed = template.name;
  }

  return result;
}

// ─── P3 + v2.1: Candidates with scenario context & configurable count ───
async function getCandidates(part, category, params, mfrs, mode, scenario, count = 10) {
  const modeDesc = { pin2pin:"严格pin-to-pin", pkgCompat:"封装兼容", funcCompat:"功能兼容",
    domestic:"国产替代优先", lowCost:"低成本优先" }[mode] || "功能兼容";
  const mfrNote = mfrs?.length ? `\n优选厂商：${mfrs.join(",")}` : "";
  const keyParams = params.slice(0, 5).map(p => `${p.name}=${p.value}${p.unit||""}`).join(", ");

  const scenarioHint = {
    shortage: "这是缺货替代场景，必须能直接焊接替换，不改PCB",
    domestic: "这是国产替代场景，优先推荐中国大陆品牌",
    costDown: "这是降本场景，功能够用即可，优先成本最低",
    newDesign: "这是新设计选型，不限封装，推荐最优性能",
    avlExpand: "这是量产AVL扩展，需要多供应商保障",
    education: "这是教学/竞赛用途，价格低、资料丰富优先",
  }[scenario] || "";

  const sys = `你是电子元器件替代料推荐专家。只推荐候选型号列表。
${scenarioHint ? "场景：" + scenarioHint : ""}
只返回JSON：{"candidates":["型号1","型号2",...],"eliminated":[{"pn":"型号","reason":"原因"}]}
candidates必须是${count}个真实存在的型号（系统会进一步校验筛选，宁多勿少）。eliminated最多3个。`;

  const prompt = `原始器件：${part.partNumber}（${category}，${part.manufacturer}）
关键参数：${keyParams}
替代模式：${modeDesc}${mfrNote}
请推荐${count}个候选替代型号。`;

  const raw = await callGemini(sys, prompt, 2048);
  return repairJSON(raw);
}

// ─── Individual part lookup ───
async function lookupPartSpecs(partNumber, referenceParams) {
  const paramList = referenceParams.map((p, i) =>
    `param_${i+1}: ${p.name}（${p.nameEn||p.name}）— 参考值: ${p.value}${p.unit?" "+p.unit:""}`
  ).join("\n");

  const sys = `你是元器件参数查询工具。搜索"${partNumber} datasheet"和"${partNumber} specifications"。
对每个参数：找到→填真实值，找不到→填"N/A"。
只返回JSON：
{"partNumber":"${partNumber}","manufacturer":"","description":"",
"params":{${referenceParams.map((_,i)=>`"param_${i+1}":{"value":"","unit":""}`).join(",")}}}
全部${referenceParams.length}个参数都必须返回。不要编造数据。`;

  const prompt = `搜索"${partNumber} datasheet"，返回以下参数：\n${paramList}`;
  const raw = await callGemini(sys, prompt, 4096);
  return repairJSON(raw);
}

module.exports = { callGemini, repairJSON, analyzeComponent, getCandidates, lookupPartSpecs };
