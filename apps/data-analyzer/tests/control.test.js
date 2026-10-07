// 조작 판단 학습 검사. 실행: node apps/data-analyzer/tests/control.test.js
'use strict';
const assert = require('node:assert/strict');
const C = require('../control.js');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('✓', name); };

// 가상의 운전 기록: 압력이 4.9 미만이면 올리고 5.1 초과면 내리는 운전자
function simulate({ seed = 3, n = 240, rule = true } = {}) {
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  let P = 5, V = 50;
  const D = [], Ps = [], Vs = [], T = [];
  for (let i = 0; i < n; i++) {
    const d = 1000 + 200 * Math.sin(i / 40) + rnd() * 20;
    if (i > 0) {
      let dv = 0;
      if (rule) { if (Ps[i - 1] < 4.9) dv = 1; else if (Ps[i - 1] > 5.1) dv = -1; }
      else dv = rnd() > 0.3 ? 1 : rnd() < -0.3 ? -1 : 0; // 아무 규칙 없이 조작
      V += dv;
    }
    P = P + 0.0003 * (V * 20 - d) + rnd() * 0.01;
    if (!rule) P = 5 + rnd() * 0.4;
    D.push(d); Ps.push(P); Vs.push(V); T.push(10 + rnd());
  }
  return [{ name: '수요', values: D }, { name: '압력', values: Ps }, { name: '온도', values: T }, { name: '개도', values: Vs }];
}

test('규칙대로 조작한 운전자의 기준값을 찾는다', () => {
  const L = C.learn(simulate(), { mv: 3, inputs: [0, 1, 2], window: 5 });
  assert.ok(!L.error);
  assert.equal(L.learned, true);
  const pIdx = L.F.defs.findIndex(d => d.label === '압력');
  const thr = [];
  (function walk(n) { if (n.left) { if (n.j === pIdx) thr.push(n.thr); walk(n.left); walk(n.right); } })(L.tree.tree);
  assert.ok(thr.some(t => Math.abs(t - 4.9) < 0.03), `4.9 근처 기준 없음: ${thr}`);
  assert.ok(thr.some(t => Math.abs(t - 5.1) < 0.03), `5.1 근처 기준 없음: ${thr}`);
  assert.ok(L.evaluation.direction.tree > L.evaluation.direction.base);
});

test('추천: 압력이 낮으면 올림, 높으면 내림, 한계에서 자름', () => {
  const L = C.learn(simulate(), { mv: 3, inputs: [0, 1, 2], window: 5 });
  const st = p => ({ inputs: { 수요: { now: 1000, before: 1000 }, 압력: { now: p, before: p }, 온도: { now: 10, before: 10 } }, mvNow: 50 });
  assert.equal(C.recommend(L, st(4.7)).dir, 1);
  assert.equal(C.recommend(L, st(5.3)).dir, -1);
  assert.equal(C.recommend(L, st(5.0)).dir, 0);
  const capped = C.recommend(L, st(4.7), { max: 50 });
  assert.equal(capped.next, 50);
  assert.ok(capped.clipped.length > 0);
});

test('규칙 없이 조작하면 "배운 게 없음"으로 나온다', () => {
  const L = C.learn(simulate({ rule: false, seed: 9 }), { mv: 3, inputs: [0, 1, 2], window: 5 });
  assert.equal(L.learned, false);
});

test('저장한 모델의 나무로 같은 판단을 한다', () => {
  const L = C.learn(simulate(), { mv: 3, inputs: [0, 1, 2], window: 5 });
  const json = JSON.parse(JSON.stringify(C.serialize(L)));
  const walk = (n, x) => (n.left ? walk(x[n.j] < n.thr ? n.left : n.right, x) : n.value);
  L.F.X.slice(0, 50).forEach(x => assert.equal(+walk(json.tree, x).toPrecision(10), +C.predictTree(L.tree, x).toPrecision(10)));
  assert.equal(json.timing, 'state(t-1) -> action(t)');
});

test('값이 적으면 오류 메시지', () => {
  const s = simulate({ n: 15 });
  assert.ok(C.learn(s, { mv: 3, inputs: [0, 1], window: 5 }).error);
});

console.log(`\n${pass}개 모두 통과`);
