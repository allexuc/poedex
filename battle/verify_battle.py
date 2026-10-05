"""バトル画面を実ブラウザで操作して確かめる（人が操作する流れ・CPU 同士の自動対戦）。"""
import collections, json, os, re, statistics, subprocess, sys, tempfile, time, unicodedata
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "etl"))
from verify import new_context          # 図鑑の検証と同じ、本番フォントを使う設定
from playwright.sync_api import sync_playwright

B = Path(__file__).resolve().parent
URL = (B.parent / "build" / "app.html").as_uri()   # 図鑑とバトルを1つにまとめたページ
SHOTS = B / "shots"
results = []


def check(name, got, want):
    ok = got == want
    results.append(ok)
    print(("  ok  " if ok else "  NG  ") + f"{name}: 実際={got} 期待={want}")


def open_page(ctx, q=""):
    """q は「?autotest=1」や「#/teams」など。ハッシュがなければ対戦の画面（#/b）を開く。"""
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
    pg.goto(URL + q + ("" if "#" in q else "#/b"))
    pg.wait_for_selector("html[data-bt-ready='1'][data-pd-ready='1']", timeout=30000)
    return pg, errs


def sel_team(pg, side="you", key="ch_singles"):
    """対戦の画面で選んでいるチームの ID（保存されている内容から読む）"""
    return pg.evaluate("([k, s]) => JSON.parse(localStorage.getItem('pd.bt.v2')).sel[k][s]", [key, side])


def play_until_end(pg, max_actions=120, shot_at=None):
    """人の側（p1）の操作を、いちばん上の選択肢で進める。"""
    actions = 0
    while actions < max_actions:
        pg.wait_for_timeout(120)
        cmd = pg.locator("#b-cmd")
        if cmd.locator(".result").count():
            return actions
        pv = cmd.locator(".pvb")
        if pv.count():
            n = int(pg.evaluate("document.querySelector('#b-cmd .q').textContent.match(/(\\d)匹/)[1]"))
            for k in range(n):
                pv.nth(k).tap()
            cmd.locator("[data-act='pvgo']").tap()
            actions += 1
            continue
        mv = cmd.locator(".mvb:not([disabled])")
        if mv.count():
            if shot_at is not None and actions == shot_at:
                pg.screenshot(path=str(SHOTS / "battle_mid.png"))
            mv.first.tap(); actions += 1; continue
        tg = cmd.locator("[data-tg]")
        if tg.count():
            tg.first.tap(); actions += 1; continue
        sw = cmd.locator("[data-sw]")
        if sw.count():
            sw.first.tap(); actions += 1; continue
    return actions


TEAM = ("Zoroark-Hisui @ Focus Sash\nAbility: Illusion\nTimid Nature\n- Shadow Ball\n- Hyper Voice\n\n"
        "Dragonite @ Leftovers\nAbility: Multiscale\n- Extreme Speed\n\nGarchomp @ Life Orb\nAbility: Rough Skin\n- Earthquake\n")

def check_illusion(b):
    """相手（p2）のゾロアークが先発し、最後に選んだカイリューに化けている間の表示"""
    print("■ イリュージョン（相手のゾロアーク）")
    ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg, errs = open_page(ctx)                                # 先に対戦画面を開き、あなたのチーム（サンプル）を決めておく
    pg.goto(URL + "#/teams"); pg.wait_for_selector("[data-newteam]")
    pg.select_option("#nt-rule", "ch_singles")
    pg.tap("[data-newteam='empty']"); pg.wait_for_selector("#paste")
    tid = pg.evaluate("location.hash.split('/')[2]")
    pg.fill("#paste", TEAM); pg.tap(f"[data-import='{tid}']")
    pg.goto(URL + "#/b"); pg.wait_for_selector("#start")
    pg.select_option("[data-pickteam='opp']", tid)
    pg.tap("#seg-cpu [data-cpu='0']")                       # 両方を自分で操作する
    pg.tap("#start"); pg.wait_for_selector("#b-cmd .pvb")
    pv = pg.locator("#b-cmd .pvb")
    for k in range(3): pv.nth(k).tap()
    pg.tap("[data-act='pvgo']"); pg.wait_for_timeout(300)
    pv = pg.locator("#b-cmd .pvb")                            # 相手の選出：ゾロアーク → ガブリアス → カイリュー
    for k in (0, 2, 1): pv.nth(k).tap()
    pg.tap("[data-act='pvgo']"); pg.wait_for_selector("#b-cmd .mvb")
    foe = pg.locator("#b-field .pk").first
    check("化けている間は、相手のカードがカイリュー（ドラゴン・ひこう）", [foe.locator(".nm").inner_text(), foe.locator(".tts").inner_text().replace("\n", "")], ["カイリュー", "竜飛"])
    check("ログもカイリュー", "相手は カイリュー を くりだした" in pg.inner_text("#b-log"), True)
    def p2_moves():                                        # 相手（p2）の番なら シャドーボール を選ぶ
        if "相手（p2）の番" in pg.inner_text("#b-cmd .q"):
            pg.locator("#b-cmd .mvb").first.tap(); pg.wait_for_timeout(300)
    p2_moves()
    pg.wait_for_function("document.querySelector('#b-cmd .q') && document.querySelector('#b-cmd .q').textContent.includes('ガブリアス は どうする')", timeout=10000)
    eq = pg.locator("#b-cmd .mvb", has_text="じしん")
    check("技の相性の目安も化けている姿で（じしん → 効果なし）", "効果なし" in eq.inner_text(timeout=3000), True)
    pg.screenshot(path=str(SHOTS / "illusion.png"))
    eq.tap(); pg.wait_for_timeout(300)                        # あなた：じしん（本当は ゾロアーク に当たる）
    if pg.locator("#b-cmd .q").count(): p2_moves()
    pg.wait_for_function("document.querySelector('#b-log').innerText.includes('ターン 2') || document.querySelector('#b-cmd .result')", timeout=15000)
    pg.wait_for_timeout(300)
    log = pg.inner_text("#b-log")
    foe = pg.locator("#b-field .pk").first
    print("  ログ（抜粋）:", [l for l in log.splitlines() if 'ゾロアーク' in l or 'イリュージョン' in l][:4])
    check("攻撃が当たって正体が分かったら、ゾロアーク（ノーマル・ゴースト）", [foe.locator(".nm").inner_text(), foe.locator(".tts").inner_text().replace("\n", "")], ["ゾロアーク", "無霊"])
    check("  errors", errs, [])
    ctx.close()


YOU = ("Zoroark-Hisui @ Focus Sash\nAbility: Illusion\nTimid Nature\n- Shadow Ball\n\n"
       "Dragonite @ Leftovers\nAbility: Multiscale\n- Extreme Speed\n\nGarchomp @ Life Orb\nAbility: Rough Skin\n- Earthquake\n")
OPP = "".join(f"{sp}\nAbility: {ab}\nModest Nature\n- Ice Beam\n- Dark Pulse\n\n" for sp, ab in (("Sharpedo", "Rough Skin"), ("Blastoise", "Torrent"), ("Absol", "Pressure")))

def check_cpu_illusion(b):
    print("■ CPU があなたのイリュージョンにだまされる")
    ctx = new_context(b, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg, errs = open_page(ctx, "?autotest=1")
    pg.evaluate("([y, o]) => { __bt.useTexts('ch', 'singles', y, o); __bt.startHuman('ch', 'singles'); }", [YOU, OPP])
    pg.wait_for_selector("#b-cmd .pvb")
    pv = pg.locator("#b-cmd .pvb")
    for k in (0, 2, 1): pv.nth(k).tap()                      # あなた：ゾロアーク → ガブリアス → カイリュー（最後のカイリューに化ける）
    pg.tap("[data-act='pvgo']"); pg.wait_for_timeout(300)
    pv = pg.locator("#b-cmd .pvb")
    for k in range(3): pv.nth(k).tap()
    pg.tap("[data-act='pvgo']"); pg.wait_for_selector("#b-cmd .mvb")
    pg.wait_for_function("__bt.state().over === false && document.querySelector('#b-cmd .mvb')")
    fooled = pg.evaluate("__bt.cpuBestMove('p2')")
    knows = pg.evaluate("__bt.cpuBestMove('p2', true)")
    print("  CPU から見た相手:", fooled["seen"], "／ だまされているとき:", fooled["best"], "／ 正体を知っているとき:", knows["best"])
    check("CPU にはカイリュー（ドラゴン・ひこう）に見えている", [fooled["seen"]["name"], fooled["seen"]["types"]], ["カイリュー", ["Dragon", "Flying"]])
    check("カイリューだと思って れいとうビーム を選ぶ（正体を知っていれば あくのはどう）", [fooled["best"], knows["best"]], ["icebeam", "darkpulse"])
    check("  errors", errs, [])
    ctx.close()


LONG_TEAM = ("Tauros-Paldea-Blaze @ Choice Band\nAbility: Intimidate\n- Raging Bull\n- Close Combat\n- Flare Blitz\n- Wild Charge\n\n"
             "Urshifu-Rapid-Strike @ Choice Scarf\nAbility: Unseen Fist\n- Surging Strikes\n- Close Combat\n- U-turn\n- Aqua Jet\n\n"
             "Ogerpon-Hearthflame @ Hearthflame Mask\nAbility: Mold Breaker\n- Ivy Cudgel\n- Horn Leech\n- Spiky Shield\n- Swords Dance\n\n"
             "Zoroark-Hisui @ Focus Sash\nAbility: Illusion\n- Shadow Ball\n- Hyper Voice\n- Nasty Plot\n- Flamethrower\n\n"
             "Samurott-Hisui @ Life Orb\nAbility: Sharpness\n- Ceaseless Edge\n- Razor Shell\n- Sucker Punch\n- Swords Dance\n\n"
             "Necrozma-Dusk-Mane @ Leftovers\nAbility: Prism Armor\n- Sunsteel Strike\n- Earthquake\n- Dragon Dance\n- Morning Sun\n")
LONG_NAME = "W" * 40
FIND = """() => {
  const W = document.documentElement.clientWidth, out = [];
  for (const el of document.querySelectorAll('#app *')) {
    if (!el.getClientRects().length || el.closest('.scroll-x')) continue;
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > W + 1 || r.left < -1)) out.push('画面の外: ' + (el.className || el.tagName) + '「' + (el.textContent || '').trim().slice(0, 16) + '」');
  }
  for (const el of document.querySelectorAll('#app .mon, #app .pvb, #app .benchb, #app .mvb, #app .pk, #app .slot, #app .pickbtn, #app .card, #app .tlist button, #app .bar, #app .row > a')) {
    if (el.getClientRects().length && el.scrollWidth > el.clientWidth + 1) out.push('枠からあふれる: ' + el.className + '「' + el.textContent.trim().slice(0, 16) + '」');
  }
  return [...new Set(out)].slice(0, 6);
}"""

def check_overflow(b):
    print("■ 長い名前でも画面からはみ出さない")
    for width in (320, 390):
        ctx = new_context(b, viewport={"width": width, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(ctx)
        pg.goto(URL + "#/teams"); pg.wait_for_selector("[data-newteam]")
        pg.select_option("#nt-rule", "sv_singles")
        pg.tap("[data-newteam='empty']"); pg.wait_for_selector("#paste")
        tid = pg.evaluate("location.hash.split('/')[2]")
        pg.fill("#paste", LONG_TEAM); pg.tap(f"[data-import='{tid}']")
        pg.fill("#t-name", LONG_NAME)
        bad = {}
        def look(label, h=None, wait=None):
            if h:
                pg.goto(URL + h)
            if wait:
                pg.wait_for_selector(wait)
            pg.wait_for_timeout(250)
            r = pg.evaluate(FIND)
            if r:
                bad[label] = r
        look("チーム編集", f"#/team/{tid}", ".slot")
        look("1匹の編集", f"#/set/{tid}/0", "#s-nat")
        look("ポケモンを選ぶ", f"#/set/{tid}/0/pick/sp", "#pick-list li")
        look("持ち物を選ぶ", f"#/set/{tid}/0/pick/item", "#pick-list li")
        look("技を選ぶ", f"#/set/{tid}/0/pick/move0", "#pick-list li")
        look("チーム一覧", "#/teams", "#v-teams .card.team")
        pg.locator(f"#v-teams [data-useteam='{tid}']").tap(); pg.wait_for_selector("#start")
        look("対戦の設定")
        look("連戦", "#/sim", "#sim-go")
        pg.goto(URL + "#/b"); pg.wait_for_selector("#start")
        pg.tap("#start"); pg.wait_for_selector("#b-cmd .pvb")
        look("選出")
        pv = pg.locator("#b-cmd .pvb")
        for k in range(3): pv.nth(k).tap()
        pg.tap("[data-act='pvgo']"); pg.wait_for_selector("#b-cmd .mvb")
        look("対戦（技を選ぶ）")
        sw = pg.locator("#b-cmd [data-act='sw'], #b-cmd button", has_text="交代")
        if sw.count():
            sw.first.tap(); pg.wait_for_selector("#b-cmd [data-sw]"); look("対戦（交代先）")
        look("図鑑（ケンタロス パルデアのすがた）", "#/p/10251", "[data-act='tadd']")
        pg.tap("[data-act='tadd']"); pg.wait_for_selector("#tadd .tnew"); look("図鑑（チームに追加）")
        pg.goto(URL + "#/"); pg.wait_for_selector("#list .row"); pg.fill("#q", "すがた"); pg.wait_for_timeout(500); look("図鑑の一覧")
        pg.screenshot(path=str(SHOTS / f"overflow_{width}.png"))
        check(f"幅 {width}：どの画面も はみ出さない", bad, {})
        check(f"  errors（幅 {width}）", errs, [])
        ctx.close()


ZARD = "Charizard @ Charcoal\nAbility: Blaze\nModest Nature\n- Overheat\n- Flamethrower\n\n"
CPU_TEAM = ZARD + "Garchomp @ Life Orb\nAbility: Rough Skin\n- Earthquake\n- Dragon Claw\n\nMetagross @ Leftovers\nAbility: Clear Body\n- Meteor Mash\n- Earthquake\n"
YOU_TEAM = ("Snorlax @ Leftovers\nAbility: Thick Fat\nCareful Nature\n- Body Slam\n\nBlastoise @ Sitrus Berry\nAbility: Torrent\n- Surf\n\n"
            "Clefable @ Focus Sash\nAbility: Magic Guard\n- Moonblast\n")

def check_move_logic(b):
    print("■ 技の副作用と範囲を考えた技選び")
    ctx = new_context(b, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg, errs = open_page(ctx, "?autotest=1")
    mv = lambda g, r, ps, role: pg.evaluate("([g, r, ps, role]) => __bt.movesFor(g, r, ps, role)", [g, r, ps, role])
    bulky = mv("ch", "singles", "Charizard", {"kind": "attacker", "cat": 2, "fast": False})
    mixed = mv("ch", "singles", "Charizard", {"kind": "mixed", "cat": 2, "fast": True})
    print("  リザードン：耐久重視", bulky, "／ 両刀", mixed)
    check("長く戦う型（耐久重視）は オーバーヒート を避けて、ほかのほのお技", ["overheat" in bulky, any(x in bulky for x in ("fireblast", "flamethrower"))], [False, True])
    check("両刀は オーバーヒート を使う（とくこうが下がっても物理技で戦える）", "overheat" in mixed, True)
    nine_s = mv("ch", "singles", "Ninetales-Alola", {"kind": "attacker", "cat": 2, "fast": True})
    nine_d = mv("ch", "doubles", "Ninetales-Alola", {"kind": "attacker", "cat": 2, "fast": True})
    zard_d = mv("ch", "doubles", "Charizard", {"kind": "attacker", "cat": 2, "fast": True})
    print("  アローラキュウコン：シングル", nine_s, "／ ダブル", nine_d, "／ リザードン（ダブル）", zard_d)
    check("ダブルでは相手全体の技（ふぶき・マジカルシャイン・ねっぷう）", ["blizzard" in nine_d, "dazzlinggleam" in nine_d, "heatwave" in zard_d], [True, True, True])
    check("シングルでは命中の高い れいとうビーム", ["icebeam" in nine_s, "blizzard" in nine_s], [True, False])
    # 味方を巻き込まずに相手2匹に当たる技を持つポケモンの割合：相手全体の技（ふぶき・ねっぷう・いわなだれ など）と、
    # 受けられる仲間（ひこう・ふゆう・ちょすい など）がいるときの じしん・なみのり。シングルは相手全体の技だけを数える
    JS = """([g, r, n]) => {
      const D = PSEngine.Dex.forFormat(PSEngine.Dex.formats.get(g === 'ch' ? 'gen9championsvgc2026regmc' : 'gen9vgc2025regi'));
      const IMM = { Ground: ['levitate', 'eartheater'], Water: ['waterabsorb', 'stormdrain', 'dryskin'], Electric: ['voltabsorb', 'lightningrod', 'motordrive'],
        Fire: ['flashfire', 'wellbakedbody'], Grass: ['sapsipper'] };
      const safe = (s, type) => {
        const ab = D.toID(s.ability), sp = D.species.get(s.species);
        if (ab === 'telepathy' || (IMM[type] || []).includes(ab) || (type === 'Ground' && D.toID(s.item) === 'airballoon') || !D.getImmunity(type, sp.types)) return true;
        const st = D.items.get(s.item).megaStone, mg = st && st[sp.name] && D.species.get(st[sp.name]);
        return !!mg && ((IMM[type] || []).includes(D.toID(mg.abilities[0])) || !D.getImmunity(type, mg.types));
      };
      let sets = 0, hit = 0;
      for (let i = 0; i < n; i++) {
        const t = PSEngine.Teams.unpack(__bt.autoTeamCheck(g, r).packed);
        t.forEach((s, k) => {
          sets++;
          if (s.moves.map(id => D.moves.get(id)).some(m => m.category !== 'Status' && (m.target === 'allAdjacentFoes' ||
            (r === 'doubles' && m.target === 'allAdjacent' && t.some((o, j) => j !== k && safe(o, m.type)))))) hit++;
        });
      }
      return hit / sets;
    }"""
    for g in ("ch", "sv"):
        sg, db = pg.evaluate(JS, [g, "singles", 20]), pg.evaluate(JS, [g, "doubles", 20])
        print(f"  {g}：味方を巻き込まずに相手2匹に当たる技を持つポケモン シングル {sg:.0%}・ダブル {db:.0%}")
        check(f"{g}：ダブルでは相手2匹に当たる技を持つポケモンが多い（40ポイント以上）", db >= sg + 0.40, True)

    print("■ 対戦中：自分の能力が下がる技と交代")
    pg.evaluate("([y, o]) => { __bt.useTexts('ch', 'singles', y, o); __bt.startHuman('ch', 'singles'); }", [YOU_TEAM, CPU_TEAM])
    pg.wait_for_selector("#b-cmd .pvb")
    for _ in range(2):                                    # あなた・相手（どちらも人が操作する設定）の選出
        pv = pg.locator("#b-cmd .pvb")
        for k in range(3): pv.nth(k).tap()
        pg.tap("[data-act='pvgo']"); pg.wait_for_timeout(300)
    pg.wait_for_selector("#b-cmd .mvb")
    pg.wait_for_function("__bt.state().over === false")
    with_bench = pg.evaluate("__bt.cpuBestMove('p2')")["best"]
    last_one = pg.evaluate("__bt.cpuBestMove('p2', false, true)")["best"]
    print("  リザードン vs カビゴン：控えがいるとき", with_bench, "／ 最後の1匹のとき", last_one)
    check("控えがいれば オーバーヒート（撃ってから交代できる）、最後の1匹なら かえんほうしゃ", [with_bench, last_one], ["overheat", "flamethrower"])
    base = pg.evaluate("__bt.cpuSwitchRate('p2', 300, {})")
    after = pg.evaluate("__bt.cpuSwitchRate('p2', 300, { spa: -2 })")
    print(f"  交代を選ぶ割合：ふだん {base:.0%} ／ とくこうが2段階下がったあと {after:.0%}")
    check("とくこうが下がったあとは交代を選びやすい（10ポイント以上）", after >= base + 0.10, True)
    check("  errors", errs, [])
    ctx.close()


ALLY_JS = """([g, n]) => {
  const D = PSEngine.Dex.forFormat(PSEngine.Dex.formats.get(g === 'ch' ? 'gen9championsvgc2026regmc' : 'gen9vgc2025regi'));
  const IMM = { Ground: ['levitate', 'eartheater'], Water: ['waterabsorb', 'stormdrain', 'dryskin'], Electric: ['voltabsorb', 'lightningrod', 'motordrive'],
    Fire: ['flashfire', 'wellbakedbody'], Grass: ['sapsipper'] };
  const safe = (s, type) => {
    const ab = D.toID(s.ability), sp = D.species.get(s.species);
    if (ab === 'telepathy' || (IMM[type] || []).includes(ab) || (type === 'Ground' && D.toID(s.item) === 'airballoon') || !D.getImmunity(type, sp.types)) return true;
    const st = D.items.get(s.item).megaStone, mg = st && st[sp.name] && D.species.get(st[sp.name]);   // メガシンカ後の姿（ふゆう など）
    return !!mg && ((IMM[type] || []).includes(D.toID(mg.abilities[0])) || !D.getImmunity(type, mg.types));
  };
  let users = 0, ok = 0;
  for (let i = 0; i < n; i++) {
    const t = PSEngine.Teams.unpack(__bt.autoTeamCheck(g, 'doubles').packed);
    t.forEach((s, k) => {
      for (const ty of new Set(s.moves.map(id => D.moves.get(id)).filter(m => m.category !== 'Status' && m.target === 'allAdjacent').map(m => m.type))) {
        users++; if (t.some((o, j) => j !== k && safe(o, ty))) ok++;
      }
    });
  }
  return { users, ok };
}"""
CPU6 = ("Garchomp @ Life Orb\nAbility: Rough Skin\n- Earthquake\n- Dragon Claw\n- Rock Slide\n- Protect\n\n"
        "Corviknight @ Leftovers\nAbility: Pressure\n- Brave Bird\n- Body Press\n- Protect\n\n"
        "Metagross @ Sitrus Berry\nAbility: Clear Body\n- Meteor Mash\n- Protect\n\n"
        "Tyranitar @ Focus Sash\nAbility: Sand Stream\n- Rock Slide\n- Crunch\n- Protect\n\n"
        "Gengar @ Choice Scarf\nAbility: Cursed Body\n- Shadow Ball\n- Sludge Bomb\n\n"
        "Blastoise @ Lum Berry\nAbility: Torrent\n- Hydro Pump\n- Protect\n")
# あなたのチームは じめん技が抜群になるポケモン（でんき・ほのお・いわ）にして、CPU がガブリアスを先発に出しやすくする
YOU4 = ("Ampharos @ Leftovers\nAbility: Static\n- Thunderbolt\n- Protect\n\nManectric @ Sitrus Berry\nAbility: Lightning Rod\n- Thunderbolt\n- Protect\n\n"
        "Houndoom @ Focus Sash\nAbility: Flash Fire\n- Flamethrower\n- Protect\n\nAggron @ Lum Berry\nAbility: Sturdy\n- Iron Head\n- Protect\n")

def check_ally_safe(b):
    print("■ ダブル：味方にも当たる技の使い手には、受けない仲間を組ませる")
    ctx = new_context(b, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg, errs = open_page(ctx, "?autotest=1")
    for g in ("ch", "sv"):
        r = pg.evaluate(ALLY_JS, [g, 30])
        rate = r["ok"] / max(1, r["users"])
        print(f"  {g}：おまかせ30チームで、じしん・なみのり などの使い手 {r['users']}匹のうち、受けない仲間がいる {r['ok']}匹（{rate:.0%}）")
        check(f"{g}：おまかせでは使い手の9割以上に受けない仲間がいる（以前は約6割）", rate >= 0.9, True)
    pg.evaluate("([y, o]) => { __bt.useTexts('ch', 'doubles', y, o); __bt.startHuman('ch', 'doubles'); }", [YOU4, CPU6])
    pg.wait_for_selector("#b-cmd .pvb")
    pg.wait_for_function("__bt.cpuPreviews('p2', 1)[0].startsWith('team')")
    picks = pg.evaluate("__bt.cpuPreviews('p2', 300)")
    with_ch = [p[5:9] for p in picks if "1" in p[5:9]]            # ガブリアス（1番目）を選んだとき
    lead_ch = [p[5:7] for p in picks if "1" in p[5:7]]            # ガブリアスが先発のとき
    print(f"  CPU の選出300回：ガブリアスを選んだ {len(with_ch)}回・先発 {len(lead_ch)}回")
    check("ガブリアス（じしん）を選ぶときは、アーマーガア（ひこう）も必ず選ぶ", [len(with_ch) > 30, all("2" in p for p in with_ch)], [True, True])
    check("ガブリアスが先発なら、もう1匹の先発はアーマーガア", [len(lead_ch) > 10, all("2" in p for p in lead_ch)], [True, True])
    check("  errors", errs, [])
    ctx.close()


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        mob = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(mob)
        print("■ 最初の画面")
        check("バトル開始ボタンが押せる（サンプルチームで問題なし）", pg.is_enabled("#start"), True)
        check("横スクロールが出ない（ルール画面）", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"), True)
        check("タイプが2つあるポケモンは2つ表示（ガブリアス）", pg.locator("#teams .card.team").first.locator(".mon").first.locator(".tt").count(), 2)
        pg.screenshot(path=str(SHOTS / "setup.png"), full_page=True)

        print("■ シングル（チャンピオンズ）を人が操作")
        pg.select_option("[data-pickteam='opp']", sel_team(pg))   # 相手もサンプル（先頭はガブリアス）にして、表示を決まった形で確かめる
        pg.tap("#start")
        pg.wait_for_selector("#b-cmd .pvb")
        check("選出画面に自分の6匹が並ぶ", pg.locator("#b-cmd .pvb").count(), 6)
        check("選出画面でもタイプを2つ表示（自分・相手）", [pg.locator("#b-cmd .pvb").first.locator(".tt").count(), pg.locator("#b-cmd .pvfoe > span").first.locator(".tt").count()], [2, 2])
        pg.screenshot(path=str(SHOTS / "preview.png"))
        n = play_until_end(pg, shot_at=3)
        check("最後まで対戦できる", pg.locator("#b-cmd .result").count(), 1)
        print(f"  人の操作 {n} 回で決着")
        check("横スクロールが出ない（対戦中）", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"), True)
        pg.screenshot(path=str(SHOTS / "battle_end.png"))
        logtext = pg.inner_text("#b-log")
        check("ログに日本語の技名が出る", any(w in logtext for w in ["じしん", "ドラゴンクロー", "かえんほうしゃ", "シャドーボール", "ハイドロポンプ"]), True)
        check("ログに英語の技名が残らない", any(w in logtext for w in ["Earthquake", "Dragon Claw", "Shadow Ball"]), False)
        check("ログに双方の選出が出る", ["あなたの選出：" in logtext, "相手の選出：" in logtext], [True, True])
        end_at = max(logtext.find("勝ち"), logtext.find("引き分け"))
        check("選出の記録はログの最後（決着のあと）", 0 <= end_at < logtext.find("あなたの選出："), True)

        print("■ ダブル（SV）を人が操作")
        pg.tap("[data-act='setup']")
        pg.tap("#seg-game [data-game='sv']")
        pg.tap("#seg-rule [data-rule='doubles']")
        pg.tap("#start")
        pg.wait_for_selector("#b-cmd .pvb")
        n = play_until_end(pg)
        check("ダブルも最後まで対戦できる", pg.locator("#b-cmd .result").count(), 1)
        print(f"  人の操作 {n} 回で決着")

        print("■ 自分で両方を操作")
        pg.tap("[data-act='setup']")
        pg.tap("#seg-cpu [data-cpu='0']")
        pg.tap("#seg-rule [data-rule='singles']")
        pg.tap("#start")
        pg.wait_for_selector("#b-cmd .pvb")
        first = pg.inner_text("#b-cmd .q")
        play_until_end(pg, max_actions=1)            # p1 の選出だけを済ませる
        pg.wait_for_timeout(300)
        second = pg.inner_text("#b-cmd .q") if pg.locator("#b-cmd .q").count() else ""
        check("p1 の選出のあとに p2 の選出になる", ["p1" in first, "p2" in second], [True, True])
        pg.tap("[data-act='quit']"); pg.tap("[data-act='quit']")
        pg.tap("#seg-cpu [data-cpu='1']")
        print("  errors:", errs or "なし")
        mob.close()

        print("■ チームの編集")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(ctx)
        you = sel_team(pg)
        pg.goto(URL + f"#/team/{you}"); pg.wait_for_selector(".slot")
        check("チーム画面に6匹", pg.locator("a.slot:not(.empty)").count(), 6)
        pg.screenshot(path=str(SHOTS / "team.png"))
        pg.locator("a.slot").first.tap(); pg.wait_for_selector("#s-nat")
        pg.select_option("#s-nat", "Adamant")
        check("性格を変えると こうげきに↑が付く", pg.locator(".ctab tr").nth(2).locator(".up").count() > 0, True)
        before = pg.locator("[data-ev='2']").input_value()
        pg.locator("[data-step='-1'][data-i='0']").tap()
        pg.locator("[data-step='1'][data-i='2']").tap()
        check("＋で能力ポイントが1増える（チャンピオンズ）", int(pg.locator("[data-ev='2']").input_value()) - int(before), 1)
        pg.screenshot(path=str(SHOTS / "set.png"), full_page=True)
        pg.locator("a.pickbtn[href$='move0']").tap(); pg.wait_for_selector("#pick-q")
        pg.fill("#pick-q", "がんせき")
        rows = pg.locator("#pick-list [data-choose]")
        check("技の絞り込み（がんせき）", rows.count() >= 1, True)
        name = rows.first.locator(".nm").evaluate("e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('')")   # 効果の表記を除いた技の名前
        check("技の名前の下に効果（がんせきふうじ：すばやさ↓100%）", rows.first.locator(".eff").inner_text(), "すばやさ↓100%")
        rows.first.tap(); pg.wait_for_selector("#s-nat")
        check("選んだ技が1番目に入る", name in pg.locator(".mvgrid a").first.inner_text(), True)
        pg.goto(URL + "#/teams"); pg.wait_for_selector("[data-newteam]")
        pg.tap("[data-newteam='empty']"); pg.wait_for_selector("#paste")
        empty = pg.evaluate("location.hash.split('/')[2]")
        paste = ("Pikachu @ Light Ball\nAbility: Static\nEVs: 32 SpA / 32 Spe / 2 HP\nTimid Nature\n- Thunderbolt\n- Volt Switch\n- Fly\n- Protect\n\n"
                 "Mewtwo @ Leftovers\nAbility: Pressure\n- Psychic\n")
        pg.fill("#paste", paste)
        pg.tap(f"[data-import='{empty}']")
        notes = pg.inner_text("#import-notes")
        check("読み込み：使えないポケモン・覚えない技は外して知らせる", ["1匹を読み込みました" in notes, "外しました" in notes], [True, True])
        pg.goto(URL + "#/b")
        pg.wait_for_selector("#start")
        pg.select_option("[data-pickteam='opp']", empty)
        check("相手が1匹だと開始できず理由を表示", [pg.is_enabled("#start"), "3匹以上" in pg.inner_text("#problems")], [False, True])
        pg.select_option("[data-pickteam='opp']", "auto")
        check("相手を「おまかせ」に戻すと開始できる", pg.is_enabled("#start"), True)
        check("  errors", errs, [])
        ctx.close()

        print("■ 技を選ぶときの発動確率")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(ctx)
        pg.goto(URL + "#/teams"); pg.wait_for_selector("[data-newteam]")
        pg.select_option("#nt-rule", "ch_singles")
        pg.tap("[data-newteam='empty']"); pg.wait_for_selector("#paste")
        tid = pg.evaluate("location.hash.split('/')[2]")
        pg.fill("#paste", "Metagross @ Life Orb\\nAbility: Clear Body\\n- Meteor Mash\\n"); pg.tap(f"[data-import='{tid}']")
        pg.goto(URL + f"#/set/{tid}/0/pick/move1"); pg.wait_for_selector("#pick-list li")
        pg.fill("#pick-q", "アイアンヘッド"); pg.wait_for_timeout(300)
        check("チャンピオンズでは「ひるみ20%」", pg.locator("#pick-list .eff").first.inner_text(), "ひるみ20%")
        pg.fill("#pick-q", "コメットパンチ"); pg.wait_for_timeout(300)
        check("自分の能力が上がる確率（コメットパンチ）", pg.locator("#pick-list .eff").first.inner_text(), "自分のこうげき↑20%")
        check("  errors", errs, [])
        ctx.close()

        print("■ 倒れたあとの交代（ダブルで2匹が倒れ、控えが1匹のとき）")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        pg, errs = open_page(ctx, "?autotest=1")
        pg.evaluate("() => { __bt.setRule('ch', 'doubles'); __bt.start('ch', 'doubles'); }")
        pg.wait_for_timeout(300)
        mon = lambda name, det, cond, act: {"ident": f"p1: {name}", "details": f"{det}, L50", "condition": cond, "active": act,
                                             "stats": {}, "moves": [], "baseAbility": "", "item": ""}
        one_left = {"forceSwitch": [True, True], "rqid": 901, "side": {"name": "あなた", "id": "p1", "pokemon": [
            mon("エアームド", "Corviknight", "0 fnt", True), mon("ゴロンダ", "Pangoro", "0 fnt", True),
            mon("ゴリランダー", "Rillaboom", "120/207", False), mon("ハッサム", "Scizor", "0 fnt", False)]}}
        pg.evaluate("r => __bt.fakeRequest('p1', r)", one_left)
        check("控えが1匹なら、その1匹だけを選べる", pg.locator("#b-cmd [data-sw]").count(), 1)
        pg.locator("#b-cmd [data-sw]").first.tap(); pg.wait_for_timeout(200)
        check("選んだあとは残りの枠を「交代なし」にして送る", pg.evaluate("window.__sent"), "switch 3, pass")
        two_left = {"forceSwitch": [True, True], "rqid": 902, "side": {"name": "あなた", "id": "p1", "pokemon": [
            mon("エアームド", "Corviknight", "0 fnt", True), mon("ゴロンダ", "Pangoro", "0 fnt", True),
            mon("ゴリランダー", "Rillaboom", "120/207", False), mon("ハッサム", "Scizor", "80/177", False)]}}
        pg.evaluate("r => __bt.fakeRequest('p1', r)", two_left)
        pg.locator("#b-cmd [data-sw='4']").tap(); pg.wait_for_timeout(200)
        pg.locator("#b-cmd [data-sw='3']").tap(); pg.wait_for_timeout(200)
        check("控えが2匹なら、2枠とも選ぶ", pg.evaluate("window.__sent"), "switch 4, switch 3")
        check("  errors", errs, [])
        ctx.close()

        print("■ コピー・貼り付け")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        pg, errs = open_page(ctx)
        you = sel_team(pg)
        pg.goto(URL + f"#/team/{you}"); pg.wait_for_selector("[data-copyteam]")
        pg.tap("[data-copyteam]"); pg.wait_for_timeout(300)
        clip = pg.evaluate("navigator.clipboard.readText()")
        check("今の編成をコピー（Showdown の形式）", [clip.startswith("Garchomp @"), clip.count("\n- ") >= 20], [True, True])
        pg.evaluate("t => navigator.clipboard.writeText(t)", "Pikachu @ Light Ball\nAbility: Static\nTimid Nature\n- Thunderbolt\n- Protect\n\nGengar @ Focus Sash\nAbility: Cursed Body\n- Shadow Ball\n- Protect\n")
        pg.goto(URL + "#/teams"); pg.wait_for_selector("[data-newteam]")
        pg.tap("[data-newteam='empty']"); pg.wait_for_selector("[data-paste]")
        pg.tap("[data-paste]"); pg.wait_for_timeout(400)
        check("貼り付けて読み込む", ["2匹を読み込みました" in pg.inner_text("#import-notes"), pg.locator("a.slot:not(.empty)").count()], [True, 2])
        pg.screenshot(path=str(SHOTS / "team_clip.png"), full_page=True)
        ctx.close()
        ctx = new_context(b, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        pg, errs2 = open_page(ctx)
        pg.goto(URL + f"#/team/{sel_team(pg)}"); pg.wait_for_selector("[data-copyteam]")
        pg.tap("[data-copyteam]"); pg.wait_for_timeout(300)
        check("クリップボードの権限がなくてもコピーできる", "コピーしました" in pg.inner_text("#import-notes"), True)
        pg.tap("[data-paste]"); pg.wait_for_timeout(1500)
        check("読み取れないときは手で貼る方法を案内", "長押しして貼り付け" in pg.inner_text("#import-notes"), True)
        check("  errors", errs + errs2, [])
        ctx.close()

        check_illusion(b)
        check_cpu_illusion(b)
        check_overflow(b)
        check_move_logic(b)
        check_ally_safe(b)

        print("■ おまかせ編成（画面の操作）")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(ctx)
        opp_names = lambda: [x.inner_text() for x in pg.locator("#teams .card.team").nth(1).locator(".mon .nm").all()]
        check("相手は最初「おまかせ」", pg.locator("[data-pickteam='opp']").input_value(), "auto")
        n0 = opp_names()
        pg.tap("[data-reroll]")
        n1 = opp_names()
        check("「別のおまかせにする」で相手のチームが変わる", [len(n1), n1 != n0], [6, True])
        info = pg.locator("#teams .card.team").nth(1).locator(".fine").inner_text()
        check("弱点の補完の割合とメガシンカの数を表示", ["弱点を受けられる仲間がいる割合" in info, "メガシンカ" in info], [True, True])
        pg.screenshot(path=str(SHOTS / "auto_setup.png"), full_page=True)
        n2 = opp_names()
        pg.tap("#start"); pg.wait_for_selector("#b-cmd .pvb")
        foe = pg.locator("#b-cmd .pvfoe > span").evaluate_all("ss => ss.map(s => s.lastChild.textContent)")   # タイプの文字を除いた名前
        check("表示していた おまかせ のチームと対戦する", sorted(foe) == sorted(n2), True)
        pg.tap("[data-act='quit']"); pg.tap("[data-act='quit']"); pg.wait_for_selector("[data-reroll]")
        check("対戦のあとは、次の おまかせ を作っておく", opp_names() != n2, True)
        pg.tap("[data-saveauto]")
        saved = pg.locator("[data-pickteam='opp']").input_value()
        check("おまかせのチームを保存できる", [saved != "auto", "おまかせ" in pg.locator("[data-pickteam='opp'] option:checked").inner_text()], [True, True])
        pg.goto(URL + f"#/team/{saved}"); pg.wait_for_selector(".slot")
        check("チーム画面に型（役割）が出る", pg.locator(".slot .meta b").count(), 6)
        pg.screenshot(path=str(SHOTS / "auto_team.png"), full_page=True)
        check("  errors", errs, [])
        ctx.close()

        print("■ 複数のチーム")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(ctx, "#/teams")
        pg.wait_for_selector("[data-newteam]")
        n_before = pg.evaluate("JSON.parse(localStorage.getItem('pd.bt.v2') || '{\"teams\":[]}').teams.length")
        pg.select_option("#nt-rule", "sv_doubles")
        pg.tap("[data-newteam='auto']"); pg.wait_for_selector("#t-name")
        tid = pg.evaluate("location.hash.split('/')[2]")
        check("おまかせで新しいチーム（SV・ダブル）", [pg.locator("a.slot:not(.empty)").count(), "SV・ダブル" in pg.inner_text("#v-team")], [6, True])
        pg.fill("#t-name", "テスト用のチーム")
        pg.goto(URL + "#/teams"); pg.wait_for_selector("#v-teams .card.team")
        check("名前の変更が一覧に出る", "テスト用のチーム" in pg.inner_text("#v-teams"), True)
        pg.goto(URL + f"#/team/{tid}"); pg.wait_for_selector("[data-dupteam]")
        pg.tap("[data-dupteam]"); pg.wait_for_selector("#t-name")
        check("複製すると「のコピー」ができる", pg.locator("#t-name").input_value(), "テスト用のチーム のコピー")
        dup = pg.evaluate("location.hash.split('/')[2]")
        pg.tap("[data-delteam]"); pg.tap("[data-delteam]"); pg.wait_for_selector("#v-teams .card")
        n_after = pg.evaluate("JSON.parse(localStorage.getItem('pd.bt.v2')).teams.length")
        check("削除は2回押しで（チームの数）", n_after - n_before, 1)
        pg.locator(f"[data-useteam='{tid}']").tap(); pg.wait_for_selector("#start")
        check("「このチームで対戦」でルールとチームが選ばれる",
              [pg.locator("#seg-game [aria-pressed='true']").get_attribute("data-game"), pg.locator("#seg-rule [aria-pressed='true']").get_attribute("data-rule"),
               pg.locator("[data-pickteam='you']").input_value()], ["sv", "doubles", tid])
        check("  errors", errs, [])
        ctx.close()

        print("■ 以前の保存形式（ルールごとに2チーム）からの引き継ぎ")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        old = {"game": "ch", "rule": "singles", "cpu": True, "autoOpp": False, "teams": {"ch_singles": {
            "you": [{"sp": "Garchomp", "item": "choicescarf", "ability": "roughskin", "moves": ["earthquake", "dragonclaw"], "nature": "Jolly",
                     "evs": [2, 32, 0, 0, 0, 32], "ivs": [31] * 6, "tera": ""}],
            "opp": [{"sp": "Gengar", "item": "focussash", "ability": "cursedbody", "moves": ["shadowball"], "nature": "Timid",
                     "evs": [0, 0, 0, 32, 2, 32], "ivs": [31] * 6, "tera": ""}]}}}
        ctx.add_init_script(f"localStorage.setItem('pd.bt.v1', {json.dumps(json.dumps(old))});")
        pg, errs = open_page(ctx, "#/teams")
        pg.wait_for_selector("#v-teams .card.team")
        txt = pg.inner_text("#v-teams")
        check("以前のチームが「あなたのチーム」「相手のチーム」として残る", ["あなたのチーム（チャンピオンズ・シングル）" in txt, "相手のチーム（チャンピオンズ・シングル）" in txt], [True, True])
        check("  errors", errs, [])
        ctx.close()

        print("■ 図鑑からチーム編成（ブックマーク・チームに追加）")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(ctx, "#/p/445")
        pg.wait_for_selector("[data-act='bm']")
        pg.tap("[data-act='bm']")
        check("ブックマークのボタン", pg.inner_text("[data-act='bm']"), "★ ブックマーク済み")
        pg.goto(URL + "#/p/10034"); pg.wait_for_selector("[data-act='bm']")   # メガリザードンX
        pg.tap("[data-act='bm']")
        pg.goto(URL + "#/"); pg.wait_for_selector("#list .row")
        pg.fill("#q", "ガブリアス"); pg.wait_for_timeout(400)
        check("一覧に★が付く", pg.locator("#list a[href='#/p/445'] .bmk").count(), 1)
        pg.fill("#q", ""); pg.wait_for_timeout(300)
        pg.tap("#f-more"); pg.check("#f-bm"); pg.wait_for_timeout(400)
        check("「ブックマークしたポケモンだけ」で絞り込む", sorted(pg.locator("#list .row a").evaluate_all("as => as.map(a => a.getAttribute('href'))")), ["#/p/10034", "#/p/445"])
        pg.goto(URL + "#/p/445"); pg.wait_for_selector("[data-act='tadd']")
        pg.tap("[data-act='tadd']"); pg.wait_for_selector("#tadd [data-tnew]")
        pg.tap("#tadd [data-tnew='ch_singles']"); pg.wait_for_timeout(300)
        msg = pg.inner_text("#tadd-msg")
        check("新しいチームを作ってガブリアスを入れる", ["ガブリアスを入れました（1/6）" in msg, pg.locator("#tadd-msg a").count()], [True, 1])
        pg.locator("#tadd-msg a").tap(); pg.wait_for_selector("#v-team .slot")
        check("「チームを開く」でチーム画面に（技も入っている）", [pg.locator("a.slot:not(.empty)").count(), pg.locator("a.slot .mv span").first.inner_text() != "—"], [1, True])
        tid = pg.evaluate("location.hash.split('/')[2]")
        pg.goto(URL + f"#/set/{tid}/1/pick/sp"); pg.wait_for_selector("#pick-list li")
        heads = pg.locator("#pick-list li.hd").all_inner_texts()
        bm = pg.locator("#pick-list [data-choose]").first
        check("ポケモンを選ぶときにブックマークが先頭に出る", [heads[0].startswith("ブックマーク 2匹"), bm.locator(".bmk").count()], [True, 1])
        pg.locator("#pick-list [data-choose^='Charizard|']").first.tap(); pg.wait_for_selector("#s-nat")
        check("メガシンカの姿を選ぶと、元の姿＋メガストーンになる", unicodedata.normalize("NFKC", pg.inner_text("a.pickbtn[href$='/item']")), "リザードナイトX")
        pg.goto(URL + "#/p/445"); pg.wait_for_selector("[data-act='tadd']")
        pg.tap("[data-act='tadd']"); pg.wait_for_selector(f"#tadd [data-tadd='{tid}']")
        pg.tap(f"#tadd [data-tadd='{tid}']"); pg.wait_for_timeout(300)
        check("同じポケモンは入れられない", "もうガブリアスがいます" in pg.inner_text("#tadd-msg"), True)
        pg.goto(URL + "#/p/1008"); pg.wait_for_selector("[data-act='tadd']")         # ミライドン（チャンピオンズでは使えない）
        pg.tap("[data-act='tadd']"); pg.wait_for_selector("#tadd .tnew")
        check("使えないルールのチームは押せない", [pg.locator(f"#tadd [data-tadd='{tid}']").is_disabled(), pg.locator("#tadd [data-tnew='ch_singles']").is_disabled()], [True, True])
        pg.screenshot(path=str(SHOTS / "pokedex_tadd.png"), full_page=True)
        check("  errors", errs, [])
        ctx.close()

        print("■ 連戦シミュレーション")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(ctx, "#/sim")
        pg.wait_for_selector("#sim-go")
        pg.tap("[data-simn='10']"); pg.tap("#sim-go")
        t0 = time.time()
        pg.wait_for_function("document.querySelector('#sim-go') && document.querySelector('#sim-go').textContent === '開始' && document.querySelector('.simres')", timeout=240000)
        res = pg.inner_text("#sim-out")
        m = re.search(r"(\d+)勝 (\d+)敗(?: (\d+)分)?（(\d+)戦）", res)
        print(f"  10戦 {time.time() - t0:.1f}秒：", m.group(0) if m else res[:80])
        check("10戦して勝ち・負け・引き分けの合計が10", bool(m) and int(m.group(1)) + int(m.group(2)) + int(m.group(3) or 0) == 10 and m.group(4) == "10", True)
        rows = pg.locator(".simres table").first.locator("tbody tr")
        picks = [int(x.rstrip("%")) for x in rows.evaluate_all("rs => rs.map(r => r.cells[1].textContent)") if x.endswith("%")]
        check("あなたの6匹の戦績（選出率の合計が 3匹 × 100%）", [rows.count(), sum(picks)], [6, 300])
        check("手ごわかった相手の表", pg.locator(".simres table").count(), 2)
        pg.screenshot(path=str(SHOTS / "sim.png"), full_page=True)
        check("  errors", errs, [])
        ctx.close()

        print("■ おまかせ編成（中身）")
        ctx = new_context(b, viewport={"width": 390, "height": 844})
        pg, errs = open_page(ctx, "?autotest=1")
        FID = {("ch", "singles"): "gen9championsbssregmc", ("ch", "doubles"): "gen9championsvgc2026regmc",
               ("sv", "singles"): "gen9bssregi", ("sv", "doubles"): "gen9vgc2025regi"}
        packed = {}
        for (g, r), fid in FID.items():
            res = [pg.evaluate("([g, r]) => __bt.autoTeamCheck(g, r)", [g, r]) for _ in range(25)]
            rnd = [pg.evaluate("g => __bt.randomCoverage(g)", g) for _ in range(25)]
            probs = sorted({p for x in res for p in x["problems"]})
            check(f"{g} {r}：25チームに ルール・型と技の食い違いなし", probs, [])
            megas = sorted({x["megas"] for x in res})
            check(f"{g} {r}：メガシンカの数", megas, [1, 2] if g == "ch" else [0])
            cov = [x["coverage"] for x in res]
            print(f"  弱点を受けられる仲間がいる割合 おまかせ 平均{statistics.mean(cov):.2f}・最小{min(cov):.2f} ／ 無作為の6匹 平均{statistics.mean(rnd):.2f}")
            # 平均で見る（25チームのいちばん低い値は、天候の役を入れる都合などでぶれるため、下限は低めにする）
            check(f"{g} {r}：弱点の補完が平均95%以上・どのチームも75%以上", [statistics.mean(cov) >= 0.95, min(cov) >= 0.75], [True, True])
            themed = [x for x in res if x["theme"]]
            print(f"  天候・フィールドを軸にしたチーム {len(themed)}/25：", dict(collections.Counter(x["theme"] for x in themed)))
            check(f"{g} {r}：天候・フィールドを軸にしたチームがある（起こす役に「役」の表示）",
                  [len(themed) > 0, all(any("役" in n for n in x["roles"]) for x in themed)], [True, True])
            packed[fid] = [x["packed"] for x in res]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(packed, f)
        r = subprocess.run(["node", str(B / "validate-packed.js"), os.environ.get("PS_DIR", "/tmp/psfull"), f.name], capture_output=True, text=True)
        os.unlink(f.name)
        v = json.loads(r.stdout)
        check(f"Showdown の検証器（{v['total']}チーム）で問題なし", v["problems"][:3], [])
        for (g, r2) in FID:
            done = 0
            for _ in range(5):
                pg.evaluate("([g, r]) => { __bt.setRule(g, r); }", [g, r2])
                pg.evaluate("() => { __bt.autoBoth(); }")
                pg.evaluate("([g, r]) => __bt.start(g, r)", [g, r2])
                for _ in range(600):
                    pg.wait_for_timeout(20)
                    st = pg.evaluate("__bt.state()")
                    if st["over"]:
                        break
                done += st["over"] and not st["errors"]
            check(f"{g} {r2}：おまかせ同士の対戦5戦がエラーなく決着", done, 5)
        sw = collections.Counter()
        for (g, r2) in FID:
            for _ in range(8):
                pg.evaluate("([g, r]) => { __bt.setRule(g, r); __bt.autoBoth(); __bt.start(g, r); }", [g, r2])
                for _ in range(600):
                    pg.wait_for_timeout(20)
                    st = pg.evaluate("__bt.state()")
                    if st["over"]:
                        break
                sw[(g, r2, "switches")] += st["cpu"]["switches"]; sw[(g, r2, "moves")] += st["cpu"]["moves"]; sw[(g, r2, "status")] += st["cpu"]["status"]
            rate = sw[(g, r2, "switches")] / max(1, sw[(g, r2, "switches")] + sw[(g, r2, "moves")])
            print(f"  {g} {r2}：CPU の交代 {sw[(g, r2, 'switches')]}回（行動の {rate:.0%}）")
            check(f"{g} {r2}：CPU が交代を選ぶ（多すぎない）", 0 < sw[(g, r2, "switches")] and rate < 0.35, True)
            print(f"  {g} {r2}：CPU の技のうち変化技 {sw[(g, r2, 'status')] / max(1, sw[(g, r2, 'moves')]):.0%}")
        allst = sum(v for k, v in sw.items() if k[2] == "status") / max(1, sum(v for k, v in sw.items() if k[2] == "moves"))
        check("CPU が変化技も使う（全体の3%以上）", allst >= 0.03, True)    # 以前は 0〜1%。対戦ごとにぶれるので余裕を持たせる
        check("  errors", errs, [])
        ctx.close()

        print("■ CPU 同士の自動対戦（未対応のログ・エラーの洗い出し）")
        ctx = new_context(b, viewport={"width": 390, "height": 844})
        pg, errs = open_page(ctx, "?autotest=1")
        unknown, wins = collections.Counter(), collections.Counter()
        for game in ("ch", "sv"):
            for rule in ("singles", "doubles"):
                done = 0
                for _ in range(20):
                    pg.evaluate("([g, r]) => __bt.start(g, r)", [game, rule])
                    for _ in range(400):
                        pg.wait_for_timeout(25)
                        st = pg.evaluate("__bt.state()")
                        if st["over"]:
                            break
                    done += st["over"]
                    wins[st["winner"] or "引き分け"] += 1
                    unknown.update(st["unknown"])
                    if st["errors"]:
                        print("   errors:", st["errors"][:2])
                check(f"{game} {rule}：20戦すべて決着", done, 20)
        print("  勝敗:", dict(wins), " 未対応のログ:", dict(unknown) or "なし")
        print("■ ランダムなチーム（ルール上使えるものから作る）で CPU 同士")
        unknown2, undone, errors = collections.Counter(), 0, []
        for game in ("ch", "sv"):
            for rule in ("singles", "doubles"):
                for _ in range(30):
                    pg.evaluate("([g, r]) => { __bt.setRule(g, r); __bt.randomTeams(); __bt.start(g, r); }", [game, rule])
                    for _ in range(600):
                        pg.wait_for_timeout(20)
                        st = pg.evaluate("__bt.state()")
                        if st["over"]:
                            break
                    undone += not st["over"]
                    unknown2.update(st["unknown"])
                    errors += st["errors"]
        check("120戦すべて決着", undone, 0)
        check("対戦中のエラー", errors[:3], [])
        print("  訳せなかった効果（まれなもの）:", dict(unknown2) or "なし")
        check("ページのエラー", errs, [])
        ctx.close()
        b.close()
    print(f"\n{sum(results)}/{len(results)} 件の検証に合格")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
