# Mortality study power tool — method notes

What `mortality.html` computes and why. Written for a colleague who has done a
frequentist power calculation before and wants to see every formula. The
implementation is `src/mortality.js`; regression tests pinning every number
are `tests/mortality.test.js`.

## What we're answering

You are designing a cluster-randomized study (villages or health zones
randomized, children followed) of a program's effect on **all-cause
mortality**, to inform a GiveWell funding decision. The page is a step-by-step
value calculation (①–⑥): what the decision looks like today, what the study
would measure, the four ways the post-study call can go (including the ways
noise misleads it), the expected units of value the study generates, its cost
in the same units, and the size at which the marginal data point stops paying
for itself. A conventional frequentist power calculation sits at the bottom
(⑦) as a sense-check.

Everything is closed-form: no simulation, no seed, results identical on every
recompute.

## Inputs and notation

| Symbol | UI field | Notes |
|---|---|---|
| `R` | best guess / 95% range for the mortality reduction | fractions internally; negative = harm |
| `rate_c`, `rate_t` | baseline mortality per 1,000 child-years, control / treatment | treatment baseline = what treatment areas would see with **zero** program effect |
| `y` | follow-up per child (years) | risk over the window: `p = rate/1000 · y` |
| `c_t`, `c_c` | treatment / control clusters | may be unequal; allocation ratio `A = c_c/c_t` |
| `m` | children per cluster | assumed equal across clusters |
| `ρ` | ICC of the death indicator | mortality ICCs are typically ~0.001–0.01 |
| `α`, target power | conventions (0.05, 80%) | two-sided |
| `G`, `bar`, `ce_best`, `ce_alt`, `gd` | the funding decision (card 5) | grant at stake; the bar; CE at best guess; CE of the next-best use; units per GiveDirectly $ |

Derived and always displayed:

- Design effect `DEFF = 1 + (m − 1)·ρ`; effective sample sizes `n_j = c_j·m / DEFF`.
- Between-cluster spread at risk `p`: SD of true cluster risks
  `σ_b = √(ρ·p(1−p))`, coefficient of variation `k = σ_b/p = √(ρ(1−p)/p)`
  (so `ρ = k²p/(1−p)` exactly, for a binary outcome). `k > 0.5` triggers a
  warning — larger between-cluster variation than cluster-RCT practice
  usually sees ([Hayes & Bennett 1999](https://academic.oup.com/ije/article-abstract/28/2/319/655247)
  report `k ≤ 0.25` as typical).
- Expected deaths per arm, raw (`p·c·m` — what the study observes) and
  effective (raw ÷ DEFF — what the approximations run on).

## The classical panel

Treatment risk under reduction `R`: `p_t = p_t0·(1 − R)`; risk difference
`Δ = p_c − p_t`; per-arm Bernoulli variances `V_j = p_j(1 − p_j)`.

**Power** of the two-sided unpooled z-test on the risk difference, both
rejection tails counted (so `R = 0` returns exactly `α`, and harm needs no
special case):

```
SE    = √( V_t/n_t + V_c/n_c )          (n_j = effective sizes)
Power = Φ(−z_{1−α/2} + Δ/SE) + Φ(−z_{1−α/2} − Δ/SE)
```

**Minimum detectable reduction**: bisection on `R` until `Power(R)` equals the
target (agrees with the closed-form quadratic solution to ~5·10⁻⁷; bisection
keeps `Power(MDE) = target` exact by construction). Returns NaN — rendered as
"not reachable" — when even a 100% reduction misses the target. With a
treatment baseline *worse* than control (`p_t0 > p_c`), power is non-monotone
in `R`: near `R = 0` the test "detects" the baseline gap itself, dips to
exactly `α` where the two risks coincide (`R = 1 − p_c/p_t0`), then rises.
The tool reports the upward crossing beyond that dip, so `Power(MDE) = target`
still holds.

**Clusters needed** at the best-guess `R`, holding `m`, `ρ`, and the
allocation ratio `A` fixed — with `K = z_{1−α/2} + z_{power}`:

```
c_t = K² · DEFF · (V_t + V_c/A) / (m · Δ²),   c_c = A·c_t   (both ceiled)
```

Defined only for `Δ > 0` (a harm-side best guess shows "—" on this card),
floored at 2 clusters per arm, and re-evaluated after ceiling so the page can
show the power actually achieved at the integer design.

This is the standard design-effect formulation (Donner & Klar). The
[Hayes & Bennett (1999)](https://academic.oup.com/ije/article-abstract/28/2/319/655247)
`k`-parameterization, computed from the ρ-implied `k`s, is used only as an
internal cross-check **for equal allocation**: their implied design effect is
`1 + m·ρ` (vs. the exact `1 + (m−1)·ρ`) plus one extra cluster per arm, so it
runs slightly conservative — the two agree within 1–2 clusters per arm in all
equal-arm test cases (it is not comparable to the per-arm counts of an
unequal design).

## The Bayesian panel

Everything runs on `θ = log(RR)`, `RR = 1 − R` (risk ratio). The map `R → θ`
is strictly decreasing, so the user's CI endpoints flip.

**Prior**: `θ ~ Normal(μ, τ²)` with `μ = log(1 − R_best)` and
`τ = (θ_hi − θ_lo) / (2·z₀.₉₇₅)` from the CI width (floored at `τ = 10⁻⁶` so a
degenerate CI cannot produce a zero-variance prior). If the user's CI is
asymmetric on the log scale, the implied CI is echoed back and a caveat shown
when the fitted midpoint drifts more than 1.5 points from the best guess.
Reductions ≥ 99.9% are clamped to 99.9% with a warning (RR = 0 is
unrepresentable); a best guess ≥ 100% is rejected outright, as is any prior
whose harm end would push the treatment risk to 1 or beyond. Transparency
readout: the prior carries the information of a balanced two-arm study
observing `≈ 4/τ²` deaths.

**Likelihood** (delta method for the log risk ratio, evaluated at the
prior-mean effect — mildly conservative for beneficial priors):

```
θ̂ ~ Normal(θ, se²),   se² = (1−p_t)/(n_t·p_t) + (1−p_c)/(n_c·p_c),
p_t = p_t0 · exp(μ)
```

**Conjugate update** (posterior variance is fixed before any data):

```
w        = τ²/(τ² + se²)          (the "data weight" card)
s_post²  = (1 − w)·τ²             (posterior variance)
σ_pm²    = w·τ²                    (preposterior variance of the posterior mean)
```

Note the clean decomposition `τ² = σ_pm² + s_post²`: prior variance = expected
resolution + remaining uncertainty.

**Expected credible interval.** On θ the 95% width is `2·z₀.₉₇₅·s_post`
deterministically. Back-transformed to percentage points of reduction, the
exact preposterior expectation (lognormal mean) is

```
E[width] = (e^{z·s_post} − e^{−z·s_post}) · e^{μ + σ_pm²/2}
```

shown next to today's prior width `(e^{z·τ} − e^{−z·τ})·e^{μ}`.

**Assurance** (chance of a significant result, averaged over the prior):
preposterior `θ̂ ~ Normal(μ, τ² + se²)`, significant iff `|θ̂| > z_{1−α/2}·se`:

```
assurance = Φ((−z_{1−α/2}·se − μ)/√(τ²+se²)) + Φ((μ − z_{1−α/2}·se)/√(τ²+se²))
```

(The classical power card uses the risk-difference scale; assurance uses the
log-RR scale for conjugacy. The two tests are asymptotically equivalent and
the scale choice moves the numbers by well under a percentage point in
realistic designs.)

**Probability of a conclusive answer** *(computed in the module and pinned by
tests; not currently surfaced on the page — the decision pipeline below is the
headline lens)*. "Conclusive benefit" means the
posterior ends at least `γ` sure the reduction beats `R_thr`; with
`θ_thr = log(1 − R_thr)` and the posterior mean preposterior-distributed as
`Normal(μ, σ_pm²)`:

```
P(conclusive benefit) = Φ( (θ_thr − z_γ·s_post − μ) / σ_pm )
P(conclusive not)     = Φ( (μ − θ_thr − z_γ·s_post) / σ_pm )
```

The two events are disjoint for `γ > 0.5`; their sum is the headline "chance
of a conclusive answer", and the complement is the chance the study leaves
you in between. Implementation guards: `R_thr` is clamped at 99.9% before
taking `log(1 − R_thr)`, and when `σ_pm < 10⁻¹²` (the survey carries no
weight) the two Φ's collapse to 0/1 indicators — the prior alone decides.
When the prior alone already meets the `γ` bar, an on-screen banner says so —
a strong prior can be "conclusive" with almost no data, and that should look
like a warning, not a result.

## Costs

`Total = fixed + (c_t + c_c)·(cost per cluster + m·cost per child)`.

## The value pipeline (steps ① – ⑥ on the page)

The study exists to improve one funding call, and its output is measured in
**GiveWell units of value** (dollars × cost-effectiveness in cash-multiples ×
`gd` = units per GiveDirectly dollar, 0.003355 standard). The page walks the
chain step by step; the formulas per step:

**① The decision today.** Grant `$G` rides on the call. Funding sends it to
the program; passing sends it to the next-best use at cost-effectiveness
`ce_alt` (usually just below the bar), worth `G·ce_alt·gd` units regardless
of the truth. The program's cost-effectiveness scales linearly with the true
reduction: `CE(R) = ce_best · R / R_best`, anchored at the user's estimate
`ce_best` at their best guess `R_best` (> 0 required). Funding therefore
beats passing exactly when `R ≥ R* = R_best · ce_alt / ce_best` (needs
`R* < 1`). Relative to always-passing, funding at true `R` is worth

```
κ·(R − R*) units,   κ = G · gd · ce_best / R_best
```

Deciding today: fund iff prior `E[R] = 1 − e^{μ+τ²/2} ≥ R*`, worth
`E[V_now] = max(0, κ·(E[R] − R*))` units in expectation.

**② What the study measures** is the Bayesian panel above: noise `se`, data
weight `w`, posterior sd `s_post` — precision is the only thing sample size
buys.

**③ The four outcomes.** After the study, fund iff the posterior expected
reduction beats `R*`: `θ_post ≤ θ_K = θ* − s_post²/2`, `θ* = log(1 − R*)`
(Bayes-optimal for the linear payoff). The true effect and the posterior
mean are jointly normal — `θ ~ N(μ, τ²)`, `θ_post ~ N(μ, σ_pm²)`,
correlation `ρ = √w` — so with `h = (θ*−μ)/τ`, `k = (θ_K−μ)/σ_pm` and `Φ₂`
the bivariate normal CDF (Genz BVND; exact-identity- and MC-tested):

```
P(fund, right)  = Φ₂(h, k, ρ)          P(fund, wrong) = Φ(k) − Φ₂(h, k, ρ)
P(pass, wrong)  = Φ(h) − Φ₂(h, k, ρ)   P(pass, right) = 1 − Φ(h) − Φ(k) + Φ₂(h, k, ρ)
```

Each cell also carries its expected value contribution
`κ·((1−R*)·P(cell) − E[e^θ·1{cell}])`, where the quadrant partial
expectation follows from exponential tilting — shifting the means by
`(τ², w·τ²)` and leaving ρ unchanged:

```
E[e^θ·1{θ≤a, θ_post≤b}] = e^{μ+τ²/2} · Φ₂((a−μ−τ²)/τ, (b−μ−wτ²)/σ_pm, ρ)
```

When `σ_pm < 10⁻¹²` (the study carries no weight) the cells collapse to the
prior-only decision, mirroring the Bayesian-panel guard, and cells are
clamped at 0 against float noise like the VoI clamp below.

The two fund rows are real gains/losses; the two pass rows contribute 0
relative to the next-best baseline, and their context numbers (value left
unclaimed when misled into passing; losses dodged when passing rightly) are
the same formula on their quadrants. The four pieces satisfy the exact
identity: fund-right + fund-wrong + pass-wrong-forgone − pass-right-avoided
= `κ·(E[R] − R*)`.

**④ Value of the study (gross).** `E[V_study] =` the two fund rows summed
(equivalently `κ·(E[R·1{fund}] − R*·P(fund))`), and
`VoI = E[V_study] − E[V_now]` units — ≥ 0 in exact arithmetic because the
post-study rule is Bayes-optimal (clamped at 0 against float noise).

**⑤ Cost in the same units.** A study dollar could otherwise fund bar-level
grantmaking: `cost_units = cost$ · bar · gd`. Net value = VoI − cost_units.

**⑥ Optimal size.** Sweep treatment clusters 2…500 (controls at the user's
ratio, all else fixed). The stopping rule, per Mark's specification: judge
each marginal increase in sample size **against the bar**. The next
cluster's cost-effectiveness as a cash multiple is

```
mMultiple = (Δ VoI_units / Δ cost$) / gd     — keep growing while ≥ bar
```

which is algebraically identical to "marginal units bought ≥ marginal units
spent" (since Δcost_units = Δcost$·bar·gd): study dollars face the same bar
as grant dollars. Two equivalent views are shown — the marginal multiple
plotted against the bar line (recommended size = the crossing), and the
cumulative net-value curve (recommended size = the peak); for a unimodal
curve they coincide, and both are computed and reported, along with the whole
study's average multiple `VoI_units/(gd·cost$)`. Controls are rounded to the
nearest integer at the user's ratio (floor 2), which can make the marginal
series sawtooth under non-integer ratios; the reported size is the last
cluster whose marginal multiple clears the bar (it equalled the net argmax in
every test configuration). If no size clears the bar the tool says so:
better information is worth less than any study costs at these stakes.

**⑦ Frequentist sense-check.** The same design run through the conventional
lens (power at the best guess, MDE, clusters for target power, from the
classical panel above), with an auto-generated comparison sentence. The two
lenses answer different questions — significance vs. decision value — so a
gap between "clusters for 80% power" and the value-optimal size is
informative, not an error: with a strong prior or modest stakes the value
lens accepts less certainty; with huge stakes it can demand more.

Deliberate simplifications: cost-effectiveness linear in `R` through zero
(no fixed program benefits); a single up-or-out grant decision (no partial
sizing); `ce_best` and `ce_alt` supplied by the user rather than derived
from a full CEA pipeline; study dollars priced at the bar.

## Verification

- The frequentist formulas were implemented independently in Python
  (`math.erf` only) by a design-phase agent; the app's numbers match to
  ≤ 5·10⁻⁷ (the documented error bound of the app's normal-CDF
  approximation, A&S 7.1.26). The ρ = 0 case is bit-identical to the plain
  two-proportion z-test and reproduces the canonical n ≈ 385/arm for
  detecting 0.5 vs 0.6 at 80% power.
- The Bayesian closed forms were verified two independent ways: an exact
  Python implementation and a 500,000-draw Monte Carlo of the full generative
  pipeline (draw θ from the prior, θ̂ from the likelihood, update, evaluate
  every event). All 25 comparisons agreed within |z| ≤ 1.24 MC standard
  errors. The identity `τ² = σ_pm² + s_post²` holds to machine precision.
- `tests/mortality.test.js` pins all of these as regressions, plus in-suite
  Monte Carlo cross-checks using the app's own seeded RNG.

## Deliberate v1 simplifications

1. Mortality is a **risk over the window** (`rate × years`), not a survival
   model — no censoring, migration, or exact person-time. Fine for the small
   risks these studies live in; the deaths-count caveat guards the edge.
2. Equal cluster sizes; a single ICC shared by both arms.
3. Normal approximations throughout; **no small-sample t-correction**. Below
   ~15 clusters per arm an on-screen caveat calls all numbers a best case.
   Expected effective deaths < 10 in an arm triggers a separate caveat.
4. The unpooled z-test, no covariate adjustment or matching (matched designs
   do somewhat better than shown).
5. Unequal baselines are passed straight into `Δ` — the test cannot
   distinguish baseline imbalance from a program effect (flagged on screen).
6. `se` is a fixed design constant; that is what keeps the model conjugate.
7. No attrition inflation — inflate `m` manually if you expect loss to
   follow-up.

## Sources not verified

The Hayes & Bennett (1999) comparison formula and its "k ≤ 0.25 typical"
guidance come from the design agent's knowledge of the literature; the
[published paper](https://academic.oup.com/ije/article-abstract/28/2/319/655247)
is paywalled and was **not** re-checked against the original PDF. The formula
was confirmed self-consistent against the exact binary-outcome variance
decomposition (the relation `c_HB = 1 + c_DEFF·(1+mρ)/(1+(m−1)ρ)` holds
analytically), and it appears only as a transparency cross-check, never in a
headline number. See also the methods review by
[Rutterford, Copas & Eldridge (2015)](https://academic.oup.com/ije/article/44/3/1051/632956).
