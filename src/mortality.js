// Cluster-randomized all-cause mortality: frequentist power + Bayesian
// precision/conclusiveness. All closed-form — no Monte Carlo, no RNG.
// Pure ES module — runs in the browser, under `node --test`, and under jsc.
//
// Model summary
// -------------
// Outcome: death during follow-up. Baselines are entered as all-cause
//   mortality RATES (deaths per 1,000 child-years); with follow-up of
//   `years` per child the study-window risk is p = rate/1000 · years.
//   p_c  = control-arm risk;  p_t0 = treatment-arm risk if the program has
//   ZERO effect (usually = p_c). A relative reduction R (fraction, benefit
//   positive, harm negative) acts multiplicatively: p_t = p_t0 · (1 − R).
// Design: cT treatment clusters, cC control clusters, m children per
//   cluster, ICC rho. DEFF = 1 + (m−1)·rho; n_eff = c·m / DEFF per arm.
// Frequentist: two-sided unpooled z-test on the risk difference (both
//   rejection tails counted, so R = 0 returns exactly alpha).
// Bayesian: Normal prior on theta = log risk ratio fitted from a best guess
//   + 95% CI on the reduction; Normal likelihood for the observed log risk
//   ratio (delta method, se fixed at the prior-mean effect); conjugate
//   Normal–Normal update, so every preposterior quantity is closed-form.
//
// Verified against two independent Python implementations (closed-form and
// 500k-draw Monte Carlo) — see docs/mortality_method.md and
// tests/mortality.test.js benchmarks.

import { normalCdf } from "./math.js";

// ============================================================================
// Normal quantile (Acklam's rational approximation, |rel err| < 1.2e-9).
// Kept here rather than in math.js so the verified core stays untouched.
// ============================================================================
const ACKLAM_A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
  1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const ACKLAM_B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
  6.680131188771972e+01, -1.328068155288572e+01];
const ACKLAM_C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
  -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const ACKLAM_D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
  3.754408661907416e+00];

export function normQuantile(p) {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    throw new Error("normQuantile: p must be in (0,1)");
  }
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r, x;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q + ACKLAM_C[4]) * q + ACKLAM_C[5]) /
        ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    x = (((((ACKLAM_A[0] * r + ACKLAM_A[1]) * r + ACKLAM_A[2]) * r + ACKLAM_A[3]) * r + ACKLAM_A[4]) * r + ACKLAM_A[5]) * q /
        (((((ACKLAM_B[0] * r + ACKLAM_B[1]) * r + ACKLAM_B[2]) * r + ACKLAM_B[3]) * r + ACKLAM_B[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q + ACKLAM_C[4]) * q + ACKLAM_C[5]) /
         ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1);
  }
  return x;
}

// ============================================================================
// Design quantities
// ============================================================================

// Deaths per 1,000 child-years + follow-up years → risk over the window.
// Linear in exposure — fine for the small risks mortality studies live in;
// analyzeDesign validates the result stays inside (0, 1).
export function riskFromRate(ratePer1000, years) {
  return (ratePer1000 / 1000) * years;
}

export function designEffect(m, icc) {
  if (!(m >= 1)) throw new Error("children per cluster must be ≥ 1");
  if (!(icc >= 0 && icc < 1)) throw new Error("ICC must be in [0, 1)");
  return 1 + (m - 1) * icc;
}

export function designSummary({ cT, cC, m, icc }) {
  const deff = designEffect(m, icc);
  return {
    deff,
    nEffT: (cT * m) / deff,
    nEffC: (cC * m) / deff,
    nT: cT * m,
    nC: cC * m,
  };
}

// Between-cluster spread implied by the ICC at risk p (per arm):
//   sigma_b = sqrt(rho·p(1−p)) — SD of true cluster-level risks;
//   k = sigma_b / p = sqrt(rho·(1−p)/p) — Hayes & Bennett's CV of cluster
//   risks. Exact bridge for a binary outcome: rho = k²·p/(1−p).
export function clusterSpread(icc, p) {
  const sigmaB = Math.sqrt(Math.max(0, icc * p * (1 - p)));
  return { sigmaB, k: p > 0 ? sigmaB / p : NaN };
}

// ============================================================================
// Frequentist: two-sided unpooled z-test on the risk difference
// ============================================================================

function seDiff(pT, pC, nEffT, nEffC) {
  return Math.sqrt((pT * (1 - pT)) / nEffT + (pC * (1 - pC)) / nEffC);
}

// Power to detect relative reduction R at two-sided level alpha. Both
// rejection tails are counted, so R = 0 gives exactly alpha and harm
// (R < 0) needs no special-casing.
export function frequentistPower({ R, pT0, pC, nEffT, nEffC, alpha = 0.05 }) {
  const pT = pT0 * (1 - R);
  if (!(pT > 0 && pT < 1)) return NaN;
  const se = seDiff(pT, pC, nEffT, nEffC);
  const delta = pC - pT;
  const z = normQuantile(1 - alpha / 2);
  return normalCdf(-z + delta / se) + normalCdf(-z - delta / se);
}

// Minimum detectable relative reduction at the power target, by bisection on
// the exact two-tailed power (agrees with the one-tailed closed-form quadratic
// to ~5e-7 in R; bisection keeps the self-check `power(MDE) = target` exact).
export function minimumDetectableReduction({ pT0, pC, nEffT, nEffC, alpha = 0.05, power = 0.8 }) {
  const f = (R) => frequentistPower({ R, pT0, pC, nEffT, nEffC, alpha }) - power;
  let lo = 1e-6, hi = 1 - 1e-9;
  if (f(hi) < 0) return NaN; // unreachable even at total elimination
  if (f(lo) > 0) {
    // Only reachable with unequal baselines. When the treatment baseline is
    // WORSE than control (pT0 > pC), power is non-monotone in R: near R = 0
    // the test "detects" the baseline gap itself, power dips to exactly
    // alpha where the two risks coincide (R = 1 − pC/pT0), then rises again.
    // The meaningful MDE is the upward crossing beyond that dip.
    const rEq = 1 - pC / pT0;
    if (!(rEq > 0)) return lo; // treatment baseline ≤ control: MDE genuinely ~0
    lo = rEq; // f(rEq) = alpha − power < 0, so [rEq, hi] brackets the crossing
  }
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// Clusters needed for the power target at reduction R, holding m, icc and the
// allocation ratio A = cC/cT fixed. Closed form: with cC = A·cT,
//   SE² = (DEFF/(m·cT)) · [V_t + V_c/A], so
//   cT = (z_{1−α/2} + z_{power})² · DEFF · (V_t + V_c/A) / (m·Δ²).
// Returns ceil'd integers plus the power actually achieved at those counts.
export function requiredClusters({ R, pT0, pC, m, icc, alpha = 0.05, power = 0.8, ratio = 1 }) {
  const pT = pT0 * (1 - R);
  const delta = pC - pT;
  if (!(delta > 0)) return { cT: NaN, cC: NaN, cTExact: NaN, achievedPower: NaN };
  const deff = designEffect(m, icc);
  const K = normQuantile(1 - alpha / 2) + normQuantile(power);
  const cTExact =
    (K * K * deff * (pT * (1 - pT) + (pC * (1 - pC)) / ratio)) / (m * delta * delta);
  const cT = Math.max(2, Math.ceil(cTExact - 1e-9));
  const cC = Math.max(2, Math.ceil(ratio * cTExact - 1e-9));
  const d = designSummary({ cT, cC, m, icc });
  const achievedPower = frequentistPower({ R, pT0, pC, nEffT: d.nEffT, nEffC: d.nEffC, alpha });
  return { cT, cC, cTExact, achievedPower };
}

// Hayes & Bennett (1999) clusters per (equal) arm, from the rho-implied k's —
// a cross-check for EQUAL allocation only (do not compare against
// requiredClusters.cT when cC ≠ cT). H&B's
// implied design effect is 1 + m·rho (vs our exact 1 + (m−1)·rho) and they
// add +1 cluster as a rough degrees-of-freedom correction, so it runs
// slightly conservative.
export function hayesBennettPerArm({ R, pT0, pC, m, icc, alpha = 0.05, power = 0.8 }) {
  const pT = pT0 * (1 - R);
  const delta = pC - pT;
  if (!(delta > 0)) return NaN;
  const K = normQuantile(1 - alpha / 2) + normQuantile(power);
  const vT = pT * (1 - pT), vC = pC * (1 - pC);
  // k_j² p_j² = rho · V_j for a binary outcome.
  return 1 + (K * K * ((vT + vC) / m + icc * vT + icc * vC)) / (delta * delta);
}

// ============================================================================
// Bayesian: Normal prior on theta = log risk ratio, Normal–Normal update
// ============================================================================

const R_CLAMP = 0.999; // reductions ≥ 100% imply zero mortality — impossible

// Fit Normal(mu, tau²) on theta = log(1 − R) from a best-guess reduction and
// 95% CI, all as FRACTIONS (0.15 = 15% reduction; negative = harm). The map
// R → theta is strictly decreasing, so the CI endpoints flip. mu comes from
// the best guess and tau from the CI width alone; if the user's CI is
// asymmetric on the log scale, `impliedCI` (mu ± z·tau back-transformed) and
// `asymmetry` (|log-scale midpoint − best guess|, in fraction-of-R units)
// let the UI echo the distortion back.
export function priorOnLogRR({ mean, lo, hi, level = 0.95 }) {
  if (!(lo < mean && mean < hi)) throw new Error("require low < best guess < high");
  const clamped = mean >= R_CLAMP || hi >= R_CLAMP || lo >= R_CLAMP;
  const c = (R) => Math.min(R, R_CLAMP);
  const mu = Math.log(1 - c(mean));
  const thetaLo = Math.log(1 - c(hi)); // note the flip
  const thetaHi = Math.log(1 - c(lo));
  const z = normQuantile(0.5 + level / 2);
  const tau = Math.max((thetaHi - thetaLo) / (2 * z), 1e-6);
  const fittedMid = 1 - Math.exp(0.5 * (thetaLo + thetaHi));
  return {
    mu, tau, clamped,
    impliedCI: { lo: 1 - Math.exp(mu + z * tau), hi: 1 - Math.exp(mu - z * tau) },
    asymmetry: Math.abs(fittedMid - c(mean)),
    // Prior precision in data terms: a balanced two-arm study observing D
    // total deaths has se² ≈ 4/D on the log risk ratio, so the prior is
    // worth about 4/tau² observed deaths.
    equivalentDeaths: 4 / (tau * tau),
  };
}

// Delta-method SE of the observed log risk ratio, evaluated at the
// prior-mean effect (the design's central scenario; mildly conservative for
// beneficial priors because fewer treatment deaths mean less information).
export function seLogRR({ pT, pC, nEffT, nEffC }) {
  return Math.sqrt((1 - pT) / (nEffT * pT) + (1 - pC) / (nEffC * pC));
}

// Every closed-form Bayesian output. prior: {mu, tau}; se from seLogRR;
// thresholdR: the smallest reduction that matters (fraction); gamma: the
// posterior confidence demanded before calling the question settled.
export function bayesianSummary({ prior, se, thresholdR = 0, gamma = 0.9, level = 0.95 }) {
  const { mu, tau } = prior;
  const tau2 = tau * tau, se2 = se * se;
  const w = tau2 / (tau2 + se2);              // weight the data gets
  const postVar = (1 - w) * tau2;             // fixed before any data
  const postSd = Math.sqrt(postVar);
  const sigmaPm = Math.sqrt(w) * tau;         // preposterior sd of the posterior mean
  const z = normQuantile(0.5 + level / 2);

  // Credible-interval geometry on the reduction scale (fractions).
  // Typical post-study interval, centred at the prior mean:
  const expectedCI = { lo: 1 - Math.exp(mu + z * postSd), hi: 1 - Math.exp(mu - z * postSd) };
  // Exact preposterior expectation of the post-study interval width
  // (lognormal mean ⇒ the sigmaPm²/2 term), and today's interval width:
  const expectedWidthR =
    (Math.exp(z * postSd) - Math.exp(-z * postSd)) * Math.exp(mu + (sigmaPm * sigmaPm) / 2);
  const priorWidthR = (Math.exp(z * tau) - Math.exp(-z * tau)) * Math.exp(mu);

  // Conclusiveness. "Conclusive benefit" = posterior P(R > thresholdR) ≥ gamma
  //   ⇔ postMean ≤ thetaT − z_g·postSd, and preposterior postMean ~ N(mu, sigmaPm²).
  const thetaT = Math.log(1 - Math.min(thresholdR, R_CLAMP));
  const zG = normQuantile(gamma);
  const degenerate = sigmaPm < 1e-12; // no data weight: the prior alone decides
  const pConclusiveBenefit = degenerate
    ? (mu <= thetaT - zG * postSd ? 1 : 0)
    : normalCdf((thetaT - zG * postSd - mu) / sigmaPm);
  const pConclusiveNull = degenerate
    ? (mu >= thetaT + zG * postSd ? 1 : 0)
    : normalCdf((mu - thetaT - zG * postSd) / sigmaPm);
  const pConclusiveEither = pConclusiveBenefit + pConclusiveNull;
  const pInconclusive = Math.max(0, 1 - pConclusiveEither);

  // Is the question already settled by the prior alone?
  const priorPBeatsThr = normalCdf((thetaT - mu) / tau);
  const priorConclusiveBenefit = priorPBeatsThr >= gamma;
  const priorConclusiveNull = 1 - priorPBeatsThr >= gamma;

  return {
    w, postSd, sigmaPm,
    widthTheta: 2 * z * postSd,
    expectedCI, expectedWidthR, priorWidthR,
    pConclusiveBenefit, pConclusiveNull, pConclusiveEither, pInconclusive,
    priorPBeatsThr, priorConclusiveBenefit, priorConclusiveNull,
  };
}

// Assurance = preposterior probability the two-sided z-test on the log risk
// ratio comes back significant: theta_hat ~ N(mu, tau² + se²), significant
// iff |theta_hat| > z_a·se.
export function assurance({ prior, se, alpha = 0.05 }) {
  const { mu, tau } = prior;
  const zA = normQuantile(1 - alpha / 2);
  const preSd = Math.sqrt(tau * tau + se * se);
  const benefit = normalCdf((-zA * se - mu) / preSd);
  const harm = normalCdf((mu - zA * se) / preSd);
  return { benefit, harm, any: benefit + harm };
}

// ============================================================================
// Bivariate normal CDF (Genz's BVND, via Drezner–Wesolowsky), needed for the
// decision panel: the true effect theta and the post-study posterior mean are
// jointly normal with correlation sqrt(w).
// ============================================================================

const GL6_W = [0.1713244923791704, 0.3607615730481386, 0.4679139345726910];
const GL6_X = [0.9324695142031521, 0.6612093864662645, 0.2386191860831969];
const GL12_W = [0.04717533638651183, 0.10693932599531843, 0.16007832854334622,
  0.20316742672306592, 0.23349253653835481, 0.24914704581340277];
const GL12_X = [0.9815606342467192, 0.9041172563704749, 0.7699026741943047,
  0.5873179542866175, 0.3678314989981802, 0.1252334085114689];
const GL20_W = [0.017614007139152118, 0.04060142980038694, 0.06267204833410907,
  0.08327674157670475, 0.10193011981724044, 0.11819453196151842,
  0.13168863844917663, 0.14209610931838205, 0.14917298647260375, 0.15275338713072585];
const GL20_X = [0.9931285991850949, 0.9639719272779138, 0.9122344282513259,
  0.8391169718222188, 0.7463319064601508, 0.636053680726515,
  0.5108670019508271, 0.37370608871541956, 0.22778585114164507, 0.07652652113349734];

// P(X > dh, Y > dk) for standard bivariate normal with correlation r.
function bvnUpper(dh, dk, r) {
  const twopi = 2 * Math.PI;
  let x, w;
  if (Math.abs(r) < 0.3) { w = GL6_W; x = GL6_X; }
  else if (Math.abs(r) < 0.75) { w = GL12_W; x = GL12_X; }
  else { w = GL20_W; x = GL20_X; }
  let h = dh, k = dk, hk = h * k, bvn = 0;
  if (Math.abs(r) < 0.925) {
    if (Math.abs(r) > 0) {
      const hs = (h * h + k * k) / 2;
      const asr = Math.asin(r);
      for (let i = 0; i < x.length; i++) {
        for (const is of [-1, 1]) {
          const sn = Math.sin((asr * (is * x[i] + 1)) / 2);
          bvn += w[i] * Math.exp((sn * hk - hs) / (1 - sn * sn));
        }
      }
      bvn = (bvn * asr) / (2 * twopi);
    }
    return bvn + normalCdf(-h) * normalCdf(-k);
  }
  // |r| >= 0.925: Drezner–Wesolowsky asymptotic expansion.
  if (r < 0) { k = -k; hk = -hk; }
  if (Math.abs(r) < 1) {
    const as = (1 - r) * (1 + r);
    let a = Math.sqrt(as);
    const bs = (h - k) * (h - k);
    const c = (4 - hk) / 8;
    const d = (12 - hk) / 16;
    let asr = -(bs / as + hk) / 2;
    if (asr > -100) bvn = a * Math.exp(asr) * (1 - (c * (bs - as) * (1 - (d * bs) / 5)) / 3 + (c * d * as * as) / 5);
    if (-hk < 100) {
      const b = Math.sqrt(bs);
      bvn -= Math.exp(-hk / 2) * Math.sqrt(twopi) * normalCdf(-b / a) * b * (1 - (c * bs * (1 - (d * bs) / 5)) / 3);
    }
    a /= 2;
    for (let i = 0; i < x.length; i++) {
      for (const is of [-1, 1]) {
        const xs = (a * (is * x[i] + 1)) ** 2;
        const rs = Math.sqrt(1 - xs);
        asr = -(bs / xs + hk) / 2;
        if (asr > -100) {
          bvn += a * w[i] * Math.exp(asr) *
            (Math.exp((-hk * (1 - rs)) / (2 * (1 + rs))) / rs - (1 + c * xs * (1 + d * xs)));
        }
      }
    }
    bvn = -bvn / twopi;
  }
  if (r > 0) bvn += normalCdf(-Math.max(h, k));
  else {
    bvn = -bvn;
    if (k > h) bvn += normalCdf(k) - normalCdf(h);
  }
  return bvn;
}

// P(X ≤ h, Y ≤ k) for standard bivariate normal with correlation rho.
export function bvnCdf(h, k, rho) {
  if (!Number.isFinite(rho)) return NaN;
  if (!Number.isFinite(h) || !Number.isFinite(k)) {
    if (h === -Infinity || k === -Infinity) return 0;
    if (h === Infinity) return normalCdf(k);
    if (k === Infinity) return normalCdf(h);
  }
  return Math.max(0, Math.min(1, bvnUpper(-h, -k, rho)));
}

// ============================================================================
// The decision panel: what the study does to the grant call.
//
// CEA bridge (linear, transparent): cost-effectiveness in multiples of cash
// scales with the reduction, CE(R) = ceBest · R / R_best, so funding beats
// the next-best use exactly when R ≥ R* = R_best · ceAlt / ceBest.
//
// Decision rule after the study (Bayes-optimal for a payoff linear in R):
// fund iff the posterior EXPECTED reduction ≥ R*, i.e. theta_post ≤
// theta* − v_post/2 (the −v_post/2 converts the posterior median of RR to
// its mean). Jointly, (theta, theta_post) are bivariate normal with
// correlation sqrt(w), which gives every cell of the outcome table and the
// expected value of sample information in closed form.
// ============================================================================
export function decisionAnalysis({ prior, bayes, grantSize, ceBest, ceAlt, gd }) {
  const { mu, tau } = prior;
  const rBest = 1 - Math.exp(mu);
  if (!(rBest > 0) || !(ceAlt > 0) || !(ceBest > 0) || !(grantSize > 0) || !(gd > 0)) return null;

  // Breakeven: funding beats the next-best use iff CE(R) = ceBest·R/R_best
  // exceeds ceAlt, i.e. iff R ≥ R*.
  const rStar = (rBest * ceAlt) / ceBest;
  if (!(rStar < 1)) return { rStar, unreachable: true };
  const thetaStar = Math.log(1 - rStar);

  const { w, postSd, sigmaPm } = bayes;
  const vPost = postSd * postSd;
  const thetaCut = thetaStar - vPost / 2; // fund iff theta_post ≤ thetaCut
  const rho = Math.sqrt(Math.max(0, Math.min(1, w)));

  const h = (thetaStar - mu) / tau; // standardized "true effect clears the breakeven"
  const degenerate = sigmaPm < 1e-12;
  const k = degenerate ? (mu <= thetaCut ? Infinity : -Infinity) : (thetaCut - mu) / sigmaPm;

  const pTrueClears = normalCdf(h);
  const pGrant = degenerate ? (k === Infinity ? 1 : 0) : normalCdf(k);
  const pGR = degenerate ? (k === Infinity ? pTrueClears : 0) : bvnCdf(h, k, rho);
  const pGW = Math.max(0, pGrant - pGR);
  const pPW = Math.max(0, pTrueClears - pGR);
  const pPR = Math.max(0, 1 - pGrant - pTrueClears + pGR);
  const pRightCall = pGR + pPR;

  // Deciding today, with no study: fund iff prior E[R] ≥ R*.
  const meanR = 1 - Math.exp(mu + (tau * tau) / 2);
  const grantNow = meanR >= rStar;
  const pRightNow = grantNow ? pTrueClears : 1 - pTrueClears;

  // Value accounting, in GiveWell UNITS OF VALUE, measured relative to the
  // next-best use of the money (which earns G·ceAlt·gd units regardless):
  // funding at true reduction R gains kappaUnits·(R − R*), with
  //   kappaUnits = G · gd · ceBest / R_best   [units per unit of R].
  // Passing gains 0 by construction.
  const kappaUnits = (grantSize * gd * ceBest) / rBest;
  const fundValueBestUnits = grantSize * gd * ceBest; // absolute, at best guess
  const altValueUnits = grantSize * gd * ceAlt;       // absolute, next-best use

  // Per-cell expected contributions need E[(R − R*)·1{cell}], i.e. the
  // lognormal partial expectation E[e^theta·1{cell}] over each quadrant of
  // the joint. Exponential tilting by e^theta shifts the means by
  // (tau², Cov = w·tau²) and leaves the correlation unchanged:
  //   E[e^θ·1{θ≤a, θ_post≤b}] = M · Φ₂((a−μ−τ²)/τ, (b−μ−wτ²)/σ_pm, ρ),
  // with M = e^{μ+τ²/2}.
  const M = Math.exp(mu + (tau * tau) / 2);
  const hT = (thetaStar - mu - tau * tau) / tau;
  const kT = degenerate
    ? k // ±Infinity carries through
    : (thetaCut - mu - w * tau * tau) / sigmaPm;
  const eGR = degenerate ? (k === Infinity ? M * normalCdf(hT) : 0) : M * bvnCdf(hT, kT, rho);
  const eFund = degenerate ? (k === Infinity ? M : 0) : M * normalCdf(kT); // E[e^θ·1{fund}]
  const eClears = M * normalCdf(hT);                                       // E[e^θ·1{clears}]
  const eGW = Math.max(0, eFund - eGR);
  const ePW = Math.max(0, eClears - eGR);
  const ePR = Math.max(0, M - eFund - eClears + eGR);

  // units(cell) = kappaUnits · ( (1−R*)·P(cell) − E[e^θ·1{cell}] ).
  const cellUnits = (p, e) => kappaUnits * ((1 - rStar) * p - e);
  const cells = {
    grantRight: { p: pGR, units: cellUnits(pGR, eGR) },   // > 0: value won
    grantWrong: { p: pGW, units: cellUnits(pGW, eGW) },   // < 0: value destroyed by being misled
    // Pass rows contribute 0 relative to the next-best baseline; their
    // context numbers show what passing left on the table / dodged.
    passWrong: { p: pPW, units: 0, forgoneUnits: cellUnits(pPW, ePW) },   // > 0: value missed
    passRight: { p: pPR, units: 0, avoidedLossUnits: -cellUnits(pPR, ePR) }, // > 0: losses dodged
  };

  const evStudyUnits = cells.grantRight.units + cells.grantWrong.units;
  const evNowUnits = Math.max(0, kappaUnits * (meanR - rStar));
  // ≥ 0 in exact arithmetic (the rule is Bayes-optimal); clamped vs float noise.
  const voiUnits = Math.max(0, evStudyUnits - evNowUnits);

  return {
    rStar, thetaStar, kappaUnits, fundValueBestUnits, altValueUnits,
    pTrueClears, pGrant, grantNow, pRightNow, pRightCall,
    grantRight: pGR, grantWrong: pGW, passRight: pPR, passWrong: pPW,
    cells, meanR,
    evStudyUnits, evNowUnits, voiUnits,
  };
}

// Sweep treatment-cluster counts (control kept at the user's ratio) and find
// the study size that maximizes VoI minus study cost, both in UNITS OF VALUE.
// A study dollar's opportunity cost is bar-level grantmaking: cost_units =
// cost$ · bar · gd. Returns the optimum, the full curve, and the marginal
// series (extra units bought vs extra units spent by each additional
// treatment cluster) for the marginal plot and the "last worthwhile data
// point" readout.
export function optimalStudySize(params, { cTMax = 500 } = {}) {
  const {
    priorMeanR, priorLoR, priorHiR, rateT, rateC, years, m, icc,
    fixedCost = 0, costPerCluster = 0, costPerChild = 0,
    grantSize, ceBest, ceAlt, bar, gd,
  } = params;
  if (!(bar > 0) || !(gd > 0)) return null;
  const ratio = params.cC / params.cT;
  const prior = priorOnLogRR({ mean: priorMeanR, lo: priorLoR, hi: priorHiR });
  const pT0 = riskFromRate(rateT, years);
  const pCr = riskFromRate(rateC, years);
  const pT = pT0 * Math.exp(prior.mu);
  const unitsPerDollar = bar * gd;
  const curve = { cT: [], voiUnits: [], cost: [], costUnits: [], netUnits: [], mvUnits: [], mcUnits: [], mMultiple: [] };
  let best = null;
  for (let cT = 2; cT <= cTMax; cT++) {
    const cC = Math.max(2, Math.round(ratio * cT));
    const d = designSummary({ cT, cC, m, icc });
    const se = seLogRR({ pT, pC: pCr, nEffT: d.nEffT, nEffC: d.nEffC });
    const bayes = bayesianSummary({ prior, se });
    const dec = decisionAnalysis({ prior, bayes, grantSize, ceBest, ceAlt, gd });
    if (!dec || dec.unreachable) return null;
    const cost = studyCost({ cT, cC, m, fixedCost, costPerCluster, costPerChild });
    const costUnits = cost * unitsPerDollar;
    const netUnits = dec.voiUnits - costUnits;
    const n = curve.cT.length;
    curve.cT.push(cT);
    curve.voiUnits.push(dec.voiUnits);
    curve.cost.push(cost);
    curve.costUnits.push(costUnits);
    curve.netUnits.push(netUnits);
    // Marginal step: what the (cT)th treatment cluster (plus its controls)
    // buys and costs, and — the decision rule Mark specified — its
    // cost-effectiveness as a cash multiple, to be judged against the bar:
    //   mMultiple = (Δ VoI_units / Δ cost$) / gd.
    // Since Δcost_units = Δcost$·bar·gd, "mv ≥ mc" ⇔ "mMultiple ≥ bar":
    // marginal study dollars face the same bar as grant dollars.
    const mv = n === 0 ? NaN : dec.voiUnits - curve.voiUnits[n - 1];
    const mc = n === 0 ? NaN : costUnits - curve.costUnits[n - 1];
    curve.mvUnits.push(mv);
    curve.mcUnits.push(mc);
    curve.mMultiple.push(n === 0 ? NaN : mc > 0 ? (bar * mv) / mc : Infinity);
    if (best === null || netUnits > best.netUnits) {
      best = { cT, cC, voiUnits: dec.voiUnits, cost, costUnits, netUnits };
    }
  }
  // The last size at which the marginal data point still clears the bar
  // (equals the net-max for a unimodal curve; reported so the marginal story
  // and the max story can be shown side by side).
  let lastWorthwhile = null;
  for (let i = 1; i < curve.cT.length; i++) {
    if (curve.mvUnits[i] >= curve.mcUnits[i]) lastWorthwhile = curve.cT[i];
  }
  return {
    ...best,
    worthRunning: best.netUnits > 0,
    // >= cTMax − 1: with a non-integer control ratio, cC rounding makes the
    // net curve sawtooth by parity, which could otherwise park the argmax at
    // cTMax − 1 and mask a binding search window.
    atSweepEdge: best.cT >= cTMax - 1,
    lastWorthwhile,
    unitsPerDollar,
    // The whole study as a use of money, in cash multiples — compare to bar.
    avgMultiple: best.cost > 0 ? best.voiUnits / (gd * best.cost) : Infinity,
    curve,
  };
}

// ============================================================================
// Costs, deaths, and the full result bundle
// ============================================================================

export function studyCost({ cT, cC, m, fixedCost, costPerCluster, costPerChild }) {
  const clusters = cT + cC;
  return fixedCost + costPerCluster * clusters + costPerChild * clusters * m;
}

// Deaths: raw = what the study will actually observe (the grantmaker-facing
// number); effective = raw / DEFF (what the normal approximation runs on —
// drives the few-deaths caveat).
export function expectedDeaths({ R, pT0, pC, cT, cC, m, deff }) {
  const rawT = pT0 * (1 - R) * cT * m;
  const rawC = pC * cC * m;
  return { rawT, rawC, effT: rawT / deff, effC: rawC / deff };
}

// One call computing every number the page shows, plus caveat flags.
// Takes model units: prior as fractions, baselines as deaths per 1,000
// child-years, follow-up in years, costs in dollars.
export function analyzeDesign(params) {
  const {
    priorMeanR, priorLoR, priorHiR,
    rateT, rateC, years,
    cT, cC, m, icc,
    alpha = 0.05, targetPower = 0.8,
    thresholdR = 0, gamma = 0.9,
    fixedCost = 0, costPerCluster = 0, costPerChild = 0,
    grantSize = 0, bar = 0, ceBest = 0, ceAlt = 0, gd = 0,
  } = params;

  const pT0 = riskFromRate(rateT, years);
  const pC = riskFromRate(rateC, years);
  if (!(pT0 > 0 && pT0 < 1) || !(pC > 0 && pC < 1))
    throw new Error("baseline mortality × follow-up must give a risk strictly between 0 and 1");
  if (!(priorMeanR < 1))
    throw new Error("a best-guess reduction of 100% or more implies zero mortality — keep it below 100%");

  const design = designSummary({ cT, cC, m, icc });
  const prior = priorOnLogRR({ mean: priorMeanR, lo: priorLoR, hi: priorHiR });
  const pT = pT0 * Math.exp(prior.mu); // treatment risk at the prior-mean effect
  if (!(pT > 0 && pT < 1))
    throw new Error("at your prior's best guess, treatment-arm mortality would leave (0, 1000) per 1,000 — lower the harm end of the prior, the treatment baseline, or the follow-up");
  const spreadT = clusterSpread(icc, pT);
  const spreadC = clusterSpread(icc, pC);
  const se = seLogRR({ pT, pC, nEffT: design.nEffT, nEffC: design.nEffC });

  const power = frequentistPower({
    R: priorMeanR, pT0, pC, nEffT: design.nEffT, nEffC: design.nEffC, alpha,
  });
  const mde = minimumDetectableReduction({
    pT0, pC, nEffT: design.nEffT, nEffC: design.nEffC, alpha, power: targetPower,
  });
  const needed = requiredClusters({
    R: priorMeanR, pT0, pC, m, icc, alpha, power: targetPower, ratio: cC / cT,
  });
  const hbPerArm = hayesBennettPerArm({
    R: priorMeanR, pT0, pC, m, icc, alpha, power: targetPower,
  });
  const bayes = bayesianSummary({ prior, se, thresholdR, gamma });
  const assur = assurance({ prior, se, alpha });
  const cost = studyCost({ cT, cC, m, fixedCost, costPerCluster, costPerChild });
  const deaths = expectedDeaths({ R: priorMeanR, pT0, pC, cT, cC, m, deff: design.deff });
  const decision = decisionAnalysis({ prior, bayes, grantSize, ceBest, ceAlt, gd });
  const costUnits = bar > 0 && gd > 0 ? cost * bar * gd : null;

  const caveats = [];
  if (grantSize > 0 && !(priorMeanR > 0)) caveats.push("decisionNeedsBenefit");
  if (decision && decision.unreachable) caveats.push("barUnreachable");
  if (Math.min(cT, cC) < 15) caveats.push("fewClusters");
  if (Math.min(deaths.effT, deaths.effC) < 10) caveats.push("fewDeaths");
  if (prior.clamped) caveats.push("priorClamped");
  if (prior.asymmetry > 0.015) caveats.push("priorAsymmetric");
  if (rateT !== rateC) caveats.push("unequalBaselines");
  if (Math.max(spreadT.k, spreadC.k) > 0.5) caveats.push("highK");
  if (!Number.isFinite(mde)) caveats.push("mdeUnreachable");

  return {
    pT0, pC, pT, design, spreadT, spreadC, prior, se,
    power, mde, needed, hbPerArm, bayes, assurance: assur, cost, costUnits, deaths,
    decision: decision && decision.unreachable ? null : decision,
    caveats,
  };
}

// Design sweep for the table and plots: vary treatment clusters over
// `cTValues`, keeping the control:treatment ratio and everything else fixed.
export function designSweep(params, cTValues) {
  const ratio = params.cC / params.cT;
  return cTValues.map((cT) => {
    const cC = Math.max(2, Math.round(ratio * cT));
    const r = analyzeDesign({ ...params, cT, cC });
    return {
      cT, cC,
      children: (cT + cC) * params.m,
      power: r.power,
      pConclusive: r.bayes.pConclusiveEither,
      expectedWidthR: r.bayes.expectedWidthR,
      cost: r.cost,
      voiUnits: r.decision ? r.decision.voiUnits : null,
      net: r.decision && r.costUnits != null ? r.decision.voiUnits - r.costUnits : null,
    };
  });
}
