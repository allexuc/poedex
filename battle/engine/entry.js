// バトルエンジンの入口：Pokémon Showdown のシミュレーターをブラウザで動かす
import { T, fm } from './data-table.js';
import { Dex, toID as psToID } from 'ps/dist/sim/dex.js';
import { Teams } from 'ps/dist/sim/teams.js';
import { BattleStream, getPlayerStreams } from 'ps/dist/sim/battle-stream.js';
import { RandomPlayerAI } from 'ps/dist/sim/tools/random-player-ai.js';

import { FORMAT_IDS } from './config.js';
// 使うルールだけに絞る（ほかのルールは取り込んでいない mod を参照していて読み込めないため）
export { FORMAT_IDS };
const toID = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
T['/ps/config/formats'] = { Formats: fm.Formats.filter(f => f.name && FORMAT_IDS.includes(toID(f.name))) };

const norm = p => { const out = []; for (const s of String(p).split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return '/' + out.join('/'); };
globalThis.require = function (p) {
  const k = norm(p).replace(/\.js$/, '');
  if (k in T) return T[k];
  const e = new Error(`Cannot find module '${p}'`);
  e.code = 'MODULE_NOT_FOUND';
  throw e;
};

export { Dex, Teams, BattleStream, getPlayerStreams, psToID };
export { RandomPlayerAI };
