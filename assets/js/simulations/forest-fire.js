/*
 * forest-fire.js — Drossel–Schwabl forest-fire model, with a live
 * fire-size distribution (log-frequency) plot.
 *
 * WHAT IT DOES
 *   States per cell: EMPTY, TREE, FIRE. Each synchronous timestep:
 *     - FIRE  -> EMPTY
 *     - TREE  -> FIRE if any 4-neighbour is burning,
 *                else FIRE with probability f (lightning)
 *     - EMPTY -> TREE with probability p (growth)
 *
 *   When lightning strikes a tree we flood-fill its connected tree cluster;
 *   that cluster is exactly what the resulting fire will consume, so its size
 *   is recorded as one "outbreak". Those sizes are log-binned and plotted as a
 *   log-log frequency distribution — the model self-organizes to a critical
 *   state where N(s) follows a power law.
 *
 * TUNABLES: DIST_BASE (log-bin ratio), and the defaults for L / p / f / speed.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const EMPTY = 0, TREE = 1, FIRE = 2;
  const DIST_BASE = 1.5;          // log-bin ratio for the fire-size histogram
  const GRAPH_MS = 400;           // min ms between graph refreshes
  const MAX_STEPS_PER_FRAME = 8;  // don't jank the page when speed is high

  // Site palette (keep in sync with _sass): teal accent, gray text, light bg.
  const TEAL = '#2c6e6b';
  const PAGE_BG = '#f4f4f5';
  const GRID_COLOR = '#d5d5d8';

  // Lattice cell colours, all taken from the site palette.
  const COLOR_EMPTY = [244, 244, 245];   // #f4f4f5, page background
  const COLOR_TREE = [44, 110, 107];     // #2c6e6b, teal accent
  const COLOR_FIRE = [17, 17, 17];       // #111, site text colour

  /* ==================================================================== *
   *  EDIT ME — graph appearance.                                         *
   *  xlabel/ylabel accept LaTeX/MathJax between $...$ (like matplotlib),  *
   *  e.g. '$N(s)$', '$k_{nn}$'. Backslashes must be doubled in JS.        *
   *  NOTE: `title` must be PLAIN TEXT — Plotly passes any string with     *
   *  $...$ to MathJax, which renders the math and drops the other words.  *
   *  marker.symbol: 'circle' | 'square' | 'diamond' | 'cross' | 'x' |     *
   *                 'triangle-up' | 'circle-open' | ... (Plotly symbols). *
   * ==================================================================== */
  const GRAPHS = {
    fire: {
      title: 'Fire-size distribution',
      xlabel: '$s$', ylabel: '$N(s)$',
      marker: { symbol: 'circle', size: 6, color: TEAL },
    },
  };

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */
  const canvas = document.getElementById('sim-canvas');
  const ctx = canvas.getContext('2d');
  const readoutEl = document.getElementById('sim-readout');

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  let L = 128;                    // lattice side length (32..256, powers of two)
  let N = L * L;
  let growth = 0.03;              // p, tree growth probability
  let lightning = 1e-5;           // f, lightning probability per tree per step
  let speed = 20;                 // timesteps per second

  let grid, next, img;
  let stack, seen, seenStamp;     // flood-fill scratch

  let distHist, outbreaks, biggest;
  let steps = 0;
  let running = false;
  let rafId = null;
  let nextStepTime = 0;
  let lastGraphTime = 0;

  /* ------------------------------------------------------------------ */
  /* Allocation / reset                                                  */
  /* ------------------------------------------------------------------ */
  function allocate() {
    N = L * L;
    grid = new Uint8Array(N);
    next = new Uint8Array(N);
    stack = new Int32Array(N);
    seen = new Int32Array(N);
    seenStamp = 0;
    canvas.width = L;
    canvas.height = L;
    img = ctx.createImageData(L, L);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
  }

  function seedForest() {
    // Start from a half-full random forest; the model self-organizes from here.
    for (let i = 0; i < N; i++) grid[i] = Math.random() < 0.5 ? TREE : EMPTY;
    steps = 0;
  }

  function resetStats() {
    const nbins = Math.ceil(Math.log(N + 1) / Math.log(DIST_BASE)) + 1;
    distHist = new Float64Array(nbins);
    outbreaks = 0;
    biggest = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Fire-size measurement                                               */
  /* ------------------------------------------------------------------ */
  /*
   * Flood-fill the connected TREE cluster containing `start` on the CURRENT
   * grid and record its size. The fire will burn exactly this cluster, so its
   * size is the outbreak size. Called at the moment lightning strikes.
   */
  function recordOutbreak(start) {
    seenStamp++;
    let sp = 0, size = 0;
    stack[sp++] = start;
    seen[start] = seenStamp;
    while (sp > 0) {
      const i = stack[--sp];
      size++;
      const x = i % L, y = (i / L) | 0;
      if (x > 0)      { const j = i - 1; if (grid[j] === TREE && seen[j] !== seenStamp) { seen[j] = seenStamp; stack[sp++] = j; } }
      if (x < L - 1)  { const j = i + 1; if (grid[j] === TREE && seen[j] !== seenStamp) { seen[j] = seenStamp; stack[sp++] = j; } }
      if (y > 0)      { const j = i - L; if (grid[j] === TREE && seen[j] !== seenStamp) { seen[j] = seenStamp; stack[sp++] = j; } }
      if (y < L - 1)  { const j = i + L; if (grid[j] === TREE && seen[j] !== seenStamp) { seen[j] = seenStamp; stack[sp++] = j; } }
    }
    const b = Math.floor(Math.log(size) / Math.log(DIST_BASE));
    distHist[b] += 1;
    outbreaks++;
    if (size > biggest) biggest = size;
    return size;
  }

  /* ------------------------------------------------------------------ */
  /* One synchronous CA timestep                                         */
  /* ------------------------------------------------------------------ */
  function step() {
    for (let y = 0; y < L; y++) {
      const row = y * L;
      for (let x = 0; x < L; x++) {
        const i = row + x;
        const s = grid[i];
        if (s === FIRE) {
          next[i] = EMPTY;
        } else if (s === TREE) {
          const burningNeighbour =
            (x > 0 && grid[i - 1] === FIRE) ||
            (x < L - 1 && grid[i + 1] === FIRE) ||
            (y > 0 && grid[i - L] === FIRE) ||
            (y < L - 1 && grid[i + L] === FIRE);
          if (burningNeighbour) {
            next[i] = FIRE;                 // spreading fire, not a new outbreak
          } else if (Math.random() < lightning) {
            next[i] = FIRE;
            recordOutbreak(i);              // new outbreak: measure the cluster
          } else {
            next[i] = TREE;
          }
        } else {
          next[i] = Math.random() < growth ? TREE : EMPTY;
        }
      }
    }
    const t = grid; grid = next; next = t;
    steps++;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function render() {
    const d = img.data;
    for (let i = 0; i < N; i++) {
      const s = grid[i];
      const c = s === TREE ? COLOR_TREE : (s === FIRE ? COLOR_FIRE : COLOR_EMPTY);
      const o = i << 2;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
    }
    ctx.putImageData(img, 0, 0);
  }

  function updateReadout() {
    let trees = 0, fires = 0;
    for (let i = 0; i < N; i++) {
      if (grid[i] === TREE) trees++;
      else if (grid[i] === FIRE) fires++;
    }
    readoutEl.innerHTML =
      'L = ' + L + ' &nbsp; steps: ' + steps + '<br>' +
      'tree density: ' + (trees / N).toFixed(3) + '<br>' +
      'burning: ' + fires + '<br>' +
      'outbreaks: ' + outbreaks + '<br>' +
      'largest fire: ' + biggest;
  }

  /* ------------------------------------------------------------------ */
  /* Loop                                                                */
  /* ------------------------------------------------------------------ */
  function frame() {
    if (!running) return;
    const now = performance.now();
    if (now - nextStepTime > 1000) nextStepTime = now;   // recover from stalls

    let did = 0;
    while (now >= nextStepTime && did < MAX_STEPS_PER_FRAME) {
      step();
      nextStepTime += 1000 / speed;
      did++;
    }
    if (did > 0) { render(); updateReadout(); }
    if (now - lastGraphTime > GRAPH_MS) { updateGraph(); lastGraphTime = now; }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    nextStepTime = performance.now();
    lastGraphTime = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function reset() {
    pause();
    seedForest();
    resetStats();
    render();
    updateReadout();
    updateGraph();
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */
  function setGrowth(v) {
    if (isNaN(v)) { pNum.value = growth.toFixed(3); return; }
    growth = Math.max(0.001, Math.min(0.3, v));
    pRange.value = growth;
    pNum.value = growth.toFixed(3);
    resetStats();               // fire statistics depend on p
    updateGraph();
  }

  // f is controlled on a log slider: slider value is log10(f).
  function setLightning(v) {
    if (isNaN(v) || v <= 0) { fNum.value = lightning.toExponential(1); return; }
    lightning = Math.max(1e-7, Math.min(1e-2, v));
    fRange.value = Math.log(lightning) / Math.LN10;
    fNum.value = lightning.toExponential(1);
    resetStats();               // fire statistics depend on f
    updateGraph();
  }

  function setL(v) {
    // Snap the side length to a power of two in [32, 256].
    let e = Math.round(Math.log(v) / Math.LN2);
    e = Math.max(5, Math.min(8, e));
    L = 1 << e;
    lRange.value = e;
    lVal.textContent = L + ' × ' + L;
    const wasRunning = running;
    pause();
    allocate();
    seedForest();
    resetStats();
    render();
    updateReadout();
    updateGraph();
    if (wasRunning) start();
  }

  function setSpeed(v) {
    speed = Math.max(0.5, Math.min(200, v));
    speedVal.textContent = speed + ' / s';
    nextStepTime = performance.now();
  }

  // --- Build the parameter UI underneath the buttons (#sim-params) ---
  const params = document.getElementById('sim-params');
  params.innerHTML =
    '<div class="control">' +
    '  <label>p (tree growth)</label>' +
    '  <div class="p-row">' +
    '    <input type="range" id="p-range" min="0.001" max="0.3" step="0.001">' +
    '    <input type="text" id="p-num" inputmode="decimal">' +
    '  </div>' +
    '</div>' +
    '<div class="control">' +
    '  <label>f (lightning)</label>' +
    '  <div class="p-row">' +
    '    <input type="range" id="f-range" min="-7" max="-2" step="0.1">' +
    '    <input type="text" id="f-num" inputmode="decimal">' +
    '  </div>' +
    '</div>' +
    '<div class="control">' +
    '  <label>Lattice size: <span id="L-val"></span></label>' +
    '  <input type="range" id="L-range" min="5" max="8" step="1">' +   // 2^5..2^8 = 32..256
    '</div>' +
    '<div class="control">' +
    '  <label>Speed: <span id="speed-val"></span></label>' +
    '  <input type="range" id="speed-range" min="0.5" max="200" step="0.5">' +
    '</div>';

  const pRange = document.getElementById('p-range');
  const pNum = document.getElementById('p-num');
  const fRange = document.getElementById('f-range');
  const fNum = document.getElementById('f-num');
  const lRange = document.getElementById('L-range');
  const lVal = document.getElementById('L-val');
  const speedRange = document.getElementById('speed-range');
  const speedVal = document.getElementById('speed-val');

  pRange.addEventListener('input', () => setGrowth(parseFloat(pRange.value)));
  pNum.addEventListener('change', () => setGrowth(parseFloat(pNum.value)));
  pNum.addEventListener('keydown', (e) => { if (e.key === 'Enter') pNum.blur(); });

  fRange.addEventListener('input', () => setLightning(Math.pow(10, parseFloat(fRange.value))));
  fNum.addEventListener('change', () => setLightning(parseFloat(fNum.value)));
  fNum.addEventListener('keydown', (e) => { if (e.key === 'Enter') fNum.blur(); });

  lRange.addEventListener('change', () => setL(1 << parseFloat(lRange.value)));
  speedRange.addEventListener('input', () => setSpeed(parseFloat(speedRange.value)));

  document.getElementById('sim-toggle').addEventListener('click', () => running ? pause() : start());
  document.getElementById('sim-step').addEventListener('click', () => {
    step(); render(); updateReadout(); updateGraph();
  });
  document.getElementById('sim-reset').addEventListener('click', reset);

  /* ------------------------------------------------------------------ */
  /* Graph (Plotly)                                                      */
  /* ------------------------------------------------------------------ */
  const hasPlotly = typeof window.Plotly !== 'undefined';
  let graphReady = false;

  const FONT = { family: '"Courier New", Courier, monospace', size: 13, color: '#222' };

  function axis(title, extra) {
    return Object.assign({
      title: { text: title, standoff: 8, font: { size: 13 } },
      tickfont: { size: 12 },
      exponentformat: 'e',   // short scientific notation, e.g. 1e+3
      showexponent: 'all',
      gridcolor: GRID_COLOR,
      zeroline: false,
    }, extra || {});
  }

  function buildGraph() {
    if (!hasPlotly) {
      document.getElementById('sim-below').innerHTML =
        '<p class="sim-note">Plotly failed to load, so the live graph is unavailable ' +
        '(it needs an internet connection).</p>';
      return;
    }
    document.getElementById('sim-below').innerHTML =
      '<div class="sim-graph-grid single"><div id="g-fire" class="sim-graph"></div></div>';

    Plotly.newPlot('g-fire',
      [{ x: [], y: [], mode: 'markers', marker: GRAPHS.fire.marker }],
      {
        title: { text: GRAPHS.fire.title, font: { family: FONT.family, size: 13 } },
        margin: { l: 66, r: 16, t: 34, b: 50 },
        font: FONT,
        paper_bgcolor: PAGE_BG,
        plot_bgcolor: PAGE_BG,
        xaxis: axis(GRAPHS.fire.xlabel, { type: 'log' }),
        yaxis: axis(GRAPHS.fire.ylabel, { type: 'log' }),
        showlegend: false,
      },
      { responsive: true, displayModeBar: false });

    graphReady = true;
  }

  function updateGraph() {
    if (!graphReady) return;
    // Log-binned counts -> frequency density N(s), plotted log-log.
    const xs = [], ys = [];
    if (outbreaks > 0) {
      for (let b = 0; b < distHist.length; b++) {
        if (distHist[b] <= 0) continue;
        const lo = Math.pow(DIST_BASE, b);
        const hi = Math.pow(DIST_BASE, b + 1);
        xs.push(Math.sqrt(lo * hi));            // geometric bin centre
        ys.push(distHist[b] / ((hi - lo) * outbreaks));
      }
    }
    // restyle only — never relayout here. A relayout redraws the axis titles
    // as plain text and outruns MathJax's async typesetting, leaving the LaTeX
    // labels showing as raw '$s$'. Dynamic values live in the readout instead.
    Plotly.restyle('g-fire', { x: [xs], y: [ys] }, [0]);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  allocate();
  seedForest();
  resetStats();
  speedRange.value = speed;
  setSpeed(speed);
  setGrowth(growth);
  setLightning(lightning);
  setL(L);
  buildGraph();
  render();
  updateReadout();
  updateGraph();
})();
