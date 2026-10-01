"""バトル画面を実ブラウザで操作して確かめる（人が操作する流れ・CPU 同士の自動対戦）。"""
import collections, json, os, statistics, subprocess, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "etl"))
from verify import new_context          # 図鑑の検証と同じ、本番フォントを使う設定
from playwright.sync_api import sync_playwright

B = Path(__file__).resolve().parent
URL = (B / "build" / "battle.html").as_uri()
SHOTS = B / "shots"
results = []


def check(name, got, want):
    ok = got == want
    results.append(ok)
    print(("  ok  " if ok else "  NG  ") + f"{name}: 実際={got} 期待={want}")


def open_page(ctx, q=""):
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
    pg.goto(URL + q)
    pg.wait_for_selector("html[data-ready='1']", timeout=30000)
    return pg, errs


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
        pg.goto(URL + "#/team/you"); pg.wait_for_selector(".slot")
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
        name = rows.first.locator(".nm").inner_text()
        rows.first.tap(); pg.wait_for_selector("#s-nat")
        check("選んだ技が1番目に入る", name in pg.locator(".mvgrid a").first.inner_text(), True)
        pg.goto(URL + "#/team/opp"); pg.wait_for_selector("#paste")
        paste = ("Pikachu @ Light Ball\nAbility: Static\nEVs: 32 SpA / 32 Spe / 2 HP\nTimid Nature\n- Thunderbolt\n- Volt Switch\n- Fly\n- Protect\n\n"
                 "Mewtwo @ Leftovers\nAbility: Pressure\n- Psychic\n")
        pg.fill("#paste", paste)
        pg.tap("[data-import='opp']")
        notes = pg.inner_text("#import-notes")
        check("読み込み：使えないポケモン・覚えない技は外して知らせる", ["1匹を読み込みました" in notes, "外しました" in notes], [True, True])
        pg.goto(URL + "#/")
        pg.wait_for_selector("#start")
        check("相手が1匹だと開始できず理由を表示", [pg.is_enabled("#start"), "3匹以上" in pg.inner_text("#problems")], [False, True])
        pg.tap("[data-sample='opp']")
        check("サンプルに戻すと開始できる", pg.is_enabled("#start"), True)
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
        pg, errs = open_page(ctx, "#/team/you")
        pg.wait_for_selector("[data-copyteam]")
        pg.tap("[data-copyteam='you']"); pg.wait_for_timeout(300)
        clip = pg.evaluate("navigator.clipboard.readText()")
        check("今の編成をコピー（Showdown の形式）", [clip.startswith("Garchomp @"), clip.count("\n- ") >= 20], [True, True])
        pg.evaluate("t => navigator.clipboard.writeText(t)", "Pikachu @ Light Ball\nAbility: Static\nTimid Nature\n- Thunderbolt\n- Protect\n\nGengar @ Focus Sash\nAbility: Cursed Body\n- Shadow Ball\n- Protect\n")
        pg.goto(URL + "#/team/opp"); pg.wait_for_selector("[data-paste]")
        pg.tap("[data-paste='opp']"); pg.wait_for_timeout(400)
        check("貼り付けて読み込む", ["2匹を読み込みました" in pg.inner_text("#import-notes"), pg.locator("a.slot:not(.empty)").count()], [True, 2])
        pg.screenshot(path=str(SHOTS / "team_clip.png"), full_page=True)
        ctx.close()
        ctx = new_context(b, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        pg, errs2 = open_page(ctx, "#/team/you")
        pg.wait_for_selector("[data-copyteam]")
        pg.tap("[data-copyteam='you']"); pg.wait_for_timeout(300)
        check("クリップボードの権限がなくてもコピーできる", "コピーしました" in pg.inner_text("#import-notes"), True)
        pg.tap("[data-paste='you']"); pg.wait_for_timeout(1500)
        check("読み取れないときは手で貼る方法を案内", "長押しして貼り付け" in pg.inner_text("#import-notes"), True)
        check("  errors", errs + errs2, [])
        ctx.close()

        print("■ おまかせ編成（画面の操作）")
        ctx = new_context(b, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = open_page(ctx)
        before = pg.inner_text(".team:nth-of-type(2) .mons") if pg.locator(".team").count() > 1 else ""
        opp_names = lambda: [x.inner_text() for x in pg.locator("#teams .card.team").nth(1).locator(".mon .nm").all()]
        n0 = opp_names()
        pg.tap("[data-auto='opp']")
        n1 = opp_names()
        check("おまかせで相手のチームが作り直される", [len(n1), n1 != n0], [6, True])
        info = pg.locator("#teams .card.team").nth(1).locator(".fine").inner_text()
        check("弱点の補完の割合とメガシンカの数を表示", ["弱点を受けられる仲間がいる割合" in info, "メガシンカ" in info], [True, True])
        pg.screenshot(path=str(SHOTS / "auto_setup.png"), full_page=True)
        pg.goto(URL + "#/team/opp"); pg.wait_for_selector(".slot")
        check("チーム画面に型（役割）が出る", pg.locator(".slot .meta b").count(), 6)
        pg.screenshot(path=str(SHOTS / "auto_team.png"), full_page=True)
        pg.goto(URL + "#/"); pg.wait_for_selector("#auto-opp")
        pg.check("#auto-opp")
        n2 = opp_names()
        pg.tap("#start"); pg.wait_for_selector("#b-cmd .pvb")
        pg.tap("[data-act='quit']"); pg.tap("[data-act='quit']"); pg.wait_for_selector("#auto-opp")
        check("「開始のたびに作り直す」で開始するとチームが変わる", [opp_names() != n2, pg.is_checked("#auto-opp")], [True, True])
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
            check(f"{g} {r}：どのチームも8割5分以上を補完", min(cov) >= 0.85, True)
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
        check("CPU が変化技も使う（全体の5%以上）", allst >= 0.05, True)
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
