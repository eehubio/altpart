// market.js — 价格/供货行情
// 优先级: 供应商API(DigiKey/Mouser/立创) → Gemini互联网估算(明确标注"仅供参考")
// 接入真实供应商API后，Gemini估算自动退居兜底，无需改代码

const { callGemini, repairJSON } = require("./gemini");
const { cache } = require("./cache");

const CACHE_TTL = 12 * 3600; // 行情缓存12小时

/**
 * 批量查询市场行情（一次Gemini调用查全部，省时省钱）
 * @returns { parts: { PN: {priceUSD1,priceUSD100,stock,channels,note,source} }, source }
 */
async function getMarketInfo(partNumbers) {
  const pns = [...new Set(partNumbers.map(p => String(p).trim()).filter(Boolean))].slice(0, 8);
  const result = {};
  const missing = [];

  // 1. 命中缓存的直接用
  for (const pn of pns) {
    const hit = cache.get(`market:${pn.toLowerCase()}`);
    if (hit) result[pn] = hit;
    else missing.push(pn);
  }

  if (missing.length) {
    // 2. 供应商API（配置了才走；当前为TODO占位）
    if (process.env.DIGIKEY_CLIENT_ID || process.env.MOUSER_API_KEY || process.env.LCSC_API_KEY) {
      // TODO: 接入真实供应商API后在此实现，返回 source:"supplier_api"
    }

    // 3. Gemini 互联网估算（兜底，明确标注估算性质）
    try {
      const estimates = await geminiMarketEstimate(missing);
      for (const [pn, info] of Object.entries(estimates)) {
        cache.set(`market:${pn.toLowerCase()}`, info, CACHE_TTL);
        result[pn] = info;
      }
    } catch (e) {
      console.warn("[market] Gemini估算失败:", e.message);
      // 失败的型号返回"未知"占位，前端可隐藏
      for (const pn of missing) {
        result[pn] = { priceUSD1: null, priceUSD100: null, stock: "未知", channels: [], note: "", source: "unavailable" };
      }
    }
  }

  return { parts: result };
}

async function geminiMarketEstimate(pns) {
  const sys = `你是电子元器件市场行情分析师。根据你对市场的了解，估算以下型号的大致价格与供货状况。
只返回JSON：
{"parts":[{"pn":"型号","priceUSD1":单片美元价数字或null,"priceUSD100":百片美元单价数字或null,"stock":"充足|一般|紧张|停产风险|未知","channels":["主要采购渠道最多3个"],"note":"一句话供货备注(15字内)"}]}
⚠ 数据为估算参考：不确定的价格填null，不确定的供货填"未知"。严禁编造精确数字。全部${pns.length}个型号都要返回。`;

  const prompt = `估算以下型号的市场价格与供货：\n${pns.join("\n")}`;

  let raw;
  try {
    // 行情时效性强，优先联网搜索
    raw = await callGemini(sys, prompt + "\n（请联网搜索最新行情）", 4096, true);
  } catch (e) {
    console.warn("[market] 联网模式失败，降级知识估算:", e.message);
    raw = await callGemini(sys, prompt, 4096, false);
  }

  const data = repairJSON(raw);
  const out = {};
  for (const item of (data.parts || [])) {
    if (!item?.pn) continue;
    // 按输入型号名对齐（AI可能改写大小写）
    const matched = pns.find(p => p.toUpperCase() === String(item.pn).toUpperCase()) || item.pn;
    out[matched] = {
      priceUSD1: typeof item.priceUSD1 === "number" ? item.priceUSD1 : null,
      priceUSD100: typeof item.priceUSD100 === "number" ? item.priceUSD100 : null,
      stock: item.stock || "未知",
      channels: Array.isArray(item.channels) ? item.channels.slice(0, 3) : [],
      note: item.note || "",
      source: "ai_estimate",
    };
  }
  // 未返回的型号补占位
  for (const pn of pns) if (!out[pn]) out[pn] = { priceUSD1: null, priceUSD100: null, stock: "未知", channels: [], note: "", source: "ai_estimate" };
  return out;
}

module.exports = { getMarketInfo };
