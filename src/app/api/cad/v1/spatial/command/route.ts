import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import {
  applySpatialCadCommand,
  type SpatialCadCommand,
  type SpatialCadDocument,
} from '@/lib/cad/spatialCadCommand';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-spatial-command:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  }
  let body: { document?: unknown; command?: unknown } | null = null;
  try { body = await readBoundedJson<{ document?: unknown; command?: unknown }>(req, MAX_BODY_BYTES); }
  catch (cause) {
    if (boundedJsonError(cause)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    return NextResponse.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 });
  }
  if (!body?.document || !body.command) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', issues: ['document_and_command_required'] }, { status: 400 });
  }
  const transaction = applySpatialCadCommand(
    body.document as SpatialCadDocument,
    body.command as SpatialCadCommand,
  );
  return NextResponse.json({
    ok: transaction.committed,
    transaction,
    persistence: 'NOT_RUN',
    releaseVerification: 'NOT_RUN',
    quoteOrRfqSideEffects: false,
  }, {
    status: transaction.committed ? 200 : 409,
    headers: { 'Cache-Control': 'no-store' },
  });
}
