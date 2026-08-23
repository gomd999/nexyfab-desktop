import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { segmentsToDxf, segmentsToSvg } from '@/lib/papercraft/netDxf';
import { unfoldMesh } from '@/lib/papercraft/unfoldMesh';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

// Match the generic API proxy ceiling. JSON decoding and number arrays remain
// in-memory, so larger meshes must be uploaded as binary worker artifacts.
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_MESH_SCALARS = 1_000_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generic 3D mesh → papercraft net. The modeler POSTs the active geometry's
 * vertex positions (+ optional index) and gets back a laser-ready DXF/SVG with
 * CUT / FOLD / TAB layers — the "unfold any imported model" path (gap 1),
 * complementing papercraft-net's parametric building/room generator.
 */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`papercraft-unfold:${ip}`, 30, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT' }, { status: 429 });
  }
  let b: { positions?: number[]; indices?: number[] | null; tab?: number; thickness?: number } = {};
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
    res = unfoldMesh(positions, indices, {
      tab: typeof b.tab === 'number' ? b.tab : 5,
      thickness: typeof b.thickness === 'number' ? b.thickness : 0,
    });
  } catch (e) {
    return NextResponse.json({ error: `unfold failed: ${(e as Error).message}`, code: 'UNFOLD_ERROR' }, { status: 500 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: res.reason ?? 'could not unfold this mesh', code: 'UNFOLD_REJECT', faceCount: res.faceCount }, { status: 422 });
  }

  const counts = { CUT: 0, FOLD: 0, TAB: 0 } as Record<string, number>;
  for (const s of res.segs) counts[s.layer] = (counts[s.layer] ?? 0) + 1;
  const dxf = segmentsToDxf(res.segs);
  const svg = segmentsToSvg(res.segs);
  return NextResponse.json({
    ok: true,
    faceCount: res.faceCount,
    pieces: res.pieces,                // separate net pieces (overlaps split into islands)
    overlaps: res.overlaps,            // residual after resolution (should be ~0)
    layers: counts,
    bytes: Buffer.byteLength(dxf, 'utf8'),
    svg,
    dxf,
  });
}
