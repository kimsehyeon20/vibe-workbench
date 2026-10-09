import { useEffect, useMemo, useState } from 'react';
import { norm } from '../lib/model.js';

const PATHS = {
  back: 'M15 18l-6-6 6-6',
  close: 'M18 6L6 18M6 6l12 12',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  graph: 'M6 7a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM12 21a2 2 0 100-4 2 2 0 000 4zM7.5 6.2l8.7 1.4M6.8 6.8l4.4 10.4M17.2 8.9l-4.4 8.3',
  layers: 'M12 2l10 5-10 5L2 7l10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10.9 10.9 0 0112 5c6.4 0 10 7 10 7a17.8 17.8 0 01-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a10 10 0 005.4-1.6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM6 15V9a4 4 0 014-4h4M18 9v6a4 4 0 01-4 4h-4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  share: 'M12 3v13M7 8l5-5 5 5M5 13v7h14v-7',
  check: 'M5 12l5 5L20 7',
  chevron: 'M9 6l6 6-6 6',
  merge: 'M6 3v6a6 6 0 006 6h6M15 12l3 3-3 3M6 21v-6',
  file: 'M14 3H6v18h12V7l-4-4zM14 3v4h4',
  camera: 'M4 8h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 100-8 4 4 0 000 8z',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
};

export function Icon({ name, size = 20, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

// 클래스 모양을 2D 기호로(범례·목록용)
export function ShapeIcon({ shape = 0, color, size = 16 }) {
  const s = ((shape % 8) + 8) % 8;
  const p = { fill: color, stroke: color, strokeWidth: 1 };
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" style={{ flex: 'none' }}>
      {s === 0 && <circle cx="10" cy="10" r="7" {...p} />}
      {s === 1 && <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" {...p} />}
      {s === 2 && <polygon points="10,2 18,10 10,18 2,10" {...p} />}
      {s === 3 && <polygon points="10,2.5 18,17 2,17" {...p} />}
      {s === 4 && <path d="M4 5.5a6 2.5 0 0112 0v9a6 2.5 0 01-12 0z" {...p} />}
      {s === 5 && <circle cx="10" cy="10" r="5.6" fill="none" stroke={color} strokeWidth="3.6" />}
      {s === 6 && <polygon points="10,2 17.6,7.5 14.7,16.5 5.3,16.5 2.4,7.5" {...p} />}
      {s === 7 && <path d="M7.5 2.5h5v5h5v5h-5v5h-5v-5h-5v-5h5z" {...p} />}
    </svg>
  );
}

export function LineSwatch({ color, dashed }) {
  return (
    <svg viewBox="0 0 24 10" width="22" height="10" aria-hidden="true" style={{ flex: 'none' }}>
      <line x1="1" y1="5" x2="17" y2="5" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={dashed ? '3 3' : undefined} />
      <polygon points="16,1 23,5 16,9" fill={color} />
    </svg>
  );
}

export function Sheet({ title, onClose, children, footer, full, className = '' }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`sheet-wrap ${full ? 'full' : ''}`} onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <section className={`sheet ${className}`} role="dialog" aria-label={title}>
        <header className="sheet-head">
          <h2>{title}</h2>
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="닫기"><Icon name="close" /></button>}
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </section>
    </div>
  );
}

export function Segmented({ value, onChange, options, small }) {
  return (
    <div className={`seg ${small ? 'small' : ''}`} role="tablist">
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="toggle">
      <span className="toggle-text">{label}{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-ui" aria-hidden="true" />
    </label>
  );
}

// 엔티티 검색해서 하나 고르기
export function EntityPicker({ project, look, onPick, exclude, placeholder = '이름으로 찾기', autoFocus }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const n = norm(q);
    const list = n ? project.entities.filter(e => norm(e.label).includes(n) || norm(e.key).includes(n)) : [];
    return list.filter(e => e.id !== exclude).slice(0, 30).map(e => ({ e, c: look.cls(e.classId) }));
  }, [q, project, exclude, look]);
  return (
    <div className="picker">
      <div className="search">
        <Icon name="search" size={18} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} enterKeyHint="search" />
      </div>
      {results.length > 0 && (
        <ul className="pick-list">
          {results.map(({ e, c }) => (
            <li key={e.id}>
              <button onClick={() => { onPick(e); setQ(''); }}>
                <ShapeIcon shape={c.shape} color={c.color} size={14} />
                <span className="grow ellipsis">{e.label}</span>
                <small>{c.name}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.ms || 2600);
    return () => clearTimeout(t);
  }, [toast]);
  const show = (text, opts = {}) => setToast({ text, ...opts, at: Date.now() });
  const node = toast && (
    <div className="toast" role="status">
      <span>{toast.text}</span>
      {toast.action && <button onClick={() => { toast.action.run(); setToast(null); }}>{toast.action.label}</button>}
    </div>
  );
  return [show, node];
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function downloadText(text, name, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function shareText(text, name, mime = 'text/plain') {
  try {
    const file = new File([text], name, { type: mime });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return 'shared'; }
    if (navigator.share) { await navigator.share({ title: name, text: text.slice(0, 50000) }); return 'shared'; }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancel';
  }
  return 'unsupported';
}
