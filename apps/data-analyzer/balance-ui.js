'use strict';

/* ================================================================
 * 수지(입·출·저장량) 분석 화면. 계산은 balance.js(Balance), 공용 도구는 app.js · batch-ui.js 것을 쓴다.
 * ================================================================ */

const H_CFG0 = { window: 0, reference: '', tol: 0.01 };
const hstate = { sources: [], series: [], warnings: [], cfg: { ...H_CFG0 }, result: null };
const balBtn = $('bal-btn');

function hMsg(text, cls = '') { const m = $('h-msg'); m.textContent = text; m.className = 'msg ' + cls; }

// 계열 설정은 "파일 이름::계열 이름"으로 저장한다 (다른 파일의 같은 이름 계열에 예시 설정이 옮겨 가지 않게)
const roleKey = s => `${s.src}::${s.name}`;
function hSave() {
  const size = hstate.sources.reduce((a, s) => a + s.text.length, 0);
  store.set('bal:sources', size < 3_000_000 ? hstate.sources : []);
  store.set('bal:cfg', { ...hstate.cfg, roles: Object.fromEntries(hstate.series.map(s => [roleKey(s), [s.role, s.unit, s.scale, s.factor || '']])) });
}

function hSetSources(list, msg) {
  hstate.sources = list;
  const ex = Balance.extract(list);
  const saved = store.get('bal:cfg', null);
  ex.series.forEach(s => {
    const r = saved && saved.roles && saved.roles[roleKey(s)];
    if (r) { s.role = r[0]; s.unit = r[1]; s.scale = r[2] || 1; s.factor = r[3] || ''; }
  });
  hstate.series = ex.series; hstate.warnings = ex.warnings; hstate.result = null;
  hSave();
  hRenderSources(); hRenderSetup();
  if (msg) hMsg(msg, 'ok');
}

function hRenderSources() {
  const ul = $('h-sources'); ul.innerHTML = '';
  hstate.sources.forEach((s, i) => {
    const b = el('button', { type: 'button', 'aria-label': `${s.name} 빼기`, text: '×' });
    b.onclick = () => hSetSources(hstate.sources.filter((_, j) => j !== i));
    ul.append(el('li', {}, el('span', { text: s.name }), el('small', { text: `${s.text.split('\n').length - 1}줄` }), b));
  });
  if (!hstate.sources.length) hMsg('');
}

$('h-files').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  hMsg(`파일 ${files.length}개를 읽는 중…`);
  const add = [], errs = [];
  for (const f of files) {
    try { const sheets = await fileToSheets(f); sheets.forEach(sh => add.push({ name: sheets.length > 1 ? `${f.name.replace(/\.[^.]+$/, '')} · ${sh.name}` : f.name, text: sh.text })); }
    catch (err) { errs.push(`${f.name}: ${err.message}`); }
  }
  try {
    hSetSources([...hstate.sources, ...add]);
    hMsg(`${add.length}개를 추가했어요.${errs.length ? ' 읽지 못한 파일: ' + errs.join(' / ') : ''}`, errs.length ? 'err' : 'ok');
  } catch (err) { console.error(err); hMsg(`파일을 정리하다 문제가 생겼어요: ${err.message}`, 'err'); }
};
$('h-paste-add').onclick = () => {
  const t = $('h-paste').value;
  if (!t.trim()) { hMsg('붙여넣은 표가 없어요', 'err'); return; }
  hSetSources([...hstate.sources, { name: `붙여넣기 ${hstate.sources.length + 1}`, text: t }]);
  $('h-paste').value = ''; hMsg('표를 추가했어요', 'ok');
};
function hLoadDemo(d, msg) {
  store.set('bal:cfg', null);
  hstate.cfg = { ...H_CFG0 };
  hSetSources(d.sources);
  // 예시의 레벨 환산값은 예시 파일의 레벨 계열에만 넣는다
  if (d.levelFactor) hstate.series.filter(s => s.role === 'level').forEach(s => { s.factor = String(d.levelFactor); });
  hSave(); hRenderSetup();
  toast(msg, 5500);
}
$('h-demo').onclick = () => hLoadDemo(Balance.demo(), '예시: 가스 홀더 24시간. 회수 5초, 사용처 1분, 레벨 30초 간격으로 시간축이 모두 달라요. 발전소 +4%, 가열로 −3% 계측 오차와 시간당 500 Nm³ 손실을 넣어 두었어요');
$('h-demo2').onclick = () => hLoadDemo(Balance.demoTank(), '예시: 물탱크 3일 (1분 기록). 탱크 크기를 모르는 경우예요. 2번 펌프 −5%, 세척 라인 +6% 계측 오차와 시간당 1.5 m³ 누수를 넣어 두었어요');
$('h-clear').onclick = () => { hstate.cfg = { ...H_CFG0 }; store.set('bal:cfg', null); hSetSources([]); };

/* ---------- 설정 ---------- */
const fmtClock = sec => {
  if (!Number.isFinite(sec)) return '-';
  const p2 = n => String(n).padStart(2, '0');
  if (sec > 1e8) { const d = new Date(sec * 1000); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`; }
  const day = Math.floor(sec / 86400);
  return `${day ? `(+${day}일) ` : ''}${p2(Math.floor(sec / 3600) % 24)}:${p2(Math.floor(sec / 60) % 60)}:${p2(Math.floor(sec % 60))}`;
};
const fmtDur = s => (!Number.isFinite(s) ? '-' : s >= 172800 ? `${fmt(s / 86400, 3)}일` : s >= 3600 ? `${fmt(s / 3600, 3)}시간` : s >= 60 ? `${fmt(s / 60, 3)}분` : `${fmt(s, 3)}초`);
const isFlow = s => s.role === 'in' || s.role === 'out';

/** 설정이 바뀌면 이전 결과는 버리고(오래된 결과로 엑셀이 나가지 않게), 결과가 있었으면 다시 계산 */
function hChanged() {
  const had = !!hstate.result;
  hstate.result = null;
  hSave(); hRenderSetup();
  if (had) hRun();
}

function hRenderSetup() {
  const has = hstate.series.length > 0;
  $('h-setup').hidden = !has; $('h-results').hidden = true;
  hUpdateButton();
  if (!has) { if (hstate.warnings.length) hMsg(hstate.warnings.join(' / '), 'err'); return; }
  const t = $('h-series'); t.innerHTML = '';
  t.append(el('tr', {}, ...['계열', '역할', '단위 · 환산'].map(h => el('th', { text: h }))));
  hstate.series.forEach(s => {
    const role = el('select', { 'aria-label': `${s.name} 역할` });
    Object.entries(Balance.ROLE_LABEL).forEach(([k, v]) => role.append(el('option', { value: k, text: v })));
    role.value = s.role;
    role.onchange = () => { s.role = role.value; hChanged(); };
    const cell = el('td');
    if (isFlow(s)) {
      const unit = el('select', { 'aria-label': `${s.name} 시간 단위` });
      [['h', '/h'], ['min', '/min'], ['s', '/s'], ['d', '/일']].forEach(([k, v]) => unit.append(el('option', { value: k, text: v })));
      unit.value = s.unit; unit.onchange = () => { s.unit = unit.value; hChanged(); };
      const scale = el('select', { 'aria-label': `${s.name} 배수` });
      [[1, '×1'], [1000, '×1000 (k·천)'], [1e6, '×100만 (M)']].forEach(([k, v]) => scale.append(el('option', { value: String(k), text: v })));
      scale.value = String(s.scale || 1); scale.onchange = () => { s.scale = +scale.value; hChanged(); };
      cell.append(unit, scale);
    } else if (s.role === 'level') {
      const f = el('input', { class: 'num', type: 'number', inputmode: 'decimal', step: 'any', min: '0', placeholder: '1단위당 부피 (모름)', value: s.factor || '', 'aria-label': `${s.name} 1단위당 부피` });
      f.onchange = () => { s.factor = toNumber(f.value) > 0 ? f.value : ''; hChanged(); };
      cell.append(f);
    } else cell.append(el('small', { class: 'hint', text: s.role === 'volume' ? '부피 그대로' : '-' }));
    t.append(el('tr', {}, el('td', {}, el('div', { text: s.name }), el('small', { class: 'hint', text: `${s.t.length}개 · ${fmtDur(s.dt)}마다` })), el('td', {}, role), cell));
  });
  const holders = hstate.series.filter(s => s.role === 'volume' || s.role === 'level');
  const flows = hstate.series.filter(isFlow);
  const needRef = holders.length === 1 && holders[0].role === 'level' && !(toNumber(holders[0].factor) > 0);
  $('h-ref-f').hidden = !needRef;
  const rs = $('h-ref'); rs.innerHTML = '';
  flows.forEach(s => rs.append(el('option', { value: s.name, text: `${s.name} (${Balance.ROLE_LABEL[s.role]})` })));
  rs.value = flows.some(s => s.name === hstate.cfg.reference) ? hstate.cfg.reference : (flows.find(s => s.role === 'in') || flows[0] || {}).name || '';
  hstate.cfg.reference = rs.value;
  $('h-window').value = String(hstate.cfg.window); $('h-tol').value = String(hstate.cfg.tol);
  const used = hstate.series.filter(s => s.role !== 'ignore');
  const T0 = used.length ? maxOf(used.map(s => s.t[0])) : NaN, T1 = used.length ? minOf(used.map(s => s.t[s.t.length - 1])) : NaN;
  const levelNoFactor = holders.filter(h => h.role === 'level' && !(toNumber(h.factor) > 0));
  $('h-found').textContent = `${!flows.length ? '⚠ 유량 계열이 없어요. ' : ''}${!holders.length ? '저장 레벨 계열이 없으면 합계만 계산해요. ' : ''}${holders.length > 1 && levelNoFactor.length ? '⚠ 저장소가 2개 이상이면 레벨마다 1단위당 부피를 넣어주세요. ' : ''}함께 기록된 기간: ${T1 > T0 ? `${fmtClock(T0)} ~ ${fmtClock(T1)} (${fmtDur(T1 - T0)})` : '없음'}${hstate.warnings.length ? ` · ⚠ ${hstate.warnings.join(' / ')}` : ''}`;
  hUpdateButton();
}

$('h-ref').onchange = e => { hstate.cfg.reference = e.target.value; hChanged(); };
$('h-window').onchange = e => { hstate.cfg.window = +e.target.value; hChanged(); };
$('h-tol').onchange = e => { hstate.cfg.tol = +e.target.value; hChanged(); };

function hUpdateButton() {
  const flows = hstate.series.filter(isFlow);
  if (!hstate.series.length) { balBtn.disabled = true; balBtn.textContent = '유량·레벨 파일을 넣어주세요'; return; }
  if (!flows.length) { balBtn.disabled = true; balBtn.textContent = '유량 계열을 골라주세요'; return; }
  balBtn.disabled = false;
  balBtn.textContent = hstate.result && !hstate.result.error ? '엑셀 파일 받기' : '분석하기';
}
balBtn.onclick = () => {
  if (hstate.result && !hstate.result.error) hExport();
  else { hRun(); if (hstate.result && !hstate.result.error) $('h-results').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
};

/* ---------- 분석 ---------- */
function hRun() {
  const res = Balance.analyze(hstate.series, { window: hstate.cfg.window || 0, reference: hstate.cfg.reference, tol: hstate.cfg.tol });
  hstate.result = res;
  if (res.error) { toast(res.error, 4000); $('h-results').hidden = true; hUpdateButton(); return; }
  res.at = new Date();
  res.u = res.au || '(부피)';
  hRender();
  hUpdateButton();
}

const readWord = v => `${fmt(Math.abs(v) * 100, 3)}% ${v > 0 ? '많게' : '적게'}`;
const VERDICT = {
  bias: '편차 있음', small: '차이는 있지만 허용 범위', ok: '정상', likely: '편차 없어 보임 (확신 부족)',
  unknown: '판단 불가 (범위가 넓음)', data: '데이터 확인 필요', common: '환산값 의심', fixed: '일정 (계산 안 함)', ref: '기준',
};
const verdictCls = v => (v === 'bias' ? 'flag' : v === 'ok' || v === 'likely' ? 'ok' : 'meh');

function hRender() {
  const R = hstate.result, u = R.u;
  $('h-results').hidden = false;
  const sm = $('h-summary'); sm.innerHTML = '';
  const add = html => sm.append(el('li', { html }));
  add(`기간 ${esc(fmtClock(R.T0))} ~ ${esc(fmtClock(R.T1))} (${fmtDur(R.T1 - R.T0)}) 동안 유입 합계 <b>${fmt(R.tin, 6)}</b>, 유출 합계 <b>${fmt(R.tout, 6)}</b> ${esc(u)}예요.`);
  const longGap = R.totals.filter(t => t.maxGap > Math.max(600, 10 * t.dt));
  if (longGap.length) add(`⚠ 기록이 오래 빈 계열: ${longGap.map(t => `${esc(t.name)} (가장 긴 빈틈 ${fmtDur(t.maxGap)})`).join(', ')}. 위 합계에는 빈틈을 선으로 이은 값이 들어 있어요.`);
  if (R.note) add(esc(R.note));
  if (R.regError) add(`⚠ ${esc(R.regError)}`);
  if (R.beta) {
    const fac = R.factorEstimated ? ` (레벨 1단위 = ${fmt(R.factor, 5)} ${esc(u)}로 추정, 기준: ${esc(R.reference)})` : '';
    add(`빈틈 없는 ${fmtDur(R.okHours * 3600)} 동안 저장량 변화는 ${fmt(R.dV, 5)} ${esc(u)}${fac}. 계측값대로면 <b>${fmt(Math.abs(R.gap), 5)} ${esc(u)} (${fmt(Math.abs(R.gapPct) * 100, 3)}%)</b>가 ${R.gap > 0 ? '어디론가 사라졌어요' : '어디선가 더 들어왔어요'}.`);
    const bad = R.beta.filter(b => b.verdict === 'bias');
    const doubt = R.beta.filter(b => b.verdict === 'data' || b.verdict === 'unknown');
    add(bad.length
      ? `편차가 있는 계측기: ${bad.map(b => `<b>${esc(b.name)}</b> (실제보다 ${readWord(b.readErr)} 읽음)`).join(', ')}`
      : `허용 오차(±${fmt(hstate.cfg.tol * 100, 2)}%)를 넘는 계측기는 찾지 못했어요.${doubt.length ? '' : ''}`);
    if (doubt.length) add(`⚠ 판단하기 어려운 계열: ${doubt.map(b => `${esc(b.name)} (${b.verdict === 'data' ? esc(b.why || '데이터 확인') : '범위가 넓음'})`).join(', ')}. 단위·역할·시각 정렬·구간 길이를 확인하거나, 운전 패턴이 다른 기간 데이터를 더 넣어보세요.`);
    add(`계측되지 않는 순유입은 <b>${fmt(R.aRate, 4)} ${esc(u)}/h</b> (95% 범위 ${fmt(R.aCI[0], 4)} ~ ${fmt(R.aCI[1], 4)})예요. ${R.aCI[1] < 0 ? '음수라서 누설·방산·계측 안 되는 사용처가 있다는 뜻이에요.' : R.aCI[0] > 0 ? '양수라서 계측 안 되는 유입이 있다는 뜻이에요.' : '0과 구분되지 않아요.'}`);
    add(`보정계수를 적용하면 구간(${fmtDur(R.window)})마다 수지 차이가 평균 ${fmt(R.rmsBefore, 4)} → ${fmt(R.rmsAfter, 4)} ${esc(u)}로 바뀌어요 (구간 ${R.used}개). ${R.rmsAfter <= 1.5 * R.noiseFloor ? `남은 차이는 레벨 측정 잡음(약 ${fmt(R.noiseFloor, 3)}) 수준이에요.` : R.rmsAfter < R.rmsBefore * 0.5 ? '보정계수가 차이 대부분을 설명해요.' : '보정 후에도 차이가 커요. 레벨 환산, 시간 지연, 계측 안 되는 양의 변동 같은 다른 원인이 있을 수 있어요.'}`);
    const hv = R.beta.filter(b => b.vif > 5);
    if (hv.length) add(`⚠ ${hv.map(b => esc(b.name)).join(', ')}: 다른 계열과 같이 움직여서 편차를 구분하기 어려워요 (VIF > 5).`);
  }
  (R.notes || []).forEach(n => add(`ℹ ${esc(n)}`));

  // 계측기 편차 표
  const bt = $('h-beta'); bt.innerHTML = '';
  $('h-beta-panel').hidden = !R.beta;
  if (R.beta) {
    bt.append(el('tr', {}, ...['계열', '역할', '보정계수 β', '95% 범위', '계측값이 실제보다', 'p값', 'VIF', '판정'].map(h => el('th', { text: h }))));
    R.beta.forEach(b => {
      const plain = b.ref || b.fixed;
      bt.append(el('tr', {},
        el('td', { text: b.name }), el('td', { text: Balance.ROLE_LABEL[b.role] }), el('td', { text: b.ref ? '1 (기준)' : b.fixed ? '1 (고정)' : fmt(b.est, 4) }),
        el('td', { text: plain ? '-' : `${fmt(b.lo, 4)} ~ ${fmt(b.hi, 4)}` }),
        el('td', { text: plain || b.verdict === 'data' ? '-' : readWord(b.readErr) }),
        el('td', { text: fmtP(b.p) }), el('td', { text: Number.isFinite(b.vif) ? fmt(b.vif, 3) : '-' }),
        el('td', { class: verdictCls(b.verdict), text: VERDICT[b.verdict] + (b.verdict === 'data' && b.why ? ` (${b.why})` : '') })));
    });
  }

  // 누적 그래프
  const cw = $('h-cum'); cw.innerHTML = '';
  $('h-cum-panel').hidden = !R.cum;
  if (R.cum) {
    requestAnimationFrame(() => mountChart(cw, cumSpec(R)));
    const iw = $('h-imb'); iw.innerHTML = '';
    const ix = R.imbalance.map(c => (c.t - R.T0) / 3600);
    requestAnimationFrame(() => mountChart(iw, { x: ix, y: R.imbalance.map(c => c.v), fn: () => 0, fitLabel: '0 (수지 맞음)', pointLabel: '구간별 차이', xLabel: '시작 후(시간)', yLabel: `저장 − (유입 − 유출) (${u})`, tip: i => `${esc(fmtClock(R.imbalance[i].t))}<br>차이 <b>${fmt(R.imbalance[i].v, 4)}</b> ${esc(u)}` }));
  }

  // 계열별 합계
  const tt = $('h-totals'); tt.innerHTML = '';
  tt.append(el('tr', {}, ...['계열', '역할', '기록 간격', `합계(${u})`, `평균(${u}/h)`, '가장 긴 빈틈'].map(h => el('th', { text: h }))));
  R.totals.forEach(t => tt.append(el('tr', {}, el('td', { text: t.name }), el('td', { text: Balance.ROLE_LABEL[t.role] }), el('td', { text: fmtDur(t.dt) }),
    el('td', { text: fmt(t.volume, 6) }), el('td', { text: fmt(t.perHour, 5) }), el('td', { class: t.maxGap > Math.max(600, 10 * t.dt) ? 'flag' : '', text: fmtDur(t.maxGap) }))));
  tt.append(el('tr', { class: 'sum' }, el('td', { text: '유입 합계' }), el('td'), el('td'), el('td', { text: fmt(R.tin, 6) }), el('td'), el('td')));
  tt.append(el('tr', { class: 'sum' }, el('td', { text: '유출 합계' }), el('td'), el('td'), el('td', { text: fmt(R.tout, 6) }), el('td'), el('td')));
  tt.append(el('tr', { class: 'sum' }, el('td', { text: '유입 − 유출' }), el('td'), el('td'), el('td', { text: fmt(R.tin - R.tout, 6) }), el('td'), el('td')));
}

// 누적 차이: 저장량 실제 변화 − 계측 순유입. 계측이 맞으면 0 근처에 머문다
function cumSpec(R) {
  const x = R.cum.map(c => (c.t - R.T0) / 3600);
  const raw = R.cum.map(c => c.holder - c.metered), cor = R.cum.map(c => c.holder - c.corrected);
  return {
    x, y: raw, flagged: raw.map(() => true), pointLabel: '계측값 그대로', overlay: { x, y: cor }, overlayLabel: '보정 후', fn: () => 0, fitLabel: '0 (수지 맞음)',
    xLabel: '시작 후(시간)', yLabel: `누적 차이(${R.u})`,
    tip: i => `${esc(fmtClock(R.cum[i].t))}<br>계측값 그대로 누적 차이 <b>${fmt(raw[i], 5)}</b><br>보정 후 ${fmt(cor[i], 4)}`,
  };
}

/* ---------- 엑셀 ---------- */
async function hExport() {
  const R = hstate.result; if (!R || R.error) return;
  balBtn.disabled = true; balBtn.textContent = '엑셀 만드는 중…';
  try {
    const ExcelJS = await getExcelJS();
    const wb = new ExcelJS.Workbook(); wb.creator = '데이터 분석기'; wb.created = new Date();
    const u = R.u;
    const S0 = '계열별 합계', S1 = '순시값', S2 = '구간별 수지', S3 = '그래프', S4 = '함수설명';
    const head = (ws, h) => { ws.addRow(h); styleRow(ws.getRow(1), XL.head, 1, h.length); ws.getRow(1).height = 30; };

    // 계열별 합계 (+ 보정)
    const ws0 = wb.addWorksheet(S0, { views: [{ state: 'frozen', ySplit: 1 }] });
    const h0 = ['계열', '역할', '기록 수', '기록 간격(초)', `합계(${u})`, `평균(${u}/h)`, '보정계수 β', `보정 후 합계(${u})`, '계측값이 실제보다', '판정'];
    head(ws0, h0);
    R.totals.forEach((t, i) => {
      const b = R.beta && R.beta[i], rr = i + 2;
      const vol = +t.volume.toPrecision(10), be = b ? +b.est.toPrecision(12) : 1;
      const row = ws0.addRow([t.name, Balance.ROLE_LABEL[t.role], t.n, +t.dt.toPrecision(4), vol, +t.perHour.toPrecision(8), be, null, b && !b.ref && !b.fixed && b.verdict !== 'data' ? b.readErr : null, b ? VERDICT[b.verdict] : '']);
      row.getCell(8).value = { formula: `E${rr}*G${rr}`, result: vol * be };
      row.getCell(7).fill = XL.input.fill; row.getCell(9).numFmt = '+0.00%;-0.00%';
      [5, 6, 8].forEach(c => { row.getCell(c).numFmt = '#,##0.0##'; });
      row.eachCell({ includeEmpty: true }, c => { c.border = XL.border; });
    });
    const rin = [], rout = [];
    R.totals.forEach((t, i) => (t.role === 'in' ? rin : rout).push(i + 2));
    const sumOf = (rows, col) => (rows.length ? rows.map(r2 => `${col}${r2}`).join('+') : '0');
    const vols = R.totals.map(t => +t.volume.toPrecision(10));
    const sIn = R.totals.reduce((a, t, i) => a + (t.role === 'in' ? vols[i] : 0), 0), sOut = R.totals.reduce((a, t, i) => a + (t.role === 'out' ? vols[i] : 0), 0);
    ws0.addRow(['']);
    // 각 줄의 실제 행 번호를 받아서 수식에 쓴다
    const add = (label, f, res) => { const row = ws0.addRow([label]); row.getCell(5).value = { formula: f, result: res }; row.getCell(5).numFmt = '#,##0.0##'; styleRow(row, XL.sub, 1, 5); return row.number; };
    add('유입 합계', sumOf(rin, 'E'), sIn);
    add('유출 합계', sumOf(rout, 'E'), sOut);
    const rDiff = ws0.rowCount + 1; add('유입 − 유출', `E${rDiff - 2}-E${rDiff - 1}`, sIn - sOut);
    if (R.beta) {
      ws0.addRow(['']);
      ws0.addRow([`수지 차이(빈틈 없는 ${fmtDur(R.okHours * 3600)}): 유입 ${fmtX(R.okIn, 8)} − 유출 ${fmtX(R.okOut, 8)} − 저장량 변화 ${fmtX(R.dV, 8)} = ${fmtX(R.gap, 6)} ${u} (${fmt(R.gapPct * 100, 3)}%)`]);
      ws0.addRow([`보정계수(노란 칸)는 수정할 수 있어요. 계측되지 않는 순유입: ${fmtX(R.aRate)} ${u}/h (95% ${fmtX(R.aCI[0])} ~ ${fmtX(R.aCI[1])})`]);
    }
    ws0.columns.forEach((c, i) => { c.width = [22, 14, 9, 12, 16, 16, 12, 18, 16, 22][i] || 12; });

    // 순시값: 공통 시간축
    const cg = Balance.commonGrid(hstate.series, R.T0, R.T1);
    const ws1 = wb.addWorksheet(S1, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
    const fl = cg.cols.filter(c => c.role === 'in' || c.role === 'out');
    head(ws1, ['시각', ...cg.cols.map(c => `${c.name}${c.role === 'level' || c.role === 'volume' ? '' : ` [${Balance.ROLE_LABEL[c.role]}]`}`), `유입 합계(${u}/h)`, `유출 합계(${u}/h)`, '유입 − 유출']);
    // 유량 단위가 달라도 합계는 시간당·같은 배수로 맞춘다
    const perH = c => 3600 / Balance.UNIT_SEC[c.unit || 'h'] * (c.scale || 1);
    cg.grid.forEach((x, k) => {
      const vals = cg.cols.map(c => (Number.isFinite(c.v[k]) ? +c.v[k].toPrecision(8) : null));
      const si = fl.filter(c => c.role === 'in').reduce((a, c) => a + c.v[k] * perH(c), 0), so = fl.filter(c => c.role === 'out').reduce((a, c) => a + c.v[k] * perH(c), 0);
      const r8 = v => (Number.isFinite(v) ? +v.toPrecision(8) : null);
      ws1.addRow([fmtClock(x), ...vals, r8(si), r8(so), r8(si - so)]);
    });
    ws1.columns.forEach((c, i) => { c.width = i ? 15 : 20; });
    ws1.addRow([]); ws1.addRow([`공통 시간축: ${fmtDur(cg.step)} 간격. 각 계열을 자기 측정 시각 사이에서 선형 보간했어요. 합계 칸은 ${u}/h 기준. 정확한 합계는 "계열별 합계" 시트 값을 쓰세요.`]);

    // 구간별 수지
    if (R.windows) {
      const ws2 = wb.addWorksheet(S2, { views: [{ state: 'frozen', ySplit: 1 }] });
      head(ws2, ['구간 시작', '구간 끝', ...R.flows.map((f, i) => `${f} (${R.roles[i] === 'in' ? '+' : '−'}, ${u})`), ...R.holders.map(h => `${h} 변화`), `저장량 변화(${u})`, `계측 순유입(${u})`, `차이(${u})`]);
      R.windows.forEach((w, k) => {
        const net = w.F.reduce((a, v, i) => a + (R.roles[i] === 'in' ? v : -v), 0);
        const st = w.L.reduce((a, d, h) => a + R.factors[h] * d, 0);
        ws2.addRow([fmtClock(w.a), fmtClock(w.b), ...w.F.map(v => +v.toPrecision(8)), ...w.L.map(v => +v.toPrecision(6)), +st.toPrecision(8), +net.toPrecision(8), +R.imbalance[k].v.toPrecision(6)]);
      });
      ws2.columns.forEach((c, i) => { c.width = i < 2 ? 20 : 16; });
      if (R.lag) ws2.addRow([`레벨은 ${R.lag}초 ${R.lag > 0 ? '뒤' : '앞'} 시각 값으로 맞췄어요 (레벨 기록 지연 보정).`]);
    }

    // 그래프
    const ws3 = wb.addWorksheet(S3);
    ws3.getCell('A1').value = '그래프'; ws3.getCell('A1').font = { bold: true, size: 16 };
    const charts = [];
    if (R.cum) {
      charts.push({ ...cumSpec(R), title: '누적 수지 차이', subtitle: '저장량 실제 − 계측 순유입' });
      charts.push({ x: R.imbalance.map(c => (c.t - R.T0) / 3600), y: R.imbalance.map(c => c.v), fn: () => 0, fitLabel: '0', pointLabel: '구간별 차이', xLabel: '시작 후(시간)', yLabel: `저장 − 계측 순유입(${u})`, title: '구간별 수지 차이', subtitle: `구간 ${fmtDur(R.window)}` });
    }
    const hx = cg.grid.map(g => (g - R.T0) / 3600);
    fl.forEach(c => charts.push({ x: hx, y: c.v, line: true, hidePoints: true, overlay: { x: hx, y: c.v }, overlayLabel: c.name, xLabel: '시작 후(시간)', yLabel: c.name, title: c.name, subtitle: Balance.ROLE_LABEL[c.role] }));
    charts.slice(0, 10).forEach((spec, k) => {
      const id = wb.addImage({ base64: chartPNG(spec), extension: 'png' });
      ws3.addImage(id, { tl: { col: (k % 2) * 10 + 0.2, row: 2 + Math.floor(k / 2) * 20 }, ext: { width: 620, height: 349 } });
    });

    // 함수설명
    const ws4 = wb.addWorksheet(S4);
    ws4.columns = [{ width: 24 }, { width: 90 }];
    const line = (a, b, bold) => { const row = ws4.addRow([a, b]); if (bold) row.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1D5FA8' } }; row.getCell(2).alignment = { wrapText: true, vertical: 'top' }; return row; };
    ws4.addRow(['수지(입·출·저장량) 분석 결과']).getCell(1).font = { bold: true, size: 18 };
    line('분석일', R.at.toLocaleString('ko-KR'));
    line('기간', `${fmtClock(R.T0)} ~ ${fmtClock(R.T1)} (${fmtDur(R.T1 - R.T0)})`);
    ws4.addRow([]);
    line('1. 계산 방법', '', true);
    line('합계', '유량(순시값)을 자기 측정 시각 그대로 사다리꼴 공식으로 적분. 계열마다 시간축이 달라도 됨 (공통 시간축으로 바꾸지 않고 적분).');
    line('수지 식', '구간마다  c·ΔL = Σ sᵢ·βᵢ·Fᵢ + a·Δt  (ΔL: 레벨 변화, c: 레벨 1단위당 부피, Fᵢ: 구간 적분 유량, sᵢ: 유입 +1/유출 −1, βᵢ: 보정계수, a: 계측 안 되는 순유입)');
    line('빈 구간', '구간 안에 유량 기록 빈틈(측정 간격 3배 또는 구간의 1/10 넘음)이나 레벨 기록 빈틈(측정 간격 3배 넘음)이 있으면 그 구간은 쓰지 않음.');
    line('보정계수 β', '실제 유량 = β × 계측값. β > 1 이면 계측값이 실제보다 적게, β < 1 이면 많게 읽음. 여러 구간의 최소제곱으로 구함.');
    line('판정', `편차 있음: 95% 범위가 1을 포함하지 않고(p < 0.05) 차이가 ±${fmt(hstate.cfg.tol * 100, 2)}%보다 큼. 정상: 95% 범위 전체가 허용 오차 안. 데이터 확인: β가 0.7~1.3 밖, 범위가 ±20%보다 넓음, 구간마다 양이 거의 같음.`);
    if (R.factorEstimated) line('레벨 환산', `레벨 1단위당 부피를 몰라서 "${R.reference}" 계측기를 기준(β=1)으로 놓고 c = ${fmtX(R.factor, 6)} ${u}/단위 로 추정 (95% ${fmtX(R.cCI[0], 6)} ~ ${fmtX(R.cCI[1], 6)}). 레벨 잡음이 결과를 한쪽으로 끌지 않게 ΔL = Σ g·s·F + g₀ 로 푼 뒤 c = 1/g_기준, β = g/g_기준.`);
    else if (R.beta) line('레벨 환산', R.holders.map((h, i) => `${h}: 1단위당 ${fmtX(R.factors[i], 6)} ${u}`).join(', '));
    ws4.addRow([]);
    line('2. 결과', '', true);
    line('유입 / 유출', `${fmtX(R.tin, 8)} / ${fmtX(R.tout, 8)} ${u}`);
    if (R.regError) line('수지 회귀', R.regError);
    if (R.beta) {
      line('수지 차이', `${fmtX(R.gap, 6)} ${u} (${fmt(R.gapPct * 100, 3)}%) — 계측값 그대로, 빈틈 없는 ${fmtDur(R.okHours * 3600)}`);
      R.beta.forEach(b => line(b.name, b.ref ? '기준 계측기 (β = 1)' : b.fixed ? '구간마다 일정 (β = 1로 둠)' : `β = ${fmtX(b.est, 5)} (95% ${fmtX(b.lo, 5)} ~ ${fmtX(b.hi, 5)})${b.verdict === 'data' ? '' : `, 계측값이 실제보다 ${readWord(b.readErr)} 읽음`} → ${VERDICT[b.verdict]}${b.why ? ` (${b.why})` : ''}`));
      line('계측 안 되는 순유입', `${fmtX(R.aRate)} ${u}/h (95% ${fmtX(R.aCI[0])} ~ ${fmtX(R.aCI[1])})`);
      line('설명력', `R² = ${fmtR2(R.r2)}, 구간 ${R.used}개 × ${fmtDur(R.window)}, 구간별 차이 ${fmtX(R.rmsBefore)} → ${fmtX(R.rmsAfter)} ${u}`);
    } else if (R.note) line('참고', R.note);
    (R.notes || []).forEach(n => line('참고', n));
    hstate.warnings.forEach(w => line('읽기 알림', w));
    ws4.addRow([]);
    line('3. 주의', '', true);
    line('레벨 → 부피', '레벨을 부피로 바꿀 때 온도·압력 보정(표준 상태 환산)이 필요할 수 있어요. 환산이 틀리면 모든 β가 같은 비율로 틀어져요.');
    line('구분 가능성', 'VIF가 5를 넘는 계열은 다른 계열과 같이 움직여서 편차를 따로 구분하기 어려워요. 운전 패턴이 다른 기간 데이터를 더 넣으세요.');
    line('구간 길이', '너무 짧으면 레벨 센서 잡음에 묻히고, 너무 길면 구간 수가 적어져요. 결과가 구간 길이에 따라 크게 바뀌면 믿기 어려워요.');

    wb.worksheets.sort((a, b) => [S0, S1, S2, S3, S4].indexOf(a.name) - [S0, S1, S2, S3, S4].indexOf(b.name)).forEach((w, i) => { w.orderNo = i; });
    const buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `수지분석_${stamp(R.at)}.xlsx`);
    toast('엑셀 파일을 저장했어요');
  } catch (e) {
    console.error(e);
    toast('엑셀을 만들지 못했어요: ' + e.message, 4000);
  } finally { hUpdateButton(); }
}

/* ---------- 시작 ---------- */
(function initBalance() {
  const cfg = store.get('bal:cfg', null);
  if (cfg) hstate.cfg = { window: +cfg.window || 0, reference: cfg.reference || '', tol: +cfg.tol || 0.01 };
  const saved = store.get('bal:sources', []);
  if (Array.isArray(saved) && saved.length) {
    try { hSetSources(saved); }
    catch (e) { console.error(e); store.set('bal:sources', []); store.set('bal:cfg', null); hstate.sources = []; hstate.series = []; }
  }
})();

setMode(['single', 'batch', 'bal'].includes(store.get('mode', 'single')) ? store.get('mode', 'single') : 'single');
