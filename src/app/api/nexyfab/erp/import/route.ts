import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import ExcelJS from 'exceljs';

export const dynamic = 'force-dynamic';

const ALLOWED_PLANS = ['team', 'enterprise'];
const MAX_ROWS = 500;

// Column aliases: canonical name → accepted header variants (case-insensitive)
const COLUMN_MAP: Record<string, string[]> = {
  part_name: ['part_name', 'partname', '부품명', 'item', 'item_name', 'description', '품명'],
  quantity:  ['quantity', 'qty', '수량', 'amount'],
  material:  ['material', '재질', '소재', 'material_id'],
  note:      ['note', 'remark', '비고', 'memo', 'notes', 'comment'],
  due_date:  ['due_date', 'deadline', '납기', '납기일', 'delivery_date'],
};

function resolveHeaders(headers: string[]): Record<string, number> {
  const lower = headers.map(h => h.toLowerCase().trim());
  const map: Record<string, number> = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_MAP)) {
    for (const alias of aliases) {
      const idx = lower.indexOf(alias);
      if (idx !== -1) { map[canonical] = idx; break; }
    }
  }
  return map;
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some((v) => v.length > 0)) rows.push(row);
  return rows;
}

async function parseSpreadsheetRows(name: string, buffer: Buffer): Promise<string[][]> {
  if (name.endsWith('.csv')) {
    return parseCsvRows(buffer.toString('utf8'));
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (excelRow) => {
    const values = excelRow.values as ExcelJS.CellValue[];
    rows.push(values.slice(1).map((value) => value == null ? '' : String(value)));
  });
  return rows;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_PLANS.includes(authUser.plan)) {
    return NextResponse.json({ error: 'Pro 플랜 이상에서 사용 가능합니다.' }, { status: 403 });
  }

  let formData: FormData;
  try { formData = await req.formData(); } catch {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file field required' }, { status: 400 });

  const name = file.name.toLowerCase();
  if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
    return NextResponse.json({ error: 'CSV 또는 XLSX 파일만 지원합니다.' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let rows: string[][];
  try {
    rows = await parseSpreadsheetRows(name, buffer);
  } catch {
    return NextResponse.json({ error: '파일 파싱 실패: 올바른 CSV/XLSX 형식인지 확인하세요.' }, { status: 400 });
  }

  if (rows.length < 2) return NextResponse.json({ error: '헤더 포함 최소 2행 필요' }, { status: 400 });

  const headers = (rows[0] ?? []).map(String);
  const colIdx = resolveHeaders(headers);

  if (colIdx.part_name === undefined) {
    return NextResponse.json({
      error: '부품명 컬럼을 찾을 수 없습니다.',
      hint: '헤더에 part_name, 부품명, item 중 하나가 필요합니다.',
      detectedHeaders: headers,
    }, { status: 400 });
  }

  const dataRows = rows.slice(1, MAX_ROWS + 1);
  const db = getDbAdapter();
  const now = Date.now();
  const created: string[] = [];
  const errors: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row) continue;
    const partName = String(row[colIdx.part_name!] ?? '').trim();
    if (!partName) continue; // skip blank rows

    const qty = colIdx.quantity !== undefined ? parseInt(String(row[colIdx.quantity] ?? '1'), 10) : 1;
    const material = colIdx.material !== undefined ? String(row[colIdx.material] ?? '').trim() : null;
    const note = colIdx.note !== undefined ? String(row[colIdx.note] ?? '').trim() : null;
    const dueDateRaw = colIdx.due_date !== undefined ? String(row[colIdx.due_date] ?? '').trim() : null;

    try {
      const id = `rfq-erp-${crypto.randomUUID()}`;
      await db.execute(
        `INSERT INTO nf_rfqs (id, user_id, shape_name, material_id, quantity, note, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        id, authUser.userId,
        partName,
        material || null,
        isNaN(qty) || qty < 1 ? 1 : qty,
        [note, dueDateRaw ? `납기: ${dueDateRaw}` : null].filter(Boolean).join(' / ') || null,
        now, now,
      );
      created.push(id);
    } catch (err) {
      errors.push({ row: i + 2, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Log sync event
  await db.execute(
    `INSERT OR IGNORE INTO nf_erp_sync_log (id, user_id, direction, format, record_count, status, created_at)
     VALUES (?, ?, 'import', ?, ?, ?, ?)`,
    `erp-${crypto.randomUUID()}`, authUser.userId,
    name.endsWith('.csv') ? 'csv' : 'excel',
    created.length, errors.length > 0 ? 'partial' : 'ok', now,
  ).catch(() => {});

  return NextResponse.json({
    imported: created.length,
    skipped: errors.length,
    errors: errors.slice(0, 20),
    rfqIds: created,
  }, { status: 201 });
}
