import init, { HwpDocument } from './lib/rhwp.js';

const VERSION = 'v1.000';

const $ = (id) => document.getElementById(id);
const els = {
  home: $('home'), viewer: $('viewer'), pages: $('pages'),
  title: $('title'), pageInd: $('page-ind'),
  btnHome: $('btn-home'), btnOpen: $('btn-open'), btnOpenTop: $('btn-open-top'),
  btnZoomIn: $('btn-zoom-in'), btnZoomOut: $('btn-zoom-out'),
  fileInput: $('file-input'), overlay: $('overlay'), overlayMsg: $('overlay-msg'),
  recentWrap: $('recent-wrap'), recent: $('recent'),
  pwDialog: $('pw-dialog'), pwInput: $('pw-input'), pwErr: $('pw-err'),
  toast: $('toast'), ver: $('ver'),
};
els.ver.textContent = `한글 뷰어 ${VERSION} · 렌더링 엔진 rhwp (MIT)`;

// ---------- 엔진 준비 ----------

// rhwp는 한컴 글꼴의 내장 글자 폭으로 배치하고 글자마다 위치를 박아 그린다.
// 그래서 폰에 한컴 글꼴이 없어도 줄바꿈·표 크기는 원본과 같고, 모양만 대체 글꼴
// (나눔명조·Noto Sans KR 등, index.html에서 불러옴)로 바뀐다.
// 아래 측정 함수는 내장 폭이 없는 글꼴을 만났을 때를 위한 예비용.
let measureCtx = null;
let lastFont = '';
globalThis.measureTextWidth = (font, text) => {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (font !== lastFont) { measureCtx.font = font; lastFont = font; }
  return measureCtx.measureText(text).width;
};

let enginePromise = null;
function engineReady() {
  if (!enginePromise) {
    enginePromise = init({ module_or_path: new URL('./lib/rhwp_bg.wasm', import.meta.url) })
      .catch((e) => { enginePromise = null; throw e; }); // 네트워크가 끊겼으면 다음에 다시 시도
  }
  return enginePromise;
}
engineReady().catch(() => {});

// ---------- 상태 ----------

const state = {
  doc: null,
  name: '',
  pageSizes: [],   // [{w, h}] 문서 단위(px @ 96dpi)
  zoom: 1,         // 1 = 화면 폭에 맞춤
  rendered: new Map(),
};

// ---------- 화면 전환 ----------

function showHome() {
  closeDoc();
  els.home.hidden = false;
  els.viewer.hidden = true;
  els.btnHome.hidden = true;
  els.pageInd.hidden = true;
  els.btnZoomIn.hidden = els.btnZoomOut.hidden = true;
  els.title.textContent = '한글 뷰어';
  document.title = '한글 뷰어';
  renderRecent();
}

function showViewer() {
  els.home.hidden = true;
  els.viewer.hidden = false;
  els.btnHome.hidden = false;
  els.pageInd.hidden = false;
  els.btnZoomIn.hidden = els.btnZoomOut.hidden = false;
  if (!(history.state && history.state.viewer)) history.pushState({ viewer: true }, '');
}

function setBusy(msg) {
  if (msg) { els.overlayMsg.textContent = msg; els.overlay.hidden = false; }
  else els.overlay.hidden = true;
}

let toastTimer = 0;
function toast(msg, ms = 3500) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}

// ---------- 문서 열기 ----------

function errText(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  return e.message || String(e);
}

function isPasswordError(msg) {
  return /암호|비밀번호|password|encrypt/i.test(msg);
}

function askPassword(wrong) {
  return new Promise((resolve) => {
    els.pwInput.value = '';
    els.pwErr.hidden = !wrong;
    els.pwDialog.returnValue = '';
    els.pwDialog.showModal();
    els.pwInput.focus();
    els.pwDialog.addEventListener('close', () => {
      resolve(els.pwDialog.returnValue === 'ok' ? els.pwInput.value : null);
    }, { once: true });
  });
}

async function parseDocument(bytes) {
  try {
    return new HwpDocument(bytes);
  } catch (e) {
    const msg = errText(e);
    if (!isPasswordError(msg)) throw e;
    let wrong = false;
    for (;;) {
      const pw = await askPassword(wrong);
      if (pw === null) return null;
      try {
        return HwpDocument.openWithPassword(bytes, pw);
      } catch (e2) {
        if (!isPasswordError(errText(e2))) throw e2;
        wrong = true;
      }
    }
  }
}

function readPageSize(doc, i) {
  try {
    const info = JSON.parse(doc.getPageInfo(i));
    const w = info.width ?? info.pageWidth ?? info.w;
    const h = info.height ?? info.pageHeight ?? info.h;
    if (w > 0 && h > 0) return { w, h };
  } catch { /* 아래 기본값 사용 */ }
  return { w: 794, h: 1123 }; // A4
}

async function openBytes(bytes, name, { remember = true } = {}) {
  setBusy('문서를 여는 중…');
  try {
    await engineReady();
    const doc = await parseDocument(bytes);
    if (!doc) { setBusy(null); return; }

    closeDoc();
    state.doc = doc;
    state.name = name;
    const n = doc.pageCount();
    state.pageSizes = Array.from({ length: n }, (_, i) => readPageSize(doc, i));
    state.zoom = 1;

    els.title.textContent = name;
    document.title = name;
    showViewer();
    buildPages();
    els.viewer.scrollTo(0, 0);
    updatePageInd();
    if (remember) saveRecent(name, bytes).catch(() => {});
  } catch (e) {
    console.error(e);
    toast(`이 문서를 열 수 없어요.\n${errText(e).slice(0, 120)}`, 6000);
  } finally {
    setBusy(null);
  }
}

async function openFile(file) {
  if (!file) return;
  if (!/\.(hwpx?|hwt)$/i.test(file.name)) {
    toast('HWP 또는 HWPX 파일만 열 수 있어요.');
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await openBytes(bytes, file.name);
}

function closeDoc() {
  observer.disconnect();
  state.rendered.clear();
  els.pages.innerHTML = '';
  if (state.doc) { try { state.doc.free(); } catch { /* 이미 해제됨 */ } }
  state.doc = null;
  renderQueue.length = 0;
}

// ---------- 페이지 배치와 지연 렌더링 ----------

function fitScale() {
  const vw = els.viewer.clientWidth;
  const maxW = Math.max(...state.pageSizes.map((s) => s.w));
  const target = Math.min(vw - 12, 900);
  return target / maxW;
}

function layoutPages() {
  const s = fitScale() * state.zoom;
  const kids = els.pages.children;
  let maxW = 0;
  for (let i = 0; i < kids.length; i++) {
    const { w, h } = state.pageSizes[i];
    kids[i].style.width = `${Math.round(w * s)}px`;
    kids[i].style.height = `${Math.round(h * s)}px`;
    maxW = Math.max(maxW, w * s);
  }
  els.pages.style.width = `${Math.max(Math.round(maxW) + 12, els.viewer.clientWidth)}px`;
}

function buildPages() {
  const frag = document.createDocumentFragment();
  state.pageSizes.forEach((_, i) => {
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.i = i;
    div.innerHTML = `<div class="ph">${i + 1}쪽</div>`;
    frag.appendChild(div);
  });
  els.pages.appendChild(frag);
  layoutPages();
  for (const div of els.pages.children) observer.observe(div);
}

const renderQueue = [];
let renderScheduled = false;

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  setTimeout(() => {
    renderScheduled = false;
    const div = renderQueue.shift();
    if (!div) return;
    renderPage(div);
    if (renderQueue.length) scheduleRender();
  }, 0);
}

function renderPage(div) {
  const i = Number(div.dataset.i);
  if (!state.doc || state.rendered.has(i) || !div.isConnected) return;
  try {
    const svg = state.doc.renderPageSvg(i);
    div.innerHTML = svg;
    const el = div.querySelector('svg');
    if (el) {
      if (!el.getAttribute('viewBox')) {
        const w = parseFloat(el.getAttribute('width')) || state.pageSizes[i].w;
        const h = parseFloat(el.getAttribute('height')) || state.pageSizes[i].h;
        el.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      el.removeAttribute('width');
      el.removeAttribute('height');
      el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
    state.rendered.set(i, true);
  } catch (e) {
    console.error(e);
    div.innerHTML = `<div class="perr">${i + 1}쪽을 그리지 못했어요.</div>`;
  }
}

function unrenderPage(div) {
  const i = Number(div.dataset.i);
  if (!state.rendered.has(i)) return;
  state.rendered.delete(i);
  div.innerHTML = `<div class="ph">${i + 1}쪽</div>`;
}

const observer = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const div = en.target;
    if (en.isIntersecting) {
      if (!renderQueue.includes(div)) renderQueue.push(div);
    } else {
      const qi = renderQueue.indexOf(div);
      if (qi >= 0) renderQueue.splice(qi, 1);
      // 메모리 절약: 멀리 벗어난 페이지는 비운다
      if (state.rendered.size > 8) unrenderPage(div);
    }
  }
  scheduleRender();
}, { root: els.viewer, rootMargin: '150% 0px' });

function currentPage() {
  const mid = els.viewer.scrollTop + els.viewer.clientHeight / 3;
  const kids = els.pages.children;
  let lo = 0, hi = kids.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (kids[m].offsetTop <= mid) lo = m; else hi = m - 1;
  }
  return lo;
}

function updatePageInd() {
  const n = state.pageSizes.length;
  els.pageInd.textContent = n ? `${currentPage() + 1} / ${n}` : '';
}
els.viewer.addEventListener('scroll', () => requestAnimationFrame(updatePageInd), { passive: true });

// ---------- 확대·축소 ----------

const MIN_ZOOM = 0.5, MAX_ZOOM = 5;

// (cx, cy): 뷰어 기준 좌표. 그 지점이 확대 후에도 같은 자리에 오도록 스크롤을 맞춘다.
function setZoom(z, cx = els.viewer.clientWidth / 2, cy = els.viewer.clientHeight / 2) {
  z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const v = els.viewer;
  const r = z / state.zoom;
  const px = v.scrollLeft + cx;
  const py = v.scrollTop + cy;
  state.zoom = z;
  layoutPages();
  v.scrollLeft = px * r - cx;
  v.scrollTop = py * r - cy;
  updatePageInd();
}

els.btnZoomIn.addEventListener('click', () => setZoom(state.zoom * 1.25));
els.btnZoomOut.addEventListener('click', () => setZoom(state.zoom / 1.25));

// 두 손가락 확대: 움직이는 동안은 CSS 변형만 쓰고, 손을 떼면 실제 크기로 다시 배치한다.
let pinch = null;
const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

els.viewer.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 2) return;
  const [a, b] = e.touches;
  const rect = els.viewer.getBoundingClientRect();
  const cx = (a.clientX + b.clientX) / 2 - rect.left;
  const cy = (a.clientY + b.clientY) / 2 - rect.top;
  pinch = {
    d0: dist(a, b), cx, cy, ratio: 1,
    ox: els.viewer.scrollLeft + cx - els.pages.offsetLeft,
    oy: els.viewer.scrollTop + cy - els.pages.offsetTop,
  };
  els.pages.style.transformOrigin = `${pinch.ox}px ${pinch.oy}px`;
}, { passive: true });

els.viewer.addEventListener('touchmove', (e) => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  const [a, b] = e.touches;
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * dist(a, b) / pinch.d0));
  pinch.ratio = z / state.zoom;
  els.pages.style.transform = `scale(${pinch.ratio})`;
}, { passive: false });

function endPinch() {
  if (!pinch) return;
  const { ratio, cx, cy } = pinch;
  pinch = null;
  els.pages.style.transform = '';
  els.pages.style.transformOrigin = '';
  if (Math.abs(ratio - 1) > 0.01) setZoom(state.zoom * ratio, cx, cy);
}
els.viewer.addEventListener('touchend', (e) => { if (e.touches.length < 2) endPinch(); });
els.viewer.addEventListener('touchcancel', endPinch);

// 두 번 탭: 맞춤 ↔ 2배
let lastTap = 0;
els.viewer.addEventListener('touchend', (e) => {
  if (e.changedTouches.length !== 1 || e.touches.length) return;
  const now = Date.now();
  if (now - lastTap < 300) {
    const t = e.changedTouches[0];
    const rect = els.viewer.getBoundingClientRect();
    setZoom(state.zoom > 1.05 ? 1 : 2, t.clientX - rect.left, t.clientY - rect.top);
    lastTap = 0;
  } else lastTap = now;
});

// 데스크톱: Ctrl + 휠
els.viewer.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const rect = els.viewer.getBoundingClientRect();
  setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.doc) layoutPages(); }, 150);
});

// ---------- 최근 문서 (이 기기의 IndexedDB에만 저장) ----------

const RECENT_MAX = 8;

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hwp-viewer', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recent', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('recent', mode);
    const out = fn(t.objectStore('recent'));
    t.oncomplete = () => resolve(out && out.result);
    t.onerror = () => reject(t.error);
  });
}

async function listRecent() {
  try {
    const db = await idb();
    const all = await tx(db, 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => b.time - a.time);
  } catch { return []; }
}

async function saveRecent(name, bytes) {
  const db = await idb();
  const id = `${name}|${bytes.length}`;
  await tx(db, 'readwrite', (s) => s.put({ id, name, size: bytes.length, time: Date.now(), data: new Blob([bytes]) }));
  const all = await listRecent();
  for (const old of all.slice(RECENT_MAX)) await tx(db, 'readwrite', (s) => s.delete(old.id));
}

async function deleteRecent(id) {
  const db = await idb();
  await tx(db, 'readwrite', (s) => s.delete(id));
}

function fmtSize(n) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}
function fmtTime(t) {
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function renderRecent() {
  const items = await listRecent();
  els.recentWrap.hidden = !items.length;
  els.recent.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    const ext = (it.name.match(/\.(\w+)$/) || [, 'HWP'])[1].toUpperCase();
    li.innerHTML = `<span class="ext"></span><div class="name"><div class="n"></div><div class="meta"></div></div><button class="del" aria-label="목록에서 지우기">✕</button>`;
    li.querySelector('.ext').textContent = ext;
    li.querySelector('.n').textContent = it.name;
    li.querySelector('.meta').textContent = `${fmtTime(it.time)} · ${fmtSize(it.size)}`;
    li.querySelector('.name').addEventListener('click', async () => {
      const bytes = new Uint8Array(await it.data.arrayBuffer());
      openBytes(bytes, it.name);
    });
    li.querySelector('.del').addEventListener('click', async () => {
      await deleteRecent(it.id);
      renderRecent();
    });
    els.recent.appendChild(li);
  }
}

// ---------- 파일 들어오는 길 ----------

els.btnOpen.addEventListener('click', () => els.fileInput.click());
els.btnOpenTop.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => {
  const f = els.fileInput.files[0];
  els.fileInput.value = '';
  openFile(f);
});
els.btnHome.addEventListener('click', () => {
  if (history.state && history.state.viewer) history.back();
  else showHome();
});

// 휴대폰 뒤로 가기 버튼으로 문서를 닫을 수 있게
window.addEventListener('popstate', () => { if (!els.viewer.hidden) showHome(); });

// 끌어다 놓기 (PC)
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  openFile(e.dataTransfer.files[0]);
});

// 설치된 앱으로 파일 열기 (지원하는 브라우저에서)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    const file = await params.files[0].getFile();
    openFile(file);
  });
}

// 다른 앱에서 "공유"로 받은 파일 (service worker가 보관해 둠)
async function takeSharedFile() {
  const url = new URL(location.href);
  if (!url.searchParams.has('shared')) return false;
  history.replaceState(null, '', url.pathname);
  try {
    const cache = await caches.open('share-inbox');
    const res = await cache.match('shared-file');
    if (!res) { toast('공유된 파일을 찾지 못했어요.'); return false; }
    await cache.delete('shared-file');
    const name = decodeURIComponent(res.headers.get('x-file-name') || 'document.hwp');
    const bytes = new Uint8Array(await res.arrayBuffer());
    await openBytes(bytes, name);
    return true;
  } catch (e) {
    console.error(e);
    toast('공유된 파일을 열지 못했어요.');
    return false;
  }
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 등록 실패', e));
}

// 개발용: ?open=경로 로 바로 열기
async function openFromParam() {
  const p = new URL(location.href).searchParams.get('open');
  if (!p) return false;
  const res = await fetch(p);
  await openBytes(new Uint8Array(await res.arrayBuffer()), decodeURIComponent(p.split('/').pop()), { remember: false });
  return true;
}

showHome();
(async () => {
  if (await takeSharedFile()) return;
  await openFromParam();
})();

window.__viewer = { openBytes, state };
