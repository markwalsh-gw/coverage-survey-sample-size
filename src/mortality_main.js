// Entry point for mortality.html: init, event wiring, compute orchestration.
// Everything is closed-form, so recompute runs synchronously on every input —
// no busy spinner, no RNG, no seed.

import { analyzeDesign, designSweep, optimalStudySize } from "./mortality.js";
import { drawLinePlot } from "./plots.js";
import {
  MORTALITY_FIELDS,
  readMortalityForm, writeMortalityForm, toModelParams, validateMortalityParams,
  mortalityParamsToQuery, mortalityQueryToParams,
  setMortalityResults, setMortalityRecommendation, setMortalityCaveats,
  clearMortalityResults, renderSweepTable, sweepLadder,
} from "./mortality_ui.js";

function compute() {
  const ui = readMortalityForm();
  const mp = toModelParams(ui);

  const errEl = document.getElementById("error");
  const errs = validateMortalityParams(mp);
  let result = null;
  if (errs.length === 0) {
    try {
      result = analyzeDesign(mp);
    } catch (e) {
      errs.push(e.message);
    }
  }
  if (errs.length > 0) {
    errEl.innerHTML = errs.map((e) => `• ${e}`).join("<br>");
    errEl.style.display = "block";
    clearMortalityResults();
    const rec = document.getElementById("recommendation");
    if (rec) { rec.className = "recommendation"; rec.textContent = "Fix the issue flagged above to see results."; }
    return;
  }
  errEl.style.display = "none";

  const opt = result.decision ? optimalStudySize(mp) : null;
  setMortalityResults(result, ui, opt);
  setMortalityRecommendation(result, ui, opt);
  setMortalityCaveats(result, ui);

  // Sweep table (fixed ladder + current + clusters-needed + value-optimal designs).
  const ladder = sweepLadder(mp.cT, result.needed.cT, opt && opt.worthRunning ? opt.cT : NaN);
  renderSweepTable(designSweep(mp, ladder), {
    currentCT: mp.cT,
    neededCT: result.needed.cT,
    targetPower: mp.targetPower,
    optimalCT: opt && opt.worthRunning ? opt.cT : null,
  });

  // Fine sweep for the plots: 5 clusters up to 2.5× current (and past the
  // required design if that is larger).
  const hi = Math.max(Math.ceil(2.5 * mp.cT), Number.isFinite(result.needed.cT) ? result.needed.cT + 10 : 0);
  const fine = [];
  const step = Math.max(1, Math.round((hi - 5) / 40));
  for (let c = 5; c <= hi; c += step) fine.push(c);
  const sweep = designSweep(mp, fine);

  drawLinePlot(document.getElementById("plot-power"), {
    title: "Chance of an answer, by study size",
    xLabel: "clusters per arm (treatment)",
    yLabel: "% chance",
    markerX: mp.cT,
    markerLabel: "your design",
    series: [
      { xs: fine, ys: sweep.map((r) => r.power * 100), label: "power at best guess", color: "#2563eb" },
      { xs: fine, ys: sweep.map((r) => r.pConclusive * 100), label: "conclusive answer", color: "#059669" },
      { xs: fine, ys: fine.map(() => mp.targetPower * 100), label: `${Math.round(mp.targetPower * 100)}% target`, color: "#9ca3af" },
    ],
  });

  // Prior vs expected posterior, on the % reduction scale. Densities are
  // normalized to max 1 — the shapes are the message, not the y units.
  const { mu, tau } = result.prior;
  const postSd = result.bayes.postSd;
  const xs = [], prior = [], post = [];
  for (let i = 0; i <= 120; i++) {
    const theta = mu - 3.5 * tau + (7 * tau * i) / 120;
    const R = (1 - Math.exp(theta)) * 100;
    const jac = Math.exp(theta); // f_R(r) = f_theta(theta)·|dθ/dr| = f_theta(theta)·e^(−θ)
    xs.push(R);
    prior.push(Math.exp(-0.5 * ((theta - mu) / tau) ** 2) / tau / jac);
    post.push(Math.exp(-0.5 * ((theta - mu) / postSd) ** 2) / postSd / jac);
  }
  xs.reverse(); prior.reverse(); post.reverse(); // theta descending ⇒ R ascending
  const maxP = Math.max(...prior), maxQ = Math.max(...post);
  drawLinePlot(document.getElementById("plot-belief"), {
    title: "What you believe before vs. after the study",
    xLabel: "mortality reduction (%)",
    yLabel: "relative plausibility",
    markerX: ui.thresholdR,
    markerLabel: `${ui.thresholdR}% matters`,
    series: [
      { xs, ys: prior.map((y) => y / maxP), label: "your prior today", color: "#9ca3af" },
      { xs, ys: post.map((y) => y / maxQ), label: "after the study (typical)", color: "#2563eb" },
    ],
  });

  if (opt) {
    // Net decision value by size, from the full 2..500 optimum sweep
    // (subsampled for drawing). The best size and the zero line tell the
    // whole story: run the study at the peak; below zero, don't run it.
    const pts = [];
    for (let i = 0; i < opt.curve.cT.length; i += 4) pts.push(i);
    if (pts[pts.length - 1] !== opt.curve.cT.length - 1) pts.push(opt.curve.cT.length - 1);
    drawLinePlot(document.getElementById("plot-cost"), {
      title: "Is the study worth it, by size?",
      xLabel: "clusters per arm (treatment)",
      yLabel: "net value ($)",
      markerX: opt.worthRunning ? opt.cT : null,
      markerLabel: opt.worthRunning ? `best size = ${opt.cT}` : "",
      series: [
        { xs: pts.map((i) => opt.curve.cT[i]), ys: pts.map((i) => opt.curve.net[i]), label: "decision value − cost", color: "#2563eb" },
        { xs: pts.map((i) => opt.curve.cT[i]), ys: pts.map(() => 0), label: "break-even", color: "#9ca3af" },
      ],
    });
    const note = document.getElementById("plot-cost-note");
    if (note) note.textContent =
      "The study's value for the grant call, minus what it costs, at every size. Run it at the peak; anywhere below the grey line, the study costs more than the better decision it buys.";
  } else {
    drawLinePlot(document.getElementById("plot-cost"), {
      title: "Precision per dollar",
      xLabel: "total study cost ($)",
      yLabel: "post-study 95% range (pts)",
      markerX: result.cost,
      markerLabel: "your design",
      series: [
        { xs: sweep.map((r) => r.cost), ys: sweep.map((r) => r.expectedWidthR * 100), label: "", color: "#2563eb" },
      ],
    });
    const note = document.getElementById("plot-cost-note");
    if (note) note.textContent =
      "Each extra million narrows your post-study range by less than the last one. The flat tail is money spent on precision you will not act on.";
  }

  history.replaceState(null, "", `?${mortalityParamsToQuery(ui)}`);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const debouncedCompute = debounce(compute, 150);

function init() {
  const q = mortalityQueryToParams();
  if (q) writeMortalityForm(q);
  for (const id of MORTALITY_FIELDS) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", debouncedCompute);
  }
  window.addEventListener("resize", debouncedCompute);
  compute();
}

window.addEventListener("DOMContentLoaded", init);
