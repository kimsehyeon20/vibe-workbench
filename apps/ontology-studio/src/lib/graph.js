// 그래프 계산: 색인, 추론, 이웃, 최단 경로, 묶음(커뮤니티)
import { relKey } from './model.js';

export function buildIndex(project, relations = project.relations) {
  const entity = new Map(project.entities.map(e => [e.id, e]));
  const cls = new Map(project.classes.map(c => [c.id, c]));
  const type = new Map(project.relTypes.map(t => [t.id, t]));
  const out = new Map(), inc = new Map();
  for (const e of project.entities) { out.set(e.id, []); inc.set(e.id, []); }
  for (const r of relations) {
    if (!entity.has(r.from) || !entity.has(r.to)) continue;
    out.get(r.from).push(r);
    inc.get(r.to).push(r);
  }
  const degree = id => (out.get(id)?.length || 0) + (inc.get(id)?.length || 0);
  return { project, relations, entity, cls, type, out, inc, degree };
}

// ── 온톨로지 추론: 관계 종류에 붙인 성질(대칭·전이·역관계)로 숨은 관계를 계산한다 ──
// 저장하지 않고 그때그때 계산하므로 원본 데이터는 그대로다. 결과에는 inferred: true 표시.
export function inferRelations(project, limit = 5000) {
  const have = new Set(project.relations.map(r => r.id));
  const out = [];
  const add = (from, typeId, to, why) => {
    if (from === to || out.length >= limit) return false;
    const id = relKey(from, typeId, to);
    if (have.has(id)) return false;
    have.add(id);
    out.push({ id, typeId, from, to, inferred: true, why });
    return true;
  };
  const byType = new Map();
  for (const r of project.relations) {
    if (!byType.has(r.typeId)) byType.set(r.typeId, []);
    byType.get(r.typeId).push(r);
  }
  for (const t of project.relTypes) {
    const rs = byType.get(t.id) || [];
    if (t.inverseOf) for (const r of rs) add(r.to, t.inverseOf, r.from, `'${t.name}'의 역관계`);
    if (t.symmetric) for (const r of rs) add(r.to, t.id, r.from, `'${t.name}'은 대칭`);
  }
  // 전이: A→B, B→C 이면 A→C (예: 상위분류, 선행, 포함)
  for (const t of project.relTypes) {
    if (!t.transitive) continue;
    const next = new Map();
    for (const r of [...(byType.get(t.id) || []), ...out.filter(r => r.typeId === t.id)]) {
      if (!next.has(r.from)) next.set(r.from, new Set());
      next.get(r.from).add(r.to);
    }
    for (const start of next.keys()) {
      const seen = new Set([start]), queue = [...next.get(start)];
      let depth = 0;
      while (queue.length && depth++ < 2000) {
        const cur = queue.shift();
        if (seen.has(cur)) continue;
        seen.add(cur);
        if (!next.get(start).has(cur)) add(start, t.id, cur, `'${t.name}'은 전이`);
        for (const n of next.get(cur) || []) if (!seen.has(n)) queue.push(n);
      }
    }
  }
  return out;
}

// 선택한 노드에서 k 단계 안의 노드들(방향 무시)
export function neighborhood(index, seeds, k = 1) {
  const seen = new Set(seeds);
  let frontier = [...seeds];
  for (let d = 0; d < k; d++) {
    const nextF = [];
    for (const id of frontier) {
      for (const r of index.out.get(id) || []) if (!seen.has(r.to)) { seen.add(r.to); nextF.push(r.to); }
      for (const r of index.inc.get(id) || []) if (!seen.has(r.from)) { seen.add(r.from); nextF.push(r.from); }
    }
    frontier = nextF;
  }
  return seen;
}

// 두 노드 사이 최단 경로(방향 무시 BFS). allow 로 지나갈 수 있는 관계를 제한한다(숨긴 관계 피하기).
// 반환: [{ id, via: relation, forward }]
export function shortestPath(index, a, b, allow = () => true) {
  if (a === b) return [{ id: a }];
  const prev = new Map([[a, null]]);
  const queue = [a];
  while (queue.length) {
    const cur = queue.shift();
    const steps = [...(index.out.get(cur) || []).filter(allow).map(r => [r.to, r, true]), ...(index.inc.get(cur) || []).filter(allow).map(r => [r.from, r, false])];
    for (const [n, r, fwd] of steps) {
      if (prev.has(n)) continue;
      prev.set(n, { from: cur, r, fwd });
      if (n === b) {
        const path = [];
        let x = b;
        while (x !== a) { const p = prev.get(x); path.unshift({ id: x, via: p.r, forward: p.fwd }); x = p.from; }
        path.unshift({ id: a });
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

// 서로 촘촘히 연결된 무리 찾기(라벨 전파). AI 내보내기에서 관련된 것끼리 모아 쓰는 데 쓴다.
export function communities(index, rounds = 12) {
  const ids = [...index.entity.keys()];
  const label = new Map(ids.map((id, i) => [id, i]));
  const order = ids.slice().sort((x, y) => index.degree(y) - index.degree(x));
  for (let it = 0; it < rounds; it++) {
    let changed = 0;
    for (const id of order) {
      const counts = new Map();
      for (const r of index.out.get(id) || []) counts.set(label.get(r.to), (counts.get(label.get(r.to)) || 0) + 1);
      for (const r of index.inc.get(id) || []) counts.set(label.get(r.from), (counts.get(label.get(r.from)) || 0) + 1);
      if (!counts.size) continue;
      let best = label.get(id), bestN = -1;
      for (const [l, n] of counts) if (n > bestN || (n === bestN && l < best)) { best = l; bestN = n; }
      if (best !== label.get(id)) { label.set(id, best); changed++; }
    }
    if (!changed) break;
  }
  // 큰 무리부터 0,1,2... 번호를 다시 매긴다
  const size = new Map();
  for (const l of label.values()) size.set(l, (size.get(l) || 0) + 1);
  const rank = new Map([...size.entries()].sort((a, b) => b[1] - a[1]).map(([l], i) => [l, i]));
  return new Map([...label.entries()].map(([id, l]) => [id, rank.get(l)]));
}

// 관계 종류별로 실제 쓰인 (출발 클래스 → 도착 클래스) 조합과 횟수
export function typeUsage(index) {
  const usage = new Map();
  for (const r of index.relations) {
    const a = index.entity.get(r.from), b = index.entity.get(r.to);
    if (!a || !b) continue;
    if (!usage.has(r.typeId)) usage.set(r.typeId, new Map());
    const k = `${a.classId}>${b.classId}`;
    const m = usage.get(r.typeId);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return usage;
}

// 클래스별 속성 키와 채워진 비율
export function classProps(project) {
  const out = new Map();
  const count = new Map();
  for (const e of project.entities) {
    count.set(e.classId, (count.get(e.classId) || 0) + 1);
    if (!out.has(e.classId)) out.set(e.classId, new Map());
    const m = out.get(e.classId);
    for (const [k, v] of Object.entries(e.props || {})) if (v !== '' && v != null) {
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(String(v));
    }
  }
  return { props: out, count };
}
