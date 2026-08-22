/*
 * lines.js — Line Ripple Background (Originkit), ported from the original
 * React/TSX component to a vanilla-JS full-page background layer.
 *
 * Renders into #bg-fx (the shared background layer in _layouts/default.html).
 * Which effect script loads there is chosen by `background_effect` in
 * _config.yml — set it to another file's name to swap effects entirely.
 *
 * To tweak THIS effect, edit the SETTINGS block below.
 */
(function () {
  'use strict';

  // Which layer to render into is set by the loading <script>'s data-target
  // (see _layouts/default.html), so this effect works in either slot.
  var _s = document.currentScript;
  var _targetId = (_s && _s.getAttribute('data-target')) || 'bg-fx';
  var container = document.getElementById(_targetId);
  if (!container) return;

  /* ================= SETTINGS (component defaults) ================= */
  var strokeColor = '#808080';       // line colour
  var backgroundColor = '#11111';   // solid gray ground
  var count = 100;                    // line density (1-100)
  var movement = 6;                 // drift speed
  var hover = true;                  // react to the cursor
  var force = 1;                     // cursor influence strength
  var resolution = 1;                // line length
  var BASE_ANGLE = 0;
  var CURL = 10;
  var SEED = 0.5;
  /* ================================================================ */

  /* ---- simplex-ish 2D noise ---- */
  function createNoise2D(seed) {
    var F2 = 0.5 * (Math.sqrt(3) - 1);
    var G2 = (3 - Math.sqrt(3)) / 6;
    var G22 = (3 - Math.sqrt(3)) / 3;
    var p = new Uint8Array(256);
    for (var i = 0; i < 256; i++) p[i] = i;
    var seededRandom = function (index) {
      var x = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    for (var k = 255; k > 0; k--) {
      var n = Math.floor((k + 1) * seededRandom(k));
      var q = p[k]; p[k] = p[n]; p[n] = q;
    }
    var perm = new Uint8Array(512);
    var permMod12 = new Uint8Array(512);
    for (var m = 0; m < 512; m++) { perm[m] = p[m & 255]; permMod12[m] = perm[m] % 12; }
    var grad2 = new Float64Array([
      1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1,
    ]);
    var fastFloor = function (x) { return Math.floor(x) | 0; };
    return function noise2D(x, y) {
      var s = (x + y) * F2;
      var i = fastFloor(x + s);
      var j = fastFloor(y + s);
      var t = (i + j) * G2;
      var x0 = x - (i - t);
      var y0 = y - (j - t);
      var i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      var x1 = x0 - i1 + G2;
      var y1 = y0 - j1 + G2;
      var x2 = x0 - 1 + G22;
      var y2 = y0 - 1 + G22;
      var ii = i & 255;
      var jj = j & 255;
      var gi0 = permMod12[ii + perm[jj]];
      var gi1 = permMod12[ii + i1 + perm[jj + j1]];
      var gi2 = permMod12[ii + 1 + perm[jj + 1]];
      var n0 = 0, n1 = 0, n2 = 0;
      var t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (grad2[gi0 * 2] * x0 + grad2[gi0 * 2 + 1] * y0); }
      var t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (grad2[gi1 * 2] * x1 + grad2[gi1 * 2 + 1] * y1); }
      var t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (grad2[gi2 * 2] * x2 + grad2[gi2 * 2 + 1] * y2); }
      return 70 * (n0 + n1 + n2);
    };
  }

  /* ---- state ---- */
  container.style.backgroundColor = backgroundColor;
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.display = 'block';
  container.appendChild(svg);

  var noise = createNoise2D(SEED);
  var bounding = null;
  var path = null;
  var points = [];
  var mouse = { x: -10, y: 0, lx: 0, ly: 0, sx: 0, sy: 0, v: 0, vs: 0, a: 0, set: false };

  function setSize() {
    var width = container.clientWidth || container.offsetWidth || 1;
    var height = container.clientHeight || container.offsetHeight || 1;
    bounding = { width: width, height: height };
    svg.style.width = width + 'px';
    svg.style.height = height + 'px';
  }

  function setLines() {
    if (!bounding) return;
    var width = bounding.width, height = bounding.height;
    var c = Math.max(1, Math.min(100, count));
    var gap = 90 - ((c - 1) / 99) * 82;
    var cols = Math.ceil((width + gap) / gap);
    var rows = Math.ceil((height + gap) / gap);
    var xStart = (width - gap * (cols - 1)) / 2;
    var yStart = (height - gap * (rows - 1)) / 2;
    points = [];
    for (var i = 0; i < cols; i++) {
      for (var j = 0; j < rows; j++) {
        points.push({ x: xStart + gap * i, y: yStart + gap * j, angle: 0, cursor: { x: 0, y: 0, vx: 0, vy: 0 } });
      }
    }
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.appendChild(path);
    }
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
  }

  // Convert client (viewport) coords to the container's local space, so hover
  // works whether this layer is the full-viewport background or a smaller box
  // (e.g. the banner inset).
  function updateMousePosition(clientX, clientY) {
    var rect = container.getBoundingClientRect();
    mouse.x = clientX - rect.left;
    mouse.y = clientY - rect.top;
    if (!mouse.set) { mouse.sx = mouse.x; mouse.sy = mouse.y; mouse.lx = mouse.x; mouse.ly = mouse.y; mouse.set = true; }
  }

  function movePoints(time) {
    if (!noise) return;
    var curl = CURL, base = BASE_ANGLE;
    var drift = time * movement * 8e-6;
    var dirX = Math.cos(base) * drift;
    var dirY = Math.sin(base) * drift;
    for (var idx = 0; idx < points.length; idx++) {
      var p = points[idx];
      var nz = noise(p.x * 0.004 - dirX, p.y * 0.004 - dirY);
      var target = base + nz * Math.PI * curl;
      var dx = p.x - mouse.sx;
      var dy = p.y - mouse.sy;
      var d = Math.hypot(dx, dy);
      var l = Math.max(175, mouse.vs);
      var bend = 0;
      if (hover && d < l) {
        var s = 1 - d / l;
        var influence = (force / 10) * 0.02;
        var tangent = Math.atan2(dy, dx) + Math.PI / 2;
        bend = (tangent - target) * s * (0.4 + mouse.vs * influence);
        var f = Math.cos(d * 0.001) * s;
        var push = (force / 10) * 7e-4;
        p.cursor.vx += Math.cos(Math.atan2(dy, dx)) * f * l * mouse.vs * push;
        p.cursor.vy += Math.sin(Math.atan2(dy, dx)) * f * l * mouse.vs * push;
      }
      var diff = target + bend - p.angle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      p.angle += diff * 0.12;
      p.cursor.vx += (0 - p.cursor.x) * 0.01;
      p.cursor.vy += (0 - p.cursor.y) * 0.01;
      p.cursor.vx *= 0.95;
      p.cursor.vy *= 0.95;
      p.cursor.x += p.cursor.vx;
      p.cursor.y += p.cursor.vy;
      p.cursor.x = Math.min(50, Math.max(-50, p.cursor.x));
      p.cursor.y = Math.min(50, Math.max(-50, p.cursor.y));
    }
  }

  function drawLines() {
    if (!path) return;
    var half = (6 + (resolution / 10) * 20) / 2;
    var d = '';
    for (var idx = 0; idx < points.length; idx++) {
      var p = points[idx];
      var cx = p.x + p.cursor.x;
      var cy = p.y + p.cursor.y;
      var ux = Math.cos(p.angle) * half;
      var uy = Math.sin(p.angle) * half;
      d += 'M ' + (cx - ux).toFixed(1) + ' ' + (cy - uy).toFixed(1) + ' L ' + (cx + ux).toFixed(1) + ' ' + (cy + uy).toFixed(1) + ' ';
    }
    path.setAttribute('d', d);
  }

  /* ---- boot ---- */
  setSize();
  setLines();
  window.addEventListener('resize', function () { setSize(); setLines(); });
  window.addEventListener('mousemove', function (e) { updateMousePosition(e.clientX, e.clientY); });
  container.addEventListener('touchmove', function (e) {
    var touch = e.touches[0];
    if (touch) updateMousePosition(touch.clientX, touch.clientY);
  }, { passive: true });

  function tick(time) {
    mouse.sx += (mouse.x - mouse.sx) * 0.1;
    mouse.sy += (mouse.y - mouse.sy) * 0.1;
    var dx = mouse.x - mouse.lx;
    var dy = mouse.y - mouse.ly;
    var d = Math.hypot(dx, dy);
    mouse.v = d;
    mouse.vs += (d - mouse.vs) * 0.1;
    mouse.vs = Math.min(100, mouse.vs);
    mouse.lx = mouse.x;
    mouse.ly = mouse.y;
    mouse.a = Math.atan2(dy, dx);
    movePoints(time);
    drawLines();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
