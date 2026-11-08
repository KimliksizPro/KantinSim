/* KantinSim — Hazırlık İstasyonları
 * Sahibi: Hazırlık İstasyonları geliştiricisi.
 * İçerik: malzeme kutuları (bins), hazırlık tezgahı (tabaklar), çiğ köfte leğeni (yoğurma),
 *         sıcak dolap / bekleme rafı, vitrin (layer 'back'), temizlik (lavabo + bez + kir), çöp kutusu.
 * Dışa açılan API: KS.Stations.prep (dosyanın sonuna bakın).
 */
(function (KS) {
  'use strict';

  const D = () => KS.DATA;
  const U = () => KS.util;
  const Art = () => KS.Art || {};
  const RES = 2;                         // sprite önbelleği çözünürlüğü
  const MAX_LAYERS = 15;

  // ---------------------------------------------------------------------------
  // KÜÇÜK YARDIMCILAR
  // ---------------------------------------------------------------------------
  const errLogged = new Set();
  function logErr(tag, e) {
    if (errLogged.has(tag)) return;
    errLogged.add(tag);
    console.error('[prep:' + tag + ']', e);
  }
  // ctx durumunu her koşulda geri alan güvenli çizim sarmalayıcı
  function sdraw(ctx, tag, fn) {
    ctx.save();
    try { fn(); } catch (e) { logErr(tag, e); }
    ctx.restore();
  }
  function snd(name, vol) { try { if (KS.audio && KS.audio.play) KS.audio.play(name, vol != null ? { vol } : undefined); } catch (e) { /* ses yok */ } }
  function floatText(x, y, str, color, size) { try { KS.fx.floatText(x, y, str, color || '#fff', size || 20); } catch (e) { /* */ } }
  function burst(x, y, color, n, opts) { try { KS.fx.burst(x, y, color, n, opts || {}); } catch (e) { /* */ } }
  function warn(x, y, msg) { floatText(x, y, msg, '#ffb347', 19); snd('error', 0.5); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function inRect(p, r) { return !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function T(ctx, str, x, y, o) {
    o = o || {};
    const A = Art();
    if (A.text) { A.text(ctx, str, x, y, o); return; }
    ctx.save();
    ctx.font = (o.weight || 700) + ' ' + (o.size || 16) + 'px "Nunito", sans-serif';
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.baseline || 'middle';
    if (o.stroke) { ctx.lineWidth = o.strokeWidth || 3; ctx.strokeStyle = o.stroke; ctx.strokeText(str, x, y); }
    ctx.fillStyle = o.color || '#fff'; ctx.fillText(str, x, y);
    ctx.restore();
  }
  const mctx = (function () { try { return document.createElement('canvas').getContext('2d'); } catch (e) { return null; } })();
  // Metni maxW'ye sığacak punto
  function fitSize(str, maxW, size, weight, min) {
    if (!mctx) return size;
    mctx.font = (weight || 700) + ' ' + size + 'px "Nunito", "Baloo 2", sans-serif';
    const w = mctx.measureText(str).width * 1.06;
    if (w <= maxW) return size;
    return Math.max(min || 8, Math.floor(size * maxW / w * 10) / 10);
  }

  function hexToRgb(h) {
    h = String(h || '#888').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * clamp(t, 0, 1))).join(',') + ')';
  }
  function shade(hex, amt) { return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#000000', -amt); }
  function rgba(hex, a) { const c = hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // Gradyan önbelleği (koordinatlar sabit olduğu için ana ctx'te tekrar kullanılabilir)
  const GC = new Map();
  function lin(ctx, key, x0, y0, x1, y1, stops) {
    let g = GC.get(key);
    if (!g) {
      g = ctx.createLinearGradient(x0, y0, x1, y1);
      for (const s of stops) g.addColorStop(s[0], s[1]);
      GC.set(key, g);
    }
    return g;
  }
  function rad(ctx, key, x0, y0, r0, x1, y1, r1, stops) {
    let g = GC.get(key);
    if (!g) {
      g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
      for (const s of stops) g.addColorStop(s[0], s[1]);
      GC.set(key, g);
    }
    return g;
  }
  // Offscreen sprite önbelleği
  const SC = new Map();
  function sprite(key, w, h, fn) {
    let c = SC.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w * RES)); c.height = Math.max(1, Math.ceil(h * RES));
      const g = c.getContext('2d');
      g.scale(RES, RES);
      g.save();
      try { fn(g, w, h); } catch (e) { logErr('sprite:' + key.split(':')[0], e); }
      g.restore();
      SC.set(key, c);
      if (SC.size > 400) SC.delete(SC.keys().next().value);
    }
    return c;
  }
  function blit(ctx, key, x, y, w, h, fn) { ctx.drawImage(sprite(key, w, h, fn), x, y, w, h); }

  function bumpScale(t0, amp) {
    if (!t0) return 1;
    const e = (KS.time || 0) - t0;
    if (e < 0 || e > 0.32) return 1;
    return 1 + (amp || 0.12) * Math.sin(e / 0.32 * Math.PI) * (1 - e / 0.32);
  }
  function canInteract() { try { return KS.inputEnabled(); } catch (e) { return false; } }
  function hovering(r) { return !KS.held && canInteract() && KS.pointer && KS.pointer.inside !== false && inRect(KS.pointer, r); }
  function heldItem() { return KS.held && KS.held.item; }
  function nameOf(id) { try { return KS.Recipes.nameOf(id); } catch (e) { return id; } }

  // ---------------------------------------------------------------------------
  // DURUM
  // ---------------------------------------------------------------------------
  const DIRT_SPOTS = [
    // servis tezgahı (y 352–422) — 'counter' katmanında çizilir
    { x: 452, y: 362, r: 15, type: 'stain', seed: 11 },
    { x: 905, y: 398, r: 13, type: 'sauce', seed: 23 },
    { x: 640, y: 366, r: 18, type: 'crumbs', seed: 37 },
    { x: 1182, y: 393, r: 17, type: 'oil', seed: 41 },
    { x: 1455, y: 364, r: 14, type: 'stain', seed: 53 },
    // çalışma alanı boşlukları ve hazırlık tezgahı — 'stations' katmanında
    { x: 786, y: 870, r: 15, type: 'crumbs', seed: 67 },
    { x: 589, y: 522, r: 12, type: 'sauce', seed: 71 },
    { x: 380, y: 866, r: 14, type: 'stain', seed: 83 },
    { x: 812, y: 566, r: 13, type: 'oil', seed: 97 },
    { x: 700, y: 638, r: 13, type: 'crumbs', seed: 101 },
  ];
  // kirlilik eşikleri: cleanliness < T[k] iken k. leke görünür
  const DIRT_T = [85, 72, 62, 53, 45, 37, 29, 21, 13, 6];
  const DIRT_ORDER0 = [0, 5, 2, 7, 1, 9, 3, 6, 4, 8];

  const S = {
    plates: [null, null, null], plateBump: [0, 0, 0], lastPlate: 0,
    hold: [null, null, null, null], holdBump: [0, 0, 0, 0], holdLast: 0, holdPickedT: 0,
    yog: null,
    bezHome: true,
    dirtOrder: DIRT_ORDER0.slice(),
    lastWipe: null, wipeSnd: 0, wipeFx: 0, lastVisible: 0,
    copLid: 0, copKick: 0,
    binBump: {}, vitBump: {}, lowWarned: {},
    wash: 0,
  };
  function freshYog() { return { bulgur: false, isot: false, salca: false, progress: 0, portions: 0, q: 1, squish: 0, phase: 0, lastDrag: null, kneadSnd: 0, flash: 0, bump: 0 }; }
  S.yog = freshYog();

  function reset() {
    S.plates = [null, null, null];
    S.hold = [null, null, null, null];
    S.yog = freshYog();
    S.bezHome = true;
    S.dirtOrder = DIRT_ORDER0.slice();
    S.lowWarned = {};
    S.lastWipe = null;
    S.copLid = 0; S.copKick = 0; S.wash = 0;
    if (KS.held && KS.held.item && KS.held.item.type === 'tool' && KS.held.item.id === 'bez') KS.held = null;
    S.lastVisible = visibleDirtCount();
  }

  const nPlates = () => clamp(Math.round(KS.upgVal('tezgah', 'plates') || 2), 1, 3);
  const nHold = () => clamp(Math.round(KS.upgVal('bekleme', 'slots') || 2), 1, 4);
  const keepWarm = () => !!KS.upgVal('bekleme', 'keepWarm');
  const ckUnlocked = () => { try { return !!KS.isRecipeUnlocked('cigkofte_durum'); } catch (e) { return false; } };

  // ---------------------------------------------------------------------------
  // MALİYET / ÇÖP
  // ---------------------------------------------------------------------------
  function ingCost(id) {
    const d = D();
    if (d.ingredients[id]) return d.ingredients[id].cost || 0;
    if (id === 'cigkofte') {
      const raw = ['bulgur', 'isot', 'salca'].reduce((a, k) => a + ((d.ingredients[k] && d.ingredients[k].cost) || 0), 0);
      return raw / Math.max(1, KS.upgVal('yogurma', 'batch') || 8);
    }
    if (id === 'cay') {
      const c = (d.ingredients.cay_yapragi && d.ingredients.cay_yapragi.cost) || 0;
      return c / Math.max(1, KS.upgVal('semaver', 'glasses') || 10);
    }
    return 0;
  }
  function itemCost(item) {
    if (!item) return 0;
    const d = D();
    if (item.type === 'product') return (d.products[item.id] && d.products[item.id].buy) || 0;
    if (item.type === 'ing') return ingCost(item.id);
    if (item.type === 'dish') {
      let c = ingCost(item.id);
      for (const L of item.layers || []) c += ingCost(L.id);
      return c;
    }
    return 0;
  }
  function trash(item) {
    if (!item || item.type === 'tool') return false;
    const L = KS.layout.cop;
    const cost = Math.round(itemCost(item) * 10) / 10;
    const t = KS.state.today;
    if (t) t.wasted = (t.wasted || 0) + cost;
    KS.addDirt(0.3);
    snd('trash');
    S.copKick = 1;
    try { KS.bus.emit('itemTrashed', item); } catch (e) { /* */ }
    const cx = L.x + L.w / 2;
    if (cost > 0) floatText(cx, L.y + 30, '−' + U().fmtMoney(cost) + ' israf', '#ff9b8a', 19);
    burst(cx, L.y + 50, '#8a8f96', 8, { speed: 0.4, up: 160, size: 0.7 });
    return true;
  }

  // ---------------------------------------------------------------------------
  // 1) MALZEME KUTULARI
  // ---------------------------------------------------------------------------
  const BIN_SHORT = { hamburger_ekmegi: 'Hamburger Ek.', nar_eksisi: 'Nar Ekşisi', tost_ekmegi: 'Tost Ekmeği' };
  function binRect(i) {
    const L = KS.layout.bins, cols = L.cols || 4, rows = L.rows || 5;
    const cw = L.w / cols, ch = L.h / rows, c = i % cols, r = Math.floor(i / cols);
    return { x: L.x + c * cw + 4, y: L.y + r * ch + 4, w: cw - 8, h: ch - 8 };
  }
  function binAt(pt) {
    const order = D().binOrder;
    for (let i = 0; i < order.length; i++) if (inRect(pt, binRect(i))) return order[i];
    return null;
  }
  function binIndex(id) { return D().binOrder.indexOf(id); }
  function makeIng(id) {
    if (id === 'kofte') return KS.items.ing('kofte', { cookA: 0, cookB: 0 });
    return KS.items.ing(id);
  }
  function isReturnableIng(item) {
    return !!item && item.type === 'ing' && D().binOrder.includes(item.id) && item.cook == null &&
      !((item.cookA || 0) > 0.02 || (item.cookB || 0) > 0.02);
  }
  // Malzeme sadece kilitli tariflerde kullanılıyorsa açıldığı seviye
  function ingUnlockLevel(id) {
    let min = Infinity;
    for (const r of Object.values(D().recipes)) {
      if (r.base === id || r.required.includes(id) || r.optional.includes(id)) min = Math.min(min, r.unlock);
    }
    return min === Infinity ? 1 : min;
  }
  function binHint(id) {
    if (id === 'kofte') return 'Izgarada iki yüzünü pişir';
    if (id === 'patates') return 'Fritözde kızart';
    const ing = D().ingredients[id];
    if (ing && ing.kind === 'base') return 'Tezgahtaki boş tabağa koy';
    if (ing && ing.kind === 'sauce') return 'Tabaktaki yemeğe ekle';
    return 'Tabaktaki ekmeğe ekle';
  }

  function drawBinPan(g, id, w, h, icons, lvl) {
    const ing = D().ingredients[id] || { color: '#ccc' };
    // dış kenar (gastronom küvet)
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 5; g.shadowOffsetY = 2;
    rr(g, 1, 1, w - 2, h - 4, 9);
    let gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#f7f9fb'); gr.addColorStop(0.45, '#c9d0d7'); gr.addColorStop(1, '#8d97a1');
    g.fillStyle = gr; g.fill();
    g.restore();
    rr(g, 1.5, 1.5, w - 3, h - 5, 9); g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1; g.stroke();
    // iç hazne
    const ix = 6, iy = 6, iw = w - 12, ih = h - 15;
    rr(g, ix, iy, iw, ih, 6);
    gr = g.createLinearGradient(0, iy, 0, iy + ih);
    gr.addColorStop(0, '#56606b'); gr.addColorStop(0.5, '#8893a0'); gr.addColorStop(1, '#bcc5cd');
    g.fillStyle = gr; g.fill();
    g.save();
    rr(g, ix, iy, iw, ih, 6); g.clip();
    gr = g.createLinearGradient(0, iy, 0, iy + 10);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(ix, iy, iw, 10);
    // malzeme yığını
    if (lvl > 0) {
      const mh = 3 + lvl * 3.4;
      const my = iy + ih + 2;
      const mg = g.createRadialGradient(w / 2 - 8, my - mh, 2, w / 2, my, iw / 1.6);
      mg.addColorStop(0, shade(ing.color, 0.25)); mg.addColorStop(0.6, ing.color); mg.addColorStop(1, shade(ing.color, -0.45));
      g.fillStyle = mg;
      g.beginPath(); g.ellipse(w / 2, my, iw / 2 - 1, mh + 2, 0, Math.PI, 0); g.fill();
      // tanecikler
      const R = rng(binIndex(id) * 31 + lvl);
      for (let k = 0; k < 10 + lvl * 3; k++) {
        const a = Math.PI + R() * Math.PI, rr2 = R();
        const px = w / 2 + Math.cos(a) * (iw / 2 - 4) * rr2, py = my + Math.sin(a) * (mh + 1) * rr2;
        g.fillStyle = R() < 0.5 ? rgba(shade(ing.color, 0.35), 0.8) : rgba(shade(ing.color, -0.35), 0.7);
        g.beginPath(); g.arc(px, py, 1 + R() * 1.6, 0, Math.PI * 2); g.fill();
      }
    } else {
      // boş: birkaç kırıntı
      const R = rng(binIndex(id) * 7 + 3);
      for (let k = 0; k < 5; k++) {
        g.fillStyle = rgba(ing.color, 0.55);
        g.beginPath(); g.arc(ix + 6 + R() * (iw - 12), iy + ih - 5 - R() * 8, 1 + R() * 1.4, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    // ikonlar
    const A = Art();
    if (icons > 0 && A.drawIngredient) {
      const cx = w / 2, cy = iy + ih / 2 + 3;
      const pos = icons >= 3 ? [[-15, 5, 28], [15, 5, 28], [0, -3, 30]] : icons === 2 ? [[-11, 3, 31], [11, 1, 31]] : [[0, 3, 33]];
      const ck = ing.kind === 'cookable' ? { cook: 0, cookA: 0, cookB: 0 } : {};
      for (const p of pos) {
        g.save();
        try { A.drawIngredient(g, id, cx + p[0], cy + p[1], p[2], ck); } catch (e) { logErr('drawIngredient', e); }
        g.restore();
      }
    }
    // parlama
    g.save();
    rr(g, 1, 1, w - 2, h - 4, 9); g.clip();
    gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.35, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.restore();
  }

  function drawBins(ctx) {
    const L = KS.layout.bins, A = Art(), order = D().binOrder, t = KS.time || 0;
    // raf gövdesi
    if (A.metalPanel) A.metalPanel(ctx, L, { radius: 14, tone: 'dark' });
    else { ctx.fillStyle = '#5a636d'; rr(ctx, L.x, L.y, L.w, L.h, 14); ctx.fill(); }
    ctx.fillStyle = lin(ctx, 'bins_in', 0, L.y, 0, L.y + L.h, [[0, 'rgba(10,14,20,0.35)'], [1, 'rgba(10,14,20,0.15)']]);
    rr(ctx, L.x + 3, L.y + 3, L.w - 6, L.h - 6, 12); ctx.fill();
    const lvl = KS.state.level || 1;
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      sdraw(ctx, 'bin', () => {
        const r = binRect(i), ing = D().ingredients[id]; if (!ing) return;
        const n = KS.inv.get(id), empty = n <= 0;
        const ref = Math.max(ing.pack || 10, 10);
        const fill = clamp(n / ref, 0, 1);
        const icons = empty ? 0 : fill < 0.34 ? 1 : fill < 0.67 ? 2 : 3;
        const lv = empty ? 0 : Math.max(1, Math.ceil(fill * 4));
        const hov = hovering(r);
        const b = bumpScale(S.binBump[id], 0.1);
        // hücre gölgesi
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(ctx, r.x + 1, r.y + 3, r.w, r.h, 10); ctx.fill();
        ctx.save();
        if (hov || b !== 1) {
          ctx.translate(r.x + r.w / 2, r.y + r.h / 2 - (hov ? 2 : 0));
          ctx.scale(b, b);
          ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
        }
        if (empty) ctx.globalAlpha = 0.5;
        blit(ctx, 'bin:' + id + ':' + icons + ':' + lv, r.x, r.y, r.w, 60, (g, w, h) => drawBinPan(g, id, w, h, icons, lv));
        ctx.globalAlpha = 1;
        // isim şeridi
        const ly = r.y + 61, lh = r.h - 62;
        ctx.fillStyle = hov ? 'rgba(46,58,72,0.95)' : 'rgba(26,32,40,0.88)';
        rr(ctx, r.x + 1, ly, r.w - 2, lh, 6); ctx.fill();
        const label = BIN_SHORT[id] || ing.name;
        const fs = fitSize(label, r.w - 8, 12, 800, 8);
        T(ctx, label, r.x + r.w / 2, ly + lh / 2 + 0.5, { size: fs, weight: 800, align: 'center', color: empty ? '#9aa3ad' : '#f3f1ea' });
        // stok rozeti
        const low = n > 0 && n <= 3;
        const s = String(n), bw = 12 + s.length * 6.5;
        const bx = r.x + r.w - bw - 3, by = r.y + 3;
        ctx.fillStyle = empty ? '#c0392b' : low ? '#ff8c1a' : 'rgba(30,38,48,0.85)';
        rr(ctx, bx, by, bw, 15, 7.5); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        T(ctx, s, bx + bw / 2, by + 8, { size: 11, weight: 800, align: 'center', color: '#fff' });
        if (hov && !empty) {
          ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 2;
          rr(ctx, r.x, r.y, r.w, r.h, 10); ctx.stroke();
        }
        ctx.restore();
        // az stok uyarısı
        if (low) {
          const p = 0.5 + 0.5 * Math.sin(t * 5 + i);
          ctx.strokeStyle = 'rgba(255,140,26,' + (0.45 + 0.4 * p) + ')'; ctx.lineWidth = 2.5;
          rr(ctx, r.x - 1, r.y - 1, r.w + 2, r.h + 2, 11); ctx.stroke();
        }
        // bitti / kilit damgası
        if (empty) {
          const ul = ingUnlockLevel(id);
          const txt = ul > lvl ? 'Seviye ' + ul : 'Bitti';
          ctx.save();
          ctx.translate(r.x + r.w / 2, r.y + 31); ctx.rotate(-0.18);
          const col = ul > lvl ? '#5a6a7e' : '#d63a2a';
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          rr(ctx, -30, -10, 60, 20, 5); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
          T(ctx, txt, 0, 1, { size: ul > lvl ? 11 : 13, weight: 900, align: 'center', color: col });
          ctx.restore();
        }
      });
    }
  }

  function binsTooltip(pt) {
    const id = binAt(pt); if (!id) return null;
    const ing = D().ingredients[id], n = KS.inv.get(id);
    const lines = [ing.name, 'Stok: ' + n + ' porsiyon'];
    if (n <= 0) {
      const ul = ingUnlockLevel(id);
      if (ul > (KS.state.level || 1)) lines.push('Seviye ' + ul + ' tarifi için gerekli');
      lines.push('Bitti! Toptancıdan sipariş et (acil: Bakkal)');
    } else {
      if (n <= 3) lines.push('⚠ Az kaldı — Toptancıdan sipariş et');
      lines.push(binHint(id));
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // 2) HAZIRLIK TEZGAHI (tabaklar)
  // ---------------------------------------------------------------------------
  function plateSlot(i) {
    const L = KS.layout.tezgah, n = nPlates(), sw = L.w / n;
    return { x: L.x + i * sw, y: L.y, w: sw, h: L.h };
  }
  function plateZoneRect(i) { const s = plateSlot(i); return { x: s.x + 6, y: s.y + 26, w: s.w - 12, h: s.h - 30 }; }
  function plateGeom(i) {
    const s = plateSlot(i);
    const bx = s.x + 10, by = s.y + 30, bw = s.w - 20, bh = 172;
    const rx = Math.round(Math.min(bw / 2 - 10, 86)), ry = Math.round(rx * 0.6);
    const cx = s.x + s.w / 2, cy = by + 88;
    return { s, bx, by, bw, bh, cx, cy, rx, ry, scale: clamp(rx / 72, 0.7, 1.2), ly: s.y + 222 };
  }
  function freePlate(except) {
    const n = nPlates();
    for (let i = 0; i < n; i++) if (i !== except && !S.plates[i]) return i;
    return -1;
  }
  // Bırakma kontrolü: {ok, msg, redirect}
  function plateCheck(i, item, allowRedirect) {
    const d = D();
    if (!item || item.type === 'tool') return { ok: false, msg: '' };
    if (i >= nPlates()) return { ok: false, msg: '' };
    if (item.type === 'product') return { ok: false, msg: 'Hazır ürünü doğrudan müşteriye ver' };
    const p = S.plates[i];
    const ing = item.type === 'ing' ? d.ingredients[item.id] : null;
    const rawPotato = item.type === 'ing' && item.id === 'patates' && !((item.cook || 0) >= 0.45);
    if (!p) {
      if (item.type === 'dish') return { ok: true };
      if (item.type === 'ing') {
        if (ing && ing.kind === 'base') return { ok: true };
        if (rawPotato) return { ok: false, msg: 'Çiğ patates önce fritöze!' };
        if (item.id === 'cigkofte') return { ok: false, msg: 'Önce tabağa lavaş koy' };
        return { ok: false, msg: 'Önce tabağa ekmek koy' };
      }
      return { ok: false, msg: '' };
    }
    if (item.type === 'dish') {
      if (allowRedirect) { const j = freePlate(i); if (j >= 0) return { ok: true, redirect: j }; }
      return { ok: false, msg: 'Bu tabak dolu' };
    }
    if (item.type !== 'ing') return { ok: false, msg: '' };
    if (p.id === 'bardak') return { ok: false, msg: 'Bardağa yiyecek konmaz!' };
    if ((p.layers || []).length >= MAX_LAYERS) return { ok: false, msg: 'Tabak taşıyor!' };
    if (ing && ing.kind === 'base') return { ok: false, msg: 'Ekmek üstüne ekmek olmaz' };
    if (rawPotato) return { ok: false, msg: 'Çiğ patates önce fritöze!' };
    if (ing && ing.kind === 'raw') return { ok: false, msg: 'Bu hammadde tabağa konmaz' };
    if (p.id === 'kese' && !(ing && ing.kind === 'sauce')) return { ok: false, msg: 'Keseye sadece tuz ve sos eklenir' };
    if (item.id === 'cigkofte' || (ing && (ing.kind === 'topping' || ing.kind === 'sauce' || ing.kind === 'cookable'))) return { ok: true };
    return { ok: false, msg: 'Bu tabağa eklenemez' };
  }
  function dropOnPlate(i, item) {
    const res = plateCheck(i, item, true);
    const g0 = plateGeom(i);
    if (!res.ok) { if (res.msg) warn(g0.cx, g0.cy - 40, res.msg); return false; }
    if (res.redirect != null) i = res.redirect;
    const g = plateGeom(i);
    const p = S.plates[i];
    if (!p) {
      S.plates[i] = item.type === 'dish' ? item : KS.items.dish(item.id);
      snd('plate');
    } else {
      const layer = KS.Recipes.layerFromIng(item);
      p.layers.push(layer);
      const ing = D().ingredients[item.id];
      if (ing && ing.kind === 'sauce') snd(item.id === 'tuz' || item.id === 'pul_biber' ? 'sprinkle' : 'squeeze');
      else snd('plate');
      const col = (ing && ing.color) || (D().prepared[item.id] && D().prepared[item.id].color) || '#ddd';
      burst(g.cx, g.cy - 14, col, 6, { speed: 0.35, up: 90, size: 0.6, gravity: 300 });
      if (item.id === 'kofte' && Math.max(item.cookA || 0, item.cookB || 0) < 0.45) warn(g.cx, g.cy - 46, 'Köfte çiğ!');
    }
    S.plateBump[i] = KS.time;
    return true;
  }
  function placeDishBack(item, pref) {
    if (!item) return;
    if (pref != null && pref < nPlates() && !S.plates[pref]) { S.plates[pref] = item; return; }
    const j = freePlate(-1);
    if (j >= 0) { S.plates[j] = item; return; }
    if (putInHold(item)) return;
    console.warn('[prep] tabak geri konamadı', item);
  }
  function putOnPlate(dish) {
    if (!dish || dish.type !== 'dish') return false;
    const j = freePlate(-1); if (j < 0) return false;
    S.plates[j] = dish; S.plateBump[j] = KS.time; return true;
  }

  function drawBoard(g, w, h) {
    const A = Art();
    const r = { x: 4, y: 3, w: w - 8, h: h - 9 };
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 7; g.shadowOffsetY = 3;
    rr(g, r.x, r.y, r.w, r.h, 14); g.fillStyle = '#9b6a3c'; g.fill();
    g.restore();
    if (A.woodPanel) { g.save(); A.woodPanel(g, r, { radius: 14, tone: 'light' }); g.restore(); }
    // damar
    g.save(); rr(g, r.x, r.y, r.w, r.h, 14); g.clip();
    let gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    gr.addColorStop(0, 'rgba(255,230,190,0.28)'); gr.addColorStop(1, 'rgba(90,50,20,0.18)');
    g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h);
    const R = rng(Math.round(w * 13));
    g.strokeStyle = 'rgba(110,62,26,0.22)'; g.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      const yy = r.y + 8 + R() * (r.h - 16);
      g.beginPath(); g.moveTo(r.x, yy);
      g.bezierCurveTo(r.x + r.w * 0.3, yy + (R() - 0.5) * 8, r.x + r.w * 0.7, yy + (R() - 0.5) * 8, r.x + r.w, yy + (R() - 0.5) * 4);
      g.stroke();
    }
    // bıçak izleri
    g.strokeStyle = 'rgba(255,240,215,0.25)';
    for (let k = 0; k < 6; k++) {
      const x0 = r.x + 12 + R() * (r.w - 40), y0 = r.y + 14 + R() * (r.h - 30);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + 14 + R() * 18, y0 + (R() - 0.5) * 10); g.stroke();
    }
    g.restore();
    rr(g, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 14); g.strokeStyle = 'rgba(70,38,14,0.55)'; g.lineWidth = 1.5; g.stroke();
    // tutma deliği
    g.fillStyle = 'rgba(40,22,10,0.75)';
    rr(g, r.x + r.w - 26, r.y + 9, 16, 8, 4); g.fill();
    g.strokeStyle = 'rgba(255,230,190,0.3)'; g.lineWidth = 1; g.stroke();
  }
  function drawPlateSprite(g, w, h, rx, ry) {
    const cx = w / 2, cy = ry + 6;
    // gölge
    g.save();
    g.fillStyle = 'rgba(30,18,8,0.35)'; g.filter = 'blur(3px)';
    g.beginPath(); g.ellipse(cx + 2, cy + 6, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    // kenar
    let gr = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.4, 2, cx, cy, rx);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#f1f3f6'); gr.addColorStop(1, '#cfd5dc');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(80,90,105,0.35)'; g.lineWidth = 1.2; g.stroke();
    // süs çizgisi
    g.strokeStyle = 'rgba(60,110,180,0.55)'; g.lineWidth = 1.6;
    g.beginPath(); g.ellipse(cx, cy, rx * 0.92, ry * 0.92, 0, 0, Math.PI * 2); g.stroke();
    // iç çukur
    gr = g.createLinearGradient(0, cy - ry * 0.7, 0, cy + ry * 0.7);
    gr.addColorStop(0, '#dde2e8'); gr.addColorStop(0.5, '#f6f7f9'); gr.addColorStop(1, '#ffffff');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy + 1, rx * 0.7, ry * 0.68, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,130,145,0.25)'; g.lineWidth = 1; g.stroke();
    // parlama
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.ellipse(cx, cy, rx * 0.84, ry * 0.8, 0, Math.PI * 1.08, Math.PI * 1.42); g.stroke();
  }

  function drawTezgah(ctx) {
    const L = KS.layout.tezgah, A = Art(), n = nPlates();
    if (A.metalPanel) A.metalPanel(ctx, L, { radius: 14 });
    else { ctx.fillStyle = '#9aa3ad'; rr(ctx, L.x, L.y, L.w, L.h, 14); ctx.fill(); }
    // fırçalanmış çelik dokusu
    ctx.fillStyle = lin(ctx, 'tz_sheen', L.x, L.y, L.x + L.w, L.y + L.h, [[0, 'rgba(255,255,255,0.12)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.08)']]);
    rr(ctx, L.x, L.y, L.w, L.h, 14); ctx.fill();
    for (let i = 0; i < n; i++) sdraw(ctx, 'plate', () => drawPlateSlot(ctx, i));
    if (A.stationLabel) A.stationLabel(ctx, L, KS.upgVal('tezgah', 'name') || 'Hazırlık Tezgahı');
  }
  function drawPlateSlot(ctx, i) {
    const g = plateGeom(i), p = S.plates[i], A = Art();
    const bwR = Math.round(g.bw);
    blit(ctx, 'board:' + bwR + ':' + g.bh, g.bx - 4, g.by - 3, bwR + 8, g.bh + 9, (gg, w, h) => drawBoard(gg, w, h));
    const pw = (g.rx + 10) * 2, ph = (g.ry + 10) * 2;
    blit(ctx, 'plate:' + g.rx, g.cx - pw / 2, g.cy - g.ry - 6, pw, ph, (gg, w, h) => drawPlateSprite(gg, w, h, g.rx, g.ry));
    const zr = plateZoneRect(i);
    const hov = hovering(zr) && p;
    if (p) {
      const b = bumpScale(S.plateBump[i], 0.14);
      if (hov) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx + 4, g.ry + 4, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save();
      try { if (A.drawItem) A.drawItem(ctx, p, g.cx, g.cy - 6 - (hov ? 3 : 0), g.scale * b); } catch (e) { logErr('drawItem:plate', e); }
      ctx.restore();
      // tost gerekiyor ipucu
      let rid = null; try { rid = KS.Recipes.identify(p); } catch (e) { rid = null; }
      const r = rid && D().recipes[rid];
      if (r && r.toast && !((p.toast || 0) >= 0.45)) {
        const tx = g.bx + g.bw - 8, ty = g.by + 8;
        const lbl = '→ Tost';
        ctx.fillStyle = 'rgba(230,110,20,0.92)'; rr(ctx, tx - 52, ty, 52, 18, 9); ctx.fill();
        T(ctx, lbl, tx - 26, ty + 9.5, { size: 11, weight: 800, align: 'center', color: '#fff' });
      }
      // isim etiketi
      const label = r ? r.name : '?';
      const maxW = g.s.w - 20;
      const fs = fitSize(label, maxW - 16, 14, 800, 9);
      mctx && (mctx.font = '800 ' + fs + 'px "Nunito", sans-serif');
      const tw = Math.min(maxW, (mctx ? mctx.measureText(label).width * 1.06 : label.length * fs * 0.55) + 22);
      ctx.fillStyle = r ? 'rgba(36,120,72,0.95)' : 'rgba(70,76,88,0.92)';
      rr(ctx, g.cx - tw / 2, g.ly - 11, tw, 22, 11); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();
      T(ctx, label, g.cx, g.ly + 0.5, { size: fs, weight: 800, align: 'center', color: '#fff' });
    } else {
      T(ctx, 'Boş tabak', g.cx, g.ly, { size: 12, weight: 700, align: 'center', color: 'rgba(40,46,56,0.45)' });
    }
  }
  function plateTooltip(i) {
    const p = S.plates[i];
    if (!p) return 'Boş tabak\nTost ekmeği, yarım ekmek, lavaş veya\nhamburger ekmeği koyarak başla';
    let s = '';
    try { s = KS.Recipes.itemDescribe(p); } catch (e) { s = 'Tabak'; }
    let rid = null; try { rid = KS.Recipes.identify(p); } catch (e) { /* */ }
    const r = rid && D().recipes[rid];
    if (r && r.toast && !((p.toast || 0) >= 0.45)) s += '\nTost makinesine götür';
    else if (!rid) s += '\nTanınan bir tarif değil';
    s += '\nSürükle: müşteriye / makineye / çöpe';
    return s;
  }

  // ---------------------------------------------------------------------------
  // 3) ÇİĞ KÖFTE LEĞENİ
  // ---------------------------------------------------------------------------
  const RAW = ['bulgur', 'isot', 'salca'];
  const RAW_LABEL = { bulgur: 'Bulgur', isot: 'İsot', salca: 'Salça' };
  const RAW_COLOR = { bulgur: '#d3ac68', isot: '#8a2414', salca: '#c22e1c' };
  function basin() {
    const L = KS.layout.yogurma;
    return { cx: L.x + 84, cy: L.y + 118, rx: 72, ry: 24, depth: 44 };
  }
  function yogMainRect() { const L = KS.layout.yogurma; return { x: L.x + 4, y: L.y + 28, w: 162, h: L.h - 32 }; }
  function packetRect(k) { const L = KS.layout.yogurma; return { x: L.x + 170, y: L.y + 16 + k * 59, w: 44, h: 54 }; }
  function progressRect() { const L = KS.layout.yogurma; return { x: L.x + 12, y: L.y + 178, w: 150, h: 13 }; }
  const allAdded = () => S.yog.bulgur && S.yog.isot && S.yog.salca;
  const anyAdded = () => S.yog.bulgur || S.yog.isot || S.yog.salca;

  function addRaw(id) {
    const y = S.yog, pr = packetRect(RAW.indexOf(id));
    const px = pr.x + pr.w / 2, py = pr.y;
    if (!ckUnlocked()) { warn(px, py, 'Seviye 3\'te açılır'); return; }
    if (y.portions > 0) { warn(px - 60, py + 20, 'Önce leğendekini bitir'); return; }
    if (y[id]) { floatText(px - 20, py, 'Zaten eklendi', '#ffe08a', 16); return; }
    if (!KS.inv.take(id, 1)) {
      snd('error');
      warn(px - 30, py + 10, RAW_LABEL[id] + ' yok!');
      KS.notify((D().ingredients[id] ? D().ingredients[id].name : id) + ' kalmadı! Toptancıdan sipariş et.', 'warn');
      return;
    }
    y[id] = true;
    y.bump = KS.time;
    snd(id === 'bulgur' ? 'pour' : id === 'salca' ? 'squeeze' : 'sprinkle');
    const b = basin();
    burst(b.cx, b.cy - 6, RAW_COLOR[id], 10, { speed: 0.35, up: 120, size: 0.6, gravity: 420 });
    if (allAdded()) floatText(b.cx, b.cy - 50, 'Yoğur!', '#ffd23f', 24);
  }
  function kneadAdd(amount) {
    const y = S.yog;
    if (y.portions > 0 || !allAdded() || !ckUnlocked()) return;
    const eff = Math.max(0.05, KS.upgVal('yogurma', 'effort') || 1);
    y.progress = clamp(y.progress + amount / eff, 0, 1);
    y.squish = 1;
    y.phase += amount / eff * 40;
    const now = KS.time || 0;
    if (now - y.kneadSnd > 0.22) { snd('knead'); y.kneadSnd = now; }
    if (y.progress >= 1) finishKnead();
  }
  function finishKnead() {
    const y = S.yog, b = basin();
    y.portions = Math.max(1, Math.round(KS.upgVal('yogurma', 'batch') || 8));
    y.q = 1; y.progress = 1; y.flash = 1;
    snd('ready');
    burst(b.cx, b.cy - 10, '#ffd23f', 16, { speed: 0.6, up: 160, size: 0.7 });
    floatText(b.cx, b.cy - 56, 'Çiğ köfte hazır! ×' + y.portions, '#7dff9a', 20);
    KS.addDirt(0.5);
  }
  function takeCigkofte() {
    const y = S.yog;
    if (y.portions <= 0) return null;
    y.portions--;
    const it = KS.items.ing('cigkofte', { q: y.q != null ? y.q : 1 });
    if (y.portions <= 0) { const keep = y.squish; S.yog = freshYog(); S.yog.squish = keep; }
    return it;
  }
  function returnCigkofte(item) {
    const y = S.yog;
    if (y.portions <= 0) { S.yog = freshYog(); S.yog.bulgur = S.yog.isot = S.yog.salca = true; S.yog.progress = 1; }
    S.yog.portions++;
    if (item && item.q != null) S.yog.q = Math.min(S.yog.q, item.q);
  }

  function drawPadlock(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.strokeStyle = '#d9dde3'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -8, 11, Math.PI, 0); ctx.lineTo(11, 0); ctx.moveTo(-11, 0); ctx.lineTo(-11, -8); ctx.stroke();
    const gr = ctx.createLinearGradient(0, -2, 0, 24);
    gr.addColorStop(0, '#ffd34d'); gr.addColorStop(1, '#c58a12');
    ctx.fillStyle = gr; rr(ctx, -17, -2, 34, 26, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#5a3d06'; ctx.beginPath(); ctx.arc(0, 9, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-1.5, 9, 3, 8);
    ctx.restore();
  }

  function drawPacket(ctx, k, id) {
    const r = packetRect(k), y = S.yog, added = y[id], stock = KS.inv.get(id);
    const hov = hovering(r) && ckUnlocked();
    const lift = hov ? -2 : 0;
    ctx.save();
    ctx.translate(0, lift);
    if (added) ctx.globalAlpha = 0.45;
    else if (stock <= 0) ctx.globalAlpha = 0.6;
    const col = RAW_COLOR[id];
    blit(ctx, 'packet:' + id, r.x - 3, r.y - 2, r.w + 6, r.h + 6, (g, w, h) => {
      // kraft kese kağıdı
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 4; g.shadowOffsetY = 2;
      g.beginPath();
      g.moveTo(7, 10); g.lineTo(w - 7, 10); g.lineTo(w - 4, h - 6); g.lineTo(4, h - 6); g.closePath();
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, '#b88a55'); gr.addColorStop(0.45, '#e2bf8c'); gr.addColorStop(1, '#a87a46');
      g.fillStyle = gr; g.fill();
      g.restore();
      // kıvrık ağız
      g.fillStyle = '#c9a06b';
      g.beginPath(); g.moveTo(6, 11); g.lineTo(9, 3); g.lineTo(w / 2, 6); g.lineTo(w - 9, 3); g.lineTo(w - 6, 11); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(90,60,30,0.45)'; g.lineWidth = 1; g.stroke();
      // renkli etiket
      const lg = g.createLinearGradient(0, h * 0.42, 0, h * 0.78);
      lg.addColorStop(0, shade(col, 0.15)); lg.addColorStop(1, shade(col, -0.25));
      g.fillStyle = lg; rr(g, 6, h * 0.42, w - 12, h * 0.34, 3); g.fill();
      // içerik görünümü (üstte taşan)
      g.fillStyle = col;
      g.beginPath(); g.ellipse(w / 2, 10, w / 2 - 10, 3.5, 0, 0, Math.PI * 2); g.fill();
    });
    T(ctx, RAW_LABEL[id], r.x + r.w / 2, r.y + r.h * 0.6 + 1, { size: 10, weight: 900, align: 'center', color: '#fff', stroke: 'rgba(0,0,0,0.35)', strokeWidth: 2 });
    ctx.globalAlpha = 1;
    if (added) {
      ctx.fillStyle = '#2fae5a'; ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + 20, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(r.x + r.w / 2 - 5, r.y + 20); ctx.lineTo(r.x + r.w / 2 - 1, r.y + 24); ctx.lineTo(r.x + r.w / 2 + 6, r.y + 15); ctx.stroke();
    } else {
      // stok rozeti
      const s = String(stock), bw = 10 + s.length * 6;
      ctx.fillStyle = stock <= 0 ? '#c0392b' : 'rgba(30,38,48,0.9)';
      rr(ctx, r.x + r.w - bw + 2, r.y - 2, bw, 14, 7); ctx.fill();
      T(ctx, s, r.x + r.w - bw / 2 + 2, r.y + 5, { size: 10, weight: 800, align: 'center', color: '#fff' });
      if (allAdded() === false && ckUnlocked() && y.portions <= 0 && stock > 0) {
        const p = 0.5 + 0.5 * Math.sin((KS.time || 0) * 4 + k);
        ctx.strokeStyle = 'rgba(255,220,120,' + (0.25 + 0.4 * p) + ')'; ctx.lineWidth = 2;
        rr(ctx, r.x + 1, r.y + 6, r.w - 2, r.h - 10, 6); ctx.stroke();
      }
    }
    ctx.restore();
  }

  const BOWL_TONES = [
    ['#5f6873', '#aeb6bf', '#eef2f5', '#98a1aa', '#545c66'],   // alüminyum
    ['#6b3013', '#c46d39', '#f2b07a', '#b35b28', '#5c2810'],   // bakır
    ['#56606b', '#b8c2cc', '#f4f7fa', '#a3adb7', '#4c5560'],   // makine çeliği
  ];
  function drawBowlBody(ctx, b, lv) {
    const tone = BOWL_TONES[clamp(lv, 0, 2)];
    ctx.beginPath();
    ctx.moveTo(b.cx - b.rx, b.cy);
    ctx.bezierCurveTo(b.cx - b.rx, b.cy + b.depth * 0.9, b.cx - b.rx * 0.55, b.cy + b.depth, b.cx, b.cy + b.depth);
    ctx.bezierCurveTo(b.cx + b.rx * 0.55, b.cy + b.depth, b.cx + b.rx, b.cy + b.depth * 0.9, b.cx + b.rx, b.cy);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 'bowl_body' + lv, b.cx - b.rx, 0, b.cx + b.rx, 0, tone.map((c, i) => [i / (tone.length - 1), c]));
    ctx.fill();
    // dövme bakır benekleri
    if (lv === 1) {
      const R = rng(5);
      ctx.fillStyle = 'rgba(255,220,180,0.18)';
      for (let k = 0; k < 18; k++) {
        const a = R(), d = R();
        ctx.beginPath(); ctx.arc(b.cx + (a - 0.5) * b.rx * 1.6, b.cy + 8 + d * (b.depth - 14), 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // dış kenar
    ctx.fillStyle = lin(ctx, 'bowl_rim' + lv, b.cx - b.rx, 0, b.cx + b.rx, 0, [[0, tone[0]], [0.35, tone[2]], [0.7, tone[1]], [1, tone[4]]]);
    ctx.beginPath(); ctx.ellipse(b.cx, b.cy, b.rx, b.ry, 0, 0, Math.PI * 2); ctx.fill();
    // iç
    ctx.fillStyle = lin(ctx, 'bowl_in' + lv, 0, b.cy - b.ry, 0, b.cy + b.ry, [[0, shade(tone[0], -0.35)], [0.6, tone[1]], [1, tone[2]]]);
    ctx.beginPath(); ctx.ellipse(b.cx, b.cy + 1, b.rx - 6, b.ry - 4, 0, 0, Math.PI * 2); ctx.fill();
  }
  function drawBowlContents(ctx, b) {
    const y = S.yog, t = KS.time || 0;
    ctx.save();
    // ön ağızla kırp, yukarı taşmaya izin ver
    ctx.beginPath();
    ctx.ellipse(b.cx, b.cy + 1, b.rx - 6, b.ry - 4, 0, 0, Math.PI);
    ctx.lineTo(b.cx - b.rx + 6, b.cy - 50); ctx.lineTo(b.cx + b.rx - 6, b.cy - 50); ctx.closePath();
    ctx.clip();
    if (y.portions > 0) {
      // parmak şeklinde sıkılmış çiğ köfteler
      const n = Math.min(y.portions, 10);
      const rows = [[], []];
      for (let k = 0; k < n; k++) rows[k < 5 ? 0 : 1].push(k);
      const drawFinger = (x, yy, rot) => {
        ctx.save(); ctx.translate(x, yy); ctx.rotate(rot);
        const gr = ctx.createRadialGradient(-3, -2, 1, 0, 0, 12);
        gr.addColorStop(0, '#b8432a'); gr.addColorStop(0.7, '#8c2a1a'); gr.addColorStop(1, '#5e170c');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(0, 0, 12, 5.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(40,8,4,0.55)'; ctx.lineWidth = 1;
        for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.moveTo(j * 4, -4.5); ctx.quadraticCurveTo(j * 4 + 1.5, 0, j * 4, 4.5); ctx.stroke(); }
        ctx.fillStyle = 'rgba(255,200,170,0.35)'; ctx.beginPath(); ctx.ellipse(-3, -2.2, 5, 1.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };
      rows[0].forEach((k, j) => drawFinger(b.cx - 40 + j * 20, b.cy - 3, -0.25 + (j % 2) * 0.4));
      rows[1].forEach((k, j) => drawFinger(b.cx - 36 + j * 18, b.cy + 8, 0.2 - (j % 2) * 0.4));
    } else if (allAdded() && y.progress > 0) {
      const p = y.progress, sq = y.squish;
      const col = mix('#cfa868', '#8c2a1a', p * p * (3 - 2 * p));
      const mrx = 46 * (1 + 0.12 * sq), mry = (12 + 6 * Math.min(1, p * 2)) * (1 - 0.25 * sq);
      const my = b.cy + 4 - mry * 0.35;
      const gr = ctx.createRadialGradient(b.cx - 14, my - mry * 0.6, 2, b.cx, my, mrx);
      gr.addColorStop(0, shade(col, 0.28)); gr.addColorStop(0.6, col); gr.addColorStop(1, shade(col, -0.4));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(b.cx, my, mrx, mry, 0, 0, Math.PI * 2); ctx.fill();
      // yoğurma kıvrımları
      ctx.strokeStyle = rgba('#3a0a04', 0.25 + 0.2 * p); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (let k = 0; k < 4; k++) {
        const a = y.phase * 0.15 + k * 1.6;
        const ox = Math.cos(a) * mrx * 0.45, oy = Math.sin(a) * mry * 0.35;
        ctx.beginPath(); ctx.ellipse(b.cx + ox, my + oy, mrx * 0.28, mry * 0.3, a * 0.3, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
      }
      // karışmamış tanecikler
      const R = rng(19);
      for (let k = 0; k < 26; k++) {
        const px = b.cx + (R() - 0.5) * mrx * 1.7, py = my + (R() - 0.5) * mry * 1.4, c = R();
        ctx.fillStyle = c < 0.5 ? rgba('#ecd29a', 0.8 * (1 - p)) : rgba('#5a1208', 0.7 * (1 - p * 0.6));
        ctx.beginPath(); ctx.arc(px, py, 1.3, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      if (y.bulgur) {
        const gr = ctx.createRadialGradient(b.cx - 22, b.cy - 6, 2, b.cx - 12, b.cy + 2, 40);
        gr.addColorStop(0, '#f0d79f'); gr.addColorStop(0.7, '#d6b273'); gr.addColorStop(1, '#a8834a');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(b.cx - 12, b.cy + 2, 38, 12, 0, 0, Math.PI * 2); ctx.fill();
        const R = rng(7);
        for (let k = 0; k < 40; k++) {
          ctx.fillStyle = R() < 0.5 ? '#b98f4f' : '#f2dcab';
          ctx.beginPath(); ctx.arc(b.cx - 12 + (R() - 0.5) * 66, b.cy + 2 + (R() - 0.5) * 18, 0.9, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (y.salca) {
        const gr = ctx.createRadialGradient(b.cx + 18, b.cy - 3, 1, b.cx + 22, b.cy, 18);
        gr.addColorStop(0, '#f0634a'); gr.addColorStop(0.6, '#b52a1b'); gr.addColorStop(1, '#7a170c');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(b.cx + 22, b.cy, 17, 7, -0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(b.cx + 17, b.cy - 3, 5, 1.6, -0.2, 0, Math.PI * 2); ctx.fill();
      }
      if (y.isot) {
        const R = rng(13);
        for (let k = 0; k < 26; k++) {
          ctx.save();
          ctx.translate(b.cx - 4 + (R() - 0.5) * 70, b.cy + 1 + (R() - 0.5) * 16);
          ctx.rotate(R() * Math.PI);
          ctx.fillStyle = R() < 0.5 ? '#6e1a0e' : '#a3301a';
          ctx.fillRect(-1.8, -1, 3.6, 2);
          ctx.restore();
        }
      }
      if (!anyAdded()) {
        // boş leğen parlaması
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.ellipse(b.cx - 10, b.cy + 4, 34, 7, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    // ön ağız parlaması
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(b.cx, b.cy, b.rx - 2.5, b.ry - 1.5, 0, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke();
    if (y.flash > 0) {
      ctx.fillStyle = 'rgba(255,240,170,' + (y.flash * 0.45) + ')';
      ctx.beginPath(); ctx.ellipse(b.cx, b.cy, b.rx + 6, b.ry + 10, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawMixer(ctx, b, front) {
    // Seviye 3 yoğurma makinesi: arkada kolon + kafa, önde spiral kanca
    const L = KS.layout.yogurma, y = S.yog;
    const spin = (KS.time || 0) * (y.squish > 0.05 ? 14 : 0) + y.phase * 0.2;
    if (!front) {
      ctx.fillStyle = lin(ctx, 'mix_col', L.x + 8, 0, L.x + 24, 0, [[0, '#6c7680'], [0.5, '#e6ebef'], [1, '#7d8791']]);
      rr(ctx, L.x + 8, L.y + 36, 16, b.cy + b.depth - L.y - 30, 4); ctx.fill();
      ctx.fillStyle = lin(ctx, 'mix_arm', 0, L.y + 34, 0, L.y + 58, [[0, '#f2f5f8'], [1, '#8d97a1']]);
      rr(ctx, L.x + 8, L.y + 34, b.cx - L.x + 18, 24, 9); ctx.fill();
      ctx.fillStyle = '#d63a2a'; ctx.beginPath(); ctx.arc(L.x + 30, L.y + 46, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = y.squish > 0.05 ? '#5fe07a' : '#2e5e3a'; ctx.beginPath(); ctx.arc(L.x + 42, L.y + 46, 3.5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = '#c9d0d7'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.cx, L.y + 58);
      for (let k = 0; k <= 14; k++) {
        const yy = L.y + 58 + k * ((b.cy - 2) - (L.y + 58)) / 14;
        ctx.lineTo(b.cx + Math.sin(spin + k * 0.9) * 6, yy);
      }
      ctx.stroke();
    }
  }

  function drawYogurma(ctx) {
    const L = KS.layout.yogurma, A = Art(), y = S.yog, lv = KS.upg('yogurma'), t = KS.time || 0;
    const locked = !ckUnlocked();
    if (A.woodPanel) A.woodPanel(ctx, L, { radius: 14 });
    else { ctx.fillStyle = '#a0703f'; rr(ctx, L.x, L.y, L.w, L.h, 14); ctx.fill(); }
    // sağdaki paket rafı
    ctx.fillStyle = 'rgba(40,22,10,0.25)'; rr(ctx, L.x + 166, L.y + 8, 52, L.h - 16, 10); ctx.fill();
    const b = basin();
    // gölge
    ctx.fillStyle = 'rgba(30,15,5,0.35)';
    ctx.beginPath(); ctx.ellipse(b.cx + 3, b.cy + b.depth + 2, b.rx * 0.8, 8, 0, 0, Math.PI * 2); ctx.fill();
    if (lv >= 2) drawMixer(ctx, b, false);
    const sx = 1 + 0.03 * y.squish, sy = 1 - 0.04 * y.squish;
    ctx.save();
    ctx.translate(b.cx, b.cy + b.depth); ctx.scale(sx, sy); ctx.translate(-b.cx, -(b.cy + b.depth));
    drawBowlBody(ctx, b, lv);
    drawBowlContents(ctx, b);
    ctx.restore();
    if (lv >= 2) drawMixer(ctx, b, true);
    // paketler
    RAW.forEach((id, k) => sdraw(ctx, 'packet', () => drawPacket(ctx, k, id)));
    // durum yazısı + ilerleme
    const pr = progressRect();
    ctx.fillStyle = 'rgba(30,18,10,0.6)'; rr(ctx, pr.x, pr.y, pr.w, pr.h, 6.5); ctx.fill();
    let status = '', scol = '#fff';
    if (!locked) {
      if (y.portions > 0) {
        ctx.fillStyle = lin(ctx, 'yog_done', pr.x, 0, pr.x + pr.w, 0, [[0, '#2fae5a'], [1, '#6be08a']]);
        rr(ctx, pr.x + 1.5, pr.y + 1.5, pr.w - 3, pr.h - 3, 5); ctx.fill();
        T(ctx, y.portions + ' porsiyon hazır', pr.x + pr.w / 2, pr.y + pr.h / 2 + 0.5, { size: 10, weight: 900, align: 'center', color: '#fff', stroke: 'rgba(0,0,0,0.3)', strokeWidth: 2 });
        status = 'Sürükle → lavaşa'; scol = '#bfffd0';
      } else if (allAdded()) {
        const w = (pr.w - 3) * y.progress;
        if (w > 1) {
          ctx.fillStyle = mix('#d3ac68', '#a32a16', y.progress);
          rr(ctx, pr.x + 1.5, pr.y + 1.5, Math.max(10, w), pr.h - 3, 5); ctx.fill();
        }
        T(ctx, '%' + Math.round(y.progress * 100), pr.x + pr.w / 2, pr.y + pr.h / 2 + 0.5, { size: 10, weight: 900, align: 'center', color: '#fff', stroke: 'rgba(0,0,0,0.35)', strokeWidth: 2 });
        status = 'YOĞUR!'; scol = '#ffd23f';
      } else {
        const have = RAW.filter(k => y[k]).length;
        T(ctx, have + '/3 malzeme', pr.x + pr.w / 2, pr.y + pr.h / 2 + 0.5, { size: 10, weight: 800, align: 'center', color: '#f3e6d0' });
        status = 'Malzeme ekle →'; scol = '#ffe9c2';
      }
    }
    if (status) {
      const pulse = status === 'YOĞUR!' ? 1 + 0.08 * Math.sin(t * 7) : 1;
      ctx.save(); ctx.translate(b.cx, L.y + 46); ctx.scale(pulse, pulse);
      T(ctx, status, 0, 0, { size: status === 'YOĞUR!' ? 19 : 13, weight: 900, align: 'center', color: scol, stroke: 'rgba(40,20,8,0.75)', strokeWidth: 4 });
      ctx.restore();
    }
    if (A.stationLabel) A.stationLabel(ctx, L, KS.upgVal('yogurma', 'name') || 'Çiğ Köfte Leğeni');
    if (locked) {
      ctx.fillStyle = 'rgba(16,12,20,0.62)'; rr(ctx, L.x, L.y, L.w, L.h, 14); ctx.fill();
      drawPadlock(ctx, L.x + L.w / 2, L.y + L.h / 2 - 22, 1.2);
      T(ctx, 'Seviye 3', L.x + L.w / 2, L.y + L.h / 2 + 26, { size: 20, weight: 900, align: 'center', color: '#ffd34d', stroke: 'rgba(0,0,0,0.5)', strokeWidth: 3 });
      T(ctx, 'Çiğ Köfte Dürüm', L.x + L.w / 2, L.y + L.h / 2 + 48, { size: 13, weight: 700, align: 'center', color: '#e6e1ee' });
    }
  }
  function yogTooltip() {
    if (!ckUnlocked()) return 'Çiğ Köfte Leğeni\nSeviye 3\'te açılır (Çiğ Köfte Dürüm)';
    const y = S.yog;
    if (y.portions > 0) return 'Çiğ köfte: ' + y.portions + ' porsiyon\nSürükleyip tabaktaki lavaşa koy\nGün sonunda kalanlar bozulur!';
    if (!allAdded()) {
      const miss = RAW.filter(k => !y[k]).map(k => RAW_LABEL[k].toLowerCase());
      return 'Çiğ Köfte Leğeni\nEksik: ' + miss.join(', ') + '\nSağdaki paketlere tıkla';
    }
    return 'Yoğur! (%' + Math.round(y.progress * 100) + ')\nBasılı tutup sürükle ya da hızlı tıkla';
  }

  // ---------------------------------------------------------------------------
  // 4) SICAK DOLAP / BEKLEME
  // ---------------------------------------------------------------------------
  function holdInner() { const L = KS.layout.bekleme; return { x: L.x + 10, y: L.y + 28, w: L.w - 20, h: L.h - 36 }; }
  function holdSlot(i) {
    const n = nHold(), inner = holdInner();
    const rows = n > 2 ? 2 : 1, cols = n === 1 ? 1 : 2;
    const cw = inner.w / cols, ch = inner.h / rows, c = i % cols, r = Math.floor(i / cols);
    return { x: inner.x + c * cw, y: inner.y + r * ch, w: cw, h: ch };
  }
  function freeHold() { const n = nHold(); for (let i = 0; i < n; i++) if (!S.hold[i]) return i; return -1; }
  function putInHold(item, pref, t0) {
    if (!item || item.type === 'tool') return false;
    let j = (pref != null && pref < nHold() && !S.hold[pref]) ? pref : freeHold();
    if (j < 0) return false;
    S.hold[j] = { item, t: t0 || 0 };
    S.holdBump[j] = KS.time;
    return true;
  }
  function warmable(item) {
    if (!item || item.type !== 'dish') return false;
    if ((item.toast || 0) > 0.3) return true;
    return (item.layers || []).some(L => L.cook != null || L.id === 'cay' || L.id === 'patates');
  }
  function isCold(e) { return !!e && !keepWarm() && e.t > 15 && warmable(e.item); }
  function updateHold(dt) {
    if (!(dt > 0)) return;
    const warm = keepWarm(), n = nHold();
    for (let i = 0; i < n; i++) {
      const e = S.hold[i]; if (!e) continue;
      e.t += dt;
      if (warm || e.t <= 15 || !warmable(e.item)) continue;
      const it = e.item, toasted = (it.toast || 0) > 0.3;
      for (const L of it.layers || []) {
        if (toasted || L.cook != null || L.id === 'cay' || L.id === 'patates') {
          L.q = Math.max(0.05, (L.q != null ? L.q : 1) - 0.004 * dt);
        }
      }
    }
  }

  function drawBekleme(ctx) {
    const L = KS.layout.bekleme, A = Art(), n = nHold(), warm = keepWarm(), t = KS.time || 0;
    if (A.metalPanel) A.metalPanel(ctx, L, { radius: 14 });
    else { ctx.fillStyle = '#9aa3ad'; rr(ctx, L.x, L.y, L.w, L.h, 14); ctx.fill(); }
    const inner = holdInner();
    rr(ctx, inner.x, inner.y, inner.w, inner.h, 10);
    ctx.fillStyle = warm
      ? lin(ctx, 'hold_warm', 0, inner.y, 0, inner.y + inner.h, [[0, '#6a3214'], [0.5, '#45210f'], [1, '#2c160b']])
      : lin(ctx, 'hold_cold', 0, inner.y, 0, inner.y + inner.h, [[0, '#4a525c'], [1, '#2a3038']]);
    ctx.fill();
    ctx.save();
    rr(ctx, inner.x, inner.y, inner.w, inner.h, 10); ctx.clip();
    if (warm) {
      // ısı lambaları
      const p = 0.75 + 0.25 * Math.sin(t * 3);
      ctx.globalAlpha = p;
      ctx.fillStyle = rad(ctx, 'hold_glow', inner.x + inner.w / 2, inner.y, 4, inner.x + inner.w / 2, inner.y, inner.w * 0.75,
        [[0, 'rgba(255,170,60,0.7)'], [0.5, 'rgba(255,120,30,0.25)'], [1, 'rgba(255,90,20,0)']]);
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      ctx.globalAlpha = 1;
      const rows = n > 2 ? 2 : 1;
      for (let r = 0; r < rows; r++) {
        const ly = inner.y + r * inner.h / rows + 4;
        ctx.fillStyle = lin(ctx, 'hold_lamp' + r, 0, ly, 0, ly + 5, [[0, '#fff2c0'], [1, '#ff8a1f']]);
        rr(ctx, inner.x + 10, ly, inner.w - 20, 5, 2.5); ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(inner.x, inner.y, inner.w, 10);
    }
    // raflar
    const rows = n > 2 ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const sy = inner.y + (r + 1) * inner.h / rows - 7;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(inner.x, sy + 3, inner.w, 4);
      ctx.fillStyle = lin(ctx, 'hold_shelf' + r + n, 0, sy, 0, sy + 4, [[0, '#e8edf1'], [1, '#8d97a1']]);
      ctx.fillRect(inner.x, sy, inner.w, 4);
      ctx.strokeStyle = 'rgba(220,226,232,0.35)'; ctx.lineWidth = 1;
      for (let k = 1; k < 8; k++) { const x = inner.x + k * inner.w / 8; ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x - 4, sy - 6); ctx.stroke(); }
    }
    // ürünler
    const sc = n > 2 ? 0.52 : 0.76;
    for (let i = 0; i < n; i++) {
      sdraw(ctx, 'holdslot', () => {
        const s = holdSlot(i), e = S.hold[i];
        const cx = s.x + s.w / 2, cy = s.y + s.h * 0.52;
        if (!e) {
          ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
          rr(ctx, s.x + 8, s.y + 12, s.w - 16, s.h - 24, 8); ctx.stroke(); ctx.setLineDash([]);
          return;
        }
        const hov = hovering(s);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(cx, s.y + s.h - 12, s.w * 0.36, 5, 0, 0, Math.PI * 2); ctx.fill();
        const b = bumpScale(S.holdBump[i], 0.14);
        try { if (A.drawItem) A.drawItem(ctx, e.item, cx, cy - (hov ? 3 : 0), sc * b); } catch (er) { logErr('drawItem:hold', er); }
        if (warm && warmable(e.item)) {
          // buhar
          ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
          for (let k = 0; k < 2; k++) {
            const ph = t * 2 + k * 2 + i;
            const x0 = cx - 8 + k * 16;
            ctx.beginPath(); ctx.moveTo(x0, cy - 18);
            ctx.bezierCurveTo(x0 + Math.sin(ph) * 6, cy - 28, x0 - Math.sin(ph) * 6, cy - 36, x0 + Math.sin(ph + 1) * 4, cy - 44);
            ctx.stroke();
          }
        }
        if (isCold(e)) {
          const tw = 62, tx = cx - tw / 2, ty = s.y + s.h - 26;
          ctx.fillStyle = 'rgba(60,140,220,0.92)'; rr(ctx, tx, ty, tw, 16, 8); ctx.fill();
          T(ctx, '❄ Soğumuş', cx, ty + 8.5, { size: 10, weight: 800, align: 'center', color: '#fff' });
        }
      });
    }
    ctx.restore();
    if (warm) {
      // cam kapaklar
      ctx.save();
      rr(ctx, inner.x, inner.y, inner.w, inner.h, 10); ctx.clip();
      ctx.fillStyle = 'rgba(200,225,255,0.06)'; ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (const ox of [20, 112]) {
        ctx.beginPath();
        ctx.moveTo(inner.x + ox, inner.y + inner.h); ctx.lineTo(inner.x + ox + 22, inner.y + inner.h);
        ctx.lineTo(inner.x + ox + 70, inner.y); ctx.lineTo(inner.x + ox + 48, inner.y); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(210,218,226,0.9)'; ctx.lineWidth = 3;
      rr(ctx, inner.x, inner.y, inner.w, inner.h, 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(inner.x + inner.w / 2, inner.y); ctx.lineTo(inner.x + inner.w / 2, inner.y + inner.h); ctx.stroke();
      ctx.fillStyle = '#e9edf1';
      rr(ctx, inner.x + inner.w / 2 - 9, inner.y + inner.h / 2 - 14, 4, 28, 2); ctx.fill();
      rr(ctx, inner.x + inner.w / 2 + 5, inner.y + inner.h / 2 - 14, 4, 28, 2); ctx.fill();
      // termometre ışığı
      ctx.fillStyle = 'rgba(255,140,30,' + (0.7 + 0.3 * Math.sin(t * 4)) + ')';
      ctx.beginPath(); ctx.arc(L.x + L.w - 14, L.y + 15, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    if (A.stationLabel) A.stationLabel(ctx, L, KS.upgVal('bekleme', 'name') || 'Bekleme Rafı');
  }
  function holdTooltip(i) {
    const e = S.hold[i];
    if (!e) return keepWarm() ? 'Boş raf (ısıtmalı)\nYemekler burada sıcak kalır' : 'Boş raf\nPişmiş yemek burada 15 sn sonra soğumaya başlar';
    let s = '';
    try { s = KS.Recipes.itemDescribe(e.item); } catch (er) { s = 'Ürün'; }
    if (isCold(e)) s += '\n❄ Soğumuş — kalitesi düşüyor';
    else if (keepWarm() && warmable(e.item)) s += '\n🔥 Sıcak tutuluyor';
    else if (warmable(e.item)) s += '\nSoğumasına ' + Math.max(0, Math.ceil(15 - e.t)) + ' sn';
    return s;
  }

  // ---------------------------------------------------------------------------
  // 5) VİTRİN (layer 'back')
  // ---------------------------------------------------------------------------
  function vitrinLayout() {
    const d = D(), L = KS.layout.vitrin;
    const hot = [], cold = [];
    for (const [id, p] of Object.entries(d.products)) {
      if (!KS.isProductUnlocked(id)) continue;
      (p.group === 'hazir' ? hot : cold).push(id);
    }
    const stocked = id => (KS.prod.get(id) > 0 ? 1 : 0);
    const sortList = list => list.map((id, i) => [id, i]).sort((a, b) => (stocked(b[0]) - stocked(a[0])) || (a[1] - b[1])).map(x => x[0]);
    const H = sortList(hot), C = sortList(cold);
    const gi = { x: L.x + 8, y: L.y + 32, w: L.w - 16, h: L.h - 32 - 58 };
    const cols = 4, sep = 8;
    // stokta olanlar için gereken satırlar; stoksuzlar yalnızca bu satırlardaki boşluklara (soluk) girer
    const rowsFor = list => { const n = list.filter(id => stocked(id)).length; return Math.max(1, Math.ceil(n / cols)); };
    const hr = rowsFor(H), cr = rowsFor(C);
    H.length = Math.min(H.length, hr * cols); C.length = Math.min(C.length, cr * cols);
    const rowH = Math.min(80, (gi.h - sep - 6) / (hr + cr));
    const cells = [];
    let y = gi.y + 3;
    const cw = (gi.w - 8) / cols;
    const addSection = (list, rows, group) => {
      for (let r = 0; r < rows; r++) {
        const items = list.slice(r * cols, (r + 1) * cols);
        const sx = gi.x + 4 + (cols - items.length) * cw / 2;
        items.forEach((id, k) => cells.push({ id, group, x: sx + k * cw, y, w: cw, h: rowH, row: r }));
        y += rowH;
      }
    };
    const hotTop = gi.y;
    addSection(H, hr, 'hazir');
    const divY = y + 1;
    y += sep;
    addSection(C, cr, 'paketli');
    return { gi, cells, rowH, hotRect: { x: gi.x, y: hotTop, w: gi.w, h: divY - hotTop }, coldRect: { x: gi.x, y: divY + sep - 2, w: gi.w, h: gi.y + gi.h - (divY + sep - 2) }, divY, hr, cr };
  }
  function vitrinCellAt(pt) {
    const v = vitrinLayout();
    for (const c of v.cells) if (inRect(pt, c)) return c;
    return null;
  }
  function drawVitrinBase(ctx) {
    const L = KS.layout.vitrin;
    const by = L.y + L.h - 58, bx = L.x + 4, bw = L.w - 8, bh = 56;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(ctx, bx + 2, by + 4, bw, bh, 8); ctx.fill();
    ctx.fillStyle = lin(ctx, 'vit_base', bx, 0, bx + bw, 0, [[0, '#7c8792'], [0.12, '#d9dfe5'], [0.5, '#b1bac3'], [0.88, '#dde3e8'], [1, '#76818c']]);
    rr(ctx, bx, by, bw, bh, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(40,48,58,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    // havalandırma ızgarası
    ctx.fillStyle = 'rgba(30,36,44,0.55)';
    for (let k = 0; k < 4; k++) rr(ctx, bx + 24, by + 12 + k * 8, bw - 120, 4, 2), ctx.fill();
    // marka plakası
    ctx.fillStyle = '#2a3340'; rr(ctx, bx + bw - 86, by + 12, 70, 20, 5); ctx.fill();
    T(ctx, 'SOĞUTMALI', bx + bw - 51, by + 22.5, { size: 9, weight: 900, align: 'center', color: '#9fd3ff' });
    // termometre
    ctx.fillStyle = '#5fe07a'; ctx.beginPath(); ctx.arc(bx + bw - 76, by + 42, 3, 0, Math.PI * 2); ctx.fill();
    T(ctx, '+4°C', bx + bw - 68, by + 42.5, { size: 9, weight: 800, color: '#20303e' });
  }
  function drawVitrin(ctx) {
    const L = KS.layout.vitrin, A = Art(), t = KS.time || 0;
    const v = vitrinLayout(), gi = v.gi;
    // gölge + gövde
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; rr(ctx, L.x + 4, L.y + 6, L.w, L.h - 50, 16); ctx.fill();
    ctx.fillStyle = lin(ctx, 'vit_frame', L.x, 0, L.x + L.w, 0, [[0, '#8f99a3'], [0.06, '#e6ebef'], [0.5, '#b7c0c8'], [0.94, '#e6ebef'], [1, '#7f8a95']]);
    rr(ctx, L.x, L.y, L.w, L.h - 52, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(40,48,58,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    // tabela
    const hs = { x: L.x + 12, y: L.y + 5, w: L.w - 24, h: 22 };
    ctx.fillStyle = lin(ctx, 'vit_sign', 0, hs.y, 0, hs.y + hs.h, [[0, '#d6402f'], [1, '#8a1a10']]);
    rr(ctx, hs.x, hs.y, hs.w, hs.h, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,180,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    for (let k = 0; k < 6; k++) {
      const on = Math.floor(t * 2 + k) % 2 === 0;
      const bx = k < 3 ? hs.x + 10 + k * 12 : hs.x + hs.w - 10 - (k - 3) * 12;
      ctx.fillStyle = on ? '#ffe9a0' : '#b9873a';
      ctx.beginPath(); ctx.arc(bx, hs.y + hs.h / 2, 3, 0, Math.PI * 2); ctx.fill();
    }
    T(ctx, 'VİTRİN', hs.x + hs.w / 2, hs.y + hs.h / 2 + 1, { size: 15, weight: 900, align: 'center', color: '#fff6e0', stroke: 'rgba(90,10,5,0.6)', strokeWidth: 3 });
    // cam iç
    ctx.save();
    rr(ctx, gi.x, gi.y, gi.w, gi.h, 9); ctx.clip();
    ctx.fillStyle = '#161a20'; ctx.fillRect(gi.x, gi.y, gi.w, gi.h);
    const hr = v.hotRect, cr = v.coldRect;
    ctx.fillStyle = lin(ctx, 'vit_hot' + Math.round(hr.h), 0, hr.y, 0, hr.y + hr.h, [[0, '#7a3d16'], [0.6, '#5a2a10'], [1, '#3e1c0b']]);
    ctx.fillRect(hr.x, hr.y, hr.w, hr.h);
    ctx.fillStyle = rad(ctx, 'vit_hotglow' + Math.round(hr.h), hr.x + hr.w / 2, hr.y, 4, hr.x + hr.w / 2, hr.y, hr.w * 0.7,
      [[0, 'rgba(255,170,70,0.45)'], [1, 'rgba(255,120,40,0)']]);
    ctx.fillRect(hr.x, hr.y, hr.w, hr.h);
    ctx.fillStyle = lin(ctx, 'vit_lamp', 0, hr.y, 0, hr.y + 4, [[0, '#fff3c8'], [1, '#ff9a3a']]);
    ctx.fillRect(hr.x + 10, hr.y + 1, hr.w - 20, 3);
    ctx.fillStyle = lin(ctx, 'vit_cold' + Math.round(cr.y), 0, cr.y, 0, cr.y + cr.h, [[0, '#1f5b80'], [1, '#0f2c42']]);
    ctx.fillRect(cr.x, cr.y, cr.w, cr.h);
    ctx.fillStyle = lin(ctx, 'vit_led' + Math.round(cr.y), 0, cr.y, 0, cr.y + 3, [[0, '#e8f6ff'], [1, '#7cc6ff']]);
    ctx.fillRect(cr.x + 10, cr.y + 1, cr.w - 20, 2.5);
    // bölüm ayıracı
    ctx.fillStyle = lin(ctx, 'vit_div' + Math.round(v.divY), 0, v.divY, 0, v.divY + 7, [[0, '#eef2f5'], [1, '#7c8792']]);
    ctx.fillRect(gi.x, v.divY, gi.w, 6);
    // raf camları
    const shelfYs = new Set(v.cells.map(c => Math.round(c.y + c.h)));
    for (const sy of shelfYs) {
      if (Math.abs(sy - v.divY) < 3) continue;
      ctx.fillStyle = 'rgba(200,230,255,0.28)'; ctx.fillRect(gi.x, sy - 3, gi.w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(gi.x, sy - 3, gi.w, 1);
    }
    // ürünler
    const held = heldItem();
    for (const c of v.cells) {
      sdraw(ctx, 'vitcell', () => {
        const stock = KS.prod.get(c.id);
        const cx = c.x + c.w / 2, cy = c.y + c.h * 0.44;
        const size = Math.min(c.h * 0.66, c.w * 0.74, 54);
        const hov = !held && canInteract() && inRect(KS.pointer, c) && stock > 0;
        if (hov) {
          ctx.fillStyle = 'rgba(255,255,255,0.16)'; rr(ctx, c.x + 2, c.y + 2, c.w - 4, c.h - 6, 8); ctx.fill();
        }
        // ürün gölgesi
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(cx, c.y + c.h - 6, size * 0.34, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        if (stock <= 0) ctx.globalAlpha = 0.28;
        const b = bumpScale(S.vitBump[c.id], 0.15);
        try { if (A.drawProduct) A.drawProduct(ctx, c.id, cx, cy - (hov ? 2 : 0), size * b); } catch (e) { logErr('drawProduct', e); }
        ctx.restore();
        // sıcak ürün buharı
        if (c.group === 'hazir' && stock > 0) {
          ctx.strokeStyle = 'rgba(255,240,220,0.18)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
          const ph = t * 1.6 + c.x * 0.1;
          ctx.beginPath(); ctx.moveTo(cx - 4, cy - size * 0.42);
          ctx.bezierCurveTo(cx + Math.sin(ph) * 5, cy - size * 0.55, cx - Math.sin(ph) * 5, cy - size * 0.65, cx + 2, cy - size * 0.78);
          ctx.stroke();
        }
        // adet rozeti
        const s = String(stock), bw = 11 + s.length * 6;
        const bx = Math.min(c.x + c.w - bw - 1, cx + size * 0.22), by = c.y + 3;
        ctx.fillStyle = stock <= 0 ? 'rgba(150,40,30,0.9)' : stock <= 3 ? '#ff8c1a' : 'rgba(20,26,34,0.85)';
        rr(ctx, bx, by, bw, 14, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        T(ctx, s, bx + bw / 2, by + 7.5, { size: 10, weight: 900, align: 'center', color: '#fff' });
        // fiyat etiketi
        const price = (KS.state.prices && KS.state.prices[c.id]) || (D().products[c.id] && D().products[c.id].price) || 0;
        const ps = Math.round(price) + '₺';
        const pw = 8 + ps.length * 5.4, px = cx - pw / 2, py = c.y + c.h - 15;
        ctx.fillStyle = stock > 0 ? '#fffbe8' : 'rgba(255,251,232,0.4)';
        rr(ctx, px, py, pw, 11, 3); ctx.fill();
        T(ctx, ps, cx, py + 6, { size: 9, weight: 900, align: 'center', color: '#7a1a10' });
      });
    }
    // cam yansıması
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(gi.x + 30, gi.y + gi.h); ctx.lineTo(gi.x + 70, gi.y + gi.h); ctx.lineTo(gi.x + 170, gi.y); ctx.lineTo(gi.x + 130, gi.y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(gi.x + 90, gi.y + gi.h); ctx.lineTo(gi.x + 102, gi.y + gi.h); ctx.lineTo(gi.x + 202, gi.y); ctx.lineTo(gi.x + 190, gi.y); ctx.closePath(); ctx.fill();
    // boş vitrin
    const anyStock = v.cells.some(c => KS.prod.get(c.id) > 0);
    if (!anyStock) {
      ctx.fillStyle = 'rgba(10,10,16,0.55)'; ctx.fillRect(gi.x, gi.y, gi.w, gi.h);
      T(ctx, 'Vitrin boş', gi.x + gi.w / 2, gi.y + gi.h / 2 - 12, { size: 22, weight: 900, align: 'center', color: '#ffe08a', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 4 });
      T(ctx, 'Telefon/Toptancı\'dan sipariş ver', gi.x + gi.w / 2, gi.y + gi.h / 2 + 14, { size: 13, weight: 700, align: 'center', color: '#f0ecf6' });
    }
    ctx.restore();
    // cam çerçeve
    ctx.strokeStyle = 'rgba(230,236,242,0.9)'; ctx.lineWidth = 2.5;
    rr(ctx, gi.x, gi.y, gi.w, gi.h, 9); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,36,44,0.5)'; ctx.lineWidth = 1;
    rr(ctx, gi.x - 1.5, gi.y - 1.5, gi.w + 3, gi.h + 3, 10); ctx.stroke();
    // sürgülü cam kapak tutamakları
    ctx.fillStyle = '#e9edf1';
    rr(ctx, gi.x + gi.w / 2 - 22, gi.y + gi.h - 9, 16, 5, 2.5); ctx.fill();
    rr(ctx, gi.x + gi.w / 2 + 6, gi.y + gi.h - 9, 16, 5, 2.5); ctx.fill();
    drawVitrinBase(ctx);
  }
  function vitrinTooltip(pt) {
    const c = vitrinCellAt(pt);
    if (!c) {
      const v = vitrinLayout();
      if (!v.cells.some(x => KS.prod.get(x.id) > 0)) return 'Vitrin boş\nTelefon/Toptancı\'dan sipariş ver';
      return null;
    }
    const p = D().products[c.id], n = KS.prod.get(c.id);
    const price = (KS.state.prices && KS.state.prices[c.id]) || p.price;
    const lines = [p.name, 'Stok: ' + n, 'Satış fiyatı: ' + U().fmtMoney(price)];
    if (n <= 0) lines.push(p.group === 'hazir' ? 'Telefonla sipariş ver' : 'Toptancıdan sipariş ver');
    else if (p.group === 'hazir') lines.push('Gün sonunda bozulur');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // 6) TEMİZLİK (lavabo + bez + gösterge + kir lekeleri)
  // ---------------------------------------------------------------------------
  function tzGeom() {
    const L = KS.layout.temizlik;
    return {
      L,
      sink: { x: L.x + 10, y: L.y + 28, w: 134, h: 98 },
      basin: { x: L.x + 18, y: L.y + 44, w: 118, h: 72 },
      tap: { x: L.x + 112, y: L.y + 30 },
      bez: { x: L.x + 152, y: L.y + 22, w: 76, h: 84 },
      gauge: { x: L.x + 10, y: L.y + 140, w: L.w - 20, h: 48 },
    };
  }
  function drawBezShape(ctx, x, y, s, hang) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const w = 52, h = hang ? 58 : 38;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(ctx, -w / 2 + 3, -h / 2 + 4, w, h, 6); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 + 4); ctx.quadraticCurveTo(0, -h / 2 - 2, w / 2, -h / 2 + 4);
    ctx.lineTo(w / 2, h / 2 - 4);
    for (let k = 0; k <= 4; k++) ctx.quadraticCurveTo(w / 2 - (k + 0.5) * w / 5, h / 2 + (k % 2 ? 3 : -2), w / 2 - (k + 1) * w / 5, h / 2 - 2);
    ctx.closePath();
    const gr = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    gr.addColorStop(0, '#e2b52c'); gr.addColorStop(0.5, '#ffd84d'); gr.addColorStop(1, '#d9a822');
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = 'rgba(140,100,10,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
    // dikiş
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#2f6fd6'; ctx.lineWidth = 1.4;
    rr(ctx, -w / 2 + 5, -h / 2 + 6, w - 10, h - 13, 4); ctx.stroke(); ctx.setLineDash([]);
    // kıvrımlar
    ctx.strokeStyle = 'rgba(160,110,10,0.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-w / 4, -h / 2 + 8); ctx.quadraticCurveTo(-w / 6, 0, -w / 4, h / 2 - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 5, -h / 2 + 8); ctx.quadraticCurveTo(w / 4, 0, w / 6, h / 2 - 6); ctx.stroke();
    // doku
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { ctx.beginPath(); ctx.arc(i * 8, j * (h / 6), 1, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function drawTemizlik(ctx) {
    const G = tzGeom(), L = G.L, A = Art(), t = KS.time || 0;
    if (A.metalPanel) A.metalPanel(ctx, L, { radius: 14 });
    else { ctx.fillStyle = '#9aa3ad'; rr(ctx, L.x, L.y, L.w, L.h, 14); ctx.fill(); }
    // fayans duvar şeridi
    ctx.save();
    rr(ctx, L.x + 6, L.y + 6, L.w - 12, 122, 10); ctx.clip();
    ctx.fillStyle = '#dfeef2'; ctx.fillRect(L.x + 6, L.y + 6, L.w - 12, 122);
    ctx.strokeStyle = 'rgba(120,160,175,0.35)'; ctx.lineWidth = 1;
    for (let x = L.x + 6; x < L.x + L.w; x += 22) { ctx.beginPath(); ctx.moveTo(x, L.y + 6); ctx.lineTo(x, L.y + 128); ctx.stroke(); }
    for (let y = L.y + 6; y < L.y + 128; y += 22) { ctx.beginPath(); ctx.moveTo(L.x + 6, y); ctx.lineTo(L.x + L.w - 6, y); ctx.stroke(); }
    ctx.restore();
    // lavabo tezgahı
    const sk = G.sink, bs = G.basin;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(ctx, sk.x + 2, sk.y + 4, sk.w, sk.h, 12); ctx.fill();
    ctx.fillStyle = lin(ctx, 'tz_sink', sk.x, sk.y, sk.x, sk.y + sk.h, [[0, '#f4f7fa'], [1, '#a9b3bd']]);
    rr(ctx, sk.x, sk.y, sk.w, sk.h, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(60,70,82,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = lin(ctx, 'tz_basin', 0, bs.y, 0, bs.y + bs.h, [[0, '#5d6772'], [0.35, '#8e99a4'], [1, '#d3dae0']]);
    rr(ctx, bs.x, bs.y, bs.w, bs.h, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    rr(ctx, bs.x + 0.5, bs.y + 0.5, bs.w - 1, bs.h - 1, 14); ctx.stroke();
    const dx = bs.x + bs.w / 2, dy = bs.y + bs.h - 18;
    ctx.fillStyle = '#4a535d'; ctx.beginPath(); ctx.ellipse(dx, dy, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a9b3bd'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dx - 6, dy); ctx.lineTo(dx + 6, dy); ctx.moveTo(dx, dy - 3); ctx.lineTo(dx, dy + 3); ctx.stroke();
    // musluk
    const tp = G.tap;
    ctx.strokeStyle = lin(ctx, 'tz_tap', tp.x - 30, 0, tp.x + 6, 0, [[0, '#8d97a1'], [0.5, '#f4f7fa'], [1, '#7d8791']]);
    ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tp.x, tp.y + 8); ctx.lineTo(tp.x, tp.y - 10);
    ctx.quadraticCurveTo(tp.x, tp.y - 20, tp.x - 12, tp.y - 20); ctx.lineTo(tp.x - 20, tp.y - 20);
    ctx.quadraticCurveTo(tp.x - 28, tp.y - 20, tp.x - 28, tp.y - 10); ctx.stroke();
    ctx.fillStyle = '#d63a2a'; rr(ctx, tp.x + 4, tp.y - 6, 12, 5, 2.5); ctx.fill();
    ctx.fillStyle = '#2f6fd6'; rr(ctx, tp.x - 16, tp.y - 6, 12, 5, 2.5); ctx.fill();
    // el yıkama animasyonu
    if (S.wash > 0) {
      const wx = tp.x - 28, a = clamp(S.wash, 0, 1);
      ctx.fillStyle = 'rgba(150,210,255,' + (0.55 * a) + ')';
      ctx.beginPath();
      ctx.moveTo(wx - 2.5, tp.y - 8);
      for (let k = 0; k <= 8; k++) ctx.lineTo(wx - 2.5 + Math.sin(t * 30 + k) * 0.8, tp.y - 8 + k * 6);
      ctx.lineTo(wx + 2.5, tp.y + 40); ctx.lineTo(wx + 2.5, tp.y - 8); ctx.closePath(); ctx.fill();
      const R = rng(Math.floor(t * 8));
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.75 * a) + ')';
        ctx.beginPath(); ctx.arc(wx + (R() - 0.5) * 50, tp.y + 36 + (R() - 0.5) * 18, 2 + R() * 3.5, 0, Math.PI * 2); ctx.fill();
      }
      // eller (köpüklü)
      ctx.fillStyle = 'rgba(241,194,125,' + a + ')';
      const hx = wx + Math.sin(t * 12) * 6;
      ctx.beginPath(); ctx.ellipse(hx - 9, tp.y + 34, 9, 6, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx + 9, tp.y + 34, 9, 6, -0.4, 0, Math.PI * 2); ctx.fill();
    }
    // sabun
    ctx.fillStyle = lin(ctx, 'tz_soap', 0, sk.y + sk.h - 30, 0, sk.y + sk.h, [[0, '#7fe08f'], [1, '#2a9c48']]);
    rr(ctx, sk.x + sk.w - 22, sk.y + sk.h - 34, 14, 26, 4); ctx.fill();
    ctx.fillStyle = '#e9edf1'; ctx.fillRect(sk.x + sk.w - 18, sk.y + sk.h - 40, 6, 7);
    // bez askısı
    const bz = G.bez;
    ctx.fillStyle = lin(ctx, 'tz_hook', 0, bz.y + 2, 0, bz.y + 8, [[0, '#f4f7fa'], [1, '#8d97a1']]);
    rr(ctx, bz.x + 6, bz.y + 2, bz.w - 12, 6, 3); ctx.fill();
    if (S.bezHome) {
      const hov = hovering(bz);
      drawBezShape(ctx, bz.x + bz.w / 2, bz.y + 40 - (hov ? 2 : 0), 1, true);
      if (hov) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; rr(ctx, bz.x + 4, bz.y + 6, bz.w - 8, bz.h - 6, 8); ctx.stroke(); }
    } else {
      ctx.strokeStyle = 'rgba(60,70,82,0.45)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      rr(ctx, bz.x + 12, bz.y + 12, bz.w - 24, bz.h - 22, 6); ctx.stroke(); ctx.setLineDash([]);
      T(ctx, 'Bez', bz.x + bz.w / 2, bz.y + bz.h / 2 + 2, { size: 12, weight: 800, align: 'center', color: 'rgba(60,70,82,0.6)' });
    }
    // gösterge
    const g = G.gauge, c = clamp(KS.state.cleanliness != null ? KS.state.cleanliness : 100, 0, 100);
    ctx.fillStyle = 'rgba(20,26,34,0.82)'; rr(ctx, g.x, g.y, g.w, g.h, 12); ctx.fill();
    const col = c >= 70 ? '#43d17a' : c >= 40 ? '#ffc93c' : '#ff5a4f';
    // parıltı ikonu
    ctx.save(); ctx.translate(g.x + 18, g.y + 24);
    const sp = 1 + (c >= 70 ? 0.1 * Math.sin(t * 4) : 0);
    ctx.scale(sp, sp);
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 3.5 : 10; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
    ctx.restore();
    T(ctx, 'Temizlik', g.x + 34, g.y + 13, { size: 12, weight: 800, color: '#e8e4f0' });
    T(ctx, '%' + Math.round(c), g.x + g.w - 10, g.y + 13, { size: 13, weight: 900, align: 'right', color: col });
    const bar = { x: g.x + 34, y: g.y + 25, w: g.w - 44, h: 13 };
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; rr(ctx, bar.x, bar.y, bar.w, bar.h, 6.5); ctx.fill();
    const fw = bar.w * c / 100;
    if (fw > 2) {
      ctx.fillStyle = lin(ctx, 'tz_bar', bar.x, 0, bar.x + bar.w, 0, [[0, '#ff5a4f'], [0.4, '#ffc93c'], [0.75, '#43d17a'], [1, '#5fe0b0']]);
      ctx.save(); rr(ctx, bar.x, bar.y, Math.max(fw, 13), bar.h, 6.5); ctx.clip();
      ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
      // köpük kabarcıkları
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let k = 0; k < 6; k++) {
        const bx = bar.x + ((k * 37 + t * 18) % Math.max(1, fw));
        ctx.beginPath(); ctx.arc(bx, bar.y + 4 + (k % 2) * 4, 2 + (k % 3), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (c < 40) {
      const p = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.strokeStyle = 'rgba(255,90,79,' + (0.4 + 0.5 * p) + ')'; ctx.lineWidth = 2;
      rr(ctx, g.x, g.y, g.w, g.h, 12); ctx.stroke();
      T(ctx, 'Kirli! Bezle sil', g.x + g.w / 2 + 14, g.y + 13, { size: 10, weight: 800, align: 'center', color: '#ffb0a8' });
    }
    if (A.stationLabel) A.stationLabel(ctx, L, 'Temizlik');
  }

  // Kir lekeleri
  function visibleDirtCount() {
    const c = KS.state ? (KS.state.cleanliness != null ? KS.state.cleanliness : 100) : 100;
    let n = 0;
    for (let k = 0; k < DIRT_T.length; k++) if (c < DIRT_T[k]) n++;
    return n;
  }
  function visibleSpots() {
    const n = visibleDirtCount(), c = KS.state.cleanliness;
    const out = [];
    for (let k = 0; k < n; k++) {
      const sp = DIRT_SPOTS[S.dirtOrder[k]];
      out.push({ spot: sp, k, alpha: clamp((DIRT_T[k] - c) / 6, 0.2, 1) });
    }
    return out;
  }
  function drawSpotSprite(g, sp, w) {
    const R = rng(sp.seed), c = w / 2, r = sp.r;
    if (sp.type === 'stain') {
      for (let k = 0; k < 3; k++) {
        g.fillStyle = 'rgba(115,80,40,' + (0.28 + R() * 0.15) + ')';
        g.beginPath(); g.ellipse(c + (R() - 0.5) * r * 0.6, c + (R() - 0.5) * r * 0.5, r * (0.55 + R() * 0.4), r * (0.4 + R() * 0.3), R() * 3, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(85,55,25,0.45)'; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(c, c, r * 0.8, r * 0.6, R(), 0.3, Math.PI * 1.7); g.stroke();
    } else if (sp.type === 'sauce') {
      g.fillStyle = 'rgba(170,32,20,0.85)';
      g.beginPath(); g.ellipse(c, c, r * 0.55, r * 0.42, R(), 0, Math.PI * 2); g.fill();
      for (let k = 0; k < 5; k++) {
        const a = R() * Math.PI * 2, d = r * (0.6 + R() * 0.4);
        g.beginPath(); g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d * 0.7, 1.2 + R() * 2.2, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(255,200,190,0.55)';
      g.beginPath(); g.ellipse(c - r * 0.2, c - r * 0.15, r * 0.18, r * 0.08, -0.4, 0, Math.PI * 2); g.fill();
    } else if (sp.type === 'crumbs') {
      for (let k = 0; k < 16; k++) {
        const a = R() * Math.PI * 2, d = r * Math.sqrt(R());
        g.fillStyle = R() < 0.5 ? 'rgba(200,150,80,0.9)' : 'rgba(150,100,50,0.9)';
        g.save(); g.translate(c + Math.cos(a) * d, c + Math.sin(a) * d * 0.7); g.rotate(R() * 3);
        const s = 1.2 + R() * 2.3;
        g.beginPath(); g.moveTo(-s, -s * 0.5); g.lineTo(s * 0.8, -s); g.lineTo(s, s * 0.6); g.lineTo(-s * 0.4, s); g.closePath(); g.fill();
        g.restore();
      }
    } else {
      // yağ
      g.fillStyle = 'rgba(214,170,60,0.32)';
      g.beginPath(); g.ellipse(c, c, r * 0.95, r * 0.6, R(), 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(214,170,60,0.25)';
      g.beginPath(); g.ellipse(c + r * 0.3, c + r * 0.2, r * 0.5, r * 0.35, R(), 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.4; g.lineCap = 'round';
      g.beginPath(); g.ellipse(c - r * 0.1, c - r * 0.05, r * 0.5, r * 0.25, -0.2, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
    }
  }
  function drawDirt(ctx, onCounter) {
    const vs = visibleSpots();
    for (const v of vs) {
      const sp = v.spot;
      if ((sp.y < 422) !== onCounter) continue;
      const w = sp.r * 2 + 10;
      ctx.globalAlpha = v.alpha;
      blit(ctx, 'dirt:' + sp.seed, sp.x - w / 2, sp.y - w / 2, w, w, (g, ww) => drawSpotSprite(g, sp, ww));
    }
    ctx.globalAlpha = 1;
  }
  function updateWipe() {
    const it = heldItem();
    if (!it || it.type !== 'tool' || !canInteract()) { S.lastWipe = null; S.lastVisible = visibleDirtCount(); return; }
    const p = KS.pointer;
    if (!p || p.inside === false) { S.lastWipe = null; return; }
    const now = KS.time || 0;
    let d = 0;
    if (S.lastWipe) d = dist(p, S.lastWipe);
    S.lastWipe = { x: p.x, y: p.y };
    const before = visibleDirtCount();
    if (d > 0.5 && d < 250) {
      const n = before;
      let hit = -1;
      for (let k = 0; k < n; k++) {
        const sp = DIRT_SPOTS[S.dirtOrder[k]];
        if (dist(p, sp) < sp.r + 14) { hit = k; break; }
      }
      if (hit >= 0) {
        // ovulan lekeyi "en son silinecek" sıraya al ki solan o olsun
        const last = n - 1;
        if (hit !== last) { const tmp = S.dirtOrder[hit]; S.dirtOrder[hit] = S.dirtOrder[last]; S.dirtOrder[last] = tmp; }
        KS.clean(d * 0.035);
        if (now - S.wipeSnd > 0.28) { snd('wipe'); S.wipeSnd = now; }
        if (now - S.wipeFx > 0.12) { burst(p.x, p.y, '#e9fbff', 2, { speed: 0.25, up: 40, gravity: 0, size: 0.5 }); S.wipeFx = now; }
      } else if (p.y >= 352) {
        KS.clean(d * 0.005);
        if (now - S.wipeSnd > 0.5 && d > 6) { snd('wipe', 0.4); S.wipeSnd = now; }
      }
    }
    const after = visibleDirtCount();
    if (after < before) {
      for (let k = after; k < before; k++) {
        const sp = DIRT_SPOTS[S.dirtOrder[k]];
        burst(sp.x, sp.y, '#bff3ff', 10, { speed: 0.45, up: 80, gravity: 60, size: 0.6 });
        floatText(sp.x, sp.y - 16, '✨', '#ffffff', 22);
      }
      snd('wipe');
    }
    S.lastVisible = after;
  }

  // ---------------------------------------------------------------------------
  // 7) ÇÖP KUTUSU
  // ---------------------------------------------------------------------------
  function copGeom() {
    const L = KS.layout.cop, cx = L.x + L.w / 2;
    return { L, cx, top: L.y + 52, bottom: L.y + 142, tw: 46, bw: 40, hingeX: cx + 50, hingeY: L.y + 50 };
  }
  function drawCop(ctx) {
    const G = copGeom(), L = G.L, A = Art(), cx = G.cx;
    if (A.metalPanel) A.metalPanel(ctx, L, { radius: 14, tone: 'dark' });
    else { ctx.fillStyle = '#5a636d'; rr(ctx, L.x, L.y, L.w, L.h, 14); ctx.fill(); }
    // zemin paspası
    ctx.fillStyle = 'rgba(20,22,26,0.55)'; rr(ctx, cx - 74, G.bottom - 6, 148, 16, 8); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(cx + 4, G.bottom + 1, 52, 6, 0, 0, Math.PI * 2); ctx.fill();
    const a = clamp(S.copLid, 0, 1);
    // gövde
    ctx.beginPath();
    ctx.moveTo(cx - G.tw, G.top); ctx.lineTo(cx + G.tw, G.top); ctx.lineTo(cx + G.bw, G.bottom); ctx.lineTo(cx - G.bw, G.bottom); ctx.closePath();
    ctx.fillStyle = lin(ctx, 'cop_body', cx - G.tw, 0, cx + G.tw, 0, [[0, '#6d7680'], [0.25, '#e9eef2'], [0.45, '#c3cbd3'], [0.8, '#9aa4ae'], [1, '#5e6670']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,36,44,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
    // kaburgalar
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    for (let k = -3; k <= 3; k++) {
      ctx.beginPath(); ctx.moveTo(cx + k * 12, G.top + 10); ctx.lineTo(cx + k * 10.5, G.bottom - 8); ctx.stroke();
    }
    // amblem: çöp kutusu simgesi
    ctx.save(); ctx.translate(cx, G.top + 46);
    ctx.fillStyle = 'rgba(40,48,58,0.55)';
    rr(ctx, -13, -14, 26, 30, 10); ctx.fill();
    ctx.strokeStyle = '#e9eef2'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(-5.5, 9); ctx.lineTo(5.5, 9); ctx.lineTo(7, -5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-9, -7); ctx.lineTo(9, -7); ctx.moveTo(-3, -10); ctx.lineTo(3, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(-2, 6); ctx.moveTo(2, -2); ctx.lineTo(2, 6); ctx.stroke();
    ctx.restore();
    // pedal
    const pd = a * 3;
    ctx.fillStyle = lin(ctx, 'cop_pedal', 0, G.bottom - 6, 0, G.bottom + 4, [[0, '#4a535d'], [1, '#22282f']]);
    rr(ctx, cx - 18, G.bottom - 7 + pd, 36, 9, 3); ctx.fill();
    // açık ağız
    if (a > 0.02) {
      ctx.fillStyle = '#121418';
      ctx.beginPath(); ctx.ellipse(cx, G.top, G.tw - 3, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2a2f36'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx, G.top + 1, G.tw - 4, 6, 0, Math.PI, Math.PI * 2); ctx.stroke();
    }
    // kapak (arkadan menteşeli)
    ctx.save();
    ctx.translate(G.hingeX, G.hingeY + 2); ctx.rotate(-a * 1.1); ctx.translate(-G.hingeX, -(G.hingeY + 2));
    ctx.beginPath();
    ctx.moveTo(cx - 50, G.top + 2); ctx.lineTo(cx - 50, G.top - 4);
    ctx.quadraticCurveTo(cx, G.top - 24, cx + 50, G.top - 4); ctx.lineTo(cx + 50, G.top + 2); ctx.closePath();
    ctx.fillStyle = lin(ctx, 'cop_lid', 0, G.top - 24, 0, G.top + 2, [[0, '#f4f7fa'], [0.6, '#b9c2ca'], [1, '#7d8791']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,36,44,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - 38, G.top - 7); ctx.quadraticCurveTo(cx - 10, G.top - 18, cx + 10, G.top - 15); ctx.stroke();
    ctx.restore();
    // israf bilgisi
    const w = (KS.state.today && KS.state.today.wasted) || 0;
    if (w > 0) T(ctx, 'İsraf: ' + U().fmtMoney(w), L.x + L.w - 12, L.y + 16, { size: 11, weight: 800, align: 'right', color: '#ffb0a0' });
    if (A.stationLabel) A.stationLabel(ctx, L, 'Çöp');
  }

  // ---------------------------------------------------------------------------
  // GÜNCELLEME
  // ---------------------------------------------------------------------------
  function update(dt, realDt) {
    const rd = Math.min(0.1, realDt || 0);
    try {
      updateHold(dt);
      if (KS.state.phase === 'open' && dt > 0) KS.addDirt(dt * 0.05);
      updateWipe();
      // animasyonlar
      const y = S.yog;
      y.squish = Math.max(0, y.squish - rd * 4);
      y.flash = Math.max(0, y.flash - rd * 1.5);
      if (S.wash > 0) S.wash = Math.max(0, S.wash - rd * 0.7);
      const h = heldItem();
      let target = (h && h.type !== 'tool' && KS.pointer && inRect(KS.pointer, KS.layout.cop)) ? 0.55 : 0;
      if (S.copKick > 0) { S.copKick = Math.max(0, S.copKick - rd * 2.4); if (S.copKick > 0.35) target = 1; }
      S.copLid += (target - S.copLid) * Math.min(1, rd * 14);
      // tezgah küçüldüyse (yeni oyun) taşan tabakları temizle
      const np = nPlates();
      for (let i = np; i < 3; i++) if (S.plates[i]) { const it = S.plates[i]; S.plates[i] = null; placeDishBack(it, null); }
      const nh = nHold();
      for (let i = nh; i < 4; i++) if (S.hold[i]) S.hold[i] = null;
    } catch (e) { logErr('update', e); }
  }

  // ---------------------------------------------------------------------------
  // ÇİZİM
  // ---------------------------------------------------------------------------
  function draw(ctx, layer) {
    if (layer === 'back') {
      sdraw(ctx, 'vitrin', () => drawVitrin(ctx));
    } else if (layer === 'counter') {
      sdraw(ctx, 'vitrinBase', () => drawVitrinBase(ctx));
      sdraw(ctx, 'dirtCounter', () => drawDirt(ctx, true));
    } else if (layer === 'stations') {
      sdraw(ctx, 'bins', () => drawBins(ctx));
      sdraw(ctx, 'yogurma', () => drawYogurma(ctx));
      sdraw(ctx, 'bekleme', () => drawBekleme(ctx));
      sdraw(ctx, 'tezgah', () => drawTezgah(ctx));
      sdraw(ctx, 'temizlik', () => drawTemizlik(ctx));
      sdraw(ctx, 'cop', () => drawCop(ctx));
      sdraw(ctx, 'dirt', () => drawDirt(ctx, false));
    }
  }

  // ---------------------------------------------------------------------------
  // BÖLGELER
  // ---------------------------------------------------------------------------
  const ZONE_IDS = [];
  function zone(z) { ZONE_IDS.push(z.id); KS.addZone(z); }
  function setupZones() {
    const Lb = () => KS.layout;
    // 1) malzeme kutuları
    zone({
      id: 'prep_bins', z: 5, noHighlight: true, getRect: () => Lb().bins,
      onPick(pt) {
        const id = binAt(pt); if (!id) return null;
        if (!KS.inv.take(id, 1)) return null;
        S.binBump[id] = KS.time;
        const n = KS.inv.get(id), nm = D().ingredients[id].name;
        if (n <= 0) KS.notify(nm + ' bitti! Toptancıdan sipariş ver (acil: Bakkal).', 'bad');
        else if (n <= 3 && !S.lowWarned[id]) { S.lowWarned[id] = true; KS.notify(nm + ' azalıyor: ' + n + ' kaldı.', 'warn'); }
        return makeIng(id);
      },
      onClick(pt) {
        const id = binAt(pt); if (!id) return;
        if (KS.inv.get(id) <= 0) {
          const r = binRect(binIndex(id));
          warn(r.x + r.w / 2, r.y + 10, D().ingredients[id].name + ' bitti!');
        }
      },
      onReturn(item) { if (item && item.type === 'ing' && D().ingredients[item.id]) KS.inv.add(item.id, 1); },
      canDrop(item) { return isReturnableIng(item); },
      onDrop(item) { KS.inv.add(item.id, 1); S.binBump[item.id] = KS.time; return true; },
      tooltip: binsTooltip,
    });
    // 2) tezgah tabakları
    for (let i = 0; i < 3; i++) {
      zone({
        id: 'prep_tezgah_' + i, z: 5,
        enabled: () => i < nPlates(),
        getRect: () => plateZoneRect(i),
        onPick() { const p = S.plates[i]; if (!p) return null; S.plates[i] = null; S.lastPlate = i; return p; },
        onReturn(item) { if (item && item.type === 'dish') placeDishBack(item, i); },
        canDrop(item, pt) {
          if (!item || item.type === 'tool' || i >= nPlates()) return false;
          if (pt) return item.type === 'ing' || item.type === 'dish' || item.type === 'product';
          return plateCheck(i, item, false).ok;
        },
        onDrop(item) { return dropOnPlate(i, item); },
        tooltip() { return plateTooltip(i); },
      });
    }
    // 3) yoğurma
    zone({
      id: 'prep_yogurma', z: 5, getRect: yogMainRect,
      onPick() {
        if (!ckUnlocked()) return null;
        return takeCigkofte();
      },
      onClick(pt) {
        const b = basin();
        if (!ckUnlocked()) { warn(b.cx, b.cy - 30, 'Seviye 3\'te açılır'); return; }
        const y = S.yog;
        if (y.portions > 0) return;
        if (!allAdded()) { floatText(b.cx, b.cy - 40, 'Önce bulgur, isot, salça!', '#ffe08a', 16); return; }
        kneadAdd(0.045);
      },
      onDrag(pt) {
        const y = S.yog;
        if (!ckUnlocked() || y.portions > 0 || !allAdded()) { y.lastDrag = null; return; }
        if (!inRect(pt, yogMainRect())) { y.lastDrag = null; return; }
        if (y.lastDrag) { const d = dist(pt, y.lastDrag); if (d < 200) kneadAdd(d / 2200); }
        y.lastDrag = { x: pt.x, y: pt.y };
      },
      onRelease() { S.yog.lastDrag = null; },
      onReturn(item) { if (item && item.id === 'cigkofte') returnCigkofte(item); },
      canDrop(item) { return !!item && item.type === 'ing' && item.id === 'cigkofte' && ckUnlocked() && (S.yog.portions > 0 || !anyAdded()); },
      onDrop(item) { returnCigkofte(item); return true; },
      tooltip: yogTooltip,
    });
    RAW.forEach((id, k) => zone({
      id: 'prep_yogurma_' + id, z: 6, getRect: () => packetRect(k),
      onClick() { addRaw(id); },
      tooltip() {
        const ing = D().ingredients[id], n = KS.inv.get(id);
        if (!ckUnlocked()) return ing.name + '\nSeviye 3\'te açılır';
        return ing.name + '\nStok: ' + n + (S.yog[id] ? '\nLeğene eklendi ✓' : '\nTıkla: leğene ekle') + (n <= 0 && !S.yog[id] ? '\nToptancıdan sipariş et' : '');
      },
    }));
    // 4) bekleme
    for (let i = 0; i < 4; i++) {
      zone({
        id: 'prep_bekleme_' + i, z: 5,
        enabled: () => i < nHold(),
        getRect: () => holdSlot(i),
        onPick() { const e = S.hold[i]; if (!e) return null; S.hold[i] = null; S.holdLast = i; S.holdPickedT = e.t; return e.item; },
        onReturn(item) { if (!putInHold(item, i, S.holdPickedT)) console.warn('[prep] bekleme dolu, item kayboldu', item); },
        canDrop(item, pt) {
          if (!item || item.type === 'tool' || i >= nHold()) return false;
          if (!pt) return !S.hold[i];
          return !S.hold[i] || freeHold() >= 0;
        },
        onDrop(item) { return putInHold(item, i, 0); },
        tooltip() { return holdTooltip(i); },
      });
    }
    // 5) vitrin
    zone({
      id: 'prep_vitrin', z: 5, noHighlight: true, getRect: () => Lb().vitrin,
      onPick(pt) {
        const c = vitrinCellAt(pt); if (!c) return null;
        if (!KS.prod.take(c.id, 1)) return null;
        S.vitBump[c.id] = KS.time;
        return KS.items.product(c.id);
      },
      onClick(pt) {
        const c = vitrinCellAt(pt);
        if (c && KS.prod.get(c.id) <= 0) warn(c.x + c.w / 2, c.y + 8, 'Stok yok!');
      },
      onReturn(item) { if (item && item.type === 'product') KS.prod.add(item.id, 1); },
      canDrop(item) { return !!item && item.type === 'product' && !!D().products[item.id]; },
      onDrop(item) { KS.prod.add(item.id, 1); S.vitBump[item.id] = KS.time; return true; },
      tooltip: vitrinTooltip,
    });
    // 6) temizlik
    zone({
      id: 'prep_bez', z: 7, getRect: () => tzGeom().bez,
      onPick() {
        if (!S.bezHome) return null;
        S.bezHome = false;
        S.lastWipe = null;
        return { uid: U().uid(), type: 'tool', id: 'bez' };
      },
      onReturn() { S.bezHome = true; },
      tooltip() { return S.bezHome ? 'Temizlik bezi\nAl ve lekelerin üzerinde gezdir' : null; },
    });
    zone({
      id: 'prep_lavabo', z: 6, getRect: () => tzGeom().sink,
      onClick() {
        if (S.wash > 0.2) return;
        S.wash = 1.6; snd('pour');
        const tp = tzGeom().tap;
        floatText(tp.x - 30, tp.y + 6, 'El yıkama', '#bfe6ff', 16);
      },
      tooltip() { return 'Lavabo\nTıkla: el yıkama'; },
    });
    zone({
      id: 'prep_temizlik', z: 5, getRect: () => Lb().temizlik,
      canDrop(item) { return !!item && item.type === 'tool' && item.id === 'bez'; },
      onDrop() { S.bezHome = true; return true; },
      tooltip() {
        const c = Math.round(KS.state.cleanliness);
        return 'Temizlik: %' + c + (c < 70 ? '\nBezi al, lekeleri sil' : '\nTezgah tertemiz') + (c < 40 ? '\n⚠ Müfettiş gelirse ceza!' : '');
      },
    });
    // 7) çöp
    zone({
      id: 'prep_cop', z: 5, getRect: () => Lb().cop,
      canDrop(item) { return !!item && item.type !== 'tool'; },
      onDrop(item) { return trash(item); },
      tooltip() {
        const w = (KS.state.today && KS.state.today.wasted) || 0;
        return 'Çöp kutusu\nYanlış/yanmış yemeği buraya at' + (w > 0 ? '\nBugünkü israf: ' + U().fmtMoney(w) : '');
      },
    });
  }

  // ---------------------------------------------------------------------------
  // OLAYLAR
  // ---------------------------------------------------------------------------
  function onDayEnd(report) {
    try {
      let dishes = 0;
      for (let i = 0; i < S.plates.length; i++) if (S.plates[i]) { dishes++; S.plates[i] = null; }
      for (let i = 0; i < S.hold.length; i++) {
        const e = S.hold[i]; if (!e) continue;
        const it = e.item;
        if (it.type === 'product' && D().products[it.id] && D().products[it.id].group === 'paketli') KS.prod.add(it.id, 1);
        else if (isReturnableIng(it)) KS.inv.add(it.id, 1);
        else dishes++;
        S.hold[i] = null;
      }
      const ck = S.yog.portions;
      S.yog = freshYog();
      if (report && typeof report === 'object') report.prepSpoiled = { dishes, cigkofte: ck };
      if (dishes || ck) {
        const parts = [];
        if (dishes) parts.push(dishes + ' tabak yemek');
        if (ck) parts.push(ck + ' porsiyon çiğ köfte');
        KS.notify('Gün sonu: ' + parts.join(' ve ') + ' bozuldu.', 'warn');
      }
    } catch (e) { logErr('dayEnd', e); }
  }

  // ---------------------------------------------------------------------------
  // KAYIT
  // ---------------------------------------------------------------------------
  KS.registerModule({
    name: 'prep',
    order: 10,
    init() {
      setupZones();
      KS.bus.on('newGame', reset);
      KS.bus.on('stateLoaded', reset);
      KS.bus.on('dayEnd', onDayEnd);
      KS.bus.on('prepStart', () => { S.lowWarned = {}; S.bezHome = S.bezHome || !(KS.held && KS.held.item && KS.held.item.type === 'tool'); });
      KS.bus.on('upgradeBought', () => { GC.clear(); });
      try {
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { SC.clear(); });
      } catch (e) { /* */ }
      S.lastVisible = visibleDirtCount();
    },
    update,
    draw,
  });

  // ---------------------------------------------------------------------------
  // DIŞA AÇILAN API
  // ---------------------------------------------------------------------------
  KS.Stations = KS.Stations || {};
  KS.Stations.prep = {
    zoneIds: ZONE_IDS,
    // geometri (eğitim okları vb. için)
    binRect(id) { const i = typeof id === 'number' ? id : binIndex(id); return i >= 0 ? binRect(i) : null; },
    plateRect: plateZoneRect,
    holdRect: holdSlot,
    vitrinCells() { return vitrinLayout().cells.map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, stock: KS.prod.get(c.id) })); },
    packetRect(id) { const k = RAW.indexOf(id); return k >= 0 ? packetRect(k) : null; },
    bezRect() { return tzGeom().bez; },
    // tezgah
    plateCount: nPlates,
    plates() { return S.plates.slice(0, nPlates()); },
    getPlate(i) { return S.plates[i] || null; },
    putOnPlate,                                   // (dish) -> bool: ilk boş tabağa koyar
    takePlate(i) { const p = S.plates[i] || null; S.plates[i] = null; return p; },
    plateCheck(i, item) { return plateCheck(i, item, false); },
    // bekleme
    holdCount: nHold,
    hold() { return S.hold.slice(0, nHold()).map(e => (e ? e.item : null)); },
    putInHold(item) { return putInHold(item, null, 0); },
    takeHold(i) { const e = S.hold[i]; S.hold[i] = null; return e ? e.item : null; },
    isCold(i) { return isCold(S.hold[i]); },
    // yoğurma
    cigkofteReady() { return S.yog.portions; },
    yogurma() { const y = S.yog; return { bulgur: y.bulgur, isot: y.isot, salca: y.salca, progress: y.progress, portions: y.portions, unlocked: ckUnlocked() }; },
    takeCigkofte,
    // temizlik
    bezHome() { return S.bezHome; },
    dirtSpots() { return visibleSpots().map(v => ({ x: v.spot.x, y: v.spot.y, r: v.spot.r, type: v.spot.type, alpha: v.alpha })); },
    drawBez(ctx, x, y, scale) { try { drawBezShape(ctx, x, y, scale || 1, false); } catch (e) { logErr('drawBez', e); } },
    // çöp / maliyet
    trash,
    itemCost,
    reset,
  };
})(window.KS);
