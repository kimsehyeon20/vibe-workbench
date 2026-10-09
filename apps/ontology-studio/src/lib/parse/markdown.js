// 문서(.md/.txt) → 문서 노드 + [[위키링크]]·#태그·머리말(front matter) 관계
// 옵시디언 같은 노트 묶음(ZIP)을 넣으면 노트끼리의 연결이 그대로 그래프가 된다.
import { baseName } from './text.js';

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|pdf|mp4|mov)$/i;
const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g;

function splitFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return [{}, text];
  const fm = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && lastKey) { fm[lastKey] = [].concat(fm[lastKey] || [], unquote(item[1])); continue; }
    const kv = line.match(/^([^:#]+?):\s*(.*)$/);
    if (!kv) continue;
    lastKey = kv[1].trim();
    const v = kv[2].trim();
    if (!v) fm[lastKey] = [];
    else if (/^\[(?!\[).*\]$/.test(v)) fm[lastKey] = v.slice(1, -1).split(',').map(unquote).filter(Boolean);
    else fm[lastKey] = unquote(v);
  }
  return [fm, text.slice(m[0].length)];
}
const unquote = s => String(s).trim().replace(/^["']|["']$/g, '');
const wikiTarget = raw => raw.split('|')[0].split('#')[0].trim();

export function parseDoc(text, path) {
  const [fm, body] = splitFrontMatter(text);
  const plain = body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const links = new Set(), tags = new Set(), mdLinks = new Set();
  for (const m of plain.matchAll(WIKI)) {
    const t = wikiTarget(m[2]);
    if (t && !(m[1] && IMAGE.test(t))) links.add(t);
  }
  for (const m of plain.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu)) tags.add(m[1]);
  for (const m of plain.matchAll(/\[[^\]]*\]\(([^)\s]+\.(?:md|markdown|txt))\)/gi)) {
    try { mdLinks.add(decodeURIComponent(m[1])); } catch { mdLinks.add(m[1]); }
  }
  const h1 = body.match(/^#\s+(.+)$/m)?.[1].trim();
  const summary = plain
    .replace(/^#+\s+.*$/gm, ' ').replace(WIKI, (_, __, t) => t.split('|').pop()).replace(/[*_>#-]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 280);
  return { path, title: baseName(path), h1, fm, links: [...links], tags: [...tags], mdLinks: [...mdLinks], summary, length: body.length };
}

function resolvePath(from, rel) {
  if (rel.startsWith('/')) return rel.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

// 여러 문서를 한 번에 조각(fragment)으로: 문서끼리 서로 이름으로 찾을 수 있게 같이 처리한다
export function docsToFragment(docs, source) {
  const DOC = '문서', TAG = '태그';
  const frag = { classes: [], relTypes: [], entities: [], relations: [], sources: [] };
  if (!docs.length) return frag;
  frag.classes.push({ name: DOC, description: '가져온 노트·문서 파일' });
  const byPath = new Set(docs.map(d => d.path));
  for (const d of docs) {
    const me = { class: DOC, key: d.path };
    const props = { 경로: d.path, 요약: d.summary, 글자수: String(d.length) };
    if (d.h1 && d.h1 !== d.title) props.제목 = d.h1;
    for (const [k, v] of Object.entries(d.fm)) {
      const vals = [].concat(v).map(String);
      const linked = vals.flatMap(x => [...x.matchAll(WIKI)].map(m => wikiTarget(m[2])));
      if (/^tags?$|^태그$/i.test(k)) { vals.forEach(t => t && d.tags.push(t.replace(/^#/, ''))); continue; }
      if (linked.length) linked.forEach(t => frag.relations.push({ from: me, type: k, to: { label: t, class: DOC }, src: d.path }));
      else props[k] = vals.join('; ');
    }
    frag.entities.push({ class: DOC, key: d.path, label: d.title, props, src: d.path });
    for (const t of d.links) frag.relations.push({ from: me, type: '링크', to: { label: t, class: DOC }, src: d.path });
    for (const rel of d.mdLinks) {
      const p = resolvePath(d.path, rel);
      frag.relations.push({ from: me, type: '링크', to: byPath.has(p) ? { class: DOC, key: p } : { label: baseName(p), class: DOC }, src: d.path });
    }
    for (const t of new Set(d.tags)) {
      frag.entities.push({ class: TAG, key: t, label: `#${t}` });
      frag.relations.push({ from: me, type: '태그', to: { class: TAG, key: t }, src: d.path });
    }
  }
  if (docs.some(d => d.tags.length)) {
    frag.classes.push({ name: TAG, description: '문서에 붙은 #태그' });
    frag.relTypes.push({ name: '태그', description: '문서에 이 태그가 붙어 있음' });
  }
  if (docs.some(d => d.links.length || d.mdLinks.length)) frag.relTypes.push({ name: '링크', description: '문서 본문에서 다른 항목을 [[위키링크]]나 링크로 가리킴' });
  frag.sources.push({ name: source, kind: 'docs', counts: { docs: docs.length } });
  return frag;
}
