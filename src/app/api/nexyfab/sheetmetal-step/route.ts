import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sheet-metal Phase 1 — the FOLDED part as a real analytic B-rep STEP. A base
 * plate + one box per flange, each translated to its edge and rotated up by the
 * bend angle, fused into one solid. This makes a sheet-metal part a first-class
 * CAD part: it re-opens in the modeler (via STEP import), feeds FEA/DFM/quote —
 * not just a flat DXF. Own replicad init with explicit wasm path (see
 * cad-feature-step for the why).
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

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
interface Flange { edge: 'front' | 'back' | 'left' | 'right'; height: number; angle?: number }

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`sheetmetal-step:${ip}`, 30, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT' }, { status: 429 });
  }
  const b = (await req.json().catch(() => ({}))) as {
    width?: number; length?: number; thickness?: number; bendRadius?: number; flanges?: Flange[];
  };
  const W = Math.min(Math.max(10, num(b.width, 100)), 2000);
  const L = Math.min(Math.max(10, num(b.length, 60)), 2000);
  const T = Math.min(Math.max(0.3, num(b.thickness, 2)), 20);
  const flanges = (Array.isArray(b.flanges) ? b.flanges : [{ edge: 'back' as const, height: 30 }])
    .filter(f => ['front', 'back', 'left', 'right'].includes(f.edge)).slice(0, 4);

  try {
    const replicad = await getReplicad();
    // Base plate: makeBaseBox is centred in X/Y, bottom at z=0 → z∈[0,T].
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let solid: any = replicad.makeBaseBox(W, L, T);

    for (const f of flanges) {
      const angle = Math.min(Math.max(1, num(f.angle, 90)), 179);
      const H = Math.min(Math.max(2, num(f.height, 30)), 1000);
      // Build the flange flat (extending outward from the base edge), then rotate
      // it up about that edge by the bend angle and fuse. Rotation pivots on the
      // bottom of the base edge so the bend corner overlaps the base → clean fuse.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let fl: any;
      if (f.edge === 'back') {
        fl = replicad.makeBaseBox(W, H, T).translate([0, L / 2 + H / 2, 0]).rotate(angle, [0, L / 2, 0], [1, 0, 0]);
      } else if (f.edge === 'front') {
        fl = replicad.makeBaseBox(W, H, T).translate([0, -L / 2 - H / 2, 0]).rotate(-angle, [0, -L / 2, 0], [1, 0, 0]);
      } else if (f.edge === 'right') {
        fl = replicad.makeBaseBox(H, L, T).translate([W / 2 + H / 2, 0, 0]).rotate(-angle, [W / 2, 0, 0], [0, 1, 0]);
      } else {
        fl = replicad.makeBaseBox(H, L, T).translate([-W / 2 - H / 2, 0, 0]).rotate(angle, [-W / 2, 0, 0], [0, 1, 0]);
      }
      try { solid = solid.fuse(fl); } catch { /* skip a flange that won't fuse */ }
    }

    const step: string = await solid.blobSTEP().text();
    if (!step.includes('MANIFOLD_SOLID_BREP') || !step.includes('ADVANCED_FACE')) {
      return NextResponse.json({ error: 'empty solid', code: 'DEGENERATE' }, { status: 422 });
    }
    return new NextResponse(step, {
      status: 200,
      headers: {
        'Content-Type': 'application/step',
        'Content-Disposition': 'attachment; filename="nexyfab-sheetmetal.step"',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'build failed' }, { status: 500 });
  }
}
