// 색 규칙
// - 검증된 8색 팔레트를 '고정 순서'로 배정한다(만든 순서 = 슬롯 번호). 필터로 개수가 바뀌어도 색은 그대로.
// - 9번째부터는 새 색을 만들지 않고 회색으로 접는다. 대신 범례 탭 강조·관계 이름 표시로 구분한다.
// - 라이트/다크는 같은 색상(hue)의 다른 단계를 쓴다.
export const SLOTS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
export const OTHER = { light: '#898781', dark: '#898781' };
export const SURFACE = { light: '#fcfcfb', dark: '#1a1a19' };
export const INK = { light: '#0b0b0b', dark: '#ffffff' };

// 클래스(노드 종류)마다 색과 함께 모양도 달리해서 색만으로 구분하지 않게 한다.
export const SHAPES = ['구', '정육면체', '팔면체', '사면체', '원기둥', '도넛', '십이면체', '십자'];

// 클래스 모양: 사용자가 고른 값 > 색 슬롯 번호 > 순서
export function classShape(c, i) {
  if (Number.isInteger(c.shape)) return c.shape;
  const n = typeof c.color === 'string' && c.color.startsWith('slot:') ? Number(c.color.slice(5)) : -1;
  return (n >= 0 ? n : i) % SHAPES.length;
}

export function slotColor(slot, mode) {
  const list = SLOTS[mode] || SLOTS.light;
  return slot >= 0 && slot < list.length ? list[slot] : OTHER[mode] || OTHER.light;
}

// color 값: 'slot:3' 처럼 슬롯을 가리키거나, 사용자가 고른 '#rrggbb'
export function resolveColor(color, mode) {
  if (typeof color === 'string' && color.startsWith('#')) return color;
  const n = typeof color === 'string' && color.startsWith('slot:') ? Number(color.slice(5)) : -1;
  return slotColor(n, mode);
}

export function nextSlot(items) {
  const used = new Set(items.map(i => i.color).filter(c => typeof c === 'string' && c.startsWith('slot:')));
  for (let i = 0; i < SLOTS.light.length; i++) if (!used.has(`slot:${i}`)) return `slot:${i}`;
  return 'slot:-1';
}

export function mix(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const ch = s => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}
