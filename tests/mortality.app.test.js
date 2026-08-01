// End-to-end test of mortality_main.js: boots the mortality page against the
// DOM stub exactly as the browser would — init, URL-state read, closed-form
// compute, result/derived/caveat rendering, sweep table, plots, URL
// write-back — then exercises the error and caveat paths via events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMortalityDom, makeWindow } from "./helpers/dom.js";

// URL overrides exercise mortalityQueryToParams → writeMortalityForm.
globalThis.document = buildMortalityDom();
globalThis.window = makeWindow({ search: "?fixedCost=350000" });
globalThis.history = {
  calls: [],
  replaceState(...args) { this.calls.push(args); },
};

const el = (id) => document.getElementById(id);

async function waitFor(cond, what, timeoutMs = 10000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) assert.fail(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("mortality page boots and computes end-to-end", async (t) => {
  await import("../src/mortality_main.js");
  window.dispatch("DOMContentLoaded");

  await t.test("initial compute completes with defaults + URL override", () => {
    // compute() is synchronous on DOMContentLoaded — results are already in.
    assert.equal(el("error").style.display, "none");

    // Default screen pins (see tests/mortality.test.js for the model-level
    // versions of these numbers).
    assert.equal(el("res-power").textContent, "83%");
    assert.equal(el("res-mde").textContent, "14% reduction");
    assert.equal(el("res-needed").textContent, "51 + 51");
    assert.equal(el("res-conclusive").textContent, "73%");
    assert.equal(el("res-belief").textContent, "6% to 23%");
    assert.equal(el("res-weight").textContent, "78% data / 22% prior");
    // fixedCost overridden to 350k via the URL → total exactly 2.0M.
    assert.equal(el("res-cost").textContent, "$2.0M");

    // Derived transparency strips.
    assert.equal(el("derived-rr").textContent, "0.85");
    assert.equal(el("derived-deff").textContent, "2.00");
    // Locale-agnostic (toLocaleString grouping varies with CI's ICU locale).
    assert.match(el("derived-deaths").textContent, /^1.?169 \/ 1.?375$/);
    assert.match(el("derived-priordeaths").textContent, /374/);

    // The decision view (grant $25M, bar 4×, CE-at-best-guess 6× ⇒ R* = 10%).
    assert.equal(el("res-rightcall").textContent, "87%");
    assert.equal(el("res-voinet").textContent, "$1.5M"); // cost $2.0M with the URL's 350k fixed
    assert.equal(el("res-optimal").textContent, "33 + 33");
    assert.equal(el("cell-gr").textContent, "65%");
    assert.equal(el("cell-gw").textContent, "8%");
    assert.equal(el("cell-pw").textContent, "6%");
    assert.equal(el("cell-pr").textContent, "21%");
    assert.equal(el("derived-rstar").textContent, "10%");
    assert.equal(el("derived-clearsbar").textContent, "71%");
    assert.equal(el("derived-decidenow").textContent, "fund it");
    assert.match(el("recommendation").innerHTML, /Decision math:/);
    assert.match(el("sweep-table").innerHTML, /<th>Net value<\/th>/);
    assert.match(el("sweep-table").innerHTML, /best value/);

    // Adequately powered at defaults → good banner mentioning both lenses.
    assert.equal(el("recommendation").className, "recommendation good");
    assert.match(el("recommendation").innerHTML, /adequately powered/);
    assert.match(el("recommendation").innerHTML, /settling the funding question/);

    // No caveats fire on the default screen (by UX design).
    assert.equal(el("caveats").style.display, "none");

    // Sweep table rendered with the current design marked.
    assert.match(el("sweep-table").innerHTML, /your design/);
    assert.match(el("sweep-table").innerHTML, /<th>Power<\/th>/);

    // URL write-back includes the override and the defaults.
    assert.ok(history.calls.length > 0, "replaceState called");
    const url = history.calls.at(-1)[2];
    assert.match(url, /fixedCost=350000/);
    assert.match(url, /cT=55/);

    // All three plots drew finite geometry.
    for (const id of ["plot-power", "plot-belief", "plot-cost"]) {
      const calls = el(id).getContext("2d").calls;
      assert.ok(calls.length > 0, `${id} drew`);
      for (const [name, ...args] of calls) {
        for (const a of args) {
          if (typeof a === "number") {
            assert.ok(Number.isFinite(a), `${id}: ${name} got non-finite coordinate`);
          }
        }
      }
    }
  });

  await t.test("bad prior ordering surfaces an error and clears results", async () => {
    el("priorLoR").value = "40"; // > best guess of 15
    el("priorLoR").dispatch("input"); // debounced recompute (150ms)
    await waitFor(() => el("error").style.display === "block", "error to display");
    assert.match(el("error").innerHTML, /low < best guess < high/);
    assert.equal(el("recommendation").className, "recommendation");
    assert.match(el("recommendation").textContent, /Fix the issue flagged above/);
    // Stale results are blanked, not left sitting next to the error banner.
    assert.equal(el("res-power").textContent, "—");
    assert.equal(el("derived-deff").textContent, "—");
    assert.equal(el("sweep-table").innerHTML, "");
  });

  await t.test("fixing the input recovers", async () => {
    el("priorLoR").value = "-5";
    el("priorLoR").dispatch("input");
    await waitFor(() => el("error").style.display === "none", "error to clear");
    await waitFor(
      () => el("recommendation").className === "recommendation good",
      "recommendation to recover",
    );
  });

  await t.test("an underpowered design flips the banner and fires caveats", async () => {
    el("cT").value = "8";
    el("cC").value = "8";
    el("cT").dispatch("input");
    await waitFor(
      () => el("recommendation").className === "recommendation warn",
      "warn banner",
    );
    assert.match(el("recommendation").innerHTML, /more likely to miss a real effect/);
    assert.equal(el("caveats").style.display, "block");
    assert.match(el("caveats").innerHTML, /fewer than about 15 clusters per arm/);
  });

  await t.test("restoring the design clears the caveats", async () => {
    el("cT").value = "55";
    el("cC").value = "55";
    el("cT").dispatch("input");
    await waitFor(() => el("caveats").style.display === "none", "caveats to clear");
    assert.equal(el("recommendation").className, "recommendation good");
  });

  await t.test("setting the funding at stake to 0 switches the decision panel off", async () => {
    el("grantSize").value = "0";
    el("grantSize").dispatch("input");
    await waitFor(() => el("res-rightcall").textContent === "—", "decision panel to blank");
    assert.equal(el("error").style.display, "none");
    assert.doesNotMatch(el("recommendation").innerHTML, /Decision math:/);
    el("grantSize").value = "25000000";
    el("grantSize").dispatch("input");
    await waitFor(() => el("res-rightcall").textContent === "87%", "decision panel to return");
  });
});
