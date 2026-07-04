// POST /api/v2/recommend — 本地优先推荐（10选5）
const { withCors } = require("../_lib/_cors");
const { runPipeline } = require("../_lib/pipeline");

module.exports = withCors(async (req, res) => {
  const { partNumber, mode = "funcCompat", scenario, preferredManufacturers, constraints, priorityOrder } = req.body || {};
  if (!partNumber) { res.status(400).json({ error: "partNumber required" }); return; }

  const result = await runPipeline({
    partNumber, mode, scenario,
    preferredManufacturers: preferredManufacturers || [],
    constraints: constraints || {},
    priorityOrder,
  });
  res.status(200).json({ success: true, ...result });
}, ["POST"]);
