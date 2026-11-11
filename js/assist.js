/* KantinSim — yardımcı özellikler
 *   1) Tarif yardımcısı: eli boşken bir müşterinin üzerine gelince siparişi için gereken kutular,
 *      istasyonlar ve vitrin gözleri altın renkle yanar (H ile aç/kapat).
 *   2) Klavye kısayolları: Boşluk = duraklat, 1/2 = hız, F = tam ekran, M/T/N/G/E/R/K = paneller.
 *   3) Gün şeridi: HUD'un altında zil programı (teneffüsler turuncu), şimdiki an ve sıradaki yoğun saate kalan süre.
 * Dışa açılan: KS.Assist = { enabled(), setEnabled(on), needsFor(customer), toggleFullscreen() }
 */
(function (KS) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const KEY = 'kantinsim_assist';
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== '0'; } catch (e) { /* */ }
  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) { /* */ }
  }
  const playing = () => { const ph = KS.state && KS.state.phase; return ph === 'prep' || ph === 'open' || ph === 'closing'; };
  const sfx = n => { try { KS.audio.play(n); } catch (e) { /* */ } };

  // ---------------------------------------------------------------------------
  // 1) TARİF YARDIMCISI
  // ---------------------------------------------------------------------------
  // Malzeme → kutudan başka uğraması gereken istasyon
  const STATION_OF = { kofte: 'izgara', patates: 'fritoz', kese: 'fritoz', cay: 'semaver', bardak: 'semaver', cigkofte: 'yogurma' };

  /** Müşterinin bekleyen satırları için gereken yerler: [{key, rect, station}] */
  function needsFor(c) {
    const out = [], seen = {};
    const L = KS.layout || {}, P = KS.Stations && KS.Stations.prep, D = KS.DATA || {};
    const push = (key, rect, station) => { if (rect && rect.w && !seen[key]) { seen[key] = 1; out.push({ key, rect, station: !!station }); } };
    if (!c || !c.lines) return out;
    for (const ln of c.lines) {
      if (ln.done || !ln.line) continue;
      const line = ln.line;
      if (line.type === 'product') {
        const cells = P && P.vitrinCells ? P.vitrinCells() : [];
        const cell = cells.find(v => v.id === line.id);
        if (cell) push('p:' + line.id, cell); else push('s:vitrin', L.vitrin, true);
        continue;
      }
      const R = D.recipes && D.recipes[line.id];
      if (!R) continue;
      const ids = [R.base].concat(R.required || [], line.want || R.defaults || []);
      for (const id of ids) {
        const b = P && P.binRect ? P.binRect(id) : null;
        if (b) push('b:' + id, b);
        const st = STATION_OF[id];
        if (st) push('s:' + st, L[st], true);
      }
      if (R.toast) push('s:tost', L.tost, true);
    }
    return out;
  }

  function hoveredCustomer() {
    const C = KS.Customers, L = KS.layout, p = KS.pointer;
    if (!C || !C.slotCustomer || !L || !L.customerSlots || !p || !p.inside) return null;
    for (let i = 0; i < L.customerSlots.length; i++) {
      const c = C.slotCustomer(i);
      if (c && c.state === 'wait' && !c.inspector && KS.util.inRect(p, L.customerSlots[i].rect)) return c;
    }
    return null;
  }

  let hintA = 0, lastNeeds = [];
  function drawAssist(ctx, dt) {
    const show = enabled && playing() && !KS.held && KS.inputEnabled();
    const c = show ? hoveredCustomer() : null;
    if (c) lastNeeds = needsFor(c);
    hintA += ((c ? 1 : 0) - hintA) * (1 - Math.exp(-dt * 12));
    if (hintA < 0.02 || !lastNeeds.length) return;
    const t = KS.time || 0, pulse = 0.5 + 0.5 * Math.sin(t * 5);
    ctx.save();
    ctx.lineJoin = 'round';
    for (const n of lastNeeds) {
      const r = n.rect, pad = n.station ? 5 : 2, rad = n.station ? 14 : 9;
      const x = r.x + pad, y = r.y + pad, w = r.w - pad * 2, h = r.h - pad * 2;
      KS.roundRectPath(ctx, x, y, w, h, rad);
      ctx.fillStyle = 'rgba(255,205,70,' + (0.10 * hintA).toFixed(3) + ')'; ctx.fill();
      ctx.shadowColor = 'rgba(255,190,40,0.9)'; ctx.shadowBlur = 12 + pulse * 10;
      ctx.strokeStyle = 'rgba(255,214,90,' + ((0.65 + 0.35 * pulse) * hintA).toFixed(3) + ')';
      ctx.lineWidth = n.station ? 3 : 3.5;
      if (n.station) { ctx.setLineDash([14, 9]); ctx.lineDashOffset = -t * 26; } else ctx.setLineDash([]);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // 2) KLAVYE KISAYOLLARI
  // ---------------------------------------------------------------------------
  const PANEL_KEYS = { m: 'supply', t: 'phone', n: 'menu', g: 'upgrades', e: 'staff', r: 'recipes', k: 'kantin' };
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch (e) { /* desteklenmiyor */ }
  }
  function setSpeed(v) {
    const s = KS.state; if (!s || !playing()) return;
    if ((s.speedMult || 1) === v) return;
    s.speedMult = v; sfx('click');
    KS.notify(v === 2 ? '⏩ Hızlı mod: 2x' : '▶️ Normal hız: 1x', 'info');
    try { KS.ui.refresh(); } catch (e) { /* */ }
  }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const k = e.key.length === 1 ? e.key.toLocaleLowerCase('tr') : e.key;
    const ui = KS.ui || {}, s = KS.state || {};
    if (k === 'f') { toggleFullscreen(); return; }
    if (!playing()) return;
    if (k === ' ') {
      e.preventDefault();
      if (el && el.tagName === 'BUTTON') el.blur();   // boşluk ayrıca odaktaki düğmeye basmasın
      if (s.paused) { KS.game.togglePause(false); return; }   // duraklatma ekranı modal sayılır: önce ona bak
      if (ui.modalOpen) return;
      if (s.phase === 'prep') return;
      KS.game.togglePause(true);
      return;
    }
    if (s.paused) return;
    if (k === '1') { setSpeed(1); return; }
    if (k === '2') { setSpeed(2); return; }
    if (k === 'h') {
      setEnabled(!enabled); sfx('click');
      KS.notify(enabled ? '💡 Tarif yardımcısı açık: müşterinin üzerine gel.' : 'Tarif yardımcısı kapalı.', 'info');
      return;
    }
    const pid = PANEL_KEYS[k];
    if (pid && ui.open) {
      if (ui.isOpen && ui.isOpen(pid)) { ui.close(); sfx('click'); }
      else if (!ui.modalOpen) { if (KS.held) KS.returnHeld(); sfx('click'); ui.open(pid); }
    }
  }

  // ---------------------------------------------------------------------------
  // 3) GÜN ŞERİDİ (zil programı)
  // ---------------------------------------------------------------------------
  const BUSY = { teneffus: 1, ogle: 1, cikis: 1 };
  let bar = null, elPast = null, elNow = null, elTag = null, tagText = '';
  function buildBar() {
    const root = document.getElementById('ui'), D = KS.DATA;
    if (!root || !D || !D.periods || bar) return;
    const t0 = D.OPEN_MIN || 480, span = (D.CLOSE_MIN || 1020) - t0;
    bar = document.createElement('div');
    bar.id = 'ks-dayline'; bar.className = 'ks-passive ks-hide';
    for (const p of D.periods) {
      const seg = document.createElement('i');
      seg.className = 'dl-seg dl-' + p.type;
      seg.style.left = ((p.from - t0) / span * 100).toFixed(3) + '%';
      seg.style.width = ((p.to - p.from) / span * 100).toFixed(3) + '%';
      bar.appendChild(seg);
    }
    elPast = document.createElement('i'); elPast.className = 'dl-past';
    elNow = document.createElement('i'); elNow.className = 'dl-now';
    elTag = document.createElement('span'); elTag.className = 'dl-tag';
    bar.appendChild(elPast); bar.appendChild(elNow); bar.appendChild(elTag);
    root.appendChild(bar);
  }
  function tagFor(time) {
    const D = KS.DATA, cur = KS.currentPeriod();
    if (KS.state.phase === 'closing') return 'Kapanış';
    if (cur && BUSY[cur.type] && time >= cur.from) return '🔔 ' + cur.label + ' · ' + Math.max(1, Math.ceil(cur.to - time)) + ' dk kaldı';
    const next = D.periods.find(p => BUSY[p.type] && p.from > time);
    if (next) return next.label + ' · ' + Math.max(1, Math.ceil(next.from - time)) + ' dk sonra';
    return 'Kapanış · ' + Math.max(1, Math.ceil((D.CLOSE_MIN || 1020) - time)) + ' dk sonra';
  }
  function updateBar() {
    if (!bar) return;
    const on = playing();
    bar.classList.toggle('ks-hide', !on);
    if (!on) return;
    const D = KS.DATA, t0 = D.OPEN_MIN || 480, span = (D.CLOSE_MIN || 1020) - t0;
    const bw = bar.offsetWidth || 1600; // şerit artık ekran genişliğinde; işaretçi px'i buna göre
    const time = clamp(KS.state.time, t0, t0 + span), u = (time - t0) / span;
    const x = (u * bw).toFixed(1);
    elPast.style.width = x + 'px';
    elNow.style.transform = 'translateX(' + x + 'px)';
    const cur = KS.currentPeriod();
    bar.classList.toggle('busy', !!(cur && BUSY[cur.type]) && KS.state.phase === 'open');
    const txt = tagFor(time);
    if (txt !== tagText) { tagText = txt; elTag.textContent = txt; }
    // etiket işaretçiyi izler ama ekrandan taşmaz
    const half = (elTag.offsetWidth || 120) / 2;
    elTag.style.transform = 'translateX(' + clamp(u * bw, half + 6, bw - half - 6).toFixed(1) + 'px) translateX(-50%)';
  }

  // ---------------------------------------------------------------------------
  let acc = 0, _dt = 0.016;
  KS.Assist = { enabled: () => enabled, setEnabled, needsFor, toggleFullscreen };
  KS.registerModule({
    name: 'assist', order: 110,
    init() {
      window.addEventListener('keydown', e => { try { onKey(e); } catch (err) { console.error('[assist]', err); } });
      try { KS.bus.on('boot', () => { buildBar(); updateBar(); }); } catch (e) { /* */ }
    },
    update(dt, realDt) {
      _dt = realDt || 0.016;
      acc += _dt;
      if (acc >= 0.25) { acc = 0; try { updateBar(); } catch (e) { /* */ } }
    },
    draw(ctx, layer) { if (layer === 'fx') drawAssist(ctx, _dt); },
  });
})(window.KS);
