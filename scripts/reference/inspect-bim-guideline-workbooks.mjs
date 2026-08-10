import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.name.toLowerCase().endsWith('.xlsx')) files.push(fullPath);
  }
  return files;
}

function cellValue(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
  if (typeof value === 'object' && 'formula' in value) return { formula: value.formula, result: value.result ?? null };
  if (typeof value === 'object' && 'text' in value) return value.text;
  return String(value);
}

export async function inspectBimGuidelineWorkbooks(root) {
  const files = await walk(root), workbooks = [];
  for (const file of files.sort()) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    workbooks.push({
      path: path.relative(root, file),
      worksheets: workbook.worksheets.map(worksheet => {
        const samples = [];
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (samples.length >= 12) return;
          const values = [];
          for (let column = 1; column <= Math.min(worksheet.columnCount, 30); column++) values.push(cellValue(row.getCell(column)));
          if (values.some(value => value !== null && value !== '')) samples.push({ row: rowNumber, values });
        });
        return { name: worksheet.name, rowCount: worksheet.rowCount, columnCount: worksheet.columnCount, samples };
      }),
    });
  }
  return { schema: 'nexyfab.bim-guideline-workbook-inspection.v1', generatedAt: new Date().toISOString(), sourcePolicy: { readOnly: true }, workbookCount: workbooks.length, workbooks };
}

function argValue(args, name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
const args = process.argv.slice(2), root = argValue(args, '--root'), out = argValue(args, '--out');
if (!root || !out) throw new Error('usage: node scripts/reference/inspect-bim-guideline-workbooks.mjs --root <directory> --out <report.json>');
const report = await inspectBimGuidelineWorkbooks(path.resolve(root));
await mkdir(path.dirname(path.resolve(out)), { recursive: true });
await writeFile(path.resolve(out), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ workbookCount: report.workbookCount, worksheets: report.workbooks.reduce((sum, workbook) => sum + workbook.worksheets.length, 0) })}\n`);
