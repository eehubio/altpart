// /api/feedback — 用户反馈（POST 提交 / GET 查询）
//
// ⚠ Serverless 无状态：此处用模块级数组仅在热实例内有效，冷启动即丢失。
// 生产环境务必替换为 Vercel KV / Postgres / Supabase 等持久化存储。
const { withCors } = require("./_lib/_cors");
const { cache } = require("./_lib/cache");

// 模块级临时存储（非持久！见上方说明）
const feedbackStore = [];

module.exports = withCors(async (req, res) => {
  if (req.method === "POST") {
    const fb = req.body || {};
    if (!fb.originalPart || !fb.candidatePart || !fb.status) {
      res.status(400).json({ error: "缺少必填字段: originalPart, candidatePart, status" }); return;
    }
    if (!["verified", "partial", "failed", "testing"].includes(fb.status)) {
      res.status(400).json({ error: "status 必须是 verified/partial/failed/testing" }); return;
    }
    const entry = { id: `fb_${Date.now()}`, ...fb, timestamp: fb.timestamp || new Date().toISOString() };
    feedbackStore.push(entry);
    cache.delete(`comp:${fb.candidatePart.toLowerCase()}`);
    res.status(200).json({ success: true, id: entry.id, _note: "Serverless演示存储，重启后丢失，生产请接入Vercel KV" });
    return;
  }

  // GET
  const { original, candidate } = req.query;
  let results = feedbackStore;
  if (original) results = results.filter(f => f.originalPart.toLowerCase() === String(original).toLowerCase());
  if (candidate) results = results.filter(f => f.candidatePart.toLowerCase() === String(candidate).toLowerCase());
  res.status(200).json(results.slice(-50));
}, ["GET", "POST"]);
