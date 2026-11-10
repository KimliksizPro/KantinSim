/* KantinSim — 3D koridor (servis penceresinin arkası)
 * Three.js ile prosedürel bir okul koridoru: duvar, pencereler (saat/hava durumuna göre gökyüzü),
 * dolaplar, kapılar, pano, tavan lambaları ve arka planda yürüyen öğrenciler.
 * Sahne, 2D oyun canvas'ının ARKASINA yerleştirilmiş ayrı bir WebGL canvas'a çizilir; Art.drawBackground
 * bu bölgeyi 2D canvas'ta şeffaf bırakır (GPU'dan geri okuma yok). Çerçeve, müşteriler, tezgah ve mutfak
 * eskisi gibi 2D çizilir; oynanış (sürükle-bırak, tıklama) hiç değişmez.
 * Three.js yoksa / WebGL açılamazsa sessizce 2D çizime geri dönülür.
 */
(function (KS) {
  'use strict';
  const PREF_KEY = 'kantinsim_3d';
  const FPS = 30;

  let enabled = true;
  try { const v = localStorage.getItem(PREF_KEY); if (v === '0') enabled = false; } catch (e) { /* */ }

  let failed = false, ready = false;
  let renderer, scene, camera, glCanvas;
  let lights = {}, skyCanvas, skyBase, skyTex, shafts = [], fluo = [];
  let students = [], lastT = null, renderAcc = 1, skyKey = '', rainAcc = 0;
  let curW = 0, curH = 0;
  // Uyarlanır kalite: 0 = gölgeli tam çözünürlük, 1 = gölgesiz, 2 = gölgesiz + düşük çözünürlük, sonra 2D'ye dönüş
  let quality = 0, perfT0 = 0, perfN = 0, perfGrace = 0;

  const THREE_ = () => window.THREE;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // ---------------------------------------------------------------------------
  // Dokular
  // ---------------------------------------------------------------------------
  function canvasTex(w, h, fn, repeat) {
    const T = THREE_();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    fn(c.getContext('2d'), w, h);
    const tx = new T.CanvasTexture(c);
    tx.encoding = T.sRGBEncoding;
    tx.anisotropy = 4;
    if (repeat) { tx.wrapS = tx.wrapT = T.RepeatWrapping; tx.repeat.set(repeat[0], repeat[1]); }
    return tx;
  }
  function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function terrazzo(g, w, h) {
    g.fillStyle = '#d4cabb'; g.fillRect(0, 0, w, h);
    const R = seeded(7), cols = ['#857c70', '#a89e90', '#f6f1e8', '#a5694a', '#6f7f86', '#c9bfae'];
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = cols[(R() * cols.length) | 0]; g.globalAlpha = 0.35 + R() * 0.5;
      const s = 1 + R() * 3; g.fillRect(R() * w, R() * h, s, s * (0.6 + R() * 0.6));
    }
    g.globalAlpha = 1; g.strokeStyle = 'rgba(90,80,70,0.35)'; g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
  }
  function wallPaint(g, w, h) {
    g.fillStyle = '#f1e6cb'; g.fillRect(0, 0, w, h);
    const R = seeded(91);
    for (let i = 0; i < 1500; i++) { g.fillStyle = R() < 0.5 ? 'rgba(120,90,50,0.05)' : 'rgba(255,255,255,0.1)'; g.fillRect(R() * w, R() * h, 2, 2); }
  }
  function cork(g, w, h) {
    g.fillStyle = '#c99a62'; g.fillRect(0, 0, w, h);
    const R = seeded(55);
    for (let i = 0; i < 900; i++) { g.fillStyle = R() < 0.5 ? 'rgba(120,70,30,0.3)' : 'rgba(255,220,170,0.3)'; g.fillRect(R() * w, R() * h, 2, 2); }
    const papers = [[12, 10, 70, 60, '#fff', '#e8443a'], [95, 8, 60, 46, '#fff4a8', '#3f7ac2'], [168, 14, 70, 78, '#fff', '#4fae5a'],
      [20, 82, 78, 56, '#ffd6e0', '#f0b13b'], [110, 66, 52, 70, '#d8efff', '#e8443a'], [176, 100, 60, 44, '#fff4a8', '#3f7ac2']];
    papers.forEach((p, i) => {
      g.save(); g.translate(p[0] + p[2] / 2, p[1] + p[3] / 2); g.rotate((R() - 0.5) * 0.14);
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(-p[2] / 2 + 3, -p[3] / 2 + 3, p[2], p[3]);
      g.fillStyle = p[4]; g.fillRect(-p[2] / 2, -p[3] / 2, p[2], p[3]);
      g.fillStyle = 'rgba(60,60,80,0.55)';
      if (i === 2) { g.fillStyle = '#ffcf33'; g.beginPath(); g.arc(16, -20, 8, 0, 7); g.fill(); g.fillStyle = '#3f7ac2'; g.fillRect(-18, -4, 28, 24); g.fillStyle = '#e8443a'; g.beginPath(); g.moveTo(-22, -4); g.lineTo(-4, -22); g.lineTo(14, -4); g.fill(); }
      else for (let l = 0; l < 5; l++) if (-p[3] / 2 + 12 + l * 9 < p[3] / 2 - 4) g.fillRect(-p[2] / 2 + 7, -p[3] / 2 + 12 + l * 9, p[2] - 14 - (l % 2) * 10, 3);
      g.fillStyle = p[5]; g.beginPath(); g.arc(0, -p[3] / 2 + 5, 4.5, 0, 7); g.fill();
      g.restore();
    });
  }
  function poster(g, w, h) {
    g.fillStyle = '#fffaf0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4fae5a'; g.fillRect(0, 0, w, h * 0.18);
    g.fillStyle = '#fff'; g.font = '900 ' + (h * 0.11 | 0) + 'px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SAĞLIKLI', w / 2, h * 0.095);
    g.fillStyle = '#e8443a'; g.beginPath(); g.arc(w * 0.36, h * 0.5, w * 0.16, 0, 7); g.fill();
    g.fillStyle = '#f39a22'; g.beginPath(); g.moveTo(w * 0.6, h * 0.36); g.lineTo(w * 0.85, h * 0.44); g.lineTo(w * 0.58, h * 0.7); g.closePath(); g.fill();
    g.fillStyle = '#2f5a8a'; g.font = '900 ' + (h * 0.12 | 0) + 'px Nunito, sans-serif'; g.fillText('BESLEN!', w / 2, h * 0.86);
  }
  function doorTex(label) {
    return (g, w, h) => {
      g.fillStyle = '#9a6a3a'; g.fillRect(0, 0, w, h);
      const R = seeded(label.length * 31);
      for (let i = 0; i < 60; i++) { g.strokeStyle = 'rgba(70,40,15,' + (0.08 + R() * 0.12).toFixed(2) + ')'; g.lineWidth = 1 + R() * 2; const x = R() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, h * 0.3, x - 6, h * 0.7, x + 3, h); g.stroke(); }
      g.fillStyle = '#cfe6f2'; g.fillRect(w * 0.25, h * 0.12, w * 0.5, h * 0.25);
      g.strokeStyle = '#5e3c1c'; g.lineWidth = 5; g.strokeRect(w * 0.25, h * 0.12, w * 0.5, h * 0.25);
      g.fillStyle = '#fff'; g.fillRect(w * 0.2, h * 0.44, w * 0.6, h * 0.08);
      g.fillStyle = '#2c3e66'; g.font = '800 ' + (h * 0.065 | 0) + 'px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, w / 2, h * 0.483);
      g.fillStyle = '#d8d8d0'; g.fillRect(w * 0.78, h * 0.55, w * 0.12, h * 0.025);
    };
  }

  // ---------------------------------------------------------------------------
  // Sahne kurulumu
  // ---------------------------------------------------------------------------
  function mat(color, o) { const T = THREE_(); return new T.MeshLambertMaterial(Object.assign({ color }, o || {})); }
  function box(w, h, d, m, x, y, z, parent) {
    const T = THREE_();
    const me = new T.Mesh(new T.BoxGeometry(w, h, d), m);
    me.position.set(x, y, z); (parent || scene).add(me);
    return me;
  }

  const WALL_Z = -6;
  const WINDOWS = [{ x: -3.7, w: 2.6 }, { x: 4.6, w: 2.6 }];
  const WIN_Y0 = 1.45, WIN_Y1 = 2.75;

  function build() {
    const T = THREE_();
    glCanvas = document.createElement('canvas');
    renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.setPixelRatio(1);
    glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); failed = true; hide(); }, false);
    glCanvas.id = 'scene3d';
    Object.assign(glCanvas.style, { position: 'absolute', pointerEvents: 'none', display: 'none' });
    const root = document.getElementById('game-root'), game = document.getElementById('game');
    if (!root || !game) throw new Error('game-root yok');
    root.insertBefore(glCanvas, game);

    scene = new T.Scene();
    scene.background = new T.Color('#e9dcc0');
    scene.fog = new T.Fog('#e9dcc0', 20, 40);

    camera = new T.PerspectiveCamera(24, 1142 / 276, 0.1, 60);
    camera.position.set(0.6, 1.55, 6);
    camera.lookAt(0.6, 1.25, WALL_Z);

    // Işıklar
    lights.hemi = new T.HemisphereLight('#fff6e6', '#9a8b74', 0.5); scene.add(lights.hemi);
    lights.amb = new T.AmbientLight('#ffffff', 0.12); scene.add(lights.amb);
    lights.key = new T.DirectionalLight('#fff4dc', 0.75);
    lights.key.position.set(-3, 7, 4); lights.key.target.position.set(0, 0, -4.5);
    lights.key.castShadow = true;
    lights.key.shadow.mapSize.set(1024, 512);
    Object.assign(lights.key.shadow.camera, { left: -10, right: 10, top: 5, bottom: -5, near: 1, far: 20 });
    lights.key.shadow.bias = -0.0015;
    scene.add(lights.key); scene.add(lights.key.target);
    lights.sun = new T.DirectionalLight('#ffe7b8', 0.35);
    lights.sun.position.set(0, 4, WALL_Z - 6); lights.sun.target.position.set(0, 0, 0);
    scene.add(lights.sun); scene.add(lights.sun.target);

    // Zemin, tavan
    const floor = new T.Mesh(new T.PlaneGeometry(40, 14), new T.MeshLambertMaterial({ map: canvasTex(256, 256, terrazzo, [16, 6]) }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -1); floor.receiveShadow = true; scene.add(floor);
    const ceil = new T.Mesh(new T.PlaneGeometry(40, 14), mat('#f3efe6'));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.3, -1); scene.add(ceil);
    for (let i = -3; i <= 3; i++) {
      const f = box(1.6, 0.05, 0.4, new T.MeshBasicMaterial({ color: '#fffdf2' }), i * 3.2, 3.27, -3.2);
      fluo.push(f);
      box(1.7, 0.04, 0.5, mat('#c8ccd0'), i * 3.2, 3.3, -3.2);
    }

    // Arka duvar (pencere boşluklu) — üst boya + alt lambri
    const wallMat = new T.MeshLambertMaterial({ map: canvasTex(256, 256, wallPaint, [6, 2]) });
    const lambriMat = mat('#6a9f97');
    const segs = [];
    let x0 = -20;
    for (const w of WINDOWS) { segs.push([x0, w.x - w.w / 2]); x0 = w.x + w.w / 2; }
    segs.push([x0, 20]);
    const wallBox = (xa, xb, ya, yb, m) => { const me = box(xb - xa, yb - ya, 0.2, m, (xa + xb) / 2, (ya + yb) / 2, WALL_Z - 0.1); me.receiveShadow = true; return me; };
    for (const [a, b] of segs) wallBox(a, b, 1.1, 3.3, wallMat);
    for (const w of WINDOWS) {
      wallBox(w.x - w.w / 2, w.x + w.w / 2, 1.1, WIN_Y0, wallMat);
      wallBox(w.x - w.w / 2, w.x + w.w / 2, WIN_Y1, 3.3, wallMat);
    }
    wallBox(-20, 20, 0, 1.1, lambriMat);
    box(40, 0.07, 0.08, mat('#9a6634'), 0, 1.12, WALL_Z + 0.03);   // küpeşte
    box(40, 0.12, 0.04, mat('#3b5a55'), 0, 0.06, WALL_Z + 0.02);   // süpürgelik

    // Pencereler: dışarıda gökyüzü düzlemi + çerçeve
    skyCanvas = document.createElement('canvas'); skyCanvas.width = 1024; skyCanvas.height = 200;
    skyBase = document.createElement('canvas'); skyBase.width = 1024; skyBase.height = 200;
    skyTex = new T.CanvasTexture(skyCanvas); skyTex.encoding = T.sRGBEncoding;
    const skyPlane = new T.Mesh(new T.PlaneGeometry(26, 4), new T.MeshBasicMaterial({ map: skyTex, fog: false }));
    skyPlane.position.set(0.45, 2.1, WALL_Z - 1.6); scene.add(skyPlane);
    const frameM = mat('#f4f5f2');
    for (const w of WINDOWS) {
      const cx = w.x, cy = (WIN_Y0 + WIN_Y1) / 2, hh = WIN_Y1 - WIN_Y0;
      box(w.w + 0.16, 0.08, 0.16, frameM, cx, WIN_Y1 + 0.04, WALL_Z);
      box(w.w + 0.3, 0.07, 0.3, frameM, cx, WIN_Y0 - 0.02, WALL_Z + 0.05); // denizlik
      box(0.08, hh, 0.16, frameM, cx - w.w / 2, cy, WALL_Z);
      box(0.08, hh, 0.16, frameM, cx + w.w / 2, cy, WALL_Z);
      box(0.07, hh, 0.08, frameM, cx, cy, WALL_Z);
      box(w.w, 0.06, 0.08, frameM, cx, WIN_Y0 + hh * 0.36, WALL_Z);
      const glass = new T.Mesh(new T.PlaneGeometry(w.w, hh), new T.MeshBasicMaterial({ color: '#dff2ff', transparent: true, opacity: 0.12 }));
      glass.position.set(cx, cy, WALL_Z - 0.02); scene.add(glass);
      // zemine düşen güneş ışığı
      const sh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: '#ffe6a8', transparent: true, opacity: 0.25, blending: T.AdditiveBlending, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; scene.add(sh); sh.userData.win = w; shafts.push(sh);
    }

    // Dolaplar
    const locker = (x, col, n) => {
      const g = new T.Group();
      for (let i = 0; i < n; i++) {
        const d = box(0.42, 1.9, 0.45, mat(col), i * 0.45, 0.95, 0, g); d.castShadow = true; d.receiveShadow = true;
        for (let v = 0; v < 4; v++) box(0.26, 0.025, 0.01, mat('#2b3540'), i * 0.45, 1.65 - v * 0.05, 0.23, g);
        box(0.04, 0.1, 0.03, mat('#cfd3d6'), i * 0.45 + 0.13, 1.0, 0.235, g);
      }
      g.position.set(x, 0, WALL_Z + 0.25); scene.add(g);
      return g;
    };
    locker(-8.2, '#4f8fd1', 4);
    locker(6.6, '#ef8a4c', 4);
    // kitaplar + saksı
    ['#d9483b', '#3f7ac2', '#f0b13b', '#4fa36a'].forEach((c, i) => box(0.09, 0.3 - (i % 2) * 0.05, 0.22, mat(c), -7.9 + i * 0.1, 2.05 - (i % 2) * 0.025, WALL_Z + 0.25));
    const pot = new T.Mesh(new T.CylinderGeometry(0.18, 0.13, 0.28, 12), mat('#c35f3a')); pot.position.set(8.0, 2.04, WALL_Z + 0.25); scene.add(pot);
    for (let i = 0; i < 7; i++) {
      const lf = new T.Mesh(new T.ConeGeometry(0.06, 0.55, 5), mat(i % 2 ? '#5aa548' : '#3e8a3a'));
      lf.position.set(8.0, 2.38, WALL_Z + 0.25); lf.rotation.z = (i - 3) * 0.28; lf.rotation.x = (i % 3 - 1) * 0.2; scene.add(lf);
    }

    // Kapılar
    const door = (x, label) => {
      const fr = mat('#5e3c1c');
      box(1.2, 2.3, 0.12, mat('#ffffff', { map: canvasTex(128, 256, doorTex(label)) }), x, 1.15, WALL_Z + 0.02);
      box(0.08, 2.4, 0.18, fr, x - 0.64, 1.2, WALL_Z + 0.04);
      box(0.08, 2.4, 0.18, fr, x + 0.64, 1.2, WALL_Z + 0.04);
      box(1.36, 0.08, 0.18, fr, x, 2.4, WALL_Z + 0.04);
    };
    door(-6.0, '9-A');
    door(1.6, '10-B');

    // Pano + poster
    const board = box(2.0, 1.3, 0.06, mat('#ffffff', { map: canvasTex(256, 160, cork) }), -0.4, 1.95, WALL_Z + 0.04);
    board.receiveShadow = true;
    const bf = mat('#7a4a26');
    box(2.12, 0.07, 0.09, bf, -0.4, 2.63, WALL_Z + 0.05); box(2.12, 0.07, 0.09, bf, -0.4, 1.27, WALL_Z + 0.05);
    box(0.07, 1.42, 0.09, bf, -1.46, 1.95, WALL_Z + 0.05); box(0.07, 1.42, 0.09, bf, 0.66, 1.95, WALL_Z + 0.05);
    const pst = new T.Mesh(new T.PlaneGeometry(0.7, 0.9), mat('#ffffff', { map: canvasTex(128, 164, poster) }));
    pst.position.set(-1.95, 1.85, WALL_Z + 0.02); pst.rotation.z = -0.03; scene.add(pst);
    // bank
    box(2.2, 0.06, 0.4, mat('#a8743f'), 3.6, 0.45, WALL_Z + 0.4).castShadow = true;
    for (const dx of [-0.95, 0.95]) box(0.06, 0.45, 0.36, mat('#3a3f46'), 3.6 + dx, 0.22, WALL_Z + 0.4);

    ready = true; perfGrace = 1;
  }

  // ---------------------------------------------------------------------------
  // Öğrenciler
  // ---------------------------------------------------------------------------
  const SKIN = ['#f5d0b0', '#e8b890', '#d7a47c', '#b98058', '#f0c8a0'];
  const HAIR = ['#2b1d14', '#4a2e1c', '#6b4424', '#1a1410', '#a8672e', '#d9b26a'];
  const TOPS = ['#2c3e66', '#2c3e66', '#f4f4f0', '#8a1f2a', '#3f6fa8', '#3d6b4a'];
  const PANTS = ['#3a3f48', '#2b3240', '#4a4f5a', '#6e7480'];
  const BAGS = ['#e8443a', '#3f7ac2', '#f0b13b', '#4fa36a', '#8e5bc0', '#222831'];

  function makeStudent() {
    const T = THREE_();
    const g = new T.Group();
    const s = rnd(0.85, 1.05), girl = Math.random() < 0.5;
    const skin = mat(pick(SKIN)), top = mat(pick(TOPS)), pants = mat(girl && Math.random() < 0.6 ? '#2c3e66' : pick(PANTS));
    const hairM = mat(pick(HAIR));
    const part = (geo, m, x, y, z, parent) => { const me = new T.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; (parent || g).add(me); return me; };
    const hip = 0.78 * s;
    const legs = [];
    for (const side of [-1, 1]) {
      const pivot = new T.Group(); pivot.position.set(side * 0.09 * s, hip, 0); g.add(pivot);
      part(new T.BoxGeometry(0.13 * s, hip, 0.14 * s), pants, 0, -hip / 2, 0, pivot);
      part(new T.BoxGeometry(0.14 * s, 0.07, 0.24 * s), mat('#1d1f24'), 0, -hip + 0.035, 0.04, pivot);
      legs.push(pivot);
    }
    const torsoH = 0.56 * s;
    part(new T.BoxGeometry(0.38 * s, torsoH, 0.22 * s), top, 0, hip + torsoH / 2, 0);
    const arms = [];
    for (const side of [-1, 1]) {
      const pivot = new T.Group(); pivot.position.set(side * 0.235 * s, hip + torsoH - 0.05, 0); g.add(pivot);
      part(new T.BoxGeometry(0.1 * s, 0.5 * s, 0.11 * s), top, 0, -0.25 * s, 0, pivot);
      part(new T.BoxGeometry(0.09 * s, 0.09 * s, 0.09 * s), skin, 0, -0.52 * s, 0, pivot);
      arms.push(pivot);
    }
    const headY = hip + torsoH + 0.17 * s;
    part(new T.BoxGeometry(0.1 * s, 0.08, 0.1 * s), skin, 0, hip + torsoH + 0.03, 0);
    part(new T.SphereGeometry(0.15 * s, 14, 10), skin, 0, headY, 0);
    const hair = part(new T.SphereGeometry(0.162 * s, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, 0, headY + 0.01, -0.01);
    hair.rotation.x = -0.25;
    if (girl) part(new T.BoxGeometry(0.26 * s, 0.3 * s, 0.08 * s), hairM, 0, headY - 0.12 * s, -0.11 * s);
    if (Math.random() < 0.75) part(new T.BoxGeometry(0.3 * s, 0.36 * s, 0.14 * s), mat(pick(BAGS)), 0, hip + torsoH * 0.55, -0.18 * s);
    g.userData = { legs, arms, phase: Math.random() * 6.28 };
    scene.add(g);
    return g;
  }

  function targetCount() {
    const st = KS.state || {};
    if (st.phase === 'open' || st.phase === 'closing') {
      let n = 2;
      try { if (KS.isBreak && KS.isBreak()) n = 8; } catch (e) { /* */ }
      return n;
    }
    return st.phase === 'prep' ? 1 : 3;
  }

  function spawn() {
    const g = makeStudent();
    const dir = Math.random() < 0.5 ? 1 : -1;
    const u = g.userData;
    u.dir = dir;
    u.speed = rnd(0.9, 1.5);
    u.z = rnd(-5.2, -3.2);
    u.x = -dir * rnd(11, 13);
    u.stopAt = Math.random() < 0.3 ? rnd(-6, 7) : null;
    u.wait = 0;
    g.position.set(u.x, 0, u.z);
    g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    students.push(g);
  }

  function updateStudents(dt) {
    const want = targetCount();
    if (students.length < want && Math.random() < dt * 1.4) spawn();
    for (let i = students.length - 1; i >= 0; i--) {
      const g = students[i], u = g.userData;
      let moving = true;
      if (u.stopAt != null && Math.abs(u.x - u.stopAt) < 0.1 && u.wait < 4) {
        moving = false; u.wait += dt;
        g.rotation.y += (0 - g.rotation.y) * Math.min(1, dt * 4); // izleyiciye (tezgaha) dön
      } else {
        g.rotation.y += ((u.dir > 0 ? Math.PI / 2 : -Math.PI / 2) - g.rotation.y) * Math.min(1, dt * 5);
        if (u.wait >= 4) u.stopAt = null;
        u.x += u.dir * u.speed * dt;
        if (students.length > want + 1) u.speed = Math.max(u.speed, 1.6);
      }
      u.phase += dt * (moving ? u.speed * 6.5 : 1.5);
      const sw = moving ? Math.sin(u.phase) * 0.6 : 0;
      u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
      u.arms[0].rotation.x = -sw * 0.8; u.arms[1].rotation.x = sw * 0.8;
      g.position.set(u.x, moving ? Math.abs(Math.cos(u.phase)) * 0.04 : Math.sin(u.phase) * 0.008, u.z);
      if (Math.abs(u.x) > 14) {
        scene.remove(g);
        g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        students.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Saat / hava durumu
  // ---------------------------------------------------------------------------
  function updateSky(S, weather, dt) {
    const Art = KS.Art;
    const key = S.min + '|' + weather;
    if (key !== skyKey) {
      skyKey = key;
      const g = skyBase.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, skyBase.width, skyBase.height);
      if (Art && Art._paintSky) {
        // Art'ın 2D gökyüzü bölgesini (x 300..1500, y 56..230) dokuya yay
        g.scale(skyBase.width / 1200, skyBase.height / 174); g.translate(-300, -56);
        try { Art._paintSky(g, S); } catch (e) { /* */ }
      } else {
        g.fillStyle = '#8fc6ee'; g.fillRect(0, 0, skyBase.width, skyBase.height);
      }
      rainAcc = 99;
      const T = THREE_(), C = (c) => new T.Color(c);
      // ışık tonu
      const sunA = S.sunA, late = S.late, ov = S.ov;
      lights.key.color.copy(C('#fff4dc')).lerp(C('#ffb070'), late * 0.6);
      lights.key.intensity = 0.7 - ov * 0.2;
      lights.hemi.color.copy(C(S.bot)).lerp(C('#fff6e6'), 0.6);
      lights.hemi.intensity = 0.5 - ov * 0.1;
      lights.sun.intensity = 0.35 * sunA;
      lights.sun.color.copy(C(S.sunCol));
      for (const sh of shafts) {
        const w = sh.userData.win;
        const dx = Math.max(-1.6, Math.min(1.6, (w.x - (S.sunX - 901) / 75) * 0.22));
        sh.scale.set(w.w * 0.95, 2.6, 1);
        sh.position.set(w.x + dx * 0.5, 0.01, WALL_Z + 1.35);
        sh.rotation.z = -dx * 0.25;
        sh.material.opacity = 0.1 * sunA;
        sh.material.color.copy(C(S.sunCol));
        sh.visible = sunA > 0.12;
      }
      for (const f of fluo) f.material.color.copy(C(ov > 0.4 ? '#fffdf2' : '#fbf6e4'));
    }
    // yağmur: taban gökyüzünün üstüne hareketli çizgiler
    rainAcc += dt;
    const rainy = weather === 'yagmurlu';
    if (rainAcc > (rainy ? 0.08 : 10)) {
      rainAcc = 0;
      const g = skyCanvas.getContext('2d');
      g.drawImage(skyBase, 0, 0);
      if (rainy) {
        g.strokeStyle = 'rgba(220,235,255,0.55)'; g.lineWidth = 1.5; g.beginPath();
        for (let i = 0; i < 160; i++) { const x = Math.random() * skyCanvas.width, y = Math.random() * skyCanvas.height; g.moveTo(x, y); g.lineTo(x - 4, y + 16); }
        g.stroke();
      }
      skyTex.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Dış API
  // ---------------------------------------------------------------------------
  function checkPerf(nowMs) {
    if (!perfT0) { perfT0 = nowMs; perfN = 0; return; }
    perfN++;
    const el = nowMs - perfT0;
    if (el < 2500) return;
    const fps = perfN * 1000 / el;
    perfT0 = nowMs; perfN = 0;
    if (perfGrace > 0) { perfGrace--; return; } // ilk ölçümleri (yükleme) yok say
    if (fps >= 30 || document.hidden || KS.Scene3D.autoQuality === false) return;
    quality++;
    if (quality === 1) {
      renderer.shadowMap.enabled = false;
      scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    } else if (quality === 2) {
      curW = 0; // yeniden boyutlandır
    } else {
      failed = true; hide();
      try { KS.notify && KS.notify('Cihaz yavaş: 3D koridor kapatıldı (Ayarlar\'dan açabilirsin)', 'info'); } catch (e) { /* */ }
    }
  }

  function isOn() { return enabled && !failed && !!THREE_(); }
  function hide() { if (glCanvas) glCanvas.style.display = 'none'; }
  let placed = '';

  // R: mantıksal bölge {x,y,w,h}; k: çözünürlük çarpanı; S: Art.skyAt sonucu
  function draw(ctx, R, S, weather, t, k) {
    if (!isOn()) return false;
    try {
      if (!ready) build();
      const dt = lastT == null ? 0 : Math.max(0, Math.min(0.1, t - lastT));
      lastT = t;
      const paused = KS.state && KS.state.paused;
      checkPerf(performance.now());
      if (failed) return false;
      const k2 = Math.max(0.75, Math.min(1.6, k || 1)) * (quality >= 2 ? 0.6 : 1);
      const W = Math.round(R.w * k2), Hh = Math.round(R.h * k2);
      const pk = R.x + ',' + R.y + ',' + R.w + ',' + R.h;
      if (pk !== placed) {
        placed = pk;
        Object.assign(glCanvas.style, { left: R.x + 'px', top: R.y + 'px', width: R.w + 'px', height: R.h + 'px' });
      }
      glCanvas.style.display = '';
      if (W !== curW || Hh !== curH) {
        curW = W; curH = Hh;
        renderer.setSize(W, Hh, false);
        camera.aspect = R.w / R.h; camera.updateProjectionMatrix();
        renderAcc = 1;
      }
      updateSky(S, weather, dt);
      if (!paused) updateStudents(dt);
      renderAcc += dt;
      if (renderAcc >= 1 / FPS || dt === 0) {
        renderAcc = 0;
        renderer.render(scene, camera);
      }
      ctx.clearRect(R.x, R.y, R.w, R.h); // 2D canvas'ta delik aç: arkadaki 3D görünsün
      return !failed;
    } catch (e) {
      failed = true; hide();
      try { console.warn('[KantinSim] 3D koridor kapatıldı:', e); } catch (_) { /* */ }
      return false;
    }
  }

  function setEnabled(on) {
    enabled = !!on;
    if (enabled && failed && renderer) { failed = false; perfT0 = 0; perfGrace = 1; }
    try { localStorage.setItem(PREF_KEY, enabled ? '1' : '0'); } catch (e) { /* */ }
    if (!enabled) hide();
  }

  KS.Scene3D = { autoQuality: true, draw, isOn, available: () => !!THREE_() && !failed, enabled: () => enabled, setEnabled };
})(window.KS = window.KS || {});
