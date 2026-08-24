import { randomBytes, timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { runNextAiDesignPrecisionExactJob } from '@/lib/ai/aiDesignPrecisionExactWorker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim() ?? '';
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length >= 32 && left.length === right.length && timingSafeEqual(left, right);
}

function json(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return json(process.env.CRON_SECRET ? 403 : 503, {
    ok: false, code: process.env.CRON_SECRET ? 'FORBIDDEN' : 'CRON_AUTH_NOT_CONFIGURED',
    manufacturingReleaseReady: false,
  });
  if (process.env.NEXYFAB_COMMERCIAL_MODE !== '1') return json(503, {
    ok: false, code: 'AI_PRECISION_COMMERCIAL_MODE_REQUIRED', manufacturingReleaseReady: false,
  });
  if (!process.env.S3_BUCKET?.trim() || !process.env.OBJECT_STORAGE_PRIVATE_BUCKET?.trim()) return json(503, {
    ok: false, code: 'AI_PRECISION_PRIVATE_OBJECT_STORAGE_REQUIRED', manufacturingReleaseReady: false,
  });
  const signingSecret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '';
  if (Buffer.byteLength(signingSecret, 'utf8') < 32) return json(503, {
    ok: false, code: 'AI_PRECISION_SIGNING_SECRET_REQUIRED', manufacturingReleaseReady: false,
  });
  const configuredLease = Number(process.env.AI_PRECISION_WORKER_LEASE_MS ?? 10 * 60_000);
  const leaseMs = Number.isSafeInteger(configuredLease) && configuredLease >= 1_000
    && configuredLease <= 15 * 60_000 ? configuredLease : 10 * 60_000;
  try {
    const result = await runNextAiDesignPrecisionExactJob({
      workerId: 'ai-precision-cron', leaseCapability: randomBytes(32).toString('hex'),
      leaseMs, signingSecret,
      signingKeyId: process.env.AI_PRECISION_SIGNING_KEY_ID?.trim() || 'precision-cad-v1',
    }, { db: getDbAdapter() });
    if (!result.ok) return json(503, { ...result, manufacturingReleaseReady: false });
    return json(result.status === 'HOLD' ? 202 : 200, {
      ...result, exactExecution: result.status === 'COMPLETED' && result.verification === 'PASS',
      manufacturingReleaseReady: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI_PRECISION_EXACT_WORKER_FAILED';
    return json(503, {
      ok: false,
      code: message.includes('MIGRATION') ? 'AI_PRECISION_MIGRATION_REQUIRED' : message,
      manufacturingReleaseReady: false,
    });
  }
}
