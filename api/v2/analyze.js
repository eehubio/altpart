// POST /api/v2/analyze — 仅解析原始器件参数（ezPLM本地库优先 → AI兜底）
// 供两段式流程使用：先展示参数让用户调整优先级/约束，再调 /api/v2/recommend
const { withCors } = require("../_lib/_cors");
const { resolveOriginalPart } = require("../_lib/pipeline");

module.exports = withCors(async (req, res) => {
  const { partNumber } = req.body || {};
  if (!partNumber) { res.status(400).json({ error: "partNumber required" }); return; }

  try {
    const original = await resolveOriginalPart(partNumber.trim());
    res.status(200).json({ success: true, original });
  } catch (e) {
    console.error("[analyze] failed:", e.message);
    res.status(200).json({
      success: false,
      error: e.message || "器件参数解析失败",
      partNumber,
    });
  }
}, ["POST"]);
