import { useState } from 'react';
import { Icon, LineSwatch, ShapeIcon } from './ui.jsx';

// 그래프에서 노드를 누르면 아래에 뜨는 정보 패널
export default function Inspector({ entity, index, look, setSelected, openEditor, onClose, onPath, onAround }) {
  const [more, setMore] = useState(false);
  const c = look.cls(entity.classId);
  const props = Object.entries(entity.props || {}).filter(([, v]) => v !== '' && v != null);
  const group = list => {
    const m = new Map();
    for (const r of list) { if (!m.has(r.typeId)) m.set(r.typeId, []); m.get(r.typeId).push(r); }
    return [...m.entries()];
  };
  const out = group(index.out.get(entity.id) || []);
  const inc = group(index.inc.get(entity.id) || []);
  const LIMIT = 12;

  const relBlock = (typeId, rs, dir) => {
    const t = look.rel(typeId);
    return (
      <div key={`${dir}${typeId}`} className="rel-group">
        <div className="rel-head"><LineSwatch color={t.color} /><b>{dir === 'out' ? `${t.name} →` : `← ${t.name}`}</b><small>{rs.length}</small></div>
        <div className="rel-items">
          {rs.slice(0, more ? 200 : LIMIT).map(r => {
            const other = index.entity.get(dir === 'out' ? r.to : r.from);
            if (!other) return null;
            const oc = look.cls(other.classId);
            const extra = r.props ? Object.values(r.props).join(', ') : '';
            return (
              <button key={r.id} className="rel-item" onClick={() => setSelected(other.id)} title={r.why || ''}>
                <ShapeIcon shape={oc.shape} color={oc.color} size={12} />
                <span className="ellipsis">{other.label}</span>
                {extra && <small>{extra}</small>}
                {r.inferred && <small className="inferred">추론</small>}
              </button>
            );
          })}
          {!more && rs.length > LIMIT && <button className="rel-item more" onClick={() => setMore(true)}>+{rs.length - LIMIT}개 더</button>}
        </div>
      </div>
    );
  };

  return (
    <section className="dock inspector">
      <header className="dock-head">
        <div className="grow">
          <span className="cls-chip"><ShapeIcon shape={c.shape} color={c.color} size={13} /> {c.name}{entity.stub && ' · 내용 없음'}</span>
          <h3 className="ellipsis">{entity.label}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기"><Icon name="close" /></button>
      </header>
      <div className="dock-actions">
        <button className="btn sm" onClick={() => openEditor(entity.id)}><Icon name="edit" size={16} /> 편집</button>
        <button className="btn sm" onClick={onPath}><Icon name="route" size={16} /> 경로 찾기</button>
        <button className="btn sm" onClick={onAround}><Icon name="sparkle" size={16} /> 주변을 AI로</button>
      </div>
      <div className="dock-body">
        {props.length > 0 && (
          <dl className="props">
            {props.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}
          </dl>
        )}
        {out.map(([tid, rs]) => relBlock(tid, rs, 'out'))}
        {inc.map(([tid, rs]) => relBlock(tid, rs, 'in'))}
        {!out.length && !inc.length && <p className="muted small">아직 연결이 없어요. 편집에서 관계를 추가할 수 있어요.</p>}
        {entity.src?.length > 0 && <p className="src">출처: {entity.src.join(' · ')}</p>}
      </div>
    </section>
  );
}
