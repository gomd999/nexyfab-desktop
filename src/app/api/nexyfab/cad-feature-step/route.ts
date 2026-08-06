import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { expectedAnalyticFeatureSignature, validateCadFeatureProgram, type CadFeatureProgram } from '@/lib/ai/cadFeatureProgram';
import { evaluateManufacturingGates } from '@/lib/ai/manufacturingGates';
import { compareStepRoundtrip, type BrepMeasurement } from '@/lib/ai/stepRoundtripVerification';
import { evaluateProgramDfm } from '@/lib/ai/manufacturingContext';
import { createHash } from 'node:crypto';

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
 * patterns), ribs (fused fins), shells (hollow, open top/bottom), all-edge
 * fillet/chamfer (best-effort).
 */
const requiredNum = (v: unknown, field: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Missing validated dimension: ${field}`);
  return v;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function measureBrep(replicad: any, shape: any): BrepMeasurement {
  const bbox = shape.boundingBox;
  const solidCount = typeof shape?._listTopo === 'function' ? shape._listTopo('solid').length : 0;
  return {
    shapeType: shape?.constructor?.name ?? 'Unknown',
    isNull: shape?.isNull === true,
    bbox: { width: bbox.width, height: bbox.height, depth: bbox.depth },
    volumeMm3: replicad.measureVolume(shape.asShape3D()),
    faceCount: Array.isArray(shape.faces) ? shape.faces.length : 0,
    solidCount,
  };
}

export async function POST(req: NextRequest) {
  // Building a real B-rep runs OCCT server-side (a few CPU-seconds); this route
  // is unauthenticated, so cap it per IP to prevent abuse. Export is
  // user-initiated, so a modest hourly budget is plenty.
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-feature-step:${ip}`, 30, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many STEP exports — try again shortly.', code: 'RATE_LIMIT' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as CadFeatureProgram;
  const validation = validateCadFeatureProgram(body);
  if (!validation.ok) {
    return NextResponse.json({ error: 'invalid feature program', code: 'FEATURE_PROGRAM_INVALID', details: validation.errors }, { status: 422 });
  }
  const feats = Array.isArray(body.features) ? body.features : [];
  const base = feats.find(f => f.type === 'sketchExtrude');
  if (!base) return NextResponse.json({ error: 'no base feature' }, { status: 400 });

  try {
    const replicad = await getReplicad();
    const skipped: string[] = [];

    const h = requiredNum(base.height, 'base.height');
    // Base solid (replicad makeBaseBox is centred in X/Y; holes use the same
    // centred coordinates, matching the program's posX/posY).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let solid: any = base.shape === 'circle'
      ? replicad.makeCylinder(requiredNum(base.width, 'base.width') / 2, h)
      : replicad.makeBaseBox(requiredNum(base.width, 'base.width'), requiredNum(base.depth, 'base.depth'), h);

    const cutHole = (dia: number, x: number, y: number) => {
      // Generous through-cut covering either z-centring convention.
      const cyl = replicad.makeCylinder(dia / 2, h + 10, [x, y, -5], [0, 0, 1]);
      solid = solid.cut(cyl);
    };

    for (const f of feats) {
      if (f.type !== 'hole') continue;
      const pat = feats.find(p => (p.type === 'circularPattern' || p.type === 'linearPattern') && p.feature === f.id);
      const dia = requiredNum(f.diameter, `${f.id}.diameter`);
      if (pat?.type === 'circularPattern') {
        const cnt = requiredNum(pat.count, `${pat.id}.count`);
        const r = requiredNum(pat.pcd, `${pat.id}.pcd`) / 2;
        for (let i = 0; i < cnt; i++) { const a = (i / cnt) * 2 * Math.PI; cutHole(dia, Math.cos(a) * r, Math.sin(a) * r); }
      } else if (pat?.type === 'linearPattern') {
        const cnt = requiredNum(pat.count, `${pat.id}.count`);
        const sp = requiredNum(pat.spacing, `${pat.id}.spacing`);
        for (let i = 0; i < cnt; i++) {
          const off = (i - (cnt - 1) / 2) * sp;
          cutHole(dia, requiredNum(f.posX, `${f.id}.posX`) + (pat.axis === 'y' ? 0 : off), requiredNum(f.posY, `${f.id}.posY`) + (pat.axis === 'y' ? off : 0));
        }
      } else {
        cutHole(dia, requiredNum(f.posX, `${f.id}.posX`), requiredNum(f.posY, `${f.id}.posY`));
      }
    }

    // Shell: hollow cavity cut from the base, open at top or bottom — same
    // deterministic inner-box/cylinder approach as the OpenSCAD preview, so the
    // STEP matches it (more robust than replicad's face-selection .shell()).
    const shell = feats.find(f => f.type === 'shell');
    if (shell) {
      try {
        const wt = requiredNum(shell.wallThickness, `${shell.id}.wallThickness`);
        const H = requiredNum(base.height, 'base.height');
        const zoff = shell.openFace === 'bottom' ? -wt - 20 : wt;
        const inner = base.shape === 'circle'
          ? replicad.makeCylinder(requiredNum(base.width, 'base.width') / 2 - wt, H + 20, [0, 0, zoff], [0, 0, 1])
          : replicad.makeBaseBox(requiredNum(base.width, 'base.width') - 2 * wt, requiredNum(base.depth, 'base.depth') - 2 * wt, H + 20).translate([0, 0, zoff]);
        solid = solid.cut(inner);
      } catch { skipped.push('shell'); }
    }

    // Ribs: vertical fins fused onto the base (makeBaseBox sits bottom at z=0,
    // matching the base). alongY runs the rib along Y, else along X.
    for (const f of feats) {
      if (f.type !== 'rib') continue;
      try {
        const t = requiredNum(f.width, `${f.id}.width`), rh = requiredNum(f.height, `${f.id}.height`), L = requiredNum(f.length, `${f.id}.length`);
        const rib = replicad.makeBaseBox(f.alongY ? t : L, f.alongY ? L : t, rh).translate([requiredNum(f.posX, `${f.id}.posX`), requiredNum(f.posY, `${f.id}.posY`), 0]);
        solid = solid.fuse(rib);
      } catch { skipped.push('rib'); }
    }

    // An all-edge fillet/chamfer can't exceed half the smallest dimension it
    // rounds (the thickness binds), or replicad silently no-ops it. Clamp to a
    // feasible value and REPORT it, rather than silently dropping the feature.
    // 0.42 (not 0.49): a radius right at half the thickness leaves a degenerate
    // sliver that corrupts the B-rep and fails the STEP export — keep a margin.
    const maxEdge = Math.max(0.3, Math.min(requiredNum(base.height, 'base.height'), requiredNum(base.width, 'base.width'), base.shape === 'circle' ? requiredNum(base.width, 'base.width') : requiredNum(base.depth, 'base.depth')) * 0.42);
    const clamped: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const solidBeforeEdges: any = solid; // fall back to this if the edge ops corrupt the B-rep
    let appliedEdgeOp = false;
    for (const f of feats) {
      // A radius near/over the feasible max aborts OCCT (an un-catchable WASM
      // trap). SKIP those (and report) rather than attempt-and-crash; only apply
      // edge ops that comfortably fit.
      try {
        if (f.type === 'fillet') {
          const want = requiredNum(f.radius, `${f.id}.radius`);
          if (want > maxEdge) { skipped.push(`fillet ${want}mm (max ~${maxEdge.toFixed(1)}mm for this thickness)`); continue; }
          solid = solid.fillet(want); appliedEdgeOp = true;
        } else if (f.type === 'chamfer') {
          const want = requiredNum(f.distance, `${f.id}.distance`);
          if (want > maxEdge) { skipped.push(`chamfer ${want}mm (max ~${maxEdge.toFixed(1)}mm)`); continue; }
          solid = solid.chamfer(want); appliedEdgeOp = true;
        }
      } catch { skipped.push(f.type ?? 'edge-op'); }
    }

    // Edge ops can silently produce a B-rep that won't export (degenerate blends).
    // If blobSTEP throws, re-export WITHOUT the edge ops so the part still ships.
    let step: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let exportedSolid: any = solid;
    try {
      step = await solid.blobSTEP().text();
    } catch {
      if (!appliedEdgeOp) throw new Error('STEP export failed');
      step = await solidBeforeEdges.blobSTEP().text();
      exportedSolid = solidBeforeEdges;
      skipped.push('fillet/chamfer (export-incompatible)');
    }
    // A degenerate program (e.g. a hole wider than the body) can cut everything
    // away — replicad still emits a valid-but-EMPTY STEP. Reject it so the studio
    // falls back to the mesh STEP, which keeps whatever the preview shows.
    if (!step.includes('MANIFOLD_SOLID_BREP') || !step.includes('ADVANCED_FACE')) {
      return NextResponse.json({ error: 'empty solid', code: 'DEGENERATE' }, { status: 422 });
    }
    const before = measureBrep(replicad, exportedSolid);
    const imported = await replicad.importSTEP(new Blob([step], { type: 'application/step' }));
    const after = measureBrep(replicad, imported);
    const roundtrip = compareStepRoundtrip(before, after);
    const expected = base.shape === 'circle'
      ? { width: requiredNum(base.width, 'base.width'), height: requiredNum(base.width, 'base.width'), depth: h }
      : { width: requiredNum(base.width, 'base.width'), height: requiredNum(base.depth, 'base.depth'), depth: h };
    const baseDimErrors = [
      Math.abs(before.bbox.width - expected.width),
      Math.abs(before.bbox.height - expected.height),
      Math.abs(before.bbox.depth - expected.depth),
    ];
    const maxBaseDimError = Math.max(...baseDimErrors);
    const featureExpectation = expectedAnalyticFeatureSignature(body);
    const actualCylinderFaces = exportedSolid.faces.filter((face: { geomType: string }) => face.geomType === 'CYLINDRE').length;
    const featureMismatches: string[] = [];
    if (actualCylinderFaces !== featureExpectation.expectedCylinderFaces) {
      featureMismatches.push(`Expected ${featureExpectation.expectedCylinderFaces} cylindrical faces, found ${actualCylinderFaces}.`);
    }
    if (featureExpectation.unsupportedFeatureIds.length > 0) {
      featureMismatches.push(`Feature recognition not implemented for: ${featureExpectation.unsupportedFeatureIds.join(', ')}.`);
    }
    const requestedFeatureCount = 1 + featureExpectation.expectedThroughHoles + featureExpectation.unsupportedFeatureIds.length;
    const verifiedFeatureCount = 1
      + (actualCylinderFaces === featureExpectation.expectedCylinderFaces ? featureExpectation.expectedThroughHoles : 0);
    const artifactId = `sha256:${createHash('sha256').update(step).digest('hex')}`;
    const gateReport = evaluateManufacturingGates({
      provenance: body.verificationContext ? {
        traceable: true,
        privacyCompliant: body.verificationContext.privacyCompliant,
        refs: [body.verificationContext.inputRef],
      } : undefined,
      intent: body.verificationContext ? {
        resolved: body.verificationContext.intentResolved,
        unresolved: body.verificationContext.intentResolved ? [] : ['Design intent is not resolved.'],
        conflicts: [],
      } : undefined,
      program: { valid: true, errors: [] },
      kernel: { built: true, analytic: true, engine: 'replicad/OCCT', errors: [] },
      topology: {
        closed: before.solidCount === 1 && !before.isNull,
        manifold: before.solidCount === 1 && !before.isNull,
        solidCount: before.solidCount,
        errors: [],
      },
      dimensions: {
        checked: 3,
        maxErrorMm: maxBaseDimError,
        toleranceMm: 0.05,
        mismatches: maxBaseDimError <= 0.05 ? [] : [`Base bounding box differs by ${maxBaseDimError}mm.`],
      },
      features: {
        requested: requestedFeatureCount,
        verified: verifiedFeatureCount,
        skipped,
        mismatches: featureMismatches,
      },
      dfm: evaluateProgramDfm(body, body.verificationContext),
      stepRoundtrip: {
        reimported: true,
        topologyMatched: roundtrip.topologyMatched,
        dimensionsMatched: roundtrip.dimensionsMatched,
        errors: roundtrip.errors,
      },
      release: {
        artifactId,
        exactArtifactVerified: roundtrip.passed,
        authorized: false,
        reasons: [],
      },
    });
    const encodedGateReport = Buffer.from(JSON.stringify(gateReport), 'utf8').toString('base64url');
    return new NextResponse(step, {
      status: 200,
      headers: {
        'Content-Type': 'application/step',
        'Content-Disposition': `attachment; filename="${(body.part ?? 'nexyfab-part').replace(/[^\w.-]/g, '_')}.step"`,
        'X-Skipped': skipped.join(',') || 'none',
        'X-Clamped': clamped.join('; ') || 'none',
        'X-Manufacturing-Gates': encodedGateReport,
        'X-Artifact-Id': artifactId,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'STEP build failed' }, { status: 500 });
  }
}
