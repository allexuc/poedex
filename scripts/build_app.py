"""図鑑とバトルシミュレーターを1枚の HTML（build/app.html）にまとめる。

1つのページ・1つの保存場所にすることで、図鑑のブックマークや「チームに追加」を
バトルのチーム編成でそのまま使える（別々のページだと、公開先によっては保存場所が分かれるため）。
CSS はそれぞれ #pd・#bt の中だけに効くように書き換え、画面の切り替えはハッシュで行う。
"""
import base64, html, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BT = ROOT / "battle"
sys.path.insert(0, str(ROOT / "etl"))
from build_html import TYPE_COLORS, text_on, put   # 図鑑と同じタイプ色・文字色

STELLAR = "#3E7F8C"
GLOBAL_SEL = re.compile(r"^(:root|html|body|\*|\[hidden\]|:focus-visible|#app\b|::|\.t\d+$)")


def between(s, a, b):
    i = s.index(a) + len(a)
    return s[i:s.index(b, i)]


def scope_css(css, scope):
    """各ルールのセレクタの前に scope を付ける（:root・html・body などページ全体のものは そのまま）。"""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out, i = [], 0
    while True:
        j = css.find("{", i)
        if j < 0:
            break
        head, depth, k = css[i:j].strip(), 0, j
        while True:
            depth += {"{": 1, "}": -1}.get(css[k], 0)
            if depth == 0:
                break
            k += 1
        body = css[j + 1:k]
        if head.startswith(("@media", "@supports")):
            out.append(f"{head} {{\n{scope_css(body, scope)}\n}}")
        elif head.startswith("@"):
            out.append(f"{head} {{{body}}}")
        else:
            sels = [x.strip() for x in head.split(",")]
            out.append(", ".join(x if GLOBAL_SEL.match(x) else f"{scope} {x}" for x in sels) + " {" + body + "}")
        i = k + 1
    return "\n".join(out)


SHELL_CSS = """
/* 念のため：どこかが横にはみ出しても、ページ全体が広がって（スマホで縮んで）見えないようにする */
#app { overflow-x: clip; }
#bt { overflow-wrap: anywhere; }
.appnav { display: flex; gap: 4px; padding: 8px 0 2px; margin: 0 -2px; }
.appnav a { flex: 1 1 0; display: flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 6px; border-radius: 999px;
  font-weight: 700; font-size: 14px; color: var(--ink-2); text-decoration: none; white-space: nowrap; }
.appnav a:hover { background: var(--soft); }
.appnav a[aria-current="page"] { background: var(--ink); color: var(--paper); }
"""
SHELL_JS = r"""(() => {
  // 図鑑とバトルを1つのページで切り替える（#/b・#/teams・#/team/…・#/set/…・#/battle・#/sim はバトル側）
  const BT = /^#\/(b|teams|team|set|battle|sim)(\/|$)/;
  const tab = h => (/^#\/(teams|team|set)(\/|$)/.test(h) ? 'teams' : /^#\/sim$/.test(h) ? 'sim' : BT.test(h) ? 'b' : 'pd');
  function sync() {
    const h = location.hash, t = tab(h);
    document.getElementById('pd').hidden = t !== 'pd';
    document.getElementById('bt').hidden = t === 'pd';
    for (const a of document.querySelectorAll('#appnav a')) {
      if (a.dataset.tab === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    document.getElementById('appnav').hidden = h === '#/battle';
  }
  window.addEventListener('hashchange', sync);
  sync();
})();"""
NAV = ('<nav class="appnav" id="appnav" aria-label="画面の切り替え"><a href="#/" data-tab="pd">図鑑</a><a href="#/teams" data-tab="teams">チーム</a>'
       '<a href="#/b" data-tab="b">対戦</a><a href="#/sim" data-tab="sim">連戦</a></nav>')


def check_js(name, code):
    assert "</script" not in code.lower(), f"{name} に </script が含まれています"
    if not shutil.which("node"):
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(code)
    r = subprocess.run(["node", "--check", f.name], capture_output=True, text=True)
    Path(f.name).unlink()
    if r.returncode:
        sys.exit(f"{name} に構文エラーがあります:\n" + r.stderr)


def main():
    pd_tpl = (ROOT / "src/template.html").read_text(encoding="utf-8")
    bt_tpl = (BT / "src/battle.html").read_text(encoding="utf-8")
    type_css = "\n".join(f".t{i} {{ --tc: {c}; --tf: {text_on(c)}; }}" for i, c in enumerate(TYPE_COLORS + [STELLAR]))
    pd_css = put((ROOT / "src/app.css").read_text(encoding="utf-8"), "/*__TYPE_COLORS__*/", "", "pd types")
    bt_css = put((BT / "src/battle.css").read_text(encoding="utf-8"), "/*__TYPE_COLORS__*/", "", "bt types")
    css = scope_css(pd_css, "#pd") + "\n" + scope_css(bt_css, "#bt") + "\n" + type_css + SHELL_CSS

    lic = lambda p: html.escape(Path(p).read_text(encoding="utf-8").strip())
    pd_body = put(between(pd_tpl, "<!--PD-->", "<!--/PD-->"), "/*__LICENSE__*/", lic(ROOT / "cache/LICENSE_pokeapi.md"), "pd lic")
    bt_body = between(bt_tpl, "<!--BT-->", "<!--/BT-->").replace('<div id="bt">', '<div id="bt" hidden>', 1)
    bt_body = put(bt_body, "/*__LIC_PS__*/", lic(Path(os.environ.get("PS_DIR", "/tmp/psfull")) / "LICENSE"), "lic-ps")
    bt_body = put(bt_body, "/*__LIC_CHACHA__*/", lic(BT / "node_modules/ts-chacha20/LICENSE"), "lic-chacha")
    bt_body = put(bt_body, "/*__LIC_POKEAPI__*/", lic(ROOT / "cache/LICENSE_pokeapi.md"), "lic-pokeapi")

    head = pd_tpl[:pd_tpl.index("<style>")]
    fonts = re.findall(r'<link rel="stylesheet" href="([^"]+)">', pd_tpl + bt_tpl)
    for href in dict.fromkeys(fonts):          # 両方のページで使うフォントを読み込む（重複は1つに）
        if href not in head:
            head += f'<link rel="stylesheet" href="{href}">\n'
    skeleton = (head + "<style>/*__CSS__*/</style>\n</head>\n<body>\n<div id=\"app\">\n" + NAV + "\n" + pd_body + "\n" + bt_body + "\n</div>\n"
                "<script>/*__SHELL__*/</script>\n"
                '<script id="pd-data" type="application/octet-stream">/*__PD_DATA__*/</script>\n'
                '<script id="bt-data" type="application/octet-stream">/*__BT_DATA__*/</script>\n'
                "<script>/*__ENGINE__*/</script>\n<script>/*__PD_JS__*/</script>\n<script>/*__BT_JS__*/</script>\n</body>\n</html>\n")
    leftover = set(re.findall(r"/\*__[A-Z_]+__\*/", skeleton)) - {f"/*__{x}__*/" for x in ("CSS", "SHELL", "PD_DATA", "BT_DATA", "ENGINE", "PD_JS", "BT_JS")}
    assert not leftover, f"置換漏れ: {leftover}"
    ids = re.findall(r'\sid="([^"]+)"', skeleton)
    dup = sorted({x for x in ids if ids.count(x) > 1})
    assert not dup, f"図鑑とバトルで id が重なっています: {dup}"

    pd_js = (ROOT / "src/app.js").read_text(encoding="utf-8")
    bt_js = (BT / "src/battle.js").read_text(encoding="utf-8")
    engine = (BT / "build/engine.js").read_text(encoding="utf-8")
    for name, code in (("app.js", pd_js), ("battle.js", bt_js), ("shell", SHELL_JS)):
        check_js(name, code)
    assert "</script" not in engine.lower(), "engine.js に </script が含まれています"
    b64 = lambda p: base64.b64encode(Path(p).read_bytes()).decode("ascii")

    page = put(skeleton, "/*__CSS__*/", css, "css")
    page = put(page, "/*__SHELL__*/", SHELL_JS, "shell")
    page = put(page, "/*__PD_DATA__*/", b64(ROOT / "build/data.json.gz"), "pd data")
    page = put(page, "/*__BT_DATA__*/", b64(BT / "build/battle-data.json.gz"), "bt data")
    page = put(page, "/*__PD_JS__*/", pd_js, "pd js")
    page = put(page, "/*__BT_JS__*/", bt_js, "bt js")
    page = put(page, "/*__ENGINE__*/", engine, "engine")    # 最後に入れる（中の文字列に印が含まれていても影響しないように）

    required = {"図鑑のタッチ判定": "cameFromTouch", "追記式の描画": "appendMore", "エンジン": "PSEngine", "ブックマーク": "pd.bookmarks",
                "チームに追加": "data-tadd", "連戦": "simOne", "hidden の優先": "[hidden] { display: none !important; }",
                "セーフエリア": "viewport-fit=cover", "ダークモード": "prefers-color-scheme: dark", "PokeAPI の出典": "PokeAPI",
                "Showdown のライセンス": "Guangcong Luo"}
    missing = [k for k, v in required.items() if v not in page]
    if missing:
        sys.exit("生成物に次の機能が入っていません: " + "、".join(missing))
    out = ROOT / "build/app.html"
    out.write_text(page, encoding="utf-8")
    print(f"{out}  {out.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
