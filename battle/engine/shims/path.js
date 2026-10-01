// ブラウザ用の path の代わり（POSIX 形式だけ）
export const sep = '/';
export function normalize(p) {
  const abs = p.startsWith('/'), out = [];
  for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
  return (abs ? '/' : '') + out.join('/');
}
export function join(...a) { return normalize(a.filter(Boolean).join('/')); }
export function resolve(...a) { let r = ''; for (const s of a) r = s.startsWith('/') ? s : (r ? r + '/' + s : s); return normalize(r.startsWith('/') ? r : '/' + r); }
export function dirname(p) { const n = normalize(p); return n.slice(0, n.lastIndexOf('/')) || '/'; }
export function basename(p, ext) { const b = normalize(p).split('/').pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; }
export function extname(p) { const b = basename(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; }
export function relative(from, to) { return normalize(to); }
export default { sep, normalize, join, resolve, dirname, basename, extname, relative };
