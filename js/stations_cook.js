/* KantinSim — Pişirme İstasyonları: tost makinesi, ızgara, fritöz, semaver (çay ocağı)
 * Sahibi: Pişirme İstasyonları ekibi. Bkz. CONTRACT.md
 *
 * Bölgeler (zone id): 'tost', 'izgara', 'fritoz', 'semaver'
 * Dışa açılan: KS.Stations.cook = { state, tune, info(), reset(), sync(), toggleLid(i), flipPatty(i),
 *                                   toggleBasket(i), changeOil(), brewTea(), teaQuality(), oilLife(), zones }
 * Notlar:
 *  - Pişme yalnızca update(dt) içindeki oyun saniyesiyle (dt) ilerler; animasyonlar gerçek saniyeyle.
 *  - Izgarada köfteye kısa tık = çevir, sürükle = al (core'un onPick/onClick/onDrag akışıyla).
 *  - Fritözde: yukarıdaki sepetten tıkla/sürükle = keseye al; yağdaki sepete tık = kaldır, sürükle = al.
 */
(function (KS) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeIO = t => { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  const inR = (p, r) => !!p && !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function rr(ctx, x, y, w, h, r) {
    w = Math.max(0, w); h = Math.max(0, h);
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (KS.roundRectPath) KS.roundRectPath(ctx, x, y, w, h, r);
    else { ctx.beginPath(); ctx.rect(x, y, w, h); }
  }
  function rng(seed) {
    let s = (Math.floor(seed) >>> 0) || 0x9e3779b9;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // ---------------------------------------------------------------------------
  // DENGE DEĞERLERİ
  // ---------------------------------------------------------------------------
  const TUNE = {
    toastTime: 9, toastDone: 0.9, toastSmoke: 1.25, toastBurn: 1.5, toastMax: 2.0,
    grillTime: 7, grillReady: 0.85, grillSmoke: 1.2, grillBurn: 1.5, grillMax: 2.0,
    fryTime: 9, fryDone: 0.9, frySmoke: 1.25, fryBurn: 1.5, fryMax: 2.0,
    fryHeatUp: 6, fryCoolDown: 25,
    oilMax: 30, oilOld: 8, oilOldMult: 0.75, oilDeadMult: 0.5,
    boilTime: 8, boilCool: 40,
    teaStale: 180, teaStaleSpan: 240, teaMinQ: 0.5,
    cirakDelay: 2.5,
  };

  // ---------------------------------------------------------------------------
  // RENK
  // ---------------------------------------------------------------------------
  function hexRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const ramp = stops => stops.map(s => [s[0], hexRgb(s[1])]);
  function rampAt(R, v) {
    if (!(v > R[0][0])) return R[0][1];
    for (let i = 1; i < R.length; i++) {
      if (v <= R[i][0]) {
        const a = R[i - 1], b = R[i], t = (v - a[0]) / (b[0] - a[0]);
        return [lerp(a[1][0], b[1][0], t), lerp(a[1][1], b[1][1], t), lerp(a[1][2], b[1][2], t)];
      }
    }
    return R[R.length - 1][1];
  }
  const css = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')';
  function shade(c, f) {
    if (f >= 0) return [c[0] + (255 - c[0]) * f, c[1] + (255 - c[1]) * f, c[2] + (255 - c[2]) * f];
    return [c[0] * (1 + f), c[1] * (1 + f), c[2] * (1 + f)];
  }
  const R_PATTY = ramp([[0, '#d9716a'], [0.3, '#c86e57'], [0.65, '#a05a36'], [1.0, '#74401f'], [1.25, '#583017'], [1.5, '#2f1d12'], [2, '#161111']]);
  const R_TOAST = ramp([[0, '#f1e0b4'], [0.5, '#ecc77b'], [0.9, '#dc9d42'], [1.15, '#c07c2d'], [1.35, '#7e4b1b'], [1.55, '#35251b'], [2, '#141110']]);
  const R_FRY = ramp([[0, '#f6ecc4'], [0.5, '#f3d982'], [0.9, '#ecba45'], [1.15, '#d89833'], [1.35, '#9e601f'], [1.6, '#402c17'], [2, '#1a1410']]);
  const R_OIL = ramp([[0, '#f2c23c'], [0.45, '#d69222'], [0.75, '#8e5416'], [1, '#3f260d']]);
  const R_TEA = ramp([[0.5, '#3b1407'], [0.75, '#701f08'], [1, '#bd3a10']]);
  function stageColor(v) { return v < 0.45 ? '#a8bccf' : v < 0.85 ? '#ffcf4a' : v <= 1.2 ? '#5fe07a' : v < 1.5 ? '#ff9d2e' : '#ff4a3a'; }

  // ---------------------------------------------------------------------------
  // GÜVENLİ SARMALAYICILAR
  // ---------------------------------------------------------------------------
  const warned = {};
  function warnOnce(tag, e) { if (!warned[tag]) { warned[tag] = 1; try { console.warn('[cook]', tag, e); } catch (_) { /* yok */ } } }
  function snd(name, o) { try { if (KS.audio && KS.audio.play) KS.audio.play(name, o); } catch (e) { /* yok */ } }
  const loopState = {};
  function loop(key, on, type) {
    on = !!on;
    if (loopState[key] === on) return;
    loopState[key] = on;
    try { if (KS.audio && KS.audio.setLoop) KS.audio.setLoop(key, on, type); } catch (e) { /* yok */ }
  }
  function loopsOff() { loop('tost', false, 'hum'); loop('izgara', false, 'sizzle'); loop('fritoz', false, 'fry'); loop('semaver', false, 'boil'); }
  function note(msg, type) { try { KS.notify(msg, type || 'info'); } catch (e) { /* yok */ } }
  function floatTxt(x, y, s, col, size) { try { KS.fx.floatText(x, y, s, col, size || 20); } catch (e) { /* yok */ } }
  function txt(ctx, s, x, y, o) {
    o = o || {};
    const A = KS.Art;
    if (A && A.text) { try { A.text(ctx, s, x, y, o); return; } catch (e) { /* yedek */ } }
    ctx.save();
    ctx.font = (o.weight || 700) + ' ' + (o.size || 16) + 'px "Nunito", system-ui, sans-serif';
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.baseline || 'middle';
    if (o.stroke) { ctx.lineWidth = o.strokeWidth || 3; ctx.strokeStyle = o.stroke; ctx.strokeText(s, x, y); }
    ctx.fillStyle = o.color || '#fff'; ctx.fillText(s, x, y);
    ctx.restore();
  }
  function uv(id, f, d) { try { return num(KS.upgVal(id, f), d); } catch (e) { return d; } }
  function upgLv(id) { try { return KS.upg(id) | 0; } catch (e) { return 0; } }
  function upgName(id) {
    try { const u = KS.DATA.upgrades[id]; return u.levels[clamp(KS.upg(id) | 0, 0, u.levels.length - 1)].name; } catch (e) { return ''; }
  }
  function phaseActive() { const s = KS.state; return !!s && (s.phase === 'open' || s.phase === 'closing'); }
  function running() { const s = KS.state; return phaseActive() && !s.paused && !(KS.ui && KS.ui.modalPauses); }
  function power() { try { return KS.powerOn ? !!KS.powerOn() : true; } catch (e) { return true; } }
  function interactive() { try { return KS.inputEnabled ? !!KS.inputEnabled() : true; } catch (e) { return false; } }
  function hoverAt(r) { const p = KS.pointer; return !!p && p.inside && !KS.held && interactive() && inR(p, r); }
  function hasStaff(id) { try { return !!KS.hasStaff(id); } catch (e) { return false; } }
  function invGet(id) { try { return KS.inv.get(id) | 0; } catch (e) { return 0; } }
  function invTake(id) { try { return !!KS.inv.take(id, 1); } catch (e) { return false; } }
  function cookQ(c) { try { return KS.Recipes.cookQuality(c); } catch (e) { return 1; } }
  function cookLbl(c) { try { return KS.Recipes.cookLabel(c); } catch (e) { return ''; } }
  function itemName(it) { try { return KS.Recipes.itemName(it) || ''; } catch (e) { return ''; } }
  function addWasted(n) { try { const t = KS.state.today; if (t && n > 0) t.wasted = (t.wasted || 0) + n; } catch (e) { /* yok */ } }
  const pct = v => Math.round(clamp(num(v, 0), 0, 9.99) * 100);
  function toastLabel(v) { v = num(v, 0); return v < 0.05 ? 'Basılmadı' : cookLbl(v); }

  // ---------------------------------------------------------------------------
  // ÖNBELLEK (offscreen canvas) + SPRITE'LAR
  // ---------------------------------------------------------------------------
  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  let caches = {}, cacheK = 0;
  function cacheScale() {
    const k = clamp(Math.round(((KS.scale || 1) * (window.devicePixelRatio || 1)) * 4) / 4, 1, 2.5);
    if (k !== cacheK) { caches = {}; cacheK = k; }
    return k;
  }
  // fn(g) yerel koordinatlarda (0,0)-(w,h) çizer; dönen canvas w x h mantıksal boyutla blit edilir.
  function cached(key, w, h, fn) {
    const k = cacheScale();
    let c = caches[key];
    if (!c) {
      c = newCanvas(w * k, h * k);
      const g = c.getContext('2d');
      g.scale(k, k);
      try { fn(g); } catch (e) { warnOnce('cache:' + key, e); }
      caches[key] = c;
    }
    return c;
  }
  function blit(ctx, c, x, y, w, h) { try { ctx.drawImage(c, x, y, w, h); } catch (e) { /* yok */ } }

  let SPR = null;
  function flamePath(g, cx, top, bot, hw) {
    const h = bot - top;
    g.beginPath(); g.moveTo(cx, top);
    g.bezierCurveTo(cx + hw * 0.35, top + h * 0.3, cx + hw, top + h * 0.55, cx + hw * 0.8, top + h * 0.85);
    g.quadraticCurveTo(cx, bot + h * 0.12, cx - hw * 0.8, top + h * 0.85);
    g.bezierCurveTo(cx - hw, top + h * 0.55, cx - hw * 0.35, top + h * 0.3, cx, top);
    g.closePath();
  }
  function flameSprite(inner, mid, outer) {
    const c = newCanvas(32, 64), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 60, 0, 2);
    gr.addColorStop(0, mid); gr.addColorStop(0.5, mid); gr.addColorStop(1, outer);
    flamePath(g, 16, 2, 58, 14); g.fillStyle = gr; g.fill();
    const g2 = g.createLinearGradient(0, 58, 0, 20);
    g2.addColorStop(0, inner); g2.addColorStop(1, 'rgba(255,255,255,0)');
    flamePath(g, 16, 22, 57, 7); g.fillStyle = g2; g.fill();
    return c;
  }
  function sprites() {
    if (SPR) return SPR;
    const soft = (rgb, a0, mid) => {
      const c = newCanvas(64, 64), g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(' + rgb + ',' + a0 + ')');
      gr.addColorStop(mid || 0.5, 'rgba(' + rgb + ',' + (a0 * 0.45) + ')');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return c;
    };
    SPR = {
      steam: soft('255,255,255', 0.85),
      smoke: soft('168,164,158', 0.85),
      dark: soft('36,30,28', 0.95),
      glow: soft('255,128,30', 1, 0.35),
      ember: soft('255,62,12', 1, 0.3),
      led: soft('255,255,255', 1, 0.3),
      flame: flameSprite('rgba(255,246,190,1)', 'rgba(255,160,36,0.95)', 'rgba(235,60,10,0)'),
      gas: flameSprite('rgba(215,240,255,1)', 'rgba(70,130,255,0.9)', 'rgba(120,70,255,0)'),
    };
    return SPR;
  }

  // ---------------------------------------------------------------------------
  // PARÇACIKLAR (kendi sistemimiz: buhar, duman, kıvılcım, yağ damlası, kabarcık)
  // layer: 'fx' (en üst katman) | 'fry' (fritöz haznesi içinde, kırpılı)
  // ---------------------------------------------------------------------------
  const P = [];
  function spawn(p) { if (P.length >= 460) return null; p.t = 0; P.push(p); return p; }
  function puff(kind, x, y, o) {
    o = o || {};
    return spawn({ k: kind, x: x + rand(-3, 3), y, vx: rand(-9, 9) + (o.vx || 0), vy: -rand(22, 42) * (o.sp || 1), g: o.g != null ? o.g : -8,
      life: rand(1.0, 1.7) * (o.life || 1), r: rand(5, 9) * (o.size || 1), gr: o.gr != null ? o.gr : 1.6, a: o.a != null ? o.a : 0.35, layer: o.layer || 'fx' });
  }
  function sparks(x, y, n, o) {
    o = o || {};
    for (let i = 0; i < n; i++) {
      spawn({ k: 'spark', x, y, vx: rand(-70, 70), vy: -rand(60, 170) * (o.sp || 1), g: 520, life: rand(0.22, 0.5), r: rand(0.8, 1.7),
        color: o.color || (Math.random() < 0.5 ? '#ffe39a' : '#ffb347'), layer: 'fx' });
    }
  }
  function drip(x, y, floor, color, layer) { spawn({ k: 'drip', x, y, vx: 0, vy: rand(10, 40), g: 700, life: 2, r: rand(1.2, 2.1), floor, color, layer: layer || 'fx' }); }
  function bubble(x, y, r) { spawn({ k: 'bubble', x, y, vx: rand(-6, 6), vy: -rand(4, 14), g: 0, life: rand(0.25, 0.8), r, layer: 'fry' }); }
  function updateParticles(dt) {
    if (dt <= 0) return;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.t += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'drip' && p.y >= p.floor) {
        P.splice(i, 1);
        spawn({ k: 'ring', x: p.x, y: p.floor, vx: 0, vy: 0, g: 0, life: 0.45, r: 1.5, layer: p.layer });
        continue;
      }
      if (p.t >= p.life) P.splice(i, 1);
    }
  }
  function drawParticles(ctx, layer) {
    const sp = sprites();
    ctx.save();
    for (const p of P) {
      if (p.layer !== layer) continue;
      const u = p.t / p.life;
      if (p.k === 'steam' || p.k === 'smoke' || p.k === 'dark') {
        const fade = Math.min(1, p.t / 0.18) * (1 - u);
        const r = p.r * (1 + p.gr * u);
        ctx.globalAlpha = clamp(p.a * fade, 0, 1);
        ctx.drawImage(sp[p.k], p.x - r, p.y - r, r * 2, r * 2);
      } else if (p.k === 'spark') {
        ctx.globalAlpha = clamp(1 - u, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      } else if (p.k === 'drip') {
        ctx.globalAlpha = 0.9; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 0.75, p.r * 1.3, 0, 0, TAU); ctx.fill();
      } else if (p.k === 'ring') {
        const rx = 2 + u * 8;
        ctx.globalAlpha = (1 - u) * 0.55; ctx.strokeStyle = '#fff6d0'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, rx * 0.32, 0, 0, TAU); ctx.stroke();
      } else if (p.k === 'bubble') {
        const r = p.r * (0.6 + 0.6 * u);
        ctx.globalAlpha = 0.75 * (1 - u * 0.5);
        ctx.fillStyle = 'rgba(255,250,215,0.18)'; ctx.strokeStyle = 'rgba(255,248,210,0.7)'; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // ORTAK ÇİZİM PARÇALARI
  // ---------------------------------------------------------------------------
  function backplate(ctx, R) {
    const A = KS.Art;
    if (A && A.metalPanel) { A.metalPanel(ctx, R, { radius: 14, tone: 'dark' }); return; }
    const c = cached('bp' + R.w + 'x' + R.h, R.w + 20, R.h + 20, g => {
      g.save(); g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 10; g.shadowOffsetY = 4;
      rr(g, 10, 10, R.w, R.h, 14);
      const gr = g.createLinearGradient(0, 10, 0, 10 + R.h); gr.addColorStop(0, '#9aa4ae'); gr.addColorStop(1, '#5f6973');
      g.fillStyle = gr; g.fill(); g.restore();
    });
    blit(ctx, c, R.x - 10, R.y - 10, R.w + 20, R.h + 20);
  }
  function stationLabel(ctx, R, label) {
    const A = KS.Art;
    if (A && A.stationLabel) { try { A.stationLabel(ctx, R, label); return; } catch (e) { /* yedek */ } }
    txt(ctx, label, R.x + 12, R.y + 16, { size: 14, weight: 800, color: '#fff', stroke: 'rgba(0,0,0,0.5)', strokeWidth: 3 });
  }
  function levelTag(ctx, R, id, x, y, align) {
    const n = upgName(id); if (!n) return;
    txt(ctx, n, x != null ? x : R.x + R.w - 10, y != null ? y : R.y + R.h - 9,
      { size: 11, weight: 800, color: 'rgba(255,248,230,0.85)', align: align || 'right', stroke: 'rgba(20,16,30,0.55)', strokeWidth: 3 });
  }
  function bolt(ctx, x, y, s, col) {
    ctx.beginPath();
    ctx.moveTo(x + 0.25 * s, y - s); ctx.lineTo(x - 0.6 * s, y + 0.15 * s); ctx.lineTo(x - 0.05 * s, y + 0.15 * s);
    ctx.lineTo(x - 0.3 * s, y + s); ctx.lineTo(x + 0.6 * s, y - 0.2 * s); ctx.lineTo(x + 0.05 * s, y - 0.2 * s);
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  }
  function noPowerBadge(ctx, x, y) {
    const t = KS.time || 0, w = 138, h = 30;
    ctx.save();
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(t * 5);
    rr(ctx, x - w / 2, y - h / 2, w, h, 15);
    ctx.fillStyle = 'rgba(24,10,14,0.86)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,96,72,0.85)'; ctx.lineWidth = 2; ctx.stroke();
    bolt(ctx, x - w / 2 + 19, y, 9, '#ffd23f');
    txt(ctx, 'Elektrik yok', x + 10, y + 1, { size: 15, weight: 800, color: '#ffc2b8', align: 'center' });
    ctx.restore();
  }
  function led(ctx, x, y, r, col, on, dim) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r + 1.4, 0, TAU); ctx.fillStyle = '#17181b'; ctx.fill();
    const c = hexRgb(col);
    if (on) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.75;
      ctx.drawImage(sprites().led, x - r * 4, y - r * 4, r * 8, r * 8);
      ctx.globalAlpha = 0.55; ctx.fillStyle = css(c, 0.6);
      ctx.beginPath(); ctx.arc(x, y, r * 3, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = css(shade(c, 0.25)); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = css(shade(c, -0.6), 1); ctx.fill();
      if (dim) { ctx.globalAlpha = dim; ctx.fillStyle = css(c); ctx.fill(); ctx.globalAlpha = 1; }
    }
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    ctx.restore();
  }
  // İlerleme halkası: v pişme değeri (1.0 = tam dolu); 1.2 üstü turuncu/kırmızı ikinci halka
  function drawRing(ctx, x, y, r, v) {
    v = num(v, 0);
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r + 3, 0, TAU); ctx.fillStyle = 'rgba(16,12,20,0.74)'; ctx.fill();
    ctx.lineWidth = Math.max(2.4, r * 0.3); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.stroke();
    const f = clamp(v, 0, 1);
    if (f > 0.01) {
      ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * f);
      ctx.strokeStyle = v >= 0.85 ? '#5fe07a' : '#ffcf4a'; ctx.stroke();
    }
    if (v > 1.2) {
      const o = clamp((v - 1.2) / 0.3, 0, 1);
      ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * o);
      ctx.strokeStyle = v >= 1.5 ? '#ff4a3a' : '#ff9d2e'; ctx.stroke();
    }
    ctx.lineWidth = Math.max(1.6, r * 0.18);
    const s = r * 0.42;
    if (v >= 1.5) {
      ctx.strokeStyle = '#ff6a5a';
      ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
    } else if (v >= 0.85 && v <= 1.2) {
      ctx.strokeStyle = '#8dff9a';
      ctx.beginPath(); ctx.moveTo(x - s, y + 0.05 * s); ctx.lineTo(x - 0.25 * s, y + 0.7 * s); ctx.lineTo(x + s, y - 0.6 * s); ctx.stroke();
    } else if (r >= 11) {
      txt(ctx, String(pct(v)), x, y + 0.5, { size: Math.round(r * 0.72), weight: 800, color: '#fff', align: 'center' });
    } else {
      ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, TAU); ctx.fillStyle = stageColor(v); ctx.fill();
    }
    ctx.restore();
  }
  // Yatay pişme çubuğu (0..1.6 ölçek, 0.85–1.2 yeşil bant)
  function drawCookBar(ctx, x, y, w, h, v) {
    v = num(v, 0);
    const max = 1.6;
    ctx.fillStyle = 'rgba(12,9,16,0.72)'; rr(ctx, x - 1.5, y - 1.5, w + 3, h + 3, (h + 3) / 2); ctx.fill();
    ctx.fillStyle = 'rgba(95,224,122,0.32)'; ctx.fillRect(x + w * 0.85 / max, y, w * 0.35 / max, h);
    const f = clamp(v / max, 0, 1);
    if (f > 0.005) { ctx.fillStyle = stageColor(v); rr(ctx, x, y, Math.max(h, w * f), h, h / 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 1, y, Math.max(0, w * f - 2), Math.max(1, h * 0.3));
  }
  function drawItemSafe(ctx, item, x, y, sc) {
    const A = KS.Art;
    if (A && A.drawItem) {
      ctx.save();
      try { A.drawItem(ctx, item, x, y, sc); ctx.restore(); return; } catch (e) { warnOnce('drawItem', e); }
      ctx.restore();
    }
    // yedek: basit ekmek dilimi
    const tc = rampAt(R_TOAST, num(item && item.toast, 0));
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    rr(ctx, -40, -34, 80, 68, 14); ctx.fillStyle = css(tc); ctx.fill();
    ctx.strokeStyle = css(shade(tc, -0.35)); ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
  }
  function steelGrad(g, x0, y0, x1, y1) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, '#f2f5f7'); gr.addColorStop(0.22, '#c8ced4'); gr.addColorStop(0.5, '#9ea6ae');
    gr.addColorStop(0.62, '#b8bfc6'); gr.addColorStop(0.85, '#8c949c'); gr.addColorStop(1, '#6c737b');
    return gr;
  }
  function brushed(g, x, y, w, h, alpha, vertical) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    const R = rng(w * 31 + h * 7);
    if (vertical) { for (let i = 0; i < w; i += 1.5) { g.fillStyle = 'rgba(255,255,255,' + (alpha * R()) + ')'; g.fillRect(x + i, y, 0.8, h); } }
    else { for (let i = 0; i < h; i += 1.5) { g.fillStyle = 'rgba(255,255,255,' + (alpha * R()) + ')'; g.fillRect(x, y + i, w, 0.8); } }
    g.restore();
  }

  // ---------------------------------------------------------------------------
  // DURUM
  // ---------------------------------------------------------------------------
  const S = {
    tost: { machines: [], lastSlot: null },
    izgara: { slots: [], flares: [], lastSlot: -1 },
    fritoz: { baskets: [], temp: 1, oldWarned: false, lastBasket: -1 },
    semaver: { water: 0, state: 'empty', brewT: 0, glasses: 0, spare: 0, age: 0, lastAge: 0, staleWarned: false, cirakT: 0, cirakBusy: 0, emptyWarned: false },
  };
  const newToastSlot = () => ({ dish: null, done: false, smk: false, burn: false });
  const newMachine = () => ({ closed: false, lidT: 0, slots: [newToastSlot(), newToastSlot()] });
  const newGrillSlot = () => ({ item: null, flipT: -1, ready: false, smk: false, burn: false, seed: 1, rot: 0, drop: 0 });
  const newBasket = () => ({ c: null, down: false, downT: 0, drip: 0, splash: 0, seed: 1, ready: false, burn: false });

  function emptyAll() {
    let n = 0;
    for (const M of S.tost.machines) { for (const sl of M.slots) { if (sl.dish) n++; Object.assign(sl, newToastSlot()); } M.closed = false; }
    for (const sl of S.izgara.slots) { if (sl.item) n++; Object.assign(sl, newGrillSlot()); }
    for (const B of S.fritoz.baskets) { if (B.c) n++; Object.assign(B, newBasket()); }
    return n;
  }
  function syncSlots(clear) {
    let lost = clear ? emptyAll() : 0;
    const tn = clamp(Math.round(uv('tost', 'slots', 2) / 2), 1, 3);
    const M = S.tost.machines;
    while (M.length < tn) M.push(newMachine());
    while (M.length > tn) { const m = M.pop(); lost += m.slots.filter(s => s.dish).length; }
    const gn = clamp(Math.round(uv('izgara', 'slots', 4)), 1, 12);
    const G = S.izgara.slots;
    while (G.length < gn) G.push(newGrillSlot());
    while (G.length > gn) { if (G.pop().item) lost++; }
    const bn = clamp(Math.round(uv('fritoz', 'baskets', 1)), 1, 3);
    const B = S.fritoz.baskets;
    while (B.length < bn) B.push(newBasket());
    while (B.length > bn) { if (B.pop().c) lost++; }
    return lost;
  }
  function resetSemaver() {
    Object.assign(S.semaver, { water: 0, state: 'empty', brewT: 0, glasses: 0, spare: 0, age: 0, lastAge: 0, staleWarned: false, cirakT: 0, cirakBusy: 0, emptyWarned: false });
  }
  function resetAll(full) {
    syncSlots(true);
    for (const M of S.tost.machines) { M.closed = false; M.lidT = 0; }
    S.fritoz.temp = 1;
    if (full) { oilSet(TUNE.oilMax); S.fritoz.oldWarned = false; }
    resetSemaver();
    P.length = 0; S.izgara.flares.length = 0;
    loopsOff();
  }

  // ===========================================================================
  // 1) TOST MAKİNESİ
  // ===========================================================================
  function tostGeo() {
    const R = KS.layout.tost, n = Math.max(1, S.tost.machines.length);
    const gap = 10, pad = 12;
    const mw = n === 1 ? 196 : (R.w - pad * 2 - gap * (n - 1)) / n;
    const total = mw * n + gap * (n - 1), x0 = R.x + (R.w - total) / 2;
    const hingeY = R.y + 74, plateH = 76, L = plateH - 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (mw + gap), slotW = (mw - 18) / 2, slots = [];
      for (let j = 0; j < 2; j++) {
        const sx = x + 7 + j * (slotW + 4);
        slots.push({ x: sx, y: hingeY + 4, w: slotW, h: plateH - 8, cx: sx + slotW / 2, cy: hingeY + 4 + (plateH - 8) / 2 });
      }
      out.push({ i, x, w: mw, hingeY, plateH, L, faceY: hingeY + plateH, slots,
        hit: { x: x - 4, y: R.y + 26, w: mw + 8, h: hingeY + plateH + 36 - (R.y + 26) } });
    }
    return { R, list: out };
  }
  function lidEdge(g, lidT) { const th = (1 - clamp(lidT, 0, 1)) * 1.75; return g.hingeY + g.L * Math.cos(th) - g.L * Math.sin(th) * 0.38; }
  function machineAt(list, pt) {
    let best = -1, bd = 1e9;
    for (const g of list) { const d = Math.abs(pt.x - (g.x + g.w / 2)); if (d < bd) { bd = d; best = g.i; } }
    return best;
  }
  function toastFlags(sl) { const v = sl.dish ? num(sl.dish.toast, 0) : 0; sl.done = v >= TUNE.toastDone; sl.smk = v >= TUNE.toastSmoke; sl.burn = v >= TUNE.toastBurn; }
  const machineEmpty = M => M.slots.every(s => !s.dish);
  const machineAccepts = M => (!M.closed || machineEmpty(M)) && M.slots.some(s => !s.dish);
  const tostCanTake = item => !!item && item.type === 'dish' && item.id !== 'kese' && item.id !== 'bardak' && Array.isArray(item.layers);

  function toggleLid(i) {
    const M = S.tost.machines[i]; if (!M) return;
    M.closed = !M.closed;
    snd('click');
    if (M.closed && !machineEmpty(M) && !power()) note('Elektrik yok — tost makinesi ısınmıyor!', 'warn');
  }
  function placeToast(item, pt, prefer) {
    const G = tostGeo().list;
    let best = null, bd = 1e9;
    for (const g of G) {
      const M = S.tost.machines[g.i]; if (!M || !machineAccepts(M)) continue;
      g.slots.forEach((s, j) => {
        if (M.slots[j].dish) return;
        let d = pt ? dist(pt.x, pt.y, s.cx, s.cy) : g.i * 2 + j;
        if (prefer && prefer.i === g.i && prefer.j === j) d = -1;
        if (d < bd) { bd = d; best = { M, j }; }
      });
    }
    if (!best) return false;
    if (item.toast == null) item.toast = 0;
    const sl = best.M.slots[best.j];
    sl.dish = item; toastFlags(sl);
    if (best.M.closed) best.M.closed = false;
    return true;
  }
  const TOAST_RAW = 0.3;
  const toastPress = { active: false, i: -1, j: -1, x: 0, y: 0 };
  function takeToastSlot(i, j) {
    const M = S.tost.machines[i]; if (!M) return null;
    const sl = M.slots[j]; if (!sl || !sl.dish) return null;
    const d = sl.dish; sl.dish = null; toastFlags(sl);
    S.tost.lastSlot = { i, j };
    return d;
  }
  const tostZone = {
    id: 'tost', z: 5,
    getRect: () => KS.layout.tost,
    canDrop(item) { return tostCanTake(item) && S.tost.machines.some(machineAccepts); },
    onDrop(item, pt) { return placeToast(item, pt, null); },
    onReturn(item) {
      if (placeToast(item, null, S.tost.lastSlot)) return;
      // hiç yer yoksa (olmamalı) ilk yuvanın yanına zorla koy
      for (const M of S.tost.machines) for (const sl of M.slots) if (!sl.dish) { sl.dish = item; toastFlags(sl); return; }
      warnOnce('tostReturn', 'yer yok');
    },
    // Kapak açıkken ham (toast < TOAST_RAW) tosta basış: kısa tık = kapağı kapat, sürükleme = tostu al.
    // Basılmış tost (>= TOAST_RAW) doğrudan alınır (eski davranış).
    onPick(pt) {
      toastPress.active = false;
      const G = tostGeo().list, i = machineAt(G, pt), M = S.tost.machines[i], g = G[i];
      if (!M || !g || M.closed || M.lidT > 0.25) return null;
      for (let j = 0; j < 2; j++) {
        const s = g.slots[j], sl = M.slots[j];
        if (sl.dish && pt.x >= s.x - 3 && pt.x <= s.x + s.w + 3 && pt.y >= s.y - 8 && pt.y <= s.y + s.h + 8) {
          if (num(sl.dish.toast, 0) < TOAST_RAW) { Object.assign(toastPress, { active: true, i, j, x: pt.x, y: pt.y }); return null; }
          return takeToastSlot(i, j);
        }
      }
      return null;
    },
    onDrag(pt) {
      if (!toastPress.active || KS.held) return;
      if (dist(pt.x, pt.y, toastPress.x, toastPress.y) < 12) return;
      toastPress.active = false;
      const item = takeToastSlot(toastPress.i, toastPress.j); if (!item) return;
      KS.held = { item, from: tostZone, x: pt.x, y: pt.y, sx: toastPress.x, sy: toastPress.y, moved: true, sticky: false, t: 0 };
      snd('pick');
    },
    onClick(pt) { toastPress.active = false; const G = tostGeo().list, i = machineAt(G, pt); if (i >= 0) toggleLid(i); },
    onRelease() { toastPress.active = false; },
    tooltip(pt) {
      const G = tostGeo().list, i = machineAt(G, pt), M = S.tost.machines[i], g = G[i];
      if (!M || !g) return null;
      const warn = power() ? '' : '\n⚡ Elektrik yok — ısıtmıyor!';
      if (M.closed) {
        const parts = M.slots.filter(s => s.dish).map(s => '• ' + itemName(s.dish) + ': ' + toastLabel(s.dish.toast) + ' (%' + pct(s.dish.toast) + ')');
        if (!parts.length) return 'Tost makinesi (kapak kapalı, boş)\nTıkla: kapağı aç' + warn;
        return 'Tost basılıyor…\n' + parts.join('\n') + '\nTıkla: kapağı aç' + warn;
      }
      for (let j = 0; j < 2; j++) {
        const s = g.slots[j], d = M.slots[j].dish;
        if (d && pt.x >= s.x - 3 && pt.x <= s.x + s.w + 3 && pt.y >= s.y - 8 && pt.y <= s.y + s.h + 8) {
          if (num(d.toast, 0) < TOAST_RAW) return itemName(d) + ' — Tost: ' + toastLabel(d.toast) + '\nTıkla: kapağı kapat • Sürükle: al' + warn;
          return itemName(d) + ' — Tost: ' + toastLabel(d.toast) + '\nTıkla/sürükle: al' + warn;
        }
      }
      if (!machineEmpty(M)) return 'Tost makinesi (kapak açık)\nTıkla: kapağı kapat ve bas' + warn;
      return 'Tost makinesi (kapak açık)\nTabaktaki tostu bir yuvaya bırak, sonra kapağı kapat' + warn;
    },
  };

  function updateTost(dt, rdt, run) {
    const pw = power(), spd = Math.max(0.1, uv('tost', 'speed', 1)), G = tostGeo().list;
    let humming = false;
    S.tost.machines.forEach((M, i) => {
      const target = M.closed ? 1 : 0;
      M.lidT += clamp(target - M.lidT, -rdt * 4.5, rdt * 4.5);
      const g = G[i]; if (!g) return;
      const Ye = lidEdge(g, M.lidT);
      M.slots.forEach((sl, j) => {
        const d = sl.dish; if (!d) return;
        const s = g.slots[j];
        const heating = run && pw && M.closed && M.lidT > 0.97;
        if (heating) { humming = true; d.toast = Math.min(TUNE.toastMax, num(d.toast, 0) + dt * spd / TUNE.toastTime); }
        const v = num(d.toast, 0);
        if (!sl.done && v >= TUNE.toastDone) { sl.done = true; if (v < TUNE.toastBurn) { snd('toast_done'); floatTxt(s.cx, Ye - 16, 'Hazır!', '#7dff8a', 20); } }
        if (!sl.smk && v >= TUNE.toastSmoke) sl.smk = true;
        if (!sl.burn && v >= TUNE.toastBurn) { sl.burn = true; snd('burn'); floatTxt(s.cx, Ye - 16, 'Yandı!', '#ff6a5a', 20); }
        if (run) {
          const ey = M.lidT > 0.5 ? Ye + 5 : s.cy - 4;
          if (heating && Math.random() < dt * 2.4) puff('steam', s.cx + rand(-s.w * 0.4, s.w * 0.4), ey, { a: 0.3, size: 0.8 });
          if (v >= TUNE.toastSmoke && Math.random() < dt * (v >= TUNE.toastBurn ? 7 : 3)) {
            const burnt = v >= TUNE.toastBurn;
            puff(burnt ? 'dark' : 'smoke', s.cx + rand(-s.w * 0.4, s.w * 0.4), ey, { a: burnt ? 0.5 : 0.35, size: burnt ? 1.25 : 1, life: 1.3 });
          }
        }
      });
    });
    loop('tost', run && pw && humming, 'hum');
  }

  function drawTostBase(c, ox, oy, g) {
    const w = g.w, ph = g.plateH, BH = ph + 52;
    // zemin gölgesi
    c.save(); c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(ox + w / 2, oy + BH - 3, w * 0.5, 7, 0, 0, TAU); c.fill(); c.restore();
    // gövde
    let gr = c.createLinearGradient(0, oy, 0, oy + BH);
    gr.addColorStop(0, '#5d646c'); gr.addColorStop(0.5, '#3e444b'); gr.addColorStop(1, '#272b30');
    rr(c, ox, oy, w, BH - 4, 10); c.fillStyle = gr; c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 1.5; c.stroke();
    // menteşe yuvası (arka)
    rr(c, ox + 3, oy + 2, w - 6, 14, 5); c.fillStyle = steelGrad(c, 0, oy + 2, 0, oy + 16); c.fill();
    // plaka çukuru
    rr(c, ox + 4, oy + 16, w - 8, ph, 4); c.fillStyle = '#1a1b1e'; c.fill();
    for (const s of g.slots) {
      const sx = s.x - g.x + ox, sy = s.y - g.hingeY + oy + 16;
      gr = c.createLinearGradient(0, sy, 0, sy + s.h);
      gr.addColorStop(0, '#4a4c52'); gr.addColorStop(1, '#2a2b2f');
      rr(c, sx, sy, s.w, s.h, 4); c.fillStyle = gr; c.fill();
      c.save(); rr(c, sx, sy, s.w, s.h, 4); c.clip();
      for (let y = sy + 5; y < sy + s.h; y += 7) {
        c.fillStyle = 'rgba(0,0,0,0.38)'; c.fillRect(sx, y, s.w, 2);
        c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(sx, y + 2, s.w, 1);
      }
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = 1; rr(c, sx + 0.5, sy + 0.5, s.w - 1, s.h - 1, 4); c.stroke();
    }
    // ön panel
    const fy = oy + 16 + ph;
    rr(c, ox + 1, fy, w - 2, 30, 6);
    gr = c.createLinearGradient(0, fy, 0, fy + 30);
    gr.addColorStop(0, '#dfe4e8'); gr.addColorStop(0.35, '#b3bac1'); gr.addColorStop(1, '#868e96');
    c.fillStyle = gr; c.fill();
    brushed(c, ox + 1, fy, w - 2, 30, 0.12, true);
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(ox + 6, fy + 1, w - 12, 1);
    c.strokeStyle = 'rgba(30,34,40,0.5)'; c.lineWidth = 1; rr(c, ox + 1.5, fy + 0.5, w - 3, 29, 6); c.stroke();
    // ayaklar
    c.fillStyle = '#16171a';
    rr(c, ox + 8, oy + BH - 6, 18, 6, 2); c.fill(); rr(c, ox + w - 26, oy + BH - 6, 18, 6, 2); c.fill();
  }

  function drawTostLid(ctx, g, lidT, hover) {
    const hy = g.hingeY, Ye = lidEdge(g, lidT), L = g.L, k = (Ye - hy) / L;
    const ew = g.w * (1 + 0.035 * k), ex = g.x - (ew - g.w) / 2, x0 = g.x + 2, x1 = g.x + g.w - 2;
    const quad = () => { ctx.beginPath(); ctx.moveTo(x0, hy); ctx.lineTo(x1, hy); ctx.lineTo(ex + ew - 2, Ye); ctx.lineTo(ex + 2, Ye); ctx.closePath(); };
    ctx.save();
    if (Ye > hy + 1.5) {
      // üst yüz (kapanıyor / kapalı)
      const th = 6 * clamp(k, 0, 1);
      let gr = ctx.createLinearGradient(0, hy, 0, Ye);
      gr.addColorStop(0, '#f3f6f8'); gr.addColorStop(0.3, '#cfd5db'); gr.addColorStop(0.72, '#a7afb7'); gr.addColorStop(1, '#8f979f');
      // gölge: kapağın altına düşen
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      quad(); ctx.fillStyle = gr; ctx.fill(); ctx.restore();
      ctx.strokeStyle = 'rgba(30,34,40,0.55)'; ctx.lineWidth = 1.2; quad(); ctx.stroke();
      ctx.save(); quad(); ctx.clip();
      const gx = g.x + g.w * 0.64;
      ctx.globalAlpha = 0.26; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(gx, hy); ctx.lineTo(gx + 20, hy); ctx.lineTo(gx - 8, Ye); ctx.lineTo(gx - 28, Ye); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.12;
      ctx.beginPath(); ctx.moveTo(gx + 28, hy); ctx.lineTo(gx + 34, hy); ctx.lineTo(gx + 6, Ye); ctx.lineTo(gx, Ye); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      if (k > 0.3) {
        const py = hy + (Ye - hy) * 0.1, phh = (Ye - hy) * 0.7;
        ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1; rr(ctx, g.x + 9, py + 1, g.w - 18, phh, 6); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; rr(ctx, g.x + 9, py, g.w - 18, phh, 6); ctx.stroke();
        // havalandırma yarıkları
        ctx.fillStyle = 'rgba(30,34,40,0.25)';
        for (let v = 0; v < 4; v++) rr(ctx, g.x + g.w / 2 - 22 + v * 12, py + 5, 8, 2.2, 1), ctx.fill();
      }
      ctx.restore();
      if (th > 0.5) {
        gr = ctx.createLinearGradient(0, Ye, 0, Ye + th); gr.addColorStop(0, '#7d858d'); gr.addColorStop(1, '#4a5057');
        rr(ctx, ex + 1, Ye, ew - 2, th, 2); ctx.fillStyle = gr; ctx.fill();
      }
      const hw = ew * 0.56, hx = g.x + g.w / 2 - hw / 2, hh = 4 + 5 * clamp(k, 0, 1);
      rr(ctx, hx, Ye - 2, hw, hh, 3.5); ctx.fillStyle = '#1c1c20'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(hx + 5, Ye - 1, hw - 10, 1.4);
    } else if (Ye < hy - 1.5) {
      // alt yüz (açık): oluklu üst plaka görünür
      let gr = ctx.createLinearGradient(0, Ye, 0, hy); gr.addColorStop(0, '#26272c'); gr.addColorStop(1, '#3b3d43');
      quad(); ctx.fillStyle = gr; ctx.fill();
      ctx.save(); quad(); ctx.clip();
      const span = hy - Ye;
      for (let f = 0.12; f < 1; f += 0.11) {
        const y = Ye + span * f;
        ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(g.x, y, g.w, 1.6);
        ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(g.x, y + 1.6, g.w, 1);
      }
      if (power() && phaseActive()) { ctx.fillStyle = 'rgba(255,90,30,0.07)'; ctx.fillRect(g.x, Ye, g.w, span); }
      ctx.restore();
      ctx.lineWidth = 3; ctx.strokeStyle = '#9da5ad'; quad(); ctx.stroke();
      gr = ctx.createLinearGradient(0, Ye - 6, 0, Ye); gr.addColorStop(0, '#eef1f4'); gr.addColorStop(1, '#9ba3ab');
      rr(ctx, ex, Ye - 6, ew, 6, 2); ctx.fillStyle = gr; ctx.fill();
      const hw = ew * 0.56;
      rr(ctx, g.x + g.w / 2 - hw / 2, Ye - 11, hw, 7, 3); ctx.fillStyle = '#1c1c20'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(g.x + g.w / 2 - hw / 2 + 5, Ye - 10, hw - 10, 1.2);
    }
    if (hover) { quad(); ctx.strokeStyle = 'rgba(255,236,160,0.6)'; ctx.lineWidth = 2; ctx.stroke(); }
    // menteşe çubuğu
    const gr2 = ctx.createLinearGradient(0, hy - 4, 0, hy + 4);
    gr2.addColorStop(0, '#f0f3f5'); gr2.addColorStop(0.5, '#9aa2aa'); gr2.addColorStop(1, '#565c63');
    rr(ctx, g.x + 5, hy - 4, g.w - 10, 8, 4); ctx.fillStyle = gr2; ctx.fill();
    ctx.fillStyle = '#3a3f45'; rr(ctx, g.x + 5, hy - 4.5, 12, 9, 3); ctx.fill(); rr(ctx, g.x + g.w - 17, hy - 4.5, 12, 9, 3); ctx.fill();
    ctx.restore();
    return Ye;
  }

  function drawTost(ctx) {
    const TG = tostGeo(), R = TG.R, pw = power(), t = KS.time || 0, act = phaseActive();
    backplate(ctx, R);
    for (const g of TG.list) {
      const M = S.tost.machines[g.i]; if (!M) continue;
      const BH = g.plateH + 52;
      blit(ctx, cached('tostBase' + Math.round(g.w), g.w + 24, BH + 24, c => drawTostBase(c, 12, 12, g)), g.x - 12, g.hingeY - 16 - 12, g.w + 24, BH + 24);
      const hasC = !machineEmpty(M);
      // plaka ısısı
      if (pw && act) {
        const heat = (M.closed ? 0.13 : 0.07) * (0.8 + 0.2 * Math.sin(t * 3 + g.i));
        ctx.fillStyle = 'rgba(255,90,30,' + heat + ')';
        for (const s of g.slots) { rr(ctx, s.x, s.y, s.w, s.h, 4); ctx.fill(); }
      }
      // içerik
      if (M.lidT < 0.985) {
        g.slots.forEach((s, j) => {
          const d = M.slots[j].dish; if (!d) return;
          const sc = clamp(s.w / 100, 0.35, 0.92);
          ctx.save(); rr(ctx, g.x + 2, g.hingeY - 60, g.w - 4, g.plateH + 60, 4); ctx.clip();
          ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(s.cx + 2, s.cy + 6, s.w * 0.42, s.h * 0.36, 0, 0, TAU); ctx.fill();
          drawItemSafe(ctx, d, s.cx, s.cy, sc);
          ctx.restore();
          if (hoverAt(s) && !M.closed && M.lidT < 0.25) {
            ctx.strokeStyle = 'rgba(255,236,160,0.75)'; ctx.lineWidth = 2; rr(ctx, s.x + 1, s.y + 1, s.w - 2, s.h - 2, 5); ctx.stroke();
          }
        });
      }
      const Ye = drawTostLid(ctx, g, M.lidT, hoverAt(g.hit) && !(M.lidT < 0.25 && g.slots.some((s, j) => M.slots[j].dish && hoverAt(s))));
      // kapalıyken: kenardan renk ipucu + halkalar
      if (M.lidT > 0.9) {
        g.slots.forEach((s, j) => {
          const d = M.slots[j].dish; if (!d) return;
          const v = num(d.toast, 0), col = rampAt(R_TOAST, v);
          ctx.save();
          ctx.shadowColor = v >= TUNE.toastBurn ? 'rgba(0,0,0,0.8)' : css(shade(col, 0.2), 0.9); ctx.shadowBlur = 7;
          ctx.fillStyle = css(col);
          rr(ctx, s.x + 4, Ye + 5, s.w - 8, 3, 1.5); ctx.fill();
          ctx.restore();
          const ry = g.hingeY + (Ye - g.hingeY) * 0.45;
          drawRing(ctx, s.cx, ry, clamp(s.w * 0.24, 10, 15), v);
        });
      }
      // ön panel ışıkları
            const allReady = M.slots.every(s => !s.dish || num(s.dish.toast, 0) >= TUNE.toastDone);
      const over = M.slots.some(s => s.dish && num(s.dish.toast, 0) >= TUNE.toastSmoke);
      const redOn = pw && act && M.closed && hasC && !allReady;
      const okReady = M.slots.some(s => s.dish && num(s.dish.toast, 0) >= TUNE.toastDone && num(s.dish.toast, 0) < TUNE.toastBurn);
      const greenOn = pw && act && okReady && (!over || Math.sin(t * 12) > 0);
      led(ctx, g.x + 11, g.faceY + 11, 3.4, '#ff3b30', redOn, pw && act ? 0.18 : 0);
      led(ctx, g.x + 11, g.faceY + 22, 3.4, '#34e05a', greenOn, 0);
      // yuva çubukları
      g.slots.forEach((s, j) => {
        const d = M.slots[j].dish; if (!d) return;
        const bw = Math.min(s.w - 10, 64);
        const bx = clamp(s.cx - bw / 2, g.x + 20, g.x + g.w - 8 - bw);
        drawCookBar(ctx, bx, g.faceY + 15, bw, 5, d.toast);
      });
      if (greenOn && M.closed) {
        txt(ctx, 'Hazır!', g.x + g.w - 8, g.faceY + 8, { size: 10, weight: 900, color: '#2bd24f', align: 'right' });
      }
    }
    stationLabel(ctx, R, 'Tost Makinesi');
    levelTag(ctx, R, 'tost');
    if (!pw && act) noPowerBadge(ctx, R.x + R.w / 2, R.y + 118);
  }

  // ===========================================================================
  // 2) IZGARA
  // ===========================================================================
  function grillGeo() {
    const R = KS.layout.izgara, n = Math.max(1, S.izgara.slots.length);
    const box = { x: R.x + 10, y: R.y + 28, w: R.w - 20, h: R.h - 46 };
    const inner = { x: box.x + 11, y: box.y + 11, w: box.w - 22, h: box.h - 22 };
    const cols = n <= 4 ? 2 : n <= 6 ? 3 : 4, rows = Math.ceil(n / cols);
    const cw = inner.w / cols, ch = inner.h / rows;
    const r = Math.min(30, cw * 0.4, ch * 0.3);
    const slots = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols, ri = Math.floor(i / cols);
      slots.push({ cx: inner.x + cw * (c + 0.5), cy: inner.y + ch * (ri + 0.5) + 8, r });
    }
    return { R, box, inner, slots, r };
  }
  // sabit kor parıltı noktaları
  const GLOW = (() => { const R = rng(4242), a = []; for (let i = 0; i < 14; i++) a.push({ u: 0.06 + R() * 0.88, v: 0.08 + R() * 0.84, r: 34 + R() * 26, s: 1.2 + R() * 2.6, ph: R() * 6 }); return a; })();
  const EMBERS = (() => { const R = rng(999), a = []; for (let i = 0; i < 26; i++) a.push({ u: 0.03 + R() * 0.94, v: 0.05 + R() * 0.9, r: 5 + R() * 7, s: 2 + R() * 4, ph: R() * 6 }); return a; })();

  function drawGrillBox(c, ox, oy, box, inner) {
    const w = box.w, h = box.h;
    const ix = ox + (inner.x - box.x), iy = oy + (inner.y - box.y), iw = inner.w, ih = inner.h;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 12; c.shadowOffsetY = 5;
    rr(c, ox, oy, w, h, 12); c.fillStyle = '#26272b'; c.fill(); c.restore();
    let gr = c.createLinearGradient(0, oy, 0, oy + h);
    gr.addColorStop(0, '#5b5f66'); gr.addColorStop(0.07, '#3b3e44'); gr.addColorStop(1, '#1b1c1f');
    rr(c, ox, oy, w, h, 12); c.fillStyle = gr; c.fill();
    c.lineWidth = 2; c.strokeStyle = '#80868d'; rr(c, ox + 1, oy + 1, w - 2, h - 2, 11); c.stroke();
    c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,0.6)'; rr(c, ox + 0.5, oy + 0.5, w - 1, h - 1, 12); c.stroke();
    for (const p of [[ox + 6, oy + 6], [ox + w - 6, oy + 6], [ox + 6, oy + h - 6], [ox + w - 6, oy + h - 6]]) {
      c.beginPath(); c.arc(p[0], p[1], 2.6, 0, TAU); c.fillStyle = '#9aa0a7'; c.fill();
      c.beginPath(); c.arc(p[0] - 0.7, p[1] - 0.7, 1, 0, TAU); c.fillStyle = '#fff'; c.fill();
    }
    rr(c, ix - 3, iy - 3, iw + 6, ih + 6, 8); c.fillStyle = '#0a0706'; c.fill();
    gr = c.createRadialGradient(ix + iw / 2, iy + ih / 2, 10, ix + iw / 2, iy + ih / 2, iw * 0.7);
    gr.addColorStop(0, '#2e1810'); gr.addColorStop(1, '#0d0806');
    rr(c, ix, iy, iw, ih, 6); c.fillStyle = gr; c.fill();
    c.save(); rr(c, ix, iy, iw, ih, 6); c.clip();
    const R = rng(77), cols = ['#2c2522', '#3a302b', '#221c1a', '#332824'];
    for (let i = 0; i < 120; i++) {
      const x = ix + R() * iw, y = iy + R() * ih, r = 5 + R() * 8, n = 6;
      c.beginPath();
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU + R() * 0.4, rr_ = r * (0.7 + 0.3 * R());
        if (k === 0) c.moveTo(x + Math.cos(a) * rr_, y + Math.sin(a) * rr_ * 0.8); else c.lineTo(x + Math.cos(a) * rr_, y + Math.sin(a) * rr_ * 0.8);
      }
      c.closePath(); c.fillStyle = cols[(R() * cols.length) | 0]; c.fill();
      if (R() < 0.5) { c.strokeStyle = 'rgba(255,90,20,0.22)'; c.lineWidth = 1; c.stroke(); }
      c.fillStyle = 'rgba(255,255,255,0.05)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, TAU); c.fill();
    }
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.65)'; c.lineWidth = 4; rr(c, ix, iy, iw, ih, 6); c.stroke();
  }
  function drawGrate(c, ox, oy, box, inner) {
    const ix = ox + (inner.x - box.x), iy = oy + (inner.y - box.y), iw = inner.w, ih = inner.h;
    for (const f of [0.2, 0.5, 0.8]) {
      const x = ix + iw * f;
      c.fillStyle = '#18191c'; c.fillRect(x - 3, iy - 4, 6, ih + 8);
      c.fillStyle = 'rgba(255,255,255,0.09)'; c.fillRect(x - 3, iy - 4, 1.5, ih + 8);
    }
    for (let y = iy + 4; y < iy + ih - 2; y += 12) {
      const gr = c.createLinearGradient(0, y, 0, y + 6);
      gr.addColorStop(0, '#a3a9b0'); gr.addColorStop(0.35, '#5b6067'); gr.addColorStop(1, '#1e2024');
      rr(c, ix - 6, y, iw + 12, 6, 3); c.fillStyle = gr; c.fill();
      c.fillStyle = 'rgba(255,120,40,0.2)'; c.fillRect(ix - 6, y + 5, iw + 12, 1.2);
    }
  }

  // Köfte çizimi: top = üst yüz pişmesi, bottom = alt yüz (kenar bandı rengi), sy = çevirme ölçeği
  function pattyPoints(seed) {
    const R = rng(seed * 9301 + 49297), N = 14, pts = [];
    for (let i = 0; i < N; i++) pts.push(1 + (R() - 0.5) * 0.13);
    const specks = [];
    for (let i = 0; i < 20; i++) { const a = R() * TAU, d = Math.sqrt(R()) * 0.78; specks.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: 0.6 + R() * 1.4, fat: R() < 0.45 }); }
    return { pts, specks, markTilt: (R() - 0.5) * 0.25 };
  }
  const pattyCache = {};
  function pattyShape(ctx, x, y, r, pts, rot, ky) {
    const N = pts.length, P2 = [];
    for (let i = 0; i < N; i++) { const a = i / N * TAU + rot; P2.push([x + Math.cos(a) * r * pts[i], y + Math.sin(a) * r * pts[i] * ky]); }
    ctx.beginPath();
    const m0 = [(P2[N - 1][0] + P2[0][0]) / 2, (P2[N - 1][1] + P2[0][1]) / 2];
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < N; i++) { const p = P2[i], q = P2[(i + 1) % N]; ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    ctx.closePath();
  }
  function drawPatty(ctx, x, y, r, top, bottom, seed, rot, sy) {
    const geo = pattyCache[seed] || (pattyCache[seed] = pattyPoints(seed));
    const ky = 0.8 * Math.max(0.06, sy);
    const tc = rampAt(R_PATTY, top), bc = rampAt(R_PATTY, bottom);
    const thick = 5 * Math.max(0.15, sy);
    // kenar (alt yüzün rengi görünür)
    pattyShape(ctx, x, y + thick, r, geo.pts, rot, ky);
    ctx.fillStyle = css(shade(bc, -0.12)); ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = css(shade(bc, -0.5), 0.9); ctx.stroke();
    // üst yüz
    pattyShape(ctx, x, y, r, geo.pts, rot, ky);
    const gr = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3 * ky, r * 0.1, x, y, r * 1.1);
    gr.addColorStop(0, css(shade(tc, 0.2))); gr.addColorStop(0.6, css(tc)); gr.addColorStop(1, css(shade(tc, -0.32)));
    ctx.fillStyle = gr; ctx.fill();
    ctx.save(); ctx.clip();
    // kıyma dokusu
    for (const s of geo.specks) {
      ctx.fillStyle = s.fat ? 'rgba(255,228,205,' + (0.28 * (1 - clamp(top, 0, 1.2) * 0.5)) + ')' : 'rgba(40,14,4,0.25)';
      ctx.beginPath(); ctx.arc(x + s.x * r, y + s.y * r * ky, s.s * (r / 24), 0, TAU); ctx.fill();
    }
    // ızgara izleri (bu yüz daha önce alttaydıysa)
    if (top > 0.3) {
      const a = clamp((top - 0.3) / 0.7, 0, 0.8);
      ctx.strokeStyle = 'rgba(32,14,6,' + a + ')'; ctx.lineWidth = r * 0.17; ctx.lineCap = 'round';
      for (let k = -1.5; k <= 1.5; k++) {
        const yy = y + k * r * 0.42 * ky, tilt = geo.markTilt * r;
        ctx.beginPath(); ctx.moveTo(x - r * 1.1, yy - tilt); ctx.lineTo(x + r * 1.1, yy + tilt); ctx.stroke();
      }
    }
    if (top > 1.4) {
      ctx.fillStyle = 'rgba(10,8,8,' + clamp((top - 1.4) * 1.2, 0, 0.7) + ')';
      for (let i = 0; i < 5; i++) { const s = geo.specks[i]; ctx.beginPath(); ctx.ellipse(x + s.x * r, y + s.y * r * ky, r * 0.28, r * 0.2 * ky, s.x, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    // ıslak parlaklık
    ctx.fillStyle = 'rgba(255,255,255,' + (0.28 * (1 - clamp(top, 0, 1) * 0.55)) + ')';
    ctx.beginPath(); ctx.ellipse(x - r * 0.36, y - r * 0.38 * ky, r * 0.32, r * 0.12 * Math.max(0.3, ky), -0.4, 0, TAU); ctx.fill();
  }
  function drawFlipIcon(ctx, x, y, s, a) {
    ctx.save(); ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(x, y, s + 4, 0, TAU); ctx.fillStyle = 'rgba(16,30,18,0.82)'; ctx.fill();
    ctx.strokeStyle = '#8dff9a'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, s, -2.7, 1.3); ctx.stroke();
    const ax = x + Math.cos(1.3) * s, ay = y + Math.sin(1.3) * s;
    ctx.beginPath(); ctx.moveTo(ax - 4, ay - 1); ctx.lineTo(ax, ay); ctx.lineTo(ax - 1, ay - 4.5); ctx.stroke();
    ctx.restore();
  }

  function pattyFlags(sl) {
    const it = sl.item; if (!it) { sl.ready = sl.smk = sl.burn = false; return; }
    const a = num(it.cookA, 0);
    sl.ready = a >= TUNE.grillReady; sl.smk = a >= TUNE.grillSmoke; sl.burn = a >= TUNE.grillBurn;
  }
  let pattySeed = 1;
  function placePatty(i, item) {
    const sl = S.izgara.slots[i]; if (!sl || sl.item) return false;
    item.cookA = clamp(num(item.cookA, 0), 0, TUNE.grillMax); item.cookB = clamp(num(item.cookB, 0), 0, TUNE.grillMax);
    sl.item = item; sl.flipT = -1; sl.drop = 1;
    sl.seed = (item.uid || 0) * 7 + (pattySeed++);
    sl.rot = rand(0, TAU);
    pattyFlags(sl);
    return true;
  }
  function takePatty(i) {
    const sl = S.izgara.slots[i]; if (!sl || !sl.item) return null;
    const it = sl.item; sl.item = null; sl.flipT = -1; pattyFlags(sl);
    S.izgara.lastSlot = i;
    const out = KS.items && KS.items.ing ? KS.items.ing('kofte', { cookA: num(it.cookA, 0), cookB: num(it.cookB, 0) }) : it;
    if (it.uid != null) out.uid = it.uid;
    return out;
  }
  function flipPatty(i) {
    const sl = S.izgara.slots[i]; if (!sl || !sl.item || sl.flipT >= 0) return false;
    const it = sl.item, a = num(it.cookA, 0);
    it.cookA = num(it.cookB, 0); it.cookB = a;
    sl.flipT = 0; sl.rot += rand(-0.5, 0.5);
    pattyFlags(sl);
    snd('sizzle_start');
    const s = grillGeo().slots[i];
    if (s && running()) sparks(s.cx, s.cy, 6);
    return true;
  }
  function grillNearest(pt, wantItem) {
    const G = grillGeo(); let best = -1, bd = 1e9;
    G.slots.forEach((s, i) => {
      const sl = S.izgara.slots[i]; if (!sl) return;
      if (wantItem === true && !sl.item) return;
      if (wantItem === false && sl.item) return;
      const d = pt ? dist(pt.x, pt.y, s.cx, s.cy) : i;
      if (d < bd) { bd = d; best = i; }
    });
    return { i: best, d: bd, G };
  }
  const grillPress = { active: false, i: -1, x: 0, y: 0 };
  const izgaraZone = {
    id: 'izgara', z: 5,
    getRect: () => KS.layout.izgara,
    canDrop(item) { return !!item && item.type === 'ing' && item.id === 'kofte' && S.izgara.slots.some(s => !s.item); },
    onDrop(item, pt) {
      const h = grillNearest(pt, false); if (h.i < 0) return false;
      if (!placePatty(h.i, item)) return false;
      snd('sizzle_start');
      const s = h.G.slots[h.i]; if (s && running()) sparks(s.cx, s.cy, 8);
      return true;
    },
    onReturn(item) {
      const last = S.izgara.lastSlot;
      if (last >= 0 && S.izgara.slots[last] && !S.izgara.slots[last].item) { placePatty(last, item); return; }
      const h = grillNearest(null, false); if (h.i >= 0) placePatty(h.i, item); else warnOnce('grillReturn', 'yer yok');
    },
    onPick(pt) {
      grillPress.active = false;
      const h = grillNearest(pt, true);
      if (h.i >= 0 && h.d <= h.G.r * 1.3 && S.izgara.slots[h.i].flipT < 0) { grillPress.active = true; grillPress.i = h.i; grillPress.x = pt.x; grillPress.y = pt.y; }
      return null;
    },
    onDrag(pt) {
      if (!grillPress.active || KS.held) return;
      if (dist(pt.x, pt.y, grillPress.x, grillPress.y) < 12) return;
      grillPress.active = false;
      const item = takePatty(grillPress.i); if (!item) return;
      KS.held = { item, from: izgaraZone, x: pt.x, y: pt.y, sx: grillPress.x, sy: grillPress.y, moved: true, sticky: false, t: 0 };
      snd('pick');
    },
    onClick() { if (!grillPress.active) return; grillPress.active = false; flipPatty(grillPress.i); },
    onRelease() { grillPress.active = false; },
    tooltip(pt) {
      const h = grillNearest(pt, true);
      if (h.i >= 0 && h.d <= h.G.r * 1.3) {
        const it = S.izgara.slots[h.i].item, a = num(it.cookA, 0), b = num(it.cookB, 0);
        const overall = Math.min(a, b) < 0.45 ? Math.min(a, b) : (a + b) / 2;
        return 'Köfte — ' + cookLbl(overall) + '\nAlt: ' + cookLbl(a).toLowerCase() + ' (%' + pct(a) + ') • Üst: ' + cookLbl(b).toLowerCase() + ' (%' + pct(b) + ')' +
          '\nTıkla: çevir • Sürükle: al' + (a >= TUNE.grillReady && b < TUNE.grillReady ? '\n↻ Alt yüz pişti, çevir!' : '');
      }
      const free = S.izgara.slots.filter(s => !s.item).length;
      return 'Izgara — ' + free + '/' + S.izgara.slots.length + ' yer boş\nÇiğ köfteyi ızgaraya bırak; alt yüz pişince çevir.';
    },
  };

  function updateIzgara(dt, rdt, run) {
    const spd = Math.max(0.1, uv('izgara', 'speed', 1)), G = grillGeo();
    let n = 0;
    S.izgara.slots.forEach((sl, i) => {
      if (sl.flipT >= 0) { sl.flipT += rdt / 0.42; if (sl.flipT >= 1) sl.flipT = -1; }
      if (sl.drop > 0) sl.drop = Math.max(0, sl.drop - rdt * 5);
      const it = sl.item; if (!it) return;
      n++;
      const s = G.slots[i]; if (!s) return;
      const chef = !!(KS.hasStaff && KS.hasStaff('sef'));
      const resting = chef && num(it.cookA, 0) >= 1.0 && num(it.cookB, 0) >= 1.0;   // usta aşçı pişmiş köfteyi ızgaranın kenarına çeker
      if (run && !resting) it.cookA = Math.min(TUNE.grillMax, num(it.cookA, 0) + dt * spd / TUNE.grillTime);
      const a = num(it.cookA, 0), b = num(it.cookB, 0);
      if (chef && run && a >= 1.0 && b < TUNE.grillReady && sl.flipT < 0) { flipPatty(i); floatTxt(s.cx, s.cy - s.r - 12, '👨‍🍳 Çevirdi', '#ffe08a', 15); }
      if (!sl.ready && a >= TUNE.grillReady) { sl.ready = true; if (b < TUNE.grillReady) snd('tick', { vol: 0.5 }); }
      if (!sl.smk && a >= TUNE.grillSmoke) sl.smk = true;
      if (!sl.burn && a >= TUNE.grillBurn) { sl.burn = true; snd('burn'); floatTxt(s.cx, s.cy - s.r - 14, 'Yanıyor!', '#ff6a5a', 18); }
      if (run) {
        if (Math.random() < dt * 3.5) sparks(s.cx + rand(-s.r, s.r), s.cy + rand(-s.r * 0.4, s.r * 0.6), 1 + ((Math.random() * 2) | 0));
        if (Math.random() < dt * 1.3 && S.izgara.flares.length < 30) {
          S.izgara.flares.push({ x: s.cx + rand(-s.r * 0.95, s.r * 0.95), y: s.cy + s.r * 0.55 + rand(0, 6), h: rand(16, 32) * (s.r / 26), t: 0, life: rand(0.25, 0.5) });
          if (Math.random() < 0.5) drip(s.cx + rand(-s.r * 0.6, s.r * 0.6), s.cy + s.r * 0.5, s.cy + s.r * 0.5 + rand(6, 12), 'rgba(255,220,150,0.9)');
        }
        const burnt = a >= TUNE.grillBurn, over = a >= TUNE.grillSmoke;
        if (Math.random() < dt * (burnt ? 7 : over ? 4 : 1.6)) {
          puff(burnt ? 'dark' : over ? 'smoke' : 'steam', s.cx + rand(-s.r * 0.6, s.r * 0.6), s.cy - s.r * 0.3, { a: burnt ? 0.5 : 0.26, size: over ? 1.1 : 0.8 });
        }
      }
    });
    for (let i = S.izgara.flares.length - 1; i >= 0; i--) { const f = S.izgara.flares[i]; f.t += rdt; if (f.t >= f.life) S.izgara.flares.splice(i, 1); }
    loop('izgara', run && n > 0, 'sizzle');
  }

  function drawIzgara(ctx) {
    const G = grillGeo(), R = G.R, t = KS.time || 0, act = phaseActive(), box = G.box, inner = G.inner;
    backplate(ctx, R);
    const key = box.w + 'x' + box.h;
    blit(ctx, cached('grillBox' + key, box.w + 24, box.h + 24, c => drawGrillBox(c, 12, 12, box, inner)), box.x - 12, box.y - 12, box.w + 24, box.h + 24);
    const sp = sprites();
    // kor parıltısı
    ctx.save();
    rr(ctx, inner.x, inner.y, inner.w, inner.h, 6); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const heat = act ? 1 : 0.5;
    for (const p of GLOW) {
      const fl = 0.55 + 0.25 * Math.sin(t * p.s + p.ph) + 0.12 * Math.sin(t * p.s * 2.7 + p.ph * 3);
      const x = inner.x + p.u * inner.w, y = inner.y + p.v * inner.h, r = p.r * (0.9 + 0.15 * fl);
      ctx.globalAlpha = clamp(fl * 0.5 * heat, 0, 1);
      ctx.drawImage(sp.glow, x - r, y - r, r * 2, r * 2);
    }
    for (const e of EMBERS) {
      const fl = 0.5 + 0.5 * Math.sin(t * e.s + e.ph);
      const x = inner.x + e.u * inner.w, y = inner.y + e.v * inner.h, r = e.r * (0.8 + 0.4 * fl);
      ctx.globalAlpha = clamp((0.25 + 0.6 * fl) * heat, 0, 1);
      ctx.drawImage(sp.ember, x - r, y - r, r * 2, r * 2);
    }
    // alev parlamaları (yağ damlayınca)
    for (const f of S.izgara.flares) {
      const u = f.t / f.life, h = f.h * Math.sin(Math.PI * Math.min(1, u * 1.15));
      ctx.globalAlpha = 0.9 * (1 - u * 0.4);
      ctx.drawImage(sp.flame, f.x - h * 0.3, f.y - h, h * 0.6, h);
    }
    ctx.restore();
    blit(ctx, cached('grillGrate' + key, box.w + 24, box.h + 24, c => drawGrate(c, 12, 12, box, inner)), box.x - 12, box.y - 12, box.w + 24, box.h + 24);
    // köfteler
    S.izgara.slots.forEach((sl, i) => {
      const s = G.slots[i], it = sl.item; if (!s || !it) return;
      const a = num(it.cookA, 0), b = num(it.cookB, 0);
      let lift = 0, sy = 1, topV = b, botV = a;
      if (sl.flipT >= 0) {
        const f = clamp(sl.flipT, 0, 1);
        lift = Math.sin(Math.PI * f) * 30; sy = Math.abs(Math.cos(Math.PI * f));
        if (f < 0.5) { topV = a; botV = b; }
      }
      const sc = 1 + sl.drop * 0.14;
      const r = s.r * sc;
      // gölge
      ctx.fillStyle = 'rgba(0,0,0,' + (0.45 * (1 - lift / 50)) + ')';
      ctx.beginPath(); ctx.ellipse(s.cx + 3, s.cy + r * 0.45 + 3, r * (1 - lift / 90), r * 0.36, 0, 0, TAU); ctx.fill();
      drawPatty(ctx, s.cx, s.cy - lift, r, topV, botV, sl.seed, sl.rot, sy);
      const hov = hoverAt({ x: s.cx - r, y: s.cy - r, w: r * 2, h: r * 2 });
      if (hov) { ctx.strokeStyle = 'rgba(255,236,160,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(s.cx, s.cy + 2, r + 4, r * 0.8 + 6, 0, 0, TAU); ctx.stroke(); }
      // iki yüz göstergesi: üst bar = üst yüz, alt bar = alt yüz
      const bw = Math.min(r * 2, 46), bx = s.cx - bw / 2, by = s.cy - r * 0.8 - 17 - lift;
      drawCookBar(ctx, bx, by, bw, 4, b);
      drawCookBar(ctx, bx, by + 6.5, bw, 4, a);
      if (a >= TUNE.grillReady && b < TUNE.grillReady && sl.flipT < 0) {
        drawFlipIcon(ctx, s.cx + r * 0.9, s.cy - r * 0.55, 6, 0.65 + 0.35 * Math.sin(t * 8));
      }
    });
    stationLabel(ctx, R, 'Izgara');
    levelTag(ctx, R, 'izgara');
  }

  // ===========================================================================
  // 3) FRİTÖZ
  // ===========================================================================
  function fryGeo() {
    const R = KS.layout.fritoz, n = Math.max(1, S.fritoz.baskets.length);
    const body = { x: R.x + 10, y: R.y + 40, w: R.w - 20, h: R.h - 56 };
    const vat = { x: body.x + 12, y: body.y + 14, w: body.w - 24, h: 92 };
    const oilY = vat.y + 28;
    const panel = { x: body.x + 8, y: vat.y + vat.h + 10, w: body.w - 16, h: body.y + body.h - (vat.y + vat.h + 10) - 8 };
    const bw = n === 1 ? 116 : 82, bh = 40, gap = 12, tot = bw * n + gap * (n - 1), bx0 = vat.x + (vat.w - tot) / 2;
    const baskets = [];
    for (let i = 0; i < n; i++) { const x = bx0 + i * (bw + gap); baskets.push({ x, w: bw, h: bh, cx: x + bw / 2, upY: vat.y - 24, downY: oilY - 5 }); }
    const dial = { x: panel.x + 28, y: panel.y + panel.h / 2 + 1, r: 19 };
    const gauge = { x: panel.x + 60, y: panel.y + 20, w: panel.w - 70, h: 7 };
    const btn = { x: panel.x + 60, y: panel.y + 35, w: panel.w - 70, h: 24 };
    return { R, body, vat, oilY, panel, baskets, dial, gauge, btn };
  }
  const basketY = (g, B) => lerp(g.upY, g.downY, easeIO(B.downT));
  function basketHit(g, B) { const y = basketY(g, B); return { x: g.x - 6, y: y - 12, w: g.w + 12, h: g.h + 48 }; }
  function basketAt(G, pt) {
    for (let i = 0; i < G.baskets.length; i++) { const B = S.fritoz.baskets[i]; if (B && inR(pt, basketHit(G.baskets[i], B))) return i; }
    if (inR(pt, { x: G.vat.x, y: G.vat.y - 30, w: G.vat.w, h: G.vat.h + 30 })) {
      let best = -1, bd = 1e9;
      G.baskets.forEach((g, i) => { const d = Math.abs(pt.x - g.cx); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    return -1;
  }
  // Yağ ömrü KS.state.oilLife'ta tutulur (KS.save ile kaydedilir); alan yoksa taze (oilMax) kabul edilir.
  const oilGet = () => { const v = KS.state && KS.state.oilLife; return typeof v === 'number' && isFinite(v) ? clamp(v, 0, TUNE.oilMax) : TUNE.oilMax; };
  const oilSet = v => { if (KS.state) KS.state.oilLife = clamp(num(v, TUNE.oilMax), 0, TUNE.oilMax); };
  const oilWear = () => 1 - clamp(oilGet() / TUNE.oilMax, 0, 1);
  function oilMult() { const L = oilGet(); return L > TUNE.oilOld ? 1 : L > 0 ? TUNE.oilOldMult : TUNE.oilDeadMult; }
  function fryCanTake(item) {
    if (!item) return false;
    if (item.type === 'ing' && item.id === 'patates') return true;
    return item.type === 'dish' && item.id === 'kese' && Array.isArray(item.layers) && item.layers.length === 1 && item.layers[0].id === 'patates';
  }
  function makeKese(c) {
    const cook = num(c.cook, 0), om = num(c.oilMult, 1);
    const layer = { id: 'patates', cook, q: cookQ(cook) * om };
    const it = KS.items.dish('kese', { layers: [layer] });
    it.oilMult = om;
    return it;
  }
  function fryFlags(B) { const c = B.c ? num(B.c.cook, 0) : 0; B.ready = c >= TUNE.fryDone; B.burn = c >= TUNE.fryBurn; }
  function takeFries(i) {
    const B = S.fritoz.baskets[i]; if (!B || !B.c) return null;
    const it = makeKese(B.c);
    if (B.down || B.downT > 0.3) B.drip = 2.2;
    B.c = null; B.down = false; fryFlags(B);
    S.fritoz.lastBasket = i;
    return it;
  }
  function toggleBasket(i) {
    const B = S.fritoz.baskets[i]; if (!B) return;
    B.down = !B.down;
    if (B.down) { if (B.c) { snd('fry_in'); B.splash = 1; } else snd('click'); if (!power()) note('Elektrik yok — fritöz ısınmıyor!', 'warn'); }
    else { B.drip = 2.2; snd('click'); }
  }
  function changeOil() {
    const F = S.fritoz;
    if (oilGet() >= TUNE.oilMax) { note('Fritöz yağı zaten taze.', 'info'); snd('click'); return false; }
    if (!invTake('yag')) { note('Kızartma yağı kalmadı! Toptancıdan sipariş et.', 'warn'); snd('error'); return false; }
    oilSet(TUNE.oilMax); F.oldWarned = false;
    snd('pour');
    const G = fryGeo();
    floatTxt(G.vat.x + G.vat.w / 2, G.vat.y - 6, 'Taze yağ!', '#ffe08a', 20);
    note('Fritöz yağı değiştirildi.', 'good');
    return true;
  }
  function placeFries(i, item) {
    const F = S.fritoz, B = F.baskets[i]; if (!B || B.c) return false;
    if (item.type === 'ing') {
      const om = oilMult();
      B.c = { cook: num(item.cook, 0), oilMult: om };
      oilSet(oilGet() - 1);
      if (!F.oldWarned && oilGet() <= TUNE.oilOld) { F.oldWarned = true; note('Fritöz yağı eskidi — patatesler kötüleşiyor. "Yağı Değiştir"e bas!', 'warn'); }
    } else {
      const L = item.layers[0];
      B.c = { cook: num(L.cook, 0), oilMult: num(item.oilMult, 1) };
    }
    B.seed = ((Math.random() * 1e6) | 0) + 1;
    fryFlags(B);
    return true;
  }
  const fryPress = { active: false, i: -1, x: 0, y: 0 };
  const fritozZone = {
    id: 'fritoz', z: 5,
    getRect: () => KS.layout.fritoz,
    canDrop(item) { return fryCanTake(item) && S.fritoz.baskets.some(b => !b.c); },
    onDrop(item, pt) {
      const G = fryGeo(); let best = -1, bd = 1e9;
      G.baskets.forEach((g, i) => { const B = S.fritoz.baskets[i]; if (!B || B.c) return; const d = pt ? Math.abs(pt.x - g.cx) : i; if (d < bd) { bd = d; best = i; } });
      if (best < 0 || !placeFries(best, item)) return false;
      const B = S.fritoz.baskets[best];
      B.down = true; B.splash = 1;
      snd('fry_in');
      if (!power()) note('Elektrik yok — fritöz ısınmıyor!', 'warn');
      return true;
    },
    onReturn(item) {
      const F = S.fritoz;
      let i = F.lastBasket;
      if (!(i >= 0 && F.baskets[i] && !F.baskets[i].c)) i = F.baskets.findIndex(b => !b.c);
      if (i < 0) { warnOnce('fryReturn', 'yer yok'); return; }
      const B = F.baskets[i];
      if (item.type === 'dish') { const L = (item.layers && item.layers[0]) || {}; B.c = { cook: num(L.cook, 0), oilMult: num(item.oilMult, 1) }; }
      else B.c = { cook: num(item.cook, 0), oilMult: oilMult() };
      B.down = false; fryFlags(B);
    },
    onPick(pt) {
      fryPress.active = false;
      const G = fryGeo();
      if (inR(pt, G.btn)) return null;
      const i = basketAt(G, pt); if (i < 0) return null;
      const B = S.fritoz.baskets[i];
      if (!B.c) return null;
      if (!B.down && B.downT < 0.5) return takeFries(i);
      Object.assign(fryPress, { active: true, i, x: pt.x, y: pt.y });
      return null;
    },
    onDrag(pt) {
      if (!fryPress.active || KS.held) return;
      if (dist(pt.x, pt.y, fryPress.x, fryPress.y) < 12) return;
      fryPress.active = false;
      const item = takeFries(fryPress.i); if (!item) return;
      KS.held = { item, from: fritozZone, x: pt.x, y: pt.y, sx: fryPress.x, sy: fryPress.y, moved: true, sticky: false, t: 0 };
      snd('pick');
    },
    onClick(pt) {
      const G = fryGeo();
      if (inR(pt, G.btn)) { fryPress.active = false; changeOil(); return; }
      const i = fryPress.active ? fryPress.i : basketAt(G, pt);
      fryPress.active = false;
      if (i >= 0) toggleBasket(i);
    },
    onRelease() { fryPress.active = false; },
    tooltip(pt) {
      const G = fryGeo(), F = S.fritoz;
      const warn = power() ? '' : '\n⚡ Elektrik yok — fritöz ısınmıyor!';
      if (inR(pt, G.btn)) return 'Yağı Değiştir — 1 Kızartma Yağı harcar (stok: ' + invGet('yag') + ')\nYağ ömrü: ' + oilGet() + '/' + TUNE.oilMax + ' porsiyon';
      const i = basketAt(G, pt);
      if (i >= 0) {
        const B = F.baskets[i];
        if (B.c) {
          const c = num(B.c.cook, 0);
          const oil = B.c.oilMult < 1 ? '\nEski yağda kızarıyor (kalite düşük)' : '';
          if (B.down) return 'Patates — ' + cookLbl(c) + ' (%' + pct(c) + ')\nYağda kızarıyor • Tıkla: sepeti kaldır • Sürükle: keseye al' + oil + warn;
          return 'Patates — ' + cookLbl(c) + ' (%' + pct(c) + ')\nSepet yukarıda • Tıkla/sürükle: keseye al' + oil;
        }
        return 'Fritöz sepeti (boş)\nÇiğ patatesi sepete bırak — sepet yağa iner' + warn;
      }
      return 'Fritöz — yağ ömrü ' + oilGet() + '/' + TUNE.oilMax + (oilGet() <= TUNE.oilOld ? ' (ESKİ!)' : '') + '\nÇiğ patatesi sepete bırak' + warn;
    },
  };

  function updateFritoz(dt, rdt, run) {
    const F = S.fritoz, pw = power(), spd = Math.max(0.1, uv('fritoz', 'speed', 1)), G = fryGeo();
    let frying = false;
    if (run) F.temp = pw ? Math.min(1, F.temp + dt / TUNE.fryHeatUp) : Math.max(0, F.temp - dt / TUNE.fryCoolDown);
    const heat = smooth(0.3, 0.9, F.temp);
    const oc = css(rampAt(R_OIL, oilWear()), 0.95);
    F.baskets.forEach((B, i) => {
      const target = B.down ? 1 : 0;
      B.downT += clamp(target - B.downT, -rdt * 3.2, rdt * 3.2);
      if (B.drip > 0) B.drip = Math.max(0, B.drip - rdt);
      if (B.splash > 0) B.splash = Math.max(0, B.splash - rdt * 2);
      const g = G.baskets[i]; if (!g) return;
      const inOil = B.down && B.downT > 0.85;
      if (B.c) {
        if (run && inOil && heat > 0) { B.c.cook = Math.min(TUNE.fryMax, num(B.c.cook, 0) + dt * spd * heat / TUNE.fryTime); frying = true; }
        const c = num(B.c.cook, 0);
        if (run && B.down && c >= 1.02 && KS.hasStaff && KS.hasStaff('sef')) { toggleBasket(i); floatTxt(g.cx, G.oilY - 40, '👨‍🍳 Kaldırdı', '#ffe08a', 15); }
        if (!B.ready && c >= TUNE.fryDone) { B.ready = true; if (c < TUNE.fryBurn) { snd('ready'); floatTxt(g.cx, G.oilY - 24, 'Hazır!', '#7dff8a', 20); } }
        if (!B.burn && c >= TUNE.fryBurn) { B.burn = true; snd('burn'); floatTxt(g.cx, G.oilY - 24, 'Yandı!', '#ff6a5a', 20); }
        if (run && c >= TUNE.frySmoke && Math.random() < dt * (c >= TUNE.fryBurn ? 6 : 2.5)) {
          puff(c >= TUNE.fryBurn ? 'dark' : 'smoke', g.cx + rand(-g.w * 0.35, g.w * 0.35), basketY(g, B), { a: c >= TUNE.fryBurn ? 0.5 : 0.32 });
        }
      }
      if (run) {
        if (inOil && heat > 0.05) {
          const wet = B.c ? 1 + Math.max(0, 1 - num(B.c.cook, 0)) * 1.4 : 0;
          const rate = (B.c ? 26 * wet : 3) * heat + B.splash * 40;
          let k = rate * dt; while (k > 0) { if (Math.random() < k) bubble(g.x + rand(-6, g.w + 6), G.oilY + rand(1, 10), rand(1.2, B.c ? 3.2 : 2)); k -= 1; }
          if (B.c && heat > 0.2 && Math.random() < dt * 3.2) puff('steam', g.cx + rand(-g.w * 0.4, g.w * 0.4), G.oilY - 6, { a: 0.24, size: 0.9 });
        }
        if (B.splash > 0.7 && Math.random() < 0.5) sparks(g.cx + rand(-g.w * 0.4, g.w * 0.4), G.oilY, 1, { color: '#ffe7a0', sp: 0.7 });
      }
      if (B.drip > 0 && B.downT < 0.3 && Math.random() < rdt * 12 * (B.drip / 2.2 + 0.15)) {
        drip(g.x + rand(8, g.w - 8), basketY(g, B) + g.h, G.oilY + rand(4, 22), oc, 'fry');
      }
    });
    if (run && heat > 0.3 && Math.random() < dt * 5 * heat) bubble(G.vat.x + rand(8, G.vat.w - 8), G.oilY + rand(4, 54), rand(0.8, 1.8));
    loop('fritoz', run && frying, 'fry');
  }

  function drawFryBody(c, ox, oy, G) {
    const b = G.body, v = G.vat, p = G.panel, dx = ox - b.x, dy = oy - b.y;
    const X = x => x + dx, Y = y => y + dy;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 12; c.shadowOffsetY = 5;
    rr(c, X(b.x), Y(b.y), b.w, b.h, 12); c.fillStyle = '#7c848c'; c.fill(); c.restore();
    rr(c, X(b.x), Y(b.y), b.w, b.h, 12); c.fillStyle = steelGrad(c, X(b.x), 0, X(b.x + b.w), 0); c.fill();
    brushed(c, X(b.x), Y(b.y), b.w, b.h, 0.1, false);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(X(b.x) + 10, Y(b.y) + 2, b.w - 20, 2);
    c.strokeStyle = 'rgba(30,34,40,0.6)'; c.lineWidth = 1.2; rr(c, X(b.x) + 0.5, Y(b.y) + 0.5, b.w - 1, b.h - 1, 12); c.stroke();
    // hazne ağzı
    rr(c, X(v.x) - 5, Y(v.y) - 5, v.w + 10, v.h + 10, 12);
    let gr = c.createLinearGradient(0, Y(v.y) - 5, 0, Y(v.y + v.h) + 5);
    gr.addColorStop(0, '#f6f8fa'); gr.addColorStop(0.5, '#aab2ba'); gr.addColorStop(1, '#717980');
    c.fillStyle = gr; c.fill();
    rr(c, X(v.x), Y(v.y), v.w, v.h, 9); c.fillStyle = '#16171a'; c.fill();
    // arka iç duvar
    gr = c.createLinearGradient(0, Y(v.y), 0, Y(G.oilY));
    gr.addColorStop(0, '#2b2e33'); gr.addColorStop(1, '#55595f');
    rr(c, X(v.x) + 3, Y(v.y) + 3, v.w - 6, G.oilY - v.y, 7); c.fillStyle = gr; c.fill();
    // sepet askı kancaları
    for (const g of G.baskets) {
      c.strokeStyle = '#c9ced3'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(X(g.cx) - 10, Y(v.y) + 2); c.lineTo(X(g.cx) - 10, Y(v.y) - 8); c.moveTo(X(g.cx) + 10, Y(v.y) + 2); c.lineTo(X(g.cx) + 10, Y(v.y) - 8); c.stroke();
    }
    // kontrol paneli
    rr(c, X(p.x), Y(p.y), p.w, p.h, 8);
    gr = c.createLinearGradient(0, Y(p.y), 0, Y(p.y + p.h)); gr.addColorStop(0, '#3a3f46'); gr.addColorStop(1, '#23262b');
    c.fillStyle = gr; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 1; rr(c, X(p.x) + 0.5, Y(p.y) + 0.5, p.w - 1, p.h - 1, 8); c.stroke();
    // kadran yüzü
    const d = G.dial;
    c.beginPath(); c.arc(X(d.x), Y(d.y), d.r + 3, 0, TAU); c.fillStyle = steelGrad(c, X(d.x) - d.r, Y(d.y) - d.r, X(d.x) + d.r, Y(d.y) + d.r); c.fill();
    c.beginPath(); c.arc(X(d.x), Y(d.y), d.r, 0, TAU); c.fillStyle = '#f4f1e8'; c.fill();
    for (let k = 0; k <= 8; k++) {
      const a = -Math.PI * 1.15 + k / 8 * Math.PI * 1.3;
      c.strokeStyle = k >= 6 ? '#d0392b' : '#3a3f46'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(X(d.x) + Math.cos(a) * d.r * 0.72, Y(d.y) + Math.sin(a) * d.r * 0.72); c.lineTo(X(d.x) + Math.cos(a) * d.r * 0.92, Y(d.y) + Math.sin(a) * d.r * 0.92); c.stroke();
    }
    // vidalar
    for (const s of [[p.x + 6, p.y + 6], [p.x + p.w - 6, p.y + 6], [p.x + 6, p.y + p.h - 6], [p.x + p.w - 6, p.y + p.h - 6]]) {
      c.beginPath(); c.arc(X(s[0]), Y(s[1]), 2, 0, TAU); c.fillStyle = '#9aa0a7'; c.fill();
    }
  }
  function drawFries(ctx, x, y, w, h, cook, seed) {
    const R = rng(seed), col = rampAt(R_FRY, cook), dark = shade(col, -0.4), light = shade(col, 0.35);
    for (let i = 0; i < 14; i++) {
      const fx = x + 6 + R() * (w - 12), fy = y + h * 0.42 + R() * h * 0.42;
      const len = h * (0.7 + R() * 0.45), ang = (R() - 0.5) * 1.1, fw = 5 + R() * 1.6;
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(ang);
      rr(ctx, -fw / 2, -len / 2, fw, len, 2);
      ctx.fillStyle = css(shade(col, (R() - 0.5) * 0.14)); ctx.fill();
      ctx.strokeStyle = css(dark, 0.75); ctx.lineWidth = 0.8; ctx.stroke();
      ctx.fillStyle = css(light, 0.55); ctx.fillRect(-fw / 2 + 1, -len / 2 + 2, 1.2, len - 4);
      ctx.restore();
    }
  }
  function drawBasket(ctx, G, i, B, oc, t) {
    const g = G.baskets[i], e = easeIO(B.downT), by = basketY(g, B), bx = g.x, bw = g.w, bh = g.h, rimH = 9;
    const hov = hoverAt(basketHit(g, B));
    if (e < 0.92) { ctx.fillStyle = 'rgba(0,0,0,' + (0.3 * (1 - e)) + ')'; ctx.beginPath(); ctx.ellipse(g.cx, G.oilY + 12, bw * 0.46, 6, 0, 0, TAU); ctx.fill(); }
    // iç
    rr(ctx, bx, by, bw, bh, 4); ctx.fillStyle = 'rgba(28,28,30,0.55)'; ctx.fill();
    if (B.c) drawFries(ctx, bx + 3, by - 4, bw - 6, bh + 2, num(B.c.cook, 0), B.seed);
    // ön tel örgü
    ctx.save(); rr(ctx, bx, by + rimH * 0.6, bw, bh - rimH * 0.6, 4); ctx.clip();
    ctx.strokeStyle = 'rgba(214,219,224,0.6)'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let x = bx - bh; x < bx + bw + bh; x += 6) { ctx.moveTo(x, by); ctx.lineTo(x + bh, by + bh); ctx.moveTo(x + bh, by); ctx.lineTo(x, by + bh); }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#d6dbe0'; ctx.lineWidth = 2.2; rr(ctx, bx, by, bw, bh, 4); ctx.stroke();
    ctx.strokeStyle = hov ? '#ffe9a0' : '#f1f4f6'; ctx.lineWidth = hov ? 3 : 2.5; rr(ctx, bx - 1, by - 1, bw + 2, rimH, 3); ctx.stroke();
    // yağa batma
    if (e > 0.02) {
      ctx.save(); rr(ctx, G.vat.x + 3, G.vat.y + 3, G.vat.w - 6, G.vat.h - 6, 8); ctx.clip();
      const top = G.oilY;
      ctx.fillStyle = css(oc, 0.86 * smooth(0, 0.6, e));
      ctx.fillRect(bx - 4, top, bw + 8, Math.max(0, by + bh + 4 - top));
      ctx.fillStyle = 'rgba(255,250,220,' + (0.35 * e) + ')'; ctx.fillRect(bx - 4, top, bw + 8, 1.4);
      ctx.restore();
    }
    // sap
    const hy = by + bh;
    ctx.strokeStyle = '#c4c9ce'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(g.cx, hy - 6); ctx.lineTo(g.cx, hy + 16); ctx.stroke();
    rr(ctx, g.cx - 6, hy + 12, 12, 24, 5); ctx.fillStyle = hov ? '#3a2f20' : '#1c1c20'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(g.cx - 3, hy + 15, 1.5, 17);
    if (B.c) drawRing(ctx, bx + bw - 2, by + 4, 9, B.c.cook);
  }
  function drawFritoz(ctx) {
    const G = fryGeo(), R = G.R, F = S.fritoz, t = KS.time || 0, act = phaseActive(), pw = power(), vat = G.vat;
    backplate(ctx, R);
    const b = G.body;
    blit(ctx, cached('fryBody' + F.baskets.length, b.w + 30, b.h + 30, c => drawFryBody(c, 15, 15, G)), b.x - 15, b.y - 15, b.w + 30, b.h + 30);
    const wear = oilWear(), oc = rampAt(R_OIL, wear);
    // yağ
    ctx.save(); rr(ctx, vat.x + 3, vat.y + 3, vat.w - 6, vat.h - 6, 8); ctx.clip();
    const gr = ctx.createLinearGradient(0, G.oilY, 0, vat.y + vat.h);
    gr.addColorStop(0, css(shade(oc, 0.28))); gr.addColorStop(0.35, css(oc)); gr.addColorStop(1, css(shade(oc, -0.5)));
    ctx.fillStyle = gr; ctx.fillRect(vat.x, G.oilY, vat.w, vat.h);
    ctx.fillStyle = 'rgba(255,250,220,0.4)'; ctx.fillRect(vat.x, G.oilY, vat.w, 1.5);
    ctx.globalAlpha = 0.16 + 0.06 * smooth(0.3, 1, F.temp); ctx.fillStyle = '#fff8d0';
    for (let k = 0; k < 4; k++) {
      const yy = G.oilY + 10 + k * 13 + Math.sin(t * 1.3 + k) * 2;
      const xx = vat.x + ((((t * 14 * (k % 2 ? 1 : -1) + k * 53) % vat.w) + vat.w) % vat.w);
      ctx.beginPath(); ctx.ellipse(xx, yy, 22 - k * 3, 1.5, 0, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // sepetler
    F.baskets.forEach((B, i) => drawBasket(ctx, G, i, B, oc, t));
    // kabarcık & damla
    ctx.save(); rr(ctx, vat.x + 3, vat.y + 3, vat.w - 6, vat.h - 6, 8); ctx.clip();
    drawParticles(ctx, 'fry');
    ctx.restore();
    // panel: kadran ibresi
    const d = G.dial, a = -Math.PI * 1.15 + clamp(F.temp, 0, 1) * Math.PI * 1.3 * (6.5 / 8);
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(a) * d.r * 0.78, d.y + Math.sin(a) * d.r * 0.78); ctx.stroke();
    ctx.beginPath(); ctx.arc(d.x, d.y, 3, 0, TAU); ctx.fillStyle = '#2b2e33'; ctx.fill();
    txt(ctx, '°C', d.x, d.y + 10, { size: 8, weight: 800, color: '#59606a', align: 'center' });
    const ready = act && pw && F.temp > 0.85;
    led(ctx, G.panel.x + 50, G.panel.y + 9, 3, ready ? '#34e05a' : '#ff3b30', act && pw, 0);
    // yağ göstergesi
    const gg = G.gauge, oil = oilGet(), life = clamp(oil / TUNE.oilMax, 0, 1), old = oil <= TUNE.oilOld;
    txt(ctx, 'Yağ', gg.x, gg.y - 7, { size: 11, weight: 800, color: '#e8e2d4' });
    txt(ctx, oil + '/' + TUNE.oilMax + (old ? ' eski!' : ''), gg.x + gg.w, gg.y - 7, { size: 10, weight: 800, color: old ? (Math.sin(t * 6) > 0 ? '#ff8a6a' : '#ffd08a') : '#c9c3b6', align: 'right' });
    rr(ctx, gg.x, gg.y, gg.w, gg.h, 3.5); ctx.fillStyle = '#121316'; ctx.fill();
    if (life > 0) { rr(ctx, gg.x + 1, gg.y + 1, Math.max(5, (gg.w - 2) * life), gg.h - 2, 3); ctx.fillStyle = css(oc); ctx.fill(); }
    // buton
    const bt = G.btn, hov = hoverAt(bt), stock = invGet('yag');
    ctx.save();
    rr(ctx, bt.x, bt.y, bt.w, bt.h, 8);
    const bg = ctx.createLinearGradient(0, bt.y, 0, bt.y + bt.h);
    if (old) { bg.addColorStop(0, hov ? '#ffb15a' : '#ff9a3c'); bg.addColorStop(1, '#c4561d'); }
    else { bg.addColorStop(0, hov ? '#8d96a1' : '#737c87'); bg.addColorStop(1, '#4c535c'); }
    ctx.fillStyle = bg; ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; rr(ctx, bt.x + 0.5, bt.y + 0.5, bt.w - 1, bt.h - 1, 8); ctx.stroke();
    ctx.restore();
    // damla ikonu
    const dx = bt.x + 12, dyy = bt.y + bt.h / 2;
    ctx.beginPath(); ctx.moveTo(dx, dyy - 7); ctx.quadraticCurveTo(dx + 6, dyy, dx + 4, dyy + 3); ctx.arc(dx, dyy + 2.5, 4.2, 0.1, Math.PI - 0.1); ctx.quadraticCurveTo(dx - 6, dyy, dx, dyy - 7);
    ctx.fillStyle = '#ffd34d'; ctx.fill();
    txt(ctx, 'Yağı Değiştir', bt.x + 22, dyy + 0.5, { size: 12, weight: 800, color: '#fff', stroke: 'rgba(0,0,0,0.25)', strokeWidth: 2 });
    txt(ctx, '×' + stock, bt.x + bt.w - 7, dyy + 0.5, { size: 11, weight: 800, color: stock > 0 ? '#fff3c4' : '#ffb0a0', align: 'right' });
    stationLabel(ctx, R, 'Fritöz');
    levelTag(ctx, R, 'fritoz');
    if (!pw && act) noPowerBadge(ctx, R.x + R.w / 2, G.oilY + 8);
  }

  // ===========================================================================
  // 4) SEMAVER (çay ocağı)
  // ===========================================================================
  function semGeo() {
    const R = KS.layout.semaver, lv = clamp(upgLv('semaver'), 0, 2);
    const cx = R.x + 118, B = R.y + 206;
    const top = [R.y + 132, R.y + 114, R.y + 106][lv], bot = lv === 2 ? B - 8 : B - 14;
    const dBase = top + 6, dH = 46, dTop = dBase - dH;
    const spout = lv === 0 ? { x: cx + 96, y: top - 6 } : lv === 1 ? { x: cx + 32, y: top - 2 } : { x: cx + 36, y: top - 2 };
    return {
      R, lv, cx, B, top, bot, spout,
      demlik: { cx, base: dBase, top: dTop, cy: dBase - dH / 2, spoutX: cx - 52, spoutY: dTop + 8 },
      hitDemlik: { x: cx - 58, y: dTop - 14, w: 116, h: dH + 22 },
      tray: { cx: R.x + 124, cy: R.y + 248, rx: 112, ry: 22 },
      hitTray: { x: R.x + 10, y: R.y + 220, w: R.w - 20, h: 58 },
      btn: { x: R.x + 8, y: R.y + 36, w: 70, h: 22 },
      pill: { x: R.x + 140, y: R.y + 8, w: 100, h: 22 },
      thermo: { x: R.x + 224, y: R.y + 64, w: 12, h: 126 },
      emre: { x: R.x + 30, y: R.y + 202 },
    };
  }
  const brewTime = () => Math.max(1, uv('semaver', 'brewTime', 25));
  function teaQuality() {
    const T = S.semaver;
    if (T.age <= TUNE.teaStale) return 1;
    return Math.max(TUNE.teaMinQ, 1 - (T.age - TUNE.teaStale) / TUNE.teaStaleSpan * (1 - TUNE.teaMinQ));
  }
  function semPowered() { return upgLv('semaver') < 2 || power(); }
  function brew(byCirak) {
    const T = S.semaver;
    if (T.state !== 'empty') return false;
    if (!invTake('cay_yapragi')) {
      if (!byCirak) { note('Çay yaprağı kalmadı! Toptancıdan sipariş et.', 'warn'); snd('error'); }
      return false;
    }
    T.state = 'brewing'; T.brewT = 0; T.glasses = 0; T.age = 0; T.staleWarned = false; T.emptyWarned = false;
    snd('pour');
    return true;
  }
  function rebrew() {
    const T = S.semaver;
    if (T.state === 'brewing') return false;
    if (invGet('cay_yapragi') <= 0) { note('Çay yaprağı kalmadı! Toptancıdan sipariş et.', 'warn'); snd('error'); return false; }
    T.glasses = 0; T.state = 'empty';
    return brew(false);
  }
  function takeTea() {
    const T = S.semaver;
    if (T.state !== 'ready' || T.glasses <= 0) return null;
    const q = teaQuality();
    T.glasses--; T.lastAge = T.age;
    if (T.glasses <= 0) {
      T.state = 'empty';
      if (!T.emptyWarned && !hasStaff('cirak')) {
        T.emptyWarned = true;
        note(invGet('cay_yapragi') > 0 ? 'Demlik boşaldı — yeniden demle!' : 'Demlik boşaldı ve çay yaprağı kalmadı!', invGet('cay_yapragi') > 0 ? 'info' : 'warn');
      }
    }
    snd('pour');
    return KS.items.dish('bardak', { layers: [{ id: 'cay', q }] });
  }
  const semaverZone = {
    id: 'semaver', z: 5,
    getRect: () => KS.layout.semaver,
    canDrop() { return false; },
    noHighlight: true,
    onReturn() {
      const T = S.semaver;
      if (T.state === 'ready') T.glasses++;
      else if (T.state === 'empty') { T.state = 'ready'; T.glasses = 1; T.age = T.lastAge; T.emptyWarned = false; }
      else T.spare++;
    },
    onPick(pt) {
      const G = semGeo(), T = S.semaver;
      if (T.state === 'ready' && T.age >= TUNE.teaStale && inR(pt, G.btn)) return null;
      if (inR(pt, G.hitTray) || inR(pt, G.hitDemlik)) return takeTea();
      return null;
    },
    onClick(pt) {
      const G = semGeo(), T = S.semaver;
      if (T.state === 'ready' && T.age >= TUNE.teaStale && inR(pt, G.btn)) { rebrew(); return; }
      if (inR(pt, G.hitDemlik) || inR(pt, G.hitTray)) {
        if (T.state === 'empty') brew(false);
        else snd('click');
      }
    },
    tooltip(pt) {
      const G = semGeo(), T = S.semaver;
      const stock = invGet('cay_yapragi');
      if (T.state === 'ready' && T.age >= TUNE.teaStale && inR(pt, G.btn)) return 'Demliği tazele\nKalan çay dökülür, 1 çay yaprağı harcanır (stok: ' + stock + ')';
      let head;
      if (!semPowered()) head = '⚡ Elektrik yok — çay kazanı ısınmıyor!';
      else if (T.water < 1) head = 'Su ısınıyor… %' + Math.round(T.water * 100);
      else head = 'Su kaynıyor';
      if (T.state === 'empty') return 'Demlik boş — ' + head + '\nTıkla: demle (1 çay yaprağı, stok: ' + stock + ')';
      if (T.state === 'brewing') {
        const left = Math.max(0, brewTime() - T.brewT);
        return 'Çay demleniyor… %' + Math.round(T.brewT / brewTime() * 100) + '\n' + (T.water < 0.9 ? head + ' (demleme bekliyor)' : 'Kalan ~' + Math.ceil(left) + ' sn');
      }
      const q = teaQuality();
      return 'Çay hazır — ' + T.glasses + ' bardak (' + (q >= 0.99 ? 'tavşan kanı' : q > 0.75 ? 'demi geçiyor' : 'demi geçmiş, koyu') + ')\nSürükle/tıkla: bardak doldur' + (q < 0.99 ? '\nTazelemek için "Tazele"ye bas' : '');
    },
  };

  function updateSemaver(dt, rdt, run) {
    const T = S.semaver, powered = semPowered(), G = semGeo();
    if (run) T.water = powered ? Math.min(1, T.water + dt / TUNE.boilTime) : Math.max(0, T.water - dt / TUNE.boilCool);
    if (T.state === 'brewing' && run && T.water >= 0.9) {
      T.brewT += dt;
      if (T.brewT >= brewTime()) {
        T.state = 'ready'; T.glasses = Math.max(1, Math.round(uv('semaver', 'glasses', 10))) + T.spare; T.spare = 0;
        T.age = 0; T.staleWarned = false;
        snd('ready');
        floatTxt(G.demlik.cx, G.demlik.top - 18, 'Çay hazır!', '#ffd08a', 20);
      }
    }
    if (T.state === 'ready') {
      if (run) T.age += dt;
      if (T.glasses <= 0) T.state = 'empty';
      if (!T.staleWarned && T.age >= TUNE.teaStale) {
        T.staleWarned = true;
        if (!hasStaff('cirak')) note('Çayın demi geçti, koyulaşıyor. Demliği tazele!', 'warn');
      }
    }
    // Çırak Emre: boş ya da demi geçmiş demliği kendisi tazeler
    if (T.cirakBusy > 0) T.cirakBusy = Math.max(0, T.cirakBusy - rdt);
    if (hasStaff('cirak') && run && (T.state === 'empty' || (T.state === 'ready' && T.age >= TUNE.teaStale)) && invGet('cay_yapragi') > 0) {
      T.cirakT += dt;
      if (T.cirakT >= TUNE.cirakDelay) {
        T.cirakT = 0;
        if (T.state === 'ready') { T.glasses = 0; T.state = 'empty'; }
        if (brew(true)) T.cirakBusy = 3.5;
      }
    } else T.cirakT = 0;
    if (run) {
      const sr = T.water * T.water * 5;
      if (Math.random() < dt * sr) puff('steam', G.spout.x, G.spout.y, { a: 0.32, size: 0.9, vx: 6 });
      if ((T.state === 'brewing' || T.state === 'ready') && Math.random() < dt * 1.3) puff('steam', G.demlik.spoutX, G.demlik.spoutY - 2, { a: 0.2, size: 0.55, vx: -4 });
    }
    loop('semaver', run && powered && T.water > 0.6, 'boil');
  }

  // --- semaver çizimleri ---
  function drawBurnerStatic(c, G) {
    const cx = G.cx, B = G.B;
    if (G.lv === 2) {
      // elektrikli taban
      rr(c, cx - 68, B - 10, 136, 22, 7);
      const gr = c.createLinearGradient(0, B - 10, 0, B + 12); gr.addColorStop(0, '#4a5058'); gr.addColorStop(1, '#22262b');
      c.fillStyle = gr; c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 1; c.stroke();
      rr(c, cx - 22, B - 6, 44, 13, 3); c.fillStyle = '#0b1410'; c.fill();
      return;
    }
    // ocak gövdesi
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(cx, B + 18, 62, 7, 0, 0, TAU); c.fill();
    rr(c, cx - 40, B + 1, 80, 16, 6);
    let gr = c.createLinearGradient(0, B, 0, B + 17); gr.addColorStop(0, '#3d4249'); gr.addColorStop(1, '#1b1d21');
    c.fillStyle = gr; c.fill();
    c.beginPath(); c.arc(cx + 30, B + 9, 4.5, 0, TAU); c.fillStyle = '#c7ccd2'; c.fill();
    c.fillStyle = '#2a2d31'; c.fillRect(cx + 29, B + 5, 2, 8);
    // brülör
    c.beginPath(); c.ellipse(cx, B, 36, 7, 0, 0, TAU); c.fillStyle = '#2a2c30'; c.fill();
    c.beginPath(); c.ellipse(cx, B - 1, 28, 5, 0, 0, TAU); c.fillStyle = '#4a4e54'; c.fill();
    // sacayak
    c.strokeStyle = '#1a1b1e'; c.lineWidth = 4;
    c.beginPath(); c.ellipse(cx, B - 13, 54, 9, 0, 0, TAU); c.stroke();
    c.lineWidth = 3;
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(cx + s * 52, B - 12); c.lineTo(cx + s * 44, B + 6); c.stroke(); }
  }
  function kettleShape(c, G) {
    const cx = G.cx, top = G.top, bot = G.bot;
    c.beginPath();
    if (G.lv === 0) {
      c.moveTo(cx - 44, top);
      c.bezierCurveTo(cx - 72, top + 8, cx - 72, bot - 24, cx - 60, bot - 3);
      c.quadraticCurveTo(cx, bot + 6, cx + 60, bot - 3);
      c.bezierCurveTo(cx + 72, bot - 24, cx + 72, top + 8, cx + 44, top);
    } else if (G.lv === 1) {
      c.moveTo(cx - 34, top);
      c.bezierCurveTo(cx - 62, top + 18, cx - 66, bot - 40, cx - 40, bot - 16);
      c.lineTo(cx - 44, bot); c.lineTo(cx + 44, bot); c.lineTo(cx + 40, bot - 16);
      c.bezierCurveTo(cx + 66, bot - 40, cx + 62, top + 18, cx + 34, top);
    } else {
      rr(c, cx - 60, top, 120, bot - top, 14); return;
    }
    c.closePath();
  }
  function drawKettleStatic(c, G) {
    const cx = G.cx, top = G.top, bot = G.bot;
    // emzik (çaydanlık) / kulplar
    if (G.lv === 0) {
      c.beginPath(); c.moveTo(cx + 54, bot - 30); c.quadraticCurveTo(cx + 82, bot - 30, cx + 92, top - 8);
      c.lineTo(cx + 100, top - 5); c.quadraticCurveTo(cx + 88, bot - 12, cx + 58, bot - 14); c.closePath();
      c.fillStyle = steelGrad(c, cx + 50, top, cx + 100, bot); c.fill();
      c.strokeStyle = 'rgba(30,34,40,0.6)'; c.lineWidth = 1; c.stroke();
      c.strokeStyle = '#26272b'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx - 58, top + 10); c.bezierCurveTo(cx - 92, top + 12, cx - 92, bot - 26, cx - 64, bot - 24); c.stroke();
    } else if (G.lv === 1) {
      c.strokeStyle = '#c99a35'; c.lineWidth = 5; c.lineCap = 'round';
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(cx + s * 50, top + 22); c.quadraticCurveTo(cx + s * 74, top + 30, cx + s * 58, top + 46); c.stroke(); }
    }
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 10; c.shadowOffsetY = 4;
    kettleShape(c, G); c.fillStyle = '#8c949c'; c.fill();
    c.restore();
    kettleShape(c, G);
    const gr = c.createLinearGradient(cx - 70, 0, cx + 70, 0);
    gr.addColorStop(0, '#5a6168'); gr.addColorStop(0.18, '#c8cfd5'); gr.addColorStop(0.3, '#f7f9fb'); gr.addColorStop(0.42, '#b9c0c7');
    gr.addColorStop(0.72, '#7f878f'); gr.addColorStop(0.9, '#a6adb4'); gr.addColorStop(1, '#4e555c');
    c.fillStyle = gr; c.fill();
    c.strokeStyle = 'rgba(30,34,40,0.6)'; c.lineWidth = 1.2; c.stroke();
    // yansıma bandı
    c.save(); kettleShape(c, G); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(cx - 40, top, 6, bot - top);
    c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(cx - 30, top, 3, bot - top);
    if (G.lv === 1) {
      c.fillStyle = 'rgba(215,165,60,0.85)'; c.fillRect(cx - 80, top + 8, 160, 4); c.fillRect(cx - 80, bot - 20, 160, 4);
      c.fillStyle = 'rgba(255,240,190,0.6)'; c.fillRect(cx - 80, top + 8, 160, 1.2); c.fillRect(cx - 80, bot - 20, 160, 1.2);
    }
    if (G.lv === 2) { brushed(c, cx - 60, top, 120, bot - top, 0.08, true); }
    c.restore();
    // üst ağız
    c.beginPath(); c.ellipse(cx, top + 2, G.lv === 2 ? 50 : 40, 7, 0, 0, TAU);
    c.fillStyle = '#2b2f34'; c.fill(); c.strokeStyle = '#d7dce1'; c.lineWidth = 2; c.stroke();
    // musluk (semaver / kazan)
    if (G.lv >= 1) {
      const ty = bot - 34;
      c.fillStyle = G.lv === 1 ? '#d9a640' : '#2a2c30';
      rr(c, cx - 5, ty - 5, 10, 22, 3); c.fill();
      rr(c, cx - 3, ty + 14, 6, 9, 2); c.fill();
      c.beginPath(); c.arc(cx, ty - 8, 5, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(cx - 3, ty - 3, 1.5, 16);
    }
    if (G.lv === 2) {
      // su seviye camı
      rr(c, cx + 40, top + 18, 8, bot - top - 40, 4); c.fillStyle = 'rgba(20,30,40,0.6)'; c.fill();
      c.strokeStyle = '#d7dce1'; c.lineWidth = 1.2; c.stroke();
    }
  }
  function drawDemlik(c, cx, base) {
    const h = 46, top = base - h;
    // emzik
    c.beginPath(); c.moveTo(cx - 24, base - 14); c.quadraticCurveTo(cx - 44, base - 16, cx - 54, top + 7);
    c.lineTo(cx - 47, top + 5); c.quadraticCurveTo(cx - 40, base - 26, cx - 22, base - 28); c.closePath();
    c.fillStyle = '#efe7d9'; c.fill(); c.strokeStyle = 'rgba(110,90,60,0.55)'; c.lineWidth = 1; c.stroke();
    // kulp
    c.lineCap = 'round';
    c.strokeStyle = '#a8946e'; c.lineWidth = 7;
    c.beginPath(); c.moveTo(cx + 26, top + 14); c.bezierCurveTo(cx + 52, top + 10, cx + 52, base - 10, cx + 26, base - 9); c.stroke();
    c.strokeStyle = '#f2ebde'; c.lineWidth = 4.5; c.stroke();
    // gövde
    const body = () => {
      c.beginPath(); c.moveTo(cx - 22, top + 8);
      c.bezierCurveTo(cx - 40, top + 14, cx - 40, base - 4, cx - 22, base);
      c.lineTo(cx + 22, base);
      c.bezierCurveTo(cx + 40, base - 4, cx + 40, top + 14, cx + 22, top + 8); c.closePath();
    };
    c.save(); c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 6; c.shadowOffsetY = 3; body(); c.fillStyle = '#e8e0d2'; c.fill(); c.restore();
    body();
    const gr = c.createLinearGradient(cx - 38, 0, cx + 38, 0);
    gr.addColorStop(0, '#c9bfae'); gr.addColorStop(0.32, '#fffdf8'); gr.addColorStop(0.62, '#f0e9dd'); gr.addColorStop(1, '#b3a893');
    c.fillStyle = gr; c.fill(); c.strokeStyle = 'rgba(120,100,70,0.5)'; c.lineWidth = 1; c.stroke();
    c.save(); body(); c.clip();
    c.strokeStyle = '#d2a23a'; c.lineWidth = 2;
    c.beginPath(); c.ellipse(cx, base - 4, 36, 4, 0, 0, Math.PI); c.stroke();
    c.beginPath(); c.ellipse(cx, top + 12, 30, 4, 0, 0, Math.PI); c.stroke();
    c.restore();
    // lale motifi
    const ly = base - 22;
    c.strokeStyle = '#3f8f3a'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(cx, ly + 4); c.quadraticCurveTo(cx - 1, ly + 10, cx, ly + 14); c.stroke();
    c.beginPath(); c.moveTo(cx, ly + 10); c.quadraticCurveTo(cx - 7, ly + 8, cx - 8, ly + 4); c.stroke();
    c.fillStyle = '#c62f2f';
    c.beginPath(); c.moveTo(cx - 6, ly - 4); c.quadraticCurveTo(cx - 7, ly + 5, cx, ly + 5); c.quadraticCurveTo(cx + 7, ly + 5, cx + 6, ly - 4);
    c.lineTo(cx + 3, ly - 1); c.lineTo(cx, ly - 6); c.lineTo(cx - 3, ly - 1); c.closePath(); c.fill();
    // kapak
    c.beginPath(); c.ellipse(cx, top + 8, 22, 5, 0, 0, TAU); c.fillStyle = '#efe7da'; c.fill(); c.strokeStyle = '#d2a23a'; c.lineWidth = 1.5; c.stroke();
    c.beginPath(); c.moveTo(cx - 16, top + 7); c.quadraticCurveTo(cx, top - 6, cx + 16, top + 7); c.closePath(); c.fillStyle = '#f7f1e6'; c.fill(); c.strokeStyle = 'rgba(120,100,70,0.45)'; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.arc(cx, top - 2, 4, 0, TAU); c.fillStyle = '#d9a640'; c.fill();
    c.beginPath(); c.arc(cx - 1.2, top - 3.2, 1.3, 0, TAU); c.fillStyle = '#fff3c8'; c.fill();
  }
  function drawTray(c, T) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 8; c.shadowOffsetY = 4;
    c.beginPath(); c.ellipse(T.cx, T.cy, T.rx, T.ry, 0, 0, TAU); c.fillStyle = '#9b6f23'; c.fill(); c.restore();
    c.beginPath(); c.ellipse(T.cx, T.cy, T.rx, T.ry, 0, 0, TAU);
    let gr = c.createLinearGradient(T.cx - T.rx, 0, T.cx + T.rx, 0);
    gr.addColorStop(0, '#a87a28'); gr.addColorStop(0.3, '#f4d27a'); gr.addColorStop(0.55, '#d8a640'); gr.addColorStop(1, '#8e6420');
    c.fillStyle = gr; c.fill();
    c.beginPath(); c.ellipse(T.cx, T.cy + 1, T.rx - 8, T.ry - 5, 0, 0, TAU);
    gr = c.createLinearGradient(0, T.cy - T.ry, 0, T.cy + T.ry); gr.addColorStop(0, '#c18f34'); gr.addColorStop(1, '#e6bc5c');
    c.fillStyle = gr; c.fill();
    c.strokeStyle = 'rgba(110,70,15,0.55)'; c.lineWidth = 1; c.stroke();
    c.strokeStyle = 'rgba(255,240,190,0.45)'; c.lineWidth = 1;
    c.beginPath(); c.ellipse(T.cx, T.cy + 1, T.rx - 22, T.ry - 10, 0, 0, TAU); c.stroke();
    c.beginPath(); c.ellipse(T.cx, T.cy, T.rx - 1, T.ry - 1, 0, Math.PI * 1.05, Math.PI * 1.9); c.strokeStyle = 'rgba(255,248,215,0.8)'; c.lineWidth = 1.5; c.stroke();
  }
  function teaGlass(ctx, x, yb, s, teaCol, full) {
    ctx.beginPath(); ctx.ellipse(x, yb + 1, 13 * s, 4 * s, 0, 0, TAU); ctx.fillStyle = '#f6f1e8'; ctx.fill();
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.6; ctx.stroke();
    const h = 30 * s;
    const path = () => {
      ctx.beginPath(); ctx.moveTo(x - 6 * s, yb);
      ctx.bezierCurveTo(x - 9.5 * s, yb - h * 0.12, x - 9.5 * s, yb - h * 0.36, x - 5 * s, yb - h * 0.52);
      ctx.bezierCurveTo(x - 3.5 * s, yb - h * 0.65, x - 9 * s, yb - h * 0.9, x - 9.5 * s, yb - h);
      ctx.lineTo(x + 9.5 * s, yb - h);
      ctx.bezierCurveTo(x + 9 * s, yb - h * 0.9, x + 3.5 * s, yb - h * 0.65, x + 5 * s, yb - h * 0.52);
      ctx.bezierCurveTo(x + 9.5 * s, yb - h * 0.36, x + 9.5 * s, yb - h * 0.12, x + 6 * s, yb);
      ctx.closePath();
    };
    if (full) {
      ctx.save(); path(); ctx.clip();
      ctx.fillStyle = css(teaCol, 0.95); ctx.fillRect(x - 12 * s, yb - h * 0.86, 24 * s, h);
      ctx.fillStyle = css(shade(teaCol, -0.35), 0.7); ctx.fillRect(x - 12 * s, yb - h * 0.3, 24 * s, h * 0.3);
      ctx.fillStyle = css(shade(teaCol, 0.35), 0.85); ctx.fillRect(x - 12 * s, yb - h * 0.86, 24 * s, 1.6);
      ctx.restore();
    }
    path(); ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - 6 * s, yb - h * 0.16); ctx.quadraticCurveTo(x - 7.5 * s, yb - h * 0.3, x - 4.5 * s, yb - h * 0.44); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 7.5 * s, yb - h * 0.94); ctx.lineTo(x - 6 * s, yb - h * 0.72); ctx.stroke();
  }
  function drawEmre(ctx, x, yb, t, busy, msg) {
    const bob = busy > 0 ? Math.abs(Math.sin(t * 9)) * -2 : Math.sin(t * 2) * 0.6;
    ctx.save(); ctx.translate(x, yb + bob);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0, 2, 18, 4, 0, 0, TAU); ctx.fill();
    // gövde: beyaz gömlek + siyah yelek
    rr(ctx, -16, -38, 32, 40, 11); ctx.fillStyle = '#f5f4ef'; ctx.fill();
    ctx.fillStyle = '#2d2a3a';
    ctx.beginPath(); ctx.moveTo(-16, -30); ctx.lineTo(-4, -36); ctx.lineTo(-2, 2); ctx.lineTo(-16, 2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(16, -30); ctx.lineTo(4, -36); ctx.lineTo(2, 2); ctx.lineTo(16, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b8322a'; ctx.beginPath(); ctx.moveTo(-4, -37); ctx.lineTo(0, -33); ctx.lineTo(4, -37); ctx.lineTo(0, -40); ctx.closePath(); ctx.fill();
    // kol + bardak
    const armUp = busy > 0 ? -6 : 0;
    ctx.strokeStyle = '#f5f4ef'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(13, -30); ctx.lineTo(20, -18 + armUp); ctx.stroke();
    teaGlass(ctx, 22, -18 + armUp, 0.45, rampAt(R_TEA, 1), true);
    // baş
    ctx.fillStyle = '#efc7a0'; ctx.fillRect(-4, -45, 8, 6);
    ctx.beginPath(); ctx.arc(0, -52, 12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2b1d14';
    ctx.beginPath(); ctx.arc(0, -54, 12.5, Math.PI * 1.02, Math.PI * 1.98); ctx.quadraticCurveTo(4, -60, -12, -52); ctx.fill();
    ctx.beginPath(); ctx.arc(-11, -51, 2.5, 0, TAU); ctx.arc(11, -51, 2.5, 0, TAU); ctx.fillStyle = '#e3b48c'; ctx.fill();
    ctx.fillStyle = '#2b1d14';
    ctx.beginPath(); ctx.arc(-4, -51, 1.4, 0, TAU); ctx.arc(4, -51, 1.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8a4a32'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(0, -47, 3.5, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.fillStyle = 'rgba(230,120,110,0.35)';
    ctx.beginPath(); ctx.arc(-7, -47, 2.4, 0, TAU); ctx.arc(7, -47, 2.4, 0, TAU); ctx.fill();
    ctx.restore();
    txt(ctx, 'Çırak Emre', x, yb + 11, { size: 10, weight: 800, color: '#fff6e0', align: 'center', stroke: 'rgba(20,16,30,0.6)', strokeWidth: 3 });
    if (msg) {
      ctx.save(); ctx.font = '800 11px "Nunito", system-ui, sans-serif';
      const w = ctx.measureText(msg.text).width + 16, h = 20, bx = x - 14, byy = yb - 92;
      ctx.restore();
      const A = KS.Art;
      if (A && A.drawBubble) A.drawBubble(ctx, bx, byy, w, h, { tail: 'down', tailPos: x, radius: 9, color: '#fffdf6' });
      else { rr(ctx, bx, byy, w, h, 9); ctx.fillStyle = '#fffdf6'; ctx.fill(); }
      txt(ctx, msg.text, bx + w / 2, byy + h / 2 + 0.5, { size: 11, weight: 800, color: msg.color || '#3a2c52', align: 'center' });
    }
  }
  function drawSemaver(ctx) {
    const G = semGeo(), R = G.R, T = S.semaver, t = KS.time || 0, act = phaseActive(), powered = semPowered(), sp = sprites();
    backplate(ctx, R);
    const cw = R.w + 40, ch = R.h + 40, ox = R.x - 20, oy = R.y - 20;
    const tr = (fn) => c => { c.translate(-ox, -oy); fn(c); };
    blit(ctx, cached('semBurner' + G.lv, cw, ch, tr(c => drawBurnerStatic(c, G))), ox, oy, cw, ch);
    // alevler (tüplü) / elektrik ekranı
    if (G.lv < 2 && act) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 14; k++) {
        const a = k / 14 * TAU, fl = 0.75 + 0.25 * Math.sin(t * 13 + k * 1.7) + 0.1 * Math.sin(t * 29 + k);
        const fx = G.cx + Math.cos(a) * 27, fy = G.B - 2 + Math.sin(a) * 5, fh = (9 + 4 * fl) * (0.75 + 0.25 * T.water);
        ctx.globalAlpha = 0.85; ctx.drawImage(sp.gas, fx - fh * 0.28, fy - fh, fh * 0.56, fh);
      }
      ctx.globalAlpha = 0.35; ctx.drawImage(sp.glow, G.cx - 50, G.B - 26, 100, 40);
      ctx.restore();
    } else if (G.lv === 2) {
      const on = act && powered;
      txt(ctx, on ? Math.round(20 + 78 * T.water) + '°' : '--', G.cx, G.B + 0.5, { size: 10, weight: 900, color: on ? '#53ff8a' : '#2c4a36', align: 'center', font: 'monospace' });
      led(ctx, G.cx + 46, G.B + 1, 2.6, on ? '#34e05a' : '#ff3b30', act, 0);
    }
    blit(ctx, cached('semKettle' + G.lv, cw, ch, tr(c => { drawKettleStatic(c, G); drawDemlik(c, G.demlik.cx, G.demlik.base); })), ox, oy, cw, ch);
    if (G.lv === 2) {
      const gx = G.cx + 41, gy = G.top + 19, gh = G.bot - G.top - 42, lvl = 0.75;
      ctx.fillStyle = 'rgba(90,170,255,0.55)'; ctx.fillRect(gx, gy + gh * (1 - lvl), 6, gh * lvl);
    }
    // demlik etkileşim parıltısı
    const hovD = hoverAt(G.hitDemlik);
    if (hovD || (T.state === 'empty' && act && T.water >= 0.9)) {
      ctx.save();
      ctx.globalAlpha = hovD ? 0.7 : 0.3 + 0.25 * Math.sin(t * 4);
      ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -t * 20;
      ctx.beginPath(); ctx.ellipse(G.demlik.cx, G.demlik.cy, 46, 32, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    // demleme halkası
    const dc = G.demlik;
    if (T.state === 'brewing') {
      const f = clamp(T.brewT / brewTime(), 0, 1);
      ctx.save(); ctx.lineCap = 'round';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(16,12,20,0.55)'; ctx.beginPath(); ctx.arc(dc.cx, dc.cy, 40, 0, TAU); ctx.stroke();
      ctx.lineWidth = 3.4; ctx.strokeStyle = T.water >= 0.9 ? '#ffb347' : '#8a8f99';
      ctx.beginPath(); ctx.arc(dc.cx, dc.cy, 40, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
      ctx.restore();
      txt(ctx, '%' + Math.round(f * 100), dc.cx + 40, dc.top - 2, { size: 12, weight: 900, color: '#ffe0a8', align: 'center', stroke: 'rgba(20,16,30,0.7)', strokeWidth: 3 });
    } else if (T.state === 'ready' && T.age > TUNE.teaStale * 0.6) {
      const q = teaQuality();
      ctx.save(); ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.strokeStyle = css(rampAt(R_TEA, q), 0.9);
      ctx.beginPath(); ctx.arc(dc.cx, dc.cy, 40, -Math.PI / 2, -Math.PI / 2 + TAU * clamp((q - 0.5) / 0.5, 0.02, 1)); ctx.stroke();
      ctx.restore();
    }
    // tepsi + bardaklar
    blit(ctx, cached('semTray', cw, ch, tr(c => drawTray(c, G.tray))), ox, oy, cw, ch);
    const tc = rampAt(R_TEA, teaQuality());
    const nShow = T.state === 'ready' ? Math.min(T.glasses, 5) : 0;
    const nGlass = Math.max(nShow, T.state === 'ready' ? 0 : 3);
    for (let k = 0; k < nGlass; k++) {
      const gx = G.tray.cx - 18 + (k - (nGlass - 1) / 2) * 31;
      teaGlass(ctx, gx, G.tray.cy + 6, 1, tc, k < nShow);
    }
    if (T.state === 'ready') {
      const bx = G.tray.cx + G.tray.rx - 44, byy = G.tray.cy - 12;
      rr(ctx, bx, byy, 40, 22, 11); ctx.fillStyle = 'rgba(20,14,26,0.82)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,150,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      txt(ctx, '×' + T.glasses, bx + 20, byy + 11.5, { size: 14, weight: 900, color: '#ffe3a0', align: 'center' });
    }
    if (hoverAt(G.hitTray) && T.state === 'ready') {
      ctx.save(); ctx.strokeStyle = 'rgba(255,236,160,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(G.tray.cx, G.tray.cy, G.tray.rx + 3, G.tray.ry + 3, 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
    // termometre
    const th = G.thermo;
    rr(ctx, th.x - 2, th.y - 2, th.w + 4, th.h + 4, 8); ctx.fillStyle = 'rgba(20,16,26,0.6)'; ctx.fill();
    rr(ctx, th.x, th.y, th.w, th.h, 6); ctx.fillStyle = 'rgba(235,240,245,0.85)'; ctx.fill();
    const wc = [lerp(80, 235, T.water), lerp(150, 70, T.water), lerp(255, 40, T.water)];
    const fh = (th.h - 6) * clamp(T.water, 0.04, 1);
    rr(ctx, th.x + 3, th.y + th.h - 3 - fh, th.w - 6, fh, 3); ctx.fillStyle = css(wc); ctx.fill();
    ctx.beginPath(); ctx.arc(th.x + th.w / 2, th.y + th.h + 6, 8, 0, TAU); ctx.fillStyle = css(wc); ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,26,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    for (let k = 1; k < 5; k++) { ctx.fillStyle = 'rgba(40,44,52,0.6)'; ctx.fillRect(th.x + th.w - 4, th.y + k * th.h / 5, 4, 1); }
    txt(ctx, '100°', th.x + th.w / 2, th.y - 9, { size: 9, weight: 800, color: '#fff3dc', align: 'center', stroke: 'rgba(20,16,30,0.6)', strokeWidth: 2.5 });
    // durum etiketi
    let label, col;
    if (!powered && act) { label = 'Elektrik yok'; col = '#ff8a7a'; }
    else if (T.state === 'brewing') { label = T.water < 0.9 ? 'Su bekleniyor' : 'Demleniyor'; col = '#ffc46b'; }
    else if (T.state === 'ready') { const q = teaQuality(); label = q >= 0.99 ? 'Çay hazır' : 'Demi geçti'; col = q >= 0.99 ? '#7dff8a' : '#ffa45c'; }
    else if (act && T.water < 1) { label = 'Su ısınıyor %' + Math.round(T.water * 100); col = '#9fd0ff'; }
    else if (invGet('cay_yapragi') <= 0) { label = 'Çay yaprağı yok!'; col = '#ff8a7a'; }
    else { label = act ? 'Demlik boş' : 'Ocak kapalı'; col = '#ffe08a'; }
    const pl = G.pill;
    rr(ctx, pl.x, pl.y, pl.w, pl.h, 11); ctx.fillStyle = 'rgba(22,16,30,0.86)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(pl.x + 11, pl.y + pl.h / 2, 3.5, 0, TAU); ctx.fillStyle = col; ctx.fill();
    txt(ctx, label, pl.x + 19, pl.y + pl.h / 2 + 0.5, { size: 11, weight: 800, color: col, maxWidth: pl.w - 24 });
    // tazele butonu
    if (T.state === 'ready' && T.age >= TUNE.teaStale) {
      const b = G.btn, hov = hoverAt(b);
      rr(ctx, b.x, b.y, b.w, b.h, 11);
      const bg = ctx.createLinearGradient(0, b.y, 0, b.y + b.h); bg.addColorStop(0, hov ? '#ffb15a' : '#ff9a3c'); bg.addColorStop(1, '#c4561d');
      ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
      txt(ctx, '↻ Tazele', b.x + b.w / 2, b.y + b.h / 2 + 0.5, { size: 12, weight: 900, color: '#fff', align: 'center' });
    }
    // çırak
    if (hasStaff('cirak')) {
      let msg = null;
      if (T.cirakBusy > 0) msg = { text: 'Demliyorum!' };
      else if (T.cirakT > 0) msg = { text: 'Hemen tazeliyorum…' };
      else if (T.state === 'empty' && act && invGet('cay_yapragi') <= 0) msg = { text: 'Çay bitti abi!', color: '#c0392b' };
      drawEmre(ctx, G.emre.x, G.emre.y, t, T.cirakBusy, msg);
    }
    stationLabel(ctx, R, 'Çay Ocağı');
    levelTag(ctx, R, 'semaver');
  }

  // ===========================================================================
  // MODÜL
  // ===========================================================================
  function update(dt, rdt) {
    dt = num(dt, 0); rdt = clamp(num(rdt, 0.016), 0, 0.1);
    const run = running();
    const steps = [['tost', updateTost], ['izgara', updateIzgara], ['fritoz', updateFritoz], ['semaver', updateSemaver]];
    for (const [k, fn] of steps) { try { fn(dt, rdt, run); } catch (e) { warnOnce('update:' + k, e); } }
    try { updateParticles(KS.state && KS.state.paused ? 0 : rdt); } catch (e) { warnOnce('particles', e); }
    if (!run) loopsOff();
  }
  function draw(ctx, layer) {
    if (layer === 'stations') {
      const steps = [['tost', drawTost], ['izgara', drawIzgara], ['fritoz', drawFritoz], ['semaver', drawSemaver]];
      for (const [k, fn] of steps) {
        ctx.save();
        try { fn(ctx); } catch (e) { warnOnce('draw:' + k, e); }
        ctx.restore();
      }
    } else if (layer === 'fx') {
      try { drawParticles(ctx, 'fx'); } catch (e) { warnOnce('fx', e); }
    }
  }
  function info() {
    const T = S.semaver;
    return {
      tost: S.tost.machines.map(M => ({ closed: M.closed, slots: M.slots.map(s => s.dish ? num(s.dish.toast, 0) : null) })),
      izgara: S.izgara.slots.map(s => s.item ? { cookA: num(s.item.cookA, 0), cookB: num(s.item.cookB, 0) } : null),
      fritoz: { temp: S.fritoz.temp, oilLife: oilGet(), baskets: S.fritoz.baskets.map(B => ({ down: B.down, cook: B.c ? num(B.c.cook, 0) : null })) },
      semaver: { water: T.water, state: T.state, brew: T.state === 'brewing' ? T.brewT / brewTime() : (T.state === 'ready' ? 1 : 0), glasses: T.glasses, age: T.age, quality: teaQuality() },
    };
  }
  function init() {
    syncSlots(true);
    for (const z of [tostZone, izgaraZone, fritozZone, semaverZone]) { KS.removeZone && KS.removeZone(z.id); KS.addZone(z); }
    const on = (ev, fn) => { try { KS.bus.on(ev, fn); } catch (e) { /* yok */ } };
    on('newGame', () => resetAll(true));
    // Kayıt yüklenince yağ ömrü KS.state'ten okunur (sıfırlanmaz); eski kayıtta alan yoksa 30 yazılır.
    on('stateLoaded', () => { resetAll(false); oilSet(oilGet()); S.fritoz.oldWarned = oilGet() <= TUNE.oilOld; });
    on('prepStart', () => resetAll(false));
    on('dayEnd', () => { addWasted(emptyAll()); resetSemaver(); loopsOff(); });
    on('upgradeBought', () => { addWasted(syncSlots(false)); });
    on('pause', p => { if (p) loopsOff(); });
  }

  KS.Stations = KS.Stations || {};
  KS.Stations.cook = {
    state: S, tune: TUNE, info,
    reset: () => resetAll(false), sync: () => syncSlots(false),
    toggleLid, flipPatty, toggleBasket, changeOil, brewTea: () => brew(false), rebrewTea: rebrew,
    teaQuality, oilLife: () => oilGet(),
    zones: { tost: tostZone, izgara: izgaraZone, fritoz: fritozZone, semaver: semaverZone },
  };
  KS.registerModule({ name: 'cook', order: 20, init, update, draw });
})(window.KS);
