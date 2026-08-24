import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getTrustedClientIp } from '@/lib/client-ip';
import { evaluateDomainProduct } from '@/lib/cad/domainProductService';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_PRODUCT_QUALIFICATION_BODY_BYTES = 32 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-product-qualification:${ip}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  let body: unknown;
  try { body = await readBoundedJson(req, MAX_PRODUCT_QUALIFICATION_BODY_BYTES); }
  catch (error) {
    const bounded = boundedJsonError(error);
    if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: bounded.code }, { status: bounded.status });
    return NextResponse.json({ ok: false, code: 'BAD_JSON', commercialReleaseReady: false, quoteOrRfqSideEffects: false }, { status: 400 });
  }
  const evaluation = evaluateDomainProduct(body);
  const status = evaluation.status === 'FAIL' ? 422 : 200;
  return NextResponse.json({
    ok: evaluation.status !== 'FAIL',
    evaluation,
    commercialReleaseReady: false,
    releaseBlocker: 'GOVERNED_EXTERNAL_QUALIFICATION_REQUIRED',
    quoteOrRfqSideEffects: false,
  }, { status });
}
