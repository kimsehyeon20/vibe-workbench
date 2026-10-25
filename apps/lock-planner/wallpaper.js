'use strict';

// 잠금화면 배경 그림을 캔버스에 그리는 부분.
// 크기는 아이폰 화면 '포인트'(가로 390 기준)로 계산하고, 실제 픽셀 수에 맞춰 늘려서 그린다.
const Wallpaper = (() => {
  const BASE_W = 390;       // 기준 화면 가로(포인트)
  const SIDE = 20;          // 화면 좌우 여백
  const GAP = 10;           // 카드 사이 간격
  const PAD = 16;           // 카드 안쪽 여백
  const HEAD = 18;          // 카드 제목 줄 높이
  const HEAD_GAP = 8;       // 제목과 내용 사이
  const BOTTOM_SAFE = 118;  // 아래쪽 손전등·카메라 버튼 자리
  const MCELL = 79;         // 우선순위 4칸의 한 칸 높이
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

  const FONTS = {
    sans: '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif',
    serif: '"Noto Serif KR", AppleMyungjo, serif',
    hand: 'Gaegu, "Apple SD Gothic Neo", sans-serif',
  };
  const FONT_FACE = { sans: '"Pretendard Variable"', serif: '"Noto Serif KR"', hand: 'Gaegu' };

  const GRADIENTS = [
    ['#0f2027', '#203a43', '#2c5364'],
    ['#141e30', '#243b55'],
    ['#232526', '#414345'],
    ['#134e5e', '#71b280'],
    ['#7f7fd5', '#86a8e7', '#91eae4'],
    ['#2193b0', '#6dd5ed'],
    ['#ff9a8b', '#ff6a88', '#ff99ac'],
    ['#ffecd2', '#fcb69f'],
  ];

  const QUADS = [
    { name: '급하고 중요', color: '#ff5a52' },
    { name: '중요', color: '#5e8bff' },
    { name: '급함', color: '#ff9f0a' },
    { name: '나중에', color: '#8e8e93' },
  ];

  // 글꼴을 미리 받아둘 때 쓰는 글자들 (그림에 들어가는 고정 문구)
  const STATIC_TEXT = '할 일 완료 모든 끝냈어요 추가해 보세요 개 더 오늘 일정 없어요 다가오는 예정된 이번 주 달 디데이 올해 진행률 남은 날 메모 급하고 중요 급함 나중에 종일 년 월 화 수 목 금 토 요일 0123456789 :/.-+%()… DAY';

  // ── 날짜 ──
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const diffDays = (from, to) => Math.round((parse(to) - parse(from)) / 86400000);
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const ddayLabel = n => (n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`);
  const shortDate = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()} (${DAYS[d.getDay()]})`; };
  const isDone = (t, today) => (t.daily ? t.doneOn === today : !!t.done);
  const byTime = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));

  // ── 색 ──
  const rgb = hex => { const v = parseInt(String(hex).replace('#', ''), 16) || 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

  function palette(style) {
    const dark = style.tone !== 'light';
    let a = rgb(style.accent || '#ff9f0a');
    if (!dark) a = a.map(v => Math.round(v * 0.78)); // 밝은 바탕에서는 포인트 색을 조금 진하게
    const lum = (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) / 255;
    return {
      dark,
      t1: dark ? '#ffffff' : '#141417',
      t2: dark ? 'rgba(255,255,255,0.68)' : 'rgba(20,20,23,0.6)',
      t3: dark ? 'rgba(255,255,255,0.36)' : 'rgba(20,20,23,0.3)',
      line: dark ? 'rgba(255,255,255,0.16)' : 'rgba(20,20,23,0.12)',
      accent: `rgb(${a.join(',')})`,
      onAccent: lum > 0.6 ? '#141417' : '#ffffff',
      sun: dark ? '#ff8a80' : '#d33a30',
      sat: dark ? '#8fb2ff' : '#2f63d6',
    };
  }

  // ── 글자 ──
  function setFont(c, size, weight) { c.ctx.font = `${weight} ${(size * c.fs).toFixed(2)}px ${c.family}`; }

  // 칸보다 길면 뒤를 '…'로 줄인다
  function fit(ctx, s, max) {
    s = String(s);
    if (max <= 0) return '';
    if (ctx.measureText(s).width <= max) return s;
    const ch = Array.from(s);
    let lo = 0, hi = ch.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(ch.slice(0, mid).join('') + '…').width <= max) lo = mid; else hi = mid - 1;
    }
    return ch.slice(0, lo).join('').trimEnd() + '…';
  }

  function text(c, s, x, y, o) {
    const { ctx } = c;
    setFont(c, o.size, o.weight || 500);
    ctx.fillStyle = o.color;
    ctx.textAlign = o.align || 'left';
    const str = o.max ? fit(ctx, s, o.max) : String(s);
    ctx.fillText(str, x, y);
    return ctx.measureText(str).width;
  }

  // 큰 숫자(D-12, 81%)는 칸이 좁으면 글자를 줄인다
  function bigText(c, s, x, y, max, color) {
    setFont(c, 32, 800);
    const w = c.ctx.measureText(s).width;
    text(c, s, x, y, { size: w > max ? Math.max(18, 32 * max / w) : 32, weight: 800, color });
  }

  // 띄어쓰기 기준으로 줄을 나누고, 너무 긴 단어는 글자 단위로 자른다
  function wrap(ctx, s, max) {
    const lines = [];
    for (const para of String(s).split('\n')) {
      let line = '';
      for (const token of para.split(/(\s+)/).filter(Boolean)) {
        if (ctx.measureText(line + token).width <= max) { line += token; continue; }
        if (/^\s+$/.test(token)) { lines.push(line); line = ''; continue; }
        if (line) { lines.push(line.trimEnd()); line = ''; }
        for (const ch of Array.from(token)) {
          if (line && ctx.measureText(line + ch).width > max) { lines.push(line); line = ''; }
          line += ch;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  // ── 모양 ──
  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function dot(c, x, y, r, color) {
    const { ctx } = c;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  }

  function checkbox(c, cx, cy, on) {
    const { ctx, pal } = c;
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    if (!on) { ctx.strokeStyle = pal.t2; ctx.lineWidth = 1.6; ctx.stroke(); return; }
    ctx.fillStyle = pal.accent; ctx.fill();
    ctx.strokeStyle = pal.onAccent; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 4, cy + 0.3); ctx.lineTo(cx - 1.2, cy + 3); ctx.lineTo(cx + 4.2, cy - 3); ctx.stroke();
  }

  function drawCard(c, x, y, w, h) {
    const { ctx, style, pal } = c;
    if (style.card === 'none') return;
    ctx.save();
    rrect(ctx, x, y, w, h, 22);
    if (style.card === 'glass' && c.blur) {
      // 흐리게 만든 배경을 카드 모양으로 오려 붙여 반투명 유리처럼 보이게 한다
      ctx.clip();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(c.blur, 0, 0, c.W, c.H);
      ctx.restore();
      ctx.fillStyle = pal.dark ? 'rgba(18,18,22,0.32)' : 'rgba(255,255,255,0.55)';
      ctx.fill();
      ctx.restore();
      ctx.save();
      rrect(ctx, x, y, w, h, 22);
      ctx.lineWidth = 1;
      ctx.strokeStyle = pal.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.7)';
      ctx.stroke();
    } else {
      ctx.fillStyle = pal.dark ? 'rgba(28,28,32,0.9)' : 'rgba(255,255,255,0.92)';
      ctx.fill();
    }
    ctx.restore();
  }

  function header(c, x, y, w, left, right) {
    const cy = y + PAD + HEAD / 2;
    text(c, left, x + PAD, cy, { size: 13, weight: 700, color: c.pal.t2, max: w * 0.6 });
    if (right) text(c, right, x + w - PAD, cy, { size: 13, weight: 500, color: c.pal.t2, align: 'right', max: w * 0.45 });
  }

  const bodyTop = y => y + PAD + HEAD + HEAD_GAP;
  const lim = (list, n) => ({ shown: list.slice(0, n), more: Math.max(0, list.length - n) });
  const listH = (rows, rowH, more) => PAD + HEAD + HEAD_GAP + Math.max(rows, 1) * rowH + (more ? 20 : 0) + PAD - 4;

  // ── 데이터 고르기 ──
  function taskRows(c) {
    const todo = c.data.tasks.filter(t => !isDone(t, c.today));
    const done = c.style.hideDone ? [] : c.data.tasks.filter(t => isDone(t, c.today));
    return lim(todo.concat(done), c.style.maxTasks || 6);
  }
  const todayEvents = c => c.data.events.filter(e => e.date === c.today).sort(byTime);
  const nextEvents = c => c.data.events.filter(e => e.date > c.today).sort(byTime);
  const eventDays = c => new Set(c.data.events.map(e => e.date));

  // 다가오는 디데이 먼저(가까운 순), 지난 디데이는 뒤로(최근 순)
  function ddays(c) {
    return c.data.ddays.filter(d => d.date).map(d => ({ ...d, n: diffDays(c.today, d.date) }))
      .sort((a, b) => (a.n < 0) - (b.n < 0) || (a.n < 0 ? b.n - a.n : a.n - b.n));
  }

  function monthInfo(c) {
    const t = parse(c.today), Y = t.getFullYear(), M = t.getMonth();
    const offset = (new Date(Y, M, 1).getDay() - c.style.weekStart + 7) % 7;
    const days = new Date(Y, M + 1, 0).getDate();
    return { Y, M, offset, days, rows: Math.ceil((offset + days) / 7) };
  }

  function noteLines(c, w) {
    setFont(c, 15, 500);
    const max = w - PAD * 2;
    let lines = wrap(c.ctx, c.data.note.trim(), max);
    if (lines.length > 6) { lines = lines.slice(0, 6); lines[5] = fit(c.ctx, lines[5] + '…', max); }
    return lines;
  }

  // ── 위젯(카드) 하나하나 ──
  // measure: 카드 높이 계산, draw: 그리기. half: 짝이 맞으면 반 칸씩 나란히 놓는다.
  const WIDGETS = {
    tasks: {
      name: '할 일', desc: '체크리스트',
      measure(c) { const r = taskRows(c); return listH(r.shown.length, 28, r.more); },
      draw(c, x, y, w) {
        const { ctx, pal } = c;
        const { shown, more } = taskRows(c);
        const total = c.data.tasks.length;
        const doneN = c.data.tasks.filter(t => isDone(t, c.today)).length;
        header(c, x, y, w, '할 일', total ? `${doneN}/${total} 완료` : '');
        let ry = bodyTop(y);
        if (!shown.length) {
          text(c, total ? '모든 할 일을 끝냈어요' : '할 일을 추가해 보세요', x + PAD, ry + 14, { size: 15, color: pal.t2 });
          return;
        }
        const tx = x + PAD + 28, max = x + w - PAD - tx;
        for (const t of shown) {
          const cy = ry + 14, done = isDone(t, c.today);
          checkbox(c, x + PAD + 9, cy, done);
          const tw = text(c, t.text, tx, cy, { size: 16, weight: 500, color: done ? pal.t2 : pal.t1, max });
          if (done) { ctx.fillStyle = pal.t2; ctx.fillRect(tx, cy - 0.6, tw, 1.3); }
          ry += 28;
        }
        if (more) text(c, `+ ${more}개 더`, tx, ry + 10, { size: 13, color: pal.t2 });
      },
    },

    matrix: {
      name: '우선순위 4칸', desc: '급함·중요로 나눈 할 일',
      measure: () => PAD + MCELL * 2 + 17 + PAD - 4,
      draw(c, x, y, w) {
        const { ctx, pal } = c;
        const todo = c.data.tasks.filter(t => !isDone(t, c.today));
        const cellW = (w - PAD * 2 - 16) / 2;
        ctx.fillStyle = pal.line;
        ctx.fillRect(x + w / 2 - 0.5, y + PAD, 1, MCELL * 2 + 17);
        ctx.fillRect(x + PAD, y + PAD + MCELL + 8, w - PAD * 2, 1);
        QUADS.forEach((q, i) => {
          const cx = x + PAD + (i % 2) * (cellW + 16), cy = y + PAD + Math.floor(i / 2) * (MCELL + 17);
          dot(c, cx + 4, cy + 9, 4, q.color);
          text(c, q.name, cx + 13, cy + 9, { size: 12.5, weight: 700, color: q.color, max: cellW - 13 });
          const items = todo.filter(t => t.quad === i);
          const n = items.length > 3 ? 2 : items.length;
          items.slice(0, n).forEach((t, j) => text(c, t.text, cx, cy + 31 + j * 19, { size: 14, weight: 500, color: pal.t1, max: cellW }));
          if (items.length > 3) text(c, `+ ${items.length - 2}개 더`, cx, cy + 31 + 2 * 19, { size: 12.5, color: pal.t2 });
          if (!items.length) text(c, '—', cx, cy + 31, { size: 14, color: pal.t3 });
        });
      },
    },

    today: {
      name: '오늘 일정', desc: '오늘 일정 목록',
      measure(c) { const r = lim(todayEvents(c), 4); return listH(r.shown.length, 26, r.more); },
      draw(c, x, y, w) {
        const { pal } = c;
        const d = parse(c.today);
        const r = lim(todayEvents(c), 4);
        header(c, x, y, w, '오늘 일정', `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일`);
        let ry = bodyTop(y);
        if (!r.shown.length) { text(c, '오늘은 일정이 없어요', x + PAD, ry + 13, { size: 15, color: pal.t2 }); return; }
        for (const e of r.shown) {
          const cy = ry + 13;
          text(c, e.time || '종일', x + PAD, cy, { size: 14, weight: 700, color: pal.accent });
          text(c, e.title, x + PAD + 56, cy, { size: 15.5, weight: 500, color: pal.t1, max: w - PAD * 2 - 56 });
          ry += 26;
        }
        if (r.more) text(c, `+ ${r.more}개 더`, x + PAD + 56, ry + 10, { size: 13, color: pal.t2 });
      },
    },

    upcoming: {
      name: '다가오는 일정', desc: '내일부터의 일정',
      measure(c) { const r = lim(nextEvents(c), 4); return listH(r.shown.length, 26, r.more); },
      draw(c, x, y, w) {
        const { pal } = c;
        const r = lim(nextEvents(c), 4);
        header(c, x, y, w, '다가오는 일정');
        let ry = bodyTop(y);
        if (!r.shown.length) { text(c, '예정된 일정이 없어요', x + PAD, ry + 13, { size: 15, color: pal.t2 }); return; }
        for (const e of r.shown) {
          const cy = ry + 13;
          text(c, shortDate(e.date), x + PAD, cy, { size: 13.5, weight: 600, color: pal.t2 });
          const dw = text(c, ddayLabel(diffDays(c.today, e.date)), x + w - PAD, cy, { size: 13, weight: 700, color: pal.accent, align: 'right' });
          text(c, e.title, x + PAD + 76, cy, { size: 15.5, weight: 500, color: pal.t1, max: w - PAD * 2 - 76 - dw - 8 });
          ry += 26;
        }
        if (r.more) text(c, `+ ${r.more}개 더`, x + PAD + 76, ry + 10, { size: 13, color: pal.t2 });
      },
    },

    week: {
      name: '이번 주', desc: '한 주 날짜 · 일정 있는 날 점 표시',
      measure: () => 90,
      draw(c, x, y, w) {
        const { pal, today } = c;
        const start = addDays(today, -((parse(today).getDay() - c.style.weekStart + 7) % 7));
        const colW = (w - PAD * 2) / 7;
        const evDays = eventDays(c);
        for (let i = 0; i < 7; i++) {
          const ds = addDays(start, i), d = parse(ds), dow = d.getDay(), isToday = ds === today;
          const cx = x + PAD + colW * (i + 0.5);
          text(c, DAYS[dow], cx, y + 24, { size: 12, weight: 600, color: dow === 0 ? pal.sun : dow === 6 ? pal.sat : pal.t2, align: 'center' });
          if (isToday) dot(c, cx, y + 54, 16, pal.accent);
          text(c, String(d.getDate()), cx, y + 54.5, {
            size: 17, weight: isToday ? 800 : 600, align: 'center',
            color: isToday ? pal.onAccent : ds < today ? pal.t2 : pal.t1,
          });
          if (evDays.has(ds)) dot(c, cx, y + 78, 2.6, ds < today ? pal.t3 : pal.accent);
        }
      },
    },

    month: {
      name: '이번 달', desc: '한 달 달력 · 일정 있는 날 점 표시',
      measure(c) { return PAD + 22 + 8 + 18 + monthInfo(c).rows * 30 + PAD - 6; },
      draw(c, x, y, w) {
        const { ctx, pal, today, style } = c;
        const { Y, M, offset, days } = monthInfo(c);
        const mw = text(c, `${M + 1}월`, x + PAD, y + PAD + 11, { size: 18, weight: 800, color: pal.t1 });
        text(c, String(Y), x + PAD + mw + 6, y + PAD + 12, { size: 13, weight: 600, color: pal.t2 });
        const colW = (w - PAD * 2) / 7;
        const wy = y + PAD + 22 + 8 + 9;
        for (let i = 0; i < 7; i++) {
          const dow = (style.weekStart + i) % 7;
          text(c, DAYS[dow], x + PAD + colW * (i + 0.5), wy, { size: 11.5, weight: 600, color: dow === 0 ? pal.sun : dow === 6 ? pal.sat : pal.t2, align: 'center' });
        }
        const gy = y + PAD + 22 + 8 + 18;
        const evDays = eventDays(c);
        for (let d = 1; d <= days; d++) {
          const i = offset + d - 1, col = i % 7, row = Math.floor(i / 7);
          const cx = x + PAD + colW * (col + 0.5), cy = gy + row * 30 + 15;
          const ds = `${Y}-${pad(M + 1)}-${pad(d)}`, dow = (style.weekStart + col) % 7, isToday = ds === today;
          ctx.globalAlpha = ds < today ? 0.45 : 1;
          if (isToday) dot(c, cx, cy, 13.5, pal.accent);
          text(c, String(d), cx, cy, {
            size: 14, weight: isToday ? 800 : 500, align: 'center',
            color: isToday ? pal.onAccent : dow === 0 ? pal.sun : dow === 6 ? pal.sat : pal.t1,
          });
          if (evDays.has(ds)) dot(c, cx, cy + 10.5, 2, isToday ? pal.onAccent : pal.accent);
          ctx.globalAlpha = 1;
        }
      },
    },

    dday: {
      name: '디데이', desc: '가장 가까운 디데이', half: true,
      measure(c) {
        const n = ddays(c).length;
        return n ? PAD + 18 + 42 + 18 + Math.min(n - 1, 2) * 22 + PAD - 4 : PAD + 18 + 34 + PAD - 4;
      },
      draw(c, x, y, w) {
        const { pal } = c;
        const list = ddays(c), inner = w - PAD * 2;
        if (!list.length) {
          text(c, '디데이', x + PAD, y + PAD + 9, { size: 13, weight: 700, color: pal.t2 });
          text(c, '디데이를 추가해 보세요', x + PAD, y + PAD + 18 + 17, { size: 14, color: pal.t2, max: inner });
          return;
        }
        const [first, ...rest] = list;
        text(c, first.title, x + PAD, y + PAD + 9, { size: 13, weight: 700, color: pal.t2, max: inner });
        bigText(c, ddayLabel(first.n), x + PAD, y + PAD + 18 + 22, inner, pal.accent);
        text(c, shortDate(first.date), x + PAD, y + PAD + 18 + 42 + 8, { size: 12.5, weight: 500, color: pal.t2 });
        rest.slice(0, 2).forEach((d, i) => {
          const cy = y + PAD + 18 + 42 + 18 + i * 22 + 11;
          const lw = text(c, ddayLabel(d.n), x + w - PAD, cy, { size: 13, weight: 700, color: pal.t1, align: 'right' });
          text(c, d.title, x + PAD, cy, { size: 13.5, weight: 500, color: pal.t2, max: inner - lw - 8 });
        });
      },
    },

    year: {
      name: '올해 진행률', desc: '올해가 얼마나 지났는지', half: true,
      measure: () => 116,
      draw(c, x, y, w) {
        const { ctx, pal } = c;
        const Y = parse(c.today).getFullYear();
        const total = diffDays(`${Y}-01-01`, `${Y + 1}-01-01`);
        const passed = diffDays(`${Y}-01-01`, c.today) + 1;
        const inner = w - PAD * 2;
        text(c, `${Y}년`, x + PAD, y + PAD + 9, { size: 13, weight: 700, color: pal.t2 });
        bigText(c, `${Math.floor(passed / total * 100)}%`, x + PAD, y + PAD + 18 + 22, inner, pal.t1);
        const by = y + PAD + 18 + 42 + 4;
        ctx.fillStyle = pal.line; rrect(ctx, x + PAD, by, inner, 6, 3); ctx.fill();
        ctx.fillStyle = pal.accent; rrect(ctx, x + PAD, by, Math.max(6, inner * passed / total), 6, 3); ctx.fill();
        text(c, `남은 날 ${total - passed}일`, x + PAD, by + 17, { size: 12.5, weight: 500, color: pal.t2 });
      },
    },

    note: {
      name: '메모', desc: '메모 고정 (메모 탭에서 적기)',
      visible: c => !!c.data.note.trim(),
      measure(c, w) { return listH(noteLines(c, w).length, 22, false); },
      draw(c, x, y, w) {
        header(c, x, y, w, '메모');
        noteLines(c, w).forEach((ln, i) => text(c, ln, x + PAD, bodyTop(y) + 11 + i * 22, { size: 15, weight: 500, color: c.pal.t1 }));
      },
    },
  };

  // ── 배경 ──
  function drawBackground(ctx, W, H, style, photo, pal) {
    if (style.bg === 'photo' && photo) {
      const iw = photo.naturalWidth || photo.width, ih = photo.naturalHeight || photo.height;
      const k = Math.max(W / iw, H / ih);
      ctx.drawImage(photo, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
    } else if (style.bg === 'color') {
      ctx.fillStyle = style.color || '#1c1c1e';
      ctx.fillRect(0, 0, W, H);
    } else {
      const stops = GRADIENTS[style.gradient] || GRADIENTS[0];
      const g = ctx.createLinearGradient(0, 0, W * 0.35, H);
      stops.forEach((col, i) => g.addColorStop(i / (stops.length - 1), col));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (style.dim > 0) {
      ctx.fillStyle = pal.dark ? `rgba(0,0,0,${style.dim})` : `rgba(255,255,255,${style.dim})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // 작게 줄였다가 다시 키우면 흐려진다 (유리 카드용)
  function makeBlur(src, W, H) {
    let cur = src, w = W, h = H;
    for (const f of [4, 4, 2]) {
      w = Math.max(4, Math.round(w / f));
      h = Math.max(4, Math.round(h / f));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const x = cv.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, w, h);
      cur = cv;
    }
    return cur;
  }

  // 아이폰 시계·버튼이 놓일 자리 (미리보기에만 그림)
  function drawGuide(c, Hpt) {
    const { ctx, pal, now } = c;
    ctx.save();
    ctx.fillStyle = pal.dark ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,23,0.88)';
    ctx.textAlign = 'center';
    ctx.font = `600 19px ${FONTS.sans}`;
    ctx.fillText(`${now.getMonth() + 1}월 ${now.getDate()}일 ${DAYS[now.getDay()]}요일`, BASE_W / 2, Hpt * 0.085);
    ctx.font = `700 96px ${FONTS.sans}`;
    ctx.fillText(`${now.getHours() % 12 || 12}:${pad(now.getMinutes())}`, BASE_W / 2, Hpt * 0.085 + 64);
    ctx.fillStyle = pal.dark ? 'rgba(255,255,255,0.2)' : 'rgba(20,20,23,0.14)';
    for (const bx of [66, BASE_W - 66]) { ctx.beginPath(); ctx.arc(bx, Hpt - 82, 25, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = pal.dark ? 'rgba(255,255,255,0.8)' : 'rgba(20,20,23,0.7)';
    rrect(ctx, BASE_W / 2 - 67, Hpt - 13, 134, 5, 2.5);
    ctx.fill();
    ctx.restore();
  }

  function buildRows(c) {
    const ids = c.data.widgets
      .filter(w => w.on && WIDGETS[w.id] && (!WIDGETS[w.id].visible || WIDGETS[w.id].visible(c)))
      .map(w => w.id);
    const rows = [];
    for (let i = 0; i < ids.length; i++) {
      if (WIDGETS[ids[i]].half && ids[i + 1] && WIDGETS[ids[i + 1]].half) { rows.push([ids[i], ids[i + 1]]); i++; }
      else rows.push([ids[i]]);
    }
    return rows;
  }

  const measureRows = (c, rows, cw) => rows.map(r => (r.length === 2
    ? Math.max(...r.map(id => WIDGETS[id].measure(c, (cw - GAP) / 2)))
    : WIDGETS[r[0]].measure(c, cw)));

  function drawWidget(c, id, x, y, w, h) {
    drawCard(c, x, y, w, h);
    WIDGETS[id].draw(c, x, y, w, h);
  }

  // opts: { W, H, photo, guide, now }
  function render(canvas, data, opts) {
    const { W, H } = opts;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const style = data.style;
    const u = W / BASE_W, Hpt = H / u;
    const pal = palette(style);
    const now = opts.now || new Date();
    const c = {
      ctx, data, style, pal, now, W, H, today: ymd(now),
      family: FONTS[style.font] || FONTS.sans, fs: style.font === 'hand' ? 1.12 : 1,
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground(ctx, W, H, style, opts.photo, pal);
    if (style.card === 'glass') c.blur = makeBlur(canvas, W, H);
    ctx.textBaseline = 'middle';

    // 내용이 많아서 아래 버튼 자리를 넘으면 전체를 줄인다
    const rows = buildRows(c);
    const top = Hpt * style.top, avail = Hpt - BOTTOM_SAFE - top;
    let s = style.size || 1, cw, heights;
    for (let i = 0; i < 5; i++) {
      cw = (BASE_W - SIDE * 2) / s;
      heights = measureRows(c, rows, cw);
      const total = heights.reduce((a, b) => a + b, 0) + GAP * Math.max(rows.length - 1, 0);
      if (total * s <= avail + 0.5 || i === 4) break;
      s = Math.max(0.25, avail / total);
    }

    const px = u * s;
    ctx.setTransform(px, 0, 0, px, 0, 0);
    if (style.card === 'none') {
      ctx.shadowColor = pal.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)';
      ctx.shadowBlur = 5 * px;
    }
    let y = top / s;
    const x0 = SIDE / s;
    rows.forEach((r, i) => {
      const h = heights[i];
      if (r.length === 2) {
        const hw = (cw - GAP) / 2;
        drawWidget(c, r[0], x0, y, hw, h);
        drawWidget(c, r[1], x0 + hw + GAP, y, hw, h);
      } else {
        drawWidget(c, r[0], x0, y, cw, h);
      }
      y += h + GAP;
    });

    if (opts.guide) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.setTransform(u, 0, 0, u, 0, 0);
      drawGuide(c, Hpt);
    }
    return { scale: s / (style.size || 1) }; // 1보다 작으면 내용이 많아서 자동으로 줄어든 것
  }

  // ── 글꼴 준비 ──
  function fontJobs(data) {
    const sample = [STATIC_TEXT, data.note, ...data.tasks.map(t => t.text), ...data.events.map(e => e.title), ...data.ddays.map(d => d.title)].join(' ');
    const faces = new Set([FONT_FACE.sans, FONT_FACE[data.style.font] || FONT_FACE.sans]);
    const list = [];
    for (const f of faces) for (const w of [400, 700]) list.push([`${w} 16px ${f}`, sample]);
    return list;
  }

  function fontsReady(data) {
    try { return !document.fonts || fontJobs(data).every(([f, s]) => document.fonts.check(f, s)); } catch { return true; }
  }

  async function loadFonts(data) {
    if (!document.fonts || !document.fonts.load) return;
    const jobs = fontJobs(data).map(([f, s]) => document.fonts.load(f, s).catch(() => {}));
    await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 4000))]);
  }

  const META = Object.fromEntries(Object.entries(WIDGETS).map(([id, w]) => [id, { name: w.name, desc: w.desc }]));

  return {
    render, loadFonts, fontsReady,
    ymd, parse, diffDays, addDays, ddayLabel, shortDate, isDone, byTime,
    DAYS, QUADS, GRADIENTS, WIDGETS: META,
  };
})();
