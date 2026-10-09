// JSON 계열: 백업 / AI 추출 결과 / JSON-LD / 일반 JSON(표로 펼치기)
import { isProject } from '../model.js';
import { makeTable, tableId, MAX_ROWS } from './table.js';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const isPrim = v => v == null || ['string', 'number', 'boolean'].includes(typeof v);

export function parseJsonText(text, name, source, warnings) {
  const t = text.replace(/^﻿/, '').trim();
  let data;
  try {
    data = JSON.parse(t);
  } catch {
    // JSON Lines(한 줄에 객체 하나)
    const lines = t.split(/\r?\n/).filter(Boolean);
    try { data = lines.map(l => JSON.parse(l)); } catch { warnings.push(`${source}: JSON 문법 오류로 읽지 못했어요`); return {}; }
  }
  return classifyJson(data, name, source, warnings);
}

export function classifyJson(data, name, source, warnings) {
  if (isProject(data)) return { project: data };
  if (looksLikeAiPayload(data)) return { fragment: aiPayloadToFragment(data, source), matchByLabel: true };
  if (looksLikeJsonLd(data)) return { fragment: jsonLdToFragment(data, source) };
  const tables = jsonToTables(data, name, source, warnings);
  if (!tables.length) warnings.push(`${source}: 표로 바꿀 수 있는 목록(객체 배열)을 찾지 못했어요`);
  return { tables };
}

// ── AI 추출 결과: { entities:[{id,class,label,props}], relations:[{from,type,to}] } ──
export function looksLikeAiPayload(d) {
  return isObj(d) && Array.isArray(d.entities) && !Array.isArray(d.classes) &&
    d.entities.every(e => isObj(e) && (e.class || e.type || e.category) != null);
}

export function aiPayloadToFragment(d, source = 'AI 추출') {
  const frag = { classes: [], relTypes: [], entities: [], relations: [], sources: [{ name: source, kind: 'ai' }] };
  const byId = new Map();
  for (const c of d.classes || d.schema?.classes || []) if (c?.name) frag.classes.push({ name: String(c.name), description: c.description || '' });
  for (const r of d.relationTypes || d.schema?.relations || []) if (r?.name) frag.relTypes.push({ name: String(r.name), description: r.description || '' });
  for (const e of d.entities) {
    const cls = String(e.class ?? e.type ?? e.category);
    const id = String(e.id ?? e.label ?? e.name ?? '').trim();
    const label = String(e.label ?? e.name ?? id);
    if (!id) continue;
    const props = {};
    for (const [k, v] of Object.entries(e.props || e.properties || e.attributes || {})) props[k] = isPrim(v) ? String(v ?? '') : JSON.stringify(v);
    byId.set(id, { class: cls, key: id, label });
    frag.entities.push({ class: cls, key: id, label, props, src: source });
  }
  const ref = x => byId.get(String(x)) || { label: String(x), class: '항목' };
  for (const r of d.relations || d.edges || []) {
    const from = r.from ?? r.source ?? r.subject, to = r.to ?? r.target ?? r.object, type = r.type ?? r.relation ?? r.predicate;
    if (from == null || to == null || !type) continue;
    const rel = { from: ref(from), type: String(type), to: ref(to), src: source };
    if (isObj(r.props)) rel.props = Object.fromEntries(Object.entries(r.props).map(([k, v]) => [k, String(v)]));
    frag.relations.push(rel);
  }
  return frag;
}

// ── JSON-LD (Linked Data 표준) ──
export function looksLikeJsonLd(d) {
  if (isObj(d) && (d['@graph'] || d['@context'] || d['@id'])) return true;
  return Array.isArray(d) && d.length > 0 && d.every(x => isObj(x) && x['@id']);
}

const shortIri = iri => {
  const s = String(iri);
  const tail = s.split(/[#/]/).pop() || s;
  const local = tail.includes(':') && !/^\w+:\/\//.test(tail) ? tail.split(':').pop() : tail;
  try { return decodeURIComponent(local) || s; } catch { return local || s; }
};
const literal = v => (isObj(v) ? (v['@value'] ?? JSON.stringify(v)) : v);
const LABEL_KEYS = ['rdfs:label', 'label', 'name', 'schema:name', 'http://www.w3.org/2000/01/rdf-schema#label', 'skos:prefLabel', 'title'];

export function jsonLdToFragment(doc, source) {
  const frag = { classes: [], relTypes: [], entities: [], relations: [], sources: [{ name: source, kind: 'jsonld' }] };
  const roots = Array.isArray(doc) ? doc : doc['@graph'] ? [].concat(doc['@graph']) : [doc];
  const nodes = [];
  let anon = 0;
  const collect = n => {
    if (!n['@id']) n = { ...n, '@id': `_:b${++anon}` };
    nodes.push(n);
    for (const [k, v] of Object.entries(n)) {
      if (k.startsWith('@')) continue;
      for (const x of [].concat(v)) if (isObj(x) && !('@value' in x) && Object.keys(x).some(key => !key.startsWith('@') || key === '@type')) {
        if (!x['@id']) x['@id'] = `_:b${++anon}`;
        collect(x);
      }
    }
    return n;
  };
  roots.filter(isObj).forEach(collect);
  // @context 에서 값이 IRI(다른 노드)인 속성 이름을 찾는다: "팀": { "@type": "@id" }
  const idTerms = new Set();
  for (const ctx of [].concat(Array.isArray(doc) ? [] : doc['@context'] || [])) {
    if (isObj(ctx)) for (const [k, v] of Object.entries(ctx)) if (isObj(v) && (v['@type'] === '@id' || v['@type'] === '@vocab')) idTerms.add(k);
  }
  const classOf = new Map(nodes.map(n => [n['@id'], shortIri([].concat(n['@type'] || '항목')[0])]));
  const ref = id => ({ class: classOf.get(id) || '항목', key: shortIri(id), label: shortIri(id) });
  const text = v => (v == null ? '' : String(literal([].concat(v)[0])));
  for (const n of nodes) {
    const ty = [].concat(n['@type'] || []).join(' ');
    if (/owl:Class|rdfs:Class/.test(ty)) { frag.classes.push({ name: text(n.label ?? n['rdfs:label']) || shortIri(n['@id']), description: text(n.comment ?? n['rdfs:comment']) }); continue; }
    if (/ObjectProperty|rdf:Property/.test(ty)) {
      frag.relTypes.push({ name: text(n.label ?? n['rdfs:label']) || shortIri(n['@id']), description: text(n.comment ?? n['rdfs:comment']), symmetric: /SymmetricProperty/.test(ty), transitive: /TransitiveProperty/.test(ty) });
      continue;
    }
    if (/DatatypeProperty/.test(ty)) continue;
    const id = n['@id'], cls = classOf.get(id);
    const labelKey = LABEL_KEYS.find(k => n[k] != null);
    const label = labelKey ? String(literal([].concat(n[labelKey])[0])) : shortIri(id);
    const props = {};
    for (const [k, v] of Object.entries(n)) {
      if (k.startsWith('@') || k === labelKey) continue;
      const vals = [].concat(v), lits = [];
      for (const x of vals) {
        if (isObj(x) && x['@id'] && !('@value' in x)) frag.relations.push({ from: ref(id), type: shortIri(k), to: ref(x['@id']), src: source });
        else if (typeof x === 'string' && idTerms.has(k)) frag.relations.push({ from: ref(id), type: shortIri(k), to: ref(x), src: source });
        else lits.push(literal(x));
      }
      if (lits.length) props[shortIri(k)] = lits.map(x => (isPrim(x) ? String(x ?? '') : JSON.stringify(x))).join('; ');
    }
    frag.entities.push({ class: cls, key: shortIri(id), label, props, src: source });
  }
  return frag;
}

// ── 일반 JSON → 표: 객체 배열은 표로, 안쪽 객체 배열은 부모와 연결된 하위 표로 ──
export function jsonToTables(data, rootName, source, warnings) {
  const tables = [];
  const byName = new Map();

  const tableFor = (name, parent, rel) => {
    const k = `${parent?.id || ''}/${name}`;
    if (!byName.has(k)) {
      const t = { id: tableId(), name, source: `${source}› ${name}`, colIndex: new Map(), columns: [], rows: [], parentIndex: [], parent: parent ? { tableId: parent.id, rel } : undefined };
      byName.set(k, t); tables.push(t);
    }
    return byName.get(k);
  };

  const addRows = (t, items, parentRow) => {
    for (const item of items) {
      if (t.rows.length >= MAX_ROWS) { warnings.push(`${t.source}: 행이 많아 ${MAX_ROWS.toLocaleString()}개까지만 가져와요`); return; }
      const rowIdx = t.rows.length;
      const flat = {};
      const children = [];
      const walk = (obj, prefix, depth) => {
        for (const [k, v] of Object.entries(obj)) {
          const key = prefix + k;
          if (isPrim(v)) flat[key] = v == null ? '' : String(v);
          else if (Array.isArray(v)) {
            if (v.every(isPrim)) flat[key] = v.filter(x => x != null).join('; ');
            else if (v.every(isObj)) children.push([k, v]);
            else flat[key] = JSON.stringify(v);
          } else if (depth < 2) walk(v, `${key}.`, depth + 1);
          else flat[key] = JSON.stringify(v);
        }
      };
      walk(isObj(item) ? item : { 값: item }, '', 0);
      for (const k of Object.keys(flat)) if (!t.colIndex.has(k)) { t.colIndex.set(k, t.columns.length); t.columns.push(k); }
      const row = [];
      for (const [k, v] of Object.entries(flat)) row[t.colIndex.get(k)] = v.trim();
      t.rows.push(row);
      t.parentIndex.push(parentRow);
      for (const [k, arr] of children) addRows(tableFor(k, t, k), arr, rowIdx);
    }
  };

  if (Array.isArray(data)) {
    if (data.length) addRows(tableFor(rootName), data, -1);
  } else if (isObj(data)) {
    const arrays = Object.entries(data).filter(([, v]) => Array.isArray(v) && v.length && v.every(isObj));
    const values = Object.values(data);
    if (arrays.length) for (const [k, arr] of arrays) addRows(tableFor(k), arr, -1);
    else if (values.length > 1 && values.every(isObj)) addRows(tableFor(rootName), Object.entries(data).map(([k, v]) => ({ 키: k, ...v })), -1);
    else addRows(tableFor(rootName), [data], -1);
  }

  return tables.map(t => {
    const width = t.columns.length;
    const out = makeTable(t.name, t.source, t.columns, t.rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? '')));
    // makeTable 은 빈 행을 지우므로, 부모 연결 정보가 어긋나지 않게 직접 맞춘다
    out.rows = t.rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? ''));
    out.id = t.id;
    out.parentIndex = t.parentIndex;
    if (t.parent) out.parent = t.parent;
    return out;
  }).filter(t => t.columns.length);
}
