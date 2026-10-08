'use strict';

/* ================================================================
 * 배치(반복 작업)별 분석 화면. 계산은 batch.js(Batch), 공용 도구는 app.js 것을 쓴다.
 * ================================================================ */

const bstate = {
  sources: [],      // [{ name, text }]
  read: [],         // Batch.readSource 결과
  cfg: null,
  result: null,
  factors: null,
  per: store.get('batch:per', null), // 원단위로 나눌 항목 (null = 자동, '' = 안 함)
};
const batchBtn = $('batch-btn');

/* ---------- 모드 전환 ---------- */
function setMode(m) {
  state.mode = m;
  store.set('mode', m);
  ['single', 'batch', 'bal'].forEach(k => { $(`mode-${k}`).hidden = m !== k; });
  mainBtn.hidden = m !== 'single';
  batchBtn.hidden = m !== 'batch';
  $('bal-btn').hidden = m !== 'bal';
  document.querySelectorAll('.modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('tip').hidden = true;
}
document.querySelectorAll('.modes button').forEach(b => { b.onclick = () => { setMode(b.dataset.mode); scrollTo(0, 0); }; });

/* ---------- 데이터 넣기 ---------- */
function bMsg(text, cls = '') { const m = $('b-msg'); m.textContent = text; m.className = 'msg ' + cls; }

function saveSources() {
  // 저장 크기는 JSON 길이로 잰다. 못 저장하면 새로고침 때 사라진다고 알린다
  const ok = JSON.stringify(bstate.sources).length < 3_000_000 && store.set('batch:sources', bstate.sources);
  if (!ok) { store.set('batch:sources', []); if (bstate.sources.length) toast('데이터가 커서 이 기기에 저장하지 못했어요. 새로고침하면 파일을 다시 넣어야 해요', 4500); }
}

/** 새 목록으로 바꾼다. 이미 있는 것과 내용이 똑같은 파일은 빼고 몇 개 뺐는지 돌려준다 */
function setSources(list, { keepCfg = false } = {}) {
  const seen = new Set(), uniq = [];
  let dup = 0;
  list.forEach(s => { if (seen.has(s.text)) { dup++; return; } seen.add(s.text); uniq.push(s); });
  bstate.sources = uniq;
  bstate.read = uniq.map(Batch.readSource);
  bstate.result = null;
  saveSources();
  // 설정은 남은 표에 그 칸들이 아직 있을 때만 유지한다 (설정을 짐작한 파일을 빼면 다시 짐작)
  const tb0 = (bstate.read.find(r => r.tb) || {}).tb;
  const c0 = bstate.cfg && Batch.normalizeCfg(bstate.cfg);
  const fits = c0 && tb0 && (c0.shape === 'wide' || tb0.headers.includes(c0.valCol)) && (!c0.timeCol || tb0.headers.includes(c0.timeCol)) && (c0.shape !== 'long' || tb0.headers.includes(c0.heatCol));
  if (!keepCfg || !fits) bstate.cfg = uniq.length ? Batch.guess(bstate.read) : null;
  else bstate.cfg = c0;
  store.set('batch:cfg', bstate.cfg);
  renderSources();
  renderBatchSetup();
  return dup;
}

function renderSources() {
  const ul = $('b-sources'); ul.innerHTML = '';
  bstate.read.forEach((s, i) => {
    const rows = s.tb ? s.tb.body.length : 0;
    const b = el('button', { type: 'button', 'aria-label': `${s.name} 빼기`, text: '×' });
    b.onclick = () => setSources(bstate.sources.filter((_, j) => j !== i), { keepCfg: true });
    ul.append(el('li', {}, el('span', { text: s.name }), el('small', { text: s.tb ? `${rows}줄` : '읽을 수 없음' }), b));
  });
  if (!bstate.sources.length) bMsg('');
}

$('b-files').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  bMsg(`파일 ${files.length}개를 읽는 중…`);
  const add = [], errs = [];
  for (const f of files) {
    try {
      const sheets = await fileToSheets(f);
      // 엑셀 시트가 여러 개면 시트마다 하나 (시트 = 배치일 수 있음)
      sheets.forEach(sh => add.push({ name: sheets.length > 1 ? `${f.name.replace(/\.[^.]+$/, '')} · ${sh.name}` : f.name, text: sh.text }));
    } catch (err) { errs.push(`${f.name}: ${err.message}`); }
  }
  try {
    const dup = setSources([...bstate.sources, ...add], { keepCfg: bstate.sources.length > 0 });
    // 열리긴 했지만 표로 읽을 수 없는 것(이름 줄만 있는 빈 파일 등)도 알린다
    add.forEach(a => { const r = bstate.read.find(x => x.name === a.name && x.text === a.text); if (r && !r.tb) errs.push(`${a.name}: ${r.error || '표를 읽을 수 없어요'}`); });
    bMsg(`${add.length - dup}개를 추가했어요.${dup ? ` 이미 넣은 것과 똑같은 ${dup}개는 뺐어요.` : ''}${errs.length ? ' 문제 있는 파일: ' + errs.join(' / ') : ''}`, errs.length ? 'err' : 'ok');
  } catch (err) {
    console.error(err);
    bMsg(`파일을 정리하다 문제가 생겼어요: ${err.message}`, 'err');
  }
};

$('b-paste-add').onclick = () => {
  const t = $('b-paste').value;
  if (!t.trim()) { bMsg('붙여넣은 표가 없어요', 'err'); return; }
  const dup = setSources([...bstate.sources, { name: nextPasteName(bstate.sources), text: t }], { keepCfg: bstate.sources.length > 0 });
  $('b-paste').value = '';
  bMsg(dup ? '이미 넣은 표와 똑같아서 추가하지 않았어요' : '표를 추가했어요', dup ? 'err' : 'ok');
};

// 붙여넣기 이름: 지금 있는 "붙여넣기 N" 중 가장 큰 번호 + 1 (하나를 빼도 이름이 겹치지 않게)
const nextPasteName = list => `붙여넣기 ${1 + list.reduce((m, s) => { const k = /^붙여넣기 (\d+)$/.exec(s.name); return k ? Math.max(m, +k[1]) : m; }, 0)}`;

function loadDemo(d, msg) {
  $('b-attrs').value = d.attrs; store.set('batch:attrs', d.attrs);
  bstate.per = null; store.set('batch:per', null);
  bstate.cfg = null;
  setSources(d.sources);
  if (d.cfg) { Object.assign(bstate.cfg, d.cfg); store.set('batch:cfg', bstate.cfg); renderBatchSetup(); }
  toast(msg, 4500);
}
$('b-demo').onclick = () => loadDemo(Batch.demo(), '예시: 전로 12개 강번(배치), 5초마다 기록한 가스 회수 유량이에요. 총량 = 회수량. 조업 정보도 넣어 두었어요');
$('b-demo2').onclick = () => loadDemo(Batch.demoReactor(), '예시: 반응기 10개 배치의 온도 기록이에요. 배치마다 "최고 온도"를 비교해요. 비교할 값은 바꿀 수 있어요');
$('b-clear').onclick = () => { $('b-attrs').value = ''; store.set('batch:attrs', ''); setSources([]); };

/* ---------- 설정 ---------- */
function headersOf() {
  const s = bstate.read.find(r => r.tb);
  return s ? s.tb : null;
}

function renderBatchSetup() {
  const tb = headersOf(), c = bstate.cfg;
  $('b-setup').hidden = !tb || !c;
  $('b-results').hidden = true;
  if (!tb || !c) { bstate.found = 0; updateBatchButton(); return; }
  updateBatchButton();
  const opt = (sel, list, val, none) => {
    const s = $(sel); s.innerHTML = '';
    if (none) s.append(el('option', { value: '', text: none }));
    list.forEach(h => s.append(el('option', { value: h, text: h })));
    s.value = list.includes(val) ? val : '';
  };
  $('b-shape').value = c.shape;
  opt('b-heat', tb.headers.filter((h, i) => tb.kinds[i] !== 'time'), c.heatCol, '(선택)');
  opt('b-time', tb.headers.filter((h, i) => tb.kinds[i] !== 'text'), c.timeCol, '시간 칸 없음 (측정 간격으로 계산)');
  opt('b-val', tb.headers.filter((h, i) => tb.kinds[i] === 'number' && h !== c.timeCol), c.valCol);
  const ti = tb.headers.indexOf(c.timeCol);
  $('b-heat-f').hidden = c.shape !== 'long';
  $('b-val-f').hidden = c.shape === 'wide';
  $('b-tunit-f').hidden = !(ti >= 0 && tb.kinds[ti] === 'number');
  $('b-interval-f').hidden = ti >= 0;
  $('b-gap-f').hidden = c.shape !== 'continuous';
  $('b-funit-f').hidden = c.kind !== 'rate';
  $('b-tunit').value = c.timeUnit; $('b-interval').value = String(c.interval);
  $('b-kind').value = c.kind; $('b-funit').value = c.rateUnit;
  // 총량은 시간당 값일 때만
  [...$('b-metric').options].forEach(o => { o.disabled = o.value === 'total' && c.kind !== 'rate'; });
  $('b-metric').value = c.metric;
  $('b-thr').value = String(c.thr);
  $('b-gap').value = c.gap ? String(+(c.gap / 60).toPrecision(4)) : '';
  $('b-align').value = c.align;
  // 미리 찾아본 배치 수
  const ex = Batch.extract(bstate.read, c);
  const durs = ex.heats.map(h => h.t[h.t.length - 1] - h.t[0]).sort((a, b) => a - b);
  const typ = durs.length ? durs[durs.length >> 1] / 60 : NaN;
  const tuNote = !c.timeUnitSure && ti >= 0 && tb.kinds[ti] === 'number' ? ` · ⚠ 시간 칸에 단위가 없어서 "${Batch.UNIT_LABEL[c.timeUnit]}"로 봤어요. 다르면 아래 "시간 칸의 숫자 단위"를 바꾸세요` : '';
  $('b-found').textContent = ex.heats.length
    ? `배치 ${ex.heats.length}개를 찾았어요 (길이 보통 ${fmt(typ, 3)}분): ${ex.heats.slice(0, 6).map(h => h.id).join(', ')}${ex.heats.length > 6 ? ' …' : ''}${tuNote}${ex.warnings.length ? ` · ⚠ ${ex.warnings.slice(0, 2).join(' / ')}` : ''}`
    : `배치를 찾지 못했어요. 데이터 모양과 칸 설정을 확인해주세요.${ex.warnings.length ? ` (${ex.warnings.slice(0, 2).join(' / ')})` : ''}`;
  bstate.found = ex.heats.length;
  updateBatchButton();
}

/** 설정 하나를 바꾸면 그에 딸린 기본값도 같이 바꾸고, 결과가 있었으면 다시 계산 */
function setCfg(patch) {
  const c = bstate.cfg = { ...bstate.cfg, ...patch };
  const tb = headersOf();
  if ('valCol' in patch) {
    c.rateUnit = Batch.rateUnitOf(c.valCol);
    const k = Batch.kindOfName(c.valCol);
    if (k && k !== c.kind) Object.assign(c, kindDefaults(k));
  }
  if ('kind' in patch) Object.assign(c, kindDefaults(c.kind));
  if ('timeCol' in patch && tb) {
    const ti = tb.headers.indexOf(c.timeCol);
    const tu = ti >= 0 && tb.kinds[ti] === 'number' ? Batch.timeUnitOf(c.timeCol, tb.cols[ti]) : { unit: 's', sure: true };
    c.timeUnit = tu.unit; c.timeUnitSure = tu.sure;
  }
  if ('timeUnit' in patch) c.timeUnitSure = true;
  bstate.cfg = Batch.normalizeCfg(c);
  store.set('batch:cfg', bstate.cfg);
  const had = !!bstate.result && !bstate.result.error;
  renderBatchSetup();
  if (had) runBatch();
}
const kindDefaults = k => (k === 'rate' ? { kind: 'rate', thr: 0.05, metric: 'total' } : { kind: 'level', thr: 0, metric: 'mean' });

const bind = (id, key, conv = v => v) => { $(id).onchange = e => setCfg({ [key]: conv(e.target.value) }); };
bind('b-shape', 'shape'); bind('b-heat', 'heatCol'); bind('b-time', 'timeCol'); bind('b-val', 'valCol');
bind('b-tunit', 'timeUnit'); bind('b-interval', 'interval', v => Math.max(0.001, toNumber(v) || 1));
bind('b-kind', 'kind'); bind('b-funit', 'rateUnit'); bind('b-metric', 'metric');
bind('b-thr', 'thr', Number); bind('b-align', 'align');
bind('b-gap', 'gap', v => (toNumber(v) > 0 ? toNumber(v) * 60 : 0));

function updateBatchButton() {
  if (!bstate.sources.length) { batchBtn.disabled = true; batchBtn.textContent = '배치별 기록을 넣어주세요'; return; }
  if (!bstate.found) { batchBtn.disabled = true; batchBtn.textContent = '배치를 찾지 못했어요'; return; }
  batchBtn.disabled = false;
  batchBtn.textContent = bstate.result && !bstate.result.error ? '엑셀 파일 받기' : '분석하기';
}

batchBtn.onclick = () => {
  if (bstate.result && !bstate.result.error) exportBatchExcel();
  else { runBatch(); if (bstate.result && !bstate.result.error) $('b-results').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
};

/* ---------- 분석 + 결과 ---------- */
/** 결과에 붙이는 이름·단위: 값 칸, 총량 단위, 비교할 값 */
function batchWords(R) {
  const c = R.cfg;
  const vName = c.shape === 'wide' ? '값' : c.valCol;
  const vu = c.shape === 'wide' ? '' : Batch.unitOf(c.valCol);
  const au = c.kind === 'rate' ? (c.shape === 'wide' ? '' : Batch.amountUnitOf(c.valCol)) || `${vu || '값'}×${Batch.UNIT_LABEL[c.rateUnit]}` : '';
  const mName = { total: '총량', mean: '평균값', peak: '최고값', last: '끝 값', duration: '걸린 시간' }[c.metric];
  const mu = c.metric === 'total' ? au : c.metric === 'duration' ? '분' : vu;
  return { vName, vu, au, mName, mu, m: `${mName}${mu ? `(${mu})` : ''}`, val: vu ? `값(${vu})` : '값' };
}

function runBatch() {
  if (!bstate.cfg) { bstate.result = null; updateBatchButton(); return; }
  let res = Batch.analyze(bstate.read, bstate.cfg);
  // 빼기를 너무 많이 해서 2개 미만이 되면 뺀 것을 모두 되돌린다 (결과 화면이 사라져 되돌릴 수 없게 되지 않도록)
  if (res.error && res.excluded && res.excluded.length) {
    bstate.cfg.exclude = []; store.set('batch:cfg', bstate.cfg);
    res = Batch.analyze(bstate.read, bstate.cfg);
    toast('비교하려면 배치가 2개 이상 있어야 해서, 뺀 배치를 모두 다시 넣었어요', 4000);
  }
  bstate.result = res; bstate.earlyPick = null;
  if (res.error) { toast(res.error, 4000); $('b-results').hidden = true; updateBatchButton(); return; }
  res.at = new Date();
  res.w = batchWords(res);
  bstate.factors = Batch.factors(res, $('b-attrs').value, bstate.per == null ? {} : { per: bstate.per });
  renderBatch();
  updateBatchButton();
}

const mins = s => s / 60;
const pctTxt = v => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '-');
const ORDER_WORD = { time: '시작 시각 순', name: '이름 순', record: '기록 순' };

function renderBatch() {
  const R = bstate.result, S = R.stats, al = R.align, W = R.w;
  $('b-results').hidden = false;

  // 요약
  const sm = $('b-summary'); sm.innerHTML = '';
  const add = html => sm.append(el('li', { html }));
  const u = W.mu ? ` ${esc(W.mu)}` : '';
  add(`배치 <b>${S.n}개</b>${R.excluded.length ? ` (뺀 배치 ${R.excluded.length}개 제외)` : ''}의 ${esc(jo(W.mName, '은는'))} 평균 <b>${fmt(S.mean, 5)}${u}</b>, 중앙값 ${fmt(S.median, 5)}, 범위 ${fmt(S.min, 5)} ~ ${fmt(S.max, 5)}이에요.`);
  add(`배치끼리 차이: ${Number.isFinite(S.cv) ? `변동계수 <b>${pctTxt(S.cv)}</b>, ` : ''}배치 80%가 ${fmt(S.p10, 5)} ~ ${fmt(S.p90, 5)}${u} 사이예요.`);
  add(`배치 길이는 평균 <b>${fmt(mins(S.durMean), 3)}분</b> (${fmt(mins(S.durMin), 3)} ~ ${fmt(mins(S.durMax), 3)}분), 배치 중 평균 ${esc(W.val)} ${fmt(S.meanMean, 4)}, 최대 평균 ${fmt(S.peakMean, 4)}이에요.`);
  if (R.totalizer) {
    const T = R.totalizer;
    const off = Math.abs(T.ratioMedian - 1);
    add(`적분한 총량 ÷ 누적계(${esc(T.name)}) 증가량 = <b>${fmt(T.ratioMedian, 4)}</b> (배치 ${T.n}개 중앙값, ${fmt(T.ratioMin, 3)} ~ ${fmt(T.ratioMax, 3)}). ${off < 0.02 ? '두 값이 잘 맞아요.' : '2% 넘게 차이 나요: 단위(시간당/분당)나 계기 보정을 확인해 보세요.'}`);
  }
  const flagged = R.heats.filter(h => h.flags.length);
  add(flagged.length ? `다른 배치와 많이 다른 배치 <b>${flagged.length}개</b>: ${flagged.map(h => `${esc(h.id)}(${esc(h.flags.join(', '))})`).join(', ')}` : '눈에 띄게 다른 배치는 없어요.');
  if (R.trend) {
    const p = Regression.details(R.trend).coefs[1].p;
    if (p < 0.05) add(`배치 순서(${ORDER_WORD[R.order]})대로 ${esc(jo(W.mName, '이가'))} <b>${R.trend.params[1] > 0 ? '늘고' : '줄고'}</b> 있어요 (배치마다 약 ${fmt(Math.abs(R.trend.params[1]), 3)}${u}, p = ${fmtP(p)}). 설비·조건 변화를 확인해 보세요.`);
  }
  const good = R.early.find(e => e.gain >= 0.5);
  if (good) add(`시작 후 <b>${fmt(mins(good.sec), 3)}분</b>까지의 ${esc(jo(W.mName, '으로'))} 최종 ${esc(jo(W.mName, '을를'))} 예측할 수 있어요 (검증 오차 약 ±${fmt(good.err, 3)}${u}, 평균으로만 찍을 때보다 오차 ${pctTxt(good.gain)} 작음).`);
  else if (R.early.length) add(`중간 값만으로는 최종 ${esc(jo(W.mName, '을를'))} 정확히 예측하기 어려워요. 배치 정보(조건)를 함께 쓰면 나아질 수 있어요.`);
  const F = bstate.factors;
  if (F && !F.error) {
    const top = F.rel.find(a => a.model);
    if (top) add(top.p < 0.05
      ? `배치 정보 중 ${esc(jo(W.mName, '과와'))} 가장 관계가 깊은 것은 <b>${esc(top.name)}</b>이에요 (r = ${fmt(top.r, 2)}, ${esc(jo(top.name, '이가'))} 1 늘면 ${esc(W.mName)} ${top.model.params[1] >= 0 ? '+' : '−'}${fmt(Math.abs(top.model.params[1]), 3)}).`
      : `넣은 배치 정보 중 ${esc(jo(W.mName, '과와'))} 뚜렷한 관계(p < 0.05)가 있는 항목은 없어요.`);
  }
  if (R.warnings.length) add(`⚠ ${esc(R.warnings.slice(0, 4).join(' / '))}${R.warnings.length > 4 ? ` 외 ${R.warnings.length - 4}개` : ''}`);

  // 겹친 곡선
  const isPct = R.cfg.align === 'pct';
  const gx = al.grid.map(g => (isPct ? g : mins(g)));
  const xLab = isPct ? '진행률(%)' : '시작 후(분)';
  const ov = $('b-overlay'); ov.innerHTML = '';
  const band = x => { const j = nearestIdx(gx, x); return [al.p10[j], al.p90[j]]; };
  const lines = R.heats.map((h, i) => ({ x: gx, y: al.rows[i], flag: h.flags.length > 0 }));
  requestAnimationFrame(() => mountChart(ov, {
    x: gx, y: al.mean, hidePoints: true, lines, linesLabel: '각 배치', overlay: { x: gx, y: al.mean }, overlayLabel: '평균',
    band, bandLabel: '10~90% 범위', xLabel: xLab, yLabel: W.vName,
    tip: j => `${esc(xLab)}: <b>${fmt(gx[j], 4)}</b><br>평균 <b>${fmt(al.mean[j], 5)}</b> · 중앙값 ${fmt(al.median[j], 5)}<br>10~90%: ${fmt(al.p10[j], 4)} ~ ${fmt(al.p90[j], 4)}<br>진행 중인 배치 ${al.active[j]}개`,
  }));
  const ty = $('b-typical'); ty.innerHTML = '';
  if (R.typical && R.typical.best) {
    const f = R.typical.best;
    ty.append(el('p', { class: 'mini-title', text: '평균 곡선을 식으로 나타내면 (근사식)' }));
    ty.append(el('div', { class: 'formula wrap', html: `${esc(formulaText(f, isPct ? 'p' : 't'))}<small>${esc(f.name)} · 정확도 ${fmtR2(f.r2)} · y = ${esc(W.vName)}, ${isPct ? 'p = 진행률(%)' : 't = 시작 후(분)'}. 오르내리는 곡선은 식으로 잘 안 맞을 수 있어 근사식은 참고용이에요. 계획에는 위의 평균 곡선 값(엑셀 "순시값" 시트)을 쓰는 게 더 정확해요.</small>` }));
  }

  // 배치별 값
  const run = $('b-run'); run.innerHTML = '';
  $('b-run-title').textContent = `배치별 ${W.mName}`;
  $('b-run-hint').textContent = `배치 순서(${ORDER_WORD[R.order]})대로 본 ${W.mName} 값이에요. 주황 선은 평균, 빨간 점은 다른 배치와 많이 다른 배치예요.`;
  const vals = R.heats.map(h => h.sum.value);
  requestAnimationFrame(() => mountChart(run, {
    x: vals.map((_, i) => i + 1), y: vals, line: true, fn: () => S.mean, fitLabel: '평균', pointLabel: W.mName,
    flagged: R.heats.map(h => h.flags.length > 0), xLabel: '배치 순서', yLabel: W.m,
    tip: i => { const h = R.heats[i]; return `<b>${esc(h.id)}</b><br>${esc(W.mName)} ${fmt(h.sum.value, 5)}${u}<br>길이 ${fmt(mins(h.sum.duration), 3)}분${h.flags.length ? `<br>⚠ ${esc(h.flags.join(', '))}` : ''}`; },
  }));
  const t = $('b-table'); t.innerHTML = '';
  const cols = summaryCols(R);
  t.append(el('tr', {}, ...['배치', '시작', ...cols.map(cc => cc.head), '판정', ''].map(h => el('th', { text: h }))));
  const ex = new Set(R.cfg.exclude || []);
  [...R.heats, ...R.excluded].forEach(h => {
    const off = ex.has(h.id);
    const b = el('button', { type: 'button', text: off ? '넣기' : '빼기' });
    b.onclick = () => {
      const s2 = new Set(bstate.cfg.exclude || []);
      if (!s2.has(h.id) && R.heats.length <= 2) { toast('비교하려면 배치가 2개 이상 남아 있어야 해요'); return; }
      s2.has(h.id) ? s2.delete(h.id) : s2.add(h.id);
      bstate.cfg.exclude = [...s2]; store.set('batch:cfg', bstate.cfg);
      const y0 = scrollY; runBatch(); scrollTo(0, y0);
    };
    const judge = off ? '뺌' : [h.flags.join(', ') || '보통', ...(h.notes || [])].join(' · ');
    t.append(el('tr', { class: off ? 'off' : '' },
      el('td', { text: h.id }), el('td', { text: h.start }), ...cols.map(cc => el('td', { text: fmt(cc.get(h), 5) })),
      el('td', { class: h.flags.length ? 'flag' : '', text: judge }), el('td', {}, b)));
  });

  renderEarly();
  renderFactors();
}

/** 요약표 칸: 비교할 값 + 길이 + 평균·최대 (+ 총량) */
function summaryCols(R) {
  const W = R.w, c = R.cfg, vu = W.vu ? `(${W.vu})` : '';
  const cols = [{ key: 'value', head: W.m, get: h => h.sum.value }];
  if (c.metric !== 'duration') cols.push({ key: 'dur', head: '길이(분)', get: h => mins(h.sum.duration) });
  if (c.kind === 'rate' && c.metric !== 'total') cols.push({ key: 'total', head: `총량(${W.au})`, get: h => h.sum.total });
  if (c.metric !== 'mean') cols.push({ key: 'mean', head: `평균${vu}`, get: h => h.sum.mean });
  if (c.metric !== 'peak') cols.push({ key: 'peak', head: `최대${vu}`, get: h => h.sum.peak });
  cols.push({ key: 'tPeak', head: '최대까지(분)', get: h => mins(h.sum.tPeak) });
  return cols;
}

function nearestIdx(arr, x) {
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m; else hi = m; }
  return Math.abs(arr[hi] - x) < Math.abs(arr[lo] - x) ? hi : lo;
}

function renderEarly() {
  const R = bstate.result, W = R.w, box = $('b-early'); box.innerHTML = '';
  $('b-early-panel').hidden = !R.early.length;
  if (!R.early.length) return;
  $('b-early-hint').textContent = `시작 후 몇 분까지의 ${jo(W.mName, '으로')} 최종 ${jo(W.mName, '을를')} 예측해요. 예측 프로그램에서 "지금까지 값 → 최종 값"으로 쓸 수 있어요.`;
  const t = el('table', { class: 'stat-table' }, el('tr', {}, ...['시작 후', '배치 수', '정확도(R²)', '검증 오차', '평균으로만 찍을 때보다'].map(h => el('th', { text: h }))));
  const pick = R.early.find(e => e.gain >= 0.5) || R.early[R.early.length - 1];
  R.early.forEach(e => t.append(el('tr', {},
    el('td', { text: `${fmt(mins(e.sec), 3)}분${e === pick ? ' ✓' : ''}` }), el('td', { text: String(e.n) }), el('td', { text: fmtR2(e.model.r2) }),
    el('td', { text: `±${fmt(e.err, 3)}` }),
    el('td', { text: Number.isFinite(e.gain) ? (e.gain > 0 ? `오차 ${pctTxt(e.gain)} 줄어듦` : '나아지지 않음') : '-' }))));
  box.append(el('div', { class: 'table-scroll' }, t));
  box.append(el('p', { class: 'hint', text: `"평균으로만 찍을 때"는 아무 정보 없이 매번 같은 배치들의 평균으로 예측했을 때 오차(표준편차)예요. 검증 오차는 식을 만들 때 쓰지 않은 배치로 잰 오차예요. 50% 이상 줄어야 쓸모 있는 예측이에요.` }));

  const sel = el('select', { 'aria-label': '예측 시점' });
  R.early.forEach((e, i) => sel.append(el('option', { value: String(i), text: `시작 후 ${fmt(mins(e.sec), 3)}분까지 값으로` })));
  sel.value = String(Number.isInteger(bstate.earlyPick) && R.early[bstate.earlyPick] ? bstate.earlyPick : R.early.indexOf(pick));
  bstate.earlyPick = +sel.value; // 엑셀도 화면에서 고른 시점을 쓴다
  const detail = el('div');
  const draw = () => {
    const e = R.early[+sel.value], m = e.model;
    const xl = `${fmt(mins(e.sec), 3)}분까지 ${W.mName}`;
    detail.innerHTML = '';
    detail.append(el('div', { class: 'formula wrap', html: `${esc(formulaText(m, 'x').replace(/^y =/, `최종 ${W.mName} =`))}<small>x = ${esc(xl)} · 정확도 ${fmtR2(m.r2)}${W.mu ? ` · 단위 ${esc(W.mu)}` : ''}</small>` }));
    const wrap = el('div', { class: 'chart' });
    detail.append(wrap);
    requestAnimationFrame(() => mountChart(wrap, {
      x: e.x, y: e.y, fn: m.predict, band: m.interval, xLabel: `${xl}${W.mu ? `(${W.mu})` : ''}`, yLabel: `최종 ${W.m}`, pointLabel: '배치',
      tip: i => `<b>${esc(e.ids[i])}</b><br>${esc(xl)} ${fmt(e.x[i], 5)}<br>최종 ${fmt(e.y[i], 5)} (식 ${fmt(m.predict(e.x[i]), 5)})`,
    }));
    detail.append(predictBox(m, xl, Regression.mean(e.x)));
  };
  sel.onchange = () => { bstate.earlyPick = +sel.value; draw(); };
  box.append(el('label', { class: 'field' }, el('span', { text: '예측에 쓸 시점' }), sel), detail);
  draw();
}

function renderFactors() {
  const box = $('b-factors'); box.innerHTML = '';
  const F = bstate.factors, R = bstate.result, W = R.w;
  if (!F) return;
  if (F.error) { box.append(el('p', { class: 'msg err', text: F.error })); return; }
  box.append(el('p', { class: 'hint', text: `배치 ${F.total}개 중 ${F.matched}개의 정보를 찾았어요 ("${F.keyName}" 칸으로 짝지음).${F.unmatched.length ? ` 못 찾은 배치: ${F.unmatched.slice(0, 5).join(', ')}${F.unmatched.length > 5 ? ' …' : ''}` : ''}` }));
  const t = el('table', { class: 'stat-table' }, el('tr', {}, ...['항목', '상관계수 r', `1 늘면 ${W.mName}`, 'R²', 'p값', '판정'].map(h => el('th', { text: h }))));
  F.rel.forEach(a => t.append(el('tr', {},
    el('td', { text: a.name }), el('td', { text: Number.isFinite(a.r) ? fmt(a.r, 2) : '-' }),
    el('td', { text: a.model ? `${a.model.params[1] >= 0 ? '+' : '−'}${fmt(Math.abs(a.model.params[1]), 3)}` : '-' }),
    el('td', { text: a.model ? fmtR2(a.model.r2) : '-' }), el('td', { text: fmtP(a.p) }), el('td', { class: a.p < 0.05 ? 'ok' : 'meh', text: sigMark(a.p) }))));
  box.append(el('div', { class: 'table-scroll' }, t));
  const top = F.rel.find(a => a.model);
  if (top) {
    box.append(el('p', { class: 'says', text: `${jo(W.mName, '과와')} 가장 관계가 깊은 항목은 ${top.name}이에요 (r = ${fmt(top.r, 2)}). ${corrWords(top.r).text}.` }));
    const wrap = el('div', { class: 'chart' });
    box.append(wrap);
    const x = top.model.data.x, y = top.model.data.y;
    requestAnimationFrame(() => mountChart(wrap, { x, y, fn: top.model.predict, band: top.model.interval, xLabel: top.name, yLabel: W.m, pointLabel: '배치' }));
  }
  if (F.multi && !F.multi.error) {
    const M = F.multi;
    box.append(el('div', { class: 'formula wrap', html: `${esc(W.mName)} = ${esc(joinTerms([[M.b0, ''], ...M.terms.map(tm => [tm.coef, tm.name])], fmt))}<small>배치 정보 ${M.terms.length}개를 함께 쓴 식 · 정확도 ${fmtR2(M.r2)} · 배치 ${M.n}개</small>` }));
  }
  // 원단위: 비교할 값 ÷ 고른 항목 (생산량·원료량 등)
  const sel = el('select', { 'aria-label': '원단위 기준 항목' });
  sel.append(el('option', { value: '', text: '안 함' }));
  F.perCandidates.forEach(n => sel.append(el('option', { value: n, text: n })));
  sel.value = F.perName || '';
  sel.onchange = () => { bstate.per = sel.value; store.set('batch:per', bstate.per); bstate.factors = Batch.factors(R, $('b-attrs').value, { per: bstate.per }); renderBatch(); };
  box.append(el('label', { class: 'field' }, el('span', {}, `원단위 (${W.mName} ÷ 항목) `, el('small', { class: 'hint', text: '생산량·원료량처럼 "양" 항목을 고르세요' })), sel));
  if (F.intensity) {
    const v = F.intensity.filter(Number.isFinite);
    const pu = Batch.unitOf(F.perName);
    if (v.length) box.append(el('p', { class: 'says', text: `원단위(${W.mName} ÷ ${F.perName}): 평균 ${fmt(Regression.mean(v), 4)}${W.mu || pu ? ` ${W.mu || '값'}/${pu || '단위'}` : ''}, 범위 ${fmt(minOf(v), 4)} ~ ${fmt(maxOf(v), 4)}` }));
  }
}

let attrTimer;
$('b-attrs').addEventListener('input', () => {
  clearTimeout(attrTimer);
  attrTimer = setTimeout(() => {
    store.set('batch:attrs', $('b-attrs').value.length < 500_000 ? $('b-attrs').value : '');
    if (bstate.result && !bstate.result.error) { bstate.factors = Batch.factors(bstate.result, $('b-attrs').value, bstate.per == null ? {} : { per: bstate.per }); renderBatch(); }
  }, 400);
});

/* ---------- 요약표 → 측정값 분석 ---------- */
function summaryRows() {
  const R = bstate.result, F = bstate.factors && !bstate.factors.error ? bstate.factors : null, W = R.w;
  const cols = summaryCols(R);
  const perHead = F && F.intensity ? `원단위(${W.mName}÷${F.perName})` : null;
  const head = ['배치', ...cols.map(c => c.head), ...(F ? F.attrs.map(a => a.name) : []), ...(perHead ? [perHead] : [])];
  const rows = R.heats.map((h, i) => [h.id, ...cols.map(c => c.get(h)), ...(F ? F.attrs.map(a => a.values[i]) : []), ...(perHead ? [F.intensity[i]] : [])]);
  // 회귀에 넣으면 안 되는 칸: 비교할 값으로 계산한 칸(원단위, 총량↔평균은 길이로 서로 계산됨)
  const c = R.cfg;
  const derived = new Set([perHead, ...(c.metric === 'total' ? cols.filter(x => x.key === 'mean').map(x => x.head) : []), ...(c.metric === 'mean' ? cols.filter(x => x.key === 'total').map(x => x.head) : [])].filter(Boolean));
  return { head, rows, derived };
}

$('b-to-single').onclick = () => {
  const R = bstate.result; if (!R || R.error) return;
  const { head, rows, derived } = summaryRows();
  const r8 = v => (typeof v === 'number' ? (Number.isFinite(v) ? String(+v.toPrecision(8)) : '') : v);
  input.value = [head.join('\t'), ...rows.map(r => r.map(r8).join('\t'))].join('\n');
  state.table = null; state.sheets = null; state.layout = 'cols'; store.set('layout', 'cols');
  store.set('cfg', null);
  setMode('single');
  onInput();
  // 비교할 값을 "가장 궁금한 값"으로, 시간 칸 없이(배치 순서), 계산으로 만든 칸은 빼고
  const tb = state.table;
  const vi = tb ? tb.headers.indexOf(head[1]) : -1;
  if (vi >= 0) {
    state.cfg.timeCol = -1; state.cfg.target = vi;
    // 첫 칸(배치 번호)은 숫자여도 측정값이 아니므로 뺀다
    state.cfg.vars = tb.headers.map((h, j) => j).filter(j => j !== 0 && tb.kinds[j] === 'number' && !derived.has(tb.headers[j]));
    saveCfg(); renderSetup();
  }
  analyze();
  scrollTo(0, 0);
  toast(`배치별 요약표를 불러왔어요. ${jo(R.w.mName, '을를')} "가장 궁금한 값"으로 분석했어요${derived.size ? ` (${[...derived].join(', ')}: 그 값으로 계산한 칸이라 뺐어요)` : ''}`, 4000);
};

/* ---------- 예측용 모델 파일 ---------- */
$('b-model-btn').onclick = () => {
  const R = bstate.result; if (!R || R.error) return;
  const al = R.align, isPct = R.cfg.align === 'pct', W = R.w;
  const r6 = a => a.map(v => (Number.isFinite(v) ? +v.toPrecision(7) : null));
  const F = bstate.factors && !bstate.factors.error ? bstate.factors : null;
  const bundle = {
    format: 'data-analyzer/batch-model', version: Regression.VERSION, createdAt: R.at.toISOString(),
    help: '배치별 분석 결과. early[i].model 은 regression.js 의 Regression.deserialize 로 불러와 predict(시작 후 minutes분까지의 값) → 최종 값.',
    settings: {
      valueColumn: W.vName, valueUnit: W.vu, valueKind: R.cfg.kind, rateUnit: R.cfg.kind === 'rate' ? R.cfg.rateUnit : null,
      metric: R.cfg.metric, metricName: W.mName, metricUnit: W.mu, amountUnit: W.au || null,
      threshold: R.cfg.thr, align: R.cfg.align, order: R.order,
      method: { total: 'total = trapezoid integration of value over time (÷ rate unit seconds)', mean: 'mean = time-weighted mean (trapezoid area / duration)', peak: 'peak = maximum value in the work interval', last: 'last = value at the end of the work interval', duration: 'duration = work interval length in minutes' }[R.cfg.metric],
    },
    // 통계: 비교할 값은 metricUnit, 길이는 분
    stats: { ...R.stats, durMean: undefined, durMin: undefined, durMax: undefined, durMeanMin: R.stats.durMean / 60, durMinMin: R.stats.durMin / 60, durMaxMin: R.stats.durMax / 60, valueUnit: W.mu || null },
    typicalCurve: { x: isPct ? 'progress %' : 'minutes from start', grid: r6(al.grid.map(g => (isPct ? g : g / 60))), mean: r6(al.mean), median: r6(al.median), p10: r6(al.p10), p90: r6(al.p90), active: al.active },
    typicalFit: R.typical && R.typical.best ? Regression.serialize(R.typical.best) : null,
    early: R.early.map(e => ({ minutes: e.sec / 60, n: e.n, validationRmse: e.err, model: Regression.serialize(e.model, { x: `${e.sec / 60}분까지 ${W.mName}`, y: `최종 ${W.mName}` }) })),
    factors: F && F.multi && !F.multi.error ? Regression.serialize(F.multi, { role: 'multi' }) : null,
    heats: R.heats.map(h => ({ id: h.id, start: h.start, durationMin: +(h.sum.duration / 60).toPrecision(6), value: +h.sum.value.toPrecision(8), total: Number.isFinite(h.sum.total) ? +h.sum.total.toPrecision(8) : null, mean: +h.sum.mean.toPrecision(8), peak: h.sum.peak, flags: h.flags, notes: h.notes })),
    excluded: R.excluded.map(h => h.id),
  };
  download(new Blob([JSON.stringify(bundle, null, 1)], { type: 'application/json' }), `배치모델_${stamp(R.at)}.json`);
  toast('모델 파일을 저장했어요');
};

/* ---------- 엑셀 ---------- */
async function exportBatchExcel() {
  const R = bstate.result; if (!R || R.error) return;
  batchBtn.disabled = true; batchBtn.textContent = '엑셀 만드는 중…';
  try {
    const ExcelJS = await getExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.creator = '데이터 분석기'; wb.created = new Date();
    const W = R.w, al = R.align, isPct = R.cfg.align === 'pct';
    const S0 = '배치별 요약', S1 = '순시값', S2 = '그래프', S3 = '함수설명', S4 = '원본 순시값';

    /* 배치별 요약 */
    const ws0 = wb.addWorksheet(S0, { views: [{ state: 'frozen', ySplit: 1 }] });
    const { head, rows } = summaryRows();
    const heads = [head[0], '시작', ...head.slice(1), '판정'];
    ws0.addRow(heads); styleRow(ws0.getRow(1), XL.head, 1, heads.length); ws0.getRow(1).height = 32;
    rows.forEach((r, i) => {
      const h = R.heats[i];
      const row = ws0.addRow([r[0], h.start, ...r.slice(1).map(v => (Number.isFinite(v) ? +v.toPrecision(10) : null)), [h.flags.join(', ') || '보통', ...(h.notes || [])].join(' · ')]);
      row.eachCell({ includeEmpty: true }, c => { c.border = XL.border; });
      for (let c = 3; c < heads.length; c++) row.getCell(c).numFmt = '#,##0.0##';
      if (h.flags.length) row.getCell(heads.length).font = { color: { argb: 'FFC62828' }, bold: true };
    });
    const last = rows.length + 1;
    ws0.addRow(['']);
    const statRow = {};
    [['평균', 'AVERAGE'], ['표준편차', 'STDEV'], ['최소', 'MIN'], ['최대', 'MAX'], ['중앙값', 'MEDIAN']].forEach(([name, fn]) => {
      const row = ws0.addRow([name, '']);
      statRow[fn] = row.number;
      for (let c = 3; c < heads.length; c++) {
        const L = colL(c - 1), vals = rows.map(r => r[c - 2]).filter(Number.isFinite).map(v => +v.toPrecision(10));
        if (!vals.length) continue;
        // 값이 1개뿐이면 표준편차는 엑셀도 #DIV/0! → '-'
        const need = fn === 'STDEV' ? 1 : 0, rg = `${L}2:${L}${last}`;
        const res = vals.length <= need ? '-' : fn === 'AVERAGE' ? mean(vals) : fn === 'STDEV' ? sd(vals) : fn === 'MIN' ? minOf(vals) : fn === 'MAX' ? maxOf(vals) : Batch.quantile([...vals].sort((a, b) => a - b), 0.5);
        row.getCell(c).value = { formula: need ? `IF(COUNT(${rg})>${need},${fn}(${rg}),"-")` : `${fn}(${rg})`, result: res };
        row.getCell(c).numFmt = '#,##0.0##';
      }
      styleRow(row, XL.sub, 1, heads.length);
    });
    const cvRow = ws0.addRow(['변동계수(CV)', '']);
    // 비교할 값은 C열: 표준편차 ÷ |평균|
    if (Number.isFinite(R.stats.cv)) { cvRow.getCell(3).value = { formula: `C${statRow.STDEV}/ABS(C${statRow.AVERAGE})`, result: R.stats.cv }; cvRow.getCell(3).numFmt = '0.0%'; }
    ws0.columns.forEach((c, i) => { c.width = Math.min(26, Math.max(10, String(heads[i] || '').length * 1.6 + 4)); });
    if (R.excluded.length) ws0.addRow([`계산에서 뺀 배치: ${R.excluded.map(h => h.id).join(', ')}`]);

    /* 순시값(시간 정렬) */
    const ws1 = wb.addWorksheet(S1, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
    const h1 = [isPct ? '진행률(%)' : '시작 후(분)', `평균 ${W.val}`, '중앙값', '하위10%', '상위10%', '진행 중 배치 수', ...R.heats.map(h => h.id)];
    ws1.addRow(h1); styleRow(ws1.getRow(1), XL.head, 1, h1.length); ws1.getRow(1).height = 30;
    al.grid.forEach((g, j) => {
      const r7 = v => (Number.isFinite(v) ? +v.toPrecision(7) : null);
      ws1.addRow([+(isPct ? g : g / 60).toPrecision(6), r7(al.mean[j]), r7(al.median[j]), r7(al.p10[j]), r7(al.p90[j]), al.active[j], ...al.rows.map(r => r7(r[j]))]);
    });
    ws1.columns.forEach((c, i) => { c.width = i < 6 ? 14 : 11; });
    for (let c = 2; c <= 5; c++) ws1.getColumn(c).font = { bold: true };

    /* 원본 순시값 (긴 표): 파일에 있던 값 그대로 + 계산에 쓴 값(부호·튀는 값 고친 뒤, 작업 구간 안만) */
    const total = R.heats.reduce((a, h) => a + h.raw.t.length, 0);
    if (total < 300_000) {
      const ws4 = wb.addWorksheet(S4, { views: [{ state: 'frozen', ySplit: 1 }] });
      const h4 = ['배치', '원래 시각', '작업 시작 후(초)', `원래 값 ${W.vName}`, '계산에 쓴 값', '작업 구간'];
      ws4.addRow(h4); styleRow(ws4.getRow(1), XL.head, 1, h4.length);
      R.heats.forEach(h => { const w = h.raw; w.t.forEach((t, i) => { const inW = i >= w.a && i <= w.b; ws4.addRow([h.id, w.label[i], +t.toPrecision(8), w.q[i], inW ? w.used[i] : null, inW ? 'O' : '']); }); });
      ws4.columns = [{ width: 14 }, { width: 20 }, { width: 16 }, { width: 18 }, { width: 14 }, { width: 10 }];
    }

    /* 그래프 */
    const ws2 = wb.addWorksheet(S2);
    ws2.getCell('A1').value = '그래프'; ws2.getCell('A1').font = { bold: true, size: 16 };
    ws2.getCell('A2').value = '가는 선 = 배치, 주황 선 = 시점별 평균, 띠 = 10~90% 범위, 빨강 = 다른 배치와 많이 다른 배치.';
    ws2.getCell('A2').font = { color: { argb: 'FF5F5F68' } };
    const gx = al.grid.map(g => (isPct ? g : g / 60));
    const charts = [{
      x: gx, y: al.mean, hidePoints: true, lines: R.heats.map((h, i) => ({ x: gx, y: al.rows[i], flag: h.flags.length > 0 })),
      overlay: { x: gx, y: al.mean }, overlayLabel: '평균', band: x => { const j = nearestIdx(gx, x); return [al.p10[j], al.p90[j]]; }, bandLabel: '10~90% 범위',
      xLabel: isPct ? '진행률(%)' : '시작 후(분)', yLabel: W.vName, title: '배치별 곡선', subtitle: `배치 ${R.heats.length}개`,
    }, {
      x: R.heats.map((_, i) => i + 1), y: R.heats.map(h => h.sum.value), line: true, fn: () => R.stats.mean, fitLabel: '평균', pointLabel: W.mName,
      flagged: R.heats.map(h => h.flags.length > 0), xLabel: '배치 순서', yLabel: W.m, title: `배치별 ${W.mName}`, subtitle: `평균 ${fmt(R.stats.mean, 5)}`,
    }];
    const ep = (Number.isInteger(bstate.earlyPick) && R.early[bstate.earlyPick]) || R.early.find(e => e.gain >= 0.5) || R.early[R.early.length - 1];
    if (ep) charts.push({ x: ep.x, y: ep.y, fn: ep.model.predict, band: ep.model.interval, pointLabel: '배치', xLabel: `${fmt(ep.sec / 60, 3)}분까지 ${W.mName}`, yLabel: `최종 ${W.m}`, title: `중간 ${W.mName} → 최종 ${W.mName}`, subtitle: `R² = ${fmtR2(ep.model.r2)}` });
    const F = bstate.factors && !bstate.factors.error ? bstate.factors : null;
    const topF = F && F.rel.find(a => a.model);
    if (topF) charts.push({ x: topF.model.data.x, y: topF.model.data.y, fn: topF.model.predict, band: topF.model.interval, pointLabel: '배치', xLabel: topF.name, yLabel: W.m, title: `${topF.name} → ${W.mName}`, subtitle: `r = ${fmt(topF.r, 2)}` });
    charts.forEach((spec, k) => {
      const id = wb.addImage({ base64: chartPNG(spec), extension: 'png' });
      ws2.addImage(id, { tl: { col: (k % 2) * 10 + 0.2, row: 3 + Math.floor(k / 2) * 20 }, ext: { width: 620, height: 349 } });
    });

    /* 함수설명 */
    const ws3 = wb.addWorksheet(S3);
    ws3.columns = [{ width: 26 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 40 }];
    let r = 1;
    const put = (vals, style, o = {}) => {
      const row = ws3.getRow(r);
      vals.forEach((v, i) => { if (v !== undefined) row.getCell(i + 1).value = typeof v === 'number' && !Number.isFinite(v) ? '-' : v; });
      if (style) styleRow(row, style, 1, vals.length); else if (o.border) for (let c = 1; c <= vals.length; c++) row.getCell(c).border = XL.border;
      r++; return row;
    };
    const title = text => { const row = put([text]); row.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1D5FA8' } }; };
    const note = text => { const row = put([text]); row.getCell(1).font = { color: { argb: 'FF5F5F68' } }; };
    const t0 = ws3.getRow(r); t0.getCell(1).value = '배치별 분석 결과'; t0.getCell(1).font = { bold: true, size: 18 }; r++;
    note(`분석일: ${R.at.toLocaleString('ko-KR')} · 배치 ${R.stats.n}개 · 값 칸: ${W.vName} · 비교할 값: ${W.m} · 순서: ${ORDER_WORD[R.order]}`);
    r++;
    title('1. 계산 방법');
    const c = R.cfg;
    [
      ['작업 구간', c.thr > 0 ? `배치마다 바닥값 + (최대 − 바닥값)의 ${Math.round(c.thr * 100)}% 이상인 첫 시점 ~ 마지막 시점. 그 앞뒤는 작업 전·후로 보고 뺌. 시작 = 0.` : '기록 전체를 씀 (자르지 않음). 첫 기록 = 0.'],
      [W.mName, c.metric === 'total' ? `시간당 값을 시간으로 적분 (사다리꼴 공식): Σ (Qᵢ + Qᵢ₊₁) / 2 × (tᵢ₊₁ − tᵢ). 단위 ${W.vu || '값'} × 시간 → ${W.au}.`
        : c.metric === 'mean' ? '시간 가중 평균: 적분(사다리꼴) ÷ 길이. 측정 간격이 고르지 않아도 정확함.'
          : c.metric === 'peak' ? '작업 구간의 최대값.' : c.metric === 'last' ? '작업 구간의 마지막 값.' : '작업 구간의 처음 ~ 끝 시간(분).'],
      ['평균 곡선', `${isPct ? '각 배치 길이를 0~100%로 맞춘 뒤' : `시작 후 경과 시간으로 맞춘 뒤(먼저 끝난 배치는 ${c.kind === 'rate' ? '0' : '빈 값'})`} 공통 시간축으로 보간하고, 시점마다 평균·중앙값·10~90% 범위를 구함. ("순시값" 시트)`],
      ['왜 그냥 평균이 아닌가', '배치마다 측정 시각이 달라 같은 시점끼리 바로 평균 낼 수 없고, 시간당 값(순시값)의 평균은 총량이 아님(시간을 곱해야 함).'],
      ['많이 다른 배치', `${W.mName}·길이·곡선 모양이 중앙값에서 크게 벗어남(강건 표준점수 3 초과), 작업 중 끊김, 기록 빠짐. 한 점만 튀는 값은 이웃 평균으로 고침.`],
    ].forEach(([a, b]) => { const row = put([a, b]); row.getCell(1).font = { bold: true }; ws3.mergeCells(r - 1, 2, r - 1, 7); row.getCell(2).alignment = { wrapText: true, vertical: 'top' }; row.height = 32; });
    if (R.warnings.length) R.warnings.slice(0, 10).forEach(w => note(`! ${w}`));
    r++;
    title('2. 결과 요약');
    const S = R.stats, mu = W.mu;
    [[`${W.mName} 평균`, S.mean, mu], ['표준편차', S.sd, mu], ['변동계수', S.cv, ''], ['중앙값', S.median, mu], ['최소 ~ 최대', `${fmtX(S.min, 6)} ~ ${fmtX(S.max, 6)}`, mu], ['10% ~ 90%', `${fmtX(S.p10, 6)} ~ ${fmtX(S.p90, 6)}`, mu],
      ['길이 평균(분)', S.durMean / 60, '분'], ['배치 중 평균 값', S.meanMean, W.vu], ['최대 평균', S.peakMean, W.vu]]
      .forEach(([a, b, u]) => { const row = put([a, typeof b === 'number' ? (Number.isFinite(b) ? +b.toPrecision(8) : '-') : b, u], null, { border: true }); if (a === '변동계수') row.getCell(2).numFmt = '0.0%'; else if (typeof b === 'number') row.getCell(2).numFmt = '#,##0.0##'; });
    if (R.totalizer) note(`적분 총량 ÷ 누적계(${R.totalizer.name}) 증가량 = ${fmtX(R.totalizer.ratioMedian)} (중앙값, 배치 ${R.totalizer.n}개)`);
    const flagged = R.heats.filter(h => h.flags.length);
    note(flagged.length ? `많이 다른 배치: ${flagged.map(h => `${h.id}(${h.flags.join(', ')})`).join(', ')}` : '많이 다른 배치 없음');
    r++;
    if (R.typical && R.typical.best) {
      title('3. 평균 곡선 근사식');
      note(`${formulaTextX(R.typical.best, isPct ? 'p' : 't')}   (${R.typical.best.name}, R² ${fmtR2(R.typical.best.r2)}, ${isPct ? 'p = 진행률 %' : 't = 시작 후 분'}, y = ${W.vName})`);
      note('오르내리는 곡선은 식으로 잘 안 맞을 수 있어 근사식은 참고용. 계획에는 "순시값" 시트의 평균 곡선 값을 쓰는 것이 더 정확함.');
      r++;
    }
    if (R.early.length) {
      title(`4. 중간 ${jo(W.mName, '으로')} 최종 ${W.mName} 예측`);
      put(['시작 후(분)', '배치 수', 'R²', '검증 오차(±)', '평균으로만 찍을 때(±)', '식'], XL.head);
      R.early.forEach(e => put([+(e.sec / 60).toPrecision(4), e.n, +fmtR2(e.model.r2), +e.err.toPrecision(4), Number.isFinite(e.sdY) ? +e.sdY.toPrecision(4) : '-', `${formulaTextX(e.model, 'x').replace(/^y =/, '최종 =')}  (x = ${fmt(e.sec / 60, 3)}분까지 ${W.mName})`], null, { border: true }));
      if (ep) {
        r++;
        const xw = dflt(mean(ep.x));
        put([`${fmt(ep.sec / 60, 3)}분까지 ${W.mName} 넣기 →`, xw, `최종 ${W.mName} →`, ''], XL.sub);
        const cell = ws3.getRow(r - 1).getCell(4);
        cell.value = { formula: excelFormula(ep.model, `B${r - 1}`), result: ep.model.predict(xw) }; cell.numFmt = '#,##0.0##';
        ws3.getRow(r - 1).getCell(2).fill = XL.input.fill;
        note(`노란 칸에 진행 중인 배치의 "지금까지 ${W.mName}"을 넣으면 최종 예측이 나와요.`);
      }
      r++;
    }
    if (F) {
      title(`5. 배치 정보와 ${W.mName}의 관계`);
      put(['항목', '상관계수 r', `1 늘면 ${W.mName}`, 'R²', 'p값', '판정'], XL.head);
      F.rel.forEach(a => put([a.name, Number.isFinite(a.r) ? +a.r.toFixed(4) : '-', a.model ? +a.model.params[1].toPrecision(5) : '-', a.model ? +fmtR2(a.model.r2) : '-', Number.isFinite(a.p) ? +a.p.toPrecision(3) : '-', sigMark(a.p)], null, { border: true }));
      if (F.multi && !F.multi.error) note(`${W.mName} = ${joinTerms([[F.multi.b0, ''], ...F.multi.terms.map(tm => [tm.coef, tm.name])], fmtX).replace(/−/g, '-')}   (R² ${fmtR2(F.multi.r2)})`);
      if (F.intensity) { const v = F.intensity.filter(Number.isFinite); if (v.length) note(`원단위(${W.mName} ÷ ${F.perName}) 평균 ${fmtX(mean(v))}`); }
      r++;
    }
    title('6. 용어');
    [['순시값', '그 순간의 값. 유량·전력처럼 "시간당 양"이면 총량을 구하려면 시간을 곱해 더해야(적분) 함.'], ['중앙값', '크기 순으로 줄 세웠을 때 가운데 값. 튀는 배치에 덜 흔들림.'], ['10~90% 범위', '배치 80%가 들어오는 범위.'], ['변동계수(CV)', '표준편차 ÷ 평균. 배치끼리 얼마나 들쭉날쭉한지.'], ['R²', '식이 실제를 얼마나 잘 설명하는지(1이 완벽).']]
      .forEach(([a, b]) => { const row = put([a, b]); row.getCell(1).font = { bold: true }; ws3.mergeCells(r - 1, 2, r - 1, 7); });
    ws3.views = [{ showGridLines: false }];

    // 시트 순서: 요약, 순시값, 그래프, 함수설명, 원본
    const order = [S0, S1, S2, S3, S4];
    wb.worksheets.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)).forEach((w, i) => { w.orderNo = i; });

    const buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `배치분석_${stamp(R.at)}.xlsx`);
    toast('엑셀 파일을 저장했어요');
  } catch (e) {
    console.error(e);
    toast('엑셀을 만들지 못했어요: ' + e.message, 4000);
  } finally {
    updateBatchButton();
  }
}

/* ---------- 시작 ---------- */
(function initBatch() {
  $('b-attrs').value = store.get('batch:attrs', '');
  const saved = store.get('batch:sources', []);
  if (Array.isArray(saved) && saved.length) {
    try {
      const cfg = store.get('batch:cfg', null);
      bstate.cfg = cfg ? Batch.normalizeCfg(cfg) : null; setSources(saved, { keepCfg: !!cfg });
    } catch (e) {
      console.error(e);
      store.set('batch:sources', []); store.set('batch:cfg', null);
      bstate.sources = []; bstate.read = []; bstate.cfg = null;
    }
  }
})();
// 모드는 모든 화면 스크립트가 준비된 뒤 balance-ui.js 끝에서 정한다
