import { useState } from 'react';
import { ops, norm } from '../lib/model.js';
import { EntityPicker, Icon, LineSwatch, ShapeIcon, Sheet, Segmented } from './ui.jsx';

// 엔티티 하나 편집: 이름·개념·속성 + 관계 추가/삭제
export default function EntityEditor({ project, index, look, apply, target, onClose }) {
  const isNew = typeof target !== 'string';
  const base = isNew ? { classId: target.classId || project.classes[0]?.id || '__new', label: '', props: {} } : project.entities.find(e => e.id === target);
  const [label, setLabel] = useState(base?.label || '');
  const [classId, setClassId] = useState(base?.classId || '__new');
  const [newClass, setNewClass] = useState('');
  const [props, setProps] = useState(() => Object.entries(base?.props || {}).map(([k, v]) => ({ k, v: String(v) })));
  const [relType, setRelType] = useState(project.relTypes[0]?.id || '__new');
  const [newRel, setNewRel] = useState('');
  const [dir, setDir] = useState('out');

  if (!base) return null;

  const save = () => {
    if (!label.trim()) return;
    apply(p => {
      let cur = p, cid = classId;
      if (cid === '__new') {
        if (!newClass.trim()) return p;
        cur = ops.addClass(cur, newClass.trim());
        cid = cur.classes.find(c => norm(c.name) === norm(newClass.trim())).id;
      }
      const clean = Object.fromEntries(props.filter(x => x.k.trim()).map(x => [x.k.trim(), x.v]));
      return ops.saveEntity(cur, { ...(isNew ? {} : { id: base.id }), classId: cid, label: label.trim(), props: clean });
    }, isNew ? '엔티티를 추가했어요' : '저장했어요');
    onClose();
  };

  const addRelation = e => {
    apply(p => {
      let cur = p, tid = relType;
      if (tid === '__new') {
        if (!newRel.trim()) return p;
        cur = ops.addRelType(cur, newRel.trim());
        tid = cur.relTypes.find(t => norm(t.name) === norm(newRel.trim())).id;
      }
      return dir === 'out' ? ops.addRelation(cur, base.id, tid, e.id) : ops.addRelation(cur, e.id, tid, base.id);
    }, '관계를 추가했어요');
  };

  const rels = isNew ? [] : [
    ...(index.out.get(base.id) || []).filter(r => !r.inferred).map(r => ({ r, other: r.to, out: true })),
    ...(index.inc.get(base.id) || []).filter(r => !r.inferred).map(r => ({ r, other: r.from, out: false })),
  ];

  return (
    <Sheet
      title={isNew ? '엔티티 추가' : '엔티티 편집'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn ghost danger" onClick={() => { if (window.confirm(`'${base.label}'과 연결을 모두 지울까요?`)) { apply(p => ops.deleteEntities(p, [base.id]), '지웠어요'); onClose(); } }}>
              <Icon name="trash" size={18} /> 삭제
            </button>
          )}
          <button className="btn primary grow" onClick={save} disabled={!label.trim() || (classId === '__new' && !newClass.trim())}>저장</button>
        </>
      }
    >
      <label className="field"><span>이름</span><input value={label} onChange={e => setLabel(e.target.value)} autoFocus={isNew} /></label>
      <label className="field"><span>개념(클래스)</span>
        <select value={classId} onChange={e => setClassId(e.target.value)}>
          {project.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="__new">+ 새 개념</option>
        </select>
      </label>
      {classId === '__new' && <label className="field"><span>새 개념 이름</span><input value={newClass} onChange={e => setNewClass(e.target.value)} placeholder="예: 회사" /></label>}

      <h4 className="label">속성</h4>
      <ul className="kv">
        {props.map((x, i) => (
          <li key={i}>
            <input value={x.k} placeholder="이름" onChange={e => setProps(ps => ps.map((y, j) => (j === i ? { ...y, k: e.target.value } : y)))} aria-label="속성 이름" />
            <input value={x.v} placeholder="값" onChange={e => setProps(ps => ps.map((y, j) => (j === i ? { ...y, v: e.target.value } : y)))} aria-label="속성 값" />
            <button className="icon-btn sm" onClick={() => setProps(ps => ps.filter((_, j) => j !== i))} aria-label="속성 지우기"><Icon name="close" size={16} /></button>
          </li>
        ))}
      </ul>
      <button className="btn sm ghost" onClick={() => setProps(ps => [...ps, { k: '', v: '' }])}><Icon name="plus" size={16} /> 속성 추가</button>

      {!isNew && (
        <>
          <h4 className="label">관계 <small>바로 반영돼요</small></h4>
          <ul className="list">
            {rels.map(({ r, other, out }) => {
              const o = index.entity.get(other), t = look.rel(r.typeId), oc = look.cls(o?.classId);
              return (
                <li key={r.id}>
                  <LineSwatch color={t.color} />
                  <span className="grow ellipsis">{out ? `${t.name} → ` : `← ${t.name} · `}<ShapeIcon shape={oc.shape} color={oc.color} size={12} /> {o?.label}</span>
                  <button className="icon-btn sm" onClick={() => apply(p => ops.deleteRelation(p, r.id), '관계를 지웠어요')} aria-label="관계 지우기"><Icon name="trash" size={16} /></button>
                </li>
              );
            })}
          </ul>
          <div className="add-rel">
            <Segmented small value={dir} onChange={setDir} options={[{ value: 'out', label: `${base.label} → 대상` }, { value: 'in', label: `대상 → ${base.label}` }]} />
            <label className="field small"><span>관계 종류</span>
              <select value={relType} onChange={e => setRelType(e.target.value)}>
                {project.relTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                <option value="__new">+ 새 관계 종류</option>
              </select>
            </label>
            {relType === '__new' && <label className="field small"><span>새 관계 이름</span><input value={newRel} onChange={e => setNewRel(e.target.value)} placeholder="예: 협업" /></label>}
            <EntityPicker project={project} look={look} exclude={base.id} onPick={addRelation} placeholder="연결할 대상 찾기" />
          </div>
        </>
      )}
    </Sheet>
  );
}
