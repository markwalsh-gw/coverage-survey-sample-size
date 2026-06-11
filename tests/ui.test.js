import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalculatorDom, makeWindow } from "./helpers/dom.js";

// ui.js touches document/window only inside its functions, so it is safe to
// install the stubs before importing.
globalThis.document = buildCalculatorDom({ withBins: true });
globalThis.window = makeWindow();

const {
  readForm, writeForm, readHistogramProb, writeHistogramProb,
  updateHistogramTotal, getCurrentHistogram,
  setResults, setDerivedDecision, setRecommendation,
  paramsToQuery, queryToParams, applyPreset, PRESETS, N_BINS,
} = await import("../src/ui.js");
const { defaultHistogramBins, histogramFromBeta, priorFromMeanCI } =
  await import("../src/math.js");
const { deriveDecisionParams } = await import("../src/cea.js");

const close = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

test("writeForm → readForm round-trips scalar fields and priorMode", () => {
  writeForm({
    priorMode: "custom", priorMean: 0.42, priorLo: 0.2, priorHi: 0.7,
    caseload: 12345, annualBudget: 999000, costPerInterview: 77,
    NMin: 200, NMax: 2000, NStep: 50, M: 5000, seed: 7,
  });
  const p = readForm();
  assert.equal(p.priorMode, "custom");
  close(p.priorMean, 0.42);
  close(p.caseload, 12345);
  close(p.costPerInterview, 77);
  close(p.NStep, 50);
  close(p.seed, 7);
  // Fields not mentioned keep their existing (index.html default) values.
  close(p.valPerDeath, 119);
  writeForm({ priorMode: "meanCI" });
});

test("readForm falls back to defaults when a field is blank or garbage", () => {
  document.getElementById("caseload").value = "";
  document.getElementById("targetROI").value = "not-a-number";
  const p = readForm();
  close(p.caseload, 50000); // DEFAULTS.caseload
  close(p.targetROI, 8);    // DEFAULTS.targetROI
  document.getElementById("caseload").value = "50000";
  document.getElementById("targetROI").value = "8";
});

test("readHistogramProb clamps negatives and treats blank/garbage as 0", () => {
  writeHistogramProb(new Array(N_BINS).fill(0));
  document.getElementById("bin-0").value = "5";
  document.getElementById("bin-1").value = "-3";
  document.getElementById("bin-2").value = "";
  document.getElementById("bin-3").value = "abc";
  const probs = readHistogramProb();
  close(probs[0], 5);
  close(probs[1], 0);
  close(probs[2], 0);
  close(probs[3], 0);
  assert.equal(probs.length, N_BINS);
});

test("writeHistogramProb formats to 2dp and updates the running total", () => {
  const probs = new Array(N_BINS).fill(0);
  probs[5] = 60;
  probs[6] = 40.123;
  writeHistogramProb(probs);
  assert.equal(document.getElementById("bin-6").value, "40.12");
  const total = document.getElementById("hist-total");
  assert.match(total.textContent, /Σ = 100\.1%/);
});

test("updateHistogramTotal colors green at ~100%, amber otherwise", () => {
  const probs = new Array(N_BINS).fill(5); // sums to 100
  writeHistogramProb(probs);
  assert.equal(document.getElementById("hist-total").style.color, "#059669");
  probs[0] = 50;
  writeHistogramProb(probs);
  assert.equal(document.getElementById("hist-total").style.color, "#b45309");
});

test("getCurrentHistogram in meanCI mode matches priorFromMeanCI → histogramFromBeta", () => {
  const params = { priorMode: "meanCI", priorMean: 0.3, priorLo: 0.1, priorHi: 0.55, histProb: [] };
  const h = getCurrentHistogram(params);
  const want = histogramFromBeta(
    priorFromMeanCI(0.3, 0.1, 0.55), defaultHistogramBins(N_BINS),
  );
  assert.equal(h.prob.length, N_BINS);
  for (let i = 0; i < N_BINS; i++) close(h.prob[i], want.prob[i], 1e-12);
});

test("getCurrentHistogram in custom mode normalizes; throws on zero-sum", () => {
  const histProb = new Array(N_BINS).fill(0);
  histProb[4] = 30;
  histProb[5] = 70;
  const h = getCurrentHistogram({ priorMode: "custom", histProb });
  close(h.prob[4], 0.3, 1e-12);
  close(h.prob[5], 0.7, 1e-12);
  close(h.prob.reduce((s, p) => s + p, 0), 1, 1e-12);
  assert.throws(
    () => getCurrentHistogram({ priorMode: "custom", histProb: new Array(N_BINS).fill(0) }),
    /sum to 0/,
  );
});

test("setResults formats counts, money, and ROI", () => {
  setResults({ nStar: 1234, voiAtNStar: 1.5e6, totalCost: 246800, marginalROIAtNStar: 12.34 });
  assert.equal(document.getElementById("res-nstar").textContent, (1234).toLocaleString());
  assert.equal(document.getElementById("res-voi").textContent, "$1.50M");
  assert.equal(document.getElementById("res-totalcost").textContent, "$246.8k");
  assert.equal(document.getElementById("res-roi").textContent, "12.3x");
  setResults({ nStar: null, voiAtNStar: null, totalCost: null, marginalROIAtNStar: null });
  assert.equal(document.getElementById("res-nstar").textContent, "—");
  assert.equal(document.getElementById("res-voi").textContent, "—");
});

test("setResults money formatting covers $, k, M, B and negatives", () => {
  const cases = [
    [0.5, "$0.50"], [2500, "$2.5k"], [5.912e8, "$591.20M"],
    [1.5e9, "$1.50B"], [-2500, "−$2.5k"],
  ];
  for (const [x, want] of cases) {
    setResults({ nStar: 1, voiAtNStar: x, totalCost: null, marginalROIAtNStar: null });
    assert.equal(document.getElementById("res-voi").textContent, want, `fmtMoney(${x})`);
  }
});

test("setDerivedDecision shows p* as % and V values per percentage point", () => {
  setDerivedDecision({ pStar: 0.2707, vUp: 5.912e8, vDown: 1.182e8 });
  assert.equal(document.getElementById("derived-pstar").textContent, "27%");
  // Dollars per unit coverage / 100 = per percentage point.
  assert.equal(document.getElementById("derived-vup").textContent, "$5.91M");
  assert.equal(document.getElementById("derived-vdown").textContent, "$1.18M");
  setDerivedDecision({ pStar: null, vUp: null, vDown: null });
  assert.equal(document.getElementById("derived-pstar").textContent, "—");
});

test("setRecommendation: success path names N, value, cost, and hurdle", () => {
  setRecommendation({
    nStar: 1200, voiAtNStar: 2.4e6, totalCost: 240000, targetROI: 8, atRangeTop: false,
  });
  const el = document.getElementById("recommendation");
  assert.equal(el.className, "recommendation good");
  assert.match(el.innerHTML, new RegExp(`Interview about ${(1200).toLocaleString()} people`));
  assert.match(el.innerHTML, /\$2\.40M/);
  assert.match(el.innerHTML, /\$240\.0k/);
  assert.match(el.innerHTML, /8×/);
  assert.doesNotMatch(el.innerHTML, /largest size searched/);
});

test("setRecommendation: flags when recommendation sits at the top of the range", () => {
  setRecommendation({
    nStar: 5000, voiAtNStar: 1e6, totalCost: 1e6, targetROI: 8, atRangeTop: true,
  });
  assert.match(document.getElementById("recommendation").innerHTML, /largest size searched/);
});

test("setRecommendation: warn path when no N clears the hurdle", () => {
  setRecommendation({ nStar: null, voiAtNStar: null, totalCost: null, targetROI: 8 });
  const el = document.getElementById("recommendation");
  assert.equal(el.className, "recommendation warn");
  assert.match(el.innerHTML, /No sample size is worth it/);
});

test("paramsToQuery → queryToParams round-trips, including a custom histogram", () => {
  const histProb = new Array(N_BINS).fill(0);
  histProb[4] = 30;
  histProb[10] = 70;
  const params = {
    priorMode: "custom", priorMean: 0.3, priorLo: 0.1, priorHi: 0.55,
    caseload: 50000, annualBudget: 1500000,
    untreatedMortality: 0.05, mortalityReduction: 0.5, valPerDeath: 119,
    benefitAdjustment: 1, gdValuePerDollar: 0.003355,
    budgetUp: 2e7, budgetDown: 4e6, targetCashMultiple: 8,
    costPerInterview: 200, fixedCost: 0, targetROI: 8,
    NMin: 100, NMax: 5000, NStep: 100, M: 20000, seed: 40326,
    histProb,
  };
  window.location.search = "?" + paramsToQuery(params);
  const back = queryToParams();
  assert.equal(back.priorMode, "custom");
  close(back.caseload, 50000);
  close(back.gdValuePerDollar, 0.003355);
  close(back.budgetUp, 2e7);
  assert.equal(back.histProb.length, N_BINS);
  close(back.histProb[4], 30);
  close(back.histProb[10], 70);
  window.location.search = "";
});

test("queryToParams returns null on an empty query string", () => {
  window.location.search = "";
  assert.equal(queryToParams(), null);
});

test("queryToParams ignores the histogram unless priorMode is custom", () => {
  const params = readForm();
  params.priorMode = "meanCI";
  const q = paramsToQuery(params);
  assert.doesNotMatch(q, /(^|&)h=/);
});

test("applyPreset writes the preset's fields into the form", () => {
  applyPreset("nets");
  const p = readForm();
  close(p.priorMean, PRESETS.nets.priorMean);
  close(p.caseload, PRESETS.nets.caseload);
  close(p.costPerInterview, PRESETS.nets.costPerInterview);
  assert.equal(p.priorMode, "meanCI");
});

test("applyPreset with an unknown id is a no-op", () => {
  const before = readForm();
  applyPreset("not-a-preset");
  assert.deepEqual(readForm(), before);
});

test("every preset yields a valid prior and a real decision (0 < p* < 1)", () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    assert.ok(
      preset.priorLo < preset.priorMean && preset.priorMean < preset.priorHi,
      `${id}: prior bounds must bracket the mean`,
    );
    // The prior must be elicitable…
    const beta = priorFromMeanCI(preset.priorMean, preset.priorLo, preset.priorHi);
    assert.ok(beta.alpha > 0 && beta.beta > 0, `${id}: invalid Beta prior`);
    // …and the CEA inputs must imply a decision threshold inside (0, 1),
    // otherwise the template loads into an immediate error state.
    const d = deriveDecisionParams(preset);
    assert.ok(d.pStar > 0 && d.pStar < 1, `${id}: p* = ${d.pStar} outside (0,1)`);
    assert.ok(d.vUp > d.vDown && d.vDown >= 0, `${id}: vUp must exceed vDown`);
  }
});
