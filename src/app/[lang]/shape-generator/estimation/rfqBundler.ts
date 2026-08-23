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
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { loc } from '@/lib/i18n/loc';
import { toIsoLang } from '@/lib/i18n/normalize';
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
  const { lang, estimates, metrics, materialId, quantity, currency, partName, flatPattern: _flatPattern, dfmIssues, companyName, notes } = data;
  function tl(ko: string, en: string, ja: string, zh: string, es: string, ar: string) {
    return loc(lang, { ko, en, ja, zh, es, ar });
  }
  function confidenceLabel(confidence: CostEstimate['confidence']) {
    return loc(lang, {
      ko: confidence === 'high' ? '높음' : confidence === 'medium' ? '보통' : '낮음',
      en: confidence === 'high' ? 'High' : confidence === 'medium' ? 'Medium' : 'Low',
      ja: confidence === 'high' ? '高い' : confidence === 'medium' ? '普通' : '低い',
      zh: confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低',
      es: confidence === 'high' ? 'Alta' : confidence === 'medium' ? 'Media' : 'Baja',
      ar: confidence === 'high' ? 'مرتفع' : confidence === 'medium' ? 'متوسط' : 'منخفض',
    });
  }
  const severityLabel = (severity: DFMIssueSummary['severity']) => loc(lang, {
    ko: severity === 'error' ? '오류' : severity === 'warning' ? '경고' : '정보',
    en: severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Info',
    ja: severity === 'error' ? 'エラー' : severity === 'warning' ? '警告' : '情報',
    zh: severity === 'error' ? '错误' : severity === 'warning' ? '警告' : '信息',
    es: severity === 'error' ? 'Error' : severity === 'warning' ? 'Advertencia' : 'Información',
    ar: severity === 'error' ? 'خطأ' : severity === 'warning' ? 'تحذير' : 'معلومات',
  });

  const bestEstimate = estimates.reduce<CostEstimate | null>((best, e) => {
    if (!best) return e;
    return e.unitCost < best.unitCost ? e : best;
  }, null);

  const rows = estimates.map(e => `
    <tr>
      <td>${getProcessName(e.process, lang)}</td>
      <td>${formatCost(e.unitCost * quantity, currency, lang)}</td>
      <td>${formatCost(e.unitCost, currency, lang)}</td>
      <td style="color:${e.confidence === 'high' ? 'var(--nx-ok)' : e.confidence === 'medium' ? 'var(--nx-warn)' : 'var(--nx-error)'}">${confidenceLabel(e.confidence)}</td>
      <td>${e.leadTime}</td>
    </tr>`).join('');

  const dfmRows = dfmIssues && dfmIssues.length > 0 ? dfmIssues.map(i => `
    <tr>
      <td style="color:${i.severity === 'error' ? 'var(--nx-error)' : i.severity === 'warning' ? 'var(--nx-warn)' : 'var(--nx-accent-2)'}">${severityLabel(i.severity)}</td>
      <td>${i.code}</td>
      <td>${i.description}</td>
      <td>${i.recommendation}</td>
    </tr>`).join('') : `<tr><td colspan="4" style="color:var(--nx-ok)">${tl('DfM 이슈 없음', 'No DfM issues found', 'DfMの問題はありません', '未发现 DfM 问题', 'No se encontraron problemas de DfM', 'لم يتم العثور على مشكلات DfM')}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="${toIsoLang(lang)}">
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
    <div style="font-size:11px;color:var(--nx-text-2);margin-bottom:4px">${tl('견적 요청서 (RFQ)', 'Request for Quotation (RFQ)', '見積依頼書 (RFQ)', '报价请求 (RFQ)', 'Solicitud de cotización (RFQ)', 'طلب عرض سعر (RFQ)')}</div>
    <h1>${partName}</h1>
    <div class="meta">${companyName ? companyName + ' · ' : ''}${formatDate(new Date(), lang) ?? ''} · ${tl('수량', 'Qty', '数量', '数量', 'Cant.', 'الكمية')}: ${formatNumber(quantity, lang) ?? quantity}</div>
  </div>
  ${bestEstimate ? `<div style="text-align:right"><div style="font-size:10px;color:var(--nx-text-2);margin-bottom:4px">${tl('최저 견적', 'Best Quote', '最安見積', '最低报价', 'Mejor cotización', 'أفضل عرض')}</div><div style="font-size:28px;font-weight:800;color:var(--nx-ok)">${formatCost(bestEstimate.unitCost * quantity, currency, lang)}</div><div style="font-size:11px;color:var(--nx-text-2)">${getProcessName(bestEstimate.process, lang)}</div></div>` : ''}
</div>

<div class="section">
  <h2>📐 ${tl('형상 정보', 'Geometry', '形状', '几何信息', 'Geometría', 'الشكل')}</h2>
  <div class="kv">
    <div class="kv-item"><label>${tl('재질', 'Material', '材質', '材料', 'Material', 'المادة')}</label><span>${materialId}</span></div>
    <div class="kv-item"><label>${tl('체적', 'Volume', '体積', '体积', 'Volumen', 'الحجم')}</label><span>${metrics.volume_cm3.toFixed(2)} cm³</span></div>
    <div class="kv-item"><label>${tl('표면적', 'Surface Area', '表面積', '表面积', 'Área superficial', 'مساحة السطح')}</label><span>${metrics.surfaceArea_cm2.toFixed(1)} cm²</span></div>
    <div class="kv-item"><label>${tl('치수 W', 'Dim W', '寸法 W', '尺寸 W', 'Dim W', 'البعد W')}</label><span>${metrics.boundingBox.w.toFixed(1)} mm</span></div>
    <div class="kv-item"><label>${tl('치수 H', 'Dim H', '寸法 H', '尺寸 H', 'Dim H', 'البعد H')}</label><span>${metrics.boundingBox.h.toFixed(1)} mm</span></div>
    <div class="kv-item"><label>${tl('치수 D', 'Dim D', '寸法 D', '尺寸 D', 'Dim D', 'البعد D')}</label><span>${metrics.boundingBox.d.toFixed(1)} mm</span></div>
  </div>
</div>

<div class="section">
  <h2>💰 ${tl('공정별 견적', 'Process Estimates', '工程別見積', '工艺估算', 'Estimaciones por proceso', 'تقديرات العمليات')} (${quantity}${tl('개 기준', ' pcs', '個基準', '件基准', ' uds.', ' قطعة')})</h2>
  <table>
    <thead><tr>
      <th>${tl('공정', 'Process', '工程', '工艺', 'Proceso', 'العملية')}</th>
      <th>${tl('총액', 'Total', '合計', '总计', 'Total', 'الإجمالي')}</th>
      <th>${tl('단가', 'Unit', '単価', '单价', 'Unitario', 'سعر الوحدة')}</th>
      <th>${tl('신뢰도', 'Confidence', '信頼度', '置信度', 'Confianza', 'الثقة')}</th>
      <th>${tl('납기', 'Lead Time', '納期', '交期', 'Plazo', 'المهلة')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>

<div class="section">
  <h2>🔍 ${tl('DfM 검토', 'DfM Review', 'DfMレビュー', 'DfM审查', 'Revisión DfM', 'مراجعة DfM')}</h2>
  <table>
    <thead><tr>
      <th>${tl('등급', 'Level', 'レベル', '级别', 'Nivel', 'المستوى')}</th>
      <th>${tl('코드', 'Code', 'コード', '代码', 'Código', 'الرمز')}</th>
      <th>${tl('설명', 'Description', '説明', '描述', 'Descripción', 'الوصف')}</th>
      <th>${tl('권고사항', 'Recommendation', '推奨事項', '建议', 'Recomendación', 'التوصية')}</th>
    </tr></thead>
    <tbody>${dfmRows}</tbody>
  </table>
</div>

${notes ? `<div class="section"><h2>📝 ${tl('특이사항', 'Notes', '備考', '备注', 'Notas', 'ملاحظات')}</h2><p style="font-size:13px;color:#444;white-space:pre-wrap;">${notes}</p></div>` : ''}

<div style="text-align:center;font-size:10px;color:var(--nx-text-2);margin-top:20px">
  ${tl('본 견적서는 NexyFab 자동 견적 시스템으로 생성되었습니다. 실제 거래 전 제조사 확인이 필요합니다.', 'This quotation was generated by NexyFab automated estimation. Verify with manufacturer before placing orders.', 'この見積書はNexyFab自動見積システムで生成されました。注文前にメーカーへご確認ください。', '本报价由 NexyFab 自动估算系统生成。下单前请向制造商确认。', 'Esta cotización fue generada por el sistema automático de NexyFab. Verifique con el fabricante antes de realizar pedidos.', 'تم إنشاء عرض السعر هذا بواسطة نظام NexyFab الآلي. يرجى التحقق من الشركة المصنعة قبل الطلب.')}
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
