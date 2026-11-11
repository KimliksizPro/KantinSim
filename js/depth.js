/* KantinSim — derinlik katmanı (2D ama 3D hissi)
 * Art.drawLighting'in üstüne eklenen, hepsi ucuz (önbellekli sprite / birkaç çokgen) efektler:
 *   back      : pencerelerden koridora düşen hacimli güneş huzmeleri
 *   customers : tezgahın arkasında temas gölgesi (müşteri tezgahın ARKASINDA dursun)
 *   counter   : mermer tezgah üstünde müşteri yansıması + temas gölgesi
 *   fx        : fareyi izleyen yüzey parlaması, kameraya yakın bokeh zerreleri (ön plan parallax'ı)
 * "Işık & derinlik efektleri" ayarı kapalıysa (Art.fxActive) hiçbiri çizilmez.
 */
(function (KS) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU = Math.PI * 2;
  const h01 = (i, salt) => { const x = Math.sin((i + 1) * 12.9898 + (salt || 0) * 78.233) * 43758.5453; return x - Math.floor(x); };

  function active() {
    const A = KS.Art, ph = KS.state && KS.state.phase;
    if (!A || (A.fxActive && !A.fxActive())) return false;
    return ph === 'prep' || ph === 'open' || ph === 'closing';
  }
  function rgba(hex, a) {
    const n = parseInt(String(hex).slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }
  function sky() {
    const A = KS.Art, s = KS.state;
    if (!A || !A._h || !A._h.skyAt) return null;
    return A._h.skyAt(s.time, s.today ? s.today.weather : 'gunesli');
  }

  // yumuşak ışık lekesi (bir kez üretilir)
  const _soft = {};
  function softSprite(col) {
    if (_soft[col]) return _soft[col];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.4, rgba(col, 0.42)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return (_soft[col] = c);
  }

  // ---------------------------------------------------------------------------
  // GÜNEŞ HUZMELERİ: pencereden zemindeki ışık lekesine uzanan yarı saydam hacim
  // ---------------------------------------------------------------------------
  function drawRays(ctx, t) {
    const A = KS.Art, H = A._h, S = sky();
    if (!S || S.sunA < 0.15 || !H.WINS || !H.OPEN) return;
    const O = H.OPEN, PX = A.parallax || { x: 0, y: 0 };
    const FLOOR = 352;
    ctx.save();
    ctx.beginPath(); ctx.rect(O.x, O.y, O.w, O.h); ctx.clip();
    ctx.translate(PX.x, PX.y);
    ctx.globalCompositeOperation = 'lighter';
    const beam = (x0, x1, y0, dx, spread, a) => {
      const g = ctx.createLinearGradient(0, y0, 0, FLOOR);
      g.addColorStop(0, rgba(S.sunCol, a)); g.addColorStop(0.55, rgba(S.sunCol, a * 0.55)); g.addColorStop(1, rgba(S.sunCol, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
      ctx.lineTo(x1 + dx + spread, FLOOR); ctx.lineTo(x0 + dx - spread, FLOOR);
      ctx.closePath(); ctx.fill();
    };
    for (let wi = 0; wi < H.WINS.length; wi++) {
      const w = H.WINS[wi];
      const dx = clamp((w.x + w.w / 2 - S.sunX) * 0.35, -140, 140);
      const breathe = 0.85 + 0.15 * Math.sin(t * 0.4 + wi * 1.7);
      beam(w.x + 4, w.x + w.w - 4, w.y + 6, dx, 26, 0.085 * S.sunA * breathe);
      // huzmenin içindeki ince, yavaşça kayan şeritler
      for (let i = 0; i < 4; i++) {
        const u = clamp(h01(i, wi + 3) * 0.8 + 0.1 + Math.sin(t * (0.11 + i * 0.03) + i * 2.3 + wi) * 0.07, 0.03, 0.97);
        const bw = w.w * (0.05 + h01(i, wi + 9) * 0.07);
        const x0 = w.x + w.w * u - bw / 2;
        beam(x0, x0 + bw, w.y + 6, dx, 5, (0.05 + 0.04 * h01(i, 5)) * S.sunA * (0.7 + 0.3 * Math.sin(t * 0.6 + i * 1.9)));
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // TEZGAH ARKASI TEMAS GÖLGESİ (müşteri katmanının üstüne, tezgahın altına)
  // ---------------------------------------------------------------------------
  function drawCounterOcclusion(ctx) {
    const g = ctx.createLinearGradient(0, 318, 0, 354);
    g.addColorStop(0, 'rgba(24,12,6,0)'); g.addColorStop(0.7, 'rgba(24,12,6,0.16)'); g.addColorStop(1, 'rgba(24,12,6,0.34)');
    ctx.fillStyle = g; ctx.fillRect(310, 318, 1190, 36);
  }

  // ---------------------------------------------------------------------------
  // MERMER TEZGAH: müşteri yansıması + gövdenin tezgaha düşen gölgesi
  // ---------------------------------------------------------------------------
  const TOP_Y = 352, TOP_H = 17;
  function drawCounterReflection(ctx) {
    const C = KS.Customers;
    if (!C || !C.drawSlotFigures || !C.slotCustomer) return;
    const PX = (KS.Art && KS.Art.parallax) || { cx: 0, cy: 0 };
    let any = false;
    for (let i = 0; i < 4; i++) if (C.slotCustomer(i)) { any = true; break; }
    if (!any) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(326, TOP_Y + 1, 1150, TOP_H - 1); ctx.clip();
    // gölge (ışık sol üstten: gölge hafif sağa düşer)
    for (let i = 0; i < 4; i++) {
      const c = C.slotCustomer(i); if (!c) continue;
      const sc = c.scale || 1, a = clamp((sc - 0.6) / 0.4, 0, 1);
      if (a <= 0) continue;
      ctx.globalAlpha = 0.26 * a;
      ctx.fillStyle = '#1a0e08';
      ctx.beginPath(); ctx.ellipse(c.x + PX.cx + 8, TOP_Y + 3, 92 * sc, 9, 0, 0, TAU); ctx.fill();
    }
    // yansıma: tezgahın arka kenarına göre ters çevrilmiş, basık ve soluk
    ctx.globalAlpha = 0.36;
    ctx.translate(PX.cx, TOP_Y);
    ctx.scale(1, -0.45);
    ctx.translate(0, -TOP_Y + PX.cy);
    try { C.drawSlotFigures(ctx); } catch (e) { /* yansıma isteğe bağlı */ }
    ctx.restore();
    // yansımanın ön kenara doğru sönmesi (mermerin kendi rengi geri gelir)
    const g = ctx.createLinearGradient(0, TOP_Y, 0, TOP_Y + TOP_H);
    g.addColorStop(0, 'rgba(244,240,234,0)'); g.addColorStop(1, 'rgba(244,240,234,0.4)');
    ctx.fillStyle = g; ctx.fillRect(326, TOP_Y + 1, 1150, TOP_H - 1);
  }

  // ---------------------------------------------------------------------------
  // ÖN PLAN: fareyi izleyen yüzey parlaması + kameraya yakın bokeh zerreleri
  // ---------------------------------------------------------------------------
  const SPEC = { x: 800, y: 660, a: 0 };
  function drawSpecular(ctx, dt) {
    const p = KS.pointer, on = p && p.inside && p.y > 430 && !(KS.ui && KS.ui.modalOpen);
    const f = 1 - Math.exp(-dt * 7);
    if (on) { SPEC.x += (p.x - SPEC.x) * f; SPEC.y += (p.y - SPEC.y) * f; }
    SPEC.a += ((on ? 1 : 0) - SPEC.a) * (1 - Math.exp(-dt * 4));
    if (SPEC.a < 0.02) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 422, 1600, 478); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.085 * SPEC.a;
    ctx.drawImage(softSprite('#fff3dc'), SPEC.x - 250, SPEC.y - 190, 500, 380);
    ctx.restore();
  }
  const BOKEH = [];
  for (let i = 0; i < 9; i++) {
    BOKEH.push({ u: h01(i, 1), v: h01(i, 2), r: 22 + h01(i, 3) * 46, sp: 0.004 + h01(i, 4) * 0.007, ph: h01(i, 5) * TAU, z: 1.6 + h01(i, 6) * 2.2, a: 0.030 + h01(i, 7) * 0.035 });
  }
  function drawBokeh(ctx, t) {
    const S = sky(), PX = (KS.Art && KS.Art.parallax) || { x: 0, y: 0 };
    const col = S && S.late > 0.4 ? '#ffc890' : '#fff1d6';
    const spr = softSprite(col);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of BOKEH) {
      // kameraya yakın: fareyle TERS yönde ve arka plandan daha çok kayar
      const x = ((b.u + t * b.sp) % 1) * 1760 - 80 - PX.x * b.z;
      const y = 90 + b.v * 780 + Math.sin(t * 0.23 + b.ph) * 16 - PX.y * b.z;
      ctx.globalAlpha = b.a * (0.65 + 0.35 * Math.sin(t * 0.5 + b.ph * 2));
      ctx.drawImage(spr, x - b.r, y - b.r, b.r * 2, b.r * 2);
    }
    ctx.restore();
  }

  let _dt = 0.016;
  function wrap(fn) { return function (ctx, layer) { if (!active()) return; try { fn(ctx, layer); } catch (e) { /* derinlik efektleri isteğe bağlı */ } }; }

  // müşterilerden ÖNCE çizilenler
  KS.registerModule({
    name: 'depthBack', order: 5,
    update(dt, realDt) { _dt = realDt || 0.016; },
    draw: wrap((ctx, layer) => {
      if (layer === 'back') drawRays(ctx, KS.time || 0);
      else if (layer === 'counter') drawCounterReflection(ctx);
    }),
  });
  // müşterilerden / istasyonlardan SONRA çizilenler
  KS.registerModule({
    name: 'depthFront', order: 55,
    draw: wrap((ctx, layer) => {
      if (layer === 'customers') drawCounterOcclusion(ctx);
      else if (layer === 'fx') { drawSpecular(ctx, _dt); drawBokeh(ctx, KS.time || 0); }
    }),
  });
})(window.KS);
