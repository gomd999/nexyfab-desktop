import { NextRequest, NextResponse } from 'next/server';
import { planMepPenetrationSleeves, routeMepOrthogonal3d, type MepRouteRequest, type PenetrationHost } from '@/lib/ai/mepRouting3d';
import { routeGravityDrain } from '@/lib/ai/gravityDrainRouting';
import { planOrthogonalMepFittings, serviceOpeningsFromSleeves } from '@/lib/ai/mepFabricationPlanning';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-mep-route:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as { request?: MepRouteRequest; drainRules?: { minimumSlopePercent: number; maximumSlopePercent: number }; fitting?: { diameterMm: number; bendRadiusMm: number }; penetration?: { outsideDiameterMm: number; radialClearanceMm: number; hosts: PenetrationHost[]; sleeveWallThicknessMm?: number; firestopAnnulusMm?: number } } | null;
  if (!body?.request) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'request is required' }, { status: 400 });
  try {
    const route = body.request.system === 'drain' && body.drainRules ? routeGravityDrain({ id: body.request.id, startMm: body.request.startMm, endMm: body.request.endMm, gridMm: body.request.gridMm, clearanceMm: body.request.clearanceMm, obstacles: body.request.obstacles, maxVisitedNodes: body.request.maxVisitedNodes, ...body.drainRules }) : routeMepOrthogonal3d(body.request);
    const fittings = route.status === 'routed' && body.fitting ? planOrthogonalMepFittings(route.pathMm, body.fitting.diameterMm, body.fitting.bendRadiusMm) : { status: 'not_run' as const, elbows: [], failures: [] };
    const penetrations = route.status === 'routed' && body.penetration ? planMepPenetrationSleeves(body.request.id, route.pathMm, body.penetration.outsideDiameterMm, body.penetration.radialClearanceMm, body.penetration.hosts) : { status: 'not_run' as const, sleeves: [], blockers: [] };
    const serviceOpenings = penetrations.status === 'passed' && body.penetration?.sleeveWallThicknessMm !== undefined ? serviceOpeningsFromSleeves(penetrations.sleeves, body.penetration.sleeveWallThicknessMm, body.penetration.firestopAnnulusMm ?? 0) : [];
    const releaseReady = route.status === 'routed' && (!body.fitting || fittings.status === 'passed') && (!body.penetration || penetrations.status === 'passed');
    return NextResponse.json({ ok: true, releaseReady, route, fittings, penetrations, serviceOpenings, quoteOrRfqSideEffects: false });
  } catch (error) { return NextResponse.json({ ok: false, code: 'INVALID_MEP_ROUTE', message: error instanceof Error ? error.message : 'MEP routing failed.', releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 }); }
}
