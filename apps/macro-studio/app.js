'use strict';

/* ===== 저장소 (이 기기에만 저장) ===== */
const KEY = 'macro-studio';
const store = {
  get(d) { try { const v = localStorage.getItem(KEY); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};

/* ===== 동작 종류 정의 ===== */
const TYPES = {
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
  copy:  { label: '복사 (Ctrl+C)',    ahk: '^c',      py: ['ctrl', 'c'], sk: '^c' },
  paste: { label: '붙여넣기 (Ctrl+V)', ahk: '^v',      py: ['ctrl', 'v'], sk: '^v' },
  cut:   { label: '잘라내기 (Ctrl+X)', ahk: '^x',      py: ['ctrl', 'x'], sk: '^x' },
  all:   { label: '전체선택 (Ctrl+A)', ahk: '^a',      py: ['ctrl', 'a'], sk: '^a' },
  save:  { label: '저장 (Ctrl+S)',    ahk: '^s',      py: ['ctrl', 's'], sk: '^s' },
  undo:  { label: '실행취소 (Ctrl+Z)', ahk: '^z',      py: ['ctrl', 'z'], sk: '^z' },
  find:  { label: '찾기 (Ctrl+F)',    ahk: '^f',      py: ['ctrl', 'f'], sk: '^f' },
  enter: { label: '엔터 (Enter)',     ahk: '{Enter}', py: ['enter'],     sk: '{ENTER}' },
  tab:   { label: '탭 (Tab)',         ahk: '{Tab}',   py: ['tab'],       sk: '{TAB}' },
  esc:   { label: 'ESC',             ahk: '{Esc}',   py: ['esc'],       sk: '{ESC}' },
  custom:{ label: '직접 입력',         ahk: '',        py: [],            sk: '' },
};

/* ===== 상태 ===== */
let state = store.get(null);
if (!state || !Array.isArray(state.loops) || state.loops.length === 0) {
  state = seed();
  save();
}
let activeId = state.loops[0].id;

function seed() {
  return {
    loops: [{
      id: uid(), name: '예시: 붙여넣고 보내기', repeat: 1, delay: 3,
      steps: [
        { id: uid(), type: 'win', title: '메일' },
        { id: uid(), type: 'click', x: 600, y: 320, button: 'left', double: false },
        { id: uid(), type: 'hotkey', preset: 'paste', mods: [], key: '' },
        { id: uid(), type: 'wait', sec: 1 },
        { id: uid(), type: 'click', x: 880, y: 640, button: 'left', double: false },
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
}
$('#loop-name').oninput = e => { activeLoop().name = e.target.value; save(); renderChips(); };
$('#loop-repeat').oninput = e => { activeLoop().repeat = Math.max(0, parseInt(e.target.value) || 0); save(); };
$('#loop-delay').oninput = e => { activeLoop().delay = Math.max(0, parseFloat(e.target.value) || 0); save(); };

/* ===== 동작 한 줄 설명 ===== */
function stepDesc(s) {
  switch (s.type) {
    case 'move': return `화면 X ${s.x}, Y ${s.y} 로 이동`;
    case 'click': return `X ${s.x}, Y ${s.y} ${s.double ? '더블' : ''}${s.button === 'right' ? '우' : s.button === 'middle' ? '가운데' : ''}클릭`;
    case 'drag': return `X ${s.x1},${s.y1} → X ${s.x2},${s.y2} 끌기`;
    case 'hotkey': return (HOTKEYS[s.preset] || {}).label === '직접 입력' || s.preset === 'custom'
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

const ICON = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
};

function stepAction(act, i) {
  const steps = activeLoop().steps;
  if (act === 'del') { steps.splice(i, 1); }
  else if (act === 'up' && i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; }
  else if (act === 'down' && i < steps.length - 1) { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; }
  save(); renderSteps();
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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

  body.querySelectorAll('[data-type]').forEach(b => {
    b.onclick = () => { setType(b.dataset.type); };
  });
  bindFields();
}

function setType(type) {
  const defaults = {
    move:   { type, x: 100, y: 100 },
    click:  { type, x: 100, y: 100, button: 'left', double: false },
    drag:   { type, x1: 100, y1: 100, x2: 300, y2: 300 },
    hotkey: { type, preset: 'copy', mods: [], key: '' },
    text:   { type, text: '' },
    win:    { type, title: '' },
    scroll: { type, dir: 'down', amount: 3 },
    wait:   { type, sec: 1 },
  };
  draft = defaults[type];
  renderSheetBody();
}

function fieldsFor(type) {
  const xy = (lx, ly, vx, vy) => `
    <div class="two">
      <label class="field"><span>${lx}</span><input type="number" data-k="${vx}" value="${draft[vx]}" inputmode="numeric"></label>
      <label class="field"><span>${ly}</span><input type="number" data-k="${vy}" value="${draft[vy]}" inputmode="numeric"></label>
    </div>`;
  switch (type) {
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
        <p class="hint">제목에 이 글자가 들어간 창을 찾아 앞으로 가져와요. 위치가 바뀌어도 잘 찾습니다. 아래 "F12 소스 분석"으로 제목을 뽑을 수 있어요.</p>`;
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
  return `<p class="hint">X·Y 숫자를 모르면, 위 "좌표 찾기 도우미"를 받아 PC에서 실행하고 마우스를 원하는 곳에 올리면 숫자가 보여요.</p>`;
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
      } else if (g === 'double') {
        draft.double = !draft.double;
      } else {
        draft[g] = val;
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
$('#sheet-close').onclick = () => hideSheet('#sheet', '#sheet-bg');
$('#sheet-bg').onclick = () => hideSheet('#sheet', '#sheet-bg');
$('#add-step').onclick = () => openStepSheet(null);

function showSheet(s, bg) { $(bg).hidden = false; $(s).hidden = false; }
function hideSheet(s, bg) { $(bg).hidden = true; $(s).hidden = true; }

/* ===== 루프 추가 ===== */
$('#add-loop').onclick = () => {
  const l = { id: uid(), name: `루프 ${state.loops.length + 1}`, repeat: 1, delay: 3, steps: [] };
  state.loops.push(l); activeId = l.id; save(); renderAll();
};

/* ===== 루프 삭제 (이름줄 길게 누르기 대신 설정에 버튼) ===== */
function addDeleteLoopButton() {
  // 설정 카드 안에 삭제 버튼을 한 번만 만든다
  if ($('#del-loop')) return;
  const sec = $('#loop-settings');
  const row = document.createElement('div');
  row.className = 'row';
  row.style.marginTop = '12px';
  row.innerHTML = `<button class="mini ghost danger" id="del-loop" style="margin-left:auto">이 루프 삭제</button>`;
  sec.appendChild(row);
  $('#del-loop').onclick = () => {
    if (state.loops.length <= 1) { toast('마지막 루프는 지울 수 없어요'); return; }
    if (!confirm(`"${activeLoop().name}" 루프를 삭제할까요?`)) return;
    state.loops = state.loops.filter(l => l.id !== activeId);
    activeId = state.loops[0].id; save(); renderAll();
  };
}

/* ===== 내보내기 ===== */
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

function ahkStr(s) {
  return String(s == null ? '' : s)
    .replace(/`/g, '``').replace(/"/g, '""')
    .replace(/\r/g, '').replace(/\n/g, '`n').replace(/\t/g, '`t');
}

function buildHotkey(s) {
  if (s.preset && s.preset !== 'custom') {
    const h = HOTKEYS[s.preset];
    return { ahk: h.ahk, py: h.py, sk: h.sk, singlePy: h.py.length === 1 };
  }
  const ahkSym = { ctrl: '^', alt: '!', shift: '+', win: '#' };
  const skSym = { ctrl: '^', alt: '%', shift: '+', win: '' };   // SendKeys엔 Win키 코드가 없음
  const mods = (s.mods || []);
  let key = (s.key || '').trim();
  let ahkKey = key.length > 1 ? `{${key}}` : key;               // enter, f5 같은 특수키
  let skKey = key.length > 1 ? `{${key.toUpperCase()}}` : key.toLowerCase();
  const ahk = mods.map(m => ahkSym[m]).join('') + ahkKey;
  const sk = mods.map(m => skSym[m]).join('') + (key ? skKey : '');
  const py = [...mods.map(m => m === 'win' ? 'win' : m), key.toLowerCase()].filter(Boolean);
  return { ahk, py, sk, singlePy: py.length === 1 };
}

/* --- AutoHotkey v2 --- */
function genAHK(l) {
  const L = [];
  L.push('#Requires AutoHotkey v2.0');
  L.push('#SingleInstance Force');
  L.push('CoordMode "Mouse", "Screen"');
  L.push('SetTitleMatchMode 2');
  L.push('SetKeyDelay 30');
  L.push('SetMouseDelay 30');
  L.push('');
  L.push(`; ===== 매크로: ${(l.name || '').replace(/[\r\n]/g, ' ')} =====`);
  L.push('; 이 파일을 더블클릭하면 시작합니다. (AutoHotkey v2 설치 필요)');
  L.push('; ★ 급할 때 Esc 키를 누르면 즉시 멈춥니다. ★');
  L.push('');
  L.push('*Esc::ExitApp   ; 비상 정지');
  L.push('');
  L.push(`Sleep ${Math.round((l.delay || 0) * 1000)}   ; 시작 전 대기`);
  const open = (l.repeat && l.repeat > 0) ? `Loop ${l.repeat} {` : 'Loop {   ; 무한 반복 (Esc로 멈춤)';
  L.push(open);
  for (const s of l.steps) L.push(...genAHKStep(s).map(x => '    ' + x));
  L.push('}');
  L.push('MsgBox "매크로가 끝났어요.", "매크로 설계소", "Iconi T3"');
  return L.join('\r\n') + '\r\n';
}
function genAHKStep(s) {
  switch (s.type) {
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
function num(v) { return Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0; }

/* --- 실행용 .bat --- */
function genBAT(l, ahkName) {
  return [
    '@echo off',
    'chcp 65001 >nul',
    `echo [${(l.name || '매크로').replace(/[\r\n]/g, ' ')}] 를 시작합니다...`,
    'echo 급할 때 Esc 키를 누르면 멈춥니다.',
    `start "" "%~dp0${ahkName}"`,
    'if errorlevel 1 (',
    '  echo.',
    '  echo [안내] 먼저 AutoHotkey v2 를 설치해야 .ahk 파일이 실행됩니다.',
    '  echo         https://www.autohotkey.com 에서 받으세요.',
    '  pause',
    ')',
    '',
  ].join('\r\n');
}

/* --- 무설치 윈도우: PowerShell .ps1 + 실행용 .bat --- */
function psStr(s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; }
function sendKeysText(s) { return String(s == null ? '' : s).replace(/[+^%~(){}\[\]]/g, m => '{' + m + '}'); }

function genPSBat(l, ps1Name) {
  return [
    '@echo off',
    'chcp 65001 >nul',
    `echo [${(l.name || '매크로').replace(/[\r\n]/g, ' ')}] 를 시작합니다. (설치 필요 없음)`,
    'echo 급할 때는 이 검은 창을 닫으면 멈춥니다.',
    `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0${ps1Name}"`,
    'echo.',
    'pause',
    '',
  ].join('\r\n');
}

function genPS1(l) {
  const P = [];
  P.push('# -*- 매크로: ' + (l.name || '').replace(/[\r\n]/g, ' ') + ' -*-');
  P.push('# 설치가 필요 없습니다. 함께 받은 "...-무설치.bat" 파일을 더블클릭하세요.');
  P.push('# ★ 급할 때: 실행 중 나타난 검은 창을 닫으면 멈춥니다. ★');
  P.push('Add-Type @"');
  P.push('using System; using System.Runtime.InteropServices;');
  P.push('public class U {');
  P.push('  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);');
  P.push('  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,int d,int e);');
  P.push('  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);');
  P.push('}');
  P.push('"@');
  P.push('Add-Type -AssemblyName System.Windows.Forms');
  P.push('');
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
  P.push('function Scroll($dir,$amt){ for($i=0;$i -lt $amt;$i++){ [U]::mouse_event(0x800,0,0,$(if($dir -eq \'up\'){120}else{-120}),0); Start-Sleep -Milliseconds 50 } }');
  P.push('');
  P.push(`Start-Sleep -Seconds ${Number(l.delay) || 0}`);
  P.push(`$reps = ${l.repeat && l.repeat > 0 ? l.repeat : 0}   # 0 = 무한 반복`);
  P.push('$i = 0');
  P.push('while($reps -eq 0 -or $i -lt $reps){');
  for (const s of l.steps) P.push(...genPSStep(s).map(x => '  ' + x));
  P.push('  $i++');
  P.push('}');
  P.push('Write-Host "매크로가 끝났어요."');
  return P.join('\r\n') + '\r\n';
}
function genPSStep(s) {
  switch (s.type) {
    case 'move': return [`Move ${num(s.x)} ${num(s.y)}`];
    case 'click': return [`ClickAt ${num(s.x)} ${num(s.y)} '${s.button || 'left'}' $${s.double ? 'true' : 'false'}`];
    case 'drag': return [`Drag ${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)}`];
    case 'hotkey': return [`Keys ${psStr(buildHotkey(s).sk)}`];
    case 'text': return [`Keys ${psStr(sendKeysText(s.text))}`];
    case 'win': return [`ActivateWin ${psStr(s.title)}`];
    case 'scroll': return [`Scroll '${s.dir === 'up' ? 'up' : 'down'}' ${num(s.amount) || 1}`];
    case 'wait': return [`Start-Sleep -Milliseconds ${Math.round((Number(s.sec) || 0) * 1000)}`];
    default: return [];
  }
}

/* --- 파이썬 (pyautogui) --- */
function genPY(l) {
  const P = [];
  P.push('# -*- coding: utf-8 -*-');
  P.push(`# 매크로: ${(l.name || '').replace(/[\r\n]/g, ' ')}`);
  P.push('# 실행 방법:');
  P.push('#   1) 파이썬(python.org) 설치');
  P.push('#   2) 명령창에서:  pip install pyautogui pygetwindow');
  P.push('#   3) 실행:        python "이파일이름.py"');
  P.push('#  ★ 급할 때: 마우스를 화면 왼쪽 맨 위 구석으로 휙 옮기면 멈춥니다. ★');
  P.push('import time');
  P.push('try:');
  P.push('    import pyautogui');
  P.push('except ImportError:');
  P.push('    raise SystemExit("먼저 명령창에서  pip install pyautogui  를 실행하세요.")');
  P.push('try:');
  P.push('    import pygetwindow as gw');
  P.push('except Exception:');
  P.push('    gw = None');
  P.push('pyautogui.FAILSAFE = True');
  P.push('pyautogui.PAUSE = 0.1');
  P.push('');
  P.push('def activate_window(title):');
  P.push('    if not gw: return');
  P.push('    try:');
  P.push('        for w in gw.getWindowsWithTitle(title):');
  P.push('            w.activate(); time.sleep(0.4); return');
  P.push('    except Exception: pass');
  P.push('');
  P.push('def run():');
  P.push(`    time.sleep(${Number(l.delay) || 0})`);
  const steps = [];
  for (const s of l.steps) steps.push(...genPYStep(s));
  if (steps.length === 0) steps.push('pass');
  if (l.repeat && l.repeat > 0) {
    P.push(`    for _ in range(${l.repeat}):`);
    steps.forEach(x => P.push('        ' + x));
  } else {
    P.push('    while True:   # 무한 반복');
    steps.forEach(x => P.push('        ' + x));
  }
  P.push('');
  P.push('run()');
  P.push('print("매크로가 끝났어요.")');
  return P.join('\r\n') + '\r\n';
}
function genPYStep(s) {
  const J = v => JSON.stringify(v == null ? '' : v);
  switch (s.type) {
    case 'move': return [`pyautogui.moveTo(${num(s.x)}, ${num(s.y)}, duration=0.2)`];
    case 'click': {
      const args = [`${num(s.x)}, ${num(s.y)}`];
      if (s.button !== 'left') args.push(`button=${J(s.button)}`);
      if (s.double) args.push('clicks=2');
      return [`pyautogui.click(${args.join(', ')})`];
    }
    case 'drag': return [`pyautogui.moveTo(${num(s.x1)}, ${num(s.y1)}, duration=0.2)`, `pyautogui.dragTo(${num(s.x2)}, ${num(s.y2)}, duration=0.3, button='left')`];
    case 'hotkey': {
      const h = buildHotkey(s);
      return h.singlePy ? [`pyautogui.press(${J(h.py[0])})`] : [`pyautogui.hotkey(${h.py.map(J).join(', ')})`];
    }
    case 'text': return [`pyautogui.write(${J(s.text)}, interval=0.02)  # 한글은 .ahk 파일을 쓰세요`];
    case 'win': return [`activate_window(${J(s.title)})`];
    case 'scroll': return [`pyautogui.scroll(${(s.dir === 'up' ? 1 : -1) * (num(s.amount) || 1) * 300})`];
    case 'wait': return [`time.sleep(${Number(s.sec) || 0})`];
    default: return [];
  }
}

/* --- 좌표 찾기 도우미 --- */
function genFinder() {
  return [
    '#Requires AutoHotkey v2.0',
    '#SingleInstance Force',
    'CoordMode "Mouse", "Screen"',
    '; 마우스를 원하는 곳에 올리면 X, Y 숫자가 보입니다.',
    '; 그 숫자를 매크로 설계소의 클릭/이동 동작에 적으세요.',
    'SetTimer ShowPos, 50',
    '*Esc::ExitApp',
    'ShowPos() {',
    '    MouseGetPos &mx, &my',
    '    ToolTip "X = " mx "`nY = " my "`n`n이 숫자를 매크로에 적으세요`nEsc = 끄기"',
    '}',
    '',
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
      state = data; activeId = state.loops[0]?.id; if (!activeId) { state = seed(); activeId = state.loops[0].id; }
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
      window.scrollTo({ top: document.querySelector('.steps').offsetTop - 60, behavior: 'smooth' });
    };
    box.appendChild(d);
  });
};

/* ===== 도움말 ===== */
$('#help-btn').onclick = () => {
  $('#help-body').innerHTML = HELP;
  showSheet('#help-sheet', '#help-bg');
};
$('#help-close').onclick = () => hideSheet('#help-sheet', '#help-bg');
$('#help-bg').onclick = () => hideSheet('#help-sheet', '#help-bg');

const HELP = `
<div class="warn"><b>왜 두 가지로 나뉘나요?</b><br>
이 화면(웹)은 <b>동작 순서를 짜는 곳</b>이에요. 브라우저는 보안상 다른 프로그램의 마우스·키보드를 직접 못 움직여요.
그래서 짜 놓은 순서를 <b>PC에서 도는 파일(.ahk/.bat/.py)</b>로 내보내 실행하면, 그때 실제로 움직입니다.</div>

<h4>처음 쓰는 순서</h4>
<ol>
<li><b>좌표 찾기 도우미</b>를 받아 PC에서 실행 → 클릭할 위치에 마우스를 올려 <code>X</code>, <code>Y</code> 숫자를 적어둬요.</li>
<li>이 화면에서 <b>+ 동작 추가</b>로 이동·클릭·붙여넣기 같은 순서를 만들어요.</li>
<li>아래 내보내기에서 내 PC에 맞는 걸 받아요(아래 설명 참고).</li>
<li>받은 <b>실행 파일(.bat 또는 .ahk)을 더블클릭</b>하면 시작! 시작 전 몇 초 대기 동안 원하는 창을 켜 두세요.</li>
</ol>

<h4>어떤 걸 받아야 하나요?</h4>
<ul>
<li><b>무설치 (윈도우)</b> — 설치·관리자 권한이 필요 없어요. 회사 PC가 설치가 막혀 있거나 잘 모르면 <b>이걸 먼저</b> 쓰세요. 받은 <code>...-무설치.bat</code>를 더블클릭.</li>
<li><b>.ahk + .bat</b> — <code>autohotkey.com</code>에서 <b>AutoHotkey v2</b>를 한 번 설치할 수 있다면 가장 안정적이고, 특히 <b>한글 글자 입력</b>이 잘 돼요.</li>
<li><b>.py (파이썬)</b> — 맥이거나 파이썬을 쓰는 경우. <code>pip install pyautogui pygetwindow</code> 필요.</li>
</ul>

<h4>비상 정지</h4>
<p>동작 중 <b>Esc 키</b>를 누르면 즉시 멈춰요. (파이썬은 마우스를 화면 왼쪽 맨 위 구석으로)</p>

<h4>여러 업무 만들기</h4>
<p>위쪽 <b>+ 새 루프</b>로 업무마다 따로 만들고, 각 루프를 <b>따로 파일로 내보내</b> 바탕화면에 두면 더블클릭으로 골라 실행할 수 있어요.</p>

<h4>창을 제목으로 찾기</h4>
<p>위치가 자꾸 바뀌면 <b>창 활성화</b> 동작을 맨 앞에 넣으세요. 제목 일부만 적으면 그 창을 앞으로 가져와요. 제목을 모르면 <b>F12 소스 분석</b>에 페이지 코드를 붙여넣어 뽑을 수 있어요.</p>

<h4>조심할 점</h4>
<ul>
<li>회사 보안 규정을 꼭 확인하세요. 내부 시스템 정보는 이 앱에 넣지 않아도 됩니다(넣지 마세요).</li>
<li>좌표는 화면 해상도·배율이 바뀌면 달라져요. PC가 바뀌면 좌표를 다시 잡으세요.</li>
<li>처음엔 반복을 <b>1회</b>로 두고 천천히 확인한 뒤 횟수를 늘리세요.</li>
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
