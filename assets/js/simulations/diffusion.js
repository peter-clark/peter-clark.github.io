/*
 * diffusion.js — lattice diffusion / random walk. [SKELETON]
 *
 * Two equivalent views (pick one when implementing):
 *   (a) concentration field relaxed by the discrete heat equation:
 *       c'[i] = c[i] + D * (avg of 4 neighbours - c[i])
 *   (b) many independent random walkers binned to a density grid.
 *
 * TODO:
 *   - init():  place a concentrated drop in the centre.
 *   - step():  one explicit diffusion update (double-buffered).
 *   - colour-map the float field to a gradient in draw().
 */
(function () {
  'use strict';
  const { Grid, SimEngine, ui } = window.Sim;

  const canvas = document.getElementById('sim-canvas');
  const COLS = 120, ROWS = 120;
  let field = new Grid(COLS, ROWS, Float32Array);
  let next = new Grid(COLS, ROWS, Float32Array);
  let D = 0.2; // diffusion coefficient (stable for D <= 0.25 with 4-neighbour)

  function init() {
    field.fill(0);
    // TODO: set a hot spot, e.g. field.set(COLS/2|0, ROWS/2|0, 1)
  }

  function step() {
    // TODO: explicit update field -> next using D, then swap.
    [field, next] = [next, field];
  }

  function draw(ctx) {
    const cw = canvas.width / COLS, ch = canvas.height / ROWS;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = Math.max(0, Math.min(1, field.get(x, y)));
        // simple white -> teal ramp
        const c = Math.round(255 - v * (255 - 44));
        ctx.fillStyle = `rgb(${c}, ${Math.round(255 - v * 145)}, ${Math.round(255 - v * 148)})`;
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
  }

  const engine = new SimEngine({ canvas, init, step, draw, fps: 30 });

  ui.slider('Diffusion D', { min: 0, max: 0.25, step: 0.01, value: D }, (v) => { D = v; });
})();
