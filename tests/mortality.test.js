// Tests for src/mortality.js: properties + regression benchmarks.
//
// The benchmark expected values were computed by TWO independent Python
// implementations (design-phase agents, August 2026): a closed-form script
// (math.erf only) and a 500,000-draw full-pipeline Monte Carlo, which agreed
// with each other within |z| <= 1.24 across 25 comparisons. Power values run
// through normalCdf (A&S 7.1.26, |err| <= 1.6e-7), so power tolerances are
// 5e-7 absolute rather than exact.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normQuantile,
  riskFromRate,
  designEffect,
  designSummary,
  clusterSpread,
  frequentistPower,
  minimumDetectableReduction,
  requiredClusters,
  hayesBennettPerArm,
  priorOnLogRR,
  seLogRR,
  bayesianSummary,
  assurance,
  bvnCdf,
  decisionAnalysis,
  optimalStudySize,
  studyCost,
  expectedDeaths,
  analyzeDesign,
  designSweep,
} from "../src/mortality.js";
import { normalCdf, mulberry32, makeNormalSampler } from "../src/math.js";
import { validateMortalityParams, toModelParams } from "../src/mortality_ui.js";

const close = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);
const closeRel = (a, b, rel) =>
  assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `expected ${a} ≈ ${b} (rel ${rel})`);

// ============================================================================
// normQuantile
// ============================================================================

test("normQuantile matches reference values", () => {
  close(normQuantile(0.5), 0, 1e-12);
  close(normQuantile(0.975), 1.959963984540054, 1e-8);
  close(normQuantile(0.8), 0.8416212335729143, 1e-8);
  close(normQuantile(0.9), 1.2815515655446004, 1e-8);
  close(normQuantile(0.025), -1.959963984540054, 1e-8);
  close(normQuantile(1e-6), -4.753424308822899, 1e-6);
});

test("normQuantile is symmetric and inverts normalCdf", () => {
  for (const p of [0.001, 0.05, 0.2, 0.4]) {
    close(normQuantile(p), -normQuantile(1 - p), 1e-9);
  }
  for (const p of [0.01, 0.1, 0.5, 0.9, 0.99]) {
    close(normalCdf(normQuantile(p)), p, 1e-6); // limited by normalCdf's 1.6e-7
  }
});

// ============================================================================
// Design quantities
// ============================================================================

test("riskFromRate: rate per 1,000 child-years × years", () => {
  close(riskFromRate(25, 1), 0.025);
  close(riskFromRate(25, 2), 0.05);
});

test("designEffect basics", () => {
  close(designEffect(1, 0.5), 1);
  close(designEffect(200, 0), 1);
  close(designEffect(1000, 0.001), 1.999, 1e-12);
});

test("clusterSpread: ICC ↔ k bridge (k = sqrt(rho(1-p)/p))", () => {
  const s = clusterSpread(0.004, 0.025);
  close(s.k, 0.3949683532, 1e-9);
  close(s.sigmaB, 0.009874208829, 1e-9);
  // exact inverse relation rho = k² p/(1−p)
  close((s.k * s.k * 0.025) / 0.975, 0.004, 1e-12);
});

// ============================================================================
// Frequentist: regression benchmarks (independent Python, freq_bench.py)
// ============================================================================

test("freq benchmark B1: equal arms, typical large mortality trial", () => {
  const d = designSummary({ cT: 35, cC: 35, m: 1000, icc: 0.004 });
  close(d.deff, 4.996, 1e-12);
  closeRel(d.nEffT, 7005.604484, 1e-8);
  const args = { pT0: 0.025, pC: 0.025, nEffT: d.nEffT, nEffC: d.nEffC, alpha: 0.05 };
  close(frequentistPower({ R: 0.20, ...args }), 0.5142819011, 5e-7);
  close(minimumDetectableReduction({ ...args, power: 0.8 }), 0.274951416, 1e-6);
  const req = requiredClusters({ R: 0.20, pT0: 0.025, pC: 0.025, m: 1000, icc: 0.004, power: 0.8, ratio: 1 });
  closeRel(req.cTExact, 68.97567255, 1e-8);
  assert.equal(req.cT, 69);
  assert.equal(req.cC, 69);
  close(req.achievedPower, 0.8001392336, 5e-7);
  closeRel(hayesBennettPerArm({ R: 0.20, pT0: 0.025, pC: 0.025, m: 1000, icc: 0.004, power: 0.8 }), 70.03089726, 1e-8);
});

test("freq benchmark B2: unequal arms (20 vs 40 clusters)", () => {
  const d = designSummary({ cT: 20, cC: 40, m: 500, icc: 0.01 });
  close(d.deff, 5.99, 1e-12);
  closeRel(d.nEffT, 1669.449082, 1e-8);
  closeRel(d.nEffC, 3338.898164, 1e-8);
  const args = { pT0: 0.03, pC: 0.03, nEffT: d.nEffT, nEffC: d.nEffC, alpha: 0.05 };
  close(frequentistPower({ R: 0.25, ...args }), 0.3607534507, 5e-7);
  close(minimumDetectableReduction({ ...args, power: 0.8 }), 0.4086932781, 1e-6);
  const req = requiredClusters({ R: 0.25, pT0: 0.03, pC: 0.03, m: 500, icc: 0.01, power: 0.8, ratio: 2 });
  assert.equal(req.cT, 62);
  assert.equal(req.cC, 123);
  close(req.achievedPower, 0.8045276592, 5e-7);
});

test("freq benchmark B3: rho=0 reduces to individual randomization", () => {
  const d = designSummary({ cT: 10, cC: 10, m: 2000, icc: 0 });
  close(d.deff, 1, 1e-15); // exact, but close() uses strict <
  close(
    frequentistPower({ R: 0.30, pT0: 0.04, pC: 0.04, nEffT: d.nEffT, nEffC: d.nEffC }),
    0.9999984578,
    5e-7
  );
  // Canonical textbook case: detect 0.5 vs 0.6, alpha .05, 80% power,
  // unpooled → 384.60 per arm (the famous "385").
  const req = requiredClusters({ R: 1 - 0.5 / 0.6, pT0: 0.6, pC: 0.6, m: 1, icc: 0, power: 0.8, ratio: 1 });
  closeRel(req.cTExact, 384.595107, 1e-8);
});

test("freq benchmark B4: unequal baselines, high rho, k-warning territory", () => {
  const d = designSummary({ cT: 30, cC: 30, m: 100, icc: 0.05 });
  close(d.deff, 5.95, 1e-12);
  const args = { pT0: 0.02, pC: 0.025, nEffT: d.nEffT, nEffC: d.nEffC, alpha: 0.05 };
  close(frequentistPower({ R: 0.10, ...args }), 0.1195446559, 5e-7);
  close(clusterSpread(0.05, 0.018).k, 1.651598552, 1e-8); // > 0.5 → warning
  close(clusterSpread(0.05, 0.025).k, 1.396424004, 1e-8);
  close(minimumDetectableReduction({ ...args, power: 0.8 }), 0.8004020036, 1e-6);
  const req = requiredClusters({ R: 0.10, pT0: 0.02, pC: 0.025, m: 100, icc: 0.05, power: 0.8, ratio: 1 });
  assert.equal(req.cT, 401);
  close(req.achievedPower, 0.8002171711, 5e-7);
});

test("freq benchmark B5: tiny cluster count + Hayes–Bennett comparison", () => {
  const d = designSummary({ cT: 8, cC: 8, m: 600, icc: 0.02 });
  close(d.deff, 12.98, 1e-12);
  close(
    frequentistPower({ R: 0.30, pT0: 0.03, pC: 0.03, nEffT: d.nEffT, nEffC: d.nEffC }),
    0.1214466099,
    5e-7
  );
  const req = requiredClusters({ R: 0.30, pT0: 0.03, pC: 0.03, m: 600, icc: 0.02, power: 0.8, ratio: 1 });
  closeRel(req.cTExact, 104.0984031, 1e-8);
  assert.equal(req.cT, 105);
  closeRel(hayesBennettPerArm({ R: 0.30, pT0: 0.03, pC: 0.03, m: 600, icc: 0.02, power: 0.8 }), 105.2588013, 1e-8);
});

// ============================================================================
// Frequentist: properties
// ============================================================================

const DES = designSummary({ cT: 50, cC: 50, m: 1000, icc: 0.001 });
const FARGS = { pT0: 0.025, pC: 0.025, nEffT: DES.nEffT, nEffC: DES.nEffC };

test("power at R=0 equals the significance level (both tails)", () => {
  close(frequentistPower({ R: 0, ...FARGS, alpha: 0.05 }), 0.05, 1e-3);
});

test("harm direction is handled and correctly asymmetric", () => {
  const d = designSummary({ cT: 35, cC: 35, m: 1000, icc: 0.004 });
  close(
    frequentistPower({ R: -0.20, pT0: 0.025, pC: 0.025, nEffT: d.nEffT, nEffC: d.nEffC }),
    0.4403776918, // independent Python value; != 0.5142 at +0.20
    5e-7
  );
});

test("power is monotone where it should be", () => {
  const p0 = frequentistPower({ R: 0.1, ...FARGS });
  assert.ok(frequentistPower({ R: 0.2, ...FARGS }) > p0);
  const bigger = designSummary({ cT: 100, cC: 100, m: 1000, icc: 0.001 });
  assert.ok(frequentistPower({ R: 0.1, pT0: 0.025, pC: 0.025, nEffT: bigger.nEffT, nEffC: bigger.nEffC }) > p0);
  const moreIcc = designSummary({ cT: 50, cC: 50, m: 1000, icc: 0.01 });
  assert.ok(frequentistPower({ R: 0.1, pT0: 0.025, pC: 0.025, nEffT: moreIcc.nEffT, nEffC: moreIcc.nEffC }) < p0);
});

test("MDE round-trips through the power function", () => {
  const mde = minimumDetectableReduction({ ...FARGS, alpha: 0.05, power: 0.8 });
  close(frequentistPower({ R: mde, ...FARGS, alpha: 0.05 }), 0.8, 1e-6);
});

test("MDE under a worse treatment baseline finds the crossing beyond the dip", () => {
  // Adversarial-verification repro: pT0 > pC makes power non-monotone in R —
  // near R = 0 the test "detects" the baseline gap itself, power dips to
  // alpha where the risks coincide (R = 1 − pC/pT0 = 0.1), then rises. The
  // MDE must be the upward crossing, and power(MDE) must equal the target.
  const d = designSummary({ cT: 300, cC: 300, m: 5000, icc: 0.05 });
  const args = { pT0: 0.30, pC: 0.27, nEffT: d.nEffT, nEffC: d.nEffC, alpha: 0.05 };
  const mde = minimumDetectableReduction({ ...args, power: 0.9 });
  assert.ok(mde > 0.1, `MDE ${mde} must lie beyond the equal-risk point 0.1`);
  close(frequentistPower({ R: mde, ...args }), 0.9, 1e-6);
});

test("MDE reports NaN when unreachable", () => {
  const tiny = designSummary({ cT: 4, cC: 4, m: 50, icc: 0 });
  assert.ok(Number.isNaN(minimumDetectableReduction({
    pT0: 0.01, pC: 0.01, nEffT: tiny.nEffT, nEffC: tiny.nEffC, power: 0.8,
  })));
});

// ============================================================================
// Bayesian: regression benchmarks (independent Python closed_form.py,
// cross-validated by 500k-draw MC)
// ============================================================================

function bayesCase(inp) {
  const d = designSummary({ cT: inp.kT, cC: inp.kC, m: inp.m, icc: inp.rho });
  const prior = priorOnLogRR({ mean: inp.best / 100, lo: inp.lo / 100, hi: inp.hi / 100 });
  const pT = (inp.pT0 / 1000) * Math.exp(prior.mu);
  const se = seLogRR({ pT, pC: inp.pC / 1000, nEffT: d.nEffT, nEffC: d.nEffC });
  return {
    d, prior, se,
    b: bayesianSummary({ prior, se, thresholdR: (inp.thr || 0) / 100, gamma: inp.gamma || 0.9 }),
    a: assurance({ prior, se, alpha: 0.05 }),
  };
}

test("bayes benchmark B1: informative prior, mid-size survey", () => {
  const { prior, se, b, a } = bayesCase({ best: 15, lo: 2, hi: 27, kT: 70, kC: 70, m: 500, pT0: 15, pC: 15, rho: 0.005 });
  close(prior.mu, -0.162519, 1e-6);
  close(prior.tau, 0.0751310, 1e-6);
  close(se, 0.1195381, 1e-6);
  close(b.w, 0.283167, 1e-6);
  close(b.postSd, 0.0636104, 1e-6);
  close(b.sigmaPm, 0.0399798, 1e-6);
  close(b.widthTheta, 0.249348, 1e-6);
  close(b.expectedWidthR * 100, 21.2665, 1e-4);
  close(a.benefit, 0.305607, 1e-6);
  close(a.any, 0.308081, 1e-6);
  close(b.pConclusiveBenefit, 0.978617, 1e-6);
  close(b.pConclusiveNull, 5.2e-10, 1e-10);
  close(b.pInconclusive, 0.0213826, 1e-6);
});

test("bayes benchmark B2: skeptical prior straddling zero", () => {
  const { prior, se, b, a } = bayesCase({ best: 5, lo: -10, hi: 18, kT: 100, kC: 100, m: 400, pT0: 18, pC: 18, rho: 0.004 });
  close(prior.mu, -0.0512933, 1e-6);
  close(prior.tau, 0.0749404, 1e-6);
  close(se, 0.0852706, 1e-6);
  close(b.w, 0.435788, 1e-6);
  close(b.expectedWidthR * 100, 21.0306, 1e-4);
  close(a.any, 0.180951, 1e-6);
  close(b.pConclusiveBenefit, 0.336739, 1e-6);
  close(b.pConclusiveNull, 0.0062972, 1e-6);
  close(b.pInconclusive, 0.656964, 1e-6);
});

test("bayes benchmark B3: tiny survey — prior dominates, banner fires", () => {
  const { b, a } = bayesCase({ best: 20, lo: 5, hi: 33, kT: 4, kC: 4, m: 60, pT0: 25, pC: 25, rho: 0.01 });
  close(b.w, 0.0134281, 1e-6);
  close(b.sigmaPm, 0.0103225, 1e-6);
  close(a.any, 0.0614540, 1e-6);
  // Prior alone already conclusive: prior P(R>0) = 0.994 >= 0.9.
  assert.equal(b.pConclusiveBenefit, 1);
  assert.equal(b.pConclusiveNull, 0);
  assert.equal(b.pInconclusive, 0);
  assert.ok(b.priorConclusiveBenefit);
});

test("bayes benchmark B4: huge survey, vague prior — data weight near 1", () => {
  const { b, a } = bayesCase({ best: 10, lo: -40, hi: 45, kT: 200, kC: 200, m: 1000, pT0: 20, pC: 20, rho: 0.002 });
  close(b.w, 0.973402, 1e-6);
  close(b.expectedWidthR * 100, 14.1118, 1e-4);
  close(a.any, 0.771257, 1e-6);
  close(b.pConclusiveBenefit, 0.593362, 1e-6);
  close(b.pConclusiveNull, 0.254664, 1e-6);
  close(b.pInconclusive, 0.151974, 1e-6);
});

test("bayes benchmark B5: unequal arms & baselines, threshold 10%, gamma 0.8", () => {
  const { prior, se, b, a } = bayesCase({ best: 25, lo: 8, hi: 39, kT: 80, kC: 40, m: 300, pT0: 22, pC: 20, rho: 0.008, thr: 10, gamma: 0.8 });
  close(prior.mu, -0.287682, 1e-6);
  close(se, 0.149248, 1e-6);
  close(b.w, 0.330352, 1e-6);
  close(b.expectedWidthR * 100, 25.3845, 1e-4);
  close(a.any, 0.490150, 1e-6);
  close(b.pConclusiveBenefit, 0.966209, 1e-6);
  // Exact-erf reference: 1.19836e-5. normalCdf's A&S 7.1.26 approximation
  // carries ~8e-9 absolute error at z ≈ −4.2, so pin the implementation
  // value with a tolerance inside the exact-reference gap.
  close(b.pConclusiveNull, 1.1991309870340583e-5, 1e-9);
  close(b.pInconclusive, 0.0337787, 1e-6);
});

// ============================================================================
// Bayesian: properties and Monte Carlo cross-checks
// ============================================================================

test("priorOnLogRR: CI endpoints flip; symmetric priors round-trip", () => {
  const pr = priorOnLogRR({ mean: 0.15, lo: -0.05, hi: 0.30 });
  assert.ok(pr.mu < 0 && pr.tau > 0);
  assert.ok(pr.impliedCI.lo < 0.15 && 0.15 < pr.impliedCI.hi);
  const mu = Math.log(1 - 0.2), tau = 0.1, z = normQuantile(0.975);
  const sym = priorOnLogRR({
    mean: 0.2,
    lo: 1 - Math.exp(mu + z * tau),
    hi: 1 - Math.exp(mu - z * tau),
  });
  close(sym.mu, mu, 1e-9);
  close(sym.tau, tau, 1e-7);
  assert.ok(sym.asymmetry < 1e-9);
});

test("priorOnLogRR clamps reductions ≥ 100% and flags it", () => {
  const pr = priorOnLogRR({ mean: 0.5, lo: 0.1, hi: 1.2 });
  assert.ok(pr.clamped);
  assert.ok(Number.isFinite(pr.tau));
  assert.throws(() => priorOnLogRR({ mean: 0.3, lo: 0.4, hi: 0.5 })); // bad ordering
});

test("prior invariants: tau² = sigmaPm² + postSd², equivalent-deaths formula", () => {
  const prior = priorOnLogRR({ mean: 0.15, lo: -0.05, hi: 0.30 });
  close(prior.equivalentDeaths, 4 / (prior.tau * prior.tau), 1e-9);
  for (const se of [0.02, 0.1, 0.5]) {
    const b = bayesianSummary({ prior, se });
    close(prior.tau * prior.tau, b.sigmaPm * b.sigmaPm + b.postSd * b.postSd, 1e-12);
  }
});

test("posterior weight behaves at the extremes", () => {
  const prior = { mu: -0.15, tau: 0.12 };
  const tiny = bayesianSummary({ prior, se: 100 });
  assert.ok(tiny.w < 1e-5);
  close(tiny.postSd, prior.tau, 1e-6);
  const huge = bayesianSummary({ prior, se: 1e-4 });
  assert.ok(huge.w > 0.999);
  close(huge.postSd, 1e-4, 1e-6);
});

test("conclusiveness probabilities partition to 1 and grow with survey size", () => {
  const prior = { mu: Math.log(1 - 0.15), tau: 0.11 };
  for (const se of [0.02, 0.1, 0.5]) {
    const b = bayesianSummary({ prior, se, thresholdR: 0.05, gamma: 0.9 });
    close(b.pConclusiveBenefit + b.pConclusiveNull + b.pInconclusive, 1, 1e-9);
  }
  const big = bayesianSummary({ prior, se: 0.02, thresholdR: 0.05, gamma: 0.9 });
  const small = bayesianSummary({ prior, se: 0.5, thresholdR: 0.05, gamma: 0.9 });
  assert.ok(big.pConclusiveEither > small.pConclusiveEither);
});

test("bayesianSummary agrees with full-pipeline Monte Carlo (app's own RNG)", () => {
  // Draw theta from the prior, theta_hat from the likelihood, do the
  // conjugate update, evaluate the conclusiveness events — cross-checks the
  // sigma_pm preposterior algebra end to end.
  const prior = { mu: Math.log(1 - 0.15), tau: 0.11 };
  const se = 0.1366, thresholdR = 0.05, gamma = 0.9;
  const b = bayesianSummary({ prior, se, thresholdR, gamma });

  const rng = mulberry32(20260801);
  const normal = makeNormalSampler(rng);
  const M = 200000;
  const zG = normQuantile(gamma);
  const thetaT = Math.log(1 - thresholdR);
  const postVar = 1 / (1 / prior.tau ** 2 + 1 / se ** 2);
  const postSd = Math.sqrt(postVar);
  let nBenefit = 0, nNull = 0;
  for (let i = 0; i < M; i++) {
    const theta = prior.mu + prior.tau * normal();
    const thetaHat = theta + se * normal();
    const postMean = postVar * (prior.mu / prior.tau ** 2 + thetaHat / se ** 2);
    if (postMean <= thetaT - zG * postSd) nBenefit++;
    else if (postMean >= thetaT + zG * postSd) nNull++;
  }
  close(nBenefit / M, b.pConclusiveBenefit, 0.005); // MC se ≈ 0.001; 5σ head-room
  close(nNull / M, b.pConclusiveNull, 0.005);
});

test("assurance agrees with Monte Carlo and collapses to power at a point prior", () => {
  const prior = priorOnLogRR({ mean: 0.15, lo: -0.05, hi: 0.30 });
  const se = 0.12, alpha = 0.05;
  const a = assurance({ prior, se, alpha });
  assert.ok(a.any > 0 && a.any < 1 && a.benefit <= a.any);

  const rng = mulberry32(987654);
  const normal = makeNormalSampler(rng);
  const M = 200000;
  const zA = normQuantile(1 - alpha / 2);
  let nSig = 0, nSigBenefit = 0;
  for (let i = 0; i < M; i++) {
    const theta = prior.mu + prior.tau * normal();
    const thetaHat = theta + se * normal();
    if (Math.abs(thetaHat) > zA * se) {
      nSig++;
      if (thetaHat < 0) nSigBenefit++;
    }
  }
  close(nSig / M, a.any, 0.005);
  close(nSigBenefit / M, a.benefit, 0.005);

  // Point prior (tau → 0): assurance = the z-test's power on the log-RR scale.
  const pt = assurance({ prior: { mu: Math.log(0.85), tau: 1e-12 }, se, alpha });
  const expected =
    normalCdf(-zA - Math.log(0.85) / se) + normalCdf(-zA + Math.log(0.85) / se);
  close(pt.any, expected, 1e-9);
});

// ============================================================================
// Bivariate normal CDF and the decision panel
// ============================================================================

test("bvnCdf satisfies exact identities", () => {
  // Phi2(0,0,rho) = 1/4 + asin(rho)/(2*pi), exactly.
  for (const rho of [-0.9, -0.5, 0, 0.3, 0.7, 0.925, 0.99]) {
    close(bvnCdf(0, 0, rho), 0.25 + Math.asin(rho) / (2 * Math.PI), 1e-9);
  }
  close(bvnCdf(0.5, -0.3, 0), normalCdf(0.5) * normalCdf(-0.3), 1e-12);
  close(bvnCdf(0.7, -0.2, 0.6), bvnCdf(-0.2, 0.7, 0.6), 1e-12);
  close(bvnCdf(0.5, 1.5, 0.99999), normalCdf(0.5), 2e-4); // rho→1: min marginal
  close(bvnCdf(0.5, Infinity, 0.7), normalCdf(0.5), 1e-12);
  assert.equal(bvnCdf(-Infinity, 0.5, 0.7), 0);
});

test("bvnCdf agrees with Monte Carlo at the correlations the tool uses", () => {
  for (const [h, k, rho] of [[0.55, 0.61, 0.88], [1.2, -0.4, 0.99], [-0.8, 0.3, 0.5]]) {
    const rng = mulberry32(777001);
    const normal = makeNormalSampler(rng);
    const M = 400000;
    let cnt = 0;
    for (let i = 0; i < M; i++) {
      const z1 = normal(), z2 = normal();
      if (z1 <= h && rho * z1 + Math.sqrt(1 - rho * rho) * z2 <= k) cnt++;
    }
    close(bvnCdf(h, k, rho), cnt / M, 0.003);
  }
});

const GD = 0.003355;
const DECISION_ARGS = { grantSize: 25e6, ceBest: 6, ceAlt: 4, gd: GD };

function defaultDecision() {
  const prior = priorOnLogRR({ mean: 0.15, lo: -0.05, hi: 0.30 });
  const d = designSummary({ cT: 55, cC: 55, m: 1000, icc: 0.001 });
  const se = seLogRR({ pT: 0.025 * 0.85, pC: 0.025, nEffT: d.nEffT, nEffC: d.nEffC });
  const bayes = bayesianSummary({ prior, se });
  return { prior, se, bayes, dec: decisionAnalysis({ prior, bayes, ...DECISION_ARGS }) };
}

test("decision cells partition, marginals match, and pins hold", () => {
  const { dec } = defaultDecision();
  // Breakeven: R* = R_best·ceAlt/ceBest = 15%·4/6 = 10%.
  close(dec.rStar, 0.1, 1e-12);
  close(dec.grantRight + dec.grantWrong + dec.passRight + dec.passWrong, 1, 1e-9);
  close(dec.grantRight + dec.grantWrong, dec.pGrant, 1e-9);
  close(dec.grantRight + dec.passWrong, dec.pTrueClears, 1e-9);
  // Exact regression pins (MC-verified to 4e-3 at 400k draws).
  close(dec.pGrant, 0.7304601969588113, 1e-9);
  close(dec.pTrueClears, 0.7097286938264914, 1e-9);
  close(dec.pRightCall, 0.8670144834135105, 1e-9);
  close(dec.grantRight, 0.6536016870994066, 1e-9);
  close(dec.grantWrong, 0.07685850985940468, 1e-9);
  close(dec.passRight, 0.21341279631410393, 1e-9);
  close(dec.passWrong, 0.056127006727084816, 1e-9);
  assert.ok(dec.grantNow); // prior E[R] = 14.5% ≥ R* = 10%
  close(dec.pRightNow, dec.pTrueClears, 1e-12);
});

test("value accounting in units: absolutes, per-cell decomposition, VoI pins", () => {
  const { dec } = defaultDecision();
  // Step-① absolutes: $25M × CE × 0.003355 units/$.
  close(dec.fundValueBestUnits, 25e6 * 6 * GD, 1e-9);  // 503,250
  close(dec.altValueUnits, 25e6 * 4 * GD, 1e-9);       // 335,500
  // Per-cell expected contributions (units, relative to the next-best use).
  close(dec.cells.grantRight.units, 207187.46985622708, 1e-3);
  close(dec.cells.grantWrong.units, -7195.666532278062, 1e-3);
  close(dec.cells.passWrong.forgoneUnits, 5340.67258291852, 1e-3);
  close(dec.cells.passRight.avoidedLossUnits, 52879.058733881095, 1e-3);
  // Fund rows sum to the with-study expectation.
  close(dec.cells.grantRight.units + dec.cells.grantWrong.units, dec.evStudyUnits, 1e-9);
  // Full decomposition identity: value won + value destroyed + value missed
  // − losses dodged = total value at stake, kappa·(E[R] − R*).
  close(
    dec.cells.grantRight.units + dec.cells.grantWrong.units +
    dec.cells.passWrong.forgoneUnits - dec.cells.passRight.avoidedLossUnits,
    dec.kappaUnits * (dec.meanR - dec.rStar),
    1e-6
  );
  close(dec.evStudyUnits, 199991.80332394902, 1e-3);
  close(dec.evNowUnits, 152453.41717298634, 1e-3);
  close(dec.voiUnits, 47538.38615096267, 1e-3);
});

test("decision cells and per-cell values agree with full-pipeline Monte Carlo", () => {
  const { prior, se, bayes, dec } = defaultDecision();
  const rng = mulberry32(20260803);
  const normal = makeNormalSampler(rng);
  const M = 400000;
  const { mu, tau } = prior;
  const w = bayes.w, postVar = bayes.postSd ** 2;
  const thetaStar = Math.log(1 - dec.rStar);
  const thetaCut = thetaStar - postVar / 2;
  const acc = { GR: [0, 0], GW: [0, 0], PR: [0, 0], PW: [0, 0] };
  for (let i = 0; i < M; i++) {
    const theta = mu + tau * normal();
    const thetaHat = theta + se * normal();
    const fund = w * thetaHat + (1 - w) * mu <= thetaCut;
    const clears = theta <= thetaStar;
    const v = dec.kappaUnits * (1 - Math.exp(theta) - dec.rStar);
    const key = fund ? (clears ? "GR" : "GW") : (clears ? "PW" : "PR");
    acc[key][0]++;
    acc[key][1] += v;
  }
  close(dec.cells.grantRight.p, acc.GR[0] / M, 0.004);
  close(dec.cells.grantWrong.p, acc.GW[0] / M, 0.004);
  close(dec.cells.passRight.p, acc.PR[0] / M, 0.004);
  close(dec.cells.passWrong.p, acc.PW[0] / M, 0.004);
  // MC se on the value sums ≈ 250 units at 400k draws; allow ~4σ.
  close(dec.cells.grantRight.units, acc.GR[1] / M, 1000);
  close(dec.cells.grantWrong.units, acc.GW[1] / M, 1000);
  close(dec.cells.passWrong.forgoneUnits, acc.PW[1] / M, 1000);
  close(dec.cells.passRight.avoidedLossUnits, -acc.PR[1] / M, 1000);
});

test("decision degenerates sensibly", () => {
  const prior = priorOnLogRR({ mean: 0.15, lo: -0.05, hi: 0.30 });
  // No data weight: the study cannot change the call; VoI = 0.
  const tiny = decisionAnalysis({
    prior, bayes: bayesianSummary({ prior, se: 1000 }), ...DECISION_ARGS,
  });
  close(tiny.pGrant, tiny.grantNow ? 1 : 0, 1e-6);
  close(tiny.voiUnits, 0, 1);
  // Harm-side best guess: panel off.
  assert.equal(decisionAnalysis({
    prior: { mu: Math.log(1.05), tau: 0.1 },
    bayes: bayesianSummary({ prior: { mu: Math.log(1.05), tau: 0.1 }, se: 0.1 }),
    ...DECISION_ARGS,
  }), null);
  // Breakeven out of reach: flagged.
  const far = decisionAnalysis({
    prior, bayes: bayesianSummary({ prior, se: 0.1 }),
    grantSize: 25e6, ceBest: 0.5, ceAlt: 4, gd: GD,
  });
  assert.ok(far.unreachable);
});

test("bigger studies weakly improve the chance of the right call; VoI stays nonnegative", () => {
  const prior = priorOnLogRR({ mean: 0.15, lo: -0.05, hi: 0.30 });
  let last = null;
  for (const cT of [10, 30, 100, 300]) {
    const d = designSummary({ cT, cC: cT, m: 1000, icc: 0.001 });
    const se = seLogRR({ pT: 0.025 * 0.85, pC: 0.025, nEffT: d.nEffT, nEffC: d.nEffC });
    const dec = decisionAnalysis({ prior, bayes: bayesianSummary({ prior, se }), ...DECISION_ARGS });
    assert.ok(dec.voiUnits >= 0);
    if (last !== null) assert.ok(dec.pRightCall >= last - 1e-9);
    last = dec.pRightCall;
  }
});

// ============================================================================
// Costs, deaths, bundle, sweep
// ============================================================================

test("studyCost adds up", () => {
  close(
    studyCost({ cT: 50, cC: 50, m: 1000, fixedCost: 500000, costPerCluster: 5000, costPerChild: 10 }),
    500000 + 5000 * 100 + 10 * 100 * 1000,
    1e-9
  );
});

test("expectedDeaths: raw uses c·m, effective divides by DEFF", () => {
  const d = expectedDeaths({ R: 0.15, pT0: 0.025, pC: 0.025, cT: 50, cC: 50, m: 1000, deff: 1.999 });
  close(d.rawC, 1250, 1e-9);
  close(d.rawT, 1062.5, 1e-9);
  close(d.effC, 1250 / 1.999, 1e-9);
});

// The default screen, pinned exactly (values from this implementation,
// sanity-checked against the UX agent's independent estimates: MDE ~15%,
// conclusive ~70%, CrI ~6-23%, weight ~75%; clusters raised 50→55 per arm so
// the default design clears the 80% power bar it displays).
const DEFAULTS = {
  priorMeanR: 0.15, priorLoR: -0.05, priorHiR: 0.30,
  rateT: 25, rateC: 25, years: 1,
  cT: 55, cC: 55, m: 1000, icc: 0.001,
  alpha: 0.05, targetPower: 0.8, thresholdR: 0.05, gamma: 0.9,
  fixedCost: 500000, costPerCluster: 5000, costPerChild: 10,
};

test("default screen regression pins", () => {
  const r = analyzeDesign(DEFAULTS);
  close(r.design.deff, 1.999, 1e-12);
  close(r.power, 0.8331396569456241, 1e-9);
  close(r.mde, 0.14382652248612832, 1e-7);
  assert.equal(r.needed.cT, 51);
  assert.equal(r.needed.cC, 51);
  close(r.bayes.pConclusiveEither, 0.7306972867804518, 1e-9);
  close(r.bayes.expectedCI.lo, 0.06436637438094805, 1e-9);
  close(r.bayes.expectedCI.hi, 0.2277960301801193, 1e-9);
  close(r.bayes.expectedWidthR, 0.16410935702440635, 1e-9);
  close(r.bayes.priorWidthR, 0.34701104689428364, 1e-9);
  close(r.bayes.w, 0.7758268953353029, 1e-9);
  close(r.assurance.any, 0.686173952215214, 1e-9);
  close(r.bayes.priorPBeatsThr, 0.8588796609496125, 1e-9);
  close(r.cost, 2150000, 1e-9);
  close(r.deaths.rawC, 1375, 1e-9);
  close(r.prior.equivalentDeaths, 373.860162697043, 1e-7);
  assert.deepEqual(r.caveats, []);
});

test("analyzeDesign flags the right caveats", () => {
  const few = analyzeDesign({ ...DEFAULTS, cT: 8, cC: 8 });
  assert.ok(few.caveats.includes("fewClusters"));
  const fewDeaths = analyzeDesign({ ...DEFAULTS, cT: 15, cC: 15, m: 30 });
  assert.ok(fewDeaths.caveats.includes("fewDeaths"));
  const unequal = analyzeDesign({ ...DEFAULTS, rateT: 20 });
  assert.ok(unequal.caveats.includes("unequalBaselines"));
  const highK = analyzeDesign({ ...DEFAULTS, icc: 0.05, m: 100 });
  assert.ok(highK.caveats.includes("highK"));
  const clamped = analyzeDesign({ ...DEFAULTS, priorHiR: 1.2 });
  assert.ok(clamped.caveats.includes("priorClamped"));
});

test("analyzeDesign rejects risks outside (0,1)", () => {
  assert.throws(() => analyzeDesign({ ...DEFAULTS, rateC: 0 }));
  assert.throws(() => analyzeDesign({ ...DEFAULTS, rateC: 600, years: 2 }));
});

test("analyzeDesign rejects impossible priors instead of rendering garbage", () => {
  // Harm prior pushing treatment risk past 1 (adversarial-verification repro:
  // without the guard, the Bayesian panel showed confident nonsense and
  // expected deaths exceeded children enrolled).
  assert.throws(() => analyzeDesign({
    ...DEFAULTS, rateT: 500, rateC: 500, years: 1.5,
    priorMeanR: -0.5, priorLoR: -0.8, priorHiR: 0.1,
  }), /treatment-arm mortality/);
  // Best guess ≥ 100% reduction.
  assert.throws(() => analyzeDesign({
    ...DEFAULTS, priorMeanR: 1.2, priorLoR: 0.5, priorHiR: 1.3,
  }), /100%/);
});

test("designSweep keeps the allocation ratio and is monotone", () => {
  const rows = designSweep({ ...DEFAULTS, cC: 110 }, [25, 50, 100]);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(row.cC, 2 * row.cT);
  assert.ok(rows[2].power > rows[0].power);
  assert.ok(rows[2].pConclusive > rows[0].pConclusive);
  assert.ok(rows[2].expectedWidthR < rows[0].expectedWidthR);
  assert.ok(rows[2].cost > rows[0].cost);
  // Without decision inputs the net column is absent.
  assert.equal(rows[0].net, null);
});

test("optimalStudySize: interior optimum, marginal crossing, unit conversion", () => {
  const params = { ...DEFAULTS, ...DECISION_ARGS, bar: 4 };
  const opt = optimalStudySize(params);
  assert.equal(opt.cT, 33);
  assert.equal(opt.cC, 33);
  close(opt.netUnits, 21499.005878401364, 1e-3);
  assert.ok(opt.worthRunning);
  assert.ok(!opt.atSweepEdge);
  // The marginal story agrees with the max story (unimodal curve): the last
  // cluster whose value exceeds its cost is the argmax.
  assert.equal(opt.lastWorthwhile, 33);
  close(opt.unitsPerDollar, 4 * GD, 1e-12);
  // Mark's stopping rule, explicitly: the marginal data point is judged
  // against the bar as a cash multiple. At the optimum the next cluster's
  // multiple straddles the bar, and mMultiple = bar·mv/mc identically.
  const iOpt = opt.curve.cT.indexOf(33);
  assert.ok(opt.curve.mMultiple[iOpt] >= 4, "cluster 33 clears the 4x bar");
  assert.ok(opt.curve.mMultiple[iOpt + 1] < 4, "cluster 34 falls below the 4x bar");
  close(opt.curve.mMultiple[10], (4 * opt.curve.mvUnits[10]) / opt.curve.mcUnits[10], 1e-9);
  // The whole study as a use of money: 8.3x cash at the optimum, vs the 4x bar.
  close(opt.avgMultiple, opt.voiUnits / (GD * opt.cost), 1e-9);
  close(opt.avgMultiple, 8.3007, 0.001);
  const netAt = (cT) => {
    const r = analyzeDesign({ ...params, cT, cC: cT });
    return r.decision.voiUnits - r.costUnits;
  };
  assert.ok(opt.netUnits >= netAt(opt.cT - 5));
  assert.ok(opt.netUnits >= netAt(opt.cT + 5));
  assert.equal(opt.curve.cT.length, 499); // 2..500
  // Marginal series: mv[i] = voi[i] − voi[i−1]; mc likewise; NaN at i=0.
  assert.ok(Number.isNaN(opt.curve.mvUnits[0]));
  close(opt.curve.mvUnits[10], opt.curve.voiUnits[10] - opt.curve.voiUnits[9], 1e-9);
  close(opt.curve.mcUnits[10], opt.curve.costUnits[10] - opt.curve.costUnits[9], 1e-9);
  // With decision inputs, sweep rows carry units.
  const rows = designSweep(params, [20, 40]);
  assert.ok(Number.isFinite(rows[0].net));
  assert.ok(Number.isFinite(rows[0].voiUnits));
});

test("optimalStudySize flags a rising curve at the search cap", () => {
  // Free clusters and children: more is always better, so the optimum pins
  // to cTMax and must be flagged rather than presented as interior.
  const opt = optimalStudySize({
    ...DEFAULTS, ...DECISION_ARGS, bar: 4,
    fixedCost: 0, costPerCluster: 0, costPerChild: 0,
  });
  assert.equal(opt.cT, 500);
  assert.ok(opt.atSweepEdge);
  assert.ok(opt.worthRunning);
});

test("bvnCdf propagates a non-finite correlation as NaN", () => {
  assert.ok(Number.isNaN(bvnCdf(0, 0, NaN)));
});

test("validation rejects priors whose harm end pushes treatment risk past 1", () => {
  const ui = {
    priorMeanR: 20, priorLoR: -80, priorHiR: 40, rateC: 400, rateT: 400,
    cT: 55, cC: 55, m: 1000, years: 1.5, icc: 0.001,
    fixedCost: 0, costPerCluster: 0, costPerChild: 0,
    grantSize: 0, bar: 4, ceBest: 6,
    alpha: 0.05, targetPower: 80, thresholdR: 5, gamma: 90,
  };
  // riskT = 0.6; harm end 0.6·1.8 = 1.08 ≥ 1.
  assert.ok(validateMortalityParams(toModelParams(ui)).some((e) => /harm end of your prior/.test(e)));
  // Best-guess overflow message takes precedence over the harm-end one.
  const errs = validateMortalityParams(toModelParams({ ...ui, priorMeanR: -80, priorLoR: -90, priorHiR: 10 }));
  assert.ok(errs.some((e) => /best-guess effect/.test(e)));
});

test("analyzeDesign wires the decision panel and its caveats", () => {
  const r = analyzeDesign({ ...DEFAULTS, ...DECISION_ARGS, bar: 4 });
  close(r.decision.pRightCall, 0.8670144834135105, 1e-9);
  close(r.decision.voiUnits, 47538.38615096267, 1e-3);
  close(r.costUnits, 2150000 * 4 * GD, 1e-9);
  assert.deepEqual(r.caveats, []);
  // grantSize 0 (the model default) → panel off, no caveat.
  assert.equal(analyzeDesign(DEFAULTS).decision, null);
  // Harm best guess with money at stake → caveat, panel off.
  const harm = analyzeDesign({
    ...DEFAULTS, ...DECISION_ARGS,
    priorMeanR: -0.05, priorLoR: -0.2, priorHiR: 0.1,
  });
  assert.equal(harm.decision, null);
  assert.ok(harm.caveats.includes("decisionNeedsBenefit"));
  // Breakeven unreachable → caveat, panel off.
  const far = analyzeDesign({ ...DEFAULTS, ...DECISION_ARGS, ceBest: 0.5 });
  assert.equal(far.decision, null);
  assert.ok(far.caveats.includes("barUnreachable"));
});
