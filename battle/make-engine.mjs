// Showdown のシミュレーターを、ブラウザで動く1本の JS にまとめる
import { build } from 'esbuild';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
const PS_DIR = process.env.PS_DIR || '/tmp/psfull';
// 使うルールと mod は export-ps.js が ps-data.json に書いたものに合わせる
const PD = JSON.parse(readFileSync(new URL('./ps-data.json', import.meta.url), 'utf8'));
const FORMAT_IDS = Object.values(PD.games).flatMap(g => Object.values(g.formats).map(f => f.id));
const MODS = PD.mods;
// 必要なデータファイルだけを静的に取り込む表を作る（learnsets とランダムバトル用データは入れない）
const FILES = ['abilities', 'aliases', 'conditions', 'formats-data', 'items', 'moves', 'natures', 'pokedex', 'rulesets', 'scripts', 'typechart'];
const lines = ['// 生成ファイル（make-engine.mjs が作る）。Showdown の必要なデータだけを取り込む', 'const T = Object.create(null);'];
let n = 0;
for (const f of FILES) lines.push(`import * as d${n} from 'ps/dist/data/${f}.js'; T['/ps/data/${f}'] = d${n++};`);
for (const mod of MODS) for (const f of FILES) {
  if (!existsSync(`${PS_DIR}/dist/data/mods/${mod}/${f}.js`)) continue;
  lines.push(`import * as d${n} from 'ps/dist/data/mods/${mod}/${f}.js'; T['/ps/data/mods/${mod}/${f}'] = d${n++};`);
}
lines.push("import * as fm from 'ps/dist/config/formats.js';", 'export { T, fm };', '');
writeFileSync(new URL('./engine/data-table.js', import.meta.url), lines.join('\n'));
writeFileSync(new URL('./engine/config.js', import.meta.url),
  `// 生成ファイル（make-engine.mjs が作る）\nexport const FORMAT_IDS = ${JSON.stringify(FORMAT_IDS)};\nexport const MODS = ${JSON.stringify(MODS)};\n`);
console.log('ルール:', FORMAT_IDS.join(', '), '／ mod:', MODS.join(', ') || 'なし');
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
// ランダムバトル用のチーム生成（大きな JSON を含む）は使わないので、空のモジュールに置き換える
const dropRandom = {
  name: 'drop-random-battles',
  setup(b) {
    b.onResolve({ filter: /random-teams|random-battles|\.json$/ }, a => ({ path: a.path, namespace: 'empty' }));
    b.onResolve({ filter: /^\.\.\/lib$/ }, () => ({ path: here + 'engine/shims/lib-index.js' }));
    // データ・ルールの読み込み（/ps/...）は実行時に entry.js の表で解決する
    b.onResolve({ filter: /^\/ps\// }, a => ({ path: a.path, external: true }));
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  },
};
const r = await build({
  entryPoints: ['engine/entry.js'], bundle: true, format: 'iife', globalName: 'PSEngine',
  platform: 'browser', target: 'es2020', minify: true, legalComments: 'none', metafile: true,
  define: { __dirname: '"/ps/sim"' },
  alias: { fs: './engine/shims/fs.js', path: './engine/shims/path.js', 'node:util': './engine/shims/util.js',
    'node:crypto': './engine/shims/crypto.js', assert: './engine/shims/assert.js', ps: PS_DIR },
  // Node にしかない関数を、読み込み前に最小限用意する
  banner: { js: 'globalThis.process=globalThis.process||{env:{},version:"",versions:{}};globalThis.setImmediate=globalThis.setImmediate||((f,...a)=>setTimeout(f,0,...a));' },
  outfile: 'build/engine.js', logLevel: 'warning', logOverride: { 'empty-glob': 'silent' },   // ランダムバトル用の読み込みは使わない
  nodePaths: [here + 'node_modules'], plugins: [dropRandom],
});
const size = Object.values(r.metafile.outputs)[0].bytes;
console.log('engine.js', (size / 1e6).toFixed(2), 'MB');
