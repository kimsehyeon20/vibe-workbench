import { useEffect, useMemo, useRef, useState } from 'react';
import { neighborhood, shortestPath, communities } from '../lib/graph.js';
import { makeView, toPrompt } from '../lib/export.js';
import { norm } from '../lib/model.js';
import Inspector from './Inspector.jsx';
import { Icon, LineSwatch, ShapeIcon, Sheet, Segmented, Toggle, copyText } from './ui.jsx';

const MAX_NODES = 2500;
const LAYOUTS = [
  { value: 'force', label: '자유' },
  { value: 'cluster', label: '개념별' },
  { value: 'community', label: '연결 묶음' },
  { value: 'dag', label: '계층' },
  { value: 'radial', label: '방사형' },
];

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export default function GraphTab(props) {
  const { project, index, look, selected, setSelected, view, setView, toast, setTab, active, inferredCount } = props;
  const elRef = useRef(null);
  const gvRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState('');
  const [spot, setSpot] = useState(null);
  const [pathFrom, setPathFrom] = useState(null);
  const [path, setPath] = useState(null);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState('');
  const lastLayout = useRef(null);

  // ── 3D 화면 만들기(three.js 는 필요할 때만 불러온다) ──
  const handlers = useRef({});
  useEffect(() => {
    if (!hasWebGL()) { setFailed('이 기기·브라우저에서 3D(WebGL)를 쓸 수 없어요.'); return undefined; }
    let gv = null, dead = false;
    import('../lib/graph3d.js').then(({ GraphView }) => {
      if (dead || !elRef.current) return;
      try {
        gv = new GraphView(elRef.current, {
          onNodeClick: id => handlers.current.node(id),
          onBackgroundClick: () => handlers.current.bg(),
          onDagError: () => handlers.current.dag(),
        });
        gvRef.current = gv;
        setReady(true);
      } catch (e) { setFailed(`3D 화면을 만들지 못했어요: ${e.message}`); }
    }).catch(e => setFailed(`3D 모듈을 불러오지 못했어요: ${e.message}`));
    return () => { dead = true; gv?.destroy(); gvRef.current = null; };
  }, []);

  const groups = useMemo(() => (view.layout === 'community' ? communities(index) : null), [index, view.layout]);

  // ── 화면에 넣을 노드·연결선 만들기 ──
  const data = useMemo(() => {
    const hiddenC = new Set(view.hiddenClasses), hiddenT = new Set(view.hiddenTypes);
    let ents = project.entities.filter(e => !hiddenC.has(e.classId));
    let ids = new Set(ents.map(e => e.id));
    let rels = index.relations.filter(r => !hiddenT.has(r.typeId) && ids.has(r.from) && ids.has(r.to));
    if (view.hideOrphans) {
      const linked = new Set();
      for (const r of rels) { linked.add(r.from); linked.add(r.to); }
      ents = ents.filter(e => linked.has(e.id));
    }
    let capped = 0;
    if (ents.length > MAX_NODES) {
      capped = ents.length;
      ents = ents.slice().sort((a, b) => index.degree(b.id) - index.degree(a.id)).slice(0, MAX_NODES);
      ids = new Set(ents.map(e => e.id));
      rels = rels.filter(r => ids.has(r.from) && ids.has(r.to));
    }
    const deg = new Map();
    for (const r of rels) { deg.set(r.from, (deg.get(r.from) || 0) + 1); deg.set(r.to, (deg.get(r.to) || 0) + 1); }
    const hubs = new Set(ents.slice().sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0)).slice(0, 24).map(e => e.id));
    const classIdx = new Map(project.classes.map((c, i) => [c.id, i]));
    const nodes = ents.map(e => {
      const c = look.cls(e.classId), d = deg.get(e.id) || 0;
      return {
        id: e.id, label: e.label, className: c.name, classId: e.classId, color: c.color, shape: c.shape,
        r: Math.min(2.4 + Math.sqrt(d) * 0.95, 9), stub: !!e.stub, hub: hubs.has(e.id) && d > 0,
        group: groups ? groups.get(e.id) ?? 0 : classIdx.get(e.classId) ?? 0,
      };
    });
    // 같은 두 노드 사이 여러 관계는 휘게 그려서 겹치지 않게
    const pairN = new Map(), pairI = new Map();
    const pk = r => (r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`);
    for (const r of rels) pairN.set(pk(r), (pairN.get(pk(r)) || 0) + 1);
    const links = rels.map(r => {
      const k = pk(r), n = pairN.get(k), i = pairI.get(k) || 0;
      pairI.set(k, i + 1);
      const t = look.rel(r.typeId);
      const curve = r.from === r.to ? 0.7 + i * 0.25 : n > 1 ? (i - (n - 1) / 2) * 0.32 * (r.from < r.to ? 1 : -1) : 0;
      return { id: r.id, source: r.from, target: r.to, from: r.from, to: r.to, typeId: r.typeId, typeName: t.name, color: t.color, directed: !t.symmetric, curve, inferred: !!r.inferred };
    });
    return { nodes, links, capped };
  }, [project, index, look, view.hiddenClasses, view.hiddenTypes, view.hideOrphans, groups]);

  useEffect(() => {
    const gv = gvRef.current;
    if (!ready || !gv) return;
    gv.setMode(look.mode);
    gv.setData(data);
    if (lastLayout.current !== view.layout || view.layout === 'cluster' || view.layout === 'community') {
      const changed = lastLayout.current !== view.layout, wasPending = gv.fitPending;
      lastLayout.current = view.layout;
      gv.setLayout(view.layout);
      if (!changed) gv.fitPending = wasPending;
    }
  }, [ready, data, look.mode, view.layout]);

  // ── 강조: 경로 > 선택한 노드 주변 > 범례에서 고른 종류 ──
  const highlight = useMemo(() => {
    if (path) return { nodes: new Set(path.map(s => s.id)), links: new Set(path.slice(1).map(s => s.via.id)) };
    if (selected) {
      const nodes = neighborhood(index, [selected], 1);
      const links = new Set(data.links.filter(l => l.from === selected || l.to === selected).map(l => l.id));
      return { nodes, links };
    }
    if (spot) {
      const ls = data.links.filter(l => (spot.kind === 'rel' ? l.typeId === spot.id : false));
      const nodes = new Set(spot.kind === 'cls' ? data.nodes.filter(n => n.classId === spot.id).map(n => n.id) : ls.flatMap(l => [l.from, l.to]));
      const links = new Set(spot.kind === 'cls' ? data.links.filter(l => nodes.has(l.from) && nodes.has(l.to)).map(l => l.id) : ls.map(l => l.id));
      return { nodes, links };
    }
    return null;
  }, [path, selected, spot, index, data]);

  useEffect(() => { if (ready) gvRef.current?.setHighlight(highlight, selected); }, [ready, highlight, selected]);
  useEffect(() => { if (ready) gvRef.current?.setLabelMode(view.labels); }, [ready, view.labels]);
  useEffect(() => { if (ready) (active ? gvRef.current?.resume() : gvRef.current?.pause()); }, [ready, active]);
  useEffect(() => { if (ready && selected && active) gvRef.current?.focus(selected); }, [ready, selected, active]);
  useEffect(() => { if (ready) gvRef.current?.setOffset(selected || path ? 0.24 : 0); }, [ready, selected, path]);

  handlers.current = {
    node: id => {
      if (pathFrom) {
        if (id === pathFrom) return;
        const visible = new Set(data.links.map(l => l.id));
        const p = shortestPath(index, pathFrom, id, r => visible.has(r.id));
        setPathFrom(null);
        if (!p) { toast('보이는 관계로는 두 노드를 잇는 경로가 없어요'); return; }
        setPath(p); setSelected(null); setSpot(null);
        return;
      }
      setPath(null); setSpot(null); setSelected(id);
    },
    bg: () => { if (!pathFrom) { setSelected(null); setPath(null); } },
    dag: () => {
      if (!handlers.current.dagWarned) { handlers.current.dagWarned = true; toast('순환하는 관계가 있어 계층이 완벽하진 않아요'); }
    },
  };

  const results = useMemo(() => {
    const n = norm(query);
    if (!n) return [];
    return project.entities.filter(e => norm(e.label).includes(n)).slice(0, 8);
  }, [query, project]);

  const counts = useMemo(() => {
    const c = new Map(), t = new Map();
    for (const e of project.entities) c.set(e.classId, (c.get(e.classId) || 0) + 1);
    for (const r of index.relations) t.set(r.typeId, (t.get(r.typeId) || 0) + 1);
    return { c, t };
  }, [project, index]);

  const askPath = async () => {
    const a = index.entity.get(path[0].id), b = index.entity.get(path[path.length - 1].id);
    const ids = neighborhood(index, path.map(s => s.id), 1);
    const text = toPrompt(makeView(project, { ids, inferred: view.inferred }), { question: `${a.label} [${a.id}] 와 ${b.label} [${b.id}] 는 어떻게 연결되어 있나요? 아래 경로를 중심으로 의미를 설명해 주세요.\n경로: ${pathText(path, index)}`, incoming: true });
    toast((await copyText(text)) ? '경로 질문 프롬프트를 복사했어요' : '복사하지 못했어요');
  };

  const shot = () => {
    try {
      const url = gvRef.current.screenshot();
      const a = document.createElement('a');
      a.href = url; a.download = `${project.name}-3d.png`; a.click();
    } catch { toast('화면을 저장하지 못했어요'); }
  };

  const empty = project.entities.length === 0;
  const selEntity = selected && index.entity.get(selected);
  const visibleClasses = project.classes.filter(c => counts.c.get(c.id));
  const visibleTypes = project.relTypes.filter(t => counts.t.get(t.id));
  const hiddenC = new Set(view.hiddenClasses), hiddenT = new Set(view.hiddenTypes);
  const toggleIn = (key, id) => setView(v => ({ [key]: v[key].includes(id) ? v[key].filter(x => x !== id) : [...v[key], id] }));

  return (
    <div className="graph-tab" hidden={!active}>
      <div ref={elRef} className="graph-canvas" />

      {failed && <div className="graph-msg"><p>{failed}</p><button className="btn" onClick={() => setTab('export')}>AI 내보내기는 그대로 쓸 수 있어요</button></div>}
      {!failed && empty && (
        <div className="graph-msg">
          <p><b>아직 데이터가 없어요</b><br />파일을 넣거나 예시로 체험해 보세요.</p>
          <button className="btn primary" onClick={() => setTab('import')}><Icon name="upload" /> 가져오기로</button>
        </div>
      )}

      <div className="graph-top">
        <div className="search">
          <Icon name="search" size={18} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="노드 찾기" enterKeyHint="search" aria-label="노드 찾기" />
          {query && <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="지우기"><Icon name="close" size={16} /></button>}
        </div>
        <button className="icon-btn float" onClick={() => gvRef.current?.fit()} aria-label="전체 보기"><Icon name="fit" /></button>
        <button className="icon-btn float" onClick={() => setSettings(true)} aria-label="보기 설정"><Icon name="sliders" /></button>
        {results.length > 0 && (
          <ul className="pick-list floating">
            {results.map(e => {
              const c = look.cls(e.classId);
              return (
                <li key={e.id}><button onClick={() => { setQuery(''); handlers.current.node(e.id); }}>
                  <ShapeIcon shape={c.shape} color={c.color} size={14} /><span className="grow ellipsis">{e.label}</span><small>{c.name}</small>
                </button></li>
              );
            })}
          </ul>
        )}
      </div>

      {data.capped > 0 && <p className="banner">노드가 {data.capped.toLocaleString()}개라 연결이 많은 {MAX_NODES.toLocaleString()}개만 보여요</p>}
      {pathFrom && (
        <div className="banner action">
          <span><b>{index.entity.get(pathFrom)?.label}</b>에서 출발 — 도착 노드를 누르거나 위에서 찾으세요</span>
          <button onClick={() => setPathFrom(null)}>취소</button>
        </div>
      )}

      <div className="graph-bottom">
        {selEntity ? (
          <Inspector {...props} entity={selEntity}
            onClose={() => setSelected(null)}
            onPath={() => { setPathFrom(selected); setSelected(null); }}
            onAround={() => { setView({ exportScope: 'around' }); setTab('export'); }} />
        ) : path ? (
          <section className="dock">
            <header className="dock-head">
              <h3 className="grow">경로 {path.length - 1}단계</h3>
              <button className="icon-btn" onClick={() => setPath(null)} aria-label="닫기"><Icon name="close" /></button>
            </header>
            <ol className="path">
              {path.map((s, i) => {
                const e = index.entity.get(s.id), c = look.cls(e?.classId), t = s.via && look.rel(s.via.typeId);
                return (
                  <li key={s.id}>
                    {s.via && <span className="path-rel"><LineSwatch color={t.color} /> {s.forward ? `${t.name} →` : `← ${t.name}`}</span>}
                    <button className="path-node" onClick={() => { setPath(null); setSelected(s.id); }}>
                      <ShapeIcon shape={c.shape} color={c.color} size={14} /> {e?.label}
                    </button>
                    {i === 0 && <small> 출발</small>}
                  </li>
                );
              })}
            </ol>
            <button className="btn" onClick={askPath}><Icon name="sparkle" /> 이 경로를 AI에게 묻기 (복사)</button>
          </section>
        ) : !empty && view.legend && (
          <div className="legend" aria-label="범례">
            <div className="strip">
              <span className="strip-title">노드</span>
              {visibleClasses.map(c => {
                const l = look.cls(c.id), on = spot?.kind === 'cls' && spot.id === c.id;
                return (
                  <button key={c.id} className={`lg ${on ? 'on' : ''} ${hiddenC.has(c.id) ? 'off' : ''}`} onClick={() => setSpot(on ? null : { kind: 'cls', id: c.id })}>
                    <ShapeIcon shape={l.shape} color={l.color} size={14} /> {c.name} <small>{counts.c.get(c.id)}</small>
                  </button>
                );
              })}
            </div>
            <div className="strip">
              <span className="strip-title">관계</span>
              {visibleTypes.map(t => {
                const l = look.rel(t.id), on = spot?.kind === 'rel' && spot.id === t.id;
                return (
                  <button key={t.id} className={`lg ${on ? 'on' : ''} ${hiddenT.has(t.id) ? 'off' : ''}`} onClick={() => setSpot(on ? null : { kind: 'rel', id: t.id })}>
                    <LineSwatch color={l.color} /> {t.name} <small>{counts.t.get(t.id)}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {settings && (
        <Sheet title="보기 설정" onClose={() => setSettings(false)}>
          <h4 className="label">배치</h4>
          <Segmented small value={view.layout} onChange={layout => setView({ layout })} options={LAYOUTS} />
          <p className="muted small">개념별: 같은 종류끼리 모아요 · 연결 묶음: 촘촘히 이어진 무리끼리 · 계층/방사형: 관계 방향을 위아래로 펼쳐요</p>
          <h4 className="label">이름표</h4>
          <Segmented small value={view.labels} onChange={labels => setView({ labels })} options={[{ value: 'auto', label: '중요한 것만' }, { value: 'all', label: '모두' }, { value: 'none', label: '선택만' }]} />
          <div className="toggles">
            <Toggle checked={view.inferred} onChange={inferred => setView({ inferred })} label="추론한 관계도 보기" hint={view.inferred ? `${inferredCount}개 계산됨 · 흐린 선` : '구조 탭에서 관계에 대칭·전이·역관계를 정하면 계산돼요'} />
            <Toggle checked={view.hideOrphans} onChange={hideOrphans => setView({ hideOrphans })} label="연결 없는 노드 숨기기" />
            <Toggle checked={view.legend} onChange={legend => setView({ legend })} label="아래쪽 범례 보이기" />
          </div>
          <h4 className="label">보일 개념 <small>눈 모양을 눌러 숨기기</small></h4>
          <ul className="list">
            {visibleClasses.map(c => {
              const l = look.cls(c.id);
              return (
                <li key={c.id}>
                  <ShapeIcon shape={l.shape} color={l.color} /> <span className="grow">{c.name}</span><small>{counts.c.get(c.id)}</small>
                  <button className="icon-btn sm" onClick={() => toggleIn('hiddenClasses', c.id)} aria-label={`${c.name} ${hiddenC.has(c.id) ? '보이기' : '숨기기'}`}><Icon name={hiddenC.has(c.id) ? 'eyeOff' : 'eye'} size={18} /></button>
                </li>
              );
            })}
          </ul>
          <h4 className="label">보일 관계</h4>
          <ul className="list">
            {visibleTypes.map(t => {
              const l = look.rel(t.id);
              return (
                <li key={t.id}>
                  <LineSwatch color={l.color} /> <span className="grow">{t.name}</span><small>{counts.t.get(t.id)}</small>
                  <button className="icon-btn sm" onClick={() => toggleIn('hiddenTypes', t.id)} aria-label={`${t.name} ${hiddenT.has(t.id) ? '보이기' : '숨기기'}`}><Icon name={hiddenT.has(t.id) ? 'eyeOff' : 'eye'} size={18} /></button>
                </li>
              );
            })}
          </ul>
          {project.relTypes.length > 8 && <p className="muted small">관계 종류가 8개를 넘으면 9번째부터는 회색으로 보여요. 범례에서 눌러 강조하거나, 구조 탭에서 비슷한 관계를 합쳐 보세요.</p>}
          <button className="btn" onClick={shot} disabled={!ready}><Icon name="camera" /> 지금 화면 이미지로 저장</button>
        </Sheet>
      )}
    </div>
  );
}

export function pathText(path, index) {
  return path.map((s, i) => {
    const e = index.entity.get(s.id);
    if (i === 0) return `${e.label}`;
    const t = index.type.get(s.via.typeId)?.name;
    return `${s.forward ? ` —${t}→ ` : ` ←${t}— `}${e.label}`;
  }).join('');
}
