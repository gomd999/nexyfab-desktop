import { NextRequest, NextResponse } from 'next/server';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { handleFeatureTreeMesh } from '@/app/api/feature-tree-mesh/handler';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-tree-mesh:${ip}`, 40, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many mesh requests' }, { status: 429 });
  }
  let body: { tree?: Parameters<typeof handleFeatureTreeMesh>[0] };
  try { body = await readBoundedJson<{ tree?: Parameters<typeof handleFeatureTreeMesh>[0] }>(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'Feature tree request is too large' }, { status: 413 });
    body = {};
  }
  const result = await handleFeatureTreeMesh(body.tree as Parameters<typeof handleFeatureTreeMesh>[0], scad => renderScadToStl({ scadSource: scad, timeoutMs: 30_000 }));
  return NextResponse.json(result.payload, { status: result.status });
}
