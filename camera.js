/* =====================================================================
   camera.js — ด่านแรกสุด: กระจกฝ้า + กล้องจับมือ
   - โบกมือ (หรือใช้นิ้วลากบนจอ) เพื่อเช็ดฝ้า มีหยดน้ำไหลตามรอยเช็ด
   - ท่ามือมีเอฟเฟกต์: แบมือโบก / ชี้นิ้ว / ชูสองนิ้ว / กำแล้วแบ / มินิฮาร์ท
   - ทำมือรูปหัวใจกลางจอ (สองมือ จะคนเดียวหรือสองคนก็ได้) เพื่อผ่านด่าน
   ใช้ MediaPipe Hand Landmarker (Apache-2.0) โหลดจาก CDN
   ===================================================================== */
(() => {
  'use strict';

  const MP_VER = '0.10.35';
  const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  const TIPS = [4, 8, 12, 16, 20];
  const PASTEL = ['#FF8FB8', '#FFD36E', '#7FDCB5', '#B9A2FF', '#8CCBFF', '#FFB08A'];

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ---------- โหลดระบบจับมือ (เริ่มโหลดล่วงหน้าได้) ---------- */
  let landmarkerPromise = null;
  function loadLandmarker() {
    if (!landmarkerPromise) {
      landmarkerPromise = (async () => {
        const mp = await import(`${MP_BASE}/vision_bundle.mjs`);
        const fileset = await mp.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
        const options = (delegate) => ({
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numHands: 4,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        try {
          return await mp.HandLandmarker.createFromOptions(fileset, options('GPU'));
        } catch (err) {
          console.warn('GPU ใช้ไม่ได้ เปลี่ยนไปใช้ CPU', err);
          return await mp.HandLandmarker.createFromOptions(fileset, options('CPU'));
        }
      })();
      landmarkerPromise.catch(() => { landmarkerPromise = null; }); // ให้กดลองใหม่ได้
    }
    return landmarkerPromise;
  }

  /* ---------- อ่านท่ามือ (พิกัดหน่วยพิกเซลของวิดีโอ) ---------- */
  // นิ้วเหยียด = ปลายนิ้วอยู่ไกลจากข้อมือกว่าข้อกลางนิ้วชัดเจน
  function fingerRatio(p, tip, pip) {
    return dist(p[0], p[tip]) / Math.max(1, dist(p[0], p[pip]));
  }
  function classify(p, size) {
    const r = [fingerRatio(p, 8, 6), fingerRatio(p, 12, 10), fingerRatio(p, 16, 14), fingerRatio(p, 20, 18)];
    const ext = r.map((v) => v > 1.15);
    const curl = r.map((v) => v < 1.03);
    // มินิฮาร์ท: นิ้วโป้งแตะปลายนิ้วชี้ และปลายนิ้วชี้ไม่ได้ซุกอยู่ในกำมือ (กันสับสนกับท่ากำมือ)
    const pinch = Math.min(dist(p[4], p[8]), dist(p[4], p[7]));
    if (pinch < size * 0.3 && dist(p[0], p[8]) > size * 1.0 && curl[1] && curl[2] && curl[3]) return 'pinch';
    if (ext[0] && ext[1] && ext[2] && ext[3]) return 'open';
    if (ext[0] && ext[1] && curl[2] && curl[3]) return 'peace';
    if (ext[0] && curl[1] && curl[2] && curl[3]) return 'point';
    if (curl[0] && curl[1] && curl[2] && curl[3]) return 'fist';
    return 'other';
  }

  // สองมือประกบเป็นหัวใจ: ปลายนิ้วโป้งชนกันด้านล่าง นิ้วชี้งอมาชนกันด้านบน มือสองข้างอยู่คนละฝั่ง
  function heartPair(a, b) {
    const s = (a.size + b.size) / 2;
    if (dist(a.p[4], b.p[4]) > s * 0.8) return null;
    let topD = Infinity, top = null;
    for (const i of [8, 7, 12, 11, 6]) {
      for (const j of [8, 7, 12, 11, 6]) {
        const d = dist(a.p[i], b.p[j]);
        if (d < topD) { topD = d; top = mid(a.p[i], b.p[j]); }
      }
    }
    if (topD > s * 0.8) return null;
    const bottom = mid(a.p[4], b.p[4]);
    if (bottom.y - top.y < s * 0.45) return null;            // ปลายหัวใจต้องอยู่ต่ำกว่ายอด
    const cx = (top.x + bottom.x) / 2;
    if ((a.p[0].x - cx) * (b.p[0].x - cx) > 0) return null;  // มือสองข้างอยู่คนละฝั่ง
    if (Math.abs(a.p[5].x - b.p[5].x) < s * 0.85) return null; // หัวใจมีความกว้าง (กันท่าพนมมือ)
    return { top, bottom, center: mid(top, bottom), size: s };
  }

  /* ---------- วาดรูปทรงน่ารักๆ ---------- */
  function pathHeart(g, s) {
    const k = s / 2;
    g.beginPath();
    g.moveTo(0, k * 0.85);
    g.bezierCurveTo(-k * 1.25, k * 0.05, -k * 0.75, -k * 1.05, 0, -k * 0.45);
    g.bezierCurveTo(k * 0.75, -k * 1.05, k * 1.25, k * 0.05, 0, k * 0.85);
    g.closePath();
  }
  function pathStar(g, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.5 : r;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
  }
  function pathSparkle(g, r) {
    g.beginPath();
    g.moveTo(0, -r);
    g.quadraticCurveTo(r * 0.12, -r * 0.12, r, 0);
    g.quadraticCurveTo(r * 0.12, r * 0.12, 0, r);
    g.quadraticCurveTo(-r * 0.12, r * 0.12, -r, 0);
    g.quadraticCurveTo(-r * 0.12, -r * 0.12, 0, -r);
    g.closePath();
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function drawShape(g, kind, s, color) {
    if (!(s > 0.5)) return;
    if (kind === 'heart') {
      g.fillStyle = color;
      pathHeart(g, s);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.beginPath();
      g.ellipse(-s * 0.2, -s * 0.12, s * 0.1, s * 0.06, -0.6, 0, 6.2832);
      g.fill();
    } else if (kind === 'star') {
      g.fillStyle = color;
      g.strokeStyle = color;
      g.lineJoin = 'round';
      g.lineWidth = s * 0.12;
      pathStar(g, s * 0.45);
      g.fill();
      g.stroke();
    } else if (kind === 'sparkle') {
      g.fillStyle = color;
      pathSparkle(g, s * 0.55);
      g.fill();
    } else if (kind === 'cake') {
      const w = s * 0.9, hh = s * 0.5;
      g.fillStyle = color;
      roundRect(g, -w / 2, -hh * 0.2, w, hh, s * 0.12);
      g.fill();
      g.fillStyle = '#FFFFFF';
      roundRect(g, -w / 2, -hh * 0.34, w, hh * 0.36, s * 0.12);
      g.fill();
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-w / 2 + w * (0.2 + i * 0.3), hh * 0.04, s * 0.07, 0, 6.2832); g.fill(); }
      g.fillStyle = '#FF5C8A';
      g.beginPath();
      g.arc(0, -hh * 0.52, s * 0.11, 0, 6.2832);
      g.fill();
    } else {
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, 0, s * 0.3, 0, 6.2832);
      g.fill();
    }
  }

  /* =====================================================================
     ตัวด่าน
     ===================================================================== */
  function CameraScene(el, next, kit) {
    const { h, C, fill, Sound, Music, FX, HEART, addDrip } = kit;
    const K = C.camera || {};
    const holdNeed = Math.max(0.2, Number(K.holdSeconds) || 0.8);
    const fogReturn = Math.max(3, Number(K.fogReturnSeconds) || 18);
    const app = document.getElementById('app');

    let alive = true, stream = null, landmarker = null, mpFailed = false, raf = 0;
    let layer = null, video = null, fogCv = null, fogCtx = null, tinyCv = null, tinyCtx = null, midCv = null, midCtx = null, fxCv = null, g = null;
    let gw = 0, gh = 0, fog = null;
    let vw = 1280, vh = 720, sw = 1, sh = 1, U = 1;
    let cover = { k: 1, dw: 1, dh: 1, ox: 0, oy: 0 };
    let tracks = [], nextId = 1, parts = [], drops = [], trails = [];
    let holdT = 0, passed = false, heartNow = null, bigHeart = null, snapshotUrl = '';
    let lastVideoTime = -1, lastT = 0, startedAt = 0, clearedFrac = 0, fracT = 0;
    let skeleton = false, clean = false, ptr = null, hueBase = 0;

    /* ----- หน้าเริ่ม ----- */
    const startBtn = h('button', { class: 'candy berry big', type: 'button' }, '📷 ' + fill(K.startButton || 'เปิดกล้อง'));
    const startNote = h('p', { class: 'cam-note', 'aria-live': 'polite' });
    const skipStart = h('button', { class: 'cam-skip-inline', type: 'button', hidden: true, onclick: () => finish() }, 'ข้ามด่านนี้');
    const startCard = h('div', { class: 'cam-start drip' },
      h('h1', { class: 'cam-title' }, fill(K.title || 'กระจกบานนี้ขึ้นฝ้าอยู่')),
      h('p', { class: 'cam-sub' }, fill(K.subtitle || '')),
      startBtn, startNote, skipStart);

    /* ----- หน้าตอนเปิดกล้อง ----- */
    const chip = h('p', { class: 'cam-chip', 'aria-live': 'polite' });
    const guide = h('div', {
      class: 'cam-guide',
      html: `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="camHeartClip"><rect x="0" y="24" width="24" height="0"/></clipPath></defs><path class="hg-fill" clip-path="url(#camHeartClip)" d="${HEART}"/><path class="hg-line" d="${HEART}"/></svg>`
    });
    const guideRect = guide.querySelector('rect');
    const LEGEND = [
      ['open', '✋', 'แบมือโบก', 'ขนมร่วง'],
      ['point', '☝️', 'ชี้นิ้ว', 'วาดเส้นแสง'],
      ['peace', '✌️', 'ชูสองนิ้ว', 'ดาววิ้งๆ'],
      ['fist', '✊', 'กำแล้วแบ', 'พลุหัวใจ'],
      ['pinch', '🫰', 'มินิฮาร์ท', 'หัวใจลอย'],
      ['heart', '🫶', 'หัวใจกลางจอ', 'ผ่านด่าน']
    ];
    const legendEls = {};
    const legend = h('div', { class: 'cam-legend' }, LEGEND.map(([id, emo, how, what]) => {
      legendEls[id] = h('div', { class: 'cam-leg' }, h('b', { 'aria-hidden': 'true' }, emo), h('span', {}, how), h('small', {}, what));
      return legendEls[id];
    }));
    const btnTech = h('button', { class: 'candy cam-tool', type: 'button', 'aria-pressed': 'false' }, '✨ โหมดล้ำ');
    const btnClip = h('button', { class: 'candy cam-tool', type: 'button' }, '🎬 ถ่ายคลิป');
    const skipBtn = h('button', { class: 'cam-skip', type: 'button', hidden: true, onclick: () => finish() }, 'ข้ามด่านนี้');
    const ui = h('div', { class: 'cam-ui', hidden: true }, chip, guide, legend, h('div', { class: 'cam-tools' }, btnTech, btnClip), skipBtn);
    const success = h('div', { class: 'cam-success', hidden: true });
    const cleanHint = h('p', { class: 'cam-clean-hint' }, 'แตะจอเพื่อโชว์ปุ่ม');
    el.append(startCard, ui, success, cleanHint);
    addDrip(startCard);

    // เริ่มโหลดระบบจับมือตั้งแต่ตอนนี้ จะได้พร้อมตอนกดเปิดกล้อง
    loadLandmarker().then((lm) => { landmarker = lm; }).catch((err) => { console.warn('โหลดระบบจับมือไม่สำเร็จ', err); mpFailed = true; });

    startBtn.addEventListener('click', startCamera);
    btnTech.addEventListener('click', () => {
      skeleton = !skeleton;
      btnTech.setAttribute('aria-pressed', String(skeleton));
      Sound.sfx.pop();
    });
    btnClip.addEventListener('click', () => { Sound.sfx.pop(); setClean(true); });

    async function startCamera() {
      if (startBtn.disabled) return;
      startBtn.disabled = true;
      startNote.textContent = fill(K.loading || 'กำลังเตรียมกล้อง…');
      Sound.sfx.pop();
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('เบราว์เซอร์นี้เปิดกล้องไม่ได้ (ต้องเปิดผ่าน https)');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      } catch (err) {
        console.warn('เปิดกล้องไม่ได้', err);
        startBtn.disabled = false;
        startBtn.textContent = '📷 ลองอีกครั้ง';
        startNote.textContent = 'เปิดกล้องไม่ได้ ลองกดอนุญาตให้ใช้กล้อง แล้วกดลองอีกครั้ง';
        skipStart.hidden = false;
        return;
      }
      if (!alive) { stopStream(); return; }
      buildLayer();
      video.srcObject = stream;
      try { await video.play(); } catch (e) { /* บางเครื่องเล่นเองหลังได้ภาพ */ }
      await waitForVideo();
      if (!alive) return;
      setupGeometry();
      Music.start();
      startCard.classList.add('gone');
      setTimeout(() => startCard.remove(), 400);
      ui.hidden = false;
      startedAt = performance.now();
      lastT = startedAt;
      raf = requestAnimationFrame(loop);
      if (!landmarker && !mpFailed) {
        try { landmarker = await loadLandmarker(); } catch (err) { mpFailed = true; }
      }
    }

    function waitForVideo() {
      return new Promise((res) => {
        if (video.videoWidth) return res();
        const done = () => { video.removeEventListener('loadedmetadata', done); res(); };
        video.addEventListener('loadedmetadata', done);
        setTimeout(done, 4000);
      });
    }

    function buildLayer() {
      video = document.createElement('video');
      video.className = 'cam-video';
      video.muted = true;
      video.autoplay = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      fogCv = h('canvas', { class: 'cam-fog' });
      fogCtx = fogCv.getContext('2d', { willReadFrequently: true });
      tinyCv = document.createElement('canvas');
      tinyCtx = tinyCv.getContext('2d');
      midCv = document.createElement('canvas');
      midCtx = midCv.getContext('2d');
      fxCv = h('canvas', { class: 'cam-fx' });
      g = fxCv.getContext('2d');
      layer = h('div', { class: 'cam-layer' }, video, fogCv, fxCv);
      app.insertBefore(layer, app.firstChild);
      document.body.classList.add('cam-on');
      window.addEventListener('resize', resize);
      window.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerUp, true);
    }

    function setupGeometry() {
      vw = video.videoWidth || 1280;
      vh = video.videoHeight || 720;
      gw = 192;
      gh = Math.max(48, Math.round(gw * vh / vw));
      fogCv.width = gw;
      fogCv.height = gh;
      tinyCv.width = Math.round(gw / 4);
      tinyCv.height = Math.round(gh / 4);
      midCv.width = Math.round(gw / 2);
      midCv.height = Math.round(gh / 2);
      fog = new Float32Array(gw * gh).fill(1);
      resize();
    }

    function resize() {
      sw = window.innerWidth;
      sh = window.innerHeight;
      U = Math.min(sw, sh) / 800;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      fxCv.width = Math.round(sw * dpr);
      fxCv.height = Math.round(sh * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const k = Math.max(sw / vw, sh / vh);
      cover = { k, dw: vw * k, dh: vh * k, ox: (sw - vw * k) / 2, oy: (sh - vh * k) / 2 };
    }
    // พิกัดวิดีโอ (0–1) ↔ พิกัดจอ (ภาพกลับด้านแบบกระจก)
    const toScreen = (nx, ny) => ({ x: sw - (cover.ox + nx * cover.dw), y: cover.oy + ny * cover.dh });
    const toNorm = (sx, sy) => ({ x: (sw - sx - cover.ox) / cover.dw, y: (sy - cover.oy) / cover.dh });

    /* ----- ฝ้า: ตาราง 0–1 (1 = ฝ้าเต็ม) ----- */
    function brush(gx, gy, r, k) {
      const x0 = Math.max(0, Math.floor(gx - r)), x1 = Math.min(gw - 1, Math.ceil(gx + r));
      const y0 = Math.max(0, Math.floor(gy - r)), y1 = Math.min(gh - 1, Math.ceil(gy + r));
      const r2 = r * r;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - gx, dy = y - gy, d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const f = 1 - d2 / r2;
          const i = y * gw + x;
          fog[i] *= 1 - k * f * f;
        }
      }
    }
    function strokeN(a, b, r, k) {
      if (!fog) return;
      const ax = a.x * gw, ay = a.y * gh, bx = b.x * gw, by = b.y * gh;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(1, r * 0.45)));
      for (let i = 0; i <= n; i++) brush(ax + (bx - ax) * i / n, ay + (by - ay) * i / n, r, k);
    }
    function spawnDrop(n, sizeG) {
      if (drops.length > 46) return;
      drops.push({
        x: n.x * gw + rand(-0.7, 0.7) * sizeG,
        y: n.y * gh + sizeG * rand(0.6, 1.0),
        r: rand(0.55, 1.3), wait: rand(0.3, 1.4), v: 0, age: 0, life: rand(6, 11), seed: rand(0, 9)
      });
    }
    function stepFog(dt) {
      if (!fog) return;
      if (passed) {
        for (let i = 0; i < fog.length; i++) fog[i] = Math.max(0, fog[i] - dt * 1.4);
      } else {
        const inc = dt / fogReturn;
        for (let i = 0; i < fog.length; i++) fog[i] = Math.min(1, fog[i] + inc);
      }
      for (const d of drops) {
        d.age += dt;
        if (d.wait > 0) { d.wait -= dt; continue; }
        if (!d.v) d.v = rand(2, 7);
        d.y += d.v * dt;
        d.x += Math.sin(d.age * 3 + d.seed) * 0.06;
        if (Math.random() < dt * 0.5) { d.wait = rand(0.2, 0.9); d.v = 0; }
        brush(d.x, d.y, d.r * 1.35, 0.55); // รอยน้ำไหลทำให้ฝ้าหาย
      }
      drops = drops.filter((d) => d.age < d.life && d.y < gh + 2);
      fracT -= dt;
      if (fracT <= 0) {
        fracT = 0.5;
        let s = 0;
        for (let i = 0; i < fog.length; i++) s += fog[i];
        clearedFrac = 1 - s / fog.length;
      }
    }
    function renderFog() {
      if (!fog || video.readyState < 2) return;
      // ย่อภาพเล็กมากแล้วขยายกลับสองทอด = ภาพเบลอนุ่มๆ เหมือนมองผ่านกระจกฝ้า
      tinyCtx.drawImage(video, 0, 0, tinyCv.width, tinyCv.height);
      midCtx.imageSmoothingEnabled = true;
      midCtx.imageSmoothingQuality = 'high';
      midCtx.drawImage(tinyCv, 0, 0, midCv.width, midCv.height);
      fogCtx.globalCompositeOperation = 'copy';
      fogCtx.imageSmoothingEnabled = true;
      fogCtx.imageSmoothingQuality = 'high';
      fogCtx.drawImage(midCv, 0, 0, gw, gh);
      fogCtx.globalCompositeOperation = 'source-over';
      fogCtx.fillStyle = 'rgba(255, 243, 248, 0.52)';
      fogCtx.fillRect(0, 0, gw, gh);
      const img = fogCtx.getImageData(0, 0, gw, gh), d = img.data;
      for (let i = 0, p = 3; i < fog.length; i++, p += 4) d[p] = fog[i] * 255;
      fogCtx.putImageData(img, 0, 0);
    }

    /* ----- มือ ----- */
    function readHands(res) {
      const list = (res && res.landmarks) || [];
      return list.map((lm) => {
        const p = lm.map((q) => ({ x: q.x * vw, y: q.y * vh }));
        const size = Math.max(1, dist(p[0], p[9]));
        const ids = [0, 5, 9, 13, 17];
        const palmN = { x: ids.reduce((s, i) => s + lm[i].x, 0) / 5, y: ids.reduce((s, i) => s + lm[i].y, 0) / 5 };
        return {
          lm, p, size, palmN,
          palm: toScreen(palmN.x, palmN.y),
          scr: lm.map((q) => toScreen(q.x, q.y)),
          tipsN: TIPS.map((i) => ({ x: lm[i].x, y: lm[i].y })),
          gesture: classify(p, size)
        };
      });
    }
    function updateTracks(hands, now) {
      const used = new Set(), kept = [];
      for (const hd of hands) {
        let best = null, bd = Infinity;
        for (const t of tracks) {
          if (used.has(t)) continue;
          const d = dist(t.palm, hd.palm);
          if (d < bd) { bd = d; best = t; }
        }
        let t = best && bd < Math.max(sw, sh) * 0.25 ? best : null;
        if (t) used.add(t);
        else t = { id: nextId++, palm: hd.palm, palmN: hd.palmN, tipsN: hd.tipsN, vel: { x: 0, y: 0 }, speed: 0, gesture: 'other', cand: 'other', candN: 0, since: now, last: now, acc: 0, tip: null };
        const dtt = Math.max(0.016, (now - t.last) / 1000);
        t.vel = { x: t.vel.x * 0.5 + (hd.palm.x - t.palm.x) / dtt * 0.5, y: t.vel.y * 0.5 + (hd.palm.y - t.palm.y) / dtt * 0.5 };
        t.speed = Math.hypot(t.vel.x, t.vel.y);
        wipeWithHand(t, hd, dtt);
        t.palm = hd.palm;
        t.palmN = hd.palmN;
        t.tipsN = hd.tipsN;
        t.hand = hd;
        t.last = now;
        if (hd.gesture === t.cand) t.candN++; else { t.cand = hd.gesture; t.candN = 1; }
        if (t.candN >= 3 && t.gesture !== t.cand) {
          onGesture(t, t.gesture, t.cand, now);
          t.gesture = t.cand;
          t.since = now;
        }
        emit(t, hd, dtt, now);
        kept.push(t);
      }
      for (const t of tracks) {
        if (!used.has(t) && now - t.last < 250) { t.hand = null; kept.push(t); }
      }
      tracks = kept;
    }
    function wipeWithHand(t, hd, dtt) {
      if (!fog) return;
      const a = t.palmN, b = hd.palmN;
      const spd = Math.hypot((b.x - a.x) * vw, (b.y - a.y) * vh) / dtt; // พิกเซลวิดีโอ/วินาที
      if (spd < 160) return; // มือนิ่งๆ (แค่สั่นนิดหน่อย) จะไม่เช็ดฝ้า
      const k = Math.min(1, (spd - 160) / 800);
      const sizeG = hd.size * gw / vw;
      strokeN(a, b, sizeG * 0.95, 0.35 + 0.6 * k);
      for (let i = 1; i < 5; i++) strokeN(t.tipsN[i], hd.tipsN[i], sizeG * 0.32, 0.3 + 0.5 * k);
      if (k > 0.3 && Math.random() < 0.3) spawnDrop(b, sizeG);
    }

    /* ----- เอฟเฟกต์ตามท่ามือ ----- */
    function addPart(q) { if (parts.length < 420) parts.push(q); }
    function sticker(x, y, vx, vy) {
      addPart({
        k: 'fall', shape: pick(['heart', 'star', 'cake', 'sparkle', 'heart', 'star']), x, y, vx, vy,
        rot: rand(-0.6, 0.6), vr: rand(-3, 3), s: rand(22, 38) * U, color: pick(PASTEL),
        life: 0, max: rand(2.6, 3.6), grav: 760 * U, sway: rand(10, 30) * U, ph: rand(0, 6.28)
      });
    }
    function burst(x, y) {
      for (let i = 0; i < 70; i++) {
        const a = rand(0, Math.PI * 2), v = rand(320, 900) * U;
        addPart({
          k: 'fall', shape: pick(['heart', 'heart', 'star', 'sparkle', 'dot']), x, y,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: rand(0, 6), vr: rand(-6, 6),
          s: rand(16, 30) * U, color: pick(PASTEL), life: 0, max: rand(1.4, 2.2), grav: 520 * U, sway: 0, ph: 0, drag: 2.2
        });
      }
      addPart({ k: 'ring', x, y, r: 12 * U, vr: 900 * U, color: '#FFFFFF', life: 0, max: 0.55 });
      Sound.sfx.sparkle();
    }
    function onGesture(t, from, to, now) {
      if (from === 'fist' && to === 'open' && now - t.since > 200 && t.hand) burst(t.hand.palm.x, t.hand.palm.y);
      if (to === 'pinch') Sound.sfx.pop();
      if (to !== 'point') t.tip = null;
    }
    function emit(t, hd, dtt, now) {
      const sizeScr = hd.size * cover.k;
      if (t.gesture === 'open' && t.speed > 260 * U) {
        t.acc += dtt * Math.min(28, t.speed / (45 * U));
        while (t.acc >= 1) {
          t.acc -= 1;
          sticker(hd.palm.x + rand(-0.35, 0.35) * sizeScr, hd.palm.y + rand(-0.35, 0.35) * sizeScr, t.vel.x * 0.12 + rand(-80, 80) * U, rand(-220, -60) * U);
        }
      } else if (t.gesture === 'point') {
        const tip = hd.scr[8];
        if (t.tip && dist(t.tip, tip) > 2) trails.push({ ax: t.tip.x, ay: t.tip.y, bx: tip.x, by: tip.y, t: now, hue: (hueBase + now / 9) % 360 });
        t.tip = tip;
        if (Math.random() < dtt * 14) addPart({ k: 'twinkle', shape: 'sparkle', x: tip.x + rand(-10, 10) * U, y: tip.y + rand(-10, 10) * U, s: rand(12, 22) * U, color: '#FFFFFF', life: 0, max: rand(0.4, 0.7), rot: 0 });
      } else if (t.gesture === 'peace') {
        for (const i of [8, 12]) {
          if (Math.random() < dtt * 12) {
            addPart({ k: 'twinkle', shape: pick(['sparkle', 'star']), x: hd.scr[i].x + rand(-16, 16) * U, y: hd.scr[i].y + rand(-16, 16) * U, s: rand(16, 30) * U, color: pick(['#FFFFFF', '#FFE9A8', '#FFD1E6', '#D9CCFF']), life: 0, max: rand(0.5, 0.9), rot: rand(0, 1.5) });
          }
        }
      } else if (t.gesture === 'pinch') {
        if (Math.random() < dtt * 4.5) {
          const pt = mid(hd.scr[4], hd.scr[8]);
          addPart({ k: 'float', shape: 'heart', x: pt.x, y: pt.y - 10 * U, v: rand(70, 120) * U, s: rand(20, 32) * U, color: pick(['#FF7AA8', '#FF9EC4', '#FFB3CF', '#F58FB8']), life: 0, max: rand(1.6, 2.4), ph: rand(0, 6.28), rot: rand(-0.3, 0.3) });
        }
      }
    }
    function stepParts(dt) {
      for (const q of parts) {
        q.life += dt;
        if (q.k === 'fall') {
          if (q.drag) { const f = Math.max(0, 1 - q.drag * dt); q.vx *= f; if (q.vy < 0) q.vy *= f; } else q.vx *= Math.max(0, 1 - 1.2 * dt);
          q.vy = Math.min(420 * U, q.vy + q.grav * dt);
          q.x += (q.vx + Math.sin(q.life * 3 + q.ph) * q.sway) * dt;
          q.y += q.vy * dt;
          q.rot += q.vr * dt;
        } else if (q.k === 'float') {
          q.y -= q.v * dt;
          q.x += Math.sin(q.life * 4 + q.ph) * 34 * U * dt;
          q.s *= 1 + 0.2 * dt;
        } else if (q.k === 'twinkle') {
          q.y -= 18 * U * dt;
        } else if (q.k === 'ring') {
          q.r += q.vr * dt;
        }
      }
      parts = parts.filter((q) => q.life < q.max && q.y < sh + 80);
      const now = performance.now();
      trails = trails.filter((s) => now - s.t < 1400);
    }

    /* ----- ด่านผ่าน: หัวใจกลางจอ ----- */
    function checkHeart(dt, now) {
      if (passed) return;
      heartNow = null;
      const hs = tracks.filter((t) => t.hand && now - t.last < 220).map((t) => t.hand);
      for (let i = 0; i < hs.length && !(heartNow && heartNow.inside); i++) {
        for (let j = i + 1; j < hs.length; j++) {
          const hp = heartPair(hs[i], hs[j]);
          if (!hp) continue;
          const c = toScreen(hp.center.x / vw, hp.center.y / vh);
          const inside = Math.abs(c.x - sw / 2) < sw * 0.2 && Math.abs(c.y - sh / 2) < sh * 0.28;
          heartNow = { ...hp, screen: c, inside, scale: hp.size * cover.k };
          if (inside) break;
        }
      }
      if (heartNow && heartNow.inside) holdT += dt; else holdT = Math.max(0, holdT - dt * 1.5);
      if (heartNow && Math.random() < dt * 10) {
        addPart({ k: 'twinkle', shape: 'sparkle', x: heartNow.screen.x + rand(-1, 1) * heartNow.scale, y: heartNow.screen.y + rand(-1, 1) * heartNow.scale, s: rand(14, 24) * U, color: '#FFFFFF', life: 0, max: 0.6, rot: 0 });
      }
      if (holdT >= holdNeed) pass();
    }
    function pass() {
      passed = true;
      Sound.sfx.chime();
      setTimeout(() => Sound.sfx.sparkle(), 300);
      const c = heartNow ? heartNow.screen : { x: sw / 2, y: sh / 2 };
      bigHeart = { x: c.x, y: c.y, t0: performance.now() };
      takeSnapshot();
      FX.burst(c.x, c.y, 110, { hearts: 0.85, spread: Math.PI * 2, speed: 950 });
      setTimeout(() => FX.rain(4, 70), 450);
      guide.classList.add('done');
      chip.hidden = true;
      legend.hidden = true;
      setTimeout(showSuccess, 1600);
    }
    function takeSnapshot() {
      try {
        const w = 720, hh = Math.round(w * vh / vw);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = hh;
        const x = c.getContext('2d');
        x.translate(w, 0);
        x.scale(-1, 1);
        x.drawImage(video, 0, 0, w, hh);
        snapshotUrl = c.toDataURL('image/jpeg', 0.9);
      } catch (e) {
        snapshotUrl = '';
      }
    }
    function showSuccess() {
      if (!alive) return;
      const body = h('div', { class: 'cam-success-body' },
        h('h2', {}, fill(K.success || 'ผ่านแล้ว!')),
        h('div', { class: 'cam-success-actions' },
          h('button', { class: 'candy berry big', type: 'button', onclick: () => finish() }, '🎁 ' + fill(K.next || 'ไปเปิดของขวัญ')),
          snapshotUrl ? h('a', { class: 'candy cam-save', href: snapshotUrl, download: 'เราสองคน.jpg' }, 'บันทึกรูป') : null));
      const pol = snapshotUrl
        ? h('div', { class: 'cam-polaroid' }, h('span', { class: 'tape' }), h('img', { src: snapshotUrl, alt: 'รูปตอนทำมือหัวใจด้วยกัน' }), h('span', { class: 'cam-pol-cap' }, fill(K.snapshotCaption || 'เราสองคน 💗')))
        : null;
      success.replaceChildren(...[pol, body].filter(Boolean));
      success.hidden = false;
    }
    function finish() {
      Sound.sfx.pop();
      next();
    }

    /* ----- วาดเอฟเฟกต์ ----- */
    function renderFx(now) {
      g.clearRect(0, 0, sw, sh);
      // หยดน้ำบนกระจก
      const cell = cover.dw / gw;
      for (const d of drops) {
        const p = toScreen(d.x / gw, d.y / gh), r = d.r * cell;
        const a = Math.min(1, d.age * 3, (d.life - d.age) / 1.2);
        if (a <= 0) continue;
        g.globalAlpha = a;
        const grad = g.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.18)');
        grad.addColorStop(0.85, 'rgba(90,60,80,0.22)');
        grad.addColorStop(1, 'rgba(90,60,80,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(p.x, p.y, r, 0, 6.2832);
        g.fill();
      }
      g.globalAlpha = 1;
      // เส้นแสงจากปลายนิ้ว
      if (trails.length) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.lineCap = 'round';
        for (const s of trails) {
          const life = 1 - (now - s.t) / 1400;
          if (life <= 0) continue;
          g.strokeStyle = `hsla(${s.hue}, 95%, 72%, ${0.22 * life})`;
          g.lineWidth = 28 * U * life;
          g.beginPath(); g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); g.stroke();
          g.strokeStyle = `hsla(${s.hue}, 100%, 90%, ${0.9 * life})`;
          g.lineWidth = 7 * U * life;
          g.beginPath(); g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); g.stroke();
        }
        g.restore();
      }
      // ของที่ร่วง/ลอย
      for (const q of parts) {
        const t = q.life / q.max;
        g.globalAlpha = t < 0.08 ? t / 0.08 : t > 0.72 ? Math.max(0, (1 - t) / 0.28) : 1;
        if (q.k === 'ring') {
          g.strokeStyle = q.color;
          g.lineWidth = 6 * U * (1 - t);
          g.beginPath(); g.arc(q.x, q.y, q.r, 0, 6.2832); g.stroke();
          continue;
        }
        g.save();
        g.translate(q.x, q.y);
        g.rotate(q.rot || 0);
        drawShape(g, q.shape, q.k === 'twinkle' ? q.s * Math.sin(Math.PI * t) : q.s, q.color);
        g.restore();
      }
      g.globalAlpha = 1;
      // จุดปลายนิ้ว / โครงมือ (โหมดล้ำ)
      for (const t of tracks) {
        const hd = t.hand;
        if (!hd) continue;
        if (skeleton) {
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.strokeStyle = 'rgba(255, 190, 225, 0.75)';
          g.lineWidth = 3 * U;
          for (const [a, b] of BONES) { g.beginPath(); g.moveTo(hd.scr[a].x, hd.scr[a].y); g.lineTo(hd.scr[b].x, hd.scr[b].y); g.stroke(); }
          g.fillStyle = 'rgba(200, 235, 255, 0.9)';
          for (const q of hd.scr) { g.beginPath(); g.arc(q.x, q.y, 3.5 * U, 0, 6.2832); g.fill(); }
          g.restore();
        }
        for (const i of TIPS) {
          const q = hd.scr[i];
          g.fillStyle = 'rgba(255, 255, 255, 0.28)';
          g.beginPath(); g.arc(q.x, q.y, 11 * U, 0, 6.2832); g.fill();
          g.fillStyle = 'rgba(255, 255, 255, 0.92)';
          g.beginPath(); g.arc(q.x, q.y, 4.5 * U, 0, 6.2832); g.fill();
        }
        if (t.gesture === 'fist') { // กำมือ = กำลังชาร์จพลุ
          const held = Math.min(1, (now - t.since) / 700);
          g.strokeStyle = `rgba(255, 214, 236, ${0.35 + 0.45 * held})`;
          g.lineWidth = 4 * U;
          g.beginPath();
          g.arc(hd.palm.x, hd.palm.y, hd.size * cover.k * (0.9 + 0.1 * Math.sin(now / 90)), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * held);
          g.stroke();
        }
      }
      // หัวใจที่ตรวจเจอ
      if (heartNow && !passed) {
        g.save();
        g.translate(heartNow.screen.x, heartNow.screen.y);
        g.strokeStyle = heartNow.inside ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)';
        g.lineWidth = 5 * U;
        g.shadowColor = '#FF8FB8';
        g.shadowBlur = 18 * U;
        pathHeart(g, heartNow.scale * 2.2);
        g.stroke();
        g.restore();
      }
      // หัวใจยักษ์ตอนผ่านด่าน
      if (bigHeart) {
        const t = Math.max(0, (now - bigHeart.t0) / 1000);
        const grow = t < 0.6 ? 1 - Math.pow(1 - t / 0.6, 3) * Math.cos(t / 0.6 * Math.PI * 0.5) : 1;
        const alpha = t < 1.3 ? 1 : Math.max(0, 1 - (t - 1.3) / 0.7);
        const s = Math.min(sw, sh) * 0.46 * grow * (1 + 0.03 * Math.sin(t * 9));
        if (alpha > 0 && s > 2) {
          g.save();
          g.globalAlpha = alpha;
          g.translate(bigHeart.x, bigHeart.y);
          const grad = g.createLinearGradient(0, -s / 2, 0, s / 2);
          grad.addColorStop(0, '#FFB3CF');
          grad.addColorStop(1, '#F0638F');
          g.fillStyle = grad;
          g.shadowColor = 'rgba(255, 143, 184, 0.9)';
          g.shadowBlur = 40 * U;
          pathHeart(g, s);
          g.fill();
          g.shadowBlur = 0;
          g.fillStyle = 'rgba(255,255,255,0.5)';
          g.beginPath();
          g.ellipse(-s * 0.2, -s * 0.13, s * 0.1, s * 0.06, -0.6, 0, 6.2832);
          g.fill();
          g.restore();
        }
      }
    }

    /* ----- ป้ายบอก / ปุ่ม ----- */
    function say(t) {
      if (chip.textContent === t) return;
      chip.textContent = t;
      chip.classList.remove('bump');
      void chip.offsetWidth;
      chip.classList.add('bump');
    }
    function updateUi(now) {
      if (passed) return;
      const p = Math.min(1, holdT / holdNeed);
      guideRect.setAttribute('y', (24 - 24 * p).toFixed(2));
      guideRect.setAttribute('height', (24 * p).toFixed(2));
      guide.classList.toggle('seen', !!heartNow);
      if (!landmarker) say(mpFailed ? 'โหลดระบบจับมือไม่สำเร็จ ลองใช้นิ้วลากบนจอเพื่อเช็ดฝ้านะ' : 'กำลังเตรียมระบบจับมือ…');
      else if (heartNow && heartNow.inside) say(fill(K.holding || 'ค้างไว้แป๊บนึง…'));
      else if (heartNow) say('ขยับหัวใจมาตรงกลางจออีกนิด');
      else if (clearedFrac < 0.25 && now - startedAt < 9000) say(fill(K.wipeHint || 'โบกมือไปมาเพื่อเช็ดฝ้า'));
      else say(fill(K.heartHint || 'ทำมือรูปหัวใจตรงกลางจอ'));
      const active = new Set(tracks.filter((t) => t.hand).map((t) => t.gesture));
      for (const id in legendEls) legendEls[id].classList.toggle('on', id === 'heart' ? !!heartNow : active.has(id));
      if (skipBtn.hidden && (mpFailed || now - startedAt > 40000)) skipBtn.hidden = false;
    }
    function setClean(on) {
      clean = on;
      document.body.classList.toggle('cam-clean', on);
      cleanHint.classList.toggle('show', on);
      if (on) setTimeout(() => cleanHint.classList.remove('show'), 2200);
    }

    /* ----- นิ้วบนจอ: เช็ดฝ้าได้ด้วย ----- */
    function onPointerDown(e) {
      ptr = { x: e.clientX, y: e.clientY, moved: 0, last: fog ? toNorm(e.clientX, e.clientY) : null };
    }
    function onPointerMove(e) {
      if (!ptr || !fog) return;
      const n = toNorm(e.clientX, e.clientY);
      ptr.moved += Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y);
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      if (ptr.last) strokeN(ptr.last, n, gw * 0.06, 0.8);
      if (Math.random() < 0.08) spawnDrop(n, gw * 0.05);
      ptr.last = n;
    }
    function onPointerUp(e) {
      if (clean && ptr && ptr.moved < 12 && !(e.target && e.target.closest && e.target.closest('button, a'))) setClean(false);
      ptr = null;
    }

    /* ----- ลูปหลัก ----- */
    function loop(now) {
      if (!alive) return;
      raf = requestAnimationFrame(loop); // จองเฟรมถัดไปก่อน ถ้าเฟรมนี้พลาดลูปจะไม่หยุด
      const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
      lastT = now;
      try {
        if (debugHands) {
          updateTracks(readHands({ landmarks: debugHands }), now);
        } else if (landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          updateTracks(readHands(landmarker.detectForVideo(video, now)), now);
        }
        stepFog(dt);
        stepParts(dt);
        checkHeart(dt, now);
        renderFog();
        renderFx(now);
        updateUi(now);
      } catch (err) {
        console.warn('ด่านกล้องสะดุด', err);
      }
    }

    function stopStream() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      if (video) video.srcObject = null;
    }

    // ไว้ทดสอบ: ป้อนท่ามือปลอม / ดูสถานะ
    let debugHands = null;
    window.__cam = {
      feed(list) { debugHands = list; },
      state: () => ({
        hands: tracks.filter((t) => t.hand).length,
        gestures: tracks.filter((t) => t.hand).map((t) => t.gesture),
        heart: !!heartNow, inside: !!(heartNow && heartNow.inside), holdT, passed,
        cleared: clearedFrac, ready: !!landmarker, failed: mpFailed, parts: parts.length, drops: drops.length
      })
    };

    return function cleanup() {
      alive = false;
      cancelAnimationFrame(raf);
      stopStream();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      document.body.classList.remove('cam-on', 'cam-clean');
      if (layer) {
        const l = layer;
        l.classList.add('out');
        setTimeout(() => l.remove(), 450);
      }
    };
  }

  CameraScene.preload = loadLandmarker;
  CameraScene.classify = classify;
  CameraScene.heartPair = heartPair;
  window.CameraScene = CameraScene;
})();
