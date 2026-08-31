/*
 * sandpile.js — Bak–Tang–Wiesenfeld abelian sandpile, with a live
 * avalanche-size distribution and the self-organization curve.
 *
 * WHAT IT DOES
 *   Every cell holds a grain count. A grain is dropped (centre or random);
 *   any cell reaching 4 topples, giving one grain to each of its four
 *   neighbours. Toppling can push neighbours over the threshold, so one
 *   grain can set off a chain reaction. Grains that topple off the edge are
 *   lost — that open boundary is what lets the pile reach a steady state
 *   instead of filling forever.
 *
 *   Relaxation runs as PARALLEL SWEEPS rather than a stack drain: every
 *   unstable cell topples at once, then the next sweep runs. Two reasons —
 *   the avalanche spreads visibly across the lattice a ring at a time, and
 *   the sweep count is the avalanche's duration, which a stack cannot tell
 *   you. The final configuration is identical either way; that is the
 *   "abelian" in the name.
 *
 *   Left alone from any starting configuration the pile drives itself to a
 *   critical density where avalanche sizes have no characteristic scale —
 *   about 2.125 grains per site under the classic rule. That is the whole
 *   point of the model, and both graphs are there to show it happening.
 *
 *   Two rulesets are offered: topple to the 4 edge-neighbours (classic BTW,
 *   threshold 4), or to all 8 including the corners (threshold 8). See
 *   RULESETS below for why the threshold has to move with the neighbourhood.
 *
 * TUNABLES: DIST_BASE (log-bin ratio), and the defaults for L / speed.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  /*
   * RULESETS.
   *
   * The classic BTW rule topples to the four edge-neighbours at a threshold
   * of 4. The Moore variant feeds the diagonals too — and the threshold has
   * to rise to 8 with it, because a toppling cell gives exactly one grain to
   * each neighbour it has. Keep the threshold at 4 while handing out 8 grains
   * and the pile would manufacture sand out of nothing.
   *
   * A higher threshold means taller resting piles: heights run 0..3 under the
   * 4-rule and 0..7 under the 8-rule, and the critical density roughly
   * doubles. 2.125 is the published figure for the 4-neighbour rule; the
   * 8-neighbour one is measured here (250k random drops at L=128, where it
   * settles near 4.44 and climbs slowly with system size).
   */
  const RULESETS = {
    4: { threshold: 4, diagonals: false, critical: 2.125 },
    8: { threshold: 8, diagonals: true,  critical: 4.45 },
  };
  const DIST_BASE = 1.4;          // log-bin ratio for the avalanche histogram
  const GRAPH_MS = 400;           // min ms between graph refreshes
  const MAX_STEPS_PER_FRAME = 400;// ticks per frame ceiling, so speed can't jank
  const DENSITY_POINTS = 400;     // samples kept for the self-organization curve

  const T = window.SimTheme || {};
  const ACCENT = T.accent || '#e67300';
  const PAGE_BG = T.panelBg || '#0b0b0b';
  const GRID_COLOR = T.grid || '#333333';

  /*
   * Height palette — one hue, four brightnesses.
   *
   * The lattice only ever shows 0..3 grains when it is at rest, so the
   * height IS the brightness: an empty site is nearly the panel ground and
   * a critical site (3, one grain from toppling) is full accent. Mid-topple
   * a cell can hold 4+ for a single sweep; those flash pale so the avalanche
   * front is visible as it travels.
   */
  const HEIGHT_LO = [26, 15, 4];            // empty — barely above the ground
  const HEIGHT_HI = [255, 140, 32];         // one grain from toppling
  const COLOR_TOPPLING = [255, 226, 186];   // at or over threshold, mid-avalanche

  // Rebuilt whenever the ruleset changes: 4 steps for the edge rule, 8 for
  // the Moore rule, always spanning the same two endpoints.
  let HEIGHT_COLORS = [];
  function buildPalette() {
    HEIGHT_COLORS = [];
    const top = THRESHOLD - 1;
    for (let v = 0; v <= top; v++) {
      const t = top === 0 ? 1 : v / top;
      HEIGHT_COLORS.push([
        Math.round(HEIGHT_LO[0] + (HEIGHT_HI[0] - HEIGHT_LO[0]) * t),
        Math.round(HEIGHT_LO[1] + (HEIGHT_HI[1] - HEIGHT_LO[1]) * t),
        Math.round(HEIGHT_LO[2] + (HEIGHT_HI[2] - HEIGHT_LO[2]) * t),
      ]);
    }
  }

  /* ==================================================================== *
   *  EDIT ME — graph appearance.                                         *
   *  xlabel/ylabel accept LaTeX/MathJax between $...$ (like matplotlib),  *
   *  e.g. '$N(s)$'. Backslashes must be doubled in JS.                    *
   *  NOTE: `title` must be PLAIN TEXT — Plotly passes any string with     *
   *  $...$ to MathJax, which renders the math and drops the other words.  *
   * ==================================================================== */
  const GRAPHS = {
    dist: {
      title: 'Avalanche-size distribution',
      xlabel: '$s$', ylabel: '$N(s)$',
      marker: { symbol: 'circle', size: 6, color: ACCENT },
    },
    density: {
      title: 'Self-organization to the critical density',
      xlabel: 'avalanches', ylabel: '$\\langle h \\rangle$',
      line: { color: ACCENT, width: 2 },
      criticalColor: '#7a7a7a',   // the reference value comes from RULESETS
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
  let L = 128;                    // lattice side (64..256, powers of two)
  let N = L * L;
  let ruleset = 4;                // 4 (edges) | 8 (edges + corners)
  let THRESHOLD = RULESETS[4].threshold;
  let diagonals = RULESETS[4].diagonals;
  let dropMode = 'center';        // 'center' | 'random'
  let startMode = 'empty';        // 'empty' | 'half' | 'full' | 'random'
  let speed = 60;                 // ticks per second

  let h, img;                     // heights, and the ImageData we blit
  let cur, nxt, queued;           // parallel-sweep frontier + dedup stamps
  let curN = 0, stamp = 0;
  let areaStamp, avId = 0;        // distinct-sites-toppled marker

  // Current avalanche
  let avSize = 0, avArea = 0, avDur = 0, avActive = false;

  // Aggregates
  let distHist, avalanches = 0, biggest = 0, grains = 0, totalGrains = 0;
  let densityX, densityY, densityN = 0, densityEvery = 1;

  let running = false, rafId = null, nextStepTime = 0, lastGraphTime = 0;

  /* ------------------------------------------------------------------ */
  /* Allocation / reset                                                  */
  /* ------------------------------------------------------------------ */
  function allocate() {
    N = L * L;
    h = new Uint8Array(N);        // heights stay small; 4+ only mid-sweep
    cur = new Int32Array(N);
    nxt = new Int32Array(N);
    queued = new Int32Array(N);
    areaStamp = new Int32Array(N);
    stamp = 0; avId = 0;
    canvas.width = L;
    canvas.height = L;
    img = ctx.createImageData(L, L);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
  }

  /*
   * Initial configuration. Every one of these relaxes to the same critical
   * state eventually — 'full' just gets there in one enormous opening
   * avalanche, which is worth watching once.
   */
  function seed() {
    switch (startMode) {
      case 'half':   h.fill(THRESHOLD >> 1); break;
      case 'full':   h.fill(THRESHOLD - 1); break;
      case 'random': for (let i = 0; i < N; i++) h[i] = (Math.random() * THRESHOLD) | 0; break;
      default:       h.fill(0);
    }
    totalGrains = 0;
    for (let i = 0; i < N; i++) totalGrains += h[i];
    curN = 0;
    avActive = false;
    avSize = avArea = avDur = 0;
    grains = 0;
    // A non-empty start may already be unstable; let it settle on its own.
    primeFrontier();
  }

  // Seed the sweep frontier with every cell that is already over threshold.
  function primeFrontier() {
    stamp++;
    curN = 0;
    for (let i = 0; i < N; i++) {
      if (h[i] >= THRESHOLD && queued[i] !== stamp) {
        queued[i] = stamp;
        cur[curN++] = i;
      }
    }
    if (curN > 0) {
      avActive = true;
      avId++;
      avSize = avArea = avDur = 0;
    }
  }

  function resetStats() {
    const nbins = Math.ceil(Math.log(N + 1) / Math.log(DIST_BASE)) + 2;
    distHist = new Float64Array(nbins);
    avalanches = 0;
    biggest = 0;
    densityX = new Float64Array(DENSITY_POINTS);
    densityY = new Float64Array(DENSITY_POINTS);
    densityN = 0;
    densityEvery = 1;
  }

  /* ------------------------------------------------------------------ */
  /* Model                                                               */
  /* ------------------------------------------------------------------ */
  function dropGrain() {
    let i;
    if (dropMode === 'center') {
      i = ((L >> 1) * L) + (L >> 1);
    } else {
      i = (Math.random() * N) | 0;
    }
    h[i]++;
    grains++;
    totalGrains++;

    avId++;
    avSize = avArea = avDur = 0;

    if (h[i] >= THRESHOLD) {
      stamp++;
      curN = 0;
      queued[i] = stamp;
      cur[curN++] = i;
      avActive = true;
    } else {
      // A grain that topples nothing is still an avalanche — of size zero.
      recordAvalanche();
    }
  }

  /*
   * One parallel sweep: every currently unstable cell topples, then their
   * neighbours are collected into the next frontier. Returns false when the
   * pile has come to rest.
   */
  function sweep() {
    if (curN === 0) return false;
    avDur++;

    // Topple everything on the frontier first, so the sweep is simultaneous.
    for (let k = 0; k < curN; k++) {
      const i = cur[k];
      h[i] -= THRESHOLD;
      avSize++;
      if (areaStamp[i] !== avId) { areaStamp[i] = avId; avArea++; }
    }

    // Then hand out the grains and gather whoever that destabilises.
    stamp++;
    let nxtN = 0;
    for (let k = 0; k < curN; k++) {
      const i = cur[k];
      const x = i % L;
      const y = (i / L) | 0;

      // Grains leaving the lattice are simply lost — the open boundary.
      const wLeft = x > 0, wRight = x < L - 1, wUp = y > 0, wDown = y < L - 1;

      if (wLeft)  { const n = i - 1; if (++h[n] >= THRESHOLD && queued[n] !== stamp) { queued[n] = stamp; nxt[nxtN++] = n; } } else totalGrains--;
      if (wRight) { const n = i + 1; if (++h[n] >= THRESHOLD && queued[n] !== stamp) { queued[n] = stamp; nxt[nxtN++] = n; } } else totalGrains--;
      if (wUp)    { const n = i - L; if (++h[n] >= THRESHOLD && queued[n] !== stamp) { queued[n] = stamp; nxt[nxtN++] = n; } } else totalGrains--;
      if (wDown)  { const n = i + L; if (++h[n] >= THRESHOLD && queued[n] !== stamp) { queued[n] = stamp; nxt[nxtN++] = n; } } else totalGrains--;

      // The four corners, under the Moore ruleset.
      if (diagonals) {
        if (wLeft  && wUp)   { const n = i - L - 1; if (++h[n] >= THRESHOLD && queued[n] !== stamp) { queued[n] = stamp; nxt[nxtN++] = n; } } else totalGrains--;
        if (wRight && wUp)   { const n = i - L + 1; if (++h[n] >= THRESHOLD && queued[n] !== stamp) { queued[n] = stamp; nxt[nxtN++] = n; } } else totalGrains--;
        if (wLeft  && wDown) { const n = i + L - 1; if (++h[n] >= THRESHOLD && queued[n] !== stamp) { queued[n] = stamp; nxt[nxtN++] = n; } } else totalGrains--;
        if (wRight && wDown) { const n = i + L + 1; if (++h[n] >= THRESHOLD && queued[n] !== stamp) { queued[n] = stamp; nxt[nxtN++] = n; } } else totalGrains--;
      }

      // A cell that took enough from its own neighbours topples again.
      if (h[i] >= THRESHOLD && queued[i] !== stamp) { queued[i] = stamp; nxt[nxtN++] = i; }
    }

    const swap = cur; cur = nxt; nxt = swap;
    curN = nxtN;

    if (curN === 0) {
      avActive = false;
      recordAvalanche();
      return false;
    }
    return true;
  }

  function recordAvalanche() {
    avalanches++;
    if (avSize > biggest) biggest = avSize;

    if (avSize > 0) {
      const b = Math.floor(Math.log(avSize) / Math.log(DIST_BASE));
      if (b >= 0 && b < distHist.length) distHist[b]++;
    }

    // Density trace. Once the buffer fills, halve the resolution and keep
    // going — the curve stays complete instead of scrolling away.
    if (avalanches % densityEvery === 0) {
      if (densityN >= DENSITY_POINTS) {
        for (let k = 0; k < DENSITY_POINTS >> 1; k++) {
          densityX[k] = densityX[k * 2];
          densityY[k] = densityY[k * 2];
        }
        densityN = DENSITY_POINTS >> 1;
        densityEvery *= 2;
      }
      densityX[densityN] = avalanches;
      densityY[densityN] = totalGrains / N;
      densityN++;
    }
  }

  // One tick: settle an avalanche in progress, or start a new one.
  function tick() {
    if (avActive) sweep();
    else dropGrain();
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  function render() {
    const d = img.data;
    for (let i = 0; i < N; i++) {
      const v = h[i];
      const c = v >= THRESHOLD ? COLOR_TOPPLING : HEIGHT_COLORS[v];
      const p = i << 2;
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
    }
    ctx.putImageData(img, 0, 0);
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

  function updateReadout() {
    readout([
      ['lattice', L + ' × ' + L],
      ['ruleset', ruleset + '-neighbour'],
      ['mean height', (totalGrains / N).toFixed(3)],
      ['grains', grains.toLocaleString()],
      ['avalanches', avalanches.toLocaleString()],
      ['largest', biggest.toLocaleString() + ' topples'],
      avActive
        ? ['toppling', avSize.toLocaleString() + ' · t = ' + avDur, true]
        : ['last avalanche', avSize.toLocaleString() + ' · area ' + avArea.toLocaleString()],
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* Loop                                                                */
  /* ------------------------------------------------------------------ */
  function frame(now) {
    if (!running) return;
    const interval = 1000 / speed;
    let steps = 0;
    while (now >= nextStepTime && steps < MAX_STEPS_PER_FRAME) {
      tick();
      nextStepTime += interval;
      steps++;
    }
    // If we fell far behind (tab was backgrounded), don't try to catch up.
    if (now - nextStepTime > 500) nextStepTime = now;

    if (steps > 0) { render(); updateReadout(); }
    if (now - lastGraphTime > GRAPH_MS) { updateGraph(); lastGraphTime = now; }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    nextStepTime = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function reset() {
    const wasRunning = running;
    pause();
    seed();
    resetStats();
    render();
    updateReadout();
    updateGraph();
    if (wasRunning) start();
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */
  function setL(v) {
    let e = Math.round(Math.log(v) / Math.LN2);
    e = Math.max(6, Math.min(8, e));
    L = 1 << e;
    lRange.value = e;
    lVal.textContent = L + ' × ' + L;
    const wasRunning = running;
    pause();
    allocate();
    seed();
    resetStats();
    render();
    updateReadout();
    updateGraph();
    if (wasRunning) start();
  }

  function setSpeed(v) {
    speed = Math.max(1, Math.min(2000, v));
    speedVal.textContent = speed + ' / s';
    nextStepTime = performance.now();
  }

  const params = document.getElementById('sim-params');
  params.innerHTML =
    '<div class="control">' +
    '  <label>Topple to</label>' +
    '  <div class="seg" role="group" aria-label="Toppling ruleset">' +
    '    <button type="button" class="seg-btn" data-rule="4" aria-pressed="true">4 · edges</button>' +
    '    <button type="button" class="seg-btn" data-rule="8" aria-pressed="false">8 · corners</button>' +
    '  </div>' +
    '</div>' +
    '<div class="control">' +
    '  <label for="drop-mode">Drop grains</label>' +
    '  <select id="drop-mode">' +
    '    <option value="center">At the centre</option>' +
    '    <option value="random">At random sites</option>' +
    '  </select>' +
    '</div>' +
    '<div class="control">' +
    '  <label for="start-mode">Initial state</label>' +
    '  <select id="start-mode">' +
    '    <option value="empty">Empty (0)</option>' +
    '    <option value="half">Half full (2)</option>' +
    '    <option value="full">Maximally full (3)</option>' +
    '    <option value="random">Random (0–3)</option>' +
    '  </select>' +
    '</div>' +
    '<div class="control">' +
    '  <label>Lattice size: <span id="L-val"></span></label>' +
    '  <input type="range" id="L-range" min="6" max="8" step="1">' +
    '</div>' +
    '<div class="control">' +
    '  <label>Speed: <span id="speed-val"></span></label>' +
    '  <input type="range" id="speed-range" min="1" max="2000" step="1">' +
    '</div>';

  /*
   * Ruleset toggle. Two buttons acting as one control: the selected one stays
   * lit. aria-pressed carries the state for assistive tech, and .btn3d keys
   * its lit face off that same attribute, so there is one source of truth.
   */
  function setRuleset(v) {
    const r = RULESETS[v];
    if (!r || v === ruleset) return;
    ruleset = v;
    THRESHOLD = r.threshold;
    diagonals = r.diagonals;
    buildPalette();
    for (const b of segButtons) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.rule) === ruleset));
    }
    reset();                    // heights and statistics are ruleset-specific
  }

  const segButtons = Array.prototype.slice.call(params.querySelectorAll('.seg-btn'));
  for (const b of segButtons) {
    b.addEventListener('click', () => setRuleset(Number(b.dataset.rule)));
  }

  const dropSel = document.getElementById('drop-mode');
  const startSel = document.getElementById('start-mode');
  const lRange = document.getElementById('L-range');
  const lVal = document.getElementById('L-val');
  const speedRange = document.getElementById('speed-range');
  const speedVal = document.getElementById('speed-val');

  dropSel.value = dropMode;
  startSel.value = startMode;

  // Changing where grains land changes the statistics, so start over.
  dropSel.addEventListener('change', () => { dropMode = dropSel.value; reset(); });
  startSel.addEventListener('change', () => { startMode = startSel.value; reset(); });
  lRange.addEventListener('change', () => setL(1 << parseFloat(lRange.value)));
  speedRange.addEventListener('input', () => setSpeed(parseFloat(speedRange.value)));

  document.getElementById('sim-toggle').addEventListener('click', () => running ? pause() : start());
  document.getElementById('sim-step').addEventListener('click', () => {
    tick(); render(); updateReadout(); updateGraph();
  });
  document.getElementById('sim-reset').addEventListener('click', reset);

  /* ------------------------------------------------------------------ */
  /* Graphs (Plotly)                                                     */
  /* ------------------------------------------------------------------ */
  const hasPlotly = typeof window.Plotly !== 'undefined';
  let graphReady = false;

  const FONT = { family: T.font || 'Verdana, Geneva, Tahoma, sans-serif', size: 12, color: T.text || '#9a9a9a' };

  /*
   * Axis config. The y-axis title is set a size larger than the x: it is
   * usually the one carrying $...$ math, and MathJax renders noticeably
   * smaller than the surrounding sans-serif at the same nominal size.
   */
  function axis(title, extra, size) {
    return Object.assign({
      title: { text: title, standoff: 10, font: { size: size || 14 } },
      tickfont: { size: 12 },
      exponentformat: 'e',
      showexponent: 'all',
      gridcolor: GRID_COLOR,
      zeroline: false,
    }, extra || {});
  }

  function baseLayout(g, xExtra, yExtra) {
    return {
      margin: { l: 64, r: 30, t: 14, b: 52 },
      font: FONT,
      paper_bgcolor: PAGE_BG,
      plot_bgcolor: PAGE_BG,
      xaxis: axis(g.xlabel, xExtra),
      yaxis: axis(g.ylabel, yExtra, 17),
      showlegend: false,
    };
  }


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

  function buildGraph() {
    if (!hasPlotly) {
      document.getElementById('sim-below').innerHTML =
        '<p class="sim-note">Plotly failed to load, so the live graphs are unavailable ' +
        '(they need an internet connection).</p>';
      return;
    }
    document.getElementById('sim-below').innerHTML =
      '<div class="sim-graph-grid">' +
      figure('g-dist', GRAPHS.dist.title) +
      figure('g-density', GRAPHS.density.title) +
      '</div>';

    Plotly.newPlot('g-dist',
      [{ x: [], y: [], mode: 'markers', marker: GRAPHS.dist.marker }],
      baseLayout(GRAPHS.dist, { type: 'log' }, { type: 'log' }),
      { responsive: true, displayModeBar: false });

    // The critical density is drawn once as a reference line and never touched
    // again; the live trace is index 0 so restyle can target it alone.
    Plotly.newPlot('g-density',
      [
        { x: [], y: [], mode: 'lines', line: GRAPHS.density.line },
        {
          x: [0, 1], y: [RULESETS[ruleset].critical, RULESETS[ruleset].critical],
          mode: 'lines',
          line: { color: GRAPHS.density.criticalColor, width: 1, dash: 'dot' },
          hoverinfo: 'skip',
        },
      ],
      baseLayout(GRAPHS.density),
      { responsive: true, displayModeBar: false });

    graphReady = true;
  }

  function updateGraph() {
    if (!graphReady) return;

    // Log-binned counts -> frequency density N(s), plotted log-log.
    const xs = [], ys = [];
    if (avalanches > 0) {
      for (let b = 0; b < distHist.length; b++) {
        if (distHist[b] <= 0) continue;
        const lo = Math.pow(DIST_BASE, b);
        const hi = Math.pow(DIST_BASE, b + 1);
        xs.push(Math.sqrt(lo * hi));            // geometric bin centre
        ys.push(distHist[b] / ((hi - lo) * avalanches));
      }
    }
    Plotly.restyle('g-dist', { x: [xs], y: [ys] }, [0]);

    const dx = Array.prototype.slice.call(densityX.subarray(0, densityN));
    const dy = Array.prototype.slice.call(densityY.subarray(0, densityN));
    // Stretch the reference line to whatever the trace currently spans.
    const xmax = densityN > 0 ? densityX[densityN - 1] : 1;
    Plotly.restyle('g-density', { x: [dx, [0, xmax]], y: [dy, [RULESETS[ruleset].critical, RULESETS[ruleset].critical]] }, [0, 1]);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  buildPalette();
  allocate();
  seed();
  resetStats();
  speedRange.value = speed;
  setSpeed(speed);
  setL(L);
  buildGraph();
  render();
  updateReadout();
  updateGraph();
})();
