import { NextRequest, NextResponse } from 'next/server';
import { buildRadianceExecutionPlan, calculateAnnualDaylightMetrics, parseAnnualIlluminanceMatrix, parseRtraceRgbIlluminance } from '@/lib/ai/radianceExecution';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body =
  | { kind: 'point_in_time'; sensorCount: number; output?: string }
  | { kind: 'annual'; sensorCount: number; timestepCount: number; timestepHours?: number; output?: string };

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-daylight-results:${ip}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as Body | null;
  if (!body || (body.kind !== 'point_in_time' && body.kind !== 'annual') || !Number.isInteger(body.sensorCount) || body.sensorCount <= 0) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', releaseReady: false }, { status: 400 });
  const plan = buildRadianceExecutionPlan(body.kind);
  if (typeof body.output !== 'string' || !body.output.trim()) return NextResponse.json({ ok: true, status: 'not_run', releaseReady: false, plan, errors: ['radiance_output_missing'], quoteOrRfqSideEffects: false });
  try {
    if (body.kind === 'point_in_time') return NextResponse.json({ ok: true, status: 'pass', releaseReady: false, evidenceAuthority: 'external_unverified', plan, illuminanceLux: parseRtraceRgbIlluminance(body.output, body.sensorCount), quoteOrRfqSideEffects: false });
    if (!Number.isInteger(body.timestepCount) || body.timestepCount <= 0) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', releaseReady: false }, { status: 400 });
    const matrix = parseAnnualIlluminanceMatrix(body.output, body.sensorCount, body.timestepCount);
    return NextResponse.json({ ok: true, status: 'pass', releaseReady: false, evidenceAuthority: 'external_unverified', plan, metrics: calculateAnnualDaylightMetrics(matrix, body.timestepHours), quoteOrRfqSideEffects: false });
  } catch (error) {
    return NextResponse.json({ ok: false, status: 'fail', code: 'INVALID_RADIANCE_RESULT', message: error instanceof Error ? error.message : 'Radiance result verification failed.', releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 });
  }
}
