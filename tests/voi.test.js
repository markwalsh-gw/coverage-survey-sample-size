import { test } from "node:test";
import assert from "node:assert/strict";
import { voiAtN, optimalNByMarginalROI } from "../src/voi.js";
import { defaultHistogramBins, histogramFromBeta, normalizeHistogram } from "../src/math.js";

const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

const moderatePrior = histogramFromBeta(
  { alpha: 6, beta: 14 }, // mean 0.30, sd ≈ 0.10
  defaultHistogramBins(40),
);

test("VoI ≥ 0 for any reasonable inputs", () => {
  for (const N of [100, 500, 2000]) {
    for (const pStar of [0.1, 0.3, 0.5, 0.7]) {
      const { voi } = voiAtN({
        histogram: moderatePrior, N, pStar,
        vUp: 1e8, vDown: 2e7, M: 5000, seed: 1,
      });
      assert.ok(voi >= -1e-3, `VoI negative (within MC noise) at N=${N}, p*=${pStar}: ${voi}`);
    }
  }
});

test("VoI ≈ 0 when V_up == V_down (no decision tension)", () => {
  const { voi } = voiAtN({
    histogram: moderatePrior, N: 1000, pStar: 0.4,
    vUp: 1e8, vDown: 1e8, M: 5000, seed: 1,
  });
  // With identical payoffs the informed and uninformed decisions coincide.
  close(voi, 0, 1e-6);
});

test("VoI is non-decreasing in N (within MC noise)", () => {
  const args = { histogram: moderatePrior, pStar: 0.35, vUp: 1e8, vDown: 2e7, M: 8000, seed: 7 };
  let prev = -Infinity;
  for (const N of [100, 500, 1500, 3000, 6000]) {
    const { voi } = voiAtN({ ...args, N });
    // Allow a small MC slack; the underlying expectation is monotone.
    assert.ok(voi >= prev - 0.02 * Math.abs(prev) - 1e-2,
      `VoI dropped at N=${N}: ${voi} < ${prev}`);
    prev = voi;
  }
});

test("VoI is 0 when prior is a point mass on either side of the threshold", () => {
  // Point-mass prior: all probability in a single bin near 0.8 → never crosses p* = 0.4.
  const h = normalizeHistogram({
    lower: [0.79, 0.80], upper: [0.80, 0.81], prob: [0.5, 0.5],
  });
  const { voi } = voiAtN({
    histogram: h, N: 1000, pStar: 0.4,
    vUp: 1e8, vDown: 2e7, M: 5000, seed: 3,
  });
  close(voi, 0, 1e-2);
});

test("optimalNByMarginalROI is deterministic for a fixed seed", () => {
  const args = {
    histogram: moderatePrior, pStar: 0.35, vUp: 1e8, vDown: 2e7,
    costPerInterview: 200, targetROI: 8,
    NMin: 100, NMax: 1000, NStep: 100, M: 4000, seed: 99,
  };
  const a = optimalNByMarginalROI(args);
  const b = optimalNByMarginalROI(args);
  assert.deepEqual(a.vois, b.vois);
  assert.equal(a.nStar, b.nStar);
});

test("optimalNByMarginalROI returns largest N meeting the ROI hurdle", () => {
  // Hand-craft synthetic marginal ROI by setting a very low costPerInterview
  // so most steps clear the hurdle.
  const r = optimalNByMarginalROI({
    histogram: moderatePrior, pStar: 0.35, vUp: 1e8, vDown: 2e7,
    costPerInterview: 1, targetROI: 0,    // ROI ≥ 0 always passes
    NMin: 100, NMax: 1000, NStep: 100, M: 4000, seed: 5,
  });
  assert.equal(r.nStar, 1000); // last grid point
});

test("optimalNByMarginalROI returns null nStar if hurdle never met", () => {
  const r = optimalNByMarginalROI({
    histogram: moderatePrior, pStar: 0.35, vUp: 1e8, vDown: 2e7,
    costPerInterview: 1e9, targetROI: 8,  // wildly expensive interviews
    NMin: 100, NMax: 1000, NStep: 100, M: 4000, seed: 5,
  });
  assert.equal(r.nStar, null);
});
