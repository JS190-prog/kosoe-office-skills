"""values.json → 견적서 .xlsx — 서식(templates/*.xlsx)의 칸 토큰에 값을 넣는다.

    python scripts/render.py values.json 견적서.xlsx
    python scripts/render.py values.json 견적서.xlsx --image 직인=C:/내폴더/seal.png --template templates/pb_addon_quote.xlsx

표준출력이 `OK <경로>`로 끝나면 성공. `WARN …`은 비어 인쇄되는 칸 등 사람이 봐야 할 것. 필요: openpyxl, pillow(서식의 로고 · 넣는 그림).

서식의 토큰
  {{이름}}            fields.이름
  {{?이름}}           fields.이름 — 값이 없으면 그 행을 통째로 뺀다
  {{표.열}}           이 토큰이 든 행이 반복 행. rows.표의 건수만큼 행을 늘린다
  {{sum:표.열}}       rows.표의 그 열을 더한 값
  {{#여백}}           여백 행. 반복 행이 늘어난 높이만큼 빼서(줄어들면 더해서) 전체 높이를 맞춘다
  {{@이름 WxH+X+Y}}   그림 자리. images.이름(또는 --image 이름=경로)이 있으면 그 칸에 W×H px 안으로 넣는다
"""
import json
import math
import os
import re
import sys
import unicodedata
from copy import copy

from openpyxl import load_workbook
from openpyxl.styles import Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.cell_range import MultiCellRange
from openpyxl.worksheet.dimensions import RowDimension

for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding='utf-8', errors='replace')

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TEMPLATE = os.path.join(SKILL, 'templates', 'pb_addon_quote.xlsx')
TOKEN = re.compile(r'\{\{([^{}]+)\}\}')
SLOT = re.compile(r'@(\S+)\s+(\d+)x(\d+)(?:\+(\d+)\+(\d+))?')
NUM = re.compile(r'-?\d[\d,]*(\.\d+)?')
EMU_PX = 9525
warns = []


def warn(msg):
    if msg not in warns:
        warns.append(msg)
        print('WARN', msg)


def num(v):
    """'18,000' → 18000 · '-'나 빈 값 → 0 · 숫자가 아니면 None"""
    if isinstance(v, (int, float)):
        return v
    s = str(v if v is not None else '').strip()
    if s in ('', '-', '–', '－'):
        return 0
    if NUM.fullmatch(s):
        x = float(s.replace(',', ''))
        return int(x) if x == int(x) else x
    return None


def typed(cell_format, v):
    """숫자 표시 형식이 걸린 칸이면 숫자로 넣는다(천 단위 쉼표 · 0은 '-' 표시가 서식대로 나온다)."""
    if isinstance(v, (int, float)):
        return v
    s = str(v if v is not None else '')
    if cell_format not in ('General', '@') and s.strip():
        n = num(s)
        if n is not None:
            return n
    return s if s.strip() else None


class Filler:
    def __init__(self, values):
        self.fields = {str(k).strip(): v for k, v in (values.get('fields') or {}).items()}
        self.rows = values.get('rows') or {}

    def field(self, name):
        if name not in self.fields:
            warn(f'[{name}] 값이 없어 비워 둠')
            return ''
        v = self.fields[name]
        return '' if v is None else v

    def total(self, spec):
        table, col = spec.split('.', 1)
        nums = [num((r or {}).get(col)) for r in self.rows.get(table) or []]
        if not nums or any(n is None for n in nums):
            warn(f'[{table}.{col}] 숫자가 아닌 값이 있거나 행이 없어 합계를 내지 못함')
            return ''
        return sum(nums)

    def value(self, key, row):
        key = key.strip()
        if key.startswith(('#', '@')):
            return ''
        if key.startswith('sum:'):
            return self.total(key[4:].strip())
        if key.startswith('?'):
            return self.fields.get(key[1:].strip()) or ''
        if '.' in key:
            col = key.split('.', 1)[1]
            return '' if row is None else ('' if row.get(col) is None else row.get(col))
        return self.field(key)

    def fill(self, text, cell_format, row=None):
        if not isinstance(text, str) or '{{' not in text:
            return text
        m = TOKEN.fullmatch(text.strip())
        if m and m.group(1).strip().startswith('@'):
            return text                                      # 그림 자리는 마지막에 처리한다
        if m:
            return typed(cell_format, self.value(m.group(1), row))
        out = TOKEN.sub(lambda m: str(self.value(m.group(1), row)), text)
        return out if out.strip() else None


def tokens_in(ws, r, max_col):
    out = []
    for c in range(1, max_col + 1):
        v = ws.cell(row=r, column=c).value
        if isinstance(v, str):
            out += [(c, t.strip()) for t in TOKEN.findall(v)]
    return out


def lines_of(text, width_chars, font_sz):
    """줄 바꿈이 켜진 칸에서 글이 몇 줄이 되는지 어림한다. 열 너비 1 = 기본 글꼴(11pt) 숫자 한 글자, 한글 · 한자는 1.85칸."""
    cap = max(4.0, (width_chars - 1) * 11 / font_sz)
    n = 0
    for para in str(text).splitlines() or ['']:
        units = sum(1.85 if unicodedata.east_asian_width(ch) in 'WF' else 1 for ch in para)
        n += max(1, math.ceil(units / cap - 1e-9))
    return n


def need_height(ws, r, f, data, spans, max_col):
    """값을 넣었을 때 이 행에 필요한 높이(pt) — 토큰이 든 줄 바꿈 칸만 본다."""
    need = 0.0
    for c in range(1, max_col + 1):
        cell = ws._cells.get((r, c))
        if cell is None or not isinstance(cell.value, str) or '{{' not in cell.value or not cell.alignment.wrap_text:
            continue
        v = f.fill(cell.value, cell.number_format, data)
        if isinstance(v, str) and not v.startswith('{{@'):
            width = sum(ws.column_dimensions[get_column_letter(k)].width or 8.43 for k in range(c, spans.get((r, c), c) + 1))
            sz = cell.font.sz or 11
            need = max(need, lines_of(v, width, sz) * sz * 1.27 + 1)
    return need


def fill_sheet(ws, f, images):
    max_row, max_col = ws.max_row, ws.max_column
    height = lambda r: ws.row_dimensions[r].height or ws.sheet_format.defaultRowHeight or 15
    spans = {(mr.min_row, mr.min_col): mr.max_col for mr in ws.merged_cells.ranges if mr.min_row == mr.max_row}

    def tall(r, data=None):
        """글이 넘치면 늘린 높이, 아니면 None(서식 높이 그대로). 2pt까지는 봐준다."""
        n = need_height(ws, r, f, data, spans, max_col)
        return n if n > height(r) + 2 else None
    rep, fillers, dropped = {}, [], set()
    for r in range(1, max_row + 1):
        for c, t in tokens_in(ws, r, max_col):
            if t == '#여백':
                fillers.append(r)
            elif t.startswith('?') and not str(f.fields.get(t[1:].strip()) or '').strip():
                dropped.add(r)
                print(f'INFO [{t[1:].strip()}] 값이 없어 그 줄을 뺌')
            elif '.' in t and not t.startswith(('sum:', '@', '#', '?')):
                rep.setdefault(r, (t.split('.', 1)[0], set()))[1].add(c)
    fillers = [r for r in dict.fromkeys(fillers) if r not in rep]
    changed = sorted(set(rep) | set(fillers) | dropped)
    # 값이 길어 줄이 늘어나는 행은 높이를 키운다(반복 행은 건마다)
    base = {r: height(r) for r in range(1, max_row + 1)}
    grow = {r: t for r in range(1, max_row + 1) if r not in rep and r not in dropped and r not in fillers for t in [tall(r)] if t}
    hrep = {(r, i): tall(r, d if isinstance(d, dict) else None) or base[r] for r, (table, _) in rep.items() for i, d in enumerate(f.rows.get(table) or [None])}
    for r, h in grow.items():
        ws.row_dimensions[r].height = h
    if changed:
        first = changed[0]
        # 1. 행 계획: (서식 행, 반복 행의 값, 몇 번째 복제, 높이)
        delta, counts = sum(h - base[r] for r, h in grow.items()), {}
        for r, (table, _) in rep.items():
            data = f.rows.get(table) or []
            if not data:
                warn(f'[{table}] 행이 없어 빈 행 하나를 둠')
            counts[r] = max(len(data), 1)
            delta += sum(hrep[(r, i)] for i in range(counts[r])) - base[r]
        delta -= sum(base[r] for r in dropped)
        # 여백 행으로 전체 높이를 서식과 같게 맞춘다: 늘어난 만큼 여백을 줄이고(모자라면 마지막 여백 행의 높이를 깎고), 줄어든 만큼 늘린다
        fill_h = {}
        if fillers:
            target = sum(base[r] for r in fillers) - delta
            if target < -1:
                warn('표 행이 많아 여백 행을 모두 썼습니다 — 한 쪽을 넘을 수 있으니 인쇄 미리 보기로 확인하세요')
            acc = 0.0
            for r in fillers:
                room = target - acc
                if room >= base[r] - 0.01:
                    fill_h[r] = [base[r]]
                elif room >= 3:
                    fill_h[r] = [round(room, 2)]
                else:
                    dropped.add(r)
                    continue
                acc += fill_h[r][0]
            last = fillers[-1]
            while target - acc >= 3 and last in fill_h:          # 줄어든 만큼 마지막 여백 행을 복제
                h = round(min(base[last], target - acc), 2)
                fill_h[last].append(h)
                acc += h
        plan = []
        for r in range(first, max_row + 1):
            if r in dropped:
                continue
            if r in rep:
                data = f.rows.get(rep[r][0]) or [None]
                plan += [(r, d if isinstance(d, dict) else None, i, hrep[(r, i)]) for i, d in enumerate(data)]
            elif r in fill_h:
                plan += [(r, None, 0, h) for h in fill_h[r]]
            else:
                plan.append((r, None, 0, ws.row_dimensions[r].height))
        # 2. 서식 행을 떠 둔다
        src = {r: {'cells': [(c, ws.cell(row=r, column=c).value, copy(ws.cell(row=r, column=c)._style)) for c in range(1, max_col + 1) if (r, c) in ws._cells]}
               for r in range(first, max_row + 1)}
        keep, local, multi = [], {}, []
        for mr in list(ws.merged_cells.ranges):
            if mr.max_row < first:
                keep.append(mr)
            elif mr.min_row == mr.max_row:
                local.setdefault(mr.min_row, []).append((mr.min_col, mr.max_col))
            else:
                multi.append(mr)
        # 3. 지우고 다시 쓴다
        for key in [k for k in ws._cells if k[0] >= first]:
            del ws._cells[key]
        for r in [k for k in ws.row_dimensions.keys() if k >= first]:
            del ws.row_dimensions[r]
        ws.merged_cells = MultiCellRange(keep)
        where = {}                                           # 서식 행 → 새 행(한 번만 나온 행)
        for i, (r, data, nth, h) in enumerate(plan):
            nr = first + i
            where[r] = nr if r not in where and nth == 0 else where.get(r)
            if h is not None:
                ws.row_dimensions[nr] = RowDimension(ws, index=nr, ht=h, customHeight=True)
            line_cols = set()
            if nth:                                          # 복제한 행 위에 가는 구분선
                for c in rep[r][1]:
                    line_cols.update(range(c, spans.get((r, c), c) + 1))
            for c, v, style in src[r]['cells']:
                cell = ws.cell(row=nr, column=c)
                cell._style = copy(style)
                cell.value = f.fill(v, cell.number_format, data)
                if c in line_cols:
                    b = copy(cell.border)
                    cell.border = Border(left=b.left, right=b.right, bottom=b.bottom, top=Side(style='hair'))
            for c0, c1 in local.get(r, []):
                ws.merge_cells(start_row=nr, start_column=c0, end_row=nr, end_column=c1)
        for mr in multi:
            rows = [where.get(r) for r in range(mr.min_row, mr.max_row + 1)]
            if None in rows or any(r in rep and counts[r] > 1 for r in range(mr.min_row, mr.max_row + 1)):
                raise SystemExit(f'FAIL 여러 행에 걸친 병합 {mr.coord}이 반복 행 · 뺀 행과 겹친다 — 서식을 고쳐야 한다')
            ws.merge_cells(start_row=rows[0], start_column=mr.min_col, end_row=rows[-1], end_column=mr.max_col)
        # 4. 인쇄 영역의 끝 행
        if ws.print_area:
            area = (ws.print_area if isinstance(ws.print_area, str) else ws.print_area[0]).split('!')[-1].replace('$', '')
            m = re.fullmatch(r'([A-Z]+)(\d+):([A-Z]+)(\d+)', area)
            if m and int(m.group(4)) >= first:
                end = where.get(int(m.group(4))) or int(m.group(4)) + (first + len(plan) - 1 - max_row)
                ws.print_area = f'{m.group(1)}{m.group(2)}:{m.group(3)}{end}'
    else:
        first = max_row + 1
    # 5. 나머지 칸(다시 쓰지 않은 위쪽)과 그림 자리
    for (r, c), cell in list(ws._cells.items()):
        v = cell.value
        if not isinstance(v, str) or '{{' not in v:
            continue
        m = TOKEN.fullmatch(v.strip())
        s = SLOT.fullmatch(m.group(1).strip()) if m else None
        if s:
            cell.value = None
            name, w, h, dx, dy = s.group(1), int(s.group(2)), int(s.group(3)), int(s.group(4) or 0), int(s.group(5) or 0)
            path = images.get(name)
            if path:
                add_image(ws, path, r, c, w, h, dx, dy)
            else:
                print(f'INFO [{name}] 그림을 주지 않아 자리를 비워 둠')
        elif r < first:
            cell.value = f.fill(v, cell.number_format)


def add_image(ws, path, r, c, w, h, dx, dy):
    from openpyxl.drawing.image import Image
    from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
    from openpyxl.drawing.xdr import XDRPositiveSize2D
    if not os.path.isfile(path):
        raise SystemExit(f'FAIL 그림 파일이 없음: {path}')
    img = Image(path)
    k = min(w / img.width, h / img.height)                   # 자리 안에 비율을 지켜 넣는다
    iw, ih = round(img.width * k), round(img.height * k)
    img.width, img.height = iw, ih
    img.anchor = OneCellAnchor(_from=AnchorMarker(col=c - 1, colOff=(dx + (w - iw) // 2) * EMU_PX, row=r - 1, rowOff=(dy + (h - ih) // 2) * EMU_PX),
                               ext=XDRPositiveSize2D(iw * EMU_PX, ih * EMU_PX))
    ws.add_image(img)


def render(values_path, out, template=DEFAULT_TEMPLATE, images=None):
    values = json.load(open(values_path, encoding='utf-8-sig'))
    base = os.path.dirname(os.path.abspath(values_path))
    imgs = {k: os.path.join(base, v) for k, v in (values.get('images') or {}).items() if v}
    imgs.update(images or {})
    try:
        import PIL  # noqa: F401 — openpyxl은 pillow가 있어야 서식의 그림을 읽는다
    except ImportError:
        warn('pillow가 없어 서식의 그림(회사 로고)이 빠집니다 — pip install pillow')
    wb = load_workbook(template)
    f = Filler(values)
    for ws in wb.worksheets:
        fill_sheet(ws, f, imgs)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    wb.save(out)
    return os.path.abspath(out)


def main(argv):
    args, template, images = [], DEFAULT_TEMPLATE, {}
    it = iter(argv)
    for a in it:
        if a == '--template':
            template = next(it)
        elif a == '--image':
            k, _, v = next(it).partition('=')
            images[k.strip()] = v.strip()
        else:
            args.append(a)
    if len(args) != 2:
        sys.exit(__doc__)
    print('OK', render(args[0], args[1], template, images))


if __name__ == '__main__':
    main(sys.argv[1:])
