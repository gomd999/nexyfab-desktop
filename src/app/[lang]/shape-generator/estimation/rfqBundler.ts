/**
 * rfqBundler.ts
 *
 * Assembles an RFQ (Request For Quotation) package and triggers a browser
 * download as a .zip file.
 *
 * Files in the bundle:
 *   quote.html        – full printable quotation sheet (same as PDF print)
 *   geometry.json     – part geometry metrics
 *   estimates.json    – per-process cost estimates
 *   dfm_report.json   – DFM issues (optional, if analysis has been run)
 *   manifest.json     – bundle metadata / index
 *
 * Implements a minimal STORE-mode ZIP encoder inline so there is no
 * external dependency (JSZip / fflate / etc.).
 */

import { formatCost, getProcessName, type CostEstimate, type GeometryMetrics, type CostCurrency } from './CostEstimator';
import type { FlatPatternResult } from '../features/sheetMetal';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DFMIssueSummary {
  severity: 'error' | 'warning' | 'info';
  code: string;
  description: string;
  recommendation: string;
}

export interface RFQBundleData {
  partName: string;
  materialId: string;
  quantity: number;
  currency: CostCurrency;
  estimates: CostEstimate[];
  metrics: GeometryMetrics;
  lang: string;
  flatPattern?: FlatPatternResult;
  dfmIssues?: DFMIssueSummary[];
  companyName?: string;
  notes?: string;
}

// ─── Minimal ZIP STORE encoder ────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}
function concat(...arrays: (number[] | Uint8Array)[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralDirs: Uint8Array[] = [];
  let offset = 0;

  const now = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    // Local file header (signature 0x04034b50)
    const local = concat(
      [0x50, 0x4b, 0x03, 0x04],   // signature
      u16le(20),                   // version needed: 2.0
      u16le(0),                    // flags
      u16le(0),                    // compression: STORE
      u16le(dosTime),
      u16le(dosDate),
      u32le(crc),
      u32le(size),                 // compressed size
      u32le(size),                 // uncompressed size
      u16le(nameBytes.length),
      u16le(0),                    // extra field length
      nameBytes,
      file.data,
    );
    localHeaders.push(local);

    // Central directory record (signature 0x02014b50)
    const central = concat(
      [0x50, 0x4b, 0x01, 0x02],   // signature
      u16le(20),                   // version made by
      u16le(20),                   // version needed
      u16le(0),                    // flags
      u16le(0),                    // compression: STORE
      u16le(dosTime),
      u16le(dosDate),
      u32le(crc),
      u32le(size),
      u32le(size),
      u16le(nameBytes.length),
      u16le(0),                    // extra
      u16le(0),                    // comment
      u16le(0),                    // disk start
      u16le(0),                    // internal attrs
      u32le(0),                    // external attrs
      u32le(offset),               // offset of local header
      nameBytes,
    );
    centralDirs.push(central);
    offset += local.length;
  }

  const cdSize = centralDirs.reduce((s, c) => s + c.length, 0);
  const eocd = concat(
    [0x50, 0x4b, 0x05, 0x06],   // end of central directory
    u16le(0),                    // disk number
    u16le(0),                    // central dir start disk
    u16le(files.length),
    u16le(files.length),
    u32le(cdSize),
    u32le(offset),
    u16le(0),                    // comment length
  );

  return concat(...localHeaders, ...centralDirs, eocd);
}

// ─── HTML quote builder (lightweight, for bundle — not for printing) ──────────

function buildQuoteHTML(data: RFQBundleData): string {
  const { lang, estimates, metrics, materialId, quantity, currency, partName, flatPattern, dfmIssues, companyName, notes } = data;
  function tl(ko: string, en: string) { return lang === 'ko' ? ko : en; }

  const bestEstimate = estimates.reduce<CostEstimate | null>((best, e) => {
    if (!best) return e;
    return e.unitCost < best.unitCost ? e : best;
  }, null);

  const rows = estimates.map(e => `
    <tr>
      <td>${getProcessName(e.process, lang)}</td>
      <td>${formatCost(e.unitCost * quantity, currency)}</td>
      <td>${formatCost(e.unitCost, currency)}</td>
      <td style="color:${e.confidence === 'high' ? '#3fb950' : e.confidence === 'medium' ? '#d29922' : '#f85149'}">${tl(e.confidence === 'high' ? '높음' : e.confidence === 'medium' ? '보통' : '낮음', e.confidence)}</td>
      <td>${e.leadTime}</td>
    </tr>`).join('');

  const dfmRows = dfmIssues && dfmIssues.length > 0 ? dfmIssues.map(i => `
    <tr>
      <td style="color:${i.severity === 'error' ? '#f85149' : i.severity === 'warning' ? '#d29922' : '#58a6ff'}">${i.severity.toUpperCase()}</td>
      <td>${i.code}</td>
      <td>${i.description}</td>
      <td>${i.recommendation}</td>
    </tr>`).join('') : `<tr><td colspan="4" style="color:#3fb950">${tl('DfM 이슈 없음', 'No DfM issues found')}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>RFQ — ${partName}</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; background:#f6f8fa; color:#1f2328; margin:0; padding:24px; }
  .header { background:#0d1117; color:#c9d1d9; padding:20px 24px; border-radius:8px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:flex-start; }
  .header h1 { margin:0; font-size:22px; }
  .header .meta { font-size:12px; color:#8b949e; margin-top:6px; }
  .section { background:#fff; border:1px solid #d1d9e0; border-radius:8px; padding:16px 20px; margin-bottom:16px; }
  h2 { font-size:14px; font-weight:700; color:#1f2328; margin:0 0 12px 0; border-bottom:1px solid #eaeef2; padding-bottom:6px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { background:#f6f8fa; text-align:left; padding:6px 10px; border-bottom:2px solid #d1d9e0; font-weight:700; }
  td { padding:6px 10px; border-bottom:1px solid #eaeef2; }
  .kv { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
  .kv-item label { font-size:10px; color:#656d76; font-weight:700; display:block; margin-bottom:2px; }
  .kv-item span { font-size:14px; font-weight:700; color:#1f2328; }
  .badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700; }
  .best { background:#dafbe1; color:#1a7f37; }
  @media print { body { background:#fff; } .section { break-inside:avoid; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div style="font-size:11px;color:#8b949e;margin-bottom:4px">${tl('견적 요청서 (RFQ)', 'Request for Quotation (RFQ)')}</div>
    <h1>${partName}</h1>
    <div class="meta">${companyName ? companyName + ' · ' : ''}${new Date().toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US')} · Qty: ${quantity}</div>
  </div>
  ${bestEstimate ? `<div style="text-align:right"><div style="font-size:10px;color:#8b949e;margin-bottom:4px">${tl('최저 견적', 'Best Quote')}</div><div style="font-size:28px;font-weight:800;color:#3fb950">${formatCost(bestEstimate.unitCost * quantity, currency)}</div><div style="font-size:11px;color:#8b949e">${getProcessName(bestEstimate.process, lang)}</div></div>` : ''}
</div>

<div class="section">
  <h2>📐 ${tl('형상 정보', 'Geometry')}</h2>
  <div class="kv">
    <div class="kv-item"><label>${tl('재질', 'Material')}</label><span>${materialId}</span></div>
    <div class="kv-item"><label>${tl('체적', 'Volume')}</label><span>${metrics.volume_cm3.toFixed(2)} cm³</span></div>
    <div class="kv-item"><label>${tl('표면적', 'Surface Area')}</label><span>${metrics.surfaceArea_cm2.toFixed(1)} cm²</span></div>
    <div class="kv-item"><label>${tl('치수 W', 'Dim W')}</label><span>${metrics.boundingBox.w.toFixed(1)} mm</span></div>
    <div class="kv-item"><label>${tl('치수 H', 'Dim H')}</label><span>${metrics.boundingBox.h.toFixed(1)} mm</span></div>
    <div class="kv-item"><label>${tl('치수 D', 'Dim D')}</label><span>${metrics.boundingBox.d.toFixed(1)} mm</span></div>
  </div>
</div>

<div class="section">
  <h2>💰 ${tl('공정별 견적', 'Process Estimates')} (${quantity}${tl('개 기준', ' pcs')})</h2>
  <table>
    <thead><tr>
      <th>${tl('공정', 'Process')}</th>
      <th>${tl('총액', 'Total')}</th>
      <th>${tl('단가', 'Unit')}</th>
      <th>${tl('신뢰도', 'Confidence')}</th>
      <th>${tl('납기', 'Lead Time')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>

<div class="section">
  <h2>🔍 ${tl('DfM 검토', 'DfM Review')}</h2>
  <table>
    <thead><tr>
      <th>${tl('등급', 'Level')}</th>
      <th>${tl('코드', 'Code')}</th>
      <th>${tl('설명', 'Description')}</th>
      <th>${tl('권고사항', 'Recommendation')}</th>
    </tr></thead>
    <tbody>${dfmRows}</tbody>
  </table>
</div>

${notes ? `<div class="section"><h2>📝 ${tl('특이사항', 'Notes')}</h2><p style="font-size:13px;color:#444;white-space:pre-wrap;">${notes}</p></div>` : ''}

<div style="text-align:center;font-size:10px;color:#8b949e;margin-top:20px">
  ${tl('본 견적서는 NexyFab 자동 견적 시스템으로 생성되었습니다. 실제 거래 전 제조사 확인이 필요합니다.', 'This quotation was generated by NexyFab automated estimation. Verify with manufacturer before placing orders.')}
</div>
</body>
</html>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build an RFQ zip bundle and trigger a browser / Tauri save.
 * Returns the Blob for optional further use.
 */
export async function downloadRFQBundle(data: RFQBundleData): Promise<Blob> {
  const enc = new TextEncoder();

  const quoteHTML = buildQuoteHTML(data);
  const geometryJSON = JSON.stringify({
    partName: data.partName,
    materialId: data.materialId,
    volume_cm3: data.metrics.volume_cm3,
    surfaceArea_cm2: data.metrics.surfaceArea_cm2,
    boundingBox_mm: data.metrics.boundingBox,
    complexity: data.metrics.complexity,
    ...(data.flatPattern ? {
      flatPattern: {
        width_mm: data.flatPattern.width,
        length_mm: data.flatPattern.length,
        thickness_mm: data.flatPattern.thickness,
        bendCount: data.flatPattern.bendTable?.length ?? 0,
      },
    } : {}),
  }, null, 2);

  const estimatesJSON = JSON.stringify(
    data.estimates.map(e => ({
      process: e.process,
      processName: e.processName,
      unitCost: e.unitCost,
      totalCost: e.unitCost * data.quantity,
      currency: e.currency,
      quantity: data.quantity,
      confidence: e.confidence,
      leadTime: e.leadTime,
      difficulty: e.difficulty,
      notes: e.notes,
    })),
    null, 2,
  );

  const dfmJSON = JSON.stringify({
    analysed: !!data.dfmIssues,
    issues: data.dfmIssues ?? [],
  }, null, 2);

  const manifest = JSON.stringify({
    rfqVersion: '1.0',
    generatedAt: new Date().toISOString(),
    generatedBy: 'NexyFab RFQ Bundler',
    partName: data.partName,
    materialId: data.materialId,
    quantity: data.quantity,
    currency: data.currency,
    lang: data.lang,
    files: ['quote.html', 'geometry.json', 'estimates.json', 'dfm_report.json'],
  }, null, 2);

  const zipBytes = zipStore([
    { name: 'manifest.json', data: enc.encode(manifest) },
    { name: 'quote.html', data: enc.encode(quoteHTML) },
    { name: 'geometry.json', data: enc.encode(geometryJSON) },
    { name: 'estimates.json', data: enc.encode(estimatesJSON) },
    { name: 'dfm_report.json', data: enc.encode(dfmJSON) },
  ]);

  const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' });
  const safeName = data.partName.replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40);
  const { downloadBlob } = await import('@/lib/platform');
  const filename = `rfq_${safeName}_${new Date().toISOString().slice(0, 10)}.zip`;
  await downloadBlob(filename, blob);
  return blob;
}
