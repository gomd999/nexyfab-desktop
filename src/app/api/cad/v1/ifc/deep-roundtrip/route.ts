import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { verifyIfcDeepSemanticRoundtrip } from '@/lib/bim/ifcDeepSemanticRoundtrip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_IFC_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 42 * 1024 * 1024;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-ifc-deep-roundtrip:${ip}`, 20, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  const body = await req.json().catch(() => null);
  if (!isRecord(body) || Object.keys(body).some(key => !['beforeIfc', 'afterIfc'].includes(key)) || typeof body.beforeIfc !== 'string' || typeof body.afterIfc !== 'string') {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Inline beforeIfc and afterIfc strings are required; paths, URLs, and weakened release profiles are forbidden.' }, { status: 400 });
  }
  const beforeBytes = Buffer.byteLength(body.beforeIfc, 'utf8');
  const afterBytes = Buffer.byteLength(body.afterIfc, 'utf8');
  if (beforeBytes > MAX_IFC_BYTES || afterBytes > MAX_IFC_BYTES) return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', maxIfcBytes: MAX_IFC_BYTES }, { status: 413 });
  if (!body.beforeIfc.trim() || !body.afterIfc.trim()) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  try {
    const evidence = verifyIfcDeepSemanticRoundtrip(body.beforeIfc, body.afterIfc);
    return NextResponse.json({ ok: true, releaseReady: evidence.passed, evidence, sourceReturned: false, sideEffects: false });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'IFC_DEEP_SEMANTIC_PARSE_FAILED', message: error instanceof Error ? error.message : String(error), sideEffects: false }, { status: 422 });
  }
}
