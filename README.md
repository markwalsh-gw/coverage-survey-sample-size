# Bayesian sample size for coverage surveys

A small browser tool for picking the sample size of a single coverage survey (CMAM, nets, SMC, VAS, vaccinations, water, …) using a **Bayesian value-of-information** calculation: keep adding interviews until the marginal value drops below a target ROI hurdle.

Adapted from the Bayesian VoI work IDinsight built for GiveWell's Nigeria CMAM coverage survey, simplified into a single page that any GiveWell staffer can open in a browser — no R, no Stan, no install.

## Use it

Open `index.html` in a browser (via a static server — see Develop), or visit the deployed GitHub Pages URL once it's set up. The page takes:

- a prior on coverage (mean + 95% CI, or a custom 20-bin histogram),
- a coverage threshold `p*` and the per-unit-coverage values under each budget scenario (`V_up`, `V_down`),
- a per-interview cost (and optional fixed survey cost),
- a target marginal ROI hurdle (default 8×, matching IDinsight),

and returns the largest sample size at which the next interviews still earn ≥ the target ROI, with VoI and marginal-ROI curves.

Inputs are encoded in the URL — copy the address bar to share a design.

## What it computes

See [`docs/method.md`](docs/method.md). Short version: histogram prior, single endline survey, Normal–Normal Bayes update on a normal-approximated binomial likelihood, asymmetric two-budget payoff, optimal N by marginal-ROI hurdle. Mapping to IDinsight's R script: [`docs/idinsight_method_notes.md`](docs/idinsight_method_notes.md).

## Develop

The site is pure ES modules — open `index.html` directly or serve the directory with any static server.

Tests use Node's built-in test runner (no npm dependencies):

```
node --test tests/
```

CI runs the same command on every push (see [`.github/workflows/test.yml`](.github/workflows/test.yml)).

## Status

v1 — single coverage parameter, single endline survey, asymmetric two-budget decision payoff, marginal-ROI optimal-N rule. Future: cluster sampling, continuous outcomes, per-program templates, baseline + endline diff. See [`CLAUDE.md`](CLAUDE.md) for the full roadmap and project context.

## Credit

Methodology follows IDinsight's Bayesian sample-size / VoI analysis for GiveWell's Nigeria CMAM coverage survey (HKI and IMC partners). Their R script is the reference implementation; this tool is a simpler, browser-native re-implementation of the same core idea.
