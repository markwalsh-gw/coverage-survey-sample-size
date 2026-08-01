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

  // Step ⑥ sweep table (fixed ladder + current + power-needed + value-optimal).
  const ladder = sweepLadder(mp.cT, result.needed.cT, opt && opt.worthRunning ? opt.cT : NaN);
  renderSweepTable(designSweep(mp, ladder), {
    currentCT: mp.cT,
    neededCT: result.needed.cT,
    targetPower: mp.targetPower,
    optimalCT: opt && opt.worthRunning ? opt.cT : null,
  });

  drawBeliefPlot(result, ui);
  drawSizePlots(result, ui, mp, opt);

  history.replaceState(null, "", `?${mortalityParamsToQuery(ui)}`);
}

// Step ②: prior vs. typical posterior on the % reduction scale, with the
// breakeven R* marked. Densities normalized to max 1 — shape is the message.
function drawBeliefPlot(result, ui) {
  const { mu, tau } = result.prior;
  const postSd = result.bayes.postSd;
  const xs = [], prior = [], post = [];
  for (let i = 0; i <= 120; i++) {
    const theta = mu - 3.5 * tau + (7 * tau * i) / 120;
    const R = (1 - Math.exp(theta)) * 100;
    const jac = Math.exp(theta); // f_R(r) = f_theta(theta)·e^(−θ)
    xs.push(R);
    prior.push(Math.exp(-0.5 * ((theta - mu) / tau) ** 2) / tau / jac);
    post.push(Math.exp(-0.5 * ((theta - mu) / postSd) ** 2) / postSd / jac);
  }
  xs.reverse(); prior.reverse(); post.reverse();
  const maxP = Math.max(...prior), maxQ = Math.max(...post);
  drawLinePlot(document.getElementById("plot-belief"), {
    title: "What you believe before vs. after the study",
    xLabel: "mortality reduction (%)",
    yLabel: "relative plausibility",
    markerX: result.decision ? result.decision.rStar * 100 : null,
    markerLabel: result.decision ? `breakeven ${(result.decision.rStar * 100).toFixed(1)}%` : "",
    series: [
      { xs, ys: prior.map((y) => y / maxP), label: "your prior today", color: "#9ca3af" },
      { xs, ys: post.map((y) => y / maxQ), label: "after the study (typical)", color: "#2563eb" },
    ],
  });
}

// Step ⑥: the marginal trade-off and the cumulative net-value curve. When
// the decision inputs are off, fall back to design-precision views so the
// canvases never sit empty.
function drawSizePlots(result, ui, mp, opt) {
  const marginalEl = document.getElementById("plot-marginal");
  const netEl = document.getElementById("plot-net");
  const setNote = (id, text) => {
    const n = document.getElementById(id);
    if (n) n.textContent = text;
  };

  if (opt) {
    setNote("plot-marginal-note",
      "The marginal test, cluster by cluster: the cost-effectiveness of the next cluster (blue, in multiples of cash) against your bar (grey). Keep adding clusters while blue is above grey; the best size is where they cross.");
    setNote("plot-net-note",
      "The same story cumulatively: the study's total value minus its total cost, at every size. Run it at the peak; below zero, the study is not worth running at all.");
    // Readable x-range: past the optimum but not the whole 500-cluster sweep.
    const hi = Math.min(
      opt.curve.cT.length - 1,
      Math.max(3 * opt.cT, Math.ceil(1.3 * mp.cT), 60) - 2
    );
    const idx = [];
    const step = Math.max(1, Math.round(hi / 60));
    for (let i = 1; i <= hi; i += step) idx.push(i); // i=0 has no marginal step
    if (idx[idx.length - 1] !== hi) idx.push(hi);

    // The marginal test in the units Mark specified: the next cluster's
    // cost-effectiveness as a cash multiple, judged against the bar.
    const finiteIdx = idx.filter((i) => Number.isFinite(opt.curve.mMultiple[i]));
    if (finiteIdx.length > 0) {
      drawLinePlot(marginalEl, {
        title: "Is the next cluster still above the bar?",
        xLabel: "clusters per arm (treatment)",
        yLabel: "cost-effectiveness (× cash)",
        markerX: opt.worthRunning ? opt.cT : null,
        markerLabel: opt.worthRunning ? `best size = ${opt.cT}` : "",
        series: [
          { xs: finiteIdx.map((i) => opt.curve.cT[i]), ys: finiteIdx.map((i) => opt.curve.mMultiple[i]), label: "next cluster's × cash", color: "#2563eb" },
          { xs: finiteIdx.map((i) => opt.curve.cT[i]), ys: finiteIdx.map(() => mp.bar), label: `your bar = ${mp.bar}×`, color: "#9ca3af" },
        ],
      });
    } else {
      // Zero-cost designs make every marginal multiple infinite: fall back
      // to the raw units view so the canvas never sits empty.
      drawLinePlot(marginalEl, {
        title: "What the next cluster buys (its cost is zero)",
        xLabel: "clusters per arm (treatment)",
        yLabel: "units of value",
        markerX: opt.worthRunning ? opt.cT : null,
        markerLabel: opt.worthRunning ? `best size = ${opt.cT}` : "",
        series: [
          { xs: idx.map((i) => opt.curve.cT[i]), ys: idx.map((i) => opt.curve.mvUnits[i]), label: "value of next cluster", color: "#2563eb" },
        ],
      });
      setNote("plot-marginal-note",
        "With zero study costs, every extra cluster is free information — the plot shows what each one buys in units of value.");
    }
    const idx0 = [0, ...idx];
    drawLinePlot(netEl, {
      title: "Net value of the study, by size",
      xLabel: "clusters per arm (treatment)",
      yLabel: "net units of value",
      markerX: opt.worthRunning ? opt.cT : null,
      markerLabel: opt.worthRunning ? `best size = ${opt.cT}` : "",
      series: [
        { xs: idx0.map((i) => opt.curve.cT[i]), ys: idx0.map((i) => opt.curve.netUnits[i]), label: "study value − cost", color: "#2563eb" },
        { xs: idx0.map((i) => opt.curve.cT[i]), ys: idx0.map(() => 0), label: "break-even", color: "#9ca3af" },
      ],
    });
    return;
  }

  // Fallback (funding decision off): show design precision instead.
  setNote("plot-marginal-note",
    "Blue: the chance of a statistically significant result at each study size; grey: your target power.");
  setNote("plot-net-note",
    "How the post-study 95% range (in points of reduction) narrows as total spending grows.");
  const hi = Math.max(Math.ceil(2.5 * mp.cT), Number.isFinite(result.needed.cT) ? result.needed.cT + 10 : 0);
  const fine = [];
  const step = Math.max(1, Math.round((hi - 5) / 40));
  for (let c = 5; c <= hi; c += step) fine.push(c);
  const sweep = designSweep(mp, fine);
  drawLinePlot(marginalEl, {
    title: "Chance of a significant result, by study size",
    xLabel: "clusters per arm (treatment)",
    yLabel: "% chance",
    markerX: mp.cT,
    markerLabel: "your design",
    series: [
      { xs: fine, ys: sweep.map((r) => r.power * 100), label: "power at best guess", color: "#2563eb" },
      { xs: fine, ys: fine.map(() => mp.targetPower * 100), label: `${Math.round(mp.targetPower * 100)}% target`, color: "#9ca3af" },
    ],
  });
  drawLinePlot(netEl, {
    title: "Precision per dollar",
    xLabel: "total study cost ($)",
    yLabel: "post-study 95% range (pts)",
    markerX: result.cost,
    markerLabel: "your design",
    series: [
      { xs: sweep.map((r) => r.cost), ys: sweep.map((r) => r.expectedWidthR * 100), label: "", color: "#2563eb" },
    ],
  });
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
