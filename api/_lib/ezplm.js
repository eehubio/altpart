// ezplm.js — ezPLM 本地数据库适配层
// 数据查询优先级: ezPLM本地库 → DigiKey/Mouser API → AI搜索(兜底)

const EZPLM_API = process.env.EZPLM_API_BASE || "";
const EZPLM_TOKEN = process.env.EZPLM_API_TOKEN || "";

// ═══════════════════════════════════════
// 本地数据库查询（主数据源）
// ═══════════════════════════════════════

/**
 * 从 ezPLM 物料库查询器件
 * @returns 标准化的器件数据，未找到返回 null
 */
async function queryLocalDB(partNumber) {
  // ━━━ 生产环境: 调用 ezPLM API ━━━
  if (EZPLM_API) {
    try {
      const res = await fetch(`${EZPLM_API}/api/parts/${encodeURIComponent(partNumber)}`, {
        headers: { Authorization: `Bearer ${EZPLM_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`ezPLM API ${res.status}`);
      const raw = await res.json();
      return normalizeEzplmPart(raw);
    } catch (e) {
      console.warn(`[ezPLM] Query failed for ${partNumber}:`, e.message);
      return null; // 失败时降级到 AI 搜索
    }
  }

  // ━━━ 演示环境: 内置模拟数据库 ━━━
  return MOCK_LOCAL_DB[partNumber.toUpperCase()] || null;
}

/**
 * 批量查询（用于候选校验，效率更高）
 */
async function queryLocalDBBatch(partNumbers) {
  if (EZPLM_API) {
    try {
      const res = await fetch(`${EZPLM_API}/api/parts/batch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${EZPLM_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ partNumbers }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`ezPLM batch API ${res.status}`);
      const raw = await res.json();
      const map = {};
      for (const item of raw.parts || []) {
        map[item.mpn.toUpperCase()] = normalizeEzplmPart(item);
      }
      return map;
    } catch (e) {
      console.warn("[ezPLM] Batch query failed:", e.message);
      return {};
    }
  }
  // 演示: 逐个查内置库
  const map = {};
  for (const pn of partNumbers) {
    const hit = MOCK_LOCAL_DB[pn.toUpperCase()];
    if (hit) map[pn.toUpperCase()] = hit;
  }
  return map;
}

/**
 * 查询器件详情（含供应商采购信息）— 用于详情弹窗
 */
async function queryPartDetail(partNumber) {
  if (EZPLM_API) {
    try {
      const res = await fetch(`${EZPLM_API}/api/parts/${encodeURIComponent(partNumber)}/detail`, {
        headers: { Authorization: `Bearer ${EZPLM_TOKEN}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const raw = await res.json();
      return normalizeEzplmDetail(raw);
    } catch (e) {
      console.warn(`[ezPLM] Detail query failed:`, e.message);
      return null;
    }
  }
  // 演示数据
  const base = MOCK_LOCAL_DB[partNumber.toUpperCase()];
  if (!base) return null;
  return { ...base, ...MOCK_DETAILS[partNumber.toUpperCase()] };
}

// ═══════════════════════════════════════
// 数据标准化
// ═══════════════════════════════════════

/** ezPLM 原始数据 → 标准 PartIR */
function normalizeEzplmPart(raw) {
  const parameters = [];
  let i = 0;
  for (const [key, val] of Object.entries(raw.parameters || raw.specs || {})) {
    i++;
    parameters.push({
      id: `param_${i}`,
      name: val.nameCn || val.name || key,
      nameEn: val.nameEn || key,
      value: String(val.value ?? val),
      unit: val.unit || "",
      source: "ezplm",
      sourceLabel: "本地数据库",
      confidence: "high",
      verified: raw.approved || false,
    });
  }
  return {
    partNumber: raw.mpn || raw.partNumber,
    internalPN: raw.internalPN || raw.internal_pn || "",
    manufacturer: raw.manufacturer || "",
    category: raw.category || "",
    description: raw.description || "",
    parameters,
    lifecycle: raw.lifecycle || "unknown",
    approved: raw.approved || false,
    usedInProjects: raw.usedInProjects || [],
    _source: "ezplm",
  };
}

/** ezPLM 详情数据 → 标准详情格式 */
function normalizeEzplmDetail(raw) {
  return {
    ...normalizeEzplmPart(raw),
    datasheetUrl: raw.datasheetUrl || "",
    suppliers: (raw.suppliers || []).map(s => ({
      name: s.name,
      type: s.type || "distributor",       // distributor | manufacturer | agent
      stock: s.stock ?? null,
      moq: s.moq ?? null,                   // 最小起订量
      leadTimeDays: s.leadTimeDays ?? null, // 交期
      tiers: s.priceTiers || s.tiers || [],
      contact: s.contact || "",
      lastQuoteDate: s.lastQuoteDate || "",
      url: s.url || "",
    })),
    inventory: raw.inventory ? {
      internal: raw.inventory.internal ?? 0,   // 公司内部库存
      reserved: raw.inventory.reserved ?? 0,   // 已预留
      available: raw.inventory.available ?? 0, // 可用
      location: raw.inventory.location || "",
    } : null,
    priceHistory: raw.priceHistory || [],
    qualityRecords: raw.qualityRecords || [],
  };
}

// ═══════════════════════════════════════
// 演示用模拟本地数据库
// ═══════════════════════════════════════
const MOCK_LOCAL_DB = {
  "STM32F103C8T6": {
    partNumber: "STM32F103C8T6", internalPN: "EE-IC-0042",
    manufacturer: "STMicroelectronics", category: "微控制器(MCU)",
    description: "32位ARM Cortex-M3 MCU，72MHz，64KB Flash",
    approved: true, lifecycle: "active",
    usedInProjects: ["PRJ-2024-001", "PRJ-2024-015"],
    _source: "ezplm",
    parameters: [
      { id:"param_1", name:"内核", nameEn:"Core", value:"ARM Cortex-M3", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_2", name:"最高主频", nameEn:"Max Frequency", value:"72", unit:"MHz", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_3", name:"Flash", nameEn:"Flash Memory", value:"64", unit:"KB", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_4", name:"SRAM", nameEn:"SRAM", value:"20", unit:"KB", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_5", name:"工作电压", nameEn:"Supply Voltage", value:"2.0 to 3.6", unit:"V", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_6", name:"GPIO数量", nameEn:"GPIO Count", value:"37", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_7", name:"ADC", nameEn:"ADC", value:"12-bit, 10ch", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_8", name:"通信接口", nameEn:"Interfaces", value:"UART×3,SPI×2,I2C×2,CAN,USB", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_9", name:"工作温度", nameEn:"Operating Temperature", value:"-40 to 85", unit:"°C", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_10", name:"封装", nameEn:"Package", value:"LQFP-48", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_11", name:"参考价格", nameEn:"Reference Price", value:"2.50", unit:"USD", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
    ],
  },
  "GD32F103C8T6": {
    partNumber: "GD32F103C8T6", internalPN: "EE-IC-0118",
    manufacturer: "兆易创新 (GigaDevice)", category: "微控制器(MCU)",
    description: "ARM Cortex-M3 国产MCU，108MHz",
    approved: true, lifecycle: "active",
    usedInProjects: ["PRJ-2024-022"],
    _source: "ezplm",
    parameters: [
      { id:"param_1", name:"内核", nameEn:"Core", value:"ARM Cortex-M3", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_2", name:"最高主频", nameEn:"Max Frequency", value:"108", unit:"MHz", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_3", name:"Flash", nameEn:"Flash Memory", value:"64", unit:"KB", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_4", name:"SRAM", nameEn:"SRAM", value:"20", unit:"KB", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_5", name:"工作电压", nameEn:"Supply Voltage", value:"2.6 to 3.6", unit:"V", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_6", name:"GPIO数量", nameEn:"GPIO Count", value:"37", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_7", name:"ADC", nameEn:"ADC", value:"12-bit, 10ch", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_8", name:"通信接口", nameEn:"Interfaces", value:"UART×3,SPI×2,I2C×2,CAN,USB", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_9", name:"工作温度", nameEn:"Operating Temperature", value:"-40 to 85", unit:"°C", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_10", name:"封装", nameEn:"Package", value:"LQFP-48", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_11", name:"参考价格", nameEn:"Reference Price", value:"1.20", unit:"USD", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
    ],
  },
  "LM358": {
    partNumber: "LM358", internalPN: "EE-IC-0007",
    manufacturer: "Texas Instruments", category: "运算放大器",
    description: "双通道通用运放",
    approved: true, lifecycle: "active",
    usedInProjects: ["PRJ-2023-088", "PRJ-2024-001", "PRJ-2024-031"],
    _source: "ezplm",
    parameters: [
      { id:"param_1", name:"通道数", nameEn:"Channels", value:"2", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_2", name:"增益带宽积", nameEn:"GBW", value:"1.1", unit:"MHz", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_3", name:"压摆率", nameEn:"Slew Rate", value:"0.3", unit:"V/μs", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_4", name:"输入失调电压", nameEn:"Input Offset Voltage", value:"2", unit:"mV", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_5", name:"供电电压范围", nameEn:"Supply Voltage Range", value:"3 to 32", unit:"V", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_6", name:"静态电流", nameEn:"Quiescent Current", value:"700", unit:"μA", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_7", name:"工作温度", nameEn:"Operating Temperature", value:"0 to 70", unit:"°C", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_8", name:"封装", nameEn:"Package", value:"SOIC-8", unit:"", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
      { id:"param_9", name:"参考价格", nameEn:"Reference Price", value:"0.25", unit:"USD", source:"ezplm", sourceLabel:"本地数据库", confidence:"high", verified:true },
    ],
  },
};

// 演示用详情数据（供应商+库存）
const MOCK_DETAILS = {
  "GD32F103C8T6": {
    datasheetUrl: "https://www.gigadevice.com.cn/product/mcu/main-stream-mcus/gd32f103-series",
    suppliers: [
      { name:"深圳华秋电子", type:"distributor", stock:25000, moq:10, leadTimeDays:1,
        tiers:[{qty:10,price:"¥8.20"},{qty:100,price:"¥7.50"},{qty:1000,price:"¥6.80"}],
        contact:"sales@hqew.com", lastQuoteDate:"2026-03-28", url:"#" },
      { name:"立创商城", type:"distributor", stock:48200, moq:1, leadTimeDays:1,
        tiers:[{qty:1,price:"¥8.50"},{qty:30,price:"¥7.90"},{qty:500,price:"¥7.10"}],
        contact:"", lastQuoteDate:"2026-04-01", url:"#" },
      { name:"兆易创新(原厂)", type:"manufacturer", stock:null, moq:3000, leadTimeDays:42,
        tiers:[{qty:3000,price:"¥6.20"},{qty:10000,price:"¥5.80"}],
        contact:"agent@gigadevice.com", lastQuoteDate:"2026-03-15", url:"#" },
    ],
    inventory: { internal: 850, reserved: 200, available: 650, location: "深圳仓-A12" },
    priceHistory: [
      { date:"2026-01", price:7.2 }, { date:"2026-02", price:7.0 },
      { date:"2026-03", price:6.9 }, { date:"2026-04", price:6.8 },
    ],
    qualityRecords: [
      { date:"2026-02-18", batch:"B240218", result:"合格", note:"来料检验通过, AQL 0.65" },
      { date:"2025-11-03", batch:"B231103", result:"合格", note:"高温老化测试通过" },
    ],
  },
};

module.exports = { queryLocalDB, queryLocalDBBatch, queryPartDetail, normalizeEzplmPart };
