// { フォーマットID: [パック形式のチーム, ...] } の JSON を Showdown の検証器にかけ、問題の一覧を JSON で出す
//   node validate-packed.js <showdown のディレクトリ> <JSON>
'use strict';
process.env.NODE_PATH = [require('path').join(__dirname, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(require('path').delimiter);
require('module').Module._initPaths();
const { TeamValidator, Teams } = require(process.argv[2] + '/dist/sim');
const data = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
const out = { total: 0, bad: 0, problems: [] };
for (const [fid, teams] of Object.entries(data)) {
  const v = TeamValidator.get(fid);
  for (const packed of teams) {
    out.total++;
    const probs = v.validateTeam(Teams.unpack(packed));
    if (probs) { out.bad++; out.problems.push(...probs.slice(0, 2)); }
  }
}
console.log(JSON.stringify(out));
