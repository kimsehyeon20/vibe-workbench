// 표 읽기 검사. 실행: node apps/data-analyzer/tests/reader.test.js
'use strict';
const assert = require('node:assert/strict');
const R = require('../reader.js');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('✓', name); };
const read = (text, layout) => {
  const prep = R.prepareGrid(R.parseText(text), layout);
  return { prep, tb: R.buildTable(prep.rows) };
};

test('세로 표 (탭)', () => {
  const { prep, tb } = read('시각\t온도\t전력\n09:00\t20\t3\n09:10\t21\t3.2\n09:20\t22\t3.5');
  assert.equal(prep.layout, 'cols');
  assert.deepEqual(tb.headers, ['시각', '온도', '전력']);
  assert.deepEqual(tb.kinds, ['time', 'number', 'number']);
});

test('가로 표 (항목이 행) 자동 판별', () => {
  const { prep, tb } = read('시간\t0\t1\t2\t3\n전압\t10\t12\t14\t16\n전류\t1\t1.1\t1.3\t1.4');
  assert.equal(prep.layout, 'rows');
  assert.deepEqual(tb.headers, ['시간', '전압', '전류']);
  assert.equal(tb.body.length, 4);
  assert.equal(R.guessTimeCol(tb), 0);
});

test('가로 표 + 제목 줄 + 단위 칸 + 아래 메모', () => {
  const text = ['3호기 측정 결과', '', '시각\t\t09:00\t09:10\t09:20\t09:30', '온도\t°C\t20\t20.5\t21\t21.6', '전력\tkW\t3\t3.1\t3.3\t3.4', '※ 10분 간격'].join('\n');
  const { prep, tb } = read(text);
  assert.equal(prep.layout, 'rows');
  assert.deepEqual(tb.headers, ['시각', '온도 (°C)', '전력 (kW)']);
  assert.equal(tb.body.length, 4);
});

test('세로 표 + 두 줄 머리글(병합) + 빈 열', () => {
  const text = ['측정 데이터', '시각\t온도\t온도\t\t전력', '\t외기\t실내\t\tkW', '09:00\t30\t25\t\t3', '09:10\t31\t24\t\t3.2', '09:20\t32\t23.5\t\t3.1'].join('\n');
  const { prep, tb } = read(text);
  assert.equal(prep.layout, 'cols');
  assert.deepEqual(tb.headers, ['시각', '온도 외기', '온도 실내', '전력 (kW)']);
});

test('방향 직접 지정', () => {
  const { tb } = read('시간\t0\t1\t2\t3\n전압\t10\t12\t14\t16', 'cols');
  assert.equal(tb.headers.length, 5);
});

test('CSV 따옴표·천 단위 쉼표·이름 없는 표', () => {
  const { tb } = read('t,"값"\n1,"1,200"\n2,"1,300"\n3,1400');
  assert.equal(R.toNumber(tb.cols[1][0]), 1200);
  const n = read('1\t5\n2\t7\n3\t9');
  assert.equal(n.tb.hasHeader, false);
});

test('시각 해석: 오전/오후, 자정 넘김, 날짜', () => {
  assert.equal(R.parseTimeCell('오후 1:30').v, 13.5 * 3600);
  assert.equal(R.parseTimeCell('2026-10-01 23:30').kind, 'date');
  const { tb } = read('시각\t값\n23:50\t1\n00:00\t2\n00:10\t3\n00:20\t4');
  const ds = R.buildDataset(tb, { timeCol: 0, unit: 'auto', vars: [1] });
  assert.deepEqual(ds.t, [0, 10, 20, 30]);
});

const ds = (text, extra = {}) => {
  const { prep, tb } = read(text);
  const tc = R.guessTimeCol(tb);
  const vars = tb.kinds.map((k, i) => (k === 'number' && i !== tc ? i : -1)).filter(i => i >= 0);
  return { prep, tb, tc, d: R.buildDataset(tb, { timeCol: tc, unit: 'auto', vars, ...extra }) };
};

test('따옴표 안 줄바꿈(엑셀 Alt+Enter) 이름', () => {
  const { tb } = read('시각,"온도\n(°C)",유량\n09:00,20.1,1200\n09:10,20.4,1250\n09:20,20.9,1310');
  assert.deepEqual(tb.headers, ['시각', '온도 (°C)', '유량']);
  assert.deepEqual(tb.cols[1].map(R.toNumber), [20.1, 20.4, 20.9]);
});

test('세미콜론 CSV의 소수점 쉼표 (제목 줄이 있어도)', () => {
  const { tb, prep } = read('Messwerte Anlage 3\nZeit;Druck;Temp\n09:00;4,950;20,5\n09:10;4,975;20,8\n09:20;5,012;21,1');
  assert.deepEqual(tb.headers, ['Zeit', 'Druck', 'Temp']);
  assert.deepEqual(tb.cols[1].map(R.toNumber), [4.95, 4.975, 5.012]);
  assert.ok(prep.notes.some(n => n.includes('소수점')));
  // 탭 표의 천 단위 쉼표는 그대로 천 단위
  assert.deepEqual(read('시각\t유량\n09:00\t12,500\n09:10\t13,000').tb.cols[1].map(R.toNumber), [12500, 13000]);
});

test('일자 칸 + 시각 칸 → 하나의 시각 (자정 넘김 포함)', () => {
  const { tb, d } = ds('일자,시간,유량\n2026-10-07,23:30,1\n2026-10-07,23:45,2\n2026-10-08,00:00,3\n2026-10-08,00:15,4');
  assert.equal(tb.headers[0], '일자 시간');
  assert.deepEqual(d.t, [0, 15, 30, 45]);
});

test('여러 시각 형식', () => {
  const iso = s => new Date(R.parseTimeCell(s).v).toISOString().slice(0, 19);
  assert.equal(iso('20261007093000'), '2026-10-07T09:30:00');
  assert.equal(iso('2026-10-07T09:00:00+09:00'), '2026-10-07T00:00:00');
  assert.equal(iso('07-Oct-26 09:00:00'), '2026-10-07T09:00:00');
  assert.equal(iso('10/7/2026 9:00:00 PM'), '2026-10-07T21:00:00');
  assert.equal(iso('2026. 10. 7. 오후 1:05:00'), '2026-10-07T13:05:00');
  assert.equal(iso('2026년 10월 7일 9시 30분'), '2026-10-07T09:30:00');
  for (const bad of ['09:75', '25:00', '2026-02-30 10:00', '2026-13-01']) assert.equal(R.parseTimeCell(bad), null, bad);
});

test('최신 → 과거 순서, 이틀치 시각만 있는 기록', () => {
  assert.deepEqual(ds('시각\t값\n00:20\t5\n00:10\t4\n00:00\t3\n23:50\t2\n23:40\t1').d.t, [0, 10, 20, 30, 40]);
  const two = R.timeSeconds(['08:00', '12:00', '16:00', '20:00', '09:00', '13:00']).sec.map(s => s / 3600);
  assert.deepEqual(two, [8, 12, 16, 20, 33, 37]);
});

test('태그마다 시각 칸이 따로 있는 표(PI): 기준 시각에 보간', () => {
  const { tb, d } = ds('FIC101\t\tTI102\t\nTimestamp\tValue\tTimestamp\tValue\n09:00\t1\t09:00\t10\n09:10\t2\t09:20\t30\n09:20\t3\t09:40\t50');
  assert.deepEqual(tb.headers, ['FIC101 Timestamp', 'FIC101 Value', 'TI102 Timestamp', 'TI102 Value']);
  assert.deepEqual(d.vars[1].values, [10, 20, 30]);
});

test('요약 줄·제목 줄·매개변수 줄', () => {
  const r = read('강번\t출강량\n A1\t250\nA2\t248\nA3\t252\n평균\t250\n합계\t750');
  assert.equal(r.tb.body.length, 3);
  const p = read('Start Time\t2026-10-07 00:00\tEnd Time\t2026-10-07 01:00\n\nTimestamp\tFIC101\tTI102\n2026-10-07 00:00\t1\t2\n2026-10-07 00:10\t1\t2\n2026-10-07 00:20\t1\t2');
  assert.deepEqual(p.tb.headers, ['Timestamp', 'FIC101', 'TI102']);
});

test('불량 표시(Bad, I/O Timeout, -)는 빈 값, 첫 줄이 상태 글자여도 이름 줄로 오해하지 않음', () => {
  const { tb } = read('시각\tFIC101\tAI201\n09:00\tShutdown\tShutdown\n09:10\t1\tI/O Timeout\n09:20\t2\tI/O Timeout\n09:30\t3\t4\n09:40\t4\t5');
  assert.deepEqual(tb.headers, ['시각', 'FIC101', 'AI201']);
  assert.equal(tb.body.length, 5);
  assert.deepEqual(tb.kinds, ['time', 'number', 'number']);
  assert.equal(tb.quality[2].bad, 3);
});

test('칸 안 단위·괄호 음수, 이상한 글자는 숫자가 아님', () => {
  assert.equal(R.toNumber('12.3℃'), 12.3);
  assert.equal(R.toNumber('45 kW'), 45);
  assert.equal(R.toNumber('(12.5)'), -12.5);
  for (const x of ['0x1A', '1.5e', '3호기', 'A24101', '1,2,3']) assert.ok(Number.isNaN(R.toNumber(x)), x);
  assert.equal(read('시각\t온도\n09:00\t1650.5℃\n09:10\t1651℃\n09:20\t1652℃').tb.headers[1], '온도 (℃)');
});

test('공백으로 나뉜 붙여넣기에서 이름 칸 수가 안 맞으면 이름을 쓰지 않음', () => {
  const r = read('시각 BFG 유량 홀더 레벨\n09:00 150000 55\n09:10 151000 56\n09:20 152000 57');
  assert.equal(r.tb.hasHeader, false);
  assert.ok(r.prep.notes.some(n => n.includes('칸 수')));
});

test('이름 중복 없애기, 시간 칸 이름 판별, 칸마다 크기가 다른 방향은 피함', () => {
  assert.deepEqual(read('시각\t온도\t온도\t온도 (2)\n09:00\t1\t2\t3\n09:10\t1\t2\t3').tb.headers, ['시각', '온도', '온도 (2)', '온도 (2) (2)']);
  for (const h of ['시각', '일시', 'Timestamp', '경과시간(분)', 'Time (s)']) assert.ok(R.isTimeName(h), h);
  for (const h of ['시간당 유량', '처리시간(분)', 'Tap-to-tap time', '누적 가동시간(h)']) assert.ok(!R.isTimeName(h), h);
  const four = read('강번\t출강량(t)\t출강온도(℃)\t산소량(Nm3)\t회수량(Nm3)\t처리시간(분)\nA1\t250\t1650\t12500\t21000\t38\nA2\t248\t1645\t12300\t20500\t37\nA3\t252\t1660\t12800\t21600\t39\nA4\t249\t1655\t12600\t21200\t38');
  assert.equal(four.prep.layout, 'cols');
});

test('엑셀 일련번호 시각 칸', () => {
  const { tb, d } = ds('Timestamp\t값\n45937.375\t1\n45937.38194444445\t2\n45937.38888888889\t3');
  assert.equal(tb.kinds[0], 'time');
  assert.deepEqual(d.t.map(x => Math.round(x)), [0, 10, 20]);
});

test('큰 표(13만 줄)도 터지지 않음', () => {
  const lines = ['시각\t값']; for (let i = 0; i < 130000; i++) lines.push(`${String(Math.floor(i / 3600) % 24).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}\t${i}`);
  const { d } = ds(lines.join('\n'));
  assert.equal(d.t.length, 130000);
});

console.log(`\n${pass}개 모두 통과`);
