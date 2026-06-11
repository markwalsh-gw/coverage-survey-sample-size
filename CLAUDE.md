# Bayesian Power Calculator — CLAUDE.md

This file defines the goals, context, and workflows for Claude acting on the Bayesian Power Calculator project. **Update this file whenever new patterns, preferences, or project context are learned.**

---

## Project Goal

Build a **Bayesian sample size / power calculation tool**, packaged as a **web app that any GiveWell staff member can use** for coverage surveys and other M&E studies — without needing to write R or Stan code.

The tool should extend and generalize the Bayesian sample size / Value of Information (VoI) work IDinsight did for GiveWell on the Nigeria CMAM coverage survey (HKI and IMC partners).

---

## About Mark

- **Role**: Researcher, GiveWell Cross-Cutting (CC) team
- **Email**: mark.walsh@givewell.org
- **Background**: PhD in economics — econometrics, causal inference, survey methodology, Bayesian methods. Comfortable with R, Stan, Python.
- **Why this project**: M&E coverage surveys across GiveWell top programs (nets, SMC, VAS, CMAM, vaccinations, water) repeatedly need sample size decisions. Frequentist rules of thumb are often poorly matched to the decision question ("will we learn enough to update our cost-effectiveness model?"). A shared Bayesian VoI-style tool would let staff plug in their priors, decision thresholds, and cost constraints and get a defensible sample size recommendation.

---

## Source Material (IDinsight's prior work)

These are the primary reference artifacts — start here before designing the tool.

| Artifact | Type | Drive ID |
|---|---|---|
| IDinsight `HKI_sampling_calculations.R` (R script with the core simulation / Bayesian sample size logic) | R script | `1t2h6hs_eFj8sBbxtvRHBpLm00bL74Q9B` |
| [UPDATED] GiveWell CMAM Coverage Survey — VoI Analysis (main write-up) | Google Doc | `19zsQrY7wqFi2SNy2sLp1Q4NEqe0GnM9lEOKrEd3RLQw` |
| [SHARED] GiveWell CMAM Coverage Survey — VoI Analysis (earlier shared version) | Google Doc | `1j9FiQzGyY9M87ikjhg5kDirnQwvlqJ8K5wDO7aJE_Tc` |
| Nigeria CMAM Bayesian VoI model (shared with IDinsight) | Sheet | `1zpaoNgFoOEYwcyatABwLty78NjgH1InstdeaYM3snzE` |
| MW CMAM Bayesian VOI model for Nigeria survey | Sheet | `1I3WbdfDuNM_yXFZe0EDqGrv65n9jAolY3IkUJ0gQzes` |
| Bayesian VOI model for Nigeria survey | Sheet | `1g79b55nKK1xKo2xI04nOpkzJ3aNh99S2iDEefpPcGWg` |
| IDinsight coverage surveys protocol for Mark | Google Doc | `10AqfA5_fCc-XWtCG-9euJlsveAOnwvZe8YNZ_ABvfU0` |
| [Shared IMC] NHREC Proposal: CMAM Health Facility Visits & Qualitative Interviews Nigeria | Google Doc | `1qDDwTes2KH5l3RxvsUVk-dcLIp_x6erhiLlHgjFvXkU` |

**Before writing any code:** read the R script and the VoI analysis doc end-to-end. Summarize the model (likelihood, priors, decision rule, loss function) in this folder as `docs/idinsight_method_notes.md` so the web tool reproduces it faithfully before generalizing.

---

## Scope — v1 vs later

### v1 (MVP)
- Reproduce IDinsight's CMAM coverage-survey VoI calculation exactly, as a web app
- Inputs: prior on coverage (Beta params or mean+CI), decision threshold, cost per interview, study-cost budget, loss/utility function parameters
- Outputs: expected posterior variance / credible interval width as a function of n; expected value of sample information (EVSI); recommended n; sensitivity plots
- Runs in-browser or via a lightweight backend — no staff R/Stan install needed

### v2
- Generalize beyond proportions: continuous outcomes, cluster sampling, stratified designs
- Support multiple program templates (nets usage, SMC coverage, VAS, vaccination, CMAM, water)
- Allow custom loss functions tied to GiveWell's CEA structure

### v3
- Save/share study designs across staff
- Compare designs side by side
- Export a methods appendix (LaTeX/markdown) for inclusion in protocols

---

## Technical Decisions (open — discuss before committing)

Do not pick a stack unilaterally. Options to discuss with Mark first:

- **Compute**: R + Shiny (closest to IDinsight's code — minimal translation risk) vs. Python + Stan/PyMC + Streamlit vs. pure JS (Stan.js / webppl) for zero-backend deploy
- **Hosting**: shinyapps.io, Posit Connect, HuggingFace Spaces, internal GiveWell server, or static site
- **Auth**: open to all GiveWell staff vs. Google SSO gated
- **Reproducibility**: must emit a seed + a parameter bundle so any run can be re-executed exactly

Default recommendation until Mark weighs in: **R + Shiny** for v1 (cheapest path to re-using IDinsight's existing R code), revisit for v2.

---

## Repository Layout (proposed)

```
BayesianPowerCalc/
├── CLAUDE.md              # this file
├── README.md              # public-facing description (write after v1 scope locked)
├── docs/
│   └── idinsight_method_notes.md   # summary of the IDinsight model
├── reference/             # copies of IDinsight R script + extracts (DO NOT commit sensitive content)
├── src/                   # app source
├── tests/                 # regression tests: reproduce IDinsight's published numbers
└── plan.md                # living implementation plan
```

---

## Workflow Preferences

- **Branching**: commit to branches only, never directly to `main` (per GiveWell pilot policy)
- **Sensitive data**: do not commit interview-level data, PII, grantee internal docs, or any raw survey responses. The IDinsight R script and VoI methods write-ups are methodological and OK to reference; anything grantee-confidential stays in Drive
- **Approved packages only**: check with Mark before adding any new R/Python dependency outside the mainstream (tidyverse, rstan/cmdstanr, brms, shiny, pymc, numpy, scipy, streamlit)
- **Flag risky actions**: large downloads, external API calls, auth setup, deployment — confirm before acting
- **Validation first**: every algorithmic change must be regression-tested against IDinsight's published sample-size numbers before the UI changes
- **Testing**: full suite (math + VoI quadrature cross-check + UI/plots/app integration) runs via `node --test tests/` in CI. This machine has **no Node**; run modules locally with macOS's JavaScriptCore: `jsc -m file.js` (jsc lives in `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/`). UI tests use the zero-dependency DOM stub in `tests/helpers/dom.js` — extend it rather than adding jsdom. The math core was independently verified June 2026; see `docs/math_verification.md` before touching `src/math.js` / `src/voi.js` / `src/cea.js`

---

## Key People

| Name | Role | Context |
|---|---|---|
| Alex Cohen (AC) | Mark's manager | Will need to sign off on rollout to wider staff |
| IDinsight team | External partner | Authors of the source R script and VoI methodology — credit them; loop in if we meaningfully extend their method |
| HKI | Implementer | Original CMAM survey partner — their protocol shaped the IDinsight calculations |
| IMC | Implementer | Second CMAM survey partner — NHREC proposal is in source material |

---

## Open Questions to Resolve with Mark

1. Stack choice (R/Shiny vs Python/Streamlit vs JS)
2. Hosting target and auth model
3. Scope of v1 — CMAM-only reproduction, or also nets/SMC templates?
4. Should IDinsight be formally looped in (co-authorship, review) before public internal release?
5. Does this live in a GiveWell GitHub org, or a personal repo for now?

---

## Instructions for Maintaining This File

- After every substantive session, update: scope changes, stack decisions, new reference material, new people
- Keep the Source Material table current — it's the ground truth for "what we're reproducing"
- If a decision is made in chat, record it here so the next session doesn't re-litigate it
