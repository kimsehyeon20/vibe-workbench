// 조작 판단 학습 검사. 실행: node apps/data-analyzer/tests/control.test.js
'use strict';
const assert = require('node:assert/strict');
global.Regression = require('../regression.js');
const C = require('../control.js');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('✓', name); };

// 가상의 운전 기록: 압력이 4.9 미만이면 올리고 5.1 초과면 내리는 운전자
// opts: act(조작 확률), noise(개도 읽기 잡음), quietTail(끝부분 조용한 줄 수)
function simulate({ seed = 3, n = 240, rule = true, act = 1, noise = 0, step = 1, k = 0.0003 } = {}) {
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  let P = 5, V = 50;
  const D = [], Ps = [], Vs = [], T = [], Vread = [];
  for (let i = 0; i < n; i++) {
    const d = 1000 + 200 * Math.sin(i / 40) + rnd() * 20;
    if (i > 0) {
      let dv = 0;
      if (rule) { if (Ps[i - 1] < 4.9) dv = step; else if (Ps[i - 1] > 5.1) dv = -step; }
      else dv = rnd() > 0.3 ? step : rnd() < -0.3 ? -step : 0;
      if (rnd() + 0.5 > act) dv = 0;
      V += dv;
    }
    P = P + k * (V * 20 - d) + rnd() * 0.01;
    if (!rule) P = 5 + rnd() * 0.4;
    D.push(d); Ps.push(P); Vs.push(V); T.push(10 + rnd()); Vread.push(V + rnd() * 2 * noise);
  }
  return [{ name: '수요', values: D }, { name: '압력', values: Ps }, { name: '온도', values: T }, { name: '개도', values: Vread }];
}
const opt = { mv: 3, inputs: [0, 1, 2], window: 5 };
const pIdx = L => L.F.defs.findIndex(d => d.label === '압력');
const thresholds = L => { const out = []; (function walk(n) { if (n.left) { if (n.j === pIdx(L)) out.push(n.thr); walk(n.left); walk(n.right); } })(L.tree.tree); return out; };
const st = p => ({ inputs: { 수요: { now: 1000, before: 1000 }, 압력: { now: p, before: p }, 온도: { now: 10, before: 10 } }, mvNow: 50 });

test('규칙대로 조작한 운전자의 기준값을 찾는다', () => {
  const L = C.learn(simulate(), opt);
  assert.ok(!L.error, L.error);
  assert.equal(L.learned, true);
  const thr = thresholds(L);
  assert.ok(thr.some(t => Math.abs(t - 4.9) < 0.03), `4.9 근처 기준 없음: ${thr}`);
  assert.ok(thr.some(t => Math.abs(t - 5.1) < 0.03), `5.1 근처 기준 없음: ${thr}`);
});

test('추천: 압력이 낮으면 올림, 높으면 내림, 한계에서 자름', () => {
  const L = C.learn(simulate(), opt);
  assert.equal(C.recommend(L, st(4.7)).dir, 1);
  assert.equal(C.recommend(L, st(5.3)).dir, -1);
  assert.equal(C.recommend(L, st(5.0)).dir, 0);
  const capped = C.recommend(L, st(4.7), { max: 50 });
  assert.equal(capped.next, 50);
  assert.ok(capped.clipped.length > 0);
});

test('개도 읽기 잡음(±0.05)은 조작으로 세지 않는다', () => {
  const clean = C.learn(simulate({ seed: 4, n: 600, step: 2 }), opt);
  const noisy = C.learn(simulate({ seed: 4, n: 600, step: 2, noise: 0.05 }), opt);
  const a = clean.stats.up + clean.stats.down, b = noisy.stats.up + noisy.stats.down;
  assert.ok(Math.abs(a - b) <= 2, `잡음 없음 ${a}번, 잡음 ${b}번`);
  assert.ok(noisy.deadband > 0.1 && noisy.deadband < 1.5, `데드밴드 ${noisy.deadband}`);
});

test('드물게 조작해도(그 상황의 20%만) 규칙과 추천이 조작 방향을 말한다', () => {
  const L = C.learn(simulate({ seed: 6, n: 1440, act: 0.2, k: 0.00005 }), opt);
  assert.ok(!L.error, L.error);
  assert.equal(C.recommend(L, st(4.6)).dir, 1);
  assert.equal(C.recommend(L, st(5.4)).dir, -1);
  assert.equal(C.recommend(L, st(5.0)).dir, 0);
});

test('규칙 없이 조작하면 "배운 게 없음"', () => {
  const L = C.learn(simulate({ rule: false, seed: 9 }), opt);
  assert.equal(L.learned, false);
});

test('검증 구간에 조작이 없으면 판정 보류(learned = null), 비난하지 않음', () => {
  const s = simulate({ seed: 3, n: 320 });
  // 끝 110줄은 개도를 고정 (조작 없음)
  const v = s[3].values; for (let i = 210; i < 320; i++) v[i] = v[209];
  const L = C.learn(s, opt);
  assert.ok(!L.error);
  assert.notEqual(L.learned, false);
});

test('조작 항목이 한 번도 안 바뀌거나 너무 적게 바뀌면 오류', () => {
  const s = simulate(); s[3].values = s[3].values.map(() => 40);
  assert.ok(C.learn(s, opt).error.includes('한 번도'));
  const s2 = simulate(); s2[3].values = s2[3].values.map((_, i) => (i < 100 ? 40 : 45));
  assert.ok(C.learn(s2, opt).error.includes('번뿐'));
});

test('시간이 끊긴 곳은 조작으로 세지 않고, 추세 창도 건너지 않는다', () => {
  const s = simulate({ n: 300 });
  const t = s[0].values.map((_, i) => i * 60 + (i >= 150 ? 12 * 3600 : 0));
  s[3].values = s[3].values.map((v, i) => (i >= 150 ? v + 10 : v)); // 밤사이 10 변경 (기록 없음)
  const L = C.learn(s, { ...opt, t });
  assert.ok(L.stats.stepMax <= 1 + 1e-9, `최대 조작 ${L.stats.stepMax}`);
  assert.ok(L.warnings.some(w => w.includes('끊긴')));
});

test('추천 한계: 잘못된 한계는 오류, 한 번 최대를 넘지 않음', () => {
  const L = C.learn(simulate(), opt);
  assert.ok(C.recommend(L, st(4.7), { maxStep: -1 }).error);
  assert.ok(C.recommend(L, st(4.7), { min: 80, max: 20 }).error);
  const r = C.recommend(L, st(5.0), { min: 60, maxStep: 1 });
  assert.ok(Math.abs(r.delta) <= 1 + 1e-12 && r.dir === 1);
});

test('기록 범위 밖 입력은 알린다', () => {
  const L = C.learn(simulate(), opt);
  const r = C.recommend(L, { ...st(5.0), inputs: { ...st(5.0).inputs, 수요: { now: 1600, before: 1600 } } });
  assert.ok(r.outside.some(o => o.label === '수요'));
});

test('값이 드문 근거 항목은 빼고 알린다', () => {
  const s = simulate({ n: 300 });
  s.push({ name: '분석계', values: s[0].values.map((_, i) => (i % 30 === 0 ? 20 : NaN)) });
  const L = C.learn(s, { mv: 3, inputs: [0, 1, 2, 4], window: 5 });
  assert.ok(!L.error, L.error);
  assert.deepEqual(L.dropped, ['분석계']);
});

test('펌프 기동/정지 같은 이산 조작은 0/1로만 추천', () => {
  let seed = 2; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const lv = [], pump = []; let L0 = 60, on = 0;
  for (let i = 0; i < 600; i++) {
    if (L0 > 70 && !on && rnd() > -0.2) on = 1; else if (L0 < 50 && on && rnd() > -0.2) on = 0;
    L0 += (on ? -0.8 : 0.5) + rnd() * 0.2; lv.push(L0); pump.push(on);
  }
  const Lm = C.learn([{ name: '레벨', values: lv }, { name: '펌프', values: pump }], { mv: 1, inputs: [0], window: 3 });
  assert.ok(!Lm.error, Lm.error);
  assert.deepEqual(Lm.discrete, [0, 1]);
  const r = C.recommend(Lm, { inputs: { 레벨: { now: 75, before: 74 } }, mvNow: 0 });
  assert.equal(r.next, 1);
});

test('저장한 모델의 나무로 같은 판단을 한다', () => {
  const L = C.learn(simulate(), opt);
  const json = JSON.parse(JSON.stringify(C.serialize(L)));
  const walk = (n, x) => (n.left ? walk(x[n.j] < n.thr ? n.left : n.right, x) : n.decision.delta);
  L.F.X.slice(0, 80).forEach(x => assert.equal(+walk(json.tree, x).toPrecision(10), +C.predictTree(L.tree, x).toPrecision(10)));
  assert.equal(json.timing, 'state(t-1) -> action(t)');
  assert.ok(json.windowSeconds > 0 && json.windowRows === 5);
});

test('값이 적으면 오류 메시지', () => {
  const s = simulate({ n: 15 });
  assert.ok(C.learn(s, { mv: 3, inputs: [0, 1], window: 5 }).error);
});

test('하루치 1분 데이터×여러 날도 빨리 끝난다', () => {
  const s = simulate({ n: 20000, act: 0.3 });
  const t0 = Date.now();
  const L = C.learn(s, opt);
  assert.ok(!L.error);
  assert.ok(Date.now() - t0 < 20000, `${Date.now() - t0} ms`);
});

test('최소 폭을 조작 단위(1)와 같게 넣어도 1만큼의 조작을 센다', () => {
  const a = C.learn(simulate(), opt), b = C.learn(simulate(), { ...opt, deadband: 1 });
  assert.ok(!b.error, b.error);
  assert.equal(b.stats.up + b.stats.down, a.stats.up + a.stats.down);
});

console.log(`\n${pass}개 모두 통과`);
