import ExcelJS from 'exceljs';

export type TabularRow = Record<string, unknown>;

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function csvEscape(value: unknown): string {
  const s = cellToString(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: TabularRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(',')),
  ];
  return lines.join('\r\n');
}

export async function sheetsToXlsxBuffer(
  sheets: Array<{ name: string; rows: TabularRow[] }>,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NexyFab';
  workbook.created = new Date();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31) || 'Sheet');
    const headers = sheet.rows.length > 0 ? Object.keys(sheet.rows[0]) : [];
    worksheet.columns = headers.map((header) => ({ header, key: header }));
    worksheet.addRows(sheet.rows);
  }

  return await workbook.xlsx.writeBuffer();
}
