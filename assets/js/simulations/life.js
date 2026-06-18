/*
 * life.js — Conway's Game of Life. [SKELETON]
 *
 * Cell is alive (1) or dead (0). Using 8-neighbour (Moore) counts:
 *   - live cell with 2 or 3 live neighbours survives, else dies.
 *   - dead cell with exactly 3 live neighbours becomes alive.
 *
 * TODO:
 *   - step(): synchronous update grid -> next using neighbour counts.
 *   - click-to-toggle cells on the canvas for drawing patterns.
 *   - decide on wrap-around (toroidal) vs. bounded edges.
 */
(function () {
  'use strict';
  const { Grid, SimEngine, ui } = window.Sim;

  const canvas = document.getElementById('sim-canvas');
  const COLS = 80, ROWS = 80;
  let grid = new Grid(COLS, ROWS);
  let next = new Grid(COLS, ROWS);

  function init() {
    grid.fill(0); // TODO: random soup or a known pattern (glider, etc.)
  }

  function step() {
    // TODO: count live neighbours and apply B3/S23 into next, then swap.
    [grid, next] = [next, grid];
  }

  function draw(ctx) {
    const cw = canvas.width / COLS, ch = canvas.height / ROWS;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid.get(x, y)) ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
  }

  // TODO: click handler to toggle cells.
  // canvas.addEventListener('click', (e) => { ... });

  const engine = new SimEngine({ canvas, init, step, draw, fps: 12 });
})();
