// 회귀 엔진 검사. 실행: node apps/data-analyzer/tests/regression.test.js
'use strict';
const assert = require('node:assert/strict');
const R = require('../regression.js');

let pass = 0;
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} ≠ ${b}`); };
const test = (name, fn) => { fn(); pass++; console.log('✓', name); };
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
// 항상 같은 결과가 나오는 난수
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };

test('정확한 데이터는 계수를 그대로 찾는다', () => {
  const x = range(20, i => i * 3 + 100);
  const cases = [
    ['linear', v => 2 + 0.5 * v, [2, 0.5]],
    ['quad', v => 1 - 0.2 * v + 0.003 * v * v, [1, -0.2, 0.003]],
    ['cubic', v => 4 + 0.1 * v - 1e-3 * v ** 2 + 2e-6 * v ** 3, [4, 0.1, -1e-3, 2e-6]],
    ['exp', v => 3 * Math.exp(0.01 * v), [3, 0.01]],
    ['log', v => 5 + 2 * Math.log(v), [5, 2]],
    ['power', v => 0.7 * v ** 1.3, [0.7, 1.3]],
  ];
  for (const [id, f, want] of cases) {
    // 0 근처 데이터: 계수가 그대로
    const x1 = range(20, i => i * 3 + 1);
    const m1 = R.fitModel(id, x1, x1.map(f));
    assert.equal(m1.x0, id === 'log' || id === 'power' ? 1 : 0);
    want.forEach((w, k) => near(m1.params[k], w, 1e-6, `${id} 계수 ${k}`));
    // 0에서 먼 데이터: 기준점 x0 둘레로 쓴 식이 예측과 같다
    const m = R.fitModel(id, x, x.map(f));
    near(m.r2, 1, 1e-9, `${id} R²`);
    near(m.predict(250), f(250), 1e-6, `${id} 예측`);
    near(evalParams(m, 250), f(250), 1e-6, `${id} 식으로 계산`);
  }
});

// 화면·엑셀에 쓰는 식(params, x0)으로 직접 계산
function evalParams(m, v) {
  const p = m.params, x0 = m.x0 || 0;
  if (m.id === 'exp') return p[0] * Math.exp(p[1] * (v - x0));
  if (m.id === 'log') return p[0] + p[1] * Math.log(v / (x0 || 1));
  if (m.id === 'power') return p[0] * (v / (x0 || 1)) ** p[1];
  return p.reduce((s, a, k) => s + a * (v - x0) ** k, 0);
}

test('x가 0에서 먼 데이터(온도 1550~1650, 엑셀 날짜 숫자)도 식을 그대로 계산하면 맞는다', () => {
  let sd2 = 9; const r = () => { sd2 = (sd2 * 16807) % 2147483647; return sd2 / 2147483647 - 0.5; };
  const T = range(40, i => 1550 + i * 2.5);
  for (const id of ['quad', 'cubic', 'exp', 'power', 'log']) {
    const m = R.fitModel(id, T, T.map(v => 30 + 0.002 * (v - 1600) ** 2 + 0.05 * (v - 1600) + r()));
    if (!m) continue;
    T.forEach(v => near(evalParams(m, v), m.predict(v), 1e-7, `${id} @${v}`));
  }
  const S = range(30, i => 45937 + i / 24); // 엑셀 날짜 숫자 (1시간 간격)
  for (const id of ['linear', 'quad', 'exp']) {
    const m = R.fitModel(id, S, S.map((v, i) => 5 + 0.3 * i + r()));
    assert.ok(m.params.every(Number.isFinite), id);
    S.forEach(v => near(evalParams(m, v), m.predict(v), 1e-7, `${id} serial`));
  }
});

test('기준점(x0)이 있어도 상세 통계(F·잔차)는 그대로', () => {
  let sd5 = 7; const r = () => { sd5 = (sd5 * 16807) % 2147483647; return sd5 / 2147483647 - 0.5; };
  const x = range(40, i => 1550 + i * 2.5), y = x.map(v => 0.002 * (v - 1600) ** 2 + r());
  const m = R.fitModel('quad', x, y);
  assert.ok(m.x0 !== 0);
  const d = R.details(m, 'T');
  const mm = R.multiRegression('y', y, [{ name: 'a', values: x }, { name: 'b', values: x.map(v => v * v) }]);
  near(d.anova.F, R.details(mm).anova.F, 1e-6, 'F');
  near(d.anova.sse, R.details(mm).anova.sse, 1e-6, 'SSE');
});

test('변하지 않는 값: R²=1로 나오지 않고 오류', () => {
  const x = range(10, i => i);
  assert.equal(R.bestFit(x, x.map(() => 62.4)).constant, 62.4);
  const mm = R.multiRegression('y', x.map(() => 62.4), [{ name: 'a', values: x }, { name: 'b', values: x.map(v => v * v) }]);
  assert.ok(mm.error && mm.error.includes('변하지'));
  const mc = R.multiRegression('y', x.map(v => v + (v % 3)), [{ name: 'a', values: x }, { name: '고정', values: x.map(() => 0.1 + 0.2) }]);
  assert.ok(mc.error && mc.error.includes('고정'));
});

test('겹치는 항목 이름을 알려준다', () => {
  const a = range(20, i => i), b = range(20, i => (i * 7) % 5);
  const m = R.multiRegression('y', a.map((v, i) => v + b[i]), [{ name: 'f1', values: a }, { name: 'f2', values: b }, { name: 'total', values: a.map((v, i) => v + b[i]) }]);
  assert.ok(m.error);
  assert.deepEqual(m.overlap.sort(), ['f1', 'f2', 'total']);
});

test('null·빈 값 입력은 0이 아니라 계산 불가', () => {
  const a = range(20, i => i), b = range(20, i => (i * 7) % 5);
  const m = R.multiRegression('y', a.map((v, i) => 1 + v + b[i]), [{ name: 'a', values: a }, { name: 'b', values: b }]);
  assert.ok(Number.isNaN(m.predict({ a: null, b: 1 })));
  assert.ok(Number.isNaN(m.predict(['', 1])));
  near(m.predict(['3', '2']), 6, 1e-9, '숫자 글자');
  const s = R.fitModel('linear', a, a.map(v => 2 * v));
  assert.ok(Number.isNaN(s.predict(null)));
  near(s.predict('3'), 6, 1e-9, '단일 숫자 글자');
});

test('정확한 관계(단위 환산)는 F=∞, 잔차 진단 생략', () => {
  const c = range(20, i => i * 1.7 - 5);
  const m = R.fitModel('linear', c, c.map(v => v * 9 / 5 + 32));
  const d = R.details(m, 'x');
  assert.equal(d.exact, true);
  assert.equal(d.anova.p, 0);
});

test('자료가 적을 때 직선 데이터에 3차 곡선을 고르지 않는다', () => {
  let sd3 = 3; const r = () => { sd3 = (sd3 * 16807) % 2147483647; return sd3 / 2147483647 - 0.5; };
  let cubic = 0;
  for (let rep = 0; rep < 300; rep++) {
    const x = range(8, i => i);
    const fr = R.bestFit(x, x.map(v => 1 + 0.5 * v + r() * 4));
    if (fr.best && fr.best.id === 'cubic') cubic++;
  }
  assert.ok(cubic / 300 < 0.08, `3차 선택 ${cubic}/300`);
});

test('시간 순서 자기상관은 시간 순서로 검사', () => {
  let sd4 = 11; const r = () => { sd4 = (sd4 * 16807) % 2147483647; return sd4 / 2147483647 - 0.5; };
  // 서로 무관한 두 AR(1) 계열
  let a = 0, b = 0; const A = [], B = [];
  for (let i = 0; i < 300; i++) { a = 0.97 * a + r(); b = 0.97 * b + r(); A.push(a); B.push(b); }
  const fr = R.bestFit(A, B, { timeOrdered: true });
  const d = R.details(fr.linear, 'x');
  assert.ok(d.dw < 1.0, `DW ${d.dw}`);
  assert.ok(d.nEff < 50, `nEff ${d.nEff}`);
});

test('bestFit: 직선 데이터에는 직선, 정확도가 비슷하면 단순한 함수', () => {
  const x = range(30, i => i);
  const fr = R.bestFit(x, x.map(v => 10 + 2 * v + rnd() * 0.5));
  assert.equal(fr.best.id, 'linear');
  const fq = R.bestFit(x, x.map(v => 50 + 3 * v - 0.1 * v * v + rnd() * 0.5));
  assert.equal(fq.best.id, 'quad');
});

test('예측 범위: 단순 회귀 교과서 공식과 같다', () => {
  const x = range(15, i => i * 2);
  const y = x.map(v => 3 + 1.5 * v + rnd() * 4);
  const m = R.fitModel('linear', x, y);
  const n = x.length, mx = R.mean(x);
  const sxx = R.sum(x.map(v => (v - mx) ** 2));
  const s = Math.sqrt(R.sum(y.map((v, i) => (v - m.predict(x[i])) ** 2)) / (n - 2));
  const x0 = 40;
  const half = R.t975(n - 2) * s * Math.sqrt(1 + 1 / n + (x0 - mx) ** 2 / sxx);
  const [lo, hi] = m.interval(x0);
  near(lo, m.predict(x0) - half, 1e-9, '아래');
  near(hi, m.predict(x0) + half, 1e-9, '위');
  near(R.t975(13), 2.160, 2e-3, 't(13)');
  near(R.t975(30), 2.042, 2e-3, 't(30)');
});

test('예측 범위: 새 값의 약 95%가 범위 안에 들어온다', () => {
  let inside = 0, total = 0;
  for (let rep = 0; rep < 200; rep++) {
    const x = range(25, i => i);
    const f = v => 5 + 0.8 * v;
    const noise = () => (rnd() + rnd() + rnd() + rnd() - 0) * 1.7; // 대략 정규분포
    const m = R.fitModel('linear', x, x.map(v => f(v) + noise()));
    for (const x0 of [3, 12, 30]) { const [lo, hi] = m.interval(x0); const yn = f(x0) + noise(); if (yn >= lo && yn <= hi) inside++; total++; }
  }
  const rate = inside / total;
  assert.ok(rate > 0.9 && rate < 0.99, `포함 비율 ${rate}`);
});

test('다중 회귀: 정확한 데이터의 계수를 찾고 예측한다', () => {
  const a = range(30, i => i + rnd() * 5), b = range(30, i => (i % 7) * 3 + rnd());
  const y = a.map((v, i) => 1.5 + 2 * v - 0.5 * b[i]);
  const m = R.multiRegression('y', y, [{ name: 'a', values: a }, { name: 'b', values: b }]);
  near(m.b0, 1.5, 1e-8, 'b0'); near(m.terms[0].coef, 2, 1e-8, 'a'); near(m.terms[1].coef, -0.5, 1e-8, 'b');
  near(m.predict({ a: 10, b: 4 }), 1.5 + 20 - 2, 1e-8, '이름으로 예측');
  near(m.predict([10, 4]), 19.5, 1e-8, '배열로 예측');
});

test('다중 회귀: 똑같이 움직이는 항목이면 오류 메시지', () => {
  const a = range(20, i => i), b = a.map(v => v * 2);
  const m = R.multiRegression('y', a.map(v => v + 1), [{ name: 'a', values: a }, { name: 'b', values: b }]);
  assert.ok(m.error);
});

test('모델 파일: 저장 → 불러오기 해도 예측이 같다', () => {
  const x = range(20, i => i + 1), y = x.map(v => 2 * v ** 0.8 + rnd() * 0.1);
  for (const id of ['linear', 'quad', 'cubic', 'exp', 'log', 'power']) {
    const m = R.fitModel(id, x, y);
    const back = R.deserialize(JSON.parse(JSON.stringify(R.serialize(m, { x: 't', y: 'v' }))));
    near(back.predict(25), m.predict(25), 1e-9, `${id} 예측`);
    near(back.interval(25)[1], m.interval(25)[1], 1e-9, `${id} 범위`);
  }
  const a = range(20, i => i), b = range(20, i => (i * 7) % 5);
  const mm = R.multiRegression('y', a.map((v, i) => v + b[i] + rnd()), [{ name: 'a', values: a }, { name: 'b', values: b }]);
  const mb = R.deserialize(JSON.parse(JSON.stringify(R.serialize(mm))));
  near(mb.predict({ a: 3, b: 2 }), mm.predict({ a: 3, b: 2 }), 1e-9, '다중 예측');
});

test('검증: 뒤쪽 20%를 숨기고 맞혀본다', () => {
  const x = range(25, i => i), y = x.map(v => 1 + v + rnd());
  const v = R.validate('linear', x, y, 'tail');
  assert.equal(v.nTest, 5); assert.equal(v.nTrain, 20);
  assert.ok(v.rmse < 1);
  const s = R.validate('linear', x, y, 'spread');
  assert.equal(s.nTest, 5);
});

test('빈 값·변하지 않는 값·로그 불가 데이터', () => {
  assert.ok(R.bestFit([1, 2, 3], [1, 2, 3]).error);
  assert.equal(R.bestFit([1, 2, 3, 4, 5], [7, 7, 7, 7, 7]).constant, 7);
  const fr = R.bestFit([0, 1, 2, 3, NaN, 5, 6], [1, -2, 3, 4, 5, NaN, 7]);
  assert.equal(fr.n, 5);
  assert.ok(!fr.all.some(f => f.id === 'log' || f.id === 'exp' || f.id === 'power'));
});

test('상세 통계: statsmodels 결과와 같다', () => {
  // 기준값은 같은 데이터를 Python statsmodels OLS 로 계산한 값
  let sd5 = 5; const r = () => { sd5 = (sd5 * 16807) % 2147483647; return sd5 / 2147483647 - 0.5; };
  const x = range(30, i => i * 2 + 1), y = x.map(v => 3 + 0.4 * v - 0.004 * v * v + r() * 2);
  const q = R.fitModel('quad', x, y), d = R.details(q, 't');
  near(d.anova.F, 412.367064912261, 1e-9, 'F');
  near(d.anova.p, 5.811739483638463e-21, 1e-6, 'F p');
  near(d.coefs[2].p, 3.00483616e-11, 1e-6, 'x² p');
  near(d.coefs[2].lo, -0.00496358, 1e-5, 'CI 하한');
  near(d.dw, 1.93383920777849, 1e-9, 'DW');
  near(d.jb, 1.712701430649789, 1e-9, 'JB');
  near(d.lev[0], 0.26330645, 1e-7, '지렛값');
  near(d.cook[0], 0.30094166, 1e-7, '쿡의 거리');
  near(q.aic, 54.11184170144979, 1e-9, 'AIC');
  const a = range(30, i => i + r() * 8), b = range(30, i => (i % 6) * 2 + r() * 3);
  const yy = a.map((v, i) => 2 + 0.5 * v - 1.2 * b[i] + r() * 3);
  const m = R.multiRegression('y', yy, [{ name: 'a', values: a }, { name: 'b', values: b }]);
  const dm = R.details(m);
  near(dm.coefs[0].se, 0.3814461674465754, 1e-9, '절편 표준오차');
  near(dm.coefs[1].p, 1.2669198530623145e-20, 1e-6, 'a p');
  near(dm.coefs[1].vif, 1.0181086845704967, 1e-9, 'VIF');
  near(dm.anova.F, 574.3651616435178, 1e-9, '다중 F');
  near(dm.dw, 1.7552080860144157, 1e-9, '다중 DW');
});

test('분포 함수: t·F 임계값', () => {
  near(R.tP(2.160, 13), 0.05, 1e-3, 't p');
  near(R.fP(4.667, 1, 13), 0.05, 1e-3, 'F p');
  near(R.t975(1), 12.706, 1e-4, 't(1)');
  near(R.t975(1000), 1.9623, 1e-4, 't(1000)');
});

console.log(`\n${pass}개 모두 통과`);
