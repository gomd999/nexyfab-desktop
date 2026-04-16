/**
 * PATCH  /api/admin/factories/[id]  — 제조사 수정
 * DELETE /api/admin/factories/[id]  — 제조사 삭제
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const db = getDbAdapter();

  const existing = await db.queryOne<{ id: string }>('SELECT id FROM nf_factories WHERE id = ?', id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;
  const now = Date.now();

  const allowed = [
    'name', 'name_ko', 'region', 'min_lead_time', 'max_lead_time',
    'rating', 'price_level', 'description', 'description_ko',
    'contact_email', 'contact_phone', 'website', 'status',
  ];

  const setClauses: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  for (const key of allowed) {
    if (key in body) {
      setClauses.push(`${key} = ?`);
      values.push(body[key]);
    }
  }

  // JSON-stringify array fields
  if ('processes' in body && Array.isArray(body.processes)) {
    setClauses.push('processes = ?');
    values.push(JSON.stringify(body.processes));
  }
  if ('certifications' in body && Array.isArray(body.certifications)) {
    setClauses.push('certifications = ?');
    values.push(JSON.stringify(body.certifications));
  }

  values.push(id);
  const sql = `UPDATE nf_factories SET ${setClauses.join(', ')} WHERE id = ?`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.execute as (sql: string, ...p: any[]) => Promise<{ changes: number }>)(sql, ...values);

  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_factories WHERE id = ?', id);
  if (row) {
    row.processes = JSON.parse(row.processes as string || '[]');
    row.certifications = JSON.parse(row.certifications as string || '[]');
  }

  return NextResponse.json({ factory: row });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const db = getDbAdapter();

  const existing = await db.queryOne<{ id: string }>('SELECT id FROM nf_factories WHERE id = ?', id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.execute('DELETE FROM nf_factories WHERE id = ?', id);
  return NextResponse.json({ ok: true });
}
