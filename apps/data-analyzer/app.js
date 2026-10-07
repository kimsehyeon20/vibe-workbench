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

/* ---------------- 1. 입력 읽기: reader.js (Reader) ---------------- */

const { parseText, toNumber, parseTimeCell, columnKind, buildTable, guessTimeCol, buildDataset, prepareGrid, transpose, UNITS, TIME_NAME_RE } = Reader;

/* ---------------- 2. 통계 계산: regression.js (Regression) ---------------- */

const { sum, mean, sd, bestFit, pearson, multiRegression } = Regression;
const SUP = { 2: '²', 3: '³' };

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
    ? { bg: '#1b1b1e', text: '#f2f2f4', text2: '#a8a8b2', grid: 'rgba(255,255,255,.08)', axis: 'rgba(255,255,255,.25)', point: '#3987e5', fit: '#d95926', ring: '#1b1b1e', warn: '#e66767' }
    : { bg: '#ffffff', text: '#1b1b1f', text2: '#5f5f68', grid: 'rgba(20,20,30,.08)', axis: 'rgba(20,20,30,.3)', point: '#2a78d6', fit: '#eb6834', ring: '#ffffff', warn: '#e34948' };
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

  const pts = spec.x.map((x, i) => [x, spec.y[i], i]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  // 여러 개의 가는 선 (예: 강번별 곡선)
  const lines = (spec.lines || []).map(l => ({ ...l, p: l.x.map((xv, i) => [xv, l.y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)) })).filter(l => l.p.length);
  if (!pts.length && !lines.length) return null;
  const linePts = lines.flatMap(l => l.p);
  const xs = [...pts.map(p => p[0]), ...linePts.map(p => p[0])], ys = [...pts.map(p => p[1]), ...linePts.map(p => p[1])];
  let xmin = Math.min(...xs), xmax = Math.max(...xs);
  const curve = [], bx = Array.from({ length: 161 }, (_, i) => xmin + (xmax - xmin) * i / 160);
  if (spec.fn) for (const xv of bx) { const yv = spec.fn(xv); if (Number.isFinite(yv)) curve.push([xv, yv]); }
  // 곡선이 데이터 범위를 크게 벗어나면 축은 데이터 기준으로
  const yr = Math.max(...ys) - Math.min(...ys) || 1;
  const band = [];
  if (spec.band) for (const xv of bx) { const [lo, hi] = spec.band(xv); if (Number.isFinite(lo) && Number.isFinite(hi)) band.push([xv, lo, hi]); }
  const inView = v => v > Math.min(...ys) - yr * 0.5 && v < Math.max(...ys) + yr * 0.5;
  const ov = spec.overlay ? spec.overlay.x.map((xv, i) => [xv, spec.overlay.y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)) : [];
  const cys = [...curve.map(p => p[1]), ...band.flatMap(b => [b[1], b[2]]), ...ov.map(p => p[1])].filter(inView);
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
  if (band.length) {
    ctx.fillStyle = th.fit; ctx.globalAlpha = .13; ctx.beginPath();
    band.forEach(([a, lo], i) => i ? ctx.lineTo(px(a), py(lo)) : ctx.moveTo(px(a), py(lo)));
    [...band].reverse().forEach(([a, , hi]) => ctx.lineTo(px(a), py(hi)));
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  }
  for (const l of lines) {
    ctx.strokeStyle = l.flag ? th.warn : th.point; ctx.globalAlpha = l.flag ? .8 : .28; ctx.lineWidth = l.flag ? 1.6 : 1.1; ctx.lineJoin = 'round';
    ctx.beginPath(); l.p.forEach(([a, b], i) => i ? ctx.lineTo(px(a), py(b)) : ctx.moveTo(px(a), py(b))); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (spec.line) {
    ctx.strokeStyle = th.point; ctx.globalAlpha = .35; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath(); sorted.forEach(([a, b], i) => i ? ctx.lineTo(px(a), py(b)) : ctx.moveTo(px(a), py(b))); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const r = pts.length > 400 ? 2 : pts.length > 120 ? 2.6 : 3.4;
  ctx.fillStyle = th.point; ctx.strokeStyle = th.ring; ctx.lineWidth = 1.2;
  if (!spec.hidePoints) for (const [a, b, i] of pts) {
    ctx.fillStyle = spec.flagged && spec.flagged[i] ? th.warn : th.point;
    ctx.beginPath(); ctx.arc(px(a), py(b), r * (opt.markScale || 1), 0, Math.PI * 2); ctx.fill(); if (pts.length < 400) ctx.stroke();
  }
  if (curve.length) {
    ctx.strokeStyle = th.fit; ctx.lineWidth = 2 * (opt.markScale || 1); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); curve.forEach(([a, b], i) => i ? ctx.lineTo(px(a), py(b)) : ctx.moveTo(px(a), py(b))); ctx.stroke();
  }
  if (ov.length) {
    ctx.strokeStyle = th.fit; ctx.lineWidth = 2 * (opt.markScale || 1); ctx.lineJoin = 'round';
    ctx.beginPath(); ov.forEach(([a, b], i) => i ? ctx.lineTo(px(a), py(b)) : ctx.moveTo(px(a), py(b))); ctx.stroke();
  }
  ctx.restore();

  if (opt.legend) {
    ctx.font = font(400); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const items = [...(spec.hidePoints ? [] : [[spec.pointLabel || '측정값', th.point, 'dot']]), ...(lines.length ? [[spec.linesLabel || '각 강번', th.point, 'line']] : []), ...(lines.some(l => l.flag) ? [['이상 강번', th.warn, 'line']] : []), ...(spec.fn ? [[spec.fitLabel || '회귀 함수', th.fit, 'line']] : []), ...(ov.length ? [[spec.overlayLabel || '예측', th.fit, 'line']] : []), ...(band.length ? [[spec.bandLabel || '95% 예측 범위', th.fit, 'band']] : [])];
    let lx = L + pw - sum(items.map(([t]) => ctx.measureText(t).width + 34)), ly = spec.title ? 10 + fs / 2 : top + 8;
    for (const [t, c, k] of items) {
      ctx.fillStyle = c;
      if (k === 'dot') { ctx.beginPath(); ctx.arc(lx + 6, ly, 4 * (opt.markScale || 1), 0, Math.PI * 2); ctx.fill(); }
      else if (k === 'band') { ctx.globalAlpha = .2; ctx.fillRect(lx, ly - 6, 14, 12); ctx.globalAlpha = 1; }
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
    if (spec.tip) tip.innerHTML = spec.tip(best[2], best);
    else tip.innerHTML = `${esc(spec.xLabel)}: <b>${fmt(best[0], 5)}</b><br>${esc(spec.yLabel)}: <b>${fmt(best[1], 5)}</b>` +
      (Number.isFinite(fx) ? `<br>함수 계산값: ${fmt(fx, 5)}` : '') +
      (spec.band ? (([lo, hi]) => Number.isFinite(lo) ? `<br>${esc(spec.bandLabel || '95% 범위')}: ${fmt(lo, 4)} ~ ${fmt(hi, 4)}` : '')(spec.band(best[0])) : '');
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
  table: null, prep: null, sheets: null, sheetIdx: 0,
  layout: store.get('layout', 'auto'),
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
  const prep = prepareGrid(parseText(input.value), state.layout);
  state.prep = prep;
  const rows = prep.rows;
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
  const dir = prep.layout === 'rows' ? '가로 표(항목이 행)' : '세로 표(항목이 열)';
  setMsg(`${dir}로 읽었어요: 항목 ${tb.headers.length}개 · 각각 값 ${tb.body.length}개${tb.hasHeader ? '' : ' (이름이 없어서 항목1, 항목2…로 불러요)'}.`, numCols ? 'ok' : 'err');
  renderSetup();
}

function saveCfg() {
  if (state.table) store.set('cfg', { headers: state.table.headers.join('\u0001'), cfg: state.cfg });
}

function renderSetup() {
  const tb = state.table, cfg = state.cfg;
  $('setup').hidden = false;

  const ls = $('layout');
  ls.value = state.layout;
  ls.options[0].textContent = `자동 (지금: ${state.prep.layout === 'rows' ? '가로 표로 읽음' : '세로 표로 읽음'})`;
  const multiSheet = !!(state.sheets && state.sheets.length > 1);
  $('sheet-field').hidden = !multiSheet;
  if (multiSheet) {
    const ss = $('sheet'); ss.innerHTML = '';
    state.sheets.forEach((sh, i) => ss.append(el('option', { value: String(i), text: sh.name })));
    ss.value = String(state.sheetIdx || 0);
  }
  $('prep-notes').textContent = state.prep.notes.join(' · ');

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
$('layout').onchange = e => { state.layout = e.target.value; store.set('layout', state.layout); state.table = null; onInput(); };
$('sheet').onchange = e => {
  state.sheetIdx = +e.target.value; input.value = state.sheets[state.sheetIdx].text;
  state.table = null; state.layout = 'auto'; store.set('layout', 'auto'); onInput();
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

  const ov = state.cfg.override || {};
  const timeFits = ds.vars.map(v => ({ v, key: `t:${v.col}`, fr: bestFit(ds.t, v.values, { validate: 'tail', prefer: ov[`t:${v.col}`] }) }));
  const corr = ds.vars.map(a => ds.vars.map(b => pearson(a.values, b.values)));
  const target = ds.vars.find(v => v.col === state.cfg.target) || ds.vars[ds.vars.length - 1];
  const others = ds.vars.filter(v => v !== target);
  const pairFits = others.map(v => {
    const key = `p:${v.col}:${target.col}`;
    return { v, key, fr: bestFit(v.values, target.values, { validate: 'spread', prefer: ov[key] }), r: pearson(v.values, target.values).r };
  });
  const ex = new Set(state.cfg.multiExclude || []);
  const multiPreds = [
    ...others.filter(v => !ex.has(v.col)),
    ...(state.cfg.multiTime ? [{ name: ds.tLabel, values: ds.t, col: 'time' }] : []),
  ];
  const multi = !others.length ? null : multiPreds.length >= 2 ? multiRegression(target.name, target.values, multiPreds)
    : { error: '함께 쓸 항목을 2개 이상 골라주세요 (시간도 넣을 수 있어요).' };

  state.result = { ds, unitWord, timeFits, corr, target, others, pairFits, multi, multiPreds, at: new Date() };
  renderResults();
  updateButton();
}

function badge(r2) { const q = quality(r2); return el('span', { class: `badge ${q.cls}`, text: `정확도 ${fmtR2(r2)} · ${q.label}` }); }

const VALID_WORD = { tail: '뒤쪽 20%를 숨기고 식을 만든 뒤 숨긴 값을 맞혀보니', spread: '5개 중 1개를 숨기고 식을 만든 뒤 숨긴 값을 맞혀보니' };

function validationText(v) {
  if (!v) return '';
  const warn = v.rmse > v.trainRmse * 2 && v.rmse > 0;
  return `검증: ${VALID_WORD[v.mode]} 평균 오차 ${fmt(v.rmse, 3)} (식을 만들 때 오차 ${fmt(v.trainRmse, 3)}), 숨긴 값 ${v.nTest}개 중 ${Math.round(v.coverage * v.nTest)}개가 예측 범위 안에 들어왔어요.` +
    (warn ? ` ⚠ 새 값을 맞힐 때 오차가 꽤 커져요. ${v.mode === 'tail' ? '측정 범위 밖(미래) 예측은 조심하세요.' : '다른 함수도 비교해보세요.'}` : '');
}

// 값 넣어서 예측해보기
function predictBox(model, xLabel, x0, xUnitHint) {
  const box = el('div', { class: 'predict' });
  const inp = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: String(+x0.toPrecision(6)), 'aria-label': xLabel });
  const out = el('p', { class: 'predict-out' });
  const upd = () => {
    const x = toNumber(inp.value);
    if (!Number.isFinite(x)) { out.textContent = '숫자를 넣어주세요'; return; }
    const y = model.predict(x), [lo, hi] = model.interval(x);
    if (!Number.isFinite(y)) { out.textContent = '이 값으로는 계산할 수 없어요 (로그·거듭제곱 함수는 0보다 큰 값만 돼요)'; return; }
    const outside = x < model.xMin || x > model.xMax;
    out.innerHTML = `예측값 <b>${fmt(y, 5)}</b>` + (Number.isFinite(lo) ? ` <span class="range">95% 범위 ${fmt(lo, 4)} ~ ${fmt(hi, 4)}</span>` : '') +
      (outside ? `<br><span class="warn">⚠ 측정한 범위(${fmt(model.xMin)} ~ ${fmt(model.xMax)}) 밖이라 덜 정확해요</span>` : '');
  };
  inp.addEventListener('input', upd);
  box.append(el('label', {}, el('span', { text: `${xLabel}${xUnitHint || ''}` }), inp), out);
  upd();
  return box;
}

/* ---- 회귀 상세 통계 ---- */

const fmtP = p => (!Number.isFinite(p) ? '-' : p < 0.001 ? '<0.001' : p.toFixed(3));
const sigMark = p => (!Number.isFinite(p) ? '' : p < 0.05 ? '✓ 의미 있음' : '△ 우연일 수 있음');

// 잔차 진단을 쉬운 문장으로: [{ ok: true|false|null, text }]
function diagnosis(det, { orderWord = '시간 순서', isMulti = false, xLabel = 'x' } = {}) {
  const out = [];
  const a = det.anova;
  out.push(a.p < 0.05
    ? { ok: true, text: `F 검정: F = ${fmt(a.F, 4)}, p ${fmtP(a.p).startsWith('<') ? fmtP(a.p) : '= ' + fmtP(a.p)} → 이 식은 우연히 맞은 게 아니에요 (기준 p < 0.05).` }
    : { ok: false, text: `F 검정: F = ${fmt(a.F, 4)}, p = ${fmtP(a.p)} → 식이 "그냥 평균"보다 낫다고 보기 어려워요.` });
  const weak = det.coefs.slice(1).filter(c => Number.isFinite(c.p) && c.p >= 0.05);
  if (weak.length) out.push({ ok: false, text: `p값이 0.05 이상인 항(${weak.map(c => c.name).join(', ')})은 없어도 정확도가 비슷할 수 있어요. ${isMulti ? '그 항목을 빼고 다시 계산해 보세요.' : '더 단순한 함수를 고려해 보세요.'}` });
  if (Number.isFinite(det.dw)) {
    if (det.dw < 1.5) out.push({ ok: false, text: `더빈-왓슨 ${fmt(det.dw, 3)}: ${orderWord}대로 오차가 비슷하게 이어져요(자기상관). 식이 놓친 흐름이 있거나, 예측 범위가 실제보다 좁을 수 있어요.` });
    else if (det.dw > 2.5) out.push({ ok: false, text: `더빈-왓슨 ${fmt(det.dw, 3)}: ${orderWord}대로 오차가 번갈아 튀어요. 측정 방식에 규칙적인 흔들림이 있는지 확인해 보세요.` });
    else out.push({ ok: true, text: `더빈-왓슨 ${fmt(det.dw, 3)}: ${orderWord}대로 오차가 서로 독립적이에요 (기준 1.5 ~ 2.5).` });
  }
  out.push(det.jbP < 0.05
    ? { ok: false, text: `정규성(자크-베라) p = ${fmtP(det.jbP)}: 오차 분포가 한쪽으로 치우쳤거나 튀는 값이 있어요. p값·예측 범위는 참고용으로 보세요.` }
    : { ok: true, text: `정규성(자크-베라) p = ${fmtP(det.jbP)}: 오차가 고르게 퍼져 있어요.` });
  const pts = det.points.map((p, i) => ({ ...p, i }));
  const outl = pts.filter(p => Math.abs(p.stud) > 2.5).sort((a, b) => Math.abs(b.stud) - Math.abs(a.stud)).slice(0, 5);
  if (outl.length) out.push({ ok: false, text: `튀는 값 ${outl.length}개: ` + outl.map(p => `${isMulti ? `${p.row + 1}번째 값` : `${xLabel} ${fmt(p.x, 4)}`}(실제 ${fmt(p.y, 4)}, 식 ${fmt(p.fit, 4)})`).join(', ') + '. 측정 실수인지 확인해 보세요.' });
  else out.push({ ok: true, text: '크게 튀는 값(표준화 잔차 2.5 초과)이 없어요.' });
  const n = det.points.length;
  const infl = pts.filter(p => p.cook > Math.max(4 / n, 0.5)).sort((a, b) => b.cook - a.cook).slice(0, 3);
  if (infl.length) out.push({ ok: null, text: `식에 영향이 큰 값: ` + infl.map(p => `${isMulti ? `${p.row + 1}번째 값` : `${xLabel} ${fmt(p.x, 4)}`}(쿡의 거리 ${fmt(p.cook, 2)})`).join(', ') + '. 이 값 하나로 식이 크게 바뀔 수 있어요.' });
  if (isMulti) {
    const hv = det.coefs.slice(1).filter(c => c.vif > 5);
    out.push(hv.length
      ? { ok: false, text: `다중공선성: ${hv.map(c => `${c.name}(VIF ${fmt(c.vif, 3)})`).join(', ')}은(는) 다른 항목과 거의 같이 움직여서 계수가 불안정해요. 하나를 빼보세요 (기준 VIF < 5).` }
      : { ok: true, text: '다중공선성: 항목끼리 겹치는 정도가 괜찮아요 (모든 VIF < 5).' });
  }
  if (det.space === 'ln(y)') out.push({ ok: null, text: '이 함수는 로그를 취하면 직선이 되므로, 검정은 ln(y) 기준으로 했어요.' });
  return out;
}

function statsBlock(det, model, { orderWord, isMulti, xLabel, residX } = {}) {
  const box = el('div', { class: 'stats' });
  // 계수 표
  const t = el('table', { class: 'stat-table' }, el('tr', {}, ...['항', '계수', '표준오차', 't', 'p값', '95% 신뢰구간', ...(isMulti ? ['VIF'] : []), '판정'].map(h => el('th', { text: h }))));
  det.coefs.forEach(c => t.append(el('tr', {},
    el('td', { text: c.name }), el('td', { text: fmt(c.est, 5) }), el('td', { text: fmt(c.se, 3) }),
    el('td', { text: Number.isFinite(c.t) ? fmt(c.t, 3) : '-' }), el('td', { text: fmtP(c.p) }),
    el('td', { text: `${fmt(c.lo, 4)} ~ ${fmt(c.hi, 4)}` }),
    ...(isMulti ? [el('td', { text: c.vif != null ? fmt(c.vif, 3) : '' })] : []),
    el('td', { class: c.p < 0.05 ? 'ok' : 'meh', text: sigMark(c.p) }))));
  box.append(el('p', { class: 'mini-title', text: '계수 검정' }), el('div', { class: 'table-scroll' }, t));
  // 모형 요약
  const a = det.anova;
  const sum2 = el('table', { class: 'stat-table kv' });
  [
    ['결정계수 R²', fmtR2(model.r2)], ['수정 R²', fmtR2(model.adj)], ['오차 RMSE', fmt(model.rmse, 4)],
    ['F (p값)', `${fmt(a.F, 4)} (${fmtP(a.p)})`], ['AIC / BIC', `${fmt(model.aic, 4)} / ${fmt(model.bic, 4)}`],
    ['더빈-왓슨', fmt(det.dw, 3)], ['자료 수 / 자유도', `${det.n} / ${det.df}`],
  ].forEach(([k, v]) => sum2.append(el('tr', {}, el('th', { text: k }), el('td', { text: v }))));
  box.append(el('p', { class: 'mini-title', text: '모형 요약' }), el('div', { class: 'table-scroll' }, sum2));
  // 분산분석표
  const an = el('table', { class: 'stat-table' }, el('tr', {}, ...['요인', '제곱합', '자유도', '평균제곱', 'F', 'p값'].map(h => el('th', { text: h }))));
  an.append(el('tr', {}, el('td', { text: '회귀' }), el('td', { text: fmt(a.ssr, 5) }), el('td', { text: String(a.dfR) }), el('td', { text: fmt(a.ssr / a.dfR, 5) }), el('td', { text: fmt(a.F, 4) }), el('td', { text: fmtP(a.p) })));
  an.append(el('tr', {}, el('td', { text: '오차' }), el('td', { text: fmt(a.sse, 5) }), el('td', { text: String(a.dfE) }), el('td', { text: fmt(a.sse / a.dfE, 5) }), el('td', { text: '' }), el('td', { text: '' })));
  an.append(el('tr', {}, el('td', { text: '전체' }), el('td', { text: fmt(a.sst, 5) }), el('td', { text: String(a.dfR + a.dfE) }), el('td', { text: '' }), el('td', { text: '' }), el('td', { text: '' })));
  box.append(el('p', { class: 'mini-title', text: `분산분석표${det.space === 'ln(y)' ? ' (ln y 기준)' : ''}` }), el('div', { class: 'table-scroll' }, an));
  // 진단
  const ul = el('ul', { class: 'diag' });
  diagnosis(det, { orderWord, isMulti, xLabel }).forEach(d => ul.append(el('li', { class: d.ok === true ? 'ok' : d.ok === false ? 'bad' : '', text: d.text })));
  box.append(el('p', { class: 'mini-title', text: '잔차 진단' }), ul);
  // 잔차 그래프
  const wrap = el('div', { class: 'chart small' });
  box.append(el('p', { class: 'mini-title', text: '잔차 그래프 (실제 − 식). 0 위아래로 고르게 흩어지면 좋아요' }), wrap);
  const rx = det.points.map(p => (residX ? residX(p) : p.x));
  requestAnimationFrame(() => mountChart(wrap, { x: rx, y: det.points.map(p => p.resid), fn: () => 0, xLabel: isMulti ? '식으로 계산한 값' : xLabel, yLabel: '잔차', line: false }));
  box.append(el('p', { class: 'hint', text: 'p값: 이 항이 실제로는 0인데 우연히 이만큼 나올 확률. 0.05보다 작으면 의미 있는 항으로 봐요. 95% 신뢰구간: 진짜 계수가 들어 있을 범위.' }));
  return box;
}

function fitBlock({ title, fr, key, xLabel, yLabel, xSym, line, says, x0 }) {
  const box = el('div', { class: 'fit' });
  const h = el('h4', {}, title);
  box.append(h);
  if (fr.error) { box.append(el('p', { class: 'says', text: fr.error })); return box; }
  const best = fr.best;
  const fn = best ? best.predict : fr.constant != null ? () => fr.constant : null;
  if (best) {
    h.append(badge(best.r2));
    box.append(el('div', { class: 'formula', html: `${esc(formulaText(best, xSym))}<small>${esc(best.name)}${best !== fr.auto ? ' (직접 고름)' : ''} · ${esc(best.plain)}<br>y = ${esc(yLabel)}, ${esc(xSym)} = ${esc(xLabel)}</small>` }));
  } else {
    box.append(el('div', { class: 'formula', html: `y = ${fmt(fr.constant)}<small>값이 변하지 않아요</small>` }));
  }
  if (says) box.append(el('p', { class: 'says', text: says }));
  const th = chartTheme();
  box.append(el('div', { class: 'legend', html: `<span><i class="dot" style="background:${th.point}"></i>측정값</span>` +
    (fn ? `<span><i style="background:${th.fit}"></i>회귀 함수</span>` : '') +
    (best ? `<span><i class="band" style="background:${th.fit}"></i>95% 예측 범위</span>` : '') }));
  const wrap = el('div', { class: 'chart' });
  box.append(wrap);
  requestAnimationFrame(() => mountChart(wrap, { x: fr.x, y: fr.y, fn, band: best && best.interval, xLabel, yLabel, line }));
  if (!best) return box;
  if (best.validation) box.append(el('p', { class: 'valid', text: validationText(best.validation) }));
  box.append(predictBox(best, xLabel, x0 ?? mean(fr.x)));

  const d = el('details', { class: 'more' }, el('summary', { text: '다른 함수와 비교 · 직접 고르기' }));
  const t = el('table', {}, el('tr', {}, el('th', { text: '함수' }), el('th', { text: 'R²' }), el('th', { text: '수정 R²' }), el('th', { text: '오차' }), el('th', { text: '검증 오차' }), el('th', { text: 'AIC' })));
  const minAic = Math.min(...fr.all.map(f => f.aic));
  fr.all.forEach(f => t.append(el('tr', {}, el('td', { text: f.name + (f === best ? ' ✓' : '') }), el('td', { text: fmtR2(f.r2) }), el('td', { text: fmtR2(f.adj) }), el('td', { text: fmt(f.rmse, 3) }), el('td', { text: f.validation ? fmt(f.validation.rmse, 3) : '-' }), el('td', { text: fmt(f.aic, 4) + (f.aic === minAic ? ' ★' : '') }))));
  d.append(el('div', { class: 'table-scroll' }, t));
  const sel = el('select', { 'aria-label': '사용할 함수' });
  sel.append(el('option', { value: '', text: `자동 (${fr.auto.name})` }));
  fr.all.forEach(f => sel.append(el('option', { value: f.id, text: f.name })));
  sel.value = (state.cfg.override || {})[key] || '';
  sel.onchange = () => {
    const ov = state.cfg.override = { ...(state.cfg.override || {}) };
    if (sel.value) ov[key] = sel.value; else delete ov[key];
    saveCfg(); const y0 = scrollY; analyze(); scrollTo(0, y0);
  };
  d.append(el('label', { class: 'field' }, el('span', { text: '사용할 함수' }), sel));
  d.append(el('p', { class: 'hint', text: '자동 선택: 수정 R²가 거의 같으면(0.01 이내) 더 단순한 함수를 골라요. AIC는 정확도와 복잡도를 함께 따진 점수로 작을수록(★) 좋아요. 예측에 쓸 거라면 "검증 오차"가 작은 함수가 더 믿을 만해요. 고른 함수는 엑셀과 모델 파일에도 그대로 들어가요.' }));
  box.append(d);
  const ds2 = el('details', { class: 'more' }, el('summary', { text: '상세 통계 보기 (계수 검정 · 분산분석 · 잔차 진단)' }));
  ds2.addEventListener('toggle', () => {
    if (!ds2.open || ds2.dataset.done) return;
    ds2.dataset.done = '1';
    ds2.append(statsBlock(Regression.details(best, xSym), best, { orderWord: line ? '시간 순서' : `${xLabel} 순서`, xLabel }));
  });
  box.append(ds2);
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
  const tNext = ds.t.length > 1 ? ds.t[ds.t.length - 1] * 2 - ds.t[ds.t.length - 2] : ds.t[0];
  R.timeFits.forEach(({ v, fr, key }) => tf.append(fitBlock({
    title: v.name, fr, key, xLabel: ds.tLabel, yLabel: v.name, xSym: 't', line: true, x0: tNext,
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
  R.pairFits.forEach(({ v, fr, r, key }) => pf.append(fitBlock({
    title: `${v.name} → ${R.target.name}`, fr, key, xLabel: v.name, yLabel: R.target.name, xSym: 'x', line: false,
    says: Number.isFinite(r) ? `상관계수 r = ${fmt(r, 2)}: ${corrWords(r).strength} 관계예요. ${corrWords(r).text}.` : '',
  })));

  // 다중 회귀
  const mp = $('multi-panel'), mu = $('multi');
  mp.hidden = !R.multi; mu.innerHTML = '';
  $('multi-title').textContent = `여러 항목으로 ${R.target.name} 계산하기`;
  if (R.multi) {
    const chips = el('div', { class: 'chips' });
    const ex = new Set(state.cfg.multiExclude || []);
    const toggle = (on, fn) => { const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on) }); b.onclick = fn; return b; };
    R.others.forEach(v => {
      const b = toggle(!ex.has(v.col), () => {
        const s2 = new Set(state.cfg.multiExclude || []);
        s2.has(v.col) ? s2.delete(v.col) : s2.add(v.col);
        state.cfg.multiExclude = [...s2]; saveCfg(); const y0 = scrollY; analyze(); scrollTo(0, y0);
      });
      b.textContent = v.name; chips.append(b);
    });
    const tb2 = toggle(!!state.cfg.multiTime, () => { state.cfg.multiTime = !state.cfg.multiTime; saveCfg(); const y0 = scrollY; analyze(); scrollTo(0, y0); });
    tb2.textContent = `⏱ ${ds.tLabel}`; chips.append(tb2);
    mu.append(el('p', { class: 'mini-title', text: '함께 쓸 항목 (누르면 빼거나 넣어요)' }), chips);
  }
  if (R.multi?.error) mu.append(el('p', { class: 'says', text: R.multi.error }));
  else if (R.multi) {
    const M = R.multi;
    mu.append(el('p', { class: 'hint', text: '고른 항목을 모두 함께 써서 한 번에 계산하는 식이에요 (다중 선형 회귀).' }));
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
    // 값 넣어서 예측해보기
    const form = el('div', { class: 'predict multi' });
    const out = el('p', { class: 'predict-out' });
    const inputs = M.terms.map(t => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: String(+t.mean.toPrecision(5)), 'aria-label': t.name }));
    const upd = () => {
      const vals = inputs.map(i => toNumber(i.value));
      if (!vals.every(Number.isFinite)) { out.textContent = '모든 칸에 숫자를 넣어주세요'; return; }
      const y = M.predict(vals), [lo, hi] = M.interval(vals);
      out.innerHTML = `예측 ${esc(M.yName)} <b>${fmt(y, 5)}</b> <span class="range">95% 범위 ${fmt(lo, 4)} ~ ${fmt(hi, 4)}</span>`;
    };
    M.terms.forEach((t, j) => { inputs[j].addEventListener('input', upd); form.append(el('label', {}, el('span', { text: t.name }), inputs[j])); });
    form.append(out); upd();
    mu.append(el('p', { class: 'says', text: '값을 넣어서 예측해보기 (처음엔 각 항목의 평균이 들어 있어요)' }), form);
    const dm = el('details', { class: 'more' }, el('summary', { text: '상세 통계 보기 (계수 검정 · 분산분석 · VIF · 잔차 진단)' }));
    dm.addEventListener('toggle', () => {
      if (!dm.open || dm.dataset.done) return;
      dm.dataset.done = '1';
      dm.append(statsBlock(Regression.details(M), M, { orderWord: '시간 순서', isMulti: true }));
    });
    mu.append(dm);
  }
  renderControlSetup();
}

/* ---------------- 7-2. 운전 조작 판단 (control.js) ---------------- */

const MV_NAME_RE = /개도|밸브|valve|설정|SP\b|조작|출력|대수|rpm|댐퍼|damper|베인|vane|스트로크|열림|부하율/i;

function ctrlCfg() {
  const R = state.result, vars = R.ds.vars;
  const c = state.cfg.ctrl = { ...(state.cfg.ctrl || {}) };
  if (!vars.some(v => v.col === c.mv)) {
    const byName = vars.find(v => MV_NAME_RE.test(v.name));
    c.mv = (byName || R.target).col;
  }
  c.exclude = (c.exclude || []).filter(col => vars.some(v => v.col === col));
  c.window = c.window || 0; // 0 = 자동
  c.target = c.target || 'delta';
  return c;
}

function stepInfo(ds) {
  const d = ds.t.slice(1).map((v, i) => v - ds.t[i]).filter(v => v > 0).sort((a, b) => a - b);
  const dt = d.length ? d[d.length >> 1] : 1;
  const unit = ds.unit ? UNITS[ds.unit].label : ds.kind === 'index' ? '칸' : '';
  return { dt, unit, label: k => (ds.kind === 'index' ? `${k}칸` : `${fmt(k * dt, 3)}${unit}`) };
}

function renderControlSetup() {
  const R = state.result, ds = R.ds;
  const panel = $('ctrl-panel');
  panel.hidden = ds.vars.length < 2;
  if (panel.hidden) return;
  const c = ctrlCfg();
  const ms = $('ctrl-mv'); ms.innerHTML = '';
  ds.vars.forEach(v => ms.append(el('option', { value: String(v.col), text: v.name })));
  ms.value = String(c.mv);
  const chips = $('ctrl-inputs'); chips.innerHTML = '';
  ds.vars.filter(v => v.col !== c.mv).forEach(v => {
    const on = !c.exclude.includes(v.col);
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), text: v.name });
    b.onclick = () => { c.exclude = on ? [...c.exclude, v.col] : c.exclude.filter(x => x !== v.col); saveCfg(); renderControlSetup(); };
    chips.append(b);
  });
  const si = stepInfo(ds), n = ds.t.length;
  const ws = $('ctrl-window'); ws.innerHTML = '';
  const steps = [1, 2, 3, 5, 10, 15, 30, 60].filter(k => k <= Math.max(1, Math.floor(n / 6)));
  const auto = steps.includes(5) ? 5 : steps[steps.length - 1];
  ws.append(el('option', { value: '0', text: `자동 (${si.label(auto)})` }));
  steps.forEach(k => ws.append(el('option', { value: String(k), text: si.label(k) })));
  ws.value = String(steps.includes(c.window) ? c.window : 0);
  $('ctrl-target').value = c.target;
  renderControl(steps.includes(c.window) ? c.window : auto, si);
}

$('ctrl-mv').onchange = e => { state.cfg.ctrl.mv = +e.target.value; saveCfg(); renderControlSetup(); };
$('ctrl-window').onchange = e => { state.cfg.ctrl.window = +e.target.value; saveCfg(); renderControlSetup(); };
$('ctrl-target').onchange = e => { state.cfg.ctrl.target = e.target.value; saveCfg(); renderControlSetup(); };

const dirWord = d => (d > 0 ? '올림' : d < 0 ? '내림' : '유지');
const signed = (v, sig = 3) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), sig);
const pct = v => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '-');

function condText(F, c) {
  const name = F.defs[c.j].label;
  if (Number.isFinite(c.lo) && Number.isFinite(c.hi)) return `${fmt(c.lo, 4)} ≤ ${name} < ${fmt(c.hi, 4)}`;
  if (Number.isFinite(c.hi)) return `${name} < ${fmt(c.hi, 4)}`;
  return `${name} ≥ ${fmt(c.lo, 4)}`;
}

function ruleText(L, r) {
  const F = L.F, mv = F.mvName;
  const when = r.conds.length ? r.conds.map(c => condText(F, c)).join(' 이고 ') : '항상';
  const d = F.target === 'delta' ? r.value : NaN;
  const act = r.up >= 0.5 ? `${mv} 올림 (${pct(r.up)}의 경우)` : r.down >= 0.5 ? `${mv} 내림 (${pct(r.down)}의 경우)`
    : r.up + r.down < 0.3 ? `대체로 그대로 둠 (조작한 경우 ${pct(r.up + r.down)})` : `올림 ${pct(r.up)} · 내림 ${pct(r.down)} (판단이 엇갈림)`;
  return { when, act, avg: F.target === 'delta' ? `평균 ${signed(d)}` : `평균 ${fmt(r.value, 4)}로 맞춤`, n: r.n };
}

function renderControl(window, si) {
  const R = state.result, ds = R.ds, c = state.cfg.ctrl;
  const out = $('ctrl-out'); out.innerHTML = '';
  const series = ds.vars.map(v => ({ name: v.name, values: v.values }));
  const mvIdx = ds.vars.findIndex(v => v.col === c.mv);
  const inputs = ds.vars.map((v, i) => i).filter(i => i !== mvIdx && !c.exclude.includes(ds.vars[i].col));
  if (!inputs.length) { out.append(el('p', { class: 'says', text: '판단 근거 항목을 1개 이상 골라주세요.' })); R.control = null; return; }
  const L = Control.learn(series, { mv: mvIdx, inputs, window, target: c.target, windowLabel: si.label(window) });
  R.control = L; R.controlWindow = window;
  if (L.error) { out.append(el('p', { class: 'says', text: L.error })); return; }
  const F = L.F, mv = F.mvName, ev = L.evaluation, st = L.stats;

  out.append(el('div', { class: 'warn-card', html: '<b>운전 보조(추천)용이에요.</b> 운전자가 과거에 한 판단을 따라 하는 것이라 실수와 습관도 같이 배워요. 안전 인터록과 한계값은 별도로 두고, 자동 제어에 연결하기 전에 운전자 검토와 시운전 검증을 거쳐야 해요.' }));

  // 운전자 조작 통계
  out.append(el('p', { class: 'mini-title', text: '운전자는 어떻게 조작했나' }));
  out.append(el('p', { class: 'says', text: `${st.n}번의 시점 중 올림 ${st.up}번 · 내림 ${st.down}번 · 그대로 ${st.hold}번. 한 번에 보통 ${fmt(st.stepMedian, 3)}만큼, 가장 크게는 ${fmt(st.stepMax, 3)}만큼 바꿨어요. (${fmt(L.deadband, 3)}보다 작은 변화는 "그대로"로 봤어요)` }));

  // 검증
  if (ev) {
    const t = el('table', { class: 'stat-table' }, el('tr', {}, ...['방법', '오차', '방향 맞힘', '실제 조작 때 방향'].map(h => el('th', { text: h }))));
    [['조작 안 함 (기준)', 'base'], ['판단 규칙', 'tree'], ['선형 식', 'linear']].forEach(([name, k]) => t.append(el('tr', {},
      el('td', { text: name + (L.pick === k ? ' ✓' : '') }), el('td', { text: fmt(ev.rmse[k], 3) }), el('td', { text: pct(ev.direction[k]) }), el('td', { text: pct(ev.actedDirection[k]) }))));
    out.append(el('p', { class: 'mini-title', text: `검증: 앞 75%로 배우고 뒤 25%(${ev.nTest}개, 실제 조작 ${ev.acted}번)를 맞혀봄` }), el('div', { class: 'table-scroll' }, t));
    const best = Math.min(ev.rmse.tree, Number.isFinite(ev.rmse.linear) ? ev.rmse.linear : Infinity);
    const gain = 1 - best / ev.rmse.base;
    out.append(el('p', { class: `valid ${L.learned ? '' : 'bad'}`, text: L.learned
      ? `"조작 안 함"보다 오차가 ${pct(gain)} 작아요 → 운전자의 판단 기준을 어느 정도 배웠어요. 추천에는 ${L.pick === 'tree' ? '판단 규칙' : '선형 식'}을 써요.`
      : '"조작 안 함"과 비교해 나아진 게 거의 없어요. 판단 근거 항목이 부족하거나, 운전자가 표에 없는 정보(경보, 지시, 계획, 소리·냄새 등)를 보고 조작했을 수 있어요.' }));
    if (ev.acted < 5) out.append(el('p', { class: 'hint', text: `⚠ 검증 구간에서 실제 조작이 ${ev.acted}번뿐이라 "실제 조작 때 방향" 값은 믿기 어려워요. 더 긴 기간의 기록이 필요해요.` }));
    const wrap = el('div', { class: 'chart' });
    out.append(el('p', { class: 'says', text: `검증 구간: 실제 ${F.target === 'delta' ? '조작량' : mv}(점)과 ${L.pick === 'tree' ? '규칙' : '식'}이 판단한 값(선)` }), wrap);
    const xs = ev.series.at.map(i => ds.t[i]);
    requestAnimationFrame(() => mountChart(wrap, { x: xs, y: ev.series.truth, overlay: { x: xs, y: ev.series[L.pick] || ev.series.tree }, overlayLabel: '판단 결과', pointLabel: '실제', xLabel: ds.tLabel, yLabel: F.target === 'delta' ? `${mv} 조작량` : mv, line: false }));
  }

  // 판단 규칙
  out.append(el('p', { class: 'mini-title', text: '찾아낸 판단 규칙 (운전자의 감 → 만약 ~이면)' }));
  const ul = el('ul', { class: 'rules' });
  L.rules.forEach(r => {
    const t = ruleText(L, r);
    ul.append(el('li', { html: `<span class="if">만약 ${esc(t.when)}</span><span class="then">→ ${esc(t.act)} · ${esc(t.avg)}</span><span class="n">근거 ${t.n}건${t.n < 10 ? ' · ⚠ 근거 적음' : ''}</span>` }));
  });
  out.append(ul);
  const imp = L.tree.importance.map((v, j) => [F.defs[j].label, v]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (imp.length) out.append(el('p', { class: 'hint', text: `판단에 가장 많이 쓰인 항목: ${imp.map(([n, v]) => `${n} ${pct(v)}`).join(', ')}. 규칙의 기준값(예: 압력 4.92)은 운전자에게 맞는지 꼭 확인하세요. 우연히 생긴 조건이 섞일 수 있어요.` }));

  // 선형 식
  if (L.linear) {
    const M = L.linear.model;
    const y = F.target === 'delta' ? `${mv} 조작량` : mv;
    out.append(el('p', { class: 'mini-title', text: '선형 식 (의미 있는 항만 남김)' }));
    out.append(el('div', { class: 'formula wrap', html: `${esc(y)} = ${esc(joinTerms([[M.b0, ''], ...M.terms.map(t => [t.coef, t.name])], fmt))}<small>R² ${fmtR2(M.r2)} · p값 0.05 넘는 항은 하나씩 뺐어요. 상태는 직전 값, ${esc(F.windowLabel)} 변화는 그 사이 바뀐 양이에요.</small>` }));
  }

  // 추천
  out.append(el('p', { class: 'mini-title', text: '지금 상태를 넣으면 조작 추천' }));
  const form = el('div', { class: 'predict ctrl' });
  const used = [...new Set(F.defs.filter(d => d.key !== 'MV').map(d => d.var))];
  const last = ds.t.length - 1, back = Math.max(0, last - F.window);
  const inp = (val, label) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: Number.isFinite(val) ? String(+val.toPrecision(6)) : '', 'aria-label': label });
  const fields = {};
  used.forEach(name => {
    const v = ds.vars.find(x => x.name === name).values;
    fields[name] = { now: inp(v[last], `${name} 지금`), before: inp(v[back], `${name} ${F.windowLabel} 전`) };
    form.append(el('div', { class: 'pair-row' }, el('span', { text: name }), el('label', {}, el('small', { text: '지금' }), fields[name].now), el('label', {}, el('small', { text: `${F.windowLabel} 전` }), fields[name].before)));
  });
  const mvNow = inp(ds.vars[mvIdx].values[last], `현재 ${mv}`);
  form.append(el('div', { class: 'pair-row' }, el('span', { text: `현재 ${mv}` }), el('label', {}, el('small', { text: '지금' }), mvNow), el('span')));
  // 기본 한계: %면 0~100, 아니면 기록 범위에서 위아래로 20% 넓힌 값. 실제 설비 한계로 바꿔 넣어야 한다
  const span = st.mvMax - st.mvMin || Math.abs(st.mvMax) || 1;
  const isPct = /%/.test(mv);
  const lim = {
    min: inp(isPct ? Math.max(0, st.mvMin - span * 0.2) : st.mvMin - span * 0.2, '최소'),
    max: inp(isPct ? Math.min(100, st.mvMax + span * 0.2) : st.mvMax + span * 0.2, '최대'),
    maxStep: inp(st.stepMax, '한 번 최대'),
  };
  form.append(el('div', { class: 'pair-row limits' }, el('span', { text: '안전 한계' }),
    el('label', {}, el('small', { text: '최소' }), lim.min), el('label', {}, el('small', { text: '최대' }), lim.max), el('label', {}, el('small', { text: '한 번 최대' }), lim.maxStep)));
  const res = el('div', { class: 'rec' });
  form.append(res);
  const upd = () => {
    const stIn = { inputs: {}, mvNow: toNumber(mvNow.value) };
    used.forEach(n => { stIn.inputs[n] = { now: toNumber(fields[n].now.value), before: toNumber(fields[n].before.value) }; });
    const r = Control.recommend(L, stIn, { min: toNumber(lim.min.value), max: toNumber(lim.max.value), maxStep: toNumber(lim.maxStep.value) });
    if (r.error) { res.textContent = r.error; return; }
    const cond = r.tree.conds.map(cc => condText(F, cc)).join(' 이고 ') || '모든 경우';
    res.innerHTML = `<p class="rec-main ${r.dir > 0 ? 'up' : r.dir < 0 ? 'down' : ''}">추천: <b>${dirWord(r.dir)}</b> ${r.dir ? `${signed(r.delta)} → ${fmt(r.next, 5)}` : `(${fmt(stIn.mvNow, 5)} 유지)`}</p>` +
      `<p class="rec-why">근거 규칙: 만약 ${esc(cond)} → 이 경우 운전자는 올림 ${pct(r.tree.leaf.up)} · 내림 ${pct(r.tree.leaf.down)} (근거 ${r.tree.leaf.n}건)</p>` +
      (r.linear ? `<p class="rec-why">선형 식으로는 ${signed(r.linear.delta)} (95% 범위 ${signed(r.linear.range[0])} ~ ${signed(r.linear.range[1])})</p>` : '') +
      (r.clipped.length ? `<p class="rec-why warn">⚠ ${r.clipped.join(', ')} 한계에 걸려서 줄였어요 (원래 ${signed(r.raw)})</p>` : '');
  };
  form.querySelectorAll('input').forEach(i => i.addEventListener('input', upd));
  form.append(el('p', { class: 'hint', text: '안전 한계의 처음 값은 기록에서 정한 임시값이에요. 실제 설비의 운전 한계로 바꿔 넣으세요.' }));
  upd();
  out.append(form);
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
    ws2.getCell('A2').value = '파란 점 = 측정값, 주황 선 = 회귀 함수, 옅은 주황 띠 = 95% 예측 범위(새로 잰 값이 들어올 범위). 식과 정확도는 "함수설명" 시트에 있어요.';
    ws2.getCell('A2').font = { color: { argb: 'FF5F5F68' } };
    const charts = [];
    R.timeFits.forEach(({ v, fr }) => {
      if (fr.error) return;
      charts.push({
        x: fr.x, y: fr.y, line: true, fn: fr.best ? fr.best.predict : () => fr.constant, band: fr.best && fr.best.interval,
        xLabel: ds.tLabel, yLabel: v.name, title: `${v.name} — 시간에 따른 변화`,
        subtitle: fr.best ? `${fr.best.name}, R² = ${fmtR2(fr.best.r2)}` : '변화 없음',
      });
    });
    R.pairFits.forEach(({ v, fr }) => {
      if (fr.error) return;
      charts.push({
        x: fr.x, y: fr.y, fn: fr.best ? fr.best.predict : () => fr.constant, band: fr.best && fr.best.interval,
        xLabel: v.name, yLabel: R.target.name, title: `${v.name} → ${R.target.name}`,
        subtitle: fr.best ? `${fr.best.name}, R² = ${fmtR2(fr.best.r2)}` : '',
      });
    });
    if (R.multi && !R.multi.error) charts.push({
      x: R.multi.yh, y: R.multi.ys, fn: x => x, xLabel: '식으로 계산한 값', yLabel: `실제 ${R.target.name}`,
      title: `여러 항목으로 계산한 ${R.target.name} vs 실제`, subtitle: `R² = ${fmtR2(R.multi.r2)}`, fitLabel: '완전히 일치하는 선',
    });
    if (R.control && !R.control.error && R.control.evaluation) {
      const L = R.control, ev = L.evaluation, xs = ev.series.at.map(i => ds.t[i]);
      charts.push({
        x: xs, y: ev.series.truth, overlay: { x: xs, y: ev.series[L.pick] || ev.series.tree }, overlayLabel: '판단 결과', pointLabel: '실제 조작',
        xLabel: ds.tLabel, yLabel: L.F.target === 'delta' ? `${L.F.mvName} 조작량` : L.F.mvName,
        title: `조작 판단 검증: ${L.F.mvName}`, subtitle: `뒤 25% 구간, ${L.pick === 'tree' ? '판단 규칙' : '선형 식'}`,
      });
    }
    charts.forEach((spec, k) => {
      const id = wb.addImage({ base64: chartPNG(spec), extension: 'png' });
      ws2.addImage(id, { tl: { col: (k % 2) * 10 + 0.2, row: 3 + Math.floor(k / 2) * 20 }, ext: { width: 620, height: 349 } });
    });

    /* --- 시트3: 함수설명 --- */
    const ws3 = wb.addWorksheet(S3);
    ws3.columns = [{ width: 22 }, { width: 18 }, { width: 14 }, { width: 46 }, { width: 11 }, { width: 16 }, { width: 50 }, { width: 13 }, { width: 16 }, { width: 12 }, { width: 13 }];
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
    note('예측 앱에서 쓸 모델 파일(JSON)은 분석 화면의 "예측용 모델 파일 받기"로 따로 받을 수 있어요.');
    r++;

    title('1. 읽는 법');
    [
      ['정확도 (R²)', '식이 실제 값을 얼마나 잘 설명하는지. 1이면 완벽, 0.9 이상 매우 좋음, 0.7 이상 좋음, 0.4 미만은 잘 안 맞음.'],
      ['상관계수 (r)', '두 항목이 같이 움직이는 정도(−1 ~ 1). +는 같이 오름, −는 반대로 움직임. 관계가 있다고 원인이라는 뜻은 아님.'],
      ['오차 (RMSE)', '식으로 계산한 값이 실제와 평균적으로 얼마나 다른지. 원래 값과 같은 단위. 작을수록 좋음.'],
      ['검증 오차', '일부 값을 숨기고 나머지로 식을 만든 뒤 숨긴 값을 맞혀본 오차. 시간 변화는 뒤쪽 20%(미래), 항목 관계는 5개 중 1개를 숨김. 예측에 쓸 때는 이 값이 더 현실적인 오차.'],
      ['예측 범위 ±', '"x 값 넣기"의 처음 값에서 새로 잰 값이 약 95% 확률로 들어올 범위의 절반 폭. 예측값 ± 이 값.'],
      ['t', ds.tLabel + (ds.kind === 'time' ? ' — 첫 측정 시각을 0으로 한 시간' : '')],
      ['함수 고르는 방법', '직선·지수·로그·거듭제곱·2차·3차 함수를 모두 계산한 뒤, 정확도가 비슷하면(0.01 이내) 가장 단순한 함수를 골랐어요.'],
    ].forEach(([a, b]) => { const row = put([a, b]); row.getCell(1).font = { bold: true }; ws3.mergeCells(r - 1, 2, r - 1, 7); row.getCell(2).alignment = { wrapText: true }; row.height = 30; });
    r++;

    const fitHeader = ['항목(y)', '기준(x)', '함수 종류', '식', '정확도 R²', '평가', '해석', 'x 값 넣기', '계산된 y', '검증 오차', '예측 범위 ±'];
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
      if (f.validation) { row.getCell(10).value = +f.validation.rmse.toPrecision(4); }
      const [lo, hi] = f.interval(xDefault);
      if (Number.isFinite(lo)) row.getCell(11).value = +((hi - lo) / 2).toPrecision(4);
      row.getCell(10).border = XL.border; row.getCell(11).border = XL.border;
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

    r++;
    title('8. 회귀 상세 통계 (계수 검정 · 분산분석 · 잔차 진단)');
    note('p값 < 0.05 이면 의미 있는 항. 95% 신뢰구간 = 진짜 계수가 들어 있을 범위. 더빈-왓슨 1.5~2.5 이면 오차가 독립적. VIF < 5 이면 항목끼리 겹침이 적음.');
    const detail = (heading, model, det, opts) => {
      r++;
      const hr = put([heading]); hr.getCell(1).font = { bold: true, size: 12 };
      const isMulti = !!opts.isMulti;
      put(['항', '계수', '표준오차', 't', 'p값', '95% 하한', '95% 상한', isMulti ? 'VIF' : '', '판정'], XL.sub, { to: 9 });
      det.coefs.forEach(c => {
        const row = put([c.name, +c.est.toPrecision(10), +c.se.toPrecision(6), Number.isFinite(c.t) ? +c.t.toPrecision(5) : '-',
          Number.isFinite(c.p) ? +c.p.toPrecision(4) : '-', +c.lo.toPrecision(8), +c.hi.toPrecision(8),
          isMulti && c.vif != null ? +c.vif.toPrecision(4) : '', sigMark(c.p)], null, { border: true });
        if (Number.isFinite(c.p)) row.getCell(5).numFmt = c.p < 0.001 ? '0.00E+00' : '0.0000';
      });
      const a = det.anova;
      put(['요인', '제곱합', '자유도', '평균제곱', 'F', 'p값'], XL.sub, { to: 6 });
      const fr2 = put(['회귀', +a.ssr.toPrecision(8), a.dfR, +(a.ssr / a.dfR).toPrecision(8), +a.F.toPrecision(6), +a.p.toPrecision(4)], null, { border: true });
      fr2.getCell(6).numFmt = a.p < 0.001 ? '0.00E+00' : '0.0000';
      put(['오차', +a.sse.toPrecision(8), a.dfE, +(a.sse / a.dfE).toPrecision(8), '', ''], null, { border: true });
      put(['전체', +a.sst.toPrecision(8), a.dfR + a.dfE, '', '', ''], null, { border: true });
      put(['R²', '수정 R²', 'RMSE', 'AIC', 'BIC', '더빈-왓슨', '정규성 p', '자료 수'], XL.sub, { to: 8 });
      put([+fmtR2(model.r2), +fmtR2(model.adj), +model.rmse.toPrecision(5), +model.aic.toPrecision(6), +model.bic.toPrecision(6), +det.dw.toPrecision(4), +det.jbP.toPrecision(3), det.n], null, { border: true });
      diagnosis(det, opts).forEach(d => note(`${d.ok === true ? '✓' : d.ok === false ? '!' : '·'} ${d.text}`));
    };
    R.timeFits.forEach(({ v, fr }) => { if (fr.best) detail(`■ ${v.name} = f(t) · ${fr.best.name}`, fr.best, Regression.details(fr.best, 't'), { orderWord: '시간 순서', xLabel: ds.tLabel }); });
    R.pairFits.forEach(({ v, fr }) => { if (fr.best) detail(`■ ${R.target.name} = f(${v.name}) · ${fr.best.name}`, fr.best, Regression.details(fr.best, 'x'), { orderWord: `${v.name} 순서`, xLabel: v.name }); });
    if (R.multi && !R.multi.error) detail(`■ ${R.target.name} = 다중 선형 회귀 (${R.multi.terms.map(t => t.name).join(', ')})`, R.multi, Regression.details(R.multi), { orderWord: '시간 순서', isMulti: true });

    const L = R.control;
    if (L && !L.error) {
      r++;
      title(`9. 운전 조작 판단: ${L.F.mvName} (운전자의 감 → 규칙·식)`);
      note('운전 보조(추천)용. 운전자의 과거 판단을 따라 하므로 실수·습관도 함께 배움. 안전 인터록·한계값은 별도로 두고, 자동 제어 연결 전 운전자 검토와 시운전 검증 필요.');
      note(`가정: 직전 상태(t−1)를 보고 다음 조작(t)을 함. 배운 대상: ${L.F.target === 'delta' ? '조작량(바꾼 양)' : '조작 값'}. 추세 = 최근 ${L.F.windowLabel} 변화.`);
      const st = L.stats;
      note(`운전자 조작: ${st.n}번 중 올림 ${st.up} · 내림 ${st.down} · 그대로 ${st.hold}. 보통 한 번에 ${fmtX(st.stepMedian)}, 최대 ${fmtX(st.stepMax)}. ${fmtX(L.deadband)} 미만 변화는 "그대로".`);
      const ev = L.evaluation;
      if (ev) {
        put(['검증 (앞 75% 학습 → 뒤 25%)', '오차 RMSE', '방향 맞힘', '실제 조작 때 방향'], XL.head);
        [['조작 안 함 (기준)', 'base'], ['판단 규칙', 'tree'], ['선형 식', 'linear']].forEach(([name, k]) => {
          const row = put([name + (L.pick === k ? ' (추천에 사용)' : ''), Number.isFinite(ev.rmse[k]) ? +ev.rmse[k].toPrecision(4) : '-', Number.isFinite(ev.direction[k]) ? ev.direction[k] : '-', Number.isFinite(ev.actedDirection[k]) ? ev.actedDirection[k] : '-'], null, { border: true });
          row.getCell(3).numFmt = '0%'; row.getCell(4).numFmt = '0%';
        });
        note(L.learned ? '→ "조작 안 함"보다 오차가 작음: 판단 기준을 어느 정도 배웠음.' : '→ "조작 안 함"보다 나아지지 않음: 표에 없는 정보로 판단했을 가능성.');
      }
      r++;
      put(['만약 (조건)', '', '', '그러면 (운전자 판단)', '올림 비율', '내림 비율', '평균', '근거 수'], XL.head);
      L.rules.forEach(rule => {
        const t = ruleText(L, rule);
        const row = put([t.when, undefined, undefined, t.act, rule.up, rule.down, +rule.value.toPrecision(4), rule.n], null, { border: true, wrap: true });
        ws3.mergeCells(r - 1, 1, r - 1, 3);
        row.getCell(5).numFmt = '0%'; row.getCell(6).numFmt = '0%';
        row.height = 32;
      });
      if (L.linear) {
        const M = L.linear.model;
        r++;
        note(`선형 식: ${L.F.target === 'delta' ? `${L.F.mvName} 조작량` : L.F.mvName} = ` + joinTerms([[M.b0, ''], ...M.terms.map(t2 => [t2.coef, t2.name])], fmtX).replace(/−/g, '-') + `   (R² ${fmtR2(M.r2)})`);
      }
    }

    ws3.views = [{ showGridLines: false }];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    download(blob, `데이터분석_${stamp(R.at)}.xlsx`);
    toast('엑셀 파일을 저장했어요');
  } catch (e) {
    console.error(e);
    toast('엑셀을 만들지 못했어요: ' + e.message, 4000);
  } finally {
    updateButton();
  }
}

/* ---------------- 8-2. 예측용 모델 파일 (JSON) ---------------- */

function stamp(d) { const p2 = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`; }

function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 30_000);
}

function buildModelBundle(R) {
  const { ds } = R;
  const single = (fr, role, yName, xName, xSym) => fr.best ? Regression.serialize(fr.best, {
    role, y: yName, x: xName, auto: fr.best === fr.auto,
    formula: formulaText(fr.best, xSym, fmtX).replace(/−/g, '-'),
    excel: '=' + excelFormula(fr.best, 'X'),
  }) : null;
  const models = [
    ...R.timeFits.map(({ v, fr }) => single(fr, 'time', v.name, ds.tLabel, 't')),
    ...R.pairFits.map(({ v, fr }) => single(fr, 'pair', R.target.name, v.name, 'x')),
  ].filter(Boolean);
  if (R.multi && !R.multi.error) models.push(Regression.serialize(R.multi, { role: 'multi' }));
  if (R.control && !R.control.error) models.push(Control.serialize(R.control, { role: 'control', windowTime: R.controlWindow }));
  return {
    format: 'data-analyzer/model', version: Regression.VERSION,
    createdAt: R.at.toISOString(),
    help: 'regression.js 의 Regression.deserialize(models[i]) 로 불러와 predict(x) / interval(x) 로 예측합니다. README.md 참고.',
    time: {
      kind: ds.kind, // 'time' = 시각/날짜, 'number' = 숫자 칸, 'index' = 줄 번호
      label: ds.tLabel, column: ds.timeHeader,
      unit: ds.unit, unitSeconds: ds.unit ? UNITS[ds.unit].sec : null,
      origin: ds.kind === 'time' ? String(ds.tRaw[0]) : null, // t = 0 인 시각
      range: [ds.t[0], ds.t[ds.t.length - 1]],
    },
    variables: ds.vars.map(v => {
      const vals = v.values.filter(Number.isFinite);
      return { name: v.name, n: vals.length, mean: vals.length ? mean(vals) : null, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null };
    }),
    target: R.target.name,
    correlation: { names: ds.vars.map(v => v.name), r: R.corr.map(row => row.map(c => (Number.isFinite(c.r) ? +c.r.toFixed(6) : null))) },
    models,
  };
}

$('model-btn').onclick = () => {
  const R = state.result; if (!R) return;
  const json = JSON.stringify(buildModelBundle(R), null, 1);
  download(new Blob([json], { type: 'application/json' }), `회귀모델_${stamp(R.at)}.json`);
  toast('모델 파일을 저장했어요');
};

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

/** 파일 하나 → [{ name, text, size }] (엑셀은 시트마다 하나). 읽을 수 없으면 오류 */
async function fileToSheets(f) {
  if (/\.xls$/i.test(f.name)) throw new Error('옛날 엑셀(.xls)은 못 읽어요. .xlsx로 저장하거나 표를 복사해서 붙여넣어 주세요.');
  if (/\.xlsx$/i.test(f.name)) {
    const ExcelJS = await getExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await f.arrayBuffer());
    return wb.worksheets.map(ws => {
      const lines = [];
      ws.eachRow({ includeEmpty: false }, row => {
        const vals = [];
        for (let c = 1; c <= ws.columnCount; c++) vals.push(cellToText(row.getCell(c).value));
        if (vals.some(v => v !== '')) lines.push(vals.join('\t'));
      });
      return { name: ws.name, text: lines.join('\n'), size: lines.length };
    }).filter(sh => sh.size > 0);
  }
  const buf = await f.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { text = new TextDecoder('euc-kr').decode(buf); } // 한글 윈도우 엑셀 CSV
  text = text.replace(/^\uFEFF/, '');
  return [{ name: f.name, text, size: text.split('\n').length }];
}

$('file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    if (/\.xls$/i.test(f.name)) { setMsg('옛날 엑셀(.xls)은 못 읽어요. .xlsx로 저장하거나 표를 복사해서 붙여넣어 주세요.', 'err'); return; }
    if (/\.xlsx$/i.test(f.name)) {
      setMsg('엑셀 파일을 읽는 중…');
      const sheets = await fileToSheets(f);
      if (!sheets.length) { setMsg('엑셀 파일에 값이 없어요.', 'err'); return; }
      state.sheets = sheets;
      state.sheetIdx = Math.max(0, sheets.findIndex(sh => sh.size > 1));
      input.value = sheets[state.sheetIdx].text;
      state.layout = 'auto'; store.set('layout', 'auto');
      if (sheets.length > 1) toast(`시트 ${sheets.length}개 중 "${sheets[state.sheetIdx].name}"을(를) 읽었어요. 다른 시트는 아래에서 고를 수 있어요`, 4000);
    } else {
      input.value = (await fileToSheets(f))[0].text;
      state.sheets = null; state.layout = 'auto'; store.set('layout', 'auto');
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

function gasSampleData() {
  // 가스 공급: 수요가 바뀌면 압력이 흔들리고, 운전자가 압력·수요 추세를 보고 밸브를 조절 (고정 난수)
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  let P = 5.0, V = 50;
  const Ds = [], lines = ['시각\t수요유량(Nm³/h)\t공급압력(bar)\t외기온도(°C)\t밸브개도(%)'];
  for (let i = 0; i <= 180; i++) {
    const D = 1000 + 250 * Math.sin(i / 180 * Math.PI * 1.6 - 0.3) + 50 * Math.sin(i / 13) + rnd() * 25;
    const T = 8 + 4 * Math.sin(i / 180 * Math.PI) + rnd() * 0.3;
    Ds.push(D);
    if (i > 0) {
      const dD = i >= 5 ? Ds[i - 1] - Ds[i - 6] : 0;
      let dv = 0;
      if (P < 4.92) dv += P < 4.85 ? 2 : 1; else if (P > 5.08) dv -= P > 5.15 ? 2 : 1;
      if (dD > 45) dv += 1; else if (dD < -45) dv -= 1;
      if (rnd() > 0) dv = 0;
      V = Math.min(90, Math.max(20, V + dv));
    }
    P = P + 0.00025 * (V * 20 - D) + rnd() * 0.008;
    const m = 8 * 60 + i;
    lines.push([`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, D.toFixed(0), P.toFixed(3), T.toFixed(1), V].join('\t'));
  }
  return lines.join('\n');
}

const loadSample = (text, msg) => { input.value = text; state.table = null; state.sheets = null; state.layout = 'auto'; onInput(); toast(msg, 3500); };
$('sample-btn').onclick = () => loadSample(sampleData(), '예시: 냉방 중인 방을 2시간 동안 5분마다 잰 값이에요');
$('gas-btn').onclick = () => loadSample(gasSampleData(), '예시: 가스 공급 3시간, 1분마다. 운전자가 압력·수요를 보고 밸브를 조절했어요');
$('clear-btn').onclick = () => { input.value = ''; state.table = null; state.sheets = null; state.layout = 'auto'; store.set('layout', 'auto'); store.set('cfg', null); onInput(); input.focus(); };

let inputTimer;
input.addEventListener('input', () => { clearTimeout(inputTimer); inputTimer = setTimeout(onInput, 250); });

// 이전에 넣었던 데이터 복원
input.value = store.get('text', '');
if (input.value) onInput();
