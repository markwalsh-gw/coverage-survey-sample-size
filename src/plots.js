// Minimal Canvas-based line plotting. Zero dependencies.
// Axes, grid, one or more series, optional vertical marker.

export function drawLinePlot(canvas, {
  series, // [{xs, ys, label, color}]
  xLabel = "",
  yLabel = "",
  title = "",
  xLog = false,
  markerX = null,
  markerLabel = "",
}) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 58, padR = 14, padT = 28, padB = 42;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  const allX = series.flatMap((s) => s.xs);
  const allY = series.flatMap((s) => s.ys);
  let xmin = Math.min(...allX), xmax = Math.max(...allX);
  let ymin = Math.min(0, ...allY), ymax = Math.max(...allY);
  if (ymax === ymin) ymax = ymin + 1;
  if (xmax === xmin) xmax = xmin + 1;

  const xToPx = (x) => {
    if (xLog) {
      const lx = Math.log(Math.max(x, 1e-9)), lmin = Math.log(xmin), lmax = Math.log(xmax);
      return padL + ((lx - lmin) / (lmax - lmin)) * plotW;
    }
    return padL + ((x - xmin) / (xmax - xmin)) * plotW;
  };
  const yToPx = (y) => padT + plotH - ((y - ymin) / (ymax - ymin)) * plotH;

  // Title.
  ctx.fillStyle = "#111";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, padL, padT - 10);

  // Axes.
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // Y ticks.
  ctx.fillStyle = "#333";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const yTicks = niceTicks(ymin, ymax, 5);
  for (const yt of yTicks) {
    const py = yToPx(yt);
    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(padL + plotW, py);
    ctx.stroke();
    ctx.fillText(fmt(yt), padL - 6, py);
  }

  // X ticks.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = xLog ? logTicks(xmin, xmax) : niceTicks(xmin, xmax, 6);
  for (const xt of xTicks) {
    const px = xToPx(xt);
    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.fillText(fmt(xt), px, padT + plotH + 4);
  }

  // Axis labels.
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  ctx.fillText(xLabel, padL + plotW / 2, cssH - 8);
  ctx.save();
  ctx.translate(14, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // Series.
  for (const s of series) {
    ctx.strokeStyle = s.color || "#2563eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < s.xs.length; i++) {
      const px = xToPx(s.xs[i]);
      const py = yToPx(s.ys[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Vertical marker.
  if (markerX != null && markerX >= xmin && markerX <= xmax) {
    const px = xToPx(markerX);
    ctx.strokeStyle = "#dc2626";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    if (markerLabel) {
      ctx.fillStyle = "#dc2626";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(markerLabel, px + 4, padT + 2);
    }
  }

  // Legend (top-right) if multiple series.
  if (series.length > 1) {
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    let ly = padT + 2;
    for (const s of series) {
      if (!s.label) continue;
      ctx.fillStyle = s.color || "#2563eb";
      ctx.fillRect(cssW - padR - 90, ly + 5, 12, 2);
      ctx.fillStyle = "#333";
      ctx.fillText(s.label, cssW - padR - 2, ly);
      ly += 14;
    }
  }
}

function niceTicks(min, max, count) {
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const out = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) out.push(v);
  return out.filter((v) => v >= min - 1e-9 && v <= max + 1e-9);
}

function niceNum(x, round) {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, exp);
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

function logTicks(min, max) {
  const out = [];
  const lo = Math.floor(Math.log10(Math.max(min, 1e-9)));
  const hi = Math.ceil(Math.log10(Math.max(max, 1e-9)));
  for (let e = lo; e <= hi; e++) {
    const v = Math.pow(10, e);
    if (v >= min && v <= max) out.push(v);
  }
  return out;
}

function fmt(x) {
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1000 || a < 0.01) return x.toExponential(1);
  if (Number.isInteger(x)) return String(x);
  return x.toPrecision(3);
}

// Bar chart for a histogram { lower, upper, prob } (probabilities sum to 1).
export function drawBarPlot(canvas, { bins, title = "", xLabel = "", yLabel = "" }) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 50, padR = 14, padT = 28, padB = 38;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  const ymax = Math.max(1e-6, ...bins.prob.map((p) => p * 100));
  const xmin = bins.lower[0], xmax = bins.upper[bins.upper.length - 1];

  const xToPx = (x) => padL + ((x - xmin) / (xmax - xmin)) * plotW;
  const yToPx = (y) => padT + plotH - (y / ymax) * plotH;

  ctx.fillStyle = "#111";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, padL, padT - 10);

  ctx.strokeStyle = "#888";
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // y ticks
  ctx.fillStyle = "#333";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const yTicks = niceTicks(0, ymax, 4);
  for (const yt of yTicks) {
    const py = yToPx(yt);
    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(padL + plotW, py);
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.fillText(`${yt.toFixed(0)}%`, padL - 6, py);
  }

  // bars
  ctx.fillStyle = "#3b82f6";
  for (let i = 0; i < bins.prob.length; i++) {
    const x0 = xToPx(bins.lower[i]);
    const x1 = xToPx(bins.upper[i]);
    const h = (bins.prob[i] * 100 / ymax) * plotH;
    ctx.fillRect(x0 + 1, padT + plotH - h, Math.max(1, x1 - x0 - 2), h);
  }

  // x ticks: 0, .25, .5, .75, 1
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const xt of [0, 0.25, 0.5, 0.75, 1]) {
    if (xt < xmin - 1e-9 || xt > xmax + 1e-9) continue;
    const px = xToPx(xt);
    ctx.strokeStyle = "#ccc";
    ctx.beginPath();
    ctx.moveTo(px, padT + plotH);
    ctx.lineTo(px, padT + plotH + 4);
    ctx.stroke();
    ctx.fillText(xt.toFixed(2), px, padT + plotH + 6);
  }

  ctx.fillText(xLabel, padL + plotW / 2, cssH - 4);
  ctx.save();
  ctx.translate(12, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}
