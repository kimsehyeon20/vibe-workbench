// 홀더 수지 검사. 실행: node apps/data-analyzer/tests/balance.test.js
'use strict';
const assert = require('node:assert/strict');
global.Reader = require('../reader.js');
global.Regression = require('../regression.js');
const B = require('../balance.js');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('✓', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} ≠ ${b}`);
const demo = B.demo();
const ex = B.extract(demo.sources);
const byName = n => ex.series.find(s => s.name === n);

test('시간축이 다른 계열 읽기: 넓은 표 · 긴 표(사용처 태그)', () => {
  assert.deepEqual(ex.series.map(s => [s.name, s.role]), [['회수유량(Nm3/h)', 'in'], ['발전소', 'out'], ['열연가열로', 'out'], ['보일러', 'out'], ['홀더레벨(%)', 'level']]);
  assert.equal(byName('회수유량(Nm3/h)').dt, 5);
  assert.equal(byName('발전소').dt, 60);
  assert.equal(byName('홀더레벨(%)').dt, 30);
});

test('적분: 측정 간격이 달라도 같은 양', () => {
  const fine = { t: Array.from({ length: 3601 }, (_, i) => i), v: Array(3601).fill(36000) };
  const coarse = { t: Array.from({ length: 61 }, (_, i) => i * 60), v: Array(61).fill(36000) };
  near(B.integrate(fine, 0, 3600).v, 36000, 1e-12, '1초');
  near(B.integrate(coarse, 0, 3600).v, 36000, 1e-12, '1분');
  near(B.integrate(coarse, 30, 1830).v, 18000, 1e-12, '경계가 측정 시각과 다름');
  assert.ok(Number.isNaN(B.integrate(coarse, -10, 100)));
});

test('레벨 환산값을 알 때: 넣어 둔 계측 오차와 손실을 95% 범위 안에서 찾는다', () => {
  const r = B.analyze(ex.series, { levelFactor: demo.levelFactor });
  const want = { 발전소: 1 / 1.04, 열연가열로: 1 / 0.97, 보일러: 1 };
  r.beta.filter(b => want[b.name]).forEach(b => assert.ok(b.lo <= want[b.name] && want[b.name] <= b.hi, `${b.name}: ${b.lo}~${b.hi} vs ${want[b.name]}`));
  assert.equal(r.beta.find(b => b.name === '발전소').verdict, 'bias');
  assert.equal(r.beta.find(b => b.name === '열연가열로').verdict, 'bias');
  assert.equal(r.beta.find(b => b.name === '보일러').verdict, 'ok');
  assert.ok(r.aCI[0] <= -demo.truth.loss && -demo.truth.loss <= r.aCI[1], `손실 ${r.aCI}`);
});

test('레벨 환산값을 모를 때: 기준 계측기로 환산값까지 추정', () => {
  const r = B.analyze(ex.series, { levelFactor: null, reference: '회수유량(Nm3/h)' });
  assert.ok(r.factorEstimated);
  near(r.factor, demo.levelFactor, 0.01, '환산값');
  assert.equal(r.beta.find(b => b.name === '회수유량(Nm3/h)').ref, true);
  assert.equal(r.beta.find(b => b.name === '발전소').verdict, 'bias');
});

test('레벨이 없으면 합계만', () => {
  const s = ex.series.map(x => ({ ...x, role: x.role === 'level' ? 'ignore' : x.role }));
  const r = B.analyze(s, {});
  assert.ok(!r.beta && r.note);
  near(r.tin, r.totals[0].volume, 1e-12, '유입 합계');
});

console.log(`\n${pass}개 모두 통과`);
