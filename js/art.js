/* KantinSim — Art (tamamen prosedürel canvas çizimleri, resim dosyası yok)
 * Sahibi: Art & Ses. API: CONTRACT.md "Art API".
 *
 * Mimari:
 *  - Pahalı statik katmanlar (HUD bandı, koridor duvarı, kantin çerçevesi, tezgah, çalışma yüzeyi,
 *    gökyüzü panoraması, metal/ahşap paneller) offscreen canvas'ta önbelleklenir (çözünürlüğe duyarlı).
 *  - Malzeme / ürün / ikon / tabak (dish) çizimleri sprite önbelleğine alınır (LRU).
 *  - Müşteriler, gökyüzü hareketleri (bulut, yağmur, kar), saat, tabela ampulleri, buhar her karede çizilir.
 *  - Hiçbir genel fonksiyon exception fırlatmaz (try/catch + güvenli varsayılanlar).
 */
(function (KS) {
  'use strict';
  const TAU = Math.PI * 2;
  const FONT_D = '"Baloo 2", "Nunito", system-ui, sans-serif';
  const FONT_T = '"Nunito", system-ui, sans-serif';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => (KS.time || 0);

  // ---------------------------------------------------------------------------
  // YOL / RENK / RASTGELE YARDIMCILARI
  // ---------------------------------------------------------------------------
  function rrPath(ctx, x, y, w, h, r) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); rrPath(ctx, x, y, w, h, r); }
  function ell(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU); }
  function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r), 0, TAU); }

  const _rgbCache = {};
  function rgbOf(c) {
    if (Array.isArray(c)) return c;
    const key = String(c);
    const hit = _rgbCache[key]; if (hit) return hit;
    let out = [200, 200, 200];
    if (key[0] === '#') {
      let s = key.slice(1);
      if (s.length === 3 || s.length === 4) s = s.split('').map(ch => ch + ch).join('');
      const n = parseInt(s.slice(0, 6), 16);
      if (!isNaN(n)) out = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else {
      const m = key.match(/rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(',').map(parseFloat); out = [p[0] || 0, p[1] || 0, p[2] || 0]; }
    }
    _rgbCache[key] = out;
    return out;
  }
  function hex(r, g, b) {
    const h = v => { v = Math.round(clamp(v, 0, 255)); return (v < 16 ? '0' : '') + v.toString(16); };
    return '#' + h(r) + h(g) + h(b);
  }
  // amt: -1 (siyah) .. 0 .. +1 (beyaz)
  function shade(c, amt) {
    const [r, g, b] = rgbOf(c);
    if (amt >= 0) return hex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
    return hex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
  }
  function mix(a, b, t) {
    const A = rgbOf(a), B = rgbOf(b); t = clamp(t, 0, 1);
    return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function rgba(c, a) { const [r, g, b] = rgbOf(c); return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
  // [[t, renk], ...] t sıralı
  function ramp(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        return mix(a[1], b[1], (t - a[0]) / (b[0] - a[0] || 1));
      }
    }
    return stops[stops.length - 1][1];
  }
  function lin(ctx, x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const s of stops) g.addColorStop(clamp(s[0], 0, 1), s[1]);
    return g;
  }
  function rad(ctx, x, y, r0, r1, stops, x1, y1) {
    const g = ctx.createRadialGradient(x, y, Math.max(0, r0), x1 == null ? x : x1, y1 == null ? y : y1, Math.max(0.01, r1));
    for (const s of stops) g.addColorStop(clamp(s[0], 0, 1), s[1]);
    return g;
  }
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    s = String(s); let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // deterministik [0,1) — i'nci örnek
  function h01(i, salt) { const x = Math.sin((i + 1) * 12.9898 + (salt || 0) * 78.233) * 43758.5453; return x - Math.floor(x); }

  // ---------------------------------------------------------------------------
  // ÖNBELLEK (offscreen katmanlar + sprite'lar)
  // ---------------------------------------------------------------------------
  function resOf(ctx) {
    try { const m = ctx.getTransform(); const k = Math.hypot(m.a, m.b); return k > 0 ? k : 1; } catch (e) { return 1; }
  }
  // sprite çözünürlüğü kademeli (animasyonlu ölçeklerde önbellek şişmesin)
  function qRes(k) { return k <= 1.01 ? 1 : k <= 1.5 ? 1.5 : k <= 2 ? 2 : k <= 3 ? 3 : 4; }
  // büyük katman çözünürlüğü (ekran ölçeğine yakın)
  function layerRes(ctx) { return clamp(Math.round(resOf(ctx) * 20) / 20, 0.5, 2.5); }

  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  const layers = new Map(); const LAYER_MAX = 140;
  // key için (w x h) mantıksal boyutta katman üretir / döndürür
  function layer(key, w, h, k, fn) {
    const id = key + '@' + k;
    let c = layers.get(id);
    if (c) { layers.delete(id); layers.set(id, c); return c; }
    c = newCanvas(w * k, h * k);
    const g = c.getContext('2d');
    g.scale(k, k);
    try { fn(g, w, h); } catch (e) { console.error('[Art] katman', key, e); }
    layers.set(id, c);
    while (layers.size > LAYER_MAX) layers.delete(layers.keys().next().value);
    return c;
  }
  function blit(ctx, c, x, y, w, h) { try { ctx.drawImage(c, x, y, w, h); } catch (e) { /* yok */ } }

  const sprites = new Map(); const SPRITE_MAX = 700;
  // box: mantıksal kare boyutu; fn(g) merkez (0,0) etrafında çizer
  function sprite(ctx, key, x, y, box, fn, shadow) {
    const k = qRes(resOf(ctx));
    box = Math.max(4, Math.round(box));
    const id = key + '|' + box + '|' + k + (shadow ? 's' : '');
    let c = sprites.get(id);
    if (c) { sprites.delete(id); sprites.set(id, c); }
    else {
      const px = Math.ceil(box * k);
      c = newCanvas(px, px);
      const g = c.getContext('2d');
      if (shadow) {
        const tmp = newCanvas(px, px), tg = tmp.getContext('2d');
        tg.scale(k, k); tg.translate(box / 2, box / 2);
        try { fn(tg); } catch (e) { console.error('[Art] sprite', key, e); }
        g.shadowColor = 'rgba(40,20,10,0.32)'; g.shadowBlur = Math.max(2, box * 0.05 * k); g.shadowOffsetY = box * 0.025 * k;
        g.drawImage(tmp, 0, 0);
      } else {
        g.scale(k, k); g.translate(box / 2, box / 2);
        try { fn(g); } catch (e) { console.error('[Art] sprite', key, e); }
      }
      sprites.set(id, c);
      while (sprites.size > SPRITE_MAX) sprites.delete(sprites.keys().next().value);
    }
    try { ctx.drawImage(c, x - box / 2, y - box / 2, box, box); } catch (e) { /* yok */ }
  }
  function clearCaches() { layers.clear(); sprites.clear(); }
  try {
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(clearCaches).catch(() => {});
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', clearCaches);
    }
  } catch (e) { /* yok */ }

  // gürültü dokusu (fırçalanmış metal için)
  let _brushed = null;
  function brushedTexture() {
    if (_brushed) return _brushed;
    const W = 256, H = 128, c = newCanvas(W, H), g = c.getContext('2d');
    const R = rng(77);
    for (let i = 0; i < 520; i++) {
      const y = R() * H, x = R() * W, len = 20 + R() * 120, a = 0.02 + R() * 0.06;
      g.strokeStyle = R() < 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + (a * 0.8) + ')';
      g.lineWidth = 0.6 + R() * 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (R() - 0.5) * 0.6); g.stroke();
      g.beginPath(); g.moveTo(x - W, y); g.lineTo(x - W + len, y); g.stroke();
    }
    _brushed = c;
    return c;
  }

  // ---------------------------------------------------------------------------
  // METİN
  // ---------------------------------------------------------------------------
  function fontFamily(f) {
    if (!f) return FONT_T;
    if (f === 'display' || f === 'baloo') return FONT_D;
    if (f === 'body' || f === 'nunito') return FONT_T;
    return f;
  }
  function text(ctx, str, x, y, o) {
    if (str == null) return;
    o = o || {};
    str = String(str);
    ctx.save();
    try {
      ctx.font = (o.weight || 700) + ' ' + (o.size || 18) + 'px ' + fontFamily(o.font);
      ctx.textAlign = o.align || 'left';
      ctx.textBaseline = o.baseline || 'middle';
      if (o.alpha != null) ctx.globalAlpha *= o.alpha;
      const mw = o.maxWidth;
      if (o.shadow) {
        ctx.shadowColor = o.shadow === true ? 'rgba(0,0,0,0.4)' : o.shadow;
        ctx.shadowBlur = o.shadowBlur != null ? o.shadowBlur : 4; ctx.shadowOffsetY = o.shadowY != null ? o.shadowY : 2;
      }
      if (o.stroke) {
        ctx.lineJoin = 'round'; ctx.miterLimit = 2;
        ctx.lineWidth = o.strokeWidth || 4; ctx.strokeStyle = o.stroke;
        if (mw) ctx.strokeText(str, x, y, mw); else ctx.strokeText(str, x, y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = o.color || '#fff';
      if (mw) ctx.fillText(str, x, y, mw); else ctx.fillText(str, x, y);
    } catch (e) { /* yok */ }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // PANELLER
  // ---------------------------------------------------------------------------
  const METAL_TONES = {
    light: ['#f4f6f8', '#d3d9df', '#b4bdc6', '#c9d0d7', '#e3e8ec'],
    dark:  ['#9aa4ae', '#79838e', '#5f6973', '#6f7983', '#87919b'],
    warm:  ['#f3ece2', '#d9cfc1', '#bdb1a2', '#cdc2b4', '#e2d9cd'],
    blue:  ['#e6eef6', '#c3d1de', '#a2b3c4', '#b5c4d3', '#d2dde8'],
  };
  function metalStops(tone) {
    if (typeof tone === 'number') return METAL_TONES.light.map(c => shade(c, tone));
    if (typeof tone === 'string' && tone[0] === '#') return [shade(tone, 0.45), shade(tone, 0.15), shade(tone, -0.08), shade(tone, 0.02), shade(tone, 0.28)];
    return METAL_TONES[tone] || METAL_TONES.light;
  }
  function paintMetal(g, x, y, w, h, r, tone, opts) {
    opts = opts || {};
    const st = metalStops(tone);
    // gövde
    rr(g, x, y, w, h, r);
    g.fillStyle = lin(g, x, y, x, y + h, [[0, st[0]], [0.18, st[1]], [0.55, st[2]], [0.82, st[3]], [1, st[4]]]);
    g.fill();
    g.save();
    rr(g, x, y, w, h, r); g.clip();
    // fırçalanmış doku
    try {
      const pat = g.createPattern(brushedTexture(), 'repeat');
      g.fillStyle = pat; g.globalAlpha = 0.9; g.fillRect(x, y, w, h); g.globalAlpha = 1;
    } catch (e) { /* yok */ }
    // çapraz parlama bandı
    const d = Math.max(w, h);
    g.fillStyle = lin(g, x, y, x + d * 0.9, y + d * 0.6, [[0, 'rgba(255,255,255,0)'], [0.32, 'rgba(255,255,255,0)'], [0.42, 'rgba(255,255,255,0.22)'], [0.5, 'rgba(255,255,255,0.05)'], [0.6, 'rgba(255,255,255,0.14)'], [0.7, 'rgba(255,255,255,0)']]);
    g.fillRect(x, y, w, h);
    // alt kenar gölgesi
    g.fillStyle = lin(g, 0, y + h - Math.min(18, h * 0.3), 0, y + h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.18)']]);
    g.fillRect(x, y + h - Math.min(18, h * 0.3), w, Math.min(18, h * 0.3));
    g.restore();
    // kenarlar
    g.lineWidth = 1.5;
    rr(g, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, r - 1.5));
    g.strokeStyle = lin(g, 0, y, 0, y + h, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0.05)']]);
    g.stroke();
    rr(g, x + 0.5, y + 0.5, w - 1, h - 1, r);
    g.strokeStyle = 'rgba(40,48,58,0.55)'; g.lineWidth = 1.2; g.stroke();
    if (opts.screws) {
      const s = [[x + 9, y + 9], [x + w - 9, y + 9], [x + 9, y + h - 9], [x + w - 9, y + h - 9]];
      for (const p of s) {
        circ(g, p[0], p[1], 3.2); g.fillStyle = rad(g, p[0] - 1, p[1] - 1, 0, 4, [[0, '#ffffff'], [1, '#8b949d']]); g.fill();
        g.strokeStyle = 'rgba(40,40,50,0.5)'; g.lineWidth = 0.8; g.stroke();
        g.beginPath(); g.moveTo(p[0] - 2, p[1] - 1); g.lineTo(p[0] + 2, p[1] + 1); g.stroke();
      }
    }
  }
  function metalPanel(ctx, r, o) {
    try {
      o = o || {}; if (!r) return;
      const rad_ = o.radius != null ? o.radius : 12, tone = o.tone || 'light';
      const pad = o.shadow === false ? 2 : 16;
      const w = Math.max(2, r.w), h = Math.max(2, r.h);
      const k = qRes(resOf(ctx));
      const key = 'metal|' + Math.round(w) + 'x' + Math.round(h) + '|' + rad_ + '|' + tone + '|' + (o.shadow === false ? 0 : 1) + '|' + (o.screws ? 1 : 0);
      const c = layer(key, w + pad * 2, h + pad * 2, k, (g) => {
        if (o.shadow !== false) {
          g.save();
          g.shadowColor = 'rgba(10,8,20,0.38)'; g.shadowBlur = 12; g.shadowOffsetY = 5;
          rr(g, pad, pad, w, h, rad_); g.fillStyle = '#7a838c'; g.fill();
          g.restore();
        }
        paintMetal(g, pad, pad, w, h, rad_, tone, o);
      });
      blit(ctx, c, r.x - pad, r.y - pad, w + pad * 2, h + pad * 2);
    } catch (e) { /* yok */ }
  }

  function paintWood(g, x, y, w, h, r, tone, vertical) {
    const base = typeof tone === 'string' && tone[0] === '#' ? tone : tone === 'dark' ? '#7a4a26' : tone === 'light' ? '#d6a46a' : '#b07a45';
    rr(g, x, y, w, h, r);
    g.fillStyle = lin(g, x, y, x, y + h, [[0, shade(base, 0.12)], [0.5, base], [1, shade(base, -0.12)]]);
    g.fill();
    g.save(); rr(g, x, y, w, h, r); g.clip();
    const R = rng(hashStr('wood' + Math.round(w) + 'x' + Math.round(h)));
    // tahtalar
    const plank = 34;
    const len = vertical ? w : h;
    for (let p = 0; p * plank < len + plank; p++) {
      const off = p * plank;
      const tint = (R() - 0.5) * 0.12;
      g.fillStyle = rgba(shade(base, tint), 0.55);
      if (vertical) g.fillRect(x + off, y, plank, h); else g.fillRect(x, y + off, w, plank);
      g.strokeStyle = rgba(shade(base, -0.45), 0.45); g.lineWidth = 1.2;
      g.beginPath();
      if (vertical) { g.moveTo(x + off, y); g.lineTo(x + off, y + h); } else { g.moveTo(x, y + off); g.lineTo(x + w, y + off); }
      g.stroke();
    }
    // damar çizgileri
    const n = Math.round((vertical ? w : h) / 5);
    for (let i = 0; i < n; i++) {
      const a = 0.05 + R() * 0.1;
      g.strokeStyle = R() < 0.6 ? rgba(shade(base, -0.4), a) : rgba(shade(base, 0.35), a);
      g.lineWidth = 0.6 + R() * 1.1;
      g.beginPath();
      if (vertical) {
        const xx = x + R() * w, amp = 1 + R() * 3, f = 0.01 + R() * 0.03, ph = R() * 6;
        for (let yy = 0; yy <= h; yy += 6) { const px = xx + Math.sin(yy * f + ph) * amp; if (yy === 0) g.moveTo(px, y + yy); else g.lineTo(px, y + yy); }
      } else {
        const yy0 = y + R() * h, amp = 1 + R() * 3, f = 0.01 + R() * 0.03, ph = R() * 6;
        for (let xx = 0; xx <= w; xx += 6) { const py = yy0 + Math.sin(xx * f + ph) * amp; if (xx === 0) g.moveTo(x + xx, py); else g.lineTo(x + xx, py); }
      }
      g.stroke();
    }
    // budaklar
    const knots = Math.floor(w * h / 18000) + (R() < 0.5 ? 1 : 0);
    for (let i = 0; i < knots; i++) {
      const kx = x + 10 + R() * (w - 20), ky = y + 10 + R() * (h - 20);
      for (let j = 3; j >= 0; j--) { ell(g, kx, ky, 3 + j * 3.2, 1.6 + j * 1.6, vertical ? Math.PI / 2 : 0); g.strokeStyle = rgba(shade(base, -0.45), 0.18 + 0.08 * (3 - j)); g.lineWidth = 1; g.stroke(); }
    }
    // vernik parlaklığı
    g.fillStyle = lin(g, x, y, x + w * 0.6, y + h, [[0, 'rgba(255,240,210,0.22)'], [0.4, 'rgba(255,240,210,0.04)'], [1, 'rgba(0,0,0,0.12)']]);
    g.fillRect(x, y, w, h);
    g.restore();
    rr(g, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, r - 1.5));
    g.strokeStyle = 'rgba(255,230,190,0.35)'; g.lineWidth = 1.5; g.stroke();
    rr(g, x + 0.5, y + 0.5, w - 1, h - 1, r);
    g.strokeStyle = rgba(shade(base, -0.55), 0.8); g.lineWidth = 1.4; g.stroke();
  }
  function woodPanel(ctx, r, o) {
    try {
      o = o || {}; if (!r) return;
      const rad_ = o.radius != null ? o.radius : 12, tone = o.tone || 'mid';
      const pad = o.shadow === false ? 2 : 16;
      const w = Math.max(2, r.w), h = Math.max(2, r.h);
      const k = qRes(resOf(ctx));
      const vertical = o.vertical != null ? !!o.vertical : w > h;
      const key = 'wood|' + Math.round(w) + 'x' + Math.round(h) + '|' + rad_ + '|' + tone + '|' + (o.shadow === false ? 0 : 1) + (vertical ? 'v' : 'h');
      const c = layer(key, w + pad * 2, h + pad * 2, k, (g) => {
        if (o.shadow !== false) {
          g.save(); g.shadowColor = 'rgba(30,15,5,0.4)'; g.shadowBlur = 12; g.shadowOffsetY = 5;
          rr(g, pad, pad, w, h, rad_); g.fillStyle = '#6b4a2a'; g.fill(); g.restore();
        }
        paintWood(g, pad, pad, w, h, rad_, tone, vertical);
      });
      blit(ctx, c, r.x - pad, r.y - pad, w + pad * 2, h + pad * 2);
    } catch (e) { /* yok */ }
  }

  function stationLabel(ctx, r, label, o) {
    try {
      if (!r || label == null) return;
      o = o || {};
      label = String(label);
      ctx.save();
      ctx.font = '800 14px ' + FONT_T;
      const tw = ctx.measureText(label).width;
      const w = tw + 26, h = 22, x = r.x + 8, y = r.y + 7;
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
      rr(ctx, x, y, w, h, 11);
      ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [[0, 'rgba(58,44,78,0.94)'], [1, 'rgba(30,22,42,0.94)']]);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.stroke();
      circ(ctx, x + 10, y + h / 2, 3.4);
      ctx.fillStyle = o.color || '#ffcf4a'; ctx.fill();
      ctx.fillStyle = '#fff6e6'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 18, y + h / 2 + 0.5);
      ctx.restore();
    } catch (e) { /* yok */ }
  }

  // ---------------------------------------------------------------------------
  // BALON / SABIR ÇUBUĞU
  // ---------------------------------------------------------------------------
  function bubblePath(ctx, x, y, w, h, r, tail, tp) {
    const T = 15, B = 12;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    if (tail === 'up') { ctx.lineTo(tp - B, y); ctx.quadraticCurveTo(tp - 2, y - 4, tp, y - T); ctx.quadraticCurveTo(tp + 3, y - 4, tp + B, y); }
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    if (tail === 'right') { ctx.lineTo(x + w, tp - B); ctx.quadraticCurveTo(x + w + 4, tp - 2, x + w + T, tp); ctx.quadraticCurveTo(x + w + 4, tp + 3, x + w, tp + B); }
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    if (tail === 'down') { ctx.lineTo(tp + B, y + h); ctx.quadraticCurveTo(tp + 3, y + h + 4, tp - 1, y + h + T); ctx.quadraticCurveTo(tp - 3, y + h + 4, tp - B, y + h); }
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    if (tail === 'left') { ctx.lineTo(x, tp + B); ctx.quadraticCurveTo(x - 4, tp + 3, x - T, tp); ctx.quadraticCurveTo(x - 4, tp - 2, x, tp - B); }
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  function drawBubble(ctx, x, y, w, h, o) {
    try {
      o = o || {};
      const tail = o.tail || 'down', col = o.color || '#ffffff';
      const r = Math.min(o.radius != null ? o.radius : 16, w / 2, h / 2);
      const tp = o.tailPos != null ? o.tailPos : (tail === 'left' || tail === 'right') ? y + h / 2 : x + w / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(30,18,48,0.32)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
      bubblePath(ctx, x, y, w, h, r, tail, tp);
      ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [[0, shade(col, 0.3)], [1, shade(col, -0.06)]]);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = o.border || 'rgba(70,46,96,0.28)'; ctx.lineWidth = 2; ctx.stroke();
      // üst parlama
      ctx.save(); bubblePath(ctx, x, y, w, h, r, tail, tp); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      rr(ctx, x + 6, y + 3, w - 12, Math.min(10, h * 0.25), 6); ctx.fill();
      ctx.restore();
      ctx.restore();
    } catch (e) { /* yok */ }
  }
  const PAT_STOPS = [[0, '#ff4b3e'], [0.25, '#ff8a2f'], [0.5, '#ffd23f'], [0.75, '#a6e04a'], [1, '#3fd46a']];
  function drawPatience(ctx, x, y, w, ratio, o) {
    try {
      o = o || {};
      ratio = clamp(isFinite(ratio) ? ratio : 1, 0, 1);
      const h = o.h || clamp(Math.round(w * 0.085), 8, 14);
      const col = ramp(PAT_STOPS, ratio);
      ctx.save();
      // ray
      rr(ctx, x, y, w, h, h / 2);
      ctx.fillStyle = 'rgba(28,18,40,0.62)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
      // dolgu
      const fw = Math.max(h, (w - 4) * ratio);
      if (ratio > 0.001) {
        if (ratio < 0.25) {
          const p = 0.5 + 0.5 * Math.sin(now() * 10);
          ctx.shadowColor = rgba('#ff3b30', 0.5 + p * 0.4); ctx.shadowBlur = 6 + p * 6;
        }
        rr(ctx, x + 2, y + 2, fw, h - 4, (h - 4) / 2);
        ctx.fillStyle = lin(ctx, 0, y + 2, 0, y + h - 2, [[0, shade(col, 0.35)], [0.55, col], [1, shade(col, -0.18)]]);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        rr(ctx, x + 2 + h * 0.3, y + 3, Math.max(0, fw - h * 0.6), (h - 4) * 0.32, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      }
      ctx.restore();
    } catch (e) { /* yok */ }
  }

  // ---------------------------------------------------------------------------
  // İKONLAR (merkez x,y; size = kutu boyu)
  // ---------------------------------------------------------------------------
  function starPath(g, cx, cy, ro, ri, n, rot) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = rot + i * Math.PI / n, r = i % 2 ? ri : ro;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  }
  const ICONS = {
    coin(g) {
      circ(g, 0, 3, 40); g.fillStyle = '#b8770a'; g.fill();
      circ(g, 0, 0, 40); g.fillStyle = rad(g, -12, -14, 2, 46, [[0, '#fff3a8'], [0.5, '#ffd23f'], [1, '#e19a0c']]); g.fill();
      g.lineWidth = 3; g.strokeStyle = '#a86a06'; g.stroke();
      circ(g, 0, 0, 30); g.strokeStyle = 'rgba(160,100,0,0.55)'; g.lineWidth = 3; g.stroke();
      g.font = '900 44px ' + FONT_D; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(150,90,0,0.5)'; g.fillText('₺', 2, 4);
      g.fillStyle = '#fff6c4'; g.fillText('₺', 0, 2);
      ell(g, -14, -20, 10, 5, -0.6); g.fillStyle = 'rgba(255,255,255,0.65)'; g.fill();
    },
    star(g) {
      starPath(g, 0, 4, 44, 19, 5, -Math.PI / 2); g.fillStyle = '#c7820a'; g.fill();
      starPath(g, 0, 0, 44, 19, 5, -Math.PI / 2);
      g.fillStyle = rad(g, -8, -12, 2, 50, [[0, '#fff6b0'], [0.45, '#ffd23f'], [1, '#f39a0f']]); g.fill();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = '#b8700a'; g.stroke();
      ell(g, -9, -14, 7, 4, -0.5); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
    },
    clock(g) {
      circ(g, 0, 2, 42); g.fillStyle = '#9b2a22'; g.fill();
      circ(g, 0, 0, 42); g.fillStyle = lin(g, 0, -42, 0, 42, [[0, '#ff7a6a'], [1, '#d63a2e']]); g.fill();
      circ(g, 0, 0, 33); g.fillStyle = rad(g, -8, -10, 2, 40, [[0, '#ffffff'], [1, '#e8e4ee']]); g.fill();
      g.strokeStyle = '#555'; g.lineWidth = 3; g.lineCap = 'round';
      for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g.beginPath(); g.moveTo(Math.cos(a) * 27, Math.sin(a) * 27); g.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); g.stroke(); }
      g.strokeStyle = '#2a2a35'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -21); g.stroke();
      g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(15, 6); g.stroke();
      circ(g, 0, 0, 4); g.fillStyle = '#d63a2e'; g.fill();
    },
    check(g) {
      circ(g, 0, 3, 42); g.fillStyle = '#1c7a35'; g.fill();
      circ(g, 0, 0, 42); g.fillStyle = rad(g, -12, -14, 2, 48, [[0, '#8af0a0'], [0.55, '#36c45c'], [1, '#1f9442']]); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 10; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(-19, 1); g.lineTo(-5, 16); g.lineTo(20, -14); g.stroke();
      ell(g, -14, -22, 11, 5, -0.5); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill();
    },
    cross(g) {
      circ(g, 0, 3, 42); g.fillStyle = '#8f1d16'; g.fill();
      circ(g, 0, 0, 42); g.fillStyle = rad(g, -12, -14, 2, 48, [[0, '#ff9a8a'], [0.55, '#ef4a3a'], [1, '#c22a1e']]); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 10; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-15, -15); g.lineTo(15, 15); g.moveTo(15, -15); g.lineTo(-15, 15); g.stroke();
      ell(g, -14, -22, 11, 5, -0.5); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fill();
    },
    fire(g) {
      const flame = (s, c0, c1) => {
        g.beginPath();
        g.moveTo(0, 44 * s);
        g.bezierCurveTo(-34 * s, 40 * s, -40 * s, 6 * s, -22 * s, -16 * s);
        g.bezierCurveTo(-18 * s, -4 * s, -12 * s, 0, -10 * s, -2 * s);
        g.bezierCurveTo(-14 * s, -24 * s, -2 * s, -38 * s, 6 * s, -46 * s);
        g.bezierCurveTo(6 * s, -30 * s, 20 * s, -22 * s, 26 * s, -8 * s);
        g.bezierCurveTo(30 * s, -14 * s, 30 * s, -18 * s, 30 * s, -22 * s);
        g.bezierCurveTo(44 * s, -4 * s, 40 * s, 40 * s, 0, 44 * s);
        g.closePath();
        g.fillStyle = lin(g, 0, -46 * s, 0, 44 * s, [[0, c0], [1, c1]]); g.fill();
      };
      g.save(); g.translate(0, 2); flame(1, '#ff8a1f', '#e2321c'); g.strokeStyle = '#a8240f'; g.lineWidth = 2.5; g.stroke(); g.restore();
      g.save(); g.translate(0, 14); flame(0.62, '#ffe066', '#ff9a1f'); g.restore();
      g.save(); g.translate(0, 26); flame(0.32, '#fffbe0', '#ffe27a'); g.restore();
    },
    snow(g) {
      g.lineCap = 'round';
      const arm = (lw, col) => {
        g.strokeStyle = col; g.lineWidth = lw;
        for (let i = 0; i < 6; i++) {
          g.save(); g.rotate(i * TAU / 6);
          g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -40);
          g.moveTo(0, -24); g.lineTo(-11, -34); g.moveTo(0, -24); g.lineTo(11, -34);
          g.moveTo(0, -12); g.lineTo(-8, -19); g.moveTo(0, -12); g.lineTo(8, -19);
          g.stroke(); g.restore();
        }
      };
      arm(10, '#3c7fc8'); arm(5.5, '#e6f4ff');
      circ(g, 0, 0, 7); g.fillStyle = '#ffffff'; g.fill();
    },
    heart(g) {
      const hp = () => {
        g.beginPath(); g.moveTo(0, 38);
        g.bezierCurveTo(-30, 18, -46, 2, -44, -16);
        g.bezierCurveTo(-42, -38, -12, -42, 0, -20);
        g.bezierCurveTo(12, -42, 42, -38, 44, -16);
        g.bezierCurveTo(46, 2, 30, 18, 0, 38); g.closePath();
      };
      g.save(); g.translate(0, 3); hp(); g.fillStyle = '#9e1730'; g.fill(); g.restore();
      hp(); g.fillStyle = rad(g, -14, -18, 2, 52, [[0, '#ff9fb0'], [0.5, '#f0435d'], [1, '#c81e3c']]); g.fill();
      g.strokeStyle = '#a5162f'; g.lineWidth = 2.5; g.stroke();
      ell(g, -20, -18, 9, 6, -0.7); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
    },
    angry(g) {
      circ(g, 0, 3, 42); g.fillStyle = '#9b1f12'; g.fill();
      circ(g, 0, 0, 42); g.fillStyle = rad(g, -10, -14, 2, 50, [[0, '#ffb07a'], [0.5, '#ff6a3a'], [1, '#d8301c']]); g.fill();
      g.strokeStyle = '#5a1208'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-24, -16); g.lineTo(-7, -8); g.moveTo(24, -16); g.lineTo(7, -8); g.stroke();
      circ(g, -14, 2, 5); g.fillStyle = '#3a0c06'; g.fill(); circ(g, 14, 2, 5); g.fill();
      g.beginPath(); g.moveTo(-16, 24); g.quadraticCurveTo(0, 12, 16, 24); g.stroke();
      // öfke damarı
      g.strokeStyle = '#ff2a1a'; g.lineWidth = 4;
      g.save(); g.translate(26, -28);
      for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(3, 3); g.quadraticCurveTo(8, 4, 9, 10); g.stroke(); }
      g.restore();
    },
    bolt(g) {
      const bp = () => {
        g.beginPath(); g.moveTo(8, -46); g.lineTo(-26, 6); g.lineTo(-4, 6); g.lineTo(-12, 46); g.lineTo(26, -10); g.lineTo(4, -10); g.lineTo(14, -46); g.closePath();
      };
      g.save(); g.translate(2, 3); bp(); g.fillStyle = '#b87a00'; g.fill(); g.restore();
      bp(); g.fillStyle = lin(g, 0, -46, 0, 46, [[0, '#fff3a0'], [0.5, '#ffd21f'], [1, '#ff9f0a']]); g.fill();
      g.lineJoin = 'round'; g.strokeStyle = '#a86a00'; g.lineWidth = 2.5; g.stroke();
    },
    trash(g) {
      g.beginPath(); g.moveTo(-28, -18); g.lineTo(28, -18); g.lineTo(22, 42); g.lineTo(-22, 42); g.closePath();
      g.fillStyle = lin(g, -28, 0, 28, 0, [[0, '#7f8a95'], [0.4, '#c9d1d9'], [1, '#6d7782']]); g.fill();
      g.strokeStyle = '#3d4650'; g.lineWidth = 2.5; g.stroke();
      g.strokeStyle = 'rgba(40,48,58,0.5)'; g.lineWidth = 3;
      for (const xx of [-12, 0, 12]) { g.beginPath(); g.moveTo(xx, -10); g.lineTo(xx * 0.85, 34); g.stroke(); }
      rr(g, -34, -30, 68, 12, 5); g.fillStyle = lin(g, 0, -30, 0, -18, [[0, '#dbe2e8'], [1, '#8d97a1']]); g.fill(); g.strokeStyle = '#3d4650'; g.lineWidth = 2.5; g.stroke();
      rr(g, -10, -40, 20, 10, 4); g.stroke();
    },
    drop(g) {
      const dp = () => { g.beginPath(); g.moveTo(0, -44); g.bezierCurveTo(10, -26, 34, -2, 34, 16); g.arc(0, 16, 34, 0, Math.PI); g.bezierCurveTo(-34, -2, -10, -26, 0, -44); g.closePath(); };
      g.save(); g.translate(0, 3); dp(); g.fillStyle = '#1d5fa8'; g.fill(); g.restore();
      dp(); g.fillStyle = rad(g, -10, 4, 2, 50, [[0, '#bfe6ff'], [0.5, '#4fa8f0'], [1, '#2a73c8']]); g.fill();
      g.strokeStyle = '#1d5fa8'; g.lineWidth = 2.5; g.stroke();
      ell(g, -13, 12, 6, 11, 0.3); g.fillStyle = 'rgba(255,255,255,0.75)'; g.fill();
    },
    sparkle(g) {
      const sp = (s, c) => {
        g.beginPath(); g.moveTo(0, -44 * s);
        g.quadraticCurveTo(6 * s, -6 * s, 44 * s, 0); g.quadraticCurveTo(6 * s, 6 * s, 0, 44 * s);
        g.quadraticCurveTo(-6 * s, 6 * s, -44 * s, 0); g.quadraticCurveTo(-6 * s, -6 * s, 0, -44 * s); g.closePath();
        g.fillStyle = c; g.fill();
      };
      g.save(); g.shadowColor = 'rgba(255,200,40,0.9)'; g.shadowBlur = 10; sp(1, '#ffd23f'); g.restore();
      sp(0.7, '#fff2a0'); sp(0.3, '#ffffff');
      g.save(); g.translate(26, -26); sp(0.28, '#fff6c0'); g.restore();
    },
    unknown(g) {
      circ(g, 0, 0, 40); g.fillStyle = rad(g, -10, -12, 2, 46, [[0, '#d8d0ea'], [1, '#8a7fa6']]); g.fill();
      g.font = '900 48px ' + FONT_D; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText('?', 0, 3);
    },
  };
  ICONS.money = ICONS.coin; ICONS.tl = ICONS.coin; ICONS.time = ICONS.clock; ICONS.ok = ICONS.check; ICONS.x = ICONS.cross;
  ICONS.hot = ICONS.fire; ICONS.cold = ICONS.snow; ICONS.water = ICONS.drop; ICONS.power = ICONS.bolt;
  function drawIcon(ctx, name, x, y, size) {
    try {
      size = size || 24;
      const fn = ICONS[name] || ICONS.unknown;
      const key = 'icon:' + (ICONS[name] ? name : 'unknown');
      const box = size * 1.25;
      sprite(ctx, key, x, y, box, (g) => { g.scale(size / 100, size / 100); fn(g); });
    } catch (e) { /* yok */ }
  }

  // Ortak dışa açılan nesne (sonraki bölümler genişletir)
  const Art = {
    roundRect(ctx, x, y, w, h, r) { try { rr(ctx, x, y, w, h, r); } catch (e) { /* yok */ } },
    text, metalPanel, woodPanel, stationLabel, drawBubble, drawPatience, drawIcon,
    clearCache: clearCaches,
    color: { shade, mix, rgba, ramp },
  };
  // iç yardımcılar (art.js'in sonraki bölümleri için)
  Art._h = { TAU, FONT_D, FONT_T, clamp, lerp, now, rr, rrPath, ell, circ, rgbOf, shade, mix, rgba, ramp, lin, rad, rng, hashStr, h01,
    resOf, qRes, layerRes, layer, blit, sprite, newCanvas, paintMetal, paintWood, brushedTexture, starPath, ICONS };
  KS.Art = Art;
})(window.KS);
/* ===== Art bölüm 2: arka plan (HUD bandı, koridor, gökyüzü, kantin çerçevesi), servis tezgahı, çalışma alanı ===== */
(function (KS) {
  'use strict';
  const Art = KS.Art, H = Art._h;
  const { TAU, FONT_D, FONT_T, clamp, rr, ell, circ, shade, mix, rgba, lin, rad, rng, h01, layer, layerRes, blit, paintMetal, paintWood, brushedTexture, sprite } = H;

  const OPEN = { x: 330, y: 76, w: 1142, h: 276 };      // servis penceresi açıklığı (koridor)
  const WINS = [{ x: 555, y: 104, w: 170, h: 104 }, { x: 1115, y: 104, w: 170, h: 104 }];
  const FLOOR_Y = 298;
  const CLOCK = { x: 1539, y: 83, r: 19 };
  const SIGN = { x: 826, y: 61, w: 188, h: 42 };
  const BOARD = { x: 1488, y: 108, w: 102, h: 190 };

  function regionLayer(ctx, key, R, fn) {
    const k = layerRes(ctx);
    const c = layer(key, R.w, R.h, k, (g) => { g.translate(-R.x, -R.y); fn(g); });
    blit(ctx, c, R.x, R.y, R.w, R.h);
    return c;
  }

  // ---------------------------------------------------------------------------
  // GÖKYÜZÜ (saat + hava durumu)
  // ---------------------------------------------------------------------------
  const SKY_KEYS = [
    [480, '#8fc6ee', '#ffe3bd'],
    [560, '#63acea', '#d4ecfa'],
    [720, '#4b9ce6', '#c2e3fb'],
    [870, '#5ea0dc', '#e6ead6'],
    [960, '#7094cd', '#ffd09a'],
    [1020, '#7d7db5', '#ffa25c'],
  ];
  const WX = {
    gunesli:  { ov: 0,    tint: null,      cloud: '#ffffff', n: 6 },
    bulutlu:  { ov: 0.45, tint: '#a5b0bd', cloud: '#f3f5f8', n: 12 },
    yagmurlu: { ov: 0.78, tint: '#6d7988', cloud: '#8c95a2', n: 14 },
    soguk:    { ov: 0.38, tint: '#cad6e2', cloud: '#eef2f7', n: 9 },
    sicak:    { ov: 0,    tint: '#ffdc9c', cloud: '#fff8ea', n: 3, warm: 0.3 },
  };
  function skyAt(min, weather) {
    min = clamp(isFinite(min) ? min : 480, 480, 1020);
    let i = 1; while (i < SKY_KEYS.length - 1 && SKY_KEYS[i][0] < min) i++;
    const a = SKY_KEYS[i - 1], b = SKY_KEYS[i];
    const t = clamp((min - a[0]) / (b[0] - a[0]), 0, 1);
    let top = mix(a[1], b[1], t), bot = mix(a[2], b[2], t);
    const W = WX[weather] || WX.gunesli;
    if (W.tint) {
      const f = W.ov || (W.warm || 0);
      top = mix(top, W.tint, W.ov ? f * 0.85 : f * 0.35);
      bot = mix(bot, W.tint, W.ov ? f * 0.9 : f * 0.8);
    }
    const p = (min - 480) / 540;
    const sunA = clamp(1 - W.ov * 1.25, 0, 1);
    const late = clamp((min - 880) / 140, 0, 1), early = clamp(1 - (min - 480) / 70, 0, 1);
    return {
      min, p, top, bot, ov: W.ov, weather, W,
      sunX: 300 + p * 1080, sunY: 205 - Math.sin(p * Math.PI) * 92,
      sunR: weather === 'sicak' ? 24 : 17, sunA,
      sunCol: mix(mix('#fff2c2', '#ffb35a', late), '#ffd9a0', early * 0.6),
      late, early,
    };
  }
  function paintSky(g, S) {
    const weather = S.weather;
    g.fillStyle = lin(g, 0, 92, 0, 214, [[0, S.top], [0.75, mix(S.top, S.bot, 0.8)], [1, S.bot]]);
    g.fillRect(0, 56, 1600, 296);
    if (S.sunA > 0.02) {
      g.fillStyle = rad(g, S.sunX, S.sunY, 0, 300, [[0, rgba(S.sunCol, 0.6 * S.sunA)], [0.25, rgba(S.sunCol, 0.22 * S.sunA)], [1, rgba(S.sunCol, 0)]]);
      g.fillRect(0, 56, 1600, 296);
      g.save(); g.globalAlpha = S.sunA;
      g.shadowColor = rgba('#fff3c0', 0.9); g.shadowBlur = 26;
      circ(g, S.sunX, S.sunY, S.sunR);
      g.fillStyle = rad(g, S.sunX - 4, S.sunY - 4, 0, S.sunR, [[0, '#fffef6'], [0.7, mix('#fff3b8', S.sunCol, 0.4)], [1, mix('#ffe07a', S.sunCol, 0.5)]]);
      g.fill(); g.restore();
    } else {
      g.fillStyle = rad(g, S.sunX, S.sunY, 0, 240, [[0, 'rgba(255,255,255,0.28)'], [1, 'rgba(255,255,255,0)']]);
      g.fillRect(0, 56, 1600, 296);
    }
    const haze = S.bot;
    const R = rng(4242);
    // uzak tepeler
    g.beginPath(); g.moveTo(0, 214);
    for (let x = 0; x <= 1600; x += 20) g.lineTo(x, 176 - Math.sin(x * 0.006) * 9 - Math.sin(x * 0.017 + 1) * 5);
    g.lineTo(1600, 214); g.closePath();
    g.fillStyle = mix('#6f8ea8', haze, 0.55); g.fill();
    // şehir (apartmanlar + minare)
    const bcol = mix('#8593a6', haze, 0.42), wcol = mix('#fff1c8', haze, 0.3);
    let x = 0;
    while (x < 1600) {
      const bw = 26 + R() * 46, bh = 14 + R() * 34, top = 196 - bh;
      g.fillStyle = shade(bcol, (R() - 0.5) * 0.14);
      g.fillRect(x, top, bw - 3, bh + 20);
      g.fillStyle = rgba(wcol, 0.55);
      for (let wy = top + 4; wy < 192; wy += 7) for (let wx = x + 4; wx < x + bw - 8; wx += 7) if (R() < 0.55) g.fillRect(wx, wy, 3, 3);
      // çatı
      if (R() < 0.35) { g.fillStyle = shade(bcol, -0.12); g.beginPath(); g.moveTo(x - 2, top); g.lineTo(x + bw / 2 - 1.5, top - 7); g.lineTo(x + bw - 1, top); g.fill(); }
      x += bw + R() * 10;
    }
    // cami (pencere B'de görünür)
    const mx = 1236, mcol = shade(bcol, -0.08);
    g.fillStyle = mcol;
    g.beginPath(); g.arc(mx - 26, 182, 18, Math.PI, 0); g.fill(); g.fillRect(mx - 44, 182, 36, 16);
    g.fillRect(mx - 1, 132, 6, 66);
    g.beginPath(); g.moveTo(mx - 2, 133); g.lineTo(mx + 2, 116); g.lineTo(mx + 6, 133); g.fill();
    g.fillRect(mx - 3, 152, 10, 3);
    // ağaçlar
    const cold = weather === 'soguk';
    const treeCol = mix(mix(cold ? '#7f988e' : '#5e9a48', haze, 0.18), '#d9a060', S.late * 0.18);
    for (let i = 0; i < 70; i++) {
      const tx = R() * 1640 - 20, ty = 198 + R() * 4, tr = 7 + R() * 11;
      g.fillStyle = shade(treeCol, -0.25); g.fillRect(tx - 1.5, ty - 4, 3, 10);
      g.fillStyle = shade(treeCol, (R() - 0.5) * 0.2);
      circ(g, tx, ty - tr * 0.8, tr); g.fill();
      circ(g, tx - tr * 0.6, ty - tr * 0.4, tr * 0.7); g.fill();
      circ(g, tx + tr * 0.6, ty - tr * 0.45, tr * 0.72); g.fill();
      g.fillStyle = cold ? 'rgba(255,255,255,0.8)' : rgba('#fff6c8', 0.18);
      ell(g, tx - tr * 0.2, ty - tr * 1.3, tr * 0.7, tr * 0.35); g.fill();
    }
    // okul bahçesi
    g.fillStyle = cold ? '#eef3f8' : mix('#9aa092', haze, 0.2); g.fillRect(0, 202, 1600, 20);
    g.fillStyle = cold ? '#ffffff' : mix('#7cb35c', haze, 0.2); g.fillRect(0, 201, 1600, 3);
    g.strokeStyle = rgba('#3e5a4a', 0.55); g.lineWidth = 1;
    g.beginPath();
    for (let fx = 0; fx < 1600; fx += 9) { g.moveTo(fx, 192); g.lineTo(fx, 203); }
    g.moveTo(0, 193); g.lineTo(1600, 193); g.stroke();
    if (S.ov > 0.3) { g.fillStyle = rgba(WX[weather].tint || '#999', S.ov * 0.22); g.fillRect(0, 56, 1600, 296); }
  }
  function cloudSprite(g, col) {
    // 200 x 90 kutu, merkez 0,0
    const puffs = [[-58, 14, 30], [-24, -6, 40], [20, -14, 44], [58, 4, 32], [0, 18, 34], [-40, 22, 22], [44, 22, 24]];
    g.save();
    g.fillStyle = rgba(shade(col, -0.35), 0.35);
    for (const p of puffs) { circ(g, p[0], p[1] + 8, p[2]); g.fill(); }
    const grd = lin(g, 0, -60, 0, 50, [[0, shade(col, 0.4)], [0.6, col], [1, shade(col, -0.18)]]);
    g.fillStyle = grd;
    for (const p of puffs) { circ(g, p[0], p[1], p[2]); g.fill(); }
    g.restore();
  }
  function drawWindowsWeather(ctx, S, t) {
    const W = S.W;
    ctx.save();
    ctx.beginPath();
    for (const w of WINS) ctx.rect(w.x, w.y, w.w, w.h);
    ctx.clip();
    // bulutlar
    const ccol = mix(W.cloud, S.bot, 0.25 + S.late * 0.35);
    for (let i = 0; i < W.n; i++) {
      const sc = 0.45 + h01(i, 2) * 0.75, cw = 200 * sc;
      const speed = 3 + h01(i, 3) * 7;
      const x = ((h01(i, 1) * 2200 + t * speed) % 2200) - 300;
      const y = 106 + h01(i, 4) * 60;
      let vis = false;
      for (const w of WINS) if (x + cw / 2 > w.x && x - cw / 2 < w.x + w.w) vis = true;
      if (!vis) continue;
      sprite(ctx, 'cloud:' + ccol, x, y, cw, (g) => { g.scale(sc, sc); cloudSprite(g, ccol); });
    }
    if (S.weather === 'yagmurlu') {
      ctx.strokeStyle = 'rgba(225,235,255,0.6)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const w of WINS) {
        for (let i = 0; i < 46; i++) {
          const sp = 420 + h01(i, 5) * 240;
          const yy = w.y + ((h01(i, 6) * (w.h + 30) + t * sp) % (w.h + 30)) - 15;
          const xx = w.x - 10 + h01(i, 7) * (w.w + 20) - (yy - w.y) * 0.18;
          ctx.moveTo(xx, yy); ctx.lineTo(xx - 3, yy + 13);
        }
      }
      ctx.stroke();
      // camda damlalar
      ctx.fillStyle = 'rgba(235,242,255,0.55)';
      for (const w of WINS) for (let i = 0; i < 12; i++) {
        const xx = w.x + h01(i, 8) * w.w, yy = w.y + ((h01(i, 9) * w.h + t * (6 + h01(i, 10) * 10)) % w.h);
        ell(ctx, xx, yy, 1.6, 2.4); ctx.fill();
      }
    } else if (S.weather === 'soguk') {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (const w of WINS) {
        for (let i = 0; i < 34; i++) {
          const sp = 18 + h01(i, 11) * 26;
          const yy = w.y + ((h01(i, 12) * (w.h + 10) + t * sp) % (w.h + 10)) - 5;
          const xx = w.x + h01(i, 13) * w.w + Math.sin(t * 1.3 + i) * 6;
          circ(ctx, xx, yy, 1 + h01(i, 14) * 1.8); ctx.fill();
        }
      }
    } else if (S.weather === 'sicak') {
      // sıcak hava titreşimi: ufukta hafif parlama
      const a = 0.08 + 0.05 * Math.sin(t * 2);
      ctx.fillStyle = 'rgba(255,230,170,' + a.toFixed(3) + ')';
      for (const w of WINS) ctx.fillRect(w.x, w.y + w.h - 26, w.w, 26);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // KORİDOR (önbellek; pencere camları şeffaf)
  // ---------------------------------------------------------------------------
  function locker(g, x, y, w, h, col, num) {
    g.fillStyle = lin(g, x, 0, x + w, 0, [[0, shade(col, 0.18)], [0.5, col], [1, shade(col, -0.15)]]);
    rr(g, x, y, w, h, 3); g.fill();
    g.strokeStyle = shade(col, -0.45); g.lineWidth = 1.4; g.stroke();
    // kapı çizgisi
    g.strokeStyle = rgba(shade(col, -0.5), 0.6); g.lineWidth = 1;
    rr(g, x + 3, y + 4, w - 6, h - 8, 2); g.stroke();
    // havalandırma
    for (const vy of [y + 12, y + h - 30]) {
      for (let i = 0; i < 4; i++) {
        rr(g, x + 8, vy + i * 5, w - 16, 2.4, 1.2); g.fillStyle = rgba(shade(col, -0.6), 0.7); g.fill();
        g.fillStyle = rgba('#ffffff', 0.25); g.fillRect(x + 8, vy + i * 5 + 2.4, w - 16, 0.8);
      }
    }
    // numara
    rr(g, x + w / 2 - 7, y + 40, 14, 9, 2); g.fillStyle = '#f4f1e8'; g.fill();
    g.font = '800 7px ' + FONT_T; g.fillStyle = '#444'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), x + w / 2, y + 44.8);
    // kol
    rr(g, x + w - 11, y + h * 0.48, 4, 18, 2); g.fillStyle = lin(g, 0, y + h * 0.48, 0, y + h * 0.48 + 18, [[0, '#f0f3f6'], [1, '#79838e']]); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.8; g.stroke();
    // parlama
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 4, y + 4, 4, h - 8);
  }
  function door(g, x, y, w, h, label) {
    // kasa
    g.fillStyle = lin(g, x - 6, 0, x + w + 6, 0, [[0, '#8a6038'], [0.5, '#a87a4a'], [1, '#7a5230']]);
    rr(g, x - 6, y - 6, w + 12, h + 6, 3); g.fill();
    paintWood(g, x, y, w, h, 2, '#c99a62', false);
    // panel
    g.strokeStyle = 'rgba(90,55,25,0.45)'; g.lineWidth = 1.5;
    rr(g, x + 9, y + 74, w - 18, h - 90, 3); g.stroke();
    // cam
    rr(g, x + 12, y + 12, w - 24, 50, 3);
    g.fillStyle = lin(g, 0, y + 12, 0, y + 62, [[0, '#fdf6e4'], [1, '#e6dcc4']]); g.fill();
    g.strokeStyle = '#7a5230'; g.lineWidth = 2.5; g.stroke();
    g.fillStyle = 'rgba(160,190,210,0.25)'; g.fillRect(x + 13, y + 13, w - 26, 48);
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x + 18, y + 54); g.lineTo(x + 34, y + 18); g.moveTo(x + 26, y + 56); g.lineTo(x + 40, y + 26); g.stroke();
    // tabela
    rr(g, x + w / 2 - 17, y + 64, 34, 13, 3); g.fillStyle = '#2f5a8a'; g.fill();
    g.font = '800 9px ' + FONT_T; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + 71);
    // kol
    rr(g, x + w - 18, y + h * 0.55, 12, 4, 2); g.fillStyle = lin(g, 0, y + h * 0.55, 0, y + h * 0.55 + 4, [[0, '#fff3c0'], [1, '#b08a2a']]); g.fill();
    circ(g, x + w - 14, y + h * 0.55 + 2, 3.5); g.fill();
  }
  function paintCorridor(g) {
    // üst duvar
    g.fillStyle = lin(g, 0, 56, 0, 214, [[0, '#efe3c6'], [1, '#f6eedb']]);
    g.fillRect(0, 56, 1600, 160);
    for (const lx of [560, 920, 1280]) {
      g.fillStyle = rad(g, lx, 70, 0, 260, [[0, 'rgba(255,255,245,0.55)'], [1, 'rgba(255,255,245,0)']]);
      g.fillRect(lx - 260, 56, 520, 240);
    }
    const R = rng(91);
    for (let i = 0; i < 900; i++) { g.fillStyle = R() < 0.5 ? 'rgba(120,90,50,0.05)' : 'rgba(255,255,255,0.08)'; g.fillRect(R() * 1600, 56 + R() * 160, 1.5, 1.5); }
    // lambri (alt boyalı duvar)
    g.fillStyle = lin(g, 0, 218, 0, 292, [[0, '#86bab2'], [0.5, '#77aca4'], [1, '#6b9f97']]);
    g.fillRect(0, 218, 1600, 74);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0, 222, 1600, 3);
    g.fillStyle = lin(g, 0, 225, 0, 260, [[0, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 225, 1600, 35);
    // küpeşte
    g.fillStyle = lin(g, 0, 211, 0, 220, [[0, '#c08a52'], [0.5, '#9a6634'], [1, '#6e4520']]);
    g.fillRect(0, 211, 1600, 9);
    g.fillStyle = 'rgba(255,230,190,0.5)'; g.fillRect(0, 211, 1600, 1.5);
    // süpürgelik
    g.fillStyle = lin(g, 0, 289, 0, 298, [[0, '#4d726c'], [1, '#2f4a46']]); g.fillRect(0, 289, 1600, 9);
    // zemin (mozaik / terrazzo)
    g.fillStyle = lin(g, 0, FLOOR_Y, 0, 352, [[0, '#bfb5a6'], [1, '#e3dbcd']]);
    g.fillRect(0, FLOOR_Y, 1600, 54);
    const cols = ['#857c70', '#a89e90', '#f6f1e8', '#a5694a', '#6f7f86'];
    for (let i = 0; i < 2400; i++) {
      const y = FLOOR_Y + R() * 54, s = 0.5 + (y - FLOOR_Y) / 54 * 1.4;
      g.fillStyle = rgba(cols[(R() * cols.length) | 0], 0.5); g.fillRect(R() * 1600, y, s, s * 0.7);
    }
    g.strokeStyle = 'rgba(80,70,60,0.2)'; g.lineWidth = 1;
    g.beginPath();
    const vx = 901, vy = 190;
    for (let i = -16; i <= 16; i++) {
      const x0 = vx + i * 70, x1 = vx + (x0 - vx) * (352 - vy) / (FLOOR_Y - vy);
      g.moveTo(x0, FLOOR_Y); g.lineTo(x1, 352);
    }
    for (const yy of [306, 318, 334]) { g.moveTo(0, yy); g.lineTo(1600, yy); }
    g.stroke();
    g.fillStyle = lin(g, 0, FLOOR_Y, 0, FLOOR_Y + 10, [[0, 'rgba(40,30,20,0.25)'], [1, 'rgba(40,30,20,0)']]); g.fillRect(0, FLOOR_Y, 1600, 10);
    // dolaplar 1
    g.fillStyle = 'rgba(30,20,10,0.18)'; g.fillRect(338, 114, 122, 6);
    for (let i = 0; i < 3; i++) locker(g, 340 + i * 39, 118, 37, 180, '#4f8fd1', 21 + i);
    // küre (dolap üstü)
    g.fillStyle = '#6b4a2a'; g.fillRect(372, 110, 18, 8);
    g.strokeStyle = '#8a6a3a'; g.lineWidth = 2; g.beginPath(); g.arc(381, 92, 17, Math.PI * 0.6, Math.PI * 1.9); g.stroke();
    circ(g, 381, 92, 14); g.fillStyle = rad(g, 376, 86, 1, 16, [[0, '#9fd6ff'], [1, '#2f73b8']]); g.fill();
    g.fillStyle = '#5aa04a';
    ell(g, 376, 88, 6, 4, 0.4); g.fill(); ell(g, 386, 97, 4, 5, 0.2); g.fill(); ell(g, 384, 84, 3, 2); g.fill();
    // kitaplar
    const bookC = ['#d9483b', '#3f7ac2', '#f0b13b', '#4fa36a'];
    for (let i = 0; i < 4; i++) { rr(g, 404 + i * 9, 92 + (i % 2) * 3, 8, 26 - (i % 2) * 3, 1.5); g.fillStyle = bookC[i]; g.fill(); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(405 + i * 9, 98 + (i % 2) * 3, 6, 1.5); }
    // sınıf kapıları
    door(g, 466, 114, 78, 184, '9-A');
    door(g, 1012, 114, 78, 184, '10-B');
    // poster: sağlıklı beslen
    g.save(); g.translate(774, 160); g.rotate(-0.02);
    g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(-32, -40, 68, 86);
    g.fillStyle = '#fffaf0'; g.fillRect(-34, -43, 68, 86);
    g.fillStyle = '#4fae5a'; g.fillRect(-34, -43, 68, 16);
    g.font = '900 9px ' + FONT_T; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SAĞLIKLI', 0, -35);
    g.fillStyle = '#e8443a'; circ(g, -10, 2, 11); g.fill(); g.fillStyle = 'rgba(255,255,255,0.5)'; ell(g, -14, -2, 3, 2); g.fill();
    g.strokeStyle = '#6b4a2a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-10, -9); g.lineTo(-8, -14); g.stroke();
    g.fillStyle = '#5bb14a'; ell(g, -5, -12, 4, 2, -0.5); g.fill();
    g.fillStyle = '#f39a22'; g.beginPath(); g.moveTo(8, -8); g.lineTo(22, -2); g.lineTo(6, 16); g.closePath(); g.fill();
    g.fillStyle = '#5bb14a'; g.beginPath(); g.moveTo(16, -7); g.lineTo(24, -12); g.lineTo(20, -3); g.fill();
    g.fillStyle = '#2f5a8a'; g.font = '900 10px ' + FONT_T; g.fillText('BESLEN!', 0, 30);
    g.restore();
    // pano
    const B = { x: 850, y: 116, w: 140, h: 92 };
    g.fillStyle = 'rgba(30,20,10,0.22)'; g.fillRect(B.x - 4, B.y - 2, B.w + 12, B.h + 10);
    paintWood(g, B.x - 6, B.y - 6, B.w + 12, B.h + 12, 3, '#9a6a3a', true);
    g.fillStyle = lin(g, 0, B.y, 0, B.y + B.h, [[0, '#d7a46a'], [1, '#c48f55']]); g.fillRect(B.x, B.y, B.w, B.h);
    for (let i = 0; i < 500; i++) { g.fillStyle = R() < 0.5 ? 'rgba(120,70,30,0.25)' : 'rgba(255,220,170,0.25)'; g.fillRect(B.x + R() * B.w, B.y + R() * B.h, 1.2, 1.2); }
    const papers = [
      [B.x + 8, B.y + 8, 40, 34, '#ffffff', -0.05, '#e8443a'], [B.x + 54, B.y + 6, 34, 26, '#fff4a8', 0.06, '#3f7ac2'],
      [B.x + 94, B.y + 10, 38, 44, '#ffffff', 0.03, '#4fae5a'], [B.x + 12, B.y + 50, 44, 34, '#ffd6e0', 0.04, '#f0b13b'],
      [B.x + 62, B.y + 40, 30, 40, '#d8efff', -0.06, '#e8443a'], [B.x + 98, B.y + 60, 32, 26, '#fff4a8', -0.03, '#3f7ac2'],
    ];
    papers.forEach((p, i) => {
      g.save(); g.translate(p[0] + p[2] / 2, p[1] + p[3] / 2); g.rotate(p[5]);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-p[2] / 2 + 1.5, -p[3] / 2 + 2, p[2], p[3]);
      g.fillStyle = p[4]; g.fillRect(-p[2] / 2, -p[3] / 2, p[2], p[3]);
      if (i === 2) { // çocuk çizimi: ev + güneş
        g.fillStyle = '#ffcf33'; circ(g, 10, -12, 5); g.fill();
        g.fillStyle = '#e8443a'; g.beginPath(); g.moveTo(-12, -2); g.lineTo(-2, -12); g.lineTo(8, -2); g.fill();
        g.fillStyle = '#3f7ac2'; g.fillRect(-10, -2, 16, 14);
        g.fillStyle = '#4fae5a'; g.fillRect(-18, 13, 36, 4);
      } else {
        g.fillStyle = 'rgba(60,60,80,0.55)';
        g.fillRect(-p[2] / 2 + 4, -p[3] / 2 + 6, p[2] * 0.6, 2.5);
        for (let l = 0; l < 4; l++) if (-p[3] / 2 + 13 + l * 5 < p[3] / 2 - 3) g.fillRect(-p[2] / 2 + 4, -p[3] / 2 + 13 + l * 5, p[2] - 8 - (l % 2) * 6, 1.4);
      }
      circ(g, 0, -p[3] / 2 + 3, 2.6); g.fillStyle = p[6]; g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)'; circ(g, -0.8, -p[3] / 2 + 2.2, 0.9); g.fill();
      g.restore();
    });
    // pencereler: çerçeve + şeffaf cam
    for (const w of WINS) {
      g.fillStyle = 'rgba(40,30,20,0.18)'; g.fillRect(w.x - 8, w.y - 6, w.w + 18, w.h + 18);
      rr(g, w.x - 9, w.y - 9, w.w + 18, w.h + 18, 3);
      g.fillStyle = lin(g, 0, w.y - 9, 0, w.y + w.h + 9, [[0, '#ffffff'], [1, '#d9dcd8']]); g.fill();
      g.strokeStyle = '#a9aea8'; g.lineWidth = 1.2; g.stroke();
    }
    g.save(); g.globalCompositeOperation = 'destination-out';
    for (const w of WINS) { g.fillStyle = '#000'; g.fillRect(w.x, w.y, w.w, w.h); }
    g.restore();
    for (const w of WINS) {
      // cam yansıması
      g.save(); g.beginPath(); g.rect(w.x, w.y, w.w, w.h); g.clip();
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.beginPath(); g.moveTo(w.x + 20, w.y + w.h); g.lineTo(w.x + 70, w.y); g.lineTo(w.x + 100, w.y); g.lineTo(w.x + 50, w.y + w.h); g.fill();
      g.beginPath(); g.moveTo(w.x + 110, w.y + w.h); g.lineTo(w.x + 140, w.y); g.lineTo(w.x + 150, w.y); g.lineTo(w.x + 120, w.y + w.h); g.fill();
      g.fillStyle = lin(g, 0, w.y, 0, w.y + 10, [[0, 'rgba(0,0,0,0.18)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(w.x, w.y, w.w, 10);
      g.restore();
      // kayıtlar
      const mull = lin(g, 0, w.y, 0, w.y + w.h, [[0, '#ffffff'], [1, '#e2e5e1']]);
      g.fillStyle = mull;
      g.fillRect(w.x + w.w / 2 - 3, w.y, 6, w.h);
      g.fillRect(w.x, w.y + 36, w.w, 5);
      g.strokeStyle = 'rgba(120,125,120,0.6)'; g.lineWidth = 0.8;
      g.strokeRect(w.x + w.w / 2 - 3, w.y, 6, w.h); g.strokeRect(w.x, w.y + 36, w.w, 5);
      // kol
      g.fillStyle = '#c9ccc8'; rr(g, w.x + w.w / 2 + 6, w.y + 60, 4, 12, 2); g.fill();
      // denizlik
      rr(g, w.x - 14, w.y + w.h + 6, w.w + 28, 8, 2);
      g.fillStyle = lin(g, 0, w.y + w.h + 6, 0, w.y + w.h + 14, [[0, '#ffffff'], [1, '#c9ccc6']]); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(w.x - 12, w.y + w.h + 14, w.w + 24, 3);
    }
    // saksı (dolap 2 üstünde)
    g.fillStyle = 'rgba(30,20,10,0.18)'; g.fillRect(1306, 114, 164, 6);
    for (let i = 0; i < 4; i++) locker(g, 1308 + i * 40, 118, 38, 180, '#ef8a4c', 41 + i);
    const px = 1420;
    g.beginPath(); g.moveTo(px - 13, 98); g.lineTo(px + 13, 98); g.lineTo(px + 10, 118); g.lineTo(px - 10, 118); g.closePath();
    g.fillStyle = lin(g, px - 13, 0, px + 13, 0, [[0, '#d9734a'], [1, '#a84a2a']]); g.fill();
    g.fillStyle = '#b8583a'; g.fillRect(px - 15, 95, 30, 5);
    const leaf = (lx, ly, a, l) => { g.save(); g.translate(lx, ly); g.rotate(a); ell(g, 0, -l / 2, l * 0.22, l / 2); g.fillStyle = lin(g, 0, -l, 0, 0, [[0, '#7ccb5a'], [1, '#3e8a3a']]); g.fill(); g.restore(); };
    leaf(px, 96, -0.7, 26); leaf(px, 96, 0.6, 28); leaf(px, 96, -0.2, 32); leaf(px, 96, 0.15, 24); leaf(px - 3, 96, -1.1, 20); leaf(px + 3, 96, 1.1, 20);
  }

  // ---------------------------------------------------------------------------
  // KANTİN ÇERÇEVESİ (iç duvarlar, kepenk kutusu, tabela, saat kadranı, menü tahtası çerçevesi)
  // ---------------------------------------------------------------------------
  function tiles(g, x, y, w, h) {
    const T = 26, R = rng(Math.round(x * 7 + y));
    g.fillStyle = '#d6cbb5'; g.fillRect(x, y, w, h);
    for (let ty = y; ty < y + h; ty += T) {
      for (let tx = x; tx < x + w; tx += T) {
        const band = ty >= 262 && ty < 262 + T;
        const base = band ? '#3a6fb0' : shade('#f7f1e3', (R() - 0.5) * 0.05);
        rr(g, tx + 1.2, ty + 1.2, T - 2.4, T - 2.4, 2);
        g.fillStyle = lin(g, tx, ty, tx + T, ty + T, [[0, shade(base, 0.12)], [1, shade(base, -0.06)]]); g.fill();
        if (band) {
          g.fillStyle = '#f4f6fb';
          const cx = tx + T / 2, cy = ty + T / 2;
          for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; ell(g, cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, 4, 2.2, a); g.fill(); }
          circ(g, cx, cy, 2.2); g.fillStyle = '#e8443a'; g.fill();
        }
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(tx + 3, ty + 3, T * 0.4, 1.5);
      }
    }
  }
  function paintFrame(g) {
    // sol & sağ iç duvarlar (fayans)
    tiles(g, 0, 56, 330, 296);
    tiles(g, 1472, 56, 128, 296);
    // pervazlar (alüminyum)
    for (const jx of [322, 1468]) {
      g.fillStyle = lin(g, jx, 0, jx + 12, 0, [[0, '#8e98a2'], [0.4, '#eef2f5'], [1, '#7d8792']]);
      g.fillRect(jx, 56, 12, 296);
      g.strokeStyle = 'rgba(30,36,44,0.5)'; g.lineWidth = 1; g.strokeRect(jx + 0.5, 56, 11, 296);
    }
    // koridora düşen iç gölge
    g.fillStyle = lin(g, 334, 0, 352, 0, [[0, 'rgba(20,15,10,0.28)'], [1, 'rgba(20,15,10,0)']]); g.fillRect(334, 76, 18, 276);
    g.fillStyle = lin(g, 1468, 0, 1450, 0, [[0, 'rgba(20,15,10,0.28)'], [1, 'rgba(20,15,10,0)']]); g.fillRect(1450, 76, 18, 276);
    g.fillStyle = lin(g, 0, 80, 0, 100, [[0, 'rgba(20,15,10,0.3)'], [1, 'rgba(20,15,10,0)']]); g.fillRect(334, 80, 1134, 20);
    // kepenk kutusu
    paintMetal(g, 318, 54, 1166, 26, 3, 'blue');
    g.strokeStyle = 'rgba(40,60,80,0.25)'; g.lineWidth = 1;
    g.beginPath(); for (let yy = 60; yy < 78; yy += 4) { g.moveTo(322, yy); g.lineTo(1480, yy); } g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(318, 55, 1166, 1.5);
    // saat kadranı (sağ duvar)
    const C = CLOCK;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
    circ(g, C.x, C.y, C.r + 3); g.fillStyle = '#2c3e66'; g.fill(); g.restore();
    circ(g, C.x, C.y, C.r + 3); g.fillStyle = lin(g, 0, C.y - C.r, 0, C.y + C.r, [[0, '#4a68a8'], [1, '#22335a']]); g.fill();
    circ(g, C.x, C.y, C.r); g.fillStyle = rad(g, C.x - 5, C.y - 6, 1, C.r, [[0, '#ffffff'], [1, '#ece8de']]); g.fill();
    g.strokeStyle = '#333'; g.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12, l = i % 3 === 0 ? 4 : 2;
      g.lineWidth = i % 3 === 0 ? 1.8 : 1;
      g.beginPath(); g.moveTo(C.x + Math.cos(a) * (C.r - 2), C.y + Math.sin(a) * (C.r - 2)); g.lineTo(C.x + Math.cos(a) * (C.r - 2 - l), C.y + Math.sin(a) * (C.r - 2 - l)); g.stroke();
    }
    // menü tahtası çerçevesi + tahta
    const Bd = BOARD;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 8; g.shadowOffsetY = 4;
    rr(g, Bd.x - 6, Bd.y - 6, Bd.w + 12, Bd.h + 12, 5); g.fillStyle = '#7a4a26'; g.fill(); g.restore();
    paintWood(g, Bd.x - 6, Bd.y - 6, Bd.w + 12, Bd.h + 12, 5, '#8a5a30', false);
    g.fillStyle = lin(g, Bd.x, Bd.y, Bd.x + Bd.w, Bd.y + Bd.h, [[0, '#35503f'], [1, '#22362a']]);
    g.fillRect(Bd.x, Bd.y, Bd.w, Bd.h);
    const R = rng(55);
    for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.02 + R() * 0.05).toFixed(3) + ')'; ell(g, Bd.x + R() * Bd.w, Bd.y + R() * Bd.h, 2 + R() * 10, 1 + R() * 3, R() * 3); g.fill(); }
    // tabela: KANTİN
    const S = SIGN;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 10; g.shadowOffsetY = 4;
    rr(g, S.x, S.y, S.w, S.h, 12); g.fillStyle = '#8a1f1a'; g.fill(); g.restore();
    rr(g, S.x, S.y, S.w, S.h, 12); g.fillStyle = lin(g, 0, S.y, 0, S.y + S.h, [[0, '#f0584a'], [0.55, '#d43a2e'], [1, '#a82820']]); g.fill();
    rr(g, S.x + 5, S.y + 5, S.w - 10, S.h - 10, 8); g.strokeStyle = '#ffe9c2'; g.lineWidth = 2; g.stroke();
    g.font = '800 27px ' + FONT_D; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = '#7a1510'; g.strokeText('KANTİN', S.x + S.w / 2, S.y + S.h / 2 + 2);
    g.fillStyle = lin(g, 0, S.y + 8, 0, S.y + S.h - 8, [[0, '#ffffff'], [1, '#ffe2a0']]); g.fillText('KANTİN', S.x + S.w / 2, S.y + S.h / 2 + 2);
    g.fillStyle = 'rgba(255,255,255,0.28)'; rr(g, S.x + 8, S.y + 3, S.w - 16, 8, 4); g.fill();
  }
  function bulbPositions() {
    const S = SIGN, out = [];
    for (let i = 0; i < 8; i++) { const x = S.x + 16 + i * (S.w - 32) / 7; out.push([x, S.y + 2.5]); }
    for (let i = 0; i < 8; i++) { const x = S.x + S.w - 16 - i * (S.w - 32) / 7; out.push([x, S.y + S.h - 2.5]); }
    return out;
  }
  const BULBS = bulbPositions();

  function menuSignature() {
    try {
      const s = KS.state, D = KS.DATA, out = [];
      for (const [id, r] of Object.entries(D.recipes)) {
        const m = s.menu && s.menu[id];
        if (m && m.on && (!KS.isRecipeUnlocked || KS.isRecipeUnlocked(id))) out.push([r.name, m.price != null ? m.price : r.price]);
      }
      for (const id of ['ayran', 'simit', 'su', 'kola']) {
        const p = D.products[id];
        if (p && (!KS.isProductUnlocked || KS.isProductUnlocked(id))) out.push([p.name.replace(' (0,5L)', ''), (s.prices && s.prices[id] != null) ? s.prices[id] : p.price]);
      }
      return out.slice(0, 9);
    } catch (e) { return []; }
  }
  let _menuSig = null, _menuKey = '', _menuCheck = -1;
  function paintMenu(g, items) {
    const Bd = BOARD;
    g.font = '800 15px ' + FONT_D; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff6d6'; g.fillText('MENÜ', Bd.x + Bd.w / 2, Bd.y + 13);
    g.strokeStyle = 'rgba(255,240,200,0.6)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(Bd.x + 14, Bd.y + 23); g.quadraticCurveTo(Bd.x + Bd.w / 2, Bd.y + 27, Bd.x + Bd.w - 14, Bd.y + 23); g.stroke();
    const cols = ['#ffffff', '#ffe28a', '#ffc0cb', '#bfe8ff', '#c8f5b0'];
    items.forEach((it, i) => {
      const y = Bd.y + 36 + i * 16.5;
      g.font = '700 10px ' + FONT_T; g.textAlign = 'left';
      g.fillStyle = rgba(cols[i % cols.length], 0.88);
      g.fillText(it[0], Bd.x + 5, y, 66);
      g.textAlign = 'right'; g.font = '800 10px ' + FONT_T; g.fillStyle = '#fff6d6';
      g.fillText(Math.round(it[1]) + '₺', Bd.x + Bd.w - 4, y);
    });
    // karalamalar
    g.strokeStyle = 'rgba(255,230,120,0.7)'; g.lineWidth = 1.2;
    H.starPath(g, Bd.x + 12, Bd.y + Bd.h - 10, 5, 2.2, 5, -Math.PI / 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    circ(g, Bd.x + Bd.w - 13, Bd.y + Bd.h - 11, 6); g.stroke();
    g.beginPath(); g.arc(Bd.x + Bd.w - 13, Bd.y + Bd.h - 10, 3.5, 0.3, Math.PI - 0.3); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(Bd.x + Bd.w - 16, Bd.y + Bd.h - 14, 1.5, 1.5); g.fillRect(Bd.x + Bd.w - 11.5, Bd.y + Bd.h - 14, 1.5, 1.5);
    // tebeşir
    rr(g, Bd.x + 34, Bd.y + Bd.h + 1, 16, 4, 2); g.fillStyle = '#f6f2e8'; g.fill();
    rr(g, Bd.x + 54, Bd.y + Bd.h + 1, 12, 4, 2); g.fillStyle = '#f7c6d4'; g.fill();
  }

  function paintHud(g) {
    g.fillStyle = lin(g, 0, 0, 0, 56, [[0, '#3b2b52'], [1, '#221934']]); g.fillRect(0, 0, 1600, 56);
    g.save(); g.globalAlpha = 0.06; g.strokeStyle = '#ffffff'; g.lineWidth = 10;
    g.beginPath(); for (let x = -60; x < 1660; x += 34) { g.moveTo(x, 56); g.lineTo(x + 56, 0); } g.stroke(); g.restore();
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, 1600, 1.5);
    g.fillStyle = lin(g, 0, 52, 0, 56, [[0, '#ffcf6a'], [1, '#c9842a']]); g.fillRect(0, 52.5, 1600, 3.5);
  }

  // ---------------------------------------------------------------------------
  // ÇALIŞMA ALANI ZEMİNİ (paslanmaz tezgah)
  // ---------------------------------------------------------------------------
  function paintWorktop(g) {
    const y0 = 422, h = 478;
    g.fillStyle = lin(g, 0, y0, 0, 900, [[0, '#7c8690'], [0.15, '#a3adb6'], [0.6, '#959fa8'], [1, '#7d8790']]);
    g.fillRect(0, y0, 1600, h);
    try { g.fillStyle = g.createPattern(brushedTexture(), 'repeat'); g.fillRect(0, y0, 1600, h); } catch (e) { /* yok */ }
    g.fillStyle = lin(g, 0, y0, 1600, 900, [[0, 'rgba(255,255,255,0)'], [0.35, 'rgba(255,255,255,0.10)'], [0.45, 'rgba(255,255,255,0)'], [0.7, 'rgba(255,255,255,0.07)'], [0.8, 'rgba(255,255,255,0)']]);
    g.fillRect(0, y0, 1600, h);
    const seam = (x0, y0_, x1, y1) => {
      g.strokeStyle = 'rgba(30,36,44,0.55)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x0, y0_); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0 + (x0 === x1 ? 1.5 : 0), y0_ + (y0_ === y1 ? 1.5 : 0)); g.lineTo(x1 + (x0 === x1 ? 1.5 : 0), y1 + (y0_ === y1 ? 1.5 : 0)); g.stroke();
    };
    for (const sx of [358, 812, 1086, 1334]) seam(sx, 422, sx, 900);
    seam(358, 638, 1086, 638); seam(1086, 688, 1334, 688); seam(1334, 728, 1600, 728);
    // vidalar (birleşim noktaları)
    for (const p of [[358, 638], [812, 638], [1086, 638], [1086, 688], [1334, 688], [1334, 728]]) {
      circ(g, p[0], p[1], 2.6); g.fillStyle = rad(g, p[0] - 0.8, p[1] - 0.8, 0, 3, [[0, '#ffffff'], [1, '#6e7882']]); g.fill();
    }
    // ön kenar
    g.fillStyle = lin(g, 0, 884, 0, 900, [[0, 'rgba(255,255,255,0.25)'], [0.3, 'rgba(255,255,255,0.05)'], [1, 'rgba(0,0,0,0.35)']]);
    g.fillRect(0, 884, 1600, 16);
    g.fillStyle = lin(g, 0, 0, 14, 0, [[0, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, y0, 14, h);
    g.fillStyle = lin(g, 1600, 0, 1586, 0, [[0, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(1586, y0, 14, h);
  }

  function drawBackground(ctx, gameMin, weather, t) {
    try {
      t = t || 0;
      if (!WX[weather]) weather = 'gunesli';
      const k = layerRes(ctx);
      regionLayer(ctx, 'hud', { x: 0, y: 0, w: 1600, h: 56 }, paintHud);
      // gökyüzü (10 dk kademeli önbellek) — yalnız pencere bölgeleri kopyalanır
      const bucket = Math.round(clamp(gameMin || 480, 480, 1020) / 10) * 10;
      const S = skyAt(bucket, weather);
      const SR = { x: 500, y: 90, w: 820, h: 130 };
      const sky = layer('sky|' + bucket + '|' + weather, SR.w, SR.h, k, (g) => { g.translate(-SR.x, -SR.y); paintSky(g, S); });
      for (const w of WINS) {
        try { ctx.drawImage(sky, (w.x - SR.x) * k, (w.y - SR.y) * k, w.w * k, w.h * k, w.x, w.y, w.w, w.h); } catch (e) { /* yok */ }
      }
      drawWindowsWeather(ctx, S, t);
      regionLayer(ctx, 'corridor', { x: 0, y: 56, w: 1600, h: 296 }, paintCorridor);
      // pencerelerden zemine düşen ışık
      if (S.sunA > 0.15) {
        ctx.save();
        for (const w of WINS) {
          const dx = clamp((w.x + w.w / 2 - S.sunX) * 0.35, -140, 140);
          ctx.beginPath();
          ctx.moveTo(w.x + 4, FLOOR_Y); ctx.lineTo(w.x + w.w - 4, FLOOR_Y);
          ctx.lineTo(w.x + w.w + dx, 352); ctx.lineTo(w.x + dx, 352); ctx.closePath();
          ctx.fillStyle = lin(ctx, 0, FLOOR_Y, 0, 352, [[0, rgba(S.sunCol, 0.22 * S.sunA)], [1, rgba(S.sunCol, 0.05 * S.sunA)]]);
          ctx.fill();
        }
        ctx.restore();
      }
      // saat / hava ışık tonu
      const o = OPEN;
      if (S.late > 0) { ctx.fillStyle = rgba('#ff8a3a', 0.13 * S.late); ctx.fillRect(o.x, o.y, o.w, o.h); }
      if (S.early > 0) { ctx.fillStyle = rgba('#fff0d0', 0.12 * S.early); ctx.fillRect(o.x, o.y, o.w, o.h); }
      if (S.ov > 0) { ctx.fillStyle = rgba('#34465e', 0.16 * S.ov); ctx.fillRect(o.x, o.y, o.w, o.h); }
      if (weather === 'sicak') { ctx.fillStyle = 'rgba(255,196,110,0.07)'; ctx.fillRect(o.x, o.y, o.w, o.h); }
      regionLayer(ctx, 'frame', { x: 0, y: 54, w: 1600, h: 298 }, paintFrame);
      // menü tahtası içeriği (menü değişince yeniden)
      if (_menuSig === null || Math.floor(t * 2) !== _menuCheck) {
        _menuCheck = Math.floor(t * 2);
        _menuSig = menuSignature(); _menuKey = JSON.stringify(_menuSig);
      }
      const Bd = BOARD;
      const mc = layer('menu|' + H.hashStr(_menuKey), Bd.w + 12, Bd.h + 12, k, (g) => { g.translate(-(Bd.x - 6), -(Bd.y - 6)); paintMenu(g, _menuSig); });
      blit(ctx, mc, Bd.x - 6, Bd.y - 6, Bd.w + 12, Bd.h + 12);
      // saat ibreleri (oyun saati)
      const C = CLOCK, mins = isFinite(gameMin) ? gameMin : 480;
      const hA = ((mins / 60) % 12) / 12 * TAU - Math.PI / 2, mA = (mins % 60) / 60 * TAU - Math.PI / 2;
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = '#222';
      ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(C.x, C.y); ctx.lineTo(C.x + Math.cos(hA) * 9, C.y + Math.sin(hA) * 9); ctx.stroke();
      ctx.lineWidth = 1.7; ctx.beginPath(); ctx.moveTo(C.x, C.y); ctx.lineTo(C.x + Math.cos(mA) * 14, C.y + Math.sin(mA) * 14); ctx.stroke();
      const sA = (t % 60) / 60 * TAU - Math.PI / 2;
      ctx.strokeStyle = '#d63a2e'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(C.x, C.y); ctx.lineTo(C.x + Math.cos(sA) * 15, C.y + Math.sin(sA) * 15); ctx.stroke();
      circ(ctx, C.x, C.y, 2); ctx.fillStyle = '#d63a2e'; ctx.fill();
      // cam parlaması
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ell(ctx, C.x - 6, C.y - 8, 7, 3.5, -0.6); ctx.fill();
      ctx.restore();
      // tabela ampulleri (kayan ışık)
      const step = Math.floor(t * 4);
      for (let i = 0; i < BULBS.length; i++) {
        const on = ((i + step) % 4) !== 0;
        const b = BULBS[i];
        sprite(ctx, on ? 'bulb:on' : 'bulb:off', b[0], b[1], 16, (g) => {
          if (on) { g.fillStyle = rad(g, 0, 0, 0, 8, [[0, 'rgba(255,240,170,0.9)'], [0.4, 'rgba(255,200,80,0.45)'], [1, 'rgba(255,180,60,0)']]); g.fillRect(-8, -8, 16, 16); }
          circ(g, 0, 0, 2.6); g.fillStyle = on ? '#fffbe0' : '#b08a6a'; g.fill();
          g.strokeStyle = on ? 'rgba(255,180,60,0.9)' : 'rgba(90,50,30,0.8)'; g.lineWidth = 0.8; g.stroke();
        });
      }
      // çalışma alanı zemini
      regionLayer(ctx, 'worktop', { x: 0, y: 422, w: 1600, h: 478 }, paintWorktop);
      // HUD altı gölge
      ctx.fillStyle = lin(ctx, 0, 56, 0, 66, [[0, 'rgba(10,5,20,0.4)'], [1, 'rgba(10,5,20,0)']]);
      ctx.fillRect(0, 56, 1600, 10);
    } catch (e) {
      try { ctx.fillStyle = '#e8dcc4'; ctx.fillRect(0, 56, 1600, 296); ctx.fillStyle = '#5b6470'; ctx.fillRect(0, 422, 1600, 478); } catch (_) { /* yok */ }
    }
  }

  // ---------------------------------------------------------------------------
  // SERVİS TEZGAHI (352-422) + tezgah üstü süsler + yazar kasa
  // ---------------------------------------------------------------------------
  function paintCounter(g) {
    const R = rng(1234);
    // mermer üst
    g.fillStyle = lin(g, 0, 352, 0, 372, [[0, '#e9e5de'], [0.5, '#f6f3ee'], [1, '#e6e1d8']]);
    g.fillRect(0, 352, 1600, 20);
    g.save(); g.beginPath(); g.rect(0, 352, 1600, 20); g.clip();
    for (let i = 0; i < 46; i++) {
      let x = R() * 1600, y = 352 + R() * 20;
      g.strokeStyle = 'rgba(120,115,125,' + (0.08 + R() * 0.18).toFixed(3) + ')'; g.lineWidth = 0.5 + R() * 1.2;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 8; s++) { x += 8 + R() * 18; y += (R() - 0.5) * 8; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 500; i++) { g.fillStyle = R() < 0.5 ? 'rgba(90,90,100,0.12)' : 'rgba(255,255,255,0.5)'; g.fillRect(R() * 1600, 352 + R() * 20, 1, 1); }
    g.restore();
    g.fillStyle = 'rgba(40,30,30,0.35)'; g.fillRect(0, 352, 1600, 1.5);
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(0, 368, 1600, 1.6);
    g.fillStyle = lin(g, 0, 369, 0, 376, [[0, '#d4cfc6'], [1, '#9c968c']]); g.fillRect(0, 369.5, 1600, 6.5);
    // ahşap ön panel
    paintWood(g, 0, 376, 1600, 46, 0, '#b77a42', true);
    g.fillStyle = lin(g, 0, 376, 0, 384, [[0, 'rgba(0,0,0,0.38)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, 376, 1600, 8);
    for (let x = 6; x < 1600; x += 160) {
      rr(g, x + 4, 384, 148, 30, 4);
      g.strokeStyle = 'rgba(60,30,10,0.45)'; g.lineWidth = 2; g.stroke();
      rr(g, x + 5.5, 385.5, 145, 27, 3); g.strokeStyle = 'rgba(255,220,170,0.25)'; g.lineWidth = 1; g.stroke();
      circ(g, x + 78, 399, 3.2); g.fillStyle = rad(g, x + 77, 398, 0, 4, [[0, '#fff3c0'], [1, '#a8781e']]); g.fill();
    }
    g.fillStyle = lin(g, 0, 414, 0, 422, [[0, '#5a3618'], [1, '#3a220e']]); g.fillRect(0, 414, 1600, 8);
    // çalışma alanına gölge
    g.fillStyle = lin(g, 0, 422, 0, 446, [[0, 'rgba(10,8,16,0.45)'], [1, 'rgba(10,8,16,0)']]); g.fillRect(0, 422, 1600, 24);

    // --- tezgah üstü süsler (slot aralarında)
    // servis zili
    const bx = 640;
    ell(g, bx, 366, 15, 3.5); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fill();
    rr(g, bx - 14, 360, 28, 5, 2); g.fillStyle = lin(g, 0, 360, 0, 365, [[0, '#3a3a44'], [1, '#15151c']]); g.fill();
    g.beginPath(); g.arc(bx, 360, 11, Math.PI, 0); g.closePath();
    g.fillStyle = rad(g, bx - 4, 352, 1, 13, [[0, '#ffffff'], [0.4, '#ffe08a'], [1, '#c4901e']]); g.fill();
    g.strokeStyle = '#8a6010'; g.lineWidth = 0.8; g.stroke();
    rr(g, bx - 1.5, 345, 3, 5, 1); g.fillStyle = '#c4901e'; g.fill(); circ(g, bx, 345, 2.5); g.fill();
    // peçetelik
    const nx = 1200;
    ell(g, nx, 367, 20, 3.5); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(nx - 14, 362); g.lineTo(nx - 11, 340); g.lineTo(nx + 11, 340); g.lineTo(nx + 14, 362); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(nx - 8, 342); g.lineTo(nx - 10, 360); g.moveTo(nx + 6, 342); g.lineTo(nx + 7, 360); g.stroke();
    rr(g, nx - 19, 348, 38, 17, 3);
    g.fillStyle = lin(g, nx - 19, 0, nx + 19, 0, [[0, '#a8b2bc'], [0.45, '#f4f7fa'], [1, '#8a949e']]); g.fill();
    g.strokeStyle = 'rgba(40,48,58,0.5)'; g.lineWidth = 1; g.stroke();
    // kaktüs saksısı
    const kx = 920;
    ell(g, kx, 367, 13, 3); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fill();
    g.fillStyle = lin(g, 0, 330, 0, 352, [[0, '#7ccb6a'], [1, '#3f8f45']]);
    rr(g, kx - 6, 330, 12, 26, 6); g.fill();
    rr(g, kx - 15, 338, 7, 12, 3.5); g.fill(); rr(g, kx - 12, 345, 8, 5, 2); g.fill();
    rr(g, kx + 8, 334, 7, 12, 3.5); g.fill(); rr(g, kx + 4, 341, 8, 5, 2); g.fill();
    g.fillStyle = '#ff7aa8'; circ(g, kx, 330, 3); g.fill();
    g.beginPath(); g.moveTo(kx - 10, 350); g.lineTo(kx + 10, 350); g.lineTo(kx + 8, 366); g.lineTo(kx - 8, 366); g.closePath();
    g.fillStyle = lin(g, kx - 10, 0, kx + 10, 0, [[0, '#e88a5a'], [1, '#b0532e']]); g.fill();
    g.fillStyle = '#c8653a'; g.fillRect(kx - 11, 348, 22, 4);
  }
  function paintRegister(g, lv) {
    const x = 1500, base = 368;
    ell(g, x + 45, base - 1, 50, 5); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fill();
    if (lv >= 2) {
      // temassız POS cihazı + küçük ekran
      rr(g, x + 30, base - 44, 34, 44, 6); g.fillStyle = lin(g, 0, base - 44, 0, base, [[0, '#4a4f5a'], [1, '#1f232b']]); g.fill();
      rr(g, x + 34, base - 40, 26, 16, 3); g.fillStyle = lin(g, 0, base - 40, 0, base - 24, [[0, '#7fe0ff'], [1, '#2a8ad0']]); g.fill();
      g.fillStyle = '#ffffff'; g.font = '800 7px ' + FONT_T; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('₺', x + 47, base - 32);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { rr(g, x + 35 + c * 8, base - 20 + r * 6, 6, 4, 1); g.fillStyle = '#c9ced6'; g.fill(); }
      g.strokeStyle = 'rgba(120,220,255,0.8)'; g.lineWidth = 1.2;
      for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(x + 70, base - 34, i * 4, -0.7, 0.7); g.stroke(); }
      rr(g, x + 4, base - 22, 22, 22, 3); g.fillStyle = lin(g, 0, base - 22, 0, base, [[0, '#f4f4f0'], [1, '#c9c9c0']]); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.8; g.stroke();
      return;
    }
    if (lv >= 1) {
      // yazar kasa
      g.beginPath(); g.moveTo(x, base); g.lineTo(x + 6, base - 30); g.lineTo(x + 84, base - 30); g.lineTo(x + 90, base); g.closePath();
      g.fillStyle = lin(g, 0, base - 30, 0, base, [[0, '#f2ede2'], [1, '#c9c1b0']]); g.fill();
      g.strokeStyle = 'rgba(60,50,40,0.5)'; g.lineWidth = 1; g.stroke();
      for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) { rr(g, x + 12 + c * 11 + r * 1.5, base - 26 + r * 8, 9, 6, 1.5); g.fillStyle = c > 3 ? '#e8743a' : '#5a5f6a'; g.fill(); }
      rr(g, x + 50, base - 52, 34, 20, 3); g.fillStyle = '#3a3f4a'; g.fill();
      rr(g, x + 53, base - 49, 28, 11, 2); g.fillStyle = '#9ff0a0'; g.fill();
      g.fillStyle = '#1d5a2a'; g.font = '800 8px ' + FONT_T; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText('0,00', x + 79, base - 43);
      return;
    }
    // elle hesap: hesap makinesi + defter
    g.save(); g.translate(x + 30, base - 8); g.rotate(-0.08);
    rr(g, -22, -6, 44, 12, 2); g.fillStyle = '#f6f1e2'; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.8; g.stroke();
    g.fillStyle = '#d9483b'; g.fillRect(-22, -6, 5, 12);
    g.restore();
    g.save(); g.translate(x + 66, base - 12); g.rotate(0.06);
    rr(g, -12, -14, 24, 28, 3); g.fillStyle = lin(g, 0, -14, 0, 14, [[0, '#4a4f5a'], [1, '#262a32']]); g.fill();
    rr(g, -9, -11, 18, 7, 1.5); g.fillStyle = '#b8d8a0'; g.fill();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { rr(g, -9 + c * 6.5, -1 + r * 4.6, 5, 3.4, 1); g.fillStyle = '#d6dae0'; g.fill(); }
    g.restore();
  }
  function drawCounterFront(ctx, t) {
    try {
      regionLayer(ctx, 'counter', { x: 0, y: 324, w: 1600, h: 124 }, paintCounter);
      const lv = (KS.upg ? KS.upg('kasa') : 0) | 0;
      regionLayer(ctx, 'register' + lv, { x: 1490, y: 300, w: 110, h: 74 }, (g) => paintRegister(g, lv));
    } catch (e) {
      try { ctx.fillStyle = '#e6e1d8'; ctx.fillRect(0, 352, 1600, 20); ctx.fillStyle = '#9a6634'; ctx.fillRect(0, 372, 1600, 50); } catch (_) { /* yok */ }
    }
  }

  // ---------------------------------------------------------------------------
  // ÇALIŞMA ALANI DETAYLARI (istasyon gölgeleri)
  // ---------------------------------------------------------------------------
  const ST_KEYS = ['bins', 'yogurma', 'bekleme', 'tezgah', 'tost', 'izgara', 'fritoz', 'temizlik', 'semaver', 'cop'];
  function paintStationShadows(g) {
    const L = KS.layout || {};
    for (const key of ST_KEYS) {
      const r = L[key]; if (!r) continue;
      g.save();
      g.shadowColor = 'rgba(10,10,20,0.5)'; g.shadowBlur = 16; g.shadowOffsetY = 6;
      rr(g, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 14); g.fillStyle = '#000'; g.fill();
      g.restore();
      g.save(); g.globalCompositeOperation = 'destination-out';
      rr(g, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 14); g.fill();
      g.restore();
    }
  }
  function drawWorkspace(ctx, t) {
    try {
      regionLayer(ctx, 'wsShadow', { x: 0, y: 422, w: 1600, h: 478 }, paintStationShadows);
    } catch (e) { /* yok */ }
  }

  Object.assign(Art, { drawBackground, drawCounterFront, drawWorkspace });
  Object.assign(Art._h, { skyAt, WINS, OPEN });
})(window.KS);
/* ===== Art bölüm 3: malzemeler (drawIngredient) ve hazır ürünler (drawProduct) =====
 * Her çizim 100x100 birimlik kutuda (merkez 0,0; yaklaşık -48..48) tasarlanır ve size/100 ile ölçeklenir. */
(function (KS) {
  'use strict';
  const Art = KS.Art, H = Art._h;
  const { TAU, FONT_D, FONT_T, clamp, rr, ell, circ, shade, mix, rgba, ramp, lin, rad, rng, hashStr, sprite } = H;

  const OUT = 2.2; // kontur kalınlığı (100 birimde)
  function outline(g, col, lw) { g.strokeStyle = col; g.lineWidth = lw || OUT; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
  function gloss(g, x, y, rx, ry, rot, a) { ell(g, x, y, rx, ry, rot); g.fillStyle = 'rgba(255,255,255,' + (a == null ? 0.55 : a) + ')'; g.fill(); }
  // kenarı dalgalı/düzensiz daire yolu
  function blobPath(g, cx, cy, rx, ry, seed, amp, n) {
    const R = rng(seed); n = n || 22; amp = amp == null ? 0.06 : amp;
    const pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU, k = 1 + (R() - 0.5) * 2 * amp; pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      if (i === 0) g.moveTo(mx, my); else g.quadraticCurveTo(p[0], p[1], mx, my);
    }
    const p = pts[0], q = pts[1]; g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    g.closePath();
  }

  // ---------------------------------------------------------------------------
  // PİŞME RENKLERİ
  // ---------------------------------------------------------------------------
  const MEAT = [[0, '#e07f86'], [0.3, '#c9786a'], [0.6, '#a55a3c'], [1.0, '#7a4224'], [1.25, '#5a301a'], [1.5, '#33201a'], [2, '#1b120e']];
  const FRY = [[0, '#f5e6b8'], [0.45, '#f4d77e'], [0.85, '#f0b638'], [1.15, '#e09a26'], [1.4, '#b06a1e'], [1.7, '#5a3416'], [2.2, '#2a1a10']];
  const TOAST = [[0, '#f8ecd0'], [0.45, '#f3dca2'], [1.0, '#e0a54c'], [1.25, '#b9742e'], [1.5, '#6a3e1c'], [1.8, '#2e1c12'], [2.2, '#1a120c']];
  const CRUST = [[0, '#d9a465'], [0.45, '#cf8f48'], [1.0, '#b06a28'], [1.3, '#7a4418'], [1.6, '#3a2212'], [2.2, '#150e0a']];
  H.MEAT = MEAT; H.FRY = FRY; H.TOAST = TOAST; H.CRUST = CRUST;

  // ---------------------------------------------------------------------------
  // PARÇA ÇİZİCİLER (dish katmanlarında da kullanılır)
  // ---------------------------------------------------------------------------
  // ekmek dilimi silüeti
  function breadPath(g, w, h) {
    const x0 = -w / 2, x1 = w / 2, yb = h / 2, yt = -h / 2, r = w * 0.09;
    g.beginPath();
    g.moveTo(x0 + r, yb); g.lineTo(x1 - r, yb); g.quadraticCurveTo(x1, yb, x1, yb - r);
    g.lineTo(x1 - w * 0.02, yt + h * 0.36);
    g.bezierCurveTo(x1 + w * 0.1, yt + h * 0.06, x1 - w * 0.12, yt - h * 0.06, w * 0.08, yt + h * 0.04);
    g.quadraticCurveTo(0, yt + h * 0.07, -w * 0.08, yt + h * 0.04);
    g.bezierCurveTo(x0 + w * 0.12, yt - h * 0.06, x0 - w * 0.1, yt + h * 0.06, x0 + w * 0.02, yt + h * 0.36);
    g.lineTo(x0, yb - r); g.quadraticCurveTo(x0, yb, x0 + r, yb);
    g.closePath();
  }
  function breadSlice(g, w, h, toast, seed) {
    toast = toast || 0;
    const crust = ramp(CRUST, toast), crumb = ramp(TOAST, toast);
    breadPath(g, w, h);
    g.fillStyle = lin(g, 0, -h / 2, 0, h / 2, [[0, shade(crust, 0.08)], [1, shade(crust, -0.12)]]); g.fill();
    outline(g, shade(crust, -0.45));
    g.save(); g.scale(0.86, 0.86); g.translate(0, h * 0.02);
    breadPath(g, w, h);
    g.fillStyle = rad(g, -w * 0.15, -h * 0.2, 2, w * 0.7, [[0, shade(crumb, 0.12)], [1, shade(crumb, -0.06)]]); g.fill();
    g.clip();
    const R = rng(seed || 11);
    for (let i = 0; i < 36; i++) { ell(g, (R() - 0.5) * w * 0.85, (R() - 0.5) * h * 0.85, 0.8 + R() * 1.8, 0.6 + R() * 1.2, R() * 3); g.fillStyle = rgba(shade(crumb, -0.35), 0.28); g.fill(); }
    if (toast > 0.15) {
      // tost makinesi ızgara çizgileri
      const a = clamp((toast - 0.15) / 0.8, 0, 1) * 0.55;
      g.strokeStyle = rgba(shade(crumb, -0.6), a); g.lineWidth = w * 0.06; g.lineCap = 'round';
      g.beginPath();
      for (let i = -4; i <= 4; i++) { g.moveTo(-w * 0.6 + i * w * 0.2, h * 0.6); g.lineTo(w * 0.1 + i * w * 0.2, -h * 0.6); }
      g.stroke();
    }
    g.restore();
    if (toast < 1.4) gloss(g, -w * 0.2, -h * 0.28, w * 0.14, h * 0.05, -0.4, 0.3);
  }
  function tomatoSlice(g, x, y, r, rot) {
    g.save(); g.translate(x, y); g.rotate(rot || 0);
    circ(g, 0, 0, r); g.fillStyle = '#d42f24'; g.fill(); outline(g, '#8a1a12', r * 0.08);
    circ(g, 0, 0, r * 0.86); g.fillStyle = rad(g, -r * 0.2, -r * 0.2, 0, r, [[0, '#ff7a5c'], [1, '#e8402f']]); g.fill();
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4 + 0.4;
      ell(g, Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.26, r * 0.18, a); g.fillStyle = '#ffab86'; g.fill();
      for (let j = -1; j <= 1; j++) { ell(g, Math.cos(a) * r * 0.45 + Math.cos(a + 1.57) * j * r * 0.1, Math.sin(a) * r * 0.45 + Math.sin(a + 1.57) * j * r * 0.1, r * 0.05, r * 0.035, a); g.fillStyle = '#f7e6a6'; g.fill(); }
    }
    circ(g, 0, 0, r * 0.16); g.fillStyle = '#ffc2a8'; g.fill();
    gloss(g, -r * 0.4, -r * 0.45, r * 0.25, r * 0.1, -0.6, 0.45);
    g.restore();
  }
  function sucukSlice(g, x, y, r, seed) {
    circ(g, x, y, r); g.fillStyle = '#5e140e'; g.fill(); outline(g, '#3a0a06', r * 0.1);
    circ(g, x, y, r * 0.84); g.fillStyle = rad(g, x - r * 0.25, y - r * 0.25, 0, r, [[0, '#d0503c'], [1, '#9a2a1e']]); g.fill();
    const R = rng(seed || 5);
    for (let i = 0; i < 7; i++) { const a = R() * TAU, d = R() * r * 0.65; ell(g, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.09 + R() * r * 0.06, r * 0.07, R() * 3); g.fillStyle = 'rgba(255,215,195,0.85)'; g.fill(); }
    for (let i = 0; i < 6; i++) { const a = R() * TAU, d = R() * r * 0.7; circ(g, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.05); g.fillStyle = 'rgba(60,10,5,0.6)'; g.fill(); }
    gloss(g, x - r * 0.35, y - r * 0.4, r * 0.3, r * 0.12, -0.6, 0.4);
  }
  function onionRing(g, x, y, r, full) {
    if (full) {
      circ(g, x, y, r); g.fillStyle = '#f7eef6'; g.fill();
      for (let i = 4; i >= 1; i--) { circ(g, x, y, r * i / 4.3); g.strokeStyle = i === 4 ? '#9c5aa0' : 'rgba(176,120,184,0.6)'; g.lineWidth = i === 4 ? r * 0.13 : r * 0.05; g.stroke(); }
      circ(g, x, y, r); outline(g, '#6e3a72', r * 0.06);
    } else {
      circ(g, x, y, r); g.strokeStyle = '#7a4080'; g.lineWidth = r * 0.34; g.stroke();
      circ(g, x, y, r); g.strokeStyle = '#b77abf'; g.lineWidth = r * 0.24; g.stroke();
      circ(g, x, y, r - r * 0.06); g.strokeStyle = '#f8eef8'; g.lineWidth = r * 0.1; g.stroke();
    }
    gloss(g, x - r * 0.5, y - r * 0.55, r * 0.22, r * 0.08, -0.7, 0.6);
  }
  function lettuceLeaf(g, x, y, s, rot, seed) {
    g.save(); g.translate(x, y); g.rotate(rot || 0); g.scale(s, s);
    const R = rng(seed || 3), n = 26, pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      const base = 1 - 0.22 * Math.max(0, Math.sin(a)); // alt taraf daha dar
      const k = base * (1 + (i % 2 ? 0.1 : -0.05) + (R() - 0.5) * 0.08);
      pts.push([Math.cos(a) * 30 * k, Math.sin(a) * 22 * k - 2]);
    }
    g.beginPath();
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; if (i === 0) g.moveTo(mx, my); else g.quadraticCurveTo(p[0], p[1], mx, my); }
    g.quadraticCurveTo(pts[0][0], pts[0][1], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
    g.closePath();
    g.fillStyle = rad(g, -4, 2, 2, 36, [[0, '#d8f29a'], [0.5, '#8fd04f'], [1, '#4e9a2c']]); g.fill();
    outline(g, '#3a7a22', 1.6);
    g.strokeStyle = 'rgba(240,255,210,0.85)'; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(-26, 4); g.quadraticCurveTo(0, -2, 26, -6); g.stroke();
    g.lineWidth = 1.1;
    g.beginPath();
    for (let i = -2; i <= 2; i++) { const bx = i * 9, by = -1 - i * 0.6; g.moveTo(bx, by); g.lineTo(bx + 5, by - 12); g.moveTo(bx, by); g.lineTo(bx + 4, by + 11); }
    g.stroke();
    g.restore();
  }
  function pickleSlice(g, x, y, r) {
    circ(g, x, y, r); g.fillStyle = '#5f7f24'; g.fill(); outline(g, '#3e5512', r * 0.1);
    circ(g, x, y, r * 0.8); g.fillStyle = rad(g, x, y, 0, r, [[0, '#e3ea9a'], [1, '#a9bd4a']]); g.fill();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ell(g, x + Math.cos(a) * r * 0.38, y + Math.sin(a) * r * 0.38, r * 0.1, r * 0.06, a); g.fillStyle = '#f7f4d0'; g.fill(); }
    gloss(g, x - r * 0.35, y - r * 0.4, r * 0.25, r * 0.1, -0.6, 0.5);
  }
  function cheeseSlice(g, x, y, w, h, rot, col, peel) {
    g.save(); g.translate(x, y); g.rotate(rot || 0);
    rr(g, -w / 2, -h / 2, w, h, w * 0.08);
    g.fillStyle = lin(g, -w / 2, -h / 2, w / 2, h / 2, [[0, shade(col, 0.22)], [1, shade(col, -0.06)]]); g.fill();
    outline(g, shade(col, -0.35), 1.8);
    if (peel) {
      g.beginPath(); g.moveTo(w / 2 - w * 0.3, h / 2); g.quadraticCurveTo(w / 2 - w * 0.12, h / 2 - h * 0.12, w / 2, h / 2 - h * 0.3);
      g.lineTo(w / 2 - w * 0.06, h / 2 - w * 0.02); g.closePath();
      g.fillStyle = shade(col, 0.35); g.fill(); outline(g, shade(col, -0.3), 1.2);
    }
    gloss(g, -w * 0.2, -h * 0.28, w * 0.2, h * 0.06, -0.3, 0.45);
    g.restore();
  }
  // köfte (üstten): top = üst yüz pişmesi, side = alt yüz (kenar) pişmesi
  function kofte(g, x, y, rx, ry, top, side, seed) {
    const ctop = ramp(MEAT, top), cside = ramp(MEAT, side);
    blobPath(g, x, y + ry * 0.22, rx, ry, (seed || 9) + 1, 0.05);
    g.fillStyle = shade(cside, -0.18); g.fill(); outline(g, shade(cside, -0.55), 1.8);
    blobPath(g, x, y, rx * 0.97, ry * 0.93, seed || 9, 0.05);
    g.fillStyle = rad(g, x - rx * 0.3, y - ry * 0.35, 1, rx * 1.1, [[0, shade(ctop, 0.18)], [1, shade(ctop, -0.1)]]); g.fill();
    outline(g, shade(ctop, -0.5), 1.4);
    g.save(); blobPath(g, x, y, rx * 0.97, ry * 0.93, seed || 9, 0.05); g.clip();
    const R = rng((seed || 9) * 7);
    for (let i = 0; i < 40; i++) {
      const px = x + (R() - 0.5) * rx * 1.9, py = y + (R() - 0.5) * ry * 1.9;
      circ(g, px, py, 0.6 + R() * 1.4);
      g.fillStyle = top < 0.3 && R() < 0.5 ? 'rgba(255,235,230,0.65)' : rgba(shade(ctop, R() < 0.5 ? -0.35 : 0.2), 0.55); g.fill();
    }
    if (top > 0.35) {
      const a = clamp((top - 0.35) / 0.6, 0, 1) * 0.75;
      g.strokeStyle = rgba(top > 1.5 ? '#000000' : '#2a140a', a); g.lineWidth = ry * 0.2; g.lineCap = 'round';
      g.beginPath();
      for (let i = -2; i <= 2; i++) { g.moveTo(x + i * rx * 0.42 - rx * 0.35, y + ry * 0.9); g.lineTo(x + i * rx * 0.42 + rx * 0.35, y - ry * 0.9); }
      g.stroke();
    }
    if (top > 1.55) {
      g.strokeStyle = 'rgba(255,120,40,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - rx * 0.5, y); g.lineTo(x - rx * 0.1, y - ry * 0.2); g.lineTo(x + rx * 0.3, y + ry * 0.1); g.stroke();
    }
    g.restore();
    if (top < 1.5) gloss(g, x - rx * 0.35, y - ry * 0.45, rx * 0.25, ry * 0.12, -0.3, top < 0.3 ? 0.4 : 0.28);
  }
  function fry(g, x, y, w, l, rot, cook, seed) {
    const c = ramp(FRY, cook);
    g.save(); g.translate(x, y); g.rotate(rot);
    rr(g, -w / 2, -l / 2, w, l, w * 0.3);
    g.fillStyle = lin(g, -w / 2, 0, w / 2, 0, [[0, shade(c, 0.22)], [0.6, c], [1, shade(c, -0.22)]]); g.fill();
    outline(g, shade(c, -0.45), 1.1);
    if (cook > 0.6) { rr(g, -w / 2, -l / 2, w, l * 0.18, w * 0.3); g.fillStyle = rgba(shade(c, -0.3), 0.6); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-w * 0.28, -l * 0.4, w * 0.18, l * 0.7);
    g.restore();
  }
  function cigkoftePiece(g, x, y, s, rot, seed) {
    g.save(); g.translate(x, y); g.rotate(rot || 0); g.scale(s, s);
    blobPath(g, 0, 0, 24, 10.5, seed || 17, 0.05, 18);
    g.fillStyle = lin(g, 0, -11, 0, 11, [[0, '#b2442a'], [0.6, '#8c2a1a'], [1, '#62180e']]); g.fill();
    outline(g, '#4a0f08', 1.6);
    const R = rng((seed || 17) * 3);
    for (let i = 0; i < 26; i++) { circ(g, (R() - 0.5) * 42, (R() - 0.5) * 16, 0.5 + R() * 0.9); g.fillStyle = R() < 0.5 ? 'rgba(230,170,120,0.55)' : 'rgba(50,10,5,0.5)'; g.fill(); }
    g.strokeStyle = 'rgba(60,12,6,0.6)'; g.lineWidth = 2.2;
    for (let i = -1.5; i <= 1.5; i += 1) { g.beginPath(); g.moveTo(i * 10 - 2, -9); g.quadraticCurveTo(i * 10 + 3, 0, i * 10 - 1, 9); g.stroke(); }
    g.strokeStyle = 'rgba(255,190,150,0.35)'; g.lineWidth = 1.2;
    for (let i = -1.5; i <= 1.5; i += 1) { g.beginPath(); g.moveTo(i * 10 + 1, -8); g.quadraticCurveTo(i * 10 + 6, 0, i * 10 + 2, 8); g.stroke(); }
    gloss(g, -8, -6, 7, 2, -0.1, 0.35);
    g.restore();
  }
  function parsleySprig(g, x, y, s, rot) {
    g.save(); g.translate(x, y); g.rotate(rot || 0); g.scale(s, s);
    g.strokeStyle = '#4f8f2a'; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 26); g.quadraticCurveTo(-2, 8, -10, -8); g.moveTo(0, 26); g.quadraticCurveTo(2, 4, 8, -12); g.moveTo(0, 26); g.lineTo(0, -16); g.stroke();
    const tufts = [[-10, -10], [8, -14], [0, -18], [-14, -2], [14, -4]];
    for (const t of tufts) {
      for (let i = 0; i < 5; i++) { const a = i * TAU / 5; circ(g, t[0] + Math.cos(a) * 4.2, t[1] + Math.sin(a) * 4.2, 3.6); g.fillStyle = '#2f8a32'; g.fill(); }
      circ(g, t[0], t[1], 4.4); g.fillStyle = '#48a83e'; g.fill();
      circ(g, t[0] - 1.2, t[1] - 1.5, 1.6); g.fillStyle = '#86d36a'; g.fill();
    }
    g.restore();
  }
  function lemonSlice(g, x, y, r, half) {
    g.save(); g.translate(x, y);
    if (half) { g.beginPath(); g.arc(0, 0, r, Math.PI, 0); g.closePath(); } else circ(g, 0, 0, r);
    g.fillStyle = '#f2c81e'; g.fill(); outline(g, '#b8901a', r * 0.07);
    if (half) { g.beginPath(); g.arc(0, 0, r * 0.82, Math.PI, 0); g.closePath(); } else circ(g, 0, 0, r * 0.82);
    g.fillStyle = '#fffbe8'; g.fill();
    const n = 8, a0 = half ? Math.PI : 0, span = half ? Math.PI : TAU, cnt = half ? 4 : n;
    for (let i = 0; i < cnt; i++) {
      const a1 = a0 + i * span / cnt + 0.07, a2 = a0 + (i + 1) * span / cnt - 0.07;
      g.beginPath(); g.moveTo(Math.cos((a1 + a2) / 2) * r * 0.1, Math.sin((a1 + a2) / 2) * r * 0.1); g.arc(0, 0, r * 0.74, a1, a2); g.closePath();
      g.fillStyle = rad(g, 0, 0, 0, r * 0.75, [[0, '#fff8c0'], [1, '#f7e15a']]); g.fill();
    }
    g.restore();
  }
  function squeezeBottle(g, body, cap, labelFn) {
    // gövde
    g.beginPath();
    g.moveTo(-17, -22); g.quadraticCurveTo(-21, 6, -18, 36); g.quadraticCurveTo(-17, 44, -8, 44); g.lineTo(8, 44); g.quadraticCurveTo(17, 44, 18, 36); g.quadraticCurveTo(21, 6, 17, -22);
    g.quadraticCurveTo(12, -30, 0, -30); g.quadraticCurveTo(-12, -30, -17, -22); g.closePath();
    g.fillStyle = lin(g, -20, 0, 20, 0, [[0, shade(body, -0.25)], [0.3, shade(body, 0.2)], [0.55, body], [1, shade(body, -0.35)]]); g.fill();
    outline(g, shade(body, -0.55));
    // kapak
    rr(g, -12, -38, 24, 12, 3); g.fillStyle = lin(g, -12, 0, 12, 0, [[0, shade(cap, -0.2)], [0.4, shade(cap, 0.3)], [1, shade(cap, -0.3)]]); g.fill(); outline(g, shade(cap, -0.5), 1.6);
    g.beginPath(); g.moveTo(-5, -38); g.lineTo(-2, -48); g.lineTo(2, -48); g.lineTo(5, -38); g.closePath(); g.fillStyle = shade(cap, 0.1); g.fill(); outline(g, shade(cap, -0.5), 1.4);
    // etiket
    rr(g, -14, -6, 28, 26, 4); g.fillStyle = '#fffaf0'; g.fill(); outline(g, 'rgba(0,0,0,0.2)', 1);
    if (labelFn) labelFn();
    g.fillStyle = 'rgba(255,255,255,0.45)'; rr(g, -13, -22, 4, 58, 2); g.fill();
  }
  function shaker(g, fillCol, capCol, holes, flakes) {
    g.beginPath(); g.moveTo(-18, -16); g.lineTo(18, -16); g.lineTo(15, 42); g.quadraticCurveTo(0, 46, -15, 42); g.closePath();
    g.fillStyle = 'rgba(220,235,245,0.45)'; g.fill();
    g.save(); g.clip();
    g.fillStyle = lin(g, 0, -2, 0, 44, [[0, shade(fillCol, 0.1)], [1, shade(fillCol, -0.12)]]); g.fillRect(-20, -2, 40, 50);
    if (flakes) { const R = rng(31); for (let i = 0; i < 70; i++) { g.fillStyle = R() < 0.5 ? '#e0462e' : R() < 0.5 ? '#8a1a10' : '#f7c25a'; g.fillRect(-16 + R() * 32, R() * 44, 2 + R() * 2.5, 1.5 + R() * 1.5); } }
    else { const R = rng(32); for (let i = 0; i < 50; i++) { g.fillStyle = 'rgba(190,200,210,0.7)'; g.fillRect(-16 + R() * 32, R() * 44, 1.4, 1.4); } }
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-14, -14, 5, 56);
    g.restore();
    g.beginPath(); g.moveTo(-18, -16); g.lineTo(18, -16); g.lineTo(15, 42); g.quadraticCurveTo(0, 46, -15, 42); g.closePath();
    outline(g, 'rgba(90,110,130,0.7)', 1.8);
    // kapak
    g.beginPath(); g.moveTo(-19, -14); g.lineTo(-19, -26); g.quadraticCurveTo(0, -46, 19, -26); g.lineTo(19, -14); g.closePath();
    g.fillStyle = lin(g, -19, 0, 19, 0, [[0, shade(capCol, -0.3)], [0.35, shade(capCol, 0.45)], [1, shade(capCol, -0.35)]]); g.fill(); outline(g, shade(capCol, -0.55), 1.8);
    g.fillStyle = 'rgba(30,30,40,0.7)';
    for (const h of holes) { circ(g, h[0], h[1], 1.6); g.fill(); }
  }
  function bowl(g, rimCol, bodyCol, heapCol, heapFn) {
    ell(g, 0, 10, 40, 12); g.fillStyle = shade(bodyCol, -0.35); g.fill();
    // yığın
    g.beginPath(); g.moveTo(-36, 8); g.quadraticCurveTo(-24, -26, 0, -28); g.quadraticCurveTo(24, -26, 36, 8); g.closePath();
    g.fillStyle = rad(g, -8, -16, 2, 44, [[0, shade(heapCol, 0.2)], [1, shade(heapCol, -0.2)]]); g.fill();
    if (heapFn) { g.save(); g.clip(); heapFn(); g.restore(); }
    // kase gövdesi
    g.beginPath(); g.moveTo(-42, 8); g.quadraticCurveTo(-40, 40, 0, 42); g.quadraticCurveTo(40, 40, 42, 8); g.closePath();
    g.fillStyle = lin(g, -42, 0, 42, 0, [[0, shade(bodyCol, -0.15)], [0.35, shade(bodyCol, 0.3)], [1, shade(bodyCol, -0.25)]]); g.fill();
    outline(g, shade(bodyCol, -0.5));
    ell(g, 0, 8, 42, 5); g.strokeStyle = rimCol; g.lineWidth = 3; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.4)'; ell(g, -22, 22, 8, 4, 0.4); g.fill();
  }
  function jar(g, fillCol, lidCol, labelFn) {
    rr(g, -24, -20, 48, 62, 10);
    g.fillStyle = lin(g, -24, 0, 24, 0, [[0, shade(fillCol, -0.25)], [0.35, shade(fillCol, 0.15)], [1, shade(fillCol, -0.35)]]); g.fill();
    outline(g, shade(fillCol, -0.55));
    rr(g, -27, -34, 54, 16, 4); g.fillStyle = lin(g, 0, -34, 0, -18, [[0, shade(lidCol, 0.35)], [1, shade(lidCol, -0.25)]]); g.fill(); outline(g, shade(lidCol, -0.55), 1.8);
    g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1; g.beginPath(); for (let i = -22; i <= 22; i += 4) { g.moveTo(i, -32); g.lineTo(i, -20); } g.stroke();
    if (labelFn) labelFn();
    g.fillStyle = 'rgba(255,255,255,0.4)'; rr(g, -19, -16, 6, 52, 3); g.fill();
  }
  function pepper(g, x, y, s, col) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.beginPath(); g.moveTo(-3, -10); g.quadraticCurveTo(8, -8, 6, 6); g.quadraticCurveTo(3, 14, -4, 16); g.quadraticCurveTo(-1, 6, -6, -6); g.closePath();
    g.fillStyle = col || '#d8301c'; g.fill();
    g.fillStyle = '#4f9a2a'; rr(g, -5, -14, 6, 5, 2); g.fill();
    g.restore();
  }

  // ---------------------------------------------------------------------------
  // MALZEMELER
  // ---------------------------------------------------------------------------
  const ING = {
    tost_ekmegi(g) {
      g.save(); g.translate(7, -5); g.rotate(0.12); breadSlice(g, 66, 70, 0, 12); g.restore();
      g.save(); g.translate(-5, 5); g.rotate(-0.06); breadSlice(g, 70, 74, 0, 11); g.restore();
    },
    yarim_ekmek(g) {
      g.save(); g.rotate(-0.22);
      // gövde
      g.beginPath(); g.moveTo(-40, -18); g.bezierCurveTo(-10, -28, 30, -26, 44, -8); g.bezierCurveTo(50, 4, 44, 20, 30, 22); g.lineTo(-40, 22); g.closePath();
      g.fillStyle = lin(g, 0, -26, 0, 22, [[0, '#e7ad5e'], [0.55, '#c98638'], [1, '#9a5e22']]); g.fill();
      outline(g, '#6e3c12');
      // çizikler
      g.strokeStyle = 'rgba(255,225,160,0.85)'; g.lineWidth = 3.4; g.lineCap = 'round';
      g.beginPath(); for (const sx of [-24, -6, 12, 28]) { g.moveTo(sx - 6, -12); g.quadraticCurveTo(sx, -20, sx + 7, -19); } g.stroke();
      g.strokeStyle = 'rgba(120,60,15,0.5)'; g.lineWidth = 1.2;
      g.beginPath(); for (const sx of [-24, -6, 12, 28]) { g.moveTo(sx - 6, -10); g.quadraticCurveTo(sx, -17.5, sx + 7, -16.5); } g.stroke();
      // kesik yüz
      ell(g, -40, 2, 9, 20); g.fillStyle = rad(g, -42, -2, 1, 20, [[0, '#fff3d6'], [1, '#efd49a']]); g.fill(); outline(g, '#b07a3a', 1.8);
      const R = rng(4); for (let i = 0; i < 12; i++) { ell(g, -40 + (R() - 0.5) * 9, 2 + (R() - 0.5) * 28, 0.9, 1.4); g.fillStyle = 'rgba(180,130,60,0.45)'; g.fill(); }
      gloss(g, 6, -18, 18, 3, -0.08, 0.35);
      g.restore();
    },
    lavas(g) {
      blobPath(g, 4, 4, 42, 40, 61, 0.05); g.fillStyle = '#e2c88e'; g.fill(); outline(g, '#a88450', 1.6);
      blobPath(g, -3, -3, 42, 40, 62, 0.05);
      g.fillStyle = rad(g, -12, -12, 4, 50, [[0, '#fbefd0'], [1, '#ecd39c']]); g.fill(); outline(g, '#b08e58', 1.8);
      g.save(); g.clip();
      const R = rng(63);
      for (let i = 0; i < 22; i++) { const a = R() * TAU, d = R() * 34; ell(g, -3 + Math.cos(a) * d, -3 + Math.sin(a) * d, 2 + R() * 4, 1.5 + R() * 3, R() * 3); g.fillStyle = R() < 0.6 ? 'rgba(200,150,80,0.45)' : 'rgba(120,70,30,0.45)'; g.fill(); }
      // katlanma
      g.beginPath(); g.moveTo(10, -44); g.quadraticCurveTo(24, -10, 44, 2); g.lineTo(50, -50); g.closePath(); g.fillStyle = 'rgba(160,120,60,0.18)'; g.fill();
      g.restore();
    },
    hamburger_ekmegi(g) {
      // alt
      rr(g, -38, 12, 76, 22, 10); g.fillStyle = lin(g, 0, 12, 0, 34, [[0, '#f1d6a2'], [0.3, '#d99a4c'], [1, '#a8662a']]); g.fill(); outline(g, '#7a4614');
      g.fillStyle = '#f6e3bb'; rr(g, -36, 12, 72, 6, 3); g.fill();
      // üst kubbe
      g.beginPath(); g.moveTo(-42, 4); g.bezierCurveTo(-42, -38, 42, -38, 42, 4); g.quadraticCurveTo(42, 8, 36, 8); g.lineTo(-36, 8); g.quadraticCurveTo(-42, 8, -42, 4); g.closePath();
      g.fillStyle = rad(g, -12, -20, 2, 54, [[0, '#f0b86a'], [0.5, '#d48a3a'], [1, '#a35e22']]); g.fill(); outline(g, '#7a4614');
      const R = rng(81);
      for (let i = 0; i < 16; i++) { const x = (R() - 0.5) * 62, y = -6 - R() * 20 + Math.abs(x) * 0.25; ell(g, x, y, 2.6, 1.3, R() * 3); g.fillStyle = '#fff6dc'; g.fill(); g.strokeStyle = 'rgba(160,110,40,0.5)'; g.lineWidth = 0.6; g.stroke(); }
      gloss(g, -14, -18, 14, 5, -0.3, 0.4);
    },
    kasar(g) {
      cheeseSlice(g, 6, 6, 60, 56, 0.12, '#f3d264');
      cheeseSlice(g, -4, -4, 60, 56, -0.08, '#f8dc72');
    },
    sucuk(g) {
      // halka sucuk ucu
      g.save(); g.rotate(-0.3);
      rr(g, -40, -36, 50, 20, 10); g.fillStyle = lin(g, 0, -36, 0, -16, [[0, '#a8352a'], [1, '#5e140e']]); g.fill(); outline(g, '#3a0a06');
      g.strokeStyle = '#e8d8b0'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(-40, -26); g.lineTo(-46, -30); g.stroke();
      g.restore();
      sucukSlice(g, -16, 10, 14, 1); sucukSlice(g, 10, 2, 14, 2); sucukSlice(g, 26, 22, 13, 3); sucukSlice(g, 0, 26, 13, 4);
    },
    cheddar(g) {
      cheeseSlice(g, 4, 5, 60, 58, 0.1, '#f39a22');
      cheeseSlice(g, -3, -3, 60, 58, -0.1, '#f7a933', true);
    },
    kofte(g, o) {
      const c = o.cook || 0;
      const top = o.cookB != null ? o.cookB : c, side = o.cookA != null ? o.cookA : c;
      kofte(g, 0, -2, 38, 24, top, side, 9);
    },
    domates(g) {
      // bütün domates
      circ(g, 14, -12, 26); g.fillStyle = rad(g, 6, -20, 2, 32, [[0, '#ff7a62'], [0.6, '#e2382a'], [1, '#a81e14']]); g.fill(); outline(g, '#7a140c');
      g.fillStyle = '#3f8a2a';
      for (let i = 0; i < 5; i++) { const a = i * TAU / 5 - Math.PI / 2; ell(g, 14 + Math.cos(a) * 6, -34 + Math.sin(a) * 3, 6, 2.2, a); g.fill(); }
      gloss(g, 4, -22, 7, 4, -0.5, 0.6);
      tomatoSlice(g, -12, 14, 25, 0.3);
    },
    sogan(g) {
      onionRing(g, 12, -10, 25, true);
      onionRing(g, -14, 14, 20, false);
    },
    marul(g) {
      lettuceLeaf(g, 6, -6, 1.15, 0.5, 5);
      lettuceLeaf(g, -8, 8, 1.2, -0.25, 3);
    },
    tursu(g) {
      g.save(); g.rotate(-0.6);
      rr(g, -42, -14, 74, 26, 13); g.fillStyle = lin(g, 0, -14, 0, 12, [[0, '#9ab845'], [0.5, '#6f8f2a'], [1, '#4a6418']]); g.fill(); outline(g, '#34480e');
      const R = rng(7); for (let i = 0; i < 18; i++) { circ(g, -36 + R() * 64, -10 + R() * 18, 1.4); g.fillStyle = 'rgba(220,240,150,0.6)'; g.fill(); }
      gloss(g, -14, -8, 18, 3, 0, 0.45);
      g.restore();
      pickleSlice(g, 20, 22, 14); pickleSlice(g, -2, 30, 12);
    },
    patates(g, o) {
      const c = o.cook || 0;
      const R = rng(21);
      for (let i = 0; i < 8; i++) {
        const rot = -0.5 + i * 0.13 + (R() - 0.5) * 0.1;
        fry(g, -20 + i * 6, 4 + (R() - 0.5) * 6, 9.5, 66 - R() * 14, rot, c, i);
      }
    },
    maydanoz(g) {
      parsleySprig(g, -6, 2, 1.25, -0.3);
      parsleySprig(g, 10, 6, 1.1, 0.35);
    },
    limon(g) {
      // dilim + kama
      lemonSlice(g, -10, 8, 28, false);
      g.save(); g.translate(18, -16); g.rotate(0.5); lemonSlice(g, 0, 0, 24, true); g.restore();
    },
    nar_eksisi(g) {
      g.beginPath(); g.moveTo(-6, -30); g.lineTo(-6, -18); g.quadraticCurveTo(-20, -12, -20, 4); g.lineTo(-20, 38); g.quadraticCurveTo(-20, 44, -14, 44); g.lineTo(14, 44); g.quadraticCurveTo(20, 44, 20, 38); g.lineTo(20, 4); g.quadraticCurveTo(20, -12, 6, -18); g.lineTo(6, -30); g.closePath();
      g.fillStyle = lin(g, -20, 0, 20, 0, [[0, '#3a0812'], [0.35, '#8a1a2c'], [0.6, '#5a0f1f'], [1, '#2a050c']]); g.fill(); outline(g, '#1e0408');
      rr(g, -7.5, -42, 15, 13, 3); g.fillStyle = lin(g, -8, 0, 8, 0, [[0, '#8a6a1a'], [0.4, '#f2d36a'], [1, '#7a5a10']]); g.fill(); outline(g, '#5a4008', 1.4);
      rr(g, -17, 6, 34, 26, 4); g.fillStyle = '#fbf3df'; g.fill(); outline(g, 'rgba(0,0,0,0.25)', 1);
      circ(g, 0, 20, 8); g.fillStyle = rad(g, -2, 17, 1, 9, [[0, '#ff6a6a'], [1, '#b81a2a']]); g.fill();
      g.fillStyle = '#b81a2a'; g.beginPath(); g.moveTo(-3, 12); g.lineTo(-1, 9); g.lineTo(0, 12); g.lineTo(1, 9); g.lineTo(3, 12); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; rr(g, -15, -10, 4, 46, 2); g.fill();
    },
    ketcap(g) {
      squeezeBottle(g, '#e0302a', '#f6f6f2', () => { tomatoSlice(g, 0, 7, 8, 0); });
    },
    mayonez(g) {
      squeezeBottle(g, '#f5ecc8', '#f2c445', () => {
        ell(g, 0, 8, 7, 9); g.fillStyle = '#ffffff'; g.fill(); outline(g, 'rgba(0,0,0,0.25)', 1);
        circ(g, 0, 10, 4); g.fillStyle = '#ffc42e'; g.fill();
      });
    },
    tuz(g) { shaker(g, '#ffffff', '#c9d0d8', [[-6, -26], [0, -30], [6, -26], [-3, -21], [3, -21]], false); },
    pul_biber(g) {
      bowl(g, '#3f6fb0', '#f6f4ef', '#c7301e', () => {
        const R = rng(41);
        for (let i = 0; i < 90; i++) { g.fillStyle = R() < 0.55 ? '#e0462e' : R() < 0.5 ? '#7a140c' : '#f2a640'; g.save(); g.translate(-34 + R() * 68, -28 + R() * 36); g.rotate(R() * 3); g.fillRect(-1.6, -1, 3.2 + R() * 1.5, 2); g.restore(); }
      });
    },
    bulgur(g) {
      // çuval
      g.beginPath(); g.moveTo(-30, -18); g.quadraticCurveTo(-40, 20, -32, 42); g.lineTo(32, 42); g.quadraticCurveTo(40, 20, 30, -18); g.closePath();
      g.fillStyle = lin(g, -36, 0, 36, 0, [[0, '#b8915a'], [0.4, '#e2c290'], [1, '#a8804a']]); g.fill(); outline(g, '#6e5028');
      g.save(); g.clip(); g.strokeStyle = 'rgba(110,80,40,0.25)'; g.lineWidth = 1;
      g.beginPath(); for (let i = -40; i < 44; i += 4) { g.moveTo(-40, i); g.lineTo(40, i); g.moveTo(i, -20); g.lineTo(i, 44); } g.stroke(); g.restore();
      // ağız
      ell(g, 0, -18, 31, 9); g.fillStyle = '#8a6a3a'; g.fill(); outline(g, '#6e5028', 1.8);
      g.beginPath(); g.moveTo(-26, -18); g.quadraticCurveTo(0, -40, 26, -18); g.closePath(); g.fillStyle = rad(g, -4, -26, 1, 30, [[0, '#e6c48a'], [1, '#b8904e']]); g.fill();
      const R = rng(43);
      for (let i = 0; i < 70; i++) { const x = (R() - 0.5) * 50; const y = -19 - R() * (16 - Math.abs(x) * 0.5); ell(g, x, y, 1.3, 0.8, R() * 3); g.fillStyle = R() < 0.5 ? '#8a6a3a' : '#f2dcaa'; g.fill(); }
      // etiket
      rr(g, -16, 6, 32, 18, 3); g.fillStyle = '#fbf6e8'; g.fill(); outline(g, 'rgba(90,60,20,0.4)', 1);
      g.fillStyle = '#c4421f'; g.font = '900 8px ' + FONT_T; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BULGUR', 0, 15.5);
      for (let i = 0; i < 7; i++) { ell(g, -20 + R() * 40, 44 + R() * 4, 1.4, 0.9, R() * 3); g.fillStyle = '#c9a36b'; g.fill(); }
    },
    isot(g) {
      bowl(g, '#5a3418', '#a8703a', '#6e1a0e', () => {
        const R = rng(44);
        for (let i = 0; i < 120; i++) { circ(g, -34 + R() * 68, -28 + R() * 36, 0.8 + R() * 1.2); g.fillStyle = R() < 0.5 ? '#3a0a04' : R() < 0.6 ? '#9a2a16' : '#c45a2a'; g.fill(); }
      });
      // tahta kasenin halkaları
      g.strokeStyle = 'rgba(60,30,10,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(-36, 22); g.quadraticCurveTo(0, 34, 36, 22); g.moveTo(-30, 32); g.quadraticCurveTo(0, 42, 30, 32); g.stroke();
      pepper(g, 30, -30, 1.1, '#9a1a0e');
    },
    salca(g) {
      jar(g, '#b52a1b', '#d23a2a', () => {
        rr(g, -20, 2, 40, 24, 4); g.fillStyle = '#fbf3df'; g.fill(); outline(g, 'rgba(0,0,0,0.2)', 1);
        pepper(g, -6, 14, 0.75, '#d8301c'); pepper(g, 7, 14, 0.75, '#b81e10');
      });
    },
    cay_yapragi(g) {
      // paket kutusu (3/4)
      g.beginPath(); g.moveTo(-28, -30); g.lineTo(18, -30); g.lineTo(30, -38); g.lineTo(-16, -38); g.closePath(); g.fillStyle = '#e88a3a'; g.fill(); outline(g, '#7a3010', 1.8);
      g.beginPath(); g.moveTo(18, -30); g.lineTo(30, -38); g.lineTo(30, 32); g.lineTo(18, 40); g.closePath(); g.fillStyle = '#8a2a10'; g.fill(); outline(g, '#5a1a08', 1.8);
      rr(g, -28, -30, 46, 70, 2); g.fillStyle = lin(g, -28, 0, 18, 0, [[0, '#d24a24'], [1, '#b03418']]); g.fill(); outline(g, '#6a200c', 1.8);
      // ince belli bardak çizimi
      g.save(); g.translate(-5, 4); g.scale(0.4, 0.4); Art._h.teaGlass && Art._h.teaGlass(g, 1, 0.95, false); g.restore();
      // yapraklar
      const leaf = (x, y, r) => { g.save(); g.translate(x, y); g.rotate(r); ell(g, 0, 0, 8, 3.6); g.fillStyle = lin(g, 0, -4, 0, 4, [[0, '#7cc85a'], [1, '#2f7a2a']]); g.fill(); g.strokeStyle = '#1f5a1a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-7, 0); g.lineTo(7, 0); g.stroke(); g.restore(); };
      leaf(-18, -18, -0.6); leaf(-12, -22, 0.4); leaf(8, -20, -0.3);
      rr(g, -24, 26, 38, 10, 2); g.fillStyle = '#fbe3a0'; g.fill();
      g.fillStyle = '#7a2a10'; g.font = '900 8px ' + FONT_T; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ÇAY', -5, 31.5);
      // dökülmüş yapraklar
      const R = rng(52); for (let i = 0; i < 10; i++) { ell(g, -30 + R() * 36, 42 + R() * 5, 1.8, 0.9, R() * 3); g.fillStyle = '#3b2314'; g.fill(); }
    },
    yag(g) {
      g.beginPath(); g.moveTo(-24, -14); g.quadraticCurveTo(-26, 30, -22, 42); g.lineTo(26, 42); g.quadraticCurveTo(30, 30, 28, -14); g.quadraticCurveTo(26, -28, 6, -30); g.lineTo(-4, -30); g.quadraticCurveTo(-22, -28, -24, -14); g.closePath();
      g.fillStyle = lin(g, -26, 0, 28, 0, [[0, 'rgba(200,150,20,0.95)'], [0.35, 'rgba(255,220,90,0.95)'], [1, 'rgba(180,130,10,0.95)']]); g.fill(); outline(g, '#8a6208');
      // sap
      g.beginPath(); g.moveTo(10, -26); g.quadraticCurveTo(30, -32, 26, -6); g.strokeStyle = 'rgba(200,160,40,0.95)'; g.lineWidth = 6; g.stroke(); g.strokeStyle = '#8a6208'; g.lineWidth = 1.2; g.stroke();
      rr(g, -8, -42, 16, 13, 3); g.fillStyle = lin(g, -8, 0, 8, 0, [[0, '#1f7a3a'], [0.4, '#4fc46a'], [1, '#156028']]); g.fill(); outline(g, '#0e4a1e', 1.6);
      rr(g, -20, 4, 42, 24, 4); g.fillStyle = '#fbf8ec'; g.fill(); outline(g, 'rgba(0,0,0,0.2)', 1);
      g.fillStyle = '#f2b81e'; circ(g, -8, 16, 6); g.fill(); g.fillStyle = '#4fae5a'; ell(g, 4, 13, 6, 2.5, -0.4); g.fill(); ell(g, 10, 18, 5, 2, 0.4); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)'; rr(g, -19, -16, 5, 54, 2.5); g.fill();
    },
    cigkofte(g) {
      cigkoftePiece(g, -8, -16, 1.05, -0.2, 17);
      cigkoftePiece(g, 10, 2, 1.05, 0.15, 18);
      cigkoftePiece(g, -6, 22, 1.0, -0.05, 19);
    },
    cay(g) { Art._h.teaGlass && Art._h.teaGlass(g, 0.85, 1, true); },
  };
  // yığın halinde (count) çizilebilen malzemeler
  const STACKABLE = { tost_ekmegi: 1, yarim_ekmek: 1, lavas: 1, hamburger_ekmegi: 1, kasar: 1, sucuk: 1, cheddar: 1, kofte: 1, domates: 1, sogan: 1, marul: 1, tursu: 1, patates: 1, maydanoz: 1, limon: 1, cigkofte: 1 };

  function colorOf(id) {
    const D = KS.DATA || {};
    return (D.ingredients && D.ingredients[id] && D.ingredients[id].color) || (D.prepared && D.prepared[id] && D.prepared[id].color) ||
      (D.products && D.products[id] && D.products[id].color) || '#c8b8a0';
  }
  function nameOf(id) {
    try { return (KS.Recipes && KS.Recipes.nameOf(id)) || id; } catch (e) { return id; }
  }
  function fallbackIcon(g, id) {
    const c = colorOf(id);
    blobPath(g, 0, 0, 38, 34, hashStr(id), 0.08);
    g.fillStyle = rad(g, -12, -12, 2, 48, [[0, shade(c, 0.35)], [1, shade(c, -0.15)]]); g.fill(); outline(g, shade(c, -0.5));
    gloss(g, -14, -16, 12, 5, -0.5, 0.45);
    const n = String(nameOf(id) || '?');
    g.font = '900 26px ' + FONT_D; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 4; g.strokeStyle = shade(c, -0.5); g.strokeText(n.charAt(0).toLocaleUpperCase('tr-TR'), 0, 3);
    g.fillStyle = '#fff'; g.fillText(n.charAt(0).toLocaleUpperCase('tr-TR'), 0, 3);
  }
  function q2(v) { return v == null || !isFinite(v) ? '-' : (Math.round(v * 40) / 40).toFixed(3); }

  function drawIngredient(ctx, id, x, y, size, o) {
    try {
      size = size || 60; o = o || {};
      const fn = ING[id];
      const cnt = o.count != null && STACKABLE[id] ? (o.count >= 6 ? 3 : o.count >= 2 ? 2 : 1) : 1;
      const key = 'ing:' + id + ':' + q2(o.cook) + ':' + q2(o.cookA) + ':' + q2(o.cookB) + ':' + cnt;
      sprite(ctx, key, x, y, size * 1.3, (g) => {
        g.scale(size / 100, size / 100);
        const draw = () => { if (fn) fn(g, o); else fallbackIcon(g, id); };
        if (cnt >= 3) { g.save(); g.translate(-12, -10); g.scale(0.86, 0.86); draw(); g.restore(); g.fillStyle = 'rgba(0,0,0,0.12)'; }
        if (cnt >= 2) { g.save(); g.translate(10, -8); g.scale(0.9, 0.9); draw(); g.restore(); }
        draw();
      }, true);
    } catch (e) { /* yok */ }
  }

  // ---------------------------------------------------------------------------
  // HAZIR ÜRÜNLER
  // ---------------------------------------------------------------------------
  function wrapDurum(g, paper, stripe, fillFn) {
    g.save(); g.rotate(-0.42);
    // lavaş üst kısım (açık uç)
    g.beginPath(); g.moveTo(-17, -10); g.lineTo(-17, -34); g.quadraticCurveTo(-8, -44, 0, -40); g.quadraticCurveTo(10, -46, 17, -34); g.lineTo(17, -10); g.closePath();
    g.fillStyle = lin(g, -17, 0, 17, 0, [[0, '#d9b678'], [0.4, '#f7e4b4'], [1, '#c9a060']]); g.fill(); outline(g, '#8a6a3a', 1.8);
    // dolgu
    ell(g, 0, -36, 14, 6.5); g.fillStyle = '#5a3018'; g.fill();
    g.save(); ell(g, 0, -36, 14, 6.5); g.clip(); fillFn(); g.restore();
    // kağıt
    g.beginPath(); g.moveTo(-19, -16); g.lineTo(19, -24); g.lineTo(19, 40); g.quadraticCurveTo(0, 46, -19, 40); g.closePath();
    g.fillStyle = lin(g, -19, 0, 19, 0, [[0, shade(paper, -0.15)], [0.4, shade(paper, 0.2)], [1, shade(paper, -0.2)]]); g.fill();
    g.save(); g.clip();
    g.strokeStyle = stripe; g.lineWidth = 3.5;
    g.beginPath(); for (let i = -40; i < 60; i += 10) { g.moveTo(-20, i); g.lineTo(20, i - 8); } g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-12, -30, 5, 70);
    g.restore();
    g.beginPath(); g.moveTo(-19, -16); g.lineTo(19, -24); g.lineTo(19, 40); g.quadraticCurveTo(0, 46, -19, 40); g.closePath();
    outline(g, shade(paper, -0.5), 1.8);
    // kağıt kıvrımı
    g.beginPath(); g.moveTo(-19, -16); g.lineTo(-8, -10); g.lineTo(19, -24); g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1.2; g.stroke();
    g.restore();
  }
  function donerFill(meat) {
    return (g) => {
      const R = rng(meat === '#e2b46a' ? 3 : 4);
      for (let i = 0; i < 14; i++) { ell(g, (R() - 0.5) * 26, -36 + (R() - 0.5) * 10, 3 + R() * 3, 1.6 + R() * 1.5, R() * 3); g.fillStyle = shade(meat, (R() - 0.5) * 0.4); g.fill(); }
      for (let i = 0; i < 4; i++) { ell(g, (R() - 0.5) * 22, -36 + (R() - 0.5) * 8, 2.6, 1.5, R() * 3); g.fillStyle = '#e8402f'; g.fill(); }
      for (let i = 0; i < 5; i++) { ell(g, (R() - 0.5) * 24, -36 + (R() - 0.5) * 8, 2.4, 1.2, R() * 3); g.fillStyle = '#5cb03a'; g.fill(); }
    };
  }
  const PROD = {
    ayran(g) {
      g.beginPath(); g.moveTo(-28, -26); g.lineTo(28, -26); g.lineTo(22, 40); g.quadraticCurveTo(0, 44, -22, 40); g.closePath();
      g.fillStyle = lin(g, -28, 0, 28, 0, [[0, '#d6dee8'], [0.35, '#ffffff'], [1, '#c8d2de']]); g.fill(); outline(g, '#8a9aae');
      g.save(); g.clip();
      g.fillStyle = lin(g, 0, 0, 0, 26, [[0, '#3a80e0'], [1, '#1f5ab8']]); g.fillRect(-30, 0, 60, 24);
      g.strokeStyle = '#ffffff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-30, 8); g.bezierCurveTo(-14, 0, -6, 16, 6, 8); g.bezierCurveTo(16, 2, 22, 12, 30, 6); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-20, -24, 5, 66);
      g.restore();
      g.fillStyle = '#1f5ab8'; g.font = '900 10px ' + FONT_D; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('AYRAN', 0, -12);
      // folyo kapak
      ell(g, 0, -27, 31, 8); g.fillStyle = lin(g, -30, -30, 30, -22, [[0, '#9aa8b8'], [0.3, '#f4f8fc'], [0.6, '#b9c6d4'], [1, '#e8eef4']]); g.fill(); outline(g, '#6a7a8e', 1.6);
      ell(g, 0, -27, 22, 5); g.strokeStyle = 'rgba(40,110,210,0.8)'; g.lineWidth = 1.6; g.stroke();
      g.beginPath(); g.moveTo(26, -30); g.lineTo(38, -36); g.lineTo(36, -26); g.closePath(); g.fillStyle = '#d8e0ea'; g.fill(); outline(g, '#6a7a8e', 1.2);
    },
    su(g) {
      const body = () => { g.beginPath(); g.moveTo(-8, -36); g.lineTo(-8, -30); g.quadraticCurveTo(-18, -24, -18, -12); g.lineTo(-18, 40); g.quadraticCurveTo(-18, 46, -12, 46); g.lineTo(12, 46); g.quadraticCurveTo(18, 46, 18, 40); g.lineTo(18, -12); g.quadraticCurveTo(18, -24, 8, -30); g.lineTo(8, -36); g.closePath(); };
      body(); g.fillStyle = lin(g, -18, 0, 18, 0, [[0, 'rgba(120,190,240,0.75)'], [0.35, 'rgba(225,245,255,0.85)'], [1, 'rgba(90,160,220,0.8)']]); g.fill(); outline(g, '#4a8ac0');
      g.save(); body(); g.clip();
      g.fillStyle = 'rgba(120,200,255,0.3)'; g.fillRect(-20, -8, 40, 56);
      g.strokeStyle = 'rgba(70,130,190,0.35)'; g.lineWidth = 1.2; g.beginPath(); for (const yy of [-6, 34, 40]) { g.moveTo(-18, yy); g.lineTo(18, yy); } g.stroke();
      g.fillStyle = lin(g, 0, 4, 0, 28, [[0, '#2f7fd8'], [1, '#1d5aa8']]); g.fillRect(-20, 4, 40, 24);
      g.fillStyle = '#ffffff';
      g.beginPath(); g.moveTo(-10, 22); g.lineTo(-3, 10); g.lineTo(2, 17); g.lineTo(6, 12); g.lineTo(12, 22); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(-13, -20, 4, 64);
      g.restore();
      rr(g, -9, -46, 18, 11, 2.5); g.fillStyle = lin(g, -9, 0, 9, 0, [[0, '#1d5aa8'], [0.4, '#5aa8f0'], [1, '#174a90']]); g.fill(); outline(g, '#0e3870', 1.6);
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 0.8; g.beginPath(); for (let i = -6; i <= 6; i += 3) { g.moveTo(i, -45); g.lineTo(i, -36); } g.stroke();
    },
    kola(g) {
      rr(g, -21, -38, 42, 82, 8);
      g.fillStyle = lin(g, -21, 0, 21, 0, [[0, '#4a0c08'], [0.3, '#b8261c'], [0.5, '#8e1a12'], [1, '#3a0806']]); g.fill(); outline(g, '#2a0604');
      g.save(); rr(g, -21, -38, 42, 82, 8); g.clip();
      g.fillStyle = '#f6efe6'; g.beginPath(); g.moveTo(-22, 14); g.bezierCurveTo(-8, 2, 6, 26, 22, 8); g.lineTo(22, 16); g.bezierCurveTo(6, 34, -8, 10, -22, 22); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (const b of [[-10, -14, 3], [-2, -22, 2], [6, -12, 2.5], [10, -24, 1.6], [-8, -26, 1.4]]) { circ(g, b[0], b[1], b[2]); g.fill(); }
      g.fillStyle = '#ffffff'; g.font = '900 12px ' + FONT_D; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('KOLA', 0, -2);
      g.fillStyle = 'rgba(255,255,255,0.32)'; g.fillRect(-13, -36, 5, 78);
      g.restore();
      ell(g, 0, -38, 18, 5); g.fillStyle = lin(g, -18, 0, 18, 0, [[0, '#8a949e'], [0.5, '#f2f5f8'], [1, '#7a848e']]); g.fill(); outline(g, '#4a525a', 1.4);
      rr(g, -5, -41, 10, 5, 2); g.strokeStyle = '#6a737c'; g.lineWidth = 1.4; g.stroke();
      rr(g, -20, 36, 40, 8, 3); g.fillStyle = 'rgba(200,205,210,0.9)'; g.fill();
    },
    meyve_suyu(g) {
      g.beginPath(); g.moveTo(-24, -26); g.lineTo(12, -26); g.lineTo(24, -34); g.lineTo(-12, -34); g.closePath(); g.fillStyle = '#ffd08a'; g.fill(); outline(g, '#a85a10', 1.6);
      g.beginPath(); g.moveTo(12, -26); g.lineTo(24, -34); g.lineTo(24, 34); g.lineTo(12, 42); g.closePath(); g.fillStyle = '#d06a12'; g.fill(); outline(g, '#8a420a', 1.6);
      rr(g, -24, -26, 36, 68, 2); g.fillStyle = lin(g, -24, 0, 12, 0, [[0, '#ffb43a'], [1, '#f28a12']]); g.fill(); outline(g, '#8a420a', 1.8);
      circ(g, -6, 10, 12); g.fillStyle = rad(g, -9, 6, 1, 13, [[0, '#ffd27a'], [1, '#f07a0a']]); g.fill(); outline(g, '#b8500a', 1.2);
      g.fillStyle = '#4fae3a'; ell(g, 0, -3, 6, 2.5, -0.5); g.fill();
      g.strokeStyle = 'rgba(255,240,200,0.7)'; g.lineWidth = 0.8; for (let i = 0; i < 6; i++) { const a = i * TAU / 6; g.beginPath(); g.moveTo(-6, 10); g.lineTo(-6 + Math.cos(a) * 9, 10 + Math.sin(a) * 9); g.stroke(); }
      rr(g, -20, 28, 28, 9, 2); g.fillStyle = '#ffffff'; g.fill();
      g.fillStyle = '#e8641a'; g.font = '900 7px ' + FONT_T; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('MEYVE', -6, 32.5);
      // pipet
      g.save(); g.translate(2, -30); g.rotate(0.25);
      rr(g, -2.5, -22, 5, 24, 2); g.fillStyle = '#ffffff'; g.fill(); outline(g, '#c84a3a', 1);
      g.fillStyle = '#e8443a'; for (let i = -20; i < 2; i += 6) g.fillRect(-2.5, i, 5, 2.5);
      g.restore();
    },
    cips(g) {
      g.beginPath(); g.moveTo(-30, -36);
      for (let i = 0; i <= 10; i++) g.lineTo(-30 + i * 6, -36 - (i % 2 ? 4 : 0));
      g.quadraticCurveTo(38, 0, 30, 38);
      for (let i = 10; i >= 0; i--) g.lineTo(-30 + i * 6, 38 + (i % 2 ? 4 : 0));
      g.quadraticCurveTo(-38, 0, -30, -36); g.closePath();
      g.fillStyle = lin(g, -34, 0, 34, 0, [[0, '#e8a810'], [0.35, '#ffe066'], [0.7, '#ffcf33'], [1, '#d89a0a']]); g.fill(); outline(g, '#9a6a04');
      g.save(); g.clip();
      g.fillStyle = '#e8443a'; H.starPath(g, 0, 4, 26, 18, 12, 0); g.fill();
      ell(g, 0, 6, 15, 10, -0.3); g.fillStyle = rad(g, -4, 2, 1, 16, [[0, '#ffe9a0'], [1, '#e8b040']]); g.fill(); outline(g, '#b07a10', 1.2);
      g.fillStyle = 'rgba(200,120,20,0.6)'; circ(g, -3, 4, 1.3); g.fill(); circ(g, 4, 9, 1.3); g.fill();
      g.fillStyle = '#c42a1a'; g.font = '900 11px ' + FONT_D; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CİPS', 0, -22);
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(-22, -34, 6, 70);
      g.restore();
      g.strokeStyle = 'rgba(120,80,0,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-28, -30); g.lineTo(28, -30); g.moveTo(-28, 32); g.lineTo(28, 32); g.stroke();
    },
    cikolata(g) {
      g.save(); g.rotate(-0.35);
      // çikolata (açık uç)
      rr(g, -16, -44, 32, 30, 3); g.fillStyle = lin(g, -16, 0, 16, 0, [[0, '#4a2210'], [0.4, '#7a3e1e'], [1, '#3a180a']]); g.fill(); outline(g, '#2a1006');
      g.strokeStyle = 'rgba(30,10,4,0.6)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, -44); g.lineTo(0, -14); g.moveTo(-16, -30); g.lineTo(16, -30); g.stroke();
      g.strokeStyle = 'rgba(200,140,100,0.35)'; g.beginPath(); g.moveTo(1.5, -44); g.lineTo(1.5, -14); g.moveTo(-16, -28.5); g.lineTo(16, -28.5); g.stroke();
      // folyo
      g.beginPath(); g.moveTo(-17, -16); g.lineTo(-12, -22); g.lineTo(-6, -17); g.lineTo(0, -23); g.lineTo(6, -17); g.lineTo(12, -22); g.lineTo(17, -16); g.lineTo(17, -10); g.lineTo(-17, -10); g.closePath();
      g.fillStyle = lin(g, -17, 0, 17, 0, [[0, '#a0a8b0'], [0.4, '#f4f6f8'], [1, '#8a929a']]); g.fill(); outline(g, '#5a6268', 1.2);
      // ambalaj
      rr(g, -18, -12, 36, 56, 3); g.fillStyle = lin(g, -18, 0, 18, 0, [[0, '#5a1f6a'], [0.4, '#8a3aa0'], [1, '#4a185a']]); g.fill(); outline(g, '#2e0a3a');
      g.fillStyle = '#f2c84b'; rr(g, -18, 8, 36, 12, 0); g.fill();
      g.fillStyle = '#5a1f6a'; g.font = '900 8px ' + FONT_T; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ÇİKOLATA', 0, 14.5);
      ell(g, 0, 30, 9, 6); g.fillStyle = '#6a3018'; g.fill(); g.strokeStyle = '#f2c84b'; g.lineWidth = 1; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(-12, -10, 4, 52);
      g.restore();
    },
    simit(g) {
      const ro = 42, ri = 17;
      g.beginPath(); g.arc(0, 0, ro, 0, TAU); g.arc(0, 0, ri, 0, TAU, true);
      g.fillStyle = rad(g, 0, 0, ri, ro, [[0, '#9a5418'], [0.45, '#d08a3a'], [0.75, '#b8692a'], [1, '#7a4012']]); g.fill('evenodd');
      g.strokeStyle = '#5a2c08'; g.lineWidth = 2.2; g.beginPath(); g.arc(0, 0, ro, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, ri, 0, TAU); g.stroke();
      // burgu
      g.strokeStyle = 'rgba(90,40,8,0.45)'; g.lineWidth = 2;
      for (let i = 0; i < 14; i++) { const a = i * TAU / 14; g.beginPath(); g.moveTo(Math.cos(a) * (ri + 3), Math.sin(a) * (ri + 3)); g.quadraticCurveTo(Math.cos(a + 0.25) * 30, Math.sin(a + 0.25) * 30, Math.cos(a + 0.12) * (ro - 3), Math.sin(a + 0.12) * (ro - 3)); g.stroke(); }
      g.strokeStyle = 'rgba(255,220,160,0.35)'; g.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) { const a = i * TAU / 14 + 0.12; g.beginPath(); g.moveTo(Math.cos(a) * (ri + 4), Math.sin(a) * (ri + 4)); g.quadraticCurveTo(Math.cos(a + 0.25) * 31, Math.sin(a + 0.25) * 31, Math.cos(a + 0.12) * (ro - 4), Math.sin(a + 0.12) * (ro - 4)); g.stroke(); }
      // susam
      const R = rng(71);
      for (let i = 0; i < 70; i++) {
        const a = R() * TAU, d = ri + 3 + R() * (ro - ri - 6);
        ell(g, Math.cos(a) * d, Math.sin(a) * d, 2.2, 1.1, a + 1.57 + (R() - 0.5));
        g.fillStyle = R() < 0.8 ? '#fff1c8' : '#e8c47a'; g.fill();
      }
      g.beginPath(); g.arc(0, 0, ro - 6, Math.PI * 1.1, Math.PI * 1.5); g.strokeStyle = 'rgba(255,240,200,0.5)'; g.lineWidth = 4; g.stroke();
    },
    pogaca(g) {
      ell(g, 0, 22, 40, 10); g.fillStyle = '#b0702a'; g.fill();
      g.beginPath(); g.moveTo(-40, 20); g.bezierCurveTo(-42, -34, 42, -34, 40, 20); g.quadraticCurveTo(0, 30, -40, 20); g.closePath();
      g.fillStyle = rad(g, -10, -14, 2, 50, [[0, '#f6c878'], [0.5, '#e2a050'], [1, '#b0702a']]); g.fill(); outline(g, '#7a4614');
      g.strokeStyle = 'rgba(140,80,20,0.4)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-30, 12); g.quadraticCurveTo(0, 20, 30, 12); g.stroke();
      const R = rng(72);
      for (let i = 0; i < 16; i++) { const x = (R() - 0.5) * 50, y = -14 + R() * 18 + Math.abs(x) * 0.15; ell(g, x, y, 1.8, 0.9, R() * 3); g.fillStyle = '#1a1410'; g.fill(); }
      gloss(g, -12, -14, 16, 6, -0.3, 0.55);
      gloss(g, 14, -6, 6, 3, -0.3, 0.3);
    },
    et_doner(g) { wrapDurum(g, '#fbfaf6', 'rgba(210,50,40,0.75)', () => donerFill('#8b4a22')(g)); },
    tavuk_doner(g) { wrapDurum(g, '#fff4d6', 'rgba(240,150,20,0.8)', () => donerFill('#e2b46a')(g)); },
    hazir_cigkofte(g) {
      wrapDurum(g, '#f6fbf2', 'rgba(60,150,60,0.75)', () => {
        const R = rng(8);
        for (let i = 0; i < 10; i++) { ell(g, (R() - 0.5) * 24, -36 + (R() - 0.5) * 9, 3.5, 2.2, R() * 3); g.fillStyle = R() < 0.6 ? '#8c2a1a' : '#6a1a0e'; g.fill(); }
        for (let i = 0; i < 6; i++) { ell(g, (R() - 0.5) * 24, -36 + (R() - 0.5) * 8, 3, 1.4, R() * 3); g.fillStyle = '#6dbb3c'; g.fill(); }
      });
    },
    lahmacun(g) {
      blobPath(g, 0, 2, 46, 40, 91, 0.05); g.fillStyle = '#c98a48'; g.fill(); outline(g, '#7a4618');
      blobPath(g, 0, 0, 44, 38, 92, 0.06); g.fillStyle = rad(g, -10, -10, 2, 50, [[0, '#f0c27e'], [1, '#d99a52']]); g.fill();
      blobPath(g, 0, 0, 38, 32, 93, 0.08); g.fillStyle = rad(g, -8, -8, 2, 40, [[0, '#d0583a'], [1, '#a83a22']]); g.fill();
      g.save(); g.clip();
      const R = rng(94);
      for (let i = 0; i < 70; i++) { circ(g, (R() - 0.5) * 76, (R() - 0.5) * 64, 1 + R() * 1.8); g.fillStyle = R() < 0.5 ? '#7a2010' : '#e0784a'; g.fill(); }
      for (let i = 0; i < 10; i++) { ell(g, (R() - 0.5) * 60, (R() - 0.5) * 50, 2.6, 1.3, R() * 3); g.fillStyle = '#3e9b3a'; g.fill(); }
      g.restore();
      for (let i = 0; i < 10; i++) { const a = i * TAU / 10; circ(g, Math.cos(a) * 41, Math.sin(a) * 35, 2.4); g.fillStyle = 'rgba(120,60,20,0.5)'; g.fill(); }
      g.save(); g.translate(30, 26); g.rotate(-0.6); lemonSlice(g, 0, 0, 13, true); g.restore();
      parsleySprig(g, -28, 24, 0.55, 0.5);
    },
    kiymali_pide(g) {
      g.save(); g.rotate(-0.15);
      g.beginPath(); g.moveTo(-50, 0); g.bezierCurveTo(-30, -26, 30, -26, 50, 0); g.bezierCurveTo(30, 26, -30, 26, -50, 0); g.closePath();
      g.fillStyle = lin(g, 0, -22, 0, 22, [[0, '#f0be6e'], [0.5, '#d8963e'], [1, '#a8662a']]); g.fill(); outline(g, '#7a4614');
      g.beginPath(); g.moveTo(-38, 0); g.bezierCurveTo(-22, -15, 22, -15, 38, 0); g.bezierCurveTo(22, 15, -22, 15, -38, 0); g.closePath();
      g.fillStyle = rad(g, -6, -4, 2, 36, [[0, '#b0502a'], [1, '#7a3216']]); g.fill();
      g.save(); g.clip();
      const R = rng(95);
      for (let i = 0; i < 60; i++) { circ(g, (R() - 0.5) * 72, (R() - 0.5) * 26, 1 + R() * 1.6); g.fillStyle = R() < 0.5 ? '#5a2010' : '#d0683a'; g.fill(); }
      for (let i = 0; i < 6; i++) { ell(g, (R() - 0.5) * 56, (R() - 0.5) * 18, 3, 1.5, R() * 3); g.fillStyle = '#4fa83a'; g.fill(); }
      for (let i = 0; i < 4; i++) { ell(g, (R() - 0.5) * 50, (R() - 0.5) * 14, 2.6, 1.6, R() * 3); g.fillStyle = '#e8402f'; g.fill(); }
      g.fillStyle = 'rgba(255,220,120,0.25)'; ell(g, -8, -4, 16, 4, -0.1); g.fill();
      g.restore();
      g.strokeStyle = 'rgba(90,40,10,0.55)'; g.lineWidth = 1.5;
      g.beginPath(); for (const sx of [-22, -6, 10, 26]) { g.moveTo(sx, -18); g.lineTo(sx + 2, 18); } g.stroke();
      gloss(g, -16, -15, 14, 3, -0.1, 0.45);
      g.restore();
    },
  };
  function fallbackProduct(g, id) {
    const c = colorOf(id);
    rr(g, -26, -36, 52, 76, 8);
    g.fillStyle = lin(g, -26, 0, 26, 0, [[0, shade(c, -0.2)], [0.4, shade(c, 0.25)], [1, shade(c, -0.25)]]); g.fill(); outline(g, shade(c, -0.5));
    rr(g, -20, -8, 40, 20, 4); g.fillStyle = '#fffaf0'; g.fill();
    const n = String(nameOf(id) || '?');
    g.fillStyle = shade(c, -0.4); g.font = '900 10px ' + FONT_T; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n.slice(0, 8).toLocaleUpperCase('tr-TR'), 0, 2, 38);
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(-18, -32, 5, 68);
  }
  function drawProduct(ctx, id, x, y, size) {
    try {
      size = size || 60;
      const fn = PROD[id];
      sprite(ctx, 'prod:' + id, x, y, size * 1.3, (g) => {
        g.scale(size / 100, size / 100);
        if (fn) fn(g); else fallbackProduct(g, id);
      }, true);
    } catch (e) { /* yok */ }
  }

  Object.assign(Art, { drawIngredient, drawProduct });
  Object.assign(Art._h, { outline, gloss, blobPath, breadPath, breadSlice, tomatoSlice, sucukSlice, onionRing, lettuceLeaf, pickleSlice, cheeseSlice,
    kofte, fry, cigkoftePiece, parsleySprig, lemonSlice, pepper, colorOf, ING, PROD, q2 });
})(window.KS);
/* ===== Art bölüm 4: tabak yemekleri (dish), çay bardağı, bez ve drawItem ===== */
(function (KS) {
  'use strict';
  const Art = KS.Art, H = Art._h;
  const { TAU, FONT_D, clamp, rr, ell, circ, shade, mix, rgba, ramp, lin, rad, rng, hashStr, sprite, outline, gloss, blobPath,
    breadSlice, tomatoSlice, sucukSlice, onionRing, lettuceLeaf, pickleSlice, cheeseSlice, kofte, fry, cigkoftePiece, parsleySprig, lemonSlice,
    colorOf, ING, MEAT, FRY, q2 } = H;

  // ---------------------------------------------------------------------------
  // ÇAY BARDAĞI (ince belli) — 100 birim kutu, merkez 0,0
  // ---------------------------------------------------------------------------
  function glassPath(g) {
    g.beginPath();
    g.moveTo(-17, -34);
    g.bezierCurveTo(-16, -18, -10, -12, -10.5, -2);
    g.bezierCurveTo(-11, 6, -16, 10, -15.5, 20);
    g.quadraticCurveTo(-15, 28, -12, 30);
    g.lineTo(12, 30);
    g.quadraticCurveTo(15, 28, 15.5, 20);
    g.bezierCurveTo(16, 10, 11, 6, 10.5, -2);
    g.bezierCurveTo(10, -12, 16, -18, 17, -34);
    g.closePath();
  }
  // level: 0..1 (çay seviyesi), q: demlik kalitesi (renk), saucer: tabak
  function teaGlass(g, level, q, saucer) {
    level = clamp(level == null ? 0.88 : level, 0, 1);
    q = q == null ? 1 : q;
    if (saucer) {
      ell(g, 0, 36, 38, 10); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fill();
      ell(g, 0, 33, 38, 10); g.fillStyle = lin(g, 0, 23, 0, 43, [[0, '#ffffff'], [1, '#d9dde4']]); g.fill();
      outline(g, '#9aa2ae', 1.6);
      ell(g, 0, 32, 32, 7.5); g.strokeStyle = '#c9a23a'; g.lineWidth = 1.6; g.stroke();
      ell(g, 0, 32, 20, 4.5); g.fillStyle = 'rgba(160,170,185,0.35)'; g.fill();
      // kaşık + şeker
      g.save(); g.translate(24, 28); g.rotate(-0.25);
      rr(g, -1.2, -10, 2.4, 16, 1.2); g.fillStyle = lin(g, -2, 0, 2, 0, [[0, '#8a949e'], [0.5, '#f4f6f8'], [1, '#7a848e']]); g.fill();
      ell(g, 0, -12, 3, 4.5); g.fill(); g.restore();
      rr(g, -30, 24, 9, 8, 1.5); g.fillStyle = '#ffffff'; g.fill(); outline(g, 'rgba(0,0,0,0.2)', 0.8);
    }
    // çay
    if (level > 0.02) {
      const ly = 30 - 62 * level;
      const tea = ramp([[0, '#e8a050'], [0.5, '#c4501c'], [0.85, '#a82a0e'], [1, '#9a2408']], q);
      g.save(); glassPath(g); g.clip();
      g.fillStyle = lin(g, -16, 0, 16, 0, [[0, shade(tea, -0.35)], [0.35, shade(tea, 0.15)], [0.6, tea], [1, shade(tea, -0.4)]]);
      g.fillRect(-20, ly, 40, 70);
      ell(g, 0, ly, 18, 2.6); g.fillStyle = shade(tea, 0.3); g.fill();
      g.fillStyle = 'rgba(255,200,140,0.35)'; ell(g, -6, 16, 3, 8); g.fill();
      g.restore();
    }
    // cam
    glassPath(g); g.fillStyle = 'rgba(230,240,250,0.16)'; g.fill();
    outline(g, 'rgba(120,140,160,0.85)', 1.6);
    ell(g, 0, -34, 17, 3); g.strokeStyle = 'rgba(160,175,190,0.9)'; g.lineWidth = 1.4; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-12, -28); g.bezierCurveTo(-11, -16, -7, -12, -7.5, -4); g.stroke();
    g.beginPath(); g.moveTo(-11, 10); g.quadraticCurveTo(-13, 18, -11, 24); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(11, -26); g.bezierCurveTo(10, -16, 7, -12, 7, -4); g.stroke();
    ell(g, 0, 30, 12, 2.2); g.fillStyle = 'rgba(200,215,230,0.6)'; g.fill();
  }
  H.teaGlass = teaGlass;

  // ---------------------------------------------------------------------------
  // SOS / BAHARAT YARDIMCILARI
  // ---------------------------------------------------------------------------
  const SAUCE = { ketcap: '#d1261b', mayonez: '#f7f0d4', nar_eksisi: '#5e0f1e' };
  function drizzle(g, col, x0, x1, yc, amp, n, lw, seed) {
    const R = rng(seed || 1);
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * i / n + (R() - 0.5) * 3, yc + (i % 2 ? -amp : amp) + (R() - 0.5) * 3]);
    const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) { const p = pts[i - 1], q = pts[i]; g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); } g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
    g.lineCap = 'round'; g.lineJoin = 'round';
    path(); g.strokeStyle = shade(col, -0.45); g.lineWidth = lw + 1.6; g.stroke();
    path(); g.strokeStyle = col; g.lineWidth = lw; g.stroke();
    g.save(); g.translate(-lw * 0.18, -lw * 0.22); path(); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = lw * 0.28; g.stroke(); g.restore();
  }
  function sprinkle(g, kind, cx, cy, rx, ry, seed, n) {
    const R = rng(seed || 2); n = n || 26;
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = Math.sqrt(R());
      const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
      if (kind === 'tuz') { g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(x, y, 1.6, 1.6); g.fillStyle = 'rgba(150,160,170,0.5)'; g.fillRect(x + 1.6, y + 1.2, 0.6, 0.6); }
      else if (kind === 'pul_biber') { g.save(); g.translate(x, y); g.rotate(R() * 3); g.fillStyle = R() < 0.6 ? '#d8361e' : R() < 0.5 ? '#8a1a0e' : '#f2a640'; g.fillRect(-1.6, -0.9, 3.2, 1.8); g.restore(); }
      else if (kind === 'maydanoz') { ell(g, x, y, 2.4, 1.5, R() * 3); g.fillStyle = R() < 0.5 ? '#2f8a32' : '#5cb84a'; g.fill(); }
      else if (kind === 'limon') { ell(g, x, y, 1.8, 2.4, 0); g.fillStyle = 'rgba(255,240,120,0.85)'; g.fill(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x - 0.6, y - 1.2, 0.8, 0.8); }
      else { circ(g, x, y, 1.2); g.fillStyle = colorOf(kind); g.fill(); }
    }
  }
  const SPICE = { tuz: 1, pul_biber: 1 };

  // ---------------------------------------------------------------------------
  // ÜSTTEN GÖRÜNÜM KATMANLARI (açık tost, açık lavaş)
  // ---------------------------------------------------------------------------
  function topLayer(g, L, idx, cx, cy, Rr, seed) {
    const id = L.id, R = rng(seed + idx * 31);
    const jx = () => cx + (R() - 0.5) * Rr * 0.5, jy = () => cy + (R() - 0.5) * Rr * 0.5;
    switch (id) {
      case 'kasar': cheeseSlice(g, jx() * 0.4 + cx * 0.6, jy() * 0.4 + cy * 0.6, Rr * 1.55, Rr * 1.45, (R() - 0.5) * 0.3, '#f8dc72'); break;
      case 'cheddar': cheeseSlice(g, jx() * 0.4 + cx * 0.6, jy() * 0.4 + cy * 0.6, Rr * 1.5, Rr * 1.45, (R() - 0.5) * 0.4, '#f7a933'); break;
      case 'sucuk': { const pts = [[-0.5, -0.45], [0.45, -0.4], [0, 0.05], [-0.5, 0.5], [0.48, 0.5]]; pts.forEach((p, i) => sucukSlice(g, cx + p[0] * Rr + (R() - 0.5) * 4, cy + p[1] * Rr + (R() - 0.5) * 4, Rr * 0.3, seed + i)); break; }
      case 'domates': { const pts = [[-0.42, -0.3], [0.42, -0.2], [0, 0.42]]; pts.forEach(p => tomatoSlice(g, cx + p[0] * Rr, cy + p[1] * Rr, Rr * 0.4, R() * 3)); break; }
      case 'kofte': { const c = L.cook || 0; const top = L.cookB != null ? Math.max(L.cookA || 0, L.cookB) : c; kofte(g, cx - Rr * 0.35, cy, Rr * 0.42, Rr * 0.28, top, top, 9); kofte(g, cx + Rr * 0.38, cy + Rr * 0.1, Rr * 0.42, Rr * 0.28, top, top, 10); break; }
      case 'marul': lettuceLeaf(g, jx(), jy(), Rr / 34, (R() - 0.5) * 1.5, seed + idx); break;
      case 'sogan': { const pts = [[-0.4, -0.35], [0.4, -0.3], [-0.2, 0.35], [0.35, 0.4]]; pts.forEach(p => onionRing(g, cx + p[0] * Rr, cy + p[1] * Rr, Rr * 0.22, false)); break; }
      case 'tursu': { const pts = [[-0.45, 0], [0, -0.4], [0.45, 0.05], [0, 0.42]]; pts.forEach(p => pickleSlice(g, cx + p[0] * Rr, cy + p[1] * Rr, Rr * 0.2)); break; }
      case 'cigkofte': cigkoftePiece(g, cx, cy - Rr * 0.25, Rr / 30, (R() - 0.5) * 0.6, seed + idx); cigkoftePiece(g, cx + 2, cy + Rr * 0.25, Rr / 30, (R() - 0.5) * 0.6, seed + idx + 1); break;
      case 'patates': for (let i = 0; i < 6; i++) fry(g, cx + (R() - 0.5) * Rr, cy + (R() - 0.5) * Rr * 0.8, Rr * 0.16, Rr * 0.9, R() * 3, L.cook == null ? 1 : L.cook, i); break;
      case 'maydanoz': sprinkle(g, 'maydanoz', cx, cy, Rr * 0.9, Rr * 0.8, seed + idx, 30); parsleySprig(g, jx(), jy(), Rr / 70, R() * 2); break;
      case 'limon': g.save(); g.translate(cx + Rr * 0.5, cy - Rr * 0.5); g.rotate(0.6); lemonSlice(g, 0, 0, Rr * 0.32, true); g.restore(); sprinkle(g, 'limon', cx, cy, Rr * 0.8, Rr * 0.7, seed + idx, 10); break;
      case 'tuz': case 'pul_biber': sprinkle(g, id, cx, cy, Rr * 0.95, Rr * 0.9, seed + idx, id === 'tuz' ? 34 : 40); break;
      case 'ketcap': case 'mayonez': case 'nar_eksisi':
        for (let k = 0; k < 2; k++) drizzle(g, SAUCE[id], cx - Rr * 0.85, cx + Rr * 0.85, cy - Rr * 0.3 + k * Rr * 0.6 + (R() - 0.5) * 4, Rr * 0.16, 7, id === 'nar_eksisi' ? 2.6 : 3.4, seed + idx + k);
        break;
      default: {
        const fn = ING[id];
        g.save(); g.translate(jx(), jy()); g.scale(Rr / 70, Rr / 70);
        if (fn) fn(g, L); else { circ(g, 0, 0, 30); g.fillStyle = colorOf(id); g.fill(); outline(g, shade(colorOf(id), -0.5)); }
        g.restore();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // YANDAN GÖRÜNÜM BANTLARI (ekmek arası, hamburger)
  // ---------------------------------------------------------------------------
  const THICK = { kofte: 12, kasar: 4, cheddar: 4, sucuk: 6, domates: 6, sogan: 4, marul: 7, tursu: 5, cigkofte: 9, patates: 7, maydanoz: 3, limon: 2, ketcap: 2, mayonez: 2, nar_eksisi: 2, tuz: 0, pul_biber: 0 };
  function sideBand(g, L, x0, x1, yb, th, wide, seed) {
    // yb = bandın alt çizgisi; bant yb-th .. yb
    const id = L.id, w = x1 - x0, cx = (x0 + x1) / 2, yc = yb - th / 2, R = rng(seed);
    switch (id) {
      case 'kofte': {
        const c = L.cook != null ? L.cook : 1;
        const col = ramp(MEAT, c);
        if (wide) {
          rr(g, x0 - 3, yb - th, w + 6, th, th * 0.45);
          g.fillStyle = lin(g, 0, yb - th, 0, yb, [[0, shade(col, 0.15)], [1, shade(col, -0.3)]]); g.fill(); outline(g, shade(col, -0.55), 1.6);
          for (let i = 0; i < 30; i++) { circ(g, x0 + R() * w, yb - th + 2 + R() * (th - 4), 0.8 + R()); g.fillStyle = rgba(shade(col, R() < 0.5 ? -0.4 : 0.25), 0.6); g.fill(); }
          if (c > 0.35) { g.strokeStyle = rgba('#1a0c06', clamp((c - 0.35) / 0.6, 0, 1) * 0.5); g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0 + 2, yb - th + 2.5); g.lineTo(x1 - 2, yb - th + 2.5); g.stroke(); }
          gloss(g, cx - w * 0.2, yb - th + 2.5, w * 0.18, 1.2, 0, 0.3);
        } else {
          const n = 3, rx = w / (n * 2) + 2;
          for (let i = 0; i < n; i++) {
            const x = x0 + rx - 2 + i * (w - 2 * rx + 4) / (n - 1);
            ell(g, x, yc, rx, th / 2 + 1, 0);
            g.fillStyle = rad(g, x - rx * 0.3, yc - th * 0.3, 1, rx * 1.2, [[0, shade(col, 0.2)], [1, shade(col, -0.25)]]); g.fill(); outline(g, shade(col, -0.55), 1.4);
            if (c > 0.35) { g.strokeStyle = rgba('#1a0c06', clamp((c - 0.35) / 0.6, 0, 1) * 0.55); g.lineWidth = 2; g.beginPath(); for (let k = -1; k <= 1; k++) { g.moveTo(x + k * rx * 0.5 - 3, yc + th * 0.35); g.lineTo(x + k * rx * 0.5 + 3, yc - th * 0.35); } g.stroke(); }
            gloss(g, x - rx * 0.3, yc - th * 0.25, rx * 0.35, 1.3, 0, 0.3);
          }
        }
        break;
      }
      case 'kasar': case 'cheddar': {
        const col = id === 'kasar' ? '#f6d55c' : '#f39a22';
        g.beginPath(); g.moveTo(x0 - 4, yb - th);
        g.lineTo(x1 + 4, yb - th); g.lineTo(x1 + 4, yb);
        const drips = wide ? [[0.9, 7], [0.62, 4], [0.3, 9], [0.08, 5]] : [[0.85, 5], [0.5, 7], [0.15, 4]];
        for (const d of drips) { const dx = x0 + w * d[0]; g.lineTo(dx + 4, yb); g.quadraticCurveTo(dx + 3, yb + d[1], dx, yb + d[1]); g.quadraticCurveTo(dx - 3, yb + d[1], dx - 4, yb); }
        g.lineTo(x0 - 4, yb); g.closePath();
        g.fillStyle = lin(g, 0, yb - th, 0, yb + 8, [[0, shade(col, 0.3)], [1, shade(col, -0.1)]]); g.fill(); outline(g, shade(col, -0.4), 1.2);
        break;
      }
      case 'sucuk': {
        const n = Math.max(3, Math.round(w / 15));
        for (let i = 0; i < n; i++) { const x = x0 + 6 + i * (w - 12) / (n - 1); ell(g, x, yc, 8, th / 2 + 0.5, 0); g.fillStyle = lin(g, 0, yc - th / 2, 0, yc + th / 2, [[0, '#c8452e'], [1, '#7a1a10']]); g.fill(); outline(g, '#3a0a06', 1); }
        break;
      }
      case 'domates': {
        const n = Math.max(2, Math.round(w / 26));
        for (let i = 0; i < n; i++) {
          const sx = x0 - 3 + i * (w + 6) / n, sw = (w + 6) / n + 2;
          rr(g, sx, yb - th, sw, th, th / 2); g.fillStyle = '#d42f24'; g.fill(); outline(g, '#8a1a12', 1.1);
          rr(g, sx + 2, yb - th + 1.5, sw - 4, th - 3, (th - 3) / 2); g.fillStyle = '#ff7a5c'; g.fill();
          for (let k = 0; k < 3; k++) { circ(g, sx + 4 + k * (sw - 8) / 2, yc, 1); g.fillStyle = '#f7e6a6'; g.fill(); }
        }
        break;
      }
      case 'sogan': {
        g.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const x = x0 + 4 + i * (w - 8) / 3 + (R() - 0.5) * 4;
          ell(g, x, yc, 9, th / 2 + 1); g.strokeStyle = '#9c5aa0'; g.lineWidth = 2.4; g.stroke();
          ell(g, x, yc, 9, th / 2 + 1); g.strokeStyle = '#f2e2f2'; g.lineWidth = 1; g.stroke();
        }
        break;
      }
      case 'marul': {
        g.beginPath(); g.moveTo(x0 - 7, yb);
        const n = 12;
        for (let i = 0; i <= n; i++) { const x = x0 - 7 + (w + 14) * i / n; g.quadraticCurveTo(x - (w + 14) / n / 2, yb - th - 3 - (i % 2 ? 4 : 0), x, yb - th + (i % 2 ? 0 : 2)); }
        g.lineTo(x1 + 7, yb + 2); g.quadraticCurveTo(cx, yb + 5, x0 - 7, yb + 2); g.closePath();
        g.fillStyle = lin(g, 0, yb - th - 4, 0, yb + 3, [[0, '#a8de62'], [1, '#4e9a2c']]); g.fill(); outline(g, '#3a7a22', 1.2);
        g.strokeStyle = 'rgba(240,255,210,0.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, yb - 2); g.quadraticCurveTo(cx, yb - th, x1, yb - 2); g.stroke();
        break;
      }
      case 'tursu': {
        const n = Math.max(3, Math.round(w / 17));
        for (let i = 0; i < n; i++) { const x = x0 + 6 + i * (w - 12) / (n - 1); ell(g, x, yc, 7, th / 2 + 0.5); g.fillStyle = lin(g, 0, yc - th / 2, 0, yc + th / 2, [[0, '#c9d870'], [1, '#6f8f2a']]); g.fill(); outline(g, '#3e5512', 1); }
        break;
      }
      case 'cigkofte': {
        rr(g, x0 - 1, yb - th, w + 2, th, th / 2);
        g.fillStyle = lin(g, 0, yb - th, 0, yb, [[0, '#b2442a'], [1, '#62180e']]); g.fill(); outline(g, '#4a0f08', 1.3);
        g.strokeStyle = 'rgba(60,12,6,0.6)'; g.lineWidth = 1.4;
        g.beginPath(); for (let x = x0 + 8; x < x1 - 4; x += 10) { g.moveTo(x, yb - th + 1.5); g.quadraticCurveTo(x + 3, yc, x, yb - 1.5); } g.stroke();
        break;
      }
      case 'patates': {
        for (let i = 0; i < 4; i++) { fry(g, cx + (i - 1.5) * 4, yc + (R() - 0.5) * 3, th * 0.8, w * 0.95, Math.PI / 2 + (R() - 0.5) * 0.15, L.cook == null ? 1 : L.cook, i); }
        break;
      }
      case 'ketcap': case 'mayonez': case 'nar_eksisi': {
        const col = SAUCE[id];
        drizzle(g, col, x0 + 2, x1 - 2, yb - 1, 2.2, 8, id === 'nar_eksisi' ? 2.2 : 3, seed);
        for (let k = 0; k < 3; k++) { const x = x0 + w * (0.2 + k * 0.3); g.beginPath(); g.moveTo(x - 2.4, yb); g.quadraticCurveTo(x, yb + 7, x + 2.4, yb); g.fillStyle = col; g.fill(); }
        break;
      }
      case 'maydanoz': sprinkle(g, 'maydanoz', cx, yb - 1, w / 2, 3, seed, 22); break;
      case 'limon': sprinkle(g, 'limon', cx, yb - 2, w / 2, 3, seed, 9); break;
      case 'tuz': case 'pul_biber': sprinkle(g, id, cx, yb - 1, w / 2, 2.5, seed, 24); break;
      default: {
        const col = colorOf(id);
        rr(g, x0, yb - th, w, th, th / 2); g.fillStyle = lin(g, 0, yb - th, 0, yb, [[0, shade(col, 0.25)], [1, shade(col, -0.2)]]); g.fill(); outline(g, shade(col, -0.5), 1.1);
      }
    }
  }
  function stackHeights(layers, maxH) {
    const hs = layers.map(L => (THICK[L.id] != null ? THICK[L.id] : 5));
    const tot = hs.reduce((a, b) => a + b, 0);
    const f = tot > maxH ? maxH / tot : 1;
    return { hs: hs.map(h => h * f), tot: tot * f };
  }

  // ---------------------------------------------------------------------------
  // YEMEK TABANLARI
  // ---------------------------------------------------------------------------
  const DISH = {
    tost_ekmegi(g, it) {
      const layers = it.layers || [], toast = it.toast || 0;
      if (toast < 0.05) {
        breadSlice(g, 86, 88, 0, 11);
        layers.forEach((L, i) => topLayer(g, L, i, 0, 6, 26, 101));
        return;
      }
      // kapalı tost (preslenmiş)
      const has = id => layers.some(L => L.id === id);
      const melt = clamp(toast, 0, 1.2);
      // kenardan taşan iç malzemeler
      const peek = [];
      for (const L of layers) { if (!peek.includes(L.id)) peek.push(L.id); }
      peek.forEach((id, i) => {
        if (id === 'kasar') return;
        const col = id === 'sucuk' ? '#a8332a' : id === 'domates' ? '#e5402f' : id === 'cheddar' ? '#f39a22' : colorOf(id);
        const spots = [[-44, 10 + i * 6], [44, -4 + i * 7], [-20 + i * 14, 46]];
        for (const s of spots) { ell(g, s[0], s[1], 6, 4.5, 0); g.fillStyle = col; g.fill(); outline(g, shade(col, -0.45), 1); }
      });
      // alt dilim (kalınlık)
      g.save(); g.translate(2, 5); breadSlice(g, 86, 88, Math.max(0, toast * 0.9), 12); g.restore();
      // erimiş kaşar katmanı
      if (has('kasar') || has('cheddar')) {
        const col = has('kasar') ? (toast > 1.5 ? '#c49a3a' : '#f7d24a') : '#f39a22';
        g.beginPath(); g.moveTo(-44, 38); g.lineTo(44, 38);
        g.lineTo(44, 40 + melt * 4); g.quadraticCurveTo(40, 40 + melt * 12, 36, 40 + melt * 4);
        g.lineTo(10, 41); g.quadraticCurveTo(6, 42 + melt * 14, 0, 41);
        g.lineTo(-24, 41 + melt * 3); g.quadraticCurveTo(-28, 42 + melt * 10, -32, 41); g.lineTo(-44, 40); g.closePath();
        g.fillStyle = lin(g, 0, 36, 0, 54, [[0, shade(col, 0.25)], [1, shade(col, -0.1)]]); g.fill(); outline(g, shade(col, -0.35), 1.1);
        // yan taşma
        g.beginPath(); g.moveTo(43, -6); g.quadraticCurveTo(46 + melt * 5, 0, 43, 8 + melt * 6); g.lineTo(41, 10); g.closePath(); g.fillStyle = col; g.fill();
        g.beginPath(); g.moveTo(-43, -2); g.quadraticCurveTo(-46 - melt * 5, 6, -43, 14 + melt * 4); g.lineTo(-41, 12); g.closePath(); g.fill();
      }
      // üst dilim
      breadSlice(g, 86, 88, toast, 11);
      // eriyip üstten akan damla
      if ((has('kasar') || has('cheddar')) && toast > 0.4 && toast < 1.6) {
        const col = has('kasar') ? '#f7d24a' : '#f39a22';
        g.beginPath(); g.moveTo(14, 37); g.quadraticCurveTo(16, 46 + melt * 6, 20, 37); g.fillStyle = col; g.fill();
        gloss(g, 16, 40, 1.2, 2.5, 0, 0.6);
      }
    },
    yarim_ekmek(g, it) {
      const layers = it.layers || [];
      const { hs, tot } = stackHeights(layers, 40);
      const base = 14 + tot * 0.35;
      const lidY = base - tot - 4;
      // üst yarı (kapak, arkada)
      g.beginPath(); g.moveTo(-50, lidY + 4); g.bezierCurveTo(-46, lidY - 26, 40, lidY - 30, 50, lidY - 2); g.quadraticCurveTo(52, lidY + 4, 44, lidY + 6); g.lineTo(-44, lidY + 8); g.closePath();
      g.fillStyle = lin(g, 0, lidY - 26, 0, lidY + 6, [[0, '#e8ae60'], [0.6, '#c98638'], [1, '#a8662a']]); g.fill(); outline(g, '#6e3c12');
      g.strokeStyle = 'rgba(255,225,160,0.8)'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); for (const sx of [-28, -8, 12, 30]) { g.moveTo(sx - 6, lidY - 10); g.quadraticCurveTo(sx, lidY - 18, sx + 7, lidY - 17); } g.stroke();
      ell(g, 0, lidY + 5, 45, 5); g.fillStyle = '#f6e2b2'; g.fill();
      // alt yarı iç yüzü
      ell(g, 0, base, 46, 7); g.fillStyle = rad(g, -10, base - 2, 2, 46, [[0, '#fff3d6'], [1, '#ecd09a']]); g.fill(); outline(g, '#c49a5a', 1.2);
      // dolgu
      let y = base + 2;
      layers.forEach((L, i) => { sideBand(g, L, -40, 40, y, hs[i], false, 200 + i * 13); y -= hs[i]; });
      // alt kabuk (ön)
      g.beginPath(); g.moveTo(-50, base - 1); g.quadraticCurveTo(-52, base + 20, -40, base + 22); g.lineTo(40, base + 22); g.quadraticCurveTo(52, base + 20, 50, base - 1);
      g.quadraticCurveTo(0, base + 8, -50, base - 1); g.closePath();
      g.fillStyle = lin(g, 0, base, 0, base + 22, [[0, '#d99a4c'], [1, '#9a5e22']]); g.fill(); outline(g, '#6e3c12');
      g.strokeStyle = 'rgba(255,230,180,0.6)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-46, base + 1); g.quadraticCurveTo(0, base + 9, 46, base + 1); g.stroke();
      gloss(g, -18, base + 12, 14, 2.5, 0, 0.3);
    },
    hamburger_ekmegi(g, it) {
      const layers = it.layers || [];
      const { hs, tot } = stackHeights(layers, 46);
      const by = (tot + 12) / 2 - 4;
      // alt ekmek
      rr(g, -42, by, 84, 18, 9); g.fillStyle = lin(g, 0, by, 0, by + 18, [[0, '#e8b86a'], [0.4, '#d48a3a'], [1, '#a35e22']]); g.fill(); outline(g, '#7a4614');
      rr(g, -40, by, 80, 5, 2.5); g.fillStyle = '#f6e3bb'; g.fill();
      let y = by + 1;
      layers.forEach((L, i) => { sideBand(g, L, -40, 40, y, hs[i], true, 300 + i * 17); y -= hs[i]; });
      // üst ekmek
      const ty = y + 1;
      g.beginPath(); g.moveTo(-44, ty); g.bezierCurveTo(-44, ty - 40, 44, ty - 40, 44, ty); g.quadraticCurveTo(44, ty + 4, 38, ty + 4); g.lineTo(-38, ty + 4); g.quadraticCurveTo(-44, ty + 4, -44, ty); g.closePath();
      g.fillStyle = rad(g, -12, ty - 24, 2, 56, [[0, '#f2bb6c'], [0.5, '#d48a3a'], [1, '#a35e22']]); g.fill(); outline(g, '#7a4614');
      const R = rng(81);
      for (let i = 0; i < 16; i++) { const x = (R() - 0.5) * 64, yy = ty - 8 - R() * 20 + Math.abs(x) * 0.28; ell(g, x, yy, 2.6, 1.3, R() * 3); g.fillStyle = '#fff6dc'; g.fill(); }
      gloss(g, -14, ty - 22, 14, 5, -0.3, 0.45);
    },
    lavas(g, it) {
      const layers = it.layers || [];
      const rolled = layers.some(L => L.id === 'cigkofte');
      if (!rolled) {
        blobPath(g, 2, 3, 47, 44, 61, 0.05); g.fillStyle = '#e2c88e'; g.fill();
        blobPath(g, 0, 0, 47, 44, 62, 0.05); g.fillStyle = rad(g, -12, -12, 4, 52, [[0, '#fbefd0'], [1, '#ecd39c']]); g.fill(); outline(g, '#b08e58', 1.8);
        g.save(); g.clip(); const R = rng(63);
        for (let i = 0; i < 20; i++) { const a = R() * TAU, d = R() * 40; ell(g, Math.cos(a) * d, Math.sin(a) * d, 2 + R() * 4, 1.5 + R() * 3, R() * 3); g.fillStyle = R() < 0.6 ? 'rgba(200,150,80,0.45)' : 'rgba(120,70,30,0.4)'; g.fill(); }
        g.restore();
        layers.forEach((L, i) => topLayer(g, L, i, 0, 0, 27, 401));
        return;
      }
      // sarılmış dürüm
      g.save(); g.rotate(-0.42);
      const body = () => { g.beginPath(); g.moveTo(-44, -12); g.quadraticCurveTo(-52, 0, -44, 12); g.lineTo(-30, 17); g.lineTo(34, 17); g.lineTo(34, -17); g.lineTo(-30, -17); g.closePath(); };
      body(); g.fillStyle = lin(g, 0, -17, 0, 17, [[0, '#f8e8c0'], [0.45, '#f1dcae'], [1, '#c9a464']]); g.fill(); outline(g, '#9a7a44', 1.8);
      g.save(); body(); g.clip();
      const R = rng(64);
      for (let i = 0; i < 16; i++) { ell(g, -40 + R() * 74, (R() - 0.5) * 30, 2 + R() * 3, 1.4 + R() * 2, R() * 3); g.fillStyle = R() < 0.6 ? 'rgba(200,150,80,0.45)' : 'rgba(120,70,30,0.35)'; g.fill(); }
      g.strokeStyle = 'rgba(150,110,60,0.55)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-20, -17); g.quadraticCurveTo(-12, 0, -24, 17); g.moveTo(8, -17); g.quadraticCurveTo(16, 0, 4, 17); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-40, -12, 74, 4);
      g.restore();
      // açık uç (iç malzemeler)
      ell(g, 34, 0, 9, 17); g.fillStyle = '#e8d29e'; g.fill(); outline(g, '#9a7a44', 1.6);
      ell(g, 34, 0, 7, 14); g.fillStyle = '#8c2a1a'; g.fill();
      g.save(); ell(g, 34, 0, 7, 14); g.clip();
      const R2 = rng(65);
      for (let i = 0; i < 18; i++) { circ(g, 34 + (R2() - 0.5) * 12, (R2() - 0.5) * 26, 0.8 + R2()); g.fillStyle = R2() < 0.5 ? '#5a1208' : '#c0503a'; g.fill(); }
      layers.forEach((L, i) => {
        if (L.id === 'marul') { for (let k = 0; k < 4; k++) { ell(g, 34 + (k % 2 ? 4 : -4), -10 + k * 7, 3.5, 2.5, 0.5); g.fillStyle = '#6dbb3c'; g.fill(); } }
        else if (L.id === 'maydanoz') sprinkle(g, 'maydanoz', 34, 0, 6, 12, 500 + i, 10);
        else if (L.id === 'pul_biber') sprinkle(g, 'pul_biber', 34, 0, 6, 12, 500 + i, 12);
        else if (L.id === 'limon') sprinkle(g, 'limon', 34, 0, 6, 12, 500 + i, 6);
        else if (L.id === 'nar_eksisi') { ell(g, 33, -2, 3.5, 8, 0.2); g.fillStyle = 'rgba(94,15,30,0.85)'; g.fill(); gloss(g, 32, -5, 1, 3, 0.2, 0.6); }
        else if (L.id === 'domates') { ell(g, 35, 5, 3, 3); g.fillStyle = '#e5402f'; g.fill(); }
        else if (L.id === 'ketcap' || L.id === 'mayonez') { ell(g, 34, 4, 3, 5); g.fillStyle = SAUCE[L.id]; g.fill(); }
        else if (L.id !== 'cigkofte') { circ(g, 34, (i % 3 - 1) * 8, 2.5); g.fillStyle = colorOf(L.id); g.fill(); }
      });
      g.restore();
      // dışarı taşan marul yaprağı
      if (layers.some(L => L.id === 'marul')) {
        g.beginPath(); g.moveTo(38, -16); g.quadraticCurveTo(48, -22, 46, -10); g.quadraticCurveTo(50, -4, 42, -2); g.closePath(); g.fillStyle = '#7cc84a'; g.fill(); outline(g, '#3a7a22', 1);
      }
      g.restore();
      // limon kaması yanda
      if (layers.some(L => L.id === 'limon')) { g.save(); g.translate(-30, 30); g.rotate(-0.3); lemonSlice(g, 0, 0, 11, true); g.restore(); }
    },
    kese(g, it) {
      const layers = it.layers || [];
      const pats = layers.filter(L => L.id === 'patates');
      const cook = pats.length ? pats.reduce((a, L) => a + (L.cook == null ? 1 : L.cook), 0) / pats.length : 1;
      // kesenin arkası
      g.beginPath(); g.moveTo(-30, -10); g.lineTo(30, -10); g.lineTo(26, -4); g.lineTo(-26, -4); g.closePath(); g.fillStyle = '#8a5a2a'; g.fill();
      // patatesler
      if (pats.length) {
        const n = 9 + Math.min(3, pats.length - 1) * 3, R = rng(77);
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1), x = -22 + t * 44 + (R() - 0.5) * 5;
          fry(g, x, -20 - R() * 8, 9, 46 + R() * 10, (t - 0.5) * 0.7 + (R() - 0.5) * 0.25, cook, i);
        }
        layers.forEach((L, i) => {
          if (L.id === 'tuz') sprinkle(g, 'tuz', 0, -34, 22, 12, 600 + i, 40);
          else if (L.id === 'pul_biber') sprinkle(g, 'pul_biber', 0, -34, 22, 12, 600 + i, 30);
          else if (L.id === 'ketcap' || L.id === 'mayonez') drizzle(g, SAUCE[L.id], -20, 20, -36 + (L.id === 'mayonez' ? 8 : 0), 5, 6, 3.6, 610 + i);
          else if (L.id !== 'patates') { const fn = ING[L.id]; if (fn) { g.save(); g.translate(16, -40); g.scale(0.3, 0.3); fn(g, L); g.restore(); } }
        });
      }
      // kese önü
      g.beginPath(); g.moveTo(-32, -10); g.lineTo(32, -10); g.lineTo(25, 46); g.lineTo(-25, 46); g.closePath();
      g.fillStyle = lin(g, -32, 0, 32, 0, [[0, '#b97f45'], [0.35, '#e0b07a'], [0.7, '#d29c62'], [1, '#a46a34']]); g.fill(); outline(g, '#6e4418');
      g.save(); g.clip();
      g.fillStyle = '#d8402f'; g.fillRect(-34, 4, 68, 10);
      g.fillStyle = '#ffffff'; for (let x = -32; x < 34; x += 10) { circ(g, x, 9, 2.2); g.fill(); }
      g.strokeStyle = 'rgba(110,70,30,0.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-12, -10); g.lineTo(-10, 46); g.moveTo(14, -10); g.lineTo(11, 46); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-24, -10, 6, 56);
      g.restore();
      // tırtıklı ağız
      g.beginPath(); g.moveTo(-32, -10); for (let i = 0; i <= 16; i++) g.lineTo(-32 + i * 4, -10 + (i % 2 ? -3 : 0)); g.lineTo(32, -6); g.lineTo(-32, -6); g.closePath();
      g.fillStyle = '#e8c08a'; g.fill(); outline(g, '#6e4418', 1.2);
      // kalp damgası
      g.save(); g.translate(0, 28); g.scale(0.16, 0.16); H.ICONS.heart(g); g.restore();
    },
    bardak(g, it) {
      const cay = (it.layers || []).find(L => L.id === 'cay');
      g.save(); g.scale(1.28, 1.28); g.translate(0, -4);
      teaGlass(g, cay ? 0.9 : 0, cay ? (cay.q == null ? 1 : cay.q) : 1, true);
      g.restore();
    },
  };
  function dishFallback(g, it) {
    // bilinmeyen taban: beyaz tabak + katmanlar üstten
    ell(g, 0, 4, 46, 40); g.fillStyle = lin(g, 0, -36, 0, 44, [[0, '#ffffff'], [1, '#d9dde4']]); g.fill(); outline(g, '#9aa2ae', 1.6);
    ell(g, 0, 2, 34, 28); g.strokeStyle = 'rgba(150,160,175,0.4)'; g.lineWidth = 1.5; g.stroke();
    (it.layers || []).forEach((L, i) => topLayer(g, L, i, 0, 2, 22, 700));
  }
  function dishKey(it) {
    let k = 'dish:' + it.id + ':' + q2(it.toast);
    for (const L of (it.layers || [])) k += '|' + L.id + (L.cook != null ? ':' + q2(L.cook) : '') + (L.cookA != null ? ':' + q2(L.cookA) + ':' + q2(L.cookB) : '') + (L.id === 'cay' && L.q != null ? ':' + q2(L.q) : '');
    return k;
  }

  // ---------------------------------------------------------------------------
  // BEZ (temizlik)
  // ---------------------------------------------------------------------------
  function bez(g) {
    // mavi bez (katlanmış)
    g.save(); g.rotate(0.12);
    g.beginPath(); g.moveTo(-40, -6); g.quadraticCurveTo(-20, -18, 0, -12); g.quadraticCurveTo(22, -20, 42, -8); g.lineTo(38, 30); g.quadraticCurveTo(10, 38, -36, 30); g.closePath();
    g.fillStyle = lin(g, 0, -18, 0, 34, [[0, '#7cc0f2'], [1, '#2f7ac8']]); g.fill(); outline(g, '#1f5a98');
    g.save(); g.clip(); g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
    g.beginPath(); for (let i = -40; i < 44; i += 5) { g.moveTo(i, -20); g.lineTo(i + 6, 36); } g.stroke(); g.restore();
    g.strokeStyle = 'rgba(20,60,110,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-36, 12); g.quadraticCurveTo(0, 20, 38, 10); g.stroke();
    g.restore();
    // sarı sünger + yeşil sert yüz
    g.save(); g.translate(-2, -10); g.rotate(-0.15);
    rr(g, -26, -4, 52, 10, 4); g.fillStyle = lin(g, 0, -4, 0, 6, [[0, '#4fb85a'], [1, '#2a7a34']]); g.fill(); outline(g, '#1f5a28', 1.6);
    rr(g, -26, -22, 52, 20, 6); g.fillStyle = lin(g, 0, -22, 0, -2, [[0, '#ffe680'], [1, '#f2c21e']]); g.fill(); outline(g, '#b8901a', 1.6);
    const R = rng(5); for (let i = 0; i < 26; i++) { circ(g, -22 + R() * 44, -19 + R() * 14, 0.7 + R() * 1.1); g.fillStyle = 'rgba(190,140,10,0.5)'; g.fill(); }
    gloss(g, -10, -18, 10, 2.5, 0, 0.5);
    g.restore();
    // köpük
    for (const b of [[22, -26, 5], [30, -20, 3.5], [16, -32, 3]]) { circ(g, b[0], b[1], b[2]); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill(); g.strokeStyle = 'rgba(120,170,220,0.6)'; g.lineWidth = 0.8; g.stroke(); }
  }

  // ---------------------------------------------------------------------------
  // DİNAMİK EFEKTLER (buhar / duman) — dışarıdan da kullanılabilir
  // ---------------------------------------------------------------------------
  function drawSteam(ctx, x, y, t, scale, opts) {
    try {
      opts = opts || {}; scale = scale || 1; t = t == null ? (KS.time || 0) : t;
      const n = opts.count || 3, col = opts.color || '255,255,255', a0 = opts.alpha != null ? opts.alpha : 0.5;
      ctx.save(); ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const ph = ((t * 0.6 + i / n) % 1);
        const yy = y - ph * 34 * scale, xx = x + (i - (n - 1) / 2) * 9 * scale + Math.sin(t * 2 + i * 2 + ph * 5) * 4 * scale;
        const a = Math.sin(ph * Math.PI) * a0;
        ctx.strokeStyle = 'rgba(' + col + ',' + a.toFixed(3) + ')'; ctx.lineWidth = (4 + ph * 4) * scale;
        ctx.beginPath(); ctx.moveTo(xx, yy + 8 * scale); ctx.quadraticCurveTo(xx + 5 * scale * Math.sin(t * 3 + i), yy, xx, yy - 8 * scale); ctx.stroke();
      }
      ctx.restore();
    } catch (e) { /* yok */ }
  }
  function drawSmoke(ctx, x, y, t, scale) {
    try {
      scale = scale || 1; t = t == null ? (KS.time || 0) : t;
      ctx.save();
      for (let i = 0; i < 4; i++) {
        const ph = (t * 0.45 + i / 4) % 1;
        const r = (6 + ph * 14) * scale, a = Math.sin(ph * Math.PI) * 0.45;
        circ(ctx, x + Math.sin(t * 1.5 + i * 1.7) * 8 * scale, y - ph * 46 * scale, r);
        ctx.fillStyle = 'rgba(70,66,72,' + a.toFixed(3) + ')'; ctx.fill();
      }
      ctx.restore();
    } catch (e) { /* yok */ }
  }
  function drawPlate(ctx, x, y, w) {
    try {
      w = w || 110;
      sprite(ctx, 'plate', x, y, w * 1.12, (g) => {
        const s = w / 110; g.scale(s, s);
        ell(g, 0, 6, 55, 34); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fill();
        ell(g, 0, 0, 55, 34); g.fillStyle = lin(g, 0, -34, 0, 34, [[0, '#ffffff'], [1, '#dfe3ea']]); g.fill(); outline(g, '#a7afbb', 1.6);
        ell(g, 0, 2, 40, 23); g.fillStyle = lin(g, 0, -20, 0, 26, [[0, '#e8ecf2'], [1, '#ffffff']]); g.fill();
        ell(g, 0, 0, 50, 30.5); g.strokeStyle = 'rgba(60,110,190,0.55)'; g.lineWidth = 1.4; g.stroke();
        gloss(g, -26, -18, 14, 3.5, -0.3, 0.8);
      });
    } catch (e) { /* yok */ }
  }

  // ---------------------------------------------------------------------------
  // drawItem — HERHANGİ bir item (merkez x,y; ~100px genişlik @scale 1)
  // ---------------------------------------------------------------------------
  function drawItem(ctx, item, x, y, scale, opts) {
    if (!item) return;
    scale = scale == null ? 1 : scale;
    opts = opts || {};
    ctx.save();
    try {
      ctx.translate(x, y); if (scale !== 1) ctx.scale(scale, scale);
      const t = KS.time || 0;
      if (item.type === 'ing') {
        Art.drawIngredient(ctx, item.id, 0, 0, 82, { cook: item.cook, cookA: item.cookA, cookB: item.cookB });
        if (item.id === 'kofte') { const c = Math.max(item.cookA || 0, item.cookB || 0); if (c > 1.5) drawSmoke(ctx, 0, -14, t, 0.7); }
        if (item.id === 'cay') drawSteam(ctx, 0, -38, t, 0.8);
      } else if (item.type === 'product') {
        Art.drawProduct(ctx, item.id, 0, 0, 86);
      } else if (item.type === 'tool') {
        sprite(ctx, 'tool:' + item.id, 0, 0, 120, (g) => { if (item.id === 'bez') bez(g); else { rr(g, -30, -20, 60, 40, 8); g.fillStyle = '#9aa4ae'; g.fill(); outline(g, '#4a525a'); } }, true);
      } else if (item.type === 'dish') {
        if (opts.plate) drawPlate(ctx, 0, 14, 112);
        const fn = DISH[item.id] || dishFallback;
        sprite(ctx, dishKey(item), 0, 0, 132, (g) => fn(g, item), true);
        if (item.id === 'bardak' && (item.layers || []).some(L => L.id === 'cay')) drawSteam(ctx, 0, -52, t, 0.9);
        if (item.id === 'tost_ekmegi' && (item.toast || 0) >= 1.5) drawSmoke(ctx, 0, -30, t, 1);
        if (item.id === 'kese' && (item.layers || []).some(L => L.id === 'patates' && (L.cook || 0) >= 1.6)) drawSmoke(ctx, 0, -50, t, 0.8);
      } else {
        sprite(ctx, 'unknown-item', 0, 0, 100, (g) => H.ICONS.unknown(g), true);
      }
    } catch (e) { /* yok */ }
    ctx.restore();
  }

  Object.assign(Art, { drawItem, drawPlate, drawSteam, drawSmoke });
  Object.assign(Art._h, { drizzle, sprinkle, topLayer, sideBand, DISH });
})(window.KS);
/* ===== Art bölüm 5: müşteriler (randomLook, drawCustomer) ===== */
(function (KS) {
  'use strict';
  const Art = KS.Art, H = Art._h;
  const { TAU, clamp, rr, ell, circ, shade, mix, rgba, lin, rad, outline } = H;

  const SKINS = ['#fbdcc4', '#f4cba8', '#ecbb92', '#e0a87e', '#cc9064', '#b0764e', '#8c5a3a'];
  const HAIRS = ['#1e1814', '#2e2018', '#4a3020', '#6b4528', '#8a5a32', '#a8453a', '#c9a060'];
  const GRAYS = ['#8c8c8c', '#a8a8a8', '#c9c9c9'];
  const pickR = (R, a) => a[Math.floor(R() * a.length) % a.length];
  const ch = (R, p) => R() < p;

  function randomLook(type) {
    const seed = (Math.random() * 1e9) | 0;
    const R = Math.random;
    type = type || 'ogrenci';
    const adult = type !== 'ogrenci';
    const female = type === 'mudur' ? R() < 0.25 : R() < 0.5;
    const look = {
      type, seed, gender: female ? 'k' : 'e',
      skin: pickR(R, SKINS), hair: pickR(R, HAIRS), eye: pickR(R, ['#2a1a10', '#3a2614', '#2a3a20', '#24364a']),
      size: adult ? 0.98 + R() * 0.08 : 0.9 + R() * 0.08,
      glasses: null, backpack: null, acc: null, accColor: pickR(R, ['#e8443a', '#ff7aa8', '#3f7ac2', '#f0b13b', '#9a5ad0']),
      mustache: false, beard: false, mask: false, scarf: null, freckles: !adult && R() < 0.18,
      badge: false, tie: null, top: '#2b3a67', shirt: '#ffffff', outfit: 'ceket', hairStyle: 'kisa',
    };
    if (adult && R() < 0.22) look.hair = pickR(R, GRAYS);
    const mStyles = adult ? ['kisa', 'yan', 'kel', 'dalga', 'kisa'] : ['kisa', 'yan', 'diken', 'kivircik', 'dalga'];
    const fStyles = adult ? ['topuz', 'kare', 'uzun', 'atkuyrugu', 'kivircik'] : ['atkuyrugu', 'orgu', 'uzun', 'kare', 'atkuyrugu', 'topuz'];
    look.hairStyle = pickR(R, female ? fStyles : mStyles);
    if (female && (type === 'veli' || type === 'hizmetli') && R() < 0.35) { look.hairStyle = 'basortu'; look.scarfHead = pickR(R, ['#c0506a', '#5a7ab0', '#8a6ab0', '#d08a3a', '#4a8a7a', '#e0c0a0']); }
    if (!female && adult) { look.mustache = R() < (type === 'mudur' ? 0.65 : type === 'hizmetli' ? 0.5 : 0.3); look.beard = !look.mustache && R() < 0.15; }
    if (female && !adult && R() < 0.55) look.acc = R() < 0.5 ? 'kurdele' : 'toka';
    switch (type) {
      case 'ogrenci':
        look.outfit = pickR(R, ['ceket', 'yelek', 'sweat']);
        look.top = pickR(R, ['#24305e', '#2b3a67', '#1f2a50']);
        look.tie = look.outfit !== 'sweat' && R() < 0.55 ? pickR(R, ['#a8263a', '#24305e', '#7a1a2a']) : null;
        look.backpack = R() < 0.6 ? pickR(R, ['#e8443a', '#3f9ad8', '#f0b13b', '#4fae5a', '#9a5ad0', '#ff7aa8']) : null;
        look.glasses = R() < 0.15 ? 'yuvarlak' : null;
        break;
      case 'ogretmen':
        look.outfit = pickR(R, ['ceket', 'hirka']);
        look.top = pickR(R, ['#7a5a3a', '#8a2a3a', '#5a6a7a', '#6a7a4a', '#4a4a5a', '#a86a4a']);
        look.shirt = pickR(R, ['#ffffff', '#dce8f6', '#f6e8dc', '#e8f0e0']);
        look.tie = !female && look.outfit === 'ceket' && R() < 0.4 ? pickR(R, ['#3a4a7a', '#7a2a2a', '#2a5a4a']) : null;
        look.glasses = R() < 0.45 ? pickR(R, ['yuvarlak', 'kare']) : null;
        look.badge = true;
        break;
      case 'hizmetli':
        look.outfit = 'onluk'; look.top = '#3a7ac8'; look.shirt = '#e8eef4';
        look.glasses = R() < 0.15 ? 'kare' : null;
        break;
      case 'mudur':
        look.outfit = 'takim'; look.top = pickR(R, ['#2a2f3a', '#1f2a44', '#3a3a40']);
        look.tie = pickR(R, ['#a8263a', '#7a1a2a', '#2a4a8a', '#c49a2a']);
        look.glasses = R() < 0.35 ? 'kare' : null;
        if (!female && R() < 0.4) look.hairStyle = 'kel';
        if (R() < 0.35) look.hair = pickR(R, GRAYS);
        break;
      case 'veli':
        look.outfit = pickR(R, ['kazak', 'mont', 'gomlek']);
        look.top = pickR(R, ['#c0504a', '#4a8a6a', '#d0a040', '#6a5aa0', '#3a6a9a', '#a07050', '#e07a4a']);
        look.shirt = pickR(R, ['#ffffff', '#f0e6d6', '#dfe8f0']);
        look.glasses = R() < 0.3 ? pickR(R, ['yuvarlak', 'kare']) : null;
        break;
      case 'mufettis':
        look.outfit = 'onlukBeyaz'; look.top = '#f6f8fa'; look.shirt = '#cfe0f2';
        look.tie = !female && R() < 0.6 ? '#2a4a7a' : null;
        look.glasses = R() < 0.6 ? 'kare' : null;
        look.mask = R() < 0.5;
        break;
    }
    try { if (adult && KS.state && KS.state.today && KS.state.today.weather === 'soguk' && R() < 0.5) look.scarf = pickR(R, ['#c0392b', '#2f6aa8', '#e0a030', '#4a8a5a']); } catch (e) { /* yok */ }
    return look;
  }

  // ---------------------------------------------------------------------------
  // ÇİZİM PARÇALARI (yerel koordinat: (0,0) = taban orta, baş merkezi (0,-190))
  // ---------------------------------------------------------------------------
  const HY = -190, HRX = 44, HRY = 47;
  function torsoPath(g, W) {
    g.beginPath();
    g.moveTo(-16, -138);
    g.quadraticCurveTo(-W + 18, -136, -W + 2, -116);
    g.quadraticCurveTo(-W - 6, -96, -W - 6, -60);
    g.lineTo(-W - 8, 60); g.lineTo(W + 8, 60); g.lineTo(W + 6, -60);
    g.quadraticCurveTo(W + 6, -96, W - 2, -116);
    g.quadraticCurveTo(W - 18, -136, 16, -138);
    g.closePath();
  }
  function hairBack(g, L, col, t) {
    const s = L.hairStyle;
    g.fillStyle = col;
    if (s === 'uzun' || s === 'kivircik' && L.gender === 'k') {
      g.beginPath(); g.moveTo(-50, -200); g.quadraticCurveTo(-58, -150, -54, -112); g.quadraticCurveTo(0, -100, 54, -112); g.quadraticCurveTo(58, -150, 50, -200); g.closePath(); g.fill(); outline(g, shade(col, -0.4), 2);
      if (s === 'kivircik') { for (let i = 0; i < 8; i++) { circ(g, -52 + i * 15, -116 + Math.sin(i) * 4, 9); g.fill(); } }
    } else if (s === 'atkuyrugu') {
      const sw = Math.sin(t * 3 + L.seed) * 4;
      g.beginPath(); g.moveTo(30, -222); g.quadraticCurveTo(70 + sw, -210, 62 + sw, -160); g.quadraticCurveTo(56 + sw, -136, 48 + sw, -128); g.quadraticCurveTo(52, -170, 26, -206); g.closePath(); g.fill(); outline(g, shade(col, -0.4), 2);
      circ(g, 34, -216, 5); g.fillStyle = L.accColor; g.fill();
    } else if (s === 'topuz') {
      circ(g, 0, -244, 17); g.fill(); outline(g, shade(col, -0.4), 2);
      g.strokeStyle = shade(col, 0.2); g.lineWidth = 1.5; g.beginPath(); g.arc(0, -244, 10, 0.5, 2.5); g.stroke();
    } else if (s === 'kare') {
      g.beginPath(); g.moveTo(-50, -205); g.quadraticCurveTo(-56, -160, -48, -150); g.lineTo(48, -150); g.quadraticCurveTo(56, -160, 50, -205); g.closePath(); g.fill(); outline(g, shade(col, -0.4), 2);
    }
  }
  function hairFront(g, L, col) {
    const s = L.hairStyle, dk = shade(col, -0.4);
    const capGrad = lin(g, 0, -240, 0, -195, [[0, shade(col, 0.15)], [1, col]]);
    g.fillStyle = capGrad;
    const cap = (fringe) => {
      g.beginPath();
      g.moveTo(-46, -180);
      g.bezierCurveTo(-52, -232, -26, -246, 0, -246);
      g.bezierCurveTo(26, -246, 52, -232, 46, -180);
      fringe();
      g.closePath(); g.fill(); outline(g, dk, 2.2);
    };
    if (s === 'kel') {
      g.beginPath(); g.moveTo(-46, -172); g.quadraticCurveTo(-50, -200, -40, -210); g.lineTo(-36, -186); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(46, -172); g.quadraticCurveTo(50, -200, 40, -210); g.lineTo(36, -186); g.closePath(); g.fill();
      ell(g, -14, -224, 12, 6, -0.4); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill();
      return;
    }
    if (s === 'basortu') return;
    if (s === 'kisa') cap(() => { g.lineTo(42, -200); g.quadraticCurveTo(20, -216, 0, -212); g.quadraticCurveTo(-24, -216, -42, -200); });
    else if (s === 'yan') cap(() => { g.lineTo(42, -196); g.quadraticCurveTo(30, -222, -10, -214); g.quadraticCurveTo(-30, -210, -42, -198); });
    else if (s === 'diken') {
      g.beginPath(); g.moveTo(-46, -182); g.lineTo(-48, -214);
      const pts = [[-44, -236], [-32, -230], [-26, -254], [-12, -238], [0, -258], [10, -238], [24, -254], [28, -232], [44, -238], [46, -212]];
      for (const p of pts) g.lineTo(p[0], p[1]);
      g.lineTo(46, -182); g.lineTo(42, -200); g.quadraticCurveTo(0, -214, -42, -200); g.closePath(); g.fill(); outline(g, dk, 2.2);
    } else if (s === 'kivircik') {
      for (let i = 0; i < 11; i++) { const a = Math.PI + i * Math.PI / 10; circ(g, Math.cos(a) * 42, -200 + Math.sin(a) * 40, 13); g.fill(); }
      for (let i = 0; i < 5; i++) { circ(g, -28 + i * 14, -212 + (i % 2) * 4, 10); g.fill(); }
      g.strokeStyle = shade(col, 0.25); g.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(-34 + i * 10, -228 + (i % 2) * 8, 4, 0, 4); g.stroke(); }
    } else if (s === 'dalga') {
      cap(() => { g.lineTo(42, -204); g.bezierCurveTo(30, -236, 6, -224, -4, -214); g.quadraticCurveTo(-26, -206, -42, -200); });
      g.strokeStyle = shade(col, 0.3); g.lineWidth = 2; g.beginPath(); g.moveTo(-20, -232); g.quadraticCurveTo(6, -240, 26, -226); g.stroke();
    } else {
      // kadın stilleri: orta/yan ayrık perçem
      cap(() => {
        g.lineTo(44, -186); g.quadraticCurveTo(40, -210, 8, -222); g.quadraticCurveTo(-4, -208, -30, -206); g.quadraticCurveTo(-42, -200, -44, -186);
      });
      // yanlarda saç tutamları
      g.fillStyle = col;
      g.beginPath(); g.moveTo(-46, -196); g.quadraticCurveTo(-52, -170, -46, -150); g.lineTo(-40, -158); g.quadraticCurveTo(-42, -176, -38, -196); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(46, -196); g.quadraticCurveTo(52, -170, 46, -150); g.lineTo(40, -158); g.quadraticCurveTo(42, -176, 38, -196); g.closePath(); g.fill();
      if (s === 'orgu') {
        for (const sx of [-1, 1]) {
          for (let i = 0; i < 6; i++) { ell(g, sx * 46, -146 + i * 11, 7, 7, 0); g.fillStyle = i % 2 ? shade(col, 0.1) : col; g.fill(); outline(g, dk, 1.2); }
          circ(g, sx * 46, -80, 4); g.fillStyle = L.accColor; g.fill();
        }
      }
    }
    g.strokeStyle = rgba('#ffffff', 0.22); g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.arc(0, -205, 34, Math.PI * 1.2, Math.PI * 1.45); g.stroke();
  }
  function headscarf(g, L, front) {
    const c = L.scarfHead || '#c0506a';
    if (!front) {
      g.beginPath(); g.moveTo(-52, -186); g.bezierCurveTo(-58, -250, 58, -250, 52, -186); g.quadraticCurveTo(64, -130, 40, -110); g.quadraticCurveTo(0, -100, -40, -110); g.quadraticCurveTo(-64, -130, -52, -186); g.closePath();
      g.fillStyle = lin(g, 0, -246, 0, -104, [[0, shade(c, 0.2)], [1, shade(c, -0.15)]]); g.fill(); outline(g, shade(c, -0.45), 2.2);
      g.fillStyle = rgba('#ffffff', 0.35);
      for (let i = 0; i < 14; i++) { circ(g, -40 + (i * 37) % 80, -230 + (i * 23) % 110, 2); g.fill(); }
    } else {
      g.beginPath(); g.ellipse(0, HY + 2, 41, 45, 0, Math.PI * 1.02, Math.PI * 1.98); g.strokeStyle = shade(c, -0.1); g.lineWidth = 7; g.stroke();
    }
  }
  function eyes(g, L, mood, blink, state) {
    const ey = HY + 2, ex = 16;
    const angry = state === 'angry' || mood < 0.2;
    const happy = state === 'happy' || mood > 0.85;
    for (const sx of [-1, 1]) {
      const x = sx * ex;
      if (blink) { g.strokeStyle = '#2a1a10'; g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(x - 6, ey); g.quadraticCurveTo(x, ey + 3, x + 6, ey); g.stroke(); continue; }
      if (happy && state === 'happy') { g.strokeStyle = '#2a1a10'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(x - 6, ey + 2); g.quadraticCurveTo(x, ey - 6, x + 6, ey + 2); g.stroke(); continue; }
      const ry = angry ? 5.5 : 7.5;
      ell(g, x, ey, 6, ry); g.fillStyle = L.eye || '#2a1a10'; g.fill();
      circ(g, x + 2, ey - ry * 0.4, 2.1); g.fillStyle = '#fff'; g.fill();
      circ(g, x - 1.8, ey + ry * 0.4, 1); g.fill();
    }
    // kaşlar
    const by = HY - 14, bc = shade(L.hair || '#2a1a10', -0.2);
    g.strokeStyle = L.hairStyle === 'basortu' ? '#3a2a1a' : bc; g.lineWidth = 3.4; g.lineCap = 'round';
    for (const sx of [-1, 1]) {
      g.beginPath();
      if (angry) { g.moveTo(sx * 25, by - 4); g.lineTo(sx * 8, by + 3); }
      else if (mood < 0.45) { g.moveTo(sx * 25, by + 1); g.quadraticCurveTo(sx * 17, by - 3, sx * 8, by - 4); }
      else if (happy) { g.moveTo(sx * 24, by); g.quadraticCurveTo(sx * 16, by - 6, sx * 8, by - 2); }
      else { g.moveTo(sx * 24, by - 1); g.quadraticCurveTo(sx * 16, by - 4, sx * 8, by - 1); }
      g.stroke();
    }
  }
  function mouth(g, L, mood, state, t) {
    const my = HY + 30;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const talk = state === 'talk' || state === 'eat';
    if (talk) {
      const o = Math.abs(Math.sin(t * (state === 'eat' ? 9 : 13))) * 6 + 1.5;
      ell(g, 0, my, 7, o); g.fillStyle = '#6a1e1e'; g.fill();
      if (o > 4) { ell(g, 0, my + o * 0.5, 4, 2); g.fillStyle = '#e86a6a'; g.fill(); }
      return;
    }
    if (state === 'happy' || mood > 0.8) {
      g.beginPath(); g.moveTo(-11, my - 3); g.quadraticCurveTo(0, my + 13, 11, my - 3); g.closePath();
      g.fillStyle = '#7a2020'; g.fill(); g.strokeStyle = '#4a1010'; g.lineWidth = 1.6; g.stroke();
      g.save(); g.clip(); ell(g, 0, my + 8, 6, 4); g.fillStyle = '#ef7a7a'; g.fill(); g.fillStyle = '#fff'; g.fillRect(-8, my - 4, 16, 3.5); g.restore();
    } else if (mood > 0.55) {
      g.strokeStyle = '#6a2a1a'; g.lineWidth = 2.8; g.beginPath(); g.moveTo(-9, my - 1); g.quadraticCurveTo(0, my + 6, 9, my - 1); g.stroke();
    } else if (mood > 0.3) {
      g.strokeStyle = '#6a2a1a'; g.lineWidth = 2.8; g.beginPath(); g.moveTo(-7, my + 1); g.quadraticCurveTo(0, my - 0.5, 7, my + 1.5); g.stroke();
    } else if (state === 'angry' || mood < 0.15) {
      rr(g, -10, my - 3, 20, 8, 3); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#5a1a10'; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(-10, my + 1); g.lineTo(10, my + 1); for (let x = -5; x <= 5; x += 5) { g.moveTo(x, my - 3); g.lineTo(x, my + 5); } g.lineWidth = 1; g.stroke();
    } else {
      g.strokeStyle = '#6a2a1a'; g.lineWidth = 2.8; g.beginPath(); g.moveTo(-9, my + 3); g.quadraticCurveTo(0, my - 5, 9, my + 3); g.stroke();
    }
  }
  function glasses(g, L) {
    const col = L.type === 'mudur' ? '#2a2a2a' : L.type === 'ogretmen' ? '#7a3a2a' : '#2a2a3a';
    g.strokeStyle = col; g.lineWidth = 2.6;
    for (const sx of [-1, 1]) {
      if (L.glasses === 'yuvarlak') circ(g, sx * 16, HY + 2, 12); else rr(g, sx * 16 - 13, HY - 8, 26, 19, 5);
      g.fillStyle = 'rgba(200,225,255,0.18)'; g.fill(); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(sx * 16 - 6, HY - 3); g.lineTo(sx * 16 - 2, HY - 6); g.stroke();
      g.strokeStyle = col; g.lineWidth = 2.6;
    }
    g.beginPath(); g.moveTo(-4, HY); g.quadraticCurveTo(0, HY - 3, 4, HY); g.moveTo(-29, HY - 2); g.lineTo(-42, HY - 6); g.moveTo(29, HY - 2); g.lineTo(42, HY - 6); g.stroke();
  }
  function hairAcc(g, L) {
    if (L.acc === 'kurdele') {
      g.save(); g.translate(30, -232); g.rotate(0.35);
      const c = L.accColor;
      g.fillStyle = lin(g, 0, -10, 0, 10, [[0, shade(c, 0.3)], [1, shade(c, -0.15)]]);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-18, -14, -20, 0); g.quadraticCurveTo(-18, 14, 0, 0); g.fill(); outline(g, shade(c, -0.45), 1.5);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(18, -14, 20, 0); g.quadraticCurveTo(18, 14, 0, 0); g.fill(); outline(g, shade(c, -0.45), 1.5);
      circ(g, 0, 0, 4.5); g.fillStyle = shade(c, -0.1); g.fill(); outline(g, shade(c, -0.45), 1.2);
      g.restore();
    } else if (L.acc === 'toka') {
      g.save(); g.translate(-28, -218); g.rotate(-0.5);
      rr(g, -9, -3, 18, 6, 3); g.fillStyle = L.accColor; g.fill(); outline(g, shade(L.accColor, -0.45), 1.2);
      circ(g, 0, 0, 2); g.fillStyle = '#fff'; g.fill(); g.restore();
    }
  }

  function clothes(g, L, W, t) {
    const top = L.top || '#2b3a67', shirt = L.shirt || '#ffffff', o = L.outfit;
    const dk = shade(top, -0.45);
    // sırt çantası (arkadan omuz üstü)
    if (L.backpack) { rr(g, -W + 8, -150, 2 * W - 16, 60, 18); g.fillStyle = shade(L.backpack, -0.15); g.fill(); outline(g, shade(L.backpack, -0.5), 2); }
    const body = (o === 'yelek' || o === 'gomlek') ? shirt : top;
    torsoPath(g, W);
    g.fillStyle = lin(g, -W, 0, W, 0, [[0, shade(body, -0.12)], [0.35, shade(body, 0.1)], [1, shade(body, -0.22)]]); g.fill();
    outline(g, shade(body, -0.45), 2.4);
    // kol çizgileri
    g.strokeStyle = rgba(shade(body, -0.5), 0.45); g.lineWidth = 2;
    g.beginPath(); g.moveTo(-W + 20, -96); g.quadraticCurveTo(-W + 16, -40, -W + 18, 60); g.moveTo(W - 20, -96); g.quadraticCurveTo(W - 16, -40, W - 18, 60); g.stroke();
    const vee = (depth, col) => { g.beginPath(); g.moveTo(-17, -137); g.lineTo(0, depth); g.lineTo(17, -137); g.closePath(); g.fillStyle = col; g.fill(); };
    const collar = (col) => {
      g.fillStyle = col; g.strokeStyle = shade(col, -0.3); g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-15, -140); g.lineTo(-2, -122); g.lineTo(-18, -118); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(15, -140); g.lineTo(2, -122); g.lineTo(18, -118); g.closePath(); g.fill(); g.stroke();
    };
    const tie = (col, len) => {
      g.fillStyle = col; g.strokeStyle = shade(col, -0.45); g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-5, -128); g.lineTo(5, -128); g.lineTo(3.5, -120); g.lineTo(-3.5, -120); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-3.5, -120); g.lineTo(3.5, -120); g.lineTo(8, -120 + len); g.lineTo(0, -112 + len); g.lineTo(-8, -120 + len); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = rgba('#ffffff', 0.25); g.lineWidth = 2; g.beginPath(); g.moveTo(-3, -110); g.lineTo(4, -102); g.moveTo(-5, -94); g.lineTo(6, -84); g.stroke();
    };
    const lapels = (col, depth) => {
      g.fillStyle = shade(col, -0.12); g.strokeStyle = shade(col, -0.5); g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(-18, -137); g.lineTo(-30, -110); g.lineTo(-22, -104); g.lineTo(-2, depth); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(18, -137); g.lineTo(30, -110); g.lineTo(22, -104); g.lineTo(2, depth); g.closePath(); g.fill(); g.stroke();
    };
    if (o === 'ceket' || o === 'takim' || o === 'onlukBeyaz') {
      vee(-62, shirt); collar(shirt);
      if (L.tie) tie(L.tie, 56);
      lapels(top, -62);
      for (const by of [-46, -20]) { circ(g, 0, by, 3); g.fillStyle = shade(top, -0.35); g.fill(); }
      if (L.type === 'ogrenci') { // okul arması
        g.save(); g.translate(-34, -96);
        g.beginPath(); g.moveTo(-7, -8); g.lineTo(7, -8); g.lineTo(7, 2); g.quadraticCurveTo(0, 10, -7, 2); g.closePath();
        g.fillStyle = '#c9a23a'; g.fill(); g.strokeStyle = '#8a6a1a'; g.lineWidth = 1; g.stroke();
        g.fillStyle = '#a8263a'; g.fillRect(-3, -5, 6, 6); g.restore();
      }
      if (o === 'takim') { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(-44, -90); g.lineTo(-36, -94); g.lineTo(-30, -90); g.closePath(); g.fill(); g.strokeStyle = shade(top, 0.25); g.lineWidth = 1.5; g.beginPath(); g.moveTo(-48, -88); g.lineTo(-26, -88); g.stroke(); }
      if (o === 'onlukBeyaz') { g.strokeStyle = 'rgba(120,140,160,0.6)'; g.lineWidth = 1.5; rr(g, 22, -86, 22, 20, 3); g.stroke(); g.fillStyle = '#3a7ac8'; g.fillRect(28, -94, 2.5, 10); }
    } else if (o === 'yelek') {
      collar(shirt);
      if (L.tie) tie(L.tie, 50);
      g.beginPath(); g.moveTo(-W + 22, -122); g.lineTo(-18, -130); g.lineTo(0, -76); g.lineTo(18, -130); g.lineTo(W - 22, -122); g.lineTo(W - 18, 60); g.lineTo(-W + 18, 60); g.closePath();
      g.fillStyle = lin(g, -W, 0, W, 0, [[0, shade(top, -0.1)], [0.4, shade(top, 0.12)], [1, shade(top, -0.2)]]); g.fill(); outline(g, dk, 2);
      g.strokeStyle = shade(top, 0.3); g.lineWidth = 2.5; g.beginPath(); g.moveTo(-18, -128); g.lineTo(0, -78); g.lineTo(18, -128); g.stroke();
      g.strokeStyle = rgba(shade(top, -0.5), 0.4); g.lineWidth = 1; g.beginPath(); for (let x = -W + 26; x < W - 22; x += 6) { g.moveTo(x, -60); g.lineTo(x, 60); } g.stroke();
    } else if (o === 'sweat' || o === 'kazak') {
      g.beginPath(); g.moveTo(-20, -138); g.quadraticCurveTo(0, -116, 20, -138); g.strokeStyle = shade(top, 0.25); g.lineWidth = 6; g.stroke();
      if (o === 'sweat') { collar(shirt); g.beginPath(); g.moveTo(-20, -138); g.quadraticCurveTo(0, -116, 20, -138); g.strokeStyle = shade(top, 0.2); g.lineWidth = 5; g.stroke(); }
      else { g.strokeStyle = rgba(shade(top, -0.4), 0.35); g.lineWidth = 1.2; g.beginPath(); for (let y = -100; y < 60; y += 12) { for (let x = -W + 18; x < W - 18; x += 12) { g.moveTo(x, y); g.lineTo(x + 6, y + 6); g.lineTo(x + 12, y); } } g.stroke(); }
    } else if (o === 'hirka') {
      vee(-40, shirt);
      g.strokeStyle = dk; g.lineWidth = 2; g.beginPath(); g.moveTo(-17, -137); g.lineTo(-4, -40); g.lineTo(-4, 60); g.moveTo(17, -137); g.lineTo(4, -40); g.lineTo(4, 60); g.stroke();
      g.fillStyle = shirt; g.fillRect(-3, -40, 6, 100);
      for (const by of [-30, -6, 18]) { circ(g, -8, by, 2.6); g.fillStyle = shade(top, 0.35); g.fill(); }
      g.strokeStyle = rgba(shade(top, -0.4), 0.3); g.lineWidth = 1; g.beginPath(); for (let x = -W + 24; x < W - 20; x += 5) { if (Math.abs(x) < 10) continue; g.moveTo(x, -100); g.lineTo(x, 60); } g.stroke();
    } else if (o === 'mont') {
      collar(shirt);
      g.strokeStyle = shade(top, -0.5); g.lineWidth = 2; g.beginPath(); g.moveTo(0, -122); g.lineTo(0, 60); g.stroke();
      g.strokeStyle = '#c9ccd0'; g.lineWidth = 1.2; g.beginPath(); for (let y = -118; y < 60; y += 5) { g.moveTo(-2, y); g.lineTo(2, y); } g.stroke();
      g.strokeStyle = rgba(shade(top, -0.5), 0.4); g.lineWidth = 2; g.beginPath(); for (const y of [-80, -40, 0]) { g.moveTo(-W + 10, y); g.quadraticCurveTo(-W / 2, y + 4, -4, y); g.moveTo(4, y); g.quadraticCurveTo(W / 2, y + 4, W - 10, y); } g.stroke();
    } else if (o === 'gomlek') {
      collar(shirt);
      g.strokeStyle = rgba(shade(shirt, -0.4), 0.6); g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, -122); g.lineTo(0, 60); g.stroke();
      for (const by of [-100, -70, -40, -10]) { circ(g, 3, by, 1.8); g.fillStyle = shade(shirt, -0.3); g.fill(); }
      // kareli desen
      g.strokeStyle = rgba(top, 0.35); g.lineWidth = 2; g.beginPath(); for (let x = -W; x < W; x += 14) { g.moveTo(x, -130); g.lineTo(x, 60); } for (let y = -126; y < 60; y += 14) { g.moveTo(-W, y); g.lineTo(W, y); } g.stroke();
    } else if (o === 'onluk') {
      collar(shirt);
      g.strokeStyle = shade(top, -0.45); g.lineWidth = 1.6; g.beginPath(); g.moveTo(-2, -124); g.lineTo(-2, 60); g.stroke();
      for (const by of [-100, -64, -28, 8]) { circ(g, 4, by, 2.8); g.fillStyle = '#e8eef4'; g.fill(); }
      rr(g, -42, -92, 24, 22, 3); g.strokeStyle = shade(top, -0.4); g.lineWidth = 1.6; g.stroke();
      g.fillStyle = '#f0b13b'; g.fillRect(-36, -100, 3, 12); g.fillStyle = '#e8443a'; g.fillRect(-31, -98, 3, 10);
    }
    if (o === 'onlukBeyaz') {
      g.strokeStyle = 'rgba(150,165,180,0.7)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, -62); g.lineTo(0, 60); g.stroke();
    }
    // sırt çantası askıları
    if (L.backpack) {
      for (const sx of [-1, 1]) {
        g.beginPath(); g.moveTo(sx * (W - 34), -134); g.quadraticCurveTo(sx * (W - 24), -60, sx * (W - 26), 60);
        g.lineWidth = 11; g.strokeStyle = shade(L.backpack, -0.4); g.stroke();
        g.lineWidth = 8; g.strokeStyle = L.backpack; g.stroke();
        rr(g, sx * (W - 26) - 6, -72, 12, 8, 2); g.fillStyle = '#2a2a30'; g.fill();
      }
    }
    // yaka kartı
    if (L.badge) {
      g.strokeStyle = '#d23a3a'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(-14, -136); g.quadraticCurveTo(-4, -100, 4, -82); g.moveTo(14, -136); g.quadraticCurveTo(12, -100, 6, -82); g.stroke();
      rr(g, -6, -84, 22, 28, 3); g.fillStyle = '#ffffff'; g.fill(); outline(g, 'rgba(0,0,0,0.3)', 1);
      g.fillStyle = '#3f7ac2'; g.fillRect(-6, -84, 22, 6);
      rr(g, -2, -74, 8, 9, 1); g.fillStyle = '#c9d6e2'; g.fill();
      g.fillStyle = '#8a96a2'; g.fillRect(8, -73, 6, 1.6); g.fillRect(8, -69, 5, 1.6); g.fillRect(-2, -62, 15, 1.6);
    }
    // atkı
    if (L.scarf) {
      const c = L.scarf;
      g.beginPath(); g.moveTo(-30, -146); g.quadraticCurveTo(0, -126, 30, -146); g.lineTo(32, -132); g.quadraticCurveTo(0, -112, -32, -132); g.closePath();
      g.fillStyle = c; g.fill(); outline(g, shade(c, -0.4), 1.6);
      rr(g, 10, -132, 14, 52, 4); g.fill(); outline(g, shade(c, -0.4), 1.6);
      g.strokeStyle = rgba('#ffffff', 0.45); g.lineWidth = 2; g.beginPath(); g.moveTo(10, -110); g.lineTo(24, -110); g.moveTo(10, -100); g.lineTo(24, -100); g.stroke();
    }
  }

  function hand(g, x, y, skin, r) {
    circ(g, x, y, r || 11); g.fillStyle = rad(g, x - 3, y - 3, 1, (r || 11) * 1.2, [[0, shade(skin, 0.12)], [1, shade(skin, -0.1)]]); g.fill(); outline(g, shade(skin, -0.4), 1.8);
  }
  function sleeve(g, x0, y0, x1, y1, col, w) {
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = shade(col, -0.45); g.lineWidth = w + 4; g.stroke();
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = col; g.lineWidth = w; g.stroke();
  }
  function clipboard(g) {
    g.save(); g.translate(18, -66); g.rotate(-0.12);
    rr(g, -24, -34, 48, 64, 4); g.fillStyle = lin(g, 0, -34, 0, 30, [[0, '#b8854a'], [1, '#8a5a2a']]); g.fill(); outline(g, '#5a3a18', 2);
    rr(g, -19, -26, 38, 52, 2); g.fillStyle = '#fbfbf6'; g.fill();
    rr(g, -10, -38, 20, 9, 3); g.fillStyle = lin(g, -10, 0, 10, 0, [[0, '#7d8790'], [0.5, '#e6eaee'], [1, '#6d7780']]); g.fill(); outline(g, '#3a4048', 1.2);
    for (let i = 0; i < 4; i++) {
      const y = -16 + i * 11;
      g.strokeStyle = '#2f9a4a'; g.lineWidth = 2; g.beginPath(); g.moveTo(-15, y); g.lineTo(-12, y + 3); g.lineTo(-7, y - 3); g.stroke();
      g.fillStyle = '#9aa6b2'; g.fillRect(-3, y - 1, 18 - (i % 2) * 5, 2);
    }
    g.restore();
  }

  function drawCustomer(ctx, c, x, baseY, t) {
    if (!c) return;
    ctx.save();
    try {
      if (!c.look || typeof c.look !== 'object' || !c.look.skin) {
        const base = (c.look && c.look.type) || c.type || c.typeId || 'ogrenci';
        const nl = randomLook(base);
        c.look = Object.assign(nl, c.look || {}, { skin: nl.skin });
      }
      const L = c.look;
      t = t == null ? (KS.time || 0) : t;
      const st = (c.anim && c.anim.state) || 'idle';
      const mood = clamp(c.mood == null ? 0.8 : c.mood, 0, 1);
      const seed = (L.seed || 1) % 1000;
      const adult = L.type !== 'ogrenci';
      const W = adult ? 74 : 64;
      let dy = Math.sin(t * 2.2 + seed) * 1.5, dx = 0, rot = 0;
      if (st === 'walk') { dy = -Math.abs(Math.sin(t * 9 + seed)) * 8; rot = Math.sin(t * 9 + seed) * 0.035; }
      else if (st === 'happy') dy = -Math.abs(Math.sin(t * 10)) * 13;
      else if (st === 'angry') dx = Math.sin(t * 46) * 2.6;
      ctx.translate(x + dx, baseY + dy);
      const sc = (L.size || 1) * (c.artScale || 1);
      ctx.scale(sc, sc);
      ctx.rotate(rot);
      const g = ctx;
      const skin = L.skin || '#f1c27d';
      const hairCol = L.hair || '#3b2a1a';
      // arka saç / başörtüsü
      if (L.hairStyle === 'basortu') headscarf(g, L, false);
      else hairBack(g, L, hairCol, t);
      // gövde
      clothes(g, L, W, t);
      // boyun
      rr(g, -13, -152, 26, 22, 8); g.fillStyle = shade(skin, -0.12); g.fill();
      ell(g, 0, -146, 14, 5); g.fillStyle = rgba(shade(skin, -0.5), 0.25); g.fill();
      if (L.hairStyle === 'basortu') { // örtü önden boynu kapatır
        g.beginPath(); g.moveTo(-34, -150); g.quadraticCurveTo(0, -118, 34, -150); g.lineTo(30, -130); g.quadraticCurveTo(0, -108, -30, -130); g.closePath();
        g.fillStyle = shade(L.scarfHead, -0.08); g.fill(); outline(g, shade(L.scarfHead, -0.45), 1.6);
      }
      // kulaklar
      if (L.hairStyle !== 'basortu') for (const sx of [-1, 1]) { ell(g, sx * 43, HY + 4, 7, 10); g.fillStyle = shade(skin, -0.05); g.fill(); outline(g, shade(skin, -0.4), 1.8); ell(g, sx * 43, HY + 4, 3, 5); g.fillStyle = rgba(shade(skin, -0.4), 0.35); g.fill(); }
      // yüz
      const hrx = L.hairStyle === 'basortu' ? 37 : HRX, hry = L.hairStyle === 'basortu' ? 42 : HRY;
      ell(g, 0, HY, hrx, hry);
      g.fillStyle = rad(g, -14, HY - 18, 4, 60, [[0, shade(skin, 0.14)], [0.7, skin], [1, shade(skin, -0.1)]]); g.fill();
      outline(g, shade(skin, -0.42), 2.2);
      // öfke kızarması
      const red = st === 'angry' ? 1 : clamp((0.35 - mood) / 0.35, 0, 1);
      if (red > 0) { ell(g, 0, HY, hrx, hry); g.fillStyle = rad(g, 0, HY + 10, 4, 52, [[0, rgba('#ff3a2a', 0.42 * red)], [1, rgba('#ff3a2a', 0.12 * red)]]); g.fill(); }
      // yanak
      for (const sx of [-1, 1]) { ell(g, sx * 26, HY + 18, 8, 5); g.fillStyle = rgba('#ff7a8a', mood > 0.7 || st === 'happy' ? 0.45 : 0.25); g.fill(); }
      if (L.freckles) { g.fillStyle = rgba('#a0603a', 0.5); for (const p of [[-24, 12], [-20, 15], [-27, 16], [24, 12], [20, 15], [27, 16]]) { circ(g, p[0], HY + p[1], 1.1); g.fill(); } }
      // burun
      g.strokeStyle = rgba(shade(skin, -0.45), 0.8); g.lineWidth = 2.2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-2, HY + 8); g.quadraticCurveTo(4, HY + 15, -2, HY + 18); g.stroke();
      if (L.beard) { g.beginPath(); g.ellipse(0, HY + 18, 38, 28, 0, 0.1, Math.PI - 0.1); g.fillStyle = rgba(shade(hairCol, 0.1), 0.35); g.fill(); }
      // ağız / bıyık / maske
      if (!L.mask) {
        mouth(g, L, mood, st, t);
        if (L.mustache) {
          g.fillStyle = shade(hairCol, -0.05);
          g.beginPath(); g.moveTo(0, HY + 21); g.quadraticCurveTo(-10, HY + 18, -18, HY + 28); g.quadraticCurveTo(-8, HY + 25, 0, HY + 25); g.quadraticCurveTo(8, HY + 25, 18, HY + 28); g.quadraticCurveTo(10, HY + 18, 0, HY + 21); g.fill();
          outline(g, shade(hairCol, -0.4), 1.2);
        }
      } else {
        g.beginPath(); g.moveTo(-30, HY + 10); g.quadraticCurveTo(0, HY + 4, 30, HY + 10); g.quadraticCurveTo(30, HY + 38, 0, HY + 44); g.quadraticCurveTo(-30, HY + 38, -30, HY + 10); g.closePath();
        g.fillStyle = lin(g, 0, HY + 6, 0, HY + 44, [[0, '#d6ecfa'], [1, '#9cc8e8']]); g.fill(); outline(g, '#6a9ac0', 1.6);
        g.strokeStyle = 'rgba(90,140,180,0.6)'; g.lineWidth = 1.2; g.beginPath(); for (const y of [16, 24, 32]) { g.moveTo(-26, HY + y); g.quadraticCurveTo(0, HY + y - 3, 26, HY + y); } g.stroke();
        g.strokeStyle = '#e8f4fc'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-30, HY + 12); g.lineTo(-42, HY + 2); g.moveTo(30, HY + 12); g.lineTo(42, HY + 2); g.stroke();
      }
      // göz kırpma
      const per = 3.2 + (seed % 17) / 10;
      const blink = ((t + seed * 0.37) % per) < 0.13;
      eyes(g, L, mood, blink, st);
      // saç ön / başörtüsü çerçeve
      if (L.hairStyle === 'basortu') headscarf(g, L, true); else { hairFront(g, L, hairCol); hairAcc(g, L); }
      if (L.glasses) glasses(g, L);
      // eller / kollar
      const top = (L.outfit === 'yelek' || L.outfit === 'gomlek') ? (L.shirt || '#fff') : (L.top || '#2b3a67');
      if (L.type === 'mufettis' && st !== 'happy') {
        clipboard(g);
        sleeve(g, W - 4, -30, 18, -40, top, 20);
        hand(g, 10, -40, skin);
      }
      if (st === 'happy') {
        const wave = Math.sin(t * 12) * 0.25;
        const hx = W + 22 + Math.sin(wave) * 10, hy = -214;
        sleeve(g, W - 8, -112, hx - 4, hy + 16, top, 22);
        hand(g, hx, hy, skin, 12);
        g.strokeStyle = shade(skin, -0.35); g.lineWidth = 1.4; g.beginPath(); g.moveTo(hx - 5, hy - 6); g.lineTo(hx - 6, hy - 14); g.moveTo(hx, hy - 8); g.lineTo(hx, hy - 16); g.moveTo(hx + 5, hy - 6); g.lineTo(hx + 6, hy - 13); g.stroke();
        // parıltılar
        for (let i = 0; i < 3; i++) {
          const a = t * 2 + i * 2.1, px = Math.cos(a) * 66, py = HY - 30 + Math.sin(a) * 30;
          Art.drawIcon(ctx, i === 1 ? 'heart' : 'sparkle', px, py, 14 + Math.sin(t * 6 + i) * 3);
        }
      } else if (st === 'eat') {
        const hy = -150 + Math.sin(t * 9) * 4;
        sleeve(g, W - 14, 20, 18, hy + 12, top, 22);
        g.save(); g.translate(8, hy - 6); g.rotate(-0.4);
        rr(g, -14, -9, 28, 18, 5); g.fillStyle = lin(g, 0, -9, 0, 9, [[0, '#f0c27a'], [1, '#c98a3a']]); g.fill(); outline(g, '#7a4614', 1.6);
        g.fillStyle = '#f6d55c'; g.fillRect(-14, -2, 28, 3);
        g.restore();
        hand(g, 18, hy + 6, skin);
      }
      // ruh hali efektleri
      if (st === 'angry' || mood < 0.12) {
        for (const sx of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const ph = (t * 1.6 + i / 3) % 1;
            const px = sx * (52 + ph * 20), py = HY - 26 - ph * 40, r = 6 + ph * 9;
            circ(g, px, py, r); g.fillStyle = 'rgba(255,255,255,' + (0.75 * (1 - ph)).toFixed(3) + ')'; g.fill();
          }
        }
        // öfke damarı
        g.save(); g.translate(26, HY - 32); g.strokeStyle = '#e8262a'; g.lineWidth = 3; g.lineCap = 'round';
        for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(2.5, 2.5); g.quadraticCurveTo(6.5, 3, 7, 8); g.stroke(); }
        g.restore();
      } else if (mood < 0.42 && st !== 'happy') {
        // ter damlası (sabırsızlık)
        const ph = (t * 0.7 + seed) % 1;
        g.save(); g.translate(-40, HY - 18 + ph * 14); g.globalAlpha *= 1 - ph * 0.6;
        g.beginPath(); g.moveTo(0, -8); g.quadraticCurveTo(6, 2, 0, 5); g.quadraticCurveTo(-6, 2, 0, -8); g.fillStyle = '#8fd0ff'; g.fill(); outline(g, '#3a8ad0', 1.2);
        g.restore();
      }
    } catch (e) { /* yok */ }
    ctx.restore();
  }

  Object.assign(Art, { randomLook, drawCustomer });
})(window.KS);
