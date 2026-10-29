(async () => {
  'use strict';
  const CW = window.ClaudeWallpaper;
  const s = await CW.storage.get();
  const $ = (id) => document.getElementById(id);

  const tiles = CW.buildTiles($('tiles'), CW.byId(s.scene).id, (id) => {
    CW.storage.set({ scene: id });
    tiles.setActive(id);
  });

  const glass = $('glass'), veil = $('veil'), speed = $('speed');
  const show = () => {
    $('veilOut').textContent = `${Math.round(veil.value * 100)}%`;
    $('speedOut').textContent = `×${speed.value}`;
  };
  glass.checked = s.glass;
  veil.value = s.veil;
  speed.value = s.speed;
  show();

  glass.addEventListener('change', () => CW.storage.set({ glass: glass.checked }));
  veil.addEventListener('input', () => { show(); CW.storage.set({ veil: Number(veil.value) }); });
  speed.addEventListener('input', () => { show(); CW.storage.set({ speed: Number(speed.value) }); });
})();
