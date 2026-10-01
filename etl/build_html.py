"""src/ のテンプレート・CSS・JS と build/data.json.gz から、単一 HTML を生成する。

HTML は生成物。UI の修正は必ず src/ 側で行う（生成物を直接直すと次のビルドで消える）。
"""
import base64, html, os, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT, CACHE = ROOT / "src", ROOT / "build", ROOT / "cache"

# types の添字順（PokeAPI の type_id 1..18）
TYPE_COLORS = ["#9FA19F", "#FF8000", "#81B9EF", "#9141CB", "#915121", "#AFA981", "#91A119", "#704170", "#60A1B8",
               "#E62829", "#2980EF", "#3FA129", "#FAC000", "#EF4179", "#3DCEF3", "#5060E1", "#624D4E", "#EF70EF"]
INK = "#161B28"


def luminance(hexcolor):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hexcolor[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def text_on(bg):
    # 太い一文字を載せるので、白で 3.8 以上取れれば白、取れなければ濃紺
    return "#FFFFFF" if contrast(bg, "#FFFFFF") >= 3.8 else INK


def put(s, marker, value, label):
    # str.replace は対象が無くても例外にならないので、出現回数を必ず確かめる
    n = s.count(marker)
    assert n == 1, f"{label}: {marker} の出現回数が {n}"
    return s.replace(marker, value)


def main():
    css = (SRC / "app.css").read_text(encoding="utf-8")
    type_css = "\n".join(f".t{i} {{ --tc: {c}; --tf: {text_on(c)}; }}" for i, c in enumerate(TYPE_COLORS))
    css = put(css, "/*__TYPE_COLORS__*/", type_css, "type colors")
    js = (SRC / "app.js").read_text(encoding="utf-8")
    assert "</script" not in js.lower(), "JS に </script が含まれています"
    # 構文エラーのまま埋め込むと、ページが「展開中」のまま止まる。Node があれば事前に構文を確かめる
    if shutil.which("node"):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(js)
        r = subprocess.run(["node", "--check", f.name], capture_output=True, text=True)
        Path(f.name).unlink()
        if r.returncode:
            print("app.js に構文エラーがあります:\n" + r.stderr.replace(f.name, "src/app.js"))
            sys.exit(1)
    else:
        print("注意: node が見つからないため、JS の構文チェックを省きました")
    lic = html.escape((CACHE / "LICENSE_pokeapi.md").read_text(encoding="utf-8").strip())
    data = base64.b64encode((OUT / "data.json.gz").read_bytes()).decode("ascii")

    page = (SRC / "template.html").read_text(encoding="utf-8")
    page = put(page, "/*__CSS__*/", css, "css")
    page = put(page, "/*__LICENSE__*/", lic, "license")
    page = put(page, "/*__LINK_BATTLE__*/", html.escape(os.environ.get("LINK_BATTLE", "battle.html")), "link")
    page = put(page, "/*__JS__*/", js, "js")
    page = put(page, "/*__DATA__*/", data, "data")

    # 生成物に主要機能が入っているかを検査する（スクリプトの更新漏れに気づくための歯止め）
    required = {
        "タッチ端末の自動フォーカス抑止": "cameFromTouch",
        "スクロール保持": "keepScrollInResults",
        "追記式の描画": "appendMore",
        "gzip 展開": "DecompressionStream",
        "hidden の優先": "[hidden] { display: none !important; }",
        "セーフエリア対応": "viewport-fit=cover",
        "ダークモード": 'prefers-color-scheme: dark',
        "タイプ色": ".t17 {",
        "出典表記": "PokeAPI",
    }
    missing = [name for name, needle in required.items() if needle not in page]
    if missing:
        print("生成物に次の機能が入っていません:", *missing, sep="\n  - ")
        sys.exit(1)
    for marker in ("/*__CSS__*/", "/*__JS__*/", "/*__DATA__*/", "/*__LICENSE__*/", "/*__TYPE_COLORS__*/"):
        assert marker not in page, f"置換漏れ: {marker}"

    out = OUT / "pokedex.html"
    out.write_text(page, encoding="utf-8")
    print(f"{out}  {out.stat().st_size / 1e6:.2f} MB  (data base64 {len(data) / 1e6:.2f} MB)")
    for i, c in enumerate(TYPE_COLORS):
        print(f"  t{i:<2} {c} 文字色 {text_on(c)}  比 {contrast(c, text_on(c)):.2f}", end="\n" if i % 3 == 2 else "")


if __name__ == "__main__":
    main()
