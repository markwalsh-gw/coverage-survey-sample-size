// Special functions and Beta / Binomial utilities.
// Pure ES module — runs in the browser and under `node --test`.

const LANCZOS_G = 7;
const LANCZOS_COEFS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function logGamma(x) {
  if (x < 0.5) {
    // reflection: Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS_COEFS[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_COEFS.length; i++) a += LANCZOS_COEFS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function logBeta(a, b) {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

export function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

// Regularized incomplete beta function I_x(a, b) via Lentz's continued fraction.
// Follows Numerical Recipes §6.4.
export function betaCdf(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt =
    logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) {
    return Math.exp(lbt) * betaContinuedFraction(x, a, b) / a;
  }
  return 1 - Math.exp(lbt) * betaContinuedFraction(1 - x, b, a) / b;
}

function betaContinuedFraction(x, a, b) {
  const MAX_ITER = 300;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) return h;
  }
  throw new Error("betaContinuedFraction: no convergence");
}

export function betaPdf(x, a, b) {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBeta(a, b));
}

// Quantile via bisection on the CDF. Good enough for UI use; ~40 iterations.
export function betaQuantile(p, a, b) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (betaCdf(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function betaMean(a, b) {
  return a / (a + b);
}

export function betaVariance(a, b) {
  return (a * b) / ((a + b) * (a + b) * (a + b + 1));
}

// Central credible interval width (not HDI — adequate for v1 UI).
export function betaCIWidth(a, b, level = 0.95) {
  const tail = (1 - level) / 2;
  return betaQuantile(1 - tail, a, b) - betaQuantile(tail, a, b);
}

// Beta-Binomial PMF: P(Y = y | n, a, b) = C(n,y) B(a+y, b+n-y) / B(a,b).
export function betaBinomialPmf(y, n, a, b) {
  if (y < 0 || y > n) return 0;
  return Math.exp(logChoose(n, y) + logBeta(a + y, b + n - y) - logBeta(a, b));
}

// Array of Beta-Binomial probabilities for y = 0..n. Sums to 1 up to float error.
export function betaBinomialPmfArray(n, a, b) {
  const out = new Array(n + 1);
  const lB = logBeta(a, b);
  for (let y = 0; y <= n; y++) {
    out[y] = Math.exp(logChoose(n, y) + logBeta(a + y, b + n - y) - lB);
  }
  return out;
}

// Elicit Beta(α, β) from a mean and a central credible interval.
// Strategy: moment-match to get a starting concentration κ = α + β, then
// bisect on κ so that the interval probability equals `level` exactly
// (mean is preserved throughout).
export function priorFromMeanCI(mean, lo, hi, level = 0.95) {
  if (!(mean > 0 && mean < 1)) throw new Error("mean must be in (0,1)");
  if (!(lo >= 0 && hi <= 1 && lo < mean && mean < hi))
    throw new Error("require 0 ≤ lo < mean < hi ≤ 1");
  const targetProb = level;
  const coverage = (kappa) => {
    const a = mean * kappa;
    const b = (1 - mean) * kappa;
    return betaCdf(hi, a, b) - betaCdf(lo, a, b);
  };
  // coverage is monotone increasing in κ (more concentrated around mean → more mass in any interval containing mean).
  let loK = 2, hiK = 1e6;
  // Expand if needed.
  while (coverage(hiK) < targetProb && hiK < 1e12) hiK *= 10;
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(loK * hiK); // geometric bisection — κ spans many orders of magnitude
    if (coverage(mid) < targetProb) loK = mid;
    else hiK = mid;
  }
  const kappa = Math.sqrt(loK * hiK);
  return { alpha: mean * kappa, beta: (1 - mean) * kappa, kappa };
}

// ============================================================================
// Normal distribution
// ============================================================================
export function normalPdf(z) {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

export function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

// ============================================================================
// Histogram prior on a coverage parameter in [0, 1].
//
// A Histogram is { lower:number[], upper:number[], prob:number[] } where prob
// must sum to 1 (within tol) and bins are non-overlapping. Inside each bin the
// density is uniform — matching IDinsight's `sample_empirical_prior`.
// ============================================================================

export function defaultHistogramBins(nBins = 20) {
  const lower = [], upper = [];
  for (let i = 0; i < nBins; i++) {
    lower.push(i / nBins);
    upper.push((i + 1) / nBins);
  }
  return { lower, upper };
}

export function normalizeHistogram(h) {
  const total = h.prob.reduce((s, p) => s + p, 0);
  if (!(total > 0)) throw new Error("histogram has zero total probability");
  return { ...h, prob: h.prob.map((p) => p / total) };
}

export function histogramMean(h) {
  let m = 0;
  for (let i = 0; i < h.prob.length; i++) m += h.prob[i] * 0.5 * (h.lower[i] + h.upper[i]);
  return m;
}

// E[p^2] for a piecewise-uniform histogram, then Var = E[p^2] − E[p]^2.
export function histogramVariance(h) {
  const m = histogramMean(h);
  let m2 = 0;
  for (let i = 0; i < h.prob.length; i++) {
    const a = h.lower[i], b = h.upper[i];
    // E[p^2 | uniform on [a,b]] = (a^2 + a*b + b^2) / 3
    m2 += h.prob[i] * (a * a + a * b + b * b) / 3;
  }
  return m2 - m * m;
}

// Build a histogram approximation of Beta(α, β) on the same bins.
// Useful for "elicit a histogram from mean + CI" UX.
export function histogramFromBeta({ alpha, beta }, bins = defaultHistogramBins(20)) {
  const prob = new Array(bins.lower.length);
  for (let i = 0; i < bins.lower.length; i++) {
    prob[i] = betaCdf(bins.upper[i], alpha, beta) - betaCdf(bins.lower[i], alpha, beta);
  }
  return normalizeHistogram({ lower: bins.lower, upper: bins.upper, prob });
}

// Inverse-CDF sample from histogram. `rng` is a no-arg function returning a
// uniform [0,1) draw — required so callers can seed it for reproducibility.
export function histogramSample(h, rng) {
  const u = rng();
  let cum = 0;
  for (let i = 0; i < h.prob.length; i++) {
    cum += h.prob[i];
    if (u <= cum) {
      // uniform within the chosen bin
      const v = rng();
      return h.lower[i] + v * (h.upper[i] - h.lower[i]);
    }
  }
  return h.upper[h.upper.length - 1];
}

// ============================================================================
// Seedable PRNG (mulberry32) and a Box–Muller normal sampler.
// JS's Math.random can't be seeded, and we want reproducible MC runs.
// ============================================================================
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNormalSampler(rng) {
  let cached = null;
  return function () {
    if (cached !== null) {
      const z = cached;
      cached = null;
      return z;
    }
    let u1 = rng(), u2 = rng();
    if (u1 < 1e-300) u1 = 1e-300;
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    cached = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}
