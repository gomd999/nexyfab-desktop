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

// Security: this registry is process-local; replica/restart/load-balancing
// invalidates handles. Long-running Railway alone is not production
// authority, so this legacy path stays capability-gated until durable
// artifact hydration replaces it.
import { NextRequest, NextResponse } from 'next/server';
import { getShape } from '../../../../[lang]/shape-generator/features/occtEngine';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyBrepHandleAccessToken } from '@/lib/ai/scad-agent/brepHandleAccessToken';

interface MeshShape {
  mesh?: (opts?: { tolerance?: number; angularTolerance?: number }) => {
    vertices: number[];
    triangles: number[];
  };
  boundingBox?: () => { min: [number, number, number]; max: [number, number, number] };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(req: Request) {
  // P2 — auth required (mesh data is the user's design output)
  const auth = await getAuthUser(req as unknown as NextRequest);
  if (!auth) return json({ ok: false, error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  const handle = url.searchParams.get('handle');
  if (!handle) {
    return json({ ok: false, error: 'handle query param required' }, 400);
  }
  const accessToken = req.headers.get('x-nexyfab-brep-capability');
  if (!verifyBrepHandleAccessToken({ token: accessToken, userId: auth.userId, handle })) {
    return json({ ok: false, status: 'HOLD', releaseReady: false, error: 'short-lived BRep handle capability required' }, 403);
  }

  const shape = getShape(handle) as MeshShape | null;
  if (!shape) {
    return json({ ok: false, error: `unknown handle ${handle}` }, 404);
  }
  if (typeof shape.mesh !== 'function') {
    return json({ ok: false, error: `handle ${handle} is not tessellatable` }, 422);
  }

  try {
    const tolerance = parseFloat(url.searchParams.get('tolerance') ?? '0.1');
    const m = shape.mesh({ tolerance, angularTolerance: 0.2 });
    let bbox: { min: [number, number, number]; max: [number, number, number] } | null = null;
    if (typeof shape.boundingBox === 'function') {
      try { bbox = shape.boundingBox(); } catch { bbox = null; }
    }
    return json({
      ok: true,
      handle,
      vertices: m.vertices,
      triangles: m.triangles,
      bbox,
    });
  } catch (e) {
    return json(
      { ok: false, error: `tessellation failed: ${(e as Error).message}` },
      500,
    );
  }
}
