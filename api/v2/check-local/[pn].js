// GET /api/v2/check-local/[pn] — 检查器件是否在本地库（输入框提示用）
const { withCors } = require("../../_lib/_cors");
const { queryLocalDB } = require("../../_lib/ezplm");

module.exports = withCors(async (req, res) => {
  const pn = req.query.pn;
  if (!pn) { res.status(400).json({ error: "partNumber required" }); return; }

  const data = await queryLocalDB(pn);
  res.status(200).json({
    partNumber: pn,
    inLocalDB: !!data,
    internalPN: data?.internalPN || null,
    approved: data?.approved || false,
    paramCount: data?.parameters?.length || 0,
  });
}, ["GET"]);
