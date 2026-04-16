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

function t(lang: string, ko: string, en: string) { return lang === 'ko' ? ko : en; }

function confidenceLabel(c: 'high' | 'medium' | 'low', lang: string) {
  if (lang === 'ko') return c === 'high' ? '높음' : c === 'medium' ? '보통' : '낮음';
  return c.charAt(0).toUpperCase() + c.slice(1);
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
    <h3>${t(lang, '판금 벤드 테이블', 'Sheet Metal Bend Table')}</h3>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>${t(lang, '각도', 'Angle')}</th>
          <th>${t(lang, '내경', 'Inner R')}</th>
          <th>${t(lang, '방향', 'Dir.')}</th>
          <th>${t(lang, '벤드 허용량', 'Bend Allow.')}</th>
          <th>K-factor</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="dim">${t(lang,
      `전개 치수: ${fp.width.toFixed(2)} × ${fp.length.toFixed(2)} mm | 두께: ${fp.thickness.toFixed(2)} mm`,
      `Flat blank: ${fp.width.toFixed(2)} × ${fp.length.toFixed(2)} mm | Thickness: ${fp.thickness.toFixed(2)} mm`,
    )}</p>
  `;
}

function buildEstimatesTable(estimates: CostEstimate[], lang: string): string {
  const rows = estimates.map(e => `
    <tr>
      <td><strong>${getProcessName(e.process, lang)}</strong></td>
      <td>${formatCost(e.materialCost, e.currency)}</td>
      <td>${formatCost(e.machineCost, e.currency)}</td>
      <td>${formatCost(e.setupCost, e.currency)}</td>
      <td class="cost">${formatCost(e.unitCost, e.currency)}</td>
      <td class="cost total">${formatCost(e.totalCost, e.currency)}</td>
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
          <th>${t(lang, '공정', 'Process')}</th>
          <th>${t(lang, '재료비', 'Material')}</th>
          <th>${t(lang, '가공비', 'Machine')}</th>
          <th>${t(lang, '셋업', 'Setup')}</th>
          <th>${t(lang, '단가', 'Unit')}</th>
          <th>${t(lang, '합계', 'Total')}</th>
          <th>${t(lang, '납기', 'Lead')}</th>
          <th>${t(lang, '신뢰도', 'Conf.')}</th>
          <th>${t(lang, '난이도', 'Diff.')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function printQuote(data: QuoteData, lang: string): void {
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const partName = data.partName || t(lang, '무제 부품', 'Unnamed Part');
  const companyName = data.companyName || 'NexyFab';
  const bb = data.metrics.boundingBox;

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>${t(lang, '견적서', 'Quotation')} — ${partName}</title>
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
    <p style="font-size:12px;font-weight:700;color:#374151;margin-top:4px;">${t(lang, '제조 견적서', 'Manufacturing Quotation')}</p>
  </div>
  <div class="meta">
    <div>${t(lang, '발행일', 'Date')}: ${dateStr}</div>
    <div>${t(lang, '부품명', 'Part')}: <strong>${partName}</strong></div>
    <div>${t(lang, '수량', 'Qty')}: <strong>${data.quantity.toLocaleString()}</strong></div>
    <div>${t(lang, '재질', 'Material')}: <strong>${data.materialId}</strong></div>
  </div>
</div>

<h2>${t(lang, '형상 정보', 'Geometry Summary')}</h2>
<div class="grid2">
  <div class="card">
    <div class="label">${t(lang, '체적', 'Volume')}</div>
    <div class="value">${data.metrics.volume_cm3.toFixed(2)} cm³</div>
  </div>
  <div class="card">
    <div class="label">${t(lang, '표면적', 'Surface Area')}</div>
    <div class="value">${data.metrics.surfaceArea_cm2.toFixed(1)} cm²</div>
  </div>
  <div class="card">
    <div class="label">${t(lang, '외형 크기', 'Bounding Box')}</div>
    <div class="value" style="font-size:11px">${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} × ${bb.d.toFixed(1)} mm</div>
  </div>
  <div class="card">
    <div class="label">${t(lang, '복잡도', 'Complexity')}</div>
    <div class="value">${(data.metrics.complexity * 100).toFixed(0)}%</div>
  </div>
</div>

<h2>${t(lang, '공정별 비용 견적', 'Process Cost Estimates')}</h2>
${buildEstimatesTable(data.estimates, lang)}
<p class="dim">${t(lang,
  '* 자동 산출 견적입니다. 정식 발주 전 공식 견적서를 재발행 받으시기 바랍니다.',
  '* Automated estimate only. Please request a formal requote before placing an order.',
)}</p>

${data.flatPattern ? `<h2>${t(lang, '판금 공정 상세', 'Sheet Metal Detail')}</h2>${buildBendTable(data.flatPattern, lang)}` : ''}

<div class="footer">
  <strong>${companyName}</strong>${t(lang, ' — NexyFab 플랫폼으로 생성된 견적', ' — Generated by NexyFab platform')}
  &nbsp;|&nbsp; ${t(lang, '본 견적은 참고용이며 법적 구속력이 없습니다', 'This estimate is for reference only and has no legal binding force')}
</div>

<script>window.onload = function(){ window.print(); window.onafterprint = function(){ window.close(); }; }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    // popup blocked — fallback: Blob download
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexyfab-quote-${partName.replace(/\s+/g, '_')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    return;
  }
  win.document.write(html);
  win.document.close();
}
