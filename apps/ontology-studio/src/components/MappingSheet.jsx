import { useMemo, useState } from 'react';
import { proposeMappings, buildFragment } from '../lib/infer.js';
import { norm } from '../lib/model.js';
import { Icon, Sheet, Segmented } from './ui.jsx';

const TYPE_KO = { text: '글', number: '숫자', date: '날짜', boolean: '참/거짓', url: '링크', email: '이메일' };
const ROLE = [{ value: 'attr', label: '속성' }, { value: 'link', label: '연결' }, { value: 'ignore', label: '무시' }];

// 2단계 · 형식화: 자동으로 추측한 표 해석을 확인하고 고친다
export default function MappingSheet({ res, project, onCancel, onConfirm }) {
  const [mappings, setMappings] = useState(() => proposeMappings(res.tables, project));
  const [open, setOpen] = useState(0);

  const preview = useMemo(() => {
    const frag = buildFragment(res.tables, mappings, project);
    const keys = new Set(frag.entities.map(e => `${norm(e.class)}|${e.key}`));
    return { entities: keys.size, relations: frag.relations.length, classes: new Set(frag.entities.map(e => norm(e.class))).size, types: new Set(frag.relations.map(r => norm(r.type))).size };
  }, [res.tables, mappings, project]);

  const update = (tableId, patch) => setMappings(ms => ms.map(m => (m.tableId === tableId ? { ...m, ...patch } : m)));
  const updateCol = (tableId, col, patch) => setMappings(ms => ms.map(m => (m.tableId === tableId ? { ...m, cols: { ...m.cols, [col]: { ...m.cols[col], ...patch } } } : m)));

  const others = res.fragments.reduce((s, f) => s + (f.fragment.entities?.length || 0), 0);
  const included = mappings.filter(m => m.include).length;

  return (
    <Sheet
      full
      title="2단계 · 형식화 확인"
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>취소</button>
          <button className="btn primary grow" disabled={!included && !others} onClick={() => onConfirm(res.tables, mappings)}>
            <Icon name="check" /> 가져오기
          </button>
        </>
      }
    >
      <div className="summary">
        <p>표 {res.tables.length}개를 이렇게 해석했어요. 틀린 곳만 고치면 돼요.</p>
        <ul className="stats">
          <li><b>{preview.classes}</b>개념</li>
          <li><b>{preview.entities}</b>엔티티</li>
          <li><b>{preview.types}</b>관계 종류</li>
          <li><b>{preview.relations}</b>관계</li>
        </ul>
        {others > 0 && <p className="muted small">표가 아닌 문서·파일에서 나온 항목 {others}개도 함께 가져와요.</p>}
        {res.warnings.map((w, i) => <p key={i} className="warn small">⚠ {w}</p>)}
      </div>

      {res.tables.map((t, ti) => {
        const m = mappings.find(x => x.tableId === t.id);
        return (
          <TableCard key={t.id} t={t} m={m} open={open === ti} onToggle={() => setOpen(open === ti ? -1 : ti)}
            tables={res.tables} mappings={mappings} project={project} update={p => update(t.id, p)} updateCol={(c, p) => updateCol(t.id, c, p)} />
        );
      })}
    </Sheet>
  );
}

function TableCard({ t, m, open, onToggle, tables, mappings, project, update, updateCol }) {
  const mapOf = id => mappings.find(x => x.tableId === id);
  const targetOptions = [
    ...tables.filter(x => mapOf(x.id)?.mode !== 'edges').map(x => ({ value: `table:${x.id}`, label: `${mapOf(x.id)?.className} (이번 표)` })),
    ...project.classes.filter(c => !tables.some(x => norm(mapOf(x.id)?.className) === norm(c.name))).map(c => ({ value: `class:${c.name}`, label: `${c.name} (기존)` })),
  ];
  const targetValue = col => (col.target?.kind === 'table' ? `table:${col.target.tableId}` : col.target ? `class:${col.target.name}` : '');
  const isNewClass = col => col.target?.kind === 'class' && !targetOptions.some(o => o.value === `class:${col.target.name}`);
  const setTarget = (name, v) => {
    if (v === '__new') return updateCol(name, { target: { kind: 'class', name }, matchBy: 'key' });
    const [kind, rest] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    updateCol(name, { target: kind === 'table' ? { kind, tableId: rest } : { kind, name: rest } });
  };
  const sample = (ci) => [...new Set(t.rows.map(r => r[ci]).filter(Boolean))].slice(0, 3).join(' · ');

  const edges = m.mode === 'edges';
  const hidden = c => !edges && (c === m.idCol || c === m.labelCol) && m.cols[c]?.role === 'ignore';

  return (
    <section className={`tcard ${m.include ? '' : 'off'}`}>
      <header className="tcard-head">
        <label className="check">
          <input type="checkbox" checked={m.include} onChange={e => update({ include: e.target.checked })} />
        </label>
        <button className="grow tcard-title" onClick={onToggle} aria-expanded={open}>
          <b className="ellipsis">{edges ? `관계: ${m.edgeRel}` : m.className}</b>
          <small className="ellipsis">{t.source} · {t.rows.length.toLocaleString()}행 · {edges ? '연결표' : '엔티티 목록'}</small>
        </button>
        <Icon name="chevron" className={`rot ${open ? 'on' : ''}`} />
      </header>

      {open && m.include && (
        <div className="tcard-body">
          <Segmented small value={m.mode} onChange={mode => update(mode === 'edges' ? { mode, from: m.from || t.columns[0], to: m.to || t.columns[1], edgeRel: m.edgeRel || m.className } : { mode })}
            options={[{ value: 'entities', label: '한 행 = 엔티티 하나' }, { value: 'edges', label: '한 행 = 관계 하나' }]} />

          {!edges ? (
            <div className="form-grid">
              <label className="field"><span>개념(클래스) 이름</span><input value={m.className} onChange={e => update({ className: e.target.value })} /></label>
              <label className="field"><span>고유 ID 열</span>
                <select value={m.idCol ?? ''} onChange={e => {
                  const v = e.target.value || null;
                  const cols = { ...m.cols };
                  if (m.idCol && cols[m.idCol]?.reason === 'ID 열') cols[m.idCol] = { ...cols[m.idCol], role: 'attr', reason: '' };
                  if (v) cols[v] = { ...cols[v], role: 'ignore', reason: 'ID 열' };
                  update({ idCol: v, cols });
                }}>
                  <option value="">(행 번호로 구분)</option>
                  {t.columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field"><span>이름(표시) 열</span>
                <select value={m.labelCol ?? ''} onChange={e => {
                  const v = e.target.value || null;
                  const cols = { ...m.cols };
                  if (m.labelCol && cols[m.labelCol]?.reason === '이름 열') cols[m.labelCol] = { ...cols[m.labelCol], role: 'attr', reason: '' };
                  if (v && v !== m.idCol) cols[v] = { ...cols[v], role: 'ignore', reason: '이름 열' };
                  update({ labelCol: v, cols });
                }}>
                  <option value="">(ID 를 이름으로)</option>
                  {t.columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
          ) : (
            <div className="form-grid">
              <label className="field"><span>관계 이름</span><input value={m.edgeRel || ''} onChange={e => update({ edgeRel: e.target.value })} /></label>
              <label className="field"><span>출발 열</span>
                <select value={m.from} onChange={e => update({ from: e.target.value })}>{t.columns.map(c => <option key={c}>{c}</option>)}</select>
              </label>
              <label className="field"><span>도착 열</span>
                <select value={m.to} onChange={e => update({ to: e.target.value })}>{t.columns.map(c => <option key={c}>{c}</option>)}</select>
              </label>
              <p className="muted small">출발·도착 열은 아래에서 ‘연결’로 두고 무엇을 가리키는지 고르세요. 나머지 ‘속성’ 열은 관계에 붙어요(예: 역할).</p>
            </div>
          )}

          <ul className="cols">
            {t.columns.map((c, ci) => {
              if (hidden(c)) return null;
              const col = m.cols[c];
              return (
                <li key={c} className={`col role-${col.role}`}>
                  <div className="col-top">
                    <div className="grow col-name">
                      <b className="ellipsis">{c}</b>
                      <small className="ellipsis">{TYPE_KO[col.datatype] || col.datatype} · {sample(ci) || '비어 있음'}</small>
                    </div>
                    <select className="role" value={col.role} onChange={e => {
                      const role = e.target.value;
                      updateCol(c, role === 'link' && !col.target ? { role, target: { kind: 'class', name: col.rel || c }, matchBy: 'key' } : { role });
                    }} aria-label={`${c} 역할`}>
                      {ROLE.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  {col.role === 'link' && (
                    <div className="col-link">
                      <label className="field small"><span>가리키는 대상</span>
                        <select value={isNewClass(col) ? '__new' : targetValue(col)} onChange={e => setTarget(c, e.target.value)}>
                          {targetOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          <option value="__new">새 개념으로 만들기</option>
                        </select>
                      </label>
                      {isNewClass(col) && (
                        <label className="field small"><span>새 개념 이름</span>
                          <input value={col.target.name} onChange={e => updateCol(c, { target: { kind: 'class', name: e.target.value } })} />
                        </label>
                      )}
                      {!edges && (
                        <label className="field small"><span>관계 이름</span><input value={col.rel} onChange={e => updateCol(c, { rel: e.target.value })} /></label>
                      )}
                      {col.target?.kind === 'table' && (
                        <label className="field small"><span>무엇으로 찾을까</span>
                          <select value={col.matchBy} onChange={e => updateCol(c, { matchBy: e.target.value })}>
                            <option value="key">ID 로</option>
                            <option value="label">이름으로</option>
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                  {col.reason && <small className="reason">자동: {col.reason}</small>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
