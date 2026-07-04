// POST /api/v2/market — 批量查询价格/供货行情
// body: { partNumbers: ["PN1","PN2",...] }（最多8个）
// 返回: { success, parts: { PN: {priceUSD1,priceUSD100,stock,channels,note,source} } }
const { withCors } = require("../_lib/_cors");
const { getMarketInfo } = require("../_lib/market");

module.exports = withCors(async (req, res) => {
  const { partNumbers } = req.body || {};
  if (!Array.isArray(partNumbers) || !partNumbers.length) {
    res.status(400).json({ error: "partNumbers 数组必填" }); return;
  }
  try {
    const result = await getMarketInfo(partNumbers);
    res.status(200).json({ success: true, ...result });
  } catch (e) {
    console.error("[market]", e.message);
    res.status(200).json({ success: false, error: e.message, parts: {} });
  }
}, ["POST"]);
