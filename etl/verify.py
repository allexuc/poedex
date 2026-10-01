"""生成した HTML を実ブラウザ（Playwright / Chromium）で動かして検証する。

- UI の件数は、SQLite に同じ条件を投げた結果と突き合わせる（UI だけ見ていると、
  フィルタが効いていないことに気づけない）
- DOM の有無ではなく、計算後のスタイルや座標などの実測値を見る
"""
import json, os, re, sqlite3, subprocess, sys, tempfile, time, unicodedata
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = (ROOT / "build" / "pokedex.html").as_uri()
DB = sqlite3.connect(ROOT / "build" / "pokedex.sqlite")
SHOTS = ROOT / "shots"
SHOTS.mkdir(exist_ok=True)
FONTS = Path(os.environ.get("FONTS_DIR", "/home/claude/fonts"))   # 本番と同じ Web フォントで撮るとき（なくても検証はできる）

# app.js の norm と同じ処理
PUNCT = re.compile(r"[\s・･\-‐‑–—―－_.,，、。'’\"“”()（）「」『』［］\[\]!！?？:：]")


def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).lower()
    s = "".join(chr(ord(c) + 0x60) if "\u3041" <= c <= "\u3096" else c for c in s)
    return PUNCT.sub("", s)


def q1(sql, *a):
    return DB.execute(sql, a).fetchone()[0]


results = []


def check(name, got, want):
    ok = got == want
    results.append(ok)
    print(("  ok  " if ok else "  NG  ") + f"{name}: UI={got} 期待={want}")


# ---- 期待値（SQLite） ----------------------------------------------------
N_P = q1("select count(*) from pokemon")
N_M = q1("select count(*) from moves")
N_A = q1("select count(*) from abilities")
FIRE, FLY, WATER = 9, 2, 10
species_kana = {r[0]: r for r in DB.execute("select id, kana, en from species")}
pk_rows = DB.execute("select id, dex, name, ident, form from pokemon").fetchall()


def search_pokemon(q):
    qn = norm(q)
    n = 0
    for pid, dex, name, ident, form in pk_rows:
        _, kana, en = species_kana[dex]
        key = "\u0001".join(norm(x) for x in (name, kana, en, ident, form))
        n += qn in key
    return n


def search_moves(q):
    qn = norm(q)
    return sum(1 for name, kana, en, desc, dk in DB.execute("select name, kana, en, description, description_kana from moves")
               if qn in "\u0001".join(norm(x) for x in (name, kana, en)) or qn in norm(desc) + "\u0001" + norm(dk))


def search_abilities(q, game=None):
    qn = norm(q)
    ok_ids = None
    if game:
        ok_ids = {a for row in DB.execute(
            "select a1, a2, ah from pokemon where id in (select pokemon_id from learnsets where game=?)", (game,))
            for a in row}
    return sum(1 for aid, name, kana, en, desc, dk in DB.execute("select id, name, kana, en, description, description_kana from abilities")
               if (ok_ids is None or aid in ok_ids)
               and (qn in "\u0001".join(norm(x) for x in (name, kana, en)) or qn in norm(desc) + "\u0001" + norm(dk)))


def font_css():
    css = []
    for pkg, files in (("fontsource-dela-gothic-one-5.3.0", ["400.css"]),
                       ("fontsource-biz-udpgothic-5.3.0", ["400.css", "700.css"]),
                       ("fontsource-biz-udgothic-5.3.0", ["700.css"])):
        for f in files:
            t = (FONTS / pkg / f).read_text()
            css.append(t.replace("url(./files/", f"url(https://fonts.gstatic.com/preview/{pkg}/files/"))
    return "\n".join(css)


def new_context(browser, **kw):
    ctx = browser.new_context(locale="ja-JP", **kw)
    fcss = font_css() if FONTS.exists() else ""

    def handle(route):
        url = route.request.url
        if url.startswith("https://fonts.googleapis.com/") and fcss:
            return route.fulfill(status=200, content_type="text/css", body=fcss)
        if url.startswith("https://fonts.gstatic.com/preview/"):
            p = FONTS / url.split("/preview/", 1)[1]
            if p.exists():
                return route.fulfill(status=200, content_type="font/woff2", body=p.read_bytes(),
                                     headers={"access-control-allow-origin": "*"})
        if url.startswith("http"):
            return route.abort()
        return route.continue_()
    ctx.route("**/*", handle)
    return ctx


def open_page(ctx, hash_=""):
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
    pg.goto(URL + hash_)
    pg.wait_for_selector("html[data-ready='1']", timeout=20000)
    pg.evaluate("document.fonts.ready")
    return pg, errs


def count(pg):
    return int(pg.inner_text("#cnt b").replace(",", ""))


def settle(pg, ms=250):
    pg.wait_for_timeout(ms)


# ---- 実数値：@smogon/calc（Pokémon Showdown のダメージ計算ツール）と突き合わせる ----------
NODE_PRELUDE = r"""
const calc = require('@smogon/calc');
const gen = calc.Generations.get(9);
const ST = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const NAT = {};
for (const n of gen.natures) {
  const up = n.plus && n.minus && n.plus !== n.minus ? ST.indexOf(n.plus) : 0;
  const down = up ? ST.indexOf(n.minus) : 0;
  if (!NAT[up + ',' + down]) NAT[up + ',' + down] = n.name;
}
function ref(mode, i, base, level, iv, inv, up, down) {
  const name = NAT[up + ',' + down];
  return mode === 'ch' ? calc.Stats.calcStatChampions(gen.natures, ST[i], base, inv, name)
                       : calc.Stats.calcStat(gen, ST[i], base, iv, inv, level, name);
}
"""


def node(script):
    with tempfile.NamedTemporaryFile("w", suffix=".js", dir=ROOT, delete=False) as f:
        f.write(script)
    try:
        r = subprocess.run(["node", f.name], cwd=ROOT, capture_output=True, text=True, timeout=900)
    finally:
        Path(f.name).unlink()
    if r.returncode:
        raise RuntimeError(r.stderr[-2000:])
    return json.loads(r.stdout)


def calc_ref(cases):
    """cases: [[mode, 能力の添字, 種族値, レベル, 個体値, 努力値/能力P, 上がる能力, 下がる能力], ...]"""
    return node(NODE_PRELUDE + f"console.log(JSON.stringify({json.dumps(cases)}.map(c => ref(...c))));")


def check_formula():
    """生成 HTML から計算関数そのものを取り出し、全ポケモンの種族値 × 全性格 × 設定の組み合わせで突き合わせる"""
    html = (ROOT / "build" / "pokedex.html").read_text(encoding="utf-8")
    body = html.split("// @stat-begin")[1].split("// @stat-end")[0].split("\n", 1)[1]
    bases = sorted({tuple(r) for r in DB.execute("select hp, atk, def, spa, spd, spe from pokemon")})
    script = NODE_PRELUDE + body + f"""
const bases = {json.dumps(bases)};
let checked = 0; const bad = [];
const note = (o) => {{ if (bad.length < 5) bad.push(o); }};
for (const b of bases) for (const key in NAT) {{
  const [up, down] = key.split(',').map(Number);
  for (let i = 0; i < 6; i++) {{
    for (const lv of [1, 5, 37, 50, 99, 100]) for (const iv of [0, 1, 15, 30, 31]) for (const ev of [0, 3, 4, 5, 8, 100, 251, 252]) {{
      const a = calcStat('sv', i, b[i], lv, iv, ev, up, down), e = ref('sv', i, b[i], lv, iv, ev, up, down);
      checked++; if (a !== e) note({{mode: 'sv', i, base: b[i], lv, iv, ev, up, down, app: a, ref: e}});
    }}
    for (let sp = 0; sp <= 32; sp++) {{
      const a = calcStat('ch', i, b[i], 50, 31, sp, up, down), e = ref('ch', i, b[i], 50, 31, sp, up, down);
      checked++; if (a !== e) note({{mode: 'ch', i, base: b[i], sp, up, down, app: a, ref: e}});
    }}
  }}
}}
console.log(JSON.stringify({{checked, natures: Object.keys(NAT).length, bad}}));
"""
    t0 = time.time()
    r = node(script)
    print(f"  {r['checked']:,} 通り（種族値 {len(bases)} 組 × 性格 {r['natures']} 種 × 設定）を {time.time() - t0:.1f}s で照合")
    for b in r["bad"]:
        print("   不一致:", b)
    check("アプリの計算式と @smogon/calc の不一致", len(r["bad"]), 0)
    # 性格の日本語名と、上がる/下がる能力の対応（公式名で確認）
    nat = {n: (u, d) for n, u, d in DB.execute("select name, up, down from natures")}
    check("性格：いじっぱり＝A↑C↓", nat["いじっぱり"], (1, 3))
    check("性格：ようき＝S↑C↓", nat["ようき"], (5, 3))
    check("性格：ひかえめ＝C↑A↓", nat["ひかえめ"], (3, 1))
    check("性格：おくびょう＝S↑A↓", nat["おくびょう"], (5, 1))
    check("性格：ずぶとい＝B↑A↓", nat["ずぶとい"], (2, 1))
    check("性格：まじめ＝補正なし", nat["まじめ"], (0, 0))


def outs(pg):
    return [int(pg.inner_text(f"#c-out-{i}")) for i in range(6)]


def inv_values(pg):
    return [int(v) for v in pg.eval_on_selector_all("[data-inv]", "e => e.map(x => x.value)")]


def verify_calc(b):
    ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg, errs = open_page(ctx, "#/p/445")
    base = list(DB.execute("select hp, atk, def, spa, spd, spe from pokemon where id=445").fetchone())
    JOLLY = (5, 3)

    def ref_all(mode, lv, ivs, invs, nature):
        return calc_ref([[mode, i, base[i], lv, ivs[i], invs[i], *nature] for i in range(6)])

    check("初期の計算のしかたは SV", pg.get_attribute('[data-cmode="sv"]', "aria-pressed"), "true")
    pg.select_option("#c-nat", "5,3")
    pg.tap('[data-preset="AS"]')
    check("SV Lv.50 ようき AS の実数値", outs(pg), ref_all("sv", 50, [31] * 6, [4, 252, 0, 0, 0, 252], JOLLY))
    check("  （よく知られた値 184-182-115-90-105-169）", outs(pg), [184, 182, 115, 90, 105, 169])
    tiers = [int(x) for x in re.findall(r"\d+", pg.inner_text("#c-tiers"))[1:]]   # 先頭は Lv
    want = calc_ref([["sv", 5, base[5], 50, 31, 252, 5, 1], ["sv", 5, base[5], 50, 31, 252, 0, 0],
                     ["sv", 5, base[5], 50, 31, 0, 0, 0], ["sv", 5, base[5], 50, 0, 0, 1, 5]])
    check("すばやさの目安（最速・準速・無振り・最遅）", tiers, want)
    pg.tap('[data-step="1"][data-i="2"]')
    check("AS（合計508）からは B を＋しても合計510を超えるので増えない", inv_values(pg)[2], 0)
    pg.tap('[data-preset="0"]')
    pg.tap('[data-step="1"][data-i="2"]')
    b1 = inv_values(pg)[2]
    pg.tap('[data-step="1"][data-i="2"]')
    b2 = inv_values(pg)[2]
    pg.tap('[data-step="-1"][data-i="2"]')
    b3 = inv_values(pg)[2]
    check("＋−で努力値が実数値の変わり目に動く（Lv.50: 4 → 12 → 4）", [b1, b2, b3], [4, 12, 4])
    check("  そのときの実数値", outs(pg)[2], calc_ref([["sv", 2, base[2], 50, 31, 4, *JOLLY]])[0])
    pg.tap('[data-preset="AS"]')
    pg.tap('[data-lv="100"]')
    check("Lv.100 に切り替えた実数値", outs(pg), ref_all("sv", 100, [31] * 6, inv_values(pg), JOLLY))
    pg.tap('[data-lv="50"]')
    pg.fill('[data-inv="1"]', "250")
    ref_a = calc_ref([["sv", 1, base[1], 50, 31, e, *JOLLY] for e in range(251)])
    waste = 250 - ref_a.index(ref_a[250])
    check("余分な努力値の表示（こうげき 250 振り）", f"こうげき {waste}" in pg.inner_text("#c-waste"), True)
    pg.fill('[data-inv="1"]', "２５２")
    check("全角数字の入力", outs(pg)[1], calc_ref([["sv", 1, base[1], 50, 31, 252, *JOLLY]])[0])
    for i in range(6):
        pg.fill(f'[data-inv="{i}"]', "252")
    check("合計が上限を超えたら警告", pg.eval_on_selector("#c-total", "e => e.classList.contains('over')"), True)
    pg.tap('[data-preset="AS"]')
    pg.tap('[data-ivp="s0"]')
    check("個体値 Sだけ0", outs(pg)[5], calc_ref([["sv", 5, base[5], 50, 0, 252, *JOLLY]])[0])
    pg.tap('[data-ivp="31"]')
    check("横スクロールが出ない（計算つきの詳細）", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"), True)
    pg.evaluate("document.getElementById('calc').scrollIntoView()")
    pg.screenshot(path=str(SHOTS / "m_calc_sv.png"))

    pg.tap('[data-cmode="ch"]')
    check("チャンピオンズでは個体値の欄がない", pg.eval_on_selector_all("[data-iv]", "e => e.length"), 0)
    check("チャンピオンズは Lv.50 固定の表示", pg.eval_on_selector_all(".lvfix", "e => e.length"), 1)
    pg.tap('[data-preset="AS"]')
    check("チャンピオンズ ようき AS（H2 A32 S32）の実数値", outs(pg), ref_all("ch", 50, [31] * 6, [2, 32, 0, 0, 0, 32], JOLLY))
    pg.tap('[data-step="1"][data-i="2"]')
    check("合計66のときは＋で増えない", inv_values(pg)[2], 0)
    pg.tap('[data-step="-1"][data-i="0"]')
    pg.tap('[data-step="1"][data-i="2"]')
    check("H を1減らせば B を1増やせる", inv_values(pg), [1, 32, 1, 0, 0, 32])
    check("  そのときの実数値", outs(pg), ref_all("ch", 50, [31] * 6, [1, 32, 1, 0, 0, 32], JOLLY))
    pg.evaluate("document.getElementById('calc').scrollIntoView()")
    pg.screenshot(path=str(SHOTS / "m_calc_ch.png"))
    pg.reload()
    pg.wait_for_selector("html[data-ready='1']")
    check("再読み込みしても設定が残る", [pg.get_attribute('[data-cmode="ch"]', "aria-pressed"), inv_values(pg)],
          ["true", [1, 32, 1, 0, 0, 32]])
    pg.close()

    pg, e2 = open_page(ctx, "#/p/292")
    errs += e2
    hp_ch = int(pg.inner_text("#c-out-0"))
    pg.tap('[data-cmode="sv"]')
    check("ヌケニンの HP は常に 1（チャンピオンズ・SV）", [hp_ch, int(pg.inner_text("#c-out-0"))], [1, 1])
    pg.goto(URL + "#/")
    pg.tap('#game-seg [data-game="ch"]')
    pg.goto(URL + "#/p/445")
    pg.wait_for_selector("#calc")
    check("ゲームをチャンピオンズにすると計算のしかたも合わせる", pg.get_attribute('[data-cmode="ch"]', "aria-pressed"), "true")
    print("  console/page errors:", errs or "なし")
    ctx.close()

    dark = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True,
                       has_touch=True, color_scheme="dark")
    pg, _ = open_page(dark, "#/p/445")
    pg.select_option("#c-nat", "1,3")
    pg.tap('[data-preset="HA"]')
    pg.evaluate("document.getElementById('calc').scrollIntoView()")
    pg.screenshot(path=str(SHOTS / "m_calc_dark.png"))
    dark.close()


def main():
    print("■ 実数値の計算式（@smogon/calc と照合）")
    check_formula()
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        mob = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(mob)

        print("■ 件数（UI と SQLite の突き合わせ）")
        check("ポケモン全件", count(pg), N_P)
        check("技タブの件数", int(pg.inner_text("#n-m").replace(",", "")), N_M)
        check("特性タブの件数", int(pg.inner_text("#n-a").replace(",", "")), N_A)
        pg.tap(f'.tchip[data-t="{FIRE}"]')
        check("ほのお", count(pg), q1("select count(*) from pokemon where t1=? or t2=?", FIRE, FIRE))
        pg.tap(f'.tchip[data-t="{FLY}"]')
        check("ほのお＋ひこう（両方）", count(pg),
              q1("select count(*) from pokemon where (t1=? and t2=?) or (t1=? and t2=?)", FIRE, FLY, FLY, FIRE))
        pg.tap(f'.tchip[data-t="{WATER}"]')   # 3つ目を押すと一番古い選択が外れる
        check("ひこう＋みず（3つ目で古い方が外れる）", count(pg),
              q1("select count(*) from pokemon where (t1=? and t2=?) or (t1=? and t2=?)", FLY, WATER, WATER, FLY))
        pg.tap(f'.tchip[data-t="{FLY}"]')
        pg.tap(f'.tchip[data-t="{WATER}"]')
        pg.select_option("#f-gen", "1")
        check("第1世代", count(pg), q1("select count(*) from pokemon where gen=1"))
        pg.tap(f'.tchip[data-t="{FIRE}"]')
        check("第1世代・ほのお", count(pg), q1("select count(*) from pokemon where gen=1 and (t1=? or t2=?)", FIRE, FIRE))
        pg.tap("#reset")
        check("リセット後", count(pg), N_P)
        pg.tap('#game-seg [data-game="sv"]')
        check("SV の技データあり", count(pg),
              q1("select count(distinct pokemon_id) from learnsets where game='sv'"))
        pg.tap("#f-more")
        check("条件パネルが表示される", pg.eval_on_selector("#more", "e => getComputedStyle(e).display"), "grid")
        pg.fill('[data-pick="move"]', "じしん")
        pg.tap('[data-choose="move:89"]')
        check("SV で じしん を覚える", count(pg),
              q1("select count(distinct pokemon_id) from learnsets where game='sv' and move_id=89"))
        pg.tap('#game-seg [data-game="all"]')
        check("SV か チャンピオンズで じしん を覚える", count(pg),
              q1("select count(distinct pokemon_id) from learnsets where move_id=89"))
        pg.tap('[data-unpick="move"]')
        pg.fill('[data-pick="ability"]', "いかく")
        pg.tap('[data-choose="ability:22"]')
        check("特性 いかく", count(pg), q1("select count(*) from pokemon where 22 in (a1, a2, ah)"))
        pg.tap('[data-unpick="ability"]')
        pg.select_option("#f-cat", "normal")
        check("伝説・幻を除く", count(pg),
              q1("select count(*) from pokemon p join species s on s.id=p.dex where s.category=0"))
        pg.select_option("#f-cat", "all")
        pg.uncheck("#f-forms")
        check("別の姿を除く", count(pg), q1("select count(*) from pokemon where flags & 1 = 0"))
        pg.check("#f-forms")
        pg.tap("#f-more")
        check("条件パネルを閉じると消える", pg.eval_on_selector("#more", "e => getComputedStyle(e).display"), "none")
        for q in ("ぴか", "リザ", "char", "メガ", "ぱるであ"):
            pg.fill("#q", q); settle(pg)
            check(f"検索「{q}」", count(pg), search_pokemon(q))
        pg.fill("#q", "25"); settle(pg)
        check("図鑑番号 25", count(pg), q1("select count(*) from pokemon where dex=25"))
        pg.fill("#q", ""); settle(pg)

        pg.tap("#tab-m")
        check("技タブ全件", count(pg), N_M)
        check("技タブで入力欄に自動フォーカスしない（タッチ）",
              pg.evaluate("document.activeElement !== document.getElementById('q')"), True)
        pg.tap(f'.tchip[data-t="{WATER}"]')
        pg.select_option("#f-cls", "3")
        check("みず・特殊", count(pg), q1("select count(*) from moves where type=? and class=3", WATER))
        pg.tap(f'.tchip[data-t="{FIRE}"]')
        check("みず か ほのお・特殊", count(pg), q1("select count(*) from moves where type in (?, ?) and class=3", WATER, FIRE))
        pg.tap("#reset")
        pg.fill("#q", "やけど"); settle(pg)
        check("技 検索「やけど」（名前＋説明文）", count(pg), search_moves("やけど"))
        pg.fill("#q", ""); settle(pg)
        pg.tap('#game-seg [data-game="ch"]')
        check("チャンピオンズで覚えられる技", count(pg),
              q1("select count(distinct move_id) from learnsets where game='ch'"))
        pg.tap("#tab-a")
        check("チャンピオンズの特性", count(pg), search_abilities("", "ch"))
        pg.fill("#q", "すばやさ"); settle(pg)
        check("特性 検索「すばやさ」（チャンピオンズ）", count(pg), search_abilities("すばやさ", "ch"))
        pg.tap('#game-seg [data-game="all"]')
        check("特性 検索「すばやさ」（すべて）", count(pg), search_abilities("すばやさ"))
        pg.fill("#q", ""); settle(pg)
        pg.tap("#tab-p")

        print("■ レイアウト（実測値）")
        pg.evaluate("window.scrollTo(0, 0)")
        h0 = pg.eval_on_selector("#sticky", "e => e.getBoundingClientRect().height")
        chip = pg.query_selector(f'.tchip[data-t="{FIRE}"]')
        y0 = chip.bounding_box()["y"]
        chip.tap(); settle(pg, 100)
        check("見えている操作子を押しても動かない", round(chip.bounding_box()["y"] - y0, 1), 0)
        chip.tap(); settle(pg, 100)
        for _ in range(12):
            pg.mouse.wheel(0, 900); settle(pg, 60)
        pg.evaluate("window.scrollTo(0, 9000)"); settle(pg, 300)
        deep = pg.evaluate("window.pageYOffset")
        h1 = pg.eval_on_selector("#sticky", "e => e.getBoundingClientRect().height")
        check("固定領域の高さが変わらない", round(h1 - h0, 1), 0)
        check("深くスクロールできている（追記式で行が増える）", deep > 5000, True)
        pg.fill("#q", "ドラ"); settle(pg)
        gap = pg.evaluate("document.getElementById('summary').getBoundingClientRect().top - document.getElementById('sticky').getBoundingClientRect().bottom")
        check("深い位置で条件を変えたら結果の先頭へ戻る", abs(gap) <= 1, True)
        pg.fill("#q", ""); settle(pg)
        check("横スクロールが出ない（一覧）", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"), True)
        fonts = pg.evaluate("""() => ['.tchip', '#list .thumb span'].map(sel => {
          const cs = getComputedStyle(document.querySelector(sel));
          return [cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), cs.fontWeight];
        })""")
        check("タイプの一文字表示は UD ゴシックの太字（絞り込み・一覧）", fonts, [["BIZ UDPGothic", "700"], ["BIZ UDPGothic", "700"]])

        print("■ 追記式の描画")
        pg.tap(f'.tchip[data-t="{WATER}"]')
        want = q1("select count(*) from pokemon where t1=? or t2=?", WATER, WATER)
        for _ in range(40):
            pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); settle(pg, 80)
        check("最後までスクロールすると全件が描画される", pg.eval_on_selector_all("#list > li.row", "e => e.length"), want)
        pg.tap(f'.tchip[data-t="{WATER}"]')

        print("■ 詳細画面と戻る")
        pg.evaluate("window.scrollTo(0, 1500)"); settle(pg, 300)
        y_before = pg.evaluate("window.pageYOffset")
        link = pg.query_selector_all("#list > li.row > a")
        target = next(a for a in link if 200 < a.bounding_box()["y"] < 700)
        name = target.query_selector(".nm").inner_text()
        target.tap(); settle(pg, 400)
        check("詳細の見出しが押した行と一致", pg.inner_text("#detail-view h2"), name)
        check("横スクロールが出ない（詳細）", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"), True)
        pg.tap('[data-act="back"]'); settle(pg, 400)
        check("戻ると一覧のスクロール位置が復元される", abs(pg.evaluate("window.pageYOffset") - y_before) <= 2, True)
        check("一覧が表示される", pg.eval_on_selector("#list-view", "e => getComputedStyle(e).display") != "none", True)

        pg.goto(URL + "#/p/6"); pg.wait_for_selector("html[data-ready='1']"); settle(pg, 500)
        vals = [int(v) for v in pg.eval_on_selector_all("#detail-view .strow .v", "e => e.map(x => x.textContent)")]
        check("種族値の合計", vals[6], sum(vals[:6]))
        check("リザードンの種族値", vals[:6], list(DB.execute("select hp,atk,def,spa,spd,spe from pokemon where id=6").fetchone()))
        mu = pg.eval_on_selector("#detail-view .mu", "e => e.innerText.replace(/\\s+/g, ' ')")
        check("タイプ相性 ×4 いわ", "×4 岩いわ" in mu.replace(" 岩 ", " 岩").replace("岩 いわ", "岩いわ"), True)
        check("タイプ相性 ×0 じめん", "じめん" in mu.split("×0")[-1], True)
        check("進化の Lv 表示", pg.inner_text("#detail-view .evo").count("Lv."), 2)
        check("バーが伸びる", pg.eval_on_selector("#detail-view .bar i", "e => e.getBoundingClientRect().width > 10"), True)
        pg.screenshot(path=str(SHOTS / "m_detail_p6.png"))

        pg.close()
        pg, errs2 = open_page(mob, "#/m/89"); settle(pg, 400)
        errs += errs2
        check("技の詳細（直接開く）", pg.inner_text("#detail-view h2"), "じしん")
        n_learn = pg.eval_on_selector_all("#lr .plist li", "e => e.length")
        check("じしんを覚えるポケモン（SV）", n_learn,
              q1("select count(distinct pokemon_id) from learnsets where game='sv' and move_id=89"))
        pg.screenshot(path=str(SHOTS / "m_detail_m89.png"))
        pg.tap('[data-act="back"]'); settle(pg, 300)
        check("直接開いた詳細から戻ると一覧", pg.eval_on_selector("#detail-view", "e => e.hidden"), True)
        t0 = time.time()
        pg.goto(URL + "#/m/182"); pg.wait_for_selector("html[data-ready='1']"); settle(pg, 100)
        print(f"  まもる の詳細（覚えるポケモン {pg.eval_on_selector_all('#lr .plist li', 'e => e.length')} 件）: {time.time() - t0:.2f}s")
        pg.goto(URL + "#/a/22"); pg.wait_for_selector("html[data-ready='1']"); settle(pg, 300)
        check("特性の詳細", pg.inner_text("#detail-view h2"), "いかく")
        pg.screenshot(path=str(SHOTS / "m_detail_a22.png"))
        pg.goto(URL + "#/p/99999"); pg.wait_for_selector("html[data-ready='1']"); settle(pg, 200)
        check("存在しない番号は案内を出す", "見つかりません" in pg.inner_text("#detail-view"), True)
        print("  console/page errors:", errs or "なし")
        mob.close()

        print("■ デスクトップ")
        desk = new_context(b, viewport={"width": 1280, "height": 900})
        pg, errs = open_page(desk)
        pg.click("#tab-m")
        check("デスクトップではタブ切替後に入力欄へフォーカス", pg.evaluate("document.activeElement.id"), "q")
        pg.keyboard.type("かえん"); settle(pg)
        check("技 検索「かえん」", count(pg), search_moves("かえん"))
        pg.screenshot(path=str(SHOTS / "d_moves.png"))
        desk.close()

        print("■ ダークモード")
        dark = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True,
                           has_touch=True, color_scheme="dark")
        pg, errs = open_page(dark)
        check("背景色（ダーク）", pg.evaluate("getComputedStyle(document.body).backgroundColor"), "rgb(14, 17, 23)")
        pg.screenshot(path=str(SHOTS / "m_dark_list.png"))
        pg.goto(URL + "#/p/445"); pg.wait_for_selector("html[data-ready='1']"); settle(pg, 500)
        pg.screenshot(path=str(SHOTS / "m_dark_detail.png"))
        dark.close()

        print("■ 実数値の画面（実ブラウザ）")
        verify_calc(b)
        b.close()

    print(f"\n{sum(results)}/{len(results)} 件の検証に合格")
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
