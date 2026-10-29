/* Animated ASCII wallpapers: the cell renderer, the scenes, settings storage and the
   scene picker tiles. Shared by the claude.ai content script and the popup. */
(function (global) {
  'use strict';

  const CELL_W = 9;
  const CELL_H = 14;
  const TAU = Math.PI * 2;
  const DEFAULTS = { scene: 'honu', glass: true, veil: 0.25, speed: 1 };

  const hash = (x, y) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const rng = (seed) => {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  };

  // ---------- sprites: lists of [x, y, colourKey] cells ----------
  function mask(rows) {
    const cells = [];
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== ' ') cells.push([x, y, row[x]]); });
    return { cells, w: Math.max(...rows.map((r) => r.length)), h: rows.length };
  }
  function shape(w, h, fn) {
    const cells = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y); if (c) cells.push([x, y, c]); }
    return { cells, w, h };
  }
  // Cells are taller than wide, so round things are stretched by KX across.
  const KX = CELL_H / CELL_W;

  function cloud(w, h, rnd) {
    const puffs = [{ x: w / 2, y: h * 0.72, rx: w * 0.46, ry: h * 0.26 }];
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      puffs.push({ x: w * (0.18 + (0.64 * (i + rnd() * 0.6)) / n), y: h * (0.45 + rnd() * 0.2), rx: w * (0.13 + rnd() * 0.12), ry: h * (0.32 + rnd() * 0.2) });
    }
    return shape(w, h, (x, y) => {
      if (y > h * 0.95) return null;
      for (const p of puffs) { const dx = (x - p.x) / p.rx, dy = (y - p.y) / p.ry; if (dx * dx + dy * dy <= 1) return y > h * 0.68 ? 's' : 'c'; }
      return null;
    });
  }
  function moon(r) {
    return shape(Math.ceil(2 * r * KX) + 1, 2 * r + 1, (x, y) => {
      const dx = x / KX - r, dy = y - r, ix = dx - r * 0.55, iy = dy + r * 0.2;
      return dx * dx + dy * dy <= r * r && ix * ix + iy * iy > r * r * 0.8 ? 'm' : null;
    });
  }
  function bell(r) {
    return shape(Math.ceil(2 * r * KX) + 1, r + 1, (x, y) => {
      const dx = x / KX - r, dy = r - y;
      return dx * dx + dy * dy <= r * r ? (dy > r * 0.6 ? 'h' : 'b') : null;
    });
  }
  function pad(rx, ry) {
    return shape(Math.ceil(2 * rx) + 1, Math.ceil(2 * ry) + 1, (x, y) => {
      const dx = (x - rx) / rx, dy = (y - ry) / ry;
      if (dx * dx + dy * dy > 1) return null;
      return dx > 0.15 && Math.abs(dy) < 0.18 ? null : dx * dx + dy * dy > 0.55 ? 'e' : 'p';
    });
  }

  const KOI = mask([
    '       oo        ',
    'ww   ooowwoo     ',
    ' www owwwoooowoo ',
    '  wwwoooowwoooooo',
    ' www owwoooowoo  ',
    'ww   ooowwoo     ',
    '       oo        ',
  ]);
  const BOAT = mask([
    '      w      ',
    '     www     ',
    '    wwwww    ',
    '   wwwwwww   ',
    'ooooooooooooo',
    ' ooooooooooo ',
    '  ooooooooo  ',
  ]);

  // ---------- simple scenes (drawn straight onto the cell grid) ----------
  function makeCloud(g, rnd, anywhere, far) {
    const d = rnd();
    const w = Math.round(14 + d * 24), h = Math.round(4 + d * 5);
    return {
      spr: cloud(w, h, rnd), d,
      x: anywhere ? rnd() * (g.cols + w) - w : -w - rnd() * 15,
      y: rnd() * g.rows * (far ? 0.45 : 0.8) - h * 0.3,
      v: 0.5 + d * 1.5, a: 0.5 + d * 0.5, seed: (rnd() * 997) | 0,
    };
  }
  function drift(g, s, list, colors, far) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      c.x += c.v * g.dt;
      if (c.x > g.cols + 2) { list[i] = makeCloud(g, s.rnd, false, far); list.sort((a, b) => a.d - b.d); }
      g.sprite(c.spr, c.x, c.y, colors, { alpha: c.a, seed: c.seed });
    }
  }
  const area = (g, per) => Math.max(2, Math.round((g.cols * g.rows) / per));

  const JELLY_COLORS = [
    { b: '#c38cff', h: '#f0d4ff', t: '#e59cff' },
    { b: '#ff8cc8', h: '#ffd6ec', t: '#ffa8d8' },
    { b: '#7fd8ff', h: '#d6f4ff', t: '#9be4ff' },
  ];
  function newJelly(g, rnd, anywhere) {
    const spr = bell(3 + Math.floor(rnd() * 3));
    return {
      spr, x: rnd() * (g.cols - spr.w), y: anywhere ? rnd() * g.rows : g.rows + 2 + rnd() * 6,
      v: 0.5 + rnd() * 1.1, ph: rnd() * TAU, tent: 4 + Math.floor(rnd() * 3), len: 5 + Math.floor(rnd() * 6),
      c: JELLY_COLORS[Math.floor(rnd() * JELLY_COLORS.length)], seed: (rnd() * 997) | 0,
    };
  }

  const SCENES = [
    {
      id: 'clouds', name: 'Mây trôi', sky: ['#4aa8ec', '#bfe4fd'], glyphs: 'SXSX#',
      init(g, rnd) {
        const clouds = Array.from({ length: area(g, 700) }, () => makeCloud(g, rnd, true)).sort((a, b) => a.d - b.d);
        return { rnd, clouds };
      },
      draw(g, s) { drift(g, s, s.clouds, { c: '#ffffff', s: '#d6ecfa' }); },
    },
    {
      id: 'koi', name: 'Hồ cá koi', sky: ['#1f7a63', '#0d4a44', '#082f2d'], glyphs: '#%S',
      init(g, rnd) {
        const pads = Array.from({ length: area(g, 1100) }, () => ({ spr: pad(3 + rnd() * 4, 2 + rnd() * 2), x: rnd() * g.cols, y: rnd() * g.rows, ph: rnd() * TAU, seed: (rnd() * 997) | 0 }));
        const fish = Array.from({ length: area(g, 1500) }, () => ({ x: rnd() * g.cols, y: rnd() * g.rows, v: (0.8 + rnd() * 1.4) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * TAU, amp: 1 + rnd() * 3, seed: (rnd() * 997) | 0 }));
        const glints = Array.from({ length: area(g, 60) }, () => ({ x: rnd() * g.cols, y: rnd() * g.rows, ph: rnd() * TAU }));
        return { pads, fish, glints };
      },
      draw(g, s) {
        for (const p of s.glints) g.cell(p.x, p.y, '·', '#bff7e4', 0.15 + 0.35 * Math.max(0, Math.sin(g.t * 0.9 + p.ph)));
        for (const f of s.fish) {
          f.x += f.v * g.dt;
          if (f.x > g.cols + 20) f.x = -20; else if (f.x < -20) f.x = g.cols + 20;
          const y = f.y + Math.sin(f.x * 0.07 + f.ph) * f.amp, t = g.t;
          g.sprite(KOI, f.x, y, { o: '#ff7a2b', w: '#fff1e2' }, { flip: f.v < 0, seed: f.seed, offset: (cx) => [0, cx < 5 ? Math.round(Math.sin(t * 6 + f.ph) * 0.7) : 0] });
        }
        for (const p of s.pads) g.sprite(p.spr, p.x, p.y + Math.sin(g.t * 0.6 + p.ph) * 0.4, { p: '#3fa34d', e: '#2c7a3a' }, { seed: p.seed, glyphs: '@%#' });
      },
    },
    {
      id: 'jelly', name: 'Sứa', sky: ['#24308a', '#0b1240', '#05081f'], glyphs: '*+x#',
      init(g, rnd) {
        const jellies = Array.from({ length: area(g, 1300) }, () => newJelly(g, rnd, true));
        const dust = Array.from({ length: area(g, 45) }, () => ({ x: rnd() * g.cols, y: rnd() * g.rows, v: 0.1 + rnd() * 0.3, ph: rnd() * TAU }));
        return { rnd, jellies, dust };
      },
      draw(g, s) {
        for (const p of s.dust) {
          p.y -= p.v * g.dt; if (p.y < -1) p.y = g.rows + 1;
          g.cell(p.x + Math.sin(g.t * 0.5 + p.ph), p.y, '.', '#7fe7ff', 0.2 + 0.4 * Math.abs(Math.sin(g.t + p.ph)));
        }
        for (let i = 0; i < s.jellies.length; i++) {
          const j = s.jellies[i];
          j.y -= j.v * g.dt * (0.6 + 0.4 * Math.max(0, Math.sin(g.t * 1.6 + j.ph)));
          if (j.y < -j.spr.h - j.len - 2) { s.jellies[i] = newJelly(g, s.rnd, false); continue; }
          const x = j.x + Math.sin(g.t * 0.4 + j.ph) * 2, n = j.tent, t = g.t;
          for (let k = 0; k < n; k++) {
            const tx = 1 + ((j.spr.w - 2) * k) / (n - 1);
            for (let d = 0; d < j.len; d++) {
              g.cell(x + tx + Math.sin(t * 1.5 + d * 0.5 + k) * d * 0.16, j.y + j.spr.h + d, d % 3 ? ':' : '|', j.c.t, 0.85 - d / (j.len + 2));
            }
          }
          const squeeze = Math.sin(t * 1.6 + j.ph) * 0.06;
          g.sprite(j.spr, x, j.y, { b: j.c.b, h: j.c.h }, { seed: j.seed, offset: (cx) => [Math.round((cx - j.spr.w / 2) * squeeze), 0] });
        }
      },
    },
    {
      id: 'boats', name: 'Thuyền giấy', sky: ['#c4f4ef', '#72d4d6', '#1e8fa6'], glyphs: 'SX#',
      init(g, rnd) {
        const horizon = Math.round(g.rows * 0.5);
        const clouds = Array.from({ length: area(g, 1800) }, () => makeCloud(g, rnd, true, true)).sort((a, b) => a.d - b.d);
        const boats = Array.from({ length: area(g, 1600) }, () => ({ x: rnd() * g.cols, row: horizon + 2 + rnd() * (g.rows - horizon - 10), v: 0.4 + rnd() * 0.9, ph: rnd() * TAU, red: rnd() < 0.3, seed: (rnd() * 997) | 0 })).sort((a, b) => a.row - b.row);
        return { rnd, horizon, clouds, boats };
      },
      draw(g, s) {
        drift(g, s, s.clouds, { c: '#ffffff', s: '#e3f6f4' }, true);
        const t = g.t, h0 = s.horizon;
        for (let r = h0; r < g.rows; r++) {
          const depth = (r - h0) / (g.rows - h0);
          for (let c = 0; c < g.cols; c++) {
            const v = Math.sin(c * 0.28 + t * 1.2 + r * 0.9) + 0.6 * Math.sin(c * 0.11 - t * 0.7 + r * 1.7);
            if (v > 0.75) g.cell(c, r, v > 1.2 ? '~' : '-', '#f2fffd', 0.25 + 0.45 * depth);
          }
        }
        for (const b of s.boats) {
          b.x += b.v * g.dt; if (b.x > g.cols + 2) b.x = -BOAT.w - 2;
          const bob = Math.sin(t * 1.3 + b.ph) * 0.6;
          g.sprite(BOAT, b.x, b.row - BOAT.h + bob, { w: b.red ? '#ff8b7b' : '#ffffff', o: '#f6ead0' }, { seed: b.seed, offset: (cx, cy) => [0, cy >= 4 ? 0 : Math.round(Math.sin(t * 1.3 + b.ph + cx * 0.2) * 0.4)] });
        }
      },
    },
    {
      id: 'fireflies', name: 'Đom đóm', sky: ['#06120f', '#0b2a22', '#0f3a2c'], glyphs: '*',
      init(g, rnd) {
        const flies = Array.from({ length: area(g, 220) }, () => ({ x: rnd() * g.cols, y: g.rows * (0.2 + rnd() * 0.75), vx: 0, vy: 0, ph: rnd() * TAU, sp: 0.6 + rnd() * 1.4 }));
        const stars = Array.from({ length: area(g, 160) }, () => ({ x: rnd() * g.cols, y: rnd() * g.rows * 0.35, ph: rnd() * TAU }));
        return { rnd, flies, stars };
      },
      draw(g, s) {
        const { ctx, t } = g;
        for (const p of s.stars) g.cell(p.x, p.y, '·', '#cfe9dc', 0.15 + 0.25 * Math.abs(Math.sin(t * 0.7 + p.ph)));
        for (let c = 0; c < g.cols; c++) {
          const h = 2 + (hash(c, 1) % 4) + (hash(c, 2) % 9 === 0 ? 3 : 0), sway = Math.sin(t * 0.8 + c * 0.15);
          for (let k = 0; k < h; k++) {
            const top = k === h - 1, ch = top ? (sway > 0.3 ? '/' : sway < -0.3 ? '\\' : '|') : '|';
            g.cell(c + (top ? Math.round(sway * 0.6) : 0), g.rows - 1 - k, ch, k > 2 ? '#1d7a4c' : '#145c3a', 0.9);
          }
        }
        for (const f of s.flies) {
          f.vx += (s.rnd() - 0.5) * 2 * g.dt; f.vy += (s.rnd() - 0.5) * 2 * g.dt;
          f.vx *= 0.98; f.vy *= 0.98;
          f.x = (f.x + f.vx * f.sp * g.dt * 3 + g.cols) % g.cols;
          f.y = Math.min(g.rows - 3, Math.max(g.rows * 0.15, f.y + f.vy * f.sp * g.dt * 3));
          const b = Math.max(0, Math.sin(t * f.sp + f.ph)) ** 2;
          if (b < 0.02) continue;
          const px = (Math.round(f.x) + 0.5) * g.cw, py = (Math.round(f.y) + 0.5) * g.ch, r = g.ch * 1.6;
          const glow = ctx.createRadialGradient(px, py, 0, px, py, r);
          glow.addColorStop(0, `rgba(214,255,120,${0.45 * b})`); glow.addColorStop(1, 'rgba(214,255,120,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = glow; ctx.fillRect(px - r, py - r, r * 2, r * 2);
          g.cell(f.x, f.y, '•', '#f3ffb0', 0.3 + 0.7 * b);
        }
      },
    },
    {
      id: 'moon', name: 'Đêm trăng', sky: ['#070c33', '#111d63', '#22348f'], glyphs: 'SX#',
      init(g, rnd) {
        const r = Math.max(4, Math.min(9, Math.round(g.rows * 0.11)));
        const stars = Array.from({ length: area(g, 55) }, () => ({ x: rnd() * g.cols, y: rnd() * g.rows, ph: rnd() * TAU, sp: 0.5 + rnd() * 2, ch: rnd() < 0.15 ? '+' : rnd() < 0.08 ? '*' : '·' }));
        const clouds = Array.from({ length: area(g, 1400) }, () => makeCloud(g, rnd, true)).sort((a, b) => a.d - b.d);
        return { rnd, moon: moon(r), mx: g.cols * 0.7, my: g.rows * 0.1, stars, clouds, shoot: null, next: 4 };
      },
      draw(g, s) {
        const { ctx, t } = g;
        for (const p of s.stars) g.cell(p.x, p.y, p.ch, '#dfe6ff', 0.2 + 0.8 * Math.abs(Math.sin(t * p.sp + p.ph)));
        const cx = (s.mx + s.moon.w / 2) * g.cw, cy = (s.my + s.moon.h / 2) * g.ch, r = s.moon.h * g.ch * 1.4;
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        glow.addColorStop(0, 'rgba(255,240,200,0.18)'); glow.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = glow; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        g.sprite(s.moon, s.mx, s.my, { m: '#fff3c9' }, { glyphs: '#@' });
        s.next -= g.dt;
        if (!s.shoot && s.next <= 0) s.shoot = { x: s.rnd() * g.cols * 0.6, y: s.rnd() * g.rows * 0.3, age: 0 };
        if (s.shoot) {
          const sh = s.shoot; sh.age += g.dt;
          for (let k = 0; k < 10; k++) g.cell(sh.x + sh.age * 40 - k * 1.6, sh.y + sh.age * 14 - k * 0.55, k ? '-' : '*', '#ffffff', (1 - k / 10) * Math.max(0, 1 - sh.age / 1.2));
          if (sh.age > 1.2) { s.shoot = null; s.next = 5 + s.rnd() * 8; }
        }
        drift(g, s, s.clouds, { c: '#7d8ce6', s: '#5664c8' });
      },
    },
  ];

  // ---------- Honu lagoon: a top-down reef rendered from supersampled shapes ----------
  // Based on the user's sample lagoon. Drawn on a fixed 1944×1760 stage, which the
  // renderer scales to cover the viewport. Every motion loops within T seconds.
  const honu = (() => {
    const W = 1944, H = 1760, T = 24.5, w = TAU / T;
    const CW = 16, CH = 22, COLS = Math.ceil(W / CW), ROWS = Math.ceil(H / CH), SS = 4;
    let ready = null;
    const hsh = (a, b, c) => { const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return h - Math.floor(h); };
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
    const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    const STOPS = [[0, [178, 244, 232]], [0.42, [74, 214, 214]], [0.78, [26, 168, 202]], [1, [14, 128, 182]]];
    const water = (x, y) => {
      const k = Math.min(1, Math.max(0, (x * 0.45 + y * 0.9) / (W * 0.45 + H * 0.9)));
      for (let i = 1; i < STOPS.length; i++) if (k <= STOPS[i][0]) return mix(STOPS[i - 1][1], STOPS[i][1], (k - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]));
      return STOPS[3][1];
    };
    const ell = (g, x, y, rx, ry, rot, fill) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); g.fillStyle = fill; g.fill(); };

    function turtle(g, t, ph) {
      const f = Math.sin((TAU * 14 * t) / T + ph);
      for (const m of [-1, 1]) {
        g.save(); g.translate(62, 58 * m); g.rotate(m * (1.15 + 0.55 * f));
        ell(g, 0, 78 * m, 26, 92, 0, '#9c8a5c'); ell(g, 0, 70 * m, 14, 70, 0, '#c2b183'); g.restore();
        g.save(); g.translate(-92, 40 * m); g.rotate(m * (2.2 - 0.3 * f));
        ell(g, 0, 26 * m, 15, 34, 0, '#9c8a5c'); g.restore();
      }
      ell(g, 118, 0, 30, 24, 0, '#a39060'); ell(g, 150, 0, 34, 27, 0, '#b8a573');
      ell(g, 146, -10, 7, 5, 0, '#4b3f22'); ell(g, 146, 10, 7, 5, 0, '#4b3f22');
      ell(g, 0, 0, 132, 100, 0, '#c9b067');
      const sh = g.createRadialGradient(-10, 0, 10, 0, 0, 125);
      sh.addColorStop(0, '#7d6a2e'); sh.addColorStop(0.7, '#5e5022'); sh.addColorStop(1, '#3f3616');
      ell(g, 0, 0, 120, 90, 0, sh);
      g.fillStyle = '#b39a4a';
      for (const [x, y, r] of [[60, 0, 26], [12, 0, 30], [-38, 0, 28], [-80, 0, 20], [40, -50, 22], [-8, -56, 24], [-56, -46, 20], [40, 50, 22], [-8, 56, 24], [-56, 46, 20]]) {
        g.beginPath(); for (let k = 0; k < 6; k++) g.lineTo(x + r * Math.cos((k * TAU) / 6), y + r * 0.8 * Math.sin((k * TAU) / 6)); g.fill();
      }
      g.fillStyle = '#e0c56a';
      for (const [x, y] of [[60, 0], [12, 0], [-38, 0], [-8, -56], [-8, 56]]) { g.beginPath(); g.arc(x, y, 8, 0, TAU); g.fill(); }
    }
    function manta(g, t) {
      const f = Math.sin((TAU * 10 * t) / T), span = 300 + 22 * f, back = -40 - 30 * f;
      g.beginPath(); g.moveTo(-110, 0); g.lineTo(-330, 4 * f); g.lineWidth = 7; g.strokeStyle = '#1c2733'; g.stroke();
      g.beginPath(); g.moveTo(96, -42);
      g.quadraticCurveTo(40, -span * 0.75, back, -span); g.quadraticCurveTo(-60, -110, -118, -26);
      g.lineTo(-118, 26); g.quadraticCurveTo(-60, 110, back, span); g.quadraticCurveTo(40, span * 0.75, 96, 42);
      g.closePath(); g.fillStyle = '#1e2b3a'; g.fill();
      for (const m of [-1, 1]) {
        ell(g, 120, 40 * m, 34, 12, 0.35 * m, '#26364a');
        ell(g, 18, 82 * m, 70, 30, -0.5 * m, '#e9eef0');
        ell(g, -10, 150 * m, 40, 18, -0.6 * m, '#8fa3b0');
      }
    }
    function dolphin(g, t, ph) {
      const b = 0.22 * Math.sin((TAU * 60 * t) / T + ph);
      g.save(); g.translate(-30, 0); g.rotate(b);
      g.beginPath(); g.moveTo(10, -44); g.quadraticCurveTo(-90, -24, -150, -9); g.lineTo(-150, 9); g.quadraticCurveTo(-90, 24, 10, 44); g.fillStyle = '#5c6d7c'; g.fill();
      g.translate(-150, 0); g.rotate(b * 1.4);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-20, -60, -52, -66); g.quadraticCurveTo(-30, -20, -40, 0); g.quadraticCurveTo(-30, 20, -52, 66); g.quadraticCurveTo(-20, 60, 0, 0); g.fillStyle = '#4b5a68'; g.fill();
      g.restore();
      for (const m of [-1, 1]) ell(g, 40, 48 * m, 44, 13, -0.75 * m, '#6f8190');
      g.beginPath(); g.moveTo(-40, -44); g.quadraticCurveTo(40, -58, 150, -18); g.lineTo(200, -4); g.lineTo(200, 4); g.lineTo(150, 18); g.quadraticCurveTo(40, 58, -40, 44); g.fillStyle = '#8a9cab'; g.fill();
      ell(g, 20, 0, 120, 22, 0, '#43515e');
    }
    function tang(g, t, ph) {
      const b = 0.35 * Math.sin((TAU * 110 * t) / T + ph);
      g.save(); g.translate(-30, 0); g.rotate(b);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-34, -20); g.lineTo(-28, 0); g.lineTo(-34, 20); g.closePath(); g.fillStyle = '#f2c200'; g.fill(); g.restore();
      ell(g, 8, 0, 46, 15, 0, '#ffd61f'); ell(g, 40, 0, 12, 9, 0, '#ffe46a');
    }
    function whale(g, t) {
      const b = 0.16 * Math.sin((TAU * 8 * t) / T);
      g.save(); g.translate(-260, 0); g.rotate(b);
      g.beginPath(); g.moveTo(40, -70); g.quadraticCurveTo(-120, -30, -260, -14); g.lineTo(-260, 14); g.quadraticCurveTo(-120, 30, 40, 70); g.fillStyle = '#2b3d52'; g.fill();
      g.translate(-260, 0); g.rotate(b * 1.5);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-30, -110, -90, -130); g.quadraticCurveTo(-60, -40, -70, 0); g.quadraticCurveTo(-60, 40, -90, 130); g.quadraticCurveTo(-30, 110, 0, 0); g.fillStyle = '#dfe7ea'; g.fill();
      g.restore();
      const fl = 0.15 * Math.sin((TAU * 8 * t) / T + 1);
      for (const m of [-1, 1]) { g.save(); g.translate(150, 95 * m); g.rotate(m > 0 ? 0.6 + fl : Math.PI - 0.6 - fl); ell(g, 0, 120, 30, 125, 0, '#e6eef0'); g.restore(); }
      g.beginPath(); g.moveTo(330, 0); g.quadraticCurveTo(300, -110, 100, -130); g.quadraticCurveTo(-120, -110, -260, -70); g.lineTo(-260, 70); g.quadraticCurveTo(-120, 110, 100, 130); g.quadraticCurveTo(300, 110, 330, 0); g.fillStyle = '#33475e'; g.fill();
      g.fillStyle = '#596f86'; for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(300 - k * 30, 0, 7, 0, TAU); g.fill(); }
      g.beginPath(); g.moveTo(-60, -10); g.quadraticCurveTo(-90, 0, -60, 10); g.fillStyle = '#1e2d3e'; g.fill();
    }
    function hibiscus(g, s) {
      for (let k = 0; k < 5; k++) { g.save(); g.rotate((k * TAU) / 5); ell(g, 52 * s, 0, 52 * s, 40 * s, 0, '#ef3b5a'); ell(g, 40 * s, 0, 30 * s, 22 * s, 0, '#d42448'); g.restore(); }
      ell(g, 0, 0, 22 * s, 22 * s, 0, '#8a0f2e');
      g.save(); g.rotate(0.6); ell(g, 44 * s, 0, 40 * s, 5 * s, 0, '#ffd84a'); ell(g, 84 * s, 0, 10 * s, 10 * s, 0, '#ffe27a'); g.restore();
    }
    function plumeria(g, s) {
      for (let k = 0; k < 5; k++) { g.save(); g.rotate((k * TAU) / 5); ell(g, 36 * s, 12 * s, 40 * s, 24 * s, 0.35, '#fffaf0'); g.restore(); }
      const c = g.createRadialGradient(0, 0, 2, 0, 0, 34 * s); c.addColorStop(0, '#ffb800'); c.addColorStop(1, 'rgba(255,214,90,0)');
      ell(g, 0, 0, 34 * s, 34 * s, 0, c);
    }

    const P = {
      turtleA: (t) => [972 + 1080 * Math.cos(w * t + 0.3), 860 + 640 * Math.sin(w * t + 0.3) + 140 * Math.sin(2 * w * t)],
      turtleB: (t) => [900 + 700 * Math.sin(-w * t + 1), 880 - 1080 * Math.cos(-w * t + 1)],
      turtleC: (t) => [972 + 1150 * Math.sin(w * t + 4), 900 + 560 * Math.sin(2 * w * t + 4.6)],
      manta: (t) => [972 + 1380 * Math.cos(-w * t + 3.6), 820 + 900 * Math.sin(-w * t + 3.6)],
      dolphin: (t) => [972 + 1350 * Math.cos(2 * w * t + 0.8), 900 + 950 * Math.sin(2 * w * t + 0.8) + 160 * Math.sin(4 * w * t)],
      school: (t) => [972 + 1150 * Math.sin(2 * w * t + 5), 880 + 800 * Math.sin(3 * w * t + 1)],
      whale: (t) => [972 + 1900 * Math.cos(w * t + 2.4), 1350 + 380 * Math.sin(w * t + 2.4)],
    };
    const pose = (fn, t) => { const [x, y] = fn(t), [x2, y2] = fn(t + 0.02); return [x, y, Math.atan2(y2 - y, x2 - x)]; };
    const put = (g, x, y, a, s, draw) => { g.save(); g.translate(x, y); g.rotate(a); if (s !== 1) g.scale(s, s); draw(g); g.restore(); };
    const FISH = [[0, 0], [-120, -70], [-120, 75], [-240, -10], [-230, -140], [-235, 130], [-360, -75], [-355, 70], [-470, 5], [-480, -150], [-470, 150]];
    const FLOWERS = [['h', 0.0, 260, 1.0, 1], ['p', 0.22, 1240, 0.9, -1], ['h', 0.47, 640, 0.8, -1], ['p', 0.63, 1560, 1.1, 1], ['p', 0.86, 120, 0.8, 1]];
    const RAMP = '8%XSSt%t;:', EDGE = "',.o:;", SPRINK = ['#ff5fa2', '#16c79a', '#8b6cff', '#ffb000'];

    const mk = (cw, ch) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return [c, c.getContext('2d', { willReadFrequently: true })]; };

    // Built once, on first use, and shared by every renderer showing this scene.
    function setup() {
      const [oc, ox] = mk(COLS * SS, ROWS * SS);
      const [bgc, bgx] = mk(W, H);
      const grad = bgx.createLinearGradient(0, 0, W * 0.45, H * 0.9);
      STOPS.forEach(([k, c]) => grad.addColorStop(k, rgb(c)));
      bgx.fillStyle = grad; bgx.fillRect(0, 0, W, H);
      bgx.fillStyle = 'rgba(255,255,255,0.07)';
      for (let x = 0; x < W; x += CW) bgx.fillRect(x, 0, 1, H);
      for (let y = 0; y < H; y += CH) bgx.fillRect(0, y, W, 1);

      // Shapes are drawn supersampled, then the canvas box-filters them down to one pixel
      // per cell. Reading back that small image (not the big one) and reusing the output
      // array keeps each frame from leaving ~1.5 MB of garbage, whose collection pauses
      // the page.
      const [sc, sx] = mk(COLS, ROWS);
      sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
      function sample(draw, out = new Float32Array(COLS * ROWS * 4)) {
        ox.setTransform(1, 0, 0, 1, 0, 0); ox.clearRect(0, 0, oc.width, oc.height);
        ox.setTransform(SS / CW, 0, 0, SS / CH, 0, 0);
        draw(ox);
        sx.clearRect(0, 0, COLS, ROWS); sx.drawImage(oc, 0, 0, COLS, ROWS);
        const d = sx.getImageData(0, 0, COLS, ROWS).data;
        for (let p = 0; p < d.length; p += 4) { out[p] = d[p]; out[p + 1] = d[p + 1]; out[p + 2] = d[p + 2]; out[p + 3] = d[p + 3] / 255; }
        return out;
      }
      const reef = sample((g) => {
        const blob = (x, y, r, c1, c2, n) => { for (let k = 0; k < n; k++) { const a = hsh(x, y, k) * TAU, d = hsh(y, x, k) * r * 0.7; ell(g, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.9, r * (0.35 + 0.3 * hsh(k, x, y)), r * (0.3 + 0.3 * hsh(k, y, x)), a, k % 2 ? c1 : c2); } };
        blob(140, 1600, 110, '#d98a6a', '#c46a5a', 10); blob(1800, 220, 100, '#d8b86a', '#c49c4c', 9);
        blob(80, 380, 80, '#c9a0d8', '#e2a0b8', 7); blob(1700, 1650, 110, '#d6b870', '#e8907a', 10);
        for (const [x, y, r, c] of [[300, 1460, 46, '#ff6a3d'], [1520, 1560, 40, '#ff8a2a'], [1900, 420, 36, '#e8483c'], [220, 300, 34, '#ff7a3a']]) {
          g.save(); g.translate(x, y); g.rotate(hsh(x, y, 1) * TAU);
          for (let k = 0; k < 5; k++) { g.save(); g.rotate((k * TAU) / 5); ell(g, r * 0.6, 0, r * 0.65, r * 0.2, 0, c); g.restore(); }
          ell(g, 0, 0, r * 0.3, r * 0.3, 0, c); g.restore();
        }
        for (const [x, y] of [[560, 1580], [1740, 1480], [1960, 980], [40, 900]]) { g.save(); g.translate(x, y); for (let k = 0; k < 12; k++) { g.rotate(TAU / 12); ell(g, 22, 0, 22, 3, 0, '#3a1f4a'); } ell(g, 0, 0, 14, 14, 0, '#2a1438'); g.restore(); }
      });
      return { bgc, sample, reef, deepBuf: new Float32Array(COLS * ROWS * 4), mainBuf: new Float32Array(COLS * ROWS * 4) };
    }

    function cells(ctx, L, depth, t) {
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        const o = (j * COLS + i) * 4, a = L[o + 3];
        if (a < 0.12) continue;
        const x = i * CW, y = j * CH;
        let c = [L[o], L[o + 1], L[o + 2]];
        if (depth) c = mix(c, water(x, y), depth);
        const flick = hsh(i, j, Math.floor(t * 7));
        if (a > 0.5) {
          ctx.fillStyle = rgb(c, depth ? 0.9 : 1); ctx.fillRect(x + 1, y + 1, CW - 2, CH - 2);
          const l = lum(c), ch = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(1 + l * 5 + flick * 4)))];
          ctx.fillStyle = flick < 0.04 ? SPRINK[(flick * 100) | 0] : rgb(l < 0.42 ? mix(c, [255, 255, 255], 0.62) : mix(c, [0, 0, 0], 0.58), depth ? 0.6 : 1);
          ctx.fillText(ch, x + CW / 2, y + CH / 2 + 1);
        } else {
          ctx.fillStyle = rgb(c, Math.min(1, a * 1.6) * (depth ? 0.6 : 1));
          ctx.fillText(EDGE[(flick * EDGE.length) | 0], x + CW / 2, y + CH / 2 + 1);
        }
      }
    }

    function frame(ctx, t) {
      ready = ready || setup();
      const { bgc, sample, reef, deepBuf, mainBuf } = ready;
      t = ((t % T) + T) % T;
      ctx.drawImage(bgc, 0, 0);

      ctx.save(); ctx.globalCompositeOperation = 'screen';
      for (let k = 0; k < 4; k++) {
        const off = ((t / T + k / 4) % 1) * (W + H) * 1.2 - H * 0.6, g = ctx.createLinearGradient(off, 0, off + 260, 160);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,240,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();

      ctx.font = '500 15px ui-monospace, "SF Mono", Menlo, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        const x = i * CW, y = j * CH;
        const v = Math.sin(x * 0.011 + y * 0.004 + w * 2 * t + 1.6 * Math.sin(y * 0.007 - w * 3 * t))
                + Math.sin(-x * 0.006 + y * 0.012 - w * 3 * t + 1.6 * Math.sin(x * 0.008 + w * 2 * t))
                + Math.sin(x * 0.009 - y * 0.009 + w * 4 * t + 1.2 * Math.sin((x + y) * 0.005 + w * t));
        if (v > 1.55) { const k = Math.min(1, (v - 1.55) / 1.2); ctx.fillStyle = `rgba(255,255,255,${0.16 + 0.42 * k})`; ctx.fillText(k > 0.6 ? '~' : k > 0.3 ? '-' : '·', x + CW / 2, y + CH / 2); }
        const gl = hsh(i, j, Math.floor(t * 6) % 147);
        if (gl > 0.9988) { const f = Math.sin(((t * 6) % 1) * Math.PI); ctx.fillStyle = `rgba(255,255,255,${0.95 * f})`; ctx.fillText(gl > 0.9995 ? '*' : '+', x + CW / 2, y + CH / 2); }
      }

      cells(ctx, reef, 0.62, t);
      const deep = sample((g) => { const [x, y, a] = pose(P.whale, t); put(g, x, y, a, 1, (g) => whale(g, t)); }, deepBuf);
      cells(ctx, deep, 0.4, t);

      const main = sample((g) => {
        let [x, y, a] = pose(P.manta, t); put(g, x, y, a, 1.2, (g) => manta(g, t));
        for (const [dx, ph] of [[0, 0], [1, 1.3]]) { [x, y, a] = pose(P.dolphin, t - dx * 0.18); put(g, x + dx * 120 * Math.sin(a), y - dx * 120 * Math.cos(a), a, 1.25, (g) => dolphin(g, t, ph)); }
        [x, y, a] = pose(P.turtleA, t); put(g, x, y, a, 1.55, (g) => turtle(g, t, 0));
        [x, y, a] = pose(P.turtleB, t); put(g, x, y, a, 1.3, (g) => turtle(g, t, 2));
        [x, y, a] = pose(P.turtleC, t); put(g, x, y, a, 1.1, (g) => turtle(g, t, 4));
        [x, y, a] = pose(P.school, t);
        FISH.forEach(([fx, fy], k) => { const ca = Math.cos(a), sa = Math.sin(a), wob = 14 * Math.sin(w * 7 * t + k); put(g, x + fx * ca - (fy + wob) * sa, y + fx * sa + (fy + wob) * ca, a + 0.15 * Math.sin(w * 9 * t + k), 1.35, (g) => tang(g, t, k)); });
        for (const [kind, p0, y0, s, dir] of FLOWERS) {
          const u = (p0 + t / T) % 1, fx = -220 + u * (W + 440), fy = y0 + u * 420 + 30 * Math.sin(w * 3 * t + p0 * 9);
          put(g, fx, fy, dir * w * t + p0 * 6, 1, (g) => (kind === 'h' ? hibiscus : plumeria)(g, s));
        }
      }, mainBuf);

      ctx.fillStyle = 'rgba(4,60,84,0.16)';
      for (let j = 0; j < ROWS - 2; j++) for (let i = 0; i < COLS - 2; i++) if (main[(j * COLS + i) * 4 + 3] > 0.3) ctx.fillRect((i + 2) * CW, (j + 2) * CH, CW, CH);

      for (const [fn, len] of [[P.turtleA, 1.5], [P.turtleB, 1.3], [P.turtleC, 1.1], [P.manta, 1.6], [P.dolphin, 1.4]]) {
        for (let k = 1; k <= 16; k++) {
          const [x, y, a] = pose(fn, t - k * 0.09 - 0.35 * len), side = (hsh(k, len, 3) - 0.5) * k * 9;
          const px = x + side * -Math.sin(a), py = y + side * Math.cos(a);
          ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - k / 17)})`;
          ctx.fillText('.·o°'[(hsh(k, len, Math.floor(t * 5)) * 4) | 0], Math.floor(px / CW) * CW + CW / 2, Math.floor(py / CH) * CH + CH / 2);
        }
      }
      cells(ctx, main, 0, t);
    }

    return { id: 'honu', name: 'Đầm rùa biển', sky: ['#4ad6d6', '#0e80b6'], stage: { w: W, h: H, fps: 30 }, frame };
  })();
  SCENES.unshift(honu);

  const OFF = { id: 'off', name: 'Tắt' };
  const CHOICES = [OFF, ...SCENES];
  const byId = (id) => CHOICES.find((s) => s.id === id) || CHOICES.find((s) => s.id === DEFAULTS.scene);

  // ---------- renderer ----------
  function createRenderer(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const scale = opts.scale || 1;
    const g = { ctx, t: 0, dt: 0, cols: 0, rows: 0, w: 0, h: 0, cw: CELL_W * scale, ch: CELL_H * scale, glyph, cell, sprite };
    let scene = null, state = null, raf = 0, last = 0, running = false;
    let speed = 1, veil = 0, veilRgb = '0,0,0';
    let stageCanvas = null, stageCtx = null;

    function glyph(x, y, set) {
      const gl = set || (scene && scene.glyphs) || '#';
      return gl[(hash(x, y) + Math.floor(g.t * 1.5 + (hash(y, x) % 97) / 32)) % gl.length];
    }
    function cell(x, y, ch, color, alpha = 1) {
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha)); ctx.fillStyle = color;
      ctx.fillText(ch, Math.round(x) * g.cw, Math.round(y) * g.ch);
    }
    function sprite(spr, x, y, colors, o = {}) {
      const bx = Math.round(x), by = Math.round(y), seed = o.seed || 0;
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      let last = null;
      for (const [cx, cy, c] of spr.cells) {
        const col = colors[c]; if (!col) continue;
        let px = o.flip ? spr.w - 1 - cx : cx, py = cy;
        if (o.offset) { const d = o.offset(cx, cy); px += d[0]; py += d[1]; }
        if (col !== last) { ctx.fillStyle = col; last = col; }
        ctx.fillText(glyph(cx + seed, cy, o.glyphs), (bx + px) * g.cw, (by + py) * g.ch);
      }
      ctx.globalAlpha = 1;
    }

    function resize() {
      const dpr = opts.dpr || Math.min(global.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.w = w; g.h = h; g.cols = Math.ceil(w / g.cw); g.rows = Math.ceil(h / g.ch);
      reset(); paint();
    }
    function reset() {
      if (!scene || !g.w) return;
      if (scene.stage) {
        if (!stageCanvas) { stageCanvas = document.createElement('canvas'); stageCtx = stageCanvas.getContext('2d'); }
        stageCanvas.width = scene.stage.w; stageCanvas.height = scene.stage.h;
        state = null;
      } else {
        state = scene.init(g, rng(opts.seed || 7));
      }
    }
    function paint() {
      if (!scene || !g.w) return;
      ctx.globalAlpha = 1;
      if (scene.stage) {
        // Draw the fixed stage, then cover the viewport with it.
        scene.frame(stageCtx, g.t);
        const k = Math.max(g.w / scene.stage.w, g.h / scene.stage.h), sw = scene.stage.w * k, sh = scene.stage.h * k;
        ctx.drawImage(stageCanvas, (g.w - sw) / 2, (g.h - sh) / 2, sw, sh);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, g.h);
        scene.sky.forEach((c, i, a) => grad.addColorStop(i / (a.length - 1), c));
        ctx.fillStyle = grad; ctx.fillRect(0, 0, g.w, g.h);
        ctx.font = `${Math.round(g.ch * 0.92)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        scene.draw(g, state);
      }
      if (veil > 0) { ctx.globalAlpha = 1; ctx.fillStyle = `rgba(${veilRgb},${veil})`; ctx.fillRect(0, 0, g.w, g.h); }
      ctx.globalAlpha = 1;
    }
    function frameMs() { return 1000 / Math.min((scene && scene.stage && scene.stage.fps) || 60, opts.fps || 30); }
    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < frameMs() - 2) return;
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      g.dt = dt * speed; g.t += g.dt;
      paint();
    }
    return {
      setScene(s) { scene = s && (s.draw || s.frame) ? s : null; reset(); paint(); },
      start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); },
      stop() { running = false; cancelAnimationFrame(raf); },
      resize,
      setSpeed(v) { speed = v; },
      setVeil(a, rgb) { veil = a; if (rgb) veilRgb = rgb; if (!running) paint(); },
    };
  }

  // ---------- settings storage: chrome.storage.sync, or localStorage outside the extension ----------
  const storage = (() => {
    const c = global.chrome && global.chrome.storage;
    if (c && c.sync) {
      return {
        get: () => new Promise((r) => c.sync.get(DEFAULTS, r)),
        set: (v) => c.sync.set(v),
        onChange: (fn) => c.onChanged.addListener((ch, areaName) => {
          if (areaName !== 'sync') return;
          const v = {}; for (const k in ch) v[k] = ch[k].newValue; fn(v);
        }),
      };
    }
    const KEY = 'cw-settings', fns = [];
    const read = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
    global.addEventListener('storage', (e) => { if (e.key === KEY) fns.forEach((f) => f(read())); });
    return {
      get: async () => read(),
      set: (v) => { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...v })); } catch { /* private mode */ } fns.forEach((f) => f(v)); },
      onChange: (fn) => fns.push(fn),
    };
  })();

  // ---------- picker tiles, used by the popup and the in-page picker ----------
  function buildTiles(container, activeId, onPick) {
    const buttons = [], renderers = [];
    for (const s of CHOICES) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cw-tile'; b.dataset.id = s.id;
      const view = document.createElement(s === OFF ? 'div' : 'canvas');
      view.className = 'cw-tile-view';
      if (s === OFF) view.textContent = 'Giao diện gốc';
      const name = document.createElement('span');
      name.className = 'cw-tile-name'; name.textContent = s.name;
      b.append(view, name);
      b.addEventListener('click', () => onPick(s.id));
      container.appendChild(b); buttons.push(b);
      if (s !== OFF) {
        try {
          const r = createRenderer(view, { scale: 0.42, fps: 20, seed: 3 });
          r.setScene(s); r.resize(); r.start(); renderers.push(r);
        } catch (err) {
          console.warn('[claude-wallpaper]', s.id, err);
        }
      }
    }
    const api = {
      setActive(id) { for (const b of buttons) { const on = b.dataset.id === id; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); } },
      focus(i) { const n = buttons.length; buttons[((i % n) + n) % n].focus(); },
      index() { return buttons.indexOf(document.activeElement); },
      destroy() { renderers.forEach((r) => r.stop()); },
    };
    api.setActive(activeId);
    return api;
  }

  global.ClaudeWallpaper = { DEFAULTS, SCENES, CHOICES, byId, createRenderer, storage, buildTiles };
})(typeof window !== 'undefined' ? window : globalThis);
