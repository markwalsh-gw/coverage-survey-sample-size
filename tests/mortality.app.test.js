// End-to-end test of mortality_main.js: boots the step-pipeline page against
// the DOM stub exactly as the browser would — init, URL-state read,
// closed-form compute, the ①–⑦ pipeline rendering, plots, URL write-back —
// then exercises the error, decision-off, don't-run, and caveat paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMortalityDom, makeWindow } from "./helpers/dom.js";

// A no-op URL override still exercises mortalityQueryToParams → writeMortalityForm.
globalThis.document = buildMortalityDom();
globalThis.window = makeWindow({ search: "?bar=4" });
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

test("mortality page boots and renders the value pipeline end-to-end", async (t) => {
  await import("../src/mortality_main.js");
  window.dispatch("DOMContentLoaded");

  await t.test("step ①: the funding decision today", () => {
    assert.equal(el("error").style.display, "none");
    // Locale-agnostic separators (CI ICU may not group with commas).
    assert.match(el("s1-fundval").textContent, /^503.?250 units$/);
    assert.match(el("s1-altval").textContent, /^335.?500 units$/);
    assert.equal(el("s1-rstar").textContent, "10.0%");
    assert.equal(el("s1-pclear").textContent, "71%");
    assert.equal(el("s1-decide").textContent, "fund it");
    assert.match(el("s1-evnow").textContent, /^\+152.?453 units$/);
    // Provenance: the number is reproducible from what is on screen.
    assert.equal(el("s1-er").textContent, "14.5%");
    assert.match(el("s1-evnow-sub").textContent, /funding at your prior's average reduction \(14\.5%\)/);
    // Card 5's mirror strip is populated (was an orphan before review).
    assert.equal(el("derived-rstar").textContent, "10.0%");
    assert.equal(el("derived-clearsbar").textContent, "71%");
    assert.equal(el("derived-decidenow").textContent, "fund it");
  });

  await t.test("step ②: what the study measures", () => {
    assert.equal(el("s2-weight").textContent, "78% data / 22% prior");
    assert.equal(el("s2-belief").textContent, "6% to 23%");
    assert.equal(el("s2-mislead").textContent, "13.3%");
  });

  await t.test("step ③: the outcomes table decomposes the value", () => {
    const html = el("outcomes-table").innerHTML;
    assert.match(html, /Fund — and be right<\/td><td>65%<\/td><td>\+207.?187/);
    assert.match(html, /misled\)<\/td><td>8%<\/td><td>−7.?196/);
    assert.match(html, /dodges an expected 52.?879 units/);
    assert.match(html, /leaves an expected 5.?341 units unclaimed/);
    assert.match(html, /Deciding with the study<\/td><td>100%<\/td><td>\+199.?992/);
    // The on-screen audit line: the four pieces sum to today's expected gain.
    assert.match(html, /= \+152.?453 units — exactly the expected gain of funding today/);
    assert.match(html, /Adds to expected value \(units\)/);
  });

  await t.test("steps ④–⑤: gross value, cost in units, net", () => {
    assert.match(el("s4-withstudy").textContent, /^199.?992 units$/);
    assert.match(el("s4-today").textContent, /^152.?453 units$/);
    assert.match(el("s4-voi").textContent, /^47.?538 units$/);
    assert.match(el("s4-voi-sub").textContent, /\$3\.5M of bar-level grantmaking/);
    assert.equal(el("s5-cost").textContent, "$2.15M");
    assert.match(el("s5-costunits").textContent, /^28.?853 units$/);
    assert.match(el("s5-net").textContent, /^\+18.?685 units$/);
    // The study judged like a grant, against the bar.
    assert.match(el("s5-net-sub").textContent, /this study is 6\.6× cash — clears your 4× bar/);
  });

  await t.test("step ⑥: best size, marginal-vs-bar logic, sweep table", () => {
    assert.equal(el("s6-best").textContent, "33 + 33");
    assert.match(el("s6-best-sub").textContent, /8\.3× cash overall/);
    assert.match(el("s6-best-sub").textContent, /drops below your 4× bar/);
    // The marginal plot tests the next cluster against the bar line.
    assert.match(JSON.stringify(el("plot-marginal").getContext("2d").calls), /your bar = 4×/);
    assert.match(el("sweep-table").innerHTML, /<th>Study value \(units\)<\/th><th>Net \(units\)<\/th>/);
    assert.match(el("sweep-table").innerHTML, /best value/);
    assert.match(el("sweep-table").innerHTML, /80% power/);
  });

  await t.test("step ⑦: frequentist sense-check", () => {
    assert.equal(el("s7-power").textContent, "83%");
    assert.equal(el("s7-mde").textContent, "14% reduction");
    assert.equal(el("s7-needed").textContent, "51 + 51");
    assert.match(el("s7-compare").textContent, /value-optimal design is smaller \(33 \+ 33\)/);
  });

  await t.test("banner recommends the optimal study", () => {
    assert.equal(el("recommendation").className, "recommendation good");
    assert.match(el("recommendation").innerHTML, /Run a study of about 33 \+ 33 clusters/);
    assert.match(el("recommendation").innerHTML, /\+21.?499 units net/);
    assert.match(el("recommendation").innerHTML, /the study itself is 8\.3× cash/);
    assert.equal(el("caveats").style.display, "none");
  });

  await t.test("plots drew finite geometry; belief plot marks the breakeven", () => {
    for (const id of ["plot-belief", "plot-marginal", "plot-net"]) {
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
    assert.match(JSON.stringify(el("plot-belief").getContext("2d").calls), /breakeven 10\.0%/);
  });

  await t.test("URL write-back carries the decision fields", () => {
    assert.ok(history.calls.length > 0, "replaceState called");
    const url = history.calls.at(-1)[2];
    assert.match(url, /grantSize=25000000/);
    assert.match(url, /ceAlt=4/);
    assert.match(url, /gd=0\.003355/);
  });

  await t.test("errors blank the pipeline and recovery restores it", async () => {
    el("priorLoR").value = "40"; // > best guess
    el("priorLoR").dispatch("input");
    await waitFor(() => el("error").style.display === "block", "error to display");
    assert.match(el("error").innerHTML, /low < best guess < high/);
    assert.equal(el("s4-voi").textContent, "—");
    assert.equal(el("outcomes-table").innerHTML, "");
    el("priorLoR").value = "-5";
    el("priorLoR").dispatch("input");
    await waitFor(() => el("error").style.display === "none", "error to clear");
    await waitFor(() => /47.?538 units/.test(el("s4-voi").textContent), "pipeline to recover");
  });

  await t.test("grant of 0 switches the value pipeline off; ② and ⑦ stay live", async () => {
    el("grantSize").value = "0";
    el("grantSize").dispatch("input");
    await waitFor(() => el("s1-fundval").textContent === "—", "step ① to blank");
    assert.match(el("s1-fundval-sub").textContent, /value panel off/);
    assert.equal(el("s4-voi").textContent, "—");
    assert.match(el("outcomes-table").innerHTML, /Needs the funding decision/);
    assert.match(el("plot-marginal-note").textContent, /chance of a statistically significant result/);
    assert.equal(el("s2-weight").textContent, "78% data / 22% prior");
    assert.equal(el("s7-power").textContent, "83%");
    assert.match(el("recommendation").innerHTML, /Set the funding decision/);
    assert.equal(el("error").style.display, "none");
    el("grantSize").value = "25000000";
    el("grantSize").dispatch("input");
    await waitFor(() => el("s6-best").textContent === "33 + 33", "pipeline to return");
  });

  await t.test("a tiny grant flips the banner to don't-run", async () => {
    el("grantSize").value = "1000000";
    el("grantSize").dispatch("input");
    await waitFor(() => /Don't run this study/.test(el("recommendation").innerHTML), "don't-run banner");
    assert.equal(el("s6-best").textContent, "none");
    assert.match(el("s7-compare").textContent, /no study size pays for itself/);
    el("grantSize").value = "25000000";
    el("grantSize").dispatch("input");
    await waitFor(() => el("s6-best").textContent === "33 + 33", "pipeline to return");
  });

  await t.test("few clusters fires the caveat and clears on restore", async () => {
    el("cT").value = "8";
    el("cC").value = "8";
    el("cT").dispatch("input");
    await waitFor(() => el("caveats").style.display === "block", "caveat to fire");
    assert.match(el("caveats").innerHTML, /fewer than about 15 clusters per arm/);
    el("cT").value = "55";
    el("cC").value = "55";
    el("cT").dispatch("input");
    await waitFor(() => el("caveats").style.display === "none", "caveat to clear");
  });
});
