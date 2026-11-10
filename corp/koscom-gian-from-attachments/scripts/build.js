// source.json(gian/1.0) -> 코스콤 기안문 HWPX (수신·제목·본문·첨부·결재·협조·시행·연락처)
// 사용: node build.js <source.json> <out.hwpx> [--template <틀.hwpx>] [--no-validate] [--force]
// 양식 틀의 서식 문단(맑은 고딕 12pt, 줄간격·들여쓰기)을 복제해 본문을 채우고, 끝나면 kordoc validate로 구조를 검사한다.
// 출력 폴더의 .gian_build.json에 만든 파일의 해시를 적어 두고, 그 뒤 바뀐 파일(한글에서 고쳐 저장 등)은 --force 없이 덮어쓰지 않는다.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const ROOT = path.resolve(__dirname, '..');
const KORDOC = path.join(ROOT, 'node_modules', 'kordoc', 'dist', 'cli.js');

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const flag = k => { const i = argv.indexOf(k); return i >= 0 ? (argv.splice(i, 1), true) : false; };
const TPL = opt('--template') || path.join(ROOT, 'assets', '기안문_양식_틀.hwpx');
const noValidate = flag('--no-validate'), force = flag('--force');
const [srcF, outF] = argv;
if (!srcF || !outF) { console.error('사용: node build.js <source.json> <out.hwpx> [--template 틀.hwpx] [--no-validate] [--force]'); process.exit(2); }
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const recF = path.join(path.dirname(path.resolve(outF)), '.gian_build.json');
const rec = fs.existsSync(recF) ? JSON.parse(fs.readFileSync(recF, 'utf8')) : {};
if (fs.existsSync(outF) && !force && rec[path.basename(outF)] !== sha(outF)) {
  console.error(`ERROR ${outF}: 마지막 생성 뒤 바뀌었거나(한글에서 고쳐 저장 등) 이 스크립트가 만들지 않은 파일이라 덮어쓰지 않음 — 다른 이름으로 만들거나, 바뀐 내용을 확인한 뒤 --force`);
  process.exit(1);
}
const S = JSON.parse(fs.readFileSync(srcF, 'utf8'));
const loc = (n, name) => n && n.nodeType === 1 && n.localName === name;

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(TPL));
  const doc = new DOMParser().parseFromString(await zip.file('Contents/section0.xml').async('string'), 'text/xml');
  const root = doc.documentElement;
  const tops = Array.from(root.childNodes).filter(n => loc(n, 'p'));
  const NS = tops[0].namespaceURI;
  const txtOf = p => Array.from(p.getElementsByTagName('hp:t')).map(t => t.textContent).join('');
  const hasTbl = p => p.getElementsByTagName('hp:tbl').length > 0;
  const find = (re, noTbl = true) => { const p = tops.find(p => (!noTbl || !hasTbl(p)) && re.test(txtOf(p))); if (!p) throw new Error('틀 문단 없음: ' + re); return p; };

  const T = {
    blank: tops.find(p => !hasTbl(p) && txtOf(p).trim() === '' && tops.indexOf(p) > 0),
    plain: find(/^1\. 관련근거/), basis: find(/^\s*가\. /), hang: find(/^2\. 위 근거에/), center: find(/다\s+음/), head: find(/^1\. 경과사항/),
    bullet: find(/^\s*ㅇ /), sub: find(/^\s*- \[/), note: find(/^\s*\* 사장보고/), unit: find(/^\(단위/), att1: find(/^첨부 1\./), att2: find(/^\s{3,}2\./)
  };
  const headerHolder = tops.find(p => hasTbl(p) && /수신자/.test(txtOf(p)));
  const logoHolder = tops[0];
  const tableHolder = tops.find(p => Array.from(p.getElementsByTagName('hp:tbl')).some(t => t.getAttribute('colCnt') === '6'));
  const footHolder = tops.find(p => Array.from(p.getElementsByTagName('hp:tbl')).some(t => t.getAttribute('colCnt') === '30'));

  // ---- 문단 도우미 ----
  const dropSeg = p => { for (const c of Array.from(p.childNodes)) if (loc(c, 'linesegarray')) p.removeChild(c); };
  function fillT(tEl, text) {
    while (tEl.firstChild) tEl.removeChild(tEl.firstChild);
    String(text).split('\n').forEach((part, i) => { if (i) tEl.appendChild(doc.createElementNS(NS, 'hp:lineBreak')); tEl.appendChild(doc.createTextNode(part)); });
  }
  function setP(p, text, fallbackCharPr) {
    const runs = Array.from(p.childNodes).filter(n => loc(n, 'run'));
    let run = runs.find(r => r.getElementsByTagName('hp:t').length) || runs[0];
    if (!run) { run = doc.createElementNS(NS, 'hp:run'); run.setAttribute('charPrIDRef', fallbackCharPr || '0'); p.appendChild(run); }
    let t = Array.from(run.childNodes).find(n => loc(n, 't'));
    if (!t) { t = doc.createElementNS(NS, 'hp:t'); run.appendChild(t); }
    fillT(t, text);
    for (const r of Array.from(p.childNodes)) if (loc(r, 'run') && r !== run) p.removeChild(r);
    for (const c of Array.from(run.childNodes)) if (c !== t && loc(c, 't')) run.removeChild(c);
    dropSeg(p); p.setAttribute('pageBreak', '0');
  }
  const mk = (tpl, text) => { const p = tpl.cloneNode(true); setP(p, text); return p; };
  // "다음 문단과 함께"는 문단 모양(header.xml paraPr의 breakSetting)에 있다 — 문단 모양을 복제해 keepWithNext=1로 바꿔 건다
  const hdoc = new DOMParser().parseFromString(await zip.file('Contents/header.xml').async('string'), 'text/xml');
  const paraProps = hdoc.getElementsByTagName('hh:paraProperties')[0];
  const keepIds = {};
  const keepNext = p => {
    const ref = p.getAttribute('paraPrIDRef');
    if (!(ref in keepIds)) {
      const src = Array.from(paraProps.getElementsByTagName('hh:paraPr')).find(x => x.getAttribute('id') === ref);
      if (src.getElementsByTagName('hh:breakSetting')[0].getAttribute('keepWithNext') === '1') keepIds[ref] = ref;
      else {
        const cp = src.cloneNode(true), id = String(paraProps.getElementsByTagName('hh:paraPr').length);
        cp.setAttribute('id', id); cp.getElementsByTagName('hh:breakSetting')[0].setAttribute('keepWithNext', '1');
        paraProps.appendChild(cp); paraProps.setAttribute('itemCnt', String(Number(id) + 1)); keepIds[ref] = id;
      }
    }
    p.setAttribute('paraPrIDRef', keepIds[ref]); return p;
  };
  const out = [];
  const blank = () => { const p = T.blank.cloneNode(true); setP(p, ''); out.push(p); };

  // ---- 표 도우미 ----
  const tplTbl = Array.from(tableHolder.getElementsByTagName('hp:tbl')).find(t => t.getAttribute('colCnt') === '6');
  const trs = Array.from(tplTbl.childNodes).filter(n => loc(n, 'tr'));
  const protoH = Array.from(trs[0].childNodes).find(n => loc(n, 'tc')), protoB = Array.from(trs[1].childNodes).find(n => loc(n, 'tc'));
  const protoL = Array.from(trs[1].childNodes).filter(n => loc(n, 'tc')).pop(); // 왼쪽 정렬 셀
  const TOTAL = 49049;
  let tblId = 1810910500;
  const dlen = s => [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0);

  function buildTable(spec) {
    const head = spec.head, rows = spec.rows, nc = head.length;
    const all = [head, ...rows];
    // 병합: 합계·소계 행은 첫 값 앞까지 가로 병합, 첫 열이 빈 칸이면 위 칸과 세로 병합
    const grid = all.map(r => r.map(c => ({ text: String(c ?? ''), cs: 1, rs: 1, skip: false })));
    grid.forEach((r, ri) => {
      if (ri > 0 && /^(합계|소계)$/.test(r[0].text)) {
        const nonEmptyIdx = r.findIndex((x, k) => k > 0 && x.text !== '');
        const span = nonEmptyIdx === -1 ? nc : nonEmptyIdx; r[0].cs = span; for (let k = 1; k < span; k++) r[k].skip = true;
      }
    });
    for (let ri = 2; ri < all.length; ri++) if (grid[ri][0].text === '' && !grid[ri][0].skip) { let up = ri - 1; while (up > 1 && (grid[up][0].skip || grid[up][0].text === '')) up--; if (grid[up][0].text !== '') { grid[up][0].rs++; grid[ri][0].skip = true; } }
    // 열 너비: 글자 길이 가중치
    const w = Array(nc).fill(8);
    all.forEach((r, ri) => r.forEach((c, ci) => { if (grid[ri][ci].cs === 1) { const m = Math.max(...String(c ?? '').split('\n').map(dlen)); w[ci] = Math.max(w[ci], Math.min(m + (/^[\d,.\s\n]+$/.test(String(c ?? '')) ? 3 : 0), 40)); } }));
    const sw = w.reduce((a, b) => a + b, 0); const cw = w.map(x => Math.round(TOTAL * x / sw)); cw[nc - 1] += TOTAL - cw.reduce((a, b) => a + b, 0);
    const tbl = tplTbl.cloneNode(true);
    for (const c of Array.from(tbl.childNodes)) if (loc(c, 'tr')) tbl.removeChild(c);
    tbl.setAttribute('id', String(tblId++)); tbl.setAttribute('rowCnt', String(all.length)); tbl.setAttribute('colCnt', String(nc));
    let H = 0;
    grid.forEach((r, ri) => {
      const tr = doc.createElementNS(NS, 'hp:tr');
      const lines = Math.max(...r.map(c => c.text.split('\n').length));
      const h = ri === 0 ? 3280 : Math.max(3425, lines * 1500 + 1500); H += h;
      r.forEach((cell, ci) => {
        if (cell.skip) return;
        const isText = ri > 0 && ci > 0 && /[가-힣]/.test(cell.text) && dlen(cell.text) > 14;
        const tc = (ri === 0 ? protoH : (isText ? protoL : protoB)).cloneNode(true);
        setP(tc.getElementsByTagName('hp:p')[0], cell.text);
        const addr = tc.getElementsByTagName('hp:cellAddr')[0], span = tc.getElementsByTagName('hp:cellSpan')[0], sz = tc.getElementsByTagName('hp:cellSz')[0];
        addr.setAttribute('colAddr', String(ci)); addr.setAttribute('rowAddr', String(ri));
        span.setAttribute('colSpan', String(cell.cs)); span.setAttribute('rowSpan', String(cell.rs));
        let wid = 0; for (let k = ci; k < ci + cell.cs; k++) wid += cw[k];
        sz.setAttribute('width', String(wid)); sz.setAttribute('height', String(h * cell.rs));
        tr.appendChild(tc);
      });
      tbl.appendChild(tr);
    });
    tbl.getElementsByTagName('hp:sz')[0].setAttribute('height', String(H));
    const holder = tableHolder.cloneNode(true);
    const old = Array.from(holder.getElementsByTagName('hp:tbl')).find(t => t.getAttribute('colCnt') === '6');
    old.parentNode.replaceChild(tbl, old); dropSeg(holder); out.push(holder);
  }

  // ---- 본문 ----
  // closing("- 아 래 -" 줄), request(2. 요청 문장 전체), sender(외부 발신 공문의 발신명의)는 선택 항목
  const decree = /해지|변경/.test(S.header.kind || '');
  const closing = S.closing || (decree ? '-  다    음  -' : '-  아    래  -');
  const bs = S.basis.map(b => `${b.docNo || ''}${b.docNo ? '(' : ''}${b.date ? b.date.replace(/-/g, '. ') + '. : ' : ''}${b.title}${b.docNo ? ')' : ''}`);
  blank();
  if (S.basis.length === 1) out.push(mk(T.plain, `1. 관련근거 : ${bs[0]}`));
  else if (S.basis.length > 1) { out.push(mk(T.plain, '1. 관련근거')); S.basis.forEach((b, i) => out.push(mk(T.basis, `  ${b.mark || '가나다라마바사'[i]}. ${bs[i]}`))); blank(); }
  const no2 = S.basis.length ? '2' : '1';
  out.push(mk(T.hang, S.request ? `${no2}. ${S.request}` : `${no2}. ${S.basis.length ? '위 근거에 의거, ' : ''}${S.purpose}하고자 하오니 ${decree ? '시행하겠습니다' : '결재하여 주시기 바랍니다'}.`.replace('하고자 하오니 시행하겠습니다', '하고자 합니다')));
  blank(); out.push(mk(T.center, closing)); blank();
  const bulletsOut = (bl, afterTable) => (bl || []).forEach(b => {
    out.push(mk(afterTable ? T.note : T.bullet, afterTable ? `    * ${b.text}` : `  ㅇ ${b.text}`));
    (b.sub || []).forEach(x => /^\*/.test(x) ? out.push(mk(T.note, `    ${x.replace(/^\*\s*/, '* ')}`)) : out.push(mk(T.sub, `    - ${x}`)));
  });
  S.sections.forEach((sec, i) => {
    if (i) blank();
    out.push(keepNext(mk(T.head, `${sec.no}. ${sec.title}`)));
    if (!sec.bulletsAfterTable) bulletsOut(sec.bullets, false);
    if (sec.table) { if (sec.table.unit) out.push(keepNext(mk(T.unit, `(단위 : ${sec.table.unit})`))); buildTable(sec.table); }
    if (sec.schedule) { const sc = sec.schedule; out.push(keepNext(mk(T.unit, '(' + sc.year + ')'))); buildTable({ head: ['추진내용', ...sc.months], rows: sc.rows.map(r => [r[0], ...r[1].map(v => v ? '●' : '')]) }); }
    if (sec.bulletsAfterTable) bulletsOut(sec.bullets, true);
  });
  blank();
  S.attachments.forEach((a, i) => {
    const t = /\d+부$/.test(a.title.trim()) ? a.title.trim() : `${a.title} ${a.copies}부`;
    const last = i === S.attachments.length - 1;
    out.push(mk(i === 0 ? T.att1 : T.att2, i === 0 ? `첨부 ${a.no}. ${t}${last ? '. 끝.' : ''}` : `       ${a.no}. ${t}${last ? '. 끝.' : ''}`));
  });

  // ---- 머리(수신자·제목) ----
  // 머리표에서 "수신자 :"·"제  목 :" 라벨 칸 바로 다음 칸이 값 칸이다
  const htcs = Array.from(headerHolder.getElementsByTagName('hp:tc'));
  const valueP = re => { const i = htcs.findIndex(tc => re.test(txtOf(tc).trim())); if (i < 0 || !htcs[i + 1]) throw new Error('틀 머리표 칸 없음: ' + re); return htcs[i + 1].getElementsByTagName('hp:p')[0]; };
  setP(valueP(/^수신자\s*:?$/), S.header.recipient);
  const pTitle = valueP(/^제\s*목\s*:?$/);
  { // 제목 칸: 입력 필드 표지(ctrl 런)는 보존하고 글자 런만 하나로 합친다
    const textRuns = Array.from(pTitle.childNodes).filter(n => loc(n, 'run') && n.getElementsByTagName('hp:t').length);
    fillT(textRuns[0].getElementsByTagName('hp:t')[0], S.header.title);
    textRuns.slice(1).forEach(r => pTitle.removeChild(r)); dropSeg(pTitle);
  }
  // ---- 하단(결재란·시행·연락처) ----
  const ft = Array.from(footHolder.getElementsByTagName('hp:tbl')).find(t => t.getAttribute('colCnt') === '30');
  const frows = Array.from(ft.childNodes).filter(n => loc(n, 'tr'));
  const cellsOf = tr => Array.from(tr.childNodes).filter(n => loc(n, 'tc'));
  const ptext = tc => txtOf(tc.getElementsByTagName('hp:p')[0]);
  const normPp = frows.map(r => cellsOf(r)).flat().find(tc => /^시행/.test(ptext(tc))).getElementsByTagName('hp:p')[0].getElementsByTagName('hp:run')[0].getAttribute('charPrIDRef');
  const setCell = (tc, text, cp) => setP(tc.getElementsByTagName('hp:p')[0], text, cp);
  const rowIdx = lab => frows.findIndex(r => cellsOf(r).some(tc => ptext(tc).trim() === lab));
  // 결재란: 한 행에 (직위, 이름) 쌍 4개, 넘치면 다음 행으로 이어 쓴다
  const fillLine = (labRow, items) => { if (labRow < 0) return;
    const slots = []; [labRow, labRow + 1].forEach(ri => { const cs = cellsOf(frows[ri]); for (let i = 1; i + 1 < cs.length; i += 2) slots.push([cs[i], cs[i + 1]]); });
    if (items.length > slots.length) console.error(`WARN 결재·협조 칸 ${slots.length}개를 넘는 ${items.length - slots.length}명은 빠짐`);
    items.slice(0, slots.length).forEach((it, i) => { setCell(slots[i][0], it.top, normPp); setCell(slots[i][1], it.bottom, normPp); }); };
  const ap = S.approval || {};
  const dmd = d => d ? d.slice(5).replace('-', '/') : '';
  fillLine(rowIdx('결 재'), (ap.line || []).map(l => ({ top: l.mode ? `${l.role}\n${l.mode}` : l.role, bottom: [l.name, dmd(l.date)].filter(Boolean).join(' ') })));
  fillLine(rowIdx('협 조'), (ap.cooperation || []).map(l => ({ top: l.dept, bottom: [l.name, dmd(l.date)].filter(Boolean).join(' ') })));
  const F = S.footer || {};
  frows.forEach(r => cellsOf(r).forEach(tc => {
    const t = ptext(tc);
    if (/^시행/.test(t)) setCell(tc, F.docNo ? `시행 ${F.docNo} (${F.date.replace(/-/g, '.')})` : '시행    ', normPp);
    else if (/^\d{2,3}-\d{3,4}-\d{4}$/.test(t.trim())) setCell(tc, (F.org || {}).tel || t, normPp);
    else if (/@koscom\.co\.kr/.test(t)) setCell(tc, F.email || '', normPp); // 틀의 견본 주소를 남기지 않는다
  }));
  if (S.sender) { // 발신명의: 결재란 위 3×3 표의 가운데 칸(오른쪽 좁은 칸은 직인 자리)
    const st = Array.from(ft.getElementsByTagName('hp:tbl')).find(t => t.getAttribute('rowCnt') === '3' && t.getAttribute('colCnt') === '3');
    const mid = Array.from(st.getElementsByTagName('hp:tc')).find(tc => { const a = tc.getElementsByTagName('hp:cellAddr')[0]; return a.getAttribute('rowAddr') === '1' && a.getAttribute('colAddr') === '1'; });
    setP(mid.getElementsByTagName('hp:p')[0], S.sender);
  }
  dropSeg(footHolder);

  // ---- 조립 ----
  for (const p of tops) if (p !== logoHolder && p !== headerHolder && p !== footHolder) root.removeChild(p);
  out.forEach(p => root.insertBefore(p, footHolder));
  for (const p of Array.from(root.getElementsByTagName('hp:p'))) dropSeg(p);
  zip.file('Contents/section0.xml', new XMLSerializer().serializeToString(doc));
  zip.file('Contents/header.xml', new XMLSerializer().serializeToString(hdoc));
  // ---- 문서 정보: 미리보기 글·그림(틀 내용이 남지 않게 흰 그림), 제목·작성자 ----
  zip.file('Preview/PrvText.txt', `<수신자 : ${S.header.recipient}>\r\n<제  목 : ${S.header.title}>`);
  const prv = zip.file('Preview/PrvImage.png');
  if (prv) zip.file('Preview/PrvImage.png', whitePng(await prv.async('nodebuffer')));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let hpf = await zip.file('Contents/content.hpf').async('string');
  const setMeta = (name, val) => { hpf = hpf.replace(new RegExp('(<opf:meta name="' + name + '" content="text"[^/>]*>)[\\s\\S]*?(</opf:meta>)'), '$1' + val + '$2'); };
  ['creator', 'lastsaveby'].forEach(n => setMeta(n, '작성자')); ['subject', 'description', 'keyword'].forEach(n => setMeta(n, ''));
  hpf = hpf.replace(/<opf:title\/>|<opf:title>[^<]*<\/opf:title>/, '<opf:title>' + esc(S.header.title) + '</opf:title>');
  zip.file('Contents/content.hpf', hpf);
  // mimetype은 압축하지 않고 맨 앞에 둔다(HWPX/OCF 규칙)
  const o = new JSZip();
  o.file('mimetype', await zip.file('mimetype').async('string'), { compression: 'STORE' });
  for (const n of Object.keys(zip.files)) if (n !== 'mimetype' && !zip.files[n].dir) o.file(n, await zip.file(n).async('nodebuffer'), { date: zip.files[n].date });
  fs.mkdirSync(path.dirname(path.resolve(outF)), { recursive: true });
  fs.writeFileSync(outF, await o.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  rec[path.basename(outF)] = sha(outF); fs.writeFileSync(recF, JSON.stringify(rec, null, 1), 'utf8');
  if (!noValidate) {
    try { execFileSync(process.execPath, [KORDOC, 'validate', outF], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, KORDOC_OFFLINE: '1' } }); }
    catch (e) { console.error('ERROR kordoc validate 실패: ' + String(e.stderr || e.stdout || e.message).slice(0, 800)); process.exit(1); }
  }
  console.log(`OK ${outF} (본문 문단 ${out.length}, 첨부 ${S.attachments.length}건${noValidate ? '' : ', 구조 검증 통과'})`);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });

// 같은 크기의 흰색 PNG(미리보기 그림 자리)
function whitePng(buf) {
  const zlib = require('zlib');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const T = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[i] = c >>> 0; }
  const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const row = Buffer.alloc(1 + w * 3, 255); row[0] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), ch('IEND', Buffer.alloc(0))]);
}
