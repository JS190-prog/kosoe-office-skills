# koscom-xlsx-pb-quote

코스콤 금융영업의 **「PowerBase(PB) 전산서비스 추가업무 이용 견적서」**를 원본 서식 그대로 엑셀(.xlsx)로 만드는 스킬입니다. 고객사명 · 추가 업무명 · 이용료 같은 값만 주면 見積書 제목, 수신처, 견적명 · 일자 · 유효기간, 이용료 표와 합계, 담당자 안내가 갖춰진 한 쪽짜리 견적서가 나옵니다.

> 서식 파일에는 고객사명 · 금액 · 담당자 이름 · 직인이 없습니다(칸으로 비워 두었습니다). 예시의 회사 · 사람 · 금액 · 전화번호는 모두 가상입니다. 실제 견적 내용을 이 폴더에 커밋하지 마세요.

## 계약서 스킬과 짝

같은 업무의 계약서 스킬 [`koscom-hwp-pb-contract`](../koscom-hwp-pb-contract)와 칸 이름을 맞췄습니다. 견적서에 쓴 `고객사명` · `추가업무명` · 이용료 표(`rows.이용료`)를 계약서에 그대로 넘길 수 있습니다.

| 스킬 | 문서 | 형식 | 방식 |
|---|---|---|---|
| **`koscom-xlsx-pb-quote`** (이 폴더) | PB 추가업무 이용 견적서 | 엑셀 .xlsx | 서식의 칸에 값을 채움 |
| [`koscom-hwp-pb-contract`](../koscom-hwp-pb-contract) | PB 추가업무 이용 계약서 | 한글 .hwp | 서식의 칸에 값을 채움 |

## 빠른 시작

Python 3과 `openpyxl` · `pillow`가 필요합니다(`pip install openpyxl pillow`). pillow가 없으면 서식의 회사 로고가 빠집니다.

```
git clone https://github.com/humanist96/kosoe-office-skills.git
cd kosoe-office-skills/corp/koscom-xlsx-pb-quote
python scripts/render.py examples/values.example.json out/견적서.xlsx
python scripts/show.py out/견적서.xlsx
```

`OK …/out/견적서.xlsx`가 나오면 엑셀로 엽니다. Windows에 엑셀이 있으면 `scripts\preview.ps1 -File out\견적서.xlsx -OutDir out\shots`로 화면을 캡처해 볼 수 있습니다.

## 채우는 값

정본은 [`form.yaml`](form.yaml)입니다.

| 칸 | 필수 | 예 | 들어가는 곳 |
|---|:---:|---|---|
| `고객사명` | ✓ | E증권 | 수신처(뒤에 "귀중") |
| `추가업무명` | ✓ | 고객확인 모니터링 고도화 | 견적명, 표 제목 |
| `견적일자` | ✓ | 2026년 01월 15일 | 견적 일자 |
| `유효기간` | | 견적 후 1개월 | 유효 기간 |
| `대표이사` | | 김 철 수 | 공급자 이름 |
| `RM담당` · `계약담당` | | 금융영업부 홍길동 차장 (02-000-0000) | 「2. 기타」 — 비우면 그 줄이 빠집니다 |
| `rows.이용료[]` | ✓ | 대분류 · 중분류 · 소분류 · 회사기본 · 영업점당 · 이용량 · 비고 | 이용료 표(7행까지 한 쪽) |

합계는 `회사기본`을 더해 자동으로 들어갑니다. 금액은 `"18,000"`처럼 글로 적어도 엑셀에는 숫자로 들어가고, `-`는 0으로 들어가 서식대로 `-`로 보입니다. 제목 · 인사말 · 표 머리 · 단위 · 회사 로고와 주소는 서식에 들어 있어 바뀌지 않습니다.

## 직인은 들어 있지 않습니다

원본 견적서에는 직인 그림이 붙어 있었지만 **서식에는 넣지 않았습니다.** 직인 그림이 저장소에 올라가거나, 날인 절차 없이 자동으로 찍히면 안 되기 때문입니다. 견적서는 직인 자리를 비운 채 만들어지고, 날인 권한이 있는 사람이 자기 PC의 그림 파일을 줄 때만 그 자리에 넣습니다.

```
python scripts/render.py values.json out/견적서.xlsx --image 직인=C:/내폴더/직인.png
```

## 쓰는 곳

- **Claude 스킬로**: 이 폴더를 스킬 폴더(예: `~/.claude/skills/`)에 두면 "PB 추가업무 견적서 만들어줘" 같은 요청에 [`SKILL.md`](SKILL.md)의 순서대로 동작합니다.
- **코쇠오피스에서**: 이 저장소의 [`registry/corp.lock.yaml`](../../registry/corp.lock.yaml)에 이 폴더를 커밋으로 고정하면(`kind: xlsx-fill`) 앱의 「새 문서」에 **엑셀** 양식 카드로 보입니다. 앱이 요청 · 첨부에서 칸 값을 뽑아 채우고(말하지 않은 견적 일자는 오늘), 빈 필수 칸을 검수에서 잡고, 결과를 미리보기와 「Excel로 열기」로 보여 줍니다. 앱에서는 직인 자리를 채우지 않습니다. `kind: xlsx-fill`을 아는 앱 버전(엑셀 서식 채우기 지원 이후)이 필요하고, 서식이나 칸을 고치면 잠금 파일의 `sha`를 새 커밋으로 올려야 반영됩니다.

  ```yaml
  # registry/corp.lock.yaml
  koscom-xlsx-pb-quote:
    repo: humanist96/kosoe-office-skills
    path: corp/koscom-xlsx-pb-quote
    sha: <이 폴더가 들어 있는 커밋>
    kind: xlsx-fill
  ```

## 폴더

```
koscom-xlsx-pb-quote/
├─ SKILL.md                 Claude가 읽는 사용 순서
├─ form.yaml                칸 정의(이름 · 필수 · 기본값 · 표 · 그림 자리)
├─ templates/               칸 토큰이 든 서식 (.xlsx)
├─ scripts/
│  ├─ render.py             values.json → 견적서.xlsx
│  ├─ show.py               만든 파일을 글로 펼쳐 확인
│  ├─ preview.ps1           엑셀 창 캡처(Windows)
│  └─ make_template.py      원본(.xls · .xlsx) + 바꿈표 → 서식
├─ examples/                가상 값 예시
└─ references/              서식 만들기 안내(토큰 · 바꿈표)
```

## 서식 고치기 · 새 스킬 만들기

표 구성이 바뀌었거나 다른 견적서 스킬이 필요하면 [`references/template_guide.md`](references/template_guide.md)를 따릅니다. 실제 견적서에서 바뀌는 글을 칸으로 바꾸는 `make_template.py`가 들어 있습니다(.xls를 읽으려면 `pip install xlrd`). 원본 문서와 바꿈표는 커밋하지 않습니다. 새 목적의 스킬은 `corp/<스킬 id>/` 폴더로 추가합니다.

## 확인한 것과 한계

- 실제 견적서(.xls) 한 건으로 서식을 만들고, 서식의 모든 칸(10열 × 42행)이 원본과 같은 글꼴 · 맞춤 · 테두리 · 채우기 · 표시 형식인지, 열 너비 · 행 높이 · 병합 · 인쇄 설정(A4 세로, 한 쪽 너비 맞춤, 여백, 인쇄 영역)이 같은지 값으로 대조했습니다.
- 가상 값으로 이용료 1행 · 3행 · 7행 · 8행 · 9행 견적서를 만들었고, 1행 · 3행 · 9행은 엑셀 2016(Windows 10)에서 열어 제목, 로고, 표 테두리와 머리 색, 합계, 담당자 줄을 화면으로 확인했습니다. 7행까지는 전체 높이가 서식과 같고, 8행부터 `WARN`이 나옵니다.
- **원본과 나란히 놓고 화면으로 비교하지는 못했습니다.** 확인한 PC의 엑셀이 원본 .xls를 자동으로 열지 못했습니다. 실제로 쓰기 전에 원본과 한 번 겹쳐 보세요.
- 인쇄(또는 PDF 저장) 결과는 확인하지 않았습니다. 한 쪽에 들어가는지는 행 높이의 합으로만 맞췄습니다.
- 서식의 글꼴은 원본과 같은 「Rix고딕 M」입니다. 이 글꼴이 없는 PC에서는 엑셀이 다른 글꼴로 보여 줍니다(원본 파일도 똑같습니다).
- 결과는 .xlsx입니다(원본은 .xls). 금액 칸은 정수로 표시되므로 소수는 반올림되어 보입니다.
- 담당자 두 줄을 모두 비우면 「2. 기타」 제목만 남습니다.
- macOS · Linux에서는 실행해 보지 않았습니다. `preview.ps1`은 Windows 전용입니다.

## 쓰는 라이브러리

- [openpyxl](https://openpyxl.readthedocs.io/) (MIT) — 서식 읽기 · 쓰기
- [Pillow](https://python-pillow.org/) (MIT-CMU) — 서식의 로고를 읽고 그림을 넣을 때
- [xlrd](https://github.com/python-excel/xlrd) (BSD) — `make_template.py`가 .xls를 읽을 때만
