# koscom-gian-from-attachments

첨부 파일 폴더(근거 공문·보고서·투자계획서·견적서 등)를 읽어 코스콤 기안문 한글 파일(.hwpx, 필요하면 .hwp)을 만드는 에이전트 스킬입니다. 사용법은 [SKILL.md](SKILL.md)에 있습니다.

## 설치

```powershell
# 스킬 폴더(예: ~/.agents/skills/koscom-gian-from-attachments)에 이 폴더를 복사한 뒤
npm ci
node scripts/selftest.js   # SELFTEST PASS 14/14
```

화면 확인과 .hwp 저장(선택)에는 Windows, 한컴오피스 한글, Python 패키지 pywin32·PyMuPDF·Pillow가 필요합니다.

## 구성

| 경로 | 역할 |
| --- | --- |
| `scripts/scan.js` | 첨부 → 본문(text/*.md)과 종류·핵심 값(scan.json) |
| `scripts/check.js` | source.json ↔ 첨부 대조(합계 산수, 예산 = 견적·투자규모, 관련근거 번호, 첨부 목록, 근거 없는 숫자, 옮겨 온 마크다운·HTML 표기) |
| `scripts/build.js` | source.json → 기안문 HWPX + kordoc 구조 검증. 한글에서 고친 결과 파일은 덮어쓰지 않음(.gian_build.json 해시) |
| `scripts/hangul_preview.py` | 한글로 PDF·PNG 미리보기, .hwp 저장(고친 .hwp는 덮어쓰지 않음) |
| `scripts/selftest.js` | 예시(examples/edr)로 전 과정 검사 |
| `assets/기안문_양식_틀.hwpx` | 코스콤 기안문 양식 틀(본문은 중립 견본 문구) |
| `references/` | source.json 작성 지침과 스키마 |

예시 `examples/edr`는 나라장터 공고(R26BK01777212 EDR 솔루션 도입)를 바탕으로 시연용으로 만든 첨부입니다. 공고명·추정가격만 공고 값이고, 인명·업체·세부 내용은 실제와 관계없습니다.
