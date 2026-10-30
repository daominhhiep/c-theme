/* Puts the animated wallpaper behind claude.ai, turns the page's opaque surfaces into
   frosted glass, and opens the scene picker on Alt+Shift+T. */
(() => {
  'use strict';
  if (window.__cwLoaded) return;
  window.__cwLoaded = true;

  const CW = window.ClaudeWallpaper;
  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let settings = { ...CW.DEFAULTS };
  let canvas = null, renderer = null, sceneId = null, pageBg = null;
  // Square blocks first seen filled with the page colour; their fill is ours once tagged,
  // so the fact is kept here and the size test re-runs on every scan.
  const pageFill = new WeakSet();

  // ---------- wallpaper ----------
  function mount() {
    canvas = document.createElement('canvas');
    canvas.id = 'cw-wallpaper';
    canvas.setAttribute('aria-hidden', 'true');
    root.appendChild(canvas);
    // Cells are chunky, so a 1× backing store looks the same and costs a quarter of
    // the pixels on a retina screen.
    renderer = CW.createRenderer(canvas, { fps: reducedMotion ? 4 : 30, dpr: 1 });
    renderer.resize();
    sceneId = null;
  }
  function teardown() {
    if (renderer) renderer.stop();
    if (canvas) canvas.remove();
    canvas = renderer = null; sceneId = null;
  }

  function apply() {
    const scene = CW.byId(settings.scene);
    const on = scene.id !== 'off';
    root.classList.toggle('cw-on', on);
    root.classList.toggle('cw-glass-on', on && settings.glass);
    if (!on) { teardown(); return; }
    if (!canvas || !canvas.isConnected) { teardown(); mount(); }
    root.style.setProperty('--cw-fallback', scene.sky[scene.sky.length - 1]);
    renderer.setSpeed(settings.speed);
    updateTone();
    if (sceneId !== scene.id) { renderer.setScene(scene); sceneId = scene.id; }
    if (!document.hidden) renderer.start();
    if (settings.glass) queue(document.body);
  }

  // Glass follows claude.ai's own light/dark theme, read from the body text colour.
  function updateTone() {
    const m = getComputedStyle(document.body).color.match(/\d+(\.\d+)?/g) || [0, 0, 0];
    const lum = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
    const tone = lum > 0.5 ? 'dark' : 'light';
    if (root.dataset.cwTone !== tone) root.dataset.cwTone = tone;
    if (renderer) renderer.setVeil(settings.veil, tone === 'dark' ? '12,12,16' : '250,250,252');
    // Text laid straight on the wallpaper follows the scene, not the page: dark text over
    // a bright sky, light text over a dark one, judged from the sky seen through the veil.
    // The ink is the sky's own hue, deepened or paled, so it sits in the scene's palette.
    const sky = CW.byId(settings.scene).sky;
    if (sky) {
      const rgb = [0, 0, 0];
      for (const hex of sky) {
        const n = parseInt(hex.slice(1), 16);
        rgb[0] += (n >> 16) / sky.length; rgb[1] += ((n >> 8) & 255) / sky.length; rgb[2] += (n & 255) / sky.length;
      }
      const lit = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      const seen = lit * (1 - settings.veil) + (tone === 'dark' ? 0.05 : 0.98) * settings.veil;
      const text = seen > 0.5 ? 'dark' : 'light';
      const mix = (k, to) => `rgb(${rgb.map((c) => Math.round(c * k + to * (1 - k))).join(',')})`;
      if (root.dataset.cwText !== text) root.dataset.cwText = text;
      root.style.setProperty('--cw-ink', text === 'dark' ? mix(0.16, 0) : mix(0.08, 255));
      root.style.setProperty('--cw-halo', text === 'dark' ? mix(0.15, 255) : mix(0.15, 0));
    }
    // The page colour, read from an untagged probe since body's own fill is overridden.
    const probe = document.createElement('div');
    probe.className = 'bg-surface-1';
    document.body.appendChild(probe);
    pageBg = hasPaint(getComputedStyle(probe).backgroundColor) ? getComputedStyle(probe).backgroundColor : null;
    probe.remove();
  }

  // ---------- frosted glass ----------
  // claude.ai's markup changes often, so surfaces are found by how they look rather than
  // by class names: page-sized backgrounds become clear, tall narrow ones (the sidebar)
  // and cards (composer, bubbles) become glass. The choice is kept in data-cw, which
  // React leaves alone, and styled from content.css.
  const TAGS = 'div,span,nav,aside,main,header,footer,section,form,fieldset,article';
  const SKIP = '#cw-picker,[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],[data-radix-popper-content-wrapper]';

  function hasPaint(c) {
    if (!c || c === 'transparent') return false;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length < 4 || parseFloat(p[3]) > 0.05; }
    const a = c.match(/\/\s*([\d.]+)(%?)\s*\)$/);
    return a ? parseFloat(a[1]) / (a[2] ? 100 : 1) > 0.05 : true;
  }

  // A column of text with no background of its own (the conversation, a project's
  // overview) sits straight on the wallpaper; its text is set heavier with a dark halo.
  // Side-by-side columns close enough for their padding to overlap get one backing, but
  // only when none already sits on a surface of its own; otherwise each stands alone.
  function sideBySide(el) {
    if (el.children.length < 2) return null;
    const cols = [...el.children].map((c) => [c, c.getBoundingClientRect()]).filter(([, b]) => b.width >= 320)
      .sort((x, y) => x[1].left - y[1].left);
    let paired = false, near = false;
    cols.forEach(([, b], i) => {
      if (!i || b.left < cols[i - 1][1].right - 1 || Math.abs(b.top - cols[i - 1][1].top) >= 80) return;
      paired = true;
      if (b.left - cols[i - 1][1].right < 48) near = true;
    });
    return paired ? { cols: cols.map(([c]) => c), near } : null;
  }
  function boxed(col) {
    const cr = col.getBoundingClientRect();
    for (const d of [col, ...col.querySelectorAll(TAGS)]) {
      const b = d.getBoundingClientRect();
      if (b.width >= cr.width * 0.8 && b.height >= Math.min(cr.height * 0.5, 200) &&
        (d.hasAttribute('data-cw') || hasPaint(getComputedStyle(d).backgroundColor) || d.classList.contains('rounded-card'))) return true;
    }
    return false;
  }
  function isColumn(el, r, vw, vh) {
    if (r.width < 320 || r.height < vh * 0.3 || el.textContent.length < 200 ||
      (el.parentElement && el.parentElement.closest('[data-cw="read"],[data-cw="panel"],[data-cw="glass"],[data-cw="card"]'))) return false;
    const row = sideBySide(el);
    if (row) return row.near && r.width <= vw * 0.8 && !row.cols.some(boxed);
    // A transcript of many short turns only qualifies as a whole, so wide screens allow wider.
    return r.width <= Math.max(1000, vw * 0.6);
  }

  function classify(el, vw, vh) {
    const known = el.getAttribute('data-cw');
    // Once tagged, the computed background is our own (clear makes it transparent, read
    // fills it), so the tag decides; re-reading it would flip the element every scan.
    // claude.ai's own cards paint a near-invisible fill from ::after, which only works
    // over its plain background, so they count as painted.
    const painted = known ? known !== 'read'
      : hasPaint(getComputedStyle(el).backgroundColor) || el.classList.contains('rounded-card');
    if (el.closest(SKIP)) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return known;
    if (!painted) return isColumn(el, r, vw, vh) ? 'read' : null;
    if (r.width * r.height >= vw * vh * 0.45 || (r.height >= vh * 0.8 && r.width >= vw * 0.45)) return 'clear';
    const inside = el.parentElement && el.parentElement.closest('[data-cw="panel"],[data-cw="glass"],[data-cw="card"]');
    if (r.height >= vh * 0.6 && r.width <= 480) return inside ? 'clear' : 'panel';
    // Square blocks filled with the page colour are masks (e.g. behind the composer, so
    // messages scroll out of sight under it), not surfaces; glassing them shows a box.
    // Full-width bars (sticky headers) still read well as glass, so they stay.
    if (!known && pageBg) {
      const cs = getComputedStyle(el);
      if (cs.backgroundColor === pageBg && cs.borderRadius === '0px') pageFill.add(el);
    }
    if (pageFill.has(el) && r.width < vw * 0.75) return 'clear';
    // The message box is glass wherever it sits, so text scrolling under it blurs away.
    if (r.width >= 320 && r.height < 240 && el.querySelector('[contenteditable="true"],textarea')) return 'glass';
    if (inside && r.width >= 160 && r.height >= 32) return 'tint';
    // Every blurred surface is re-blurred on each wallpaper frame, so only the big
    // ones (composer, wide bars) blur; smaller cards get a plain translucent fill.
    if (r.width >= 400 && r.height >= 60) return 'glass';
    if (r.width >= 160 && r.height >= 32) return 'card';
    return null;
  }

  function scan(node) {
    if (!node || node.nodeType !== 1 || !node.isConnected) return;
    const vw = innerWidth, vh = innerHeight;
    const list = node.matches(TAGS) ? [node, ...node.querySelectorAll(TAGS)] : node.querySelectorAll(TAGS);
    for (const el of list) {
      const k = classify(el, vw, vh);
      if (k) { if (el.getAttribute('data-cw') !== k) el.setAttribute('data-cw', k); }
      else if (el.hasAttribute('data-cw')) el.removeAttribute('data-cw');
    }
  }

  const pending = new Set();
  let timer = 0;
  function queue(n) {
    pending.add(n);
    if (!timer) timer = setTimeout(flush, 250);
  }
  function flush() {
    timer = 0;
    if (!root.classList.contains('cw-glass-on')) { pending.clear(); return; }
    // Drop nodes whose ancestor is queued too; scanning the ancestor covers them.
    for (const n of pending) {
      let p = n.parentElement, covered = false;
      while (p && !covered) { covered = pending.has(p); p = p.parentElement; }
      if (!covered) scan(n);
    }
    pending.clear();
  }

  new MutationObserver((recs) => {
    if (!root.classList.contains('cw-glass-on')) return;
    for (const r of recs) {
      if (r.type === 'childList') { for (const n of r.addedNodes) if (n.nodeType === 1 && n !== canvas) queue(n); }
      else if (r.target !== root) queue(r.target);
    }
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (renderer) renderer.resize(); queue(document.body); }, 150);
  });
  setInterval(() => {
    if (document.hidden || !root.classList.contains('cw-on')) return;
    if (canvas && !canvas.isConnected) apply();
    updateTone();
    queue(document.body);
  }, 4000);
  document.addEventListener('visibilitychange', () => {
    if (!renderer) return;
    if (document.hidden) renderer.stop(); else renderer.start();
  });

  // ---------- in-page picker (Alt+Shift+T) ----------
  let picker = null, tiles = null, returnFocus = null;

  function choose(id) {
    settings.scene = id;
    CW.storage.set({ scene: id });
    apply();
    if (tiles) tiles.setActive(id);
  }
  function openPicker() {
    returnFocus = document.activeElement;
    picker = document.createElement('div');
    picker.id = 'cw-picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Chọn hình nền');
    const head = document.createElement('div');
    head.className = 'cw-picker-head';
    const title = document.createElement('strong');
    title.textContent = 'Hình nền chuyển động';
    const hint = document.createElement('span');
    hint.textContent = '← → để chọn · Enter để dùng · Esc để đóng';
    head.append(title, hint);
    const row = document.createElement('div');
    row.className = 'cw-tiles cw-tiles-row';
    picker.append(head, row);
    document.body.appendChild(picker);
    tiles = CW.buildTiles(row, CW.byId(settings.scene).id, choose);
    tiles.focus(Math.max(0, CW.CHOICES.findIndex((s) => s.id === CW.byId(settings.scene).id)));
    picker.addEventListener('keydown', onPickerKey);
  }
  function closePicker() {
    if (!picker) return;
    if (tiles) tiles.destroy();
    picker.remove();
    picker = tiles = null;
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }
  function onPickerKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      tiles.focus(Math.max(0, tiles.index()) + (e.key === 'ArrowRight' ? 1 : -1));
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyT') {
      e.preventDefault(); e.stopPropagation();
      if (picker) closePicker(); else openPicker();
    }
  }, true);
  document.addEventListener('mousedown', (e) => { if (picker && !picker.contains(e.target)) closePicker(); }, true);

  // ---------- settings ----------
  CW.storage.onChange((v) => {
    let changed = false;
    for (const k in v) if (k in CW.DEFAULTS && settings[k] !== v[k]) { settings[k] = v[k]; changed = true; }
    if (changed) { apply(); if (tiles) tiles.setActive(CW.byId(settings.scene).id); }
  });
  CW.storage.get().then((v) => { settings = { ...CW.DEFAULTS, ...v }; apply(); });
})();
