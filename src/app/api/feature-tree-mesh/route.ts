import { NextRequest, NextResponse } from 'next/server';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { handleFeatureTreeMesh } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`feature-tree-mesh:${ip}`, 40, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many mesh requests' }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const result = await handleFeatureTreeMesh(body.tree, scad => renderScadToStl({ scadSource: scad, timeoutMs: 30_000 }));
  return NextResponse.json(result.payload, { status: result.status });
}
