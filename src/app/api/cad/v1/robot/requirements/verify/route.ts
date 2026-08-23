import { NextRequest, NextResponse } from 'next/server';
import { verifyRobotSystemRequirementsBytes } from '@/lib/ai/robot/robotSystemRequirements';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';

const MAX_REQUIREMENTS_BYTES = 1_000_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-requirements-verify:${ip}`, 20, 60_000)).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedRawBody(req, MAX_REQUIREMENTS_BYTES);
  } catch (error) {
    const bounded = boundedRawBodyError(error);
    if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  if (bytes.byteLength < 1) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'requirements JSON body is required' }, { status: 400 });

  const report = verifyRobotSystemRequirementsBytes(bytes);
  return NextResponse.json({
    ok: report.requirementsReady,
    report,
    requirementsFrozen: report.requirementsReady,
    releaseReady: false,
    cadModified: false,
    quoteOrRfqSideEffects: false,
  }, { status: report.requirementsReady ? 200 : 422 });
}
