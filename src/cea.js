// Derive the decision-relevant parameters (V_up, V_down, p*) from the
// underlying CEA inputs. Replaces direct user entry of those three quantities,
// so staff don't need to do back-of-envelope CEA math themselves.
//
// Algebra
// -------
// Let
//   K = caseload · untreatedMortality · mortalityReduction · valPerDeath · benefitAdjustment
//                                                                  [units of value per unit coverage]
// Then per IDinsight's calculate_CE pipeline (with annual program budget A):
//   total_value(p)        = K · p                      [units of value]
//   value_per_dollar(p)   = K · p / A                  [value/$]
//   cash_CE(p)            = (K · p) / (A · gd)         [dimensionless × cash]
//
// Decision payoff (IDinsight Step 8) — scale-up and scale-down differ only in
// which multi-year budget B gets allocated:
//   utility_d(p) = B_d · (cash_CE(p) − target) · gd
//                = B_d · (K · p / (A · gd) − target) · gd
//                = (B_d / A) · K · p − B_d · target · gd                  [value]
//
// The slope per unit coverage is V_d = (B_d / A) · K.  We convert to dollars
// (so voi.js can keep its dollar-denominated arithmetic) by dividing by gd:
//   V_d_$  = (B_d / A) · (K / gd)                                          [$ per unit coverage]
//
// The threshold p* solves utility_up(p*) = utility_down(p*); since the two
// utilities differ only in their slope and intercept (both proportional to B_d),
// this collapses to:
//   p* = A · target · gd / K  (equivalently: A · target / dollarsPerCoverage)
//
// where dollarsPerCoverage = K / gd.

export function deriveDecisionParams({
  caseload,
  untreatedMortality,
  mortalityReduction,
  valPerDeath,
  benefitAdjustment,
  gdValuePerDollar,
  annualBudget,
  budgetUp,
  budgetDown,
  targetCashMultiple,
}) {
  const positive = (name, x) => {
    if (!(x > 0)) throw new Error(`${name} must be > 0 (got ${x}).`);
  };
  positive("caseload", caseload);
  positive("untreatedMortality", untreatedMortality);
  positive("mortalityReduction", mortalityReduction);
  positive("valPerDeath", valPerDeath);
  positive("benefitAdjustment", benefitAdjustment);
  positive("gdValuePerDollar", gdValuePerDollar);
  positive("annualBudget", annualBudget);
  positive("targetCashMultiple", targetCashMultiple);
  if (!(budgetUp > budgetDown && budgetDown >= 0)) {
    throw new Error("budgetUp must exceed budgetDown (and budgetDown ≥ 0).");
  }

  const valuePerUnitCoverage =
    caseload * untreatedMortality * mortalityReduction * valPerDeath * benefitAdjustment;
  const dollarsPerCoverage = valuePerUnitCoverage / gdValuePerDollar;
  const vUp = (budgetUp / annualBudget) * dollarsPerCoverage;
  const vDown = (budgetDown / annualBudget) * dollarsPerCoverage;
  const pStar = (annualBudget * targetCashMultiple) / dollarsPerCoverage;

  return { vUp, vDown, pStar, dollarsPerCoverage, valuePerUnitCoverage };
}
