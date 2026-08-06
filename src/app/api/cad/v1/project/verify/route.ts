import { NextRequest, NextResponse } from 'next/server';
import { verifyCrossDomainDesign, type CrossDomainVerificationInput } from '@/lib/ai/crossDomainVerification';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-project-verify:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many project verification requests' }, { status: 429 });
  }
  const body = await req.json().catch(() => null) as CrossDomainVerificationInput | null;
  if (!body || typeof body !== 'object' || !body.structure || !body.placement) {
    return NextResponse.json({ ok: false, code: 'INVALID_INPUT', message: 'structure and placement evidence are required' }, { status: 400 });
  }
  const numeric = [body.placement.required, body.placement.resolved, body.placement.invalid];
  if (numeric.some(value => !Number.isSafeInteger(value) || value < 0) || body.placement.resolved > body.placement.required) {
    return NextResponse.json({ ok: false, code: 'INVALID_PLACEMENT_COUNTS', message: 'placement counts must be non-negative integers and resolved <= required' }, { status: 400 });
  }
  const result = verifyCrossDomainDesign(body);
  return NextResponse.json({ ok: true, ...result, quoteOrRfqSideEffects: false });
}
