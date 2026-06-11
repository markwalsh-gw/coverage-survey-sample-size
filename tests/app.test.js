// End-to-end test of main.js: boots the real app against the DOM stub,
// exactly as the browser would — init, URL-state read, histogram grid build,
// CEA derivation, the full Monte Carlo sweep, plot rendering, and URL
// write-back — then exercises the error and preset paths via events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalculatorDom, makeWindow } from "./helpers/dom.js";

// Small M and a short N grid keep the in-test Monte Carlo fast (~50ms) while
// still running the genuine compute path. Loaded via the URL so the test also
// covers queryToParams → writeForm.
globalThis.document = buildCalculatorDom();
globalThis.window = makeWindow({ search: "?M=2000&NMax=1200" });
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

test("application boots and computes end-to-end", async (t) => {
  await import("../src/main.js");
  window.dispatch("DOMContentLoaded");

  await t.test("initial compute completes with defaults from index.html + URL", async () => {
    await waitFor(
      () => el("res-nstar").textContent !== "" && el("res-nstar").textContent !== "—",
      "first compute to finish",
    );
    assert.equal(el("busy").style.display, "none");
    assert.equal(el("error").style.display, "none");

    // Default CEA inputs imply p* ≈ 0.2707 (hand-derivable: A·target·gd / K).
    assert.equal(el("derived-pstar").textContent, "27%");

    // A concrete recommendation on the searched grid.
    const nStar = parseInt(el("res-nstar").textContent.replace(/[^0-9]/g, ""), 10);
    assert.ok(nStar >= 100 && nStar <= 1200, `nStar ${nStar} within grid`);
    assert.equal(nStar % 100, 0, "nStar lies on the N grid");
    assert.equal(el("recommendation").className, "recommendation good");
    assert.match(el("recommendation").innerHTML, /Interview about/);

    // The histogram grid was built and filled from the mean+CI prior (percent).
    const binSum = Array.from({ length: 20 }, (_, i) => parseFloat(el(`bin-${i}`).value))
      .reduce((s, p) => s + p, 0);
    assert.ok(Math.abs(binSum - 100) < 0.5, `bin percentages sum to ~100 (got ${binSum})`);

    // State written back to the URL, including the URL-supplied overrides.
    assert.ok(history.calls.length > 0, "replaceState called");
    const url = history.calls.at(-1)[2];
    assert.match(url, /caseload=50000/);
    assert.match(url, /M=2000/);

    // All three plots actually drew something.
    for (const id of ["plot-prior", "plot-voi", "plot-roi"]) {
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

  await t.test("invalid N range surfaces an error and clears the recommendation", async () => {
    el("NMax").value = "50"; // < NMin = 100
    el("NMax").dispatch("input"); // debounced recompute (200ms)
    await waitFor(() => el("error").style.display === "block", "error to display");
    assert.match(el("error").textContent, /N max must be ≥ N min/);
    assert.equal(el("recommendation").className, "recommendation");
    assert.match(el("recommendation").textContent, /Fix the issue flagged above/);
    assert.equal(el("derived-pstar").textContent, "—");
  });

  await t.test("fixing the input recovers", async () => {
    el("NMax").value = "1200";
    el("NMax").dispatch("input");
    await waitFor(() => el("error").style.display === "none", "error to clear");
    await waitFor(
      () => el("recommendation").className === "recommendation good",
      "recommendation to recover",
    );
  });

  await t.test("selecting a preset loads its numbers and recomputes", async () => {
    el("preset").value = "nets";
    el("preset").dispatch("change");
    // ITN preset: K = 400000·0.006·0.25·119 = 71,400 → p* = 1.5e6·8·0.003355/71400 ≈ 0.56.
    await waitFor(() => el("derived-pstar").textContent === "56%", "p* to update");
    assert.equal(parseFloat(el("priorMean").value), 0.65);
    assert.equal(parseFloat(el("caseload").value), 400000);
    assert.ok(el("preset-note").classList.contains("show"), "placeholder disclaimer shown");
    assert.equal(el("error").style.display, "none");
  });

  await t.test("clearing the preset hides the disclaimer", async () => {
    el("preset").value = "";
    el("preset").dispatch("change");
    await waitFor(() => !el("preset-note").classList.contains("show"), "note to hide");
  });
});
