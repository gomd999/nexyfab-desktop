import { NextRequest, NextResponse } from 'next/server';
import { evaluateManufacturingGates, type ManufacturingGateInput } from '@/lib/ai/manufacturingGates';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read-only, fail-closed manufacturing evidence evaluation. No quote/RFQ/release side effects. */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-manufacturing-verify:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many manufacturing verification requests' }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as ManufacturingGateInput | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: 'INVALID_EVIDENCE', message: 'A manufacturing evidence object is required' }, { status: 400 });
  }
  const report = evaluateManufacturingGates(body);
  return NextResponse.json({
    ok: true,
    report,
    designOk: report.passed,
    sideEffects: { quoteCreated: false, rfqCreated: false, artifactReleased: false },
  });
}
