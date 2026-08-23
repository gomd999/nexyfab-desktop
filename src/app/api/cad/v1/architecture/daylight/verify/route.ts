import { NextRequest, NextResponse } from 'next/server';
import { calculateWindowSunAccess, gateDaylightRelease, type DaylightCriteria, type DaylightSimulationEvidence, type DaylightWindow, type SolarObstacle } from '@/lib/ai/solarDaylight';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getTrustedClientIp } from '@/lib/client-ip'; import { rateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const MAX_DAYLIGHT_VERIFY_BODY_BYTES = 8 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers); if (!rateLimit(`cad-v1-daylight-verify:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  type Body = { latitudeDeg?: number; longitudeDeg?: number; instants?: string[]; windows?: DaylightWindow[]; obstacles?: SolarObstacle[]; annualEvidence?: DaylightSimulationEvidence; criteria?: DaylightCriteria };
  let body: Body | null;
  try { body = await readBoundedJson<Body>(req, MAX_DAYLIGHT_VERIFY_BODY_BYTES); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: bounded.code }, { status: bounded.status }); body = null; }
  if (!body || body.latitudeDeg === undefined || body.longitudeDeg === undefined || !Array.isArray(body.instants) || !Array.isArray(body.windows) || !Array.isArray(body.obstacles)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  try {
    const sunAccess = calculateWindowSunAccess(body.latitudeDeg, body.longitudeDeg, body.instants.map(value => new Date(value)), body.windows, body.obstacles);
    const annual = gateDaylightRelease(body.annualEvidence, body.criteria);
    const verificationPassed = annual.status === 'passed';
    return NextResponse.json({
      ok: true,
      verificationPassed,
      // Caller-provided annual evidence and local geometry checks do not constitute a commercial release.
      releaseReady: false,
      releaseBlocker: 'SIGNED_INDEPENDENT_RELEASE_EVIDENCE_REQUIRED',
      sunAccess,
      annual,
      quoteOrRfqSideEffects: false,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'INVALID_DAYLIGHT_INPUT', message: error instanceof Error ? error.message : 'Daylight verification failed.', releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 });
  }
}
