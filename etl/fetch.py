"""PokeAPI リポジトリから必要な CSV だけを取得し、基準日（最終コミット日時）を記録する。

clone は不要。raw.githubusercontent.com から直接取る。
"""
import re, sys, urllib.request
from pathlib import Path

CACHE = Path(__file__).resolve().parent.parent / "cache"
BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/"
FILES = """pokemon_species pokemon_species_names pokemon pokemon_forms pokemon_form_names pokemon_stats
pokemon_types pokemon_abilities types type_names type_efficacy abilities ability_names ability_flavor_text
moves move_names move_flavor_text pokemon_moves version_groups pokemon_evolution natures nature_names items item_names""".split()


def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def main():
    CACHE.mkdir(exist_ok=True)
    feed = get("https://github.com/PokeAPI/pokeapi/commits/master.atom").decode()
    m = re.findall(r"<updated>([^<]+)</updated>", feed)
    if len(m) < 2:
        sys.exit("コミット日時を取得できませんでした")
    for f in FILES:
        (CACHE / f"{f}.csv").write_bytes(get(BASE + f + ".csv"))
    # 生成 HTML にライセンス全文を載せるため、ライセンスも取得する
    (CACHE / "LICENSE_pokeapi.md").write_bytes(
        get("https://raw.githubusercontent.com/PokeAPI/pokeapi/master/LICENSE.md"))
    (CACHE / "_commit.txt").write_text(m[1])   # [0] はフィード自体の更新日時
    print("基準日:", m[1], " files:", len(FILES))


if __name__ == "__main__":
    main()
