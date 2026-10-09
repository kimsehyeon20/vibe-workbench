import { useRef, useState } from 'react';
import { parseFiles, parseEntries, parseText } from '../lib/parse/index.js';
import { buildFragment } from '../lib/infer.js';
import { emptyProject, mergeInto, normalizeProject, projectToFragment } from '../lib/model.js';
import { extractionPrompt, parseAiAnswer } from '../lib/prompts.js';
import { sampleEntries } from '../lib/sample.js';
import MappingSheet from './MappingSheet.jsx';
import { Icon, Sheet, copyText } from './ui.jsx';

const KINDS = ['ZIP', 'CSV', 'TSV', 'Excel', 'JSON', 'JSON-LD', 'Markdown', 'TXT', '노트 묶음'];

export default function ImportTab({ project, apply, toast, setTab }) {
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  function commit(res, tables, mappings) {
    const total = { entitiesAdded: 0, entitiesUpdated: 0, relationsAdded: 0, classes: 0, relTypes: 0, stubs: 0 };
    const add = s => { for (const k in total) total[k] += s[k] || 0; };
    apply(p => {
      let cur = p;
      if (tables?.length) { const r = mergeInto(cur, buildFragment(tables, mappings, cur)); cur = r.project; add(r.stats); }
      for (const f of res.fragments) { const r = mergeInto(cur, f.fragment, { matchByLabel: f.matchByLabel }); cur = r.project; add(r.stats); }
      return cur;
    });
    setReport({ stats: total, warnings: res.warnings });
    toast(`엔티티 ${total.entitiesAdded}개 · 관계 ${total.relationsAdded}개 추가`, { action: { label: '3D로 보기', run: () => setTab('graph') }, ms: 5000 });
  }

  function handle(res) {
    for (const { project: bp, name } of res.projects) {
      const backup = normalizeProject(bp);
      const replace = !project.entities.length || window.confirm(`'${name}' 백업으로 지금 작업을 바꿀까요?\n[취소]를 누르면 지금 작업에 합쳐요.`);
      if (replace) apply(() => backup, '백업을 불러왔어요');
      else apply(p => mergeInto(p, projectToFragment(backup)).project, '백업을 합쳤어요');
    }
    if (res.tables.length) setPending(res);
    else if (res.fragments.length) commit(res);
    else if (!res.projects.length) setReport({ stats: null, warnings: res.warnings.length ? res.warnings : ['가져올 수 있는 내용을 찾지 못했어요'] });
  }

  async function onFiles(list) {
    if (!list?.length) return;
    setBusy(true);
    try { handle(await parseFiles([...list])); } catch (e) { toast(`파일을 읽지 못했어요: ${e.message}`, { ms: 5000 }); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  return (
    <div className="page">
      <section
        className={`drop ${drag ? 'over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
      >
        <p className="eyebrow">1단계 · 가져오기</p>
        <h2>파일을 넣으면<br />개념과 관계로 정리해요</h2>
        <p className="muted">표의 열이 다른 표를 가리키는지, 반복되는 값이 하나의 개념인지 자동으로 찾아 연결해요. 모든 처리는 이 기기 안에서만 해요.</p>
        <div className="chips">{KINDS.map(k => <span key={k} className="chip">{k}</span>)}</div>
        <input ref={inputRef} type="file" multiple hidden onChange={e => onFiles(e.target.files)}
          accept=".zip,.csv,.tsv,.xlsx,.xlsm,.json,.jsonld,.jsonl,.ndjson,.md,.markdown,.txt,application/zip,text/csv,application/json,text/markdown,text/plain" />
        <button className="btn primary" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Icon name="upload" /> {busy ? '읽는 중…' : '파일 고르기'}
        </button>
      </section>

      <div className="grid2">
        <button className="card-btn" onClick={() => handle(parseEntries(sampleEntries()))}>
          <Icon name="bolt" /><b>예시로 체험</b><small>가상 회사의 표 4개 + 회의록</small>
        </button>
        <button className="card-btn" onClick={() => setSheet('paste')}>
          <Icon name="file" /><b>글 붙여넣기</b><small>CSV·JSON·메모를 바로</small>
        </button>
        <button className="card-btn wide" onClick={() => setSheet('ai')}>
          <Icon name="sparkle" /><b>AI로 추출하기</b><small>긴 글에서 개념·관계를 Claude가 뽑아요 (API 키 불필요)</small>
        </button>
      </div>

      {report && (
        <section className="panel">
          <h3>방금 가져온 결과</h3>
          {report.stats && (
            <ul className="stats">
              <li><b>{report.stats.entitiesAdded}</b>새 엔티티</li>
              <li><b>{report.stats.entitiesUpdated}</b>갱신</li>
              <li><b>{report.stats.relationsAdded}</b>새 관계</li>
              <li><b>{report.stats.classes + report.stats.relTypes}</b>새 개념·관계 종류</li>
            </ul>
          )}
          {report.warnings.map((w, i) => <p key={i} className="warn">⚠ {w}</p>)}
          {report.stats && <button className="btn" onClick={() => setTab('graph')}><Icon name="graph" /> 3D 그래프로 보기</button>}
        </section>
      )}

      {project.sources.length > 0 && (
        <section className="panel">
          <h3>가져온 출처 <small>{project.sources.length}</small></h3>
          <ul className="list">
            {project.sources.slice().reverse().slice(0, 30).map(s => (
              <li key={s.id}>
                <span className="grow ellipsis">{s.name}</span>
                <small>{s.counts?.rows ? `${s.counts.rows}행` : s.counts?.docs ? `문서 ${s.counts.docs}` : s.kind}</small>
                <small>{new Date(s.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.entities.length > 0 && (
        <button className="btn ghost danger" onClick={() => { if (window.confirm('모든 데이터를 지울까요? (되돌리기로 복구할 수 있어요)')) apply(p => emptyProject(p.name), '모두 지웠어요'); }}>
          <Icon name="trash" /> 모두 지우고 새로 시작
        </button>
      )}

      {pending && (
        <MappingSheet
          res={pending}
          project={project}
          onCancel={() => setPending(null)}
          onConfirm={(tables, mappings) => { commit(pending, tables, mappings); setPending(null); }}
        />
      )}
      {sheet === 'paste' && <PasteSheet onClose={() => setSheet(null)} onSubmit={(text, name) => { setSheet(null); handle(parseText(text, name)); }} />}
      {sheet === 'ai' && <AiSheet project={project} toast={toast} onClose={() => setSheet(null)} onSubmit={frag => { setSheet(null); commit({ fragments: [{ fragment: frag, matchByLabel: true }], warnings: [] }); }} />}
    </div>
  );
}

function PasteSheet({ onClose, onSubmit }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('붙여넣은 글');
  return (
    <Sheet title="글 붙여넣기" onClose={onClose} footer={<button className="btn primary" disabled={!text.trim()} onClick={() => onSubmit(text, name.trim() || '붙여넣은 글')}>가져오기</button>}>
      <label className="field"><span>이름 (표라면 개념 이름이 돼요)</span><input value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="field"><span>내용 — 표(CSV/탭), JSON, 마크다운 메모 모두 돼요</span>
        <textarea rows={10} value={text} onChange={e => setText(e.target.value)} placeholder={'이름,부서,도시\n김민지,영업,서울\n이준호,개발,부산'} />
      </label>
    </Sheet>
  );
}

function AiSheet({ project, toast, onClose, onSubmit }) {
  const [src, setSrc] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const copyPrompt = async () => {
    const ok = await copyText(extractionPrompt(project, src));
    toast(ok ? '프롬프트를 복사했어요. Claude 앱에 붙여넣으세요' : '복사하지 못했어요');
  };
  const submit = () => {
    const r = parseAiAnswer(answer);
    if (r.error) setError(r.error); else onSubmit(r.fragment);
  };
  return (
    <Sheet title="AI로 추출하기" onClose={onClose} footer={<button className="btn primary" disabled={!answer.trim()} onClick={submit}>결과 가져오기</button>}>
      <ol className="steps">
        <li>
          <b>정리할 글을 넣어요</b>
          <small>회의록, 기사, 보고서 등. 지금 있는 개념·관계 이름을 프롬프트에 함께 넣어 일관되게 뽑아요.</small>
          <textarea rows={6} value={src} onChange={e => setSrc(e.target.value)} placeholder="예) 3월 회의에서 김민지 팀장은 부산 지사 이전을 결정했다…" />
          <button className="btn" disabled={!src.trim()} onClick={copyPrompt}><Icon name="copy" /> 프롬프트 복사</button>
        </li>
        <li>
          <b>Claude 앱에 붙여넣고 답을 받아요</b>
          <small>답은 JSON 형식으로 와요. 앞뒤 설명이 섞여 있어도 괜찮아요.</small>
        </li>
        <li>
          <b>AI 답을 여기에 붙여넣어요</b>
          <small>같은 이름의 기존 엔티티와는 자동으로 합쳐져요.</small>
          <textarea rows={6} value={answer} onChange={e => { setAnswer(e.target.value); setError(''); }} placeholder='{"entities": [...], "relations": [...]}' />
          {error && <p className="warn">⚠ {error}</p>}
        </li>
      </ol>
    </Sheet>
  );
}
