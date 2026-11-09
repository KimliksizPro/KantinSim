/* KantinSim — Ses (WebAudio ile tamamen prosedürel; ses dosyası yok)
 * Sahibi: Art & Ses. API: KS.audio.play(name,{vol,rate}), setLoop(key,on,type), unlock(), setMuted(bool), setMusic(bool)
 * AudioContext yalnızca ilk kullanıcı etkileşiminde (unlock) oluşturulur. İzin yoksa her şey sessizce no-op olur.
 */
(function (KS) {
  'use strict';
  let ac = null, master = null, sfxBus = null, musicBus = null, comp = null, noiseBuf = null;
  let muted = false, musicWanted = true, musicOn = false, failed = false;
  const MASTER_VOL = 0.85, MUSIC_VOL = 0.09;
  const loops = {};          // key -> {type, nodes, timer, gain}
  const pendingLoops = {};   // unlock öncesi açılan döngüler
  const lastPlay = {};

  function ensure() {
    if (ac || failed) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { failed = true; return null; }
    try {
      ac = new AC();
      comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      master = ac.createGain(); master.gain.value = muted ? 0 : MASTER_VOL;
      sfxBus = ac.createGain(); sfxBus.gain.value = 1;
      musicBus = ac.createGain(); musicBus.gain.value = 0;
      const mlp = ac.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 3200;
      sfxBus.connect(comp); musicBus.connect(mlp); mlp.connect(comp); comp.connect(master); master.connect(ac.destination);
      const len = ac.sampleRate * 2;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; failed = true; }
    return ac;
  }
  const ready = () => ac && ac.state === 'running';

  // ---------------------------------------------------------------------------
  // SENTEZ YARDIMCILARI
  // ---------------------------------------------------------------------------
  // ton: {type, f, f2, t (başlangıç ofseti), dur, vol, a (atak), dest, curve:'exp'|'lin', detune}
  function tone(o) {
    const t0 = ac.currentTime + (o.t || 0), dur = o.dur || 0.2, a = o.a != null ? o.a : 0.005;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f), t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t0 + (o.glide || dur));
    if (o.detune) osc.detune.value = o.detune;
    const v = (o.vol == null ? 0.3 : o.vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (o.filter) { const f = ac.createBiquadFilter(); f.type = o.filter; f.frequency.value = o.ff || 2000; f.Q.value = o.q || 1; osc.connect(f); node = f; }
    node.connect(g); g.connect(o.dest || sfxBus);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    return { osc, g };
  }
  // gürültü: {t, dur, vol, type (filter), f, f2, q, a, dest}
  function noise(o) {
    const t0 = ac.currentTime + (o.t || 0), dur = o.dur || 0.2, a = o.a != null ? o.a : 0.005;
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f || 1000, t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + dur);
    const g = ac.createGain(), v = o.vol == null ? 0.3 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
    return { src, f, g };
  }
  function bellPartials(t, f, dur, vol, dest) {
    const ratios = [1, 2.0, 2.76, 5.4], vols = [1, 0.5, 0.35, 0.15];
    ratios.forEach((r, i) => tone({ t, f: f * r, dur: dur * (1 - i * 0.15), vol: vol * vols[i], a: 0.002, dest }));
  }

  // ---------------------------------------------------------------------------
  // SES EFEKTLERİ
  // ---------------------------------------------------------------------------
  const SFX = {
    pick(v) { tone({ f: 420, f2: 880, dur: 0.09, vol: 0.22 * v, type: 'sine', glide: 0.06 }); noise({ dur: 0.03, vol: 0.05 * v, f: 3000 }); },
    drop(v) { tone({ f: 260, f2: 110, dur: 0.14, vol: 0.28 * v, glide: 0.1 }); noise({ dur: 0.06, vol: 0.08 * v, type: 'lowpass', f: 900 }); },
    click(v) { tone({ f: 1500, dur: 0.035, vol: 0.12 * v, type: 'square', filter: 'highpass', ff: 900 }); },
    ding(v) {
      noise({ dur: 0.06, vol: 0.12 * v, f: 2500, q: 2 });
      tone({ t: 0.03, f: 300, f2: 120, dur: 0.08, vol: 0.12 * v, type: 'triangle' });
      bellPartials(0.07, 1318, 0.9, 0.16 * v);
    },
    coin(v) { tone({ f: 988, dur: 0.09, vol: 0.13 * v, type: 'square', filter: 'lowpass', ff: 3500 }); tone({ t: 0.075, f: 1319, dur: 0.32, vol: 0.13 * v, type: 'square', filter: 'lowpass', ff: 3500 }); },
    bell(v) {
      // elektrikli okul zili: metalik kısmi tonlar, ~24 Hz çekiç modülasyonu
      const t0 = ac.currentTime, dur = 1.55;
      const out = ac.createGain(); out.gain.setValueAtTime(0.0001, t0); out.gain.linearRampToValueAtTime(0.32 * v, t0 + 0.03);
      out.gain.setValueAtTime(0.32 * v, t0 + dur - 0.25); out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const am = ac.createGain(); am.gain.value = 0.5;
      const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 24;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG); lfoG.connect(am.gain);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.7;
      const oscs = [[1180, 0.5, 'triangle'], [2630, 0.35, 'sine'], [3710, 0.25, 'sine'], [4950, 0.12, 'sine']].map(p => {
        const o = ac.createOscillator(), g = ac.createGain(); o.type = p[2]; o.frequency.value = p[0]; g.gain.value = p[1];
        o.connect(g); g.connect(am); o.start(t0); o.stop(t0 + dur + 0.05); return o;
      });
      const nz = ac.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true; const ng = ac.createGain(); ng.gain.value = 0.12;
      nz.connect(ng); ng.connect(am); nz.start(t0); nz.stop(t0 + dur + 0.05);
      am.connect(bp); bp.connect(out); out.connect(sfxBus);
      lfo.start(t0); lfo.stop(t0 + dur + 0.05);
      void oscs;
    },
    error(v) { tone({ f: 200, f2: 150, dur: 0.16, vol: 0.14 * v, type: 'square', filter: 'lowpass', ff: 1200 }); tone({ t: 0.13, f: 160, f2: 110, dur: 0.2, vol: 0.14 * v, type: 'square', filter: 'lowpass', ff: 1000 }); },
    trash(v) { noise({ dur: 0.28, vol: 0.2 * v, f: 1800, f2: 500, q: 0.8 }); tone({ t: 0.08, f: 140, f2: 60, dur: 0.22, vol: 0.25 * v }); noise({ t: 0.1, dur: 0.15, vol: 0.12 * v, type: 'lowpass', f: 600 }); },
    pour(v) {
      const n = noise({ dur: 0.9, vol: 0.13 * v, f: 700, f2: 1700, q: 5, a: 0.06 });
      for (let i = 0; i < 6; i++) tone({ t: 0.05 + i * 0.12 + Math.random() * 0.05, f: 500 + i * 70, f2: 800 + i * 80, dur: 0.07, vol: 0.05 * v });
      void n;
    },
    fry_in(v) { noise({ dur: 1.1, vol: 0.28 * v, type: 'highpass', f: 2500, a: 0.01 }); noise({ dur: 0.5, vol: 0.15 * v, f: 500, q: 1.5 }); for (let i = 0; i < 8; i++) noise({ t: Math.random() * 0.8, dur: 0.03, vol: 0.1 * v, f: 3000 + Math.random() * 3000, q: 3 }); },
    toast_done(v) { bellPartials(0, 1760, 0.8, 0.12 * v); bellPartials(0.16, 2093, 0.9, 0.1 * v); },
    burn(v) { tone({ f: 330, f2: 180, dur: 0.5, vol: 0.13 * v, type: 'sawtooth', filter: 'lowpass', ff: 900 }); for (let i = 0; i < 10; i++) noise({ t: Math.random() * 0.5, dur: 0.025, vol: 0.12 * v, f: 2000 + Math.random() * 4000, q: 4 }); },
    door(v) { bellPartials(0, 1319, 0.7, 0.13 * v); bellPartials(0.28, 1047, 0.9, 0.13 * v); },
    phone(v) {
      for (let r = 0; r < 2; r++) {
        const t = r * 0.5;
        for (let k = 0; k < 8; k++) { tone({ t: t + k * 0.045, f: 1320, dur: 0.04, vol: 0.07 * v, type: 'square', filter: 'lowpass', ff: 3000 }); tone({ t: t + k * 0.045 + 0.022, f: 1100, dur: 0.04, vol: 0.07 * v, type: 'square', filter: 'lowpass', ff: 3000 }); }
      }
    },
    scooter(v) {
      const t0 = ac.currentTime, dur = 1.6;
      const o = ac.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(70, t0); o.frequency.linearRampToValueAtTime(115, t0 + dur * 0.55); o.frequency.linearRampToValueAtTime(85, t0 + dur);
      const vib = ac.createOscillator(); vib.frequency.value = 28; const vg = ac.createGain(); vg.gain.value = 9; vib.connect(vg); vg.connect(o.frequency);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.12 * v, t0 + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(lp); lp.connect(g); g.connect(sfxBus);
      o.start(t0); vib.start(t0); o.stop(t0 + dur + 0.05); vib.stop(t0 + dur + 0.05);
      noise({ dur: dur, vol: 0.04 * v, type: 'lowpass', f: 500, a: 0.6 });
    },
    levelup(v) {
      [523, 659, 784, 1047].forEach((f, i) => tone({ t: i * 0.1, f, dur: 0.3, vol: 0.14 * v, type: 'triangle' }));
      tone({ t: 0.4, f: 1319, dur: 0.6, vol: 0.12 * v, type: 'triangle' }); tone({ t: 0.4, f: 1568, dur: 0.6, vol: 0.08 * v, type: 'sine' });
      for (let i = 0; i < 6; i++) tone({ t: 0.45 + i * 0.06, f: 2400 + Math.random() * 1600, dur: 0.12, vol: 0.04 * v });
    },
    angry(v) {
      for (let s = 0; s < 2; s++) {
        const t = s * 0.18;
        tone({ t, f: 170 - s * 25, f2: 110 - s * 15, dur: 0.17, vol: 0.13 * v, type: 'sawtooth', filter: 'bandpass', ff: 700, q: 2 });
        tone({ t, f: 340 - s * 50, f2: 220 - s * 30, dur: 0.17, vol: 0.05 * v, type: 'sawtooth', filter: 'bandpass', ff: 1200, q: 3 });
      }
    },
    happy(v) { tone({ f: 660, f2: 990, dur: 0.12, vol: 0.12 * v, type: 'triangle', glide: 0.1 }); tone({ t: 0.1, f: 990, f2: 1320, dur: 0.22, vol: 0.12 * v, type: 'triangle', glide: 0.12 }); },
    knead(v) { noise({ dur: 0.16, vol: 0.2 * v, type: 'lowpass', f: 600, f2: 250, a: 0.02 }); tone({ f: 120 + Math.random() * 40, f2: 80, dur: 0.12, vol: 0.12 * v }); },
    wipe(v) { noise({ dur: 0.3, vol: 0.14 * v, f: 2200, f2: 5200, q: 1.2, a: 0.05 }); },
    sizzle_start(v) { noise({ dur: 0.7, vol: 0.3 * v, type: 'highpass', f: 3000, a: 0.005 }); for (let i = 0; i < 6; i++) noise({ t: Math.random() * 0.5, dur: 0.02, vol: 0.12 * v, f: 4000 + Math.random() * 3000, q: 4 }); },
    ready(v) { [880, 1109, 1319].forEach((f, i) => tone({ t: i * 0.09, f, dur: 0.35, vol: 0.11 * v, type: 'sine' })); },
    plate(v) { tone({ f: 2200, dur: 0.18, vol: 0.09 * v }); tone({ f: 3350, dur: 0.12, vol: 0.06 * v }); noise({ dur: 0.02, vol: 0.08 * v, f: 4000 }); tone({ f: 220, f2: 140, dur: 0.06, vol: 0.12 * v }); },
    squeeze(v) { noise({ dur: 0.28, vol: 0.16 * v, f: 500, f2: 1400, q: 3, a: 0.02 }); tone({ f: 180, f2: 90, dur: 0.2, vol: 0.06 * v, type: 'triangle' }); },
    sprinkle(v) { for (let i = 0; i < 4; i++) noise({ t: i * 0.055, dur: 0.04, vol: 0.09 * v, type: 'highpass', f: 5000 }); },
    tick(v) { tone({ f: 1800, dur: 0.03, vol: 0.1 * v, a: 0.001 }); noise({ dur: 0.015, vol: 0.05 * v, f: 3000, q: 3 }); },
    alarm(v) { for (let i = 0; i < 3; i++) tone({ t: i * 0.22, f: 880, dur: 0.14, vol: 0.12 * v, type: 'square', filter: 'lowpass', ff: 2500, a: 0.004 }); },
  };

  function play(name, o) {
    try {
      if (muted || !ready()) return;
      const fn = SFX[name]; if (!fn) return;
      const nowT = ac.currentTime;
      if (lastPlay[name] && nowT - lastPlay[name] < 0.035) return; // aynı karede çoklu tetiklemeyi sınırla
      lastPlay[name] = nowT;
      const v = o && o.vol != null ? Math.max(0, o.vol) : 1;
      fn(v);
    } catch (e) { /* sessiz */ }
  }

  // ---------------------------------------------------------------------------
  // SÜREKLİ DÖNGÜLER: sizzle | fry | boil | hum
  // ---------------------------------------------------------------------------
  function startLoop(key, type) {
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, ac.currentTime); g.connect(sfxBus);
    const L = { type, gain: g, nodes: [], timer: null };
    const nsrc = (f, ftype, q, vol) => {
      const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const fl = ac.createBiquadFilter(); fl.type = ftype; fl.frequency.value = f; fl.Q.value = q || 1;
      const gg = ac.createGain(); gg.gain.value = vol;
      s.connect(fl); fl.connect(gg); gg.connect(g); s.start(0, Math.random() * 1.5); L.nodes.push(s);
      return gg;
    };
    let target = 0.1;
    if (type === 'sizzle') {
      nsrc(4200, 'highpass', 0.7, 0.5); nsrc(2400, 'bandpass', 1.2, 0.25);
      target = 0.16;
      L.timer = setInterval(() => { try { if (Math.random() < 0.7) noise({ dur: 0.025, vol: 0.06, f: 2500 + Math.random() * 5000, q: 5, dest: g }); } catch (e) { /* */ } }, 70);
    } else if (type === 'fry') {
      nsrc(3000, 'highpass', 0.6, 0.35); nsrc(600, 'bandpass', 1.0, 0.3);
      target = 0.15;
      L.timer = setInterval(() => { try { for (let i = 0; i < 2; i++) if (Math.random() < 0.8) tone({ t: Math.random() * 0.08, f: 180 + Math.random() * 260, f2: 400 + Math.random() * 300, dur: 0.05, vol: 0.12, dest: g, glide: 0.04 }); } catch (e) { /* */ } }, 90);
    } else if (type === 'boil') {
      nsrc(380, 'lowpass', 0.8, 0.5); nsrc(1400, 'bandpass', 2, 0.05);
      target = 0.12;
      L.timer = setInterval(() => { try { if (Math.random() < 0.55) tone({ f: 120 + Math.random() * 160, f2: 260 + Math.random() * 200, dur: 0.09, vol: 0.1, dest: g, glide: 0.07 }); } catch (e) { /* */ } }, 150);
    } else { // hum
      const o1 = ac.createOscillator(); o1.type = 'sine'; o1.frequency.value = 100;
      const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 200;
      const g1 = ac.createGain(); g1.gain.value = 0.35; const g2 = ac.createGain(); g2.gain.value = 0.12;
      o1.connect(g1); g1.connect(g); o2.connect(g2); g2.connect(g); o1.start(); o2.start(); L.nodes.push(o1, o2);
      nsrc(800, 'bandpass', 1, 0.08);
      target = 0.09;
    }
    g.gain.linearRampToValueAtTime(target, ac.currentTime + 0.25);
    loops[key] = L;
  }
  function stopLoop(key) {
    const L = loops[key]; if (!L) return;
    delete loops[key];
    try {
      if (L.timer) clearInterval(L.timer);
      const t = ac.currentTime;
      L.gain.gain.cancelScheduledValues(t); L.gain.gain.setValueAtTime(L.gain.gain.value, t); L.gain.gain.linearRampToValueAtTime(0.0001, t + 0.25);
      for (const n of L.nodes) { try { n.stop(t + 0.3); } catch (e) { /* */ } }
      setTimeout(() => { try { L.gain.disconnect(); } catch (e) { /* */ } }, 400);
    } catch (e) { /* */ }
  }
  function setLoop(key, on, type) {
    try {
      key = String(key || type || 'loop'); type = type || 'sizzle';
      if (!ac || !ready()) { if (on) pendingLoops[key] = type; else delete pendingLoops[key]; if (!on && loops[key] && ac) stopLoop(key); return; }
      if (on) {
        if (loops[key]) { if (loops[key].type === type) return; stopLoop(key); }
        startLoop(key, type);
      } else stopLoop(key);
    } catch (e) { /* sessiz */ }
  }

  // ---------------------------------------------------------------------------
  // MÜZİK (hafif, neşeli prosedürel döngü)
  // ---------------------------------------------------------------------------
  const BPM = 104, BEAT = 60 / BPM;
  // I - vi - IV - V (Do majör) + ikinci yarıda ii - V
  const CHORDS = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50], [48, 52, 55], [45, 48, 52], [50, 53, 57], [43, 47, 50]];
  const PENTA = [60, 62, 64, 67, 69, 72, 74, 76];
  let musicTimer = null, nextBeat = 0, beatIdx = 0, melody = [];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function makeMelody() {
    melody = [];
    let p = 3;
    for (let i = 0; i < 32; i++) {
      if (Math.random() < 0.38) { melody.push(null); continue; }
      p = Math.max(0, Math.min(PENTA.length - 1, p + Math.floor(Math.random() * 5) - 2));
      melody.push(PENTA[p]);
    }
  }
  function pluck(t, midi, vol, dur, type) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'triangle'; o.frequency.value = mtof(midi);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function scheduleMusic() {
    if (!ready()) return;
    while (nextBeat < ac.currentTime + 0.35) {
      const bar = Math.floor(beatIdx / 4) % CHORDS.length, beat = beatIdx % 4, ch = CHORDS[bar];
      if (beatIdx % 64 === 0) makeMelody();
      // bas
      if (beat === 0 || beat === 2) pluck(nextBeat, ch[0] - 12, 0.5, BEAT * 1.6, 'sine');
      // arpej (sekizlik)
      for (let h = 0; h < 2; h++) { const n = ch[(beat * 2 + h) % 3] + 12; pluck(nextBeat + h * BEAT / 2, n, 0.16, BEAT * 0.9, 'triangle'); }
      // melodi
      for (let h = 0; h < 2; h++) {
        const m = melody[((beatIdx % 16) * 2 + h) % 32];
        if (m != null && (beatIdx % 32) >= 16) pluck(nextBeat + h * BEAT / 2, m, 0.2, BEAT * 0.8, 'square');
        else if (m != null && h === 0) pluck(nextBeat, m, 0.14, BEAT * 1.2, 'sine');
      }
      // hafif hi-hat
      if (beat % 2 === 1) { try { noise({ t: nextBeat - ac.currentTime, dur: 0.04, vol: 0.05, type: 'highpass', f: 7000, dest: musicBus }); } catch (e) { /* */ } }
      nextBeat += BEAT; beatIdx++;
    }
  }
  function startMusic() {
    if (musicOn || !ready()) return;
    musicOn = true;
    nextBeat = ac.currentTime + 0.1; beatIdx = 0; makeMelody();
    musicBus.gain.cancelScheduledValues(ac.currentTime);
    musicBus.gain.setValueAtTime(0.0001, ac.currentTime); musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, ac.currentTime + 2);
    musicTimer = setInterval(() => { try { scheduleMusic(); } catch (e) { /* */ } }, 100);
  }
  function stopMusic() {
    if (!musicOn) return;
    musicOn = false;
    try { musicBus.gain.cancelScheduledValues(ac.currentTime); musicBus.gain.setValueAtTime(musicBus.gain.value, ac.currentTime); musicBus.gain.linearRampToValueAtTime(0.0001, ac.currentTime + 0.6); } catch (e) { /* */ }
    if (musicTimer) clearInterval(musicTimer); musicTimer = null;
  }
  function syncMusic() { if (musicWanted && !muted && ready()) startMusic(); else if (ac) stopMusic(); }

  // ---------------------------------------------------------------------------
  // GENEL API
  // ---------------------------------------------------------------------------
  function unlock() {
    try {
      if (!ensure()) return;
      const after = () => {
        for (const k of Object.keys(pendingLoops)) { const ty = pendingLoops[k]; delete pendingLoops[k]; setLoop(k, true, ty); }
        syncMusic();
      };
      if (ac.state === 'suspended') ac.resume().then(after).catch(() => {}); else after();
    } catch (e) { /* sessiz */ }
  }
  function setMuted(m) {
    muted = !!m;
    try { if (master) { const t = ac.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_VOL, t + 0.08); } } catch (e) { /* */ }
    syncMusic();
  }
  function setMusic(on) { musicWanted = !!on; try { syncMusic(); } catch (e) { /* */ } }

  // ilk kullanıcı etkileşiminde aç (HTML UI düğmeleri dahil)
  const firstGesture = () => { unlock(); if (ready()) { window.removeEventListener('pointerdown', firstGesture, true); window.removeEventListener('keydown', firstGesture, true); } };
  try { window.addEventListener('pointerdown', firstGesture, true); window.addEventListener('keydown', firstGesture, true); } catch (e) { /* */ }

  KS.audio = {
    play, setLoop, unlock, setMuted, setMusic,
    stopAllLoops() { for (const k of Object.keys(loops)) stopLoop(k); for (const k of Object.keys(pendingLoops)) delete pendingLoops[k]; },
    get muted() { return muted; },
    get musicEnabled() { return musicWanted; },
    names: Object.keys(SFX),
  };

  // Ayarlarla senkron: boot'ta, kayıt yüklenince, yeni oyunda ve ayar değişince
  let lastSig = '';
  function applySettings() {
    try {
      const s = KS.state && KS.state.settings; if (!s) return;
      const sig = (s.sound !== false) + '|' + (s.music !== false);
      if (sig === lastSig) return;
      lastSig = sig;
      setMuted(s.sound === false);
      setMusic(s.music !== false);
    } catch (e) { /* */ }
  }
  if (KS.registerModule) {
    let acc = 0;
    KS.registerModule({
      name: 'audio', order: -100,
      init() {
        applySettings();
        if (KS.bus) {
          KS.bus.on('stateLoaded', () => { lastSig = ''; applySettings(); });
          KS.bus.on('newGame', () => { lastSig = ''; applySettings(); });
          KS.bus.on('dayEnd', () => { for (const k of Object.keys(loops)) stopLoop(k); });
        }
      },
      update(dt, realDt) { acc += realDt || 0; if (acc > 0.5) { acc = 0; applySettings(); } },
    });
  }
})(window.KS);
