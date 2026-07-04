// component.js — v2: Improved AI lookup with evidence tracking

const { callGemini, repairJSON, lookupPartSpecs } = require("./gemini");

async function fetchComponentFromAPIs(partNumber, referenceParams = []) {
  if (process.env.DIGIKEY_CLIENT_ID) {
    try { /* TODO: DigiKey API */ } catch (e) { console.warn(`[DigiKey] ${partNumber}:`, e.message); }
  }
  if (process.env.MOUSER_API_KEY) {
    try { /* TODO: Mouser API */ } catch (e) { console.warn(`[Mouser] ${partNumber}:`, e.message); }
  }
  return fetchFromAI(partNumber, referenceParams);
}

async function fetchFromAI(partNumber, referenceParams) {
  if (!referenceParams.length) return null;
  try {
    const data = await lookupPartSpecs(partNumber, referenceParams);
    const parameters = {};
    let found = 0;
    referenceParams.forEach((ref, i) => {
      const key = `param_${i + 1}`;
      let val = data.params?.[key];
      if (!val && data.params) { const keys = Object.keys(data.params); if (keys[i]) val = data.params[keys[i]]; }
      if (!val && data.params) {
        val = Object.entries(data.params).find(([k, v]) => k.includes(ref.name) || String(v?.name||"").includes(ref.name))?.[1];
      }
      const value = val?.value ?? val?.v ?? "N/A";
      if (value !== "N/A") found++;
      parameters[ref.id] = {
        value, unit: val?.unit || ref.unit || "",
        source: "ai_search", sourceLabel: "AI搜索",
        confidence: value === "N/A" ? "none" : "low",
      };
    });
    console.log(`[AI] ${partNumber}: ${found}/${referenceParams.length} params`);
    return { partNumber: data.partNumber||partNumber, manufacturer: data.manufacturer||"", description: data.description||"", parameters, _source: "ai_search" };
  } catch (e) { console.warn(`[AI] Failed ${partNumber}:`, e.message); return null; }
}

module.exports = { fetchComponentFromAPIs };
