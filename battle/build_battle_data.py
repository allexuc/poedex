"""Showdown から書き出した一覧（ps-data.json）に日本語名を結び付け、バトル画面に埋め込むデータを作る。

対応付けは「名前から記号を除いた ID」で行う（Showdown の ID は英語名から記号を除いたもの）。
見つからないものは英語名のまま出し、一覧を表示する（推測で日本語名を作らない）。

配列レイアウト（battle.js と必ず同時に直す）
  types[i]   = [英語名, 日本語名, 一文字]            i = 0..17（図鑑と同じ並び）、18 = ステラ（テラスタル用）
  natures[i] = [英語名, 日本語名, 上がる能力, 下がる能力]   能力は 1=A..5=S、補正なしは 0, 0
  moves[i]   = [id, 日本語名, タイプ, 分類(0変化/1物理/2特殊), 威力, 命中(null=必中), PP, 優先度, 範囲, 性質ビット, 平均の回数]
              性質ビット：1 ためる 2 反動で動けない 4 自分がひんし 8 自分の能力が下がる 16 反動ダメージ 32 交代する
                          64 威力が変わる 128 一撃必殺 256 固定ダメージ 512 ぼうぎょで攻撃 1024 相手のこうげきで攻撃 2048 HPを吸う
  abilities[i] = [id, 日本語名, Showdown の評価（-1〜5、おまかせ編成で特性を選ぶのに使う）]
  items[i]   = [id, 日本語名, メガシンカする元の姿(Showdown名 or ""), メガシンカ後の姿]
  games[g].species[i] = [id, Showdown名, 図鑑番号, 表示名, 種族名, タイプ1, タイプ2(-1), 種族値6, 特性[], 技[], 必須の持ち物[], 進化前か(1/0),
                         禁止級か(1/0), 配布限定か(1/0), 図鑑の pokemon_id（対応がなければ -1）]
  games[g].restrictedLimit = 禁止級を何匹まで入れられるか
  games[g].megas[i]   = [メガストーンの添字, 元の姿(Showdown名), メガシンカ後(Showdown名), メガシンカ後の表示名, タイプ1, タイプ2(-1), 種族値6, 特性,
                         図鑑の pokemon_id（対応がなければ -1）]
  図鑑の pokemon_id は、図鑑でブックマークしたポケモンや「チームに追加」をバトル側のポケモンに結び付けるのに使う
          特性・技・持ち物は上の配列の添字
"""
import csv, gzip, json, re, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
B = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
OUT = B / "build"
OUT.mkdir(exist_ok=True)

norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())
# Showdown と PokeAPI で呼び方が違う姿（前方一致でも拾えないもの）
ALIAS = {"rockruffdusk": "rockruffowntempo", "meowsticmmega": "meowsticmalemega", "meowsticfmega": "meowsticfemalemega"}


def rows(name):
    with open(CACHE / f"{name}.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    ps = json.loads((B / "ps-data.json").read_text())
    samples = json.loads((B / "sample-teams.json").read_text())
    db = sqlite3.connect(ROOT / "build" / "pokedex.sqlite")
    missing = {"moves": [], "abilities": [], "items": [], "species": []}

    # タイプ（図鑑と同じ並び）
    types = [[en.capitalize(), ja, kanji] for en, ja, kanji in db.execute("select en, name, kanji from types order by idx")]
    types.append(["Stellar", "ステラ", "星"])
    tidx = {t[0]: i for i, t in enumerate(types)}

    # 性格：Showdown の英語名 ↔ 図鑑の日本語名
    nat_en = {r["id"]: r["identifier"].capitalize() for r in rows("natures")}
    natures = [[nat_en[str(i)], name, up, down] for i, name, up, down in db.execute("select id, name, up, down from natures order by id")]
    assert {n[0] for n in natures} == {n[0] for n in ps["natures"]}, "性格の英語名が Showdown と一致しません"

    # 技・特性：図鑑の英語名で対応付け
    mv_ja = {norm(en): ja for en, ja in db.execute("select en, name from moves")}
    ab_ja = {norm(en): ja for en, ja in db.execute("select en, name from abilities")}
    # Showdown は「じんばいったい」を乗るポケモン別の2つに分けている（As One (Glastrier) など）
    for aid in ps["abilities"]:
        if aid.startswith("asone") and "asone" in ab_ja:
            ab_ja.setdefault(aid, ab_ja["asone"])
    CAT = {"Status": 0, "Physical": 1, "Special": 2}
    moves, midx = [], {}
    for mid in sorted(ps["moves"]):
        m = ps["moves"][mid]
        ja = mv_ja.get(mid)
        if not ja:
            missing["moves"].append(m["name"])
        midx[mid] = len(moves)
        moves.append([mid, ja or m["name"], tidx[m["type"]], CAT[m["category"]], m["basePower"], m["accuracy"], m["pp"], m["priority"], m["target"],
                      m["traits"], m["hits"]])
    abilities, aidx = [], {}
    for aid in sorted(ps["abilities"]):
        ja = ab_ja.get(aid)
        if not ja or re.fullmatch(r"[\x00-\x7f]+", ja):
            missing["abilities"].append(ps["abilities"][aid]["name"])
        aidx[aid] = len(abilities)
        abilities.append([aid, ja or ps["abilities"][aid]["name"], ps["abilities"][aid].get("rating", 0)])

    # 持ち物：PokeAPI の identifier で対応付け
    it_id = {r["id"]: norm(r["identifier"]) for r in rows("items")}
    it_ja, by_en = {}, {}
    names = rows("item_names")
    for r in names:
        if r["local_language_id"] == "11" and r["item_id"] in it_id:
            it_ja.setdefault(it_id[r["item_id"]], r["name"])
    # identifier が旧名のもの（Leek = stick など）は英語名でも引く
    ja_by_item = {r["item_id"]: r["name"] for r in names if r["local_language_id"] == "11"}
    for r in names:
        if r["local_language_id"] == "9" and r["item_id"] in ja_by_item:
            by_en.setdefault(norm(r["name"]), ja_by_item[r["item_id"]])
    items, iidx = [], {}
    for iid in sorted(ps["items"]):
        it = ps["items"][iid]
        ja = it_ja.get(iid) or by_en.get(iid)
        if not ja:
            missing["items"].append(it["name"])
        mega = it["megaStone"] or {}
        base, forme = (next(iter(mega.items())) if mega else ("", ""))
        iidx[iid] = len(items)
        items.append([iid, ja or it["name"], base, forme])

    # ポケモン：図鑑の姿（PokeAPI の identifier）→ 無ければ種族名。フォルム名を推測では作らない
    sp_name = {num: name for num, name in db.execute("select id, name from species")}
    pk = [(norm(ident), name, dex, pid) for ident, name, dex, pid in db.execute("select ident, name, dex, id from pokemon")]
    by_ident = {i: (n, d, pid) for i, n, d, pid in pk}
    # 図鑑で省いた見た目違い（ビビヨンの模様など）も、PokeAPI のフォルム名から表示名を作れるようにする
    sp_of = {r["id"]: int(r["species_id"]) for r in rows("pokemon")}
    fname = {r["pokemon_form_id"]: r["form_name"] for r in rows("pokemon_form_names") if r["local_language_id"] == "11"}
    for r in rows("pokemon_forms"):
        dex = sp_of.get(r["pokemon_id"])
        key = norm(r["identifier"])
        if dex is None or key in by_ident:
            continue
        spn, fn = sp_name[dex], fname.get(r["id"], "")
        disp = fn if fn and spn in fn else (f"{spn}（{fn}）" if fn else spn)
        by_ident[key] = (disp, dex, -1)          # 図鑑には載せていない見た目違い
        pk.append((key, disp, dex, -1))
    games = {}
    for g, G in ps["games"].items():
        out, seen = [], {}
        for s in G["species"]:
            sig = (s["num"], tuple(s["types"]), tuple(s["stats"]), tuple(s["abilities"]), tuple(s["moves"]))
            if sig in seen:          # 性能がまったく同じ見た目違い（ビビヨンの模様など）は1つにまとめる
                continue
            seen[sig] = True
            base_ja = sp_name.get(s["num"], s["base"])
            hit = by_ident.get(s["id"])
            if not hit:
                # 表記ゆれ（Meowstic-F ↔ meowstic-female、Necrozma-Dusk-Mane ↔ necrozma-dusk）は、
                # 同じ図鑑番号の中で前方一致するもののうち、いちばん近い（長さの差が小さい）1つだけを使う
                cands = sorted((abs(len(i) - len(s["id"])), i, n, pid) for i, n, d, pid in pk
                               if d == s["num"] and i != norm(s["base"]) and (i.startswith(s["id"]) or s["id"].startswith(i)))
                if cands and (len(cands) == 1 or cands[0][0] < cands[1][0]):
                    hit = (cands[0][2], s["num"], cands[0][3])
            if not hit and s["id"] in ALIAS:
                hit = by_ident.get(ALIAS[s["id"]])
            pid = hit[2] if hit else -1
            if not hit and not s["forme"]:            # 基本の姿は図鑑番号で結び付ける
                pid = next((q for i, n, d, q in pk if d == s["num"] and q > 0 and q < 10000), -1)
            if hit:
                disp = hit[0]
            elif not s["forme"]:
                disp = base_ja
            else:
                disp = f"{base_ja}（{s['forme']}）"
                missing["species"].append(s["name"])
            t = [tidx[x] for x in s["types"]]
            row = [s["id"], s["name"], s["num"], disp, base_ja, t[0], t[1] if len(t) > 1 else -1, s["stats"],
                   [aidx[a] for a in s["abilities"]], sorted(midx[m] for m in s["moves"]),
                   [iidx[i] for i in s["requiredItems"] if i in iidx], 1 if s.get("nfe") else 0,
                   1 if s.get("restricted") else 0, 1 if s.get("eventOnly") else 0, pid]
            out.append(row)
        megas = []
        base_ja = {x["name"]: sp_name.get(x["num"], x["name"]) for x in G["species"]}
        for mg in G.get("megas", []):
            hit = by_ident.get(norm(mg["forme"])) or by_ident.get(ALIAS.get(norm(mg["forme"]), ""))
            t = [tidx[x] for x in mg["types"]]
            megas.append([iidx[mg["item"]], mg["base"], mg["forme"], hit[0] if hit else "メガ" + base_ja.get(mg["base"], mg["base"]),
                          t[0], t[1] if len(t) > 1 else -1, mg["stats"], aidx[mg["ability"]], hit[2] if hit else -1])
            if not hit:
                missing["species"].append(mg["forme"])
        games[g] = {"formats": G["formats"], "tera": G["tera"], "statPoints": G["statPoints"], "restrictedLimit": G["restrictedLimit"],
                    "species": out, "items": sorted(iidx[i] for i in G["items"]), "megas": megas}
        print(f"{g}: species {len(out)}（見た目違いを除いて）, items {len(G['items'])}")

    data = {"v": 1, "ps": {"commit": ps["commit"]}, "types": types, "natures": natures, "moves": moves,
            "abilities": abilities, "items": items, "games": games, "samples": samples}
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    (OUT / "battle-data.json.gz").write_bytes(gzip.compress(blob, 9, mtime=0))
    print(f"json {len(blob) / 1e6:.2f}MB  gzip {(OUT / 'battle-data.json.gz').stat().st_size / 1e6:.2f}MB")
    for k, v in missing.items():
        print(f"日本語名が見つからない{k}: {len(v)} {v[:12]}")


if __name__ == "__main__":
    main()
