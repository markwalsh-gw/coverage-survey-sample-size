# Method notes

This document describes exactly what the tool computes and how it differs from IDinsight's source script (`HKI_sampling_calculations.R`). It is written for a colleague who has done a frequentist power calculation before and wants to understand the Bayesian VoI rationale without reading the code.

## What we're answering

You're designing a single coverage survey of size N to inform a binary GiveWell decision: **scale the program up** (allocate `B_up`) or **scale it down** (allocate `B_down`). The decision pivots on whether the true coverage parameter `p` exceeds a threshold `p*`.

Question: at what N do the *next* interviews stop earning their keep?

We pick the largest N where the marginal value-of-information per marginal dollar still clears a user-set ROI hurdle (default 8×, matching IDinsight's GiveWell-internal bar).

## The model

### Prior on coverage

`p ∈ [0, 1]` with a histogram prior on 20 evenly spaced bins of width 0.05. Two ways to enter it in the UI:

- **Mean + 95% CI** (default). The tool fits a Beta(α, β) by moment-matching with bisection on the concentration κ = α + β, then discretizes Beta(α, β) into the 20 bins.
- **Custom**. Set the probability mass per bin directly, in the "Edit bin probabilities" disclosure. Useful if your prior is bimodal, heavily skewed, or otherwise not Beta-shaped.

Sampling from the histogram: inverse-CDF on the bin probabilities, then uniform within the chosen bin (matches IDinsight's `sample_empirical_prior`).

### Decision payoff

`p` translates into one of two utility lines:

- scale_up: `U_up(p) = V_up · (p − p*)`
- scale_down: `U_down(p) = V_down · (p − p*)`

with `V_up > V_down ≥ 0`. The Bayes-optimal decision under any posterior with mean μ is **scale_up iff μ ≥ p\***, because (V_up − V_down)·(μ − p*) > 0 there.

`V_up`, `V_down`, and `p*` are **derived** from the user-entered CEA pipeline — the user does not enter them directly. See [`src/cea.js`](../src/cea.js).

### Deriving V_up, V_down, p* from the CEA pipeline

Inputs (all user-entered; generic placeholder defaults in the UI):

| Symbol | Field | Meaning |
|---|---|---|
| c | `caseload` | Eligible population (# at full coverage) |
| m | `untreatedMortality` | Mortality rate if untreated |
| r | `mortalityReduction` | Proportion of untreated deaths averted by treatment |
| v_d | `valPerDeath` | Value per death averted, in GiveWell's units of value (119 standard) |
| a | `benefitAdjustment` | Multiplier for non-mortality benefits + CEA adjustments (default 1.0) |
| gd | `gdValuePerDollar` | Units of value per $ (GiveDirectly anchor; 0.003355 standard) |
| A | `annualBudget` | Annual program cost |
| B_up | `budgetUp` | Multi-year commitment under scale-up |
| B_down | `budgetDown` | Multi-year commitment under scale-down |
| t | `targetCashMultiple` | Cash-CE bar (8× default) |

Pipeline (IDinsight `calculate_CE`, with coverage as the one stochastic input):

```
K              = c · m · r · v_d · a           [units of value per unit coverage]
total_value(p) = K · p                          [units of value]
value/$(p)     = K · p / A                      [value / $]
cash_CE(p)    = value/$(p) / gd                 [× cash]
```

Utility under each decision (IDinsight Step 8):

```
U_d(p) = B_d · (cash_CE(p) − t) · gd
       = (B_d / A) · K · p  −  B_d · t · gd     [units of value]
```

The slope w.r.t. `p` is converted from units of value to dollars (so [`voi.js`](../src/voi.js) can stay dollar-denominated) by dividing by `gd`:

```
V_d_$ = (B_d / A) · (K / gd)                    [$ per unit coverage]
```

The threshold `p*` is where U_up(p*) − U_down(p*) = 0, which (after the `B_up − B_down` factor cancels) reduces to:

```
p* = A · t · gd / K = A · t / (K / gd)           [dimensionless; must land in (0, 1)]
```

If the pipeline implies `p* ∉ (0, 1)` the tool errors out: either the CEA clears the bar at any coverage (no real decision) or can never clear it (the survey won't move the funding call).

### Survey

A single SRS coverage survey of size N. Per IDinsight, the sampling SE is `sqrt(p(1−p)/N)` and the survey result is treated as `Normal(true_p, SE²)` — i.e., normal approximation to the binomial. Posterior mean is the precision-weighted Normal–Normal update:

```
μ_post = (μ_prior · τ_prior + survey_result · τ_survey) / (τ_prior + τ_survey)
```

with `τ = 1/σ²`. Prior moments (`μ_prior`, `σ_prior²`) come from the histogram analytically.

### VoI by Monte Carlo

For each of M simulations (default 20,000):

1. Draw `true_p` from the histogram prior.
2. Draw `survey_result ~ Normal(true_p, true_p(1−true_p)/N)`.
3. Compute the posterior mean via the Normal–Normal update above.
4. **Informed decision**: scale_up if `μ_post ≥ p*`, else scale_down. Realized utility = chosen V × `(true_p − p*)`.
5. **Uninformed decision**: chosen once, before the survey, by the prior mean. Realized utility under that fixed decision in this simulation.

`VoI(N) = mean(U_informed) − mean(U_uninformed)`.

Reproducibility: Mulberry32 PRNG seeded with the user's `seed` field (default 40326, matching IDinsight's `set.seed(40326)`).

### Optimal N

Sweep N on a regular grid (`N_min`, `N_step`, …, `N_max`). For each N:

- `marginal_VoI[i] = VoI[i] − VoI[i−1]`  (and `VoI[0]` for the first point)
- `marginal_cost[i] = N_step × cost_per_interview`  (and `fixed_cost + N_min·cost` for the first point)
- `marginal_ROI[i] = marginal_VoI[i] / marginal_cost[i]`

`N* = max{ N[i] : marginal_ROI[i] ≥ target_ROI }`. If no grid point clears the hurdle, the tool reports "no recommended N" and you should either lower the target ROI or accept that the survey isn't worth running.

## How this differs from IDinsight's R script

| Feature | IDinsight's R script | This tool |
|---|---|---|
| Decision payoff | `B × (CE − target) × gd_value_per_dollar`, with two budgets | Same structure, derived inside the tool from the CEA pipeline inputs |
| CEA pipeline | Full: SAM/MAM caseload, inflation adj., LGA pop, catchment proportion, two mortality rates, two mortality-reduction rates, mortality-benefits share, supplemental adjustments | Simplified: single caseload, single mortality rate, single mortality-reduction rate, one benefit-adjustment factor. Everything else collapsed |
| Prior on coverage | Empirical histogram from a Google sheet | Same family (histogram), but seeded from a Beta(α,β) elicited from mean+CI by default |
| Survey design | Single endline | Single endline |
| Posterior update | Normal–Normal with precision weights | Same |
| MC sims per N | 100,000 | 20,000 default (browser performance) |
| Optimal-N rule | Largest N with marginal ROI ≥ 8x | Same |
| Multiple stochastic inputs | Coverage *plus* SAM/MAM caseload, inflation adj., LGA pop, catchment proportion | Coverage only; everything else treated as fixed |
| Cost model | `fixed + marginal × N`, fitted from 4 historical cost points | Same form, user enters fixed and marginal directly |
| Auxiliary data fusion | None (this tool intentionally excludes it; see CLAUDE.md) | None |

The CEA-pipeline collapse (one caseload and one mortality pair instead of IDinsight's SAM/MAM split) is the biggest concession to simplicity. For programs where that split matters, run IDinsight's R script directly. This tool is for when you want a defensible N quickly, with order-of-magnitude CEA inputs.

## What this tool does NOT do (yet)

- **No multi-arm / cluster / stratified design** — the math assumes simple random sampling.
- **No continuous outcomes** — only proportions.
- **No baseline + endline** — single endline only (IDinsight's design). If you genuinely need a two-survey diff, file an issue.
- **No data fusion** — auxiliary surveys, administrative data, etc. are excluded by design.
- **No HDIs / tail probabilities** — outputs are decision-relevant (VoI, recommended N), not posterior summaries.
