import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { inspectRadianceReadiness, radianceExecutablePathsFromEnvironment } from '@/lib/ai/radianceLocalExecution';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-daylight-status:${ip}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT', ready: false }, { status: 429 });
  const result = await inspectRadianceReadiness(radianceExecutablePathsFromEnvironment());
  const featuresSha256 = result.features ? createHash('sha256').update(result.features).digest('hex') : undefined;
  return NextResponse.json({ ok: true, status: result.status, ready: result.ready, executables: result.executables, version: result.version, featuresSha256, errors: result.errors, quoteOrRfqSideEffects: false }, { status: result.status === 'fail' ? 503 : 200 });
}
