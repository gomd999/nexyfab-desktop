import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Own replicad init with an explicit wasm path. The shared `ensureOcctReady`
 * lets emscripten resolve the wasm relative to its .js, which works in tests
 * but NOT in the bundled Next.js server (the .js lives in .next/chunks, the
 * wasm doesn't). prebuild copies replicad_single.wasm into public/, which the
 * Dockerfile ships to the runner, so point locateFile straight at it.
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

/**
 * Precise feature program → TRUE analytic B-rep STEP, built with replicad (the
 * same OCCT kernel the modeler uses). Unlike the mesh→AP203 fallback, this emits
 * a real parametric solid (planar + cylindrical faces), so it re-opens cleanly
 * in SolidWorks / Fusion / Onshape. The chat still PREVIEWS via OpenSCAD/WASM;
 * this runs on demand when the user exports STEP.
 *
 * Coverage: rectangular/circular base, through-holes (incl. circular/linear
 * patterns), ribs (fused fins), all-edge fillet/chamfer (best-effort). Shells
 * are skipped (returned in `skipped`).
 */
interface Feat {
  id?: string; type?: string; shape?: string;
  width?: number; depth?: number; height?: number; length?: number; alongY?: boolean;
  diameter?: number; posX?: number; posY?: number;
  feature?: string; count?: number; pcd?: number; spacing?: number; axis?: string;
  radius?: number; distance?: number;
}
const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);

export async function POST(req: NextRequest) {
  // Building a real B-rep runs OCCT server-side (a few CPU-seconds); this route
  // is unauthenticated, so cap it per IP to prevent abuse. Export is
  // user-initiated, so a modest hourly budget is plenty.
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-feature-step:${ip}`, 30, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many STEP exports — try again shortly.', code: 'RATE_LIMIT' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { features?: Feat[]; part?: string };
  const feats = Array.isArray(body.features) ? body.features : [];
  const base = feats.find(f => f.type === 'sketchExtrude');
  if (!base) return NextResponse.json({ error: 'no base feature' }, { status: 400 });

  try {
    const replicad = await getReplicad();
    const skipped: string[] = [];

    const h = num(base.height, 8);
    // Base solid (replicad makeBaseBox is centred in X/Y; holes use the same
    // centred coordinates, matching the program's posX/posY).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let solid: any = base.shape === 'circle'
      ? replicad.makeCylinder(num(base.width, 50) / 2, h)
      : replicad.makeBaseBox(num(base.width, 100), num(base.depth, 80), h);

    const cutHole = (dia: number, x: number, y: number) => {
      // Generous through-cut covering either z-centring convention.
      const cyl = replicad.makeCylinder(dia / 2, h + 10, [x, y, -5], [0, 0, 1]);
      solid = solid.cut(cyl);
    };

    for (const f of feats) {
      if (f.type !== 'hole') continue;
      const pat = feats.find(p => (p.type === 'circularPattern' || p.type === 'linearPattern') && p.feature === f.id);
      const dia = num(f.diameter, 6);
      if (pat?.type === 'circularPattern') {
        const cnt = Math.max(2, Math.round(num(pat.count, 4)));
        const r = num(pat.pcd, 60) / 2;
        for (let i = 0; i < cnt; i++) { const a = (i / cnt) * 2 * Math.PI; cutHole(dia, Math.cos(a) * r, Math.sin(a) * r); }
      } else if (pat?.type === 'linearPattern') {
        const cnt = Math.max(2, Math.round(num(pat.count, 3)));
        const sp = num(pat.spacing, 20);
        for (let i = 0; i < cnt; i++) {
          const off = (i - (cnt - 1) / 2) * sp;
          cutHole(dia, num(f.posX, 0) + (pat.axis === 'y' ? 0 : off), num(f.posY, 0) + (pat.axis === 'y' ? off : 0));
        }
      } else {
        cutHole(dia, num(f.posX, 0), num(f.posY, 0));
      }
    }

    // Ribs: vertical fins fused onto the base (makeBaseBox sits bottom at z=0,
    // matching the base). alongY runs the rib along Y, else along X.
    for (const f of feats) {
      if (f.type !== 'rib') continue;
      try {
        const t = num(f.width, 8), rh = num(f.height, 40), L = num(f.length, num(base.depth, 80));
        const rib = replicad.makeBaseBox(f.alongY ? t : L, f.alongY ? L : t, rh).translate([num(f.posX, 0), num(f.posY, 0), 0]);
        solid = solid.fuse(rib);
      } catch { skipped.push('rib'); }
    }

    for (const f of feats) {
      if (f.type === 'shell') { skipped.push('shell'); continue; }
      try {
        if (f.type === 'fillet') solid = solid.fillet(num(f.radius, 3));
        else if (f.type === 'chamfer') solid = solid.chamfer(num(f.distance, 1));
      } catch { skipped.push(f.type ?? 'edge-op'); }
    }

    const step: string = await solid.blobSTEP().text();
    // A degenerate program (e.g. a hole wider than the body) can cut everything
    // away — replicad still emits a valid-but-EMPTY STEP. Reject it so the studio
    // falls back to the mesh STEP, which keeps whatever the preview shows.
    if (!step.includes('MANIFOLD_SOLID_BREP') || !step.includes('ADVANCED_FACE')) {
      return NextResponse.json({ error: 'empty solid', code: 'DEGENERATE' }, { status: 422 });
    }
    return new NextResponse(step, {
      status: 200,
      headers: {
        'Content-Type': 'application/step',
        'Content-Disposition': `attachment; filename="${(body.part ?? 'nexyfab-part').replace(/[^\w.-]/g, '_')}.step"`,
        'X-Skipped': skipped.join(',') || 'none',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'STEP build failed' }, { status: 500 });
  }
}
