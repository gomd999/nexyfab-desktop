import { type NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { readAiPrecisionBridgeOperationalSnapshot } from '@/lib/ai/aiDesignPrecisionBridgeOperations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function json(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req).catch(() => false))) return json(403, { ok: false, code: 'FORBIDDEN' });
  try {
    const snapshot = await readAiPrecisionBridgeOperationalSnapshot({ db: getDbAdapter() });
    return json(200, { ok: true, ...snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI_PRECISION_OPERATIONS_UNAVAILABLE';
    return json(503, {
      ok: false,
      code: message.includes('MIGRATION') ? 'AI_PRECISION_MIGRATION_REQUIRED' : 'AI_PRECISION_OPERATIONS_UNAVAILABLE',
      manufacturingReleaseReady: false,
    });
  }
}
