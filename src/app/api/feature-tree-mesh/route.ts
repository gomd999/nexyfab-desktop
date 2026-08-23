import { NextRequest, NextResponse } from 'next/server';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { handleFeatureTreeMesh } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`feature-tree-mesh:${ip}`, 40, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many mesh requests' }, { status: 429 });
  }
  let body: { tree?: unknown } = {};
  try { body = await readBoundedJson<{ tree?: unknown }>(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: `Body exceeds ${MAX_BODY_BYTES} bytes` }, { status: 413 });
  }
  const result = await handleFeatureTreeMesh(body.tree as FeatureTree, scad => renderScadToStl({ scadSource: scad, timeoutMs: 30_000 }));
  return NextResponse.json(result.payload, { status: result.status });
}
