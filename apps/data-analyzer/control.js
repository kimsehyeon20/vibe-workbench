/* ================================================================
 * control.js — 운전 조작 판단 학습 (운전자 암묵지 → 식·규칙)
 *
 * 운전 기록(시간별 순시값)에서 "운전자가 어떤 상태를 보고 조작 항목을
 * 얼마나 바꿨는지"를 배워서 두 가지로 형식화한다.
 *   1) 선형 식  : 조작량 = b0 + Σ b·(상태)   (의미 없는 항은 단계적으로 제거)
 *   2) 판단 규칙: "압력 < 4.92 이고 수요 변화 ≥ 40 이면 → 개도 +1.6" (회귀 나무)
 * 그리고 "조작하지 않음" 기준과 비교해 정말 판단을 배웠는지 검증한다.
 *
 * 가정: 운전자는 "직전 상태"를 보고 "다음 조작"을 했다.
 *   상태(t−1) → 조작(t) 로 맞춰서, 조작 결과가 상태에 섞여 들어가는 것을 막는다.
 *
 * 브라우저: window.Control / Node: require('./control.js')
 * ================================================================ */
(function (root) {
  'use strict';
  const Reg = root.Regression || (typeof require === 'function' ? require('./regression.js') : null);
  const { mean, sum } = Reg;
  const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const rmse = (a, b) => Math.sqrt(mean(a.map((v, i) => (v - b[i]) ** 2)));

  /* ---------- 1. 학습용 표 만들기 ----------
   * series: [{ name, values }] (시간 순서), mv: 조작 항목 번호, inputs: 판단 근거 항목 번호들
   * window: 추세를 볼 칸 수, target: 'delta'(조작량 = 바꾼 양) | 'level'(조작 값 자체) */
  function buildFeatures(series, { mv, inputs, window = 5, target = 'delta', windowLabel } = {}) {
    const V = series[mv].values, n = V.length, w = Math.max(1, window);
    const wl = windowLabel || `${w}칸`;
    const defs = [];
    inputs.forEach(i => {
      defs.push({ key: `L${i}`, var: series[i].name, kind: 'level', label: `${series[i].name}` });
      defs.push({ key: `T${i}`, var: series[i].name, kind: 'trend', label: `${series[i].name} 최근 ${wl} 변화` });
    });
    defs.push({ key: 'MV', var: series[mv].name, kind: 'level', label: `현재 ${series[mv].name}` });
    const X = [], y = [], prev = [], at = [];
    for (let t = w + 1; t < n; t++) {
      const row = [];
      inputs.forEach(i => {
        const s = series[i].values;
        row.push(s[t - 1], s[t - 1] - s[t - 1 - w]);
      });
      row.push(V[t - 1]);
      const target_ = target === 'delta' ? V[t] - V[t - 1] : V[t];
      if (row.every(Number.isFinite) && Number.isFinite(target_)) { X.push(row); y.push(target_); prev.push(V[t - 1]); at.push(t); }
    }
    // 변하지 않는 특징은 뺀다
    const keep = defs.map((_, j) => new Set(X.map(r => r[j])).size > 1);
    const kd = defs.filter((_, j) => keep[j]);
    return {
      mvName: series[mv].name, target, window: w, windowLabel: wl,
      defs: kd, X: X.map(r => r.filter((_, j) => keep[j])), y, prev, at,
    };
  }

  // 조작 방향 구분 폭: 실제로 바꾼 양의 중앙값의 절반
  function deadbandOf(F) {
    const d = F.y.map((v, i) => (F.target === 'delta' ? v : v - F.prev[i])).map(Math.abs).filter(v => v > 1e-12);
    return d.length ? median(d) * 0.5 : 1e-9;
  }
  const dirOf = (d, db) => (d > db ? 1 : d < -db ? -1 : 0);

  /* ---------- 2. 선형 식 (단계적 제거) ---------- */
  function fitLinear(F, rows = F.y.map((_, i) => i), { pMax = 0.05 } = {}) {
    let use = F.defs.map((_, j) => j);
    const y = rows.map(r => F.y[r]);
    for (let guard = 0; guard < 50 && use.length; guard++) {
      const preds = use.map(j => ({ name: F.defs[j].label, values: rows.map(r => F.X[r][j]) }));
      const m = Reg.multiRegression(F.mvName, y, preds);
      if (!m) return null;
      if (m.error) { use = use.slice(0, -1); continue; } // 겹치는 특징이 있으면 뒤에서부터 뺀다
      const det = Reg.details(m);
      const worst = det.coefs.slice(1).map((c, k) => ({ k, p: c.p })).sort((a, b) => b.p - a.p)[0];
      if (use.length > 1 && worst && worst.p > pMax) { use = use.filter((_, k) => k !== worst.k); continue; }
      return { model: m, use, det };
    }
    return null;
  }
  const predictLinear = (L, x) => L.model.predict(L.use.map(j => x[j]));

  /* ---------- 3. 판단 규칙 (회귀 나무) ---------- */
  function fitTree(F, rows = F.y.map((_, i) => i), { maxDepth = 3, minLeaf } = {}) {
    const X = F.X, y = F.y, p = F.defs.length;
    const ml = minLeaf || Math.max(5, Math.round(rows.length * 0.05));
    const sse = idx => { const m = mean(idx.map(i => y[i])); return sum(idx.map(i => (y[i] - m) ** 2)); };
    const importance = new Array(p).fill(0);
    const total = sse(rows) || 1;
    const db = deadbandOf(F);
    const dOf = i => (F.target === 'delta' ? y[i] : y[i] - F.prev[i]);
    function build(idx, depth) {
      const ys = idx.map(i => y[i]);
      const node = {
        n: idx.length, value: mean(ys), sd: Math.sqrt(mean(ys.map(v => (v - mean(ys)) ** 2))),
        up: idx.filter(i => dOf(i) > db).length / idx.length, down: idx.filter(i => dOf(i) < -db).length / idx.length,
      };
      if (depth >= maxDepth || idx.length < 2 * ml) return node;
      const parent = sse(idx);
      let best = null;
      for (let j = 0; j < p; j++) {
        const s = [...idx].sort((a, b) => X[a][j] - X[b][j]);
        let sl = 0, sl2 = 0, st = 0, st2 = 0;
        s.forEach(i => { st += y[i]; st2 += y[i] ** 2; });
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
      // 나눠도 전체 오차가 2% 이상 줄지 않으면 멈춘다 (우연한 규칙 방지)
      if (!best || parent - best.e < total * 0.02) return node;
      importance[best.j] += parent - best.e;
      node.j = best.j; node.thr = best.thr;
      node.left = build(idx.filter(i => X[i][best.j] < best.thr), depth + 1);
      node.right = build(idx.filter(i => X[i][best.j] >= best.thr), depth + 1);
      return node;
    }
    const tree = build(rows, 0);
    const imp = sum(importance) || 1;
    return { tree, importance: importance.map(v => v / imp), minLeaf: ml, maxDepth };
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
  const predictTree = (T, x) => treeLeaf(T.tree, x).leaf.value;

  // 경로의 조건을 항목별로 합쳐서 읽기 쉽게 (예: 4.85 ≤ 압력 < 4.92)
  function simplifyPath(path) {
    const by = new Map();
    path.forEach(c => {
      const b = by.get(c.j) || { j: c.j, lo: -Infinity, hi: Infinity };
      if (c.op === '<') b.hi = Math.min(b.hi, c.thr); else b.lo = Math.max(b.lo, c.thr);
      by.set(c.j, b);
    });
    return [...by.values()];
  }

  /** 나무의 모든 끝(규칙)을 목록으로 */
  function treeRules(T) {
    const out = [];
    (function walk(node, path) {
      if (!node.left) { out.push({ conds: simplifyPath(path), value: node.value, sd: node.sd, n: node.n, up: node.up, down: node.down }); return; }
      walk(node.left, [...path, { j: node.j, op: '<', thr: node.thr }]);
      walk(node.right, [...path, { j: node.j, op: '≥', thr: node.thr }]);
    })(T.tree, []);
    return out;
  }

  /* ---------- 4. 검증: 시간 순서로 앞 75% 학습 → 뒤 25% 맞히기 ---------- */
  function evaluate(F, opts = {}) {
    const n = F.y.length;
    const cut = Math.floor(n * 0.75);
    const train = [...Array(cut).keys()], test = [...Array(n - cut).keys()].map(k => k + cut);
    if (train.length < 10 || test.length < 5) return null;
    const db = deadbandOf(F);
    const lin = fitLinear(F, train, opts), tree = fitTree(F, train, opts);
    const truth = test.map(i => F.y[i]);
    const base = test.map(i => (F.target === 'delta' ? 0 : F.prev[i]));
    const pl = lin ? test.map(i => predictLinear(lin, F.X[i])) : null;
    const pt = test.map(i => predictTree(tree, F.X[i]));
    const toDelta = (v, i) => (F.target === 'delta' ? v : v - F.prev[i]);
    const dirAcc = pred => mean(test.map((i, k) => +(dirOf(toDelta(pred[k], i), db) === dirOf(toDelta(F.y[i], i), db))));
    // 운전자가 실제로 조작한 순간만 따로: 방향을 맞혔나
    const acted = test.map((i, k) => k).filter(k => dirOf(toDelta(truth[k], test[k]), db) !== 0);
    const actAcc = pred => (acted.length ? mean(acted.map(k => +(dirOf(toDelta(pred[k], test[k]), db) === dirOf(toDelta(truth[k], test[k]), db)))) : NaN);
    return {
      nTrain: train.length, nTest: test.length, deadband: db, acted: acted.length,
      rmse: { base: rmse(truth, base), linear: pl ? rmse(truth, pl) : NaN, tree: rmse(truth, pt) },
      direction: { base: dirAcc(base), linear: pl ? dirAcc(pl) : NaN, tree: dirAcc(pt) },
      actedDirection: { base: actAcc(base), linear: pl ? actAcc(pl) : NaN, tree: actAcc(pt) },
      series: { at: test.map(i => F.at[i]), truth, linear: pl, tree: pt },
    };
  }

  /* ---------- 5. 전체 학습 ---------- */
  function learn(series, opts) {
    const F = buildFeatures(series, opts);
    if (F.y.length < 20) return { error: `조작 판단을 배우려면 값이 20줄 이상 필요해요 (지금 ${F.y.length}줄)` };
    if (!F.defs.length) return { error: '판단 근거로 쓸 항목이 변하지 않아요' };
    const ev = evaluate(F, opts);
    const linear = fitLinear(F, undefined, opts);
    const tree = fitTree(F, undefined, opts);
    const db = deadbandOf(F);
    const d = F.y.map((v, i) => (F.target === 'delta' ? v : v - F.prev[i]));
    const acts = d.map(v => dirOf(v, db));
    // 어느 쪽을 추천에 쓸지: 검증 오차가 작은 쪽
    let pick = 'tree';
    if (ev && linear && Number.isFinite(ev.rmse.linear) && ev.rmse.linear < ev.rmse.tree) pick = 'linear';
    const learned = ev ? Math.min(ev.rmse.linear || Infinity, ev.rmse.tree) < ev.rmse.base * 0.95 : null;
    const mvAll = series[opts.mv].values.filter(Number.isFinite);
    return {
      F, linear, tree, rules: treeRules(tree), evaluation: ev, pick, learned, deadband: db,
      stats: {
        n: F.y.length,
        up: acts.filter(a => a > 0).length, down: acts.filter(a => a < 0).length, hold: acts.filter(a => a === 0).length,
        stepMedian: (a => (a.length ? median(a) : 0))(d.map(Math.abs).filter(v => v > db)),
        stepMax: Math.max(...d.map(Math.abs)),
        mvMin: Math.min(...mvAll), mvMax: Math.max(...mvAll),
      },
    };
  }

  /** 지금 상태로 조작 추천
   *  state: { inputs: { 항목이름: { now, before } }, mvNow }
   *  limits: { min, max, maxStep } — 넘으면 잘라내고 clipped 로 알린다 */
  function recommend(L, state, limits = {}) {
    const F = L.F;
    const x = F.defs.map(d => {
      if (d.key === 'MV') return state.mvNow;
      const s = state.inputs[d.var] || {};
      return d.kind === 'level' ? s.now : s.now - s.before;
    });
    if (!x.every(Number.isFinite)) return { error: '모든 칸에 숫자를 넣어주세요' };
    const toDelta = v => (F.target === 'delta' ? v : v - state.mvNow);
    const tl = treeLeaf(L.tree.tree, x);
    const res = {
      x,
      tree: { delta: toDelta(tl.leaf.value), leaf: tl.leaf, conds: simplifyPath(tl.path) },
      linear: L.linear ? { delta: toDelta(predictLinear(L.linear, x)) } : null,
    };
    if (L.linear) { const [lo, hi] = L.linear.model.interval(L.linear.use.map(j => x[j])); res.linear.range = [toDelta(lo), toDelta(hi)]; }
    const chosen = L.pick === 'linear' && res.linear ? res.linear.delta : res.tree.delta;
    let delta = chosen; const clipped = [];
    if (Number.isFinite(limits.maxStep) && Math.abs(delta) > limits.maxStep) { delta = Math.sign(delta) * limits.maxStep; clipped.push('한 번에 바꿀 수 있는 양'); }
    let next = state.mvNow + delta;
    if (Number.isFinite(limits.max) && next > limits.max) { next = limits.max; clipped.push('최대값'); }
    if (Number.isFinite(limits.min) && next < limits.min) { next = limits.min; clipped.push('최소값'); }
    return { ...res, raw: chosen, delta: next - state.mvNow, next, dir: dirOf(next - state.mvNow, L.deadband), clipped };
  }

  /** 저장용 데이터 (예측 앱에서 쓰기) */
  function serialize(L, extra = {}) {
    const r12 = v => (Number.isFinite(v) ? +v.toPrecision(12) : null);
    const node = n => (n.left ? { j: n.j, thr: r12(n.thr), n: n.n, left: node(n.left), right: node(n.right) } : { value: r12(n.value), sd: r12(n.sd), n: n.n, up: r12(n.up), down: r12(n.down) });
    return {
      kind: 'control', ...extra,
      mv: L.F.mvName, target: L.F.target, window: L.F.window, windowLabel: L.F.windowLabel,
      timing: 'state(t-1) -> action(t)',
      features: L.F.defs.map(d => ({ key: d.key, var: d.var, kind: d.kind, label: d.label })),
      deadband: r12(L.deadband), pick: L.pick,
      linear: L.linear ? { use: L.linear.use, model: Reg.serialize(L.linear.model) } : null,
      tree: node(L.tree.tree),
      evaluation: L.evaluation ? { nTrain: L.evaluation.nTrain, nTest: L.evaluation.nTest, rmse: L.evaluation.rmse, direction: L.evaluation.direction, actedDirection: L.evaluation.actedDirection } : null,
    };
  }

  const Control = { buildFeatures, fitLinear, fitTree, treeRules, evaluate, learn, recommend, serialize, predictTree, predictLinear, deadbandOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = Control;
  else root.Control = Control;
})(typeof globalThis !== 'undefined' ? globalThis : this);
