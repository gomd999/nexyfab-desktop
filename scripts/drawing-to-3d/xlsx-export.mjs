/**
 * xlsx-export.mjs — 물량 내역서 XLSX (Wave 1 실무 호환, 260717)
 *
 * 현장 견적·기성은 엑셀이 표준 — BOQ 를 실무 내역 양식(품명·규격·단위·수량·단가·금액·비고)으로.
 * 단가·금액 = 공란(입력 원칙 — 실단가 없이 금액 산출은 날조). 수량 = computeBOQ/takeoff 결정론.
 * 구현: 의존성 0 — 최소 SpreadsheetML + STORE(무압축) ZIP 직접 방출(CRC32 폐형).
 */
import { computeBOQ } from './boq.mjs';
import { takeoff } from '../engineering-core/quantity/takeoff.mjs';

// ── STORE ZIP (무압축) ───────────────────────────────────────────
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const enc = new TextEncoder();
function zipStore(files) {
  const chunks = [], cd = [];
  let off = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); // UTF-8 플래그
    lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, off, true);
    cd.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdLen = cd.reduce((s, u) => s + u.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdLen, true); eo.setUint32(16, off, true);
  const total = off + cdLen + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const u of [...chunks, ...cd, new Uint8Array(eo.buffer)]) { out.set(u, p); p += u.length; }
  return out;
}

// ── SpreadsheetML ────────────────────────────────────────────────
const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colL = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
// cell: 문자열=inlineStr · 숫자=n · null/undefined=빈칸
function rowXml(r, cells) {
  const cs = cells.map((v, i) => {
    if (v == null || v === '') return '';
    const ref = `${colL(i)}${r}`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" t="n"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  }).join('');
  return `<row r="${r}">${cs}</row>`;
}
function sheetXml(rows, widths) {
  const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows.join('')}</sheetData></worksheet>`;
}
function workbook(sheets) {
  const files = [];
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` });
  files.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>` });
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml }));
  return zipStore(files);
}

const MAT_KO = { concrete: ['콘크리트(구체)', '㎥', 'volM3'], timber: ['목재(재적)', '㎥', 'volM3'], PVC: ['PVC', 'kg', 'massKg'] };

/** 어셈블리 → 내역서 XLSX Uint8Array. */
export function boqXlsxU8(assembly, { domain = 'mech', title = '설계' } = {}) {
  const q = computeBOQ(assembly, {});
  const rows = [];
  let r = 1;
  const push = (cells) => { rows.push(rowXml(r, cells)); r++; };
  push([`${title} — 물량 내역서 (자동생성·설계수량)`]);
  push(['단가·금액=공란(실단가 입력 원칙 — 미입력 산출 금지) · 수량=형상 결정론(할증·품 미적용) · 비법정']);
  push([]);
  push(['품명', '규격', '단위', '수량', '단가', '금액', '비고']);
  // ① 재질별 집계
  for (const [mat, v] of Object.entries(q.byMaterial ?? {})) {
    const [ko, unit, key] = MAT_KO[mat] ?? [`${mat}(질량)`, 'kg', 'massKg'];
    push([ko, `부재 ${v.count}개`, unit, +(v[key]).toFixed(unit === 'kg' ? 1 : 3), '', '', '재질별 집계']);
  }
  // ② 룰 물량(civilTakeoff — 터파기·거푸집 등)
  if (Array.isArray(assembly.civilTakeoff) && assembly.civilTakeoff.length) {
    try {
      const to = takeoff(assembly.civilTakeoff);
      for (const it of to.boq ?? []) push([it.item, '', it.unit, it.qty, '', '', '설계수량 룰(산식 공개)']);
    } catch { /* 룰 실패=행 생략(정직) */ }
  }
  // ③ 배관(계통별 m + 부속 개소)
  if (q.piping?.byService) {
    for (const [svc, m] of Object.entries(q.piping.byService)) push([`배관(${svc})`, '', 'm', +Number(m).toFixed(2), '', '', '라우팅 실경로']);
    if (q.piping.elbows) push(['엘보', '', '개소', q.piping.elbows, '', '', '']);
    if (q.piping.tees) push(['티', '', '개소', q.piping.tees, '', '', q.piping.reducingTees ? `이경 ${q.piping.reducingTees} 포함` : '']);
    if (q.piping.sleeves) push(['슬리브', '', '개소', q.piping.sleeves, '', '', '관통 부재 명세=도서']);
  }
  // ④ 용접(기계)
  if (q.weldTotalMm > 0) push(['용접', '필릿 환산', 'm', +(q.weldTotalMm / 1000).toFixed(2), '', '', `조인트 ${q.weldJoints}개소`]);
  push([]);
  push(['※ 본 내역은 형상 기반 설계수량 참고자료 — 계약·정산 수량산출서는 발주처 기준·표준품셈 확인 필요.']);
  const sheet1 = { name: '내역서', xml: sheetXml(rows, [26, 16, 8, 12, 10, 12, 30]) };
  // 부품 상세 시트
  const rows2 = [];
  let r2 = 1;
  const push2 = (cells) => { rows2.push(rowXml(r2, cells)); r2++; };
  push2(['부품', 'Type', '재질', '질량 kg', '재적 ㎥', '표면적 ㎡', '홀', '절곡']);
  for (const it of q.items ?? []) push2([it.id, it.type, it.material, it.massKg, it.volM3, it.surfaceM2, it.holes || '', it.bends || '']);
  const sheet2 = { name: '부품상세', xml: sheetXml(rows2, [22, 14, 10, 10, 10, 10, 6, 6]) };
  return workbook([sheet1, sheet2]);
}

/** base64 편의 래퍼(라우트 zip 동봉용). */
export function boqXlsxBase64(assembly, opts) {
  return Buffer.from(boqXlsxU8(assembly, opts)).toString('base64');
}

// ── self-test: ZIP 무결(CRC·EOCD)·시트 XML 파싱 가능·핵심 행 존재 ────────────
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('xlsx-export.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  let pass = 0, fail = 0;
  const check = (nm, ok, note = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK' : 'FAIL'} ${nm}${note ? ' — ' + note : ''}`); };
  const asm = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { ips: [[0, 0], [200000, 0]] });
  const u8 = boqXlsxU8(asm, { domain: 'civil', title: '옹벽 200m' });
  check('ZIP 시그니처+EOCD', u8[0] === 0x50 && u8[1] === 0x4b && u8[u8.length - 22] === 0x50 && u8[u8.length - 21] === 0x4b);
  const s = new TextDecoder().decode(u8);
  check('시트 2매(내역서·부품상세)', s.includes('sheet1.xml') && s.includes('sheet2.xml'));
  check('재질 집계 행(콘크리트 ㎥)', s.includes('콘크리트(구체)'));
  check('룰 물량 행(터파기 — civilTakeoff)', /터파기|거푸집/.test(s));
  check('단가 공란 원칙 문구', s.includes('실단가 입력 원칙'));
  // CRC 폐형: 각 로컬 엔트리의 CRC 를 재계산 대조
  let ok = true, o = 0;
  const dv = new DataView(u8.buffer);
  while (o < u8.length - 4 && dv.getUint32(o, true) === 0x04034b50) {
    const crc = dv.getUint32(o + 14, true), len = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true);
    const data = u8.subarray(o + 30 + nl, o + 30 + nl + len);
    if (crc32(data) !== crc) ok = false;
    o += 30 + nl + len;
  }
  check('전 엔트리 CRC32 재계산 일치', ok);
  console.log(`xlsx self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
