#!/usr/bin/env bash
# 実ブラウザでの検証（図鑑 → バトル）。どちらかが失敗したら 0 以外で終わる
set -euo pipefail
cd "$(dirname "$0")/.."
python etl/verify.py
python battle/verify_battle.py
