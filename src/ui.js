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
  set("derived-pstar", pStar != null ? pStar.toFixed(3) : "—");
  set("derived-vup", fmtMoney(vUp));
  set("derived-vdown", fmtMoney(vDown));
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
