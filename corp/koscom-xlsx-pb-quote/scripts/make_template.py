"""실제 견적서(.xls · .xlsx) + 바꿈표(tsv) → 칸 토큰이 든 서식(.xlsx)

    python scripts/make_template.py 원본.xls 바꿈표.tsv templates/서식.xlsx
    python scripts/make_template.py --inspect 원본.xls        # 셀 주소 · 글 · 그림 목록(바꿈표를 쓸 때 본다)

.xls(엑셀 97-2003)는 글꼴 · 테두리 · 채우기 · 병합 · 열 너비 · 행 높이 · 인쇄 설정 · 그림(JPEG/PNG)을 읽어 .xlsx로 옮긴다.
수식은 계산된 값으로 들어오고, 도형 · 차트 · 조건부 서식은 옮기지 않는다. 바꿈표 형식은 references/template_guide.md.
필요: openpyxl, pillow, (.xls일 때) xlrd.
"""
import io
import os
import re
import struct
import sys

from openpyxl import Workbook, load_workbook
from openpyxl.drawing.image import Image
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor, TwoCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter, range_boundaries
from openpyxl.worksheet.properties import PageSetupProperties

for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding='utf-8', errors='replace')

EMU_PX = 9525                      # 1px(96dpi) = 9525 EMU
LINE = {1: 'thin', 2: 'medium', 3: 'dashed', 4: 'dotted', 5: 'thick', 6: 'double', 7: 'hair', 8: 'mediumDashed',
        9: 'dashDot', 10: 'mediumDashDot', 11: 'dashDotDot', 12: 'mediumDashDotDot', 13: 'slantDashDot'}
HALIGN = {1: 'left', 2: 'center', 3: 'right', 4: 'fill', 5: 'justify', 6: 'centerContinuous', 7: 'distributed'}
VALIGN = {0: 'top', 1: 'center', 2: 'bottom', 3: 'justify', 4: 'distributed'}
PATTERN = {1: 'solid', 2: 'mediumGray', 3: 'darkGray', 4: 'lightGray', 17: 'gray125', 18: 'gray0625'}
TOKEN = re.compile(r'\{\{([^{}]+)\}\}')


# ───────────── 열 너비 · 행 높이(px) ─────────────
def col_px(ws, c):
    """열 너비(글자 수) → px. 숫자 한 글자를 8px로 본다(돋움 · 맑은 고딕 11pt 기준, 그림 위치를 잡는 데만 쓴다)."""
    w = ws.column_dimensions[get_column_letter(c)].width
    return int((w if w else 8.43) * 8 + 5)


def row_px(ws, r):
    h = ws.row_dimensions[r].height
    return (h if h else (ws.sheet_format.defaultRowHeight or 15)) * 96 / 72


# ───────────── .xls → openpyxl ─────────────
def _biff(path):
    """Workbook 스트림의 레코드를 (하위 스트림 번호, 레코드 종류, 내용)으로 돌려준다."""
    from xlrd import compdoc
    cd = compdoc.CompDoc(open(path, 'rb').read(), logfile=open(os.devnull, 'w'))
    mem, base, size = cd.locate_named_stream('Workbook')
    buf, pos, sub, out = mem[base:base + size], 0, -1, []
    while pos + 4 <= len(buf):
        rc, ln = struct.unpack('<HH', buf[pos:pos + 4])
        d = buf[pos + 4:pos + 4 + ln]
        pos += 4 + ln
        if rc == 0x809:
            sub += 1
        out.append((sub, rc, d))
    return out


def _escher(d, out, depth=0):
    p = 0
    while p + 8 <= len(d):
        verinst, typ, ln = struct.unpack('<HHI', d[p:p + 8])
        body = d[p + 8:p + 8 + ln]
        if verinst & 0xF == 0xF:
            _escher(body, out, depth + 1)
        else:
            out.append((typ, verinst >> 4, body))
        p += 8 + ln
    return out


def _xls_pictures(recs):
    """→ {하위 스트림 번호: [(그림 바이트, (c1, dx1, r1, dy1, c2, dx2, r2, dy2))]} — JPEG · PNG만."""
    grp, last = b'', None
    for sub, rc, d in recs:
        if rc == 0xEB or (rc == 0x3C and last == 0xEB):
            grp += d
            last = 0xEB
        else:
            last = rc
    blips = []
    for typ, inst, body in _escher(grp, []):
        if typ == 0xF007:                                   # BSE: 머리 36바이트 뒤에 그림 레코드
            at = [i for i in (body.find(b'\x89PNG\r\n'), body.find(b'\xff\xd8\xff')) if i >= 0]
            blips.append(body[min(at):] if at else None)
    pics = {}
    for sub, rc, d in recs:
        if rc != 0xEC:
            continue
        pib = anchor = None
        for typ, inst, body in _escher(d, []):
            if typ == 0xF00A:                               # 새 도형 시작
                pib = anchor = None
            elif typ == 0xF00B:
                for i in range(0, min(len(body), inst * 6), 6):
                    pid, val = struct.unpack('<HI', body[i:i + 6])
                    if pid & 0x3FFF == 260:                 # pib: 그림 번호(1부터)
                        pib = val
            elif typ == 0xF010:
                anchor = struct.unpack('<HHHHHHHH', body[2:18])
            if pib and anchor:
                data = blips[pib - 1] if pib - 1 < len(blips) else None
                if data:
                    pics.setdefault(sub, []).append((data, anchor))
                else:
                    print(f'WARN 그림 {pib}은(는) JPEG · PNG가 아니라 옮기지 않음')
                pib = anchor = None
    return pics


def from_xls(path):
    import xlrd
    book = xlrd.open_workbook(path, formatting_info=True)
    recs = _biff(path)
    pics = _xls_pictures(recs)
    sheet_subs = [sub for sub, rc, d in recs if rc == 0x809 and struct.unpack('<H', d[2:4])[0] == 0x10]
    wb = Workbook()
    wb.remove(wb.active)
    f0 = book.font_list[0]
    normal = wb._named_styles['Normal']                    # 열 너비의 기준이 되는 기본 글꼴
    normal.font = Font(name=f0.name, sz=f0.height / 20)
    normal.bind(wb)

    def rgb(idx):
        c = book.colour_map.get(idx)
        return '%02X%02X%02X' % c if c else None

    def side(style, colour):
        return Side(style=LINE.get(style), color=rgb(colour)) if style else Side()

    cache = {}

    def style_of(xfi):
        if xfi not in cache:
            xf = book.xf_list[xfi]
            f, a, b, bg = book.font_list[xf.font_index], xf.alignment, xf.border, xf.background
            fill = PatternFill(PATTERN.get(bg.fill_pattern, 'solid'), fgColor=rgb(bg.pattern_colour_index) or 'FFFFFF') if bg.fill_pattern else PatternFill()
            cache[xfi] = (
                Font(name=f.name, sz=f.height / 20, b=bool(f.bold), i=bool(f.italic), strike=bool(f.struck_out),
                     u={1: 'single', 2: 'double', 0x21: 'singleAccounting', 0x22: 'doubleAccounting'}.get(f.underline_type), color=rgb(f.colour_index)),
                fill,
                Border(left=side(b.left_line_style, b.left_colour_index), right=side(b.right_line_style, b.right_colour_index),
                       top=side(b.top_line_style, b.top_colour_index), bottom=side(b.bottom_line_style, b.bottom_colour_index)),
                Alignment(horizontal=HALIGN.get(a.hor_align), vertical=VALIGN.get(a.vert_align), wrap_text=bool(a.text_wrapped),
                          shrink_to_fit=bool(a.shrink_to_fit), indent=a.indent_level, text_rotation=a.rotation if a.rotation <= 180 else 0),
                book.format_map[xf.format_key].format_str)
        return cache[xfi]

    for si, sh in enumerate(book.sheets()):
        ws = wb.create_sheet(sh.name)
        sub = sheet_subs[si] if si < len(sheet_subs) else None
        for c, ci in sh.colinfo_map.items():
            if c < sh.ncols:
                ws.column_dimensions[get_column_letter(c + 1)].width = ci.width / 256
        for r, ri in sh.rowinfo_map.items():
            if r < sh.nrows:
                ws.row_dimensions[r + 1].height = ri.height / 20
        for r in range(sh.nrows):
            for c in range(sh.ncols):
                cell = sh.cell(r, c)
                if cell.ctype == 0 and cell.xf_index is None:
                    continue
                o = ws.cell(row=r + 1, column=c + 1)
                o.font, o.fill, o.border, o.alignment, o.number_format = style_of(cell.xf_index)
                if cell.ctype == 1:
                    o.value = cell.value
                elif cell.ctype == 2:
                    o.value = int(cell.value) if cell.value == int(cell.value) else cell.value
                elif cell.ctype == 3:
                    o.value = xlrd.xldate_as_datetime(cell.value, book.datemode)
                elif cell.ctype == 4:
                    o.value = bool(cell.value)
        for r0, r1, c0, c1 in sh.merged_cells:
            # 병합 범위의 바깥 테두리를 왼쪽 위 칸에 모아 둔다(openpyxl은 병합 칸의 테두리를 왼쪽 위 칸에서 가져온다)
            a = ws.cell(row=r0 + 1, column=c0 + 1)
            b = a.border
            a.border = Border(left=b.left, top=b.top, right=ws.cell(row=r0 + 1, column=c1).border.right, bottom=ws.cell(row=r1, column=c0 + 1).border.bottom)
            ws.merge_cells(start_row=r0 + 1, start_column=c0 + 1, end_row=r1, end_column=c1)
        # 인쇄 · 보기 설정
        for s, rc, d in recs:
            if s != sub:
                continue
            if rc == 0xA1:
                paper, scale, _, fw, fh, opts = struct.unpack('<HHhHHH', d[:12])
                hm, fm = struct.unpack('<dd', d[16:32])
                ws.page_setup.paperSize = paper
                ws.page_setup.orientation = 'portrait' if opts & 2 else 'landscape'
                ws.page_setup.scale, ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = scale, fw, fh
                ws.page_margins.header, ws.page_margins.footer = hm, fm
            elif rc in (0x26, 0x27, 0x28, 0x29):
                setattr(ws.page_margins, {0x26: 'left', 0x27: 'right', 0x28: 'top', 0x29: 'bottom'}[rc], struct.unpack('<d', d)[0])
            elif rc == 0x83:
                ws.print_options.horizontalCentered = bool(struct.unpack('<H', d[:2])[0])
            elif rc == 0x84:
                ws.print_options.verticalCentered = bool(struct.unpack('<H', d[:2])[0])
            elif rc == 0x81 and struct.unpack('<H', d)[0] & 0x100:
                ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
            elif rc == 0x23E:
                opts = struct.unpack('<H', d[:2])[0]
                ws.sheet_view.showGridLines = bool(opts & 2)
                if opts & 0x800:
                    ws.sheet_view.view = 'pageBreakPreview'
                if len(d) >= 14:
                    slv, nor = struct.unpack('<HH', d[10:14])
                    ws.sheet_view.zoomScaleSheetLayoutView, ws.sheet_view.zoomScaleNormal = slv or 100, nor or 100
                    ws.sheet_view.zoomScale = (slv if opts & 0x800 else nor) or 100
        for n in book.name_obj_list:
            if n.name == 'Print_Area' and n.result is not None and (n.scope == si or n.result.text.split('!')[0].strip("'") == sh.name):
                ws.print_area = n.result.text.split('!')[-1].replace('$', '')
        for data, (c1, dx1, r1, dy1, c2, dx2, r2, dy2) in pics.get(sub, []):
            # 높이는 행 높이(pt)로 정확히 알 수 있다. 너비는 그림의 가로세로 비율로 정해 찌그러지지 않게 한다
            img = Image(io.BytesIO(data))
            top = dy1 / 256 * row_px(ws, r1 + 1)
            h = sum(row_px(ws, r + 1) for r in range(r1, r2)) - top + dy2 / 256 * row_px(ws, r2 + 1)
            w = h * img.width / img.height
            img.width, img.height = round(w), round(h)
            img.anchor = OneCellAnchor(_from=AnchorMarker(col=c1, colOff=int(dx1 / 1024 * col_px(ws, c1 + 1)) * EMU_PX, row=r1, rowOff=int(top) * EMU_PX),
                                       ext=XDRPositiveSize2D(round(w) * EMU_PX, round(h) * EMU_PX))
            ws.add_image(img)
    return wb


# ───────────── 그림 위치 ─────────────
def pic_box(ws, img):
    """그림이 놓인 칸과 크기 → (행, 열, 너비px, 높이px, 칸 왼쪽에서 px, 칸 위에서 px)"""
    a = img.anchor
    f = a._from
    dx, dy = round(f.colOff / EMU_PX), round(f.rowOff / EMU_PX)
    if isinstance(a, TwoCellAnchor):
        t = a.to
        w = sum(col_px(ws, c + 1) for c in range(f.col, t.col)) - dx + round(t.colOff / EMU_PX)
        h = sum(row_px(ws, r + 1) for r in range(f.row, t.row)) - dy + round(t.rowOff / EMU_PX)
    else:
        w, h = round(a.ext.width / EMU_PX), round(a.ext.height / EMU_PX)
    return f.row + 1, f.col + 1, round(w), round(h), dx, dy


# ───────────── 바꿈표 ─────────────
def apply_table(wb, path):
    ws = wb.worksheets[0]
    drop = []
    for no, line in enumerate(open(path, encoding='utf-8-sig').read().splitlines(), 1):
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        p = line.split('\t')
        kind = p[0].strip().upper()
        try:
            if kind == 'S':                                 # S <시트 이름> — 이 줄부터 그 시트에 적용
                ws = wb[p[1].strip()]
            elif kind == 'L':                               # L <찾을 글> <바꿀 글>
                hit = 0
                for row in ws.iter_rows():
                    for c in row:
                        if isinstance(c.value, str) and p[1] in c.value:
                            c.value = c.value.replace(p[1], p[2])
                            hit += 1
                if not hit:
                    print(f'WARN {no}행: 찾는 글이 없음: {p[1]!r}')
            elif kind == 'C':                               # C <셀 또는 범위> <글>
                c0, r0, c1, r1 = range_boundaries(p[1].strip())
                for r in range(r0, r1 + 1):
                    for c in range(c0, c1 + 1):
                        cell = ws.cell(row=r, column=c)
                        if type(cell).__name__ != 'MergedCell':
                            cell.value = p[2] if len(p) > 2 and p[2] != '' else None
            elif kind == 'P':                               # P <그림 번호> -  |  P <그림 번호> {{@이름}}
                img = ws._images[int(p[1]) - 1]
                what = p[2].strip()
                if what != '-':
                    name = TOKEN.fullmatch(what).group(1).lstrip('@').strip()
                    r, c, w, h, dx, dy = pic_box(ws, img)
                    cell = ws.cell(row=r, column=c)
                    if cell.value not in (None, ''):
                        raise ValueError(f'그림 자리 칸 {cell.coordinate}에 이미 글이 있음')
                    cell.value = '{{@%s %dx%d+%d+%d}}' % (name, w, h, dx, dy)
                drop.append((ws, img))
            else:
                raise ValueError('L · C · P · S 중 하나여야 함')
        except Exception as e:
            sys.exit(f'FAIL 바꿈표 {no}행: {e}')
    for ws, img in drop:
        ws._images.remove(img)


def report(wb):
    for ws in wb.worksheets:
        print(f'[{ws.title}] {ws.dimensions} · 인쇄 영역 {ws.print_area or "-"} · 병합 {len(ws.merged_cells.ranges)}곳')
        for i, img in enumerate(ws._images, 1):
            r, c, w, h, dx, dy = pic_box(ws, img)
            print(f'  그림 {i}: {get_column_letter(c)}{r}부터 {w}x{h}px')
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None and type(c).__name__ != 'MergedCell':
                    print(f'  {c.coordinate}\t{c.value!r}')


def main(argv):
    if len(argv) == 2 and argv[0] == '--inspect':
        src = argv[1]
        wb = from_xls(src) if src.lower().endswith('.xls') else load_workbook(src)
        return report(wb)
    if len(argv) != 3:
        sys.exit(__doc__)
    src, table, out = argv
    wb = from_xls(src) if src.lower().endswith('.xls') else load_workbook(src)
    apply_table(wb, table)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    wb.save(out)
    tokens = sorted({m for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) for m in TOKEN.findall(c.value)})
    print('서식에 든 칸:', ' · '.join(tokens))
    print('서식에 남은 글(고객사명 · 금액 · 사람 이름이 없는지 본다):')
    report(wb)
    print('OK', os.path.abspath(out))


if __name__ == '__main__':
    main(sys.argv[1:])
