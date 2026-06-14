// POST /api/bom/process — BOM 批量推荐
// Serverless 适配：直接调用 pipeline，不再 fetch localhost
const { withCors } = require("../_lib/_cors");
const { runPipeline } = require("../_lib/pipeline");

// Vercel 单函数默认超时 10s（Hobby）/ 60s（Pro）。批量逐个调 AI 容易超时，
// 因此限制单批数量；大 BOM 建议前端分批多次调用。
const MAX_ITEMS = 8;

module.exports = withCors(async (req, res) => {
  const { items, mode = "funcCompat", scenario, preferredManufacturers } = req.body || {};
  if (!items?.length) { res.status(400).json({ error: "缺少 BOM 物料列表" }); return; }
  if (items.length > MAX_ITEMS) {
    res.status(400).json({ error: `单次最多处理 ${MAX_ITEMS} 个物料（Serverless 超时限制），请分批提交` });
    return;
  }

  const results = [];
  const errors = [];

  for (const item of items) {
    try {
      const rec = await runPipeline({
        partNumber: item.partNumber, mode, scenario,
        preferredManufacturers: preferredManufacturers || [],
        constraints: {},
      });
      const top = rec.recommendations?.[0];
      results.push({
        ...item,
        status: top ? "found" : "no_match",
        topAlternative: top?.partNumber || "-",
        topManufacturer: top?.manufacturer || "-",
        topScore: top?.overallScore || 0,
        replacementLevel: top?.replacementLevel?.level || "-",
        pcbChange: top?.replacementLevel?.level === "A" ? "否" : top?.replacementLevel?.level === "B" ? "可能" : "是",
        softwareChange: top?.replacementLevel?.level === "A" ? "否" : "需验证",
        alternativeCount: rec.recommendations?.length || 0,
      });
    } catch (e) {
      results.push({ ...item, status: "error", topAlternative: "-", topManufacturer: "-", topScore: 0, replacementLevel: "-", pcbChange: "-", softwareChange: "-", alternativeCount: 0, error: e.message });
      errors.push({ partNumber: item.partNumber, error: e.message });
    }
  }

  const summary = {
    total: results.length,
    found: results.filter(r => r.status === "found").length,
    noMatch: results.filter(r => r.status === "no_match").length,
    errors: errors.length,
    levelA: results.filter(r => r.replacementLevel === "A").length,
    levelB: results.filter(r => r.replacementLevel === "B").length,
    levelC: results.filter(r => r.replacementLevel === "C").length,
    levelDX: results.filter(r => r.replacementLevel === "D" || r.replacementLevel === "X").length,
  };
  res.status(200).json({ results, errors, summary });
}, ["POST"]);
