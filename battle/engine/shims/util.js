// node:util の isDeepStrictEqual の代わり（Showdown はデータの比較にだけ使う）
export function isDeepStrictEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && isDeepStrictEqual(a[k], b[k]));
}
export default { isDeepStrictEqual };
