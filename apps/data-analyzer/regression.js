/* ================================================================
 * regression.js — 회귀 분석 엔진 (화면과 무관한 순수 계산)
 *
 * 브라우저: <script src="regression.js"></script> → window.Regression
 * Node:     const Regression = require('./regression.js')
 *
 * 나중에 만들 예측 앱은 이 파일과 "모델 파일(JSON)"만 있으면
 *   const m = Regression.deserialize(json.models[0]);
 *   Regression.predict(m, 130);   // 값 하나 예측
 *   Regression.interval(m, 130);  // 95% 예측 범위 [아래, 위]
 * 로 바로 쓸 수 있다. 자세한 형식은 README.md 참고.
 * ================================================================ */
(function (root) {
  'use strict';

  const VERSION = 1;

  /* ---------- 기본 계산 ---------- */
  // 큰 배열에서 Math.max(...a)는 '호출 스택 초과'로 터지므로 반복문으로
  const minOf = a => { let m = Infinity; for (const v of a) if (v < m) m = v; return m; };
  const maxOf = a => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };
  const sum = a => a.reduce((s, v) => s + v, 0);
  const mean = a => sum(a) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(sum(a.map(v => (v - m) ** 2)) / (a.length - 1)); };
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const matVec = (M, v) => M.map(r => dot(r, v));

  // 가우스-조르당 소거 (부분 피벗). B가 행렬이면 A⁻¹B, 벡터면 A⁻¹b. 풀 수 없으면 null
  function gaussJordan(A, B) {
    const n = A.length, w = B[0].length;
    const M = A.map((r, i) => [...r, ...B[i]]);
    const scale = maxOf(A.map(r => maxOf(r.map(Math.abs)))) || 1;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12 * scale) return null;
      [M[c], M[p]] = [M[p], M[c]];
      const piv = M[c][c];
      for (let k = c; k < n + w; k++) M[c][k] /= piv;
      for (let r = 0; r < n; r++) {
        if (r === c || M[r][c] === 0) continue;
        const f = M[r][c];
        for (let k = c; k < n + w; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(r => r.slice(n));
  }
  function solve(A, b) { const r = gaussJordan(A, b.map(v => [v])); return r && r.map(x => x[0]); }
  function invert(A) { return gaussJordan(A, A.map((_, i) => A.map((__, j) => +(i === j)))); }

  /* ---------- 확률 분포 (t, F, 카이제곱) ---------- */
  function lgamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (const c of g) ser += c / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    const EPS = 3e-14, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  // 정규화된 불완전 베타 함수 I_x(a, b)
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  /** t 검정 양측 p값 */
  const tP = (t, df) => (Number.isFinite(t) && df > 0 ? ibeta(df / (df + t * t), df / 2, 0.5) : NaN);
  /** F 검정 p값 (오른쪽 꼬리) */
  const fP = (F, d1, d2) => (Number.isFinite(F) && F >= 0 && d1 > 0 && d2 > 0 ? ibeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2) : NaN);
  /** 양측 유의수준 alpha 의 t 임계값 (이분법) */
  function tInv(alpha, df) {
    if (!(df > 0)) return NaN;
    let lo = 0, hi = 1;
    while (tP(hi, df) > alpha) hi *= 2;
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (tP(mid, df) > alpha) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  // t 임계값은 자유도마다 한 번만 계산 (예측 범위를 점마다 구할 때 느려지지 않게)
  const tCache = new Map();
  const t975 = df => { if (!tCache.has(df)) tCache.set(df, tInv(0.05, df)); return tCache.get(df); };
  // 값이 사실상 변하지 않는가 (소수 반올림 잡음은 무시)
  const isConstant = a => { const lo = minOf(a), hi = maxOf(a); return !(hi - lo > 1e-12 * Math.max(1, Math.abs(hi), Math.abs(lo))); };

  /* ---------- 핵심: 표준화한 다항식 최소제곱 ----------
   * 설명변수 g를 u = (g − center) / scale 로 바꿔 [1, u, u², …]로 푼다.
   * 계수(coef), (UᵀU)⁻¹(cov), 잔차 표준편차(sigma)를 남겨서
   * 예측값과 예측 범위를 모두 다시 계산할 수 있게 한다. */
  const basis = (u, deg) => Array.from({ length: deg + 1 }, (_, k) => u ** k);

  function lsCore(U, h) {
    const p = U[0].length;
    const A = Array.from({ length: p }, () => new Array(p).fill(0));
    const b = new Array(p).fill(0);
    for (let i = 0; i < U.length; i++) {
      const r = U[i];
      for (let a = 0; a < p; a++) { b[a] += r[a] * h[i]; for (let c = a; c < p; c++) A[a][c] += r[a] * r[c]; }
    }
    for (let a = 0; a < p; a++) for (let c = 0; c < a; c++) A[a][c] = A[c][a];
    const cov = invert(A);
    if (!cov) return null;
    const coef = matVec(cov, b);
    const sse = sum(h.map((v, i) => (v - dot(U[i], coef)) ** 2));
    const df = U.length - p;
    return { coef, cov, sigma: df > 0 ? Math.sqrt(sse / df) : 0, df };
  }

  function coreFit(g, h, deg) {
    const center = mean(g), scale = sd(g) || 1;
    const c = lsCore(g.map(v => basis((v - center) / scale, deg)), h);
    return c && { center, scale, deg, ...c };
  }

  // 변환 공간에서의 예측값(eta)과 예측 표준오차(se)
  function coreEval(core, gv) {
    const b = basis((gv - core.center) / core.scale, core.deg);
    const eta = dot(core.coef, b);
    const q = dot(b, matVec(core.cov, b));
    return { eta, se: core.sigma * Math.sqrt(1 + Math.max(0, q)) };
  }

  const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  // 표준화 계수 → (g − g0) 의 다항식 계수 [a0, a1, …]
  // g0(기준점)을 데이터 근처로 잡아야 x가 클 때(온도 1600, 날짜 숫자) 계수가 서로 상쇄되어 틀어지지 않는다
  function expand(core, g0 = 0) {
    const { coef: c, scale: s, deg } = core, m = core.center - g0;
    const a = new Array(deg + 1).fill(0);
    for (let k = 0; k <= deg; k++) for (let j = 0; j <= k; j++) a[j] += c[k] * s ** -k * binom(k, j) * (-m) ** (k - j);
    return a;
  }
  // 식을 쓸 기준점: 데이터가 0 근처면 0, 멀리 떨어져 있으면 보기 좋은 가운데 값
  function originFor(transformX, core) {
    if (!(Math.abs(core.center) > 3 * core.scale)) return { g0: 0, x0: transformX === 'ln' ? 1 : 0 };
    if (transformX === 'ln') { const x0 = Number(Math.exp(core.center).toPrecision(2)); return { g0: Math.log(x0), x0 }; }
    const p = 10 ** Math.floor(Math.log10(core.scale || 1));
    const x0 = Number((Math.round(core.center / p) * p).toPrecision(12));
    return { g0: x0, x0 };
  }

  /* ---------- 함수 종류 ----------
   * transform.x / transform.y: 'id'(그대로) | 'ln'(자연로그)
   * 지수·로그·거듭제곱은 로그를 취하면 직선이 되는 것을 이용한다. */
  const MODELS = [
    { id: 'linear', name: '직선', p: 1, deg: 1, transform: { x: 'id', y: 'id' }, plain: '일정한 속도로 늘거나 줄어요' },
    { id: 'exp', name: '지수 곡선', p: 1, deg: 1, transform: { x: 'id', y: 'ln' }, plain: '일정한 비율로 점점 빠르게(또는 느리게) 변해요' },
    { id: 'log', name: '로그 곡선', p: 1, deg: 1, transform: { x: 'ln', y: 'id' }, plain: '처음엔 빠르게 변하다가 점점 느려져요' },
    { id: 'power', name: '거듭제곱 곡선', p: 1, deg: 1, transform: { x: 'ln', y: 'ln' }, plain: 'x가 몇 배가 되면 y도 일정한 배수로 변해요' },
    { id: 'quad', name: '2차 곡선', p: 2, deg: 2, transform: { x: 'id', y: 'id' }, plain: '한 번 꺾이는 곡선이에요 (올라갔다 내려오거나 그 반대)' },
    { id: 'cubic', name: '3차 곡선', p: 3, deg: 3, transform: { x: 'id', y: 'id' }, plain: '두 번까지 꺾일 수 있는 S자 곡선이에요' },
  ];
  const fwd = (t, v) => (t === 'ln' ? (v > 0 ? Math.log(v) : NaN) : v);
  const back = (t, v) => (t === 'ln' ? Math.exp(v) : v);

  // 사람이 읽는 식의 계수 (x0 = 기준점, 보통 0)
  //   직선·2차·3차: y = a0 + a1·(x−x0) + a2·(x−x0)² …  → [a0, a1, …]
  //   지수: y = a·e^(b·(x−x0)) → [a, b] / 로그: y = a + b·ln(x/x0) → [a, b] / 거듭제곱: y = a·(x/x0)^b → [a, b]
  function readableParams(id, core, g0) {
    const a = expand(core, g0);
    return id === 'exp' || id === 'power' ? [Math.exp(a[0]), a[1]] : a;
  }

  function attach(model) {
    Object.defineProperty(model, 'predict', { value: v => predict(model, v), enumerable: false });
    Object.defineProperty(model, 'interval', { value: v => interval(model, v), enumerable: false });
    return model;
  }

  /** 한 가지 함수로 y = f(x) 맞추기. 맞출 수 없으면 null */
  function fitModel(id, x, y) {
    const meta = MODELS.find(m => m.id === id);
    if (!meta) throw new Error('알 수 없는 함수: ' + id);
    const n = x.length;
    if (n < meta.deg + 3) return null;
    if (meta.transform.x === 'ln' && !x.every(v => v > 0)) return null;
    if (meta.transform.y === 'ln' && !y.every(v => v > 0)) return null;
    if (isConstant(y)) return null;
    const g = x.map(v => fwd(meta.transform.x, v)), h = y.map(v => fwd(meta.transform.y, v));
    if (new Set(g).size <= meta.deg) return null;
    const core = coreFit(g, h, meta.deg);
    if (!core) return null;
    const { g0, x0 } = originFor(meta.transform.x, core);
    const params = readableParams(id, core, g0);
    if (!params.every(Number.isFinite)) return null;
    const model = attach({
      kind: 'single', id, name: meta.name, plain: meta.plain, p: meta.p, transform: meta.transform,
      core, params, x0, g0, xMin: minOf(x), xMax: maxOf(x),
    });
    const yh = x.map(model.predict);
    if (!yh.every(Number.isFinite)) return null;
    Object.assign(model, scores(y, yh, meta.p));
    Object.defineProperty(model, 'data', { value: { x, y, g, h, timeOrdered: false }, enumerable: false });
    return model;
  }

  function scores(y, yh, p) {
    const n = y.length, my = mean(y);
    const ssRes = sum(y.map((v, i) => (v - yh[i]) ** 2));
    const ssTot = sum(y.map(v => (v - my) ** 2));
    // y가 변하지 않으면 R²는 정의되지 않는다 (1이 아님)
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;
    const adj = n - p - 1 > 0 ? 1 - (1 - r2) * (n - 1) / (n - p - 1) : r2;
    // AIC/BIC: 원래 값 기준, 정규분포 로그우도 (statsmodels 와 같은 정의, 계수 p+1개). 작을수록 좋음
    // AICc: 자료가 적을 때 복잡한 함수에 더 큰 벌점 (자동 선택에 사용)
    const k = p + 1, nll2 = n * (Math.log(2 * Math.PI * Math.max(ssRes, 1e-300) / n) + 1);
    const aic = nll2 + 2 * k;
    const aicc = n - k - 1 > 0 ? aic + 2 * k * (k + 1) / (n - k - 1) : Infinity;
    return { r2, adj, rmse: Math.sqrt(ssRes / n), n, aic, aicc, bic: nll2 + k * Math.log(n) };
  }

  /** 모델로 값 하나 예측. 단일 모델은 x(숫자), 다중 모델은 {항목이름: 값} 또는 배열 */
  function predict(model, x) {
    if (model.kind === 'multi') return multiEval(model, x).eta;
    const gv = fwd(model.transform.x, asNum(x));
    if (!Number.isFinite(gv)) return NaN;
    return back(model.transform.y, coreEval(model.core, gv).eta);
  }

  /** 95% 예측 범위 [아래, 위]: 새로 잰 값이 이 안에 들어올 가능성이 약 95% */
  function interval(model, x) {
    let e;
    if (model.kind === 'multi') e = multiEval(model, x);
    else {
      const gv = fwd(model.transform.x, asNum(x));
      if (!Number.isFinite(gv)) return [NaN, NaN];
      e = coreEval(model.core, gv);
    }
    const t = t975(model.core.df);
    if (!Number.isFinite(t)) return [NaN, NaN];
    const ty = model.kind === 'multi' ? 'id' : model.transform.y;
    return [back(ty, e.eta - t * e.se), back(ty, e.eta + t * e.se)];
  }

  /** 검증: 일부를 숨기고 나머지로 식을 만든 뒤, 숨긴 값을 얼마나 맞히는지 본다
   *  mode 'tail'  : x가 큰 쪽 20%를 숨김 (시간이 x면 → 미래 예측 능력)
   *  mode 'time'  : 들어온 순서(시간 순)로 마지막 20%를 숨김 (시간 순 데이터의 항목 관계)
   *  mode 'spread': 5개마다 1개를 숨김 (측정 범위 안쪽 예측 능력, 시간 순 데이터에는 낙관적) */
  function validate(id, x, y, mode = 'tail') {
    const n = x.length;
    const order = mode === 'time' ? [...x.keys()] : [...x.keys()].sort((a, b) => x[a] - x[b]);
    const nTest = Math.max(2, Math.round(n * 0.2));
    const testSet = new Set(mode === 'tail' || mode === 'time' ? order.slice(n - nTest) : order.filter((_, k) => k % 5 === 4));
    const tr = order.filter(i => !testSet.has(i)), te = order.filter(i => testSet.has(i));
    if (te.length < 2) return null;
    const f = fitModel(id, tr.map(i => x[i]), tr.map(i => y[i]));
    if (!f) return null;
    const err = te.map(i => y[i] - f.predict(x[i]));
    if (!err.every(Number.isFinite)) return null;
    const inside = te.filter(i => { const [lo, hi] = f.interval(x[i]); return y[i] >= lo && y[i] <= hi; }).length;
    return {
      mode, nTrain: tr.length, nTest: te.length,
      rmse: Math.sqrt(mean(err.map(e => e * e))),
      trainRmse: f.rmse,
      coverage: inside / te.length,
    };
  }

  function clean(xAll, yAll) {
    const x = [], y = [];
    xAll.forEach((v, i) => { if (Number.isFinite(v) && Number.isFinite(yAll[i])) { x.push(v); y.push(yAll[i]); } });
    return { x, y };
  }

  /** 여러 함수를 모두 맞추고 가장 알맞은 것을 고른다.
   *  AICc(자료 수에 맞춘 정보 기준)가 가장 작은 함수와 2 이내로 비슷하면 더 단순한 함수를 고른다
   *  (자료가 적을 때 3차 곡선이 우연히 뽑히는 것을 막는다).
   *  opts.validate: 'tail' | 'time' | 'spread' | null
   *  opts.timeOrdered: 들어온 순서가 시간 순서인가 (잔차 자기상관을 그 순서로 검사) */
  function bestFit(xAll, yAll, opts = {}) {
    const { x, y } = clean(xAll, yAll);
    if (x.length < 4) return { error: '값이 4개 이상 있어야 계산할 수 있어요', n: x.length };
    if (isConstant(y)) return { constant: y[0], n: x.length, x, y };
    if (isConstant(x)) return { error: '기준 값이 모두 같아서 관계를 계산할 수 없어요', n: x.length };
    const all = MODELS.map(m => fitModel(m.id, x, y)).filter(Boolean);
    if (!all.length) return { error: '계산할 수 없어요', n: x.length };
    all.forEach(f => { f.data.timeOrdered = !!opts.timeOrdered; });
    if (opts.validate) all.forEach(f => { f.validation = validate(f.id, x, y, opts.validate); });
    const top = minOf(all.map(f => f.aicc));
    const ok = all.filter(f => f.aicc <= top + 2).sort((a, b) => a.p - b.p || a.aicc - b.aicc);
    const auto = ok[0] || all.sort((a, b) => a.aicc - b.aicc)[0];
    let best = auto;
    if (opts.prefer) best = all.find(f => f.id === opts.prefer) || auto;
    // 표에는 정확도(수정 R²) 순서로
    return { best, auto, all: all.sort((a, b) => b.adj - a.adj), linear: all.find(f => f.id === 'linear'), x, y, n: x.length };
  }

  /** 피어슨 상관계수 (빈 값이 있는 줄은 뺌) */
  function pearson(a, b) {
    const { x, y } = clean(a, b);
    if (x.length < 3) return { r: NaN, n: x.length };
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN, n: x.length };
  }

  /** 다중 선형 회귀: y = b0 + Σ bj·xj
   *  preds: [{ name, values: number[] }] */
  function multiRegression(yName, y, preds) {
    const rows = [];
    y.forEach((v, i) => { if (Number.isFinite(v) && preds.every(p => Number.isFinite(p.values[i]))) rows.push(i); });
    const k = preds.length, n = rows.length;
    if (k < 1) return null;
    if (n < k + 3) return { error: `여러 항목을 함께 쓰려면 값이 ${k + 3}줄 이상 필요해요 (지금 ${n}줄)` };
    const ys = rows.map(i => y[i]);
    if (isConstant(ys)) return { error: `${yName}이(가) 변하지 않아서 다른 항목으로 설명할 수 없어요 (계측기 고정·설정값인지 확인해주세요)` };
    const ms = preds.map(p => mean(rows.map(i => p.values[i])));
    const ss = preds.map(p => sd(rows.map(i => p.values[i])));
    const flat = preds.filter(p => isConstant(rows.map(i => p.values[i])));
    if (flat.length) return { error: `값이 변하지 않는 항목(${flat.map(p => p.name).join(', ')})이 있어서 함께 계산할 수 없어요. 그 항목을 빼주세요`, constant: flat.map(p => p.name) };
    const Z = rows.map(i => preds.map((p, j) => (p.values[i] - ms[j]) / ss[j]));
    const core = lsCore(Z.map(z => [1, ...z]), ys);
    if (!core) {
      // 어느 항목이 겹치는지: 다른 항목들로 거의 정확히 계산되는 항목
      const overlap = preds.filter((p, j) => {
        if (k < 2) return false;
        const c = lsCore(Z.map(z => [1, ...z.filter((_, q) => q !== j)]), Z.map(z => z[j]));
        if (!c) return true;
        const e = Z.map(z => z[j] - dot(c.coef, [1, ...z.filter((_, q) => q !== j)]));
        return 1 - sum(e.map(v => v * v)) / (Z.length - 1) > 0.999999;
      }).map(p => p.name);
      return { error: `항목끼리 너무 똑같이 움직여서(겹쳐서) 함께 계산할 수 없어요${overlap.length ? ` (${overlap.join(', ')})` : ''}. 그중 하나를 빼보세요.`, overlap };
    }
    const c = core.coef, sy = sd(ys);
    const model = attach({
      kind: 'multi', yName, core,
      terms: preds.map((p, j) => ({ name: p.name, coef: c[j + 1] / ss[j], beta: c[j + 1] / sy, mean: ms[j], sd: ss[j] })),
      b0: c[0] - sum(preds.map((p, j) => c[j + 1] * ms[j] / ss[j])),
    });
    const yh = rows.map(i => model.predict(preds.map(p => p.values[i])));
    Object.assign(model, scores(ys, yh, k));
    Object.defineProperty(model, 'yh', { value: yh, enumerable: false });
    Object.defineProperty(model, 'ys', { value: ys, enumerable: false });
    Object.defineProperty(model, 'data', { value: { rows, X: rows.map(i => preds.map(p => p.values[i])), ms, ss }, enumerable: false });
    return model;
  }

  // 입력값 정리: 숫자나 숫자 글자만 받고, 빈 값·null 은 NaN (0으로 바뀌지 않게)
  const asNum = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  function multiEval(model, x) {
    const raw = Array.isArray(x) ? x : x && typeof x === 'object' ? model.terms.map(t => x[t.name]) : [];
    const vals = model.terms.map((_, j) => asNum(raw[j]));
    const b = [1, ...model.terms.map((t, j) => (vals[j] - t.mean) / t.sd)];
    if (!b.every(Number.isFinite)) return { eta: NaN, se: NaN };
    const q = dot(b, matVec(model.core.cov, b));
    return { eta: dot(model.core.coef, b), se: model.core.sigma * Math.sqrt(1 + Math.max(0, q)) };
  }

  /* ---------- 상세 통계 ---------- */
  const SUPN = ['', '', '²', '³'];

  // 잔차 진단 공통: e(검정 공간 잔차), lev(지렛값), order(시간/x 순서)
  function diagnose(e, lev, sigma, nPar, order, exact) {
    const n = e.length;
    if (exact) return { exact: true, dw: NaN, r1: NaN, skew: NaN, kurt: NaN, jb: NaN, jbP: NaN, stud: e.map(() => 0), cook: e.map(() => 0), lev, nEff: n };
    const eo = order.map(i => e[i]);
    let num = 0; for (let i = 1; i < n; i++) num += (eo[i] - eo[i - 1]) ** 2;
    const sse = sum(e.map(v => v * v));
    const dw = sse > 0 ? num / sse : NaN;
    // 자기상관(직전 잔차와의 상관)
    const r1 = sse > 0 ? sum(eo.slice(1).map((v, i) => v * eo[i])) / sse : NaN;
    const m2 = sse / n, m3 = mean(e.map(v => v ** 3)), m4 = mean(e.map(v => v ** 4));
    const skew = m2 > 0 ? m3 / m2 ** 1.5 : 0, kurt = m2 > 0 ? m4 / m2 ** 2 : 3;
    const jb = n / 6 * (skew ** 2 + (kurt - 3) ** 2 / 4);
    const stud = e.map((v, i) => (sigma > 0 && lev[i] < 1 ? v / (sigma * Math.sqrt(1 - lev[i])) : 0));
    const cook = stud.map((r, i) => (lev[i] < 1 ? r * r * lev[i] / (nPar * (1 - lev[i])) : 0));
    // 자기상관이 강하면 실제로 독립적인 자료 수는 더 적다 (p값이 실제보다 작게 나온다)
    const nEff = r1 > 0 ? Math.max(3, n * (1 - r1) / (1 + r1)) : n;
    return { dw, r1, skew, kurt, jb, jbP: Math.exp(-jb / 2), stud, cook, lev, nEff };
  }

  function coefRows(names, est, covB, df, sigma) {
    const tc = t975(df);
    return names.map((name, j) => {
      const se = sigma * Math.sqrt(Math.max(0, covB[j][j]));
      const t = se > 0 ? est[j] / se : NaN;
      return { name, est: est[j], se, t, p: tP(t, df), lo: est[j] - tc * se, hi: est[j] + tc * se };
    });
  }
  const mulT = (T, C) => T.map(r => C[0].map((_, k) => sum(r.map((v, j) => v * C[j][k]))));
  const tr = M => M[0].map((_, i) => M.map(r => r[i]));

  /** 단일 모델 상세: 계수 검정, 분산분석(F), 잔차 진단
   *  지수·로그·거듭제곱은 변환한 공간(예: ln y)에서 검정한다 → space 로 표시 */
  function details(model, xSym = 'x') {
    if (model.kind === 'multi') return multiDetails(model);
    const { x, y, g, h, timeOrdered } = model.data;
    const core = model.core, n = x.length, deg = core.deg, df = core.df;
    const g0 = model.g0 || 0;
    const m = core.center - g0, s = core.scale;
    // 표준화 계수 c → (g − g0) 계수 a = T c
    const T = Array.from({ length: deg + 1 }, (_, j) => Array.from({ length: deg + 1 }, (_, k) => (k >= j ? s ** -k * binom(k, j) * (-m) ** (k - j) : 0)));
    const a = matVec(T, core.coef);
    const covA = mulT(mulT(T, core.cov), tr(T));
    const x0 = model.x0 || 0;
    const gx = model.transform.x === 'ln' ? (g0 ? `ln(${xSym}/${+x0.toPrecision(6)})` : `ln(${xSym})`) : g0 ? `(${xSym}−${+x0.toPrecision(10)})` : xSym;
    const names = a.map((_, k) => (k === 0 ? (g0 ? `기준값 (${xSym}=${+x0.toPrecision(10)}에서)` : '절편') : `${gx}${SUPN[k] || ''}`));
    let coefs = coefRows(names, a, covA, df, core.sigma);
    if (model.transform.y === 'ln') { // y = a·e^(…) : 절편은 ln a → a 로 되돌린다
      const c0 = coefs[0];
      coefs[0] = { name: 'a (배율)', est: Math.exp(c0.est), se: Math.exp(c0.est) * c0.se, t: NaN, p: NaN, lo: Math.exp(c0.lo), hi: Math.exp(c0.hi) };
      coefs[1].name = model.id === 'exp' ? `b (${xSym}의 지수)` : `b (거듭제곱)`;
    }
    const U = g.map(v => basis((v - core.center) / s, deg));
    const eta = U.map(r => dot(core.coef, r));
    const e = h.map((v, i) => v - eta[i]);
    const hm = mean(h);
    const sst = sum(h.map(v => (v - hm) ** 2)), sse = sum(e.map(v => v * v)), ssr = Math.max(0, sst - sse);
    // 잔차가 사실상 0 = 단위 환산·계산 태그처럼 정확한 관계
    const exact = sst > 0 && sse <= 1e-20 * sst;
    const F = exact ? Infinity : deg > 0 && sse > 0 ? (ssr / deg) / (sse / df) : NaN;
    const lev = U.map(r => dot(r, matVec(core.cov, r)));
    // 자기상관은 시간 순서로 본다 (시간 순 자료가 아니면 x 순서 = 곡선 모양 검사)
    const order = timeOrdered ? [...x.keys()] : [...x.keys()].sort((i, j) => x[i] - x[j]);
    const dg = diagnose(e, lev, core.sigma, deg + 1, order, exact);
    return {
      space: model.transform.y === 'ln' ? 'ln(y)' : 'y',
      coefs, n, df,
      anova: { ssr, sse, sst, dfR: deg, dfE: df, F, p: exact ? 0 : fP(F, deg, df) },
      ...dg, orderKind: timeOrdered ? 'time' : 'x',
      points: x.map((v, i) => ({ x: v, y: y[i], fit: model.predict(v), resid: y[i] - model.predict(v), stud: dg.stud[i], cook: dg.cook[i] })),
    };
  }

  function multiDetails(model) {
    const { X, ms, ss } = model.data;
    const core = model.core, k = model.terms.length, n = X.length, df = core.df;
    // 표준화 계수 c → 원래 계수 [b0, b1..bk]
    const T = [[1, ...ms.map((mj, j) => -mj / ss[j])], ...ms.map((_, j) => Array.from({ length: k + 1 }, (__, c) => (c === j + 1 ? 1 / ss[j] : 0)))];
    const b = matVec(T, core.coef);
    const covB = mulT(mulT(T, core.cov), tr(T));
    const coefs = coefRows(['절편', ...model.terms.map(t => t.name)], b, covB, df, core.sigma);
    coefs.slice(1).forEach((c, j) => { c.beta = model.terms[j].beta; c.vif = (n - 1) * core.cov[j + 1][j + 1]; });
    const U = X.map(r => [1, ...r.map((v, j) => (v - ms[j]) / ss[j])]);
    const yh = model.yh, ys = model.ys;
    const e = ys.map((v, i) => v - yh[i]);
    const my = mean(ys);
    const sst = sum(ys.map(v => (v - my) ** 2)), sse = sum(e.map(v => v * v)), ssr = Math.max(0, sst - sse);
    const exact = sst > 0 && sse <= 1e-20 * sst;
    const F = exact ? Infinity : sse > 0 ? (ssr / k) / (sse / df) : NaN;
    const lev = U.map(r => dot(r, matVec(core.cov, r)));
    const dg = diagnose(e, lev, core.sigma, k + 1, [...e.keys()], exact);
    return {
      space: 'y', coefs, n, df,
      anova: { ssr, sse, sst, dfR: k, dfE: df, F, p: exact ? 0 : fP(F, k, df) },
      ...dg, orderKind: 'time',
      points: ys.map((v, i) => ({ x: yh[i], y: v, fit: yh[i], resid: e[i], stud: dg.stud[i], cook: dg.cook[i], row: model.data.rows[i] })),
    };
  }

  /* ---------- 모델 파일 (JSON) ---------- */
  const r12 = v => (Number.isFinite(v) ? +v.toPrecision(12) : null);
  const deep = v => (Array.isArray(v) ? v.map(deep) : r12(v));

  /** 모델 → 저장 가능한 순수 데이터. extra 는 그대로 덧붙인다 (이름, 식 글자 등) */
  function serialize(model, extra = {}) {
    const core = { center: r12(model.core.center ?? 0), scale: r12(model.core.scale ?? 1), deg: model.core.deg ?? null, coef: deep(model.core.coef), cov: deep(model.core.cov), sigma: r12(model.core.sigma), df: model.core.df };
    const stats = { r2: r12(model.r2), adjR2: r12(model.adj), rmse: r12(model.rmse), n: model.n };
    if (model.kind === 'multi') {
      return { kind: 'multi', ...extra, y: model.yName, b0: r12(model.b0), terms: model.terms.map(t => ({ name: t.name, coef: r12(t.coef), beta: r12(t.beta), mean: r12(t.mean), sd: r12(t.sd) })), stats, core };
    }
    return {
      kind: 'single', ...extra, type: model.id, typeName: model.name, transform: model.transform,
      params: deep(model.params), x0: model.x0 || 0, g0: model.g0 || 0, xRange: [r12(model.xMin), r12(model.xMax)], stats,
      validation: model.validation || null, core,
    };
  }

  /** 저장된 데이터 → predict / interval 을 쓸 수 있는 모델 */
  function deserialize(json) {
    if (json.kind === 'multi') {
      const m = { kind: 'multi', yName: json.y, b0: json.b0, terms: json.terms, core: json.core, r2: json.stats.r2, rmse: json.stats.rmse, n: json.stats.n };
      return attach(m);
    }
    const meta = MODELS.find(x => x.id === json.type) || {};
    return attach({
      kind: 'single', id: json.type, name: json.typeName || meta.name, plain: meta.plain, p: meta.p,
      transform: json.transform, core: json.core, params: json.params, x0: json.x0 || 0, g0: json.g0 || 0,
      xMin: json.xRange[0], xMax: json.xRange[1], r2: json.stats.r2, adj: json.stats.adjR2, rmse: json.stats.rmse, n: json.stats.n,
      validation: json.validation,
    });
  }

  const Regression = {
    VERSION, MODELS,
    sum, mean, sd, solve, invert, t975, tInv, tP, fP, ibeta,
    fitModel, bestFit, validate, pearson, multiRegression, details, isConstant, minOf, maxOf, expand,
    predict, interval, serialize, deserialize,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Regression;
  else root.Regression = Regression;
})(typeof globalThis !== 'undefined' ? globalThis : this);
