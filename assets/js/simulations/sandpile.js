/*
 * sandpile.js — Bak–Tang–Wiesenfeld abelian sandpile. [SKELETON]
 *
 * Each cell holds a grain count. When a cell reaches >= 4 it topples:
 * subtract 4, add 1 to each of its 4 neighbours. Grains falling off the
 * boundary are lost. Toppling repeats until the configuration is stable.
 *
 * TODO:
 *   - init():  start from a flat bed or a tall central spike.
 *   - step():  add a grain (centre or random) then relax via a topple queue.
 *   - count avalanche size (number of topples) for the readout.
 */
(function () {
  'use strict';
  const { Grid, SimEngine, ui } = window.Sim;

  const canvas = document.getElementById('sim-canvas');
  const COLS = 101, ROWS = 101;
  let grid = new Grid(COLS, ROWS, Int16Array);
  let dropMode = 'center';

  function init() {
    grid.fill(0); // TODO: optionally pre-load a high uniform value
  }

  function step() {
    // TODO: drop one grain, then topple all cells >= 4 until stable.
  }

  const COLORS = ['#f4f4f5', '#cfe0df', '#7fb3b0', '#2c6e6b']; // heights 0..3
  function draw(ctx) {
    const cw = canvas.width / COLS, ch = canvas.height / ROWS;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const h = Math.min(grid.get(x, y), 3);
        ctx.fillStyle = COLORS[h];
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
  }

  const engine = new SimEngine({ canvas, init, step, draw, fps: 30 });

  ui.select('Drop at', [['center', 'Center'], ['random', 'Random']], dropMode, (v) => {
    dropMode = v;
  });
})();
