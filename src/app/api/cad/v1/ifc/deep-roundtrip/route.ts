import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { verifyIfcDeepSemanticRoundtrip } from '@/lib/bim/ifcDeepSemanticRoundtrip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { MAX_INLINE_IFC_BYTES, MAX_PAIR_IFC_JSON_BYTES } from '../bodyLimits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-ifc-deep-roundtrip:${ip}`, 20, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  let body: unknown;
  try { body = await readBoundedJson(req, MAX_PAIR_IFC_JSON_BYTES); }
  catch (error) {
    const boundary = boundedJsonError(error);
    if (boundary?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Inline beforeIfc and afterIfc strings are required; paths, URLs, and weakened release profiles are forbidden.' }, { status: 400 });
  }
  if (!isRecord(body) || Object.keys(body).some(key => !['beforeIfc', 'afterIfc'].includes(key)) || typeof body.beforeIfc !== 'string' || typeof body.afterIfc !== 'string') {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Inline beforeIfc and afterIfc strings are required; paths, URLs, and weakened release profiles are forbidden.' }, { status: 400 });
  }
  const beforeBytes = Buffer.byteLength(body.beforeIfc, 'utf8');
  const afterBytes = Buffer.byteLength(body.afterIfc, 'utf8');
  if (beforeBytes > MAX_INLINE_IFC_BYTES || afterBytes > MAX_INLINE_IFC_BYTES) return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', maxIfcBytes: MAX_INLINE_IFC_BYTES }, { status: 413 });
  if (!body.beforeIfc.trim() || !body.afterIfc.trim()) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  try {
    const evidence = verifyIfcDeepSemanticRoundtrip(body.beforeIfc, body.afterIfc);
    return NextResponse.json({ ok: true, roundtripPassed: evidence.passed, releaseReady: false, releaseBlocker: 'SIGNED_INDEPENDENT_RELEASE_EVIDENCE_REQUIRED', evidence, sourceReturned: false, sideEffects: false });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'IFC_DEEP_SEMANTIC_PARSE_FAILED', message: error instanceof Error ? error.message : String(error), sideEffects: false }, { status: 422 });
  }
}
