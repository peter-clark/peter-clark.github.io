/*
 * engine.js — shared scaffolding for the canvas simulations.
 *
 * Provides:
 *   - SimEngine: a start/pause/step/reset animation-loop wrapper that hooks up
 *     the standard control buttons defined in _layouts/simulation.html.
 *   - Grid: a flat typed-array 2D grid with neighbour helpers.
 *   - ui helpers for injecting sliders/selects into the #sim-params panel.
 *
 * Each individual simulation (percolation.js, sandpile.js, ...) creates a SimEngine
 * and fills in its own init() / step() / draw() callbacks. Nothing here runs a
 * model on its own — it is pure plumbing.
 */

(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Grid: flat array with wrap-around / bounded neighbour access.       */
  /* ------------------------------------------------------------------ */
  class Grid {
    constructor(cols, rows, ArrayType = Uint8Array) {
      this.cols = cols;
      this.rows = rows;
      this.cells = new ArrayType(cols * rows);
    }

    idx(x, y) {
      return y * this.cols + x;
    }

    get(x, y) {
      return this.cells[y * this.cols + x];
    }

    set(x, y, v) {
      this.cells[y * this.cols + x] = v;
    }

    fill(v) {
      this.cells.fill(v);
    }

    inBounds(x, y) {
      return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
    }

    // 4-connected (von Neumann) neighbour offsets.
    static N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // 8-connected (Moore) neighbour offsets.
    static N8 = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
  }

  /* ------------------------------------------------------------------ */
  /* SimEngine: render loop + standard buttons.                          */
  /* ------------------------------------------------------------------ */
  class SimEngine {
    /*
     * opts:
     *   canvas:  HTMLCanvasElement
     *   init:    () => void           // (re)build initial state
     *   step:    () => void           // advance one tick
     *   draw:    (ctx) => void        // render current state
     *   fps:     number               // target ticks per second (default 30)
     */
    constructor(opts) {
      this.canvas = opts.canvas;
      this.ctx = this.canvas.getContext('2d');
      this._init = opts.init || (() => {});
      this._step = opts.step || (() => {});
      this._draw = opts.draw || (() => {});
      this.fps = opts.fps || 30;

      this.running = false;
      this._lastTime = 0;
      this._acc = 0;
      this._frame = null;

      this._bindControls();
      this.reset();
    }

    _bindControls() {
      const toggle = document.getElementById('sim-toggle');
      const step = document.getElementById('sim-step');
      const reset = document.getElementById('sim-reset');
      if (toggle) toggle.addEventListener('click', () => this.toggle());
      if (step) step.addEventListener('click', () => this.tickOnce());
      if (reset) reset.addEventListener('click', () => this.reset());
    }

    reset() {
      this.pause();
      this._init();
      this.render();
    }

    tickOnce() {
      this._step();
      this.render();
    }

    render() {
      this._draw(this.ctx);
    }

    toggle() {
      this.running ? this.pause() : this.start();
    }

    start() {
      if (this.running) return;
      this.running = true;
      this._lastTime = 0;
      this._acc = 0;
      const loop = (t) => {
        if (!this.running) return;
        if (!this._lastTime) this._lastTime = t;
        this._acc += (t - this._lastTime) / 1000;
        this._lastTime = t;
        const dt = 1 / this.fps;
        let guard = 0;
        while (this._acc >= dt && guard < 8) {
          this._step();
          this._acc -= dt;
          guard++;
        }
        this.render();
        this._frame = requestAnimationFrame(loop);
      };
      this._frame = requestAnimationFrame(loop);
    }

    pause() {
      this.running = false;
      if (this._frame) cancelAnimationFrame(this._frame);
      this._frame = null;
    }

    setReadout(html) {
      const el = document.getElementById('sim-readout');
      if (el) el.innerHTML = html;
    }
  }

  /* ------------------------------------------------------------------ */
  /* ui: tiny helpers to add parameter controls to #sim-params.          */
  /* ------------------------------------------------------------------ */
  const ui = {
    _panel() {
      return document.getElementById('sim-params');
    },

    // Adds a labelled range slider; returns the <input> element.
    slider(label, { min, max, step, value }, onInput) {
      const wrap = document.createElement('div');
      wrap.className = 'control';
      const lab = document.createElement('label');
      const out = document.createElement('span');
      out.textContent = value;
      lab.textContent = label + ': ';
      lab.appendChild(out);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step; input.value = value;
      input.addEventListener('input', () => {
        out.textContent = input.value;
        if (onInput) onInput(parseFloat(input.value));
      });
      wrap.appendChild(lab);
      wrap.appendChild(input);
      this._panel().appendChild(wrap);
      return input;
    },

    // Adds a labelled <select>; options is [[value,label], ...].
    select(label, options, value, onChange) {
      const wrap = document.createElement('div');
      wrap.className = 'control';
      const lab = document.createElement('label');
      lab.textContent = label;
      const sel = document.createElement('select');
      for (const [v, l] of options) {
        const o = document.createElement('option');
        o.value = v; o.textContent = l;
        if (v === value) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => onChange && onChange(sel.value));
      wrap.appendChild(lab);
      wrap.appendChild(sel);
      this._panel().appendChild(wrap);
      return sel;
    },
  };

  /* ------------------------------------------------------------------ */
  /* readout: the live figures under the stage.                          */
  /*                                                                     */
  /* Every simulation reports different numbers, but they should all     */
  /* LOOK the same, so none of them writes its own markup. Pass rows and */
  /* this lays them out:                                                 */
  /*                                                                     */
  /*   Sim.readout([                                                     */
  /*     ['mean height', density.toFixed(3)],                            */
  /*     ['avalanches', n.toLocaleString()],                             */
  /*     ['running', size, true],     // true -> highlighted in accent   */
  /*   ]);                                                               */
  /*                                                                     */
  /* Rows with a null/undefined value are skipped, so a figure that      */
  /* only exists sometimes can be passed unconditionally. Values are     */
  /* inserted as text, never as HTML.                                    */
  /* ------------------------------------------------------------------ */
  function readout(rows) {
    const el = document.getElementById('sim-readout');
    if (!el) return;
    el.textContent = '';
    for (const row of rows) {
      if (!row) continue;
      const [label, value, live] = row;
      if (value === null || value === undefined || value === '') continue;

      const cell = document.createElement('div');
      cell.className = live ? 'sim-stat is-live' : 'sim-stat';

      const l = document.createElement('span');
      l.className = 'sim-stat-label';
      l.textContent = label;

      const v = document.createElement('span');
      v.className = 'sim-stat-value';
      v.textContent = String(value);

      cell.appendChild(l);
      cell.appendChild(v);
      el.appendChild(cell);
    }
  }

  /* ------------------------------------------------------------------ */
  /* SimTheme: one shared palette for every simulation.       */
  /* Kept in sync with _sass/theme.scss. Change it here to re-skin    */
  /* all canvases + graphs at once.                                      */
  /* ------------------------------------------------------------------ */
  const SimTheme = {
    panelBg: '#0b0b0b',   // canvas / plot background (matches .sim-graph)
    grid:    '#333333',   // plot gridlines
    text:    '#9a9a9a',   // plot font colour
    accent:  '#e67300',   // orange accent
    accentRGB: [230, 115, 0],
    font: 'Verdana, Geneva, Tahoma, sans-serif',
    // lattice cell colours as [r,g,b]
    empty:  [11, 11, 11],    // dark ground
    finite: [95, 95, 98],    // neutral gray clusters
    span:   [230, 115, 0],   // orange, the spanning cluster
    tree:   [79, 122, 58],   // muted green
    fire:   [230, 115, 0],   // orange fire
  };

  global.SimTheme = SimTheme;
  global.Sim = { Grid, SimEngine, ui, readout, theme: SimTheme };
})(window);
