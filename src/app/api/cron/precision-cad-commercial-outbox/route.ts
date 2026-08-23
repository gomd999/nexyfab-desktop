import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { CommercialExecutionOutboxStore } from '@/lib/precision-cad-agent/commercialExecutionOutboxStore';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
function authorized(req: NextRequest): boolean { const expected = process.env.CRON_SECRET ?? ''; const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''; const a = Buffer.from(expected); const b = Buffer.from(supplied); return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b); }
export async function POST(req: NextRequest) { if (!authorized(req)) return NextResponse.json({ ok: false, code: process.env.CRON_SECRET ? 'FORBIDDEN' : 'CRON_AUTH_NOT_CONFIGURED' }, { status: process.env.CRON_SECRET ? 403 : 503 }); try { const store = new CommercialExecutionOutboxStore(getDbAdapter()); const recovered = await store.recoverExpiredClaims(); return NextResponse.json({ ok: true, code: 'EXTERNAL_WORKER_POLL_REQUIRED', recovered, releaseReady: false }, { status: 200, headers: { 'Cache-Control': 'no-store' } }); } catch (error) { return NextResponse.json({ ok: false, code: String(error).includes('migration_required') ? 'MIGRATION_REQUIRED' : 'OUTBOX_FAILED', releaseReady: false }, { status: 503 }); } }
