"""PokeAPI の CSV から、図鑑用の SQLite と埋め込み用の圧縮 JSON を作る。

出力
  build/pokedex.sqlite   … 検証・自由な問い合わせ用
  build/data.json.gz     … HTML 埋め込み用（列名を捨てた配列）

配列レイアウト（添字がずれても例外にならないので、変えるときは app.js と
verify.py も必ず同時に直す）

  types[i] = [pokeapi_type_id, 名前, 一文字略称, 英語名]          i = 0..17
  eff[atk * 18 + def] = 倍率 × 100 （0 / 50 / 100 / 200）
  S[j] = [species_id, 名前, かな名, 英語名, 分類, 世代, 区分, 進化系統ID,
          進化前species_id(0=なし), 進化Lv(0=条件が単純でない/不明)]
          区分: 0=一般, 1=伝説, 2=幻
  P[k] = [pokemon_id, 図鑑番号(=species_id), 表示名, フォルム名, 英語識別子,
          タイプ1, タイプ2(-1=なし), 特性1, 特性2(0=なし), 隠れ特性(0=なし),
          H, A, B, C, D, S, 高さdm, 重さhg, 登場世代, フラグ]
          タイプは types の添字。フラグ: 1=別フォルム, 2=メガ, 4=バトル中のみ
  M[k] = [move_id, 名前, かな名, 英語名, タイプ添字, 分類(1変化/2物理/3特殊),
          威力(null), 命中(null), PP(null), 優先度, 範囲ID, 世代, 説明文, 説明文の出典,
          かな説明文（検索専用。「すばやさ」で「素早さ」を含む説明文にも当たるようにする）]
          出典: "SwSh" 等のゲーム略称。英語で代用した場合は "EN:SV" のように先頭に EN:
  A[k] = [ability_id, 名前, かな名, 英語名, 説明文, 世代, 説明文の出典, かな説明文（検索専用）]
          日本語名が未収録の特性は 名前 = 英語名（UI 側は 名前 === 英語名 で判定する）
  N[k] = [nature_id, 名前, 上がる能力, 下がる能力]
          能力は 1=A 2=B 3=C 4=D 5=S。補正のない性格は 0, 0
  L[game][pokemon_id] = [move_id, 覚え方, レベル, move_id, 覚え方, レベル, ...]
          覚え方: 1=レベル, 2=タマゴ, 3=教え技, 4=わざマシン, 10=フォルムチェンジ, 12=トレーニング
          レベル 0 はレベル技なら「進化時」
"""
import csv, gzip, json, re, sqlite3, sys, unicodedata
from collections import defaultdict, Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
OUT = ROOT / "build"
OUT.mkdir(exist_ok=True)

JA, KANA, EN = "11", "1", "9"
GAMES = {"sv": "25", "ch": "32"}          # version_group_id
VG_SHORT = {"20": "SwSh", "24": "LA", "25": "SV", "26": "SV", "27": "SV", "32": "Champions",
            "18": "USUM", "17": "SM", "16": "ORAS", "15": "XY"}

# タイプの一文字略称（日本の対戦コミュニティで一般的なもの）
KANJI = {1: "無", 2: "闘", 3: "飛", 4: "毒", 5: "地", 6: "岩", 7: "虫", 8: "霊", 9: "鋼",
         10: "炎", 11: "水", 12: "草", 13: "電", 14: "超", 15: "氷", 16: "竜", 17: "悪", 18: "妖"}

# 日本語フォルム名がデータ上で重複し、区別できないものの補正（公式の呼び名）
FORM_OVERRIDES = {
    "tauros-paldea-combat-breed": "ケンタロス（パルデア・コンバット種）",
    "tauros-paldea-blaze-breed": "ケンタロス（パルデア・ブレイズ種）",
    "tauros-paldea-aqua-breed": "ケンタロス（パルデア・ウォーター種）",
    "darmanitan-galar-zen": "ヒヒダルマ（ガラルのすがた・ダルマモード）",
    # 日本語フォルム名が未収録。公式名を断定せず、どの姿かが分かる説明にとどめる
    "pikachu-starter": "ピカチュウ（Let's Go! の相棒）",
    "eevee-starter": "イーブイ（Let's Go! の相棒）",
    "meowstic-male-mega": "メガニャオニクス（オスのすがた）",
    "meowstic-female-mega": "メガニャオニクス（メスのすがた）",
}


def rows(name):
    with open(CACHE / f"{name}.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def names(table, key, lang, col="name"):
    return {r[key]: r[col] for r in rows(table) if r["local_language_id"] == lang}


def clean_ja(s):
    # ゲーム内テキストの改行を除く（日本語は語の区切りに改行を使わない）
    return re.sub(r"\s*\n\s*", "", s or "").strip()


def clean_en(s):
    s = (s or "").replace("\xad\n", "").replace("\xad", "").replace("\f", " ")
    return re.sub(r"\s+", " ", s).strip()


def to_int(s):
    return int(s) if s not in ("", None) else None


def to_stat(s):
    # 技の威力・命中の 0 は「値なし」（ゲーム内では — と表示）。第9世代の技などで 0 と空欄が混在するので揃える
    v = to_int(s)
    return None if v == 0 else v


def main():
    vg_gen = {r["id"]: int(r["generation_id"]) for r in rows("version_groups")}
    vg_order = {r["id"]: int(r["order"]) for r in rows("version_groups")}

    # ---- タイプ -------------------------------------------------------
    type_ja = names("type_names", "type_id", JA)
    type_en = {r["id"]: r["identifier"] for r in rows("types")}
    types = [[i, type_ja[str(i)], KANJI[i], type_en[str(i)]] for i in range(1, 19)]
    tidx = {i: i - 1 for i in range(1, 19)}
    eff = [100] * (18 * 18)
    for r in rows("type_efficacy"):
        a, d = int(r["damage_type_id"]), int(r["target_type_id"])
        if a in tidx and d in tidx:
            eff[tidx[a] * 18 + tidx[d]] = int(r["damage_factor"])

    # ---- 種族 ---------------------------------------------------------
    sp_rows = rows("pokemon_species")
    sp_ja = {r["pokemon_species_id"]: r for r in rows("pokemon_species_names") if r["local_language_id"] == JA}
    sp_kana = names("pokemon_species_names", "pokemon_species_id", KANA)
    sp_en = names("pokemon_species_names", "pokemon_species_id", EN)

    # 単純なレベル進化だけ「Lv.n」を出す。条件が1つでも付くもの・ゲームで食い違うものは出さない
    cond_cols = ["trigger_item_id", "gender_id", "location_id", "held_item_id", "time_of_day",
                 "known_move_id", "known_move_type_id", "minimum_happiness", "minimum_beauty",
                 "minimum_affection", "relative_physical_stats", "party_species_id", "party_type_id",
                 "trade_species_id", "region_id", "required_pokemon_form_id", "evolved_pokemon_form_id",
                 "used_move_id", "minimum_move_count", "minimum_steps", "minimum_damage_taken",
                 "nature_bitmask", "condition_expression", "percentage_chance"]
    flag_cols = ["needs_overworld_rain", "turn_upside_down", "needs_multiplayer", "near_special_rock"]
    evo_by_sp = defaultdict(list)
    for r in rows("pokemon_evolution"):
        pure = (r["evolution_trigger_id"] == "1" and r["minimum_level"] != ""
                and all(r.get(c, "") == "" for c in cond_cols)
                and all(r.get(c, "0") in ("", "0") for c in flag_cols))
        evo_by_sp[r["evolved_species_id"]].append(int(r["minimum_level"]) if pure else None)
    evo_lv = {}
    for sid, lvs in evo_by_sp.items():
        if lvs and all(v is not None for v in lvs) and len(set(lvs)) == 1:
            evo_lv[sid] = lvs[0]

    S = []
    for r in sp_rows:
        sid = r["id"]
        cat = 2 if r["is_mythical"] == "1" else 1 if r["is_legendary"] == "1" else 0
        S.append([int(sid), sp_ja[sid]["name"], sp_kana.get(sid, ""), sp_en.get(sid, r["identifier"]),
                  sp_ja[sid]["genus"], int(r["generation_id"]), cat, int(r["evolution_chain_id"]),
                  int(r["evolves_from_species_id"] or 0), evo_lv.get(sid, 0)])
    S.sort(key=lambda x: x[0])
    sp_name = {s[0]: s[1] for s in S}

    # ---- 特性 ---------------------------------------------------------
    ab_ja = names("ability_names", "ability_id", JA)
    ab_kana = names("ability_names", "ability_id", KANA)
    ab_en = names("ability_names", "ability_id", EN)
    ab_text = {}
    for r in rows("ability_flavor_text"):
        if r["language_id"] in (JA, EN, KANA):
            key = (r["ability_id"], r["language_id"])
            o = vg_order[r["version_group_id"]]
            if key not in ab_text or o > ab_text[key][0]:
                ab_text[key] = (o, r["version_group_id"], r["flavor_text"])
    A = []
    for r in rows("abilities"):
        if r["is_main_series"] != "1":
            continue
        aid = r["id"]
        en = ab_en.get(aid, r["identifier"])
        if (aid, JA) in ab_text:
            _, vg, txt = ab_text[(aid, JA)]
            desc, src = clean_ja(txt), VG_SHORT.get(vg, vg)
        elif (aid, EN) in ab_text:
            _, vg, txt = ab_text[(aid, EN)]
            desc, src = clean_en(txt), "EN:" + VG_SHORT.get(vg, vg)
        else:
            desc, src = "", ""
        # 日本語名が無いものは推測で埋めず、英語名のまま出す
        kana_desc = clean_ja(ab_text[(aid, KANA)][2]) if (aid, KANA) in ab_text else ""
        A.append([int(aid), ab_ja.get(aid) or ab_kana.get(aid) or en, ab_kana.get(aid, ""), en,
                  desc, int(r["generation_id"]), src, kana_desc if kana_desc != desc else ""])
    ab_ok = {a[0] for a in A}

    # ---- ポケモン（フォルム込み） -------------------------------------
    stats = defaultdict(dict)
    for r in rows("pokemon_stats"):
        stats[r["pokemon_id"]][int(r["stat_id"])] = int(r["base_stat"])
    ptypes = defaultdict(dict)
    for r in rows("pokemon_types"):
        ptypes[r["pokemon_id"]][int(r["slot"])] = int(r["type_id"])
    pabs = defaultdict(dict)
    for r in rows("pokemon_abilities"):
        pabs[r["pokemon_id"]][int(r["slot"])] = int(r["ability_id"])
    forms = defaultdict(list)
    for r in rows("pokemon_forms"):
        forms[r["pokemon_id"]].append(r)
    fname_ja = names("pokemon_form_names", "pokemon_form_id", JA, "form_name")

    vg2g = {v: k for k, v in GAMES.items()}
    learn = defaultdict(set)          # (game, pokemon_id) -> {(move, method, level)}
    for r in rows("pokemon_moves"):
        g = vg2g.get(r["version_group_id"])
        if g:
            learn[(g, int(r["pokemon_id"]))].add((int(r["move_id"]), int(r["pokemon_move_method_id"]),
                                                   int(r["level"] or 0)))

    raw = []
    for r in rows("pokemon"):
        pid = r["id"]
        f = next((x for x in forms[pid] if x["is_default"] == "1"), forms[pid][0])
        t = ptypes[pid]
        ab = pabs[pid]
        st = stats[pid]
        raw.append(dict(
            id=int(pid), sid=int(r["species_id"]), ident=r["identifier"], default=r["is_default"] == "1",
            form=fname_ja.get(f["id"], ""), mega=f["is_mega"] == "1", battle=f["is_battle_only"] == "1",
            gen=vg_gen[f["introduced_in_version_group_id"]] if f["introduced_in_version_group_id"] else 0,
            t1=tidx[t[1]], t2=tidx[t[2]] if 2 in t else -1,
            a1=ab.get(1, 0), a2=ab.get(2, 0), ah=ab.get(3, 0),
            st=[st[i] for i in range(1, 7)], h=int(r["height"] or 0), w=int(r["weight"] or 0)))

    # 性能（タイプ・種族値・特性・覚える技）が既に残した姿と同じ見た目違いは省く
    # （キョダイマックス・ぬしポケモン・色違いの姿など）。
    # 覚える技は、その姿がそのゲームにいない（データが空）なら違いとみなさない
    def same(p, q):
        if (p["t1"], p["t2"], p["a1"], p["a2"], p["ah"], p["st"]) != \
           (q["t1"], q["t2"], q["a1"], q["a2"], q["ah"], q["st"]):
            return False
        return all(not learn[(g, p["id"])] or learn[(g, p["id"])] == learn[(g, q["id"])] for g in GAMES)

    kept, by_sp = [], defaultdict(list)
    for p in sorted(raw, key=lambda p: (not p["default"], p["id"])):
        if any(same(p, q) for q in by_sp[p["sid"]]):
            continue
        by_sp[p["sid"]].append(p)
        kept.append(p)
    dropped = len(raw) - len(kept)

    per_species = Counter(p["sid"] for p in kept)
    for p in kept:
        sp = sp_name[p["sid"]]
        if p["ident"] in FORM_OVERRIDES:
            p["name"] = FORM_OVERRIDES[p["ident"]]
        elif p["default"]:
            # 同じ種族に別の姿がある場合だけ、基本の姿にもフォルム名を添える
            p["name"] = f"{sp}（{p['form']}）" if p["form"] and per_species[p["sid"]] > 1 else sp
        elif p["form"] and sp in unicodedata.normalize("NFKC", p["form"]).replace("Ｘ", "X"):
            p["name"] = p["form"]
        elif p["form"] and sp in p["form"]:
            p["name"] = p["form"]
        elif p["form"]:
            p["name"] = f"{sp}（{p['form']}）"
        else:
            # 日本語フォルム名が無い。特性で区別できるものは特性名を添え、それ以外は止める
            base = next(q for q in kept if q["sid"] == p["sid"] and q["default"])
            if p["a1"] != base["a1"] and ab_ja.get(str(p["a1"])):
                p["name"] = f"{sp}（{ab_ja[str(p['a1'])]}）"
            else:
                print("日本語の表示名を決められません。FORM_OVERRIDES に追加してください:", p["ident"])
                sys.exit(1)

    # フォルム名だけでは区別できず、特性で違いが出るもの（ジガルデ等）は特性名を添える
    groups = defaultdict(list)
    for p in kept:
        groups[p["name"]].append(p)
    for nm, grp in groups.items():
        if len(grp) > 1 and nm.endswith("）") and len({p["a1"] for p in grp}) == len(grp):
            for p in grp:
                p["name"] = nm[:-1] + "・" + ab_ja.get(str(p["a1"]), "") + "）"
    dup = Counter(p["name"] for p in kept)
    collisions = sorted(n for n, c in dup.items() if c > 1)
    if collisions:
        print("表示名が重複しています。FORM_OVERRIDES に追加してください:", collisions)
        sys.exit(1)

    P = []
    for p in sorted(kept, key=lambda p: (p["sid"], not p["default"], p["id"])):
        flags = (0 if p["default"] else 1) | (2 if p["mega"] else 0) | (4 if p["battle"] else 0)
        P.append([p["id"], p["sid"], p["name"], p["form"], p["ident"], p["t1"], p["t2"],
                  p["a1"] if p["a1"] in ab_ok else 0, p["a2"] if p["a2"] in ab_ok else 0,
                  p["ah"] if p["ah"] in ab_ok else 0, *p["st"], p["h"], p["w"], p["gen"], flags])
    pid_ok = {p[0] for p in P}

    # ---- 技 -----------------------------------------------------------
    mv_ja = names("move_names", "move_id", JA)
    mv_kana = names("move_names", "move_id", KANA)
    mv_en = names("move_names", "move_id", EN)
    best = {}
    for r in rows("move_flavor_text"):
        if r["language_id"] not in (JA, EN, KANA):
            continue
        key = (r["move_id"], r["language_id"])
        o = vg_order[r["version_group_id"]]
        if key not in best or o > best[key][0]:
            best[key] = (o, r["version_group_id"], r["flavor_text"])
    M = []
    for r in rows("moves"):
        mid = r["id"]
        if int(mid) >= 10000:
            continue
        if (mid, JA) in best:
            _, vg, txt = best[(mid, JA)]
            desc, src = clean_ja(txt), VG_SHORT.get(vg, vg)
        elif (mid, EN) in best:
            _, vg, txt = best[(mid, EN)]
            desc, src = clean_en(txt), "EN:" + VG_SHORT.get(vg, vg)
        else:
            desc, src = "", ""
        kana_desc = clean_ja(best[(mid, KANA)][2]) if (mid, KANA) in best else ""
        M.append([int(mid), mv_ja[mid], mv_kana.get(mid, ""), mv_en.get(mid, r["identifier"]),
                  tidx[int(r["type_id"])], int(r["damage_class_id"]), to_stat(r["power"]),
                  to_stat(r["accuracy"]), to_int(r["pp"]), int(r["priority"]), int(r["target_id"]),
                  int(r["generation_id"]), desc, src, kana_desc if kana_desc != desc else ""])
    mid_ok = {m[0] for m in M}

    # ---- 性格（チャンピオンズでは「能力補正」） ------------------------
    nat_ja = names("nature_names", "nature_id", JA)
    N = []
    for r in rows("natures"):
        up, down = int(r["increased_stat_id"]) - 1, int(r["decreased_stat_id"]) - 1   # stat_id 2..6 → 1..5
        if up == down:
            up = down = 0
        N.append([int(r["id"]), nat_ja[r["id"]], up, down])
    assert len(N) == 25 and len({(n[2], n[3]) for n in N if n[2]}) == 20, "性格の組み合わせが想定と違います"

    # ---- 覚える技 -----------------------------------------------------
    L = {g: defaultdict(list) for g in GAMES}
    n_rows = Counter()
    for (g, pid), entries in learn.items():
        for (mid, meth, lv) in entries:
            if pid not in pid_ok or mid not in mid_ok:
                n_rows["skipped_" + g] += 1
                continue
            L[g][pid].append((mid, meth, lv))
            n_rows[g] += 1
    Lout = {}
    for g, d in L.items():
        Lout[g] = {}
        for pid, lst in d.items():
            lst.sort(key=lambda x: (x[1], x[2], x[0]))
            Lout[g][str(pid)] = [v for t in lst for v in t]

    # ---- 出力 ---------------------------------------------------------
    commit = (CACHE / "_commit.txt").read_text().strip() if (CACHE / "_commit.txt").exists() else ""
    data = dict(v=1, meta=dict(source="PokeAPI (github.com/PokeAPI/pokeapi)", updated=commit),
                types=types, eff=eff, S=S, P=P, M=M, A=A, N=N, L=Lout)
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    # mtime を固定しないと、中身が同じでも定期実行のたびにバイト列が変わる
    (OUT / "data.json.gz").write_bytes(gzip.compress(blob.encode("utf-8"), 9, mtime=0))

    db = OUT / "pokedex.sqlite"
    db.unlink(missing_ok=True)
    con = sqlite3.connect(db)
    c = con.cursor()
    c.executescript("""
    CREATE TABLE types(idx INTEGER PRIMARY KEY, id INTEGER, name TEXT, kanji TEXT, en TEXT);
    CREATE TABLE efficacy(atk INTEGER, def INTEGER, factor INTEGER);
    CREATE TABLE species(id INTEGER PRIMARY KEY, name TEXT, kana TEXT, en TEXT, genus TEXT, gen INTEGER,
                         category INTEGER, chain INTEGER, from_species INTEGER, evo_level INTEGER);
    CREATE TABLE pokemon(id INTEGER PRIMARY KEY, dex INTEGER, name TEXT, form TEXT, ident TEXT,
                         t1 INTEGER, t2 INTEGER, a1 INTEGER, a2 INTEGER, ah INTEGER,
                         hp INTEGER, atk INTEGER, def INTEGER, spa INTEGER, spd INTEGER, spe INTEGER,
                         height INTEGER, weight INTEGER, gen INTEGER, flags INTEGER);
    CREATE TABLE moves(id INTEGER PRIMARY KEY, name TEXT, kana TEXT, en TEXT, type INTEGER, class INTEGER,
                       power INTEGER, accuracy INTEGER, pp INTEGER, priority INTEGER, target INTEGER,
                       gen INTEGER, description TEXT, desc_source TEXT, description_kana TEXT);
    CREATE TABLE abilities(id INTEGER PRIMARY KEY, name TEXT, kana TEXT, en TEXT, description TEXT, gen INTEGER,
                           desc_source TEXT, description_kana TEXT);
    CREATE TABLE learnsets(game TEXT, pokemon_id INTEGER, move_id INTEGER, method INTEGER, level INTEGER);
    CREATE TABLE natures(id INTEGER PRIMARY KEY, name TEXT, up INTEGER, down INTEGER);
    CREATE VIRTUAL TABLE names_fts USING fts5(kind, ref, text, tokenize='trigram');
    """)
    c.executemany("INSERT INTO types VALUES(?,?,?,?,?)", [(i, *t) for i, t in enumerate(types)])
    c.executemany("INSERT INTO efficacy VALUES(?,?,?)", [(i // 18, i % 18, f) for i, f in enumerate(eff)])
    c.executemany("INSERT INTO species VALUES(?,?,?,?,?,?,?,?,?,?)", S)
    c.executemany("INSERT INTO pokemon VALUES(" + ",".join("?" * 20) + ")", P)
    c.executemany("INSERT INTO moves VALUES(" + ",".join("?" * 15) + ")", M)
    c.executemany("INSERT INTO abilities VALUES(?,?,?,?,?,?,?,?)", A)
    c.executemany("INSERT INTO natures VALUES(?,?,?,?)", N)
    for g, d in L.items():
        c.executemany("INSERT INTO learnsets VALUES(?,?,?,?,?)",
                      [(g, pid, m, meth, lv) for pid, lst in d.items() for (m, meth, lv) in lst])
    c.executemany("INSERT INTO names_fts VALUES(?,?,?)",
                  [("pokemon", p[0], p[2]) for p in P] + [("move", m[0], m[1]) for m in M] +
                  [("ability", a[0], a[1]) for a in A])
    con.commit()
    con.close()

    gz = (OUT / "data.json.gz").stat().st_size
    print(f"species={len(S)} pokemon={len(P)} (見た目違い {dropped} 件を除外) moves={len(M)} abilities={len(A)}")
    print(f"learnsets: sv={n_rows['sv']} ch={n_rows['ch']} skipped={dict((k, v) for k, v in n_rows.items() if k.startswith('skipped'))}")
    print(f"evo Lv 表示あり: {sum(1 for s in S if s[9])} / 進化するもの {sum(1 for s in S if s[8])}")
    print(f"json={len(blob.encode()) / 1e6:.2f}MB  gzip={gz / 1e6:.2f}MB")


if __name__ == "__main__":
    main()
