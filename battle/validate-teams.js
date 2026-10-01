// サンプルチームを Showdown の検証器にかけ、ルール違反がないことを確かめる
'use strict';
// Showdown が使う ts-chacha20 を、このフォルダの node_modules から読めるようにする
process.env.NODE_PATH = [require('path').join(__dirname, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(require('path').delimiter);
require('module').Module._initPaths();
const fs = require('fs');
const { Teams, TeamValidator } = require(process.argv[2] + '/dist/sim');
const PD = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'ps-data.json'), 'utf8'));
const FMT = {};
for (const [g, G] of Object.entries(PD.games)) for (const [rule, f] of Object.entries(G.formats)) FMT[`${g}_${rule}`] = f.id;
const text = fs.readFileSync(process.argv[3], 'utf8');
const out = {}; let bad = 0;
for (const block of text.split(/^=== (\w+) ===$/m).slice(1).reduce((a, x, i, arr) => (i % 2 ? a : a.concat([[x, arr[i + 1]]])), [])) {
  const [key, paste] = block;
  const team = Teams.import(paste.trim());
  if (!FMT[key]) { console.log(`::warning::サンプル ${key} に対応するルールがないため外しました`); continue; }
  const problems = TeamValidator.get(FMT[key]).validateTeam(team);
  if (problems) {
    // ルール（レギュレーション）が変わると使えなくなることがある。止めずに外し、画面では おまかせ で代わりを作る
    bad++;
    console.log(`::warning::サンプル ${key} は ${FMT[key]} で使えないため外しました: ${problems.slice(0, 3).join(' / ')}`);
    continue;
  }
  console.log(key, team.length, '体 OK');
  out[key] = Teams.pack(team);
}
if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(out));
process.exit(0);
