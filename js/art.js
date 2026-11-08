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
      // kirlilik: tezgah kenarlarında lekeler
      const cl = KS.state && isFinite(KS.state.cleanliness) ? KS.state.cleanliness : 100;
      if (cl < 80) {
        const n = Math.min(14, Math.floor((80 - cl) / 5) + 1);
        const spots = [[357, 520], [811, 560], [1086, 600], [1334, 470], [358, 760], [811, 820], [1086, 760], [1334, 850], [600, 638], [960, 638], [1210, 688], [1470, 728], [180, 895], [1000, 895]];
        for (let i = 0; i < n; i++) {
          const p = spots[i];
          sprite(ctx, 'stain' + (i % 4), p[0], p[1], 34, (g) => {
            const R = rng(900 + (i % 4));
            for (let j = 0; j < 5; j++) { ell(g, (R() - 0.5) * 14, (R() - 0.5) * 10, 3 + R() * 6, 2 + R() * 4, R() * 3); g.fillStyle = rgba(j % 2 ? '#6a4a20' : '#8a5a2a', 0.35); g.fill(); }
          });
        }
      }
    } catch (e) { /* yok */ }
  }

  Object.assign(Art, { drawBackground, drawCounterFront, drawWorkspace });
  Object.assign(Art._h, { skyAt, WINS, OPEN });
})(window.KS);
/* @@ART-PART-3@@ */
