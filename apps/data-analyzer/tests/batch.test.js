// 배치별 분석 검사. 실행: node apps/data-analyzer/tests/batch.test.js
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
const vols = new Map(base.heats.map(h => [h.id, h.sum.total]));

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
  res.heats.forEach(h => near(h.sum.total, vols.get(h.id), 1e-9, h.id));
});

test('연속 기록 한 파일 → 회수 구간마다 자동으로 나눔', () => {
  const lines = ['시각\t회수유량(Nm3/h)'];
  demo.sources.forEach(s => s.text.split('\n').slice(1).forEach(l => { const [t, q] = l.split('\t'); lines.push(`${t}\t${q}`); }));
  const { cfg, res } = run([{ name: 'log.csv', text: lines.join('\n') }]);
  assert.equal(cfg.shape, 'continuous');
  assert.equal(res.heats.length, 12);
  const sum = res.heats.reduce((a, h) => a + h.sum.total, 0), want = [...vols.values()].reduce((a, b) => a + b, 0);
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
  res.heats.forEach(h => near(h.sum.total, vols.get(h.id), 1e-6, h.id));
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

/* ---------- 여러 상황 (점검에서 찾은 문제들) ---------- */
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const p2 = n => String(n).padStart(2, '0');
const clock = s => `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(Math.floor(s % 60))}`;
// 봉우리 모양 하나: [초, 값]
function pulse({ T = 600, peak = 90000, dt = 5, pre = 30, post = 30, base = 0 } = {}) {
  const out = [];
  for (let s = -pre; s <= T + post; s += dt) { const u = s / T; out.push([s, s < 0 || s > T ? base : peak * (1 - Math.exp(-u / 0.08)) * (1 - u ** 6) * (1 + rnd() * 0.03)]); }
  return out;
}
const trap = pts => { let v = 0; for (let i = 1; i < pts.length; i++) v += (pts[i][1] + pts[i - 1][1]) / 2 * (pts[i][0] - pts[i - 1][0]); return v / 3600; };

test('단위 없는 "시간"·"경과시간" 숫자 칸: 값 범위로 초/분을 짐작 (시간으로 보지 않음)', () => {
  assert.equal(B.timeUnitOf('경과시간', [0, 5, 600]).unit, 's');
  assert.equal(B.timeUnitOf('시간', Array.from({ length: 16 }, (_, i) => i)).unit, 'min');
  assert.equal(B.timeUnitOf('경과시간', [0, 5, 600]).sure, false);
  assert.equal(B.timeUnitOf('경과시간(초)').unit, 's');
  assert.equal(B.timeUnitOf('Time [s]').unit, 's');
  assert.equal(B.timeUnitOf('운전시간(h)').unit, 'h');
  const pts = pulse();
  const { res } = run([1, 2, 3].map(k => ({ name: `${k}.csv`, text: ['경과시간\t회수유량(Nm3/h)', ...pts.map(([t, q]) => `${t + 30}\t${q}`)].join('\n') })));
  near(res.heats[0].sum.total, trap(pts), 0.02, '총량');
});

test('값 칸 고르기: 온도·%·누적계보다 유량 칸', () => {
  const pts = pulse();
  const mk = cols => [{ name: 'a.csv', text: ['시각\t' + cols.join('\t'), ...pts.map(([t, q], i) => `${clock(25200 + t + 30)}\t${cols.map(c => (/온도/.test(c) ? 1500 + q / 100 : /누적/.test(c) ? 1000 + i * 50 : /%/.test(c) ? 60 : q)).join('\t')}`)].join('\n') }];
  for (const cols of [['가스온도(℃)', '회수유량(Nm3/h)'], ['누적회수량(Nm3)', '회수유량(Nm3/h)'], ['가스회수율(%)', 'FT-301 (Nm3/h)']]) {
    const src = mk(cols).map(B.readSource);
    assert.equal(B.guess(src).valCol, cols[1], cols.join(','));
  }
});

test('파일마다 시간 칸 이름이 달라도 시간을 찾아 쓰고 알린다', () => {
  const pts = pulse();
  const srcs = [0, 1].map(k => ({ name: `${k}.csv`, text: [`${k ? 'Time' : '시각'}\t회수유량(Nm3/h)`, ...pts.map(([t, q]) => `${clock(25200 + k * 3600 + t + 30)}\t${q}`)].join('\n') }));
  const { res } = run(srcs);
  near(res.heats[1].sum.total, res.heats[0].sum.total, 0.05, '두 파일 총량');
  assert.ok(res.warnings.some(w => w.includes('Time')));
});

test('최신순(내림차순) 기록이 자정을 넘어도 24시간짜리 배치가 되지 않는다', () => {
  const pts = pulse();
  const text = ['시각\t회수유량(Nm3/h)', ...pts.map(([t, q]) => `${clock(86400 - 300 + t)}\t${q}`).reverse()].join('\n');
  const { res } = run([{ name: 'a.csv', text }, { name: 'b.csv', text }].map((s, i) => ({ ...s, text: i ? s.text.replace(/\d+\.?\d*$/gm, v => String(+v * 1.01)) : s.text })));
  assert.ok(res.heats.every(h => h.sum.duration < 700), res.heats.map(h => h.sum.duration).join(','));
});

test('걸린 시간이 대부분 같아도(MAD = 0) 혼자 짧은 배치를 찾는다', () => {
  const z = B.robustZ([780, 780, 780, 780, 780, 780, 780, 300]);
  assert.ok(z[7] < -3 && z.slice(0, 7).every(v => v === 0));
});

test('초 없는 시각(HH:MM)은 같은 시각 줄을 고르게 나눠 계산하고 알린다', () => {
  const pts = pulse();
  const hhmm = s => clock(s).slice(0, 5);
  const srcs = [0, 1, 2].map(k => ({ name: `${k}.csv`, text: ['시각\t회수유량(Nm3/h)', ...pts.map(([t, q]) => `${hhmm(25200 + k * 3600 + t + 30)}\t${q}`)].join('\n') }));
  const { res } = run(srcs);
  near(res.heats[0].sum.total, trap(pts), 0.03, '총량');
  assert.ok(res.heats.every(h => !h.flags.some(f => f.includes('빠짐'))));
  assert.ok(res.warnings.some(w => w.includes('초가 없어서')));
});

test('값이 모두 0인 배치·점이 너무 적은 배치는 이유를 알리고 뺀다', () => {
  const pts = pulse();
  const mk = (name, f) => ({ name, text: ['시각\t회수유량(Nm3/h)', ...pts.map(([t, q], i) => f(t, q, i)).filter(Boolean)].join('\n') });
  const { res } = run([mk('a.csv', (t, q) => `${clock(25200 + t + 30)}\t${q}`), mk('b.csv', (t, q) => `${clock(28800 + t + 30)}\t${q * 1.02}`),
    mk('zero.csv', t => `${clock(32400 + t + 30)}\t0`), mk('two.csv', (t, q, i) => (i < 2 ? `${clock(36000 + t + 30)}\t${q}` : `${clock(36000 + t + 30)}\tBad`))]);
  assert.equal(res.heats.length, 2);
  assert.ok(res.warnings.some(w => w.startsWith('zero') && w.includes('0')));
  assert.ok(res.warnings.some(w => w.startsWith('two') && w.includes('2개')));
});

test('한 점만 튀는 값은 고치고 표시한다 (작업 구간·총량이 흔들리지 않게)', () => {
  const pts = pulse();
  const spiked = pts.map(([t, q], i) => [t, i === 40 ? q * 10 : q]);
  const mk = (p, k) => ({ name: `${k}.csv`, text: ['시각\t회수유량(Nm3/h)', ...p.map(([t, q]) => `${clock(25200 + k * 3600 + t + 30)}\t${q}`)].join('\n') });
  const { res } = run([mk(pts, 0), mk(spiked, 1)]);
  near(res.heats[1].sum.total, res.heats[0].sum.total, 0.01, '총량');
  assert.ok(res.heats[1].notes.some(n => n.includes('튀는 값')));
});

test('넓은 표: 번호(No) 칸은 배치가 아니고, "1차"·"#2" 같은 이름도 배치로 본다', () => {
  const pts = pulse();
  const text = ['No\t경과(초)\t1차\t2차\t#3', ...pts.map(([t, q], i) => `${i + 1}\t${t + 30}\t${q}\t${q * 1.01}\t${q * 0.99}`)].join('\n');
  const { cfg, res } = run([{ name: 'w.csv', text }]);
  assert.equal(cfg.shape, 'wide');
  assert.deepEqual(res.heats.map(h => h.id), ['1차', '2차', '#3']);
});

test('긴 표: 대기 표시("-", 띄엄띄엄 나오는 "0")는 빼고, 첫 줄에만 있는 번호는 아래로 채운다', () => {
  const pts = pulse();
  const lines = ['배치\t시각\t유량(Nm3/h)'];
  [101, 102, 103].forEach((id, k) => {
    for (let i = 0; i < 5; i++) lines.push(`0\t${clock(25000 + k * 3600 + i * 60)}\t200`);
    pts.forEach(([t, q], i) => lines.push(`${i === 0 ? id : ''}\t${clock(25200 + k * 3600 + t + 30)}\t${q}`));
    lines.push(`-\t${clock(25200 + k * 3600 + 1000)}\t100`);
  });
  for (let i = 0; i < 5; i++) lines.push(`0\t${clock(40000 + i * 60)}\t200`);
  const g = B.groupIds(lines.slice(1).map(l => l.split('\t')[0]));
  assert.deepEqual(g.groups.map(x => x.id), ['101', '102', '103']);
  assert.ok(g.ffill);
});

test('하루 단위 파일 경계에 걸친 연속 기록도 한 배치로 합친다', () => {
  const lines = [];
  for (let k = 0; k < 4; k++) pulse().forEach(([t, q]) => lines.push([Date.UTC(2026, 9, 1, 21) / 1000 + k * 3600 + t, q]));
  const fmtD = s => new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const day1 = lines.filter(([s]) => fmtD(s) < '2026-10-01 23:35'), day2 = lines.filter(([s]) => fmtD(s) >= '2026-10-01 23:35');
  const mk = (name, L) => ({ name, text: ['시각\t회수유량(Nm3/h)', ...L.map(([s, q]) => `${fmtD(s)}\t${q}`)].join('\n') });
  const { cfg, res } = run([mk('d1.csv', day1), mk('d2.csv', day2)], { shape: 'continuous' });
  assert.equal(cfg.shape, 'continuous');
  assert.equal(res.heats.length, 4);
});

test('3분 간격 연속 기록도 작업 구간을 나눈다', () => {
  const lines = ['시각\t전력(kW)'];
  for (let k = 0; k < 6; k++) for (let m = 0; m < 30; m++) lines.push(`${clock(3600 * 6 + k * 3 * 3600 + m * 180)}\t${m >= 5 && m <= 25 ? 800 + rnd() * 50 : 2}`);
  const { cfg, res } = run([{ name: 'log.csv', text: lines.join('\n') }]);
  assert.equal(cfg.shape, 'continuous');
  assert.equal(res.heats.length, 6);
  assert.equal(B.amountUnitOf('전력(kW)'), 'kWh');
});

test('파일 이름 1..12는 숫자 순서로, 음수 방향 표기는 부호를 바꾼다', () => {
  const srcs = Array.from({ length: 12 }, (_, k) => ({ name: `${12 - k}.csv`, text: ['시각\t회수유량(Nm3/h)', ...pulse({ peak: 90000 - (12 - k) * 2000 }).map(([t, q]) => `${clock(25200 + t + 30)}\t${-q}`)].join('\n') }));
  const { res } = run(srcs);
  assert.deepEqual(res.heats.map(h => h.id), Array.from({ length: 12 }, (_, k) => String(k + 1)));
  assert.ok(res.heats.every(h => h.sum.total > 0));
  assert.ok(res.warnings.some(w => w.includes('부호')));
  assert.ok(res.trend && res.trend.params[1] < 0);
});

test('같은 파일을 두 번 넣으면 한 번만 센다', () => {
  const { res } = run([...demo.sources, demo.sources[0]]);
  assert.equal(res.heats.length, 12);
  assert.ok(res.warnings.some(w => w.includes('똑같')));
});

test('중간 예측의 "오차 줄어듦"은 같은 배치들의 표준편차와 검증 오차로 비교', () => {
  base.early.forEach(e => { assert.ok(Math.abs(e.sdY - Regression.sd(e.y)) < 1e-9); assert.ok(e.gain <= 1 - e.err / e.sdY + 1e-12); });
});

test('배치 정보: 열이 배치보다 많아도, 이름에 번호가 섞여 있어도, 원단위는 생산량 칸으로', () => {
  const head = ['강번', '출강온도(℃)', '산소취입량(Nm3)', '출강량(t)', ...Array.from({ length: 15 }, (_, i) => `성분${i + 1}`)];
  const rows = base.heats.map((h, i) => [h.id, 1650 + i, 12000 + i * 100, 250 + i, ...Array.from({ length: 15 }, () => (rnd() + 1).toFixed(3))]);
  const f = B.factors(base, [head, ...rows].map(r => r.join('\t')).join('\n'));
  assert.equal(f.matched, 12);
  assert.equal(f.perName, '출강량(t)');
  const f2 = B.factors(base, [head, ...rows].map(r => r.join('\t')).join('\n'), { per: '' });
  assert.equal(f2.intensity, null);
  // 시트 이름이 섞인 배치 이름 "파일 · D24101" 도 토막으로 짝짓되, 한 줄을 여러 배치가 나눠 갖지 않는다
  const res2 = { ...base, heats: base.heats.map(h => ({ ...h, id: `로그 · ${h.id}` })) };
  assert.equal(B.factors(res2, demo.attrs).matched, 12);
  const res3 = { ...base, heats: base.heats.map(h => ({ ...h, id: '공통 1' })) };
  const f3 = B.factors(res3, '번호\t값\n1\t5\n2\t6\n3\t7\n4\t8');
  assert.ok(f3.error || f3.matched <= 1);
});

test('측정값(온도) 배치: 자르지 않고 최고 온도를 비교, 조건과의 관계를 찾는다', () => {
  const d = B.demoReactor();
  const src = d.sources.map(B.readSource);
  const cfg = { ...B.guess(src), ...d.cfg };
  assert.equal(cfg.shape, 'long');
  assert.equal(cfg.kind, 'level');
  assert.equal(cfg.timeUnit, 'min');
  const res = B.analyze(src, cfg);
  assert.equal(res.heats.length, 10);
  assert.ok(res.heats.every(h => h.sum.value > 100 && h.sum.value < 160 && Number.isNaN(h.sum.total)));
  const f = B.factors(res, d.attrs);
  assert.equal(f.matched, 10);
  assert.equal(f.rel[0].name, '가열출력(%)');
  assert.equal(f.perName, '원료량(kg)');
});

console.log(`\n${pass}개 모두 통과`);
