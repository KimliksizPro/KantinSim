/* KantinSim — Tarif değerlendirme / tanıma
 * Sahibi: çekirdek (lead).
 *
 * Item modeli (bkz. CONTRACT.md):
 *   { uid, type:'ing',     id:'kofte', cookA, cookB, cook }      -> elde taşınan tek malzeme
 *   { uid, type:'dish',    id:'tost_ekmegi', layers:[{id,q,cook?}], toast }  -> tabakta hazırlanan yemek
 *   { uid, type:'product', id:'ayran' }                             -> hazır/paketli ürün
 * Sipariş satırı (order line):
 *   { type:'recipe', id:'kofte_ekmek', want:['domates','marul'] }
 *   { type:'product', id:'ayran' }
 */
(function (KS) {
  'use strict';
  const D = () => KS.DATA;

  // Pişme seviyesi -> kalite (0..1). 1.0 = tam kıvamında
  function cookQuality(c) {
    if (c == null) return 1;
    if (c < 0.45) return 0.05;                       // çiğ
    if (c < 0.85) return 0.3 + (c - 0.45) / 0.4 * 0.65; // az pişmiş
    if (c <= 1.2) return 1;                          // mükemmel
    if (c < 1.5) return 1 - (c - 1.2) / 0.3 * 0.65;  // fazla
    return 0.08;                                     // yanık
  }
  function cookLabel(c) {
    if (c == null) return '';
    if (c < 0.45) return 'Çiğ';
    if (c < 0.85) return 'Az pişmiş';
    if (c <= 1.2) return 'Tam kıvamında';
    if (c < 1.5) return 'Fazla pişmiş';
    return 'Yanmış';
  }
  // 0 = çiğ, 1 = ideal, 2 = yanık  (çizim için renk aşaması)
  function cookStage(c) {
    if (c == null) return 1;
    if (c < 0.45) return 0;
    if (c <= 1.2) return 1;
    return 2;
  }

  // Elde taşınan 'ing' item'ı tabağa eklenecek layer'a çevirir
  function layerFromIng(item) {
    const L = { id: item.id, q: 1 };
    if (item.id === 'kofte') {
      const a = item.cookA || 0, b = item.cookB || 0;
      L.cook = (a + b) / 2;
      L.q = Math.min(cookQuality(a), cookQuality(b));
      L.cookA = a; L.cookB = b;
    } else if (item.cook != null) {
      L.cook = item.cook;
      L.q = cookQuality(item.cook);
    }
    if (item.q != null && item.id !== 'kofte' && item.cook == null) L.q = item.q;
    return L;
  }

  function ids(item) { return (item.layers || []).map(l => l.id); }

  // Bir dish item'ın hangi tarif olduğunu tahmin eder (gerekli malzemelere göre). null olabilir.
  function identify(item) {
    if (!item) return null;
    if (item.type !== 'dish') return null;
    const have = ids(item);
    let best = null, bestScore = -1;
    for (const [rid, r] of Object.entries(D().recipes)) {
      if (r.base !== item.id) continue;
      const okReq = r.required.every(x => have.includes(x));
      if (!okReq) continue;
      const score = r.required.length * 10 - have.filter(x => !r.required.includes(x) && !r.optional.includes(x)).length;
      if (score > bestScore) { bestScore = score; best = rid; }
    }
    return best;
  }

  // Item, sipariş satırını karşılıyor mu? {ok, quality(0..1), notes:[]}
  function evaluate(item, line) {
    const notes = [];
    if (!item || !line) return { ok: false, quality: 0, notes: ['Geçersiz'] };
    if (line.type === 'product') {
      const ok = item.type === 'product' && item.id === line.id;
      return { ok, quality: ok ? 1 : 0, notes: ok ? [] : ['Yanlış ürün'] };
    }
    const r = D().recipes[line.id];
    if (!r) return { ok: false, quality: 0, notes: ['Bilinmeyen tarif'] };
    if (item.type !== 'dish' || item.id !== r.base) return { ok: false, quality: 0, notes: ['Yanlış yemek'] };
    const have = ids(item);
    for (const req of r.required) {
      if (!have.includes(req)) return { ok: false, quality: 0, notes: [nameOf(req) + ' eksik'] };
    }
    let penalty = 0;
    const want = line.want || r.defaults || [];
    for (const w of want) {
      if (!have.includes(w)) { penalty += 0.15; notes.push(nameOf(w) + ' unutulmuş'); }
    }
    const counted = {};
    for (const h of have) counted[h] = (counted[h] || 0) + 1;
    for (const h of Object.keys(counted)) {
      if (r.required.includes(h)) {
        if (counted[h] > 2) { penalty += 0.1; notes.push('Fazla ' + nameOf(h).toLowerCase()); }
        continue;
      }
      if (r.optional.includes(h)) {
        if (!want.includes(h)) { penalty += 0.25; notes.push(nameOf(h) + ' istenmemişti'); }
        else if (counted[h] > 2) { penalty += 0.05; }
      } else {
        penalty += 0.35; notes.push(nameOf(h) + ' bu yemeğe konmaz');
      }
    }
    // pişme kalitesi
    let cookQ = 1, n = 0, sum = 0;
    for (const L of item.layers) {
      if (L.cook != null || L.q != null) { sum += (L.q != null ? L.q : 1); n++; }
    }
    if (n) cookQ = sum / n;
    // en kötü pişmiş katman ağır basar
    const worst = item.layers.reduce((m, L) => Math.min(m, L.q != null ? L.q : 1), 1);
    cookQ = Math.min(cookQ, worst * 0.6 + 0.4 * cookQ);
    if (worst < 0.2) notes.push('Pişmesi berbat');
    let toastQ = 1;
    if (r.toast) {
      toastQ = cookQuality(item.toast || 0);
      if ((item.toast || 0) < 0.45) notes.push('Tost basılmamış');
      else if ((item.toast || 0) > 1.5) notes.push('Tost yanmış');
    } else if ((item.toast || 0) > 0.3) {
      toastQ = 0.85; notes.push('Neden tostlandı?');
    }
    const quality = Math.max(0, Math.min(1, cookQ * toastQ * (1 - Math.min(0.9, penalty))));
    return { ok: true, quality, notes };
  }

  function nameOf(id) {
    const d = D();
    return (d.ingredients[id] && d.ingredients[id].name) || (d.prepared[id] && d.prepared[id].name) ||
      (d.dishBases[id] && d.dishBases[id].name) || (d.products[id] && d.products[id].name) ||
      (d.recipes[id] && d.recipes[id].name) || id;
  }

  // Sipariş satırının okunur etiketi: "Köfte Ekmek (soğansız, +turşu)"
  function lineLabel(line) {
    if (!line) return '';
    if (line.type === 'product') return nameOf(line.id);
    const r = D().recipes[line.id];
    if (!r) return line.id;
    const want = line.want || r.defaults;
    const mods = [];
    for (const d of r.defaults) if (!want.includes(d)) mods.push(suffixSiz(nameOf(d)));
    for (const w of want) if (!r.defaults.includes(w)) mods.push('+' + nameOf(w).toLowerCase());
    return r.name + (mods.length ? ' (' + mods.join(', ') + ')' : '');
  }
  // "Soğan" -> "soğansız", "Domates" -> "domatessiz" (Türkçe ünlü uyumu)
  function suffixSiz(word) {
    const w = word.toLowerCase();
    const vowels = w.match(/[aeıioöuü]/g);
    const last = vowels ? vowels[vowels.length - 1] : 'e';
    const map = { a: 'sız', ı: 'sız', e: 'siz', i: 'siz', o: 'suz', u: 'suz', ö: 'süz', ü: 'süz' };
    return w + map[last];
  }
  // Satırın kısa ikonik listesi: [{id, without:bool}]
  function lineMods(line) {
    if (!line || line.type !== 'recipe') return { without: [], extra: [] };
    const r = D().recipes[line.id];
    const want = line.want || r.defaults;
    return {
      without: r.defaults.filter(d => !want.includes(d)),
      extra: want.filter(w => !r.defaults.includes(w)),
    };
  }

  // Item'ın okunur adı
  function itemName(item) {
    if (!item) return '';
    if (item.type === 'product') return nameOf(item.id);
    if (item.type === 'ing') {
      const base = nameOf(item.id);
      if (item.id === 'kofte') {
        const a = item.cookA || 0, b = item.cookB || 0;
        if (a === 0 && b === 0) return 'Çiğ Köfte (ızgaralık)';
        return 'Köfte — ' + cookLabel(Math.min(a, b) < 0.45 ? Math.min(a, b) : (a + b) / 2);
      }
      if (item.cook != null) return base + ' — ' + cookLabel(item.cook);
      return base;
    }
    if (item.type === 'dish') {
      const rid = identify(item);
      if (rid) return D().recipes[rid].name;
      return nameOf(item.id) + (item.layers.length ? ' +' + item.layers.length : '');
    }
    return '';
  }

  function itemDescribe(item) {
    if (!item) return '';
    const lines = [itemName(item)];
    if (item.type === 'dish') {
      if (item.layers.length) lines.push('İçinde: ' + item.layers.map(l => nameOf(l.id).toLowerCase() + (l.cook != null ? ' (' + cookLabel(l.cook).toLowerCase() + ')' : '')).join(', '));
      if (item.toast > 0.05) lines.push('Tost: ' + cookLabel(item.toast));
    }
    return lines.join('\n');
  }

  KS.Recipes = { cookQuality, cookLabel, cookStage, layerFromIng, identify, evaluate, lineLabel, lineMods, nameOf, itemName, itemDescribe, suffixSiz };
})(window.KS);
