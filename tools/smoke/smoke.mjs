/* KantinSim — duman testi
 *
 * Oyunu gerçek bir tarayıcıda açar ve kritik akışların çalıştığını doğrular:
 * açılış, yeni oyun, paneller, gün döngüsü, kayıt/devam ve çevrimdışı açılış.
 *
 * Kullanım (repo kökünden):
 *   cd tools/smoke && npm install && npx playwright install chromium
 *   node smoke.mjs
 *
 * Oyun kodunun parçası değildir; oyun hâlâ build'siz ve bağımlılıksızdır.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serve() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('bulunamadı'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail != null ? ' → ' + JSON.stringify(detail) : '')); }
}

const server = await serve();
const base = 'http://127.0.0.1:' + server.address().port + '/index.html';
// Yerelde sistemdeki Chrome ile hızlı çalıştırmak için: PW_CHANNEL=chrome node smoke.mjs
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  console.log('Açılış');
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  check('oyun yüklendi', await page.evaluate(() => typeof window.KS === 'object' && !!window.KS.state));
  check('ana menü görünür', await page.evaluate(() => window.KS.state.phase === 'menu'));

  console.log('Yeni oyun ve hazırlık');
  await page.evaluate(() => { window.KS.game.newGame(); window.KS.state.tutorialDone = true; });
  await page.waitForTimeout(500);
  check('hazırlık aşaması', await page.evaluate(() => window.KS.state.phase === 'prep'));

  console.log('İçerik bütünlüğü');
  const content = await page.evaluate(() => {
    const D = window.KS.DATA;
    const items = new Set([...Object.keys(D.recipes), ...Object.keys(D.products)]);
    const badEvents = Object.entries(D.events)
      .filter(([, e]) => !e.name || !e.desc || !(e.weight > 0) || Object.keys(e.prefs || {}).some(id => !items.has(id)))
      .map(([id]) => id);
    const ach = window.KS.Meta.achievements();
    const ids = ach.map(a => a.id);
    const badAch = ach.filter(a => { try { const p = a.p(); return !Array.isArray(p) || p.length !== 2 || !(p[1] > 0); } catch (e) { return true; } }).map(a => a.id);
    return { events: Object.keys(D.events).length, badEvents, ach: ids.length, unique: new Set(ids).size, badAch };
  });
  check('olay verileri tutarlı', content.badEvents.length === 0, content.badEvents);
  check('başarımlar benzersiz ve ölçülebilir',
    content.ach === content.unique && content.badAch.length === 0, content);

  console.log('Yeni olay kartı');
  const eventCard = await page.evaluate(() => {
    window.KS.state.today.event = 'saglik';
    window.KS.ui.refresh();
    const tile = document.querySelector('.prep-tile.event');
    return tile && { icon: tile.querySelector('.pt-ico').textContent.trim(), name: tile.querySelector('.pt-v').textContent.trim() };
  });
  check('olay hazırlık kartında simgesiyle görünüyor',
    !!eventCard && eventCard.name === 'Sağlıklı Beslenme Haftası' && eventCard.icon === '🥗', eventCard);

  console.log('Paneller');
  const panels = [['malzeme', 'supply'], ['telefon', 'phone'], ['menu', 'menu'], ['gelistir', 'upgrades'],
    ['personel', 'staff'], ['tarifler', 'recipes'], ['hedefler', 'kantin'], ['ayarlar', 'settings']];
  for (const [alias, id] of panels) {
    const ok = await page.evaluate(([pid, canonical]) => {
      try { window.KS.ui.open(pid); const open = window.KS.ui.isOpen(canonical); window.KS.ui.close(); return open; }
      catch (e) { return false; }
    }, [alias, id]);
    check('panel: ' + alias, ok);
  }

  console.log('Gün döngüsü');
  await page.evaluate(() => { window.KS.game.openShop(); window.KS.state.speedMult = 20; });
  const started = await page.evaluate(() => window.KS.state.phase);
  check('kantin açıldı', started === 'open');
  let phase = 'open', waited = 0;
  while (phase === 'open' && waited < 45000) {
    await page.waitForTimeout(1000); waited += 1000;
    phase = await page.evaluate(() => window.KS.state.phase);
  }
  check('gün kapandı', phase !== 'open', phase);
  await page.waitForTimeout(4000);
  const report = await page.evaluate(() => window.KS.lastReport && { day: window.KS.lastReport.day, net: window.KS.lastReport.net });
  check('gün sonu raporu', !!report);
  check('sonraki gün', await page.evaluate(() => { window.KS.game.nextDay(); return window.KS.state.phase === 'prep' && window.KS.state.day === 2; }));

  console.log('Kayıt ve devam');
  await page.evaluate(() => {
    window.KS.state.speedMult = 8;
    window.KS.game.openShop();
  });
  await page.waitForTimeout(1500);
  const savedAt = await page.evaluate(() => {
    window.KS.state.speedMult = 1;
    window.KS.earn(150, 'satis');
    window.KS.save();
    return { time: Math.round(window.KS.state.time), money: window.KS.state.money, phase: window.KS.state.phase };
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.KS.game.continueGame());
  await page.waitForTimeout(2600);
  const resumed = await page.evaluate(() => ({ time: Math.round(window.KS.state.time), money: window.KS.state.money, phase: window.KS.state.phase }));
  check('gün ortası kayıt kaldığı yerden sürüyor',
    (resumed.phase === 'open' || resumed.phase === 'closing') && resumed.money === savedAt.money && Math.abs(resumed.time - savedAt.time) <= 2,
    { savedAt, resumed });
  check('devam eden oyunda müşteri akışı var', await page.evaluate(() => window.KS.Customers.list().length > 0));

  console.log('Çevrimdışı (service worker)');
  const swReady = await page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false));
  check('service worker etkin', swReady);
  await ctx.setOffline(true);
  const offline = await ctx.newPage();
  await offline.goto(base, { waitUntil: 'domcontentloaded' });
  await offline.waitForTimeout(1800);
  check('internet yokken açılıyor', await offline.evaluate(() => typeof window.KS === 'object' && !!window.KS.state));
  await offline.close();
  await ctx.setOffline(false);

  console.log('Mobil ekranlar (844×390)');
  const mctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mpage = await mctx.newPage();
  mpage.on('pageerror', e => errors.push('mobil pageerror: ' + e.message));
  await mpage.goto(base, { waitUntil: 'load' });
  await mpage.waitForTimeout(1000);
  const menuGeo = await mpage.evaluate(() => {
    const title = document.querySelector('.mm-title').getBoundingClientRect();
    const rects = [...document.querySelectorAll('.mm-btns .ks-btn')].map(b => b.getBoundingClientRect());
    const btns = rects.map(r => Math.round(r.height));
    return {
      titleTop: title.top, titleRight: title.right, btns,
      btnMaxBottom: Math.max(...rects.map(r => r.bottom)),
      scrollW: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight,
    };
  });
  check('mobil ana menü ekrana sığıyor',
    menuGeo.scrollW <= menuGeo.vw && menuGeo.titleTop >= 0 && menuGeo.titleRight <= menuGeo.vw, menuGeo);
  check('mobil ana menü düğmeleri en az 44 px', menuGeo.btns.length >= 3 && menuGeo.btns.every(h => h >= 44), menuGeo.btns);
  check('mobil ana menünün son düğmesi ekran içinde kalıyor',
    menuGeo.btnMaxBottom <= menuGeo.vh, { btnMaxBottom: menuGeo.btnMaxBottom, vh: menuGeo.vh });

  await mpage.evaluate(() => { window.KS.game.newGame(); window.KS.state.tutorialDone = true; });
  await mpage.waitForTimeout(500);
  const prepGeo = await mpage.evaluate(() => {
    const card = document.querySelector('.prep-card').getBoundingClientRect();
    const open = document.querySelector('.prep-open').getBoundingClientRect();
    const acts = [...document.querySelectorAll('.prep-actions .ks-btn')].map(b => Math.round(b.getBoundingClientRect().height));
    return { card: [Math.round(card.y), Math.round(card.bottom)], open: [Math.round(open.y), Math.round(open.bottom), Math.round(open.height)], acts, vh: innerHeight };
  });
  check('mobil hazırlık kartı ekranda ve "Kantini Aç" görünür',
    prepGeo.card[0] >= 0 && prepGeo.card[1] <= prepGeo.vh && prepGeo.open[0] >= 0 && prepGeo.open[1] <= prepGeo.vh && prepGeo.open[2] >= 44, prepGeo);
  check('mobil hazırlık düğmeleri en az 44 px', prepGeo.acts.length >= 5 && prepGeo.acts.every(h => h >= 44), prepGeo.acts);

  await mpage.evaluate(() => {
    window.KS.state.tutorialDone = false;
    window.KS.state.today.event = 'saglik';
    window.KS.game.openShop();
  });
  await mpage.waitForTimeout(1000);
  const hudGeo = await mpage.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
    const hud = document.querySelector('#ks-hud');
    const bar = document.querySelector('#ks-dayline');
    const btns = [...document.querySelectorAll('.hud-btn')]
      .filter(b => getComputedStyle(b).display !== 'none')
      .map(b => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), t: (b.title || '').slice(0, 14) }; });
    const disp = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : 'yok'; };
    return {
      scale: window.KS.scale, hud: rect(hud), bar: bar ? rect(bar) : null, btns,
      barVisible: !!(bar && !bar.classList.contains('ks-hide')),
      labels: getComputedStyle(document.querySelector('.hud-btn .hb-label')).display,
      chips: { event: disp('.hd-event'), weather: disp('.hd-weather'), clean: disp('.hd-clean'), deliv: disp('.hd-deliv') },
      scrollW: document.documentElement.scrollWidth, vw: window.innerWidth,
    };
  });
  check('mobil HUD sahne ölçeğinden bağımsız (ekran genişliği)',
    hudGeo.scale < 0.5 && Math.abs(hudGeo.hud.w - hudGeo.vw) < 1 && Math.abs(hudGeo.hud.x) < 1, hudGeo.hud);
  check('mobil HUD düğmeleri en az 44×44 px',
    hudGeo.btns.length >= 6 && hudGeo.btns.every(b => b.w >= 44 && b.h >= 44), hudGeo.btns);
  check('mobil HUD etiketleri ikona dönüşüyor', hudGeo.labels === 'none', hudGeo.labels);
  check('mobil HUD isteğe bağlı chip\'leri gizliyor',
    Object.values(hudGeo.chips).every(d => d === 'none'), hudGeo.chips);
  check('gün şeridi HUD\'un altında, yatay taşma yok',
    hudGeo.barVisible && Math.abs(hudGeo.bar.y - hudGeo.hud.bottom) < 1 && hudGeo.scrollW <= hudGeo.vw,
    { barY: hudGeo.bar && hudGeo.bar.y, hudBottom: hudGeo.hud.bottom, scrollW: hudGeo.scrollW, vw: hudGeo.vw });

  const tutGeo = await mpage.evaluate(() => {
    const b = document.querySelector('.tut-bubble');
    const r = b.getBoundingClientRect();
    return { font: parseFloat(getComputedStyle(b.querySelector('.tut-text')).fontSize), x: r.x, y: r.y, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
  });
  check('mobil eğitim balonu okunur ve ekranda',
    tutGeo.font >= 15 && tutGeo.x >= 0 && tutGeo.right <= tutGeo.vw && tutGeo.bottom <= tutGeo.vh && tutGeo.y >= 0, tutGeo);

  console.log('Mobil paneller (844×390)');
  await mpage.evaluate(() => { window.KS.state.tutorialDone = true; window.KS.state.paused = true; });
  const panelIds = ['supply', 'phone', 'menu', 'upgrades', 'staff', 'kantin', 'recipes', 'settings', 'help'];
  const panelBad = [];
  let panelScrolled = false;
  for (const pid of panelIds) {
    await mpage.evaluate(p => window.KS.ui.open(p), pid);
    await mpage.waitForTimeout(420);
    const g = await mpage.evaluate(() => {
      const p = document.querySelector('#ks-modal .ks-panel');
      if (!p) return { err: 'panel yok' };
      const b = p.querySelector('.pn-body');
      const pr = p.getBoundingClientRect(), br = b.getBoundingClientRect();
      const x = p.querySelector('.pn-x').getBoundingClientRect();
      const over = [...b.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > br.right + 2).length;
      b.scrollTop = 120;
      const moved = b.scrollTop > 0;
      b.scrollTop = 0;
      return {
        inside: pr.x >= -1 && pr.y >= -1 && pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1,
        close: [x.width, x.height], over, head: parseFloat(getComputedStyle(p.querySelector('.pn-head h2')).fontSize),
        scrollable: b.scrollHeight > b.clientHeight + 1, moved, vw: innerWidth, vh: innerHeight,
      };
    });
    if (!g.inside || g.close[0] < 43.5 || g.close[1] < 43.5 || g.over > 0 || g.head < 20) panelBad.push({ pid, ...g });
    if (g.scrollable && g.moved) panelScrolled = true;
    await mpage.evaluate(() => window.KS.ui.close());
    await mpage.waitForTimeout(180);
  }
  check('mobil paneller ekrana sığıyor, kapatma 44 px, yatay taşma yok', panelBad.length === 0, panelBad.slice(0, 3));
  check('mobil panel gövdesi dokunmayla kayıyor', panelScrolled);
  await mctx.close();

  console.log('Küçük telefon (667×375, 568×320)');
  for (const [w, h] of [[667, 375], [568, 320]]) {
    const sctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const spage = await sctx.newPage();
    spage.on('pageerror', e => errors.push('küçük telefon pageerror: ' + e.message));
    await spage.goto(base, { waitUntil: 'load' });
    await spage.waitForTimeout(900);
    const menuFit = await spage.evaluate(() => {
      const rects = [...document.querySelectorAll('.mm-btns .ks-btn')].map(b => b.getBoundingClientRect());
      return { maxBottom: Math.max(...rects.map(r => r.bottom)), minH: Math.min(...rects.map(r => r.height)), vh: innerHeight };
    });
    check(w + '×' + h + ' ana menü düğmeleri ekranda', menuFit.maxBottom <= menuFit.vh && menuFit.minH >= 43.5, menuFit);

    await spage.evaluate(() => { window.KS.game.newGame(); window.KS.state.tutorialDone = true; window.KS.state.level = 5; window.KS.ui.close(); });
    await spage.waitForTimeout(500);
    const g = await spage.evaluate(() => {
      const shown = id => { const el = document.querySelector('.hb-' + id); if (!el) return false; const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width >= 44 && r.height >= 44; };
      const right = document.querySelector('.hd-right').getBoundingClientRect();
      return {
        scrollW: document.documentElement.scrollWidth, vw: innerWidth, right: right.right, more: shown('more'),
        hidden: [...document.querySelectorAll('.hud-group .hud-btn')]
          .filter(b => !b.classList.contains('hb-more') && !b.classList.contains('hb-sound') && getComputedStyle(b).display === 'none')
          .map(b => b.querySelector('.hb-label').textContent),
      };
    });
    check(w + '×' + h + ' HUD yatay taşmıyor', g.scrollW <= g.vw && g.right <= g.vw + 1, g);
    if (g.more) {
      const menu = await spage.evaluate(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        document.querySelector('.hb-more').click();
        await wait(120);
        const box = document.querySelector('.hud-more');
        const items = [...box.querySelectorAll('.hud-more-item')].map(b => b.textContent.trim());
        const opened = box.classList.contains('show');
        box.querySelector('.hud-more-item').click();
        await wait(250);
        return { items, opened, panel: window.KS.ui.panel, closed: !box.classList.contains('show') };
      });
      check(w + '×' + h + ' ⋯ menüsü gizlenen panelleri açıyor',
        menu.opened && g.hidden.length > 0 && menu.items.join('|') === g.hidden.join('|') && !!menu.panel && menu.closed, menu);
      await spage.evaluate(() => window.KS.ui.close());
    } else {
      check(w + '×' + h + ' ⋯ menüsü gizlenen panel yoksa görünmüyor', g.hidden.length === 0, g);
    }
    await sctx.close();
  }

  console.log('Dikey telefon (390×844)');
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const ppage = await pctx.newPage();
  await ppage.goto(base, { waitUntil: 'load' });
  await ppage.waitForTimeout(900);
  const pgeo = await ppage.evaluate(() => {
    const hs = getComputedStyle(document.querySelector('#rotate-hint'));
    return { hint: hs.display !== 'none' && hs.position === 'fixed', scrollW: document.documentElement.scrollWidth, vw: innerWidth };
  });
  await ppage.evaluate(() => { window.KS.game.newGame(); window.KS.state.tutorialDone = true; });
  await ppage.waitForTimeout(300);
  // hazırlık kartının giriş animasyonu 1 px taşabiliyor; bitmesini bekle
  await ppage.evaluate(async () => {
    const card = document.querySelector('.prep-card');
    if (card && card.getAnimations) await Promise.all(card.getAnimations().map(a => a.finished.catch(() => {})));
  });
  const pgeo2 = await ppage.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, vw: innerWidth, hud: getComputedStyle(document.querySelector('#ks-hud')).display }));
  check('dikey telefonda çevir uyarısı var, HUD taşmıyor',
    pgeo.hint && pgeo2.scrollW <= pgeo2.vw && pgeo2.hud === 'none', Object.assign({}, pgeo, pgeo2));
  const panelOver = await ppage.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const bad = [];
    for (const id of ['supply', 'menu', 'upgrades', 'recipes', 'kantin']) {
      window.KS.ui.open(id, id === 'kantin' ? 'bank' : undefined);
      await wait(260);
      const b = document.querySelector('#ks-modal .ks-panel .pn-body');
      if (!b) { bad.push(id + ':panel yok'); continue; }
      if (b.scrollWidth > b.clientWidth + 2) bad.push(id + ':' + b.scrollWidth + '/' + b.clientWidth);
      window.KS.ui.close();
      await wait(120);
    }
    return bad;
  });
  check('dikey telefonda panel satırları tek sütuna iniyor, yatay taşma yok', panelOver.length === 0, panelOver);
  await pctx.close();

  check('konsolda hata yok', errors.length === 0, errors.slice(0, 5));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + (fail ? 'BAŞARISIZ' : 'BAŞARILI') + ': ' + pass + ' geçti, ' + fail + ' kaldı');
process.exit(fail ? 1 : 0);
