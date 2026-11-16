/* =====================================================================
   admin.js — หน้าหลังบ้าน: แก้ข้อความ รูป คำถาม และเพลง โดยไม่ต้องแก้โค้ด
   ---------------------------------------------------------------------
   ข้อมูลเก็บไว้ในเครื่อง (หน้าเว็บหลักอ่านจากที่เดียวกัน):
   • localStorage "for-you:config:v1" = JSON เฉพาะส่วนที่ต่างจาก window.CONFIG (หน้าเว็บหลักเอาไปผสานทับค่าเริ่มต้น)
   • IndexedDB ฐาน "for-you" (v1) ที่เก็บ "media" (ไม่มี keyPath)
     คีย์ "m_…" ค่าเป็น Blob — ในคอนฟิกอ้างถึงไฟล์ด้วยข้อความ "idb:<คีย์>"
   • ไฟล์สำรอง: { format: "for-you-backup", version: 1, savedAt, config, media: { id: dataURL } }
   ===================================================================== */
(() => {
  'use strict';

  const KEY = 'for-you:config:v1';
  const DB_NAME = 'for-you';
  const DB_VERSION = 1;
  const STORE = 'media';
  const IDB = 'idb:';
  const BACKUP_FORMAT = 'for-you-backup';
  const BACKUP_VERSION = 1;

  const MAX_SIDE = 1600;       // ย่อรูปให้ด้านยาวไม่เกินนี้
  const JPEG_QUALITY = 0.85;
  const SAVE_DELAY = 400;
  const MARKS = ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ'];
  const PH_EMOJI = ['🍓', '🌷', '🧸', '🍰', '🌈', '🐰', '🍑', '☁️', '🌻', '🍦', '🎀', '🐻'];
  const PH_BG = ['#FFC9D9', '#FFE6A6', '#C3EBD9', '#DDD1FF', '#C9E6FF', '#FFD6C4'];

  /* ---------- เครื่องมือเล็กๆ ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const str = (v) => (v == null ? '' : String(v));
  const isIdbSrc = (s) => typeof s === 'string' && s.startsWith(IDB) && s.length > IDB.length;
  const idOf = (s) => s.slice(IDB.length);
  const newId = () => 'm_' + Date.now().toString(36) + '_' + (Math.random().toString(36) + '000000').slice(2, 8);
  const toAscii = (s) => String(s).replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0E50)); // เลขไทย → เลขอารบิก
  const splitLines = (v) => String(v).replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const splitParas = (v) => String(v).replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const short = (s, n) => { s = str(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const fmtBytes = (n) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 || /quota/i.test(e.message || ''));
  const errText = (e) => (isQuota(e) ? 'พื้นที่ในเครื่องเต็ม' : (e && e.message) || 'เกิดข้อผิดพลาด');
  let uidN = 0;
  const uid = (p) => (p || 'f') + '-' + (++uidN);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'multiple') el[k] = true;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  /* ---------- ผสานคอนฟิก: object ผสานกัน, array กับค่าเดี่ยวแทนที่ไปเลย (แบบเดียวกับหน้าเว็บหลัก) ---------- */
  function deepMerge(base, over) {
    if (over === undefined) return clone(base);
    if (Array.isArray(over)) return clone(over);
    if (isObj(over)) {
      const out = isObj(base) ? clone(base) : {};
      for (const k of Object.keys(over)) out[k] = deepMerge(out[k], over[k]);
      return out;
    }
    return over;
  }
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, v) {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) {
      if (!isObj(o[ks[i]])) o[ks[i]] = {};
      o = o[ks[i]];
    }
    o[ks[ks.length - 1]] = v;
  }
  // หา "idb:<id>" ทุกที่ในคอนฟิก
  function collectRefs(v, out) {
    out = out || new Set();
    if (typeof v === 'string') { if (isIdbSrc(v)) out.add(idOf(v)); }
    else if (Array.isArray(v)) v.forEach((x) => collectRefs(x, out));
    else if (isObj(v)) Object.keys(v).forEach((k) => collectRefs(v[k], out));
    return out;
  }

  /* ---------- จัดรูปคอนฟิกให้แก้ได้แน่ๆ (ยังไม่บันทึกจนกว่าจะมีการแก้จริง) ---------- */
  const newQuestion = () => ({ q: '', choices: ['', '', '', ''], answer: 0, yes: 'ถูกต้อง! 🎉', no: 'ยังไม่ใช่น้า ลองใหม่' });
  function normQ(q) {
    q.q = str(q.q);
    q.choices = (Array.isArray(q.choices) ? q.choices : []).map(str);
    while (q.choices.length < 4) q.choices.push('');
    const a = parseInt(q.answer, 10);
    q.answer = a >= 0 && a < q.choices.length ? a : 0;
    q.yes = str(q.yes);
    q.no = str(q.no);
    if (typeof q.photo !== 'string' || !q.photo) delete q.photo;
    return q;
  }
  function normalize(c) {
    if (!isObj(c)) c = {};
    ['lock', 'quiz', 'memory', 'gallery', 'letter', 'ask', 'cake', 'music'].forEach((k) => { if (!isObj(c[k])) c[k] = {}; });
    c.photos = (Array.isArray(c.photos) ? c.photos : []).map((p) => {
      if (typeof p === 'string') return { src: p, date: '', caption: '' };
      if (!isObj(p)) return null;
      p.src = str(p.src);
      p.date = str(p.date);
      p.caption = str(p.caption);
      return p;
    }).filter(Boolean);
    const Q = c.quiz;
    Q.questions = (Array.isArray(Q.questions) ? Q.questions : []).filter(isObj).map(normQ);
    if (!Q.questions.length) Q.questions.push(newQuestion());
    Q.results = (Array.isArray(Q.results) ? Q.results : []).filter(isObj);
    Q.results.forEach((r) => { r.min = Math.max(0, parseInt(r.min, 10) || 0); r.stamp = str(r.stamp); r.text = str(r.text); });
    if (c.lock.passcode != null) c.lock.passcode = str(c.lock.passcode);
    c.lock.wrong = (Array.isArray(c.lock.wrong) ? c.lock.wrong : []).map(str);
    c.ask.no = (Array.isArray(c.ask.no) ? c.ask.no : []).map(str);
    const body = c.letter.body;
    c.letter.body = Array.isArray(body) ? body.map(str) : splitLines(str(body));
    if (!Array.isArray(c.intro)) c.intro = [];
    if (!Array.isArray(c.memory.photos)) c.memory.photos = [];
    if (c.music.src == null) c.music.src = '';
    return c;
  }

  /* ---------- สถานะของหน้า ---------- */
  const DEFAULTS = (window.CONFIG && typeof window.CONFIG === 'object') ? clone(window.CONFIG) : null;
  let cfg = {};
  let storageOk = true;
  let dirty = false, saveTimer = 0, lastSaved = null, hasOverride = false, staleOtherTab = false;
  let db = null, dbFailed = false, dbReady = null;
  let busyCount = 0;
  const inflight = new Set();   // id ของไฟล์ที่กำลังเขียน — ห้ามเก็บกวาดทิ้ง
  const urlCache = new Map();   // id → Promise<objectURL|null>
  const alerts = {};
  const photoSelects = new Set();

  /* =====================================================================
     บันทึกข้อความ (localStorage)
     ===================================================================== */
  function readStored() {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return { error: 'nostorage' }; }
    if (raw == null) return { data: null, raw: null };
    let data;
    try { data = JSON.parse(raw); } catch (e) { return { error: 'corrupt' }; }
    if (data === null) return { data: null, raw: null };
    if (!isObj(data)) return { error: 'corrupt' };
    return { data, raw };
  }
  function changed() {
    dirty = true;
    if (!storageOk) { setStatus('error', 'บันทึกไม่ได้ในเบราว์เซอร์นี้'); return; }
    setStatus('saving', 'กำลังบันทึก…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY);
  }
  // เก็บเฉพาะส่วนที่ต่างจากค่าเริ่มต้นใน config.js — ถ้าภายหลังแก้ค่าเริ่มต้นในไฟล์
  // เครื่องที่เคยบันทึกไว้จะได้ค่าใหม่ด้วย (ยกเว้นช่องที่แก้เองไว้ในหน้านี้)
  function diffFrom(base, cur) {
    if (isObj(cur) && isObj(base)) {
      const out = {};
      for (const k of Object.keys(cur)) {
        const d = diffFrom(base[k], cur[k]);
        if (d !== undefined) out[k] = d;
      }
      for (const k of Object.keys(base)) if (!(k in cur)) out[k] = null;
      return Object.keys(out).length ? out : undefined;
    }
    return JSON.stringify(base) === JSON.stringify(cur) ? undefined : clone(cur);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!dirty) return true;
    if (!storageOk) return false;
    let json;
    try {
      json = JSON.stringify(DEFAULTS ? (diffFrom(DEFAULTS, cfg) || {}) : cfg);
      localStorage.setItem(KEY, json);
    } catch (e) {
      console.error('บันทึกไม่ได้:', e);
      setStatus('error', isQuota(e) ? 'บันทึกไม่ได้: พื้นที่เต็ม' : 'บันทึกไม่ได้!');
      return false;
    }
    dirty = false;
    lastSaved = json;
    hasOverride = true;
    setStatus('saved', 'บันทึกแล้ว ✓');
    dropAlert('corrupt');
    gcMedia();
    return true;
  }
  function flushSave() { if (dirty) return saveNow(); return true; }

  /* =====================================================================
     ไฟล์รูป/เพลง (IndexedDB)
     ===================================================================== */
  function openDb() {
    return new Promise((resolve, reject) => {
      let idb = null;
      try { idb = window.indexedDB; } catch (e) { idb = null; }
      if (!idb || typeof idb.open !== 'function') { reject(new Error('ไม่มี IndexedDB')); return; }
      let done = false, req;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('เปิดฐานข้อมูลนานเกินไป')); } }, 8000);
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { clearTimeout(timer); reject(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const d = req.result;
        if (done) { d.close(); return; }
        done = true;
        clearTimeout(timer);
        if (!d.objectStoreNames.contains(STORE)) { d.close(); reject(new Error('ไม่มีที่เก็บ media')); return; }
        d.onversionchange = () => { d.close(); db = null; };
        resolve(d);
      };
      req.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(req.error || new Error('เปิดฐานข้อมูลไม่ได้'));
      };
    });
  }
  function tx(mode, fn) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('ไม่มีที่เก็บไฟล์')); return; }
      let t, req;
      try {
        t = db.transaction(STORE, mode);
        req = fn(t.objectStore(STORE));
      } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error || (req && req.error) || new Error('IndexedDB error'));
      t.onabort = () => reject(t.error || new Error('IndexedDB abort'));
    });
  }
  const idbPut = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
  const idbGet = (id) => tx('readonly', (s) => s.get(id));
  const idbKeys = () => tx('readonly', (s) => s.getAllKeys());
  const idbDelete = (ids) => tx('readwrite', (s) => { ids.forEach((id) => s.delete(id)); return null; });
  const idbClear = () => tx('readwrite', (s) => s.clear());

  async function hasDb(quiet) {
    const d = await dbReady;
    if (!d && !quiet) toast('เครื่องนี้เก็บรูปและเพลงไม่ได้ (ดูคำอธิบายด้านบน)', 'error');
    return !!d;
  }
  function mediaUrl(id) {
    let p = urlCache.get(id);
    if (!p) {
      p = dbReady
        .then((d) => (d ? idbGet(id) : null))
        .then((b) => (b instanceof Blob ? URL.createObjectURL(b) : null))
        .catch(() => null)
        .then((u) => { if (!u && urlCache.get(id) === p) urlCache.delete(id); return u; });
      urlCache.set(id, p);
    }
    return p;
  }
  function dropUrl(id) {
    const p = urlCache.get(id);
    if (!p) return;
    urlCache.delete(id);
    p.then((u) => { if (u) URL.revokeObjectURL(u); });
  }
  function resetUrlCache() { Array.from(urlCache.keys()).forEach(dropUrl); }

  // ลบไฟล์ที่ไม่มีใครอ้างถึงแล้ว (เรียกหลังบันทึกทุกครั้ง)
  let gcRunning = false, gcAgain = false;
  async function gcMedia() {
    if (!db || staleOtherTab) return;
    if (gcRunning) { gcAgain = true; return; }
    gcRunning = true;
    try {
      do {
        gcAgain = false;
        const keys = await idbKeys();
        const keep = collectRefs(cfg);
        if (lastSaved) { try { collectRefs(JSON.parse(lastSaved), keep); } catch (e) { /* ข้าม */ } }
        inflight.forEach((id) => keep.add(id));
        // เก็บกวาดเฉพาะไฟล์ที่หน้านี้สร้าง (คีย์ "m_…") ของอย่างอื่นในที่เก็บเดียวกันไม่ยุ่ง
        const stale = keys.filter((k) => typeof k === 'string' && k.startsWith('m_') && !keep.has(k));
        if (stale.length) {
          await idbDelete(stale);
          stale.forEach(dropUrl);
        }
      } while (gcAgain);
    } catch (e) {
      console.warn('เก็บกวาดไฟล์ไม่สำเร็จ:', e);
    } finally {
      gcRunning = false;
    }
  }

  /* ---------- ย่อรูป (หมุนตาม EXIF ให้เองเพราะวาดผ่าน <img>) ---------- */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  function makeCanvas(w, hgt) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    return c;
  }
  const freeCanvas = (c) => { c.width = 0; c.height = 0; }; // คืนหน่วยความจำเร็วขึ้นบน iPad
  async function processImage(file) {
    const { img, url } = await loadImage(file);
    try {
      const w = img.naturalWidth, hgt = img.naturalHeight;
      if (!w || !hgt) throw new Error('decode');
      const scale = Math.min(1, MAX_SIDE / Math.max(w, hgt));
      const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(hgt * scale));
      // ย่อทีละครึ่งก่อน ภาพจะได้ไม่แตก
      let src = img, sw = w, sh = hgt;
      while (sw > tw * 2) {
        const f = Math.min(0.5, 4096 / Math.max(sw, sh));
        const nw = Math.max(tw, Math.round(sw * f)), nh = Math.max(th, Math.round(sh * f));
        const c = makeCanvas(nw, nh);
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(src, 0, 0, nw, nh);
        if (src !== img) freeCanvas(src);
        src = c; sw = nw; sh = nh;
      }
      const out = makeCanvas(tw, th);
      const g = out.getContext('2d');
      g.fillStyle = '#FFFFFF';
      g.fillRect(0, 0, tw, th);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, tw, th);
      if (src !== img) freeCanvas(src);
      const blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', JPEG_QUALITY));
      freeCanvas(out);
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------- dataURL ↔ Blob (ไฟล์สำรอง) ---------- */
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result);
        const comma = s.indexOf(',');
        resolve('data:' + (blob.type || 'application/octet-stream') + ';base64,' + s.slice(comma + 1));
      };
      r.onerror = () => reject(r.error || new Error('read'));
      r.readAsDataURL(blob);
    });
  }
  function dataUrlToBlob(u) {
    const m = /^data:([^,]*?),/.exec(u);
    if (!m) throw new Error('ข้อมูลไฟล์ในไฟล์สำรองเสีย');
    const meta = m[1].split(';');
    const mime = meta[0] || 'application/octet-stream';
    const data = u.slice(m[0].length);
    if (meta.indexOf('base64') >= 0) {
      const bin = atob(data.replace(/\s/g, ''));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }
    return new Blob([decodeURIComponent(data)], { type: mime });
  }
  function readText(file) {
    if (file.text) return file.text();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  /* =====================================================================
     ส่วนแสดงผลทั่วไป: สถานะ / toast / กำลังทำงาน / แจ้งเตือน / หน้าต่างถาม
     ===================================================================== */
  function setStatus(kind, msg) {
    const el = $('#status');
    el.dataset.kind = kind;
    el.textContent = msg;
  }
  let toastT = 0;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6500 : 3800);
  }
  function busy(on, msg) {
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    if (on && msg) $('#busy-text').textContent = msg;
    $('#busy').hidden = busyCount === 0;
  }
  const busyMsg = (m) => { $('#busy-text').textContent = m; };
  function addAlert(key, kind, title, msg, actions) {
    dropAlert(key);
    const el = h('div', { class: 'alert ' + kind, role: kind === 'error' ? 'alert' : 'status' },
      h('span', { class: 'alert-ico', 'aria-hidden': 'true' }, kind === 'error' ? '⚠️' : '💡'),
      h('div', { class: 'alert-body' },
        h('strong', { class: 'alert-title' }, title),
        h('p', { class: 'alert-text' }, msg),
        actions && actions.length
          ? h('div', { class: 'alert-actions' }, actions.map(([label, fn]) => h('button', { class: 'btn small', type: 'button', onclick: fn }, label)))
          : null));
    alerts[key] = el;
    $('#alerts').append(el);
  }
  function dropAlert(key) {
    if (!alerts[key]) return;
    alerts[key].remove();
    delete alerts[key];
  }
  function modal(title, msg, buttons, onClose) {
    const prev = document.activeElement;
    const tid = uid('m');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
      if (prev && prev.focus) prev.focus({ preventScroll: true });
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const card = h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid },
      h('h2', { class: 'modal-title', id: tid }, title),
      [].concat(msg || []).filter(Boolean).map((m) => h('p', { class: 'modal-text' }, m)),
      h('div', { class: 'modal-actions' }, buttons(close)));
    const wrap = h('div', { class: 'modal' }, card);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    const first = card.querySelector('.modal-actions a, .modal-actions button');
    if (first) first.focus();
    return close;
  }

  // กล่องข้อความยืดตามเนื้อหา (กันต้องเลื่อนซ้อนในกล่องบน iPad)
  function grow(el) {
    if (!el.isConnected || !el.offsetWidth) return;
    const y = window.scrollY;
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + 6) + 'px'; // ขอบ 2+2 และเผื่อปัดเศษอีกนิด
    if (window.scrollY !== y) window.scrollTo(0, y);
  }
  const growAll = (root) => $$('textarea', root).forEach(grow);

  // กดปุ่มนี้แล้วช่องที่กำลังพิมพ์ไม่หลุดโฟกัส (คีย์บอร์ด iPad ไม่หุบ)
  function keepFocus(btn) {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    return btn;
  }

  /* ---------- รูปย่อ (ถ้าไม่มีไฟล์ โชว์กรอบสีพาสเทล + ชื่อไฟล์ เหมือนหน้าเว็บหลัก) ---------- */
  const missingUrls = new Set(); // ไฟล์ในเว็บที่โหลดไม่เจอแล้ว ไม่ต้องโหลดซ้ำทุกครั้งที่วาดใหม่
  function setPhoto(box, src, i, alt) {
    src = str(src);
    if (box.dataset.src === src && box.childElementCount) return;
    box.dataset.src = src;
    box.classList.remove('is-ph');
    box.replaceChildren();
    const k = Math.max(0, i);
    const ph = (label) => {
      if (box.dataset.src !== src) return;
      box.classList.add('is-ph');
      box.style.setProperty('--ph', PH_BG[k % PH_BG.length]);
      box.replaceChildren(
        h('span', { class: 'ph-emoji', 'aria-hidden': 'true' }, PH_EMOJI[k % PH_EMOJI.length]),
        h('span', { class: 'ph-file' }, label));
    };
    if (!src) { ph('ยังไม่มีรูป'); return; }
    const show = (url) => {
      if (box.dataset.src !== src) return;
      const img = h('img', { alt: alt || '', decoding: 'async', draggable: 'false' });
      img.addEventListener('error', () => {
        if (isIdbSrc(src)) { ph('เปิดรูปนี้ไม่ได้'); return; }
        missingUrls.add(src);
        ph(src);
      }, { once: true });
      img.src = url;
      box.replaceChildren(img);
    };
    if (isIdbSrc(src)) mediaUrl(idOf(src)).then((u) => (u ? show(u) : ph('หาไฟล์รูปไม่เจอ')));
    else if (missingUrls.has(src)) ph(src);
    else show(src);
  }

  /* =====================================================================
     ช่องกรอกแบบต่างๆ — b = { get, set } ผูกกับค่าในคอนฟิก
     ===================================================================== */
  const at = (path) => ({ get: () => getPath(cfg, path), set: (v) => setPath(cfg, path, v) });
  const on = (obj, key) => ({ get: () => obj[key], set: (v) => { obj[key] = v; } });
  // ช่องที่เว็บเลิกใช้แล้ว: โชว์เฉพาะเมื่อยังมีอยู่ใน config.js (หรือเคยบันทึกไว้)
  const ifHas = (path, make) => (getPath(cfg, path) !== undefined ? make() : null);
  const OPTIONAL = 'เว้นว่าง = ไม่แสดง';

  function field(label, control, o) {
    o = o || {};
    const target = o.target || control;
    if (!target.id) target.id = uid('f');
    const kids = [h('label', { class: 'lbl', for: target.id }, label), control];
    if (o.extra) kids.push(o.extra);
    if (o.hint) {
      const hid = target.id + '-hint';
      kids.push(h('p', { class: 'hint', id: hid }, o.hint));
      target.setAttribute('aria-describedby', hid);
    }
    return h('div', { class: 'field' + (o.fcls ? ' ' + o.fcls : '') }, kids);
  }

  function text(label, b, o) {
    o = o || {};
    const multi = !!o.rows;
    const el = multi ? h('textarea', { class: 'inp', rows: o.rows }) : h('input', { class: 'inp', type: 'text' });
    el.value = str(b.get());
    el.setAttribute('autocomplete', 'off');
    if (o.placeholder) el.placeholder = o.placeholder;
    if (o.cls) el.classList.add(o.cls);
    if (o.aria) el.setAttribute('aria-label', o.aria);
    if (o.tok !== false) el.dataset.tok = '1';
    el.addEventListener('input', () => {
      b.set(el.value);
      changed();
      if (multi) grow(el);
      if (o.after) o.after(el.value);
    });
    return field(label, el, o);
  }

  function lines(label, b, o) {
    o = o || {};
    const el = h('textarea', { class: 'inp', rows: o.rows || 4, autocomplete: 'off' });
    const cur = b.get();
    el.value = (Array.isArray(cur) ? cur : []).map(str).join('\n');
    el.dataset.tok = '1';
    el.addEventListener('input', () => { b.set(splitLines(el.value)); changed(); grow(el); });
    return field(label, el, o);
  }

  function num(label, b, o) {
    const el = h('input', { class: 'inp num', type: 'text', inputmode: o.int ? 'numeric' : 'decimal', autocomplete: 'off', enterkeyhint: 'done' });
    el.value = b.get() == null ? '' : String(b.get());
    const err = h('p', { class: 'err', 'aria-live': 'polite' });
    const parse = () => {
      const s = toAscii(el.value).trim().replace(',', '.');
      const re = o.int ? /^\d+$/ : /^(\d+(\.\d*)?|\.\d+)$/;
      return re.test(s) ? Number(s) : NaN;
    };
    const check = (show) => {
      const v = parse();
      const ok = Number.isFinite(v) && v >= o.min && v <= o.max;
      if (ok) {
        if (v !== b.get()) { b.set(v); changed(); }
        err.textContent = '';
        el.removeAttribute('aria-invalid');
      } else if (show) {
        const cur = b.get();
        err.textContent = `ใส่ตัวเลข ${o.min}–${o.max}` + (cur != null && cur !== '' ? ` (ตอนนี้ยังใช้ค่าเดิม ${cur})` : '');
        el.setAttribute('aria-invalid', 'true');
      }
      return ok;
    };
    el.addEventListener('input', () => check(!!err.textContent));
    el.addEventListener('blur', () => check(true));
    return field(label, o.wrap ? o.wrap(el) : el, { target: el, hint: o.hint, extra: err, fcls: o.fcls });
  }

  function stepper(label, b, o) {
    return num(label, b, Object.assign({}, o, {
      int: true,
      wrap: (el) => {
        const step = (d) => {
          const cur = parseInt(toAscii(el.value), 10);
          el.value = String(Math.min(o.max, Math.max(o.min, (Number.isFinite(cur) ? cur : o.min) + d)));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        return h('div', { class: 'stepper' },
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'ลดลง 1', onclick: () => step(-1) }, '−'),
          el,
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'เพิ่มขึ้น 1', onclick: () => step(1) }, '+'));
      }
    }));
  }

  function range(label, b, o) {
    const el = h('input', { type: 'range', class: 'range', min: o.min, max: o.max, step: o.step });
    const cur = Number(b.get());
    el.value = String(b.get() != null && Number.isFinite(cur) ? Math.min(o.max, Math.max(o.min, cur)) : o.def);
    const out = h('output', { class: 'range-out', 'aria-hidden': 'true' }, o.fmt(Number(el.value)));
    el.setAttribute('aria-valuetext', o.fmt(Number(el.value)));
    el.addEventListener('input', () => {
      const v = Math.round(Number(el.value) * 100) / 100;
      b.set(v);
      changed();
      out.textContent = o.fmt(v);
      el.setAttribute('aria-valuetext', o.fmt(v));
      if (o.after) o.after(v);
    });
    const row = h('div', { class: 'range-row' },
      o.left ? h('span', { class: 'range-end', 'aria-hidden': 'true' }, o.left) : null,
      el,
      o.right ? h('span', { class: 'range-end', 'aria-hidden': 'true' }, o.right) : null,
      out);
    return field(label, row, { target: el, hint: o.hint });
  }

  function toggle(label, b, o) {
    const input = h('input', { type: 'checkbox', class: 'sw-input', role: 'switch' });
    input.checked = b.get() !== false;
    const state = h('p', { class: 'hint' });
    const paint = () => { state.textContent = input.checked ? o.onText : o.offText; };
    input.addEventListener('change', () => {
      b.set(input.checked);
      changed();
      paint();
      if (o.after) o.after(input.checked);
    });
    paint();
    return h('div', { class: 'field' },
      h('label', { class: 'switch' }, input,
        h('span', { class: 'sw-track', 'aria-hidden': 'true' }, h('span', { class: 'sw-knob' })),
        h('span', {}, label)),
      state);
  }

  function more(title, ...kids) {
    const d = h('details', { class: 'more' }, h('summary', {}, title), h('div', { class: 'more-body' }, kids));
    d.addEventListener('toggle', () => { if (d.open) growAll(d); });
    return d;
  }

  function section(id, icon, tone, title, sub, peeks, ...kids) {
    const tid = 'sec-' + id + '-title';
    const head = h('div', { class: 'card-head' },
      h('div', { class: 'card-ico', style: `--tone:var(--${tone})`, 'aria-hidden': 'true' }, icon),
      h('div', { class: 'card-titles' },
        h('h2', { class: 'card-title', id: tid }, title),
        sub ? h('p', { class: 'card-sub' }, sub) : null),
      peeks && peeks.length
        ? h('div', { class: 'peeks' }, peeks.map(([scene, lbl]) => h('a', {
          class: 'peek', href: 'index.html?scene=' + scene, 'data-nav': '',
          title: 'เปิดหน้าเว็บที่ด่านนี้ (ในแท็บเดิม)'
        }, lbl || 'ดูด่านนี้', h('span', { 'aria-hidden': 'true' }, ' →'))))
        : null);
    return h('section', { class: 'card', id: 'sec-' + id, 'aria-labelledby': tid }, head, kids);
  }

  /* =====================================================================
     หัวข้อต่างๆ (เรียงตามลำดับในเว็บโดยประมาณ)
     ===================================================================== */
  function secGeneral() {
    return section('general', '🎀', 'peach', 'ข้อมูลทั่วไป', 'ชื่อที่ใช้ทั้งเว็บ', null,
      h('div', { class: 'grid-2' },
        text('ชื่อเล่นแฟน', at('name'), { tok: false, hint: 'ใช้แทน {name} ในทุกข้อความ' }),
        text('ชื่อเรา', at('from'), { tok: false, hint: 'ใช้แทน {from} เช่น ลงชื่อท้ายจดหมาย' })),
      text('ชื่อบนแท็บเบราว์เซอร์', at('siteTitle')),
      h('p', { class: 'tip' }, 'เคล็ดลับ: พิมพ์ ', h('code', {}, '{name}'), ' หรือ ', h('code', {}, '{from}'),
        ' ไว้ในข้อความไหนก็ได้ เว็บจะเปลี่ยนเป็นชื่อให้เอง ระหว่างพิมพ์จะมีปุ่มลัดให้แตะใส่ที่แถบด้านบน'));
  }

  function secCamera() {
    const body = h('div', { class: 'stack' + (getPath(cfg, 'camera.enabled') === false ? ' is-off' : '') },
      text('หัวข้อ', at('camera.title')),
      text('คำอธิบาย', at('camera.subtitle'), { rows: 2, hint: OPTIONAL }),
      num('ต้องค้างท่าหัวใจกี่วินาที', at('camera.holdSeconds'), { min: 0.2, max: 5, hint: 'ยิ่งมากยิ่งยาก (ปกติ 0.8)' }),
      more('ข้อความอื่นๆ ในด่านนี้',
        h('div', { class: 'grid-2' },
          text('ปุ่มเปิดกล้อง', at('camera.startButton')),
          text('ตอนกำลังเปิดกล้อง', at('camera.loading')),
          ifHas('camera.wipeHint', () => text('บอกให้โบกมือเช็ดฝ้า', at('camera.wipeHint'))),
          ifHas('camera.heartHint', () => text('บอกให้ทำมือรูปหัวใจ', at('camera.heartHint'))),
          ifHas('camera.holding', () => text('ตอนกำลังค้างท่า', at('camera.holding'))),
          text('ตอนผ่านด่าน', at('camera.success')),
          text('คำบนรูปที่ถ่ายไว้', at('camera.snapshotCaption')),
          text('ปุ่มไปต่อ', at('camera.next'))),
        num('ฝ้ากลับมาเต็มภายในกี่วินาทีหลังเช็ด', at('camera.fogReturnSeconds'), { min: 0, max: 120, hint: '0 = เช็ดแล้วหายเลย ฝ้าไม่กลับมา' })));
    const sw = toggle('เปิดใช้ด่านกล้อง', at('camera.enabled'), {
      onText: 'เปิดอยู่: เว็บจะเริ่มที่ด่านเช็ดกระจกฝ้าก่อน',
      offText: 'ปิดอยู่: เว็บจะข้ามไปหน้ารหัสเลย',
      after: (v) => body.classList.toggle('is-off', !v)
    });
    return section('camera', '📷', 'sky', 'ด่านกล้อง', 'ด่านแรกสุด: โบกมือเช็ดกระจกฝ้า แล้วทำมือเป็นรูปหัวใจ', [['camera']], sw, body);
  }

  function secLock() {
    const pc = h('input', {
      class: 'inp passcode', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6',
      autocomplete: 'off', enterkeyhint: 'done'
    });
    pc.value = str(getPath(cfg, 'lock.passcode'));
    const err = h('p', { class: 'err', 'aria-live': 'polite' });
    pc.addEventListener('input', () => {
      const v = toAscii(pc.value).replace(/\D/g, '').slice(0, 6);
      if (v !== pc.value) pc.value = v;
      if (v.length >= 4) {
        if (v !== getPath(cfg, 'lock.passcode')) { setPath(cfg, 'lock.passcode', v); changed(); }
        err.textContent = '';
        pc.removeAttribute('aria-invalid');
      } else {
        const cur = str(getPath(cfg, 'lock.passcode'));
        err.textContent = `รหัสต้องเป็นตัวเลข 4–6 หลัก (พิมพ์ไว้ ${v.length} หลัก)` + (cur ? ` เว็บจะยังใช้รหัสเดิม ${cur} จนกว่าจะใส่ครบ` : '');
        pc.setAttribute('aria-invalid', 'true');
      }
    });
    return section('lock', '🔒', 'lilac', 'รหัสหน้าแรก', 'ต้องกดรหัสให้ถูกถึงจะเปิดกล่องของขวัญได้', [['lock']],
      field('รหัส (ตัวเลข 4–6 หลัก)', pc, { extra: err, hint: 'เช่น วันที่ + เดือนที่เป็นแฟนกัน: 20 พ.ค. → 2005' }),
      h('div', { class: 'grid-2' },
        text('หัวข้อ', at('lock.title')),
        text('ข้อความใต้หัวข้อ', at('lock.subtitle'))),
      h('div', { class: 'grid-2' },
        text('คำใบ้', at('lock.hint'), { rows: 2 }),
        text('คำใบ้เพิ่ม', at('lock.hint2'), { rows: 2, hint: 'โผล่ตอนกด 💡 หรือใส่ผิดครบ 3 ครั้ง' })),
      lines('ข้อความตอนใส่ผิด (บรรทัดละ 1 ข้อความ)', at('lock.wrong'), { rows: 4, hint: 'ใส่ผิดครั้งแรกขึ้นบรรทัดแรก ครั้งต่อไปขึ้นบรรทัดถัดไป วนไปเรื่อยๆ' }),
      text('ข้อความตอนใส่ถูก', at('lock.correct')));
  }

  /* ---------- เปิดเรื่อง: บรรทัดที่ขึ้นต้นด้วย 💬 = ฉากพิมพ์แชท ---------- */
  function introToText(arr) {
    return (Array.isArray(arr) ? arr : []).map((x) => {
      if (isObj(x)) return x.chat != null ? '💬 ' + str(x.chat) : str(x.text);
      return str(x);
    }).join('\n');
  }
  function textToIntro(v) {
    return splitLines(v).map((line) => {
      if (/^💬/u.test(line)) {
        const chat = line.replace(/^💬\s*/u, '').trim();
        return chat ? { chat } : null;
      }
      return line;
    }).filter(Boolean);
  }
  function toggleChatLine(ta) {
    const v = ta.value;
    let pos = ta.selectionStart;
    if (pos == null) pos = v.length;
    const start = pos > 0 ? v.lastIndexOf('\n', pos - 1) + 1 : 0;
    let end = v.indexOf('\n', pos);
    if (end < 0) end = v.length;
    const line = v.slice(start, end);
    const next = /^\s*💬/u.test(line) ? line.replace(/^\s*💬\s*/u, '') : '💬 ' + line.replace(/^\s+/, '');
    ta.focus({ preventScroll: true });
    ta.setRangeText(next, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function secIntro() {
    const ta = h('textarea', { class: 'inp', rows: 8, autocomplete: 'off' });
    ta.dataset.tok = '1';
    ta.value = introToText(cfg.intro);
    const count = h('span', { class: 'hint' });
    const paint = () => {
      const n = cfg.intro.length, chats = cfg.intro.filter(isObj).length;
      count.textContent = `ขึ้นทั้งหมด ${n} ข้อความ` + (chats ? ` (ฉากแชท ${chats})` : '');
    };
    ta.addEventListener('input', () => { cfg.intro = textToIntro(ta.value); changed(); grow(ta); paint(); });
    paint();
    const chatBtn = keepFocus(h('button', { class: 'btn small', type: 'button', onclick: () => toggleChatLine(ta) }, '💬 สลับบรรทัดนี้เป็นฉากแชท'));
    return section('intro', '💬', 'butter', 'ข้อความเปิดเรื่อง', 'ข้อความที่ขึ้นทีละบรรทัดก่อนเริ่มเล่น', [['intro']],
      field('ข้อความ (บรรทัดละ 1 ข้อความ)', ta, {
        extra: h('div', { class: 'row' }, chatBtn, count),
        hint: 'บรรทัดที่ขึ้นต้นด้วย 💬 จะเป็นฉากพิมพ์แชทแล้วลบทิ้ง (วางเคอร์เซอร์ที่บรรทัดนั้นแล้วกดปุ่มด้านบน) · บรรทัดสุดท้ายจะค้างไว้พร้อมปุ่ม'
      }),
      text('ปุ่มตอนจบ', at('introButton')));
  }

  /* ---------- รูปภาพ ---------- */
  let photosGrid = null, photosCount = null, photosWarn = null;
  const memUsesFirst = () => !(Array.isArray(cfg.memory.photos) && cfg.memory.photos.length);
  function secPhotos() {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.value = '';
      if (files.length) addPhotos(files);
    });
    const addBtn = h('button', { class: 'btn berry big', type: 'button', 'data-needs-db': '', disabled: dbFailed, onclick: () => input.click() }, '＋ เพิ่มรูป');
    photosCount = h('span', { class: 'count', 'aria-live': 'polite' });
    photosWarn = h('div', { class: 'warn-line', hidden: true });
    photosGrid = h('div', { class: 'photos' });
    renderPhotos();
    return section('photos', '🖼️', 'mint', 'รูปภาพ', 'ใช้ในเกมจับคู่ แกลเลอรีโพลารอยด์ และควิซ', [['memory', 'ดูเกมจับคู่'], ['gallery', 'ดูแกลเลอรี']],
      h('div', { class: 'row add-row' }, addBtn, input,
        h('p', { class: 'hint' }, 'เลือกได้ทีละหลายรูป แนะนำ 6–12 รูป · เว็บย่อรูปให้เอง · วันที่กับเรื่องราวจะโชว์ตอนพลิกรูปในแกลเลอรี'),
        photosCount),
      photosWarn,
      photosGrid,
      more('ข้อความในเกมจับคู่และแกลเลอรี',
        h('div', { class: 'grid-2' },
          text('หัวข้อเกมจับคู่', at('memory.title')),
          text('ตอนจับคู่ครบ', at('memory.done'))),
        text('คำแนะนำเกมจับคู่', at('memory.hint'), { rows: 2, hint: OPTIONAL }),
        h('div', { class: 'grid-2' },
          text('หัวข้อแกลเลอรี', at('gallery.title')),
          text('คำแนะนำแกลเลอรี', at('gallery.hint'), { hint: OPTIONAL }))));
  }
  function renderPhotos() {
    if (!photosGrid) return;
    const ps = cfg.photos, mem = memUsesFirst();
    photosGrid.replaceChildren(...ps.map((p, i) => photoCard(p, i, ps.length, mem)));
    if (!ps.length) photosGrid.append(h('div', { class: 'empty' }, 'ยังไม่มีรูปเลย กด “เพิ่มรูป” แล้วเลือกจากคลังรูปได้เลย'));
    photosCount.textContent = `มี ${ps.length} รูป`;
    photosWarn.replaceChildren();
    if (!mem) {
      photosWarn.append('ตอนนี้เกมจับคู่ใช้รูปชุดที่ตั้งแยกไว้ในไฟล์ config.js ',
        h('button', { class: 'btn small', type: 'button', onclick: () => { cfg.memory.photos = []; changed(); renderPhotos(); } }, 'ให้ใช้ 6 รูปแรกแทน'));
    } else if (ps.length < 6) {
      photosWarn.append(`เกมจับคู่ใช้ 6 รูปแรก ตอนนี้มี ${ps.length} รูป ช่องที่ขาดจะเป็นกรอบสีแทน`);
    }
    photosWarn.hidden = !photosWarn.childNodes.length;
    refreshPhotoSelects();
    requestAnimationFrame(() => growAll(photosGrid));
  }
  function photoCard(p, i, n, mem) {
    const thumb = h('div', { class: 'thumb' });
    setPhoto(thumb, p.src, i, `รูปที่ ${i + 1}`);
    const replaceInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
    replaceInput.addEventListener('change', () => {
      const f = replaceInput.files && replaceInput.files[0];
      replaceInput.value = '';
      if (f) replacePhoto(p, f);
    });
    return h('div', { class: 'pcard' },
      h('div', { class: 'thumb-wrap' }, thumb,
        h('span', { class: 'badge-n', 'aria-hidden': 'true' }, String(i + 1)),
        mem && i < 6 ? h('span', { class: 'badge-mem' }, 'ใช้ในเกมจับคู่') : null),
      text('วันที่', on(p, 'date'), { tok: false, placeholder: 'เช่น 20 พ.ค. 2567', aria: `วันที่ของรูปที่ ${i + 1}` }),
      text('เรื่องราวหลังรูป', on(p, 'caption'), { rows: 2, after: refreshPhotoSelectsSoon, aria: `เรื่องราวหลังรูปที่ ${i + 1}` }),
      h('div', { class: 'pactions' },
        h('button', { class: 'btn icon', type: 'button', 'data-act': 'up', 'aria-label': `เลื่อนรูปที่ ${i + 1} ไปก่อนหน้า`, title: 'เลื่อนไปก่อนหน้า', disabled: i === 0, onclick: () => movePhoto(i, -1) }, '↑'),
        h('button', { class: 'btn icon', type: 'button', 'data-act': 'down', 'aria-label': `เลื่อนรูปที่ ${i + 1} ไปถัดไป`, title: 'เลื่อนไปถัดไป', disabled: i === n - 1, onclick: () => movePhoto(i, 1) }, '↓'),
        h('button', { class: 'btn small push', type: 'button', 'data-needs-db': '', disabled: dbFailed, onclick: () => replaceInput.click() }, 'เปลี่ยนรูป'),
        replaceInput,
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': `ลบรูปที่ ${i + 1}`, onclick: () => deletePhoto(i) }, 'ลบ')));
  }
  function movePhoto(i, d) {
    const ps = cfg.photos, j = i + d;
    if (j < 0 || j >= ps.length) return;
    [ps[i], ps[j]] = [ps[j], ps[i]];
    changed();
    renderPhotos();
    const card = photosGrid.children[j];
    if (!card) return;
    let btn = card.querySelector(d < 0 ? '[data-act="up"]' : '[data-act="down"]');
    if (!btn || btn.disabled) btn = card.querySelector(d < 0 ? '[data-act="down"]' : '[data-act="up"]');
    if (btn) btn.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function quizUsing(src) {
    return cfg.quiz.questions.map((q, k) => (q.photo === src ? k + 1 : 0)).filter(Boolean);
  }
  function deletePhoto(i) {
    const p = cfg.photos[i];
    if (!p) return;
    const lastCopy = cfg.photos.filter((x) => x.src === p.src).length === 1;
    const used = lastCopy ? quizUsing(p.src) : [];
    const ask = `ลบรูปที่ ${i + 1} ใช่ไหม?` + (used.length ? `\n\nรูปนี้ใช้ในควิซข้อ ${used.join(', ')} ด้วย จะเอาออกจากควิซให้` : '');
    if (!window.confirm(ask)) return;
    cfg.photos.splice(i, 1);
    if (used.length) cfg.quiz.questions.forEach((q) => { if (q.photo === p.src) delete q.photo; });
    changed();
    renderPhotos();
    toast(used.length ? `ลบรูปแล้ว และเอาออกจากควิซข้อ ${used.join(', ')}` : 'ลบรูปแล้ว');
    const card = photosGrid.children[Math.min(i, cfg.photos.length - 1)];
    const btn = card && card.querySelector('.danger');
    if (btn) btn.focus({ preventScroll: true });
  }
  async function storeImage(file) {
    const blob = await processImage(file);
    const id = newId();
    inflight.add(id);
    try { await idbPut(id, blob); } catch (e) { inflight.delete(id); throw e; }
    return id; // ต้องเรียก inflight.delete(id) หลังใส่ลงคอนฟิกแล้ว
  }
  async function addPhotos(files) {
    if (!(await hasDb())) return;
    const added = [], failed = [];
    let full = false;
    busy(true, `กำลังเพิ่มรูป 1/${files.length}…`);
    try {
      for (let k = 0; k < files.length; k++) {
        busyMsg(`กำลังเพิ่มรูป ${k + 1}/${files.length}…`);
        try {
          const id = await storeImage(files[k]);
          cfg.photos.push({ src: IDB + id, date: '', caption: '' });
          inflight.delete(id);
          added.push(id);
        } catch (e) {
          console.warn('เพิ่มรูปไม่ได้:', files[k] && files[k].name, e);
          if (isQuota(e)) { full = true; break; }
          failed.push((files[k] && files[k].name) || `รูปที่ ${k + 1}`);
        }
      }
    } finally {
      busy(false);
    }
    if (added.length) {
      changed();
      saveNow();
      renderPhotos();
      const first = photosGrid.children[cfg.photos.length - added.length];
      if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    let msg = added.length ? `เพิ่มรูปแล้ว ${added.length} รูป` : 'ยังไม่ได้เพิ่มรูป';
    if (failed.length) msg += ` · เปิดไม่ได้ ${failed.length} รูป (${short(failed.join(', '), 60)}) ลองใช้ไฟล์ .jpg หรือ .png`;
    if (full) msg += ' · พื้นที่ในเครื่องเต็มแล้ว';
    toast(msg, failed.length || full || !added.length ? 'error' : 'ok');
  }
  async function replacePhoto(p, file) {
    if (!(await hasDb())) return;
    busy(true, 'กำลังเปลี่ยนรูป…');
    let ok = false;
    try {
      const id = await storeImage(file);
      const old = p.src;
      p.src = IDB + id;
      inflight.delete(id);
      // ควิซที่ใช้รูปเดิม ให้ชี้มารูปใหม่ (ถ้าไม่มีรูปอื่นใช้ไฟล์เดิมแล้ว)
      if (!cfg.photos.some((x) => x !== p && x.src === old)) cfg.quiz.questions.forEach((q) => { if (q.photo === old) q.photo = p.src; });
      ok = true;
    } catch (e) {
      console.warn('เปลี่ยนรูปไม่ได้:', e);
      toast(isQuota(e) ? 'เปลี่ยนรูปไม่ได้: พื้นที่ในเครื่องเต็ม' : 'เปิดรูปนี้ไม่ได้ ลองใช้ไฟล์ .jpg หรือ .png', 'error');
    } finally {
      busy(false);
    }
    if (!ok) return;
    changed();
    saveNow();
    renderPhotos();
    toast('เปลี่ยนรูปแล้ว', 'ok');
  }

  /* ---------- ควิซ ---------- */
  let quizList = null, tiersBox = null, tierWarn = null;
  function secQuiz() {
    quizList = h('div', { class: 'qlist' });
    tiersBox = h('div', { class: 'tiers' });
    renderQuiz();
    renderTiers();
    return section('quiz', '📝', 'peach', 'ควิซ', '“รู้จักเค้าแค่ไหน?” ตอบถูกมีรูปและข้อความ ตอบผิดโดนแซว', [['quiz']],
      text('หัวข้อควิซ', at('quiz.title')),
      quizList,
      h('div', { class: 'row' }, h('button', { class: 'btn mint', type: 'button', onclick: addQuestion }, '＋ เพิ่มคำถาม')),
      h('h3', { class: 'sub-title' }, 'ผลคะแนนตอนจบ'),
      h('p', { class: 'hint' }, 'นับเฉพาะข้อที่ตอบถูกตั้งแต่ครั้งแรก แล้วเว็บจะเลือกระดับที่สูงที่สุดที่ทำได้'),
      tiersBox);
  }
  function renderQuiz() {
    if (!quizList) return;
    const qs = cfg.quiz.questions;
    photoSelects.clear(); // การ์ดคำถามสร้างใหม่หมด แต่ละใบจะลงทะเบียนช่องเลือกรูปของตัวเองอีกครั้ง
    quizList.replaceChildren(...qs.map((q, i) => questionCard(q, i, qs.length)));
    paintTierWarn();
    requestAnimationFrame(() => growAll(quizList));
  }
  function questionCard(q, i, n) {
    const group = uid('ans');
    const warn = h('p', { class: 'warn-line', hidden: true });
    const paintWarn = () => {
      const msgs = [];
      if (!q.q.trim()) msgs.push('ยังไม่ได้ใส่คำถาม');
      const empty = q.choices.map((c, ci) => (str(c).trim() ? '' : (MARKS[ci] || String(ci + 1)))).filter(Boolean);
      if (empty.length) msgs.push(`ตัวเลือก ${empty.join(', ')} ยังว่าง (ในเว็บจะเป็นปุ่มเปล่า)`);
      warn.hidden = !msgs.length;
      warn.textContent = msgs.length ? '⚠️ ' + msgs.join(' · ') : '';
    };
    const rows = q.choices.map((c, ci) => {
      const mark = MARKS[ci] || String(ci + 1);
      const inp = h('input', { class: 'inp', type: 'text', autocomplete: 'off', 'aria-label': `ตัวเลือก ${mark} ของข้อ ${i + 1}` });
      inp.dataset.tok = '1';
      inp.value = str(c);
      inp.addEventListener('input', () => { q.choices[ci] = inp.value; changed(); paintWarn(); });
      const radio = h('input', { type: 'radio', name: group, value: String(ci), checked: q.answer === ci, 'aria-label': `ตัวเลือก ${mark} เป็นข้อถูก` });
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        q.answer = ci;
        changed();
        paintRight();
      });
      return h('div', { class: `choice c${ci % 4}` },
        h('span', { class: 'mark', 'aria-hidden': 'true' }, mark),
        inp,
        h('label', { class: 'pick' }, radio, h('span', {}, 'ข้อถูก')));
    });
    const paintRight = () => rows.forEach((r, ci) => r.classList.toggle('is-right', q.answer === ci));
    paintRight();
    paintWarn();

    const sel = h('select', { class: 'inp select', 'aria-label': `รูปที่โผล่ตอนตอบถูกข้อ ${i + 1}` });
    const prev = h('div', { class: 'thumb mini', 'aria-hidden': 'true' });
    const entry = { sel, q, prev };
    photoSelects.add(entry);
    fillPhotoSelect(entry);
    sel.addEventListener('change', () => {
      if (sel.value) q.photo = sel.value; else delete q.photo;
      changed();
      paintPreview(entry);
    });
    const choicesId = uid('cl');
    return h('div', { class: 'qcard' },
      h('div', { class: 'qhead' },
        h('h3', { class: 'qnum' }, `ข้อ ${i + 1}`),
        h('button', { class: 'btn icon', type: 'button', 'data-act': 'up', 'aria-label': `เลื่อนข้อ ${i + 1} ขึ้น`, title: 'เลื่อนขึ้น', disabled: i === 0, onclick: () => moveQuestion(i, -1) }, '↑'),
        h('button', { class: 'btn icon', type: 'button', 'data-act': 'down', 'aria-label': `เลื่อนข้อ ${i + 1} ลง`, title: 'เลื่อนลง', disabled: i === n - 1, onclick: () => moveQuestion(i, 1) }, '↓'),
        h('button', { class: 'btn small danger', type: 'button', 'data-act': 'del', disabled: n <= 1, title: n <= 1 ? 'ต้องมีอย่างน้อย 1 ข้อ' : null, onclick: () => deleteQuestion(i) }, 'ลบข้อนี้')),
      text('คำถาม', { get: () => q.q, set: (v) => { q.q = v; paintWarn(); } }, { rows: 2, aria: `คำถามข้อ ${i + 1}` }),
      h('div', { class: 'field' },
        h('p', { class: 'lbl', id: choicesId }, 'ตัวเลือก (แตะ “ข้อถูก” ที่คำตอบที่ถูก)'),
        h('div', { class: 'choices', role: 'group', 'aria-labelledby': choicesId }, rows),
        warn),
      h('div', { class: 'grid-2' },
        text('ตอบถูกแล้วขึ้นว่า', on(q, 'yes'), { rows: 2, aria: `ข้อ ${i + 1} ตอบถูกแล้วขึ้นว่า` }),
        text('ตอบผิดแล้วขึ้นว่า', on(q, 'no'), { rows: 2, aria: `ข้อ ${i + 1} ตอบผิดแล้วขึ้นว่า` })),
      field('รูปที่โผล่ตอนตอบถูก', h('div', { class: 'photo-pick' }, prev, sel), { target: sel }));
  }
  function photoLabel(p, i) {
    const cap = short(p.caption, 26);
    return `รูปที่ ${i + 1}` + (cap ? ` · ${cap}` : '');
  }
  function fillPhotoSelect(entry) {
    const { sel, q } = entry;
    const opts = [h('option', { value: '' }, 'ไม่มีรูป (ขึ้นเป็น 🎉 แทน)')];
    cfg.photos.forEach((p, i) => { if (p.src) opts.push(h('option', { value: p.src }, photoLabel(p, i))); });
    if (q.photo && !cfg.photos.some((p) => p.src === q.photo)) {
      opts.push(h('option', { value: q.photo }, 'รูปอื่น: ' + short(isIdbSrc(q.photo) ? 'ไฟล์ที่อัปโหลด' : q.photo, 30)));
    }
    sel.replaceChildren(...opts);
    sel.value = q.photo || '';
    paintPreview(entry);
  }
  function paintPreview({ prev, q }) {
    if (q.photo) {
      const idx = cfg.photos.findIndex((p) => p.src === q.photo);
      setPhoto(prev, q.photo, idx >= 0 ? idx : 0, '');
      return;
    }
    // ไม่มีรูป: ในเว็บจะขึ้น 🎉 แทน
    prev.dataset.src = '';
    prev.classList.add('is-ph');
    prev.style.setProperty('--ph', '#FFF1C9');
    prev.replaceChildren(h('span', { class: 'ph-emoji' }, '🎉'));
  }
  function refreshPhotoSelects() {
    for (const e of Array.from(photoSelects)) {
      if (!quizList || !quizList.contains(e.sel)) { photoSelects.delete(e); continue; }
      fillPhotoSelect(e);
    }
  }
  let selT = 0;
  function refreshPhotoSelectsSoon() { clearTimeout(selT); selT = setTimeout(refreshPhotoSelects, 300); }

  function moveQuestion(i, d) {
    const qs = cfg.quiz.questions, j = i + d;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    changed();
    renderQuiz();
    const card = quizList.children[j];
    if (!card) return;
    let btn = card.querySelector(d < 0 ? '[data-act="up"]' : '[data-act="down"]');
    if (!btn || btn.disabled) btn = card.querySelector(d < 0 ? '[data-act="down"]' : '[data-act="up"]');
    if (btn) btn.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function deleteQuestion(i) {
    const qs = cfg.quiz.questions;
    if (qs.length <= 1) { toast('ต้องมีคำถามอย่างน้อย 1 ข้อ', 'error'); return; }
    if (!window.confirm(`ลบคำถามข้อ ${i + 1} ใช่ไหม?`)) return;
    qs.splice(i, 1);
    changed();
    renderQuiz();
    toast('ลบคำถามแล้ว');
  }
  function addQuestion() {
    cfg.quiz.questions.push(newQuestion());
    changed();
    renderQuiz();
    const card = quizList.lastElementChild;
    const first = card && card.querySelector('textarea, input');
    if (first) first.focus({ preventScroll: true });
    if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function renderTiers() {
    if (!tiersBox) return;
    tierWarn = h('p', { class: 'warn-line', hidden: true });
    const rows = cfg.quiz.results.map((r) => {
      const seal = h('div', { class: 'stamp-mini', 'aria-hidden': 'true' }, r.stamp || '…');
      return h('div', { class: 'tier' },
        seal,
        num('ถูกอย่างน้อยกี่ข้อ', { get: () => r.min, set: (v) => { r.min = v; paintTierWarn(); } }, { min: 0, max: 99, int: true, fcls: 'f-min' }),
        text('คำบนตราปั๊ม', on(r, 'stamp'), { fcls: 'f-stamp', after: (v) => { seal.textContent = v || '…'; } }),
        text('ข้อความใต้ตรา', on(r, 'text'), { fcls: 'f-text' }));
    });
    if (!rows.length) rows.push(h('p', { class: 'hint' }, 'ยังไม่มีระดับคะแนน ตอนจบเว็บจะขึ้นว่า “เก่งมาก” ให้เอง'));
    tiersBox.replaceChildren(...rows, tierWarn);
    paintTierWarn();
  }
  function paintTierWarn() {
    if (!tierWarn) return;
    const n = cfg.quiz.questions.length, rs = cfg.quiz.results, msgs = [];
    if (rs.length && !rs.some((r) => Number(r.min) === 0)) msgs.push('ควรมีอย่างน้อย 1 ระดับที่ตั้งเป็น 0 ข้อ ไม่งั้นคนที่ตอบถูกน้อยจะไม่ได้ข้อความ');
    rs.forEach((r) => { if (Number(r.min) > n) msgs.push(`ระดับ “${r.stamp || '…'}” ตั้งไว้ ${r.min} ข้อ แต่ควิซมีแค่ ${n} ข้อ เลยไม่มีใครได้ระดับนี้`); });
    tierWarn.hidden = !msgs.length;
    tierWarn.textContent = msgs.length ? '⚠️ ' + msgs.join(' · ') : '';
  }

  /* ---------- จดหมาย ---------- */
  function secLetter() {
    const ta = h('textarea', { class: 'inp', rows: 10, autocomplete: 'off' });
    ta.dataset.tok = '1';
    ta.value = cfg.letter.body.map(str).join('\n\n');
    const count = h('p', { class: 'hint' });
    const paint = () => { count.textContent = `ตอนนี้มี ${cfg.letter.body.length} ย่อหน้า`; };
    ta.addEventListener('input', () => { cfg.letter.body = splitParas(ta.value); changed(); grow(ta); paint(); });
    paint();
    return section('letter', '💌', 'sky', 'จดหมาย', 'แตะตราหัวใจแล้วตัวหนังสือจะพิมพ์ขึ้นทีละตัว', [['letter']],
      text('คำขึ้นต้น', at('letter.greeting')),
      field('เนื้อความ', ta, { extra: count, hint: 'เว้นบรรทัดว่าง 1 บรรทัด = ขึ้นย่อหน้าใหม่' }),
      h('div', { class: 'grid-2' },
        text('คำลงท้าย', at('letter.signoff')),
        text('ลงชื่อ', at('letter.signature'), { hint: 'ใส่ {from} = ชื่อเรา' })),
      more('ข้อความอื่นๆ ในด่านนี้',
        h('div', { class: 'grid-2' },
          text('คำบอกให้แตะเปิดซอง', at('letter.sealHint'), { hint: OPTIONAL }),
          text('ปุ่มตอนอ่านจบ', at('letter.done')))));
  }

  /* ---------- คำถามสำคัญ ---------- */
  function secAsk() {
    return section('ask', '💗', 'lilac', 'คำถามสำคัญ', 'ปุ่ม “ไม่” จะวิ่งหนี ส่วนปุ่ม “ได้” จะใหญ่ขึ้นเรื่อยๆ', [['ask']],
      h('div', { class: 'grid-emoji' },
        text('อีโมจิ', at('ask.emoji'), { tok: false, cls: 'emoji-inp' }),
        text('คำถาม', at('ask.question'))),
      h('div', { class: 'grid-2' },
        text('ปุ่มตอบตกลง', at('ask.yes')),
        text('ข้อความหลังตอบตกลง', at('ask.after'))),
      lines('ปุ่ม “ไม่” (บรรทัดละ 1 คำ)', at('ask.no'), { rows: 5, hint: 'ทุกครั้งที่จะกด ปุ่มจะหนีแล้วเปลี่ยนเป็นคำถัดไป ครบทุกคำแล้วปุ่มจะหายไป' }),
      more('ข้อความอื่นๆ ในด่านนี้',
        h('div', { class: 'grid-emoji' },
          text('อีโมจิหลังตอบ', at('ask.afterEmoji'), { tok: false, cls: 'emoji-inp' }),
          text('ปุ่มไปต่อ', at('ask.next'))),
        text('ข้อความตอนปุ่ม “ไม่” หายไป', at('ask.gone'))));
  }

  /* ---------- เค้ก ---------- */
  function secCake() {
    return section('cake', '🎂', 'butter', 'เค้กวันเกิด', 'เป่าเทียนผ่านไมค์ แล้วกระดาษสีโปรยลงมา', [['cake']],
      h('div', { class: 'grid-2' },
        stepper('จำนวนเทียน (1–9)', at('cake.candles'), { min: 1, max: 9 }),
        text('ข้อความบนเค้ก', at('cake.nameOnCake'), { hint: 'ปกติใส่ {name}' })),
      text('คำอวยพรตอนจบ', at('cake.wish'), { rows: 3, hint: 'กด Enter เพื่อขึ้นบรรทัดใหม่ได้' }),
      ifHas('cake.finalImage', finalImageField),
      range('ความไวไมค์', at('cake.sensitivity'), {
        min: 0.5, max: 2, step: 0.1, def: 1, fmt: (v) => v.toFixed(1), left: 'ดับยาก', right: 'ดับง่าย',
        hint: 'เป่าไม่ดับ → เพิ่ม / พูดแล้วดับ → ลด'
      }),
      more('ข้อความอื่นๆ ในด่านนี้',
        h('div', { class: 'grid-2' },
          text('หัวข้อ', at('cake.title')),
          text('ปุ่มเปิดไมค์', at('cake.micButton')),
          text('ตอนไมค์เปิดแล้ว', at('cake.listening'), { hint: OPTIONAL }),
          text('บอกให้แตะเปลวเทียน', at('cake.tapHint'), { hint: OPTIONAL }),
          text('ตอนเปิดไมค์ไม่ได้', at('cake.micFailed')),
          text('ตัวหนังสือใหญ่ตอนจบ', at('cake.headline')),
          ifHas('cake.replay', () => text('ปุ่มดูอีกรอบ', at('cake.replay'))))));
  }

  /* ---------- ภาพปิดท้าย (cake.finalImage) โผล่หลังเป่าเทียน ---------- */
  let finalBox = null;
  function finalImageField() {
    finalBox = h('div', { class: 'final-pick' });
    renderFinal();
    return h('div', { class: 'field' },
      h('p', { class: 'lbl' }, 'ภาพปิดท้าย (โผล่หลังเป่าเทียน)'),
      finalBox,
      ifHas('cake.finalDelay', () => num('ภาพโผล่หลังพลุกี่วินาที', at('cake.finalDelay'), { min: 0, max: 60 })));
  }
  function renderFinal() {
    if (!finalBox) return;
    const src = str(getPath(cfg, 'cake.finalImage'));
    const thumb = h('div', { class: 'thumb final-thumb' });
    if (src) setPhoto(thumb, src, 3, 'ภาพปิดท้าย');
    else {
      thumb.classList.add('is-ph');
      thumb.style.setProperty('--ph', '#F6E8EE');
      thumb.append(h('span', { class: 'ph-file' }, 'ไม่มีภาพปิดท้าย'));
    }
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (f) setFinalImage(f);
    });
    finalBox.replaceChildren(thumb, h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', 'data-needs-db': '', disabled: dbFailed, onclick: () => input.click() }, src ? 'เปลี่ยนรูป' : 'เลือกรูป'),
      src ? h('button', { class: 'btn small danger', type: 'button', onclick: clearFinalImage }, 'ไม่ใช้ภาพปิดท้าย') : null,
      input));
  }
  async function setFinalImage(file) {
    if (!(await hasDb())) return;
    busy(true, 'กำลังบันทึกรูป…');
    let ok = false;
    try {
      const id = await storeImage(file);
      setPath(cfg, 'cake.finalImage', IDB + id);
      inflight.delete(id);
      ok = true;
    } catch (e) {
      console.warn('เปลี่ยนภาพปิดท้ายไม่ได้:', e);
      toast(isQuota(e) ? 'บันทึกรูปไม่ได้: พื้นที่ในเครื่องเต็ม' : 'เปิดรูปนี้ไม่ได้ ลองใช้ไฟล์ .jpg หรือ .png', 'error');
    } finally {
      busy(false);
    }
    if (!ok) return;
    changed();
    saveNow();
    renderFinal();
    toast('เปลี่ยนภาพปิดท้ายแล้ว', 'ok');
  }
  function clearFinalImage() {
    if (!window.confirm('ไม่ใช้ภาพปิดท้ายแล้วใช่ไหม?')) return;
    setPath(cfg, 'cake.finalImage', '');
    changed();
    saveNow();
    renderFinal();
    toast('เอาภาพปิดท้ายออกแล้ว');
  }

  /* ---------- เพลง ---------- */
  let musicBox = null;
  function secMusic() {
    musicBox = h('div', { class: 'music' });
    renderMusic();
    return section('music', '🎵', 'mint', 'เพลงพื้นหลัง', 'เริ่มเล่นตอนใส่รหัสถูก มีปุ่มเปิด/ปิดเพลงที่มุมขวาบน', null,
      musicBox,
      range('ความดังเพลง', at('music.volume'), {
        min: 0, max: 1, step: 0.05, def: 0.5, fmt: (v) => Math.round(v * 100) + '%',
        after: (v) => { const a = musicBox.querySelector('audio'); if (a) { try { a.volume = v; } catch (e) { /* iPad ปรับไม่ได้ */ } } }
      }));
  }
  function renderMusic() {
    if (!musicBox) return;
    const src = str(getPath(cfg, 'music.src'));
    const input = h('input', { type: 'file', accept: 'audio/*', hidden: true });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (f) uploadMusic(f);
    });
    const info = h('p', { class: 'music-info' });
    let audio = null;
    if (!src) {
      info.textContent = 'ยังไม่มีเพลง (ปุ่มเพลงในเว็บจะซ่อนไว้)';
    } else {
      audio = h('audio', { class: 'audio', controls: true, preload: 'metadata' });
      const vol = Number(getPath(cfg, 'music.volume'));
      try { audio.volume = Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.5; } catch (e) { /* ข้าม */ }
      if (isIdbSrc(src)) {
        const id = idOf(src);
        info.textContent = 'เพลงที่อัปโหลดไว้';
        dbReady.then((d) => (d ? idbGet(id) : null)).then((b) => {
          if (b instanceof Blob) info.textContent = `เพลงที่อัปโหลดไว้ · ${fmtBytes(b.size)}`;
        }).catch(() => {});
        mediaUrl(id).then((u) => {
          if (!audio.isConnected) return;
          if (u) audio.src = u;
          else { info.textContent = 'หาไฟล์เพลงไม่เจอ ลองอัปโหลดใหม่อีกครั้ง'; audio.hidden = true; }
        });
      } else {
        info.textContent = `ใช้ไฟล์ในเว็บ: ${src}`;
        audio.addEventListener('error', () => {
          info.textContent = `ยังไม่มีไฟล์ ${src} ในเว็บ อัปโหลดเพลงจากเครื่องนี้ได้เลย`;
          audio.hidden = true;
        }, { once: true });
        audio.src = src;
      }
    }
    musicBox.replaceChildren(
      info,
      audio || '',
      h('div', { class: 'row' },
        h('button', { class: 'btn berry', type: 'button', 'data-needs-db': '', disabled: dbFailed, onclick: () => input.click() },
          isIdbSrc(src) ? '🎵 เปลี่ยนเพลง' : '🎵 อัปโหลดเพลง'),
        src ? h('button', { class: 'btn danger', type: 'button', onclick: removeMusic }, 'ลบเพลง') : null,
        input),
      h('p', { class: 'hint' }, 'ใช้ไฟล์ .mp3 หรือ .m4a ขนาดไม่เกินประมาณ 10 MB จะโหลดเร็ว และไฟล์สำรองไม่ใหญ่เกินไป'));
  }
  function guessAudioType(name) {
    const ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1];
    return ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm' })[String(ext).toLowerCase()] || '';
  }
  async function uploadMusic(file) {
    const type = (file.type && /^audio\//.test(file.type)) ? file.type : guessAudioType(file.name);
    if (!type) { toast('ไฟล์นี้ไม่ใช่ไฟล์เพลง ลองใช้ .mp3 หรือ .m4a', 'error'); return; }
    if (!(await hasDb())) return;
    busy(true, 'กำลังบันทึกเพลง…');
    let blob = null;
    try {
      const buf = await file.arrayBuffer();
      blob = new Blob([buf], { type });
      const id = newId();
      inflight.add(id);
      try {
        await idbPut(id, blob);
        setPath(cfg, 'music.src', IDB + id);
      } finally {
        inflight.delete(id);
      }
    } catch (e) {
      console.warn('บันทึกเพลงไม่ได้:', e);
      toast('บันทึกเพลงไม่ได้: ' + errText(e), 'error');
      blob = null;
    } finally {
      busy(false);
    }
    if (!blob) return;
    changed();
    saveNow();
    renderMusic();
    toast(`อัปโหลดเพลงแล้ว (${fmtBytes(blob.size)})` + (blob.size > 15 * 1048576 ? ' · ไฟล์ค่อนข้างใหญ่ ไฟล์สำรองจะใหญ่ตาม' : ''), 'ok');
  }
  function removeMusic() {
    if (!window.confirm('ลบเพลงพื้นหลังใช่ไหม? (ปุ่มเพลงในเว็บจะซ่อนไว้)')) return;
    setPath(cfg, 'music.src', '');
    changed();
    saveNow();
    renderMusic();
    toast('ลบเพลงแล้ว');
  }

  /* =====================================================================
     วาดทั้งหน้า
     ===================================================================== */
  function render() {
    photoSelects.clear();
    photosGrid = quizList = tiersBox = tierWarn = musicBox = finalBox = null;
    $('#sections').replaceChildren(
      secGeneral(), secCamera(), secLock(), secIntro(), secPhotos(),
      secQuiz(), secLetter(), secAsk(), secCake(), secMusic());
    requestAnimationFrame(() => growAll($('#sections')));
  }

  /* =====================================================================
     สำรอง / นำเข้า / ล้าง
     ===================================================================== */
  const two = (n) => String(n).padStart(2, '0');
  function backupName() {
    const d = new Date();
    return `for-you-backup-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.json`;
  }
  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toISOString(); }
  }
  async function doBackup() {
    if (busyCount) return;
    flushSave();
    busy(true, 'กำลังเตรียมไฟล์สำรอง…');
    let out = null;
    try {
      const ids = Array.from(collectRefs(cfg));
      const media = {};
      let missing = 0;
      const d = await dbReady;
      for (let k = 0; k < ids.length; k++) {
        busyMsg(`กำลังเตรียมไฟล์สำรอง ${k + 1}/${ids.length}…`);
        const b = d ? await idbGet(ids[k]).catch(() => null) : null;
        if (b instanceof Blob) media[ids[k]] = await blobToDataUrl(b);
        else missing++;
      }
      const data = { format: BACKUP_FORMAT, version: BACKUP_VERSION, savedAt: new Date().toISOString(), config: clone(cfg), media };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      out = { blob, name: backupName(), files: Object.keys(media).length, missing };
    } catch (e) {
      console.error('สำรองข้อมูลไม่ได้:', e);
      toast('สร้างไฟล์สำรองไม่สำเร็จ: ' + errText(e), 'error');
    } finally {
      busy(false);
    }
    if (out) deliverBackup(out);
  }
  function deliverBackup({ blob, name, files, missing }) {
    const url = URL.createObjectURL(blob);
    const summary = `${name} · ${fmtBytes(blob.size)}` + (files ? ` · มีรูป/เพลง ${files} ไฟล์` : '') +
      (missing ? ` · หาไฟล์ไม่เจอ ${missing} ไฟล์` : '');
    const touch = (navigator.maxTouchPoints || 0) > 1;
    if (!touch) {
      // คอม: ดาวน์โหลดเลย
      const a = h('a', { href: url, download: name, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast('ดาวน์โหลดไฟล์สำรองแล้ว: ' + summary, missing ? 'error' : 'ok');
      return;
    }
    // iPad/มือถือ: ให้แตะเองอีกที (Safari ต้องการการแตะตรงๆ ถึงจะแชร์/ดาวน์โหลดได้)
    let file = null;
    try { file = new File([blob], name, { type: 'application/json' }); } catch (e) { file = null; }
    let canShare = false;
    try { canShare = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canShare = false; }
    modal('ไฟล์สำรองพร้อมแล้ว 💾', [summary, canShare ? 'แนะนำให้กด “บันทึกลงแอปไฟล์ / ส่งต่อ” แล้วเลือกบันทึกไปยังแอปไฟล์ หรือส่งให้ตัวเองทางแชท' : ''], (close) => [
      canShare ? h('button', {
        class: 'btn berry', type: 'button',
        onclick: async () => {
          try {
            await navigator.share({ files: [file], title: name });
            close();
            toast('ส่งไฟล์สำรองแล้ว', 'ok');
          } catch (e) {
            if (!e || e.name !== 'AbortError') toast('ส่งไฟล์ไม่สำเร็จ ลองกด “ดาวน์โหลดไฟล์” แทน', 'error');
          }
        }
      }, 'บันทึกลงแอปไฟล์ / ส่งต่อ') : null,
      h('a', { class: 'btn' + (canShare ? '' : ' berry'), href: url, download: name }, 'ดาวน์โหลดไฟล์'),
      h('button', { class: 'btn', type: 'button', onclick: close }, 'ปิด')
    ], () => setTimeout(() => URL.revokeObjectURL(url), 60000));
  }

  async function doImport(file) {
    let data = null;
    try { data = JSON.parse(await readText(file)); } catch (e) { data = null; }
    if (!isObj(data) || data.format !== BACKUP_FORMAT || !isObj(data.config)) {
      toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของเว็บนี้ (ต้องเป็นไฟล์ for-you-backup-….json)', 'error');
      return;
    }
    if (Number(data.version) > BACKUP_VERSION) {
      toast('ไฟล์สำรองนี้มาจากหน้าหลังบ้านรุ่นใหม่กว่า ลองรีเฟรชหน้านี้แล้วนำเข้าอีกครั้ง', 'error');
      return;
    }
    const entries = Object.entries(isObj(data.media) ? data.media : {})
      .filter(([id, v]) => id && typeof v === 'string' && v.startsWith('data:'));
    const when = data.savedAt ? fmtWhen(data.savedAt) : '';
    const ask = 'นำเข้าไฟล์สำรองนี้ใช่ไหม?\n' + (when ? `บันทึกเมื่อ ${when} · ` : '') + `มีรูป/เพลง ${entries.length} ไฟล์` +
      '\n\nข้อความ รูป และเพลงที่ตั้งไว้ในเครื่องนี้ตอนนี้ จะถูกแทนที่ด้วยของในไฟล์';
    if (!window.confirm(ask)) return;
    if (entries.length && !(await hasDb(true))) {
      toast('เครื่องนี้เก็บรูปและเพลงไม่ได้ เลยนำเข้าไฟล์นี้ไม่ได้', 'error');
      return;
    }
    flushSave(); // ถ้านำเข้าไม่สำเร็จ การแก้ล่าสุดจะยังอยู่
    busy(true, 'กำลังนำเข้า…');
    let ok = false;
    try {
      entries.forEach(([id]) => inflight.add(id));
      for (let k = 0; k < entries.length; k++) {
        busyMsg(`กำลังนำเข้าไฟล์ ${k + 1}/${entries.length}…`);
        const [id, u] = entries[k];
        await idbPut(id, dataUrlToBlob(u));
      }
      resetUrlCache();
      cfg = normalize(deepMerge(DEFAULTS || {}, data.config));
      dirty = true;
      ok = saveNow();
      render();
    } catch (e) {
      console.error('นำเข้าไม่สำเร็จ:', e);
      toast('นำเข้าไม่สำเร็จ: ' + errText(e), 'error');
      return;
    } finally {
      entries.forEach(([id]) => inflight.delete(id));
      busy(false);
    }
    const missing = Array.from(collectRefs(cfg)).filter((id) => !entries.some(([k]) => k === id)).length;
    if (!ok) toast('นำเข้าแล้ว แต่บันทึกลงเครื่องไม่สำเร็จ', 'error');
    else toast('นำเข้าเรียบร้อย ✓' + (missing ? ` (ไฟล์สำรองไม่มีรูป/เพลงอีก ${missing} ไฟล์)` : ''), missing ? 'error' : 'ok');
  }

  async function doReset() {
    if (busyCount) return;
    const ask = 'ล้างทุกอย่างที่ตั้งไว้ในเครื่องนี้ (ข้อความ รูป และเพลง) แล้วกลับไปใช้ค่าเริ่มต้นใช่ไหม?\n\nลบแล้วกู้คืนไม่ได้ ถ้ายังไม่ได้กด “สำรองข้อมูล” แนะนำให้กดก่อน';
    if (!window.confirm(ask)) return;
    busy(true, 'กำลังล้างข้อมูล…');
    try {
      if (await dbReady) await idbClear(); // ล้างไฟล์ก่อน ถ้าพังจะได้ยังไม่แตะข้อความ
      clearTimeout(saveTimer);
      saveTimer = 0;
      dirty = false;
      try { localStorage.removeItem(KEY); } catch (e) { /* ข้าม */ }
      resetUrlCache();
      lastSaved = null;
      hasOverride = false;
      dropAlert('corrupt');
      cfg = normalize(clone(DEFAULTS || {}));
      render();
      setStatus('idle', 'ใช้ค่าเริ่มต้นอยู่');
      toast('ล้างข้อมูลแล้ว กลับไปใช้ค่าเริ่มต้น', 'ok');
    } catch (e) {
      console.error('ล้างข้อมูลไม่สำเร็จ:', e);
      toast('ล้างข้อมูลไม่สำเร็จ: ' + errText(e), 'error');
    } finally {
      busy(false);
    }
  }

  /* =====================================================================
     ปุ่มลัด {name} / {from} ระหว่างพิมพ์
     ===================================================================== */
  function initTokenBar() {
    const bar = $('#tokenbar');
    if (!bar) return;
    let fieldEl = null, sel = null, hideT = 0;
    const isTok = (el) => !!(el && el.dataset && el.dataset.tok);
    document.addEventListener('focusin', (e) => {
      if (isTok(e.target)) { fieldEl = e.target; clearTimeout(hideT); bar.hidden = false; }
      else if (!bar.contains(e.target)) bar.hidden = true;
    });
    document.addEventListener('focusout', (e) => {
      if (e.target !== fieldEl) return;
      try { sel = [fieldEl.selectionStart, fieldEl.selectionEnd]; } catch (err) { sel = null; }
      clearTimeout(hideT);
      hideT = setTimeout(() => { if (!isTok(document.activeElement)) bar.hidden = true; }, 400);
    });
    $$('[data-token]', bar).forEach((b) => {
      keepFocus(b);
      b.addEventListener('click', () => {
        if (!fieldEl || !fieldEl.isConnected) return;
        const tok = b.dataset.token;
        const active = document.activeElement === fieldEl;
        let s = active ? fieldEl.selectionStart : (sel ? sel[0] : null);
        let en = active ? fieldEl.selectionEnd : (sel ? sel[1] : null);
        if (s == null || en == null) { s = en = fieldEl.value.length; }
        fieldEl.focus({ preventScroll: true });
        fieldEl.setRangeText(tok, s, en, 'end');
        fieldEl.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  /* =====================================================================
     เริ่มต้น
     ===================================================================== */
  function init() {
    if (!DEFAULTS) {
      addAlert('noconfig', 'error', 'อ่านไฟล์ config.js ไม่ได้', 'ค่าเริ่มต้นของเว็บหายไป ลองรีเฟรชหน้านี้อีกครั้ง ถ้ายังไม่ได้ ไฟล์ config.js อาจพิมพ์ผิด');
    }
    const st = readStored();
    if (st.error === 'nostorage') {
      storageOk = false;
      addAlert('nostorage', 'error', 'เบราว์เซอร์นี้ไม่ยอมให้บันทึกข้อมูล', 'อาจเปิดโหมดส่วนตัว (Private) อยู่ ลองเปิดแบบปกติ ตอนนี้แก้ได้แต่จะไม่ถูกบันทึก');
    } else if (st.error === 'corrupt') {
      addAlert('corrupt', 'warn', 'ข้อมูลที่บันทึกไว้ในเครื่องนี้อ่านไม่ได้', 'เลยเปิดค่าเริ่มต้นให้ก่อน ถ้ามีไฟล์สำรองไว้ กด “นำเข้า” เพื่อกู้คืนได้ (ถ้าแก้อะไรในหน้านี้ ข้อมูลเดิมที่เสียจะถูกเขียนทับ)');
    }
    hasOverride = !!st.data;
    lastSaved = st.raw || null;
    cfg = normalize(st.data ? deepMerge(DEFAULTS || {}, st.data) : clone(DEFAULTS || {}));
    if (!storageOk) setStatus('error', 'บันทึกไม่ได้ในเบราว์เซอร์นี้');
    else setStatus(hasOverride ? 'saved' : 'idle', hasOverride ? 'บันทึกแล้ว ✓' : 'ใช้ค่าเริ่มต้นอยู่');

    dbReady = openDb().then((d) => { db = d; return d; }, (e) => {
      console.warn('IndexedDB ใช้ไม่ได้:', e);
      db = null;
      dbFailed = true;
      $$('[data-needs-db]').forEach((b) => { b.disabled = true; });
      addAlert('nodb', 'error', 'เครื่องนี้เก็บรูปและเพลงไม่ได้',
        'เบราว์เซอร์ไม่ยอมให้ใช้ที่เก็บไฟล์ (อาจเปิดโหมดส่วนตัวอยู่) เพิ่มรูปและเพลงจะใช้ไม่ได้ แต่ยังแก้ข้อความได้ตามปกติ ลองเปิดหน้านี้ใน Safari หรือ Chrome แบบปกติ');
      return null;
    });

    render();
    initTokenBar();

    const importInput = h('input', { type: 'file', accept: 'application/json,.json,text/plain', hidden: true });
    importInput.addEventListener('change', () => {
      const f = importInput.files && importInput.files[0];
      importInput.value = '';
      if (f) doImport(f);
    });
    document.body.append(importInput);
    $('#btn-backup').addEventListener('click', doBackup);
    $('#btn-import').addEventListener('click', () => { if (!busyCount) importInput.click(); });
    $('#btn-reset').addEventListener('click', doReset);

    // ลิงก์ไปหน้าเว็บ: บันทึกให้เสร็จก่อน แล้วเปิดในแท็บเดิม (แอปบนหน้าจอโฮมของ iPad เก็บข้อมูลแยกจาก Safari)
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[data-nav]') : null;
      if (!a) return;
      const saved = flushSave();
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (busyCount) { toast('รอให้ทำงานเสร็จก่อนนะ'); return; }
      if (!saved && !window.confirm('ยังบันทึกการแก้ไขล่าสุดไม่สำเร็จ ออกจากหน้านี้เลยไหม?')) return;
      window.location.href = a.href;
    });
    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

    // มีอีกแท็บแก้ข้อมูลอยู่ → เตือน และหยุดเก็บกวาดไฟล์ (กันลบรูปที่อีกแท็บเพิ่งเพิ่ม)
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY && e.key !== null) return;
      staleOtherTab = true;
      addAlert('stale', 'warn', 'มีการแก้ข้อมูลจากอีกหน้าต่าง', 'ข้อมูลในหน้านี้อาจไม่ใช่ล่าสุด โหลดหน้าใหม่ก่อนแก้ต่อ จะได้ไม่เขียนทับกัน',
        [['โหลดหน้าใหม่', () => { dirty = false; clearTimeout(saveTimer); window.location.reload(); }]]);
    });

    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => growAll($('#sections')), 200); });
    // ฟอนต์ Mali โหลดเสร็จแล้วตัวหนังสือกว้างขึ้น → วัดความสูงกล่องข้อความใหม่
    const fonts = document.fonts;
    if (fonts) {
      const regrow = () => growAll($('#sections'));
      if (fonts.ready) fonts.ready.then(regrow);
      if (fonts.load) Promise.all([fonts.load('400 18px Mali'), fonts.load('600 18px Mali')]).then(regrow, () => {});
      if (fonts.addEventListener) fonts.addEventListener('loadingdone', regrow);
    }

    // ขอให้เบราว์เซอร์อย่าล้างข้อมูลของหน้านี้เอง (ไม่ได้ก็ไม่เป็นไร)
    try {
      const p = navigator.storage && navigator.storage.persist && navigator.storage.persist();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ข้าม */ }
  }

  init();
})();
