'use strict';

// 이 기기에만 저장되는 간단한 저장소. 앱마다 KEY를 바꿔서 다른 앱과 섞이지 않게 한다.
const KEY = 'lock-planner';
const store = {
  get(k, d) { try { const v = localStorage.getItem(`${KEY}:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`${KEY}:${k}`, JSON.stringify(v)); return true; } catch { return false; } },
};

// 배경 사진은 용량이 커서 IndexedDB에 따로 둔다.
const idb = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(KEY, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => {
        const q = db.transaction('files').objectStore('files').get(k);
        q.onsuccess = () => res(q.result || null);
        q.onerror = () => rej(q.error);
      });
    } catch { return null; }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(v, k);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      return true;
    } catch { return false; }
  },
};

const WP = Wallpaper;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => WP.ymd(new Date());

const DEFAULT_ORDER = ['week', 'tasks', 'today', 'dday', 'year', 'matrix', 'month', 'upcoming', 'note'];
const DEFAULT_ON = ['week', 'tasks', 'today', 'dday', 'year'];
const ACCENTS = ['#ff9f0a', '#ff453a', '#ff6fa8', '#bf5af2', '#5e8bff', '#40c8e0', '#32d74b', '#ffd60a', '#e5e5ea'];
const DEVICES = [
  ['1179x2556', 'iPhone 14 Pro · 15 · 15 Pro · 16'],
  ['1206x2622', 'iPhone 16 Pro · 17 · 17 Pro'],
  ['1290x2796', 'iPhone 14 Pro Max · 15 Plus · 15 Pro Max · 16 Plus'],
  ['1320x2868', 'iPhone 16 Pro Max · 17 Pro Max'],
  ['1170x2532', 'iPhone 12 · 12 Pro · 13 · 13 Pro · 14'],
  ['1284x2778', 'iPhone 12 Pro Max · 13 Pro Max · 14 Plus'],
  ['1125x2436', 'iPhone X · XS · 11 Pro · 12 mini · 13 mini'],
  ['828x1792', 'iPhone XR · 11'],
  ['750x1334', 'iPhone SE (2·3세대) · 8'],
];
const DEFAULT_STYLE = {
  card: 'glass', tone: 'dark', font: 'sans', accent: '#ff9f0a',
  bg: 'gradient', gradient: 0, color: '#1c1c1e', dim: 0.1,
  top: 0.31, size: 1, maxTasks: 6, hideDone: false, weekStart: 0, device: 'auto',
};
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const UP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
const DOWN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

// 처음 열었을 때 보여줄 예시
function sampleData() {
  const t = today();
  return {
    tasks: [
      { id: uid(), text: '보고서 마무리하기', done: false, quad: 0 },
      { id: uid(), text: '물 2리터 마시기', daily: true, doneOn: null, quad: null },
      { id: uid(), text: '운동 30분', daily: true, doneOn: t, quad: 1 },
      { id: uid(), text: '택배 반품 신청', done: false, quad: 2 },
    ],
    events: [
      { id: uid(), title: '팀 회의', date: t, time: '14:00' },
      { id: uid(), title: '친구랑 저녁', date: t, time: '19:30' },
      { id: uid(), title: '치과 예약', date: WP.addDays(t, 3), time: '10:30' },
    ],
    ddays: [{ id: uid(), title: '여행 가는 날', date: WP.addDays(t, 30) }],
    note: '오늘도 한 걸음씩!',
    widgets: DEFAULT_ORDER.map(id => ({ id, on: DEFAULT_ON.includes(id) })),
    style: { ...DEFAULT_STYLE },
  };
}

// 저장된 값이 깨졌거나 예전 형식이어도 앱이 돌아가게 맞춘다
function normalize(d) {
  if (!d || typeof d !== 'object') return sampleData();
  const arr = (v, ok) => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && ok(x)) : []);
  const out = {
    tasks: arr(d.tasks, x => typeof x.text === 'string'),
    events: arr(d.events, x => typeof x.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date)),
    ddays: arr(d.ddays, x => typeof x.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date)),
    note: typeof d.note === 'string' ? d.note : '',
    style: { ...DEFAULT_STYLE, ...(d.style && typeof d.style === 'object' ? d.style : {}) },
    widgets: [],
  };
  const seen = new Set();
  for (const w of arr(d.widgets, x => DEFAULT_ORDER.includes(x.id))) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    out.widgets.push({ id: w.id, on: !!w.on });
  }
  for (const id of DEFAULT_ORDER) if (!seen.has(id)) out.widgets.push({ id, on: false });
  return out;
}

let data = normalize(store.get('data', null));
let photo = null;          // 배경 사진 (Image)
let showGuide = store.get('guide', true);

function commit(...renders) {
  if (!store.set('data', data)) toast('저장 공간이 부족해서 저장하지 못했어요');
  renders.forEach(f => f());
  scheduleRender();
}

// ── 알림 ──
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// ── 아래에서 올라오는 창 ──
function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  const body = $('#sheet-body');
  body.innerHTML = html;
  $('#sheet').hidden = false;
  return body;
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-body').innerHTML = '';
}
$('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#viewer').hidden) closeViewer(); else if (!$('#sheet').hidden) closeSheet();
});

// ── 미리보기 ──
function autoSize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(Math.min(screen.width, screen.height) * dpr);
  const h = Math.round(Math.max(screen.width, screen.height) * dpr);
  if (w < 600 || w > 1600 || h / w < 1.6) return [1179, 2556]; // 폰이 아니면 흔한 아이폰 크기
  return [w, h];
}
function exportSize() {
  if (data.style.device !== 'auto') {
    const [w, h] = String(data.style.device).split('x').map(Number);
    if (w > 0 && h > 0) return [w, h];
  }
  return autoSize();
}

let renderQueued = false, renderToken = 0;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; drawPreview(); });
}

function paintPreview() {
  const [ew, eh] = exportSize();
  const box = $('#phone');
  box.style.aspectRatio = `${ew} / ${eh}`;
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
  const pw = Math.round((box.clientWidth || 200) * dpr);
  const { scale } = WP.render($('#preview'), data, { W: pw, H: Math.round(pw * eh / ew), photo, guide: showGuide });
  $('#fit-warn').hidden = scale >= 0.75;
}

async function drawPreview() {
  const token = ++renderToken;
  if (!WP.fontsReady(data)) {
    paintPreview();               // 글꼴이 오기 전에도 일단 보여준다
    await WP.loadFonts(data);
    if (token !== renderToken) return;
  }
  paintPreview();
}

async function openViewer() {
  const [ew, eh] = exportSize();
  const k = Math.min(innerWidth / ew, innerHeight / eh);
  const cw = Math.round(ew * k), ch = Math.round(eh * k);
  const cv = $('#full');
  cv.style.width = `${cw}px`;
  cv.style.height = `${ch}px`;
  $('#viewer').hidden = false;
  await WP.loadFonts(data);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  WP.render(cv, data, { W: Math.round(cw * dpr), H: Math.round(ch * dpr), photo, guide: showGuide });
}
function closeViewer() { $('#viewer').hidden = true; }

$('#phone').addEventListener('click', openViewer);
$('#zoom-btn').addEventListener('click', openViewer);
$('#viewer').addEventListener('click', closeViewer);

$('#guide-toggle').checked = showGuide;
$('#guide-toggle').addEventListener('change', e => {
  showGuide = e.target.checked;
  store.set('guide', showGuide);
  scheduleRender();
});

// ── 탭 ──
function showTab(id) {
  if (!$(`.panel[data-panel="${id}"]`)) id = 'tasks';
  $$('.tab').forEach(b => { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $$('.panel').forEach(p => { p.hidden = p.dataset.panel !== id; });
  store.set('tab', id);
}
$('.tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (b) showTab(b.dataset.tab);
});

// ── 할 일 ──
function toggleTask(t) {
  if (t.daily) t.doneOn = WP.isDone(t, today()) ? null : today();
  else t.done = !t.done;
}

function renderTasks() {
  const el = $('#task-list'), t0 = today();
  if (!data.tasks.length) {
    el.innerHTML = '<li class="empty">아직 할 일이 없어요.<br>위에 적고 \'추가\'를 눌러요.</li>';
    return;
  }
  el.innerHTML = data.tasks.map(t => {
    const done = WP.isDone(t, t0);
    const badges = (t.daily ? '<i class="badge">매일</i>' : '')
      + (Number.isInteger(t.quad) && WP.QUADS[t.quad] ? `<i class="badge q${t.quad}">${WP.QUADS[t.quad].name}</i>` : '');
    return `<li class="item${done ? ' done' : ''}" data-id="${t.id}">
      <button class="check" data-act="toggle" aria-label="${done ? '완료 취소' : '완료'}"><span class="box">${CHECK_SVG}</span></button>
      <button class="item-main" data-act="edit"><span class="item-text">${esc(t.text)}</span>${badges ? `<span class="badges">${badges}</span>` : ''}</button>
    </li>`;
  }).join('');
}

$('#task-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#task-input');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  data.tasks.push({ id: uid(), text, done: false, quad: null });
  input.value = '';
  commit(renderTasks);
});

$('#task-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  const t = btn && data.tasks.find(x => x.id === btn.closest('[data-id]')?.dataset.id);
  if (!t) return;
  if (btn.dataset.act === 'toggle') { toggleTask(t); commit(renderTasks); }
  else editTask(t);
});

$('#clear-done').addEventListener('click', () => {
  const n = data.tasks.filter(t => !t.daily && t.done).length;
  if (!n) { toast('지울 완료한 일이 없어요'); return; }
  if (!confirm(`완료한 일 ${n}개를 지울까요? ('매일' 할 일은 남아요)`)) return;
  data.tasks = data.tasks.filter(t => t.daily || !t.done);
  commit(renderTasks);
});

function editTask(t) {
  const quads = ['없음', ...WP.QUADS.map(q => q.name)];
  let quad = Number.isInteger(t.quad) ? t.quad : -1;
  const body = openSheet('할 일 고치기', `
    <input class="input" id="e-text" type="text" maxlength="60" value="${esc(t.text)}">
    <label class="set-row plain"><span>매일 반복<em>날마다 체크가 다시 풀려요</em></span><input type="checkbox" class="sw" id="e-daily" ${t.daily ? 'checked' : ''}></label>
    <div>
      <span class="glabel">우선순위 칸 <em>'구성'에서 '우선순위 4칸'을 켜면 보여요</em></span>
      <div class="seg grid3" id="e-quad">${quads.map((n, i) => `<button type="button" data-v="${i - 1}" class="${quad === i - 1 ? 'on' : ''}">${n}</button>`).join('')}</div>
    </div>
    <div class="sheet-actions">
      <button class="mini danger" id="e-del">삭제</button>
      <button class="mini" id="e-top">맨 위로</button>
      <button class="btn" id="e-save">저장</button>
    </div>`);
  $('#e-quad', body).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    quad = Number(b.dataset.v);
    $$('#e-quad button', body).forEach(x => x.classList.toggle('on', x === b));
  });
  const apply = () => {
    const text = $('#e-text', body).value.trim();
    if (!text) { $('#e-text', body).focus(); return false; }
    const wasDone = WP.isDone(t, today());
    const daily = $('#e-daily', body).checked;
    t.text = text;
    t.quad = quad >= 0 ? quad : null;
    if (daily !== !!t.daily) {
      t.daily = daily;
      if (daily) t.doneOn = wasDone ? today() : null; else t.done = wasDone;
    }
    return true;
  };
  $('#e-save', body).onclick = () => { if (apply()) { closeSheet(); commit(renderTasks); } };
  $('#e-top', body).onclick = () => {
    if (!apply()) return;
    data.tasks = [t, ...data.tasks.filter(x => x !== t)];
    closeSheet(); commit(renderTasks);
  };
  $('#e-del', body).onclick = () => {
    data.tasks = data.tasks.filter(x => x !== t);
    closeSheet(); commit(renderTasks); toast('삭제했어요');
  };
}

// ── 일정 ──
function dateTitle(s) {
  const d = WP.parse(s);
  const year = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}년 ` : '';
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일 (${WP.DAYS[d.getDay()]})`;
}

function renderEvents() {
  const el = $('#event-list'), t0 = today();
  const list = [...data.events].sort(WP.byTime);
  if (!list.length) { el.innerHTML = '<li class="empty">아직 일정이 없어요.</li>'; return; }
  let html = '', last = '';
  for (const ev of list) {
    const past = ev.date < t0 ? ' past' : '';
    if (ev.date !== last) {
      last = ev.date;
      const n = WP.diffDays(t0, ev.date);
      html += `<li class="group-head${past}">${dateTitle(ev.date)}${n === 0 ? ' · 오늘' : n === 1 ? ' · 내일' : ''}</li>`;
    }
    html += `<li class="item${past}" data-id="${ev.id}">
      <button class="item-main row" data-act="edit"><span class="time">${esc(ev.time || '종일')}</span><span class="item-text">${esc(ev.title)}</span></button>
    </li>`;
  }
  el.innerHTML = html;
}

$('#ev-date').value = today();
$('#event-form').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#ev-title').value.trim(), date = $('#ev-date').value;
  if (!title) { $('#ev-title').focus(); return; }
  if (!date) { toast('날짜를 골라주세요'); return; }
  data.events.push({ id: uid(), title, date, time: $('#ev-time').value || '' });
  $('#ev-title').value = '';
  $('#ev-time').value = '';
  commit(renderEvents);
  toast('일정을 추가했어요');
});

$('#event-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  const ev = btn && data.events.find(x => x.id === btn.closest('[data-id]')?.dataset.id);
  if (ev) editEvent(ev);
});

$('#clear-past').addEventListener('click', () => {
  const t0 = today();
  const n = data.events.filter(ev => ev.date < t0).length;
  if (!n) { toast('지난 일정이 없어요'); return; }
  if (!confirm(`지난 일정 ${n}개를 지울까요?`)) return;
  data.events = data.events.filter(ev => ev.date >= t0);
  commit(renderEvents);
});

function editEvent(ev) {
  const body = openSheet('일정 고치기', `
    <input class="input" id="e-title" type="text" maxlength="40" value="${esc(ev.title)}">
    <div class="two">
      <input class="input" id="e-date" type="date" value="${esc(ev.date)}" aria-label="날짜">
      <input class="input" id="e-time" type="time" value="${esc(ev.time)}" aria-label="시간">
    </div>
    <p class="muted small">시간을 지우면 '종일'로 보여요</p>
    <div class="sheet-actions">
      <button class="mini danger" id="e-del">삭제</button>
      <button class="btn" id="e-save">저장</button>
    </div>`);
  $('#e-save', body).onclick = () => {
    const title = $('#e-title', body).value.trim(), date = $('#e-date', body).value;
    if (!title) { $('#e-title', body).focus(); return; }
    if (!date) { toast('날짜를 골라주세요'); return; }
    Object.assign(ev, { title, date, time: $('#e-time', body).value || '' });
    closeSheet(); commit(renderEvents);
  };
  $('#e-del', body).onclick = () => {
    data.events = data.events.filter(x => x !== ev);
    closeSheet(); commit(renderEvents); toast('삭제했어요');
  };
}

// ── 디데이 ──
function renderDdays() {
  const el = $('#dday-list'), t0 = today();
  if (!data.ddays.length) { el.innerHTML = '<li class="empty">아직 디데이가 없어요.</li>'; return; }
  const list = data.ddays.map(d => ({ d, n: WP.diffDays(t0, d.date) }))
    .sort((a, b) => (a.n < 0) - (b.n < 0) || (a.n < 0 ? b.n - a.n : a.n - b.n));
  el.innerHTML = list.map(({ d, n }) => `<li class="item${n < 0 ? ' past' : ''}" data-id="${d.id}">
    <button class="item-main" data-act="edit"><span class="item-text">${esc(d.title)}</span><span class="sub">${dateTitle(d.date)}</span></button>
    <span class="dlabel">${WP.ddayLabel(n)}</span>
  </li>`).join('');
}

$('#dd-date').value = WP.addDays(today(), 7);
$('#dday-form').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#dd-title').value.trim(), date = $('#dd-date').value;
  if (!title) { $('#dd-title').focus(); return; }
  if (!date) { toast('날짜를 골라주세요'); return; }
  data.ddays.push({ id: uid(), title, date });
  $('#dd-title').value = '';
  commit(renderDdays);
  toast('디데이를 추가했어요');
});

$('#dday-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  const d = btn && data.ddays.find(x => x.id === btn.closest('[data-id]')?.dataset.id);
  if (!d) return;
  const body = openSheet('디데이 고치기', `
    <input class="input" id="e-title" type="text" maxlength="30" value="${esc(d.title)}">
    <input class="input" id="e-date" type="date" value="${esc(d.date)}" aria-label="날짜">
    <div class="sheet-actions">
      <button class="mini danger" id="e-del">삭제</button>
      <button class="btn" id="e-save">저장</button>
    </div>`);
  $('#e-save', body).onclick = () => {
    const title = $('#e-title', body).value.trim(), date = $('#e-date', body).value;
    if (!title) { $('#e-title', body).focus(); return; }
    if (!date) { toast('날짜를 골라주세요'); return; }
    Object.assign(d, { title, date });
    closeSheet(); commit(renderDdays);
  };
  $('#e-del', body).onclick = () => {
    data.ddays = data.ddays.filter(x => x !== d);
    closeSheet(); commit(renderDdays); toast('삭제했어요');
  };
});

// ── 메모 ──
$('#note').addEventListener('input', e => {
  data.note = e.target.value;
  commit();
});

// ── 구성 ──
function renderWidgets() {
  const last = data.widgets.length - 1;
  $('#widget-list').innerHTML = data.widgets.map((w, i) => {
    const m = WP.WIDGETS[w.id];
    return `<li class="item widget${w.on ? '' : ' off'}" data-id="${w.id}">
      <div class="w-info"><b>${m.name}</b><em>${m.desc}</em></div>
      <button class="arrow" data-act="up" aria-label="${m.name} 위로" ${i === 0 ? 'disabled' : ''}>${UP_SVG}</button>
      <button class="arrow" data-act="down" aria-label="${m.name} 아래로" ${i === last ? 'disabled' : ''}>${DOWN_SVG}</button>
      <input type="checkbox" class="sw" data-act="on" aria-label="${m.name} 보이기" ${w.on ? 'checked' : ''}>
    </li>`;
  }).join('');
}

$('#widget-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const i = data.widgets.findIndex(w => w.id === btn.closest('[data-id]').dataset.id);
  const j = btn.dataset.act === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= data.widgets.length) return;
  [data.widgets[i], data.widgets[j]] = [data.widgets[j], data.widgets[i]];
  commit(renderWidgets);
});
$('#widget-list').addEventListener('change', e => {
  if (e.target.dataset.act !== 'on') return;
  const w = data.widgets.find(x => x.id === e.target.closest('[data-id]').dataset.id);
  if (!w) return;
  w.on = e.target.checked;
  commit(renderWidgets);
  if (w.on && w.id === 'note' && !data.note.trim()) toast("메모가 비어 있어요. '메모' 탭에서 적어주세요");
});

function renderSettings() {
  $('#max-val').textContent = data.style.maxTasks;
  $('#hide-done').checked = !!data.style.hideDone;
}
$('#max-dec').addEventListener('click', () => { data.style.maxTasks = Math.max(2, data.style.maxTasks - 1); commit(renderSettings); });
$('#max-inc').addEventListener('click', () => { data.style.maxTasks = Math.min(12, data.style.maxTasks + 1); commit(renderSettings); });
$('#hide-done').addEventListener('change', e => { data.style.hideDone = e.target.checked; commit(); });

// ── 꾸미기 ──
const RANGES = ['dim', 'top', 'size'];

function renderStyle() {
  const st = data.style;
  $$('.seg[data-key]').forEach(seg => {
    $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.v === String(st[seg.dataset.key])));
  });
  $('#accent-list').innerHTML = ACCENTS.map(c => `<button class="swatch${c === st.accent ? ' on' : ''}" data-v="${c}" style="background:${c}" aria-label="포인트 색 ${c}"></button>`).join('');
  $('#grad-list').innerHTML = WP.GRADIENTS.map((g, i) => `<button class="swatch${i === st.gradient ? ' on' : ''}" data-v="${i}" style="background:linear-gradient(160deg, ${g.join(', ')})" aria-label="그라데이션 ${i + 1}"></button>`).join('');
  $$('.bg-opt').forEach(el => { el.hidden = el.dataset.bg !== st.bg; });
  $('#bg-color').value = st.color;
  $('#photo-state').textContent = photo ? '사진이 들어가 있어요' : '아직 사진이 없어요';
  for (const k of RANGES) {
    const v = Math.round(st[k] * 100);
    $(`#${k}`).value = v;
    $(`#${k}-val`).textContent = `${v}%`;
  }
  const [aw, ah] = autoSize();
  $('#device').innerHTML = [['auto', `이 폰에 맞춤 (${aw}×${ah})`], ...DEVICES.map(([v, n]) => [v, `${n} (${v.replace('x', '×')})`])]
    .map(([v, n]) => `<option value="${v}"${v === st.device ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

document.addEventListener('click', e => {
  const b = e.target.closest('.seg[data-key] button');
  if (!b) return;
  const key = b.parentElement.dataset.key;
  const v = key === 'weekStart' ? Number(b.dataset.v) : b.dataset.v;
  if (key === 'bg' && v === 'photo' && !photo) { $('#photo-input').click(); return; }
  data.style[key] = v;
  commit(renderStyle);
});

$('#accent-list').addEventListener('click', e => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  data.style.accent = b.dataset.v;
  commit(renderStyle);
});
$('#grad-list').addEventListener('click', e => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  data.style.gradient = Number(b.dataset.v);
  commit(renderStyle);
});
$('#bg-color').addEventListener('input', e => { data.style.color = e.target.value; commit(); });
for (const k of RANGES) {
  $(`#${k}`).addEventListener('input', e => {
    data.style[k] = Number(e.target.value) / 100;
    $(`#${k}-val`).textContent = `${e.target.value}%`;
    commit();
  });
}
$('#device').addEventListener('change', e => { data.style.device = e.target.value; commit(); });

// ── 배경 사진 ──
function loadImage(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(img.src); rej(new Error('image')); };
    img.src = URL.createObjectURL(blob);
  });
}

// 가장 큰 아이폰 화면(1320×2868)을 덮을 만큼만 남기고 줄여서 저장 공간을 아낀다
async function shrinkPhoto(file) {
  const img = await loadImage(file);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const k = Math.min(1, Math.max(1320 / iw, 2868 / ih));
  const cv = document.createElement('canvas');
  cv.width = Math.round(iw * k);
  cv.height = Math.round(ih * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(img.src);
  return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.9));
}

async function setPhoto(blob) {
  const img = await loadImage(blob);
  if (photo) URL.revokeObjectURL(photo.src);
  photo = img;
}

$('#photo-btn').addEventListener('click', () => $('#photo-input').click());
$('#photo-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  toast('사진을 불러오는 중…');
  try {
    const blob = await shrinkPhoto(file);
    await setPhoto(blob);
    const saved = await idb.set('photo', blob);
    data.style.bg = 'photo';
    commit(renderStyle);
    toast(saved ? '사진을 배경으로 넣었어요' : '사진을 넣었지만 기기에 저장하지 못했어요. 다시 열면 사라질 수 있어요');
  } catch {
    toast('사진을 열지 못했어요. 다른 사진으로 해 보세요');
  }
});

// ── 저장 ──
$('#save-btn').addEventListener('click', async () => {
  const body = openSheet('잠금화면 배경 저장', '<p class="muted center">그림을 만드는 중…</p>');
  const [w, h] = exportSize();
  await WP.loadFonts(data);
  const cv = document.createElement('canvas');
  WP.render(cv, data, { W: w, H: h, photo, guide: false });
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if ($('#sheet').hidden || body !== $('#sheet-body')) return;
  if (!blob) { body.innerHTML = '<p class="muted center">그림을 만들지 못했어요. 다시 시도해 주세요.</p>'; return; }
  const name = `lockscreen-${today()}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  body.innerHTML = `
    <img class="save-img" src="${url}" alt="만든 잠금화면 배경">
    <p class="muted small center">${w}×${h} 픽셀</p>
    ${canShare ? '<button class="btn" id="share-btn">사진에 저장하기</button>' : ''}
    <a class="mini wide center" id="dl-link" href="${url}" download="${name}">파일로 내려받기</a>
    <ol class="steps">
      <li>${canShare ? "'사진에 저장하기' → 공유 창에서 <b>이미지 저장</b>" : '위 그림을 길게 눌러 <b>사진 앱에 저장</b>'}</li>
      <li>사진 앱에서 그 그림 열기 → <b>공유</b> → <b>배경화면으로 사용</b></li>
      <li>할 일·일정이 바뀌면 다시 저장해서 바꿔주세요</li>
    </ol>
    <p class="muted small">공유 창이 안 뜨면 위 그림을 길게 눌러 저장해도 돼요.</p>`;
  const share = $('#share-btn', body);
  if (share) share.onclick = async () => {
    try { await navigator.share({ files: [file] }); }
    catch (err) { if (err.name !== 'AbortError') toast('공유 창을 열지 못했어요. 그림을 길게 눌러 저장해 주세요'); }
  };
});

// ── 도움말 ──
$('#help-btn').addEventListener('click', () => {
  const body = openSheet('도움말', `
    <div class="help">
      <p>할 일·일정·디데이·메모를 그려 넣은 <b>잠금화면 배경 그림</b>을 만드는 앱이에요.</p>
      <h4>쓰는 법</h4>
      <ol class="steps">
        <li>위 탭에서 할 일·일정·디데이·메모를 넣어요</li>
        <li>'구성'에서 보일 카드와 순서를, '꾸미기'에서 모양을 골라요</li>
        <li>아래 <b>잠금화면 배경 저장</b> → 사진에 저장 → 배경화면으로 지정</li>
      </ol>
      <h4>알아둘 점</h4>
      <ul class="steps dots">
        <li>웹앱이라 잠금화면을 <b>자동으로 바꾸지 못해요</b>. 내용이 바뀌면 다시 저장해서 배경으로 지정해야 해요.</li>
        <li>아이폰 캘린더·미리 알림과는 연결되지 않아요. 일정은 직접 넣어요.</li>
        <li>적은 내용은 이 폰의 브라우저 안에만 저장돼요. 사파리 방문 기록·웹사이트 데이터를 지우면 함께 지워져요.</li>
        <li>사파리 공유 버튼 → <b>홈 화면에 추가</b>를 하면 앱처럼 열 수 있어요.</li>
      </ul>
      <button class="mini danger wide" id="reset-btn">할 일·일정·디데이·메모 모두 지우기</button>
    </div>`);
  $('#reset-btn', body).onclick = () => {
    if (!confirm('할 일·일정·디데이·메모를 모두 지울까요? (꾸미기 설정은 남아요)')) return;
    Object.assign(data, { tasks: [], events: [], ddays: [], note: '' });
    closeSheet();
    renderAll();
    toast('모두 지웠어요');
  };
});

// ── 시작 ──
function renderAll() {
  renderTasks();
  renderEvents();
  renderDdays();
  $('#note').value = data.note;
  renderWidgets();
  renderSettings();
  renderStyle();
  commit();
}

showTab(store.get('tab', 'tasks'));
renderAll();
idb.get('photo').then(async blob => {
  if (!blob) return;
  try { await setPhoto(blob); renderStyle(); scheduleRender(); } catch { /* 사진이 깨졌으면 무시 */ }
});

let lastDay = today();
addEventListener('resize', scheduleRender);
// 자정을 넘겨 다시 열면 '오늘'이 바뀌므로 다시 그린다
document.addEventListener('visibilitychange', () => {
  if (document.hidden || today() === lastDay) return;
  lastDay = today();
  renderAll();
});
