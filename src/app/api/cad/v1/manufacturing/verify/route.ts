import { NextRequest, NextResponse } from 'next/server';
import { evaluateManufacturingGates, type ManufacturingGateInput } from '@/lib/ai/manufacturingGates';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 1024 * 1024;

/** Read-only, fail-closed manufacturing evidence evaluation. No quote/RFQ/release side effects. */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-manufacturing-verify:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many manufacturing verification requests' }, { status: 429 });
  }
  let body: ManufacturingGateInput | null;
  try { body = await readBoundedJson<ManufacturingGateInput>(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Manufacturing evidence request is too large' }, { status: 413 });
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: 'INVALID_EVIDENCE', message: 'A manufacturing evidence object is required' }, { status: 400 });
  }
  const report = evaluateManufacturingGates(body);
  return NextResponse.json({
    ok: true,
    report,
    reportedGatePass: report.passed,
    designOk: false,
    releaseReady: false,
    authoritative: false,
    trustBoundary: 'client_asserted_preview',
    blockers: ['SERVER_DERIVED_MANUFACTURING_EVIDENCE_REQUIRED'],
    sideEffects: { quoteCreated: false, rfqCreated: false, artifactReleased: false },
  });
}
