// ブラウザ用の fs の代わり。Showdown が mods フォルダを一覧するときだけ使われる
import { MODS } from '../config.js';
export function readdirSync(p) { return /\/mods\/?$/.test(String(p)) ? MODS.slice() : []; }
export function existsSync() { return false; }
export function readFileSync(p) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
export function statSync(p) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
export default { readdirSync, existsSync, readFileSync, statSync };
