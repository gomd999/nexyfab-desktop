import { NextRequest, NextResponse } from 'next/server';
import { verifyEgressRoutes, type EgressRouteInput } from '@/lib/assembly/egressRouteVerification';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const finitePoint = (value: unknown) => !!value && typeof value === 'object' && Number.isFinite((value as { x?: number }).x) && Number.isFinite((value as { y?: number }).y);
function validInput(value: unknown): value is EgressRouteInput {
  if (!value || typeof value !== 'object') return false; const input = value as Partial<EgressRouteInput>;
  return Array.isArray(input.nodes) && input.nodes.length > 0 && input.nodes.every(node => typeof node?.id === 'string' && node.id.length > 0 && finitePoint(node.point))
    && Array.isArray(input.edges) && input.edges.every(edge => typeof edge?.id === 'string' && typeof edge.from === 'string' && typeof edge.to === 'string' && Number.isFinite(edge.clearWidthMm))
    && Array.isArray(input.originNodeIds) && input.originNodeIds.length > 0 && input.originNodeIds.every(id => typeof id === 'string')
    && Array.isArray(input.exitNodeIds) && input.exitNodeIds.length > 0 && input.exitNodeIds.every(id => typeof id === 'string')
    && typeof input.maximumTravelDistanceMm === 'number' && Number.isFinite(input.maximumTravelDistanceMm) && input.maximumTravelDistanceMm > 0
    && typeof input.minimumClearWidthMm === 'number' && Number.isFinite(input.minimumClearWidthMm) && input.minimumClearWidthMm > 0
    && (input.minimumIndependentExits === undefined || (Number.isSafeInteger(input.minimumIndependentExits) && input.minimumIndependentExits > 0));
}
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-egress:${ip}`, 120, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many egress requests' }, { status: 429 });
  const body: unknown = await req.json().catch(() => null);
  if (!validInput(body)) return NextResponse.json({ ok: false, code: 'INVALID_INPUT', message: 'Governed limits and complete route graph evidence are required' }, { status: 400 });
  return NextResponse.json({ ok: true, result: verifyEgressRoutes(body), quoteOrRfqSideEffects: false });
}
