# Independent verification of the calculator's math (June 2026)

This note records how the numerical core was verified against references that
share no code with the implementation, and what now guards it in CI.

## What was checked, and against what

### 1. Special functions (`src/math.js`) — 123 independent checks

Run by executing the actual ES modules under macOS's JavaScriptCore (`jsc -m`)
and comparing against references computed in Python:

| Function | Independent reference | Agreement |
|---|---|---|
| `logGamma` | Python `math.lgamma` | ≤ 5e-13 relative |
| `betaCdf` (integer α, β) | Exact binomial-sum identity over `Fraction` rationals | ≤ 1e-12 |
| `betaCdf` (closed forms) | Arcsine law, power laws (Beta(½,½), Beta(3,1), Beta(1,4)) | ≤ 1e-12 |
| `betaCdf` (real α, β) | Composite 10-pt Gauss–Legendre integration of the pdf | ≤ 1e-10 |
| `betaQuantile` | Bisection on the exact rational CDF | ≤ 2e-9 |
| `betaBinomialPmf` | Exact rational arithmetic (factorials over `Fraction`) | ≤ 1e-12 |
| `normalCdf` | Python `math.erf` | ≤ 1.6e-7 (the A&S 7.1.26 approximation's documented bound) |
| `priorFromMeanCI` | Mean preserved to 1e-9; 95% interval coverage confirmed by independent quadrature to 5e-4 | ✓ |
| histogram moments | Closed-form piecewise-uniform moments | ≤ 1e-12 |
| `mulberry32` | Bit-exact uint32 reimplementation in Python | exact |
| Box–Muller sampler | First four moments of N(0,1) at n = 400,000 | ✓ |

### 2. VoI Monte Carlo (`src/voi.js`) — semi-analytic cross-check

Conditional on true coverage `p`, the survey result is Normal, so the
probability the posterior mean clears `p*` has a closed form and VoI(N)
reduces to a single quadrature over the prior. An independent Python
implementation of that quadrature was compared with `voiAtN` run at
M = 100,000 across 8 seeds:

| Config | Quadrature | MC mean | z-score |
|---|---|---|---|
| Default-like prior, N=200 | 12,092,611 | 12,074,479 | −0.57 |
| Default-like prior, N=1000 | 12,732,952 | 12,711,970 | −0.63 |
| Default-like prior, N=4000 | 12,864,865 | 12,846,442 | −0.56 |
| p* above prior mean | 700,207 | 701,916 | +0.41 |
| Bimodal prior | 4,066,594 | 4,069,220 | +0.39 |
| V_up = V_down | 0 | 0 (exactly) | — |

All within 1 standard error. `optimalNByMarginalROI`'s marginal-VoI /
marginal-cost arithmetic and its "largest N still clearing the hurdle" pick
were verified element-by-element against the definitions in IDinsight's R
script (`filter(Marginal_ROI >= target_roi) %>% tail(1)`).

### 3. CEA derivation (`src/cea.js`) — exact algebraic match to IDinsight

For HKI-like inputs, `vUp·(p − p*)` and `vDown·(p − p*)` reproduce the R
script's Step 8 utilities `B_d·(cash_CE(p) − target)·gd` (converted to
dollars) with max relative error 2.9e-16 — i.e. the affine forms agree in
both slope and intercept, not just up to a constant. The decision rule
(`posterior mean ≥ p*` ⟺ `cash_CE(posterior) ≥ target`) and the ROI ratio
(invariant to the units-of-value vs dollars choice) are equivalent to the R
script's by construction.

## Known edge behaviors (documented, judged acceptable)

- **`priorFromMeanCI` floors concentration at κ = 2.** If the stated 95%
  interval is wider than even Beta with κ=2 can honor (e.g. mean 0.5,
  CI [0.01, 0.99]), the returned prior holds *more* than 95% mass in the
  stated interval — slightly more confident than requested. Pinned by a test.
- **A zero-variance (point-mass) prior** would make the posterior-mean update
  0/0. Unreachable through the UI (every bin has width 0.05), noted here in
  case a future version accepts arbitrary histograms.
- **`normalCdf`** carries the A&S 7.1.26 error of ~1.5e-7 — irrelevant at
  Monte Carlo noise scales (~1e-3).

## What guards this in CI

`node --test tests/` (GitHub Actions, on every push/PR):

- `tests/math.test.js` — property tests plus exact rational reference values.
- `tests/voi.test.js` — VoI invariants (non-negativity, monotonicity in N,
  zero under no decision tension, determinism, cost accounting).
- `tests/voi.quadrature.test.js` — re-implements the semi-analytic quadrature
  in the test itself and requires the MC to agree within ~4 standard errors,
  plus a perfect-information upper-bound check.
- `tests/cea.test.js` — hand-checked closed forms and scaling laws.
- `tests/ui.test.js`, `tests/plots.test.js`, `tests/app.test.js` — UI layer
  (see below).

## UI layer testing

The UI is tested with a dependency-free DOM stub (`tests/helpers/dom.js`):
form read/write round-trips, histogram entry edge cases, currency/percent
formatting, recommendation copy paths, URL state round-trip, preset loading
(every preset must imply a valid decision with p* inside (0,1)), canvas
plotting (no NaN coordinate may ever reach the canvas), and an end-to-end
boot of `src/main.js` — init → URL params → CEA derivation → Monte Carlo →
plots → URL write-back, plus error-path and preset interactions.

## Reproducing the local verification

This machine has no Node; CI runs the suite with real `node --test`. Locally,
the same source modules were executed with macOS's built-in JavaScriptCore:

```sh
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m <module.js>
```

The Python reference scripts are one-off verification artifacts (not part of
the repo); the durable cross-checks they validated are encoded in the test
suite above.
