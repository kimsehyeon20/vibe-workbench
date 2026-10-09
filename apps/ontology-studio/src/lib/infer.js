// 자동 형식화: 표의 각 열을 살펴보고 '이 표는 어떤 개념이고, 어느 열이 다른 표를 가리키는지' 추측한다.
//
// mapping = {
//   tableId, include, mode: 'entities' | 'edges', className, idCol, labelCol,
//   cols: { [열이름]: { role: 'attr'|'link'|'ignore', datatype, target, matchBy: 'key'|'label', rel, reason } },
//   from, to, edgeRel,         ← mode 'edges'(연결표)일 때: 두 열이 가리키는 것끼리 관계를 만든다
//   parentRel                  ← JSON 하위 표일 때 부모와 잇는 관계 이름
// }
// target = { kind: 'table', tableId } | { kind: 'class', name }
import { norm, splitMulti } from './model.js';

const ID_NAME = /^(id|_id|key|code|no|uuid|아이디|코드|번호|식별자|고유번호|키)$/i;
const ID_SUFFIX = /[\s_-]?(id|no|code|코드|번호|아이디)$/i;
const LABEL_NAME = /(name|title|label|이름|제목|명칭|성명|명$)/i;
const FREE_TEXT = /(설명|메모|비고|내용|요약|본문|주소|note|desc|comment|memo|summary|text|address)/i;

const RE = {
  number: /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/,
  date: /^(\d{4}[-./]\d{1,2}[-./]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?|\d{4}년\s*\d{1,2}월(\s*\d{1,2}일)?)/,
  boolean: /^(true|false|yes|no|y|n|예|아니오|참|거짓)$/i,
  url: /^https?:\/\/\S+$/i,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
};

export function detectType(values) {
  const sample = values.slice(0, 400);
  if (!sample.length) return 'text';
  for (const t of ['number', 'date', 'boolean', 'url', 'email']) {
    if (sample.filter(v => RE[t].test(v)).length >= sample.length * 0.9) return t;
  }
  return 'text';
}

export function profile(table) {
  return table.columns.map((name, ci) => {
    const vals = table.rows.map(r => r[ci] ?? '').filter(v => v !== '');
    const distinct = new Set(vals);
    const multiRows = vals.filter(v => /[;|]/.test(v)).length;
    const parts = new Set(vals.flatMap(splitMulti));
    return {
      name, ci, nonEmpty: vals.length, distinct: distinct.size, parts,
      unique: vals.length > 0 && distinct.size === vals.length && vals.length === table.rows.length,
      datatype: detectType(vals),
      avgLen: vals.length ? vals.reduce((s, v) => s + v.length, 0) / vals.length : 0,
      multi: multiRows >= Math.max(2, vals.length * 0.2),
      samples: [...distinct].slice(0, 3),
    };
  });
}

const stripId = s => String(s).replace(ID_SUFFIX, '').replace(/[\s_-]+$/, '') || s;
const singular = s => s.replace(/(ies)$/, 'y').replace(/(s)$/, '');

function nameHint(colName, targetName) {
  const a = norm(stripId(colName)), b = norm(targetName), bs = norm(singular(String(targetName)));
  if (!a || !b) return false;
  return a === b || a === bs || (b.length >= 2 && a.includes(b)) || (bs.length >= 2 && a.includes(bs)) || (a.length >= 2 && b.includes(a));
}

function overlap(set, target) {
  if (!set.size || !target.size) return 0;
  let hit = 0;
  for (const v of set) if (target.has(v)) hit++;
  return hit / set.size;
}

function pickId(profs) {
  return profs.find(p => ID_NAME.test(p.name) && p.unique)
    || profs.find(p => p.unique && ID_SUFFIX.test(p.name))
    || (profs[0]?.unique && profs[0].avgLen <= 40 && !FREE_TEXT.test(profs[0].name) ? profs[0] : null);
}

function pickLabel(profs, idCol) {
  return profs.find(p => p.name !== idCol && LABEL_NAME.test(p.name) && !FREE_TEXT.test(p.name) && p.datatype === 'text')
    || profs.find(p => p.name !== idCol && p.datatype === 'text' && !FREE_TEXT.test(p.name) && !ID_SUFFIX.test(p.name) && p.nonEmpty && p.distinct / p.nonEmpty >= 0.8 && p.avgLen <= 60)
    || null;
}

const defaultClassName = name => String(name).replace(/\.[^.]+$/, '').trim() || '항목';

// existing: 프로젝트에 이미 있는 클래스들의 키/이름 모음(다음 가져오기에서 기존 데이터와 이어주기)
export function existingTargets(project) {
  const out = new Map();
  for (const c of project.classes) out.set(c.id, { name: c.name, keys: new Set(), labels: new Set() });
  for (const e of project.entities) {
    const t = out.get(e.classId);
    if (t) { t.keys.add(e.key); t.labels.add(norm(e.label)); }
  }
  return [...out.values()].filter(t => t.keys.size);
}

export function proposeMappings(tables, project) {
  const profiles = new Map(tables.map(t => [t.id, profile(t)]));
  const base = tables.map(t => {
    const profs = profiles.get(t.id);
    const idP = pickId(profs);
    const labelP = pickLabel(profs, idP?.name);
    return { tableId: t.id, include: true, mode: 'entities', className: defaultClassName(t.name), idCol: idP?.name ?? null, labelCol: labelP?.name ?? idP?.name ?? null, cols: {}, parentRel: t.parent?.rel || '' };
  });
  const byTable = new Map(base.map(m => [m.tableId, m]));

  // 연결 대상 후보: 이번에 가져오는 표 + 이미 프로젝트에 있는 클래스
  const targets = tables.map(t => {
    const m = byTable.get(t.id), ci = t.columns.indexOf(m.idCol), li = t.columns.indexOf(m.labelCol);
    return {
      target: { kind: 'table', tableId: t.id }, name: m.className, tableId: t.id,
      keys: new Set(ci >= 0 ? t.rows.map(r => r[ci]).filter(Boolean) : []),
      labels: new Set(li >= 0 ? t.rows.map(r => norm(r[li])).filter(Boolean) : []),
      numericKeys: ci >= 0 && profiles.get(t.id)[ci].datatype === 'number',
    };
  });
  for (const ex of existingTargets(project)) {
    if (targets.some(t => norm(t.name) === norm(ex.name))) continue;
    targets.push({ target: { kind: 'class', name: ex.name }, name: ex.name, keys: ex.keys, labels: ex.labels, numericKeys: [...ex.keys].every(k => RE.number.test(k)) });
  }

  for (const t of tables) {
    const m = byTable.get(t.id);
    const profs = profiles.get(t.id);
    for (const p of profs) {
      const col = { role: 'attr', datatype: p.datatype, target: null, matchBy: 'key', rel: stripId(p.name), reason: '' };
      m.cols[p.name] = col;
      if (p.name === m.idCol || (p.name === m.labelCol && !ID_SUFFIX.test(p.name))) { col.role = 'ignore'; col.reason = p.name === m.idCol ? 'ID 열' : '이름 열'; continue; }
      if (!p.nonEmpty) { col.role = 'ignore'; col.reason = '비어 있음'; continue; }

      // 1) 다른 표(또는 같은 표)의 ID·이름을 가리키는 열 → 관계
      let best = null;
      if (!FREE_TEXT.test(p.name) && p.avgLen <= 60) {
        const vals = new Set([...p.parts]);
        const normVals = new Set([...vals].map(norm));
        for (const tg of targets) {
          const hint = nameHint(p.name, tg.name);
          const numeric = p.datatype === 'number';
          const byKey = overlap(vals, tg.keys), byLabel = overlap(normVals, tg.labels);
          const score = Math.max(byKey, byLabel);
          const need = hint ? 0.3 : 0.6;
          if (score < need || (numeric && (!hint || !tg.numericKeys))) continue;
          if (tg.tableId === t.id && (p.unique && !p.multi)) continue;
          const s = score + (hint ? 0.25 : 0);
          if (!best || s > best.s) best = { s, tg, matchBy: byKey >= byLabel ? 'key' : 'label', score };
        }
      }
      if (best) {
        Object.assign(col, { role: 'link', target: best.tg.target, matchBy: best.matchBy, reason: `값의 ${Math.round(best.score * 100)}%가 '${best.tg.name}'의 ${best.matchBy === 'key' ? 'ID' : '이름'}와 일치` });
        continue;
      }
      // 2) 반복되는 범주 값(부서, 상태, 태그 등) → 별도 개념으로 승격
      const ratio = p.distinct / p.nonEmpty;
      // 값 종류가 적거나(≤30), 많더라도 행 수에 비해 충분히 반복되면(≤20%) 범주로 본다. 예) 도시, 고객
      const categorical = p.datatype === 'text' && !FREE_TEXT.test(p.name) && p.avgLen <= 24 && p.nonEmpty >= 4 && p.distinct >= 2 && ratio <= 0.5 && (p.distinct <= 30 || ratio <= 0.2);
      const tagLike = p.datatype === 'text' && p.multi && !FREE_TEXT.test(p.name) && [...p.parts].every(x => x.length <= 30);
      if (categorical || tagLike) {
        Object.assign(col, { role: 'link', target: { kind: 'class', name: stripId(p.name) }, matchBy: 'key', reason: tagLike ? '여러 값을 나눠 담은 열 → 각각 노드로' : `${p.distinct}가지 값이 반복 → 범주 노드로` });
      }
    }

    // 3) 연결표(다대다) 감지: 다른 것 두 개를 잇는 열이 핵심이고 '이름' 열이 없으면 행 = 관계
    const links = Object.entries(m.cols).filter(([, c]) => c.role === 'link' && c.target?.kind === 'table');
    const others = profs.filter(p => p.name !== m.idCol && !m.cols[p.name].target);
    const hasLabel = profs.some(p => LABEL_NAME.test(p.name) && !links.some(([n]) => n === p.name));
    if (links.length >= 2 && others.length <= 3 && !hasLabel && (!m.idCol || ID_NAME.test(m.idCol) || links.some(([n]) => n === m.idCol))) {
      m.mode = 'edges';
      m.from = links[0][0];
      m.to = links[1][0];
      m.edgeRel = defaultClassName(t.name);
      // 연결표의 나머지 열(역할, 날짜 등)은 관계에 붙는 속성이 된다
      for (const [n, c] of Object.entries(m.cols)) {
        if (n === m.from || n === m.to || n === m.idCol) continue;
        if (c.role === 'link' || c.reason === '이름 열') m.cols[n] = { ...c, role: 'attr', target: null, reason: '관계의 속성' };
      }
    }
  }
  return base;
}

// ─────────────────────────────────────────────────────────────
// 매핑대로 표 → 조각(fragment) 만들기
// ─────────────────────────────────────────────────────────────
export function buildFragment(tables, mappings, project) {
  const frag = { classes: [], relTypes: [], entities: [], relations: [], sources: [] };
  const mapOf = new Map(mappings.map(m => [m.tableId, m]));
  const tableOf = new Map(tables.map(t => [t.id, t]));
  const ex = new Map(project.classes.map(c => [norm(c.name), { keys: new Set(), byLabel: new Map() }]));
  const classIdName = new Map(project.classes.map(c => [c.id, norm(c.name)]));
  for (const e of project.entities) {
    const x = ex.get(classIdName.get(e.classId));
    if (x) { x.keys.add(e.key); if (!x.byLabel.has(norm(e.label))) x.byLabel.set(norm(e.label), e.key); }
  }

  const keyOf = (t, m, i) => {
    const ci = m.idCol ? t.columns.indexOf(m.idCol) : -1;
    return (ci >= 0 && t.rows[i][ci]) || `${t.name}#${i + 1}`;
  };
  const labelIdx = new Map();
  const labelToKey = t => {
    if (!labelIdx.has(t.id)) {
      const m = mapOf.get(t.id), li = t.columns.indexOf(m.labelCol), map = new Map();
      if (li >= 0) t.rows.forEach((r, i) => { const n = norm(r[li]); if (n && !map.has(n)) map.set(n, keyOf(t, m, i)); });
      labelIdx.set(t.id, map);
    }
    return labelIdx.get(t.id);
  };

  // 열 값 하나 → 대상 엔티티 참조
  const made = new Set();
  const refFor = (col, value) => {
    const tg = col.target;
    if (tg.kind === 'table') {
      const tt = tableOf.get(tg.tableId), tm = mapOf.get(tg.tableId);
      if (!tt || !tm) return null;
      const key = col.matchBy === 'label' ? labelToKey(tt).get(norm(value)) : value;
      return { class: tm.className, key: key || value, label: value };
    }
    const name = tg.name, x = ex.get(norm(name));
    const key = x ? (x.keys.has(value) ? value : x.byLabel.get(norm(value))) : null;
    if (!key && !made.has(name + '\u0001' + value)) { made.add(name + '\u0001' + value); frag.entities.push({ class: name, key: value, label: value }); }
    return { class: name, key: key || value, label: value };
  };

  // 표에서 온 클래스를 먼저 등록해서 주요 개념이 앞 순서의 색을 받게 한다
  for (const m of mappings) if (m.include && m.mode !== 'edges') frag.classes.push({ name: m.className });

  for (const t of tables) {
    const m = mapOf.get(t.id);
    if (!m?.include) continue;
    const cols = t.columns.map((name, ci) => ({ name, ci, ...m.cols[name] }));
    const lineNo = i => `${t.source}#${i + 2}`;

    if (m.mode === 'edges') {
      const fc = cols.find(c => c.name === m.from), tc = cols.find(c => c.name === m.to);
      if (!fc?.target || !tc?.target) continue;
      const rel = m.edgeRel || t.name;
      t.rows.forEach((r, i) => {
        const props = {};
        for (const c of cols) if (c !== fc && c !== tc && c.role === 'attr' && r[c.ci]) props[c.name] = r[c.ci];
        for (const a of splitMulti(r[fc.ci])) for (const b of splitMulti(r[tc.ci])) {
          const from = refFor(fc, a), to = refFor(tc, b);
          if (from && to) frag.relations.push({ from, type: rel, to, props, src: lineNo(i) });
        }
      });
      frag.sources.push({ name: t.source, kind: 'table', counts: { rows: t.rows.length } });
      continue;
    }

    const li = t.columns.indexOf(m.labelCol);
    const parentT = t.parent && tableOf.get(t.parent.tableId), parentM = parentT && mapOf.get(parentT.id);
    t.rows.forEach((r, i) => {
      const key = keyOf(t, m, i);
      const label = (li >= 0 && r[li]) || key;
      const props = {};
      const me = { class: m.className, key };
      for (const c of cols) {
        const v = r[c.ci];
        if (!v || c.role === 'ignore') continue;
        if (c.role === 'attr') { props[c.name] = v; continue; }
        if (c.role === 'link' && c.target) {
          for (const part of splitMulti(v)) {
            const to = refFor(c, part);
            if (to) frag.relations.push({ from: me, type: c.rel || c.name, to, src: lineNo(i) });
          }
        }
      }
      frag.entities.push({ class: m.className, key, label, props, src: lineNo(i) });
      if (parentT && parentM?.include && t.parentIndex?.[i] >= 0) {
        frag.relations.push({ from: { class: parentM.className, key: keyOf(parentT, parentM, t.parentIndex[i]) }, type: m.parentRel || t.parent.rel, to: me, src: lineNo(i) });
      }
    });
    frag.sources.push({ name: t.source, kind: 'table', counts: { rows: t.rows.length } });
  }
  return frag;
}
