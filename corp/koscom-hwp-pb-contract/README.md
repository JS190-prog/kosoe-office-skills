# koscom-hwp-pb-contract

코스콤 금융영업의 **「PowerBase(PB) 전산서비스 추가 업무 이용 계약서」**를 원본 서식 그대로 한글(.hwp)로 만드는 스킬입니다. 고객사명 · 추가 업무명 · 이용료 같은 값만 주면 표지, 제1~5조, 이용료 표, 서명란이 갖춰진 계약서가 나옵니다.

> 서식 파일에는 고객사명 · 금액 · 사람 이름이 없습니다(칸으로 비워 두었습니다). 예시의 회사 · 사람 · 금액은 모두 가상입니다. 실제 계약 내용을 이 폴더에 커밋하지 마세요.

## 왜 따로 만든 스킬인가

한글 문서는 목적마다 모양이 전혀 다릅니다. 보고서는 `□ ㅇ -` 개조식이고, 계약서는 조항과 서명란이 있는 서술형입니다. 보고서 스킬 하나로 계약서를 만들면 계약서가 보고서 모양으로 나옵니다. 그래서 **한글 스킬은 목적마다 따로** 둡니다.

| 스킬 | 목적 | 방식 |
|---|---|---|
| [`koscom-hwp-report`](https://github.com/humanist96/koscom_hangul_skill) | 요약보고 · 상세보고 | 문단 블록을 조립 |
| **`koscom-hwp-pb-contract`** (이 폴더) | PB 추가업무 이용 계약서 | 서식의 칸에 값을 채움 |

## 빠른 시작

Java 8 이상이 필요합니다.

```powershell
git clone https://github.com/humanist96/kosoe-office-skills.git
cd kosoe-office-skills\corp\koscom-hwp-pb-contract
.\scripts\render.ps1 -Values examples\values.example.json -Out out\계약서.hwp
```

macOS · Linux:

```bash
./scripts/render.sh examples/values.example.json out/계약서.hwp
```

`OK out\계약서.hwp`가 나오면 한컴오피스나 한컴 뷰어로 엽니다.

## 채우는 값

정본은 [`form.yaml`](form.yaml)입니다.

| 칸 | 필수 | 예 | 들어가는 곳 |
|---|:---:|---|---|
| `고객사명` | ✓ | E증권 주식회사 | 표지, 제1조, 서명란("갑") |
| `추가업무명` | ✓ | 고객확인 모니터링 고도화 | 표지 부제, 제2조 |
| `기본계약체결일` | ✓ | 2019.03.15 | 제1조 |
| `계약기간` | | 추가업무 가동 이후 1년간 | 제4조 ① |
| `계약일` | | 2026.    .    . | 표지, 서명란 |
| `갑주소` · `갑대표이사` · `을대표이사` | | | 서명란 |
| `합계` | ✓ | 18,000 | 이용료 표의 합계 |
| `rows.이용료[]` | ✓ | 대분류 · 중분류 · 소분류 · 회사기본 · 영업점당 · 이용량 · 비고 | 이용료 표(행 수 자유) |

조항 문장과 을(주식회사 코스콤)의 상호 · 주소는 서식에 들어 있어 바뀌지 않습니다.

## 쓰는 곳

- **Claude 스킬로**: 이 폴더를 스킬 폴더에 두면 "PB 추가업무 계약서 만들어줘" 같은 요청에 [`SKILL.md`](SKILL.md)의 순서대로 동작합니다.
- **코쇠오피스에서**: 이 저장소의 [`registry/corp.lock.yaml`](../../registry/corp.lock.yaml)에 이 폴더가 커밋으로 고정돼 있어(`kind: hwp-fill`) 앱의 「새 문서」에 전사 양식 카드로 보입니다. 앱이 요청 · 첨부에서 칸 값을 뽑아 채우고, 빈 필수 칸을 검수에서 잡습니다. 서식이나 칸을 고치면 잠금 파일의 `sha`를 새 커밋으로 올려야 앱에 반영됩니다.

  ```yaml
  # registry/corp.lock.yaml
  koscom-hwp-pb-contract:
    repo: humanist96/kosoe-office-skills
    path: corp/koscom-hwp-pb-contract
    sha: <이 폴더가 들어 있는 커밋>
    kind: hwp-fill
  ```

## 폴더

```
koscom-hwp-pb-contract/
├─ SKILL.md                 Claude가 읽는 사용 순서
├─ form.yaml                칸 정의(이름 · 필수 · 기본값 · 표)
├─ templates/               칸 토큰이 든 서식 (.hwp)
├─ scripts/                 koscom-hwp-fill.jar · render · preview · build
├─ src/                     FillRenderer(채우기) · TemplateMaker(원본 → 서식) · HwpOps · Json · Inspect
├─ lib/                     hwplib 1.1.9 (Apache-2.0)
├─ examples/                가상 값 예시
└─ references/              서식 만들기 안내
```

## 서식 고치기 · 새 스킬 만들기

조항이 바뀌었거나 다른 계약서 · 공문 스킬이 필요하면 [`references/template_guide.md`](references/template_guide.md)를 따릅니다. 실제 문서에서 바뀌는 글을 칸으로 바꾸는 `TemplateMaker`가 들어 있습니다. 원본 문서와 바꿈표는 커밋하지 않습니다. 새 목적의 스킬은 `corp/<스킬 id>/` 폴더로 추가하고 잠금 파일에 올립니다.

소스를 고친 뒤에는 `scripts\build.ps1`로 jar를 다시 만듭니다(JDK 필요).

## 확인한 것과 한계

- 가상 값으로 이용료 1행 · 2행 · 3행 계약서를 만들어 한컴 뷰어에서 열고 원본 서식과 같은 모양(표지 제목 상자, 조항 글꼴, 표 테두리, 서명란)인지 화면으로 확인했습니다(Windows 10, Java 14). 코쇠오피스 앱에서도 요청 → 칸 초안 → 채팅 수정 → 생성 → 검수까지 확인했습니다.
- 이용료 행이 늘면 뒤 조항이 다음 쪽으로 넘어갑니다(2행일 때 제5조 ①이 쪽 경계에 걸림). 필요하면 한글에서 쪽 나눔을 손봅니다.
- macOS · Linux에서는 실행해 보지 않았습니다.
- 값이 길면 줄이 늘어 쪽이 밀릴 수 있습니다. 쪽 넘김은 한글이 다시 계산합니다.
- 머리말 · 꼬리말 · 글상자 안의 칸은 다루지 않습니다.

## 포함된 라이브러리

- [hwplib](https://github.com/neolord0/hwplib) 1.1.9 — Apache License 2.0 ([`lib/NOTICE.md`](lib/NOTICE.md))
- `HwpOps` · `Json` · `Inspect`는 `koscom-hwp-report`에서 가져왔습니다.
