import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import {
  cleanupExpiredAssemblyDrawingHandoffs,
  countExpiredAssemblyDrawingHandoffs,
  ensureAssemblyDrawingHandoffTable,
  isAssemblyDrawingHandoffStorageConfigured,
} from '@/lib/cad/assemblyDrawingHandoffStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 500;

function authorizeMaintenance(req: NextRequest): 'OK' | 'NOT_CONFIGURED' | 'FORBIDDEN' {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || expected.length < 32) return 'NOT_CONFIGURED';
  const authorization = req.headers.get('authorization') ?? '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right) ? 'OK' : 'FORBIDDEN';
}

export async function POST(req: NextRequest) {
  const authorization = authorizeMaintenance(req);
  if (authorization === 'NOT_CONFIGURED') {
    return NextResponse.json({ ok: false, code: 'CRON_AUTH_NOT_CONFIGURED' }, { status: 503 });
  }
  if (authorization !== 'OK') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }
  if (!isAssemblyDrawingHandoffStorageConfigured()) {
    return NextResponse.json({ ok: false, code: 'HANDOFF_STORAGE_NOT_CONFIGURED' }, { status: 503 });
  }

  const rawLimit = req.nextUrl.searchParams.get('limit');
  const limit = rawLimit === null ? DEFAULT_BATCH_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_LIMIT) {
    return NextResponse.json({ ok: false, code: 'INVALID_BATCH_LIMIT' }, { status: 400 });
  }

  const db = getDbAdapter();
  await ensureAssemblyDrawingHandoffTable(db);
  const cutoff = Date.now();
  const removed = await cleanupExpiredAssemblyDrawingHandoffs(db, cutoff, limit);
  const remainingExpired = await countExpiredAssemblyDrawingHandoffs(db, cutoff);
  return NextResponse.json({
    ok: true,
    code: 'HANDOFF_EXPIRY_CLEANUP_COMPLETE',
    cutoff,
    batchLimit: limit,
    removed,
    remainingExpired,
    hasMore: remainingExpired > 0,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
