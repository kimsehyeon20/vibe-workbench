'use strict';

/* ===== 저장소 (이 기기에만 저장) ===== */
const KEY = 'macro-studio';
const store = {
  get(d) { try { const v = localStorage.getItem(KEY); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};

/* ===== 동작 종류 정의 ===== */
const TYPES = {
  url:    { ico: '🌐', label: '주소 열기 (URL)' },
  move:   { ico: '🖱️', label: '마우스 이동' },
  click:  { ico: '👆', label: '클릭' },
  drag:   { ico: '✋', label: '드래그' },
  hotkey: { ico: '⌨️', label: '단축키 (복사·붙여넣기 등)' },
  text:   { ico: '✏️', label: '글자 입력' },
  win:    { ico: '🪟', label: '창 활성화 (제목으로 찾기)' },
  scroll: { ico: '🖲️', label: '스크롤' },
  wait:   { ico: '⏱️', label: '대기 (초)' },
};

const HOTKEYS = {
  copy:   { label: '복사 (Ctrl+C)',      ahk: '^c',      py: ['ctrl', 'c'], sk: '^c' },
  paste:  { label: '붙여넣기 (Ctrl+V)',   ahk: '^v',      py: ['ctrl', 'v'], sk: '^v' },
  cut:    { label: '잘라내기 (Ctrl+X)',   ahk: '^x',      py: ['ctrl', 'x'], sk: '^x' },
  all:    { label: '전체선택 (Ctrl+A)',   ahk: '^a',      py: ['ctrl', 'a'], sk: '^a' },
  save:   { label: '저장 (Ctrl+S)',      ahk: '^s',      py: ['ctrl', 's'], sk: '^s' },
  undo:   { label: '실행취소 (Ctrl+Z)',   ahk: '^z',      py: ['ctrl', 'z'], sk: '^z' },
  find:   { label: '찾기 (Ctrl+F)',      ahk: '^f',      py: ['ctrl', 'f'], sk: '^f' },
  alttab: { label: '창 전환 (Alt+Tab)',  ahk: '!{Tab}',  py: ['alt', 'tab'], sk: '%{TAB}' },
  enter:  { label: '엔터 (Enter)',       ahk: '{Enter}', py: ['enter'],     sk: '{ENTER}' },
  tab:    { label: '탭 (Tab)',           ahk: '{Tab}',   py: ['tab'],       sk: '{TAB}' },
  esc:    { label: 'ESC',               ahk: '{Esc}',   py: ['esc'],       sk: '{ESC}' },
  custom: { label: '직접 입력',           ahk: '',        py: [],            sk: '' },
};

/* 실행 중 제어 단축키 (사람이 외우기 쉬운 키로 고정) */
const CTRL_KEYS = { pauseLabel: 'F8', stopLabel: 'F9' };

/* ===== 상태 ===== */
let state = normalize(store.get(null));
let activeId = state.loops[0].id;

function normalize(s) {
  if (!s || !Array.isArray(s.loops) || s.loops.length === 0) s = seed();
  s.screen = s.screen && s.screen.w ? s.screen : { w: 1920, h: 1080 };
  s.loops.forEach(l => {
    if (typeof l.gap !== 'number') l.gap = 0.5;
    if (typeof l.startAt !== 'string') l.startAt = '';
    if (!Array.isArray(l.steps)) l.steps = [];
  });
  return s;
}

function seed() {
  return {
    screen: { w: 1920, h: 1080 },
    loops: [{
      id: uid(), name: '예시: 복사해서 다른 창에 붙여넣기', repeat: 1, delay: 3, gap: 0.5, startAt: '',
      steps: [
        { id: uid(), type: 'win', title: '엑셀' },
        { id: uid(), type: 'click', x: 600, y: 320, button: 'left', double: false },
        { id: uid(), type: 'hotkey', preset: 'copy', mods: [], key: '' },
        { id: uid(), type: 'wait', sec: 1 },
        { id: uid(), type: 'hotkey', preset: 'alttab', mods: [], key: '' },
        { id: uid(), type: 'click', x: 880, y: 500, button: 'left', double: false },
        { id: uid(), type: 'hotkey', preset: 'paste', mods: [], key: '' },
      ],
    }],
  };
}

function uid() { return Math.random().toString(36).slice(2, 9); }
function save() { store.set(state); }
function activeLoop() { return state.loops.find(l => l.id === activeId) || state.loops[0]; }

/* ===== 공통 ===== */
const $ = s => document.querySelector(s);
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 1800);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function num(v) { return Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0; }

/* ===== 렌더: 루프 칩 ===== */
function renderChips() {
  const box = $('#loop-chips');
  box.innerHTML = '';
  state.loops.forEach(l => {
    const b = document.createElement('button');
    b.className = 'chip' + (l.id === activeId ? ' on' : '');
    b.textContent = l.name || '이름 없음';
    b.onclick = () => { activeId = l.id; renderAll(); };
    box.appendChild(b);
  });
}

/* ===== 렌더: 루프 설정 ===== */
function renderSettings() {
  const l = activeLoop();
  $('#loop-name').value = l.name;
  $('#loop-repeat').value = l.repeat;
  $('#loop-delay').value = l.delay;
  $('#loop-gap').value = l.gap;
  $('#loop-startat').value = l.startAt || '';
}
$('#loop-name').oninput = e => { activeLoop().name = e.target.value; save(); renderChips(); };
$('#loop-repeat').oninput = e => { activeLoop().repeat = Math.max(0, parseInt(e.target.value) || 0); save(); };
$('#loop-delay').oninput = e => { activeLoop().delay = Math.max(0, parseFloat(e.target.value) || 0); save(); };
$('#loop-gap').oninput = e => { activeLoop().gap = Math.max(0, parseFloat(e.target.value) || 0); save(); };
$('#loop-startat').oninput = e => { activeLoop().startAt = e.target.value || ''; save(); };

/* ===== 동작 한 줄 설명 ===== */
function stepDesc(s) {
  switch (s.type) {
    case 'url': return `${s.url || '(주소 없음)'}`;
    case 'move': return `화면 X ${s.x}, Y ${s.y} 로 이동`;
    case 'click': return `X ${s.x}, Y ${s.y} ${s.double ? '더블' : ''}${s.button === 'right' ? '우' : s.button === 'middle' ? '가운데' : ''}클릭`;
    case 'drag': return `X ${s.x1},${s.y1} → X ${s.x2},${s.y2} 끌기`;
    case 'hotkey': return (s.preset === 'custom')
      ? `${[...(s.mods || []), s.key].filter(Boolean).join(' + ') || '(비어있음)'}`
      : (HOTKEYS[s.preset] || {}).label || '단축키';
    case 'text': return `"${(s.text || '').slice(0, 24)}" 입력`;
    case 'win': return `제목에 "${s.title}" 있는 창 앞으로`;
    case 'scroll': return `${s.dir === 'up' ? '위' : '아래'}로 ${s.amount}칸 스크롤`;
    case 'wait': return `${s.sec}초 기다리기`;
    default: return '';
  }
}

/* ===== 렌더: 동작 목록 ===== */
const ICON = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
};

function renderSteps() {
  const l = activeLoop();
  const ol = $('#steps');
  ol.innerHTML = '';
  $('#steps-count').textContent = l.steps.length ? `${l.steps.length}개` : '';
  $('#empty-steps').hidden = l.steps.length > 0;

  l.steps.forEach((s, i) => {
    const t = TYPES[s.type] || { ico: '•', label: s.type };
    const li = document.createElement('li');
    li.className = 'step';
    li.dataset.i = i;
    li.innerHTML = `
      <span class="num">${i + 1}</span>
      <div class="st-main">
        <div class="st-type"><span class="st-ico">${t.ico}</span>${t.label}</div>
        <div class="st-desc">${escapeHtml(stepDesc(s))}</div>
      </div>
      <div class="step-actions">
        <button data-act="up" aria-label="위로">${ICON.up}</button>
        <button data-act="down" aria-label="아래로">${ICON.down}</button>
        <button data-act="del" aria-label="삭제" class="danger">${ICON.trash}</button>
      </div>`;
    li.querySelector('.st-main').onclick = () => openStepSheet(i);
    li.querySelectorAll('.step-actions button').forEach(btn => {
      btn.onclick = e => { e.stopPropagation(); stepAction(btn.dataset.act, i); };
    });
    ol.appendChild(li);
  });
}

function stepAction(act, i) {
  const steps = activeLoop().steps;
  if (act === 'del') { steps.splice(i, 1); }
  else if (act === 'up' && i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; }
  else if (act === 'down' && i < steps.length - 1) { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; }
  save(); renderSteps();
}

/* ===== 동작 추가/편집 시트 ===== */
let draft = null, editingIndex = null;

function openStepSheet(index) {
  editingIndex = index;
  if (index == null) draft = { type: 'click', x: 100, y: 100, button: 'left', double: false };
  else draft = JSON.parse(JSON.stringify(activeLoop().steps[index]));
  $('#sheet-title').textContent = index == null ? '동작 추가' : '동작 수정';
  renderSheetBody();
  showSheet('#sheet', '#sheet-bg');
}

function renderSheetBody() {
  const body = $('#sheet-body');
  let html = '<div class="type-grid">';
  for (const [k, v] of Object.entries(TYPES)) {
    html += `<button class="type-opt${draft.type === k ? ' on' : ''}" data-type="${k}"><span class="ti">${v.ico}</span><span class="tl">${v.label}</span></button>`;
  }
  html += '</div>';
  html += fieldsFor(draft.type);
  body.innerHTML = html;
  body.querySelectorAll('[data-type]').forEach(b => { b.onclick = () => setType(b.dataset.type); });
  bindFields();
}

function setType(type) {
  const d = {
    url:    { type, url: 'https://' },
    move:   { type, x: 100, y: 100 },
    click:  { type, x: 100, y: 100, button: 'left', double: false },
    drag:   { type, x1: 100, y1: 100, x2: 300, y2: 300 },
    hotkey: { type, preset: 'copy', mods: [], key: '' },
    text:   { type, text: '' },
    win:    { type, title: '' },
    scroll: { type, dir: 'down', amount: 3 },
    wait:   { type, sec: 1 },
  };
  draft = d[type];
  renderSheetBody();
}

function fieldsFor(type) {
  const xy = (lx, ly, vx, vy) => `
    <div class="two">
      <label class="field"><span>${lx}</span><input type="number" data-k="${vx}" value="${draft[vx]}" inputmode="numeric"></label>
      <label class="field"><span>${ly}</span><input type="number" data-k="${vy}" value="${draft[vy]}" inputmode="numeric"></label>
    </div>`;
  switch (type) {
    case 'url':
      return `<label class="field"><span>열 주소</span><input type="text" data-k="url" value="${escapeHtml(draft.url || '')}" placeholder="https://..." autocomplete="off"></label>
        <p class="hint">기본 브라우저에서 이 주소를 열어요. 뒤에 "몇 초 대기"를 넣어 페이지가 뜰 시간을 주세요.</p>`;
    case 'move':
      return xy('가로 X', '세로 Y', 'x', 'y') + coordHint();
    case 'click':
      return xy('가로 X', '세로 Y', 'x', 'y') + coordHint() + `
        <div class="field"><span>버튼</span><div class="chk-row" data-group="button">
          ${chk('button', 'left', '왼쪽')}${chk('button', 'right', '오른쪽')}${chk('button', 'middle', '가운데')}
        </div></div>
        <div class="field"><div class="chk-row" data-group="double">
          ${chk('double', true, '더블클릭', draft.double === true)}
        </div></div>`;
    case 'drag':
      return `<p class="hint">시작 위치에서 누른 채로 끝 위치까지 끌어요.</p>`
        + xy('시작 X', '시작 Y', 'x1', 'y1') + xy('끝 X', '끝 Y', 'x2', 'y2') + coordHint();
    case 'hotkey': {
      let h = `<label class="field"><span>단축키 고르기</span><select data-k="preset">`;
      for (const [k, v] of Object.entries(HOTKEYS)) h += `<option value="${k}"${draft.preset === k ? ' selected' : ''}>${v.label}</option>`;
      h += `</select></label>`;
      if (draft.preset === 'custom') {
        h += `<div class="field"><span>함께 누를 키</span><div class="chk-row" data-group="mods">
          ${chk('mods', 'ctrl', 'Ctrl', (draft.mods || []).includes('ctrl'))}
          ${chk('mods', 'shift', 'Shift', (draft.mods || []).includes('shift'))}
          ${chk('mods', 'alt', 'Alt', (draft.mods || []).includes('alt'))}
          ${chk('mods', 'win', 'Win', (draft.mods || []).includes('win'))}
        </div></div>
        <label class="field"><span>글자/키</span><input type="text" data-k="key" value="${escapeHtml(draft.key || '')}" placeholder="예: p, f5, enter" autocomplete="off"></label>`;
      }
      return h;
    }
    case 'text':
      return `<label class="field"><span>입력할 글자</span><input type="text" data-k="text" value="${escapeHtml(draft.text || '')}" placeholder="예: 안녕하세요" autocomplete="off"></label>
        <p class="hint">한글은 .ahk 파일에서 가장 잘 입력돼요.</p>`;
    case 'win':
      return `<label class="field"><span>창 제목의 일부</span><input type="text" data-k="title" value="${escapeHtml(draft.title || '')}" placeholder="예: 받은편지함" autocomplete="off"></label>
        <p class="hint">제목에 이 글자가 든 창을 찾아 앞으로 가져와요. 위치가 바뀌어도 잘 찾습니다. 아래 "F12 소스 분석"으로 제목을 뽑을 수 있어요.</p>`;
    case 'scroll':
      return `<div class="field"><span>방향</span><div class="chk-row" data-group="dir">
          ${chk('dir', 'down', '아래로')}${chk('dir', 'up', '위로')}
        </div></div>
        <label class="field"><span>몇 칸</span><input type="number" data-k="amount" value="${draft.amount}" min="1" inputmode="numeric"></label>`;
    case 'wait':
      return `<label class="field"><span>기다릴 시간(초)</span><input type="number" data-k="sec" value="${draft.sec}" min="0" step="0.5" inputmode="decimal"></label>`;
    default: return '';
  }
}

function coordHint() {
  return `<p class="hint">X·Y 숫자를 모르면 "좌표 찾기 도우미"를 받아 PC에서 실행하고, 마우스를 원하는 곳에 올리면 숫자가 보여요.</p>`;
}
function chk(group, value, label, on) {
  const active = on !== undefined ? on : String(draft[group]) === String(value);
  return `<button class="chk${active ? ' on' : ''}" data-group="${group}" data-value="${value}">${label}</button>`;
}
function bindFields() {
  const body = $('#sheet-body');
  body.querySelectorAll('input[data-k], select[data-k]').forEach(el => {
    el.oninput = () => {
      const k = el.dataset.k;
      if (el.type === 'number') draft[k] = el.value === '' ? '' : Number(el.value);
      else draft[k] = el.value;
      if (k === 'preset') renderSheetBody();
    };
  });
  body.querySelectorAll('.chk').forEach(btn => {
    btn.onclick = () => {
      const g = btn.dataset.group, val = btn.dataset.value;
      if (g === 'mods') {
        draft.mods = draft.mods || [];
        const i = draft.mods.indexOf(val);
        if (i >= 0) draft.mods.splice(i, 1); else draft.mods.push(val);
      } else if (g === 'double') { draft.double = !draft.double; }
      else { draft[g] = val; }
      renderSheetBody();
    };
  });
}

$('#sheet-save').onclick = () => {
  const l = activeLoop();
  if (editingIndex == null) l.steps.push(draft);
  else l.steps[editingIndex] = draft;
  save(); renderSteps(); hideSheet('#sheet', '#sheet-bg');
};
$('#sheet-close').onclick = () => hideSheet('#sheet', '#sheet-bg');
$('#sheet-bg').onclick = () => hideSheet('#sheet', '#sheet-bg');
$('#add-step').onclick = () => openStepSheet(null);

function showSheet(s, bg) { $(bg).hidden = false; $(s).hidden = false; }
function hideSheet(s, bg) { $(bg).hidden = true; $(s).hidden = true; }

/* ===== 루프 추가/삭제 ===== */
$('#add-loop').onclick = () => {
  const l = { id: uid(), name: `루프 ${state.loops.length + 1}`, repeat: 1, delay: 3, gap: 0.5, startAt: '', steps: [] };
  state.loops.push(l); activeId = l.id; save(); renderAll();
};
function addDeleteLoopButton() {
  if ($('#del-loop')) return;
  const sec = $('#loop-settings');
  const row = document.createElement('div');
  row.className = 'row'; row.style.marginTop = '12px';
  row.innerHTML = `<button class="mini ghost danger" id="del-loop" style="margin-left:auto">이 루프 삭제</button>`;
  sec.appendChild(row);
  $('#del-loop').onclick = () => {
    if (state.loops.length <= 1) { toast('마지막 루프는 지울 수 없어요'); return; }
    if (!confirm(`"${activeLoop().name}" 루프를 삭제할까요?`)) return;
    state.loops = state.loops.filter(l => l.id !== activeId);
    activeId = state.loops[0].id; save(); renderAll();
  };
}

/* =========================================================
   미리보기 (모의 실행) — 브라우저 안에서 순서·타이밍만 재현
   ========================================================= */
const prev = { running: false, playing: false, cancel: false };

function openPreview() {
  buildPreviewSteps();
  resetCursor();
  $('#prev-caption').textContent = '재생을 누르면 동작 순서를 차례로 보여줘요';
  $('#prev-play').textContent = '▶ 재생';
  prev.running = false; prev.playing = false; prev.cancel = true;
  showSheet('#preview', '#prev-bg');
}
function closePreview() { prev.cancel = true; prev.playing = false; prev.running = false; hideSheet('#preview', '#prev-bg'); }

function buildPreviewSteps() {
  const box = $('#prev-steps');
  box.innerHTML = '';
  activeLoop().steps.forEach((s, i) => {
    const t = TYPES[s.type] || { ico: '•' };
    const d = document.createElement('div');
    d.className = 'pv-chip'; d.dataset.i = i;
    d.innerHTML = `<span>${t.ico}</span>${i + 1}`;
    box.appendChild(d);
  });
}
function highlight(i) {
  document.querySelectorAll('.pv-chip').forEach(c => c.classList.toggle('on', +c.dataset.i === i));
  const el = document.querySelector(`.pv-chip[data-i="${i}"]`);
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}
function setCap(t) { $('#prev-caption').textContent = t; }

function resetCursor() {
  const c = $('#prev-cursor');
  c.style.transition = 'none'; c.style.left = '50%'; c.style.top = '50%';
  c.classList.remove('down'); hideBadge();
}
function moveCursor(x, y, ms) {
  const c = $('#prev-cursor');
  const px = Math.max(0, Math.min(100, (x / state.screen.w) * 100));
  const py = Math.max(0, Math.min(100, (y / state.screen.h) * 100));
  c.style.transition = `left ${ms}ms ease, top ${ms}ms ease`;
  c.style.left = px + '%'; c.style.top = py + '%';
}
function pulse(button, double) {
  const scr = $('#prev-screen');
  const c = $('#prev-cursor');
  const ring = document.createElement('div');
  ring.className = 'pv-ring' + (button === 'right' ? ' right' : button === 'middle' ? ' mid' : '');
  ring.style.left = c.style.left; ring.style.top = c.style.top;
  scr.appendChild(ring);
  setTimeout(() => ring.remove(), 600);
  if (double) setTimeout(() => { const r2 = ring.cloneNode(); r2.style.left = c.style.left; r2.style.top = c.style.top; scr.appendChild(r2); setTimeout(() => r2.remove(), 600); }, 180);
}
function grab(on) { $('#prev-cursor').classList.toggle('down', on); }
function badge(text) { const b = $('#prev-badge'); b.textContent = text; b.hidden = false; }
function hideBadge() { $('#prev-badge').hidden = true; }

/* 재생 중에만 시간이 흐르는 대기 (일시정지하면 멈춤, 정지하면 취소) */
function wait(ms) {
  return new Promise(resolve => {
    let remaining = ms, last = performance.now();
    const id = setInterval(() => {
      if (prev.cancel) { clearInterval(id); return resolve('cancel'); }
      const now = performance.now();
      if (prev.playing) remaining -= (now - last);
      last = now;
      if (remaining <= 0) { clearInterval(id); return resolve('done'); }
    }, 30);
  });
}
const capMs = (ms, fast) => fast ? Math.min(ms, 1400) : ms;

async function doStepPreview(s, fast) {
  const c = ms => capMs(ms, fast);
  hideBadge();
  switch (s.type) {
    case 'url': badge(`🌐 ${s.url || ''}`); setCap('주소 열기'); return wait(c(900));
    case 'move': setCap(`마우스 이동 → X${s.x}, Y${s.y}`); moveCursor(s.x, s.y, 400); return wait(c(500));
    case 'click': {
      setCap(`${s.double ? '더블' : ''}${s.button === 'right' ? '우' : s.button === 'middle' ? '가운데' : ''}클릭 (X${s.x}, Y${s.y})`);
      moveCursor(s.x, s.y, 350); const r = await wait(c(420)); if (r === 'cancel') return r;
      pulse(s.button, s.double); return wait(c(400));
    }
    case 'drag': {
      setCap(`드래그 X${s.x1},${s.y1} → X${s.x2},${s.y2}`);
      moveCursor(s.x1, s.y1, 300); let r = await wait(c(350)); if (r === 'cancel') return r;
      grab(true); moveCursor(s.x2, s.y2, 500); r = await wait(c(560)); grab(false); return r;
    }
    case 'hotkey': { const lab = stepDesc(s); badge(`⌨ ${lab}`); setCap(`단축키: ${lab}`); return wait(c(850)); }
    case 'text': badge(`⌨ "${(s.text || '').slice(0, 18)}"`); setCap('글자 입력'); return wait(c(900));
    case 'win': badge(`🪟 ${s.title}`); setCap(`창 앞으로: "${s.title}"`); return wait(c(900));
    case 'scroll': badge(`${s.dir === 'up' ? '↑' : '↓'} 스크롤`); setCap(`${s.dir === 'up' ? '위' : '아래'}로 ${s.amount}칸`); return wait(c(800));
    case 'wait': setCap(`${s.sec}초 대기${fast && s.sec * 1000 > 1400 ? ' (빠르게 보는 중)' : ''}`); return wait(c((Number(s.sec) || 0) * 1000));
    default: return wait(200);
  }
}

async function runPreview() {
  const l = activeLoop();
  if (prev.running) { // 이미 돌고 있으면 재생/일시정지 토글
    prev.playing = !prev.playing;
    $('#prev-play').textContent = prev.playing ? '⏸ 일시정지' : '▶ 재생';
    return;
  }
  if (!l.steps.length) { toast('먼저 동작을 추가하세요'); return; }
  prev.running = true; prev.cancel = false; prev.playing = true;
  $('#prev-play').textContent = '⏸ 일시정지';
  const fast = $('#prev-fast').checked;
  resetCursor();

  const done = v => v === 'cancel';
  if (l.startAt) { setCap(`예약 시작: ${l.startAt} — 실제 실행 땐 이 시각까지 기다려요`); if (done(await wait(1100))) return endPreview(); }
  setCap(`시작 전 ${l.delay}초 대기`); if (done(await wait(capMs((Number(l.delay) || 0) * 1000, fast)))) return endPreview();

  const infinite = !(l.repeat && l.repeat > 0);
  const rounds = infinite ? 3 : l.repeat;
  for (let r = 0; r < rounds; r++) {
    if (l.repeat > 1 || infinite) setCap(`${r + 1}바퀴째${infinite ? ' (무한이라 3바퀴만 미리보기)' : ` / ${rounds}`}`);
    for (let i = 0; i < l.steps.length; i++) {
      if (prev.cancel) return endPreview();
      highlight(i);
      if (done(await doStepPreview(l.steps[i], fast))) return endPreview();
      if (done(await wait(capMs((Number(l.gap) || 0) * 1000, fast)))) return endPreview();
    }
  }
  document.querySelectorAll('.pv-chip').forEach(c => c.classList.remove('on'));
  setCap('✅ 미리보기 끝 — 실제 동작 순서가 이대로예요');
  endPreview();
}
function endPreview() { prev.running = false; prev.playing = false; $('#prev-play').textContent = '▶ 재생'; }

$('#preview-btn').onclick = openPreview;
$('#prev-close').onclick = closePreview;
$('#prev-bg').onclick = closePreview;
$('#prev-play').onclick = runPreview;
$('#prev-stop').onclick = () => { prev.cancel = true; prev.playing = false; prev.running = false; $('#prev-play').textContent = '▶ 재생'; resetCursor(); document.querySelectorAll('.pv-chip').forEach(c => c.classList.remove('on')); setCap('정지했어요'); };

/* =========================================================
   내보내기 (실제 매크로 파일 만들기)
   ========================================================= */
function fileName(base, ext) {
  const safe = (base || 'macro').replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ-]+/g, '_').replace(/^_+|_+$/g, '') || 'macro';
  return `${safe}.${ext}`;
}
function download(name, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
function gapMs(l) { return Math.round((Number(l.gap) || 0) * 1000); }
function hhmm(startAt) { return startAt ? Number(startAt.replace(':', '')) : null; }

function ahkStr(s) {
  return String(s == null ? '' : s).replace(/`/g, '``').replace(/"/g, '""').replace(/\r/g, '').replace(/\n/g, '`n').replace(/\t/g, '`t');
}
function buildHotkey(s) {
  if (s.preset && s.preset !== 'custom') {
    const h = HOTKEYS[s.preset];
    return { ahk: h.ahk, py: h.py, sk: h.sk, singlePy: h.py.length === 1 };
  }
  const ahkSym = { ctrl: '^', alt: '!', shift: '+', win: '#' };
  const skSym = { ctrl: '^', alt: '%', shift: '+', win: '' };
  const mods = (s.mods || []);
  let key = (s.key || '').trim();
  const ahk = mods.map(m => ahkSym[m]).join('') + (key.length > 1 ? `{${key}}` : key);
  const sk = mods.map(m => skSym[m]).join('') + (key ? (key.length > 1 ? `{${key.toUpperCase()}}` : key.toLowerCase()) : '');
  const py = [...mods.map(m => m === 'win' ? 'win' : m), key.toLowerCase()].filter(Boolean);
  return { ahk, py, sk, singlePy: py.length === 1 };
}

/* --- AutoHotkey v2 --- */
function genAHK(l) {
  const L = [];
  L.push('#Requires AutoHotkey v2.0', '#SingleInstance Force', 'CoordMode "Mouse", "Screen"',
    'SetTitleMatchMode 2', 'SetKeyDelay 30', 'SetMouseDelay 30', '');
  L.push(`; ===== 매크로: ${(l.name || '').replace(/[\r\n]/g, ' ')} =====`);
  L.push('; 이 파일을 더블클릭하면 시작합니다. (AutoHotkey v2 설치 필요)');
  L.push(`; 단축키:  ${CTRL_KEYS.pauseLabel} = 일시정지/재생    ${CTRL_KEYS.stopLabel} = 종료 (Esc 도 종료)`);
  L.push('');
  L.push('*F8::Pause(-1)   ; 일시정지/재생');
  L.push('*F9::ExitApp     ; 종료');
  L.push('*Esc::ExitApp');
  L.push('');
  const t = hhmm(l.startAt);
  if (t != null) {
    L.push(`; 예약 시작: 오늘 ${l.startAt} 까지 대기 (이미 지났으면 바로 시작)`);
    L.push('Loop {');
    L.push(`    if (FormatTime(A_Now, "HHmm") + 0 >= ${t})`);
    L.push('        break');
    L.push('    Sleep 3000');
    L.push('}');
  }
  L.push(`Sleep ${Math.round((l.delay || 0) * 1000)}   ; 시작 전 대기`);
  L.push((l.repeat && l.repeat > 0) ? `Loop ${l.repeat} {` : 'Loop {   ; 무한 반복');
  const g = gapMs(l);
  l.steps.forEach(s => {
    genAHKStep(s).forEach(x => L.push('    ' + x));
    if (g > 0) L.push(`    Sleep ${g}`);
  });
  L.push('}');
  L.push('MsgBox "매크로가 끝났어요.", "매크로 설계소"');
  return L.join('\r\n') + '\r\n';
}
function genAHKStep(s) {
  switch (s.type) {
    case 'url': return [`Run "${ahkStr(s.url)}"`];
    case 'move': return [`MouseMove ${num(s.x)}, ${num(s.y)}, 10`];
    case 'click': {
      const btn = s.button === 'right' ? 'Right' : s.button === 'middle' ? 'Middle' : '';
      const opt = [num(s.x), num(s.y), btn, s.double ? 2 : ''].filter(v => v !== '').join(' ');
      return [`Click "${opt}"`];
    }
    case 'drag': return [`MouseClickDrag "Left", ${num(s.x1)}, ${num(s.y1)}, ${num(s.x2)}, ${num(s.y2)}, 10`];
    case 'hotkey': return [`Send "${buildHotkey(s).ahk}"`];
    case 'text': return [`SendText "${ahkStr(s.text)}"`];
    case 'win': return [`WinActivate "${ahkStr(s.title)}"`, `WinWaitActive "${ahkStr(s.title)}", , 5`];
    case 'scroll': return [`Loop ${num(s.amount) || 1} {`, `    Send "{Wheel${s.dir === 'up' ? 'Up' : 'Down'}}"`, '    Sleep 40', '}'];
    case 'wait': return [`Sleep ${Math.round((Number(s.sec) || 0) * 1000)}`];
    default: return [];
  }
}

/* --- 실행용 .bat (.ahk 실행) --- */
function genBAT(l, ahkName) {
  return [
    '@echo off', 'chcp 65001 >nul',
    `echo [${(l.name || '매크로').replace(/[\r\n]/g, ' ')}] 를 시작합니다...`,
    `echo 단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료`,
    `start "" "%~dp0${ahkName}"`,
    'if errorlevel 1 (',
    '  echo.',
    '  echo [안내] 먼저 AutoHotkey v2 를 설치해야 .ahk 가 실행됩니다. https://www.autohotkey.com',
    '  pause', ')', '',
  ].join('\r\n');
}

/* --- 무설치 윈도우: PowerShell .ps1 + 실행용 .bat --- */
function psStr(s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; }
function sendKeysText(s) { return String(s == null ? '' : s).replace(/[+^%~(){}\[\]]/g, m => '{' + m + '}'); }

function genPSBat(l, ps1Name) {
  return [
    '@echo off', 'chcp 65001 >nul',
    `echo [${(l.name || '매크로').replace(/[\r\n]/g, ' ')}] 를 시작합니다. (설치 필요 없음)`,
    `echo 단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료`,
    `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0${ps1Name}"`,
    'echo.', 'pause', '',
  ].join('\r\n');
}
function genPS1(l) {
  const P = [];
  P.push('# -*- 매크로: ' + (l.name || '').replace(/[\r\n]/g, ' ') + ' -*-');
  P.push('# 설치가 필요 없습니다. 함께 받은 "...-무설치.bat" 를 더블클릭하세요.');
  P.push(`# 단축키:  ${CTRL_KEYS.pauseLabel} = 일시정지/재생    ${CTRL_KEYS.stopLabel} = 종료`);
  P.push('Add-Type @"');
  P.push('using System; using System.Runtime.InteropServices;');
  P.push('public class U {');
  P.push('  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);');
  P.push('  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,int d,int e);');
  P.push('  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);');
  P.push('  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);');
  P.push('}');
  P.push('"@');
  P.push('Add-Type -AssemblyName System.Windows.Forms');
  P.push('');
  P.push('$script:paused = $false');
  P.push('$script:prevKey = $false');
  P.push('function Pump(){');
  P.push('  $f8 = ([int][U]::GetAsyncKeyState(0x77) -band 0x8000) -ne 0   # F8');
  P.push('  if($f8 -and -not $script:prevKey){ $script:paused = -not $script:paused; Write-Host $(if($script:paused){"|| 일시정지 (F8로 재생)"}else{"> 재생"}) }');
  P.push('  $script:prevKey = $f8');
  P.push('  if(([int][U]::GetAsyncKeyState(0x78) -band 0x8000) -ne 0){ Write-Host "[] 종료"; exit }   # F9');
  P.push('  while($script:paused){');
  P.push('    Start-Sleep -Milliseconds 120');
  P.push('    $f = ([int][U]::GetAsyncKeyState(0x77) -band 0x8000) -ne 0');
  P.push('    if($f -and -not $script:prevKey){ $script:paused = $false; Write-Host "> 재생" }');
  P.push('    $script:prevKey = $f');
  P.push('    if(([int][U]::GetAsyncKeyState(0x78) -band 0x8000) -ne 0){ Write-Host "[] 종료"; exit }');
  P.push('  }');
  P.push('}');
  P.push('function WaitMs($ms){ $end=[Environment]::TickCount+$ms; while([Environment]::TickCount -lt $end){ Pump; Start-Sleep -Milliseconds 80 } }');
  P.push('function Move($x,$y){ [U]::SetCursorPos($x,$y) | Out-Null; Start-Sleep -Milliseconds 60 }');
  P.push('function ClickAt($x,$y,$btn,$double){');
  P.push('  [U]::SetCursorPos($x,$y) | Out-Null; Start-Sleep -Milliseconds 70');
  P.push("  $d = if($btn -eq 'right'){0x08}elseif($btn -eq 'middle'){0x20}else{0x02}");
  P.push("  $u = if($btn -eq 'right'){0x10}elseif($btn -eq 'middle'){0x40}else{0x04}");
  P.push('  $n = if($double){2}else{1}');
  P.push('  for($i=0;$i -lt $n;$i++){ [U]::mouse_event($d,0,0,0,0); [U]::mouse_event($u,0,0,0,0); Start-Sleep -Milliseconds 70 }');
  P.push('}');
  P.push('function Drag($x1,$y1,$x2,$y2){');
  P.push('  [U]::SetCursorPos($x1,$y1) | Out-Null; Start-Sleep -Milliseconds 70');
  P.push('  [U]::mouse_event(0x02,0,0,0,0); Start-Sleep -Milliseconds 80');
  P.push('  [U]::SetCursorPos($x2,$y2) | Out-Null; Start-Sleep -Milliseconds 150');
  P.push('  [U]::mouse_event(0x04,0,0,0,0)');
  P.push('}');
  P.push('function Keys($s){ [System.Windows.Forms.SendKeys]::SendWait($s); Start-Sleep -Milliseconds 90 }');
  P.push('function ActivateWin($title){');
  P.push('  $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$title*" } | Select-Object -First 1');
  P.push('  if($p){ [U]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 400 }');
  P.push('}');
  P.push("function Scroll($dir,$amt){ for($i=0;$i -lt $amt;$i++){ [U]::mouse_event(0x800,0,0,$(if($dir -eq 'up'){120}else{-120}),0); Start-Sleep -Milliseconds 50 } }");
  P.push('function OpenUrl($u){ Start-Process $u }');
  P.push('');
  P.push(`Write-Host "단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료"`);
  const t = hhmm(l.startAt);
  if (t != null) {
    P.push(`# 예약 시작: 오늘 ${l.startAt} 까지 대기 (이미 지났으면 바로 시작)`);
    P.push(`while([int](Get-Date -Format "HHmm") -lt ${t}){ Pump; Start-Sleep -Seconds 3 }`);
  }
  P.push(`WaitMs ${Math.round((l.delay || 0) * 1000)}   # 시작 전 대기`);
  P.push(`$reps = ${l.repeat && l.repeat > 0 ? l.repeat : 0}   # 0 = 무한 반복`);
  P.push('$i = 0');
  P.push('while($reps -eq 0 -or $i -lt $reps){');
  const g = gapMs(l);
  l.steps.forEach(s => {
    P.push('  Pump');
    genPSStep(s).forEach(x => P.push('  ' + x));
    if (g > 0) P.push(`  WaitMs ${g}`);
  });
  P.push('  $i++');
  P.push('}');
  P.push('Write-Host "매크로가 끝났어요."');
  return P.join('\r\n') + '\r\n';
}
function genPSStep(s) {
  switch (s.type) {
    case 'url': return [`OpenUrl ${psStr(s.url)}`];
    case 'move': return [`Move ${num(s.x)} ${num(s.y)}`];
    case 'click': return [`ClickAt ${num(s.x)} ${num(s.y)} '${s.button || 'left'}' $${s.double ? 'true' : 'false'}`];
    case 'drag': return [`Drag ${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)}`];
    case 'hotkey': return [`Keys ${psStr(buildHotkey(s).sk)}`];
    case 'text': return [`Keys ${psStr(sendKeysText(s.text))}`];
    case 'win': return [`ActivateWin ${psStr(s.title)}`];
    case 'scroll': return [`Scroll '${s.dir === 'up' ? 'up' : 'down'}' ${num(s.amount) || 1}`];
    case 'wait': return [`WaitMs ${Math.round((Number(s.sec) || 0) * 1000)}`];
    default: return [];
  }
}

/* --- 파이썬 (pyautogui) --- */
function genPY(l) {
  const P = [];
  P.push('# -*- coding: utf-8 -*-');
  P.push(`# 매크로: ${(l.name || '').replace(/[\r\n]/g, ' ')}`);
  P.push('# 실행: 1) 파이썬 설치  2) pip install pyautogui pygetwindow keyboard  3) python "이파일.py"');
  P.push(`#  단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료 (keyboard 설치 시)`);
  P.push('#  급할 때: 마우스를 화면 왼쪽 맨 위 구석으로 휙 옮기면 멈춥니다.');
  P.push('import time, webbrowser, datetime');
  P.push('try:');
  P.push('    import pyautogui');
  P.push('except ImportError:');
  P.push('    raise SystemExit("먼저:  pip install pyautogui")');
  P.push('try:');
  P.push('    import pygetwindow as gw');
  P.push('except Exception:');
  P.push('    gw = None');
  P.push('pyautogui.FAILSAFE = True');
  P.push('pyautogui.PAUSE = 0.1');
  P.push('_paused = {"v": False}; _stop = {"v": False}');
  P.push('try:');
  P.push('    import keyboard');
  P.push("    keyboard.add_hotkey('f8', lambda: (_paused.__setitem__('v', not _paused['v']), print('|| 일시정지' if _paused['v'] else '> 재생')))");
  P.push("    keyboard.add_hotkey('f9', lambda: _stop.__setitem__('v', True))");
  P.push(`    print("단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료")`);
  P.push('except Exception:');
  P.push('    keyboard = None');
  P.push('    print("(F8/F9 단축키는 pip install keyboard 후 사용 가능. 급할 땐 마우스를 왼쪽 위 구석으로)")');
  P.push('');
  P.push('def control():');
  P.push('    if _stop["v"]: raise SystemExit("종료")');
  P.push('    while _paused["v"]:');
  P.push('        time.sleep(0.12)');
  P.push('        if _stop["v"]: raise SystemExit("종료")');
  P.push('');
  P.push('def activate_window(title):');
  P.push('    if not gw: return');
  P.push('    try:');
  P.push('        for w in gw.getWindowsWithTitle(title):');
  P.push('            w.activate(); time.sleep(0.4); return');
  P.push('    except Exception: pass');
  P.push('');
  P.push('def run():');
  const t = hhmm(l.startAt);
  if (t != null) {
    P.push(`    # 예약 시작: 오늘 ${l.startAt} 까지 대기`);
    P.push(`    while int(datetime.datetime.now().strftime("%H%M")) < ${t}:`);
    P.push('        control(); time.sleep(3)');
  }
  P.push(`    time.sleep(${Number(l.delay) || 0})`);
  const body = [];
  const g = (Number(l.gap) || 0);
  l.steps.forEach(s => {
    body.push('control()');
    genPYStep(s).forEach(x => body.push(x));
    if (g > 0) body.push(`time.sleep(${g})`);
  });
  if (!body.length) body.push('pass');
  if (l.repeat && l.repeat > 0) {
    P.push(`    for _ in range(${l.repeat}):`);
    body.forEach(x => P.push('        ' + x));
  } else {
    P.push('    while True:   # 무한 반복');
    body.forEach(x => P.push('        ' + x));
  }
  P.push('');
  P.push('run()');
  P.push('print("매크로가 끝났어요.")');
  return P.join('\r\n') + '\r\n';
}
function genPYStep(s) {
  const J = v => JSON.stringify(v == null ? '' : v);
  switch (s.type) {
    case 'url': return [`webbrowser.open(${J(s.url)})`];
    case 'move': return [`pyautogui.moveTo(${num(s.x)}, ${num(s.y)}, duration=0.2)`];
    case 'click': {
      const a = [`${num(s.x)}, ${num(s.y)}`];
      if (s.button !== 'left') a.push(`button=${J(s.button)}`);
      if (s.double) a.push('clicks=2');
      return [`pyautogui.click(${a.join(', ')})`];
    }
    case 'drag': return [`pyautogui.moveTo(${num(s.x1)}, ${num(s.y1)}, duration=0.2)`, `pyautogui.dragTo(${num(s.x2)}, ${num(s.y2)}, duration=0.3, button='left')`];
    case 'hotkey': { const h = buildHotkey(s); return h.singlePy ? [`pyautogui.press(${J(h.py[0])})`] : [`pyautogui.hotkey(${h.py.map(J).join(', ')})`]; }
    case 'text': return [`pyautogui.write(${J(s.text)}, interval=0.02)  # 한글은 .ahk 를 쓰세요`];
    case 'win': return [`activate_window(${J(s.title)})`];
    case 'scroll': return [`pyautogui.scroll(${(s.dir === 'up' ? 1 : -1) * (num(s.amount) || 1) * 300})`];
    case 'wait': return [`time.sleep(${Number(s.sec) || 0})`];
    default: return [];
  }
}

/* --- 좌표 찾기 도우미 --- */
function genFinder() {
  return [
    '#Requires AutoHotkey v2.0', '#SingleInstance Force', 'CoordMode "Mouse", "Screen"',
    '; 마우스를 원하는 곳에 올리면 X, Y 숫자가 보입니다. 그 숫자를 매크로에 적으세요.',
    'SetTimer ShowPos, 50', '*Esc::ExitApp',
    'ShowPos() {', '    MouseGetPos &mx, &my',
    '    ToolTip "X = " mx "`nY = " my "`n`n이 숫자를 매크로에 적으세요`nEsc = 끄기"', '}', '',
  ].join('\r\n');
}

function doExport(kind) {
  const l = activeLoop();
  if (kind === 'ahk') {
    const ahkName = fileName(l.name, 'ahk');
    download(ahkName, genAHK(l));
    download(fileName(l.name + '-실행', 'bat'), genBAT(l, ahkName), 'application/bat');
    toast('.ahk 와 .bat 를 받았어요');
  } else if (kind === 'ps') {
    const ps1Name = fileName(l.name, 'ps1');
    download(ps1Name, genPS1(l), 'text/plain;charset=utf-8');
    download(fileName(l.name + '-무설치', 'bat'), genPSBat(l, ps1Name), 'application/bat');
    toast('무설치 실행 파일을 받았어요');
  } else if (kind === 'py') {
    download(fileName(l.name, 'py'), genPY(l), 'text/x-python;charset=utf-8');
    toast('파이썬 파일을 받았어요');
  } else if (kind === 'finder') {
    download('좌표찾기도우미.ahk', genFinder());
    toast('좌표 찾기 도우미를 받았어요');
  } else if (kind === 'backup') {
    download(fileName('매크로설계소-백업', 'json'), JSON.stringify(state, null, 2), 'application/json');
    toast('전체 백업을 저장했어요');
  }
}
document.querySelectorAll('[data-export]').forEach(b => b.onclick = () => doExport(b.dataset.export));

/* 백업 불러오기 */
$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data || !Array.isArray(data.loops)) throw 0;
      state = normalize(data); activeId = state.loops[0].id;
      save(); renderAll(); toast('백업을 불러왔어요');
    } catch { toast('파일을 읽을 수 없어요'); }
  };
  r.readAsText(f);
  e.target.value = '';
};

/* ===== F12 소스 분석 ===== */
$('#analyze-btn').onclick = () => {
  const raw = $('#html-input').value.trim();
  const box = $('#analyze-result');
  if (!raw) { box.innerHTML = '<p class="hint">먼저 소스를 붙여넣어 주세요.</p>'; return; }
  let doc;
  try { doc = new DOMParser().parseFromString(raw, 'text/html'); } catch { box.innerHTML = '<p class="hint">분석할 수 없어요.</p>'; return; }
  const items = [];
  const push = (tag, text) => {
    text = (text || '').replace(/\s+/g, ' ').trim();
    if (text && text.length <= 80 && !items.some(it => it.text === text)) items.push({ tag, text });
  };
  if (doc.title) push('제목', doc.title);
  doc.querySelectorAll('h1,h2,h3').forEach(el => push('헤딩', el.textContent));
  doc.querySelectorAll('button, [role=button], input[type=submit], input[type=button]').forEach(el => push('버튼', el.textContent || el.value));
  doc.querySelectorAll('a').forEach(el => push('링크', el.textContent));
  doc.querySelectorAll('[title]').forEach(el => push('설명', el.getAttribute('title')));

  if (items.length === 0) { box.innerHTML = '<p class="hint">뽑을 글자를 찾지 못했어요.</p>'; return; }
  box.innerHTML = '';
  items.slice(0, 40).forEach(it => {
    const d = document.createElement('div');
    d.className = 'an-item';
    d.innerHTML = `<span class="an-tag">${it.tag}</span><span class="an-text">${escapeHtml(it.text)}</span><button class="an-add">창 찾기+</button>`;
    d.querySelector('.an-add').onclick = () => {
      activeLoop().steps.push({ id: uid(), type: 'win', title: it.text });
      save(); renderSteps(); toast('"창 활성화" 동작을 추가했어요');
    };
    box.appendChild(d);
  });
};

/* ===== 도움말 ===== */
$('#help-btn').onclick = () => { $('#help-body').innerHTML = HELP; showSheet('#help-sheet', '#help-bg'); };
$('#help-close').onclick = () => hideSheet('#help-sheet', '#help-bg');
$('#help-bg').onclick = () => hideSheet('#help-sheet', '#help-bg');

const HELP = `
<div class="warn"><b>웹(설계소) + 실행 파일, 2단 구조</b><br>
이 화면은 <b>순서를 짜고 미리보는 곳</b>이에요. 브라우저는 보안상 다른 프로그램을 직접 못 움직여서,
짠 순서를 <b>PC에서 도는 파일(.ahk/.bat/.ps1/.py)</b>로 내보내 실행하면 그때 실제로 움직입니다.</div>

<h4>추천 순서</h4>
<ol>
<li><b>좌표 찾기 도우미</b>를 받아 PC에서 실행 → 클릭할 위치의 <code>X</code>, <code>Y</code> 숫자를 적어둬요.</li>
<li><b>+ 동작 추가</b>로 순서를 만들어요. (예: 주소 열기 → 대기 → 이동 → 클릭 → 복사 → 창 전환 → 붙여넣기)</li>
<li><b>▶ 미리보기</b>로 순서가 맞는지 눈으로 확인해요. (실제 실행이 아니라 모의 재생)</li>
<li>맞으면 내 PC에 맞는 파일을 받아요(아래).</li>
<li>받은 <b>실행 파일을 더블클릭</b>! 시작 전 대기 동안 원하는 창을 켜 두세요.</li>
</ol>

<h4>실행 중 단축키 (파일 공통)</h4>
<ul>
<li><b>${CTRL_KEYS.pauseLabel}</b> — 일시정지 / 다시 재생</li>
<li><b>${CTRL_KEYS.stopLabel}</b> — 완전 종료 (.ahk 는 Esc 도 종료)</li>
<li>파이썬은 <code>pip install keyboard</code> 후에 단축키가 켜져요.</li>
</ul>

<h4>반복 · 예약 · 텀</h4>
<ul>
<li><b>반복 횟수</b>: 숫자만큼 반복, <b>0</b>이면 멈출 때까지 무한.</li>
<li><b>예약 시작</b>: 시간을 정하면 그 시각까지 기다렸다 시작해요(이미 지난 시각이면 바로 시작).</li>
<li><b>동작 사이 텀</b>: 각 동작 사이에 자동으로 넣는 짧은 간격(기본 0.5초).</li>
</ul>

<h4>어떤 파일을 받나요?</h4>
<ul>
<li><b>무설치(윈도우)</b> — 설치·권한 필요 없음. 잘 모르면 이걸 먼저. <code>...-무설치.bat</code> 더블클릭.</li>
<li><b>.ahk + .bat</b> — <code>autohotkey.com</code>에서 AutoHotkey v2 설치 가능하면 가장 안정적, 한글 입력도 잘 됨.</li>
<li><b>.py</b> — 맥이거나 파이썬 사용 시.</li>
</ul>

<h4>조심할 점</h4>
<ul>
<li>회사 보안 규정을 꼭 확인하세요. 내부 시스템 정보는 이 앱에 넣지 않아도 됩니다(넣지 마세요).</li>
<li>좌표는 해상도·배율이 바뀌면 달라져요. PC가 바뀌면 다시 잡으세요.</li>
<li>처음엔 반복 1회로 확인한 뒤 횟수를 늘리세요.</li>
</ul>
`;

/* ===== 전체 렌더 ===== */
function renderAll() {
  renderChips();
  renderSettings();
  renderSteps();
  addDeleteLoopButton();
}
renderAll();
