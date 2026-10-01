"""バトル画面の単一 HTML を作る（src/ のテンプレートに CSS・エンジン・データ・アプリを埋め込む）。"""
import base64, html, os, shutil, subprocess, sys, tempfile
from pathlib import Path

B = Path(__file__).resolve().parent
ROOT = B.parent
sys.path.insert(0, str(ROOT / "etl"))
from build_html import TYPE_COLORS, text_on   # 図鑑と同じタイプ色・文字色の決め方

STELLAR = "#3E7F8C"


def put(s, marker, value, label):
    n = s.count(marker)
    assert n == 1, f"{label}: {marker} の出現回数が {n}"
    return s.replace(marker, value)


def main():
    css = (B / "src/battle.css").read_text(encoding="utf-8")
    colors = TYPE_COLORS + [STELLAR]
    css = put(css, "/*__TYPE_COLORS__*/", "\n".join(f".t{i} {{ --tc: {c}; --tf: {text_on(c)}; }}" for i, c in enumerate(colors)), "types")
    js = (B / "src/battle.js").read_text(encoding="utf-8")
    engine = (B / "build/engine.js").read_text(encoding="utf-8")
    for name, code in (("battle.js", js), ("engine.js", engine)):
        assert "</script" not in code.lower(), f"{name} に </script が含まれています"
    if shutil.which("node"):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(js)
        r = subprocess.run(["node", "--check", f.name], capture_output=True, text=True)
        Path(f.name).unlink()
        if r.returncode:
            sys.exit("battle.js に構文エラーがあります:\n" + r.stderr)
    data = base64.b64encode((B / "build/battle-data.json.gz").read_bytes()).decode("ascii")
    lic = lambda p: html.escape(Path(p).read_text(encoding="utf-8").strip())
    page = (B / "src/battle.html").read_text(encoding="utf-8")
    page = put(page, "/*__CSS__*/", css, "css")
    page = put(page, "/*__LIC_PS__*/", lic(Path(os.environ.get("PS_DIR", "/tmp/psfull")) / "LICENSE"), "lic-ps")
    page = put(page, "/*__LIC_CHACHA__*/", lic(B / "node_modules/ts-chacha20/LICENSE"), "lic-chacha")
    page = put(page, "/*__LIC_POKEAPI__*/", lic(ROOT / "cache/LICENSE_pokeapi.md"), "lic-pokeapi")
    page = put(page, "/*__DATA__*/", data, "data")
    page = put(page, "/*__JS__*/", js, "js")
    page = put(page, "/*__ENGINE__*/", engine, "engine")   # 最後に入れる（中の文字列に印が含まれていても影響しないように）
    required = {"タッチ判定": "cameFromTouch", "エンジン": "PSEngine", "hidden の優先": "[hidden] { display: none !important; }",
                "セーフエリア": "viewport-fit=cover", "ダークモード": "prefers-color-scheme: dark", "ライセンス": "Guangcong Luo"}
    missing = [k for k, v in required.items() if v not in page]
    if missing:
        sys.exit("生成物に入っていないもの: " + ", ".join(missing))
    out = B / "build/battle.html"
    out.write_text(page, encoding="utf-8")
    print(f"{out}  {out.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
