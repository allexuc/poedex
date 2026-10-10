(() => {
  'use strict';

  // ---- 配列レイアウト（etl/build_data.py の docstring と必ず一致させる。添字がずれても例外は出ない） ----
  const P_ID = 0, P_DEX = 1, P_NAME = 2, P_FORM = 3, P_IDENT = 4, P_T1 = 5, P_T2 = 6,
    P_A1 = 7, P_A2 = 8, P_AH = 9, P_ST = 10 /* 10..15 = H A B C D S */, P_HT = 16, P_WT = 17,
    P_GEN = 18, P_FLAGS = 19;
  const S_ID = 0, S_NAME = 1, S_KANA = 2, S_EN = 3, S_GENUS = 4, S_CAT = 6, S_CHAIN = 7,
    S_FROM = 8, S_LV = 9;
  const M_ID = 0, M_NAME = 1, M_KANA = 2, M_EN = 3, M_TYPE = 4, M_CLS = 5, M_POW = 6, M_ACC = 7,
    M_PP = 8, M_PRIO = 9, M_TGT = 10, M_GEN = 11, M_DESC = 12, M_SRC = 13, M_DESC_KANA = 14, M_EFF = 15;
  const A_ID = 0, A_NAME = 1, A_KANA = 2, A_EN = 3, A_DESC = 4, A_GEN = 5, A_SRC = 6, A_DESC_KANA = 7;
  const N_NAME = 1, N_UP = 2, N_DOWN = 3;
  const F_ALT = 1, F_MEGA = 2, F_BATTLE = 4;

  const GAMES = ['sv', 'ch'];
  const GAME_LABEL = { all: 'すべて', sv: 'SV', ch: 'チャンピオンズ' };
  const GAME_FULL = { sv: 'スカーレット・バイオレット', ch: 'Pokémon Champions' };
  const STAT_KEYS = ['H', 'A', 'B', 'C', 'D', 'S'];
  const STAT_NAMES = ['HP', 'こうげき', 'ぼうぎょ', 'とくこう', 'とくぼう', 'すばやさ'];
  // ゲーム内の並び順（値は types の添字）
  const TYPE_ORDER = [0, 9, 10, 12, 11, 14, 1, 3, 4, 2, 13, 6, 5, 7, 15, 16, 8, 17];
  const CLS_NAME = { 1: '変化', 2: '物理', 3: '特殊' };
  const TARGET = {
    1: '不定', 2: '選んだ1体', 3: '味方1体', 4: '味方の場', 5: '自分か味方1体', 6: '相手の場',
    7: '自分', 8: '相手からランダムに1体', 9: '自分以外の全員', 10: '選んだ1体', 11: '相手全員',
    12: '場全体', 13: '自分と味方全員', 14: '全員', 15: '味方全員', 16: 'ひんしのポケモン',
  };
  const METHOD_ORDER = [1, 4, 2, 3, 10, 12];
  const METHOD_LABEL = { 1: 'レベルで覚える', 4: 'わざマシン', 2: 'タマゴ技', 3: '教え技', 10: 'フォルムチェンジで覚える', 12: '覚えられる技' };
  const METHOD_SHORT = { 4: 'マシン', 2: 'タマゴ', 3: '教え技', 10: 'フォルム', 12: '' };
  const SRC_LABEL = {
    SwSh: 'ソード・シールド', SV: 'スカーレット・バイオレット', Champions: 'Pokémon Champions',
    LA: 'LEGENDS アルセウス', USUM: 'ウルトラサン・ウルトラムーン', SM: 'サン・ムーン',
    ORAS: 'オメガルビー・アルファサファイア', XY: 'X・Y',
  };
  const GEN_OPTS = [[0, '全世代']].concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map(g => [g, `第${g}世代`]));
  const SORT_P = [['dex', '図鑑番号順'], ['total', '合計が高い順']]
    .concat(STAT_NAMES.map((n, i) => ['s' + i, `${n}が高い順`]), [['name', '名前順']]);
  const SORT_M = [['id', 'No.順'], ['power', '威力が高い順'], ['acc', '命中が高い順'], ['pp', 'PPが多い順'], ['prio', '優先度が高い順'], ['name', '名前順']];
  const SORT_A = [['id', 'No.順'], ['name', '名前順']];
  const CLS_OPTS = [[0, '全分類'], [2, '物理'], [3, '特殊'], [1, '変化']];
  const CAT_OPTS = [['all', 'すべて'], ['normal', '伝説・幻を除く'], ['legend', '伝説のみ'], ['myth', '幻のみ']];
  const PLACEHOLDER = { p: '名前で検索（ひらがな・英語・図鑑番号）', m: '技の名前や説明文で検索', a: '特性の名前や説明文で検索' };
  const CHUNK = 50;

  const $ = id => document.getElementById(id);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const pad = n => String(n).padStart(4, '0');
  const dash = v => (v == null ? '—' : v);
  const signed = v => (v > 0 ? '+' + v : String(v));
  const fmt = n => n.toLocaleString('ja-JP');
  const collator = new Intl.Collator('ja');

  // 検索用の正規化：全角/半角・ひらがな/カタカナ・大文字/小文字・記号の違いを吸収する
  // （etl/verify.py の norm と同じ処理。変えるときは両方直す）
  const PUNCT = /[\s・･\-‐‑–—―－_.,，、。'’"“”()（）「」『』［］\[\]!！?？:：]/g;
  function norm(s) {
    if (!s) return '';
    return String(s).normalize('NFKC').toLowerCase()
      .replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60))
      .replace(PUNCT, '');
  }

  // ---- 端末判定：指で操作したときは入力欄に自動でフォーカスしない ----
  // any- を使うのは「マウス等が繋がっているか」を見たいから（主入力だけだとタッチ対応PCを誤判定する）
  const HAS_KEYBOARD = !window.matchMedia ||
    window.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches;
  function cameFromTouch(e) {
    if (!HAS_KEYBOARD) return true;            // 指しか使えない端末
    if (e && typeof e.pointerType === 'string' && e.pointerType !== '') return e.pointerType === 'touch';
    return false;
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても動作は続ける */ } },
  };

  // ---- データ ----------------------------------------------------------
  let D, T, EFF, P, M, A, L, NAT, SP, PI, MI, AI, pIndex, keyP, keyM, descM, keyA, descA;
  const baseOf = new Map();   // 図鑑番号 → 基本の姿
  const totals = new Map();   // pokemon_id → 種族値合計

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  async function loadData() {
    const b64 = $('pd-data').textContent.trim();
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    let text;
    if (typeof DecompressionStream === 'function') {
      const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js');
      text = window.pako.ungzip(bin, { to: 'string' });
    }
    return JSON.parse(text);
  }

  function buildIndex(d) {
    D = d; T = d.types; EFF = d.eff; P = d.P; M = d.M; A = d.A; L = d.L; NAT = d.N;
    SP = new Map(d.S.map(s => [s[S_ID], s]));
    PI = new Map(P.map(p => [p[P_ID], p]));
    MI = new Map(M.map(m => [m[M_ID], m]));
    AI = new Map(A.map(a => [a[A_ID], a]));
    pIndex = new Map(P.map((p, i) => [p[P_ID], i]));
    for (const p of P) {
      if (!(p[P_FLAGS] & F_ALT) && !baseOf.has(p[P_DEX])) baseOf.set(p[P_DEX], p);
      let t = 0;
      for (let i = 0; i < 6; i++) t += p[P_ST + i];
      totals.set(p[P_ID], t);
    }
    const SEP = '\u0001';
    keyP = P.map(p => {
      const s = SP.get(p[P_DEX]);
      return [p[P_NAME], s[S_KANA], s[S_EN], p[P_IDENT], p[P_FORM]].map(norm).join(SEP);
    });
    keyM = M.map(m => [m[M_NAME], m[M_KANA], m[M_EN]].map(norm).join(SEP));
    descM = M.map(m => norm(m[M_DESC]) + SEP + norm(m[M_DESC_KANA]));
    keyA = A.map(a => [a[A_NAME], a[A_KANA], a[A_EN]].map(norm).join(SEP));
    descA = A.map(a => norm(a[A_DESC]) + SEP + norm(a[A_DESC_KANA]));
  }

  const learnIdx = {};
  function learnIndex(g) {            // move_id → [[pokemon_id, 覚え方, レベル], ...]
    if (learnIdx[g]) return learnIdx[g];
    const map = new Map(), src = L[g];
    for (const pid in src) {
      const a = src[pid];
      for (let i = 0; i < a.length; i += 3) {
        let arr = map.get(a[i]);
        if (!arr) map.set(a[i], (arr = []));
        arr.push([+pid, a[i + 1], a[i + 2]]);
      }
    }
    return (learnIdx[g] = map);
  }
  function learnersOf(mid, g) {
    const set = new Set();
    for (const gg of g === 'all' ? GAMES : [g]) {
      const arr = learnIndex(gg).get(mid);
      if (arr) for (const e of arr) set.add(e[0]);
    }
    return set;
  }
  const inGameP = (p, g) => g === 'all' || !!L[g][p[P_ID]];
  const inGameM = (m, g) => g === 'all' || learnIndex(g).has(m[M_ID]);
  const abGame = {};
  function inGameA(a, g) {
    if (g === 'all') return true;
    if (!abGame[g]) {
      const s = new Set();
      for (const p of P) if (L[g][p[P_ID]]) { s.add(p[P_A1]); s.add(p[P_A2]); s.add(p[P_AH]); }
      abGame[g] = s;
    }
    return abGame[g].has(a[A_ID]);
  }

  // ---- 状態 ------------------------------------------------------------
  const st = {
    tab: 'p', game: 'all', q: '', more: false,
    p: { types: [], gen: 0, sort: 'dex', cat: 'all', forms: true, move: 0, ability: 0, bm: false },
    m: { types: [], gen: 0, sort: 'id', cls: 0 },
    a: { gen: 0, sort: 'id' },
  };
  let detailGame = null;
  let view = 'list', listY = 0;
  const navStack = [];
  // バトル側の画面（1つのページにまとめたとき）。図鑑はこれらのハッシュでは何もしない
  const BT_ROUTE = /^#\/(b|teams|team|set|battle|sim)(\/|$)/;
  const inBattle = () => BT_ROUTE.test(location.hash);
  // ブックマーク：pokemon_id の配列。バトルのチーム編成でポケモンを選ぶときにも使う
  let BM = new Set(), bmDirty = false;
  function loadBM() { try { const a = JSON.parse(store.get('pd.bookmarks') || '[]'); BM = new Set(Array.isArray(a) ? a.filter(Number.isInteger) : []); } catch (e) { BM = new Set(); } }
  function toggleBM(pid) { if (BM.has(pid)) BM.delete(pid); else BM.add(pid); store.set('pd.bookmarks', JSON.stringify([...BM])); }
  const els = {};

  // ---- 絞り込み --------------------------------------------------------
  function filterP() {
    const f = st.p, g = st.game, q = norm(st.q);
    const num = /^\d+$/.test(q) ? parseInt(q, 10) : -1;
    const learners = f.move ? learnersOf(f.move, g) : null;
    const out = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (f.bm && !BM.has(p[P_ID])) continue;
      if (!f.forms && (p[P_FLAGS] & F_ALT)) continue;
      if (!inGameP(p, g)) continue;
      if (f.types.length && !f.types.every(t => p[P_T1] === t || p[P_T2] === t)) continue;
      if (f.gen && p[P_GEN] !== f.gen) continue;
      if (f.cat !== 'all') {
        const c = SP.get(p[P_DEX])[S_CAT];
        if (f.cat === 'normal' ? c !== 0 : f.cat === 'legend' ? c !== 1 : c !== 2) continue;
      }
      if (f.ability && p[P_A1] !== f.ability && p[P_A2] !== f.ability && p[P_AH] !== f.ability) continue;
      if (learners && !learners.has(p[P_ID])) continue;
      if (q) {
        if (num >= 0) { if (p[P_DEX] !== num) continue; }
        else if (keyP[i].indexOf(q) < 0) continue;
      }
      out.push(p);
    }
    return out;
  }
  function filterM(hits) {
    const f = st.m, g = st.game, q = norm(st.q);
    const out = [];
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      if (!inGameM(m, g)) continue;
      if (f.types.length && f.types.indexOf(m[M_TYPE]) < 0) continue;
      if (f.cls && m[M_CLS] !== f.cls) continue;
      if (f.gen && m[M_GEN] !== f.gen) continue;
      if (q && keyM[i].indexOf(q) < 0) {
        if (descM[i].indexOf(q) < 0) continue;
        hits.add(m[M_ID]);                  // 説明文だけで当たったもの
      }
      out.push(m);
    }
    return out;
  }
  function filterA(hits) {
    const f = st.a, g = st.game, q = norm(st.q);
    const out = [];
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!inGameA(a, g)) continue;
      if (f.gen && a[A_GEN] !== f.gen) continue;
      if (q && keyA[i].indexOf(q) < 0) {
        if (descA[i].indexOf(q) < 0) continue;
        hits.add(a[A_ID]);
      }
      out.push(a);
    }
    return out;
  }

  // ---- 並び替え（名前で当たったものを、説明文だけで当たったものより先に出す） ----
  function sortP(arr) {
    const s = st.p.sort, ord = p => pIndex.get(p[P_ID]);
    if (s === 'dex') return arr;          // P は図鑑番号順に並んでいる
    if (s === 'name') return arr.sort((a, b) => collator.compare(a[P_NAME], b[P_NAME]) || ord(a) - ord(b));
    const i = +s.slice(1);
    const key = s === 'total' ? (p => totals.get(p[P_ID])) : (p => p[P_ST + i]);
    return arr.sort((a, b) => key(b) - key(a) || ord(a) - ord(b));
  }
  function sortM(arr, hits) {
    const s = st.m.sort, rank = m => (hits.has(m[M_ID]) ? 1 : 0), nv = v => (v == null ? -1 : v);
    const key = { power: m => nv(m[M_POW]), acc: m => nv(m[M_ACC]), pp: m => nv(m[M_PP]), prio: m => m[M_PRIO] }[s];
    return arr.sort((a, b) => rank(a) - rank(b) ||
      (s === 'name' ? collator.compare(a[M_NAME], b[M_NAME]) : key ? key(b) - key(a) : 0) || a[M_ID] - b[M_ID]);
  }
  function sortA(arr, hits) {
    const s = st.a.sort, rank = a => (hits.has(a[A_ID]) ? 1 : 0);
    return arr.sort((a, b) => rank(a) - rank(b) ||
      (s === 'name' ? collator.compare(a[A_NAME], b[A_NAME]) : 0) || a[A_ID] - b[A_ID]);
  }

  // ---- 行の描画 --------------------------------------------------------
  const typeName = (t1, t2) => T[t1][1] + (t2 >= 0 ? '・' + T[t2][1] : '');
  function thumb(t1, t2) {
    return `<div class="thumb" role="img" aria-label="${esc(typeName(t1, t2))}タイプ"><span class="t${t1}">${T[t1][2]}</span>` +
      (t2 >= 0 ? `<span class="t${t2}">${T[t2][2]}</span>` : '') + '</div>';
  }
  const clsTag = c => `<span class="cls c${c}">${CLS_NAME[c]}</span>`;
  let hitSet = new Set();

  function rowP(p) {
    const s = st.p.sort, on = s[0] === 's' ? +s[1] : -1;
    let stats = '';
    for (let i = 0; i < 6; i++) stats += `<span${i === on ? ' class="on"' : ''}><i>${STAT_KEYS[i]}</i>${p[P_ST + i]}</span>`;
    return `<li class="row"><a href="#/p/${p[P_ID]}"><div class="rb"><div class="l1"><span class="no">${pad(p[P_DEX])}</span>` +
      `<span class="nm">${BM.has(p[P_ID]) ? '<span class="bmk" aria-label="ブックマーク">★</span>' : ''}${esc(p[P_NAME])}</span><span class="tot${s === 'total' ? ' on' : ''}"><small>合計</small>${totals.get(p[P_ID])}</span></div>` +
      `<div class="stats">${stats}</div></div>${thumb(p[P_T1], p[P_T2])}</a></li>`;
  }
  // 技の効果（発動確率つき）。チャンピオンズで違う技は、ゲームの切り替えに合わせて出す
  const effShort = m => { const e = m[M_EFF]; return !e ? '' : st.game === 'ch' && e[3] != null ? e[3] : e[2]; };
  function effHTML(m) {
    const e = m[M_EFF];
    if (!e || (!e[0].length && !(e[1] && e[1].length))) return '';
    const ul = lines => (lines.length ? `<ul class="effl">${lines.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="fine">特になし</p>');
    const body = e[1] == null ? ul(e[0])
      : `<p class="effg">チャンピオンズ</p>${ul(e[1])}<p class="effg">SV</p>${ul(e[0])}<p class="fine">チャンピオンズでは効果や確率がSVと違います。</p>`;
    return sec('効果と発動確率', body + '<p class="fine">対戦シミュレーターと同じ Pokémon Showdown のデータです。主な効果だけを載せています。</p>');
  }
  function rowM(m) {
    const s = st.m.sort;
    const cell = (key, label, v) => `<span${s === key ? ' class="hit"' : ''}>${label}<b>${v}</b></span>`;
    return `<li class="row"><a href="#/m/${m[M_ID]}"><div class="rb"><div class="l1"><span class="nm">${esc(m[M_NAME])}</span></div>` +
      `<div class="l2">${clsTag(m[M_CLS])}${cell('power', '威力', dash(m[M_POW]))}${cell('acc', '命中', dash(m[M_ACC]))}${cell('pp', 'PP', dash(m[M_PP]))}` +
      `${m[M_PRIO] || s === 'prio' ? cell('prio', '優先度', signed(m[M_PRIO])) : ''}${effShort(m) ? `<span class="eff">${esc(effShort(m))}</span>` : ''}</div>` +
      `${hitSet.has(m[M_ID]) ? `<p class="ad">${esc(m[M_DESC])}</p>` : ''}</div>${thumb(m[M_TYPE], -1)}</a></li>`;
  }
  function rowA(a) {
    return `<li class="row"><a class="one" href="#/a/${a[A_ID]}"><div class="rb"><div class="l1"><span class="nm">${esc(a[A_NAME])}</span>` +
      `<span class="tot"><small>第${a[A_GEN]}世代</small></span></div><p class="ad">${a[A_DESC] ? esc(a[A_DESC]) : '説明文なし'}</p></div></a></li>`;
  }

  // 追記式の描画：見えている範囲が埋まるまで足す（行の高さが可変でも破綻しない）
  let items = [], rendered = 0, rowFn = null;
  function renderList(arr, fn) {
    items = arr; rendered = 0; rowFn = fn;
    els.list.textContent = '';
    if (!arr.length) { els.list.innerHTML = emptyHTML(); els.sentinel.hidden = true; return; }
    appendMore();
  }
  function appendMore() {
    if (rendered >= items.length) { els.sentinel.hidden = true; return; }
    els.sentinel.hidden = false;
    const end = Math.min(items.length, rendered + CHUNK);
    let h = '';
    for (let i = rendered; i < end; i++) h += rowFn(items[i]);
    els.list.insertAdjacentHTML('beforeend', h);
    rendered = end;
    if (rendered >= items.length) { els.sentinel.hidden = true; return; }
    requestAnimationFrame(() => {
      if (view === 'list' && rendered < items.length &&
          els.sentinel.getBoundingClientRect().top < window.innerHeight + 800) appendMore();
    });
  }
  function emptyHTML() {
    const what = { p: 'ポケモン', m: '技', a: '特性' }[st.tab];
    return `<li class="empty">条件に合う${what}はありません。<br>検索語や絞り込みを減らしてください。<br>` +
      '<button type="button" class="reset" data-act="reset">条件をリセット</button></li>';
  }

  // ---- 要約とリセット --------------------------------------------------
  function describe() {
    const d = [];
    if (st.game !== 'all') d.push(GAME_LABEL[st.game] + 'の技データあり');
    const types = f => f.types.map(t => T[t][1]).join('・') + 'タイプ';
    if (st.tab === 'p') {
      const f = st.p;
      if (f.types.length) d.push(types(f));
      if (f.gen) d.push(`第${f.gen}世代`);
      if (f.move) d.push(`「${MI.get(f.move)[M_NAME]}」を覚える`);
      if (f.ability) d.push(`特性「${AI.get(f.ability)[A_NAME]}」`);
      if (f.cat !== 'all') d.push(CAT_OPTS.find(o => o[0] === f.cat)[1]);
      if (!f.forms) d.push('別の姿を除く');
    } else if (st.tab === 'm') {
      const f = st.m;
      if (f.types.length) d.push(types(f));
      if (f.cls) d.push(CLS_NAME[f.cls]);
      if (f.gen) d.push(`第${f.gen}世代`);
    } else if (st.a.gen) d.push(`第${st.a.gen}世代`);
    if (st.q.trim()) d.push(`「${st.q.trim()}」を含む`);
    return d;
  }
  function filtersActive() {
    const f = st[st.tab];
    return !!st.q.trim() || (f.types && f.types.length > 0) || !!f.gen ||
      (st.tab === 'p' && (!!f.move || !!f.ability || f.cat !== 'all' || !f.forms)) ||
      (st.tab === 'm' && !!f.cls);
  }
  function renderSummary(n) {
    const d = describe();
    els.cnt.innerHTML = `<b>${fmt(n)}</b>件` + (d.length ? `<span class="desc">${esc(d.join('、'))}</span>` : '');
    els.reset.hidden = !filtersActive() || n === 0;   // 0件のときは一覧側のボタンだけにする
  }

  // 絞り込み時にスクロールを飛ばさない：深く読み進めていたときだけ結果の先頭まで引き戻す。
  // 操作子は結果より上にあるので、見えている操作子を押した場合は 1px も動かない。
  function keepScrollInResults() {
    const y = window.pageYOffset;
    const top = els.summary.getBoundingClientRect().top + y;
    const stuck = els.sticky.getBoundingClientRect().height + (parseFloat(getComputedStyle(els.sticky).top) || 0);
    const limit = Math.max(0, Math.round(top - stuck));
    if (y > limit) window.scrollTo(0, limit);
  }

  function update(keep) {
    const hm = new Set(), ha = new Set();
    const rp = filterP(), rm = filterM(hm), ra = filterA(ha);
    els.np.textContent = fmt(rp.length);
    els.nm.textContent = fmt(rm.length);
    els.na.textContent = fmt(ra.length);
    let arr, fn;
    if (st.tab === 'p') { hitSet = new Set(); arr = sortP(rp); fn = rowP; }
    else if (st.tab === 'm') { hitSet = hm; arr = sortM(rm, hm); fn = rowM; }
    else { hitSet = ha; arr = sortA(ra, ha); fn = rowA; }
    renderList(arr, fn);
    renderSummary(arr.length);
    if (keep !== false) keepScrollInResults();
  }

  // ---- 操作子 ----------------------------------------------------------
  function selHTML(id, label, value, opts) {
    const on = String(value) !== String(opts[0][0]);
    return `<span class="sel${on ? ' on' : ''}"><select id="${id}" aria-label="${label}">` +
      opts.map(([v, t]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`).join('') +
      '</select></span>';
  }
  const moreActive = () => !!st.p.move || !!st.p.ability || st.p.cat !== 'all' || !st.p.forms || st.p.bm;
  const moreLabel = () => '条件を追加' + (moreActive() ? '<span class="dot" role="img" aria-label="設定中"></span>' : '');

  function buildTypeGrid() {
    els.tgrid.innerHTML = TYPE_ORDER.map(i =>
      `<button type="button" class="tchip t${i}" data-t="${i}" aria-pressed="false" aria-label="${T[i][1]}" title="${T[i][1]}">${T[i][2]}</button>`).join('');
  }
  function syncTypeGrid() {
    els.tgrid.hidden = st.tab === 'a';
    const f = st[st.tab];
    if (!f.types) return;
    for (const b of els.tgrid.children) b.setAttribute('aria-pressed', f.types.indexOf(+b.dataset.t) >= 0 ? 'true' : 'false');
  }
  function buildCtrls() {
    let h;
    if (st.tab === 'p') {
      h = selHTML('f-gen', '世代', st.p.gen, GEN_OPTS) + selHTML('f-sort', '並び順', st.p.sort, SORT_P) +
        `<button type="button" class="morebtn" id="f-more" aria-expanded="${st.more}" aria-controls="more">${moreLabel()}</button>`;
    } else if (st.tab === 'm') {
      h = selHTML('f-cls', '分類', st.m.cls, CLS_OPTS) + selHTML('f-gen', '世代', st.m.gen, GEN_OPTS) + selHTML('f-sort', '並び順', st.m.sort, SORT_M);
    } else {
      h = selHTML('f-gen', '世代', st.a.gen, GEN_OPTS) + selHTML('f-sort', '並び順', st.a.sort, SORT_A);
    }
    els.ctrls.innerHTML = h;
    els.more.hidden = !(st.tab === 'p' && st.more);
    if (!els.more.hidden) buildMore();
    syncTypeGrid();
  }

  function pickerHTML(kind) {
    const id = st.p[kind];
    if (id) {
      const name = kind === 'move' ? MI.get(id)[M_NAME] : AI.get(id)[A_NAME];
      return `<div class="picked"><span>${esc(name)}</span><button type="button" data-unpick="${kind}">外す</button></div>`;
    }
    const ph = kind === 'move' ? '技の名前（例：じしん）' : '特性の名前（例：いかく）';
    const lab = kind === 'move' ? '覚える技で絞り込む' : '特性で絞り込む';
    return `<input type="search" data-pick="${kind}" placeholder="${ph}" aria-label="${lab}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">` +
      '<ul class="sugg" hidden></ul>';
  }
  function buildMore() {
    els.more.innerHTML =
      `<div class="field"><span class="flab">覚える技</span><div class="picker" data-kind="move">${pickerHTML('move')}</div></div>` +
      `<div class="field"><span class="flab">特性</span><div class="picker" data-kind="ability">${pickerHTML('ability')}</div></div>` +
      `<div class="field"><span class="flab">区分</span>${selHTML('f-cat', '区分', st.p.cat, CAT_OPTS)}</div>` +
      `<label class="check"><input type="checkbox" id="f-forms"${st.p.forms ? ' checked' : ''}>メガシンカやリージョンフォームなど、別の姿も表示する</label>` +
      `<label class="check"><input type="checkbox" id="f-bm"${st.p.bm ? ' checked' : ''}>ブックマークしたポケモンだけ（${BM.size}匹）</label>`;
  }
  function refreshPicker(kind) {
    const box = els.more.querySelector(`.picker[data-kind="${kind}"]`);
    if (box) box.innerHTML = pickerHTML(kind);
    const btn = $('f-more');
    if (btn) btn.innerHTML = moreLabel();
  }
  function suggest(kind, qn) {
    const src = kind === 'move' ? M : A, keys = kind === 'move' ? keyM : keyA;
    const ok = kind === 'move' ? inGameM : inGameA, NAME = 1;
    const out = [];
    for (let i = 0; i < src.length; i++) {
      if (!ok(src[i], st.game)) continue;
      const pos = keys[i].indexOf(qn);
      if (pos >= 0) out.push([pos === 0 ? 0 : 1, src[i]]);
    }
    out.sort((a, b) => a[0] - b[0] || a[1][NAME].length - b[1][NAME].length || collator.compare(a[1][NAME], b[1][NAME]));
    return out.slice(0, 8).map(x => x[1]);
  }
  function renderSugg(input) {
    const kind = input.dataset.pick, ul = input.nextElementSibling, qn = norm(input.value);
    if (!qn) { ul.hidden = true; ul.innerHTML = ''; return; }
    const list = suggest(kind, qn);
    ul.innerHTML = list.length ? list.map((x, i) => {
      const act = i === 0 ? ' class="act"' : '';
      return kind === 'move'
        ? `<li><button type="button" data-choose="move:${x[M_ID]}"${act}><span class="thumb-mini t${x[M_TYPE]}" aria-hidden="true">${T[x[M_TYPE]][2]}</span>${esc(x[M_NAME])}</button></li>`
        : `<li><button type="button" data-choose="ability:${x[A_ID]}"${act}>${esc(x[A_NAME])}</button></li>`;
    }).join('') : '<li class="none">見つかりません</li>';
    ul.hidden = false;
  }
  function choose(v) {
    const [kind, id] = v.split(':');
    st.p[kind] = +id;
    refreshPicker(kind);
    update();
  }
  function resetFilters() {
    st.q = ''; els.q.value = ''; els.qclear.hidden = true;
    if (st.tab === 'p') Object.assign(st.p, { types: [], gen: 0, cat: 'all', forms: true, move: 0, ability: 0, bm: false });
    else if (st.tab === 'm') Object.assign(st.m, { types: [], gen: 0, cls: 0 });
    else st.a.gen = 0;
    buildCtrls();
    update();
  }
  function syncTabs() {
    for (const b of els.tabs.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', b.dataset.tab === st.tab ? 'true' : 'false');
    els.results.setAttribute('aria-labelledby', 'tab-' + st.tab);
    els.q.placeholder = PLACEHOLDER[st.tab];
  }
  function syncGame() {
    for (const b of els.gameSeg.children) b.setAttribute('aria-pressed', b.dataset.game === st.game ? 'true' : 'false');
  }

  // ---- 実数値の計算 ------------------------------------------------------
  // SV は通常の式（レベル・個体値・努力値・性格）。チャンピオンズは個体値がなく Lv.50 固定で、
  // 能力ポイント 1 につき実数値 +1（HP = 種族値 + P + 75、ほか = (種族値 + P + 20) × 能力補正）。
  const LIMIT = { sv: { max: 252, total: 510 }, ch: { max: 32, total: 66 } };
  const PRESETS = {
    sv: { AS: [4, 252, 0, 0, 0, 252], CS: [4, 0, 0, 252, 0, 252], HA: [252, 252, 4, 0, 0, 0],
      HC: [252, 0, 4, 252, 0, 0], HB: [252, 0, 252, 0, 4, 0], HD: [252, 0, 4, 0, 252, 0] },
    ch: { AS: [2, 32, 0, 0, 0, 32], CS: [2, 0, 0, 32, 0, 32], HA: [32, 32, 2, 0, 0, 0],
      HC: [32, 0, 2, 32, 0, 0], HB: [32, 0, 32, 0, 2, 0], HD: [32, 0, 2, 0, 32, 0] },
  };
  const PRESET_NOTE = { AS: 'A・S', CS: 'C・S', HA: 'H・A', HC: 'H・C', HB: 'H・B', HD: 'H・D' };
  const calc = { mode: 'sv', level: 50, up: 0, down: 0, iv: [31, 31, 31, 31, 31, 31], ev: [0, 0, 0, 0, 0, 0], sp: [0, 0, 0, 0, 0, 0] };

  // @stat-begin（etl/verify.py がこの範囲を取り出し、@smogon/calc の計算と全ポケモン分を突き合わせる）
  function calcStat(mode, i, base, level, iv, inv, up, down) {
    let s;
    if (mode === 'ch') {
      if (i === 0) return base === 1 ? 1 : base + inv + 75;
      s = base + inv + 20;
    } else {
      const core = Math.floor(((2 * base + iv + Math.floor(inv / 4)) * level) / 100);
      if (i === 0) return base === 1 ? 1 : core + level + 10;   // HP の種族値が 1（ヌケニン）なら常に 1
      s = core + 5;
    }
    if (up !== down) {
      if (up === i) return Math.floor((s * 110) / 100);
      if (down === i) return Math.floor((s * 90) / 100);
    }
    return s;
  }
  // @stat-end

  const isCh = () => calc.mode === 'ch';
  const invArr = () => (isCh() ? calc.sp : calc.ev);
  const totalInv = () => invArr().reduce((a, b) => a + b, 0);
  function statOf(p, i, inv) {
    const ch = isCh();
    return calcStat(calc.mode, i, p[P_ST + i], ch ? 50 : calc.level, ch ? 31 : calc.iv[i],
      inv == null ? invArr()[i] : inv, calc.up, calc.down);
  }
  function reachOf(i, sum) {                // 合計の上限から見て、この能力に振れるいちばん大きい値
    const lim = LIMIT[calc.mode];
    return Math.max(0, Math.min(lim.max, lim.total - ((sum == null ? totalInv() : sum) - invArr()[i])));
  }
  function minInvSame(p, i, inv) {       // 同じ実数値になる、いちばん少ない振り方
    const s = statOf(p, i, inv);
    let m = inv;
    while (m > 0 && statOf(p, i, m - 1) === s) m--;
    return m;
  }
  function stepInv(p, i, dir) {          // 実数値が 1 段階変わるところまで動かす（合計の上限は超えない）
    const lim = LIMIT[calc.mode], cur = invArr()[i], now = statOf(p, i, cur);
    if (dir > 0) {
      const cap = Math.min(lim.max, lim.total - (totalInv() - cur));
      for (let v = cur + 1; v <= cap; v++) if (statOf(p, i, v) > now) return v;
      return cur;
    }
    for (let v = cur - 1; v >= 0; v--) if (statOf(p, i, v) < now) return minInvSame(p, i, v);
    return 0;
  }
  function loadCalc() {
    let o = null;
    try { o = JSON.parse(store.get('pd.calc') || 'null'); } catch (e) { o = null; }
    if (!o || typeof o !== 'object') return false;
    const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
    const arr = (a, hi, d) => (Array.isArray(a) && a.length === 6 ? a.map(v => int(v, 0, hi, d)) : [d, d, d, d, d, d]);
    calc.mode = o.mode === 'ch' ? 'ch' : 'sv';
    calc.level = int(o.level, 1, 100, 50);
    calc.up = int(o.up, 0, 5, 0);
    calc.down = int(o.down, 0, 5, 0);
    if (!calc.up || !calc.down || calc.up === calc.down) calc.up = calc.down = 0;
    calc.iv = arr(o.iv, 31, 31);
    calc.ev = arr(o.ev, 252, 0);
    calc.sp = arr(o.sp, 32, 0);
    return true;
  }
  const saveCalc = () => store.set('pd.calc', JSON.stringify(calc));

  function natureOptions() {
    let h = `<option value="0,0"${calc.up === calc.down ? ' selected' : ''}>補正なし</option>`;
    for (let up = 1; up <= 5; up++) {
      for (let down = 1; down <= 5; down++) {
        if (up === down) continue;
        const n = NAT.find(x => x[N_UP] === up && x[N_DOWN] === down);
        h += `<option value="${up},${down}"${calc.up === up && calc.down === down ? ' selected' : ''}>` +
          `${STAT_NAMES[up]}↑ ${STAT_NAMES[down]}↓（${esc(n ? n[N_NAME] : '')}）</option>`;
      }
    }
    return h;
  }
  function calcHTML(p) {
    const ch = isCh(), word = ch ? '能力P' : '努力値', natLabel = ch ? '能力補正' : '性格';
    let h = '<h3>実数値</h3><div class="cbar"><div class="seg" role="group" aria-label="計算のしかた">' +
      `<button type="button" data-cmode="sv" aria-pressed="${!ch}">SV</button>` +
      `<button type="button" data-cmode="ch" aria-pressed="${ch}">チャンピオンズ</button></div></div>`;
    h += ch
      ? '<div class="crow"><span class="flab">レベル</span><span class="lvfix">50（チャンピオンズは固定）</span></div>'
      : '<div class="crow"><span class="flab" id="c-lvlab">レベル</span><div class="chips">' +
        `<input id="c-lv" class="nin" type="text" inputmode="numeric" maxlength="3" value="${calc.level}" aria-labelledby="c-lvlab">` +
        `<button type="button" class="chip" data-lv="50" aria-pressed="${calc.level === 50}" aria-label="レベル50にする">50</button>` +
        `<button type="button" class="chip" data-lv="100" aria-pressed="${calc.level === 100}" aria-label="レベル100にする">100</button></div></div>`;
    h += `<div class="crow"><span class="flab">${natLabel}</span><span class="sel"><select id="c-nat" aria-label="${natLabel}">${natureOptions()}</select></span></div>`;
    h += `<div class="crow"><span class="flab">${ch ? '能力ポイント' : '努力値'}の振り方</span><div class="chips">` +
      Object.keys(PRESET_NOTE).map(k => `<button type="button" class="chip" data-preset="${k}" title="${PRESET_NOTE[k]}に最大まで振り、余りをほかに振る">${k}</button>`).join('') +
      '<button type="button" class="chip" data-preset="0">すべて0</button></div></div>';
    if (!ch) {
      h += '<div class="crow"><span class="flab">個体値</span><div class="chips">' +
        '<button type="button" class="chip" data-ivp="31">すべて31</button>' +
        '<button type="button" class="chip" data-ivp="a0">Aだけ0</button><button type="button" class="chip" data-ivp="s0">Sだけ0</button></div></div>';
    }
    const full = ch ? '能力ポイント' : '努力値', lim = LIMIT[calc.mode];
    h += `<div class="evh${ch ? '' : ' iv'}" aria-hidden="true"><span>能力</span>${ch ? '' : '<span>個体値</span>'}<span>${word}</span><span>実数値</span></div><div class="evl">`;
    for (let i = 0; i < 6; i++) {
      h += `<div class="evr"><div class="l1${ch ? '' : ' iv'}"><span class="lab"><b>${STAT_KEYS[i]}</b>${STAT_NAMES[i]}<span class="nm" id="c-nm-${i}"></span></span>` +
        (ch ? '' : `<input class="nin" type="text" inputmode="numeric" maxlength="2" data-iv="${i}" value="${calc.iv[i]}" aria-label="${STAT_NAMES[i]}の個体値">`) +
        `<span class="num" id="c-inv-${i}" data-inv="${i}">${invArr()[i]}</span><span class="out" id="c-out-${i}"></span></div>` +
        `<div class="l2"><button type="button" class="stp" data-step="-1" data-i="${i}" aria-label="${STAT_NAMES[i]}の実数値を下げる">−</button>` +
        `<div class="evs" role="slider" tabindex="0" data-sl="${i}" data-unit="${ch ? 1 : 4}" aria-label="${STAT_NAMES[i]}の${full}" ` +
        `aria-valuemin="0" aria-valuemax="${lim.max}" aria-valuenow="${invArr()[i]}"><span class="tr"><span class="th"></span></span></div>` +
        `<button type="button" class="stp" data-step="1" data-i="${i}" aria-label="${STAT_NAMES[i]}の実数値を上げる">＋</button>` +
        `<button type="button" class="mx" data-max="${i}" aria-label="${STAT_NAMES[i]}の${full}を最大にする">最大</button></div></div>`;
    }
    h += '</div><p class="ctotal" id="c-total"></p><p class="fine" id="c-waste" hidden></p>' +
      '<div class="tiers" id="c-tiers"></div><div class="tiers" id="c-bulk"></div>';
    h += `<p class="fine">バーはタップした位置に合わせて動き、横になぞると細かく動きます。＋／−は実数値が1つ変わるところまで、` +
      `「最大」は合計の残りの範囲でいちばん多く振ります。点線の部分は、合計の上限を超えるので振れません。</p>`;
    if (ch) h += '<p class="fine">チャンピオンズには個体値がなく、Lv.50で計算します。能力ポイントは1つにつき実数値が1上がります（1つの能力に32まで、合計66まで）。</p>';
    return h;
  }
  function tiersHTML(p) {
    const ch = isCh(), lv = ch ? 50 : calc.level, max = LIMIT[calc.mode].max, b = p[P_ST + 5];
    const f = (iv, inv, up, down) => calcStat(calc.mode, 5, b, lv, iv, inv, up, down);
    const rows = [
      ['最速', f(31, max, 5, 1), 'すばやさが上がる性格で最大まで振る'],
      ['準速', f(31, max, 0, 0), '補正なしで最大まで振る'],
      ['無振り', f(31, 0, 0, 0), '振らない'],
      ['最遅', f(0, 0, 1, 5), ch ? 'すばやさが下がる補正で振らない' : '個体値0・すばやさが下がる性格で振らない'],
    ];
    return `<span class="tl">すばやさの目安（Lv.${lv}）</span>` +
      rows.map(([k, v, t]) => `<span class="tv" title="${t}">${k}<b>${v}</b></span>`).join('');
  }
  function syncCalcInputs() {               // 入力欄（個体値・レベル）の表示を、いまの値にそろえる
    for (const el of els.detail.querySelectorAll('[data-iv]')) el.value = calc.iv[+el.dataset.iv];
    const lv = $('c-lv');
    if (lv) lv.value = calc.level;
    syncLevelChips();
  }
  function syncLevelChips() {
    for (const b of els.detail.querySelectorAll('[data-lv]')) b.setAttribute('aria-pressed', String(+b.dataset.lv === calc.level));
  }
  function flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth;                // アニメーションを最初から再生させる
    el.classList.add('flash');
  }
  function refreshCalc() {
    const box = $('calc');
    if (!box) return;
    const p = PI.get(+box.dataset.pid), lim = LIMIT[calc.mode], word = isCh() ? '能力ポイント' : '努力値';
    const vals = [], inv = invArr(), sum = totalInv();
    for (let i = 0; i < 6; i++) {
      const v = statOf(p, i);
      vals.push(v);
      const num = $('c-inv-' + i), sl = box.querySelector(`[data-sl="${i}"]`);
      if (num) num.textContent = inv[i];
      if (sl) setSlider(sl, inv[i], reachOf(i, sum), `${inv[i]}（実数値 ${v}）`);
      const mark = i && calc.up !== calc.down ? (calc.up === i ? 'up' : calc.down === i ? 'down' : '') : '';
      const out = $('c-out-' + i), nm = $('c-nm-' + i);
      out.textContent = v;
      out.className = 'out' + (mark ? ' ' + mark : '');
      nm.textContent = mark === 'up' ? '↑' : mark === 'down' ? '↓' : '';
      nm.className = 'nm' + (mark ? ' ' + mark : '');
    }
    const tot = totalInv(), over = tot > lim.total, t = $('c-total');
    t.classList.toggle('over', over);
    t.innerHTML = `${word}の合計 <b>${tot}</b> / ${lim.total}` +
      (over ? `<span class="warn">上限を ${tot - lim.total} 超えています</span>` : `<span class="rest">残り ${lim.total - tot}</span>`);
    const waste = [];
    for (let i = 0; i < 6; i++) {
      const w = invArr()[i] - minInvSame(p, i, invArr()[i]);
      if (w > 0) waste.push(`${STAT_NAMES[i]} ${w}`);
    }
    const wl = $('c-waste');
    wl.hidden = !waste.length;
    wl.textContent = waste.length ? `実数値が変わらない余分な${word}：${waste.join('、')}` : '';
    $('c-tiers').innerHTML = tiersHTML(p);
    $('c-bulk').innerHTML = '<span class="tl">耐久指数</span>' +
      `<span class="tv">物理 H×B<b>${fmt(vals[0] * vals[2])}</b></span><span class="tv">特殊 H×D<b>${fmt(vals[0] * vals[4])}</b></span>`;
  }
  function onCalcClick(e, box) {
    const p = PI.get(+box.dataset.pid);
    const cm = e.target.closest('[data-cmode]');
    if (cm) {
      if (calc.mode !== cm.dataset.cmode) { calc.mode = cm.dataset.cmode; saveCalc(); box.innerHTML = calcHTML(p); refreshCalc(); }
      return true;
    }
    const lvb = e.target.closest('[data-lv]');
    if (lvb) { calc.level = +lvb.dataset.lv; saveCalc(); syncCalcInputs(); refreshCalc(); return true; }
    const pr = e.target.closest('[data-preset]');
    if (pr) {
      const v = pr.dataset.preset === '0' ? [0, 0, 0, 0, 0, 0] : PRESETS[calc.mode][pr.dataset.preset].slice();
      if (isCh()) calc.sp = v; else calc.ev = v;
      saveCalc(); refreshCalc();
      return true;
    }
    const ivp = e.target.closest('[data-ivp]');
    if (ivp) {
      const k = ivp.dataset.ivp;
      if (k === '31') calc.iv = [31, 31, 31, 31, 31, 31];
      else calc.iv[k === 'a0' ? 1 : 5] = 0;
      saveCalc(); syncCalcInputs(); refreshCalc();
      return true;
    }
    const stp = e.target.closest('[data-step]');
    if (stp) {
      const i = +stp.dataset.i, dir = +stp.dataset.step, nv = stepInv(p, i, dir);
      if (nv === invArr()[i] && dir > 0) flash($('c-total'));   // 上限で増やせない
      invArr()[i] = nv;
      saveCalc(); refreshCalc();
      return true;
    }
    const mx = e.target.closest('[data-max]');
    if (mx) {                                 // 1つの能力の最大（合計の残りが足りなければ、残りの分だけ）
      const i = +mx.dataset.max, cur = invArr()[i], reach = reachOf(i);
      if (reach > cur) { invArr()[i] = reach; saveCalc(); refreshCalc(); }
      else if (cur < LIMIT[calc.mode].max) flash($('c-total'));
      return true;
    }
    return false;
  }
  function onCalcSlide(el, v, moving) {      // バーを動かしたとき（合計の上限を超える分は、点線のところで止める）
    const i = +el.dataset.sl, cur = invArr()[i], reach = reachOf(i);
    if (v > reach) { if (!moving && cur >= reach) flash($('c-total')); v = reach; }
    if (v === cur) return;
    invArr()[i] = v;
    saveCalc(); refreshCalc();
  }
  // ---- 振り分けのバー（図鑑の実数値とチームの編集で同じしくみ。app.js と battle.js に同じものがある） ----
  // タップした位置に合わせる・横になぞると動く・キー（← → Home End）でも動かせる。
  // 縦にスクロールしようとして触れたときは値を変えない（touch-action: pan-y。指を離したときか、横に動かしたときに初めて変える）
  function sliderAt(el, x) {
    const r = el.querySelector('.tr').getBoundingClientRect(), max = +el.getAttribute('aria-valuemax'), unit = +el.dataset.unit || 1;
    const t = r.width ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : 0;
    return Math.min(max, Math.round((t * max) / unit) * unit);
  }
  function setSlider(el, v, reach, text) {     // reach：合計の上限から見て、この能力に振れるいちばん大きい値
    const max = +el.getAttribute('aria-valuemax') || 1;
    el.style.setProperty('--v', (100 * Math.min(v, max)) / max + '%');
    el.style.setProperty('--r', (100 * Math.min(max, Math.max(v, reach))) / max + '%');
    el.setAttribute('aria-valuenow', v);
    el.setAttribute('aria-valuetext', text);
  }
  function bindSliders(root, onValue) {         // onValue(バー, 値, なぞっている途中か)
    let drag = null;
    root.addEventListener('pointerdown', e => {
      const el = e.target.closest('.evs');
      if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { el, id: e.pointerId, x: e.clientX, y: e.clientY, on: e.pointerType === 'mouse' };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 捕まえられなくても動く */ }
      if (drag.on) { e.preventDefault(); el.focus(); el.classList.add('drag'); onValue(el, sliderAt(el, e.clientX), false); }
    });
    root.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
      if (!drag.on && dx > 6 && dx > dy) { drag.on = true; drag.el.classList.add('drag'); }
      if (drag.on) onValue(drag.el, sliderAt(drag.el, e.clientX), true);
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      // タップ（ほとんど動かさずに離した）なら、その位置に合わせる
      if (e.type === 'pointerup' && !drag.on && Math.abs(e.clientY - drag.y) < 10) onValue(drag.el, sliderAt(drag.el, e.clientX), false);
      drag.el.classList.remove('drag');
      drag = null;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('keydown', e => {
      const el = e.target.closest && e.target.closest('.evs');
      if (!el) return;
      const unit = +el.dataset.unit || 1, now = +el.getAttribute('aria-valuenow'), max = +el.getAttribute('aria-valuemax');
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      // 1目盛り（努力値は4）ずつ。目盛りからずれた値（読み込んだ 6 など）は、まず目盛りにそろえる
      const v = d ? (d > 0 ? Math.floor(now / unit) * unit + unit : Math.ceil(now / unit) * unit - unit) : e.key === 'Home' ? 0 : e.key === 'End' ? max : null;
      if (v == null) return;
      e.preventDefault();
      onValue(el, Math.max(0, Math.min(max, v)), false);
    });
  }
  // 全角数字（日本語入力のまま打った場合）も受け付ける
  const digitsOf = el => String(el.value).normalize('NFKC').replace(/[^0-9]/g, '');
  function onCalcInput(el) {
    const d = digitsOf(el), n = d === '' ? 0 : parseInt(d, 10);
    let max;
    if (el.id === 'c-lv') { max = 100; calc.level = Math.max(1, Math.min(max, n)); syncLevelChips(); }
    else if (el.dataset.iv != null) { max = 31; calc.iv[+el.dataset.iv] = Math.min(max, n); }
    else return;
    if (n > max) el.value = max;        // 上限を超えた入力はその場で上限に直す
    saveCalc(); refreshCalc();
  }

  // ---- 詳細 ------------------------------------------------------------
  const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const dbar = where => `<div class="dbar"><button type="button" class="back" data-act="back">${BACK_SVG}戻る</button><span class="where">${esc(where)}</span></div>`;
  const sec = (title, body, sub) => `<section class="sec"><h3>${title}${sub ? `<small>${sub}</small>` : ''}</h3>${body}</section>`;
  const kv = (k, v, text) => `<div><dt>${k}</dt><dd${text ? ' class="t"' : ''}>${v}</dd></div>`;
  const tpill = t => `<span class="tpill t${t}"><b aria-hidden="true">${T[t][2]}</b>${T[t][1]}</span>`;
  function bigThumb(t1, t2) {
    const one = t => `<span class="t${t}">${T[t][2]}<small>${T[t][1]}</small></span>`;
    return `<div class="bigthumb" role="img" aria-label="${esc(typeName(t1, t2))}タイプ">${one(t1)}${t2 >= 0 ? one(t2) : ''}</div>`;
  }
  function srcNote(src) {
    if (!src) return '';
    if (src.indexOf('EN:') === 0) {
      const g = src.slice(3);
      return `<p class="fine">日本語の説明文が元データにないため、英語版（${esc(SRC_LABEL[g] || g)}）の説明文を表示しています。</p>`;
    }
    return `<p class="fine">${esc(SRC_LABEL[src] || src)}の説明文です。</p>`;
  }
  function pickGame(avail) {
    if (detailGame && avail.indexOf(detailGame) >= 0) return detailGame;
    if (avail.indexOf(st.game) >= 0) return st.game;
    return avail[0];
  }
  function gameSeg(avail, g) {
    return '<div class="seg" role="group" aria-label="技データのゲーム">' + GAMES.map(x =>
      `<button type="button" data-lsgame="${x}" aria-pressed="${x === g}" title="${GAME_FULL[x]}"${avail.indexOf(x) < 0 ? ' disabled' : ''}>${GAME_LABEL[x]}</button>`).join('') + '</div>';
  }

  function matchupHTML(t1, t2) {
    const g = { 400: [], 200: [], 50: [], 25: [], 0: [] };
    for (const a of TYPE_ORDER) {
      let m = EFF[a * 18 + t1];
      if (t2 >= 0) m = (m * EFF[a * 18 + t2]) / 100;
      if (g[m]) g[m].push(a);
    }
    const rows = [[400, '×4'], [200, '×2'], [50, '×½'], [25, '×¼'], [0, '×0']].filter(([k]) => g[k].length);
    return `<dl class="mu">${rows.map(([k, lab]) => `<dt>${lab}</dt><dd>${g[k].map(tpill).join('')}</dd>`).join('')}</dl>`;
  }
  function evoHTML(s) {
    const chain = D.S.filter(x => x[S_CHAIN] === s[S_CHAIN]);
    if (chain.length < 2) return '';
    const ids = new Set(chain.map(x => x[S_ID])), kids = new Map(), roots = [];
    for (const x of chain) {
      const f = x[S_FROM];
      if (f && ids.has(f)) { if (!kids.has(f)) kids.set(f, []); kids.get(f).push(x); }
      else roots.push(x);
    }
    const node = x => {
      const bp = baseOf.get(x[S_ID]);
      const label = esc(x[S_NAME]) + (x[S_LV] ? `<span class="lv">Lv.${x[S_LV]}</span>` : '');
      const self = x[S_ID] === s[S_ID] || !bp
        ? `<span class="cur"${x[S_ID] === s[S_ID] ? ' aria-current="true"' : ''}>${label}</span>`
        : `<a href="#/p/${bp[P_ID]}">${label}</a>`;
      const ch = kids.get(x[S_ID]);
      return `<li>${self}${ch ? `<ul>${ch.map(node).join('')}</ul>` : ''}</li>`;
    };
    return `<div class="evo"><ul>${roots.map(node).join('')}</ul></div>`;
  }
  function moveTr(m, lv) {
    return `<tr>${lv !== null ? `<td class="lv">${lv}</td>` : ''}<td class="ty"><span class="t${m[M_TYPE]}" role="img" aria-label="${T[m[M_TYPE]][1]}">${T[m[M_TYPE]][2]}</span></td>` +
      `<td class="nm"><a href="#/m/${m[M_ID]}">${esc(m[M_NAME])}</a></td><td class="c">${clsTag(m[M_CLS])}</td>` +
      `<td class="v">${dash(m[M_POW])}</td><td class="v">${dash(m[M_ACC])}</td></tr>`;
  }
  function learnsetHTML(p) {
    const pid = p[P_ID], avail = GAMES.filter(g => L[g][pid]);
    if (!avail.length) {
      const base = baseOf.get(p[P_DEX]);
      const tip = (p[P_FLAGS] & F_ALT) && base && GAMES.some(g => L[g][base[P_ID]])
        ? `<p class="fine"><a href="#/p/${base[P_ID]}">${esc(base[P_NAME])}</a>の覚える技を見る</p>` : '';
      return `<h3>覚える技</h3><p class="fine">この姿には、SV・チャンピオンズの技データがありません。</p>${tip}`;
    }
    const g = pickGame(avail), a = L[g][pid], groups = new Map();
    for (let i = 0; i < a.length; i += 3) {
      const k = a[i + 1];
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([a[i], a[i + 2]]);
    }
    const byName = (x, y) => collator.compare(MI.get(x[0])[M_NAME], MI.get(y[0])[M_NAME]);
    let h = `<h3>覚える技<small>${fmt(a.length / 3)}件</small></h3><div class="lsbar">${gameSeg(avail, g)}</div>`;
    for (const k of METHOD_ORDER) {
      const rows = groups.get(k);
      if (!rows) continue;
      rows.sort(k === 1 ? ((x, y) => x[1] - y[1] || byName(x, y)) : byName);
      h += `<div class="grp"><h4>${METHOD_LABEL[k]}<span class="num">${rows.length}</span></h4><div class="scroll-x"><table class="mtab">` +
        `<thead><tr>${k === 1 ? '<th class="l">Lv.</th>' : ''}<th class="l" colspan="2">技</th><th class="c">分類</th><th>威力</th><th>命中</th></tr></thead><tbody>` +
        rows.map(([mid, lv]) => moveTr(MI.get(mid), k === 1 ? (lv ? String(lv) : '進化') : null)).join('') + '</tbody></table></div></div>';
    }
    return h;
  }
  function plistHTML(rows) {
    return '<ul class="plist">' + rows.map(([p, how]) =>
      `<li><a href="#/p/${p[P_ID]}"><span class="nm"><span class="no">${pad(p[P_DEX])}</span>${esc(p[P_NAME])}</span>` +
      `<span class="how">${esc(how)}</span>${thumb(p[P_T1], p[P_T2])}</a></li>`).join('') + '</ul>';
  }
  function learnersHTML(mid) {
    const avail = GAMES.filter(g => learnIndex(g).has(mid));
    if (!avail.length) return '<h3>覚えるポケモン</h3><p class="fine">SV・チャンピオンズで、この技を覚えるポケモンのデータはありません。</p>';
    const g = pickGame(avail), by = new Map();
    for (const [pid, meth, lv] of learnIndex(g).get(mid)) {
      if (!by.has(pid)) by.set(pid, []);
      by.get(pid).push(meth === 1 ? (lv ? 'Lv.' + lv : '進化') : METHOD_SHORT[meth]);
    }
    const ids = [...by.keys()].filter(pid => PI.has(pid)).sort((a, b) => pIndex.get(a) - pIndex.get(b));
    return `<h3>覚えるポケモン<small>${fmt(ids.length)}件</small></h3><div class="lsbar">${gameSeg(avail, g)}</div>` +
      plistHTML(ids.map(pid => [PI.get(pid), by.get(pid).filter(Boolean).join('・')]));
  }

  const bmLabel = pid => (BM.has(pid) ? '★ ブックマーク済み' : '☆ ブックマーク');
  // 「チームに追加」：バトル側のチームの一覧から選ぶ。このポケモンを使えないルールのチームは押せない
  function taddHTML(pid) {
    const bt = window.BT, ok = new Set(bt.usable(pid)), teams = bt.teams();
    const rules = [['ch', 'singles'], ['ch', 'doubles'], ['sv', 'singles'], ['sv', 'doubles']];
    let h = '<p class="fine">入れたいチームを選んでください。技・持ち物・能力ポイントは「おまかせ」と同じ考え方で入れておき、あとでバトルのチーム画面から変えられます。</p>';
    h += teams.length ? '<ul class="tlist">' + teams.map(t => {
      const can = ok.has(t.game) && t.count < 6;
      return `<li><button type="button" data-tadd="${esc(t.id)}"${can ? '' : ' disabled'}><span class="tn">${esc(t.name)}</span>` +
        `<span class="tm">${esc(t.label)}・${t.count}/6${!ok.has(t.game) ? '・このルールでは使えません' : t.count >= 6 ? '・満員' : ''}</span></button></li>`;
    }).join('') + '</ul>' : '<p class="fine">まだチームがありません。</p>';
    h += '<p class="flab">新しいチームを作って入れる</p><div class="tnew">' + rules.map(([g, r]) => {
      const [gl, rl] = bt.ruleLabel(g, r).split('・');
      return `<button type="button" data-tnew="${g}_${r}"${ok.has(g) ? '' : ' disabled'}><span class="g">${esc(gl)}</span><span class="r">${esc(rl)}</span></button>`;
    }).join('') + '</div><p class="fine" id="tadd-msg" role="status"></p>';
    return h;
  }
  function viewP(p) {
    const s = SP.get(p[P_DEX]), t1 = p[P_T1], t2 = p[P_T2];
    document.title = p[P_NAME] + '｜ポケモンデータ検索';
    const note = (p[P_FLAGS] & F_MEGA) ? 'メガシンカ（バトル中のみ）' : (p[P_FLAGS] & F_BATTLE) ? 'バトル中のみの姿' : '';
    let h = dbar('ポケモン');
    h += `<div class="dhead"><div><div class="meta"><span class="num">No.${pad(p[P_DEX])}</span>${esc(s[S_GENUS])}</div>` +
      `<h2 tabindex="-1">${esc(p[P_NAME])}</h2><div class="en">${esc(s[S_EN])}</div>${note ? `<span class="note">${note}</span>` : ''}</div>${bigThumb(t1, t2)}</div>`;
    h += `<div class="pacts"><button type="button" class="pbtn" data-act="bm" data-pid="${p[P_ID]}" aria-pressed="${BM.has(p[P_ID])}">${bmLabel(p[P_ID])}</button>` +
      (document.getElementById('bt') ? `<button type="button" class="pbtn" data-act="tadd" data-pid="${p[P_ID]}" aria-expanded="false">チームに追加</button>` : '') +
      `</div><div class="tadd" id="tadd" hidden></div>`;
    h += sec('基本データ', `<dl class="kv">${kv('タイプ', esc(typeName(t1, t2)), true)}${kv('高さ', (p[P_HT] / 10).toFixed(1) + ' m')}` +
      `${kv('重さ', (p[P_WT] / 10).toFixed(1) + ' kg')}${kv('登場', `第${p[P_GEN]}世代`, true)}` +
      `${s[S_CAT] ? kv('区分', s[S_CAT] === 1 ? '伝説のポケモン' : '幻のポケモン', true) : ''}</dl>`);
    let sh = '';
    for (let i = 0; i < 6; i++) {
      const v = p[P_ST + i];
      sh += `<div class="strow"><span class="lab"><b>${STAT_KEYS[i]}</b>${STAT_NAMES[i]}</span><span class="v">${v}</span>` +
        `<span class="bar t${t1}"><i style="--w:${Math.min(100, v / 2)}%"></i></span></div>`;
    }
    sh += `<div class="strow total"><span class="lab">合計</span><span class="v">${totals.get(p[P_ID])}</span><span></span></div>`;
    h += sec('種族値', sh);
    h += `<section class="sec calc" id="calc" data-pid="${p[P_ID]}">${calcHTML(p)}</section>`;
    const abs = [];
    if (p[P_A1]) abs.push([p[P_A1], false]);
    if (p[P_A2] && p[P_A2] !== p[P_A1]) abs.push([p[P_A2], false]);
    if (p[P_AH] && p[P_AH] !== p[P_A1] && p[P_AH] !== p[P_A2]) abs.push([p[P_AH], true]);
    h += sec('特性', abs.map(([aid, hidden]) => {
      const a = AI.get(aid);
      return `<div class="ab"><a href="#/a/${aid}">${esc(a[A_NAME])}</a>${hidden ? '<span class="tag">隠れ特性</span>' : ''}` +
        `<p>${a[A_DESC] ? esc(a[A_DESC]) : '説明文なし'}</p></div>`;
    }).join('') || '<p class="fine">特性のデータがありません。</p>');
    h += sec('受けるダメージ', matchupHTML(t1, t2), 'タイプ相性だけで計算');
    const evo = evoHTML(s);
    if (evo) h += sec('進化の系統', evo + '<p class="fine">Lv. は、条件がレベルだけの進化に表示しています。</p>');
    const others = P.filter(q => q[P_DEX] === p[P_DEX] && q[P_ID] !== p[P_ID]);
    if (others.length) h += sec('別の姿', `<div class="forms">${others.map(q => `<a href="#/p/${q[P_ID]}">${esc(q[P_NAME])}</a>`).join('')}</div>`);
    h += `<section class="sec" id="ls" data-pid="${p[P_ID]}">${learnsetHTML(p)}</section>`;
    return h;
  }
  function viewM(m) {
    document.title = m[M_NAME] + '｜ポケモンデータ検索';
    const fact = (k, v, t) => `<div><dt>${k}</dt><dd${t ? ' class="t"' : ''}>${v}</dd></div>`;
    let h = dbar('技');
    h += `<div class="dhead"><div><div class="meta"><span class="num">No.${m[M_ID]}</span>第${m[M_GEN]}世代</div>` +
      `<h2 tabindex="-1">${esc(m[M_NAME])}</h2><div class="en">${esc(m[M_EN])}</div></div>${bigThumb(m[M_TYPE], -1)}</div>`;
    h += sec('データ', `<dl class="facts">${fact('威力', dash(m[M_POW]))}${fact('命中', dash(m[M_ACC]))}${fact('PP', dash(m[M_PP]))}` +
      `${fact('分類', CLS_NAME[m[M_CLS]], true)}${fact('優先度', signed(m[M_PRIO]))}${fact('範囲', esc(TARGET[m[M_TGT]] || '—'), true)}</dl>` +
      (m[M_ACC] == null ? '<p class="fine">命中が「—」の技は、命中の判定がない技です。</p>' : ''));
    h += sec('説明', m[M_DESC] ? `<p class="desc">${esc(m[M_DESC])}</p>${srcNote(m[M_SRC])}` : '<p class="fine">説明文のデータがありません。</p>');
    h += effHTML(m);
    h += `<section class="sec" id="lr" data-mid="${m[M_ID]}">${learnersHTML(m[M_ID])}</section>`;
    return h;
  }
  function viewA(a) {
    document.title = a[A_NAME] + '｜ポケモンデータ検索';
    let h = dbar('特性');
    h += `<div class="dhead one"><div><div class="meta"><span class="num">No.${a[A_ID]}</span>第${a[A_GEN]}世代</div>` +
      `<h2 tabindex="-1">${esc(a[A_NAME])}</h2><div class="en">${esc(a[A_EN])}</div>` +
      `${a[A_NAME] === a[A_EN] ? '<span class="note">日本語名が元データにないため英語名で表示</span>' : ''}</div></div>`;
    h += sec('説明', a[A_DESC] ? `<p class="desc">${esc(a[A_DESC])}</p>${srcNote(a[A_SRC])}` : '<p class="fine">説明文のデータがありません。</p>');
    const g = st.game, aid = a[A_ID];
    const list = P.filter(p => (p[P_A1] === aid || p[P_A2] === aid || p[P_AH] === aid) && inGameP(p, g));
    const how = p => (p[P_AH] === aid && p[P_A1] !== aid && p[P_A2] !== aid ? '隠れ特性' : '');
    h += sec('この特性をもつポケモン',
      list.length ? plistHTML(list.map(p => [p, how(p)])) : '<p class="fine">該当するポケモンがいません。</p>',
      (g !== 'all' ? GAME_LABEL[g] + 'の技データがあるポケモン・' : '') + fmt(list.length) + '件');
    return h;
  }
  function renderDetail(kind, id) {
    if (kind === 'p' && PI.has(id)) return viewP(PI.get(id));
    if (kind === 'm' && MI.has(id)) return viewM(MI.get(id));
    if (kind === 'a' && AI.has(id)) return viewA(AI.get(id));
    document.title = '見つかりません｜ポケモンデータ検索';
    return dbar('') + '<p class="empty">指定されたデータが見つかりません。一覧から探し直してください。</p>';
  }

  // ---- 画面遷移（#/p/6 のようなハッシュ。ブラウザの戻るでも一覧に戻れる） ----
  function onHash() {
    const h = location.hash;
    if (inBattle()) return;
    if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop();
    else navStack.push(h);
    route();
  }
  function goBack() {
    if (navStack.length > 1) history.back();
    else location.hash = '#/';
  }
  function route() {
    if (inBattle()) return;
    const m = /^#\/([pma])\/(\d+)$/.exec(location.hash);
    if (m) {
      if (view === 'list') listY = window.pageYOffset;
      view = 'detail';
      els.detail.classList.remove('go');
      els.detail.innerHTML = renderDetail(m[1], +m[2]);
      refreshCalc();
      els.listView.hidden = true;
      els.detail.hidden = false;
      window.scrollTo(0, 0);
      requestAnimationFrame(() => requestAnimationFrame(() => els.detail.classList.add('go')));
    } else if (view !== 'list') {
      view = 'list';
      els.detail.hidden = true;
      els.detail.innerHTML = '';
      els.listView.hidden = false;
      document.title = 'ポケモンデータ検索';
      if (bmDirty) { bmDirty = false; update(false); }
      window.scrollTo(0, listY);
    }
  }

  // ---- イベント ---------------------------------------------------------
  function wire() {
    let timer = 0;
    els.q.addEventListener('input', () => {
      st.q = els.q.value;
      els.qclear.hidden = !st.q;
      clearTimeout(timer);
      timer = setTimeout(update, 70);   // かな入力の途中でも絞り込む（ひらがなはカタカナとして照合）
    });
    els.q.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !HAS_KEYBOARD) els.q.blur();
    });
    els.qclear.addEventListener('click', e => {
      els.q.value = ''; st.q = ''; els.qclear.hidden = true;
      update();
      if (cameFromTouch(e)) els.q.blur(); else els.q.focus();
    });
    els.tabs.addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (!b || b.dataset.tab === st.tab) return;
      st.tab = b.dataset.tab;
      syncTabs(); buildCtrls(); update();
      if (!cameFromTouch(e)) els.q.focus();
    });
    els.gameSeg.addEventListener('click', e => {
      const b = e.target.closest('[data-game]');
      if (!b || b.dataset.game === st.game) return;
      st.game = b.dataset.game;
      store.set('pd.game', st.game);
      detailGame = null;
      if (st.game !== 'all') { calc.mode = st.game; saveCalc(); }   // ゲームを選んだら計算のしかたも合わせる
      syncGame(); update();
    });
    els.tgrid.addEventListener('click', e => {
      const b = e.target.closest('.tchip');
      if (!b) return;
      const t = +b.dataset.t, f = st[st.tab], i = f.types.indexOf(t);
      if (i >= 0) f.types.splice(i, 1);
      else {
        f.types.push(t);
        if (st.tab === 'p' && f.types.length > 2) f.types.shift();   // ポケモンは2タイプまで
      }
      syncTypeGrid(); update();
    });
    els.ctrls.addEventListener('change', e => {
      const s = e.target;
      if (s.tagName !== 'SELECT') return;
      const f = st[st.tab];
      if (s.id === 'f-gen') f.gen = +s.value;
      else if (s.id === 'f-sort') f.sort = s.value;
      else if (s.id === 'f-cls') f.cls = +s.value;
      s.parentNode.classList.toggle('on', s.selectedIndex !== 0);
      update();
    });
    els.ctrls.addEventListener('click', e => {
      const b = e.target.closest('#f-more');
      if (!b) return;
      st.more = !st.more;
      b.setAttribute('aria-expanded', String(st.more));
      els.more.hidden = !st.more;
      if (st.more) buildMore();
    });
    els.more.addEventListener('input', e => { if (e.target.dataset.pick) renderSugg(e.target); });
    els.more.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.dataset.pick || e.isComposing || e.keyCode === 229) return;
      const first = e.target.nextElementSibling.querySelector('[data-choose]');
      if (first) { e.preventDefault(); choose(first.dataset.choose); }
    });
    els.more.addEventListener('click', e => {
      const c = e.target.closest('[data-choose]');
      if (c) { choose(c.dataset.choose); return; }
      const u = e.target.closest('[data-unpick]');
      if (!u) return;
      const kind = u.dataset.unpick;
      st.p[kind] = 0;
      refreshPicker(kind);
      update();
      if (!cameFromTouch(e)) { const inp = els.more.querySelector(`[data-pick="${kind}"]`); if (inp) inp.focus(); }
    });
    els.more.addEventListener('change', e => {
      if (e.target.id === 'f-cat') {
        st.p.cat = e.target.value;
        e.target.parentNode.classList.toggle('on', e.target.selectedIndex !== 0);
      } else if (e.target.id === 'f-forms') st.p.forms = e.target.checked;
      else if (e.target.id === 'f-bm') st.p.bm = e.target.checked;
      else return;
      const btn = $('f-more');
      if (btn) btn.innerHTML = moreLabel();
      update();
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.picker')) for (const ul of els.more.querySelectorAll('.sugg')) ul.hidden = true;
    });
    els.reset.addEventListener('click', resetFilters);
    els.list.addEventListener('click', e => { if (e.target.closest('[data-act="reset"]')) resetFilters(); });
    els.detail.addEventListener('click', e => {
      if (e.target.closest('[data-act="back"]')) { goBack(); return; }
      const bmb = e.target.closest('[data-act="bm"]');
      if (bmb) {
        const pid = +bmb.dataset.pid;
        toggleBM(pid);
        bmb.textContent = bmLabel(pid);
        bmb.setAttribute('aria-pressed', String(BM.has(pid)));
        // 一覧の★も合わせる（「ブックマークだけ」で絞り込んでいるときは、戻ったときに一覧を作り直す）
        const nm = els.list.querySelector(`a[href="#/p/${pid}"] .nm`), star = nm && nm.querySelector('.bmk');
        if (nm && BM.has(pid) && !star) nm.insertAdjacentHTML('afterbegin', '<span class="bmk" aria-label="ブックマーク">★</span>');
        if (star && !BM.has(pid)) star.remove();
        if (st.p.bm) bmDirty = true;
        return;
      }
      const ta = e.target.closest('[data-act="tadd"]');
      if (ta) {
        const box = $('tadd'), open = box.hidden;
        box.hidden = !open; ta.setAttribute('aria-expanded', String(open));
        if (open) box.innerHTML = window.BT ? taddHTML(+ta.dataset.pid) : '<p class="fine">バトルのデータを準備しています。少し待ってから、もう一度押してください。</p>';
        return;
      }
      const tb = e.target.closest('[data-tadd], [data-tnew]');
      if (tb && window.BT) {
        const pid = +$('tadd').closest('#detail-view').querySelector('[data-act="tadd"]').dataset.pid;
        let tid = tb.dataset.tadd;
        if (!tid) { const [g, r] = tb.dataset.tnew.split('_'); tid = window.BT.create(g, r); }
        const res = window.BT.add(tid, pid);
        $('tadd').innerHTML = taddHTML(pid);
        $('tadd-msg').innerHTML = esc(res.msg) + (res.ok ? `　<a href="#/team/${esc(res.id)}">チームを開く</a>` : '');
        return;
      }
      const box = $('calc');
      if (box && box.contains(e.target) && onCalcClick(e, box)) return;
      const b = e.target.closest('[data-lsgame]');
      if (!b || b.disabled) return;
      detailGame = b.dataset.lsgame;
      const ls = $('ls'), lr = $('lr');
      if (ls) ls.innerHTML = learnsetHTML(PI.get(+ls.dataset.pid));
      if (lr) lr.innerHTML = learnersHTML(+lr.dataset.mid);
    });
    els.detail.addEventListener('input', e => { if (e.target.classList.contains('nin')) onCalcInput(e.target); });
    els.detail.addEventListener('focusout', e => { if (e.target.classList.contains('nin')) syncCalcInputs(); });
    els.detail.addEventListener('change', e => {
      if (e.target.id !== 'c-nat') return;
      const [u, d] = e.target.value.split(',').map(Number);
      calc.up = u; calc.down = d;
      saveCalc(); refreshCalc();
    });
    bindSliders(els.detail, onCalcSlide);
    document.addEventListener('keydown', e => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (inBattle()) return;
      if (e.key === 'Escape' && view === 'detail' && !/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) { goBack(); return; }
      if (e.key === '/' && view === 'list' && !/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) { e.preventDefault(); els.q.focus(); }
    });
    window.addEventListener('hashchange', onHash);
    new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) appendMore(); }, { rootMargin: '800px 0px' })
      .observe(els.sentinel);
  }

  async function init() {
    Object.assign(els, {
      list: $('list'), sentinel: $('sentinel'), summary: $('summary'), cnt: $('cnt'), reset: $('reset'),
      sticky: $('sticky'), tgrid: $('tgrid'), ctrls: $('ctrls'), more: $('more'), q: $('q'), qclear: $('q-clear'),
      tabs: document.querySelector('.tabs'), results: $('results'), listView: $('list-view'), detail: $('detail-view'),
      gameSeg: $('game-seg'), np: $('n-p'), nm: $('n-m'), na: $('n-a'),
    });
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    let data;
    try { data = await loadData(); } catch (err) {
      els.list.innerHTML = '<li class="empty">データを展開できませんでした。ページを再読み込みしてください。解決しない場合は、ブラウザを最新版に更新してください。</li>';
      console.error(err);
      return;
    }
    buildIndex(data);
    loadBM();
    const g = store.get('pd.game');
    if (g === 'all' || g === 'sv' || g === 'ch') st.game = g;
    if (!loadCalc() && st.game === 'ch') calc.mode = 'ch';
    const upd = ((data.meta && data.meta.updated) || '').slice(0, 10);
    $('asof').textContent = `種族値・技・特性（${upd} 時点のデータ）`;
    $('src-line').innerHTML = `データ：<a href="https://github.com/PokeAPI/pokeapi" target="_blank" rel="noopener">PokeAPI</a>` +
      `（GitHub 上の CSV、${esc(upd)} 時点）から作成。ポケモン ${fmt(P.length)} 件、技 ${fmt(M.length)} 件、特性 ${fmt(A.length)} 件。`;
    buildTypeGrid(); syncGame(); syncTabs(); buildCtrls();
    wire();
    update(false);
    navStack.push(location.hash);
    route();
    document.documentElement.setAttribute('data-pd-ready', '1');
  }
  init();
})();
