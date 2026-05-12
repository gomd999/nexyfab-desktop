/**
 * W6 — On-demand B-rep mesh fetch for the SCAD agent panel.
 *
 * The agent's `brep_to_mesh` tool only emits triangleCount/bbox so the
 * model context stays slim. When the user clicks "Show in canvas" on a
 * B-rep result, the panel hits this endpoint to pull the actual
 * vertices+triangles for the live OCCT handle and render them.
 *
 * Handles live in the same Node.js process as the agent (replicad WASM
 * registry is module-scoped), so this endpoint must run on the same
 * server. Cloudflare/serverless deployments would lose the registry
 * between requests — Railway long-running process is required, which
 * matches NexyFab's deploy topology.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getShape } from '../../../../[lang]/shape-generator/features/occtEngine';
import { getAuthUser } from '@/lib/auth-middleware';

interface MeshShape {
  mesh?: (opts?: { tolerance?: number; angularTolerance?: number }) => {
    vertices: number[];
    triangles: number[];
  };
  boundingBox?: () => { min: [number, number, number]; max: [number, number, number] };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // P2 — auth required (mesh data is the user's design output)
  const auth = await getAuthUser(req as unknown as NextRequest);
  if (!auth) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const handle = url.searchParams.get('handle');
  if (!handle) {
    return NextResponse.json({ ok: false, error: 'handle query param required' }, { status: 400 });
  }

  const shape = getShape(handle) as MeshShape | null;
  if (!shape) {
    return NextResponse.json({ ok: false, error: `unknown handle ${handle}` }, { status: 404 });
  }
  if (typeof shape.mesh !== 'function') {
    return NextResponse.json({ ok: false, error: `handle ${handle} is not tessellatable` }, { status: 422 });
  }

  try {
    const tolerance = parseFloat(url.searchParams.get('tolerance') ?? '0.1');
    const m = shape.mesh({ tolerance, angularTolerance: 0.2 });
    let bbox: { min: [number, number, number]; max: [number, number, number] } | null = null;
    if (typeof shape.boundingBox === 'function') {
      try { bbox = shape.boundingBox(); } catch { bbox = null; }
    }
    return NextResponse.json({
      ok: true,
      handle,
      vertices: m.vertices,
      triangles: m.triangles,
      bbox,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `tessellation failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
