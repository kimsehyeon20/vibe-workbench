// 품질 검사: AI 가 헷갈리지 않도록 정리할 거리를 찾는다
import { norm } from './model.js';
import { typeUsage } from './graph.js';

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
  return out;
}
function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

// 같은 것을 가리키는 것 같은 엔티티 묶음
export function duplicateGroups(project, max = 60) {
  const groups = [];
  const byNorm = new Map();
  for (const e of project.entities) {
    const n = norm(e.label.replace(/^#/, ''));
    if (!n) continue;
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(e);
  }
  const used = new Set();
  for (const list of byNorm.values()) if (list.length > 1) { groups.push({ kind: 'same', items: list }); list.forEach(e => used.add(e.id)); }
  // 비슷한 이름(오타·띄어쓰기 차이): 같은 클래스 안에서만, 너무 많으면 생략
  const byClass = new Map();
  for (const e of project.entities) if (!used.has(e.id)) {
    if (!byClass.has(e.classId)) byClass.set(e.classId, []);
    byClass.get(e.classId).push(e);
  }
  for (const list of byClass.values()) {
    if (list.length > 1500) continue;
    const ns = list.map(e => norm(e.label));
    for (let i = 0; i < list.length && groups.length < max; i++) {
      if (ns[i].length < 4 || used.has(list[i].id)) continue;
      const g = [list[i]];
      for (let j = i + 1; j < list.length; j++) {
        if (used.has(list[j].id) || Math.abs(ns[i].length - ns[j].length) > 3) continue;
        if (dice(ns[i], ns[j]) >= 0.85) g.push(list[j]);
      }
      if (g.length > 1) { groups.push({ kind: 'similar', items: g }); g.forEach(e => used.add(e.id)); }
    }
  }
  return groups.slice(0, max);
}

export function checkQuality(project, index) {
  const issues = [];
  const cls = index.cls;
  const dups = duplicateGroups(project);
  if (dups.length) issues.push({ id: 'dup', level: 'warn', title: `중복 같아 보이는 엔티티 ${dups.length}묶음`, detail: '같은 대상이 여러 노드로 나뉘면 AI 가 다른 것으로 이해해요. 합치면 연결도 함께 옮겨져요.', groups: dups });

  const orphans = project.entities.filter(e => index.degree(e.id) === 0);
  if (orphans.length) issues.push({ id: 'orphan', level: 'info', title: `연결이 하나도 없는 엔티티 ${orphans.length}개`, detail: '다른 것과 이어지지 않은 정보는 그래프에서 활용도가 낮아요.', entities: orphans.slice(0, 50) });

  const stubs = project.entities.filter(e => e.stub);
  if (stubs.length) issues.push({ id: 'stub', level: 'info', title: `이름만 있고 내용이 없는 엔티티 ${stubs.length}개`, detail: '다른 데이터가 가리켰지만 원본이 없어 자동으로 만든 노드예요. 원본 파일을 더 넣으면 채워져요.', entities: stubs.slice(0, 50) });

  // 정의역/치역(도메인/레인지) 위반: 관계 종류에 정한 출발·도착 클래스와 다른 연결
  const usage = typeUsage(index);
  for (const t of project.relTypes) {
    const u = usage.get(t.id);
    if (!u) continue;
    if (t.domain || t.range) {
      let bad = 0;
      for (const [k, n] of u) {
        const [a, b] = k.split('>');
        if ((t.domain && a !== t.domain) || (t.range && b !== t.range)) bad += n;
      }
      if (bad) issues.push({ id: `dr-${t.id}`, level: 'warn', title: `'${t.name}' 규칙과 다른 연결 ${bad}개`, detail: `규칙: ${cls.get(t.domain)?.name || '아무거나'} → ${cls.get(t.range)?.name || '아무거나'}` });
    } else if (u.size > 2) {
      issues.push({ id: `mix-${t.id}`, level: 'info', title: `'${t.name}' 관계가 ${u.size}가지 클래스 조합에 쓰임`, detail: '의미가 섞였을 수 있어요. 관계를 나누거나 구조 탭에서 출발·도착 규칙을 정해 보세요.' });
    }
  }

  const noDescC = project.classes.filter(c => !c.description).length;
  const noDescR = project.relTypes.filter(t => !t.description).length;
  if (noDescC + noDescR) issues.push({ id: 'desc', level: 'tip', title: `설명이 없는 클래스 ${noDescC}개 · 관계 ${noDescR}개`, detail: '짧은 정의를 적어 두면 AI 내보내기에 함께 들어가 AI 가 의미를 정확히 이해해요.' });
  return issues;
}
