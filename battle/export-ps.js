// Pokémon Showdown の検証器（TeamValidator）で「そのルールで使えるもの」を判定し、JSON に書き出す。
// ここで作る一覧がチーム編集の選択肢になるので、編集画面で選べるものは必ずルール上使えるものになる。
//   node export-ps.js <showdown のディレクトリ> <出力 JSON>
'use strict';
// Showdown が使う ts-chacha20 を、このフォルダの node_modules から読めるようにする
process.env.NODE_PATH = [require('path').join(__dirname, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(require('path').delimiter);
require('module').Module._initPaths();
const fs = require('fs');
const PS = process.argv[2];
const { Dex, TeamValidator, toID } = require(PS + '/dist/sim');

// 使うルールは formats.json で決める（auto: は最新のレギュレーションを自動で選ぶ）。
// 使えるポケモン・技はシングルとダブルで同じなので、シングル側の検証器で判定する
const CONF = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'formats.json'), 'utf8'));
function resolveFormat(spec) {
  if (!spec.startsWith('auto:')) { const f = Dex.formats.get(spec); if (!f.exists) throw new Error('ルールが見つかりません: ' + spec); return f; }
  // 一致したルールのうち、年とレギュレーションがいちばん新しいもの（一覧の並び順には頼らない）
  const re = new RegExp(spec.slice(5));
  const key = f => `${(f.name.match(/\b(20\d\d)\b/) || ['', '0000'])[1]} ${(f.name.match(/Reg ([A-Z][A-Z-]*)\s*$/) || ['', ''])[1]}`;
  const list = Dex.formats.all().filter(x => re.test(x.name)).sort((a, b) => key(b).localeCompare(key(a)));
  if (!list.length) throw new Error('ルールが見つかりません: ' + spec);
  return list[0];
}
const GAMES = {}, MODS = new Set();
for (const [g, rules] of Object.entries(CONF)) {
  if (g.startsWith('_')) continue;
  GAMES[g] = {};
  for (const [rule, spec] of Object.entries(rules)) {
    const f = resolveFormat(spec);
    GAMES[g][rule] = f.id;
    // ブラウザ用のエンジンに入れる mod（継承元もたどる。gen9 は本体のデータ）
    let mod = Dex.forFormat(f).currentMod;
    while (mod && mod !== 'base' && mod !== 'gen9') { MODS.add(mod); mod = Dex.mod(mod).parentMod; }
    console.error(`${g} ${rule}: ${f.name}（${f.id}）`);
  }
}
// ---- 技の効果と発動確率（図鑑とチーム編成で表示する。対戦シミュレーターと同じ Showdown のデータから作る） ----
const ST_JA = { brn: 'やけど', par: 'まひ', psn: 'どく', tox: 'もうどく', slp: 'ねむり', frz: 'こおり' };
const STAT_JA = { atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ', accuracy: '命中率', evasion: '回避率' };
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const frac = ([n, d]) => (n === 33 && d === 100 ? '1/3' : `${n / gcd(n, d)}/${d / gcd(n, d)}`);
function boostText(boosts) {               // { def: -1, spd: -1 } → ぼうぎょ・とくぼうを1段階下げる
  const by = {};
  for (const [k, v] of Object.entries(boosts)) if (v) (by[v] = by[v] || []).push(STAT_JA[k] || k);
  const parts = Object.entries(by).sort((a, b) => b[0] - a[0]);
  // 2つ以上あるときは「〜を2段階上げ、〜を1段階下げる」のようにつなぐ
  return parts.map(([v, ks], i) => `${ks.join('・')}を${Math.abs(v)}段階${v > 0 ? '上げ' : '下げ'}${i === parts.length - 1 ? 'る' : ''}`).join('、');
}
function boostShort(boosts) {              // { spd: -1 } → とくぼう↓
  const ks = Object.keys(boosts).filter(k => boosts[k]);
  if (['atk', 'def', 'spa', 'spd', 'spe'].every(k => ks.includes(k)) && new Set(ks.map(k => boosts[k])).size === 1) return '全能力' + (boosts.atk > 0 ? '↑' : '↓');
  return Object.entries(boosts).filter(([, v]) => v).map(([k, v]) => (STAT_JA[k] || k) + (v > 0 ? '↑' : '↓').repeat(Math.min(Math.abs(v), 2))).join('・');
}
// 技ごとに決まった追加効果（データの形から文にできないもの）
const RANDOM_ST = { triattack: 'やけど・まひ・こおり', direclaw: 'どく・まひ・ねむり' };
const SPECIAL = {
  alluringvoice: 'このターンに能力が上がった相手をこんらんさせる', burningjealousy: 'このターンに能力が上がった相手をやけど状態にする',
  ceaselessedge: '相手の場に まきびし をまく', stoneaxe: '相手の場に ステルスロック をまく', eeriespell: '相手が最後に使った技のPPを3減らす',
  psychicnoise: '2ターンの間、相手はHPを回復できなくなる', saltcure: '相手を しおづけ にする（毎ターン最大HPの1/8のダメージ。みず・はがねタイプは1/4）',
  sparklingaria: '相手のやけどを治す', spiritshackle: '相手を逃げられなくする', syrupbomb: '3ターンの間、相手のすばやさを毎ターン1段階下げる',
  throatchop: '2ターンの間、相手は音の技を使えなくなる',
};
function moveEffects(m) {
  const lines = [], short = [];
  const secs = m.secondaries || (m.secondary ? [m.secondary] : []);
  for (const x of secs) {
    const c = x.chance || 100, pre = c < 100 ? `${c}%の確率で` : '';
    if (RANDOM_ST[m.id]) { lines.push(`${pre}相手を${RANDOM_ST[m.id]}のどれかの状態にする`); short.push(`${RANDOM_ST[m.id]}${c}%`); continue; }
    if (SPECIAL[m.id]) { lines.push(pre + SPECIAL[m.id]); if (c < 100) short.push(`追加効果${c}%`); continue; }
    if (!Object.keys(x).some(k => k !== 'chance')) continue;     // とくせい「ちからずく」のための目印だけのもの
    if (x.status) { lines.push(`${pre}相手を${ST_JA[x.status] || x.status}状態にする`); short.push(`${ST_JA[x.status] || x.status}${c}%`); }
    else if (x.volatileStatus === 'flinch') { lines.push(`${pre}相手をひるませる`); short.push(`ひるみ${c}%`); }
    else if (x.volatileStatus === 'confusion') { lines.push(`${pre}相手をこんらんさせる`); short.push(`こんらん${c}%`); }
    else if (x.boosts) { lines.push(`${pre}相手の${boostText(x.boosts)}`); short.push(`${boostShort(x.boosts)}${c}%`); }
    else if (x.self && x.self.boosts) { lines.push(`${pre}自分の${boostText(x.self.boosts)}`); short.push(`自分の${boostShort(x.self.boosts)}${c}%`); }
    else { lines.push(`${pre}追加効果がある`); short.push(`追加効果${c}%`); }
  }
  const self = ['self', 'allySide', 'allies', 'adjacentAllyOrSelf'].includes(m.target);
  if (m.status) lines.push(`${self ? '自分' : '相手'}を${ST_JA[m.status] || m.status}状態にする`);
  if (m.volatileStatus === 'confusion') lines.push('相手をこんらんさせる');
  if (m.boosts) lines.push(`${self ? '自分' : '相手'}の${boostText(m.boosts)}`);
  if (m.self && m.self.boosts) {
    lines.push(`${m.self.chance && m.self.chance < 100 ? `${m.self.chance}%の確率で` : ''}自分の${boostText(m.self.boosts)}`);
    if (m.self.chance && m.self.chance < 100) short.push(`自分の${boostShort(m.self.boosts)}${m.self.chance}%`);
  }
  if (m.selfBoost && m.selfBoost.boosts) lines.push(`自分の${boostText(m.selfBoost.boosts)}`);
  if (m.drain) lines.push(`与えたダメージの${frac(m.drain)}だけHPを回復する`);
  if (m.recoil) lines.push(`与えたダメージの${frac(m.recoil)}を反動で受ける`);
  if (m.heal) lines.push(`最大HPの${frac(m.heal)}を回復する`);
  if (m.willCrit) lines.push('必ず急所に当たる');
  else if (m.critRatio > 1) lines.push(`急所に当たりやすい（急所ランク+${m.critRatio - 1}）`);
  if (m.multihit) lines.push(Array.isArray(m.multihit) ? `${m.multihit[0]}〜${m.multihit[1]}回連続で攻撃する` : `${m.multihit}回連続で攻撃する`);
  if (m.selfSwitch) lines.push('使ったあと、控えのポケモンと交代する');
  if (m.forceSwitch) lines.push('相手を控えのポケモンと交代させる');
  if (m.flags && m.flags.charge) lines.push('1ターン目にためて、2ターン目に攻撃する');
  if (m.flags && m.flags.recharge) lines.push('使った次のターンは動けない');
  if (m.ohko) lines.push('当たれば相手は一撃でひんしになる');
  if (m.selfdestruct === 'always') lines.push('使うと自分はひんしになる');
  return { lines, short: short.join('・') };
}

// 技の性質のビット：1 ためる 2 反動で動けない 4 自分がひんし 8 自分の能力が下がる 16 反動ダメージ 32 交代する
// 64 威力が変わる 128 一撃必殺 256 固定ダメージ 512 ぼうぎょで攻撃 1024 相手のこうげきで攻撃 2048 HPを吸う
function moveTraits(m) {
  let t = 0;
  if (m.flags && m.flags.charge) t |= 1;
  if (m.flags && m.flags.recharge) t |= 2;
  if (m.selfdestruct) t |= 4;
  if (m.self && m.self.boosts && Object.values(m.self.boosts).some(v => v < 0)) t |= 8;
  if (m.recoil || m.mindBlownRecoil || m.hasCrashDamage) t |= 16;
  if (m.selfSwitch) t |= 32;
  if (m.basePowerCallback || (m.category !== 'Status' && !m.basePower && !m.damage)) t |= 64;
  if (m.ohko) t |= 128;
  if (m.damage) t |= 256;
  if (m.overrideOffensiveStat === 'def') t |= 512;
  if (m.overrideOffensivePokemon === 'target') t |= 1024;
  if (m.drain) t |= 2048;
  return t;
}
// 使ったあとに必ず下がる自分の能力（オーバーヒート：{ spa: -2 }、インファイト：{ def: -1, spd: -1 } など）
function selfDrops(m) {
  const b = (m.self && !m.self.chance && m.self.boosts) || (m.selfBoost && m.selfBoost.boosts) || null;
  const d = {};
  for (const [k, v] of Object.entries(b || {})) if (v < 0) d[k] = v;
  return Object.keys(d).length ? d : null;
}
// 連続技の平均の回数（2〜5回は 35/35/15/15% で平均 3.1 回）
function expectedHits(m) {
  if (!m.multihit) return 1;
  if (typeof m.multihit === 'number') return m.multihit;
  const [a, b] = m.multihit;
  return a === 2 && b === 5 ? 3.1 : (a + b) / 2;
}
const blankSet = (sp, ability) => ({
  name: sp.baseSpecies, species: sp.name, item: '', ability, moves: [], nature: 'Serious', gender: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
});

const out = { commit: process.argv[4] || '', mods: [...MODS], games: {}, moves: {}, abilities: {}, items: {}, natures: [] };
for (const n of Dex.natures.all()) out.natures.push([n.name, n.plus || '', n.minus || '']);

for (const [game, fmts] of Object.entries(GAMES)) {
  const v = TeamValidator.get(fmts.singles);
  const dex = v.dex, rt = v.ruleTable;
  const g = { restrictedLimit: rt.has('limittworestricted') ? 2 : rt.has('limitonerestricted') ? 1 : 6, formats: {}, species: [], items: [], tera: !dex.currentMod.startsWith('champions'), statPoints: dex.currentMod.startsWith('champions') };
  for (const [rule, fid] of Object.entries(fmts)) {
    const fv = TeamValidator.get(fid), frt = fv.ruleTable;
    g.formats[rule] = { id: fid, name: fv.format.name, gameType: fv.format.gameType, pick: frt.pickedTeamSize, level: frt.adjustLevel || frt.maxLevel, evLimit: frt.evLimit };
  }
  const allMoves = dex.moves.all().filter(m => !m.isZ && !m.isMax && m.id !== 'struggle');
  const t0 = Date.now();
  for (const sp of dex.species.all()) {
    // メガシンカなどバトル中だけの姿は、持ち物や条件で変わるので編成では選ばせない
    if (!sp.exists || sp.battleOnly || sp.isMega || sp.isPrimal) continue;
    const abilities = [];
    for (const a of Object.values(sp.abilities)) {
      const ab = dex.abilities.get(a);
      if (!ab.exists || abilities.includes(ab.id)) continue;
      if (!v.checkAbility(blankSet(sp, ab.name), ab, {})) abilities.push(ab.id);
    }
    if (!abilities.length) continue;
    const set = blankSet(sp, dex.abilities.get(abilities[0]).name);
    if (v.checkSpecies(set, sp, sp, {})) continue;         // ルールで使えない
    const moves = [];
    for (const m of allMoves) {
      if (!v.checkCanLearn(m, sp, v.allSources(sp), set)) moves.push(m.id);
    }
    if (!moves.length) continue;
    const req = sp.requiredItems || (sp.requiredItem ? [sp.requiredItem] : []);
    g.species.push({
      id: sp.id, name: sp.name, num: sp.num, base: sp.baseSpecies, forme: sp.forme || '', types: sp.types,
      stats: [sp.baseStats.hp, sp.baseStats.atk, sp.baseStats.def, sp.baseStats.spa, sp.baseStats.spd, sp.baseStats.spe],
      abilities, moves, requiredItems: req.map(i => dex.items.get(i).id).filter(Boolean), nfe: !!sp.nfe,
      // 禁止級（制限つきの伝説）か、配布でしか手に入らないか（配布は個体値などに決まりがあるので、おまかせでは使わない）
      restricted: !!(sp.tags && sp.tags.includes('Restricted Legendary')),
      eventOnly: !!((dex.species.getLearnsetData(sp.id) || {}).eventOnly || (dex.species.getLearnsetData(toID(sp.baseSpecies)) || {}).eventOnly),
    });
    for (const id of moves) {
      if (out.moves[id]) continue;
      const m = dex.moves.get(id);
      out.moves[id] = { name: m.name, type: m.type, category: m.category, basePower: m.basePower,
        accuracy: m.accuracy === true ? null : m.accuracy, pp: m.pp, priority: m.priority, target: m.target,
        traits: moveTraits(m), hits: expectedHits(m), drops: selfDrops(m) };
    }
    for (const id of abilities) out.abilities[id] = out.abilities[id] || { name: dex.abilities.get(id).name, rating: dex.abilities.get(id).rating || 0 };
  }
  for (const it of dex.items.all()) {
    if (!it.exists || v.checkItem(blankSet(dex.species.get('Garchomp'), 'Sand Veil'), it, {})) continue;
    g.items.push(it.id);
    // megaStone は { 元の姿: メガシンカ後の姿 }
    out.items[it.id] = out.items[it.id] || { name: it.name, megaStone: it.megaStone || null };
  }
  // メガシンカ：持ち物（メガストーン）ごとに、メガシンカ後の姿の性能を書き出す
  g.megas = [];
  const legalSp = new Set(g.species.map(x => x.name));
  for (const iid of g.items) {
    const it = dex.items.get(iid);
    if (!it.megaStone) continue;
    for (const [base, forme] of Object.entries(it.megaStone)) {
      if (!legalSp.has(base)) continue;
      const f = dex.species.get(forme);
      if (!f.exists) continue;
      const ab = dex.abilities.get(Object.values(f.abilities)[0]);
      out.abilities[ab.id] = out.abilities[ab.id] || { name: ab.name, rating: ab.rating || 0 };
      g.megas.push({ item: iid, base, forme: f.name, types: f.types,
        stats: [f.baseStats.hp, f.baseStats.atk, f.baseStats.def, f.baseStats.spa, f.baseStats.spd, f.baseStats.spe], ability: ab.id });
    }
  }
  out.games[game] = g;
  console.error(`${game}: species ${g.species.length}, items ${g.items.length}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
// 技の効果：SV は第9世代の本体、チャンピオンズはチャンピオンズの mod のデータ（違うときだけ両方を持つ）
const chDex = Dex.forFormat(Dex.formats.get(GAMES.ch.singles));
out.effects = {};
let effDiff = 0;
for (const m of Dex.moves.all()) {
  if (!m.exists || m.num <= 0 || ['CAP', 'LGPE', 'Custom'].includes(m.isNonstandard)) continue;
  const sv = moveEffects(m), ch = moveEffects(chDex.moves.get(m.id));
  const same = JSON.stringify(sv) === JSON.stringify(ch);
  if (!same) effDiff++;
  out.effects[m.id] = same ? { sv } : { sv, ch };
}
console.error(`技の効果: ${Object.keys(out.effects).length}件（チャンピオンズで違うもの ${effDiff}件）`);
fs.writeFileSync(process.argv[3], JSON.stringify(out));
