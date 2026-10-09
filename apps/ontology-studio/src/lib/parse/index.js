// 파일 종류별로 나눠서 해석한다. ZIP 은 풀어서 안의 파일을 다시 같은 방식으로 처리.
import { unzipSync } from 'fflate';
import { decodeText, fixZipName, baseName, extOf } from './text.js';
import { parseCsv, parseXlsx } from './table.js';
import { parseJsonText } from './json.js';
import { parseDoc, docsToFragment } from './markdown.js';

const SKIP = /(^|\/)(__MACOSX|\.git|node_modules)\/|(^|\/)\.[^/]*$|Thumbs\.db$|desktop\.ini$/i;
const DOC_EXT = new Set(['md', 'markdown', 'txt', 'text', 'org', 'rst']);
const MAX_ENTRIES = 3000;

function emptyResult() {
  return { tables: [], fragments: [], projects: [], docs: [], files: [], warnings: [], sources: [] };
}

function handle(res, name, bytes, depth) {
  const ext = extOf(name);
  const base = baseName(name);
  if (ext === 'zip') {
    if (depth > 1) { res.warnings.push(`${name}: ZIP 안의 ZIP 은 한 단계까지만 열어요`); return; }
    let entries;
    try { entries = unzipSync(bytes); } catch { res.warnings.push(`${name}: ZIP 을 풀 수 없어요(암호가 걸렸거나 손상됨)`); return; }
    const list = Object.entries(entries).map(([n, b]) => [fixZipName(n), b]).filter(([n, b]) => !n.endsWith('/') && !SKIP.test(n) && b.length);
    if (list.length > MAX_ENTRIES) res.warnings.push(`${name}: 파일이 ${list.length}개라 앞의 ${MAX_ENTRIES}개만 읽어요`);
    for (const [n, b] of list.slice(0, MAX_ENTRIES)) handle(res, n, b, depth + 1);
    return;
  }
  if (ext === 'csv' || ext === 'tsv') {
    const t = parseCsv(decodeText(bytes), base, name, res.warnings, ext === 'tsv' ? '\t' : '');
    if (t) res.tables.push(t);
    return;
  }
  if (ext === 'xlsx' || ext === 'xlsm') { res.tables.push(...parseXlsx(bytes, base, name, res.warnings)); return; }
  if (ext === 'xls') { res.warnings.push(`${name}: 옛 엑셀(.xls)은 못 읽어요. 엑셀에서 .xlsx 나 .csv 로 저장해 주세요`); return; }
  if (['json', 'jsonld', 'jsonl', 'ndjson', 'geojson'].includes(ext)) { addJson(res, decodeText(bytes), base, name); return; }
  if (DOC_EXT.has(ext)) { res.docs.push(parseDoc(decodeText(bytes), name)); return; }
  // 그 밖의 파일(이미지, PDF 등)은 내용 대신 '파일' 노드로 남겨서 빠뜨리지 않는다
  res.files.push({ path: name, ext: ext || '없음', size: bytes.length });
}

function addJson(res, text, base, source) {
  const out = parseJsonText(text, base, source, res.warnings);
  if (out.project) res.projects.push({ project: out.project, name: source });
  if (out.fragment) res.fragments.push({ fragment: out.fragment, matchByLabel: out.matchByLabel });
  if (out.tables) res.tables.push(...out.tables);
}

export async function parseFiles(fileList) {
  const res = emptyResult();
  for (const f of fileList) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    res.sources.push({ name: f.name, kind: extOf(f.name) || 'file', size: bytes.length });
    handle(res, f.name, bytes, 0);
  }
  return finish(res);
}

export function parseEntries(entries) {
  const res = emptyResult();
  for (const { name, bytes } of entries) {
    res.sources.push({ name, kind: extOf(name) || 'file', size: bytes.length });
    handle(res, name, bytes, 0);
  }
  return finish(res);
}

// 붙여넣은 글: JSON → 표(구분자 일정) → 문서 순서로 짐작
export function parseText(text, name = '붙여넣은 글') {
  const res = emptyResult();
  const t = text.trim();
  res.sources.push({ name, kind: 'paste', size: t.length });
  if (/^[[{]/.test(t)) addJson(res, t, name, name);
  else if (looksTabular(t)) {
    const tb = parseCsv(t, name, name, res.warnings, t.includes('\t') ? '\t' : '');
    if (tb) res.tables.push(tb);
  } else res.docs.push(parseDoc(t, `${name}.md`));
  return finish(res);
}

function looksTabular(t) {
  const lines = t.split(/\r?\n/).filter(Boolean).slice(0, 20);
  if (lines.length < 2) return false;
  for (const d of ['\t', ',', ';', '|']) {
    const counts = lines.map(l => l.split(d).length - 1);
    if (counts[0] > 0 && counts.every(c => c === counts[0])) return true;
  }
  return false;
}

function finish(res) {
  const extra = [];
  if (res.docs.length) extra.push(docsToFragment(res.docs, res.docs.length === 1 ? res.docs[0].path : `문서 ${res.docs.length}개`));
  if (res.files.length) {
    extra.push({
      classes: [{ name: '파일', description: '내용을 해석하지 않고 이름·형식·크기만 기록한 파일' }],
      entities: res.files.map(f => ({ class: '파일', key: f.path, label: f.path.split('/').pop(), props: { 경로: f.path, 형식: f.ext, 크기: `${Math.max(1, Math.round(f.size / 1024))}KB` }, src: f.path })),
      relations: [], relTypes: [], sources: [],
    });
    const kinds = [...new Set(res.files.map(f => f.ext))].slice(0, 5).join(', ');
    res.warnings.push(`${res.files.length}개 파일(${kinds})은 내용 대신 '파일' 노드로만 추가해요`);
  }
  for (const f of extra) res.fragments.push({ fragment: f });
  return res;
}
