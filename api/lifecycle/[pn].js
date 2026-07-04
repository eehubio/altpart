// GET /api/lifecycle/[pn] — 生命周期与合规查询
const { withCors } = require("../_lib/_cors");
const { cache } = require("../_lib/cache");

module.exports = withCors(async (req, res) => {
  const pn = req.query.pn;
  if (!pn) { res.status(400).json({ error: "partNumber required" }); return; }

  const ck = `lifecycle:${pn.toLowerCase()}`;
  const cached = cache.get(ck);
  if (cached) { res.status(200).json(cached); return; }

  // TODO: 接入 Octopart / Z2Data / IHS 真实生命周期数据
  const result = inferLifecycle(pn);
  cache.set(ck, result, 24 * 3600);
  res.status(200).json(result);
}, ["GET"]);

function inferLifecycle(partNumber) {
  const pn = partNumber.toUpperCase();
  const obsolete = [/^LM78[0-9]{2}/, /^7805/, /^LM317/];
  const active = [/^STM32/, /^GD32/, /^ESP32/, /^RP20/];
  let status = "unknown";
  if (obsolete.some(p => p.test(pn))) status = "nrnd";
  if (active.some(p => p.test(pn))) status = "active";
  return {
    partNumber, lifecycle: status,
    compliance: { rohs: true, reach: true, halogenFree: null, automotive: null, industrial: null },
    _source: "inference",
    _note: "生命周期状态基于型号规则推断，建议通过厂商官网或Octopart确认",
  };
}
