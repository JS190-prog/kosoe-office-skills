"""만든 견적서(.xlsx)를 글로 펼쳐 본다 — 엑셀 없이 칸 값 · 행 수 · 합계 · 남은 토큰을 확인할 때.

    python scripts/show.py 견적서.xlsx

남은 토큰({{…}})이 있으면 마지막에 `LEFT …`로 알리고 종료 코드 1로 끝난다.
"""
import re
import sys

from openpyxl import load_workbook

for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding='utf-8', errors='replace')


def text(c):
    v = c.value
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return '-' if v == 0 and '"-"' in c.number_format else (f'{v:,}' if '#,##0' in c.number_format else str(v))
    return str(v)


def main(path):
    wb = load_workbook(path)
    left = []
    for ws in wb.worksheets:
        total = sum((ws.row_dimensions[r].height or ws.sheet_format.defaultRowHeight or 15) for r in range(1, ws.max_row + 1))
        print(f'[{ws.title}] {ws.dimensions} · 인쇄 영역 {ws.print_area or "-"} · 그림 {len(ws._images)}개 · 전체 높이 {total:.0f}pt')
        for row in ws.iter_rows():
            cells = [c for c in row if c.value is not None and type(c).__name__ != 'MergedCell']
            if cells:
                print(f'{cells[0].row:>3}  ' + '  |  '.join(f'{c.column_letter}: {text(c)}' for c in cells))
            left += [f'{c.coordinate} {c.value}' for c in cells if isinstance(c.value, str) and re.search(r'\{\{[^{}]+\}\}', c.value)]
    if left:
        print('LEFT 채워지지 않은 토큰:', '; '.join(left))
        sys.exit(1)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
