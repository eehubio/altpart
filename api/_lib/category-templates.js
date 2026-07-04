// category-templates.js — P0: 品类参数模板
// 确保每个品类只提取该品类的关键参数，杜绝"MCU出现运放参数"

const CATEGORY_TEMPLATES = {
  MCU: {
    keywords: ["微控制器","MCU","Microcontroller","单片机","SoC"],
    params: [
      {name:"内核",nameEn:"Core",unit:"",example:"ARM Cortex-M3"},
      {name:"最高主频",nameEn:"Max Frequency",unit:"MHz"},
      {name:"Flash",nameEn:"Flash Memory",unit:"KB"},
      {name:"SRAM",nameEn:"SRAM",unit:"KB"},
      {name:"工作电压",nameEn:"Supply Voltage",unit:"V"},
      {name:"GPIO数量",nameEn:"GPIO Count",unit:""},
      {name:"ADC",nameEn:"ADC",unit:"",example:"12-bit, 10ch"},
      {name:"通信接口",nameEn:"Interfaces",unit:"",example:"UART×3,SPI×2,I2C×2,CAN,USB"},
      {name:"定时器",nameEn:"Timers",unit:""},
      {name:"工作温度",nameEn:"Operating Temperature",unit:"°C"},
      {name:"封装",nameEn:"Package",unit:""},
      {name:"参考价格",nameEn:"Reference Price",unit:"USD"},
    ],
    softwareChecks: true,
  },
  "运算放大器": {
    keywords: ["运放","Op-Amp","Operational Amplifier","运算放大器","OpAmp"],
    params: [
      {name:"通道数",nameEn:"Channels",unit:""},
      {name:"增益带宽积",nameEn:"GBW",unit:"MHz"},
      {name:"压摆率",nameEn:"Slew Rate",unit:"V/μs"},
      {name:"输入失调电压",nameEn:"Input Offset Voltage",unit:"mV"},
      {name:"输入偏置电流",nameEn:"Input Bias Current",unit:"pA"},
      {name:"等效输入噪声",nameEn:"Input Noise Density",unit:"nV/√Hz"},
      {name:"供电电压范围",nameEn:"Supply Voltage Range",unit:"V"},
      {name:"静态电流",nameEn:"Quiescent Current",unit:"μA"},
      {name:"CMRR",nameEn:"CMRR",unit:"dB"},
      {name:"轨到轨",nameEn:"Rail-to-Rail",unit:""},
      {name:"工作温度",nameEn:"Operating Temperature",unit:"°C"},
      {name:"封装",nameEn:"Package",unit:""},
      {name:"参考价格",nameEn:"Reference Price",unit:"USD"},
    ],
  },
  ADC: {
    keywords: ["ADC","模数转换","Analog to Digital","数据采集"],
    params: [
      {name:"分辨率",nameEn:"Resolution",unit:"Bits"},
      {name:"最大采样率",nameEn:"Max Sample Rate",unit:"SPS"},
      {name:"通道数",nameEn:"Channels",unit:""},
      {name:"接口类型",nameEn:"Interface",unit:""},
      {name:"INL",nameEn:"INL",unit:"LSB"},
      {name:"SNR",nameEn:"SNR",unit:"dB"},
      {name:"供电电压",nameEn:"Supply Voltage",unit:"V"},
      {name:"功耗",nameEn:"Power Dissipation",unit:"mW"},
      {name:"基准电压",nameEn:"Reference",unit:""},
      {name:"工作温度",nameEn:"Operating Temperature",unit:"°C"},
      {name:"封装",nameEn:"Package",unit:""},
      {name:"参考价格",nameEn:"Reference Price",unit:"USD"},
    ],
  },
  LDO: {
    keywords: ["LDO","线性稳压","Linear Regulator","稳压器","Voltage Regulator"],
    params: [
      {name:"输出电压",nameEn:"Output Voltage",unit:"V"},
      {name:"最大输出电流",nameEn:"Max Output Current",unit:"mA"},
      {name:"输入电压范围",nameEn:"Input Voltage Range",unit:"V"},
      {name:"压差",nameEn:"Dropout Voltage",unit:"mV"},
      {name:"静态电流",nameEn:"Quiescent Current",unit:"μA"},
      {name:"PSRR",nameEn:"PSRR",unit:"dB"},
      {name:"输出噪声",nameEn:"Output Noise",unit:"μVrms"},
      {name:"输出精度",nameEn:"Accuracy",unit:"%"},
      {name:"工作温度",nameEn:"Operating Temperature",unit:"°C"},
      {name:"封装",nameEn:"Package",unit:""},
      {name:"参考价格",nameEn:"Reference Price",unit:"USD"},
    ],
  },
  MOSFET: {
    keywords: ["MOSFET","场效应管","FET","MOS管"],
    params: [
      {name:"类型",nameEn:"Type",unit:"",example:"N-Channel"},
      {name:"Vds(max)",nameEn:"Drain-Source Voltage",unit:"V"},
      {name:"Id(max)",nameEn:"Continuous Drain Current",unit:"A"},
      {name:"Rds(on)",nameEn:"On-Resistance",unit:"mΩ"},
      {name:"Vgs(th)",nameEn:"Gate Threshold Voltage",unit:"V"},
      {name:"Qg",nameEn:"Total Gate Charge",unit:"nC"},
      {name:"功耗",nameEn:"Power Dissipation",unit:"W"},
      {name:"工作温度",nameEn:"Operating Temperature",unit:"°C"},
      {name:"封装",nameEn:"Package",unit:""},
      {name:"参考价格",nameEn:"Reference Price",unit:"USD"},
    ],
  },
  DAC: {
    keywords: ["DAC","数模转换","Digital to Analog"],
    params: [
      {name:"分辨率",nameEn:"Resolution",unit:"Bits"},
      {name:"更新速率",nameEn:"Update Rate",unit:"SPS"},
      {name:"通道数",nameEn:"Channels",unit:""},
      {name:"接口",nameEn:"Interface",unit:""},
      {name:"INL",nameEn:"INL",unit:"LSB"},
      {name:"输出范围",nameEn:"Output Range",unit:"V"},
      {name:"供电电压",nameEn:"Supply Voltage",unit:"V"},
      {name:"功耗",nameEn:"Power",unit:"mW"},
      {name:"工作温度",nameEn:"Operating Temperature",unit:"°C"},
      {name:"封装",nameEn:"Package",unit:""},
      {name:"参考价格",nameEn:"Reference Price",unit:"USD"},
    ],
  },
  "DC-DC": {
    keywords: ["DC-DC","Buck","Boost","降压","升压","开关电源","Switching Regulator"],
    params: [
      {name:"拓扑",nameEn:"Topology",unit:"",example:"Buck"},
      {name:"输入电压范围",nameEn:"Input Voltage Range",unit:"V"},
      {name:"输出电压",nameEn:"Output Voltage",unit:"V"},
      {name:"最大输出电流",nameEn:"Max Output Current",unit:"A"},
      {name:"开关频率",nameEn:"Switching Frequency",unit:"MHz"},
      {name:"效率",nameEn:"Efficiency",unit:"%"},
      {name:"静态电流",nameEn:"Quiescent Current",unit:"μA"},
      {name:"工作温度",nameEn:"Operating Temperature",unit:"°C"},
      {name:"封装",nameEn:"Package",unit:""},
      {name:"参考价格",nameEn:"Reference Price",unit:"USD"},
    ],
  },
};

function matchCategory(categoryText) {
  const lower = (categoryText || "").toLowerCase();
  for (const [name, tmpl] of Object.entries(CATEGORY_TEMPLATES)) {
    if (tmpl.keywords.some(k => lower.includes(k.toLowerCase()))) {
      return { name, ...tmpl };
    }
  }
  return null;
}

function buildParamGuide(template) {
  if (!template) return "请根据器件类别选取8-15个关键参数，含封装和参考价格。";
  return `该器件属于「${template.name}」类别，必须严格按以下参数模板提取（不要添加其他类别的参数）：
${template.params.map((p, i) => `param_${i+1}: ${p.name}（${p.nameEn}）${p.unit ? "，单位: "+p.unit : ""}${p.example ? "，示例: "+p.example : ""}`).join("\n")}`;
}

// 预判品类（根据型号前缀猜测）
function guessCategory(partNumber) {
  const pn = partNumber.toUpperCase();
  if (/^(STM32|GD32|CH32|APM32|AT32|MM32|HK32|CS32|N32|AC78)/i.test(pn)) return "MCU";
  if (/^(LM358|LM324|TL0[67]|OPA|AD8|LMV|MCP6|SGM8|TP1)/i.test(pn)) return "运算放大器";
  if (/^(ADS1|AD76|MCP3|MAX11|CS1[12]|HX71)/i.test(pn)) return "ADC";
  if (/^(AMS1|LM78|LDO|HT73|RT9|AP2[12]|ME6|XC6|SGM20)/i.test(pn)) return "LDO";
  if (/^(IRF|AON|SI[0-9]|BSS|2N7|AO3|NCE|CJ[0-9])/i.test(pn)) return "MOSFET";
  if (/^(TPS5|LM25|LM26|MP1|MP2|SY8|RT6|XL[0-9])/i.test(pn)) return "DC-DC";
  return null;
}

module.exports = { CATEGORY_TEMPLATES, matchCategory, buildParamGuide, guessCategory };
