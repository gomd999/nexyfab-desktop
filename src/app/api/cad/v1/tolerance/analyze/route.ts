import { NextRequest, NextResponse } from 'next/server';
import { computeStackup, type ToleranceDimension } from '@/app/[lang]/shape-generator/analysis/toleranceStackup';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
const MAX_BODY_BYTES = 1024 * 1024;
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-tolerance:${ip}`, 120, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  let body: { dimensions?: ToleranceDimension[]; lowerSpec?: number; upperSpec?: number } | null;
  try { body = await readBoundedJson(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    body = null;
  }
  if (!Array.isArray(body?.dimensions) || body.dimensions.length === 0 || body.dimensions.length > 1000) return NextResponse.json({ ok: false, code: 'INVALID_TOLERANCE_CHAIN' }, { status: 400 });
  const invalid = body.dimensions.find(d => !d.id || !Number.isFinite(d.nominal) || !Number.isFinite(d.tolerancePlus) || !Number.isFinite(d.toleranceMinus) || ![1, -1].includes(d.direction));
  if (invalid) return NextResponse.json({ ok: false, code: 'INVALID_TOLERANCE_DIMENSION', id: invalid.id }, { status: 422 });
  const result = computeStackup(body.dimensions);
  const specChecked = Number.isFinite(body.lowerSpec) && Number.isFinite(body.upperSpec);
  const worstCasePass = !specChecked || (result.worstCaseMin >= body.lowerSpec! && result.worstCaseMax <= body.upperSpec!);
  const rssPass = !specChecked || (result.rssMin >= body.lowerSpec! && result.rssMax <= body.upperSpec!);
  return NextResponse.json({ ok: true, result, specification: { checked: specChecked, lower: body.lowerSpec ?? null, upper: body.upperSpec ?? null, worstCasePass, rssPass }, designOk: specChecked && worstCasePass, assumptions: ['RSS assumes independent dimension variation; worst-case is the release criterion.'] });
}
