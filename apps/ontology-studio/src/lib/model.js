// 데이터 모델과 변경 함수(모두 '새 객체'를 돌려주는 순수 함수)
//
// project = {
//   format, version, name, seq,
//   classes:   [{ id, name, color, description }]                         ← 개념(노드 종류)
//   relTypes:  [{ id, name, color, description, symmetric, transitive,     ← 관계 종류
//                 inverseOf, domain, range }]
//   entities:  [{ id, classId, key, label, props, src[], stub? }]           ← 실제 데이터(노드)
//   relations: [{ id, typeId, from, to, props?, src? }]                    ← 연결(엣지). id = from|type|to
//   sources:   [{ id, name, kind, at, counts }]                             ← 어디서 가져왔는지
// }
import { nextSlot } from './palette.js';

export const FORMAT = 'ontology-studio';

export function emptyProject(name = '내 온톨로지') {
  return { format: FORMAT, version: 1, name, seq: 0, classes: [], relTypes: [], entities: [], relations: [], sources: [], updatedAt: Date.now() };
}

// 비교용 정규화: 대소문자·공백·문장부호 무시
export const norm = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
// 사람이 읽을 수 있고 RDF/Cypher에서도 안전한 ID 조각
export const slug = s => String(s ?? '').normalize('NFKC').trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 48) || 'x';
export const relKey = (from, typeId, to) => `${from}|${typeId}|${to}`;

const ck = (classId, key) => classId + '\u0001' + key;

function uniqueId(base, taken) {
  let id = base, i = 2;
  while (taken.has(id)) id = `${base}_${i++}`;
  taken.add(id);
  return id;
}

function mergeProps(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (v !== '' && v != null) out[k] = v;
  return out;
}

const addSrc = (list = [], s) => (!s || list.includes(s) ? list : [...list, s].slice(-5));

// ─────────────────────────────────────────────────────────────
// 가져온 조각(fragment)을 프로젝트에 합치기
//
// frag = {
//   classes:   [{ name, description? }]
//   relTypes:  [{ name, description?, symmetric?, transitive? }]
//   entities:  [{ class, key, label, props, src, stub? }]
//   relations: [{ from: Ref, type, to: Ref, props?, src? }]
//   sources:   [{ name, kind }]
// }
// Ref = { class, key } | { id } | { label, class? }   ← label 은 전체에서 이름으로 찾아 연결(위키링크 등)
// opts.matchByLabel: 같은 클래스에 같은 이름이 있으면 같은 엔티티로 본다(AI 결과 붙여넣기용)
// ─────────────────────────────────────────────────────────────
export function mergeInto(project, frag, opts = {}) {
  const p = { ...project, classes: project.classes.slice(), relTypes: project.relTypes.slice(), entities: project.entities.slice(), relations: project.relations.slice(), sources: project.sources.slice() };
  const stats = { classes: 0, relTypes: 0, entitiesAdded: 0, entitiesUpdated: 0, relationsAdded: 0, stubs: 0 };

  const classByName = new Map(p.classes.map(c => [norm(c.name), c]));
  const ensureClass = (name, description) => {
    const label = String(name || '항목').trim() || '항목';
    let c = classByName.get(norm(label));
    if (!c) {
      c = { id: `c${++p.seq}`, name: label, color: nextSlot(p.classes), description: description || '' };
      p.classes.push(c); classByName.set(norm(label), c); stats.classes++;
    } else if (description && !c.description) {
      c = { ...c, description };
      p.classes[p.classes.findIndex(x => x.id === c.id)] = c; classByName.set(norm(label), c);
    }
    return c;
  };
  const typeByName = new Map(p.relTypes.map(t => [norm(t.name), t]));
  const ensureType = (name, extra = {}) => {
    const label = String(name || '관련').trim() || '관련';
    let t = typeByName.get(norm(label));
    if (!t) {
      t = { id: `r${++p.seq}`, name: label, color: nextSlot(p.relTypes), description: extra.description || '', symmetric: !!extra.symmetric, transitive: !!extra.transitive, inverseOf: null, domain: null, range: null };
      p.relTypes.push(t); typeByName.set(norm(label), t); stats.relTypes++;
    }
    return t;
  };

  const ids = new Set(p.entities.map(e => e.id));
  const indexById = new Map(p.entities.map((e, i) => [e.id, i]));
  const byClassKey = new Map(p.entities.map(e => [ck(e.classId, e.key), e.id]));
  let byLabel = null;
  const labelIndex = () => {
    if (!byLabel) {
      byLabel = new Map();
      for (const e of p.entities) { const n = norm(e.label); if (!byLabel.has(n)) byLabel.set(n, []); byLabel.get(n).push(e.id); }
    }
    return byLabel;
  };
  const indexLabel = e => { if (byLabel) { const n = norm(e.label); if (!byLabel.has(n)) byLabel.set(n, []); byLabel.get(n).push(e.id); } };

  const createEntity = (cls, key, label, props, src, stub) => {
    // 이미 '클래스-키' 꼴인 키(내보냈다 다시 가져온 경우)는 그대로 쓴다
    const k = slug(key), c = slug(cls.name);
    const id = uniqueId(k.startsWith(`${c}-`) ? k : `${c}-${k}`, ids);
    const e = { id, classId: cls.id, key, label: String(label || key), props: props || {}, src: src ? [src] : [] };
    if (stub) { e.stub = true; stats.stubs++; } else stats.entitiesAdded++;
    indexById.set(id, p.entities.length); p.entities.push(e); byClassKey.set(ck(cls.id, key), id); indexLabel(e);
    return id;
  };

  for (const fc of frag.classes || []) ensureClass(fc.name, fc.description);
  for (const ft of frag.relTypes || []) ensureType(ft.name, ft);

  for (const fe of frag.entities || []) {
    const cls = ensureClass(fe.class);
    const key = String(fe.key ?? fe.label ?? '').trim();
    if (!key) continue;
    let id = byClassKey.get(ck(cls.id, key));
    if (!id && opts.matchByLabel && fe.label) {
      id = (labelIndex().get(norm(fe.label)) || []).find(x => p.entities[indexById.get(x)].classId === cls.id);
      if (id) byClassKey.set(ck(cls.id, key), id);
    }
    if (id) {
      const i = indexById.get(id), old = p.entities[i];
      const label = old.stub || old.label === old.key ? (fe.label || old.label) : old.label;
      const next = { ...old, label: String(label), props: mergeProps(old.props, fe.props), src: addSrc(old.src, fe.src) };
      if (old.stub && !fe.stub) { delete next.stub; stats.entitiesAdded++; } else stats.entitiesUpdated++;
      p.entities[i] = next;
    } else {
      createEntity(cls, key, fe.label, fe.props, fe.src, fe.stub);
    }
  }

  const resolve = ref => {
    if (!ref) return null;
    if (ref.id && indexById.has(ref.id)) return ref.id;
    if (ref.key != null && ref.class) {
      const cls = ensureClass(ref.class);
      const key = String(ref.key).trim();
      if (!key) return null;
      return byClassKey.get(ck(cls.id, key)) || createEntity(cls, key, ref.label || key, {}, null, true);
    }
    if (ref.label) {
      const hits = labelIndex().get(norm(ref.label)) || [];
      const best = hits.find(x => !p.entities[indexById.get(x)].stub) || hits[0];
      if (best) return best;
      const cls = ensureClass(ref.class || '문서');
      return createEntity(cls, String(ref.label).trim(), ref.label, {}, null, true);
    }
    return null;
  };

  const relIndex = new Map(p.relations.map((r, i) => [r.id, i]));
  for (const fr of frag.relations || []) {
    const from = resolve(fr.from), to = resolve(fr.to);
    if (!from || !to) continue;
    const t = ensureType(fr.type);
    const id = relKey(from, t.id, to);
    if (relIndex.has(id)) {
      if (fr.props && Object.keys(fr.props).length) {
        const i = relIndex.get(id);
        p.relations[i] = { ...p.relations[i], props: mergeProps(p.relations[i].props, fr.props) };
      }
      continue;
    }
    const r = { id, typeId: t.id, from, to };
    if (fr.props && Object.keys(fr.props).length) r.props = fr.props;
    if (fr.src) r.src = fr.src;
    relIndex.set(id, p.relations.length); p.relations.push(r); stats.relationsAdded++;
  }

  for (const s of frag.sources || []) p.sources.push({ id: `s${++p.seq}`, at: Date.now(), ...s });
  p.updatedAt = Date.now();
  return { project: p, stats };
}

// 저장된 프로젝트(백업)를 조각으로 바꿔서 기존 작업에 합칠 수 있게 한다
export function projectToFragment(src) {
  const cls = new Map(src.classes.map(c => [c.id, c])), byId = new Map(src.entities.map(e => [e.id, e]));
  const types = new Map(src.relTypes.map(t => [t.id, t]));
  const ref = id => { const e = byId.get(id); return e && { class: cls.get(e.classId)?.name, key: e.key, label: e.label }; };
  return {
    classes: src.classes.map(c => ({ name: c.name, description: c.description })),
    relTypes: src.relTypes.map(t => ({ name: t.name, description: t.description, symmetric: t.symmetric, transitive: t.transitive })),
    entities: src.entities.map(e => ({ class: cls.get(e.classId)?.name, key: e.key, label: e.label, props: e.props, src: e.src?.[0], stub: e.stub })),
    relations: src.relations.map(r => ({ from: ref(r.from), type: types.get(r.typeId)?.name, to: ref(r.to), props: r.props })),
    sources: [{ name: src.name || '백업', kind: 'backup' }],
  };
}

export function isProject(x) {
  return x && typeof x === 'object' && Array.isArray(x.entities) && Array.isArray(x.relations) && Array.isArray(x.classes) && Array.isArray(x.relTypes);
}

// 오래된/다른 버전 백업도 최소한의 모양으로 맞춘다
export function normalizeProject(x) {
  const p = { ...emptyProject(x.name || '내 온톨로지'), ...x, format: FORMAT, version: 1 };
  p.seq = Math.max(Number(p.seq) || 0, p.classes.length + p.relTypes.length + p.sources.length);
  p.classes = p.classes.map(c => ({ description: '', color: 'slot:-1', ...c }));
  p.relTypes = p.relTypes.map(t => ({ description: '', color: 'slot:-1', symmetric: false, transitive: false, inverseOf: null, domain: null, range: null, ...t }));
  p.entities = p.entities.map(e => ({ props: {}, src: [], key: e.id, ...e, label: String(e.label ?? e.id) }));
  p.relations = p.relations.map(r => ({ ...r, id: relKey(r.from, r.typeId, r.to) }));
  return p;
}

// ─────────────────────────────────────────────────────────────
// 편집 동작
// ─────────────────────────────────────────────────────────────
const touch = p => ({ ...p, updatedAt: Date.now() });
const replaceById = (list, id, patch) => list.map(x => (x.id === id ? { ...x, ...patch } : x));

export const ops = {
  rename: (p, name) => touch({ ...p, name }),

  addClass(p, name) {
    return mergeInto(p, { classes: [{ name }] }).project;
  },
  updateClass: (p, id, patch) => touch({ ...p, classes: replaceById(p.classes, id, patch) }),
  deleteClass(p, id) {
    const gone = new Set(p.entities.filter(e => e.classId === id).map(e => e.id));
    return touch({
      ...p,
      classes: p.classes.filter(c => c.id !== id),
      relTypes: p.relTypes.map(t => ({ ...t, domain: t.domain === id ? null : t.domain, range: t.range === id ? null : t.range })),
      entities: p.entities.filter(e => !gone.has(e.id)),
      relations: p.relations.filter(r => !gone.has(r.from) && !gone.has(r.to)),
    });
  },
  mergeClass(p, fromId, toId) {
    if (fromId === toId) return p;
    const next = { ...p, entities: p.entities.map(e => (e.classId === fromId ? { ...e, classId: toId } : e)) };
    return ops.deleteClass(next, fromId);
  },

  addRelType(p, name) {
    return mergeInto(p, { relTypes: [{ name }] }).project;
  },
  updateRelType: (p, id, patch) => touch({ ...p, relTypes: replaceById(p.relTypes, id, patch) }),
  deleteRelType(p, id) {
    return touch({
      ...p,
      relTypes: p.relTypes.filter(t => t.id !== id).map(t => (t.inverseOf === id ? { ...t, inverseOf: null } : t)),
      relations: p.relations.filter(r => r.typeId !== id),
    });
  },
  mergeRelType(p, fromId, toId) {
    if (fromId === toId) return p;
    const seen = new Set(), relations = [];
    for (const r of p.relations) {
      const typeId = r.typeId === fromId ? toId : r.typeId, id = relKey(r.from, typeId, r.to);
      if (seen.has(id)) continue;
      seen.add(id); relations.push(typeId === r.typeId ? r : { ...r, typeId, id });
    }
    return ops.deleteRelType({ ...p, relations }, fromId);
  },

  // entity 에 id 가 없으면 새로 만든다
  saveEntity(p, entity) {
    if (entity.id && p.entities.some(e => e.id === entity.id)) {
      return touch({ ...p, entities: p.entities.map(e => {
        if (e.id !== entity.id) return e;
        const next = { ...e, ...entity };
        delete next.stub;
        return next;
      }) });
    }
    const cls = p.classes.find(c => c.id === entity.classId);
    const ids = new Set(p.entities.map(e => e.id));
    const key = entity.key || entity.label;
    const id = uniqueId(`${slug(cls?.name || 'x')}-${slug(key)}`, ids);
    return touch({ ...p, entities: [...p.entities, { props: {}, src: ['직접 입력'], ...entity, id, key }] });
  },
  deleteEntities(p, idList) {
    const gone = new Set(idList);
    return touch({ ...p, entities: p.entities.filter(e => !gone.has(e.id)), relations: p.relations.filter(r => !gone.has(r.from) && !gone.has(r.to)) });
  },
  // 중복 엔티티 합치기: keep 쪽 값을 우선, 연결은 모두 keep 으로 옮긴다
  mergeEntities(p, keepId, dropIds) {
    const drop = new Set(dropIds.filter(x => x !== keepId));
    if (!drop.size) return p;
    let keep = p.entities.find(e => e.id === keepId);
    for (const e of p.entities) if (drop.has(e.id)) keep = { ...keep, props: { ...e.props, ...keep.props }, src: [...new Set([...(keep.src || []), ...(e.src || [])])].slice(-5) };
    delete keep.stub;
    const swap = id => (drop.has(id) ? keepId : id);
    const seen = new Set(), relations = [];
    for (const r of p.relations) {
      const from = swap(r.from), to = swap(r.to);
      if (from === to && (drop.has(r.from) || drop.has(r.to))) continue;
      const id = relKey(from, r.typeId, to);
      if (seen.has(id)) continue;
      seen.add(id); relations.push(id === r.id ? r : { ...r, from, to, id });
    }
    return touch({ ...p, entities: p.entities.filter(e => !drop.has(e.id)).map(e => (e.id === keepId ? keep : e)), relations });
  },

  addRelation(p, from, typeId, to, props) {
    const id = relKey(from, typeId, to);
    if (p.relations.some(r => r.id === id)) return p;
    const r = { id, typeId, from, to, src: '직접 입력' };
    if (props && Object.keys(props).length) r.props = props;
    return touch({ ...p, relations: [...p.relations, r] });
  },
  deleteRelation: (p, id) => touch({ ...p, relations: p.relations.filter(r => r.id !== id) }),

  // 속성 값을 별도 노드로 '승격'한다. 예) 사람.도시="서울" → (사람)-[도시]->(도시:서울)
  promoteProperty(p, classId, propKey, newClassName, relName) {
    const cls = p.classes.find(c => c.id === classId);
    const frag = { classes: [{ name: newClassName }], relTypes: [{ name: relName }], entities: [], relations: [] };
    for (const e of p.entities) {
      if (e.classId !== classId || e.props?.[propKey] == null || e.props[propKey] === '') continue;
      for (const v of splitMulti(String(e.props[propKey]))) {
        frag.entities.push({ class: newClassName, key: v, label: v });
        frag.relations.push({ from: { id: e.id }, type: relName, to: { class: newClassName, key: v } });
      }
    }
    const stripped = { ...p, entities: p.entities.map(e => {
      if (e.classId !== classId || !(propKey in (e.props || {}))) return e;
      const props = { ...e.props }; delete props[propKey];
      return { ...e, props };
    }) };
    return cls ? mergeInto(stripped, frag).project : p;
  },
};

// 'a; b | c' → ['a','b','c']  (쉼표는 일반 문장에도 흔해서 짧은 값일 때만 나눈다)
export function splitMulti(v) {
  const s = String(v ?? '').trim();
  if (!s) return [];
  if (/[;|\n]/.test(s)) return [...new Set(s.split(/[;|\n]/).map(x => x.trim()).filter(Boolean))];
  if (s.includes(',')) {
    const parts = s.split(',').map(x => x.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every(x => x.length <= 24 && !/^\d+$/.test(x))) return [...new Set(parts)];
  }
  return [s];
}
