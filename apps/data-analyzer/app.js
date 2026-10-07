'use strict';

/* ================================================================
 * 데이터 분석기
 * 시간별 순시값 → 시간 변화 함수 / 항목 간 관계 / 다중 회귀 → 엑셀(3시트)
 * ================================================================ */

// 이 기기에만 저장되는 간단한 저장소
const KEY = 'data-analyzer';
const store = {
  get(k, d) { try { const v = localStorage.getItem(`${KEY}:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`${KEY}:${k}`, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};

const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- 1. 입력 읽기 ---------------- */

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

/* ---------------- 2. 통계 계산 ---------------- */

const sum = a => a.reduce((s, v) => s + v, 0);
const mean = a => sum(a) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(sum(a.map(v => (v - m) ** 2)) / (a.length - 1)); };

// 가우스 소거법 (부분 피벗). 풀 수 없으면 null
function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// 최소제곱: 설계행렬 X(각 행 = 특성 배열) → 계수
function leastSquares(X, y) {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const r = X[i];
    for (let a = 0; a < p; a++) {
      b[a] += r[a] * y[i];
      for (let c = a; c < p; c++) A[a][c] += r[a] * r[c];
    }
  }
  for (let a = 0; a < p; a++) for (let c = 0; c < a; c++) A[a][c] = A[c][a];
  return solve(A, b);
}

const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };

// 다항식: x를 표준화해서 풀고, 원래 x의 계수로 되돌린다 (계산 안정성)
function polyFit(x, y, deg) {
  const m = mean(x), s = sd(x) || 1;
  const u = x.map(v => (v - m) / s);
  const c = leastSquares(u.map(v => Array.from({ length: deg + 1 }, (_, k) => v ** k)), y);
  if (!c) return null;
  const a = new Array(deg + 1).fill(0);
  for (let k = 0; k <= deg; k++) for (let j = 0; j <= k; j++) a[j] += c[k] * s ** -k * binom(k, j) * (-m) ** (k - j);
  return a;
}

const SUP = { 2: '²', 3: '³' };

const MODELS = [
  { id: 'linear', name: '직선', p: 1, plain: '일정한 속도로 늘거나 줄어요' },
  { id: 'exp', name: '지수 곡선', p: 1, plain: '일정한 비율로 점점 빠르게(또는 느리게) 변해요' },
  { id: 'log', name: '로그 곡선', p: 1, plain: '처음엔 빠르게 변하다가 점점 느려져요' },
  { id: 'power', name: '거듭제곱 곡선', p: 1, plain: 'x가 몇 배가 되면 y도 일정한 배수로 변해요' },
  { id: 'quad', name: '2차 곡선', p: 2, plain: '한 번 꺾이는 곡선이에요 (올라갔다 내려오거나 그 반대)' },
  { id: 'cubic', name: '3차 곡선', p: 3, plain: '두 번까지 꺾일 수 있는 S자 곡선이에요' },
];

function fitModel(id, x, y) {
  const n = x.length;
  const allPosX = x.every(v => v > 0), allPosY = y.every(v => v > 0);
  let params, predict;
  switch (id) {
    case 'linear': case 'quad': case 'cubic': {
      const deg = { linear: 1, quad: 2, cubic: 3 }[id];
      if (n < deg + 3) return null;
      if (new Set(x).size <= deg) return null;
      params = polyFit(x, y, deg); if (!params) return null;
      predict = v => params.reduce((s, a, k) => s + a * v ** k, 0);
      break;
    }
    case 'exp': {
      if (!allPosY || n < 4) return null;
      const c = polyFit(x, y.map(Math.log), 1); if (!c) return null;
      params = [Math.exp(c[0]), c[1]];
      predict = v => params[0] * Math.exp(params[1] * v);
      break;
    }
    case 'log': {
      if (!allPosX || n < 4) return null;
      const c = polyFit(x.map(Math.log), y, 1); if (!c) return null;
      params = c;
      predict = v => params[0] + params[1] * Math.log(v);
      break;
    }
    case 'power': {
      if (!allPosX || !allPosY || n < 4) return null;
      const c = polyFit(x.map(Math.log), y.map(Math.log), 1); if (!c) return null;
      params = [Math.exp(c[0]), c[1]];
      predict = v => params[0] * v ** params[1];
      break;
    }
  }
  const meta = MODELS.find(m => m.id === id);
  const yh = x.map(predict);
  if (!yh.every(Number.isFinite)) return null;
  const my = mean(y);
  const ssRes = sum(y.map((v, i) => (v - yh[i]) ** 2));
  const ssTot = sum(y.map(v => (v - my) ** 2));
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  const adj = n - meta.p - 1 > 0 ? 1 - (1 - r2) * (n - 1) / (n - meta.p - 1) : r2;
  return { ...meta, params, predict, r2, adj, rmse: Math.sqrt(ssRes / n), n };
}

// 여러 함수 중 가장 잘 맞는 것. 비슷하면(0.01 이내) 더 단순한 것을 고른다
function bestFit(xAll, yAll) {
  const x = [], y = [];
  xAll.forEach((v, i) => { if (Number.isFinite(v) && Number.isFinite(yAll[i])) { x.push(v); y.push(yAll[i]); } });
  if (x.length < 4) return { error: '값이 4개 이상 있어야 계산할 수 있어요', n: x.length };
  if (new Set(y).size === 1) return { constant: y[0], n: x.length, x, y };
  if (new Set(x).size === 1) return { error: '기준 값이 모두 같아서 관계를 계산할 수 없어요', n: x.length };
  const all = MODELS.map(m => fitModel(m.id, x, y)).filter(Boolean);
  if (!all.length) return { error: '계산할 수 없어요', n: x.length };
  const top = Math.max(...all.map(f => f.adj));
  const ok = all.filter(f => f.adj >= top - 0.01);
  ok.sort((a, b) => a.p - b.p || b.adj - a.adj);
  const linear = all.find(f => f.id === 'linear');
  return { best: ok[0], all: all.sort((a, b) => b.adj - a.adj), linear, x, y, n: x.length };
}

function pearson(a, b) {
  const x = [], y = [];
  a.forEach((v, i) => { if (Number.isFinite(v) && Number.isFinite(b[i])) { x.push(v); y.push(b[i]); } });
  if (x.length < 3) return { r: NaN, n: x.length };
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN, n: x.length };
}

// 다중 선형 회귀: y = b0 + Σ bj·xj
function multiRegression(yName, y, preds) {
  const rows = [];
  y.forEach((v, i) => { if (Number.isFinite(v) && preds.every(p => Number.isFinite(p.values[i]))) rows.push(i); });
  const k = preds.length, n = rows.length;
  if (k < 2) return null;
  if (n < k + 3) return { error: `여러 항목을 함께 쓰려면 값이 ${k + 3}줄 이상 필요해요 (지금 ${n}줄)` };
  const ys = rows.map(i => y[i]);
  const ms = preds.map(p => mean(rows.map(i => p.values[i])));
  const ss = preds.map(p => sd(rows.map(i => p.values[i])));
  if (ss.some(s => !(s > 0))) return { error: '값이 변하지 않는 항목이 있어서 함께 계산할 수 없어요' };
  const X = rows.map(i => [1, ...preds.map((p, j) => (p.values[i] - ms[j]) / ss[j])]);
  const c = leastSquares(X, ys);
  if (!c) return { error: '항목끼리 너무 똑같이 움직여서(겹쳐서) 함께 계산할 수 없어요. 비슷한 항목을 하나 빼보세요.' };
  const coefs = preds.map((p, j) => c[j + 1] / ss[j]);
  const b0 = c[0] - sum(preds.map((p, j) => c[j + 1] * ms[j] / ss[j]));
  const yh = rows.map(i => b0 + sum(preds.map((p, j) => coefs[j] * p.values[i])));
  const my = mean(ys), sy = sd(ys);
  const ssRes = sum(ys.map((v, i) => (v - yh[i]) ** 2));
  const ssTot = sum(ys.map(v => (v - my) ** 2));
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  const adj = 1 - (1 - r2) * (n - 1) / (n - k - 1);
  const beta = preds.map((p, j) => c[j + 1] / sy);
  return {
    yName, n, r2, adj, rmse: Math.sqrt(ssRes / n), b0,
    terms: preds.map((p, j) => ({ name: p.name, coef: coefs[j], beta: beta[j], mean: ms[j] })),
    yh, ys, rows,
  };
}

/* ---------------- 3. 숫자·식 표시 ---------------- */

const SUPS = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

// 화면용 숫자: 유효숫자 4자리, 너무 크거나 작으면 ×10ⁿ
function fmt(v, sig = 4) {
  if (!Number.isFinite(v)) return '-';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) {
    const [m, e] = v.toExponential(sig - 1).split('e');
    return `${+m}×10${String(+e).split('').map(c => SUPS[c]).join('')}`;
  }
  return String(+v.toPrecision(sig));
}
// 엑셀 표시용 (E 표기)
const fmtX = (v, sig = 4) => {
  if (!Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (v !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(sig - 1).replace('e', 'E');
  return String(+v.toPrecision(sig));
};
// 엑셀 수식에 넣을 숫자 (정밀도 유지)
const num = v => String(+v.toPrecision(12)).replace('e', 'E');

const fmtR2 = r2 => (Math.round(Math.max(0, r2) * 1000) / 1000).toFixed(3);

function quality(r2) {
  if (r2 >= 0.9) return { label: '매우 잘 맞아요', cls: '' };
  if (r2 >= 0.7) return { label: '잘 맞아요', cls: '' };
  if (r2 >= 0.4) return { label: '어느 정도 맞아요', cls: 'mid' };
  return { label: '잘 맞지 않아요', cls: 'low' };
}

// 항들을 "a + b·t − c·t²" 꼴로 잇는다
function joinTerms(terms, f) {
  let out = '';
  terms.forEach(([c, part], i) => {
    const s = f(Math.abs(c)) + (part ? ` × ${part}` : '');
    if (i === 0) out = (c < 0 ? '−' : '') + s;
    else out += c < 0 ? ` − ${s}` : ` + ${s}`;
  });
  return out;
}

// 화면/엑셀용 식 글자
function formulaText(fit, xs, f = fmt) {
  const p = fit.params;
  switch (fit.id) {
    case 'linear': case 'quad': case 'cubic':
      return 'y = ' + joinTerms(p.map((c, k) => [c, k === 0 ? '' : k === 1 ? xs : `${xs}${SUP[k]}`]), f);
    case 'exp': return `y = ${f(p[0])} × e^(${f(p[1])} × ${xs})`;
    case 'log': return 'y = ' + joinTerms([[p[0], ''], [p[1], `ln(${xs})`]], f);
    case 'power': return `y = ${f(p[0])} × ${xs}^${f(p[1])}`;
  }
  return '';
}
const formulaTextX = (fit, xs) => formulaText(fit, xs, fmtX).replace(/×/g, '*').replace(/²/g, '^2').replace(/³/g, '^3').replace(/−/g, '-');

// 엑셀 수식 (= 없이). X는 셀 주소
function excelFormula(fit, X) {
  const p = fit.params.map(num);
  switch (fit.id) {
    case 'linear': return `${p[0]}+(${p[1]})*${X}`;
    case 'quad': return `${p[0]}+(${p[1]})*${X}+(${p[2]})*${X}^2`;
    case 'cubic': return `${p[0]}+(${p[1]})*${X}+(${p[2]})*${X}^2+(${p[3]})*${X}^3`;
    case 'exp': return `(${p[0]})*EXP((${p[1]})*${X})`;
    case 'log': return `${p[0]}+(${p[1]})*LN(${X})`;
    case 'power': return `(${p[0]})*${X}^(${p[1]})`;
  }
}

/* ---------------- 4. 쉬운 해석 문장 ---------------- */

function trendSentence(name, fr, xName, unitWord) {
  if (fr.error) return `${name}: ${fr.error}.`;
  if (fr.constant != null) return `${name}은(는) 처음부터 끝까지 ${fmt(fr.constant)}으로 변하지 않았어요.`;
  const { best, linear, x, y } = fr;
  const x0 = Math.min(...x), x1 = Math.max(...x);
  const range = Math.max(...y) - Math.min(...y);
  const snap = v => (Math.abs(v) < range * 1e-9 ? 0 : v);
  const a = snap(best.predict(x0)), b = snap(best.predict(x1));
  const parts = [];
  const grid = Array.from({ length: 101 }, (_, i) => best.predict(x0 + (x1 - x0) * i / 100));
  const hi = Math.max(...grid), lo = Math.min(...grid);
  if (Math.abs(b - a) < range * 0.1 && hi - lo > range * 0.3) {
    const up = hi - Math.max(a, b) > Math.min(a, b) - lo;
    parts.push(`${name}은(는) 중간에 ${up ? `올라갔다가(최고 약 ${fmt(hi)}) 다시 내려와요` : `내려갔다가(최저 약 ${fmt(lo)}) 다시 올라와요`}`);
  } else if (Math.abs(b - a) < range * 0.1) parts.push(`${name}은(는) 전체적으로 큰 변화 없이 ${fmt(a)} 근처에 머물러요`);
  else parts.push(`${name}은(는) 전체적으로 ${b > a ? '늘어나요' : '줄어들어요'} (${fmt(a)} → ${fmt(b)})`);
  if (linear && unitWord && Math.abs(b - a) >= range * 0.1)
    parts.push(`평균적으로 ${unitWord}마다 약 ${fmt(Math.abs(linear.params[1]), 3)}씩 ${linear.params[1] > 0 ? '늘어요' : '줄어요'}`);
  if (best.id === 'quad' && !/중간에/.test(parts[0])) {
    const v = -best.params[1] / (2 * best.params[2]);
    if (v > x0 + (x1 - x0) * 0.1 && v < x1 - (x1 - x0) * 0.1)
      parts.push(`${xName} ${fmt(v, 3)} 무렵에 가장 ${best.params[2] < 0 ? '높았다가 다시 내려가요' : '낮았다가 다시 올라가요'}`);
  }
  return parts.join('. ') + '.';
}

function corrWords(r) {
  const a = Math.abs(r);
  if (!Number.isFinite(r)) return { strength: '계산 불가', text: '값이 부족해요' };
  const strength = a >= 0.7 ? '강한' : a >= 0.4 ? '보통' : a >= 0.2 ? '약한' : '거의 없는';
  if (a < 0.2) return { strength, text: '서로 거의 관계가 없어요' };
  return { strength, text: r > 0 ? '한쪽이 오르면 다른 쪽도 오르는 편이에요' : '한쪽이 오르면 다른 쪽은 내려가는 편이에요' };
}

/* ---------------- 5. 그래프 (캔버스) ---------------- */

function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toPrecision(12));
  return { lo, hi, ticks };
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

function chartTheme(light) {
  const dark = !light && isDark();
  return dark
    ? { bg: '#1b1b1e', text: '#f2f2f4', text2: '#a8a8b2', grid: 'rgba(255,255,255,.08)', axis: 'rgba(255,255,255,.25)', point: '#3987e5', fit: '#d95926', ring: '#1b1b1e' }
    : { bg: '#ffffff', text: '#1b1b1f', text2: '#5f5f68', grid: 'rgba(20,20,30,.08)', axis: 'rgba(20,20,30,.3)', point: '#2a78d6', fit: '#eb6834', ring: '#ffffff' };
}

// spec: { x[], y[], line(점 잇기), fn(회귀식), xLabel, yLabel, title?, fitLabel? }
function drawChart(canvas, spec, opt = {}) {
  const W = opt.width, H = opt.height, dpr = opt.dpr || 1;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const th = chartTheme(opt.light);
  const fs = opt.fontSize || 12;
  const font = w => `${w} ${fs}px "Pretendard Variable", Pretendard, system-ui, sans-serif`;
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);

  const pts = spec.x.map((x, i) => [x, spec.y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (!pts.length) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  let xmin = Math.min(...xs), xmax = Math.max(...xs);
  const curve = [];
  if (spec.fn) {
    for (let i = 0; i <= 160; i++) {
      const xv = xmin + (xmax - xmin) * i / 160;
      const yv = spec.fn(xv);
      if (Number.isFinite(yv)) curve.push([xv, yv]);
    }
  }
  // 곡선이 데이터 범위를 크게 벗어나면 축은 데이터 기준으로
  const yr = Math.max(...ys) - Math.min(...ys) || 1;
  const cys = curve.map(p => p[1]).filter(v => v > Math.min(...ys) - yr * 0.5 && v < Math.max(...ys) + yr * 0.5);
  const xt = niceTicks(xmin, xmax, opt.xTicks || 5);
  const yt = niceTicks(Math.min(...ys, ...cys), Math.max(...ys, ...cys), opt.yTicks || 4);

  let top = 10;
  if (spec.title) top += fs * 1.6 + 6;
  ctx.font = font(400);
  const yLabW = Math.max(...yt.ticks.map(v => ctx.measureText(fmt(v)).width));
  const L = Math.ceil(yLabW) + 12 + (spec.yLabel && opt.axisTitles ? fs + 8 : 0);
  const R = 14, B = fs * 2 + 16 + (opt.axisTitles ? fs + 6 : 0);
  const pw = W - L - R, ph = H - top - B;
  const px = v => L + (v - xt.lo) / (xt.hi - xt.lo) * pw;
  const py = v => top + ph - (v - yt.lo) / (yt.hi - yt.lo) * ph;

  if (spec.title) {
    ctx.fillStyle = th.text; ctx.font = font(700); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(spec.title, L, 10);
    if (spec.subtitle) {
      ctx.fillStyle = th.text2; ctx.font = font(400);
      ctx.fillText(spec.subtitle, L + ctx.measureText(spec.title).width + 12, 10);
      ctx.font = font(700);
    }
  }
  // 격자 + 축 숫자
  ctx.lineWidth = 1; ctx.font = font(400); ctx.fillStyle = th.text2;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of yt.ticks) {
    ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(L, Math.round(py(v)) + .5); ctx.lineTo(L + pw, Math.round(py(v)) + .5); ctx.stroke();
    ctx.fillText(fmt(v), L - 8, py(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const v of xt.ticks) ctx.fillText(fmt(v), px(v), top + ph + 8);
  ctx.strokeStyle = th.axis; ctx.beginPath(); ctx.moveTo(L, top + ph + .5); ctx.lineTo(L + pw, top + ph + .5); ctx.stroke();
  if (opt.axisTitles) {
    ctx.fillStyle = th.text2;
    ctx.fillText(spec.xLabel, L + pw / 2, top + ph + fs + 16);
    ctx.save(); ctx.translate(fs * 0.4 + 2, top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top';
    ctx.fillText(spec.yLabel, 0, 0); ctx.restore();
  } else {
    ctx.textAlign = 'right'; ctx.fillStyle = th.text2;
    ctx.fillText(spec.xLabel, L + pw, top + ph + fs + 14);
  }

  ctx.save();
  ctx.beginPath(); ctx.rect(L - 6, top - 6, pw + 12, ph + 12); ctx.clip();
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  if (spec.line) {
    ctx.strokeStyle = th.point; ctx.globalAlpha = .35; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath(); sorted.forEach(([a, b], i) => i ? ctx.lineTo(px(a), py(b)) : ctx.moveTo(px(a), py(b))); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const r = pts.length > 400 ? 2 : pts.length > 120 ? 2.6 : 3.4;
  ctx.fillStyle = th.point; ctx.strokeStyle = th.ring; ctx.lineWidth = 1.2;
  for (const [a, b] of pts) { ctx.beginPath(); ctx.arc(px(a), py(b), r * (opt.markScale || 1), 0, Math.PI * 2); ctx.fill(); if (pts.length < 400) ctx.stroke(); }
  if (curve.length) {
    ctx.strokeStyle = th.fit; ctx.lineWidth = 2 * (opt.markScale || 1); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); curve.forEach(([a, b], i) => i ? ctx.lineTo(px(a), py(b)) : ctx.moveTo(px(a), py(b))); ctx.stroke();
  }
  ctx.restore();

  if (opt.legend) {
    ctx.font = font(400); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const items = [['측정값', th.point, 'dot'], ...(spec.fn ? [[spec.fitLabel || '회귀 함수', th.fit, 'line']] : [])];
    let lx = L + pw - sum(items.map(([t]) => ctx.measureText(t).width + 34)), ly = spec.title ? 10 + fs / 2 : top + 8;
    for (const [t, c, k] of items) {
      ctx.fillStyle = c;
      if (k === 'dot') { ctx.beginPath(); ctx.arc(lx + 6, ly, 4 * (opt.markScale || 1), 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(lx, ly - 1.5, 14, 3);
      ctx.fillStyle = th.text2; ctx.fillText(t, lx + 20, ly);
      lx += ctx.measureText(t).width + 34;
    }
  }
  return { px, py, pts: sorted, L, pw, top, ph };
}

// 화면 그래프 + 눌렀을 때 값 보기
function mountChart(container, spec) {
  const canvas = el('canvas', { role: 'img', 'aria-label': `${spec.yLabel} 그래프` });
  container.append(canvas);
  let geo = null;
  const render = () => {
    const w = container.clientWidth; if (!w) return;
    geo = drawChart(canvas, spec, { width: w, height: container.clientHeight, dpr: Math.min(devicePixelRatio || 1, 3) });
  };
  render();
  new ResizeObserver(render).observe(container);
  const tip = $('tip');
  const show = e => {
    if (!geo) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = null, bd = Infinity;
    for (const p of geo.pts) {
      const d = (geo.px(p[0]) - mx) ** 2 + ((geo.py(p[1]) - my) ** 2) * 0.15;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    const fx = spec.fn ? spec.fn(best[0]) : NaN;
    tip.innerHTML = `${esc(spec.xLabel)}: <b>${fmt(best[0], 5)}</b><br>${esc(spec.yLabel)}: <b>${fmt(best[1], 5)}</b>` +
      (Number.isFinite(fx) ? `<br>함수 계산값: ${fmt(fx, 5)}` : '');
    tip.hidden = false;
    const tx = rect.left + geo.px(best[0]), ty = rect.top + geo.py(best[1]);
    const tw = tip.offsetWidth, thh = tip.offsetHeight;
    tip.style.left = Math.min(Math.max(8, tx - tw / 2), innerWidth - tw - 8) + 'px';
    tip.style.top = (ty - thh - 12 < 60 ? ty + 14 : ty - thh - 12) + 'px';
  };
  canvas.addEventListener('pointermove', show);
  canvas.addEventListener('pointerdown', show);
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
}
addEventListener('scroll', () => { $('tip').hidden = true; }, { passive: true });

// 엑셀용 그림 (밝은 테마, 고해상도)
function chartPNG(spec) {
  const c = document.createElement('canvas');
  drawChart(c, spec, { width: 640, height: 360, dpr: 2, light: true, legend: true, axisTitles: true, fontSize: 13, markScale: 1.1 });
  return c.toDataURL('image/png');
}

/* ---------------- 6. 화면 상태 ---------------- */

const state = {
  table: null,
  cfg: { timeCol: -1, unit: 'auto', vars: [], target: -1 },
  result: null,
};

const input = $('input');
const mainBtn = $('main-btn');

function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms);
}

function setMsg(text, cls = '') { const m = $('parse-msg'); m.textContent = text; m.className = 'msg ' + cls; }

function onInput() {
  store.set('text', input.value.length < 800_000 ? input.value : '');
  state.result = null;
  $('results').hidden = true;
  const rows = parseText(input.value);
  if (!rows.length) { state.table = null; $('setup').hidden = true; setMsg(''); updateButton(); return; }
  const tb = buildTable(rows);
  if (tb.error) { state.table = null; $('setup').hidden = true; setMsg(tb.error, 'err'); updateButton(); return; }
  const prevHeaders = state.table?.headers.join('\u0001');
  state.table = tb;
  // 같은 표 모양이면 설정 유지, 아니면 새로 추측
  const saved = store.get('cfg', null);
  if (prevHeaders !== tb.headers.join('\u0001')) {
    if (saved && saved.headers === tb.headers.join('\u0001')) state.cfg = { ...saved.cfg };
    else {
      const tc = guessTimeCol(tb);
      let vars = tb.kinds.map((k, i) => (k === 'number' && i !== tc ? i : -1)).filter(i => i >= 0);
      // 시간 칸이 따로 있으면 '경과 시간' 같은 칸은 기본으로 뺀다
      if (tc >= 0) { const rest = vars.filter(i => !TIME_NAME_RE.test(tb.headers[i])); if (rest.length) vars = rest; }
      state.cfg = { timeCol: tc, unit: 'auto', vars, target: vars[vars.length - 1] ?? -1 };
    }
  }
  const numCols = tb.kinds.filter(k => k === 'number').length;
  setMsg(`${tb.body.length}줄 · ${tb.headers.length}칸을 읽었어요${tb.hasHeader ? '' : ' (첫 줄에 이름이 없어서 항목1, 항목2…로 불러요)'}.`, numCols ? 'ok' : 'err');
  renderSetup();
}

function saveCfg() {
  if (state.table) store.set('cfg', { headers: state.table.headers.join('\u0001'), cfg: state.cfg });
}

function renderSetup() {
  const tb = state.table, cfg = state.cfg;
  $('setup').hidden = false;

  // 미리보기 (앞 5줄)
  const pv = $('preview'); pv.innerHTML = '';
  const role = i => i === cfg.timeCol ? 'time' : cfg.vars.includes(i) ? '' : 'off';
  pv.append(el('tr', {}, ...tb.headers.map((h, i) => el('th', { class: role(i), text: h + (i === cfg.timeCol ? ' ⏱' : '') }))));
  tb.body.slice(0, 5).forEach(r => pv.append(el('tr', {}, ...tb.headers.map((_, i) => {
    const v = r[i] ?? '';
    const bad = tb.kinds[i] === 'number' && String(v).trim() !== '' && Number.isNaN(toNumber(v));
    return el('td', { class: [role(i), bad ? 'bad' : ''].join(' ').trim(), text: v });
  }))));
  $('preview-note').textContent = tb.body.length > 5 ? `앞의 5줄만 보여줘요 (전체 ${tb.body.length}줄)` : '';

  // 시간 열
  const ts = $('time-col'); ts.innerHTML = '';
  ts.append(el('option', { value: '-1', text: '시간 칸 없음 (적은 순서대로 1, 2, 3…)' }));
  tb.headers.forEach((h, i) => { if (tb.kinds[i] !== 'text') ts.append(el('option', { value: String(i), text: h })); });
  ts.value = String(cfg.timeCol);
  $('unit-field').hidden = !(cfg.timeCol >= 0 && tb.kinds[cfg.timeCol] === 'time');
  $('time-unit').value = cfg.unit;

  // 항목 칩
  const chips = $('var-chips'); chips.innerHTML = '';
  tb.headers.forEach((h, i) => {
    if (tb.kinds[i] !== 'number' || i === cfg.timeCol) return;
    const on = cfg.vars.includes(i);
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), text: h });
    b.onclick = () => {
      cfg.vars = on ? cfg.vars.filter(j => j !== i) : [...cfg.vars, i].sort((a, c) => a - c);
      if (!cfg.vars.includes(cfg.target)) cfg.target = cfg.vars[cfg.vars.length - 1] ?? -1;
      changed();
    };
    chips.append(b);
  });
  if (!chips.children.length) chips.append(el('p', { class: 'hint', text: '숫자로 된 칸이 없어요. 값이 숫자로 적혀 있는지 확인해주세요.' }));

  // 궁금한 값
  const tg = $('target'); tg.innerHTML = '';
  cfg.vars.forEach(i => tg.append(el('option', { value: String(i), text: tb.headers[i] })));
  tg.value = String(cfg.target);
  tg.disabled = cfg.vars.length < 2;
  if (cfg.vars.length < 2) tg.append(el('option', { value: '-1', text: '항목이 2개 이상일 때 고를 수 있어요' })), tg.value = cfg.vars.length ? String(cfg.target) : '-1';

  updateButton();
}

function changed() {
  saveCfg();
  renderSetup();
  if (state.result) analyze();
}

$('time-col').onchange = e => {
  const c = state.cfg; c.timeCol = +e.target.value;
  c.vars = c.vars.filter(i => i !== c.timeCol);
  if (!c.vars.includes(c.target)) c.target = c.vars[c.vars.length - 1] ?? -1;
  changed();
};
$('time-unit').onchange = e => { state.cfg.unit = e.target.value; changed(); };
$('target').onchange = e => { state.cfg.target = +e.target.value; changed(); };

function updateButton() {
  if (!state.table) { mainBtn.disabled = true; mainBtn.textContent = '데이터를 넣어주세요'; return; }
  if (!state.cfg.vars.length) { mainBtn.disabled = true; mainBtn.textContent = '분석할 항목을 골라주세요'; return; }
  mainBtn.disabled = false;
  mainBtn.textContent = state.result ? '엑셀 파일 받기' : '분석하기';
}

mainBtn.onclick = () => {
  if (state.result) exportExcel();
  else { analyze(); if (state.result) $('results').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
};

/* ---------------- 7. 분석 + 결과 그리기 ---------------- */

function analyze() {
  const ds = buildDataset(state.table, state.cfg);
  if (ds.t.length < 4) { toast('시간 값을 읽을 수 있는 줄이 4줄 이상 필요해요'); return; }
  const unitWord = ds.unit ? UNITS[ds.unit].label.replace('시간', '1시간').replace(/^(초|분|일)$/, '1$1') : ds.kind === 'index' ? '한 번 잴 때' : null;

  const timeFits = ds.vars.map(v => ({ v, fr: bestFit(ds.t, v.values) }));
  const corr = ds.vars.map(a => ds.vars.map(b => pearson(a.values, b.values)));
  const target = ds.vars.find(v => v.col === state.cfg.target) || ds.vars[ds.vars.length - 1];
  const others = ds.vars.filter(v => v !== target);
  const pairFits = others.map(v => ({ v, fr: bestFit(v.values, target.values), r: pearson(v.values, target.values).r }));
  const multi = others.length >= 2 ? multiRegression(target.name, target.values, others) : null;

  state.result = { ds, unitWord, timeFits, corr, target, others, pairFits, multi, at: new Date() };
  renderResults();
  updateButton();
}

function badge(r2) { const q = quality(r2); return el('span', { class: `badge ${q.cls}`, text: `정확도 ${fmtR2(r2)} · ${q.label}` }); }

function fitBlock({ title, fr, xLabel, yLabel, xSym, line, says }) {
  const box = el('div', { class: 'fit' });
  const h = el('h4', {}, title);
  box.append(h);
  if (fr.error) { box.append(el('p', { class: 'says', text: fr.error })); return box; }
  const fn = fr.best ? fr.best.predict : fr.constant != null ? () => fr.constant : null;
  if (fr.best) {
    h.append(badge(fr.best.r2));
    box.append(el('div', { class: 'formula', html: `${esc(formulaText(fr.best, xSym))}<small>${esc(fr.best.name)} · ${esc(fr.best.plain)}<br>y = ${esc(yLabel)}, ${esc(xSym)} = ${esc(xLabel)}</small>` }));
  } else {
    box.append(el('div', { class: 'formula', html: `y = ${fmt(fr.constant)}<small>값이 변하지 않아요</small>` }));
  }
  if (says) box.append(el('p', { class: 'says', text: says }));
  box.append(el('div', { class: 'legend', html: `<span><i class="dot" style="background:${chartTheme().point}"></i>측정값</span>` + (fn ? `<span><i style="background:${chartTheme().fit}"></i>회귀 함수</span>` : '') }));
  const wrap = el('div', { class: 'chart' });
  box.append(wrap);
  requestAnimationFrame(() => mountChart(wrap, { x: fr.x, y: fr.y, fn, xLabel, yLabel, line }));
  if (fr.all && fr.all.length > 1) {
    const d = el('details', { class: 'more' }, el('summary', { text: '다른 함수와 비교하기' }));
    const t = el('table', {}, el('tr', {}, el('th', { text: '함수' }), el('th', { text: '정확도(R²)' }), el('th', { text: '오차(RMSE)' })));
    fr.all.forEach(f => t.append(el('tr', {}, el('td', { text: f.name + (f === fr.best ? ' ✓' : '') }), el('td', { text: fmtR2(f.r2) }), el('td', { text: fmt(f.rmse) }))));
    d.append(el('div', { class: 'table-scroll' }, t));
    d.append(el('p', { class: 'hint', text: '정확도가 거의 같으면(0.01 이내) 더 단순한 함수를 골라요. 복잡한 함수는 측정 범위 밖에서 엉뚱해지기 쉬워요.' }));
    box.append(d);
  }
  return box;
}

function renderResults() {
  const R = state.result, { ds } = R;
  $('results').hidden = false;

  // 요약
  const sm = $('summary'); sm.innerHTML = '';
  const add = html => sm.append(el('li', { html }));
  const span = ds.t.length ? `${fmt(ds.t[0])} ~ ${fmt(ds.t[ds.t.length - 1])}` : '';
  add(`측정값 <b>${ds.t.length}개</b>, 항목 <b>${ds.vars.length}개</b>를 분석했어요. (${esc(ds.tLabel)} ${span})${ds.dropped ? ` 시간을 읽을 수 없는 ${ds.dropped}줄은 뺐어요.` : ''}`);
  R.timeFits.forEach(({ v, fr }) => add(esc(trendSentence(v.name, fr, ds.tLabel, R.unitWord))));
  if (ds.vars.length >= 2) {
    const pairs = [];
    for (let i = 0; i < ds.vars.length; i++) for (let j = i + 1; j < ds.vars.length; j++) pairs.push([i, j, R.corr[i][j].r]);
    const strong = pairs.filter(p => Math.abs(p[2]) >= 0.7).sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
    if (strong.length) {
      const [i, j, r] = strong[0];
      add(`가장 관계가 깊은 짝은 <b>${esc(ds.vars[i].name)}</b>와(과) <b>${esc(ds.vars[j].name)}</b>이에요 (r = ${fmt(r, 2)}). ${esc(corrWords(r).text)}.`);
    } else add('항목들 사이에 강한 관계(|r| ≥ 0.7)는 보이지 않아요.');
  }
  if (R.multi && !R.multi.error) {
    const top = [...R.multi.terms].sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta))[0];
    const how = R.multi.r2 >= 0.9 ? '매우 잘' : R.multi.r2 >= 0.7 ? '잘' : R.multi.r2 >= 0.4 ? '어느 정도' : '잘 안';
    add(`${esc(R.target.name)}은(는) 다른 항목들로 ${how} 설명돼요 (정확도 ${fmtR2(R.multi.r2)}). 영향이 가장 큰 항목은 <b>${esc(top.name)}</b>이에요.`);
  }

  // 시간 변화
  const tf = $('time-fits'); tf.innerHTML = '';
  R.timeFits.forEach(({ v, fr }) => tf.append(fitBlock({
    title: v.name, fr, xLabel: ds.tLabel, yLabel: v.name, xSym: 't', line: true,
    says: trendSentence(v.name, fr, ds.tLabel, R.unitWord),
  })));

  // 상관 표
  $('corr-panel').hidden = ds.vars.length < 2;
  const heat = $('heat'); heat.innerHTML = '';
  heat.append(el('tr', {}, el('th', { text: '' }), ...ds.vars.map(v => el('th', { text: v.name }))));
  const pos = cssVar('--pos'), neg = cssVar('--neg');
  ds.vars.forEach((a, i) => heat.append(el('tr', {}, el('th', { text: a.name }), ...ds.vars.map((b, j) => {
    const r = R.corr[i][j].r;
    const pct = Number.isFinite(r) ? Math.round(Math.abs(r) * 55) : 0;
    const td = el('td', { class: 'cell', text: Number.isFinite(r) ? fmt(r, 2) : '-', title: `${a.name} ↔ ${b.name}: ${corrWords(r).strength} 관계` });
    if (i !== j) td.style.background = `color-mix(in srgb, ${r >= 0 ? pos : neg} ${pct}%, transparent)`;
    return td;
  }))));
  const pl = $('pair-list'); pl.innerHTML = '';
  for (let i = 0; i < ds.vars.length; i++) for (let j = i + 1; j < ds.vars.length; j++) {
    const r = R.corr[i][j].r, w = corrWords(r);
    pl.append(el('li', { html: `<b>${esc(ds.vars[i].name)} ↔ ${esc(ds.vars[j].name)}</b>: ${w.strength} 관계 (r = ${Number.isFinite(r) ? fmt(r, 2) : '-'}). ${esc(w.text)}.` }));
  }

  // 궁금한 값 vs 다른 항목
  $('pair-panel').hidden = !R.others.length;
  $('pair-title').textContent = `${R.target.name}에 영향을 주는 항목`;
  const pf = $('pair-fits'); pf.innerHTML = '';
  pf.append(el('p', { class: 'hint', text: `다른 항목 값으로 ${R.target.name}을(를) 계산하는 식이에요. 가로축이 다른 항목, 세로축이 ${R.target.name}이에요.` }));
  R.pairFits.forEach(({ v, fr, r }) => pf.append(fitBlock({
    title: `${v.name} → ${R.target.name}`, fr, xLabel: v.name, yLabel: R.target.name, xSym: 'x', line: false,
    says: Number.isFinite(r) ? `상관계수 r = ${fmt(r, 2)}: ${corrWords(r).strength} 관계예요. ${corrWords(r).text}.` : '',
  })));

  // 다중 회귀
  const mp = $('multi-panel'), mu = $('multi');
  mp.hidden = !R.multi; mu.innerHTML = '';
  $('multi-title').textContent = `여러 항목으로 ${R.target.name} 계산하기`;
  if (R.multi?.error) mu.append(el('p', { class: 'says', text: R.multi.error }));
  else if (R.multi) {
    const M = R.multi;
    mu.append(el('p', { class: 'hint', text: '다른 항목을 모두 함께 써서 한 번에 계산하는 식이에요 (다중 선형 회귀).' }));
    const txt = `${M.yName} = ` + joinTerms([[M.b0, ''], ...M.terms.map(t => [t.coef, t.name])], fmt);
    mu.append(el('div', { class: 'formula wrap', html: `${esc(txt)}<small>측정값 ${M.n}개 사용</small>` }));
    mu.append(el('p', {}, badge(M.r2)));
    const maxB = Math.max(...M.terms.map(t => Math.abs(t.beta)));
    const t = el('table', { class: 'coef-table' }, el('tr', {}, el('th', { text: '항목' }), el('th', { text: '1 늘면' }), el('th', { text: '영향 크기' })));
    [...M.terms].sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta)).forEach(term => {
      const w = Math.round(Math.abs(term.beta) / maxB * 70);
      t.append(el('tr', {},
        el('td', { text: term.name }),
        el('td', { text: `${term.coef >= 0 ? '+' : '−'}${fmt(Math.abs(term.coef))}` }),
        el('td', { html: `<span class="bar" style="width:${w}px;background:var(${term.beta >= 0 ? '--pos' : '--neg'})"></span> ${fmt(Math.abs(term.beta), 2)}` })));
    });
    mu.append(el('div', { class: 'table-scroll' }, t));
    mu.append(el('p', { class: 'hint', text: `"1 늘면"은 다른 항목이 그대로일 때 그 항목이 1 늘면 ${M.yName}이(가) 얼마나 변하는지예요. "영향 크기"는 단위를 맞춰 비교한 값이라 클수록 영향이 커요 (파랑 = 같이 오름, 빨강 = 반대로).` }));
    const wrap = el('div', { class: 'chart' });
    mu.append(el('p', { class: 'says', text: '실제 값과 식으로 계산한 값 비교 (점이 대각선에 가까울수록 정확해요)' }));
    mu.append(wrap);
    requestAnimationFrame(() => mountChart(wrap, { x: M.yh, y: M.ys, fn: v => v, xLabel: '식으로 계산한 값', yLabel: '실제 값', line: false }));
  }
}

/* ---------------- 8. 엑셀 만들기 ---------------- */

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('불러오기 실패'));
    document.head.append(s);
  });
}
async function getExcelJS() {
  if (!window.ExcelJS) await loadScript('vendor/exceljs.min.js');
  return window.ExcelJS;
}

const colL = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const qs = name => `'${name.replace(/'/g, "''")}'`;

const XL = {
  head: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D5FA8' } }, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true } },
  sub: { font: { bold: true, color: { argb: 'FF1B1B1F' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EEFA' } } },
  input: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } } },
  border: { top: { style: 'thin', color: { argb: 'FFD0D4DA' } }, left: { style: 'thin', color: { argb: 'FFD0D4DA' } }, bottom: { style: 'thin', color: { argb: 'FFD0D4DA' } }, right: { style: 'thin', color: { argb: 'FFD0D4DA' } } },
};

function styleRow(row, style, from = 1, to = row.cellCount) {
  for (let c = from; c <= to; c++) {
    const cell = row.getCell(c);
    Object.assign(cell, JSON.parse(JSON.stringify(style)));
    cell.border = XL.border;
  }
}

async function exportExcel() {
  const R = state.result; if (!R) return;
  mainBtn.disabled = true; mainBtn.textContent = '엑셀 만드는 중…';
  try {
    const ExcelJS = await getExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.creator = '데이터 분석기'; wb.created = new Date();
    const { ds } = R;
    const S1 = '순시값', S2 = '그래프', S3 = '함수설명';

    /* --- 시트1: 순시값 --- */
    const ws1 = wb.addWorksheet(S1, { views: [{ state: 'frozen', ySplit: 1 }] });
    const showRaw = ds.kind === 'time';
    const heads = [...(showRaw ? [ds.timeHeader] : []), ds.tLabel, ...ds.vars.map(v => v.name)];
    ws1.addRow(heads);
    styleRow(ws1.getRow(1), XL.head, 1, heads.length);
    ws1.getRow(1).height = 28;
    ds.t.forEach((t, i) => {
      const r = ws1.addRow([...(showRaw ? [String(ds.tRaw[i])] : []), +t.toPrecision(12), ...ds.vars.map(v => Number.isFinite(v.values[i]) ? v.values[i] : null)]);
      r.eachCell({ includeEmpty: true }, c => { c.border = XL.border; });
    });
    ws1.columns.forEach((c, i) => { c.width = Math.min(28, Math.max(12, String(heads[i]).length * 2 + 2)); });
    ws1.autoFilter = { from: 'A1', to: `${colL(heads.length - 1)}1` };
    const tColIdx = showRaw ? 1 : 0; // 0부터 센 경과시간 열
    const varCol = j => colL(tColIdx + 1 + j);
    const lastRow = ds.t.length + 1;
    const rng = c => `${qs(S1)}!$${c}$2:$${c}$${lastRow}`;

    /* --- 시트2: 그래프 --- */
    const ws2 = wb.addWorksheet(S2);
    ws2.getCell('A1').value = '그래프';
    ws2.getCell('A1').font = { bold: true, size: 16 };
    ws2.getCell('A2').value = '파란 점 = 측정값, 주황 선 = 회귀 함수. 식과 정확도는 "함수설명" 시트에 있어요.';
    ws2.getCell('A2').font = { color: { argb: 'FF5F5F68' } };
    const charts = [];
    R.timeFits.forEach(({ v, fr }) => {
      if (fr.error) return;
      charts.push({
        x: fr.x, y: fr.y, line: true, fn: fr.best ? fr.best.predict : () => fr.constant,
        xLabel: ds.tLabel, yLabel: v.name, title: `${v.name} — 시간에 따른 변화`,
        subtitle: fr.best ? `${fr.best.name}, R² = ${fmtR2(fr.best.r2)}` : '변화 없음',
      });
    });
    R.pairFits.forEach(({ v, fr }) => {
      if (fr.error) return;
      charts.push({
        x: fr.x, y: fr.y, fn: fr.best ? fr.best.predict : () => fr.constant,
        xLabel: v.name, yLabel: R.target.name, title: `${v.name} → ${R.target.name}`,
        subtitle: fr.best ? `${fr.best.name}, R² = ${fmtR2(fr.best.r2)}` : '',
      });
    });
    if (R.multi && !R.multi.error) charts.push({
      x: R.multi.yh, y: R.multi.ys, fn: x => x, xLabel: '식으로 계산한 값', yLabel: `실제 ${R.target.name}`,
      title: `여러 항목으로 계산한 ${R.target.name} vs 실제`, subtitle: `R² = ${fmtR2(R.multi.r2)}`, fitLabel: '완전히 일치하는 선',
    });
    charts.forEach((spec, k) => {
      const id = wb.addImage({ base64: chartPNG(spec), extension: 'png' });
      ws2.addImage(id, { tl: { col: (k % 2) * 10 + 0.2, row: 3 + Math.floor(k / 2) * 20 }, ext: { width: 620, height: 349 } });
    });

    /* --- 시트3: 함수설명 --- */
    const ws3 = wb.addWorksheet(S3);
    ws3.columns = [{ width: 22 }, { width: 18 }, { width: 14 }, { width: 46 }, { width: 11 }, { width: 16 }, { width: 50 }, { width: 13 }, { width: 16 }];
    let r = 1;
    const put = (vals, style, opts = {}) => {
      const row = ws3.getRow(r);
      vals.forEach((v, i) => { if (v !== undefined) row.getCell(i + 1).value = v; });
      if (style) styleRow(row, style, 1, opts.to || vals.length);
      else if (opts.border) for (let c = 1; c <= vals.length; c++) row.getCell(c).border = XL.border;
      if (opts.wrap) row.eachCell(c => { c.alignment = { wrapText: true, vertical: 'top' }; });
      r++; return row;
    };
    const title = text => { const row = put([text]); row.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1D5FA8' } }; row.height = 22; };
    const note = text => { const row = put([text]); row.getCell(1).font = { color: { argb: 'FF5F5F68' } }; };

    const t0 = ws3.getRow(r); t0.getCell(1).value = '데이터 분석 결과'; t0.getCell(1).font = { bold: true, size: 18 }; t0.height = 28; r++;
    note(`분석일: ${R.at.toLocaleString('ko-KR')} · 측정값 ${ds.t.length}개 · 항목 ${ds.vars.length}개 · 시간 기준: ${ds.tLabel}`);
    note('노란 칸에 값을 넣으면 옆 칸에서 함수로 계산한 값이 바로 나와요.');
    r++;

    title('1. 읽는 법');
    [
      ['정확도 (R²)', '식이 실제 값을 얼마나 잘 설명하는지. 1이면 완벽, 0.9 이상 매우 좋음, 0.7 이상 좋음, 0.4 미만은 잘 안 맞음.'],
      ['상관계수 (r)', '두 항목이 같이 움직이는 정도(−1 ~ 1). +는 같이 오름, −는 반대로 움직임. 관계가 있다고 원인이라는 뜻은 아님.'],
      ['오차 (RMSE)', '식으로 계산한 값이 실제와 평균적으로 얼마나 다른지. 원래 값과 같은 단위. 작을수록 좋음.'],
      ['t', ds.tLabel + (ds.kind === 'time' ? ' — 첫 측정 시각을 0으로 한 시간' : '')],
      ['함수 고르는 방법', '직선·지수·로그·거듭제곱·2차·3차 함수를 모두 계산한 뒤, 정확도가 비슷하면(0.01 이내) 가장 단순한 함수를 골랐어요.'],
    ].forEach(([a, b]) => { const row = put([a, b]); row.getCell(1).font = { bold: true }; ws3.mergeCells(r - 1, 2, r - 1, 7); row.getCell(2).alignment = { wrapText: true }; row.height = 30; });
    r++;

    const fitHeader = ['항목(y)', '기준(x)', '함수 종류', '식', '정확도 R²', '평가', '해석', 'x 값 넣기', '계산된 y'];
    const fitRow = (yName, xName, fr, says, xDefault, xSym) => {
      if (fr.error || fr.constant != null) {
        put([yName, xName, fr.error ? '-' : '상수', fr.error ? fr.error : `y = ${fr.constant}`, '', '', says], null, { border: true, wrap: true });
        return;
      }
      const f = fr.best;
      const row = put([yName, xName, f.name, formulaTextX(f, xSym), +fmtR2(f.r2), quality(f.r2).label, says, +xDefault.toPrecision(6)], null, { border: true, wrap: true });
      const xc = `H${r - 1}`;
      row.getCell(8).fill = XL.input.fill;
      row.getCell(9).value = { formula: excelFormula(f, xc), result: f.predict(xDefault) };
      row.getCell(9).border = XL.border; row.getCell(9).numFmt = '0.####';
      row.getCell(5).numFmt = '0.000';
    };

    title('2. 시간에 따른 변화 (t = ' + ds.tLabel + ')');
    put(fitHeader, XL.head);
    R.timeFits.forEach(({ v, fr }) => fitRow(v.name, ds.tLabel, fr, trendSentence(v.name, fr, ds.tLabel, R.unitWord), fr.x ? (Math.max(...fr.x) + (fr.x.length > 1 ? fr.x[fr.x.length - 1] - fr.x[fr.x.length - 2] : 1)) : 0, 't'));
    note('"x 값 넣기"에는 마지막 측정 다음 시점을 미리 넣어 두었어요 (다음 값 예측). 측정 범위를 많이 벗어나면 예측이 부정확해져요.');
    r++;

    if (R.pairFits.length) {
      title(`3. ${R.target.name}에 영향을 주는 항목 (x = 각 항목)`);
      put(fitHeader, XL.head);
      R.pairFits.forEach(({ v, fr, r: rr }) => fitRow(R.target.name, v.name, fr,
        Number.isFinite(rr) ? `상관계수 r = ${fmt(rr, 2)}: ${corrWords(rr).strength} 관계. ${corrWords(rr).text}.` : '',
        fr.x ? mean(fr.x) : 0, 'x'));
      note('"x 값 넣기"에는 그 항목의 평균값을 넣어 두었어요.');
      r++;
    }

    if (ds.vars.length >= 2) {
      title('4. 항목끼리의 관계 (상관계수 r)');
      put(['', ...ds.vars.map(v => v.name)], XL.head);
      ds.vars.forEach((a, i) => {
        const row = put([a.name, ...ds.vars.map((b, j) => ({ formula: `CORREL(${rng(varCol(i))},${rng(varCol(j))})`, result: +(R.corr[i][j].r || 0).toFixed(6) }))], null, { border: true });
        row.getCell(1).font = { bold: true };
        ds.vars.forEach((b, j) => {
          const c = row.getCell(j + 2), rv = R.corr[i][j].r;
          c.numFmt = '0.00';
          if (i !== j && Number.isFinite(rv)) {
            const a2 = Math.abs(rv);
            const base = rv >= 0 ? [42, 120, 214] : [227, 73, 72];
            const mix = base.map(ch => Math.round(255 - (255 - ch) * a2 * 0.6));
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + mix.map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase() } };
          }
        });
      });
      for (let i = 0; i < ds.vars.length; i++) for (let j = i + 1; j < ds.vars.length; j++) {
        const rv = R.corr[i][j].r, w = corrWords(rv);
        note(`· ${ds.vars[i].name} ↔ ${ds.vars[j].name}: ${w.strength} 관계 (r = ${Number.isFinite(rv) ? fmt(rv, 2) : '-'}). ${w.text}.`);
      }
      note('표의 값은 엑셀 CORREL 수식이라 "순시값" 시트를 고치면 바로 다시 계산돼요.');
      r++;
    }

    if (R.multi) {
      title(`5. 여러 항목으로 ${R.target.name} 계산하기 (다중 선형 회귀)`);
      if (R.multi.error) note(R.multi.error);
      else {
        const M = R.multi;
        note(`${M.yName} = ` + joinTerms([[M.b0, ''], ...M.terms.map(t => [t.coef, t.name])], fmtX).replace(/−/g, '-'));
        note(`정확도 R² = ${fmtR2(M.r2)} (${quality(M.r2).label}) · 오차 RMSE = ${fmtX(M.rmse)} · 측정값 ${M.n}개 사용`);
        put(['항목', '계수 (1 늘면)', '영향 크기', '값 넣기'], XL.head);
        const startR = r;
        put(['(기본값)', +num(M.b0), '', ''], null, { border: true });
        const sorted = M.terms;
        sorted.forEach(t => {
          const row = put([t.name, +num(t.coef), +Math.abs(t.beta).toFixed(4), +t.mean.toPrecision(6)], null, { border: true });
          row.getCell(4).fill = XL.input.fill;
        });
        const endR = r - 1;
        const row = put([`계산된 ${M.yName}`, '', '', ''], XL.sub);
        row.getCell(4).value = { formula: `B${startR}+SUMPRODUCT(B${startR + 1}:B${endR},D${startR + 1}:D${endR})`, result: M.b0 + sum(M.terms.map(t => t.coef * t.mean)) };
        row.getCell(4).numFmt = '0.####';
        note('노란 칸(값 넣기)에 각 항목 값을 넣으면 맨 아래에 계산된 값이 나와요. 처음엔 각 항목의 평균이 들어 있어요.');
        note('영향 크기: 단위를 맞춰 비교한 값(표준화 계수). 클수록 결과에 미치는 영향이 커요.');
      }
      r++;
    }

    title('6. 기본 통계 (엑셀 수식)');
    put(['항목', '개수', '평균', '최소', '최대', '표준편차'], XL.head);
    ds.vars.forEach((v, j) => {
      const c = rng(varCol(j));
      const vals = v.values.filter(Number.isFinite);
      const row = put([v.name,
        { formula: `COUNT(${c})`, result: vals.length },
        { formula: `AVERAGE(${c})`, result: vals.length ? mean(vals) : 0 },
        { formula: `MIN(${c})`, result: vals.length ? Math.min(...vals) : 0 },
        { formula: `MAX(${c})`, result: vals.length ? Math.max(...vals) : 0 },
        { formula: `STDEV(${c})`, result: vals.length > 1 ? sd(vals) : 0 },
      ], null, { border: true });
      for (let k = 3; k <= 6; k++) row.getCell(k).numFmt = '0.####';
    });
    r++;

    title('7. 함수 비교 (시간에 따른 변화)');
    put(['항목', '함수', '식', '정확도 R²', '오차 RMSE'], XL.head);
    R.timeFits.forEach(({ v, fr }) => (fr.all || []).forEach(f => {
      const row = put([v.name, f.name + (f === fr.best ? ' (선택)' : ''), formulaTextX(f, 't'), +fmtR2(f.r2), +f.rmse.toPrecision(4)], null, { border: true });
      if (f === fr.best) row.getCell(2).font = { bold: true };
    }));

    ws3.views = [{ showGridLines: false }];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const d = R.at, p2 = n => String(n).padStart(2, '0');
    const name = `데이터분석_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.xlsx`;
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click();
    setTimeout(() => a.remove(), 1000);
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    toast('엑셀 파일을 저장했어요');
  } catch (e) {
    console.error(e);
    toast('엑셀을 만들지 못했어요: ' + e.message, 4000);
  } finally {
    updateButton();
  }
}

/* ---------------- 9. 파일·예시·시작 ---------------- */

function cellToText(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    const p = n => String(n).padStart(2, '0');
    const hms = `${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}`;
    return v.getUTCFullYear() < 1901 ? hms : `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())} ${hms}`;
  }
  if (typeof v === 'object') {
    if ('result' in v) return cellToText(v.result);
    if (v.richText) return v.richText.map(t => t.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v).replace(/[\t\n\r]+/g, ' ');
}

$('file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    if (/\.xlsx$/i.test(f.name)) {
      setMsg('엑셀 파일을 읽는 중…');
      const ExcelJS = await getExcelJS();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets.find(w => w.actualRowCount > 1) || wb.worksheets[0];
      const lines = [];
      ws.eachRow({ includeEmpty: false }, row => {
        const vals = [];
        for (let c = 1; c <= ws.columnCount; c++) vals.push(cellToText(row.getCell(c).value));
        if (vals.some(v => v !== '')) lines.push(vals.join('\t'));
      });
      input.value = lines.join('\n');
      if (wb.worksheets.length > 1) toast(`첫 번째 표("${ws.name}") 시트를 읽었어요`);
    } else if (/\.xls$/i.test(f.name)) {
      setMsg('옛날 엑셀(.xls)은 못 읽어요. .xlsx로 저장하거나 표를 복사해서 붙여넣어 주세요.', 'err'); return;
    } else {
      const buf = await f.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch { text = new TextDecoder('euc-kr').decode(buf); } // 한글 윈도우 엑셀 CSV
      input.value = text.replace(/^﻿/, '');
    }
    onInput();
  } catch (err) {
    console.error(err);
    setMsg('파일을 읽지 못했어요. 표를 복사해서 붙여넣어 보세요.', 'err');
  }
};

function sampleData() {
  // 냉방 중인 실내: 2시간 동안 5분 간격 측정 (항상 같은 값이 나오도록 고정 난수)
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5); };
  const lines = ['시각\t외기온도(°C)\t실내온도(°C)\t습도(%)\t냉방전력(kW)'];
  for (let i = 0; i <= 24; i++) {
    const m = i * 5;
    const hh = 13 + Math.floor(m / 60), mm = m % 60;
    const out = 30 + 3 * Math.sin(m / 120 * Math.PI) + rnd() * 0.4;
    const indoor = 23 + 5 * Math.exp(-m / 30) + rnd() * 0.3;
    const power = 1.2 + 0.18 * (out - 28) + 0.35 * (indoor - 23) + rnd() * 0.12;
    const hum = 68 - 12 * (1 - Math.exp(-m / 40)) + rnd() * 1.2;
    lines.push([`${hh}:${String(mm).padStart(2, '0')}`, out.toFixed(1), indoor.toFixed(1), hum.toFixed(0), power.toFixed(2)].join('\t'));
  }
  return lines.join('\n');
}

$('sample-btn').onclick = () => { input.value = sampleData(); state.table = null; onInput(); toast('예시: 냉방 중인 방을 2시간 동안 5분마다 잰 값이에요'); };
$('clear-btn').onclick = () => { input.value = ''; state.table = null; store.set('cfg', null); onInput(); input.focus(); };

let inputTimer;
input.addEventListener('input', () => { clearTimeout(inputTimer); inputTimer = setTimeout(onInput, 250); });

// 이전에 넣었던 데이터 복원
input.value = store.get('text', '');
if (input.value) onInput();
