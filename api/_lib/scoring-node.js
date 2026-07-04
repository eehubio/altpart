// scoring-node.js — v2.2 评分引擎（CommonJS / 后端）
// 解决 GPT 诊断的核心工程问题：
//  #1 "A直接替代" 必须有引脚证据，否则降级为 "Pin-to-Pin候选(待验证)"
//  #2 N/A 不再默认 50 分 → 拆分 技术兼容度 / 证据覆盖率 / 结论可信度
//  #5 数值比较走单位归一化（units.js），正确处理范围、SI前缀、min/typ/max

const { parseQuantity, quantityCloseness, rangeCoverage } = require("./units");

const PARAM_TOLERANCE = {
  "增益带宽积":0.25, GBW:0.25, "Gain Bandwidth":0.25, Bandwidth:0.25, "-3dB带宽":0.25,
  "压摆率":0.25, "Slew Rate":0.25, SR:0.25,
  "输入失调电压":0.5, "Input Offset Voltage":0.5, Vos:0.5,
  "输入偏置电流":0.6, "Input Bias Current":0.6,
  "电源电流":0.3, "Supply Current":0.3, "静态电流":0.3, "Quiescent Current":0.3,
  "最高主频":0.15, "Max Frequency":0.15, Frequency:0.15,
  Flash:0.1, SRAM:0.1,
  "采样率":0.2, "Sample Rate":0.2, "Max Sample Rate":0.2,
  "ESD耐受":0.3, "ESD Tolerance":0.3,
  "参考价格":0.5, "Reference Price":0.5, Price:0.5,
  "Vds(max)":0.2, "Id(max)":0.2, "Rds(on)":0.3, "Vgs(th)":0.3, Qg:0.3,
  "输出电压":0.05, "Output Voltage":0.05, "最大输出电流":0.2, "压差":0.3,
  "PSRR":0.2, "输出噪声":0.3, "效率":0.1,
};

const DISCRETE_PARAMS = ["通道数","Channels","Number of Channels","封装","Package","常见封装",
  "分辨率","Resolution","接口","Interface","接口类型","通信接口","轨到轨","Rail-to-Rail",
  "内核","Core","类型","Type","拓扑","Topology","极性","Polarity"];

const RANGE_PARAMS = ["工作温度","Operating Temperature","Temperature","工作电压","Supply Voltage",
  "输入电压","Input Voltage","供电电压范围","Supply Voltage Range","输入电压范围","Input Voltage Range"];

const CRITICAL_IDENTITY = ["封装","Package","内核","Core","通道数","Channels","分辨率","Resolution",
  "类型","Type","极性","Polarity","拓扑","Topology"];

const PKG_COMPAT = {
  "SOIC-8":["SOP-8","SO-8"], "SOP-8":["SOIC-8","SO-8"],
  "SOT-23-5":["SOT-23-5L","SC-74A","SOT23-5"], "SOT23-5":["SOT-23-5","SOT-23-5L"],
  "SOT-23-6":["SOT-26"], "SSOP-28":["TSSOP-28"], "TSSOP-28":["SSOP-28"],
  "DIP-8":["PDIP-8"], "PDIP-8":["DIP-8"],
  "LQFP-48":["TQFP-48","QFP-48"], "TQFP-48":["LQFP-48"],
  "LQFP-64":["TQFP-64"], "LQFP-100":["TQFP-100"],
  "QFN-16":["WQFN-16","DFN-16"],
};

const SOURCE_CONFIDENCE = {
  ezplm: 1.0, manual: 1.0, datasheet: 0.95,
  digikey: 0.85, mouser: 0.85, lcsc: 0.8,
  ai_lookup: 0.45, ai_search: 0.45, "": 0.0,
};

const DIMENSIONS = {
  hardware:   { weight:0.30, label:"硬件兼容", keywords:["封装","Package","引脚","Pin","GPIO","工作温度","Temperature","工作电压","Supply Voltage","输入电压","Input Voltage"] },
  functional: { weight:0.25, label:"功能兼容", keywords:["内核","Core","主频","Frequency","Flash","SRAM","通道数","Channel","分辨率","Resolution","带宽","Bandwidth","接口","Interface","ADC","定时器","Timer","通信","拓扑","Topology"] },
  electrical: { weight:0.20, label:"电气参数", keywords:["失调","Offset","偏置","Bias","噪声","Noise","CMRR","压摆率","Slew","Rds","Vgs","Qg","PSRR","效率","Efficiency","压差","Dropout","轨到轨","Rail","ESD","INL","SNR","静态电流","Quiescent"] },
  supply:     { weight:0.15, label:"供应链",   keywords:["价格","Price","库存","Stock"] },
  risk:       { weight:0.10, label:"风险评估", keywords:[] },
};

function isNA(v) {
  return v === "N/A" || v === undefined || v === null || v === "" ||
    (typeof v === "string" && /^n\/?a$/i.test(v.trim()));
}
function matchTol(paramName, nameEn) {
  const e = Object.entries(PARAM_TOLERANCE).find(([k]) =>
    paramName.includes(k) || (nameEn || "").includes(k));
  return e ? e[1] : 0.15;
}
function isDiscrete(paramName, nameEn) {
  return DISCRETE_PARAMS.some(k => paramName.includes(k) || (nameEn || "").includes(k));
}
function isRangeParam(paramName, nameEn) {
  return RANGE_PARAMS.some(k => paramName.includes(k) || (nameEn || "").includes(k));
}
function isCriticalIdentity(paramName, nameEn) {
  return CRITICAL_IDENTITY.some(k => paramName.includes(k) || (nameEn || "").includes(k));
}

function scoreOneParam(origParam, candValue) {
  const pName = origParam.name || "", pNameEn = origParam.nameEn || "";
  if (isNA(candValue)) return { score: null, comment: "未提供", known: false };
  const ov = origParam.value;

  if (isDiscrete(pName, pNameEn)) {
    const ovs = String(ov).trim().toLowerCase();
    const cvs = String(candValue).trim().toLowerCase();
    if (ovs === cvs) return { score: 100, comment: "一致", known: true };
    if (pName.includes("封装") || pNameEn.toLowerCase().includes("package")) {
      const compat = PKG_COMPAT[String(ov)] || [];
      if (compat.some(c => cvs.includes(c.toLowerCase()))) return { score: 78, comment: "封装家族兼容(引脚待核)", known: true };
    }
    if (ovs.includes(cvs) || cvs.includes(ovs)) return { score: 85, comment: "基本一致", known: true };
    return { score: 15, comment: "不匹配", known: true };
  }

  if (isRangeParam(pName, pNameEn)) {
    const oq = parseQuantity(ov, origParam.unit), cq = parseQuantity(candValue, origParam.unit);
    const cov = rangeCoverage(oq, cq);
    if (cov !== null) {
      const score = Math.round(cov * 100);
      return { score, comment: cov >= 1 ? "完全覆盖" : cov >= 0.85 ? "基本覆盖" : cov >= 0.4 ? "部分覆盖" : "不覆盖", known: true };
    }
  }

  const tol = matchTol(pName, pNameEn);
  const oq = parseQuantity(ov, origParam.unit), cq = parseQuantity(candValue, origParam.unit);
  const close = quantityCloseness(oq, cq, tol);
  if (close !== null) {
    return { score: Math.round(close * 100), comment: close >= 0.95 ? "一致" : close >= 0.85 ? "接近" : close >= 0.7 ? "可接受" : close >= 0.5 ? "有差异" : "差距显著", known: true };
  }

  const same = String(ov).trim().toLowerCase() === String(candValue).trim().toLowerCase();
  return same ? { score: 100, comment: "一致", known: true } : { score: 55, comment: "待确认(无法解析)", known: true };
}

function getReplacementLevel({ technical, evidenceCoverage, confidence, criticalFail, pinVerified }) {
  if (criticalFail) {
    if (confidence >= 55) return { level: "F", label: "功能替代", color: "#c2610c", desc: "关键参数不同，需改固件/改板验证" };
    return { level: "N", label: "仅供新设计", color: "#b8860b", desc: "差异较大，建议仅用于新设计" };
  }
  if (evidenceCoverage < 40) {
    return { level: "P0", label: "数据不足", color: "#8a8a8a", desc: "证据覆盖率过低，无法判断兼容性" };
  }
  if (confidence >= 85 && evidenceCoverage >= 70) {
    if (pinVerified) return { level: "A", label: "直接替代", color: "#1a6c4e", desc: "引脚已验证，可直接替换" };
    return { level: "P2", label: "Pin-to-Pin候选", color: "#2d9d6f", desc: "参数高度匹配，引脚需人工核对后方可直接替换" };
  }
  if (confidence >= 70) return { level: "B", label: "硬件兼容", color: "#2d9d6f", desc: "封装兼容，软件/配置需验证" };
  if (confidence >= 55) return { level: "F", label: "功能替代", color: "#c2610c", desc: "功能满足，需改板或改固件" };
  if (confidence >= 40) return { level: "N", label: "仅供新设计", color: "#b8860b", desc: "适合新项目选型" };
  return { level: "X", label: "不推荐", color: "#c0392b", desc: "存在关键不兼容风险或证据不足" };
}

function calculateDimensionScores(paramScores, params) {
  const dims = {};
  for (const [dimName, dim] of Object.entries(DIMENSIONS)) {
    if (dimName === "risk") continue;
    const matching = paramScores.filter(ps => {
      if (!ps.known) return false;
      const p = params?.find(x => x.id === ps.paramId);
      return p && dim.keywords.some(k => p.name.includes(k) || (p.nameEn || "").includes(k));
    });
    dims[dimName] = matching.length
      ? Math.round(matching.reduce((s, ps) => s + ps.score, 0) / matching.length)
      : null;
  }
  const known = paramScores.filter(p => p.known).length;
  const total = paramScores.length || 1;
  const aiHeavy = paramScores.filter(p => p.known && (p.source === "ai_lookup" || p.source === "ai_search")).length;
  const coverage = known / total;
  dims.risk = Math.max(0, Math.round(coverage * 100 - (aiHeavy / total) * 25));
  return dims;
}

function calculateScore(originalParams, candidate, priorityOrder, constraints = {}) {
  const paramScores = [];
  let eliminated = false, elimReason = "", criticalFail = false;
  let techWeight = 0, techSum = 0;
  let covWeight = 0, covKnownWeight = 0;
  let srcWeight = 0, srcSum = 0;
  let pinVerified = false;

  priorityOrder.forEach((paramId, index) => {
    const origP = originalParams.find(p => p.id === paramId);
    if (!origP) return;
    const weight = priorityOrder.length - index;
    const candVal = candidate.parameters?.[paramId];
    const cv = candVal?.value;
    const src = candVal?.source || "";

    if ((origP.name.includes("引脚") || (origP.nameEn || "").toLowerCase().includes("pin")) && !isNA(cv) && candVal?.pinVerified) {
      pinVerified = true;
    }

    let { score, comment, known } = scoreOneParam(origP, cv);

    const con = constraints[paramId];
    if (con && !eliminated && known) {
      const conType = con.constraintType || "hard";
      let passed = true;
      if (con.options?.length) {
        passed = con.options.some(o => String(cv).toLowerCase().includes(o.toLowerCase()));
      } else {
        const oq = parseQuantity(cv, origP.unit);
        if (oq.parsed) {
          if (con.min != null && oq.typ < parseQuantity(String(con.min), origP.unit).typ) passed = false;
          if (con.max != null && oq.typ > parseQuantity(String(con.max), origP.unit).typ) passed = false;
        }
      }
      if (!passed && conType === "hard") { eliminated = true; elimReason = `${origP.name}不满足硬约束`; }
      if (!passed && conType === "soft") { score = Math.max(0, score - 25); comment = "不满足偏好"; }
    }

    if (known && score < 40 && isCriticalIdentity(origP.name, origP.nameEn)) criticalFail = true;

    if (known) {
      techWeight += weight; techSum += score * weight;
      const sc = SOURCE_CONFIDENCE[src] ?? 0.45;
      srcWeight += weight; srcSum += sc * weight;
    }
    covWeight += weight;
    if (known) covKnownWeight += weight;

    paramScores.push({
      paramId, paramName: origP.name, paramNameEn: origP.nameEn,
      value: isNA(cv) ? "N/A" : cv, unit: candVal?.unit || origP.unit || "",
      score: known ? score : null, comment, known,
      source: src, sourceLabel: candVal?.sourceLabel || "",
      confidence: candVal?.confidence || (known ? "medium" : "none"),
    });
  });

  const technical = techWeight ? Math.round(techSum / techWeight) : 0;
  const evidenceCoverage = covWeight ? Math.round((covKnownWeight / covWeight) * 100) : 0;
  const sourceConfidence = srcWeight ? srcSum / srcWeight : 0;

  let confidence = Math.round(technical * (evidenceCoverage / 100) * (0.4 + 0.6 * sourceConfidence));
  if (evidenceCoverage < 50) confidence = Math.min(confidence, 60);
  if (sourceConfidence < 0.5) confidence = Math.min(confidence, 70);
  if (criticalFail) confidence = Math.min(confidence, 55);

  const dimensionScores = calculateDimensionScores(paramScores, originalParams);
  const replacementLevel = getReplacementLevel({ technical, evidenceCoverage, confidence, criticalFail, pinVerified });

  return {
    eliminated, elimReason,
    technical, evidenceCoverage, sourceConfidence: Math.round(sourceConfidence * 100),
    confidence, overallScore: confidence,
    paramScores, dimensionScores, replacementLevel, pinVerified,
  };
}

function isNumericParam(p) {
  if (isDiscrete(p.name || "", p.nameEn || "")) return false;
  return /^[-+±]?\d/.test(String(p.value).trim());
}

module.exports = {
  calculateScore, scoreOneParam, getReplacementLevel, calculateDimensionScores,
  isNumericParam, DIMENSIONS, PARAM_TOLERANCE, SOURCE_CONFIDENCE,
};
