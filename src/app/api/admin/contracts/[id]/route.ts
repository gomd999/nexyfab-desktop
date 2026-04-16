/**
 * PATCH  /api/admin/contracts/[id]  — 계약 상태/필드 수정
 * DELETE /api/admin/contracts/[id]  — 계약 삭제
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const db = getDbAdapter();

  const existing = await db.queryOne<{ id: string }>('SELECT id FROM nf_contracts WHERE id = ?', id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;
  const now = new Date().toISOString();

  const allowed = [
    'status', 'factory_name', 'partner_email', 'deadline', 'contract_amount',
    'commission_rate', 'commission_status', 'progress_percent', 'progress_notes',
    'plan', 'customer_email', 'customer_contact',
  ];

  const setClauses: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  for (const key of allowed) {
    if (key in body) {
      setClauses.push(`${key} = ?`);
      values.push(body[key]);
    }
  }

  // completed_at 자동 설정
  if (body.status === 'completed' && !('completed_at' in body)) {
    setClauses.push('completed_at = ?');
    values.push(now);
  }

  values.push(id);
  const sql = `UPDATE nf_contracts SET ${setClauses.join(', ')} WHERE id = ?`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.execute as (sql: string, ...p: any[]) => Promise<{ changes: number }>)(sql, ...values);

  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_contracts WHERE id = ?', id);
  return NextResponse.json({ contract: row });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const db = getDbAdapter();

  const existing = await db.queryOne<{ id: string }>('SELECT id FROM nf_contracts WHERE id = ?', id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.execute('DELETE FROM nf_contracts WHERE id = ?', id);
  return NextResponse.json({ ok: true });
}
