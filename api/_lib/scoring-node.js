// scoring.js — v2: 替代等级 + 多维子评分 + 证据链
// Scale: 0-100 | N/A → 50 | Replacement levels: A/B/C/D/X

// ─── Parameter tolerances ───
const PARAM_TOLERANCE = {
  "增益带宽积":0.25, GBW:0.25, "Gain Bandwidth":0.25, Bandwidth:0.25, "-3dB带宽":0.25,
  "压摆率":0.25, "Slew Rate":0.25, SR:0.25,
  "输入失调电压":0.5, "Input Offset Voltage":0.5, Vos:0.5,
  "输入偏置电流":0.5, "Input Bias Current":0.5,
  "电源电流":0.3, "Supply Current":0.3, "静态电流":0.3, "Quiescent Current":0.3,
  "最高主频":0.15, "Max Frequency":0.15, Frequency:0.15,
  Flash:0.1, SRAM:0.1,
  "通道数":0, "Number of Channels":0, Channels:0, "GPIO数量":0.15,
  "封装":0, Package:0, "常见封装":0,
  "分辨率":0, Resolution:0,
  "采样率":0.2, "Sample Rate":0.2, "Max Sample Rate":0.2,
  "接口":0, Interface:0, "接口类型":0, "通信接口":0,
  "轨到轨":0, "Rail-to-Rail":0,
  "内核":0, Core:0,
  "ESD耐受":0.3, "ESD Tolerance":0.3,
  "工作温度":0, "Operating Temperature":0,
  "参考价格":0.5, "Reference Price":0.5, Price:0.5,
  "Vds(max)":0.2, "Id(max)":0.2, "Rds(on)":0.3, "Vgs(th)":0.3, Qg:0.3,
  "输出电压":0.05, "Output Voltage":0.05, "最大输出电流":0.2, "压差":0.3,
  "PSRR":0.2, "输出噪声":0.3, "效率":0.1,
};

const PKG_COMPAT = {
  "SOIC-8":["SOP-8","SO-8"], "SOP-8":["SOIC-8","SO-8"],
  "SOT-23-5":["SOT-23-5L","SC-74A","SOT23-5"], "SOT23-5":["SOT-23-5","SOT-23-5L"],
  "SOT-23-6":["SOT-26"], "SSOP-28":["TSSOP-28"], "TSSOP-28":["SSOP-28"],
  "DIP-8":["PDIP-8"], "PDIP-8":["DIP-8"],
  "LQFP-48":["TQFP-48","QFP-48"], "TQFP-48":["LQFP-48"],
  "LQFP-64":["TQFP-64"], "LQFP-100":["TQFP-100"],
  "QFN-16":["WQFN-16","DFN-16"],
};

// ─── Score dimension definitions ───
const DIMENSIONS = {
  hardware:   { weight:0.30, label:"硬件兼容", keywords:["封装","Package","引脚","Pin","GPIO","工作温度","Temperature","工作电压","Supply Voltage","输入电压","Input Voltage"] },
  functional: { weight:0.25, label:"功能兼容", keywords:["内核","Core","主频","Frequency","Flash","SRAM","通道数","Channel","分辨率","Resolution","带宽","Bandwidth","接口","Interface","ADC","定时器","Timer","通信","拓扑","Topology"] },
  electrical: { weight:0.20, label:"电气参数", keywords:["失调","Offset","偏置","Bias","噪声","Noise","CMRR","压摆率","Slew","Rds","Vgs","Qg","PSRR","效率","Efficiency","压差","Dropout","轨到轨","Rail","ESD","INL","SNR","静态电流","Quiescent"] },
  supply:     { weight:0.15, label:"供应链",   keywords:["价格","Price","库存","Stock"] },
  risk:       { weight:0.10, label:"风险评估", keywords:[] },
};

function parseNum(v) {
  const n = parseFloat(String(v).replace(/[^\d.eE+-]/g, ""));
  return isNaN(n) ? null : n;
}

// ─── Single parameter scoring ───
function scoreOneParam(origParam, candValue, paramName) {
  const cv = candValue;
  if (cv === "N/A" || cv === undefined || cv === null || cv === "" || cv === "n/a") {
    return { score: 50, comment: "未查到" };
  }

  const tolEntry = Object.entries(PARAM_TOLERANCE).find(([k]) =>
    paramName.includes(k) || (origParam.nameEn || "").includes(k)
  );

  // Discrete params
  if (tolEntry && tolEntry[1] === 0) {
    const ovs = String(origParam.value).trim().toLowerCase();
    const cvs = String(cv).trim().toLowerCase();
    if (ovs === cvs) return { score: 100, comment: "一致" };
    if (ovs.includes(cvs) || cvs.includes(ovs)) return { score: 90, comment: "基本一致" };
    if (paramName.includes("封装") || paramName.toLowerCase().includes("package")) {
      const compat = PKG_COMPAT[String(origParam.value)] || [];
      if (compat.some(c => cvs.includes(c.toLowerCase()))) return { score: 80, comment: "封装兼容" };
    }
    if (paramName.includes("温度") || paramName.toLowerCase().includes("temperature")) {
      const oNums = String(origParam.value).match(/-?\d+/g)?.map(Number) || [];
      const cNums = String(cv).match(/-?\d+/g)?.map(Number) || [];
      if (oNums.length >= 2 && cNums.length >= 2) {
        if (cNums[0] <= oNums[0] && cNums[1] >= oNums[1]) return { score: 100, comment: "完全覆盖" };
        if (cNums[0] <= oNums[0]+10 && cNums[1] >= oNums[1]-10) return { score: 85, comment: "基本覆盖" };
      }
    }
    return { score: 20, comment: "不匹配" };
  }

  // Numeric params
  const on = parseNum(origParam.value), cn = parseNum(cv);
  if (on === null || cn === null) {
    return String(origParam.value).trim().toLowerCase() === String(cv).trim().toLowerCase()
      ? { score: 100, comment: "一致" } : { score: 60, comment: "待确认" };
  }

  const tolerance = tolEntry ? tolEntry[1] : 0.15;
  const diff = Math.abs(cn - on) / Math.max(Math.abs(on), 1e-9);
  if (diff <= 0.01) return { score: 100, comment: "一致" };
  if (diff <= tolerance) return { score: 95, comment: "接近" };
  if (diff <= tolerance * 2) return { score: 85, comment: "可接受" };
  if (diff <= tolerance * 4) return { score: 70, comment: "有差异" };
  if (diff <= tolerance * 8) return { score: 50, comment: "差异大" };
  return { score: 30, comment: "差距显著" };
}

// ─── P1: Replacement level ───
function getReplacementLevel(overallScore, paramScores, params) {
  const criticalParams = ["封装","Package","内核","Core","通道数","Channels","分辨率","Resolution","类型","Type"];
  const criticalFail = paramScores.some(ps => {
    const p = params?.find(x => x.id === ps.paramId);
    const isCritical = p && criticalParams.some(k => p.name.includes(k) || (p.nameEn||"").includes(k));
    return isCritical && ps.score < 50 && ps.value !== "N/A";
  });

  if (criticalFail && overallScore >= 60) {
    return { level: "C", label: "功能替代", color: "#c2610c", desc: "功能满足但需改板或改固件" };
  }

  if (overallScore >= 90) return { level: "A", label: "直接替代", color: "#1a6c4e", desc: "Pin-to-Pin兼容，可直接替换" };
  if (overallScore >= 75) return { level: "B", label: "硬件兼容", color: "#2d9d6f", desc: "封装兼容，软件需验证" };
  if (overallScore >= 60) return { level: "C", label: "功能替代", color: "#c2610c", desc: "功能满足但需改板或改固件" };
  if (overallScore >= 40) return { level: "D", label: "新设计可用", color: "#b8860b", desc: "适合新项目选型" };
  return { level: "X", label: "不推荐", color: "#c0392b", desc: "存在关键不兼容风险" };
}

// ─── P2: Dimension scores ───
function calculateDimensionScores(paramScores, params) {
  const dims = {};
  for (const [dimName, dim] of Object.entries(DIMENSIONS)) {
    if (dimName === "risk") continue;
    const matching = paramScores.filter(ps => {
      const p = params?.find(x => x.id === ps.paramId);
      return p && dim.keywords.some(k => p.name.includes(k) || (p.nameEn||"").includes(k));
    });
    dims[dimName] = matching.length
      ? Math.round(matching.reduce((s, ps) => s + (ps.score || 0), 0) / matching.length)
      : 50;
  }
  const naCount = paramScores.filter(ps => ps.value === "N/A" || ps.value === "n/a").length;
  const totalParams = paramScores.length || 1;
  dims.risk = Math.max(0, Math.round(100 - (naCount / totalParams) * 80));
  return dims;
}

// ─── Main scoring function ───
function calculateScore(originalParams, candidate, priorityOrder, constraints = {}) {
  const paramScores = [];
  let totalWeight = 0, weightedSum = 0;
  let eliminated = false, elimReason = "";

  priorityOrder.forEach((paramId, index) => {
    const origP = originalParams.find(p => p.id === paramId);
    if (!origP) return;
    const weight = priorityOrder.length - index;
    const candVal = candidate.parameters?.[paramId];
    let { score, comment } = scoreOneParam(origP, candVal?.value, origP.name);

    const con = constraints[paramId];
    if (con && !eliminated) {
      const conType = con.constraintType || "hard";
      let passed = true;
      const cv = candVal?.value;
      if (cv === "N/A" || cv === undefined || cv === null) { passed = true; }
      else if (con.options?.length) {
        passed = con.options.some(o => String(cv).toLowerCase().includes(o.toLowerCase()));
      } else {
        const cn = parseNum(cv);
        if (cn !== null) {
          if (con.min && cn < parseNum(con.min)) passed = false;
          if (con.max && cn > parseNum(con.max)) passed = false;
        }
      }
      if (!passed && conType === "hard") { eliminated = true; elimReason = `${origP.name}不满足约束`; }
      if (!passed && conType === "soft") { score = Math.max(0, score - 25); comment = "不满足偏好"; }
    }

    paramScores.push({
      paramId, paramName: origP.name, paramNameEn: origP.nameEn,
      value: candVal?.value || "N/A", unit: candVal?.unit || "",
      score, comment,
      source: candVal?.source || "", sourceLabel: candVal?.sourceLabel || "",
    });
    totalWeight += weight;
    weightedSum += score * weight;
  });

  const overallScore = totalWeight ? Math.round(weightedSum / totalWeight) : 0;
  const dimensionScores = calculateDimensionScores(paramScores, originalParams);
  const replacementLevel = getReplacementLevel(overallScore, paramScores, originalParams);

  return { eliminated, elimReason, overallScore, paramScores, dimensionScores, replacementLevel };
}

function isNumericParam(p) {
  const cats = ["interface","接口","封装","package","通信","protocol","通道类型","接口类型","轨到轨","rail","内核","core","类型","type","拓扑","topology"];
  if (cats.some(k => p.name.toLowerCase().includes(k) || (p.nameEn||"").toLowerCase().includes(k))) return false;
  return /^[-+±]?\d/.test(String(p.value).trim());
}

module.exports = { calculateScore, scoreOneParam, getReplacementLevel, calculateDimensionScores, isNumericParam, DIMENSIONS, PARAM_TOLERANCE };
