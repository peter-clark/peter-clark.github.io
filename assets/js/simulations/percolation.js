/*
 * percolation.js — site percolation on a square lattice. [SKELETON]
 *
 * Model: each cell occupied with probability p. Find clusters of occupied
 * cells (4-connected) and highlight whether any cluster spans top->bottom.
 *
 * TODO:
 *   - init():  fill grid randomly using the current p.
 *   - cluster labelling (flood fill / union-find) to colour clusters.
 *   - detect a spanning cluster and report in setReadout().
 *   - "Randomize" instead of time-stepping (percolation is static per p).
 */
(function () {
  'use strict';
  const { Grid, SimEngine, ui } = window.Sim;

  const canvas = document.getElementById('sim-canvas');
  const COLS = 100, ROWS = 100;
  let grid = new Grid(COLS, ROWS);
  let p = 0.55;

  function init() {
    // TODO: for each cell, occupy with probability p; then label clusters.
    grid.fill(0);
  }

  function step() {
    // Percolation has no time dynamics; "Step" can re-randomize.
    // TODO: optionally animate p sweeping upward.
    init();
  }

  function draw(ctx) {
    const cw = canvas.width / COLS, ch = canvas.height / ROWS;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid.get(x, y)) {
          ctx.fillStyle = '#2c6e6b'; // TODO: colour by cluster id
          ctx.fillRect(x * cw, y * ch, cw, ch);
        }
      }
    }
    engine.setReadout(`p = ${p.toFixed(3)}<br>spanning: TODO`);
  }

  const engine = new SimEngine({ canvas, init, step, draw, fps: 4 });

  ui.slider('Occupation p', { min: 0, max: 1, step: 0.01, value: p }, (v) => {
    p = v;
    engine.reset();
  });
})();
