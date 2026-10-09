import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parseEntries, parseText } from '../src/lib/parse/index.js';
import { proposeMappings, buildFragment } from '../src/lib/infer.js';
import { emptyProject, mergeInto, ops, projectToFragment } from '../src/lib/model.js';
import { buildIndex, inferRelations, shortestPath, communities } from '../src/lib/graph.js';
import { checkQuality } from '../src/lib/quality.js';
import { makeView, render, FORMATS } from '../src/lib/export.js';
import { parseAiAnswer, extractionPrompt } from '../src/lib/prompts.js';
import { sampleEntries } from '../src/lib/sample.js';
import { parseXlsx } from '../src/lib/parse/table.js';

function importAll(project, res) {
  let p = project;
  const maps = proposeMappings(res.tables, p);
  if (res.tables.length) p = mergeInto(p, buildFragment(res.tables, maps, p)).project;
  for (const f of res.fragments) p = mergeInto(p, f.fragment, { matchByLabel: f.matchByLabel }).project;
  return { p, maps };
}

test('예시 데이터: 자동 형식화', () => {
  const res = parseEntries(sampleEntries());
  assert.equal(res.tables.length, 4);
  assert.equal(res.docs.length, 2);
  const { p, maps } = importAll(emptyProject(), res);
  const byName = n => maps.find(m => m.className === n);
  const person = byName('사람');
  assert.equal(person.idCol, 'id');
  assert.equal(person.labelCol, '이름');
  assert.equal(person.cols['팀_id'].role, 'link');
  assert.equal(person.cols['매니저_id'].role, 'link');
  assert.equal(person.cols['직급'].role, 'link');
  assert.equal(person.cols['기술'].role, 'link');
  assert.equal(person.cols['입사일'].datatype, 'date');
  const proj = byName('프로젝트');
  assert.equal(proj.cols['선행'].role, 'link');
  assert.equal(proj.cols['담당팀_id'].role, 'link');
  const join = byName('참여');
  assert.equal(join.mode, 'edges', '참여.csv 는 연결표');
  assert.equal(join.cols['역할'].role, 'attr');

  const cls = p.classes.map(c => c.name);
  for (const n of ['사람', '팀', '프로젝트', '직급', '기술', '문서', '태그']) assert.ok(cls.includes(n), n);
  assert.ok(!cls.includes('참여'));
  const rt = p.relTypes.map(t => t.name);
  for (const n of ['팀', '매니저', '직급', '기술', '담당팀', '선행', '참여', '링크', '태그', '프로젝트']) assert.ok(rt.includes(n), n);
  const idx = buildIndex(p);
  const kim = p.entities.find(e => e.label === '김하늘');
  assert.equal(kim.props['입사일'], '2019-03-04');
  // 위키링크가 표에서 온 엔티티와 이어졌는지
  const meeting = p.entities.find(e => e.label === '2026-09 검색 개편 킥오프');
  const targets = idx.out.get(meeting.id).map(r => idx.entity.get(r.to).label);
  for (const n of ['검색 개편', '최지우', '플랫폼팀', '추천 모델 v2', '기술 스택 정리']) assert.ok(targets.includes(n), n);
  const goLinks = idx.inc.get(p.entities.find(e => e.label === 'Go' && idx.cls.get(e.classId).name === '기술').id);
  assert.ok(goLinks.length >= 3);
  // 참여 관계 속성
  const part = p.relations.find(r => idx.type.get(r.typeId).name === '참여' && r.props?.역할 === '분석');
  assert.ok(part);
  console.log('엔티티', p.entities.length, '관계', p.relations.length, 'stub', p.entities.filter(e => e.stub).map(e => e.label));
  globalThis.__p = p;
});

test('추론·경로·커뮤니티·품질', () => {
  let p = globalThis.__p;
  const t = p.relTypes.find(x => x.name === '선행');
  p = ops.updateRelType(p, t.id, { transitive: true });
  const inf = inferRelations(p);
  assert.ok(inf.some(r => r.typeId === t.id), '전이 추론');
  const idx = buildIndex(p);
  const a = p.entities.find(e => e.label === '오수아'), b = p.entities.find(e => e.label === '정민준');
  const path = shortestPath(idx, a.id, b.id);
  assert.ok(path && path.length >= 3);
  const com = communities(idx);
  assert.equal(com.size, p.entities.length);
  const issues = checkQuality(p, idx);
  assert.ok(Array.isArray(issues));
});

test('내보내기 형식 전부', () => {
  const p = globalThis.__p;
  const view = makeView(p, { inferred: true });
  for (const f of FORMATS) {
    const out = render(f.id, view, { compact: f.id === 'md' ? false : undefined });
    assert.ok(out.length > 100, f.id);
  }
  JSON.parse(render('jsonld', view));
  const md = render('md', view, {});
  assert.match(md, /김하늘 \[사람-P01\]/);
  console.log(md.slice(0, 1500));
  const compact = render('md', view, { compact: true });
  console.log(compact.split('\n').slice(0, 12).join('\n'));
  console.log(render('ttl', view).split('\n').slice(10, 30).join('\n'));
});

test('JSON-LD 왕복 & 백업 합치기', async () => {
  const p = globalThis.__p;
  const view = makeView(p);
  const res = parseText(render('jsonld', view), 'rt');
  assert.equal(res.fragments.length, 1);
  const back = mergeInto(emptyProject(), res.fragments[0].fragment).project;
  assert.equal(back.entities.length, p.entities.length);
  assert.equal(back.relations.length, p.relations.length);
  const merged = mergeInto(p, projectToFragment(p)).project;
  assert.equal(merged.entities.length, p.entities.length);
  assert.equal(merged.relations.length, p.relations.length);
});

test('AI 답 붙여넣기', () => {
  const p = globalThis.__p;
  assert.match(extractionPrompt(p, '테스트'), /사람/);
  const ans = '좋아요!\n```json\n{"entities":[{"id":"a","class":"사람","label":"김하늘"},{"id":"b","class":"회사","label":"에이컴"}],"relations":[{"from":"a","type":"재직","to":"b"}]}\n```';
  const r = parseAiAnswer(ans);
  assert.ok(r.fragment);
  const out = mergeInto(p, r.fragment, { matchByLabel: true }).project;
  assert.equal(out.entities.filter(e => e.label === '김하늘').length, 1, '기존 김하늘과 합쳐짐');
  assert.ok(out.relTypes.some(t => t.name === '재직'));
});

test('편집: 합치기·승격·삭제', () => {
  let p = globalThis.__p;
  const people = p.entities.filter(e => p.classes.find(c => c.id === e.classId).name === '사람');
  const before = p.relations.length;
  p = ops.mergeEntities(p, people[0].id, [people[1].id]);
  assert.equal(p.entities.length, globalThis.__p.entities.length - 1);
  assert.ok(p.relations.length <= before);
  const team = p.classes.find(c => c.name === '프로젝트');
  p = ops.promoteProperty(p, team.id, '상태', '상태', '상태');
  assert.ok(p.classes.some(c => c.name === '상태'));
  assert.ok(p.entities.some(e => e.label === '진행중'));
  p = ops.deleteClass(p, team.id);
  assert.ok(!p.entities.some(e => e.classId === team.id));
});

test('일반 JSON 중첩 → 부모-자식 표', () => {
  const json = JSON.stringify({ orders: [{ id: 'o1', customer: 'kim', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }] }, { id: 'o2', customer: 'lee', items: [{ sku: 'A', qty: 5 }] }] });
  const res = parseText(json, 'shop');
  assert.equal(res.tables.length, 2);
  const { p } = importAll(emptyProject(), res);
  const idx = buildIndex(p);
  const o1 = p.entities.find(e => e.key === 'o1');
  assert.equal(idx.out.get(o1.id).filter(r => idx.type.get(r.typeId).name === 'items').length, 2);
});

test('ZIP + EUC-KR CSV + XLSX', () => {
  const euckr = new Uint8Array([0x69, 0x64, 0x2c, 0xc0, 0xcc, 0xb8, 0xa7, 0x0a, 0x31, 0x2c, 0xb1, 0xe8, 0x0a, 0x32, 0x2c, 0xc0, 0xcc, 0x0a]); // id,이름\n1,김\n2,이
  const sheet = '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" s="1"><v>45000</v></c></row><row r="3"><c r="A3"><v>2</v></c><c r="B3" t="inlineStr"><is><t>x&amp;y</t></is></c></row></sheetData></worksheet>';
  const xlsx = zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="목록" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8('<sst><si><t>번호</t></si><si><r><t>날</t></r><r><t>짜</t></r></si></sst>'),
    'xl/styles.xml': strToU8('<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
  const w = [];
  const tables = parseXlsx(xlsx, 'book', 'book.xlsx', w);
  assert.deepEqual(tables[0].columns, ['번호', '날짜']);
  assert.equal(tables[0].rows[0][1], '2023-03-15');
  assert.equal(tables[0].rows[1][1], 'x&y');
  const zip = zipSync({ 'a/people.csv': euckr, 'a/b.xlsx': xlsx, 'a/pic.png': new Uint8Array([1, 2, 3]), '__MACOSX/x': new Uint8Array([1]) });
  const res = parseEntries([{ name: 'data.zip', bytes: zip }]);
  assert.equal(res.tables.length, 2);
  assert.deepEqual(res.tables[0].columns, ['id', '이름']);
  assert.equal(res.tables[0].rows[0][1], '김');
  assert.equal(res.files.length, 1);
});
