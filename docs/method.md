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

`V_up`/`V_down` collapse IDinsight's full CEA pipeline (mortality rates × lives saved × $/death × budget × `gd_value_per_dollar`) into a single per-unit-coverage value for each budget scenario. The user enters them directly. Trade-off: less transparent than the full pipeline, but vastly fewer inputs.

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
| Decision payoff | `B × (CE − target) × gd_value_per_dollar`, with two budgets | `V × (p − p*)`, with two values folding budget × CE-translation × gd into a single per-unit constant |
| Prior on coverage | Empirical histogram from a Google sheet | Same family (histogram), but seeded from a Beta(α,β) elicited from mean+CI by default |
| Survey design | Single endline | Single endline |
| Posterior update | Normal–Normal with precision weights | Same |
| MC sims per N | 100,000 | 20,000 default (browser performance) |
| Optimal-N rule | Largest N with marginal ROI ≥ 8x | Same |
| Multiple stochastic inputs | Coverage *plus* SAM/MAM caseload, inflation adj., LGA pop, catchment proportion | Coverage only; everything else collapsed into V_up/V_down |
| Cost model | `fixed + marginal × N`, fitted from 4 historical cost points | Same form, user enters fixed and marginal directly |
| Auxiliary data fusion | None (this tool intentionally excludes it; see CLAUDE.md) | None |

The CEA-pipeline collapse is the biggest concession to simplicity. If you want the full mortality-rate / lives-averted detail, run IDinsight's R script with your inputs. This tool is for when you want a defensible N quickly, with order-of-magnitude inputs.

## What this tool does NOT do (yet)

- **No multi-arm / cluster / stratified design** — the math assumes simple random sampling.
- **No continuous outcomes** — only proportions.
- **No baseline + endline** — single endline only (IDinsight's design). If you genuinely need a two-survey diff, file an issue.
- **No data fusion** — auxiliary surveys, administrative data, etc. are excluded by design.
- **No HDIs / tail probabilities** — outputs are decision-relevant (VoI, recommended N), not posterior summaries.
