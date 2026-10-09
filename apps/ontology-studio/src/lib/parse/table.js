// 표(table) 형태 데이터: CSV/TSV/엑셀/JSON 배열 → 공통 표 구조
// table = { id, name, source, columns: string[], rows: string[][], parent?: { tableId, rel }, parentIndex?: number[] }
import Papa from 'papaparse';
import { unzipSync, strFromU8 } from 'fflate';
import { unxml } from './text.js';

export const MAX_ROWS = 20000;
let seq = 0;
export const tableId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export function makeTable(name, source, header, body, warnings) {
  const columns = [], seen = new Map();
  header.forEach((h, i) => {
    let c = String(h ?? '').trim() || `열${i + 1}`;
    const n = seen.get(c) || 0;
    seen.set(c, n + 1);
    if (n) c = `${c}_${n + 1}`;
    columns.push(c);
  });
  let rows = body.map(r => columns.map((_, i) => (r[i] == null ? '' : String(r[i]).trim())));
  rows = rows.filter(r => r.some(v => v !== ''));
  if (rows.length > MAX_ROWS) {
    warnings?.push(`${source}: 행이 ${rows.length.toLocaleString()}개라 앞의 ${MAX_ROWS.toLocaleString()}개만 가져와요`);
    rows = rows.slice(0, MAX_ROWS);
  }
  return { id: tableId(), name, source, columns, rows };
}

export function parseCsv(text, name, source, warnings, delimiter) {
  const res = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy', delimiter: delimiter || '' });
  const data = res.data.filter(r => Array.isArray(r) && r.some(v => String(v).trim() !== ''));
  if (data.length < 2) { warnings?.push(`${source}: 표로 읽을 줄이 부족해요`); return null; }
  return makeTable(name, source, data[0], data.slice(1), warnings);
}

// ── 엑셀(.xlsx) 최소 리더: xlsx 는 XML 묶음 ZIP 이라 직접 읽는다 ──
const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase();
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const attr = (s, name) => s.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const textRuns = xml => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('');

function serialToDate(n) {
  const d = new Date(Math.round((n - 25569) * 86400000));
  if (Number.isNaN(d.getTime())) return String(n);
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

export function parseXlsx(u8, fileName, source, warnings) {
  let files;
  try { files = unzipSync(u8, { filter: f => f.name.startsWith('xl/') }); } catch { warnings?.push(`${source}: 엑셀 파일을 열 수 없어요`); return []; }
  const read = p => (files[p] ? strFromU8(files[p]) : '');
  const wb = read('xl/workbook.xml');
  if (!wb) { warnings?.push(`${source}: .xlsx 형식이 아니에요 (.xls 는 엑셀에서 .xlsx 나 .csv 로 저장해 주세요)`); return []; }

  const rels = new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)].map(m => [attr(m[1], 'Id'), attr(m[1], 'Target')]));
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => textRuns(m[1]));

  // 날짜 서식이 걸린 셀 스타일 번호 찾기
  const styles = read('xl/styles.xml');
  const customDate = new Set([...styles.matchAll(/<numFmt\b([^>]*)\/?>/g)]
    .filter(m => /[dmy]/i.test((unxml(attr(m[1], 'formatCode') || '')).replace(/"[^"]*"|\[[^\]]*\]/g, '')))
    .map(m => Number(attr(m[1], 'numFmtId'))));
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || '';
  const dateStyle = [...xfs.matchAll(/<xf\b([^>]*)\/?>/g)].map(m => {
    const id = Number(attr(m[1], 'numFmtId'));
    return BUILTIN_DATE_FMT.has(id) || customDate.has(id);
  });

  const sheets = [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map(m => ({ name: unxml(attr(m[1], 'name') || 'Sheet'), rid: attr(m[1], 'r:id') }));
  const tables = [];
  for (const sh of sheets) {
    let target = rels.get(sh.rid) || '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = read(target);
    if (!xml) continue;
    const grid = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = (Number(attr(rm[1], 'r')) || grid.length + 1) - 1;
      const row = [];
      let auto = 0;
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r');
        const ci = ref ? colIndex(ref) : auto;
        auto = ci + 1;
        const t = attr(cm[1], 't'), s = Number(attr(cm[1], 's') || 0), inner = cm[2] || '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textRuns(inner);
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'str' || t === 'e') val = unxml(v ?? '');
        else if (v != null) val = dateStyle[s] ? serialToDate(Number(v)) : unxml(v);
        row[ci] = val;
      }
      grid[r] = row;
    }
    const dense = grid.filter(r => r && r.some(v => v != null && String(v).trim() !== ''));
    if (dense.length < 2) continue;
    const width = Math.max(...dense.map(r => r.length));
    const norm = dense.map(r => Array.from({ length: width }, (_, i) => r[i] ?? ''));
    const name = sheets.length > 1 ? sh.name : fileName;
    tables.push(makeTable(name, `${source}› ${sh.name}`, norm[0], norm.slice(1), warnings));
  }
  if (!tables.length) warnings?.push(`${source}: 읽을 수 있는 시트가 없어요`);
  return tables;
}
