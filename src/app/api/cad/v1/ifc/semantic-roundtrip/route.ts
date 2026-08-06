import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { verifyIfcSemanticRoundtrip } from '@/lib/reference/ifcSemanticEvidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_IFC_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 42 * 1024 * 1024;
const ALLOWED = new Set(['beforeIfc', 'afterIfc']);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-ifc-semantic-roundtrip:${ip}`, 20, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  const body = await req.json().catch(() => null);
  if (!isRecord(body) || Object.keys(body).some(key => !ALLOWED.has(key)) || typeof body.beforeIfc !== 'string' || typeof body.afterIfc !== 'string') {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Inline beforeIfc and afterIfc strings are required; paths and URLs are forbidden.' }, { status: 400 });
  }
  const beforeBytes = Buffer.byteLength(body.beforeIfc, 'utf8'), afterBytes = Buffer.byteLength(body.afterIfc, 'utf8');
  if (beforeBytes > MAX_IFC_BYTES || afterBytes > MAX_IFC_BYTES) return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', maxIfcBytes: MAX_IFC_BYTES }, { status: 413 });
  if (!body.beforeIfc.trim() || !body.afterIfc.trim()) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Both IFC documents must be non-empty.' }, { status: 400 });
  try {
    const evidence = verifyIfcSemanticRoundtrip(body.beforeIfc, body.afterIfc);
    return NextResponse.json({ ok: true, releaseReady: evidence.passed, evidence, sourceReturned: false, quoteOrRfqSideEffects: false });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'IFC_SEMANTIC_PARSE_FAILED', message: error instanceof Error ? error.message : String(error), quoteOrRfqSideEffects: false }, { status: 422 });
  }
}
