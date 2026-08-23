/**
 * quotePrinter.ts
 *
 * Generates a printable HTML quotation sheet and triggers window.print().
 * No external PDF library needed — the browser renders and the user saves as PDF.
 *
 * Exported entry point: `printQuote(data, lang)`
 */

import { formatCost, getProcessName, type CostEstimate, type GeometryMetrics, type CostCurrency } from './CostEstimator';
import type { FlatPatternResult } from '../features/sheetMetal';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { loc } from '@/lib/i18n/loc';
import { toIsoLang } from '@/lib/i18n/normalize';

export interface QuoteData {
  estimates: CostEstimate[];
  metrics: GeometryMetrics;
  materialId: string;
  quantity: number;
  currency: CostCurrency;
  flatPattern?: FlatPatternResult;
  partName?: string;
  companyName?: string;
}

function t(lang: string, ko: string, en: string, ja: string, zh: string, es: string, ar: string) {
  return loc(lang, { ko, en, ja, zh, es, ar });
}

function confidenceLabel(c: 'high' | 'medium' | 'low', lang: string) {
  const labels = {
    high: { ko: '높음', en: 'High', ja: '高い', zh: '高', es: 'Alta', ar: 'مرتفع' },
    medium: { ko: '보통', en: 'Medium', ja: '普通', zh: '中', es: 'Media', ar: 'متوسط' },
    low: { ko: '낮음', en: 'Low', ja: '低い', zh: '低', es: 'Baja', ar: 'منخفض' },
  } as const;
  return loc(lang, labels[c]);
}

function buildBendTable(fp: FlatPatternResult, lang: string): string {
  if (!fp.bendTable || fp.bendTable.length === 0) return '';
  const rows = fp.bendTable.map((b, i) =>
    `<tr>
      <td>${i + 1}</td>
      <td>${b.angle.toFixed(1)}°</td>
      <td>${b.radius.toFixed(2)} mm</td>
      <td>${b.direction}</td>
      <td>${b.bendAllowance.toFixed(3)} mm</td>
      <td>${b.kFactor.toFixed(3)}</td>
    </tr>`
  ).join('');
  return `
    <h3>${t(lang, '판금 벤드 테이블', 'Sheet Metal Bend Table', '板金ベンドテーブル', '钣金折弯表', 'Tabla de dobleces de chapa', 'جدول ثني الصفائح')}</h3>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>${t(lang, '각도', 'Angle', '角度', '角度', 'Ángulo', 'الزاوية')}</th>
          <th>${t(lang, '내경', 'Inner R', '内側R', '内径 R', 'Radio interior', 'نصف القطر الداخلي')}</th>
          <th>${t(lang, '방향', 'Dir.', '方向', '方向', 'Dir.', 'الاتجاه')}</th>
          <th>${t(lang, '벤드 허용량', 'Bend Allow.', '曲げ代', '折弯余量', 'Margen de doblez', 'سماحية الثني')}</th>
          <th>K-factor</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="dim">${t(lang,
      `전개 치수: ${fp.width.toFixed(2)} × ${fp.length.toFixed(2)} mm | 두께: ${fp.thickness.toFixed(2)} mm`,
      `Flat blank: ${fp.width.toFixed(2)} × ${fp.length.toFixed(2)} mm | Thickness: ${fp.thickness.toFixed(2)} mm`,
      `展開寸法: ${fp.width.toFixed(2)} × ${fp.length.toFixed(2)} mm | 板厚: ${fp.thickness.toFixed(2)} mm`,
      `展开尺寸: ${fp.width.toFixed(2)} × ${fp.length.toFixed(2)} mm | 厚度: ${fp.thickness.toFixed(2)} mm`,
      `Dimensiones desplegadas: ${fp.width.toFixed(2)} × ${fp.length.toFixed(2)} mm | Espesor: ${fp.thickness.toFixed(2)} mm`,
      `الأبعاد المسطحة: ${fp.width.toFixed(2)} × ${fp.length.toFixed(2)} مم | السماكة: ${fp.thickness.toFixed(2)} مم`,
    )}</p>
  `;
}

function buildEstimatesTable(estimates: CostEstimate[], lang: string): string {
  const rows = estimates.map(e => `
    <tr>
      <td><strong>${getProcessName(e.process, lang)}</strong></td>
      <td>${formatCost(e.materialCost, e.currency, lang)}</td>
      <td>${formatCost(e.machineCost, e.currency, lang)}</td>
      <td>${formatCost(e.setupCost, e.currency, lang)}</td>
      <td class="cost">${formatCost(e.unitCost, e.currency, lang)}</td>
      <td class="cost total">${formatCost(e.totalCost, e.currency, lang)}</td>
      <td>${e.leadTime}</td>
      <td>${confidenceLabel(e.confidence, lang)}</td>
      <td>${e.difficulty}/10</td>
    </tr>
    ${e.notes.length > 0 ? `<tr class="notes-row"><td colspan="9">⚠ ${e.notes.join(' / ')}</td></tr>` : ''}
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>${t(lang, '공정', 'Process', '工程', '工艺', 'Proceso', 'العملية')}</th>
          <th>${t(lang, '재료비', 'Material', '材料費', '材料费', 'Material', 'المواد')}</th>
          <th>${t(lang, '가공비', 'Machine', '加工費', '加工费', 'Maquinado', 'التشغيل')}</th>
          <th>${t(lang, '셋업', 'Setup', '段取り', '设置', 'Preparación', 'الإعداد')}</th>
          <th>${t(lang, '단가', 'Unit', '単価', '单价', 'Unitario', 'سعر الوحدة')}</th>
          <th>${t(lang, '합계', 'Total', '合計', '合计', 'Total', 'الإجمالي')}</th>
          <th>${t(lang, '납기', 'Lead', '納期', '交期', 'Plazo', 'المهلة')}</th>
          <th>${t(lang, '신뢰도', 'Conf.', '信頼度', '置信度', 'Conf.', 'الثقة')}</th>
          <th>${t(lang, '난이도', 'Diff.', '難易度', '难度', 'Dif.', 'الصعوبة')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export async function printQuote(data: QuoteData, lang: string): Promise<void> {
  const now = new Date();
  const dateStr = formatDate(now, lang, {
    year: 'numeric', month: 'long', day: 'numeric',
  }) ?? '';
  const partName = data.partName || t(lang, '무제 부품', 'Unnamed Part', '名称未設定の部品', '未命名零件', 'Pieza sin nombre', 'قطعة بلا اسم');
  const companyName = data.companyName || 'NexyFab';
  const bb = data.metrics.boundingBox;

  const html = `<!DOCTYPE html>
<html lang="${toIsoLang(lang)}">
<head>
<meta charset="UTF-8">
<title>${t(lang, '견적서', 'Quotation', '見積書', '报价单', 'Cotización', 'عرض سعر')} — ${partName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans KR', 'Malgun Gothic', Arial, sans-serif;
    font-size: 11px; color: #1a1a2e; background: #fff;
    padding: 20mm 18mm;
  }
  h1 { font-size: 22px; font-weight: 900; color: #1a56db; margin-bottom: 2px; }
  h2 { font-size: 13px; font-weight: 700; color: #374151; margin: 14px 0 6px; border-bottom: 1.5px solid #e5e7eb; padding-bottom: 4px; }
  h3 { font-size: 12px; font-weight: 700; color: #374151; margin: 10px 0 4px; }
  p { font-size: 10px; color: #6b7280; margin-bottom: 2px; }
  p.dim { font-size: 9px; color: #9ca3af; margin-top: 4px; }
  .header-row { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; border-bottom: 2px solid #1a56db; padding-bottom: 10px; }
  .meta { font-size: 10px; color: #6b7280; text-align: right; line-height: 1.6; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
  .card .label { font-size: 9px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .card .value { font-size: 13px; font-weight: 700; color: #111827; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 10px; }
  th { background: #f3f4f6; font-weight: 700; color: #374151; padding: 5px 6px; text-align: left; border: 1px solid #e5e7eb; }
  td { padding: 4px 6px; border: 1px solid #e5e7eb; color: #1f2937; vertical-align: middle; }
  tr:nth-child(even) td { background: #f9fafb; }
  td.cost { font-weight: 700; }
  td.total { color: #1a56db; font-size: 11px; }
  tr.notes-row td { background: #fffbeb; color: #92400e; font-size: 9px; border-top: none; }
  .footer { margin-top: 20px; font-size: 9px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 8px; line-height: 1.6; }
  .badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: #dbeafe; color: #1e40af; margin-left: 6px; }
  @media print {
    body { padding: 0; }
    @page { margin: 15mm 14mm; size: A4 portrait; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>

<div class="header-row">
  <div>
    <h1>${companyName}</h1>
    <p style="font-size:12px;font-weight:700;color:#374151;margin-top:4px;">${t(lang, '제조 견적서', 'Manufacturing Quotation', '製造見積書', '制造报价单', 'Cotización de fabricación', 'عرض سعر التصنيع')}</p>
  </div>
  <div class="meta">
    <div>${t(lang, '발행일', 'Date', '発行日', '发布日期', 'Fecha', 'التاريخ')}: ${dateStr}</div>
    <div>${t(lang, '부품명', 'Part', '部品', '零件', 'Pieza', 'القطعة')}: <strong>${partName}</strong></div>
    <div>${t(lang, '수량', 'Qty', '数量', '数量', 'Cant.', 'الكمية')}: <strong>${formatNumber(data.quantity, lang) ?? data.quantity}</strong></div>
    <div>${t(lang, '재질', 'Material', '材質', '材料', 'Material', 'المادة')}: <strong>${data.materialId}</strong></div>
  </div>
</div>

<h2>${t(lang, '형상 정보', 'Geometry Summary', '形状概要', '几何摘要', 'Resumen geométrico', 'ملخص الشكل')}</h2>
<div class="grid2">
  <div class="card">
    <div class="label">${t(lang, '체적', 'Volume', '体積', '体积', 'Volumen', 'الحجم')}</div>
    <div class="value">${data.metrics.volume_cm3.toFixed(2)} cm³</div>
  </div>
  <div class="card">
    <div class="label">${t(lang, '표면적', 'Surface Area', '表面積', '表面积', 'Área superficial', 'مساحة السطح')}</div>
    <div class="value">${data.metrics.surfaceArea_cm2.toFixed(1)} cm²</div>
  </div>
  <div class="card">
    <div class="label">${t(lang, '외형 크기', 'Bounding Box', '外接寸法', '包围盒', 'Caja delimitadora', 'صندوق الإحاطة')}</div>
    <div class="value" style="font-size:11px">${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} × ${bb.d.toFixed(1)} mm</div>
  </div>
  <div class="card">
    <div class="label">${t(lang, '복잡도', 'Complexity', '複雑度', '复杂度', 'Complejidad', 'التعقيد')}</div>
    <div class="value">${(data.metrics.complexity * 100).toFixed(0)}%</div>
  </div>
</div>

<h2>${t(lang, '공정별 비용 견적', 'Process Cost Estimates', '工程別コスト見積', '工艺成本估算', 'Estimaciones por proceso', 'تقديرات تكلفة العملية')}</h2>
${buildEstimatesTable(data.estimates, lang)}
<p class="dim">${t(lang,
  '* 자동 산출 견적입니다. 정식 발주 전 공식 견적서를 재발행 받으시기 바랍니다.',
  '* Automated estimate only. Please request a formal requote before placing an order.',
  '* 自動算出の見積です。発注前に正式な再見積をご依頼ください。',
  '* 仅为自动估算。下单前请索取正式报价。',
  '* Estimación automática. Solicite una cotización formal antes de realizar el pedido.',
  '* هذا تقدير آلي فقط. يرجى طلب عرض سعر رسمي قبل تقديم الطلب.',
)}</p>

${data.flatPattern ? `<h2>${t(lang, '판금 공정 상세', 'Sheet Metal Detail', '板金工程詳細', '钣金工艺详情', 'Detalle de chapa', 'تفاصيل الصفائح المعدنية')}</h2>${buildBendTable(data.flatPattern, lang)}` : ''}

<div class="footer">
  <strong>${companyName}</strong>${t(lang, ' — NexyFab 플랫폼으로 생성된 견적', ' — Generated by NexyFab platform', ' — NexyFabプラットフォームで生成', ' — 由 NexyFab 平台生成', ' — Generado por la plataforma NexyFab', ' — تم إنشاؤه بواسطة منصة NexyFab')}
  &nbsp;|&nbsp; ${t(lang, '본 견적은 참고용이며 법적 구속력이 없습니다', 'This estimate is for reference only and has no legal binding force', 'この見積は参考情報であり、法的拘束力はありません', '本估算仅供参考，不具有法律约束力', 'Esta estimación es solo orientativa y no tiene fuerza legal', 'هذا التقدير للاسترشاد فقط وغير ملزم قانونيًا')}
</div>

<script>window.onload = function(){ window.print(); window.onafterprint = function(){ window.close(); }; }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    // popup blocked — fallback: save HTML (browser download or Tauri dialog)
    const { downloadBlob } = await import('@/lib/platform');
    const blob = new Blob([html], { type: 'text/html' });
    await downloadBlob(`nexyfab-quote-${partName.replace(/\s+/g, '_')}.html`, blob);
    return;
  }
  win.document.write(html);
  win.document.close();
}
