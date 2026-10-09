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
  imgclick:{ ico: '🖼️', label: '이미지 찾아 클릭' },
  readput:{ ico: '📋', label: '영역 값 읽어 입력' },
  if:     { ico: '❓', label: '조건 (영역을 읽어 분기)' },
};

/* 이미지 찾기: 관대함(색 허용오차) 단계 */
const TOLS = { 15: '엄격', 25: '보통', 40: '느슨' };

/* 읽어 입력 후 누를 키 */
const AFTERS = { none: '(없음)', enter: '엔터(다음 줄)', tab: '탭(다음 칸)' };

/* 조건 동작: 비교 연산자 */
const OPS_NUM = { gt: '보다 큼 (>)', lt: '보다 작음 (<)', ge: '크거나 같음 (≥)', le: '작거나 같음 (≤)', eq: '같음 (=)', ne: '다름 (≠)' };
const OPS_TEXT = { has: '포함', eq: '같음 (=)', ne: '다름 (≠)' };
/* 조건 결과 행동 */
const ACTS = { continue: '계속 진행', stop: '매크로 멈춤', skip: '다음 N개 동작 건너뛰기' };

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
const CTRL_KEYS = { pauseLabel: 'F8', stopLabel: 'F9', startNowLabel: 'F7' };

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
function toastAction(msg, label, cb) {
  const t = $('#toast');
  t.textContent = '';
  const span = document.createElement('span'); span.textContent = msg;
  const btn = document.createElement('button'); btn.className = 'toast-btn'; btn.textContent = label;
  btn.onclick = () => { t.hidden = true; clearTimeout(t._t); cb(); };
  t.append(span, btn); t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 4500);
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
    case 'imgclick': { const nf = s.notfound === 'skip' ? `${s.skipN || 1}개 건너뜀` : s.notfound === 'continue' ? '계속' : '멈춤'; const btn = s.button === 'right' ? '우' : s.button === 'middle' ? '가운데' : ''; return `이미지 ${s.slot} 찾아 ${s.double ? '더블' : ''}${btn}클릭 (못 찾으면 ${nf})`; }
    case 'readput': return `영역의 ${s.read === 'number' ? '숫자' : '글자'}를 읽어 붙여넣기${s.after && s.after !== 'none' ? ` → ${s.after === 'enter' ? '엔터' : '탭'}` : ''}`;
    case 'if': return condDesc(s);
    default: return '';
  }
}

function condDesc(s) {
  const kind = s.read === 'text' ? '글자' : '숫자';
  const ops = s.read === 'text' ? OPS_TEXT : OPS_NUM;
  const opL = (ops[s.op] || '').replace(/\s*\(.*\)/, '');
  const act = a => a === 'skip' ? `${s.skip || 1}개 건너뜀` : (ACTS[a] || '').replace('매크로 ', '');
  const head = s.src === 'region2'
    ? `두 영역의 ${kind}가 ${opL}`
    : `영역의 ${kind}가 "${s.value}" ${opL}`;
  return `${head} → 맞으면 ${act(s.onTrue)}, 아니면 ${act(s.onFalse)}`;
}

/* 입력이 빠졌는지 검사 (빠진 채 내보내면 엉뚱하게 동작) */
function stepIssue(s) {
  const bad = v => v === '' || v == null || !Number.isFinite(Number(v));
  switch (s.type) {
    case 'url': { const u = (s.url || '').trim(); return (!u || u === 'https://' || u === 'http://') ? '주소를 입력하세요' : null; }
    case 'move': case 'click': return (bad(s.x) || bad(s.y)) ? '좌표(X·Y)를 입력하세요' : null;
    case 'drag': return (bad(s.x1) || bad(s.y1) || bad(s.x2) || bad(s.y2)) ? '시작·끝 좌표를 입력하세요' : null;
    case 'hotkey': return (s.preset === 'custom' && !(s.key || '').trim()) ? '누를 키를 입력하세요' : null;
    case 'text': return (s.text || '') === '' ? '입력할 글자가 비었어요' : null;
    case 'win': return (s.title || '').trim() === '' ? '창 제목을 입력하세요' : null;
    case 'scroll': return (bad(s.amount) || Number(s.amount) < 1) ? '스크롤 칸 수를 입력하세요' : null;
    case 'wait': return (bad(s.sec) || Number(s.sec) < 0) ? '대기 시간을 입력하세요' : null;
    case 'imgclick': return (bad(s.slot) || Number(s.slot) < 1) ? '이미지 슬롯 번호를 정하세요' : null;
    case 'readput': { const r = s.region || {}; return (bad(r.x1) || bad(r.y1) || bad(r.x2) || bad(r.y2)) ? '읽을 영역을 정하세요' : null; }
    case 'if': {
      const r = s.region || {};
      if (bad(r.x1) || bad(r.y1) || bad(r.x2) || bad(r.y2)) return '읽을 영역①을 정하세요';
      if (s.src === 'region2') {
        const r2 = s.region2 || {};
        if (bad(r2.x1) || bad(r2.y1) || bad(r2.x2) || bad(r2.y2)) return '비교할 영역②를 정하세요';
      } else if ((s.value ?? '') === '') return '비교할 값을 입력하세요';
      return null;
    }
    default: return null;
  }
}
function hasIssues(l) { return l.steps.some(stepIssue); }

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
    const issue = stepIssue(s);
    const li = document.createElement('li');
    li.className = 'step' + (issue ? ' warn' : '');
    li.dataset.i = i;
    li.innerHTML = `
      <span class="num">${i + 1}</span>
      <div class="st-main">
        <div class="st-type"><span class="st-ico">${t.ico}</span>${t.label}</div>
        <div class="st-desc">${escapeHtml(stepDesc(s))}</div>
        ${issue ? `<div class="st-issue">⚠ ${escapeHtml(issue)}</div>` : ''}
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

  const n = l.steps.filter(stepIssue).length;
  const w = $('#step-warn');
  if (n) { w.hidden = false; w.textContent = `⚠ 입력이 빠진 동작 ${n}개 — 내보내기 전에 확인하세요`; }
  else w.hidden = true;
}

function stepAction(act, i) {
  const steps = activeLoop().steps;
  if (act === 'del') {
    const removed = steps[i];
    const loopId = activeId;
    steps.splice(i, 1); save(); renderSteps();
    toastAction('동작을 지웠어요', '되돌리기', () => {
      steps.splice(i, 0, removed);
      if (activeId !== loopId && state.loops.some(l => l.id === loopId)) activeId = loopId;
      save(); renderAll();
    });
    return;
  }
  if (act === 'up' && i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; }
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
  $('#sheet-dup').hidden = index == null;
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
    imgclick:{ type, slot: 1, tol: 25, retries: 8, every: 0.7, notfound: 'stop', skipN: 1, button: 'left', double: false },
    readput:{ type, read: 'text', mode: 'screen', region: { x1: 100, y1: 100, x2: 300, y2: 150 }, after: 'tab' },
    if:     { type, read: 'number', mode: 'screen', region: { x1: 100, y1: 100, x2: 300, y2: 150 }, src: 'const', op: 'ge', value: '', mode2: 'screen', region2: { x1: 100, y1: 300, x2: 300, y2: 350 }, onTrue: 'continue', onFalse: 'stop', skip: 1, skipElse: 1 },
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
    case 'imgclick': {
      const nfSel = () => { let h = `<select data-k="notfound">`; for (const [v, lab] of Object.entries(ACTS)) h += `<option value="${v}"${draft.notfound === v ? ' selected' : ''}>${lab}</option>`; return h + '</select>'; };
      return `
        <p class="hint" style="margin-top:0">화면에서 <b>저장해 둔 그림</b>을 찾아 그 자리를 클릭해요. 위치가 바뀌어도 그림으로 찾아갑니다. <b>.ahk</b>가 가장 정확하고 <b>무설치(윈도우)</b>도 돼요(베타). 글자·숫자는 "조건(OCR)"이 더 안정적이에요.</p>
        <div class="field"><span>이미지 슬롯 번호</span><input type="number" data-k="slot" value="${draft.slot}" min="1" inputmode="numeric"></div>
        <p class="hint">PC에서 "이미지 캡처 도우미"를 받아 찾을 버튼/아이콘을 긁으면 <code>template_${draft.slot || 'N'}.png</code> 로 저장돼요. 그 번호를 여기 적어요.</p>
        <div class="field"><span>얼마나 똑같아야 하나(관대함)</span><div class="chk-row" data-group="tol">
          ${chk('tol', 40, '느슨')}${chk('tol', 25, '보통')}${chk('tol', 15, '엄격')}
        </div></div>
        <div class="field"><span>버튼</span><div class="chk-row" data-group="button">
          ${chk('button', 'left', '왼쪽')}${chk('button', 'right', '오른쪽')}${chk('button', 'middle', '가운데')}
        </div></div>
        <div class="field"><div class="chk-row" data-group="double">
          ${chk('double', true, '더블클릭', draft.double === true)}
        </div></div>
        <div class="two">
          <label class="field"><span>몇 초마다 다시 찾기</span><input type="number" data-k="every" value="${draft.every}" min="0.1" step="0.1" inputmode="decimal"></label>
          <label class="field"><span>몇 번까지</span><input type="number" data-k="retries" value="${draft.retries}" min="1" inputmode="numeric"></label>
        </div>
        <div class="field"><span>끝내 못 찾으면</span>${nfSel()}</div>
        ${draft.notfound === 'skip' ? `<label class="field"><span>건너뛸 동작 수</span><input type="number" data-k="skipN" value="${draft.skipN || 1}" min="1" inputmode="numeric"></label>` : ''}
        <p class="hint">캡처한 때와 실행할 때의 <b>화면 해상도·배율(100/125/150%)이 같아야</b> 찾아요. 다르면 다시 캡처하세요.</p>`;
    }
    case 'readput': {
      const r = draft.region || (draft.region = { x1: 100, y1: 100, x2: 300, y2: 150 });
      const cur = draft.mode === 'cursor';
      const rin = (lbl, key) => `<label class="field"><span>${lbl}</span><input type="number" data-k="region.${key}" value="${r[key]}" inputmode="numeric"></label>`;
      return `
        <p class="hint" style="margin-top:0">화면 영역의 글자/숫자를 읽어 <b>지금 커서가 있는 칸에 붙여넣어요</b>(자료수집용). <b>무설치(윈도우)·파이썬</b>에서 동작(베타). .ahk 는 건너뜁니다.</p>
        <div class="field"><span>무엇을 읽나요</span><div class="chk-row" data-group="read">
          ${chk('read', 'text', '글자')}${chk('read', 'number', '숫자만')}
        </div></div>
        <div class="field"><span>영역 기준</span><div class="chk-row" data-group="mode">
          ${chk('mode', 'screen', '화면 좌표')}${chk('mode', 'cursor', '커서 기준')}
        </div></div>
        <div class="two">${rin(cur ? '왼쪽(−/＋)' : '왼쪽 X', 'x1')}${rin(cur ? '위(−/＋)' : '위 Y', 'y1')}</div>
        <div class="two">${rin(cur ? '오른쪽' : '오른쪽 X', 'x2')}${rin(cur ? '아래' : '아래 Y', 'y2')}</div>
        <div class="field"><span>붙여넣은 뒤</span><div class="chk-row" data-group="after">
          ${chk('after', 'none', '없음')}${chk('after', 'enter', '엔터(다음 줄)')}${chk('after', 'tab', '탭(다음 칸)')}
        </div></div>
        <p class="hint">반복과 함께 쓰면 한 줄씩 자동으로 옮겨 적을 수 있어요. 붙여넣기는 클립보드를 사용해 한글도 잘 됩니다.</p>`;
    }
    case 'if': {
      const r = draft.region || (draft.region = { x1: 100, y1: 100, x2: 300, y2: 150 });
      const r2 = draft.region2 || (draft.region2 = { x1: 100, y1: 300, x2: 300, y2: 350 });
      if (!draft.src) draft.src = 'const';
      const cursor = draft.mode === 'cursor', cursor2 = draft.mode2 === 'cursor';
      const ops = draft.read === 'text' ? OPS_TEXT : OPS_NUM;
      if (!ops[draft.op]) draft.op = draft.read === 'text' ? 'has' : 'ge';
      const opSel = (k) => { let h = `<select data-k="${k}">`; for (const [v, lab] of Object.entries(ops)) h += `<option value="${v}"${draft[k] === v ? ' selected' : ''}>${lab}</option>`; return h + '</select>'; };
      const actSel = (k) => { let h = `<select data-k="${k}">`; for (const [v, lab] of Object.entries(ACTS)) h += `<option value="${v}"${draft[k] === v ? ' selected' : ''}>${lab}</option>`; return h + '</select>'; };
      const rin = (regKey, obj, lbl, key) => `<label class="field"><span>${lbl}</span><input type="number" data-k="${regKey}.${key}" value="${obj[key]}" inputmode="numeric"></label>`;
      const regionBlock = (regKey, obj, cur, title) => `
        <div class="field"><span>${title} 기준</span><div class="chk-row" data-group="${regKey === 'region' ? 'mode' : 'mode2'}">
          ${chk(regKey === 'region' ? 'mode' : 'mode2', 'screen', '화면 좌표')}${chk(regKey === 'region' ? 'mode' : 'mode2', 'cursor', '커서 기준')}
        </div></div>
        <div class="two">${rin(regKey, obj, cur ? '왼쪽(−/＋)' : '왼쪽 X', 'x1')}${rin(regKey, obj, cur ? '위(−/＋)' : '위 Y', 'y1')}</div>
        <div class="two">${rin(regKey, obj, cur ? '오른쪽' : '오른쪽 X', 'x2')}${rin(regKey, obj, cur ? '아래' : '아래 Y', 'y2')}</div>`;
      return `
        <p class="hint" style="margin-top:0">화면 영역의 글자/숫자를 읽어 결과에 따라 다르게 진행해요. <b>무설치(윈도우)·파이썬</b>에서 동작(베타). .ahk 는 건너뜁니다.</p>
        <div class="field"><span>무엇을 읽나요</span><div class="chk-row" data-group="read">
          ${chk('read', 'number', '숫자')}${chk('read', 'text', '글자')}
        </div></div>
        <div class="seg-title">영역 ①</div>
        ${regionBlock('region', r, cursor, '영역①')}
        <div class="field"><span>무엇과 비교하나요</span><div class="chk-row" data-group="src">
          ${chk('src', 'const', '고정값')}${chk('src', 'region2', '다른 영역 ②')}
        </div></div>
        <div class="field"><span>비교</span>
          ${draft.src === 'region2'
            ? `<label class="field">${opSel('op')}</label>`
            : `<div class="two"><label class="field">${opSel('op')}</label><label class="field"><input type="text" data-k="value" value="${escapeHtml(String(draft.value ?? ''))}" placeholder="${draft.read === 'text' ? '예: 완료' : '예: 0'}" autocomplete="off"></label></div>`}
        </div>
        ${draft.src === 'region2' ? `<div class="seg-title">영역 ②</div>${regionBlock('region2', r2, cursor2, '영역②')}
        <p class="hint">두 영역을 각각 읽어 ${draft.read === 'text' ? '글자' : '숫자'}로 비교해요. 글꼴·배율이 달라도 숫자는 숫자로, 글자는 앞뒤 공백을 지우고 비교합니다(완전히 똑같진 않을 수 있어요).</p>` : `<p class="hint">"영역 선택 도우미"로 F1·F2를 눌러 영역 좌표를 쉽게 구할 수 있어요.</p>`}
        <div class="field"><span>조건이 맞으면</span>${actSel('onTrue')}</div>
        ${draft.onTrue === 'skip' ? `<label class="field"><span>건너뛸 동작 수</span><input type="number" data-k="skip" value="${draft.skip || 1}" min="1" inputmode="numeric"></label>` : ''}
        <div class="field"><span>아니면</span>${actSel('onFalse')}</div>
        ${draft.onFalse === 'skip' ? `<label class="field"><span>건너뛸 동작 수</span><input type="number" data-k="skipElse" value="${draft.skipElse || 1}" min="1" inputmode="numeric"></label>` : ''}`;
    }
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
      const v = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      if (k.includes('.')) { const [a, b] = k.split('.'); (draft[a] = draft[a] || {})[b] = v; }
      else draft[k] = v;
      if (['preset', 'onTrue', 'onFalse', 'notfound'].includes(k)) renderSheetBody();
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
      else {
        draft[g] = val;
        if (g === 'read') draft.op = (val === 'text' ? 'has' : 'ge');
        if (g === 'src' && val === 'region2') draft.op = 'eq';
      }
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
$('#sheet-dup').onclick = () => {
  if (editingIndex == null) return;
  const l = activeLoop();
  l.steps[editingIndex] = draft;                       // 현재 수정 내용 반영
  const copy = JSON.parse(JSON.stringify(draft)); copy.id = uid();
  l.steps.splice(editingIndex + 1, 0, copy);           // 바로 아래에 복제본
  save(); renderSteps(); hideSheet('#sheet', '#sheet-bg'); toast('동작을 복제했어요');
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
  row.innerHTML = `<button class="mini ghost" id="dup-loop">루프 복제</button><button class="mini ghost danger" id="del-loop" style="margin-left:auto">이 루프 삭제</button>`;
  sec.appendChild(row);
  $('#dup-loop').onclick = () => {
    const src = activeLoop();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid(); copy.name = src.name + ' 복사';
    copy.steps.forEach(s => s.id = uid());
    state.loops.push(copy); activeId = copy.id; save(); renderAll(); toast('루프를 복제했어요');
  };
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

const RES = [[1920, 1080, 'FHD'], [1366, 768, '노트북'], [2560, 1440, 'QHD'], [1440, 900, '맥북'], [1280, 720, 'HD'], [3840, 2160, '4K']];
function curScreenKey() { return `${state.screen.w}x${state.screen.h}`; }
function isPresetScreen() { return RES.some(([w, h]) => `${w}x${h}` === curScreenKey()); }
function screenOptions() { return RES.map(([w, h, n]) => `<option value="${w}x${h}">${w}×${h} (${n})</option>`).join('') + '<option value="custom">직접 입력…</option>'; }
function applyRes() { const el = $('#prev-screen'); if (el) el.style.aspectRatio = `${state.screen.w} / ${state.screen.h}`; }

function renderScreenUI() {
  const key = curScreenKey(), preset = isPresetScreen();
  ['#screen-sel', '#prev-res'].forEach(id => { const el = $(id); if (!el) return; el.innerHTML = screenOptions(); el.value = preset ? key : 'custom'; });
  const custom = $('#screen-custom');
  if (custom) {
    custom.hidden = preset;
    const w = $('#screen-w'), h = $('#screen-h');
    if (w && document.activeElement !== w) w.value = state.screen.w;
    if (h && document.activeElement !== h) h.value = state.screen.h;
  }
  applyRes();
}
function setScreen(w, h) { if (w > 0 && h > 0) { state.screen = { w: Math.round(w), h: Math.round(h) }; save(); renderScreenUI(); } }
function initScreenControls() {
  renderScreenUI();
  const onSel = e => {
    const v = e.target.value;
    if (v === 'custom') { const c = $('#screen-custom'); if (c) c.hidden = false; ['#screen-sel', '#prev-res'].forEach(id => { const el = $(id); if (el) el.value = 'custom'; }); }
    else { const [w, h] = v.split('x').map(Number); setScreen(w, h); }
  };
  ['#screen-sel', '#prev-res'].forEach(id => { const el = $(id); if (el) el.onchange = onSel; });
  const cw = $('#screen-w'), ch = $('#screen-h');
  if (cw && ch) { const upd = () => setScreen(Number(cw.value) || state.screen.w, Number(ch.value) || state.screen.h); cw.oninput = upd; ch.oninput = upd; }
}

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
  c.classList.remove('down'); hideBadge(); hideRegions();
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
    case 'imgclick': {
      hideRegions(); badge(`🖼️ 이미지 ${s.slot} 찾기`); setCap(stepDesc(s));
      moveCursor(state.screen.w * 0.5, state.screen.h * 0.45, 400); let r = await wait(c(600)); if (r === 'cancel') return r;
      pulse(s.button, s.double); return wait(c(500));
    }
    case 'readput': { drawRegion('prev-region', s.mode, s.region || {}, 'r1'); hideOne('prev-region2'); badge('📋 읽어 입력'); setCap(stepDesc(s)); const r = await wait(c(1300)); hideRegions(); return r; }
    case 'if': { showRegions(s); badge(s.src === 'region2' ? '❓ 두 영역 비교' : '❓ 영역을 읽어 분기'); setCap(condDesc(s)); const r = await wait(c(1600)); hideRegions(); return r; }
    default: return wait(200);
  }
}
function drawRegion(id, mode, r, cls) {
  const box = $('#prev-screen'); let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.className = 'pv-region ' + cls; box.appendChild(el); }
  const W = Math.abs((r.x2 - r.x1) / state.screen.w) * 100, H = Math.abs((r.y2 - r.y1) / state.screen.h) * 100;
  let L = Math.min(r.x1, r.x2) / state.screen.w * 100, T = Math.min(r.y1, r.y2) / state.screen.h * 100;
  if (mode === 'cursor') { const c = $('#prev-cursor'); L = (parseFloat(c.style.left) || 50) + L; T = (parseFloat(c.style.top) || 50) + T; }
  el.style.left = Math.max(0, L) + '%'; el.style.top = Math.max(0, T) + '%';
  el.style.width = Math.max(2, W) + '%'; el.style.height = Math.max(2, H) + '%'; el.hidden = false;
}
function showRegions(s) {
  drawRegion('prev-region', s.mode, s.region || {}, 'r1');
  if (s.src === 'region2') drawRegion('prev-region2', s.mode2, s.region2 || {}, 'r2'); else hideOne('prev-region2');
}
function hideOne(id) { const el = document.getElementById(id); if (el) el.hidden = true; }
function hideRegions() { hideOne('prev-region'); hideOne('prev-region2'); }

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
  if (l.startAt) { setCap(`예약: 다음 ${l.startAt} 까지 대기 (실행 중 F7로 즉시 시작)`); if (done(await wait(1100))) return endPreview(); }
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
function numConst(v) { return Number(String(v == null ? '' : v).replace(/,/g, '')) || 0; }
function hhmm(startAt) { return startAt ? Number(startAt.replace(':', '')) : null; }
function hhmmParts(startAt) { if (!startAt) return null; const [hh, mm] = startAt.split(':'); return { hh: String(Number(hh)), mm: String(Number(mm)), pad: `${hh}${mm}00` }; }

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
    'CoordMode "Pixel", "Screen"', 'SetTitleMatchMode 2', 'SetKeyDelay 30', 'SetMouseDelay 30', '');
  L.push(`; ===== 매크로: ${(l.name || '').replace(/[\r\n]/g, ' ')} =====`);
  L.push('; 이 파일을 더블클릭하면 시작합니다. (AutoHotkey v2 설치 필요)');
  L.push(`; 단축키:  ${CTRL_KEYS.pauseLabel} = 일시정지/재생    ${CTRL_KEYS.stopLabel} = 종료 (Esc 도 종료)    ${CTRL_KEYS.startNowLabel} = 예약 기다리지 않고 즉시 시작`);
  L.push('');
  L.push('*F8::Pause(-1)   ; 일시정지/재생');
  L.push('*F9::ExitApp     ; 종료');
  L.push('*Esc::ExitApp');
  L.push('');
  const p = hhmmParts(l.startAt);
  if (p) {
    L.push(`; 예약 시작: 다음 ${l.startAt} 까지 대기 (${CTRL_KEYS.startNowLabel} 누르면 즉시 시작)`);
    L.push(`target := FormatTime(A_Now, "yyyyMMdd") . "${p.pad}"`);
    L.push('if (target <= A_Now)');
    L.push('    target := DateAdd(target, 1, "Days")');
    L.push('while (A_Now < target) {');
    L.push(`    if GetKeyState("${CTRL_KEYS.startNowLabel}", "P")`);
    L.push('        break');
    L.push('    Sleep 1000');
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
    case 'url': return [`try Run "${ahkStr(s.url)}"`];
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
    case 'imgclick': return genAHKImg(s);
    case 'readput': return ['; [영역 값 읽어 입력] 은 .ahk 에서 지원되지 않아 건너뜁니다 — "무설치(윈도우)" 또는 파이썬으로 내보내세요.'];
    case 'if': return ['; [조건] 동작은 .ahk 에서 지원되지 않아 건너뜁니다 — "무설치(윈도우)" 또는 파이썬으로 내보내세요.'];
    default: return [];
  }
}

function genAHKImg(s) {
  const slot = num(s.slot) || 1, tol = num(s.tol) || 25;
  const retries = Math.max(1, num(s.retries) || 8), everyMs = Math.round((Number(s.every) || 0.7) * 1000);
  const btn = s.button === 'right' ? 'Right' : s.button === 'middle' ? 'Middle' : '';
  const clickOpt = [btn, s.double ? 2 : ''].filter(v => v !== '').join(' ');
  const L = [];
  L.push(`img := A_ScriptDir "\\images\\template_${slot}.png"`);
  L.push('vx := SysGet(76), vy := SysGet(77), vw := SysGet(78), vh := SysGet(79)');
  L.push('iw := 0, ih := 0, hbm := LoadPicture(img, "", &pt)');
  L.push('if hbm {');
  L.push('    oi := Buffer(32, 0)');
  L.push('    if DllCall("GetObject", "ptr", hbm, "int", 32, "ptr", oi)');
  L.push('        iw := NumGet(oi, 4, "int"), ih := NumGet(oi, 8, "int")');
  L.push('    DllCall("DeleteObject", "ptr", hbm)');
  L.push('}');
  L.push('fx := 0, fy := 0, found := false');
  L.push(`deadline := A_TickCount + ${retries * everyMs}`);
  L.push('Loop {');
  L.push(`    try hit := ImageSearch(&fx, &fy, vx, vy, vx + vw, vy + vh, "*${tol} " img)`);
  L.push('    catch {');
  L.push('        MsgBox "이미지 파일을 못 읽었어요:`n" img, "매크로 설계소"');
  L.push('        break');
  L.push('    }');
  L.push('    if hit {');
  L.push('        found := true');
  L.push('        break');
  L.push('    }');
  L.push('    if (A_TickCount > deadline)');
  L.push('        break');
  L.push(`    Sleep ${everyMs}`);
  L.push('}');
  L.push('if found {');
  L.push('    cx := fx + (iw // 2), cy := fy + (ih // 2)');
  L.push(clickOpt ? `    Click cx " " cy " ${clickOpt}"` : '    Click cx " " cy');
  L.push('}');
  if (s.notfound === 'stop') { L.push('else'); L.push('    ExitApp   ; 못 찾으면 멈춤'); }
  else L.push('; 못 찾으면 다음 동작으로 진행 (.ahk 는 "건너뛰기 N"을 계속 진행으로 처리해요)');
  return L;
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
  P.push('  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);');
  P.push('}');
  P.push('public struct POINT { public int X; public int Y; }');
  P.push('"@');
  P.push('Add-Type -AssemblyName System.Windows.Forms');
  P.push('Add-Type -AssemblyName System.Drawing');
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
  const hasOcr = l.steps.some(s => s.type === 'if' || s.type === 'readput');
  if (hasOcr) P.push(...psOcrFuncs());
  const hasImg = l.steps.some(s => s.type === 'imgclick');
  if (hasImg) P.push(...psImgFuncs());
  P.push('');
  P.push(`Write-Host "단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료"`);
  const p = hhmmParts(l.startAt);
  if (p) {
    P.push(`# 예약 시작: 다음 ${l.startAt} 까지 대기 (${CTRL_KEYS.startNowLabel} 즉시 시작)`);
    P.push(`$target = (Get-Date).Date.AddHours(${p.hh}).AddMinutes(${p.mm})`);
    P.push('if($target -le (Get-Date)){ $target = $target.AddDays(1) }');
    P.push('Write-Host "예약: $target 까지 대기"');
    P.push('while((Get-Date) -lt $target){');
    P.push(`  if(([int][U]::GetAsyncKeyState(0x76) -band 0x8000) -ne 0){ break }   # ${CTRL_KEYS.startNowLabel}`);
    P.push('  Pump; Start-Sleep -Seconds 1');
    P.push('}');
  }
  P.push(`WaitMs ${Math.round((l.delay || 0) * 1000)}   # 시작 전 대기`);
  P.push(`$reps = ${l.repeat && l.repeat > 0 ? l.repeat : 0}   # 0 = 무한 반복`);
  P.push('$i = 0; $skip = 0');
  P.push('while($reps -eq 0 -or $i -lt $reps){');
  P.push('  $skip = 0');
  const g = gapMs(l);
  l.steps.forEach(s => {
    P.push('  Pump');
    P.push('  if($skip -gt 0){ $skip-- } else {');
    genPSStep(s).forEach(x => P.push('    ' + x));
    if (g > 0) P.push(`    WaitMs ${g}`);
    P.push('  }');
  });
  P.push('  $i++');
  P.push('}');
  P.push('Write-Host "매크로가 끝났어요."');
  return P.join('\r\n') + '\r\n';
}
function psOcrFuncs() {
  return [
    '# ===== 조건용: 화면 영역을 읽는 OCR (윈도우 10/11 내장) =====',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '$script:ocrReady = $false',
    'try {',
    '  $null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]',
    '  $null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]',
    '  $null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]',
    "  $script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    '  $script:ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
    '  $script:ocrReady = ($null -ne $script:ocr)',
    '} catch { $script:ocrReady = $false }',
    'if(-not $script:ocrReady){ Write-Host "[주의] 이 PC에서 화면 글자 읽기(OCR)를 쓸 수 없어 조건은 건너뜁니다." }',
    'function Await($op,$t){ $m=$script:asTaskGeneric.MakeGenericMethod($t); $net=$m.Invoke($null,@($op)); $net.Wait(-1)|Out-Null; $net.Result }',
    'function ReadRegion($x1,$y1,$x2,$y2){',
    '  if(-not $script:ocrReady){ return "" }',
    '  $w=[Math]::Abs($x2-$x1); $h=[Math]::Abs($y2-$y1); if($w -lt 1 -or $h -lt 1){ return "" }',
    '  $lx=[Math]::Min($x1,$x2); $ly=[Math]::Min($y1,$y2)',
    '  $bmp=New-Object System.Drawing.Bitmap $w,$h',
    '  $g=[System.Drawing.Graphics]::FromImage($bmp)',
    '  $g.CopyFromScreen($lx,$ly,0,0,(New-Object System.Drawing.Size $w,$h)); $g.Dispose()',
    '  $ms=New-Object System.IO.MemoryStream',
    '  $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $ms.Position=0',
    '  try {',
    '    $ras=[System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)',
    '    $dec=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])',
    '    $sb=Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
    '    $res=Await ($script:ocr.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])',
    '    return $res.Text',
    '  } catch { return "" } finally { $ms.Dispose() }',
    '}',
    "function ReadNumber($txt){ $m=[regex]::Match($txt,'-?\\d[\\d,]*(\\.\\d+)?'); if($m.Success){ return [double]($m.Value -replace ',','') } else { return $null } }",
    'function TextCmp($a,$b,$op){ $x="$a".Trim(); $y="$b".Trim(); if($op -eq "has"){ return $x.Contains($y) } elseif($op -eq "ne"){ return ($x -ne $y) } else { return ($x -eq $y) } }',
    'function CursorXY(){ $pt=New-Object POINT; [U]::GetCursorPos([ref]$pt)|Out-Null; return @($pt.X,$pt.Y) }',
  ];
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
    case 'imgclick': return genPSImg(s);
    case 'readput': return genPSReadPut(s);
    case 'if': return genPSCond(s);
    default: return [];
  }
}
function genPSImg(s) {
  const slot = num(s.slot) || 1, tol = num(s.tol) || 25;
  const retries = Math.max(1, num(s.retries) || 8), everyMs = Math.round((Number(s.every) || 0.7) * 1000);
  const btn = s.button || 'left', dbl = s.double ? '$true' : '$false';
  const L = [`$ok = FindClick ${slot} ${tol} ${retries} ${everyMs} '${btn}' ${dbl}`];
  if (s.notfound === 'stop') L.push('if(-not $ok){ exit }');
  else if (s.notfound === 'skip') L.push(`if(-not $ok){ $skip = ${Math.max(1, num(s.skipN) || 1)} }`);
  return L;
}
function psImgFuncs() {
  return [
    '# ===== 이미지 찾아 클릭: 화면에서 PNG 템플릿 찾기 (베타) =====',
    'try {',
    '  Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms -TypeDefinition @"',
    'using System; using System.Drawing; using System.Drawing.Imaging; using System.Windows.Forms; using System.Runtime.InteropServices;',
    'public class Img {',
    '  public static int[] Find(string path, int tol, int step) {',
    '    int[] res = new int[] { -1, -1 };',
    '    Bitmap tpl = new Bitmap(path);',
    '    Rectangle vs = SystemInformation.VirtualScreen;',
    '    Bitmap scr = new Bitmap(vs.Width, vs.Height, PixelFormat.Format32bppArgb);',
    '    using (Graphics g = Graphics.FromImage(scr)) { g.CopyFromScreen(vs.Left, vs.Top, 0, 0, scr.Size); }',
    '    int tw = tpl.Width, th = tpl.Height, sw = scr.Width, sh = scr.Height;',
    '    if (tw > sw || th > sh) { scr.Dispose(); tpl.Dispose(); return res; }',
    '    BitmapData sd = scr.LockBits(new Rectangle(0,0,sw,sh), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);',
    '    BitmapData dd = tpl.LockBits(new Rectangle(0,0,tw,th), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);',
    '    int ss = sd.Stride, ts = dd.Stride;',
    '    byte[] sb = new byte[ss*sh]; byte[] tb = new byte[ts*th];',
    '    Marshal.Copy(sd.Scan0, sb, 0, sb.Length); Marshal.Copy(dd.Scan0, tb, 0, tb.Length);',
    '    scr.UnlockBits(sd); tpl.UnlockBits(dd);',
    '    int fx = -1, fy = -1;',
    '    for (int y = 0; y <= sh - th && fx < 0; y++) {',
    '      for (int x = 0; x <= sw - tw; x++) {',
    '        bool ok = true;',
    '        for (int ty = 0; ty < th && ok; ty += step) {',
    '          int sr = (y+ty)*ss, tr = ty*ts;',
    '          for (int tx = 0; tx < tw; tx += step) {',
    '            int si = sr + (x+tx)*4, ti = tr + tx*4;',
    '            if (Math.Abs(sb[si]-tb[ti]) > tol || Math.Abs(sb[si+1]-tb[ti+1]) > tol || Math.Abs(sb[si+2]-tb[ti+2]) > tol) { ok = false; break; }',
    '          }',
    '        }',
    '        if (ok) { fx = x; fy = y; break; }',
    '      }',
    '    }',
    '    scr.Dispose(); tpl.Dispose();',
    '    if (fx >= 0) { res[0] = vs.Left + fx + tw/2; res[1] = vs.Top + fy + th/2; }',
    '    return res;',
    '  }',
    '}',
    '"@',
    '  $script:imgReady = $true',
    '} catch { $script:imgReady = $false; Write-Host "[주의] 이미지 찾기 기능을 쓸 수 없어요(이 PC에서 지원 안 됨)." }',
    'function FindClick($slot, $tol, $retries, $everyMs, $btn, $double) {',
    '  $path = Join-Path $PSScriptRoot ("images\\template_" + $slot + ".png")',
    '  if(-not (Test-Path $path)){ Write-Host "[주의] 이미지 파일이 없어요: $path"; return $false }',
    '  if(-not $script:imgReady){ return $false }',
    '  for($k = 0; $k -lt $retries; $k++){',
    '    Pump',
    '    $r = [Img]::Find($path, $tol, 2)',
    '    if($r[0] -ge 0){ ClickAt $r[0] $r[1] $btn $double; return $true }',
    '    WaitMs $everyMs',
    '  }',
    '  Write-Host "[주의] 화면에서 이미지를 못 찾았어요: $path"',
    '  return $false',
    '}',
  ];
}
function genPSReadPut(s) {
  const L = psReadRegion('$txt', s.mode, s.region || {});
  if (s.read === 'number') L.push('$n = ReadNumber $txt; $val = if($null -ne $n){ [string]$n } else { "" }');
  else L.push('$val = "$txt".Trim()');
  const lines = [`if($val -ne ""){ Set-Clipboard -Value $val; Start-Sleep -Milliseconds 90; Keys "^v"`];
  if (s.after === 'enter') lines[0] += '; Keys "{ENTER}"';
  else if (s.after === 'tab') lines[0] += '; Keys "{TAB}"';
  lines[0] += ' }';
  return L.concat(lines);
}
function psAct(a, n) { return a === 'stop' ? 'exit' : a === 'skip' ? `$skip = ${Math.max(1, num(n) || 1)}` : '$null = $null'; }
function psReadRegion(dest, mode, r) {
  if (mode === 'cursor') return [`$c = CursorXY`, `${dest} = ReadRegion ($c[0] + (${num(r.x1)})) ($c[1] + (${num(r.y1)})) ($c[0] + (${num(r.x2)})) ($c[1] + (${num(r.y2)}))`];
  return [`${dest} = ReadRegion ${num(r.x1)} ${num(r.y1)} ${num(r.x2)} ${num(r.y2)}`];
}
function genPSCond(s) {
  const L = [];
  const two = s.src === 'region2';
  L.push(...psReadRegion('$txt', s.mode, s.region || {}));
  L.push('Write-Host "조건 영역 값: $txt"');
  if (two) { L.push(...psReadRegion('$txt2', s.mode2, s.region2 || {})); L.push('Write-Host "조건 영역2 값: $txt2"'); }
  if (s.read === 'text') {
    const right = two ? '$txt2' : psStr(s.value);
    L.push(`$cond = TextCmp $txt ${right} ${psStr(s.op)}`);
  } else {
    const op = { gt: '-gt', lt: '-lt', ge: '-ge', le: '-le', eq: '-eq', ne: '-ne' }[s.op] || '-ge';
    L.push('$v = ReadNumber $txt');
    if (two) { L.push('$v2 = ReadNumber $txt2'); L.push(`$cond = ($null -ne $v) -and ($null -ne $v2) -and ($v ${op} $v2)`); }
    else L.push(`$cond = ($null -ne $v) -and ($v ${op} ${numConst(s.value)})`);
  }
  L.push(`if($cond){ ${psAct(s.onTrue, s.skip)} } else { ${psAct(s.onFalse, s.skipElse)} }`);
  return L;
}

/* --- 파이썬 (pyautogui) --- */
function genPY(l) {
  const P = [];
  P.push('# -*- coding: utf-8 -*-');
  P.push(`# 매크로: ${(l.name || '').replace(/[\r\n]/g, ' ')}`);
  P.push('# 실행: 1) 파이썬 설치  2) pip install pyautogui pygetwindow keyboard  3) python "이파일.py"');
  P.push('#  (조건·읽어입력:  pip install winocr pillow pyperclip  / 이미지 찾기:  pip install opencv-python )');
  P.push(`#  단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료, ${CTRL_KEYS.startNowLabel} 예약 즉시시작 (keyboard 설치 시)`);
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
  P.push('_paused = {"v": False}; _stop = {"v": False}; skip = [0]');
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
  const hasOcr = l.steps.some(s => s.type === 'if' || s.type === 'readput');
  if (hasOcr) P.push(...pyOcrFuncs());
  const hasImg = l.steps.some(s => s.type === 'imgclick');
  if (hasImg) P.push(...pyImgFuncs());
  P.push('');
  P.push('def run():');
  const p = hhmmParts(l.startAt);
  if (p) {
    P.push(`    # 예약 시작: 다음 ${l.startAt} 까지 대기 (${CTRL_KEYS.startNowLabel} 즉시 시작)`);
    P.push('    _now = datetime.datetime.now()');
    P.push(`    _target = _now.replace(hour=${p.hh}, minute=${p.mm}, second=0, microsecond=0)`);
    P.push('    if _target <= _now: _target += datetime.timedelta(days=1)');
    P.push('    print("예약:", _target, "까지 대기")');
    P.push('    while datetime.datetime.now() < _target:');
    P.push('        control()');
    P.push("        if keyboard and keyboard.is_pressed('f7'): break");
    P.push('        time.sleep(1)');
  }
  P.push(`    time.sleep(${Number(l.delay) || 0})`);
  const g = (Number(l.gap) || 0);
  const iter = ['skip[0] = 0'];
  l.steps.forEach(s => {
    iter.push('control()');
    iter.push('if skip[0] > 0:');
    iter.push('    skip[0] -= 1');
    iter.push('else:');
    genPYStep(s).forEach(x => iter.push('    ' + x));
    if (g > 0) iter.push(`    time.sleep(${g})`);
  });
  if (l.repeat && l.repeat > 0) P.push(`    for _ in range(${l.repeat}):`);
  else P.push('    while True:   # 무한 반복');
  iter.forEach(x => P.push('        ' + x));
  P.push('');
  P.push('run()');
  P.push('print("매크로가 끝났어요.")');
  return P.join('\r\n') + '\r\n';
}
function pyOcrFuncs() {
  return [
    '', 'import re',
    '# ===== 조건용: 화면 영역 글자 읽기(OCR) =====',
    'try:',
    '    import winocr',
    '    from PIL import ImageGrab',
    '    _ocr = True',
    'except Exception:',
    '    _ocr = False',
    '    print("(조건 기능엔  pip install winocr pillow  필요. 없으면 조건은 건너뜁니다)")',
    'def read_region(x1, y1, x2, y2):',
    '    if not _ocr: return ""',
    '    try:',
    '        img = ImageGrab.grab(bbox=(min(x1,x2), min(y1,y2), max(x1,x2), max(y1,y2)))',
    '        r = winocr.recognize_pil_sync(img)',
    '        return getattr(r, "text", None) or (r.get("text", "") if hasattr(r, "get") else "")',
    '    except Exception:',
    '        return ""',
    'def read_number(txt):',
    "    m = re.search(r'-?\\d[\\d,]*(\\.\\d+)?', txt)",
    "    return float(m.group().replace(',', '')) if m else None",
    'def text_cond(a, b, op):',
    '    a = (a or "").strip(); b = (b or "").strip()',
    "    if op == 'has': return b in a",
    "    if op == 'ne': return a != b",
    '    return a == b',
    'def set_clip(s):',
    '    try:',
    '        import pyperclip; pyperclip.copy(s); return True',
    '    except Exception: pass',
    '    try:',
    "        import subprocess; subprocess.run('clip', input=s, text=True, shell=True); return True",
    '    except Exception:',
    '        return False',
  ];
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
    case 'imgclick': return genPYImg(s);
    case 'readput': return genPYReadPut(s);
    case 'if': return genPYCond(s);
    default: return [];
  }
}
function genPYImg(s) {
  const slot = num(s.slot) || 1, retries = Math.max(1, num(s.retries) || 8), every = Number(s.every) || 0.7;
  const conf = { 40: 0.7, 25: 0.8, 15: 0.9 }[num(s.tol)] || 0.8;
  const btn = JSON.stringify(s.button || 'left'), dbl = s.double ? 'True' : 'False';
  const L = [`_ok = find_click(${slot}, ${conf}, ${retries}, ${every}, button=${btn}, double=${dbl})`];
  if (s.notfound === 'stop') L.push('if not _ok: raise SystemExit("이미지 못 찾음: 멈춤")');
  else if (s.notfound === 'skip') L.push(`if not _ok: skip[0] = ${Math.max(1, num(s.skipN) || 1)}`);
  return L;
}
function pyImgFuncs() {
  return [
    '', '# ===== 이미지 찾아 클릭 (opencv 필요, 베타) =====',
    'try:',
    '    import cv2  # opencv-python',
    '    _imgcv = True',
    'except Exception:',
    '    _imgcv = False',
    '    print("(이미지 찾기엔  pip install opencv-python  필요. 없으면 이 동작은 건너뜁니다)")',
    'def find_click(slot, conf, retries, every, button="left", double=False):',
    '    import os',
    '    if not _imgcv: return False',
    '    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images", "template_%d.png" % slot)',
    '    if not os.path.exists(path):',
    '        print("[주의] 이미지 파일이 없어요:", path); return False',
    '    for _ in range(retries):',
    '        control()',
    '        try:',
    '            pt = pyautogui.locateCenterOnScreen(path, confidence=conf, grayscale=True)',
    '        except Exception:',
    '            pt = None',
    '        if pt:',
    '            pyautogui.click(pt.x, pt.y, button=button, clicks=(2 if double else 1))',
    '            return True',
    '        time.sleep(every)',
    '    print("[주의] 화면에서 이미지를 못 찾았어요:", path)',
    '    return False',
  ];
}
function genPYReadPut(s) {
  const a = pyRegionArgs(s.mode, s.region || {}); const L = [...a.pre];
  L.push(`_t = read_region(${a.args})`);
  if (s.read === 'number') L.push('_n = read_number(_t); _val = "" if _n is None else (str(int(_n)) if float(_n).is_integer() else str(_n))');
  else L.push('_val = (_t or "").strip()');
  L.push('if _val:');
  L.push('    if set_clip(_val):');
  L.push("        time.sleep(0.09); pyautogui.hotkey('ctrl', 'v')");
  L.push('    else:');
  L.push('        pyautogui.write(_val, interval=0.02)');
  if (s.after === 'enter') L.push("    pyautogui.press('enter')");
  else if (s.after === 'tab') L.push("    pyautogui.press('tab')");
  return L;
}
function pyAct(a, n) { return a === 'stop' ? 'raise SystemExit("조건: 멈춤")' : a === 'skip' ? `skip[0] = ${Math.max(1, num(n) || 1)}` : 'pass'; }
function pyRegionArgs(mode, r) {
  if (mode === 'cursor') return { pre: ['_cx, _cy = pyautogui.position()'], args: `_cx + ${num(r.x1)}, _cy + ${num(r.y1)}, _cx + ${num(r.x2)}, _cy + ${num(r.y2)}` };
  return { pre: [], args: `${num(r.x1)}, ${num(r.y1)}, ${num(r.x2)}, ${num(r.y2)}` };
}
function genPYCond(s) {
  const J = v => JSON.stringify(v == null ? '' : v);
  const two = s.src === 'region2'; const L = [];
  const a = pyRegionArgs(s.mode, s.region || {}); L.push(...a.pre);
  L.push(`_t = read_region(${a.args})`);
  L.push('print("조건 영역 값:", _t)');
  if (two) { const b = pyRegionArgs(s.mode2, s.region2 || {}); L.push(...b.pre); L.push(`_t2 = read_region(${b.args})`); L.push('print("조건 영역2 값:", _t2)'); }
  if (s.read === 'text') {
    const right = two ? '_t2' : J(s.value);
    L.push(`_cond = text_cond(_t, ${right}, ${J(s.op)})`);
  } else {
    const op = { gt: '>', lt: '<', ge: '>=', le: '<=', eq: '==', ne: '!=' }[s.op] || '>=';
    L.push('_v = read_number(_t)');
    if (two) { L.push('_v2 = read_number(_t2)'); L.push(`_cond = (_v is not None and _v2 is not None and _v ${op} _v2)`); }
    else L.push(`_cond = (_v is not None and _v ${op} ${numConst(s.value)})`);
  }
  L.push('if _cond:');
  L.push('    ' + pyAct(s.onTrue, s.skip));
  L.push('else:');
  L.push('    ' + pyAct(s.onFalse, s.skipElse));
  return L;
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

/* --- 영역 선택 도우미 (조건의 네모 영역 좌표 구하기) --- */
function genRegionPicker() {
  return [
    '#Requires AutoHotkey v2.0', '#SingleInstance Force', 'CoordMode "Mouse", "Screen"',
    '; 읽을 네모 영역의 왼쪽위에서 F1, 오른쪽아래에서 F2 를 누르세요.',
    '; 나온 네 숫자를 매크로 "조건" 동작의 영역칸에 적으면 됩니다.',
    'global gx1 := 0, gy1 := 0, got1 := false',
    'SetTimer ShowPos, 50',
    '*Esc::ExitApp',
    'F1:: {', '    global', '    MouseGetPos &gx1, &gy1', '    got1 := true', '}',
    'F2:: {', '    global', '    MouseGetPos &x2, &y2',
    '    MsgBox "왼쪽 X = " gx1 "`n위 Y = " gy1 "`n오른쪽 X = " x2 "`n아래 Y = " y2, "영역 좌표"', '}',
    'ShowPos() {', '    global', '    MouseGetPos &mx, &my',
    '    s := "X = " mx "   Y = " my "`nF1=왼쪽위  F2=오른쪽아래  Esc=끄기"',
    '    if got1', '        s .= "`n(왼쪽위 저장: " gx1 ", " gy1 ")"',
    '    ToolTip s', '}', '',
  ].join('\r\n');
}

/* --- 이미지 캡처 도우미 (드래그로 영역 긁어 PNG 저장, 무설치) --- */
function genImageCapturer() {
  return [
    '# -*- 이미지 캡처 도우미 -*-',
    '# 찾을 버튼/아이콘을 마우스로 드래그해 긁으면 images\\template_N.png 로 저장돼요.',
    '# 여러 개 연속 저장 가능. 그만하려면 어두운 화면에서 Esc.',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$dir = Join-Path $PSScriptRoot "images"',
    'if(-not (Test-Path $dir)){ New-Item -ItemType Directory -Path $dir | Out-Null }',
    '$script:n = 1',
    'while(Test-Path (Join-Path $dir ("template_" + $script:n + ".png"))){ $script:n++ }',
    '',
    'function Snip(){',
    '  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '  $f = New-Object System.Windows.Forms.Form',
    '  $f.FormBorderStyle = "None"; $f.StartPosition = "Manual"; $f.Bounds = $vs',
    '  $f.BackColor = "Black"; $f.Opacity = 0.35; $f.TopMost = $true; $f.KeyPreview = $true',
    '  $f.Cursor = [System.Windows.Forms.Cursors]::Cross',
    '  $script:sx = 0; $script:sy = 0; $script:rect = [System.Drawing.Rectangle]::Empty; $script:drawing = $false; $script:ok = $false',
    '  $f.Add_MouseDown({ $script:sx = $_.X; $script:sy = $_.Y; $script:drawing = $true })',
    '  $f.Add_MouseMove({ if($script:drawing){ $x=[Math]::Min($script:sx,$_.X); $y=[Math]::Min($script:sy,$_.Y); $w=[Math]::Abs($_.X-$script:sx); $h=[Math]::Abs($_.Y-$script:sy); $script:rect = New-Object System.Drawing.Rectangle $x,$y,$w,$h; $f.Invalidate() } })',
    '  $f.Add_Paint({ if($script:rect.Width -gt 0){ $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::Red), 2; $_.Graphics.DrawRectangle($pen, $script:rect); $pen.Dispose() } })',
    '  $f.Add_MouseUp({ $script:drawing = $false; $script:ok = $true; $f.Close() })',
    '  $f.Add_KeyDown({ if($_.KeyCode -eq "Escape"){ $script:ok = $false; $f.Close() } })',
    '  [void]$f.ShowDialog()',
    '  $rc = $script:rect; $okk = $script:ok; $f.Dispose()',
    '  if(-not $okk -or $rc.Width -lt 3 -or $rc.Height -lt 3){ return $false }',
    '  Start-Sleep -Milliseconds 200',
    '  $bmp = New-Object System.Drawing.Bitmap $rc.Width, $rc.Height',
    '  $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '  $g.CopyFromScreen($vs.Left + $rc.X, $vs.Top + $rc.Y, 0, 0, $rc.Size)',
    '  $g.Dispose()',
    '  $out = Join-Path $dir ("template_" + $script:n + ".png")',
    '  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()',
    '  return $true',
    '}',
    '',
    '[System.Windows.Forms.MessageBox]::Show("찾을 버튼/아이콘을 드래그로 긁으세요.`n저장되면 다음 슬롯으로 넘어가요. 그만하려면 어두운 화면에서 Esc.", "이미지 캡처 도우미") | Out-Null',
    'while($true){',
    '  if(Snip){',
    '    [System.Windows.Forms.MessageBox]::Show(("슬롯 " + $script:n + " 저장됨 (template_" + $script:n + ".png)`n매크로의 이미지 슬롯 번호에 " + $script:n + " 를 적으세요."), "저장됨") | Out-Null',
    '    $script:n++',
    '  } else { break }',
    '}',
    'Write-Host "끝났어요. images 폴더를 매크로 파일과 같은 폴더에 두세요."',
    '',
  ].join('\r\n');
}
function genImgCapBat(ps1Name) {
  return [
    '@echo off', 'chcp 65001 >nul', 'echo 이미지 캡처 도우미를 시작합니다...',
    `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0${ps1Name}"`, '',
  ].join('\r\n');
}

function doExport(kind) {
  const l = activeLoop();
  if (['ahk', 'ps', 'py'].includes(kind)) {
    if (!l.steps.length) { toast('먼저 동작을 추가하세요'); return; }
    if (hasIssues(l) && !confirm('입력이 빠진 동작이 있어요(빨간 ⚠). 그대로 내보낼까요?')) return;
    if (kind === 'ahk' && l.steps.some(s => s.type === 'if' || s.type === 'readput') &&
      !confirm('.ahk 는 "조건"·"영역 값 읽어 입력" 동작을 건너뜁니다. 이 동작을 쓰려면 "무설치(윈도우)"나 파이썬으로 받으세요. 그래도 .ahk 로 받을까요?')) return;
  }
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
  } else if (kind === 'region') {
    download('영역선택도우미.ahk', genRegionPicker());
    toast('영역 선택 도우미를 받았어요');
  } else if (kind === 'imgcap') {
    const ps1 = '이미지캡처도우미.ps1';
    download(ps1, genImageCapturer(), 'text/plain;charset=utf-8');
    download('이미지캡처도우미-실행.bat', genImgCapBat(ps1), 'application/bat');
    toast('이미지 캡처 도우미를 받았어요');
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
<div class="warn"><b>이 프로그램이 하는 일</b><br>
반복되는 PC 작업(클릭·복사·붙여넣기·창 전환 등)을 <b>순서대로 적어 두면, 그 순서를 자동으로 대신 눌러 주는 파일</b>을 만들어 줘요.<br><br>
<b>왜 2단계인가요?</b> 지금 보는 이 화면(웹)은 <b>순서를 짜고 미리보는 설계소</b>예요. 웹 브라우저는 보안상 다른 프로그램의 마우스·키보드를 직접 못 움직여요. 그래서 짜 놓은 순서를 <b>PC에서 실행되는 파일</b>로 내보내 더블클릭하면, 그때 실제로 마우스·키보드가 움직입니다.</div>

<h4>🔰 처음이세요? — 5분 따라하기</h4>
<p class="muted small">"한 칸을 복사해서 다른 창에 붙여넣기"를 예로 들게요.</p>
<ol>
<li><b>좌표(위치) 알아내기</b>: 아래 내보내기에서 <b>좌표 찾기 도우미</b>를 받아 PC에서 더블클릭해요. 마우스를 <b>복사할 자리</b>에 올리면 화면에 <code>X</code>, <code>Y</code> 숫자가 떠요. 그 숫자를 적어 둬요. (붙여넣을 자리도 같은 방법으로)</li>
<li><b>순서 만들기</b>: 이 화면 아래 <b>+ 동작 추가</b>를 눌러 하나씩 쌓아요.
  ① 클릭(복사할 X·Y) → ② 단축키 '복사' → ③ 대기 1초 → ④ 단축키 '창 전환' → ⑤ 클릭(붙여넣을 X·Y) → ⑥ 단축키 '붙여넣기'</li>
<li><b>확인</b>: <b>▶ 미리보기</b>를 눌러 순서가 맞는지 눈으로 봐요. (진짜 실행이 아니라 모의 재생이에요)</li>
<li><b>파일 받기</b>: 맞으면 <b>무설치(윈도우)</b>를 받아요(설치가 필요 없어 가장 쉬워요).</li>
<li><b>실행</b>: 받은 <code>...-무설치.bat</code>를 더블클릭! <b>시작 전 대기</b> 몇 초 동안 복사할 창을 미리 띄워 두면 돼요.</li>
</ol>
<div class="warn">급할 땐 <b>${CTRL_KEYS.stopLabel}</b>를 누르면 즉시 멈춰요. 처음엔 <b>반복 1회</b>로 천천히 확인한 뒤 횟수를 늘리세요.</div>

<h4>📱 화면 구성</h4>
<ul>
<li><b>맨 위 칩</b> — 업무 묶음(루프)이에요. 여러 개 만들어 탭으로 전환해요.</li>
<li><b>루프 설정</b> — 이름·반복 횟수·시작 전 대기·동작 사이 텀·예약 시작.</li>
<li><b>화면 해상도</b> — 좌표·미리보기의 기준(모르면 그대로).</li>
<li><b>동작 순서</b> — 쌓아 둔 동작들. 위에서 아래로 차례로 실행돼요.</li>
<li><b>아래 버튼</b> — ▶ 미리보기 / + 동작 추가.</li>
<li><b>내보내기</b> — 실제 실행 파일을 받는 곳.</li>
</ul>

<h4>➕ 동작을 추가·정리하는 법</h4>
<ul>
<li><b>추가</b>: 아래 <b>+ 동작 추가</b> → 종류 고르기 → 값 채우기 → <b>저장</b>.</li>
<li><b>수정</b>: 목록에서 그 동작을 <b>탭</b>하면 편집 창이 열려요.</li>
<li><b>순서 바꾸기</b>: 동작 오른쪽의 <b>∧ ∨</b> 버튼.</li>
<li><b>복제</b>: 동작을 탭 → 편집 창의 <b>복제</b>(비슷한 동작을 빠르게 추가).</li>
<li><b>삭제</b>: <b>🗑</b> 버튼. 잘못 지웠으면 바로 뜨는 <b>되돌리기</b>를 누르세요.</li>
<li>값이 빠지면 그 동작에 <b>빨간 ⚠</b>가 떠요. 그대로 내보내면 엉뚱하게 동작하니 채워 주세요.</li>
</ul>

<h4>🧩 동작 종류와 설정법</h4>
<ul>
<li><b>🌐 주소 열기(URL)</b> — 기본 브라우저로 주소를 열어요. <em>설정:</em> 주소칸에 <code>https://...</code>. 뒤에 "대기"를 넣어 페이지 뜰 시간을 주세요.</li>
<li><b>🖱️ 마우스 이동</b> — 커서를 특정 위치로 옮겨요. <em>설정:</em> 가로 <code>X</code>·세로 <code>Y</code>. (좌표는 "좌표 찾기 도우미"로)</li>
<li><b>👆 클릭</b> — 그 자리를 클릭해요. <em>설정:</em> X·Y + 버튼(왼쪽/오른쪽/가운데) + 더블클릭 여부.</li>
<li><b>✋ 드래그</b> — 한 점에서 다른 점까지 누른 채 끌어요. <em>설정:</em> 시작 X·Y, 끝 X·Y.</li>
<li><b>⌨️ 단축키</b> — 복사·붙여넣기·창 전환 등. <em>설정:</em> 목록에서 고르거나, <b>직접 입력</b>으로 Ctrl·Shift·Alt + 글자/키(예: f5, enter)를 조합.</li>
<li><b>✏️ 글자 입력</b> — 글자를 타이핑해요. <em>설정:</em> 입력할 글자. (한글은 <b>.ahk</b> 파일이 가장 정확)</li>
<li><b>🪟 창 활성화</b> — 제목으로 창을 찾아 앞으로 가져와요(위치가 바뀌어도 OK). <em>설정:</em> 창 제목의 일부. 모르면 아래 "F12 소스 분석"으로 뽑을 수 있어요.</li>
<li><b>🖲️ 스크롤</b> — 위/아래로 굴려요. <em>설정:</em> 방향 + 몇 칸.</li>
<li><b>⏱️ 대기</b> — 몇 초 기다려요. <em>설정:</em> 초. (창 뜨는 시간·로딩을 기다릴 때)</li>
<li><b>🖼️ 이미지 찾아 클릭</b> — 저장해 둔 <b>그림(버튼·아이콘)</b>을 화면에서 찾아 그 자리를 클릭해요(위치가 바뀌어도 OK). <em>설정:</em> 이미지 슬롯 번호, 관대함(느슨/보통/엄격), 버튼·더블, 재시도, 못 찾을 때 할 일. 아래 "이미지 찾기" 참고. 무설치·.ahk·파이썬 지원(베타).</li>
<li><b>📋 영역 값 읽어 입력</b> — 화면 영역의 글자/숫자를 읽어 <b>지금 커서가 있는 칸에 붙여넣어요</b>(자료수집용). <em>설정:</em> 글자/숫자, 영역 좌표, 붙여넣은 뒤 누를 키(없음/엔터/탭). 무설치·파이썬 전용(베타).</li>
<li><b>❓ 조건</b> — 화면 영역을 읽어 다르게 진행해요(아래 "조건" 참고).</li>
</ul>
<p class="muted small">💡 <b>자료수집 예시</b>: [영역 값 읽어 입력(→탭)] 여러 개를 이어 붙이고 끝에 [단축키 엔터]로 다음 줄로 이동 → 반복. 화면의 값들을 엑셀로 자동으로 옮겨 적어요.</p>

<h4>🗂 루프(업무 묶음) 다루기</h4>
<ul>
<li><b>새 루프</b>: 위 <b>+ 새 루프</b>. 업무마다 따로 만들면 좋아요(예: "메일 보내기", "자료 수집").</li>
<li><b>전환</b>: 맨 위 칩을 탭.</li>
<li><b>복제/삭제</b>: 루프 설정 아래의 <b>루프 복제</b> / <b>이 루프 삭제</b>.</li>
<li>루프는 <b>각각 따로</b> 실행 파일로 내보내요. 바탕화면에 두고 골라서 더블클릭하면 돼요.</li>
</ul>

<h4>⚙️ 루프 설정</h4>
<ul>
<li><b>반복 횟수</b> — 숫자만큼 반복, <b>0</b>이면 멈출 때까지 무한.</li>
<li><b>시작 전 대기(초)</b> — 더블클릭 후 이 시간 동안 기다려요. 그 사이 작업할 창을 띄워 두세요.</li>
<li><b>동작 사이 텀(초)</b> — 각 동작 사이에 자동으로 두는 간격(기본 0.5초). 너무 빨라 놓치면 늘리세요.</li>
<li><b>예약 시작</b> — 시간을 정하면 <b>다음 그 시각</b>까지 기다렸다 시작(이미 지났으면 다음 날 그 시각). 단, <b>PC가 켜져 있고 파일이 실행 중</b>이어야 해요.</li>
</ul>

<h4>▶ 미리보기</h4>
<ul>
<li>가짜 화면 위에서 커서가 움직이며 순서를 <b>모의 재생</b>해요(실제 실행 아님).</li>
<li><b>재생/일시정지/정지</b>, 긴 대기를 줄여 빠르게 보기 옵션이 있어요.</li>
<li>커서 위치가 실제와 다르면 위의 <b>화면 해상도</b>를 내 모니터에 맞추세요.</li>
</ul>

<h4>⌨️ 실행 중 단축키 (모든 파일 공통)</h4>
<ul>
<li><b>${CTRL_KEYS.pauseLabel}</b> — 일시정지 / 다시 재생</li>
<li><b>${CTRL_KEYS.stopLabel}</b> — 완전 종료 (.ahk 는 Esc 도 종료)</li>
<li><b>${CTRL_KEYS.startNowLabel}</b> — 예약 시간을 기다리지 않고 즉시 시작</li>
<li>파이썬만 <code>pip install keyboard</code> 후에 단축키가 켜져요.</li>
</ul>

<h4>🖼️ 이미지 찾아 클릭 — 베타</h4>
<ul>
<li>고정 좌표 대신 <b>"이 그림"을 화면에서 찾아</b> 그 자리를 클릭해요. 창·버튼 위치가 바뀌어도 그림으로 찾아갑니다.</li>
<li><b>쓰는 법</b>: ① PC에서 <b>이미지 캡처 도우미</b>를 받아 실행 → 찾을 버튼/아이콘을 <b>드래그로 긁어</b> 저장(슬롯 1,2,3…) → ② 설계 화면에서 <b>이미지 찾아 클릭</b> 동작의 슬롯 번호에 그 번호를 적기 → ③ 매크로 파일과 <b>images 폴더를 같은 폴더</b>에 두고 실행.</li>
<li><b>어디서 되나</b>: <b>.ahk</b>가 가장 정확(내장 기능). <b>무설치(윈도우)</b>도 돼요(캡처=실행이 같은 PC라 정확도 높음). <b>파이썬</b>은 <code>pip install opencv-python</code> 필요.</li>
<li><b>꼭 알아야 할 점</b>: 캡처한 때와 실행할 때의 <b>해상도·배율(100/125/150%)이 같아야</b> 찾아요(다르면 다시 캡처). 아이콘·버튼처럼 <b>모양 고정된 그림</b>에 적합. 글자·숫자는 이미지보다 <b>조건(OCR)</b>이 안정적이에요. 같은 그림이 화면에 여러 개면 엉뚱한 걸 누를 수 있으니 기본은 "못 찾으면 멈춤".</li>
</ul>

<h4>❓ 조건 (영역을 읽어 분기) — 베타</h4>
<ul>
<li>화면의 네모 영역에서 <b>글자/숫자</b>를 읽어(OCR), 결과에 따라 <b>계속 / 멈춤 / 다음 N개 건너뛰기</b>로 갈라져요.</li>
<li><em>비교 대상 2가지:</em> <b>고정값</b>(예: "숫자가 0보다 크면 멈춤") 또는 <b>다른 영역 ②</b>.</li>
<li><b>두 영역 비교</b>: "무엇과 비교하나요"에서 <b>다른 영역 ②</b>를 고르면, <b>영역①과 영역②를 각각 읽어 같은지/다른지</b> 비교해요(디자인이 서로 달라도 OK). 예: 한쪽 표의 금액과 다른 쪽 화면의 금액이 <b>같으면 계속, 다르면 멈춤</b>.</li>
<li><em>설정:</em> ① 숫자/글자 ② 영역① 좌표 ③ 비교 대상(고정값/다른 영역②) ④ 비교(같음/다름/&gt; 등) ⑤ (영역②면) 영역② 좌표 ⑥ 맞으면/아니면 할 일.</li>
<li>영역은 <b>영역 선택 도우미</b>로 왼쪽위 <b>F1</b>, 오른쪽아래 <b>F2</b>를 누르면 네 좌표가 나와요.</li>
<li><b>무설치(윈도우)·파이썬</b>에서만 동작, <b>.ahk 는 건너뜁니다.</b> OCR은 글꼴·배율·대비에 따라 틀릴 수 있어 <b>숫자 비교가 더 안정적</b>이에요. 글자 비교는 앞뒤 공백만 지우고 대조합니다.</li>
</ul>

<h4>💾 내보내기 — 어떤 파일을 받나요?</h4>
<ul>
<li><b>무설치(윈도우)</b> — 설치·권한이 필요 없어요. 잘 모르면 이걸 먼저. <code>...-무설치.bat</code> 더블클릭.</li>
<li><b>.ahk + .bat</b> — <code>autohotkey.com</code>에서 AutoHotkey v2를 설치할 수 있다면 가장 안정적이고 <b>한글 입력</b>도 잘 돼요.</li>
<li><b>.py (파이썬)</b> — 맥이거나 파이썬을 쓰는 경우.</li>
<li><b>좌표 찾기 도우미</b> — 클릭할 X·Y 숫자 알아내기.</li>
<li><b>영역 선택 도우미</b> — 조건의 네모 영역 좌표 알아내기.</li>
<li><b>이미지 캡처 도우미</b> — "이미지 찾아 클릭"에 쓸 그림(버튼·아이콘)을 PC에서 드래그로 긁어 PNG로 저장.</li>
<li><b>전체 백업 저장 / 불러오기</b> — 만든 모든 루프를 파일로 저장하거나 되돌려요(기기를 바꿀 때).</li>
</ul>

<h4>⚠️ 조심할 점 · 자주 막히는 것</h4>
<ul>
<li>회사 보안 규정을 꼭 확인하세요. <b>내부 시스템 정보는 이 앱에 넣지 않아도 됩니다</b>(넣지 마세요).</li>
<li><b>클릭이 빗나가요</b> → 해상도·화면 배율이 바뀌면 좌표가 달라져요. 좌표를 다시 잡으세요.</li>
<li><b>실행이 막혀요</b> → 회사 보안 프로그램이 스크립트를 막은 경우예요(관리자 문의). 앱 문제는 아닙니다.</li>
<li><b>너무 빨리 지나가요</b> → "동작 사이 텀"이나 중간 "대기"를 늘리세요.</li>
<li>만든 내용은 <b>이 기기(브라우저)에만</b> 저장돼요. 기기를 바꾸면 "전체 백업"으로 옮기세요.</li>
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
initScreenControls();
