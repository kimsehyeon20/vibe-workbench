/* ================================================================
 * balance.js — 가스 홀더 물질수지 · 계측기 편차 찾기 · 여러 계열 합산
 *
 * 홀더에 들어오는 가스(회수)와 나가는 가스(사용처)를 각각 계측하고, 홀더 레벨도 잰다.
 * 계측이 정확하다면 어느 구간에서든
 *     홀더 부피 변화 = Σ 유입 − Σ 유출 (+ 계측되지 않는 손실)
 * 이 맞아야 한다. 실제로는 유량계마다 조금씩 틀리므로, 구간을 여러 개 잡아
 *     c·ΔL = Σ sᵢ·βᵢ·Fᵢ + a·Δt        (sᵢ: 유입 +1, 유출 −1)
 * 을 최소제곱으로 풀어 계측기별 보정계수 βᵢ(실제 = βᵢ × 계측값)를 찾는다.
 *   c  : 레벨 1단위당 홀더 부피 (알면 입력, 모르면 "믿는 계측기" 하나를 기준으로 추정)
 *   a  : 계측되지 않는 순유입 (음수면 손실·누설·계측 안 되는 사용처)
 * 각 계열은 시간축이 달라도 된다: 유량은 구간마다 자기 측정값으로 적분하고,
 * 레벨은 구간 경계 시각에서 보간한다.
 *
 * 브라우저: window.Balance / Node: require('./balance.js')
 * ================================================================ */
(function (root) {
  'use strict';
  const Reader = root.Reader || (typeof require === 'function' ? require('./reader.js') : null);
  const Reg = root.Regression || (typeof require === 'function' ? require('./regression.js') : null);
  const { mean } = Reg;
  const UNIT_SEC = { s: 1, min: 60, h: 3600 };
  const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };

  const ROLE_LABEL = { in: '유입(회수)', out: '사용처(유출)', level: '홀더 레벨', volume: '홀더 부피', ignore: '안 씀' };
  const TAG_RE = /태그|tag|계기|meter|point|항목|이름|name|사용처/i;

  function flowUnitOf(name = '') {
    if (/\/\s*(h|hr|hour)\b|\/\s*시간?|\/hr/i.test(name)) return 'h';
    if (/\/\s*(min|m)\b|\/\s*분/i.test(name)) return 'min';
    if (/\/\s*(s|sec)\b|\/\s*초/i.test(name)) return 's';
    return 'h';
  }
  function guessRole(name = '') {
    if (/온도|압력|temp|press|℃|°c|bar\b|kpa|mmaq|mmh2o|발열량|칼로리|cal|co\s*\(|o2\s*\(|농도/i.test(name)) return 'ignore';
    if (/레벨|level|높이|\blv\b|저장률|충전율/i.test(name)) return 'level';
    if (/부피|용량|volume|재고|저장량/i.test(name)) return 'volume';
    if (/회수|유입|recovery|inlet|발생|입구/i.test(name)) return 'in';
    return 'out';
  }

  /* ---------- 1. 계열 뽑기 (각자 자기 시간축) ---------- */
  function toSec(values, kind) {
    let day = 0, prev = null;
    return values.map(v => {
      if (kind !== 'time') return Reader.toNumber(v);
      const p = Reader.parseTimeCell(v);
      if (!p) return NaN;
      if (p.kind === 'date') return p.v / 1000;
      if (prev != null && p.v + day * 86400 < prev - 43200) day++;
      const s = p.v + day * 86400; prev = s; return s;
    });
  }

  function makeSeries(name, src, t, v) {
    const pts = t.map((a, i) => [a, v[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a, b) => a[0] - b[0]);
    // 같은 시각이 겹치면 마지막 값
    const out = [];
    pts.forEach(p => { if (out.length && out[out.length - 1][0] === p[0]) out[out.length - 1] = p; else out.push(p); });
    return { name, src, t: out.map(p => p[0]), v: out.map(p => p[1]) };
  }

  /** sources: [{ name, text }] → { series, warnings, timeKind } */
  function extract(sources) {
    const series = [], warnings = [];
    let relTime = false;
    for (const src of sources) {
      const prep = Reader.prepareGrid(Reader.parseText(src.text), 'auto');
      const tb = Reader.buildTable(prep.rows);
      if (tb.error) { warnings.push(`${src.name}: ${tb.error}`); continue; }
      const ti = tb.kinds.indexOf('time') >= 0 ? tb.kinds.indexOf('time') : Reader.guessTimeCol(tb);
      if (ti < 0) { warnings.push(`${src.name}: 시각 칸을 찾지 못했어요`); continue; }
      if (tb.kinds[ti] !== 'time') relTime = true;
      const t = toSec(tb.cols[ti], tb.kinds[ti]);
      // 긴 표: 태그 칸 + 값 칸
      const tag = tb.headers.findIndex((h, j) => j !== ti && tb.kinds[j] === 'text' && (TAG_RE.test(h) || new Set(tb.cols[j]).size <= Math.max(2, tb.body.length / 5)));
      const nums = tb.headers.map((_, j) => j).filter(j => j !== ti && tb.kinds[j] === 'number');
      if (tag >= 0 && nums.length) {
        const vj = nums[0], groups = new Map();
        tb.cols[tag].forEach((k, i) => { k = String(k).trim(); if (!k) return; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
        for (const [k, idx] of groups) series.push({ ...makeSeries(k, src.name, idx.map(i => t[i]), idx.map(i => Reader.toNumber(tb.cols[vj][i]))), hint: tb.headers[vj] });
      } else nums.forEach(j => series.push(makeSeries(tb.headers[j], src.name, t, tb.cols[j].map(Reader.toNumber))));
    }
    // 이름이 겹치면 파일 이름을 붙인다
    const cnt = {};
    series.forEach(s => { cnt[s.name] = (cnt[s.name] || 0) + 1; });
    series.forEach(s => { if (cnt[s.name] > 1) s.name = `${s.name} (${s.src})`; });
    series.forEach(s => { s.dt = median(s.t.slice(1).map((v, i) => v - s.t[i])); s.role = guessRole(s.name); s.unit = flowUnitOf(`${s.name} ${s.hint || ''}`); });
    if (relTime && sources.length > 1) warnings.push('시각이 아닌 숫자 시간 칸이 있어요. 파일끼리 시작 시각이 같다고 보고 맞췄어요');
    return { series: series.filter(s => s.t.length >= 2), warnings };
  }

  /* ---------- 2. 적분·보간 ---------- */
  function lowerIdx(t, x) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } return lo; }
  function valueAt(s, x) {
    if (x < s.t[0] || x > s.t[s.t.length - 1]) return NaN;
    const i = lowerIdx(s.t, x);
    if (s.t[i] === x) return s.v[i];
    const a = i - 1;
    return s.v[a] + (s.v[i] - s.v[a]) * (x - s.t[a]) / (s.t[i] - s.t[a]);
  }
  /** 유량 계열을 [a, b] 구간에서 적분 (단위: 부피). 구간을 다 덮지 못하면 NaN */
  function integrate(s, a, b, unitSec = 3600) {
    if (a < s.t[0] || b > s.t[s.t.length - 1] || b <= a) return NaN;
    let i = lowerIdx(s.t, a);
    let px = a, pv = valueAt(s, a), sum = 0, gap = 0;
    for (; i < s.t.length && s.t[i] < b; i++) {
      if (s.t[i] <= a) continue;
      sum += (pv + s.v[i]) / 2 * (s.t[i] - px); gap = Math.max(gap, s.t[i] - px);
      px = s.t[i]; pv = s.v[i];
    }
    const bv = valueAt(s, b);
    sum += (pv + bv) / 2 * (b - px); gap = Math.max(gap, b - px);
    return { v: sum / unitSec, gap };
  }

  /* ---------- 3. 수지 분석 ---------- */
  /** cfg: { use: 이름[] (안 쓸 계열 빼고), window: 초, levelFactor: 숫자|null, reference: 이름 } */
  function analyze(all, cfg = {}) {
    const used = all.filter(s => s.role !== 'ignore');
    const flows = used.filter(s => s.role === 'in' || s.role === 'out');
    const holder = used.find(s => s.role === 'volume') || used.find(s => s.role === 'level');
    if (!flows.length) return { error: '유입이나 사용처(유량) 계열이 하나도 없어요' };
    const T0 = Math.max(...used.map(s => s.t[0])), T1 = Math.min(...used.map(s => s.t[s.t.length - 1]));
    if (!(T1 > T0)) return { error: '모든 계열이 함께 기록된 시간이 없어요. 시각이 겹치는지 확인해주세요' };
    const sign = s => (s.role === 'in' ? 1 : -1);
    const us = s => UNIT_SEC[s.unit || 'h'];

    // 전체 기간 합계
    const totals = flows.map(s => { const r = integrate(s, T0, T1, us(s)); return { name: s.name, role: s.role, volume: r.v, mean: r.v / ((T1 - T0) / us(s)), maxGap: r.gap, dt: s.dt, n: s.t.length }; });
    const tin = totals.filter(x => x.role === 'in').reduce((a, x) => a + x.volume, 0);
    const tout = totals.filter(x => x.role === 'out').reduce((a, x) => a + x.volume, 0);
    const holderKind = holder ? holder.role : null;
    let factor = holderKind === 'volume' ? 1 : Number.isFinite(cfg.levelFactor) && cfg.levelFactor > 0 ? cfg.levelFactor : null;
    const dLevel = holder ? valueAt(holder, T1) - valueAt(holder, T0) : NaN;

    // 구간 나누기
    const span = T1 - T0;
    const W = cfg.window || pickWindow(span);
    const wins = [];
    for (let a = T0; a + W <= T1 + 1e-9; a += W) wins.push([a, a + W]);
    const rows = wins.map(([a, b]) => {
      const F = flows.map(s => { const r = integrate(s, a, b, us(s)); return r && r.gap <= Math.max(W / 2, 3 * s.dt) ? r.v : NaN; });
      const L = holder ? valueAt(holder, b) - valueAt(holder, a) : NaN;
      return { a, b, F, L };
    });
    const ok = rows.filter(r => r.F.every(Number.isFinite) && (!holder || Number.isFinite(r.L)));

    const res = {
      T0, T1, window: W, flows: flows.map(s => s.name), roles: flows.map(s => s.role), holder: holder && holder.name, holderKind,
      totals, tin, tout, dLevel, rows, used: ok.length, skipped: rows.length - ok.length, warnings: [],
    };
    if (!holder) { res.note = '홀더 레벨(또는 부피) 계열이 없어서 합계만 계산했어요'; return res; }
    if (ok.length < flows.length + 4) { res.note = `수지 회귀를 하려면 구간이 ${flows.length + 4}개 이상 필요해요 (지금 ${ok.length}개). 구간 길이를 줄이거나 더 긴 기간의 데이터를 넣어주세요`; return res; }

    // 회귀
    const ref = factor == null ? (flows.find(s => s.name === cfg.reference) || flows.find(s => s.role === 'in') || flows[0]) : null;
    let model, beta = [], aRate, aCI, cEst = null, cCI = null, det;
    const tc = n => Reg.t975(n);
    if (factor != null) {
      // c 를 안다: c·ΔL = Σ s·β·F + a·W
      const y = ok.map(r => factor * r.L);
      const preds = flows.map((s, i) => ({ name: s.name, values: ok.map(r => sign(s) * r.F[i]) }));
      model = Reg.multiRegression('홀더 부피 변화', y, preds);
      if (!model || model.error) return { ...res, error: model ? model.error : '회귀를 할 수 없어요' };
      det = Reg.details(model);
      flows.forEach((s, i) => { const c = det.coefs[i + 1]; beta.push({ name: s.name, role: s.role, est: c.est, se: c.se, lo: c.lo, hi: c.hi, vif: c.vif, ref: false }); });
      aRate = det.coefs[0].est / (W / 3600); aCI = [det.coefs[0].lo / (W / 3600), det.coefs[0].hi / (W / 3600)];
    } else {
      // c 를 모른다: 기준 계측기 r 을 믿는다 (β_r = 1)
      //   s_r·F_r = c·ΔL − Σ_{i≠r} s_i·β_i·F_i − a·W
      const ri = flows.indexOf(ref);
      const y = ok.map(r => sign(ref) * r.F[ri]);
      const others = flows.filter((_, i) => i !== ri);
      const preds = [{ name: `${holder.name} 변화`, values: ok.map(r => r.L) }, ...others.map(s => ({ name: s.name, values: ok.map(r => sign(s) * r.F[flows.indexOf(s)]) }))];
      model = Reg.multiRegression(ref.name, y, preds);
      if (!model || model.error) return { ...res, error: model ? model.error : '회귀를 할 수 없어요' };
      det = Reg.details(model);
      cEst = det.coefs[1].est; cCI = [det.coefs[1].lo, det.coefs[1].hi];
      flows.forEach(s => {
        if (s === ref) { beta.push({ name: s.name, role: s.role, est: 1, se: 0, lo: 1, hi: 1, vif: null, ref: true }); return; }
        const c = det.coefs[2 + others.indexOf(s)];
        beta.push({ name: s.name, role: s.role, est: -c.est, se: c.se, lo: -c.hi, hi: -c.lo, vif: c.vif, ref: false });
      });
      aRate = -det.coefs[0].est / (W / 3600); aCI = [-det.coefs[0].hi / (W / 3600), -det.coefs[0].lo / (W / 3600)];
      factor = cEst;
    }
    // β = 1 검정 (계측기가 맞는가)
    beta.forEach(b => {
      if (b.ref) { b.p = NaN; return; }
      const t = (b.est - 1) / b.se;
      b.p = Reg.tP(t, det.df);
      b.readErr = 1 / b.est - 1; // 계측값이 실제보다 몇 % 많이(+) / 적게(−) 읽나
      // 판정: 통계적으로 1과 다르고(p < 0.05) 실무 허용 오차(기본 1%)보다 크면 "편차 있음"
      const tol = cfg.tol ?? 0.01;
      b.verdict = b.p < 0.05 && Math.abs(b.readErr) > tol ? 'bias' : b.p < 0.05 ? 'small' : 'ok';
    });

    // 누적 곡선: 계측값 그대로 vs 보정 후 vs 홀더
    let cm = 0, cc = 0;
    const cum = ok.map(r => {
      flows.forEach((s, i) => { cm += sign(s) * r.F[i]; cc += sign(s) * beta[i].est * r.F[i]; });
      cc += aRate * (W / 3600);
      return { t: r.b, metered: cm, corrected: cc, holder: factor * (valueAt(holder, r.b) - valueAt(holder, ok[0].a)) };
    });
    // 구간별 불일치 (계측값 그대로)
    const imb = ok.map(r => factor * r.L - flows.reduce((a2, s, i) => a2 + sign(s) * r.F[i], 0));
    const dV = factor * dLevel;
    return {
      ...res, model, det, beta, aRate, aCI, factor, factorEstimated: cEst != null, cCI, reference: ref && ref.name,
      cum, imbalance: ok.map((r, k) => ({ t: r.b, v: imb[k] })), windows: ok,
      dV, gap: tin - tout - dV, gapPct: (tin - tout - dV) / Math.max(tin, tout),
      r2: model.r2,
    };
  }

  function pickWindow(span) {
    const cands = [5, 10, 15, 30, 60, 120, 240].map(m => m * 60);
    return cands.find(w => span / w <= 120 && span / w >= 20) || cands.filter(w => span / w >= 8).pop() || Math.max(60, span / 8);
  }

  /* ---------- 4. 공통 시간축 표 ---------- */
  function commonGrid(all, T0, T1, maxRows = 20000) {
    const used = all.filter(s => s.role !== 'ignore');
    let step = Math.max(10, Math.min(600, Math.max(...used.map(s => s.dt || 60))));
    while ((T1 - T0) / step > maxRows) step *= 2;
    const grid = []; for (let x = T0; x <= T1 + 1e-9; x += step) grid.push(x);
    return { step, grid, cols: used.map(s => ({ name: s.name, role: s.role, unit: s.unit, v: grid.map(x => valueAt(s, x)) })) };
  }

  /* ---------- 예시: 홀더 1기, 회수 1, 사용처 3 (24시간, 계열마다 기록 간격이 다름) ---------- */
  function demo() {
    let seed = 5;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const p2 = n => String(n).padStart(2, '0');
    const stamp = s => `2026-10-01 ${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(Math.floor(s % 60))}`.replace('2026-10-01', s >= 86400 ? '2026-10-02' : '2026-10-01');
    const FACTOR = 1200; // 레벨 1% = 1200 Nm³
    const BIAS = { 발전소: 1.04, 열연가열로: 0.97, 보일러: 1.0 }; // 계측값 = 실제 × BIAS
    const LOSS = 500; // 계측 안 되는 손실 Nm³/h
    const dt = 1, T = 24 * 3600;
    let V = 60 * FACTOR, boiler = 1;
    const rec = [], use = { 발전소: [], 열연가열로: [], 보일러: [] }, lev = [];
    for (let s = 0; s <= T; s += dt) {
      const ph = s % 2400; // 40분마다 전로 회수 10분
      const qin = ph < 600 ? 150000 * (1 - Math.exp(-ph / 60)) * (1 - (ph / 600) ** 6) : 0;
      const level = V / FACTOR;
      if (s % 1800 === 0) boiler = rnd() > -0.2 ? 1 : 0;
      const q = {
        발전소: Math.max(5000, 20000 + 600 * (level - 55) + 2500 * Math.sin(s / 5000)),
        열연가열로: 12000 + 3500 * Math.sin(s / 9000 + 1) + 1500 * Math.sin(s / 1700),
        보일러: boiler * (5500 + 800 * Math.sin(s / 2500)),
      };
      V += (qin - q.발전소 - q.열연가열로 - q.보일러 - LOSS) * dt / 3600;
      if (s % 5 === 0) rec.push([s, qin * (1 + rnd() * 0.01)]);
      if (s % 60 === 17) Object.keys(q).forEach(k => use[k].push([s, q[k] * BIAS[k] * (1 + rnd() * 0.01)]));
      if (s % 30 === 0) lev.push([s, Math.round((V / FACTOR + rnd() * 0.04) * 100) / 100]);
    }
    const toText = (head, arr) => [head, ...arr.map(([s, v]) => `${stamp(s)}\t${typeof v === 'number' ? +v.toFixed(1) : v}`)].join('\n');
    const usesText = ['시각\t사용처\t유량(Nm3/h)', ...Object.keys(use).flatMap(k => use[k].map(([s, v]) => `${stamp(s)}\t${k}\t${v.toFixed(0)}`))].join('\n');
    return {
      sources: [
        { name: '전로회수.csv', text: toText('시각\t회수유량(Nm3/h)', rec) },
        { name: '사용처유량.csv', text: usesText },
        { name: '홀더레벨.csv', text: toText('시각\t홀더레벨(%)', lev) },
      ],
      levelFactor: FACTOR, truth: { bias: BIAS, loss: LOSS },
    };
  }

  const Balance = { ROLE_LABEL, UNIT_SEC, extract, guessRole, flowUnitOf, valueAt, integrate, analyze, pickWindow, commonGrid, demo };
  if (typeof module !== 'undefined' && module.exports) module.exports = Balance;
  else root.Balance = Balance;
})(typeof globalThis !== 'undefined' ? globalThis : this);
