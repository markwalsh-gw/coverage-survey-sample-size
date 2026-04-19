// Form ⇄ state ⇄ URL. Histogram prior is stored as a comma-separated string of
// 20 percentages so the URL stays compact-ish.

import { defaultHistogramBins, normalizeHistogram, priorFromMeanCI, histogramFromBeta } from "./math.js";

export const N_BINS = 20;

const SCALAR_FIELDS = [
  "priorMode", "priorMean", "priorLo", "priorHi",
  "pStar", "vUp", "vDown",
  "costPerInterview", "fixedCost", "targetROI",
  "NMin", "NMax", "NStep", "M", "seed",
];

export function readForm() {
  const f = (id) => document.getElementById(id);
  const num = (id, dflt) => {
    const v = parseFloat(f(id).value);
    return Number.isFinite(v) ? v : dflt;
  };
  const histProb = readHistogramProb();
  return {
    priorMode: f("priorMode").value, // "meanCI" | "custom"
    priorMean: num("priorMean", 0.3),
    priorLo: num("priorLo", 0.1),
    priorHi: num("priorHi", 0.55),
    histProb,
    pStar: num("pStar", 0.5),
    vUp: num("vUp", 1e8),
    vDown: num("vDown", 2e7),
    costPerInterview: num("costPerInterview", 200),
    fixedCost: num("fixedCost", 0),
    targetROI: num("targetROI", 8),
    NMin: num("NMin", 100),
    NMax: num("NMax", 5000),
    NStep: num("NStep", 100),
    M: num("M", 20000),
    seed: num("seed", 40326),
  };
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

// Build a normalized histogram object from the form.
export function getCurrentHistogram(params) {
  const bins = defaultHistogramBins(N_BINS);
  if (params.priorMode === "custom") {
    const total = params.histProb.reduce((s, p) => s + p, 0);
    if (total <= 0) throw new Error("Custom prior probabilities sum to 0 — set at least one bin > 0.");
    return normalizeHistogram({ ...bins, prob: params.histProb });
  }
  // Mean+CI mode: fit a Beta then discretize.
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

function fmtMoney(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = x < 0 ? "−" : "";
  const a = Math.abs(x);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${a.toFixed(2)}`;
}

// URL state — encodes histogram as "h=12.5,7.1,..." (one number per bin).
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
