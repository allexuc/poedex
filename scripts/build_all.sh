#!/usr/bin/env bash
# 図鑑とバトルシミュレーターを、データの取得からまとめて作る（手元でも GitHub Actions でも同じ手順）
#   PS_DIR=<Pokémon Showdown を clone したディレクトリ> scripts/build_all.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PS_DIR:?Pokémon Showdown を clone したディレクトリを PS_DIR に指定してください}"
export PS_DIR

echo "== 図鑑（PokeAPI）"
python etl/fetch.py
python etl/build_data.py

echo "== バトル（Pokémon Showdown $(git -C "$PS_DIR" rev-parse --short HEAD)）"
cd battle
node transpile-ps.mjs "$PS_DIR"
node export-ps.js "$PS_DIR" ps-data.json "$(git -C "$PS_DIR" rev-parse HEAD)"
node validate-teams.js "$PS_DIR" sample-teams.txt sample-teams.json
node make-engine.mjs
python build_battle_data.py
cd ..

echo "== 図鑑とバトルを1枚のページにまとめる"
python scripts/build_app.py
