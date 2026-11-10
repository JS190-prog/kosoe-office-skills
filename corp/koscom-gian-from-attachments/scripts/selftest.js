// 자체 검사: examples/edr(첨부 4건 + source.json)로 scan -> check(정상·오류 4종) -> build(덮어쓰기 보호 포함) -> 결과 대조
// 사용: node selftest.js
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const JSZip = require('jszip');
const ROOT = path.resolve(__dirname, '..');
const EX = path.join(ROOT, 'examples', 'edr');
const KORDOC = path.join(ROOT, 'node_modules', 'kordoc', 'dist', 'cli.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'koscom-gian-selftest-'));
const run = (script, ...args) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8', env: { ...process.env, KORDOC_OFFLINE: '1' } });
const parse = f => spawnSync(process.execPath, [KORDOC, f], { encoding: 'utf8', env: { ...process.env, KORDOC_OFFLINE: '1' } }).stdout;
let pass = 0, total = 0;
const ok = (name, cond, detail = '') => { total++; if (cond) pass++; console.log(`${cond ? 'PASS' : 'FAIL'} ${total}. ${name}${cond ? '' : ' — ' + detail}`); };

(async () => {
  // 1) 스캔: 종류와 핵심 값
  const r1 = run('scan.js', path.join(EX, '첨부'), '-o', work);
  const scan = JSON.parse(fs.readFileSync(path.join(work, 'scan.json'), 'utf8'));
  const F = scan.files;
  ok('scan 종류 판별(공문·보고서·투자계획서·견적서)', r1.status === 0 && F.map(f => f.kind).join() === 'gian,report,investment,quote', F.map(f => f.kind).join() + r1.stderr);
  ok('scan 공문 시행번호·날짜', F[0].docNo === '보안2026-0042' && F[0].date === '2026-01-22', JSON.stringify([F[0].docNo, F[0].date]));
  ok('scan 견적서 공급가액·업체', F[3].supplyWon === 140000000 && /가나정보통신/.test(F[3].vendor || ''), JSON.stringify([F[3].supplyWon, F[3].vendor]));
  ok('scan 투자계획서 투자규모·보고서 제목', F[2].totalWon === 140000000 && F[1].title === 'EDR 솔루션 도입 추진(안)', JSON.stringify([F[2].totalWon, F[1].title]));

  // 2) 검사: 정상 원천은 통과, 틀린 원천은 잡아낸다
  const S = JSON.parse(fs.readFileSync(path.join(EX, 'source.json'), 'utf8'));
  const checkWith = (mut) => { const s = JSON.parse(JSON.stringify(S)); if (mut) mut(s); const p = path.join(work, 'source.json'); fs.writeFileSync(p, JSON.stringify(s), 'utf8'); return run('check.js', p); };
  const good = checkWith();
  ok('check 정상 원천 통과', good.status === 0, good.stdout);
  const budgetTbl = s => s.sections.find(x => x.table && /천원/.test(x.table.unit || '')).table;
  const bad1 = checkWith(s => { const t = budgetTbl(s); t.rows[0][4] = '88,000'; t.rows[t.rows.length - 1][4] = '150,000'; });
  ok('check 예산 합계 ≠ 견적서 공급가액 오류', bad1.status === 1 && /예산 합계 150,000,000원/.test(bad1.stdout), bad1.stdout);
  const bad2 = checkWith(s => { const t = budgetTbl(s); t.rows[t.rows.length - 1][4] = '140,001'; });
  ok('check 표 합계 산수 오류', bad2.status === 1 && /합계 140,001 ≠ 항목 합 140,000/.test(bad2.stdout), bad2.stdout);
  const bad3 = checkWith(s => { s.basis[0].docNo = '보안2026-0043'; });
  ok('check 관련근거 문서번호 ≠ 첨부 공문 오류', bad3.status === 1 && /보안2026-0043 ≠ 첨부 1의 보안2026-0042/.test(bad3.stdout), bad3.stdout);
  const bad4 = checkWith(s => { s.sections[0].bullets[0].text += '<br>**강조**'; });
  ok('check 첨부 텍스트의 **·HTML 태그 옮김 오류', bad4.status === 1 && /마크다운 \*\*/.test(bad4.stdout) && /HTML 태그/.test(bad4.stdout), bad4.stdout);

  // 3) 생성: HWPX 구조 검증(build 안의 kordoc validate)과 본문
  checkWith();
  const out = path.join(work, '기안문.hwpx');
  const b = run('build.js', path.join(work, 'source.json'), out);
  ok('build 성공 + 구조 검증', b.status === 0 && /구조 검증 통과/.test(b.stdout), b.stdout + b.stderr);
  const md = b.status === 0 ? parse(out) : '';
  const need = ['수신자 : 경영지원부장', S.header.title, '1. 관련근거', '가. 보안2026-0042', '첨부 1. [보안2026-0042]', '견적서(가나정보통신) 1부. 끝.', '140,000'];
  const miss = need.filter(x => !md.includes(x));
  ok('build 본문(수신·제목·관련근거·표·첨부 끝 표시)', !miss.length, '없음: ' + miss.join(' | '));

  // 4) 번호 항목 제목은 "다음 문단과 함께"(문단 모양 keepWithNext=1)로 쪽 끝에 홀로 남지 않는다
  if (b.status === 0) {
    const z = await JSZip.loadAsync(fs.readFileSync(out));
    const sec = await z.file('Contents/section0.xml').async('string'), head = await z.file('Contents/header.xml').async('string');
    const m = /<hp:p [^>]*paraPrIDRef="(\d+)"[^>]*>(?:(?!<\/hp:p>)[\s\S])*?1\. 추진 개요/.exec(sec);
    const pp = m && new RegExp('<hh:paraPr id="' + m[1] + '"[\\s\\S]*?</hh:paraPr>').exec(head);
    ok('번호 항목 제목 문단 모양 keepWithNext=1', !!pp && /keepWithNext="1"/.test(pp[0]), m ? 'paraPr ' + m[1] : '제목 문단 못 찾음');
  } else ok('번호 항목 제목 문단 모양 keepWithNext=1', false, 'build 실패');

  // 5) 스스로 만든 파일은 다시 만들고, 그 뒤 바뀐 파일(한글에서 고쳐 저장)은 --force 없이 덮어쓰지 않는다
  const src = path.join(work, 'source.json');
  const again = run('build.js', src, out);
  fs.appendFileSync(out, 'x');
  const edited = fs.readFileSync(out);
  const kept = run('build.js', src, out), untouched = fs.readFileSync(out).equals(edited);
  const forced = run('build.js', src, out, '--force');
  ok('build 고친 결과 파일 덮어쓰기 막음(--force만 덮어씀)', again.status === 0 && kept.status === 1 && /덮어쓰지 않음/.test(kept.stderr) && untouched && forced.status === 0 && !fs.readFileSync(out).equals(edited),
    [again.status, kept.status, kept.stderr, untouched, forced.status].join(' | '));

  // 6) 양식 틀에 이전 문서 내용이 없다
  const tplText = parse(path.join(ROOT, 'assets', '기안문_양식_틀.hwpx'));
  ok('양식 틀은 중립 문구만', /기안문 제목/.test(tplText) && !/누리플|가상빌딩|임대/.test(tplText), tplText.slice(0, 200));

  console.log(`SELFTEST ${pass === total ? 'PASS' : 'FAIL'} ${pass}/${total}  (작업 폴더 ${work})`);
  if (pass === total) fs.rmSync(work, { recursive: true, force: true });
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
