import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotDynamicLoadEnvelopeBytes } from '@/lib/ai/robot/robotDynamicLoadEnvelope';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';

const MAX_DYNAMIC_INPUT_BYTES = 5_000_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-dynamics-evaluate:${ip}`, 5, 60_000)).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedRawBody(req, MAX_DYNAMIC_INPUT_BYTES);
  } catch (error) {
    const bounded = boundedRawBodyError(error);
    if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  if (bytes.byteLength < 1) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'dynamic load JSON body is required' }, { status: 400 });

  const report = evaluateRobotDynamicLoadEnvelopeBytes(bytes);
  return NextResponse.json({
    ok: report.dynamicsReady,
    report,
    releaseReady: false,
    cadModified: false,
    quoteOrRfqSideEffects: false,
  }, { status: report.dynamicsReady ? 200 : 422 });
}
