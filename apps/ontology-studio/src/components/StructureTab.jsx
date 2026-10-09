import { useMemo, useState } from 'react';
import { ops, norm } from '../lib/model.js';
import { SHAPES, SLOTS } from '../lib/palette.js';
import { classProps, typeUsage } from '../lib/graph.js';
import { detectType } from '../lib/infer.js';
import { checkQuality } from '../lib/quality.js';
import { Icon, LineSwatch, ShapeIcon, Segmented, Toggle, Sheet, copyText } from './ui.jsx';

const TYPE_KO = { text: '글', number: '숫자', date: '날짜', boolean: '참/거짓', url: '링크', email: '이메일' };

export default function StructureTab(props) {
  const [seg, setSeg] = useState('classes');
  const issues = useMemo(() => checkQuality(props.project, props.index), [props.project, props.index]);
  const warn = issues.filter(i => i.level === 'warn').length;
  return (
    <div className="page">
      <Segmented value={seg} onChange={setSeg} options={[
        { value: 'classes', label: `개념 ${props.project.classes.length}` },
        { value: 'types', label: `관계 ${props.project.relTypes.length}` },
        { value: 'entities', label: '엔티티' },
        { value: 'quality', label: warn ? `품질 ⚠${warn}` : '품질' },
      ]} />
      {seg === 'classes' && <Classes {...props} />}
      {seg === 'types' && <Types {...props} />}
      {seg === 'entities' && <Entities {...props} />}
      {seg === 'quality' && <Quality {...props} issues={issues} goto={setSeg} />}
    </div>
  );
}

function Swatches({ value, mode, onPick }) {
  const custom = typeof value === 'string' && value.startsWith('#');
  return (
    <div className="swatches">
      {SLOTS[mode].map((hex, i) => (
        <button key={i} className={`sw ${value === `slot:${i}` ? 'on' : ''}`} style={{ background: hex }} onClick={() => onPick(`slot:${i}`)} aria-label={`색 ${i + 1}`} />
      ))}
      <label className={`sw custom ${custom ? 'on' : ''}`} style={custom ? { background: value } : undefined} aria-label="직접 고르기">
        <input type="color" defaultValue={custom ? value : '#888888'} onBlur={e => onPick(e.target.value)} />
        {!custom && '+'}
      </label>
    </div>
  );
}

// 입력을 마칠 때(포커스가 빠질 때)만 저장해서 되돌리기 기록이 글자마다 쌓이지 않게
function Commit({ value, onCommit, multiline, ...rest }) {
  const [v, setV] = useState(value ?? '');
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setV(value ?? ''); }
  const done = () => { if ((v ?? '') !== (value ?? '')) onCommit(v); };
  const Tag = multiline ? 'textarea' : 'input';
  return <Tag value={v} onChange={e => setV(e.target.value)} onBlur={done} onKeyDown={e => { if (!multiline && e.key === 'Enter') e.currentTarget.blur(); }} {...rest} />;
}

function Classes({ project, look, apply, openEditor }) {
  const [open, setOpen] = useState(null);
  const { props, count } = useMemo(() => classProps(project), [project]);
  const add = () => { const n = window.prompt('새 개념 이름 (예: 회사, 장소, 제품)'); if (n?.trim()) apply(p => ops.addClass(p, n.trim()), '개념을 추가했어요'); };
  return (
    <>
      <p className="muted small">개념(클래스)은 데이터의 ‘종류’예요. 설명을 적어 두면 AI 내보내기에 정의로 함께 들어가요.</p>
      {project.classes.map(c => {
        const l = look.cls(c.id), isOpen = open === c.id, pm = props.get(c.id) || new Map(), n = count.get(c.id) || 0;
        return (
          <section key={c.id} className={`card ${isOpen ? 'open' : ''}`}>
            <button className="card-head" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
              <ShapeIcon shape={l.shape} color={l.color} size={20} />
              <span className="grow"><b>{c.name}</b>{c.description && <small className="ellipsis block">{c.description}</small>}</span>
              <small>{n}개</small>
              <Icon name="chevron" className={`rot ${isOpen ? 'on' : ''}`} />
            </button>
            {isOpen && (
              <div className="card-body">
                <label className="field"><span>이름</span><Commit value={c.name} onCommit={v => v.trim() && apply(p => ops.updateClass(p, c.id, { name: v.trim() }))} /></label>
                <label className="field"><span>설명(정의)</span><Commit multiline rows={2} value={c.description} placeholder="예: 회사에 소속된 직원" onCommit={v => apply(p => ops.updateClass(p, c.id, { description: v.trim() }))} /></label>
                <div className="field"><span>색</span><Swatches value={c.color} mode={look.mode} onPick={color => apply(p => ops.updateClass(p, c.id, { color }))} /></div>
                <label className="field"><span>3D 모양</span>
                  <select value={l.shape} onChange={e => apply(p => ops.updateClass(p, c.id, { shape: Number(e.target.value) }))}>
                    {SHAPES.map((s, i) => <option key={i} value={i}>{s}</option>)}
                  </select>
                </label>
                {pm.size > 0 && (
                  <>
                    <h4 className="label">속성 <small>반복되는 값은 노드로 승격하면 연결이 생겨요</small></h4>
                    <ul className="list">
                      {[...pm.entries()].map(([k, vals]) => (
                        <li key={k}>
                          <span className="grow ellipsis"><b>{k}</b> <small>{TYPE_KO[detectType(vals)]} · {Math.round((vals.length / n) * 100)}% 채움 · {new Set(vals).size}가지</small></span>
                          <button className="btn sm ghost" onClick={() => {
                            const rel = window.prompt(`'${k}' 값을 노드로 만들어 연결할게요. 관계 이름은?`, k);
                            if (rel?.trim()) apply(p => ops.promoteProperty(p, c.id, k, k, rel.trim()), `'${k}'을(를) 노드로 승격했어요`);
                          }}>노드로</button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="row wrap">
                  <button className="btn sm" onClick={() => openEditor({ classId: c.id })}><Icon name="plus" size={16} /> 엔티티 추가</button>
                  <select className="btn sm" value="" onChange={e => { const to = e.target.value; const t = project.classes.find(x => x.id === to); if (t && window.confirm(`'${c.name}'의 엔티티를 모두 '${t.name}'(으)로 옮기고 합칠까요?`)) apply(p => ops.mergeClass(p, c.id, to), '개념을 합쳤어요'); }} aria-label="다른 개념과 합치기">
                    <option value="">다른 개념과 합치기…</option>
                    {project.classes.filter(x => x.id !== c.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <button className="btn sm ghost danger" onClick={() => { if (window.confirm(`'${c.name}'과 엔티티 ${n}개를 지울까요?`)) apply(p => ops.deleteClass(p, c.id), '개념을 지웠어요'); }}><Icon name="trash" size={16} /> 삭제</button>
                </div>
              </div>
            )}
          </section>
        );
      })}
      <button className="btn ghost" onClick={add}><Icon name="plus" /> 개념 추가</button>
    </>
  );
}

function Types({ project, index, look, apply }) {
  const [open, setOpen] = useState(null);
  const usage = useMemo(() => typeUsage(index), [index]);
  const cname = id => index.cls.get(id)?.name || '?';
  const add = () => { const n = window.prompt('새 관계 이름 (예: 협업, 위치, 원인)'); if (n?.trim()) apply(p => ops.addRelType(p, n.trim()), '관계 종류를 추가했어요'); };
  return (
    <>
      <p className="muted small">선 색 = 관계 종류예요. 대칭·전이·역관계를 정하면 숨은 관계를 추론할 수 있어요(그래프 보기 설정에서 켜기).</p>
      {project.relTypes.map(t => {
        const l = look.rel(t.id), isOpen = open === t.id, u = usage.get(t.id) || new Map();
        const n = [...u.values()].reduce((a, b) => a + b, 0);
        const top = [...u.entries()].sort((a, b) => b[1] - a[1]);
        const pairs = top.slice(0, 3).map(([k, c]) => `${k.split('>').map(cname).join(' → ')} (${c})`).join(' · ');
        return (
          <section key={t.id} className={`card ${isOpen ? 'open' : ''}`}>
            <button className="card-head" onClick={() => setOpen(isOpen ? null : t.id)} aria-expanded={isOpen}>
              <LineSwatch color={l.color} />
              <span className="grow"><b>{t.name}</b><small className="ellipsis block">{pairs || '아직 안 쓰임'}</small></span>
              <small>{n}개</small>
              <Icon name="chevron" className={`rot ${isOpen ? 'on' : ''}`} />
            </button>
            {isOpen && (
              <div className="card-body">
                <label className="field"><span>이름</span><Commit value={t.name} onCommit={v => v.trim() && apply(p => ops.updateRelType(p, t.id, { name: v.trim() }))} /></label>
                <label className="field"><span>설명(정의)</span><Commit multiline rows={2} value={t.description} placeholder="예: 사람이 속한 팀" onCommit={v => apply(p => ops.updateRelType(p, t.id, { description: v.trim() }))} /></label>
                <div className="field"><span>선 색</span><Swatches value={t.color} mode={look.mode} onPick={color => apply(p => ops.updateRelType(p, t.id, { color }))} /></div>
                <div className="form-grid">
                  <label className="field small"><span>출발 규칙</span>
                    <select value={t.domain || ''} onChange={e => apply(p => ops.updateRelType(p, t.id, { domain: e.target.value || null }))}>
                      <option value="">아무 개념</option>
                      {project.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className="field small"><span>도착 규칙</span>
                    <select value={t.range || ''} onChange={e => apply(p => ops.updateRelType(p, t.id, { range: e.target.value || null }))}>
                      <option value="">아무 개념</option>
                      {project.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                </div>
                {top.length > 0 && !t.domain && !t.range && (
                  <button className="btn sm ghost" onClick={() => { const [a, b] = top[0][0].split('>'); apply(p => ops.updateRelType(p, t.id, { domain: a, range: b }), '실제 쓰임대로 규칙을 정했어요'); }}>
                    가장 많이 쓰인 조합으로 규칙 정하기
                  </button>
                )}
                <div className="toggles">
                  <Toggle checked={t.symmetric} onChange={symmetric => apply(p => ops.updateRelType(p, t.id, { symmetric }))} label="대칭" hint="A→B 이면 B→A 도 (예: 동료, 형제)" />
                  <Toggle checked={t.transitive} onChange={transitive => apply(p => ops.updateRelType(p, t.id, { transitive }))} label="전이" hint="A→B, B→C 이면 A→C (예: 상위분류, 선행)" />
                </div>
                <label className="field small"><span>역관계 (반대 방향 이름)</span>
                  <select value={t.inverseOf || ''} onChange={e => apply(p => ops.updateRelType(p, t.id, { inverseOf: e.target.value || null }))}>
                    <option value="">없음</option>
                    {project.relTypes.filter(x => x.id !== t.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
                <div className="row wrap">
                  <select className="btn sm" value="" onChange={e => { const to = e.target.value; const x = project.relTypes.find(y => y.id === to); if (x && window.confirm(`'${t.name}' 관계를 모두 '${x.name}'(으)로 바꿀까요?`)) apply(p => ops.mergeRelType(p, t.id, to), '관계 종류를 합쳤어요'); }} aria-label="다른 관계와 합치기">
                    <option value="">다른 관계와 합치기…</option>
                    {project.relTypes.filter(x => x.id !== t.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <button className="btn sm ghost danger" onClick={() => { if (window.confirm(`'${t.name}' 관계 ${n}개를 지울까요?`)) apply(p => ops.deleteRelType(p, t.id), '관계 종류를 지웠어요'); }}><Icon name="trash" size={16} /> 삭제</button>
                </div>
              </div>
            )}
          </section>
        );
      })}
      <button className="btn ghost" onClick={add}><Icon name="plus" /> 관계 종류 추가</button>
    </>
  );
}

function Entities({ project, index, look, openEditor, setSelected, setTab }) {
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('');
  const [limit, setLimit] = useState(100);
  const list = useMemo(() => {
    const n = norm(q);
    return project.entities.filter(e => (!cls || e.classId === cls) && (!n || norm(e.label).includes(n) || norm(e.key).includes(n)));
  }, [project, q, cls]);
  return (
    <>
      <div className="row">
        <div className="search grow"><Icon name="search" size={18} /><input value={q} onChange={e => { setQ(e.target.value); setLimit(100); }} placeholder="이름·ID 찾기" /></div>
        <select value={cls} onChange={e => setCls(e.target.value)} aria-label="개념으로 거르기" className="btn sm">
          <option value="">전체</option>
          {project.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <p className="muted small">{list.length.toLocaleString()}개 · 누르면 편집, ◎ 는 3D 에서 보기</p>
      <ul className="list rows">
        {list.slice(0, limit).map(e => {
          const c = look.cls(e.classId);
          return (
            <li key={e.id}>
              <button className="grow row-btn" onClick={() => openEditor(e.id)}>
                <ShapeIcon shape={c.shape} color={c.color} size={14} />
                <span className="grow ellipsis">{e.label}{e.stub && <small> · 내용 없음</small>}</span>
                <small>{c.name} · 연결 {index.degree(e.id)}</small>
              </button>
              <button className="icon-btn sm" onClick={() => { setSelected(e.id); setTab('graph'); }} aria-label="3D 에서 보기">◎</button>
            </li>
          );
        })}
      </ul>
      {list.length > limit && <button className="btn ghost" onClick={() => setLimit(l => l + 200)}>더 보기</button>}
      <button className="btn ghost" onClick={() => openEditor({ classId: cls || project.classes[0]?.id })}><Icon name="plus" /> 엔티티 추가</button>
    </>
  );
}

function Quality({ project, index, look, apply, issues, openEditor, goto, toast }) {
  const [descSheet, setDescSheet] = useState(false);
  if (!project.entities.length) return <p className="muted">데이터를 가져오면 품질을 검사해요.</p>;
  if (!issues.length) return <section className="panel"><h3>✔ 정리할 것이 없어요</h3><p className="muted small">중복·고립·규칙 위반이 없고, 모든 개념과 관계에 설명이 있어요.</p></section>;
  return (
    <>
      <p className="muted small">AI 가 데이터를 정확히 이해하도록 정리할 거리를 찾았어요.</p>
      {issues.map(is => (
        <section key={is.id} className={`panel issue ${is.level}`}>
          <h3>{is.level === 'warn' ? '⚠' : is.level === 'tip' ? '💡' : 'ℹ'} {is.title}</h3>
          <p className="muted small">{is.detail}</p>
          {is.groups && is.groups.slice(0, 15).map((g, gi) => <DupGroup key={gi} g={g} index={index} look={look} apply={apply} />)}
          {is.entities && (
            <div className="chips">
              {is.entities.slice(0, 24).map(e => <button key={e.id} className="chip" onClick={() => openEditor(e.id)}>{e.label}</button>)}
            </div>
          )}
          {is.id === 'orphan' && (
            <button className="btn sm ghost danger" onClick={() => { if (window.confirm('연결 없는 엔티티를 모두 지울까요?')) apply(p => ops.deleteEntities(p, p.entities.filter(e => index.degree(e.id) === 0).map(e => e.id)), '연결 없는 엔티티를 지웠어요'); }}>모두 지우기</button>
          )}
          {is.id === 'desc' && (
            <div className="row wrap">
              <button className="btn sm" onClick={() => setDescSheet(true)}><Icon name="sparkle" size={16} /> AI 에게 정의 초안 받기</button>
              <button className="btn sm ghost" onClick={() => goto('classes')}>직접 쓰기</button>
            </div>
          )}
        </section>
      ))}
      {descSheet && <DescSheet project={project} index={index} apply={apply} toast={toast} onClose={() => setDescSheet(false)} />}
    </>
  );
}

function DupGroup({ g, index, look, apply }) {
  const sorted = g.items.slice().sort((a, b) => index.degree(b.id) - index.degree(a.id));
  const [keep, setKeep] = useState(sorted[0].id);
  return (
    <div className="dup">
      {sorted.map(e => {
        const c = look.cls(e.classId);
        return (
          <label key={e.id} className="dup-item">
            <input type="radio" checked={keep === e.id} onChange={() => setKeep(e.id)} />
            <ShapeIcon shape={c.shape} color={c.color} size={13} />
            <span className="grow ellipsis">{e.label}</span>
            <small>{c.name} · 연결 {index.degree(e.id)}</small>
          </label>
        );
      })}
      <button className="btn sm" onClick={() => apply(p => ops.mergeEntities(p, keep, sorted.map(e => e.id)), '하나로 합쳤어요')}><Icon name="merge" size={16} /> 선택한 것으로 합치기</button>
    </div>
  );
}

// AI 에게 개념·관계 정의 초안을 받아 한 번에 채우기
function DescSheet({ project, index, apply, toast, onClose }) {
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState('');
  const examples = id => project.entities.filter(e => e.classId === id).slice(0, 4).map(e => e.label).join(', ');
  const usage = typeUsage(index);
  const prompt = `아래 지식 그래프 스키마의 각 개념(클래스)과 관계에 한국어 한 줄 정의를 써 주세요.
정의는 "무엇인지"를 중립적으로, 30자 안팎으로. 답은 JSON 하나만:
{"classes":[{"name":"","description":""}],"relationTypes":[{"name":"","description":""}]}

<classes>
${project.classes.map(c => `- ${c.name} (예: ${examples(c.id)})`).join('\n')}
</classes>
<relations>
${project.relTypes.map(t => `- ${t.name}: ${[...(usage.get(t.id) || new Map()).keys()].slice(0, 2).map(k => k.split('>').map(x => index.cls.get(x)?.name).join(' → ')).join(', ')}`).join('\n')}
</relations>`;
  const submit = () => {
    try {
      const s = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
      const d = JSON.parse(s);
      const byC = new Map((d.classes || []).map(x => [norm(x.name), x.description]));
      const byT = new Map((d.relationTypes || d.relations || []).map(x => [norm(x.name), x.description]));
      apply(p => ({
        ...p,
        classes: p.classes.map(c => (byC.get(norm(c.name)) && !c.description ? { ...c, description: String(byC.get(norm(c.name))) } : c)),
        relTypes: p.relTypes.map(t => (byT.get(norm(t.name)) && !t.description ? { ...t, description: String(byT.get(norm(t.name))) } : t)),
        updatedAt: Date.now(),
      }), '정의를 채웠어요');
      onClose();
    } catch { setErr('JSON 을 읽지 못했어요. AI 답 전체를 붙여넣어 주세요.'); }
  };
  return (
    <Sheet title="AI 에게 정의 초안 받기" onClose={onClose} footer={<button className="btn primary grow" disabled={!answer.trim()} onClick={submit}>정의 채우기</button>}>
      <ol className="steps">
        <li><b>프롬프트 복사 → Claude 앱에 붙여넣기</b>
          <button className="btn" onClick={async () => toast((await copyText(prompt)) ? '복사했어요' : '복사하지 못했어요')}><Icon name="copy" /> 프롬프트 복사</button>
        </li>
        <li><b>답을 붙여넣기</b><small>비어 있는 설명만 채우고, 이미 쓴 설명은 그대로 둬요.</small>
          <textarea rows={6} value={answer} onChange={e => { setAnswer(e.target.value); setErr(''); }} />
          {err && <p className="warn">⚠ {err}</p>}
        </li>
      </ol>
    </Sheet>
  );
}

