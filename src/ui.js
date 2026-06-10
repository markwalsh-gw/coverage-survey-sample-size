// Form ⇄ state ⇄ URL. Histogram prior is stored as a comma-separated string of
// 20 percentages so the URL stays compact-ish.

import { defaultHistogramBins, normalizeHistogram, priorFromMeanCI, histogramFromBeta } from "./math.js";

export const N_BINS = 20;

const SCALAR_FIELDS = [
  "priorMode", "priorMean", "priorLo", "priorHi",
  // CEA inputs (replace pStar / vUp / vDown — those are now derived)
  "caseload", "annualBudget",
  "untreatedMortality", "mortalityReduction", "valPerDeath",
  "benefitAdjustment", "gdValuePerDollar",
  "budgetUp", "budgetDown", "targetCashMultiple",
  // Survey logistics
  "costPerInterview", "fixedCost", "targetROI",
  "NMin", "NMax", "NStep", "M", "seed",
];

const DEFAULTS = {
  priorMode: "meanCI",
  priorMean: 0.30,
  priorLo: 0.10,
  priorHi: 0.55,
  // Generic placeholder CEA defaults (NOT calibrated to any specific program).
  // Imply p* ≈ 0.27 with the listed prior, which gives a non-trivial decision.
  caseload: 50000,
  annualBudget: 1500000,
  untreatedMortality: 0.05,
  mortalityReduction: 0.50,
  valPerDeath: 119,
  benefitAdjustment: 1.0,
  gdValuePerDollar: 0.003355,
  budgetUp: 20000000,
  budgetDown: 4000000,
  targetCashMultiple: 8,
  costPerInterview: 200,
  fixedCost: 0,
  targetROI: 8,
  NMin: 100, NMax: 5000, NStep: 100, M: 20000, seed: 40326,
};

// Program templates. These pre-fill plausible STARTING points so a grantmaker
// sees the right structure and order of magnitude for their program, then
// overwrites every field with their actual numbers.
//
// IMPORTANT: these are rough illustrative placeholders, NOT GiveWell-endorsed
// figures. Coverage priors reflect commonly-observed levels (campaign programs
// aim high; treatment programs lower); the CEA internals (mortality, budgets,
// caseloads) are round demo numbers chosen only so the tool produces a sensible
// example. The UI shows a disclaimer whenever a template is loaded. gd value
// per $ (0.003355), value per under-5 death (119), and the 8x bar are the only
// values carried over as real GiveWell standards.
export const PRESETS = {
  cmam: {
    label: "CMAM (acute malnutrition treatment)",
    priorMode: "meanCI", priorMean: 0.30, priorLo: 0.10, priorHi: 0.55,
    caseload: 50000, annualBudget: 1500000,
    untreatedMortality: 0.05, mortalityReduction: 0.50, valPerDeath: 119,
    benefitAdjustment: 1.0, gdValuePerDollar: 0.003355,
    budgetUp: 20000000, budgetDown: 4000000, targetCashMultiple: 8,
    costPerInterview: 200, fixedCost: 0, targetROI: 8,
  },
  nets: {
    label: "Insecticide-treated nets (ITNs)",
    priorMode: "meanCI", priorMean: 0.65, priorLo: 0.45, priorHi: 0.85,
    caseload: 400000, annualBudget: 1500000,
    untreatedMortality: 0.006, mortalityReduction: 0.25, valPerDeath: 119,
    benefitAdjustment: 1.0, gdValuePerDollar: 0.003355,
    budgetUp: 30000000, budgetDown: 8000000, targetCashMultiple: 8,
    costPerInterview: 60, fixedCost: 0, targetROI: 8,
  },
  smc: {
    label: "Seasonal malaria chemoprevention (SMC)",
    priorMode: "meanCI", priorMean: 0.70, priorLo: 0.50, priorHi: 0.88,
    caseload: 300000, annualBudget: 2000000,
    untreatedMortality: 0.01, mortalityReduction: 0.30, valPerDeath: 119,
    benefitAdjustment: 1.0, gdValuePerDollar: 0.003355,
    budgetUp: 25000000, budgetDown: 6000000, targetCashMultiple: 8,
    costPerInterview: 50, fixedCost: 0, targetROI: 8,
  },
  vas: {
    label: "Vitamin A supplementation (VAS)",
    priorMode: "meanCI", priorMean: 0.55, priorLo: 0.35, priorHi: 0.75,
    caseload: 250000, annualBudget: 1200000,
    untreatedMortality: 0.02, mortalityReduction: 0.12, valPerDeath: 119,
    benefitAdjustment: 1.0, gdValuePerDollar: 0.003355,
    budgetUp: 15000000, budgetDown: 3000000, targetCashMultiple: 8,
    costPerInterview: 40, fixedCost: 0, targetROI: 8,
  },
  vaccination: {
    label: "Routine childhood vaccination",
    priorMode: "meanCI", priorMean: 0.60, priorLo: 0.40, priorHi: 0.80,
    caseload: 200000, annualBudget: 1000000,
    untreatedMortality: 0.005, mortalityReduction: 0.50, valPerDeath: 119,
    benefitAdjustment: 1.0, gdValuePerDollar: 0.003355,
    budgetUp: 12000000, budgetDown: 3000000, targetCashMultiple: 8,
    costPerInterview: 45, fixedCost: 0, targetROI: 8,
  },
  water: {
    label: "Safe water (chlorination)",
    priorMode: "meanCI", priorMean: 0.40, priorLo: 0.20, priorHi: 0.65,
    caseload: 150000, annualBudget: 900000,
    untreatedMortality: 0.012, mortalityReduction: 0.25, valPerDeath: 119,
    benefitAdjustment: 1.0, gdValuePerDollar: 0.003355,
    budgetUp: 10000000, budgetDown: 2000000, targetCashMultiple: 8,
    costPerInterview: 35, fixedCost: 0, targetROI: 8,
  },
};

// Write a preset's fields into the form (leaves N-grid / sims / seed at whatever
// they currently are). Returns nothing; caller triggers a recompute.
export function applyPreset(id) {
  const preset = PRESETS[id];
  if (!preset) return;
  const { label, ...fields } = preset;
  writeForm(fields);
}

export function readForm() {
  const f = (id) => document.getElementById(id);
  const num = (id, dflt) => {
    const v = parseFloat(f(id).value);
    return Number.isFinite(v) ? v : dflt;
  };
  const out = { histProb: readHistogramProb() };
  for (const k of SCALAR_FIELDS) {
    out[k] = k === "priorMode" ? f(k).value : num(k, DEFAULTS[k]);
  }
  return out;
}

export function writeForm(params) {
  for (const k of SCALAR_FIELDS) {
    const el = document.getElementById(k);
    if (el && params[k] !== undefined) el.value = params[k];
  }
  if (params.histProb) writeHistogramProb(params.histProb);
}

export function readHistogramProb() {
  const out = new Array(N_BINS);
  for (let i = 0; i < N_BINS; i++) {
    const el = document.getElementById(`bin-${i}`);
    out[i] = el && el.value !== "" ? Math.max(0, parseFloat(el.value) || 0) : 0;
  }
  return out;
}

export function writeHistogramProb(probs) {
  for (let i = 0; i < N_BINS; i++) {
    const el = document.getElementById(`bin-${i}`);
    if (!el) continue;
    el.value = probs[i] != null ? Number(probs[i]).toFixed(2) : "0";
  }
  updateHistogramTotal();
}

export function getCurrentHistogram(params) {
  const bins = defaultHistogramBins(N_BINS);
  if (params.priorMode === "custom") {
    const total = params.histProb.reduce((s, p) => s + p, 0);
    if (total <= 0) throw new Error("Custom prior probabilities sum to 0 — set at least one bin > 0.");
    return normalizeHistogram({ ...bins, prob: params.histProb });
  }
  const beta = priorFromMeanCI(params.priorMean, params.priorLo, params.priorHi);
  return histogramFromBeta(beta, bins);
}

export function updateHistogramTotal() {
  const total = readHistogramProb().reduce((s, p) => s + p, 0);
  const el = document.getElementById("hist-total");
  if (el) {
    el.textContent = `Σ = ${total.toFixed(1)}%`;
    el.style.color = Math.abs(total - 100) < 0.5 ? "#059669" : "#b45309";
  }
}

export function setResults({ nStar, voiAtNStar, totalCost, marginalROIAtNStar }) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("res-nstar", nStar != null ? Math.round(nStar).toLocaleString() : "—");
  set("res-voi", fmtMoney(voiAtNStar));
  set("res-totalcost", fmtMoney(totalCost));
  set("res-roi", marginalROIAtNStar != null ? `${marginalROIAtNStar.toFixed(1)}x` : "—");
}

export function setDerivedDecision({ pStar, vUp, vDown }) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("derived-pstar", pStar != null ? `${(pStar * 100).toFixed(0)}%` : "—");
  // vUp / vDown are dollars per unit coverage (0→1); show per percentage point.
  set("derived-vup", vUp != null ? fmtMoney(vUp / 100) : "—");
  set("derived-vdown", vDown != null ? fmtMoney(vDown / 100) : "—");
}

// Plain-English readout of the recommendation, stating the cost-vs-information
// trade-off in words. Written to #recommendation as the headline result.
export function setRecommendation({ nStar, voiAtNStar, totalCost, targetROI, atRangeTop }) {
  const el = document.getElementById("recommendation");
  if (!el) return;

  if (nStar == null) {
    el.className = "recommendation warn";
    el.innerHTML =
      `<strong>No sample size is worth it under your ${fmtX(targetROI)} hurdle.</strong> ` +
      `Across the sizes searched, even the smallest survey returns less than ${fmtX(targetROI)} its cost in better decisions. ` +
      `Usually this means one of three things: the funding call is already clear enough that a survey would not change it, ` +
      `interviews are too expensive relative to what is at stake, or the hurdle is set too high. ` +
      `Try lowering the target return, lowering the cost per interview, or widening your prior (more uncertainty leaves more to learn).`;
    return;
  }

  const n = Math.round(nStar).toLocaleString();
  el.className = "recommendation good";
  el.innerHTML =
    `<strong>Interview about ${n} people.</strong> ` +
    `At that size the survey is expected to be worth ${fmtMoney(voiAtNStar)} in better funding decisions, ` +
    `for a survey cost of about ${fmtMoney(totalCost)}. ` +
    `Up to ${n} interviews, every extra $1 you spend on the survey still buys at least ${fmtX(targetROI)} that much in decision value. ` +
    `Past ${n}, the next interviews cost more than the information they add, so spending more is not worth it.` +
    (atRangeTop
      ? ` <em>Note: this is the largest size searched — raise “N max” under Advanced to check whether an even bigger survey would still clear the hurdle.</em>`
      : "");
}

function fmtX(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return Number.isInteger(x) ? `${x}×` : `${x.toFixed(1)}×`;
}

function fmtMoney(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = x < 0 ? "−" : "";
  const a = Math.abs(x);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${a.toFixed(2)}`;
}

// URL state
export function paramsToQuery(params) {
  const q = new URLSearchParams();
  for (const k of SCALAR_FIELDS) q.set(k, String(params[k]));
  if (params.priorMode === "custom") q.set("h", params.histProb.map((p) => Number(p).toFixed(2)).join(","));
  return q.toString();
}

export function queryToParams() {
  const q = new URLSearchParams(window.location.search);
  if ([...q.keys()].length === 0) return null;
  const out = {};
  for (const k of SCALAR_FIELDS) {
    const v = q.get(k);
    if (v == null) continue;
    out[k] = k === "priorMode" ? v : parseFloat(v);
  }
  const h = q.get("h");
  if (h) out.histProb = h.split(",").map(parseFloat);
  return out;
}
