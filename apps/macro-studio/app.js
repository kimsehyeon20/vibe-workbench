'use strict';

/* ===== 저장소 (이 기기에만 저장) ===== */
const KEY = 'macro-studio';
const store = {
  get(d) { try { const v = localStorage.getItem(KEY); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};

/* ===== 동작 종류 정의 ===== */
const TYPES = {
  url:      { ico: '🌐', label: '주소 열기 (URL)' },
  move:     { ico: '🖱️', label: '마우스 이동' },
  click:    { ico: '👆', label: '클릭' },
  drag:     { ico: '✋', label: '드래그' },
  hotkey:   { ico: '⌨️', label: '단축키 (복사·창 닫기 등)' },
  text:     { ico: '✏️', label: '글자 입력' },
  win:      { ico: '🪟', label: '창 활성화 (제목으로 찾기)' },
  scroll:   { ico: '🖲️', label: '스크롤' },
  wait:     { ico: '⏱️', label: '대기 (초)' },
  imgclick: { ico: '🖼️', label: '이미지 찾아 클릭' },
  textclick:{ ico: '🔤', label: '글자 찾아 클릭' },
  readput:  { ico: '📋', label: '영역 값 읽어 입력' },
  setvar:   { ico: '📦', label: '변수에 값 저장' },
  repeat:   { ico: '🔁', label: '반복문 (동작을 묶어 반복)' },
  if:       { ico: '❓', label: '조건 (맞으면 동작 실행)' },
  break:    { ico: '⏏️', label: '반복 빠져나가기' },
  stop:     { ico: '🛑', label: '멈춤 (매크로 끝내기)' },
};

/* 묶음(컨테이너) 동작: 안에 다른 동작들을 담는 하위 목록 */
const CONTAINERS = {
  repeat: [{ key: 'children', label: '반복할 동작' }],
  if:     [{ key: 'children', label: '맞으면 실행할 동작' }, { key: 'elseChildren', label: '아니면 (선택)' }],
};
function childListsOf(s) { return CONTAINERS[s.type] || null; }
function isContainer(s) { return !!CONTAINERS[s.type]; }
/* 트리 전체를 순회(묶음 안의 동작까지) */
function walkSteps(steps, fn) {
  (steps || []).forEach(s => {
    fn(s);
    const cl = childListsOf(s);
    if (cl) cl.forEach(c => walkSteps(s[c.key] || [], fn));
  });
}
function anyStep(steps, pred) { let hit = false; walkSteps(steps, s => { if (pred(s)) hit = true; }); return hit; }

/* 이미지 찾기: 색 허용오차 단계 / 닮은 정도(%) */
const TOLS = { 15: '엄격', 25: '보통', 40: '느슨' };
const SIMS = { 100: '똑같이', 95: '거의 같게', 85: '비슷하게', 75: '느슨하게' };

/* 읽어 입력 후 누를 키 */
const AFTERS = { none: '(없음)', enter: '엔터(다음 줄)', tab: '탭(다음 칸)' };

/* 조건 동작: 무엇을 확인 / 비교 연산자 */
const WHAT = { region: '화면 영역 글자·숫자', var: '변수 값', img: '이미지가 보이는지', text: '글자가 보이는지' };
const OPS_NUM = { gt: '보다 큼 (>)', lt: '보다 작음 (<)', ge: '크거나 같음 (≥)', le: '작거나 같음 (≤)', eq: '같음 (=)', ne: '다름 (≠)', empty: '비었음 (못 읽음)' };
const OPS_TEXT = { has: '포함', eq: '같음 (=)', ne: '다름 (≠)', empty: '비었음 (못 읽음)' };
const OPS_SEE = { yes: '보이면', no: '안 보이면' };
/* 이미지·글자 찾기: 찾으면 / 끝내 못 찾으면 */
const ACT = { click: '클릭', move: '마우스만 이동', none: '찾기만 (기다리기)' };
const NF = { pause: '일시정지 + 오류 표시 (F8 다시 찾기)', stop: '매크로 멈춤', continue: '그냥 넘어가기' };
/* 변수에 넣을 값 */
const SETFROM = { text: '직접 입력', read: '화면 영역 읽기', clip: '클립보드 (복사한 값)' };

const HOTKEYS = {
  copy:     { label: '복사 (Ctrl+C)',         ahk: '^c',      py: ['ctrl', 'c'],  sk: '^c' },
  paste:    { label: '붙여넣기 (Ctrl+V)',      ahk: '^v',      py: ['ctrl', 'v'],  sk: '^v' },
  cut:      { label: '잘라내기 (Ctrl+X)',      ahk: '^x',      py: ['ctrl', 'x'],  sk: '^x' },
  all:      { label: '전체선택 (Ctrl+A)',      ahk: '^a',      py: ['ctrl', 'a'],  sk: '^a' },
  save:     { label: '저장 (Ctrl+S)',         ahk: '^s',      py: ['ctrl', 's'],  sk: '^s' },
  undo:     { label: '실행취소 (Ctrl+Z)',      ahk: '^z',      py: ['ctrl', 'z'],  sk: '^z' },
  find:     { label: '찾기 (Ctrl+F)',         ahk: '^f',      py: ['ctrl', 'f'],  sk: '^f' },
  alttab:   { label: '창 전환 (Alt+Tab)',     ahk: '!{Tab}',  py: ['alt', 'tab'], sk: '%{TAB}' },
  enter:    { label: '엔터 (Enter)',          ahk: '{Enter}', py: ['enter'],      sk: '{ENTER}' },
  tab:      { label: '탭 (Tab)',              ahk: '{Tab}',   py: ['tab'],        sk: '{TAB}' },
  esc:      { label: 'ESC',                  ahk: '{Esc}',   py: ['esc'],        sk: '{ESC}' },
  close:    { label: '창 닫기 (Alt+F4)',       ahk: '!{F4}',   py: ['alt', 'f4'],  sk: '%{F4}' },
  closetab: { label: '탭 닫기 (Ctrl+W)',       ahk: '^w',      py: ['ctrl', 'w'],  sk: '^w' },
  newtab:   { label: '새 탭 (Ctrl+T)',         ahk: '^t',      py: ['ctrl', 't'],  sk: '^t' },
  refresh:  { label: '새로고침 (F5)',          ahk: '{F5}',    py: ['f5'],         sk: '{F5}' },
  addr:     { label: '주소창으로 (Ctrl+L)',     ahk: '^l',      py: ['ctrl', 'l'],  sk: '^l' },
  winr:     { label: '실행창 열기 (Win+R)',     ahk: '#r',      py: ['win', 'r'],   sk: '' },
  desktop:  { label: '바탕화면 보기 (Win+D)',   ahk: '#d',      py: ['win', 'd'],   sk: '' },
  explorer: { label: '파일 탐색기 (Win+E)',     ahk: '#e',      py: ['win', 'e'],   sk: '' },
  custom:   { label: '직접 입력',              ahk: '',        py: [],             sk: '' },
};

/* 가상 키코드(윈도우 keybd_event용): SendKeys 가 못 보내는 Win 조합 등을 직접 보냄 */
const VK_MOD = { ctrl: 0x11, shift: 0x10, alt: 0x12, win: 0x5B };
const VK_NAMED = { enter: 0x0D, tab: 0x09, esc: 0x1B, escape: 0x1B, space: 0x20, up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, delete: 0x2E, del: 0x2E, backspace: 0x08, insert: 0x2D,
  printscreen: 0x2C, apps: 0x5D, capslock: 0x14, comma: 0xBC };
const VK_SYM = { ';': 0xBA, '=': 0xBB, ',': 0xBC, '-': 0xBD, '.': 0xBE, '/': 0xBF, '`': 0xC0, '[': 0xDB, '\\': 0xDC, ']': 0xDD, "'": 0xDE };
function vkForKey(key) {
  key = String(key || '').trim().toLowerCase();
  if (!key) return null;
  if (VK_NAMED[key] != null) return VK_NAMED[key];
  const fm = key.match(/^f([1-9]|1[0-2])$/); if (fm) return 0x70 + (Number(fm[1]) - 1);
  if (key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0);
    if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A)) return c;
    if (VK_SYM[key] != null) return VK_SYM[key];   // ; . / 등 기호 키 (Win+. 이모지 등)
  }
  return null;
}
/* 단축키 → VK 배열(수식키들 + 키 하나). 표현 불가하면 null */
function hotkeyCombo(s) {
  let mods = [], key = '';
  if (s.preset && s.preset !== 'custom') { ((HOTKEYS[s.preset] || {}).py || []).forEach(p => { if (VK_MOD[p] != null) mods.push(p); else key = p; }); }
  else { mods = (s.mods || []).filter(m => VK_MOD[m] != null); key = (s.key || '').trim(); }
  const kv = key ? vkForKey(key) : null;
  if (key && kv == null) return null;
  const vks = mods.map(m => VK_MOD[m]); if (kv != null) vks.push(kv);
  return vks.length ? vks : null;
}
function hotkeyUsesWin(s) { return ((HOTKEYS[s.preset] || {}).py || []).includes('win'); }

/* ===== 직접 만드는 단축키: "Ctrl+Shift+N", "Win+R", "Alt, F, X"(차례로) 같은 글을 키로 해석 ===== */
const MOD_ALIAS = { ctrl: 'ctrl', control: 'ctrl', ctl: 'ctrl', '컨트롤': 'ctrl', '^': 'ctrl', shift: 'shift', '시프트': 'shift', '쉬프트': 'shift',
  alt: 'alt', '알트': 'alt', option: 'alt', win: 'win', windows: 'win', window: 'win', '윈도우': 'win', '윈': 'win', '윈키': 'win', cmd: 'win', super: 'win', meta: 'win' };
const KEY_ALIAS = { return: 'enter', '엔터': 'enter', '탭': 'tab', escape: 'esc', '이스케이프': 'esc', spacebar: 'space', '스페이스': 'space', '스페이스바': 'space',
  bs: 'backspace', '백스페이스': 'backspace', del: 'delete', '딜리트': 'delete', '삭제': 'delete', ins: 'insert', pgup: 'pageup', pgdn: 'pagedown',
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', '↑': 'up', '↓': 'down', '←': 'left', '→': 'right',
  '위': 'up', '아래': 'down', '왼쪽': 'left', '오른쪽': 'right', prtsc: 'printscreen', printscr: 'printscreen', '프린트스크린': 'printscreen',
  menu: 'apps', '캡스락': 'capslock', '쉼표': 'comma' };
/* 한글 자판으로 쳐도 같은 자리 영문 키로 (ㅜ → n) */
const JAMO_KEY = { 'ㅂ': 'q', 'ㅈ': 'w', 'ㄷ': 'e', 'ㄱ': 'r', 'ㅅ': 't', 'ㅛ': 'y', 'ㅕ': 'u', 'ㅑ': 'i', 'ㅐ': 'o', 'ㅔ': 'p', 'ㅁ': 'a', 'ㄴ': 's', 'ㅇ': 'd',
  'ㄹ': 'f', 'ㅎ': 'g', 'ㅗ': 'h', 'ㅓ': 'j', 'ㅏ': 'k', 'ㅣ': 'l', 'ㅋ': 'z', 'ㅌ': 'x', 'ㅊ': 'c', 'ㅍ': 'v', 'ㅠ': 'b', 'ㅜ': 'n', 'ㅡ': 'm',
  'ㅃ': 'q', 'ㅉ': 'w', 'ㄸ': 'e', 'ㄲ': 'r', 'ㅆ': 't', 'ㅒ': 'o', 'ㅖ': 'p' };
const KEY_NAMES = ['enter', 'tab', 'esc', 'space', 'backspace', 'delete', 'insert', 'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right', 'printscreen', 'apps', 'capslock', 'comma'];
const KEY_LABEL = { enter: 'Enter', tab: 'Tab', esc: 'Esc', space: 'Space', backspace: 'Backspace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', up: '↑', down: '↓', left: '←', right: '→', printscreen: 'PrintScreen', apps: '메뉴키', capslock: 'CapsLock', comma: ',' };
/* 키 하나 이름 정리 → 'a' / '1' / 'f5' / 'enter' / ';' … 모르면 null */
function normKey(t) {
  let k = String(t || '').trim().toLowerCase();
  if (!k) return null;
  if (JAMO_KEY[k]) k = JAMO_KEY[k];
  if (KEY_ALIAS[k]) k = KEY_ALIAS[k];
  if (KEY_NAMES.includes(k) || /^f([1-9]|1[0-2])$/.test(k)) return k;
  if (k.length === 1 && (/[a-z0-9]/.test(k) || VK_SYM[k] != null)) return k;
  return null;
}
/* "Ctrl+Shift+N, Alt+F4" → { chords:[{mods,key}], error } (쉼표·→ 는 "차례로") */
function parseCombo(text) {
  const src = String(text || '').trim();
  if (!src) return { chords: [], error: '누를 키를 적어 주세요' };
  const parts = src.split(/[,，→]/).map(x => x.trim()).filter(Boolean);
  if (parts.length > 10) return { chords: [], error: '차례로 누르는 키는 10개까지예요' };
  const chords = [];
  for (const part of parts) {
    const toks = part.split('+').map(x => x.trim()).filter(Boolean);
    const mods = [], keys = [];
    for (const t of toks) {
      const m = MOD_ALIAS[t.toLowerCase()];
      if (m) { if (!mods.includes(m)) mods.push(m); continue; }
      const k = normKey(t);
      if (!k) return { chords: [], error: `'${t}' 는 모르는 키예요 (예: a, 1, f5, enter, tab, esc, space, up)` };
      keys.push(k);
    }
    if (keys.length > 1) return { chords: [], error: `'${part}' — 한 번에 누르는 일반 키는 하나만 돼요. 차례로 누르려면 쉼표(,)로 나누세요` };
    if (!keys.length && !mods.length) continue;
    chords.push({ mods: ['ctrl', 'shift', 'alt', 'win'].filter(x => mods.includes(x)), key: keys[0] || '' });
  }
  if (!chords.length) return { chords: [], error: '누를 키를 적어 주세요' };
  return { chords, error: null };
}
const MOD_LABEL = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', win: 'Win' };
function chordLabel(c) { return [...c.mods.map(m => MOD_LABEL[m]), c.key ? (KEY_LABEL[c.key] || c.key.toUpperCase()) : ''].filter(Boolean).join('+'); }
function prettyCombo(text) { const p = parseCombo(text); return p.error ? String(text || '') : p.chords.map(chordLabel).join(' → '); }
/* 내 단축키(직접 만들어 저장한 것) 찾기 / 동작이 실제로 누를 키 */
function myKey(id) { return (state.myKeys || []).find(k => k.id === id) || null; }
function resolveHotkey(s) {
  if (s.preset === 'custom') return { combo: s.combo || '', label: null };
  if (String(s.preset || '').startsWith('my:')) {
    const mk = myKey(s.preset.slice(3));
    return { combo: mk ? mk.combo : (s.combo || ''), label: mk ? mk.name : (s.keyName || '내 단축키') };
  }
  return null;   // 기본 제공 단축키
}
/* 생성기용: 화음(동시에 누르는 키 묶음) → 각 언어 표기 */
function chordVKs(c) { const v = c.mods.map(m => VK_MOD[m]); if (c.key) v.push(vkForKey(c.key)); return v.filter(x => x != null); }
const AHK_KEYNAME = { enter: '{Enter}', tab: '{Tab}', esc: '{Esc}', space: '{Space}', backspace: '{Backspace}', delete: '{Delete}', insert: '{Insert}', home: '{Home}',
  end: '{End}', pageup: '{PgUp}', pagedown: '{PgDn}', up: '{Up}', down: '{Down}', left: '{Left}', right: '{Right}', printscreen: '{PrintScreen}', apps: '{AppsKey}', capslock: '{CapsLock}', comma: ',' };
function chordAHK(c) {
  const sym = { ctrl: '^', shift: '+', alt: '!', win: '#' };
  const k = !c.key ? '' : AHK_KEYNAME[c.key] || (/^f\d+$/.test(c.key) ? `{${c.key.toUpperCase()}}` : c.key);
  if (!k) return c.mods.map(m => `{${MOD_LABEL[m]} down}`).join('') + c.mods.map(m => `{${MOD_LABEL[m]} up}`).join('');   // 수식키만
  return c.mods.map(m => sym[m]).join('') + k;
}
const PY_KEYNAME = { comma: ',' };
function chordPY(c) { return [...c.mods, ...(c.key ? [PY_KEYNAME[c.key] || c.key] : [])]; }

/* 실행 중 제어 단축키 (사람이 외우기 쉬운 키로 고정) */
const CTRL_KEYS = { pauseLabel: 'F8', stopLabel: 'F9', startNowLabel: 'F7', restartLabel: 'F10' };

/* 이름 정리 — 이미지 파일·변수 이름에 쓰면 안 되는 글자를 뺌.
   변수·이미지·별명은 서로 다른 칸에 저장되고 코드에서도 "문자열 열쇠"로만 쓰여, 이름이 겹쳐도 서로 섞이지 않음 */
function cleanImgName(v) { return String(v == null ? '' : v).replace(/\.png$/i, '').replace(/[\\/:*?"<>|\r\n\t`]/g, '').trim().slice(0, 60); }
function cleanVarName(v) { return String(v == null ? '' : v).replace(/[{}=\r\n\t`]/g, '').trim().slice(0, 40); }
function imgDirOf(l) { const d = String((l && l.imgDir) || '').replace(/["'`\r\n\t]/g, '').trim().replace(/[\\/]+$/, ''); return d || 'images'; }
function isAbsDir(d) { return /^[A-Za-z]:[\\/]?/.test(d) || /^\\\\/.test(d); }
/* 이 작업방에서 쓰는 변수·이미지 이름 목록 */
function varNames(l) {
  const s = new Set();
  (l.vars || []).forEach(v => { const n = cleanVarName(v.name); if (n) s.add(n); });
  walkSteps(l.steps, x => {
    if (x.type === 'setvar' && cleanVarName(x.name)) s.add(cleanVarName(x.name));
    if ((x.type === 'imgclick' || x.type === 'textclick') && cleanVarName(x.saveTo)) s.add(cleanVarName(x.saveTo));
  });
  return [...s];
}
/* 아직 안 쓴 기본 이미지 이름 (이미지1, 이미지2 …) */
function freeImgName(l) { const used = new Set(imgNames(l)); let n = 1; while (used.has(`이미지${n}`)) n++; return `이미지${n}`; }
function imgNames(l) {
  const s = new Set();
  walkSteps(l.steps, x => { if (x.type === 'imgclick' || (x.type === 'if' && x.what === 'img')) { const n = cleanImgName(x.img); if (n) s.add(n); } });
  return [...s];
}
/* 반복문 밖에 놓인 "반복 빠져나가기"(갈 곳이 없음) */
let ORPHAN = new Set();
function refreshOrphans(l) {
  ORPHAN = new Set();
  (function rec(steps, inRep) {
    (steps || []).forEach(s => {
      if (s.type === 'break' && !inRep) ORPHAN.add(s.id);
      const cl = childListsOf(s);
      if (cl) cl.forEach(c => rec(s[c.key], inRep || s.type === 'repeat'));
    });
  })(l.steps, false);
}

/* ===== 상태 ===== */
let state = normalize(store.get(null));
let activeId = state.loops[0].id;

function normalize(s) {
  if (!s || !Array.isArray(s.loops) || s.loops.length === 0) s = seed();
  s.screen = s.screen && s.screen.w ? s.screen : { w: 1920, h: 1080 };
  // 내 단축키 (직접 만들어 이름 붙여 저장한 키 조합) — 모든 작업방에서 같이 씀
  if (!Array.isArray(s.myKeys)) s.myKeys = [];
  s.myKeys = s.myKeys.filter(k => k && k.id).map(k => ({ id: String(k.id), name: String(k.name || '내 단축키'), combo: String(k.combo || '') }));
  s.loops.forEach(l => {
    if (!l.id) l.id = uid();
    if (typeof l.gap !== 'number') l.gap = 0.5;
    if (typeof l.delay !== 'number') l.delay = 3;
    if (typeof l.startAt !== 'string') l.startAt = '';
    if (typeof l.imgDir !== 'string') l.imgDir = 'images';
    if (!Array.isArray(l.vars)) l.vars = [];
    if (!Array.isArray(l.steps)) l.steps = [];
    l.steps.forEach(migrateStep);
    // 옛 "작업방 반복 횟수"를 "반복문" 동작으로 감싸 그대로 유지
    if (typeof l.repeat === 'number' && l.repeat !== 1 && l.steps.length) {
      l.steps = [{ id: uid(), type: 'repeat', count: Math.max(0, l.repeat), alias: '', children: l.steps }];
    }
    delete l.repeat;
  });
  return s;
}

/* 저장된 옛 동작을 새 구조로 맞춤(아이디·묶음 배열 보강, 옛 조건·이미지 슬롯 변환) */
function migrateStep(s) {
  if (!s.id) s.id = uid();
  if (s.type === 'if') {
    if (!Array.isArray(s.children)) {
      // 옛 조건: onTrue/onFalse(continue|stop|skip) → 맞으면/아니면 동작 목록으로
      s.children = s.onTrue === 'stop' ? [{ id: uid(), type: 'stop' }] : [];
      s.elseChildren = s.onFalse === 'stop' ? [{ id: uid(), type: 'stop' }] : [];
    }
    if (!Array.isArray(s.elseChildren)) s.elseChildren = [];
    delete s.onTrue; delete s.onFalse; delete s.skip; delete s.skipElse;
    if (!s.what) s.what = 'region';
  }
  if (s.type === 'repeat') {
    if (!Array.isArray(s.children)) s.children = [];
    if (s.count == null || s.count === '') s.count = 1;
  }
  if (s.type === 'hotkey') {
    // 옛 "직접 입력"(수식키 버튼 + 키 하나) → 글로 적는 키 조합 "Ctrl+Shift+N"
    if (s.preset === 'custom' && s.combo == null) s.combo = [...(s.mods || []).map(m => MOD_LABEL[m] || m), s.key].filter(Boolean).join('+');
    delete s.mods; delete s.key;
    if (!s.preset || (!HOTKEYS[s.preset] && !String(s.preset).startsWith('my:'))) s.preset = s.combo ? 'custom' : 'copy';
  }
  if (s.type === 'imgclick') {
    // 옛 "슬롯 번호" → 이미지 이름 (옛 파일 template_N.png 그대로 찾음)
    if (s.img == null || s.img === '') s.img = 'template_' + (num(s.slot) || 1);
    delete s.slot; delete s.skipN;
    if (s.notfound === 'skip') s.notfound = 'continue';
    if (!NF[s.notfound]) s.notfound = 'pause';
    if (!ACT[s.act]) s.act = 'click';
    if (s.sim == null) s.sim = 100;
    if (s.tol == null) s.tol = 25;
    if (s.nth == null) s.nth = 1;
    if (!s.area) s.area = 'screen';
    if (!s.region) s.region = { x1: 0, y1: 0, x2: 800, y2: 600 };
    if (s.dx == null) s.dx = 0;
    if (s.dy == null) s.dy = 0;
    if (s.retries == null) s.retries = 8;
    if (s.every == null) s.every = 0.7;
  }
  const cl = childListsOf(s);
  if (cl) cl.forEach(c => (s[c.key] || (s[c.key] = [])).forEach(migrateStep));
}

function seed() {
  return {
    screen: { w: 1920, h: 1080 },
    loops: [{
      id: uid(), name: '예시: 복사해서 다른 창에 붙여넣기', delay: 3, gap: 0.5, startAt: '', imgDir: 'images', vars: [],
      steps: [
        { id: uid(), type: 'win', title: '엑셀' },
        { id: uid(), type: 'click', x: 600, y: 320, button: 'left', double: false },
        { id: uid(), type: 'hotkey', preset: 'copy' },
        { id: uid(), type: 'wait', sec: 1 },
        { id: uid(), type: 'hotkey', preset: 'alttab' },
        { id: uid(), type: 'click', x: 880, y: 500, button: 'left', double: false },
        { id: uid(), type: 'hotkey', preset: 'paste' },
      ],
    }],
  };
}

/* 트리에서 id로 동작을 찾아 {arr, idx, step, parent} 반환 */
function locate(id, steps, parent) {
  steps = steps || activeLoop().steps;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].id === id) return { arr: steps, idx: i, step: steps[i], parent: parent || null };
    const cl = childListsOf(steps[i]);
    if (cl) for (const c of cl) {
      const r = locate(id, steps[i][c.key] || [], steps[i]);
      if (r) return r;
    }
  }
  return null;
}
/* id가 가리키는 동작의 하위 목록 배열(묶음 추가용) */
function listOf(parentId, key) {
  if (parentId == null) return activeLoop().steps;
  const r = locate(parentId);
  if (!r) return null;
  return r.step[key] || (r.step[key] = []);
}
function flatChildren(s) { const out = []; const cl = childListsOf(s); if (cl) cl.forEach(c => walkSteps(s[c.key] || [], x => out.push(x))); return out; }

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

/* ===== 렌더: 작업방 칩 ===== */
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

/* ===== 렌더: 작업방 설정 ===== */
function renderSettings() {
  const l = activeLoop();
  $('#loop-name').value = l.name;
  $('#loop-delay').value = l.delay;
  $('#loop-gap').value = l.gap;
  $('#loop-startat').value = l.startAt || '';
  $('#loop-imgdir').value = l.imgDir || 'images';
  renderVars();
}
$('#loop-name').oninput = e => { activeLoop().name = e.target.value; save(); renderChips(); };
$('#loop-delay').oninput = e => { activeLoop().delay = Math.max(0, parseFloat(e.target.value) || 0); save(); };
$('#loop-gap').oninput = e => { activeLoop().gap = Math.max(0, parseFloat(e.target.value) || 0); save(); };
$('#loop-startat').oninput = e => { activeLoop().startAt = e.target.value || ''; save(); };
$('#loop-imgdir').oninput = e => { activeLoop().imgDir = e.target.value; save(); };

/* 변수 목록 (작업방마다 "처음 값"). 실행 중 "변수에 값 저장"으로 바뀌고, 받은 폴더의 variables.txt 로도 고칠 수 있음 */
function renderVars() {
  const l = activeLoop(), box = $('#var-list');
  box.innerHTML = '';
  (l.vars || []).forEach((v, i) => {
      const row = document.createElement('div');
    row.className = 'var-row';
    row.innerHTML = `<input type="text" class="var-name" placeholder="이름" autocomplete="off" aria-label="변수 이름">`
      + `<input type="text" class="var-val" placeholder="처음 값" autocomplete="off" aria-label="처음 값">`
      + `<button class="mini ghost danger" aria-label="변수 삭제">✕</button>`
      + `<em class="var-dup" hidden></em>`;
    const [ni, vi] = row.querySelectorAll('input');
    ni.value = v.name || ''; vi.value = v.value || '';
    // 칸을 다시 그리지 않고 경고만 바꿈 → 이름 칸에서 값 칸으로 바로 넘어가도 입력이 끊기지 않음
    ni.oninput = () => { v.name = ni.value; save(); varHints(); };
    ni.onchange = () => { v.name = cleanVarName(ni.value); if (ni.value !== v.name) ni.value = v.name; save(); varHints(); };
    vi.oninput = () => { v.value = vi.value; save(); };
    row.querySelector('button').onclick = () => { l.vars.splice(i, 1); save(); renderVars(); };
    box.appendChild(row);
  });
  $('#var-empty').hidden = (l.vars || []).length > 0;
  varHints();
}
/* 변수 이름 경고(빈 이름·같은 이름)만 다시 표시 */
function varHints() {
  const l = activeLoop(), seen = new Set();
  $('#var-list').querySelectorAll('.var-row').forEach((row, i) => {
    const v = (l.vars || [])[i], em = row.querySelector('.var-dup'); if (!v || !em) return;
    const nm = cleanVarName(v.name);
    const msg = !nm ? '이름을 적어 주세요' : seen.has(nm) ? '같은 이름이 위에 있어요 — 같은 변수로 취급되고 아래 값이 쓰여요' : '';
    if (nm) seen.add(nm);
    em.textContent = msg; em.hidden = !msg;
  });
}
$('#add-var').onclick = () => {
  const l = activeLoop(); l.vars = l.vars || [];
  let n = l.vars.length + 1; while (l.vars.some(v => v.name === `변수${n}`)) n++;
  l.vars.push({ name: `변수${n}`, value: '' }); save(); renderVars();
};

/* ===== 동작 한 줄 설명 ===== */
function stepDesc(s) {
  const al = s.alias ? `[${s.alias}] ` : '';
  switch (s.type) {
    case 'url': return `${s.url || '(주소 없음)'}`;
    case 'move': return `화면 X ${s.x}, Y ${s.y} 로 이동`;
    case 'click': return `X ${s.x}, Y ${s.y} ${s.double ? '더블' : ''}${s.button === 'right' ? '우' : s.button === 'middle' ? '가운데' : ''}클릭`;
    case 'drag': return `X ${s.x1},${s.y1} → X ${s.x2},${s.y2} 끌기`;
    case 'hotkey': {
      const rk = resolveHotkey(s);
      if (!rk) return (HOTKEYS[s.preset] || {}).label || '단축키';
      const pc = prettyCombo(rk.combo) || '(비어있음)';
      return rk.label ? `${rk.label} (${pc})` : pc;
    }
    case 'text': return `"${(s.text || '').slice(0, 24)}" 입력`;
    case 'win': return `제목에 "${s.title}" 있는 창 앞으로`;
    case 'scroll': return `${s.dir === 'up' ? '위' : '아래'}로 ${s.amount}칸 스크롤`;
    case 'wait': return `${s.sec}초 기다리기`;
    case 'imgclick': return `이미지 '${cleanImgName(s.img) || '?'}' ${findDesc(s)}`;
    case 'textclick': return `글자 '${String(s.text || '').slice(0, 16)}' ${findDesc(s)}`;
    case 'readput': return `영역의 ${s.read === 'number' ? '숫자' : '글자'}를 읽어 붙여넣기${s.after && s.after !== 'none' ? ` → ${s.after === 'enter' ? '엔터' : '탭'}` : ''}`;
    case 'setvar': {
      const n = cleanVarName(s.name) || '?';
      if (s.from === 'read') return `{${n}} ← 화면 영역의 ${s.read === 'number' ? '숫자' : '글자'}`;
      if (s.from === 'clip') return `{${n}} ← 클립보드(복사한 값)`;
      return `{${n}} ← "${String(s.value ?? '').slice(0, 20)}"`;
    }
    case 'repeat': { const n = countOf(s.children); return al + `${num(s.count) > 0 ? `${num(s.count)}번 반복` : '멈출 때까지 반복'} (동작 ${n}개)`; }
    case 'if': return al + condDesc(s);
    case 'break': return '가장 가까운 반복문을 끝내고 그다음으로';
    case 'stop': return '매크로를 끝내요';
    default: return '';
  }
}
function countOf(arr) { return Array.isArray(arr) ? arr.length : 0; }
function findDesc(s) {
  const act = s.act === 'none' ? '찾기만' : s.act === 'move' ? '찾아 이동'
    : `찾아 ${s.double ? '더블' : ''}${s.button === 'right' ? '우' : s.button === 'middle' ? '가운데' : ''}클릭`;
  const nth = num(s.nth) > 1 ? `${num(s.nth)}번째 ` : '';
  const nf = s.notfound === 'continue' ? '넘어감' : s.notfound === 'stop' ? '멈춤' : '일시정지';
  return `${nth}${act} (못 찾으면 ${nf})`;
}

function condDesc(s) {
  const t = countOf(s.children), e = countOf(s.elseChildren);
  const tail = ` → 동작 ${t}개 실행${e ? ` / 아니면 ${e}개` : ''}`;
  const what = s.what || 'region';
  if (what === 'img') return `이미지 '${cleanImgName(s.img) || '?'}'가 ${s.op === 'no' ? '안 보이면' : '보이면'}${tail}`;
  if (what === 'text') return `글자 '${String(s.text || '').slice(0, 14)}'가 ${s.op === 'no' ? '안 보이면' : '보이면'}${tail}`;
  const kind = s.read === 'text' ? '글자' : '숫자';
  const ops = s.read === 'text' ? OPS_TEXT : OPS_NUM;
  const opL = (ops[s.op] || '').replace(/\s*\(.*\)/, '');
  const left = what === 'var' ? `변수 {${cleanVarName(s.varName) || '?'}}(${kind})` : `영역의 ${kind}`;
  let head;
  if (s.op === 'empty') head = `${left}가 비었으면`;
  else if (what === 'region' && s.src === 'region2') head = `두 영역의 ${kind}가 ${opL}이면`;
  else head = `${left}가 "${s.value ?? ''}" ${opL}이면`;
  return head + tail;
}

/* 입력이 빠졌는지 검사 (빠진 채 내보내면 엉뚱하게 동작) */
function stepIssue(s) {
  const bad = v => v === '' || v == null || !Number.isFinite(Number(v));
  const badR = r => { r = r || {}; return bad(r.x1) || bad(r.y1) || bad(r.x2) || bad(r.y2); };
  const badArea = r => badR(r) || Number(r.x2) <= Number(r.x1) || Number(r.y2) <= Number(r.y1);
  const areaIssue = x => (x.area === 'region' && badArea(x.region)) ? '찾을 네모(왼쪽<오른쪽, 위<아래)를 정하세요' : null;
  switch (s.type) {
    case 'url': { const u = (s.url || '').trim(); return (!u || u === 'https://' || u === 'http://') ? '주소를 입력하세요' : null; }
    case 'move': case 'click': return (bad(s.x) || bad(s.y)) ? '좌표(X·Y)를 입력하세요' : null;
    case 'drag': return (bad(s.x1) || bad(s.y1) || bad(s.x2) || bad(s.y2)) ? '시작·끝 좌표를 입력하세요' : null;
    case 'hotkey': { const rk = resolveHotkey(s); return rk ? parseCombo(rk.combo).error : null; }
    case 'text': return (s.text || '') === '' ? '입력할 글자가 비었어요' : null;
    case 'win': return (s.title || '').trim() === '' ? '창 제목을 입력하세요' : null;
    case 'scroll': return (bad(s.amount) || Number(s.amount) < 1) ? '스크롤 칸 수를 입력하세요' : null;
    case 'wait': return (bad(s.sec) || Number(s.sec) < 0) ? '대기 시간을 입력하세요' : null;
    case 'imgclick':
      if (!cleanImgName(s.img)) return '이미지 이름을 정하세요';
      if (bad(s.nth) || Number(s.nth) < 1) return '몇 번째인지 1 이상으로 정하세요';
      if (bad(s.retries) || Number(s.retries) < 1) return '찾는 횟수를 1 이상으로 정하세요';
      return areaIssue(s);
    case 'textclick':
      if (!String(s.text || '').trim()) return '찾을 글자를 입력하세요';
      if (bad(s.nth) || Number(s.nth) < 1) return '몇 번째인지 1 이상으로 정하세요';
      if (bad(s.retries) || Number(s.retries) < 1) return '찾는 횟수를 1 이상으로 정하세요';
      return areaIssue(s);
    case 'readput': return badR(s.region) ? '읽을 영역을 정하세요' : null;
    case 'setvar':
      if (!cleanVarName(s.name)) return '변수 이름을 정하세요';
      if (s.from === 'read' && badR(s.region)) return '읽을 영역을 정하세요';
      return null;
    case 'repeat': { if (bad(s.count) || Number(s.count) < 0) return '반복 횟수를 정하세요 (0=무한)'; if (!countOf(s.children)) return '반복할 동작을 넣으세요'; return null; }
    case 'if': {
      const w = s.what || 'region';
      if (w === 'img') { if (!cleanImgName(s.img)) return '이미지 이름을 정하세요'; const a = areaIssue(s); if (a) return a; }
      else if (w === 'text') { if (!String(s.text || '').trim()) return '찾을 글자를 입력하세요'; const a = areaIssue(s); if (a) return a; }
      else if (w === 'var') {
        if (!cleanVarName(s.varName)) return '확인할 변수 이름을 정하세요';
        if (s.op !== 'empty' && (s.value ?? '') === '') return '비교할 값을 입력하세요';
      } else {
        if (badR(s.region)) return '읽을 영역①을 정하세요';
        if (s.src === 'region2' && s.op !== 'empty') { if (badR(s.region2)) return '비교할 영역②를 정하세요'; }
        else if (s.op !== 'empty' && (s.value ?? '') === '') return '비교할 값을 입력하세요';
      }
      if (!countOf(s.children) && !countOf(s.elseChildren)) return '맞으면 실행할 동작을 넣으세요';
      return null;
    }
    case 'break': return ORPHAN.has(s.id) ? '반복문 안에 넣어야 해요 (밖에선 갈 곳이 없어요)' : null;
    case 'stop': return null;
    default: return null;
  }
}
function hasIssues(l) { refreshOrphans(l); return anyStep(l.steps, stepIssue); }

/* ===== 렌더: 동작 목록 ===== */
const ICON = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
};

function renderSteps() {
  const l = activeLoop();
  refreshOrphans(l);
  const ol = $('#steps');
  renderInto(ol, l.steps, null);
  $('#steps-count').textContent = l.steps.length ? `${l.steps.length}개` : '';
  $('#empty-steps').hidden = l.steps.length > 0;

  let n = 0; walkSteps(l.steps, s => { if (stepIssue(s)) n++; });
  const w = $('#step-warn');
  if (n) { w.hidden = false; w.textContent = `⚠ 입력이 빠진 동작 ${n}개 — 내보내기 전에 확인하세요`; }
  else w.hidden = true;
  renderPanel();
}

/* 한 목록(배열)을 ol 안에 그리기 — 묶음이면 하위 목록까지 재귀 */
function renderInto(ol, arr, parentId) {
  ol.innerHTML = '';
  if (!arr.length && parentId != null) {
    const em = document.createElement('li');
    em.className = 'child-empty'; em.textContent = '여기에 동작을 넣으세요 (끌어다 놓아도 돼요)';
    ol.appendChild(em); return;
  }
  arr.forEach((s, i) => ol.appendChild(stepLi(s, i)));
}

function stepLi(s, i) {
  const t = TYPES[s.type] || { ico: '•', label: s.type };
  const issue = stepIssue(s);
  const li = document.createElement('li');
  li.className = 'step' + (issue ? ' warn' : '') + (isContainer(s) ? ' container' : '');
  li.dataset.id = s.id;
  const title = s.alias
    ? `${escapeHtml(s.alias)}<small class="st-kind">${escapeHtml(t.label.replace(/\s*\(.*\)/, ''))}</small>`
    : escapeHtml(t.label);
  li.innerHTML = `
    <div class="step-head">
      <span class="num drag-handle" title="끌어서 이동">${i + 1}</span>
      <div class="st-main">
        <div class="st-type"><span class="st-ico">${t.ico}</span>${title}</div>
        <div class="st-desc">${escapeHtml(stepDesc(s))}</div>
        ${issue ? `<div class="st-issue">⚠ ${escapeHtml(issue)}</div>` : ''}
      </div>
      <div class="step-actions">
        <button data-act="up" aria-label="위로">${ICON.up}</button>
        <button data-act="down" aria-label="아래로">${ICON.down}</button>
        <button data-act="del" aria-label="삭제" class="danger">${ICON.trash}</button>
      </div>
    </div>`;
  li.querySelector('.st-main').onclick = () => openStepSheet(s.id);
  li.querySelectorAll('.step-actions button').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); stepAction(btn.dataset.act, s.id); };
  });
  li.querySelector('.drag-handle').addEventListener('pointerdown', e => startStepDrag(e, s.id));

  const cl = childListsOf(s);
  if (cl) {
    const wrap = document.createElement('div');
    wrap.className = 'step-children';
    const open = document.createElement('button');
    open.className = 'child-open'; open.textContent = '⤢ 옆 화면에 크게 열어 보기·고치기';
    open.onclick = () => openPanel(s.id);
    wrap.appendChild(open);
    cl.forEach(c => {
      const kids = s[c.key] || (s[c.key] = []);
      const sec = document.createElement('div'); sec.className = 'child-sec';
      const head = document.createElement('div'); head.className = 'child-head';
      const lbl = document.createElement('span'); lbl.textContent = c.label;
      const add = document.createElement('button'); add.className = 'child-add'; add.textContent = '+ 동작 넣기';
      add.onclick = () => openStepSheet(null, s.id, c.key);
      head.append(lbl, add);
      const sub = document.createElement('ol'); sub.className = 'steps child-list';
      sub.dataset.parent = s.id; sub.dataset.key = c.key;
      renderInto(sub, kids, s.id);
      sec.append(head, sub);
      wrap.appendChild(sec);
    });
    li.appendChild(wrap);
  }
  return li;
}

/* 드래그로 이동 (터치·마우스 공용, 묶음 안으로도 이동 가능) */
let dragId = null;
/* 묶음 s(또는 그 안의 묶음)가 가진 하위 목록인지 — 자기 안으로는 못 옮김 */
function ownsList(s, arr) { return [s, ...flatChildren(s)].some(x => (childListsOf(x) || []).some(c => x[c.key] === arr)); }
/* id 동작을 arr 의 at 자리로 옮김. 실제로 바뀌었으면 true */
function placeStep(id, arr, at) {
  const d = locate(id);
  if (!d || !arr || ownsList(d.step, arr)) return false;
  if (d.arr === arr && (at === d.idx || at === d.idx + 1)) return false;   // 제자리
  const [moved] = d.arr.splice(d.idx, 1);
  if (d.arr === arr && at > d.idx) at--;
  arr.splice(Math.max(0, Math.min(at, arr.length)), 0, moved);
  return true;
}
function moveBefore(id, overId) { const o = locate(overId); return !!o && o.step.id !== id && placeStep(id, o.arr, o.idx); }
function moveAfter(id, overId) { const o = locate(overId); return !!o && o.step.id !== id && placeStep(id, o.arr, o.idx + 1); }
function moveToEnd(id, parentId, key) { const arr = listOf(parentId, key); return !!arr && parentId !== id && placeStep(id, arr, arr.length); }
function startStepDrag(e, id) {
  if (e.button != null && e.button > 0) return;           // 왼쪽/터치만
  const li = e.target.closest('.step');
  if (!li) return;
  e.preventDefault();
  dragId = id;
  li.classList.add('dragging');
  // 터치: 손가락 아래 칸이 다시 그려져도 끌기가 끊기지 않게 이벤트를 body 로 고정
  try { document.body.setPointerCapture(e.pointerId); } catch {}
  // 같은 동작이 본 목록과 옆 화면에 함께 보일 수 있어 모두 표시
  const reapply = () => { save(); renderSteps(); document.querySelectorAll(`.step[data-id="${dragId}"]`).forEach(nl => nl.classList.add('dragging')); };
  const onMove = ev => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el) return;
    const empty = el.closest('.child-empty');
    if (empty) {
      const sub = empty.closest('.child-list');
      if (sub && moveToEnd(dragId, sub.dataset.parent, sub.dataset.key)) reapply();
      return;
    }
    // 동작의 머리줄(번호·이름) 위에서만 자리를 정함 — 묶음 안 빈틈에서 밖으로 튀어나가지 않게
    const head = el.closest('.step-head');
    if (head) {
      const over = head.parentElement;
      if (!over || !over.dataset.id || over.dataset.id === dragId || over.closest('.dragging')) return;
      const r = head.getBoundingClientRect();
      const lower = ev.clientY > r.top + r.height / 2;
      // 아래 절반 = 그 동작 뒤로 (묶음은 아래가 "안에 담긴 칸"이라 늘 앞으로)
      const moved = lower && !over.classList.contains('container') ? moveAfter(dragId, over.dataset.id) : moveBefore(dragId, over.dataset.id);
      if (moved) reapply();
      return;
    }
    // 목록의 마지막 동작 아래 빈 곳 → 그 목록 맨 끝으로
    const list = el.closest('ol.steps');
    if (list && el === list) {
      const last = list.lastElementChild;
      if (last && ev.clientY > last.getBoundingClientRect().bottom && moveToEnd(dragId, list.dataset.parent || null, list.dataset.key || null)) reapply();
    }
  };
  const onUp = () => {
    try { document.body.releasePointerCapture(e.pointerId); } catch {}
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    dragId = null; save(); renderSteps();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function stepAction(act, id) {
  const r = locate(id);
  if (!r) return;
  const { arr, idx } = r;
  if (act === 'del') {
    const removed = arr.splice(idx, 1)[0]; save(); renderSteps();
    toastAction('동작을 지웠어요', '되돌리기', () => {
      arr.splice(Math.min(idx, arr.length), 0, removed); save(); renderAll();
    });
    return;
  }
  if (act === 'up' && idx > 0) { [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; }
  else if (act === 'down' && idx < arr.length - 1) { [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; }
  save(); renderSteps();
}

/* ===== 옆 화면: 묶음(반복문·조건)을 크게 열어 보고 고치기 =====
   같은 데이터를 보여주는 "창"일 뿐이라, 닫아도 담긴 동작은 그대로 저장돼 있음 */
let panelStack = [];
function openPanel(id) {
  if (panelStack[panelStack.length - 1] !== id) panelStack.push(id);
  $('#panel').hidden = false;
  document.body.classList.add('panel-open');
  renderPanel();
}
function closePanel() {
  panelStack = [];
  $('#panel').hidden = true;
  document.body.classList.remove('panel-open');
}
function renderPanel() {
  const p = $('#panel');
  if (!p || p.hidden) return;
  // 지워졌거나 다른 작업방으로 바뀌면 남아 있는 곳까지 거슬러 올라감
  while (panelStack.length && !locate(panelStack[panelStack.length - 1])) panelStack.pop();
  if (!panelStack.length) { closePanel(); return; }
  const s = locate(panelStack[panelStack.length - 1]).step;
  const t = TYPES[s.type] || { ico: '•', label: s.type };
  $('#panel-title').textContent = `${t.ico} ${s.alias || t.label.replace(/\s*\(.*\)/, '')}`;
  $('#panel-desc').textContent = stepDesc(s);
  $('#panel-back').hidden = panelStack.length < 2;
  $('#panel-crumb').textContent = panelStack.length > 1
    ? panelStack.map(id => { const r = locate(id); return r ? (r.step.alias || (TYPES[r.step.type] || {}).label || '').replace(/\s*\(.*\)/, '') : ''; }).join(' › ')
    : '';
  const body = $('#panel-body');
  body.innerHTML = '';
  const issue = stepIssue(s);
  if (issue) { const w = document.createElement('p'); w.className = 'step-warn'; w.textContent = '⚠ ' + issue; body.appendChild(w); }
  (childListsOf(s) || []).forEach(c => {
    const sec = document.createElement('section'); sec.className = 'panel-sec';
    const head = document.createElement('div'); head.className = 'child-head';
    const lbl = document.createElement('span'); lbl.textContent = c.label;
    const add = document.createElement('button'); add.className = 'child-add'; add.textContent = '+ 동작 넣기';
    add.onclick = () => openStepSheet(null, s.id, c.key);
    head.append(lbl, add);
    const ol = document.createElement('ol'); ol.className = 'steps child-list';
    ol.dataset.parent = s.id; ol.dataset.key = c.key;
    renderInto(ol, s[c.key] || (s[c.key] = []), s.id);
    sec.append(head, ol);
    body.appendChild(sec);
  });
}
$('#panel-close').onclick = closePanel;
$('#panel-back').onclick = () => { panelStack.pop(); if (!panelStack.length) closePanel(); else renderPanel(); };
$('#panel-edit').onclick = () => { const id = panelStack[panelStack.length - 1]; if (id) openStepSheet(id); };
$('#panel-play').onclick = () => { const r = locate(panelStack[panelStack.length - 1]); if (r) openPreview([r.step]); };

/* ===== 동작 추가/편집 시트 ===== */
let draft = null, editingId = null, addTarget = { parentId: null, key: null }, origDraft = null;

function openStepSheet(id, parentId, key) {
  editingId = id;
  addTarget = { parentId: parentId ?? null, key: key ?? null };
  if (id == null) draft = { type: 'click', x: 100, y: 100, button: 'left', double: false };
  else { const r = locate(id); draft = r ? JSON.parse(JSON.stringify(r.step)) : { type: 'click', x: 100, y: 100 }; }
  origDraft = JSON.parse(JSON.stringify(draft));   // 종류를 바꿨다 돌아오면 원래 설정·담긴 동작 복원용
  $('#sheet-title').textContent = id == null ? '동작 추가' : '동작 수정';
  $('#sheet-dup').hidden = id == null;
  renderSheetBody();
  showSheet('#sheet', '#sheet-bg');
}

function renderSheetBody() {
  const body = $('#sheet-body');
  const l = activeLoop();
  let html = '<div class="type-grid">';
  for (const [k, v] of Object.entries(TYPES)) {
    html += `<button class="type-opt${draft.type === k ? ' on' : ''}" data-type="${k}"><span class="ti">${v.ico}</span><span class="tl">${v.label}</span></button>`;
  }
  html += '</div>';
  html += fieldsFor(draft.type);
  // 이름 고르기 목록 (이미 쓰는 변수·이미지 이름)
  html += `<datalist id="dl-var">${varNames(l).map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>`;
  html += `<datalist id="dl-img">${imgNames(l).map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>`;
  body.innerHTML = html;
  body.querySelectorAll('[data-type]').forEach(b => { b.onclick = () => setType(b.dataset.type); });
  bindFields();
}

function setType(type) {
  if (draft && draft.type === type) return;                         // 같은 종류를 다시 누름 → 그대로
  if (origDraft && origDraft.type === type) { draft = JSON.parse(JSON.stringify(origDraft)); renderSheetBody(); return; }
  const reg = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
  const findBase = { area: 'screen', region: reg(0, 0, 800, 600), nth: 1, act: 'click', button: 'left', double: false, dx: 0, dy: 0, retries: 8, every: 0.7, notfound: 'pause', saveTo: '' };
  const d = {
    url:      { type, url: 'https://' },
    move:     { type, x: 100, y: 100 },
    click:    { type, x: 100, y: 100, button: 'left', double: false },
    drag:     { type, x1: 100, y1: 100, x2: 300, y2: 300 },
    hotkey:   { type, preset: 'copy', combo: '' },
    text:     { type, text: '' },
    win:      { type, title: '' },
    scroll:   { type, dir: 'down', amount: 3 },
    wait:     { type, sec: 1 },
    imgclick: { type, img: freeImgName(activeLoop()), tol: 25, sim: 100, bright: false, ...findBase },
    textclick:{ type, text: '', ...findBase },
    readput:  { type, read: 'text', mode: 'screen', region: reg(100, 100, 300, 150), after: 'tab' },
    setvar:   { type, name: varNames(activeLoop())[0] || '변수1', from: 'text', value: '', read: 'text', mode: 'screen', region: reg(100, 100, 300, 150) },
    repeat:   { type, alias: '', count: 3, children: [] },
    if:       { type, alias: '', what: 'region', read: 'number', mode: 'screen', region: reg(100, 100, 300, 150), src: 'const', op: 'ge', value: '', mode2: 'screen', region2: reg(100, 300, 300, 350),
                varName: '', img: '', text: '', area: 'screen', tol: 25, sim: 100, bright: false, children: [], elseChildren: [] },
    break:    { type },
    stop:     { type },
  };
  // 묶음 동작은 기존 하위 동작·별명을 보존(종류만 바꿀 때)
  const keep = {};
  if (draft) {
    (childListsOf({ type }) || []).forEach(c => { if (Array.isArray(draft[c.key])) keep[c.key] = draft[c.key]; });
    if (isContainer({ type }) && draft.alias) keep.alias = draft.alias;
  }
  draft = Object.assign(d[type], keep);
  renderSheetBody();
}

/* --- 시트 입력칸 만들기 도우미 --- */
function getK(k) { if (k.includes('.')) { const [a, b] = k.split('.'); return (draft[a] || {})[b]; } return draft[k]; }
function inpT(lbl, k, ph, extra) { return `<label class="field"><span>${lbl}</span><input type="text" data-k="${k}" value="${escapeHtml(String(getK(k) ?? ''))}" placeholder="${escapeHtml(ph || '')}" autocomplete="off" ${extra || ''}></label>`; }
function inpN(lbl, k, extra) { return `<label class="field"><span>${lbl}</span><input type="number" data-k="${k}" value="${escapeHtml(String(getK(k) ?? ''))}" inputmode="decimal" ${extra || ''}></label>`; }
/* 음수가 될 수 있는 좌표 칸: ± 단추로 부호 바꾸기 (아이폰 숫자 자판엔 − 키가 없어서) */
function inpNeg(lbl, k) { return `<label class="field"><span>${lbl}</span><span class="neg-row"><input type="number" data-k="${k}" value="${escapeHtml(String(getK(k) ?? ''))}" inputmode="decimal"><button type="button" class="chip-btn pm" data-neg="${k}" aria-label="부호 바꾸기">±</button></span></label>`; }
function chips(lbl, group, opts) { return `<div class="field">${lbl ? `<span>${lbl}</span>` : ''}<div class="chk-row" data-group="${group}">${Object.entries(opts).map(([v, t]) => chk(group, v, t)).join('')}</div></div>`; }
function toggle(group, label) { return `<div class="field"><div class="chk-row" data-group="${group}">${chk(group, true, label, draft[group] === true)}</div></div>`; }
function selF(lbl, k, opts) { return `<label class="field"><span>${lbl}</span><select data-k="${k}">${Object.entries(opts).map(([v, t]) => `<option value="${v}"${String(draft[k]) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`; }
function varHint() {
  const names = varNames(activeLoop());
  return `<p class="hint"><b>{변수이름}</b>을 넣으면 실행할 때 그 값으로 바뀌어요.${names.length ? ` 지금 변수: ${names.map(n => `<code>{${escapeHtml(n)}}</code>`).join(' ')}` : ' (작업방 설정에서 변수를 만들 수 있어요)'}</p>`;
}
/* 화면 좌표/커서 기준 네모 입력 (조건·읽기용) */
function regionInputs(regKey, modeKey, title) {
  const obj = draft[regKey] || (draft[regKey] = { x1: 100, y1: 100, x2: 300, y2: 150 });
  const cur = draft[modeKey] === 'cursor';
  const rin = (lbl, key) => inpNeg(lbl, `${regKey}.${key}`);
  return `<div class="field"><span>${title} 기준</span><div class="chk-row" data-group="${modeKey}">${chk(modeKey, 'screen', '화면 좌표')}${chk(modeKey, 'cursor', '커서 기준')}</div></div>
    <div class="two">${rin(cur ? '왼쪽(−/＋)' : '왼쪽 X', 'x1')}${rin(cur ? '위(−/＋)' : '위 Y', 'y1')}</div>
    <div class="two">${rin(cur ? '오른쪽' : '오른쪽 X', 'x2')}${rin(cur ? '아래' : '아래 Y', 'y2')}</div>`;
}
/* 이미지·글자를 찾을 범위 */
function areaBlock() {
  if (!draft.region) draft.region = { x1: 0, y1: 0, x2: 800, y2: 600 };
  return chips('찾을 범위', 'area', { screen: '화면 전체', region: '지정한 네모 안만' })
    + (draft.area === 'region'
      ? `<div class="two">${inpNeg('왼쪽 X', 'region.x1')}${inpNeg('위 Y', 'region.y1')}</div><div class="two">${inpNeg('오른쪽 X', 'region.x2')}${inpNeg('아래 Y', 'region.y2')}</div>
         <p class="hint">범위를 좁히면 더 빠르고, 같은 것이 여러 개일 때 엉뚱한 걸 덜 골라요. "영역 선택 도우미"로 네 숫자를 구하세요.</p>`
      : `<p class="hint">지금 <b>화면에 보이는 모습</b>에서 찾아요(뒤에 가려진 창·스크롤 밖은 못 찾아요).</p>`);
}
/* 찾은 다음 할 일 */
function actBlock() {
  let h = chips('찾으면', 'act', ACT);
  if (draft.act === 'click') h += chips('버튼', 'button', { left: '왼쪽', right: '오른쪽', middle: '가운데' }) + toggle('double', '더블클릭');
  if (draft.act !== 'none') {
    h += `<div class="two">${inpNeg('위치 보정 X (＋오른쪽)', 'dx')}${inpNeg('위치 보정 Y (＋아래)', 'dy')}</div>
      <p class="hint">찾은 곳 <b>가운데</b>에서 이만큼 옮겨 누르거나 이동해요. 예: 글자 "이메일" 오른쪽 입력칸 → X에 120</p>`;
  } else {
    h += `<p class="hint"><b>찾기만</b>은 클릭 없이 <b>나타날 때까지 기다리는</b> 용도예요(예: 페이지 로딩이 끝나면 보이는 버튼). 아래 "간격 × 횟수"가 최대로 기다리는 시간이에요.</p>`;
  }
  return h;
}
/* 다시 찾기·못 찾을 때·결과 저장 */
function retryBlock() {
  return `<div class="two">${inpN('몇 초마다 다시 찾기', 'every', 'min="0.1" step="0.1"')}${inpN('몇 번까지', 'retries', 'min="1"')}</div>
    <p class="hint">간격 × 횟수 = 최대로 찾는 시간.</p>
    ${selF('끝내 못 찾으면', 'notfound', NF)}
    ${draft.notfound === 'pause' ? `<p class="hint">검은 실행 창에 <b>"화면에서 찾을 수 없어요"</b> 오류가 뜨고 멈춰요. 화면을 맞춘 뒤 <b>${CTRL_KEYS.pauseLabel}</b> = 다시 찾기, <b>${CTRL_KEYS.startNowLabel}</b> = 이 동작 건너뛰기, <b>${CTRL_KEYS.stopLabel}</b> = 종료. (엉뚱한 곳을 누르는 대신 멈춰서 확인해요)</p>` : ''}
    ${inpT('결과를 변수에 저장 (선택)', 'saveTo', '예: 찾음', 'list="dl-var"')}
    <p class="hint">적으면 찾았을 때 <code>1</code>, 못 찾았을 때 <code>0</code>이 그 변수에 들어가요. 조건에서 "변수 값"으로 확인할 수 있어요.</p>`;
}
/* 이미지 닮은 정도 */
function likeBlock() {
  return chips('색 차이 허용', 'tol', { 40: '느슨', 25: '보통', 15: '엄격' })
    + chips('닮은 정도', 'sim', SIMS)
    + `<p class="hint"><b>똑같이</b>=모든 점이 맞아야 함. 낮출수록 일부가 달라도 찾지만, 비슷한 다른 그림을 고를 위험도 커져요. 표 안 <b>값이 바뀌는 칸은 빼고</b> 제목·버튼처럼 안 바뀌는 부분만 캡처하세요.</p>`
    + toggle('bright', '밝기 차이 무시 (무설치·파이썬)')
    + `<p class="hint">화면이 전체적으로 밝아지거나 어두워져도 찾아요(무늬로 비교). 모양·각도·크기가 다른 사진은 찾지 못해요.</p>`;
}

/* --- 단축키 직접 만들기: 글로 적기 + 도우미 버튼 + (PC) 키보드로 눌러 입력 + 해석 미리보기 --- */
function setK(k, v) { if (k.includes('.')) { const [a, b] = k.split('.'); (draft[a] = draft[a] || {})[b] = v; } else draft[k] = v; }
function comboPreview(text) {
  const p = parseCombo(text);
  if (p.error) return { bad: true, html: '⚠ ' + escapeHtml(p.error) };
  return { bad: false, html: '→ ' + p.chords.map(c => `<b>${escapeHtml(chordLabel(c))}</b>`).join(' 다음 ') + (p.chords.length > 1 ? ' (차례로 누름)' : ' (함께 누름)') };
}
let captureTarget = null;   // "키보드로 눌러 입력" 중인 칸
function comboEditor(k) {
  const val = String(getK(k) ?? '');
  const pv = comboPreview(val);
  const rec = captureTarget === k;
  return `<label class="field"><span>누를 키 (직접 적기)</span><input type="text" data-k="${k}" data-combo="1" value="${escapeHtml(val)}" placeholder="예: Ctrl+Shift+N  /  Win+R  /  Alt, F, X" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
    <div class="combo-tools">
      ${['Ctrl+', 'Shift+', 'Alt+', 'Win+'].map(t => `<button class="chip-btn" data-append="${t}" data-target="${k}">${t}</button>`).join('')}
      <button class="chip-btn" data-append=", " data-target="${k}">, 다음 키</button>
      <button class="chip-btn" data-clear="${k}">지우기</button>
      <button class="chip-btn rec${rec ? ' on' : ''}" data-capture="${k}">${rec ? '⏺ 지금 키를 누르세요… (Esc 취소)' : '⌨ 키보드로 눌러 입력 (PC)'}</button>
    </div>
    <p class="combo-preview${pv.bad ? ' bad' : ''}" data-preview="${k}">${pv.html}</p>
    <p class="hint"><b>+</b> = 함께 누르기, <b>쉼표(,)</b> = 차례로 누르기. 예) <code>Ctrl+Shift+N</code> · <code>Win+R</code> · <code>Alt+F4</code> · <code>Alt, F, X</code><br>
      쓸 수 있는 키: 영문·숫자, <code>f1~f12</code>, <code>enter</code> <code>tab</code> <code>esc</code> <code>space</code> <code>backspace</code> <code>delete</code> <code>home</code> <code>end</code> <code>pageup</code> <code>pagedown</code> <code>up</code> <code>down</code> <code>left</code> <code>right</code>, 기호 <code>; = - . / [ ] \\ '</code>(쉼표 키는 <code>comma</code>). 한글 자판으로 쳐도 같은 자리 키로 알아들어요(ㅜ → N).<br>
      PC에선 "키보드로 눌러 입력"을 누르고 원하는 키를 누르면 바로 적혀요. Ctrl+W·Alt+F4처럼 브라우저가 먼저 가로채는 키는 글로 적으세요.</p>`;
}
/* PC 키보드로 누른 조합을 글로 바꿔 칸에 넣음 (끝이 쉼표면 뒤에 이어 붙임 = 차례로) */
const CODE_KEY = { Enter: 'enter', NumpadEnter: 'enter', Tab: 'tab', Escape: 'esc', Space: 'space', Backspace: 'backspace', Delete: 'delete', Insert: 'insert',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  PrintScreen: 'printscreen', ContextMenu: 'apps', CapsLock: 'capslock', Semicolon: ';', Equal: '=', Comma: 'comma', Minus: '-', Period: '.',
  Slash: '/', Backquote: '`', BracketLeft: '[', Backslash: '\\', BracketRight: ']', Quote: "'" };
document.addEventListener('keydown', e => {
  if (!captureTarget) return;
  e.preventDefault(); e.stopPropagation();
  const code = e.code || '';
  if (code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { captureTarget = null; renderSheetBody(); return; }
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = code.slice(6);
  else if (/^F([1-9]|1[0-2])$/.test(code)) key = code;
  else if (CODE_KEY[code]) key = CODE_KEY[code];
  if (!key) return;                                   // 수식키만 누른 상태면 다음 키를 기다림
  const chord = [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', e.metaKey && 'Win', key].filter(Boolean).join('+');
  const cur = String(getK(captureTarget) ?? '');
  setK(captureTarget, /,\s*$/.test(cur) ? cur.replace(/\s*$/, ' ') + chord : chord);
  captureTarget = null;
  renderSheetBody();
}, true);
/* 내 단축키를 지우면 그걸 쓰던 동작은 같은 키의 "직접 만들기"로 바꿔 둠(동작이 깨지지 않게) */
function deleteMyKey(id) {
  const mk = myKey(id); if (!mk) return;
  state.loops.forEach(l => walkSteps(l.steps, s => { if (s.type === 'hotkey' && s.preset === 'my:' + id) { s.preset = 'custom'; s.combo = mk.combo; delete s.keyName; } }));
  state.myKeys = state.myKeys.filter(k => k.id !== id);
}

function fieldsFor(type) {
  const xy = (lx, ly, vx, vy) => `<div class="two">${inpNeg(lx, vx)}${inpNeg(ly, vy)}</div>`;
  switch (type) {
    case 'url':
      return inpT('열 주소', 'url', 'https://...') + `<p class="hint">기본 브라우저에서 이 주소를 열어요. 뒤에 "몇 초 대기"나 "이미지 찾기(찾기만)"로 페이지가 뜰 때까지 기다리세요.</p>` + varHint();
    case 'move':
      return xy('가로 X', '세로 Y', 'x', 'y') + coordHint();
    case 'click':
      return xy('가로 X', '세로 Y', 'x', 'y') + coordHint()
        + chips('버튼', 'button', { left: '왼쪽', right: '오른쪽', middle: '가운데' }) + toggle('double', '더블클릭');
    case 'drag':
      return `<p class="hint">시작 위치에서 누른 채로 끝 위치까지 끌어요.</p>`
        + xy('시작 X', '시작 Y', 'x1', 'y1') + xy('끝 X', '끝 Y', 'x2', 'y2') + coordHint();
    case 'hotkey': {
      // 저장된 내 단축키가 없어졌으면(지웠거나 다른 기기에서 불러옴) 이 동작에 적힌 키로 "직접 만들기"
      if (String(draft.preset).startsWith('my:') && !myKey(draft.preset.slice(3))) draft.preset = 'custom';
      const opt = (v, t) => `<option value="${escapeHtml(v)}"${String(draft.preset) === v ? ' selected' : ''}>${escapeHtml(t)}</option>`;
      const mine = state.myKeys || [];
      let h = `<label class="field"><span>단축키</span><select data-k="preset">`
        + `<optgroup label="자주 쓰는 단축키">${Object.entries(HOTKEYS).filter(([k]) => k !== 'custom').map(([k, v]) => opt(k, v.label)).join('')}</optgroup>`
        + (mine.length ? `<optgroup label="내 단축키 (직접 만든 것)">${mine.map(m => opt('my:' + m.id, `★ ${m.name}  (${prettyCombo(m.combo)})`)).join('')}</optgroup>` : '')
        + `<optgroup label="새로 만들기">${opt('custom', '✏️ 직접 만들기 (원하는 키 조합 적기)')}</optgroup></select></label>`;
      if (draft.preset === 'close') h += `<p class="hint"><b>지금 맨 앞에 있는 창</b>을 닫아요. 바탕화면이 앞이면 "윈도우 종료" 창이 뜨니, 앞에 "창 활성화"로 닫을 창을 먼저 앞으로 가져오세요.</p>`;
      if (draft.preset === 'custom') {
        h += comboEditor('combo')
          + `<button class="mini wide" data-act="save-my">★ 이 조합을 "내 단축키"로 저장 (이름 붙여 목록에서 다시 쓰기)</button>`;
      } else if (String(draft.preset).startsWith('my:')) {
        const mk = myKey(draft.preset.slice(3));
        if (!draft.myEdit || draft.myEdit.id !== mk.id) draft.myEdit = { id: mk.id, name: mk.name, combo: mk.combo };
        h += `<div class="seg-title">★ 내 단축키 고치기</div>`
          + inpT('이름', 'myEdit.name', '예: 창 닫기')
          + comboEditor('myEdit.combo')
          + `<p class="hint">여기서 고치고 저장하면 <b>이 단축키를 쓰는 모든 동작</b>이 같이 바뀌어요.</p>`
          + `<button class="mini wide ghost danger" data-act="del-my">이 내 단축키 지우기</button>`;
      } else {
        h += `<p class="hint">목록에 없는 키는 맨 아래 <b>✏️ 직접 만들기</b>에서 원하는 조합을 적어 만들 수 있어요(내 단축키로 저장 가능).</p>`;
      }
      return h;
    }
    case 'text':
      return inpT('입력할 글자', 'text', '예: 안녕하세요 {이름}님') + varHint()
        + `<p class="hint">무설치·파이썬은 클립보드로 붙여넣어 한글도 그대로 들어가요.</p>`;
    case 'win':
      return inpT('창 제목의 일부', 'title', '예: 받은편지함')
        + `<p class="hint">제목에 이 글자가 든 창을 찾아 앞으로 가져와요. 아래 "F12 소스 분석"으로 제목을 뽑을 수 있어요.</p>`;
    case 'scroll':
      return chips('방향', 'dir', { down: '아래로', up: '위로' }) + inpN('몇 칸', 'amount', 'min="1"');
    case 'wait':
      return inpN('기다릴 시간(초)', 'sec', 'min="0" step="0.5"');
    case 'imgclick': {
      const nm = cleanImgName(draft.img) || '이름';
      return `<p class="hint" style="margin-top:0">미리 찍어 둔 <b>그림(버튼·아이콘·글자 모양)</b>을 화면에서 찾아 그 자리를 눌러요. 위치가 바뀌어도 그림으로 찾아갑니다.</p>`
        + inpT('이미지 이름', 'img', '예: 확인버튼', 'list="dl-img"')
        + `<p class="hint">파일: <code>${escapeHtml(imgDirOf(activeLoop()))}\\${escapeHtml(nm)}.png</code> — 받은 폴더의 "이미지 캡처 도우미"가 이 이름으로 찍어 저장해요. 폴더 위치는 작업방 설정에서 바꿔요.</p>`
        + areaBlock()
        + inpN('여러 개면 몇 번째', 'nth', 'min="1"')
        + `<p class="hint">위→아래, 왼쪽→오른쪽 순서로 셉니다. 1 = 맨 위 첫 번째. (.ahk 는 첫 번째만)</p>`
        + likeBlock() + actBlock() + retryBlock()
        + `<p class="hint">찍을 때와 실행할 때의 <b>해상도·화면 배율(100/125/150%)이 같아야</b> 찾아요.</p>`;
    }
    case 'textclick':
      return `<p class="hint" style="margin-top:0">화면에 <b>보이는 글자를 읽어(OCR)</b> 그 위치를 눌러요. 글꼴이 바뀌어도 글자만 같으면 찾아요. <b>무설치(윈도우)·파이썬</b> 전용(.ahk 불가, 베타).</p>`
        + inpT('찾을 글자', 'text', '예: 확인') + varHint()
        + `<p class="hint">띄어쓰기·대소문자는 무시해요. 작은 글자는 "지정한 네모 안만"으로 좁히면 더 잘 읽어요.</p>`
        + areaBlock()
        + inpN('여러 개면 몇 번째', 'nth', 'min="1"')
        + `<p class="hint">위→아래, 왼쪽→오른쪽 순서로 셉니다.</p>`
        + actBlock() + retryBlock();
    case 'readput':
      return `<p class="hint" style="margin-top:0">화면 영역의 글자/숫자를 읽어 <b>지금 커서가 있는 칸에 붙여넣어요</b>(자료수집용). <b>무설치(윈도우)·파이썬</b>에서 동작(베타). .ahk 는 건너뜁니다.</p>`
        + chips('무엇을 읽나요', 'read', { text: '글자', number: '숫자만' })
        + regionInputs('region', 'mode', '영역')
        + chips('붙여넣은 뒤', 'after', { none: '없음', enter: '엔터(다음 줄)', tab: '탭(다음 칸)' })
        + `<p class="hint">반복문과 함께 쓰면 한 줄씩 자동으로 옮겨 적을 수 있어요.</p>`;
    case 'setvar': {
      let h = `<p class="hint" style="margin-top:0">값을 <b>이름 붙은 상자(변수)</b>에 담아 두고, 나중에 글자 입력·조건 등에서 <b>{이름}</b>으로 꺼내 써요.</p>`
        + inpT('변수 이름', 'name', '예: 금액', 'list="dl-var"')
        + chips('값 가져오기', 'from', SETFROM);
      if (draft.from === 'read') {
        h += chips('무엇을 읽나요', 'read', { text: '글자', number: '숫자만' }) + regionInputs('region', 'mode', '읽을 영역')
          + `<p class="hint">못 읽으면 <b>빈 값</b>이 들어가고 실행 창에 경고가 떠요. 조건 "변수 값 → 비었음"으로 <b>읽기 오류를 알아낼 수 있어요</b>. 무설치·파이썬 전용.</p>`;
      } else if (draft.from === 'clip') {
        h += `<p class="hint">바로 앞에 <b>단축키 "복사"</b>를 넣으세요. 복사된 글자가 변수에 담겨요(엑셀 칸 값 등).</p>`;
      } else {
        h += inpT('넣을 값', 'value', '예: 홍길동 또는 {다른변수}') + varHint();
      }
      return h;
    }
    case 'if': {
      if (!draft.what) draft.what = 'region';
      let h = inpT('별명 (선택)', 'alias', '예: 로그인 됐는지')
        + chips('무엇을 확인하나요', 'what', WHAT);
      const w = draft.what;
      if (w === 'img') {
        if (!OPS_SEE[draft.op]) draft.op = 'yes';
        h += inpT('이미지 이름', 'img', '예: 로딩중', 'list="dl-img"') + chips('조건', 'op', OPS_SEE) + areaBlock() + likeBlock()
          + `<p class="hint">한 번만 확인해요. "나타날 때까지 기다리기"는 <b>이미지 찾아 클릭 → 찾기만</b>을, "사라질 때까지"는 반복문 + 이 조건 + 반복 빠져나가기를 쓰세요.</p>`;
      } else if (w === 'text') {
        if (!OPS_SEE[draft.op]) draft.op = 'yes';
        h += inpT('글자', 'text', '예: 완료') + chips('조건', 'op', OPS_SEE) + areaBlock()
          + `<p class="hint">화면 글자를 읽어(OCR) 확인해요. 무설치·파이썬 전용.</p>`;
      } else {
        const ops = draft.read === 'text' ? OPS_TEXT : OPS_NUM;
        if (!ops[draft.op]) draft.op = draft.read === 'text' ? 'has' : 'ge';
        if (w === 'var') h += inpT('변수 이름', 'varName', '예: 금액', 'list="dl-var"');
        h += chips(w === 'var' ? '값을 무엇으로 볼까요' : '무엇을 읽나요', 'read', { number: '숫자', text: '글자' });
        if (w === 'region') {
          if (!draft.src) draft.src = 'const';
          h += `<div class="seg-title">영역 ①</div>` + regionInputs('region', 'mode', '영역①')
            + chips('무엇과 비교하나요', 'src', { const: '고정값', region2: '다른 영역 ②' });
        }
        const two = w === 'region' && draft.src === 'region2';
        h += selF('비교', 'op', ops);
        if (draft.op !== 'empty' && !two) h += inpT('비교할 값', 'value', draft.read === 'text' ? '예: 완료 또는 {변수}' : '예: 0 또는 {변수}');
        if (two && draft.op !== 'empty') h += `<div class="seg-title">영역 ②</div>` + regionInputs('region2', 'mode2', '영역②')
          + `<p class="hint">두 영역을 각각 읽어 비교해요. 숫자는 숫자로, 글자는 앞뒤 공백·대소문자를 무시하고 비교해요.</p>`;
        h += draft.op === 'empty'
          ? `<p class="hint"><b>비었음</b> = 화면에서 글자/숫자를 <b>못 읽었거나</b> 변수가 비어 있을 때 맞아요. 인식 오류를 알아내는 데 써요.</p>`
          : `<p class="hint">글자를 못 읽으면(빈 값) "비었음"을 뺀 모든 비교는 <b>안 맞음</b>으로 처리돼요(엉뚱하게 실행되지 않게).</p>`;
        if (w === 'region') h += `<p class="hint">"영역 선택 도우미"로 드래그해 영역 좌표를 쉽게 구할 수 있어요. 무설치·파이썬 전용.</p>`;
        else h += varHint();
      }
      return h + `<p class="hint" style="margin-top:12px">저장한 뒤 목록에서 이 조건 아래 <b>"맞으면 실행할 동작"</b>·<b>"아니면"</b> 칸에 <b>+ 동작 넣기</b>로 담으세요. 멈추려면 그 안에 <b>🛑 멈춤</b>, 반복을 끝내려면 <b>⏏️ 반복 빠져나가기</b>를 넣어요.</p>`;
    }
    case 'repeat':
      return inpT('별명 (선택)', 'alias', '예: 메일 10통 보내기')
        + `<p class="hint">안에 담은 동작들을 정한 횟수만큼 반복해요. 저장한 뒤 목록에서 <b>+ 동작 넣기</b>로 반복할 동작을 담으세요.</p>`
        + inpN('반복 횟수', 'count', 'min="0"')
        + `<p class="hint"><b>0</b>이면 멈출 때까지 무한 반복(${CTRL_KEYS.stopLabel}로 종료, 또는 안에서 "반복 빠져나가기"). 전체를 계속 돌리려면 모든 동작을 반복문 하나에 담고 0으로 두세요.</p>`;
    case 'break':
      return `<p class="hint" style="margin-top:0">자기를 감싼 <b>가장 가까운 반복문</b>을 그 자리에서 끝내고, 반복문 다음 동작으로 넘어가요. 보통 반복문 안 <b>조건</b>의 "맞으면" 칸에 넣어요.<br>예) 반복문(0=무한) 안: 조건 "이미지 '로딩중'이 안 보이면" → 반복 빠져나가기 / 대기 0.5초 → 로딩이 끝날 때까지 기다림.</p>`;
    case 'stop':
      return `<p class="hint" style="margin-top:0">이 지점에서 매크로를 <b>완전히 끝내요</b>. 보통 <b>조건</b>의 "맞으면/아니면" 칸 안에 넣어 "어떤 값이면 멈춤"처럼 써요.</p>`;
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
const RERENDER_KEYS = ['preset', 'notfound', 'op'];
function bindFields() {
  const body = $('#sheet-body');
  body.querySelectorAll('input[data-k], select[data-k]').forEach(el => {
    el.oninput = () => {
      const k = el.dataset.k;
      const v = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      // 기본 단축키에서 "직접 만들기"로 바꾸면 그 키 조합을 미리 채워 줌(고쳐 쓰기 쉽게)
      if (k === 'preset' && v === 'custom' && !draft.combo && HOTKEYS[draft.preset] && draft.preset !== 'custom') {
        draft.combo = HOTKEYS[draft.preset].py.map(p => MOD_LABEL[p] || (p.length === 1 || /^f\d+$/.test(p) ? p.toUpperCase() : (KEY_LABEL[p] || p))).join('+');
      }
      if (k.includes('.')) { const [a, b] = k.split('.'); (draft[a] = draft[a] || {})[b] = v; }
      else draft[k] = v;
      if (el.tagName === 'SELECT' && RERENDER_KEYS.includes(k)) { captureTarget = null; renderSheetBody(); }
      // 단축키 칸: 글자를 칠 때마다 해석 결과만 바꿔 보여줌(입력 중 칸이 다시 그려지지 않게)
      if (el.dataset.combo) {
        const pv = body.querySelector(`[data-preview="${k}"]`);
        if (pv) { const r = comboPreview(el.value); pv.innerHTML = r.html; pv.classList.toggle('bad', r.bad); }
      }
    };
  });
  // 단축키 도우미 버튼
  body.querySelectorAll('[data-append]').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.target, add = b.dataset.append;
      const cur = String(getK(k) ?? '');
      setK(k, add.startsWith(',') ? cur.replace(/[\s,]*$/, '') + (cur.trim() ? add : '') : cur + add);
      renderSheetBody();
      const inp = body.querySelector(`input[data-k="${k}"]`);
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    };
  });
  body.querySelectorAll('[data-neg]').forEach(b => {
    b.onclick = e => {
      e.preventDefault();
      const k = b.dataset.neg, inp = body.querySelector(`input[data-k="${k}"]`);
      const v = -(Number(getK(k)) || 0);
      setK(k, v); if (inp) inp.value = String(v);
    };
  });
  body.querySelectorAll('[data-clear]').forEach(b => { b.onclick = () => { setK(b.dataset.clear, ''); renderSheetBody(); }; });
  body.querySelectorAll('[data-capture]').forEach(b => {
    b.onclick = () => { captureTarget = captureTarget === b.dataset.capture ? null : b.dataset.capture; renderSheetBody(); };
  });
  const saveMy = body.querySelector('[data-act="save-my"]');
  if (saveMy) saveMy.onclick = () => {
    const p = parseCombo(draft.combo);
    if (p.error) { toast(p.error); return; }
    const name = (prompt('내 단축키 이름 (목록에 이 이름으로 보여요)', prettyCombo(draft.combo)) || '').replace(/[\r\n]/g, ' ').trim().slice(0, 30);
    if (!name) return;
    const mk = { id: uid(), name, combo: String(draft.combo).trim() };
    state.myKeys.push(mk);
    draft.preset = 'my:' + mk.id; draft.myEdit = { id: mk.id, name: mk.name, combo: mk.combo };
    save(); renderSheetBody(); toast(`"${name}"을(를) 내 단축키로 저장했어요`);
  };
  const delMy = body.querySelector('[data-act="del-my"]');
  if (delMy) delMy.onclick = () => {
    const id = String(draft.preset).slice(3), mk = myKey(id);
    if (!mk || !confirm(`내 단축키 "${mk.name}"을(를) 지울까요?\n이걸 쓰던 동작은 같은 키 조합(${prettyCombo(mk.combo)})으로 그대로 남아요.`)) return;
    deleteMyKey(id);
    draft.preset = 'custom'; draft.combo = mk.combo; delete draft.myEdit; delete draft.keyName;
    save(); renderSteps(); renderSheetBody(); toast('내 단축키를 지웠어요');
  };
  body.querySelectorAll('.chk').forEach(btn => {
    btn.onclick = () => {
      const g = btn.dataset.group, val = btn.dataset.value;
      if (g === 'double' || g === 'bright') { draft[g] = !draft[g]; }
      else {
        draft[g] = (g === 'tol' || g === 'sim') ? Number(val) : val;
        if (g === 'read') draft.op = (val === 'text' ? 'has' : 'ge');
        if (g === 'src' && val === 'region2') draft.op = 'eq';
        if (g === 'what') draft.op = (val === 'img' || val === 'text') ? 'yes' : (draft.read === 'text' ? 'has' : 'ge');
      }
      renderSheetBody();
    };
  });
}
/* 저장 전에 이름·숫자 정리 */
function finalizeDraft(d) {
  if (d.img != null) d.img = cleanImgName(d.img);
  if (d.type === 'setvar') d.name = cleanVarName(d.name);
  if (d.saveTo != null) d.saveTo = cleanVarName(d.saveTo);
  if (d.varName != null) d.varName = cleanVarName(d.varName);
  if (d.alias != null) d.alias = String(d.alias).replace(/[\r\n]/g, ' ').trim().slice(0, 40);
  if (d.type === 'hotkey') {
    if (String(d.preset).startsWith('my:')) {
      const mk = myKey(d.preset.slice(3));
      if (mk && d.myEdit) {   // 내 단축키를 고쳤으면 공용 정의에 반영 → 이걸 쓰는 모든 동작이 같이 바뀜
        const nm = String(d.myEdit.name || '').replace(/[\r\n]/g, ' ').trim().slice(0, 30);
        if (nm) mk.name = nm;
        if (!parseCombo(d.myEdit.combo).error) mk.combo = String(d.myEdit.combo).trim();
        else toast('키 조합이 올바르지 않아 내 단축키의 키는 바꾸지 않았어요');
      }
      if (mk) { d.combo = mk.combo; d.keyName = mk.name; } else d.preset = 'custom';   // 지워졌으면 적힌 키로
    } else if (d.preset === 'custom') {
      d.combo = String(d.combo || '').trim(); delete d.keyName;
    } else { delete d.combo; delete d.keyName; }
    delete d.myEdit;
  }
  return d;
}

/* 수정 중 종류를 바꿔 원래 담겨 있던 동작이 사라지게 되면 개수 */
function lostChildren() {
  if (editingId == null || !origDraft) return 0;
  const keep = new Set((childListsOf(draft) || []).map(c => c.key));
  return (childListsOf(origDraft) || []).filter(c => !keep.has(c.key)).reduce((n, c) => n + countOf(origDraft[c.key]), 0);
}
$('#sheet-save').onclick = () => {
  const lost = lostChildren();
  if (lost && !confirm(`종류를 바꾸면 안에 담겨 있던 동작 ${lost}개가 지워져요. 그래도 저장할까요?\n(원래 종류를 다시 누르면 그대로 돌아와요)`)) return;
  finalizeDraft(draft);
  if (editingId == null) {
    if (!draft.id) draft.id = uid();
    const arr = listOf(addTarget.parentId, addTarget.key) || activeLoop().steps;
    arr.push(draft);
  } else {
    const r = locate(editingId);
    if (r) { draft.id = editingId; r.arr[r.idx] = draft; }
    else activeLoop().steps.push(draft);
  }
  save(); renderSteps(); hideSheet('#sheet', '#sheet-bg');
};
$('#sheet-dup').onclick = () => {
  if (editingId == null) return;
  const r = locate(editingId);
  if (!r) return;
  const lost = lostChildren();
  if (lost && !confirm(`종류를 바꾸면 안에 담겨 있던 동작 ${lost}개가 지워져요. 그래도 저장할까요?`)) return;
  finalizeDraft(draft);
  draft.id = editingId; r.arr[r.idx] = draft;            // 현재 수정 내용 반영
  const copy = JSON.parse(JSON.stringify(draft));
  walkSteps([copy], s => s.id = uid());                  // 복제본은 묶음 안까지 새 아이디
  r.arr.splice(r.idx + 1, 0, copy);                      // 바로 아래에 복제본
  save(); renderSteps(); hideSheet('#sheet', '#sheet-bg'); toast('동작을 복제했어요');
};
$('#sheet-close').onclick = () => hideSheet('#sheet', '#sheet-bg');
$('#sheet-bg').onclick = () => hideSheet('#sheet', '#sheet-bg');
$('#add-step').onclick = () => openStepSheet(null);

function showSheet(s, bg) { $(bg).hidden = false; $(s).hidden = false; }
function hideSheet(s, bg) { $(bg).hidden = true; $(s).hidden = true; captureTarget = null; }

/* ===== 작업방 추가/삭제 ===== */
$('#add-loop').onclick = () => {
  const l = { id: uid(), name: `작업방 ${state.loops.length + 1}`, delay: 3, gap: 0.5, startAt: '', imgDir: 'images', vars: [], steps: [] };
  state.loops.push(l); activeId = l.id; save(); renderAll();
};
function addDeleteLoopButton() {
  if ($('#del-loop')) return;
  const sec = $('#loop-settings');
  const row = document.createElement('div');
  row.className = 'row'; row.style.marginTop = '12px';
  row.innerHTML = `<button class="mini ghost" id="dup-loop">작업방 복제</button><button class="mini ghost danger" id="del-loop" style="margin-left:auto">이 작업방 삭제</button>`;
  sec.appendChild(row);
  $('#dup-loop').onclick = () => {
    const src = activeLoop();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid(); copy.name = src.name + ' 복사';
    walkSteps(copy.steps, s => s.id = uid());
    state.loops.push(copy); activeId = copy.id; save(); renderAll(); toast('작업방을 복제했어요');
  };
  $('#del-loop').onclick = () => {
    if (state.loops.length <= 1) { toast('마지막 작업방은 지울 수 없어요'); return; }
    if (!confirm(`"${activeLoop().name}" 작업방을 삭제할까요?`)) return;
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

/* only: 옆 화면에서 "이 묶음만 미리보기" 할 때 그 묶음만 */
function openPreview(only) {
  prev.only = Array.isArray(only) ? only : null;
  buildPreviewSteps();
  resetCursor();
  $('#prev-caption').textContent = prev.only ? '이 묶음만 미리보기 — 재생을 누르세요' : '재생을 누르면 동작 순서를 차례로 보여줘요';
  $('#prev-play').textContent = '▶ 재생';
  prev.running = false; prev.playing = false; prev.cancel = true;
  showSheet('#preview', '#prev-bg');
}
function closePreview() { prev.cancel = true; prev.playing = false; prev.running = false; hideSheet('#preview', '#prev-bg'); }

/* 묶음(반복문·조건)을 풀어 실제 실행 순서처럼 납작하게 만들기(미리보기용).
   "반복 빠져나가기"를 만나면 true 를 돌려줘 감싼 반복문을 끝냄 */
function flattenPreview(steps, out) {
  for (const s of (steps || [])) {
    if (out.length >= 80) return false;        // 너무 길면 자름
    if (s.type === 'repeat') {
      const n = Number(s.count) > 0 ? Math.min(Number(s.count), 3) : 3;
      for (let k = 0; k < n; k++) { if (flattenPreview(s.children, out)) break; }
    } else if (s.type === 'if') {
      out.push(s);                             // 조건을 보여주고
      if (flattenPreview(s.children, out)) return true;   // 맞다고 가정하고 담긴 동작 재생
    } else if (s.type === 'break') {
      out.push(s); return true;
    } else {
      out.push(s);
      if (s.type === 'stop') return false;
    }
  }
  return false;
}
function previewSteps() { return prev.only || activeLoop().steps; }
function buildPreviewSteps() {
  const box = $('#prev-steps');
  box.innerHTML = '';
  prev.flat = [];
  flattenPreview(previewSteps(), prev.flat);
  prev.flat.forEach((s, i) => {
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
    case 'imgclick': case 'textclick': {
      hideRegions();
      if (s.area === 'region') drawRegion('prev-region', 'screen', s.region || {}, 'r1');
      badge(s.type === 'imgclick' ? `🖼️ '${cleanImgName(s.img)}' 찾기` : `🔤 '${String(s.text || '').slice(0, 14)}' 찾기`); setCap(stepDesc(s) + ' (미리보기는 "찾음"으로 가정)');
      const r0 = s.region || {};
      const cx = s.area === 'region' ? (num(r0.x1) + num(r0.x2)) / 2 : state.screen.w * 0.5;
      const cy = s.area === 'region' ? (num(r0.y1) + num(r0.y2)) / 2 : state.screen.h * 0.45;
      moveCursor(cx + (s.act === 'none' ? 0 : num(s.dx)), cy + (s.act === 'none' ? 0 : num(s.dy)), 400);
      let r = await wait(c(700)); if (r === 'cancel') return r;
      if (s.act === 'click' || !s.act) pulse(s.button, s.double);
      r = await wait(c(500)); hideRegions(); return r;
    }
    case 'readput': { drawRegion('prev-region', s.mode, s.region || {}, 'r1'); hideOne('prev-region2'); badge('📋 읽어 입력'); setCap(stepDesc(s)); const r = await wait(c(1300)); hideRegions(); return r; }
    case 'setvar': {
      if (s.from === 'read') drawRegion('prev-region', s.mode, s.region || {}, 'r1');
      badge(`📦 {${cleanVarName(s.name)}}`); setCap(stepDesc(s));
      const r = await wait(c(1000)); hideRegions(); return r;
    }
    case 'if': {
      const w = s.what || 'region';
      if (w === 'region') showRegions(s);
      else if ((w === 'img' || w === 'text') && s.area === 'region') drawRegion('prev-region', 'screen', s.region || {}, 'r1');
      badge(w === 'var' ? '❓ 변수 확인' : w === 'img' ? '❓ 이미지 보이나' : w === 'text' ? '❓ 글자 보이나' : (s.src === 'region2' ? '❓ 두 영역 비교' : '❓ 조건 확인'));
      setCap(condDesc(s) + ' (미리보기는 "맞음"으로 가정)'); const r = await wait(c(1500)); hideRegions(); return r;
    }
    case 'break': badge('⏏️ 반복 빠져나가기'); setCap('감싼 반복문을 끝내고 다음으로'); return wait(c(700));
    case 'stop': badge('🛑 멈춤'); setCap('여기서 매크로를 끝내요'); return wait(c(700));
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
  const steps = previewSteps();
  if (!steps.length) { toast('먼저 동작을 추가하세요'); return; }
  prev.running = true; prev.cancel = false; prev.playing = true;
  $('#prev-play').textContent = '⏸ 일시정지';
  const fast = $('#prev-fast').checked;
  resetCursor();

  const done = v => v === 'cancel';
  if (!prev.only) {
    if (l.startAt) { setCap(`예약: 다음 ${l.startAt} 까지 대기 (실행 중 F7로 즉시 시작)`); if (done(await wait(1100))) return endPreview(); }
    setCap(`시작 전 ${l.delay}초 대기`); if (done(await wait(capMs((Number(l.delay) || 0) * 1000, fast)))) return endPreview();
  }

  const flat = prev.flat || [];
  const hasInfinite = anyStep(steps, s => s.type === 'repeat' && !(Number(s.count) > 0));
  if (anyStep(steps, s => s.type === 'repeat')) setCap(`반복문은 최대 3바퀴만 미리보기${hasInfinite ? ' (무한 반복 포함)' : ''}`);
  let stopped = false;
  for (let i = 0; i < flat.length; i++) {
    if (prev.cancel) return endPreview();
    highlight(i);
    const s = flat[i];
    if (done(await doStepPreview(s, fast))) return endPreview();
    if (s.type === 'stop') { stopped = true; break; }
    if (done(await wait(capMs((Number(l.gap) || 0) * 1000, fast)))) return endPreview();
  }
  document.querySelectorAll('.pv-chip').forEach(c => c.classList.remove('on'));
  setCap(stopped ? '🛑 멈춤 동작에서 끝났어요' : '✅ 미리보기 끝 — 실제 동작 순서가 이대로예요');
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
  // ★ 파일명은 ASCII만: .bat 안에 파일명이 들어가는데, 한글 파일명이면 cmd+chcp 에서 깨짐
  let safe = String(base == null ? '' : base).replace(/[^\x20-\x7E]+/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-');
  if (safe.length < 2) safe = 'macro' + (safe ? '-' + safe : '');
  return `${safe}.${ext}`;
}
/* 받는 파일·폴더 이름 줄기(영문). 이름이 한글뿐이면 작업방 번호로 구분 (macro-1, macro-2 …) */
function stemOf(l) {
  const ascii = String(l.name == null ? '' : l.name).replace(/[^\x20-\x7E]+/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-');
  if (ascii.length >= 2) return ascii;
  const idx = state.loops.indexOf(l);
  return `macro-${idx >= 0 ? idx + 1 : 1}`;
}
function download(name, data, mime = 'text/plain;charset=utf-8') {
  // .ps1/.ahk 는 윈도우 PowerShell·AutoHotkey가 한글을 깨지 않게 UTF-8 BOM 을 붙임
  if (typeof data === 'string' && /\.(ps1|ahk)$/i.test(name) && data.charCodeAt(0) !== 0xFEFF) data = '﻿' + data;
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 40000);
}
function gapMs(l) { return Math.round((Number(l.gap) || 0) * 1000); }
function numConst(v) { const m = String(v == null ? '' : v).match(/-?\d[\d,]*(\.\d+)?/); return m ? Number(m[0].replace(/,/g, '')) : 0; }
function hhmm(startAt) { return startAt ? Number(startAt.replace(':', '')) : null; }
function hhmmParts(startAt) { if (!startAt) return null; const [hh, mm] = startAt.split(':'); return { hh: String(Number(hh)), mm: String(Number(mm)), pad: `${hh}${mm}00` }; }

function ahkStr(s) {   // ` ;` 는 AHK 에서 주석 시작으로 읽힐 수 있어 `; 로
  return String(s == null ? '' : s).replace(/`/g, '``').replace(/"/g, '`"').replace(/;/g, '`;').replace(/\r/g, '').replace(/\n/g, '`n').replace(/\t/g, '`t');
}
/* 기본 제공 단축키의 각 언어 표기 (직접 만든 키는 parseCombo → chordAHK/chordPY/chordVKs) */
function buildHotkey(s) {
  const h = HOTKEYS[s.preset] || HOTKEYS.copy;
  return { ahk: h.ahk, py: h.py, sk: h.sk, singlePy: h.py.length === 1 };
}

/* --- 글자 → 바이트, base64 (한글 안전) --- */
function utf8(s) { return new TextEncoder().encode(s); }
function b64encodeUtf8(str) {
  const bytes = utf8(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decodeUtf8(b64) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* --- 설계도: 받은 코드 파일 끝에 심어 두면, 웹에 다시 불러와 그대로 복원 --- */
const DESIGN_BEGIN = 'MACRO-STUDIO-DESIGN-BEGIN', DESIGN_END = 'MACRO-STUDIO-DESIGN-END';
function designOf(l) {
  const loop = JSON.parse(JSON.stringify(l));
  const used = [];
  walkSteps(loop.steps, s => {   // 내 단축키는 지금 키로 적어 두고(다른 기기에서도 동작), 정의도 함께 담음
    if (s.type === 'hotkey' && String(s.preset).startsWith('my:')) {
      const mk = myKey(s.preset.slice(3));
      if (mk) { s.combo = mk.combo; s.keyName = mk.name; if (!used.some(u => u.id === mk.id)) used.push({ ...mk }); }
    }
  });
  return { kind: 'macro-studio-design', v: 1, screen: state.screen, loop, myKeys: used };
}
function designBlock(l, style) {
  const b = b64encodeUtf8(JSON.stringify(designOf(l)));
  const rows = []; for (let i = 0; i < b.length; i += 76) rows.push(b.slice(i, i + 76));
  const note = '웹 "매크로 설계소"의 [불러오기]로 이 파일을 고르면 동작이 그대로 복원돼요. 코드를 직접 고친 내용은 복원되지 않아요. 아래 줄은 지우지 마세요.';
  if (style === 'ps') return ['', '<#', note, DESIGN_BEGIN, ...rows, DESIGN_END, '#>'];
  if (style === 'ahk') return ['', '/*', note, DESIGN_BEGIN, ...rows, DESIGN_END, '*/'];
  return ['', '# ' + note, '# ' + DESIGN_BEGIN, ...rows.map(r => '# ' + r), '# ' + DESIGN_END];
}
/* 붙여넣은 글 / 고른 파일에서 설계도 꺼내기: 백업 JSON, 설계도 JSON, 코드 파일(.ps1/.py/.ahk) 모두 */
function parseDesignText(text) {
  text = String(text == null ? '' : text).replace(/^﻿/, '');
  try { return JSON.parse(text); } catch { /* 코드 파일일 수 있음 */ }
  const m = text.match(/^[#\s]*MACRO-STUDIO-DESIGN-BEGIN[^\n]*\n([\s\S]*?)^[#\s]*MACRO-STUDIO-DESIGN-END/m);
  if (!m) return null;
  try { return JSON.parse(b64decodeUtf8(m[1].replace(/[#\s]/g, ''))); } catch { return null; }
}

/* --- ZIP 만들기 (압축 없이 묶기만, 외부 라이브러리 없음) --- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
/* files: [{ name: '폴더/파일', data: Uint8Array }] — data 가 null 이면 폴더 */
function zipBytes(files) {
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const locals = [], centrals = []; let offset = 0;
  for (const f of files) {
    const name = utf8(f.name);
    const data = f.data || new Uint8Array(0);
    const crc = f.data ? crc32(data) : 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    locals.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, f.data ? 0 : 0x10, true); ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

/* --- AutoHotkey v2 --- */
function genAHK(l) {
  refreshOrphans(l);
  const L = [];
  L.push('#Requires AutoHotkey v2.0', '#SingleInstance Force', 'FileEncoding "UTF-8"', 'CoordMode "Mouse", "Screen"',
    'CoordMode "Pixel", "Screen"', 'SetTitleMatchMode 2', 'SetKeyDelay 30', 'SetMouseDelay 30',
    'try DllCall("SetThreadDpiAwarenessContext", "ptr", -4, "ptr")   ; 화면 배율과 상관없이 실제 픽셀 좌표 (무설치·도우미와 같은 기준)', '');
  L.push(`; ===== 매크로: ${(l.name || '').replace(/[\r\n]/g, ' ')} =====`);
  L.push('; 이 파일을 더블클릭하면 시작합니다. (AutoHotkey v2 설치 필요)');
  L.push(`; 단축키:  ${CTRL_KEYS.pauseLabel} = 일시정지/재생   ${CTRL_KEYS.stopLabel} = 종료(Esc)   ${CTRL_KEYS.startNowLabel} = 예약 즉시 시작   ${CTRL_KEYS.restartLabel} = 처음부터 다시`);
  L.push('; ※ .ahk 는 화면 글자 읽기(OCR)를 못 해요: 글자 찾기·영역 읽기·글자 조건은 건너뜁니다.');
  L.push('');
  L.push(`imgDir := "${ahkStr(imgDirOf(l))}"   ; 이미지 폴더 (상대 경로면 이 파일이 있는 폴더 기준)`);
  L.push('if !RegExMatch(imgDir, "^([A-Za-z]:|\\\\\\\\)")');
  L.push('    imgDir := A_ScriptDir "\\" imgDir');
  L.push('MacroVars := Map()   ; 변수 저장소 (AHK·PS 는 이름 대소문자를 안 가려 짧은 이름 피함)');
  L.push('ImgErr := ""         ; 이미지 찾기 실패 이유 (nofile = 파일 없음, bad = 그림을 못 읽음)');
  L.push('InitVars()');
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
  emitAHK(l.steps, L, '', { g: gapMs(l), n: 0 });
  L.push('MsgBox "매크로가 끝났어요.", "매크로 설계소"');
  L.push('ExitApp');
  L.push('');
  L.push('; ↓ 단축키 정의 (불러올 때 등록되어 실행 중 내내 작동)');
  L.push('*F8::Pause(-1)   ; 일시정지/재생');
  L.push('*F9::ExitApp     ; 종료');
  L.push('*F10::Reload     ; 처음부터 다시 실행');
  L.push('*Esc::ExitApp');
  L.push('');
  L.push(...ahkFuncs(l));
  L.push(...designBlock(l, 'ahk'));
  return L.join('\r\n') + '\r\n';
}
/* AHK 함수들 (파일 맨 아래에 둬도 어디서나 불러 쓸 수 있음) */
function ahkFuncs(l) {
  const F = ['; ===== 도우미 함수 =====', 'InitVars() {', '    global MacroVars', '    MacroVars := Map()'];
  (l.vars || []).forEach(v => { const n = cleanVarName(v.name); if (n) F.push(`    MacroVars["${ahkStr(n)}"] := "${ahkStr(v.value ?? '')}"`); });
  F.push(
    '    f := A_ScriptDir "\\variables.txt"   ; 폴더의 variables.txt 가 있으면 그 값으로 덮어씀',
    '    if FileExist(f) {',
    '        Loop Read f',
    '        {',
    '            line := A_LoopReadLine',
    '            if (Trim(line) = "" || SubStr(LTrim(line), 1, 1) = "#")',
    '                continue',
    '            p := InStr(line, "=")',
    '            if (p > 1)',
    '                MacroVars[Trim(SubStr(line, 1, p - 1))] := SubStr(line, p + 1)',
    '        }',
    '    }',
    '}',
    'GetVar(key) {',
    '    global MacroVars',
    '    return MacroVars.Has(key) ? MacroVars[key] : ""',
    '}',
    'Fill(s) {   ; 글자 속 {변수이름} 을 값으로 바꿈',
    '    global MacroVars',
    '    for key, val in MacroVars',
    '        s := StrReplace(s, "{" key "}", val, true)',
    '    return s',
    '}',
    'NumIn(s) {   ; 글자에서 첫 숫자(1,234.5 포함) 꺼내기, 없으면 ""',
    '    if RegExMatch(s, "-?\\d[\\d,]*(\\.\\d+)?", &m)',
    '        return Number(StrReplace(m[0], ","))',
    '    return ""',
    '}',
    'FindImage(img, tol, x1, y1, x2, y2, retries, everyMs, &cx, &cy) {   ; 찾으면 true + 가운데 좌표',
    '    global ImgErr',
    '    ImgErr := ""',
    '    if !FileExist(img) {',
    '        ImgErr := "nofile"',
    '        return false',
    '    }',
    '    if (x2 <= x1 || y2 <= y1) {',
    '        x1 := SysGet(76), y1 := SysGet(77)',
    '        x2 := x1 + SysGet(78), y2 := y1 + SysGet(79)',
    '    }',
    '    iw := 0, ih := 0',
    '    hbm := LoadPicture(img, "", &pt)',
    '    if hbm {',
    '        oi := Buffer(32, 0)',
    '        if DllCall("GetObject", "ptr", hbm, "int", 32, "ptr", oi)',
    '            iw := NumGet(oi, 4, "int"), ih := NumGet(oi, 8, "int")',
    '        DllCall("DeleteObject", "ptr", hbm)',
    '    }',
    '    Loop retries {',
    '        try {',
    '            if ImageSearch(&fx, &fy, x1, y1, x2, y2, "*" tol " " img) {',
    '                cx := fx + (iw // 2), cy := fy + (ih // 2)',
    '                return true',
    '            }',
    '        } catch {',
    '            ImgErr := "bad"',
    '            return false',
    '        }',
    '        if (A_Index < retries)',
    '            Sleep everyMs',
    '    }',
    '    return false',
    '}',
  );
  return F;
}
/* AHK 이미지 비교: 닮은 정도(%)를 색 허용오차로 근사 */
function ahkTol(s) { return Math.min(255, (num(s.tol) || 25) + (100 - Math.min(100, Math.max(50, num(s.sim) || 100))) * 2); }
function ahkArea(s) { if (s.area === 'region') { const r = s.region || {}; return `${num(r.x1)}, ${num(r.y1)}, ${num(r.x2)}, ${num(r.y2)}`; } return '0, 0, 0, 0'; }
function ahkFill(s) { const t = String(s == null ? '' : s); return t.includes('{') ? `Fill("${ahkStr(t)}")` : `"${ahkStr(t)}"`; }

/* 묶음(반복문·조건)까지 재귀로 AHK 코드 생성 */
function emitAHK(steps, L, pad, ctx) {
  const g = ctx.g;
  (steps || []).forEach(s => {
    if (s.type === 'repeat') {
      L.push(pad + (num(s.count) > 0 ? `Loop ${num(s.count)} {` : 'Loop {   ; 무한 반복') + (s.alias ? `   ; [${String(s.alias).replace(/[\r\n]/g, ' ')}]` : ''));
      emitAHK(s.children, L, pad + '    ', ctx);
      if (g <= 0) L.push(pad + '    Sleep 10   ; 쉬는 틈 없는 반복이 CPU 를 잡아먹지 않게');
      L.push(pad + '}');
    } else if (s.type === 'if') {
      const k = ctx.n++;
      const cond = ahkCond(s, `c${k}`);
      if (!cond) {
        L.push(pad + '; [조건] 화면 글자 읽기(OCR)가 필요한 조건이라 .ahk 에서 건너뜁니다(안에 담은 동작도) — "무설치(윈도우)"나 파이썬으로 받으세요.');
      } else {
        cond.forEach(x => L.push(pad + x));
        L.push(pad + `if c${k} {` + (s.alias ? `   ; [${String(s.alias).replace(/[\r\n]/g, ' ')}]` : ''));
        emitAHK(s.children, L, pad + '    ', ctx);
        L.push(pad + '}');
        if (countOf(s.elseChildren)) {
          L.push(pad + 'else {');
          emitAHK(s.elseChildren, L, pad + '    ', ctx);
          L.push(pad + '}');
        }
      }
    } else if (s.type === 'break') {
      L.push(pad + (ORPHAN.has(s.id) ? '; (반복문 밖의 "반복 빠져나가기"는 할 일이 없어 건너뜀)' : 'break   ; [반복 빠져나가기]'));
    } else if (s.type === 'stop') {
      L.push(pad + 'ExitApp   ; [멈춤] 매크로 종료');
    } else if (s.type === 'setvar') {
      const n = `"${ahkStr(cleanVarName(s.name))}"`;
      if (s.from === 'clip') L.push(pad + `MacroVars[${n}] := A_Clipboard`);
      else if (s.from === 'read') L.push(pad + `MacroVars[${n}] := ""   ; [변수 ← 화면 글자 읽기] 는 .ahk 에서 안 돼 빈 값이 들어가요 — 무설치(윈도우)를 쓰세요.`);
      else L.push(pad + `MacroVars[${n}] := ${ahkFill(s.value)}`);
    } else if (s.type === 'imgclick') {
      ahkFindImg(s).forEach(x => L.push(pad + x));
    } else if (s.type === 'textclick') {
      L.push(pad + '; [글자 찾아 클릭] 은 .ahk 에서 안 돼 건너뜁니다 — "무설치(윈도우)"나 파이썬으로 받으세요.');
      if (cleanVarName(s.saveTo)) L.push(pad + `MacroVars["${ahkStr(cleanVarName(s.saveTo))}"] := "0"`);
    } else {
      genAHKStep(s).forEach(x => L.push(pad + x));
    }
    if (g > 0) L.push(pad + `Sleep ${g}`);
  });
}
/* 조건 → c 변수에 참/거짓. OCR 이 필요하면 null */
function ahkCond(s, c) {
  const w = s.what || 'region';
  if (w === 'img') {
    // 한 번만 확인. 파일이 없거나 그림을 못 읽으면 "안 보임"으로 넘기지 않고 오류 창
    const path = `imgDir "\\${ahkStr(cleanImgName(s.img))}.png"`;
    const L = ['Loop {', `    ${c} := FindImage(${path}, ${ahkTol(s)}, ${ahkArea(s)}, 1, 0, &fx, &fy)`, `    if (${c} || ImgErr = "")`, '        break',
      `    r := MsgBox((ImgErr = "nofile" ? "이미지 파일이 없어요:\`n" : "이미지 파일을 읽을 수 없어요:\`n") ${path} "\`n\`n[다시 시도] 파일을 넣은 뒤 다시\`n[무시] 안 보이는 것으로 보고 진행\`n[중단] 매크로 종료", "매크로 설계소 - 오류", "AbortRetryIgnore Icon! 0x40000")`,
      '    if (r = "Abort")', '        ExitApp', '    if (r = "Ignore")', '        break', '}'];
    if (s.op === 'no') L.push(`${c} := !${c}`);
    return L;
  }
  if (w !== 'var') return null;
  const key = `"${ahkStr(cleanVarName(s.varName))}"`;
  if (s.read === 'text') {
    const L = [`a := Trim(GetVar(${key})), b := Trim(${ahkFill(s.value)})`];
    if (s.op === 'empty') L.push(`${c} := (a = "")`);
    else if (s.op === 'has') L.push(`${c} := (a != "" && InStr(a, b) > 0)`);
    else if (s.op === 'ne') L.push(`${c} := (a != "" && a != b)`);
    else L.push(`${c} := (a != "" && a = b)`);
    return L;
  }
  const op = { gt: '>', lt: '<', ge: '>=', le: '<=', eq: '=', ne: '!=' }[s.op] || '>=';
  const L = [`a := NumIn(GetVar(${key})), b := NumIn(${ahkFill(s.value)})`];
  if (s.op === 'empty') L.push(`${c} := (a = "")`);
  else L.push(`${c} := (a != "" && b != "" && a ${op} b)`);
  return L;
}
/* 이미지 찾기 → (클릭/이동/찾기만) + 못 찾으면 일시정지·멈춤·넘어감 */
function ahkFindImg(s) {
  const name = cleanImgName(s.img);
  const retries = Math.max(1, num(s.retries) || 8), everyMs = Math.round((Number(s.every) || 0.7) * 1000);
  const path = `imgDir "\\${ahkStr(name)}.png"`;
  const L = [];
  if (num(s.nth) > 1) L.push(`; (.ahk 는 "${num(s.nth)}번째"를 못 골라 첫 번째를 찾아요)`);
  L.push('fx := 0, fy := 0, found := false');
  L.push('Loop {');
  L.push(`    found := FindImage(${path}, ${ahkTol(s)}, ${ahkArea(s)}, ${retries}, ${everyMs}, &fx, &fy)`);
  L.push('    if found');
  L.push('        break');
  const msg = `(ImgErr = "nofile" ? "이미지 '${ahkStr(name)}' 파일이 없어요 (이미지 캡처 도우미로 찍어 두세요).\`n" : ImgErr = "bad" ? "이미지 '${ahkStr(name)}' 파일을 읽을 수 없어요.\`n" : "이미지 '${ahkStr(name)}' 을(를) 화면에서 찾을 수 없어요 (${retries}번 시도).\`n") ${path}`;
  if (s.notfound === 'continue') {
    L.push('    break   ; 못 찾으면 그냥 넘어감');
  } else if (s.notfound === 'stop') {
    L.push(`    MsgBox(${msg} "\`n\`n매크로를 멈춰요.", "매크로 설계소 - 오류", "Icon! 0x40000")`);
    L.push('    ExitApp');
  } else {
    L.push(`    r := MsgBox(${msg} "\`n\`n[다시 시도] 화면을 맞춘 뒤 다시 찾기\`n[무시] 이 동작 건너뛰기\`n[중단] 매크로 종료", "매크로 설계소 - 오류", "AbortRetryIgnore Icon! 0x40000")`);
    L.push('    if (r = "Abort")');
    L.push('        ExitApp');
    L.push('    if (r = "Ignore")');
    L.push('        break');
  }
  L.push('}');
  const dx = num(s.dx), dy = num(s.dy);
  const pos = `fx + ${dx}, fy + ${dy}`;
  if (s.act === 'move') L.push('if found', `    MouseMove ${pos}, 10`);
  else if (s.act !== 'none') {
    const btn = s.button === 'right' ? 'Right' : s.button === 'middle' ? 'Middle' : 'Left';
    L.push('if found', `    Click ${pos}, "${btn}", ${s.double ? 2 : 1}`);
  }
  if (cleanVarName(s.saveTo)) L.push(`MacroVars["${ahkStr(cleanVarName(s.saveTo))}"] := found ? "1" : "0"`);
  return L;
}
function genAHKStep(s) {
  switch (s.type) {
    case 'url': return [`try Run ${ahkFill(s.url)}`];
    case 'move': return [`MouseMove ${num(s.x)}, ${num(s.y)}, 10`];
    case 'click': {
      const btn = s.button === 'right' ? 'Right' : s.button === 'middle' ? 'Middle' : '';
      const opt = [num(s.x), num(s.y), btn, s.double ? 2 : ''].filter(v => v !== '').join(' ');
      return [`Click "${opt}"`];
    }
    case 'drag': return [`MouseClickDrag "Left", ${num(s.x1)}, ${num(s.y1)}, ${num(s.x2)}, ${num(s.y2)}, 10`];
    case 'hotkey': {
      const rk = resolveHotkey(s);
      if (!rk) return [`Send "${ahkStr(buildHotkey(s).ahk)}"`];
      const L = [];
      parseCombo(rk.combo).chords.forEach((c, i) => { if (i) L.push('Sleep 120'); L.push(`Send "${ahkStr(chordAHK(c))}"`); });
      return L;
    }
    case 'text': return [`SendText ${ahkFill(s.text)}`];
    case 'win': return [`if WinExist(${ahkFill(s.title)}) {   ; 창이 없으면 오류로 멈추지 않고 넘어감`, `    try WinActivate ${ahkFill(s.title)}`, `    try WinWaitActive ${ahkFill(s.title)}, , 5`, '}'];
    case 'scroll': return [`Loop ${num(s.amount) || 1} {`, `    Send "{Wheel${s.dir === 'up' ? 'Up' : 'Down'}}"`, '    Sleep 40', '}'];
    case 'wait': return [`Sleep ${Math.round((Number(s.sec) || 0) * 1000)}`];
    case 'readput': return ['; [영역 값 읽어 입력] 은 .ahk 에서 지원되지 않아 건너뜁니다 — "무설치(윈도우)" 또는 파이썬으로 내보내세요.'];
    default: return [];
  }
}

/* --- 실행용 .bat (.ahk 실행). ★ 한글 금지(ASCII만): cmd + chcp 65001 에서 한글이 다음 줄 글자를 먹는 버그 방지 --- */
function genBAT(l, ahkName) {
  // .bat 는 순수 ASCII + chcp 없음: 한글/코드페이지 전환이 cmd 파서를 깨뜨려 'rshell' 류 오류를 냄
  return [
    '@echo off',
    ...batPick(ahkName, '-run'),
    'start "" "%F%"',
    'if errorlevel 1 (',
    '  echo.',
    '  echo [Notice] Install AutoHotkey v2 first - https://www.autohotkey.com',
    '  pause', ')', '',
  ].join('\r\n');
}

/* --- 무설치 윈도우: PowerShell .ps1 + 실행용 .bat --- */
/* PowerShell 은 ‘ ’ ‚ ‛ (아이폰 자동 따옴표)도 작은따옴표로 읽어서 모두 두 번 써서 감쌈 */
function psStr(s) { return "'" + String(s == null ? '' : s).replace(/['\u2018\u2019\u201A\u201B]/g, m => m + m) + "'"; }
/* 화면 배율(125·150%)·모니터 여러 대에서도 좌표·화면 캡처·마우스가 같은 "실제 픽셀" 기준이 되게 (창을 만들기 전에 실행) */
function psDpiFix() {
  return [
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices;',
    'public class DpiFix {',
    '  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();',
    '  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);',
    '  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr v);',
    '  public static void Apply() {',
    '    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch { }',
    '    try { if (SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return; } catch { }',
    '    try { SetProcessDPIAware(); } catch { }',
    '  }',
    '}',
    '"@',
    'try { [DpiFix]::Apply() } catch {}',
  ];
}
/* {변수} 가 들어 있으면 실행할 때 값으로 바꿔 넣음 */
function psFill(s) { const t = String(s == null ? '' : s); return t.includes('{') ? `(Fill ${psStr(t)})` : psStr(t); }
function psArea(s) { if (s.area === 'region') { const r = s.region || {}; return `${num(r.x1)} ${num(r.y1)} ${num(r.x2)} ${num(r.y2)}`; } return '0 0 0 0'; }

/* ★ .bat 은 ASCII만 (한글 안내는 .ps1 의 Write-Host 에서 출력) */
function genPSBat(l, ps1Name) {
  // .bat 는 순수 ASCII + chcp 없음: cmd 코드페이지 전환이 'powershell' 명령을 깨먹는 버그 회피
  return [
    '@echo off',
    ...batPick(ps1Name, '-noinstall'),
    'powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%F%"',
    'echo.', 'pause', '',
  ].join('\r\n');
}
/* 실행할 짝 파일 고르기: 다시 받아 "이름-noinstall (1).bat" 이 되면 같이 받은 "이름 (1).ps1" 을 실행(옛 파일이 실행되지 않게).
   그런 파일이 없으면 원래 이름. (ASCII 만, 결과는 %F%) */
function batPick(fileName, suffix) {
  const ext = fileName.slice(fileName.lastIndexOf('.'));
  return [
    `set "F=%~dp0${fileName}"`,
    'set "N=%~n0"',
    `if exist "%~dp0%N:${suffix}=%${ext}" set "F=%~dp0%N:${suffix}=%${ext}"`,
  ];
}
/* 찾기 실패 이유별 안내 (파일 없음·이미지 기능 없음·OCR 없음) → $msg 덮어쓰기 */
function psErrMsgs(imgName) {
  const L = [];
  if (imgName != null) {
    L.push(`if($script:lastErr -eq 'nofile'){ $msg = ${psStr(`이미지 '${imgName}' 파일이 없어요: `)} + (ImgPath ${psStr(imgName)}) + ${psStr(' — 이미지 캡처 도우미로 이 이름으로 찍어 두세요')} }`);
    L.push(`if($script:lastErr -eq 'noimg'){ $msg = '이 PC에서 이미지 찾기 기능을 쓸 수 없어요 (실행 창 맨 위의 [주의] 참고)' }`);
  }
  L.push(`if($script:lastErr -eq 'noocr'){ $msg = '이 PC에서 화면 글자 읽기(OCR)를 쓸 수 없어요' }`);
  return L;
}
/* 화면 글자 읽기(OCR)·이미지 찾기가 필요한 동작이 있는지 */
function needsOcr(steps) {
  return anyStep(steps, s => s.type === 'readput' || s.type === 'textclick' || (s.type === 'setvar' && s.from === 'read')
    || (s.type === 'if' && (!s.what || s.what === 'region' || s.what === 'text')));
}
function needsImg(steps) { return anyStep(steps, s => s.type === 'imgclick' || (s.type === 'if' && s.what === 'img')); }

function genPS1(l) {
  refreshOrphans(l);
  const P = [];
  P.push('# -*- 매크로: ' + (l.name || '').replace(/[\r\n]/g, ' ') + ' -*-');
  P.push('# 설치가 필요 없습니다. 함께 받은 "...-noinstall.bat"(폴더로 받았다면 "1-run-macro.bat") 를 더블클릭하세요.');
  P.push(`# 단축키:  ${CTRL_KEYS.pauseLabel} = 일시정지/재생   ${CTRL_KEYS.stopLabel} = 종료   ${CTRL_KEYS.restartLabel} = 처음부터 다시 실행`);
  P.push('try { chcp 65001 > $null } catch {}');
  P.push('try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}');
  P.push(...psDpiFix());
  P.push('Add-Type @"');
  P.push('using System; using System.Runtime.InteropServices;');
  P.push('public class U {');
  P.push('  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);');
  P.push('  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,int d,int e);');
  P.push('  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);');
  P.push('  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);');
  P.push('  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);');
  P.push('  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);');
  P.push('  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, int extra);');
  P.push('  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();');
  P.push('  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);');
  P.push('  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);');
  P.push('  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);');
  P.push('  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);');
  P.push('  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);');
  P.push('  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint f1, uint f2, uint rm);');
  P.push('  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();');
  P.push('  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);');
  P.push('  [DllImport("kernel32.dll")] static extern bool GetConsoleMode(IntPtr h, out uint m);');
  P.push('  [DllImport("kernel32.dll")] static extern bool SetConsoleMode(IntPtr h, uint m);');
  P.push('  // 검은 창 "빠른 편집" 끄기: 창을 클릭해도 매크로가 멈춰 얼지 않게');
  P.push('  public static void NoQuickEdit() { try { IntPtr h = GetStdHandle(-10); uint m; if (GetConsoleMode(h, out m)) SetConsoleMode(h, (m & ~0x40u) | 0x80u); } catch { } }');
  P.push('  // F7~F10 을 이 매크로 전용 단축키로 등록 → 엑셀 등 앞에 있는 프로그램에 안 넘어감. 등록 못 한 키는 눌림 상태로 확인');
  P.push('  static bool[] reg = new bool[4], prev = new bool[4];');
  P.push('  public static void HookKeys() { for (int i = 0; i < 4; i++) { if (reg[i]) continue; try { reg[i] = RegisterHotKey(IntPtr.Zero, 0x7700 + i, 0x4000, (uint)(0x76 + i)); } catch { reg[i] = false; } } }');
  P.push('  public static void FreeKeys() { for (int i = 0; i < 4; i++) { if (!reg[i]) continue; try { UnregisterHotKey(IntPtr.Zero, 0x7700 + i); } catch { } reg[i] = false; } }');
  P.push('  // 지난번 확인 뒤 눌린 키: 1=F7, 2=F8, 4=F9, 8=F10');
  P.push('  public static int Pressed() {');
  P.push('    int r = 0; MSG m;');
  P.push('    try { while (PeekMessage(out m, IntPtr.Zero, 0x0312, 0x0312, 1)) { int id = (int)m.wParam - 0x7700; if (id >= 0 && id < 4) r |= 1 << id; } } catch { }');
  P.push('    for (int i = 0; i < 4; i++) { if (reg[i]) continue; bool d = (GetAsyncKeyState(0x76 + i) & 0x8000) != 0; if (d && !prev[i]) r |= 1 << i; prev[i] = d; }');
  P.push('    return r;');
  P.push('  }');
  P.push('  // 오류 때: 실행 창을 맨 위에 보이게(키보드 포커스는 안 뺏음). 그 전에 앞에 있던 창을 돌려줌');
  P.push('  static bool wasMin = false;');
  P.push('  static IntPtr Con() { IntPtr h = GetConsoleWindow(); if (h == IntPtr.Zero) return h; IntPtr o = GetAncestor(h, 3); return o != IntPtr.Zero ? o : h; }');
  P.push('  public static IntPtr ShowCon() {');
  P.push('    IntPtr prevWin = GetForegroundWindow(), h = Con();');
  P.push('    try { if (h != IntPtr.Zero) { wasMin = IsIconic(h); if (wasMin) ShowWindow(h, 4); SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x53); } } catch { }');
  P.push('    return prevWin;');
  P.push('  }');
  P.push('  // 다시 시작할 때: 맨 위 고정을 풀고 원래 창 뒤로 보냄(찾을 화면을 가리지 않게)');
  P.push('  public static void HideCon(IntPtr prevWin) {');
  P.push('    IntPtr h = Con(); if (h == IntPtr.Zero) return;');
  P.push('    try {');
  P.push('      SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x13);');
  P.push('      if (prevWin != IntPtr.Zero && prevWin != h) { if (GetForegroundWindow() == h) SetForegroundWindow(prevWin); SetWindowPos(h, prevWin, 0, 0, 0, 0, 0x13); }');
  P.push('      if (wasMin) ShowWindow(h, 7);');
  P.push('    } catch { }');
  P.push('  }');
  P.push('  // 멈춤으로 끝날 때: 실행 창을 앞으로');
  P.push('  public static void FrontCon() { IntPtr h = Con(); if (h == IntPtr.Zero) return; try { if (IsIconic(h)) ShowWindow(h, 9); SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x53); SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x53); SetForegroundWindow(h); } catch { } }');
  P.push('}');
  P.push('public struct POINT { public int X; public int Y; }');
  P.push('public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }');
  P.push('"@');
  P.push('Add-Type -AssemblyName System.Windows.Forms');
  P.push('Add-Type -AssemblyName System.Drawing');
  P.push('[U]::NoQuickEdit()');
  P.push('[U]::HookKeys()');
  P.push('');
  P.push('$script:paused = $false');
  P.push('$script:canRestart = $false');
  P.push('$script:lastErr = ""');
  P.push('$script:kq = 0   # 눌린 제어 키 모음 (1=F7, 2=F8, 4=F9, 8=F10)');
  P.push('function KeyDown($vk){ return (([int][U]::GetAsyncKeyState($vk)) -band 0x8000) -ne 0 }');
  P.push('function TakeKey($bit){ $script:kq = $script:kq -bor [U]::Pressed(); if($script:kq -band $bit){ $script:kq = $script:kq -band (-bnot $bit); return $true }; return $false }');
  P.push('function Pump(){');
  P.push('  if(TakeKey 4){ Write-Host "[] 종료"; exit }   # F9');
  P.push('  if((TakeKey 8) -and $script:canRestart){ throw "RESTART" }   # F10 재실행');
  P.push('  if(TakeKey 2){ $script:paused = $true; Write-Host "|| 일시정지 (F8로 재생)" }   # F8');
  P.push('  while($script:paused){');
  P.push('    Start-Sleep -Milliseconds 100');
  P.push('    if(TakeKey 4){ Write-Host "[] 종료"; exit }');
  P.push('    if((TakeKey 8) -and $script:canRestart){ $script:paused = $false; throw "RESTART" }');
  P.push('    if(TakeKey 2){ $script:paused = $false; Write-Host "> 재생" }');
  P.push('  }');
  P.push('}');
  P.push('function WaitMs($ms){ $end=[Environment]::TickCount+$ms; while([Environment]::TickCount -lt $end){ Pump; Start-Sleep -Milliseconds 80 } }');
  P.push('function MoveMouse($x,$y){ [U]::SetCursorPos($x,$y) | Out-Null; Start-Sleep -Milliseconds 60 }');
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
  P.push('function SetClip($s){ for($i=0;$i -lt 5;$i++){ try { Set-Clipboard -Value $s -ErrorAction Stop; return $true } catch { Start-Sleep -Milliseconds 150 } }; return $false }   # 클립보드를 다른 프로그램이 잡고 있으면 잠깐 뒤 다시');
  P.push('function GetClip(){ for($i=0;$i -lt 5;$i++){ try { return [string](Get-Clipboard -Raw -ErrorAction Stop) } catch { Start-Sleep -Milliseconds 150 } }; return "" }');
  P.push('function TypeText($s){ if("$s" -ne ""){ if(SetClip $s){ Start-Sleep -Milliseconds 90; Keys "^v" } else { Write-Host "[주의] 클립보드를 쓸 수 없어 글자를 못 넣었어요" -ForegroundColor Yellow } } }   # 클립보드로 붙여넣기(한글 OK)');
  P.push('function AltTab(){ [U]::keybd_event(0x12,0,0,0); Start-Sleep -Milliseconds 40; [U]::keybd_event(0x09,0,0,0); [U]::keybd_event(0x09,0,2,0); Start-Sleep -Milliseconds 250; [U]::keybd_event(0x12,0,2,0); Start-Sleep -Milliseconds 120 }');
  P.push('function KeyCombo($vks){');
  P.push('  $own = @($vks | Where-Object { $_ -ge 0x76 -and $_ -le 0x79 }).Count -gt 0   # F7~F10 을 보낼 땐 잠깐 단축키 등록을 풀어 매크로가 자기 키에 걸리지 않게');
  P.push('  if($own){ [U]::FreeKeys() }');
  P.push('  foreach($v in $vks){ [U]::keybd_event([byte]$v,0,0,0); Start-Sleep -Milliseconds 30 }; for($i=$vks.Length-1;$i -ge 0;$i--){ [U]::keybd_event([byte]$vks[$i],0,2,0); Start-Sleep -Milliseconds 30 }; Start-Sleep -Milliseconds 80');
  P.push('  if($own){ [U]::HookKeys() }');
  P.push('}   # Win 등 조합키 직접 전송');
  P.push('function ActivateWin($title){');
  P.push('  $p = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Contains($title) } | Select-Object -First 1');
  P.push('  if($p){ [U]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 400 } else { Write-Host ("[주의] 제목에 \'" + $title + "\' 이(가) 든 창이 없어요") -ForegroundColor Yellow }');
  P.push('}');
  P.push("function Scroll($dir,$amt){ for($i=0;$i -lt $amt;$i++){ [U]::mouse_event(0x800,0,0,$(if($dir -eq 'up'){120}else{-120}),0); Start-Sleep -Milliseconds 50 } }");
  P.push('function OpenUrl($u){ Start-Process $u }');
  P.push('function FocusConsole(){ [U]::FrontCon() }');
  P.push('# 찾기 실패 등 오류: 실행 창을 맨 위에 띄우고 멈춤. F8 = 다시 시도, F7 = 이 동작 건너뛰기, F9 = 종료');
  P.push('function ErrorPause($msg){');
  P.push('  Write-Host ""');
  P.push('  Write-Host ("[오류] " + $msg) -ForegroundColor Red');
  P.push('  Write-Host "   -> 화면을 맞춘 뒤 F8 = 다시 찾기 / F7 = 이 동작 건너뛰기 / F9 = 종료" -ForegroundColor Yellow');
  P.push('  try { [console]::Beep(880, 250) } catch {}');
  P.push('  $prevWin = [U]::ShowCon()');
  P.push('  $null = TakeKey 0; $script:kq = $script:kq -band (-bnot 3)   # 이전에 눌러 둔 F7·F8 은 무시');
  P.push('  $r = ""');
  P.push('  while($r -eq ""){');
  P.push('    Start-Sleep -Milliseconds 80');
  P.push('    if(TakeKey 4){ Write-Host "[] 종료"; exit }');
  P.push('    if((TakeKey 8) -and $script:canRestart){ [U]::HideCon($prevWin); throw "RESTART" }');
  P.push('    if(TakeKey 2){ Write-Host "> 다시 찾아요"; $r = "retry" }');
  P.push('    elseif(TakeKey 1){ Write-Host "> 이 동작은 건너뛰어요"; $r = "skip" }');
  P.push('  }');
  P.push('  [U]::HideCon($prevWin)');
  P.push('  return $r');
  P.push('}');
  P.push('# ==== PURE-BEGIN (변수·비교: 화면과 상관없는 계산) ====');
  P.push("function SetVar($k, $v){ $script:MacroVars[[string]$k] = [string]$v }");
  P.push("function GetVar($k){ if($script:MacroVars.ContainsKey([string]$k)){ return $script:MacroVars[[string]$k] } else { return '' } }");
  P.push("function Fill($s){ $r = [string]$s; foreach($k in @($script:MacroVars.Keys)){ $r = $r.Replace('{' + $k + '}', [string]$script:MacroVars[$k]) }; return $r }   # 글자 속 {변수이름} 을 값으로");
  P.push("function ReadNumber($txt){ $m=[regex]::Match([string]$txt,'-?\\d[\\d,]*(\\.\\d+)?'); if($m.Success){ return [double]($m.Value -replace ',','') } else { return $null } }");
  P.push('function TextCmp($a,$b,$op){ $x=([string]$a).Trim().ToLower(); $y=([string]$b).Trim().ToLower(); if($op -eq "has"){ return $x.Contains($y) } elseif($op -eq "ne"){ return ($x -ne $y) } else { return ($x -eq $y) } }');
  P.push('# ==== PURE-END ====');
  P.push('function InitVars(){');
  P.push("  $script:MacroVars = New-Object 'System.Collections.Generic.Dictionary[string,string]'");
  (l.vars || []).forEach(v => { const n = cleanVarName(v.name); if (n) P.push(`  SetVar ${psStr(n)} ${psStr(v.value ?? '')}`); });
  P.push("  $vf = Join-Path $PSScriptRoot 'variables.txt'   # 폴더의 variables.txt 가 있으면 그 값으로 덮어씀");
  P.push('  if(Test-Path -LiteralPath $vf){');
  P.push('    foreach($ln in @(Get-Content -LiteralPath $vf -Encoding UTF8)){');
  P.push('      $t = [string]$ln');
  P.push("      if($t.Trim() -eq '' -or $t.TrimStart().StartsWith('#')){ continue }");
  P.push("      $i = $t.IndexOf('=')");
  P.push('      if($i -gt 0){ SetVar ($t.Substring(0, $i).Trim()) ($t.Substring($i + 1)) }');
  P.push('    }');
  P.push('  }');
  P.push('}');
  P.push(`$IMGDIR = ${psStr(imgDirOf(l))}   # 이미지 폴더 (상대 경로면 이 파일이 있는 폴더 기준)`);
  P.push('if(-not [System.IO.Path]::IsPathRooted($IMGDIR)){ $IMGDIR = Join-Path $PSScriptRoot $IMGDIR }');
  P.push("function ImgPath($name){ return (Join-Path $IMGDIR ([string]$name + '.png')) }");
  if (needsOcr(l.steps)) P.push(...psOcrFuncs());
  if (needsImg(l.steps)) P.push(...psImgFuncs());
  P.push('');
  P.push('# ==== RUN ====');
  P.push(`Write-Host "단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료, ${CTRL_KEYS.restartLabel} 재실행 (실행 중엔 이 키들이 다른 프로그램에 전달되지 않아요)"`);
  const need = imgNames(l);
  if (need.length) {   // 시작 전에 빠진 이미지 파일을 한 번에 알려줌
    P.push(`foreach($n in @(${need.map(psStr).join(', ')})){ if(-not (Test-Path -LiteralPath (ImgPath $n))){ Write-Host ("[주의] 이미지 파일이 없어요: " + (ImgPath $n) + "  -> 이미지 캡처 도우미로 찍어 두세요") -ForegroundColor Yellow } }`);
  }
  const p = hhmmParts(l.startAt);
  if (p) {
    P.push(`# 예약 시작: 다음 ${l.startAt} 까지 대기 (${CTRL_KEYS.startNowLabel} 즉시 시작)`);
    P.push(`$target = (Get-Date).Date.AddHours(${p.hh}).AddMinutes(${p.mm})`);
    P.push('if($target -le (Get-Date)){ $target = $target.AddDays(1) }');
    P.push('Write-Host "예약: $target 까지 대기"');
    P.push('$null = TakeKey 0; $script:kq = 0');
    P.push('while((Get-Date) -lt $target){');
    P.push(`  if(TakeKey 1){ break }   # ${CTRL_KEYS.startNowLabel}`);
    P.push('  Pump; Start-Sleep -Seconds 1');
    P.push('}');
  }
  P.push(`WaitMs ${Math.round((l.delay || 0) * 1000)}   # 시작 전 대기`);
  P.push('$script:canRestart = $true   # 여기서부터 F10 재실행 가능');
  P.push('while($true){   # F10 재실행 바깥 루프');
  P.push('try {');
  P.push('InitVars');
  emitPS(l.steps, P, '', { g: gapMs(l), n: 0 });
  P.push('} catch { if("$($_.Exception.Message)" -eq "RESTART"){ Write-Host "↻ 처음부터 다시 실행"; continue } else { throw } }');
  P.push('break');
  P.push('}');
  P.push('Write-Host "✅ 매크로가 끝났어요."');
  P.push(...designBlock(l, 'ps'));
  return P.join('\r\n') + '\r\n';
}
/* 묶음(반복문·조건)까지 재귀로 PowerShell 코드 생성 */
function emitPS(steps, P, pad, ctx) {
  const g = ctx.g;
  (steps || []).forEach(s => {
    P.push(pad + 'Pump');
    P.push(pad + `Write-Host ${psStr('▶ ' + stepDesc(s))}`);
    if (s.type === 'repeat') {
      const k = ctx.n++;
      P.push(pad + `$rc${k} = ${num(s.count)}   # 0 = 무한`);
      P.push(pad + `$ri${k} = 0`);
      P.push(pad + `while($rc${k} -eq 0 -or $ri${k} -lt $rc${k}){`);
      P.push(pad + '  Pump');
      emitPS(s.children, P, pad + '  ', ctx);
      P.push(pad + `  $ri${k}++`);
      P.push(pad + '}');
    } else if (s.type === 'if') {
      const k = ctx.n++;
      genPSCond(s, `$c${k}`).forEach(x => P.push(pad + x));
      P.push(pad + `if($c${k}){`);
      emitPS(s.children, P, pad + '  ', ctx);
      P.push(pad + '}');
      if (countOf(s.elseChildren)) {
        P.push(pad + 'else{');
        emitPS(s.elseChildren, P, pad + '  ', ctx);
        P.push(pad + '}');
      }
    } else if (s.type === 'break') {
      P.push(pad + (ORPHAN.has(s.id) ? '# (반복문 밖의 "반복 빠져나가기"는 할 일이 없어 건너뜀)' : 'break   # 반복 빠져나가기'));
    } else if (s.type === 'stop') {
      P.push(pad + 'Write-Host "[] 멈춤"; exit');
    } else if (s.type === 'setvar') {
      genPSSetVar(s).forEach(x => P.push(pad + x));
    } else if (s.type === 'imgclick' || s.type === 'textclick') {
      psFindStep(s).forEach(x => P.push(pad + x));
    } else {
      genPSStep(s).forEach(x => P.push(pad + x));
    }
    if (g > 0) P.push(pad + `WaitMs ${g}`);
  });
}
function genPSSetVar(s) {
  const k = psStr(cleanVarName(s.name));
  if (s.from === 'clip') return [`SetVar ${k} (GetClip)`];
  if (s.from === 'read') {
    const L = psReadRegion('$txt', s.mode, s.region || {});
    if (s.read === 'number') L.push("$m = [regex]::Match([string]$txt, '-?\\d[\\d,]*(\\.\\d+)?'); $val = if($m.Success){ $m.Value -replace ',','' } else { '' }");
    else L.push('$val = ([string]$txt).Trim()');
    L.push(`SetVar ${k} $val`);
    L.push(`if($val -eq ''){ Write-Host ${psStr('[주의] 변수 {' + cleanVarName(s.name) + '}: 화면에서 글자를 못 읽었어요 (빈 값)')} -ForegroundColor Yellow } else { Write-Host (${psStr('   {' + cleanVarName(s.name) + '} = ')} + $val) }`);
    return L;
  }
  return [`SetVar ${k} ${psFill(s.value)}`];
}
/* 이미지·글자 찾기 → 못 찾으면 일시정지/멈춤/넘어감 → 클릭/이동/찾기만 → 결과 변수 */
function psFindStep(s) {
  const isImg = s.type === 'imgclick';
  const retries = Math.max(1, num(s.retries) || 8), everyMs = Math.round((Number(s.every) || 0.7) * 1000);
  const nth = Math.max(1, num(s.nth) || 1);
  const name = isImg ? cleanImgName(s.img) : String(s.text || '');
  const call = isImg
    ? `FindImg (ImgPath ${psStr(name)}) ${num(s.tol) || 25} ${Math.min(100, Math.max(50, num(s.sim) || 100))} $${s.bright ? 'true' : 'false'} ${psArea(s)} ${nth} ${retries} ${everyMs}`
    : `FindText ${psFill(name)} ${psArea(s)} ${nth} ${retries} ${everyMs}`;
  const what = isImg ? `이미지 '${name}'` : `글자 '${name}'`;
  const tail = `${nth > 1 ? ` (${nth}번째)` : ''} 을(를) 화면에서 찾을 수 없어요 (${retries}번 시도)`;
  const L = ['$p = $null', 'while($true){', `  $p = ${call}`, '  if($null -ne $p){ break }'];
  // 글자는 {변수}를 실제 값으로 바꿔 보여줌
  L.push(isImg ? `  $msg = ${psStr(what + tail)}` : `  $msg = "글자 '" + ${psFill(name)} + ${psStr("'" + tail)}`);
  psErrMsgs(isImg ? name : null).forEach(x => L.push('  ' + x));
  if (s.notfound === 'continue') L.push('  Write-Host ("[주의] " + $msg + " -> 건너뛰어요") -ForegroundColor Yellow; break');
  else if (s.notfound === 'stop') L.push('  Write-Host ("[오류] " + $msg + " -> 매크로를 멈춰요") -ForegroundColor Red; FocusConsole; exit');
  else L.push("  if((ErrorPause $msg) -eq 'skip'){ break }");
  L.push('}');
  const pos = `($p[0] + ${num(s.dx)}) ($p[1] + ${num(s.dy)})`;
  if (s.act === 'move') L.push(`if($null -ne $p){ MoveMouse ${pos} }`);
  else if (s.act !== 'none') L.push(`if($null -ne $p){ ClickAt ${pos} '${s.button || 'left'}' $${s.double ? 'true' : 'false'} }`);
  if (cleanVarName(s.saveTo)) L.push(`SetVar ${psStr(cleanVarName(s.saveTo))} $(if($null -ne $p){'1'}else{'0'})`);
  return L;
}
function psOcrFuncs() {
  return [
    '# ===== 화면 글자 읽기(OCR, 윈도우 10/11 내장) =====',
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
    '$script:ocrMax = 2600; try { $script:ocrMax = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension } catch {}',
    'if(-not $script:ocrReady){ Write-Host "[주의] 이 PC에서 화면 글자 읽기(OCR)를 쓸 수 없어 글자 관련 동작은 실패로 처리돼요." -ForegroundColor Yellow }',
    'function Await($op,$t){ $m=$script:asTaskGeneric.MakeGenericMethod($t); $net=$m.Invoke($null,@($op)); $net.Wait(-1)|Out-Null; $net.Result }',
    '# 화면 네모를 찍어 OCR (작은 영역은 2배 키워 정확도↑, 너무 크면 줄임). 영역이 없으면 화면 전체',
    'function OcrShot($x1,$y1,$x2,$y2){',
    '  if(-not $script:ocrReady){ return $null }',
    '  if($x2 -le $x1 -or $y2 -le $y1){ $vs=[System.Windows.Forms.SystemInformation]::VirtualScreen; $x1=$vs.Left; $y1=$vs.Top; $x2=$vs.Right; $y2=$vs.Bottom }',
    '  $w=[int]($x2-$x1); $h=[int]($y2-$y1); if($w -lt 1 -or $h -lt 1){ return $null }',
    '  $mx=[Math]::Max($w,$h); $sc=1.0',
    '  if($mx -lt 1200 -and ($mx*2) -le $script:ocrMax){ $sc=2.0 } elseif($mx -gt $script:ocrMax){ $sc=$script:ocrMax/$mx }',
    '  $ms=New-Object System.IO.MemoryStream',
    '  try {   # 화면 잠금·보안 창 등으로 화면을 못 찍으면 "못 읽음"으로 처리(매크로가 죽지 않게)',
    '    $bmp=New-Object System.Drawing.Bitmap $w,$h',
    '    try { $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen([int]$x1,[int]$y1,0,0,(New-Object System.Drawing.Size $w,$h)); $g.Dispose() } catch { $bmp.Dispose(); throw }',
    '    if($sc -ne 1.0){ $nw=[Math]::Max(1,[int]($w*$sc)); $nh=[Math]::Max(1,[int]($h*$sc)); $b2=New-Object System.Drawing.Bitmap $nw,$nh; $g2=[System.Drawing.Graphics]::FromImage($b2); $g2.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $g2.DrawImage($bmp,0,0,$nw,$nh); $g2.Dispose(); $bmp.Dispose(); $bmp=$b2 }',
    '    $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $ms.Position=0',
    '    $ras=[System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)',
    '    $dec=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])',
    '    $sb=Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
    '    $res=Await ($script:ocr.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])',
    '    return @{ R = $res; X = [int]$x1; Y = [int]$y1; S = $sc }',
    '  } catch { return $null } finally { $ms.Dispose() }',
    '}',
    'function ReadRegion($x1,$y1,$x2,$y2){',
    '  if([Math]::Abs($x2-$x1) -lt 1 -or [Math]::Abs($y2-$y1) -lt 1){ return "" }',
    '  $o = OcrShot ([Math]::Min($x1,$x2)) ([Math]::Min($y1,$y2)) ([Math]::Max($x1,$x2)) ([Math]::Max($y1,$y2))',
    '  if($null -eq $o){ return "" }',
    '  return [string]$o.R.Text',
    '}',
    '# 화면에서 글자를 찾아 가운데 좌표 반환 (띄어쓰기·대소문자 무시, 위→아래·왼→오른 순 n번째)',
    'function FindText($target, $x1, $y1, $x2, $y2, $nth, $retries, $everyMs){',
    '  $script:lastErr = ""',
    '  if(-not $script:ocrReady){ $script:lastErr = "noocr"; return $null }',
    '  $t = (([string]$target) -replace "\\s", "").ToLower()',
    '  if($t -eq ""){ $script:lastErr = "notfound"; return $null }',
    '  if($nth -lt 1){ $nth = 1 }',
    '  for($k = 0; $k -lt $retries; $k++){',
    '    Pump',
    '    $o = OcrShot $x1 $y1 $x2 $y2',
    '    if($null -ne $o){',
    '      $hits = New-Object System.Collections.ArrayList',
    '      foreach($line in $o.R.Lines){',
    '        $ws = @($line.Words); $s = ""; $st = New-Object System.Collections.ArrayList',
    '        foreach($w in $ws){ [void]$st.Add($s.Length); $s += ((([string]$w.Text) -replace "\\s", "").ToLower()) }',
    '        $from = 0',
    '        while($from -le $s.Length){',
    '          $i = $s.IndexOf($t, $from); if($i -lt 0){ break }',
    '          $e = $i + $t.Length; $mnx = [double]::MaxValue; $mny = [double]::MaxValue; $mxx = -1.0; $mxy = -1.0',
    '          for($q = 0; $q -lt $ws.Count; $q++){',
    '            $a = $st[$q]; $b = $a + ((([string]$ws[$q].Text) -replace "\\s", "").Length)',
    '            if($b -gt $i -and $a -lt $e){ $r = $ws[$q].BoundingRect; if($r.X -lt $mnx){ $mnx = $r.X }; if($r.Y -lt $mny){ $mny = $r.Y }; if(($r.X + $r.Width) -gt $mxx){ $mxx = $r.X + $r.Width }; if(($r.Y + $r.Height) -gt $mxy){ $mxy = $r.Y + $r.Height } }',
    '          }',
    '          if($mxx -ge 0){ $cx = $o.X + [int](($mnx + $mxx) / 2 / $o.S); $cy = $o.Y + [int](($mny + $mxy) / 2 / $o.S); [void]$hits.Add([pscustomobject]@{ X = $cx; Y = $cy; R = [int][Math]::Floor($cy / 12) }) }',
    '          $from = $i + 1',
    '        }',
    '      }',
    '      $sorted = @($hits | Sort-Object R, X)',
    '      if($sorted.Count -ge $nth){ $h = $sorted[$nth - 1]; return @($h.X, $h.Y) }',
    '    }',
    '    if($k -lt $retries - 1){ WaitMs $everyMs }',
    '  }',
    '  $script:lastErr = "notfound"; return $null',
    '}',
    'function CursorXY(){ $pt=New-Object POINT; [U]::GetCursorPos([ref]$pt)|Out-Null; return @($pt.X,$pt.Y) }',
  ];
}
/* 이미지 비교 핵심 (C#5 문법 — 윈도우 PowerShell 5.1 컴파일러용). 순수 계산이라 따로 시험 가능 */
const IMG_CORE_CS = [
  '  // sb: 화면 픽셀(BGRA), tb: 찾을 그림. 왼쪽 위 좌표 {x,y} 반환, 없으면 {-1,-1}',
  '  public static int[] Match(byte[] sb, int sw, int sh, int ss, byte[] tb, int tw, int th, int ts, int tol, int sim, bool bright, int nth) {',
  '    int[] res = new int[] { -1, -1 };',
  '    if (tw < 1 || th < 1 || tw > sw || th > sh) return res;',
  '    if (nth < 1) nth = 1;',
  '    if (sim > 100) sim = 100;',
  '    if (sim < 50) sim = 50;',
  '    int step = (tw * th > 400) ? 2 : 1;',
  '    List<int> lx = new List<int>(), ly = new List<int>();',
  '    for (int ty = 0; ty < th; ty += step) for (int tx = 0; tx < tw; tx += step) { lx.Add(tx); ly.Add(ty); }',
  '    // 고르게 흩어진 약 48개 점을 먼저 검사해, 확실히 아닌 자리는 일찍 버림(빠르게)',
  '    int n0 = lx.Count, stride = Math.Max(1, n0 / 48);',
  '    List<int> ox = new List<int>(), oy = new List<int>();',
  '    for (int i = 0; i < n0; i += stride) { ox.Add(lx[i]); oy.Add(ly[i]); }',
  '    int K = ox.Count;',
  '    for (int i = 0; i < n0; i++) if (i % stride != 0) { ox.Add(lx[i]); oy.Add(ly[i]); }',
  '    int[] px = ox.ToArray(), py = oy.ToArray();',
  '    int n = px.Length;',
  '    int allowed = (n * (100 - sim)) / 100;',
  '    int limitK = (K * (100 - sim) * 3) / 200 + 2;',
  '    int[] tg = new int[n];',
  '    double tmean = 0;',
  '    for (int i = 0; i < n; i++) { int ti = py[i] * ts + px[i] * 4; tg[i] = (tb[ti] * 11 + tb[ti + 1] * 59 + tb[ti + 2] * 30) / 100; tmean += tg[i]; }',
  '    tmean = tmean / n;',
  '    long[] ig = null;',
  '    int iw = sw + 1;',
  '    if (bright) {',
  '      ig = new long[(long)(sw + 1) * (sh + 1)];',
  '      for (int y = 0; y < sh; y++) {',
  '        long row = 0; int r = y * ss;',
  '        for (int x = 0; x < sw; x++) {',
  '          int si = r + x * 4;',
  '          row += (sb[si] * 11 + sb[si + 1] * 59 + sb[si + 2] * 30) / 100;',
  '          ig[(y + 1) * iw + x + 1] = ig[y * iw + x + 1] + row;',
  '        }',
  '      }',
  '    }',
  '    List<int> fx = new List<int>(), fy = new List<int>();',
  '    for (int y = 0; y <= sh - th; y++) {',
  '      for (int x = 0; x <= sw - tw; x++) {',
  '        bool near = false;',
  '        for (int k = 0; k < fx.Count; k++) { if (Math.Abs(fx[k] - x) <= tw / 2 && Math.Abs(fy[k] - y) <= th / 2) { near = true; break; } }',
  '        if (near) continue;',
  '        int bad = Bad(sb, ss, tb, ts, px, py, tg, n, x, y, tol, bright, ig, iw, tw, th, tmean, allowed, K, limitK);',
  '        if (bad > allowed) continue;',
  '        int bx = x, by = y, best = bad;',
  '        for (int dy = 0; dy <= 3; dy++) {',
  '          for (int dx = -3; dx <= 3; dx++) {',
  '            int nx = x + dx, ny = y + dy;',
  '            if ((dx == 0 && dy == 0) || nx < 0 || ny < 0 || nx > sw - tw || ny > sh - th) continue;',
  '            int b2 = Bad(sb, ss, tb, ts, px, py, tg, n, nx, ny, tol, bright, ig, iw, tw, th, tmean, best - 1, K, limitK);',
  '            if (b2 < best) { best = b2; bx = nx; by = ny; }',
  '          }',
  '        }',
  '        fx.Add(bx); fy.Add(by);',
  '        if (fx.Count >= nth) { res[0] = bx; res[1] = by; return res; }',
  '      }',
  '    }',
  '    return res;',
  '  }',
  '  // 틀린 점 개수 (limit 를 넘으면 바로 그만 셈). bright = 밝기 차이(평균) 빼고 비교',
  '  static int Bad(byte[] sb, int ss, byte[] tb, int ts, int[] px, int[] py, int[] tg, int n, int x, int y, int tol, bool bright, long[] ig, int iw, int tw, int th, double tmean, int limit, int K, int limitK) {',
  '    int bad = 0;',
  '    if (bright) {',
  '      long sum = ig[(y + th) * iw + x + tw] - ig[y * iw + x + tw] - ig[(y + th) * iw + x] + ig[y * iw + x];',
  '      double off = (double)sum / (tw * th) - tmean;',
  '      for (int i = 0; i < n; i++) {',
  '        int si = (y + py[i]) * ss + (x + px[i]) * 4;',
  '        int gv = (sb[si] * 11 + sb[si + 1] * 59 + sb[si + 2] * 30) / 100;',
  '        if (Math.Abs(gv - off - tg[i]) > tol) { bad++; if (bad > limit) return bad; if (i < K && bad > limitK) return limit + 1; }',
  '      }',
  '    } else {',
  '      for (int i = 0; i < n; i++) {',
  '        int si = (y + py[i]) * ss + (x + px[i]) * 4, ti = py[i] * ts + px[i] * 4;',
  '        if (Math.Abs(sb[si] - tb[ti]) > tol || Math.Abs(sb[si + 1] - tb[ti + 1]) > tol || Math.Abs(sb[si + 2] - tb[ti + 2]) > tol) { bad++; if (bad > limit) return bad; if (i < K && bad > limitK) return limit + 1; }',
  '      }',
  '    }',
  '    return bad;',
  '  }',
];
function psImgFuncs() {
  return [
    '# ===== 이미지 찾기: 화면에서 PNG 찾기 (닮은 정도·밝기 보정·범위·몇 번째) =====',
    'try {',
    '  Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms -TypeDefinition @"',
    'using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Windows.Forms; using System.Runtime.InteropServices;',
    'public class Img {',
    '  static byte[] Pixels(Bitmap b, out int stride) {',
    '    BitmapData d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);',
    '    try { stride = d.Stride; byte[] a = new byte[d.Stride * b.Height]; Marshal.Copy(d.Scan0, a, 0, a.Length); return a; }',
    '    finally { b.UnlockBits(d); }',
    '  }',
    '  // 찾으면 화면 좌표(가운데) {x,y}, 없으면 {-1,-1}. x2<=x1 이면 화면 전체',
    '  public static int[] Find(string path, int x1, int y1, int x2, int y2, int tol, int sim, bool bright, int nth) {',
    '    int[] res = new int[] { -1, -1 };',
    '    Rectangle area = (x2 > x1 && y2 > y1) ? new Rectangle(x1, y1, x2 - x1, y2 - y1) : SystemInformation.VirtualScreen;',
    '    Bitmap tpl = null, scr = null;',
    '    try {',
    '      using (Bitmap raw = new Bitmap(path)) { tpl = new Bitmap(raw); }',
    '      scr = new Bitmap(area.Width, area.Height, PixelFormat.Format32bppArgb);',
    '      using (Graphics g = Graphics.FromImage(scr)) { g.CopyFromScreen(area.Left, area.Top, 0, 0, scr.Size); }',
    '      int ss, ts;',
    '      byte[] sb = Pixels(scr, out ss);',
    '      byte[] tb = Pixels(tpl, out ts);',
    '      int[] m = Match(sb, scr.Width, scr.Height, ss, tb, tpl.Width, tpl.Height, ts, tol, sim, bright, nth);',
    '      if (m[0] >= 0) { res[0] = area.Left + m[0] + tpl.Width / 2; res[1] = area.Top + m[1] + tpl.Height / 2; }',
    '    } finally { if (tpl != null) tpl.Dispose(); if (scr != null) scr.Dispose(); }',
    '    return res;',
    '  }',
    ...IMG_CORE_CS,
    '}',
    '"@',
    '  $script:imgReady = $true',
    '} catch { $script:imgReady = $false; Write-Host ("[주의] 이미지 찾기 기능을 쓸 수 없어요: " + $_.Exception.Message) -ForegroundColor Yellow }',
    '# 이미지 찾기: 찾으면 @(x, y) (가운데), 못 찾으면 $null (+ $script:lastErr = nofile/notfound)',
    'function FindImg($path, $tol, $sim, $bright, $x1, $y1, $x2, $y2, $nth, $retries, $everyMs){',
    '  $script:lastErr = ""',
    '  if(-not (Test-Path -LiteralPath $path)){ $script:lastErr = "nofile"; return $null }',
    '  if(-not $script:imgReady){ $script:lastErr = "noimg"; return $null }',
    '  for($k = 0; $k -lt $retries; $k++){',
    '    Pump',
    '    try { $r = [Img]::Find([string]$path, [int]$x1, [int]$y1, [int]$x2, [int]$y2, [int]$tol, [int]$sim, [bool]$bright, [int]$nth) } catch { $r = @(-1, -1) }',
    '    if($r[0] -ge 0){ return @($r[0], $r[1]) }',
    '    if($k -lt $retries - 1){ WaitMs $everyMs }',
    '  }',
    '  $script:lastErr = "notfound"; return $null',
    '}',
  ];
}
function genPSStep(s) {
  switch (s.type) {
    case 'url': return [`OpenUrl ${psFill(s.url)}`];
    case 'move': return [`MoveMouse ${num(s.x)} ${num(s.y)}`];
    case 'click': return [`ClickAt ${num(s.x)} ${num(s.y)} '${s.button || 'left'}' $${s.double ? 'true' : 'false'}`];
    case 'drag': return [`Drag ${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)}`];
    case 'hotkey': {
      if (s.preset === 'alttab') return ['AltTab'];
      const hex = v => '0x' + v.toString(16).toUpperCase();
      const rk = resolveHotkey(s);
      if (rk) {   // 직접 만든 키: 화음마다 keybd_event 로 직접 전송(Win 포함), 쉼표면 차례로
        const L = [];
        parseCombo(rk.combo).chords.forEach((c, i) => { if (i) L.push('Start-Sleep -Milliseconds 120'); const v = chordVKs(c); if (v.length) L.push(`KeyCombo @(${v.map(hex).join(', ')})`); });
        return L;
      }
      const vks = hotkeyCombo(s);
      if (vks && hotkeyUsesWin(s)) return [`KeyCombo @(${vks.map(hex).join(', ')})`];
      return [`Keys ${psStr(buildHotkey(s).sk)}`];
    }
    case 'text': return [`TypeText ${psFill(s.text)}`];
    case 'win': return [`ActivateWin ${psFill(s.title)}`];
    case 'scroll': return [`Scroll '${s.dir === 'up' ? 'up' : 'down'}' ${num(s.amount) || 1}`];
    case 'wait': return [`WaitMs ${Math.round((Number(s.sec) || 0) * 1000)}`];
    case 'readput': return genPSReadPut(s);
    default: return [];
  }
}
function genPSReadPut(s) {
  const L = psReadRegion('$txt', s.mode, s.region || {});
  if (s.read === 'number') L.push("$m = [regex]::Match([string]$txt, '-?\\d[\\d,]*(\\.\\d+)?'); $val = if($m.Success){ $m.Value -replace ',','' } else { '' }");
  else L.push('$val = ([string]$txt).Trim()');
  const lines = [`if($val -ne "" -and (SetClip $val)){ Start-Sleep -Milliseconds 90; Keys "^v"`];
  if (s.after === 'enter') lines[0] += '; Keys "{ENTER}"';
  else if (s.after === 'tab') lines[0] += '; Keys "{TAB}"';
  lines[0] += ' } else { Write-Host "[주의] 화면에서 글자를 못 읽었거나 클립보드를 못 써서 붙여넣지 않았어요" -ForegroundColor Yellow }';
  return L.concat(lines);
}
function psReadRegion(dest, mode, r) {
  if (mode === 'cursor') return [`$cxy = CursorXY`, `${dest} = ReadRegion ($cxy[0] + (${num(r.x1)})) ($cxy[1] + (${num(r.y1)})) ($cxy[0] + (${num(r.x2)})) ($cxy[1] + (${num(r.y2)}))`];
  return [`${dest} = ReadRegion ${num(r.x1)} ${num(r.y1)} ${num(r.x2)} ${num(r.y2)}`];
}
/* 조건 → c 변수에 $true/$false. 못 읽으면(빈 값) "비었음" 말고는 모두 거짓 */
function genPSCond(s, c) {
  const w = s.what || 'region';
  if (w === 'img' || w === 'text') {
    // 한 번만 확인. 단, 파일이 없거나 기능을 못 쓰면 "안 보임"으로 넘기지 않고 오류로 멈춤 (F7 = 안 보이는 것으로 보고 진행)
    const nm = cleanImgName(s.img);
    const call = w === 'img'
      ? `FindImg (ImgPath ${psStr(nm)}) ${num(s.tol) || 25} ${Math.min(100, Math.max(50, num(s.sim) || 100))} $${s.bright ? 'true' : 'false'} ${psArea(s)} 1 1 0`
      : `FindText ${psFill(s.text)} ${psArea(s)} 1 1 0`;
    const L = ['while($true){', `  $p = ${call}`, "  if($null -ne $p -or $script:lastErr -eq 'notfound' -or $script:lastErr -eq ''){ break }", "  $msg = '조건을 확인할 수 없어요'"];
    psErrMsgs(w === 'img' ? nm : null).forEach(x => L.push('  ' + x));
    L.push("  if((ErrorPause ($msg + ' (F7 = 안 보이는 것으로 보고 진행)')) -eq 'skip'){ $p = $null; break }", '}');
    L.push(`${c} = ($null -ne $p)`);
    L.push(`Write-Host ("   ${w === 'img' ? '이미지' : '글자'} 보임: " + ${c})`);
    if (s.op === 'no') L.push(`${c} = -not ${c}`);
    return L;
  }
  const L = [];
  const two = w === 'region' && s.src === 'region2';
  if (w === 'var') {
    L.push(`$txt = GetVar ${psStr(cleanVarName(s.varName))}`);
    L.push(`Write-Host ("   변수 값: " + $txt)`);
  } else {
    L.push(...psReadRegion('$txt', s.mode, s.region || {}));
    L.push('Write-Host "   조건 영역 값: $txt"');
    if (two) { L.push(...psReadRegion('$txt2', s.mode2, s.region2 || {})); L.push('Write-Host "   조건 영역2 값: $txt2"'); }
  }
  if (s.read === 'text') {
    if (s.op === 'empty') { L.push(`${c} = (([string]$txt).Trim() -eq "")`); return L; }
    const right = two ? '$txt2' : psFill(s.value);
    const guard = two ? '(([string]$txt).Trim() -ne "") -and (([string]$txt2).Trim() -ne "") -and ' : '(([string]$txt).Trim() -ne "") -and ';
    L.push(`${c} = ${guard}(TextCmp $txt ${right} ${psStr(s.op)})`);
  } else {
    L.push('$v = ReadNumber $txt');
    if (s.op === 'empty') { L.push(`${c} = ($null -eq $v)`); return L; }
    const op = { gt: '-gt', lt: '-lt', ge: '-ge', le: '-le', eq: '-eq', ne: '-ne' }[s.op] || '-ge';
    L.push(two ? '$v2 = ReadNumber $txt2' : `$v2 = ReadNumber ${psFill(s.value)}`);
    L.push(`${c} = ($null -ne $v) -and ($null -ne $v2) -and ($v ${op} $v2)`);
  }
  return L;
}

/* --- 파이썬 (pyautogui) --- */
function pyJ(v) { return JSON.stringify(v == null ? '' : String(v)); }
function pyFill(s) { const t = String(s == null ? '' : s); return t.includes('{') ? `fill(${pyJ(t)})` : pyJ(t); }
function pyBox(s) { if (s.area === 'region') { const r = s.region || {}; return `(${num(r.x1)}, ${num(r.y1)}, ${num(r.x2)}, ${num(r.y2)})`; } return 'None'; }
/* 닮은 정도(%)·색 허용 → opencv 신뢰도 */
function pyConf(s) {
  const base = { 100: 0.92, 95: 0.88, 85: 0.8, 75: 0.7 }[num(s.sim) || 100] ?? 0.88;
  const adj = { 15: 0.04, 25: 0, 40: -0.08 }[num(s.tol) || 25] ?? 0;
  return Math.round(Math.min(0.99, Math.max(0.5, base + adj)) * 100) / 100;
}
function genPY(l) {
  refreshOrphans(l);
  const P = [];
  P.push('# -*- coding: utf-8 -*-');
  P.push(`# 매크로: ${(l.name || '').replace(/[\r\n]/g, ' ')}`);
  P.push('# 실행: 1) 파이썬 설치  2) pip install pyautogui pygetwindow keyboard pyperclip  3) python "이파일.py"');
  P.push('#  (화면 글자 읽기·글자 찾기:  pip install winocr pillow  / 이미지 찾기:  pip install opencv-python )');
  P.push(`#  단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료, ${CTRL_KEYS.startNowLabel} 예약 즉시시작·오류 때 건너뛰기, ${CTRL_KEYS.restartLabel} 재실행 (keyboard 설치 시)`);
  P.push('#  급할 때: 마우스를 화면 왼쪽 맨 위 구석으로 휙 옮기면 멈춥니다.');
  P.push('import time, webbrowser, datetime, os, sys, re');
  P.push('BASE_DIR = os.path.dirname(os.path.abspath(__file__))');
  P.push('if sys.platform == "win32":   # 화면 배율(125·150%)·모니터 여러 대에서도 좌표·캡처가 같은 실제 픽셀 기준이 되게 (pyautogui 보다 먼저)');
  P.push('    try:');
  P.push('        import ctypes');
  P.push('        if not ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)): ctypes.windll.user32.SetProcessDPIAware()');
  P.push('    except Exception:');
  P.push('        try: ctypes.windll.user32.SetProcessDPIAware()');
  P.push('        except Exception: pass');
  P.push('try:');
  P.push('    import pyautogui');
  P.push('except ImportError:');
  P.push('    print("먼저:  pip install pyautogui")');
  P.push('    try: input("엔터를 누르면 창을 닫아요...")');
  P.push('    except Exception: pass');
  P.push('    raise SystemExit(1)');
  P.push('try:');
  P.push('    import pygetwindow as gw');
  P.push('except Exception:');
  P.push('    gw = None');
  P.push('pyautogui.FAILSAFE = True');
  P.push('pyautogui.PAUSE = 0.1');
  P.push("PASTE_MOD = 'command' if sys.platform == 'darwin' else 'ctrl'");
  P.push('_paused = {"v": False}; _stop = {"v": False}; _restart = {"v": False}; _can_restart = {"v": False}; _last_err = [""]');
  P.push('_ev = {"f7": False, "f8": False}; _in_err = {"v": False}; _ign = {"v": False}');
  P.push('class _Restart(Exception): pass');
  P.push('def _hk(fn):   # 매크로가 받은 F7~F10 은 앞 프로그램(엑셀 등)에 안 넘김. 매크로가 직접 보내는 F키(_ign)는 그대로 통과');
  P.push('    def h():');
  P.push('        if _ign["v"]: return True');
  P.push('        fn(); return False');
  P.push('    return h');
  P.push('def _on_f8():');
  P.push('    if _in_err["v"]: _ev["f8"] = True; return');
  P.push('    _paused["v"] = not _paused["v"]; print("|| 일시정지 (F8로 재생)" if _paused["v"] else "> 재생")');
  P.push('try:');
  P.push('    import keyboard');
  P.push("    keyboard.add_hotkey('f8', _hk(_on_f8), suppress=True)");
  P.push("    keyboard.add_hotkey('f7', _hk(lambda: _ev.__setitem__('f7', True)), suppress=True)");
  P.push("    keyboard.add_hotkey('f9', _hk(lambda: _stop.__setitem__('v', True)), suppress=True)");
  P.push("    keyboard.add_hotkey('f10', _hk(lambda: _restart.__setitem__('v', True)), suppress=True)");
  P.push(`    print("단축키: ${CTRL_KEYS.pauseLabel} 일시정지/재생, ${CTRL_KEYS.stopLabel} 종료, ${CTRL_KEYS.restartLabel} 재실행")`);
  P.push('except Exception:');
  P.push('    keyboard = None');
  P.push('    print("(F8/F9 단축키는 pip install keyboard 후 사용 가능. 급할 땐 마우스를 왼쪽 위 구석으로)")');
  P.push('');
  P.push('def control():');
  P.push('    if _stop["v"]: raise SystemExit("종료")');
  P.push('    if _restart["v"] and _can_restart["v"]: _restart["v"] = False; raise _Restart()');
  P.push('    while _paused["v"]:');
  P.push('        time.sleep(0.12)');
  P.push('        if _stop["v"]: raise SystemExit("종료")');
  P.push('        if _restart["v"] and _can_restart["v"]: _restart["v"] = False; _paused["v"] = False; raise _Restart()');
  P.push('');
  P.push('def activate_window(title):');
  P.push('    if not gw: return');
  P.push('    try:');
  P.push('        for w in gw.getWindowsWithTitle(title):');
  P.push('            w.activate(); time.sleep(0.4); return');
  P.push('    except Exception: pass');
  P.push('    print("[주의] 제목에 \'" + str(title) + "\' 이(가) 든 창이 없어요")');
  P.push('');
  P.push('# ===== 클립보드 (한글 입력은 붙여넣기로) =====');
  P.push('def set_clip(s):');
  P.push('    s = str(s)');
  P.push('    try:');
  P.push('        import pyperclip; pyperclip.copy(s); return True');
  P.push('    except Exception: pass');
  P.push('    try:');
  P.push('        import ctypes');
  P.push('        from ctypes import wintypes');
  P.push('        k32 = ctypes.windll.kernel32; u32 = ctypes.windll.user32');
  P.push('        k32.GlobalAlloc.restype = ctypes.c_void_p; k32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]');
  P.push('        k32.GlobalLock.restype = ctypes.c_void_p; k32.GlobalLock.argtypes = [ctypes.c_void_p]');
  P.push('        k32.GlobalUnlock.argtypes = [ctypes.c_void_p]');
  P.push('        u32.SetClipboardData.restype = ctypes.c_void_p; u32.SetClipboardData.argtypes = [wintypes.UINT, ctypes.c_void_p]');
  P.push("        data = (s + '\\0').encode('utf-16-le')");
  P.push('        h = k32.GlobalAlloc(0x0002, len(data)); p = k32.GlobalLock(h)');
  P.push('        ctypes.memmove(p, data, len(data)); k32.GlobalUnlock(h)');
  P.push('        if not u32.OpenClipboard(None): return False');
  P.push('        try:');
  P.push('            u32.EmptyClipboard(); u32.SetClipboardData(13, h)');
  P.push('        finally:');
  P.push('            u32.CloseClipboard()');
  P.push('        return True');
  P.push('    except Exception:');
  P.push('        return False');
  P.push('def get_clip():');
  P.push('    try:');
  P.push("        import pyperclip; return pyperclip.paste() or ''");
  P.push('    except Exception: pass');
  P.push('    try:');
  P.push('        import ctypes');
  P.push('        k32 = ctypes.windll.kernel32; u32 = ctypes.windll.user32');
  P.push('        u32.GetClipboardData.restype = ctypes.c_void_p');
  P.push('        k32.GlobalLock.restype = ctypes.c_void_p; k32.GlobalLock.argtypes = [ctypes.c_void_p]');
  P.push('        k32.GlobalUnlock.argtypes = [ctypes.c_void_p]');
  P.push("        if not u32.OpenClipboard(None): return ''");
  P.push('        try:');
  P.push('            h = u32.GetClipboardData(13)');
  P.push("            if not h: return ''");
  P.push('            p = k32.GlobalLock(h)');
  P.push('            try: return ctypes.wstring_at(p)');
  P.push('            finally: k32.GlobalUnlock(h)');
  P.push('        finally:');
  P.push('            u32.CloseClipboard()');
  P.push('    except Exception:');
  P.push("        return ''");
  P.push('def type_text(s):');
  P.push('    s = str(s)');
  P.push('    if not s: return');
  P.push('    if set_clip(s):');
  P.push('        time.sleep(0.09); pyautogui.hotkey(PASTE_MOD, "v")');
  P.push('    else:');
  P.push('        pyautogui.write(s, interval=0.02)');
  P.push('');
  P.push('# ===== 오류로 멈춤: F8 = 다시 시도, F7 = 이 동작 건너뛰기, F9 = 종료 =====');
  P.push('def _con():   # 실행(검은) 창. 윈도우 터미널이면 그 바깥 창');
  P.push('    import ctypes');
  P.push('    k = ctypes.windll.kernel32; u = ctypes.windll.user32');
  P.push('    k.GetConsoleWindow.restype = ctypes.c_void_p');
  P.push('    u.GetAncestor.restype = ctypes.c_void_p; u.GetAncestor.argtypes = [ctypes.c_void_p, ctypes.c_uint]');
  P.push('    h = k.GetConsoleWindow()');
  P.push('    return (u.GetAncestor(h, 3) or h) if h else None');
  P.push('def _wpos(h, after, flags):');
  P.push('    import ctypes; u = ctypes.windll.user32');
  P.push('    u.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]');
  P.push('    u.SetWindowPos(h, after, 0, 0, 0, 0, flags)');
  P.push('def show_console():   # 실행 창을 맨 위에 보이게(키보드 포커스는 안 뺏음). 앞에 있던 창을 돌려줌');
  P.push('    try:');
  P.push('        import ctypes; u = ctypes.windll.user32');
  P.push('        u.GetForegroundWindow.restype = ctypes.c_void_p');
  P.push('        prev = u.GetForegroundWindow(); h = _con(); mn = False');
  P.push('        if h:');
  P.push('            mn = bool(u.IsIconic(ctypes.c_void_p(h)))');
  P.push('            if mn: u.ShowWindow(ctypes.c_void_p(h), 4)');
  P.push('            _wpos(h, ctypes.c_void_p(-1), 0x53)');
  P.push('        return (prev, mn)');
  P.push('    except Exception: return (None, False)');
  P.push('def hide_console(st):   # 다시 시작할 때: 맨 위 고정을 풀고 원래 창 뒤로(찾을 화면을 가리지 않게)');
  P.push('    try:');
  P.push('        import ctypes; u = ctypes.windll.user32');
  P.push('        prev, mn = st; h = _con()');
  P.push('        if not h: return');
  P.push('        _wpos(h, ctypes.c_void_p(-2), 0x13)');
  P.push('        u.GetForegroundWindow.restype = ctypes.c_void_p');
  P.push('        if prev and prev != h:');
  P.push('            if u.GetForegroundWindow() == h: u.SetForegroundWindow(ctypes.c_void_p(prev))');
  P.push('            _wpos(h, ctypes.c_void_p(prev), 0x13)');
  P.push('        if mn: u.ShowWindow(ctypes.c_void_p(h), 7)');
  P.push('    except Exception: pass');
  P.push('def focus_console():   # 멈춤으로 끝날 때 실행 창을 앞으로');
  P.push('    try:');
  P.push('        import ctypes; u = ctypes.windll.user32; h = _con()');
  P.push('        if h: u.ShowWindow(ctypes.c_void_p(h), 9); u.SetForegroundWindow(ctypes.c_void_p(h))');
  P.push('    except Exception: pass');
  P.push('def error_pause(msg):');
  P.push('    print(); print("[오류] " + msg)');
  P.push('    print("   -> 화면을 맞춘 뒤 F8 = 다시 찾기 / F7 = 이 동작 건너뛰기 / F9 = 종료")');
  P.push('    st = show_console()');
  P.push('    try:');
  P.push('        if keyboard:');
  P.push('            _ev["f7"] = _ev["f8"] = False; _in_err["v"] = True   # 이전에 눌러 둔 키는 무시');
  P.push('            while True:');
  P.push('                time.sleep(0.08)');
  P.push('                if _stop["v"]: raise SystemExit("종료")');
  P.push('                if _restart["v"] and _can_restart["v"]: _restart["v"] = False; raise _Restart()');
  P.push('                if _ev["f8"]: _ev["f8"] = False; print("> 다시 찾아요"); return "retry"');
  P.push('                if _ev["f7"]: _ev["f7"] = False; print("> 이 동작은 건너뛰어요"); return "skip"');
  P.push('        a = input("   엔터 = 다시 찾기, s = 건너뛰기, q = 종료 : ").strip().lower()');
  P.push('        if a == "q": raise SystemExit("종료")');
  P.push('        return "skip" if a == "s" else "retry"');
  P.push('    finally:');
  P.push('        _in_err["v"] = False; hide_console(st)');
  P.push('');
  P.push('# ==== PURE-BEGIN (변수·비교: 화면과 상관없는 계산) ====');
  P.push('V = {}');
  P.push(`INIT_VARS = {${(l.vars || []).filter(v => cleanVarName(v.name)).map(v => `${pyJ(cleanVarName(v.name))}: ${pyJ(v.value ?? '')}`).join(', ')}}`);
  P.push('def init_vars():');
  P.push('    V.clear(); V.update(INIT_VARS)');
  P.push("    f = os.path.join(BASE_DIR, 'variables.txt')   # 폴더의 variables.txt 가 있으면 그 값으로 덮어씀");
  P.push('    if os.path.exists(f):');
  P.push("        with open(f, encoding='utf-8-sig') as fh:");
  P.push('            for ln in fh:');
  P.push("                ln = ln.rstrip('\\r\\n')");
  P.push("                if not ln.strip() or ln.lstrip().startswith('#'): continue");
  P.push("                if '=' in ln:");
  P.push("                    k, v = ln.split('=', 1)");
  P.push('                    if k.strip(): V[k.strip()] = v');
  P.push('def get_var(k): return str(V.get(k, ""))');
  P.push('def fill(s):   # 글자 속 {변수이름} 을 값으로');
  P.push('    s = str(s)');
  P.push('    for k, v in list(V.items()): s = s.replace("{" + k + "}", str(v))');
  P.push('    return s');
  P.push('def read_number(txt):');
  P.push("    m = re.search(r'-?\\d[\\d,]*(\\.\\d+)?', str(txt or ''))");
  P.push("    return float(m.group().replace(',', '')) if m else None");
  P.push('def text_cond(a, b, op):');
  P.push('    a = str(a or "").strip().lower(); b = str(b or "").strip().lower()');
  P.push("    if op == 'has': return b in a");
  P.push("    if op == 'ne': return a != b");
  P.push('    return a == b');
  P.push('# ==== PURE-END ====');
  P.push(`IMGDIR = ${pyJ(imgDirOf(l))}   # 이미지 폴더 (상대 경로면 이 파일이 있는 폴더 기준)`);
  P.push('if not os.path.isabs(IMGDIR): IMGDIR = os.path.join(BASE_DIR, IMGDIR)');
  P.push('def img_path(name): return os.path.join(IMGDIR, str(name) + ".png")');
  P.push('def _vorigin():   # 모니터 여러 대일 때 전체 화면의 왼쪽 위 좌표(음수일 수 있음)');
  P.push('    try:');
  P.push('        import ctypes; u = ctypes.windll.user32; return u.GetSystemMetrics(76), u.GetSystemMetrics(77)');
  P.push('    except Exception: return 0, 0');
  if (needsOcr(l.steps)) P.push(...pyOcrFuncs());
  if (needsImg(l.steps)) P.push(...pyImgFuncs());
  P.push('');
  P.push('# ==== RUN ====');
  P.push('def run():');
  const p = hhmmParts(l.startAt);
  if (p) {
    P.push(`    # 예약 시작: 다음 ${l.startAt} 까지 대기 (${CTRL_KEYS.startNowLabel} 즉시 시작)`);
    P.push('    _now = datetime.datetime.now()');
    P.push(`    _target = _now.replace(hour=${p.hh}, minute=${p.mm}, second=0, microsecond=0)`);
    P.push('    if _target <= _now: _target += datetime.timedelta(days=1)');
    P.push('    print("예약:", _target, "까지 대기")');
    P.push('    _ev["f7"] = False');
    P.push('    while datetime.datetime.now() < _target:');
    P.push('        control()');
    P.push('        if _ev["f7"]: _ev["f7"] = False; break');
    P.push('        time.sleep(1)');
  }
  P.push(`    time.sleep(${Number(l.delay) || 0})`);
  P.push('    _restart["v"] = False; _can_restart["v"] = True   # 여기서부터 F10 재실행 가능');
  P.push('    while True:   # F10 재실행 바깥 루프');
  P.push('        try:');
  const body = ['init_vars()'];
  emitPY(l.steps, body, { g: Number(l.gap) || 0, n: 0 });
  body.forEach(x => P.push('            ' + x));
  P.push('        except _Restart:');
  P.push('            print("↻ 처음부터 다시 실행"); continue');
  P.push('        break');
  P.push('');
  P.push("if __name__ == '__main__':");
  P.push('    try:');
  P.push('        run()');
  P.push('        print("매크로가 끝났어요.")');
  P.push('    except SystemExit as e:');
  P.push('        if e.code not in (None, 0): print(e.code)');
  P.push('    except KeyboardInterrupt:');
  P.push('        print("중단했어요.")');
  P.push('    except Exception:');
  P.push('        import traceback; traceback.print_exc(); print("[오류] 위 내용을 확인하세요.")');
  P.push('    finally:   # 더블클릭으로 실행했을 때 창이 바로 닫혀 메시지를 못 보는 일 방지');
  P.push('        try: input("엔터를 누르면 창을 닫아요...")');
  P.push('        except Exception: pass');
  P.push(...designBlock(l, 'py'));
  return P.join('\r\n') + '\r\n';
}
/* 묶음(반복문·조건)까지 재귀로 파이썬 코드 생성 (들여쓰기 중요) */
function emitPY(steps, out, ctx) {
  const g = ctx.g;
  const push = (pad, arr) => arr.forEach(x => out.push(pad + x));
  (steps || []).forEach(s => {
    out.push('control()');
    out.push(`print(${pyJ('▶ ' + stepDesc(s))})`);
    if (s.type === 'repeat') {
      out.push(num(s.count) > 0 ? `for _ in range(${num(s.count)}):` : 'while True:   # 무한 반복');
      const inner = ['control()']; emitPY(s.children, inner, ctx);
      if (!(g > 0)) inner.push('time.sleep(0.01)   # 쉬는 틈 없는 반복이 CPU 를 잡아먹지 않게');
      push('    ', inner);
    } else if (s.type === 'if') {
      const c = `_c${ctx.n++}`;
      genPYCond(s, c).forEach(x => out.push(x));
      out.push(`if ${c}:`);
      const t = []; emitPY(s.children, t, ctx);
      push('    ', t.length ? t : ['pass']);
      if (countOf(s.elseChildren)) {
        out.push('else:');
        const e = []; emitPY(s.elseChildren, e, ctx);
        push('    ', e.length ? e : ['pass']);
      }
    } else if (s.type === 'break') {
      out.push(ORPHAN.has(s.id) ? 'pass   # (반복문 밖의 "반복 빠져나가기"는 할 일이 없어 건너뜀)' : 'break   # 반복 빠져나가기');
    } else if (s.type === 'stop') {
      out.push('raise SystemExit("[멈춤] 매크로 종료")');
    } else if (s.type === 'setvar') {
      genPYSetVar(s).forEach(x => out.push(x));
    } else if (s.type === 'imgclick' || s.type === 'textclick') {
      pyFindStep(s).forEach(x => out.push(x));
    } else {
      genPYStep(s).forEach(x => out.push(x));
    }
    if (g > 0 && s.type !== 'break' && s.type !== 'stop') out.push(`time.sleep(${g})`);
  });
}
function genPYSetVar(s) {
  const k = pyJ(cleanVarName(s.name));
  if (s.from === 'clip') return [`V[${k}] = get_clip()`];
  if (s.from === 'read') {
    const a = pyRegionArgs(s.mode, s.region || {});
    const L = [...a.pre, `_t = read_region(${a.args})`];
    if (s.read === 'number') L.push("_m = re.search(r'-?\\d[\\d,]*(\\.\\d+)?', _t or ''); _val = _m.group().replace(',', '') if _m else ''");
    else L.push('_val = (_t or "").strip()');
    L.push(`V[${k}] = _val`);
    L.push(`print(${pyJ('[주의] 변수 {' + cleanVarName(s.name) + '}: 화면에서 글자를 못 읽었어요 (빈 값)')} if not _val else ${pyJ('   {' + cleanVarName(s.name) + '} = ')} + _val)`);
    return L;
  }
  return [`V[${k}] = ${pyFill(s.value)}`];
}
/* 찾기 실패 이유별 안내 → _msg 덮어쓰기 */
function pyErrMsgs(imgName) {
  const L = [];
  if (imgName != null) {
    L.push(`if _last_err[0] == 'nofile': _msg = ${pyJ(`이미지 '${imgName}' 파일이 없어요: `)} + img_path(${pyJ(imgName)})`);
    L.push(`if _last_err[0] == 'badfile': _msg = ${pyJ(`이미지 '${imgName}' 파일을 열 수 없어요(그림 파일이 맞는지 확인): `)} + img_path(${pyJ(imgName)})`);
    L.push(`if _last_err[0] == 'nocv': _msg = "이미지 찾기엔 opencv 가 필요해요:  pip install opencv-python pillow"`);
  }
  L.push(`if _last_err[0] == 'noocr': _msg = "화면 글자 읽기엔 winocr 가 필요해요:  pip install winocr pillow"`);
  return L;
}
/* 이미지·글자 찾기 → 못 찾으면 일시정지/멈춤/넘어감 → 클릭/이동/찾기만 → 결과 변수 */
function pyFindStep(s) {
  const isImg = s.type === 'imgclick';
  const retries = Math.max(1, num(s.retries) || 8), every = Number(s.every) || 0.7;
  const nth = Math.max(1, num(s.nth) || 1);
  const name = isImg ? cleanImgName(s.img) : String(s.text || '');
  const call = isImg
    ? `find_img(img_path(${pyJ(name)}), ${pyConf(s)}, ${s.bright ? 'True' : 'False'}, ${pyBox(s)}, ${nth}, ${retries}, ${every})`
    : `find_text(${pyFill(name)}, ${pyBox(s)}, ${nth}, ${retries}, ${every})`;
  const what = isImg ? `이미지 '${name}'` : `글자 '${name}'`;
  const tail = `${nth > 1 ? ` (${nth}번째)` : ''} 을(를) 화면에서 찾을 수 없어요 (${retries}번 시도)`;
  const L = ['_p = None', 'while True:', `    _p = ${call}`, '    if _p: break'];
  // 글자는 {변수}를 실제 값으로 바꿔 보여줌
  L.push(isImg ? `    _msg = ${pyJ(what + tail)}` : `    _msg = "글자 '" + ${pyFill(name)} + ${pyJ("'" + tail)}`);
  pyErrMsgs(isImg ? name : null).forEach(x => L.push('    ' + x));
  if (s.notfound === 'continue') L.push('    print("[주의] " + _msg + " -> 건너뛰어요"); break');
  else if (s.notfound === 'stop') L.push('    print("[오류] " + _msg + " -> 매크로를 멈춰요"); focus_console(); raise SystemExit("멈춤")');
  else L.push("    if error_pause(_msg) == 'skip': break");
  const x = `_p[0] + ${num(s.dx)}`, y = `_p[1] + ${num(s.dy)}`;
  if (s.act === 'move') L.push(`if _p: pyautogui.moveTo(${x}, ${y}, duration=0.2)`);
  else if (s.act !== 'none') L.push(`if _p: pyautogui.click(${x}, ${y}, button=${pyJ(s.button || 'left')}, clicks=${s.double ? 2 : 1})`);
  if (cleanVarName(s.saveTo)) L.push(`V[${pyJ(cleanVarName(s.saveTo))}] = "1" if _p else "0"`);
  return L;
}
function pyOcrFuncs() {
  return [
    '', '# ===== 화면 글자 읽기(OCR) — 윈도우 내장 엔진(winocr) =====',
    'try:',
    '    import winocr',
    '    from PIL import ImageGrab',
    '    _ocr = True',
    'except Exception:',
    '    _ocr = False',
    '    print("(화면 글자 읽기엔  pip install winocr pillow  필요. 없으면 글자 관련 동작은 실패로 처리)")',
    'def _g(o, k, d=None):',
    '    if isinstance(o, dict): return o.get(k, d)',
    '    return getattr(o, k, d)',
    'def _ocr_img(img):',
    "    for lang in ('ko', 'en'):   # 한국어 먼저, 없으면 영어",
    '        try: return winocr.recognize_pil_sync(img, lang)',
    '        except Exception: continue',
    '    return None',
    'def ocr_shot(bbox):',
    '    if not _ocr: return None',
    '    try:',
    '        if bbox: img = ImageGrab.grab(bbox=bbox, all_screens=True); ox, oy = bbox[0], bbox[1]',
    '        else: img = ImageGrab.grab(all_screens=True); ox, oy = _vorigin()',
    '    except Exception: return None',
    '    w, h = img.size; mx = max(w, h); sc = 1.0',
    '    if mx < 1200: sc = 2.0',
    '    elif mx > 2600: sc = 2600.0 / mx',
    '    if sc != 1.0: img = img.resize((max(1, int(w * sc)), max(1, int(h * sc))))',
    '    r = _ocr_img(img)',
    '    return (r, ox, oy, sc) if r is not None else None',
    'def read_region(x1, y1, x2, y2):',
    '    if abs(x2 - x1) < 1 or abs(y2 - y1) < 1: return ""',
    '    o = ocr_shot((min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)))',
    '    return str(_g(o[0], "text", "") or "") if o else ""',
    'def find_text(target, bbox, nth, retries, every):   # 띄어쓰기·대소문자 무시, 위→아래·왼→오른 순 n번째',
    "    t = re.sub(r'\\s', '', str(target)).lower()",
    '    _last_err[0] = ""',
    '    if not _ocr: _last_err[0] = "noocr"; return None',
    '    if not t: _last_err[0] = "notfound"; return None',
    '    for k in range(retries):',
    '        control()',
    '        o = ocr_shot(bbox)',
    '        if o:',
    '            r, ox, oy, sc = o; hits = []',
    '            for line in (_g(r, "lines", []) or []):',
    '                ws = list(_g(line, "words", []) or []); s = ""; st = []',
    "                for w in ws: st.append(len(s)); s += re.sub(r'\\s', '', str(_g(w, 'text', '') or '')).lower()",
    '                frm = 0',
    '                while True:',
    '                    i = s.find(t, frm)',
    '                    if i < 0: break',
    '                    e = i + len(t); box = None',
    '                    for q, w in enumerate(ws):',
    "                        a = st[q]; b = a + len(re.sub(r'\\s', '', str(_g(w, 'text', '') or '')))",
    '                        if b > i and a < e:',
    '                            rc = _g(w, "bounding_rect", None) or _g(w, "boundingRect", None) or {}',
    '                            rx, ry = float(_g(rc, "x", 0) or 0), float(_g(rc, "y", 0) or 0)',
    '                            rw, rh = float(_g(rc, "width", 0) or 0), float(_g(rc, "height", 0) or 0)',
    '                            box = [rx, ry, rx + rw, ry + rh] if box is None else [min(box[0], rx), min(box[1], ry), max(box[2], rx + rw), max(box[3], ry + rh)]',
    '                    if box:',
    '                        cx = ox + int((box[0] + box[2]) / 2 / sc); cy = oy + int((box[1] + box[3]) / 2 / sc)',
    '                        hits.append((cy // 12, cx, cy))',
    '                    frm = i + 1',
    '            hits.sort()',
    '            if len(hits) >= nth: h = hits[nth - 1]; return (h[1], h[2])',
    '        if k < retries - 1: time.sleep(every)',
    '    _last_err[0] = "notfound"; return None',
  ];
}
function pyImgFuncs() {
  return [
    '', '# ===== 이미지 찾기 (opencv 필요) =====',
    'try:',
    '    import cv2  # opencv-python',
    '    from PIL import Image, ImageGrab',
    '    _imgcv = True',
    'except Exception:',
    '    _imgcv = False',
    '    print("(이미지 찾기엔  pip install opencv-python pillow  필요. 없으면 이미지 동작에서 오류로 멈춰요)")',
    'def find_img(path, conf, gray, bbox, nth, retries, every):   # 위→아래·왼→오른 순 n번째의 가운데 좌표',
    '    _last_err[0] = ""',
    '    if not os.path.exists(path): _last_err[0] = "nofile"; return None',
    '    if not _imgcv: _last_err[0] = "nocv"; return None',
    '    try:   # 그림은 PIL 로 열어 넘김 (opencv 는 한글 경로를 못 열어서)',
    '        needle = Image.open(path); needle.load()',
    '    except Exception:',
    '        _last_err[0] = "badfile"; return None',
    '    for k in range(retries):',
    '        control()',
    '        try:   # 모니터 여러 대 전체(또는 지정한 네모)를 찍어 그 안에서 찾음',
    '            if bbox: hay = ImageGrab.grab(bbox=bbox, all_screens=True); ox, oy = bbox[0], bbox[1]',
    '            else: hay = ImageGrab.grab(all_screens=True); ox, oy = _vorigin()',
    '            boxes = list(pyautogui.locateAll(needle, hay, confidence=conf, grayscale=gray))',
    '        except Exception:',
    '            boxes = []; ox = oy = 0',
    '        pts = []',
    '        for b in boxes:',
    '            cx, cy = int(ox + b.left + b.width // 2), int(oy + b.top + b.height // 2)',
    '            if all(abs(cx - x) > b.width // 2 or abs(cy - y) > b.height // 2 for x, y in pts): pts.append((cx, cy))',
    '        pts.sort(key=lambda p: (p[1] // 12, p[0]))',
    '        if len(pts) >= nth: return pts[nth - 1]',
    '        if k < retries - 1: time.sleep(every)',
    '    _last_err[0] = "notfound"; return None',
  ];
}
function genPYStep(s) {
  const J = pyJ;
  switch (s.type) {
    case 'url': return [`webbrowser.open(${pyFill(s.url)})`];
    case 'move': return [`pyautogui.moveTo(${num(s.x)}, ${num(s.y)}, duration=0.2)`];
    case 'click': {
      const a = [`${num(s.x)}, ${num(s.y)}`];
      if (s.button && s.button !== 'left') a.push(`button=${J(s.button)}`);
      if (s.double) a.push('clicks=2');
      return [`pyautogui.click(${a.join(', ')})`];
    }
    case 'drag': return [`pyautogui.moveTo(${num(s.x1)}, ${num(s.y1)}, duration=0.2)`, `pyautogui.dragTo(${num(s.x2)}, ${num(s.y2)}, duration=0.3, button='left')`];
    case 'hotkey': {
      const rk = resolveHotkey(s);
      if (!rk) { const h = buildHotkey(s); return h.singlePy ? [`pyautogui.press(${J(h.py[0])})`] : [`pyautogui.hotkey(${h.py.map(J).join(', ')})`]; }
      const L = [];
      const chords = parseCombo(rk.combo).chords;
      const own = chords.some(c => /^f(7|8|9|10)$/.test(c.key));   // 매크로 제어 키를 직접 보낼 땐 자기 단축키로 안 받게
      if (own) L.push('_ign["v"] = True');
      chords.forEach((c, i) => {
        if (i) L.push('time.sleep(0.12)');
        const k = chordPY(c);
        L.push(k.length === 1 ? `pyautogui.press(${J(k[0])})` : `pyautogui.hotkey(${k.map(J).join(', ')})`);
      });
      if (own) L.push('time.sleep(0.15); _ign["v"] = False');
      return L;
    }
    case 'text': return [`type_text(${pyFill(s.text)})`];
    case 'win': return [`activate_window(${pyFill(s.title)})`];
    case 'scroll': return [`pyautogui.scroll(${(s.dir === 'up' ? 1 : -1) * (num(s.amount) || 1) * 120})   # 120 = 휠 한 칸`];
    case 'wait': return [`time.sleep(${Number(s.sec) || 0})`];
    case 'readput': return genPYReadPut(s);
    default: return [];
  }
}
function genPYReadPut(s) {
  const a = pyRegionArgs(s.mode, s.region || {}); const L = [...a.pre];
  L.push(`_t = read_region(${a.args})`);
  if (s.read === 'number') L.push("_m = re.search(r'-?\\d[\\d,]*(\\.\\d+)?', _t or ''); _val = _m.group().replace(',', '') if _m else ''");
  else L.push('_val = (_t or "").strip()');
  L.push('if _val:');
  L.push('    if set_clip(_val):');
  L.push('        time.sleep(0.09); pyautogui.hotkey(PASTE_MOD, "v")');
  L.push('    else:');
  L.push('        pyautogui.write(_val, interval=0.02)');
  if (s.after === 'enter') L.push("    pyautogui.press('enter')");
  else if (s.after === 'tab') L.push("    pyautogui.press('tab')");
  L.push('else:');
  L.push('    print("[주의] 화면에서 글자를 못 읽어 붙여넣지 않았어요")');
  return L;
}
function pyRegionArgs(mode, r) {
  if (mode === 'cursor') return { pre: ['_cx, _cy = pyautogui.position()'], args: `_cx + ${num(r.x1)}, _cy + ${num(r.y1)}, _cx + ${num(r.x2)}, _cy + ${num(r.y2)}` };
  return { pre: [], args: `${num(r.x1)}, ${num(r.y1)}, ${num(r.x2)}, ${num(r.y2)}` };
}
/* 조건 → c 변수에 True/False. 못 읽으면(빈 값) "비었음" 말고는 모두 거짓 */
function genPYCond(s, c) {
  const w = s.what || 'region';
  if (w === 'img' || w === 'text') {
    // 한 번만 확인. 단, 파일이 없거나 기능을 못 쓰면 "안 보임"으로 넘기지 않고 오류로 멈춤 (F7 = 안 보이는 것으로 보고 진행)
    const nm = cleanImgName(s.img);
    const call = w === 'img' ? `find_img(img_path(${pyJ(nm)}), ${pyConf(s)}, ${s.bright ? 'True' : 'False'}, ${pyBox(s)}, 1, 1, 0)` : `find_text(${pyFill(s.text)}, ${pyBox(s)}, 1, 1, 0)`;
    const L = ['while True:', `    _p = ${call}`, "    if _p is not None or _last_err[0] in ('notfound', ''): break", '    _msg = "조건을 확인할 수 없어요"'];
    pyErrMsgs(w === 'img' ? nm : null).forEach(x => L.push('    ' + x));
    L.push("    if error_pause(_msg + ' (F7 = 안 보이는 것으로 보고 진행)') == 'skip': _p = None; break");
    L.push(`${c} = _p is not None` + (s.op === 'no' ? `; ${c} = not ${c}` : ''));
    return L;
  }
  const L = [];
  const two = w === 'region' && s.src === 'region2';
  if (w === 'var') {
    L.push(`_t = get_var(${pyJ(cleanVarName(s.varName))})`);
    L.push('print("   변수 값:", _t)');
  } else {
    const a = pyRegionArgs(s.mode, s.region || {}); L.push(...a.pre);
    L.push(`_t = read_region(${a.args})`);
    L.push('print("   조건 영역 값:", _t)');
    if (two) { const b = pyRegionArgs(s.mode2, s.region2 || {}); L.push(...b.pre); L.push(`_t2 = read_region(${b.args})`); L.push('print("   조건 영역2 값:", _t2)'); }
  }
  if (s.read === 'text') {
    if (s.op === 'empty') { L.push(`${c} = (str(_t or "").strip() == "")`); return L; }
    const right = two ? '_t2' : pyFill(s.value);
    const guard = two ? 'str(_t or "").strip() and str(_t2 or "").strip() and ' : 'str(_t or "").strip() and ';
    L.push(`${c} = bool(${guard}text_cond(_t, ${right}, ${pyJ(s.op)}))`);
  } else {
    L.push('_v = read_number(_t)');
    if (s.op === 'empty') { L.push(`${c} = (_v is None)`); return L; }
    const op = { gt: '>', lt: '<', ge: '>=', le: '<=', eq: '==', ne: '!=' }[s.op] || '>=';
    L.push(two ? '_v2 = read_number(_t2)' : `_v2 = read_number(${pyFill(s.value)})`);
    L.push(`${c} = (_v is not None and _v2 is not None and _v ${op} _v2)`);
  }
  return L;
}

/* --- 좌표 찾기 도우미 --- */
function genFinder() {
  return [
    '# -*- 좌표 찾기 도우미 -*-  (마우스 위치의 X·Y 를 실시간으로 보여줘요 · 설치 불필요)',
    '# ★ 무설치 매크로와 똑같은 기준(화면 배율과 상관없이 실제 픽셀)이라 좌표가 정확히 일치해요. 끝내려면 창을 닫거나 Esc. ★',
    'try {',
    ...psDpiFix(),
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices;',
    'public class CurPos { [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p); }',
    'public struct PT { public int X; public int Y; }',
    '"@',
    '$f = New-Object System.Windows.Forms.Form',
    '$f.Text = "좌표 찾기"; $f.TopMost = $true; $f.FormBorderStyle = "FixedToolWindow"',
    '$f.Width = 320; $f.Height = 150; $f.StartPosition = "Manual"; $f.Left = 20; $f.Top = 20; $f.KeyPreview = $true',
    '$lbl = New-Object System.Windows.Forms.Label',
    '$lbl.Dock = "Fill"; $lbl.TextAlign = "MiddleCenter"',
    '$lbl.Font = New-Object System.Drawing.Font("Segoe UI", 14)',
    '$f.Controls.Add($lbl)',
    '$t = New-Object System.Windows.Forms.Timer; $t.Interval = 60',
    '$t.Add_Tick({ $p = New-Object PT; [CurPos]::GetCursorPos([ref]$p) | Out-Null; $lbl.Text = ("X = " + $p.X + "    Y = " + $p.Y + "`n`n이 숫자를 매크로에 적으세요") })',
    '$f.Add_KeyDown({ if($_.KeyCode -eq "Escape"){ $f.Close() } })',
    '$t.Start(); [void]$f.ShowDialog(); $t.Stop()',
    '} catch {',
    '  try { [System.Windows.Forms.MessageBox]::Show("오류:`n" + $_.Exception.Message, "좌표 찾기 도우미") | Out-Null } catch {}',
    '  Write-Host ("오류: " + $_.Exception.Message)',
    '}',
    '',
  ].join('\r\n');
}

/* 공통: 드래그로 네모 영역을 긁는 반투명 전체화면(무설치). Snip 은 "ok"/"small"/"esc" 반환 */
function psSnipFn() {
  return [
    'function Snip(){',
    '  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '  $f = New-Object System.Windows.Forms.Form',
    '  $f.FormBorderStyle = "None"; $f.StartPosition = "Manual"',
    '  $f.SetBounds($vs.Left, $vs.Top, $vs.Width, $vs.Height)',
    '  $f.BackColor = [System.Drawing.Color]::Black; $f.Opacity = 0.35; $f.TopMost = $true; $f.KeyPreview = $true',
    '  $f.Cursor = [System.Windows.Forms.Cursors]::Cross',
    '  $script:sx = 0; $script:sy = 0; $script:rect = New-Object System.Drawing.Rectangle 0,0,0,0; $script:drawing = $false; $script:res = "small"',
    '  $f.Add_MouseDown({ $script:sx = $_.X; $script:sy = $_.Y; $script:drawing = $true })',
    '  $f.Add_MouseMove({ if($script:drawing){ $x=[Math]::Min($script:sx,$_.X); $y=[Math]::Min($script:sy,$_.Y); $w=[Math]::Abs($_.X-$script:sx); $h=[Math]::Abs($_.Y-$script:sy); $script:rect = New-Object System.Drawing.Rectangle $x,$y,$w,$h; $f.Invalidate() } })',
    '  $f.Add_Paint({ if($script:rect.Width -gt 0 -and $script:rect.Height -gt 0){ $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::Red), 2; $_.Graphics.DrawRectangle($pen, $script:rect); $pen.Dispose() } })',
    '  $f.Add_MouseUp({ $script:drawing = $false; if($script:rect.Width -ge 3 -and $script:rect.Height -ge 3){ $script:res = "ok" } else { $script:res = "small" }; $f.Close() })',
    '  $f.Add_KeyDown({ if($_.KeyCode -eq "Escape"){ $script:res = "esc"; $f.Close() } })',
    '  [void]$f.ShowDialog(); $f.Dispose()',
    '  $script:vsLeft = $vs.Left; $script:vsTop = $vs.Top',
    '  return $script:res',
    '}',
  ];
}

/* --- 영역 선택 도우미 (드래그로 네모 긁어 좌표 알려주기, 무설치) → 조건 OCR 영역용 --- */
function genRegionPicker() {
  return [
    '# -*- 영역 선택 도우미 -*-  (드래그로 네모 긁으면 그 영역 좌표를 알려줘요 · 설치 불필요)',
    '# 나온 네 숫자를 매크로 "조건" 동작의 영역 칸(왼쪽X·위Y·오른쪽X·아래Y)에 적으세요.',
    'try {',
    ...psDpiFix(),
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    ...psSnipFn(),
    '[System.Windows.Forms.MessageBox]::Show("읽을 네모 영역을 마우스로 드래그해 긁으세요.`n긁으면 좌표를 알려줘요. 그만하려면 어두운 화면에서 Esc.", "영역 선택 도우미") | Out-Null',
    'while($true){',
    '  $r = Snip',
    '  if($r -eq "esc"){ break }',
    '  if($r -eq "ok"){',
    '    $L = $script:vsLeft + $script:rect.X; $T = $script:vsTop + $script:rect.Y',
    '    $R = $L + $script:rect.Width; $B = $T + $script:rect.Height',
    '    [System.Windows.Forms.MessageBox]::Show("왼쪽 X = $L`n위 Y = $T`n오른쪽 X = $R`n아래 Y = $B`n`n조건 동작의 영역 칸에 적으세요.", "영역 좌표") | Out-Null',
    '  }',
    '}',
    'Write-Host "끝났어요."',
    '} catch {',
    '  try { [System.Windows.Forms.MessageBox]::Show("오류가 났어요:`n" + $_.Exception.Message, "영역 선택 도우미") | Out-Null } catch {}',
    '  Write-Host ("오류: " + $_.Exception.Message)',
    '}',
    '',
  ].join('\r\n');
}

/* --- 이미지 캡처 도우미 (드래그로 긁은 그림을 "이미지폴더\이름.png" 로 저장, 무설치) → 이미지 찾기용 ---
   names: 이 매크로에 필요한 이미지 이름들(차례로 찍게 안내). imgDir: 저장 폴더(상대면 이 파일 기준) */
function genImageCapturer(names, imgDir) {
  const list = (names || []).map(cleanImgName).filter(Boolean);
  return [
    '# -*- 이미지 캡처 도우미 -*-  (드래그로 긁은 그림을 이미지 폴더에 "이름.png" 로 저장 · 설치 불필요)',
    '# 매크로가 실행될 때 이 그림을 화면에서 찾아요. 같은 이름으로 다시 찍으면 새 그림으로 바뀌어요.',
    'try {',
    ...psDpiFix(),
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    `$dir = ${psStr(imgDir || 'images')}`,
    'if(-not [System.IO.Path]::IsPathRooted($dir)){ $dir = Join-Path $PSScriptRoot $dir }',
    'if(-not (Test-Path -LiteralPath $dir)){ New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    `$need = @(${list.map(psStr).join(', ')})`,
    ...psSnipFn(),
    'function Clean($n){ return ([string]$n -replace \'[\\\\/:*?"<>|`]\', \'\').Trim() }',
    '# 드래그로 찍어 저장 (Esc 면 $false)',
    'function Shoot($name){',
    '  while($true){',
    '    $r = Snip',
    '    if($r -eq "esc"){ return $false }',
    '    if($r -eq "ok"){ break }',
    '    [System.Windows.Forms.MessageBox]::Show("너무 작아요. 조금 더 크게 드래그하세요.", "이미지 캡처 도우미") | Out-Null',
    '  }',
    '  Start-Sleep -Milliseconds 200',
    '  $bmp = New-Object System.Drawing.Bitmap $script:rect.Width, $script:rect.Height',
    '  $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '  $g.CopyFromScreen($script:vsLeft + $script:rect.X, $script:vsTop + $script:rect.Y, 0, 0, (New-Object System.Drawing.Size $script:rect.Width, $script:rect.Height))',
    '  $g.Dispose()',
    '  $out = Join-Path $dir ($name + ".png")',
    '  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()',
    '  Write-Host ("저장했어요: " + $out)',
    '  return $true',
    '}',
    '$mb = [System.Windows.Forms.MessageBox]',
    'if($need.Count -gt 0){',
    '  $mb::Show(("이 매크로에 필요한 이미지 " + $need.Count + "개를 차례로 찍어요:`n" + ($need -join ", ") + "`n`n[확인]을 누르면 화면이 어두워져요. 찾을 버튼·그림을 드래그로 긁으세요. (Esc = 그만)`n저장 폴더: " + $dir), "이미지 캡처 도우미") | Out-Null',
    '  foreach($nm in $need){',
    '    $out = Join-Path $dir ($nm + ".png")',
    '    if(Test-Path -LiteralPath $out){',
    '      $a = $mb::Show(("\'" + $nm + "\' 이미지가 이미 있어요. 다시 찍을까요?`n[예] 다시 찍기  [아니요] 그대로 두고 다음  [취소] 그만"), "이미지 캡처 도우미", "YesNoCancel")',
    '      if($a -eq "Cancel"){ break }',
    '      if($a -eq "No"){ continue }',
    '    } else {',
    '      $mb::Show(("다음 이미지를 찍어요:  " + $nm), "이미지 캡처 도우미") | Out-Null',
    '    }',
    '    if(-not (Shoot $nm)){ break }',
    '  }',
    '}',
    'while($true){',
    '  $a = $mb::Show("다른 이미지를 더 찍을까요? (이름을 직접 정해요)", "이미지 캡처 도우미", "YesNo")',
    '  if($a -ne "Yes"){ break }',
    '  $nm = Clean ([Microsoft.VisualBasic.Interaction]::InputBox("저장할 이름 (웹 매크로의 \'이미지 이름\'과 똑같이):", "이미지 이름", "이미지1"))',
    '  if($nm -eq ""){ continue }',
    '  $out = Join-Path $dir ($nm + ".png")',
    '  if((Test-Path -LiteralPath $out) -and ($mb::Show(("\'" + $nm + "\' 이(가) 이미 있어요. 새로 찍어 바꿀까요?"), "이미지 캡처 도우미", "YesNo") -ne "Yes")){ continue }',
    '  [void](Shoot $nm)',
    '}',
    'Write-Host ("끝났어요. 이미지 폴더: " + $dir)',
    '} catch {',
    '  try { [System.Windows.Forms.MessageBox]::Show("오류가 났어요:`n" + $_.Exception.Message, "이미지 캡처 도우미") | Out-Null } catch {}',
    '  Write-Host ("오류: " + $_.Exception.Message)',
    '}',
    '',
  ].join('\r\n');
}
/* ★ .bat 은 ASCII만 (도우미 .ps1 은 GUI/MessageBox 로 한글 표시) */
function genHelperBat(ps1Name) {
  // .bat 는 순수 ASCII + chcp 없음
  return [
    '@echo off',
    ...batPick(ps1Name, '-run'),
    'powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%F%"',
    'echo.', 'pause', '',
  ].join('\r\n');
}

/* .ahk 에서 안 되는 기능 목록 (내보낼 때 알려줌) */
function ahkUnsupported(l) {
  const m = new Set();
  walkSteps(l.steps, s => {
    if (s.type === 'readput') m.add('영역 값 읽어 입력');
    if (s.type === 'textclick') m.add('글자 찾아 클릭');
    if (s.type === 'setvar' && s.from === 'read') m.add('변수 ← 화면 글자 읽기');
    if (s.type === 'if' && (!s.what || s.what === 'region' || s.what === 'text')) m.add('조건(화면 글자 읽기) — 안에 담은 동작도 실행 안 됨');
    const img = s.type === 'imgclick' || (s.type === 'if' && s.what === 'img');
    if (img && num(s.nth) > 1) m.add('이미지 "몇 번째" (첫 번째만 찾음)');
    if (img && s.bright) m.add('밝기 차이 무시');
  });
  return [...m];
}
/* 건너뛰는 조건 안에 "멈춤/반복 빠져나가기"가 있으면 반복이 안 끝날 수 있음 */
function ahkLostExit(l) {
  return anyStep(l.steps, s => s.type === 'if' && (!s.what || s.what === 'region' || s.what === 'text')
    && anyStep([...(s.children || []), ...(s.elseChildren || [])], x => x.type === 'stop' || x.type === 'break'));
}

function readmeText(l, names) {
  const dir = imgDirOf(l);
  const vars = (l.vars || []).map(v => cleanVarName(v.name)).filter(Boolean);
  return [
    `매크로: ${l.name || ''}`,
    '만든 곳: 매크로 설계소 (웹)',
    '',
    '[처음 쓰는 법]',
    '1) 이 zip 파일을 "압축 풀기" 해서 폴더째 원하는 곳(예: 바탕화면)에 두세요.',
    names.length
      ? `2) 먼저 "2-capture-images.bat" 를 더블클릭해 필요한 이미지를 찍으세요 → "${dir}" 폴더에 "이름.png" 로 저장돼요.\r\n   필요한 이미지: ${names.join(', ')}`
      : '2) (이미지 찾기 동작이 없으면 건너뛰세요) 이미지가 필요하면 "2-capture-images.bat" 로 찍어요.',
    '3) "1-run-macro.bat" 를 더블클릭하면 매크로가 시작돼요. (설치 필요 없음)',
    '',
    '[실행 중 단축키]',
    `  ${CTRL_KEYS.pauseLabel} 일시정지/재생   ${CTRL_KEYS.stopLabel} 종료   ${CTRL_KEYS.restartLabel} 처음부터 다시`,
    `  ${CTRL_KEYS.startNowLabel} 예약 시간을 기다리는 중이면 바로 시작 / 오류로 멈췄을 때는 그 동작 건너뛰기`,
    '  이미지·글자를 끝내 못 찾거나 이미지 파일이 없으면 검은 창이 맨 위에 뜨고 [오류]로 멈춰요. 화면을 맞춘 뒤 F8 = 다시 찾기.',
    '  매크로가 도는 동안 F7~F10 은 매크로 전용이라 엑셀 등 다른 프로그램에 전달되지 않아요.',
    '',
    '[폴더 안 파일]',
    `  ${dir}\\        찾을 이미지. 같은 이름의 png 로 바꿔 넣으면 그 그림으로 찾아요.`,
    '  variables.txt  변수 값. "이름=값" 줄을 고치면 웹에서 다시 받지 않아도 그 값으로 실행돼요.',
    vars.length ? `                 지금 변수: ${vars.join(', ')}` : '                 (변수를 쓰지 않으면 비워 둬도 돼요)',
    '  macro-design.json  설계도. 웹 매크로 설계소의 [불러오기]로 이 파일(또는 macro.ps1)을 고르면 동작이 그대로 복원돼요.',
    '  3-find-xy.bat     좌표 찾기 도우미 (클릭할 X·Y 알아내기)',
    '  4-pick-region.bat 영역 선택 도우미 (드래그한 네모의 좌표 알아내기)',
    '  option-...        다른 실행 방식(선택): AutoHotkey(.ahk), 파이썬(.py)',
    '',
    '[주의]',
    '  macro.ps1 같은 코드 파일을 직접 고치면, 웹으로 불러올 때 그 고친 내용은 복원되지 않아요.',
    '  동작은 웹에서 고치고 다시 받으세요. (이미지·variables.txt 는 이 폴더에서 바로 바꿔도 돼요)',
    '  이미지를 찍을 때와 실행할 때의 화면 해상도·배율(100/125/150%)이 같아야 이미지를 찾아요.',
    '  좌표(X·Y)는 화면 배율과 상관없이 "실제 픽셀" 기준이에요. 꼭 3-find-xy.bat 로 잰 숫자를 쓰세요.',
    '  같은 파일을 여러 번 받아 "이름 (1).bat" 처럼 번호가 붙어도, 같은 번호의 짝 파일을 실행해요.',
    '',
  ].join('\r\n');
}
function variablesText(l) {
  const rows = (l.vars || []).filter(v => cleanVarName(v.name)).map(v => `${cleanVarName(v.name)}=${String(v.value ?? '').replace(/[\r\n]+/g, ' ')}`);
  return ['# 변수 값 (한 줄에 하나:  이름=값 )   # 로 시작하는 줄은 메모예요.',
    '# 여기를 고치면 매크로를 다시 받지 않아도 바뀐 값으로 실행돼요. (웹의 처음 값보다 이 파일이 우선)',
    ...rows, ''].join('\r\n');
}
function imagesReadme(names) {
  return ['이 폴더에 매크로가 찾을 이미지를 "이름.png" 로 넣어요.',
    '"2-capture-images.bat" 로 찍으면 자동으로 여기 저장돼요.',
    names.length ? `필요한 이미지: ${names.map(n => n + '.png').join(', ')}` : '', ''].join('\r\n');
}
/* 폴더(zip) 하나에 실행 파일·도우미·이미지 폴더·설계도를 모두 담기 */
function folderFiles(l, stem) {
  const T = (name, text, bom) => ({ name: `${stem}/${name}`, data: utf8((bom ? '﻿' : '') + text) });
  const names = imgNames(l);
  const dir = imgDirOf(l);
  const files = [
    { name: `${stem}/`, data: null },
    T('README.txt', readmeText(l, names), true),
    T('1-run-macro.bat', genPSBat(l, 'macro.ps1')),
    T('macro.ps1', genPS1(l), true),
    T('2-capture-images.bat', genHelperBat('capture-images.ps1')),
    T('capture-images.ps1', genImageCapturer(names, dir), true),
    T('3-find-xy.bat', genHelperBat('find-xy.ps1')),
    T('find-xy.ps1', genFinder(), true),
    T('4-pick-region.bat', genHelperBat('pick-region.ps1')),
    T('pick-region.ps1', genRegionPicker(), true),
    T('variables.txt', variablesText(l), true),
    T('macro-design.json', JSON.stringify(designOf(l), null, 2)),
    T('option-ahk-run.bat', genBAT(l, 'option-ahk-macro.ahk')),
    T('option-ahk-macro.ahk', genAHK(l), true),
    T('option-python-macro.py', genPY(l)),
  ];
  // 이미지 폴더(상대 경로·영문일 때만 미리 만들어 둠 — 한글 폴더명은 압축 해제 때 깨질 수 있어 도우미가 만들게 둠)
  if (!isAbsDir(dir) && /^[\x20-\x7E]+$/.test(dir)) {
    const d = dir.replace(/\\/g, '/');
    files.splice(1, 0, { name: `${stem}/${d}/`, data: null }, T(`${d}/README.txt`, imagesReadme(names), true));
  }
  return files;
}

function doExport(kind) {
  const l = activeLoop();
  if (['ahk', 'ps', 'py', 'zip'].includes(kind)) {
    if (!l.steps.length) { toast('먼저 동작을 추가하세요'); return; }
    if (hasIssues(l) && !confirm('입력이 빠진 동작이 있어요(빨간 ⚠). 그대로 내보낼까요?')) return;
    if (kind === 'ahk') {
      const miss = ahkUnsupported(l);
      if (miss.length) {
        const msg = '.ahk 에서는 아래 기능이 안 돼요(건너뜀):\n- ' + miss.join('\n- ')
          + (ahkLostExit(l) ? '\n\n⚠ 건너뛰는 조건 안의 "멈춤/반복 빠져나가기"도 실행되지 않아, 반복이 스스로 끝나지 않을 수 있어요(F9 또는 Esc로 종료).' : '')
          + '\n\n이 기능을 쓰려면 "폴더로 받기"나 "무설치(윈도우)"를 쓰세요. 그래도 .ahk 로 받을까요?';
        if (!confirm(msg)) return;
      }
    }
  }
  const stem = stemOf(l);
  if (kind === 'zip') {
    download(`${stem}.zip`, zipBytes(folderFiles(l, stem)), 'application/zip');
    toast(`${stem}.zip 을 받았어요 — 압축을 풀고 1-run-macro.bat`);
  } else if (kind === 'ahk') {
    const ahkName = `${stem}.ahk`;
    download(ahkName, genAHK(l));
    download(`${stem}-run.bat`, genBAT(l, ahkName), 'application/bat');
    toast('.ahk 와 .bat 를 받았어요');
  } else if (kind === 'ps') {
    const ps1Name = `${stem}.ps1`;
    download(ps1Name, genPS1(l), 'text/plain;charset=utf-8');
    download(`${stem}-noinstall.bat`, genPSBat(l, ps1Name), 'application/bat');
    toast('무설치 실행 파일을 받았어요');
  } else if (kind === 'py') {
    download(`${stem}.py`, genPY(l), 'text/x-python;charset=utf-8');
    toast('파이썬 파일을 받았어요');
  } else if (kind === 'finder') {
    const ps1 = 'coordinate-finder.ps1';
    download(ps1, genFinder(), 'text/plain;charset=utf-8');
    download('coordinate-finder-run.bat', genHelperBat(ps1), 'application/bat');
    toast('좌표 찾기 도우미를 받았어요 (coordinate-finder)');
  } else if (kind === 'region') {
    const ps1 = 'region-picker.ps1';
    download(ps1, genRegionPicker(), 'text/plain;charset=utf-8');
    download('region-picker-run.bat', genHelperBat(ps1), 'application/bat');
    toast('영역 선택 도우미를 받았어요 (region-picker)');
  } else if (kind === 'imgcap') {
    const ps1 = 'image-capture.ps1';
    download(ps1, genImageCapturer(imgNames(l), imgDirOf(l)), 'text/plain;charset=utf-8');
    download('image-capture-run.bat', genHelperBat(ps1), 'application/bat');
    toast('이미지 캡처 도우미를 받았어요 — 매크로 파일과 같은 폴더에 두세요');
  } else if (kind === 'backup') {
    download(fileName('macro-studio-backup', 'json'), JSON.stringify(state, null, 2), 'application/json');
    toast('전체 백업을 저장했어요');
  }
}
document.querySelectorAll('[data-export]').forEach(b => b.onclick = () => doExport(b.dataset.export));

/* ===== 불러오기: 전체 백업 / 설계도(json) / 받은 코드 파일(.ps1·.py·.ahk) → 그대로 복원 ===== */
function importDesignText(text) {
  const o = parseDesignText(text);
  if (!o) { toast('설계도를 찾지 못했어요 (이 앱에서 받은 파일만 돼요)'); return false; }
  if (Array.isArray(o.loops)) {
    if (!confirm('전체 백업 파일이에요. 지금 작업방들을 모두 이 백업으로 바꿀까요?')) return false;
    state = normalize(o); activeId = state.loops[0].id;
    save(); renderAll(); toast('백업을 불러왔어요');
    return true;
  }
  if (o.kind === 'macro-studio-design' && o.loop) {
    const l = JSON.parse(JSON.stringify(o.loop));
    // 함께 온 내 단축키: 없으면 추가, 같은 아이디인데 키가 다르면 그 동작은 적힌 키로("직접 만들기")
    (Array.isArray(o.myKeys) ? o.myKeys : []).forEach(k => {
      if (!k || !k.id) return;
      const have = myKey(k.id);
      if (!have) state.myKeys.push({ id: String(k.id), name: String(k.name || '내 단축키'), combo: String(k.combo || '') });
      else if (have.combo !== k.combo) walkSteps(l.steps || [], s => { if (s.type === 'hotkey' && s.preset === 'my:' + k.id) s.preset = 'custom'; });
    });
    l.id = uid();
    walkSteps(l.steps || [], s => { s.id = uid(); });
    if (state.loops.some(x => x.name === l.name)) l.name = `${l.name || '작업방'} (불러옴)`;
    const fixed = normalize({ screen: state.screen, loops: [l] }).loops[0];
    state.loops.push(fixed); activeId = fixed.id;
    save(); renderAll(); toast(`"${fixed.name}" 작업방으로 복원했어요`);
    return true;
  }
  toast('알 수 없는 파일이에요');
  return false;
}
$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => importDesignText(r.result);
  r.readAsText(f);
  e.target.value = '';
};
$('#import-paste-btn').onclick = () => {
  const box = $('#import-text');
  if (!box.value.trim()) { toast('먼저 내용을 붙여넣어 주세요'); return; }
  if (importDesignText(box.value)) box.value = '';
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
<li><b>좌표(위치) 알아내기</b>: 아래 내보내기에서 <b>좌표 찾기 도우미</b>를 받아 PC에서 더블클릭해요. 마우스를 <b>복사할 자리</b>에 올리면 <code>X</code>, <code>Y</code> 숫자가 떠요. (붙여넣을 자리도 같은 방법으로)</li>
<li><b>순서 만들기</b>: 아래 <b>+ 동작 추가</b>로 하나씩 쌓아요.
  ① 클릭(복사할 X·Y) → ② 단축키 '복사' → ③ 대기 1초 → ④ 단축키 '창 전환' → ⑤ 클릭(붙여넣을 X·Y) → ⑥ 단축키 '붙여넣기'</li>
<li><b>확인</b>: <b>▶ 미리보기</b>로 순서가 맞는지 눈으로 봐요(모의 재생).</li>
<li><b>파일 받기</b>: <b>📦 폴더로 받기</b>를 눌러 zip 을 받아요. 실행 파일·도우미·이미지 폴더가 한 폴더에 다 들어 있어요.</li>
<li><b>실행</b>: zip 을 <b>압축 풀기</b> → 폴더 안 <code>1-run-macro.bat</code> 더블클릭! <b>시작 전 대기</b> 동안 작업할 창을 띄워 두면 돼요.</li>
</ol>
<div class="warn">급할 땐 <b>${CTRL_KEYS.stopLabel}</b>를 누르면 즉시 멈춰요. 여러 번 돌리려면 동작들을 <b>🔁 반복문</b>에 담으세요.</div>

<h4>📱 화면 구성</h4>
<ul>
<li><b>맨 위 칩</b> — 업무 묶음(<b>작업방</b>)이에요. 여러 개 만들어 탭으로 전환해요.</li>
<li><b>작업방 설정</b> — 이름·시작 전 대기·동작 사이 텀·예약 시작·<b>이미지 폴더</b>·<b>변수</b>.</li>
<li><b>동작 순서</b> — 위에서 아래로 차례로 실행돼요. 반복문·조건은 안에 동작을 담는 <b>묶음</b>이에요.</li>
<li><b>옆 화면</b> — 묶음의 <b>⤢ 옆 화면에 크게 열어 보기</b>를 누르면 옆(휴대폰은 전체 화면)에 그 묶음만 크게 열려요. 거기서 넣기·고치기·순서 바꾸기·<b>이 묶음만 미리보기</b>가 돼요. <b>보기 창일 뿐이라 닫아도 지워지지 않아요.</b></li>
<li><b>내보내기</b> — 실제 실행 파일을 받는 곳. <b>불러오기</b>로 받은 파일을 다시 열 수 있어요.</li>
</ul>

<h4>➕ 동작을 추가·정리하는 법</h4>
<ul>
<li><b>추가</b>: 아래 <b>+ 동작 추가</b> → 종류 고르기 → 값 채우기 → <b>저장</b>.</li>
<li><b>묶음 안에 넣기</b>: 반복문·조건 아래 칸의 <b>+ 동작 넣기</b>, 또는 동작 번호(⠿)를 끌어 그 칸에 놓기.</li>
<li><b>별명</b>: 반복문·조건에 "메일 10통", "로그인 확인"처럼 이름을 붙이면 목록·옆 화면·실행 창에 그 이름으로 보여요.</li>
<li><b>수정/복제/삭제</b>: 동작을 탭 → 편집 창(복제 버튼) / 🗑 (바로 뜨는 <b>되돌리기</b>로 복구).</li>
<li>값이 빠지면 <b>빨간 ⚠</b>가 떠요. 그대로 내보내면 엉뚱하게 동작하니 채워 주세요.</li>
</ul>

<h4>🧩 동작 종류</h4>
<ul>
<li><b>🌐 주소 열기</b> · <b>🖱️ 마우스 이동</b> · <b>👆 클릭</b> · <b>✋ 드래그</b> · <b>🖲️ 스크롤</b> · <b>⏱️ 대기</b> — 이름 그대로예요. 좌표는 "좌표 찾기 도우미"로.</li>
<li><b>⌨️ 단축키</b> — 자주 쓰는 것(복사·붙여넣기·창 닫기·탭 닫기·새로고침·실행창 등)은 목록에서 고르고, 없는 건 <b>✏️ 직접 만들기</b>에서 <b>원하는 키 조합을 글로 적어</b> 만들어요: <code>Ctrl+Shift+N</code>, <code>Win+R</code>, <code>Alt, F, X</code>(쉼표 = 차례로). PC에선 "키보드로 눌러 입력"으로 실제로 눌러서 적을 수도 있어요. 페이지·프로그램마다 단축키가 다르면 그에 맞게 적으면 돼요.<br>
  <b>★ 내 단축키</b>: 만든 조합에 이름("결재창 열기" 등)을 붙여 저장하면 목록에 생겨 어느 작업방에서든 골라 써요. 고치면 그걸 쓰는 모든 동작이 같이 바뀌고, 지워도 쓰던 동작은 같은 키로 남아요.<br>예) 실행창 → 글자 입력 <code>notepad</code> → 단축키 Enter = 메모장 열기</li>
<li><b>✏️ 글자 입력</b> — <code>{변수이름}</code>을 넣으면 그 값으로 바뀌어요. 무설치·파이썬은 붙여넣기로 넣어 한글도 그대로 들어가요.</li>
<li><b>🪟 창 활성화</b> — 제목으로 창을 찾아 앞으로 가져와요. 제목은 아래 "F12 소스 분석"으로 뽑을 수 있어요.</li>
<li><b>🖼️ 이미지 찾아 클릭</b> — 찍어 둔 그림을 화면에서 찾아 눌러요(아래 "이미지 찾기").</li>
<li><b>🔤 글자 찾아 클릭</b> — 화면 글자를 읽어(OCR) "확인" 같은 글자를 찾아 눌러요. 글꼴이 달라도 글자만 같으면 돼요. 무설치·파이썬.</li>
<li><b>📋 영역 값 읽어 입력</b> — 영역의 글자/숫자를 읽어 지금 커서 칸에 붙여넣어요(자료수집).</li>
<li><b>📦 변수에 값 저장</b> — 직접 쓴 값 / <b>화면 영역에서 읽은 값</b> / <b>클립보드(복사한 값)</b>를 이름 붙인 변수에 담아요.</li>
<li><b>🔁 반복문</b> — 담은 동작을 N번(0 = 멈출 때까지) 반복.</li>
<li><b>❓ 조건</b> — 화면 글자·숫자 / 변수 값 / 이미지가 보이는지 / 글자가 보이는지를 확인해 <b>맞으면 담은 동작</b>, 아니면 "아니면" 칸 동작을 실행.</li>
<li><b>⏏️ 반복 빠져나가기</b> — 감싼 반복문을 그 자리에서 끝내고 다음으로. <b>🛑 멈춤</b> — 매크로 전체를 끝내요.</li>
</ul>

<h4>📦 변수 — 값에 이름 붙여 쓰기</h4>
<ul>
<li><b>만들기</b>: 작업방 설정의 <b>변수</b>에서 이름·처음 값을 정하거나, 동작 <b>"변수에 값 저장"</b>으로 실행 중에 담아요. 이름은 마음대로(한글 OK).</li>
<li><b>쓰기</b>: 글자 입력·주소·창 제목·찾을 글자·조건 비교값에 <code>{이름}</code>. 예) <code>{고객명}님 안녕하세요</code></li>
<li><b>읽은 값 담기</b>: "변수에 값 저장 → 화면 영역 읽기"로 화면 글자를, "클립보드"로 복사한 값을 담아요. 이미지·글자 찾기의 <b>"결과를 변수에 저장"</b>은 찾으면 1, 못 찾으면 0.</li>
<li><b>인식 오류 알아내기</b>: 화면 글자를 못 읽으면 변수가 <b>빈 값</b>이 되고 실행 창에 [주의]가 떠요. 조건 "변수 값 → <b>비었음</b>"으로 오류일 때 다른 동작(멈춤 등)을 하게 할 수 있어요.</li>
<li><b>폴더에서 바꾸기</b>: 받은 폴더의 <code>variables.txt</code> 에서 <code>이름=값</code>을 고치면 웹에서 다시 받지 않아도 그 값으로 실행돼요.</li>
<li><b>이름이 겹치면?</b> 변수끼리 같은 이름 = 같은 변수예요(설정 목록에 경고 표시). 변수·이미지·반복문 별명은 <b>서로 다른 곳에 저장</b>돼서 이름이 같아도 섞이지 않아요.</li>
</ul>

<h4>🖼️ 이미지 찾기 — 자세히</h4>
<ul>
<li><b>이름·폴더</b>: 동작마다 <b>이미지 이름</b>을 정하면 <code>이미지폴더\\이름.png</code> 를 찾아요. 폴더는 작업방 설정의 <b>이미지 폴더</b>(기본 <code>images</code>, 매크로 폴더 기준. <code>C:\\...</code>처럼 전체 경로도 가능).</li>
<li><b>찍기</b>: 받은 폴더의 <code>2-capture-images.bat</code> 를 실행하면 <b>이 매크로에 필요한 이름을 차례로</b> 물어보며 찍게 해요. 다른 이름도 직접 정해 더 찍을 수 있어요. 바꾸고 싶으면 같은 이름으로 다시 찍거나 png 파일을 바꿔 넣으세요.</li>
<li><b>무엇을 보고 찾나</b>: <b>지금 화면에 보이는 모습</b>(모니터 전체)에서 찾아요. 다른 창에 가려졌거나 스크롤 밖에 있으면 못 찾아요. 필요하면 먼저 "창 활성화"로 앞으로 가져오세요.</li>
<li><b>글자도 되나</b>: 글자를 그림으로 찍으면 <b>그 글꼴·크기·색 그대로일 때만</b> 찾아요. 글자 내용으로 찾으려면 <b>🔤 글자 찾아 클릭</b>(OCR)이 더 튼튼해요.</li>
<li><b>여러 개 있으면</b>: <b>위→아래, 왼쪽→오른쪽</b> 순서로 셉니다. "몇 번째"로 고르고, <b>"지정한 네모 안만"</b>으로 범위를 좁히면 엉뚱한 걸 덜 골라요(더 빨라요).</li>
<li><b>비슷한 것도 찾기</b>: <b>닮은 정도</b>(똑같이 / 거의 / 비슷 / 느슨)와 <b>밝기 차이 무시</b>로 조금 다른 것도 찾아요. 단, <b>내용이 다른 표(값이 바뀌는 엑셀)</b>는 값 부분을 빼고 <b>제목·머리글처럼 안 바뀌는 부분만</b> 찍으세요. <b>사람마다 다르게 찍은 사진</b>(각도·크기·구도가 다름)은 이 방식으로 찾을 수 없어요.</li>
<li><b>못 찾으면</b>: 정한 횟수만큼 다시 찾다가 기본은 <b>일시정지 + [오류] 표시</b>(검은 창이 앞으로 나와요). 화면을 맞춘 뒤 <b>${CTRL_KEYS.pauseLabel}</b> = 다시 찾기, <b>${CTRL_KEYS.startNowLabel}</b> = 이 동작 건너뛰기, <b>${CTRL_KEYS.stopLabel}</b> = 종료. 엉뚱한 곳을 누르는 대신 멈춰서 확인하게 해요.</li>
<li><b>찾으면</b>: 클릭 / 마우스만 이동 / <b>찾기만</b>(나타날 때까지 기다리기). <b>위치 보정</b>으로 찾은 곳 옆(예: 글자 "이메일" 오른쪽 입력칸)을 누를 수 있어요.</li>
<li>찍을 때와 실행할 때의 <b>해상도·배율(100/125/150%)이 같아야</b> 해요.</li>
</ul>

<h4>⏳ 페이지 로딩 기다리기</h4>
<ul>
<li>매크로는 브라우저 속 "로딩 중" 상태를 직접 볼 수 없어요. 대신 <b>로딩이 끝나면 보이는 것</b>을 기다려요.</li>
<li><b>나타날 때까지</b>: 🖼️ 이미지 찾아 클릭(또는 🔤 글자 찾아 클릭)에서 <b>찾으면 → 찾기만</b>, "몇 초마다 × 몇 번"을 최대 대기 시간으로.</li>
<li><b>사라질 때까지(로딩 아이콘)</b>: 🔁 반복문(0) 안에 ❓조건 "이미지 '로딩중'이 <b>안 보이면</b>" → ⏏️ 반복 빠져나가기, 그 아래 ⏱️ 대기 0.5초.</li>
</ul>

<h4>❓ 조건 — 베타</h4>
<ul>
<li><b>무엇을 확인</b>: 화면 영역 글자·숫자(OCR) / 변수 값 / 이미지가 보이는지 / 글자가 보이는지.</li>
<li><b>비교</b>: 숫자(크다·작다·같다…), 글자(포함·같음·다름), <b>비었음</b>(못 읽음 = 인식 오류). 비교값에 <code>{변수}</code>도 돼요. 영역끼리(두 영역 비교)도 돼요.</li>
<li>글자를 못 읽으면 "비었음" 말고는 모두 <b>안 맞음</b>으로 처리해 엉뚱한 동작을 하지 않아요.</li>
<li>화면 글자 읽기가 필요한 조건은 <b>무설치·파이썬</b>에서만 돼요(.ahk 는 변수·이미지 조건만).</li>
</ul>

<h4>⚙️ 작업방 설정</h4>
<ul>
<li><b>시작 전 대기</b> — 더블클릭 후 이 시간 동안 기다려요. <b>동작 사이 텀</b> — 각 동작 사이 간격(기본 0.5초).</li>
<li><b>예약 시작</b> — <b>다음 그 시각</b>까지 기다렸다 시작(이미 지났으면 다음 날). PC가 켜져 있고 파일이 실행 중이어야 해요.</li>
<li><b>이미지 폴더</b>·<b>변수</b> — 위 설명 참고. 반복은 설정이 아니라 <b>🔁 반복문</b>으로 해요.</li>
</ul>

<h4>⌨️ 실행 중 단축키 (모든 파일 공통)</h4>
<ul>
<li><b>${CTRL_KEYS.pauseLabel}</b> — 일시정지 / 다시 재생 (오류로 멈췄을 땐 다시 찾기)</li>
<li><b>${CTRL_KEYS.stopLabel}</b> — 완전 종료 (.ahk 는 Esc 도 종료)</li>
<li><b>${CTRL_KEYS.restartLabel}</b> — 처음부터 다시 실행 (변수도 처음 값으로)</li>
<li><b>${CTRL_KEYS.startNowLabel}</b> — 예약 시간을 기다리지 않고 즉시 시작 / 오류로 멈췄을 땐 그 동작 건너뛰기</li>
<li>파이썬만 <code>pip install keyboard</code> 후에 단축키가 켜져요.</li>
</ul>
<p class="muted small">실행 중 검은 창(cmd)에 <b>▶ 클릭 ...</b>처럼 지금 동작과 [오류]·[주의]를 글자로 보여줘요.</p>

<h4>💾 내보내기 · 불러오기</h4>
<ul>
<li><b>📦 폴더로 받기 (추천)</b> — zip 하나에 <code>1-run-macro.bat</code>(실행) · <code>2-capture-images.bat</code>(이미지 찍기) · <code>3-find-xy.bat</code> · <code>4-pick-region.bat</code> · <code>images</code> 폴더 · <code>variables.txt</code> · <code>macro-design.json</code>(설계도) · README 가 다 들어 있어요. 압축을 풀어 폴더째 쓰세요.</li>
<li><b>무설치(윈도우)</b> / <b>.ahk + .bat</b> / <b>.py</b> — 파일만 따로 받기. 이미지는 그 파일 옆 <code>images</code> 폴더에서 찾아요.</li>
<li><b>불러오기(복원)</b>: 받은 <code>macro-design.json</code> 이나 <b>macro.ps1 / .py / .ahk 파일</b>을 고르거나 내용을 붙여넣으면, 그 매크로가 <b>새 작업방으로 그대로 복원</b>돼요. 파일 끝에 설계도가 함께 들어 있기 때문이에요.</li>
<li><b>주의</b>: 코드 파일을 <b>직접 고친 내용</b>은 복원되지 않아요(설계도만 읽어요). 동작 수정은 <b>여기(웹)</b>에서 하고 다시 받으세요. 이미지·variables.txt 는 폴더에서 바로 바꿔도 돼요.</li>
<li><b>전체 백업 저장 / 불러오기</b> — 모든 작업방을 한 파일로(기기를 바꿀 때).</li>
</ul>

<h4>⚠️ 조심할 점 · 자주 막히는 것</h4>
<ul>
<li>회사 보안 규정을 꼭 확인하세요. <b>내부 시스템 정보는 이 앱에 넣지 않아도 됩니다</b>(넣지 마세요).</li>
<li><b>클릭이 빗나가요</b> → 좌표는 화면 배율(125·150%)과 상관없이 <b>실제 픽셀</b> 기준이에요. 꼭 "좌표 찾기 도우미"로 잰 숫자를 쓰고, 해상도를 바꿨다면 다시 재세요. 위치가 자주 바뀌면 이미지·글자 찾기를 쓰세요.</li>
<li><b>왼쪽·위쪽 모니터</b>는 좌표가 <b>음수</b>(−)예요. 숫자 칸 옆 <b>±</b> 단추로 부호를 바꿔요(휴대폰 숫자 자판엔 − 키가 없어서).</li>
<li><b>F7~F10</b>은 매크로가 도는 동안 <b>매크로 전용</b>이라 엑셀 등 다른 프로그램엔 전달되지 않아요(무설치·.ahk·파이썬). 이미지 파일이 없으면 "안 보임"으로 넘기지 않고 오류로 멈춰 알려줘요.</li>
<li><b>실행이 막혀요</b> → 회사 보안 프로그램이 스크립트를 막은 경우예요(관리자 문의).</li>
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
