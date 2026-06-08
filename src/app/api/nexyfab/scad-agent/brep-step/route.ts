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

import { NextRequest, NextResponse } from 'next/server';
import { getShape, exportOcctStep } from '../../../../[lang]/shape-generator/features/occtEngine';
import { getAuthUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Auth required — STEP is the user's design output.
  const auth = await getAuthUser(req as unknown as NextRequest);
  if (!auth) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const handle = url.searchParams.get('handle');
  if (!handle) {
    return NextResponse.json({ ok: false, error: 'handle query param required' }, { status: 400 });
  }

  // Distinguish "unknown handle" (404) from "known but not STEP-exportable" (422)
  // so the client can message precisely — mirrors brep-mesh's contract.
  if (!getShape(handle)) {
    return NextResponse.json({ ok: false, error: `unknown handle ${handle}` }, { status: 404 });
  }

  try {
    const step = await exportOcctStep(handle);
    if (!step) {
      return NextResponse.json(
        { ok: false, error: `handle ${handle} is not STEP-exportable (no B-rep)` },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, handle, step, bytes: step.length });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `STEP export failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
