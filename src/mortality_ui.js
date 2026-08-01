// Form ⇄ state ⇄ URL and results rendering for the mortality page.
// Mirrors src/ui.js conventions; kept separate so the two tools stay decoupled.

export const MORTALITY_FIELDS = [
  // What effect do you expect? (percent units in the UI)
  "priorMeanR", "priorLoR", "priorHiR",
  // Mortality context (deaths per 1,000 child-years)
  "rateC", "rateT",
  // Study design
  "cT", "cC", "m", "years", "icc",
  // Costs
  "fixedCost", "costPerCluster", "costPerChild",
  // The decision this study informs
  "grantSize", "bar", "ceBest",
  // What counts as an answer?
  "alpha", "targetPower", "thresholdR", "gamma",
];

export const MORTALITY_DEFAULTS = {
  priorMeanR: 15, priorLoR: -5, priorHiR: 30,
  rateC: 25, rateT: 25,
  cT: 55, cC: 55, m: 1000, years: 1, icc: 0.001,
  fixedCost: 500000, costPerCluster: 5000, costPerChild: 10,
  grantSize: 25000000, bar: 4, ceBest: 6,
  alpha: 0.05, targetPower: 80, thresholdR: 5, gamma: 90,
};

export function readMortalityForm() {
  const num = (id, dflt) => {
    const el = document.getElementById(id);
    const v = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(v) ? v : dflt;
  };
  const out = {};
  for (const k of MORTALITY_FIELDS) out[k] = num(k, MORTALITY_DEFAULTS[k]);
  return out;
}

export function writeMortalityForm(params) {
  for (const k of MORTALITY_FIELDS) {
    const el = document.getElementById(k);
    if (el && params[k] !== undefined) el.value = params[k];
  }
}

// UI units (percent, per-1,000) → model units (fractions, risks).
export function toModelParams(p) {
  return {
    priorMeanR: p.priorMeanR / 100,
    priorLoR: p.priorLoR / 100,
    priorHiR: p.priorHiR / 100,
    rateC: p.rateC, rateT: p.rateT, years: p.years,
    cT: Math.round(p.cT), cC: Math.round(p.cC), m: Math.round(p.m), icc: p.icc,
    alpha: p.alpha,
    targetPower: p.targetPower / 100,
    thresholdR: p.thresholdR / 100,
    gamma: p.gamma / 100,
    fixedCost: p.fixedCost, costPerCluster: p.costPerCluster, costPerChild: p.costPerChild,
    grantSize: p.grantSize, bar: p.bar, ceBest: p.ceBest,
  };
}

export function validateMortalityParams(mp) {
  const errs = [];
  const riskC = (mp.rateC / 1000) * mp.years;
  const riskT = (mp.rateT / 1000) * mp.years;
  if (!(mp.years > 0)) errs.push("Follow-up per child must be positive.");
  if (!(riskC > 0 && riskC < 1) || !(riskT > 0 && riskT < 1))
    errs.push("Baseline mortality × follow-up must stay between 0 and 1,000 deaths per 1,000 children.");
  if (!(mp.priorLoR < mp.priorMeanR && mp.priorMeanR < mp.priorHiR))
    errs.push("The prior needs low < best guess < high.");
  if (!(mp.priorMeanR < 1))
    errs.push("Reductions of 100% or more are impossible — keep the best guess below 100%.");
  if (!(riskT * (1 - mp.priorMeanR) < 1))
    errs.push("At your best-guess effect, treatment-arm mortality would exceed 1,000 per 1,000 — adjust the prior, the treatment baseline, or the follow-up.");
  else if (!(riskT * (1 - mp.priorLoR) < 1))
    errs.push("The harm end of your prior would push treatment-arm mortality past 1,000 per 1,000 — raise the low end, or lower the baseline or follow-up.");
  if (!(mp.cT >= 2 && mp.cC >= 2)) errs.push("Each arm needs at least 2 clusters.");
  if (!(mp.m >= 1)) errs.push("Children per cluster must be at least 1.");
  if (!(mp.icc >= 0 && mp.icc < 1)) errs.push("ICC must be at least 0 and below 1.");
  if (!(mp.alpha > 0 && mp.alpha < 0.5)) errs.push("The false-alarm rate must be between 0 and 0.5.");
  if (!(mp.targetPower > 0.5 && mp.targetPower < 1)) errs.push("Target power must be between 50% and 100%.");
  if (!(mp.gamma > 0.5 && mp.gamma < 1)) errs.push("The confidence needed to conclude must be between 50% and 100%.");
  if (!(mp.thresholdR < mp.priorHiR))
    errs.push("Your 'smallest reduction that matters' sits above your whole prior — you could never conclude benefit.");
  if (!(mp.grantSize >= 0)) errs.push("The funding at stake cannot be negative.");
  if (mp.grantSize > 0 && !(mp.bar > 0)) errs.push("The bar must be above 0×.");
  if (mp.grantSize > 0 && !(mp.ceBest > 0))
    errs.push("Cost-effectiveness at your best guess must be above 0×.");
  return errs;
}

// URL state — same URLSearchParams pattern as the coverage tool.
export function mortalityParamsToQuery(params) {
  const q = new URLSearchParams();
  for (const k of MORTALITY_FIELDS) q.set(k, String(params[k]));
  return q.toString();
}

export function mortalityQueryToParams() {
  const q = new URLSearchParams(window.location.search);
  if ([...q.keys()].length === 0) return null;
  const out = {};
  for (const k of MORTALITY_FIELDS) {
    const v = q.get(k);
    if (v == null) continue;
    out[k] = parseFloat(v);
  }
  return out;
}

// ============================================================================
// Formatting
// ============================================================================

export function fmtPct(x, digits = 0) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtMoney(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = x < 0 ? "−" : "";
  const a = Math.abs(x);
  // Unit thresholds sit at the rounding boundary so e.g. $999,600 promotes
  // to "$1.0M" rather than rendering as "$1000k".
  if (a >= 999.5e6) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 999.5e3) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

// ============================================================================
// Results rendering
// ============================================================================

// Blank everything on the results side so stale numbers never sit next to an
// error banner.
export function clearMortalityResults() {
  for (const id of [
    "res-power", "res-mde", "res-needed", "res-conclusive", "res-belief",
    "res-weight", "res-cost",
    "res-rightcall", "res-voinet", "res-optimal",
    "cell-gr", "cell-gw", "cell-pr", "cell-pw",
    "derived-rr", "derived-priorbeats", "derived-priordeaths",
    "derived-deff", "derived-neff", "derived-spread", "derived-deaths",
    "derived-rstar", "derived-clearsbar", "derived-decidenow",
    // Dynamic sub-lines too, so stale parameter-dependent text never sits
    // under a blanked value.
    "res-power-sub", "res-needed-sub", "res-belief-sub", "res-cost-sub",
    "res-rightcall-sub", "res-voinet-sub", "res-optimal-sub",
  ]) set(id, "—");
  const caveats = document.getElementById("caveats");
  if (caveats) { caveats.style.display = "none"; caveats.innerHTML = ""; }
  const table = document.getElementById("sweep-table");
  if (table) table.innerHTML = "";
}

// r: analyzeDesign() bundle. ui: raw form values (UI units).
// opt: optimalStudySize() result, or null when the decision panel is off.
export function setMortalityResults(r, ui, opt = null) {
  // The classical view.
  set("res-power", fmtPct(r.power));
  set("res-power-sub", `chance of a significant result if the true effect is ${ui.priorMeanR}%; averaged over your whole prior it is ${fmtPct(r.assurance.any)}`);
  set("res-mde", Number.isFinite(r.mde) ? `${(r.mde * 100).toFixed(0)}% reduction` : "not reachable");
  set("res-needed", Number.isFinite(r.needed.cT) ? `${r.needed.cT} + ${r.needed.cC}` : "—");
  set("res-needed-sub", `treatment + control clusters at your best-guess effect; you have ${ui.cT} + ${ui.cC}`);

  // The Bayesian view.
  set("res-conclusive", fmtPct(r.bayes.pConclusiveEither));
  set("res-belief", `${fmtPct(r.bayes.expectedCI.lo)} to ${fmtPct(r.bayes.expectedCI.hi)}`);
  set("res-belief-sub", `typical 95% range, ~${(r.bayes.expectedWidthR * 100).toFixed(0)} points wide (your prior today: ${(r.bayes.priorWidthR * 100).toFixed(0)} points)`);
  set("res-weight", `${fmtPct(r.bayes.w)} data / ${fmtPct(1 - r.bayes.w)} prior`);

  // Cost.
  set("res-cost", fmtMoney(r.cost));
  const clusters = ui.cT + ui.cC;
  const childYears = clusters * ui.m * ui.years;
  set("res-cost-sub",
    `${fmtMoney(ui.fixedCost)} fixed + ${fmtMoney(ui.costPerCluster * clusters)} clusters + ` +
    `${fmtMoney(ui.costPerChild * clusters * ui.m)} children (≈ ${fmtMoney(r.cost / childYears)} per child-year)`);

  // The decision view. `opt` is the optimalStudySize() result (may be null).
  const dec = r.decision;
  if (dec) {
    set("res-rightcall", fmtPct(dec.pRightCall));
    set("res-rightcall-sub",
      `vs ${fmtPct(dec.pRightNow)} if you decided today with no study (today you would ${dec.grantNow ? "fund" : "pass"})`);
    const net = dec.voi - r.cost;
    set("res-voinet", fmtMoney(net));
    set("res-voinet-sub",
      `${fmtMoney(dec.voi)} of better-decision value − ${fmtMoney(r.cost)} study cost, measured against your ${ui.bar}× bar`);
    if (opt && opt.atSweepEdge && opt.worthRunning) {
      set("res-optimal", `${opt.cT}+ (search limit)`);
      set("res-optimal-sub",
        `net value is still rising at the tool's ${opt.cT}-cluster search cap — the true optimum may be larger`);
    } else if (opt) {
      set("res-optimal", opt.worthRunning ? `${opt.cT} + ${opt.cC}` : "none");
      set("res-optimal-sub", opt.worthRunning
        ? `clusters maximizing net value: ${fmtMoney(opt.net)} net at ${fmtMoney(opt.cost)} cost (you have ${ui.cT} + ${ui.cC})`
        : "no study size pays for itself under these decision stakes");
    } else {
      set("res-optimal", "—");
      set("res-optimal-sub", "optimal size unavailable");
    }
    set("cell-gr", fmtPct(dec.grantRight));
    set("cell-gw", fmtPct(dec.grantWrong));
    set("cell-pr", fmtPct(dec.passRight));
    set("cell-pw", fmtPct(dec.passWrong));
    set("derived-rstar", fmtPct(dec.rStar));
    set("derived-clearsbar", fmtPct(dec.pTrueClears));
    set("derived-decidenow", dec.grantNow ? "fund it" : "pass");
  } else {
    for (const id of ["res-rightcall", "res-voinet", "res-optimal",
      "cell-gr", "cell-gw", "cell-pr", "cell-pw",
      "derived-rstar", "derived-clearsbar", "derived-decidenow"]) set(id, "—");
    set("res-rightcall-sub", ui.grantSize > 0
      ? "needs a positive best-guess reduction (and a reachable bar)"
      : "decision panel off — set the funding at stake above 0 to turn it on");
    set("res-voinet-sub", "—");
    set("res-optimal-sub", "—");
  }

  // Derived strips.
  set("derived-rr", (1 - ui.priorMeanR / 100).toFixed(2));
  set("derived-priorbeats", fmtPct(r.bayes.priorPBeatsThr));
  set("derived-priordeaths", `≈ ${Math.round(r.prior.equivalentDeaths).toLocaleString()} deaths`);
  set("derived-deff", r.design.deff.toFixed(2));
  set("derived-neff", `${Math.round(r.design.nEffT).toLocaleString()} / ${Math.round(r.design.nEffC).toLocaleString()}`);
  set("derived-spread", Number.isFinite(r.spreadC.k) ? `±${(r.spreadC.k * 100).toFixed(0)}%` : "—");
  set("derived-deaths", `${Math.round(r.deaths.rawT).toLocaleString()} / ${Math.round(r.deaths.rawC).toLocaleString()}`);
}

// Headline banner: three power states per the UX spec, plus the decision
// sentence when the decision panel is live.
export function setMortalityRecommendation(r, ui, opt = null) {
  const el = document.getElementById("recommendation");
  if (!el) return;
  const target = ui.targetPower / 100;
  const concl = r.bayes.pConclusiveEither;
  const childYears = (ui.cT + ui.cC) * ui.m * ui.years;

  let cls, html;
  if (r.power >= target) {
    cls = "recommendation good";
    html =
      `<strong>This design is adequately powered.</strong> ` +
      `If the program really cuts deaths by your best guess of ${ui.priorMeanR}%, a study with ` +
      `${ui.cT}+${ui.cC} clusters (${childYears.toLocaleString()} child-years) has a ` +
      `<strong>${fmtPct(r.power)} chance</strong> of a statistically significant result — and a ` +
      `<strong>${fmtPct(concl)} chance</strong> of settling the funding question by your own standard ` +
      `(${ui.gamma}% sure either way about the ${ui.thresholdR}% line). Expected cost: <strong>${fmtMoney(r.cost)}</strong>.`;
  } else if (r.power >= 0.5) {
    cls = "recommendation warn";
    html =
      `<strong>This design is close, but short of the bar.</strong> ` +
      `At your best-guess effect of ${ui.priorMeanR}%, the chance of a significant result is ` +
      `<strong>${fmtPct(r.power)}</strong> against your ${ui.targetPower}% target. You would need about ` +
      `<strong>${Number.isFinite(r.needed.cT) ? `${r.needed.cT} + ${r.needed.cC} clusters` : "more clusters than is realistic"}</strong>` +
      ` (you have ${ui.cT} + ${ui.cC}) to reach it. The table below shows what more clusters buy and cost. ` +
      `Chance of a conclusive answer as designed: ${fmtPct(concl)}. Cost: ${fmtMoney(r.cost)}.`;
  } else {
    cls = "recommendation warn";
    html =
      `<strong>This design is more likely to miss a real effect than find one.</strong> ` +
      `Even if the program truly cuts deaths by ${ui.priorMeanR}%, this study would come back without a ` +
      `significant result ${fmtPct(1 - r.power)} of the time. Its reliable-detection floor is ` +
      `<strong>${Number.isFinite(r.mde) ? fmtPct(r.mde) : "beyond any plausible effect"}</strong>. ` +
      `Consider more clusters (about ${Number.isFinite(r.needed.cT) ? `${r.needed.cT} + ${r.needed.cC}` : "—"} for ` +
      `${ui.targetPower}% power), longer follow-up, or accepting that this study can only detect large effects. ` +
      `Cost as designed: ${fmtMoney(r.cost)}.`;
  }

  if (r.decision) {
    const net = r.decision.voi - r.cost;
    html += ` <strong>Decision math:</strong> with ${fmtMoney(ui.grantSize)} riding on the call, ` +
      `this study is worth ${fmtMoney(r.decision.voi)} in better decisions — ` +
      `${net >= 0 ? `${fmtMoney(net)} more than it costs` : `${fmtMoney(-net)} less than it costs`}.`;
    if (opt && opt.atSweepEdge && opt.worthRunning) {
      html += ` Net value is still rising at the tool's ${opt.cT}-cluster search limit — bigger may be better still.`;
    } else if (opt && opt.worthRunning && Math.abs(opt.cT - ui.cT) > 2) {
      html += ` The value-maximizing size is about ${opt.cT} + ${opt.cC} clusters (${fmtMoney(opt.net)} net).`;
    } else if (opt && !opt.worthRunning) {
      html += ` No size pays for itself — by your own numbers the call is already clear enough to make without a study.`;
    }
  }

  el.className = cls;
  el.innerHTML = html;
}

// Conditional amber caveats (shown only when triggered — see UX spec).
export function setMortalityCaveats(r, ui) {
  const el = document.getElementById("caveats");
  if (!el) return;
  const msgs = [];
  if (r.caveats.includes("fewClusters"))
    msgs.push("With fewer than about 15 clusters per arm, the bell-curve approximations used here get optimistic and real analyses need small-sample corrections. Treat every number on this page as a best case.");
  if (r.caveats.includes("fewDeaths"))
    msgs.push(`This design expects roughly ${Math.round(r.deaths.rawT)} deaths in the treatment arm and ${Math.round(r.deaths.rawC)} in control — after discounting for clustering, too few for the approximations to be trusted. Consider longer follow-up, more clusters, or higher-mortality areas.`);
  if (r.caveats.includes("priorClamped"))
    msgs.push("Part of your prior implied a 100%+ mortality reduction, which is impossible; it was capped just below 100%.");
  if (r.caveats.includes("priorAsymmetric"))
    msgs.push(`Your best guess and range do not quite fit one bell curve on the ratio scale, so the tool uses the closest fit — effectively a 95% range of ${fmtPct(r.prior.impliedCI.lo)} to ${fmtPct(r.prior.impliedCI.hi)}. Nudge the range until this note disappears if that misstates your view.`);
  if (r.caveats.includes("unequalBaselines"))
    msgs.push("You have set different baseline mortality in the two arms. The tool treats that gap as pre-existing, not as a program effect — make sure that is what you mean.");
  if (r.caveats.includes("highK"))
    msgs.push("Your ICC implies cluster death rates varying by more than ±50% of their mean — rare in practice. Double-check the ICC.");
  if (r.caveats.includes("priorSettled"))
    msgs.push(`By your own standard, this question is already ${fmtPct(Math.max(r.bayes.priorPBeatsThr, 1 - r.bayes.priorPBeatsThr))} settled before any data. A study can mostly only confirm what you believe — consider whether it is worth ${fmtMoney(r.cost)}, or set a stricter threshold.`);
  if (r.caveats.includes("mdeUnreachable"))
    msgs.push("No reduction — not even 100% — reaches your target power with this design. The minimum-detectable-effect card shows “not reachable” for that reason.");
  if (r.caveats.includes("decisionNeedsBenefit"))
    msgs.push("The decision panel needs a positive best-guess reduction: cost-effectiveness is anchored at your best guess, so a zero-or-harm central estimate leaves the grant math undefined. The rest of the page still works.");
  if (r.caveats.includes("barUnreachable"))
    msgs.push("At these numbers the program cannot clear your bar even if the true reduction were 100% — the breakeven reduction sits at or above 100%. Check the bar and the cost-effectiveness at your best guess.");

  if (msgs.length === 0) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "block";
  el.innerHTML = msgs.map((m) => `<div class="caveat">⚠ ${m}</div>`).join("");
}

// Design-sweep table. rows from designSweep(); marks the current design and
// the clusters-for-target-power design; tints the first row meeting target.
export function renderSweepTable(rows, { currentCT, neededCT, targetPower, optimalCT = null }) {
  const el = document.getElementById("sweep-table");
  if (!el) return;
  let firstHit = null;
  for (const row of rows) {
    if (row.power >= targetPower) { firstHit = row.cT; break; }
  }
  const hasNet = rows.some((row) => row.net != null);
  if (hasNet && optimalCT == null) {
    optimalCT = rows.reduce((a, b) => (b.net > a.net ? b : a)).cT;
  }
  const tr = rows.map((row) => {
    const tags = [];
    if (row.cT === currentCT) tags.push("← your design");
    if (row.cT === neededCT && neededCT !== currentCT) tags.push(`← ${Math.round(targetPower * 100)}% power`);
    if (row.cT === optimalCT && row.net > 0) tags.push("← best value");
    const cls = [];
    if (row.cT === currentCT) cls.push("current-row");
    if (row.cT === firstHit) cls.push("hit-target");
    return `<tr${cls.length ? ` class="${cls.join(" ")}"` : ""}>` +
      `<td>${row.cT} + ${row.cC}${tags.length ? ` <em>${tags.join(" ")}</em>` : ""}</td>` +
      `<td>${row.children.toLocaleString()}</td>` +
      `<td>${fmtPct(row.power)}</td>` +
      `<td>${fmtPct(row.pConclusive)}</td>` +
      `<td>${(row.expectedWidthR * 100).toFixed(0)} pts</td>` +
      `<td>${fmtMoney(row.cost)}</td>` +
      (hasNet ? `<td>${row.net != null ? fmtMoney(row.net) : "—"}</td>` : "") +
      `</tr>`;
  }).join("");
  el.innerHTML =
    `<thead><tr><th>Clusters (T + C)</th><th>Children</th><th>Power</th>` +
    `<th>Chance conclusive</th><th>95% range width</th><th>Cost</th>` +
    (hasNet ? `<th>Net value</th>` : "") +
    `</tr></thead><tbody>${tr}</tbody>`;
}

// The cluster ladder for the sweep table: fixed rungs + the current design,
// the clusters-needed design, and the value-optimal design. 8 fixed rungs +
// 3 injected anchors keep the table at 11 rows or fewer.
export function sweepLadder(currentCT, neededCT, optimalCT = NaN) {
  const rungs = new Set([10, 20, 30, 40, 50, 60, 80, 100]);
  rungs.add(currentCT);
  if (Number.isFinite(neededCT) && neededCT <= 400) rungs.add(neededCT);
  if (Number.isFinite(optimalCT) && optimalCT <= 400) rungs.add(optimalCT);
  return [...rungs].filter((c) => c >= 2).sort((a, b) => a - b);
}
