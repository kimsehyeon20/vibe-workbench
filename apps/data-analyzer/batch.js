/* ================================================================
 * batch.js — 배치(반복 작업)별 분석
 *
 * 같은 작업을 여러 번 반복한 기록(배치·사이클·로트·회차·강번 …)마다
 * 시간에 따라 기록된 값을 받아서
 *   1) 배치마다 작업 구간을 찾고 (선택: 앞뒤의 바닥값 구간 잘라내기)
 *   2) 배치마다 비교할 값을 계산한다
 *        총량  = 시간당 값(유량 Nm³/h, 전력 kW …)을 시간으로 적분 (사다리꼴 공식)
 *        평균  = 시간 가중 평균, 최대, 끝 값, 걸린 시간
 *   3) 시작 시점을 0으로 맞춰 겹친 뒤, 같은 시점끼리 평균·중앙값·10~90% 범위 (대표 곡선)
 *   4) 다른 배치와 많이 다른 배치 찾기 (값·길이·곡선 모양)
 *   5) 중간 예측: "시작 후 c분까지의 값"으로 최종 값 예측
 *   6) 배치별 조건(원료량, 설정값 …)과의 관계
 * 예: 전로 강번별 가스 회수량, 사이클별 전력량(kW → kWh), 배치 반응기 온도 곡선, 시험 회차별 측정값
 * 화면과 무관한 순수 계산.
 *
 * 브라우저: window.Batch / Node: require('./batch.js')
 * ================================================================ */
(function (root) {
  'use strict';
  const Reader = root.Reader || (typeof require === 'function' ? require('./reader.js') : null);
  const Reg = root.Regression || (typeof require === 'function' ? require('./regression.js') : null);
  const minOf = a => { let m = Infinity; for (const v of a) if (v < m) m = v; return m; };
  const maxOf = a => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };
  const { mean, sd } = Reg;
  const toNumber = v => Reader.toNumber(v);

  const sorted = a => Float64Array.from(a).sort();
  function quantile(s, p) { // s: 정렬된 배열
    if (!s.length) return NaN;
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }
  const median = a => quantile(sorted(a), 0.5);
  /** 튀는 값에 강한 표준점수: (x − 중앙값) / (1.4826 × MAD)
   *  절반 넘게 같은 값이라 MAD가 0이면 평균 절대 편차로 (1분 단위 기록의 걸린 시간 등) */
  function robustZ(a) {
    const m = median(a), dev = a.map(v => Math.abs(v - m));
    const mad = median(dev) * 1.4826;
    if (mad > 0) return a.map(v => (v - m) / mad);
    const mae = mean(dev) * 1.2533;
    return a.map(v => (mae > 0 ? (v - m) / mae : 0));
  }

  const HEAT_RE = /강번|heat|charge|차지|ch\.?\s*no|lot|로트|배치|batch|cycle|사이클|회차|\brun\b|작업\s*번호|시험\s*번호|test\s*no|시료|sample/i;
  // 시간당 양(적분하면 총량이 되는 값): 유량, 전력, 생산 속도 …
  const RATE_RE = /\/\s*(h|hr|hour|min|m|s|sec|d|day)\b|\/\s*(시간|분|초|일)|per\s*(hour|min|sec)|\bk?W\b|\bMW\b|유량|flow|전력|power|rate\b/i;
  const TOTAL_RE = /누적|적산|totali[sz]er|\btotal\b|integr|합계/i;
  const NOT_RATE_RE = /%|율\b|비율|ratio|온도|temp|압력|press|농도|conc|\bph\b|레벨|level|수위/i;
  const ROWNO_RE = /^(no\.?|번호|순번|#|index|idx|row|행)$/i;
  const UNIT_SEC = { s: 1, min: 60, h: 3600, d: 86400 };
  const UNIT_LABEL = { s: '초', min: '분', h: '시간', d: '일' };
  const METRICS = { total: '총량', mean: '평균값', peak: '최고값', last: '끝 값', duration: '걸린 시간(분)' };

  /** 시간당 값의 시간 단위: 이름에 /h, /min, /s 가 있으면 그것, kW·MW는 시간당, 없으면 시간당 */
  function rateUnitOf(name = '') {
    if (/\/\s*(s|sec)\b|\/\s*초|per\s*sec/i.test(name)) return 's';
    if (/\/\s*(min|m)\b|\/\s*분|per\s*min/i.test(name)) return 'min';
    if (/\/\s*(d|day)\b|\/\s*일/i.test(name)) return 'd';
    return 'h';
  }
  /** 이름으로 본 값 종류: 'rate'(시간당 양) / 'level'(측정값) / ''(모름) */
  const kindOfName = name => (RATE_RE.test(name) && !NOT_RATE_RE.test(name) ? 'rate' : NOT_RATE_RE.test(name) ? 'level' : '');
  /** 이름에서 단위 글자: "회수유량(Nm3/h)" → "Nm3/h" */
  function unitOf(name = '') {
    const m = String(name).match(/[(\[（]\s*([^()\[\]（）]+?)\s*[)\]）]\s*$/);
    return m ? m[1] : '';
  }
  /** 총량의 단위: Nm3/h → Nm3, kW → kWh, t/h → t. 모르면 '' */
  function amountUnitOf(name = '') {
    const u = unitOf(name) || (String(name).match(/\b([kM]W)\b/) || [])[1] || '';
    if (/^[kM]?W$/.test(u)) return `${u}h`;
    const m = u.match(/^(.+?)\s*\/\s*(h|hr|hour|min|m|s|sec|d|day|시간|분|초|일)$/i);
    return m ? m[1] : '';
  }
  /** 숫자로 된 시간 칸의 단위 → { unit, sure } (이름에 단위가 없으면 값으로 짐작, sure = false) */
  function timeUnitOf(name = '', values = []) {
    if (/초|\bsec(ond)?s?\b|[(\[]\s*s\s*[)\]]/i.test(name)) return { unit: 's', sure: true };
    if (/분|\bmin(ute)?s?\b|[(\[]\s*m\s*[)\]]/i.test(name)) return { unit: 'min', sure: true };
    if (/[(\[]\s*(h|hr|hrs|시간)\s*[)\]]|\bhours?\b|\bhrs?\b/i.test(name)) return { unit: 'h', sure: true };
    if (/[(\[]\s*(d|일)\s*[)\]]|\bdays?\b|일수/i.test(name)) return { unit: 'd', sure: true };
    // '시간', '경과시간'처럼 단위가 없는 이름: 값으로 짐작한다
    const v = values.map(toNumber).filter(Number.isFinite);
    if (!v.length) return { unit: 's', sure: false };
    const span = maxOf(v) - minOf(v);
    if (v.every(x => x > 20000 && x < 80000) && v.some(x => x % 1)) return { unit: 'd', sure: false }; // 엑셀 날짜 일련번호
    // 작업 하나가 2시간 안쪽이면 분 단위 숫자는 120 이하, 초 단위는 보통 그보다 크다
    return { unit: span <= 120 ? 'min' : 's', sure: false };
  }

  /* ---------- 1. 표 읽기 ---------- */
  function readSource(src) {
    const prep = Reader.prepareGrid(Reader.parseText(src.text), src.layout || 'auto');
    const tb = Reader.buildTable(prep.rows);
    return { ...src, prep, tb: tb.error ? null : tb, error: tb.error };
  }

  function timeColOf(tb) {
    const i = Reader.guessTimeCol(tb);
    return i >= 0 ? tb.headers[i] : '';
  }
  const finiteOf = col => col.map(toNumber).filter(Number.isFinite);
  // 계속 늘기만 하는 칸 = 누적(적산)계
  function isTotalizer(col) {
    const v = finiteOf(col);
    if (v.length < 10 || !(v[v.length - 1] > v[0])) return false;
    let up = 0, down = 0; for (let i = 1; i < v.length; i++) { if (v[i] > v[i - 1]) up++; else if (v[i] < v[i - 1]) down++; }
    return down <= (v.length - 1) * 0.02 && up >= (v.length - 1) * 0.5;
  }
  function isRowNo(tb, j) {
    if (ROWNO_RE.test(String(tb.headers[j]).trim())) return true;
    const v = tb.cols[j].map(toNumber);
    return v.length > 2 && v.every((x, i) => x === v[0] + i) && Number.isInteger(v[0]);
  }
  /** 값 칸 고르기: 시간당 단위(유량·전력)가 있는 칸을 먼저, 누적계·%·온도·압력은 뒤로 */
  function valueScore(tb, j) {
    const name = tb.headers[j];
    let s = 0;
    if (RATE_RE.test(name)) s += 3;
    if (/회수|생산|발생|사용|소비|공급|gas|가스/i.test(name)) s += 1;
    if (TOTAL_RE.test(name) || isTotalizer(tb.cols[j])) s -= 4;
    if (NOT_RATE_RE.test(name)) s -= 2;
    if (isRowNo(tb, j)) s -= 5;
    return s;
  }
  function valColOf(tb, exclude = []) {
    const nums = tb.headers.map((h, i) => i).filter(i => tb.kinds[i] === 'number' && !exclude.includes(tb.headers[i]));
    if (!nums.length) return '';
    const sc = new Map(nums.map(i => [i, valueScore(tb, i)]));
    const best = nums.slice().sort((a, b) => sc.get(b) - sc.get(a) || a - b)[0];
    if (sc.get(best) >= 3) return tb.headers[best];
    // 시간당 값이 없으면(온도·압력 같은 측정값 기록) 누적계·번호가 아닌 첫 칸
    const first = nums.find(i => sc.get(i) > -4);
    return tb.headers[first ?? best];
  }
  function heatColOf(tb, timeCol = '') {
    const i = tb.headers.findIndex((h, j) => h !== timeCol && tb.kinds[j] !== 'time' && HEAT_RE.test(h) && new Set(tb.cols[j].map(v => String(v).trim())).size < tb.body.length / 2);
    return i >= 0 ? tb.headers[i] : '';
  }
  function totalizerColOf(tb, exclude = []) {
    const i = tb.headers.findIndex((h, j) => tb.kinds[j] === 'number' && !exclude.includes(h) && (TOTAL_RE.test(h) || isTotalizer(tb.cols[j])) && !isRowNo(tb, j));
    return i >= 0 ? tb.headers[i] : '';
  }

  /** 기본 설정 추측. sources: readSource 결과들 */
  function guess(sources) {
    const ok = sources.filter(s => s.tb);
    if (!ok.length) return null;
    const tb = ok[0].tb;
    const timeCol = timeColOf(tb);
    const heatCol = heatColOf(tb, timeCol);
    const valCol = valColOf(tb, [timeCol, heatCol]);
    const ti = tb.headers.indexOf(timeCol);
    const tu = ti >= 0 && tb.kinds[ti] === 'number' ? timeUnitOf(timeCol, tb.cols[ti]) : { unit: 's', sure: true };
    let kind = kindOfName(valCol);
    const cfg = {
      shape: 'files', heatCol, timeCol, valCol, kind: 'rate',
      rateUnit: rateUnitOf(valCol), timeUnit: tu.unit, timeUnitSure: tu.sure,
      interval: 1, thr: 0.05, gap: 0, align: 'time', metric: 'total', totCol: totalizerColOf(tb, [timeCol, heatCol, valCol]), exclude: [],
    };
    if (heatCol) cfg.shape = 'long';
    else {
      const nums = tb.headers.map((h, i) => i).filter(i => tb.kinds[i] === 'number' && tb.headers[i] !== timeCol && !isRowNo(tb, i));
      const idLike = nums.filter(i => /^(#|no\.?\s*)?[A-Za-z가-힣]{0,8}[-_ #.]?\d+(차|회|번|호|호기)?$/i.test(tb.headers[i].trim()) || HEAT_RE.test(tb.headers[i]));
      if (ok.length === 1 && nums.length >= 3 && idLike.length >= nums.length * 0.6) { cfg.shape = 'wide'; kind = ''; }
      else {
        // 파일마다 작업 구간이 2개 이상이면 연속 기록
        const segs = extract(ok, { ...cfg, shape: 'continuous' }).heats;
        if (segs.length >= 2 * ok.length) cfg.shape = 'continuous';
      }
    }
    if (!kind) {
      // 이름으로 모르면 모양으로: 0 근처에서 시작해 0 근처로 끝나는 봉우리(유량·전력처럼) → 시간당 값
      const cols = cfg.shape === 'wide' ? tb.headers.map((h, i) => i).filter(i => tb.kinds[i] === 'number' && tb.headers[i] !== timeCol && !isRowNo(tb, i)) : [tb.headers.indexOf(valCol)].filter(i => i >= 0);
      const pulse = cols.filter(i => { const v = finiteOf(tb.cols[i]); const top = maxOf(v); return v.length >= 3 && top > 0 && minOf(v) >= -0.02 * top && minOf(v) <= 0.12 * top && v[0] <= 0.3 * top && v[v.length - 1] <= 0.3 * top; }).length;
      kind = cols.length && pulse >= cols.length * 0.6 ? 'rate' : 'level';
    }
    cfg.kind = kind;
    if (kind === 'level') { cfg.thr = 0; cfg.metric = 'mean'; }
    return cfg;
  }

  /** 예전에 저장한 설정(강번 전용 이름)을 새 이름으로 */
  function normalizeCfg(c) {
    if (!c) return c;
    const o = { ...c };
    if (o.valCol == null && o.flowCol != null) { o.valCol = o.flowCol; o.kind = o.kind || 'rate'; o.rateUnit = o.rateUnit || o.flowUnit || 'h'; o.metric = o.metric || 'total'; }
    o.kind = o.kind === 'level' ? 'level' : 'rate';
    if (!METRICS[o.metric] || (o.metric === 'total' && o.kind !== 'rate')) o.metric = o.kind === 'rate' ? 'total' : 'mean';
    o.rateUnit = UNIT_SEC[o.rateUnit] ? o.rateUnit : 'h';
    o.timeUnit = UNIT_SEC[o.timeUnit] ? o.timeUnit : 's';
    o.thr = Number.isFinite(+o.thr) && +o.thr >= 0 ? +o.thr : 0.05;
    o.gap = +o.gap > 0 ? +o.gap : 0;
    o.interval = +o.interval > 0 ? +o.interval : 1;
    o.exclude = Array.isArray(o.exclude) ? o.exclude : [];
    return o;
  }

  /* ---------- 2. 배치 나누기 ---------- */
  const baseName = n => String(n || '').replace(/\.[^.]+$/, '').trim();

  /** 파일 하나의 시간(초) */
  function timeOf(tb, cfg, srcName, warnings) {
    const n = tb.body.length;
    let ti = tb.headers.indexOf(cfg.timeCol);
    if (ti < 0 && cfg.timeCol) {
      const g = Reader.guessTimeCol(tb);
      if (g >= 0) { ti = g; warnings.push(`${srcName}: "${cfg.timeCol}" 칸이 없어서 "${tb.headers[g]}" 칸을 시간으로 썼어요`); }
      else warnings.push(`${srcName}: 시간 칸 "${cfg.timeCol}"이(가) 없어서 측정 간격 ${cfg.interval}초로 계산했어요`);
    }
    if (ti < 0) return { col: -1, t: Array.from({ length: n }, (_, i) => i * cfg.interval), label: Array.from({ length: n }, (_, i) => `${i + 1}번째`), abs: false };
    const label = tb.cols[ti].map(v => String(v));
    if (tb.kinds[ti] === 'time') {
      const ts = Reader.timeSeconds(tb.cols[ti]);
      return { col: ti, t: ts.sec, label, abs: ts.kind === 'date' };
    }
    const unit = tb.headers[ti] === cfg.timeCol ? cfg.timeUnit : timeUnitOf(tb.headers[ti], tb.cols[ti]).unit;
    return { col: ti, t: tb.cols[ti].map(v => toNumber(v) * UNIT_SEC[unit]), label, abs: false };
  }

  /** 점 정리: 시간 순 정렬, 같은 시각이 많으면(초 없는 시각) 그 사이에 고르게 나눔, 조금이면 평균 */
  function makeHeat(id, src, t, q, label, extra = {}) {
    let pts = t.map((tv, i) => [tv, q[i], label[i], i]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a, b) => a[0] - b[0] || a[3] - b[3]);
    let dupRows = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][0] === pts[i - 1][0]) dupRows++;
    let spread = false;
    if (dupRows && dupRows > pts.length * 0.2) {
      // 초가 없는 시각(HH:MM) 등: 같은 시각 줄들을 다음 시각까지 고르게 나눈다
      const distinct = [...new Set(pts.map(p => p[0]))];
      const step = median(distinct.slice(1).map((v, i) => v - distinct[i])) || 1;
      let i = 0;
      while (i < pts.length) {
        let j = i; while (j + 1 < pts.length && pts[j + 1][0] === pts[i][0]) j++;
        const next = j + 1 < pts.length ? pts[j + 1][0] : pts[i][0] + step;
        const k = j - i + 1;
        for (let m = 0; m < k; m++) pts[i + m][0] = pts[i][0] + (next - pts[i][0]) * m / k;
        i = j + 1;
      }
      spread = true;
    } else if (dupRows) {
      const out = [];
      for (const p of pts) { const l = out[out.length - 1]; if (l && l[0] === p[0]) { l[1] = (l[1] * l[4] + p[1]) / (l[4] + 1); l[4]++; } else out.push([...p, 1]); }
      pts = out;
    }
    return { id: String(id), src, t: pts.map(p => p[0]), q: pts.map(p => p[1]), label: pts.map(p => p[2]), dupRows, spread, ...extra };
  }

  const PLACEHOLDER_RE = /^(-+|—|–|\.+|n\/?a|#n\/a|none|null|nan|없음|대기|idle|미정)$/i;
  /** 배치 번호 칸 → 묶음. 빈칸은 (병합 셀처럼 첫 줄에만 있으면) 아래로 채우고,
   *  여러 번 띄엄띄엄 나오는 번호는 (다른 번호가 대부분 한 덩어리일 때) 대기 표시로 본다 */
  function groupIds(col) {
    const raw = col.map(v => String(v ?? '').trim());
    const filled = raw.filter(Boolean);
    // 빈칸 덩어리 바로 앞이 한 줄짜리 번호인 경우가 대부분이면 병합 셀 모양
    const count = new Map(); filled.forEach(v => count.set(v, (count.get(v) || 0) + 1));
    let runs = 0, lead = 0;
    raw.forEach((v, i) => { if (!v && i > 0 && raw[i - 1]) { runs++; if (count.get(raw[i - 1]) === 1 && !PLACEHOLDER_RE.test(raw[i - 1])) lead++; } });
    const ffill = raw.length - filled.length > raw.length * 0.3 && runs > 0 && lead >= runs * 0.8;
    let last = '';
    const key = raw.map(v => { if (v) { last = v; return v; } return ffill ? last : ''; });
    const parts = new Map(); // id → [[행 번호…], …] (덩어리별)
    let prev = null;
    key.forEach((k, i) => {
      if (!k || PLACEHOLDER_RE.test(k)) return;
      if (!parts.has(k)) parts.set(k, []);
      const r = parts.get(k);
      if (prev !== k || !r.length) r.push([]);
      r[r.length - 1].push(i);
      prev = k;
    });
    const ids = [...parts.keys()];
    const single = ids.filter(k => parts.get(k).length === 1).length;
    const idle = ids.filter(k => parts.get(k).length >= 3 && single >= (ids.length - 1) * 0.8 && ids.length > 2);
    const placeholders = [...new Set(key.filter(k => k && PLACEHOLDER_RE.test(k)))];
    const groups = [];
    for (const [k, rs] of parts) {
      if (idle.includes(k)) continue;
      rs.forEach((idx, r) => groups.push({ id: rs.length > 1 ? `${k} #${r + 1}` : k, idx }));
    }
    return { groups, ffill, idle: [...placeholders, ...idle] };
  }

  /** 연속 기록을 작업 구간마다 자른다 */
  function splitContinuous(h, cfg) {
    const s = sorted(h.q);
    const base = quantile(s, 0.05), top = quantile(s, 0.99);
    const thr = cfg.thr > 0 ? cfg.thr : 0.05;
    const th = base + thr * (top - base);
    const dt = median(h.t.slice(1).map((v, i) => v - h.t[i]).filter(v => v > 0)) || 1;
    const gap = cfg.gap > 0 ? cfg.gap : Math.max(120, 3 * dt);
    const minDur = Math.max(60, 3 * dt);
    const segs = [];
    let cur = null;
    if (!(top > base)) return [];
    h.t.forEach((t, i) => {
      if (h.q[i] >= th) {
        if (cur && t - h.t[cur.end] <= gap) cur.end = i;
        else { if (cur) segs.push(cur); cur = { start: i, end: i }; }
      }
    });
    if (cur) segs.push(cur);
    return segs
      .filter(g => h.t[g.end] - h.t[g.start] >= minDur)
      .map((g, k) => {
        const a = Math.max(0, g.start - 1), b = Math.min(h.t.length - 1, g.end + 1);
        const sl = arr => arr.slice(a, b + 1);
        return { id: `${h.src ? `${h.src} ` : ''}${h.label[g.start]}`.trim() || `구간 ${k + 1}`, src: h.src, t: sl(h.t), q: sl(h.q), label: sl(h.label), abs: h.abs };
      });
  }

  function mostlyNegative(sources, name) {
    let neg = 0, pos = 0, lo = Infinity, hi = -Infinity;
    sources.forEach(src => {
      const j = src.tb ? src.tb.headers.indexOf(name) : -1;
      if (j < 0) return;
      src.tb.cols[j].forEach(c => { const v = toNumber(c); if (v < 0) neg++; else if (v > 0) pos++; if (v < lo) lo = v; if (v > hi) hi = v; });
    });
    return neg > pos && -lo > Math.max(hi, 0);
  }

  // 사람이 보는 순서: 숫자는 숫자 크기로 (1, 2, …, 10)
  const natural = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });

  /** 설정대로 배치 목록을 만든다 → { heats, warnings, order } */
  function extract(sources, c) {
    const cfg = normalizeCfg(c);
    let heats = [];
    const warnings = [], conts = [], longMap = new Map();
    // 부호: 시간당 값이 대부분 음수면(유량 방향 표기) 뒤집는다
    const flip = cfg.kind === 'rate' && cfg.shape !== 'wide' && mostlyNegative(sources, cfg.valCol);
    if (flip) warnings.push('값이 대부분 음수라(방향 표기) 부호를 바꿔서 계산했어요');
    for (const src of sources) {
      const tb = src.tb;
      if (!tb) { warnings.push(`${src.name}: ${src.error || '읽을 수 없어요'}`); continue; }
      const col = name => tb.headers.indexOf(name);
      const T = timeOf(tb, cfg, src.name, warnings);
      if (cfg.shape === 'wide') {
        tb.headers.forEach((h, j) => {
          if (j === T.col || tb.kinds[j] !== 'number' || isRowNo(tb, j)) return;
          heats.push(makeHeat(h, src.name, T.t, tb.cols[j].map(toNumber), T.label, { abs: T.abs }));
        });
        continue;
      }
      let vi = col(cfg.valCol);
      if (vi < 0) {
        const g = valColOf(tb, [tb.headers[T.col], cfg.heatCol]); vi = col(g);
        if (vi >= 0) warnings.push(`${src.name}: "${cfg.valCol}" 칸이 없어서 "${g}" 칸을 썼어요`);
      }
      if (vi < 0) { warnings.push(`${src.name}: 값 칸을 찾지 못했어요`); continue; }
      const qAll = tb.cols[vi].map(v => (flip ? -toNumber(v) : toNumber(v)));
      if (cfg.shape === 'long') {
        const hi = col(cfg.heatCol);
        if (hi < 0) { warnings.push(`${src.name}: 배치 칸 "${cfg.heatCol}"이(가) 없어요`); continue; }
        const G = groupIds(tb.cols[hi]);
        if (G.ffill) warnings.push(`${src.name}: 배치 번호가 첫 줄에만 있어서 아래 빈칸을 같은 번호로 채웠어요`);
        if (G.idle.length) warnings.push(`${src.name}: "${G.idle.join('", "')}"은(는) 배치가 아닌 대기 표시로 보고 뺐어요`);
        // 같은 배치가 여러 파일(하루 단위 등)에 나뉘어 있으면 합친다
        G.groups.forEach(({ id, idx }) => {
          if (!longMap.has(id)) longMap.set(id, { src: src.name, t: [], q: [], label: [], abs: T.abs });
          const m = longMap.get(id);
          idx.forEach(i => { m.t.push(T.t[i]); m.q.push(qAll[i]); m.label.push(T.label[i]); });
          m.abs = m.abs && T.abs;
        });
      } else if (cfg.shape === 'continuous') {
        conts.push({ src: src.name, t: T.t, q: qAll, label: T.label, abs: T.abs });
      } else {
        const h = makeHeat(baseName(src.name), src.name, T.t, qAll, T.label, { abs: T.abs });
        // 파일 안에 배치 번호 칸이 있고 값이 하나뿐이면 그것을 이름으로
        const hc = heatColOf(tb, tb.headers[T.col]) || tb.headers.find(x => HEAT_RE.test(x) && x !== tb.headers[T.col]);
        if (hc) { const u = [...new Set(tb.cols[col(hc)].map(v => String(v).trim()).filter(Boolean))]; if (u.length === 1) h.id = u[0]; }
        heats.push(h);
      }
    }
    for (const [id, m] of longMap) heats.push(makeHeat(id, m.src, m.t, m.q, m.label, { abs: m.abs }));
    if (conts.length) {
      // 날짜가 있는 시각이면 파일들을 이어 붙여서 나눈다 (파일 경계에 걸친 배치도 하나로)
      const groups = conts.every(cc => cc.abs) && conts.length > 1
        ? [{ src: '', t: conts.flatMap(cc => cc.t), q: conts.flatMap(cc => cc.q), label: conts.flatMap(cc => cc.label), abs: true }]
        : conts;
      groups.forEach(g => {
        // 파일이 하나면 구간 이름에 파일 이름을 붙이지 않는다
        const h = makeHeat('', conts.length > 1 ? baseName(g.src) : '', g.t, g.q, g.label, { abs: g.abs });
        splitContinuous(h, cfg).forEach(sg => heats.push(makeHeat(sg.id, g.src, sg.t, sg.q, sg.label, { abs: sg.abs })));
      });
    }
    // 점이 너무 적은 배치는 이유와 함께 뺀다
    heats = heats.filter(h => { if (h.t.length >= 3) return true; warnings.push(`${h.id}: 값이 있는 점이 ${h.t.length}개뿐이라 뺐어요`); return false; });
    // 같은 기록이 두 번 들어간 배치 (같은 파일을 두 번 넣음 등)
    const sig = h => `${h.t.length}|${h.t[0]}|${h.t[h.t.length - 1]}|${h.q.reduce((a, b) => a + b, 0)}`;
    const seenSig = new Map();
    heats = heats.filter(h => { const s = sig(h); if (seenSig.has(s)) { warnings.push(`${h.id}: ${seenSig.get(s)}와(과) 기록이 똑같아서 한 번만 셌어요`); return false; } seenSig.set(s, h.id); return true; });
    const spread = heats.filter(h => h.spread).length;
    if (spread) warnings.push(`시각에 초가 없어서 같은 시각인 줄이 많아요. 배치 ${spread}개에서 같은 시각 줄들을 그 1분 안에 고르게 나눠 계산했어요`);
    // 같은 이름이 겹치면 구분
    const seen = {};
    heats.forEach(h => { if (seen[h.id]) h.id = `${h.id} (${++seen[h.id]})`; else seen[h.id] = 1; });
    // 순서: 날짜가 있는 시각이면 시작 시각 순, 파일 하나에서 나온 것은 기록 순, 파일마다 하나면 이름 순(숫자 크기)
    let order = 'record';
    if (heats.length && heats.every(h => h.abs)) { heats.sort((a, b) => a.t[0] - b.t[0]); order = 'time'; }
    else if (cfg.shape === 'files') { heats.sort((a, b) => natural(a.id, b.id)); order = 'name'; }
    return { heats, warnings, order };
  }

  /* ---------- 3. 배치 하나 요약 ---------- */
  /** 혼자 튀는 한 점(통신 오류 등)을 이웃 평균으로 바꾼다 */
  function despike(q) {
    const n = q.length;
    if (n < 5) return { q, fixed: 0 };
    const d = []; for (let i = 1; i < n; i++) d.push(Math.abs(q[i] - q[i - 1]));
    const md = median(d);
    const s = sorted(q), range = quantile(s, 0.98) - quantile(s, 0.02);
    const out = q.slice(); let fixed = 0;
    for (let i = 1; i < n - 1; i++) {
      const a = q[i - 1], b = q[i + 1], v = q[i], mid = (a + b) / 2, dev = Math.abs(v - mid);
      if ((v - a) * (v - b) > 0 && dev > Math.max(20 * md, 0.5 * range) && dev > 3 * Math.abs(b - a)) { out[i] = mid; fixed++; }
    }
    return { q: out, fixed };
  }

  /** 작업 구간만 남긴다. thr = 0 이면 자르지 않음.
   *  기준 = 바닥값 + thr × (높은 값 − 바닥값). 높은 값은 세 번째로 큰 값(한 점이 튀어도 흔들리지 않게).
   *  대기 중에도 0이 아닌 값(0점 오차)이 찍히는 계기는 그 바닥값부터 잰다 */
  function trim(h, cfg) {
    const thr = cfg.thr ?? 0.05;
    const ds = despike(h.q);
    const q0 = ds.q;
    const s = sorted(q0);
    const top = s[Math.max(0, s.length - 3)];
    // 바닥값: 맨 아래에 평평하게 모인 점(대기 중 0점 오차 등)이 있으면 그 값, 없으면 0(시간당 값) 또는 최소값
    const band = s[0] + 0.02 * (top - s[0]);
    let k = 0; while (k < s.length && s[k] <= band) k++;
    const floor = k >= Math.max(3, 0.05 * s.length) ? s[k >> 1] : cfg.kind === 'rate' ? 0 : s[0];
    const base = cfg.kind === 'rate' ? Math.max(0, floor) : floor;
    if (thr > 0 && !(top > base)) return null; // 값이 모두 같음 (예: 모두 0)
    let a = 0, b = q0.length - 1, th = NaN;
    if (thr > 0) {
      th = base + thr * (top - base);
      a = q0.findIndex(v => v >= th);
      while (b > a && q0[b] < th) b--;
    }
    const t0 = h.t[a];
    const t = h.t.slice(a, b + 1).map(v => v - t0), q = q0.slice(a, b + 1);
    // 구간 안에서 기준 아래로 떨어진 시간 (작업 중단 의심)
    let dip = 0;
    if (thr > 0) for (let i = 1; i < t.length; i++) if (q[i] < th && q[i - 1] < th) dip += t[i] - t[i - 1];
    return { ...h, t, q, label: h.label.slice(a, b + 1), start: h.label[a], t0, cut: { before: a, after: h.q.length - 1 - b }, th, dip, fixed: ds.fixed };
  }

  // 사다리꼴 적분: Σ (q_i + q_{i+1}) / 2 × Δt  (÷ unitSec)
  function integrate(t, q, unitSec, upTo = Infinity) {
    let v = 0;
    for (let i = 1; i < t.length; i++) {
      if (t[i - 1] >= upTo) break;
      if (t[i] <= upTo) v += (q[i] + q[i - 1]) / 2 * (t[i] - t[i - 1]);
      else { const qc = q[i - 1] + (q[i] - q[i - 1]) * (upTo - t[i - 1]) / (t[i] - t[i - 1]); v += (q[i - 1] + qc) / 2 * (upTo - t[i - 1]); }
    }
    return v / unitSec;
  }

  function summarize(h, cfg) {
    const dts = h.t.slice(1).map((v, i) => v - h.t[i]);
    const duration = h.t[h.t.length - 1];
    const area = integrate(h.t, h.q, 1);
    const peak = maxOf(h.q);
    const sum = {
      duration, peak,
      total: cfg.kind === 'rate' ? area / UNIT_SEC[cfg.rateUnit] : NaN,
      mean: duration > 0 ? area / duration : mean(h.q),
      last: h.q[h.q.length - 1], first: h.q[0], min: minOf(h.q),
      tPeak: h.t[h.q.indexOf(peak)],
      n: h.t.length, dt: median(dts), maxGap: maxOf(dts),
    };
    sum.value = metricOf(sum, cfg.metric);
    return sum;
  }
  const metricOf = (sum, m) => (m === 'duration' ? sum.duration / 60 : sum[m]);

  /** 시작 후 c초까지의 값 (중간 예측의 x) */
  function partial(h, metric, c, cfg) {
    if (metric === 'total') return integrate(h.t, h.q, UNIT_SEC[cfg.rateUnit], c);
    if (metric === 'mean') return c > 0 ? integrate(h.t, h.q, 1, c) / c : NaN;
    if (metric === 'last') return interp(h.t, h.q, c);
    if (metric === 'peak') { let m = interp(h.t, h.q, c); for (let i = 0; i < h.t.length && h.t[i] <= c; i++) if (h.q[i] > m) m = h.q[i]; return m; }
    return NaN;
  }

  /* ---------- 4. 시간 맞추기 + 대표 곡선 ---------- */
  function interp(t, q, x) {
    if (x < t[0] || x > t[t.length - 1]) return NaN;
    let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
    return t[hi] === t[lo] ? q[lo] : q[lo] + (q[hi] - q[lo]) * (x - t[lo]) / (t[hi] - t[lo]);
  }

  /** mode 'time': 시작 후 경과 시간(초) / 'pct': 각 배치 길이를 0~100%로
   *  'time'에서 먼저 끝난 배치: 시간당 값이면 0(더 안 나옴), 측정값이면 빈 값 */
  function align(heats, mode = 'time', kind = 'rate') {
    let grid;
    if (mode === 'pct') grid = Array.from({ length: 201 }, (_, i) => i * 0.5);
    else {
      const maxD = maxOf(heats.map(h => h.t[h.t.length - 1]));
      const step = Math.max(median(heats.map(h => h.sum.dt)) || 1, maxD / 600);
      grid = []; for (let x = 0; x <= maxD + 1e-9; x += step) grid.push(+x.toFixed(6));
    }
    const rows = heats.map(h => {
      const D = h.t[h.t.length - 1];
      return grid.map(g => (mode === 'pct' ? interp(h.t, h.q, g / 100 * D) : g > D ? (kind === 'rate' ? 0 : NaN) : interp(h.t, h.q, g)));
    });
    const col = j => sorted(rows.map(r => r[j]).filter(Number.isFinite));
    const stat = grid.map((_, j) => { const c = col(j); return { mean: c.length ? mean(c) : NaN, median: quantile(c, 0.5), p10: quantile(c, 0.1), p90: quantile(c, 0.9), sd: c.length > 1 ? sd(c) : 0, n: c.length }; });
    const active = grid.map(g => (mode === 'pct' ? heats.length : heats.filter(h => h.t[h.t.length - 1] >= g).length));
    return {
      mode, grid, rows, active,
      mean: stat.map(s => s.mean), median: stat.map(s => s.median), p10: stat.map(s => s.p10), p90: stat.map(s => s.p90), sd: stat.map(s => s.sd),
    };
  }

  /* ---------- 5. 중간 예측: 시작 후 c까지의 값 → 최종 값 ---------- */
  function early(heats, cfg) {
    if (cfg.metric === 'duration') return [];
    const D = median(heats.map(h => h.sum.duration));
    const unit = D > 4 * 3600 ? 600 : D > 1200 ? 60 : D > 300 ? 30 : Math.max(1, Math.round(D / 20));
    const cps = [...new Set([0.2, 0.3, 0.4, 0.5, 0.6].map(f => Math.max(unit, Math.round(f * D / unit) * unit)))].filter(c => c < D);
    return cps.map(c => {
      const hs = heats.filter(h => h.sum.duration >= c);
      if (hs.length < 6) return null;
      const x = hs.map(h => partial(h, cfg.metric, c, cfg)), y = hs.map(h => h.sum.value);
      if (!x.every(Number.isFinite) || Reg.isConstant(x)) return null;
      const m = Reg.fitModel('linear', x, y);
      if (!m) return null;
      m.validation = Reg.validate('linear', x, y, 'spread');
      // 비교 기준: 같은 배치들의 최종 값 표준편차 (평균값으로만 찍을 때 오차). 검증 오차로 비교
      const sdY = y.length > 1 ? sd(y) : NaN;
      const err = m.validation && Number.isFinite(m.validation.rmse) ? m.validation.rmse : m.rmse;
      return { sec: c, n: hs.length, model: m, x, y, ids: hs.map(h => h.id), sdY, err, gain: sdY > 0 ? 1 - err / sdY : NaN };
    }).filter(Boolean);
  }

  /* ---------- 6. 전체 분석 ---------- */
  function analyze(sources, c) {
    const cfg = normalizeCfg(c);
    const { heats: raw, warnings, order } = extract(sources, cfg);
    const heats = [], excluded = [];
    const ex = new Set(cfg.exclude);
    raw.forEach(h => {
      const tr = trim(h, cfg);
      if (!tr) { warnings.push(`${h.id}: 값이 처음부터 끝까지 같아서(예: 모두 0) 작업 구간을 찾을 수 없어요 → 뺐어요`); return; }
      if (tr.t.length < 3) { warnings.push(`${h.id}: 작업 구간의 점이 ${tr.t.length}개뿐이라 뺐어요`); return; }
      tr.sum = summarize(tr, cfg);
      if (!(tr.sum.duration > 0)) { warnings.push(`${h.id}: 길이가 0이에요`); return; }
      tr.flags = []; tr.notes = [];
      (ex.has(tr.id) ? excluded : heats).push(tr); // 사용자가 뺀 배치는 계산에서 제외
    });
    if (heats.length < 2) return { heats, excluded, cfg, order, warnings, error: heats.length || excluded.length ? '배치가 2개 이상 있어야 비교할 수 있어요' : '배치를 찾지 못했어요. 데이터 모양과 칸 설정을 확인해주세요.' };

    const al = align(heats, cfg.align, cfg.kind);
    const vals = heats.map(h => h.sum.value), durs = heats.map(h => h.sum.duration);
    // 곡선 모양 차이: 중앙값 곡선과의 차이 (중앙값 곡선 크기 대비)
    const medFin = al.median.filter(Number.isFinite);
    const scale = mean(medFin.map(Math.abs)) || 1;
    const shape = al.rows.map(r => { const d = r.map((v, j) => (Number.isFinite(v) && Number.isFinite(al.median[j]) ? (v - al.median[j]) ** 2 : NaN)).filter(Number.isFinite); return d.length ? Math.sqrt(mean(d)) / scale : 0; });
    const zV = robustZ(vals), zD = robustZ(durs), zS = robustZ(shape);
    const hiWord = { total: ['많음', '적음'], mean: ['높음', '낮음'], peak: ['높음', '낮음'], last: ['높음', '낮음'], duration: ['김', '짧음'] }[cfg.metric];
    const mName = METRICS[cfg.metric].replace(/\(.*\)/, '');
    heats.forEach((h, i) => {
      const f = [];
      if (zV[i] > 3) f.push(`${mName} ${hiWord[0]}`); if (zV[i] < -3) f.push(`${mName} ${hiWord[1]}`);
      if (cfg.metric !== 'duration') { if (zD[i] > 3) f.push('길이 김'); if (zD[i] < -3) f.push('길이 짧음'); }
      if (zS[i] > 3) f.push('곡선 모양 다름');
      if (h.dip > Math.max(10, h.sum.duration * 0.05)) f.push(`중간 끊김 ${Math.round(h.dip)}초`);
      if (h.sum.maxGap > Math.max(5 * h.sum.dt, 30)) f.push(`기록 빠짐 ${Math.round(h.sum.maxGap)}초`);
      if (h.fixed) h.notes.push(`튀는 값 ${h.fixed}개 고침`);
      h.flags = f; h.shapeDiff = shape[i]; h.z = { value: zV[i], duration: zD[i], shape: zS[i] };
    });
    const sv = sorted(vals);
    const m0 = mean(vals);
    const stats = {
      n: heats.length, mean: m0, sd: sd(vals), median: quantile(sv, 0.5), min: sv[0], max: sv[sv.length - 1],
      p10: quantile(sv, 0.1), p90: quantile(sv, 0.9),
      cv: m0 !== 0 ? sd(vals) / Math.abs(m0) : NaN,
      durMean: mean(durs), durMin: minOf(durs), durMax: maxOf(durs),
      peakMean: mean(heats.map(h => h.sum.peak)), meanMean: mean(heats.map(h => h.sum.mean)),
    };
    // 대표 곡선의 근사식 (x: 분 또는 %)
    const pts = al.grid.map((g, j) => [cfg.align === 'pct' ? g : g / 60, al.mean[j]]).filter(p => Number.isFinite(p[1]));
    const typical = pts.length >= 4 ? Reg.bestFit(pts.map(p => p[0]), pts.map(p => p[1])) : null;
    // 순서에 따른 추세 (설비 상태 변화 등)
    const trend = Reg.isConstant(vals) ? null : Reg.fitModel('linear', heats.map((_, i) => i + 1), vals);
    // 누적(적산)계와 비교: 작업 구간의 누적계 증가량 vs 적분한 총량
    const tot = cfg.kind === 'rate' && cfg.totCol ? totalizerCheck(sources, cfg, heats) : null;
    return { heats, excluded, align: al, stats, typical, early: early(heats, cfg), trend, warnings, order, cfg, totalizer: tot };
  }

  /** 누적계 칸이 있으면 배치마다 (끝 − 시작) 증가량을 구해 적분 총량과 비교한다 */
  function totalizerCheck(sources, cfg, heats) {
    // 원래 시각(초) → 누적계 값. 배치의 시작 시각(t0)과 끝 시각으로 보간
    const series = [];
    sources.forEach(src => {
      const tb = src.tb; if (!tb) return;
      const j = tb.headers.indexOf(cfg.totCol); if (j < 0) return;
      const T = timeOf(tb, cfg, src.name, []);
      const pts = T.t.map((t, i) => [t, toNumber(tb.cols[j][i])]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
      series.push({ src: src.name, t: pts.map(p => p[0]), v: pts.map(p => p[1]) });
    });
    if (!series.length || cfg.shape === 'wide') return null;
    // 파일을 이어 붙인 연속 기록이면 모두 합친 계열에서 찾는다
    const all = series.length > 1 ? (() => { const p = series.flatMap(x => x.t.map((t, i) => [t, x.v[i]])).sort((a, b) => a[0] - b[0]); return { t: p.map(x => x[0]), v: p.map(x => x[1]) }; })() : series[0];
    const rows = heats.map(h => {
      const s = series.find(x => x.src === h.src) || all;
      if (!s || !Number.isFinite(h.t0)) return NaN;
      const a = interp(s.t, s.v, h.t0), b = interp(s.t, s.v, h.t0 + h.sum.duration);
      return b - a;
    });
    const ratio = heats.map((h, i) => (rows[i] > 0 ? h.sum.total / rows[i] : NaN)).filter(Number.isFinite);
    if (!ratio.length) return null;
    return { name: cfg.totCol, delta: rows, ratioMedian: median(ratio), ratioMin: minOf(ratio), ratioMax: maxOf(ratio), n: ratio.length };
  }

  /* ---------- 7. 배치별 조건과의 관계 ---------- */
  function normId(v) {
    let s = String(v ?? '').trim().replace(/\.0+$/, '').toUpperCase();
    if (/^\d+$/.test(s)) s = String(+s); // 001 = 1
    return s;
  }
  const PER_RE = /생산량|출강량|장입량|처리량|투입량|원료량|중량|무게|weight|mass|\(t\)|\(kg\)|\(톤\)|\bton|톤\b|수량|qty|개수|production|output/i;
  const PER_BAD_RE = /온도|temp|압력|press|%|율\b|시간|time|농도|conc/i;

  /** 배치 이름 ↔ 조건 표의 번호 칸 짝짓기 (정확히 같거나, 이름 안의 한 토막이 같음). 한 줄은 한 배치에만 */
  function matchIds(heats, tb) {
    const keyCols = [tb.headers.findIndex(h => HEAT_RE.test(h)), 0, ...tb.headers.map((h, j) => j).filter(j => tb.kinds[j] === 'text')]
      .filter((j, i, a) => j >= 0 && a.indexOf(j) === i);
    let best = null;
    for (const k of keyCols) {
      const map = new Map(), dupKey = new Set();
      tb.cols[k].forEach((v, i) => { const id = normId(v); if (!id) return; if (map.has(id)) dupKey.add(id); else map.set(id, i); });
      const idx = heats.map(h => {
        const e = normId(h.id);
        if (map.has(e) && !dupKey.has(e)) return { i: map.get(e), exact: true };
        const toks = String(h.id).split(/[\s·_\-()/\\,]+/).map(normId).filter(t => map.has(t) && !dupKey.has(t));
        const rowsHit = [...new Set(toks.map(t => map.get(t)))];
        return rowsHit.length === 1 ? { i: rowsHit[0], exact: false } : null;
      });
      // 같은 줄을 여러 배치가 가리키면 토막 짝짓기는 버린다
      const use = new Map(); idx.forEach(m => { if (m) use.set(m.i, (use.get(m.i) || 0) + 1); });
      const final = idx.map(m => (m && (m.exact || use.get(m.i) === 1) ? m.i : null));
      const n = final.filter(v => v != null).length;
      if (!best || n > best.n) best = { k, idx: final, n };
    }
    return best || { k: 0, idx: heats.map(() => null), n: 0 };
  }

  /** attrText: 줄마다 배치 하나인 조건 표. opts.per: 원단위 나눌 항목 이름('' = 안 함, 없으면 자동) */
  function factors(res, attrText, opts = {}) {
    if (!attrText || !attrText.trim()) return null;
    const raw = Reader.parseText(attrText);
    // 조건 표는 보통 "줄 = 배치". 그렇게 읽어 맞는 게 없으면 돌려서도 본다
    let best = null;
    for (const layout of ['cols', 'rows']) {
      const tb = Reader.buildTable(Reader.prepareGrid(raw, layout).rows);
      if (tb.error) continue;
      const m = matchIds(res.heats, tb);
      if (!best || m.n > best.m.n) best = { tb, m };
    }
    if (!best) return { error: '배치 정보 표를 읽을 수 없어요' };
    if (!best.m.n) return { error: '배치 정보의 번호와 기록의 배치 이름이 하나도 맞지 않아요. 첫 칸(또는 번호 칸)에 배치 이름을 그대로 써주세요.' };
    const { tb, m } = best;
    const matched = m.idx;
    const attrs = tb.headers.map((name, j) => ({ name, j })).filter(a => a.j !== m.k && tb.kinds[a.j] === 'number')
      .map(a => ({ name: a.name, values: matched.map(i => (i == null ? NaN : toNumber(tb.cols[a.j][i]))) }));
    const vol = res.heats.map(h => h.sum.value);
    const yName = res.cfg ? METRICS[res.cfg.metric].replace(/\(.*\)/, '') : '값';
    const rel = attrs.map(a => {
      const r = Reg.pearson(a.values, vol);
      const x = [], y = [];
      a.values.forEach((v, i) => { if (Number.isFinite(v)) { x.push(v); y.push(vol[i]); } });
      const mdl = x.length >= 4 && !Reg.isConstant(x) ? Reg.fitModel('linear', x, y) : null;
      const det = mdl ? Reg.details(mdl) : null;
      return { name: a.name, r: r.r, n: r.n, model: mdl, p: det ? det.coefs[1].p : NaN };
    }).sort((a, b) => Math.abs(b.r || 0) - Math.abs(a.r || 0));
    const usable = attrs.filter(a => a.values.filter(Number.isFinite).length >= 4);
    const multi = usable.length >= 2 ? Reg.multiRegression(yName, vol, usable) : null;
    // 원단위(배치 값 ÷ 생산량 등): 사용자가 고른 항목, 없으면 이름으로 짐작 (온도·압력·% 는 제외)
    const perCandidates = attrs.map(a => a.name);
    const perName = opts.per != null ? (perCandidates.includes(opts.per) ? opts.per : '') : (attrs.find(a => PER_RE.test(a.name) && !PER_BAD_RE.test(a.name)) || {}).name || '';
    const per = attrs.find(a => a.name === perName);
    const intensity = per ? res.heats.map((h, i) => (per.values[i] > 0 ? h.sum.value / per.values[i] : NaN)) : null;
    return {
      attrs, rel, multi, matched: m.n, total: res.heats.length, keyName: tb.headers[m.k],
      unmatched: res.heats.filter((_, i) => matched[i] == null).map(h => h.id),
      intensity, perName, perCandidates,
    };
  }

  /* ---------- 예시 1: 전로 가스 회수 12개 강번 (고정 난수) ---------- */
  function demo() {
    let seed = 21;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const p2 = n => String(n).padStart(2, '0');
    const clock = s => `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(Math.floor(s % 60))}`;
    const shape = u => (1 - Math.exp(-u / 0.08)) * (1 - u ** 6);
    let area = 0; for (let k = 0; k < 1000; k++) area += shape((k + 0.5) / 1000) / 1000;
    const sources = [], attrs = ['강번\t산소취입량(Nm3)\t용선비(%)\t출강량(t)'];
    for (let k = 0; k < 12; k++) {
      const id = `D24${101 + k}`;
      const o2 = 12500 + rnd() * 1600, hm = 85 + rnd() * 8, ton = 250 + rnd() * 12;
      const T = (10 + rnd() * 3) * 60; // 회수 시간(초)
      const vol = 1.55 * o2 + 140 * (hm - 85) + rnd() * 700;
      const dipHeat = k === 6;
      const peak = vol / (area * T / 3600);
      const start = 7 * 3600 + k * 40 * 60 + Math.round(rnd() * 120);
      const lines = ['시각\t회수유량(Nm3/h)\tCO(%)'];
      for (let s = -30; s <= T + 30; s += 5) {
        const u = s / T;
        let q = s < 0 || s > T ? Math.max(0, 150 + rnd() * 300) : peak * shape(u) * (1 + rnd() * 0.06);
        if (dipHeat && u > 0.45 && u < 0.55) q *= 0.03; // 회수 중단
        const co = s < 0 || s > T ? 5 + rnd() * 4 : 60 + 10 * shape(u) + rnd() * 3;
        lines.push(`${clock(start + s)}\t${Math.max(0, q).toFixed(0)}\t${co.toFixed(1)}`);
      }
      sources.push({ name: `${id}.csv`, text: lines.join('\n') });
      attrs.push([id, o2.toFixed(0), hm.toFixed(1), ton.toFixed(1)].join('\t'));
    }
    return { sources, attrs: attrs.join('\n') };
  }

  /* ---------- 예시 2: 배치 반응기 온도 곡선 10개 (측정값: 최고 온도 비교) ---------- */
  function demoReactor() {
    let seed = 5;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const lines = ['배치\t경과(분)\t반응온도(°C)\t교반속도(rpm)'];
    const attrs = ['배치\t원료량(kg)\t가열출력(%)\t촉매(g)'];
    for (let k = 0; k < 10; k++) {
      const id = `B-${String(k + 1).padStart(3, '0')}`;
      const feed = 500 + rnd() * 80, heat = 70 + rnd() * 20, cat = 40 + rnd() * 10;
      const top = 120 + 1.5 * (heat - 70) - 0.05 * (feed - 500) + 0.5 * (cat - 40) + rnd() * 2;
      const D = Math.round(95 + rnd() * 16 + 0.08 * (feed - 500));
      for (let m = 0; m <= D; m++) {
        const u = m / D;
        // 가열 → 반응열로 최고점 → 냉각
        const temp = 25 + (top - 25) * (u < 0.55 ? Math.sin(u / 0.55 * Math.PI / 2) ** 1.5 : 1 - 0.75 * ((u - 0.55) / 0.45) ** 1.4) + rnd() * 0.8;
        const rpm = u < 0.05 ? 0 : 180 + rnd() * 6;
        lines.push(`${id}\t${m}\t${temp.toFixed(1)}\t${rpm.toFixed(0)}`);
      }
      attrs.push([id, feed.toFixed(0), heat.toFixed(0), cat.toFixed(1)].join('\t'));
    }
    return { sources: [{ name: '반응기_배치기록.csv', text: lines.join('\n') }], attrs: attrs.join('\n'), cfg: { metric: 'peak' } };
  }

  const Batch = {
    demo, demoReactor, UNIT_SEC, UNIT_LABEL, METRICS, readSource, guess, normalizeCfg, extract, trim, despike, integrate, summarize, partial, align, early, analyze, factors,
    rateUnitOf, timeUnitOf, amountUnitOf, kindOfName, unitOf, valColOf, quantile, robustZ, interp, groupIds, matchIds, metricOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Batch;
  else root.Batch = Batch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
