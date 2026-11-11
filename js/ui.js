/* KantinSim — Arayüz (UI)
 * Sahibi: Arayüz ajanı. HTML/CSS overlay; #ui içinde (mantıksal 1600x900).
 * İçerik: ana menü, HUD, hazırlık kartı, paneller (malzeme, telefon, menü & fiyat, geliştirme,
 *         personel, tarif defteri, ayarlar, nasıl oynanır), gün sonu özeti, iflas, duraklatma,
 *         bildirimler, seviye popup'ı, zil afişi, ilk gün eğitimi.
 * Dışa açılan: KS.ui = { notify, modalOpen, modalPauses, handleEscape, open, close, refresh, isOpen }
 */
(function (KS) {
  'use strict';

  // ---------------------------------------------------------------------------
  // KISAYOLLAR & GÜVENLİ YARDIMCILAR
  // ---------------------------------------------------------------------------
  const S = () => KS.state;
  const D = () => KS.DATA;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = n => { try { return KS.util.fmtMoney(n); } catch (e) { return Math.round(n || 0) + ' ₺'; } };
  const fmtSigned = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  const fmtT = m => { try { return KS.util.fmtTime(m); } catch (e) { return '--:--'; } };
  const nameOf = id => { try { return KS.Recipes.nameOf(id); } catch (e) { return String(id); } };
  const lvl = () => (S() && S().level) || 1;
  function sfx(n, o) { try { if (KS.audio && KS.audio.play) KS.audio.play(n, o); } catch (e) { /* ses yok */ } }
  function unlockAudio() { try { if (KS.audio && KS.audio.unlock) KS.audio.unlock(); } catch (e) { /* */ } }
  function call(fn, ...a) { try { return fn ? fn(...a) : undefined; } catch (e) { console.error('[ui]', e); return undefined; } }
  function safe(fn) { return function (...a) { try { return fn.apply(this, a); } catch (e) { console.error('[ui]', e); return undefined; } }; }
  function save() { try { if (KS.save) KS.save(); } catch (e) { /* */ } }
  const recipeUnlocked = id => { try { return !!KS.isRecipeUnlocked(id); } catch (e) { return false; } };
  const productUnlocked = id => { try { return !!KS.isProductUnlocked(id); } catch (e) { return true; } };

  // Hiperskript: h('div', {class, text, html, style, onclick, ...}, ...çocuklar)
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'style') { if (typeof v === 'string') e.style.cssText = v; else Object.assign(e.style, v); }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), safe(v));
        else if (k === 'disabled') e.disabled = true;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    add(e, kids);
    return e;
  }
  function add(e, kids) {
    for (const k of [].concat(kids).flat(Infinity)) {
      if (k == null || k === false || k === '') continue;
      e.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return e;
  }
  function clear(e) { while (e && e.firstChild) e.removeChild(e.firstChild); return e; }
  function show(e, on) { if (e) e.classList.toggle('ks-hide', !on); }
  // DOM'a sadece değer değiştiyse yaz
  function setText(e, v) { if (e && e._v !== v) { e._v = v; e.textContent = v; } }
  function setHTML(e, v) { if (e && e._h !== v) { e._h = v; e.innerHTML = v; } }
  function setStyle(e, k, v) { if (e && e['_s' + k] !== v) { e['_s' + k] = v; e.style[k] = v; } }
  function setCls(e, c, on) { if (e) e.classList.toggle(c, !!on); }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Buton: tıklamada ses + audio unlock
  function btn(label, cls, onclick, extra) {
    const b = h('button', Object.assign({ class: 'ks-btn ' + (cls || ''), type: 'button' }, extra || {}), label);
    b.addEventListener('click', safe(ev => {
      unlockAudio();
      if (b.disabled || b.classList.contains('is-disabled')) { sfx('error'); return; }
      sfx('click');
      if (onclick) onclick(ev, b);
    }));
    return b;
  }
  function setDisabled(b, on) { if (!b) return; b.classList.toggle('is-disabled', !!on); b.setAttribute('aria-disabled', on ? 'true' : 'false'); }

  // Türkçe sayı eki: 20'li, 30'lu, 40'lı, 100'lü
  function numSuffix(n) {
    const units = { 1: 'li', 2: 'li', 3: 'lü', 4: 'lü', 5: 'li', 6: 'lı', 7: 'li', 8: 'li', 9: 'lu' };
    const tens = { 1: 'lu', 2: 'li', 3: 'lu', 4: 'lı', 5: 'li', 6: 'lı', 7: 'li', 8: 'li', 9: 'lı' };
    n = Math.abs(Math.round(n));
    if (n === 0) return 'lı';
    if (n % 10) return units[n % 10];
    if (n % 100) return tens[(n % 100) / 10];
    if (n % 1000) return 'lü';
    return 'li';
  }
  const packLabel = n => n + "'" + numSuffix(n) + ' paket';

  // Stepper (− değer +). opts: {value, min, max, step, onChange(v), fmt(v)}
  function stepper(opts) {
    const st = { v: opts.value || 0 };
    const min = opts.min != null ? opts.min : 0, max = opts.max != null ? opts.max : 99, step = opts.step || 1;
    const val = h('span', { class: 'stp-val' });
    const set = (v, silent) => {
      v = clamp(v, min, max);
      if (v === st.v && !silent) { sfx('error'); return; }
      st.v = v; render();
      if (!silent && opts.onChange) opts.onChange(v);
    };
    const minus = h('button', { class: 'stp-btn minus', type: 'button', title: 'Azalt (Shift: ×5)' }, '−');
    const plus = h('button', { class: 'stp-btn plus', type: 'button', title: 'Arttır (Shift: ×5)' }, '+');
    minus.addEventListener('click', safe(ev => { unlockAudio(); sfx('tick'); set(st.v - step * (ev.shiftKey ? 5 : 1)); }));
    plus.addEventListener('click', safe(ev => { unlockAudio(); sfx('tick'); set(st.v + step * (ev.shiftKey ? 5 : 1)); }));
    function render() {
      val.textContent = opts.fmt ? opts.fmt(st.v) : String(st.v);
      minus.disabled = st.v <= min; plus.disabled = st.v >= max;
      el.classList.toggle('has-value', st.v > 0 && !opts.fmt);
    }
    const el = h('div', { class: 'ks-stepper ' + (opts.cls || '') }, minus, val, plus);
    render();
    return { el, get value() { return st.v; }, set: v => set(v, true), setDisabled(on) { el.classList.toggle('is-disabled', !!on); } };
  }

  // Aç/kapa anahtarı
  function toggle(on, onChange, labels) {
    const t = h('button', { class: 'ks-toggle' + (on ? ' on' : ''), type: 'button' },
      h('span', { class: 'tg-knob' }), h('span', { class: 'tg-label' }));
    const lab = t.querySelector('.tg-label');
    const st = { on: !!on };
    const render = () => { t.classList.toggle('on', st.on); lab.textContent = labels ? (st.on ? labels[0] : labels[1]) : (st.on ? 'Açık' : 'Kapalı'); };
    t.addEventListener('click', safe(() => { unlockAudio(); sfx('click'); st.on = !st.on; render(); onChange && onChange(st.on); }));
    render();
    return t;
  }

  // Offscreen canvas ikonları (Art stub iken de çalışır)
  function cv(w, hh, draw, cls) {
    const c = document.createElement('canvas'), r = 2;
    c.width = w * r; c.height = hh * r;
    c.style.width = w + 'px'; c.style.height = hh + 'px';
    c.className = 'ks-cv ' + (cls || '');
    const ctx = c.getContext && c.getContext('2d');
    if (ctx) {
      ctx.scale(r, r);
      try { draw(ctx); } catch (e) {
        try { ctx.fillStyle = '#d9c3a0'; ctx.beginPath(); ctx.arc(w / 2, hh / 2, Math.min(w, hh) / 3, 0, Math.PI * 2); ctx.fill(); } catch (_) { /* */ }
      }
    }
    return c;
  }
  const hasArt = f => KS.Art && typeof KS.Art[f] === 'function';
  const ingIcon = (id, s = 48) => cv(s, s, ctx => { if (hasArt('drawIngredient')) KS.Art.drawIngredient(ctx, id, s / 2, s / 2, s * 0.84, {}); });
  const prodIcon = (id, s = 48) => cv(s, s, ctx => { if (hasArt('drawProduct')) KS.Art.drawProduct(ctx, id, s / 2, s / 2, s * 0.84); });
  function sampleDish(rid) {
    const r = D().recipes[rid]; if (!r) return null;
    const mk = id => (id === 'kofte' ? { id, q: 1, cook: 1, cookA: 1, cookB: 1 } : id === 'patates' ? { id, q: 1, cook: 1 } : { id, q: 1 });
    const layers = (r.required || []).concat(r.defaults || []).map(mk);
    return { uid: -1, type: 'dish', id: r.base, layers, toast: r.toast ? 1 : 0 };
  }
  const dishIcon = (rid, w, hh, sc) => cv(w, hh, ctx => { if (hasArt('drawItem')) KS.Art.drawItem(ctx, sampleDish(rid), w / 2, hh / 2, sc); });

  // ---------------------------------------------------------------------------
  // SABİT METİNLER
  // ---------------------------------------------------------------------------
  const EVENT_ICONS = { yok: '📅', mufettis: '🕵️', veli: '👪', mac: '⚽', sinav: '📝', elektrik: '⚡', burs: '💰', gezi: '🚌', ogretmenler: '🍎', kermes: '🎪', saglik: '🥗', bilim: '🔬', karne: '🎒' };
  const EVENT_SHORT = { gezi: 'Okul Gezisi', ogretmenler: 'Öğretmenler Günü', kermes: 'Kermes', mufettis: 'Müfettiş', veli: 'Veli Toplantısı', mac: 'Maç Günü', sinav: 'Sınav Haftası', elektrik: 'Elektrik Kesintisi', burs: 'Harçlık Günü', saglik: 'Sağlıklı Beslenme', bilim: 'Bilim Şenliği', karne: 'Karne Günü' };
  const UPG_ICONS = { tost: '🥪', izgara: '🔥', fritoz: '🍟', semaver: '🫖', tezgah: '🔪', bekleme: '🗄️', yogurma: '🥣', buzdolabi: '🧊', kasa: '💳', dekor: '🪴' };
  const STAFF_ICONS = { cirak: '🧑‍🍳', temizlikci: '🧹', kasiyer: '🧾', sef: '👨‍🍳' };
  const EXP_LABELS = [
    ['malzeme', '🥬 Malzeme'], ['hazir', '🌯 Hazır yemek'], ['nakliye', '🚚 Nakliye & kurye'], ['geliştirme', '⬆️ Geliştirme'],
    ['personel', '👥 Personel'], ['kira', '🏫 Kira'], ['fatura', '💡 Faturalar'], ['reklam', '📣 Reklam'], ['kredi', '🏦 Kredi taksiti'], ['ceza', '🚨 Ceza'], ['diger', '📎 Diğer'],
  ];
  const ING_GROUPS = [
    { label: '🍞 Ekmekler', ids: ['tost_ekmegi', 'yarim_ekmek', 'lavas', 'hamburger_ekmegi'] },
    { label: '🧀 Peynir & Et', ids: ['kasar', 'sucuk', 'cheddar', 'kofte'] },
    { label: '🥬 Sebze', ids: ['domates', 'sogan', 'marul', 'tursu', 'patates', 'maydanoz', 'limon'] },
    { label: '🧂 Sos & Çeşni', ids: ['nar_eksisi', 'ketcap', 'mayonez', 'tuz', 'pul_biber'] },
    { label: '🌾 Hammadde', ids: ['bulgur', 'isot', 'salca', 'cay_yapragi', 'yag'] },
  ];
  // hammaddelerin kullanıldığı tarifler
  const RAW_USE = { bulgur: ['cigkofte_durum'], isot: ['cigkofte_durum'], salca: ['cigkofte_durum'], cay_yapragi: ['cay'], yag: ['patates'] };

  function ingGroups() {
    // DATA'da gruba girmemiş yeni malzemeler varsa türüne göre ekle
    const known = new Set(ING_GROUPS.flatMap(g => g.ids));
    const groups = ING_GROUPS.map(g => ({ label: g.label, ids: g.ids.filter(id => D().ingredients[id]) }));
    const kindMap = { base: 0, topping: 2, cookable: 1, sauce: 3, raw: 4 };
    for (const [id, ing] of Object.entries(D().ingredients)) {
      if (known.has(id)) continue;
      const gi = kindMap[ing.kind] != null ? kindMap[ing.kind] : 2;
      groups[gi].ids.push(id);
    }
    return groups.filter(g => g.ids.length);
  }
  function recipesUsing(id) {
    const out = [];
    for (const [rid, r] of Object.entries(D().recipes)) {
      if (r.base === id || (r.required || []).includes(id) || (r.optional || []).includes(id)) out.push(rid);
    }
    for (const rid of RAW_USE[id] || []) if (!out.includes(rid) && D().recipes[rid]) out.push(rid);
    return out;
  }
  function ingLockNote(id) {
    const uses = recipesUsing(id);
    if (!uses.length || uses.some(recipeUnlocked)) return null;
    let best = null;
    for (const rid of uses) { const r = D().recipes[rid]; if (!best || r.unlock < best.unlock) best = r; }
    return best ? '🔒 ' + best.name + ' · Seviye ' + best.unlock : null;
  }
  // Tarif tahmini maliyeti (taban + gerekli + varsayılan malzemeler)
  function recipeCost(rid) {
    const r = D().recipes[rid]; if (!r) return 0;
    const I = D().ingredients;
    const one = id => {
      if (I[id]) return I[id].cost || 0;
      if (id === 'cay') {
        let g = 10; try { g = KS.upgVal('semaver', 'glasses') || 10; } catch (e) { /* */ }
        return ((I.cay_yapragi && I.cay_yapragi.cost) || 18) / g;
      }
      if (id === 'cigkofte') {
        let b = 8; try { b = KS.upgVal('yogurma', 'batch') || 8; } catch (e) { /* */ }
        return (['bulgur', 'isot', 'salca'].reduce((a, k) => a + ((I[k] && I[k].cost) || 0), 0)) / b;
      }
      return 0;
    };
    let c = one(r.base);
    for (const id of (r.required || []).concat(r.defaults || [])) c += one(id);
    return c;
  }
  function perception(ratio) {
    if (ratio < 0.85) return { label: 'Ucuz', cls: 'cheap' };
    if (ratio <= 1.15) return { label: 'Normal', cls: 'normal' };
    if (ratio <= 1.5) return { label: 'Pahalı', cls: 'pricey' };
    return { label: 'Çok pahalı', cls: 'expensive' };
  }

  // ---------------------------------------------------------------------------
  // KÖK ELEMANLAR
  // ---------------------------------------------------------------------------
  let root = null;
  const E = {};   // eleman referansları

  // ---------------------------------------------------------------------------
  // AYARLAR (ses / müzik) — ayrı anahtarda saklanır ki ana menüde de geçerli olsun
  // ---------------------------------------------------------------------------
  const SET_KEY = 'kantinsim_ui_settings';
  let settings = { sound: true, music: true, fx: true };
  function loadSettings() {
    try { const raw = localStorage.getItem(SET_KEY); if (raw) settings = Object.assign(settings, JSON.parse(raw)); } catch (e) { /* */ }
  }
  function applySettings(persist) {
    try { if (S()) S().settings = Object.assign({}, S().settings || {}, settings); } catch (e) { /* */ }
    try { if (KS.audio && KS.audio.setMuted) KS.audio.setMuted(!settings.sound); } catch (e) { /* */ }
    try { if (KS.audio && KS.audio.setMusic) KS.audio.setMusic(!!settings.music && !!settings.sound); } catch (e) { /* */ }
    try { if (KS.Art && KS.Art.setFx) KS.Art.setFx(settings.fx !== false, false); } catch (e) { /* */ }
    if (persist) { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) { /* */ } save(); }
    if (E.mmSound) E.mmSound.classList.toggle('off', !settings.sound);
    if (E.mmMusic) E.mmMusic.classList.toggle('off', !settings.music);
  }
  function setSound(on) { settings.sound = !!on; applySettings(true); }
  function setMusic(on) { settings.music = !!on; applySettings(true); }

  // ---------------------------------------------------------------------------
  // BİLDİRİMLER
  // ---------------------------------------------------------------------------
  const NOTIF_ICONS = { good: '✅', bad: '⛔', warn: '⚠️', info: 'ℹ️' };
  const startsWithEmoji = s => { try { return /^\p{Extended_Pictographic}/u.test(s); } catch (e) { return false; } };
  function notify(msg, type) {
    try {
      type = NOTIF_ICONS[type] ? type : 'info';
      msg = String(msg == null ? '' : msg);
      if (!E.notifs) { console.log('[notify]', msg); return; }
      // aynı mesaj kısa sürede tekrar gelirse sayaç arttır
      const last = E.notifs.lastElementChild;
      if (last && last._msg === msg && !last._leaving && performance.now() - last._t < 2500) {
        last._n = (last._n || 1) + 1; last._t = performance.now();
        let c = last.querySelector('.nt-count'); if (!c) { c = h('span', { class: 'nt-count' }); last.appendChild(c); }
        c.textContent = '×' + last._n;
        clearTimeout(last._timer); last._timer = setTimeout(() => dismissToast(last), 3500);
        last.classList.remove('bump'); void last.offsetWidth; last.classList.add('bump');
        return;
      }
      const t = h('div', { class: 'ks-toast t-' + type },
        startsWithEmoji(msg) ? null : h('span', { class: 'nt-ico' }, NOTIF_ICONS[type]),
        h('span', { class: 'nt-msg' }, msg));
      t._msg = msg; t._t = performance.now();
      E.notifs.appendChild(t);
      const live = [...E.notifs.children].filter(c => !c._leaving);
      while (live.length > 5) dismissToast(live.shift(), true);
      t._timer = setTimeout(() => dismissToast(t), 3500);
    } catch (e) { console.log('[notify]', msg); }
  }
  function dismissToast(t, fast) {
    if (!t || t._leaving) return;
    t._leaving = true; clearTimeout(t._timer);
    t.classList.add('out');
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, fast ? 180 : 380);
  }

  // Ortada üstte zil afişi
  let bannerTimer = 0;
  function banner(text, cls) {
    if (!E.banner) return;
    E.banner.className = 'ks-banner ks-passive ' + (cls || '');
    clear(E.banner).appendChild(h('div', { class: 'bn-inner' }, text));
    E.banner.classList.remove('ks-hide'); void E.banner.offsetWidth; E.banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { E.banner.classList.remove('show'); }, 2600);
  }

  // Başarım kartı (üst ortada kayar)
  let achTimer = 0;
  function showAchievement(a) {
    if (!E.ach || !a) return;
    if (S().phase === 'summary' || S().phase === 'gameover') return;   // gün sonu ekranı zaten listeler
    clear(E.ach).appendChild(h('div', { class: 'ach-toast' },
      h('div', { class: 'at-ico' }, a.icon || '🏆'),
      h('div', null, h('small', null, '🏆 BAŞARIM AÇILDI'), h('b', null, a.name), h('span', null, a.desc)),
      h('div', { class: 'at-rew' }, [a.xp ? '+' + a.xp + ' XP' : null, a.money ? '+' + fmt(a.money) : null].filter(Boolean).join('\n'))));
    E.ach.classList.remove('show'); void E.ach.offsetWidth; E.ach.classList.add('show');
    clearTimeout(achTimer); achTimer = setTimeout(() => E.ach.classList.remove('show'), 3800);
    confetti(800, 110, 36);
  }

  // Büyük popup (seviye atlama) — tıklanmaz, kendiliğinden kaybolur
  let popupTimer = 0;
  function popup(title, lines, icon) {
    if (!E.popup) return;
    clear(E.popup);
    E.popup.appendChild(h('div', { class: 'pp-card' },
      h('div', { class: 'pp-rays' }),
      h('div', { class: 'pp-icon' }, icon || '⭐'),
      h('div', { class: 'pp-title' }, title),
      (lines || []).map(l => h('div', { class: 'pp-line' }, l))));
    E.popup.classList.remove('show'); void E.popup.offsetWidth; E.popup.classList.add('show');
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => E.popup.classList.remove('show'), 3400);
    confetti(800, 230, 60);
  }

  // DOM konfeti (mantıksal koordinat)
  const CONF_COLORS = ['#ffd23f', '#ff6b3d', '#3ecf8e', '#4aa8ff', '#ff5fa2', '#ffffff', '#b07cff'];
  function confetti(x, y, n) {
    if (!E.fx) return;
    n = n || 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 260;
      const p = h('i', { class: 'ks-conf' + (Math.random() < 0.3 ? ' round' : '') });
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.background = CONF_COLORS[i % CONF_COLORS.length];
      p.style.setProperty('--dx', Math.cos(a) * sp + 'px');
      p.style.setProperty('--dy', (Math.sin(a) * sp * 0.7 + 140 + Math.random() * 120) + 'px');
      p.style.setProperty('--up', (-60 - Math.random() * 120) + 'px');
      p.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
      p.style.animationDuration = (0.9 + Math.random() * 0.6) + 's';
      E.fx.appendChild(p);
      setTimeout(() => p.remove(), 1700);
    }
  }
  // Bir DOM elemanının mantıksal (#ui içi) dikdörtgeni
  function logicalRect(el) {
    try {
      const r = el.getBoundingClientRect(), u = root.getBoundingClientRect();
      const sc = u.width / 1600 || 1;
      return { x: (r.left - u.left) / sc, y: (r.top - u.top) / sc, w: r.width / sc, h: r.height / sc };
    } catch (e) { return { x: 800, y: 450, w: 0, h: 0 }; }
  }
  function confettiAt(el, n) { const r = logicalRect(el); confetti(r.x + r.w / 2, r.y + r.h / 2, n); }

  // Sayı animasyonları (gün sonu)
  const anims = [];
  function countUp(el, to, f, delay, dur) {
    anims.push({ el, to, f: f || (v => String(Math.round(v))), t: -(delay || 0), dur: dur || 0.9 });
    el.textContent = (f || (v => String(Math.round(v))))(0);
  }
  function tickAnims(dt) {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i]; a.t += dt;
      if (a.t < 0) continue;
      const k = Math.min(1, a.t / a.dur), e = 1 - Math.pow(1 - k, 3);
      a.el.textContent = a.f(a.to * e);
      if (k >= 1) { a.el.textContent = a.f(a.to); anims.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------------------
  // MODAL / PANEL SİSTEMİ
  // ---------------------------------------------------------------------------
  const ui = {
    modalOpen: false, modalPauses: false,
    notify, handleEscape: null, open: null, close: null, refresh: null, isOpen: null,
    panel: null, screen: null,
  };
  let curPanel = null;       // {id, cfg, p}
  let confirmEl = null;
  let screen = null;         // 'mainmenu' | 'summary' | 'gameover' | 'pause' | null
  function syncModal() {
    const m = !!(curPanel || confirmEl || screen);
    ui.modalOpen = m; ui.modalPauses = m;
    ui.panel = curPanel ? curPanel.id : null; ui.screen = screen;
  }

  const PANEL_ALIASES = {
    malzeme: 'supply', siparis: 'supply', toptanci: 'supply', bakkal: 'supply',
    telefon: 'phone', restoran: 'phone', fiyat: 'menu', menu: 'menu', gelistir: 'upgrades', gelistirme: 'upgrades',
    personel: 'staff', hedef: 'kantin', hedefler: 'kantin', basarim: 'kantin', banka: 'kantin', istatistik: 'kantin', pazarlama: 'kantin', tarifler: 'recipes', tarif: 'recipes', ayarlar: 'settings', yardim: 'help', nasil: 'help',
  };
  const PANELS = {};   // id -> {title, icon, width, cls, build(p)}

  function openPanel(id, arg) {
    id = PANELS[id] ? id : PANEL_ALIASES[id];
    const cfg = PANELS[id]; if (!cfg) return false;
    if (curPanel) closePanel(true);
    if (E.popup) E.popup.classList.remove('show');
    unlockAudio();
    const prevFocus = document.activeElement;
    const head = h('div', { class: 'pn-head' });
    const tabs = h('div', { class: 'pn-tabs ks-hide' });
    const body = h('div', { class: 'pn-body' });
    const foot = h('div', { class: 'pn-foot ks-hide' });
    const headExtra = h('div', { class: 'pn-head-extra' });
    const titleId = 'pn-title';
    const xBtn = h('button', { class: 'pn-x', type: 'button', title: 'Kapat (Esc)', 'aria-label': 'Kapat' }, '✕');
    xBtn.addEventListener('click', safe(() => { sfx('click'); closePanel(); }));
    add(head, [h('span', { class: 'pn-ico', 'aria-hidden': 'true' }, cfg.icon), h('h2', { id: titleId }, cfg.title), headExtra, xBtn]);
    const panel = h('div', { class: 'ks-panel ' + (cfg.cls || ''), style: { width: (cfg.width || 900) + 'px' } }, head, tabs, body, foot);
    // Erişilebilirlik: panel bir iletişim kutusu gibi davranır; odak içinde kalır.
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', titleId);
    const p = {
      id, panel, head, tabs, body, foot, headExtra, arg,
      setTabs(list, active, onChange) {
        clear(tabs); show(tabs, true);
        list.forEach(t => {
          const b = h('button', { class: 'pn-tab' + (t.id === active ? ' active' : ''), type: 'button' }, t.label,
            t.badge ? h('span', { class: 'tab-badge' }, t.badge) : null);
          b.addEventListener('click', safe(() => {
            sfx('click');
            tabs.querySelectorAll('.pn-tab').forEach(x => x.classList.remove('active'));
            b.classList.add('active'); onChange(t.id);
          }));
          tabs.appendChild(b);
        });
      },
      setFoot(...kids) { clear(foot); add(foot, kids); show(foot, kids.length > 0); },
      moneyChip() { const c = h('div', { class: 'pn-money' }, '💰 ', h('b', null, fmt(S().money))); clear(headExtra).appendChild(c); return c; },
    };
    clear(E.modal);
    E.modal.appendChild(panel);
    show(E.modal, true);
    E.modal.classList.remove('anim'); void E.modal.offsetWidth; E.modal.classList.add('anim');
    curPanel = { id, cfg, p, prevFocus };
    syncModal();
    try { cfg.build(p, arg); } catch (e) { console.error('[ui panel]', id, e); body.appendChild(h('div', { class: 'pn-empty' }, 'Bu panel şu an açılamadı.')); }
    // Escape/Tab ile gezinme: odak panelin içinde döner.
    panel.addEventListener('keydown', safe(ev => {
      if (ev.key !== 'Tab') return;
      const list = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (ev.shiftKey && (document.activeElement === first || document.activeElement === panel)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }));
    try { xBtn.focus({ preventScroll: true }); } catch (e) { /* odaklanamadı */ }
    sfx('pick');
    return true;
  }
  function closePanel(silent) {
    if (!curPanel) return false;
    const c = curPanel; curPanel = null;
    try { if (c.cfg.onClose) c.cfg.onClose(c.p); } catch (e) { console.error(e); }
    clear(E.modal); show(E.modal, false);
    syncModal();
    // Odağı panele açan düğmeye geri ver.
    try { if (!silent && c.prevFocus && c.prevFocus.focus && document.contains(c.prevFocus)) c.prevFocus.focus({ preventScroll: true }); } catch (e) { /* */ }
    if (!silent) { save(); refreshPrep(); }
    return true;
  }
  function rerenderPanel() {
    if (!curPanel) return;
    const keep = curPanel.p.body.scrollTop;
    try { curPanel.cfg.build(curPanel.p, curPanel.p.arg, true); } catch (e) { console.error(e); }
    curPanel.p.body.scrollTop = keep;
  }

  function confirmBox(title, text, yesLabel, onYes, danger) {
    closeConfirm();
    const box = h('div', { class: 'ks-confirm' },
      h('div', { class: 'cf-card' },
        h('div', { class: 'cf-title' }, title),
        h('div', { class: 'cf-text' }, text),
        h('div', { class: 'cf-btns' },
          btn('Vazgeç', 'ghost', () => closeConfirm()),
          btn(yesLabel || 'Evet', danger ? 'red' : 'orange', () => { closeConfirm(); onYes && onYes(); }))));
    box.addEventListener('pointerdown', ev => { if (ev.target === box) closeConfirm(); });
    root.appendChild(box);
    confirmEl = box; syncModal();
  }
  function closeConfirm() {
    if (!confirmEl) return false;
    confirmEl.remove(); confirmEl = null; syncModal(); return true;
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  // HUD ikonları (24x24, çizgi stili; renk = currentColor)
  const HUD_ICONS = {
    supply: '<path d="M3.5 7.6 12 3.4l8.5 4.2v8.8L12 20.6l-8.5-4.2z"/><path d="M3.5 7.6 12 11.8l8.5-4.2M12 11.8v8.8"/><path d="m7.8 5.5 8.5 4.2"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.4 18.3h3.2"/><path d="M9.5 6.2h5"/>',
    menu: '<path d="M3 17.2h18"/><path d="M4.6 17.2a7.4 7.4 0 0 1 14.8 0"/><path d="M12 7.2V5.4"/><path d="M10.3 5.2h3.4"/><path d="M4 20.2h16"/>',
    upgrades: '<path d="m6 12.5 6-6 6 6"/><path d="m6 18.5 6-6 6 6"/>',
    staff: '<circle cx="9" cy="8.2" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M15.8 4.9a3.4 3.4 0 0 1 0 6.6"/><path d="M18 14.3a6.2 6.2 0 0 1 3.4 5.7"/>',
    recipes: '<path d="M5 5.2A2.2 2.2 0 0 1 7.2 3H19v14.5H7.2A2.2 2.2 0 0 0 5 19.7z"/><path d="M5 19.7A2.2 2.2 0 0 0 7.2 21.9H19v-4.4"/><path d="M9 7.5h6M9 10.8h4"/>',
    kantin: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4A.8.8 0 0 0 8 5.6z" fill="currentColor" stroke="none"/>',
    speed: '<path d="M3.5 6.8v10.4l7.6-5.2z" fill="currentColor"/><path d="M12.4 6.8v10.4L20 12z" fill="currentColor"/>',
    sound: '<path d="M4 9.4h3.4L12 5.6v12.8l-4.6-3.8H4z" fill="currentColor"/><path d="M15.4 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.4a7.8 7.8 0 0 1 0 11.2"/>',
    mute: '<path d="M4 9.4h3.4L12 5.6v12.8l-4.6-3.8H4z" fill="currentColor"/><path d="m15.8 9.6 4.8 4.8M20.6 9.6l-4.8 4.8"/>',
  };
  const svgIco = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (HUD_ICONS[name] || '') + '</svg>';
  const HUD_BTNS = [
    { id: 'supply', label: 'Malzeme', acc: '#ffb35c', title: 'Malzeme siparişi (toptancı / bakkal)' },
    { id: 'phone', label: 'Telefon', acc: '#7fd4ff', title: 'Hazır yemek siparişi (döner, çiğ köfte, pide...)' },
    { id: 'menu', label: 'Menü', acc: '#ffd36a', title: 'Menü & fiyatlar' },
    { id: 'upgrades', label: 'Geliştir', acc: '#8ff0a8', title: 'Ekipman geliştirmeleri' },
    { id: 'staff', label: 'Personel', acc: '#c9adff', title: 'Personel işe al / çıkar' },
    { id: 'recipes', label: 'Tarifler', acc: '#ffa48f', title: 'Tarif defteri ve kontroller' },
    { id: 'kantin', label: 'Hedefler', acc: '#ff7b7b', title: 'Kantin defteri: günlük hedefler, başarımlar, istatistik, pazarlama, banka' },
    { id: 'pause', label: '', acc: '#ffd36a', title: 'Duraklat (P / Esc)', group: 2 },
    { id: 'speed', label: '1x', acc: '#7fd4ff', title: 'Oyun hızı (1x / 2x)', group: 2 },
    { id: 'sound', label: '', acc: '#8ff0a8', title: 'Sesi aç / kapat', group: 2 },
  ];
  const hud = { money: 0, moneyShown: 0, lastMoney: null };

  function buildHUD() {
    const q = {};
    q.dayLine = h('div', { class: 'hd-dayline' });
    q.clock = h('span', { class: 'hd-clock' });
    q.period = h('span', { class: 'hd-period' });
    q.busy = h('span', { class: 'hd-busy ks-hide' }, 'YOĞUN');
    q.weather = h('div', { class: 'hd-chip hd-weather' });
    q.event = h('div', { class: 'hd-chip hd-event ks-hide' });
    q.power = h('div', { class: 'hd-chip hd-power ks-hide', title: 'Elektrik kesik: tost makinesi ve fritöz çalışmıyor' }, '⚡ Elektrik yok');
    q.moneyVal = h('span', { class: 'hd-money-val' });
    q.moneyDelta = h('span', { class: 'hd-money-delta' });
    q.money = h('div', { class: 'hd-money', title: 'Kasa' }, h('span', { class: 'hd-coin' }, '₺'), q.moneyVal, q.moneyDelta);
    q.starsFg = h('div', { class: 'stars-fg' }, '★★★★★');
    q.repNum = h('span', { class: 'hd-rep-num' });
    q.rep = h('div', { class: 'hd-rep', title: 'İtibar' }, h('div', { class: 'stars' }, h('div', { class: 'stars-bg' }, '★★★★★'), q.starsFg), q.repNum);
    q.lvBadge = h('div', { class: 'hd-lv-badge' });
    q.xpFill = h('i');
    q.xpText = h('small');
    q.level = h('div', { class: 'hd-level', title: 'Seviye ve deneyim puanı' }, q.lvBadge,
      h('div', { class: 'hd-xp' }, h('div', { class: 'hd-xpbar' }, q.xpFill), q.xpText));
    q.clean = h('div', { class: 'hd-chip hd-clean', title: 'Temizlik' });
    q.deliv = h('div', { class: 'hd-chip hd-deliv ks-hide', title: 'Yoldaki siparişler' });
    q.btns = {};
    const right = h('div', { class: 'hd-right' });
    const groups = { 1: h('div', { class: 'hud-group' }), 2: h('div', { class: 'hud-group ctl' }) };
    for (const b of HUD_BTNS) {
      const ico = h('span', { class: 'hb-ico', html: svgIco(b.id) });
      const lab = h('span', { class: 'hb-label' + (b.label ? '' : ' ks-hide') }, b.label);
      const badge = h('span', { class: 'hb-badge ks-hide' });
      const el = h('button', { class: 'hud-btn hb-' + b.id + (b.group === 2 ? ' compact' : ''), type: 'button', title: b.title, 'aria-label': b.title }, ico, lab, badge);
      el.style.setProperty('--acc', b.acc);
      el._ico = ico; el._lab = lab; el._badge = badge;
      el.addEventListener('click', safe(() => { unlockAudio(); hudAction(b.id, el); }));
      q.btns[b.id] = el; groups[b.group || 1].appendChild(el);
    }
    right.appendChild(groups[1]); right.appendChild(groups[2]);
    const left = h('div', { class: 'hd-left' },
      h('div', { class: 'hd-day' }, q.dayLine, h('div', { class: 'hd-timeline' }, q.clock, q.period, q.busy)),
      q.weather, q.event, q.power, q.money, q.rep, q.level, q.clean, q.deliv);
    E.hud = h('div', { id: 'ks-hud', class: 'ks-hide' }, left, right);
    E.hudQ = q;
    return E.hud;
  }

  function hudAction(id, el) {
    const s = S();
    if (id === 'pause') {
      if (s.phase !== 'open' && s.phase !== 'closing') { sfx('error'); notify('Kantin açıkken duraklatabilirsin.', 'info'); return; }
      sfx('click'); call(KS.game.togglePause); return;
    }
    if (id === 'speed') {
      s.speedMult = (s.speedMult || 1) >= 2 ? 1 : 2; sfx('click');
      notify(s.speedMult === 2 ? '⏩ Hızlı mod: 2x' : '▶️ Normal hız: 1x', 'info');
      updateHUD(); return;
    }
    if (id === 'sound') { setSound(!settings.sound); if (settings.sound) sfx('click'); updateHUD(); return; }
    sfx('click');
    openPanel(id);
  }

  function updateHUD() {
    const q = E.hudQ; if (!q) return;
    const s = S(); if (!s) return;
    const t = s.today || {};
    setText(q.dayLine, 'Gün ' + s.day + ' · ' + (t.weekday || ''));
    setText(q.clock, fmtT(s.time));
    let plabel = '', busy = false;
    if (s.phase === 'prep') plabel = 'Hazırlık';
    else if (s.phase === 'closing') plabel = 'Kapanıyor…';
    else if (s.phase === 'summary' || s.phase === 'gameover') plabel = 'Gün bitti';
    else {
      const p = call(KS.currentPeriod) || {};
      plabel = p.label || '';
      busy = s.phase === 'open' && (p.type === 'teneffus' || p.type === 'ogle');
    }
    setText(q.period, plabel);
    show(q.busy, busy);
    // hava
    const w = D().weathers[t.weather] || D().weathers.gunesli;
    setText(q.weather, w ? w.icon : '☀️');
    if (w) q.weather.title = 'Hava: ' + w.name;
    // olay
    const evId = t.event || 'yok', ev = D().events[evId];
    if (ev && evId !== 'yok') {
      setText(q.event, (EVENT_ICONS[evId] || '📌') + ' ' + (EVENT_SHORT[evId] || ev.name));
      q.event.title = ev.name + ': ' + ev.desc;
      show(q.event, true);
    } else show(q.event, false);
    show(q.power, s.power === false && (s.phase === 'open' || s.phase === 'closing'));
    // para (animasyonlu sayaç — tickMoney yazar)
    if (hud.lastMoney == null) { hud.lastMoney = s.money; hud.moneyShown = s.money; setText(q.moneyVal, fmt(s.money)); }
    const dm = s.money - hud.lastMoney;
    if (Math.abs(dm) >= 1) {
      q.money.classList.remove('up', 'down'); void q.money.offsetWidth;
      q.money.classList.add(dm > 0 ? 'up' : 'down');
      q.moneyDelta.textContent = fmtSigned(dm);
      q.moneyDelta.classList.remove('go'); void q.moneyDelta.offsetWidth; q.moneyDelta.classList.add('go');
      hud.lastMoney = s.money;
    }
    setCls(q.money, 'neg', s.money < 0);
    // itibar
    const rep = clamp(s.rep || 0, 0, 5);
    setStyle(q.starsFg, 'width', (rep / 5 * 100).toFixed(1) + '%');
    setText(q.repNum, rep.toFixed(1));
    q.rep.title = 'İtibar: ' + rep.toFixed(2) + ' / 5';
    // seviye
    const lp = call(KS.levelProgress) || { cur: 0, need: 1, ratio: 0, max: false };
    setText(q.lvBadge, String(s.level));
    setStyle(q.xpFill, 'width', (lp.max ? 100 : lp.ratio * 100).toFixed(1) + '%');
    setText(q.xpText, lp.max ? 'MAKS seviye' : Math.floor(lp.cur) + ' / ' + lp.need + ' XP');
    // temizlik
    const cl = Math.round(clamp(s.cleanliness != null ? s.cleanliness : 100, 0, 100));
    setText(q.clean, '🧽 %' + cl);
    setCls(q.clean, 'warn', cl < 70 && cl >= 40); setCls(q.clean, 'bad', cl < 40);
    // teslimatlar
    const dl = s.deliveries || [];
    if (dl.length) {
      let eta = Infinity; for (const d of dl) eta = Math.min(eta, d.at ? d.at - s.time : 0);
      const txt = '🚚 ' + dl.length + ' · ' + (eta <= 0 ? (s.phase === 'open' ? 'geliyor' : 'sabah') : Math.ceil(eta) + ' dk');
      setText(q.deliv, txt); show(q.deliv, true);
    } else show(q.deliv, false);
    // butonlar
    const canPause = s.phase === 'open' || s.phase === 'closing';
    setCls(q.btns.pause, 'is-disabled', !canPause);
    setCls(q.btns.pause, 'active', !!s.paused);
    setHTML(q.btns.pause._ico, svgIco(s.paused ? 'play' : 'pause'));
    q.btns.pause.title = s.paused ? 'Devam et (P / Esc)' : 'Duraklat (P / Esc)';
    const sp = (s.speedMult || 1) >= 2 ? 2 : 1;
    setText(q.btns.speed._lab, sp + 'x'); setCls(q.btns.speed, 'active', sp === 2);
    if (q.btns.kantin) {
      const gl = (KS.Meta && KS.Meta.goals()) || [];
      const dn = gl.filter(g => g.done).length;
      const bd = q.btns.kantin._badge;
      setText(q.btns.kantin._lab, gl.length ? 'Hedefler' : 'Defter');
      setText(bd, dn + '/' + gl.length); show(bd, gl.length > 0); setCls(bd, 'done', gl.length > 0 && dn === gl.length);
      setCls(q.btns.kantin, 'goal-all', gl.length > 0 && dn === gl.length);
    }
    setHTML(q.btns.sound._ico, svgIco(settings.sound ? 'sound' : 'mute'));
    setCls(q.btns.sound, 'off', !settings.sound);
  }
  function tickMoney(dt) {
    const q = E.hudQ; if (!q || !S()) return;
    const target = S().money;
    if (hud.lastMoney == null) return;
    if (Math.abs(hud.moneyShown - target) < 0.5) { if (hud.moneyShown !== target) { hud.moneyShown = target; setText(q.moneyVal, fmt(target)); } return; }
    const diff = target - hud.moneyShown;
    hud.moneyShown += diff * Math.min(1, dt * 7) + Math.sign(diff) * Math.min(Math.abs(diff), dt * 30);
    setText(q.moneyVal, fmt(hud.moneyShown));
  }
  function resetMoney() { hud.lastMoney = null; }

  // ---------------------------------------------------------------------------
  // ANA MENÜ
  // ---------------------------------------------------------------------------
  function readSaveInfo() {
    try {
      const raw = localStorage.getItem('kantinsim_save_v1'); if (!raw) return null;
      const o = JSON.parse(raw); return { day: o.day, money: o.money, level: o.level, phase: o.phase, rep: o.rep };
    } catch (e) { return null; }
  }
  function buildMainMenu() {
    const deco = h('div', { class: 'mm-deco' },
      ['🥪', '🍟', '☕', '🌯', '🥤', '🍔', '🥯', '🧃', '🍫', '🌶️', '🫖', '🥨'].map((e, i) =>
        h('span', { style: { left: (4 + (i * 8.2) % 92) + '%', top: (10 + ((i * 37) % 75)) + '%', animationDelay: (i * -1.3) + 's', fontSize: (34 + (i % 4) * 10) + 'px' } }, e)));
    E.mmContinue = btn(['▶️ Devam Et', h('small', { class: 'mm-saveinfo' })], 'green big', () => {
      const info = readSaveInfo();
      if (!info) return;
      hideScreen();
      call(KS.game.continueGame);
      afterStateSwap();
    });
    E.mmNew = btn('🆕 Yeni Oyun', 'orange big', () => {
      if (call(KS.hasSave)) {
        confirmBox('Yeni oyun başlasın mı?', 'Mevcut kayıtlı oyunun silinecek. Bu işlem geri alınamaz.', 'Evet, sıfırdan başla', () => startNewGame(), true);
      } else startNewGame();
    });
    E.mmSound = h('button', { class: 'mm-tg', type: 'button' }, '🔊 Ses');
    E.mmSound.addEventListener('click', safe(() => { unlockAudio(); setSound(!settings.sound); sfx('click'); }));
    E.mmMusic = h('button', { class: 'mm-tg', type: 'button' }, '🎵 Müzik');
    E.mmMusic.addEventListener('click', safe(() => { unlockAudio(); setMusic(!settings.music); sfx('click'); }));
    const box = h('div', { class: 'mm-box' },
      h('div', { class: 'mm-logo' },
        h('div', { class: 'mm-badge' }, '🏫'),
        h('div', { class: 'mm-title' }, h('span', { class: 'k' }, 'Kantin'), h('span', { class: 's' }, 'Sim')),
        h('div', { class: 'mm-sub' }, 'Okul Kantini Simülasyonu')),
      h('div', { class: 'mm-btns' },
        E.mmContinue, E.mmNew,
        btn('❓ Nasıl Oynanır?', 'blue', () => openPanel('help')),
        btn('👋 Hakkımda', 'purple', () => openPanel('about')),
        btn('⚙️ Ayarlar', 'ghost light', () => openPanel('settings'))),
      h('div', { class: 'mm-tgs' }, E.mmSound, E.mmMusic));
    E.mainmenu = h('div', { id: 'ks-mainmenu', class: 'ks-screen ks-hide' }, deco, box,
      h('div', { class: 'mm-foot' }, 'Teneffüs zili çalmadan tostlar hazır olsun! 🔔'));
    return E.mainmenu;
  }
  function refreshMainMenu() {
    const info = readSaveInfo();
    const can = !!info && info.phase !== 'gameover' && !!call(KS.hasSave);
    setDisabled(E.mmContinue, !can);
    const si = E.mmContinue && E.mmContinue.querySelector('.mm-saveinfo');
    if (si) si.textContent = can ? 'Gün ' + info.day + ' · Seviye ' + (info.level || 1) + ' · ' + fmt(info.money || 0) : 'Kayıt yok';
    applySettings(false);
  }
  function startNewGame() {
    hideScreen();
    try { if (KS.deleteSave) KS.deleteSave(); } catch (e) { /* */ }
    call(KS.game.newGame);
    afterStateSwap();
  }
  function afterStateSwap() { applySettings(false); resetMoney(); tut.active = false; hideTutorial(); syncPhase(true); }

  function showScreen(name) {
    screen = name;
    if (name && E.popup) E.popup.classList.remove('show');
    if (name) { // ekran açılınca üstte kalan afiş/başarım kartları temizlenir
      if (E.ach) E.ach.classList.remove('show');
      if (E.banner) E.banner.classList.remove('show');
    }
    show(E.mainmenu, name === 'mainmenu');
    show(E.summary, name === 'summary' || name === 'gameover');
    show(E.pause, name === 'pause');
    if (name === 'mainmenu') refreshMainMenu();
    syncModal();
  }
  function hideScreen() { showScreen(null); }

  function toMainMenu() {
    save();
    const s = S();
    if (KS.game && typeof KS.game.toMenu === 'function') { call(KS.game.toMenu); }
    else {
      if (s.paused) call(KS.game.togglePause, false);
      call(KS.returnHeld);
      try { KS.hooks.forceCustomersLeave(); } catch (e) { /* */ }
      s.paused = false;
      s.phase = 'menu';
    }
    closePanel(true); hideTutorial();
    syncPhase(true);
  }

  // ---------------------------------------------------------------------------
  // HAZIRLIK KARTI
  // ---------------------------------------------------------------------------
  function prefsText(prefs) {
    if (!prefs) return '';
    const up = [], down = [];
    for (const [id, m] of Object.entries(prefs)) (m > 1 ? up : m < 1 ? down : []).push(nameOf(id).toLowerCase());
    const out = [];
    if (up.length) out.push('📈 ' + up.slice(0, 4).join(', '));
    if (down.length) out.push('📉 ' + down.slice(0, 3).join(', '));
    return out.join('   ');
  }
  function lowStockList() {
    const s = S(), I = D().ingredients, out = [], seen = new Set();
    const addIng = (id, th) => {
      if (seen.has(id) || !I[id]) return; seen.add(id);
      const n = (s.inventory && s.inventory[id]) || 0;
      if (n <= th) out.push({ name: I[id].name, n, kind: 'ing' });
    };
    for (const [rid, r] of Object.entries(D().recipes)) {
      if (!call(KS.isRecipeOnMenu, rid)) continue;
      [r.base].concat(r.required || [], r.defaults || []).forEach(id => addIng(id, 5));
      if ((r.required || []).includes('cay')) addIng('cay_yapragi', 3);
      if ((r.required || []).includes('cigkofte')) ['bulgur', 'isot', 'salca'].forEach(id => addIng(id, 1));
      if (rid === 'patates') addIng('yag', 1);
    }
    for (const [id, p] of Object.entries(D().products)) {
      if (p.group !== 'paketli' || !productUnlocked(id)) continue;
      const n = (s.products && s.products[id]) || 0;
      if (n <= 5) out.push({ name: p.name, n, kind: 'prod' });
    }
    return out.sort((a, b) => a.n - b.n);
  }
  function buildPrepCard() {
    const s = S(); if (!s || !E.prep) return;
    const t = s.today || {};
    const w = D().weathers[t.weather] || D().weathers.gunesli || { name: '', icon: '☀️' };
    const evId = t.event || 'yok', ev = D().events[evId] || D().events.yok;
    const hist = (s.history || [])[s.history.length - 1];
    const low = lowStockList();
    const hazirCount = Object.entries(D().products).filter(([id, p]) => p.group === 'hazir').reduce((a, [id]) => a + ((s.products || {})[id] || 0), 0);

    const card = h('div', { class: 'prep-card' },
      h('div', { class: 'prep-head' },
        h('div', { class: 'prep-bell' }, '🏫'),
        h('div', null,
          h('div', { class: 'prep-day' }, 'Gün ' + s.day + ' — ' + (t.weekday || '')),
          h('div', { class: 'prep-sub' }, 'Hazırlık zamanı! Kantin ' + fmtT(D().OPEN_MIN) + "'de açılıyor."))),
      h('div', { class: 'prep-tiles' },
        h('div', { class: 'prep-tile weather' },
          h('div', { class: 'pt-ico' }, w.icon),
          h('div', null, h('div', { class: 'pt-k' }, 'Hava durumu'), h('div', { class: 'pt-v' }, w.name),
            h('div', { class: 'pt-d' }, prefsText(w.prefs) || 'Talep normal'))),
        h('div', { class: 'prep-tile event' + (evId !== 'yok' ? ' special' : '') },
          h('div', { class: 'pt-ico' }, EVENT_ICONS[evId] || '📌'),
          h('div', null, h('div', { class: 'pt-k' }, 'Günün olayı'), h('div', { class: 'pt-v' }, ev.name),
            h('div', { class: 'pt-d' }, ev.desc)))),
      featuredStrip(t),
      hist ? h('div', { class: 'prep-yday' },
        h('span', null, '📊 Dün'),
        h('span', { class: hist.net >= 0 ? 'pos' : 'neg' }, 'Net ' + fmtSigned(hist.net)),
        h('span', null, '🧾 Ciro ' + fmt(hist.revenue)),
        h('span', null, '🙋 ' + hist.served + ' müşteri'),
        h('span', null, '⭐ ' + (hist.rep != null ? hist.rep.toFixed(1) : '-'))) : null,
      low.length ? h('div', { class: 'prep-low' },
        h('div', { class: 'pl-title' }, '⚠️ DÜŞÜK STOK'),
        h('div', { class: 'pl-chips' }, low.slice(0, 12).map(x => h('span', { class: 'pl-chip' + (x.n <= 0 ? ' zero' : '') }, x.name + ': ' + x.n)),
          low.length > 12 ? h('span', { class: 'pl-chip more' }, '+' + (low.length - 12)) : null))
        : h('div', { class: 'prep-ok' }, '✅ Stoklar bugün için yeterli görünüyor.'),
      hazirCount === 0 ? h('div', { class: 'prep-hint' }, '🌯 Vitrinde hazır yemek yok — 📱 Telefon ile döner, çiğ köfte, simit sipariş edebilirsin.') : null,
      prepGoalsBlock(),
      h('div', { class: 'prep-tip' }, '💡 Hazırlıkta verilen siparişler açılışta teslim edilir. Açıkken toptancı ~60 dk sürer!'),
      h('div', { class: 'prep-actions' },
        btn('📦 Malzeme', 'cream', () => openPanel('supply')),
        btn('📱 Telefon', 'cream', () => openPanel('phone')),
        btn('🍽️ Menü', 'cream', () => openPanel('menu')),
        btn('⬆️ Geliştir', 'cream', () => openPanel('upgrades')),
        btn('👥 Personel', 'cream', () => openPanel('staff')),
        btn('📣 Pazarlama', 'cream', () => openPanel('kantin', 'market')),
        btn('🏦 Banka', 'cream', () => openPanel('kantin', 'bank'))),
      btn('🔔 Kantini Aç', 'green huge prep-open', () => {
        if (S().phase !== 'prep') return;
        call(KS.game.openShop);
        syncPhase(true);
      }));
    clear(E.prep).appendChild(card);
  }
  function featuredStrip(t) {
    const id = t && t.featured;
    const r = id && D().recipes[id];
    if (!r) return null;
    const on = !!(S().menu && S().menu[id] && S().menu[id].on);
    return h('div', { class: 'prep-feat' + (on ? '' : ' off') },
      h('span', { class: 'pf-ico', 'aria-hidden': 'true' }, '⭐'),
      h('div', { class: 'pf-body' },
        h('div', { class: 'pf-k' }, 'GÜNÜN MENÜSÜ'),
        h('div', { class: 'pf-v' }, r.name),
        h('div', { class: 'pf-d' }, on ? 'Her servis +%25 ekstra bahşiş' : 'Menüde kapalı — 🍽️ Menü panelinden aç')));
  }
  function prepGoalsBlock() {
    if (!KS.Meta) return null;
    const list = KS.Meta.goals(), c = KS.Meta.campaign(), debt = KS.Meta.debt();
    return h('div', { class: 'prep-goals' },
      h('div', { class: 'pg-head' }, h('span', null, '🎯 GÜNÜN HEDEFLERİ'),
        h('span', { class: 'pg-camp' + (c ? ' on' : '') }, c ? c.icon + ' ' + c.name : '📣 Kampanya yok'),
        debt > 0 ? h('span', { class: 'pg-debt' }, '🏦 Taksit ' + fmt(KS.Meta.dailyInstallment()) + '/gün') : null),
      list.length ? list.map(g => goalRow(g, true)) : h('div', { class: 'sm-empty' }, 'Hedefler hazırlanıyor…'));
  }
  function refreshPrep() { if (S() && S().phase === 'prep' && E.prep && !E.prep.classList.contains('ks-hide')) buildPrepCard(); }

  // ---------------------------------------------------------------------------
  // PANEL: MALZEME SİPARİŞİ
  // ---------------------------------------------------------------------------
  const supplyState = { tab: 'toptanci', carts: {} };
  PANELS.supply = {
    title: 'Malzeme Siparişi', icon: '📦', width: 1200,
    build(p, arg, re) {
      if (arg && D().suppliers[arg] && !re) supplyState.tab = arg;
      const tabs = Object.entries(D().suppliers).filter(([, s]) => s.kind === 'toptan' || s.kind === 'bakkal')
        .map(([id, s]) => ({ id, label: (s.icon || '📦') + ' ' + s.name }));
      if (!tabs.find(t => t.id === supplyState.tab)) supplyState.tab = tabs[0] ? tabs[0].id : 'toptanci';
      p.setTabs(tabs, supplyState.tab, id => { supplyState.tab = id; renderSupply(p); });
      renderSupply(p);
    },
  };
  function renderSupply(p) {
    const supId = supplyState.tab, sup = D().suppliers[supId]; if (!sup) return;
    const mult = sup.mult || 1;
    const cart = supplyState.carts[supId] = supplyState.carts[supId] || {};
    const moneyChip = p.moneyChip();
    const prep = S().phase === 'prep';
    clear(p.body);
    p.body.appendChild(h('div', { class: 'sup-intro' },
      h('span', { class: 'si-ico' }, sup.icon || '📦'),
      h('div', null, h('b', null, sup.name), h('div', null, sup.desc || '')),
      h('div', { class: 'si-meta' },
        h('span', null, '🚚 Nakliye: ' + (sup.fee ? fmt(sup.fee) : 'Ücretsiz')),
        h('span', null, '⏱ ' + (prep ? 'Açılışta teslim' : '~' + sup.eta + ' dk')),
        mult !== 1 ? h('span', { class: 'si-mult' }, 'Fiyatlar ×' + mult.toFixed(2).replace('.', ',')) : h('span', { class: 'si-mult good' }, 'Toptan fiyat'))));
    const rows = [];
    const mkRow = (key, kind, id, name, note, lockNote, pack, packPrice, stockFn, locked) => {
      const stockEl = h('b');
      const totEl = h('span', { class: 'sr-tot' });
      const stp = stepper({
        value: cart[key] || 0, min: 0, max: 99,
        onChange: v => { if (v) cart[key] = v; else delete cart[key]; upd(); updFoot(); },
      });
      const row = h('div', { class: 'sup-row' + (lockNote ? ' lock-info' : '') + (locked ? ' locked' : '') },
        kind === 'ing' ? ingIcon(id, 46) : prodIcon(id, 46),
        h('div', { class: 'sr-name' }, h('b', null, name),
          lockNote ? h('small', { class: 'sr-lock' }, lockNote) : note ? h('small', null, note) : null),
        h('div', { class: 'sr-stock' }, h('small', null, 'Stok'), stockEl),
        h('div', { class: 'sr-pack' }, h('b', null, fmt(packPrice)), h('small', null, packLabel(pack))),
        h('div', { class: 'sr-step' }, locked ? h('span', { class: 'sr-locked' }, '🔒 Seviye ' + locked) : stp.el, totEl));
      function upd() {
        const n = stockFn();
        stockEl.textContent = n;
        stockEl.className = n <= 0 ? 'zero' : n <= 5 ? 'low' : '';
        const q = cart[key] || 0;
        totEl.textContent = q ? '= ' + fmt(q * packPrice) : '';
        row.classList.toggle('in-cart', q > 0);
      }
      upd();
      rows.push({ key, kind, id, pack, packPrice, upd, stp });
      return row;
    };
    for (const g of ingGroups()) {
      const grid = h('div', { class: 'sup-grid' });
      for (const id of g.ids) {
        const ing = D().ingredients[id];
        const pack = ing.pack || 1, price = Math.round((ing.cost || 0) * pack * mult);
        const note = ing.note || (ing.perish > 0.2 ? '⏳ Çabuk bozulur' : ing.perish > 0 ? null : '♾️ Bozulmaz');
        grid.appendChild(mkRow('i:' + id, 'ing', id, ing.name, note, ingLockNote(id), pack, price, () => (S().inventory || {})[id] || 0));
      }
      p.body.appendChild(h('div', { class: 'sup-group' }, h('div', { class: 'sg-title' }, g.label), grid));
    }
    const prods = Object.entries(D().products).filter(([, pr]) => pr.group === 'paketli');
    if (prods.length) {
      const grid = h('div', { class: 'sup-grid' });
      for (const [id, pr] of prods) {
        const pack = pr.pack || 1, price = Math.round((pr.buy || 0) * pack * mult);
        const locked = productUnlocked(id) ? 0 : pr.unlock;
        grid.appendChild(mkRow('p:' + id, 'prod', id, pr.name, 'Satış: ' + fmt((S().prices || {})[id] || pr.price) + ' / adet', null, pack, price,
          () => (S().products || {})[id] || 0, locked));
      }
      p.body.appendChild(h('div', { class: 'sup-group' }, h('div', { class: 'sg-title' }, '🥤 Paketli Ürünler (vitrin)'), grid));
    }
    // alt bilgi
    const subEl = h('b'), feeEl = h('b'), totEl = h('b', { class: 'tot' }), cntEl = h('span', { class: 'sf-cnt' });
    const orderBtn = btn('🛒 Sipariş Ver', 'green big', () => doOrder());
    const clearBtn = btn('🗑️ Temizle', 'ghost', () => { for (const k in cart) delete cart[k]; rows.forEach(r => { r.stp.set(0); r.upd(); }); updFoot(); });
    p.setFoot(
      h('div', { class: 'sf-sum' },
        cntEl,
        h('span', null, 'Ara toplam: ', subEl),
        h('span', null, 'Nakliye: ', feeEl),
        h('span', { class: 'sf-total' }, 'Toplam: ', totEl),
        h('span', { class: 'sf-eta' }, prep ? '⏱ Açılışta teslim' : '⏱ ~' + sup.eta + ' dk')),
      h('div', { class: 'sf-btns' }, clearBtn, orderBtn));
    function totals() {
      let sub = 0, packs = 0;
      for (const r of rows) { const q = cart[r.key] || 0; sub += q * r.packPrice; packs += q; }
      return { sub, packs, fee: packs ? (sup.fee || 0) : 0 };
    }
    function updFoot() {
      const t = totals(), total = t.sub + t.fee;
      subEl.textContent = fmt(t.sub); feeEl.textContent = t.packs ? (t.fee ? fmt(t.fee) : 'Ücretsiz') : '-';
      totEl.textContent = fmt(total);
      cntEl.textContent = t.packs ? '🛒 ' + t.packs + ' paket' : '🛒 Sepet boş';
      const poor = total > S().money;
      setDisabled(orderBtn, !t.packs || poor);
      orderBtn.classList.toggle('red', poor && t.packs > 0);
      orderBtn.classList.toggle('green', !(poor && t.packs > 0));
      orderBtn.firstChild.textContent = poor && t.packs ? '💸 Bakiye yetersiz' : '🛒 Sipariş Ver';
      totEl.classList.toggle('neg', poor);
      moneyChip.querySelector('b').textContent = fmt(S().money);
    }
    function doOrder() {
      const t = totals(); if (!t.packs) return;
      const inv = {}, prod = {};
      for (const r of rows) {
        const q = cart[r.key] || 0; if (!q) continue;
        if (r.kind === 'ing') inv[r.id] = (inv[r.id] || 0) + q * r.pack; else prod[r.id] = (prod[r.id] || 0) + q * r.pack;
      }
      const wasPrep = S().phase === 'prep';
      const res = call(KS.placeOrder, { supplier: supId, inv, prod, cost: t.sub }) || { ok: false, msg: 'Sipariş verilemedi' };
      if (!res.ok) { sfx('error'); notify('Sipariş verilemedi: ' + (res.msg || ''), 'bad'); return; }
      if (!wasPrep) notify((sup.icon || '🚚') + ' Sipariş yolda! ~' + sup.eta + ' dk içinde gelir (' + fmt(res.total) + ')', 'good');
      for (const k in cart) delete cart[k];
      rows.forEach(r => { r.stp.set(0); r.upd(); });
      updFoot();
      confettiAt(orderBtn, 18);
      sfx('coin');
    }
    updFoot();
  }

  // ---------------------------------------------------------------------------
  // PANEL: TELEFON (hazır yemek siparişi)
  // ---------------------------------------------------------------------------
  const phoneState = { tab: 'shops', carts: {} };
  PANELS.phone = {
    title: 'Lezzet Kapında', icon: '🛵', width: 440, cls: 'phone',
    build(p) {
      p.panel.classList.add('phone');
      clear(p.headExtra);
      // telefon durum çubuğu
      if (!p._status) {
        p._status = h('div', { class: 'ph-status' }, h('span', { class: 'ph-time' }), h('span', { class: 'ph-notch' }), h('span', null, '📶 🔋'));
        p.panel.insertBefore(p._status, p.head);
      }
      p._status.querySelector('.ph-time').textContent = fmtT(S().time);
      const n = (S().deliveries || []).length;
      p.setTabs([{ id: 'shops', label: '🍽️ Restoranlar' }, { id: 'orders', label: '🛵 Siparişlerim', badge: n ? String(n) : null }], phoneState.tab, t => { phoneState.tab = t; renderPhone(p); });
      renderPhone(p);
    },
  };
  function renderPhone(p) {
    clear(p.body); p.setFoot();
    const s = S(), prep = s.phase === 'prep';
    p.body.appendChild(h('div', { class: 'ph-wallet' }, h('span', null, '💳 Bakiye'), h('b', null, fmt(s.money))));
    if (phoneState.tab === 'orders') {
      const dl = (s.deliveries || []).slice().sort((a, b) => a.at - b.at);
      if (!dl.length) { p.body.appendChild(h('div', { class: 'pn-empty' }, h('div', { class: 'big' }, '🛵'), 'Yolda sipariş yok.', h('small', null, prep ? 'Hazırlıkta verilen siparişler hemen teslim edilir.' : 'Restoranlardan sipariş verebilirsin.'))); return; }
      for (const d of dl) {
        const sup = D().suppliers[d.supplier] || { name: d.supplier, icon: '📦', eta: 30 };
        const items = Object.entries(d.prod || {}).map(([id, q]) => nameOf(id) + ' ×' + q)
          .concat(Object.entries(d.inv || {}).map(([id, q]) => nameOf(id) + ' ×' + q));
        const remain = d.at ? Math.max(0, Math.ceil(d.at - s.time)) : 0;
        const span = Math.max(1, (d.at || 0) - (d.placedAt || 0));
        const ratio = d.at ? clamp(1 - remain / span, 0, 1) : 1;
        p.body.appendChild(h('div', { class: 'ph-order' },
          h('div', { class: 'po-top' }, h('span', { class: 'po-ico' }, sup.icon || '📦'), h('b', null, sup.name),
            h('span', { class: 'po-eta' }, d.at ? (remain > 0 ? '~' + remain + ' dk' : 'Kapıda!') : 'Yarın sabah')),
          h('div', { class: 'po-items' }, items.join(', ')),
          h('div', { class: 'po-bar' }, h('i', { style: { width: (ratio * 100).toFixed(0) + '%' } }), h('span', { class: 'po-scooter', style: { left: (ratio * 100).toFixed(0) + '%' } }, '🛵'))));
      }
      return;
    }
    p.body.appendChild(h('div', { class: 'ph-warn' }, '⚠️ Hazır yemekler gün sonunda bozulur! İhtiyacın kadar sipariş ver.'));
    const shops = Object.entries(D().suppliers).filter(([, sp]) => sp.kind === 'restoran');
    for (const [supId, sup] of shops) {
      const locked = (sup.unlock || 1) > lvl();
      const cart = phoneState.carts[supId] = phoneState.carts[supId] || {};
      const mult = sup.mult || 1;
      const card = h('div', { class: 'ph-shop' + (locked ? ' locked' : '') });
      card.appendChild(h('div', { class: 'ps-head' },
        h('div', { class: 'ps-logo' }, sup.icon || '🍽️'),
        h('div', { class: 'ps-info' }, h('b', null, sup.name), h('small', null, sup.desc || ''),
          h('div', { class: 'ps-meta' },
            h('span', null, '⏱ ~' + sup.eta + ' dk'),
            h('span', null, '🛵 ' + (sup.fee ? fmt(sup.fee) : 'Ücretsiz')),
            h('span', null, 'Min. ' + fmt(sup.minOrder || 0)))),
        locked ? h('div', { class: 'ps-lock' }, '🔒', h('small', null, 'Seviye ' + sup.unlock)) : h('div', { class: 'ps-rate' }, '★ ' + (4.2 + ((supId.length * 7) % 7) / 10).toFixed(1))));
      if (!locked) {
        const lines = [];
        const btnOrder = btn('Sepete ekle', 'orange small ps-order', () => order());
        const subEl = h('span', { class: 'ps-sub' });
        for (const pid of sup.items || []) {
          const pr = D().products[pid]; if (!pr) continue;
          const pack = pr.pack || 1, packPrice = Math.round((pr.buy || 0) * pack * mult);
          const sell = (s.prices || {})[pid] || pr.price;
          const margin = sell - (pr.buy || 0) * mult;
          const plocked = !productUnlocked(pid);
          const stp = stepper({ value: cart[pid] || 0, min: 0, max: 30, onChange: v => { if (v) cart[pid] = v; else delete cart[pid]; upd(); } });
          lines.push({ pid, pack, packPrice });
          card.appendChild(h('div', { class: 'ps-item' + (plocked ? ' locked' : '') },
            prodIcon(pid, 44),
            h('div', { class: 'pi-name' }, h('b', null, pr.name + (pack > 1 ? ' (' + pack + "'" + numSuffix(pack) + ')' : '')),
              h('small', null, 'Alış ' + fmt(packPrice) + ' · Satış ' + fmt(sell) + (pack > 1 ? '/adet' : '')),
              h('small', { class: margin >= 0 ? 'pi-margin' : 'pi-margin neg' }, 'Kâr ' + fmtSigned(margin) + ' /adet · Stok ' + ((s.products || {})[pid] || 0))),
            plocked ? h('span', { class: 'sr-locked' }, '🔒 Sv. ' + pr.unlock) : stp.el));
        }
        card.appendChild(h('div', { class: 'ps-foot' }, subEl, btnOrder));
        const upd = () => {
          let sub = 0; for (const l of lines) sub += (cart[l.pid] || 0) * l.packPrice;
          const total = sub + (sup.fee || 0);
          const under = sub < (sup.minOrder || 0), poor = total > s.money;
          subEl.textContent = sub ? 'Sepet ' + fmt(sub) + (sup.fee ? ' + 🛵 ' + fmt(sup.fee) : '') : 'Sepet boş';
          setDisabled(btnOrder, !sub || under || poor);
          btnOrder.firstChild.textContent = !sub ? 'Sipariş Ver' : under ? 'Min. ' + fmt(sup.minOrder) : poor ? 'Bakiye yetersiz' : 'Sipariş Ver · ' + fmt(total);
          btnOrder.classList.toggle('red', !!sub && poor);
          card.classList.toggle('has-cart', sub > 0);
        };
        const order = () => {
          let sub = 0; const prod = {};
          for (const l of lines) { const q = cart[l.pid] || 0; if (q) { sub += q * l.packPrice; prod[l.pid] = q * l.pack; } }
          if (!sub) return;
          const wasPrep = S().phase === 'prep';
          const res = call(KS.placeOrder, { supplier: supId, inv: {}, prod, cost: sub }) || { ok: false };
          if (!res.ok) { sfx('error'); notify('Sipariş verilemedi: ' + (res.msg || ''), 'bad'); return; }
          if (!wasPrep) notify('🛵 ' + sup.name + ': sipariş alındı! ~' + sup.eta + ' dk', 'good');
          for (const k in cart) delete cart[k];
          confettiAt(btnOrder, 14);
          const keep = p.body.scrollTop;
          PANELS.phone.build(p); p.body.scrollTop = keep;
        };
        upd();
      }
      p.body.appendChild(card);
    }
  }

  // ---------------------------------------------------------------------------
  // PANEL: MENÜ & FİYAT
  // ---------------------------------------------------------------------------
  PANELS.menu = {
    title: 'Menü & Fiyatlar', icon: '🍽️', width: 1120,
    build(p) {
      clear(p.body); clear(p.headExtra);
      const s = S();
      p.body.appendChild(h('div', { class: 'mn-hint' }, '💡 Fiyatı önerilenin %50 – %200 arasında ayarlayabilirsin. Pahalı ürün daha az satar, ucuz ürün itibar kazandırır ama kâr düşer.'));
      const sec1 = h('div', { class: 'mn-grid' });
      for (const [rid, r] of Object.entries(D().recipes)) {
        const unlocked = recipeUnlocked(rid);
        const isFeat = rid === call(KS.featuredId);
        const m = s.menu[rid] = s.menu[rid] || { on: false, price: r.price };
        const cost = recipeCost(rid);
        const badge = h('span', { class: 'mn-badge' }), marg = h('div', { class: 'mn-marg' });
        const updInfo = () => {
          const ratio = (m.price || r.price) / r.price, pc = perception(ratio);
          badge.className = 'mn-badge ' + pc.cls; badge.textContent = pc.label;
          const prof = m.price - cost;
          marg.innerHTML = 'Maliyet ~<b>' + esc(fmt(cost)) + '</b> · Kâr <b class="' + (prof >= 0 ? 'pos' : 'neg') + '">' + esc(fmtSigned(prof)) + '</b>' +
            (m.price > 0 ? ' <span class="pct">(%' + Math.round(prof / m.price * 100) + ')</span>' : '');
        };
        const minP = Math.max(5, Math.ceil(r.price * 0.5)), maxP = Math.round(r.price * 2);
        const stp = stepper({ value: m.price, min: minP, max: maxP, step: 5, cls: 'price', fmt: fmt, onChange: v => { m.price = v; updInfo(); } });
        const row = h('div', { class: 'mn-row' + (unlocked ? '' : ' locked') + (unlocked && !m.on ? ' off' : '') },
          dishIcon(rid, 72, 60, 0.62),
          h('div', { class: 'mn-name' }, h('b', null, r.name), isFeat ? h('span', { class: 'mn-feat' }, '⭐ Günün menüsü') : null, h('small', null, '⏱ ' + (r.time || '') + ' · Önerilen ' + fmt(r.price))),
          unlocked ? toggle(m.on, on => { m.on = on; row.classList.toggle('off', !on); }, ['Menüde', 'Kapalı']) : h('div', { class: 'mn-lock' }, '🔒 Seviye ' + r.unlock),
          h('div', { class: 'mn-price' }, unlocked ? stp.el : h('b', null, fmt(r.price)), unlocked ? badge : null),
          unlocked ? marg : h('div', { class: 'mn-marg' }, 'Seviye ' + r.unlock + ' gerekli'));
        updInfo();
        sec1.appendChild(row);
      }
      p.body.appendChild(h('div', { class: 'sg-title' }, '👩‍🍳 Tarifler (elle hazırlanan)'));
      p.body.appendChild(sec1);
      const groups = [['paketli', '🥤 Paketli Ürünler'], ['hazir', '🌯 Hazır Yemekler (dışarıdan)']];
      for (const [g, label] of groups) {
        const grid = h('div', { class: 'mn-grid' });
        for (const [pid, pr] of Object.entries(D().products)) {
          if (pr.group !== g) continue;
          const unlocked = productUnlocked(pid);
          s.prices[pid] = s.prices[pid] || pr.price;
          const badge = h('span', { class: 'mn-badge' }), marg = h('div', { class: 'mn-marg' });
          const updInfo = () => {
            const price = s.prices[pid], pc = perception(price / pr.price);
            badge.className = 'mn-badge ' + pc.cls; badge.textContent = pc.label;
            const prof = price - (pr.buy || 0);
            marg.innerHTML = 'Alış <b>' + esc(fmt(pr.buy || 0)) + '</b> · Kâr <b class="' + (prof >= 0 ? 'pos' : 'neg') + '">' + esc(fmtSigned(prof)) + '</b> · Stok <b>' + ((s.products || {})[pid] || 0) + '</b>';
          };
          const stp = stepper({ value: s.prices[pid], min: Math.max(5, Math.ceil(pr.price * 0.5)), max: Math.round(pr.price * 2), step: 5, cls: 'price', fmt: fmt, onChange: v => { s.prices[pid] = v; updInfo(); } });
          grid.appendChild(h('div', { class: 'mn-row prod' + (unlocked ? '' : ' locked') },
            prodIcon(pid, 54),
            h('div', { class: 'mn-name' }, h('b', null, pr.name), h('small', null, 'Önerilen ' + fmt(pr.price))),
            unlocked ? h('div', { class: 'mn-sp' }) : h('div', { class: 'mn-lock' }, '🔒 Seviye ' + pr.unlock),
            h('div', { class: 'mn-price' }, unlocked ? stp.el : h('b', null, fmt(pr.price)), unlocked ? badge : null),
            marg));
          updInfo();
        }
        p.body.appendChild(h('div', { class: 'sg-title' }, label));
        p.body.appendChild(grid);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // PANEL: GELİŞTİRMELER
  // ---------------------------------------------------------------------------
  const pctD = v => (v >= 1 ? '+' : '−') + '%' + Math.round(Math.abs(v - 1) * 100);
  const FIELD_FMT = {
    slots: ['Slot', v => v],
    speed: ['Hız', v => '×' + String(v).replace('.', ',')],
    baskets: ['Sepet', v => v],
    glasses: ['Bardak / demlik', v => v],
    brewTime: ['Demlenme', v => v + ' sn'],
    plates: ['Tabak', v => v],
    keepWarm: ['Sıcak tutma', v => (v ? 'Var' : 'Yok')],
    batch: ['Parti', v => v + ' porsiyon'],
    effort: ['Yoğurma eforu', v => '%' + Math.round(v * 100)],
    perishMult: ['Bozulma', v => '%' + Math.round(v * 100)],
    payTime: ['Ödeme süresi', v => String(v).replace('.', ',') + ' sn'],
    demand: ['Talep', v => pctD(v)],
    patience: ['Sabır', v => pctD(v)],
  };
  function upgradeEffects(cur, next) {
    const out = [];
    for (const k of Object.keys(next)) {
      if (k === 'name' || k === 'cost') continue;
      const f = FIELD_FMT[k] || [k, v => v];
      if (cur && cur[k] === next[k]) continue;
      out.push(f[0] + ': ' + (cur && cur[k] != null ? f[1](cur[k]) + ' → ' : '') + f[1](next[k]));
    }
    return out;
  }
  PANELS.upgrades = {
    title: 'Geliştirmeler', icon: '⬆️', width: 1160,
    build(p) {
      clear(p.body); const chip = p.moneyChip();
      const grid = h('div', { class: 'up-grid' });
      for (const [id, u] of Object.entries(D().upgrades)) {
        const lv = KS.upg ? KS.upg(id) : (S().upgrades[id] || 0);
        const L = u.levels || [], cur = L[lv], next = L[lv + 1];
        const maxed = !next;
        const card = h('div', { class: 'up-card' + (maxed ? ' maxed' : '') },
          h('div', { class: 'uc-top' },
            h('div', { class: 'uc-ico' }, UPG_ICONS[id] || '🔧'),
            h('div', { class: 'uc-ttl' }, h('b', null, u.name), h('small', null, cur ? cur.name : '')),
            h('div', { class: 'uc-dots' }, L.map((_, i) => h('i', { class: i <= lv ? 'on' : '' })))),
          maxed
            ? h('div', { class: 'uc-next max' }, h('div', { class: 'un-name' }, '🏆 En üst seviye'), h('div', { class: 'un-fx' }, 'Bu ekipman tamamen geliştirildi.'))
            : h('div', { class: 'uc-next' }, h('div', { class: 'un-name' }, '➜ ' + next.name),
              h('ul', { class: 'un-fx' }, upgradeEffects(cur, next).map(t => h('li', null, t)))));
        if (maxed) card.appendChild(h('div', { class: 'uc-buy max' }, 'MAKS'));
        else {
          const poor = S().money < next.cost;
          const b = btn(['Satın Al', h('span', { class: 'ub-price' }, fmt(next.cost))], (poor ? 'red' : 'orange') + ' uc-buy', () => {
            if (S().money < next.cost) { notify('Yetersiz bakiye: ' + fmt(next.cost) + ' gerekli', 'bad'); return; }
            const ok = call(KS.buyUpgrade, id);
            if (ok) {
              confettiAt(b, 40);
              notify('⬆️ ' + next.name + ' kuruldu!', 'good');
              rerenderPanel();
            } else { sfx('error'); notify('Geliştirme satın alınamadı.', 'bad'); }
          });
          if (poor) setDisabled(b, true);
          card.appendChild(b);
        }
        grid.appendChild(card);
      }
      p.body.appendChild(grid);
      p.body.appendChild(h('div', { class: 'mn-hint' }, '💡 Her geliştirme seviyesi günlük faturaya +' + fmt(D().costs.utilityPerUpgrade || 0) + ' ekler.'));
      chip.querySelector('b').textContent = fmt(S().money);
    },
  };

  // ---------------------------------------------------------------------------
  // PANEL: PERSONEL
  // ---------------------------------------------------------------------------
  PANELS.staff = {
    title: 'Personel', icon: '👥', width: 960,
    build(p) {
      clear(p.body); p.moneyChip();
      p.body.appendChild(h('div', { class: 'mn-hint' }, '💡 Yevmiyeler gün sonunda ödenir. İşe aldığın personel ertesi günlerde de çalışmaya devam eder.'));
      const grid = h('div', { class: 'st-grid' });
      for (const [id, st] of Object.entries(D().staff)) {
        const locked = (st.unlock || 1) > lvl();
        const hired = KS.hasStaff ? KS.hasStaff(id) : !!S().staff[id];
        const card = h('div', { class: 'st-card' + (hired ? ' hired' : '') + (locked ? ' locked' : '') },
          h('div', { class: 'stc-av' }, STAFF_ICONS[id] || '🙂', hired ? h('span', { class: 'stc-on' }, '✓') : null),
          h('b', { class: 'stc-name' }, st.name),
          h('div', { class: 'stc-wage' }, '💵 ' + fmt(st.wage) + ' / gün'),
          h('div', { class: 'stc-desc' }, st.desc || ''),
          locked ? h('div', { class: 'stc-lock' }, '🔒 Seviye ' + st.unlock + ' gerekli')
            : btn(hired ? 'İşten Çıkar' : 'İşe Al', hired ? 'ghost' : 'green', (ev, b) => {
              call(KS.setStaff, id, !hired);
              if (!hired) { confettiAt(b, 24); notify('👋 ' + st.name + ' ekibe katıldı!', 'good'); }
              else notify(st.name + ' işten ayrıldı.', 'info');
              rerenderPanel();
            }));
        grid.appendChild(card);
      }
      p.body.appendChild(grid);
      const daily = Object.entries(S().staff || {}).filter(([, on]) => on).reduce((a, [id]) => a + ((D().staff[id] || {}).wage || 0), 0);
      p.setFoot(h('div', { class: 'sf-sum' }, h('span', null, 'Günlük personel gideri: ', h('b', null, fmt(daily))),
        h('span', null, 'Kira: ', h('b', null, fmt(D().costs.rent || 0)))));
    },
  };

  // ---------------------------------------------------------------------------
  // PANEL: KANTİN DEFTERİ (hedefler, başarımlar, istatistik, pazarlama, banka)
  // ---------------------------------------------------------------------------
  const M = () => KS.Meta;
  const hubState = { tab: 'goals' };
  const HUB_TABS = [
    { id: 'goals', label: '🎯 Günlük Hedefler' }, { id: 'ach', label: '🏆 Başarımlar' }, { id: 'stats', label: '📊 İstatistik' },
    { id: 'market', label: '📣 Pazarlama' }, { id: 'bank', label: '🏦 Banka' },
  ];
  PANELS.kantin = {
    title: 'Kantin Defteri', icon: '📒', width: 1120, cls: 'hub',
    build(p, arg, re) {
      if (arg && HUB_TABS.some(t => t.id === arg) && !re) hubState.tab = arg;
      const achN = M() ? M().achievements().filter(a => M().isUnlocked(a.id)).length : 0;
      const tabs = HUB_TABS.map(t => t.id === 'ach' && M() ? Object.assign({}, t, { badge: achN + '/' + M().achievements().length }) : t);
      p.setTabs(tabs, hubState.tab, id => { hubState.tab = id; renderHub(p); });
      renderHub(p);
    },
  };
  function bar(ratio, cls) { return h('div', { class: 'hb-bar ' + (cls || '') }, h('i', { style: { width: (clamp(ratio, 0, 1) * 100).toFixed(1) + '%' } })); }
  function renderHub(p) {
    clear(p.body); p.setFoot(); p.moneyChip();
    if (!M()) { p.body.appendChild(h('div', { class: 'pn-empty' }, 'Kantin defteri yüklenemedi.')); return; }
    const f = { goals: hubGoals, ach: hubAch, stats: hubStats, market: hubMarket, bank: hubBank }[hubState.tab] || hubGoals;
    try { f(p); } catch (e) { console.error('[ui hub]', e); p.body.appendChild(h('div', { class: 'pn-empty' }, 'Bu bölüm açılamadı.')); }
  }
  function goalRow(g, compact) {
    const pr = M().goalProgress(g);
    const isMoney = g.kind === 'revenue' || g.kind === 'tips';
    const num = v => (isMoney ? fmt(v) : g.kind === 'clean' ? '%' + Math.round(v) : String(Math.floor(v)));
    const state = g.done ? 'done' : g.failed ? 'failed' : '';
    return h('div', { class: 'gl-row ' + state + (compact ? ' compact' : '') },
      h('div', { class: 'gl-ico' }, g.done ? '✅' : g.failed ? '❌' : g.icon),
      h('div', { class: 'gl-main' },
        h('div', { class: 'gl-text' }, g.text),
        compact ? null : h('div', { class: 'gl-prog' }, bar(pr.ratio, state), h('small', null, g.endOnly && !g.done && !g.failed ? 'Gün sonunda kontrol edilir' : num(pr.cur) + ' / ' + num(pr.target)))),
      h('div', { class: 'gl-rew' }, h('b', null, '+' + fmt(g.reward.money)), h('small', null, '+' + g.reward.xp + ' XP')));
  }
  function hubGoals(p) {
    const list = M().goals();
    p.body.appendChild(h('div', { class: 'mn-hint' }, '🎯 Her sabah 3 yeni hedef gelir. Tamamladığın anda ödül kasana eklenir. Toplam tamamlanan hedef: ', h('b', null, String(S().goalsDone || 0))));
    if (!list.length) { p.body.appendChild(h('div', { class: 'pn-empty' }, 'Bugünün hedefleri hazırlık aşamasında belirlenir.')); return; }
    p.body.appendChild(h('div', { class: 'gl-list' }, list.map(g => goalRow(g))));
    const done = list.filter(g => g.done).length;
    p.setFoot(h('div', { class: 'sf-sum' }, h('span', null, 'Bugün: ', h('b', null, done + ' / ' + list.length + ' hedef')),
      h('span', null, 'Kalan ödül: ', h('b', null, fmt(list.filter(g => !g.done && !g.failed).reduce((a, g) => a + g.reward.money, 0))))));
  }
  function hubAch(p) {
    const all = M().achievements();
    const un = all.filter(a => M().isUnlocked(a.id));
    p.body.appendChild(h('div', { class: 'ach-head' },
      h('div', { class: 'ach-count' }, h('b', null, un.length), ' / ' + all.length),
      h('div', { class: 'ach-hbar' }, bar(un.length / all.length, 'gold')),
      h('small', null, 'Başarımlar XP ve para ödülü kazandırır.')));
    const sorted = all.slice().sort((a, b) => (M().isUnlocked(b.id) - M().isUnlocked(a.id)) || (M().achProgress(b).ratio - M().achProgress(a).ratio));
    p.body.appendChild(h('div', { class: 'ach-grid' }, sorted.map(a => {
      const ok = M().isUnlocked(a.id), pr = M().achProgress(a);
      const rew = [a.xp ? '+' + a.xp + ' XP' : null, a.money ? '+' + fmt(a.money) : null].filter(Boolean).join(' · ');
      const fmtN = v => (v >= 1000 ? Math.floor(v).toLocaleString('tr-TR') : String(Math.round(v * 10) / 10).replace('.', ','));
      return h('div', { class: 'ach-card' + (ok ? ' on' : '') },
        h('div', { class: 'ac-ico' }, a.icon),
        h('div', { class: 'ac-main' },
          h('b', null, a.name), h('small', null, a.desc),
          ok ? h('div', { class: 'ac-done' }, '✔ Gün ' + S().achievements[a.id] + "'de kazanıldı") :
            h('div', { class: 'ac-prog' }, bar(pr.ratio), h('span', null, fmtN(pr.cur) + ' / ' + fmtN(pr.target)))),
        h('div', { class: 'ac-rew' }, rew));
    })));
  }
  function hubStats(p) {
    const s = S(), tot = (s.stats && s.stats.total) || {}, L = (M().lifeStats && M().lifeStats()) || {};
    const hist = (s.history || []).slice(-20);
    const tile = (ico, label, val) => h('div', { class: 'stt-tile' }, h('span', null, ico), h('b', null, val), h('small', null, label));
    const curServed = (s.today && (s.phase === 'open' || s.phase === 'closing')) ? (s.today.served || 0) : 0;
    p.body.appendChild(h('div', { class: 'stt-tiles' },
      tile('📅', 'Tamamlanan gün', String(tot.days || 0)),
      tile('🧾', 'Toplam ciro', fmt(tot.revenue || 0)),
      tile('🪙', 'Toplam bahşiş', fmt(tot.tips || 0)),
      tile('🙋', 'Servis edilen', String((tot.served || 0) + curServed)),
      tile('🤩', 'Mükemmel servis', String(L.perfect || 0)),
      tile('🏃', 'Kaçan müşteri', String(tot.lost || 0))));
    // grafikler
    const charts = h('div', { class: 'stt-charts' });
    if (hist.length >= 1) {
      charts.appendChild(chartBox('💹 Günlük net kâr (son ' + hist.length + ' gün)', barChart(hist, x => x.net || 0, fmtSigned, true)));
      charts.appendChild(chartBox('🙋 Günlük müşteri', barChart(hist, x => x.served || 0, v => v + ' müşteri', false)));
      charts.appendChild(chartBox('⭐ İtibar', lineChart(hist, x => x.rep || 0, 0, 5, v => v.toFixed(2) + ' ★')));
      charts.appendChild(chartBox('🧾 Günlük ciro', barChart(hist, x => x.revenue || 0, fmt, false)));
    } else charts.appendChild(h('div', { class: 'pn-empty' }, '📈 İlk günü bitirdiğinde grafikler burada görünecek.'));
    p.body.appendChild(charts);
    // rekorlar + çok satanlar
    const recs = h('div', { class: 'sm-box' }, h('div', { class: 'sm-h' }, '🏅 Rekorlar'),
      [['📈 En kârlı gün', fmt(L.bestNet || 0)], ['🧾 En yüksek ciro', fmt(L.bestRevenue || 0)], ['🙋 En çok müşteri', String(L.bestServed || 0)],
        ['🪙 En çok bahşiş', fmt(L.bestTips || 0)], ['💎 Kusursuz gün', String(L.flawlessDays || 0)], ['🫖 Toplu sipariş', String(L.bulk || 0)],
        ['👑 Müdür memnuniyeti', String(L.vipHappy || 0)], ['🗑️ Çöpe giden', String(L.trashed || 0)]]
        .map(([k, v]) => h('div', { class: 'sm-row' }, h('span', null, k), h('b', null, v))));
    const sales = Object.entries((s.stats && s.stats.sales) || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxS = sales.length ? sales[0][1] : 1;
    const best = h('div', { class: 'sm-box' }, h('div', { class: 'sm-h' }, '🏆 Tüm zamanların en çok satanları'),
      sales.length ? sales.map(([id, n], i) => h('div', { class: 'sm-sale' },
        h('span', { class: 'ss-rank' }, ['🥇', '🥈', '🥉'][i] || (i + 1) + '.'), h('span', { class: 'ss-name' }, nameOf(id)),
        h('div', { class: 'ss-bar' }, h('i', { style: { width: (n / maxS * 100).toFixed(0) + '%' } })), h('b', null, '×' + n)))
        : h('div', { class: 'sm-empty' }, 'Henüz satış kaydı yok.'));
    p.body.appendChild(h('div', { class: 'stt-cols' }, recs, best));
  }
  function chartBox(title, el) { return h('div', { class: 'ch-box' }, h('div', { class: 'ch-title' }, title), el); }
  // Basit çubuk grafik (tek seri; negatif değerler kırmızı, sıfır çizgisi ortada)
  function barChart(hist, get, f, signed) {
    const vals = hist.map(get);
    const max = Math.max(1, ...vals.map(v => Math.abs(v)));
    const hasNeg = signed && vals.some(v => v < 0);
    const wrap = h('div', { class: 'ch-bars' + (hasNeg ? ' signed' : '') });
    hist.forEach((x, i) => {
      const v = vals[i], hpx = Math.max(2, Math.abs(v) / max * (hasNeg ? 58 : 116));
      const col = h('div', { class: 'ch-col', title: 'Gün ' + x.day + ': ' + f(v) },
        h('div', { class: 'ch-pos' }, v >= 0 ? h('i', { class: 'pos', style: { height: hpx + 'px' } }) : null),
        hasNeg ? h('div', { class: 'ch-neg' }, v < 0 ? h('i', { class: 'neg', style: { height: hpx + 'px' } }) : null) : null,
        h('small', null, String(x.day)));
      wrap.appendChild(col);
    });
    const last = vals[vals.length - 1];
    return h('div', { class: 'ch-wrap' }, h('div', { class: 'ch-max' }, 'maks ' + f(Math.max(...vals)) + ' · son ' + f(last)), wrap);
  }
  function lineChart(hist, get, min, max, f) {
    const W = 480, H = 130, pad = 14;
    const vals = hist.map(get);
    const xs = i => pad + (hist.length <= 1 ? (W - pad * 2) / 2 : i * (W - pad * 2) / (hist.length - 1));
    const ys = v => H - pad - (clamp(v, min, max) - min) / (max - min) * (H - pad * 2);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'ch-svg');
    const mk = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
    for (let g = min; g <= max; g++) {
      mk('line', { x1: pad, x2: W - pad, y1: ys(g), y2: ys(g), class: 'ch-grid' });
      const t = mk('text', { x: 2, y: ys(g) + 4, class: 'ch-ax' }); t.textContent = g;
    }
    const pts = vals.map((v, i) => xs(i).toFixed(1) + ',' + ys(v).toFixed(1)).join(' ');
    mk('polygon', { points: xs(0) + ',' + (H - pad) + ' ' + pts + ' ' + xs(vals.length - 1) + ',' + (H - pad), class: 'ch-area' });
    mk('polyline', { points: pts, class: 'ch-line' });
    vals.forEach((v, i) => {
      const c = mk('circle', { cx: xs(i), cy: ys(v), r: 4.5, class: 'ch-dot' });
      const t = document.createElementNS(ns, 'title'); t.textContent = 'Gün ' + hist[i].day + ': ' + f(v); c.appendChild(t);
    });
    return h('div', { class: 'ch-wrap' }, h('div', { class: 'ch-max' }, 'şu an ' + f(vals[vals.length - 1])), svg);
  }
  function hubMarket(p) {
    const s = S(), cur = M().campaign();
    p.body.appendChild(h('div', { class: 'mn-hint' }, '📣 Kampanyalar yalnızca ', h('b', null, 'hazırlık aşamasında'), ' başlatılır ve o gün boyunca geçerlidir. Günde bir kampanya yapılabilir.'));
    if (cur) p.body.appendChild(h('div', { class: 'mk-active' }, h('span', null, cur.icon), h('div', null, h('b', null, 'Bugünün kampanyası: ' + cur.name), h('small', null, cur.desc))));
    const grid = h('div', { class: 'mk-grid' });
    for (const [id, c] of Object.entries(D().campaigns || {})) {
      const chk = M().canCampaign(id);
      const locked = (c.unlock || 1) > s.level;
      const active = cur && cur.id === id;
      const fx = [];
      if (c.demand && c.demand !== 1) fx.push('📈 Talep +%' + Math.round((c.demand - 1) * 100));
      if (c.patience && c.patience !== 1) fx.push('⏳ Sabır +%' + Math.round((c.patience - 1) * 100));
      if (c.tip && c.tip !== 1) fx.push('🪙 Bahşiş +%' + Math.round((c.tip - 1) * 100));
      if (c.rep) fx.push('⭐ İtibar +' + String(c.rep).replace('.', ','));
      if (c.studentBoost) fx.push('🎒 Daha çok öğrenci');
      const b = locked ? h('div', { class: 'stc-lock' }, '🔒 Seviye ' + c.unlock)
        : active ? h('div', { class: 'mk-on' }, '✔ Aktif')
          : btn(['Başlat', h('span', { class: 'ub-price' }, fmt(c.cost))], chk.ok ? 'orange' : 'ghost', () => {
            const r = M().runCampaign(id);
            if (!r.ok) { notify(r.msg, 'warn'); return; }
            confettiAt(b, 30); rerenderPanel(); refreshPrep();
          });
      if (!locked && !active && !chk.ok) { setDisabled(b, true); b.title = chk.msg; }
      grid.appendChild(h('div', { class: 'mk-card' + (active ? ' on' : '') + (locked ? ' locked' : '') },
        h('div', { class: 'mk-ico' }, c.icon), h('b', null, c.name), h('small', null, c.desc),
        h('div', { class: 'mk-fx' }, fx.map(x => h('span', null, x))), b));
    }
    p.body.appendChild(grid);
    if (s.phase !== 'prep') p.body.appendChild(h('div', { class: 'prep-tip' }, '⏰ Kantin şu an açık — yeni kampanyayı yarın sabah hazırlıkta başlatabilirsin.'));
  }
  function hubBank(p) {
    const s = S(), loans = M().loans();
    p.body.appendChild(h('div', { class: 'mn-hint' }, '🏦 Kredi çekip yatırım yapabilir ya da zor günü atlatabilirsin. Taksitler her ', h('b', null, 'gün sonunda'), ' otomatik ödenir. Erken kapamada kalan faizin yarısı silinir.'));
    const offers = h('div', { class: 'bk-offers' });
    for (const id of Object.keys(D().loans || {})) {
      const o = M().loanOffer(id), chk = M().canLoan(id);
      const locked = o.unlock > s.level;
      const b = locked ? h('div', { class: 'stc-lock' }, '🔒 Seviye ' + o.unlock)
        : btn('Krediyi Çek', chk.ok ? 'green' : 'ghost', () => confirmBox(o.name + ' çekilsin mi?',
          fmt(o.amount) + ' hemen kasana geçer. ' + o.days + ' gün boyunca günde ' + fmt(o.perDay) + ' taksit ödersin (toplam ' + fmt(o.total) + ').',
          'Krediyi çek', () => { const r = M().takeLoan(id); if (!r.ok) notify(r.msg, 'warn'); else confetti(800, 300, 30); rerenderPanel(); refreshPrep(); }));
      if (!locked && !chk.ok) { setDisabled(b, true); b.title = chk.msg; }
      offers.appendChild(h('div', { class: 'bko-card' + (locked ? ' locked' : '') },
        h('div', { class: 'bko-ico' }, o.icon), h('b', null, o.name),
        h('div', { class: 'bko-amt' }, fmt(o.amount)),
        h('div', { class: 'bko-row' }, h('span', null, 'Vade'), h('b', null, o.days + ' gün')),
        h('div', { class: 'bko-row' }, h('span', null, 'Faiz'), h('b', null, '%' + Math.round(o.rate * 100))),
        h('div', { class: 'bko-row' }, h('span', null, 'Günlük taksit'), h('b', null, fmt(o.perDay))),
        h('div', { class: 'bko-row' }, h('span', null, 'Geri ödeme'), h('b', null, fmt(o.total))),
        !locked && !chk.ok ? h('small', { class: 'bko-why' }, chk.msg) : null, b));
    }
    p.body.appendChild(h('div', { class: 'sg-title' }, '💳 Kredi teklifleri'));
    p.body.appendChild(offers);
    p.body.appendChild(h('div', { class: 'sg-title' }, '📄 Aktif krediler'));
    if (!loans.length) p.body.appendChild(h('div', { class: 'sm-empty' }, 'Aktif kredin yok. Borçsuz kantin, huzurlu kantin! 😌'));
    else p.body.appendChild(h('div', { class: 'bk-loans' }, loans.map(l => {
      const left = l.total - l.paid;
      return h('div', { class: 'bkl-row' },
        h('b', null, l.name), h('small', null, 'Gün ' + l.day + "'de çekildi"),
        h('div', { class: 'bkl-prog' }, bar(l.paid / l.total, 'gold'), h('span', null, fmt(l.paid) + ' / ' + fmt(l.total))),
        h('span', { class: 'bkl-left' }, 'Kalan ', h('b', null, fmt(left)), ' · ' + Math.ceil(left / l.perDay) + ' gün'),
        btn('Erken Kapat', 'cream', () => confirmBox('Kredi kapatılsın mı?', 'Kalan borç (faiz indirimiyle) kasadan ödenir.', 'Öde ve kapat', () => {
          const r = M().payOffLoan(l.uid); if (!r.ok) notify(r.msg, 'warn'); else notify('🏦 ' + fmt(r.paid) + ' ödendi, kredi kapandı.', 'good');
          rerenderPanel(); refreshPrep();
        })));
    })));
    p.setFoot(h('div', { class: 'sf-sum' }, h('span', null, 'Toplam borç: ', h('b', null, fmt(M().debt()))), h('span', null, 'Günlük taksit: ', h('b', null, fmt(M().dailyInstallment())))));
  }

  // ---------------------------------------------------------------------------
  // PANEL: TARİF DEFTERİ
  // ---------------------------------------------------------------------------
  const CONTROLS = [
    ['🖱️', 'Sürükle-bırak', 'Malzemeyi kutudan tutup tabağa, tabağı makineye, yemeği müşteriye sürükle.'],
    ['👆', 'Kısa dokun = taşı', 'Bir şeye kısaca dokun: eline yapışır, sonra gideceği yere dokun.'],
    ['↩️', 'İptal', 'Sağ tık veya Esc: elindekini yerine geri koyar.'],
    ['🍖', 'Köfteyi çevir', 'Izgaradaki köfteye tıkla: alt yüzü pişince ters çevir.'],
    ['🥪', 'Tost kapağı', 'Tost makinesinin kapağına tıkla: kapağı indirip kaldırır.'],
    ['🫖', 'Semaver', 'Demliğe tıkla: çay yaprağıyla demle. Demlenince bardağa doldur.'],
    ['🧽', 'Temizlik', 'Bezi al, tezgahtaki kirlerin üstünde gezdir. Kirli kantin itibar kaybettirir!'],
    ['🗑️', 'Çöp', 'Yanlış yaptığın yemeği çöpe at (malzeme boşa gider).'],
    ['⏸', 'Duraklat', 'Boşluk, P veya Esc tuşu. Paneller açıkken de zaman durur.'],
    ['💡', 'Tarif yardımcısı', 'Elin boşken müşterinin üzerine gel: gereken kutular ve istasyonlar altın renkle yanar. H ile aç/kapat.'],
    ['⌨️', 'Kısayollar', '1 / 2: oyun hızı · F: tam ekran · M Malzeme · T Telefon · N Menü · G Geliştir · E Personel · R Tarifler · K Hedefler.'],
    ['🔔', 'Gün şeridi', 'Üst çubuğun altındaki şerit zil programıdır: turuncu bölümler teneffüs ve öğle arası. Yoğunluk gelmeden hazırlan!'],
  ];
  const recipeTab = { tab: 'recipes' };
  PANELS.recipes = {
    title: 'Tarif Defteri', icon: '📖', width: 1160, cls: 'book',
    build(p) {
      p.setTabs([{ id: 'recipes', label: '📖 Tarifler' }, { id: 'controls', label: '🎮 Kontroller' }], recipeTab.tab, t => { recipeTab.tab = t; renderBook(p); });
      renderBook(p);
    },
  };
  function controlsBlock() {
    return h('div', { class: 'ct-grid' }, CONTROLS.map(c => h('div', { class: 'ct-item' }, h('span', { class: 'ct-ico' }, c[0]), h('div', null, h('b', null, c[1]), h('small', null, c[2])))));
  }
  function renderBook(p) {
    clear(p.body);
    if (recipeTab.tab === 'controls') { p.body.appendChild(controlsBlock()); return; }
    const grid = h('div', { class: 'bk-grid' });
    for (const [rid, r] of Object.entries(D().recipes)) {
      const unlocked = recipeUnlocked(rid);
      const price = (S().menu[rid] && S().menu[rid].price) || r.price;
      const ings = [r.base].concat(r.required || []).map(nameOf);
      grid.appendChild(h('div', { class: 'bk-card' + (unlocked ? '' : ' locked') },
        h('div', { class: 'bk-art' }, dishIcon(rid, 150, 116, 1.15), unlocked ? null : h('div', { class: 'bk-lock' }, '🔒', h('small', null, 'Seviye ' + r.unlock))),
        h('div', { class: 'bk-info' },
          h('div', { class: 'bk-head' }, h('b', null, r.name), h('span', { class: 'bk-price' }, fmt(price))),
          h('div', { class: 'bk-tags' },
            h('span', null, '⏱ ' + (r.time || '-')),
            r.toast ? h('span', null, '🔥 Tost makinesi') : null,
            h('span', null, '🧾 ' + ings.join(' + '))),
          h('ol', { class: 'bk-steps' }, (r.steps || []).map(st => h('li', null, st))),
          (r.optional || []).length ? h('div', { class: 'bk-opt' }, 'İsteğe göre: ' + r.optional.map(x => nameOf(x).toLowerCase()).join(', ') +
            ((r.defaults || []).length ? ' · Varsayılan: ' + r.defaults.map(x => nameOf(x).toLowerCase()).join(', ') : '')) : null)));
    }
    p.body.appendChild(grid);
    p.body.appendChild(h('div', { class: 'sg-title' }, '🎮 Kontroller'));
    p.body.appendChild(controlsBlock());
  }

  // ---------------------------------------------------------------------------
  // PANEL: AYARLAR & NASIL OYNANIR
  // ---------------------------------------------------------------------------
  PANELS.settings = {
    title: 'Ayarlar', icon: '⚙️', width: 560,
    build(p) {
      clear(p.body);
      const row = (ico, label, sub, ctrl) => h('div', { class: 'set-row' }, h('span', { class: 'set-ico' }, ico), h('div', { class: 'set-l' }, h('b', null, label), h('small', null, sub)), ctrl);
      p.body.appendChild(row('🔊', 'Ses efektleri', 'Cızırtı, kasa, zil sesleri', toggle(settings.sound, on => { setSound(on); updateHUD(); })));
      p.body.appendChild(row('🎵', 'Müzik', 'Arka plan müziği', toggle(settings.music, on => setMusic(on))));
      const fxOn = !(KS.Art && KS.Art.fxActive) || KS.Art.fxActive();
      p.body.appendChild(row('💡', 'Işık & derinlik efektleri', 'Gölgeler, ışık, parıltılar (yavaş cihazda kapat)', toggle(fxOn, on => {
        settings.fx = !!on; applySettings(true);
        try { if (KS.Art && KS.Art.setFx) KS.Art.setFx(!!on, true); } catch (e) { /* */ }
      })));
      const s = S();
      if (s && s.phase !== 'menu') {
        p.body.appendChild(row('⏩', 'Oyun hızı', 'Sakin saatleri hızlandır', toggle((s.speedMult || 1) >= 2, on => { s.speedMult = on ? 2 : 1; updateHUD(); }, ['2x', '1x'])));
        p.body.appendChild(row('🎓', 'Eğitim ipuçları', 'Bir sonraki açılışta ipuçlarını tekrar göster', toggle(!s.tutorialDone, on => { s.tutorialDone = !on; save(); }, ['Göster', 'Gizle'])));
      }
      // Hakkımda paneline kısayol (ana menüye ek olarak burada da erişilsin)
      p.body.appendChild(h('div', { class: 'ab-set-foot' }, btn('👋 Hakkımda', 'ghost', () => openPanel('about'))));
    },
  };
  PANELS.help = {
    title: 'Nasıl Oynanır?', icon: '❓', width: 980,
    build(p) {
      clear(p.body);
      const sec = (ico, title, text) => h('div', { class: 'hp-sec' }, h('div', { class: 'hp-ico' }, ico), h('div', null, h('b', null, title), h('p', { html: text })));
      p.body.appendChild(h('div', { class: 'hp-grid' },
        sec('🏫', 'Kantinci sensin!', 'Okul kantinini işletiyorsun. Gün <b>08:00</b>\'de açılır, <b>17:00</b>\'de kapanır. Amacın müşterileri hızlı ve doğru doyurup para ve itibar kazanmak.'),
        sec('🔔', 'Zil programı', 'Ders saatlerinde kantin sakindir. <b>Teneffüs</b> ve <b>öğle arası</b> zili çalınca öğrenciler akın eder — önceden hazırlık yap!'),
        sec('🥪', 'Yemek yap', 'Malzemeleri kutulardan tabağa sürükle, tost makinesinde bas, ızgarada köfte pişir, fritözde patates kızart, semaverde çay demle.'),
        sec('🥤', 'Hazır ürünler', 'Ayran, kola, simit ve dışarıdan sipariş ettiğin döner/çiğ köfte <b>vitrinde</b> durur; tek hamlede servis edilir.'),
        sec('📦', 'Stok & sipariş', '<b>Toptancı</b> ucuzdur ama açıkken ~60 dk\'da gelir; <b>bakkal</b> pahalı ama hızlıdır. <b>Telefonla</b> hazır yemek söyle — gün sonunda bozulur!'),
        sec('⭐', 'İtibar & seviye', 'Mutlu müşteri itibar ve XP getirir. Seviye atladıkça yeni tarifler, ürünler ve personel açılır.'),
        sec('🧽', 'Temizlik', 'Tezgah kirlenir; bezle sil. Müfettiş günü kirli kantine <b>ceza</b> keser.'),
        sec('🎯', 'Hedefler & başarımlar', 'Her gün 3 <b>günlük hedef</b> gelir; tamamlayınca para ve XP kazanırsın. 📒 <b>Kantin Defteri</b>\'nde başarımlarını ve istatistiklerini takip et.'),
        sec('📣', 'Pazarlama & banka', 'Hazırlıkta <b>kampanya</b> başlatıp talebi arttır. Zor günde <b>banka kredisi</b> çekebilirsin; taksitler gün sonunda ödenir.'),
        sec('🫖', 'Toplu sipariş', 'Ders saatlerinde öğretmenler odası arayıp toplu sipariş verebilir. Görevli gelince hepsini eksiksiz ver — bahşiş bol!'),
        sec('💸', 'Giderler', 'Her gün sonunda kira, faturalar ve yevmiyeler ödenir. Kasa ' + fmt(D().costs.bankruptcy) + ' altına düşerse iflas edersin.')));
      p.body.appendChild(h('div', { class: 'sg-title' }, '🎮 Kontroller'));
      p.body.appendChild(controlsBlock());
    },
  };

  // ---------------------------------------------------------------------------
  // PANEL: HAKKIMDA
  // ---------------------------------------------------------------------------
  // GitHub logosu (satır içi SVG, sabit içerik)
  const AB_GH_LOGO = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  PANELS.about = {
    title: 'Hakkımda', icon: '👋', width: 640,
    build(p) {
      clear(p.body);
      const ext = (href, cls, inner) => h('a', { class: 'ab-link ' + cls, href, target: '_blank', rel: 'noopener noreferrer' }, inner);
      p.body.appendChild(h('div', { class: 'ab-card' },
        h('div', { class: 'ab-head' },
          h('div', { class: 'ab-avatar' }, '🏫'),
          h('div', null, h('div', { class: 'ab-name' }, 'Semih Topak'), h('div', { class: 'ab-role' }, 'KantinSim\'in yapımcısı'))),
        h('p', { class: 'ab-text' },
          'KantinSim, bir okul kantinini yönettiğin simülasyon oyunu. Teneffüs zili çalar, öğrenciler ve öğretmenler kuyruğa girer; sen de malzemeleri birleştirip tost, köfte ekmek ve çay yetiştirirsin. Oyun okul kantininin teneffüs telaşından ilham aldı ve tarayıcıda ücretsiz oynanabiliyor.'),
        h('div', { class: 'ab-links' },
          ext('https://github.com/KimliksizPro', 'ab-gh', [h('span', { class: 'ab-gh-ico', html: AB_GH_LOGO }), h('span', null, 'GitHub: KimliksizPro')]),
          ext('https://github.com/KimliksizPro/KantinSim', 'ab-src', [h('span', null, 'Kaynak kodu'), h('small', null, 'github.com/KimliksizPro/KantinSim')])),
        h('p', { class: 'ab-lic' }, '© 2026 Semih Topak'),
        h('p', { class: 'ab-note' }, 'Geri bildirim ve öneriler için GitHub\'dan ulaşabilirsin. İyi oyunlar! 🥪')));
    },
  };

  // ---------------------------------------------------------------------------
  // GÜN SONU ÖZETİ & İFLAS
  // ---------------------------------------------------------------------------
  function starsEl(rep, big) {
    return h('div', { class: 'stars' + (big ? ' big' : '') }, h('div', { class: 'stars-bg' }, '★★★★★'),
      h('div', { class: 'stars-fg', style: { width: (clamp(rep, 0, 5) / 5 * 100).toFixed(1) + '%' } }, '★★★★★'));
  }
  function showSummary(report) {
    if (!report) report = KS.lastReport;
    if (!report) return;
    if (report.bankrupt) return showGameOver(report);
    closePanel(true); hideTutorial();
    const r = report;
    const expRows = EXP_LABELS.filter(([k]) => (r.expenses || {})[k] > 0 || k === 'kira' || k === 'fatura');
    let d = 0.25;
    const row = (label, val, cls) => {
      const v = h('b', { class: cls || '' });
      const el = h('div', { class: 'sm-row', style: { animationDelay: d.toFixed(2) + 's' } }, h('span', null, label), v);
      countUp(v, Math.abs(val), x => (val < 0 ? '−' : cls === 'inc' ? '+' : '') + fmt(x), d, 0.7);
      d += 0.07;
      return el;
    };
    const income = h('div', { class: 'sm-box' }, h('div', { class: 'sm-h' }, '💰 Gelirler'),
      row('🧾 Satışlar', r.revenue || 0, 'inc'), row('🪙 Bahşiş', r.tips || 0, 'inc'),
      (r.bonus || 0) > 0 ? row('🎯 Hedef & başarım ödülü', r.bonus, 'inc') : null);
    const exp = h('div', { class: 'sm-box' }, h('div', { class: 'sm-h' }, '💸 Giderler'),
      expRows.map(([k, label]) => row(label, -((r.expenses || {})[k] || 0), 'exp')),
      h('div', { class: 'sm-row total', style: { animationDelay: d.toFixed(2) + 's' } }, h('span', null, 'Toplam gider'), h('b', { class: 'exp' }, '−' + fmt(r.expenseTotal || 0))));
    const netEl = h('div', { class: 'sm-net-val ' + ((r.net || 0) >= 0 ? 'pos' : 'neg') });
    countUp(netEl, Math.abs(r.net || 0), x => ((r.net || 0) >= 0 ? '+' : '−') + fmt(x), d + 0.2, 1.1);
    const tile = (ico, label, val, cls) => {
      const v = h('b'); countUp(v, val || 0, x => String(Math.round(x)), 0.5, 0.8);
      return h('div', { class: 'sm-tile ' + (cls || '') }, h('span', { class: 'tl-ico' }, ico), v, h('small', null, label));
    };
    const sales = Object.entries(r.sales || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxSale = sales.length ? sales[0][1] : 1;
    const spoiled = Object.entries(r.spoiled || {}).map(([id, n]) => nameOf(id) + ' ×' + n)
      .concat(Object.entries(r.spoiledProd || {}).map(([id, n]) => nameOf(id) + ' ×' + n));
    const repD = r.repDelta || 0;
    const lp = call(KS.levelProgress) || { ratio: 0, cur: 0, need: 1, max: false };
    const hist = (S().history || []).slice(-7);
    const hmax = Math.max(1, ...hist.map(x => Math.abs(x.net || 0)));
    const w = D().weathers[r.weather] || {};

    const card = h('div', { class: 'sm-card' },
      h('div', { class: 'sm-ribbon' }, h('span', null, '🌙 Gün ' + r.day + ' Bitti!'), h('small', null, (r.weekday || '') + ' · ' + (w.icon || '') + ' ' + (w.name || '') + (r.event && r.event !== 'yok' ? ' · ' + ((D().events[r.event] || {}).name || '') : ''))),
      h('div', { class: 'sm-cols' },
        h('div', { class: 'sm-col' }, income, exp,
          h('div', { class: 'sm-net', style: { animationDelay: (d + 0.1).toFixed(2) + 's' } }, h('span', null, 'GÜNÜN NETİ'), netEl),
          h('div', { class: 'sm-cash' }, 'Kasa: ', h('b', { class: (r.money || 0) < 0 ? 'neg' : '' }, fmt(r.money || 0)),
            (r.debt || 0) > 0 ? h('span', { class: 'sm-debt' }, ' · 🏦 Borç ' + fmt(r.debt)) : null),
          summaryMeta(r)),
        h('div', { class: 'sm-col' },
          h('div', { class: 'sm-tiles' },
            tile('🙋', 'Servis', r.served), tile('🏃', 'Kaçan', r.lost, (r.lost || 0) > 0 ? 'bad' : ''),
            tile('😠', 'Kızgın', r.angry, (r.angry || 0) > 0 ? 'bad' : ''), tile('🤩', 'Mükemmel', r.perfect, 'good')),
          h('div', { class: 'sm-box sm-prog' },
            h('div', { class: 'sm-line' }, h('span', null, 'İtibar'), starsEl(r.rep || 0, true),
              h('b', { class: repD > 0.005 ? 'pos' : repD < -0.005 ? 'neg' : '' }, (r.rep || 0).toFixed(1) + ' (' + (repD >= 0 ? '+' : '−') + Math.abs(repD).toFixed(2) + ')')),
            h('div', { class: 'sm-line' }, h('span', null, 'Seviye ' + (r.level || 1)),
              h('div', { class: 'sm-xpbar' }, h('i', { style: { width: (lp.max ? 100 : lp.ratio * 100).toFixed(0) + '%' } })),
              h('b', { class: 'xp' }, '+' + Math.round(r.xpDelta || 0) + ' XP')),
            h('div', { class: 'sm-line' }, h('span', null, 'Temizlik'),
              h('div', { class: 'sm-xpbar clean' }, h('i', { style: { width: Math.round(r.cleanliness || 0) + '%' } })),
              h('b', null, '%' + Math.round(r.cleanliness || 0)))),
          h('div', { class: 'sm-box' }, h('div', { class: 'sm-h' }, '🏆 En çok satanlar'),
            sales.length ? sales.map(([id, n], i) => h('div', { class: 'sm-sale', style: { animationDelay: (0.4 + i * 0.08) + 's' } },
              h('span', { class: 'ss-rank' }, ['🥇', '🥈', '🥉', '4.', '5.'][i]), h('span', { class: 'ss-name' }, nameOf(id)),
              h('div', { class: 'ss-bar' }, h('i', { style: { width: (n / maxSale * 100).toFixed(0) + '%' } })), h('b', null, '×' + n)))
              : h('div', { class: 'sm-empty' }, 'Bugün satış yapılmadı.')),
          spoiled.length ? h('div', { class: 'sm-box spoil' }, h('div', { class: 'sm-h' }, '🦠 Bozulanlar'), h('div', { class: 'sm-spoil' }, spoiled.join(' · '))) : null,
          hist.length > 1 ? h('div', { class: 'sm-hist' }, h('small', null, 'Son günler'),
            h('div', { class: 'sh-bars' }, hist.map(x => h('i', { class: (x.net || 0) >= 0 ? 'pos' : 'neg', title: 'Gün ' + x.day + ': ' + fmtSigned(x.net || 0), style: { height: Math.max(4, Math.abs(x.net || 0) / hmax * 34) + 'px' } })))) : null)),
      h('div', { class: 'sm-btns' }, btn('Sonraki Gün ➜', 'green huge', () => { hideScreen(); call(KS.game.nextDay); syncPhase(true); })));
    clear(E.summary).appendChild(card);
    E.summary.className = 'ks-screen summary';
    showScreen('summary');
    sfx((r.net || 0) >= 0 ? 'coin' : 'error');
    if ((r.net || 0) > 0) setTimeout(() => confetti(800, 140, 40), (d + 1.1) * 1000);
  }
  function summaryMeta(r) {
    const goals = r.goals || [], ach = r.achievements || [], recs = r.records || [];
    const feat = r.featured ? (D().recipes[r.featured] || null) : null;
    if (!goals.length && !ach.length && !recs.length && !feat) return null;
    return h('div', { class: 'sm-box sm-meta' },
      feat ? h('div', { class: 'smg-feat' }, h('span', { class: 'smf-ico' }, '⭐'),
        h('span', { class: 'smf-t' }, 'Günün menüsü: ' + feat.name),
        h('b', null, (r.featServ || 0) > 0 ? (r.featServ + ' servis · +' + fmt(r.featTip || 0)) : 'hiç servis edilmedi')) : null,
      goals.length ? h('div', { class: 'sm-h' }, '🎯 Günün hedefleri · ' + goals.filter(g => g.done).length + '/' + goals.length) : null,
      goals.map(g => h('div', { class: 'smg-row' + (g.done ? ' done' : ' fail') }, h('span', null, g.done ? '✅' : '❌'), h('span', { class: 'smg-t' }, g.text),
        h('b', null, g.done ? '+' + fmt(g.reward.money) : '—'))),
      ach.length ? h('div', { class: 'smg-ach' }, ach.map(a => h('span', { class: 'smg-chip' }, a.icon + ' ' + a.name))) : null,
      recs.length ? h('div', { class: 'smg-ach' }, recs.map(x => h('span', { class: 'smg-chip rec' }, 'Yeni rekor: ' + x))) : null);
  }
  function showGameOver(report) {
    closePanel(true); hideTutorial();
    const s = S(), tot = (s.stats && s.stats.total) || {};
    const st = (ico, label, val) => h('div', { class: 'sm-tile' }, h('span', { class: 'tl-ico' }, ico), h('b', null, val), h('small', null, label));
    const card = h('div', { class: 'sm-card go' },
      h('div', { class: 'go-ico' }, '💸'),
      h('div', { class: 'go-title' }, 'İFLAS!'),
      h('div', { class: 'go-sub' }, 'Kasa ' + fmt(report ? report.money : s.money) + '. Okul idaresi kantin ihalesini iptal etti…'),
      h('div', { class: 'sm-tiles five' },
        st('📅', 'Gün', tot.days || s.day || 0), st('🧾', 'Toplam ciro', fmt(tot.revenue || 0)), st('🪙', 'Bahşiş', fmt(tot.tips || 0)),
        st('🙋', 'Servis', tot.served || 0), st('🏃', 'Kaçan', tot.lost || 0)),
      h('div', { class: 'go-tip' }, '💡 İpucu: Az ama karlı ürünlerle başla, hazır yemeği ihtiyacın kadar söyle, kirayı unutma!'),
      h('div', { class: 'sm-btns' },
        btn('🏠 Ana Menü', 'cream', () => { toMainMenuFromOver(); }),
        btn('🆕 Yeni Oyun', 'orange huge', () => startNewGame())));
    clear(E.summary).appendChild(card);
    E.summary.className = 'ks-screen summary gameover';
    showScreen('gameover');
    sfx('error');
  }
  function toMainMenuFromOver() {
    try { if (KS.deleteSave) KS.deleteSave(); } catch (e) { /* */ }
    try { KS.state = KS.newState ? KS.newState() : KS.state; KS.state.phase = 'menu'; } catch (e) { /* */ }
    applySettings(false); resetMoney();
    syncPhase(true);
  }

  // ---------------------------------------------------------------------------
  // DURAKLATMA
  // ---------------------------------------------------------------------------
  function buildPause() {
    E.pause = h('div', { id: 'ks-pause', class: 'ks-screen ks-hide' },
      h('div', { class: 'pz-card' },
        h('div', { class: 'pz-ico' }, '⏸'),
        h('div', { class: 'pz-title' }, 'Duraklatıldı'),
        h('div', { class: 'pz-sub' }),
        h('div', { class: 'pz-btns' },
          btn('▶️ Devam Et', 'green big', () => call(KS.game.togglePause, false)),
          btn('📖 Tarifler', 'cream', () => openPanel('recipes')),
          btn('⚙️ Ayarlar', 'cream', () => openPanel('settings')),
          btn('🏠 Ana Menüye Dön', 'ghost', () => confirmBox('Ana menüye dönülsün mü?', 'Oyun kaydedilir. Devam ettiğinde gün hazırlık aşamasından yeniden başlar.', 'Kaydet ve çık', () => toMainMenu())))));
    return E.pause;
  }
  function onPauseEvent(on) {
    const ph = S().phase;
    if (on && (ph === 'open' || ph === 'closing')) {
      const sub = E.pause.querySelector('.pz-sub');
      if (sub) sub.textContent = 'Gün ' + S().day + ' · ' + fmtT(S().time) + ' · Kasa ' + fmt(S().money);
      showScreen('pause');
    } else if (screen === 'pause') hideScreen();
    updateHUD();
  }

  // ---------------------------------------------------------------------------
  // EĞİTİM (ilk gün)
  // ---------------------------------------------------------------------------
  function binRect(id) {
    try { const P = KS.Stations && KS.Stations.prep; const r = P && P.binRect && P.binRect(id); if (r && r.w) return r; } catch (e) { /* */ }
    const L = KS.layout || {}, b = L.bins || { x: 12, y: 432, w: 340, h: 458, cols: 4, rows: 5 };
    const idx = Math.max(0, (D().binOrder || []).indexOf(id));
    const cols = b.cols || 4, rows = b.rows || 5, cw = b.w / cols, ch = b.h / rows;
    return { x: b.x + (idx % cols) * cw, y: b.y + Math.floor(idx / cols) * ch, w: cw, h: ch };
  }
  function plateRect(i) {
    try { const P = KS.Stations && KS.Stations.prep; const r = P && P.plateRect && P.plateRect(i); if (r && r.w) return r; } catch (e) { /* */ }
    return lay('tezgah', null);
  }
  function slotRect(i) {
    const sl = KS.layout && KS.layout.customerSlots && KS.layout.customerSlots[i];
    return sl ? sl.rect : { x: 365, y: 64, w: 270, h: 300 };
  }
  function lay(k, fb) { return (KS.layout && KS.layout[k]) || fb; }
  const TUT_STEPS = [
    { text: '👋 <b>Müşteri geldi!</b> Başının üstündeki konuşma balonunda ne istediğini görürsün.', target: () => slotRect(0), side: 'below' },
    { text: '🍞 Malzeme kutusundan <b>tost ekmeğini</b> alıp aşağıdaki tezgahta bir <b>tabağa</b> sürükle.', target: () => binRect('tost_ekmegi'), side: 'right', extra: () => plateRect(0), pick: it => it.id === 'tost_ekmegi' },
    { text: '🧀 Şimdi <b>kaşarı</b> aynı tabaktaki ekmeğin üstüne bırak.', target: () => binRect('kasar'), side: 'right', pick: it => it.id === 'kasar' },
    { text: '🔥 Tabağı <b>tost makinesine</b> koy ve <b>kapağına tıkla</b>. Altın sarısı olunca çıkar — yakma!', target: () => lay('tost', { x: 818, y: 432, w: 262, h: 200 }), side: 'above', pick: it => it.type === 'dish' },
    { text: '😋 Pişen tostu <b>müşteriye</b> sürükle. Hızlı ve doğru servis = bahşiş!', target: () => slotRect(0), side: 'below', served: true },
    { text: '🥤 Ayran, kola, simit gibi hazır ürünleri <b>vitrinden</b> alıp doğrudan müşteriye ver.', target: () => lay('vitrin', { x: 14, y: 66, w: 300, h: 338 }), side: 'right', pick: it => it.type === 'product' },
    { text: '📦 Stok bitmeden <b>Malzeme</b> veya <b>Telefon</b> ile sipariş ver. Açıkken toptancı ~60 dk\'da gelir!', target: () => (E.hudQ ? logicalRect(E.hudQ.btns.supply) : { x: 1000, y: 0, w: 60, h: 56 }), side: 'below' },
  ];
  const tut = { active: false, step: 0, picked: false };
  function buildTutorial() {
    E.tutRing = h('div', { class: 'tut-ring' });
    E.tutRing2 = h('div', { class: 'tut-ring ring2 ks-hide' });
    E.tutText = h('div', { class: 'tut-text' });
    E.tutCount = h('span', { class: 'tut-count' });
    E.tutNext = h('button', { class: 'tut-btn next', type: 'button' }, 'İleri ›');
    E.tutSkip = h('button', { class: 'tut-btn skip', type: 'button' }, 'Atla');
    E.tutNext.addEventListener('click', safe(() => { sfx('click'); tutGo(tut.step + 1); }));
    E.tutSkip.addEventListener('click', safe(() => { sfx('click'); finishTutorial(); }));
    E.tutBubble = h('div', { class: 'tut-bubble' },
      h('div', { class: 'tut-head' }, h('span', { class: 'tut-hat' }, '🎓 İpucu'), E.tutCount),
      E.tutText, h('div', { class: 'tut-btns' }, E.tutSkip, E.tutNext));
    E.tut = h('div', { id: 'ks-tut', class: 'ks-passive ks-hide' }, E.tutRing, E.tutRing2, E.tutBubble);
    return E.tut;
  }
  function startTutorial() {
    if (!S() || S().tutorialDone) return;
    tut.active = true; tut.picked = false;
    tutGo(0);
  }
  function tutGo(i) {
    if (i >= TUT_STEPS.length) { finishTutorial(); return; }
    tut.step = i; tut.picked = false;
    const st = TUT_STEPS[i];
    E.tutText.innerHTML = st.text;
    E.tutCount.textContent = (i + 1) + ' / ' + TUT_STEPS.length;
    E.tutNext.textContent = i === TUT_STEPS.length - 1 ? 'Anladım ✓' : 'İleri ›';
    show(E.tut, true);
    E.tutBubble.classList.remove('pop'); void E.tutBubble.offsetWidth; E.tutBubble.classList.add('pop');
    placeTutorial();
  }
  function placeTutorial() {
    if (!tut.active) return;
    const st = TUT_STEPS[tut.step]; if (!st) return;
    const r = call(st.target) || { x: 700, y: 400, w: 100, h: 100 };
    Object.assign(E.tutRing.style, { left: (r.x - 4) + 'px', top: (r.y - 4) + 'px', width: (r.w + 8) + 'px', height: (r.h + 8) + 'px' });
    const r2 = st.extra ? call(st.extra) : null;
    show(E.tutRing2, !!r2);
    if (r2) Object.assign(E.tutRing2.style, { left: (r2.x - 4) + 'px', top: (r2.y - 4) + 'px', width: (r2.w + 8) + 'px', height: (r2.h + 8) + 'px' });
    // Küçük ekranda balonu hedefin yanına sığdırmak yerine alt kenara sabitle ve native boyutta göster.
    const sc = KS.scale || 1;
    if (sc < 0.95 && root) {
      const ur = root.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const bw = Math.min(vw - 16, 470);
      Object.assign(E.tutBubble.style, {
        left: ((8 - ur.left) / sc) + 'px', width: bw + 'px', maxWidth: 'none',
        transform: 'scale(' + (1 / sc) + ')', transformOrigin: 'top left',
      });
      E.tutBubble.dataset.side = 'none';
      const bh = E.tutBubble.offsetHeight || 150;
      E.tutBubble.style.top = ((vh - 8 - bh - ur.top) / sc) + 'px';
      return;
    }
    E.tutBubble.style.transform = ''; E.tutBubble.style.maxWidth = ''; E.tutBubble.style.transformOrigin = '';
    const bw = 340, bh = E.tutBubble.offsetHeight || 150, gap = 22;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let x, y, side = st.side;
    const fits = sd => {
      if (sd === 'right') return r.x + r.w + gap + bw < 1596;
      if (sd === 'left') return r.x - gap - bw > 4;
      if (sd === 'above') return r.y - gap - bh > 60;
      return r.y + r.h + gap + bh < 896;
    };
    if (!fits(side)) side = ['right', 'below', 'left', 'above'].find(fits) || 'below';
    if (side === 'right') { x = r.x + r.w + gap; y = cy - bh / 2; }
    else if (side === 'left') { x = r.x - gap - bw; y = cy - bh / 2; }
    else if (side === 'above') { x = cx - bw / 2; y = r.y - gap - bh; }
    else { x = cx - bw / 2; y = r.y + r.h + gap; }
    x = clamp(x, 8, 1600 - bw - 8); y = clamp(y, 62, 900 - bh - 8);
    E.tutBubble.style.left = x + 'px'; E.tutBubble.style.top = y + 'px';
    E.tutBubble.dataset.side = side;
    // ok konumu hedefin merkezine hizalı
    if (side === 'right' || side === 'left') E.tutBubble.style.setProperty('--ay', clamp(cy - y, 20, bh - 20) + 'px');
    else E.tutBubble.style.setProperty('--ax', clamp(cx - x, 24, bw - 24) + 'px');
  }
  function updateTutorial() {
    if (!tut.active) return;
    const s = S();
    if (s.tutorialDone || (s.phase !== 'open' && s.phase !== 'closing')) { hideTutorial(); tut.active = false; return; }
    const hide = !!(curPanel || screen);
    E.tut.classList.toggle('dim', hide);
    const st = TUT_STEPS[tut.step];
    if (st && st.pick) {
      const held = KS.held && KS.held.item;
      if (held && call(st.pick, held)) tut.picked = true;
      else if (!held && tut.picked) { tutGo(tut.step + 1); return; }
    }
    if (tut.step === TUT_STEPS.length - 1) placeTutorial();
  }
  function finishTutorial() {
    tut.active = false; hideTutorial();
    if (S()) { S().tutorialDone = true; save(); }
    notify('🎓 Eğitim tamamlandı! Tarif defterinden (📖) her şeye tekrar bakabilirsin.', 'good');
  }
  function hideTutorial() { if (E.tut) show(E.tut, false); }

  // ---------------------------------------------------------------------------
  // FAZ SENKRONU
  // ---------------------------------------------------------------------------
  let lastPhase = null;
  function syncPhase(force) {
    const s = S(); if (!s) return;
    const ph = s.phase;
    if (ph === lastPhase && !force) return;
    const prev = lastPhase; lastPhase = ph;
    show(E.hud, ph !== 'menu');
    show(E.prep, ph === 'prep');
    if (ph === 'menu') { closePanel(true); hideTutorial(); tut.active = false; showScreen('mainmenu'); }
    else if (ph === 'prep') { if (screen) hideScreen(); buildPrepCard(); }
    else if (ph === 'open' || ph === 'closing') {
      if (screen && screen !== 'pause') hideScreen();
      if (ph === 'open' && prev === 'prep' && !s.tutorialDone && !tut.active) startTutorial();
    } else if (ph === 'summary') { if (screen !== 'summary' && KS.lastReport) showSummary(KS.lastReport); }
    else if (ph === 'gameover') { if (screen !== 'gameover') showGameOver(KS.lastReport); }
    updateHUD();
  }

  // ---------------------------------------------------------------------------
  // OLAY BAĞLANTILARI
  // ---------------------------------------------------------------------------
  let lastAngry = 0;
  function wireBus() {
    const on = (ev, fn) => { try { KS.bus.on(ev, safe(fn)); } catch (e) { /* */ } };
    on('prepStart', () => { lastPhase = null; syncPhase(true); });
    on('open', () => {
      syncPhase(true);
      if (!S().tutorialDone && !tut.active) startTutorial();
    });
    on('newGame', () => { applySettings(false); resetMoney(); });
    on('stateLoaded', () => { applySettings(false); resetMoney(); });
    on('dayEnd', report => {
      lastPhase = S().phase;
      show(E.prep, false);
      if (report && report.bankrupt) showGameOver(report); else showSummary(report);
      updateHUD();
    });
    on('pause', onPauseEvent);
    on('periodChange', p => {
      if (!p || S().phase !== 'open') return;
      if (p.type === 'teneffus') banner('🔔 Teneffüs! Öğrenciler geliyor', 'busy');
      else if (p.type === 'ogle') banner('🍽️ Öğle Arası! Kantin dolacak', 'busy');
      else if (p.type === 'cikis') banner('🎒 Okul çıkışı! Son akın', 'warm');
      else if (p.type === 'sabah') banner('☀️ Günaydın! Kantin açıldı', 'warm');
      else if (p.type === 'aksam') banner('📚 Etüt saati — sakin', 'calm');
      updateHUD();
    });
    on('levelUp', level => {
      const lines = [];
      for (const r of Object.values(D().recipes)) if (r.unlock === level) lines.push('🍳 Yeni tarif açıldı: ' + r.name);
      for (const p of Object.values(D().products)) if (p.unlock === level) lines.push('🥤 Yeni ürün: ' + p.name);
      for (const sp of Object.values(D().suppliers)) if (sp.unlock === level) lines.push('📞 Yeni tedarikçi: ' + sp.name);
      for (const st of Object.values(D().staff)) if (st.unlock === level) lines.push('👥 İşe alınabilir: ' + st.name);
      if (!lines.length) lines.push('Kantinin büyüyor, böyle devam!');
      popup('Seviye ' + level + '!', lines.slice(0, 5), '⭐');
      updateHUD();
    });
    on('customerLeft', info => {
      if (!info) return;
      const angry = info.angry || info.mood === 'angry' || info.reason === 'angry' || info.reason === 'timeout' || info.reason === 'patience';
      if (!angry) return;
      const now = performance.now(); if (now - lastAngry < 1500) return; lastAngry = now;
      const ct = info.type && D().customerTypes && D().customerTypes[info.type];
      notify('😠 ' + (info.name || (ct && ct.name) || 'Müşteri') + ' beklemekten sıkılıp gitti!', 'bad');
    });
    on('achievement', a => showAchievement(a));
    on('goalDone', () => { updateHUD(); if (E.hudQ && E.hudQ.btns.kantin) { const b = E.hudQ.btns.kantin; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); confettiAt(b, 26); } if (curPanel && curPanel.id === 'kantin') rerenderPanel(); });
    on('campaign', () => refreshPrep());
    on('moneyChanged', () => { /* HUD 5Hz döngüde yakalar */ });
    on('powerChange', () => updateHUD());
  }

  // ---------------------------------------------------------------------------
  // ESC
  // ---------------------------------------------------------------------------
  function handleEscape() {
    try {
      if (confirmEl) { closeConfirm(); return true; }
      if (curPanel) { closePanel(); sfx('click'); return true; }
      if (screen === 'pause') { call(KS.game.togglePause, false); return true; }
      if (screen === 'mainmenu' || screen === 'summary' || screen === 'gameover') return true;
    } catch (e) { console.error(e); }
    return false;
  }

  // ---------------------------------------------------------------------------
  // INIT / UPDATE
  // ---------------------------------------------------------------------------
  function init() {
    root = document.getElementById('ui');
    if (!root) { console.warn('[ui] #ui bulunamadı'); return; }
    loadSettings();
    clear(root);
    E.prep = h('div', { id: 'ks-prep', class: 'ks-passive ks-hide' });
    E.banner = h('div', { class: 'ks-banner ks-passive', role: 'status', 'aria-live': 'polite' });
    E.popup = h('div', { id: 'ks-popup', class: 'ks-passive', role: 'status', 'aria-live': 'polite' });
    E.ach = h('div', { id: 'ks-ach', class: 'ks-passive', role: 'status', 'aria-live': 'polite' });
    E.notifs = h('div', { id: 'ks-notifs', class: 'ks-passive', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
    E.fx = h('div', { id: 'ks-fx', class: 'ks-passive', 'aria-hidden': 'true' });
    E.modal = h('div', { id: 'ks-modal', class: 'ks-hide' });
    E.modal.addEventListener('pointerdown', ev => { if (ev.target === E.modal) { E.modal._down = true; } });
    E.modal.addEventListener('click', ev => { if (ev.target === E.modal && E.modal._down) { sfx('click'); closePanel(); } E.modal._down = false; });
    E.summary = h('div', { id: 'ks-summary', class: 'ks-screen ks-hide' });
    add(root, [E.prep, buildTutorial(), buildHUD(), E.banner, buildMainMenu(), E.summary, buildPause(), E.modal, E.popup, E.ach, E.notifs, E.fx]);
    // klavye: paneller için kısayollar yok; Esc çekirdekte
    window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
    window.addEventListener('resize', () => placeTutorial());
    wireBus();
    applySettings(false);
    lastPhase = null;
    syncPhase(true);
  }

  let acc = 0;
  function update(dt, realDt) {
    try {
      realDt = realDt || 0.016;
      tickAnims(realDt);
      tickMoney(realDt);
      acc += realDt;
      if (acc >= 0.2) {
        acc = 0;
        syncPhase(false);
        updateHUD();
        updateTutorial();
      }
    } catch (e) { console.error('[ui update]', e); }
  }

  Object.assign(ui, {
    notify, handleEscape,
    open: (id, arg) => { try { return openPanel(id, arg); } catch (e) { console.error(e); return false; } },
    close: () => { try { closeConfirm(); return closePanel(); } catch (e) { return false; } },
    isOpen: id => (id ? !!(curPanel && curPanel.id === id) : !!curPanel),
    refresh: () => { try { updateHUD(); rerenderPanel(); refreshPrep(); } catch (e) { /* */ } },
    banner, popup, confetti,
    tutorialActive: () => !!tut.active,
    showMainMenu: () => toMainMenu(),
    startTutorial: () => { if (S()) { S().tutorialDone = false; startTutorial(); } },
  });
  KS.ui = ui;
  KS.registerModule({ name: 'ui', order: 100, init, update });
})(window.KS);
