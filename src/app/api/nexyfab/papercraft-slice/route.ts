import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { segmentsToDxf, segmentsToSvg } from '@/lib/papercraft/netDxf';
import { sliceMesh } from '@/lib/papercraft/sliceMesh';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

// Match the generic API proxy ceiling. JSON decoding and number arrays remain
// in-memory, so larger meshes must be uploaded as binary worker artifacts.
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_MESH_SCALARS = 2_000_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generic mesh → stacked-layer (foam board / 우드락) papercraft. The modeler
 * POSTs the active geometry's vertex positions (+ optional index); we cross-
 * section it into N horizontal slabs and return a laser-ready DXF/SVG of all
 * slab outlines laid out in a grid. Unlike unfold this works for curved /
 * high-poly imports — cut N outlines, stack to the model's height.
 */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`papercraft-slice:${ip}`, 30, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT' }, { status: 429 });
  }
  let b: { positions?: number[]; indices?: number[] | null; thickness?: number; layers?: number } = {};
  try { b = await readBoundedJson(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'geometry too large', code: 'TOO_LARGE' }, { status: 413 });
  }
  const positions = Array.isArray(b.positions) ? b.positions : null;
  if (!positions || positions.length < 9) {
    return NextResponse.json({ error: 'positions (flat [x,y,z,…], ≥1 triangle) required', code: 'NO_GEOMETRY' }, { status: 400 });
  }
  if (positions.length + (Array.isArray(b.indices) ? b.indices.length : 0) > MAX_MESH_SCALARS) {
    return NextResponse.json({ error: 'geometry too large', code: 'TOO_LARGE' }, { status: 413 });
  }
  const indices = Array.isArray(b.indices) && b.indices.length >= 3 ? b.indices : null;

  let res;
  try {
    res = sliceMesh(positions, indices, {
      thickness: typeof b.thickness === 'number' ? b.thickness : 0,
      layers: typeof b.layers === 'number' ? b.layers : undefined,
    });
  } catch (e) {
    return NextResponse.json({ error: `slice failed: ${(e as Error).message}`, code: 'SLICE_ERROR' }, { status: 500 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: res.reason ?? 'could not slice this mesh', code: 'SLICE_REJECT' }, { status: 422 });
  }

  const dxf = segmentsToDxf(res.segs);
  const svg = segmentsToSvg(res.segs);
  return NextResponse.json({
    ok: true,
    layerCount: res.layerCount,
    zSamples: res.zSamples,
    layers: { CUT: res.segs.length },
    bytes: Buffer.byteLength(dxf, 'utf8'),
    svg,
    dxf,
  });
}
