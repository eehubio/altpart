// POST /api/v2/recommend — 本地优先推荐（10选5）
const { withCors } = require("../_lib/_cors");
const { runPipeline } = require("../_lib/pipeline");

module.exports = withCors(async (req, res) => {
  const { partNumber, mode = "funcCompat", scenario, preferredManufacturers, constraints, priorityOrder } = req.body || {};
  if (!partNumber) { res.status(400).json({ error: "partNumber required" }); return; }

  try {
    const result = await runPipeline({
      partNumber, mode, scenario,
      preferredManufacturers: preferredManufacturers || [],
      constraints: constraints || {},
      priorityOrder,
    });
    res.status(200).json({ success: true, ...result });
  } catch (e) {
    // 返回明确错误信息（而非笼统500），便于前端提示和排查
    console.error("[recommend] pipeline failed:", e.message);
    res.status(200).json({
      success: false,
      error: e.message || "推荐流程失败",
      partNumber,
      recommendations: [],
      hint: /候选|AI/.test(e.message || "")
        ? "AI 候选查询失败，可能是 Gemini 限流或该型号资料不足，请稍后重试"
        : "推荐流程异常，请查看 Vercel 函数日志",
    });
  }
}, ["POST"]);
