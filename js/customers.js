/* KantinSim — Müşteriler modülü
 * Sahibi: Müşteriler geliştiricisi.
 * İçerik: müşteri üretimi (Poisson + zil akınları), sıra kuyruğu, tip/isim/görünüş, sipariş üretimi,
 *         sabır, servis (bırakma bölgeleri), ödeme + bahşiş + itibar + XP, müfettiş denetimi, müdür (VIP),
 *         giriş/çıkış yürüme animasyonları, sipariş balonları ve kuyruk siluetleri.
 *
 * Dışa açılan API: KS.Customers = {
 *   list()            -> tüm müşteriler (slot + kuyruk + çıkmakta olanlar)
 *   queueLength()     -> kuyrukta bekleyen sayısı
 *   active()          -> slot + kuyruk (çıkanlar hariç)
 *   slotCustomer(i)   -> i. slottaki müşteri | null
 *   serve(i, item)    -> i. slottaki müşteriye item ver (bölge onDrop ile aynı) -> bool
 *   canServe(i, item) -> bool
 *   spawn(opts)       -> yeni müşteri üret (opts: {type, rush, lines:[...]}) (test/eğitim için)
 *   spawnInspector()  -> müfettişi hemen getir
 *   clear()           -> listeyi temizle
 *   stats()           -> {spawned, served, angry, lostQueue, overflow, mudur}
 *   demandPerMin()    -> şu anki beklenen müşteri/dk (UI bilgi amaçlı)
 * }
 */
(function (KS) {
  'use strict';

  // ---------------------------------------------------------------------------
  // SABİTLER / DENGE
  // ---------------------------------------------------------------------------
  const SLOT_N = 4;
  const QUEUE_MAX = 8;
  const DEMAND_SCALE = 0.5;        // period.rate'e uygulanan genel ölçek (akınlar ayrıca eklenir)
  const WALK_SPEED = 340;          // px / oyun saniyesi
  const BODY_OFFSET = 95;          // drawCustomer baseY = tezgah çizgisi + bu (bel altı tezgah arkasında)
  const QUEUE_SCALE = 0.56;        // kuyruktaki siluetlerin ölçeği
  const QUEUE_BASE = 334;          // kuyruktakilerin "ayak" çizgisi (koridor, daha uzakta)
  const QUEUE_X0 = 1556, QUEUE_DX = 54;
  const QUEUE_DRAIN = 0.45;        // kuyrukta sabır bu oranda düşer
  const QUEUE_GIVEUP = 0.3;        // kuyrukta sabır oranı bunun altına inerse vazgeçer
  const BUBBLE_W = 252;
  const LINE_H = 34;
  const FONT = '"Nunito", "Baloo 2", system-ui, sans-serif';

  const SHORT_NAMES = {
    su: 'Su', et_doner: 'Et Döner', tavuk_doner: 'Tavuk Döner', hazir_cigkofte: 'Hazır Çiğ Köfte',
    patates: 'Patates', cigkofte_durum: 'Çiğ Köfte Dürüm', meyve_suyu: 'Meyve Suyu', kiymali_pide: 'Kıymalı Pide',
  };

  // Ürün/tarif sınıfları (kombinasyon mantığı için)
  const CATEGORY = {
    // tarifler
    kasarli_tost: 'main', karisik_tost: 'main', kofte_ekmek: 'main', hamburger: 'main', cigkofte_durum: 'main',
    patates: 'side', cay: 'hot',
    // ürünler
    ayran: 'drink', su: 'drink', kola: 'drink', meyve_suyu: 'drink',
    cips: 'snack', cikolata: 'snack', simit: 'bakery', pogaca: 'bakery',
    et_doner: 'main', tavuk_doner: 'main', hazir_cigkofte: 'main', lahmacun: 'main', kiymali_pide: 'main',
  };

  const BASE_POP = {
    kasarli_tost: 1.6, karisik_tost: 1.4, cay: 1.0, kofte_ekmek: 1.5, patates: 1.2, cigkofte_durum: 1.2, hamburger: 1.4,
    ayran: 1.2, su: 1.0, kola: 1.3, meyve_suyu: 0.9, cips: 1.0, cikolata: 0.9, simit: 1.0, pogaca: 1.0,
    et_doner: 1.3, tavuk_doner: 1.3, hazir_cigkofte: 1.0, lahmacun: 1.1, kiymali_pide: 0.9,
  };

  const PERIOD_PREFS = {
    sabah: { simit: 3, pogaca: 3, cay: 2.5, kasarli_tost: 2.2, karisik_tost: 1.5, meyve_suyu: 1.4, ayran: 0.8,
      kola: 0.5, cips: 0.4, cikolata: 0.6, kofte_ekmek: 0.35, hamburger: 0.3, et_doner: 0.3, tavuk_doner: 0.3,
      lahmacun: 0.5, kiymali_pide: 0.6, patates: 0.3, cigkofte_durum: 0.4, hazir_cigkofte: 0.4 },
    ders: { cay: 2.8, simit: 1.5, pogaca: 1.3, kasarli_tost: 1.2, su: 1.1, cips: 0.6, kola: 0.6 },
    teneffus: { kasarli_tost: 2.0, karisik_tost: 1.6, cips: 2.2, cikolata: 2.2, kola: 2.0, su: 1.8, meyve_suyu: 1.5,
      simit: 1.2, pogaca: 1.2, cay: 0.8, kofte_ekmek: 0.6, hamburger: 0.5, et_doner: 0.5, tavuk_doner: 0.5,
      lahmacun: 0.5, kiymali_pide: 0.4, cigkofte_durum: 0.7, hazir_cigkofte: 0.7, patates: 0.9 },
    ogle: { kofte_ekmek: 3.2, et_doner: 2.6, tavuk_doner: 2.6, hamburger: 2.6, kasarli_tost: 1.4, karisik_tost: 1.8,
      cigkofte_durum: 2.3, hazir_cigkofte: 2.1, ayran: 2.4, lahmacun: 2.3, kiymali_pide: 2.1, patates: 1.6,
      kola: 1.3, cay: 0.6, cikolata: 0.5, simit: 0.5, pogaca: 0.5, cips: 0.6 },
    cikis: { kola: 2.5, cips: 2.2, patates: 2.5, hamburger: 1.4, cikolata: 1.6, meyve_suyu: 1.4, su: 1.2,
      cay: 0.6, simit: 0.8, kofte_ekmek: 0.9 },
    aksam: { cay: 3.0, simit: 1.5, pogaca: 1.2, kasarli_tost: 1.3, su: 1.2, cikolata: 1.3, kola: 0.8 },
  };

  const TYPE_PREFS = {
    ogrenci: { cay: 0.25, cips: 1.3, kola: 1.3, cikolata: 1.2, hamburger: 1.2 },
    ogretmen: { cay: 4, simit: 1.5, pogaca: 1.5, kasarli_tost: 1.3, cips: 0.3, cikolata: 0.4, kola: 0.4, su: 1.2 },
    hizmetli: { cay: 4, simit: 3, pogaca: 1.6, ayran: 1.2, kola: 0.4, cips: 0.4 },
    mudur: { cay: 3, kofte_ekmek: 1.6, karisik_tost: 1.5, cips: 0.2, kola: 0.3, cikolata: 0.3 },
    veli: { cay: 2.5, kasarli_tost: 1.6, su: 1.3, pogaca: 1.3, simit: 1.3, cips: 0.4 },
  };

  const NAMES = {
    ogrenci_k: ['Ayşe', 'Zeynep', 'Elif', 'Defne', 'Ece', 'Merve', 'Nehir', 'Azra', 'Duru', 'Ela', 'Irmak', 'Asya', 'Eylül', 'Buse', 'Melis', 'Sude', 'İpek', 'Nisa'],
    ogrenci_e: ['Mehmet', 'Emir', 'Can', 'Yusuf', 'Burak', 'Ali', 'Efe', 'Arda', 'Mert', 'Ömer', 'Eymen', 'Baran', 'Kaan', 'Deniz', 'Umut', 'Berk', 'Çağan', 'Doruk'],
    ogretmen_k: ['Selin Hoca', 'Ayten Hoca', 'Gülşen Hoca', 'Nur Hoca', 'Esra Hoca', 'Şule Hoca', 'Derya Hoca'],
    ogretmen_e: ['Ahmet Hoca', 'Murat Hoca', 'Kemal Hoca', 'Hakan Hoca', 'Serkan Hoca', 'Oğuz Hoca', 'İlker Hoca'],
    hizmetli_k: ['Hatice Abla', 'Sevgi Abla', 'Gülay Abla', 'Nermin Abla'],
    hizmetli_e: ['Rıza Amca', 'Hüseyin Abi', 'Cemal Amca', 'Şükrü Abi'],
    veli_k: ['Fatma Hanım', 'Emine Hanım', 'Zehra Hanım', 'Sibel Hanım', 'Aysel Hanım'],
    veli_e: ['Ali Bey', 'Osman Bey', 'Kadir Bey', 'Tuncay Bey', 'Erdal Bey'],
    mudur_k: ['Müdire Hanım'],
    mudur_e: ['Müdür Bey'],
    mufettis_k: ['Müfettiş Hanım'],
    mufettis_e: ['Müfettiş Bey'],
  };

  const TYPE_COLORS = {
    ogrenci: '#3d7be0', ogretmen: '#8a4fd1', hizmetli: '#2e9c6a', mudur: '#c9921a', veli: '#d0582f', mufettis: '#4a5866',
  };

  // ---------------------------------------------------------------------------
  // DURUM
  // ---------------------------------------------------------------------------
  const slots = new Array(SLOT_N).fill(null);
  const slotCooldown = new Array(SLOT_N).fill(0);
  let queue = [];       // kuyrukta bekleyenler (sıra sırası)
  let leaving = [];     // çıkmakta olanlar (yürüyüp ekrandan çıkar)
  let pending = [];     // gecikmeli üretim (akın): [{delay, opts}]
  let lastTime = null;
  let lastAkinFrom = -1;
  let inspectorAt = null, inspectorDone = false;
  let stats = null;
  let overflowNoteT = -99;
  let noStockNoteT = -99;
  const iconCache = {};

  function resetStats() { stats = { spawned: 0, served: 0, angry: 0, lostQueue: 0, overflow: 0, mudur: 0, nothing: 0 }; }
  resetStats();

  const U = () => KS.util;
  const A = () => KS.Art || {};
  const D = () => KS.DATA;
  const audio = (name, o) => { try { KS.audio && KS.audio.play && KS.audio.play(name, o); } catch (e) { /* ses yok */ } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function allCustomers() {
    const out = [];
    for (const c of slots) if (c) out.push(c);
    for (const c of queue) out.push(c);
    for (const c of leaving) out.push(c);
    return out;
  }
  function activeCustomers() {
    const out = [];
    for (const c of slots) if (c && c.state !== 'leave') out.push(c);
    for (const c of queue) out.push(c);
    return out;
  }

  function clearAll() {
    for (let i = 0; i < SLOT_N; i++) { slots[i] = null; slotCooldown[i] = 0; }
    queue = []; leaving = []; pending = [];
    lastTime = null;
  }

  // ---------------------------------------------------------------------------
  // TALEP
  // ---------------------------------------------------------------------------
  function priceMultiplier() {
    // menüdeki tarifler + satıştaki ürünlerin ortalama fiyat oranı -> talep çarpanı
    const s = KS.state, d = D();
    let sum = 0, n = 0;
    for (const id of Object.keys(d.recipes)) {
      if (KS.isRecipeOnMenu(id)) { sum += KS.priceRatio({ type: 'recipe', id }); n++; }
    }
    for (const id of Object.keys(d.products)) {
      if (KS.isProductUnlocked(id) && (s.products[id] || 0) > 0) { sum += KS.priceRatio({ type: 'product', id }); n++; }
    }
    if (!n) return 1;
    const avg = sum / n;
    return clamp(1 - (avg - 1) * 0.9, 0.5, 1.2);
  }
  function repMultiplier() { return 0.45 + (KS.state.rep / 5) * 0.9; }
  function dayMultiplier() { const d = KS.state.day; return d <= 1 ? 0.75 : d === 2 ? 0.9 : 1; }

  function demandPerMin() {
    const s = KS.state; if (!s.today) return 0;
    const p = KS.currentPeriod();
    const w = KS.todayWeather() || {}, ev = KS.todayEvent() || {};
    return (p.rate || 0) * DEMAND_SCALE * repMultiplier() * (w.demand || 1) * (ev.demand || 1) *
      (KS.upgVal('dekor', 'demand') || 1) * (KS.upgVal('kasa', 'demand') || 1) * dayMultiplier() * priceMultiplier();
  }

  // ---------------------------------------------------------------------------
  // TİP / İSİM / GÖRÜNÜŞ
  // ---------------------------------------------------------------------------
  function pickType(opts) {
    const d = D(), p = KS.currentPeriod(), ev = KS.todayEvent() || {};
    if (opts.type) return opts.type;
    if (ev.adultRatio && Math.random() < ev.adultRatio * 0.55 && !opts.rush) return 'veli';
    const w = {};
    for (const [k, t] of Object.entries(d.customerTypes)) if (t.weight > 0) w[k] = t.weight;
    if (p.type === 'ders') { w.ogrenci *= 0.3; w.ogretmen *= 2.2; w.hizmetli *= 2.2; }
    if (p.type === 'aksam') { w.ogrenci *= 0.6; w.ogretmen *= 1.6; }
    if (opts.rush) { w.ogrenci *= 3; if (w.mudur) w.mudur *= 0.3; }
    const maxMudur = KS.state.rep >= 4 ? 2 : 1;
    if (stats.mudur >= maxMudur || KS.state.day <= 1) w.mudur = 0;
    if (ev.adultRatio) w.veli = (w.ogretmen || 1) * 0.6;
    return U().weighted(w);
  }

  function isFemale(look) {
    if (!look) return null;
    const g = String(look.gender || look.sex || '').toLowerCase();
    if (!g) return null;
    if (g === 'k' || g === 'f' || g.startsWith('kad') || g.startsWith('kız') || g.startsWith('fem') || g === 'girl') return true;
    return false;
  }

  function makeLook(typeId) {
    let look = null;
    try { if (A().randomLook) look = A().randomLook(typeId); } catch (e) { look = null; }
    if (!look || typeof look !== 'object') look = { type: typeId };
    if (!look.type) look.type = typeId;
    return look;
  }

  function pickName(typeId, look) {
    let fem = isFemale(look);
    if (fem == null) fem = Math.random() < 0.5;
    const pool = NAMES[typeId + (fem ? '_k' : '_e')] || NAMES.ogrenci_e;
    // aynı isimden iki kişi aynı anda olmasın
    const used = new Set(allCustomers().map(c => c.name));
    const free = pool.filter(n => !used.has(n));
    return U().pick(free.length ? free : pool);
  }

  // ---------------------------------------------------------------------------
  // SİPARİŞ ÜRETİMİ
  // ---------------------------------------------------------------------------
  function reservations() {
    const ing = {}, prod = {};
    const d = D();
    for (const c of activeCustomers()) {
      for (const L of c.lines) {
        if (L.done) continue;
        const ln = L.line;
        if (ln.type === 'product') prod[ln.id] = (prod[ln.id] || 0) + 1;
        else {
          const r = d.recipes[ln.id]; if (!r) continue;
          const need = [r.base].concat(r.required, ln.want || []);
          for (const id of need) if (d.ingredients[id]) ing[id] = (ing[id] || 0) + 1;
        }
      }
    }
    return { ing, prod };
  }

  function ingAvail(id, res) {
    const d = D();
    if (!d.ingredients[id]) return true;      // bardak / kese / hazırlanmış ara ürün
    return KS.inv.get(id) - (res.ing[id] || 0) > 0;
  }

  // Tarif yapılabilir mi? (kantin menü panosunda "bitti" yazmayanlar) -> 0..1 ağırlık çarpanı
  function recipeStockFactor(r, res) {
    const d = D();
    const needs = [r.base].concat(r.required);
    let f = 1;
    for (const id of needs) {
      if (d.ingredients[id]) { if (!ingAvail(id, res)) return 0; }
      else if (id === 'cigkofte') {
        const raw = ['bulgur', 'isot', 'salca'].every(x => KS.inv.get(x) > 0);
        if (!raw) f *= 0.25;           // leğende hazır porsiyon olabilir
      } else if (id === 'cay') {
        if (KS.inv.get('cay_yapragi') <= 0) f *= 0.3; // demlikte çay kalmış olabilir
      }
    }
    return f;
  }

  function priceFactor(r) {
    if (r <= 0.9) return Math.min(1.8, 1 + (0.9 - r) * 3);
    if (r <= 1.0) return 1;
    if (r <= 1.2) return 1 - (r - 1) * 1.0;
    return 0.8 * Math.max(0.04, 1 - (r - 1.2) * 3);
  }

  function buildCandidates(typeId, res) {
    const d = D(), p = KS.currentPeriod();
    const w = KS.todayWeather() || {}, ev = KS.todayEvent() || {};
    const pp = PERIOD_PREFS[p.type] || {}, tp = TYPE_PREFS[typeId] || {};
    const wp = w.prefs || {}, ep = ev.prefs || {};
    const out = [];
    const mult = id => (BASE_POP[id] || 1) * (pp[id] || 1) * (tp[id] || 1) * (wp[id] || 1) * (ep[id] || 1);
    for (const [id, r] of Object.entries(d.recipes)) {
      if (!KS.isRecipeOnMenu(id)) continue;
      const sf = recipeStockFactor(r, res); if (sf <= 0) continue;
      const line = { type: 'recipe', id };
      const wgt = mult(id) * sf * priceFactor(KS.priceRatio(line));
      if (wgt > 0.0001) out.push({ key: id, type: 'recipe', id, w: wgt, price: KS.priceOf(line), cat: CATEGORY[id] || 'main' });
    }
    for (const [id, pr] of Object.entries(d.products)) {
      if (!KS.isProductUnlocked(id)) continue;
      if (KS.prod.get(id) - (res.prod[id] || 0) <= 0) continue;
      const line = { type: 'product', id };
      const wgt = mult(id) * priceFactor(KS.priceRatio(line));
      if (wgt > 0.0001) out.push({ key: id, type: 'product', id, w: wgt, price: KS.priceOf(line), cat: CATEGORY[id] || (pr.drink ? 'drink' : 'snack') });
    }
    return out;
  }

  // önceki seçimlere göre kombinasyon çarpanı
  function comboFactor(cand, chosen) {
    if (!chosen.length) return 1;
    let f = 1;
    const cats = chosen.map(c => c.cat), ids = chosen.map(c => c.id);
    const hasMain = cats.includes('main'), hasDrink = cats.includes('drink') || cats.includes('hot');
    const hasSnack = cats.includes('snack') || cats.includes('bakery') || cats.includes('side');
    if (cand.cat === 'drink' || cand.cat === 'hot') {
      if (hasDrink) f *= 0.08; else f *= hasMain ? 3.2 : 2.2;
      // çay + simit/poğaça klasik; köfte/döner + ayran klasik
      if (cand.id === 'cay' && (ids.includes('simit') || ids.includes('pogaca') || ids.includes('kasarli_tost'))) f *= 2.5;
      if (cand.id === 'ayran' && (ids.includes('kofte_ekmek') || ids.includes('et_doner') || ids.includes('tavuk_doner') || ids.includes('lahmacun') || ids.includes('cigkofte_durum') || ids.includes('hazir_cigkofte'))) f *= 2.6;
      if (cand.id === 'kola' && (ids.includes('hamburger') || ids.includes('patates'))) f *= 2.2;
      if (cand.id === 'cay' && hasMain && !ids.includes('kasarli_tost') && !ids.includes('karisik_tost')) f *= 0.4;
    } else if (cand.cat === 'main') {
      f *= hasMain ? 0.12 : 1.4;
    } else if (cand.cat === 'side') {
      f *= hasMain ? (ids.includes('hamburger') || ids.includes('kofte_ekmek') ? 2.4 : 1.2) : 1.0;
    } else {
      // atıştırmalık / fırın
      f *= hasSnack ? 0.35 : (hasMain ? 0.45 : 1.3);
      if ((cand.id === 'simit' || cand.id === 'pogaca') && ids.includes('cay')) f *= 3;
    }
    return f;
  }

  function makeWant(r, res) {
    let want = r.defaults.filter(id => ingAvail(id, res));   // bitmiş varsayılanı zaten istemez ("marul bitti")
    const roll = () => {
      const extras = r.optional.filter(o => !want.includes(o) && ingAvail(o, res));
      const canRemove = want.length > 0;
      if (canRemove && (extras.length === 0 || Math.random() < 0.5)) {
        want = want.filter(x => x !== U().pick(want));
      } else if (extras.length) {
        want = want.concat([U().pick(extras)]);
      }
    };
    if (Math.random() < 0.3) { roll(); if (Math.random() < 0.15) roll(); }
    // sıra düzeni: tarifteki optional sırası
    want = r.optional.filter(o => want.includes(o));
    return want;
  }

  function generateOrder(typeId, budget) {
    const t = D().customerTypes[typeId] || {};
    const maxItems = Math.max(1, t.maxItems || 1);
    const roll = Math.random();
    let n = roll < 0.55 ? 1 : roll < 0.9 ? 2 : 3;
    if (typeId === 'ogretmen' || typeId === 'mudur' || typeId === 'veli') n = roll < 0.45 ? 1 : roll < 0.85 ? 2 : 3;
    n = Math.min(n, maxItems);
    const res = reservations();
    const pool = buildCandidates(typeId, res);
    const chosen = [];
    let left = budget;
    for (let i = 0; i < n; i++) {
      const map = {};
      let any = false;
      for (const c of pool) {
        if (chosen.some(x => x.id === c.id)) continue;
        if (c.price > left) continue;
        const wv = c.w * comboFactor(c, chosen);
        if (wv > 0) { map[c.key] = wv; any = true; }
      }
      if (!any) break;
      const k = U().weighted(map);
      const c = pool.find(x => x.key === k);
      if (!c) break;
      chosen.push(c);
      left -= c.price;
      // rezervasyonu güncelle (aynı müşteri içinde)
      if (c.type === 'product') res.prod[c.id] = (res.prod[c.id] || 0) + 1;
    }
    const lines = [];
    for (const c of chosen) {
      let line;
      if (c.type === 'product') line = { type: 'product', id: c.id };
      else {
        const r = D().recipes[c.id];
        line = { type: 'recipe', id: c.id, want: makeWant(r, res) };
        for (const id of [r.base].concat(r.required, line.want)) if (D().ingredients[id]) res.ing[id] = (res.ing[id] || 0) + 1;
      }
      lines.push({ line, done: false, quality: 0, price: KS.priceOf(line), item: null, note: '' });
    }
    // yiyecek önce, içecek sonra (balonda okunaklı)
    const rank = L => { const cat = CATEGORY[L.line.id]; return cat === 'main' ? 0 : cat === 'side' ? 1 : cat === 'bakery' || cat === 'snack' ? 2 : 3; };
    lines.sort((a, b) => rank(a) - rank(b));
    return lines;
  }

  const TIME_BONUS = { 'Çok hızlı': 0, 'Hızlı': 6, 'Orta': 12, 'Uzun': 20 };

  function computePatience(c) {
    const t = c.type, ev = KS.todayEvent() || {};
    let base = U().rand(60, 80);
    for (const L of c.lines) {
      if (L.line.type === 'recipe') { const r = D().recipes[L.line.id]; base += TIME_BONUS[r && r.time] != null ? TIME_BONUS[r.time] : 8; }
    }
    base *= 1 + 0.12 * Math.max(0, c.lines.length - 1);
    base *= (t.patience || 1) * (ev.patience || 1) * (KS.upgVal('dekor', 'patience') || 1);
    if (KS.hasStaff('kasiyer')) base *= 1.15;
    if (KS.state.cleanliness < 50) base *= 0.85;
    return base;
  }

  // ---------------------------------------------------------------------------
  // MÜŞTERİ OLUŞTURMA
  // ---------------------------------------------------------------------------
  function makeCustomer(opts) {
    opts = opts || {};
    const typeId = pickType(opts);
    const t = D().customerTypes[typeId] || D().customerTypes.ogrenci;
    const look = makeLook(typeId);
    const ev = KS.todayEvent() || {};
    const c = {
      id: U().uid(), typeId, type: t, name: opts.name || pickName(typeId, look), look,
      mood: 0.85, anim: { state: 'walk', t: 0 }, animHold: 0, holdState: null,
      state: 'queue', slot: -1, x: 1720, targetX: 1720, scale: QUEUE_SCALE, dir: -1,
      lines: [], patience: 1, patienceMax: 1, payT: 0, payDur: 0,
      inspector: !!t.inspector, vip: !!t.vip, satisfaction: 0, bubbleT: 0, say: null,
      leaveDelay: 0, exitDir: 1, lateWarned: false, joinedAt: KS.state.time, served: 0,
      inspectT: 0, inspectDur: 8, inspectResult: null,
    };
    if (c.inspector) {
      c.lines = [];
    } else if (opts.lines) {
      c.lines = opts.lines.map(line => ({ line, done: false, quality: 0, price: KS.priceOf(line), item: null, note: '' }));
    } else {
      let budget = (t.budget || 150) * U().rand(0.85, 1.2);
      if (ev.tip && !t.adult) budget *= 1.35;    // harçlık günü
      c.lines = generateOrder(typeId, budget);
      if (!c.lines.length) return null;
    }
    c.patienceMax = c.inspector ? 999 : computePatience(c);
    c.patience = c.patienceMax;
    if (c.vip) stats.mudur++;
    return c;
  }

  function freeSlotIndex() {
    const free = [];
    for (let i = 0; i < SLOT_N; i++) if (!slots[i] && slotCooldown[i] <= 0) free.push(i);
    if (!free.length) return -1;
    return U().pick(free);
  }

  function queueX(i) { return QUEUE_X0 - i * QUEUE_DX; }

  function spawn(opts) {
    opts = opts || {};
    const s = KS.state;
    if (!s.today) return null;
    const fs = freeSlotIndex();
    if (fs < 0 && queue.length >= QUEUE_MAX && !opts.force) {
      stats.overflow++;
      s.today.lost++;
      if (KS.time - overflowNoteT > 25) {
        overflowNoteT = KS.time;
        KS.fx && KS.fx.floatText(1500, 300, 'Sıra çok uzun!', '#ffb36b', 20);
      }
      return null;
    }
    const c = makeCustomer(opts);
    if (!c) {
      stats.nothing++;
      s.today.lost++;
      if (KS.time - noStockNoteT > 30) {
        noStockNoteT = KS.time;
        KS.notify('Bir müşteri vitrinde ve menüde istediği hiçbir şeyi bulamadı. Stokları kontrol et!', 'warn');
      }
      return null;
    }
    stats.spawned++;
    if (fs >= 0 && queue.length === 0) {
      const slot = KS.layout.customerSlots[fs];
      const fromRight = fs >= 2 || (fs === 1 && Math.random() < 0.5);
      c.x = fromRight ? 1700 : -110;
      c.scale = 1;
      assignSlot(c, fs);
      void slot;
    } else {
      c.state = 'queue';
      c.x = 1700 + Math.random() * 40;
      c.scale = QUEUE_SCALE;
      if (c.inspector) queue.unshift(c); else queue.push(c);
      setAnim(c, 'walk');
    }
    return c;
  }

  function assignSlot(c, i) {
    const slot = KS.layout.customerSlots[i];
    slots[i] = c;
    c.slot = i;
    c.state = 'enter';
    c.targetX = slot.cx;
    c.dir = c.targetX < c.x ? -1 : 1;
    c.fromX = c.x; c.fromScale = c.scale;
    setAnim(c, 'walk');
    // kuyruktan geliyorsa sabrın bir kısmı tazelenir
    if (!c.inspector) {
      const ratio = c.patience / c.patienceMax;
      c.patience = c.patienceMax * (0.7 + 0.3 * clamp(ratio, 0, 1));
    }
  }

  function setAnim(c, st) { if (c.anim.state !== st) c.anim = { state: st, t: 0 }; }
  function holdAnim(c, st, sec) { c.holdState = st; c.animHold = sec; setAnim(c, st); }
  function say(c, text, color, life) { c.say = { text, color: color || '#2a2233', t: 0, life: life || 2.4 }; }

  // ---------------------------------------------------------------------------
  // ÇIKIŞ
  // ---------------------------------------------------------------------------
  function startLeave(c, kind) {
    // kind: 'happy' | 'angry' | 'neutral' | 'queue'
    if (c.state === 'leave') return;
    if (c.slot >= 0 && slots[c.slot] === c) { slots[c.slot] = null; slotCooldown[c.slot] = 0.9; }
    const qi = queue.indexOf(c); if (qi >= 0) queue.splice(qi, 1);
    c.state = 'leave';
    c.leaveKind = kind;
    c.exitDir = (c.slot >= 0 && KS.layout.customerSlots[c.slot].cx < 800 && kind !== 'queue') ? -1 : 1;
    if (kind === 'queue') c.exitDir = 1;
    c.targetX = c.exitDir < 0 ? -160 : 1780;
    c.dir = c.exitDir;
    if (kind === 'happy') { c.mood = 1; holdAnim(c, 'happy', 0.9); c.leaveDelay = 0.9; }
    else if (kind === 'angry') { c.mood = 0; holdAnim(c, 'angry', 1.0); c.leaveDelay = 1.0; }
    else { c.leaveDelay = 0.25; setAnim(c, 'walk'); }
    leaving.push(c);
  }

  function paidSoFar(c) { return c.lines.filter(L => L.done).reduce((a, L) => a + L.price, 0); }

  function angryLeave(c) {
    const s = KS.state;
    const partial = paidSoFar(c);
    if (s.today) { s.today.lost++; s.today.angry++; }
    stats.angry++;
    KS.addRep(-U().rand(0.08, 0.15) * (c.vip ? 2 : 1));
    const x = slotX(c);
    if (partial > 0) KS.earn(partial, 'satis', x, 300);
    KS.fx && KS.fx.floatText(x, 210, c.vip ? 'Bunu müdüriyete bildireceğim!' : U().pick(['Çok bekledim!', 'Bir daha gelmem!', 'Of ya, yeter!', 'Rezalet!']), '#ff6b5b', 22);
    audio('angry');
    KS.bus.emit('customerLeft', { customer: c, angry: true, paid: partial });
    startLeave(c, 'angry');
  }

  function slotX(c) { return c.slot >= 0 ? KS.layout.customerSlots[c.slot].cx : c.x; }

  // ---------------------------------------------------------------------------
  // SERVİS
  // ---------------------------------------------------------------------------
  function bestMatch(c, item) {
    let best = null, bestEv = null;
    for (const L of c.lines) {
      if (L.done) continue;
      let ev;
      try { ev = KS.Recipes.evaluate(item, L.line); } catch (e) { ev = null; }
      if (!ev || !ev.ok) continue;
      if (!best || ev.quality > bestEv.quality) { best = L; bestEv = ev; }
    }
    return best ? { L: best, ev: bestEv } : null;
  }

  function canServe(i, item) {
    const c = slots[i];
    if (!c || !item || c.inspector) return false;
    if (c.state !== 'wait' && c.state !== 'enter') return false;
    return !!bestMatch(c, item);
  }

  function serve(i, item) {
    const c = slots[i];
    if (!canServe(i, item)) return false;
    const m = bestMatch(c, item);
    const L = m.L, q = clamp(m.ev.quality, 0, 1);
    L.done = true; L.quality = q; L.item = item; L.note = (m.ev.notes && m.ev.notes[0]) || '';
    L.doneT = KS.time;
    c.served++;
    const x = slotX(c);
    audio('plate');
    let txt, col;
    if (q >= 0.9) { txt = 'Mükemmel! 😋'; col = '#7dff8f'; }
    else if (q >= 0.7) { txt = 'Güzel'; col = '#c6f27a'; }
    else if (q >= 0.4) { txt = 'İdare eder'; col = '#ffd23f'; }
    else { txt = 'Bu ne böyle?!'; col = '#ff6b5b'; }
    KS.fx && KS.fx.floatText(x, 236, txt, col, 24);
    if (L.note && q < 0.98) KS.fx && KS.fx.floatText(x, 266, L.note, '#ffe3c4', 17);
    try { KS.recordSale(L.line); } catch (e) { /* yok say */ }
    KS.addXP(Math.round(8 + q * 6));
    // anlık memnuniyet
    const doneLines = c.lines.filter(x => x.done);
    const avgQ = doneLines.reduce((a, x) => a + x.quality, 0) / doneLines.length;
    c.satisfaction = (avgQ - 0.6) * 0.6;
    if (q >= 0.7) holdAnim(c, 'happy', 0.7); else if (q < 0.4) holdAnim(c, 'angry', 0.7); else holdAnim(c, 'talk', 0.6);
    if (c.state === 'enter') { c.x = c.targetX; c.scale = 1; c.state = 'wait'; }
    if (c.lines.every(x => x.done)) startPay(c);
    return true;
  }

  function startPay(c) {
    c.state = 'pay';
    c.payT = 0;
    let pt = KS.upgVal('kasa', 'payTime');
    if (pt == null) pt = 2;
    if (KS.hasStaff('kasiyer')) pt *= 0.5;
    c.payDur = Math.max(0.25, pt);
    c.patienceAtPay = clamp(c.patience / c.patienceMax, 0, 1);
  }

  function finishPay(c) {
    const s = KS.state, ev = KS.todayEvent() || {};
    const total = c.lines.reduce((a, L) => a + L.price, 0);
    const avgQ = c.lines.length ? c.lines.reduce((a, L) => a + L.quality, 0) / c.lines.length : 1;
    const pr = c.patienceAtPay != null ? c.patienceAtPay : clamp(c.patience / c.patienceMax, 0, 1);
    const x = slotX(c);
    KS.earn(total, 'satis', x, 300);
    let tipRate = 0;
    if (avgQ >= 0.55) tipRate = 0.2 * ((avgQ - 0.55) / 0.45) * (0.4 + 0.6 * pr);
    let tip = Math.round(total * tipRate * (c.type.tipMult || 1) * (ev.tip || 1));
    if (tip >= 1) {
      KS.earn(tip, 'bahsis', x, 268);
      audio('coin');
    } else tip = 0;
    audio('ding');
    KS.fx && KS.fx.coins && KS.fx.coins(x, 330, 4 + Math.min(10, Math.round(total / 40)));
    // itibar
    let rep = (avgQ - 0.7) * 0.1 + (pr - 0.45) * 0.035;
    rep = clamp(rep, -0.1, 0.06);
    if (rep > 0) rep *= 0.6 * (1 - (s.rep / 5) * 0.6);     // yüksek itibarda artış yavaşlar
    rep *= c.vip ? 2 : 1;
    KS.addRep(rep);
    if (s.today) { s.today.served++; if (avgQ >= 0.9) s.today.perfect++; }
    stats.served++;
    KS.addDirt(0.5);
    if (c.vip) {
      if (avgQ >= 0.8) KS.notify('👑 Müdür Bey servisten çok memnun kaldı! İtibarın arttı.', 'good');
      else if (avgQ < 0.5) KS.notify('👑 Müdür Bey hiç memnun kalmadı...', 'bad');
    }
    KS.bus.emit('customerServed', { customer: c, total, tip, quality: avgQ });
    startLeave(c, avgQ >= 0.55 ? 'happy' : 'neutral');
  }

  // ---------------------------------------------------------------------------
  // MÜFETTİŞ
  // ---------------------------------------------------------------------------
  function inspectionResult(c) {
    const s = KS.state, d = D();
    const cl = s.cleanliness;
    let msg, color;
    if (cl < 50) {
      const fine = d.costs.inspectorFine || 1500;
      KS.spend(fine, 'ceza', true);
      KS.addRep(-0.5);
      KS.notify('🧾 Müfettiş: "Bu kantin çok kirli!" ' + U().fmtMoney(fine) + ' para cezası kesildi.', 'bad');
      audio('alarm'); KS.fx && KS.fx.shake && KS.fx.shake(6);
      msg = 'Ceza: ' + U().fmtMoney(fine); color = '#d8362b';
      c.mood = 0.1;
    } else if (cl <= 80) {
      KS.addRep(-0.1);
      KS.notify('🧾 Müfettiş uyarı verdi: "Temizliğe biraz daha dikkat edin."', 'warn');
      msg = 'Uyarı aldınız'; color = '#d98a12';
      c.mood = 0.5;
    } else {
      KS.addRep(0.3);
      KS.notify('🏅 Temizlik belgesi aldınız! Müfettiş çok memnun kaldı.', 'good');
      audio('levelup');
      msg = 'Temizlik belgesi! ✓'; color = '#22994a';
      c.mood = 1;
    }
    // menüde açık ama malzemesi bitmiş tarifler
    const missing = [];
    for (const [id, r] of Object.entries(d.recipes)) {
      if (!KS.isRecipeOnMenu(id)) continue;
      const needs = [r.base].concat(r.required).filter(x => d.ingredients[x]);
      if (needs.some(x => KS.inv.get(x) <= 0)) missing.push(r.name);
    }
    if (missing.length) {
      KS.addRep(-0.03);
      setTimeout(() => KS.notify('📝 Müfettiş not düştü: menüde olup yapılamayan ürünler var (' + missing.join(', ') + ').', 'warn'), 1200);
    }
    c.inspectResult = { msg, color, t: 0 };
    KS.bus.emit('customerLeft', { customer: c, inspector: true, cleanliness: cl });
  }

  function spawnInspector() {
    inspectorDone = true;
    const c = spawn({ type: 'mufettis', force: true });
    if (c) {
      KS.notify('🧑‍⚕️ Sağlık müfettişi kantine geldi! Denetim başlıyor.', 'warn');
      audio('door');
    }
    return c;
  }

  // ---------------------------------------------------------------------------
  // GÜNCELLEME
  // ---------------------------------------------------------------------------
  function scheduleRush(n, delayStart) {
    let d = delayStart || 0.2;
    for (let i = 0; i < n; i++) { pending.push({ delay: d, opts: { rush: true } }); d += U().rand(0.45, 1.1); }
  }

  function onPeriodChange(p) {
    const s = KS.state;
    if (!p || s.phase !== 'open') return;
    if ((p.type === 'teneffus' || p.type === 'ogle' || p.type === 'cikis') && p.from !== lastAkinFrom) {
      lastAkinFrom = p.from;
      const n = Math.round(U().randInt(2, 5) * clamp(repMultiplier(), 0.6, 1.3) * dayMultiplier() * ((KS.todayEvent() || {}).demand || 1));
      scheduleRush(Math.max(1, n), 0.4);
    }
    if (p.type === 'ders') {
      // öğrenciler derse yetişmeye çalışır
      for (const c of activeCustomers()) {
        if (c.typeId === 'ogrenci' && !c.lateWarned && (c.state === 'wait' || c.state === 'enter') && Math.random() < 0.75) {
          c.lateWarned = true;
          say(c, U().pick(['Derse geç kalıyorum!', 'Zil çaldı, çabuk!', 'Hocam kızacak!']), '#b3261e', 2.6);
        }
      }
    }
  }

  function updateSpawning(dt) {
    const s = KS.state;
    if (lastTime == null) { lastTime = s.time; return; }
    let dMin = s.time - lastTime;
    lastTime = s.time;
    if (s.phase !== 'open') return;
    if (dMin <= 0) return;
    dMin = Math.min(dMin, 1.0);   // zaman elle atlatıldıysa patlama olmasın
    const lambda = demandPerMin() * dMin;
    // Poisson: dMin küçük olduğundan P(1) ≈ λ; nadiren 2
    let r = Math.random();
    if (r < lambda) { spawn({}); if (Math.random() < lambda * 0.5) spawn({}); }
    // müfettiş
    if (inspectorAt != null && !inspectorDone && s.time >= inspectorAt) spawnInspector();
  }

  function updatePending(dt) {
    if (!pending.length) return;
    if (KS.state.phase !== 'open') { pending = []; return; }
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      p.delay -= dt;
      if (p.delay <= 0) { pending.splice(i, 1); spawn(p.opts); }
    }
  }

  function fillSlots(dt) {
    for (let i = 0; i < SLOT_N; i++) if (slotCooldown[i] > 0) slotCooldown[i] -= dt;
    while (queue.length) {
      const fs = freeSlotIndex();
      if (fs < 0) break;
      const c = queue.shift();
      assignSlot(c, fs);
    }
  }

  function moveToward(c, dt) {
    const dx = c.targetX - c.x;
    const step = WALK_SPEED * dt;
    if (Math.abs(dx) <= step) { c.x = c.targetX; return true; }
    c.x += Math.sign(dx) * step;
    c.dir = Math.sign(dx);
    return false;
  }

  function updateCustomer(c, dt, realDt) {
    c.anim.t += realDt; c.bubbleT += realDt;
    if (c.say) { c.say.t += realDt; if (c.say.t > c.say.life) c.say = null; }
    if (c.inspectResult) c.inspectResult.t += realDt;
    if (c.animHold > 0) { c.animHold -= realDt; if (c.animHold <= 0) { c.holdState = null; } }
    const ratio = clamp(c.patience / c.patienceMax, 0, 1);
    const p = KS.currentPeriod();
    const lateDrain = (c.typeId === 'ogrenci' && p && p.type === 'ders') ? 1.8 : 1;

    switch (c.state) {
      case 'queue': {
        const qi = queue.indexOf(c);
        c.targetX = queueX(Math.max(0, qi));
        const arrived = moveToward(c, dt);
        if (!c.holdState) setAnim(c, arrived ? 'idle' : 'walk');
        if (!c.inspector) {
          c.patience -= dt * QUEUE_DRAIN * lateDrain;
          if (c.patience / c.patienceMax < QUEUE_GIVEUP) {
            const s = KS.state;
            if (s.today) s.today.lost++;
            stats.lostQueue++;
            KS.addRep(-0.02);
            say(c, 'Çok bekledim, vazgeçtim...', '#6a4a8a', 2.2);
            KS.bus.emit('customerLeft', { customer: c, angry: false, queue: true });
            startLeave(c, 'queue');
            return;
          }
        }
        break;
      }
      case 'enter': {
        const total = Math.abs(c.targetX - (c.fromX != null ? c.fromX : c.x)) || 1;
        const arrived = moveToward(c, dt);
        const prog = clamp(1 - Math.abs(c.targetX - c.x) / total, 0, 1);
        c.scale = lerp(c.fromScale != null ? c.fromScale : 1, 1, U().easeOutCubic(prog));
        if (!c.holdState) setAnim(c, 'walk');
        if (arrived) {
          c.scale = 1;
          c.state = c.inspector ? 'inspect' : 'wait';
          c.bubbleT = 0;
          c.arrivedAt = KS.state.time;
          setAnim(c, c.inspector ? 'talk' : 'idle');
          if (c.vip) { audio('ding', { vol: 0.5 }); say(c, 'Kolay gelsin, nasıl gidiyor?', '#7a5a00', 2.4); }
        }
        // yürürken de sabır biraz düşer
        if (!c.inspector) c.patience -= dt * 0.5 * lateDrain;
        break;
      }
      case 'wait': {
        c.patience -= dt * lateDrain;
        if (!c.holdState) setAnim(c, ratio < 0.25 ? 'angry' : 'idle');
        if (ratio < 0.25 && !c.warnedLow) { c.warnedLow = true; if (!c.say) say(c, U().pick(['Hâlâ bekliyorum!', 'Ne oldu siparişim?', 'Hadi ama!']), '#b3261e', 2.0); }
        if (c.patience <= 0) { c.patience = 0; angryLeave(c); return; }
        break;
      }
      case 'pay': {
        c.payT += dt;
        if (!c.holdState) setAnim(c, 'talk');
        if (c.payT >= c.payDur) { finishPay(c); return; }
        break;
      }
      case 'inspect': {
        c.inspectT += dt;
        if (!c.holdState) setAnim(c, 'talk');
        if (!c.inspectResult && c.inspectT >= c.inspectDur) inspectionResult(c);
        if (c.inspectResult && c.inspectResult.t > 2.6) { startLeave(c, c.mood > 0.6 ? 'happy' : 'neutral'); return; }
        break;
      }
      case 'leave': {
        if (c.leaveDelay > 0) { c.leaveDelay -= dt > 0 ? dt : realDt; break; }
        if (!c.holdState) setAnim(c, 'walk');
        // kuyruktan vazgeçenler küçük ölçekte gider; slottakiler biraz geriye (koridora) doğru küçülür
        if (c.leaveKind !== 'queue') c.scale = Math.max(0.82, c.scale - dt * 0.15);
        moveToward(c, dt > 0 ? dt : realDt);
        if (c.x <= -150 || c.x >= 1770) { c.remove = true; }
        break;
      }
    }
    // mood (Art yüz ifadesi için)
    if (c.state !== 'leave' && c.state !== 'inspect') {
      const r2 = clamp(c.patience / c.patienceMax, 0, 1);
      const target = clamp(0.12 + r2 * 0.88 + c.satisfaction, 0, 1);
      c.mood = lerp(c.mood, target, Math.min(1, realDt * 3));
    }
    if (c.holdState) setAnim(c, c.holdState);
  }

  function update(dt, realDt) {
    const s = KS.state;
    realDt = realDt || 0;
    dt = dt || 0;
    if (s.phase !== 'open' && s.phase !== 'closing') {
      // menü/özet ekranında animasyon sürsün ama mantık durur
      for (const c of allCustomers()) { c.anim.t += realDt; c.bubbleT += realDt; }
      lastTime = s.time;
      return;
    }
    if (dt > 0) {
      updateSpawning(dt);
      updatePending(dt);
      fillSlots(dt);
    } else {
      lastTime = s.time;
    }
    for (const c of allCustomers()) {
      try { updateCustomer(c, dt, dt > 0 ? realDt : 0); } catch (e) { console.error('[customers]', e); }
    }
    if (leaving.some(c => c.remove)) leaving = leaving.filter(c => !c.remove);
  }

  // ---------------------------------------------------------------------------
  // ÇİZİM YARDIMCILARI
  // ---------------------------------------------------------------------------
  function txt(ctx, str, x, y, o) {
    o = o || {};
    const Art = A();
    if (Art.text) { try { Art.text(ctx, str, x, y, Object.assign({ font: FONT }, o)); return; } catch (e) { /* düş */ } }
    ctx.save();
    ctx.font = (o.weight || 700) + ' ' + (o.size || 16) + 'px ' + FONT;
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.baseline || 'middle';
    if (o.stroke) { ctx.lineWidth = o.strokeWidth || 4; ctx.strokeStyle = o.stroke; ctx.strokeText(str, x, y); }
    ctx.fillStyle = o.color || '#fff'; ctx.fillText(str, x, y);
    ctx.restore();
  }
  function fitSize(ctx, str, weight, size, maxW, minSize) {
    let s = size;
    ctx.save();
    while (s > (minSize || 10)) {
      ctx.font = weight + ' ' + s + 'px ' + FONT;
      if (ctx.measureText(str).width <= maxW) break;
      s -= 1;
    }
    ctx.restore();
    return s;
  }
  function measure(ctx, str, weight, size) {
    ctx.save(); ctx.font = weight + ' ' + size + 'px ' + FONT;
    const w = ctx.measureText(str).width; ctx.restore(); return w;
  }
  function rr(ctx, x, y, w, h, r) {
    if (KS.roundRectPath) KS.roundRectPath(ctx, x, y, w, h, r);
    else { ctx.beginPath(); ctx.rect(x, y, w, h); }
  }

  function shortName(line) {
    if (SHORT_NAMES[line.id]) return SHORT_NAMES[line.id];
    return KS.Recipes.nameOf(line.id);
  }

  function modsText(line) {
    let m;
    try { m = KS.Recipes.lineMods(line); } catch (e) { m = { without: [], extra: [] }; }
    const parts = [];
    for (const w of m.without) parts.push({ t: KS.Recipes.suffixSiz ? KS.Recipes.suffixSiz(KS.Recipes.nameOf(w)) : (KS.Recipes.nameOf(w) + ' yok'), c: '#d23a2c' });
    for (const e of m.extra) parts.push({ t: e === 'pul_biber' ? 'acılı 🌶' : '+' + KS.Recipes.nameOf(e).toLowerCase(), c: '#1f9a48' });
    return parts;
  }

  function sampleItem(line) {
    if (line.type === 'product') return KS.items.product(line.id);
    const r = D().recipes[line.id];
    if (!r) return null;
    const layers = [];
    for (const id of r.required.concat(line.want || r.defaults || [])) {
      const L = { id, q: 1 };
      if (id === 'kofte') { L.cook = 1; L.cookA = 1; L.cookB = 1; }
      if (id === 'patates') L.cook = 1;
      layers.push(L);
    }
    return KS.items.dish(r.base, { layers, toast: r.toast ? 1 : 0 });
  }

  // Sipariş ikonu (offscreen önbellek)
  function getIcon(line) {
    const key = line.type + ':' + line.id + ':' + (line.want || []).join(',');
    if (iconCache[key] !== undefined) return iconCache[key];
    let cv = null;
    try {
      const Art = A();
      if (Art.drawItem && typeof document !== 'undefined') {
        const item = sampleItem(line);
        if (item) {
          cv = document.createElement('canvas');
          cv.width = 128; cv.height = 128;
          const g = cv.getContext('2d');
          Art.drawItem(g, item, 64, 66, 0.92);
        }
      }
    } catch (e) { cv = null; }
    iconCache[key] = cv;
    return cv;
  }

  function drawCheck(ctx, x, y, r) {
    const Art = A();
    ctx.save();
    ctx.fillStyle = '#27a84a';
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.32; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x - r * 0.45, y + r * 0.02); ctx.lineTo(x - r * 0.1, y + r * 0.38); ctx.lineTo(x + r * 0.5, y - r * 0.35); ctx.stroke();
    ctx.restore();
    void Art;
  }

  function drawCrown(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
    g.addColorStop(0, '#ffe680'); g.addColorStop(1, '#e09a12');
    ctx.fillStyle = g; ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, s * 0.35); ctx.lineTo(-s * 0.55, -s * 0.25); ctx.lineTo(-s * 0.22, s * 0.02);
    ctx.lineTo(0, -s * 0.42); ctx.lineTo(s * 0.22, s * 0.02); ctx.lineTo(s * 0.55, -s * 0.25); ctx.lineTo(s * 0.5, s * 0.35);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8413a';
    ctx.beginPath(); ctx.arc(0, s * 0.16, s * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawClipboard(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#9b6b3a'; rr(ctx, -s * 0.38, -s * 0.48, s * 0.76, s * 0.96, s * 0.08); ctx.fill();
    ctx.fillStyle = '#fbfbf6'; rr(ctx, -s * 0.3, -s * 0.36, s * 0.6, s * 0.78, s * 0.04); ctx.fill();
    ctx.fillStyle = '#7d8790'; rr(ctx, -s * 0.16, -s * 0.54, s * 0.32, s * 0.14, s * 0.05); ctx.fill();
    ctx.strokeStyle = '#8fa0b0'; ctx.lineWidth = Math.max(1, s * 0.05);
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-s * 0.2, -s * 0.18 + i * s * 0.16); ctx.lineTo(s * 0.2, -s * 0.18 + i * s * 0.16); ctx.stroke(); }
    ctx.restore();
  }

  function bubbleHeight(c) {
    if (c.inspector) return 96;
    return 60 + LINE_H * c.lines.length;
  }

  // ---------------------------------------------------------------------------
  // ÇİZİM: MÜŞTERİLER (customers katmanı)
  // ---------------------------------------------------------------------------
  function drawFigure(ctx, c, t, alpha, silhouette) {
    const Art = A();
    const sc = c.scale;
    const prog = clamp((sc - QUEUE_SCALE) / (1 - QUEUE_SCALE), 0, 1);
    const base = lerp(QUEUE_BASE + BODY_OFFSET * QUEUE_SCALE, KS.layout.customerSlots[0].baseY + BODY_OFFSET, prog);
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (silhouette) { try { ctx.filter = 'saturate(0.55) brightness(0.82)'; } catch (e) { /* desteklenmiyor */ } }
    ctx.translate(c.x, base);
    ctx.scale(sc, sc);
    if (Art.drawCustomer) { try { Art.drawCustomer(ctx, c, 0, 0, t); } catch (e) { /* Art hatası oyunu durdurmasın */ } }
    else fallbackFigure(ctx, c, t);
    ctx.restore();
  }

  // Art.drawCustomer yoksa basit ama düzgün bir figür
  function fallbackFigure(ctx, c, t) {
    const look = c.look || {};
    const walk = c.anim && c.anim.state === 'walk';
    const bob = walk ? Math.abs(Math.sin(t * 9)) * -6 : Math.sin(t * 2 + c.id) * 1.5;
    ctx.save();
    ctx.translate(0, bob);
    const shirt = look.shirt || TYPE_COLORS[c.typeId] || '#3d7be0';
    const g = ctx.createLinearGradient(0, -190, 0, 0);
    g.addColorStop(0, shirt); g.addColorStop(1, '#1d2433');
    ctx.fillStyle = g; rr(ctx, -56, -170, 112, 170, 34); ctx.fill();
    ctx.fillStyle = look.skin || '#f1c27d';
    ctx.beginPath(); ctx.arc(0, -205, 44, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look.hair || '#3b2a1a';
    ctx.beginPath(); ctx.arc(0, -215, 45, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    ctx.fillStyle = '#2a1d14';
    const m = c.mood != null ? c.mood : 0.7;
    ctx.beginPath(); ctx.arc(-15, -205, 4, 0, Math.PI * 2); ctx.arc(15, -205, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7a3a2a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    if (m > 0.5) ctx.arc(0, -192, 11, 0.2 * Math.PI, 0.8 * Math.PI);
    else if (m > 0.25) { ctx.moveTo(-9, -184); ctx.lineTo(9, -184); }
    else ctx.arc(0, -176, 11, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  function drawCustomersLayer(ctx) {
    const t = KS.time || 0;
    // kuyruk: arkadan öne (en sondaki en arkada)
    for (let i = queue.length - 1; i >= 0; i--) drawFigure(ctx, queue[i], t, 0.62, true);
    // kuyruktan vazgeçip gidenler
    for (const c of leaving) if (c.leaveKind === 'queue') drawFigure(ctx, c, t, 0.55, true);
    // slot müşterileri + çıkanlar (çıkanlar arkada)
    for (const c of leaving) if (c.leaveKind !== 'queue') drawFigure(ctx, c, t, 1, false);
    for (const c of slots) if (c && c.state === 'enter') drawFigure(ctx, c, t, 1, false);
    for (const c of slots) if (c && c.state !== 'enter') drawFigure(ctx, c, t, 1, false);
  }

  // ---------------------------------------------------------------------------
  // ÇİZİM: BALONLAR (counter katmanı)
  // ---------------------------------------------------------------------------
  function drawBubbleBg(ctx, x, y, w, h, c, ratio) {
    const Art = A();
    const vip = c.vip;
    ctx.save();
    if (Art.drawBubble) {
      try { Art.drawBubble(ctx, x, y, w, h, { tail: 'down', radius: 14, color: vip ? '#fff3d0' : c.inspector ? '#eef3f8' : '#ffffff', border: vip ? 'rgba(200,140,10,0.6)' : undefined }); }
      catch (e) { ctx.fillStyle = '#fff'; rr(ctx, x, y, w, h, 14); ctx.fill(); }
    } else {
      ctx.shadowColor = 'rgba(30,15,5,0.32)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
      ctx.fillStyle = '#fff'; rr(ctx, x, y, w, h, 14); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.beginPath(); ctx.moveTo(x + w / 2 - 11, y + h - 1); ctx.lineTo(x + w / 2, y + h + 13); ctx.lineTo(x + w / 2 + 11, y + h - 1); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // kenarlık: VIP altın, sabırsız kırmızı nabız
    ctx.save();
    if (vip) {
      ctx.strokeStyle = '#e0a417'; ctx.lineWidth = 3;
      rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 13); ctx.stroke();
    }
    if (!c.inspector && c.state === 'wait' && ratio < 0.25) {
      const pulse = 0.5 + 0.5 * Math.sin((KS.time || 0) * 9);
      ctx.strokeStyle = 'rgba(230,50,40,' + (0.45 + pulse * 0.5) + ')'; ctx.lineWidth = 3.5;
      rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 13); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHeader(ctx, c, x, y, w) {
    const tc = TYPE_COLORS[c.typeId] || '#555';
    let nx = x + 12;
    if (c.vip) { drawCrown(ctx, x + 22, y + 13, 20); nx = x + 36; }
    const typeName = c.type.name || '';
    // tip rozeti (sağda)
    const pillTxt = c.vip ? 'VIP' : typeName;
    const pw = measure(ctx, pillTxt, 800, 11) + 14;
    const px = x + w - pw - 10, py = y + 5;
    ctx.save();
    ctx.fillStyle = tc; rr(ctx, px, py, pw, 17, 8.5); ctx.fill();
    ctx.restore();
    txt(ctx, pillTxt, px + pw / 2, py + 9, { size: 11, weight: 800, color: '#fff', align: 'center' });
    const maxW = px - nx - 6;
    const ns = fitSize(ctx, c.name, 800, 14, maxW, 10);
    txt(ctx, c.name, nx, y + 14, { size: ns, weight: 800, color: '#3a2c22' });
    // ince ayraç
    ctx.save();
    ctx.strokeStyle = 'rgba(80,50,30,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 10, y + 27.5); ctx.lineTo(x + w - 10, y + 27.5); ctx.stroke();
    ctx.restore();
  }

  function drawLine(ctx, L, x, y, w, idx) {
    const line = L.line;
    const icx = x + 30, icy = y + LINE_H / 2;
    // ikon zemini
    ctx.save();
    if (L.done) ctx.globalAlpha = 0.55;
    const grd = ctx.createRadialGradient(icx - 4, icy - 5, 2, icx, icy, 17);
    grd.addColorStop(0, '#fffaf0'); grd.addColorStop(1, '#f1e2c8');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(icx, icy, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(140,100,60,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    const icon = getIcon(line);
    if (icon) ctx.drawImage(icon, icx - 20, icy - 20, 40, 40);
    else txt(ctx, '•', icx, icy, { size: 18, color: '#a07040', align: 'center' });
    ctx.restore();
    if (L.done) drawCheck(ctx, icx + 12, icy + 9, 8);

    // yazılar
    const tx = x + 54;
    const priceStr = U().fmtMoney(L.price);
    const pW = measure(ctx, priceStr, 700, 12);
    const maxW = w - (tx - x) - pW - 18;
    const name = shortName(line);
    const mods = modsText(line);
    const nsz = fitSize(ctx, name, 800, 16, maxW, 11);
    const nameY = mods.length ? y + 11 : y + LINE_H / 2;
    const nameCol = L.done ? 'rgba(60,45,35,0.45)' : '#2b211b';
    txt(ctx, name, tx, nameY, { size: nsz, weight: 800, color: nameCol });
    if (L.done) {
      const nw = measure(ctx, name, 800, nsz);
      ctx.save(); ctx.strokeStyle = 'rgba(60,45,35,0.45)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(tx - 1, nameY + 1); ctx.lineTo(tx + nw + 1, nameY + 1); ctx.stroke(); ctx.restore();
    }
    if (mods.length) {
      let mx = tx;
      const my = y + 26;
      for (const m of mods) {
        const s = fitSize(ctx, m.t, 800, 12, maxW - (mx - tx), 9);
        const mw = measure(ctx, m.t, 800, s);
        if (mx + mw > tx + maxW + 2) break;
        ctx.save(); ctx.globalAlpha = L.done ? 0.45 : 1;
        ctx.fillStyle = m.c === '#d23a2c' ? 'rgba(210,58,44,0.12)' : 'rgba(31,154,72,0.12)';
        rr(ctx, mx - 3, my - 7.5, mw + 6, 15, 6); ctx.fill();
        ctx.restore();
        txt(ctx, m.t, mx, my, { size: s, weight: 800, color: L.done ? 'rgba(80,80,80,0.5)' : m.c });
        mx += mw + 10;
      }
    }
    txt(ctx, priceStr, x + w - 12, y + LINE_H / 2, { size: 12, weight: 700, color: L.done ? 'rgba(90,70,50,0.4)' : '#8a6a4a', align: 'right' });
    // satır ayraç
    if (idx > 0) {
      ctx.save(); ctx.strokeStyle = 'rgba(80,50,30,0.08)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 52, y + 0.5); ctx.lineTo(x + w - 12, y + 0.5); ctx.stroke(); ctx.restore();
    }
  }

  function drawPatienceBar(ctx, x, y, w, ratio) {
    const Art = A();
    if (Art.drawPatience) { try { Art.drawPatience(ctx, x, y - 1, w, ratio, { h: 10 }); return; } catch (e) { /* düş */ } }
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; rr(ctx, x, y, w, 8, 4); ctx.fill();
    ctx.fillStyle = ratio > 0.5 ? '#4cc764' : ratio > 0.25 ? '#f2b62b' : '#e5483b';
    rr(ctx, x, y, Math.max(8, w * ratio), 8, 4); ctx.fill();
    ctx.restore();
  }

  function drawOrderBubble(ctx, c) {
    const slot = KS.layout.customerSlots[c.slot];
    const w = BUBBLE_W, h = bubbleHeight(c);
    const x = slot.cx - w / 2, y = 64;
    const ratio = clamp(c.patience / c.patienceMax, 0, 1);
    // açılış animasyonu
    const k = clamp(c.bubbleT / 0.32, 0, 1);
    const s = k < 1 ? Math.max(0.01, U().easeOutBack(k)) : 1;
    ctx.save();
    ctx.translate(slot.cx, y + h);
    ctx.scale(s, s);
    ctx.translate(-slot.cx, -(y + h));
    if (k < 1) ctx.globalAlpha = Math.min(1, k * 1.6);
    // sabırsızken hafif titreme
    if (!c.inspector && c.state === 'wait' && ratio < 0.15) ctx.translate(Math.sin((KS.time || 0) * 40) * 1.2, 0);

    drawBubbleBg(ctx, x, y, w, h, c, ratio);
    drawHeader(ctx, c, x, y, w);

    if (c.inspector) {
      drawInspectorBody(ctx, c, x, y, w, h);
      ctx.restore();
      return;
    }
    for (let i = 0; i < c.lines.length; i++) drawLine(ctx, c.lines[i], x, y + 30 + i * LINE_H, w, i);

    // alt bilgi
    const fy = y + h - 22;
    const total = c.lines.reduce((a, L) => a + L.price, 0);
    const totStr = U().fmtMoney(total);
    const tw = measure(ctx, totStr, 800, 14);
    if (c.state === 'pay') {
      const pr = clamp(c.payT / Math.max(0.01, c.payDur), 0, 1);
      const bx = x + 32, bw = w - tw - 56;
      drawCoinIcon(ctx, x + 20, fy + 6, 8, (KS.time || 0));
      ctx.save();
      ctx.fillStyle = 'rgba(160,110,20,0.16)'; rr(ctx, bx, fy - 2, bw, 16, 8); ctx.fill();
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, '#ffe27a'); g.addColorStop(1, '#f2a812');
      ctx.fillStyle = g; rr(ctx, bx, fy - 2, Math.max(16, bw * pr), 16, 8); ctx.fill();
      ctx.restore();
      txt(ctx, 'Ödeme alınıyor…', bx + bw / 2, fy + 6.5, { size: 11, weight: 800, color: '#6b4500', align: 'center' });
    } else {
      // saat ikonu + sabır
      drawClockIcon(ctx, x + 20, fy + 6, 7, ratio);
      drawPatienceBar(ctx, x + 32, fy + 2, w - tw - 58, ratio);
    }
    txt(ctx, totStr, x + w - 12, fy + 6, { size: 14, weight: 800, color: '#2f7a2f', align: 'right' });
    ctx.restore();
  }

  function drawClockIcon(ctx, x, y, r, ratio) {
    ctx.save();
    ctx.fillStyle = ratio > 0.5 ? '#4cc764' : ratio > 0.25 ? '#f2b62b' : '#e5483b';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r - 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    const a = -Math.PI / 2 + (1 - ratio) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * (r - 3), y + Math.sin(a) * (r - 3)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - (r - 3.5)); ctx.stroke();
    ctx.restore();
  }

  function drawCoinIcon(ctx, x, y, r, t) {
    ctx.save();
    const sx = Math.abs(Math.cos(t * 5)) * 0.7 + 0.3;
    ctx.translate(x, y); ctx.scale(sx, 1);
    ctx.fillStyle = '#d18f0a'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd94a'; ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawInspectorBody(ctx, c, x, y, w, h) {
    drawClipboard(ctx, x + 30, y + 54, 30);
    if (c.inspectResult) {
      const ir = c.inspectResult;
      const s = fitSize(ctx, ir.msg, 800, 16, w - 70, 11);
      txt(ctx, ir.msg, x + 54, y + 50, { size: s, weight: 800, color: ir.color });
      txt(ctx, 'Temizlik: %' + Math.round(KS.state.cleanliness), x + 54, y + 72, { size: 12, weight: 700, color: '#6a6a6a' });
    } else {
      const dots = '.'.repeat(1 + Math.floor((KS.time || 0) * 2.5) % 3);
      txt(ctx, 'Denetim yapıyorum' + dots, x + 54, y + 46, { size: 15, weight: 800, color: '#34404c' });
      const pr = clamp(c.inspectT / c.inspectDur, 0, 1);
      const bx = x + 54, bw = w - 70, by = y + 64;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; rr(ctx, bx, by, bw, 10, 5); ctx.fill();
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, '#6fb6ff'); g.addColorStop(1, '#2f6fd6');
      ctx.fillStyle = g; rr(ctx, bx, by, Math.max(10, bw * pr), 10, 5); ctx.fill();
      ctx.restore();
      txt(ctx, 'Temizlik kontrol ediliyor', bx, by + 20, { size: 10, weight: 700, color: '#7a8590' });
    }
  }

  function drawSay(ctx, c) {
    if (!c.say) return;
    const sv = c.say;
    const a = sv.t < 0.15 ? sv.t / 0.15 : sv.t > sv.life - 0.3 ? Math.max(0, (sv.life - sv.t) / 0.3) : 1;
    const size = 14;
    const w = measure(ctx, sv.text, 800, size) + 22, h = 28;
    let x, y;
    if (c.state === 'queue' || c.leaveKind === 'queue') { x = c.x - w / 2; y = 196; }
    else { x = c.x + 40; y = 214; }
    x = clamp(x, 6, 1594 - w);
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#fffdf6';
    rr(ctx, x, y, w, h, 13); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.beginPath(); ctx.moveTo(x + 10, y + h - 2); ctx.lineTo(x + 2, y + h + 9); ctx.lineTo(x + 22, y + h - 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; rr(ctx, x, y, w, h, 13); ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.globalAlpha *= a;
    txt(ctx, sv.text, x + w / 2, y + h / 2 + 1, { size, weight: 800, color: sv.color, align: 'center' });
    ctx.restore();
  }

  // ödeme sırasında tezgahta biriken bozuk paralar
  function drawPayCoins(ctx, c) {
    if (c.state !== 'pay') return;
    const slot = KS.layout.customerSlots[c.slot];
    const pr = clamp(c.payT / Math.max(0.01, c.payDur), 0, 1);
    const n = 1 + Math.floor(pr * 6);
    for (let i = 0; i < n; i++) {
      const cx = slot.cx + 70 + (i % 2) * 6, cy = 360 - i * 4;
      ctx.save();
      ctx.fillStyle = '#b77a06'; ctx.beginPath(); ctx.ellipse(cx, cy + 1.5, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd34a'; ctx.beginPath(); ctx.ellipse(cx, cy, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // banknot
    if (pr > 0.3) {
      ctx.save();
      ctx.translate(slot.cx + 40, 361); ctx.rotate(-0.12);
      ctx.fillStyle = '#5aa06a'; rr(ctx, -16, -6, 32, 12, 2); ctx.fill();
      ctx.fillStyle = '#9ad3a5'; rr(ctx, -12, -3.5, 24, 7, 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawQueueBadge(ctx) {
    const n = queue.length;
    if (!n) return;
    const label = 'Sırada: ' + n;
    const w = measure(ctx, label, 800, 15) + 46, h = 30;
    const x = 1592 - w, y = 66;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    const full = n >= QUEUE_MAX - 1;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, full ? '#e0573f' : '#4a3a5e'); g.addColorStop(1, full ? '#b8341f' : '#2e2340');
    ctx.fillStyle = g; rr(ctx, x, y, w, h, 15); ctx.fill();
    ctx.restore();
    // kişi ikonu
    ctx.save();
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath(); ctx.arc(x + 18, y + 11, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 18, y + 22, 7.5, 5, 0, Math.PI, 0); ctx.fill();
    ctx.restore();
    txt(ctx, label, x + 32, y + h / 2 + 1, { size: 15, weight: 800, color: '#fff' });
  }

  function drawCounterLayer(ctx) {
    for (const c of slots) {
      if (!c) continue;
      if (c.state === 'wait' || c.state === 'pay' || c.state === 'inspect') {
        try { drawOrderBubble(ctx, c); } catch (e) { console.error('[customers bubble]', e); }
      }
      drawPayCoins(ctx, c);
    }
    for (const c of allCustomers()) drawSay(ctx, c);
    drawQueueBadge(ctx);
  }

  function draw(ctx, layer) {
    const ph = KS.state.phase;
    if (ph !== 'open' && ph !== 'closing' && !allCustomers().length) return;
    if (layer === 'customers') drawCustomersLayer(ctx);
    else if (layer === 'counter') drawCounterLayer(ctx);
  }

  // ---------------------------------------------------------------------------
  // BÖLGELER
  // ---------------------------------------------------------------------------
  function tooltipFor(i) {
    const c = slots[i];
    if (!c || c.state === 'leave' || c.state === 'enter') return null;
    const head = c.name + ' · ' + (c.type.name || '') + (c.vip ? ' 👑' : '');
    if (c.inspector) return head + '\nTezgahın temizliğini denetliyor.\nTemizlik: %' + Math.round(KS.state.cleanliness);
    const out = [head];
    for (const L of c.lines) {
      out.push((L.done ? '✓ ' : '• ') + KS.Recipes.lineLabel(L.line) + ' — ' + U().fmtMoney(L.price));
    }
    const total = c.lines.reduce((a, L) => a + L.price, 0);
    if (c.state === 'pay') out.push('Ödeme yapıyor… Toplam: ' + U().fmtMoney(total));
    else out.push('Sabır: %' + Math.round(clamp(c.patience / c.patienceMax, 0, 1) * 100) + '  ·  Toplam: ' + U().fmtMoney(total));
    return out.join('\n');
  }

  function setupZones() {
    if (!KS.addZone || !KS.layout || !KS.layout.customerSlots) return;
    KS.layout.customerSlots.forEach((slot, i) => {
      const id = 'customer_slot_' + i;
      if (KS.removeZone) KS.removeZone(id);
      KS.addZone({
        id,
        rect: slot.rect,
        z: 60,
        enabled: () => !!slots[i] && slots[i].state !== 'leave',
        canDrop: item => { try { return canServe(i, item); } catch (e) { return false; } },
        onDrop: item => { try { return serve(i, item); } catch (e) { console.error('[customers serve]', e); return false; } },
        tooltip: () => { try { return tooltipFor(i); } catch (e) { return null; } },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // KANCALAR / OLAYLAR
  // ---------------------------------------------------------------------------
  function forceLeaveAll() {
    for (const c of activeCustomers().slice()) {
      const partial = paidSoFar(c);
      if (partial > 0) KS.earn(partial, 'satis');
      if (c.inspector && !c.inspectResult) { /* denetim yarıda kaldı */ }
      KS.bus.emit('customerLeft', { customer: c, angry: false, forced: true, paid: partial });
      startLeave(c, 'neutral');
    }
    pending = [];
  }

  function onClosing() {
    pending = [];
    for (const c of queue.slice()) {
      if (c.inspector) continue;
      say(c, U().pick(['Kantin kapandı...', 'Ah, kapanmış!', 'Yarın gelirim.']), '#5a4a6a', 2.2);
      KS.bus.emit('customerLeft', { customer: c, angry: false, closed: true });
      startLeave(c, 'queue');
    }
  }

  function onOpen() {
    clearAll();
    resetStats();
    lastTime = KS.state.time;
    lastAkinFrom = -1;
    inspectorDone = false;
    inspectorAt = null;
    const ev = KS.todayEvent() || {};
    if (ev.inspector) inspectorAt = U().randInt(570, 900);
    // açılışta kapıda bekleyen birkaç öğrenci
    scheduleRush(KS.state.day <= 1 ? 1 : U().randInt(1, 2), 1.2);
  }

  function init() {
    setupZones();
    KS.hooks.activeCustomerCount = () => activeCustomers().length + pending.length;
    KS.hooks.forceCustomersLeave = () => { try { forceLeaveAll(); } catch (e) { console.error(e); } };
    const bus = KS.bus;
    bus.on('open', onOpen);
    bus.on('closing', onClosing);
    bus.on('periodChange', onPeriodChange);
    for (const ev of ['dayEnd', 'newGame', 'prepStart', 'stateLoaded']) bus.on(ev, () => { clearAll(); });
  }

  KS.Customers = {
    list: () => allCustomers(),
    queueLength: () => queue.length,
    active: () => activeCustomers(),
    slotCustomer: i => slots[i] || null,
    serve: (i, item) => serve(i, item),
    canServe: (i, item) => canServe(i, item),
    spawn: opts => spawn(Object.assign({ force: true }, opts || {})),
    spawnInspector,
    clear: clearAll,
    stats: () => Object.assign({}, stats),
    demandPerMin,
    _forceLeaveAll: forceLeaveAll,
  };

  KS.registerModule({ name: 'customers', order: 50, init, update, draw });
})(window.KS);
