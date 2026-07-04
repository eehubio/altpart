// units.js — 单位归一化与数值解析
// 解决 GPT 诊断问题 #5：正确处理 "2.0 to 3.6 V" / "±15 V" / "500 µV" vs "1 mV" / Min/Typ/Max
//
// 核心思想：把原始字符串解析为规范化的 Quantity：
//   { min, typ, max, unit(规范单位), raw, isRange }
// 之后所有比较都基于规范单位下的数值，避免 mV/µV、V/kV 混比错误。

// SI 前缀 → 倍率
const SI_PREFIX = {
  T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3,
  "": 1,
  m: 1e-3, u: 1e-6, µ: 1e-6, μ: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
};

// 量纲分类：把各种写法归一到一个基准单位
// 每类: { base: 基准单位, units: { 单位写法: 相对基准的倍率(不含SI前缀) } }
const DIMENSIONS = {
  voltage:   { base: "V",   re: /^([munµμkKMG]?)V$/i,        names: ["v", "volt", "电压", "vds", "vgs", "vos", "vcc", "vdd"] },
  current:   { base: "A",   re: /^([munµμpkKMG]?)A$/i,       names: ["a", "amp", "电流", "id", "ibias", "iq"] },
  frequency: { base: "Hz",  re: /^([kKMG]?)Hz$/i,            names: ["hz", "频率", "主频", "gbw", "带宽", "bandwidth", "frequency"] },
  resistance:{ base: "Ω",   re: /^([munµμkKMG]?)(Ω|ohm|R)$/i,names: ["ω", "ohm", "电阻", "rds"] },
  capacitance:{base: "F",   re: /^([munµμpf]?)F$/i,          names: ["f", "farad", "电容"] },
  power:     { base: "W",   re: /^([munµμkKMG]?)W$/i,        names: ["w", "watt", "功率"] },
  charge:    { base: "C",   re: /^([munµμpn]?)C$/i,          names: ["qg", "电荷", "charge"] },
  time:      { base: "s",   re: /^([munµμpn]?)s$/i,          names: ["s", "sec", "时间"] },
  slewrate:  { base: "V/s", re: /^([munµμkKMG]?)V\/([munµμ]?)s$/i, names: ["slew", "压摆率", "v/µs", "v/us"] },
  memory:    { base: "B",   re: /^([kKMG]?)B$/i,             names: ["flash", "sram", "ram", "rom", "memory"] },
  bits:      { base: "bit", re: /^bits?$/i,                  names: ["分辨率", "resolution", "bit"] },
  temperature:{base: "°C",  re: /^°?C$/i,                    names: ["温度", "temperature", "temp"] },
  count:     { base: "",    re: /^$/,                         names: ["通道数", "channel", "gpio", "通道", "pin", "引脚"] },
};

// 速率类（µV/√Hz 噪声等）暂作 raw 文本处理，不强行归一

/**
 * 解析单个数字 token（可能带 SI 前缀单位），返回 { value(规范), dim, baseUnit } 或 null
 */
function parseQuantityToken(numStr, unitStr) {
  const num = parseFloat(numStr);
  if (isNaN(num)) return null;
  if (!unitStr) return { value: num, dim: "count", baseUnit: "" };

  const u = unitStr.trim();
  for (const [dim, def] of Object.entries(DIMENSIONS)) {
    const m = u.match(def.re);
    if (m) {
      // slewrate 有两个前缀（分子V前缀、分母s前缀），特殊处理
      if (dim === "slewrate") {
        const numPrefix = SI_PREFIX[m[1] || ""] ?? 1;
        const denPrefix = SI_PREFIX[m[2] || ""] ?? 1;
        return { value: num * numPrefix / denPrefix, dim, baseUnit: def.base };
      }
      const prefix = SI_PREFIX[m[1] || ""] ?? 1;
      return { value: num * prefix, dim, baseUnit: def.base };
    }
  }
  // 未识别单位：按无量纲数处理，保留原单位文本
  return { value: num, dim: "unknown", baseUnit: u };
}

/**
 * 把参数原始值解析为规范化 Quantity
 * 支持：
 *   "72 MHz"            → {typ:72e6}
 *   "2.0 to 3.6 V"      → {min:2, max:3.6, isRange:true}
 *   "2.0~3.6V" / "2.0-3.6V"
 *   "±15 V"            → {min:-15, max:15, isRange:true}
 *   "-40 to 125 °C"
 *   "500 µV"           → 规范到 V: 5e-4
 *   "64 KB"            → 规范到 B: 65536
 * 返回 { min, typ, max, unit, dim, raw, isRange, parsed:true } 或 { raw, parsed:false }
 */
function parseQuantity(rawValue, rawUnit = "") {
  if (rawValue === undefined || rawValue === null) return { raw: rawValue, parsed: false };
  const raw = String(rawValue).trim();
  if (!raw || /^n\/?a$/i.test(raw)) return { raw, parsed: false, isNA: true };

  // 把 unit 附加到字符串里统一解析（值里没带单位时用 rawUnit 兜底）
  const hasUnitInValue = /[a-zA-ZΩµμ°]/.test(raw);
  const work = hasUnitInValue ? raw : (rawUnit ? `${raw} ${rawUnit}` : raw);

  // 提取末尾单位（整串共享单位的情况，如 "2.0 to 3.6 V"）
  const trailingUnit = (work.match(/([a-zA-ZΩµμ°][a-zA-ZΩµμ°/]*)\s*$/) || [])[1] || rawUnit || "";

  // ± 形式
  const pmMatch = work.match(/^[±+]\s*([\d.]+)\s*([a-zA-ZΩµμ°/]*)/);
  if (pmMatch) {
    const q = parseQuantityToken(pmMatch[1], pmMatch[2] || trailingUnit);
    if (q) return { min: -q.value, max: q.value, typ: q.value, unit: q.baseUnit, dim: q.dim, raw, isRange: true, parsed: true };
  }

  // 范围形式："a to b unit" —— 用正则直接抓两个带符号数字，避免把负号当分隔符
  const rangeMatch = work.match(/(-?[\d.]+)\s*(?:to|~|至|[-–—])\s*(-?[\d.]+)\s*([a-zA-ZΩµμ°/]*)/i);
  const parts = rangeMatch ? [rangeMatch[1], rangeMatch[2] + (rangeMatch[3] ? " " + rangeMatch[3] : "")] : [work];
  if (parts.length === 2) {
    // 第二段通常带单位；第一段可能不带，借用第二段的单位
    const num1 = (parts[0].match(/-?[\d.]+/) || [])[0];
    const u2match = parts[1].match(/(-?[\d.]+)\s*([a-zA-ZΩµμ°/]*)/);
    if (num1 && u2match) {
      const unit = u2match[2] || trailingUnit;
      const q1 = parseQuantityToken(num1, unit);
      const q2 = parseQuantityToken(u2match[1], unit);
      if (q1 && q2) {
        const lo = Math.min(q1.value, q2.value), hi = Math.max(q1.value, q2.value);
        return { min: lo, max: hi, typ: (lo + hi) / 2, unit: q2.baseUnit, dim: q2.dim, raw, isRange: true, parsed: true };
      }
    }
  }

  // 单值形式
  const single = work.match(/(-?[\d.]+(?:[eE][-+]?\d+)?)\s*([a-zA-ZΩµμ°/]*)/);
  if (single) {
    const q = parseQuantityToken(single[1], single[2] || trailingUnit);
    if (q) return { typ: q.value, min: q.value, max: q.value, unit: q.baseUnit, dim: q.dim, raw, isRange: false, parsed: true };
  }

  return { raw, parsed: false };
}

/**
 * 比较两个 Quantity 的"接近程度"，返回 0..1（1=完全一致）
 * 同量纲才比较；不同量纲返回 null（交由离散/文本逻辑处理）
 */
function quantityCloseness(orig, cand, tolerance = 0.15) {
  if (!orig?.parsed || !cand?.parsed) return null;
  if (orig.dim !== cand.dim) return null;
  // 用 typ 作主比较点
  const a = orig.typ, b = cand.typ;
  if (a === undefined || b === undefined) return null;
  const denom = Math.max(Math.abs(a), 1e-12);
  const diff = Math.abs(b - a) / denom;
  if (diff <= 0.005) return 1;
  if (diff <= tolerance) return 0.95 - (diff / tolerance) * 0.1;       // 0.85..0.95
  if (diff <= tolerance * 2) return 0.85 - ((diff - tolerance) / tolerance) * 0.15;
  if (diff <= tolerance * 4) return 0.7 - ((diff - tolerance * 2) / (tolerance * 2)) * 0.2;
  if (diff <= tolerance * 8) return 0.5 - ((diff - tolerance * 4) / (tolerance * 4)) * 0.2;
  return Math.max(0.1, 0.3 - diff * 0.02);
}

/**
 * 范围覆盖判断（用于温度、电压范围类）：cand 是否覆盖 orig
 * 返回 1(完全覆盖) / 0.85(基本覆盖) / 0.4(部分) / 0.1(不覆盖)
 */
function rangeCoverage(orig, cand) {
  if (!orig?.parsed || !cand?.parsed || !orig.isRange || !cand.isRange) return null;
  if (orig.dim !== cand.dim) return null;
  if (cand.min <= orig.min && cand.max >= orig.max) return 1;
  const tol = Math.abs(orig.max - orig.min) * 0.1 || 1;
  if (cand.min <= orig.min + tol && cand.max >= orig.max - tol) return 0.85;
  // 有交集
  if (cand.max >= orig.min && cand.min <= orig.max) return 0.4;
  return 0.1;
}

module.exports = { parseQuantity, quantityCloseness, rangeCoverage, parseQuantityToken };
