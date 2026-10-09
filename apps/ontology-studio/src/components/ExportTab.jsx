import { useMemo, useState } from 'react';
import { makeView, render, estimateTokens, FORMATS } from '../lib/export.js';
import { neighborhood } from '../lib/graph.js';
import { slug } from '../lib/model.js';
import { prefs } from '../lib/store.js';
import { Icon, Segmented, Toggle, copyText, downloadText, shareText } from './ui.jsx';

const PREVIEW = 6000;

export default function ExportTab({ project, index, look, selected, view, setView, toast, setTab }) {
  const [fmt, setFmtRaw] = useState(() => prefs.get('fmt', 'md'));
  const [hops, setHops] = useState(2);
  const [opt, setOptRaw] = useState(() => ({ compact: false, groupBy: 'class', props: true, sources: false, incoming: false, ...prefs.get('exportOpt', {}) }));
  const [question, setQuestion] = useState('');
  const [inferred, setInferred] = useState(!!view.inferred);
  const setFmt = f => { setFmtRaw(f); prefs.set('fmt', f); };
  const setOpt = patch => setOptRaw(o => { const n = { ...o, ...patch }; prefs.set('exportOpt', n); return n; });

  const scope = view.exportScope === 'around' && !selected ? 'all' : view.exportScope || 'all';
  const ids = useMemo(() => {
    if (scope === 'around' && selected) return neighborhood(index, [selected], hops);
    if (scope === 'visible') {
      const hc = new Set(view.hiddenClasses);
      return new Set(project.entities.filter(e => !hc.has(e.classId)).map(e => e.id));
    }
    return null;
  }, [scope, selected, hops, index, project, view.hiddenClasses]);

  const meta = FORMATS.find(f => f.id === fmt) || FORMATS[0];
  const out = useMemo(() => {
    if (!project.entities.length) return '';
    try { return render(fmt, makeView(project, { ids, inferred }), { ...opt, question, title: scope === 'around' && selected ? `${project.name} — ${index.entity.get(selected)?.label} 주변 ${hops}단계` : undefined }); }
    catch (e) { return `내보내기 오류: ${e.message}`; }
  }, [fmt, project, ids, inferred, opt, question, scope, selected, hops, index]);
  const tokens = useMemo(() => estimateTokens(out), [out]);
  const fileName = `${slug(project.name)}${scope === 'around' ? '-주변' : ''}.${meta.ext}`;

  const examples = useMemo(() => {
    const ents = project.entities.slice().sort((a, b) => index.degree(b.id) - index.degree(a.id));
    const a = ents[0], b = ents.find(e => a && e.classId !== a.classId);
    const top = project.classes[0];
    return [
      a && b && `${a.label}와(과) ${b.label}은(는) 어떻게 연결되어 있나요?`,
      top && `${top.name} 중에서 가장 중요한 것은 무엇이고, 이유는요?`,
      '이 데이터에서 빠져 있거나 서로 모순되는 부분을 찾아 주세요.',
      '전체 구조를 5줄로 요약하고, 눈에 띄는 패턴을 알려 주세요.',
    ].filter(Boolean);
  }, [project, index]);

  if (!project.entities.length) {
    return (
      <div className="page">
        <section className="panel">
          <h3>내보낼 데이터가 없어요</h3>
          <p className="muted small">먼저 파일을 가져오거나 예시로 체험해 보세요.</p>
          <button className="btn primary" onClick={() => setTab('import')}><Icon name="upload" /> 가져오기로</button>
        </section>
      </div>
    );
  }

  const copy = async () => toast((await copyText(out)) ? `복사했어요 · 약 ${tokens.toLocaleString()} 토큰` : '복사하지 못했어요. 파일 저장을 써 주세요');
  const share = async () => {
    const r = await shareText(out, fileName, meta.mime);
    if (r === 'unsupported') { downloadText(out, fileName, meta.mime); toast('공유를 지원하지 않아 파일로 저장했어요'); }
  };

  const sel = selected && index.entity.get(selected);
  const isAi = meta.ai;

  return (
    <div className="page with-actions">
      <section className="panel">
        <h3>무엇을 내보낼까요</h3>
        <Segmented small value={scope} onChange={exportScope => setView({ exportScope })} options={[
          { value: 'all', label: '전체' },
          { value: 'visible', label: '3D에 보이는 개념만' },
          { value: 'around', label: '선택 노드 주변', disabled: !sel },
        ]} />
        {scope === 'around' && sel && (
          <div className="row">
            <span className="grow small">‘<b>{sel.label}</b>’에서</span>
            <Segmented small value={hops} onChange={setHops} options={[1, 2, 3].map(n => ({ value: n, label: `${n}단계` }))} />
          </div>
        )}
        {!sel && <p className="muted small">3D 그래프에서 노드를 누르면 그 주변만 골라 보낼 수 있어요. 질문과 관련된 부분만 주면 AI 답이 더 정확해져요.</p>}
        <Toggle checked={inferred} onChange={setInferred} label="추론한 관계 포함" hint="대칭·전이·역관계 규칙으로 계산한 관계에 (추론) 표시" />
      </section>

      <section className="panel">
        <h3>형식</h3>
        <div className="formats">
          {FORMATS.map(f => (
            <button key={f.id} className={`fmt ${fmt === f.id ? 'on' : ''}`} onClick={() => setFmt(f.id)} aria-pressed={fmt === f.id}>
              <b>{f.name}{f.ai && <span className="badge">AI</span>}</b>
              <small>{f.desc}</small>
            </button>
          ))}
        </div>
        {isAi && (
          <div className="opts">
            <Segmented small value={opt.compact ? 'compact' : 'read'} onChange={v => setOpt({ compact: v === 'compact' })} options={[{ value: 'read', label: '읽기 좋게' }, { value: 'compact', label: '압축(토큰 절약)' }]} />
            {!opt.compact && <Segmented small value={opt.groupBy} onChange={groupBy => setOpt({ groupBy })} options={[{ value: 'class', label: '개념별로 묶기' }, { value: 'community', label: '연결 묶음별로' }]} />}
            <div className="toggles">
              <Toggle checked={opt.props} onChange={v => setOpt({ props: v })} label="속성 값 포함" />
              {!opt.compact && <Toggle checked={opt.incoming} onChange={v => setOpt({ incoming: v })} label="들어오는 관계도 적기" hint="엔티티마다 ← 표시로. 양방향 질문에 유리, 길이는 늘어요" />}
              {!opt.compact && <Toggle checked={opt.sources} onChange={v => setOpt({ sources: v })} label="출처(파일·행) 포함" hint="AI 가 근거 위치까지 말할 수 있어요" />}
            </div>
          </div>
        )}
        {fmt === 'prompt' && (
          <div className="question">
            <label className="field"><span>질문</span><textarea rows={2} value={question} onChange={e => setQuestion(e.target.value)} placeholder="비워 두면 AI 대화창에서 적을 수 있게 자리만 남겨요" /></label>
            <div className="chips">{examples.map(q => <button key={q} className="chip" onClick={() => setQuestion(q)}>{q}</button>)}</div>
          </div>
        )}
      </section>

      <section className="panel">
        <h3>미리보기 <small>{out.length.toLocaleString()}자 · 약 {tokens.toLocaleString()} 토큰(추정)</small></h3>
        {tokens > 100000 && <p className="warn small">⚠ 꽤 커요. AI 대화 한도를 넘을 수 있어요. ‘선택 노드 주변’이나 ‘압축’을 써 보세요.</p>}
        <pre className="preview">{out.length > PREVIEW ? `${out.slice(0, PREVIEW)}\n\n… (${(out.length - PREVIEW).toLocaleString()}자 더)` : out}</pre>
      </section>

      <details className="panel tips">
        <summary>AI 에서 잘 쓰는 법</summary>
        <ol>
          <li><b>복사 → Claude 앱 새 대화에 붙여넣기 → 질문.</b> ‘질문 프롬프트’ 형식은 그래프에 없는 내용을 지어내지 않게 하는 지시문이 들어 있어요.</li>
          <li><b>자주 쓴다면 파일로 저장</b>해 Claude 프로젝트의 지식(파일)에 올려 두세요. 매번 붙여넣지 않아도 돼요.</li>
          <li><b>범위를 좁힐수록 정확해요.</b> 질문과 관련된 노드를 골라 ‘주변 2단계’만 보내면 토큰도 줄고 답도 또렷해져요.</li>
          <li><b>개념·관계 설명을 채우면</b> 스키마에 정의가 함께 들어가 AI 가 의미를 오해하지 않아요(구조 탭 › 품질).</li>
          <li><b>JSON-LD·Turtle·Cypher</b>는 그래프 DB·온톨로지 도구로 옮길 때 써요. 백업은 이 앱으로 그대로 다시 불러와요.</li>
        </ol>
      </details>

      <div className="actions">
        <button className="btn primary grow" onClick={copy}><Icon name="copy" /> 복사</button>
        <button className="btn" onClick={() => downloadText(out, fileName, meta.mime)} aria-label="파일로 저장"><Icon name="download" /> 저장</button>
        <button className="btn" onClick={share} aria-label="공유"><Icon name="share" /> 공유</button>
      </div>
    </div>
  );
}
