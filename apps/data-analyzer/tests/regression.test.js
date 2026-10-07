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
    const m = R.fitModel(id, x, x.map(f));
    want.forEach((w, k) => near(m.params[k], w, 1e-6, `${id} 계수 ${k}`));
    near(m.r2, 1, 1e-9, `${id} R²`);
    near(m.predict(250), f(250), 1e-6, `${id} 예측`);
  }
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

console.log(`\n${pass}개 모두 통과`);
