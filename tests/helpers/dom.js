// Minimal DOM stub for testing ui.js / plots.js / main.js under `node --test`
// with zero dependencies. Implements only what the app actually touches:
// getElementById, createElement/appendChild (with id registration), value /
// textContent / innerHTML / style / className / classList, addEventListener +
// manual dispatch, and a recording 2D canvas context.

export function makeRecordingContext() {
  const calls = [];
  const ctx = { calls };
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  for (const m of [
    "scale", "clearRect", "fillText", "beginPath", "moveTo", "lineTo",
    "stroke", "fillRect", "save", "restore", "translate", "rotate", "setLineDash",
  ]) ctx[m] = record(m);
  // Style properties (fillStyle, font, …) are plain assignments on the object.
  return ctx;
}

export function makeElement(tag = "div", id = "") {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    style: {},
    className: "",
    children: [],
    ownerDocument: null,
    classList: {
      add(c) {
        const s = new Set(el.className.split(/\s+/).filter(Boolean));
        s.add(c);
        el.className = [...s].join(" ");
      },
      remove(c) {
        const s = new Set(el.className.split(/\s+/).filter(Boolean));
        s.delete(c);
        el.className = [...s].join(" ");
      },
      contains(c) {
        return el.className.split(/\s+/).filter(Boolean).includes(c);
      },
    },
    appendChild(child) {
      el.children.push(child);
      if (el.ownerDocument) el.ownerDocument._register(child);
      return child;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of listeners[type] || []) fn({ target: el, type, ...event });
    },
  };
  return el;
}

export function makeCanvas(id, clientWidth = 600, clientHeight = 260) {
  const el = makeElement("canvas", id);
  el.clientWidth = clientWidth;
  el.clientHeight = clientHeight;
  el.width = 0;
  el.height = 0;
  const ctx = makeRecordingContext();
  el.getContext = () => ctx;
  return el;
}

export function makeDocument() {
  const byId = new Map();
  const doc = {
    _register(el) {
      el.ownerDocument = doc;
      if (el.id) byId.set(el.id, el);
      for (const child of el.children || []) doc._register(child);
    },
    getElementById(id) {
      return byId.get(id) || null;
    },
    createElement(tag) {
      const el = makeElement(tag);
      el.ownerDocument = doc;
      return el;
    },
    add(el) {
      doc._register(el);
      return el;
    },
  };
  return doc;
}

export function makeWindow({ search = "" } = {}) {
  const listeners = {};
  return {
    devicePixelRatio: 1,
    location: { search },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of listeners[type] || []) fn({ type, ...event });
    },
  };
}

// Every element id the app expects to find (mirrors index.html), with the
// same starting values index.html ships. Histogram bin inputs (bin-0…bin-19)
// are NOT included — main.js builds those itself via buildHistogramGrid();
// tests that exercise ui.js directly can pass { withBins: true }.
export function buildCalculatorDom({ withBins = false } = {}) {
  const doc = makeDocument();

  const inputDefaults = {
    priorMean: "0.30", priorLo: "0.10", priorHi: "0.55",
    caseload: "50000", annualBudget: "1500000",
    untreatedMortality: "0.05", mortalityReduction: "0.50", valPerDeath: "119",
    benefitAdjustment: "1.0", gdValuePerDollar: "0.003355",
    budgetUp: "20000000", budgetDown: "4000000", targetCashMultiple: "8",
    costPerInterview: "200", fixedCost: "0", targetROI: "8",
    NMin: "100", NMax: "5000", NStep: "100", M: "20000", seed: "40326",
  };
  for (const [id, value] of Object.entries(inputDefaults)) {
    const el = makeElement("input", id);
    el.value = value;
    doc.add(el);
  }

  const priorMode = makeElement("select", "priorMode");
  priorMode.value = "meanCI";
  doc.add(priorMode);
  const preset = makeElement("select", "preset");
  preset.value = "";
  doc.add(preset);

  for (const id of [
    "preset-note", "meanCI-fields", "hist-grid", "hist-total",
    "error", "recommendation", "busy",
    "res-nstar", "res-voi", "res-totalcost", "res-roi",
    "derived-pstar", "derived-vup", "derived-vdown",
  ]) doc.add(makeElement("div", id));

  for (const id of ["plot-prior", "plot-voi", "plot-roi"]) doc.add(makeCanvas(id));

  if (withBins) {
    for (let i = 0; i < 20; i++) {
      const el = makeElement("input", `bin-${i}`);
      el.value = "0";
      doc.add(el);
    }
  }

  return doc;
}
