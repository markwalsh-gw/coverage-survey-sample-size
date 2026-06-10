import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveDecisionParams } from "../src/cea.js";

const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

const baseline = {
  caseload: 10000,
  untreatedMortality: 0.1,
  mortalityReduction: 0.5,
  valPerDeath: 100,
  benefitAdjustment: 1.0,
  gdValuePerDollar: 0.005,
  annualBudget: 1_000_000,
  budgetUp: 20_000_000,
  budgetDown: 5_000_000,
  targetCashMultiple: 8,
};

test("deriveDecisionParams: hand-checked closed form", () => {
  // K = 10000 * 0.1 * 0.5 * 100 * 1 = 50_000 units of value per unit coverage.
  // dollarsPerCoverage = 50_000 / 0.005 = 10_000_000 $ per unit coverage.
  // pStar = 1_000_000 * 8 / 10_000_000 = 0.8.
  // vUp   = (20_000_000 / 1_000_000) * 10_000_000 = 2e8.
  // vDown = (5_000_000  / 1_000_000) * 10_000_000 = 5e7.
  const d = deriveDecisionParams(baseline);
  close(d.valuePerUnitCoverage, 50_000);
  close(d.dollarsPerCoverage, 10_000_000);
  close(d.pStar, 0.8);
  close(d.vUp, 2e8);
  close(d.vDown, 5e7);
});

test("deriveDecisionParams: V_up scales linearly with budgetUp", () => {
  const a = deriveDecisionParams({ ...baseline, budgetUp: 10_000_000 });
  const b = deriveDecisionParams({ ...baseline, budgetUp: 40_000_000 });
  close(b.vUp / a.vUp, 4, 1e-9);
  close(a.pStar, b.pStar); // threshold doesn't depend on budgetUp
});

test("deriveDecisionParams: p* is invariant to budgetUp / budgetDown", () => {
  const a = deriveDecisionParams(baseline);
  const b = deriveDecisionParams({ ...baseline, budgetUp: 50_000_000, budgetDown: 1_000_000 });
  close(a.pStar, b.pStar);
});

test("deriveDecisionParams: doubling caseload halves p*", () => {
  const a = deriveDecisionParams(baseline);
  const b = deriveDecisionParams({ ...baseline, caseload: 2 * baseline.caseload });
  close(b.pStar, a.pStar / 2);
});

test("deriveDecisionParams: rejects non-positive inputs", () => {
  assert.throws(() => deriveDecisionParams({ ...baseline, caseload: 0 }), /caseload/);
  assert.throws(() => deriveDecisionParams({ ...baseline, annualBudget: -1 }), /annualBudget/);
});

test("deriveDecisionParams: requires budgetUp > budgetDown", () => {
  assert.throws(
    () => deriveDecisionParams({ ...baseline, budgetUp: 1e6, budgetDown: 2e6 }),
    /budgetUp must exceed budgetDown/,
  );
});
