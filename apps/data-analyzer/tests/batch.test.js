// 강번별 분석 검사. 실행: node apps/data-analyzer/tests/batch.test.js
'use strict';
const assert = require('node:assert/strict');
global.Reader = require('../reader.js');
global.Regression = require('../regression.js');
const B = require('../batch.js');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('✓', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} ≠ ${b}`);
const demo = B.demo();
const run = (sources, over = {}) => { const src = sources.map(B.readSource); const cfg = { ...B.guess(src), ...over }; return { cfg, res: B.analyze(src, cfg) }; };
const base = run(demo.sources).res;
const vols = new Map(base.heats.map(h => [h.id, h.sum.volume]));

test('적분: 일정한 유량 60,000 Nm³/h × 10분 = 10,000 Nm³', () => {
  const t = Array.from({ length: 121 }, (_, i) => i * 5), q = t.map(() => 60000);
  near(B.integrate(t, q, 3600), 10000, 1e-12, '회수량');
  near(B.integrate(t, q, 3600, 300), 5000, 1e-12, '5분까지');
  near(B.integrate([0, 10], [0, 3600], 3600), 5, 1e-12, '사다리꼴');
});

test('파일 여러 개 = 강번 여러 개, 앞뒤 0 잘라내기, 이상 강번 찾기', () => {
  assert.equal(base.heats.length, 12);
  assert.ok(base.heats.every(h => h.q[0] >= h.th && h.t[0] === 0));
  const bad = base.heats.filter(h => h.flags.length).map(h => h.id);
  assert.deepEqual(bad, ['D24107']);
});

test('긴 표(강번 칸 + 시각 + 유량) 한 파일도 같은 결과', () => {
  const lines = ['강번\t시각\t회수유량(Nm3/h)'];
  demo.sources.forEach(s => s.text.split('\n').slice(1).forEach(l => { const [t, q] = l.split('\t'); lines.push(`${s.name.replace('.csv', '')}\t${t}\t${q}`); }));
  const { cfg, res } = run([{ name: 'all.csv', text: lines.join('\n') }]);
  assert.equal(cfg.shape, 'long');
  assert.equal(res.heats.length, 12);
  res.heats.forEach(h => near(h.sum.volume, vols.get(h.id), 1e-9, h.id));
});

test('연속 기록 한 파일 → 회수 구간마다 자동으로 나눔', () => {
  const lines = ['시각\t회수유량(Nm3/h)'];
  demo.sources.forEach(s => s.text.split('\n').slice(1).forEach(l => { const [t, q] = l.split('\t'); lines.push(`${t}\t${q}`); }));
  const { cfg, res } = run([{ name: 'log.csv', text: lines.join('\n') }]);
  assert.equal(cfg.shape, 'continuous');
  assert.equal(res.heats.length, 12);
  const sum = res.heats.reduce((a, h) => a + h.sum.volume, 0), want = [...vols.values()].reduce((a, b) => a + b, 0);
  near(sum, want, 0.01, '전체 회수량');
});

test('넓은 표(열마다 강번, 경과 초) → 강번 12개', () => {
  const step = 5, rows = new Map();
  base.heats.forEach(h => h.t.forEach((t, i) => { if (!rows.has(t)) rows.set(t, {}); rows.get(t)[h.id] = h.q[i]; }));
  const ids = base.heats.map(h => h.id), ts = [...rows.keys()].sort((a, b) => a - b).filter(t => t % step === 0);
  const text = ['경과(초)\t' + ids.join('\t'), ...ts.map(t => [t, ...ids.map(id => rows.get(t)[id] ?? '')].join('\t'))].join('\n');
  const { cfg, res } = run([{ name: 'wide.csv', text }]);
  assert.equal(cfg.shape, 'wide');
  assert.equal(res.heats.length, 12);
  res.heats.forEach(h => near(h.sum.volume, vols.get(h.id), 1e-6, h.id));
});

test('대표 곡선: 시간 맞춤 평균 곡선의 적분 ≈ 평균 회수량', () => {
  const al = base.align;
  const v = B.integrate(al.grid, al.mean, 3600);
  near(v, base.stats.mean, 0.01, '평균 곡선 적분');
  const pct = run(demo.sources, { align: 'pct' }).res.align;
  assert.equal(pct.grid.length, 201);
  assert.ok(pct.p10.every((v, j) => v <= pct.p90[j] + 1e-9));
});

test('중간 예측과 조업 정보 관계', () => {
  assert.ok(base.early.length >= 3);
  assert.ok(base.early.every(e => e.model.r2 >= 0 && e.n === 12));
  const f = B.factors(base, demo.attrs);
  assert.equal(f.matched, 12);
  assert.equal(f.rel[0].name, '산소취입량(Nm3)');
  assert.ok(f.rel[0].r > 0.6 && f.rel[0].p < 0.05);
  assert.ok(f.intensity.every(v => v > 50 && v < 100));
  assert.ok(B.factors(base, '강번\t값\nX1\t1\nX2\t2').error);
});

console.log(`\n${pass}개 모두 통과`);
