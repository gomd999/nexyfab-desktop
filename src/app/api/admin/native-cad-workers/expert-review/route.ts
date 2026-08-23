import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { parseTrustedReviewerKeys, summarizeTrustedReviewerRegistry, type NativeCadExpertReview } from '@/lib/reference/nativeCadExpertReview';
import { validateNativeCadExpertReviewPacket, type NativeCadExpertReviewPacket } from '@/lib/reference/nativeCadExpertReviewPacket';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 512 * 1024;

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req).catch(() => false))) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  if (!(await rateLimitAsync(`admin-native-cad-review-readiness:${getTrustedClientIp(req.headers)}`, 30, 60_000)).allowed) return NextResponse.json({ ok: false, error: 'Rate limit exceeded' }, { status: 429 });
  return NextResponse.json({ ok: true, registry: summarizeTrustedReviewerRegistry(parseTrustedReviewerKeys()), exposesReviewerIdentity: false, exposesPublicKeys: false });
}

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req).catch(() => false))) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  if (!(await rateLimitAsync(`admin-native-cad-review:${getTrustedClientIp(req.headers)}`, 20, 60_000)).allowed) return NextResponse.json({ ok: false, error: 'Rate limit exceeded' }, { status: 429 });
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedRawBody(req, MAX_BODY_BYTES);
  } catch (error) {
    const bounded = boundedRawBodyError(error);
    if (bounded?.status === 413) return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  let body: { packet?: NativeCadExpertReviewPacket; review?: NativeCadExpertReview };
  try { body = JSON.parse(text) as typeof body; } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const trustedKeys = parseTrustedReviewerKeys();
  const result = validateNativeCadExpertReviewPacket(body.packet!, body.review, trustedKeys);
  return NextResponse.json({
    ok: true,
    validation: {
      schema: 'nexyfab.native-cad-expert-review-validation.v1',
      generatedAt: new Date().toISOString(),
      targetHash: result.targetHash || null,
      trustedReviewerKeyCount: Object.keys(trustedKeys).length,
      approved: result.approved,
      errors: result.errors,
    },
    releaseSideEffects: false,
  });
}
