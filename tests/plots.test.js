import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCanvas, makeWindow } from "./helpers/dom.js";

// plots.js reads window.devicePixelRatio at draw time.
globalThis.window = makeWindow();

const { drawLinePlot, drawBarPlot } = await import("../src/plots.js");

// Every numeric argument ever handed to the canvas must be finite — a NaN or
// Infinity coordinate silently draws nothing in a real browser, which is
// exactly the kind of regression a human eyeball test misses.
function assertAllCoordsFinite(ctx, label) {
  for (const [name, ...args] of ctx.calls) {
    for (const a of args) {
      if (typeof a === "number") {
        assert.ok(Number.isFinite(a), `${label}: ${name}(${args.join(", ")}) has non-finite arg`);
      }
    }
  }
}

const called = (ctx, name) => ctx.calls.filter((c) => c[0] === name);

test("drawLinePlot draws axes, ticks, series, and stays finite", () => {
  const canvas = makeCanvas("c1");
  const xs = Array.from({ length: 50 }, (_, i) => 100 + i * 100);
  const ys = xs.map((x) => 1e6 * Math.log(x));
  drawLinePlot(canvas, {
    title: "t", xLabel: "x", yLabel: "y",
    series: [{ xs, ys, label: "s", color: "#000" }],
  });
  const ctx = canvas.getContext("2d");
  assertAllCoordsFinite(ctx, "line plot");
  assert.ok(called(ctx, "stroke").length > 0, "should stroke at least once");
  assert.ok(called(ctx, "lineTo").length >= xs.length - 1, "should connect all points");
  const texts = called(ctx, "fillText").map((c) => c[1]);
  assert.ok(texts.includes("t"), "title drawn");
  assert.ok(texts.includes("x"), "x label drawn");
  // Canvas sized for the device pixel ratio.
  assert.equal(canvas.width, canvas.clientWidth * window.devicePixelRatio);
});

test("drawLinePlot draws the marker and its label when markerX is in range", () => {
  const canvas = makeCanvas("c2");
  const xs = [100, 200, 300];
  drawLinePlot(canvas, {
    series: [{ xs, ys: [1, 2, 3] }],
    markerX: 200, markerLabel: "recommended = 200",
  });
  const ctx = canvas.getContext("2d");
  const dashes = called(ctx, "setLineDash");
  assert.ok(dashes.some((c) => Array.isArray(c[1]) && c[1].length === 2), "dashed marker drawn");
  assert.ok(
    called(ctx, "fillText").some((c) => c[1] === "recommended = 200"),
    "marker label drawn",
  );
});

test("drawLinePlot skips the marker when markerX is null or out of range", () => {
  for (const markerX of [null, 9999]) {
    const canvas = makeCanvas("c3");
    drawLinePlot(canvas, { series: [{ xs: [1, 2, 3], ys: [1, 2, 3] }], markerX });
    const dashes = called(canvas.getContext("2d"), "setLineDash");
    assert.equal(dashes.length, 0, `no dash expected for markerX=${markerX}`);
  }
});

test("drawLinePlot shows a legend only for multiple series", () => {
  const one = makeCanvas("c4");
  drawLinePlot(one, { series: [{ xs: [1, 2], ys: [1, 2], label: "a" }] });
  assert.equal(called(one.getContext("2d"), "fillRect").length, 0);

  const two = makeCanvas("c5");
  drawLinePlot(two, {
    series: [
      { xs: [1, 2], ys: [1, 2], label: "a" },
      { xs: [1, 2], ys: [2, 1], label: "b" },
    ],
  });
  assert.equal(called(two.getContext("2d"), "fillRect").length, 2, "one swatch per labelled series");
});

test("drawLinePlot survives degenerate inputs without NaN coordinates", () => {
  const cases = [
    { name: "flat zero line", series: [{ xs: [100, 200, 300], ys: [0, 0, 0] }] },
    { name: "single point", series: [{ xs: [500], ys: [42] }] },
    { name: "constant y", series: [{ xs: [1, 2, 3], ys: [7, 7, 7] }] },
    { name: "negative values", series: [{ xs: [1, 2, 3], ys: [-5, -1, -9] }] },
  ];
  for (const c of cases) {
    const canvas = makeCanvas("c6");
    drawLinePlot(canvas, { series: c.series });
    assertAllCoordsFinite(canvas.getContext("2d"), c.name);
  }
});

test("drawLinePlot handles log-scale x", () => {
  const canvas = makeCanvas("c7");
  drawLinePlot(canvas, {
    xLog: true,
    series: [{ xs: [10, 100, 1000, 10000], ys: [1, 2, 3, 4] }],
  });
  const ctx = canvas.getContext("2d");
  assertAllCoordsFinite(ctx, "log x");
  const texts = called(ctx, "fillText").map((c) => c[1]);
  assert.ok(texts.length > 0, "tick labels drawn");
});

test("drawBarPlot draws one bar per bin and percentage ticks", () => {
  const nBins = 20;
  const prob = new Array(nBins).fill(1 / nBins);
  const lower = Array.from({ length: nBins }, (_, i) => i / nBins);
  const upper = Array.from({ length: nBins }, (_, i) => (i + 1) / nBins);
  const canvas = makeCanvas("c8");
  drawBarPlot(canvas, { bins: { lower, upper, prob }, title: "prior" });
  const ctx = canvas.getContext("2d");
  assertAllCoordsFinite(ctx, "bar plot");
  assert.equal(called(ctx, "fillRect").length, nBins, "one rect per bin");
  const texts = called(ctx, "fillText").map((c) => c[1]);
  assert.ok(texts.some((t) => /%$/.test(t)), "y ticks are percentages");
  assert.ok(texts.includes("prior"), "title drawn");
});

test("drawBarPlot stays finite when all mass is in one bin", () => {
  const prob = new Array(20).fill(0);
  prob[7] = 1;
  const lower = Array.from({ length: 20 }, (_, i) => i / 20);
  const upper = Array.from({ length: 20 }, (_, i) => (i + 1) / 20);
  const canvas = makeCanvas("c9");
  drawBarPlot(canvas, { bins: { lower, upper, prob } });
  assertAllCoordsFinite(canvas.getContext("2d"), "point-mass histogram");
});
