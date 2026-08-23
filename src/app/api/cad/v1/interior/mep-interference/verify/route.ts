import { NextRequest, NextResponse } from 'next/server';
import { verifyMepInterference, type MepInterferenceInput } from '@/lib/assembly/mepInterferenceVerification';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getTrustedClientIp } from '@/lib/client-ip'; import { rateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const MAX_MEP_INTERFERENCE_VERIFY_BODY_BYTES = 4 * 1024 * 1024;
const point = (value: unknown) => !!value && typeof value === 'object' && Number.isFinite((value as { x?: number }).x) && Number.isFinite((value as { y?: number }).y) && Number.isFinite((value as { z?: number }).z);
function validInput(value: unknown): value is MepInterferenceInput {
  if (!value || typeof value !== 'object') return false; const input = value as Partial<MepInterferenceInput>;
  return Array.isArray(input.runs) && input.runs.every(run => typeof run?.id === 'string' && typeof run.system === 'string' && Array.isArray(run.centerline) && run.centerline.every(point) && Number.isFinite(run.outerDiameterMm))
    && Array.isArray(input.obstacles) && input.obstacles.every(obstacle => typeof obstacle?.id === 'string' && point(obstacle.min) && point(obstacle.max))
    && (input.defaultClearanceMm === undefined || (typeof input.defaultClearanceMm === 'number' && Number.isFinite(input.defaultClearanceMm) && input.defaultClearanceMm >= 0));
}
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers); if (!rateLimit(`cad-v1-mep-interference:${ip}`, 120, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many MEP interference requests' }, { status: 429 });
  let body: unknown;
  try { body = await readBoundedJson<unknown>(req, MAX_MEP_INTERFERENCE_VERIFY_BODY_BYTES); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: bounded.code }, { status: bounded.status }); body = null; }
  if (!validInput(body)) return NextResponse.json({ ok: false, code: 'INVALID_INPUT', message: 'MEP runs and obstacles must contain finite geometry' }, { status: 400 });
  return NextResponse.json({ ok: true, result: verifyMepInterference(body), quoteOrRfqSideEffects: false });
}
