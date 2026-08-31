/*
 * percolation.js — site percolation on a square lattice, with a repeated
 * p-sweep and four live-updating Plotly graphs.
 *
 * WHAT IT DOES
 *   Each sweep cycle draws one random field r[i] ~ U(0,1) for the whole
 *   lattice. Occupancy at threshold p is simply (r[i] < p), so as p rises the
 *   configuration grows monotonically. We visit a fixed grid of p-values
 *   (P_GRID) once per cycle, label clusters with union-find, and accumulate
 *   per-p statistics; over many cycles those averages converge. Independently,
 *   every cycle we also sample at exactly the slider value `pDisplay` and draw
 *   that lattice — this is the "enforce the sweep to hit it" part.
 *
 * THE FOUR GRAPHS (see updateGraphs)
 *   a) Mean finite cluster size  S(p) = <s^2>/<s> over finite clusters, vs p.
 *   b) Cluster-size distribution n_s vs s, at the displayed p (log-log).
 *   c) Percolation strength      P_inf(p) = (size of spanning cluster)/N, vs p.
 *   d) Spanning probability       Pi(p)  = fraction of samples that spanned, vs p.
 *
 * Spanning is defined here as a cluster touching both the top and bottom rows.
 *
 * TUNABLES: NP (sweep resolution), P_CRIT (reference line), DIST_BASE (log-bin
 * base for graph b), and the default L / pDisplay below.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const NP = 101;                 // number of p-grid points, p = 0 .. 1
  const P_CRIT = 0.592746;        // site-percolation threshold (square lattice)
  const DIST_BASE = 1.5;          // log-bin ratio for the size distribution
  const GRAPH_MS = 400;           // min ms between graph refreshes
  const FRAME_BUDGET_MS = 12;     // compute budget per animation frame

  const P_GRID = new Float64Array(NP);
  for (let k = 0; k < NP; k++) P_GRID[k] = k / (NP - 1);

  // Shared site palette (see engine.js -> SimTheme). Fallback inline so the
  // file still runs if the theme object is ever missing.
  const T = window.SimTheme || {};
  const ACCENT = T.accent || '#e67300';
  const PAGE_BG = T.panelBg || '#0b0b0b';
  const GRID_COLOR = T.grid || '#333333';

  // Lattice cell colours. Spanning cluster uses the accent (orange).
  const COLOR_EMPTY = T.empty || [11, 11, 11];    // dark ground
  const COLOR_FINITE = T.finite || [95, 95, 98];  // neutral gray
  const COLOR_SPAN = T.span || [230, 115, 0];     // orange accent

  /* ==================================================================== *
   *  EDIT ME — graph appearance.                                         *
   *  xlabel/ylabel accept LaTeX/MathJax between $...$ (like matplotlib),  *
   *  e.g. '$P_\\infty(p)$', '$k_{nn}$', '$\\Pi(p)$'. Backslashes must be  *
   *  doubled inside these JS strings.                                     *
   *  NOTE: `title` must be PLAIN TEXT — Plotly passes any string with     *
   *  $...$ to MathJax, which renders the math and drops the other words.  *
   *  marker.symbol: 'circle' | 'square' | 'diamond' | 'cross' | 'x' |     *
   *                 'triangle-up' | 'circle-open' | ... (Plotly symbols). *
   * ==================================================================== */
  const GRAPHS = {
    meanS: {
      title: 'Mean finite cluster size',
      xlabel: '$p$', ylabel: '$S(p)$',
      marker: { symbol: 'circle', size: 6, color: ACCENT },
    },
    dist: {
      title: 'Cluster-size distribution',
      xlabel: '$s$', ylabel: '$n_s$',
      marker: { symbol: 'circle', size: 6, color: ACCENT },
    },
    pinf: {
      title: 'Size of spanning cluster',
      xlabel: '$p$', ylabel: '$P_\\infty(p)$',
      marker: { symbol: 'circle', size: 6, color: ACCENT },
    },
    span: {
      title: 'Probability of a spanning cluster',
      xlabel: '$p$', ylabel: '$\\Pi(p)$',
      marker: { symbol: 'circle', size: 6, color: ACCENT },
    },
  };

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */
  const canvas = document.getElementById('sim-canvas');
  const ctx = canvas.getContext('2d');

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  let L = 128;                    // lattice side length (32..256, powers of two)
  let N = L * L;
  let pDisplay = 0.59;

  let field, parent, sz, img;     // typed arrays / ImageData, sized to N

  // Per-p-grid accumulators (curves a, c, d).
  let cnt, spanCnt, sumS, sumPinf;
  // Distribution accumulator at pDisplay (graph b).
  let distHist, distSamples;

  let cycle = 0;
  let sweepPos = 0;               // 0..NP-1 grid points, NP == display step
  let running = false;
  let rafId = null;
  let lastGraphTime = 0;
  let speed = 4;                  // displayed states per second (user slider)
  let nextDisplayTime = 0;        // gate so states appear at `speed` Hz

  /* ------------------------------------------------------------------ */
  /* Allocation / reset                                                  */
  /* ------------------------------------------------------------------ */
  function allocate() {
    N = L * L;
    field = new Float32Array(N);
    parent = new Int32Array(N);
    sz = new Int32Array(N);
    canvas.width = L;
    canvas.height = L;
    img = ctx.createImageData(L, L);
    // Opaque alpha channel, set once.
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
  }

  function resetStats() {
    cnt = new Float64Array(NP);
    spanCnt = new Float64Array(NP);
    sumS = new Float64Array(NP);
    sumPinf = new Float64Array(NP);
    cycle = 0;
    sweepPos = 0;
    resetDistribution();
  }

  function resetDistribution() {
    // Enough log-bins to cover sizes up to N.
    const nbins = Math.ceil(Math.log(N + 1) / Math.log(DIST_BASE)) + 1;
    distHist = new Float64Array(nbins);
    distSamples = 0;
  }

  function newField() {
    for (let i = 0; i < N; i++) field[i] = Math.random();
  }

  /* ------------------------------------------------------------------ */
  /* Union-find                                                          */
  /* ------------------------------------------------------------------ */
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  }

  function unite(a, b) {
    let ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (sz[ra] < sz[rb]) { const t = ra; ra = rb; rb = t; }
    parent[rb] = ra;
    sz[ra] += sz[rb];
  }

  /*
   * Label the configuration (field[i] < p) and compute statistics.
   * opts.dist  -> accumulate the cluster-size distribution
   * opts.render-> returns spanningRoots so the caller can colour the lattice
   */
  function computeAt(p, opts) {
    opts = opts || {};

    // Initialise union-find: occupied cells are their own singleton clusters.
    for (let i = 0; i < N; i++) {
      if (field[i] < p) { parent[i] = i; sz[i] = 1; }
      else { parent[i] = -1; }
    }

    // Union each occupied cell with its left and upper neighbours.
    for (let y = 0; y < L; y++) {
      const row = y * L;
      for (let x = 0; x < L; x++) {
        const i = row + x;
        if (parent[i] < 0) continue;
        if (x > 0 && parent[i - 1] >= 0) unite(i, i - 1);
        if (y > 0 && parent[i - L] >= 0) unite(i, i - L);
      }
    }

    // Spanning = a cluster present in both the top and bottom rows.
    const topRoots = new Set();
    for (let x = 0; x < L; x++) {
      const i = x;
      if (parent[i] >= 0) topRoots.add(find(i));
    }
    const spanningRoots = new Set();
    const base = (L - 1) * L;
    for (let x = 0; x < L; x++) {
      const i = base + x;
      if (parent[i] >= 0) {
        const r = find(i);
        if (topRoots.has(r)) spanningRoots.add(r);
      }
    }

    // Largest spanning cluster (order parameter) and finite-cluster moments.
    let spanSize = 0;
    for (const r of spanningRoots) if (sz[r] > spanSize) spanSize = sz[r];

    let sumFin = 0, sumFinSq = 0;
    for (let i = 0; i < N; i++) {
      if (parent[i] === i) {           // cluster root
        if (spanningRoots.has(i)) continue;
        const s = sz[i];
        sumFin += s;
        sumFinSq += s * s;
        if (opts.dist) {
          const b = Math.floor(Math.log(s) / Math.log(DIST_BASE));
          distHist[b] += 1;
        }
      }
    }
    if (opts.dist) distSamples++;

    return {
      meanFiniteS: sumFin > 0 ? sumFinSq / sumFin : 0,
      pInf: spanSize / N,
      spanning: spanningRoots.size > 0,
      spanSize: spanSize,
      spanningRoots: opts.render ? spanningRoots : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function renderCurrent(spanningRoots) {
    const d = img.data;
    for (let i = 0; i < N; i++) {
      let c;
      if (parent[i] < 0) c = COLOR_EMPTY;
      else if (spanningRoots.has(find(i))) c = COLOR_SPAN;
      else c = COLOR_FINITE;
      const o = i << 2;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
    }
    ctx.putImageData(img, 0, 0);
  }

  // Sample + draw at pDisplay using the current field, without accumulating.
  function renderDisplayOnly() {
    const r = computeAt(pDisplay, { render: true });
    renderCurrent(r.spanningRoots);
    updateReadout(r);
  }


  /*
   * Report the live figures. Goes through engine.js so every simulation
   * lays them out identically — but guarded, because a browser holding a
   * cached older engine.js would otherwise throw here during boot and take
   * the whole simulation down with it, graphs included.
   */
  function readout(rows) {
    if (window.Sim && typeof Sim.readout === 'function') Sim.readout(rows);
  }

  function updateReadout(r) {
    readout([
      ['lattice', L + ' \u00d7 ' + L],
      ['p', pDisplay.toFixed(3)],
      ['cycles', cycle.toLocaleString()],
      ['spanning', r ? (r.spanning ? 'yes' : 'no') : '\u2014', r && r.spanning],
      ['P\u221e', r ? r.pInf.toFixed(3) : null],
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* Sweep stepping                                                      */
  /* ------------------------------------------------------------------ */
  // Compute + accumulate statistics for the next grid point.
  function advanceGridPoint() {
    const p = P_GRID[sweepPos];
    const r = computeAt(p, {});
    cnt[sweepPos] += 1;
    if (r.spanning) spanCnt[sweepPos] += 1;
    sumS[sweepPos] += r.meanFiniteS;
    sumPinf[sweepPos] += r.pInf;
    sweepPos++;
  }

  // Finish a cycle: sample exactly at pDisplay, draw that state, feed graph (b),
  // then draw a brand-new random field for the next cycle.
  function doDisplay() {
    const r = computeAt(pDisplay, { dist: true, render: true });
    renderCurrent(r.spanningRoots);
    updateReadout(r);
    cycle++;
    newField();
    sweepPos = 0;
  }

  function frame() {
    if (!running) return;

    // Advance the (possibly slow) grid sweep within a per-frame time budget.
    const start = performance.now();
    while (sweepPos < NP && performance.now() - start < FRAME_BUDGET_MS) {
      advanceGridPoint();
    }

    const now = performance.now();
    if (sweepPos >= NP) {
      // Grid finished; present the next state only when the speed gate allows.
      if (now >= nextDisplayTime) {
        doDisplay();
        nextDisplayTime = now + 1000 / speed;
        updateGraphs();
        lastGraphTime = now;
      }
    } else if (now - lastGraphTime > GRAPH_MS) {
      // Big lattice mid-sweep: keep the curves ticking over.
      updateGraphs();
      lastGraphTime = now;
    }
    rafId = requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */
  function start() {
    if (running) return;
    running = true;
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
    resetStats();
    newField();
    nextDisplayTime = 0;
    renderDisplayOnly();
    updateGraphs();
  }

  function setP(v) {
    if (isNaN(v)) { pNum.value = pDisplay.toFixed(3); return; }
    v = Math.max(0, Math.min(1, v));
    pDisplay = v;
    pRange.value = v;
    pNum.value = v.toFixed(3);
    resetDistribution();        // distribution is p-specific
    if (!running) renderDisplayOnly();
    updateGraphs();             // refresh graph (b) title/data immediately
  }

  function setSpeed(v) {
    speed = Math.max(0.5, Math.min(30, v));
    speedVal.textContent = speed + ' / s';
    nextDisplayTime = 0;        // apply the new rate right away
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
    resetStats();
    newField();
    renderDisplayOnly();
    updateGraphs();
    if (wasRunning) start();
  }

  // --- Build the parameter UI underneath the buttons (#sim-params) ---
  const params = document.getElementById('sim-params');
  params.innerHTML =
    '<div class="control">' +
    '  <label>p (occupation)</label>' +
    '  <div class="p-row">' +
    '    <input type="range" id="p-range" min="0" max="1" step="0.001">' +
    '    <input type="text" id="p-num" inputmode="decimal">' +
    '  </div>' +
    '</div>' +
    '<div class="control">' +
    '  <label>Lattice size: <span id="L-val"></span></label>' +
    '  <input type="range" id="L-range" min="5" max="8" step="1">' +   // 2^5..2^8 = 32..256
    '</div>' +
    '<div class="control">' +
    '  <label>Speed: <span id="speed-val"></span></label>' +
    '  <input type="range" id="speed-range" min="0.5" max="30" step="0.5">' +
    '</div>';

  const pRange = document.getElementById('p-range');
  const pNum = document.getElementById('p-num');
  const lRange = document.getElementById('L-range');
  const lVal = document.getElementById('L-val');
  const speedRange = document.getElementById('speed-range');
  const speedVal = document.getElementById('speed-val');

  // While dragging the slider the text box just mirrors its value; the box is
  // only "input" when focused, and commits on Enter or blur.
  pRange.addEventListener('input', () => setP(parseFloat(pRange.value)));
  pNum.addEventListener('change', () => setP(parseFloat(pNum.value)));
  pNum.addEventListener('keydown', (e) => { if (e.key === 'Enter') pNum.blur(); });
  lRange.addEventListener('change', () => setL(1 << parseFloat(lRange.value)));
  speedRange.addEventListener('input', () => setSpeed(parseFloat(speedRange.value)));

  document.getElementById('sim-toggle').addEventListener('click', () => running ? pause() : start());
  document.getElementById('sim-step').addEventListener('click', () => {
    // One full cycle per Step press, so the graphs move visibly.
    while (sweepPos < NP) advanceGridPoint();
    doDisplay();
    updateGraphs();
  });
  document.getElementById('sim-reset').addEventListener('click', reset);

  /* ------------------------------------------------------------------ */
  /* Graphs (Plotly)                                                     */
  /* ------------------------------------------------------------------ */
  const hasPlotly = typeof window.Plotly !== 'undefined';
  let graphsReady = false;

  const FONT = { family: T.font || 'Verdana, Geneva, Tahoma, sans-serif', size: 12, color: T.text || '#9a9a9a' };

  // Shared axis defaults: short scientific-notation ticks, readable font.
  /*
   * Axis config. The y-axis title is set a size larger than the x: it is
   * usually the one carrying $...$ math, and MathJax renders noticeably
   * smaller than the surrounding sans-serif at the same nominal size.
   */
  function axis(title, extra, size) {
    return Object.assign({
      title: { text: title, standoff: 10, font: { size: size || 14 } },
      tickfont: { size: 12 },
      exponentformat: 'e',   // short scientific notation, e.g. 1e+3
      showexponent: 'all',
      gridcolor: GRID_COLOR,
      zeroline: false,
    }, extra || {});
  }

  function baseLayout(title, xtitle, ytitle, xExtra, yExtra, extra) {
    return Object.assign({
      margin: { l: 64, r: 30, t: 14, b: 52 },
      font: FONT,
      paper_bgcolor: PAGE_BG,
      plot_bgcolor: PAGE_BG,
      xaxis: axis(xtitle, xExtra),
      yaxis: axis(ytitle, yExtra, 17),
      showlegend: false,
    }, extra || {});
  }

  // Vertical p_c reference line for the p-axis plots.
  const pcLine = {
    type: 'line', x0: P_CRIT, x1: P_CRIT, y0: 0, y1: 1, yref: 'paper',
    line: { color: ACCENT, width: 1, dash: 'dot' },
  };


  /*
   * One graph: the framed plot, with its title underneath as a caption the
   * way a figure in a paper carries one. Plotly's own `title` sat inside the
   * plot area and ate vertical space; out here it reads as a label for the
   * whole panel and the plot gets the room back. The (a)/(b)/(c) marker is
   * a CSS counter — see .sim-caption in components/simulation.scss.
   */
  function figure(plotId, caption) {
    return '<figure class="sim-figure">' +
           '<div class="sim-graph"><div id="' + plotId + '" class="sim-plot"></div></div>' +
           '<figcaption class="sim-caption">' + caption + '</figcaption>' +
           '</figure>';
  }

  function buildGraphs() {
    if (!hasPlotly) {
      document.getElementById('sim-below').innerHTML =
        '<p class="sim-note">Plotly failed to load, so the live graphs are unavailable ' +
        '(they need an internet connection).</p>';
      return;
    }
    const below = document.getElementById('sim-below');
    below.innerHTML =
      '<div class="sim-graph-grid">' +
      figure('g-meanS', GRAPHS.meanS.title) +
      figure('g-dist',  GRAPHS.dist.title) +
      figure('g-pinf',  GRAPHS.pinf.title) +
      figure('g-span',  GRAPHS.span.title) +
      '</div>';

    const cfg = { responsive: true, displayModeBar: false };
    const px = Array.from(P_GRID);
    const pAxis = { exponentformat: 'none' };   // p in [0,1]: plain decimals
    const unitAxis = { exponentformat: 'none', range: [-0.02, 1.02] };
    const logAxis = { type: 'log' };
    const empty = px.map(() => null);
    const trace = (g) => ({ x: px, y: empty, mode: 'markers', marker: GRAPHS[g].marker });

    Plotly.newPlot('g-meanS',
      [trace('meanS')],
      baseLayout(GRAPHS.meanS.title, GRAPHS.meanS.xlabel, GRAPHS.meanS.ylabel,
        pAxis, { tickformat: '~e' }, { shapes: [pcLine] }), cfg);

    Plotly.newPlot('g-dist',
      [{ x: [], y: [], mode: 'markers', marker: GRAPHS.dist.marker }],
      baseLayout(GRAPHS.dist.title, GRAPHS.dist.xlabel, GRAPHS.dist.ylabel, logAxis, logAxis), cfg);

    Plotly.newPlot('g-pinf',
      [trace('pinf')],
      baseLayout(GRAPHS.pinf.title, GRAPHS.pinf.xlabel, GRAPHS.pinf.ylabel,
        pAxis, unitAxis, { shapes: [pcLine] }), cfg);

    Plotly.newPlot('g-span',
      [trace('span')],
      baseLayout(GRAPHS.span.title, GRAPHS.span.xlabel, GRAPHS.span.ylabel,
        pAxis, unitAxis, { shapes: [pcLine] }), cfg);

    graphsReady = true;
  }

  function updateGraphs() {
    if (!graphsReady) return;

    const ya = new Array(NP), yc = new Array(NP), yd = new Array(NP);
    for (let k = 0; k < NP; k++) {
      const n = cnt[k];
      ya[k] = n > 0 ? sumS[k] / n : null;
      yc[k] = n > 0 ? sumPinf[k] / n : null;
      yd[k] = n > 0 ? spanCnt[k] / n : null;
    }
    Plotly.restyle('g-meanS', { y: [ya] }, [0]);
    Plotly.restyle('g-pinf', { y: [yc] }, [0]);
    Plotly.restyle('g-span', { y: [yd] }, [0]);

    // Distribution: convert log-bin counts to a density n_s vs geometric size.
    const xs = [], ys = [];
    if (distSamples > 0) {
      for (let b = 0; b < distHist.length; b++) {
        if (distHist[b] <= 0) continue;
        const lo = Math.pow(DIST_BASE, b);
        const hi = Math.pow(DIST_BASE, b + 1);
        const width = hi - lo;
        const center = Math.sqrt(lo * hi);
        xs.push(center);
        ys.push(distHist[b] / (width * distSamples * N));
      }
    }
    // restyle only — never relayout here. A relayout redraws the axis titles
    // as plain text and outruns MathJax's async typesetting, leaving the LaTeX
    // labels showing as raw '$n_s$'. The current p lives in the readout.
    Plotly.restyle('g-dist', { x: [xs], y: [ys] }, [0]);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  allocate();
  resetStats();
  newField();
  speedRange.value = speed;
  setSpeed(speed);      // syncs the speed slider label
  setP(pDisplay);       // syncs the p slider + text box
  setL(L);              // syncs the size slider label (also renders)
  buildGraphs();
  renderDisplayOnly();
  updateGraphs();
})();
