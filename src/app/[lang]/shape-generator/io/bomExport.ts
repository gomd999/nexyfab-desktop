import { downloadBlob } from '@/lib/platform';

// ─── BOM Export (CSV & Excel) ────────────────────────────────────────────────

export interface BomRow {
  no: number;
  name: string;
  shape: string;
  material: string;
  dimensions: string; // "W×H×D mm"
  volume_cm3: number;
  surface_area_cm2: number;
  weight_g: number; // estimated from volume * material density
  quantity: number;
}

/** Material densities in g/cm³ */
export const MATERIAL_DENSITY: Record<string, number> = {
  aluminum: 2.7,
  steel: 7.85,
  titanium: 4.43,
  abs: 1.04,
  nylon: 1.14,
};

/** Estimate weight in grams from volume (cm³) and material key */
export function estimateWeight(volume_cm3: number, material: string): number {
  const density = MATERIAL_DENSITY[material.toLowerCase()] ?? 2.7; // default aluminum
  return volume_cm3 * density;
}

// ── Helpers ──

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

// ── CSV Export ──

const CSV_HEADERS = ['No', 'Name', 'Shape', 'Material', 'Dimensions', 'Volume (cm³)', 'Surface Area (cm²)', 'Weight (g)', 'Qty'];

export function buildBomCSVString(rows: BomRow[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    lines.push([
      r.no,
      escapeCSV(r.name),
      escapeCSV(r.shape),
      escapeCSV(r.material),
      escapeCSV(r.dimensions),
      r.volume_cm3.toFixed(2),
      r.surface_area_cm2.toFixed(2),
      r.weight_g.toFixed(2),
      r.quantity,
    ].join(','));
  }
  return lines.join('\r\n');
}

export async function exportBomCSV(rows: BomRow[], filename?: string): Promise<void> {
  const csvStr = buildBomCSVString(rows);
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvStr], { type: 'text/csv;charset=utf-8' });
  await downloadBlob(filename || 'BOM_export.csv', blob);
}

// ── Excel Export (HTML table → .xls, opens in Excel/Calc) ──

export async function exportBomExcel(rows: BomRow[], filename?: string): Promise<void> {
  const header = CSV_HEADERS.map(h => `<th style="background:#333;color:#fff;padding:6px 12px;font-weight:bold;border:1px solid #555">${h}</th>`).join('');
  const body = rows.map(r => {
    const cells = [
      r.no,
      r.name,
      r.shape,
      r.material,
      r.dimensions,
      r.volume_cm3.toFixed(2),
      r.surface_area_cm2.toFixed(2),
      r.weight_g.toFixed(2),
      r.quantity,
    ].map(v => `<td style="padding:4px 10px;border:1px solid #ddd">${v}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/></head>
<body>
<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px">
  <thead><tr>${header}</tr></thead>
  <tbody>${body}</tbody>
</table>
</body></html>`.trim();

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  await downloadBlob(filename || 'BOM_export.xls', blob);
}
