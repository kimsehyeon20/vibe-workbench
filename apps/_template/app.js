'use strict';

// 이 기기에만 저장되는 간단한 저장소. 앱마다 KEY를 바꿔서 다른 앱과 섞이지 않게 한다.
const KEY = 'template';
const store = {
  get(k, d) { try { const v = localStorage.getItem(`${KEY}:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`${KEY}:${k}`, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};

const countEl = document.getElementById('count');
let count = store.get('count', 0);
countEl.textContent = count;

document.getElementById('count-btn').addEventListener('click', () => {
  count += 1;
  countEl.textContent = count;
  store.set('count', count);
});
