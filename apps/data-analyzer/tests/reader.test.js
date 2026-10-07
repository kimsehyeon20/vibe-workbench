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

console.log(`\n${pass}개 모두 통과`);
