import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { parseWebVitalPayload } from '@/lib/webVitals';

const MAX_BODY_BYTES = 2_048;

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  const ip = getTrustedClientIp(request.headers);
  if (!rateLimit(`rum-web-vitals:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { raw = null; }
  const metric = parseWebVitalPayload(raw);
  if (!metric) return NextResponse.json({ ok: false, code: 'BAD_METRIC' }, { status: 400 });

  // Deliberately anonymous: no request URL, query, user/session identifier or IP
  // is written to the audit sink. The normalized route is safe for p75 grouping.
  logAudit({
    userId: 'anonymous-rum',
    action: 'rum.web_vital',
    resourceId: metric.route,
    metadata: { ...metric },
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
