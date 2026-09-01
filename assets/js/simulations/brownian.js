/*
 * brownian.js — random walks in one and two dimensions.
 *
 * WHAT IT SHOWS
 *   Like the percolation page, this runs a big ensemble for the statistics
 *   and draws only a handful of it. The graphs average over thousands of
 *   walkers; the canvas shows a few individual paths, drawn as lines, the
 *   way sample paths are drawn in a textbook. A cloud of ten thousand dots
 *   tells you nothing you cannot get from the graphs — a dozen legible
 *   trajectories tell you what a single walker actually does.
 *
 *   1-D is the classic x(t) diagram: TIME RUNS ACROSS, position is vertical,
 *   t = 0 pinned to the left edge. Both axes rescale in place, so the whole
 *   history stays on screen and nothing scrolls off. The dotted envelope is
 *   ±sqrt(t), the diffusive scale the ensemble spreads at — individual paths
 *   wander in and out of it, which is the point.
 *
 *   2-D draws each shown walker's recent path on a torus: leave one edge,
 *   come back at the opposite one.
 *
 * THE FOUR SETUPS
 *   1-D free        steps ±1. Gaussian spread, widening as sqrt(t).
 *   1-D half-line   absorbing wall at the origin. A walker that reaches it
 *                   stops existing — its path ends there. First-passage
 *                   times go as t^(-3/2), survival as t^(-1/2).
 *   2-D free        one of four directions per step. <r^2> = t still.
 *   2-D field       drift b biases the x-steps, either way about zero.
 *
 * ON THE TORUS: only the DRAWING wraps. Positions are stored unwrapped, so
 * <r^2> is the real displacement rather than a value that would saturate at
 * the box size.
 *
 * TUNABLES: DIST_BASE, MSD_POINTS, TRAIL_STEPS, and the defaults below.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const DIST_BASE = 1.35;         // log-bin ratio for first-passage times
  const GRAPH_MS = 400;
  const MAX_STEPS_PER_FRAME = 60;
  const MSD_POINTS = 400;
  const HIST_BINS = 61;
  const SAMPLES = 900;            // trajectory samples kept per shown walker
  const TRAIL_STEPS = 700;        // 2-D path length, in steps
  const MAX_SHOWN = 24;

  const T = window.SimTheme || {};
  const ACCENT = T.accent || '#e67300';
  const PAGE_BG = T.panelBg || '#0b0b0b';
  const GRID_COLOR = T.grid || '#333333';

  const CSS_BG = '#0b0b0b';
  const CSS_AXIS = '#3a3a3a';
  const CSS_ENVELOPE = '#6b6b6b';
  const CSS_WALL = '#ffc88c';

  // Shown walkers get their own tints so one path can be told from another.
  const PATH_COLORS = [
    '#ff9a33', '#ffd9a8', '#e06a00', '#ffb866',
    '#c85a00', '#fff0dc', '#ff8000', '#e59a55',
  ];

  const SETUPS = {
    '1d':       { dim: 1, boundary: false, field: false, label: '1-D free' },
    '1d-half':  { dim: 1, boundary: true,  field: false, label: '1-D on [0, ∞)' },
    '2d':       { dim: 2, boundary: false, field: false, label: '2-D free' },
    '2d-field': { dim: 2, boundary: false, field: true,  label: '2-D in a field' },
  };

  /* ==================================================================== *
   *  EDIT ME — graph appearance.                                         *
   *  xlabel/ylabel accept LaTeX/MathJax between $...$ (like matplotlib).  *
   *  NOTE: `title` must be PLAIN TEXT — it becomes the figure caption.    *
   * ==================================================================== */
  const GRAPHS = {
    dist: {
      title: 'Position distribution over the whole ensemble',
      xlabel: '$x$', ylabel: '$P(x)$',
      marker: { symbol: 'circle', size: 5, color: ACCENT },
      theory: { color: '#7a7a7a', width: 1, dash: 'dot' },
    },
    radial: {
      title: 'Radial distribution over the whole ensemble',
      xlabel: '$r$', ylabel: '$P(r)$',
      marker: { symbol: 'circle', size: 5, color: ACCENT },
      theory: { color: '#7a7a7a', width: 1, dash: 'dot' },
    },
    msd: {
      title: 'Mean squared displacement',
      xlabel: '$t$', ylabel: '$\\langle r^2 \\rangle$',
      line: { color: ACCENT, width: 2 },
      theory: { color: '#7a7a7a', width: 1, dash: 'dot' },
    },
    fpt: {
      title: 'First-passage time distribution',
      xlabel: '$t$', ylabel: '$P(t)$',
      marker: { symbol: 'circle', size: 5, color: ACCENT },
      theory: { color: '#7a7a7a', width: 1, dash: 'dot' },
    },
    survival: {
      title: 'Surviving fraction',
      xlabel: '$t$', ylabel: '$S(t)$',
      line: { color: ACCENT, width: 2 },
      theory: { color: '#7a7a7a', width: 1, dash: 'dot' },
    },
  };

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */
  const canvas = document.getElementById('sim-canvas');
  const ctx = canvas.getContext('2d');
  const W = 800, H = 800;         // backing store; CSS scales it to the panel
  canvas.width = W;
  canvas.height = H;
  // Lines, not a lattice — the pixelated rendering the other simulations
  // want would make these look like staircases.
  canvas.style.imageRendering = 'auto';

  const PAD = { l: 46, r: 14, t: 14, b: 34 };
  const PLOT_W = W - PAD.l - PAD.r;
  const PLOT_H = H - PAD.t - PAD.b;

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  let setupKey = '1d';
  let setup = SETUPS[setupKey];

  let nWalkers = 3000;            // the ensemble the statistics average over
  let nShown = 8;                 // how many of them get drawn
  let drift = 0.15;
  let x0 = 40;
  let speed = 30;

  let px, py, alive;
  let nAlive = 0;

  /*
   * Trajectory history for the shown walkers only. Positions in lattice
   * units, one sample every `sampleEvery` steps. Nothing about the drawing
   * is baked in, so the axes can be rescaled freely on every frame — the
   * whole picture is redrawn from this each time.
   */
  let trX, trY, trOn;             // [MAX_SHOWN * SAMPLES]
  let nSamples = 0;
  let sampleEvery = 1;

  let t = 0;
  let absorbed = 0;
  let fptHist, fptMax, fptSum;
  let msdT, msdV, msdN = 0, msdEvery = 1;
  let hist = new Float64Array(HIST_BINS);

  let running = false, rafId = null, nextStepTime = 0, lastGraphTime = 0;

  /* ------------------------------------------------------------------ */
  /* Allocation / reset                                                  */
  /* ------------------------------------------------------------------ */
  function allocate() {
    px = new Int32Array(nWalkers);
    py = new Int32Array(nWalkers);
    alive = new Uint8Array(nWalkers);
    trX = new Int32Array(MAX_SHOWN * SAMPLES);
    trY = new Int32Array(MAX_SHOWN * SAMPLES);
    trOn = new Uint8Array(MAX_SHOWN * SAMPLES);
  }

  function seed() {
    if (px.length !== nWalkers) {
      px = new Int32Array(nWalkers);
      py = new Int32Array(nWalkers);
      alive = new Uint8Array(nWalkers);
    }
    for (let i = 0; i < nWalkers; i++) {
      px[i] = setup.boundary ? x0 : 0;
      py[i] = 0;
      alive[i] = 1;
    }
    nAlive = nWalkers;
    trOn.fill(0);
    nSamples = 0;
    sampleEvery = 1;
    t = 0;
    absorbed = 0;
    recordSample();
  }

  function resetStats() {
    fptHist = new Float64Array(64);
    fptMax = 0;
    fptSum = 0;
    msdT = new Float64Array(MSD_POINTS);
    msdV = new Float64Array(MSD_POINTS);
    msdN = 0;
    msdEvery = 1;
    hist.fill(0);
  }

  /* ------------------------------------------------------------------ */
  /* Model                                                               */
  /* ------------------------------------------------------------------ */
  function step() {
    t++;

    if (setup.dim === 1) {
      const absorb = setup.boundary;
      for (let i = 0; i < nWalkers; i++) {
        if (!alive[i]) continue;
        px[i] += Math.random() < 0.5 ? 1 : -1;
        if (absorb && px[i] <= 0) {
          alive[i] = 0;
          nAlive--;
          absorbed++;
          recordFPT(t);
        }
      }
    } else {
      const b = setup.field ? drift : 0;
      const pXp = (1 + b) / 4;
      const pXm = pXp + (1 - b) / 4;
      const pYp = pXm + 0.25;
      for (let i = 0; i < nWalkers; i++) {
        const r = Math.random();
        if (r < pXp) px[i]++;
        else if (r < pXm) px[i]--;
        else if (r < pYp) py[i]++;
        else py[i]--;
      }
    }

    if (t % sampleEvery === 0) recordSample();
    sampleSeries();
  }

  function recordFPT(tau) {
    if (tau > fptMax) fptMax = tau;
    fptSum += tau;
    const b = Math.floor(Math.log(tau) / Math.log(DIST_BASE));
    if (b >= 0 && b < fptHist.length) fptHist[b]++;
  }

  // Keep every other sample and double the interval, so the trace covers the
  // whole run at half the resolution rather than scrolling off the end.
  function decimate() {
    for (let s = 0; s < MAX_SHOWN; s++) {
      const base = s * SAMPLES;
      for (let k = 0; k < SAMPLES >> 1; k++) {
        trX[base + k] = trX[base + k * 2];
        trY[base + k] = trY[base + k * 2];
        trOn[base + k] = trOn[base + k * 2];
      }
      trOn.fill(0, base + (SAMPLES >> 1), base + SAMPLES);
    }
    nSamples = SAMPLES >> 1;
    sampleEvery *= 2;
  }

  function recordSample() {
    if (nSamples >= SAMPLES) decimate();
    const k = nSamples;
    const shown = Math.min(nShown, nWalkers, MAX_SHOWN);
    for (let s = 0; s < shown; s++) {
      const idx = s * SAMPLES + k;
      trX[idx] = px[s];
      trY[idx] = py[s];
      trOn[idx] = alive[s];
    }
    nSamples++;
  }

  function meanSquared() {
    if (nAlive === 0) return 0;
    let s = 0;
    if (setup.dim === 1) {
      for (let i = 0; i < nWalkers; i++) if (alive[i]) s += px[i] * px[i];
    } else {
      for (let i = 0; i < nWalkers; i++) if (alive[i]) s += px[i] * px[i] + py[i] * py[i];
    }
    return s / nAlive;
  }

  function meanX() {
    if (nAlive === 0) return 0;
    let s = 0;
    for (let i = 0; i < nWalkers; i++) if (alive[i]) s += px[i];
    return s / nAlive;
  }

  function sampleSeries() {
    if (t % msdEvery !== 0) return;
    if (msdN >= MSD_POINTS) {
      for (let k = 0; k < MSD_POINTS >> 1; k++) {
        msdT[k] = msdT[k * 2];
        msdV[k] = msdV[k * 2];
      }
      msdN = MSD_POINTS >> 1;
      msdEvery *= 2;
    }
    msdT[msdN] = t;
    msdV[msdN] = setup.boundary ? nAlive / nWalkers : meanSquared();
    msdN++;
  }

  /* ------------------------------------------------------------------ */
  /* Render — 1-D: x(t), time across                                     */
  /* ------------------------------------------------------------------ */
  function render1D() {
    ctx.fillStyle = CSS_BG;
    ctx.fillRect(0, 0, W, H);

    const shown = Math.min(nShown, nWalkers, MAX_SHOWN);
    const tMax = Math.max(1, (nSamples - 1) * sampleEvery);

    // Vertical scale: whatever holds the drawn paths and the envelope, with
    // a little air. Recomputed each frame, since the history is stored in
    // lattice units and nothing is baked into a buffer.
    let hi = setup.boundary ? x0 : 1;
    for (let s = 0; s < shown; s++) {
      const base = s * SAMPLES;
      for (let k = 0; k < nSamples; k++) {
        if (!trOn[base + k]) continue;
        const v = trX[base + k];
        const a = v < 0 ? -v : v;
        if (a > hi) hi = a;
      }
    }
    hi = Math.max(hi, Math.sqrt(tMax)) * 1.15;

    const yLo = setup.boundary ? 0 : -hi;
    const yHi = hi;
    const X = (tt) => PAD.l + (tt / tMax) * PLOT_W;
    const Y = (xx) => PAD.t + PLOT_H - ((xx - yLo) / (yHi - yLo)) * PLOT_H;

    // Axes
    ctx.strokeStyle = CSS_AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, Y(0)); ctx.lineTo(W - PAD.r, Y(0));          // x = 0
    ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + PLOT_H);   // t = 0
    ctx.stroke();

    // The diffusive scale the ensemble spreads at. Individual paths wander
    // in and out of it — that contrast is the whole point of showing paths
    // rather than a cloud.
    ctx.strokeStyle = CSS_ENVELOPE;
    ctx.setLineDash([5, 5]);
    for (const sign of setup.boundary ? [1] : [1, -1]) {
      ctx.beginPath();
      for (let k = 0; k < nSamples; k++) {
        const tt = k * sampleEvery;
        const v = sign * Math.sqrt(tt);
        if (k === 0) ctx.moveTo(X(tt), Y(v)); else ctx.lineTo(X(tt), Y(v));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // The absorbing wall.
    if (setup.boundary) {
      ctx.strokeStyle = CSS_WALL;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD.l, Y(0)); ctx.lineTo(W - PAD.r, Y(0));
      ctx.stroke();
    }

    // The sample paths.
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let s = 0; s < shown; s++) {
      const base = s * SAMPLES;
      ctx.strokeStyle = PATH_COLORS[s % PATH_COLORS.length];
      ctx.beginPath();
      let drawing = false;
      let lastK = -1;
      for (let k = 0; k < nSamples; k++) {
        if (!trOn[base + k]) break;             // absorbed: the path ends
        const sx = X(k * sampleEvery), sy = Y(trX[base + k]);
        if (!drawing) { ctx.moveTo(sx, sy); drawing = true; } else ctx.lineTo(sx, sy);
        lastK = k;
      }
      ctx.stroke();
      // A dot where an absorbed walker met the wall.
      if (setup.boundary && lastK >= 0 && lastK < nSamples - 1) {
        ctx.fillStyle = CSS_WALL;
        ctx.beginPath();
        ctx.arc(X((lastK + 1) * sampleEvery), Y(0), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    labels1D(tMax, yHi);
  }

  function labels1D(tMax, yHi) {
    ctx.fillStyle = '#8c8c8c';
    ctx.font = '20px Verdana, Geneva, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('t = ' + Math.round(tMax).toLocaleString(), W - PAD.r - 60, PAD.t + PLOT_H + 8);
    ctx.fillText('0', PAD.l, PAD.t + PLOT_H + 8);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('x = ' + Math.round(yHi), PAD.l - 6, PAD.t + 10);
  }

  /* ------------------------------------------------------------------ */
  /* Render — 2-D: paths on a torus                                      */
  /* ------------------------------------------------------------------ */
  function wrap(v, n) { const m = v % n; return m < 0 ? m + n : m; }

  function render2D() {
    ctx.fillStyle = CSS_BG;
    ctx.fillRect(0, 0, W, H);

    const box = Math.min(PLOT_W, PLOT_H);
    const ox = PAD.l + (PLOT_W - box) / 2;
    const oy = PAD.t + (PLOT_H - box) / 2;
    const SITES = 260;                       // lattice sites across the torus
    const cell = box / SITES;

    // The torus edges, and the origin.
    ctx.strokeStyle = CSS_AXIS;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, box, box);
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(ox + box / 2, oy); ctx.lineTo(ox + box / 2, oy + box);
    ctx.moveTo(ox, oy + box / 2); ctx.lineTo(ox + box, oy + box / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const shown = Math.min(nShown, nWalkers, MAX_SHOWN);
    const keep = Math.max(2, Math.ceil(TRAIL_STEPS / sampleEvery));
    const from = Math.max(0, nSamples - keep);

    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let s = 0; s < shown; s++) {
      const base = s * SAMPLES;
      const col = PATH_COLORS[s % PATH_COLORS.length];
      ctx.strokeStyle = col;
      ctx.beginPath();
      let prevX = 0, prevY = 0, have = false;
      for (let k = from; k < nSamples; k++) {
        const wx = wrap(trX[base + k] + (SITES >> 1), SITES);
        const wy = wrap(trY[base + k] + (SITES >> 1), SITES);
        const sx = ox + wx * cell, sy = oy + wy * cell;
        // A wrap shows up as a jump of more than half the box; break the
        // line there instead of drawing a stripe back across the frame.
        if (have && (Math.abs(wx - prevX) > SITES / 2 || Math.abs(wy - prevY) > SITES / 2)) {
          ctx.moveTo(sx, sy);
        } else if (!have) {
          ctx.moveTo(sx, sy);
        } else {
          ctx.lineTo(sx, sy);
        }
        prevX = wx; prevY = wy; have = true;
      }
      ctx.stroke();

      // Head, so the current position is obvious.
      if (nSamples > 0) {
        const k = nSamples - 1;
        const wx = wrap(trX[base + k] + (SITES >> 1), SITES);
        const wy = wrap(trY[base + k] + (SITES >> 1), SITES);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(ox + wx * cell, oy + wy * cell, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = '#8c8c8c';
    ctx.font = '20px Verdana, Geneva, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(SITES + ' × ' + SITES + ' torus', ox + 6, oy + box + 8);
  }

  function render() {
    if (setup.dim === 1) render1D(); else render2D();
  }

  function updateReadout() {
    const rows = [
      ['setup', setup.label],
      ['ensemble', nWalkers.toLocaleString()],
      ['paths shown', String(Math.min(nShown, nWalkers, MAX_SHOWN))],
      ['steps', t.toLocaleString()],
    ];
    if (setup.boundary) {
      rows.push(['still walking', nAlive.toLocaleString(), nAlive > 0]);
      rows.push(['absorbed', absorbed.toLocaleString()]);
      rows.push(['mean FPT', absorbed > 0 ? (fptSum / absorbed).toFixed(0) : '—']);
    } else {
      const r2 = meanSquared();
      rows.push(['⟨r²⟩', r2.toFixed(1)]);
      rows.push(['⟨r²⟩ / t', t > 0 ? (r2 / t).toFixed(3) : '—', true]);
      if (setup.field) rows.push(['⟨x⟩', meanX().toFixed(1)]);
    }
    readout(rows);
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

  /* ------------------------------------------------------------------ */
  /* Loop                                                                */
  /* ------------------------------------------------------------------ */
  function frame(now) {
    if (!running) return;
    const interval = 1000 / speed;
    let steps = 0;
    const done = setup.boundary && nAlive === 0;
    while (!done && now >= nextStepTime && steps < MAX_STEPS_PER_FRAME) {
      step();
      nextStepTime += interval;
      steps++;
    }
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
  const params = document.getElementById('sim-params');
  params.innerHTML =
    '<div class="control">' +
    '  <label>Dimension</label>' +
    '  <div class="seg" role="group" aria-label="Dimension">' +
    '    <button type="button" class="seg-btn" data-dim="1" aria-pressed="true">1-D</button>' +
    '    <button type="button" class="seg-btn" data-dim="2" aria-pressed="false">2-D</button>' +
    '  </div>' +
    '</div>' +
    '<div class="control">' +
    '  <label id="variant-label">Boundary</label>' +
    '  <div class="seg" role="group" aria-label="Variant">' +
    '    <button type="button" class="seg-btn" data-var="free" aria-pressed="true">Free</button>' +
    '    <button type="button" class="seg-btn" data-var="alt" aria-pressed="false" id="variant-alt">[0, ∞)</button>' +
    '  </div>' +
    '</div>' +
    '<div class="control" id="c-x0">' +
    '  <label>Release at: <span id="x0-val"></span></label>' +
    '  <input type="range" id="x0-range" min="1" max="120" step="1">' +
    '</div>' +
    '<div class="control" id="c-drift">' +
    '  <label>Field b: <span id="drift-val"></span></label>' +
    '  <input type="range" id="drift-range" min="-0.9" max="0.9" step="0.01">' +
    '</div>' +
    '<div class="control">' +
    '  <label>Paths shown: <span id="shown-val"></span></label>' +
    '  <input type="range" id="shown-range" min="1" max="' + MAX_SHOWN + '" step="1">' +
    '</div>' +
    '<div class="control">' +
    '  <label>Ensemble: <span id="n-val"></span></label>' +
    '  <input type="range" id="n-range" min="100" max="20000" step="100">' +
    '</div>' +
    '<div class="control">' +
    '  <label>Speed: <span id="speed-val"></span></label>' +
    '  <input type="range" id="speed-range" min="1" max="240" step="1">' +
    '</div>';

  const dimBtns = Array.prototype.slice.call(params.querySelectorAll('[data-dim]'));
  const varBtns = Array.prototype.slice.call(params.querySelectorAll('[data-var]'));
  const variantLabel = document.getElementById('variant-label');
  const variantAlt = document.getElementById('variant-alt');
  const cX0 = document.getElementById('c-x0');
  const cDrift = document.getElementById('c-drift');
  const x0Range = document.getElementById('x0-range');
  const x0Val = document.getElementById('x0-val');
  const driftRange = document.getElementById('drift-range');
  const driftVal = document.getElementById('drift-val');
  const shownRange = document.getElementById('shown-range');
  const shownVal = document.getElementById('shown-val');
  const nRange = document.getElementById('n-range');
  const nVal = document.getElementById('n-val');
  const speedRange = document.getElementById('speed-range');
  const speedVal = document.getElementById('speed-val');

  let dim = 1, variant = 'free';

  function applySetup(rebuildGraphs) {
    setupKey = dim === 1
      ? (variant === 'free' ? '1d' : '1d-half')
      : (variant === 'free' ? '2d' : '2d-field');
    setup = SETUPS[setupKey];

    variantLabel.textContent = dim === 1 ? 'Boundary' : 'Field';
    variantAlt.textContent = dim === 1 ? '[0, ∞)' : 'Drift';
    cX0.style.display = setup.boundary ? '' : 'none';
    cDrift.style.display = setup.field ? '' : 'none';

    for (const b of dimBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.dim) === dim));
    for (const b of varBtns) b.setAttribute('aria-pressed', String(b.dataset.var === variant));

    if (rebuildGraphs) buildGraph();
    reset();
  }

  for (const b of dimBtns) {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.dim);
      if (v === dim) return;
      dim = v;
      applySetup(true);
    });
  }
  for (const b of varBtns) {
    b.addEventListener('click', () => {
      if (b.dataset.var === variant) return;
      variant = b.dataset.var;
      applySetup(true);
    });
  }

  function setX0(v) { x0 = Math.max(1, Math.min(120, v)); x0Range.value = x0; x0Val.textContent = x0; }
  function setDrift(v) {
    drift = Math.max(-0.9, Math.min(0.9, v));
    driftRange.value = drift;
    driftVal.textContent = (drift > 0 ? '+' : '') + drift.toFixed(2);
  }
  function setShown(v) {
    nShown = Math.max(1, Math.min(MAX_SHOWN, v));
    shownRange.value = nShown;
    shownVal.textContent = nShown;
  }
  function setN(v) { nWalkers = Math.max(100, Math.min(20000, v)); nRange.value = nWalkers; nVal.textContent = nWalkers.toLocaleString(); }
  function setSpeed(v) { speed = Math.max(1, Math.min(240, v)); speedVal.textContent = speed + ' / s'; nextStepTime = performance.now(); }

  x0Range.addEventListener('input', () => { setX0(parseFloat(x0Range.value)); reset(); });
  driftRange.addEventListener('input', () => { setDrift(parseFloat(driftRange.value)); reset(); });
  // Showing more paths needs no reset — the history is already there.
  shownRange.addEventListener('input', () => { setShown(parseFloat(shownRange.value)); render(); updateReadout(); });
  nRange.addEventListener('change', () => { setN(parseFloat(nRange.value)); allocate(); reset(); });
  nRange.addEventListener('input', () => { nVal.textContent = Number(nRange.value).toLocaleString(); });
  speedRange.addEventListener('input', () => setSpeed(parseFloat(speedRange.value)));

  document.getElementById('sim-toggle').addEventListener('click', () => running ? pause() : start());
  document.getElementById('sim-step').addEventListener('click', () => {
    step(); render(); updateReadout(); updateGraph();
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

  function figure(plotId, caption) {
    return '<figure class="sim-figure">' +
           '<div class="sim-graph"><div id="' + plotId + '" class="sim-plot"></div></div>' +
           '<figcaption class="sim-caption">' + caption + '</figcaption>' +
           '</figure>';
  }

  function graphSpec() {
    if (setup.boundary) return [GRAPHS.fpt, GRAPHS.survival];
    return [setup.dim === 1 ? GRAPHS.dist : GRAPHS.radial, GRAPHS.msd];
  }

  function buildGraph() {
    const below = document.getElementById('sim-below');
    if (!hasPlotly) {
      below.innerHTML =
        '<p class="sim-note">Plotly failed to load, so the live graphs are unavailable ' +
        '(they need an internet connection).</p>';
      return;
    }
    const [gA, gB] = graphSpec();
    below.innerHTML =
      '<div class="sim-graph-grid">' + figure('g-a', gA.title) + figure('g-b', gB.title) + '</div>';

    const cfg = { responsive: true, displayModeBar: false };
    const logAxis = { type: 'log' };

    Plotly.newPlot('g-a',
      [{ x: [], y: [], mode: 'markers', marker: gA.marker },
       { x: [], y: [], mode: 'lines', line: gA.theory, hoverinfo: 'skip' }],
      baseLayout(gA, setup.boundary ? logAxis : {}, setup.boundary ? logAxis : {}),
      cfg);

    Plotly.newPlot('g-b',
      [{ x: [], y: [], mode: 'lines', line: gB.line },
       { x: [], y: [], mode: 'lines', line: gB.theory, hoverinfo: 'skip' }],
      baseLayout(gB, logAxis, logAxis),
      cfg);

    graphReady = true;
  }

  function updateGraph() {
    if (!graphReady) return;

    if (setup.boundary) {
      const xs = [], ys = [];
      if (absorbed > 0) {
        for (let b = 0; b < fptHist.length; b++) {
          if (fptHist[b] <= 0) continue;
          const lo = Math.pow(DIST_BASE, b);
          const hi = Math.pow(DIST_BASE, b + 1);
          xs.push(Math.sqrt(lo * hi));
          ys.push(fptHist[b] / ((hi - lo) * absorbed));
        }
      }
      const tx = [], ty = [];
      if (xs.length > 1) {
        const mid = Math.floor(xs.length / 2);
        const k = ys[mid] * Math.pow(xs[mid], 1.5);
        for (let i = 0; i < xs.length; i++) { tx.push(xs[i]); ty.push(k * Math.pow(xs[i], -1.5)); }
      }
      Plotly.restyle('g-a', { x: [xs, tx], y: [ys, ty] }, [0, 1]);

      const sx = [], sy = [];
      for (let i = 0; i < msdN; i++) {
        if (msdV[i] <= 0) break;
        sx.push(msdT[i]); sy.push(msdV[i]);
      }
      const ux = [], uy = [];
      if (sx.length > 2) {
        const mid = Math.floor(sx.length / 2);
        const k = sy[mid] * Math.sqrt(sx[mid]);
        for (let i = 0; i < sx.length; i++) { ux.push(sx[i]); uy.push(k / Math.sqrt(sx[i])); }
      }
      Plotly.restyle('g-b', { x: [sx, ux], y: [sy, uy] }, [0, 1]);
      return;
    }

    hist.fill(0);
    const sigma = Math.sqrt(Math.max(t, 1));
    const lo = setup.dim === 1 ? -4 * sigma : 0;
    const hiEdge = 4 * sigma;
    const wBin = (hiEdge - lo) / HIST_BINS;
    const mx = setup.field ? meanX() : 0;
    for (let i = 0; i < nWalkers; i++) {
      if (!alive[i]) continue;
      const v = setup.dim === 1
        ? px[i]
        : Math.sqrt((px[i] - mx) * (px[i] - mx) + py[i] * py[i]);
      const b = Math.floor((v - lo) / wBin);
      if (b >= 0 && b < HIST_BINS) hist[b]++;
    }
    const hx = [], hy = [], gx = [], gy = [];
    for (let b = 0; b < HIST_BINS; b++) {
      const c = lo + (b + 0.5) * wBin;
      hx.push(c);
      hy.push(hist[b] / (Math.max(nAlive, 1) * wBin));
      gx.push(c);
      if (setup.dim === 1) {
        gy.push(Math.exp(-c * c / (2 * (t || 1))) / Math.sqrt(2 * Math.PI * (t || 1)));
      } else {
        const s2 = (t || 1) / 2;
        gy.push((c / s2) * Math.exp(-c * c / (2 * s2)));
      }
    }
    Plotly.restyle('g-a', { x: [hx, gx], y: [hy, gy] }, [0, 1]);

    const mt = Array.prototype.slice.call(msdT.subarray(0, msdN));
    const mv = Array.prototype.slice.call(msdV.subarray(0, msdN));
    const rx = [], ry = [];
    for (let i = 0; i < msdN; i++) { rx.push(msdT[i]); ry.push(msdT[i]); }
    Plotly.restyle('g-b', { x: [mt, rx], y: [mv, ry] }, [0, 1]);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  allocate();
  setX0(x0);
  setDrift(drift);
  setShown(nShown);
  setN(nWalkers);
  speedRange.value = speed;
  setSpeed(speed);
  buildGraph();
  applySetup(false);
})();
