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

  console.log('Yeni tarifler ve ürünler');
  const newData = await page.evaluate(() => {
    const KS = window.KS, D = KS.DATA;
    const recipeIds = ['soguk_sandvic', 'sucuklu_sandvic', 'lavas_pizza'];
    const productIds = ['sut', 'kek', 'borek'];
    const badRecipes = recipeIds.filter(id => {
      const r = D.recipes[id];
      if (!r) return true;
      const bases = Object.assign({}, D.ingredients, D.dishBases, D.prepared);
      const need = [r.base].concat(r.required || []);
      return !bases[r.base] || !(r.price > 0) || !(r.unlock >= 1) || need.some(x => !bases[x]);
    });
    const badProducts = productIds.filter(id => {
      const p = D.products[id];
      if (!p) return true;
      if (!(p.buy > 0) || !(p.price > p.buy) || !(p.pack >= 1)) return true;
      const sup = D.suppliers[p.supplier];
      if (!sup) return true;
      return p.group === 'hazir' && !(sup.items || []).includes(id);
    });
    const mk = (id, base, layers, toast, want) => KS.Recipes.evaluate(
      { uid: 1, type: 'dish', id: base, layers: layers.map(L => typeof L === 'string' ? { id: L, q: 1 } : { id: L.id, q: 1, cook: L.cook }), toast },
      { type: 'recipe', id, want });
    const evals = {
      soguk_sandvic: mk('soguk_sandvic', 'yarim_ekmek', ['kasar', 'domates', 'marul'], 0, ['domates', 'marul']),
      sucuklu_sandvic: mk('sucuklu_sandvic', 'yarim_ekmek', ['sucuk', 'domates', 'tursu', 'mayonez'], 0, ['domates', 'tursu', 'mayonez']),
      lavas_pizza: mk('lavas_pizza', 'lavas', ['kasar', 'sucuk', 'domates', 'ketcap'], 1, ['domates', 'ketcap']),
    };
    return {
      badRecipes, badProducts,
      evals: Object.fromEntries(Object.entries(evals).map(([k, v]) => [k, { ok: v.ok, q: Math.round(v.quality * 100) }])),
    };
  });
  check('yeni tarifler veri olarak tutarlı', newData.badRecipes.length === 0, newData.badRecipes);
  check('yeni ürünler fiyat ve tedarikçi olarak tutarlı', newData.badProducts.length === 0, newData.badProducts);
  check('yeni tarifler doğru yapılırsa tam kalite veriyor',
    Object.values(newData.evals).every(e => e.ok && e.q >= 80), newData.evals);

  const newUI = await page.evaluate(() => {
    const KS = window.KS, s = KS.state;
    const keep = { level: s.level, xp: s.xp, products: Object.assign({}, s.products), menu: {} };
    for (const id of ['soguk_sandvic', 'sucuklu_sandvic', 'lavas_pizza']) {
      keep.menu[id] = s.menu[id];
      s.menu[id] = { on: true, price: KS.DATA.recipes[id].price };
    }
    s.level = 6; s.xp = 5300;
    for (const id of Object.keys(KS.DATA.products)) s.products[id] = Math.max(2, s.products[id] || 0);
    const alphaOf = c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 4) n++;
      return n;
    };
    KS.ui.open('menu');
    const rows = [...document.querySelectorAll('.mn-row')];
    const rowName = r => { const b = r.querySelector('.mn-name b'); return b ? b.textContent.trim() : ''; };
    const names = ['Kaşarlı Sandviç', 'Sucuklu Sandviç', 'Lavaş Pizza', 'Süt', 'Kek', 'Su Böreği'];
    const missing = names.filter(n => !rows.some(r => rowName(r) === n));
    const prodArts = rows.filter(r => r.classList.contains('prod') && names.includes(rowName(r)))
      .map(r => r.querySelector('canvas')).filter(Boolean).map(alphaOf);
    KS.ui.close();
    KS.ui.open('recipes');
    const cards = [...document.querySelectorAll('.bk-card')];
    const cardName = c => { const b = c.querySelector('.bk-head b'); return b ? b.textContent.trim() : ''; };
    const cardsOk = names.slice(0, 3).every(n => cards.some(c => cardName(c) === n));
    const arts = cards.map(c => c.querySelector('.bk-art canvas')).filter(Boolean).map(alphaOf);
    KS.ui.close();
    s.level = keep.level; s.xp = keep.xp;
    s.products = keep.products;
    for (const id of Object.keys(keep.menu)) s.menu[id] = keep.menu[id];
    return { missing, cardsOk, count: arts.length, blankArts: arts.filter(n => n < 1000).length, blankProds: prodArts.filter(n => n < 250).length, prodArts: prodArts.length };
  });
  check('yeni tarif ve ürünler menü ile tarif defterinde görünüyor',
    newUI.missing.length === 0 && newUI.cardsOk, newUI);
  check('yeni tarif ve ürün görselleri çiziliyor',
    newUI.count >= 12 && newUI.blankArts === 0 && newUI.prodArts === 3 && newUI.blankProds === 0, newUI);

  console.log('Yeni olay kartı');
  const eventCard = await page.evaluate(() => {
    window.KS.state.today.event = 'saglik';
    window.KS.ui.refresh();
    const tile = document.querySelector('.prep-tile.event');
    return tile && { icon: tile.querySelector('.pt-ico').textContent.trim(), name: tile.querySelector('.pt-v').textContent.trim() };
  });
  check('olay hazırlık kartında simgesiyle görünüyor',
    !!eventCard && eventCard.name === 'Sağlıklı Beslenme Haftası' && eventCard.icon === '🥗', eventCard);

  console.log('Günün menüsü');
  const feat = await page.evaluate(() => {
    const KS = window.KS, id = KS.featuredId(), r = KS.DATA.recipes[id];
    const strip = document.querySelector('.prep-feat');
    return {
      id, name: r && r.name, price: r && r.price, unlock: r && r.unlock, level: KS.state.level,
      bonus: KS.featuredBonus({ type: 'recipe', id }), stored: KS.state.today.featured,
      strip: strip && strip.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  check('günün menüsü açılmış, fiyatlı bir tarif ve gün içinde sabit',
    !!feat.name && feat.unlock <= feat.level && feat.price >= 50 && feat.stored === feat.id, feat);
  check('günün menüsü ek bahşişi en az 3 ₺', feat.bonus >= 3, feat.bonus);
  check('hazırlık kartı günün menüsünü gösteriyor', !!feat.strip && feat.strip.includes(feat.name), feat.strip);
  const menuChip = await page.evaluate(() => {
    const KS = window.KS;
    KS.ui.open('menu');
    const chips = [...document.querySelectorAll('.mn-feat')].map(c => c.closest('.mn-row'));
    const name = KS.DATA.recipes[KS.featuredId()].name;
    const out = { n: chips.length, rowHas: chips.length === 1 && chips[0].textContent.includes(name) };
    KS.ui.close();
    return out;
  });
  check('menü paneli günün menüsünü işaretliyor', menuChip.n === 1 && menuChip.rowHas, menuChip);

  console.log('Haftalık sözleşme & kârlı gün serisi');
  const wk = await page.evaluate(() => {
    const KS = window.KS, w = KS.Meta.week(), st = KS.Meta.streak();
    const el = document.querySelector('.prep-goals .wk-row');
    return {
      target: w.target, money: w.reward.money, xp: w.reward.xp, dayIndex: w.dayIndex, ratio: w.ratio,
      next: st.next && st.next.days, best: st.best,
      txt: el && el.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  check('haftalık sözleşme hedefi hazırlıkta görünüyor',
    wk.target >= 1000 && wk.money > 0 && wk.xp > 0 && wk.dayIndex === 1 && !!wk.txt && wk.txt.includes('Hafta 1'), wk);
  check('kârlı gün serisi bir sonraki ödülü gösteriyor', wk.next === 3 && wk.best === 0, wk);

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
  const featPay = await page.evaluate(async () => {
    const KS = window.KS, wait = ms => new Promise(r => setTimeout(r, ms));
    KS.state.speedMult = 8;
    KS.Customers.clear(); await wait(500);
    const id = KS.featuredId(), r = KS.DATA.recipes[id];
    let c = null;
    // yoğun saatte slotlar dolabiliyor: boş bir slotta müşteri yakalayana kadar dene
    for (let k = 0; k < 6 && (!c || c.slot == null); k++) {
      KS.Customers.clear();
      c = KS.Customers.spawn({ type: 'ogrenci', lines: [{ type: 'recipe', id }] });
      if (c && c.slot == null) await wait(120);
    }
    if (!c || c.slot == null) return { err: 'müşteri yok' };
    for (let i = 0; i < 80 && c.state !== 'wait' && c.state !== 'enter'; i++) await wait(100);
    const item = KS.items.dish(r.base, { layers: r.required.map(x => Object.assign(KS.items.ing(x), { q: 1, cook: 1 })), toast: 1 });
    const ok = KS.Customers.serve(c.slot, item);
    for (let i = 0; i < 40 && c.state === 'pay'; i++) await wait(100);
    await wait(400);
    const meta = KS.state.today.meta || {};
    KS.state.speedMult = 20;
    return { ok, tip: meta.featTip || 0, n: meta.featServ || 0, bonus: KS.featuredBonus({ type: 'recipe', id }) };
  });
  check('günün menüsü servisi ekstra bahşiş getiriyor',
    featPay.ok === true && featPay.n === 1 && featPay.tip === featPay.bonus && featPay.tip >= 3, featPay);
  const newServe = await page.evaluate(async () => {
    const KS = window.KS, wait = ms => new Promise(r => setTimeout(r, ms));
    const cases = [
      ['soguk_sandvic', 'yarim_ekmek', ['kasar', 'domates', 'marul'], ['domates', 'marul'], 0],
      ['sucuklu_sandvic', 'yarim_ekmek', ['sucuk', 'domates', 'tursu', 'mayonez'], ['domates', 'tursu', 'mayonez'], 0],
      ['lavas_pizza', 'lavas', ['kasar', 'sucuk', 'domates', 'ketcap'], ['domates', 'ketcap'], 1],
    ];
    const out = [];
    for (const [id, base, layers, want, toast] of cases) {
      KS.Customers.clear();
      const c = KS.Customers.spawn({ type: 'ogrenci', lines: [{ type: 'recipe', id, want }] });
      if (!c) { out.push({ id, err: 'müşteri yok' }); continue; }
      for (let i = 0; i < 20 && c.state !== 'wait' && c.state !== 'enter'; i++) await wait(100);
      const item = KS.items.dish(base, {
        layers: layers.map(x => {
          const L = KS.items.ing(x, { q: 1 });
          const ing = KS.DATA.ingredients[x];
          if (ing && ing.kind === 'cookable') { L.cook = 1; L.cookA = 1; L.cookB = 1; }
          return L;
        }),
        toast,
      });
      const served = KS.Customers.serve(c.slot, item);
      out.push({ id, served, done: !!c.lines[0].done, q: Math.round((c.lines[0].quality || 0) * 100) });
    }
    KS.Customers.clear();
    return out;
  });
  check('yeni tarifler servis edilebiliyor ve tam kalite alıyor',
    newServe.length === 3 && newServe.every(x => x.served && x.done && x.q >= 80), newServe);
  let phase = 'open', waited = 0;
  while (phase === 'open' && waited < 45000) {
    await page.waitForTimeout(1000); waited += 1000;
    phase = await page.evaluate(() => window.KS.state.phase);
  }
  check('gün kapandı', phase !== 'open', phase);
  await page.waitForTimeout(4000);
  const report = await page.evaluate(() => window.KS.lastReport && { day: window.KS.lastReport.day, net: window.KS.lastReport.net, featured: window.KS.lastReport.featured, week: window.KS.lastReport.week, streak: window.KS.lastReport.streak });
  check('gün sonu raporu', !!report);
  check('gün sonu raporu günün menüsünü taşıyor', !!report && report.featured === feat.id, report);
  check('gün sonu raporu haftalık sözleşmeyi taşıyor',
    !!report && !!report.week && report.week.target >= 1000 && typeof report.week.revenue === 'number', report && report.week);
  check('gün sonu raporu kârlı gün serisini taşıyor',
    !!report && !!report.streak && typeof report.streak.days === 'number', report && report.streak);
  check('sonraki gün', await page.evaluate(() => { window.KS.game.nextDay(); return window.KS.state.phase === 'prep' && window.KS.state.day === 2; }));
  check('günün menüsü günden güne dönüyor', await page.evaluate(id => window.KS.state.today.featured && window.KS.state.today.featured !== id, feat.id));

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

  console.log('Kârlı gün serisi ödülleri');
  const st1 = await page.evaluate(async () => {
    const KS = window.KS;
    KS.state.streak = { days: 2, best: 2, claimed: {}, lastDay: 0 };
    KS.state.phase = 'open';
    KS.state.today.bonus = 0; KS.state.today.revenue = 1000; KS.state.today.tips = 100;
    KS.Customers.clear();
    KS.game.endDay();
    const r = KS.lastReport;
    return { days: r.streak.days, milestone: r.streak.milestone, claimed: Object.keys(KS.state.streak.claimed) };
  });
  check('üçüncü kârlı günde seri ödülü bir kez ödeniyor',
    st1.days === 3 && !!st1.milestone && st1.milestone.days === 3 && st1.claimed.length === 1, st1);
  const st2 = await page.evaluate(async () => {
    const KS = window.KS;
    KS.game.nextDay(); KS.game.openShop();
    KS.state.today.bonus = 0; KS.state.today.revenue = 1000; KS.state.today.tips = 100;
    KS.Customers.clear();
    KS.game.endDay();
    const r = KS.lastReport;
    return { days: r.streak.days, milestone: r.streak.milestone, claimed: Object.keys(KS.state.streak.claimed) };
  });
  check('seri büyürken aynı eşik yeniden ödenmiyor',
    st2.days === 4 && !st2.milestone && st2.claimed.length === 1, st2);
  const st3 = await page.evaluate(async () => {
    const KS = window.KS;
    KS.game.nextDay(); KS.game.openShop();
    KS.state.today.bonus = 0; KS.state.today.revenue = 0; KS.state.today.tips = 0;
    KS.Customers.clear();
    KS.game.endDay();
    const r = KS.lastReport;
    return { days: r.streak.days, lost: r.streak.lost, profitable: r.streak.profitable };
  });
  check('zararlı gün kârlı gün serisini sıfırlıyor',
    st3.days === 0 && st3.lost === 4 && st3.profitable === false, st3);
  const wfail = await page.evaluate(() => {
    const KS = window.KS;
    KS.game.newGame(); KS.state.tutorialDone = true;
    KS.state.day = 5; KS.state.week = null;
    KS.game.openShop();
    KS.state.today.bonus = 0; KS.state.today.revenue = 0; KS.state.today.tips = 0;
    KS.Customers.clear();
    KS.game.endDay();
    const r = KS.lastReport;
    return { day: r.day, week: r.week };
  });
  check('son gün hedef tutmazsa haftalık sözleşme yanıyor',
    wfail.day === 5 && !!wfail.week && wfail.week.failed === true, wfail);

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
    const screen = document.querySelector('#ks-mainmenu');
    const title = document.querySelector('.mm-title').getBoundingClientRect();
    const btns = [...document.querySelectorAll('.mm-btns .ks-btn')].map(b => Math.round(b.getBoundingClientRect().height));
    return { titleTop: title.top, titleRight: title.right, btns, scrollW: document.documentElement.scrollWidth, vw: innerWidth };
  });
  check('mobil ana menü ekrana sığıyor',
    menuGeo.scrollW <= menuGeo.vw && menuGeo.titleTop >= 0 && menuGeo.titleRight <= menuGeo.vw, menuGeo);
  check('mobil ana menü düğmeleri en az 44 px', menuGeo.btns.length >= 3 && menuGeo.btns.every(h => h >= 44), menuGeo.btns);

  await mpage.evaluate(() => { window.KS.game.newGame(); window.KS.state.tutorialDone = true; });
  await mpage.waitForTimeout(500);
  // giriş animasyonu bitmeden ölçmek yanlış (küçük) kutu veriyor
  await mpage.evaluate(async () => {
    const card = document.querySelector('.prep-card');
    if (card && card.getAnimations) await Promise.all(card.getAnimations().map(a => a.finished.catch(() => {})));
  });
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
    const btns = [...document.querySelectorAll('.hud-btn')].map(b => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), t: (b.title || '').slice(0, 14) }; });
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
    await mpage.waitForTimeout(650);
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

  check('konsolda hata yok', errors.length === 0, errors.slice(0, 5));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + (fail ? 'BAŞARISIZ' : 'BAŞARILI') + ': ' + pass + ' geçti, ' + fail + ' kaldı');
process.exit(fail ? 1 : 0);
