/* ================================================================
 * control.js — 운전 조작 판단 학습 (운전자 암묵지 → 규칙·식)
 *
 * 운전 기록(시간별 순시값)에서 "운전자가 어떤 상태를 보고 조작 항목을
 * 언제, 어느 쪽으로, 얼마나 바꿨는지"를 배워서 형식화한다.
 *   1) 판단 규칙 (회귀 나무): "압력 < 4.92 이고 수요 변화 ≥ 40 이면 → 올림 (이런 때 23% 조작, 평소의 15배)"
 *      규칙의 결론은 평균 조작량이 아니라 "그 상황에서 조작한 비율"과 "조작할 때의 보통 폭"으로 정한다.
 *      (운전자는 늘 조작하지 않으므로 평균을 내면 거의 0이 되어 '유지'로 묻혀 버린다)
 *   2) 선형 식: 조작량 = b0 + Σ b·(상태)  (의미 없는 항은 단계적으로 제거, 모두 의미 없으면 식 없음)
 * 검증은 시간 순서를 지키는 블록 교차검증(앞 블록으로 배우고 다음 블록을 맞힘)으로,
 * "조작 안 함" 기준과 비교한다.
 *
 * 가정: 운전자는 "직전 상태"를 보고 "다음 조작"을 했다. 상태(t−1) → 조작(t).
 * 측정 잡음은 조작이 아니다: 조작으로 볼 최소 폭(데드밴드)을 잡음 수준보다 크게 잡는다.
 *
 * 브라우저: window.Control / Node: require('./control.js')
 * ================================================================ */
(function (root) {
  'use strict';
  const Reg = root.Regression || (typeof require === 'function' ? require('./regression.js') : null);
  const { mean, sum, minOf, maxOf } = Reg;
  const median = a => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const rmse = (a, b) => (a.length ? Math.sqrt(mean(a.map((v, i) => (v - b[i]) ** 2))) : NaN);
  const dirOf = (d, db) => (d > db ? 1 : d < -db ? -1 : 0);

  /* ---------- 1. 학습용 표 ----------
   * series: [{ name, values }] (시간 순서), mv: 조작 항목 번호, inputs: 판단 근거 항목 번호들
   * window: 추세를 볼 칸 수, t: 각 줄의 시각(초, 없으면 줄 번호) — 시간이 끊긴 곳은 건너뛴다 */
  function buildFeatures(series, { mv, inputs, window = 5, windowLabel, t } = {}) {
    const V = series[mv].values, n = V.length;
    const w = Math.max(1, Math.floor(Number(window)) || 1);
    const wl = windowLabel || `${w}칸`;
    const tt = t && t.length === n ? t : V.map((_, i) => i);
    const steps = []; for (let i = 1; i < n; i++) { const d = tt[i] - tt[i - 1]; if (d > 0) steps.push(d); }
    const dt = median(steps) || 1;
    const defs = [];
    inputs.forEach(i => {
      defs.push({ key: `L${i}`, var: series[i].name, kind: 'level', label: `${series[i].name}` });
      defs.push({ key: `T${i}`, var: series[i].name, kind: 'trend', label: `${series[i].name} 최근 ${wl} 변화` });
    });
    defs.push({ key: 'MV', var: series[mv].name, kind: 'level', label: `현재 ${series[mv].name}` });
    const X = [], y = [], prev = [], at = [];
    let gapRows = 0, cand = 0;
    const finite = inputs.map(() => 0);
    for (let k = w + 1; k < n; k++) {
      // 바로 앞 줄과의 간격이나 추세 창이 시간 빈틈을 건너면 쓰지 않는다
      const d1 = tt[k] - tt[k - 1], dw = tt[k - 1] - tt[k - 1 - w];
      if (!(d1 > 0 && d1 <= 3 * dt && dw <= 1.5 * w * dt + 1e-9)) { gapRows++; continue; }
      cand++;
      const row = [];
      inputs.forEach((i, q) => {
        const s = series[i].values;
        row.push(s[k - 1], s[k - 1] - s[k - 1 - w]);
        if (Number.isFinite(s[k - 1]) && Number.isFinite(s[k - 1 - w])) finite[q]++;
      });
      row.push(V[k - 1]);
      const target = V[k] - V[k - 1];
      if (row.every(Number.isFinite) && Number.isFinite(target)) { X.push(row); y.push(target); prev.push(V[k - 1]); at.push(k); }
    }
    // 변하지 않는 특징은 뺀다
    const keep = defs.map((_, j) => { let lo = Infinity, hi = -Infinity; for (const r of X) { if (r[j] < lo) lo = r[j]; if (r[j] > hi) hi = r[j]; } return hi > lo; });
    const kd = defs.filter((_, j) => keep[j]);
    const Xk = X.map(r => r.filter((_, j) => keep[j]));
    const ranges = kd.map((_, j) => { let lo = Infinity, hi = -Infinity; for (const r of Xk) { if (r[j] < lo) lo = r[j]; if (r[j] > hi) hi = r[j]; } return [lo, hi]; });
    return {
      mvName: series[mv].name, window: w, windowLabel: wl, dt,
      defs: kd, X: Xk, y, prev, at, ranges, gapRows,
      coverage: inputs.map((i, q) => ({ name: series[i].name, frac: cand ? finite[q] / cand : 0 })),
    };
  }

  /** 조작으로 볼 최소 폭: 측정 잡음보다 크고, 운전자 조작 폭의 절반 이상
   *  잡음 = 모든 변화량(0 포함)의 중앙값 + 4×(강건 표준편차) */
  function deadbandOf(y) {
    const a = y.map(Math.abs);
    const med = median(a);
    const mad = median(a.map(v => Math.abs(v - med))) * 1.4826;
    const noise = med + 4 * mad;
    const nz = a.filter(v => v > Math.max(noise, 1e-12));
    const half = nz.length ? median(nz) * 0.5 : 0;
    return Math.max(noise, half, 1e-9);
  }

  /* ---------- 2. 판단 규칙 (회귀 나무, 조작 비율로 결론) ---------- */
  function fitTree(F, rows, { maxDepth = 3, minLeaf, db } = {}) {
    rows = rows || F.y.map((_, i) => i);
    const X = F.X, y = F.y, p = F.defs.length;
    const acts = rows.filter(i => Math.abs(y[i]) > db).length;
    // 잎의 최소 크기: 조작 횟수에 맞춰 (드문 조작이 큰 잎에 묻히지 않게)
    const ml = minLeaf || Math.max(5, Math.round(Math.min(rows.length * 0.05, Math.max(5, acts * 0.5))));
    const sseOf = idx => { let s = 0, s2 = 0; for (const i of idx) { s += y[i]; s2 += y[i] * y[i]; } return s2 - s * s / (idx.length || 1); };
    const importance = new Array(p).fill(0);
    function leafInfo(idx) {
      let s = 0, s2 = 0; const ups = [], downs = [];
      for (const i of idx) { s += y[i]; s2 += y[i] * y[i]; if (y[i] > db) ups.push(y[i]); else if (y[i] < -db) downs.push(y[i]); }
      const m = s / idx.length;
      return { n: idx.length, value: m, sd: Math.sqrt(Math.max(0, s2 / idx.length - m * m)), up: ups.length / idx.length, down: downs.length / idx.length, upStep: ups.length ? median(ups) : 0, downStep: downs.length ? median(downs) : 0, nUp: ups.length, nDown: downs.length };
    }
    function build(idx, depth) {
      const node = leafInfo(idx);
      if (depth >= maxDepth || idx.length < 2 * ml) return node;
      const parent = sseOf(idx);
      let best = null;
      for (let j = 0; j < p; j++) {
        const s = Int32Array.from(idx).sort((a, b) => X[a][j] - X[b][j]);
        let sl = 0, sl2 = 0, st = 0, st2 = 0;
        for (const i of s) { st += y[i]; st2 += y[i] ** 2; }
        for (let k = 0; k < s.length - 1; k++) {
          const v = y[s[k]]; sl += v; sl2 += v * v;
          const nl = k + 1, nr = s.length - nl;
          if (nl < ml || nr < ml) continue;
          const a = X[s[k]][j], b = X[s[k + 1]][j];
          if (a === b) continue;
          const e = (sl2 - sl * sl / nl) + ((st2 - sl2) - (st - sl) ** 2 / nr);
          if (!best || e < best.e) best = { e, j, thr: (a + b) / 2 };
        }
      }
      // 나눠서 줄어드는 오차가 우연이라고 보기 어려울 만큼 클 때만 나눈다 (F ≥ 12, 대략 p < 0.001)
      if (!best || !(parent - best.e > 0) || (parent - best.e) / (Math.max(best.e, 1e-300) / (idx.length - 2)) < 12) return node;
      importance[best.j] += parent - best.e;
      node.j = best.j; node.thr = best.thr;
      node.left = build(idx.filter(i => X[i][best.j] < best.thr), depth + 1);
      node.right = build(idx.filter(i => X[i][best.j] >= best.thr), depth + 1);
      return node;
    }
    const tree = build(rows, 0);
    const imp = sum(importance) || 1;
    const base = leafInfo(rows);
    return { tree, importance: importance.map(v => v / imp), minLeaf: ml, maxDepth, base: { up: base.up, down: base.down, N: base.n, nUp: base.nUp, nDown: base.nDown } };
  }

  /** 잎의 결론: 그 상황에서 한쪽으로 조작한 비율이 다른 상황보다 뚜렷하게 높으면(2배 이상, 10% 이상, 3번 이상)
   *  그 방향. 폭은 그때 운전자가 보통 바꾼 폭 */
  function decide(leaf, base) {
    // 이 잎 밖(나머지 상황)에서 같은 방향으로 조작한 비율
    const rest = (cnt, rate) => (base.N > leaf.n ? (cnt - (rate === 'up' ? leaf.nUp : leaf.nDown)) / (base.N - leaf.n) : base[rate]);
    const hot = (rate, cnt, other, restRate) => cnt >= 3 && (rate >= 0.5 || (rate >= 0.1 && rate >= 2 * restRate)) && rate >= 3 * other;
    const upHot = hot(leaf.up, leaf.nUp, leaf.down, rest(base.nUp, 'up'));
    const downHot = hot(leaf.down, leaf.nDown, leaf.up, rest(base.nDown, 'down'));
    if (upHot) return { dir: 1, delta: leaf.upStep, rate: leaf.up };
    if (downHot) return { dir: -1, delta: leaf.downStep, rate: leaf.down };
    return { dir: 0, delta: 0, rate: 1 - leaf.up - leaf.down };
  }

  function treeLeaf(node, x) {
    const path = [];
    while (node.left) {
      const goLeft = x[node.j] < node.thr;
      path.push({ j: node.j, op: goLeft ? '<' : '≥', thr: node.thr });
      node = goLeft ? node.left : node.right;
    }
    return { leaf: node, path };
  }
  const predictTree = (T, x) => decide(treeLeaf(T.tree, x).leaf, T.base).delta;

  function simplifyPath(path) {
    const by = new Map();
    path.forEach(c => {
      const b = by.get(c.j) || { j: c.j, lo: -Infinity, hi: Infinity };
      if (c.op === '<') b.hi = Math.min(b.hi, c.thr); else b.lo = Math.max(b.lo, c.thr);
      by.set(c.j, b);
    });
    return [...by.values()];
  }

  function treeRules(T) {
    const out = [];
    (function walk(node, path) {
      if (!node.left) { out.push({ conds: simplifyPath(path), ...node, decision: decide(node, T.base) }); return; }
      walk(node.left, [...path, { j: node.j, op: '<', thr: node.thr }]);
      walk(node.right, [...path, { j: node.j, op: '≥', thr: node.thr }]);
    })(T.tree, []);
    return out;
  }

  /* ---------- 3. 선형 식 (단계적 제거) ---------- */
  function fitLinear(F, rows, { pMax = 0.05 } = {}) {
    rows = rows || F.y.map((_, i) => i);
    const y = rows.map(r => F.y[r]);
    if (Reg.isConstant(y)) return null;
    const mvIdx = F.defs.findIndex(d => d.key === 'MV');
    // 이 구간에서 변하지 않는 특징은 미리 뺀다
    let use = F.defs.map((_, j) => j).filter(j => !Reg.isConstant(rows.map(r => F.X[r][j])));
    const removed = [];
    for (let guard = 0; guard < 60 && use.length; guard++) {
      const preds = use.map(j => ({ name: F.defs[j].label, values: rows.map(r => F.X[r][j]) }));
      const m = Reg.multiRegression(F.mvName, y, preds);
      if (!m) return null;
      if (m.error) {
        // 겹치는 항목 중 하나만 뺀다 (현재 조작값은 되도록 남김)
        const names = m.overlap && m.overlap.length ? m.overlap : m.constant || [];
        const cand = use.filter(j => names.includes(F.defs[j].label));
        const drop = cand.filter(j => j !== mvIdx).pop() ?? cand.pop() ?? use.filter(j => j !== mvIdx).pop() ?? use[use.length - 1];
        removed.push({ name: F.defs[drop].label, why: '다른 항목과 겹침' });
        use = use.filter(j => j !== drop);
        continue;
      }
      const det = Reg.details(m);
      const worst = det.coefs.slice(1).map((c, k) => ({ k, p: c.p })).sort((a, b) => (b.p || 0) - (a.p || 0))[0];
      if (worst && worst.p > pMax) {
        if (use.length === 1) return null; // 남은 항도 의미 없음 → 선형 관계 없음
        use = use.filter((_, k) => k !== worst.k);
        continue;
      }
      return { model: m, use, det, removed };
    }
    return null;
  }
  const predictLinear = (L, x) => L.model.predict(L.use.map(j => x[j]));

  /* ---------- 4. 검증: 시간 블록 교차검증 (앞 블록들로 배우고 다음 블록을 맞힘) ---------- */
  function evaluate(F, db, opts = {}) {
    const n = F.y.length, K = 4;
    const bounds = Array.from({ length: K + 1 }, (_, k) => Math.round(n * k / K));
    const truth = [], base = [], pl = [], pt = [], at = [];
    let folds = 0;
    for (let k = 1; k < K; k++) {
      const train = [...Array(bounds[k]).keys()], test = [];
      for (let i = bounds[k]; i < bounds[k + 1]; i++) test.push(i);
      if (train.length < 20 || !test.length) continue;
      const trainActs = train.filter(i => Math.abs(F.y[i]) > db).length;
      if (trainActs < 3) continue;
      const tree = fitTree(F, train, { ...opts, db });
      const lin = fitLinear(F, train, opts);
      folds++;
      for (const i of test) {
        truth.push(F.y[i]); base.push(0); at.push(F.at[i]);
        pt.push(predictTree(tree, F.X[i]));
        pl.push(lin ? predictLinear(lin, F.X[i]) : NaN);
      }
    }
    if (!folds) return null;
    const acted = truth.map((v, k) => k).filter(k => dirOf(truth[k], db) !== 0);
    const dirAcc = pred => (pred.every(Number.isFinite) ? mean(truth.map((v, k) => +(dirOf(pred[k], db) === dirOf(v, db)))) : NaN);
    const actAcc = pred => (acted.length && pred.every(Number.isFinite) ? mean(acted.map(k => +(dirOf(pred[k], db) === dirOf(truth[k], db)))) : NaN);
    // 규칙이 "조작"이라고 한 때 실제로 같은 방향 조작이 있었던 비율
    const precision = pred => { const said = pred.map((v, k) => k).filter(k => dirOf(pred[k], db) !== 0); return said.length ? mean(said.map(k => +(dirOf(pred[k], db) === dirOf(truth[k], db)))) : NaN; };
    return {
      folds, nTest: truth.length, acted: acted.length,
      rmse: { base: rmse(truth, base), linear: pl.every(Number.isFinite) ? rmse(truth, pl) : NaN, tree: rmse(truth, pt) },
      direction: { base: dirAcc(base), linear: dirAcc(pl), tree: dirAcc(pt) },
      actedDirection: { base: acted.length ? 0 : NaN, linear: actAcc(pl), tree: actAcc(pt) },
      precision: { linear: precision(pl), tree: precision(pt) },
      series: { at, truth, linear: pl, tree: pt },
    };
  }

  /* ---------- 5. 전체 학습 ---------- */
  function learn(series, opts) {
    // 값이 절반도 없는 근거 항목(분석계 30분 간격 등)은 빼고 알린다
    let inputs = [...opts.inputs];
    const probe = buildFeatures(series, { ...opts, inputs });
    const sparse = probe.coverage.filter(c => c.frac < 0.5).map(c => c.name);
    if (sparse.length && sparse.length < inputs.length) inputs = inputs.filter(i => !sparse.includes(series[i].name));
    const F = sparse.length && sparse.length < opts.inputs.length ? buildFeatures(series, { ...opts, inputs }) : probe;
    const warnings = [];
    if (sparse.length && sparse.length < opts.inputs.length) warnings.push(`값이 있는 줄이 절반도 안 되는 항목(${sparse.join(', ')})은 빼고 계산했어요`);
    if (F.gapRows) warnings.push(`기록이 끊긴 곳에 걸친 ${F.gapRows}줄은 쓰지 않았어요`);
    if (F.y.length < 20) {
      const low = probe.coverage.slice().sort((a, b) => a.frac - b.frac).slice(0, 2).map(c => `${c.name} ${Math.round(c.frac * 100)}%`);
      return { error: `조작 판단을 배우려면 쓸 수 있는 줄이 20줄 이상 필요해요 (지금 ${F.y.length}줄). 값이 비어 있는 항목: ${low.join(', ')}`, warnings };
    }
    if (!F.defs.length) return { error: '판단 근거로 쓸 항목이 변하지 않아요', warnings };
    const db = Number.isFinite(opts.deadband) && opts.deadband > 0 ? opts.deadband : deadbandOf(F.y);
    const acts = F.y.map(v => dirOf(v, db));
    const up = acts.filter(a => a > 0).length, down = acts.filter(a => a < 0).length;
    if (up + down === 0) return { error: `${F.mvName}이(가) 기록 기간 동안 (${+db.toPrecision(3)}보다 크게) 한 번도 바뀌지 않아서 판단을 배울 수 없어요. 다른 조작 항목을 고르거나 더 긴 기록을 넣어주세요.`, warnings, deadband: db };
    if (up + down < 5) return { error: `${F.mvName}을(를) 조작한 기록이 ${up + down}번뿐이라 판단을 배우기 어려워요 (최소 5번, 10번 이상 권장). 더 긴 기록을 넣어주세요.`, warnings, deadband: db };
    if (up + down < 10) warnings.push(`조작 기록이 ${up + down}번뿐이라 규칙을 믿기 어려워요 (10번 이상 권장)`);
    // 조작 항목이 계속 흔들리면: 잡음·보간값·자동 제어 출력일 수 있다
    if ((up + down) / F.y.length > 0.3) warnings.push(`조작으로 본 줄이 ${Math.round((up + down) / F.y.length * 100)}%예요. 조작 항목이 계속 흔들려요: 측정 잡음, 보간된 값, 자동(PID) 출력이면 운전자 조작이 아니에요. "조작으로 볼 최소 폭"을 키워 보세요`);
    // 이산 조작 (펌프 기동/정지, 운전 대수)
    const levelsAll = [...new Set(series[opts.mv].values.filter(Number.isFinite))].sort((a, b) => a - b);
    const discrete = levelsAll.length <= 5 ? levelsAll : null;

    const tree = fitTree(F, null, { db });
    const linear = fitLinear(F, null);
    const ev = evaluate(F, db);
    let learned = null;
    if (ev && ev.acted > 0) {
      const best = Math.max(ev.actedDirection.tree || 0, ev.actedDirection.linear || 0);
      learned = best >= 0.5 || Math.min(ev.rmse.tree, Number.isFinite(ev.rmse.linear) ? ev.rmse.linear : Infinity) < ev.rmse.base * 0.95;
    }
    // 추천에 쓸 쪽: 기본은 규칙(판단을 그대로 보여줄 수 있음). 선형 식이 실제 조작 방향을 확실히 더 잘 맞히면 선형
    let pick = 'tree';
    if (ev && linear && Number.isFinite(ev.actedDirection.linear) && ev.actedDirection.linear > (ev.actedDirection.tree || 0) + 0.1 && ev.rmse.linear < ev.rmse.tree) pick = 'linear';
    const absD = F.y.map(Math.abs).filter(v => v > db);
    const mvAll = series[opts.mv].values.filter(Number.isFinite);
    const actions = [];
    F.y.forEach((v, i) => { if (Math.abs(v) > db && actions.length < 500) actions.push({ at: F.at[i], delta: v, before: F.prev[i], after: F.prev[i] + v, x: F.X[i] }); });
    return {
      F, linear, tree, rules: treeRules(tree), evaluation: ev, pick, learned, deadband: db, discrete, warnings, actions,
      dropped: sparse.length && sparse.length < opts.inputs.length ? sparse : [],
      stats: {
        n: F.y.length, up, down, hold: F.y.length - up - down,
        stepMedian: absD.length ? median(absD) : 0, stepMax: absD.length ? maxOf(absD) : 0,
        mvMin: minOf(mvAll), mvMax: maxOf(mvAll),
      },
    };
  }

  const snap = (v, levels) => (levels ? levels.reduce((b, l) => (Math.abs(l - v) < Math.abs(b - v) ? l : b), levels[0]) : v);

  /** 지금 상태로 조작 추천
   *  state: { inputs: { 항목이름: { now, before } }, mvNow }
   *  limits: { min, max, maxStep } — 넘으면 잘라내고 clipped 로 알린다 */
  function recommend(L, state, limits = {}) {
    const F = L.F;
    const lim = { min: limits.min, max: limits.max, maxStep: limits.maxStep };
    if (Number.isFinite(lim.maxStep) && lim.maxStep <= 0) return { error: '한 번 최대 조작량은 0보다 커야 해요' };
    if (Number.isFinite(lim.min) && Number.isFinite(lim.max) && lim.min > lim.max) return { error: '최소값이 최대값보다 커요' };
    const x = F.defs.map(d => {
      if (d.key === 'MV') return state.mvNow;
      const s = state.inputs[d.var] || {};
      return d.kind === 'level' ? s.now : s.now - s.before;
    });
    if (!x.every(Number.isFinite)) return { error: '모든 칸에 숫자를 넣어주세요' };
    // 기록 범위 밖이면 알린다 (그 영역의 판단은 배운 적이 없음)
    // 기록 범위보다 폭의 5% 넘게 벗어날 때만 (끝에서 살짝 넘는 것은 경고하지 않음)
    const outside = F.defs.map((d, j) => ({ d, r: F.ranges[j], v: x[j] })).filter(o => o.r && (o.v < o.r[0] - 0.05 * (o.r[1] - o.r[0]) || o.v > o.r[1] + 0.05 * (o.r[1] - o.r[0])))
      .map(o => ({ label: o.d.label, value: o.v, range: o.r }));
    const tl = treeLeaf(L.tree.tree, x);
    const dec = decide(tl.leaf, L.tree.base);
    const res = { x, outside, tree: { delta: dec.delta, dir: dec.dir, rate: dec.rate, leaf: tl.leaf, conds: simplifyPath(tl.path) }, linear: null };
    if (L.linear) {
      const d = predictLinear(L.linear, x);
      const [lo, hi] = L.linear.model.interval(L.linear.use.map(j => x[j]));
      res.linear = { delta: d, range: [lo, hi] };
    }
    let raw = L.pick === 'linear' && res.linear ? res.linear.delta : dec.delta;
    if (dirOf(raw, L.deadband) === 0) raw = 0;
    let next = state.mvNow + raw;
    if (L.discrete && raw) next = snap(next, L.discrete);
    const clipped = [];
    if (Number.isFinite(lim.max) && next > lim.max) { next = lim.max; clipped.push('최대값'); }
    if (Number.isFinite(lim.min) && next < lim.min) { next = lim.min; clipped.push('최소값'); }
    let delta = next - state.mvNow;
    if (Number.isFinite(lim.maxStep) && Math.abs(delta) > lim.maxStep) { delta = Math.sign(delta) * lim.maxStep; next = state.mvNow + delta; clipped.push('한 번에 바꿀 수 있는 양'); }
    const dir = delta > 0 ? 1 : delta < 0 ? -1 : 0;
    const note = Number.isFinite(lim.min) && state.mvNow < lim.min || Number.isFinite(lim.max) && state.mvNow > lim.max ? '현재 값이 이미 한계 밖이에요' : '';
    return { ...res, raw, delta, next, dir, clipped, note };
  }

  /** 저장용 데이터 (예측 앱에서 쓰기) */
  function serialize(L, extra = {}) {
    const r12 = v => (Number.isFinite(v) ? +v.toPrecision(12) : null);
    // t를 초로 넘겼으면 실제 시간 길이, 아니면 t의 단위(줄 번호·숫자 칸) 그대로
    const { timeIsSeconds = true, ...rest } = extra;
    const span = timeIsSeconds
      ? { sampleSeconds: r12(L.F.dt), windowSeconds: r12(L.F.window * L.F.dt) }
      : { sampleStep: r12(L.F.dt), windowSpan: r12(L.F.window * L.F.dt) };
    const node = n => (n.left ? { j: n.j, thr: r12(n.thr), n: n.n, left: node(n.left), right: node(n.right) }
      : { n: n.n, up: r12(n.up), down: r12(n.down), upStep: r12(n.upStep), downStep: r12(n.downStep), meanDelta: r12(n.value), decision: decide(n, L.tree.base) });
    return {
      kind: 'control', ...rest,
      mv: L.F.mvName, target: 'delta', timing: 'state(t-1) -> action(t)',
      windowRows: L.F.window, ...span, windowLabel: L.F.windowLabel,
      features: L.F.defs.map((d, j) => ({ key: d.key, var: d.var, kind: d.kind, label: d.label, range: L.F.ranges[j].map(r12) })),
      deadband: r12(L.deadband), discreteLevels: L.discrete, pick: L.pick,
      baseRates: { up: r12(L.tree.base.up), down: r12(L.tree.base.down) },
      decisionRule: 'leaf: up if nUp >= 3 and (up >= 0.5 or (up >= 0.1 and up >= 2 * upRateOutsideLeaf)) and up >= 3 * down -> delta = upStep; mirror for down; else hold (delta 0). Each leaf stores its decision.',
      linear: L.linear ? { use: L.linear.use, model: Reg.serialize(L.linear.model) } : null,
      tree: node(L.tree.tree),
      evaluation: L.evaluation ? { folds: L.evaluation.folds, nTest: L.evaluation.nTest, acted: L.evaluation.acted, rmse: L.evaluation.rmse, direction: L.evaluation.direction, actedDirection: L.evaluation.actedDirection, precision: L.evaluation.precision } : null,
    };
  }

  const Control = { buildFeatures, deadbandOf, fitLinear, fitTree, treeRules, decide, evaluate, learn, recommend, serialize, predictTree, predictLinear, dirOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = Control;
  else root.Control = Control;
})(typeof globalThis !== 'undefined' ? globalThis : this);
