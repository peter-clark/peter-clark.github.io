/*
 * engine.js — shared scaffolding for the canvas simulations.
 *
 * Provides:
 *   - SimEngine: a start/pause/step/reset animation-loop wrapper that hooks up
 *     the standard control buttons defined in _layouts/simulation.html.
 *   - Grid: a flat typed-array 2D grid with neighbour helpers.
 *   - ui helpers for injecting sliders/selects into the #sim-params panel.
 *
 * Each individual simulation (percolation.js, life.js, ...) creates a SimEngine
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

  global.Sim = { Grid, SimEngine, ui };
})(window);
