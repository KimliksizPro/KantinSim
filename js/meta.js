/* KantinSim — Meta sistemler
 * İçerik: günlük hedefler, başarımlar, rekorlar & ömür boyu istatistik, pazarlama kampanyaları,
 *         banka kredileri, toplu (öğretmenler odası) siparişleri, usta aşçı vb. kancalar.
 * Dışa açılan: KS.Meta = { goals(), goalProgress(g), achievements(), achProgress(a), isUnlocked(id),
 *   campaign(), canCampaign(id), runCampaign(id), loans(), loanOffer(id), takeLoan(id), payOffLoan(uid),
 *   debt(), dailyInstallment(), week(), weekRevenue(), streak(), records(), lifeStats() }
 * Olaylar (bus): 'goalDone'(goal), 'achievement'(ach), 'campaign'(id), 'loanTaken'(loan), 'loanRepaid'(loan), 'bulkOrder'(info)
 */
(function (KS) {
  'use strict';
  const D = () => KS.DATA;
  const S = () => KS.state;
  const U = () => KS.util;
  const fmt = n => U().fmtMoney(n);
  const snd = (n, o) => { try { KS.audio.play(n, o); } catch (e) { /* */ } };

  // ---------------------------------------------------------------------------
  // DURUM GÜVENCESİ (eski kayıtlar için)
  // ---------------------------------------------------------------------------
  const LIFE_DEFAULTS = {
    perfect: 0, angry: 0, vip: 0, vipHappy: 0, bulk: 0, inspectorsPassed: 0, campaigns: 0, loansRepaid: 0,
    trashed: 0, bestNet: 0, bestRevenue: 0, bestServed: 0, bestTips: 0, flawlessDays: 0, fast: 0, combos: 0,
  };
  function ensure() {
    const s = S(); if (!s) return;
    if (!s.achievements || typeof s.achievements !== 'object') s.achievements = {};
    if (!Array.isArray(s.loans)) s.loans = [];
    if (typeof s.goalsDone !== 'number') s.goalsDone = 0;
    s.stats = s.stats || {};
    s.stats.total = Object.assign({ revenue: 0, served: 0, lost: 0, tips: 0, days: 0 }, s.stats.total || {});
    s.stats.life = Object.assign({}, LIFE_DEFAULTS, s.stats.life || {});
    s.stats.sales = s.stats.sales || {};
    if (!s.streak || typeof s.streak !== 'object') s.streak = { days: 0, best: 0, claimed: {}, lastDay: 0 };
    else {
      if (typeof s.streak.days !== 'number') s.streak.days = 0;
      if (typeof s.streak.best !== 'number') s.streak.best = 0;
      if (!s.streak.claimed || typeof s.streak.claimed !== 'object') s.streak.claimed = {};
      if (typeof s.streak.lastDay !== 'number') s.streak.lastDay = 0;
    }
    if (s.week && typeof s.week !== 'object') s.week = null;
    const t = s.today;
    if (t) {
      t.meta = Object.assign({ fast: 0, combos: 0, drinks: 0, bulk: 0, vipHappy: 0, bulkCalls: 0 }, t.meta || {});
      t.expenses = Object.assign({ reklam: 0, kredi: 0 }, t.expenses || {});
      if (t.bonus == null) t.bonus = 0;
    }
  }
  const life = () => (ensure(), S().stats.life);
  const today = () => (S().today || {});

  // ---------------------------------------------------------------------------
  // GÜNLÜK HEDEFLER
  // ---------------------------------------------------------------------------
  // Her hedef: {id, kind, text, icon, target, param?, reward:{money, xp}, done, failed, endOnly}
  const round5 = v => Math.max(5, Math.round(v / 5) * 5);
  const round50 = v => Math.max(50, Math.round(v / 50) * 50);
  function recentAvg(key, n) {
    const h = (S().history || []).slice(-(n || 3));
    if (!h.length) return 0;
    return h.reduce((a, x) => a + (x[key] || 0), 0) / h.length;
  }
  function menuRecipes() { return Object.keys(D().recipes).filter(id => KS.isRecipeOnMenu(id)); }
  function drinkIds() {
    const out = ['cay'];
    for (const [id, p] of Object.entries(D().products)) if (p.drink) out.push(id);
    return out;
  }

  const GOAL_TYPES = {
    serve: {
      icon: '🙋', weight: 3,
      make(s) {
        const avg = recentAvg('served');
        const target = Math.round(Math.max(10, avg ? avg * 1.08 : 12 + s.day * 1.5));
        return { target: Math.min(target, 90), text: n => n + ' müşteriye servis yap' };
      },
      prog: g => today().served || 0,
    },
    revenue: {
      icon: '🧾', weight: 2.5,
      make(s) {
        const avg = recentAvg('revenue');
        return { target: round50(Math.max(900, avg ? avg * 1.1 : 900 + s.day * 120)), text: n => 'Satışlardan ' + fmt(n) + ' ciro yap' };
      },
      prog: g => today().revenue || 0,
    },
    perfect: {
      icon: '🤩', weight: 2.5,
      make(s) { return { target: Math.min(25, 4 + Math.round(s.day * 0.8)), text: n => n + ' mükemmel servis yap (kalite %90+)' }; },
      prog: g => today().perfect || 0,
    },
    sell: {
      icon: '🍽️', weight: 3,
      make(s) {
        const n = Math.min(14, 3 + Math.floor(s.day / 3) + U().randInt(0, 2));
        const all = menuRecipes().filter(id => id !== 'cay');
        // stoğu yeten tarifleri tercih et (oyuncu yapamayacağı bir hedefle karşılaşmasın)
        const canMake = id => { const r = D().recipes[id]; return [r.base].concat(r.required).every(x => !D().ingredients[x] || KS.inv.get(x) >= n); };
        const list = all.filter(canMake).length ? all.filter(canMake) : all;
        if (!list.length) return null;
        const id = U().pick(list);
        return { target: n, param: id, text: k => k + ' adet ' + D().recipes[id].name + ' sat' };
      },
      prog: g => (today().sales || {})[g.param] || 0,
    },
    tips: {
      icon: '🪙', weight: 1.5,
      make(s) {
        const avg = recentAvg('tips');
        return { target: round5(Math.max(60, avg ? avg * 1.15 : 60 + s.day * 10)), text: n => fmt(n) + ' bahşiş topla' };
      },
      prog: g => today().tips || 0,
    },
    fast: {
      icon: '⚡', weight: 2,
      make(s) { return { target: Math.min(30, 5 + Math.round(s.day * 0.7)), text: n => n + ' müşteriyi sabrı bitmeden hızlıca doyur (sabır %60+)' }; },
      prog: g => (today().meta || {}).fast || 0,
    },
    drinks: {
      icon: '🥤', weight: 1.6,
      make(s) { return { target: Math.min(40, 8 + Math.round(s.day * 1.2)), text: n => n + ' içecek sat (çay dahil)' }; },
      prog: g => { const sl = today().sales || {}; return drinkIds().reduce((a, id) => a + (sl[id] || 0), 0); },
    },
    combos: {
      icon: '🧺', weight: 1.4,
      make(s) { return { target: Math.min(20, 4 + Math.round(s.day * 0.5)), text: n => n + ' müşterinin 2+ ürünlü siparişini eksiksiz ver' }; },
      prog: g => (today().meta || {}).combos || 0,
    },
    noangry: {
      icon: '😇', weight: 1.4, endOnly: true,
      make(s) { return s.day < 3 ? null : { target: 1, text: () => 'Günü hiç kızgın müşteri olmadan bitir' }; },
      prog: g => ((today().angry || 0) === 0 ? 1 : 0),
      failed: g => (today().angry || 0) > 0,
    },
    clean: {
      icon: '🧽', weight: 1.2, endOnly: true,
      make(s) { return { target: 80, text: n => 'Günü %' + n + '+ temizlikle kapat' }; },
      prog: g => Math.round(S().cleanliness || 0),
    },
  };

  function rewardFor(kind, s) {
    const base = 120 + s.day * 18 + (s.level - 1) * 40;
    const mult = { serve: 1, revenue: 1.1, perfect: 1.1, sell: 0.9, tips: 0.8, fast: 1, drinks: 0.8, combos: 0.9, noangry: 1.2, clean: 0.7 }[kind] || 1;
    return { money: round5(base * mult), xp: Math.round((30 + s.day * 3) * mult) };
  }

  function rollGoals() {
    const s = S(); ensure();
    const t = s.today; if (!t) return;
    if (t.goals && t.goals.day === s.day) return;
    const pool = {};
    for (const [k, g] of Object.entries(GOAL_TYPES)) pool[k] = g.weight;
    const list = [];
    let guard = 0;
    while (list.length < 3 && guard++ < 40) {
      const kind = U().weighted(pool);
      const made = GOAL_TYPES[kind].make(s);
      delete pool[kind];
      if (!made) continue;
      list.push({
        id: kind + '_' + s.day, kind, icon: GOAL_TYPES[kind].icon, target: made.target, param: made.param,
        text: made.text(made.target), reward: rewardFor(kind, s), done: false, failed: false, endOnly: !!GOAL_TYPES[kind].endOnly,
      });
      if (!Object.keys(pool).length) break;
    }
    t.goals = { day: s.day, list };
  }

  function goals() { const t = today(); return (t.goals && t.goals.list) || []; }
  function goalProgress(g) {
    const T = GOAL_TYPES[g.kind]; if (!T) return { cur: 0, target: 1, ratio: 0 };
    let cur = 0; try { cur = T.prog(g) || 0; } catch (e) { cur = 0; }
    if (g.done) cur = Math.max(cur, g.target);
    return { cur, target: g.target, ratio: U().clamp(cur / Math.max(1, g.target), 0, 1) };
  }
  function completeGoal(g) {
    if (g.done || g.failed) return;
    g.done = true;
    const s = S();
    s.goalsDone = (s.goalsDone || 0) + 1;
    KS.bonus(g.reward.money, 800, 120);
    KS.addXP(g.reward.xp);
    snd('levelup', { vol: 0.6 });
    KS.notify('🎯 Hedef tamamlandı: ' + g.text + ' (+' + fmt(g.reward.money) + ', +' + g.reward.xp + ' XP)', 'good');
    KS.bus.emit('goalDone', g);
    checkAchievements();
  }
  function checkGoals(final) {
    const s = S();
    if (!s.today || !(s.phase === 'open' || s.phase === 'closing' || final)) return;
    for (const g of goals()) {
      if (g.done || g.failed) continue;
      const T = GOAL_TYPES[g.kind]; if (!T) continue;
      if (T.failed && T.failed(g)) { g.failed = true; if (!final) KS.notify('❌ Hedef kaçtı: ' + g.text, 'warn'); continue; }
      if (g.endOnly && !final) continue;
      const p = goalProgress(g);
      if (p.cur >= g.target) completeGoal(g);
      else if (final) g.failed = true;
    }
  }

  // ---------------------------------------------------------------------------
  // HAFTALIK SÖZLEŞME
  // Her 5 okul günü bir haftadır. Haftanın başında ciro hedefi belirlenir; hedef
  // tutunca hafta içinde bir kez para + XP ödülü verilir. Hedef son güne kadar
  // tutmazsa sözleşme yanar, yeni hafta yeni hedefle başlar.
  // ---------------------------------------------------------------------------
  const WEEK_LEN = 5;
  const weekNo = day => Math.floor((Math.max(1, day) - 1) / WEEK_LEN) + 1;
  function weeklyTarget(s, n) {
    const avg = recentAvg('revenue', 3);
    const base = avg > 0 ? avg * 1.05 : (420 + 130 * Math.max(0, (s.level || 1) - 1));
    return Math.max(1000, Math.round(base * WEEK_LEN / 100) * 100);
  }
  function weeklyReward(target, n) {
    return { money: Math.max(200, Math.round(target * 0.15 / 50) * 50), xp: 50 + 10 * n };
  }
  // Geçerli haftayı döndürür; gün ilerlediyse yeni hafta açar.
  function ensureWeek() {
    const s = S(); if (!s) return null;
    const n = weekNo(s.day || 1);
    if (!s.week || s.week.n !== n) {
      const start = (n - 1) * WEEK_LEN + 1;
      const target = weeklyTarget(s, n);
      s.week = { n, start, target, reward: weeklyReward(target, n), done: false, paid: false, paidDay: 0, failed: false };
    }
    return s.week;
  }
  function weekRevenue(s) {
    const w = ensureWeek(); if (!w) return 0;
    let total = 0;
    let lastDay = 0;
    for (const h of s.history || []) {
      if (h.day >= w.start && h.day < w.start + WEEK_LEN) total += h.revenue || 0;
      if (h.day > lastDay) lastDay = h.day;
    }
    // Gün sonunda cari gün geçmişe çoktan yazılmış olur; iki kez saymayalım.
    if (s.today && s.day >= w.start && s.day < w.start + WEEK_LEN && lastDay !== s.day) total += s.today.revenue || 0;
    return total;
  }
  function weekInfo() {
    const s = S(), w = ensureWeek(); if (!w) return null;
    const revenue = weekRevenue(s);
    const dayIndex = U().clamp((s.day || 1) - w.start + 1, 1, WEEK_LEN);
    return Object.assign({}, w, {
      revenue, ratio: U().clamp(revenue / Math.max(1, w.target), 0, 1),
      dayIndex, daysLeft: Math.max(0, w.start + WEEK_LEN - (s.day || 1)),
    });
  }
  // Gün sonunda çağrılır: hedef tuttuysa bir kez öde, son gün tutmadıysa yan.
  function settleWeek() {
    const s = S(), w = ensureWeek(); if (!w || w.paid || w.failed) return;
    const total = weekRevenue(s);
    if (total >= w.target) {
      w.done = true; w.paid = true; w.paidDay = s.day || 0;
      KS.bonus(w.reward.money, 800, 120);
      KS.addXP(w.reward.xp);
      KS.notify('📅 Haftalık sözleşme tuttu! +' + fmt(w.reward.money) + ', +' + w.reward.xp + ' XP', 'good');
      KS.bus.emit('goalDone', { kind: 'week', text: 'Haftalık sözleşme', reward: w.reward });
    } else if ((s.day || 1) >= w.start + WEEK_LEN - 1) {
      w.failed = true;
      KS.notify('📅 Haftalık sözleşme tutmadı: ' + fmt(total) + ' / ' + fmt(w.target) + '. Yeni hafta yeni hedef!', 'warn');
    }
  }

  // ---------------------------------------------------------------------------
  // KÂRLI GÜN SERİSİ
  // Net kârı pozitif biten her gün seriyi büyütür. 3/5/10/20 günde bir kez
  // para + XP ödülü verilir; zararlı gün seriyi sıfırlar ama rekor kalır.
  // ---------------------------------------------------------------------------
  const STREAK_REWARDS = [
    { days: 3, money: 200, xp: 50 },
    { days: 5, money: 400, xp: 100 },
    { days: 10, money: 900, xp: 200 },
    { days: 20, money: 2000, xp: 400 },
  ];
  function nextStreakReward(st) {
    return STREAK_REWARDS.find(m => !st.claimed[m.days]) || null;
  }
  function streakInfo() {
    ensure();
    const st = S().streak;
    const next = nextStreakReward(st);
    return { days: st.days || 0, best: st.best || 0, claimed: Object.assign({}, st.claimed), next };
  }
  function updateStreak(report) {
    ensure();
    const s = S(), st = s.streak;
    if (st.lastDay === report.day) return null;
    const wasDays = st.days || 0;
    st.lastDay = report.day;
    const expenses = Object.values(today().expenses || {}).reduce((a, b) => a + b, 0);
    const net = (report.revenue || 0) + (report.tips || 0) + (today().bonus || 0) - expenses;
    const profitable = net > 0;
    let milestone = null;
    if (profitable) {
      st.days = wasDays + 1;
      st.best = Math.max(st.best || 0, st.days);
      for (const m of STREAK_REWARDS) {
        if (st.days >= m.days && !st.claimed[m.days]) {
          st.claimed[m.days] = report.day;
          KS.bonus(m.money, 800, 120);
          KS.addXP(m.xp);
          milestone = { days: m.days, money: m.money, xp: m.xp };
          break;
        }
      }
    } else {
      st.days = 0;
    }
    const next = nextStreakReward(st);
    return { days: st.days, best: st.best, profitable, net, lost: wasDays > 0 && !profitable ? wasDays : 0, milestone, next: next || null };
  }

  // ---------------------------------------------------------------------------
  // BAŞARIMLAR
  // ---------------------------------------------------------------------------
  const T = () => S().stats.total;
  // gün içindeyken bugünkü servisleri de say (gün sonunda çekirdek toplama ekler)
  const servedTotal = () => T().served + ((S().phase === 'open' || S().phase === 'closing') ? (today().served || 0) : 0);
  const allUpgMax = () => Object.entries(D().upgrades).every(([id, u]) => KS.upg(id) >= u.levels.length - 1);
  const anyUpgMax = () => Object.entries(D().upgrades).some(([id, u]) => KS.upg(id) >= u.levels.length - 1);
  const upgCount = () => Object.values(S().upgrades || {}).reduce((a, b) => a + b, 0);
  const staffCount = () => Object.values(S().staff || {}).filter(Boolean).length;
  const soldRecipes = () => Object.keys(D().recipes).filter(id => (S().stats.sales[id] || 0) > 0).length;

  const ACH = [
    { id: 'ilk_musteri', icon: '🙋', name: 'Hayırlı Olsun!', desc: 'İlk müşterine servis yap.', p: () => [servedTotal(), 1], xp: 20 },
    { id: 'musteri_100', icon: '👥', name: 'Müdavimler', desc: 'Toplam 100 müşteriye servis yap.', p: () => [servedTotal(), 100], xp: 80 },
    { id: 'musteri_500', icon: '🏫', name: 'Okulun Gözdesi', desc: 'Toplam 500 müşteriye servis yap.', p: () => [servedTotal(), 500], xp: 200, money: 500 },
    { id: 'musteri_2000', icon: '🏟️', name: 'Efsane Kantinci', desc: 'Toplam 2.000 müşteriye servis yap.', p: () => [servedTotal(), 2000], xp: 500, money: 2000 },
    { id: 'mukemmel_25', icon: '👌', name: 'Usta Eller', desc: '25 mükemmel servis yap.', p: () => [life().perfect, 25], xp: 80 },
    { id: 'mukemmel_200', icon: '👨‍🍳', name: 'Şef Dokunuşu', desc: '200 mükemmel servis yap.', p: () => [life().perfect, 200], xp: 300, money: 800 },
    { id: 'ciro_10k', icon: '💵', name: 'İlk On Bin', desc: 'Toplam 10.000 ₺ satış yap.', p: () => [T().revenue, 10000], xp: 100 },
    { id: 'ciro_100k', icon: '💰', name: 'Kantin İmparatorluğu', desc: 'Toplam 100.000 ₺ satış yap.', p: () => [T().revenue, 100000], xp: 500, money: 3000 },
    { id: 'bahsis_5k', icon: '🪙', name: 'Bahşiş Şampiyonu', desc: 'Toplam 5.000 ₺ bahşiş topla.', p: () => [T().tips, 5000], xp: 200, money: 500 },
    { id: 'kasa_20k', icon: '🐷', name: 'Kumbara Dolu', desc: 'Kasada 20.000 ₺ biriktir.', p: () => [Math.max(0, S().money), 20000], xp: 250 },
    { id: 'net_2k', icon: '📈', name: 'Bereketli Gün', desc: 'Bir günde 2.000 ₺ net kâr et.', p: () => [life().bestNet, 2000], xp: 150 },
    { id: 'kusursuz', icon: '💎', name: 'Kusursuz Gün', desc: 'En az 20 müşteriyle, hiç kaçan ya da kızan olmadan bir gün bitir.', p: () => [life().flawlessDays, 1], xp: 200, money: 500 },
    { id: 'yildiz_45', icon: '⭐', name: 'Beş Yıldızlı Kantin', desc: 'İtibarını 4,5 yıldıza çıkar.', p: () => [Math.round(S().rep * 10) / 10, 4.5], xp: 250 },
    { id: 'seviye_5', icon: '🎖️', name: 'Tecrübeli', desc: '5. seviyeye ulaş.', p: () => [S().level, 5], xp: 0, money: 1000 },
    { id: 'seviye_10', icon: '🏅', name: 'Kantin Ustası', desc: '10. seviyeye ulaş.', p: () => [S().level, 10], xp: 0, money: 5000 },
    { id: 'hafta_1', icon: '📅', name: 'İlk Hafta', desc: '5 okul günü tamamla.', p: () => [T().days, 5], xp: 100 },
    { id: 'donem', icon: '🗓️', name: 'Bir Dönem', desc: '20 okul günü tamamla.', p: () => [T().days, 20], xp: 400, money: 1500 },
    { id: 'gun_50', icon: '🏛️', name: 'Kantinin Kurumu', desc: '50 okul günü tamamla.', p: () => [T().days, 50], xp: 600, money: 2500 },
    { id: 'yatirimci', icon: '🔧', name: 'Yatırımcı', desc: 'İlk geliştirmeni satın al.', p: () => [upgCount(), 1], xp: 60 },
    { id: 'son_model', icon: '🚀', name: 'Son Model', desc: 'Bir ekipmanı en üst seviyeye çıkar.', p: () => [anyUpgMax() ? 1 : 0, 1], xp: 150 },
    { id: 'teknoloji', icon: '🏭', name: 'Teknoloji Harikası', desc: 'Tüm ekipmanları en üst seviyeye çıkar.', p: () => [allUpgMax() ? 1 : 0, 1], xp: 800, money: 3000 },
    { id: 'ekip', icon: '🤝', name: 'Ekip Ruhu', desc: 'Aynı anda 3 personel çalıştır.', p: () => [staffCount(), 3], xp: 150 },
    { id: 'mudur', icon: '👑', name: 'Müdürün Takdiri', desc: 'Müdür Bey\'e kusursuz servis yap.', p: () => [life().vipHappy, 1], xp: 120 },
    { id: 'tertemiz', icon: '🏅', name: 'Temizlik Belgesi', desc: 'Sağlık müfettişinden temizlik belgesi al.', p: () => [life().inspectorsPassed, 1], xp: 150 },
    { id: 'toplu_5', icon: '🫖', name: 'Öğretmenler Odasının Gözdesi', desc: '5 toplu siparişi tamamla.', p: () => [life().bulk, 5], xp: 200, money: 600 },
    { id: 'hedef_10', icon: '🎯', name: 'Hedef Avcısı', desc: '10 günlük hedef tamamla.', p: () => [S().goalsDone || 0, 10], xp: 150 },
    { id: 'hedef_50', icon: '🏹', name: 'Keskin Nişancı', desc: '50 günlük hedef tamamla.', p: () => [S().goalsDone || 0, 50], xp: 400, money: 2000 },
    { id: 'tam_menu', icon: '📜', name: 'Tam Menü', desc: 'Her tariften en az bir kez sat.', p: () => [soldRecipes(), Object.keys(D().recipes).length], xp: 400 },
    { id: 'reklam', icon: '📣', name: 'Reklamın Gücü', desc: '5 pazarlama kampanyası yap.', p: () => [life().campaigns, 5], xp: 100 },
    { id: 'borc', icon: '🏦', name: 'Sözünün Eri', desc: 'Bir banka kredisini tamamen öde.', p: () => [life().loansRepaid, 1], xp: 120 },
    { id: 'simsek', icon: '⚡', name: 'Şimşek Servis', desc: 'Toplam 100 müşteriyi sabrı %60\'tan fazlayken doyur.', p: () => [life().fast, 100], xp: 200 },
    { id: 'combo_50', icon: '🧺', name: 'Tepsi Ustası', desc: 'Toplam 50 çoklu siparişi eksiksiz teslim et.', p: () => [life().combos, 50], xp: 150 },
  ];
  const ACH_BY_ID = {}; ACH.forEach(a => { ACH_BY_ID[a.id] = a; });

  function achProgress(a) {
    let cur = 0, target = 1;
    try { const r = a.p(); cur = r[0] || 0; target = r[1] || 1; } catch (e) { /* */ }
    return { cur: Math.min(cur, target), target, ratio: U().clamp(cur / target, 0, 1) };
  }
  const isUnlocked = id => !!(S().achievements && S().achievements[id]);
  let achQueue = [];
  function checkAchievements() {
    const s = S(); if (!s || s.phase === 'menu') return;
    ensure();
    for (const a of ACH) {
      if (s.achievements[a.id]) continue;
      const p = achProgress(a);
      if (p.cur >= p.target) {
        s.achievements[a.id] = s.day;
        achQueue.push(a);
      }
    }
  }
  // Sırayla göster (aynı anda birden fazla açılırsa üst üste binmesin)
  let achShowT = 0;
  function flushAchievements(realDt) {
    achShowT -= realDt;
    if (achShowT > 0 || !achQueue.length) return;
    const a = achQueue.shift();
    achShowT = 1.6;
    if (a.money) KS.bonus(a.money);
    if (a.xp) KS.addXP(a.xp);
    if (S().today) (S().today.meta.ach = S().today.meta.ach || []).push(a.id);
    snd('levelup', { vol: 0.8 });
    KS.bus.emit('achievement', a);
    KS.save();
  }

  // ---------------------------------------------------------------------------
  // KAMPANYALAR
  // ---------------------------------------------------------------------------
  function campaign() { const id = today().campaign; return id ? Object.assign({ id }, D().campaigns[id]) : null; }
  function canCampaign(id) {
    const c = D().campaigns[id], s = S();
    if (!c) return { ok: false, msg: 'Kampanya yok' };
    if ((c.unlock || 1) > s.level) return { ok: false, msg: 'Seviye ' + c.unlock + ' gerekli' };
    if (s.phase !== 'prep') return { ok: false, msg: 'Kampanya yalnızca hazırlıkta başlatılır' };
    if (today().campaign) return { ok: false, msg: 'Bugün zaten bir kampanya var' };
    if (s.money < c.cost) return { ok: false, msg: 'Yetersiz bakiye' };
    return { ok: true };
  }
  function runCampaign(id) {
    const chk = canCampaign(id); if (!chk.ok) return chk;
    const c = D().campaigns[id];
    KS.spend(c.cost, 'reklam');
    S().today.campaign = id;
    life().campaigns++;
    snd('ding');
    KS.notify(c.icon + ' ' + c.name + ' başlatıldı! ' + c.desc, 'good');
    KS.bus.emit('campaign', id);
    checkAchievements();
    KS.save();
    return { ok: true };
  }
  const camp = field => { const c = campaign(); return (c && c[field]) || 1; };

  // ---------------------------------------------------------------------------
  // BANKA KREDİLERİ
  // ---------------------------------------------------------------------------
  function loanOffer(id) {
    const L = D().loans[id]; if (!L) return null;
    const total = Math.round(L.amount * (1 + L.rate));
    return { id, name: L.name, icon: L.icon, amount: L.amount, days: L.days, rate: L.rate, total, perDay: Math.ceil(total / L.days), unlock: L.unlock || 1 };
  }
  const loans = () => (ensure(), S().loans);
  const debt = () => loans().reduce((a, l) => a + (l.total - l.paid), 0);
  const dailyInstallment = () => loans().reduce((a, l) => a + Math.min(l.perDay, l.total - l.paid), 0);
  function canLoan(id) {
    const o = loanOffer(id), s = S();
    if (!o) return { ok: false, msg: 'Kredi yok' };
    if (o.unlock > s.level) return { ok: false, msg: 'Seviye ' + o.unlock + ' gerekli' };
    if (loans().some(l => l.type === id)) return { ok: false, msg: 'Bu krediyi zaten kullanıyorsun' };
    if (loans().length >= 2) return { ok: false, msg: 'En fazla 2 aktif kredi' };
    if (s.rep < 1.5) return { ok: false, msg: 'İtibarın çok düşük, banka kredi vermiyor' };
    return { ok: true };
  }
  function takeLoan(id) {
    const chk = canLoan(id); if (!chk.ok) return chk;
    const o = loanOffer(id), s = S();
    const loan = { uid: U().uid() + '_' + Date.now(), type: id, name: o.name, amount: o.amount, total: o.total, perDay: o.perDay, paid: 0, day: s.day };
    s.loans.push(loan);
    s.money += o.amount;
    KS.bus.emit('moneyChanged', s.money);
    snd('coin');
    KS.notify('🏦 ' + o.name + ': ' + fmt(o.amount) + ' hesabına yattı. Günlük taksit ' + fmt(o.perDay) + '.', 'good');
    KS.bus.emit('loanTaken', loan);
    KS.save();
    return { ok: true, loan };
  }
  function payOffLoan(uid) {
    const s = S(), l = loans().find(x => x.uid === uid);
    if (!l) return { ok: false, msg: 'Kredi bulunamadı' };
    const left = l.total - l.paid;
    // erken kapamada kalan faizin yarısı silinir
    const interestLeft = Math.max(0, left - (l.amount - Math.min(l.amount, l.paid)));
    const pay = Math.round(left - interestLeft * 0.5);
    if (s.money < pay) return { ok: false, msg: 'Yetersiz bakiye (' + fmt(pay) + ' gerekli)' };
    KS.spend(pay, 'kredi');
    finishLoan(l);
    return { ok: true, paid: pay };
  }
  function finishLoan(l) {
    const s = S();
    s.loans = s.loans.filter(x => x !== l);
    life().loansRepaid++;
    snd('levelup', { vol: 0.5 });
    KS.notify('🏦 ' + l.name + ' tamamen ödendi!', 'good');
    KS.bus.emit('loanRepaid', l);
    checkAchievements();
    KS.save();
  }
  function payInstallments() {
    let total = 0;
    for (const l of loans().slice()) {
      const amt = Math.min(l.perDay, l.total - l.paid);
      if (amt <= 0) continue;
      KS.spend(amt, 'kredi', true);
      l.paid += amt; total += amt;
      if (l.paid >= l.total) finishLoan(l);
    }
    return total;
  }

  // ---------------------------------------------------------------------------
  // TOPLU SİPARİŞ (öğretmenler odası / müdürlük)
  // ---------------------------------------------------------------------------
  const BULK_SOURCES = [
    { from: 'Öğretmenler Odası', name: 'Ayşe Abla', type: 'hizmetli' },
    { from: 'Müdür Yardımcısı', name: 'Hasan Abi', type: 'hizmetli' },
    { from: 'Rehberlik Servisi', name: 'Zeynep Hoca', type: 'ogretmen' },
    { from: 'Spor Salonu', name: 'Beden Hocası Murat', type: 'ogretmen' },
  ];
  let bulkTimer = null;   // {at: oyun dk, src, lines}
  function bulkCandidates() {
    const out = [];
    for (const id of menuRecipes()) {
      const r = D().recipes[id];
      const ok = [r.base].concat(r.required).every(x => !D().ingredients[x] || KS.inv.get(x) >= 2);
      if (ok || id === 'cay') out.push({ type: 'recipe', id });
    }
    for (const [id, p] of Object.entries(D().products)) if (KS.isProductUnlocked(id) && KS.prod.get(id) >= 2) out.push({ type: 'product', id });
    return out;
  }
  function planBulk() {
    const s = S(), t = s.today;
    if (!t || s.phase !== 'open' || s.level < 2 || bulkTimer) return;
    const maxCalls = (KS.todayEvent() || {}).typeMult ? 3 : 2;
    if ((t.meta.bulkCalls || 0) >= maxCalls) return;
    if (s.time > 960) return;
    const cand = bulkCandidates(); if (cand.length < 1) return;
    const src = U().pick(BULK_SOURCES);
    const lines = [];
    const hasCay = cand.find(c => c.id === 'cay');
    const n = 3;
    // çay ağırlıklı klasik öğretmenler odası siparişi
    if (hasCay && src.from === 'Öğretmenler Odası') { lines.push({ type: 'recipe', id: 'cay' }); lines.push({ type: 'recipe', id: 'cay' }); }
    while (lines.length < n) {
      const c = U().pick(cand);
      const line = c.type === 'recipe' ? { type: 'recipe', id: c.id, want: (D().recipes[c.id].defaults || []).slice() } : { type: 'product', id: c.id };
      lines.push(line);
    }
    t.meta.bulkCalls = (t.meta.bulkCalls || 0) + 1;
    bulkTimer = { at: s.time + U().randInt(6, 12), src, lines };
    snd('phone');
    const label = lines.map(l => KS.Recipes.lineLabel(l)).join(', ');
    KS.notify('📞 ' + src.from + ' arıyor: "' + label + '" istiyorlar. ' + src.name + ' birazdan gelip alacak — bahşiş bol!', 'info');
    KS.bus.emit('bulkOrder', { phase: 'call', src, lines });
  }
  function updateBulk() {
    const s = S();
    if (!bulkTimer || s.phase !== 'open') { if (s.phase !== 'open') bulkTimer = null; return; }
    if (s.time < bulkTimer.at) return;
    const b = bulkTimer; bulkTimer = null;
    if (!KS.Customers || !KS.Customers.spawn) return;
    const lines = b.lines.map(l => (l.want ? Object.assign({}, l, { want: l.want.slice() }) : Object.assign({}, l)));
    const c = KS.Customers.spawn({ type: b.src.type, name: b.src.name, lines });
    if (c) {
      c.bulk = true; c.bulkFrom = b.src.from; c.tipBonus = 1.8;
      c.patienceMax *= 1.7; c.patience = c.patienceMax;
    }
  }

  // ---------------------------------------------------------------------------
  // OLAY DİNLEYİCİLERİ
  // ---------------------------------------------------------------------------
  function onServed(info) {
    if (!info || !info.customer) return;
    ensure();
    const c = info.customer, L = life(), m = S().today.meta;
    if (info.quality >= 0.9) L.perfect++;
    const pr = c.patienceAtPay != null ? c.patienceAtPay : 0;
    if (pr >= 0.6) { m.fast++; L.fast++; }
    if (c.lines && c.lines.length >= 2) { m.combos++; L.combos++; }
    if (c.vip) { L.vip++; if (info.quality >= 0.9) { L.vipHappy++; m.vipHappy++; } }
    if (c.bulk) {
      L.bulk++; m.bulk++;
      const xp = 25;
      KS.addXP(xp);
      KS.notify('🫖 ' + (c.bulkFrom || 'Toplu sipariş') + ' siparişi teslim edildi! +' + xp + ' XP', 'good');
    }
    checkGoals(false);
    checkAchievements();
  }
  function onLeft(info) {
    if (!info) return;
    if (info.angry) life().angry++;
    if (info.inspector && info.cleanliness > 80) { life().inspectorsPassed++; checkAchievements(); }
    checkGoals(false);
  }
  function onBeforeDayEnd() {
    ensure();
    payInstallments();
    checkGoals(true);
    settleWeek();
  }
  function onDayEnd(report) {
    if (!report) return;
    ensure();
    const L = life(), s = S();
    // ömür boyu satışlar
    for (const [id, n] of Object.entries(report.sales || {})) s.stats.sales[id] = (s.stats.sales[id] || 0) + n;
    // rekorlar
    const recs = [];
    const rec = (key, val, label) => { if (val > (L[key] || 0)) { if ((L[key] || 0) > 0) recs.push(label); L[key] = val; } };
    rec('bestNet', report.net || 0, '📈 En kârlı gün');
    rec('bestRevenue', report.revenue || 0, '🧾 En yüksek ciro');
    rec('bestServed', report.served || 0, '🙋 En çok müşteri');
    rec('bestTips', report.tips || 0, '🪙 En çok bahşiş');
    if ((report.served || 0) >= 20 && !(report.lost > 0) && !(report.angry > 0)) L.flawlessDays++;
    report.records = recs;
    report.goals = goals().map(g => ({ text: g.text, icon: g.icon, done: !!g.done, reward: g.reward }));
    report.campaign = today().campaign || null;
    report.debt = debt();
    checkAchievements();
    // gün sonunda biriken başarımları hemen işle (rapora eklensin)
    while (achQueue.length) { achShowT = 0; flushAchievements(0); }
    report.achievements = ((today().meta || {}).ach || []).map(id => ACH_BY_ID[id]).filter(Boolean).map(a => ({ id: a.id, name: a.name, icon: a.icon }));
    // haftalık sözleşme ve kârlı gün serisi rapora işlenir (seri ödülü nete dahil)
    const wk = weekInfo();
    report.week = wk && { n: wk.n, start: wk.start, target: wk.target, revenue: wk.revenue, reward: wk.reward, done: !!wk.done, paid: !!wk.paid, paidDay: wk.paidDay || 0, failed: !!wk.failed };
    report.streak = updateStreak(report);
    // ödüller rapordaki neti ve kasayı güncellesin
    report.bonus = today().bonus || 0;
    const expenses = Object.values(today().expenses || {}).reduce((a, b) => a + b, 0);
    report.expenses = Object.assign({}, today().expenses); report.expenseTotal = expenses;
    report.net = (report.revenue || 0) + (report.tips || 0) + report.bonus - expenses;
    report.money = s.money; report.level = s.level;
    if (s.history.length) Object.assign(s.history[s.history.length - 1], { net: report.net, tips: report.tips || 0, perfect: report.perfect || 0, lost: report.lost || 0, money: s.money });
    bulkTimer = null;
  }

  // ---------------------------------------------------------------------------
  // KANCALAR (müşteri modülü okur)
  // ---------------------------------------------------------------------------
  function installHooks() {
    KS.hooks.demandMult = () => camp('demand');
    KS.hooks.patienceMult = () => camp('patience');
    KS.hooks.tipMult = () => camp('tip');
    KS.hooks.studentMult = () => { const c = campaign(); return c && c.studentBoost ? 1.5 : 1; };
  }

  // ---------------------------------------------------------------------------
  // MODÜL
  // ---------------------------------------------------------------------------
  let periodSeen = null, acc = 0;
  function init() {
    installHooks();
    const on = (ev, fn) => KS.bus.on(ev, d => { try { fn(d); } catch (e) { console.error('[meta]', ev, e); } });
    on('newGame', () => { ensure(); achQueue = []; bulkTimer = null; });
    on('stateLoaded', () => { ensure(); achQueue = []; bulkTimer = null; });
    on('prepStart', () => { ensure(); rollGoals(); bulkTimer = null; checkAchievements(); });
    on('open', () => {
      ensure(); rollGoals();
      const c = campaign();
      if (c && c.rep) { KS.addRep(c.rep); KS.notify(c.icon + ' ' + c.name + ': ilk gelenlere ikram ediliyor, itibarın arttı!', 'good'); }
    });
    on('customerServed', onServed);
    on('customerLeft', onLeft);
    on('beforeDayEnd', onBeforeDayEnd);
    on('dayEnd', onDayEnd);
    on('levelUp', () => checkAchievements());
    on('upgradeBought', () => checkAchievements());
    on('staffChanged', () => checkAchievements());
    on('itemTrashed', () => { life().trashed++; });
    on('periodChange', p => {
      if (!p || S().phase !== 'open' || p === periodSeen) return;
      periodSeen = p;
      // ders saatinde (sakin) ara sıra toplu sipariş gelir
      const ev = KS.todayEvent() || {};
      const chance = p.type === 'ders' ? (ev.typeMult ? 0.6 : 0.33) : p.type === 'aksam' ? 0.3 : 0;
      if (Math.random() < chance) planBulk();
    });
  }
  function update(dt, realDt) {
    flushAchievements(realDt || 0.016);
    if (!dt) return;
    updateBulk();
    acc += dt;
    if (acc > 1) { acc = 0; checkGoals(false); checkAchievements(); }
  }

  KS.Meta = {
    goals, goalProgress, rollGoals,
    achievements: () => ACH.slice(), achProgress, isUnlocked,
    campaign, canCampaign, runCampaign,
    loans, loanOffer, canLoan, takeLoan, payOffLoan, debt, dailyInstallment,
    week: weekInfo, weekRevenue, streak: streakInfo,
    lifeStats: () => life(),
    _planBulk: planBulk,
  };
  KS.registerModule({ name: 'meta', order: 60, init, update });
})(window.KS);
