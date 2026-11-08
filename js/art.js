/* KantinSim — Art (GEÇİCİ STUB). Art ajanı bu dosyayı tamamen yeniden yazacak.
 * İmzalar CONTRACT.md'deki ile aynıdır; buradaki çizimler sadece yer tutucudur. */
(function (KS) {
  'use strict';
  const R = (ctx, x, y, w, h, r) => KS.roundRectPath(ctx, x, y, w, h, r);
  function colorOf(id) {
    const D = KS.DATA;
    return (D.ingredients[id] && D.ingredients[id].color) || (D.prepared[id] && D.prepared[id].color) ||
      (D.products[id] && D.products[id].color) || '#ccc';
  }
  const Art = {
    roundRect(ctx, x, y, w, h, r) { R(ctx, x, y, w, h, r); },
    text(ctx, str, x, y, o = {}) {
      ctx.save(); ctx.font = (o.weight || 700) + ' ' + (o.size || 18) + 'px ' + (o.font || '"Nunito", sans-serif');
      ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.baseline || 'middle';
      if (o.stroke) { ctx.lineWidth = o.strokeWidth || 4; ctx.strokeStyle = o.stroke; ctx.strokeText(str, x, y); }
      ctx.fillStyle = o.color || '#fff'; ctx.fillText(str, x, y); ctx.restore();
    },
    metalPanel(ctx, r, o = {}) { ctx.fillStyle = '#9aa3ad'; R(ctx, r.x, r.y, r.w, r.h, o.radius || 12); ctx.fill(); },
    woodPanel(ctx, r, o = {}) { ctx.fillStyle = '#a0703f'; R(ctx, r.x, r.y, r.w, r.h, o.radius || 12); ctx.fill(); },
    stationLabel(ctx, r, label) { Art.text(ctx, label, r.x + 10, r.y + 14, { size: 14, color: '#fff', stroke: '#0008' }); },
    drawBackground(ctx, time, weather, t) {
      ctx.fillStyle = '#e8dcc4'; ctx.fillRect(0, 0, 1600, 352);
      ctx.fillStyle = '#5b6470'; ctx.fillRect(0, 422, 1600, 478);
    },
    drawCounterFront(ctx, t) { ctx.fillStyle = '#c9c9c9'; ctx.fillRect(0, 352, 1600, 20); ctx.fillStyle = '#8b5a2b'; ctx.fillRect(0, 372, 1600, 50); },
    drawWorkspace(ctx, t) {},
    drawIngredient(ctx, id, x, y, size = 60, o = {}) {
      ctx.fillStyle = colorOf(id); ctx.beginPath(); ctx.arc(x, y, size / 2.4, 0, Math.PI * 2); ctx.fill();
    },
    drawProduct(ctx, id, x, y, size = 60, o = {}) {
      ctx.fillStyle = colorOf(id); R(ctx, x - size / 3, y - size / 2, size / 1.5, size, 6); ctx.fill();
    },
    drawItem(ctx, item, x, y, scale = 1) {
      if (!item) return;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      if (item.type === 'product') Art.drawProduct(ctx, item.id, 0, 0, 64);
      else if (item.type === 'ing') Art.drawIngredient(ctx, item.id, 0, 0, 56, { cook: item.cook });
      else {
        ctx.fillStyle = colorOf(item.id === 'kese' ? 'patates' : item.id === 'bardak' ? 'cay' : item.id);
        R(ctx, -45, -20, 90, 40, 10); ctx.fill();
        item.layers.forEach((l, i) => { ctx.fillStyle = colorOf(l.id); ctx.fillRect(-35, -24 - i * 6, 70, 6); });
      }
      ctx.restore();
    },
    randomLook(type) { return { type, skin: '#f1c27d', hair: '#3b2a1a', shirt: '#2f6fd6', gender: Math.random() < 0.5 ? 'k' : 'e' }; },
    drawCustomer(ctx, c, x, baseY, t) {
      const look = c.look || {};
      ctx.fillStyle = look.shirt || '#36c'; R(ctx, x - 60, baseY - 150, 120, 150, 30); ctx.fill();
      ctx.fillStyle = look.skin || '#f1c27d'; ctx.beginPath(); ctx.arc(x, baseY - 190, 48, 0, Math.PI * 2); ctx.fill();
    },
    drawBubble(ctx, x, y, w, h, o = {}) {
      ctx.fillStyle = '#fff'; R(ctx, x, y, w, h, 14); ctx.fill();
    },
    drawPatience(ctx, x, y, w, ratio) {
      ctx.fillStyle = '#0006'; ctx.fillRect(x, y, w, 8);
      ctx.fillStyle = ratio > 0.5 ? '#5fe07a' : ratio > 0.25 ? '#ffd23f' : '#ff5a4f'; ctx.fillRect(x, y, w * ratio, 8);
    },
    drawIcon(ctx, name, x, y, size) { Art.text(ctx, name, x, y, { size, align: 'center' }); },
  };
  KS.Art = Art;
})(window.KS);
