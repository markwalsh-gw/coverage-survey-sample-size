// Cross-validates the Monte Carlo VoI against an INDEPENDENT semi-analytic
// computation. Conditional on true coverage p, the survey result is
// Normal(p, p(1−p)/N), so the probability the posterior mean clears p* has a
// closed form, and VoI(N) reduces to one quadrature over the prior:
//
//   postMean ≥ p*  ⟺  s ≥ sThresh = (p*(τ0+τs) − μ0·τ0)/τs
//   P_up(p) = 1 − Φ((sThresh − p)/sd)
//   VoI(N)  = ∫ f(p)·(p − p*)·[vUp·P_up(p) + vDown·(1 − P_up(p)) − vUninformed] dp
//
// Nothing below is imported from src/ except the function under test and the
// histogram constructor (input building only): the quadrature, the normal CDF,
// and the prior moments are all re-derived here. Agreement within a few MC
// standard errors is strong evidence the simulation implements the documented
// model. Tolerances are ≳4 standard errors at M = 60,000, and the seed is
// fixed, so the comparison is deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { voiAtN } from "../src/voi.js";
import { defaultHistogramBins, histogramFromBeta, normalizeHistogram } from "../src/math.js";

// --- independent machinery (no src/ code) ---------------------------------

// Φ via the complementary error function, Numerical Recipes erfc approximation
// (|rel err| < 1.2e-7 — different algorithm from src/math.js's A&S erf).
function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc = t * Math.exp(
    -x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))),
  );
  const half = erfc / 2;
  return z >= 0 ? 1 - half : half;
}

const GL_X = [
  -0.9739065285171717, -0.8650633666889845, -0.6794095682990244,
  -0.4333953941292472, -0.1488743389816312, 0.1488743389816312,
  0.4333953941292472, 0.6794095682990244, 0.8650633666889845,
  0.9739065285171717,
];
const GL_W = [
  0.0666713443086881, 0.1494513491505806, 0.2190863625159820,
  0.2692667193099963, 0.2955242247147529, 0.2955242247147529,
  0.2692667193099963, 0.2190863625159820, 0.1494513491505806,
  0.0666713443086881,
];

function histMoments(h) {
  let mu = 0, ex2 = 0;
  for (let i = 0; i < h.prob.length; i++) {
    const lo = h.lower[i], hi = h.upper[i];
    mu += h.prob[i] * 0.5 * (lo + hi);
    ex2 += h.prob[i] * (lo * lo + lo * hi + hi * hi) / 3;
  }
  return { mu, var: ex2 - mu * mu };
}

function voiQuadrature(h, N, pStar, vUp, vDown, subdiv = 8) {
  const { mu, var: v0 } = histMoments(h);
  const tau0 = 1 / v0;
  const vUninf = mu >= pStar ? vUp : vDown;
  let total = 0;
  for (let i = 0; i < h.prob.length; i++) {
    if (h.prob[i] === 0) continue;
    const lo = h.lower[i], hi = h.upper[i];
    const dens = h.prob[i] / (hi - lo);
    for (let k = 0; k < subdiv; k++) {
      const a = lo + ((hi - lo) * k) / subdiv;
      const b = lo + ((hi - lo) * (k + 1)) / subdiv;
      const mid = 0.5 * (a + b), half = 0.5 * (b - a);
      for (let j = 0; j < GL_X.length; j++) {
        const p = mid + half * GL_X[j];
        const sd = Math.sqrt((p * (1 - p)) / N);
        const taus = 1 / (sd * sd);
        const sThresh = (pStar * (tau0 + taus) - mu * tau0) / taus;
        const pUp = 1 - normCdf((sThresh - p) / sd);
        const g = (p - pStar) * (vUp * pUp + vDown * (1 - pUp) - vUninf);
        total += dens * GL_W[j] * half * g;
      }
    }
  }
  return total;
}

// --- the comparison --------------------------------------------------------

const priorA = histogramFromBeta({ alpha: 6, beta: 14 }, defaultHistogramBins(20));
const priorB = normalizeHistogram({
  ...defaultHistogramBins(20),
  prob: [0, 0, 1, 3, 6, 4, 2, 1, 0, 0, 1, 2, 4, 3, 1, 0, 0, 0, 0, 0],
});

const CONFIGS = [
  // Default-app-like values (prior mean 0.30 > p*: uninformed = scale up).
  { name: "default-like, N=1000", h: priorA, N: 1000, pStar: 0.2707, vUp: 5.912e8, vDown: 1.182e8, relTol: 0.015 },
  // Threshold above the prior mean (uninformed = scale down).
  { name: "p* above prior mean", h: priorA, N: 1000, pStar: 0.45, vUp: 2e8, vDown: 3e7, relTol: 0.035 },
  // Lumpy two-humped prior with the threshold between the humps.
  { name: "bimodal prior", h: priorB, N: 800, pStar: 0.5, vUp: 1e8, vDown: 2e7, relTol: 0.01 },
];

for (const c of CONFIGS) {
  test(`MC VoI matches independent quadrature: ${c.name}`, () => {
    const want = voiQuadrature(c.h, c.N, c.pStar, c.vUp, c.vDown);
    const { voi } = voiAtN({
      histogram: c.h, N: c.N, pStar: c.pStar, vUp: c.vUp, vDown: c.vDown,
      M: 60000, seed: 40326,
    });
    assert.ok(want > 0, "quadrature VoI should be positive here");
    const relErr = Math.abs(voi - want) / want;
    assert.ok(
      relErr < c.relTol,
      `MC ${voi.toExponential(4)} vs quadrature ${want.toExponential(4)}: rel err ${relErr.toExponential(2)} ≥ ${c.relTol}`,
    );
  });
}

test("VoI grows with N toward the quadrature's perfect-information limit", () => {
  const base = { histogram: priorA, pStar: 0.2707, vUp: 5.912e8, vDown: 1.182e8, M: 60000, seed: 40326 };
  const v200 = voiAtN({ ...base, N: 200 }).voi;
  const v4000 = voiAtN({ ...base, N: 4000 }).voi;
  assert.ok(v4000 > v200, "more interviews → more information");
  // Perfect information: decision matches the true p in every world.
  const { mu } = histMoments(priorA);
  const vUninf = mu >= 0.2707 ? base.vUp : base.vDown;
  let perfect = 0;
  for (let i = 0; i < priorA.prob.length; i++) {
    const lo = priorA.lower[i], hi = priorA.upper[i];
    const dens = priorA.prob[i] / (hi - lo);
    for (let k = 0; k < 40; k++) {
      const p = lo + ((hi - lo) * (k + 0.5)) / 40;
      const best = p >= 0.2707 ? base.vUp : base.vDown;
      perfect += dens * ((hi - lo) / 40) * (p - 0.2707) * (best - vUninf);
    }
  }
  assert.ok(v4000 < perfect * 1.02, "finite survey cannot beat perfect information");
  assert.ok(v4000 > perfect * 0.8, "N=4000 should capture most of the available value");
});
