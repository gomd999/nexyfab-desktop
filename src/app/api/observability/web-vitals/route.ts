import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { parseWebVitalPayload } from '@/lib/webVitals';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';

const MAX_BODY_BYTES = 2_048;

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    await request.body?.cancel('declared payload too large').catch(() => undefined);
    return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  const ip = getTrustedClientIp(request.headers);
  if (!rateLimit(`rum-web-vitals:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedRawBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedRawBodyError(error)?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    return NextResponse.json({ ok: false, code: 'BAD_METRIC' }, { status: 400 });
  }
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { raw = null; }
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
