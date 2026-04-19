// Value-of-Information and optimal sample size for a single-survey coverage study
// feeding a CEA. Adapted from IDinsight's HKI_sampling_calculations.R; see
// docs/method.md and docs/idinsight_method_notes.md for the equation-by-equation
// mapping.
//
// Decision model (matches IDinsight, abstracted from the full CEA pipeline)
// ------------------------------------------------------------------------
// True coverage p ~ histogram prior. The CEA decision is binary:
//   • scale_up: utility = V_up · (p − p*)
//   • scale_down: utility = V_down · (p − p*)
// where V_up > V_down ≥ 0 are the per-unit-coverage values under each budget
// scenario. Optimal decision under posterior mean μ is:
//   • scale_up iff μ ≥ p*  (because (V_up − V_down)·(μ − p*) > 0 there).
//
// Survey: a single sample of size N estimates p with study_se = √(p(1−p)/N).
// Posterior mean is the precision-weighted average of the prior and the
// observed survey result (Normal–Normal update with Normal-approximated
// Binomial likelihood — exactly as IDinsight does it).
//
// VoI(N) = E[utility | informed (post-survey) decision] − E[utility | uninformed]
//
// Optimal N: largest N at which marginal_VoI(N) / marginal_cost(N) is still
// ≥ user-supplied target ROI hurdle (IDinsight default = 8x).

import {
  histogramMean,
  histogramVariance,
  histogramSample,
  mulberry32,
  makeNormalSampler,
} from "./math.js";

const EPS = 1e-9;

function clamp01(x) {
  if (x < EPS) return EPS;
  if (x > 1 - EPS) return 1 - EPS;
  return x;
}

/**
 * Single-N VoI by Monte Carlo. Returns expected VoI plus expected utility under
 * the informed and uninformed decision rules (useful for sanity-checking).
 *
 * @param {object} args
 * @param {object} args.histogram   prior on coverage p
 * @param {number} args.N           sample size
 * @param {number} args.pStar       decision threshold
 * @param {number} args.vUp         value per unit coverage under scale_up
 * @param {number} args.vDown       value per unit coverage under scale_down
 * @param {number} [args.M=20000]   number of MC sims
 * @param {number} [args.seed=40326] PRNG seed (matches IDinsight's set.seed)
 */
export function voiAtN({ histogram, N, pStar, vUp, vDown, M = 20000, seed = 40326 }) {
  if (N <= 0) return { voi: 0, uInformed: 0, uUninformed: 0 };
  const priorMean = histogramMean(histogram);
  const priorVar = histogramVariance(histogram);
  const priorPrec = 1 / priorVar;

  const rng = mulberry32(seed);
  const rnorm = makeNormalSampler(rng);

  // Uninformed decision is the same for every sim — chosen now under the prior.
  const uninformedUp = priorMean >= pStar;
  const uninformedV = uninformedUp ? vUp : vDown;

  let sumInformed = 0, sumUninformed = 0;
  for (let i = 0; i < M; i++) {
    const trueP = clamp01(histogramSample(histogram, rng));
    const sd = Math.sqrt((trueP * (1 - trueP)) / N);
    const surveyResult = trueP + sd * rnorm();
    const surveyPrec = 1 / (sd * sd);
    const postMean = (priorMean * priorPrec + surveyResult * surveyPrec) /
      (priorPrec + surveyPrec);
    const informedV = postMean >= pStar ? vUp : vDown;
    sumInformed += informedV * (trueP - pStar);
    sumUninformed += uninformedV * (trueP - pStar);
  }
  const uInformed = sumInformed / M;
  const uUninformed = sumUninformed / M;
  return { voi: uInformed - uUninformed, uInformed, uUninformed };
}

/**
 * Sweep N on a regular grid, return per-N VoI plus marginal-VoI / marginal-cost
 * / marginal-ROI series and the optimal N under the user's ROI hurdle.
 *
 * IDinsight uses seq(100, 10000, by = 50) and target ROI = 8x. Defaults match.
 *
 * @param {object} args
 * @param {object} args.histogram
 * @param {number} args.pStar
 * @param {number} args.vUp
 * @param {number} args.vDown
 * @param {number} args.costPerInterview
 * @param {number} [args.fixedCost=0]      one-off cost added to N=NMin only
 * @param {number} [args.targetROI=8]
 * @param {number} [args.NMin=100]
 * @param {number} [args.NMax=5000]
 * @param {number} [args.NStep=100]
 * @param {number} [args.M=20000]
 * @param {number} [args.seed=40326]
 */
export function optimalNByMarginalROI(args) {
  const {
    histogram, pStar, vUp, vDown,
    costPerInterview, fixedCost = 0, targetROI = 8,
    NMin = 100, NMax = 5000, NStep = 100,
    M = 20000, seed = 40326,
  } = args;

  const ns = [];
  for (let n = NMin; n <= NMax; n += NStep) ns.push(n);

  const vois = new Array(ns.length);
  const marginalVoi = new Array(ns.length);
  const marginalCost = new Array(ns.length);
  const marginalROI = new Array(ns.length);

  let prevVoi = 0;
  for (let i = 0; i < ns.length; i++) {
    const { voi } = voiAtN({ histogram, N: ns[i], pStar, vUp, vDown, M, seed });
    vois[i] = voi;
    if (i === 0) {
      marginalVoi[i] = voi;
      marginalCost[i] = fixedCost + ns[i] * costPerInterview;
    } else {
      marginalVoi[i] = voi - prevVoi;
      marginalCost[i] = (ns[i] - ns[i - 1]) * costPerInterview;
    }
    marginalROI[i] = marginalCost[i] > 0 ? marginalVoi[i] / marginalCost[i] : Infinity;
    prevVoi = voi;
  }

  // Largest N where marginal ROI is still ≥ hurdle (matches IDinsight's
  // `filter(Marginal_ROI >= target_roi) %>% tail(1)`).
  let nStarIdx = -1;
  for (let i = 0; i < ns.length; i++) {
    if (marginalROI[i] >= targetROI) nStarIdx = i;
  }

  return {
    ns,
    vois,
    marginalVoi,
    marginalCost,
    marginalROI,
    nStarIdx,
    nStar: nStarIdx >= 0 ? ns[nStarIdx] : null,
    voiAtNStar: nStarIdx >= 0 ? vois[nStarIdx] : null,
  };
}
