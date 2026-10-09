// 글자 인코딩 판별: UTF-8 이 아니면 한국어 엑셀 CSV 에 흔한 EUC-KR(CP949)로 다시 읽는다
export function decodeText(u8) {
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    try { return new TextDecoder('euc-kr').decode(u8); } catch { return new TextDecoder('utf-8').decode(u8); }
  }
}

// ZIP 안 파일 이름이 UTF-8 표시 없이 CP949 로 저장된 경우(윈도우에서 압축) 이름을 되살린다
export function fixZipName(name) {
  let high = false;
  for (const ch of name) { const c = ch.charCodeAt(0); if (c > 255) return name; if (c > 127) high = true; }
  if (!high) return name;
  const bytes = Uint8Array.from(name, ch => ch.charCodeAt(0));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* 다음 시도 */ }
  try { return new TextDecoder('euc-kr', { fatal: true }).decode(bytes); } catch { return name; }
}

export const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unxml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return XML_ENT[e] ?? m;
});

export const baseName = path => String(path).split('/').pop().replace(/\.[^.]+$/, '');
export const extOf = path => (String(path).match(/\.([^./]+)$/)?.[1] || '').toLowerCase();
