/* =====================================================================
   app.js — ระบบของเว็บ (ปกติไม่ต้องแก้ไฟล์นี้ แก้ข้อความที่ config.js)
   ทดสอบข้ามด่าน:  index.html?scene=quiz
     (lock, intro, quiz, memory, gallery, letter, ask, cake)
   ปุ่มข้ามด่านตอนแก้งาน:  index.html?dev
   ===================================================================== */
(() => {
  'use strict';

  const C = window.CONFIG || {};
  const W = 1200, H = 800;
  const params = new URLSearchParams(location.search);
  const DEV = params.has('dev');
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const HEART = 'M12 21C12 21 3 15.5 3 9.2 3 6.3 5.2 4 8 4c1.8 0 3.2 1 4 2.4C12.8 5 14.2 4 16 4c2.8 0 5 2.3 5 5.2C21 15.5 12 21 12 21z';
  const heartSvg = (cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART}"/></svg>`;
  const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="8.5" y="2.5" width="7" height="11.5" rx="3.5" fill="currentColor" stroke="none"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>';
  const SEND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.2 20.5 3.5 13 21l-2.3-7.4L3 11.2z" fill="currentColor"/></svg>';

  /* ---------- เครื่องมือเล็กๆ ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (s) => String(s == null ? '' : s).split('{name}').join(C.name || '').split('{from}').join(C.from || '');
  const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  // ตัดข้อความเป็น "ตัวอักษรที่มองเห็น" เพื่อให้สระ/วรรณยุกต์ไทยพิมพ์ออกมาพร้อมพยัญชนะ
  const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
  function graphemes(str) {
    str = String(str);
    if (segmenter) return Array.from(segmenter.segment(str), (x) => x.segment);
    const out = [];
    for (const ch of Array.from(str)) {
      const prev = out[out.length - 1];
      if (prev && (/[ัิ-ฺ็-๎️‍]/.test(ch) || /‍$/.test(prev))) out[out.length - 1] = prev + ch;
      else out.push(ch);
    }
    return out;
  }

  /* =====================================================================
     เสียง (สร้างด้วย Web Audio ไม่ต้องมีไฟล์)
     ===================================================================== */
  const Sound = (() => {
    let ctx = null, out = null, unlocked = false;
    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch (e) { return null; }
        out = ctx.createGain();
        out.gain.value = 0.7;
        out.connect(ctx.destination);
      }
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      return ctx;
    }
    function setSession(type) {
      try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) { /* ไม่รองรับก็ข้าม */ }
    }
    function unlock() {
      const c = ensure();
      if (unlocked || !c) return;
      unlocked = true;
      setSession('playback'); // ให้มีเสียงแม้ iPad/iPhone เปิดโหมดเงียบ
      try {
        const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
        s.buffer = b; s.connect(c.destination); s.start(0);
      } catch (e) { /* ignore */ }
    }
    function tone(freq, at, dur, o = {}) {
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + (at || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.vol == null ? 0.2 : o.vol, t0 + (o.attack || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(out);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    }
    function noise(dur, vol, f0, f1) {
      const c = ensure();
      if (!c) return;
      const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 0.9;
      f.frequency.setValueAtTime(f0, c.currentTime);
      f.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
      const g = c.createGain();
      g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(out);
      src.start();
    }
    const sfx = {
      tap: () => tone(700, 0, 0.08, { vol: 0.12, to: 950 }),
      pop: () => tone(480, 0, 0.14, { type: 'triangle', vol: 0.2, to: 1100 }),
      ding: () => { tone(988, 0, 0.35, { vol: 0.18 }); tone(1319, 0.1, 0.5, { vol: 0.18 }); },
      boop: () => tone(320, 0, 0.28, { type: 'triangle', vol: 0.2, to: 170 }),
      sparkle: () => [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, i * 0.07, 0.45, { vol: 0.12 })),
      chime: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.1, 0.7, { vol: 0.15 })),
      whoosh: () => noise(0.28, 0.35, 2400, 500),
      puff: () => noise(0.4, 0.5, 900, 250),
      stamp: () => { tone(110, 0, 0.2, { type: 'triangle', vol: 0.35, to: 60 }); noise(0.12, 0.25, 600, 200); }
    };
    function bell(f, at, len, vol) {
      tone(f, at, len + 1.1, { vol, attack: 0.004 });
      tone(f * 2, at, len + 0.5, { vol: vol * 0.3, attack: 0.004 });
      tone(f * 3.01, at, 0.35, { vol: vol * 0.1, attack: 0.002 });
    }
    // เพลง Happy Birthday แบบกล่องดนตรี — คืนค่าความยาว (วินาที)
    function birthdaySong() {
      if (!ensure()) return 0;
      const N = { F3: 174.61, G3: 196.0, C4: 261.63, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99 };
      const mel = [
        ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
        ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
        ['G4', 0.75], ['G4', 0.25], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 1],
        ['F5', 0.75], ['F5', 0.25], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 3]
      ];
      const beat = 0.52, start = 0.15;
      let t = start;
      for (const [note, b] of mel) { bell(N[note], t, b * beat, 0.2); t += b * beat; }
      ['C4', 'G3', 'G3', 'C4', 'C4', 'F3', 'G3', 'C4'].forEach((note, i) => bell(N[note], start + (1 + i * 3) * beat, 2.6 * beat, 0.08));
      return t + 1.2;
    }
    return { ensure, unlock, sfx, birthdaySong, setSession };
  })();

  /* ---------- เพลงพื้นหลัง (ไฟล์ใน config.music.src) ---------- */
  const Music = (() => {
    const btn = $('#music-btn');
    let audio = null, wanted = true, ducked = false;
    // เรียกหลังโหลดค่าจากหน้า admin แล้ว (เพลงอาจมาจากเครื่องนี้)
    function init() {
      const src = C.music && C.music.src;
      if (!src || audio) return;
      audio = new Audio();
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = clamp(C.music.volume == null ? 0.5 : Number(C.music.volume), 0, 1);
      audio.addEventListener('error', () => { btn.hidden = true; });
      audio.addEventListener('playing', () => { btn.hidden = false; paint(); });
      audio.src = src;
    }
    function paint() {
      btn.classList.toggle('off', !wanted);
      btn.setAttribute('aria-pressed', String(wanted));
    }
    function play() {
      if (!audio || !wanted || ducked || document.hidden) return;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    }
    function duck(on) {
      ducked = on;
      if (!audio) return;
      if (on) audio.pause(); else play();
    }
    btn.addEventListener('click', () => {
      wanted = !wanted;
      paint();
      if (wanted) play(); else if (audio) audio.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (!audio) return;
      if (document.hidden) audio.pause(); else play();
    });
    return { init, start: play, duck };
  })();

  /* =====================================================================
     กระดาษสีโปรย (canvas ทั้งจอ)
     ===================================================================== */
  const FX = (() => {
    const cv = $('#fx'), g = cv.getContext('2d');
    const COLORS = ['#FF6F9C', '#FFC53D', '#5FD3A5', '#9C7BFF', '#5DB8FF', '#FF9466', '#FF8FC0'];
    let parts = [], raf = 0, last = 0, vw = 0, vh = 0;
    let rainStart = 0, rainEnd = 0, rainRate = 0, acc = 0, drizzle = 0;
    function resize(w, hh) {
      vw = w; vh = hh;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hh * dpr);
      cv.style.width = w + 'px';
      cv.style.height = hh + 'px';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function shade(hex, k) {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
    }
    function piece(x, y, vx, vy, o) {
      const r = Math.random();
      const hearts = o.hearts == null ? 0.14 : o.hearts;
      const shape = r < hearts ? 'heart' : r < hearts + 0.18 ? 'circle' : 'rect';
      const s = rand(7, 12);
      const color = pick(COLORS);
      return {
        x, y, vx, vy, shape, color, back: shade(color, 0.78),
        w: s, h: s * rand(1.35, 1.9),
        rot: rand(0, 6.28), vr: rand(-5, 5), tilt: rand(0, 6.28), vt: rand(5, 11),
        sway: rand(14, 42), sf: rand(1.2, 2.6), ph: rand(0, 6.28),
        term: rand(75, 140), grav: o.grav || 1100, life: 0
      };
    }
    function burst(x, y, n, o = {}) {
      n = Math.round((n || 80) * (reduceMotion ? 0.3 : 1));
      const ang = o.angle == null ? -Math.PI / 2 : o.angle, spread = o.spread || 1.1, sp = o.speed || 950;
      for (let i = 0; i < n; i++) {
        const a = ang + rand(-spread / 2, spread / 2), v = sp * rand(0.45, 1.05);
        parts.push(piece(x, y, Math.cos(a) * v, Math.sin(a) * v, o));
      }
      run();
    }
    function burstAt(el, n, o = {}) {
      const r = el.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, n, Object.assign({ spread: Math.PI * 2, speed: 560 }, o));
    }
    function rain(sec, rate) {
      rainStart = performance.now();
      rainEnd = rainStart + sec * 1000;
      rainRate = (rate || 90) * (reduceMotion ? 0.3 : 1);
      run();
    }
    function setDrizzle(rate) {
      drizzle = reduceMotion ? 0 : rate;
      if (drizzle) run();
    }
    function heart(s) {
      g.beginPath();
      g.moveTo(0, s * 0.35);
      g.bezierCurveTo(-s * 0.95, -s * 0.2, -s * 0.45, -s * 0.9, 0, -s * 0.38);
      g.bezierCurveTo(s * 0.45, -s * 0.9, s * 0.95, -s * 0.2, 0, s * 0.35);
      g.fill();
    }
    function frame(t) {
      const dt = last ? Math.min(0.034, (t - last) / 1000) : 0.016;
      last = t;
      let rate = drizzle;
      if (t < rainEnd) rate += rainRate * (0.35 + 0.65 * (1 - (t - rainStart) / (rainEnd - rainStart)));
      acc += rate * dt;
      while (acc >= 1) {
        acc -= 1;
        parts.push(piece(rand(-20, vw + 20), rand(-60, -12), rand(-30, 30), rand(30, 110), { grav: 260 }));
      }
      g.clearRect(0, 0, vw, vh);
      const drag = Math.max(0, 1 - 2.4 * dt);
      for (const p of parts) {
        p.life += dt;
        p.vx *= drag;
        if (p.vy < 0) p.vy *= drag;
        p.vy = Math.min(p.term, p.vy + p.grav * dt);
        p.x += (p.vx + Math.sin(p.life * p.sf + p.ph) * p.sway) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.tilt += p.vt * dt;
        const flip = Math.cos(p.tilt);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.scale(1, Math.max(0.15, Math.abs(flip)));
        g.fillStyle = flip >= 0 ? p.color : p.back;
        if (p.shape === 'rect') g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        else if (p.shape === 'circle') { g.beginPath(); g.arc(0, 0, p.w * 0.5, 0, 6.2832); g.fill(); }
        else heart(p.w * 1.5);
        g.restore();
      }
      parts = parts.filter((p) => p.y < vh + 50 && p.life < 30);
      if (parts.length || rate > 0) raf = requestAnimationFrame(frame);
      else { raf = 0; last = 0; g.clearRect(0, 0, vw, vh); }
    }
    function run() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
    return { resize, burst, burstAt, rain, setDrizzle };
  })();

  /* ---------- รูป (ถ้าไม่มีไฟล์ จะโชว์กรอบพาสเทลแทน) ---------- */
  const PH_EMOJI = ['🍓', '🌷', '🧸', '🍰', '🌈', '🐰', '🍑', '☁️', '🌻', '🍦', '🎀', '🐻'];
  const PH_BG = ['#FFC9D9', '#FFE6A6', '#C3EBD9', '#DDD1FF', '#C9E6FF', '#FFD6C4'];
  function photo(src, i, cls) {
    const box = h('div', { class: 'photo' + (cls ? ' ' + cls : '') });
    const showPh = () => {
      box.classList.add('is-ph');
      box.style.setProperty('--ph', PH_BG[i % PH_BG.length]);
      box.replaceChildren(h('span', { class: 'ph-emoji' }, PH_EMOJI[i % PH_EMOJI.length]), h('span', { class: 'ph-file' }, src || 'ยังไม่มีรูป'));
    };
    if (!src) { showPh(); return box; }
    const img = new Image();
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.addEventListener('error', showPh, { once: true });
    img.src = src;
    box.append(img);
    return box;
  }

  /* ---------- ครีมเยิ้มด้านบนการ์ด (วาดเป็นเวกเตอร์ตามความกว้างจริง) ---------- */
  function addDrip(el) {
    const w = Math.round(el.offsetWidth) || 400;
    const shapes = [[24, 28], [26, 18], [22, 36], [30, 24], [24, 32], [26, 18]]; // [กว้าง, ยาว]
    const xs = [];
    for (let x = 34; x < w - 24; x += 62) xs.push(x);
    let d = `M0,0 H${w} V18`;
    for (let i = xs.length - 1; i >= 0; i--) {
      const [dw, len] = shapes[i % shapes.length], r = dw / 2, cx = xs[i];
      d += ` H${cx + r} V${18 + len - r} A${r},${r} 0 0 1 ${cx - r},${18 + len - r} V18`;
    }
    d += ' H0 Z';
    el.insertAdjacentHTML('afterbegin', `<svg class="drip-band" width="${w}" height="60" viewBox="0 0 ${w} 60" aria-hidden="true"><path d="${d}" fill="#F27CA3"/></svg>`);
  }

  /* ---------- พื้นหลังโรยเม็ดน้ำตาล ---------- */
  function paintTextures() {
    const cols = ['#F59BB9', '#9ED9C1', '#F5CF6E', '#B7A4F0', '#98C8EE', '#F6B394'];
    let s = '';
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const x = gx * 80 + rand(16, 64), y = gy * 80 + rand(16, 64), r = Math.round(rand(0, 180));
        s += `<rect x="${(x - 8).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="16" height="6" rx="3" fill="${pick(cols)}" transform="rotate(${r} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
      }
    }
    const root = document.documentElement.style;
    root.setProperty('--sprinkles', svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><g opacity=".5">${s}</g></svg>`));
    root.setProperty('--heart-white', svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${HEART}" fill="#ffffff"/></svg>`));
  }

  /* ---------- เค้กความคืบหน้า มุมซ้ายบน ---------- */
  const HUD = (() => {
    const box = $('#hud-cake');
    box.append(h('i', { class: 'hud-plate' }));
    const layers = ['#FF9EBB', '#FFE08A', '#A8E6CF', '#CDB8FF', '#A9D8FF', '#FFC1A1'].map((c) => {
      const l = h('i', { class: 'hud-layer', style: `--lc:${c}` });
      box.append(l);
      return l;
    });
    // ผ่านแต่ละด่าน เค้กสูงขึ้นหนึ่งชั้น (ด่านกล้อง/รหัส/เค้กจริง ซ่อนไว้)
    const LAYERS_AT = { intro: 1, quiz: 2, memory: 3, gallery: 4, letter: 5, ask: 6 };
    function set(id) {
      const n = LAYERS_AT[id] || 0;
      document.body.classList.toggle('hud-on', n > 0);
      layers.forEach((l, i) => l.classList.toggle('on', i < n));
    }
    return { set };
  })();

  /* ---------- ย่อ/ขยายเวทีให้พอดีจอ ---------- */
  const stage = $('#stage');
  let S = 1;
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    S = Math.min(vw / W, vh / H);
    stage.style.setProperty('--s', S);
    FX.resize(vw, vh);
    document.body.classList.toggle('portrait', vh > vw * 1.05 && (navigator.maxTouchPoints || 0) > 0);
  }
  function relRect(el, root) {
    const a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    return { x: (a.left - b.left) / S, y: (a.top - b.top) / S, w: a.width / S, h: a.height / S };
  }

  /* =====================================================================
     ด่าน 0: ล็อกหน้าแรก
     ===================================================================== */
  function sceneLock(el, next) {
    const L = C.lock || {};
    const code = String(L.passcode || '1402').replace(/\D/g, '') || '1402';
    const wrongMsgs = (L.wrong && L.wrong.length) ? L.wrong : ['ผิดจ้า ลองใหม่อีกที'];
    let typed = '', wrong = 0, busy = false;

    const gift = h('div', { class: 'gift', 'aria-hidden': 'true' },
      h('div', { class: 'gift-shadow' }),
      h('div', { class: 'gift-body' }),
      h('div', { class: 'gift-lid' }, h('div', { class: 'bow' }, h('i'), h('i'), h('b'))));
    const msg = h('p', { class: 'lock-msg', 'aria-live': 'polite' }, fill(L.hint));
    const dots = h('div', { class: 'dots' }, Array.from(code, () => h('i')));
    const pad = h('div', { class: 'keypad' });
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'hint', '0', 'del'].forEach((k) => {
      const label = k === 'del' ? '⌫' : k === 'hint' ? '💡' : k;
      const aria = k === 'del' ? 'ลบ' : k === 'hint' ? 'ขอคำใบ้' : k;
      pad.append(h('button', { class: 'candy key' + (k.length > 1 ? ' key-fn' : ''), type: 'button', 'aria-label': aria, onclick: () => press(k) }, label));
    });
    el.append(
      h('div', { class: 'lock-left' }, gift, h('h1', { class: 'lock-title' }, fill(L.title)), h('p', { class: 'lock-sub' }, fill(L.subtitle)), msg),
      h('div', { class: 'lock-right' }, dots, pad));

    function paint() { Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i < typed.length)); }
    function say(text) { msg.textContent = text; msg.classList.remove('bump'); void msg.offsetWidth; msg.classList.add('bump'); }
    function press(k) {
      if (busy) return;
      if (k === 'hint') { Sound.sfx.pop(); say(fill(L.hint2 || L.hint)); return; }
      if (k === 'del') { typed = typed.slice(0, -1); Sound.sfx.tap(); paint(); return; }
      if (typed.length >= code.length) return;
      typed += k;
      Sound.sfx.tap();
      paint();
      if (typed.length === code.length) check();
    }
    function check() {
      busy = true;
      if (typed === code) {
        dots.classList.add('ok');
        say(fill(L.correct || 'ถูกต้อง! เปิดกล่องเลย 🎉'));
        Sound.sfx.chime();
        Music.start(); // ต้องเรียกตอนแตะ ไม่งั้น iPad ไม่ยอมเล่นเพลง
        gift.classList.add('open');
        setTimeout(() => FX.burstAt(gift, 70, { hearts: 0.5, speed: 700 }), 350);
        setTimeout(next, 1900);
        return;
      }
      wrong++;
      dots.classList.add('bad');
      Sound.sfx.boop();
      let t = fill(wrongMsgs[(wrong - 1) % wrongMsgs.length]);
      if (wrong >= 3 && L.hint2) t += ' ' + fill(L.hint2);
      say(t);
      setTimeout(() => { typed = ''; dots.classList.remove('bad'); paint(); busy = false; }, 700);
    }
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }

  /* =====================================================================
     ด่าน 1: เปิดเรื่อง
     ===================================================================== */
  function sceneIntro(el, next) {
    const lines = (C.intro && C.intro.length) ? C.intro : ['สุขสันต์วันเกิดนะ {name}'];
    const box = h('div', { class: 'intro-box' });
    el.append(box);
    let alive = true, skipFn = null;
    const wait = (ms) => new Promise((res) => {
      const t = setTimeout(done, ms);
      function done() { clearTimeout(t); if (skipFn === done) skipFn = null; res(); }
      skipFn = done;
    });
    el.addEventListener('click', () => { if (skipFn) skipFn(); });

    async function line(text, keep) {
      const p = h('p', { class: 'intro-line in' }, text);
      box.replaceChildren(p);
      if (keep) return;
      await wait(1500 + graphemes(text).length * 60);
      if (!alive) return;
      p.classList.replace('in', 'out');
      await sleep(380);
    }
    async function chat(text) {
      const field = h('span', { class: 'chat-text' });
      const send = h('span', { class: 'chat-send', html: SEND_SVG });
      const bar = h('div', { class: 'chatbar in' }, h('div', { class: 'chat-field' }, field, h('i', { class: 'caret' })), send);
      box.replaceChildren(bar);
      await sleep(600);
      const gs = graphemes(text);
      for (let i = 1; i <= gs.length && alive; i++) { field.textContent = gs.slice(0, i).join(''); await sleep(120); }
      await sleep(450);
      send.classList.add('wiggle');
      await sleep(1100);
      send.classList.remove('wiggle');
      await sleep(250);
      for (let i = gs.length - 1; i >= 0 && alive; i--) { field.textContent = gs.slice(0, i).join(''); await sleep(60); }
      await sleep(450);
      bar.classList.replace('in', 'out');
      await sleep(380);
    }
    (async () => {
      await sleep(500);
      for (let i = 0; i < lines.length && alive; i++) {
        const item = lines[i];
        if (item && typeof item === 'object' && item.chat) await chat(fill(item.chat));
        else await line(fill(item), i === lines.length - 1);
      }
      if (!alive) return;
      await sleep(900);
      if (!alive) return;
      box.append(h('button', {
        class: 'candy berry big intro-go', type: 'button',
        onclick: (e) => { e.stopPropagation(); Sound.sfx.pop(); next(); }
      }, fill(C.introButton || 'เริ่มเลย')));
    })();
    return () => { alive = false; };
  }

  /* =====================================================================
     ด่าน 2: ควิซ
     ===================================================================== */
  function sceneQuiz(el, next) {
    const Q = C.quiz || {};
    const qs = (Q.questions || []).filter((q) => q && q.choices && q.choices.length);
    if (!qs.length) { setTimeout(next, 50); return null; }
    const MARKS = ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ'];
    let i = 0, firstTry = 0, missed = false, locked = false, toastT = 0;

    const meta = h('p', { class: 'q-meta' });
    const text = h('h2', { class: 'q-text' });
    const card = h('div', { class: 'q-card drip' }, h('p', { class: 'q-title' }, fill(Q.title)), meta, text);
    const grid = h('div', { class: 'q-choices' });
    const toast = h('div', { class: 'q-toast', role: 'status' });
    const wrap = h('div', { class: 'q-wrap' }, card, h('div', { class: 'q-choices-box' }, grid, toast));
    el.append(wrap);
    addDrip(card);

    function render() {
      const q = qs[i];
      missed = false;
      locked = false;
      meta.textContent = `ข้อ ${i + 1} จาก ${qs.length}`;
      text.textContent = fill(q.q);
      grid.replaceChildren(...q.choices.map((c, ci) => h('button', {
        class: `candy choice c${ci % 4}`, type: 'button', style: `animation-delay:${ci * 60}ms`,
        onclick: (e) => choose(ci, e.currentTarget)
      }, h('span', { class: 'mark' }, MARKS[ci] || String(ci + 1)), h('span', { class: 'label' }, fill(c)))));
      card.classList.remove('swap');
      void card.offsetWidth;
      card.classList.add('swap');
    }
    function showToast(t) {
      toast.textContent = t;
      toast.classList.add('show');
      clearTimeout(toastT);
      toastT = setTimeout(() => toast.classList.remove('show'), 1800);
    }
    function choose(ci, btn) {
      if (locked) return;
      const q = qs[i];
      if (ci === Number(q.answer)) {
        locked = true;
        if (!missed) firstTry++;
        btn.classList.add('right');
        Sound.sfx.ding();
        FX.burstAt(btn, 36, { hearts: 0.6 });
        toast.classList.remove('show');
        setTimeout(() => reveal(q), 450);
      } else {
        missed = true;
        btn.classList.add('wrong');
        btn.disabled = true;
        Sound.sfx.boop();
        showToast(fill(q.no || 'ยังไม่ใช่น้า ลองใหม่'));
      }
    }
    function reveal(q) {
      const last = i === qs.length - 1;
      const pop = h('div', { class: 'q-pop' },
        h('div', { class: 'q-pop-card' },
          q.photo ? photo(q.photo, i, 'q-photo') : h('div', { class: 'q-pop-emoji', 'aria-hidden': 'true' }, '🎉'),
          h('div', { class: 'q-pop-body' },
            h('p', { class: 'q-pop-text' }, fill(q.yes || 'ถูกต้อง!')),
            h('button', {
              class: 'candy berry', type: 'button',
              onclick: () => { Sound.sfx.pop(); pop.remove(); if (last) result(); else { i++; render(); } }
            }, last ? 'ดูผลคะแนน' : 'ข้อต่อไป'))));
      wrap.append(pop);
    }
    function result() {
      const tiers = (Q.results || []).slice().sort((a, b) => b.min - a.min);
      const tier = tiers.find((r) => firstTry >= r.min) || { stamp: 'เก่งมาก', text: '' };
      wrap.replaceChildren(h('div', { class: 'q-result' },
        h('div', { class: 'stamp' }, fill(tier.stamp || 'เก่งมาก')),
        h('p', { class: 'q-score' }, `ตอบถูกตั้งแต่ครั้งแรก ${firstTry} จาก ${qs.length} ข้อ`),
        h('p', { class: 'q-rank' }, fill(tier.text)),
        h('button', { class: 'candy berry big', type: 'button', onclick: () => { Sound.sfx.pop(); next(); } }, 'ไปด่านต่อไป')));
      setTimeout(() => Sound.sfx.stamp(), 220);
      if (firstTry === qs.length) setTimeout(() => FX.rain(3, 70), 400);
    }
    render();
    return () => clearTimeout(toastT);
  }

  /* =====================================================================
     ด่าน 3: เกมจับคู่รูป เรียงเป็นหัวใจ
     ===================================================================== */
  function sceneMemory(el, next) {
    const M = C.memory || {};
    const srcs = ((M.photos && M.photos.length) ? M.photos : (C.photos || []).map((p) => p.src)).slice(0, 6);
    while (srcs.length < 6) srcs.push(null);
    // ตำแหน่งการ์ด 12 ใบในตาราง 5×4 ให้เป็นรูปหัวใจ (ช่องล่างสุดคือหัวใจรางวัล)
    const CELLS = [[1, 1], [1, 2], [1, 4], [1, 5], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [3, 2], [3, 3], [3, 4]];
    const deck = shuffle(srcs.flatMap((s, k) => [{ s, k }, { s, k }]));
    let open = [], busy = false, moves = 0, found = 0;

    const statFound = h('b', {}, '0'), statMoves = h('b', {}, '0');
    const body = h('div', { class: 'mem-panel-body' },
      M.hint ? h('p', { class: 'mem-hint' }, fill(M.hint)) : null,
      h('p', { class: 'mem-stat' }, 'เจอแล้ว ', statFound, ' จาก 6 คู่'),
      h('p', { class: 'mem-stat' }, 'เปิดไป ', statMoves, ' ครั้ง'));
    const panel = h('div', { class: 'mem-panel drip' }, h('h2', { class: 'mem-title' }, fill(M.title || 'จับคู่รูปของเรา')), body);
    const board = h('div', { class: 'mem-board' });
    deck.forEach((d, n) => {
      const card = h('button', {
        class: 'mem-card', type: 'button', 'aria-label': `การ์ดใบที่ ${n + 1}`,
        style: `grid-row:${CELLS[n][0]};grid-column:${CELLS[n][1]}`
      }, h('span', { class: 'mem-inner' }, h('span', { class: 'mem-back' }), h('span', { class: 'mem-front' }, photo(d.s, d.k))));
      card.dataset.k = String(d.k);
      card.addEventListener('click', () => flip(card));
      board.append(card);
    });
    const tip = h('div', { class: 'mem-tip', style: 'grid-row:4;grid-column:3', html: heartSvg() });
    board.append(tip);
    el.append(panel, board);
    addDrip(panel);

    function flip(card) {
      if (busy || card.classList.contains('flipped')) return;
      card.classList.add('flipped');
      Sound.sfx.tap();
      open.push(card);
      if (open.length < 2) return;
      moves++;
      statMoves.textContent = String(moves);
      const [a, b] = open;
      open = [];
      if (a.dataset.k === b.dataset.k) {
        setTimeout(() => {
          a.classList.add('matched');
          b.classList.add('matched');
          found++;
          statFound.textContent = String(found);
          Sound.sfx.sparkle();
          if (found === 6) win();
        }, 380);
      } else {
        busy = true;
        setTimeout(() => { a.classList.remove('flipped'); b.classList.remove('flipped'); busy = false; }, 900);
      }
    }
    function win() {
      tip.classList.add('on');
      setTimeout(() => { FX.burstAt(tip, 90, { hearts: 0.7, speed: 800 }); Sound.sfx.chime(); }, 300);
      body.replaceChildren(
        h('p', { class: 'mem-done' }, fill(M.done || 'ครบแล้ว! ความจำดีมาก')),
        h('p', { class: 'mem-stat' }, `ใช้ไปทั้งหมด ${moves} ครั้ง`),
        h('button', { class: 'candy berry big', type: 'button', onclick: () => { Sound.sfx.pop(); next(); } }, 'ไปดูรูปของเรา'));
    }
    return null;
  }

  /* =====================================================================
     ด่าน 4: แกลเลอรีโพลารอยด์
     ===================================================================== */
  function sceneGallery(el, next) {
    const G = C.gallery || {};
    const ps = (C.photos || []).slice(0, 12);
    const n = ps.length;
    const seen = new Set();
    const nextBtn = h('button', { class: 'candy berry gal-next', type: 'button', onclick: () => { Sound.sfx.pop(); next(); } }, 'ไปต่อ');
    const table = h('div', { class: 'gal-table' });
    el.append(
      h('header', { class: 'gal-head' }, h('h2', {}, fill(G.title || 'รูปของเรา')), G.hint ? h('p', {}, fill(G.hint)) : null),
      table,
      h('div', { class: 'gal-foot' }, nextBtn));

    // วางรูปกระจายแบบวางบนโต๊ะ
    const AW = 1080, AH = 520;
    const cols = n <= 4 ? Math.max(1, n) : n <= 8 ? 4 : n <= 10 ? 5 : 6;
    const rows = Math.max(1, Math.ceil(n / cols));
    const cw = AW / cols, ch = AH / rows;
    const pw = Math.min(220, cw - 40, (ch - 26) / 1.22);
    ps.forEach((p, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const x = (AW - inRow * cw) / 2 + c * cw + cw / 2 + rand(-12, 12);
      const y = r * ch + ch / 2 + rand(-8, 8);
      const pol = h('button', {
        class: 'polaroid', type: 'button', 'aria-label': `ดูรูปที่ ${i + 1}`,
        style: `width:${pw.toFixed(0)}px;left:${(x - pw / 2).toFixed(0)}px;top:${(y - pw * 0.6).toFixed(0)}px;--r:${rand(-7, 7).toFixed(1)}deg`
      }, h('span', { class: 'tape' }), photo(p.src, i), h('span', { class: 'pol-date' }, fill(p.date)));
      pol.addEventListener('click', () => openView(i, pol));
      table.append(pol);
    });
    const inner = h('div', { class: 'vcard-inner' });
    const vcard = h('button', { class: 'vcard', type: 'button', 'aria-label': 'พลิกรูป' }, inner);
    const viewer = h('div', { class: 'viewer', hidden: true },
      h('div', { class: 'viewer-bg', onclick: closeView }),
      vcard,
      h('button', { class: 'candy round viewer-x', type: 'button', 'aria-label': 'ปิด', onclick: closeView }, '✕'));
    el.append(viewer);
    vcard.addEventListener('click', () => { vcard.classList.toggle('flipped'); Sound.sfx.pop(); });

    function openView(i, pol) {
      const p = ps[i];
      if (!seen.has(i)) {
        seen.add(i);
        pol.insertAdjacentHTML('beforeend', heartSvg('seen-heart'));
        if (seen.size === n) nextBtn.classList.add('ready');
      }
      inner.replaceChildren(
        h('div', { class: 'vface vfront' }, photo(p.src, i), h('span', { class: 'vdate' }, fill(p.date))),
        h('div', { class: 'vface vback', html: '' },
          h('p', { class: 'vback-date' }, fill(p.date)),
          h('p', { class: 'vback-cap' }, fill(p.caption))));
      inner.lastChild.insertAdjacentHTML('beforeend', heartSvg());
      vcard.classList.remove('flipped');
      viewer.hidden = false;
      viewer.classList.remove('show');
      void viewer.offsetWidth;
      viewer.classList.add('show');
      Sound.sfx.pop();
    }
    function closeView() {
      viewer.classList.remove('show');
      setTimeout(() => { if (!viewer.classList.contains('show')) viewer.hidden = true; }, 260);
    }
    return null;
  }

  /* =====================================================================
     ด่าน 5: จดหมาย
     ===================================================================== */
  function sceneLetter(el, next) {
    const Lt = C.letter || {};
    const paras = (Array.isArray(Lt.body) ? Lt.body : String(Lt.body || '').split(/\n+/)).map((t) => fill(t).trim()).filter(Boolean);
    const seal = h('button', { class: 'seal', type: 'button', 'aria-label': 'เปิดจดหมาย', html: heartSvg() });
    const env = h('div', { class: 'envelope' },
      h('div', { class: 'env-back' }),
      h('div', { class: 'env-letter' }, fill(Lt.greeting)),
      h('div', { class: 'env-front' }),
      h('div', { class: 'env-flap' }),
      seal);
    const hint = Lt.sealHint ? h('p', { class: 'env-hint' }, fill(Lt.sealHint)) : null;
    const box = h('div', { class: 'env-stage' }, env, hint);
    el.append(box);
    let alive = true, opened = false, skip = false;

    seal.addEventListener('click', async () => {
      if (opened) return;
      opened = true;
      Sound.sfx.pop();
      if (hint) hint.classList.add('hide');
      env.classList.add('open');
      await sleep(330);
      env.classList.add('flap-back');
      await sleep(320);
      env.classList.add('out');
      Sound.sfx.whoosh();
      await sleep(1000);
      if (!alive) return;
      box.classList.add('away');
      openSheet();
    });

    function openSheet() {
      const scroll = h('div', { class: 'letter-scroll' });
      const sheet = h('div', { class: 'letter-sheet' }, h('p', { class: 'letter-greet' }, fill(Lt.greeting)), scroll);
      sheet.addEventListener('click', () => { skip = true; }); // แตะจดหมาย = ข้ามไปอ่านทั้งหมด
      el.append(sheet);
      (async () => {
        await sleep(600);
        for (const text of paras) {
          if (!alive) return;
          const p = h('p');
          scroll.append(p);
          if (skip) { p.textContent = text; continue; }
          const gs = graphemes(text);
          let acc = '';
          for (let j = 0; j < gs.length; j++) {
            if (!alive) return;
            if (skip) { p.textContent = text; break; }
            acc += gs[j];
            p.textContent = acc;
            if (j % 4 === 0) scroll.scrollTop = scroll.scrollHeight;
            await sleep(/[.!?…]/.test(gs[j]) ? 260 : gs[j] === ' ' ? 110 : 45);
          }
          scroll.scrollTop = scroll.scrollHeight;
          if (!skip) await sleep(450);
        }
        if (!alive) return;
        scroll.append(
          h('div', { class: 'letter-sign' }, h('p', {}, fill(Lt.signoff || 'รักนะ')), h('p', { class: 'sig' }, fill(Lt.signature || '{from}'))),
          h('button', {
            class: 'candy berry letter-done', type: 'button',
            onclick: (e) => { e.stopPropagation(); Sound.sfx.pop(); next(); }
          }, fill(Lt.done || 'อ่านจบแล้ว')));
        scroll.scrollTo({ top: scroll.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
      })();
    }
    return () => { alive = false; };
  }

  /* =====================================================================
     ด่าน 6: คำถามสำคัญ — ปุ่ม "ไม่" หนี ปุ่ม "ได้" โตขึ้น
     ===================================================================== */
  function sceneAsk(el, next) {
    const A = C.ask || {};
    const labels = (A.no && A.no.length) ? A.no : ['ไม่เอา'];
    const face = h('div', { class: 'ask-face', 'aria-hidden': 'true' }, A.emoji || '🥺');
    const q = h('h2', { class: 'ask-q' }, fill(A.question));
    const note = h('p', { class: 'ask-note', 'aria-live': 'polite' });
    const yes = h('button', { class: 'candy berry ask-yes', type: 'button' }, fill(A.yes || 'ได้สิ'));
    const no = h('button', { class: 'candy ask-no', type: 'button' }, fill(labels[0]));
    const row = h('div', { class: 'ask-row' }, yes, no);
    el.append(face, q, row, note);
    let tries = 0, grow = 1, lastDodge = 0, done = false;

    function findSpot() {
      const bw = no.offsetWidth, bh = no.offsetHeight;
      const avoid = [relRect(yes, el), relRect(q, el), relRect(face, el)];
      const cx = parseFloat(no.style.left) || 0, cy = parseFloat(no.style.top) || 0;
      const hits = (x, y, r) => x < r.x + r.w + 30 && x + bw > r.x - 30 && y < r.y + r.h + 30 && y + bh > r.y - 30;
      for (let k = 0; k < 60; k++) {
        const x = rand(40, W - bw - 40), y = rand(130, H - bh - 40);
        if (avoid.some((r) => hits(x, y, r))) continue;
        if (Math.hypot(x - cx, y - cy) < 240) continue;
        return { x, y };
      }
      return { x: rand(40, W - bw - 40), y: H - bh - 44 };
    }
    function dodge(e) {
      if (done) return;
      if (e && e.cancelable) e.preventDefault();
      const now = performance.now();
      if (now - lastDodge < 250) return;
      lastDodge = now;
      tries++;
      grow = Math.min(2.2, grow + 0.17);
      yes.style.setProperty('--grow', grow.toFixed(2));
      Sound.sfx.whoosh();
      if (tries >= labels.length) {
        no.classList.add('gone');
        note.textContent = fill(A.gone || '');
        setTimeout(() => no.remove(), 450);
        return;
      }
      no.textContent = fill(labels[tries]);
      if (!no.classList.contains('free')) {
        const r = relRect(no, el);
        no.classList.add('free');
        no.style.left = r.x + 'px';
        no.style.top = r.y + 'px';
        el.append(no);
        void no.offsetWidth;
      }
      const spot = findSpot();
      no.style.left = spot.x.toFixed(0) + 'px';
      no.style.top = spot.y.toFixed(0) + 'px';
    }
    no.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') dodge(e); });
    no.addEventListener('pointerdown', dodge);
    no.addEventListener('click', (e) => { e.preventDefault(); dodge(); });
    yes.addEventListener('click', () => {
      if (done) return;
      done = true;
      Sound.sfx.sparkle();
      FX.burstAt(yes, 120, { hearts: 0.8, speed: 900 });
      if (no.isConnected) no.classList.add('gone');
      face.textContent = A.afterEmoji || '🥰';
      q.textContent = fill(A.after || 'เย้!');
      note.textContent = '';
      yes.disabled = true;
      setTimeout(() => {
        row.replaceChildren(h('button', { class: 'candy berry big', type: 'button', onclick: () => { Sound.sfx.pop(); next(); } }, fill(A.next || 'ไปต่อ')));
      }, 1500);
    });
    return null;
  }

  /* =====================================================================
     ด่าน 7: เค้กวันเกิด — เป่าเทียนผ่านไมค์จริง แล้วกระดาษสีโปรยลงมา
     ===================================================================== */
  const WICK_Y = 142;
  function candleXs(n) {
    if (n === 1) return [300];
    const a = n > 6 ? 180 : 200, b = n > 6 ? 420 : 400;
    return Array.from({ length: n }, (_, i) => Math.round(a + (b - a) * i / (n - 1)));
  }
  function dripD(x, y, w, base, maxLen, count, rc) {
    const seg = w / count, yb = y + base;
    let d = `M${x},${y + rc} Q${x},${y} ${x + rc},${y} H${x + w - rc} Q${x + w},${y} ${x + w},${y + rc} V${yb}`;
    for (let i = count - 1; i >= 0; i--) {
      const cx = x + seg * i + seg / 2 + rand(-seg * 0.12, seg * 0.12);
      const r = seg * rand(0.2, 0.28);
      const len = rand(Math.max(r + 6, maxLen * 0.3), maxLen);
      d += ` L${(cx + r).toFixed(1)},${yb} V${(yb + len - r).toFixed(1)} A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${(cx - r).toFixed(1)},${(yb + len - r).toFixed(1)} V${yb}`;
    }
    return d + ` L${x},${yb} Z`;
  }
  function cakeSvg(n, name) {
    const xs = candleXs(n);
    const candleCols = ['#BFE3FF', '#FFE69A', '#C6F0DA', '#E3D7FF', '#FFD2BF'];
    const sc = ['#7FD3B2', '#FFC94D', '#A98BFF', '#6CBFFF', '#FF9466', '#FFFFFF'];
    let sprinkles = '', pearlsB = '', pearlsT = '';
    for (let i = 0; i < 30; i++) {
      const x = rand(96, 504), y = rand(458, 528), r = Math.round(rand(0, 180));
      sprinkles += `<rect x="${(x - 6).toFixed(1)}" y="${(y - 2.2).toFixed(1)}" width="12" height="4.4" rx="2.2" fill="${pick(sc)}" transform="rotate(${r} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }
    for (let x = 86; x <= 515; x += 21.4) pearlsB += `<circle cx="${x.toFixed(1)}" cy="547" r="10" fill="#FFFFFF"/>`;
    for (let x = 164; x <= 437; x += 19.4) pearlsT += `<circle cx="${x.toFixed(1)}" cy="371" r="8" fill="#FFD3E1"/>`;
    const candleH = 240 - WICK_Y - 10;
    const candles = xs.map((x, i) =>
      `<rect x="${x - 9}" y="${WICK_Y + 10}" width="18" height="${candleH}" rx="6" fill="${candleCols[i % candleCols.length]}"/>` +
      `<rect x="${x - 9}" y="${WICK_Y + 10}" width="18" height="${candleH}" rx="6" fill="url(#stripes)"/>` +
      `<path d="M${x} ${WICK_Y + 11}V${WICK_Y + 1}" stroke="#6B4450" stroke-width="3" stroke-linecap="round"/>`).join('');
    const len = graphemes(name).length;
    const fs = len > 12 ? 22 : len > 8 ? 28 : 36;
    return `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><pattern id="stripes" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="5" height="12" fill="rgba(255,255,255,.75)"/></pattern></defs>
      <ellipse cx="300" cy="568" rx="290" ry="24" fill="rgba(219,63,116,.15)"/>
      <ellipse cx="300" cy="552" rx="284" ry="30" fill="#FFFFFF"/>
      <rect x="70" y="350" width="460" height="200" rx="28" fill="#FFB3C9"/>
      <path d="${dripD(70, 350, 460, 40, 62, 9, 28)}" fill="#FFF8FB"/>
      ${sprinkles}${pearlsB}${candles}
      <rect x="150" y="226" width="300" height="148" rx="24" fill="#FFF4F8"/>
      <path d="${dripD(150, 226, 300, 28, 36, 7, 24)}" fill="#F0709A"/>
      ${name ? `<text x="300" y="346" text-anchor="middle" font-family="Sriracha, Mali, cursive" font-size="${fs}" fill="#E0507F">${esc(name)}</text>` : ''}
      ${pearlsT}
    </svg>`;
  }

  // ฟังเสียงลมจากไมค์ แล้วส่งระดับความแรง 0–1 ออกมาทุกเฟรม
  const micDebug = { rms: 0, floor: 0, state: '' };
  async function openMic(sensitivity, onLevel) {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) throw new Error('ไม่รองรับไมค์ (ต้องเปิดผ่าน https)');
    Sound.setSession('play-and-record');
    let stream;
    try {
      stream = await md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (err) {
      Sound.setSession('playback');
      throw err;
    }
    let ac = Sound.ensure(), src;
    try {
      src = ac.createMediaStreamSource(stream);
    } catch (e) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC();
      src = ac.createMediaStreamSource(stream);
    }
    if (ac.state !== 'running') { try { await ac.resume(); } catch (e) { /* ignore */ } }
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.2;
    // ต่อปลายทางด้วยเสียง 0 — Safari จะไม่ประมวลผลไมค์ถ้าสายสัญญาณไม่ไปถึงลำโพง
    const mute = ac.createGain();
    mute.gain.value = 0;
    src.connect(an);
    an.connect(mute);
    mute.connect(ac.destination);
    const hasFloat = typeof an.getFloatTimeDomainData === 'function';
    const td = new Float32Array(an.fftSize), tb = new Uint8Array(an.fftSize);
    const sens = clamp(Number(sensitivity) || 1, 0.3, 3);
    const t0 = performance.now(), cal = [];
    let floor = 0.01, raf = 0, stopped = false, last = t0;
    function loop(now) {
      if (stopped) return;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      let sum = 0;
      if (hasFloat) {
        an.getFloatTimeDomainData(td);
        for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
      } else {
        an.getByteTimeDomainData(tb);
        for (let i = 0; i < tb.length; i++) { const v = (tb[i] - 128) / 128; sum += v * v; }
      }
      const rms = Math.sqrt(sum / an.fftSize);
      micDebug.rms = rms;
      micDebug.floor = floor;
      micDebug.state = ac.state;
      if (now - t0 < 500) {
        // ครึ่งวินาทีแรก วัดเสียงรบกวนในห้องก่อน
        cal.push(rms);
        const sorted = cal.slice().sort((a, b) => a - b);
        floor = Math.min(0.04, sorted[Math.floor(sorted.length / 2)] || 0.01);
        onLevel(0, dt);
      } else {
        const thr = Math.max(0.08 / sens, floor * 4);
        onLevel(clamp((rms - thr) / (thr * 1.5), 0, 1), dt);
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return {
      stop() {
        stopped = true;
        cancelAnimationFrame(raf);
        try { src.disconnect(); an.disconnect(); mute.disconnect(); } catch (e) { /* ignore */ }
        stream.getTracks().forEach((t) => t.stop());
        Sound.setSession('playback');
      }
    };
  }

  function headline(text) {
    const cols = ['#DB3F74', '#E0952B', '#2FA57E', '#7B5BE0', '#2F8FD8', '#E06A3A'];
    let k = 0;
    return text.split(/\s+/).filter(Boolean).map((word) => h('span', { class: 'hb-word' },
      graphemes(word).map((ch) => h('span', { class: 'hb-ch', style: `--i:${k};--col:${cols[k++ % cols.length]}` }, ch))));
  }

  function sceneCake(el, next) {
    const K = C.cake || {};
    const n = clamp(parseInt(K.candles, 10) || 5, 1, 9);
    Music.duck(true); // ปิดเพลงพื้นหลังไว้ ไม่ให้ไมค์ได้ยินเพลง
    const wrap = h('div', { class: 'cake-wrap', html: cakeSvg(n, fill(K.nameOnCake == null ? '{name}' : K.nameOnCake)) });
    const xs = candleXs(n);
    const lit = xs.map(() => true);
    const order = shuffle(xs.map((_, i) => i));
    let litCount = n, finished = false, alive = true, mic = null, energy = 0, songT = 0, finalT = 0;

    const slots = xs.map((x, i) => {
      const s = h('button', {
        class: 'flame-slot', type: 'button', 'aria-label': `เป่าเทียนเล่มที่ ${i + 1}`,
        style: `left:${x}px;top:${WICK_Y}px;--fd:${rand(0.7, 1.1).toFixed(2)}s`
      }, h('span', { class: 'glow' }), h('span', { class: 'flame' }, h('i')));
      s.addEventListener('click', (e) => { e.stopPropagation(); blowOut(i); });
      wrap.append(s);
      return s;
    });
    const micBtn = h('button', { class: 'candy berry big mic-btn', type: 'button', html: `${MIC_SVG}<span>${esc(fill(K.micButton || 'เปิดไมค์'))}</span>` });
    const bar = h('i');
    const meter = h('div', { class: 'meter', hidden: true }, bar);
    const status = h('p', { class: 'cake-status', 'aria-live': 'polite' }, fill(K.tapHint || ''));
    const side = h('div', { class: 'cake-side' }, h('h2', { class: 'cake-title' }, fill(K.title)), micBtn, meter, status);
    el.append(wrap, side);

    function blowOut(i) {
      if (finished || !lit[i]) return;
      lit[i] = false;
      litCount--;
      const s = slots[i];
      s.classList.add('out');
      s.disabled = true;
      for (let k = 0; k < 3; k++) {
        s.append(h('span', { class: 'smoke', style: `animation-delay:${(k * 0.18).toFixed(2)}s;--dx:${Math.round(rand(-18, 18))}px` }));
      }
      Sound.sfx.puff();
      if (litCount === 0) finale();
    }
    function onLevel(lvl, dt) {
      if (finished) return;
      bar.style.width = Math.round(lvl * 100) + '%';
      slots.forEach((s, i) => {
        if (!lit[i]) return;
        s.style.setProperty('--lean', (lvl * (26 + (i % 3) * 6)).toFixed(1) + 'deg');
        s.style.setProperty('--sy', (1 - lvl * 0.45).toFixed(2));
      });
      if (lvl > 0.15) {
        energy += lvl * dt;
        while (energy >= 0.1 && litCount > 0) {
          energy -= 0.1;
          blowOut(order.find((k) => lit[k]));
        }
      } else {
        energy = Math.max(0, energy - dt * 0.15);
      }
    }
    micBtn.addEventListener('click', async () => {
      if (micBtn.disabled) return;
      micBtn.disabled = true;
      Sound.sfx.pop();
      try {
        const m = await openMic(K.sensitivity, onLevel);
        if (!alive || finished) { m.stop(); return; }
        mic = m;
        micBtn.hidden = true;
        meter.hidden = false;
        status.textContent = fill(K.listening || '');
      } catch (err) {
        console.warn('เปิดไมค์ไม่ได้:', err);
        micBtn.disabled = false;
        status.textContent = fill(K.micFailed || 'เปิดไมค์ไม่ได้ แตะที่เปลวเทียนแทนนะ');
        slots.forEach((s) => s.classList.add('nudge'));
      }
    });

    async function finale() {
      finished = true;
      if (mic) { mic.stop(); mic = null; }
      micBtn.hidden = true;
      meter.hidden = true;
      status.textContent = '';
      await sleep(600);
      if (!alive) return;
      document.body.classList.add('lights-off'); // ไฟดับแป๊บนึงเหมือนตอนเป่าเค้กจริง
      await sleep(1100);
      if (!alive) return;
      document.body.classList.remove('lights-off');
      el.classList.add('party');
      Sound.ensure();
      const vw = window.innerWidth, vh = window.innerHeight;
      FX.burst(0, vh, 120, { angle: -Math.PI / 3, spread: 0.8, speed: 1500 });
      FX.burst(vw, vh, 120, { angle: -2 * Math.PI / 3, spread: 0.8, speed: 1500 });
      FX.rain(6, 110);
      FX.setDrizzle(10);
      const songLen = Sound.birthdaySong();
      songT = setTimeout(() => Music.duck(false), songLen * 1000 + 300);
      side.replaceChildren(
        h('h1', { class: 'hb' }, headline(fill(K.headline || 'HAPPY BIRTHDAY'))),
        h('p', { class: 'hb-name' }, fill(C.name)),
        h('p', { class: 'hb-wish' }, fill(K.wish)));
      wrap.addEventListener('click', () => { FX.burstAt(wrap, 50, { hearts: 0.5, speed: 700 }); Sound.sfx.sparkle(); });
      if (K.finalImage) finalT = setTimeout(revealFinal, (Number(K.finalDelay) || 7) * 1000);
    }

    // ภาพปิดท้าย: เค้กค่อยๆ หลบไป แล้วภาพคอลลาจของเราสองคนลอยขึ้นมาแทน
    function revealFinal() {
      if (!alive) return;
      const img = h('img', { class: 'final-img', src: K.finalImage, alt: '', draggable: 'false' });
      const fin = h('div', { class: 'final' }, img);
      img.addEventListener('error', () => { fin.remove(); el.classList.remove('finale-reveal'); }, { once: true });
      fin.addEventListener('click', () => { FX.burstAt(img, 60, { hearts: 0.75, speed: 750 }); Sound.sfx.sparkle(); });
      el.append(fin);
      el.classList.add('finale-reveal');
      Sound.sfx.chime();
      FX.setDrizzle(5); // กระดาษสีโปรยเบาๆ ไม่บังหน้าในรูป
    }

    return () => {
      alive = false;
      if (mic) { mic.stop(); mic = null; }
      clearTimeout(songT);
      clearTimeout(finalT);
      FX.setDrizzle(0);
      document.body.classList.remove('lights-off');
      Music.duck(false);
    };
  }

  /* =====================================================================
     ตัวสลับด่าน
     ===================================================================== */
  const camKit = { h, C, fill, Sound, Music, FX, HEART, addDrip };
  const ALL_SCENES = [
    { id: 'camera', build: (el, next) => (window.CameraScene ? window.CameraScene(el, next, camKit) : (setTimeout(next, 0), null)) },
    { id: 'lock', build: sceneLock },
    { id: 'intro', build: sceneIntro },
    { id: 'quiz', build: sceneQuiz },
    { id: 'memory', build: sceneMemory },
    { id: 'gallery', build: sceneGallery },
    { id: 'letter', build: sceneLetter },
    { id: 'ask', build: sceneAsk },
    { id: 'cake', build: sceneCake }
  ];
  let SCENES = ALL_SCENES;
  const root = $('#scenes');
  let cur = -1, curEl = null, cleanup = null, devLabel = null;

  function go(i) {
    i = clamp(i, 0, SCENES.length - 1);
    if (cleanup) {
      try { cleanup(); } catch (e) { console.error(e); }
      cleanup = null;
    }
    if (curEl) {
      const old = curEl;
      old.classList.remove('entered');
      old.classList.add('leaving');
      setTimeout(() => old.remove(), 500);
    }
    cur = i;
    const def = SCENES[i];
    const el = h('section', { class: `scene scene-${def.id}`, 'data-scene': def.id });
    curEl = el;
    root.append(el);
    HUD.set(def.id);
    if (devLabel) devLabel.textContent = def.id;
    cleanup = def.build(el, () => { if (curEl === el) go(i + 1); }) || null;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('entered')));
  }
  function goId(id) {
    const k = SCENES.findIndex((s) => s.id === id);
    go(k >= 0 ? k : 0);
  }

  /* ---------- ค่าที่ตั้งจากหน้า admin (เก็บไว้ในเครื่องนี้เท่านั้น) ---------- */
  const STORE_KEY = 'for-you:config:v1';
  function deepMerge(base, over) {
    if (!over || typeof over !== 'object' || Array.isArray(over)) return over;
    const out = (base && typeof base === 'object' && !Array.isArray(base)) ? base : {};
    for (const k of Object.keys(over)) out[k] = deepMerge(out[k], over[k]);
    return out;
  }
  function openMediaDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('ไม่มี IndexedDB')); return; }
      const rq = indexedDB.open('for-you', 1);
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('media')) rq.result.createObjectStore('media'); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  // แปลง "idb:<id>" (รูป/เพลงที่อัปจากหน้า admin) เป็นลิงก์ที่เบราว์เซอร์เปิดได้
  async function resolveMedia(cfg) {
    const ids = new Set();
    const walk = (v) => {
      if (typeof v === 'string') { if (v.startsWith('idb:')) ids.add(v.slice(4)); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(cfg);
    if (!ids.size) return;
    const db = await openMediaDb();
    const urls = {};
    await Promise.all([...ids].map((id) => new Promise((done) => {
      const rq = db.transaction('media', 'readonly').objectStore('media').get(id);
      rq.onsuccess = () => { if (rq.result instanceof Blob) urls[id] = URL.createObjectURL(rq.result); done(); };
      rq.onerror = () => done();
    })));
    const swap = (v) => {
      if (typeof v === 'string') return v.startsWith('idb:') ? (urls[v.slice(4)] || '') : v;
      if (Array.isArray(v)) return v.map(swap);
      if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = swap(v[k]); }
      return v;
    };
    swap(cfg);
  }
  async function loadOverrides() {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    try { deepMerge(C, JSON.parse(raw)); } catch (e) { console.warn('ข้อมูลจากหน้า admin อ่านไม่ได้ ใช้ค่าเริ่มต้นแทน', e); return; }
    try { await resolveMedia(C); } catch (e) { console.warn('โหลดรูป/เพลงที่เก็บในเครื่องไม่ได้', e); }
  }

  /* ---------- เริ่มต้น ---------- */
  paintTextures();
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 250));
  document.addEventListener('gesturestart', (e) => e.preventDefault()); // กันซูมด้วยสองนิ้วบน iPad
  document.addEventListener('touchstart', () => {}, { passive: true }); // ให้ปุ่มยุบตอนแตะบน iOS

  // ปลดล็อกเสียงตั้งแต่การแตะครั้งแรก (iPad บังคับ) — เพลงเริ่มตอนใส่รหัสถูก หรือตอนเปิดกล้อง
  const unlockAll = () => { Sound.unlock(); if (SCENES[cur] && SCENES[cur].id !== 'lock') Music.start(); };
  ['touchend', 'click', 'keydown'].forEach((ev) => window.addEventListener(ev, unlockAll, { capture: true, passive: true }));

  // แตะมุมซ้ายบน 5 ครั้งติดกัน = เปิดหน้า admin (ใช้ได้แม้เปิดจากไอคอนบนหน้าจอโฮม)
  let cornerTaps = [];
  window.addEventListener('pointerdown', (e) => {
    if (e.clientX > 90 || e.clientY > 90) { cornerTaps = []; return; }
    const now = performance.now();
    cornerTaps = cornerTaps.filter((t) => now - t < 2500);
    cornerTaps.push(now);
    if (cornerTaps.length >= 5) { cornerTaps = []; location.href = 'admin.html'; }
  }, { capture: true, passive: true });

  async function boot() {
    await loadOverrides();
    document.title = fill(C.siteTitle || document.title);
    Music.init();
    SCENES = ALL_SCENES.filter((s) => s.id !== 'camera' || (C.camera && C.camera.enabled !== false));

    // โหลดรูปล่วงหน้า จะได้ไม่กระพริบตอนพลิกการ์ด
    (C.photos || []).forEach((p) => { if (p && p.src) { const im = new Image(); im.src = p.src; } });
    if (C.cake && C.cake.finalImage) { const im = new Image(); im.src = C.cake.finalImage; }

    if (DEV) {
      const nav = $('#dev-nav');
      devLabel = h('span');
      nav.append(
        h('button', { type: 'button', onclick: () => go(cur - 1) }, '◀'),
        devLabel,
        h('button', { type: 'button', onclick: () => go(cur + 1) }, '▶'));
      nav.hidden = false;
    }

    const want = params.get('scene');
    let start = 0;
    if (want) {
      const k = SCENES.findIndex((s) => s.id === want);
      start = k >= 0 ? k : clamp(parseInt(want, 10) || 0, 0, SCENES.length - 1);
    }
    go(start);
  }
  boot();

  // ไว้ทดสอบจากคอนโซล
  window.__surprise = { go, goId, FX, Sound, micDebug, config: C };
})();
