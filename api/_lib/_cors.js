// _cors.js — 通用 CORS + 方法校验包装
// Vercel 同域部署时 CORS 非必需，但保留以便前后端分离或本地调试

function withCors(handler, allowedMethods = ["GET", "POST"]) {
  return async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    if (!allowedMethods.includes(req.method)) {
      res.status(405).json({ error: `Method ${req.method} not allowed` });
      return;
    }
    try {
      await handler(req, res);
    } catch (e) {
      console.error("[Handler error]", e);
      if (!res.headersSent) res.status(500).json({ error: e.message || "Internal error" });
    }
  };
}

module.exports = { withCors };
