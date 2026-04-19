import { defaultHistogramBins, histogramFromBeta, priorFromMeanCI } from "./math.js";
import { optimalNByMarginalROI } from "./voi.js";
import { drawLinePlot, drawBarPlot } from "./plots.js";
import {
  readForm, writeForm, paramsToQuery, queryToParams,
  getCurrentHistogram, updateHistogramTotal, writeHistogramProb,
  setResults, N_BINS,
} from "./ui.js";

let busyDepth = 0;
function withBusy(fn) {
  return async (...args) => {
    busyDepth++;
    document.getElementById("busy").style.display = "inline";
    // Yield so the busy indicator paints before the heavy MC loop blocks the UI.
    await new Promise((r) => setTimeout(r, 0));
    try { return fn(...args); }
    finally {
      if (--busyDepth === 0) document.getElementById("busy").style.display = "none";
    }
  };
}

function syncMeanCIVisibility() {
  const mode = document.getElementById("priorMode").value;
  document.getElementById("meanCI-fields").style.display =
    mode === "meanCI" ? "" : "none";
}

// When in mean+CI mode, push the implied histogram into the bin inputs so the
// "Edit bin probabilities" advanced view stays in sync.
function refreshHistogramFromMeanCI(params) {
  if (params.priorMode !== "meanCI") return;
  try {
    const beta = priorFromMeanCI(params.priorMean, params.priorLo, params.priorHi);
    const h = histogramFromBeta(beta, defaultHistogramBins(N_BINS));
    writeHistogramProb(h.prob.map((p) => p * 100));
  } catch { /* validation handled elsewhere */ }
}

const compute = withBusy(() => {
  const p = readForm();
  refreshHistogramFromMeanCI(p);

  const errEl = document.getElementById("error");
  let histogram;
  try {
    histogram = getCurrentHistogram(p);
    if (!(p.vUp > p.vDown)) throw new Error("V_up must exceed V_down — otherwise scale-up never beats scale-down.");
    if (!(p.NMax >= p.NMin)) throw new Error("N max must be ≥ N min.");
    if (!(p.NStep >= 1)) throw new Error("N step must be ≥ 1.");
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = "block";
    return;
  }
  errEl.style.display = "none";

  const result = optimalNByMarginalROI({
    histogram,
    pStar: p.pStar, vUp: p.vUp, vDown: p.vDown,
    costPerInterview: p.costPerInterview, fixedCost: p.fixedCost,
    targetROI: p.targetROI,
    NMin: p.NMin, NMax: p.NMax, NStep: p.NStep,
    M: p.M, seed: p.seed,
  });

  const totalCost = result.nStar != null ? p.fixedCost + p.costPerInterview * result.nStar : null;
  const roiAtNStar = result.nStarIdx >= 0 ? result.marginalROI[result.nStarIdx] : null;
  setResults({
    nStar: result.nStar,
    voiAtNStar: result.voiAtNStar,
    totalCost,
    marginalROIAtNStar: roiAtNStar,
  });

  // Plots.
  drawBarPlot(document.getElementById("plot-prior"), {
    title: "Prior on coverage (probability per 5pp bin, %)",
    xLabel: "coverage",
    yLabel: "%",
    bins: histogram,
  });

  drawLinePlot(document.getElementById("plot-voi"), {
    title: "VoI vs sample size",
    xLabel: "N",
    yLabel: "VoI ($)",
    markerX: result.nStar,
    markerLabel: result.nStar != null ? `N* = ${result.nStar}` : "",
    series: [{ xs: result.ns, ys: result.vois, label: "VoI", color: "#2563eb" }],
  });

  drawLinePlot(document.getElementById("plot-roi"), {
    title: "Marginal ROI vs N (target hurdle dashed)",
    xLabel: "N",
    yLabel: "marginal ROI (×)",
    markerX: result.nStar,
    series: [
      { xs: result.ns, ys: result.marginalROI, label: "marginal ROI", color: "#059669" },
      { xs: result.ns, ys: result.ns.map(() => p.targetROI), label: `target = ${p.targetROI}×`, color: "#9ca3af" },
    ],
  });

  history.replaceState(null, "", `?${paramsToQuery(p)}`);
});

function buildHistogramGrid() {
  const grid = document.getElementById("hist-grid");
  const bins = defaultHistogramBins(N_BINS);
  for (let i = 0; i < N_BINS; i++) {
    const wrap = document.createElement("label");
    wrap.innerHTML = `<small>${(bins.lower[i] * 100).toFixed(0)}–${(bins.upper[i] * 100).toFixed(0)}%</small>`;
    const input = document.createElement("input");
    input.type = "number";
    input.id = `bin-${i}`;
    input.step = "0.1";
    input.min = "0";
    input.value = "0";
    wrap.appendChild(input);
    grid.appendChild(wrap);
    input.addEventListener("input", () => {
      updateHistogramTotal();
      // If user edits bins, switch into custom mode so their edits stick.
      const sel = document.getElementById("priorMode");
      if (sel.value !== "custom") { sel.value = "custom"; syncMeanCIVisibility(); }
      debouncedCompute();
    });
  }
}

function init() {
  buildHistogramGrid();
  const q = queryToParams();
  if (q) writeForm(q);
  syncMeanCIVisibility();
  document.getElementById("priorMode").addEventListener("change", () => {
    syncMeanCIVisibility();
    compute();
  });
  for (const id of [
    "priorMean", "priorLo", "priorHi", "pStar", "vUp", "vDown",
    "costPerInterview", "fixedCost", "targetROI",
    "NMin", "NMax", "NStep", "M", "seed",
  ]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", debouncedCompute);
  }
  window.addEventListener("resize", debouncedCompute);
  compute();
}

const debouncedCompute = debounce(() => compute(), 200);

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

window.addEventListener("DOMContentLoaded", init);
