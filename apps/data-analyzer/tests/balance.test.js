// 수지(입·출·저장량) 분석 검사. 실행: node apps/data-analyzer/tests/balance.test.js
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
const want = { 발전소: 1 / 1.04, 열연가열로: 1 / 0.97, 보일러: 1 };
const verdict = (r, n) => r.beta.find(b => b.name === n).verdict;

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
  r.beta.filter(b => want[b.name]).forEach(b => assert.ok(b.lo <= want[b.name] && want[b.name] <= b.hi, `${b.name}: ${b.lo}~${b.hi} vs ${want[b.name]}`));
  assert.equal(verdict(r, '발전소'), 'bias');
  assert.equal(verdict(r, '열연가열로'), 'bias');
  assert.notEqual(verdict(r, '보일러'), 'bias');
  assert.ok(r.aCI[0] <= -demo.truth.loss && -demo.truth.loss <= r.aCI[1], `손실 ${r.aCI}`);
});

test('레벨 환산값을 모를 때: 기준 계측기로 환산값까지 추정', () => {
  const r = B.analyze(ex.series, { levelFactor: null, reference: '회수유량(Nm3/h)' });
  assert.ok(r.factorEstimated);
  near(r.factor, demo.levelFactor, 0.01, '환산값');
  assert.equal(r.beta.find(b => b.name === '회수유량(Nm3/h)').ref, true);
  assert.equal(verdict(r, '발전소'), 'bias');
});

test('레벨 잡음이 커도(±0.2%) 환산값을 낮게 잡지 않고, 맞는 계측기를 틀렸다고 하지 않는다', () => {
  const d = B.demo({ levelNoise: 0.4, bias: { 발전소: 1, 열연가열로: 1, 보일러: 1 } });
  const r = B.analyze(B.extract(d.sources).series, { reference: '회수유량(Nm3/h)' });
  near(r.factor, 1200, 0.03, '환산값');
  r.beta.forEach(b => assert.ok(!['bias', 'common'].includes(b.verdict), `${b.name} ${b.verdict} ${b.est}`));
});

test('레벨이 없으면 합계만', () => {
  const s = ex.series.map(x => ({ ...x, role: x.role === 'level' ? 'ignore' : x.role }));
  const r = B.analyze(s, {});
  assert.ok(!r.beta && r.note);
  near(r.tin, r.totals[0].volume, 1e-12, '유입 합계');
});

test('레벨 끊김(I/O Timeout 30분)·유량 빈틈(40분) 구간은 빼고, 사라진 양도 빈틈 없는 구간으로만 계산', () => {
  const d = B.demo({ levelOutage: [36000, 37800], recHole: [50000, 52400] });
  const r = B.analyze(B.extract(d.sources).series, { levelFactor: 1200 });
  assert.ok(r.skipped >= 5, `빠진 구간 ${r.skipped}`);
  assert.ok(r.skipBy['홀더레벨(%)'] >= 2 && r.skipBy['회수유량(Nm3/h)'] >= 3);
  assert.equal(verdict(r, '발전소'), 'bias');
  // 계측 오차·손실만큼만 차이가 남는다 (빈틈을 선으로 이은 양은 섞이지 않음)
  const r0 = B.analyze(ex.series, { levelFactor: 1200 });
  assert.ok(Math.abs(r.gapPct - r0.gapPct) < 0.004, `${r.gapPct} vs ${r0.gapPct}`);
});

test('구간마다 0인 사용처(보일러 정지)는 β = 1로 두고 나머지는 계산한다', () => {
  const d = B.demo({ boilerOff: true });
  const r = B.analyze(B.extract(d.sources).series, { levelFactor: 1200 });
  assert.ok(!r.regError, r.regError);
  assert.equal(verdict(r, '보일러'), 'fixed');
  assert.equal(verdict(r, '발전소'), 'bias');
  assert.ok(r.notes.some(n => n.includes('보일러')));
});

test('레벨 환산값이 10% 틀리면 모든 계측기를 탓하지 않고 환산값을 의심한다', () => {
  const d = B.demo({ bias: { 발전소: 1, 열연가열로: 1, 보일러: 1 } });
  const r = B.analyze(B.extract(d.sources).series, { levelFactor: 1320 });
  assert.ok(r.notes.some(n => n.includes('레벨 1단위당 부피')), r.notes.join('/'));
  assert.ok(r.beta.every(b => b.verdict !== 'bias'));
});

test('레벨이 60초 늦게 기록되면 찾아서 맞춘다', () => {
  const d = B.demo({ levelLag: 60 });
  const r = B.analyze(B.extract(d.sources).series, { levelFactor: 1200 });
  assert.ok(Math.abs(r.lag - 60) <= 30, `lag ${r.lag}`);
  r.beta.filter(b => want[b.name]).forEach(b => assert.ok(b.lo - 0.005 <= want[b.name] && want[b.name] <= b.hi + 0.005, `${b.name}: ${b.lo}~${b.hi}`));
});

test('물탱크 예시: 탱크 크기를 몰라도 펌프·세척 라인 편차와 손실을 찾는다', () => {
  const d = B.demoTank();
  const r = B.analyze(B.extract(d.sources).series, {});
  near(r.factor, d.truth.area, 0.02, '1%당 부피');
  const b2 = r.beta.find(b => b.name.startsWith('2번 펌프')), bw = r.beta.find(b => b.name.startsWith('세척'));
  assert.ok(b2.lo <= 1 / 0.95 && 1 / 0.95 <= b2.hi && b2.verdict === 'bias');
  assert.ok(bw.lo <= 1 / 1.06 && 1 / 1.06 <= bw.hi && bw.verdict === 'bias');
  assert.ok(r.aCI[0] <= -1.5 && -1.5 <= r.aCI[1]);
  assert.equal(r.au, 'm3');
});

/* ---------- 읽기: 여러 모양 ---------- */
const lines = (head, rows) => [head, ...rows].join('\n');
test('역할: "…사용량"은 유출, %·온도는 안 씀, 수위·SOC는 레벨', () => {
  assert.equal(B.guessRole('발전소 사용량(Nm3/h)'), 'out');
  assert.equal(B.guessRole('가스 저장량(Nm3)'), 'volume');
  assert.equal(B.guessRole('CO(%)'), 'ignore');
  assert.equal(B.guessRole('탱크 수위(%)'), 'level');
  assert.equal(B.guessRole('배터리 SOC(%)'), 'level');
});

test('단위: kNm3/h·천Nm3/h는 1000배, Nm3/d는 하루당', () => {
  assert.deepEqual(B.flowUnitOf('회수(kNm3/h)'), { unit: 'h', scale: 1000 });
  assert.deepEqual(B.flowUnitOf('회수(천Nm3/h)'), { unit: 'h', scale: 1000 });
  assert.deepEqual(B.flowUnitOf('사용(Nm3/d)'), { unit: 'd', scale: 1 });
  assert.equal(B.amountUnitOf('회수(kNm3/h)'), 'Nm3');
  assert.equal(B.amountUnitOf('충전(kW)'), 'kWh');
});

test('넓은 표에 글자 칸(운전상태)이 있어도 긴 표로 착각하지 않는다', () => {
  const rows = Array.from({ length: 60 }, (_, i) => `2026-10-01 00:${String(i).padStart(2, '0')}:00\t${1000 + i}\t${500 + i}\t${i % 7 ? 'RUN' : 'STOP'}\t${50 + i / 100}`);
  const e = B.extract([{ name: 'w.csv', text: lines('시각\t회수(Nm3/h)\t사용(Nm3/h)\t운전상태\t레벨(%)', rows) }]);
  assert.deepEqual(e.series.map(s => s.name), ['회수(Nm3/h)', '사용(Nm3/h)', '레벨(%)']);
});

test('일자 칸과 시각 칸이 따로 있어도 시각을 합쳐 쓴다', () => {
  const rows = Array.from({ length: 120 }, (_, i) => `2026-10-01\t${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00\t${1000 + i}`);
  const e = B.extract([{ name: 'd.csv', text: lines('일자\t시각\t회수(Nm3/h)', rows) }]);
  assert.equal(e.series[0].t.length, 120);
  assert.equal(e.series[0].dt, 60);
});

test('하루 단위 파일(같은 칸)은 이어 붙이고, 같은 파일 두 번은 한 번만', () => {
  const day = k => ({ name: `day${k}.csv`, text: lines('시각\t회수(Nm3/h)\t레벨(%)', Array.from({ length: 48 }, (_, i) => `2026-10-0${k} ${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00\t${1000 + i}\t${50 + i / 10}`)) });
  const e = B.extract([day(1), day(2), day(2)]);
  assert.deepEqual(e.series.map(s => s.name), ['회수(Nm3/h)', '레벨(%)']);
  assert.equal(e.series[0].t.length, 96);
  assert.ok(e.warnings.some(w => w.includes('똑같')));
});

test('날짜 없는 시각: 태그 순으로 정렬된 긴 표도 모두 같은 날, 하루 단위 파일은 이름 순으로 이어 붙임', () => {
  const tags = ['발전소', '가열로', '보일러'];
  const rows = tags.flatMap(k => Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00:00\t${k}\t${1000 + h}`));
  const e = B.extract([{ name: 'long.csv', text: lines('시각\t사용처\t유량(Nm3/h)', rows) }]);
  assert.ok(e.series.every(s => s.t[0] === 0 && s.t[s.t.length - 1] === 23 * 3600), e.series.map(s => s.t[0]).join(','));
  const day = k => ({ name: `d${k}.csv`, text: lines('시각\t회수(Nm3/h)', Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00:00\t${k * 100 + h}`)) });
  const e2 = B.extract([day(2), day(1)]);
  assert.equal(e2.series.length, 1);
  assert.equal(e2.series[0].t.length, 48);
  assert.equal(e2.series[0].v[0], 100); // d1 이 먼저
});

test('숫자 시간 칸 "경과(분)"은 분으로 읽는다', () => {
  const rows = Array.from({ length: 1441 }, (_, m) => `${m}\t1000\t${50 + m / 1440}`);
  const e = B.extract([{ name: 'm.csv', text: lines('경과(분)\t회수(Nm3/h)\t레벨(%)', rows) }]);
  const r = B.analyze(e.series, {});
  near(r.tin, 24000, 1e-9, '24시간 × 1000');
});

test('긴 데이터의 자동 구간은 짧게 (30일 1분 기록 → 15분)', () => {
  assert.equal(B.pickWindow(30 * 86400, 60, 4), 900);
  assert.equal(B.pickWindow(6 * 3600, 60, 4), 900);
  assert.ok(3 * 3600 / B.pickWindow(3 * 3600, 60, 4) >= 12 && 3600 / B.pickWindow(3600, 60, 4) >= 12);
});

console.log(`\n${pass}개 모두 통과`);
