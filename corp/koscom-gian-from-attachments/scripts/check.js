// 기안문 원천(source.json)을 첨부 스캔 결과(scan.json)와 대조한다. 오류가 있으면 종료 코드 1.
// 사용: node check.js <source.json> [--scan <scan.json>]   (기본: source.json 옆의 scan.json)
// ERROR: 구조 오류, 표 합계 산수, 예산 합계 ≠ 견적서 공급가액·투자규모, 관련근거 문서번호·날짜 ≠ 첨부 공문, 첨부 파일 없음,
//        첨부 텍스트(마크다운)에서 옮겨 온 **·HTML 태그·깨진 글자

// WARN : 목록에 없는 첨부, 첨부 원문에 없는 숫자, 비어 있는 결재선·○○○ 자리
const fs = require('fs'), path = require('path');

function check(S, scan, texts) {
  const E = [], W = [];
  const err = m => E.push(m), warn = m => W.push(m);
  const files = scan ? scan.files : [];
  const byFile = Object.fromEntries(files.map(f => [f.file, f]));
  // ---- 구조 ----
  if (S.schema !== 'gian/1.0') err('schema는 "gian/1.0"이어야 함');
  if (!S.header || !S.header.recipient || !S.header.title) err('header.recipient·header.title 필요');
  if (!S.purpose && !S.request) err('purpose 또는 request 필요');
  if (!Array.isArray(S.basis)) err('basis 배열 필요(관련근거가 없으면 [])');
  if (!Array.isArray(S.sections) || !S.sections.length) err('sections 1개 이상 필요');
  (S.sections || []).forEach((s, i) => {
    const at = `sections[${i}] "${s.title || ''}"`;
    if (s.no !== i + 1) err(`${at}: no는 ${i + 1}이어야 함`);
    if (!s.title) err(`${at}: title 필요`);
    if (!s.bullets && !s.table && !s.schedule) err(`${at}: bullets·table·schedule 중 하나 필요`);
    if (s.table) {
      const t = s.table;
      if (!Array.isArray(t.head) || !Array.isArray(t.rows) || !t.rows.length) err(`${at}: table.head·rows 필요`);
      else t.rows.forEach((r, k) => { if (r.length !== t.head.length) err(`${at}: 표 ${k + 1}행 칸 수 ${r.length} ≠ 머리행 ${t.head.length}`); });
    }
    if (s.schedule) {
      const sc = s.schedule;
      if (!Array.isArray(sc.months) || !Array.isArray(sc.rows)) err(`${at}: schedule.months·rows 필요`);
      else sc.rows.forEach((r, k) => { if (!Array.isArray(r[1]) || r[1].length !== sc.months.length) err(`${at}: 일정 ${k + 1}행 표시 칸 수 ≠ 월 ${sc.months.length}개`); });
    }
  });
  // ---- 첨부 텍스트(text/*.md)에서 옮겨 온 표기: build는 글자 그대로 찍는다 ----
  const RESIDUE = [[/\*\*/, '마크다운 **'], [/<\/?(br|t[dhr]|table|p|span|div)\b[^>]*>/i, 'HTML 태그'], [/\uFFFD|\?{3,}/, '깨진 글자'], [/[\uE000-\uF8FF]/, '기호 글꼴 문자'], [/\{\{|\}\}/, '자리표시자 {{ }}']];
  (function walk(v) {
    if (typeof v === 'string') RESIDUE.forEach(([re, what]) => { if (re.test(v)) err(`${what} 표기가 남아 있음(한글에 글자 그대로 찍힘): "${v.slice(0, 40)}"`); });
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  })(S);
  // ---- 첨부 목록 ----
  const listed = new Set();
  (S.attachments || []).forEach((a, i) => {
    if (a.no !== i + 1) err(`attachments[${i}]: no는 ${i + 1}이어야 함`);
    if (!a.title || !a.copies) err(`attachments[${i}]: title·copies 필요`);
    const fl = a.files || (a.file ? [a.file] : []);
    if (!fl.length) err(`첨부 ${a.no}: file 또는 files 필요`);
    fl.forEach(f => { listed.add(f); if (scan && !byFile[f]) err(`첨부 ${a.no}: 첨부 폴더에 "${f}" 없음`); });
  });
  files.forEach(f => { if (!listed.has(f.file)) warn(`첨부 목록에 없는 파일: ${f.file}`); });
  // ---- 관련근거 ↔ 첨부 공문 ----
  (S.basis || []).forEach((b, i) => {
    if (b.date && !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) err(`basis[${i}]: date는 YYYY-MM-DD`);
    if (b.attachRef != null) {
      const a = (S.attachments || []).find(x => x.no === b.attachRef);
      if (!a) { err(`basis[${i}] ${b.docNo}: attachRef ${b.attachRef}번 첨부 없음`); return; }
      const docs = (a.files || [a.file]).map(f => byFile[f]).filter(f => f && f.docNo);
      if (docs.length && !docs.some(d => d.docNo === b.docNo)) err(`basis[${i}]: 문서번호 ${b.docNo} ≠ 첨부 ${b.attachRef}의 ${docs.map(d => d.docNo).join(', ')}`);
      const same = docs.find(d => d.docNo === b.docNo);
      if (same && same.date && b.date && same.date !== b.date) err(`basis[${i}] ${b.docNo}: 날짜 ${b.date} ≠ 첨부 공문 ${same.date}`);
    } else if (b.docNo && scan && !files.some(f => (f.docRefs || []).includes(b.docNo) || f.docNo === b.docNo)) {
      warn(`basis[${i}]: 문서번호 ${b.docNo}가 어느 첨부에도 없음(사용자에게 확인)`);
    }
  });
  // ---- 표 합계 산수 + 예산 합계 대조 ----
  const isNum = c => /^-?[\d,]+(\.\d+)?$/.test(String(c).trim());
  const val = c => Number(String(c).replace(/,/g, ''));
  const mul = u => (/억\s*원/.test(u || '') ? 1e8 : /천\s*원/.test(u || '') ? 1000 : /만\s*원/.test(u || '') ? 1e4 : 1);
  const refs = files.flatMap(f => [
    f.kind === 'quote' && f.supplyWon ? { what: `견적서 ${f.vendor || f.file} 공급가액`, won: f.supplyWon, tol: f.supplyTol || 0 } : null,
    f.kind === 'investment' && f.totalWon ? { what: `투자계획서 투자규모`, won: f.totalWon, tol: f.totalTol || 0 } : null
  ].filter(Boolean));
  (S.sections || []).forEach(s => {
    const t = s.table; if (!t || !Array.isArray(t.head) || !Array.isArray(t.rows)) return;
    const money = /원/.test(t.unit || '') || t.head.some(h => /금액|예산|사업비/.test(h));
    t.head.forEach((h, ci) => {
      // 더해서 합계를 내는 열만(금액·예산·수량·연도별 등). 단가·비율 열은 더하지 않는다
      if (ci === 0 || !/금액|예산|사업비|투자|합계|\d{4}년|분량|수량|인원|면적/.test(h) || /단가|비율|율/.test(h)) return;
      const cells = t.rows.map(r => r[ci]);
      if (!cells.some(c => isNum(c))) return;
      let acc = 0, total = 0;
      t.rows.forEach((r, k) => {
        const tag = String(r[0]).trim(), c = r[ci];
        if (tag === '소계') { if (isNum(c) && Math.abs(val(c) - acc) > 1e-6) err(`${s.no}. ${s.title}: "${h}" 열 ${k + 1}행 소계 ${c} ≠ 위 항목 합 ${acc.toLocaleString()}`); total += isNum(c) ? val(c) : acc; acc = 0; }
        else if (tag === '합계') {
          if (isNum(c) && Math.abs(val(c) - (total + acc)) > 1e-6 && cells.filter(isNum).length > 2) err(`${s.no}. ${s.title}: "${h}" 열 합계 ${c} ≠ 항목 합 ${(total + acc).toLocaleString()}`);
          if (isNum(c) && money && /금액|예산|사업비|합계|투자/.test(h) && refs.length) {
            const w = val(c) * mul(t.unit);
            if (!refs.some(r => Math.abs(r.won - w) <= r.tol)) err(`${s.no}. ${s.title}: 예산 합계 ${w.toLocaleString()}원 ≠ ${refs.map(r => `${r.what} ${r.won.toLocaleString()}원`).join(', ')}`);
          }
        } else if (isNum(c)) acc += val(c);
      });
    });
  });
  // ---- 첨부 원문에 없는 숫자 ----
  if (texts.length) {
    const norm = x => String(Number(x));
    const pool = new Set();
    texts.join('\n').replace(/[\d][\d,]*(\.\d+)?/g, m => { pool.add(norm(m.replace(/,/g, ''))); return m; });
    const strip = s => String(s).replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/[가-힣]{1,8}\d{4}-\d{3,4}호?/g, '').replace(/(19|20)\d{2}\s*[.년]/g, '').replace(/[’']\d{2}/g, '');
    const strs = [S.header && S.header.title, S.purpose, S.request];
    (S.sections || []).forEach(s => { (s.bullets || []).forEach(b => { strs.push(b.text); (b.sub || []).forEach(x => strs.push(x)); }); if (s.table) { strs.push(...s.table.rows.flat(), s.table.unit); } });
    const missing = new Set();
    strs.filter(Boolean).forEach(x => strip(x).replace(/\d[\d,]*(\.\d+)?/g, m => {
      const n = Number(m.replace(/,/g, '')); if (!(n >= 100) || Number.isNaN(n)) return m;
      if (![1, 1e3, 1e-3, 1e4, 1e-4, 1e5, 1e-5, 1e8, 1e-8].some(k => pool.has(norm(+(n * k).toPrecision(12))))) missing.add(m);
      return m;
    }));
    if (missing.size) warn(`첨부 원문에 없는 숫자(계산값이면 무시, 아니면 근거 확인): ${[...missing].join(', ')}`);
  }
  // ---- 결재선 ----
  const ap = S.approval || {};
  if (!(ap.line || []).length) warn('결재선(approval.line)이 비어 있음 — 결재란이 빈 칸으로 나감');
  if (!(S.footer || {}).email) warn('footer.email(기안 부서 연락 메일)이 비어 있음');
  if (JSON.stringify(S).includes('○○○')) warn('○○○ 자리가 남아 있음 — 사용자에게 받아 채울 것');
  return { E, W };
}

function main() {
  const args = process.argv.slice(2); const si = args.indexOf('--scan'); const scanF = si >= 0 ? args.splice(si, 2)[1] : null;
  const srcF = args[0];
  if (!srcF) { console.error('사용: node check.js <source.json> [--scan <scan.json>]'); process.exit(2); }
  const S = JSON.parse(fs.readFileSync(srcF, 'utf8'));
  const sp = scanF || path.join(path.dirname(path.resolve(srcF)), 'scan.json');
  let scan = null, texts = [];
  if (fs.existsSync(sp)) {
    scan = JSON.parse(fs.readFileSync(sp, 'utf8'));
    texts = scan.files.filter(f => f.text).map(f => fs.readFileSync(path.join(path.dirname(sp), f.text), 'utf8'));
  } else console.log(`WARN scan.json 없음(${sp}) — 첨부 대조 없이 구조만 검사`);
  const { E, W } = check(S, scan, texts);
  E.forEach(m => console.log('ERROR ' + m)); W.forEach(m => console.log('WARN  ' + m));
  console.log(E.length ? `CHECK FAIL (오류 ${E.length}, 경고 ${W.length})` : `CHECK PASS (경고 ${W.length})`);
  process.exit(E.length ? 1 : 0);
}
if (require.main === module) main();
module.exports = { check };
