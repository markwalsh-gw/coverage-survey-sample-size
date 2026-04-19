import { test } from "node:test";
import assert from "node:assert/strict";
import {
  logGamma,
  logBeta,
  betaCdf,
  betaQuantile,
  betaPdf,
  betaMean,
  betaVariance,
  betaBinomialPmfArray,
  priorFromMeanCI,
  normalCdf,
  normalPdf,
  defaultHistogramBins,
  normalizeHistogram,
  histogramMean,
  histogramVariance,
  histogramFromBeta,
  histogramSample,
  mulberry32,
  makeNormalSampler,
} from "../src/math.js";

const close = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

test("logGamma matches factorials for small integers", () => {
  close(logGamma(1), 0);
  close(logGamma(2), 0);
  close(logGamma(3), Math.log(2), 1e-10);
  close(logGamma(5), Math.log(24), 1e-10);
  close(logGamma(10), Math.log(362880), 1e-9);
});

test("Beta(1,1) is Uniform(0,1)", () => {
  close(betaCdf(0.3, 1, 1), 0.3, 1e-9);
  close(betaCdf(0.77, 1, 1), 0.77, 1e-9);
  close(betaPdf(0.4, 1, 1), 1, 1e-12);
  close(betaMean(1, 1), 0.5);
  close(betaVariance(1, 1), 1 / 12);
});

test("Beta CDF symmetric when α = β", () => {
  close(betaCdf(0.5, 3, 3), 0.5, 1e-10);
  close(betaCdf(0.5, 17, 17), 0.5, 1e-10);
});

test("Beta quantile inverts Beta CDF", () => {
  for (const [a, b] of [[2, 5], [10, 10], [1, 1], [50, 20]]) {
    for (const p of [0.025, 0.1, 0.5, 0.9, 0.975]) {
      const x = betaQuantile(p, a, b);
      close(betaCdf(x, a, b), p, 1e-8);
    }
  }
});

test("logBeta matches logGamma identity", () => {
  close(logBeta(3, 4), logGamma(3) + logGamma(4) - logGamma(7), 1e-12);
});

test("Beta-Binomial PMF sums to 1", () => {
  for (const [n, a, b] of [[10, 1, 1], [25, 2, 8], [100, 3, 3], [50, 0.5, 0.5]]) {
    const pmf = betaBinomialPmfArray(n, a, b);
    close(pmf.reduce((s, p) => s + p, 0), 1, 1e-10);
  }
});

test("priorFromMeanCI round-trips a known Beta", () => {
  const a0 = 5, b0 = 15, mean = a0 / (a0 + b0);
  const lo = betaQuantile(0.025, a0, b0);
  const hi = betaQuantile(0.975, a0, b0);
  const { alpha, beta, kappa } = priorFromMeanCI(mean, lo, hi, 0.95);
  close(alpha / (alpha + beta), mean, 1e-6);
  close(kappa, a0 + b0, 0.1);
});

test("normalCdf matches reference values", () => {
  close(normalCdf(0), 0.5, 1e-7);
  close(normalCdf(1.96), 0.975, 1e-3);
  close(normalCdf(-1.96), 0.025, 1e-3);
  close(normalCdf(1), 0.8413447, 1e-5);
});

test("normalPdf integrates to ~1 over a wide window", () => {
  let s = 0;
  const dx = 0.01;
  for (let z = -10; z <= 10; z += dx) s += normalPdf(z) * dx;
  close(s, 1, 1e-3);
});

test("histogram mean and variance match analytic Beta moments via discretisation", () => {
  // Beta(2, 8): mean = 0.2, variance = 2*8 / (10^2 * 11) = 16 / 1100 ≈ 0.01454.
  const h = histogramFromBeta({ alpha: 2, beta: 8 }, defaultHistogramBins(200));
  close(histogramMean(h), 0.2, 1e-3);
  close(histogramVariance(h), 16 / 1100, 1e-4);
});

test("histogramSample inverse-CDF matches the histogram in distribution", () => {
  const h = normalizeHistogram({
    lower: [0, 0.25, 0.5, 0.75],
    upper: [0.25, 0.5, 0.75, 1.0],
    prob: [0.1, 0.2, 0.3, 0.4],
  });
  const rng = mulberry32(1);
  const counts = [0, 0, 0, 0];
  const N = 200_000;
  for (let i = 0; i < N; i++) {
    const x = histogramSample(h, rng);
    if (x < 0.25) counts[0]++;
    else if (x < 0.5) counts[1]++;
    else if (x < 0.75) counts[2]++;
    else counts[3]++;
  }
  for (let i = 0; i < 4; i++) close(counts[i] / N, h.prob[i], 0.01);
});

test("makeNormalSampler is approximately N(0,1)", () => {
  const rnorm = makeNormalSampler(mulberry32(42));
  let s = 0, s2 = 0;
  const N = 100_000;
  for (let i = 0; i < N; i++) { const z = rnorm(); s += z; s2 += z * z; }
  close(s / N, 0, 0.02);
  close(s2 / N, 1, 0.02);
});

test("mulberry32 is deterministic for a given seed", () => {
  const r1 = mulberry32(123), r2 = mulberry32(123);
  for (let i = 0; i < 10; i++) close(r1(), r2(), 0);
});
