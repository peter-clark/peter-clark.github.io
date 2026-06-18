/*
 * forest-fire.js — Drossel–Schwabl forest-fire model. [SKELETON]
 *
 * States per cell: 0 empty, 1 tree, 2 burning.
 * Rules each tick:
 *   - burning -> empty
 *   - tree    -> burning if any neighbour burning, else burning w.p. f (lightning)
 *   - empty   -> tree w.p. p (growth)
 *
 * TODO:
 *   - implement the synchronous update into a double-buffered grid.
 *   - track burning-cluster sizes for the power-law readout.
 */
(function () {
  'use strict';
  const { Grid, SimEngine, ui } = window.Sim;

  const EMPTY = 0, TREE = 1, FIRE = 2;
  const canvas = document.getElementById('sim-canvas');
  const COLS = 120, ROWS = 120;
  let grid = new Grid(COLS, ROWS);
  let next = new Grid(COLS, ROWS);
  let growth = 0.02;     // p
  let lightning = 0.0001; // f

  function init() {
    grid.fill(EMPTY); // TODO: seed with random trees
  }

  function step() {
    // TODO: apply the three rules from grid -> next, then swap.
    [grid, next] = [next, grid];
  }

  const COLORS = ['#e8e4da', '#3a7d3a', '#d8482b']; // empty, tree, fire
  function draw(ctx) {
    const cw = canvas.width / COLS, ch = canvas.height / ROWS;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = COLORS[grid.get(x, y)];
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
  }

  const engine = new SimEngine({ canvas, init, step, draw, fps: 20 });

  ui.slider('Growth p', { min: 0, max: 0.2, step: 0.005, value: growth }, (v) => { growth = v; });
  ui.slider('Lightning f', { min: 0, max: 0.001, step: 0.0001, value: lightning }, (v) => { lightning = v; });
})();
