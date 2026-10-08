/* ================================================================
 * batch.js — 강번별(배치) 분석
 *
 * 강번(작업 한 번)마다 몇 분 동안 기록된 순시값(예: 가스 회수 유량 Nm³/h)을
 * 여러 개 받아서
 *   1) 강번마다 회수 구간을 찾고 (앞뒤 0 근처 값 제거)
 *   2) 회수량 = 순시값을 시간에 대해 적분 (사다리꼴 공식)
 *   3) 시작 시점을 0으로 맞춰 겹친 뒤, 같은 시각끼리 평균·중앙값·10~90% 범위 (대표 곡선)
 *   4) 이상 강번 찾기 (회수량·회수 시간·곡선 모양)
 *   5) 중간 예측: "회수 시작 후 c분까지 회수량"으로 최종 회수량 예측
 *   6) 강번별 조업 정보(산소량, 출강량 …)와의 관계
 * 를 계산한다. 화면과 무관한 순수 계산.
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

  const sorted = a => [...a].sort((x, y) => x - y);
  function quantile(s, p) { // s: 정렬된 배열
    if (!s.length) return NaN;
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }
  const median = a => quantile(sorted(a), 0.5);
  // 튀는 값에 강한 표준점수: (x − 중앙값) / (1.4826 × MAD)
  function robustZ(a) {
    const m = median(a), mad = median(a.map(v => Math.abs(v - m))) * 1.4826;
    return a.map(v => (mad > 0 ? (v - m) / mad : 0));
  }

  const HEAT_RE = /강번|heat|charge|차지|ch\.?\s*no|lot|배치|batch|작업\s*번호/i;
  const FLOW_RE = /회수|유량|flow|nm3|nm³|가스|gas/i;
  const UNIT_SEC = { s: 1, min: 60, h: 3600 };
  const UNIT_LABEL = { s: '초', min: '분', h: '시간' };

  // 유량 단위: 이름에 /h, /min, /s 가 있으면 그것, 없으면 시간당(Nm³/h)
  function flowUnitOf(name = '') {
    if (/\/\s*(h|hr|hour)\b|\/\s*시간?|\/hr|per\s*hour/i.test(name)) return 'h';
    if (/\/\s*(min|m)\b|\/\s*분/i.test(name)) return 'min';
    if (/\/\s*(s|sec)\b|\/\s*초/i.test(name)) return 's';
    return 'h';
  }
  // 숫자로 된 시간 칸의 단위
  function timeUnitOf(name = '', values = []) {
    if (/분|min/i.test(name)) return 'min';
    if (/초|sec|\(s\)/i.test(name)) return 's';
    if (/시간|hour|\(h\)/i.test(name)) return 'h';
    const v = values.map(Reader.toNumber).filter(Number.isFinite);
    return v.length > 30 && maxOf(v) <= 60 ? 'min' : 's';
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
  function flowColOf(tb, exclude = []) {
    const nums = tb.headers.map((h, i) => i).filter(i => tb.kinds[i] === 'number' && !exclude.includes(tb.headers[i]));
    const byName = nums.find(i => FLOW_RE.test(tb.headers[i]));
    if (byName != null) return tb.headers[byName];
    if (!nums.length) return '';
    // 평균이 가장 큰 숫자 칸
    const avg = i => mean(tb.cols[i].map(Reader.toNumber).filter(Number.isFinite));
    return tb.headers[nums.sort((a, b) => avg(b) - avg(a))[0]];
  }
  function heatColOf(tb) {
    const i = tb.headers.findIndex((h, j) => HEAT_RE.test(h) && new Set(tb.cols[j].map(v => String(v).trim())).size < tb.body.length / 2);
    return i >= 0 ? tb.headers[i] : '';
  }

  // 시간 칸 → 초
  function toSeconds(values, kind, numUnit = 's') {
    if (kind === 'time') {
      let day = 0, prev = null;
      return values.map(v => {
        const p = Reader.parseTimeCell(v);
        if (!p) return NaN;
        if (p.kind === 'date') return p.v / 1000;
        if (prev != null && p.v + day * 86400 < prev - 43200) day++;
        const s = p.v + day * 86400; prev = s; return s;
      });
    }
    return values.map(v => Reader.toNumber(v) * UNIT_SEC[numUnit]);
  }

  /** 기본 설정 추측. sources: readSource 결과들 */
  function guess(sources) {
    const ok = sources.filter(s => s.tb);
    if (!ok.length) return null;
    const tb = ok[0].tb;
    const timeCol = timeColOf(tb);
    const heatCol = heatColOf(tb);
    const flowCol = flowColOf(tb, [timeCol, heatCol]);
    const ti = tb.headers.indexOf(timeCol);
    const cfg = {
      shape: 'files', heatCol, timeCol, flowCol,
      flowUnit: flowUnitOf(flowCol),
      timeUnit: ti >= 0 && tb.kinds[ti] === 'number' ? timeUnitOf(timeCol, tb.cols[ti]) : 's',
      interval: 1, thr: 0.05, align: 'time', minGap: 120, minDur: 60,
    };
    if (heatCol) cfg.shape = 'long';
    else if (ok.length === 1) {
      const nums = tb.headers.filter((h, i) => tb.kinds[i] === 'number' && h !== timeCol);
      const idLike = nums.filter(h => /^[A-Za-z가-힣]{0,4}[-_ ]?\d{3,}$/.test(h.trim()) || HEAT_RE.test(h));
      if (nums.length >= 3 && idLike.length >= nums.length * 0.6) cfg.shape = 'wide';
      else {
        const segs = extract(ok, { ...cfg, shape: 'continuous' }).heats;
        if (segs.length >= 2) cfg.shape = 'continuous';
      }
    }
    return cfg;
  }

  /* ---------- 2. 강번 나누기 ---------- */
  const baseName = n => String(n || '').replace(/\.[^.]+$/, '').trim();

  function series(tb, cfg, idx = null) {
    const rows = idx || tb.body.map((_, i) => i);
    const ti = tb.headers.indexOf(cfg.timeCol);
    const tAll = ti >= 0 ? toSeconds(tb.cols[ti], tb.kinds[ti], cfg.timeUnit) : tb.body.map((_, i) => i * (cfg.interval || 1));
    return { rows, t: rows.map(i => tAll[i]), label: rows.map(i => (ti >= 0 ? String(tb.cols[ti][i]) : `${i + 1}번째`)) };
  }

  function makeHeat(id, src, t, q, label) {
    const pts = t.map((tv, i) => [tv, q[i], label[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a, b) => a[0] - b[0]);
    return { id: String(id), src, t: pts.map(p => p[0]), q: pts.map(p => p[1]), label: pts.map(p => p[2]) };
  }

  // 연속 기록을 회수 구간마다 자른다
  function splitContinuous(h, cfg) {
    const s = sorted(h.q.filter(v => v > 0));
    const th = (cfg.thr || 0.05) * quantile(s, 0.99);
    const segs = [];
    let cur = null;
    h.t.forEach((t, i) => {
      if (h.q[i] >= th) {
        if (cur && t - h.t[cur.end] <= (cfg.minGap ?? 120)) cur.end = i;
        else { if (cur) segs.push(cur); cur = { start: i, end: i }; }
      }
    });
    if (cur) segs.push(cur);
    return segs
      .filter(g => h.t[g.end] - h.t[g.start] >= (cfg.minDur ?? 60))
      .map((g, k) => {
        const a = Math.max(0, g.start - 1), b = Math.min(h.t.length - 1, g.end + 1);
        const sl = arr => arr.slice(a, b + 1);
        return makeHeat(`${h.src} ${h.label[g.start]}`.trim() || `구간 ${k + 1}`, h.src, sl(h.t), sl(h.q), sl(h.label));
      });
  }

  /** 설정대로 강번 목록을 만든다 → { heats, warnings } */
  function extract(sources, cfg) {
    const heats = [], warnings = [];
    for (const src of sources) {
      const tb = src.tb;
      if (!tb) { warnings.push(`${src.name}: ${src.error || '읽을 수 없어요'}`); continue; }
      const col = name => tb.headers.indexOf(name);
      if (cfg.shape === 'wide') {
        const s = series(tb, cfg);
        tb.headers.forEach((h, j) => {
          if (h === cfg.timeCol || tb.kinds[j] !== 'number') return;
          heats.push(makeHeat(h, src.name, s.t, s.rows.map(i => Reader.toNumber(tb.cols[j][i])), s.label));
        });
        continue;
      }
      let fi = col(cfg.flowCol);
      if (fi < 0) { const g = flowColOf(tb, [cfg.timeCol, cfg.heatCol]); fi = col(g); if (fi >= 0 && sources.length > 1) warnings.push(`${src.name}: "${cfg.flowCol}" 칸이 없어서 "${g}" 칸을 썼어요`); }
      if (fi < 0) { warnings.push(`${src.name}: 회수량 칸을 찾지 못했어요`); continue; }
      const qAll = tb.cols[fi].map(Reader.toNumber);
      if (cfg.shape === 'long') {
        const hi = col(cfg.heatCol);
        if (hi < 0) { warnings.push(`${src.name}: 강번 칸 "${cfg.heatCol}"이(가) 없어요`); continue; }
        const groups = new Map();
        tb.cols[hi].forEach((v, i) => { const k = String(v).trim(); if (!k) return; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
        for (const [k, idx] of groups) { const s = series(tb, cfg, idx); heats.push(makeHeat(k, src.name, s.t, idx.map(i => qAll[i]), s.label)); }
      } else {
        const s = series(tb, cfg);
        const h = makeHeat(baseName(src.name), src.name, s.t, qAll, s.label);
        if (cfg.shape === 'continuous') heats.push(...splitContinuous(h, cfg));
        else {
          // 파일 안에 강번 칸이 있고 값이 하나뿐이면 그것을 강번으로
          const hc = heatColOf(tb) || tb.headers.find(x => HEAT_RE.test(x));
          if (hc) { const u = [...new Set(tb.cols[col(hc)].map(v => String(v).trim()).filter(Boolean))]; if (u.length === 1) h.id = u[0]; }
          heats.push(h);
        }
      }
    }
    // 같은 강번 이름이 겹치면 구분
    const seen = {};
    heats.forEach(h => { if (seen[h.id]) h.id = `${h.id} (${++seen[h.id]})`; else seen[h.id] = 1; });
    return { heats: heats.filter(h => h.t.length >= 3), warnings };
  }

  /* ---------- 3. 강번 하나 요약 ---------- */
  // 앞뒤의 0 근처 값(회수 전·후)을 잘라 회수 구간만 남긴다
  function trim(h, thr = 0.05) {
    const peak = maxOf(h.q);
    const th = thr * peak;
    const a = h.q.findIndex(v => v >= th);
    let b = h.q.length - 1; while (b > a && h.q[b] < th) b--;
    if (a < 0) return null;
    const t0 = h.t[a];
    const t = h.t.slice(a, b + 1).map(v => v - t0), q = h.q.slice(a, b + 1);
    // 구간 안에서 기준 아래로 떨어진 시간 (회수 중단 의심)
    let dip = 0;
    for (let i = 1; i < t.length; i++) if (q[i] < th && q[i - 1] < th) dip += t[i] - t[i - 1];
    return { ...h, t, q, label: h.label.slice(a, b + 1), start: h.label[a], cut: { before: a, after: h.q.length - 1 - b }, th, dip };
  }

  // 사다리꼴 적분: Σ (q_i + q_{i+1}) / 2 × Δt
  function integrate(t, q, unitSec, upTo = Infinity) {
    let v = 0;
    for (let i = 1; i < t.length; i++) {
      if (t[i - 1] >= upTo) break;
      if (t[i] <= upTo) v += (q[i] + q[i - 1]) / 2 * (t[i] - t[i - 1]);
      else { const qc = q[i - 1] + (q[i] - q[i - 1]) * (upTo - t[i - 1]) / (t[i] - t[i - 1]); v += (q[i - 1] + qc) / 2 * (upTo - t[i - 1]); }
    }
    return v / unitSec;
  }

  function summarize(h, unitSec) {
    const dts = h.t.slice(1).map((v, i) => v - h.t[i]);
    const duration = h.t[h.t.length - 1];
    const volume = integrate(h.t, h.q, unitSec);
    const peak = maxOf(h.q);
    return {
      duration, volume, peak,
      meanFlow: duration > 0 ? volume / (duration / unitSec) : NaN,
      tPeak: h.t[h.q.indexOf(peak)],
      n: h.t.length, dt: median(dts), maxGap: maxOf(dts),
    };
  }

  /* ---------- 4. 시간 맞추기 + 대표 곡선 ---------- */
  function interp(t, q, x) {
    if (x < t[0] || x > t[t.length - 1]) return NaN;
    let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
    return t[hi] === t[lo] ? q[lo] : q[lo] + (q[hi] - q[lo]) * (x - t[lo]) / (t[hi] - t[lo]);
  }

  /** mode 'time': 시작 후 경과 시간(초), 끝난 뒤는 0 / 'pct': 각 강번 회수 시간을 0~100%로 */
  function align(heats, mode = 'time') {
    let grid;
    if (mode === 'pct') grid = Array.from({ length: 201 }, (_, i) => i * 0.5);
    else {
      const maxD = maxOf(heats.map(h => h.t[h.t.length - 1]));
      const step = Math.max(median(heats.map(h => h.sum.dt)) || 1, maxD / 600);
      grid = []; for (let x = 0; x <= maxD + 1e-9; x += step) grid.push(+x.toFixed(6));
    }
    const rows = heats.map(h => {
      const D = h.t[h.t.length - 1];
      return grid.map(g => (mode === 'pct' ? interp(h.t, h.q, g / 100 * D) : g > D ? 0 : interp(h.t, h.q, g)));
    });
    const col = j => sorted(rows.map(r => r[j]).filter(Number.isFinite));
    const stat = grid.map((_, j) => { const c = col(j); return { mean: mean(c), median: quantile(c, 0.5), p10: quantile(c, 0.1), p90: quantile(c, 0.9), sd: c.length > 1 ? sd(c) : 0, n: c.length }; });
    const active = grid.map((g, j) => (mode === 'pct' ? heats.length : heats.filter(h => h.t[h.t.length - 1] >= g).length));
    return {
      mode, grid, rows, active,
      mean: stat.map(s => s.mean), median: stat.map(s => s.median), p10: stat.map(s => s.p10), p90: stat.map(s => s.p90), sd: stat.map(s => s.sd),
    };
  }

  /* ---------- 5. 중간 예측: c분까지 회수량 → 최종 회수량 ---------- */
  function early(heats, unitSec) {
    const D = median(heats.map(h => h.sum.duration));
    const cps = [...new Set([0.2, 0.3, 0.4, 0.5, 0.6].map(f => Math.max(30, Math.round(f * D / 30) * 30)))].filter(c => c < D);
    const sdTotal = sd(heats.map(h => h.sum.volume));
    return cps.map(c => {
      const hs = heats.filter(h => h.sum.duration >= c);
      if (hs.length < 6) return null;
      const x = hs.map(h => integrate(h.t, h.q, unitSec, c)), y = hs.map(h => h.sum.volume);
      const m = Reg.fitModel('linear', x, y);
      if (!m) return null;
      m.validation = Reg.validate('linear', x, y, 'spread');
      return { sec: c, n: hs.length, model: m, x, y, ids: hs.map(h => h.id), gain: sdTotal > 0 ? 1 - m.rmse / sdTotal : NaN };
    }).filter(Boolean);
  }

  /* ---------- 6. 전체 분석 ---------- */
  function analyze(sources, cfg) {
    const { heats: raw, warnings } = extract(sources, cfg);
    const unitSec = UNIT_SEC[cfg.flowUnit || 'h'];
    const heats = [], excluded = [];
    const ex = new Set(cfg.exclude || []);
    raw.forEach(h => {
      const tr = trim(h, cfg.thr ?? 0.05);
      if (!tr || tr.t.length < 3) { warnings.push(`${h.id}: 회수 구간을 찾지 못했어요`); return; }
      tr.sum = summarize(tr, unitSec);
      if (tr.sum.duration <= 0) { warnings.push(`${h.id}: 회수 시간이 0이에요`); return; }
      tr.flags = [];
      (ex.has(tr.id) ? excluded : heats).push(tr); // 사용자가 뺀 강번은 계산에서 제외
    });
    if (heats.length < 2) return { excluded, error: heats.length ? '강번이 2개 이상 있어야 비교할 수 있어요' : '강번을 찾지 못했어요. 데이터 모양과 칸 설정을 확인해주세요.', warnings };

    const al = align(heats, cfg.align);
    const vols = heats.map(h => h.sum.volume), durs = heats.map(h => h.sum.duration);
    // 곡선 모양 차이: 중앙값 곡선과의 차이 (중앙값 곡선 평균 대비 %)
    const medMean = mean(al.median.filter(Number.isFinite)) || 1;
    const shape = al.rows.map(r => Math.sqrt(mean(r.map((v, j) => (Number.isFinite(v) && Number.isFinite(al.median[j]) ? (v - al.median[j]) ** 2 : 0)))) / medMean);
    const zV = robustZ(vols), zD = robustZ(durs), zS = robustZ(shape);
    heats.forEach((h, i) => {
      const f = [];
      if (zV[i] > 3) f.push('회수량 많음'); if (zV[i] < -3) f.push('회수량 적음');
      if (zD[i] > 3) f.push('회수 시간 김'); if (zD[i] < -3) f.push('회수 시간 짧음');
      if (zS[i] > 3) f.push('곡선 모양 다름');
      if (h.dip > Math.max(10, h.sum.duration * 0.05)) f.push(`중간 끊김 ${Math.round(h.dip)}초`);
      if (h.sum.maxGap > Math.max(5 * h.sum.dt, 30)) f.push(`기록 빠짐 ${Math.round(h.sum.maxGap)}초`);
      h.flags = f; h.shapeDiff = shape[i]; h.z = { volume: zV[i], duration: zD[i], shape: zS[i] };
    });
    const sv = sorted(vols);
    const stats = {
      n: heats.length, mean: mean(vols), sd: sd(vols), median: quantile(sv, 0.5), min: sv[0], max: sv[sv.length - 1],
      p10: quantile(sv, 0.1), p90: quantile(sv, 0.9),
      durMean: mean(durs), durMin: minOf(durs), durMax: maxOf(durs),
      peakMean: mean(heats.map(h => h.sum.peak)), flowMean: mean(heats.map(h => h.sum.meanFlow)),
    };
    stats.cv = stats.sd / stats.mean;
    // 대표 곡선의 근사식 (x: 분 또는 %)
    const gx = al.grid.map(g => (cfg.align === 'pct' ? g : g / 60));
    const typical = Reg.bestFit(gx, al.mean);
    // 순서에 따른 추세 (설비 상태 변화 등)
    const trend = Reg.fitModel('linear', heats.map((_, i) => i + 1), vols);
    return { heats, excluded, align: al, stats, typical, early: early(heats, unitSec), trend, warnings, unitSec, cfg };
  }

  /* ---------- 7. 강번별 조업 정보와의 관계 ---------- */
  const normId = v => String(v ?? '').trim().replace(/\.0+$/, '').toUpperCase();
  const INTENSITY_RE = /출강|용강|장입|생산|ton|톤|\(t\)|중량/i;

  /** attrText: 첫 칸(또는 강번 칸)이 강번인 표 */
  function factors(res, attrText) {
    if (!attrText || !attrText.trim()) return null;
    const src = readSource({ name: '조업 정보', text: attrText });
    if (!src.tb) return { error: src.error || '조업 정보를 읽을 수 없어요' };
    const tb = src.tb;
    let ki = tb.headers.findIndex(h => HEAT_RE.test(h));
    if (ki < 0) ki = 0;
    const map = new Map(tb.cols[ki].map((v, i) => [normId(v), i]));
    const matched = res.heats.map(h => map.get(normId(h.id)) ?? map.get(normId(h.id.replace(/^.*?([A-Za-z]*\d{3,}).*$/, '$1'))));
    const nMatch = matched.filter(i => i != null).length;
    if (!nMatch) return { error: '조업 정보의 강번과 회수 데이터의 강번이 하나도 맞지 않아요. 강번 표기를 확인해주세요.' };
    const attrs = tb.headers.map((name, j) => ({ name, j })).filter(a => a.j !== ki && tb.kinds[a.j] === 'number')
      .map(a => ({ name: a.name, values: matched.map(i => (i == null ? NaN : Reader.toNumber(tb.cols[a.j][i]))) }));
    const vol = res.heats.map(h => h.sum.volume);
    const rel = attrs.map(a => {
      const r = Reg.pearson(a.values, vol);
      const x = [], y = [];
      a.values.forEach((v, i) => { if (Number.isFinite(v)) { x.push(v); y.push(vol[i]); } });
      const m = x.length >= 4 && new Set(x).size > 1 ? Reg.fitModel('linear', x, y) : null;
      const det = m ? Reg.details(m) : null;
      return { name: a.name, r: r.r, n: r.n, model: m, p: det ? det.coefs[1].p : NaN };
    }).sort((a, b) => Math.abs(b.r || 0) - Math.abs(a.r || 0));
    const usable = attrs.filter(a => a.values.filter(Number.isFinite).length >= 4);
    const multi = usable.length >= 2 ? Reg.multiRegression('회수량', vol, usable) : null;
    const ton = attrs.find(a => INTENSITY_RE.test(a.name));
    const intensity = ton ? res.heats.map((h, i) => (ton.values[i] > 0 ? h.sum.volume / ton.values[i] : NaN)) : null;
    return { attrs, rel, multi, matched: nMatch, total: res.heats.length, unmatched: res.heats.filter((_, i) => matched[i] == null).map(h => h.id), intensity, tonName: ton && ton.name };
  }

  /* ---------- 예시: 전로 가스 회수 12개 강번 (고정 난수) ---------- */
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
      let vol = 1.55 * o2 + 140 * (hm - 85) + rnd() * 700;
      const dipHeat = k === 6;
      const peak = vol / (area * T / 3600) * (dipHeat ? 1.0 : 1);
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

  const Batch = { demo, UNIT_SEC, UNIT_LABEL, readSource, guess, extract, trim, integrate, summarize, align, early, analyze, factors, flowUnitOf, timeUnitOf, quantile, robustZ, interp };
  if (typeof module !== 'undefined' && module.exports) module.exports = Batch;
  else root.Batch = Batch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
