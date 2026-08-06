import { NextRequest, NextResponse } from 'next/server';
import { calculateWindowSunAccess, gateDaylightRelease, type DaylightCriteria, type DaylightSimulationEvidence, type DaylightWindow, type SolarObstacle } from '@/lib/ai/solarDaylight';
import { getTrustedClientIp } from '@/lib/client-ip'; import { rateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers); if (!rateLimit(`cad-v1-daylight-verify:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as { latitudeDeg?: number; longitudeDeg?: number; instants?: string[]; windows?: DaylightWindow[]; obstacles?: SolarObstacle[]; annualEvidence?: DaylightSimulationEvidence; criteria?: DaylightCriteria } | null;
  if (!body || body.latitudeDeg === undefined || body.longitudeDeg === undefined || !Array.isArray(body.instants) || !Array.isArray(body.windows) || !Array.isArray(body.obstacles)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  try { const sunAccess = calculateWindowSunAccess(body.latitudeDeg, body.longitudeDeg, body.instants.map(value => new Date(value)), body.windows, body.obstacles), annual = gateDaylightRelease(body.annualEvidence, body.criteria); return NextResponse.json({ ok: true, releaseReady: annual.status === 'passed', sunAccess, annual, quoteOrRfqSideEffects: false }); } catch (error) { return NextResponse.json({ ok: false, code: 'INVALID_DAYLIGHT_INPUT', message: error instanceof Error ? error.message : 'Daylight verification failed.', releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 }); }
}
