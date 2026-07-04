// GET /api/v2/part-detail/[pn] — 器件详情（ezPLM 供应商采购/库存/价格史/质检）
const { withCors } = require("../../_lib/_cors");
const { queryPartDetail } = require("../../_lib/ezplm");

module.exports = withCors(async (req, res) => {
  const pn = req.query.pn;
  if (!pn) { res.status(400).json({ error: "partNumber required" }); return; }

  const detail = await queryPartDetail(pn);
  if (!detail) {
    res.status(200).json({
      partNumber: pn, inPLM: false,
      message: "该器件未收录于 ezPLM 物料库，无供应商采购信息",
      suppliers: [], inventory: null,
    });
    return;
  }
  res.status(200).json({ ...detail, inPLM: true });
}, ["GET"]);
