(() => {
  'use strict';

  // ---- データの配列レイアウト（build_battle_data.py の docstring と必ず一致させる） ----
  const SP_ID = 0, SP_PS = 1, SP_NUM = 2, SP_DISP = 3, SP_BASE = 4, SP_T1 = 5, SP_T2 = 6, SP_ST = 7, SP_AB = 8, SP_MV = 9, SP_REQ = 10, SP_NFE = 11,
    SP_RESTR = 12, SP_EVENT = 13, SP_PID = 14;
  const MV_ID = 0, MV_JA = 1, MV_TYPE = 2, MV_CAT = 3, MV_BP = 4, MV_ACC = 5, MV_PP = 6, MV_PRIO = 7, MV_TGT = 8, MV_TRAIT = 9, MV_HITS = 10;
  const MG_ITEM = 0, MG_BASE = 1, MG_DISP = 3, MG_T1 = 4, MG_T2 = 5, MG_ST = 6, MG_AB = 7, MG_PID = 8;
  const IT_ID = 0, IT_JA = 1, IT_MEGA = 2;

  const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const STAT_JA = ['HP', 'こうげき', 'ぼうぎょ', 'とくこう', 'とくぼう', 'すばやさ'];
  const STAT_KEYS = ['H', 'A', 'B', 'C', 'D', 'S'];
  const BOOST_JA = { atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ', accuracy: '命中率', evasion: '回避率' };
  const BOOST_SHORT = { atk: 'A', def: 'B', spa: 'C', spd: 'D', spe: 'S', accuracy: '命中', evasion: '回避' };
  const STATUS_JA = { brn: 'やけど', par: 'まひ', slp: 'ねむり', psn: 'どく', tox: 'もうどく', frz: 'こおり' };
  const TYPE_ORDER = [0, 9, 10, 12, 11, 14, 1, 3, 4, 2, 13, 6, 5, 7, 15, 16, 8, 17];
  const CAT_JA = ['変化', '物理', '特殊'];
  const WEATHER = {
    sunnyday: ['はれ', '日差しが 強くなった！', '日差しが 元に 戻った！'],
    raindance: ['あめ', '雨が 降り始めた！', '雨が やんだ！'],
    sandstorm: ['すなあらし', '砂あらしが 吹き始めた！', '砂あらしが おさまった！'],
    snowscape: ['ゆき', '雪が 降り始めた！', '雪が やんだ！'],
    snow: ['ゆき', '雪が 降り始めた！', '雪が やんだ！'],
    hail: ['あられ', 'あられが 降り始めた！', 'あられが やんだ！'],
    desolateland: ['おおひでり', '日差しが とても 強くなった！', '日差しが 元に 戻った！'],
    primordialsea: ['おおあめ', '強い 雨が 降り始めた！', '強い 雨が やんだ！'],
    deltastream: ['らんきりゅう', '謎の 乱気流が 吹き始めた！', '謎の 乱気流が おさまった！'],
  };
  const PROTECTS = new Set(['protect', 'detect', 'kingsshield', 'spikyshield', 'banefulbunker', 'obstruct', 'silktrap', 'burningbulwark', 'maxguard']);
  const AUTOTEST = /[?&]autotest=1/.test(location.search);   // 検証用：両方を CPU にして自動で対戦させる

  const $ = id => document.getElementById(id);
  const ROOT = document.getElementById('bt') || document.body;   // 図鑑と1つのページにしたときの、バトル側の要素
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const toID = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const collator = new Intl.Collator('ja');
  const PUNCT = /[\s・･\-‐‑–—―－_.,，、。'’"“”()（）「」『』［］\[\]!！?？:：]/g;
  function norm(s) {
    if (!s) return '';
    return String(s).normalize('NFKC').toLowerCase()
      .replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60)).replace(PUNCT, '');
  }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても動作は続ける */ } },
  };
  const HAS_KEYBOARD = !window.matchMedia || window.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches;
  function cameFromTouch(e) {
    if (!HAS_KEYBOARD) return true;
    if (e && typeof e.pointerType === 'string' && e.pointerType !== '') return e.pointerType === 'touch';
    return false;
  }
  const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const bar = (title, href, label) => `<div class="bar"><a class="back" href="${href}">${BACK_SVG}${label || '戻る'}</a><span class="ttl">${esc(title)}</span></div>`;

  // ---- データ ------------------------------------------------------------
  let D, TYPES, NATS, MOVES, ABIL, ITEMS;
  const mById = new Map(), aById = new Map(), iById = new Map(), tByEn = new Map(), natByEn = new Map();
  const GD = {};
  async function loadData() {
    const b64 = $('bt-data').textContent.trim();
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  function buildIndex(d) {
    D = d; TYPES = d.types; NATS = d.natures; MOVES = d.moves; ABIL = d.abilities; ITEMS = d.items;
    MOVES.forEach(m => mById.set(m[MV_ID], m));
    ABIL.forEach(a => aById.set(a[0], a));
    ITEMS.forEach(i => iById.set(i[IT_ID], i));
    TYPES.forEach((t, i) => tByEn.set(t[0], i));
    NATS.forEach(n => natByEn.set(n[0], n));
    for (const g in d.games) {
      const G = d.games[g];
      GD[g] = Object.assign({}, G, {
        byPs: new Map(G.species.map(s => [s[SP_PS], s])), byId: new Map(G.species.map(s => [s[SP_ID], s])),
        itemIds: G.items.map(i => ITEMS[i][IT_ID]), itemSet: new Set(G.items.map(i => ITEMS[i][IT_ID])), mvCache: new Map(),
      });
    }
  }
  function moveSet(g, sp) {
    const G = GD[g];
    if (!G.mvCache.has(sp[SP_ID])) G.mvCache.set(sp[SP_ID], new Set(sp[SP_MV].map(i => MOVES[i][MV_ID])));
    return G.mvCache.get(sp[SP_ID]);
  }
  const abilIds = sp => sp[SP_AB].map(i => ABIL[i][0]);
  const jaMove = n => { const m = mById.get(toID(n)); return m ? m[MV_JA] : String(n || ''); };
  const jaAbil = n => { const a = aById.get(toID(n)); return a ? a[1] : String(n || ''); };
  const jaItem = n => { const i = iById.get(toID(n)); return i ? i[IT_JA] : String(n || ''); };
  const typeIdx = en => { const i = tByEn.get(en); return i == null ? 0 : i; };
  const jaType = en => { const i = tByEn.get(en); return i == null ? String(en || '') : TYPES[i][1]; };
  function jaAny(n) {
    const id = toID(n);
    return (mById.get(id) || [])[MV_JA] || (aById.get(id) || [])[1] || (iById.get(id) || [])[IT_JA] || String(n || '');
  }
  function effectJa(s) {
    if (!s) return '';
    const m = /^(move|ability|item):\s?(.*)$/.exec(s);
    if (m) return m[1] === 'move' ? jaMove(m[2]) : m[1] === 'ability' ? jaAbil(m[2]) : jaItem(m[2]);
    const id = toID(s);
    if (STATUS_JA[id]) return STATUS_JA[id];
    if (id === 'confusion') return 'こんらん';
    return jaAny(s);
  }
  const tt = i => `<span class="tt t${i}" aria-hidden="true">${TYPES[i][2]}</span>`;
  const tts = sp => `<span class="tts2" role="img" aria-label="${esc(TYPES[sp[SP_T1]][1] + (sp[SP_T2] >= 0 ? '・' + TYPES[sp[SP_T2]][1] : ''))}タイプ">` +
    tt(sp[SP_T1]) + (sp[SP_T2] >= 0 ? tt(sp[SP_T2]) : '') + '</span>';

  // ---- 実数値（図鑑と同じ式。SV は通常の式、チャンピオンズは能力ポイント） ----
  function calcStat(mode, i, base, level, iv, inv, up, down) {
    let s;
    if (mode === 'ch') {
      if (i === 0) return base === 1 ? 1 : base + inv + 75;
      s = base + inv + 20;
    } else {
      const core = Math.floor(((2 * base + iv + Math.floor(inv / 4)) * level) / 100);
      if (i === 0) return base === 1 ? 1 : core + level + 10;
      s = core + 5;
    }
    if (up !== down) {
      if (up === i) return Math.floor((s * 110) / 100);
      if (down === i) return Math.floor((s * 90) / 100);
    }
    return s;
  }
  const natUD = en => { const n = natByEn.get(en); return n ? [n[2], n[3]] : [0, 0]; };

  // ---- 状態（ルール・チーム） -------------------------------------------
  // チームは何個でも持てる：teams = [{ id, name, game, rule, sets }]。
  // 対戦ではルールごとに sel[ゲーム_形式] = { you: チームID, opp: チームID か 'auto'（おまかせ）} を使う
  const S = { game: 'ch', rule: 'singles', cpu: true, teams: [], sel: {}, autoPrev: {}, autoUsed: {}, simTeam: '', simN: 30 };
  const key = () => S.game + '_' + S.rule;
  const fmtInfo = () => D.games[S.game].formats[S.rule];
  const gd = () => GD[S.game];
  const LIMIT = g => (GD[g].statPoints ? { max: 32, total: 66 } : { max: 252, total: 510 });
  const sideJa = side => (side === 'you' ? 'あなた' : '相手');

  function fromPS(ps, g, notes) {
    const G = GD[g];
    const sp = G.byId.get(toID(ps.species));
    if (!sp) { notes.push(`${ps.species || '（名前なし）'}：このルールでは使えないため外しました`); return null; }
    const legal = moveSet(g, sp), abil = abilIds(sp);
    let ability = toID(ps.ability);
    if (!abil.includes(ability)) {
      if (ps.ability) notes.push(`${sp[SP_DISP]}：特性「${ps.ability}」は使えないため${jaAbil(abil[0])}にしました`);
      ability = abil[0];
    }
    let item = toID(ps.item);
    if (item && !G.itemSet.has(item)) { notes.push(`${sp[SP_DISP]}：持ち物「${ps.item}」は使えないため外しました`); item = ''; }
    const moves = [];
    for (const m of ps.moves || []) {
      const id = toID(m);
      if (!id) continue;
      if (legal.has(id)) { if (!moves.includes(id)) moves.push(id); }
      else notes.push(`${sp[SP_DISP]}：技「${m}」は覚えられないため外しました`);
    }
    const lim = LIMIT(g).max;
    const evs = STAT_IDS.map(s => Math.max(0, Math.min(lim, (ps.evs && ps.evs[s]) || 0)));
    const ivs = STAT_IDS.map(s => (ps.ivs && Number.isInteger(ps.ivs[s]) ? Math.max(0, Math.min(31, ps.ivs[s])) : 31));
    const nature = natByEn.has(ps.nature) ? ps.nature : 'Serious';
    const tera = G.tera ? (tByEn.has(ps.teraType) ? ps.teraType : TYPES[sp[SP_T1]][0]) : '';
    return { sp: sp[SP_PS], item, ability, moves: moves.slice(0, 4), nature, evs, ivs, tera };
  }
  function toPS(set, g) {
    const G = GD[g], sp = G.byPs.get(set.sp);
    const evs = {}, ivs = {};
    STAT_IDS.forEach((s, i) => { evs[s] = set.evs[i]; ivs[s] = G.statPoints ? 31 : set.ivs[i]; });
    // ニックネームを日本語の種族名にすると、対戦ログにそのまま日本語名が出る
    return { name: sp[SP_BASE], species: set.sp, item: set.item, ability: set.ability, moves: set.moves.slice(), nature: set.nature,
      evs, ivs, level: 50, gender: '', teraType: G.tera ? set.tera || undefined : undefined };
  }
  function toPSEnglish(set, g) {
    const s = toPS(set, g), dex = PSEngine.Dex;
    s.name = '';
    s.item = s.item ? dex.items.get(s.item).name : '';
    s.ability = dex.abilities.get(s.ability).name;
    s.moves = s.moves.map(m => dex.moves.get(m).name);
    return s;
  }
  function sampleTeam(k) {
    const notes = [], [g, rule] = k.split('_');
    if (!D.samples[k]) return autoTeam(g, rule);     // ルールが変わってサンプルが使えなくなったとき
    return PSEngine.Teams.unpack(D.samples[k]).map(p => fromPS(p, g, notes)).filter(Boolean);
  }
  const RULE_JA = { singles: 'シングル', doubles: 'ダブル' }, GAME_JA = { ch: 'チャンピオンズ', sv: 'SV' };
  const ruleLabel = (g, r) => `${GAME_JA[g]}・${RULE_JA[r]}`;
  const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const teamById = id => S.teams.find(t => t.id === id) || null;
  const teamsFor = (g, r) => S.teams.filter(t => t.game === g && t.rule === r);
  function addTeam(g, r, name, sets) {
    const t = { id: newId(), name, game: g, rule: r, sets };
    S.teams.push(t);
    return t;
  }
  function uniqueName(base) {
    let n = base, i = 2;
    while (S.teams.some(t => t.name === n)) n = `${base} ${i++}`;
    return n;
  }
  function selOf(g, r) {                    // そのルールで選んでいるチーム（なければサンプルから作る）
    const k = g + '_' + r, s = S.sel[k] || (S.sel[k] = {});
    const ok = id => { const t = teamById(id); return !!t && t.game === g && t.rule === r; };
    if (!ok(s.you)) s.you = (teamsFor(g, r)[0] || addTeam(g, r, uniqueName(`サンプル（${ruleLabel(g, r)}）`), sampleTeam(k))).id;
    if (s.opp !== 'auto' && !ok(s.opp)) s.opp = 'auto';
    return s;
  }
  function autoPreview(g, r) {              // 相手が おまかせ のときに、次の対戦で使うチーム
    const k = g + '_' + r;
    if (!S.autoPrev[k] || S.autoUsed[k]) { S.autoPrev[k] = autoTeam(g, r); S.autoUsed[k] = false; }
    return S.autoPrev[k];
  }
  function team(side) {                     // 対戦で使う6匹
    const s = selOf(S.game, S.rule);
    if (side === 'you') return teamById(s.you).sets;
    return s.opp === 'auto' ? autoPreview(S.game, S.rule) : teamById(s.opp).sets;
  }
  const bookmarks = () => { try { const a = JSON.parse(store.get('pd.bookmarks') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  function findByPid(g, pid) {              // 図鑑のポケモン（pokemon_id）→ このゲームで使える姿（メガシンカは元の姿＋メガストーン）
    const G = GD[g], sp = G.species.find(x => x[SP_PID] === pid);
    if (sp) return { sp, mega: null };
    const mg = (G.megas || []).find(m => m[MG_PID] === pid), base = mg && G.byPs.get(mg[MG_BASE]);
    return base ? { sp: base, mega: mg } : null;
  }

  const save = () => store.set('pd.bt.v2', JSON.stringify({ game: S.game, rule: S.rule, cpu: S.cpu, teams: S.teams, sel: S.sel,
    autoPrev: S.autoPrev, simN: S.simN, simTeam: S.simTeam }));
  function cleanSets(arr, g) {             // 保存されていた6匹を、今のデータで使えるか確かめ直す
    return arr.filter(x => x && GD[g].byPs.has(x.sp)).map(x => {
      const y = fromPS({ species: GD[g].byPs.get(x.sp)[SP_ID], ability: x.ability, item: x.item, moves: x.moves, nature: x.nature, teraType: x.tera,
        evs: Object.fromEntries(STAT_IDS.map((k, i) => [k, (x.evs || [])[i] || 0])),
        ivs: Object.fromEntries(STAT_IDS.map((k, i) => [k, Number.isInteger((x.ivs || [])[i]) ? x.ivs[i] : 31])) }, g, []);
      if (y && x.note) y.note = String(x.note);
      return y;
    }).filter(Boolean).slice(0, 6);
  }
  function load() {
    let o = null;
    try { o = JSON.parse(store.get('pd.bt.v2') || 'null'); } catch (e) { o = null; }
    if (!o) {                                // 以前の保存形式（ルールごとに あなた・相手 の2チーム）から移す
      let v1 = null;
      try { v1 = JSON.parse(store.get('pd.bt.v1') || 'null'); } catch (e) { v1 = null; }
      if (v1 && typeof v1 === 'object') {
        o = { game: v1.game, rule: v1.rule, cpu: v1.cpu, teams: [], sel: {} };
        for (const k in v1.teams || {}) {
          const [g, r] = k.split('_');
          if (!GD[g] || !RULE_JA[r]) continue;
          for (const side of ['you', 'opp']) {
            if (!Array.isArray((v1.teams[k] || {})[side])) continue;
            const id = newId() + side;
            o.teams.push({ id, name: `${side === 'you' ? 'あなた' : '相手'}のチーム（${ruleLabel(g, r)}）`, game: g, rule: r, sets: v1.teams[k][side] });
            (o.sel[k] = o.sel[k] || {})[side] = id;
          }
          if (v1.autoOpp) (o.sel[k] = o.sel[k] || {}).opp = 'auto';
        }
      }
    }
    if (!o || typeof o !== 'object') return;
    if (o.game === 'ch' || o.game === 'sv') S.game = o.game;
    if (o.rule === 'singles' || o.rule === 'doubles') S.rule = o.rule;
    S.cpu = o.cpu !== false;
    if (Array.isArray(o.teams)) {
      S.teams = o.teams.filter(t => t && GD[t.game] && RULE_JA[t.rule] && Array.isArray(t.sets))
        .map(t => ({ id: String(t.id), name: String(t.name || 'チーム').slice(0, 40), game: t.game, rule: t.rule, sets: cleanSets(t.sets, t.game) }));
    }
    if (o.sel && typeof o.sel === 'object') S.sel = o.sel;
    for (const k in o.autoPrev || {}) { const g = k.split('_')[0]; if (GD[g] && Array.isArray(o.autoPrev[k])) S.autoPrev[k] = cleanSets(o.autoPrev[k], g); }
    if ([10, 30, 100].includes(o.simN)) S.simN = o.simN;
    if (typeof o.simTeam === 'string') S.simTeam = o.simTeam;
  }

  function problems() {
    const out = [], f = fmtInfo(), G = gd(), lim = LIMIT(S.game);
    for (const side of ['you', 'opp']) {
      const t = team(side), who = sideJa(side);
      if (t.length < f.pick) out.push(`${who}のチームは${f.pick}匹以上必要です（いま${t.length}匹）`);
      const nr = t.filter(s => (G.byPs.get(s.sp) || [])[SP_RESTR]).length;
      if (nr > G.restrictedLimit) out.push(`${who}のチームに禁止級の伝説のポケモンが${nr}匹います（${G.restrictedLimit}匹まで）`);
      const nums = new Set(), items = new Set();
      for (const s of t) {
        const sp = G.byPs.get(s.sp);
        if (nums.has(sp[SP_NUM])) out.push(`${who}のチームに同じポケモンがいます（1匹まで）`);
        nums.add(sp[SP_NUM]);
        if (s.item) { if (items.has(s.item)) out.push(`${who}のチームで${jaItem(s.item)}が重なっています（同じ持ち物は1つまで）`); items.add(s.item); }
        if (!s.moves.length) out.push(`${who}の${sp[SP_DISP]}に技がありません`);
        const tot = s.evs.reduce((a, b) => a + b, 0);
        if (tot > lim.total) out.push(`${who}の${sp[SP_DISP]}：${G.statPoints ? '能力ポイント' : '努力値'}の合計が${lim.total}を超えています`);
      }
    }
    return [...new Set(out)];
  }

  // ---- 画面の切り替え（ハッシュ） ------------------------------------------
  const V = {};
  function showView(name) {
    for (const k in V) V[k].hidden = k !== name;
    document.body.classList.toggle('in-battle', name === 'battle');
    window.scrollTo(0, 0);
  }
  const BT_ROUTE = /^#\/(b|teams|team|set|battle|sim)(\/|$)/;
  const MERGED = !!document.getElementById('pd');   // 図鑑と1つのページにまとめた版
  function route() {
    const h = location.hash;
    if (MERGED && !BT_ROUTE.test(h)) return;           // 図鑑の画面
    let m;
    // チームを編集するときは、そのチームのルールに合わせる（使える技や能力ポイントの上限が変わるため）
    const useTeam = id => { const t = teamById(id); if (t) { S.game = t.game; S.rule = t.rule; } return t; };
    if (h === '#/teams') { renderTeams(); showView('teams'); }
    else if (h === '#/sim') { renderSim(); showView('sim'); }
    else if ((m = /^#\/team\/([\w-]+)$/.exec(h))) {
      if (!useTeam(m[1])) { location.replace('#/teams'); return; }
      renderTeam(m[1]); showView('team');
    } else if ((m = /^#\/set\/([\w-]+)\/([0-5])\/pick\/(sp|item|move)([0-3]?)$/.exec(h))) {
      const t = useTeam(m[1]);
      if (!t || (m[3] !== 'sp' && !t.sets[+m[2]])) { location.replace(t ? `#/team/${m[1]}` : '#/teams'); return; }
      renderPick(m[1], +m[2], m[3], +(m[4] || 0)); showView('pick');
    } else if ((m = /^#\/set\/([\w-]+)\/([0-5])$/.exec(h))) {
      const t = useTeam(m[1]);
      if (!t) { location.replace('#/teams'); return; }
      if (!t.sets[+m[2]]) { location.replace(`#/set/${m[1]}/${Math.min(+m[2], t.sets.length)}/pick/sp`); return; }
      renderSet(m[1], +m[2]); showView('set');
    } else if (h === '#/battle' && B && !B.headless) { showView('battle'); renderField(); renderCmd(); }
    else { renderSetup(); showView('setup'); }
  }


  // ---- ルールとチームの画面 ------------------------------------------------
  function ruleNote() {
    const f = fmtInfo(), G = gd();
    const parts = [`6匹から${f.pick}匹を選んで戦う`, `Lv.${f.level}`, '同じポケモンと同じ持ち物は1つまで'];
    if (G.megas.length) parts.push('メガシンカあり');
    if (G.tera) parts.push('テラスタルあり');
    if (G.statPoints) parts.push('能力ポイント制');
    if (G.restrictedLimit < 6) parts.push(`禁止級の伝説のポケモンは${G.restrictedLimit}匹まで`);
    return `${S.game === 'ch' ? 'Pokémon Champions' : 'SV'} のランクバトルと同じルール（${esc(f.name)}）：${parts.join('・')}`;
  }
  function monChip(s, g) {
    const sp = GD[g || S.game].byPs.get(s.sp);
    return `<li class="mon">${tts(sp)}<span style="min-width:0"><span class="nm">${esc(sp[SP_DISP])}</span>` +
      `<span class="it">${s.item ? esc(jaItem(s.item)) : '持ち物なし'}</span></span></li>`;
  }

  function teamInfo(sets, g) {             // 弱点の補完・メガシンカの数・天候やフィールドの役
    if (!sets.length) return '';
    const fs = teamForms(sets, g), c = coverOf(fs), megas = fs.filter(f => f.mega).length, th = themeOf(sets, g);
    return `<p class="fine">弱点を受けられる仲間がいる割合：<b>${Math.round(c.ratio * 100)}%</b>${GD[g].megas.length ? `・メガシンカ ${megas}匹` : ''}` +
      `${th ? `・${MODES[th.mode].kind === 'w' ? '天候' : 'フィールド'}：${MODES[th.mode].ja}（${esc(th.name)}）` : ''}</p>`;
  }
  function chips(sets, g) {
    const items = [];
    for (let i = 0; i < 6; i++) items.push(sets[i] ? monChip(sets[i], g) : '<li class="mon empty">空き</li>');
    return `<ul class="mons">${items.join('')}</ul>`;
  }
  function renderSetup() {
    for (const b of $('seg-game').children) b.setAttribute('aria-pressed', String(b.dataset.game === S.game));
    for (const b of $('seg-rule').children) b.setAttribute('aria-pressed', String(b.dataset.rule === S.rule));
    for (const b of $('seg-cpu').children) b.setAttribute('aria-pressed', String((b.dataset.cpu === '1') === S.cpu));
    $('rule-note').innerHTML = ruleNote();
    const sel = selOf(S.game, S.rule), list = teamsFor(S.game, S.rule);
    $('teams').innerHTML = ['you', 'opp'].map(side => {
      const t = team(side), auto = side === 'opp' && sel.opp === 'auto', tid = side === 'you' ? sel.you : sel.opp;
      const opts = (side === 'opp' ? `<option value="auto"${auto ? ' selected' : ''}>おまかせ（対戦のたびに新しく作る）</option>` : '') +
        list.map(x => `<option value="${x.id}"${x.id === tid ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
      return `<div class="card team"><h3>${sideJa(side)}のチーム<span class="n">${t.length}/6</span></h3>` +
        `<span class="sel"><select data-pickteam="${side}" aria-label="${sideJa(side)}のチーム">${opts}</select></span>${chips(t, S.game)}${teamInfo(t, S.game)}` +
        '<div class="acts">' + (auto
          ? '<button type="button" class="btn ink" data-reroll="1">別のおまかせにする</button><button type="button" class="btn" data-saveauto="1">このチームを保存</button>'
          : `<a class="btn" href="#/team/${tid}">編集する</a>`) + '<a class="btn" href="#/teams">チーム一覧</a></div></div>';
    }).join('');
    const probs = problems();
    $('problems').hidden = !probs.length;
    $('problems').innerHTML = probs.map(esc).join('<br>');
    $('start').disabled = probs.length > 0;
    save();
  }

  function renderTeam(tid) {
    const tm = teamById(tid), t = tm.sets, G = GD[tm.game];
    let h = bar(tm.name, '#/teams', 'チーム一覧') +
      `<div class="field"><span class="flab">チームの名前（${ruleLabel(tm.game, tm.rule)}）</span>` +
      `<input class="tname" id="t-name" value="${esc(tm.name)}" maxlength="40" autocomplete="off" aria-label="チームの名前"></div><ul class="slots">`;
    t.forEach((s, i) => {
      const sp = G.byPs.get(s.sp);
      h += `<li><a class="slot" href="#/set/${tid}/${i}"><span class="top">${esc(sp[SP_DISP])}<span class="types">${tt(sp[SP_T1])}${sp[SP_T2] >= 0 ? tt(sp[SP_T2]) : ''}</span></span>` +
        `<span class="meta">${s.note ? `<b>${esc(s.note)}</b>・` : ''}${esc(jaAbil(s.ability))}・${s.item ? esc(jaItem(s.item)) : '持ち物なし'}${G.tera && s.tera ? `・テラス ${esc(jaType(s.tera))}` : ''}</span>` +
        `<span class="mv">${[0, 1, 2, 3].map(k => `<span>${s.moves[k] ? esc(jaMove(s.moves[k])) : '—'}</span>`).join('')}</span></a></li>`;
    });
    if (t.length < 6) h += `<li><a class="slot empty" href="#/set/${tid}/${t.length}/pick/sp">＋ ポケモンを追加</a></li>`;
    h += `</ul>${teamInfo(t, tm.game)}<div class="opts">` +
      `<button type="button" class="btn ink" data-useteam="${tid}">このチームで対戦</button><button type="button" class="btn" data-simteam="${tid}">連戦する</button>` +
      `<button type="button" class="btn" data-dupteam="${tid}">複製</button><button type="button" class="btn" data-autoteam="${tid}">おまかせで作り直す</button>` +
      `<button type="button" class="btn warn" data-delteam="${tid}">このチームを削除</button></div>`;
    h += '<h2 class="sec">テキストで読み込み・書き出し</h2><p class="fine">Pokémon Showdown と同じ形式（英語）です。対戦サイトなどで公開されているチームを貼り付けて読み込めます。</p>' +
      `<textarea class="paste" id="paste" spellcheck="false" autocapitalize="off" aria-label="チームのテキスト">${esc(PSEngine.Teams.export(t.map(s => toPSEnglish(s, S.game))))}</textarea>` +
      `<div class="opts"><button type="button" class="btn ink" data-paste="${tid}">貼り付けて読み込む</button>` +
      `<button type="button" class="btn" data-copyteam="${tid}">今の編成をコピー</button>` +
      `<button type="button" class="btn" data-import="${tid}">この欄の内容で読み込む</button></div><p class="fine" id="import-notes"></p>`;
    V.team.innerHTML = h;
  }

  // クリップボード：使えない環境（埋め込み表示など）では、選択してコピーする方法に切り替える
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 次の方法を試す */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  async function pasteImport(tid) {
    let text = '';
    try { text = navigator.clipboard && navigator.clipboard.readText ? await navigator.clipboard.readText() : ''; } catch (e) { text = ''; }
    if (!text.trim()) {
      $('import-notes').textContent = 'クリップボードを読み取れませんでした。下の欄を長押しして貼り付け、「この欄の内容で読み込む」を押してください。';
      $('paste').focus();
      return;
    }
    $('paste').value = text;
    importText(tid);
  }

  async function copyTeam(tid) {
    const tm = teamById(tid), text = PSEngine.Teams.export(tm.sets.map(x => toPSEnglish(x, tm.game)));
    const ok = await copyText(text);
    $('import-notes').textContent = ok ? `「${tm.name}」をコピーしました（Pokémon Showdown の形式）。` : 'コピーできませんでした。下の欄を長押しして選択してください。';
  }

  function importText(tid) {
    const text = $('paste').value, notes = [];
    let sets = [];
    try { sets = PSEngine.Teams.import(text) || []; } catch (e) { sets = []; }
    if (!sets.length) { $('import-notes').textContent = '読み込めるポケモンが見つかりませんでした。Pokémon Showdown の形式か確かめてください。'; return; }
    const t = sets.map(p => fromPS(p, S.game, notes)).filter(Boolean).slice(0, 6);
    teamById(tid).sets = t;
    save();
    renderTeam(tid);
    $('import-notes').innerHTML = `${t.length}匹を読み込みました。` + (notes.length ? '<br>' + notes.map(esc).join('<br>') : '');
  }


  // ---- 1体の編集 ----------------------------------------------------------
  function natureOptions(cur) {
    const [cu, cd] = natUD(cur);
    let h = `<option value="Serious"${cu === cd ? ' selected' : ''}>補正なし</option>`;
    for (let up = 1; up <= 5; up++) {
      for (let down = 1; down <= 5; down++) {
        if (up === down) continue;
        const n = NATS.find(x => x[2] === up && x[3] === down);
        h += `<option value="${n[0]}"${cu === up && cd === down ? ' selected' : ''}>${STAT_JA[up]}↑ ${STAT_JA[down]}↓（${esc(n[1])}）</option>`;
      }
    }
    return h;
  }
  function statsHTML(set, sp) {
    const g = S.game, ch = GD[g].statPoints, lim = LIMIT(g), [up, down] = natUD(set.nature), word = ch ? '能力P' : '努力値';
    let h = `<div class="scroll-x"><table class="ctab"><thead><tr><th class="l">能力</th>${ch ? '' : '<th>個体値</th>'}<th colspan="3">${word}</th><th class="r">実数値</th></tr></thead><tbody>`;
    for (let i = 0; i < 6; i++) {
      const v = calcStat(g, i, sp[SP_ST][i], 50, ch ? 31 : set.ivs[i], set.evs[i], up, down);
      const mark = i && up !== down ? (up === i ? 'up' : down === i ? 'down' : '') : '';
      h += `<tr><td class="lab2">${STAT_KEYS[i]} ${STAT_JA[i]}<span class="${mark}">${mark === 'up' ? '↑' : mark === 'down' ? '↓' : ''}</span></td>` +
        (ch ? '' : `<td><input class="nin" type="text" inputmode="numeric" maxlength="2" data-iv="${i}" value="${set.ivs[i]}" aria-label="${STAT_JA[i]}の個体値"></td>`) +
        `<td><button type="button" class="stp" data-step="-1" data-i="${i}" aria-label="${STAT_JA[i]}の実数値を下げる">−</button></td>` +
        `<td><input class="nin" type="text" inputmode="numeric" maxlength="3" data-ev="${i}" value="${set.evs[i]}" aria-label="${STAT_JA[i]}の${word}"></td>` +
        `<td><button type="button" class="stp" data-step="1" data-i="${i}" aria-label="${STAT_JA[i]}の実数値を上げる">＋</button></td>` +
        `<td class="out ${mark}">${v}</td></tr>`;
    }
    const tot = set.evs.reduce((a, b) => a + b, 0);
    return h + `</tbody></table></div><p class="total${tot > lim.total ? ' over' : ''}">${ch ? '能力ポイント' : '努力値'}の合計 ${tot} / ${lim.total}` +
      (tot > lim.total ? '（上限を超えています）' : `（残り ${lim.total - tot}）`) + '</p>';
  }
  function renderSet(tid, i) {
    const tm = teamById(tid), set = tm.sets[i], G = gd(), sp = G.byPs.get(set.sp);
    const base = `#/set/${tid}/${i}/pick/`;
    let h = bar(`${tm.name} ${i + 1}匹目`, `#/team/${tid}`);
    h += `<div class="field"><span class="flab">ポケモン</span><a class="pickbtn" href="${base}sp">${tt(sp[SP_T1])}${sp[SP_T2] >= 0 ? tt(sp[SP_T2]) : ''}<span class="pnm">${esc(sp[SP_DISP])}</span>` +
      `<span class="sub">${STAT_KEYS.map((k, j) => k + sp[SP_ST][j]).join(' ')}</span></a></div>`;
    h += `<div class="field"><span class="flab">特性</span><span class="sel"><select id="s-ab" aria-label="特性">${abilIds(sp).map(a =>
      `<option value="${a}"${a === set.ability ? ' selected' : ''}>${esc(jaAbil(a))}</option>`).join('')}</select></span></div>`;
    h += `<div class="field"><span class="flab">持ち物</span><a class="pickbtn${set.item ? '' : ' none'}" href="${base}item">${set.item ? esc(jaItem(set.item)) : '持ち物なし'}</a></div>`;
    h += '<div class="field"><span class="flab">技</span><div class="mvgrid">' + [0, 1, 2, 3].map(k => {
      const m = mById.get(set.moves[k]);
      return m ? `<a class="pickbtn" href="${base}move${k}">${tt(m[MV_TYPE])}${esc(m[MV_JA])}</a>` : `<a class="pickbtn none" href="${base}move${k}">技を選ぶ</a>`;
    }).join('') + '</div></div>';
    h += `<div class="field"><span class="flab">${G.statPoints ? '能力補正' : '性格'}</span><span class="sel"><select id="s-nat" aria-label="性格">${natureOptions(set.nature)}</select></span></div>`;
    if (G.tera) {
      h += `<div class="field"><span class="flab">テラスタイプ</span><span class="sel"><select id="s-tera" aria-label="テラスタイプ">${TYPE_ORDER.concat([18]).map(ti =>
        `<option value="${TYPES[ti][0]}"${TYPES[ti][0] === set.tera ? ' selected' : ''}>${esc(TYPES[ti][1])}</option>`).join('')}</select></span></div>`;
    }
    h += `<div class="field"><span class="flab">${G.statPoints ? '能力ポイント' : '個体値・努力値'}（Lv.50の実数値）</span><div id="s-stats">${statsHTML(set, sp)}</div></div>`;
    h += `<div class="opts" style="margin-top:16px"><button type="button" class="btn warn" data-remove="${tid}:${i}">このポケモンを外す</button></div>`;
    V.set.innerHTML = h;
    V.set.dataset.ref = `${tid}:${i}`;
  }
  function curSet() {
    const [tid, i] = (V.set.dataset.ref || '').split(':'), tm = teamById(tid);
    return tm && tm.sets[+i] ? { tid, i: +i, set: tm.sets[+i] } : null;
  }

  function stepEV(set, sp, i, dir) {
    const g = S.game, ch = GD[g].statPoints, lim = LIMIT(g), [up, down] = natUD(set.nature);
    const st = v => calcStat(g, i, sp[SP_ST][i], 50, ch ? 31 : set.ivs[i], v, up, down);
    const cur = set.evs[i], now = st(cur);
    if (dir > 0) {
      const cap = Math.min(lim.max, lim.total - (set.evs.reduce((a, b) => a + b, 0) - cur));
      for (let v = cur + 1; v <= cap; v++) if (st(v) > now) return v;
      return cur;
    }
    for (let v = cur - 1; v >= 0; v--) {
      if (st(v) < now) { const s = st(v); let m = v; while (m > 0 && st(m - 1) === s) m--; return m; }
    }
    return 0;
  }

  // ---- 選択リスト ----------------------------------------------------------
  let pickCtx = null, pickFromSet = false;
  function renderPick(tid, i, kind, slot) {
    pickCtx = { tid, i, kind, slot };
    const title = kind === 'sp' ? 'ポケモンを選ぶ' : kind === 'item' ? '持ち物を選ぶ' : `技${slot + 1}を選ぶ`;
    const back = teamById(tid).sets[i] ? `#/set/${tid}/${i}` : `#/team/${tid}`;
    V.pick.innerHTML = bar(title, back) + '<div class="pick-top"><input id="pick-q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
      `placeholder="${kind === 'sp' ? 'ポケモンの名前' : kind === 'item' ? '持ち物の名前' : '技の名前'}で絞り込み" aria-label="絞り込み"></div><ul class="plist" id="pick-list"></ul>`;
    renderPickList('');
  }

  function pickRows() {
    const { tid, i, kind, slot } = pickCtx, G = gd(), set = teamById(tid).sets[i];
    if (kind === 'sp') {
      // 図鑑でブックマークしたポケモンを先頭に（メガシンカの姿は、元の姿＋メガストーンで出す）
      const row = (sp, mg) => {
        const st = mg ? mg[MG_ST] : sp[SP_ST], t1 = mg ? mg[MG_T1] : sp[SP_T1], t2 = mg ? mg[MG_T2] : sp[SP_T2], name = mg ? mg[MG_DISP] : sp[SP_DISP];
        return { key: mg ? `${sp[SP_PS]}|${ITEMS[mg[MG_ITEM]][IT_ID]}` : sp[SP_PS], name, q: norm(name + sp[SP_BASE] + sp[SP_PS]),
          left: tt(t1) + (t2 >= 0 ? tt(t2) : ''), right: `合計 ${st.reduce((x, y) => x + y, 0)}`, cur: !mg && !!set && set.sp === sp[SP_PS] };
      };
      const all = G.species.map(sp => row(sp, null)).sort((x, y) => collator.compare(x.name, y.name));
      const bm = bookmarks(), hits = bm.map(pid => findByPid(S.game, pid)).filter(Boolean).map(h => Object.assign(row(h.sp, h.mega), { bm: true }));
      if (!bm.length) return all;
      const miss = bm.length - hits.length;
      return [{ head: `ブックマーク ${hits.length}匹${miss ? `（このルールで使えないもの ${miss}匹）` : ''}` }].concat(hits, [{ head: 'すべてのポケモン' }], all);
    }
    const sp = G.byPs.get(set.sp);
    if (kind === 'item') {
      const rows = G.itemIds.map(id => {
        const it = iById.get(id), mega = !!it[IT_MEGA] && it[IT_MEGA] === sp[SP_PS];
        return { key: id, name: it[IT_JA], q: norm(it[IT_JA] + id), left: '', right: mega ? 'メガシンカ' : '', cur: set.item === id, top: mega };
      }).sort((x, y) => (y.top - x.top) || collator.compare(x.name, y.name));
      return [{ key: '', name: '持ち物なし', q: '', left: '', right: '', cur: !set.item }].concat(rows);
    }
    const chosen = new Set(set.moves.filter((m, k) => k !== slot));
    const rows = [...moveSet(S.game, sp)].filter(id => !chosen.has(id)).map(id => {
      const m = mById.get(id);
      return { key: id, name: m[MV_JA], q: norm(m[MV_JA] + id), left: tt(m[MV_TYPE]),
        right: `<span class="cls c${m[MV_CAT]}">${CAT_JA[m[MV_CAT]]}</span> ${m[MV_BP] || '—'} / ${m[MV_ACC] == null ? '—' : m[MV_ACC]}`,
        cur: set.moves[slot] === id, t: TYPE_ORDER.indexOf(m[MV_TYPE]) };
    }).sort((x, y) => x.t - y.t || collator.compare(x.name, y.name));
    return (set.moves[slot] ? [{ key: '', name: 'この技を外す', q: '', left: '', right: '', cur: false }] : []).concat(rows);
  }

  function renderPickList(q) {
    const qn = norm(q), all = pickRows(), LIMIT_ROWS = 400;
    let rows = qn ? all.filter(r => !r.head && r.q.includes(qn)) : all;
    if (qn) { const seen = new Set(); rows = rows.filter(r => !seen.has(r.key) && !!seen.add(r.key)); }
    const n = rows.filter(r => !r.head).length;
    let h = rows.slice(0, LIMIT_ROWS).map(r => r.head ? `<li class="hd">${esc(r.head)}</li>` :
      `<li><button type="button" data-choose="${esc(r.key)}"${r.cur ? ' aria-current="true"' : ''}>` +
      `<span class="tts">${r.left}</span><span class="nm">${r.bm ? '<span class="bmk" aria-label="ブックマーク">★</span>' : ''}${esc(r.name)}</span><span class="rt">${r.right}</span></button></li>`).join('');
    if (!n) h = '<li class="fine">見つかりません</li>';
    if (rows.length > LIMIT_ROWS) h += `<li class="fine">ほか${rows.length - LIMIT_ROWS}件。名前で絞り込んでください。</li>`;
    $('pick-list').innerHTML = h;
  }

  function choosePick(val) {
    const { tid, i, kind, slot } = pickCtx, G = gd(), t = teamById(tid).sets;
    if (kind === 'sp') {
      const [ps, stone] = val.split('|'), sp = G.byPs.get(ps), old = t[i];
      let set;
      if (old) {
        const abil = abilIds(sp), legal = moveSet(S.game, sp);
        set = Object.assign({}, old, { sp: ps, note: '' });
        set.ability = abil.includes(old.ability) ? old.ability : abil[0];
        set.moves = (old.moves || []).filter(m => legal.has(m));
        if (sp[SP_REQ].length) set.item = ITEMS[sp[SP_REQ][0]][IT_ID];
        if (G.tera && !set.tera) set.tera = TYPES[sp[SP_T1]][0];
      } else {
        // 新しく入れるときは、おまかせと同じ考え方で 技・持ち物・能力ポイント などを入れておく
        const used = new Set(t.map(x => x.item).filter(Boolean));
        const mg = stone ? (G.megas || []).find(m => ITEMS[m[MG_ITEM]][IT_ID] === stone && m[MG_BASE] === ps) : null;
        set = makeSet(S.game, formOf(S.game, sp, mg, S.rule === 'doubles'), S.rule === 'doubles', used);
      }
      if (stone) set.item = stone;
      t[i] = set;
    } else if (kind === 'item') {
      t[i].item = val;
    } else {
      const mv = t[i].moves.slice();
      if (val) mv[slot] = val; else mv.splice(slot, 1);
      t[i].moves = mv.filter(Boolean).slice(0, 4);
    }
    save();
    if (pickFromSet) { pickFromSet = false; history.back(); } else location.replace(`#/set/${tid}/${i}`);
  }


  // ---- おまかせ編成 --------------------------------------------------------
  // ① 6匹で弱点を補い合う（ある弱点を、半減以下で受けられる仲間がいるか）
  // ② チャンピオンズはメガシンカを1〜2匹（性能はメガシンカ後の姿で評価する）
  // ③ 型・性格・能力ポイントは「種族値 × 覚える技の威力」で物理・特殊・両刀を決め、すばやさで振り方を変える
  // ④ 技は一致技 → 相性の範囲を広げる技の順。ダブルは まもる・ねこだまし、サポートは補助技を優先
  const TR = { CHARGE: 1, RECHARGE: 2, SELFKO: 4, SELFDROP: 8, RECOIL: 16, PIVOT: 32, VAR: 64, OHKO: 128, FIXED: 256, USEDEF: 512, TGTATK: 1024, DRAIN: 2048 };
  // 条件がそろわないと使いにくい技
  const AVOID = new Set(['focuspunch', 'dreameater', 'lastresort', 'belch', 'synchronoise', 'fling', 'naturalgift', 'spitup', 'steelroller', 'burnup',
    'doubleshock', 'futuresight', 'doomdesire', 'rollout', 'iceball', 'uproar', 'thrash', 'petaldance', 'outrage', 'ragingfury', 'skydrop', 'bide',
    'counter', 'mirrorcoat', 'metalburst', 'comeuppance', 'endeavor', 'finalgambit', 'snore', 'sleeptalk', 'present', 'magnitude',
    'hiddenpower', 'mistyexplosion', 'grassknot', 'lowkick', 'heatcrash', 'heavyslam', 'gyroball', 'electroball', 'reversal', 'flail', 'punishment',
    'storedpower', 'powertrip', 'trumpcard', 'wringout', 'crushgrip', 'frustration', 'return']);
  const HEAVY_RECOIL = new Set(['steelbeam', 'mindblown', 'chloroblast', 'headsmash', 'lightofruin']);
  const SETUP_P = ['swordsdance', 'dragondance', 'bulkup', 'victorydance', 'shiftgear', 'coil', 'tidyup'];
  const SETUP_S = ['nastyplot', 'calmmind', 'quiverdance', 'tailglow'];
  const RECOVER = ['recover', 'roost', 'slackoff', 'softboiled', 'moonlight', 'morningsun', 'synthesis', 'shoreup', 'milkdrink', 'strengthsap', 'lifedew'];
  const SUPPORT = {
    doubles: ['followme', 'ragepowder', 'tailwind', 'trickroom', 'spore', 'willowisp', 'helpinghand', 'icywind', 'snarl', 'thunderwave', 'wideguard',
      'partingshot', 'sleeppowder', 'encore', 'taunt', 'pollenpuff', 'lifedew', 'recover', 'protect'],
    singles: ['stealthrock', 'spore', 'willowisp', 'toxic', 'thunderwave', 'recover', 'roost', 'slackoff', 'softboiled', 'moonlight', 'synthesis',
      'uturn', 'voltswitch', 'partingshot', 'taunt', 'spikes', 'knockoff', 'haze', 'yawn'],
  };
  const TYPE_ITEM = { Normal: 'silkscarf', Fighting: 'blackbelt', Flying: 'sharpbeak', Poison: 'poisonbarb', Ground: 'softsand', Rock: 'hardstone',
    Bug: 'silverpowder', Ghost: 'spelltag', Steel: 'metalcoat', Fire: 'charcoal', Water: 'mysticwater', Grass: 'miracleseed', Electric: 'magnet',
    Psychic: 'twistedspoon', Ice: 'nevermeltice', Dragon: 'dragonfang', Dark: 'blackglasses', Fairy: 'fairyfeather' };
  // 特性による無効・半減（タイプの添字：4 じめん 9 ほのお 10 みず 11 くさ 12 でんき 14 こおり 7 ゴースト）
  const IMMUNE_AB = { levitate: [4], eartheater: [4], flashfire: [9], wellbakedbody: [9], waterabsorb: [10], stormdrain: [10], dryskin: [10],
    voltabsorb: [12], lightningrod: [12], motordrive: [12], sapsipper: [11] };
  const HALVE_AB = { thickfat: [9, 14], heatproof: [9], waterbubble: [9], purifyingsalt: [7] };
  // 天候・フィールド：起こす特性・技・長持ちさせる持ち物・強くなるタイプ・強くなる特性（数値は効き目の大きさ）・合う技
  // type と def はタイプの添字（10 みず 9 ほのお 5 いわ 14 こおり 12 でんき 11 くさ 13 エスパー 17 フェアリー）
  const MODES = {
    rain: { ja: 'あめ', fid: 'raindance', kind: 'w', ab: ['drizzle'], move: 'raindance', item: 'damprock', type: 10, anti: 9,
      ben: { swiftswim: 1, raindish: 0.3, dryskin: 0.3, hydration: 0.3 }, mv: ['thunder', 'hurricane', 'electroshot'] },
    sun: { ja: 'はれ', fid: 'sunnyday', kind: 'w', ab: ['drought', 'orichalcumpulse'], move: 'sunnyday', item: 'heatrock', type: 9, anti: 10,
      ben: { chlorophyll: 1, solarpower: 0.6, protosynthesis: 0.6, flowergift: 0.3, harvest: 0.3, leafguard: 0.2 }, mv: ['solarbeam', 'solarblade', 'hydrosteam'] },
    sand: { ja: 'すなあらし', fid: 'sandstorm', kind: 'w', ab: ['sandstream', 'sandspit'], move: 'sandstorm', item: 'smoothrock', def: 5,
      ben: { sandrush: 1, sandforce: 0.6, sandveil: 0.2 }, mv: ['shoreup'] },
    snow: { ja: 'ゆき', fid: 'snowscape', kind: 'w', ab: ['snowwarning'], move: 'snowscape', item: 'icyrock', def: 14,
      ben: { slushrush: 1, icebody: 0.3, snowcloak: 0.2 }, mv: ['blizzard', 'auroraveil'] },
    electric: { ja: 'エレキフィールド', fid: 'electricterrain', kind: 't', ab: ['electricsurge', 'hadronengine'], move: 'electricterrain', item: 'terrainextender', type: 12,
      ben: { surgesurfer: 1, quarkdrive: 0.6 }, mv: ['risingvoltage'] },
    grassy: { ja: 'グラスフィールド', fid: 'grassyterrain', kind: 't', ab: ['grassysurge'], move: 'grassyterrain', item: 'terrainextender', type: 11,
      ben: { grasspelt: 0.4 }, mv: ['grassyglide'] },
    psychic: { ja: 'サイコフィールド', fid: 'psychicterrain', kind: 't', ab: ['psychicsurge'], move: 'psychicterrain', item: 'terrainextender', type: 13,
      ben: {}, mv: ['expandingforce'] },
    misty: { ja: 'ミストフィールド', fid: 'mistyterrain', kind: 't', ab: ['mistysurge'], move: 'mistyterrain', item: 'terrainextender', type: 17,
      ben: {}, mv: [] },
  };
  const MODE_BY_MOVE = Object.fromEntries(Object.entries(MODES).map(([k, m]) => [m.move, k]));
  const BT = { theme: '' };                  // おまかせで組んでいる最中のテーマ
  function benefitOf(ability, types, moves, mode) {   // その天候・フィールドで どれだけ強くなるか（0〜1.5 くらい）
    const M = MODES[mode];
    let v = M.ben[ability] || 0;
    if (M.type != null && types.includes(M.type)) v += 0.5;
    if (M.def != null && types.includes(M.def)) v += 0.4;
    if (M.anti != null && types.includes(M.anti)) v -= 0.3;
    return v + Math.min(0.4, 0.2 * M.mv.filter(id => moves.has(id)).length);
  }
  function themeAbility(sp, mode) {          // テーマに合う特性：起こす特性 → その天候で強くなる特性
    const ids = abilIds(sp), M = MODES[mode];
    return ids.find(a => M.ab.includes(a)) || ids.filter(a => (M.ben[a] || 0) >= 0.6).sort((a, b) => M.ben[b] - M.ben[a])[0] || '';
  }
  function themeMul(m) {                    // テーマの天候・フィールドで、技がどれだけ強くなるか（5ターンほどなので控えめに見る）
    const t = BT.theme, id = m[MV_ID], ty = m[MV_TYPE];
    if (!t) return 1;
    if (t === 'rain') return ty === 10 ? 1.3 : ty === 9 ? 0.7 : 1;
    if (t === 'sun') return ty === 9 || id === 'hydrosteam' ? 1.3 : ty === 10 ? 0.7 : 1;
    if (MODES[t].kind === 't' && ty === MODES[t].type) return id === 'risingvoltage' ? 1.6 : id === 'expandingforce' ? 1.4 : 1.2;
    return 1;
  }
  let EFFM = null;
  function effMatrix() {                  // EFFM[攻撃タイプ][防御タイプ] = 0 / 0.5 / 1 / 2（Showdown の相性表から作る）
    if (EFFM) return EFFM;
    EFFM = [];
    for (let a = 0; a < 18; a++) {
      EFFM.push([]);
      for (let d = 0; d < 18; d++) {
        const A = TYPES[a][0], Dt = [TYPES[d][0]];
        EFFM[a].push(PSEngine.Dex.getImmunity(A, Dt) ? Math.pow(2, PSEngine.Dex.getEffectiveness(A, Dt)) : 0);
      }
    }
    return EFFM;
  }
  function defMult(f, a) {
    const M = effMatrix();
    if ((IMMUNE_AB[f.ability] || []).includes(a)) return 0;
    let m = M[a][f.t1] * (f.t2 >= 0 ? M[a][f.t2] : 1);
    if ((HALVE_AB[f.ability] || []).includes(a)) m /= 2;
    return m;
  }
  const abilRating = id => (aById.get(id) || [0, 0, 0])[2];
  function bestAbility(ids) {
    const best = Math.max(...ids.map(abilRating));
    const top = ids.filter(id => abilRating(id) === best);
    return top[Math.floor(Math.random() * top.length)];
  }
  function movePower(f, m, dbl) {         // 技の実質的な強さ（威力 × 一致 × 命中 × 使いやすさ）
    const tr = m[MV_TRAIT];
    if (!m[MV_CAT] || (tr & TR.OHKO) || AVOID.has(m[MV_ID])) return 0;
    let bp = tr & TR.FIXED ? 65 : m[MV_BP];
    if (!bp) return 0;
    bp *= m[MV_HITS] || 1;
    const id = m[MV_ID], sure = (BT.theme === 'rain' && (id === 'thunder' || id === 'hurricane')) || (BT.theme === 'snow' && id === 'blizzard');
    let p = bp * (m[MV_TYPE] === f.t1 || m[MV_TYPE] === f.t2 ? 1.5 : 1) * (m[MV_ACC] == null || sure ? 1 : m[MV_ACC] / 100) * themeMul(m);
    const noCharge = (BT.theme === 'sun' && (id === 'solarbeam' || id === 'solarblade')) || (BT.theme === 'rain' && id === 'electroshot');
    if ((tr & TR.CHARGE) && !noCharge) p *= 0.45;
    if (tr & TR.RECHARGE) p *= 0.45;
    if (tr & TR.SELFKO) p *= 0.25;
    if (tr & TR.SELFDROP) p *= 0.9;
    if (tr & TR.RECOIL) p *= HEAVY_RECOIL.has(m[MV_ID]) ? 0.6 : 0.93;   // HPの半分を失う技は大きく割り引く
    if (tr & (TR.PIVOT | TR.DRAIN)) p *= 1.05;
    if (dbl && m[MV_TGT] === 'allAdjacentFoes') p *= 1.15;
    if (dbl && m[MV_TGT] === 'allAdjacent') p *= 0.9;
    const tr2 = m[MV_TRAIT], stat = tr2 & TR.USEDEF ? f.stats[2] : tr2 & TR.TGTATK ? 110 : m[MV_CAT] === 1 ? f.stats[1] : f.stats[3];
    return (p * stat) / 100;
  }
  function offense(g, f, cat, dbl) {     // その分類で「種族値 × いちばん強い技」。一致技を優先し、ほかは2割引きで見る
    let stab = 0, other = 0;
    for (const id of moveSet(g, f.sp)) {
      const m = mById.get(id);
      if (m[MV_CAT] !== cat) continue;
      const p = movePower(f, m, dbl);
      if (m[MV_TYPE] === f.t1 || m[MV_TYPE] === f.t2) stab = Math.max(stab, p); else other = Math.max(other, p);
    }
    return Math.max(stab, other * 0.8);
  }
  function formOf(g, sp, mega, dbl) {
    const baseAb = (BT.theme && themeAbility(sp, BT.theme)) || bestAbility(abilIds(sp));
    const f = mega
      ? { sp, mega, t1: mega[MG_T1], t2: mega[MG_T2], stats: mega[MG_ST], ability: ABIL[mega[MG_AB]][0], baseAbility: baseAb, num: sp[SP_NUM] }
      : { sp, mega: null, t1: sp[SP_T1], t2: sp[SP_T2], stats: sp[SP_ST], ability: baseAb, baseAbility: baseAb, num: sp[SP_NUM] };
    f.oP = offense(g, f, 1, dbl);
    f.oS = offense(g, f, 2, dbl);
    const bst = f.stats.reduce((a, b) => a + b, 0);
    f.q = 0.5 * (bst - 420) / 180 + 0.5 * Math.max(f.oP, f.oS) / 220 + 0.08 * (abilRating(f.ability) - 2);
    f.bst = bst;
    f.setter = !!BT.theme && MODES[BT.theme].ab.includes(f.ability);
    f.bt = BT.theme ? benefitOf(f.ability, [f.t1, f.t2], moveSet(g, sp), BT.theme) : 0;
    return f;
  }
  function decideRole(g, f, dbl) {
    const [, atk, , spa, , spe] = f.stats, legal = moveSet(g, f.sp);
    const sup = SUPPORT[dbl ? 'doubles' : 'singles'].filter(id => legal.has(id) && mById.get(id)[MV_CAT] === 0);
    const cat = f.oP >= f.oS ? 1 : 2;
    if (Math.max(atk, spa) <= 90 && sup.length >= 2) return { kind: 'support', cat, fast: spe >= 80 };
    // ダブル：耐久が高く、場を整える技を多く覚えるならサポート役（例：ガオガエン）
    const KEY = ['fakeout', 'partingshot', 'followme', 'ragepowder', 'tailwind', 'trickroom', 'spore', 'willowisp', 'icywind', 'snarl', 'helpinghand'];
    const [hp, , def, , spd] = f.stats;
    if (dbl && hp + def + spd >= 270 && Math.max(atk, spa) < 120 && KEY.filter(id => legal.has(id)).length >= 3) return { kind: 'support', cat, fast: spe >= 80 };
    // 種族値 × 技の威力が1割以内で、こうげき・とくこうがどちらも高ければ両刀
    const mixed = Math.min(f.oP, f.oS) >= 0.9 * Math.max(f.oP, f.oS) && Math.min(atk, spa) >= 90;
    return { kind: mixed ? 'mixed' : 'attacker', cat, fast: spe >= 80 };
  }
  function chooseAttacks(pool, n, f, pw) {
    const M = effMatrix(), chosen = [];
    const cov = set => {
      let v = 0;
      for (let d = 0; d < 18; d++) {
        let b = 0;
        for (const m of set) b = Math.max(b, M[m[MV_TYPE]][d]);
        v += b >= 2 ? 1 : b >= 1 ? 0.45 : b > 0 ? 0.1 : 0;
      }
      return v;
    };
    for (const t of [f.t1, f.t2]) {             // 一致技：タイプごとに最強のもの
      if (t < 0 || chosen.length >= n) continue;
      const m = pool.find(x => x[MV_TYPE] === t && !chosen.includes(x));
      if (m && pw(m) >= 60) chosen.push(m);
    }
    while (chosen.length < n) {                  // 相性の範囲が広がる技を、威力と合わせて選ぶ
      const base = cov(chosen);
      let best = null, bs = -1;
      for (const m of pool) {
        if (chosen.includes(m) || chosen.some(c => c[MV_TYPE] === m[MV_TYPE])) continue;
        const sc = cov(chosen.concat([m])) - base + pw(m) / 120 + (m[MV_PRIO] > 0 && pw(m) >= 60 ? 0.3 : 0);
        if (sc > bs) { bs = sc; best = m; }
      }
      if (!best) best = pool.find(m => !chosen.includes(m));
      if (!best) break;
      chosen.push(best);
    }
    return chosen.map(m => m[MV_ID]);
  }
  function pickMoves(g, f, role, dbl) {
    const legal = moveSet(g, f.sp), out = [];
    const has = id => legal.has(id);
    const add = id => { if (id && has(id) && !out.includes(id) && out.length < 4) out.push(id); };
    const pw = m => movePower(f, m, dbl);
    const catOK = m => (role.kind === 'attacker' ? m[MV_CAT] === role.cat : m[MV_CAT] > 0);
    const pool = [...legal].map(id => mById.get(id)).filter(m => catOK(m) && pw(m) > 0).sort((a, b) => pw(b) - pw(a));
    if (dbl) add(['protect', 'detect'].find(has));
    if (dbl && has('fakeout') && (role.kind === 'support' || (role.kind === 'attacker' && role.cat === 1))) add('fakeout');
    let util = '';
    if (role.kind === 'support') {
      const stab = pool.find(m => m[MV_TYPE] === f.t1 || m[MV_TYPE] === f.t2);
      if (stab) add(stab[MV_ID]);
      if (Math.max(f.stats[1], f.stats[3]) >= 100) chooseAttacks(pool.filter(m => !out.includes(m[MV_ID])), 1, f, pw).forEach(add);
      if (BT.theme && !f.setter && !dbl) add(MODES[BT.theme].move);   // 特性で起こせないときは技で天候・フィールドを起こす
      for (const id of SUPPORT[dbl ? 'doubles' : 'singles']) if (out.length < 4) add(id);
    } else if (!dbl) {
      // すばやさ重視は積み技、耐久重視は回復 → ステルスロック → 状態異常の技
      const setup = (role.cat === 1 ? SETUP_P : SETUP_S).find(has), rec = RECOVER.find(has);
      const hz = has('stealthrock') ? 'stealthrock' : '', st = ['willowisp', 'thunderwave', 'toxic'].find(has);
      util = role.fast ? setup || '' : rec || hz || setup || st || '';
    }
    chooseAttacks(pool.filter(m => !out.includes(m[MV_ID])), 4 - out.length - (util ? 1 : 0), f, pw).forEach(add);
    add(util);
    for (const m of pool) if (out.length < 4) add(m[MV_ID]);
    return out;
  }
  function natureOf(role, f, moves) {
    const [, , def, , spd] = f.stats, lowDef = def <= spd ? 2 : 4, main = role.cat === 1 ? 1 : 3, unused = main === 1 ? 3 : 1;
    let up, down;
    if (role.kind === 'support') {
      up = def >= spd ? 2 : 4;
      down = moves.includes('trickroom') ? 5 : moves.some(id => mById.get(id)[MV_CAT] === 1) ? 3 : 1;
    } else if (role.kind === 'mixed') { up = role.fast ? 5 : main; down = lowDef; }
    else { up = role.fast ? 5 : main; down = unused; }
    return NATS.find(n => n[2] === up && n[3] === down)[0];
  }
  function spreadOf(g, role, f) {
    const ch = GD[g].statPoints, MAX = ch ? 32 : 252, SMALL = ch ? 2 : 4, ev = [0, 0, 0, 0, 0, 0];
    const [, , def, , spd] = f.stats, better = def >= spd ? 2 : 4, other = better === 2 ? 4 : 2;
    const main = role.cat === 1 ? 1 : 3, sub = main === 1 ? 3 : 1;
    if (role.kind === 'support') { ev[0] = MAX; ev[better] = MAX; ev[other] = SMALL; }
    else if (role.kind === 'mixed') { ev[role.fast ? 5 : 0] = MAX; ev[main] = ch ? 17 : 132; ev[sub] = ch ? 17 : 124; }
    else if (role.fast) { ev[main] = MAX; ev[5] = MAX; ev[0] = SMALL; }
    else { ev[0] = MAX; ev[main] = MAX; ev[better] = SMALL; }
    return ev;
  }
  function pickItem(g, f, role, moves, used, dbl) {
    const G = GD[g], ok = id => !!id && G.itemSet.has(id) && !used.has(id);
    if (f.mega) return ITEMS[f.mega[MG_ITEM]][IT_ID];
    if (f.sp[SP_REQ].length) return ITEMS[f.sp[SP_REQ][0]][IT_ID];
    const status = moves.some(id => mById.get(id)[MV_CAT] === 0), [hp, , def, , spd, spe] = f.stats;
    const atk = moves.map(id => mById.get(id)).filter(m => m[MV_CAT]).sort((a, b) => movePower(f, b, dbl) - movePower(f, a, dbl))[0];
    const list = [];
    if (BT.theme && f.setter) list.push(MODES[BT.theme].item);      // 天候・フィールドを長持ちさせる持ち物
    if (role.kind === 'support') list.push(dbl ? 'sitrusberry' : 'leftovers', 'rockyhelmet', 'mentalherb', 'lightclay');
    else {
      if (!status && !dbl && role.fast && spe <= 110) list.push('choicescarf');     // すばやさ重視の型だけ（耐久重視に こだわりスカーフは合わない）
      if (!status) list.push(role.cat === 1 ? 'choiceband' : 'choicespecs');
      if (role.fast && hp + def + spd < 230) list.push('focussash');
      list.push('lifeorb', atk ? TYPE_ITEM[TYPES[atk[MV_TYPE]][0]] : '', 'expertbelt');
    }
    list.push('sitrusberry', 'leftovers', 'lumberry', 'focussash', 'shellbell', 'quickclaw', 'widelens', 'scopelens');
    list.push(...G.itemIds.filter(id => !iById.get(id)[IT_MEGA]));
    return list.find(ok) || '';
  }
  function roleLabel(role, f) {
    const pre = f.mega ? 'メガシンカ・' : '';
    // 天候・フィールドを起こす特性なら、テーマでなくても「〜役」と書く（出てくるだけで場が変わるため）
    const sm = Object.keys(MODES).find(k => MODES[k].ab.includes(f.ability));
    const th = sm ? `・${MODES[sm].ja}役` : BT.theme && f.bt >= 0.6 ? `・${MODES[BT.theme].ja}で強化` : '';
    if (role.kind === 'support') return pre + 'サポート' + th;
    const how = role.fast ? 'すばやさ重視' : '耐久重視';
    return pre + (role.kind === 'mixed' ? '両刀' : role.cat === 1 ? '物理アタッカー' : '特殊アタッカー') + `（${how}）` + th;
  }
  // チームの評価：弱点を受けられる仲間がいる割合・同じ弱点の重なり・一致技で抜群を取れる範囲・タイプの重複
  function coverOf(fs) {
    let pairs = 0, cov = 0, stack = 0;
    for (let a = 0; a < 18; a++) {
      const m = fs.map(f => defMult(f, a));
      const weak = m.filter(x => x >= 2).length, res = m.filter(x => x <= 0.5).length;
      m.forEach((x, i) => { if (x >= 2) { pairs++; if (m.some((y, j) => j !== i && y <= 0.5)) cov++; } });
      if (weak >= 3) stack += weak - 2;
      if (weak >= 2 && !res) stack += 0.7;
    }
    return { ratio: pairs ? cov / pairs : 1, stack };
  }
  function teamScore(fs) {
    const M = effMatrix(), c = coverOf(fs);
    let hit = 0;
    for (let d = 0; d < 18; d++) if (fs.some(f => M[f.t1][d] >= 2 || (f.t2 >= 0 && M[f.t2][d] >= 2))) hit++;
    const types = fs.flatMap(f => [f.t1, f.t2].filter(t => t >= 0)), dup = types.length - new Set(types).size;
    const theme = BT.theme ? 0.35 * Math.min(3, fs.reduce((a, f) => a + (f.bt || 0), 0)) + (fs.some(f => f.setter) ? 0.5 : 0) : 0;
    return fs.reduce((s, f) => s + f.q, 0) + 2.5 * c.ratio - 0.6 * c.stack + 0.05 * hit - 0.25 * dup + theme;
  }
  function weightedPick(arr, w) {
    const ws = arr.map(w), tot = ws.reduce((a, b) => a + b, 0);
    let r = Math.random() * tot;
    for (let i = 0; i < arr.length; i++) { r -= ws[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  function makeSet(g, f, dbl, used) {      // 1匹分：型 → 技 → 持ち物 → 性格・能力ポイント
    const G = GD[g], role = decideRole(g, f, dbl), moves = pickMoves(g, f, role, dbl);
    const item = pickItem(g, f, role, moves, used, dbl);
    if (item) used.add(item);
    const ivs = [31, 31, 31, 31, 31, 31];
    if (!G.statPoints) {                     // SV：トリックルーム役はすばやさ0、物理技を使わないなら こうげき0
      if (moves.includes('trickroom')) ivs[5] = 0;
      if (!moves.some(id => mById.get(id)[MV_CAT] === 1 || id === 'foulplay')) ivs[1] = 0;
    }
    const main = moves.map(id => mById.get(id)).filter(m => m[MV_CAT]).sort((x, y) => movePower(f, y, dbl) - movePower(f, x, dbl))[0];
    return { sp: f.sp[SP_PS], item, ability: f.baseAbility, moves, nature: natureOf(role, f, moves), evs: spreadOf(g, role, f), ivs,
      tera: G.tera ? TYPES[main ? main[MV_TYPE] : f.t1][0] : '', note: roleLabel(role, f) };
  }
  function availableModes(g) {             // そのルールで起こせる天候・フィールド
    const G = GD[g], out = new Set();
    for (const sp of G.species) {
      if (sp[SP_NFE] || sp[SP_EVENT]) continue;
      for (const a of abilIds(sp)) for (const k in MODES) if (MODES[k].ab.includes(a)) out.add(k);
    }
    for (const mg of G.megas || []) for (const k in MODES) if (MODES[k].ab.includes(ABIL[mg[MG_AB]][0])) out.add(k);
    return [...out];
  }
  function autoTeam(g, rule) {
    // 6割くらいのチームは、天候・フィールドを軸にする（起こす役を1匹入れ、その天候で強くなる仲間を優先する）
    const modes = availableModes(g);
    BT.theme = modes.length && Math.random() < 0.6 ? modes[Math.floor(Math.random() * modes.length)] : '';
    try { return buildTeam(g, rule); } finally { BT.theme = ''; }
  }
  function buildTeam(g, rule) {
    const G = GD[g], dbl = rule === 'doubles';
    const pool = G.species.filter(sp => !sp[SP_NFE] && !sp[SP_EVENT]).map(sp => formOf(g, sp, null, dbl)).filter(f => f.bst >= 420 && abilRating(f.ability) >= 0);
    const restr = t => t.filter(f => f.sp[SP_RESTR]).length;
    const megaPool = (G.megas || []).map(mg => { const sp = G.byPs.get(mg[MG_BASE]); return sp ? formOf(g, sp, mg, dbl) : null; }).filter(Boolean);
    let best = null, bestS = -Infinity;
    const nMega = megaPool.length ? (Math.random() < 0.5 ? 1 : 2) : 0;
    for (let it = 0; it < 60; it++) {
      const team = [], nums = new Set();
      while (team.length < nMega) {
        const c = weightedPick(megaPool.filter(f => !nums.has(f.num)), f => Math.exp(f.q * 3) * (f.setter || f.bt >= 0.6 ? 3 : 1));
        team.push(c); nums.add(c.num);
      }
      if (BT.theme && !team.some(f => f.setter)) {       // 天候・フィールドを起こす役を1匹
        const cands = pool.filter(f => f.setter && !nums.has(f.num) && !(restr(team) >= G.restrictedLimit && f.sp[SP_RESTR]));
        if (cands.length) { const c = weightedPick(cands, f => Math.exp(f.q * 3)); team.push(c); nums.add(c.num); }
      }
      while (team.length < 6) {
        const full = restr(team) >= G.restrictedLimit;
        const cands = pool.filter(f => !nums.has(f.num) && !(full && f.sp[SP_RESTR])).sort(() => Math.random() - 0.5).slice(0, 60);
        const base = teamScore(team);
        const top = cands.map(f => ({ f, s: teamScore(team.concat([f])) - base })).sort((a, b) => b.s - a.s).slice(0, 6);
        const c = weightedPick(top, x => Math.exp(x.s * 4)).f;
        team.push(c); nums.add(c.num);
      }
      const sc = teamScore(team) + Math.random() * 0.2;
      if (sc > bestS) { bestS = sc; best = team; }
    }
    const used = new Set();
    return best.map(f => makeSet(g, f, dbl, used));
  }

  function teamForms(t, g) {              // 表示用：メガストーンを持つポケモンはメガシンカ後の姿で見る
    const G = GD[g];
    return t.map(s => {
      const sp = G.byPs.get(s.sp), mg = (G.megas || []).find(m => ITEMS[m[MG_ITEM]][IT_ID] === s.item && m[MG_BASE] === s.sp);
      return mg ? { t1: mg[MG_T1], t2: mg[MG_T2], ability: ABIL[mg[MG_AB]][0], mega: mg } : { t1: sp[SP_T1], t2: sp[SP_T2], ability: s.ability, mega: null };
    });
  }
  function themeOf(t, g) {                 // チームの中で天候・フィールドを起こす特性を持つポケモン
    const fs = teamForms(t, g);
    for (let i = 0; i < fs.length; i++) for (const k in MODES) if (MODES[k].ab.includes(fs[i].ability)) return { mode: k, name: GD[g].byPs.get(t[i].sp)[SP_DISP] };
    return null;
  }
  function renderTeams() {
    const groups = [['ch', 'singles'], ['ch', 'doubles'], ['sv', 'singles'], ['sv', 'doubles']];
    let h = '<header class="masthead"><h1>チーム</h1><p class="sub">チームはいくつでも作れます。ルール（ゲームと形式）ごとに保存します。</p></header>' +
      '<div class="card"><div class="field"><span class="flab" id="lab-nt">新しいチームのルール</span><span class="sel"><select id="nt-rule" aria-labelledby="lab-nt">' +
      groups.map(([g, r]) => `<option value="${g}_${r}"${g === S.game && r === S.rule ? ' selected' : ''}>${ruleLabel(g, r)}</option>`).join('') + '</select></span></div>' +
      '<div class="acts"><button type="button" class="btn ink" data-newteam="auto">おまかせで作る</button><button type="button" class="btn" data-newteam="sample">サンプルから</button>' +
      '<button type="button" class="btn" data-newteam="empty">空のチーム</button></div>' +
      '<p class="fine">図鑑の各ポケモンの画面にある「チームに追加」からも、チームにポケモンを入れられます。</p></div>';
    for (const [g, r] of groups) {
      const list = teamsFor(g, r);
      if (!list.length) continue;
      h += `<h2 class="sec">${ruleLabel(g, r)}</h2>` + list.map(t => `<div class="card team"><h3>${esc(t.name)}<span class="n">${t.sets.length}/6</span></h3>` +
        chips(t.sets, g) + teamInfo(t.sets, g) + `<div class="acts"><a class="btn" href="#/team/${t.id}">編集する</a>` +
        `<button type="button" class="btn" data-useteam="${t.id}">このチームで対戦</button><button type="button" class="btn" data-simteam="${t.id}">連戦する</button></div></div>`).join('');
    }
    V.teams.innerHTML = h;
  }
  function teamProblems(sets, g, r) {       // 連戦の前の確認（対戦画面と同じ決まり）
    const f = D.games[g].formats[r], G = GD[g], lim = LIMIT(g), out = [];
    if (sets.length < f.pick) out.push(`${f.pick}匹以上必要です（いま${sets.length}匹）`);
    const nums = new Set(), items = new Set();
    for (const x of sets) {
      const sp = G.byPs.get(x.sp);
      if (nums.has(sp[SP_NUM])) out.push('同じポケモンがいます');
      nums.add(sp[SP_NUM]);
      if (x.item) { if (items.has(x.item)) out.push(`${jaItem(x.item)}が重なっています`); items.add(x.item); }
      if (!x.moves.length) out.push(`${sp[SP_DISP]}に技がありません`);
      if (x.evs.reduce((p, q) => p + q, 0) > lim.total) out.push(`${sp[SP_DISP]}の${G.statPoints ? '能力ポイント' : '努力値'}が多すぎます`);
    }
    if (sets.filter(x => G.byPs.get(x.sp)[SP_RESTR]).length > G.restrictedLimit) out.push(`禁止級の伝説のポケモンは${G.restrictedLimit}匹までです`);
    return [...new Set(out)];
  }
  let SIM = null;
  function renderSim() {
    if (!teamById(S.simTeam)) S.simTeam = selOf(S.game, S.rule).you;
    const t = teamById(S.simTeam), opps = teamsFor(t.game, t.rule).filter(x => x.id !== t.id);
    const running = SIM && SIM.running;
    V.sim.innerHTML = '<header class="masthead"><h1>連戦シミュレーション</h1><p class="sub">CPU どうしで何回も対戦させて、勝率と、選出したポケモンごとの戦績を出します。</p></header>' +
      `<div class="card"><div class="field"><span class="flab">あなたのチーム</span><span class="sel"><select id="sim-team"${running ? ' disabled' : ''}>` +
      S.teams.map(x => `<option value="${x.id}"${x.id === t.id ? ' selected' : ''}>${esc(x.name)}（${ruleLabel(x.game, x.rule)}）</option>`).join('') + '</select></span></div>' +
      `<div class="field"><span class="flab">相手</span><span class="sel"><select id="sim-opp"${running ? ' disabled' : ''}><option value="auto">おまかせ（1戦ごとに新しく作る）</option>` +
      opps.map(x => `<option value="${x.id}"${SIM && SIM.opp === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('') + '</select></span></div>' +
      `<div class="field"><span class="flab" id="lab-n">回数</span><div class="seg" role="group" aria-labelledby="lab-n" id="sim-n">${[10, 30, 100].map(n =>
        `<button type="button" data-simn="${n}" aria-pressed="${n === S.simN}"${running ? ' disabled' : ''}>${n}回</button>`).join('')}</div></div>` +
      `<p class="problems" id="sim-prob" hidden></p><button type="button" class="primary" id="sim-go">${running ? '止める' : '開始'}</button>` +
      '<p class="fine">選出・技・交代は、あなたのチームも相手も CPU が選びます。100回で1〜2分ほどかかります。</p></div>' +
      `<div id="sim-out">${SIM && SIM.agg ? simHTML(SIM.agg) : ''}</div>`;
  }
  function newAgg(t, opp) {
    const mine = {};
    for (const x of t.sets) mine[GD[t.game].byPs.get(x.sp)[SP_BASE]] = { disp: GD[t.game].byPs.get(x.sp)[SP_DISP], pick: 0, lead: 0, win: 0, ko: 0, fnt: 0, dmg: 0 };
    return { team: t.name, game: t.game, rule: t.rule, opp, n: 0, total: 0, win: 0, lose: 0, tie: 0, turns: 0, mine, foe: {} };
  }
  function addResult(agg, r) {
    agg.n++;
    if (r.winner === 'p1') agg.win++; else if (r.winner === 'p2') agg.lose++; else agg.tie++;
    agg.turns += r.turns;
    const lead = agg.rule === 'doubles' ? 2 : 1;
    r.picks.p1.forEach((name, i) => {
      const m = agg.mine[name];
      if (!m) return;
      m.pick++; if (i < lead) m.lead++; if (r.winner === 'p1') m.win++;
      m.ko += r.kos['p1:' + name] || 0; m.fnt += r.fnt['p1:' + name] ? 1 : 0; m.dmg += r.dmg['p1:' + name] || 0;
    });
    r.picks.p2.forEach(name => {
      const d = r.disp[name] || name, o = agg.foe[d] || (agg.foe[d] = { face: 0, ko: 0, fnt: 0, win: 0 });
      o.face++; o.ko += r.kos['p2:' + name] || 0; o.fnt += r.fnt['p2:' + name] ? 1 : 0; if (r.winner === 'p2') o.win++;
    });
  }
  function simHTML(a) {
    const pc = (x, y) => (y ? Math.round((100 * x) / y) + '%' : '—');
    const n = a.n, wr = n ? a.win / n : 0, err = n ? Math.round(196 * Math.sqrt((wr * (1 - wr)) / n)) : 0;
    let h = `<div class="card simres"><div class="big">勝率 ${pc(a.win, n)}</div><div class="wbar"><i style="width:${wr * 100}%"></i></div>` +
      `<p class="fine">${a.win}勝 ${a.lose}敗${a.tie ? ` ${a.tie}分` : ''}（${n}${a.total && n < a.total ? ` / ${a.total}` : ''}戦）・平均 ${n ? (a.turns / n).toFixed(1) : '—'}ターン` +
      `${n >= 10 ? `・誤差の目安 ±${err}%` : ''}</p>` +
      '<h3>あなたのポケモン</h3><div class="scroll-x"><table class="stab"><thead><tr><th class="l">ポケモン</th><th>選出</th><th>先発</th><th>勝率</th><th>撃破</th><th>ひんし</th></tr></thead><tbody>' +
      Object.values(a.mine).sort((x, y) => y.pick - x.pick).map(m => `<tr><td class="l">${esc(m.disp)}</td><td>${pc(m.pick, n)}</td><td>${pc(m.lead, n)}</td>` +
        `<td>${pc(m.win, m.pick)}</td><td>${m.pick ? (m.ko / m.pick).toFixed(2) : '—'}</td><td>${pc(m.fnt, m.pick)}</td></tr>`).join('') + '</tbody></table></div>';
    const foes = Object.entries(a.foe).sort((x, y) => y[1].ko - x[1].ko || y[1].face - x[1].face).slice(0, 12);
    if (foes.length) {
      h += `<h3>${a.opp === 'auto' ? '手ごわかった相手（あなたのポケモンを倒した数の順）' : '相手のポケモン'}</h3><div class="scroll-x"><table class="stab"><thead><tr><th class="l">ポケモン</th><th>対面</th><th>倒された</th><th>勝率</th><th>撃破</th></tr></thead><tbody>` +
        foes.map(([d, o]) => `<tr><td class="l">${esc(d)}</td><td>${o.face}回</td><td>${o.ko}</td><td>${pc(o.win, o.face)}</td><td>${pc(o.fnt, o.face)}</td></tr>`).join('') + '</tbody></table></div>';
    }
    return h + '<p class="fine">あなたのポケモン：「選出」「先発」は全体の対戦に対する割合、「勝率」は選出したときの勝率、「撃破」は1戦あたりに倒した数、' +
      '「ひんし」は選出したときに倒された割合です。相手のポケモン：「対面」は選出された回数、「倒された」はあなたのポケモンが倒された数、' +
      '「勝率」は選出された対戦で相手が勝った割合、「撃破」はあなたが倒した割合です。撃破は、最後にダメージを与えたポケモンに数えます。</p></div>';
  }
  async function runSim() {
    const t = teamById($('sim-team').value), opp = $('sim-opp').value, n = S.simN;
    const probs = teamProblems(t.sets, t.game, t.rule).concat(opp !== 'auto' ? teamProblems(teamById(opp).sets, t.game, t.rule).map(x => '相手：' + x) : []);
    if (probs.length) { $('sim-prob').hidden = false; $('sim-prob').innerHTML = probs.map(esc).join('<br>'); return; }
    SIM = { running: true, cancel: false, opp, agg: newAgg(t, opp) };
    SIM.agg.total = n;
    renderSim();
    for (let i = 0; i < n && !SIM.cancel; i++) {
      const theirs = opp === 'auto' ? autoTeam(t.game, t.rule) : teamById(opp).sets;
      const r = await simOne(t.game, t.rule, t.sets, theirs);
      addResult(SIM.agg, r);
      const out = $('sim-out');
      if (out) out.innerHTML = `<p class="fine">${i + 1} / ${n} 戦目</p>` + simHTML(SIM.agg);
    }
    SIM.running = false;
    B = null;
    if (location.hash === '#/sim') renderSim();
  }
  // 画面に出さずに CPU どうしで1戦する（対戦画面と同じしくみを使い、表示だけ省く）
  function simOne(g, r, mine, theirs) {
    return new Promise(resolve => {
      const f = D.games[g].formats[r], stream = new PSEngine.BattleStream(), ps = PSEngine.getPlayerStreams(stream);
      const sess = { headless: true, f, game: g, cpu: { p1: true, p2: true }, stream, ps, req: { p1: null, p2: null }, done: { p1: false, p2: false },
        err: { p1: '', p2: '' }, hp: new Map(), cpuIn: {}, cpuStats: { moves: 0, switches: 0, status: 0 }, over: false, winner: '', lastWeather: '',
        unknown: new Set(), errors: [], ui: null, text: [], teams: { p1: mine, p2: theirs },
        st: { last: null, hitBy: {}, dmg: {}, kos: {}, fnt: {}, picks: { p1: [], p2: [] }, disp: {}, turns: 0 } };
      sess.finish = () => {
        if (sess.done2) return;
        sess.done2 = true; sess.over = true;
        resolve({ winner: sess.winner === 'あなた' ? 'p1' : sess.winner === '相手' ? 'p2' : '', turns: sess.st.turns, picks: sess.st.picks,
          disp: sess.st.disp, kos: sess.st.kos, fnt: sess.st.fnt, dmg: sess.st.dmg });
      };
      B = sess;
      pump(sess, ps.omniscient, onLog);
      pump(sess, ps.p1, c => onSide(sess, 'p1', c));
      pump(sess, ps.p2, c => onSide(sess, 'p2', c));
      const t1 = PSEngine.Teams.pack(mine.map(x => toPS(x, g))), t2 = PSEngine.Teams.pack(theirs.map(x => toPS(x, g)));
      ps.omniscient.write(`>start ${JSON.stringify({ formatid: f.id })}\n>player p1 ${JSON.stringify({ name: 'あなた', team: t1 })}\n` +
        `>player p2 ${JSON.stringify({ name: '相手', team: t2 })}`);
      setTimeout(() => { if (!sess.done2) { sess.errors.push('時間切れ'); sess.finish(); } }, 60000);
    });
  }
  function simLine(cmd, a, kw) {            // 連戦用：戦績に必要なことだけをログから拾う
    const st = B.st;
    switch (cmd) {
      case 'start': {
        const b = B.stream.battle, G = GD[B.game];
        st.picks = { p1: b.p1.pokemon.map(p => p.name), p2: b.p2.pokemon.map(p => p.name) };
        for (const p of b.p2.pokemon) st.disp[p.name] = (G.byPs.get(p.species.name) || [])[SP_DISP] || p.name;
        break;
      }
      case 'turn': st.turns = +a[0]; break;
      case 'switch': case 'drag': case 'replace': {
        const p = parseIdent(a[0]), h = parseHP(a[2]);
        if (p && h) B.hp.set(p.key, { cur: h.cur, max: h.max || (B.hp.get(p.key) || {}).max || h.cur });
        break;
      }
      case 'move': st.last = parseIdent(a[0]); break;
      case '-damage': case '-heal': case '-sethp': {
        const p = parseIdent(a[0]), h = parseHP(a[1]);
        if (!p || !h) break;
        const prev = B.hp.get(p.key) || { cur: h.cur, max: h.max }, max = h.max || prev.max;
        B.hp.set(p.key, { cur: h.cur, max });
        if (cmd === '-damage' && !kw.from && st.last && st.last.side !== p.side) {
          st.dmg[st.last.key] = (st.dmg[st.last.key] || 0) + Math.max(0, prev.cur - h.cur) / (max || 1);
          st.hitBy[p.key] = st.last.key;
        }
        break;
      }
      case 'faint': {
        const p = parseIdent(a[0]);
        if (!p) break;
        st.fnt[p.key] = 1;
        const k = st.hitBy[p.key];
        if (k) st.kos[k] = (st.kos[k] || 0) + 1;
        break;
      }
      case 'win': B.winner = a[0]; B.finish(); break;
      case 'tie': B.winner = ''; B.finish(); break;
    }
  }


  // ---- バトル ------------------------------------------------------------
  let B = null;
  let cmdTimer = 0;
  const scheduleCmd = () => { clearTimeout(cmdTimer); cmdTimer = setTimeout(renderCmd, 0); };
  async function pump(sess, stream, fn) {
    try { for await (const chunk of stream) { if (B !== sess) break; fn(chunk); } }
    catch (e) { console.error(e); if (B === sess) { sess.errors.push(String(e)); appendLog([{ cls: 'err', html: '対戦の処理でエラーが起きました：' + esc(e.message || e) }]); } }
  }
  function startBattle() {
    if (problems().length) return;
    const you = team('you').slice(), opp = team('opp').slice();
    if (selOf(S.game, S.rule).opp === 'auto') S.autoUsed[key()] = true;   // 次に設定画面を開くと、新しい おまかせ を作る
    const f = fmtInfo(), stream = new PSEngine.BattleStream(), ps = PSEngine.getPlayerStreams(stream);
    const sess = { f, game: S.game, cpu: { p1: AUTOTEST, p2: S.cpu || AUTOTEST }, stream, ps, req: { p1: null, p2: null }, done: { p1: false, p2: false },
      err: { p1: '', p2: '' }, hp: new Map(), cpuIn: {}, cpuStats: { moves: 0, switches: 0, status: 0 }, over: false, winner: '', lastWeather: '', unknown: new Set(), errors: [], ui: null, text: [],
      teams: { p1: you, p2: opp } };
    B = sess;
    V.battle.innerHTML = `<div class="bar"><button type="button" class="back" data-act="quit">${BACK_SVG}やめる</button>` +
      `<span class="ttl">${S.game === 'ch' ? 'チャンピオンズ' : 'SV'}・${f.gameType === 'doubles' ? 'ダブル' : 'シングル'}</span><span class="sp" id="b-turn"></span></div>` +
      '<div class="bf" id="b-field"></div><div class="logbox" id="b-logbox"><ol class="log" id="b-log"></ol></div><div class="cmd" id="b-cmd"></div>';
    if (location.hash !== '#/battle') location.hash = '#/battle'; else { showView('battle'); }
    pump(sess, ps.omniscient, onLog);
    pump(sess, ps.p1, c => onSide(sess, 'p1', c));
    pump(sess, ps.p2, c => onSide(sess, 'p2', c));
    const t1 = PSEngine.Teams.pack(you.map(x => toPS(x, S.game)));
    const t2 = PSEngine.Teams.pack(opp.map(x => toPS(x, S.game)));
    ps.omniscient.write(`>start ${JSON.stringify({ formatid: f.id })}\n>player p1 ${JSON.stringify({ name: 'あなた', team: t1 })}\n` +
      `>player p2 ${JSON.stringify({ name: '相手', team: t2 })}`);
  }
  function onSide(sess, side, chunk) {
    for (const line of chunk.split('\n')) {
      if (line.startsWith('|request|')) {
        const req = JSON.parse(line.slice(9));
        sess.req[side] = req; sess.done[side] = false; sess.err[side] = '';
        if (sess.ui && sess.ui.side === side) sess.ui = null;
      } else if (line.startsWith('|error|')) {
        sess.err[side] = line.slice(7); sess.done[side] = false;
        if (sess.ui && sess.ui.side === side) sess.ui = null;
      }
    }
    scheduleCmd();
  }
  const actionable = r => !!r && !r.wait && !!(r.teamPreview || r.forceSwitch || r.active);
  const identName = id => String(id || '').replace(/^p[12][a-d]?:\s?/, '');
  function submit(side, choice) {
    B.done[side] = true;
    B.ui = null;
    B.ps[side].write(choice);
    scheduleCmd();
  }

  // ---- 対戦ログ（Showdown のプロトコル → 日本語） ------------------------
  function parseIdent(s) {
    const m = /^(p[12])([a-d]?):\s?(.*)$/.exec(s || '');
    return m ? { side: m[1], slot: m[2], name: m[3], key: m[1] + ':' + m[3] } : null;
  }
  const nm = s => { const p = parseIdent(s); return p ? esc((p.side === 'p2' ? '相手の ' : '') + p.name) : esc(s); };
  const sideOf = s => (/^p2/.test(s || '') ? 'p2' : 'p1');
  const sideWord = s => (sideOf(s) === 'p1' ? '味方' : '相手');
  function parseHP(s) {
    const m = /^(\d+)(?:\/(\d+))?/.exec(s || '');
    return m ? { cur: +m[1], max: m[2] ? +m[2] : 0 } : null;
  }
  const pct = (cur, max) => (cur <= 0 ? 0 : Math.max(1, Math.round((100 * cur) / (max || 1))));
  function hpLine(ident, hpStr) {
    const p = parseIdent(ident), hp = parseHP(hpStr);
    if (!p || !hp) return null;
    const prev = B.hp.get(p.key) || { cur: hp.cur, max: hp.max };
    const max = hp.max || prev.max;
    B.hp.set(p.key, { cur: hp.cur, max });
    const exact = p.side === 'p1' || !B.cpu.p2 || AUTOTEST;
    const diff = hp.cur - prev.cur;
    const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
    const body = exact ? `<b>${hp.cur}</b>/${max}（${sign(diff)}）` : `<b>${pct(hp.cur, max)}%</b>（${sign(pct(hp.cur, max) - pct(prev.cur, max))}%）`;
    return { cls: 'dmg', html: `${nm(ident)}　${body}` };
  }
  function boostText(w, stat, n, up) {
    const s = BOOST_JA[stat] || stat;
    if (n === 0) return `${w} の ${s}は もう ${up ? '上がらない' : '下がらない'}！`;
    const adv = n >= 3 ? (up ? 'ぐぐーんと ' : 'がくーんと ') : n === 2 ? (up ? 'ぐーんと ' : 'がくっと ') : '';
    return `${w} の ${s}が ${adv}${up ? '上がった' : '下がった'}！`;
  }
  const SIDE_START = {
    reflect: s => `${s}は リフレクターで 物理技に 強くなった！`, lightscreen: s => `${s}は ひかりのかべで 特殊技に 強くなった！`,
    auroraveil: s => `${s}は オーロラベールで 物理技と 特殊技に 強くなった！`, tailwind: s => `${s}の 背中を 追い風が 押す！`,
    spikes: s => `${s}の 足元に まきびしが 散らばった！`, toxicspikes: s => `${s}の 足元に どくびしが 散らばった！`,
    stealthrock: s => `${s}の 周りに とがった 岩が 浮かび始めた！`, stickyweb: s => `${s}の 足元に ねばねばネットが 広がった！`,
    safeguard: s => `${s}は 神秘のベールに 包まれた！`, mist: s => `${s}は 白い 霧に 包まれた！`,
    wideguard: s => `${s}は ワイドガードで 守られた！`, quickguard: s => `${s}は ファストガードで 守られた！`,
  };
  const FIELD_START = { trickroom: '時空が ゆがんだ！', gravity: '重力が 強くなった！', magicroom: '不思議な 空間に なった！', wonderroom: '不思議な 空間に なった！',
    electricterrain: '足元に 電気が かけめぐる！', grassyterrain: '足元に 草が 生い茂った！', mistyterrain: '足元に 霧が 立ち込めた！', psychicterrain: '足元が 不思議な 感じに なった！' };
  const FIELD_END = { trickroom: 'ゆがんだ 時空が 元に 戻った！', gravity: '重力が 元に 戻った！', magicroom: '不思議な 空間が 元に 戻った！', wonderroom: '不思議な 空間が 元に 戻った！',
    electricterrain: '足元の 電気が 消え去った！', grassyterrain: '足元の 草が 消え去った！', mistyterrain: '足元の 霧が 消え去った！', psychicterrain: '足元の 不思議な 感じが 消え去った！' };
  const START = {
    confusion: w => `${w} は 混乱した！`, substitute: w => `${w} の 分身が 現れた！`, taunt: w => `${w} は ちょうはつに 乗ってしまった！`,
    encore: w => `${w} は アンコールを 受けた！`, leechseed: w => `${w} に タネを 植えつけた！`, yawn: w => `${w} の 眠気を 誘った！`,
    saltcure: w => `${w} は しおづけに なった！`, attract: w => `${w} は メロメロに なった！`, focusenergy: w => `${w} は はりきっている！`,
    disable: (w, a) => `${w} の ${esc(jaMove(a))}を 封じた！`, flashfire: w => `${w} の ほのおの 技の 威力が 上がった！`,
    typechange: (w, a) => `${w} は ${String(a || '').split('/').map(x => esc(jaType(x))).join('・')}タイプに なった！`,
    stockpile1: w => `${w} は 1つ たくわえた！`, stockpile2: w => `${w} は 2つ たくわえた！`, stockpile3: w => `${w} は 3つ たくわえた！`,
    perish3: w => `${w} の ほろびの カウントが 3に なった！`, perish2: w => `${w} の ほろびの カウントが 2に なった！`,
    perish1: w => `${w} の ほろびの カウントが 1に なった！`, perish0: w => `${w} の ほろびの カウントが 0に なった！`,
    throatchop: w => `${w} は のどを やられて 音の 技が 出せなくなった！`, uproar: w => `${w} は さわぎ始めた！`,
    futuresight: w => `${w} は 未来に 攻撃を 予知した！`, imprison: w => `${w} は 相手の 技を ふういんした！`,
    dragoncheer: w => `${w} は はりきっている！`, curse: w => `${w} は のろいを かけられた！`, aquaring: w => `${w} は 水の ベールに 包まれた！`,
    smackdown: w => `${w} は 地面に 落とされた！`, torment: w => `${w} は いちゃもんを つけられた！`, healblock: w => `${w} は 回復を 封じられた！`,
    charge: w => `${w} は 充電した！`, slowstart: w => `${w} は 調子が 上がらない！`, magnetrise: w => `${w} は 電磁力で 浮かび上がった！`,
    embargo: w => `${w} は 道具が 使えなくなった！`, nightmare: w => `${w} は あくむを 見始めた！`, ingrain: w => `${w} は 根を はった！`,
  };
  const ACTIVATE = {
    attract: w => `${w} は メロメロだ！`, endure: w => `${w} は 攻撃を こらえた！`, skillswap: w => `${w} は 特性を 入れ替えた！`,
    struggle: w => `${w} は 出せる 技が ない！`, powersplit: w => `${w} は パワーを 分けあった！`, guardsplit: w => `${w} は ガードを 分けあった！`,
    afteryou: w => `${w} は 先を ゆずられた！`, trick: w => `${w} は 道具を 入れ替えた！`, switcheroo: w => `${w} は 道具を 入れ替えた！`,
    poltergeist: w => `${w} の 道具が 襲いかかる！`, gravity: w => `${w} は 重力で 地面に 落ちた！`,
    lockon: w => `${w} は 相手に ねらいを 定めた！`, mindreader: w => `${w} は 相手に ねらいを 定めた！`, destinybond: w => `${w} は 相手を 道連れに した！`, feint: w => `${w} の 守りを 破った！`,
  };
  const SINGLETURN = {
    focuspunch: w => `${w} は 集中力を 高めている！`, endure: w => `${w} は こらえる 体勢に 入った！`, roost: w => `${w} は 羽を 休めた`,
    quickguard: w => `${w} は ファストガードを 使った！`, wideguard: w => `${w} は ワイドガードを 使った！`, magiccoat: w => `${w} は マジックコートで 身を 包んだ！`,
    snatch: w => `${w} は 相手の 動きを うかがっている`, beakblast: w => `${w} は クチバシを 加熱し始めた！`, powder: w => `${w} は ふんじんに 包まれた！`,
  };
  const END = { confusion: '混乱が 解けた', substitute: '分身が 消えてしまった', taunt: 'ちょうはつの 効果が 解けた', encore: 'アンコールの 効果が 解けた',
    disable: 'かなしばりが 解けた', attract: 'メロメロが 解けた', saltcure: 'しおづけが 解けた' };
  const CANT = { slp: w => `${w} は ぐうぐう 眠っている`, par: w => `${w} は 体が しびれて 動けない！`, frz: w => `${w} は 凍ってしまって 動けない！`,
    flinch: w => `${w} は ひるんで 技が 出せない！`, recharge: w => `${w} は 攻撃の 反動で 動けない！`, nopp: w => `${w} は 技の PPが ない！`,
    truant: w => `${w} は なまけている`, attract: w => `${w} は メロメロで 技が 出せなかった！` };
  const STATUS_START = { brn: 'やけどを 負った！', par: 'まひして 技が 出にくくなった！', slp: '眠ってしまった！', psn: '毒を あびた！', tox: '猛毒を あびた！', frz: '凍りついた！' };
  const SKIP = new Set(['', 't:', 'gametype', 'player', 'teamsize', 'gen', 'tier', 'rule', 'clearpoke', 'poke', 'j', 'J', 'l', 'L', 'c', 'raw', 'html', 'uhtml',
    'uhtmlchange', 'seed', 'inactive', 'inactiveoff', 'debug', 'split', 'upkeep', '-anim', '-hint', '-center', '-combine', '-nothing', '-waiting',
    '-mustrecharge', 'detailschange', '-formechange', 'sentchoice', 'title', 'timer', 'badge', 'notify', 'done', 'bigerror', '-endability']);

  function fmtLine(cmd, a, kw) {
    const L = (html, cls) => ({ cls: cls || '', html });
    const w = nm(a[0]), dbl = B.f.gameType === 'doubles';
    const hp = () => { const x = hpLine(a[0], a[1]); return x ? [x] : []; };
    switch (cmd) {
      case 'teampreview': return [L('選出する ポケモンを 決めてください', 'raw')];
      case 'start': {
        // 選出した順（先頭が先発）を覚えておき、決着のあとにログへ書く
        const b = B.stream.battle, G = GD[B.game], lead = B.f.gameType === 'doubles' ? 2 : 1;
        B.picks = [b.p1, b.p2].map(sd => {
          const names = sd.pokemon.map(p => esc((G.byPs.get(p.species.name) || [])[SP_DISP] || p.name));
          return L(`${sd === b.p1 ? 'あなた' : '相手'}の選出：${names.slice(0, lead).join('・')}（先発）` + (names.length > lead ? `、${names.slice(lead).join('・')}` : ''), 'pick');
        });
        return [L('バトル スタート！', 'turn')];
      }
      case 'turn': return [L(`ターン ${esc(a[0])}`, 'turn')];
      case 'switch': case 'drag': case 'replace': {
        const p = parseIdent(a[0]), h = parseHP(a[2]);
        if (p && h) B.hp.set(p.key, { cur: h.cur, max: h.max || (B.hp.get(p.key) || {}).max || h.cur });
        if (cmd === 'drag') return [L(`${w} が 引きずり出された！`)];
        if (cmd === 'replace') return [];
        return [L(p && p.side === 'p1' ? `ゆけっ！ ${esc(p.name)}！` : `相手は ${esc(p ? p.name : a[0])} を くりだした！`, p && p.side === 'p1' ? 'me' : '')];
      }
      case 'move': return [L(`${w} の ${esc(jaMove(a[1]))}！`, sideOf(a[0]) === 'p1' ? 'me' : '')];
      case 'faint': return [L(`${w} は たおれた！`)];
      case '-damage': {
        const from = kw.from || '', fid = toID(from.replace(/^(item|ability|move):\s?/, ''));
        const out = [];
        if (from) {
          if (fid === 'psn' || fid === 'tox') out.push(L(`${w} は 毒の ダメージを 受けている！`));
          else if (fid === 'brn') out.push(L(`${w} は やけどの ダメージを 受けている！`));
          else if (fid === 'stealthrock') out.push(L(`とがった 岩が ${w} に 食い込んだ！`));
          else if (fid === 'spikes') out.push(L(`${w} は まきびしの ダメージを 受けた！`));
          else if (fid === 'sandstorm') out.push(L(`砂あらしが ${w} を おそう！`));
          else if (fid === 'recoil') out.push(L(`${w} は 反動による ダメージを 受けた！`));
          else if (fid === 'confusion') out.push(L('わけも わからず 自分を 攻撃した！'));
          else if (fid === 'leechseed') out.push(L(`やどりぎが ${w} の 体力を うばう！`));
          else if (fid === 'lifeorb') out.push(L(`${w} は 命が 少し 削られた！`));
          else if (/^ability:/.test(from)) out.push(L(`${w} は ${kw.of ? nm(kw.of) + ' の ' : ''}${esc(jaAbil(from.slice(8)))}で ダメージを 受けた！`));
          else if (/^item:/.test(from)) out.push(L(`${w} は ${kw.of ? nm(kw.of) + ' の ' : ''}${esc(jaItem(from.slice(5)))}で ダメージを 受けた！`));
          else out.push(L(`${w} は ${esc(effectJa(from))}で ダメージを 受けた！`));
        }
        return out.concat(hp());
      }
      case '-heal': {
        const from = kw.from || '', fid = toID(from.replace(/^(item|ability|move):\s?/, ''));
        const out = [];
        if (fid === 'drain') out.push(L(`${kw.of ? nm(kw.of) : '相手'} から 体力を 吸い取った！`));
        else if (/^item:/.test(from)) out.push(L(`${w} は ${esc(jaItem(from.slice(5)))}で 少し 回復した`));
        else if (/^ability:/.test(from)) out.push(L(`${w} は ${esc(jaAbil(from.slice(8)))}で 回復した`));
        else if (fid === 'grassyterrain') out.push(L(`${w} は グラスフィールドで 回復した`));
        else if (from) out.push(L(`${w} の 体力が 回復した！`));
        else out.push(L(`${w} の 体力が 回復した！`));
        return out.concat(hp());
      }
      case '-sethp': return hp();
      case '-status': {
        const msg = STATUS_START[a[1]] || `${esc(effectJa(a[1]))}状態に なった！`;
        const from = kw.from ? `${esc(effectJa(kw.from))}で ` : '';
        return [L(`${w} は ${from}${msg}`)];
      }
      case '-curestatus':
        if (a[1] === 'slp') return [L(`${w} は 目を 覚ました！`)];
        if (a[1] === 'frz') return [L(`${w} の こおりが 溶けた！`)];
        return [L(`${w} の ${esc(STATUS_JA[a[1]] || a[1])}が 治った！`)];
      case '-cureteam': return [L(`${sideWord(a[0])}の 状態異常が 治った！`)];
      case '-boost': return [L(boostText(w, a[1], +a[2], true))];
      case '-unboost': return [L(boostText(w, a[1], +a[2], false))];
      case '-setboost': return [L(a[1] === 'atk' && +a[2] === 6 ? `${w} は 体力を 削って パワー全開！` : `${w} の ${esc(BOOST_JA[a[1]] || a[1])}が 変化した！`)];
      case '-clearboost': return [L(`${w} の 能力変化が 元に 戻った！`)];
      case '-clearallboost': return [L('すべての ポケモンの 能力変化が 元に 戻った！')];
      case '-clearnegativeboost': return [L(`${w} の 下がった 能力が 元に 戻った！`)];
      case '-clearpositiveboost': return [L(`${w} の 上がった 能力が 元に 戻った！`)];
      case '-copyboost': case '-swapboost': case '-invertboost': return [L(`${w} の 能力変化が 変わった！`)];
      case '-weather': {
        const id = toID(a[0]);
        if ('upkeep' in kw) return [];
        if (id === 'none') { const x = WEATHER[B.lastWeather]; B.lastWeather = ''; return x ? [L(x[2])] : []; }
        B.lastWeather = id;
        const x = WEATHER[id];
        const out = [];
        if (kw.from && /^ability:/.test(kw.from)) out.push(L(`〔${kw.of ? nm(kw.of) : ''} の ${esc(jaAbil(kw.from.slice(8)))}〕`, 'abil'));
        out.push(L(x ? x[1] : `${esc(a[0])}`));
        return out;
      }
      case '-fieldstart': {
        const id = toID(String(a[0]).replace(/^move:\s?/, ''));
        if (id === 'trickroom' && kw.of) return [L(`${nm(kw.of)} は 時空を ゆがめた！`)];
        return [L(FIELD_START[id] || `${esc(effectJa(a[0]))}が 始まった！`)];
      }
      case '-fieldend': {
        const id = toID(String(a[0]).replace(/^move:\s?/, ''));
        return [L(FIELD_END[id] || `${esc(effectJa(a[0]))}の 効果が 切れた！`)];
      }
      case '-sidestart': {
        const id = toID(String(a[1]).replace(/^move:\s?/, '')), f = SIDE_START[id];
        return [L(f ? f(sideWord(a[0])) : `${sideWord(a[0])}の 場に ${esc(effectJa(a[1]))}が 発生した！`)];
      }
      case '-sideend': return [L(`${sideWord(a[0])}の ${esc(effectJa(a[1]))}が なくなった！`)];
      case '-swapsideconditions': return [L('おたがいの 場の 効果が 入れ替わった！')];
      case '-crit': return [L(dbl ? `${w} に 急所に 当たった！` : '急所に 当たった！')];
      case '-supereffective': return [L(dbl ? `${w} に 効果は バツグンだ！` : '効果は バツグンだ！')];
      case '-resisted': return [L(dbl ? `${w} に 効果は いまひとつの ようだ…` : '効果は いまひとつの ようだ…')];
      case '-immune': {
        const out = [];
        if (kw.from && /^ability:/.test(kw.from)) out.push(L(`〔${w} の ${esc(jaAbil(kw.from.slice(8)))}〕`, 'abil'));
        return out.concat([L(`${w} には 効果が ないようだ…`)]);
      }
      case '-miss': return [L(a[1] ? `${nm(a[1])} には 当たらなかった！` : `${w} の 攻撃は 外れた！`)];
      case '-fail': return [L('しかし うまく 決まらなかった！')];
      case '-block': return [L(`${w} は ${esc(effectJa(a[1]))}で 守られている！`)];
      case '-notarget': return [L('しかし 相手が いなかった！')];
      case '-hitcount': return [L(`${esc(a[1])}回 当たった！`)];
      case '-ohko': return [L('一撃必殺！')];
      case 'swap': return [L(`${w} は 場所を 入れ替えた！`)];
      case '-activate': {
        const eff = String(a[1] || ''), id = toID(eff.replace(/^(move|ability|item):\s?/, ''));
        if (PROTECTS.has(id)) return [L(`${w} は 攻撃から 身を 守った！`)];
        if (id === 'substitute') return [L(`分身が ${w} の 身代わりに なった！`)];
        if (id === 'confusion') return [L(`${w} は 混乱している！`)];
        if (/^ability:/.test(eff)) return [L(`〔${w} の ${esc(jaAbil(eff.slice(8)))}〕`, 'abil')];
        if (/^item:/.test(eff)) return [L(`${w} の ${esc(jaItem(eff.slice(5)))}が 発動した！`)];
        if (id === 'trapped') return [L(`${w} は もう 逃げられない！`)];
        if (ACTIVATE[id]) return [L(ACTIVATE[id](w))];
        if (/^move:/.test(eff) && ['bind', 'wrap', 'firespin', 'whirlpool', 'sandtomb', 'infestation', 'magmastorm', 'clamp', 'snaptrap', 'thundercage'].includes(id)) {
          return [L(`${w} は ${esc(jaMove(eff.slice(5)))}に とらわれた！`)];
        }
        B.unknown.add('-activate:' + id);
        return [L(`${w}：${esc(effectJa(eff))}`, 'raw')];
      }
      case '-singleturn': {
        const id = toID(String(a[1]).replace(/^move:\s?/, ''));
        if (PROTECTS.has(id)) return [L(`${w} は 守りの 体勢に 入った！`)];
        if (id === 'followme' || id === 'ragepowder' || id === 'spotlight') return [L(`${w} は 注目の まとに なった！`)];
        if (id === 'helpinghand') return [L(`${w} は ${kw.of ? nm(kw.of) : '味方'} を 手助けする 体勢に 入った！`)];
        if (SINGLETURN[id]) return [L(SINGLETURN[id](w))];
        B.unknown.add('-singleturn:' + id);
        return [L(`${w}：${esc(effectJa(a[1]))}`, 'raw')];
      }
      case '-singlemove': return [L(`${w} は ${esc(effectJa(a[1]))}の 体勢に 入った！`)];
      case '-start': {
        const eff = String(a[1] || ''), id = toID(eff.replace(/^(move|ability|item):\s?/, ''));
        if (START[id]) return [L(START[id](w, a[2]))];
        if (/^(protosynthesis|quarkdrive)/.test(id)) return [L(`${w} の ${esc(BOOST_JA[id.replace(/^(protosynthesis|quarkdrive)/, '')] || '')}が 高まった！`)];
        if (/^fallen\d$/.test(id)) return [L(`${w} は 倒れた 仲間 ${id.slice(6)}匹の 思いを 力に 変えた！`)];
        B.unknown.add('-start:' + id);
        return [L(`${w}：${esc(effectJa(eff))}`, 'raw')];
      }
      case '-end': {
        const eff = String(a[1] || ''), id = toID(eff.replace(/^(move|ability|item):\s?/, ''));
        if (END[id]) return [L(`${w} の ${END[id]}！`)];
        if (/^(protosynthesis|quarkdrive)/.test(id)) return [];
        return [L(`${w} の ${esc(effectJa(eff))}の 効果が 切れた！`)];
      }
      case '-item': {
        const it = esc(jaItem(a[1])), from = toID(kw.from || '');
        if (/trick|switcheroo/.test(from)) return [L(`${w} は ${it}を 手に入れた！`)];
        if (/frisk/.test(from)) return [L(`${kw.of ? nm(kw.of) : ''} は ${w} の ${it}を おみとおしした！`)];
        return [L(`${w} は ${it}を 持っている`)];
      }
      case '-enditem': {
        const id = toID(a[1]), it = esc(jaItem(a[1])), from = toID(kw.from || '');
        if ('eat' in kw) return [L(`${w} は ${it}を 食べた！`)];
        if (id === 'focussash') return [L(`${w} は ${it}で 持ちこたえた！`)];
        if (id === 'airballoon') return [L(`${w} の ${it}が 割れた！`)];
        if (/knockoff/.test(from)) return [L(`${kw.of ? nm(kw.of) : ''} は ${w} の ${it}を はたき落とした！`)];
        if (from === 'stealeat') return [L(`${kw.of ? nm(kw.of) : ''} は ${w} の ${it}を 食べた！`)];
        if (/herb$/.test(id)) return [L(`${w} は ${it}で 元の 状態に 戻った！`)];
        if (id === 'boosterenergy') return [L(`${w} は ${it}を 使った！`)];
        return [L(`${w} の ${it}が なくなった！`)];
      }
      case '-ability': {
        const id = toID(a[1]);
        if (id === 'pressure') return [L(`〔${w} の ${esc(jaAbil(a[1]))}〕`, 'abil'), L(`${w} は プレッシャーを 放っている！`)];
        return [L(`〔${w} の ${esc(jaAbil(a[1]))}〕`, 'abil')];
      }
      case '-transform': return [L(`${w} は ${nm(a[1])} に へんしんした！`)];
      case '-mega': return [L(`${w} は メガシンカした！`, 'me')];
      case '-terastallize': return [L(`${w} は テラスタルして ${esc(jaType(a[1]))}タイプに なった！`, 'me')];
      case '-prepare': return [L(`${w} は 力を ためている！`)];
      case 'cant': {
        const id = toID(String(a[1] || '').replace(/^(move|ability):\s?/, ''));
        if (CANT[id]) return [L(CANT[id](w))];
        return [L(a[2] ? `${w} は ${esc(jaMove(a[2]))}を 出せない！` : `${w} は 動けない！`)];
      }
      case '-message': return [L(esc(a[0]), 'raw')];
      case 'win': B.over = true; B.winner = a[0]; return [L(a[0] === 'あなた' ? 'あなたの 勝ち！' : '相手の 勝ち！', 'end')].concat(B.picks || []);
      case 'tie': B.over = true; B.winner = ''; return [L('引き分け', 'end')].concat(B.picks || []);
      case 'error': return [L(esc(a.join('|')), 'err')];
      default:
        if (SKIP.has(cmd)) return [];
        B.unknown.add(cmd);
        return [L(`（${esc(cmd.replace(/^-/, ''))} ${a.map(x => esc(jaAny(identName(x)))).join(' ')}）`, 'raw')];
    }
  }
  function onLog(chunk) {
    const items = [];
    for (const line of chunk.split('\n')) {
      if (line[0] !== '|') continue;
      const parts = line.slice(1).split('|'), cmd = parts[0], args = [], kw = {};
      for (const x of parts.slice(1)) {
        const m = /^\[(\w+)\]\s?(.*)$/.exec(x);
        if (m) kw[m[1]] = m[2]; else args.push(x);
      }
      if (B.headless) { simLine(cmd, args, kw); continue; }
      try { for (const it of fmtLine(cmd, args, kw)) items.push(it); }
      catch (e) { B.errors.push(String(e)); items.push({ cls: 'err', html: esc(line) }); }
    }
    if (!B.headless) { appendLog(items); renderField(); }
    scheduleCmd();
  }
  function appendLog(items) {
    const ol = $('b-log');
    if (!ol || !items.length) return;
    for (const it of items) B.text.push(it.html.replace(/<[^>]+>/g, ''));
    ol.insertAdjacentHTML('beforeend', items.map((it, k) => `<li class="new ${it.cls}" style="animation-delay:${Math.min(k, 12) * 40}ms">${it.html}</li>`).join(''));
    const box = $('b-logbox');
    box.scrollTop = box.scrollHeight;
  }

  // ---- 場の表示（Showdown の battle オブジェクトから読む） -----------------
  function typesOf(p) {
    const t = p.terastallized && p.terastallized !== 'Stellar' ? [p.terastallized] : p.types;
    return t.map(typeIdx);
  }
  function pkCard(p, sid) {
    if (!p) return '<div class="pk"></div>';
    const exact = sid === 'p1' || !B.cpu.p2 || AUTOTEST;
    const pc = pct(p.hp, p.maxhp);
    const bst = Object.entries(p.boosts).filter(([, v]) => v).map(([k, v]) => `<span class="bst ${v > 0 ? 'up' : 'down'}">${BOOST_SHORT[k] || k}${v > 0 ? '+' : ''}${v}</span>`).join('');
    const badges = (p.terastallized ? `<span class="badge">テラス ${esc(jaType(p.terastallized))}</span>` : '') + (p.species.isMega ? '<span class="badge">メガ</span>' : '');
    return `<div class="pk${p.fainted ? ' fnt' : ''}"><div class="l1"><span class="nm">${esc(p.name)}</span>` +
      `<span class="tts">${typesOf(p).map(tt).join('')}</span></div><div class="hpbar"><i class="${pc > 50 ? '' : pc > 20 ? 'mid' : 'lo'}" style="width:${pc}%"></i></div>` +
      `<div class="l3"><span class="hpt">${exact ? `${p.hp}/${p.maxhp}` : `${pc}%`}</span>${p.status ? `<span class="st ${p.status}">${STATUS_JA[p.status] || p.status}</span>` : ''}${badges}${bst}</div></div>`;
  }
  const cond = (name, dur) => `<span class="cond">${esc(name)}${dur ? ` 残り${dur}` : ''}</span>`;
  function renderField() {
    if (B && B.headless) return;
    const el = $('b-field'), b = B && B.stream.battle;
    if (!el || !b || !b.p1 || !b.p2) return;
    $('b-turn').textContent = b.turn ? `ターン ${b.turn}` : '';
    if (!b.started || !b.p1.active[0]) { el.innerHTML = '<p class="waiting">選出を 待っています…</p>'; return; }
    const block = (side, sid) => {
      const balls = side.pokemon.map(p => `<i class="${p.fainted ? 'fnt' : p.isActive ? 'on' : ''}"></i>`).join('');
      const sc = Object.keys(side.sideConditions).map(id => { const s = side.sideConditions[id]; return cond(jaMove(id) + (s.layers > 1 ? `×${s.layers}` : ''), s.duration); }).join('');
      const head = `<div class="sidehead">${sid === 'p1' ? 'あなた' : '相手'}<span class="balls" aria-label="残り${side.pokemon.filter(p => !p.fainted).length}匹">${balls}</span><span class="conds">${sc}</span></div>`;
      const grid = `<div class="side${side.active.length > 1 ? ' two' : ''}">${side.active.map(p => pkCard(p, sid)).join('')}</div>`;
      return sid === 'p2' ? head + grid : grid + head;
    };
    const fc = [];
    const wid = b.field.weather;
    if (wid) fc.push(cond(WEATHER[wid] ? WEATHER[wid][0] : wid, b.field.weatherState.duration));
    if (b.field.terrain) fc.push(cond(jaMove(b.field.terrain), b.field.terrainState.duration));
    for (const id in b.field.pseudoWeather) fc.push(cond(jaMove(id), b.field.pseudoWeather[id].duration));
    el.innerHTML = block(b.p2, 'p2') + `<div class="fieldline">${fc.join('')}</div>` + block(b.p1, 'p1');
  }

  // ---- コマンド入力 ---------------------------------------------------------
  const whoLabel = side => (B.cpu.p2 ? '' : `<span class="who">${side === 'p1' ? 'あなた（p1）' : '相手（p2）'}の番</span>`);
  function renderCmd() {
    if (!B) return;
    if (B.headless) {                        // 連戦：CPU の選択だけを進める
      for (const side of ['p1', 'p2']) {
        if (!B.over && actionable(B.req[side]) && !B.done[side]) {
          const req = B.req[side], had = B.err[side], sess = B;
          B.done[side] = true;
          setTimeout(() => { if (B === sess && !sess.over) sess.ps[side].write(had ? 'default' : cpuChoice(side, req)); }, 0);
        }
      }
      return;
    }
    const el = $('b-cmd');
    if (!el) return;
    if (B.over) {
      el.innerHTML = `<div class="result"><div class="big">${B.winner === 'あなた' ? 'あなたの勝ち！' : B.winner ? '相手の勝ち…' : '引き分け'}</div>` +
        '<div class="opts" style="justify-content:center"><button type="button" class="btn ink" data-act="again">同じチームでもう一度</button>' +
        '<button type="button" class="btn" data-act="setup">ルール・チームに戻る</button><button type="button" class="btn" data-act="copylog">ログをコピー</button></div><p class="fine" id="copy-note"></p></div>';
      return;
    }
    for (const side of ['p1', 'p2']) {
      if (B.cpu[side] && actionable(B.req[side]) && !B.done[side]) {
        const req = B.req[side], had = B.err[side], sess = B;
        B.done[side] = true;
        setTimeout(() => { if (B === sess && !sess.over) sess.ps[side].write(had ? 'default' : cpuChoice(side, req)); }, AUTOTEST ? 0 : 350);
      }
    }
    const side = ['p1', 'p2'].find(s => !B.cpu[s] && actionable(B.req[s]) && !B.done[s]);
    if (!side) { el.innerHTML = `<p class="waiting">${B.done.p1 || B.cpu.p1 ? '相手が 行動を 選んでいます…' : '…'}</p>`; return; }
    const req = B.req[side];
    if (!B.ui || B.ui.side !== side) B.ui = { side, req, slot: 0, parts: [], mega: false, tera: false, megaUsed: false, teraUsed: false, mode: 'main', mv: 0, order: [] };
    const ui = B.ui;
    const err = B.err[side] ? `<p class="problems">その行動は 選べません：${esc(B.err[side].replace(/^\[[^\]]+\]\s*/, ''))}</p>` : '';
    if (req.teamPreview) { el.innerHTML = err + cmdPreview(ui); return; }
    advance(ui);
    if (ui.slot >= slotCount(ui.req)) { submit(side, ui.parts.join(', ')); return; }
    el.innerHTML = err + (req.forceSwitch ? cmdSwitch(ui, true) : ui.mode === 'switch' ? cmdSwitch(ui, false) : ui.mode === 'target' ? cmdTarget(ui) : cmdMove(ui));
  }
  const slotCount = req => (req.forceSwitch ? req.forceSwitch.length : req.active.length);
  function advance(ui) {
    const req = ui.req;
    while (ui.slot < slotCount(req)) {
      const info = req.side.pokemon[ui.slot];
      let skip;
      if (req.forceSwitch) {
        // 出せる控えが残っていない枠は「交代なし」（ダブルで2匹が同時に倒れ、控えが1匹だけのときなど）
        const chosen = new Set(ui.parts.filter(x => x.startsWith('switch ')).map(x => +x.slice(7)));
        const left = req.side.pokemon.filter((q, k) => !q.active && !/ fnt$/.test(q.condition) && !chosen.has(k + 1)).length;
        skip = !req.forceSwitch[ui.slot] || left === 0;
      } else skip = !req.active[ui.slot] || !info || / fnt$/.test(info.condition) || info.commanding;
      if (!skip) break;
      ui.parts.push('pass');
      ui.slot++;
    }
  }
  function cmdPreview(ui) {
    const req = ui.req, n = B.f.pick, foe = B.teams[ui.side === 'p1' ? 'p2' : 'p1'], G = GD[B.game];
    const foeHTML = foe.map(s => { const sp = G.byPs.get(s.sp); return `<span>${tts(sp)}${esc(sp[SP_DISP])}</span>`; }).join('');
    const mine = req.side.pokemon.map((p, k) => {
      const ord = ui.order.indexOf(k + 1) + 1, sp = G.byPs.get(p.details.split(',')[0]) || G.byId.get(toID(p.details.split(',')[0]));
      return `<button type="button" class="pvb" data-pv="${k + 1}" aria-pressed="${ord > 0}">${ord ? `<span class="ord">${ord}</span>` : ''}` +
        `<span class="nm">${sp ? tts(sp) : ''} ${esc(sp ? sp[SP_DISP] : identName(p.ident))}</span><span class="it">${p.item ? esc(jaItem(p.item)) : '持ち物なし'}</span></button>`;
    }).join('');
    return `<p class="q">選出する ${n}匹を、出す順に タップ${whoLabel(ui.side)}</p><p class="fine" style="margin:0 0 6px">相手のチーム</p><div class="pvfoe">${foeHTML}</div>` +
      `<p class="fine" style="margin:8px 0 6px">${B.f.gameType === 'doubles' ? '最初の2匹が 先発です' : '最初の1匹が 先発です'}</p><div class="pv">${mine}</div>` +
      `<div class="opts"><button type="button" class="btn ink" data-act="pvgo"${ui.order.length === n ? '' : ' disabled'}>この順で決定</button>` +
      '<button type="button" class="btn" data-act="pvclear">選び直す</button></div>';
  }
  function effOf(moveType, target) {
    if (!target) return '';
    const types = target.terastallized && target.terastallized !== 'Stellar' ? [target.terastallized] : target.types;
    try {
      if (!PSEngine.Dex.getImmunity(moveType, types)) return '<span class="eff none">効果なし</span>';
      const e = PSEngine.Dex.getEffectiveness(moveType, types);
      return e > 0 ? '<span class="eff good">ばつぐん</span>' : e < 0 ? '<span class="eff bad">いまひとつ</span>' : '';
    } catch (err) { return ''; }
  }
  function moveInfo(id) {
    const m = mById.get(id);
    if (m) return { name: m[MV_JA], type: m[MV_TYPE], cat: m[MV_CAT], en: TYPES[m[MV_TYPE]][0] };
    const d = PSEngine.Dex.moves.get(id);
    return { name: jaMove(d.name) || d.name, type: typeIdx(d.type), cat: d.category === 'Status' ? 0 : d.category === 'Physical' ? 1 : 2, en: d.type };
  }
  function cmdMove(ui) {
    const req = ui.req, i = ui.slot, act = req.active[i], info = req.side.pokemon[i], b = B.stream.battle;
    const foe = b[ui.side].foe.active, single = B.f.gameType !== 'doubles';
    const moves = act.moves.map((m, j) => {
      const mi = moveInfo(m.id);
      const eff = single && mi.cat ? effOf(mi.en, foe[0]) : '';
      return `<button type="button" class="mvb" data-mv="${j + 1}"${m.disabled ? ' disabled' : ''}>${tt(mi.type)}<span class="nm">${esc(mi.name)}</span>` +
        `<span class="sub">${m.pp != null ? `PP ${m.pp}/${m.maxpp}` : ''}${eff}</span></button>`;
    }).join('');
    const opts = [];
    if (act.canMegaEvo && !ui.megaUsed) opts.push(`<button type="button" class="btn tgl" data-act="mega" aria-pressed="${ui.mega}">メガシンカ</button>`);
    if (act.canTerastallize && !ui.teraUsed) opts.push(`<button type="button" class="btn tgl" data-act="tera" aria-pressed="${ui.tera}">テラスタル（${esc(jaType(act.canTerastallize))}）</button>`);
    const bench = req.side.pokemon.some((p, k) => !p.active && !/ fnt$/.test(p.condition) && !ui.parts.includes(`switch ${k + 1}`));
    if (!act.trapped && bench) opts.push('<button type="button" class="btn" data-act="toswitch">交代</button>');
    if (ui.parts.some(p => p !== 'pass')) opts.push('<button type="button" class="btn" data-act="redo">最初から選び直す</button>');
    return `<p class="q">${esc(identName(info.ident))} は どうする？${whoLabel(ui.side)}</p><div class="moves">${moves}</div><div class="opts">${opts.join('')}</div>`;
  }
  function targetOptions(ui, tgt) {
    const b = B.stream.battle, me = b[ui.side], foe = me.foe, i = ui.slot, allyK = 1 - i, ally = me.active[allyK];
    const out = [];
    if (['normal', 'any', 'adjacentFoe'].includes(tgt)) [0, 1].forEach(k => { const p = foe.active[k]; if (p && !p.fainted) out.push({ t: k + 1, p, foe: true }); });
    if (['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf'].includes(tgt) && ally && !ally.fainted) out.push({ t: -(allyK + 1), p: ally, foe: false });
    if (tgt === 'adjacentAllyOrSelf') out.push({ t: -(i + 1), p: me.active[i], foe: false, self: true });
    return out;
  }
  function cmdTarget(ui) {
    const act = ui.req.active[ui.slot], m = act.moves[ui.mv - 1], mi = moveInfo(m.id);
    const opts = targetOptions(ui, m.target).map(o => `<button type="button" class="benchb" data-tg="${o.t}"><span class="nm">${o.self ? '自分' : (o.foe ? '相手の ' : '味方の ') + esc(o.p.name)}</span>` +
      `<span class="hpt">${o.foe && mi.cat ? effOf(mi.en, o.p) || 'ふつう' : ''}</span></button>`).join('');
    return `<p class="q">${esc(mi.name)} を だれに？${whoLabel(ui.side)}</p><div class="benches">${opts}</div><div class="opts"><button type="button" class="btn" data-act="tomain">技を選び直す</button></div>`;
  }
  function cmdSwitch(ui, forced) {
    const req = ui.req, chosen = new Set(ui.parts.filter(p => p.startsWith('switch ')).map(p => +p.slice(7)));
    const list = req.side.pokemon.map((p, k) => ({ p, k: k + 1 })).filter(({ p, k }) => !p.active && !/ fnt$/.test(p.condition) && !chosen.has(k));
    const btns = list.map(({ p, k }) => {
      const c = p.condition.split(' '), st = c[1] ? STATUS_JA[c[1]] || c[1] : '';
      const G = GD[B.game], spn = p.details.split(',')[0], sp = G.byPs.get(spn) || G.byId.get(toID(spn));
      return `<button type="button" class="benchb" data-sw="${k}"><span class="nm">${sp ? tts(sp) + ' ' : ''}${esc(identName(p.ident))}</span><span class="hpt">HP ${esc(c[0])}${st ? '・' + esc(st) : ''}</span></button>`;
    }).join('');
    const q = forced ? `${esc(identName(req.side.pokemon[ui.slot].ident))} の 代わりに だれを 出す？` : `${esc(identName(req.side.pokemon[ui.slot].ident))} と 交代する ポケモンは？`;
    return `<p class="q">${q}${whoLabel(ui.side)}</p><div class="benches">${btns || '<p class="fine">交代できる ポケモンが いません</p>'}</div>` +
      (forced ? '' : '<div class="opts"><button type="button" class="btn" data-act="tomain">技を選ぶ</button></div>');
  }
  function onCmdClick(e) {
    if (!B) return;
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const ui = B.ui, act = t.dataset.act;
    if (act === 'again') { startBattle(); return; }
    if (act === 'setup') { B = null; location.hash = '#/b'; return; }
    if (act === 'copylog') {
      const text = B.text.join('\n');
      const note = $('copy-note');
      copyText(text).then(ok => { note.textContent = ok ? 'ログをコピーしました' : 'コピーできませんでした。ログを長押しして選択してください。'; });
      return;
    }
    if (!ui) return;
    if (t.dataset.pv) {
      const k = +t.dataset.pv, at = ui.order.indexOf(k);
      if (at >= 0) ui.order.splice(at, 1); else if (ui.order.length < B.f.pick) ui.order.push(k);
      renderCmd(); return;
    }
    if (act === 'pvclear') { ui.order = []; renderCmd(); return; }
    if (act === 'pvgo') {
      const rest = ui.req.side.pokemon.map((p, k) => k + 1).filter(k => !ui.order.includes(k));
      submit(ui.side, 'team ' + ui.order.concat(rest).join(''));
      return;
    }
    if (act === 'mega') { ui.mega = !ui.mega; if (ui.mega) ui.tera = false; renderCmd(); return; }
    if (act === 'tera') { ui.tera = !ui.tera; if (ui.tera) ui.mega = false; renderCmd(); return; }
    if (act === 'toswitch') { ui.mode = 'switch'; renderCmd(); return; }
    if (act === 'tomain') { ui.mode = 'main'; renderCmd(); return; }
    if (act === 'redo') { B.ui = null; renderCmd(); return; }
    const finish = choice => { ui.parts.push(choice); ui.slot++; ui.mode = 'main'; ui.mega = false; ui.tera = false; renderCmd(); };
    if (t.dataset.sw) { finish('switch ' + t.dataset.sw); return; }
    const suffix = () => {
      if (ui.mega) { ui.megaUsed = true; return ' mega'; }
      if (ui.tera) { ui.teraUsed = true; return ' terastallize'; }
      return '';
    };
    if (t.dataset.mv) {
      const j = +t.dataset.mv, m = ui.req.active[ui.slot].moves[j - 1];
      if (B.f.gameType === 'doubles' && ['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf'].includes(m.target)) {
        const opts = targetOptions(ui, m.target);
        if (opts.length > 1) { ui.mv = j; ui.mode = 'target'; renderCmd(); return; }
        if (opts.length === 1) { finish(`move ${j} ${opts[0].t}${suffix()}`); return; }
      }
      finish(`move ${j}${suffix()}`);
      return;
    }
    if (t.dataset.tg) { finish(`move ${ui.mv} ${t.dataset.tg}${suffix()}`); }
  }

  // ---- CPU（技の威力・タイプ相性・場の状況で行動を選ぶ簡単なもの） ------------
  const ABSORB = { Ground: ['levitate', 'eartheater'], Water: ['waterabsorb', 'stormdrain', 'dryskin'], Electric: ['voltabsorb', 'lightningrod', 'motordrive'],
    Fire: ['flashfire', 'wellbakedbody'], Grass: ['sapsipper'] };
  const boostMul = b => (b >= 0 ? (2 + b) / 2 : 2 / (2 - b));
  // ダメージの見積もり（相手の残りHPに対する割合。1 以上なら倒せる見込み）
  function estDmg(atk, def, type, phys, bp, o) {
    if (!def || def.fainted || !def.hp) return 0;
    const dex = B.stream.battle.dex;
    const types = def.terastallized && def.terastallized !== 'Stellar' ? [def.terastallized] : def.types;
    if (!dex.getImmunity(type, types)) return 0;
    if ((ABSORB[type] || []).includes(def.ability)) return 0;
    const eff = Math.pow(2, dex.getEffectiveness(type, types));
    const A = atk.storedStats[phys ? 'atk' : 'spa'] * boostMul(atk.boosts[phys ? 'atk' : 'spa']);
    const Dv = def.storedStats[phys ? 'def' : 'spd'] * boostMul(def.boosts[phys ? 'def' : 'spd']);
    const stab = atk.types.includes(type) || atk.terastallized === type ? 1.5 : 1;
    const f = B.stream.battle.field, w = f.weather, tn = f.terrain;
    let wm = 1, dm = 1;
    if (w === 'raindance' || w === 'primordialsea') wm = type === 'Water' ? 1.5 : type === 'Fire' ? 0.5 : 1;
    if (w === 'sunnyday' || w === 'desolateland') wm = type === 'Fire' ? 1.5 : type === 'Water' ? 0.5 : 1;
    if ((tn === 'electricterrain' && type === 'Electric') || (tn === 'grassyterrain' && type === 'Grass') || (tn === 'psychicterrain' && type === 'Psychic')) wm *= 1.3;
    if (w === 'sandstorm' && !phys && types.includes('Rock')) dm = 1.5;           // 砂あらし：いわタイプの とくぼう
    if (/snow/.test(w) && phys && types.includes('Ice')) dm = 1.5;                // ゆき：こおりタイプの ぼうぎょ
    const base = Math.floor(Math.floor((22 * bp * A) / (Dv * dm)) / 50) + 2;
    return (base * stab * eff * wm * (o.spread ? 0.75 : 1) * (o.hits || 1) * (o.acc == null ? 1 : o.acc) * 0.925) / def.hp;
  }
  function dmgFrac(atk, move, def, spread) {
    const hits = Array.isArray(move.multihit) ? (move.multihit[0] + move.multihit[1]) / 2 : move.multihit || 1;
    const frac = estDmg(atk, def, move.type, move.category === 'Physical', move.basePower || 60,
      { spread, hits, acc: move.accuracy === true ? 1 : move.accuracy / 100 });
    return Math.min(frac, 1) + (frac >= 1 ? 0.5 : 0);
  }
  // 相手の技は分からないので、タイプ一致・威力90の技を持っていると仮定して「受けるダメージ」を見積もる
  function threat(foe, me) {
    if (!foe || foe.fainted || !me || me.fainted) return 0;
    const phys = foe.storedStats.atk * boostMul(foe.boosts.atk) >= foe.storedStats.spa * boostMul(foe.boosts.spa);
    const types = [...new Set(foe.types.concat(foe.terastallized && foe.terastallized !== 'Stellar' ? [foe.terastallized] : []))];
    return Math.max(0, ...types.map(t => estDmg(foe, me, t, phys, 90, {})));
  }
  function effSpeed(p) {
    let v = p.storedStats.spe * boostMul(p.boosts.spe);
    if (p.status === 'par') v /= 2;
    if (p.side && p.side.sideConditions.tailwind) v *= 2;
    return v;
  }
  function bestOffense(mon, foes, usable) {
    const dex = B.stream.battle.dex;
    let best = 0;
    for (const ms of mon.moveSlots) {
      if (ms.pp <= 0 || (usable && !usable.has(ms.id))) continue;
      const mv = dex.moves.get(ms.id);
      if (mv.category === 'Status') continue;
      for (const f of foes) best = Math.max(best, dmgFrac(mon, mv, f, false));
    }
    return best;
  }
  // 相性の評価：与えるダメージ − 受けるダメージ ＋ すばやさの有利。交代で出るときは最初の1発を受ける分を引く
  function matchup(side, mon, entering, usable) {
    const b = B.stream.battle, foes = b[side].foe.active.filter(p => p && !p.fainted);
    if (!foes.length || !mon) return 0;
    const off = bestOffense(mon, foes, usable), thr = Math.min(1.2, Math.max(...foes.map(f => threat(f, mon))));
    const faster = foes.every(f => (effSpeed(mon) > effSpeed(f)) !== !!b.field.pseudoWeather.trickroom);
    let v = off - 0.8 * thr + (faster ? 0.15 : 0);
    if (faster && off >= 1) v += 0.4;         // 先に動いて倒せる
    if (!faster && thr >= 1) v -= 0.4;        // 先に倒されそう
    if (entering) v -= 0.5 * Math.min(thr, 1);
    return v + (0.15 * mon.hp) / mon.maxhp;
  }
  function benchOptions(side, req, used) {
    const mons = B.stream.battle[side].pokemon;
    return req.side.pokemon.map((p, k) => ({ p, k: k + 1, mon: mons[k] }))
      .filter(o => !o.p.active && !/ fnt$/.test(o.p.condition) && !used.has(o.k) && o.mon);
  }
  const SETUPS = new Set(['swordsdance', 'nastyplot', 'dragondance', 'calmmind', 'quiverdance', 'shellsmash', 'bulkup', 'irondefense', 'coil',
    'victorydance', 'tidyup', 'agility', 'rockpolish', 'shiftgear', 'curse', 'growth', 'workup', 'cosmicpower', 'amnesia', 'acidarmor', 'tailglow',
    'bellydrum', 'filletaway', 'clangoroussoul', 'noretreat', 'geomancy', 'howl']);
  const SPEEDUP = new Set(['dragondance', 'shellsmash', 'quiverdance', 'agility', 'rockpolish', 'shiftgear', 'tidyup']);
  const HEALS = new Set(['recover', 'roost', 'slackoff', 'softboiled', 'moonlight', 'morningsun', 'synthesis', 'shoreup', 'milkdrink', 'lifedew',
    'strengthsap', 'healorder', 'junglehealing', 'lunarblessing']);
  const SLEEP = new Set(['spore', 'sleeppowder', 'hypnosis', 'lovelykiss', 'darkvoid', 'sing', 'grasswhistle']);
  const avgSpeed = sd => { const a = sd.active.filter(p => p && !p.fainted); return a.length ? a.reduce((x, p) => x + effSpeed(p), 0) / a.length : 0; };
  function monBenefit(p, mode) {            // 対戦中のポケモンが、その天候・フィールドでどれだけ強くなるか
    return benefitOf(p.ability, p.types.map(typeIdx), new Set(p.moveSlots.map(m => m.id)), mode);
  }
  function modeMoveScore(side, mode) {      // 天候・フィールドを起こす技：味方がどれだけ得をするか
    const b = B.stream.battle, M = MODES[mode], me = b[side];
    const cur = M.kind === 'w' ? b.field.weather : b.field.terrain;
    if (cur === M.fid) return 0;
    const ben = me.pokemon.filter(p => !p.fainted).reduce((a, p) => a + monBenefit(p, mode), 0);
    return (ben >= 1.5 ? 0.75 : ben >= 0.8 ? 0.5 : ben >= 0.4 ? 0.25 : 0.05) + (cur ? 0.15 : 0);
  }
  function statusScore(side, slot, mon, move, target) {
    const b = B.stream.battle, id = move.id, dbl = B.f.gameType === 'doubles', me = b[side], foeSide = me.foe;
    const foes = foeSide.active.filter(p => p && !p.fainted), hpf = mon.hp / mon.maxhp, tr = !!b.field.pseudoWeather.trickroom;
    const thr = Math.max(0, ...foes.map(f => threat(f, mon)));
    const outsped = foes.some(f => (effSpeed(f) > effSpeed(mon)) !== tr);
    const danger = thr >= 1 && outsped;                       // この番に先に倒されそう
    const boosts = Object.values(mon.boosts).reduce((a, v) => a + Math.max(0, v), 0);
    // まもる：ダブルでは狙われそうなほど価値が高い（連続では使わない）
    if (PROTECTS.has(id)) return mon.volatiles.stall ? 0.02 : dbl ? 0.12 + 0.55 * Math.min(thr, 1) : 0.05 + 0.1 * Math.min(thr, 1);
    if (SETUPS.has(id)) return danger || hpf < 0.5 || boosts >= 2 ? 0.04 : 0.5 + 0.3 * (1 - Math.min(thr, 1)) + (SPEEDUP.has(id) && outsped ? 0.1 : 0);
    if (HEALS.has(id)) return danger ? 0.1 : (1 - hpf) * 1.2;
    if (id === 'rest') return mon.status && hpf < 0.6 ? 0.7 : hpf < 0.35 && !danger ? 0.5 : 0.02;
    if (id === 'trickroom') return tr ? -1 : avgSpeed(me) < avgSpeed(foeSide) ? 0.9 : 0.05;
    if (id === 'tailwind') return me.sideConditions.tailwind ? 0 : (avgSpeed(me) < avgSpeed(foeSide) ? 0.8 : 0.35) * (dbl ? 1 : 0.7);
    if (id === 'reflect' || id === 'lightscreen') return me.sideConditions[id] ? 0 : 0.5;
    if (id === 'auroraveil') return me.sideConditions.auroraveil || !/snow|hail/.test(b.field.weather) ? 0 : 0.7;
    if (MODE_BY_MOVE[id]) return modeMoveScore(side, MODE_BY_MOVE[id]);
    if (['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'].includes(id)) {
      const hz = foeSide.sideConditions[id];
      if ((hz && id !== 'spikes') || (hz && hz.layers >= 3)) return 0;
      return (dbl ? 0.2 : { stealthrock: 0.7, spikes: 0.45, toxicspikes: 0.35, stickyweb: 0.5 }[id]) * (b.turn <= 4 ? 1 : 0.5);
    }
    const ally = me.active[1 - slot];
    if (id === 'followme' || id === 'ragepowder' || id === 'spotlight') {
      return dbl && ally && !ally.fainted ? 0.3 + 0.35 * Math.min(1, Math.max(0, ...foes.map(f => threat(f, ally)))) : 0;
    }
    if (id === 'helpinghand') return dbl && ally && !ally.fainted ? 0.2 + 0.3 * Math.min(1, bestOffense(ally, foes)) : 0;
    const tgt = target && target.side !== me ? target : foes[0];
    if (!tgt) return 0.05;
    const tt2 = tgt.terastallized && tgt.terastallized !== 'Stellar' ? [tgt.terastallized] : tgt.types;
    if (SLEEP.has(id) || id === 'yawn') {
      if (tgt.status || (move.flags.powder && tt2.includes('Grass'))) return 0.02;
      return (id === 'yawn' ? 0.4 : 0.95) * (move.accuracy === true ? 1 : move.accuracy / 100);
    }
    if (id === 'willowisp') return tgt.status || tt2.includes('Fire') ? 0.02 : tgt.storedStats.atk >= tgt.storedStats.spa ? 0.75 : 0.3;
    if (id === 'thunderwave' || id === 'glare' || id === 'stunspore') {
      if (tgt.status || (id === 'thunderwave' && (tt2.includes('Electric') || tt2.includes('Ground')))) return 0.02;
      return effSpeed(tgt) > effSpeed(mon) ? 0.6 : 0.3;
    }
    if (id === 'toxic') return tgt.status || tt2.includes('Poison') || tt2.includes('Steel') ? 0.02 : dbl ? 0.25 : 0.45;
    if (id === 'leechseed') return tgt.volatiles.leechseed || tt2.includes('Grass') ? 0 : 0.4;
    if (id === 'haze' || id === 'clearsmog') return foes.reduce((a, f) => a + Object.values(f.boosts).reduce((x, v) => x + Math.max(0, v), 0), 0) >= 2 ? 0.75 : 0.03;
    if (id === 'encore') return tgt.lastMove && tgt.lastMove.category === 'Status' ? 0.6 : 0.08;
    if (id === 'taunt') return 0.2;
    if (id === 'partingshot' || id === 'teleport') return matchup(side, mon, false) < -0.2 ? 0.5 : 0.12;
    if (id === 'substitute') return hpf > 0.6 && !danger ? 0.3 : 0.02;
    if (id === 'destinybond') return danger ? 0.6 : 0.02;
    if (id === 'wideguard' || id === 'quickguard') return dbl ? 0.15 : 0;
    return 0.12;
  }
  function scoreMove(side, slot, mon, move, t) {
    const b = B.stream.battle, foes = b[side].foe.active, allies = b[side].active, dbl = B.f.gameType === 'doubles';
    const target = t == null ? foes.find(p => p && !p.fainted) : t > 0 ? foes[t - 1] : allies[-t - 1];
    if (move.category === 'Status') return statusScore(side, slot, mon, move, target);
    if (t != null && t < 0) return -1;
    let s = 0;
    if (dbl && (move.target === 'allAdjacentFoes' || move.target === 'allAdjacent')) {
      for (const p of foes) s += dmgFrac(mon, move, p, true);
      const ally = allies[1 - slot];
      if (move.target === 'allAdjacent' && ally && !ally.fainted) s -= 0.7 * dmgFrac(mon, move, ally, true);
    } else s = dmgFrac(mon, move, target, false);
    if (move.id === 'fakeout') { if (mon.activeMoveActions > 0) return 0; s += 0.35; }
    if (move.priority > 0 && s >= 1) s += 0.3;
    return s;
  }
  function cpuTargets(side, slot, tgt) {
    if (B.f.gameType !== 'doubles') return [null];
    const b = B.stream.battle, foe = b[side].foe.active;
    const foes = [0, 1].filter(k => foe[k] && !foe[k].fainted).map(k => k + 1);
    if (['normal', 'any', 'adjacentFoe'].includes(tgt)) return foes.length ? foes : [1];
    if (tgt === 'adjacentAlly') { const a = 1 - slot, ally = b[side].active[a]; return ally && !ally.fainted ? [-(a + 1)] : []; }
    if (tgt === 'adjacentAllyOrSelf') return [-(slot + 1)];
    return [null];
  }
  function bestBench(side, req, used) {       // 倒れたあとに出すポケモン：相手の場に対して相性の良い順
    const opts = benchOptions(side, req, used).map(o => ({ k: o.k, v: matchup(side, o.mon, false) })).sort((a, b) => b.v - a.v);
    return opts.length ? opts[0].k : null;
  }
  function cpuChoice(side, req) {
    try {
      if (req.teamPreview) {
        const n = B.f.pick, G = GD[B.game], M = effMatrix(), other = B.teams[side === 'p1' ? 'p2' : 'p1'];
        const typesOf2 = sp => [sp[SP_T1], sp[SP_T2]].filter(t => t >= 0);
        const oppT = other.map(x => G.byPs.get(x.sp)).filter(Boolean).map(typesOf2);
        const best = (atk, def) => Math.max(...atk.map(t => Math.min(2, def.reduce((m, d) => m * M[t][d], 1))));
        const idx = req.side.pokemon.map((p, k) => {
          const nm = p.details.split(',')[0], sp = G.byPs.get(nm) || G.byId.get(toID(nm));
          const my = sp ? typesOf2(sp) : [0];
          let v = 0;
          for (const ot of oppT) v += best(my, ot) - best(ot, my);       // こちらが抜群を取れるか − 抜群を取られるか
          return { k: k + 1, v: v / Math.max(1, oppT.length) + (sp ? sp[SP_ST].reduce((x, y) => x + y, 0) / 600 : 0) + Math.random() * 0.6 };
        }).sort((x, y) => y.v - x.v).map(x => x.k);
        // メガストーンを持つポケモンは選出に1匹以上・2匹まで（メガシンカは1回の対戦で1匹だけ）
        const isMega = k => { const p = req.side.pokemon[k - 1], it = iById.get(p.item); return !!(it && it[IT_MEGA] && it[IT_MEGA] === p.details.split(',')[0]); };
        const inPick = () => idx.slice(0, n).filter(isMega).length;
        if (!inPick()) { const j = idx.findIndex((k, i) => i >= n && isMega(k)); if (j >= 0) [idx[n - 1], idx[j]] = [idx[j], idx[n - 1]]; }
        while (inPick() > 2) {
          const a = idx.findIndex((k, i) => i < n && isMega(k)), b = idx.findIndex((k, i) => i >= n && !isMega(k));
          if (b < 0) break;
          [idx[a], idx[b]] = [idx[b], idx[a]];
        }
        return 'team ' + idx.join('');
      }
      if (req.forceSwitch) {
        const used = new Set();
        return req.forceSwitch.map(need => {
          if (!need) return 'pass';
          const k = bestBench(side, req, used);
          if (!k) return 'pass';
          used.add(k);
          return 'switch ' + k;
        }).join(', ');
      }
      const me = B.stream.battle[side], parts = [], switched = new Set();
      let mega = false, tera = false;
      req.active.forEach((act, i) => {
        const info = req.side.pokemon[i], mon = me.active[i];
        if (!mon || mon.fainted || / fnt$/.test(info.condition) || info.commanding) { parts.push('pass'); return; }
        const opts = [];
        act.moves.forEach((m, j) => {
          if (m.disabled) return;
          const move = B.stream.battle.dex.moves.get(m.id);
          for (const t of cpuTargets(side, i, m.target)) opts.push({ j: j + 1, t, s: scoreMove(side, i, mon, move, t) * (0.85 + Math.random() * 0.3) });
        });
        opts.sort((x, y) => y.s - x.s);
        // いまのポケモンより明らかに有利な控えがいれば交代する。前のターンに交代で出たばかりのポケモンは、すぐには戻さない
        if (!act.trapped && !act.maybeTrapped) {
          const usable = new Set(act.moves.filter(m => !m.disabled).map(m => m.id));
          const cur = matchup(side, mon, false, usable);
          const alt = benchOptions(side, req, switched).map(o => ({ k: o.k, mon: o.mon, v: matchup(side, o.mon, true) })).sort((a, b) => b.v - a.v)[0];
          const turn = B.stream.battle.turn, justIn = B.cpuIn[side + ':' + mon.name] === turn - 1;
          if (alt && alt.v - cur > 0.45 && !justIn && Math.random() < 0.85) {
            switched.add(alt.k);
            B.cpuIn[side + ':' + alt.mon.name] = turn;
            B.cpuStats.switches++;
            parts.push('switch ' + alt.k);
            return;
          }
        }
        B.cpuStats.moves++;
        if (opts.length && B.stream.battle.dex.moves.get(act.moves[opts[0].j - 1].id).category === 'Status') B.cpuStats.status++;
        let c = opts.length ? `move ${opts[0].j}${opts[0].t != null ? ' ' + opts[0].t : ''}` : 'move 1';
        if (act.canMegaEvo && !mega) { c += ' mega'; mega = true; }
        else if (act.canTerastallize && !tera && Math.random() < 0.5) { c += ' terastallize'; tera = true; }
        parts.push(c);
      });
      return parts.join(', ');
    } catch (e) {
      B.errors.push('cpu: ' + e);
      return 'default';
    }
  }

  // ---- 起動 ----------------------------------------------------------------
  function wire() {
    $('seg-game').addEventListener('click', e => { const b = e.target.closest('[data-game]'); if (b) { S.game = b.dataset.game; save(); renderSetup(); } });
    $('seg-rule').addEventListener('click', e => { const b = e.target.closest('[data-rule]'); if (b) { S.rule = b.dataset.rule; save(); renderSetup(); } });
    $('seg-cpu').addEventListener('click', e => { const b = e.target.closest('[data-cpu]'); if (b) { S.cpu = b.dataset.cpu === '1'; save(); renderSetup(); } });
    $('start').addEventListener('click', startBattle);
    $('teams').addEventListener('change', e => {
      const p = e.target.closest('[data-pickteam]');
      if (!p) return;
      selOf(S.game, S.rule)[p.dataset.pickteam] = p.value;
      save(); renderSetup();
    });
    V.team.addEventListener('input', e => {
      if (e.target.id !== 't-name') return;
      const tm = teamById((location.hash.match(/^#\/team\/([\w-]+)/) || [])[1]);
      if (tm) { tm.name = e.target.value.trim().slice(0, 40) || 'チーム'; save(); }
    });
    V.sim.addEventListener('change', e => { if (e.target.id === 'sim-team') { S.simTeam = e.target.value; save(); renderSim(); } });
    ROOT.addEventListener('click', e => {
      const ss = e.target.closest('[data-simn]');
      if (ss && !ss.disabled) { S.simN = +ss.dataset.simn; save(); renderSim(); return; }
      if (e.target.closest('#sim-go')) { if (SIM && SIM.running) SIM.cancel = true; else runSim(); return; }
      if (e.target.closest('[data-reroll]')) { S.autoUsed[key()] = true; save(); renderSetup(); return; }
      if (e.target.closest('[data-saveauto]')) {
        const t = addTeam(S.game, S.rule, uniqueName(`おまかせ（${ruleLabel(S.game, S.rule)}）`), JSON.parse(JSON.stringify(team('opp'))));
        selOf(S.game, S.rule).opp = t.id; save(); renderSetup(); return;
      }
      const nt = e.target.closest('[data-newteam]');
      if (nt) {
        const [g, r] = $('nt-rule').value.split('_'), kind = nt.dataset.newteam;
        const sets = kind === 'auto' ? autoTeam(g, r) : kind === 'sample' ? sampleTeam(g + '_' + r) : [];
        const t = addTeam(g, r, uniqueName(`${kind === 'auto' ? 'おまかせ' : kind === 'sample' ? 'サンプル' : '新しいチーム'}（${ruleLabel(g, r)}）`), sets);
        save(); location.hash = `#/team/${t.id}`; return;
      }
      const ut = e.target.closest('[data-useteam]');
      if (ut) { const t = teamById(ut.dataset.useteam); S.game = t.game; S.rule = t.rule; selOf(t.game, t.rule).you = t.id; save(); location.hash = '#/b'; return; }
      const sm = e.target.closest('[data-simteam]');
      if (sm) { S.simTeam = sm.dataset.simteam; save(); location.hash = '#/sim'; return; }
      const dp = e.target.closest('[data-dupteam]');
      if (dp) { const t = teamById(dp.dataset.dupteam), c = addTeam(t.game, t.rule, uniqueName(t.name + ' のコピー'), JSON.parse(JSON.stringify(t.sets))); save(); location.hash = `#/team/${c.id}`; return; }
      const at = e.target.closest('[data-autoteam]');
      if (at) { const t = teamById(at.dataset.autoteam); t.sets = autoTeam(t.game, t.rule); save(); renderTeam(t.id); return; }
      const dl = e.target.closest('[data-delteam]');
      if (dl) {
        if (dl.dataset.sure !== '1') { dl.dataset.sure = '1'; dl.textContent = '本当に削除する'; return; }
        S.teams = S.teams.filter(t => t.id !== dl.dataset.delteam); save(); location.hash = '#/teams'; return;
      }
      const pa = e.target.closest('[data-paste]');
      if (pa) { pasteImport(pa.dataset.paste); return; }
      const ct = e.target.closest('[data-copyteam]');
      if (ct) { copyTeam(ct.dataset.copyteam); return; }
      const im = e.target.closest('[data-import]');
      if (im) { importText(im.dataset.import); return; }
      const rm = e.target.closest('[data-remove]');
      if (rm) { const [tid, i] = rm.dataset.remove.split(':'); teamById(tid).sets.splice(+i, 1); save(); location.hash = `#/team/${tid}`; return; }
      const ch = e.target.closest('[data-choose]');
      if (ch && pickCtx) { choosePick(ch.dataset.choose); return; }
      const q = e.target.closest('[data-act="quit"]');
      if (q) {
        if (B && !B.over && q.dataset.sure !== '1') { q.dataset.sure = '1'; q.lastChild.textContent = '本当にやめる'; return; }
        B = null; location.hash = '#/b'; return;
      }
      if (e.target.closest('#b-cmd')) onCmdClick(e);
    });
    V.set.addEventListener('change', e => {
      const c = curSet();
      if (!c) return;
      if (e.target.id === 's-ab') c.set.ability = e.target.value;
      else if (e.target.id === 's-nat') c.set.nature = e.target.value;
      else if (e.target.id === 's-tera') c.set.tera = e.target.value;
      else return;
      save();
      $('s-stats').innerHTML = statsHTML(c.set, gd().byPs.get(c.set.sp));
    });
    V.set.addEventListener('input', e => {
      const c = curSet(), el = e.target;
      if (!c || !el.classList.contains('nin')) return;
      const n = parseInt(String(el.value).normalize('NFKC').replace(/[^0-9]/g, '') || '0', 10);
      if (el.dataset.iv != null) c.set.ivs[+el.dataset.iv] = Math.min(31, n);
      else if (el.dataset.ev != null) c.set.evs[+el.dataset.ev] = Math.min(LIMIT(S.game).max, n);
      save();
      const sp = gd().byPs.get(c.set.sp), [up, down] = natUD(c.set.nature), ch = gd().statPoints;
      const row = el.closest('tr'), i = +(el.dataset.iv != null ? el.dataset.iv : el.dataset.ev);
      row.querySelector('.out').textContent = calcStat(S.game, i, sp[SP_ST][i], 50, ch ? 31 : c.set.ivs[i], c.set.evs[i], up, down);
      const lim = LIMIT(S.game), tot = c.set.evs.reduce((a, b) => a + b, 0), tl = V.set.querySelector('.total');
      tl.className = 'total' + (tot > lim.total ? ' over' : '');
      tl.textContent = `${ch ? '能力ポイント' : '努力値'}の合計 ${tot} / ${lim.total}` + (tot > lim.total ? '（上限を超えています）' : `（残り ${lim.total - tot}）`);
    });
    V.set.addEventListener('focusout', e => {
      const el = e.target, c = curSet();
      if (!c || !el.classList.contains('nin')) return;
      el.value = el.dataset.iv != null ? c.set.ivs[+el.dataset.iv] : c.set.evs[+el.dataset.ev];
    });
    V.set.addEventListener('click', e => {
      if (e.target.closest('a.pickbtn')) { pickFromSet = true; return; }
      const b = e.target.closest('[data-step]');
      if (!b) return;
      const c = curSet(), i = +b.dataset.i;
      c.set.evs[i] = stepEV(c.set, gd().byPs.get(c.set.sp), i, +b.dataset.step);
      save();
      $('s-stats').innerHTML = statsHTML(c.set, gd().byPs.get(c.set.sp));
    });
    V.pick.addEventListener('input', e => { if (e.target.id === 'pick-q') renderPickList(e.target.value); });
    window.addEventListener('hashchange', route);
  }
  async function init() {
    for (const k of ['setup', 'teams', 'team', 'set', 'pick', 'battle', 'sim']) V[k] = $('v-' + k);
    try { buildIndex(await loadData()); } catch (err) {
      $('teams').innerHTML = '<p class="problems">データを展開できませんでした。ブラウザを最新版に更新してください。</p>';
      console.error(err);
      return;
    }
    load();
    if (AUTOTEST) S.cpu = true;
    $('ps-ver').textContent = 'コミット ' + String(D.ps.commit).slice(0, 7);
    $('fmt-names').textContent = ['ch', 'sv'].map(g => Object.values(D.games[g].formats).map(f => f.name).join('／')).join('／');
    wire();
    route();
    // 図鑑から使う窓口（同じページにまとめたとき）：チームの一覧・ポケモンを入れる・新しいチームを作る
    window.BT = {
      teams: () => S.teams.map(t => ({ id: t.id, name: t.name, game: t.game, rule: t.rule, label: ruleLabel(t.game, t.rule), count: t.sets.length })),
      usable: pid => ['ch', 'sv'].filter(g => !!findByPid(g, pid)),
      ruleLabel,
      add(tid, pid) {
        const t = teamById(tid);
        if (!t) return { ok: false, msg: 'チームが見つかりません' };
        const hit = findByPid(t.game, pid), G = GD[t.game];
        if (!hit) return { ok: false, msg: `${ruleLabel(t.game, t.rule)}では使えないポケモンです` };
        if (t.sets.length >= 6) return { ok: false, msg: `「${t.name}」にはもう6匹います` };
        if (t.sets.some(x => G.byPs.get(x.sp)[SP_NUM] === hit.sp[SP_NUM])) return { ok: false, msg: `「${t.name}」にはもう${hit.sp[SP_BASE]}がいます` };
        const used = new Set(t.sets.map(x => x.item).filter(Boolean)), dbl = t.rule === 'doubles';
        t.sets.push(makeSet(t.game, formOf(t.game, hit.sp, hit.mega, dbl), dbl, used));
        save();
        return { ok: true, id: t.id, msg: `「${t.name}」に${hit.mega ? hit.mega[MG_DISP] : hit.sp[SP_DISP]}を入れました（${t.sets.length}/6）` };
      },
      create(g, r) { const t = addTeam(g, r, uniqueName(`新しいチーム（${ruleLabel(g, r)}）`), []); save(); return t.id; },
    };
    document.documentElement.setAttribute('data-bt-ready', '1');
    if (AUTOTEST) {
      window.__bt = {
        start(game, rule) { S.game = game; S.rule = rule; startBattle(); },
        setRule(game, rule) { S.game = game; S.rule = rule; },
        fakeRequest(side, req) {       // 検証用：指定した要求を画面に出し、送った選択を記録する
          B.over = false; B.cpu.p1 = B.cpu.p2 = false; B.req.p1 = B.req.p2 = null;
          B.req[side] = req; B.done[side] = false; B.ui = null; B.err[side] = '';
          window.__sent = null; B.ps[side].write = c => { window.__sent = c; };
          renderCmd();
        },
        autoBoth() {
          const s = selOf(S.game, S.rule);
          teamById(s.you).sets = autoTeam(S.game, S.rule);
          s.opp = 'auto'; S.autoPrev[key()] = autoTeam(S.game, S.rule); S.autoUsed[key()] = false;
        },
        autoTeamCheck(game, rule) {
          const t = autoTeam(game, rule), G = GD[game], lim = LIMIT(game), fs = teamForms(t, game);
          const problems = [];
          const nums = new Set(t.map(s => G.byPs.get(s.sp)[SP_NUM])), items = t.map(s => s.item).filter(Boolean);
          if (t.length !== 6) problems.push('6匹でない');
          if (nums.size !== t.length) problems.push('同じポケモン');
          if (new Set(items).size !== items.length) problems.push('同じ持ち物');
          for (const s of t) {
            const sp = G.byPs.get(s.sp), legal = moveSet(game, sp);
            if (!s.moves.length || s.moves.length > 4 || new Set(s.moves).size !== s.moves.length) problems.push('技の数: ' + s.sp);
            if (s.moves.some(m => !legal.has(m))) problems.push('覚えない技: ' + s.sp);
            if (!abilIds(sp).includes(s.ability)) problems.push('特性: ' + s.sp);
            if (s.evs.some(v => v > lim.max) || s.evs.reduce((a, b) => a + b, 0) > lim.total) problems.push('能力の振り方: ' + s.sp);
            if (s.item && !G.itemSet.has(s.item)) problems.push('持ち物: ' + s.sp);
          }
          const megas = fs.filter(f => f.mega).length;
          if (G.megas.length && (megas < 1 || megas > 2)) problems.push('メガシンカの数: ' + megas);
          const roles = t.map(s => s.note);
          // 型と、技・性格が食い違っていないか（物理アタッカーは特殊技を持たない、など）
          t.forEach(s => {
            const cats = s.moves.map(id => mById.get(id)[MV_CAT]).filter(Boolean);
            const [up, down] = natUD(s.nature);
            if (/物理アタッカー/.test(s.note) && (cats.includes(2) || down === 1)) problems.push('物理なのに特殊: ' + s.sp);
            if (/特殊アタッカー/.test(s.note) && (cats.includes(1) || down === 3)) problems.push('特殊なのに物理: ' + s.sp);
            if (/すばやさ重視/.test(s.note) && (s.evs[5] !== lim.max || (up !== 5 && !/両刀/.test(s.note) && up !== 5))) problems.push('すばやさ: ' + s.sp);
          });
          const th = themeOf(t, game);
          return { problems, coverage: coverOf(fs).ratio, megas, roles, theme: th ? th.mode : '', packed: PSEngine.Teams.pack(t.map(s => toPS(s, game))) };
        },
        randomCoverage(game) {           // 比較用：ルール上使えるものから無作為に選んだ6匹の補完率
          const G = GD[game], sp = G.species.filter(s => !s[SP_NFE]).sort(() => Math.random() - 0.5), out = [], nums = new Set();
          for (const s of sp) { if (out.length === 6) break; if (nums.has(s[SP_NUM])) continue; nums.add(s[SP_NUM]); out.push({ t1: s[SP_T1], t2: s[SP_T2], ability: abilIds(s)[0] }); }
          return coverOf(out).ratio;
        },
        setStats(game, rule, n) {       // 検証用：おまかせの技のうち変化技の割合など
          let moves = 0, status = 0, withStatus = 0, sets = 0;
          for (let i = 0; i < n; i++) for (const x of autoTeam(game, rule)) {
            sets++; moves += x.moves.length;
            const k = x.moves.filter(id => mById.get(id)[MV_CAT] === 0).length;
            status += k; withStatus += k > 0;
          }
          return { statusRate: status / moves, setsWithStatus: withStatus / sets };
        },
        randomTeams() {
          const G = gd(), lim = LIMIT(S.game), pick = a => a[Math.floor(Math.random() * a.length)];
          const make = () => {
            const sp = G.species.slice().sort(() => Math.random() - 0.5), used = new Set(), items = new Set(), out = [];
            for (const s of sp) {
              if (out.length === 6) break;
              if (used.has(s[SP_NUM])) continue;
              used.add(s[SP_NUM]);
              const mv = [...moveSet(S.game, s)].sort(() => Math.random() - 0.5).slice(0, 4);
              let item = s[SP_REQ].length ? ITEMS[s[SP_REQ][0]][IT_ID] : pick(G.itemIds);
              if (items.has(item)) item = '';
              if (item) items.add(item);
              const evs = [0, 0, 0, 0, 0, 0];
              [pick([0, 1, 2]), pick([3, 4, 5])].forEach(k => { evs[k] = lim.max; });
              out.push({ sp: s[SP_PS], item, ability: pick(abilIds(s)), moves: mv, nature: pick(NATS)[0], evs, ivs: [31, 31, 31, 31, 31, 31],
                tera: G.tera ? TYPES[pick(TYPE_ORDER.concat([18]))][0] : '' });
            }
            return out;
          };
          const s = selOf(S.game, S.rule);
          teamById(s.you).sets = make();
          s.opp = 'auto'; S.autoPrev[key()] = make(); S.autoUsed[key()] = false;
        },
        state: () => (B ? { cpu: B.cpuStats, over: B.over, winner: B.winner, turn: B.stream.battle ? B.stream.battle.turn : 0, unknown: [...B.unknown], errors: B.errors.slice(), lines: B.text.length } : null),
      };
    }
  }
  init();
})();
