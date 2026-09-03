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
 * TUNABLES: NP (sweep resolution), MODES (thresholds), DIST_BASE (log-bin
 * base for graph b), and the default L / pDisplay below.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const NP = 101;                 // number of p-grid points, p = 0 .. 1

  /*
   * MODES. Site percolation occupies the SITES with probability p and joins
   * occupied neighbours. Bond percolation keeps every site and opens the
   * EDGES between them with probability p. Different thresholds, and the
   * bond one is exact rather than numerical — self-duality of the square
   * lattice pins it at 1/2.
   */
  const MODES = {
    site: { label: 'Site', pc: 0.592746, pcExact: false },
    bond: { label: 'Edge', pc: 0.5,      pcExact: true  },
  };
  /*
   * The lattice is drawn as GEOMETRY into a fixed-size canvas rather than one
   * pixel per site. Pixel-per-site cannot work here: the canvas is laid out at
   * whatever width the column gives it (~330 css px), so an L=128 image was
   * being nearest-neighbour scaled by 1.29 and an L=256 one was being scaled
   * DOWN — either way the fine structure that distinguishes the two modes was
   * destroyed before it ever reached the screen. Drawing at canvas resolution
   * means node and link sizes are chosen in device pixels and survive.
   */
  const CANVAS_PX = 768;
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

  /*
   * Lattice colours. The bright accent always marks the SPANNING cluster; the
   * dim variants are the same hue stepped down, so the two carry the same
   * meaning whichever element they land on.
   */
  const COLOR_EMPTY = T.empty || [11, 11, 11];    // dark ground
  const COLOR_FINITE = T.finite || [95, 95, 98];  // neutral gray
  const COLOR_SPAN = T.span || [230, 115, 0];     // orange accent
  const COLOR_SPAN_DIM = [150, 76, 4];            // spanning cluster, secondary
  const COLOR_FINITE_DIM = [58, 58, 60];          // finite clusters, secondary
  const COLOR_SCAFFOLD = [46, 46, 48];            // the always-present bond lattice
  const COLOR_PATH = '#ffffff';                   // the shortest crossing

  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

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
    chem: {
      title: 'Shortest crossing path, against the straight-line distance',
      xlabel: '$p$', ylabel: '$\\ell_{min} / L$',
      marker: { symbol: 'circle', size: 6, color: ACCENT },
      straight: { color: '#7a7a7a', width: 1, dash: 'dot' },
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
  let mode = 'site';              // 'site' | 'bond'

  let field, bondField, parent, sz;
  let bfsQ, bfsPrev, bfsDist;     // shortest-path scratch
  let pathList = [];              // the shortest crossing, endpoint first

  // Per-p-grid accumulators (curves a, c, d, e).
  let cnt, spanCnt, sumS, sumPinf, sumChem, chemCnt;
  let lastChem = 0;
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
    // Two bonds per site: 2i is the edge to the right, 2i+1 the edge below.
    // Edges off the lattice are simply never consulted.
    bondField = new Float32Array(2 * N);
    parent = new Int32Array(N);
    sz = new Int32Array(N);
    bfsQ = new Int32Array(N);
    bfsPrev = new Int32Array(N);
    bfsDist = new Int32Array(N);
    pathList = [];

    // Fixed backing store — the drawing scales with L, not the canvas.
    canvas.width = CANVAS_PX;
    canvas.height = CANVAS_PX;
    // Shapes are drawn at device resolution now, so let the browser filter
    // when it fits the canvas to the column. `pixelated` (the sheet default,
    // right for the pixel-per-cell simulations) would alias the thin links.
    canvas.style.imageRendering = 'auto';
  }

  function resetStats() {
    cnt = new Float64Array(NP);
    spanCnt = new Float64Array(NP);
    sumS = new Float64Array(NP);
    sumPinf = new Float64Array(NP);
    sumChem = new Float64Array(NP);
    chemCnt = new Float64Array(NP);
    lastChem = 0;
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
    for (let i = 0; i < 2 * N; i++) bondField[i] = Math.random();
  }

  function pc() { return MODES[mode].pc; }

  // Is the edge from site i to its right / lower neighbour open at p?
  function bondRight(i, p) { return bondField[2 * i] < p; }
  function bondDown(i, p) { return bondField[2 * i + 1] < p; }

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

    /*
     * Initialise union-find, then join neighbours.
     *
     * SITE: a cell is present when field[i] < p, and two present neighbours
     *       are always joined.
     * BOND: every cell is present, and a pair is joined only when the edge
     *       between them is open.
     */
    const bond = mode === 'bond';
    for (let i = 0; i < N; i++) {
      if (bond || field[i] < p) { parent[i] = i; sz[i] = 1; }
      else { parent[i] = -1; }
    }

    for (let y = 0; y < L; y++) {
      const row = y * L;
      for (let x = 0; x < L; x++) {
        const i = row + x;
        if (parent[i] < 0) continue;
        if (bond) {
          if (x < L - 1 && bondRight(i, p)) unite(i, i + 1);
          if (y < L - 1 && bondDown(i, p)) unite(i, i + L);
        } else {
          if (x > 0 && parent[i - 1] >= 0) unite(i, i - 1);
          if (y > 0 && parent[i - L] >= 0) unite(i, i - L);
        }
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

    // The shortest crossing, when one exists. Wanted for the graph on every
    // sample and for the drawing only when rendering.
    let chem = 0;
    if (spanningRoots.size > 0) chem = shortestCrossing(p, spanningRoots, !!opts.render);

    return {
      meanFiniteS: sumFin > 0 ? sumFinSq / sumFin : 0,
      pInf: spanSize / N,
      spanning: spanningRoots.size > 0,
      spanSize: spanSize,
      chem: chem,
      spanningRoots: opts.render ? spanningRoots : null,
    };
  }

  /*
   * SHORTEST CROSSING (the chemical distance).
   *
   * Breadth-first from every spanning-cluster site on the top row at once —
   * a multi-source BFS, so the first bottom-row site reached is reached by a
   * globally shortest path, not merely the shortest from one chosen start.
   * The number of steps in that path is the chemical distance, which is the
   * interesting quantity: near p_c it is much longer than the straight-line
   * L because the crossing has to detour around holes.
   *
   * Walking the parent pointers back from the endpoint marks the path for
   * drawing. Traversal follows whichever adjacency the mode defines, so the
   * same routine serves both.
   */
  function shortestCrossing(p, spanningRoots, markPath) {
    const bond = mode === 'bond';
    bfsDist.fill(-1);
    let head = 0, tail = 0;

    for (let x = 0; x < L; x++) {
      if (parent[x] >= 0 && spanningRoots.has(find(x))) {
        bfsDist[x] = 0;
        bfsPrev[x] = -1;
        bfsQ[tail++] = x;
      }
    }

    const bottom = (L - 1) * L;
    let endSite = -1;
    while (head < tail) {
      const i = bfsQ[head++];
      if (i >= bottom) { endSite = i; break; }      // first to arrive wins
      const x = i % L, y = (i / L) | 0;

      // left, right, up, down — gated by the mode's adjacency
      if (x > 0        && (bond ? bondRight(i - 1, p) : parent[i - 1] >= 0) && bfsDist[i - 1] < 0) {
        bfsDist[i - 1] = bfsDist[i] + 1; bfsPrev[i - 1] = i; bfsQ[tail++] = i - 1;
      }
      if (x < L - 1    && (bond ? bondRight(i, p)     : parent[i + 1] >= 0) && bfsDist[i + 1] < 0) {
        bfsDist[i + 1] = bfsDist[i] + 1; bfsPrev[i + 1] = i; bfsQ[tail++] = i + 1;
      }
      if (y > 0        && (bond ? bondDown(i - L, p)  : parent[i - L] >= 0) && bfsDist[i - L] < 0) {
        bfsDist[i - L] = bfsDist[i] + 1; bfsPrev[i - L] = i; bfsQ[tail++] = i - L;
      }
      if (y < L - 1    && (bond ? bondDown(i, p)      : parent[i + L] >= 0) && bfsDist[i + L] < 0) {
        bfsDist[i + L] = bfsDist[i] + 1; bfsPrev[i + L] = i; bfsQ[tail++] = i + L;
      }
    }

    if (endSite < 0) return 0;
    const len = bfsDist[endSite] + 1;               // sites visited, not hops

    // Kept as an ordered list, not a per-site flag. Two marked sites can be
    // lattice neighbours without being CONSECUTIVE on the path (and in bond
    // mode without even having an open edge between them), so drawing from a
    // flag array would draw rungs the walker never took.
    if (markPath) {
      pathList.length = 0;
      for (let i = endSite; i >= 0; i = bfsPrev[i]) {
        pathList.push(i);
        if (bfsPrev[i] < 0) break;
      }
    }
    return len;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  /*
   * THE TWO MODES ARE DRAWN DIFFERENTLY ON PURPOSE.
   *
   * They have to be. In each model one element is random and the other is
   * just scenery, and it is the opposite element in each case:
   *
   *   SITE  the nodes are the coin flips, the edges are automatic.
   *         So nodes are drawn fat and coloured, links thin and dim —
   *         chunky blocks joined by necks.
   *
   *   BOND  every node exists; the EDGES are the coin flips.
   *         So the nodes drop back to a faint uniform scaffold and the open
   *         edges get the weight and the colour — an open wire mesh.
   *
   * Colouring the nodes in both modes was the mistake: bond percolation drew
   * a complete, fully-coloured grid of nodes, which at a glance is just a
   * site lattice at high p. Putting the emphasis on the random element makes
   * the two pictures structurally unmistakable, and it is also the honest
   * reading of each model.
   *
   * Rects are accumulated into one Path2D per colour and filled in four
   * calls, rather than one fill per cell — at L=256 that is ~200k rectangles
   * a frame, which is fine batched and is not fine otherwise.
   */
  function renderCurrent(spanningRoots, showPath) {
    const bond = mode === 'bond';
    const p = pDisplay;
    const cell = CANVAS_PX / L;

    ctx.fillStyle = rgb(COLOR_EMPTY);
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    // Node and link weights, in canvas pixels. Which one dominates is the
    // whole visual difference between the modes.
    const nodeW = bond ? Math.max(1, cell * 0.30) : Math.max(1.5, cell * 0.72);
    const linkW = bond ? Math.max(1.5, cell * 0.54) : Math.max(1, cell * 0.28);
    // Below ~4px a scaffold dot is just haze over the mesh; drop it and let
    // the bonds carry the picture alone.
    const drawNodes = !bond || cell >= 4;

    const nodeSpan = new Path2D(), nodeFin = new Path2D();
    const linkSpan = new Path2D(), linkFin = new Path2D();
    const nh = nodeW / 2, lh = linkW / 2;

    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const i = y * L + x;
        if (parent[i] < 0) continue;                    // absent site
        const span = spanningRoots.has(find(i));
        const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;

        // In bond mode every node is present and none of them mean anything,
        // so they all go in one pile and get the scaffold colour.
        if (drawNodes) {
          (bond || !span ? nodeFin : nodeSpan).rect(cx - nh, cy - nh, nodeW, nodeW);
        }

        if (x < L - 1) {
          const j = i + 1;
          const joined = bond ? bondRight(i, p) : (parent[j] >= 0);
          if (joined && parent[j] >= 0) {
            (span ? linkSpan : linkFin).rect(cx, cy - lh, cell, linkW);
          }
        }
        if (y < L - 1) {
          const j = i + L;
          const joined = bond ? bondDown(i, p) : (parent[j] >= 0);
          if (joined && parent[j] >= 0) {
            (span ? linkSpan : linkFin).rect(cx - lh, cy, linkW, cell);
          }
        }
      }
    }

    // Whichever element is the smaller goes down first, so the dominant one
    // reads on top and the joints stay clean.
    const paintNodes = () => {
      if (!drawNodes) return;
      ctx.fillStyle = rgb(bond ? COLOR_SCAFFOLD : COLOR_FINITE);
      ctx.fill(nodeFin);
      if (!bond) { ctx.fillStyle = rgb(COLOR_SPAN); ctx.fill(nodeSpan); }
    };
    const paintLinks = () => {
      ctx.fillStyle = rgb(bond ? COLOR_FINITE : COLOR_FINITE_DIM);
      ctx.fill(linkFin);
      ctx.fillStyle = rgb(bond ? COLOR_SPAN : COLOR_SPAN_DIM);
      ctx.fill(linkSpan);
    };
    if (bond) { paintNodes(); paintLinks(); }
    else      { paintLinks(); paintNodes(); }

    // The shortest crossing, last so it reads over everything. Drawn from the
    // ordered walk, one segment per step actually taken.
    if (showPath && pathList.length > 1) {
      const pw = Math.max(1.6, cell * (bond ? 0.54 : 0.40));
      const ph = pw / 2;
      const path = new Path2D();
      for (let k = 0; k < pathList.length; k++) {
        const i = pathList[k];
        const x = i % L, y = (i / L) | 0;
        const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
        path.rect(cx - ph, cy - ph, pw, pw);          // joint
        if (k + 1 < pathList.length) {
          const j = pathList[k + 1];
          const jx = j % L, jy = (j / L) | 0;
          if (jy === y) path.rect(Math.min(cx, (jx + 0.5) * cell), cy - ph, cell, pw);
          else          path.rect(cx - ph, Math.min(cy, (jy + 0.5) * cell), pw, cell);
        }
      }
      ctx.fillStyle = COLOR_PATH;
      ctx.fill(path);
    }
  }

  // Sample + draw at pDisplay using the current field, without accumulating.
  function renderDisplayOnly() {
    const r = computeAt(pDisplay, { render: true });
    renderCurrent(r.spanningRoots, r.spanning);
    updateReadout(r);
  }


  /*
   * Report the live figures. Goes through engine.js so every simulation
   * lays them out identically — but guarded, because a browser holding a
   * cached older engine.js would otherwise throw here during boot and take
   * the whole simulation down with it, graphs included.
   */
  function readout(rows) {
    if (window.Sim && typeof window.Sim.readout === 'function') window.Sim.readout(rows);
  }

  function updateReadout(r) {
    const chem = r && r.chem > 0 ? r.chem : 0;
    readout([
      ['lattice', L + ' \u00d7 ' + L],
      ['type', MODES[mode].label + ' percolation'],
      ['p', pDisplay.toFixed(3)],
      ['p_c', MODES[mode].pc.toFixed(mode === 'bond' ? 1 : 6) + (MODES[mode].pcExact ? ' (exact)' : '')],
      ['cycles', cycle.toLocaleString()],
      ['spanning', r ? (r.spanning ? 'yes' : 'no') : '\u2014', r && r.spanning],
      ['P\u221e', r ? r.pInf.toFixed(3) : null],
      ['shortest path', chem ? chem.toLocaleString() + ' sites' : null],
      ['\u2113 / L', chem ? (chem / L).toFixed(2) : null, true],
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
    // Only spanning states have a crossing to measure, so this curve is
    // averaged over its own count rather than over all cycles.
    if (r.spanning && r.chem > 0) { sumChem[sweepPos] += r.chem; chemCnt[sweepPos] += 1; }
    sweepPos++;
  }

  // Finish a cycle: sample exactly at pDisplay, draw that state, feed graph (b),
  // then draw a brand-new random field for the next cycle.
  function doDisplay() {
    const r = computeAt(pDisplay, { dist: true, render: true });
    renderCurrent(r.spanningRoots, r.spanning);
    lastChem = r.chem;
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
    '  <label>Percolation on</label>' +
    '  <div class="seg" role="group" aria-label="Percolation type">' +
    '    <button type="button" class="seg-btn" data-mode="site" aria-pressed="true">Sites</button>' +
    '    <button type="button" class="seg-btn" data-mode="bond" aria-pressed="false">Edges</button>' +
    '  </div>' +
    '</div>' +
    '<div class="control">' +
    '  <label id="p-label">p (occupation)</label>' +
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

  /*
   * Switching between sites and bonds changes the threshold, the adjacency
   * and therefore every statistic, so it starts over. p_c moves from 0.5927
   * to exactly 1/2, and the dotted marker on the graphs follows it.
   */
  const modeBtns = Array.prototype.slice.call(params.querySelectorAll('[data-mode]'));
  const pLabel = document.getElementById('p-label');

  function setMode(m) {
    if (!MODES[m] || m === mode) return;
    mode = m;
    pLabel.textContent = mode === 'bond' ? 'p (bond open)' : 'p (occupation)';
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    buildGraphs();       // the p_c marker and the caption text both move
    reset();
  }

  for (const b of modeBtns) {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  }

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
  // Rebuilt with the graphs, since p_c moves when the mode does.
  function pcShape() {
    return {
      type: 'line', x0: pc(), x1: pc(), y0: 0, y1: 1, yref: 'paper',
      line: { color: ACCENT, width: 1, dash: 'dot' },
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
      figure('g-chem',  GRAPHS.chem.title) +
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
        pAxis, { tickformat: '~e' }, { shapes: [pcShape()] }), cfg);

    Plotly.newPlot('g-dist',
      [{ x: [], y: [], mode: 'markers', marker: GRAPHS.dist.marker }],
      baseLayout(GRAPHS.dist.title, GRAPHS.dist.xlabel, GRAPHS.dist.ylabel, logAxis, logAxis), cfg);

    Plotly.newPlot('g-pinf',
      [trace('pinf')],
      baseLayout(GRAPHS.pinf.title, GRAPHS.pinf.xlabel, GRAPHS.pinf.ylabel,
        pAxis, unitAxis, { shapes: [pcShape()] }), cfg);

    Plotly.newPlot('g-span',
      [trace('span')],
      baseLayout(GRAPHS.span.title, GRAPHS.span.xlabel, GRAPHS.span.ylabel,
        pAxis, unitAxis, { shapes: [pcShape()] }), cfg);

    /*
     * The shortest crossing, in units of L. Below p_c there is usually no
     * crossing at all so the curve simply has no points; just above it the
     * path is long and winding, and it falls towards the straight-line 1 as
     * p rises and the cluster fills in. The dotted horizontal is that
     * straight-line minimum — the path can never be shorter.
     */
    Plotly.newPlot('g-chem',
      [trace('chem'),
       { x: [0, 1], y: [1, 1], mode: 'lines', line: GRAPHS.chem.straight, hoverinfo: 'skip' }],
      baseLayout(GRAPHS.chem.title, GRAPHS.chem.xlabel, GRAPHS.chem.ylabel,
        pAxis, { exponentformat: 'none' }, { shapes: [pcShape()] }), cfg);

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
    const ye = new Array(NP);
    for (let k = 0; k < NP; k++) ye[k] = chemCnt[k] > 0 ? sumChem[k] / chemCnt[k] / L : null;
    Plotly.restyle('g-chem', { y: [ye] }, [0]);

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
