/* KantinSim — web sürümündeki prosedürel çizimleri PNG'ye, oyun verilerini JSON'a aktarır (Godot'ya geçiş için).
 * Kullanım (repo kökünde):
 *   npm i -D playwright && npx playwright install chromium   (bir kere)
 *   node tools/export_assets.js            → godot/assets/** ve godot/data/game_data.json
 *   node tools/export_assets.js --scale 3  → daha yüksek çözünürlük
 * Kendi küçük HTTP sunucusunu açar; ek bir şey gerekmez.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'godot');
const argScale = process.argv.indexOf('--scale');
const SCALE = argScale > 0 ? Number(process.argv[argScale + 1]) || 2 : 2;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, u === '/' ? 'index.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

function save(rel, dataUrl) {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: SCALE });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.KS && KS.Art && KS.DATA && KS._booted);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(500);

  // ---- 1) Sprite'lar (şeffaf PNG) -------------------------------------------------
  const sprites = await page.evaluate((S) => {
    const A = KS.Art, D = KS.DATA, out = [];
    const cv = (w, h) => { const c = document.createElement('canvas'); c.width = Math.ceil(w * S); c.height = Math.ceil(h * S); const g = c.getContext('2d'); g.scale(S, S); return [c, g]; };
    const shot = (rel, w, h, fn) => { const [c, g] = cv(w, h); try { fn(g); out.push([rel, c.toDataURL('image/png')]); } catch (e) { out.push([rel + '.ERROR', String(e)]); } };
    const BOX = 128;
    // malzemeler (+ pişme aşamaları)
    const ingIds = Object.keys(D.ingredients).concat(Object.keys(D.prepared));
    for (const id of ingIds) shot(`ingredients/${id}.png`, BOX, BOX, g => A.drawIngredient(g, id, BOX / 2, BOX / 2, 112, {}));
    for (const [tag, c] of [['raw', 0], ['cooked', 1], ['burnt', 1.8]]) {
      shot(`ingredients/kofte_${tag}.png`, BOX, BOX, g => A.drawIngredient(g, 'kofte', BOX / 2, BOX / 2, 112, { cookA: c, cookB: c }));
      shot(`ingredients/patates_${tag}.png`, BOX, BOX, g => A.drawIngredient(g, 'patates', BOX / 2, BOX / 2, 112, { cook: c }));
    }
    // hazır ürünler
    for (const id of Object.keys(D.products)) shot(`products/${id}.png`, BOX, BOX, g => A.drawProduct(g, id, BOX / 2, BOX / 2, 112));
    // tarif başına bitmiş yemek (varsayılan garnitürlerle) — tabak hariç ve tabakla
    const ing = (id, extra) => KS.items.ing(id, extra);
    const L = it => KS.Recipes.layerFromIng(it);
    for (const [rid, r] of Object.entries(D.recipes)) {
      let item;
      if (r.base === 'bardak') item = KS.items.dish('bardak', { layers: [{ id: 'cay', q: 1 }] });
      else if (r.base === 'kese') item = KS.items.dish('kese', { layers: [{ id: 'patates', q: 1, cook: 1 }].concat(r.defaults.map(id => ({ id, q: 1 }))) });
      else {
        const parts = r.required.concat(r.defaults);
        item = KS.items.dish(r.base, { layers: [L(ing(r.base))].concat(parts.map(id => L(id === 'kofte' ? ing('kofte', { cookA: 1, cookB: 1 }) : ing(id)))), toast: r.toast ? 1 : 0 });
      }
      shot(`dishes/${rid}.png`, 160, 160, g => A.drawItem(g, item, 80, 80, 1.3));
    }
    // boş tabak tabanları + bez
    shot('dishes/bos_kese.png', 160, 160, g => A.drawItem(g, KS.items.dish('kese'), 80, 80, 1.3));
    shot('dishes/bos_bardak.png', 160, 160, g => A.drawItem(g, KS.items.dish('bardak'), 80, 80, 1.3));
    shot('tools/bez.png', 160, 160, g => A.drawItem(g, { uid: 1, type: 'tool', id: 'bez' }, 80, 80, 1.3));
    // ikonlar
    for (const n of ['coin', 'star', 'clock', 'check', 'cross', 'fire', 'snow', 'heart', 'angry', 'bolt', 'trash', 'drop', 'sparkle'])
      shot(`icons/${n}.png`, 64, 64, g => A.drawIcon(g, n, 32, 32, 52));
    // müşteriler: her tip için 4 görünüm × 3 durum
    for (const type of Object.keys(D.customerTypes)) {
      for (let v = 0; v < 4; v++) {
        const look = A.randomLook(type);
        for (const [st, mood] of [['idle', 0.8], ['happy', 1], ['angry', 0.05]]) {
          const c = { look, mood, anim: { state: st, t: 0.3 } };
          shot(`customers/${type}_${v}_${st}.png`, 300, 340, g => A.drawCustomer(g, c, 150, 330, 0.3));
        }
      }
    }
    return out;
  }, SCALE);
  for (const [rel, data] of sprites) { if (rel.endsWith('.ERROR')) errors.push(rel + ': ' + data); else save('assets/' + rel, data); }

  // ---- 2) Arka plan katmanları (parallax için ayrı ayrı, 1600x900 tuvalde konumlu) ----
  const layers = await page.evaluate((S) => {
    const A = KS.Art, H = A._h, out = [];
    const full = (rel, fn, region) => {
      const R = region || { x: 0, y: 0, w: 1600, h: 900 };
      const c = document.createElement('canvas'); c.width = R.w * S; c.height = R.h * S;
      const g = c.getContext('2d'); g.scale(S, S); g.translate(-R.x, -R.y);
      try { fn(g); out.push([rel, c.toDataURL('image/png'), R]); } catch (e) { out.push([rel + '.ERROR', String(e), R]); }
    };
    for (const [tag, min] of [['sabah', 500], ['ogle', 720], ['aksam', 990]])
      full(`background/sky_${tag}.png`, g => H.paintSky(g, H.skyAt(min, 'gunesli')), { x: 500, y: 90, w: 820, h: 130 });
    full('background/corridor.png', g => H.paintCorridor(g), { x: 0, y: 56, w: 1600, h: 296 });
    full('background/frame.png', g => H.paintFrame(g), { x: 0, y: 54, w: 1600, h: 298 });
    full('background/counter.png', g => H.paintCounter(g), { x: 0, y: 324, w: 1600, h: 124 });
    full('background/worktop.png', g => H.paintWorktop(g), { x: 0, y: 422, w: 1600, h: 478 });
    full('background/station_shadows.png', g => H.paintStationShadows(g), { x: 0, y: 422, w: 1600, h: 478 });
    return out;
  }, SCALE);
  const layerMeta = {};
  for (const [rel, data, R] of layers) { if (rel.endsWith('.ERROR')) errors.push(rel + ': ' + data); else { save('assets/' + rel, data); layerMeta[path.basename(rel, '.png')] = R; } }

  // ---- 3) Referans ekran görüntüleri (istasyonlar boş halde, sahne genel görünüm) ----
  await page.evaluate(() => { KS.game.newGame(); KS.state.tutorialDone = true; });
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelectorAll('[class*=tut]').forEach(e => e.remove()); });
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1500);
  const refDir = path.join(OUT, 'assets', 'reference');
  fs.mkdirSync(refDir, { recursive: true });
  await page.screenshot({ path: path.join(refDir, 'scene_prep.png') });
  const L = await page.evaluate(() => KS.layout);
  for (const k of ['bins', 'yogurma', 'bekleme', 'tezgah', 'tost', 'izgara', 'fritoz', 'temizlik', 'semaver', 'cop', 'vitrin']) {
    const r = L[k]; if (!r) continue;
    await page.screenshot({ path: path.join(refDir, `station_${k}.png`), clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  }

  // ---- 4) Veriler ----
  const data = await page.evaluate(() => JSON.parse(JSON.stringify({
    ...KS.DATA,
    layout: KS.layout,
  })));
  data._meta = {
    source: 'KantinSim web sürümü (js/data.js + core.js KS.layout)',
    note: 'Koordinatlar 1600x900 mantıksal uzaydadır. Arka plan katmanlarının konumu background_layers içinde.',
    sprite_scale: SCALE,
    background_layers: layerMeta,
  };
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'data', 'game_data.json'), JSON.stringify(data, null, 2));

  await browser.close();
  srv.close();
  console.log(`Bitti: ${sprites.length} sprite, ${layers.length} arka plan katmanı → ${path.relative(ROOT, OUT)}/`);
  if (errors.length) { console.log('Hatalar:\n' + errors.join('\n')); process.exitCode = 1; }
})();
