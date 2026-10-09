// 내보내기: AI 가 바로 쓰기 좋은 형식 + 표준 형식(JSON-LD, RDF Turtle, Cypher, 트리플 CSV)
import { buildIndex, inferRelations, communities, typeUsage, classProps } from './graph.js';
import { detectType } from './infer.js';

const BASE = 'urn:ontology-studio:';

// 내보낼 범위(ids)만 남긴 보기. ids 가 없으면 전체.
export function makeView(project, { ids = null, inferred = false } = {}) {
  const extra = inferred ? inferRelations(project) : [];
  const keep = ids ? (e => ids.has(e.id)) : () => true;
  const entities = project.entities.filter(keep);
  const set = new Set(entities.map(e => e.id));
  const relations = [...project.relations, ...extra].filter(r => set.has(r.from) && set.has(r.to));
  const sub = { ...project, entities, relations };
  return { project, sub, index: buildIndex(sub, relations), entities, relations };
}

// 대략적인 토큰 수(영문 약 4글자, 한글 약 1.5글자당 1토큰으로 어림)
export function estimateTokens(text) {
  let ascii = 0, other = 0;
  for (let i = 0; i < text.length; i++) (text.charCodeAt(i) < 128 ? ascii++ : other++);
  return Math.ceil(ascii / 4 + other / 1.5);
}

function propTypes(view) {
  const { props } = classProps(view.sub);
  const out = new Map();
  for (const [cid, m] of props) out.set(cid, new Map([...m].map(([k, vals]) => [k, detectType(vals)])));
  return out;
}

const TYPE_KO = { text: '글', number: '숫자', date: '날짜', boolean: '참/거짓', url: '링크', email: '이메일' };
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();

function groupsOf(view, groupBy) {
  const { index, entities } = view;
  const byDeg = (a, b) => index.degree(b.id) - index.degree(a.id) || a.label.localeCompare(b.label, 'ko');
  if (groupBy === 'community') {
    const com = communities(index);
    const m = new Map();
    for (const e of entities) { const c = com.get(e.id) ?? 0; if (!m.has(c)) m.set(c, []); m.get(c).push(e); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([c, list], i) => {
      list.sort(byDeg);
      const head = list.slice(0, 3).map(e => e.label).join(', ');
      return { title: list.length === 1 ? `묶음 ${i + 1}` : `묶음 ${i + 1} — 중심: ${head}`, list, c };
    });
  }
  return view.project.classes.map(c => ({ title: c.name, list: entities.filter(e => e.classId === c.id).sort(byDeg) })).filter(g => g.list.length);
}

// ── 1) AI 컨텍스트(마크다운) ──
export function toMarkdown(view, opts = {}) {
  const { project, index, entities, relations } = view;
  const { compact = false, props = true, sources = false, incoming = false, groupBy = 'class', title } = opts;
  const types = propTypes(view);
  const usage = typeUsage(index);
  const ref = id => { const e = index.entity.get(id); return e ? `${e.label} [${e.id}]` : `[${id}]`; };
  const L = [];
  const classesUsed = project.classes.filter(c => entities.some(e => e.classId === c.id));
  const typesUsed = project.relTypes.filter(t => relations.some(r => r.typeId === t.id));
  const inferredN = relations.filter(r => r.inferred).length;

  if (compact) {
    L.push(`# 지식 그래프: ${title || project.name}`);
    L.push(`형식: 엔티티 줄 = ID|클래스|이름|속성=값;… / 관계 줄 = 출발ID>관계>도착ID${inferredN ? ' (끝에 * = 추론)' : ''}`);
    L.push('', '## 스키마');
    L.push('클래스: ' + classesUsed.map(c => {
      const pt = [...(types.get(c.id) || new Map())].map(([k, t]) => `${k}:${t}`).join(',');
      return `${c.name}${pt ? `{${pt}}` : ''}${c.description ? `"${oneLine(c.description)}"` : ''}`;
    }).join('; '));
    L.push('관계: ' + typesUsed.map(t => `${t.name}(${domRange(index, usage, t)})${t.description ? `"${oneLine(t.description)}"` : ''}`).join('; '));
    L.push('', '## 엔티티');
    for (const e of entities) {
      const ps = props ? Object.entries(e.props || {}).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${clip(oneLine(v), 120)}`).join(';') : '';
      L.push(`${e.id}|${index.cls.get(e.classId)?.name || ''}|${oneLine(e.label)}${ps ? '|' + ps : ''}`);
    }
    L.push('', '## 관계');
    for (const r of relations) {
      const rp = r.props ? '{' + Object.entries(r.props).map(([k, v]) => `${k}=${oneLine(v)}`).join(';') + '}' : '';
      L.push(`${r.from}>${index.type.get(r.typeId)?.name}>${r.to}${rp}${r.inferred ? '*' : ''}`);
    }
    return L.join('\n');
  }

  L.push(`# 지식 그래프: ${title || project.name}`, '');
  L.push('이 문서는 데이터를 온톨로지(개념과 관계의 구조)로 정리한 것입니다.');
  L.push('- 엔티티는 `이름 [ID]` 로 적습니다. 답할 때 [ID] 로 근거를 밝혀 주세요.');
  L.push('- 관계는 `엔티티 아래 → 관계: 대상` 으로 적으며, 항상 위 엔티티에서 대상으로 향합니다.');
  if (inferredN) L.push('- `(추론)` 표시는 원본에 직접 적힌 것이 아니라 관계 규칙(대칭·전이·역관계)으로 계산한 것입니다.');
  L.push('', `규모: 엔티티 ${entities.length.toLocaleString()} · 관계 ${relations.length.toLocaleString()} · 클래스 ${classesUsed.length} · 관계 종류 ${typesUsed.length}`);

  L.push('', '## 1. 스키마', '', '### 클래스(개념)');
  for (const c of classesUsed) {
    const n = entities.filter(e => e.classId === c.id).length;
    const pt = [...(types.get(c.id) || new Map())].map(([k, t]) => `${k}(${TYPE_KO[t] || t})`).join(', ');
    L.push(`- **${c.name}** (${n}개)${c.description ? `: ${oneLine(c.description)}` : ''}${pt ? `\n  - 속성: ${pt}` : ''}`);
  }
  L.push('', '### 관계 종류');
  for (const t of typesUsed) {
    const n = relations.filter(r => r.typeId === t.id).length;
    const flags = [t.symmetric && '대칭', t.transitive && '전이', t.inverseOf && `역관계: ${index.type.get(t.inverseOf)?.name}`].filter(Boolean);
    L.push(`- **${t.name}**: ${domRange(index, usage, t)} (${n}개)${t.description ? ` — ${oneLine(t.description)}` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
  }

  L.push('', '## 2. 엔티티와 사실');
  for (const g of groupsOf(view, groupBy)) {
    L.push('', `### ${g.title}`);
    for (const e of g.list) {
      const cname = index.cls.get(e.classId)?.name;
      const head = `- ${oneLine(e.label)} [${e.id}]${groupBy === 'community' ? ` (${cname})` : ''}`;
      const ps = props ? Object.entries(e.props || {}).filter(([, v]) => v !== '').map(([k, v]) => `${k}: ${clip(oneLine(v), 200)}`) : [];
      L.push(ps.length ? `${head} — ${ps.join(' · ')}` : head);
      if (sources && e.src?.length) L.push(`  - 출처: ${e.src.join(', ')}`);
      const byType = new Map();
      for (const r of index.out.get(e.id) || []) {
        if (!byType.has(r.typeId)) byType.set(r.typeId, []);
        byType.get(r.typeId).push(r);
      }
      for (const [tid, rs] of byType) {
        const items = rs.map(r => {
          const rp = r.props ? ` (${Object.entries(r.props).map(([k, v]) => `${k}: ${oneLine(v)}`).join(', ')})` : '';
          return `${ref(r.to)}${rp}${r.inferred ? ' (추론)' : ''}`;
        });
        L.push(`  - → ${index.type.get(tid)?.name}: ${items.join(', ')}`);
      }
      if (incoming) {
        const inc = new Map();
        for (const r of index.inc.get(e.id) || []) {
          if (!inc.has(r.typeId)) inc.set(r.typeId, []);
          inc.get(r.typeId).push(r);
        }
        for (const [tid, rs] of inc) L.push(`  - ← ${index.type.get(tid)?.name}: ${rs.map(r => ref(r.from)).join(', ')}`);
      }
    }
  }
  return L.join('\n');
}

function domRange(index, usage, t) {
  const name = id => index.cls.get(id)?.name || '?';
  if (t.domain || t.range) return `${t.domain ? name(t.domain) : '무엇이든'} → ${t.range ? name(t.range) : '무엇이든'}`;
  const u = usage.get(t.id);
  if (!u) return '';
  return [...u.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k.split('>').map(name).join(' → ')).join(' / ');
}

// ── 2) 질문용 프롬프트: 그래프 근거로만 답하게 하는 지시문 + 컨텍스트 ──
export function toPrompt(view, opts = {}) {
  const kg = toMarkdown(view, opts);
  const q = (opts.question || '').trim() || '(여기에 질문을 적으세요)';
  return [
    '<instructions>',
    '너는 아래 <knowledge_graph> 에 정리된 지식 그래프를 근거로 답하는 분석가야.',
    '1. 그래프에 있는 사실만 근거로 쓰고, 없는 내용은 추측하지 말고 "그래프에 없음"이라고 말해.',
    '2. 답에 쓴 엔티티는 [ID] 로 인용해.',
    '3. 여러 단계를 거쳐 연결을 따라갔다면 경로를 `A —관계→ B —관계→ C` 형식으로 보여줘.',
    '4. 관계 방향은 스키마에 적힌 대로 해석하고, (추론) 표시가 붙은 관계는 "추론"이라고 밝혀.',
    '5. 데이터에서 모순이나 빠진 부분이 보이면 마지막에 짧게 알려줘.',
    '</instructions>',
    '',
    '<knowledge_graph>',
    kg,
    '</knowledge_graph>',
    '',
    '<question>',
    q,
    '</question>',
  ].join('\n');
}

// ── 3) JSON-LD (W3C Linked Data) ──
export function toJsonLd(view) {
  const { project, index, entities, relations } = view;
  const types = propTypes(view);
  const ctx = {
    '@vocab': `${BASE}vocab#`, e: `${BASE}entity#`, c: `${BASE}class#`, p: `${BASE}prop#`, a: `${BASE}attr#`,
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#', owl: 'http://www.w3.org/2002/07/owl#', xsd: 'http://www.w3.org/2001/XMLSchema#',
    label: 'rdfs:label', comment: 'rdfs:comment',
  };
  const used = new Set(relations.map(r => r.typeId));
  for (const t of project.relTypes) if (used.has(t.id)) ctx[t.name] = { '@id': `p:${iriLocal(t.name)}`, '@type': '@id' };
  for (const [, m] of types) for (const [k, ty] of m) if (!ctx[k]) ctx[k] = { '@id': `a:${iriLocal(k)}`, ...(ty === 'date' ? { '@type': 'xsd:date' } : {}) };
  const graph = [];
  for (const c of project.classes) if (entities.some(e => e.classId === c.id)) graph.push({ '@id': `c:${iriLocal(c.name)}`, '@type': 'owl:Class', label: c.name, ...(c.description ? { comment: c.description } : {}) });
  for (const t of project.relTypes) if (used.has(t.id)) {
    const n = { '@id': `p:${iriLocal(t.name)}`, '@type': t.symmetric ? ['owl:ObjectProperty', 'owl:SymmetricProperty'] : t.transitive ? ['owl:ObjectProperty', 'owl:TransitiveProperty'] : 'owl:ObjectProperty', label: t.name };
    if (t.description) n.comment = t.description;
    if (t.domain) n['rdfs:domain'] = { '@id': `c:${iriLocal(index.cls.get(t.domain)?.name)}` };
    if (t.range) n['rdfs:range'] = { '@id': `c:${iriLocal(index.cls.get(t.range)?.name)}` };
    if (t.inverseOf && index.type.get(t.inverseOf)) n['owl:inverseOf'] = { '@id': `p:${iriLocal(index.type.get(t.inverseOf).name)}` };
    graph.push(n);
  }
  for (const e of entities) {
    const tdef = types.get(e.classId) || new Map();
    const node = { '@id': `e:${iriLocal(e.id)}`, '@type': `c:${iriLocal(index.cls.get(e.classId)?.name)}`, label: e.label };
    for (const [k, v] of Object.entries(e.props || {})) if (v !== '') node[k] = typed(v, tdef.get(k));
    for (const r of index.out.get(e.id) || []) {
      const k = index.type.get(r.typeId)?.name;
      const val = `e:${iriLocal(r.to)}`;
      node[k] = node[k] ? [].concat(node[k], val) : val;
    }
    graph.push(node);
  }
  return JSON.stringify({ '@context': ctx, '@graph': graph }, null, 2);
}

function typed(v, t) {
  const s = String(v);
  if (t === 'number' && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (t === 'boolean') return /^(true|yes|y|예|참)$/i.test(s);
  return s;
}

// IRI/Turtle 로컬 이름에 안전한 글자만 남기고 나머지는 %XX 로
export function iriLocal(s) {
  const safe = /[A-Za-z0-9_À-ÖØ-öø-˿Ͱ-ͽͿ-῿、-퟿豈-﷏-]/u;
  let out = '';
  for (const ch of String(s ?? '')) {
    if (safe.test(ch) && !(out === '' && ch === '-')) out += ch;
    else for (const b of new TextEncoder().encode(ch)) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out || '_';
}

// ── 4) RDF Turtle + OWL 스키마 (Protégé, GraphDB 등 온톨로지 도구용) ──
export function toTurtle(view) {
  const { project, index, entities, relations } = view;
  const types = propTypes(view);
  const lit = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  const L = [
    `# ${project.name} — 온톨로지 스튜디오에서 내보냄 (${new Date().toISOString().slice(0, 10)})`,
    '# 관계에 붙은 속성(예: 역할)은 표준 트리플로 표현하기 어려워 생략했어요. 필요하면 JSON-LD·Cypher 를 쓰세요.',
    `@prefix c: <${BASE}class#> .`, `@prefix p: <${BASE}prop#> .`, `@prefix a: <${BASE}attr#> .`, `@prefix e: <${BASE}entity#> .`,
    '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .', '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix owl: <http://www.w3.org/2002/07/owl#> .', '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .', '',
    '# ── 스키마 ──',
  ];
  for (const c of project.classes) if (entities.some(e => e.classId === c.id)) {
    L.push(`c:${iriLocal(c.name)} a owl:Class ; rdfs:label ${lit(c.name)}@ko${c.description ? ` ; rdfs:comment ${lit(c.description)}@ko` : ''} .`);
  }
  const used = new Set(relations.map(r => r.typeId));
  for (const t of project.relTypes) if (used.has(t.id)) {
    const parts = [`p:${iriLocal(t.name)} a owl:ObjectProperty${t.symmetric ? ', owl:SymmetricProperty' : ''}${t.transitive ? ', owl:TransitiveProperty' : ''}`, `rdfs:label ${lit(t.name)}@ko`];
    if (t.description) parts.push(`rdfs:comment ${lit(t.description)}@ko`);
    if (t.domain && index.cls.get(t.domain)) parts.push(`rdfs:domain c:${iriLocal(index.cls.get(t.domain).name)}`);
    if (t.range && index.cls.get(t.range)) parts.push(`rdfs:range c:${iriLocal(index.cls.get(t.range).name)}`);
    if (t.inverseOf && index.type.get(t.inverseOf)) parts.push(`owl:inverseOf p:${iriLocal(index.type.get(t.inverseOf).name)}`);
    L.push(parts.join(' ;\n    ') + ' .');
  }
  const attrs = new Map();
  for (const [cid, m] of types) for (const [k, ty] of m) if (!attrs.has(k)) attrs.set(k, { ty, cid });
  for (const [k, { ty }] of attrs) L.push(`a:${iriLocal(k)} a owl:DatatypeProperty ; rdfs:label ${lit(k)}@ko${ty === 'number' ? ' ; rdfs:range xsd:decimal' : ty === 'date' ? ' ; rdfs:range xsd:date' : ''} .`);
  L.push('', '# ── 데이터 ──');
  for (const e of entities) {
    const tdef = types.get(e.classId) || new Map();
    const parts = [`e:${iriLocal(e.id)} a c:${iriLocal(index.cls.get(e.classId)?.name)}`, `rdfs:label ${lit(e.label)}`];
    for (const [k, v] of Object.entries(e.props || {})) {
      if (v === '') continue;
      const s = String(v), t = tdef.get(k);
      let o = lit(s);
      if (t === 'number' && /^-?\d+(\.\d+)?$/.test(s)) o = /\./.test(s) ? `"${s}"^^xsd:decimal` : `"${s}"^^xsd:integer`;
      else if (t === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(s)) o = `${lit(s)}^^xsd:date`;
      parts.push(`a:${iriLocal(k)} ${o}`);
    }
    const byType = new Map();
    for (const r of index.out.get(e.id) || []) {
      if (!byType.has(r.typeId)) byType.set(r.typeId, []);
      byType.get(r.typeId).push(`e:${iriLocal(r.to)}`);
    }
    for (const [tid, objs] of byType) parts.push(`p:${iriLocal(index.type.get(tid)?.name)} ${objs.join(', ')}`);
    L.push(parts.join(' ;\n    ') + ' .');
  }
  return L.join('\n');
}

// ── 5) 트리플 CSV (subject, predicate, object) — 지식그래프 임베딩·분석 도구용 ──
export function toTriplesCsv(view) {
  const { index, entities, relations } = view;
  const q = s => { const v = String(s ?? ''); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = [['subject', 'predicate', 'object', 'object_is_entity']];
  for (const e of entities) {
    rows.push([e.id, 'type', index.cls.get(e.classId)?.name, 'false']);
    rows.push([e.id, 'label', e.label, 'false']);
    for (const [k, v] of Object.entries(e.props || {})) if (v !== '') rows.push([e.id, k, v, 'false']);
  }
  for (const r of relations) rows.push([r.from, index.type.get(r.typeId)?.name, r.to, 'true']);
  return rows.map(r => r.map(q).join(',')).join('\n');
}

// ── 6) Cypher (Neo4j / Memgraph 그래프 DB에 붙여넣어 실행) ──
export function toCypher(view) {
  const { project, index, entities, relations } = view;
  const s = v => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  const k = v => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? v : '`' + String(v).replace(/`/g, '``') + '`');
  const map = o => '{' + Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([a, b]) => `${k(a)}: ${s(b)}`).join(', ') + '}';
  const L = [`// ${project.name} — 온톨로지 스튜디오에서 내보냄`, 'CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE;', ''];
  for (const c of project.classes) {
    const list = entities.filter(e => e.classId === c.id);
    for (let i = 0; i < list.length; i += 500) {
      const rows = list.slice(i, i + 500).map(e => `{id: ${s(e.id)}, label: ${s(e.label)}, props: ${map(e.props || {})}}`);
      L.push(`UNWIND [\n  ${rows.join(',\n  ')}\n] AS row\nMERGE (n:Entity {id: row.id}) SET n:${k(c.name)}, n.label = row.label, n += row.props;`, '');
    }
  }
  for (const t of project.relTypes) {
    const list = relations.filter(r => r.typeId === t.id);
    for (let i = 0; i < list.length; i += 500) {
      const rows = list.slice(i, i + 500).map(r => `{from: ${s(r.from)}, to: ${s(r.to)}, props: ${map({ ...(r.props || {}), ...(r.inferred ? { inferred: 'true' } : {}) })}}`);
      L.push(`UNWIND [\n  ${rows.join(',\n  ')}\n] AS row\nMATCH (a:Entity {id: row.from}), (b:Entity {id: row.to})\nMERGE (a)-[r:${k(t.name)}]->(b) SET r += row.props;`, '');
    }
  }
  return L.join('\n');
}

export function toBackup(project) {
  return JSON.stringify(project);
}

export const FORMATS = [
  { id: 'md', name: 'AI 컨텍스트', ext: 'md', mime: 'text/markdown', desc: 'Claude·ChatGPT 에 붙여넣기 좋은 정리본', ai: true },
  { id: 'prompt', name: '질문 프롬프트', ext: 'txt', mime: 'text/plain', desc: '그래프 근거로만 답하게 하는 지시문 포함', ai: true },
  { id: 'jsonld', name: 'JSON-LD', ext: 'jsonld', mime: 'application/ld+json', desc: '웹 표준 연결 데이터 · 다시 가져오기 가능' },
  { id: 'ttl', name: 'RDF Turtle', ext: 'ttl', mime: 'text/turtle', desc: 'OWL 스키마 포함 · Protégé 등 온톨로지 도구' },
  { id: 'csv', name: '트리플 CSV', ext: 'csv', mime: 'text/csv', desc: '주어·관계·대상 3열 · 분석/임베딩용' },
  { id: 'cypher', name: 'Cypher', ext: 'cypher', mime: 'text/plain', desc: 'Neo4j 그래프 DB 에 바로 실행' },
  { id: 'backup', name: '작업 백업', ext: 'json', mime: 'application/json', desc: '이 앱으로 그대로 다시 불러오기' },
];

export function render(format, view, opts) {
  switch (format) {
    case 'md': return toMarkdown(view, opts);
    case 'prompt': return toPrompt(view, opts);
    case 'jsonld': return toJsonLd(view);
    case 'ttl': return toTurtle(view);
    case 'csv': return toTriplesCsv(view);
    case 'cypher': return toCypher(view);
    case 'backup': return toBackup(view.project);
    default: return '';
  }
}
