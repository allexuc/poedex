"""公開用のフォルダ（site/）に、図鑑・バトル・データベースと、使ったデータの版をまとめる。"""
import json, os, shutil, sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
shutil.rmtree(SITE, ignore_errors=True)
SITE.mkdir()
shutil.copy(ROOT / "build/pokedex.html", SITE / "index.html")
shutil.copy(ROOT / "battle/build/battle.html", SITE / "battle.html")
shutil.copy(ROOT / "build/pokedex.sqlite", SITE / "pokedex.sqlite")
(SITE / ".nojekyll").write_text("")
ps = json.loads((ROOT / "battle/ps-data.json").read_text())
db = sqlite3.connect(ROOT / "build/pokedex.sqlite")
versions = {
    "pokeapi": (ROOT / "cache/_commit.txt").read_text().strip(),
    "showdown": ps["commit"],
    "formats": {g: {r: f["id"] for r, f in G["formats"].items()} for g, G in ps["games"].items()},
    "counts": {t: db.execute(f"select count(*) from {t}").fetchone()[0] for t in ("pokemon", "moves", "abilities")},
}
(SITE / "versions.json").write_text(json.dumps(versions, ensure_ascii=False, indent=2) + "\n")
(ROOT / "DATA_VERSIONS.json").write_text(json.dumps(versions, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(versions, ensure_ascii=False))
# GitHub Actions の実行結果の画面に、使ったデータとルールを表示する
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a", encoding="utf-8") as f:
        f.write("## 公開したデータ\n\n| 項目 | 版 |\n|---|---|\n")
        f.write(f"| PokeAPI | {versions['pokeapi']} |\n| Pokémon Showdown | {versions['showdown'][:9]} |\n")
        for g, rules in versions["formats"].items():
            for r, fid in rules.items():
                f.write(f"| {g} {r} | {fid} |\n")
