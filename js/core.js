/* KantinSim — Çekirdek motor
 * Sahibi: çekirdek (lead). Diğer modüller buradaki API'yi KULLANIR, bu dosyayı DEĞİŞTİRMEZ.
 * İçerik: util, olay veriyolu, modül kaydı, oyun durumu + kayıt, ekonomi, gün/zaman akışı,
 *         teslimatlar, yerleşim (layout), bölge (zone) tabanlı sürükle-bırak, efektler, ana döngü.
 */
window.KS = window.KS || {};
(function (KS) {
  'use strict';

  const W = 1600, H = 900;
  KS.W = W; KS.H = H;

  // ---------------------------------------------------------------------------
  // UTIL
  // ---------------------------------------------------------------------------
  let _uid = 1;
  const util = {
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a = 0, b = 1) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: arr => arr[Math.floor(Math.random() * arr.length)],
    chance: p => Math.random() < p,
    // {key: weight} -> key
    weighted(map) {
      let total = 0;
      for (const k in map) total += Math.max(0, map[k]);
      let r = Math.random() * total;
      for (const k in map) { r -= Math.max(0, map[k]); if (r <= 0) return k; }
      return Object.keys(map)[0];
    },
    uid: () => _uid++,
    fmtMoney(n) {
      const s = Math.round(n).toLocaleString('tr-TR');
      return s + ' ₺';
    },
    fmtTime(min) {
      const h = Math.floor(min / 60), m = Math.floor(min % 60);
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    },
    inRect: (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h,
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    easeOutCubic: t => 1 - Math.pow(1 - t, 3),
    deepClone: o => JSON.parse(JSON.stringify(o)),
  };
  KS.util = util;

  // ---------------------------------------------------------------------------
  // OLAY VERİYOLU
  // Olaylar: 'newGame','prepStart','open','closing','dayEnd'(report),'bell'(period),
  //  'periodChange'(period),'moneyChanged','repChanged','levelUp'(level),'delivery'(order),
  //  'customerServed'(info),'customerLeft'(info),'itemTrashed'(item),'powerChange'(on),
  //  'pause'(bool),'stateLoaded','upgradeBought'(id),'staffChanged'
  // ---------------------------------------------------------------------------
  const listeners = {};
  KS.bus = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return () => KS.bus.off(ev, fn); },
    off(ev, fn) { const l = listeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(ev, data) {
      const l = listeners[ev]; if (!l) return;
      for (const fn of l.slice()) { try { fn(data); } catch (e) { console.error('[bus]', ev, e); } }
    },
  };

  // ---------------------------------------------------------------------------
  // MODÜLLER
  // KS.registerModule({ name, init(), update(dt), draw(ctx, layer), order })
  //  layer: 'back' | 'customers' | 'counter' | 'stations' | 'fx'
  // ---------------------------------------------------------------------------
  KS.modules = [];
  KS.registerModule = function (m) {
    m.order = m.order || 0;
    KS.modules.push(m);
    KS.modules.sort((a, b) => a.order - b.order);
    if (KS._booted && m.init) { try { m.init(); } catch (e) { console.error(e); } }
  };

  // Diğer modüllerin doldurduğu kancalar (varsayılanlar güvenli)
  KS.hooks = {
    activeCustomerCount: () => 0,   // customers modülü üzerine yazar
    forceCustomersLeave: () => {},  // customers modülü üzerine yazar
  };

  // ---------------------------------------------------------------------------
  // OYUN DURUMU
  // ---------------------------------------------------------------------------
  const SAVE_KEY = 'kantinsim_save_v1';

  function newState() {
    const D = KS.DATA;
    const inventory = {}, products = {}, menu = {}, prices = {}, upgrades = {};
    for (const [id, ing] of Object.entries(D.ingredients)) inventory[id] = ing.start || 0;
    for (const [id, p] of Object.entries(D.products)) { products[id] = p.start || 0; prices[id] = p.price; }
    for (const [id, r] of Object.entries(D.recipes)) menu[id] = { on: r.unlock <= 1, price: r.price };
    for (const id of Object.keys(D.upgrades)) upgrades[id] = 0;
    return {
      version: 1,
      day: 1,
      money: D.costs.startMoney,
      rep: 3.0,                 // 0..5 itibar (yıldız)
      xp: 0, level: 1,
      time: D.OPEN_MIN,         // oyun dakikası
      phase: 'menu',            // 'menu' | 'prep' | 'open' | 'closing' | 'summary' | 'gameover'
      paused: false,
      speedMult: 1,             // UI hız düğmesi (1 / 2)
      inventory, products, menu, prices, upgrades,
      staff: {},                // {cirak:true}
      deliveries: [],           // [{id, supplier, inv:{}, prod:{}, cost, at}]
      cleanliness: 100,         // 0..100
      power: true,
      today: null,              // rollToday() doldurur
      stats: { total: { revenue: 0, served: 0, lost: 0, tips: 0, days: 0 }, life: {}, sales: {} },
      achievements: {},         // {id: gün}  (meta modülü)
      loans: [],                // aktif krediler (meta modülü)
      goalsDone: 0,
      tutorialDone: false,
      settings: { sound: true, music: true },
      history: [],              // gün sonu raporları
    };
  }

  function rollToday(s) {
    const D = KS.DATA;
    const wmap = {}; for (const [k, w] of Object.entries(D.weathers)) wmap[k] = w.weight;
    const emap = {}; for (const [k, e] of Object.entries(D.events)) emap[k] = e.weight;
    let ev = s.day === 1 ? 'yok' : util.weighted(emap);
    s.today = {
      weekday: D.weekdays[(s.day - 1) % 5],
      weather: s.day === 1 ? 'gunesli' : util.weighted(wmap),
      event: ev,
      revenue: 0, tips: 0, bonus: 0, served: 0, lost: 0, angry: 0, perfect: 0,
      expenses: { malzeme: 0, hazir: 0, nakliye: 0, geliştirme: 0, personel: 0, kira: 0, fatura: 0, reklam: 0, kredi: 0, ceza: 0, diger: 0 },
      campaign: null, goals: null, meta: {},
      sales: {},              // {lineId: adet}
      repStart: s.rep, xpStart: s.xp, moneyStart: s.money,
      wasted: 0,
    };
  }

  KS.state = newState();
  KS.newState = newState;

  KS.save = function () {
    try {
      const s = KS.state;
      if (s.phase === 'menu') return;
      const copy = Object.assign({}, s);
      localStorage.setItem(SAVE_KEY, JSON.stringify(copy));
    } catch (e) { /* depolama yok */ }
  };
  KS.hasSave = function () { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } };
  KS.load = function () {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const loaded = JSON.parse(raw);
      const base = newState();
      // yeni eklenen alanlar için birleştir
      for (const k of ['inventory', 'products', 'prices', 'upgrades']) loaded[k] = Object.assign({}, base[k], loaded[k]);
      loaded.menu = Object.assign({}, base.menu, loaded.menu);
      loaded.stats = Object.assign({}, base.stats, loaded.stats || {});
      loaded.stats.total = Object.assign({}, base.stats.total, loaded.stats.total || {});
      if (loaded.today) {
        loaded.today.expenses = Object.assign({ reklam: 0, kredi: 0 }, loaded.today.expenses || {});
        if (loaded.today.bonus == null) loaded.today.bonus = 0;
        if (!loaded.today.meta) loaded.today.meta = {};
      }
      KS.state = Object.assign(base, loaded);
      KS.bus.emit('stateLoaded');
      return true;
    } catch (e) { console.warn('Kayıt yüklenemedi', e); return false; }
  };
  KS.deleteSave = function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} };

  // ---------------------------------------------------------------------------
  // EKONOMİ YARDIMCILARI
  // ---------------------------------------------------------------------------
  // Kazanç: category 'satis' | 'bahsis' | 'diger'
  KS.earn = function (amount, category = 'satis', x, y) {
    const s = KS.state;
    s.money += amount;
    if (s.today) {
      if (category === 'bahsis') { s.today.tips += amount; s.stats.total.tips += amount; }
      else { s.today.revenue += amount; s.stats.total.revenue += amount; }
    }
    if (x != null) KS.fx.floatText(x, y, '+' + util.fmtMoney(amount), category === 'bahsis' ? '#ffd23f' : '#5fe07a');
    KS.bus.emit('moneyChanged', s.money);
  };
  // Harcama: category = today.expenses anahtarı. force=true ise para yetmese de düşer (borç)
  KS.spend = function (amount, category = 'diger', force = false) {
    const s = KS.state;
    if (!force && s.money < amount) return false;
    s.money -= amount;
    if (s.today) s.today.expenses[category] = (s.today.expenses[category] || 0) + amount;
    KS.bus.emit('moneyChanged', s.money);
    return true;
  };

  // Ödül (hedef / başarım): satış dışı gelir, gün netine dahil
  KS.bonus = function (amount, x, y) {
    const s = KS.state;
    amount = Math.round(amount || 0); if (amount <= 0) return;
    s.money += amount;
    if (s.today) s.today.bonus = (s.today.bonus || 0) + amount;
    if (x != null) KS.fx.floatText(x, y, '+' + util.fmtMoney(amount), '#7fd8ff');
    KS.bus.emit('moneyChanged', s.money);
  };

  KS.inv = {
    get: id => KS.state.inventory[id] || 0,
    has: (id, n = 1) => (KS.state.inventory[id] || 0) >= n,
    add(id, n = 1) { KS.state.inventory[id] = (KS.state.inventory[id] || 0) + n; },
    take(id, n = 1) {
      if ((KS.state.inventory[id] || 0) < n) return false;
      KS.state.inventory[id] -= n; return true;
    },
  };
  KS.prod = {
    get: id => KS.state.products[id] || 0,
    has: (id, n = 1) => (KS.state.products[id] || 0) >= n,
    add(id, n = 1) { KS.state.products[id] = (KS.state.products[id] || 0) + n; },
    take(id, n = 1) {
      if ((KS.state.products[id] || 0) < n) return false;
      KS.state.products[id] -= n; return true;
    },
  };

  // Geliştirme seviyesi ve değerleri
  KS.upg = id => KS.state.upgrades[id] || 0;
  KS.upgVal = function (id, field) {
    const u = KS.DATA.upgrades[id]; if (!u) return undefined;
    const lv = u.levels[Math.min(KS.upg(id), u.levels.length - 1)];
    return lv[field];
  };
  KS.buyUpgrade = function (id) {
    const u = KS.DATA.upgrades[id]; const lv = KS.upg(id);
    if (!u || lv >= u.levels.length - 1) return false;
    const next = u.levels[lv + 1];
    if (!KS.spend(next.cost, 'geliştirme')) return false;
    KS.state.upgrades[id] = lv + 1;
    KS.bus.emit('upgradeBought', id);
    KS.audio.play('levelup');
    KS.save();
    return true;
  };
  KS.hasStaff = id => !!KS.state.staff[id];
  KS.setStaff = function (id, on) { KS.state.staff[id] = !!on; KS.bus.emit('staffChanged', id); KS.save(); };

  KS.addRep = function (d) {
    const s = KS.state;
    s.rep = util.clamp(s.rep + d, 0, 5);
    KS.bus.emit('repChanged', s.rep);
  };
  KS.addXP = function (n) {
    const s = KS.state, L = KS.DATA.levels;
    s.xp += n;
    while (s.level < L.length && s.xp >= L[s.level]) {
      s.level++;
      // yeni tarifleri menüye otomatik ekle
      for (const [id, r] of Object.entries(KS.DATA.recipes)) if (r.unlock === s.level) s.menu[id].on = true;
      KS.bus.emit('levelUp', s.level);
      KS.audio.play('levelup');
    }
  };
  KS.levelProgress = function () {
    const s = KS.state, L = KS.DATA.levels;
    const cur = L[s.level - 1] || 0, next = L[s.level] || (cur + 1);
    return { cur: s.xp - cur, need: next - cur, ratio: util.clamp((s.xp - cur) / (next - cur), 0, 1), max: s.level >= L.length };
  };
  KS.isRecipeUnlocked = id => KS.DATA.recipes[id] && KS.DATA.recipes[id].unlock <= KS.state.level;
  KS.isRecipeOnMenu = id => KS.isRecipeUnlocked(id) && KS.state.menu[id] && KS.state.menu[id].on;
  KS.isProductUnlocked = id => KS.DATA.products[id] && KS.DATA.products[id].unlock <= KS.state.level;
  // Satış fiyatı
  KS.priceOf = function (line) {
    if (!line) return 0;
    if (line.type === 'product') return KS.state.prices[line.id] || KS.DATA.products[line.id].price;
    return (KS.state.menu[line.id] && KS.state.menu[line.id].price) || KS.DATA.recipes[line.id].price;
  };
  // Fiyatın önerilene oranı (müşteri talebi için): 1 = normal
  KS.priceRatio = function (line) {
    const base = line.type === 'product' ? KS.DATA.products[line.id].price : KS.DATA.recipes[line.id].price;
    return KS.priceOf(line) / base;
  };
  KS.recordSale = function (line, qty = 1) {
    const t = KS.state.today; if (!t) return;
    const key = line.id; t.sales[key] = (t.sales[key] || 0) + qty;
  };
  KS.addDirt = function (amount) {
    const mult = KS.hasStaff('temizlikci') ? 0.5 : 1;
    KS.state.cleanliness = util.clamp(KS.state.cleanliness - amount * mult, 0, 100);
  };
  KS.clean = function (amount) { KS.state.cleanliness = util.clamp(KS.state.cleanliness + amount, 0, 100); };

  // ---------------------------------------------------------------------------
  // TESLİMATLAR
  // order: { supplier:'toptanci', inv:{kasar:20}, prod:{ayran:20}, cost: 540 }
  // ---------------------------------------------------------------------------
  KS.placeOrder = function (order) {
    const s = KS.state, sup = KS.DATA.suppliers[order.supplier];
    if (!sup) return { ok: false, msg: 'Tedarikçi yok' };
    const total = Math.round(order.cost + (sup.fee || 0));
    if (s.money < total) return { ok: false, msg: 'Yetersiz bakiye' };
    const hasHazir = Object.keys(order.prod || {}).some(id => KS.DATA.products[id].group === 'hazir');
    KS.spend(Math.round(order.cost), hasHazir && sup.kind === 'restoran' ? 'hazir' : 'malzeme');
    if (sup.fee) KS.spend(sup.fee, 'nakliye');
    const prep = s.phase === 'prep';
    const d = {
      id: util.uid(), supplier: order.supplier, inv: order.inv || {}, prod: order.prod || {}, cost: total,
      at: prep ? s.time : s.time + sup.eta, placedAt: s.time,
    };
    s.deliveries.push(d);
    if (prep) deliverNow(d);
    KS.audio.play(sup.kind === 'restoran' ? 'phone' : 'click');
    KS.save();
    return { ok: true, delivery: d, total };
  };
  function deliverNow(d) {
    const s = KS.state;
    for (const [id, n] of Object.entries(d.inv)) KS.inv.add(id, n);
    for (const [id, n] of Object.entries(d.prod)) KS.prod.add(id, n);
    s.deliveries = s.deliveries.filter(x => x !== d);
    KS.bus.emit('delivery', d);
    KS.audio.play('door');
    KS.notify((KS.DATA.suppliers[d.supplier].icon || '📦') + ' ' + KS.DATA.suppliers[d.supplier].name + ' siparişi teslim edildi!', 'good');
  }
  function processDeliveries() {
    const s = KS.state;
    for (const d of s.deliveries.slice()) if (s.time >= d.at) deliverNow(d);
  }

  // ---------------------------------------------------------------------------
  // GÜN / ZAMAN AKIŞI
  // ---------------------------------------------------------------------------
  KS.currentPeriod = function () {
    const t = KS.state.time;
    for (const p of KS.DATA.periods) if (t >= p.from && t < p.to) return p;
    return KS.DATA.periods[KS.DATA.periods.length - 1];
  };
  KS.isBreak = function () {
    const p = KS.currentPeriod(); return p && p.type !== 'ders' && p.type !== 'aksam';
  };
  KS.inputEnabled = function () {
    const s = KS.state;
    return (s.phase === 'open' || s.phase === 'closing') && !s.paused && !(KS.ui && KS.ui.modalOpen);
  };
  KS.powerOn = () => KS.state.power;
  KS.todayEvent = () => KS.DATA.events[(KS.state.today && KS.state.today.event) || 'yok'];
  KS.todayWeather = () => KS.DATA.weathers[(KS.state.today && KS.state.today.weather) || 'gunesli'];

  let lastPeriod = null, closingTimer = 0;

  KS.game = {
    newGame() {
      KS.state = newState();
      KS.state.phase = 'prep';
      rollToday(KS.state);
      KS.bus.emit('newGame');
      KS.game._enterPrep();
    },
    continueGame() {
      if (!KS.load()) return KS.game.newGame();
      const s = KS.state;
      // yarım kalan gün => hazırlık aşamasından yeniden başla
      if (s.phase !== 'summary' && s.phase !== 'gameover') {
        s.phase = 'prep'; s.time = KS.DATA.OPEN_MIN;
        if (!s.today) rollToday(s);
        KS.game._enterPrep();
      } else if (s.phase === 'summary') {
        KS.game.nextDay();
      }
    },
    _enterPrep() {
      const s = KS.state;
      s.phase = 'prep'; s.time = KS.DATA.OPEN_MIN; s.paused = false; s.power = true;
      lastPeriod = null;
      if (KS.held) KS.returnHeld();
      KS.bus.emit('prepStart', s.today);
      KS.save();
    },
    openShop() {
      const s = KS.state;
      if (s.phase !== 'prep') return;
      s.phase = 'open';
      lastPeriod = KS.currentPeriod();
      KS.bus.emit('open');
      KS.bus.emit('periodChange', lastPeriod);
      KS.audio.play('bell');
    },
    endDay() {
      const s = KS.state, D = KS.DATA;
      if (s.phase === 'summary') return;
      KS.returnHeld && KS.returnHeld();
      KS.hooks.forceCustomersLeave();
      KS.bus.emit('beforeDayEnd');
      // sabit giderler
      KS.spend(D.costs.rent, 'kira', true);
      const upgLevels = Object.values(s.upgrades).reduce((a, b) => a + b, 0);
      KS.spend(D.costs.utilityBase + upgLevels * D.costs.utilityPerUpgrade, 'fatura', true);
      for (const [id, on] of Object.entries(s.staff)) if (on) KS.spend(D.staff[id].wage, 'personel', true);
      // bozulma
      const spoiled = {};
      const pm = KS.upgVal('buzdolabi', 'perishMult');
      for (const [id, ing] of Object.entries(D.ingredients)) {
        const have = s.inventory[id] || 0;
        if (have > 0 && ing.perish > 0) {
          const lost = Math.floor(have * ing.perish * pm + (Math.random() < 0.5 ? 0 : 0));
          if (lost > 0) { s.inventory[id] -= lost; spoiled[id] = lost; }
        }
      }
      const spoiledProd = {};
      for (const [id, p] of Object.entries(D.products)) {
        if (p.group === 'hazir' && s.products[id] > 0) { spoiledProd[id] = s.products[id]; s.products[id] = 0; }
      }
      // teslim edilmemiş siparişler yarın sabah gelir
      for (const d of s.deliveries) d.at = 0;
      const t = s.today;
      const expenses = Object.values(t.expenses).reduce((a, b) => a + b, 0);
      const report = {
        day: s.day, weekday: t.weekday, weather: t.weather, event: t.event,
        revenue: t.revenue, tips: t.tips, bonus: t.bonus || 0, expenses: Object.assign({}, t.expenses), expenseTotal: expenses,
        net: t.revenue + t.tips + (t.bonus || 0) - expenses,
        served: t.served, lost: t.lost, angry: t.angry, perfect: t.perfect,
        repDelta: s.rep - t.repStart, xpDelta: s.xp - t.xpStart, rep: s.rep, level: s.level,
        money: s.money, spoiled, spoiledProd, sales: Object.assign({}, t.sales), cleanliness: s.cleanliness,
        bankrupt: s.money < D.costs.bankruptcy,
      };
      s.stats.total.served += t.served; s.stats.total.lost += t.lost; s.stats.total.days++;
      s.history.push({ day: report.day, net: report.net, revenue: report.revenue, served: report.served, rep: report.rep });
      if (s.history.length > 60) s.history.shift();
      s.phase = report.bankrupt ? 'gameover' : 'summary';
      KS.lastReport = report;
      KS.bus.emit('dayEnd', report);
      KS.save();
      return report;
    },
    nextDay() {
      const s = KS.state;
      s.day++;
      // gece temizlik
      s.cleanliness = Math.min(100, s.cleanliness + 60);
      rollToday(s);
      // bekleyen siparişler sabah gelir
      for (const d of s.deliveries.slice()) deliverNow(d);
      KS.game._enterPrep();
    },
    // Ana menüye dön: oyun sürüyorsa kaydeder, iflas/gameover ise kaydı siler
    toMenu() {
      const s = KS.state;
      if (KS.held) KS.returnHeld();
      KS.hooks.forceCustomersLeave();
      if (s.phase === 'gameover') { KS.deleteSave(); KS.state = newState(); }
      else {
        if (s.phase === 'open' || s.phase === 'closing') { s.phase = 'prep'; s.time = KS.DATA.OPEN_MIN; }
        s.paused = false;
        KS.save();
        s.phase = 'menu';
      }
      KS.bus.emit('toMenu');
    },
    togglePause(v) {
      const s = KS.state;
      if (s.phase !== 'open' && s.phase !== 'closing') return;
      s.paused = v == null ? !s.paused : !!v;
      KS.bus.emit('pause', s.paused);
    },
  };

  function updateTime(dt) {
    const s = KS.state, D = KS.DATA;
    if (s.phase !== 'open' && s.phase !== 'closing') return;
    if (s.phase === 'open') {
      const p = KS.currentPeriod();
      const secPerMin = p.speed || 0.6;
      s.time += dt / secPerMin;
      if (s.time >= D.CLOSE_MIN) {
        s.time = D.CLOSE_MIN;
        s.phase = 'closing'; closingTimer = 0;
        KS.bus.emit('closing');
        KS.audio.play('bell');
        KS.notify('Kantin kapanıyor! Sıradaki müşterileri bitir.', 'info');
      }
      const np = KS.currentPeriod();
      if (np !== lastPeriod) {
        const prevType = lastPeriod && lastPeriod.type;
        lastPeriod = np;
        KS.bus.emit('periodChange', np);
        if (prevType && (prevType === 'ders') !== (np.type === 'ders')) {
          KS.bus.emit('bell', np);
          KS.audio.play('bell');
        }
      }
      // elektrik kesintisi
      const ev = KS.todayEvent();
      if (ev.powerCut) {
        const on = !(s.time >= ev.powerCut[0] && s.time < ev.powerCut[1]);
        if (on !== s.power) {
          s.power = on;
          KS.bus.emit('powerChange', on);
          KS.notify(on ? '💡 Elektrik geldi!' : '⚡ Elektrikler kesildi! Tost makinesi ve fritöz çalışmıyor.', on ? 'good' : 'bad');
        }
      }
      processDeliveries();
    } else if (s.phase === 'closing') {
      closingTimer += dt;
      processDeliveries();
      if (KS.hooks.activeCustomerCount() === 0 || closingTimer > 40) {
        KS.game.endDay();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // YERLEŞİM — tüm modüller bu dikdörtgenleri kullanır (mantıksal 1600x900)
  // ---------------------------------------------------------------------------
  KS.layout = {
    hud:       { x: 0,    y: 0,   w: 1600, h: 56 },
    wall:      { x: 0,    y: 56,  w: 1600, h: 296 },
    vitrin:    { x: 14,   y: 66,  w: 300,  h: 338 },
    customerSlots: [500, 780, 1060, 1340].map(cx => ({ cx, baseY: 352, rect: { x: cx - 135, y: 64, w: 270, h: 300 } })),
    counter:   { x: 0,    y: 352, w: 1600, h: 70 },   // tezgah üstü 352-372, ön panel 372-422
    workspace: { x: 0,    y: 422, w: 1600, h: 478 },
    bins:      { x: 12,   y: 432, w: 340,  h: 458, cols: 4, rows: 5 },
    yogurma:   { x: 364,  y: 432, w: 220,  h: 200 },
    bekleme:   { x: 594,  y: 432, w: 212,  h: 200 },
    tezgah:    { x: 364,  y: 644, w: 442,  h: 246 },
    tost:      { x: 818,  y: 432, w: 262,  h: 200 },
    izgara:    { x: 818,  y: 644, w: 262,  h: 246 },
    fritoz:    { x: 1092, y: 432, w: 236,  h: 250 },
    temizlik:  { x: 1092, y: 694, w: 236,  h: 196 },
    semaver:   { x: 1340, y: 432, w: 248,  h: 290 },
    cop:       { x: 1340, y: 734, w: 248,  h: 156 },
  };

  // ---------------------------------------------------------------------------
  // ITEM FABRİKALARI
  // ---------------------------------------------------------------------------
  KS.items = {
    ing(id, extra) { return Object.assign({ uid: util.uid(), type: 'ing', id }, extra || {}); },
    dish(baseId, extra) { return Object.assign({ uid: util.uid(), type: 'dish', id: baseId, layers: [], toast: 0 }, extra || {}); },
    product(id) { return { uid: util.uid(), type: 'product', id }; },
    name: it => KS.Recipes.itemName(it),
    describe: it => KS.Recipes.itemDescribe(it),
  };

  // ---------------------------------------------------------------------------
  // BÖLGELER (ZONES) + GİRDİ
  // KS.addZone({
  //   id, rect | getRect(), z (büyük önce), enabled?(),
  //   onPick(pt) -> item|null      : boş elle basınca; item dönerse ele alınır (bölge kendinden çıkarır)
  //   onReturn(item)               : bırakılamazsa item kaynağına geri döner
  //   canDrop(item, pt?) -> bool   : bu item buraya bırakılabilir mi (pt yoksa genel kontrol)
  //   onDrop(item, pt) -> bool     : kabul ederse true
  //   onClick(pt)                  : sürüklemeden tıklama (onPick null döndüğünde)
  //   tooltip(pt) -> string|null   : üzerine gelince ipucu
  //   cursor: 'pointer' | 'grab'
  // })
  // ---------------------------------------------------------------------------
  const zones = [];
  KS.zones = zones;
  KS.addZone = function (z) { z.z = z.z || 0; zones.push(z); zones.sort((a, b) => b.z - a.z); return z; };
  KS.removeZone = function (id) { const i = zones.findIndex(z => z.id === id); if (i >= 0) zones.splice(i, 1); };
  function zoneRect(z) { return z.getRect ? z.getRect() : z.rect; }
  function zoneOn(z) { return !z.enabled || z.enabled(); }
  function zonesAt(pt) { return zones.filter(z => zoneOn(z) && zoneRect(z) && util.inRect(pt, zoneRect(z))); }
  KS.zonesAt = zonesAt;

  // Elde tutulan item: { item, from(zone), x, y, sx, sy, moved, sticky }
  KS.held = null;
  KS.pointer = { x: -100, y: -100, down: false, inside: false };
  let pressed = null;

  function pickAt(pt) {
    for (const z of zonesAt(pt)) {
      if (z.onPick) {
        const item = z.onPick(pt);
        if (item) {
          KS.held = { item, from: z, x: pt.x, y: pt.y, sx: pt.x, sy: pt.y, moved: false, sticky: false, t: 0 };
          KS.audio.play('pick');
          return true;
        }
      }
      if (z.onClick) { pressed = { zone: z, pt }; return true; }
      if (z.solid) return false;
    }
    return false;
  }
  function dropAt(pt) {
    const h = KS.held; if (!h) return;
    for (const z of zonesAt(pt)) {
      if (z.canDrop && z.canDrop(h.item, pt)) {
        const ok = z.onDrop(h.item, pt);
        if (ok !== false) { KS.held = null; KS.audio.play('drop'); return true; }
      }
    }
    returnHeld();
    return false;
  }
  function returnHeld() {
    const h = KS.held; if (!h) return;
    if (h.from && h.from.onReturn) h.from.onReturn(h.item);
    KS.held = null;
  }
  KS.returnHeld = returnHeld;
  KS.cancelHeld = returnHeld;

  function toLogical(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }

  function setupInput(canvas) {
    canvas.addEventListener('pointerdown', e => {
      KS.audio.unlock && KS.audio.unlock();
      const pt = toLogical(e, canvas);
      KS.pointer.x = pt.x; KS.pointer.y = pt.y; KS.pointer.down = true;
      if (!KS.inputEnabled()) return;
      if (e.button === 2) { returnHeld(); return; }
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      if (KS.held && KS.held.sticky) { dropAt(pt); return; }
      pickAt(pt);
    });
    canvas.addEventListener('pointermove', e => {
      const pt = toLogical(e, canvas);
      KS.pointer.x = pt.x; KS.pointer.y = pt.y; KS.pointer.inside = true;
      const h = KS.held;
      if (h) { h.x = pt.x; h.y = pt.y; if (!h.moved && util.dist(pt, { x: h.sx, y: h.sy }) > 10) h.moved = true; }
      if (pressed && pressed.zone.onDrag) pressed.zone.onDrag(pt);
    });
    canvas.addEventListener('pointerup', e => {
      const pt = toLogical(e, canvas);
      KS.pointer.down = false;
      if (!KS.inputEnabled()) { pressed = null; return; }
      const h = KS.held;
      if (h) {
        pressed = null;
        if (!h.moved && !h.sticky) { h.sticky = true; return; } // dokun-taşı modu
        if (!h.sticky || h.moved) dropAt(pt);
        return;
      }
      if (pressed) {
        const z = pressed.zone; pressed = null;
        if (zoneOn(z) && util.inRect(pt, zoneRect(z))) { z.onClick(pt); }
        if (z.onRelease) z.onRelease(pt);
      }
    });
    canvas.addEventListener('pointerleave', () => { KS.pointer.inside = false; });
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); returnHeld(); });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (KS.held) { returnHeld(); return; }
        if (!(KS.ui && KS.ui.handleEscape && KS.ui.handleEscape())) KS.game.togglePause();
      } else if (e.key === 'p' || e.key === 'P') KS.game.togglePause();
    });
  }

  // ---------------------------------------------------------------------------
  // EFEKTLER
  // ---------------------------------------------------------------------------
  const floats = [], parts = [];
  let shake = 0;
  KS.fx = {
    floatText(x, y, text, color = '#fff', size = 26) { floats.push({ x, y, text, color, size, t: 0, life: 1.4 }); },
    burst(x, y, color = '#ffd23f', n = 14, opts = {}) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = util.rand(80, 260) * (opts.speed || 1);
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up || 120), g: opts.gravity != null ? opts.gravity : 500,
          life: util.rand(0.5, 1.0), t: 0, color, r: util.rand(3, 7) * (opts.size || 1), shape: opts.shape || 'circle' });
      }
    },
    smoke(x, y, n = 1, color = 'rgba(200,200,200,0.5)') {
      for (let i = 0; i < n; i++) parts.push({ x: x + util.rand(-8, 8), y, vx: util.rand(-15, 15), vy: util.rand(-60, -30), g: -10,
        life: util.rand(1.0, 1.8), t: 0, color, r: util.rand(6, 12), shape: 'smoke' });
    },
    coins(x, y, n = 6) { KS.fx.burst(x, y, '#ffd23f', n, { shape: 'coin', size: 1.2 }); },
    shake(a = 6) { shake = Math.max(shake, a); },
  };
  function updateFx(dt) {
    for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.t += dt; f.y -= 45 * dt; if (f.t > f.life) floats.splice(i, 1); }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.t += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t > p.life) parts.splice(i, 1);
    }
    shake = Math.max(0, shake - dt * 30);
  }
  function drawFx(ctx) {
    for (const p of parts) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = Math.max(0, a);
      if (p.shape === 'smoke') {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + p.t), 0, Math.PI * 2); ctx.fill();
      } else if (p.shape === 'coin') {
        ctx.fillStyle = '#e8a90c'; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * Math.abs(Math.cos(p.t * 12)) + 1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 0.7, (p.r * Math.abs(Math.cos(p.t * 12)) + 1) * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * a + 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const f of floats) {
      const a = 1 - Math.max(0, (f.t - f.life * 0.6) / (f.life * 0.4));
      const s = f.t < 0.15 ? util.easeOutBack(f.t / 0.15) : 1;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(f.x, f.y); ctx.scale(s, s);
      ctx.font = '800 ' + f.size + 'px "Baloo 2", "Nunito", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // BİLDİRİM / SES yedekleri (UI ve audio modülleri üzerine yazar)
  // ---------------------------------------------------------------------------
  KS.notify = function (msg, type = 'info') {
    if (KS.ui && KS.ui.notify) return KS.ui.notify(msg, type);
    console.log('[notify:' + type + ']', msg);
  };
  KS.audio = KS.audio || { play() {}, setLoop() {}, unlock() {}, setMuted() {} };

  // ---------------------------------------------------------------------------
  // ÇİZİM: vurgular, elde tutulan item, ipucu
  // ---------------------------------------------------------------------------
  function drawHighlights(ctx, time) {
    const h = KS.held; if (!h) return;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    for (const z of zones) {
      if (!zoneOn(z) || z.noHighlight || !z.canDrop) continue;
      let ok = false;
      try { ok = z.canDrop(h.item); } catch (e) { ok = false; }
      if (!ok) continue;
      const r = zoneRect(z); if (!r) continue;
      const over = util.inRect(KS.pointer, r);
      ctx.save();
      ctx.lineWidth = over ? 5 : 3;
      ctx.strokeStyle = over ? 'rgba(120,255,140,0.95)' : 'rgba(120,255,140,' + (0.35 + pulse * 0.35) + ')';
      ctx.setLineDash(over ? [] : [10, 8]);
      ctx.lineDashOffset = -time * 30;
      roundRectPath(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 14);
      ctx.stroke();
      if (over) { ctx.fillStyle = 'rgba(120,255,140,0.10)'; ctx.fill(); }
      ctx.restore();
    }
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  KS.roundRectPath = roundRectPath;

  // Elde tutulan eşya: kaldırma animasyonu, harekete göre eğilme, yüksekliğe göre yumuşak gölge
  const heldFx = { uid: null, t0: 0, px: 0, lastT: 0, vx: 0, tilt: 0 };
  function drawHeld(ctx, time) {
    const h = KS.held; if (!h) { heldFx.uid = null; return; }
    const uid = h.item && h.item.uid;
    if (heldFx.uid !== uid) { heldFx.uid = uid; heldFx.t0 = time; heldFx.px = h.x; heldFx.vx = 0; heldFx.tilt = 0; heldFx.lastT = time; }
    const dt = Math.max(0.001, Math.min(0.1, time - heldFx.lastT));
    heldFx.lastT = time;
    const v = (h.x - heldFx.px) / dt; heldFx.px = h.x;
    heldFx.vx += (v - heldFx.vx) * Math.min(1, dt * 14);
    const targetTilt = util.clamp(heldFx.vx * 0.00045, -0.3, 0.3);
    heldFx.tilt += (targetTilt - heldFx.tilt) * Math.min(1, dt * 12);
    const k = Math.min(1, (time - heldFx.t0) * 4.5);
    const lift = util.easeOutBack(k);                 // 0 → 1 (hafif taşmalı)
    const bob = Math.sin(time * 6) * 2 * k;
    const hgt = 18 + 22 * lift;                       // sanal yükseklik
    ctx.save();
    // gölge: yükseldikçe uzaklaşır, büyür ve soluklaşır
    const sx = h.x + hgt * 0.35, sy = h.y + 30 + hgt * 0.45, rx = 34 + hgt * 0.35, ry = 9 + hgt * 0.1;
    ctx.fillStyle = '#000';
    ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.ellipse(sx, sy, rx * 1.25, ry * 1.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.16; ctx.beginPath(); ctx.ellipse(sx, sy, rx * 0.8, ry * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.translate(h.x, h.y - 6 + bob - lift * 4);
    ctx.rotate(heldFx.tilt);
    if (KS.Art && KS.Art.drawItem) KS.Art.drawItem(ctx, h.item, 0, 0, 0.95 + 0.12 * lift);
    ctx.restore();
  }
  let tipText = null;
  function drawTooltip(ctx) {
    tipText = null;
    if (!KS.pointer.inside || !KS.inputEnabled()) return;
    if (KS.held) { tipText = KS.items.describe(KS.held.item); }
    else {
      for (const z of zonesAt(KS.pointer)) { if (z.tooltip) { const t = z.tooltip(KS.pointer); if (t) { tipText = t; break; } } }
    }
    if (!tipText) return;
    const lines = String(tipText).split('\n');
    ctx.save();
    ctx.font = '600 17px "Nunito", system-ui, sans-serif';
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 24, hh = lines.length * 22 + 14;
    let x = KS.pointer.x + 22, y = KS.pointer.y + 22;
    if (x + w > W - 6) x = KS.pointer.x - w - 14;
    if (y + hh > H - 6) y = KS.pointer.y - hh - 14;
    ctx.fillStyle = 'rgba(20,16,30,0.92)'; roundRectPath(ctx, x, y, w, hh, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? '#ffe08a' : '#e8e4f0'; ctx.fillText(l, x + 12, y + 8 + i * 22); });
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // ANA DÖNGÜ
  // ---------------------------------------------------------------------------
  let canvas, ctx, dpr = 1, scale = 1, lastT = 0, elapsed = 0;
  KS.time = 0; // gerçek saniye (animasyon için)

  function resize() {
    const root = document.getElementById('game-root');
    const vw = window.innerWidth, vh = window.innerHeight;
    scale = Math.min(vw / W, vh / H);
    const offx = (vw - W * scale) / 2, offy = (vh - H * scale) / 2;
    root.style.transform = 'translate(' + offx + 'px,' + offy + 'px) scale(' + scale + ')';
    // HUD sahneyle küçülmesin: küçük ekranda ters ölçekle native boyuta döner.
    const hudInv = Math.max(1, 1 / scale), hudNative = scale < 1;
    const ds = document.documentElement.style;
    ds.setProperty('--hud-inv', String(hudInv));
    ds.setProperty('--hud-width', (hudNative ? vw : W) + 'px');
    ds.setProperty('--hud-left', (hudNative ? -offx * hudInv : 0) + 'px');
    ds.setProperty('--hud-top', (hudNative ? -offy * hudInv : 0) + 'px');
    ds.setProperty('--hud-vh', vh + 'px');
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    KS.scale = scale;
  }

  function frame(t) {
    const now = t / 1000;
    let dt = lastT ? now - lastT : 0.016;
    lastT = now;
    dt = Math.min(dt, 0.05);
    elapsed += dt; KS.time = elapsed;
    const s = KS.state;
    const running = (s.phase === 'open' || s.phase === 'closing') && !s.paused && !(KS.ui && KS.ui.modalPauses);
    const gdt = running ? dt * (s.speedMult || 1) : 0;
    KS.dt = gdt;
    try {
      updateTime(gdt);
      for (const m of KS.modules) if (m.update) m.update(gdt, dt);
      updateFx(dt);
      render();
    } catch (e) { console.error(e); }
    requestAnimationFrame(frame);
  }

  function render() {
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) ctx.translate(util.rand(-shake, shake), util.rand(-shake, shake));
    const s = KS.state, A = KS.Art;
    if (A && A.drawBackground) A.drawBackground(ctx, s.time, s.today ? s.today.weather : 'gunesli', KS.time);
    const layer = name => { for (const m of KS.modules) if (m.draw) { try { m.draw(ctx, name); } catch (e) { console.error(m.name, e); } } };
    layer('back');
    const PX = A && A.parallax;
    // müşteriler tezgahın arkasında: tezgah ön panelinin altına taşmasınlar (istasyon aralarından görünüyordu)
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 422); ctx.clip();
    if (PX) ctx.translate(PX.cx || 0, PX.cy || 0);
    layer('customers');
    ctx.restore();
    if (A && A.drawCounterFront) A.drawCounterFront(ctx, KS.time);
    layer('counter');
    if (A && A.drawWorkspace) A.drawWorkspace(ctx, KS.time);
    layer('stations');
    if (A && A.drawLighting) A.drawLighting(ctx, KS.time);
    drawHighlights(ctx, KS.time);
    layer('fx');
    drawFx(ctx);
    if (!s.power && (s.phase === 'open' || s.phase === 'closing')) {
      ctx.fillStyle = 'rgba(0,0,20,0.35)'; ctx.fillRect(0, 0, W, H);
    }
    drawHeld(ctx, KS.time);
    drawTooltip(ctx);
    ctx.restore();
  }

  KS.boot = function () {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    KS.canvas = canvas; KS.ctx = ctx;
    resize();
    window.addEventListener('resize', resize);
    setupInput(canvas);
    for (const m of KS.modules) if (m.init) { try { m.init(); } catch (e) { console.error('[init]', m.name, e); } }
    KS._booted = true;
    KS.bus.emit('boot');
    requestAnimationFrame(frame);
  };
})(window.KS);
