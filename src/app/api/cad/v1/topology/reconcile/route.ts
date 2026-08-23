import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { handleTopologyReconcile } from './handler';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-topology:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many topology requests' }, { status: 429 });
  }
  let body: Parameters<typeof handleTopologyReconcile>[0];
  try { body = await readBoundedJson<Parameters<typeof handleTopologyReconcile>[0]>(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'Topology request is too large' }, { status: 413 });
    body = {};
  }
  const result = handleTopologyReconcile(body);
  return NextResponse.json(result.payload, { status: result.status });
}
