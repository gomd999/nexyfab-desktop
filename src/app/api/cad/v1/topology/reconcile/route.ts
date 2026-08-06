import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { handleTopologyReconcile } from './handler';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-topology:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many topology requests' }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const result = handleTopologyReconcile(body);
  return NextResponse.json(result.payload, { status: result.status });
}
