// GET /api/health — 健康检查 + 配置状态
const { withCors } = require("./_lib/_cors");

module.exports = withCors(async (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "AltPart AI v2.2",
    time: new Date().toISOString(),
    config: {
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      ezplmConfigured: !!process.env.EZPLM_API_BASE,
      mode: process.env.EZPLM_API_BASE ? "production" : "demo (built-in mock data)",
      scoringEngine: "v2.2 (技术兼容/证据覆盖/结论可信 三段式 + 单位归一化 + 引脚证据门槛)",
    },
  });
}, ["GET"]);
