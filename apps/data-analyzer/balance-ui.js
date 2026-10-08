'use strict';

/* ================================================================
 * 홀더 수지 화면. 계산은 balance.js(Balance), 공용 도구는 app.js · batch-ui.js 것을 쓴다.
 * ================================================================ */

const hstate = { sources: [], series: [], warnings: [], cfg: { window: 0, levelFactor: '', reference: '', tol: 0.01 }, result: null };
const balBtn = $('bal-btn');

function hMsg(text, cls = '') { const m = $('h-msg'); m.textContent = text; m.className = 'msg ' + cls; }

function hSave() {
  const size = hstate.sources.reduce((a, s) => a + s.text.length, 0);
  store.set('bal:sources', size < 3_000_000 ? hstate.sources : []);
  store.set('bal:cfg', { ...hstate.cfg, roles: Object.fromEntries(hstate.series.map(s => [s.name, [s.role, s.unit]])) });
}

function hSetSources(list) {
  hstate.sources = list;
  const ex = Balance.extract(list);
  const saved = store.get('bal:cfg', null);
  ex.series.forEach(s => { const r = saved && saved.roles && saved.roles[s.name]; if (r) { s.role = r[0]; s.unit = r[1]; } });
  hstate.series = ex.series; hstate.warnings = ex.warnings; hstate.result = null;
  hSave();
  hRenderSources(); hRenderSetup();
}

function hRenderSources() {
  const ul = $('h-sources'); ul.innerHTML = '';
  hstate.sources.forEach((s, i) => {
    const b = el('button', { type: 'button', 'aria-label': `${s.name} 빼기`, text: '×' });
    b.onclick = () => hSetSources(hstate.sources.filter((_, j) => j !== i));
    ul.append(el('li', {}, el('span', { text: s.name }), el('small', { text: `${s.text.split('\n').length - 1}줄` }), b));
  });
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
  hSetSources([...hstate.sources, ...add]);
  hMsg(`${add.length}개를 추가했어요.${errs.length ? ' 읽지 못한 파일: ' + errs.join(' / ') : ''}`, errs.length ? 'err' : 'ok');
};
$('h-paste-add').onclick = () => {
  const t = $('h-paste').value;
  if (!t.trim()) { hMsg('붙여넣은 표가 없어요', 'err'); return; }
  hSetSources([...hstate.sources, { name: `붙여넣기 ${hstate.sources.length + 1}`, text: t }]);
  $('h-paste').value = ''; hMsg('표를 추가했어요', 'ok');
};
$('h-demo').onclick = () => {
  const d = Balance.demo();
  store.set('bal:cfg', null);
  hstate.cfg = { window: 0, levelFactor: String(d.levelFactor), reference: '', tol: 0.01 };
  hSetSources(d.sources);
  toast('예시: 홀더 1기 24시간. 회수 5초, 사용처 1분, 레벨 30초 간격으로 시간축이 모두 달라요. 발전소 +4%, 가열로 −3% 계측 오차를 넣어 두었어요', 5000);
};
$('h-clear').onclick = () => { hstate.cfg = { window: 0, levelFactor: '', reference: '', tol: 0.01 }; store.set('bal:cfg', null); hSetSources([]); };

/* ---------- 설정 ---------- */
const fmtClock = sec => {
  const p2 = n => String(n).padStart(2, '0');
  if (sec > 1e8) { const d = new Date(sec * 1000); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`; }
  const day = Math.floor(sec / 86400);
  return `${day ? `(+${day}일) ` : ''}${p2(Math.floor(sec / 3600) % 24)}:${p2(Math.floor(sec / 60) % 60)}:${p2(Math.floor(sec % 60))}`;
};
const fmtDur = s => (s >= 3600 ? `${fmt(s / 3600, 3)}시간` : s >= 60 ? `${fmt(s / 60, 3)}분` : `${fmt(s, 3)}초`);

function hRenderSetup() {
  const has = hstate.series.length > 0;
  $('h-setup').hidden = !has; $('h-results').hidden = true;
  hUpdateButton();
  if (!has) { if (hstate.warnings.length) hMsg(hstate.warnings.join(' / '), 'err'); return; }
  const t = $('h-series'); t.innerHTML = '';
  t.append(el('tr', {}, ...['계열', '역할', '단위'].map(h => el('th', { text: h }))));
  hstate.series.forEach(s => {
    const role = el('select', { 'aria-label': `${s.name} 역할` });
    Object.entries(Balance.ROLE_LABEL).forEach(([k, v]) => role.append(el('option', { value: k, text: v })));
    role.value = s.role;
    role.onchange = () => { s.role = role.value; hSave(); hRenderSetup(); };
    const unit = el('select', { 'aria-label': `${s.name} 단위` });
    [['h', '/h'], ['min', '/min'], ['s', '/s']].forEach(([k, v]) => unit.append(el('option', { value: k, text: v })));
    unit.value = s.unit; unit.disabled = !(s.role === 'in' || s.role === 'out');
    unit.onchange = () => { s.unit = unit.value; hSave(); };
    t.append(el('tr', {}, el('td', {}, el('div', { text: s.name }), el('small', { class: 'hint', text: `${s.t.length}개 · ${fmtDur(s.dt)}마다` })), el('td', {}, role), el('td', {}, unit)));
  });
  const holder = hstate.series.find(s => s.role === 'volume') || hstate.series.find(s => s.role === 'level');
  $('h-factor-f').hidden = !holder || holder.role === 'volume';
  $('h-factor').value = hstate.cfg.levelFactor;
  const flows = hstate.series.filter(s => s.role === 'in' || s.role === 'out');
  const needRef = holder && holder.role === 'level' && !(toNumber(hstate.cfg.levelFactor) > 0);
  $('h-ref-f').hidden = !needRef;
  const rs = $('h-ref'); rs.innerHTML = '';
  flows.forEach(s => rs.append(el('option', { value: s.name, text: `${s.name} (${Balance.ROLE_LABEL[s.role]})` })));
  rs.value = flows.some(s => s.name === hstate.cfg.reference) ? hstate.cfg.reference : (flows.find(s => s.role === 'in') || flows[0] || {}).name || '';
  hstate.cfg.reference = rs.value;
  $('h-window').value = String(hstate.cfg.window); $('h-tol').value = String(hstate.cfg.tol);
  const used = hstate.series.filter(s => s.role !== 'ignore');
  const T0 = maxOf(used.map(s => s.t[0])), T1 = minOf(used.map(s => s.t[s.t.length - 1]));
  $('h-found').textContent = `${!flows.length ? '⚠ 유량 계열이 없어요. ' : ''}${!holder ? '홀더 레벨 계열이 없으면 합계만 계산해요. ' : ''}함께 기록된 기간: ${T1 > T0 ? `${fmtClock(T0)} ~ ${fmtClock(T1)} (${fmtDur(T1 - T0)})` : '없음'}${hstate.warnings.length ? ` · ⚠ ${hstate.warnings.join(' / ')}` : ''}`;
  hUpdateButton();
}

$('h-factor').addEventListener('input', e => { hstate.cfg.levelFactor = e.target.value; hSave(); clearTimeout(hRenderSetup.t); hRenderSetup.t = setTimeout(() => { hRenderSetup(); if (hstate.result) hRun(); }, 500); });
$('h-ref').onchange = e => { hstate.cfg.reference = e.target.value; hSave(); if (hstate.result) hRun(); };
$('h-window').onchange = e => { hstate.cfg.window = +e.target.value; hSave(); if (hstate.result) hRun(); };
$('h-tol').onchange = e => { hstate.cfg.tol = +e.target.value; hSave(); if (hstate.result) hRun(); };

function hUpdateButton() {
  const flows = hstate.series.filter(s => s.role === 'in' || s.role === 'out');
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
  const lf = toNumber(hstate.cfg.levelFactor);
  const res = Balance.analyze(hstate.series, { window: hstate.cfg.window || 0, levelFactor: lf > 0 ? lf : null, reference: hstate.cfg.reference, tol: hstate.cfg.tol });
  hstate.result = res;
  if (res.error) { toast(res.error, 4000); $('h-results').hidden = true; hUpdateButton(); return; }
  res.at = new Date();
  hRender();
  hUpdateButton();
}

const readWord = v => `${fmt(Math.abs(v) * 100, 3)}% ${v > 0 ? '많게' : '적게'}`;
const VERDICT = { bias: '편차 있음', small: '차이는 있지만 허용 범위', ok: '정상 범위' };

function hRender() {
  const R = hstate.result;
  $('h-results').hidden = false;
  const sm = $('h-summary'); sm.innerHTML = '';
  const add = html => sm.append(el('li', { html }));
  add(`기간 ${esc(fmtClock(R.T0))} ~ ${esc(fmtClock(R.T1))} (${fmtDur(R.T1 - R.T0)}) 동안 유입 합계 <b>${fmt(R.tin, 6)}</b>, 사용처 합계 <b>${fmt(R.tout, 6)}</b> Nm³예요.`);
  if (R.note) add(esc(R.note));
  if (R.beta) {
    add(`홀더 부피 변화는 ${fmt(R.dV, 5)} Nm³${R.factorEstimated ? ` (레벨 1단위 = ${fmt(R.factor, 5)} Nm³로 추정, 기준: ${esc(R.reference)})` : ''}. 계측값대로면 <b>${fmt(Math.abs(R.gap), 5)} Nm³ (${fmt(Math.abs(R.gapPct) * 100, 3)}%)</b>가 ${R.gap > 0 ? '어디론가 사라졌어요' : '어디선가 더 들어왔어요'}.`);
    const bad = R.beta.filter(b => b.verdict === 'bias');
    add(bad.length
      ? `편차가 있는 계측기: ${bad.map(b => `<b>${esc(b.name)}</b> (실제보다 ${readWord(b.readErr)} 읽음)`).join(', ')}`
      : `허용 오차(±${fmt(hstate.cfg.tol * 100, 2)}%)를 넘는 계측기는 찾지 못했어요.`);
    add(`계측되지 않는 순유입은 <b>${fmt(R.aRate, 4)} Nm³/h</b> (95% 범위 ${fmt(R.aCI[0], 4)} ~ ${fmt(R.aCI[1], 4)})예요. ${R.aCI[1] < 0 ? '음수라서 누설·방산·계측 안 되는 사용처가 있다는 뜻이에요.' : R.aCI[0] > 0 ? '양수라서 계측 안 되는 유입이 있다는 뜻이에요.' : '0과 구분되지 않아요.'}`);
    // 구간별 차이의 크기(RMS): 보정 전 vs 보정 후(회귀 잔차)
    const before = Math.sqrt(Regression.mean(R.imbalance.map(c => c.v * c.v)));
    add(`보정계수를 적용하면 구간(${fmtDur(R.window)})마다 수지 차이가 평균 ${fmt(before, 4)} → ${fmt(R.model.rmse, 4)} Nm³로 바뀌어요 (구간 ${R.used}개${R.skipped ? `, 기록이 빈 ${R.skipped}개 제외` : ''}). ${R.model.rmse < before * 0.5 ? '보정계수가 차이 대부분을 설명해요.' : '보정 후에도 차이가 커요. 레벨 환산, 시간 지연, 계측 안 되는 사용처의 변동 같은 다른 원인이 있을 수 있어요.'}`);
    const hv = R.beta.filter(b => b.vif > 5);
    if (hv.length) add(`⚠ ${hv.map(b => esc(b.name)).join(', ')}은(는) 다른 계열과 같이 움직여서 편차를 구분하기 어려워요 (VIF > 5). 운전 패턴이 다른 기간 데이터를 더 넣어보세요.`);
  }

  // 계측기 편차 표
  const bt = $('h-beta'); bt.innerHTML = '';
  $('h-beta-panel').hidden = !R.beta;
  if (R.beta) {
    bt.append(el('tr', {}, ...['계열', '역할', '보정계수 β', '95% 범위', '계측값이 실제보다', 'p값', 'VIF', '판정'].map(h => el('th', { text: h }))));
    R.beta.forEach(b => bt.append(el('tr', {},
      el('td', { text: b.name }), el('td', { text: Balance.ROLE_LABEL[b.role] }), el('td', { text: b.ref ? '1 (기준)' : fmt(b.est, 4) }),
      el('td', { text: b.ref ? '-' : `${fmt(b.lo, 4)} ~ ${fmt(b.hi, 4)}` }),
      el('td', { text: b.ref ? '-' : readWord(b.readErr) }),
      el('td', { text: fmtP(b.p) }), el('td', { text: b.vif != null ? fmt(b.vif, 3) : '-' }),
      el('td', { class: b.verdict === 'bias' ? 'flag' : b.verdict === 'ok' ? 'ok' : 'meh', text: b.ref ? '기준' : VERDICT[b.verdict] }))));
  }

  // 누적 그래프
  const cw = $('h-cum'); cw.innerHTML = '';
  $('h-cum-panel').hidden = !R.cum;
  if (R.cum) {
    requestAnimationFrame(() => mountChart(cw, cumSpec(R)));
    const iw = $('h-imb'); iw.innerHTML = '';
    const ix = R.imbalance.map(c => (c.t - R.T0) / 3600);
    requestAnimationFrame(() => mountChart(iw, { x: ix, y: R.imbalance.map(c => c.v), fn: () => 0, fitLabel: '0 (수지 맞음)', pointLabel: '구간별 차이', xLabel: '시작 후(시간)', yLabel: '홀더 − (유입 − 유출)', tip: i => `${esc(fmtClock(R.imbalance[i].t))}<br>차이 <b>${fmt(R.imbalance[i].v, 4)}</b> Nm³` }));
  }

  // 계열별 합계
  const tt = $('h-totals'); tt.innerHTML = '';
  tt.append(el('tr', {}, ...['계열', '역할', '기록 간격', '합계(Nm³)', '평균 유량', '가장 긴 빈틈'].map(h => el('th', { text: h }))));
  R.totals.forEach(t => tt.append(el('tr', {}, el('td', { text: t.name }), el('td', { text: Balance.ROLE_LABEL[t.role] }), el('td', { text: fmtDur(t.dt) }),
    el('td', { text: fmt(t.volume, 6) }), el('td', { text: fmt(t.mean, 5) }), el('td', { class: t.maxGap > 600 ? 'flag' : '', text: fmtDur(t.maxGap) }))));
  tt.append(el('tr', { class: 'sum' }, el('td', { text: '유입 합계' }), el('td'), el('td'), el('td', { text: fmt(R.tin, 6) }), el('td'), el('td')));
  tt.append(el('tr', { class: 'sum' }, el('td', { text: '사용처 합계' }), el('td'), el('td'), el('td', { text: fmt(R.tout, 6) }), el('td'), el('td')));
  tt.append(el('tr', { class: 'sum' }, el('td', { text: '유입 − 사용처' }), el('td'), el('td'), el('td', { text: fmt(R.tin - R.tout, 6) }), el('td'), el('td')));
}

// 누적 차이: 홀더 실제 변화 − 계측 순유입. 계측이 맞으면 0 근처에 머문다
function cumSpec(R) {
  const x = R.cum.map(c => (c.t - R.T0) / 3600);
  const raw = R.cum.map(c => c.holder - c.metered), cor = R.cum.map(c => c.holder - c.corrected);
  return {
    x, y: raw, flagged: raw.map(() => true), pointLabel: '계측값 그대로', overlay: { x, y: cor }, overlayLabel: '보정 후', fn: () => 0, fitLabel: '0 (수지 맞음)',
    xLabel: '시작 후(시간)', yLabel: '누적 차이(Nm³)',
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
    const S0 = '계열별 합계', S1 = '순시값', S2 = '구간별 수지', S3 = '그래프', S4 = '함수설명';
    const head = (ws, h) => { ws.addRow(h); styleRow(ws.getRow(1), XL.head, 1, h.length); ws.getRow(1).height = 30; };

    // 계열별 합계 (+ 보정)
    const ws0 = wb.addWorksheet(S0, { views: [{ state: 'frozen', ySplit: 1 }] });
    const h0 = ['계열', '역할', '기록 수', '기록 간격(초)', '합계(Nm³)', '평균 유량(Nm³/h)', '보정계수 β', '보정 후 합계(Nm³)', '계측값이 실제보다', '판정'];
    head(ws0, h0);
    R.totals.forEach((t, i) => {
      const b = R.beta && R.beta[i], rr = i + 2;
      const row = ws0.addRow([t.name, Balance.ROLE_LABEL[t.role], t.n, +t.dt.toPrecision(4), +t.volume.toPrecision(10), +t.mean.toPrecision(8), b ? +b.est.toPrecision(12) : 1, null, b && !b.ref ? b.readErr : null, b ? (b.ref ? '기준' : VERDICT[b.verdict]) : '']);
      row.getCell(8).value = { formula: `E${rr}*G${rr}`, result: +t.volume.toPrecision(10) * (b ? +b.est.toPrecision(12) : 1) };
      row.getCell(7).fill = XL.input.fill; row.getCell(9).numFmt = '+0.00%;-0.00%';
      [5, 6, 8].forEach(c => { row.getCell(c).numFmt = '#,##0'; });
      row.eachCell({ includeEmpty: true }, c => { c.border = XL.border; });
    });
    const rin = [], rout = [];
    R.totals.forEach((t, i) => (t.role === 'in' ? rin : rout).push(i + 2));
    const sumOf = (rows, col) => (rows.length ? rows.map(r2 => `${col}${r2}`).join('+') : '0');
    ws0.addRow(['']);
    // 각 줄의 실제 행 번호를 받아서 수식에 쓴다
    const add = (label, f, res) => { const row = ws0.addRow([label]); row.getCell(5).value = { formula: f, result: res }; row.getCell(5).numFmt = '#,##0'; styleRow(row, XL.sub, 1, 5); return row.number; };
    const rIn = add('유입 합계', sumOf(rin, 'E'), R.tin);
    const rOut = add('사용처 합계', sumOf(rout, 'E'), R.tout);
    const rDiff = add('유입 − 사용처', `E${rIn}-E${rOut}`, R.tin - R.tout);
    if (R.beta) {
      const rHold = add('홀더 부피 변화', `${+R.dV.toPrecision(10)}`, R.dV);
      const rGap = add('수지 차이 (사라진 양)', `E${rDiff}-E${rHold}`, R.gap);
      const g = ws0.getRow(rGap);
      g.getCell(6).value = { formula: `E${rGap}/MAX(E${rIn},E${rOut})`, result: R.gapPct }; g.getCell(6).numFmt = '0.00%';
      ws0.addRow([`보정계수(노란 칸)는 수정할 수 있어요. 계측되지 않는 순유입: ${fmtX(R.aRate)} Nm³/h (95% ${fmtX(R.aCI[0])} ~ ${fmtX(R.aCI[1])})`]);
    }
    ws0.columns.forEach((c, i) => { c.width = [22, 14, 9, 12, 16, 16, 12, 18, 16, 20][i] || 12; });

    // 순시값: 공통 시간축
    const cg = Balance.commonGrid(hstate.series, R.T0, R.T1);
    const ws1 = wb.addWorksheet(S1, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
    const fl = cg.cols.filter(c => c.role === 'in' || c.role === 'out');
    head(ws1, ['시각', ...cg.cols.map(c => `${c.name}${c.role === 'level' || c.role === 'volume' ? '' : ` [${Balance.ROLE_LABEL[c.role]}]`}`), '유입 합계', '사용처 합계', '유입 − 사용처']);
    cg.grid.forEach((x, k) => {
      const vals = cg.cols.map(c => (Number.isFinite(c.v[k]) ? +c.v[k].toPrecision(8) : null));
      // 유량 단위가 달라도 합계는 시간당으로 맞춘다
      const perH = c => (c.unit === 'min' ? 60 : c.unit === 's' ? 3600 : 1);
      const si = fl.filter(c => c.role === 'in').reduce((a, c) => a + c.v[k] * perH(c), 0), so = fl.filter(c => c.role === 'out').reduce((a, c) => a + c.v[k] * perH(c), 0);
      ws1.addRow([fmtClock(x), ...vals, +si.toPrecision(8), +so.toPrecision(8), +(si - so).toPrecision(8)]);
    });
    ws1.columns.forEach((c, i) => { c.width = i ? 15 : 20; });
    ws1.addRow([]); ws1.addRow([`공통 시간축: ${fmtDur(cg.step)} 간격. 각 계열을 자기 측정 시각 사이에서 선형 보간했어요. 합계 칸은 Nm³/h 기준.`]);

    // 구간별 수지
    if (R.windows) {
      const ws2 = wb.addWorksheet(S2, { views: [{ state: 'frozen', ySplit: 1 }] });
      head(ws2, ['구간 시작', '구간 끝', ...R.flows.map((f, i) => `${f} (${R.roles[i] === 'in' ? '+' : '−'}, Nm³)`), `${R.holder} 변화`, '홀더 부피 변화(Nm³)', '계측 순유입(Nm³)', '차이(Nm³)']);
      R.windows.forEach((w, k) => {
        const net = w.F.reduce((a, v, i) => a + (R.roles[i] === 'in' ? v : -v), 0);
        ws2.addRow([fmtClock(w.a), fmtClock(w.b), ...w.F.map(v => +v.toPrecision(8)), +w.L.toPrecision(6), +(R.factor * w.L).toPrecision(8), +net.toPrecision(8), +R.imbalance[k].v.toPrecision(6)]);
      });
      ws2.columns.forEach((c, i) => { c.width = i < 2 ? 20 : 16; });
    }

    // 그래프
    const ws3 = wb.addWorksheet(S3);
    ws3.getCell('A1').value = '그래프'; ws3.getCell('A1').font = { bold: true, size: 16 };
    const charts = [];
    if (R.cum) {
      charts.push({ ...cumSpec(R), title: '누적 수지 차이', subtitle: '홀더 실제 − 계측 순유입' });
      charts.push({ x: R.imbalance.map(c => (c.t - R.T0) / 3600), y: R.imbalance.map(c => c.v), fn: () => 0, fitLabel: '0', pointLabel: '구간별 차이', xLabel: '시작 후(시간)', yLabel: '홀더 − 계측 순유입(Nm³)', title: '구간별 수지 차이', subtitle: `구간 ${fmtDur(R.window)}` });
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
    ws4.addRow(['홀더 수지 분석 결과']).getCell(1).font = { bold: true, size: 18 };
    line('분석일', R.at.toLocaleString('ko-KR'));
    line('기간', `${fmtClock(R.T0)} ~ ${fmtClock(R.T1)} (${fmtDur(R.T1 - R.T0)})`);
    ws4.addRow([]);
    line('1. 계산 방법', '', true);
    line('합계', '유량(순시값)을 자기 측정 시각 그대로 사다리꼴 공식으로 적분. 계열마다 시간축이 달라도 됨 (공통 시간축으로 바꾸지 않고 적분).');
    line('수지 식', '구간마다  c·ΔL = Σ sᵢ·βᵢ·Fᵢ + a·Δt  (ΔL: 레벨 변화, c: 레벨 1단위당 부피, Fᵢ: 구간 적분 유량, sᵢ: 유입 +1/유출 −1, βᵢ: 보정계수, a: 계측 안 되는 순유입)');
    line('보정계수 β', '실제 유량 = β × 계측값. β > 1 이면 계측값이 실제보다 적게, β < 1 이면 많게 읽음. 여러 구간의 최소제곱으로 구함.');
    line('판정', `95% 범위가 1을 포함하지 않고(p < 0.05) 차이가 허용 오차 ±${fmt(hstate.cfg.tol * 100, 2)}%보다 크면 "편차 있음".`);
    if (R.factorEstimated) line('레벨 환산', `레벨 1단위당 부피를 몰라서 "${R.reference}" 계측기를 기준(β=1)으로 놓고 c = ${fmtX(R.factor, 6)} Nm³/단위 로 추정 (95% ${fmtX(R.cCI[0], 6)} ~ ${fmtX(R.cCI[1], 6)}).`);
    else if (R.beta) line('레벨 환산', `레벨 1단위당 ${fmtX(R.factor, 6)} Nm³ (입력값).`);
    ws4.addRow([]);
    line('2. 결과', '', true);
    line('유입 / 사용처', `${fmtX(R.tin, 8)} / ${fmtX(R.tout, 8)} Nm³`);
    if (R.beta) {
      line('수지 차이', `${fmtX(R.gap, 6)} Nm³ (${fmt(R.gapPct * 100, 3)}%) — 계측값 그대로일 때`);
      R.beta.forEach(b => line(b.name, b.ref ? '기준 계측기 (β = 1)' : `β = ${fmtX(b.est, 5)} (95% ${fmtX(b.lo, 5)} ~ ${fmtX(b.hi, 5)}), 계측값이 실제보다 ${readWord(b.readErr)} 읽음 → ${VERDICT[b.verdict]}`));
      line('계측 안 되는 순유입', `${fmtX(R.aRate)} Nm³/h (95% ${fmtX(R.aCI[0])} ~ ${fmtX(R.aCI[1])})`);
      line('설명력', `R² = ${fmtR2(R.r2)}, 구간 ${R.used}개 × ${fmtDur(R.window)}`);
    } else if (R.note) line('참고', R.note);
    ws4.addRow([]);
    line('3. 주의', '', true);
    line('레벨 → 부피', '홀더 레벨을 부피로 바꿀 때 온도·압력 보정(Nm³ 환산)이 필요할 수 있어요. 환산이 틀리면 모든 β가 같은 비율로 틀어져요.');
    line('구분 가능성', 'VIF가 5를 넘는 계열은 다른 계열과 같이 움직여서 편차를 따로 구분하기 어려워요. 운전 패턴이 다른 기간 데이터를 더 넣으세요.');
    line('구간 길이', '너무 짧으면 레벨 센서 잡음에 묻히고, 너무 길면 구간 수가 적어져요. 결과가 구간 길이에 따라 크게 바뀌면 믿기 어려워요.');

    wb.worksheets.sort((a, b) => [S0, S1, S2, S3, S4].indexOf(a.name) - [S0, S1, S2, S3, S4].indexOf(b.name)).forEach((w, i) => { w.orderNo = i; });
    const buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `홀더수지분석_${stamp(R.at)}.xlsx`);
    toast('엑셀 파일을 저장했어요');
  } catch (e) {
    console.error(e);
    toast('엑셀을 만들지 못했어요: ' + e.message, 4000);
  } finally { hUpdateButton(); }
}

/* ---------- 시작 ---------- */
(function initBalance() {
  const cfg = store.get('bal:cfg', null);
  if (cfg) hstate.cfg = { window: cfg.window || 0, levelFactor: cfg.levelFactor || '', reference: cfg.reference || '', tol: cfg.tol || 0.01 };
  const saved = store.get('bal:sources', []);
  if (Array.isArray(saved) && saved.length) hSetSources(saved);
})();

setMode(['single', 'batch', 'bal'].includes(store.get('mode', 'single')) ? store.get('mode', 'single') : 'single');
