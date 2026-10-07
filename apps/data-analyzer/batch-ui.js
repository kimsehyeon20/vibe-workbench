'use strict';

/* ================================================================
 * 강번별(배치) 분석 화면. 계산은 batch.js(Batch), 공용 도구는 app.js 것을 쓴다.
 * ================================================================ */

const bstate = {
  sources: [],      // [{ name, text }]
  read: [],         // Batch.readSource 결과
  cfg: null,
  result: null,
  factors: null,
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
  const size = bstate.sources.reduce((a, s) => a + s.text.length, 0);
  store.set('batch:sources', size < 1_500_000 ? bstate.sources : []);
}

function setSources(list, { keepCfg = false } = {}) {
  bstate.sources = list;
  bstate.read = list.map(Batch.readSource);
  bstate.result = null;
  saveSources();
  if (!keepCfg || !bstate.cfg) bstate.cfg = list.length ? Batch.guess(bstate.read) : null;
  store.set('batch:cfg', bstate.cfg);
  renderSources();
  renderBatchSetup();
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
      // 엑셀 시트가 여러 개면 시트마다 하나 (시트 = 강번일 수 있음)
      sheets.forEach(sh => add.push({ name: sheets.length > 1 ? `${f.name.replace(/\.[^.]+$/, '')} · ${sh.name}` : f.name, text: sh.text }));
    } catch (err) { errs.push(`${f.name}: ${err.message}`); }
  }
  setSources([...bstate.sources, ...add], { keepCfg: bstate.sources.length > 0 });
  bMsg(`${add.length}개를 추가했어요.${errs.length ? ' 읽지 못한 파일: ' + errs.join(' / ') : ''}`, errs.length ? 'err' : 'ok');
};

$('b-paste-add').onclick = () => {
  const t = $('b-paste').value;
  if (!t.trim()) { bMsg('붙여넣은 표가 없어요', 'err'); return; }
  setSources([...bstate.sources, { name: `붙여넣기 ${bstate.sources.length + 1}`, text: t }], { keepCfg: bstate.sources.length > 0 });
  $('b-paste').value = '';
  bMsg('표를 추가했어요', 'ok');
};

$('b-demo').onclick = () => {
  const d = Batch.demo();
  $('b-attrs').value = d.attrs; store.set('batch:attrs', d.attrs);
  setSources(d.sources);
  toast('예시: 전로 12개 강번, 5초마다 기록한 가스 회수 유량이에요. 조업 정보도 넣어 두었어요', 4000);
};
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
  updateBatchButton();
  if (!tb || !c) return;
  const opt = (sel, list, val, none) => {
    const s = $(sel); s.innerHTML = '';
    if (none) s.append(el('option', { value: '', text: none }));
    list.forEach(h => s.append(el('option', { value: h, text: h })));
    s.value = val || '';
  };
  $('b-shape').value = c.shape;
  opt('b-heat', tb.headers.filter((h, i) => tb.kinds[i] !== 'time'), c.heatCol, '(선택)');
  opt('b-time', tb.headers.filter((h, i) => tb.kinds[i] !== 'text'), c.timeCol, '시간 칸 없음 (측정 간격으로 계산)');
  opt('b-flow', tb.headers.filter((h, i) => tb.kinds[i] === 'number' && h !== c.timeCol), c.flowCol);
  const ti = tb.headers.indexOf(c.timeCol);
  $('b-heat-f').hidden = c.shape !== 'long';
  $('b-flow-f').hidden = c.shape === 'wide';
  $('b-tunit-f').hidden = !(ti >= 0 && tb.kinds[ti] === 'number');
  $('b-interval-f').hidden = ti >= 0;
  $('b-tunit').value = c.timeUnit; $('b-interval').value = String(c.interval);
  $('b-funit').value = c.flowUnit; $('b-thr').value = String(c.thr); $('b-align').value = c.align;
  // 미리 찾아본 강번 수
  const ex = Batch.extract(bstate.read, c);
  $('b-found').textContent = ex.heats.length
    ? `강번 ${ex.heats.length}개를 찾았어요: ${ex.heats.slice(0, 6).map(h => h.id).join(', ')}${ex.heats.length > 6 ? ' …' : ''}${ex.warnings.length ? ` · ⚠ ${ex.warnings.slice(0, 2).join(' / ')}` : ''}`
    : '강번을 찾지 못했어요. 데이터 모양과 칸 설정을 확인해주세요.';
  bstate.found = ex.heats.length;
  updateBatchButton();
}

const bind = (id, key, conv = v => v) => { $(id).onchange = e => { bstate.cfg[key] = conv(e.target.value); store.set('batch:cfg', bstate.cfg); const had = !!bstate.result; renderBatchSetup(); if (had) runBatch(); }; };
bind('b-shape', 'shape'); bind('b-heat', 'heatCol'); bind('b-time', 'timeCol'); bind('b-flow', 'flowCol');
bind('b-tunit', 'timeUnit'); bind('b-interval', 'interval', v => Math.max(0.001, toNumber(v) || 1));
bind('b-funit', 'flowUnit'); bind('b-thr', 'thr', Number); bind('b-align', 'align');
$('b-flow').addEventListener('change', e => { bstate.cfg.flowUnit = Batch.flowUnitOf(e.target.value); $('b-funit').value = bstate.cfg.flowUnit; });

function updateBatchButton() {
  if (!bstate.sources.length) { batchBtn.disabled = true; batchBtn.textContent = '강번별 파일을 넣어주세요'; return; }
  if (!bstate.found) { batchBtn.disabled = true; batchBtn.textContent = '강번을 찾지 못했어요'; return; }
  batchBtn.disabled = false;
  batchBtn.textContent = bstate.result && !bstate.result.error ? '엑셀 파일 받기' : '분석하기';
}

batchBtn.onclick = () => {
  if (bstate.result && !bstate.result.error) exportBatchExcel();
  else { runBatch(); if (bstate.result && !bstate.result.error) $('b-results').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
};

/* ---------- 분석 + 결과 ---------- */
const volUnitOf = name => { const m = String(name || '').match(/\(\s*([^()/]+?)\s*\/\s*[^()]+\)/); return m ? m[1] : 'Nm³'; };

function runBatch() {
  const res = Batch.analyze(bstate.read, bstate.cfg);
  bstate.result = res;
  if (res.error) { toast(res.error, 4000); $('b-results').hidden = true; updateBatchButton(); return; }
  res.at = new Date();
  res.vu = volUnitOf(bstate.cfg.flowCol);
  res.fu = `${res.vu}/${{ h: 'h', min: 'min', s: 's' }[bstate.cfg.flowUnit]}`;
  bstate.factors = Batch.factors(res, $('b-attrs').value);
  renderBatch();
  updateBatchButton();
}

const mins = s => s / 60;
const pctTxt = v => `${Math.round(v * 100)}%`;

function renderBatch() {
  const R = bstate.result, S = R.stats, al = R.align, vu = R.vu;
  $('b-results').hidden = false;

  // 요약
  const sm = $('b-summary'); sm.innerHTML = '';
  const add = html => sm.append(el('li', { html }));
  add(`강번 <b>${S.n}개</b>${R.excluded.length ? ` (뺀 강번 ${R.excluded.length}개 제외)` : ''}의 회수량은 평균 <b>${fmt(S.mean, 5)} ${esc(vu)}</b>, 중앙값 ${fmt(S.median, 5)}, 범위 ${fmt(S.min, 5)} ~ ${fmt(S.max, 5)}이에요.`);
  add(`강번끼리 차이(변동계수)는 <b>${pctTxt(S.cv)}</b>예요. 강번 80%는 ${fmt(S.p10, 5)} ~ ${fmt(S.p90, 5)} ${esc(vu)} 사이예요.`);
  add(`회수 시간은 평균 <b>${fmt(mins(S.durMean), 3)}분</b> (${fmt(mins(S.durMin), 3)} ~ ${fmt(mins(S.durMax), 3)}분), 회수 중 평균 유량 ${fmt(S.flowMean, 4)} ${esc(R.fu)}, 최대 유량 평균 ${fmt(S.peakMean, 4)} ${esc(R.fu)}예요.`);
  const flagged = R.heats.filter(h => h.flags.length);
  add(flagged.length ? `이상 강번 <b>${flagged.length}개</b>: ${flagged.map(h => `${esc(h.id)}(${esc(h.flags.join(', '))})`).join(', ')}` : '눈에 띄게 다른 강번은 없어요.');
  if (R.trend) {
    const p = Regression.details(R.trend).coefs[1].p;
    if (p < 0.05) add(`강번 순서대로 회수량이 <b>${R.trend.params[1] > 0 ? '늘고' : '줄고'}</b> 있어요 (강번마다 약 ${fmt(Math.abs(R.trend.params[1]), 3)} ${esc(vu)}, p = ${fmtP(p)}). 설비·조업 조건 변화를 확인해 보세요.`);
  }
  const good = R.early.find(e => e.model.r2 >= 0.7);
  if (good) add(`회수 시작 후 <b>${fmt(mins(good.sec), 3)}분</b>까지 모인 양으로 최종 회수량을 예측할 수 있어요 (정확도 ${fmtR2(good.model.r2)}, 오차 약 ±${fmt(good.model.rmse, 3)} ${esc(vu)}).`);
  else if (R.early.length) add(`중간 회수량만으로는 최종 회수량을 정확히 예측하기 어려워요 (가장 좋을 때 정확도 ${fmtR2(Math.max(...R.early.map(e => e.model.r2)))}). 조업 정보를 함께 쓰면 나아질 수 있어요.`);
  const F = bstate.factors;
  if (F && !F.error) {
    const top = F.rel.find(a => a.model);
    if (top) add(top.p < 0.05
      ? `조업 정보 중 회수량과 가장 관계가 깊은 것은 <b>${esc(top.name)}</b>이에요 (r = ${fmt(top.r, 2)}, ${esc(top.name)}이(가) 1 늘면 회수량 ${top.model.params[1] >= 0 ? '+' : '−'}${fmt(Math.abs(top.model.params[1]), 3)}).`
      : '넣은 조업 정보 중 회수량과 뚜렷한 관계(p < 0.05)가 있는 항목은 없어요.');
  }
  if (R.warnings.length) add(`⚠ ${esc(R.warnings.slice(0, 4).join(' / '))}`);

  // 겹친 곡선
  const isPct = R.cfg.align === 'pct';
  const gx = al.grid.map(g => (isPct ? g : mins(g)));
  const xLab = isPct ? '진행률(%)' : '회수 시작 후(분)';
  const ov = $('b-overlay'); ov.innerHTML = '';
  const band = x => { const j = nearestIdx(gx, x); return [al.p10[j], al.p90[j]]; };
  const lines = R.heats.map((h, i) => ({ x: gx, y: al.rows[i], flag: h.flags.length > 0 }));
  requestAnimationFrame(() => mountChart(ov, {
    x: gx, y: al.mean, hidePoints: true, lines, linesLabel: '각 강번', overlay: { x: gx, y: al.mean }, overlayLabel: '평균',
    band, bandLabel: '10~90% 범위', xLabel: xLab, yLabel: `회수 유량(${R.fu})`,
    tip: j => `${esc(xLab)}: <b>${fmt(gx[j], 4)}</b><br>평균 <b>${fmt(al.mean[j], 5)}</b> · 중앙값 ${fmt(al.median[j], 5)}<br>10~90%: ${fmt(al.p10[j], 4)} ~ ${fmt(al.p90[j], 4)}<br>회수 중인 강번 ${al.active[j]}개`,
  }));
  const ty = $('b-typical'); ty.innerHTML = '';
  if (R.typical && R.typical.best) {
    const f = R.typical.best;
    ty.append(el('p', { class: 'mini-title', text: '평균 곡선을 식으로 나타내면 (근사식)' }));
    ty.append(el('div', { class: 'formula wrap', html: `${esc(formulaText(f, isPct ? 'p' : 't'))}<small>${esc(f.name)} · 정확도 ${fmtR2(f.r2)} · y = 회수 유량(${esc(R.fu)}), ${isPct ? 'p = 진행률(%)' : 't = 회수 시작 후(분)'}. 회수 곡선은 오르다 내려오는 모양이라 근사식은 참고용이에요. 계획에는 위의 평균 곡선 값(엑셀 "순시값" 시트)을 쓰는 게 더 정확해요.</small>` }));
  }

  // 강번별 회수량
  const run = $('b-run'); run.innerHTML = '';
  const vols = R.heats.map(h => h.sum.volume);
  requestAnimationFrame(() => mountChart(run, {
    x: vols.map((_, i) => i + 1), y: vols, line: true, fn: () => S.mean, fitLabel: '평균', pointLabel: '회수량',
    flagged: R.heats.map(h => h.flags.length > 0), xLabel: '강번 순서', yLabel: `회수량(${vu})`,
    tip: i => { const h = R.heats[i]; return `<b>${esc(h.id)}</b><br>회수량 ${fmt(h.sum.volume, 5)} ${esc(vu)}<br>회수 시간 ${fmt(mins(h.sum.duration), 3)}분${h.flags.length ? `<br>⚠ ${esc(h.flags.join(', '))}` : ''}`; },
  }));
  const t = $('b-table'); t.innerHTML = '';
  t.append(el('tr', {}, ...['강번', '시작', '회수 시간(분)', `회수량(${vu})`, `평균 유량`, '최대 유량', '최대까지(분)', '판정', ''].map(h => el('th', { text: h }))));
  const ex = new Set(R.cfg.exclude || []);
  [...R.heats, ...R.excluded].forEach(h => {
    const off = ex.has(h.id);
    const b = el('button', { type: 'button', text: off ? '넣기' : '빼기' });
    b.onclick = () => {
      const s2 = new Set(bstate.cfg.exclude || []);
      s2.has(h.id) ? s2.delete(h.id) : s2.add(h.id);
      bstate.cfg.exclude = [...s2]; store.set('batch:cfg', bstate.cfg);
      const y0 = scrollY; runBatch(); scrollTo(0, y0);
    };
    t.append(el('tr', { class: off ? 'off' : '' },
      el('td', { text: h.id }), el('td', { text: h.start }), el('td', { text: fmt(mins(h.sum.duration), 3) }),
      el('td', { text: fmt(h.sum.volume, 5) }), el('td', { text: fmt(h.sum.meanFlow, 4) }), el('td', { text: fmt(h.sum.peak, 4) }),
      el('td', { text: fmt(mins(h.sum.tPeak), 3) }), el('td', { class: h.flags.length ? 'flag' : '', text: off ? '뺌' : h.flags.join(', ') || '보통' }), el('td', {}, b)));
  });

  // 중간 예측
  renderEarly();
  // 조업 정보
  renderFactors();
}

function nearestIdx(arr, x) {
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m; else hi = m; }
  return Math.abs(arr[hi] - x) < Math.abs(arr[lo] - x) ? hi : lo;
}

function renderEarly() {
  const R = bstate.result, vu = R.vu, box = $('b-early'); box.innerHTML = '';
  $('b-early-panel').hidden = !R.early.length;
  if (!R.early.length) return;
  const t = el('table', { class: 'stat-table' }, el('tr', {}, ...['시작 후', '강번 수', '정확도(R²)', '예측 오차', '검증 오차', '평균값으로 찍을 때보다'].map(h => el('th', { text: h }))));
  const pick = R.early.find(e => e.model.r2 >= 0.7) || R.early[R.early.length - 1];
  R.early.forEach(e => t.append(el('tr', {},
    el('td', { text: `${fmt(mins(e.sec), 3)}분${e === pick ? ' ✓' : ''}` }), el('td', { text: String(e.n) }), el('td', { text: fmtR2(e.model.r2) }),
    el('td', { text: `±${fmt(e.model.rmse, 3)}` }), el('td', { text: e.model.validation ? `±${fmt(e.model.validation.rmse, 3)}` : '-' }),
    el('td', { text: Number.isFinite(e.gain) ? `오차 ${pctTxt(Math.max(0, e.gain))} 줄어듦` : '-' }))));
  box.append(el('div', { class: 'table-scroll' }, t));
  box.append(el('p', { class: 'hint', text: `"평균값으로 찍을 때"는 아무 정보 없이 매번 평균 회수량(${fmt(R.stats.mean, 5)})으로 예측했을 때 오차(표준편차 ${fmt(R.stats.sd, 3)})예요. 이보다 많이 줄어야 쓸모 있는 예측이에요.` }));

  const sel = el('select', { 'aria-label': '예측 시점' });
  R.early.forEach((e, i) => sel.append(el('option', { value: String(i), text: `시작 후 ${fmt(mins(e.sec), 3)}분까지 회수량으로` })));
  sel.value = String(R.early.indexOf(pick));
  const detail = el('div');
  const draw = () => {
    const e = R.early[+sel.value], m = e.model;
    detail.innerHTML = '';
    detail.append(el('div', { class: 'formula wrap', html: `최종 회수량 = ${esc(joinTerms([[m.params[0], ''], [m.params[1], `(${fmt(mins(e.sec), 3)}분까지 회수량)`]], fmt))}<small>정확도 ${fmtR2(m.r2)} · 단위 ${esc(vu)}</small>` }));
    const wrap = el('div', { class: 'chart' });
    detail.append(wrap);
    requestAnimationFrame(() => mountChart(wrap, {
      x: e.x, y: e.y, fn: m.predict, band: m.interval, xLabel: `${fmt(mins(e.sec), 3)}분까지 회수량(${vu})`, yLabel: `최종 회수량(${vu})`, pointLabel: '강번',
      tip: i => `<b>${esc(e.ids[i])}</b><br>${fmt(mins(e.sec), 3)}분까지 ${fmt(e.x[i], 5)}<br>최종 ${fmt(e.y[i], 5)} (식 ${fmt(m.predict(e.x[i]), 5)})`,
    }));
    detail.append(predictBox(m, `${fmt(mins(e.sec), 3)}분까지 회수량`, Regression.mean(e.x)));
  };
  sel.onchange = draw;
  box.append(el('label', { class: 'field' }, el('span', { text: '예측에 쓸 시점' }), sel), detail);
  draw();
}

function renderFactors() {
  const box = $('b-factors'); box.innerHTML = '';
  const F = bstate.factors, R = bstate.result, vu = R.vu;
  if (!F) return;
  if (F.error) { box.append(el('p', { class: 'msg err', text: F.error })); return; }
  box.append(el('p', { class: 'hint', text: `강번 ${F.total}개 중 ${F.matched}개의 조업 정보를 찾았어요.${F.unmatched.length ? ` 못 찾은 강번: ${F.unmatched.slice(0, 5).join(', ')}${F.unmatched.length > 5 ? ' …' : ''}` : ''}` }));
  const t = el('table', { class: 'stat-table' }, el('tr', {}, ...['항목', '상관계수 r', '1 늘면 회수량', 'R²', 'p값', '판정'].map(h => el('th', { text: h }))));
  F.rel.forEach(a => t.append(el('tr', {},
    el('td', { text: a.name }), el('td', { text: Number.isFinite(a.r) ? fmt(a.r, 2) : '-' }),
    el('td', { text: a.model ? `${a.model.params[1] >= 0 ? '+' : '−'}${fmt(Math.abs(a.model.params[1]), 3)}` : '-' }),
    el('td', { text: a.model ? fmtR2(a.model.r2) : '-' }), el('td', { text: fmtP(a.p) }), el('td', { class: a.p < 0.05 ? 'ok' : 'meh', text: sigMark(a.p) }))));
  box.append(el('div', { class: 'table-scroll' }, t));
  const top = F.rel.find(a => a.model);
  if (top) {
    box.append(el('p', { class: 'says', text: `회수량과 가장 관계가 깊은 항목은 ${top.name}이에요 (r = ${fmt(top.r, 2)}). ${corrWords(top.r).text}.` }));
    const wrap = el('div', { class: 'chart' });
    box.append(wrap);
    const x = top.model.data.x, y = top.model.data.y;
    requestAnimationFrame(() => mountChart(wrap, { x, y, fn: top.model.predict, band: top.model.interval, xLabel: top.name, yLabel: `회수량(${vu})`, pointLabel: '강번' }));
  }
  if (F.multi && !F.multi.error) {
    const M = F.multi;
    box.append(el('div', { class: 'formula wrap', html: `회수량 = ${esc(joinTerms([[M.b0, ''], ...M.terms.map(tm => [tm.coef, tm.name])], fmt))}<small>조업 정보 ${M.terms.length}개를 함께 쓴 식 · 정확도 ${fmtR2(M.r2)} · 강번 ${M.n}개</small>` }));
  }
  if (F.intensity) {
    const v = F.intensity.filter(Number.isFinite);
    if (v.length) box.append(el('p', { class: 'says', text: `회수 원단위(회수량 ÷ ${F.tonName}): 평균 ${fmt(Regression.mean(v), 4)} ${vu}/t, 범위 ${fmt(Math.min(...v), 4)} ~ ${fmt(Math.max(...v), 4)}` }));
  }
}

let attrTimer;
$('b-attrs').addEventListener('input', () => {
  clearTimeout(attrTimer);
  attrTimer = setTimeout(() => {
    store.set('batch:attrs', $('b-attrs').value.length < 500_000 ? $('b-attrs').value : '');
    if (bstate.result && !bstate.result.error) { bstate.factors = Batch.factors(bstate.result, $('b-attrs').value); renderFactors(); }
  }, 400);
});

/* ---------- 요약표 → 측정값 분석 ---------- */
function summaryRows() {
  const R = bstate.result, F = bstate.factors && !bstate.factors.error ? bstate.factors : null, vu = R.vu;
  const head = ['강번', `회수량(${vu})`, '회수시간(분)', `평균유량(${R.fu})`, `최대유량(${R.fu})`, '최대까지(분)', ...(F ? F.attrs.map(a => a.name) : []), ...(F && F.intensity ? [`회수원단위(${vu}/t)`] : [])];
  const rows = R.heats.map((h, i) => [h.id, h.sum.volume, mins(h.sum.duration), h.sum.meanFlow, h.sum.peak, mins(h.sum.tPeak),
    ...(F ? F.attrs.map(a => a.values[i]) : []), ...(F && F.intensity ? [F.intensity[i]] : [])]);
  return { head, rows };
}

$('b-to-single').onclick = () => {
  const R = bstate.result; if (!R || R.error) return;
  const { head, rows } = summaryRows();
  const r6 = v => (typeof v === 'number' ? (Number.isFinite(v) ? String(+v.toPrecision(8)) : '') : v);
  input.value = [head.join('\t'), ...rows.map(r => r.map(r6).join('\t'))].join('\n');
  state.table = null; state.sheets = null; state.layout = 'cols'; store.set('layout', 'cols');
  store.set('cfg', null);
  setMode('single');
  onInput();
  // 회수량을 "가장 궁금한 값"으로
  const vi = state.table && state.table.headers.indexOf(head[1]);
  if (vi >= 0) { state.cfg.timeCol = -1; state.cfg.target = vi; if (!state.cfg.vars.includes(vi)) state.cfg.vars.push(vi); saveCfg(); renderSetup(); }
  analyze();
  scrollTo(0, 0);
  toast('강번별 요약표를 불러왔어요. 회수량을 "가장 궁금한 값"으로 분석했어요', 3500);
};

/* ---------- 예측용 모델 파일 ---------- */
$('b-model-btn').onclick = () => {
  const R = bstate.result; if (!R || R.error) return;
  const al = R.align, isPct = R.cfg.align === 'pct';
  const r6 = a => a.map(v => (Number.isFinite(v) ? +v.toPrecision(7) : null));
  const F = bstate.factors && !bstate.factors.error ? bstate.factors : null;
  const bundle = {
    format: 'data-analyzer/batch-model', version: Regression.VERSION, createdAt: R.at.toISOString(),
    help: '강번별 회수 분석 결과. early[i].model 은 regression.js 의 Regression.deserialize 로 불러와 predict(c분까지 회수량) → 최종 회수량.',
    settings: { flowColumn: R.cfg.flowCol, flowUnit: R.fu, volumeUnit: R.vu, threshold: R.cfg.thr, align: R.cfg.align, method: 'trapezoid integration of flow over time' },
    stats: R.stats,
    typicalCurve: { x: isPct ? 'progress %' : 'minutes from start', grid: r6(al.grid.map(g => (isPct ? g : g / 60))), mean: r6(al.mean), median: r6(al.median), p10: r6(al.p10), p90: r6(al.p90), active: al.active },
    typicalFit: R.typical && R.typical.best ? Regression.serialize(R.typical.best) : null,
    early: R.early.map(e => ({ minutes: e.sec / 60, n: e.n, model: Regression.serialize(e.model, { x: `${e.sec / 60}분까지 회수량`, y: '최종 회수량' }) })),
    factors: F && F.multi && !F.multi.error ? Regression.serialize(F.multi, { role: 'multi' }) : null,
    heats: R.heats.map(h => ({ id: h.id, start: h.start, durationMin: +(h.sum.duration / 60).toPrecision(6), volume: +h.sum.volume.toPrecision(8), peak: h.sum.peak, flags: h.flags })),
    excluded: R.excluded.map(h => h.id),
  };
  download(new Blob([JSON.stringify(bundle, null, 1)], { type: 'application/json' }), `강번별회수모델_${stamp(R.at)}.json`);
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
    const vu = R.vu, fu = R.fu, al = R.align, isPct = R.cfg.align === 'pct';
    const S0 = '강번별 요약', S1 = '순시값', S2 = '그래프', S3 = '함수설명', S4 = '원본 순시값';

    /* 강번별 요약 */
    const ws0 = wb.addWorksheet(S0, { views: [{ state: 'frozen', ySplit: 1 }] });
    const { head, rows } = summaryRows();
    const heads = [head[0], '시작', ...head.slice(1), '판정'];
    ws0.addRow(heads); styleRow(ws0.getRow(1), XL.head, 1, heads.length); ws0.getRow(1).height = 32;
    rows.forEach((r, i) => {
      const h = R.heats[i];
      const row = ws0.addRow([r[0], h.start, ...r.slice(1).map(v => (Number.isFinite(v) ? +v.toPrecision(10) : null)), h.flags.join(', ') || '보통']);
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
        const L = colL(c - 1), vals = rows.map(r => r[c - 2]).filter(Number.isFinite);
        const res = !vals.length ? 0 : fn === 'AVERAGE' ? mean(vals) : fn === 'STDEV' ? (vals.length > 1 ? sd(vals) : 0) : fn === 'MIN' ? Math.min(...vals) : fn === 'MAX' ? Math.max(...vals) : Batch.quantile([...vals].sort((a, b) => a - b), 0.5);
        row.getCell(c).value = { formula: `${fn}(${L}2:${L}${last})`, result: res };
        row.getCell(c).numFmt = '#,##0.0##';
      }
      styleRow(row, XL.sub, 1, heads.length);
    });
    const cvRow = ws0.addRow(['변동계수(CV)', '']);
    // 회수량은 C열: 표준편차 ÷ 평균
    cvRow.getCell(3).value = { formula: `C${statRow.STDEV}/C${statRow.AVERAGE}`, result: R.stats.cv }; cvRow.getCell(3).numFmt = '0.0%';
    ws0.columns.forEach((c, i) => { c.width = Math.min(26, Math.max(10, String(heads[i] || '').length * 1.6 + 4)); });
    if (R.excluded.length) ws0.addRow([`계산에서 뺀 강번: ${R.excluded.map(h => h.id).join(', ')}`]);

    /* 순시값(시간 정렬) */
    const ws1 = wb.addWorksheet(S1, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
    const h1 = [isPct ? '진행률(%)' : '회수 시작 후(분)', `평균(${fu})`, '중앙값', '하위10%', '상위10%', '회수 중 강번 수', ...R.heats.map(h => h.id)];
    ws1.addRow(h1); styleRow(ws1.getRow(1), XL.head, 1, h1.length); ws1.getRow(1).height = 30;
    al.grid.forEach((g, j) => {
      const r6 = v => (Number.isFinite(v) ? +v.toPrecision(7) : null);
      ws1.addRow([+(isPct ? g : g / 60).toPrecision(6), r6(al.mean[j]), r6(al.median[j]), r6(al.p10[j]), r6(al.p90[j]), al.active[j], ...al.rows.map(r => r6(r[j]))]);
    });
    ws1.columns.forEach((c, i) => { c.width = i < 6 ? 14 : 11; });
    for (let c = 2; c <= 5; c++) ws1.getColumn(c).font = { bold: true };

    /* 원본 순시값 (긴 표) */
    const total = R.heats.reduce((a, h) => a + h.t.length, 0);
    if (total < 300_000) {
      const ws4 = wb.addWorksheet(S4, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws4.addRow(['강번', '원래 시각', '회수 시작 후(초)', `회수 유량(${fu})`]); styleRow(ws4.getRow(1), XL.head, 1, 4);
      R.heats.forEach(h => h.t.forEach((t, i) => ws4.addRow([h.id, h.label[i], +t.toPrecision(8), h.q[i]])));
      ws4.columns = [{ width: 14 }, { width: 20 }, { width: 16 }, { width: 18 }];
    }

    /* 그래프 */
    const ws2 = wb.addWorksheet(S2);
    ws2.getCell('A1').value = '그래프'; ws2.getCell('A1').font = { bold: true, size: 16 };
    ws2.getCell('A2').value = '가는 선 = 강번, 주황 선 = 시점별 평균, 띠 = 10~90% 범위, 빨강 = 이상 강번.';
    ws2.getCell('A2').font = { color: { argb: 'FF5F5F68' } };
    const gx = al.grid.map(g => (isPct ? g : g / 60));
    const charts = [{
      x: gx, y: al.mean, hidePoints: true, lines: R.heats.map((h, i) => ({ x: gx, y: al.rows[i], flag: h.flags.length > 0 })),
      overlay: { x: gx, y: al.mean }, overlayLabel: '평균', band: x => { const j = nearestIdx(gx, x); return [al.p10[j], al.p90[j]]; }, bandLabel: '10~90% 범위',
      xLabel: isPct ? '진행률(%)' : '회수 시작 후(분)', yLabel: `회수 유량(${fu})`, title: '강번별 회수 곡선', subtitle: `강번 ${R.heats.length}개`,
    }, {
      x: R.heats.map((_, i) => i + 1), y: R.heats.map(h => h.sum.volume), line: true, fn: () => R.stats.mean, fitLabel: '평균', pointLabel: '회수량',
      flagged: R.heats.map(h => h.flags.length > 0), xLabel: '강번 순서', yLabel: `회수량(${vu})`, title: '강번별 회수량', subtitle: `평균 ${fmt(R.stats.mean, 5)}`,
    }];
    const ep = R.early.find(e => e.model.r2 >= 0.7) || R.early[R.early.length - 1];
    if (ep) charts.push({ x: ep.x, y: ep.y, fn: ep.model.predict, band: ep.model.interval, pointLabel: '강번', xLabel: `${fmt(ep.sec / 60, 3)}분까지 회수량(${vu})`, yLabel: `최종 회수량(${vu})`, title: '중간 회수량 → 최종 회수량', subtitle: `R² = ${fmtR2(ep.model.r2)}` });
    const F = bstate.factors && !bstate.factors.error ? bstate.factors : null;
    const topF = F && F.rel.find(a => a.model);
    if (topF) charts.push({ x: topF.model.data.x, y: topF.model.data.y, fn: topF.model.predict, band: topF.model.interval, pointLabel: '강번', xLabel: topF.name, yLabel: `회수량(${vu})`, title: `${topF.name} → 회수량`, subtitle: `r = ${fmt(topF.r, 2)}` });
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
      vals.forEach((v, i) => { if (v !== undefined) row.getCell(i + 1).value = v; });
      if (style) styleRow(row, style, 1, vals.length); else if (o.border) for (let c = 1; c <= vals.length; c++) row.getCell(c).border = XL.border;
      r++; return row;
    };
    const title = text => { const row = put([text]); row.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1D5FA8' } }; };
    const note = text => { const row = put([text]); row.getCell(1).font = { color: { argb: 'FF5F5F68' } }; };
    const t0 = ws3.getRow(r); t0.getCell(1).value = '강번별 회수 분석 결과'; t0.getCell(1).font = { bold: true, size: 18 }; r++;
    note(`분석일: ${R.at.toLocaleString('ko-KR')} · 강번 ${R.stats.n}개 · 순시값 칸: ${R.cfg.flowCol} (${fu})`);
    r++;
    title('1. 계산 방법');
    [
      ['회수 구간', `강번마다 최대값의 ${Math.round(R.cfg.thr * 100)}% 이상인 첫 시점 ~ 마지막 시점. 그 앞뒤는 회수 전·후로 보고 뺌. 회수 시작 = 0.`],
      ['회수량', `순시값을 시간으로 적분 (사다리꼴 공식): Σ (Qᵢ + Qᵢ₊₁) / 2 × (tᵢ₊₁ − tᵢ). 단위 ${fu} × 시간 → ${vu}.`],
      ['평균 곡선', `${isPct ? '각 강번의 회수 시간을 0~100%로 맞춘 뒤' : '회수 시작 후 경과 시간으로 맞춘 뒤(끝난 강번은 0)'} 공통 시간축으로 보간하고, 시점마다 평균·중앙값·10~90% 범위를 구함. ("순시값" 시트)`],
      ['왜 그냥 평균이 아닌가', '강번마다 측정 시각이 달라 같은 시점끼리 바로 평균 낼 수 없고, 순시값 평균은 회수량이 아님(시간을 곱해야 함).'],
      ['이상 강번', '회수량·회수 시간·곡선 모양이 중앙값에서 크게 벗어남(강건 표준점수 3 초과), 회수 중 끊김, 기록 빠짐.'],
    ].forEach(([a, b]) => { const row = put([a, b]); row.getCell(1).font = { bold: true }; ws3.mergeCells(r - 1, 2, r - 1, 7); row.getCell(2).alignment = { wrapText: true, vertical: 'top' }; row.height = 32; });
    r++;
    title('2. 결과 요약');
    const S = R.stats;
    [['회수량 평균', S.mean, vu], ['표준편차', S.sd, vu], ['변동계수', S.cv, ''], ['중앙값', S.median, vu], ['최소 ~ 최대', `${fmtX(S.min, 6)} ~ ${fmtX(S.max, 6)}`, vu], ['10% ~ 90%', `${fmtX(S.p10, 6)} ~ ${fmtX(S.p90, 6)}`, vu],
      ['회수 시간 평균(분)', S.durMean / 60, '분'], ['회수 중 평균 유량', S.flowMean, fu], ['최대 유량 평균', S.peakMean, fu]]
      .forEach(([a, b, c]) => { const row = put([a, typeof b === 'number' ? +b.toPrecision(8) : b, c], null, { border: true }); if (a === '변동계수') row.getCell(2).numFmt = '0.0%'; else if (typeof b === 'number') row.getCell(2).numFmt = '#,##0.0##'; });
    const flagged = R.heats.filter(h => h.flags.length);
    note(flagged.length ? `이상 강번: ${flagged.map(h => `${h.id}(${h.flags.join(', ')})`).join(', ')}` : '이상 강번 없음');
    r++;
    if (R.typical && R.typical.best) {
      title('3. 평균 곡선 근사식');
      note(`${formulaTextX(R.typical.best, isPct ? 'p' : 't')}   (${R.typical.best.name}, R² ${fmtR2(R.typical.best.r2)}, ${isPct ? 'p = 진행률 %' : 't = 회수 시작 후 분'}, y = ${fu})`);
      note('회수 곡선은 오르다 내려오는 모양이라 근사식은 참고용. 계획에는 "순시값" 시트의 평균 곡선 값을 쓰는 것이 더 정확함.');
      r++;
    }
    if (R.early.length) {
      title('4. 중간 회수량으로 최종 회수량 예측');
      put(['시작 후(분)', '강번 수', 'R²', '예측 오차(±)', '검증 오차(±)', '식'], XL.head);
      R.early.forEach(e => put([+(e.sec / 60).toPrecision(4), e.n, +fmtR2(e.model.r2), +e.model.rmse.toPrecision(4), e.model.validation ? +e.model.validation.rmse.toPrecision(4) : '-', `최종 = ${fmtX(e.model.params[0], 6)} + ${fmtX(e.model.params[1], 6)} × (c분까지 회수량)`], null, { border: true }));
      if (ep) {
        r++;
        const xw = +mean(ep.x).toPrecision(6);
        put([`${fmt(ep.sec / 60, 3)}분까지 회수량 넣기 →`, xw, '최종 회수량 →', ''], XL.sub);
        const cell = ws3.getRow(r - 1).getCell(4);
        cell.value = { formula: excelFormula(ep.model, `B${r - 1}`), result: ep.model.predict(xw) }; cell.numFmt = '#,##0.0';
        ws3.getRow(r - 1).getCell(2).fill = XL.input.fill;
        note('노란 칸에 회수 중인 강번의 "지금까지 회수량"을 넣으면 최종 회수량 예측이 나와요.');
      }
      note(`평균값으로만 찍으면 오차 ±${fmtX(S.sd)} ${vu}. 이보다 많이 작아야 쓸모 있는 예측.`);
      r++;
    }
    if (F) {
      title('5. 조업 정보와 회수량의 관계');
      put(['항목', '상관계수 r', '1 늘면 회수량', 'R²', 'p값', '판정'], XL.head);
      F.rel.forEach(a => put([a.name, Number.isFinite(a.r) ? +a.r.toFixed(4) : '-', a.model ? +a.model.params[1].toPrecision(5) : '-', a.model ? +fmtR2(a.model.r2) : '-', Number.isFinite(a.p) ? +a.p.toPrecision(3) : '-', sigMark(a.p)], null, { border: true }));
      if (F.multi && !F.multi.error) note(`회수량 = ${joinTerms([[F.multi.b0, ''], ...F.multi.terms.map(tm => [tm.coef, tm.name])], fmtX).replace(/−/g, '-')}   (R² ${fmtR2(F.multi.r2)})`);
      if (F.intensity) { const v = F.intensity.filter(Number.isFinite); if (v.length) note(`회수 원단위(회수량 ÷ ${F.tonName}) 평균 ${fmtX(mean(v))} ${vu}/t`); }
      r++;
    }
    title('6. 용어');
    [['순시값', '그 순간의 유량(속도). 회수량을 구하려면 시간을 곱해 더해야(적분) 함.'], ['중앙값', '크기 순으로 줄 세웠을 때 가운데 값. 튀는 강번에 덜 흔들림.'], ['10~90% 범위', '강번 80%가 들어오는 범위.'], ['변동계수(CV)', '표준편차 ÷ 평균. 강번끼리 얼마나 들쭉날쭉한지.'], ['R²', '식이 실제를 얼마나 잘 설명하는지(1이 완벽).']]
      .forEach(([a, b]) => { const row = put([a, b]); row.getCell(1).font = { bold: true }; ws3.mergeCells(r - 1, 2, r - 1, 7); });
    ws3.views = [{ showGridLines: false }];

    // 시트 순서: 요약, 순시값, 그래프, 함수설명, 원본
    const order = [S0, S1, S2, S3, S4];
    wb.worksheets.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)).forEach((w, i) => { w.orderNo = i; });

    const buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `강번별회수분석_${stamp(R.at)}.xlsx`);
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
    const cfg = store.get('batch:cfg', null);
    bstate.cfg = cfg; setSources(saved, { keepCfg: !!cfg });
  }
})();
// 모드는 모든 화면 스크립트가 준비된 뒤 balance-ui.js 끝에서 정한다
