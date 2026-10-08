/* ================================================================
 * reader.js — 표 읽기 (붙여넣은 글자 / CSV / 엑셀 칸 → 분석용 표)
 *
 * - 따옴표 안 줄바꿈까지 처리하는 CSV 읽기, 구분자 자동 판별, 소수점 쉼표(1,5)
 * - 계측 시스템의 불량 표시(Bad, I/O Timeout, #N/A, - …)는 빈 값으로
 * - 칸 안 단위(12.3℃, 45 kW), 괄호 음수 (12.5)
 * - 시각: 2026-10-07 09:00, 2026/10/07, 2026년 10월 7일, 20261007093000, ISO(Z/+09:00),
 *         07-Oct-26 09:00, 10/07/2026, 오전/오후·AM/PM, 엑셀 일련번호, 유닉스 시간
 * - 일자 칸 + 시각 칸 합치기, 자정 넘김·최신→과거 순서, 태그마다 다른 시각 칸
 * - 제목·설명 줄, 합계·평균 줄, 단위 줄·2단 머리글, 가로/세로 표 판별
 * 브라우저: window.Reader / Node: require('./reader.js')
 * ================================================================ */
(function (root) {
'use strict';

/* ---------- 작은 도구 (큰 배열에서 Math.max(...a)는 터지므로 반복문으로) ---------- */
function maxOf(a) { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; }
function minOf(a) { let m = Infinity; for (const v of a) if (v < m) m = v; return m; }
const isBlank = v => v == null || String(v).trim() === '';
function median(a) { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// 계측 시스템이 값 대신 남기는 글자 → 빈 값으로 본다
const BAD_RE = /^(bad|bad input|bad data|bad quality|i\/o timeout|#?n\/a|n\.a\.?|nan|null|none|-+|—|–|\?+|calc ?failed|shutdown|no data|no sample|pt created|over ?range|under ?range|comm ?fail(ure)?|configure|scan ?off|invalid( data)?|error|err|#value!|#div\/0!|#ref!|#name\?|#num!|#null!|\[-?\d+\].*|offline|미수신|통신 ?(불량|이상|두절)|결측|없음|정지중)$/i;
const isBad = v => !isBlank(v) && BAD_RE.test(String(v).trim());

// 합계·평균 같은 요약 줄
const SUMMARY_RE = /^(합계|소계|총계|총합|평균|최대|최소|최댓값|최솟값|표준편차|계|total|sum|subtotal|grand total|avg|average|mean|max|min|std|stdev)\.?$/i;

/* ---------- 1. 글자 → 칸 ---------- */

// 따옴표를 지원하는 레코드 나누기 (따옴표 안 줄바꿈은 칸의 일부 → 공백으로)
function splitRecords(text, d, quotes = true) {
  const rows = []; let row = []; let cur = ''; let q = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c === '\n' ? ' ' : c;
      continue;
    }
    if (quotes && c === '"' && cur.trim() === '') { q = true; cur = ''; continue; }
    if (c === d) { row.push(cur.trim()); cur = ''; continue; }
    if (c === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; continue; }
    cur += c;
  }
  if (q && quotes) return splitRecords(text, d, false); // 닫히지 않은 따옴표: 따옴표를 글자로 본다
  row.push(cur.trim()); rows.push(row);
  return rows;
}

function modal(counts) {
  const f = new Map();
  counts.forEach(c => f.set(c, (f.get(c) || 0) + 1));
  let best = 0, bc = 0;
  for (const [c, k] of f) if (k > bc || (k === bc && c > best)) { best = c; bc = k; }
  return best;
}

// 구분자 고르기: 가장 많은 줄이 같은 칸 수로 나뉘는 것 (같으면 탭 > ; > , > |)
function detectDelimiter(sample) {
  let best = null;
  for (const d of ['\t', ';', ',', '|']) {
    const recs = splitRecords(sample, d).filter(r => r.some(c => c !== ''));
    if (!recs.length) continue;
    const counts = recs.map(r => r.length);
    const m = modal(counts.filter(c => c > 1));
    if (m < 2) continue;
    const score = counts.filter(c => c === m).length / recs.length;
    if (!best || score > best.score + 0.02) best = { d, score, m };
  }
  return best ? best.d : null;
}

const DEC_COMMA = /^[-+]?\d+,\d+$/;
const DEC_COMMA_THOU = /^[-+]?\d{1,3}(\.\d{3})+,\d+$/;
const DEC_DOT = /^[-+]?\d*\.\d+$/;

/** 붙여넣은 글자 → 2차원 배열. rows.meta = { delimiter, decimalComma, notes } */
function parseText(text) {
  text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const notes = [];
  if (!text.trim()) { const r = []; r.meta = { notes }; return r; }
  let sample = text.slice(0, 65536);
  if (text.length > sample.length) sample = sample.slice(0, sample.lastIndexOf('\n') + 1 || sample.length);
  const d = detectDelimiter(sample);
  let rows;
  if (d) rows = splitRecords(text, d).filter(r => r.some(c => c !== ''));
  else {
    // 공백으로 나뉜 표: 두 칸 이상 공백이 있으면 그것으로, 아니면 모든 공백으로
    const lines = text.split('\n').filter(l => l.trim() !== '');
    const two = lines.map(l => l.trim().split(/\s{2,}|\t/));
    const m2 = modal(two.map(r => r.length));
    const ok2 = m2 > 1 && two.filter(r => r.length === m2).length / two.length >= 0.8;
    rows = ok2 ? two : lines.map(l => l.trim().split(/\s+/));
    if (!ok2 && rows.length > 1) {
      // 이름 줄의 칸 수가 값 칸 수와 다르면 (이름에 공백이 있음) 이름을 믿을 수 없다
      const w = modal(rows.slice(1).map(r => r.length));
      const head = rows[0];
      const headText = head.filter(c => isNaN(toNumber(c)) && !parseTimeCell(c) && !isBad(c)).length;
      if (headText && head.length !== w) {
        notes.push(`이름 줄(${head.join(' ')})의 칸 수(${head.length})가 값 칸 수(${w})와 달라서 이름을 쓰지 않았어요. 엑셀에서 그대로 복사하거나 탭·쉼표로 나눠 붙여넣어 주세요`);
        rows = rows.slice(1);
      }
    }
  }
  // 소수점 쉼표(1,5): 세미콜론 표이거나, 쉼표 뒤 숫자가 3자리가 아닌 칸이 있고 점 소수가 없을 때
  let comma = 0, commaNot3 = 0, dot = 0;
  for (const r of rows) for (const c of r) {
    if (DEC_COMMA.test(c) || DEC_COMMA_THOU.test(c)) { comma++; if (!/,\d{3}$/.test(c)) commaNot3++; }
    else if (DEC_DOT.test(c)) dot++;
  }
  const decimalComma = d !== ',' && comma >= 2 && ((d === ';' && dot === 0) || (commaNot3 > 0 && dot === 0));
  if (decimalComma) {
    for (const r of rows) for (let i = 0; i < r.length; i++) {
      const c = r[i];
      if (DEC_COMMA.test(c)) r[i] = c.replace(',', '.');
      else if (DEC_COMMA_THOU.test(c)) r[i] = c.replace(/\./g, '').replace(',', '.');
    }
    notes.push('쉼표(,)를 소수점으로 읽었어요 (예: 4,95 → 4.95)');
  }
  let w = 0; for (const r of rows) if (r.length > w) w = r.length;
  rows.forEach(r => { while (r.length < w) r.push(''); });
  rows.meta = { delimiter: d || 'space', decimalComma, notes };
  return rows;
}

/* ---------- 2. 숫자 ---------- */
const NUM_RE = /^[-+]?((\d{1,3}(,\d{3})+|\d{1,3}( \d{3})+|\d+)(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const UNIT_TOKEN = /^(%|‰|℃|℉|°[CF]?|㎥|㎏|㎾|mmH2O|mmAq|[A-Za-zμΩ°]{1,6}[23³²]?(\/[A-Za-z]{1,4}[23³²]?)?)$/;

/** 숫자 읽기 → { v, unit }. '12.3℃' → 12.3 / '℃', '(12.5)' → -12.5, '1,234' → 1234 */
function parseNum(s) {
  if (typeof s === 'number') return { v: Number.isFinite(s) ? s : NaN, unit: '' };
  if (s == null) return { v: NaN, unit: '' };
  let t = String(s).trim().replace(/[−–]/g, '-').replace(/ /g, ' ');
  if (!t || isBad(t)) return { v: NaN, unit: '' };
  let neg = false;
  const p = t.match(/^\((.+)\)$/);
  if (p) { neg = true; t = p[1].trim(); }
  const m = t.match(/^([-+]?[\d][\d,. ]*(?:[eE][-+]?\d+)?|[-+]?\.\d+(?:[eE][-+]?\d+)?)\s*(.*)$/);
  if (!m) return { v: NaN, unit: '' };
  let num = m[1].trim(), unit = m[2].trim();
  if (unit && (!UNIT_TOKEN.test(unit) || /^[eEx]/.test(unit) && !/^(ea|EA)$/.test(unit))) return { v: NaN, unit: '' };
  if (!NUM_RE.test(num) || !/\d/.test(num)) return { v: NaN, unit: '' };
  let v = Number(num.replace(/[, ]/g, ''));
  if (!Number.isFinite(v)) return { v: NaN, unit: '' };
  if (neg) { if (v < 0) return { v: NaN, unit: '' }; v = -v; }
  return { v, unit };
}
function toNumber(s) { return parseNum(s).v; }

/* ---------- 3. 시각 ---------- */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const AP = '(오전|오후|AM|PM|A\\.M\\.|P\\.M\\.)';
const TIME_PART = `(?:${AP}\\s*)?(\\d{1,2})(?::|시\\s*)(\\d{1,2})분?(?:(?::|\\s*)(\\d{1,2}(?:\\.\\d+)?)초?)?\\s*${AP}?`;
const CLOCK_RE = new RegExp(`^${TIME_PART}$`, 'i');
const YMD_RE = new RegExp(`^(\\d{4})\\s*[-./년]\\s*(\\d{1,2})\\s*[-./월]\\s*(\\d{1,2})\\s*일?\\.?(?:(?:\\s*\\([^)]*\\))?(?:[ T]+|\\s*)${TIME_PART})?\\s*(Z|[+-]\\d{2}:?\\d{2}|UTC|GMT|KST|JST)?$`, 'i');
const MONFIRST_RE = new RegExp(`^([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?:[ ,T]+${TIME_PART})?$`, 'i');
const NUMDATE_RE = new RegExp(`^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})(?:[ T]+${TIME_PART})?$`, 'i');
const NAMEDATE_RE = new RegExp(`^(\\d{1,2})[- ]([A-Za-z]{3,9})[- ,]+(\\d{2}|\\d{4})(?:[ T:]+${TIME_PART})?$`, 'i');
const COMPACT_RE = /^(\d{4})(\d{2})(\d{2})[ T]?(\d{2})(\d{2})(\d{2})?(?:\.(\d{1,3}))?$/;

function hour12(h, ap) {
  if (!ap) return h;
  const pm = /오후|p/i.test(ap);
  if (h > 12) return NaN;
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function validDate(y, mo, d) { return y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo); }
function clockSec(h, mi, s, ap1, ap2) {
  h = hour12(+h, ap1 || ap2);
  mi = +mi; s = s ? +s : 0;
  if (!(h >= 0 && h <= 24 && mi < 60 && s < 60) || (h === 24 && (mi || s))) return NaN;
  return h * 3600 + mi * 60 + s;
}
function dateMs(y, mo, d, sec, tz) {
  if (!validDate(y, mo, d) || !Number.isFinite(sec)) return null;
  let ms = Date.UTC(y, mo - 1, d) + Math.round(sec * 1000);
  if (tz && !/^(Z|UTC|GMT)$/i.test(tz)) {
    if (/^KST$/i.test(tz) || /^JST$/i.test(tz)) tz = '+09:00';
    const m = tz.match(/([+-])(\d{2}):?(\d{2})/);
    ms -= (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000;
  }
  return ms;
}

/** 시각 칸 하나 → { kind: 'clock'(초) | 'date'(ms), v, dateOnly? } 또는 null
 *  order: 01/02/2026 같은 날짜를 'mdy'(월/일) 또는 'dmy'(일/월)로. 없으면 둘 중 맞는 것 */
function parseTimeCell(s, order) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t || t.length > 40) return null;
  if (/^[-+]?\d*\.?\d+$/.test(t) && t.length !== 12 && t.length !== 14) return null;
  let m = t.match(CLOCK_RE);
  if (m) { const v = clockSec(m[2], m[3], m[4], m[1], m[5]); return Number.isFinite(v) ? { kind: 'clock', v } : null; }
  m = t.match(YMD_RE);
  if (m) {
    const hasTime = m[5] != null;
    const sec = hasTime ? clockSec(m[5], m[6], m[7], m[4], m[8]) : 0;
    const v = dateMs(+m[1], +m[2], +m[3], sec, m[9]);
    return v == null ? null : { kind: 'date', v, dateOnly: !hasTime };
  }
  m = t.match(COMPACT_RE);
  if (m) {
    const sec = clockSec(m[4], m[5], m[6] ? `${m[6]}${m[7] ? '.' + m[7] : ''}` : 0);
    const v = dateMs(+m[1], +m[2], +m[3], sec);
    return v == null ? null : { kind: 'date', v };
  }
  m = t.match(NAMEDATE_RE);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mo) return null;
    let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
    const hasTime = m[5] != null;
    const v = dateMs(y, mo, +m[1], hasTime ? clockSec(m[5], m[6], m[7], m[4], m[8]) : 0);
    return v == null ? null : { kind: 'date', v, dateOnly: !hasTime };
  }
  m = t.match(MONFIRST_RE);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!mo) return null;
    const hasTime = m[5] != null;
    const v = dateMs(+m[3], mo, +m[2], hasTime ? clockSec(m[5], m[6], m[7], m[4], m[8]) : 0);
    return v == null ? null : { kind: 'date', v, dateOnly: !hasTime };
  }
  m = t.match(NUMDATE_RE);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    const hasTime = m[5] != null;
    const sec = hasTime ? clockSec(m[5], m[6], m[7], m[4], m[8]) : 0;
    const tryOrder = o => (o === 'dmy' ? dateMs(y, b, a, sec) : dateMs(y, a, b, sec));
    // 순서를 모르면: 점(07.10.2026)은 유럽식 일.월, 빗금(10/07/2026)은 미국식 월/일을 먼저
    const pref = t[m[1].length] === '.' ? ['dmy', 'mdy'] : ['mdy', 'dmy'];
    const v = order ? tryOrder(order) : (tryOrder(pref[0]) ?? tryOrder(pref[1]));
    return v == null ? null : { kind: 'date', v, dateOnly: !hasTime };
  }
  return null;
}

// 01/02/2026 꼴 날짜의 순서를 칸 전체에서 정한다
function dateOrder(values) {
  let mdy = false, dmy = false;
  for (const s of values) {
    const m = String(s ?? '').trim().match(NUMDATE_RE);
    if (!m) continue;
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  }
  return dmy && !mdy ? 'dmy' : mdy && !dmy ? 'mdy' : undefined;
}

/** 시각 칸 전체 → 초 배열. 시각만 있는 칸(HH:MM)은 자정 넘김·최신→과거 순서를 풀어서 이어 붙인다 */
function timeSeconds(values) {
  const order = dateOrder(values);
  const parsed = values.map(v => parseTimeCell(v, order));
  const notes = [];
  const sec = new Array(values.length).fill(NaN);
  const clockIdx = [];
  parsed.forEach((p, i) => { if (!p) return; if (p.kind === 'date') sec[i] = p.v / 1000; else clockIdx.push(i); });
  if (clockIdx.length) {
    const v = clockIdx.map(i => parsed[i].v);
    let up = 0, down = 0; const steps = [];
    for (let k = 1; k < v.length; k++) {
      let d = v[k] - v[k - 1];
      if (d < -43200) d += 86400; else if (d > 43200) d -= 86400;
      if (d > 0) up++; else if (d < 0) down++;
      if (d) steps.push(Math.abs(d));
    }
    const med = median(steps) || 60;
    // 진행 방향과 반대로 보통 간격의 2배 넘게 뛰면 날짜가 바뀐 것으로 본다
    const tol = Math.min(43200, Math.max(1800, 2 * med));
    const out = new Array(v.length);
    let rolls = 0;
    if (up >= 3 * down || down >= 3 * up) {
      const dir = down > up ? -1 : 1;
      if (dir < 0) notes.push('시각이 최신 → 과거 순서라서 거꾸로 이어 붙였어요');
      const against = dir > 0 ? down : up;
      if (against) notes.push(`시각 순서가 거꾸로 된 곳 ${against}곳이 있어서 시각 순으로 정렬했어요`);
      out[0] = v[0];
      let day = 0;
      for (let k = 1; k < v.length; k++) {
        let s = v[k] + day;
        while (dir * (s - out[k - 1]) < -tol) { s += dir * 86400; day += dir * 86400; rolls++; }
        while (dir * (s - out[k - 1]) > 86400 - tol) { s -= dir * 86400; day -= dir * 86400; }
        out[k] = s;
      }
    } else {
      // 순서가 섞여 있으면: 바로 앞 시각과 가장 가까운 날로
      out[0] = v[0];
      for (let k = 1; k < v.length; k++) {
        let s = v[k];
        while (s - out[k - 1] > 43200) s -= 86400;
        while (s - out[k - 1] < -43200) s += 86400;
        if (Math.floor(s / 86400) !== Math.floor(out[k - 1] / 86400)) rolls++;
        out[k] = s;
      }
      if (down) notes.push('시각 순서가 섞여 있어서 시각 순으로 정렬했어요');
    }
    if (rolls) notes.push(`자정을 넘긴 곳 ${rolls}곳은 날짜를 바꿔 이어 붙였어요`);
    const base = minOf(out) < 0 ? Math.ceil(-minOf(out) / 86400) * 86400 : 0;
    clockIdx.forEach((i, k) => { sec[i] = out[k] + base; });
  }
  const kinds = new Set(parsed.filter(Boolean).map(p => p.kind));
  if (kinds.size > 1) notes.push('날짜가 있는 시각과 없는 시각이 섞여 있어요. 시각 칸을 확인해주세요');
  return { sec, order, notes, kind: kinds.size === 1 ? [...kinds][0] : kinds.size ? 'mixed' : null };
}

/* ---------- 4. 칸 성격 ---------- */
// 'time'(시각/날짜) | 'number' | 'text'. 불량 표시는 빈 값으로 본다
function columnKind(values) {
  let ne = 0, num = 0, tm = 0;
  for (const v of values) {
    if (isBlank(v) || isBad(v)) continue;
    ne++;
    if (parseTimeCell(v)) tm++;
    else if (!Number.isNaN(toNumber(v))) num++;
  }
  if (!ne) return 'text';
  if (tm / ne >= 0.8) return 'time';
  if ((num + tm) / ne >= 0.8 && num) return 'number';
  return 'text';
}
const isValueLike = v => !Number.isNaN(toNumber(v)) || !!parseTimeCell(v);

// 시간 칸 이름 (앞에 붙은 것만: '시간당 유량', '처리시간', 'tap-to-tap time'은 아님)
const TIME_NAME_RE = /^(시각|시간|일시|날짜|일자|측정\s*시각|측정\s*일시|기록\s*시각|발생\s*시각|경과\s*시간|경과|time\s*stamp|timestamp|date\s*time|datetime|date|time|elapsed|t)(\s*[(\[_].*)?$/i;
const TIME_NAME_BAD = /당|\/\s*h|율|rate|per\b|tap|처리|가동|체류|소요|운전\s*시간|duration|간격|interval/i;
const isTimeName = h => TIME_NAME_RE.test(String(h || '').trim()) && !TIME_NAME_BAD.test(String(h || ''));

function fmtStamp(ms) {
  const d = new Date(ms), p = (n, k = 2) => String(n).padStart(k, '0');
  const msPart = d.getUTCMilliseconds() ? `.${p(d.getUTCMilliseconds(), 3)}` : '';
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${msPart}`;
}

function quality(values) {
  let blank = 0, bad = 0, text = 0; const ex = new Map();
  for (const v of values) {
    if (isBlank(v)) { blank++; continue; }
    if (isBad(v)) { bad++; const k = String(v).trim(); ex.set(k, (ex.get(k) || 0) + 1); continue; }
    if (Number.isNaN(toNumber(v)) && !parseTimeCell(v)) { text++; const k = String(v).trim(); ex.set(k, (ex.get(k) || 0) + 1); }
  }
  return { n: values.length, blank, bad, text, examples: [...ex.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]) };
}

/* ---------- 5. 표 만들기 ---------- */
function buildTable(rows) {
  if (rows.length < 2) return { error: '줄이 너무 적어요. 이름 한 줄과 값 여러 줄이 필요해요.' };
  const notes = [];
  const first = rows[0];
  const nb = first.filter(c => !isBlank(c)).length;
  const textCnt = first.filter(c => !isBlank(c) && !isBad(c) && !isValueLike(c)).length;
  const col0Body = rows.slice(1).map(r => r[0]);
  const firstText = !isBlank(first[0]) && !isBad(first[0]) && !isValueLike(first[0]);
  const isHeader = textCnt > 0 && (textCnt >= nb * 0.5 || (firstText && columnKind(col0Body) !== 'text'));
  let headers = first.map((c, i) => (isHeader && !isBlank(c) ? String(c).trim() : `항목${i + 1}`));
  const body = isHeader ? rows.slice(1) : rows;
  let cols = headers.map((_, i) => body.map(r => r[i] ?? ''));
  let kinds = cols.map(columnKind);

  // 칸 안에 같은 단위가 붙어 있으면 이름으로 옮긴다 (12.3℃ → 이름 '온도 (℃)')
  kinds.forEach((k, j) => {
    if (k !== 'number') return;
    const units = new Map(); let n = 0;
    for (const v of cols[j]) { const p = parseNum(v); if (Number.isFinite(p.v)) { n++; if (p.unit) units.set(p.unit, (units.get(p.unit) || 0) + 1); } }
    const top = [...units.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= n * 0.5 && !headers[j].includes(top[0])) headers[j] = `${headers[j]} (${top[0]})`;
  });

  // 숫자로 된 시간 칸: 엑셀 일련번호(날짜)·유닉스 시간이면 시각으로 바꾼다
  kinds.forEach((k, j) => {
    if (k !== 'number' || !(isTimeName(headers[j]) || /date|time|시각|일시|날짜|일자|timestamp/i.test(headers[j]))) return;
    const v = cols[j].map(toNumber).filter(Number.isFinite);
    if (v.length < 2) return;
    let inc = 0; for (let i = 1; i < v.length; i++) if (v[i] >= v[i - 1]) inc++;
    if (inc < (v.length - 1) * 0.9) return;
    const lo = minOf(v), hi = maxOf(v);
    let conv = null, label = '';
    if (lo >= 20000 && hi <= 80000 && v.some(x => x % 1)) { conv = x => Math.round((x - 25569) * 86400000); label = '엑셀 날짜 숫자'; }
    else if (lo >= 9e8 && hi <= 2.2e9) { conv = x => x * 1000; label = '유닉스 시간(초)'; }
    else if (lo >= 9e11 && hi <= 2.2e12) { conv = x => x; label = '유닉스 시간(밀리초)'; }
    if (!conv) return;
    cols[j] = cols[j].map(c => { const x = toNumber(c); return Number.isFinite(x) ? fmtStamp(conv(x)) : c; });
    kinds[j] = 'time';
    notes.push(`'${headers[j]}' 칸의 ${label}를 시각으로 바꿨어요`);
  });

  // 일자 칸 + 시각 칸 → 하나의 시각
  const tIdx = kinds.map((k, j) => (k === 'time' ? j : -1)).filter(j => j >= 0);
  const parsedT = new Map(tIdx.map(j => [j, cols[j].map(c => parseTimeCell(c))]));
  // 날짜만 있는 칸: 시각이 모두 자정이고 같은 날짜가 여러 줄 반복된다
  const dateOnlyCol = tIdx.find(j => {
    const ps = parsedT.get(j).filter(Boolean);
    if (!ps.length || !ps.every(p => p.kind === 'date')) return false;
    if (ps.every(p => p.dateOnly)) return true;
    return ps.every(p => p.v % 86400000 === 0) && new Set(ps.map(p => p.v)).size <= ps.length / 2;
  });
  const clockCol = tIdx.find(j => j !== dateOnlyCol && parsedT.get(j).every(p => !p || p.kind === 'clock'));
  const drop = new Set();
  if (dateOnlyCol != null && clockCol != null) {
    const dp = parsedT.get(dateOnlyCol), cp = parsedT.get(clockCol);
    cols[dateOnlyCol] = cols[dateOnlyCol].map((c, i) => (dp[i] && cp[i] ? fmtStamp(dp[i].v + cp[i].v * 1000) : ''));
    notes.push(`'${headers[dateOnlyCol]}'(날짜)와 '${headers[clockCol]}'(시각) 칸을 합쳐 시각으로 썼어요`);
    headers[dateOnlyCol] = `${headers[dateOnlyCol]} ${headers[clockCol]}`;
    drop.add(clockCol);
  }
  if (drop.size) {
    const keep = headers.map((_, j) => j).filter(j => !drop.has(j));
    headers = keep.map(j => headers[j]); cols = keep.map(j => cols[j]); kinds = keep.map(j => kinds[j]);
  }

  // 시각처럼 생긴 칸인데 시각으로 읽지 못한 칸 알림
  kinds.forEach((k, j) => {
    if (k !== 'text') return;
    const ps = cols[j].filter(c => !isBlank(c) && !isBad(c));
    const ok = ps.filter(c => parseTimeCell(c)).length;
    if (isTimeName(headers[j]) || (ps.length && ok >= ps.length * 0.5)) {
      const badEx = ps.filter(c => !parseTimeCell(c)).slice(0, 2);
      notes.push(`'${headers[j]}' 칸을 시각으로 읽지 못했어요${badEx.length ? ` (예: ${badEx.join(', ')})` : ''}. 시각 칸이 맞다면 형식을 확인해주세요`);
    }
  });

  // 이름 중복 없애기
  const used = new Set();
  headers = headers.map(h => { let nm = h, k = 2; while (used.has(nm)) nm = `${h} (${k++})`; used.add(nm); return nm; });

  // 값마다 시각 칸이 따로 있는 표(태그별 시각 쌍): 각 값 칸이 쓰는 시각 칸
  const timeCols = kinds.map((k, j) => (k === 'time' ? j : -1)).filter(j => j >= 0);
  const timeOf = headers.map((_, j) => { let t = -1; for (const c of timeCols) if (c <= j) t = c; return t >= 0 ? t : (timeCols[0] ?? -1); });
  const pairs = timeCols.length > 1 && timeCols.some(c => cols[c].join('\u0001') !== cols[timeCols[0]].join('\u0001'));

  const outBody = body.map((_, i) => cols.map(c => c[i]));
  return { headers, body: outBody, cols, kinds, hasHeader: isHeader, notes, timeOf, pairs, quality: cols.map(quality) };
}

/* ---------- 6. 표 모양 정리: 빈 칸·제목 줄·합계 줄·단위 줄·가로/세로 ---------- */
const transpose = rows => rows[0].map((_, c) => rows.map(r => r[c] ?? ''));
// 단위처럼 보이는 글자 (이름 아래 줄이 단위면 '이름 (단위)'로 합친다)
const UNIT_RE = /^[\[(（].*[\])）]$|^(%|‰|℃|℉|°[CF]?|ppm|ppb|rpm|㎥|㎏|㎾|[kKMGmμ]?(W|Wh|V|A|Pa|PaG|bar|barg|g|t|m|L|l|J|Hz|cal)|N?m[3³](\/[a-z]+)?|kg(\/[a-z]+)?|t\/h|mmAq|mmH2O|mm|cm|km|s|sec|min|h|hr|kA|MW|kW|MWh|kWh|ton|ea|EA|개|회|톤)$/i;

function dropBlankCols(rows) {
  if (!rows.length) return { rows, dropped: 0 };
  let w = 0; for (const r of rows) if (r.length > w) w = r.length;
  const keep = []; for (let c = 0; c < w; c++) if (rows.some(r => !isBlank(r[c]))) keep.push(c);
  return { rows: rows.map(r => keep.map(c => r[c] ?? '')), dropped: w - keep.length };
}

function rowInfo(r) {
  let nb = 0, val = 0, text = 0;
  for (const c of r) {
    if (isBlank(c)) continue;
    nb++;
    if (isBad(c) || isValueLike(c)) val++; else text++;
  }
  return { nb, val, text, data: nb >= 1 && val / nb >= 0.5, textish: text >= 1 && text >= nb * 0.5 };
}

// 가장 긴 "값 줄" 덩어리 = 표 본문. 그 바로 위의 글자 줄(1~2줄) = 이름 줄
function findBlock(rows) {
  // 큰 표는 앞 500줄·뒤 200줄만 자세히 보고, 가운데는 값 줄로 본다
  const big = rows.length > 1200;
  const info = rows.map((r, i) => (!big || i < 500 || i >= rows.length - 200 ? rowInfo(r) : null));
  if (big) {
    const proto = { nb: 0, val: 0, text: 0, data: true, textish: false };
    for (let i = 500; i < rows.length - 200; i++) { let nb = 0; for (const c of rows[i]) if (!isBlank(c)) nb++; info[i] = { ...proto, nb, val: nb, data: nb > 0 }; }
  }
  const idx = info.map((x, i) => (x.nb ? i : -1)).filter(i => i >= 0);
  const minNb = Math.min(2, maxOf(info.map(x => x.nb)));
  let best = null, cur = null;
  for (const i of idx) {
    if (info[i].data && info[i].nb >= minNb) {
      if (!cur) cur = { s: i, e: i, n: 0 };
      cur.e = i; cur.n++;
    } else { if (cur && (!best || cur.n > best.n)) best = cur; cur = null; }
  }
  if (cur && (!best || cur.n > best.n)) best = cur;
  if (!best) return null;
  // 이름 줄: 본문 바로 위의 글자 줄
  const prevNonBlank = i => { for (let k = i - 1; k >= 0; k--) if (info[k].nb) return k; return -1; };
  const h1 = prevNonBlank(best.s);
  let header = [];
  if (h1 >= 0 && info[h1].textish && info[h1].nb >= Math.min(2, info[best.s].nb)) {
    header = [h1];
    const h2 = h1 - 1; // 2단 머리글은 바로 붙어 있어야 한다
    if (h2 >= 0 && info[h2].nb && info[h2].val === 0 && info[h2].text >= 1) {
      const alignedCells = rows[h2].every((c, j) => isBlank(c) || !isBlank(rows[h1][j]) || j === 0);
      if (alignedCells && info[h2].nb >= 2) header = [h2, h1];
    }
  }
  return { start: header.length ? header[0] : best.s, header, body: [best.s, best.e] };
}

// 세로로 읽었을 때 그럴듯한 정도 (이름이 첫 줄, 값이 아래로, 칸마다 크기가 비슷)
function layoutScore(rows) {
  if (rows.length < 2 || rows[0].length < 1) return -1;
  if (rows.length > 300 || rows[0].length > 300) rows = rows.slice(0, 300).map(r => r.slice(0, 300));
  const head = rows[0].slice(1).filter(v => !isBlank(v));
  const headText = head.length ? head.filter(v => !isValueLike(v)).length / head.length : 0;
  const body = rows.slice(1);
  const cols = rows[0].map((_, c) => body.map(r => r[c]));
  const valCols = cols.slice(1).filter(col => columnKind(col) !== 'text').length / Math.max(1, cols.length - 1);
  const first = cols[0] || [];
  const k0 = columnKind(first);
  const nums = first.map(toNumber).filter(Number.isFinite);
  let inc = true; for (let i = 1; i < nums.length; i++) if (!(nums[i] > nums[i - 1])) { inc = false; break; }
  const firstTime = k0 === 'time' || (k0 === 'number' && nums.length > 2 && inc) ? 1 : 0;
  const tall = body.length >= rows[0].length - 1 ? 0.5 : 0;
  // 한 칸 안에 크기가 전혀 다른 값(온도 1650과 무게 250)이 섞이면 잘못 읽은 방향
  const spreads = cols.slice(1).map(col => {
    const v = col.map(toNumber).filter(x => Number.isFinite(x) && x !== 0).map(Math.abs).sort((a, b) => a - b);
    return v.length >= 3 ? Math.log10(v[Math.floor(v.length * 0.9)] / v[Math.floor(v.length * 0.1)]) : 0;
  });
  const het = Math.min(2, median(spreads) || 0) / 2;
  return headText * 2 + valCols + firstTime + tall - het;
}

/** 붙여넣은/읽은 칸들을 "첫 줄 = 항목 이름, 첫 칸 = 시간" 모양으로 정리한다
 *  layout: 'auto' | 'cols'(항목이 열) | 'rows'(항목이 행) */
function prepareGrid(raw, layout = 'auto') {
  const notes = [...((raw && raw.meta && raw.meta.notes) || [])];
  let { rows, dropped } = dropBlankCols((raw || []).map(r => r.map(c => (c == null ? '' : String(c)))));
  if (!rows.some(r => r.some(c => !isBlank(c)))) return { rows: [], notes, layout: 'cols' };
  if (dropped) notes.push(`빈 열 ${dropped}개를 뺐어요`);

  const blk = findBlock(rows);
  let headRows = [], body;
  if (blk) {
    const skipped = rows.slice(0, blk.start).filter(r => r.some(c => !isBlank(c))).length;
    if (skipped) notes.push(`위쪽 제목·설명 ${skipped}줄을 건너뛰었어요`);
    const after = rows.slice(blk.body[1] + 1).filter(r => r.some(c => !isBlank(c))).length;
    if (after) notes.push(`표 아래쪽 ${after}줄(메모·요약)을 뺐어요`);
    headRows = blk.header.map(i => rows[i]);
    body = rows.slice(blk.body[0], blk.body[1] + 1).filter(r => r.some(c => !isBlank(c)));
  } else body = rows.filter(r => r.some(c => !isBlank(c)));

  // 이름 줄: 2단이면 위 줄을 오른쪽으로 채워 아래 줄과 합친다
  let header = null;
  if (headRows.length === 2) {
    const [top, sub] = headRows; let last = '';
    header = top.map((name, i) => {
      const nm = isBlank(name) ? last : String(name).trim();
      if (!isBlank(name)) last = nm;
      const s = String(sub[i] ?? '').trim();
      if (!s) return nm;
      if (!nm) return s;
      if (nm.includes(s)) return nm;
      return UNIT_RE.test(s) && !/^[\[(（]/.test(s) ? `${nm} (${s})` : `${nm} ${s}`;
    });
    notes.push('두 줄짜리 이름(단위·하위 이름)을 합쳤어요');
  } else if (headRows.length === 1) header = headRows[0];

  // 합계·평균 줄 빼기
  const isSummary = r => { const f = r.find(c => !isBlank(c)); return f != null && SUMMARY_RE.test(String(f).trim()); };
  const sumRows = body.filter(isSummary).length;
  if (sumRows) { body = body.filter(r => !isSummary(r)); notes.push(`합계·평균 같은 요약 줄 ${sumRows}개를 뺐어요`); }

  rows = dropBlankCols(header ? [header, ...body] : body).rows;
  if (rows.length < 2 || rows[0].length < 2) return { rows, notes, layout: 'cols' };

  let use = layout;
  if (use === 'auto') use = layoutScore(transpose(rows)) > layoutScore(rows) + 0.25 ? 'rows' : 'cols';
  if (use === 'rows') {
    rows = transpose(rows);
    // 돌린 뒤 둘째 줄이 단위 줄이면 이름에 합친다
    if (rows.length > 3) {
      const u = rowInfo(rows[1]);
      const cells = rows[1].slice(1).filter(c => !isBlank(c));
      if (u.val === 0 && u.text >= 1 && cells.length >= (rows[1].length - 1) / 2 && rowInfo(rows[2]).data) {
        rows = [rows[0].map((nm, i) => { const sub = String(rows[1][i] ?? '').trim(); if (!sub) return nm; if (!nm) return sub; return UNIT_RE.test(sub) && !/^[\[(（]/.test(sub) ? `${nm} (${sub})` : `${nm} ${sub}`; }), ...rows.slice(2)];
        notes.push('두 줄짜리 이름(단위·하위 이름)을 합쳤어요');
      }
    }
    const sum2 = rows.slice(1).filter(isSummary).length;
    if (sum2) { rows = [rows[0], ...rows.slice(1).filter(r => !isSummary(r))]; notes.push(`합계·평균 같은 요약 줄 ${sum2}개를 뺐어요`); }
  }
  return { rows, notes, layout: use };
}

/* ---------- 7. 시간 칸 고르기 ---------- */
function guessTimeCol(tb) {
  const times = tb.kinds.map((k, j) => (k === 'time' ? j : -1)).filter(j => j >= 0);
  if (times.length) {
    // 값이 가장 다양한 시각 칸 (날짜만 있는 칸보다 시각이 있는 칸)
    const distinct = j => new Set(tb.cols[j].filter(c => !isBlank(c))).size;
    return times.sort((a, b) => distinct(b) - distinct(a) || a - b)[0];
  }
  const inc = j => {
    const v = tb.cols[j].map(toNumber).filter(Number.isFinite);
    if (v.length < 3) return false;
    let k = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[i - 1]) k++;
    return k >= (v.length - 1) * 0.9;
  };
  const byName = tb.headers.findIndex((h, j) => isTimeName(h) && tb.kinds[j] === 'number' && inc(j));
  if (byName >= 0) return byName;
  if (tb.kinds[0] === 'number') {
    const v = tb.cols[0].map(toNumber).filter(Number.isFinite);
    let ok = v.length > 2; for (let i = 1; ok && i < v.length; i++) if (!(v[i] > v[i - 1])) ok = false;
    if (ok) return 0;
  }
  return -1;
}

const UNITS = { s: { label: '초', sec: 1 }, min: { label: '분', sec: 60 }, h: { label: '시간', sec: 3600 }, d: { label: '일', sec: 86400 } };

function interpAt(ts, vs, x) {
  if (!ts.length || x < ts[0] || x > ts[ts.length - 1]) return NaN;
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= x) lo = m; else hi = m; }
  if (ts[hi] === x) return vs[hi];
  if (ts[lo] === x || ts[hi] === ts[lo]) return vs[lo];
  return vs[lo] + (vs[hi] - vs[lo]) * (x - ts[lo]) / (ts[hi] - ts[lo]);
}

/** 표 + 설정 → 분석용 데이터 */
function buildDataset(tb, cfg) {
  const n = tb.body.length;
  let t = new Array(n).fill(NaN);
  let tLabel, unit = null, kind = 'index', secAbs = null;
  const notes = [];
  const tc = cfg.timeCol;
  if (tc < 0) {
    t = t.map((_, i) => i + 1);
    tLabel = '측정 순서(번째)';
  } else if (tb.kinds[tc] === 'time') {
    kind = 'time';
    const ts = timeSeconds(tb.cols[tc]);
    notes.push(...ts.notes);
    secAbs = ts.sec;
    const fin = secAbs.filter(Number.isFinite);
    const t0 = minOf(fin), span = maxOf(fin) - t0;
    unit = cfg.unit && cfg.unit !== 'auto' ? cfg.unit : span <= 180 ? 's' : span <= 3 * 3600 ? 'min' : span <= 3 * 86400 ? 'h' : 'd';
    t = secAbs.map(s => (s - t0) / UNITS[unit].sec);
    tLabel = `경과 시간(${UNITS[unit].label})`;
  } else {
    kind = 'number';
    t = tb.cols[tc].map(toNumber);
    tLabel = tb.headers[tc];
  }
  // 값 칸마다 자기 시각 칸이 있으면(태그별 시각) 기준 시각에 맞춰 보간한다
  const own = new Map();
  let resampled = 0;
  const vars = cfg.vars.map(j => {
    let values = tb.cols[j].map(toNumber);
    const oc = tb.timeOf ? tb.timeOf[j] : -1;
    if (secAbs && tb.pairs && oc >= 0 && oc !== tc && tb.kinds[oc] === 'time') {
      if (!own.has(oc)) own.set(oc, timeSeconds(tb.cols[oc]).sec);
      const os = own.get(oc);
      const pts = os.map((s, i) => [s, values[i]]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      values = secAbs.map(s => (Number.isFinite(s) ? interpAt(xs, ys, s) : NaN));
      resampled++;
    }
    return { name: tb.headers[j], col: j, values };
  });
  if (resampled) notes.push(`값마다 시각 칸이 따로 있어서 ${resampled}개 항목을 '${tb.headers[tc]}' 시각에 맞춰 보간했어요`);
  // 시간 순으로 정렬 (시간이 빈 줄은 뺀다)
  const idx = [...Array(n).keys()].filter(i => Number.isFinite(t[i])).sort((a, b) => t[a] - t[b]);
  let unsorted = 0; for (let k = 1; k < n; k++) if (Number.isFinite(t[k]) && Number.isFinite(t[k - 1]) && t[k] < t[k - 1]) unsorted++;
  const tt = idx.map(i => t[i]);
  const steps = []; let dups = 0, maxGap = 0;
  for (let k = 1; k < tt.length; k++) { const d = tt[k] - tt[k - 1]; if (d === 0) dups++; else steps.push(d); if (d > maxGap) maxGap = d; }
  const medStep = median(steps);
  if (dups) notes.push(`같은 시각이 ${dups}줄 있어요`);
  if (kind === 'time' && medStep > 0 && maxGap > 10 * medStep) notes.push(`기록이 빈 구간이 있어요 (가장 긴 빈 구간 ${+(maxGap).toPrecision(3)}${UNITS[unit].label}, 보통 간격 ${+medStep.toPrecision(3)}${UNITS[unit].label})`);
  return {
    kind, unit, tLabel, tSym: 't',
    timeHeader: tc >= 0 ? tb.headers[tc] : null,
    tRaw: idx.map(i => (tc >= 0 ? tb.cols[tc][i] : i + 1)),
    t: tt,
    vars: vars.map(v => ({ ...v, values: idx.map(i => v.values[i]) })),
    dropped: n - idx.length,
    notes,
    timeInfo: { first: idx.length ? (tc >= 0 ? tb.cols[tc][idx[0]] : 1) : null, last: idx.length ? (tc >= 0 ? tb.cols[tc][idx[idx.length - 1]] : n) : null, span: tt.length ? tt[tt.length - 1] - tt[0] : 0, medStep, maxGap, dups, unsorted },
  };
}

const Reader = {
  parseText, parseNum, toNumber, parseTimeCell, timeSeconds, columnKind, buildTable, guessTimeCol, buildDataset, prepareGrid,
  transpose, isBad, isBlank, isTimeName, maxOf, minOf, median, fmtStamp, UNITS, TIME_NAME_RE, BAD_RE,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Reader;
else root.Reader = Reader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
