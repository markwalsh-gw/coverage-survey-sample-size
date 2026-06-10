# Mapping to IDinsight's HKI_sampling_calculations.R

This file maps each step of IDinsight's R script (`docs/HKI_sampling_calculations.R`) to the corresponding piece of this web tool. Use it to verify the methodological correspondence — and to spot the deliberate simplifications.

## Step-by-step mapping

### Step 1: Study costs (R lines 13–24)

R fits a linear cost model `Total_Cost ~ N` from 4 historical cost points and pulls out `fixed_cost` and `marginal_cost_per_person`.

**Tool:** the user enters the fixed and per-interview costs directly (`fixedCost`, `costPerInterview`). We don't ask staff to refit a regression each time.

### Step 2: Project costs (R lines 26–35)

R defines a list of programs, each with `budget_upside` (if scaled up) and `budget_downside` (if scaled down). HKI: $28.4M / $5.4M.

**Tool:** these budgets are folded into the user-entered `V_up` and `V_down` (`vUp`, `vDown` in the form). Each combines budget × CE-pipeline × `gd_value_per_dollar` into a single per-unit-coverage value. See [`method.md`](method.md) for the algebra.

### Step 3: Empirical priors (R lines 37–73)

R reads two histogram priors from Google Sheets (counterfactual coverage and caseload-inflation adjustment), normalizes them to `(Lower_Bound, Upper_Bound, Cumulative_Prob)`, and exposes `sample_empirical_prior(n_sims, priors_df)` which inverse-CDFs into the bin and draws uniform within.

**Tool:** identical histogram structure (`{ lower, upper, prob }`), identical sampler (`histogramSample` in [`src/math.js`](../src/math.js)). Difference: only one prior — over coverage. Caseload-inflation uncertainty is collapsed away (see Step 5 below).

### Step 4: Cost-effectiveness (R lines 76–120)

R's `calculate_CE(counterfactual_coverage, sam_caseload, mam_caseload, inflation_adj)` runs the full mortality-and-treatment math: SAM/MAM caseloads × untreated mortality × mortality reduction → deaths averted → value-per-dollar → cash-CE multiple.

**Tool:** completely abstracted away. The user enters two numbers — `V_up` and `V_down` — that summarize "how much net value per unit coverage above threshold under each budget scenario." If you want the full pipeline, run the R script.

### Step 5: VoI simulation (R lines 122–200)

R's `simulate_voi_for_N(N, num_sims, program_budget, priors_df, priors_caseload_df)` does:

1. Draw `true_p` from the counterfactual-coverage prior.
2. Draw `sam_caseload`, `mam_caseload` (Normal × 30% CV), `inflation_adj` from its own prior, `lga_pop`, `catchment_prop` (Normal × 20–30% CV).
3. Compute `true_coverage_change` from those.
4. Draw `study_result ~ Normal(true_coverage_change, sqrt(p(1−p)/N))`.
5. Normal–Normal Bayes update on coverage_change.
6. Translate posterior coverage_change back to posterior counterfactual `posterior_p` for the CE math.
7. Run `calculate_CE` for true / posterior / prior-only worlds.
8. Compare `cash_CE` against `target_ce_bar = 8.0`.
9. Build utility lines under both decisions (scale_up vs scale_down) and compute `VoI = mean(utility_informed − utility_uninformed)`.

**Tool:** [`voiAtN`](../src/voi.js) does the analogous loop, simplified:

- Step 1 above → identical.
- Steps 2, 3, 6, 7 → all collapsed. We treat `p` itself as the decision variable; everything else is folded into `V_up`/`V_down`. Loss of fidelity in exchange for usability.
- Steps 4, 5 → identical Normal–Normal update with normal-approximated binomial likelihood. Prior moments come from the histogram analytically rather than empirically across sims.
- Steps 8, 9 → identical decision rule (`μ_post ≥ p*` for scale_up) and identical VoI definition.

### Step 6: Optimal sample size (R lines 202–264)

R sweeps `N = seq(100, 10000, by = 50)`, computes `current_voi`, then:

```
marginal_voi <- current_voi − prev_voi
marginal_cost <- step_size × marginal_cost_per_person   # (after first step)
marginal_roi <- marginal_voi / (marginal_cost × gd_value_per_dollar)
```

and picks the largest N where `marginal_roi >= target_roi` (8x).

**Tool:** [`optimalNByMarginalROI`](../src/voi.js) does the same. Differences:

- Cost is in dollars throughout (the user-supplied `V_up`/`V_down` are already in dollars), so no `gd_value_per_dollar` rescaling is needed.
- Default grid is `N = 100…5000 step 100` (50 grid points) for browser responsiveness; user can widen it.
- 20,000 MC sims per N by default vs IDinsight's 100,000. Bias is the same; variance is higher. User can crank `M` up if they want tighter point estimates.

## Deliberate omissions

CLAUDE.md says: "Exclude anything about incorporating other data." The R script does not have a data-fusion step itself, but the multi-input simulation (caseload, inflation, catchment) is the moral equivalent of "the survey informs only one thing while the CEA depends on five things." Mark explicitly chose to drop those extra stochastic inputs in the design conversation. If a future v2 wants them back, the structure is in [`voiAtN`](../src/voi.js) — just expand the per-sim block.

## Checking parity

To sanity-check that the tool's VoI matches what the R script produces:

1. Run `HKI_sampling_calculations.R` end-to-end with the published HKI parameters; capture `VoI` for, say, N ∈ {500, 1000, 2000, 5000}.
2. In the web tool, enter the HKI counterfactual-coverage histogram (paste bin probabilities), `p* = 0.5` (or whatever threshold the CE bar implies for coverage — you may need to back-solve), and `V_up / V_down` calibrated so that the prior-mean cash CE matches IDinsight's prior CE.
3. Read off `VoI(N)` from the VoI plot and compare.

The numbers won't be bit-exact (different MC seeds, lower M, simplified payoff), but should be in the same neighborhood. Large divergences point at either a calibration error in `V_up`/`V_down` or a missing piece of structure (most likely: the caseload/catchment uncertainty IDinsight carries through the CE pipeline).
