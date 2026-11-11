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

  check('konsolda hata yok', errors.length === 0, errors.slice(0, 5));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + (fail ? 'BAŞARISIZ' : 'BAŞARILI') + ': ' + pass + ' geçti, ' + fail + ' kaldı');
process.exit(fail ? 1 : 0);
