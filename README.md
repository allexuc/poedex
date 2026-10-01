# ポケモンデータ検索とバトルシミュレーター

- **図鑑**（`index.html`）：種族値・技・特性を検索でき、実数値も計算できる1枚の HTML（データは PokeAPI）
- **バトルシミュレーター**（`battle.html`）：ランクバトルのルールで対戦できる1枚の HTML（対戦の計算は Pokémon Showdown）
- **データベース**（`pokedex.sqlite`）：図鑑のデータを SQLite にしたもの

GitHub Actions が毎週データを取り直して作り直し、実ブラウザで検証してから GitHub Pages に公開します。

## リポジトリの構成

```
.github/workflows/update.yml   毎週・手動・push で「取得 → 作る → 検証 → 公開」
scripts/
  build_all.sh                 図鑑とバトルを一括で作る（手元でも CI でも同じ）
  verify_all.sh                実ブラウザでの検証（図鑑 → バトル）
  assemble_site.py             公開用の site/ をまとめ、使ったデータの版を DATA_VERSIONS.json に書く
etl/                           図鑑：PokeAPI の CSV 取得・SQLite と HTML の生成・検証
src/                           図鑑の画面（HTML・CSS・JS）
battle/
  formats.json                 使うルール（auto: で最新のレギュレーションを自動で選ぶ）
  sample-teams.txt             サンプルチーム（Showdown の形式）
  transpile-ps.mjs             Showdown を Node で読める JS に変換
  export-ps.js                 ルール上使えるポケモン・技・特性・持ち物を書き出す
  validate-teams.js            サンプルチームを検証（使えなくなったものは外して警告）
  make-engine.mjs / engine/    Showdown のエンジンをブラウザ用の1本の JS にまとめる
  build_battle_data.py         日本語名の対応付け
  build_page.py                battle.html の生成
  verify_battle.py             実ブラウザでの検証（操作・編集・おまかせ・CPU 同士の対戦）
  src/                         バトルの画面（HTML・CSS・JS）
DATA_VERSIONS.json             最後に公開したときの PokeAPI・Showdown の版とルール（Actions が更新）
```

生成物（`build/`・`battle/build/`・`site/`・`cache/` など）は `.gitignore` で除外しています。

## GitHub Actions（`.github/workflows/update.yml`）

| いつ | 何をするか |
|---|---|
| 毎週月曜 3:00（日本時間） | 最新のデータで作り直し、検証に通れば公開。使ったデータの版を `DATA_VERSIONS.json` にコミット |
| 手動（Actions の「Run workflow」） | 同上。`ps_ref` に Showdown のコミットやタグを入れると、その版で作る |
| main への push | 作り直して検証し、公開 |
| プルリクエスト | 作り直して検証だけ（公開しない） |

- 検証に1つでも失敗すると公開しません。前回公開したページがそのまま残り、GitHub から失敗の通知が届きます。
  失敗したときの画面は、実行結果の「screenshots」から取り出せます。
- レギュレーションが変わると、`formats.json` の `auto:` が新しいルールを自動で選びます。
  サンプルチームが新しいルールで使えなくなった場合は、止めずに外して警告を出し、画面では「おまかせ」で代わりのチームを作ります。
- Showdown の版を固定したいときは、リポジトリの Variables に `PS_REF`（コミットやタグ）を設定します。

## 初回の設定

1. GitHub で新しいリポジトリを作り、このフォルダの中身を push する
   ```
   git init -b main && git add -A && git commit -m "初回"
   git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
   git push -u origin main
   ```
2. リポジトリの Settings → Pages → Build and deployment の Source を **GitHub Actions** にする
3. Settings → Actions → General → Workflow permissions を **Read and write permissions** にする
   （`DATA_VERSIONS.json` の記録に使います。読み取りのままでも公開はできます）
4. Actions タブで「データを更新して公開」を選び、Run workflow で1回動かす（15分ほど）
5. 公開先は `https://<ユーザー名>.github.io/<リポジトリ名>/`（バトルは `battle.html`）

- 公開リポジトリなら Actions の実行時間は無料です。非公開でも、毎週1回（1回15分ほど）なら無料枠に収まります。
- GitHub の定期実行は、リポジトリに60日間動きがないと止まります。
  毎週の `DATA_VERSIONS.json` の記録がその動きになりますが、止まった場合は Actions タブから有効に戻してください。

## 手元で作る

```
git clone --filter=blob:none https://github.com/smogon/pokemon-showdown ../pokemon-showdown
npm ci && npm ci --prefix battle
pip install -r requirements.txt && python -m playwright install chromium
PS_DIR=../pokemon-showdown scripts/build_all.sh
PS_DIR=../pokemon-showdown scripts/verify_all.sh
python scripts/assemble_site.py        # → site/
```

- 図鑑とバトルのリンク先は、ビルド時の環境変数 `LINK_BATTLE`（既定 `battle.html`）と `LINK_POKEDEX`（既定 `index.html`）で変えられます。
- 図鑑の埋め込みデータは列名を捨てた配列です。添字の対応は `etl/build_data.py` の先頭に書いてあります。
  変えるときは `src/app.js` と `etl/verify.py` も同時に直してください。
- 同じデータから作り直すと、HTML はバイト単位で同じものになります。

## SQLite の主なテーブル

| テーブル | 中身 |
|---|---|
| pokemon | 姿ごとの種族値・タイプ・特性（タイプと特性は types / abilities の添字・ID） |
| species | 種族ごとの名前・分類・進化の系統 |
| moves / abilities | 技・特性（日本語の説明文と出典のゲーム） |
| learnsets | 覚える技（game = sv / ch） |
| natures | 性格（up / down は 1=A 2=B 3=C 4=D 5=S、補正なしは 0） |
| names_fts | 名前の部分一致検索（FTS5 trigram） |

例：SV でじしんを覚える、すばやさ 100 以上のポケモン

```sql
SELECT p.name, p.spe FROM pokemon p
JOIN learnsets l ON l.pokemon_id = p.id AND l.game = 'sv'
JOIN moves m ON m.id = l.move_id AND m.name = 'じしん'
WHERE p.spe >= 100 GROUP BY p.id ORDER BY p.spe DESC;
```

## 実数値の計算

- SV：通常の式（レベル・個体値・努力値・性格）。
- チャンピオンズ：個体値なし・Lv.50 固定。HP = 種族値 + 能力P + 75、ほか = (種族値 + 能力P + 20) × 能力補正。
- `src/app.js` の `// @stat-begin` 〜 `// @stat-end` が計算式で、`verify.py` がここをそのまま取り出して
  全ポケモンの種族値 × 性格 × 設定（約4,000万通り）を @smogon/calc と照合します。

## データと権利

- 出典：PokeAPI（BSD 3-Clause）。ライセンス全文は HTML のフッターに収録しています。
- ポケモン・キャラクター名は任天堂・クリーチャーズ・ゲームフリークの商標です。ゲームの画像は含めていません。

## バトルシミュレーター（battle/）

Pokémon Showdown の対戦エンジンをブラウザで動くようにまとめ、ランクバトルのルール
（チャンピオンズ Reg M-C／SV レギュレーションI の、シングル・ダブル）で対戦できる1枚の HTML を作ります。
ダメージや特性・持ち物の効果などの計算はすべて Showdown のエンジンが行い、この画面では独自に計算しません。

```
git clone https://github.com/smogon/pokemon-showdown /tmp/psfull     # 使ったのはコミット a5df827（2026-09-22）
cd battle && npm install
node transpile-ps.mjs /tmp/psfull                                  # TypeScript を Node 用の JS に変換
node export-ps.js /tmp/psfull ps-data.json <コミット>               # ルール上使えるポケモン・技・特性・持ち物
node validate-teams.js /tmp/psfull sample-teams.txt sample-teams.json   # サンプルチームを検証器にかける
PS_DIR=/tmp/psfull node make-engine.mjs                            # エンジンをブラウザ用の1本の JS に
python build_battle_data.py                                        # 日本語名の対応付け（図鑑の SQLite を使う）
python build_page.py                                               # → build/battle.html
python verify_battle.py                                            # 実ブラウザで操作・編集・CPU 同士の対戦を検証
```

- チーム編集で選べるポケモン・技・特性・持ち物は、Showdown の検証器（TeamValidator）が
  そのルールで使えると判定したものだけです。
- 対戦ログは Showdown の対戦プロトコルを日本語の文に置き換えて表示します（訳のないものは効果名だけを表示）。
- CPU は技の威力・タイプ相性・場の状況から行動を選ぶ簡単なものです。
- 「おまかせ」は相手のチームを自動で組みます（src/battle.js の「おまかせ編成」）。
  6匹の弱点を半減以下で受けられる仲間がいるか（補完率）、同じ弱点の重なり、一致技の範囲、タイプの重複でチームを評価し、
  候補を何通りも作って最も評価の高いものを選びます。チャンピオンズではメガシンカを1〜2匹入れます。
  物理・特殊は「種族値 × 覚える技のいちばん強い威力」で比べ、1割以内でどちらも高ければ両刀にします。
  すばやさ80以上は すばやさ重視（すばやさと攻撃に最大・性格はすばやさ↑）、それ未満は耐久重視（HPと攻撃に最大・性格は攻撃↑）です。
  技は一致技 → 相性の範囲を広げる技の順に選び、ダブルは まもる、物理アタッカーとサポートは ねこだまし を優先します。
  作ったチームは Showdown の検証器にかけて、ルール違反がないことを確かめています（verify_battle.py）。
- おまかせの6割ほどは、天候・フィールドを軸にします（あめ・はれ・すなあらし・ゆき・各フィールド）。
  起こす特性を持つポケモンを1匹入れ、その天候で強くなるポケモン（すいすい・ようりょくそ・一致タイプなど）を優先し、
  起こす役には天候を長持ちさせる持ち物、仲間にはその天候に合う特性・技を選びます。
- CPU の変化技は場面で評価します：狙われそうなら まもる、相手より遅ければ おいかぜ・トリックルーム、
  物理アタッカーには おにび、体力が減ったら回復、味方が得をするなら天候・フィールドの技、など。
  ダメージの見積もりにも天候・フィールドの効果を入れています。
