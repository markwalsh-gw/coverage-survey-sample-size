// Form ⇄ state ⇄ URL and results rendering for the mortality page.
// Mirrors src/ui.js conventions; kept separate so the two tools stay decoupled.
//
// The results column is a numbered, auditable pipeline (steps ①–⑦); every
// renderer here fills one step's ids. See mortality.html for the structure.

export const MORTALITY_FIELDS = [
  // What effect do you expect? (percent units in the UI)
  "priorMeanR", "priorLoR", "priorHiR",
  // Mortality context (deaths per 1,000 child-years)
  "rateC", "rateT",
  // Study design
  "cT", "cC", "m", "years", "icc",
  // Costs
  "fixedCost", "costPerCluster", "costPerChild",
  // The funding decision the study informs
  "grantSize", "bar", "ceBest", "ceAlt", "gd",
  // Statistical conventions (frequentist sense-check only)
  "alpha", "targetPower",
];

export const MORTALITY_DEFAULTS = {
  priorMeanR: 15, priorLoR: -5, priorHiR: 30,
  rateC: 25, rateT: 25,
  cT: 55, cC: 55, m: 1000, years: 1, icc: 0.001,
  fixedCost: 500000, costPerCluster: 5000, costPerChild: 10,
  grantSize: 25000000, bar: 4, ceBest: 6, ceAlt: 4, gd: 0.003355,
  alpha: 0.05, targetPower: 80,
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
    fixedCost: p.fixedCost, costPerCluster: p.costPerCluster, costPerChild: p.costPerChild,
    grantSize: p.grantSize, bar: p.bar, ceBest: p.ceBest, ceAlt: p.ceAlt, gd: p.gd,
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
  if (!(mp.grantSize >= 0)) errs.push("The funding at stake cannot be negative.");
  if (mp.grantSize > 0) {
    if (!(mp.bar > 0)) errs.push("The bar must be above 0×.");
    if (!(mp.ceBest > 0)) errs.push("Cost-effectiveness at your best guess must be above 0×.");
    if (!(mp.ceAlt > 0)) errs.push("The next-best use's cost-effectiveness must be above 0×.");
    if (!(mp.gd > 0)) errs.push("Units of value per $ must be above 0.");
  }
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
  const v = (Math.abs(x) * 100).toFixed(digits);
  return `${x < 0 && parseFloat(v) !== 0 ? "\u2212" : ""}${v}%`;
}

// Dollars with two decimals in the millions range — used wherever the figure
// feeds arithmetic shown on screen, so the parts visibly reconcile.
export function fmtMoneyPrecise(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = x < 0 ? "\u2212" : "";
  const a = Math.abs(x);
  if (a >= 999.5e3) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  return fmtMoney(x);
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

// Units of value: whole numbers, thousands-separated, explicit sign when
// asked (the outcomes table wants +/− to read as gains/losses).
export function fmtUnits(x, { signed = false } = {}) {
  if (x == null || !Number.isFinite(x)) return "—";
  const a = Math.round(Math.abs(x));
  if (a === 0) return "0"; // never render "−0" or "+0"
  const sign = x < 0 ? "−" : signed ? "+" : "";
  return `${sign}${a.toLocaleString()}`;
}

const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

// ============================================================================
// Results rendering — one function per pipeline step
// ============================================================================

const STEP_VALUE_IDS = [
  "s1-fundval", "s1-altval", "s1-rstar", "s1-pclear", "s1-er", "s1-decide", "s1-evnow",
  "derived-rstar", "derived-clearsbar", "derived-decidenow",
  "s2-weight", "s2-belief", "s2-mislead",
  "s4-withstudy", "s4-today", "s4-voi",
  "s5-cost", "s5-costunits", "s5-net",
  "s6-best",
  "s7-power", "s7-mde", "s7-needed",
  "derived-rr", "derived-priorbeats", "derived-priordeaths",
  "derived-deff", "derived-neff", "derived-spread", "derived-deaths",
];
const STEP_SUB_IDS = [
  "s1-fundval-sub", "s1-altval-sub", "s2-belief-sub", "s4-voi-sub",
  "s1-evnow-sub", "s5-cost-sub", "s5-costunits-sub", "s5-net-sub", "s6-best-sub",
  "s7-power-sub", "s7-needed-sub",
];

// Blank everything on the results side so stale numbers never sit next to an
// error banner.
export function clearMortalityResults() {
  for (const id of STEP_VALUE_IDS) set(id, "—");
  for (const id of STEP_SUB_IDS) set(id, "—");
  set("s7-compare", "—");
  const caveats = document.getElementById("caveats");
  if (caveats) { caveats.style.display = "none"; caveats.innerHTML = ""; }
  for (const id of ["outcomes-table", "sweep-table"]) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  }
}

// r: analyzeDesign() bundle. ui: raw form values (UI units).
// opt: optimalStudySize() result, or null when the decision panel is off.
export function setMortalityResults(r, ui, opt = null) {
  const dec = r.decision;

  // Left-column derived strips (prior + design transparency).
  set("derived-rr", (1 - ui.priorMeanR / 100).toFixed(2));
  set("derived-priorbeats", dec ? fmtPct(dec.pTrueClears) : "—");
  set("derived-priordeaths", `≈ ${Math.round(r.prior.equivalentDeaths).toLocaleString()} deaths`);
  set("derived-deff", r.design.deff.toFixed(2));
  set("derived-neff", `${Math.round(r.design.nEffT).toLocaleString()} / ${Math.round(r.design.nEffC).toLocaleString()}`);
  set("derived-spread", Number.isFinite(r.spreadC.k) ? `±${(r.spreadC.k * 100).toFixed(0)}%` : "—");
  set("derived-deaths", `${Math.round(r.deaths.rawT).toLocaleString()} / ${Math.round(r.deaths.rawC).toLocaleString()}`);

  // Step ① — the funding decision today (and the card-5 mirror strip).
  if (dec) {
    set("s1-fundval", `${fmtUnits(dec.fundValueBestUnits)} units`);
    set("s1-fundval-sub", `${fmtMoney(ui.grantSize)} × CE ${ui.ceBest}× × ${ui.gd} units/$`);
    set("s1-altval", `${fmtUnits(dec.altValueUnits)} units`);
    set("s1-altval-sub", `${fmtMoney(ui.grantSize)} × CE ${ui.ceAlt}× × ${ui.gd} units/$`);
    set("s1-rstar", fmtPct(dec.rStar, 1));
    set("s1-pclear", fmtPct(dec.pTrueClears));
    set("s1-er", fmtPct(dec.meanR, 1));
    set("s1-decide", dec.grantNow ? "fund it" : "pass");
    set("s1-evnow", `${dec.evNowUnits > 0 ? "+" : ""}${fmtUnits(dec.evNowUnits)} units`);
    set("s1-evnow-sub", dec.grantNow
      ? `= value of funding at your prior's average reduction (${fmtPct(dec.meanR, 1)}) minus the value of passing; the study must improve on this`
      : `passing is worth more in expectation today; the study must improve on 0`);
    set("derived-rstar", fmtPct(dec.rStar, 1));
    set("derived-clearsbar", fmtPct(dec.pTrueClears));
    set("derived-decidenow", dec.grantNow ? "fund it" : "pass");
  } else {
    for (const id of ["s1-fundval", "s1-altval", "s1-rstar", "s1-pclear", "s1-er", "s1-decide", "s1-evnow",
      "derived-rstar", "derived-clearsbar", "derived-decidenow"]) set(id, "—");
    set("s1-fundval-sub", ui.grantSize > 0
      ? "needs a positive best-guess reduction (and a reachable breakeven)"
      : "value panel off — set the funding at stake above 0 to turn it on");
    set("s1-altval-sub", "—");
    set("s1-evnow-sub", "—");
  }

  // Step ② — what the study measures.
  set("s2-weight", `${fmtPct(r.bayes.w)} data / ${fmtPct(1 - r.bayes.w)} prior`);
  set("s2-belief", `${fmtPct(r.bayes.expectedCI.lo)} to ${fmtPct(r.bayes.expectedCI.hi)}`);
  set("s2-belief-sub", `typical 95% range, ~${(r.bayes.expectedWidthR * 100).toFixed(0)} points wide (your prior today: ${(r.bayes.priorWidthR * 100).toFixed(0)} points)`);
  set("s2-mislead", dec ? fmtPct(dec.grantWrong + dec.passWrong, 1) : "—");

  // Step ③ — the outcomes table.
  renderOutcomesTable(dec);

  // Step ④ — gross value of the study.
  if (dec) {
    set("s4-withstudy", `${fmtUnits(dec.evStudyUnits)} units`);
    set("s4-today", `${fmtUnits(dec.evNowUnits)} units`);
    set("s4-voi", `${fmtUnits(dec.voiUnits)} units`);
    set("s4-voi-sub", `the difference (rounding can shift the last digit); ≈ ${fmtMoney(dec.voiUnits / (ui.bar * ui.gd))} of bar-level grantmaking`);
  } else {
    for (const id of ["s4-withstudy", "s4-today", "s4-voi"]) set(id, "—");
    set("s4-voi-sub", "needs the funding decision — set the funding at stake in card 5");
  }

  // Step ⑤ — cost in units, net.
  const clusters = ui.cT + ui.cC;
  const childYears = clusters * ui.m * ui.years;
  set("s5-cost", fmtMoneyPrecise(r.cost));
  set("s5-cost-sub",
    `${fmtMoney(ui.fixedCost)} fixed + ${fmtMoney(ui.costPerCluster * clusters)} clusters + ` +
    `${fmtMoney(ui.costPerChild * clusters * ui.m)} children (≈ ${fmtMoney(r.cost / childYears)} per child-year)`);
  if (dec && r.costUnits != null) {
    set("s5-costunits", `${fmtUnits(r.costUnits)} units`);
    set("s5-costunits-sub", `${fmtMoneyPrecise(r.cost)} × ${ui.bar}× bar × ${ui.gd} units/$`);
    const net = dec.voiUnits - r.costUnits;
    set("s5-net", `${net > 0 ? "+" : ""}${fmtUnits(net)} units`);
    // The study judged like a grant: units per dollar, as a cash multiple.
    const multiple = r.costUnits > 0 ? (ui.bar * dec.voiUnits) / r.costUnits : Infinity;
    set("s5-net-sub",
      `step ④ minus the cost to the left; as a use of money, this study is ` +
      `${Number.isFinite(multiple) ? `${multiple.toFixed(1)}× cash` : "free information"} — ` +
      `${multiple >= ui.bar ? "clears" : "falls short of"} your ${ui.bar}× bar`);
  } else {
    set("s5-costunits", "—");
    set("s5-costunits-sub", "—");
    set("s5-net", "—");
    set("s5-net-sub", "—");
  }

  // Step ⑥ — the best size.
  if (opt && opt.atSweepEdge && opt.worthRunning) {
    set("s6-best", `${opt.cT}+ (search limit)`);
    set("s6-best-sub", `net value is still rising at the tool's ${opt.cT}-cluster search cap — the true optimum may be larger`);
  } else if (opt) {
    set("s6-best", opt.worthRunning ? `${opt.cT} + ${opt.cC}` : "none");
    set("s6-best-sub", opt.worthRunning
      ? `nets ${fmtUnits(opt.netUnits)} units at ${fmtMoney(opt.cost)}, ${opt.avgMultiple.toFixed(1)}× cash overall (you have ${ui.cT} + ${ui.cC}); past ${opt.cT} treatment clusters (controls at your ratio) the next data point drops below your ${ui.bar}× bar`
      : `no study size clears your ${ui.bar}× bar — at these stakes, better information is worth less than any study costs; decide with what you know`);
  } else {
    set("s6-best", "—");
    set("s6-best-sub", "needs the funding decision inputs (card 5)");
  }

  // Step ⑦ — frequentist sense-check.
  set("s7-power", fmtPct(r.power));
  set("s7-power-sub", `chance of a statistically significant result (two-sided alpha = ${ui.alpha}) if the truth equals your best guess; averaged over your whole prior instead: ${fmtPct(r.assurance.any)}`);
  set("s7-mde", Number.isFinite(r.mde) ? `${(r.mde * 100).toFixed(0)}% reduction` : "not reachable");
  set("s7-needed", Number.isFinite(r.needed.cT) ? `${r.needed.cT} + ${r.needed.cC}` : "—");
  set("s7-needed-sub", `for ${ui.targetPower}% power at your best-guess effect; you have ${ui.cT} + ${ui.cC}`);
  set("s7-compare", frequentistComparison(r, ui, opt));
}

// Step ③: the four outcomes, each with probability and expected value effect.
export function renderOutcomesTable(dec) {
  const el = document.getElementById("outcomes-table");
  if (!el) return;
  if (!dec) {
    el.innerHTML = `<tbody><tr><td colspan="4"><span class="note">Needs the funding decision — set the funding at stake in card 5.</span></td></tr></tbody>`;
    return;
  }
  const c = dec.cells;
  const row = (cls, label, p, units, note) =>
    `<tr class="${cls}"><td>${label}</td><td>${fmtPct(p)}</td>` +
    `<td>${units == null ? "0" : fmtUnits(units, { signed: true })}</td>` +
    `<td><span class="note">${note}</span></td></tr>`;
  // The on-screen audit line: the four pieces redistribute exactly the
  // expected gain of funding today, kappa·(E[R] − R*).
  const totalAtStake = dec.kappaUnits * (dec.meanR - dec.rStar);
  el.innerHTML =
    `<thead><tr><th>Outcome</th><th>Chance</th><th>Adds to expected value (units)</th><th></th></tr></thead><tbody>` +
    row("right", "Fund — and be right", c.grantRight.p, c.grantRight.units,
      "value won by funding a program that truly beats the alternative") +
    row("wrong", "Fund — and be wrong (misled)", c.grantWrong.p, c.grantWrong.units,
      "value destroyed: noise made a below-breakeven program look good") +
    row("right", "Pass — and be right", c.passRight.p, null,
      `dodges an expected ${fmtUnits(c.passRight.avoidedLossUnits)} units of losses vs. funding anyway`) +
    row("wrong", "Pass — and be wrong (misled)", c.passWrong.p, null,
      `leaves an expected ${fmtUnits(c.passWrong.forgoneUnits)} units unclaimed`) +
    `<tr class="total"><td>Deciding with the study</td><td>100%</td>` +
    `<td>${fmtUnits(dec.evStudyUnits, { signed: true })}</td>` +
    `<td><span class="note">vs. ${fmtUnits(dec.evNowUnits, { signed: true })} deciding today — the difference is the study's value (step ④)</span></td></tr>` +
    `<tr><td colspan="4"><span class="note">Unit figures are probability-weighted, so they can be audited by addition: ` +
    `${fmtUnits(c.grantRight.units, { signed: true })} ${fmtUnits(c.grantWrong.units, { signed: true })} ` +
    `+${fmtUnits(c.passWrong.forgoneUnits)} −${fmtUnits(c.passRight.avoidedLossUnits)} = ` +
    `${fmtUnits(totalAtStake, { signed: true })} units — exactly the expected gain of funding today, ` +
    `redistributed by what the study reveals. Pass rows add 0 because passing sends the money to the next-best use; ` +
    `their notes show what that choice dodged or left unclaimed.</span></td></tr>` +
    `</tbody>`;
}

// Step ⑦'s closing comparison sentence.
export function frequentistComparison(r, ui, opt) {
  if (!opt || !r.decision) {
    return "Turn on the funding-decision inputs (card 5) to compare the value-optimal size against this conventional recommendation.";
  }
  const needed = r.needed.cT;
  const interrogate = " If the direction of the gap surprises you, interrogate the prior range (card 1) and the cost-effectiveness numbers (card 5) — they are the only inputs the value lens uses that the conventional calculation ignores; a gap that survives that check is a real feature of your decision, not a bug.";
  if (!opt.worthRunning) {
    const conventional = Number.isFinite(needed)
      ? `a conventional calculation would still prescribe ${needed} + ${r.needed.cC} clusters for ${ui.targetPower}% power, but`
      : `no conventional design even reaches ${ui.targetPower}% power here, and`;
    return `The two lenses disagree here, instructively: ${conventional} with ${fmtMoney(ui.grantSize)} riding on the call, no study size pays for itself — better information is worth less than any study costs at these stakes.` + interrogate;
  }
  if (!Number.isFinite(needed)) {
    return `No design reaches ${ui.targetPower}% power, yet the value calculation still finds a worthwhile study at ${opt.cT} + ${opt.cC} clusters — decision value does not require journal-grade certainty.` + interrogate;
  }
  const ratio = opt.cT / needed;
  if (ratio < 0.85) {
    return `Sense-check: the conventional ${ui.targetPower}%-power design is ${needed} + ${r.needed.cC} clusters; the value-optimal design is smaller (${opt.cT} + ${opt.cC}). That is not a contradiction — with ${fmtMoney(ui.grantSize)} at stake and a prior already leaning ${r.decision.grantNow ? "fund" : "pass"}, the last increments of statistical certainty cost more than the decision improvements they buy.` + interrogate;
  }
  if (ratio > 1.15) {
    return `Sense-check: the value-optimal design (${opt.cT} + ${opt.cC} clusters) is larger than the conventional ${ui.targetPower}%-power design (${needed} + ${r.needed.cC}). With ${fmtMoney(ui.grantSize)} at stake, the decision justifies more certainty than the ${ui.targetPower}% convention asks for.` + interrogate;
  }
  return `Sense-check: the value-optimal design (${opt.cT} + ${opt.cC} clusters) lands close to the conventional ${ui.targetPower}%-power design (${needed} + ${r.needed.cC}) — the two lenses agree on the scale this study needs.`;
}

// Headline banner.
export function setMortalityRecommendation(r, ui, opt = null) {
  const el = document.getElementById("recommendation");
  if (!el) return;
  const dec = r.decision;

  if (!dec) {
    el.className = "recommendation";
    el.innerHTML = ui.grantSize > 0
      ? `<strong>The value calculation is switched off — see the warning above.</strong> ` +
        `It needs a positive best-guess reduction (card 1) and a breakeven below 100% ` +
        `(the two cost-effectiveness inputs in card 5). Steps ② and ⑦ below still work.`
      : `<strong>Set the funding decision (card 5) to price this study.</strong> ` +
        `Without it the page still shows what the study would measure (step ②) and the ` +
        `frequentist sense-check (step ⑦), but the value calculation needs to know what is at stake.`;
    return;
  }

  const net = r.costUnits != null ? dec.voiUnits - r.costUnits : null;
  let cls, html;
  if (opt && !opt.worthRunning) {
    cls = "recommendation warn";
    html =
      `<strong>Don't run this study — decide now.</strong> ` +
      `With ${fmtMoney(ui.grantSize)} at stake, better information is worth less than any study costs: ` +
      `the closest any size comes is ${fmtUnits(opt.voiUnits)} units bought for ${fmtUnits(opt.costUnits)} units of cost ` +
      `(${Number.isFinite(opt.avgMultiple) ? (opt.avgMultiple < 0.1 ? "under 0.1" : opt.avgMultiple.toFixed(1)) : "—"}× cash against your ${ui.bar}× hurdle). ` +
      `Deciding today (${dec.grantNow ? "fund" : "pass"}) is expected to be right ${fmtPct(dec.pRightNow)} of the time.`;
  } else if (opt && opt.atSweepEdge) {
    cls = "recommendation good";
    html =
      `<strong>Run a large study — the bigger the better within this tool's range.</strong> ` +
      `Net value is still rising at ${opt.cT} clusters per arm ` +
      `(+${fmtUnits(opt.netUnits)} units, ${fmtMoney(opt.cost)}). With ${fmtMoney(ui.grantSize)} at stake, ` +
      `more certainty keeps paying for itself past the tool's search limit.`;
  } else if (opt) {
    const atCurrent = net != null && net > 0
      ? `Your current ${ui.cT} + ${ui.cC} design also pays its way (+${fmtUnits(net)} units net).`
      : `Your current ${ui.cT} + ${ui.cC} design does NOT pay its way (${fmtUnits(net, { signed: true })} units net) — resize it.`;
    cls = "recommendation good";
    html =
      `<strong>Run a study of about ${opt.cT} + ${opt.cC} clusters (${fmtMoney(opt.cost)}).</strong> ` +
      `It buys ${fmtUnits(opt.voiUnits)} units of better funding decisions for ${fmtUnits(opt.costUnits)} units of cost — ` +
      `<strong>+${fmtUnits(opt.netUnits)} units net</strong>; as a use of money, the study itself is ` +
      `${opt.avgMultiple.toFixed(1)}× cash (≈ ${fmtMoney(opt.netUnits / (ui.bar * ui.gd))} of bar-level grantmaking, net). ` +
      `Past ${opt.cT} treatment clusters, the next data point drops below your ${ui.bar}× bar. ${atCurrent}`;
  } else {
    cls = "recommendation";
    html = `<strong>Value analysis unavailable.</strong> Check the funding-decision inputs.`;
  }
  el.className = cls;
  el.innerHTML = html;
}

// Conditional amber caveats (shown only when triggered).
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
  if (r.caveats.includes("mdeUnreachable"))
    msgs.push("No reduction — not even 100% — reaches your target power with this design. The minimum-detectable-effect line in step ⑦ shows “not reachable” for that reason.");
  if (r.caveats.includes("decisionNeedsBenefit"))
    msgs.push("The value calculation needs a positive best-guess reduction: cost-effectiveness is anchored at your best guess, so a zero-or-harm central estimate leaves the funding math undefined. Steps ② and ⑦ still work.");
  if (r.caveats.includes("barUnreachable"))
    msgs.push("At these numbers the program cannot beat the next-best use of the money even at a 100% reduction — the breakeven sits at or above 100%. Check the two cost-effectiveness inputs in card 5.");

  if (msgs.length === 0) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "block";
  el.innerHTML = msgs.map((m) => `<div class="caveat">⚠ ${m}</div>`).join("");
}

// Step ⑥'s design-sweep table.
export function renderSweepTable(rows, { currentCT, neededCT, targetPower, optimalCT = null }) {
  const el = document.getElementById("sweep-table");
  if (!el) return;
  const hasNet = rows.some((row) => row.net != null);
  if (hasNet && optimalCT == null) {
    optimalCT = rows.reduce((a, b) => (b.net > a.net ? b : a)).cT;
  }
  const tr = rows.map((row) => {
    const tags = [];
    if (row.cT === currentCT) tags.push("← your design");
    if (row.cT === optimalCT && row.net > 0) tags.push("← best value");
    if (row.cT === neededCT && neededCT !== currentCT) tags.push(`← ${Math.round(targetPower * 100)}% power`);
    const cls = [];
    if (row.cT === currentCT) cls.push("current-row");
    if (row.cT === optimalCT && row.net > 0) cls.push("hit-target");
    return `<tr${cls.length ? ` class="${cls.join(" ")}"` : ""}>` +
      `<td>${row.cT} + ${row.cC}${tags.length ? ` <em>${tags.join(" ")}</em>` : ""}</td>` +
      `<td>${row.children.toLocaleString()}</td>` +
      `<td>${fmtMoney(row.cost)}</td>` +
      `<td>${fmtPct(row.power)}</td>` +
      (hasNet
        ? `<td>${row.voiUnits != null ? fmtUnits(row.voiUnits) : "—"}</td>` +
          `<td>${row.net != null ? fmtUnits(row.net, { signed: true }) : "—"}</td>`
        : "") +
      `</tr>`;
  }).join("");
  el.innerHTML =
    `<thead><tr><th>Clusters (T + C)</th><th>Children</th><th>Cost</th><th>Power</th>` +
    (hasNet ? `<th>Study value (units)</th><th>Net (units)</th>` : "") +
    `</tr></thead><tbody>${tr}</tbody>`;
}

// The cluster ladder for the sweep table: fixed rungs + the current design,
// the clusters-needed design, and the value-optimal design.
export function sweepLadder(currentCT, neededCT, optimalCT = NaN) {
  const rungs = new Set([10, 20, 30, 40, 50, 60, 80, 100]);
  rungs.add(currentCT);
  if (Number.isFinite(neededCT) && neededCT <= 400) rungs.add(neededCT);
  if (Number.isFinite(optimalCT) && optimalCT <= 400) rungs.add(optimalCT);
  return [...rungs].filter((c) => c >= 2).sort((a, b) => a - b);
}
