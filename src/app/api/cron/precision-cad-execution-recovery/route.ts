import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { DbExecutionJournalStore } from '@/lib/precision-cad-agent/dbExecutionJournalStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim() ?? ''; const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const left = Buffer.from(expected); const right = Buffer.from(supplied);
  return left.length >= 32 && left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, code: process.env.CRON_SECRET ? 'FORBIDDEN' : 'CRON_AUTH_NOT_CONFIGURED' }, { status: process.env.CRON_SECRET ? 403 : 503 });
  const rawLimit = req.nextUrl.searchParams.get('limit'); if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) return NextResponse.json({ ok: false, code: 'INVALID_BATCH_LIMIT' }, { status: 400 });
  try {
    const held = await new DbExecutionJournalStore(getDbAdapter()).recoverExpiredLeases(Date.now(), rawLimit === null ? 100 : Number(rawLimit));
    return NextResponse.json({ ok: true, code: 'PRECISION_CAD_EXECUTION_RECOVERY_COMPLETE', heldCount: held.length, held }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const migration = String(error).includes('migration_required');
    return NextResponse.json({ ok: false, code: migration ? 'MIGRATION_REQUIRED' : 'RECOVERY_FAILED' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
