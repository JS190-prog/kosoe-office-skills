"""한컴오피스 한글(COM)로 HWPX를 열어 PDF로 저장하고, 쪽을 가로로 이어 붙인 미리보기 PNG를 만든다.
--hwp 를 주면 같은 이름의 .hwp(한글 문서)도 저장한다. 그 .hwp가 마지막 저장 뒤 바뀌었으면(한글에서 고쳐 저장 등)
build.js와 같은 기록(.gian_build.json)으로 알아보고 --force 없이 덮어쓰지 않는다. PDF·PNG는 확인용이라 늘 새로 만든다.
사용: python hangul_preview.py <파일.hwpx>... [--out <폴더>] [--hwp] [--force] [--dpi 60]
필요: Windows, 한컴오피스 한글, pywin32, PyMuPDF, Pillow
"""
import argparse
import hashlib
import json
import pathlib
import sys

import win32com.client as win32
from PIL import Image

try:
    import pymupdf
except ImportError:  # 예전 PyMuPDF
    import fitz as pymupdf


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", help="PDF·PNG 저장 폴더(기본: 파일 옆)")
    ap.add_argument("--hwp", action="store_true", help=".hwp로도 저장")
    ap.add_argument("--force", action="store_true", help="마지막 저장 뒤 바뀐 .hwp도 덮어쓰기")
    ap.add_argument("--dpi", type=int, default=60)
    a = ap.parse_args()
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()  # noqa: E731
    hwp = win32.gencache.EnsureDispatch("HWPFrame.HwpObject")
    # 파일 접근 확인 창을 띄우지 않게 보안 모듈 등록(한컴 배포 예제 모듈 이름)
    hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModuleExample")
    try:
        hwp.XHwpWindows.Item(0).Visible = False
    except Exception:
        pass
    failed = 0
    try:
        for f in a.files:
            src = pathlib.Path(f).resolve()
            out = pathlib.Path(a.out).resolve() if a.out else src.parent
            out.mkdir(parents=True, exist_ok=True)
            if not hwp.Open(str(src), "HWPX", "forceopen:true"):
                print("ERROR 열기 실패", src)
                failed += 1
                continue
            pdf = out / (src.stem + ".pdf")
            hwp.SaveAs(str(pdf), "PDF", "")
            dst, rec_f = src.with_suffix(".hwp"), src.parent / ".gian_build.json"
            rec = json.loads(rec_f.read_text(encoding="utf-8")) if rec_f.exists() else {}
            saved = False
            if a.hwp and dst.exists() and not a.force and rec.get(dst.name) != sha(dst):
                print("ERROR", dst, "마지막 저장 뒤 바뀐 파일이라 덮어쓰지 않음 — 다른 이름으로 만들거나, 바뀐 내용을 확인한 뒤 --force")
                failed += 1
            elif a.hwp:
                saved = bool(hwp.SaveAs(str(dst), "HWP", ""))
            hwp.Clear(1)
            if saved:  # 한글이 파일을 놓은 뒤 해시를 적는다
                rec[dst.name] = sha(dst)
                rec_f.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
            doc = pymupdf.open(str(pdf))
            pages = [Image.frombytes("RGB", (p.width, p.height), p.samples) for p in (pg.get_pixmap(dpi=a.dpi) for pg in doc)]
            doc.close()
            sheet = Image.new("RGB", (sum(p.width for p in pages) + 10 * (len(pages) - 1), max(p.height for p in pages)), "white")
            x = 0
            for p in pages:
                sheet.paste(p, (x, 0))
                x += p.width + 10
            png = out / (src.stem + ".png")
            sheet.save(png)
            print(f"OK {len(pages)}쪽 PDF {pdf} PNG {png}" + (f" HWP {dst}" if saved else ""))
    finally:
        hwp.Quit()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
