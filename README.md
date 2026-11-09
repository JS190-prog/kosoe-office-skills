# kosoe-office-skills

코쇠오피스의 **스킬 정본 저장소**(비공개). 앱(`kosoe-office`)은 이 저장소를 당겨 와서 문서를 만든다.

| 경로 | 내용 | 등록 |
|---|---|---|
| `registry/corp.lock.yaml` | 전사 공용 스킬 4종의 고정 버전(SHA)과 잠금 키 | 전사 관리자 승인 |
| `registry/corp.forms.yaml` | 전사 공통 양식 목록(전사 스킬이 만드는 문서 종류) | 전사 관리자 승인 |
| `skills/org/<본부>/<부서>/<skill>/` | 부서 스킬(전사 스킬 상속) | 부서 관리자 승인 |
| `skills/user/<GitHub 로그인>/<skill>/` | 개인 스킬(전사 스킬 상속) | 검사 통과 시 자동 병합 |

- 스킬 1개 = 폴더 1개 = `kosoe-skill.yaml` 1개. 등록 요청 = PR, 승인 = 병합 + 태그 `<id>@v<버전>`.
- 원문은 올리지 않는다. 구조·고정 문구·규칙·가명 예시만.
- 조직·사람은 모두 가상이다.

## 검사

`python tools/validate.py` — PR마다 GitHub Actions에서도 같은 검사가 돈다(필수 항목·버전, 상속 대상, 전사 잠금 항목, 양식, 개인정보).

## 가상 부서 스킬

| 스킬 | 위치 | 상속 |
|---|---|---|
| `sales-common` 금융영업본부 공통 팩 | `skills/org/금융영업본부/` | 전사 4종 |
| `sales-pack` 영업 팩 | `skills/org/금융영업본부/금융영업1팀/` | sales-common → 전사 |
| `planning-pack` 기획 팩 | `skills/org/경영기획본부/경영기획팀/` | 전사(한글·PPT·삽화) |
