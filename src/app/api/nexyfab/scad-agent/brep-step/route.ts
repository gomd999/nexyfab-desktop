/**
 * brep-step — lossless STEP export of a live agent B-rep handle.
 *
 * Companion to `brep-mesh`. When the user ADOPTS an agent B-rep result into the
 * modeler, the browser only receives a tessellated mesh (see brep-mesh) — the
 * exact B-rep stays in the server's module-scoped replicad registry. This
 * endpoint exports that still-live handle to STEP so an adopted body can be
 * round-tripped to manufacturing CAD WITHOUT the browser re-mesh, preserving the
 * real B-rep lineage the agent built.
 *
 * Same registry constraint as brep-mesh: handles live in the agent's Node.js
 * process, so this must run on the long-running Railway server (not serverless).
 */

// Security: this registry is process-local; replica/restart/load-balancing
// invalidates handles. Long-running Railway alone is not production
// authority, so this legacy path stays capability-gated until durable
// artifact hydration replaces it.
import { NextRequest, NextResponse } from 'next/server';
import { getShape, exportOcctStep } from '../../../../[lang]/shape-generator/features/occtEngine';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyBrepHandleAccessToken } from '@/lib/ai/scad-agent/brepHandleAccessToken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(req: Request) {
  // Auth required — STEP is the user's design output.
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

  // Distinguish "unknown handle" (404) from "known but not STEP-exportable" (422)
  // so the client can message precisely — mirrors brep-mesh's contract.
  if (!getShape(handle)) {
    return json({ ok: false, error: `unknown handle ${handle}` }, 404);
  }

  try {
    const step = await exportOcctStep(handle);
    if (!step) {
      return json(
        { ok: false, error: `handle ${handle} is not STEP-exportable (no B-rep)` },
        422,
      );
    }
    return json({ ok: true, handle, step, bytes: step.length });
  } catch (e) {
    return json(
      { ok: false, error: `STEP export failed: ${(e as Error).message}` },
      500,
    );
  }
}
