import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Real STEP → tessellated mesh via replicad (the OCCT kernel already vendored
 * for cad-feature-step). The legacy /brep/step-import path needs an external
 * BREP_WORKER_URL tessellation service that isn't deployed (503 "Tessellation
 * not configured"), and the K-series importer is a stub that only round-trips
 * its own extrude/revolve output. This reads ANY AP203/AP214 B-rep STEP
 * (planar + B-spline + toroidal faces) and returns a mesh the modeler imports.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let replicadReady: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReplicad(): Promise<any> {
  if (!replicadReady) {
    replicadReady = (async () => {
      const ocModule = await import('replicad-opencascadejs/src/replicad_single.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const factory = (ocModule as any).default;
      const wasmPath = [
        join(process.cwd(), 'public', 'replicad_single.wasm'),
        join(process.cwd(), 'node_modules', 'replicad-opencascadejs', 'src', 'replicad_single.wasm'),
      ].find(c => { try { return existsSync(c); } catch { return false; } });
      const oc = await factory(wasmPath ? { locateFile: (p: string) => (p.endsWith('.wasm') ? wasmPath : p) } : undefined);
      const replicad = await import('replicad');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      replicad.setOC(oc as any);
      return replicad;
    })().catch((e) => { replicadReady = null; throw e; });
  }
  return replicadReady;
}

const MAX_BYTES = 15 * 1024 * 1024;
// Match the generic API proxy ceiling. The synchronous OCCT path still
// materializes JSON text, Blob and kernel state together; larger STEP files
// use the objectKey/direct-upload BREP route instead.
const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const body = (await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => ({}))) as { stepText?: string; tolerance?: number };
  const stepText = typeof body.stepText === 'string' ? body.stepText : '';
  if (!stepText || !stepText.includes('ISO-10303-21')) {
    return NextResponse.json({ error: 'not a STEP file' }, { status: 400 });
  }
  if (stepText.length > MAX_BYTES) {
    return NextResponse.json({ error: 'STEP too large', code: 'TOO_LARGE' }, { status: 413 });
  }
  try {
    const replicad = await getReplicad();
    const tol = typeof body.tolerance === 'number' && body.tolerance > 0 ? body.tolerance : 0.1;
    // importSTEP wants a Blob; group fuses multi-solid files into one shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let shape: any = await replicad.importSTEP(new Blob([stepText]));
    if (Array.isArray(shape)) {
      shape = shape.reduce((acc: unknown, s: unknown) => (acc ? (acc as { fuse: (o: unknown) => unknown }).fuse(s) : s), null);
    }
    if (!shape || typeof shape.mesh !== 'function') {
      return NextResponse.json({ error: 'no solid in STEP' }, { status: 422 });
    }
    const mesh = shape.mesh({ tolerance: tol, angularTolerance: 0.5 });
    const positions: number[] = mesh.vertices ?? mesh.positions ?? [];
    const triangles: number[] = mesh.triangles ?? mesh.indices ?? [];
    if (!positions.length || !triangles.length) {
      return NextResponse.json({ error: 'empty mesh' }, { status: 422 });
    }
    let volume: number | null = null;
    try { volume = typeof shape.volume === 'number' ? shape.volume : null; } catch { /* optional */ }
    return NextResponse.json({
      ok: true,
      positions,
      triangles,
      triangleCount: triangles.length / 3,
      vertexCount: positions.length / 3,
      volumeMm3: volume,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'STEP import failed' }, { status: 500 });
  }
}
