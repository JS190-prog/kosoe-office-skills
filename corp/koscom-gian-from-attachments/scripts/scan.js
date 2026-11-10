// 첨부 폴더 -> 작업 폴더의 text/*.md(본문)와 scan.json(종류·핵심 값). 기안문 source.json을 쓰기 전에 돌린다.
// 사용: node scan.js <첨부폴더> [-o <작업폴더>]   (기본 작업 폴더: <첨부폴더>_기안)
// 핵심 값은 정규식으로 뽑은 힌트다. 기안문에 옮길 때는 text/*.md 원문을 읽고 확인한다.
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const KORDOC = path.join(__dirname, '..', 'node_modules', 'kordoc', 'dist', 'cli.js');
const DOC_EXT = ['.hwpx', '.hwp', '.pdf', '.docx', '.xlsx'], PLAIN_EXT = ['.md', '.txt', '.csv'], IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp'];

const num = s => Number(String(s).replace(/[^\d.]/g, ''));
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const firstDate = s => { const m = /(\d{4})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})/.exec(s || ''); return m ? ymd(m[1], m[2], m[3]) : null; };
// 금액 문자열 -> 원. "1.4억원", "140,000천원", "₩140,000,000", "6,870,000 원"
function won(s) {
  let m = /([\d,.]+)\s*억\s*원/.exec(s); if (m) return Math.round(num(m[1]) * 1e8);
  m = /([\d,]+)\s*천\s*원/.exec(s); if (m) return num(m[1]) * 1000;
  m = /₩\s*([\d,]+)/.exec(s) || /([\d,]{4,})\s*원/.exec(s); return m ? num(m[1]) : null;
}
// 억원으로 반올림해 쓴 금액의 허용 오차(원). "30.6억원" -> 5,000,000, 천원·원 단위는 0
const wonTol = s => { const m = /([\d,.]+)\s*억\s*원/.exec(s || ''); return m ? 0.5 * 10 ** (8 - (m[1].split('.')[1] || '').length) : 0; };
const clean = t => t.replace(/[\uE000-\uF8FF]/g, '').replace(/\r/g, ''); // 기호 글꼴의 사용자 정의 영역 글머리 기호 제거
const lines = t => t.split('\n').map(l => l.replace(/\*\*/g, '').trim()).filter(l => l && !/^!\[/.test(l));
const cellAfter = (t, label) => { const m = new RegExp('(?:^|\\|)\\s*' + label + '\\s*(?:\\||:|：)\\s*([^|\\n]+)', 'm').exec(t); return m ? m[1].trim() : null; };

function classify(t, name) {
  const head = lines(t).slice(0, 6).join('\n');
  if (/견\s*적\s*(서|제출서)|공\s*사\s*견\s*적\s*서|견적금액/.test(head + '\n' + name)) return 'quote';
  if (/투\s*자\s*계\s*획\s*서|(^|\n)\s*[IⅠ]\.\s*투자개요/.test(t) || /투자계획서/.test(name)) return 'investment';
  if (/(^|\n)\s*수신자\s*:/.test(t) && /(^|\n)\s*제\s*목\s*:/.test(t)) return 'gian';
  if (/(^|\n)\s*수\s*신\s+\S/.test(t) && /(^|\n)\s*제\s*목\s+\S/.test(t) && /대표이사|귀하|귀중/.test(t)) return 'letter';
  if (/회\s*의\s*록/.test(head)) return 'minutes';
  if (/계\s*약\s*서/.test(head)) return 'contract';
  if (/과업\s*(내용|지시)서|제안\s*요청서/.test(head + name)) return 'spec';
  if (/담당\s*:|팀장\s*:|부서장\s*:/.test(head) || /(^|\n)\s*□/.test(t.replace(/\*\*/g, ''))) return 'report';
  return 'doc';
}

function facts(kind, t) {
  const L = lines(t), f = {};
  f.title = (L.find(l => !/^[|<]|^\(단위/.test(l)) || '').replace(/^#+\s*/, '');
  if (kind === 'gian' || kind === 'letter') {
    const sub = (/(?:^|\n)\s*제\s*목\s*:?\s*(.+)/.exec(t) || [])[1]; if (sub) f.title = sub.trim();
    const rec = (/(?:^|\n)\s*수신자?\s*:?\s*(.+)/.exec(t) || [])[1]; if (rec) f.recipient = rec.trim();
    const m = /시행\s+(.+?)\s*\((\d{4})[.\s]*(\d{1,2})[.\s]*(\d{1,2})\.?\)/.exec(t);
    if (m) { f.docNo = m[1].trim(); f.date = ymd(m[2], m[3], m[4]); }
    if (kind === 'letter') f.sender = L[0];
    const basis = L.filter(l => /관련\s*(근거)?\s*:/.test(l) || /^[가-하]\.\s*\S+\d{4}-\d{3,4}/.test(l)); if (basis.length) f.basisLines = basis;
  }
  if (kind === 'quote') {
    const supply = cellAfter(t, '공급가액'), line = (/견적\s*금액[^\n]*/.exec(t) || [''])[0], wonSign = /₩\s*([\d,]+)/.exec(line);
    f.supplyWon = supply ? num(supply) : wonSign ? num(wonSign[1]) : won(line) ?? won(t);
    if (!supply && !wonSign && wonTol(line)) f.supplyTol = wonTol(line);
    const vend = cellAfter(t, '견적업체') || cellAfter(t, '공급자') || ((/(\(주\)\s*[^\s|]+|[^\s|]+\s*주식회사|주식회사\s*[^\s|]+)\s*대표이사/.exec(t) || [])[1]);
    if (vend) f.vendor = vend.replace(/\s+/g, '');
    const no = cellAfter(t, '견적번호') || (/(QT-[\w-]+)/.exec(t) || [])[1]; if (no) f.quoteNo = no.split(/\s/)[0];
    f.date = firstDate(cellAfter(t, '견적일') || (/(?:견적일|제출일)\s*:?\s*([^\n)|]+)/.exec(t) || [])[1]);
    const subj = cellAfter(t, '건\\s*명') || cellAfter(t, '사업명') || cellAfter(t, '공사명') || (/(?:건\s*명|공사명)\s*:\s*(.+)/.exec(t) || [])[1]; if (subj) f.subject = subj.trim();
  }
  if (kind === 'investment') {
    const m = /투자\s*규모\)?\s*([\d,.]+\s*억\s*원)/.exec(t.replace(/\*\*/g, '')); if (m) { f.totalWon = won(m[1]); f.totalTol = wonTol(m[1]); }
    const biz = (/사업명<\/t[hd]>\s*<t[hd][^>]*>([^<]+)/.exec(t) || /\(사업명\)\s*([^\n*]+)/.exec(t.replace(/\*\*/g, '')) || [])[1]; if (biz) f.title = biz.trim();
    const ap = /담당자?\s*:\s*([^/\n]+)\/\s*팀장\s*:\s*([^/\n]+)\/\s*부(?:서)?장\s*:\s*([^\n|]+)/.exec(t); if (ap) f.approval = ap.slice(1).map(s => s.trim());
    const dept = L.slice(0, 8).filter(l => /(본부|부|팀|실)$/.test(l) && l.length <= 12); if (dept.length) f.dept = dept;
  }
  if (kind === 'report' || kind === 'spec') {
    const ap = /담당\s*:\s*([^/|]+)\/\s*팀장\s*:\s*([^/|]+)\/\s*부서장\s*:\s*([^|]+)/.exec(t); if (ap) f.approval = ap.slice(1).map(s => s.trim());
    const dd = /(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\.?,\s*([^|\n]+)/.exec(t); if (dd) { f.date = firstDate(dd[1]); f.dept = dd[2].trim(); }
    const b = /\((?:예산|사업비|투자규모)\)\s*([\d,.]+\s*(?:억|천)?\s*원)/.exec(t.replace(/\*\*/g, '')); if (b) { f.budgetWon = won(b[1]); f.budgetTol = wonTol(b[1]); }
  }
  f.docRefs = [...new Set((t.match(/[가-힣]{1,8}\d{4}-\d{3,4}/g) || []))];
  return f;
}

function main() {
  const args = process.argv.slice(2); const oi = args.indexOf('-o'); const outDir = oi >= 0 ? args.splice(oi, 2)[1] : null;
  const dir = args[0];
  if (!dir || !fs.statSync(dir).isDirectory()) { console.error('사용: node scan.js <첨부폴더> [-o <작업폴더>]'); process.exit(2); }
  const work = path.resolve(outDir || path.resolve(dir) + '_기안');
  fs.mkdirSync(path.join(work, 'text'), { recursive: true });
  const files = fs.readdirSync(dir).filter(n => fs.statSync(path.join(dir, n)).isFile() && !/^[~.]/.test(n)).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  const items = [];
  for (const name of files) {
    const p = path.join(dir, name), ext = path.extname(name).toLowerCase();
    const it = { file: name, kind: 'skip' };
    let text = null;
    try {
      if (DOC_EXT.includes(ext)) text = execFileSync(process.execPath, [KORDOC, p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, KORDOC_OFFLINE: '1' }, maxBuffer: 64 << 20 });
      else if (PLAIN_EXT.includes(ext)) text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
      else if (IMG_EXT.includes(ext)) it.kind = 'image';
    } catch (e) { it.kind = 'error'; it.error = String(e.stderr || e.message).split('\n')[0].slice(0, 300); }
    if (text != null) {
      text = clean(text);
      it.text = path.join('text', name + '.md');
      fs.writeFileSync(path.join(work, it.text), text, 'utf8');
      it.kind = classify(text, name); Object.assign(it, facts(it.kind, text)); it.chars = text.length;
    }
    items.push(it);
  }
  const scan = { attachDir: path.resolve(dir), scannedAt: new Date().toISOString(), files: items };
  fs.writeFileSync(path.join(work, 'scan.json'), JSON.stringify(scan, null, 1), 'utf8');
  const KIND = { gian: '공문(코스콤)', letter: '외부 공문', report: '보고서', investment: '투자계획서', quote: '견적서', minutes: '회의록', contract: '계약서', spec: '과업·제안요청', doc: '기타 문서', image: '그림', skip: '읽지 않음', error: '읽기 실패' };
  console.log(`작업 폴더: ${work}`);
  items.forEach((it, i) => {
    const bits = [it.docNo && `${it.docNo}(${it.date})`, it.vendor, it.supplyWon && `공급가액 ${it.supplyWon.toLocaleString()}원`, it.totalWon && `투자규모 ${it.totalWon.toLocaleString()}원`, it.budgetWon && `예산 ${it.budgetWon.toLocaleString()}원`, it.error].filter(Boolean).join(', ');
    console.log(`${String(i + 1).padStart(2)}. [${KIND[it.kind]}] ${it.file}${it.title ? ' — ' + it.title : ''}${bits ? ' | ' + bits : ''}`);
  });
  if (items.some(it => it.kind === 'error')) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { classify, facts, won };
