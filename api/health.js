// GET /api/health — 健康检查 + 配置状态
const { withCors } = require("./_lib/_cors");

module.exports = withCors(async (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "AltPart AI v2.1",
    time: new Date().toISOString(),
    config: {
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      ezplmConfigured: !!process.env.EZPLM_API_BASE,
      mode: process.env.EZPLM_API_BASE ? "production" : "demo (built-in mock data)",
    },
  });
}, ["GET"]);
