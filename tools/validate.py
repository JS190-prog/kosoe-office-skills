"""스킬 저장소 검사 — PR마다 GitHub Actions에서, 그리고 코쇠오피스 앱에서 같은 규칙으로 돈다.

python tools/validate.py            # 저장소 전체
python tools/validate.py <폴더>     # 스킬 하나
검사: 필수 항목·버전 형식, 상속(extends) 대상 존재, 전사 잠금 항목 변경 금지, 양식 형식·구성, 개인정보로 보이는 값.
"""
import json
import os
import re
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCKED_TOP = {'brand', 'fonts', 'logo', 'grade_label', 'hwp_base'}
FMT = {'hwp', 'ppt', 'web'}
SEMVER = re.compile(r'^\d+\.\d+\.\d+$')
PII = [(re.compile(r'01[016-9]-?\d{3,4}-?\d{4}'), '휴대전화번호'), (re.compile(r'\d{6}-[1-4]\d{6}'), '주민등록번호'),
       (re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+'), '이메일'), (re.compile(r'(?<!\d)\d{3,6}-\d{2,6}-\d{2,8}(?!\d)'), '계좌번호')]


def load_all():
    out = {}
    for dp, _, fns in os.walk(os.path.join(ROOT, 'skills')):
        if 'kosoe-skill.yaml' in fns:
            p = os.path.join(dp, 'kosoe-skill.yaml')
            out[p] = yaml.safe_load(open(p, encoding='utf-8')) or {}
    return out


ENDINGS = ('noun', 'plain', 'polite', 'any')
DATE_FORMATS = ('Y. M. D', 'Y.MM.DD', 'Y-MM-DD', 'Y년 M월 D일', 'any')


def check_style(style):
    """문체(style): 대표 문서에서 잰 종결 형태 · 날짜 형식 · 항목 길이. 없으면 전사 보고 문법을 따른다."""
    if style is None:
        return []
    if not isinstance(style, dict):
        return ['style은 ending · date · max_len 을 가진 묶음이어야 함']
    errs = []
    if style.get('ending') is not None and style['ending'] not in ENDINGS:
        errs.append('style.ending은 ' + ' | '.join(ENDINGS))
    if style.get('date') is not None and style['date'] not in DATE_FORMATS:
        errs.append('style.date는 ' + ' | '.join(DATE_FORMATS))
    if style.get('max_len') is not None and not (isinstance(style['max_len'], int) and style['max_len'] >= 0):
        errs.append('style.max_len은 0(제한 없음) 이상의 정수')
    return errs


def check(s, ids, lock, path):
    errs = []
    for k in ('id', 'name', 'scope', 'version'):
        if not s.get(k):
            errs.append(f'필수 항목 없음: {k}')
    if s.get('version') and not SEMVER.match(str(s['version'])):
        errs.append('version은 1.2.3 형식')
    if s.get('scope') not in ('org', 'user'):
        errs.append('scope는 org 또는 user')
    rel = os.path.relpath(os.path.dirname(path), ROOT).replace('\\', '/')
    want = f"skills/user/{s.get('owner')}/{s.get('id')}" if s.get('scope') == 'user' else f"skills/org/{s.get('org')}/{s.get('id')}"
    if rel != want:
        errs.append(f'폴더 위치가 범위와 다름: {rel} (기대: {want})')
    bad = LOCKED_TOP & set(s)
    if bad:
        errs.append(f"전사 잠금 항목 변경 금지: {', '.join(sorted(bad))}")
    ext = [str(e) for e in s.get('extends') or []]
    if not ext:
        errs.append('extends 없음 — 전사 스킬(corp:) 또는 상위 스킬(skill:)을 상속해야 함')
    for e in ext:
        if e.startswith('corp:') and e.split(':', 1)[1].split('#')[0] not in lock['corp_skills']:
            errs.append(f'잠금 파일에 없는 전사 스킬: {e}')
        if e.startswith('skill:') and e.split(':', 1)[1].split('@')[0] not in ids:
            errs.append(f'없는 상위 스킬: {e}')
    for f in s.get('forms') or []:
        if f.get('fmt') not in FMT:
            errs.append(f"양식 {f.get('id')}: fmt는 hwp|ppt|web")
        if not f.get('outline'):
            errs.append(f"양식 {f.get('id')}: outline 없음")
        errs += [f"양식 {f.get('id')}: {e}" for e in check_style(f.get('style'))]
    errs += check_style(s.get('style'))
    v = s.get('verification')
    if v is not None and not (isinstance(v, dict) and v.get('status') in ('passed', 'forced')):
        errs.append('verification.status는 passed | forced')
    text = json.dumps(s, ensure_ascii=False)
    for rx, name in PII:
        if rx.search(text):
            errs.append(f'보안: {name}로 보이는 값')
    return errs


def main():
    lock = yaml.safe_load(open(os.path.join(ROOT, 'registry', 'corp.lock.yaml'), encoding='utf-8'))
    allsk = load_all()
    ids = {s.get('id') for s in allsk.values()}
    only = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else None
    n_err = 0
    seen = {}
    for p, s in allsk.items():
        if s.get('id') in seen:
            print(f'❌ {p}: id 중복 ({seen[s["id"]]})')
            n_err += 1
        seen[s.get('id')] = p
        if only and not p.startswith(only):
            continue
        errs = check(s, ids, lock, p)
        rel = os.path.relpath(p, ROOT)
        if errs:
            n_err += len(errs)
            for e in errs:
                print(f'❌ {rel}: {e}')
        else:
            print(f"✅ {rel} — {s['id']} v{s['version']}")
    print(f'\n{"통과" if not n_err else f"오류 {n_err}건"}')
    sys.exit(1 if n_err else 0)


if __name__ == '__main__':
    for st in (sys.stdout, sys.stderr):
        st.reconfigure(encoding='utf-8', errors='replace')
    main()
