import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyProject, normalizeProject, isProject, ops } from './lib/model.js';
import { buildIndex, inferRelations } from './lib/graph.js';
import { resolveColor, classShape } from './lib/palette.js';
import { load, save, prefs } from './lib/store.js';
import ImportTab from './components/ImportTab.jsx';
import GraphTab from './components/GraphTab.jsx';
import StructureTab from './components/StructureTab.jsx';
import ExportTab from './components/ExportTab.jsx';
import EntityEditor from './components/EntityEditor.jsx';
import { Icon, useToast } from './components/ui.jsx';

const TABS = [
  { id: 'import', label: '가져오기', icon: 'upload' },
  { id: 'graph', label: '3D 그래프', icon: 'graph' },
  { id: 'structure', label: '구조', icon: 'layers' },
  { id: 'export', label: 'AI 내보내기', icon: 'sparkle' },
];

const DEFAULT_VIEW = { hiddenClasses: [], hiddenTypes: [], inferred: false, hideOrphans: false, labels: 'auto', layout: 'force', legend: true };

function useColorMode() {
  const q = useMemo(() => window.matchMedia?.('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(!!q?.matches);
  useEffect(() => {
    if (!q) return undefined;
    const f = e => setDark(e.matches);
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, [q]);
  return dark ? 'dark' : 'light';
}

export default function App() {
  const mode = useColorMode();
  const [project, setProject] = useState(null);
  const ref = useRef(null);
  const history = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const [tab, setTabRaw] = useState(() => prefs.get('tab', 'import'));
  const [graphMounted, setGraphMounted] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [view, setViewRaw] = useState(() => ({ ...DEFAULT_VIEW, ...prefs.get('view', {}) }));
  const [toast, toastNode] = useToast();

  const setTab = useCallback(t => { setTabRaw(t); prefs.set('tab', t); }, []);
  const setView = useCallback(patch => setViewRaw(v => { const next = { ...v, ...(typeof patch === 'function' ? patch(v) : patch) }; prefs.set('view', next); return next; }), []);

  // 처음 열 때 기기에 저장된 작업 불러오기
  useEffect(() => {
    let alive = true;
    load('project').then(saved => {
      if (!alive) return;
      const p = isProject(saved) ? normalizeProject(saved) : emptyProject();
      ref.current = p;
      setProject(p);
      if (!p.entities.length) setTabRaw('import');
    });
    return () => { alive = false; };
  }, []);

  // 바뀔 때마다 잠시 뒤 저장
  useEffect(() => {
    if (!project) return undefined;
    const t = setTimeout(() => { save('project', project).then(ok => { if (!ok) toast('저장 공간이 부족해 기기에 저장하지 못했어요. 백업 파일로 내보내 주세요.', { ms: 5000 }); }); }, 500);
    return () => clearTimeout(t);
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (tab === 'graph') setGraphMounted(true); }, [tab]);

  // 모든 변경은 여기로: 되돌리기 기록을 남긴다
  const apply = useCallback((fn, msg) => {
    const prev = ref.current;
    const next = fn(prev);
    if (!next || next === prev) return prev;
    history.current.push(prev);
    if (history.current.length > 40) history.current.shift();
    ref.current = next;
    setProject(next);
    setCanUndo(true);
    if (msg) toast(msg, { action: { label: '되돌리기', run: () => undoRef.current() } });
    return next;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    ref.current = prev;
    setProject(prev);
    setCanUndo(history.current.length > 0);
    toast('되돌렸어요');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const inferred = useMemo(() => (project && view.inferred ? inferRelations(project) : []), [project, view.inferred]);
  const index = useMemo(() => project && buildIndex(project, inferred.length ? [...project.relations, ...inferred] : project.relations), [project, inferred]);

  const look = useMemo(() => {
    if (!project) return null;
    const cm = new Map(project.classes.map((c, i) => [c.id, { id: c.id, name: c.name, color: resolveColor(c.color, mode), shape: classShape(c, i) }]));
    const rm = new Map(project.relTypes.map(t => [t.id, { id: t.id, name: t.name, color: resolveColor(t.color, mode), symmetric: t.symmetric }]));
    const none = { name: '?', color: '#898781', shape: 0 };
    return { mode, cls: id => cm.get(id) || none, rel: id => rm.get(id) || none };
  }, [project, mode]);

  useEffect(() => {
    if (selected && project && !index.entity.has(selected)) setSelected(null);
  }, [project, index, selected]);

  if (!project) return <div className="boot">불러오는 중…</div>;

  const rename = () => {
    const name = window.prompt('온톨로지 이름', project.name);
    if (name && name.trim()) apply(p => ops.rename(p, name.trim()));
  };

  const ctx = { project, index, look, apply, toast, selected, setSelected, view, setView, setTab, openEditor: setEditing, inferredCount: inferred.length };

  return (
    <div className={`app tab-${tab}`}>
      <header className="top">
        <a className="icon-btn" href="../../" aria-label="갤러리로"><Icon name="back" size={22} /></a>
        <button className="title" onClick={rename} title="이름 바꾸기">
          <span className="ellipsis">{project.name}</span>
          <small>{project.entities.length.toLocaleString()}개 · 관계 {project.relations.length.toLocaleString()}</small>
        </button>
        <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="되돌리기"><Icon name="undo" /></button>
      </header>

      <main className="main">
        {tab === 'import' && <ImportTab {...ctx} />}
        {graphMounted && <GraphTab {...ctx} active={tab === 'graph'} />}
        {tab === 'structure' && <StructureTab {...ctx} />}
        {tab === 'export' && <ExportTab {...ctx} />}
      </main>

      <nav className="tabs" aria-label="화면">
        {TABS.map(t => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {editing && <EntityEditor {...ctx} target={editing} onClose={() => setEditing(null)} />}
      {toastNode}
    </div>
  );
}
