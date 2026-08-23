import { NextRequest, NextResponse } from 'next/server';
import { verifyDoorSwingClearance, type DoorSwingClearanceInput } from '@/lib/assembly/doorSwingClearance';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_DOOR_SWING_VERIFY_BODY_BYTES = 4 * 1024 * 1024;

const finitePoint = (value: unknown): value is { x: number; y: number } => {
  if (!value || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y);
};

function validInput(value: unknown): value is DoorSwingClearanceInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<DoorSwingClearanceInput>;
  const finite = [input.closedAngleDeg, input.openAngleDeg, input.widthMm, input.thicknessMm]
    .every(item => typeof item === 'number' && Number.isFinite(item));
  const clearanceValid = input.requiredClearanceMm === undefined
    || (typeof input.requiredClearanceMm === 'number' && Number.isFinite(input.requiredClearanceMm) && input.requiredClearanceMm >= 0);
  return finitePoint(input.pivot) && finite && (input.widthMm ?? 0) > 0 && (input.thicknessMm ?? 0) > 0
    && clearanceValid && Array.isArray(input.obstacles)
    && input.obstacles.every(obstacle => typeof obstacle?.id === 'string' && obstacle.id.length > 0
      && Array.isArray(obstacle.polygon) && obstacle.polygon.length >= 3 && obstacle.polygon.every(finitePoint));
}

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-door-swing:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many door swing verification requests' }, { status: 429 });
  }
  let body: unknown;
  try { body = await readBoundedJson<unknown>(req, MAX_DOOR_SWING_VERIFY_BODY_BYTES); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: bounded.code }, { status: bounded.status }); body = null; }
  if (!validInput(body)) {
    return NextResponse.json({ ok: false, code: 'INVALID_INPUT', message: 'Finite pivot, angles, positive dimensions, and valid obstacle polygons are required' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, result: verifyDoorSwingClearance(body), quoteOrRfqSideEffects: false });
}
