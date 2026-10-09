// 기기 안 저장: 데이터가 커질 수 있어 IndexedDB 를 쓰고, 안 되면 localStorage 로 대신한다.
const DB = 'ontology-studio', STORE = 'kv', LS = 'ontology-studio:';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req?.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}

export async function load(key) {
  try { return await tx('readonly', s => s.get(key)); } catch {
    try { const v = localStorage.getItem(LS + key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
  }
}

export async function save(key, value) {
  try { await tx('readwrite', s => s.put(value, key)); return true; } catch {
    try { localStorage.setItem(LS + key, JSON.stringify(value)); return true; } catch { return false; }
  }
}

// 작은 화면 설정(탭, 필터 등)
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem(LS + 'pref:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(LS + 'pref:' + k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
