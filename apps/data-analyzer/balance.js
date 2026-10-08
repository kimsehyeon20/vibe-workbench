/* ================================================================
 * balance.js — 수지(입·출·저장량) 분석 · 계측기 편차 찾기 · 여러 계열 합산
 *
 * 저장소(탱크·홀더·사일로·배터리 …)에 들어오는 양(유입)과 나가는 양(유출·사용처)을
 * 각각 계측하고, 저장소의 레벨(또는 저장량)도 잰다. 계측이 정확하다면 어느 구간에서든
 *     저장량 변화 = Σ 유입 − Σ 유출 (+ 계측되지 않는 양)
 * 이 맞아야 한다. 실제로는 계측기마다 조금씩 틀리므로, 구간을 여러 개 잡아
 *     c·ΔL = Σ sᵢ·βᵢ·Fᵢ + a·Δt        (sᵢ: 유입 +1, 유출 −1)
 * 을 최소제곱으로 풀어 계측기별 보정계수 βᵢ(실제 = βᵢ × 계측값)를 찾는다.
 *   c  : 레벨 1단위당 부피 (알면 입력, 모르면 "믿는 계측기" 하나를 기준으로 추정)
 *   a  : 계측되지 않는 순유입 (음수면 손실·누설·계측 안 되는 사용처)
 * c를 모를 때는 잡음이 큰 레벨을 식의 왼쪽(y)에 두고 ΔL = Σ gᵢ·sᵢ·Fᵢ + g₀ 로 푼 뒤
 * c = 1/g_ref, βᵢ = gᵢ/g_ref 로 바꾼다 (레벨 잡음이 계수를 0 쪽으로 끌어당기지 않게).
 * 각 계열은 시간축이 달라도 된다: 유량은 구간마다 자기 측정값으로 적분하고,
 * 레벨은 구간 경계 시각에서 보간한다. 기록이 빈 구간은 쓰지 않는다.
 *
 * 브라우저: window.Balance / Node: require('./balance.js')
 * ================================================================ */
(function (root) {
  'use strict';
  const Reader = root.Reader || (typeof require === 'function' ? require('./reader.js') : null);
  const Reg = root.Regression || (typeof require === 'function' ? require('./regression.js') : null);
  const Batch = root.Batch || (typeof require === 'function' ? require('./batch.js') : null);
  const minOf = a => { let m = Infinity; for (const v of a) if (v < m) m = v; return m; };
  const maxOf = a => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };
  const { mean } = Reg;
  const sdOf = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
  const UNIT_SEC = { s: 1, min: 60, h: 3600, d: 86400 };
  const median = a => { const s = Float64Array.from(a).sort(); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
  const natural = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });

  const ROLE_LABEL = { in: '유입', out: '유출(사용처)', level: '저장 레벨', volume: '저장량', ignore: '안 씀' };
  const TAG_RE = /태그|tag|계기|meter|point|항목|이름|name|사용처|계열|series/i;

  /** 유량 단위 → { unit: 시간 단위, scale: 배수 }. kNm3/h·천Nm3/h → ×1000, Nm3/d → 하루당 */
  function flowUnitOf(name = '') {
    const s = String(name);
    let unit = 'h';
    if (/\/\s*(s|sec)\b|\/\s*초|per\s*sec/i.test(s)) unit = 's';
    else if (/\/\s*(min|m)\b|\/\s*분|per\s*min/i.test(s)) unit = 'min';
    else if (/\/\s*(d|day)\b|\/\s*일|per\s*day/i.test(s)) unit = 'd';
    const u = (s.match(/[(\[]\s*([^()\[\]/]+?)\s*\//) || [])[1] || '';
    const scale = /^(k|천)\s*(N|S)?m[3³]$|^km[3³]$|^kL$/i.test(u) ? 1000 : /^(M|백만)\s*(N|S)?m[3³]$/.test(u) ? 1e6 : 1;
    return { unit, scale };
  }
  /** 저장량 계열의 배수: "(kNm3)", "(천Nm3)" → 1000 (유량과 같은 기본 단위로 맞추려고) */
  function volumeScaleOf(name = '') {
    const u = (String(name).match(/[(\[]\s*([^()\[\]/]+?)\s*[)\]]\s*$/) || [])[1] || '';
    return /^(k|천)\s*(N|S)?m[3³]$|^km[3³]$|^kL$/i.test(u) ? 1000 : /^(M|백만)\s*(N|S)?m[3³]$/.test(u) ? 1e6 : 1;
  }
  /** 합계의 단위 글자: Nm3/h → Nm3, kNm3/h → Nm3, kW → kWh */
  function amountUnitOf(name = '') {
    const s = String(name);
    if (/\bkW\b/.test(s)) return 'kWh';
    if (/\bMW\b/.test(s)) return 'MWh';
    const u = (s.match(/[(\[]\s*([^()\[\]/]+?)\s*\//) || [])[1] || '';
    return u.replace(/^(k|천|M|백만)\s*(?=(N|S)?m[3³]$)/, '').replace(/^km([3³])$/, 'm$1').replace(/^kL$/, 'L');
  }
  function guessRole(name = '') {
    const s = String(name);
    if (/온도|압력|temp|press|℃|°c|bar\b|kpa|mmaq|mmh2o|발열량|칼로리|cal|co\s*\(|o2\s*\(|농도|밀도|density/i.test(s)) return 'ignore';
    if (/레벨|level|높이|\blv\b|저장률|충전율|수위|soc\b|잔량률/i.test(s)) return 'level';
    if (/사용|소비|consum|usage|유출|송출|배출|출구|outlet|방출|discharge/i.test(s)) return 'out';
    if (/부피|volume|재고|저장량|inventory|holdup/i.test(s)) return 'volume';
    if (/%/.test(s)) return 'ignore';
    if (/회수|유입|입고|recovery|inlet|발생|입구|투입|충전|feed|생산|\bin\b/i.test(s)) return 'in';
    return 'out';
  }

  /* ---------- 1. 계열 뽑기 (각자 자기 시간축) ---------- */
  /** 시간 칸 → { sec, kind: 'date'|'clock'|'number'|'mixed', note } */
  function timeOf(cells, kind, header) {
    if (kind === 'time') { const ts = Reader.timeSeconds(cells); return { sec: ts.sec, kind: ts.kind || 'mixed' }; }
    const v = cells.map(Reader.toNumber);
    const tu = Batch.timeUnitOf(header, cells);
    // 엑셀 날짜 일련번호 (46296.5 …) → 실제 날짜
    if (tu.unit === 'd' && !tu.sure && v.filter(Number.isFinite).every(x => x > 20000 && x < 80000)) return { sec: v.map(x => (x - 25569) * 86400), kind: 'date', note: `"${header}" 칸을 엑셀 날짜 일련번호로 읽었어요` };
    return { sec: v.map(x => x * UNIT_SEC[tu.unit]), kind: 'number', note: `숫자 시간 칸 "${header}"의 단위를 ${{ s: '초', min: '분', h: '시간', d: '일' }[tu.unit]}(으)로 봤어요${tu.sure ? '' : ' (이름에 단위가 없어 값으로 짐작)'}` };
  }

  function makeSeries(name, src, t, v) {
    const pts = t.map((a, i) => [a, v[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a, b) => a[0] - b[0]);
    // 같은 시각이 겹치면 마지막 값
    const out = [];
    let dup = 0;
    pts.forEach(p => { if (out.length && out[out.length - 1][0] === p[0]) { out[out.length - 1] = p; dup++; } else out.push(p); });
    return { name, src, t: out.map(p => p[0]), v: out.map(p => p[1]), dup };
  }

  /** sources: [{ name, text }] → { series, warnings } */
  function extract(sources) {
    const raw = [], warnings = [], srcInfo = [];
    const seenText = new Set();
    for (const src of sources) {
      if (seenText.has(src.text)) { warnings.push(`${src.name}: 이미 넣은 파일과 똑같아서 뺐어요`); continue; }
      seenText.add(src.text);
      const prep = Reader.prepareGrid(Reader.parseText(src.text), 'auto');
      const tb = Reader.buildTable(prep.rows);
      if (tb.error) { warnings.push(`${src.name}: ${tb.error}`); continue; }
      const ti = Reader.guessTimeCol(tb);
      if (ti < 0) { warnings.push(`${src.name}: 시각 칸을 찾지 못했어요`); continue; }
      const nums = tb.headers.map((_, j) => j).filter(j => j !== ti && tb.kinds[j] === 'number');
      const texts = tb.headers.map((_, j) => j).filter(j => j !== ti && tb.kinds[j] === 'text');
      // 긴 표(시각 | 태그 | 값): 값 칸이 하나이고, 태그 이름 칸이거나 같은 시각이 여러 태그에 되풀이될 때만
      let tag = -1;
      if (nums.length === 1 && texts.length) {
        const times = new Set(tb.cols[ti].map(String)).size;
        tag = texts.find(j => TAG_RE.test(tb.headers[j])) ?? texts.find(j => { const d = new Set(tb.cols[j].map(c => String(c).trim()).filter(Boolean)).size; return d >= 2 && d <= tb.body.length / 3 && times < tb.body.length * 0.8; }) ?? -1;
      }
      if (tag < 0 && texts.length && nums.length) warnings.push(`${src.name}: 글자 칸(${texts.map(j => tb.headers[j]).join(', ')})은 계열이 아니라서 뺐어요`);
      const info = { src: src.name, kind: null, names: [] };
      if (tag >= 0) {
        const vj = nums[0], groups = new Map();
        tb.cols[tag].forEach((k, i) => { k = String(k).trim(); if (!k) return; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
        // 태그마다 따로 시간을 읽는다 (태그 순으로 정렬된 표에서 날짜가 이어 붙지 않게)
        for (const [k, idx] of groups) {
          const T = timeOf(idx.map(i => tb.cols[ti][i]), tb.kinds[ti], tb.headers[ti]);
          info.kind = info.kind && info.kind !== T.kind ? 'mixed' : T.kind;
          if (T.note && !warnings.includes(`${src.name}: ${T.note}`)) warnings.push(`${src.name}: ${T.note}`);
          raw.push({ ...makeSeries(k, src.name, T.sec, idx.map(i => Reader.toNumber(tb.cols[vj][i]))), hint: tb.headers[vj] });
          info.names.push(k);
        }
      } else {
        const T = timeOf(tb.cols[ti], tb.kinds[ti], tb.headers[ti]);
        info.kind = T.kind;
        if (T.note) warnings.push(`${src.name}: ${T.note}`);
        nums.forEach(j => { raw.push(makeSeries(tb.headers[j], src.name, T.sec, tb.cols[j].map(Reader.toNumber))); info.names.push(tb.headers[j]); });
      }
      srcInfo.push(info);
    }
    alignClockOnly(raw, srcInfo, warnings);
    const series = mergeSameNames(raw, warnings);
    series.forEach(s => {
      s.dt = median(s.t.slice(1).map((v, i) => v - s.t[i]));
      s.role = guessRole(`${s.name} ${s.hint || ''}`);
      const u = flowUnitOf(`${s.name} ${s.hint || ''}`);
      s.unit = u.unit; s.scale = s.role === 'volume' ? volumeScaleOf(`${s.name} ${s.hint || ''}`) : u.scale;
      if (s.dup > Math.max(2, s.t.length * 0.01)) warnings.push(`${s.name}: 같은 시각이 ${s.dup}번 겹쳐요. 시각 칸에 날짜만 있거나 초가 빠졌는지 확인해주세요`);
    });
    const kinds = new Set(srcInfo.map(i => i.kind));
    if (kinds.has('date') && (kinds.has('clock') || kinds.has('number'))) warnings.push('날짜가 있는 파일과 없는 파일이 섞여 있어서 시간을 맞출 수 없을 수 있어요. 모든 파일에 날짜가 있는 시각을 써주세요');
    const short = series.filter(s => s.t.length < 2);
    short.forEach(s => warnings.push(`${s.name}: 값이 ${s.t.length}개뿐이라 뺐어요`));
    return { series: series.filter(s => s.t.length >= 2), warnings };
  }

  /** 날짜 없이 시각만 있는 파일들: 같은 칸 구성의 파일(하루 단위로 나눠 받은 것)은 이름 순으로 하루씩 이어 붙이고,
   *  나머지 파일은 겹치는 시간이 가장 길어지도록 하루 앞/뒤로 맞춘다 (알림과 함께) */
  function alignClockOnly(raw, srcInfo, warnings) {
    const clock = srcInfo.filter(i => i.kind === 'clock');
    if (!clock.length) return;
    const shift = (src, d) => raw.filter(s => s.src === src).forEach(s => { s.t = s.t.map(v => v + d); });
    const range = src => { const ss = raw.filter(s => s.src === src && s.t.length); return ss.length ? [minOf(ss.map(s => s.t[0])), maxOf(ss.map(s => s.t[s.t.length - 1]))] : null; };
    const sig = i => [...new Set(i.names)].sort().join('|');
    const groups = new Map();
    clock.forEach(i => { const k = sig(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i.src); });
    for (const [, srcs] of groups) {
      if (srcs.length < 2) continue;
      srcs.sort(natural).forEach((src, k) => { const r = range(src); if (r) shift(src, k * 86400 - Math.floor(r[0] / 86400) * 86400); });
      warnings.push(`날짜 없이 시각만 있는 같은 모양의 파일 ${srcs.length}개를 이름 순서(${srcs.join(' → ')})대로 하루씩 이어 붙였어요`);
    }
    // 가장 긴 묶음을 기준으로 다른 묶음을 하루 앞/뒤로 맞춘다
    const blocks = [...groups.values()].map(srcs => ({ srcs, r: (() => { const rs = srcs.map(range).filter(Boolean); return rs.length ? [minOf(rs.map(x => x[0])), maxOf(rs.map(x => x[1]))] : null; })() })).filter(b => b.r);
    if (blocks.length < 2) { if (clock.length) warnings.push('날짜 없이 시각만 있어요. 자정을 넘으면 다음 날로 보고 이어 붙였어요'); return; }
    blocks.sort((a, b) => (b.r[1] - b.r[0]) - (a.r[1] - a.r[0]));
    const ref = blocks[0].r;
    const overlap = (r, d) => Math.max(0, Math.min(ref[1], r[1] + d) - Math.max(ref[0], r[0] + d));
    blocks.slice(1).forEach(b => {
      const best = [0, 86400, -86400, 2 * 86400, -2 * 86400].reduce((x, d) => (overlap(b.r, d) > overlap(b.r, x) + 1 ? d : x), 0);
      if (best) { b.srcs.forEach(src => shift(src, best)); warnings.push(`날짜가 없는 ${b.srcs.join(', ')}을(를) ${best > 0 ? '다음' : '이전'} 날로 보고 맞췄어요 (겹치는 시간이 가장 긴 쪽). 날짜가 있는 시각을 쓰는 게 안전해요`); }
    });
    warnings.push('날짜 없이 시각만 있는 파일이 있어요. 파일끼리 같은 날로 보고 맞췄어요');
  }

  /** 같은 이름의 계열이 여러 파일에 있으면(하루 단위로 나눠 받은 것 등) 이어 붙인다.
   *  기간이 겹치는데 값이 다르면 따로 두고 파일 이름을 붙인다. 완전히 같은 기록은 하나만 */
  function mergeSameNames(raw, warnings) {
    const byName = new Map();
    raw.forEach(s => { if (!byName.has(s.name)) byName.set(s.name, []); byName.get(s.name).push(s); });
    const out = [];
    for (const [name, list] of byName) {
      if (list.length === 1) { out.push(list[0]); continue; }
      const same = (a, b) => a.t.length === b.t.length && a.t.every((v, i) => v === b.t[i] && a.v[i] === b.v[i]);
      const uniq = list.filter((s, i) => !list.slice(0, i).some(p => same(p, s)));
      if (uniq.length < list.length) warnings.push(`${name}: 똑같은 기록이 ${list.length - uniq.length}번 더 있어서 하나만 썼어요`);
      const sorted = uniq.slice().sort((a, b) => a.t[0] - b.t[0]);
      const overlaps = sorted.some((s, i) => i && s.t[0] < sorted[i - 1].t[sorted[i - 1].t.length - 1]);
      if (uniq.length > 1 && overlaps) { uniq.forEach(s => out.push({ ...s, name: `${name} (${s.src})` })); continue; }
      if (uniq.length === 1) { out.push(uniq[0]); continue; }
      const t = [], v = [];
      sorted.forEach(s => { s.t.forEach((x, i) => { if (!t.length || x > t[t.length - 1]) { t.push(x); v.push(s.v[i]); } }); });
      out.push({ name, src: sorted.map(s => s.src).join(' + '), t, v, dup: sorted.reduce((a, s) => a + s.dup, 0), hint: sorted[0].hint });
      warnings.push(`${name}: 파일 ${sorted.length}개(${sorted.map(s => s.src).join(', ')})를 시간 순으로 이어 붙였어요`);
    }
    return out;
  }

  /* ---------- 2. 적분·보간 ---------- */
  function lowerIdx(t, x) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } return lo; }
  function valueAt(s, x) {
    if (x < s.t[0] || x > s.t[s.t.length - 1]) return NaN;
    const i = lowerIdx(s.t, x);
    if (s.t[i] === x) return s.v[i];
    const a = i - 1;
    return s.v[a] + (s.v[i] - s.v[a]) * (x - s.t[a]) / (s.t[i] - s.t[a]);
  }
  /** 유량 계열을 [a, b] 구간에서 적분 (단위: 부피). 구간을 다 덮지 못하면 NaN, 아니면 { v, gap: 가장 긴 빈틈(초) } */
  function integrate(s, a, b, unitSec = 3600) {
    if (a < s.t[0] || b > s.t[s.t.length - 1] || b <= a) return NaN;
    let i = lowerIdx(s.t, a);
    let px = a, pv = valueAt(s, a), sum = 0, gap = 0;
    // 경계 앞뒤 측정점까지 포함한 빈틈
    const i0 = s.t[i] === a ? i : Math.max(0, i - 1);
    for (; i < s.t.length && s.t[i] < b; i++) {
      if (s.t[i] <= a) continue;
      sum += (pv + s.v[i]) / 2 * (s.t[i] - px);
      px = s.t[i]; pv = s.v[i];
    }
    const bv = valueAt(s, b);
    sum += (pv + bv) / 2 * (b - px);
    const i1 = Math.min(s.t.length - 1, lowerIdx(s.t, b));
    for (let k = i0 + 1; k <= i1; k++) gap = Math.max(gap, s.t[k] - s.t[k - 1]);
    return { v: sum / unitSec, gap };
  }
  /** 레벨 변화: 구간 안(앞뒤 측정점 포함)에 보통 간격의 3배 넘는 빈틈이 있으면 NaN (선으로 이어 만든 값은 쓰지 않음) */
  function levelDelta(h, a, b) {
    if (a < h.t[0] || b > h.t[h.t.length - 1]) return NaN;
    const i0 = Math.max(0, lowerIdx(h.t, a) - (h.t[lowerIdx(h.t, a)] === a ? 0 : 1));
    const i1 = Math.min(h.t.length - 1, lowerIdx(h.t, b));
    const lim = 3 * (h.dt || 1) + 1e-9;
    for (let k = i0 + 1; k <= i1; k++) if (h.t[k] - h.t[k - 1] > lim) return NaN;
    return valueAt(h, b) - valueAt(h, a);
  }

  /* ---------- 3. 최소제곱 (계수 공분산까지) ---------- */
  function ols(X, y) {
    const n = y.length, p = X[0].length + 1;
    if (n < p + 2) return null;
    // 열마다 표준화해서 푼다 (부피 단위가 커도 안정적)
    const cols = X[0].map((_, j) => X.map(r => r[j]));
    const mu = cols.map(mean), sc = cols.map((c, j) => sdOf(c) || 1);
    const Z = X.map(r => [1, ...r.map((v, j) => (v - mu[j]) / sc[j])]);
    const A = Array.from({ length: p }, () => new Float64Array(p)), bv = new Float64Array(p);
    Z.forEach((z, k) => { for (let i = 0; i < p; i++) { bv[i] += z[i] * y[k]; for (let j = 0; j < p; j++) A[i][j] += z[i] * z[j]; } });
    const inv = invert(A);
    if (!inv) return null;
    const cz = inv.map(r => r.reduce((s, v, j) => s + v * bv[j], 0));
    const res = y.map((v, k) => v - Z[k].reduce((s, z, j) => s + z * cz[j], 0));
    const df = n - p, sse = res.reduce((s, e) => s + e * e, 0), s2 = sse / df;
    // 원래 단위 계수: b_j = cz_j / sc_j, b0 = cz0 − Σ b_j·mu_j  → 공분산은 같은 변환 T로
    const T = Array.from({ length: p }, (_, i) => new Float64Array(p));
    T[0][0] = 1; for (let j = 1; j < p; j++) { T[j][j] = 1 / sc[j - 1]; T[0][j] = -mu[j - 1] / sc[j - 1]; }
    const coef = T.map(r => r.reduce((s, v, j) => s + v * cz[j], 0));
    const cov = T.map(ri => T.map(rj => { let s = 0; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) s += ri[a] * inv[a][b] * rj[b]; return s * s2; }));
    const ym = mean(y), sst = y.reduce((s, v) => s + (v - ym) ** 2, 0);
    let dw = 0; for (let k = 1; k < n; k++) dw += (res[k] - res[k - 1]) ** 2;
    return { coef, cov, df, res, sse, sigma: Math.sqrt(s2), r2: sst > 0 ? 1 - sse / sst : NaN, dw: sse > 0 ? dw / sse : NaN, n, p };
  }
  function invert(M) {
    const n = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (!(Math.abs(A[piv][c]) > 1e-10 * Math.max(1, Math.abs(M[c][c])))) return null;
      [A[c], A[piv]] = [A[piv], A[c]];
      const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map(r => r.slice(n));
  }
  // VIF: 각 예측변수를 나머지로 설명하는 정도
  function vifs(X) {
    const k = X[0].length;
    if (k < 2) return X[0].map(() => 1);
    return X[0].map((_, j) => {
      const m = ols(X.map(r => r.filter((_, q) => q !== j)), X.map(r => r[j]));
      return m && m.r2 < 1 ? 1 / (1 - m.r2) : Infinity;
    });
  }

  /* ---------- 4. 수지 분석 ---------- */
  function pickWindow(span, minDt = 60, p = 3) {
    // 유량 변화를 구분할 만큼 짧게(기본 15분), 측정 간격의 10배 이상, 구간 수는 p+8 이상
    let W = Math.max(900, Math.ceil(10 * minDt / 60) * 60);
    const cands = [5, 10, 15, 30, 60, 120, 240].map(m => m * 60);
    W = cands.find(w => w >= W) || W;
    while (span / W < p + 8 && W > 300) W = cands.filter(w => w < W).pop() || W / 2;
    while (span / W > 5000) W *= 2;
    return W;
  }

  /** cfg: { window: 초, levelFactor: 숫자|null (레벨 하나일 때), reference: 이름, tol, lag: 'auto'|초 } */
  function analyze(all, cfg = {}) {
    const used = all.filter(s => s.role !== 'ignore');
    const flows = used.filter(s => s.role === 'in' || s.role === 'out');
    const holders = used.filter(s => s.role === 'level' || s.role === 'volume');
    if (!flows.length) return { error: '유입이나 유출(유량) 계열이 하나도 없어요' };
    const T0 = maxOf(used.map(s => s.t[0])), T1 = minOf(used.map(s => s.t[s.t.length - 1]));
    if (!(T1 > T0)) return { error: '모든 계열이 함께 기록된 시간이 없어요. 시각(날짜)이 겹치는지 확인해주세요' };
    const sign = s => (s.role === 'in' ? 1 : -1);
    const us = s => UNIT_SEC[s.unit || 'h'], sc = s => s.scale || 1;
    const tol = cfg.tol ?? 0.01;
    // 합계 단위: 이름의 단위에서 배수(k·천)를 뺀 것. 사용자가 배수를 ×1로 바꿨으면 이름에 적힌 단위 그대로
    const nm0 = `${flows[0].name} ${flows[0].hint || ''}`;
    const au = (flowUnitOf(nm0).scale === (flows[0].scale || 1) ? amountUnitOf(nm0) : ((nm0.match(/[(\[]\s*([^()\[\]/]+?)\s*\//) || [])[1] || '')) || '';
    const warnings = [];

    // 전체 기간 합계 (계열마다 빈틈 표시)
    const totals = flows.map(s => {
      const r = integrate(s, T0, T1, us(s));
      const v = r.v * sc(s);
      return { name: s.name, role: s.role, volume: v, perHour: v / ((T1 - T0) / 3600), maxGap: r.gap, dt: s.dt, n: s.t.length, unit: s.unit, scale: sc(s) };
    });
    const tin = totals.filter(x => x.role === 'in').reduce((a, x) => a + x.volume, 0);
    const tout = totals.filter(x => x.role === 'out').reduce((a, x) => a + x.volume, 0);
    const base = { T0, T1, flows: flows.map(s => s.name), roles: flows.map(s => s.role), holders: holders.map(h => h.name), totals, tin, tout, au, warnings, notes: [] };
    if (!holders.length) return { ...base, note: '저장소 레벨(또는 저장량) 계열이 없어서 합계만 계산했어요' };

    // 저장소마다 1단위당 부피: 저장량이면 1, 레벨이면 계열에 넣은 값 → 레벨이 하나면 cfg.levelFactor
    // 저장량 계열은 배수(kNm3 → ×1000)를 곱해 유량과 같은 단위로
    const factors = holders.map(h => (h.role === 'volume' ? h.scale || 1 : +h.factor > 0 ? +h.factor : holders.length === 1 && cfg.levelFactor > 0 ? +cfg.levelFactor : null));
    const unknown = factors.filter(f => f == null).length;
    if (unknown && holders.length > 1) return { ...base, regError: '저장소(레벨) 계열이 2개 이상이면 레벨마다 "1단위당 부피"를 넣어주세요. 그래야 저장량을 더할 수 있어요' };

    const minDt = maxOf([...flows, ...holders].map(s => s.dt || 60));
    const W = cfg.window || pickWindow(T1 - T0, minDt, flows.length);

    const fCache = new Map(); // 구간 길이별 유량 적분 (레벨 시간 차이를 찾을 때 다시 계산하지 않게)
    const rowsFor = (Wn, lag) => {
      if (!fCache.has(Wn)) {
        const fs = [];
        for (let a = T0; a + Wn <= T1 + 1e-9; a += Wn) {
          const b = a + Wn;
          // 빈틈 허용: 측정 간격의 3배, 또는 구간의 1/10(최대 5분) 중 큰 값
          fs.push({ a, b, F: flows.map(s => { const r = integrate(s, a, b, us(s)); const lim = Math.max(3 * s.dt, Math.min(Wn / 10, 300)); return r && r.gap <= lim ? r.v * sc(s) : NaN; }) });
        }
        fCache.set(Wn, fs);
      }
      return fCache.get(Wn).map(({ a, b, F }) => ({ a, b, F, L: holders.map(h => levelDelta(h, a + lag, b + lag)) }));
    };
    const lagOK = cfg.lag === 'auto' || cfg.lag == null;
    let lag = Number.isFinite(+cfg.lag) ? +cfg.lag : 0;

    /** 한 번의 추정. 결과: { beta, aRate, ... } 또는 { regError } */
    const estimate = (Wn, lagN, refName) => {
      const rows = rowsFor(Wn, lagN);
      const ok = rows.filter(r => r.F.every(Number.isFinite) && r.L.every(Number.isFinite));
      const skipBy = {};
      rows.forEach(r => { if (r.F.every(Number.isFinite) && r.L.every(Number.isFinite)) return; r.F.forEach((v, i) => { if (!Number.isFinite(v)) skipBy[flows[i].name] = (skipBy[flows[i].name] || 0) + 1; }); r.L.forEach((v, i) => { if (!Number.isFinite(v)) skipBy[holders[i].name] = (skipBy[holders[i].name] || 0) + 1; }); });
      const out = { rows, ok, skipBy, W: Wn, lag: lagN };
      // 구간마다 양이 거의 일정한 계열: 계수를 구할 수 없으므로 β = 1로 두고 알린다
      const vols = flows.map((_, i) => ok.map(r => r.F[i]));
      const cv = vols.map(v => { const m = Math.abs(mean(v)), d = sdOf(v); return m > 0 ? d / m : d > 0 ? Infinity : 0; });
      const fixed = flows.map((_, i) => !(cv[i] > 1e-6));
      const est = flows.map((_, i) => i).filter(i => !fixed[i]);
      if (ok.length < est.length + 4) return { ...out, regError: `수지 회귀를 하려면 빈틈 없는 구간이 ${est.length + 4}개 이상 필요해요 (지금 ${ok.length}개). 구간 길이를 줄이거나 더 긴 기간의 데이터를 넣어주세요` };
      if (!est.length) return { ...out, regError: '모든 유량이 구간마다 일정해서 계측기를 구분할 수 없어요' };
      const storage = r => r.L.reduce((s, d, h) => s + (factors[h] || 0) * d, 0); // 알려진 환산값으로 바꾼 저장량 변화
      const fixedNet = r => fixed.reduce((s, f, i) => s + (f ? sign(flows[i]) * r.F[i] : 0), 0);
      const X = ok.map(r => est.map(i => sign(flows[i]) * r.F[i]));
      const V = vifs(X);
      const tc = df => Reg.t975(df);
      let beta = flows.map((s, i) => ({ name: s.name, role: s.role, fixed: fixed[i], cv: cv[i] }));
      let aWin, aSe, c = null, cSe = null, refIdx = -1, m;
      if (!unknown) {
        // c 를 안다: c·ΔL − (일정한 계열) = Σ β·s·F + a·W
        m = ols(X, ok.map(r => storage(r) - fixedNet(r)));
        if (!m) return { ...out, regError: '계열끼리 너무 똑같이 움직여서 보정계수를 따로 구할 수 없어요. 함께 움직이는 계열 중 하나를 "안 씀"으로 바꿔보세요' };
        est.forEach((i, k) => Object.assign(beta[i], { est: m.coef[k + 1], se: Math.sqrt(m.cov[k + 1][k + 1]), vif: V[k] }));
        aWin = m.coef[0]; aSe = Math.sqrt(m.cov[0][0]);
      } else {
        // c 를 모른다: ΔL = Σ g·s·F + g0 (레벨을 y에), 기준 계측기 r: c = 1/g_r, β_i = g_i/g_r, a = g0/g_r
        const hk = factors.findIndex(f => f == null);
        m = ols(X, ok.map(r => r.L[hk]));
        if (!m) return { ...out, regError: '계열끼리 너무 똑같이 움직여서 보정계수를 따로 구할 수 없어요. 함께 움직이는 계열 중 하나를 "안 씀"으로 바꿔보세요' };
        refIdx = flows.findIndex(s => s.name === refName);
        if (refIdx < 0 || fixed[refIdx]) refIdx = est.find(i => flows[i].role === 'in') ?? est[0];
        const kr = est.indexOf(refIdx) + 1, gr = m.coef[kr];
        if (!(Math.abs(gr) > 0)) return { ...out, regError: '기준 계측기가 레벨 변화와 관계가 없어서 환산값을 구할 수 없어요. 다른 기준을 골라주세요' };
        const ratio = (j) => { const R = m.coef[j] / gr; const v = (m.cov[j][j] - 2 * R * m.cov[j][kr] + R * R * m.cov[kr][kr]) / (gr * gr); return [R, Math.sqrt(Math.max(0, v))]; };
        est.forEach((i, k) => { if (i === refIdx) Object.assign(beta[i], { est: 1, se: 0, ref: true, vif: V[k] }); else { const [R, se] = ratio(k + 1); Object.assign(beta[i], { est: R, se, vif: V[k] }); } });
        [aWin, aSe] = ratio(0);
        c = 1 / gr; cSe = Math.sqrt(m.cov[kr][kr]) / (gr * gr);
        // 일정한 계열(β=1)은 g0에 섞여 있다: a = g0/g_r − Σ s·F_fixed
        aWin -= mean(ok.map(fixedNet));
      }
      const t = tc(m.df);
      const facts = factors.map(f => (f == null ? c : f));
      beta.forEach(b => {
        if (b.fixed) { Object.assign(b, { est: 1, se: 0, lo: 1, hi: 1, p: NaN, verdict: 'fixed', readErr: NaN }); return; }
        b.lo = b.est - t * b.se; b.hi = b.est + t * b.se;
        if (b.ref) { b.p = NaN; b.verdict = 'ref'; b.readErr = 0; return; }
        b.p = Reg.tP((b.est - 1) / b.se, m.df);
        b.readErr = 1 / b.est - 1; // 계측값이 실제보다 몇 % 많이(+) / 적게(−) 읽나
        // 판정: 믿기 어려운 값(0.7~1.3 밖, 범위가 ±20% 넘게 넓음, 구간마다 양이 거의 같음)은 "데이터 확인",
        //       1과 확실히 다르고 허용 오차보다 크면 "편차 있음", 범위가 허용 오차 안이면 "정상", 범위가 넓으면 "판단 불가"
        if (!(b.est >= 0.7 && b.est <= 1.3) || (b.hi - b.lo) / 2 > 0.2) { b.verdict = 'data'; b.why = !(b.est > 0) ? '음수·0에 가까운 값' : (b.hi - b.lo) / 2 > 0.2 ? '범위가 너무 넓음' : '너무 큰 차이'; }
        else if (b.cv < 0.02) { b.verdict = 'data'; b.why = '구간마다 양이 거의 같아서 구분하기 어려움 (구간을 줄여 보세요)'; }
        else if (b.p < 0.05 && Math.abs(b.readErr) > tol) b.verdict = 'bias';
        else if (b.lo >= 1 / (1 + tol) && b.hi <= 1 / (1 - tol)) b.verdict = 'ok';
        else if (b.p < 0.05) b.verdict = 'small';
        else b.verdict = (b.hi - b.lo) / 2 <= 3 * tol ? 'likely' : 'unknown';
      });
      const hr = Wn / 3600;
      const aRate = aWin / hr, aCI = [(aWin - t * aSe) / hr, (aWin + t * aSe) / hr];
      // 구간별 수지 차이 (부피 단위): 계측값 그대로 / 보정 후
      const stor = r => r.L.reduce((s, d, h) => s + facts[h] * d, 0);
      const net = r => flows.reduce((s, f, i) => s + sign(f) * r.F[i], 0);
      const corr = r => flows.reduce((s, f, i) => s + sign(f) * beta[i].est * r.F[i], 0) + aWin;
      const imbalance = ok.map(r => ({ t: r.b, v: stor(r) - net(r) }));
      const after = ok.map(r => stor(r) - corr(r));
      return { ...out, beta, aRate, aCI, aWin, factor: unknown ? c : facts.length === 1 ? facts[0] : null, facts, cEst: c, cCI: c != null ? [c - t * cSe, c + t * cSe] : null, refIdx, m, imbalance, after, stor, net, corr, fixed };
    };

    // 레벨 기록이 유량보다 늦거나(센서 지연) 시계가 어긋나면: ±5분 안에서 가장 잘 맞는 시간 차이를 찾아 맞춘다
    let E = estimate(W, lag, cfg.reference);
    if (!E.regError && lagOK && holders.length === 1) {
      const step = Math.max(10, Math.round((holders[0].dt || 30) / 10) * 10);
      const mse = e => (e.regError ? Infinity : e.after.reduce((s, v) => s + v * v, 0) / e.after.length);
      const m0 = mse(E);
      let best = { lag: 0, mse: m0, e: E };
      for (let d = -300; d <= 300; d += step) { if (!d) continue; const e = estimate(W, d, cfg.reference); const v = mse(e); if (v < best.mse && e.ok.length >= E.ok.length * 0.9) best = { lag: d, mse: v, e }; }
      if (best.lag && best.mse < m0 * 0.8) { E = best.e; lag = best.lag; base.notes.push(`레벨 기록이 유량보다 약 ${Math.abs(lag)}초 ${lag > 0 ? '늦어서' : '빨라서'} 그만큼 맞춰 계산했어요 (수지 차이가 ${Math.round((1 - best.mse / m0) * 100)}% 줄어듦). 레벨 센서 지연이나 시계 차이일 수 있어요`); }
    }
    if (E.regError) return { ...base, window: W, used: E.ok.length, skipped: E.rows.length - E.ok.length, skipBy: E.skipBy, regError: E.regError };

    // 빈틈 없는 구간만으로 합계와 수지 차이를 낸다 (빈 구간을 선으로 이은 값이 섞이지 않게)
    const okIn = E.ok.reduce((s, r) => s + flows.reduce((a, f, i) => a + (f.role === 'in' ? r.F[i] : 0), 0), 0);
    const okOut = E.ok.reduce((s, r) => s + flows.reduce((a, f, i) => a + (f.role === 'out' ? r.F[i] : 0), 0), 0);
    const dV = E.ok.reduce((s, r) => s + E.stor(r), 0);
    const gap = okIn - okOut - dV;
    let cm = 0, cc = 0, ch = 0;
    const cum = E.ok.map(r => { cm += E.net(r); cc += E.corr(r); ch += E.stor(r); return { t: r.b, metered: cm, corrected: cc, holder: ch }; });
    const rms = a => Math.sqrt(mean(a.map(v => v * v)));
    const notes = base.notes;
    if (E.rows.length - E.ok.length) notes.push(`기록이 빈 구간 ${E.rows.length - E.ok.length}개(${(E.rows.length - E.ok.length) * W / 3600 < 48 ? `${+((E.rows.length - E.ok.length) * W / 3600).toPrecision(3)}시간` : `${+((E.rows.length - E.ok.length) * W / 86400).toPrecision(3)}일`})는 빼고 계산했어요: ${Object.entries(E.skipBy).map(([k, v]) => `${k} ${v}개`).join(', ')}`);
    const fixedNames = flows.filter((_, i) => E.fixed[i]).map(s => s.name);
    if (fixedNames.length) notes.push(`${fixedNames.join(', ')}: 구간마다 양이 일정해서(정지·고정 운전) 보정계수를 구할 수 없어 계측값 그대로(β = 1) 썼어요`);
    // 모든 계측기가 같은 쪽으로 비슷하게 틀리면: 계측기보다 레벨 환산값이 틀렸을 가능성
    const free = E.beta.filter(b => !b.fixed && !b.ref && b.verdict !== 'data');
    if (!unknown && free.length >= 2) {
      const bs = free.map(b => b.est), mb = median(bs);
      if (bs.every(v => Math.sign(v - 1) === Math.sign(mb - 1)) && Math.abs(1 / mb - 1) > tol && maxOf(bs) - minOf(bs) < Math.max(2 * tol, Math.abs(mb - 1))) {
        notes.push(`모든 계측기가 비슷하게 ${Math.round(Math.abs(1 / mb - 1) * 1000) / 10}% ${mb < 1 ? '많게' : '적게'} 읽는 것으로 나와요. 계측기보다 "레벨 1단위당 부피"가 틀렸을 가능성이 커요${E.facts.length === 1 && holders[0].role === 'level' ? ` (자료로 보면 약 ${+(E.facts[0] / mb).toPrecision(4)}${au ? ` ${au}` : ''})` : ''}. 환산값을 비우고 기준 계측기로 다시 계산해 보세요`);
        free.forEach(b => { if (b.verdict === 'bias') b.verdict = 'common'; });
      }
    }
    // β가 모두 1000배·1/1000배 근처면 계열마다 단위 배수(k·천)가 다른 것
    const allB = E.beta.filter(b => !b.fixed && !b.ref).map(b => b.est);
    const mB = allB.length ? median(allB) : NaN;
    if ([1000, 1e-3, 1e6, 1e-6].some(k => mB > k * 0.8 && mB < k * 1.25)) notes.push(`보정계수가 모두 약 ${+mB.toPrecision(2)}배예요. 계측기 오차가 아니라 단위 배수(k·천, Nm3 ↔ kNm3)가 계열마다 다른 것 같아요. 계열 표의 배수나 "1단위당 부피"의 단위를 맞춰 주세요`);
    // DW가 2보다 큰 것(번갈아 나타남)은 이웃 구간이 레벨 끝점을 나눠 쓰는 잡음 때문이라 자연스럽다. 작을 때만 알린다
    if (Number.isFinite(E.m.dw) && E.m.dw < 1.2) notes.push(`구간별 차이가 무작위가 아니라 이어서 나타나요 (DW ${E.m.dw.toFixed(2)}). 시간 지연이나 계측 안 되는 양의 변동이 있으면 보정계수 범위가 실제보다 좁게 나올 수 있어요`);
    // 구간 길이를 바꿔도 결과가 비슷한지 (편차 없음 쪽 판정끼리 바뀌는 것은 괜찮다)
    const CALM = ['ok', 'small', 'unknown', 'likely'];
    const sens = [];
    [W / 2, W * 2].forEach(w2 => {
      if (w2 < 60 || (T1 - T0) / w2 < flows.length + 6) return;
      const e2 = estimate(w2, lag, cfg.reference);
      if (e2.regError) return;
      sens.push({ window: w2, beta: e2.beta.map(b => ({ name: b.name, est: b.est, verdict: b.verdict })) });
    });
    const unstable = E.beta.filter((b, i) => !b.fixed && !b.ref && sens.some(s => s.beta[i].verdict !== b.verdict && !(CALM.includes(s.beta[i].verdict) && CALM.includes(b.verdict)) || Math.abs(s.beta[i].est - b.est) > Math.max(tol, (b.hi - b.lo) / 2))).map(b => b.name);
    if (sens.length) notes.push(unstable.length ? `구간 길이를 바꾸면 결과가 달라지는 계열이 있어요: ${unstable.join(', ')}. 이 계열의 판정은 조심해서 보세요` : `구간 길이를 절반·두 배로 바꿔도 판정이 같아요`);

    return {
      ...base, window: W, lag, used: E.ok.length, skipped: E.rows.length - E.ok.length, skipBy: E.skipBy,
      beta: E.beta, aRate: E.aRate, aCI: E.aCI, factor: E.factor, factors: E.facts, factorEstimated: unknown > 0, cCI: E.cCI,
      reference: E.refIdx >= 0 ? flows[E.refIdx].name : null,
      cum, imbalance: E.imbalance, windows: E.ok, okIn, okOut, dV, gap, gapPct: gap / Math.max(okIn, okOut),
      okHours: E.ok.length * W / 3600, rmsBefore: rms(E.imbalance.map(x => x.v)), rmsAfter: rms(E.after), noiseFloor: noiseFloor(holders, E.facts),
      r2: E.m.r2, dw: E.m.dw, df: E.m.df, sensitivity: sens, unstable,
      levelPerUnit: E.facts,
    };
  }

  /** 레벨 측정 잡음만으로 생기는 구간별 수지 차이(부피): 2차 차분(큰 쪽 10%는 실제 변화로 보고 뺌)의 크기로
   *  잡음 σ를 어림 (흰 잡음이면 2차 차분 분산 = 6σ², 0.1 단위로 반올림된 값에도 맞음) → √2·σ·c */
  function noiseFloor(holders, facts) {
    let v = 0;
    holders.forEach((h, k) => {
      const d2 = []; for (let i = 2; i < h.v.length; i++) d2.push((h.v[i] - 2 * h.v[i - 1] + h.v[i - 2]) ** 2);
      const s2 = Float64Array.from(d2).sort().slice(0, Math.max(1, Math.floor(d2.length * 0.9)));
      const sig = Math.sqrt(mean(Array.from(s2)) / 6);
      v += 2 * (sig * (facts[k] || 0)) ** 2;
    });
    return Math.sqrt(v);
  }

  /* ---------- 5. 공통 시간축 표 ---------- */
  function commonGrid(all, T0, T1, maxRows = 5000) {
    const used = all.filter(s => s.role !== 'ignore');
    // 가장 촘촘한 계열 간격으로 (줄 수 한도 안에서) → 합계가 계열별 합계와 거의 같게
    let step = Math.max(1, minOf(used.map(s => s.dt || 60)));
    while ((T1 - T0) / step > maxRows) step *= 2;
    const grid = []; for (let x = T0; x <= T1 + 1e-9; x += step) grid.push(x);
    return { step, grid, cols: used.map(s => ({ name: s.name, role: s.role, unit: s.unit, scale: s.scale || 1, v: grid.map(x => valueAt(s, x)) })) };
  }

  /* ---------- 예시 1: 가스 홀더 1기, 회수 1, 사용처 3 (24시간, 계열마다 기록 간격이 다름) ---------- */
  function demo(o = {}) {
    let seed = o.seed || 5;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const p2 = n => String(n).padStart(2, '0');
    const stamp = s => `2026-10-${p2(1 + Math.floor(s / 86400))} ${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(Math.floor(s % 60))}`;
    const FACTOR = 1200; // 레벨 1% = 1200 Nm³
    const BIAS = o.bias || { 발전소: 1.04, 열연가열로: 0.97, 보일러: 1.0 }; // 계측값 = 실제 × BIAS
    const LOSS = 500; // 계측 안 되는 손실 Nm³/h
    const dt = 1, T = (o.days || 1) * 24 * 3600;
    const noise = o.levelNoise ?? 0.04, lagS = o.levelLag || 0;
    const inGap = (s, g) => g && s >= g[0] && s < g[1];
    const levHist = [];
    let V = 60 * FACTOR, boiler = 1;
    const rec = [], use = { 발전소: [], 열연가열로: [], 보일러: [] }, lev = [];
    for (let s = 0; s <= T; s += dt) {
      const ph = s % 2400; // 40분마다 전로 회수 10분
      const qin = ph < 600 ? 150000 * (1 - Math.exp(-ph / 60)) * (1 - (ph / 600) ** 6) : 0;
      const level = V / FACTOR;
      if (s % 1800 === 0) boiler = o.boilerOff ? 0 : rnd() > -0.2 ? 1 : 0;
      const q = {
        발전소: Math.max(5000, 20000 + 600 * (level - 55) + 2500 * Math.sin(s / 5000)),
        열연가열로: 12000 + 3500 * Math.sin(s / 9000 + 1) + 1500 * Math.sin(s / 1700),
        보일러: boiler * (5500 + 800 * Math.sin(s / 2500)),
      };
      V += (qin - q.발전소 - q.열연가열로 - q.보일러 - LOSS) * dt / 3600;
      levHist.push(V / FACTOR);
      if (s % 5 === 0) rec.push([s, inGap(s, o.recHole) ? 'I/O Timeout' : qin * (1 + rnd() * 0.01)]);
      if (s % 60 === 17) Object.keys(q).forEach(k => use[k].push([s, q[k] * BIAS[k] * (1 + rnd() * 0.01)]));
      // 레벨: 잡음, 센서 지연(lagS초 전 값), 끊김
      if (s % 30 === 0) lev.push([s, inGap(s, o.levelOutage) ? 'I/O Timeout' : Math.round((levHist[Math.max(0, levHist.length - 1 - lagS)] + rnd() * noise) * 100) / 100]);
    }
    const toText = (head, arr) => [head, ...arr.map(([s, v]) => `${stamp(s)}\t${typeof v === 'number' ? +v.toFixed(1) : v}`)].join('\n');
    const usesText = ['시각\t사용처\t유량(Nm3/h)', ...Object.keys(use).flatMap(k => use[k].map(([s, v]) => `${stamp(s)}\t${k}\t${v.toFixed(0)}`))].join('\n');
    return {
      sources: [
        { name: '전로회수.csv', text: toText('시각\t회수유량(Nm3/h)', rec) },
        { name: '사용처유량.csv', text: usesText },
        { name: '홀더레벨.csv', text: toText('시각\t홀더레벨(%)', lev) },
      ],
      levelFactor: FACTOR, truth: { bias: BIAS, loss: LOSS },
    };
  }

  /* ---------- 예시 2: 물탱크 (펌프 2대로 채우고 3곳에서 씀, 수위 %, 탱크 크기 모름) ---------- */
  function demoTank() {
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const p2 = n => String(n).padStart(2, '0');
    const stamp = s => { const d = new Date(Date.UTC(2026, 9, 5) + s * 1000); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
    const AREA = 8; // 수위 1% = 8 m³
    const BIAS = { '2번 펌프': 0.95, '세척 라인': 1.06 };
    let V = 50 * AREA, p1 = 1, p2on = 0, prev = null;
    const rows = ['시각\t1번 펌프 유입(m3/h)\t2번 펌프 유입(m3/h)\t공정 사용(m3/h)\t세척 라인(m3/h)\t냉각탑 보충(m3/h)\t탱크 수위(%)'];
    for (let m = 0; m <= 3 * 1440; m++) {
      const lv = V / AREA;
      if (lv < 35) p2on = 1; else if (lv > 65) p2on = 0;
      if (m % 240 === 0) p1 = rnd() > -0.35 ? 1 : 0;
      const q = { in1: p1 * (60 + rnd() * 4), in2: p2on * (45 + rnd() * 3), proc: 40 + 15 * Math.sin(m / 180) + rnd() * 3, wash: (m % 120 < 30 ? 25 : 2) + rnd(), cool: 12 + 4 * Math.sin(m / 400 + 2) };
      const net = q.in1 + q.in2 - q.proc - q.wash - q.cool - 1.5;
      if (prev != null) V += (prev + net) / 2 / 60; // 기록 사이를 선으로 잇는 것과 같은 방식으로 쌓는다
      prev = net;
      rows.push([stamp(m * 60), q.in1.toFixed(1), (q.in2 * BIAS['2번 펌프']).toFixed(1), q.proc.toFixed(1), (q.wash * BIAS['세척 라인']).toFixed(1), q.cool.toFixed(1), (V / AREA + rnd() * 0.06).toFixed(2)].join('\t'));
    }
    return { sources: [{ name: '물탱크_3일.csv', text: rows.join('\n') }], levelFactor: null, truth: { area: AREA, bias: BIAS, loss: 1.5 } };
  }

  const Balance = { ROLE_LABEL, UNIT_SEC, extract, guessRole, flowUnitOf, volumeScaleOf, amountUnitOf, valueAt, integrate, levelDelta, ols, analyze, pickWindow, commonGrid, demo, demoTank };
  if (typeof module !== 'undefined' && module.exports) module.exports = Balance;
  else root.Balance = Balance;
})(typeof globalThis !== 'undefined' ? globalThis : this);
