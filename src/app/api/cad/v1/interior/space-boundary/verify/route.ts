import { NextRequest, NextResponse } from 'next/server';
import { verifySpaceBoundaryClosure, type SpaceBoundaryClosureInput } from '@/lib/assembly/spaceBoundaryClosure';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_SPACE_BOUNDARY_VERIFY_BODY_BYTES = 4 * 1024 * 1024;

const finitePoint = (value: unknown): value is { x: number; y: number } => {
  if (!value || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y);
};
function validInput(value: unknown): value is SpaceBoundaryClosureInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<SpaceBoundaryClosureInput>;
  const optional = [input.snapToleranceMm, input.minimumAreaMm2].every(item => item === undefined || (typeof item === 'number' && Number.isFinite(item) && item >= 0));
  return optional && Array.isArray(input.segments) && input.segments.length >= 3
    && input.segments.every(segment => typeof segment?.id === 'string' && segment.id.length > 0 && finitePoint(segment.start) && finitePoint(segment.end));
}
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-space-boundary:${ip}`, 120, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many space boundary requests' }, { status: 429 });
  let body: unknown;
  try { body = await readBoundedJson<unknown>(req, MAX_SPACE_BOUNDARY_VERIFY_BODY_BYTES); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: bounded.code }, { status: bounded.status }); body = null; }
  if (!validInput(body)) return NextResponse.json({ ok: false, code: 'INVALID_INPUT', message: 'At least three finite boundary segments are required' }, { status: 400 });
  return NextResponse.json({ ok: true, result: verifySpaceBoundaryClosure(body), quoteOrRfqSideEffects: false });
}
