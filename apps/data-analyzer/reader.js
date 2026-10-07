/* ================================================================
 * reader.js — 표 읽기 (붙여넣은 글자 / CSV / 엑셀 칸 → 분석용 표)
 * 가로·세로 표 자동 판별, 제목·메모 줄 건너뛰기, 단위 줄 합치기, 시각·날짜 해석.
 * 브라우저: window.Reader / Node: require('./reader.js')
 * ================================================================ */
(function (root) {
'use strict';


function detectDelimiter(lines) {
  const sample = lines.slice(0, 20);
  for (const d of ['\t', ';', ',']) {
    const counts = sample.map(l => splitLine(l, d).length);
    if (counts[0] > 1 && counts.every(c => c === counts[0])) return d;
  }
  for (const d of ['\t', ',', ';']) if (sample.some(l => l.includes(d))) return d;
  return /\s{1,}/;
}

// 따옴표("…")를 지원하는 한 줄 나누기
function splitLine(line, d) {
  if (d instanceof RegExp) return line.trim().split(d);
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && cur.trim() === '') { q = true; cur = ''; }
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseText(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const d = detectDelimiter(lines);
  const rows = lines.map(l => splitLine(l, d));
  const w = Math.max(...rows.map(r => r.length));
  return rows.map(r => { while (r.length < w) r.push(''); return r; });
}

function toNumber(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : NaN;
  if (s == null) return NaN;
  let t = String(s).trim().replace(/−/g, '-');
  if (t === '') return NaN;
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  t = t.replace(/%$/, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return NaN;
  return Number(t);
}

const CLOCK_RE = /^(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(AM|PM|오전|오후)?$/i;
const DATE_RE = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?(?:[ T]+(?:(오전|오후|AM|PM)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/i;

function hour12(h, ap) {
  if (!ap) return h;
  const pm = /오후|pm/i.test(ap);
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}

// 시간 칸 하나를 읽는다 → { kind: 'clock'(초) | 'date'(ms), v } 또는 null
function parseTimeCell(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  let m = t.match(CLOCK_RE);
  if (m) {
    const h = hour12(+m[2], m[1] || m[5]);
    return { kind: 'clock', v: h * 3600 + +m[3] * 60 + (m[4] ? +m[4] : 0) };
  }
  m = t.match(DATE_RE);
  if (m) {
    const h = m[5] ? hour12(+m[5], m[4]) : 0;
    const sec = m[7] ? +m[7] : 0;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], h, m[6] ? +m[6] : 0, Math.floor(sec), Math.round((sec % 1) * 1000));
    return Number.isFinite(ms) ? { kind: 'date', v: ms } : null;
  }
  return null;
}

const nonEmpty = a => a.filter(v => String(v ?? '').trim() !== '');

// 열의 성격: 'time'(시각/날짜) | 'number' | 'text'
function columnKind(values) {
  const ne = nonEmpty(values);
  if (!ne.length) return 'text';
  const num = ne.filter(v => !Number.isNaN(toNumber(v))).length;
  const tm = ne.filter(v => parseTimeCell(v)).length;
  if (tm / ne.length >= 0.8) return 'time';
  if (num / ne.length >= 0.8) return 'number';
  return 'text';
}

function buildTable(rows) {
  if (rows.length < 2) return { error: '줄이 너무 적어요. 이름 한 줄과 값 여러 줄이 필요해요.' };
  const first = rows[0];
  const isHeader = first.some(c => String(c).trim() !== '' && Number.isNaN(toNumber(c)) && !parseTimeCell(c));
  const headers = first.map((c, i) => (isHeader && String(c).trim()) ? String(c).trim() : `항목${i + 1}`);
  // 같은 이름이 있으면 구분
  const seen = {};
  headers.forEach((h, i) => { if (seen[h]) headers[i] = `${h} (${++seen[h]})`; else seen[h] = 1; });
  const body = isHeader ? rows.slice(1) : rows;
  const cols = headers.map((_, i) => body.map(r => r[i] ?? ''));
  const kinds = cols.map(columnKind);
  return { headers, body, cols, kinds, hasHeader: isHeader };
}

/* ---- 표 모양 정리: 빈 칸·제목 줄·가로/세로·단위 줄 ---- */

const isBlank = v => String(v ?? '').trim() === '';
const isValueLike = v => !Number.isNaN(toNumber(v)) || !!parseTimeCell(v);
const transpose = rows => rows[0].map((_, c) => rows.map(r => r[c] ?? ''));
const UNIT_RE = /^[\[(（].*[\])）]$|^(°?[A-Za-zμΩ℃℉%‰/·²³.\-\d]{1,8}|℃|°C|°F|%|ppm|rpm)$/;

function trimEmpty(rows) {
  rows = rows.filter(r => r.some(v => !isBlank(v)));
  if (!rows.length) return { rows, droppedCols: 0 };
  const w = Math.max(...rows.map(r => r.length));
  rows = rows.map(r => Array.from({ length: w }, (_, i) => r[i] ?? ''));
  const keep = [...Array(w).keys()].filter(c => rows.some(r => !isBlank(r[c])));
  return { rows: rows.map(r => keep.map(c => r[c])), droppedCols: w - keep.length };
}

// 표가 시작되는 줄: 위쪽의 제목·설명 줄(칸이 듬성듬성한 줄)은 건너뛴다
function findStart(rows) {
  const cnt = rows.map(r => r.filter(v => !isBlank(v)).length);
  const W = Math.max(...cnt);
  const need = Math.max(2, Math.ceil(W * 0.6));
  const start = Math.max(0, cnt.findIndex(c => c >= need));
  let end = rows.length;
  // 아래쪽 메모 줄 (글자 하나뿐인 줄)
  while (end - 1 > start + 1 && cnt[end - 1] <= 1 && !rows[end - 1].some(isValueLike)) end--;
  return { start, end };
}

// "세로로 읽었을 때" 얼마나 그럴듯한지 점수 (항목 이름이 첫 줄, 값이 아래로)
function layoutScore(rows) {
  if (rows.length < 2 || rows[0].length < 1) return -1;
  const head = rows[0].slice(1).filter(v => !isBlank(v));
  const headText = head.length ? head.filter(v => !isValueLike(v)).length / head.length : 0;
  const body = rows.slice(1);
  const cols = rows[0].map((_, c) => body.map(r => r[c]));
  const valCols = cols.slice(1).filter(col => columnKind(col) !== 'text').length / Math.max(1, cols.length - 1);
  const first = cols[0] || [];
  const k0 = columnKind(first);
  const nums = first.map(toNumber).filter(Number.isFinite);
  const firstTime = k0 === 'time' || (k0 === 'number' && nums.length > 2 && nums.every((v, i) => !i || v > nums[i - 1])) ? 1 : 0;
  const tall = body.length >= rows[0].length - 1 ? 0.5 : 0;
  return headText * 2 + valCols + firstTime + tall;
}

/** 붙여넣은/읽은 칸들을 "첫 줄 = 항목 이름, 첫 칸 = 시간" 모양으로 정리한다
 *  layout: 'auto' | 'cols'(항목이 열) | 'rows'(항목이 행) */
function prepareGrid(raw, layout = 'auto') {
  const notes = [];
  let { rows, droppedCols } = trimEmpty(raw);
  if (!rows.length) return { rows, notes, layout: 'cols' };
  if (droppedCols) notes.push(`빈 열 ${droppedCols}개를 뺐어요`);
  // 제목 줄은 방향과 상관없이 보통 맨 위에 있다
  const { start, end } = findStart(rows);
  if (start > 0) notes.push(`위쪽 제목·설명 ${start}줄을 건너뛰었어요`);
  if (end < rows.length) notes.push(`아래쪽 메모 ${rows.length - end}줄을 뺐어요`);
  rows = trimEmpty(rows.slice(start, end)).rows;
  if (rows.length < 2 || rows[0].length < 2) return { rows, notes, layout: 'cols' };

  let use = layout;
  if (use === 'auto') use = layoutScore(transpose(rows)) > layoutScore(rows) + 0.25 ? 'rows' : 'cols';
  if (use === 'rows') {
    rows = transpose(rows);
    const st = findStart(rows); // 가로 표의 왼쪽 설명 칸
    if (st.start > 0) rows = rows.slice(st.start);
  }

  // 이름 줄 바로 아래가 단위(°C, kW…)나 하위 이름 줄이면 이름에 붙인다
  if (rows.length > 3) {
    const [h, u, next] = rows;
    const cells = u.slice(1).filter(v => !isBlank(v));
    const textish = cells.length > 0 && cells.every(v => !isValueLike(v));
    const nextVals = next.slice(1).filter(v => !isBlank(v));
    const nextOk = nextVals.length > 0 && nextVals.filter(isValueLike).length / nextVals.length >= 0.6;
    const headOk = h.slice(1).some(v => !isBlank(v) && !isValueLike(v));
    if (textish && cells.length >= (u.length - 1) / 2 && nextOk && headOk) {
      let last = '';
      const merged = h.map((name, i) => {
        const nm = isBlank(name) ? last : String(name).trim();
        if (!isBlank(name)) last = nm;
        const sub = String(u[i] ?? '').trim();
        if (!sub) return nm;
        if (!nm) return sub;
        if (nm.includes(sub)) return nm;
        return UNIT_RE.test(sub) && !/^[\[(（]/.test(sub) ? `${nm} (${sub})` : `${nm} ${sub}`;
      });
      rows = [merged, ...rows.slice(2)];
      notes.push('두 번째 줄(단위·하위 이름)을 항목 이름에 붙였어요');
    }
  }
  return { rows, notes, layout: use };
}

const TIME_NAME_RE = /시간|시각|일시|날짜|time|date|경과|^t$|^t\s*\(/i;

function guessTimeCol(tb) {
  const i = tb.kinds.indexOf('time');
  if (i >= 0) return i;
  const byName = tb.headers.findIndex((h, j) => TIME_NAME_RE.test(h) && tb.kinds[j] === 'number');
  if (byName >= 0) return byName;
  if (tb.kinds[0] === 'number') {
    const v = tb.cols[0].map(toNumber).filter(Number.isFinite);
    if (v.length > 2 && v.every((x, k) => k === 0 || x > v[k - 1])) return 0;
  }
  return -1;
}

const UNITS = { s: { label: '초', sec: 1 }, min: { label: '분', sec: 60 }, h: { label: '시간', sec: 3600 }, d: { label: '일', sec: 86400 } };

// 표 + 설정 → 분석용 데이터
function buildDataset(tb, cfg) {
  const n = tb.body.length;
  let t = new Array(n).fill(NaN);
  let tLabel, tSym = 't', unit = null, kind = 'index';
  const tc = cfg.timeCol;
  if (tc < 0) {
    t = t.map((_, i) => i + 1);
    tLabel = '측정 순서(번째)';
  } else if (tb.kinds[tc] === 'time') {
    kind = 'time';
    const parsed = tb.cols[tc].map(parseTimeCell);
    // 시각(HH:MM)은 자정을 넘기면 하루를 더한다
    let dayAdd = 0, prev = null;
    const sec = parsed.map(p => {
      if (!p) return NaN;
      if (p.kind === 'date') return p.v / 1000;
      if (prev != null && p.v + dayAdd * 86400 < prev - 43200) dayAdd++;
      const s = p.v + dayAdd * 86400; prev = s; return s;
    });
    const fin = sec.filter(Number.isFinite);
    const t0 = Math.min(...fin), span = Math.max(...fin) - t0;
    unit = cfg.unit !== 'auto' ? cfg.unit : span <= 180 ? 's' : span <= 3 * 3600 ? 'min' : span <= 3 * 86400 ? 'h' : 'd';
    t = sec.map(s => (s - t0) / UNITS[unit].sec);
    tLabel = `경과 시간(${UNITS[unit].label})`;
  } else {
    kind = 'number';
    t = tb.cols[tc].map(toNumber);
    tLabel = tb.headers[tc];
  }
  const vars = cfg.vars.map(j => ({ name: tb.headers[j], col: j, values: tb.cols[j].map(toNumber) }));
  // 시간 순으로 정렬 (시간이 빈 줄은 뺀다)
  const idx = [...Array(n).keys()].filter(i => Number.isFinite(t[i])).sort((a, b) => t[a] - t[b]);
  return {
    kind, unit, tLabel, tSym,
    timeHeader: tc >= 0 ? tb.headers[tc] : null,
    tRaw: idx.map(i => tc >= 0 ? tb.cols[tc][i] : i + 1),
    t: idx.map(i => t[i]),
    vars: vars.map(v => ({ ...v, values: idx.map(i => v.values[i]) })),
    dropped: n - idx.length,
  };
}

const Reader = { parseText, toNumber, parseTimeCell, columnKind, buildTable, guessTimeCol, buildDataset, prepareGrid, transpose, UNITS, TIME_NAME_RE };
if (typeof module !== 'undefined' && module.exports) module.exports = Reader;
else root.Reader = Reader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
