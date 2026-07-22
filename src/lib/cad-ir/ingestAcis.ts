/**
 * ingestAcis.ts — FAITHFUL planar ACIS solid → IR + reconstruction gate (Phase 2, 260722).
 *
 * THE HONEST CEILING (do not lose this — a green check on a box would be a lie):
 * -----------------------------------------------------------------------------
 * ACIS (SAT text / SAB binary) is a proprietary B-rep format. OCCT / replicad do NOT read it,
 * and there is NO ACIS kernel in this repo. So the achievable fidelity is bounded exactly by
 * `brep-bridge/satImport.ts::reconstructPlanarBody`, which recovers REAL geometry (verts / faces
 * / volume, cross-checked Newell vs plane-surface normal) for **planar-faced** ACIS solids only.
 * Curved ACIS faces (cone / sphere / torus / spline) have no faithful path — `reconstructPlanarBody`
 * returns a `reason` and the body falls to an AABB box. `satExport.ts::writeSatText` only WRITES
 * SAT from a planar mesh (mesh -> SAT); it is not a curved-ACIS reader, and there is no SAT -> STEP.
 *
 * Consequence, stated plainly:
 *   - A planar ACIS solid -> reconstructPlanarBody polyhedron IS the working body (no box in
 *     between). Its faithful measurement is BOTH the gate SOURCE and the CANDIDATE (round-trip
 *     identity), so it gets a REAL pass/fail: a watertight planar reconstruction PASSES;
 *     a degenerate / non-watertight one FAILS. This is `mode: 'passthrough'`.
 *   - A curved ACIS solid (or a polyface vertex-cloud) -> only an AABB box exists. There is NO
 *     faithful measurement, so the gate reports `unavailable` with reason `acis_curved_no_kernel`
 *     — never a fabricated pass on a bounding box.
 *
 * All pure TS: reuses meshAnalysis (analyzeTriangles) and the same gate (verifyReconstruction)
 * as the STEP path. No OCCT, no WASM, no native deps. Runs in-process and in vitest.
 */

import type { CadFormat, Ir, IrExtent, IrReconstruct, Vec3 } from './schema';
import { analyzeTriangles, type MeshMeasurement, type TriangleSoup } from './meshAnalysis';
import { verifyReconstruction } from './gate';

export interface AcisIrResult {
  /** true -> `ir` is a faithful measurement. false -> `reason` explains why none exists. */
  ok: boolean;
  ir: Ir | null;
  reason: string | null;
}

/**
 * Same shape the STEP path's `reconstructionGate` uses (the web/panel UI already renders it):
 * a real pass/fail with a mode, or an honest `unavailable` with a reason. Never a fake pass.
 */
export type AcisGateVerdict =
  | { status: 'pass' | 'fail'; score: number; stage: string; checks: unknown; feedback: string; mode: 'passthrough' | 'approximation' }
  | { status: 'unavailable'; reason: string };

/**
 * Fan-triangulate a planar polyhedron (ngon face cycles into `verts`) into a gate TriangleSoup,
 * scaling model-unit coordinates to mm by `unitMm`. Mirrors ingestStep's polyhedronToTriangles.
 */
export function polyhedronToSoup(
  verts: ReadonlyArray<readonly [number, number, number] | readonly number[]>,
  faces: ReadonlyArray<ReadonlyArray<number>>,
  unitMm = 1,
): TriangleSoup {
  const s = Number.isFinite(unitMm) && unitMm > 0 ? unitMm : 1;
  const V: Vec3[] = verts.map((v) => [Number(v[0]) * s, Number(v[1]) * s, Number(v[2]) * s]);
  const soup: TriangleSoup = [];
  for (const f of faces) {
    if (!Array.isArray(f) || f.length < 3) continue;
    const a = V[f[0]!];
    if (!a) continue;
    for (let i = 1; i + 1 < f.length; i++) {
      const b = V[f[i]!];
      const c = V[f[i + 1]!];
      if (b && c) soup.push([a, b, c]);
    }
  }
  return soup;
}

function gradeAcis(m: MeshMeasurement): IrReconstruct {
  const blockers: string[] = [];
  if (!m.watertight) blockers.push('measured mesh not watertight');
  const grade: IrReconstruct['grade'] = !m.ok ? 'F' : m.watertight ? 'A' : 'D';
  return {
    grade,
    score: grade === 'A' ? 0.9 : grade === 'D' ? 0.4 : 0,
    strategy: 'primitive_csg',
    rationale:
      `Planar ACIS B-rep faithfully reconstructed (verts / faces / volume from source coordinates, ` +
      `Newell vs plane-surface normal cross-checked). Curved ACIS faces have no kernel and are NOT reconstructed here.`,
    est_tokens: null,
    blockers,
  };
}

/**
 * MEASURE an already-mm TriangleSoup (from a reconstructPlanarBody polyhedron) into a faithful IR.
 * Units are `mm` DECLARED because the SAT/SAB header declares the model-unit -> mm scale and the
 * caller already applied it. Returns { ok:false, reason } (route -> 'unavailable') when the soup is
 * empty or unmeasurable — never a fabricated IR.
 */
export function polyhedronToIr(
  soup: TriangleSoup,
  opts: { path: string; name: string; format?: CadFormat; source_hint?: string | null; bytesLen?: number; unitDeclared?: boolean },
): AcisIrResult {
  const t0 = Date.now();
  if (!Array.isArray(soup) || soup.length === 0) {
    return { ok: false, ir: null, reason: 'no_faithful_geometry: empty planar polyhedron soup' };
  }
  const m = analyzeTriangles(soup);
  if (!m.ok || !m.extents) {
    return { ok: false, ir: null, reason: `measurement_failed: ${m.error ?? 'no extents'}` };
  }

  const size = m.extents;
  const centroid: Vec3 | null =
    m.bboxMin && m.bboxMax
      ? [(m.bboxMin[0] + m.bboxMax[0]) / 2, (m.bboxMin[1] + m.bboxMax[1]) / 2, (m.bboxMin[2] + m.bboxMax[2]) / 2]
      : null;
  let aspect: IrExtent['aspect'] = null;
  {
    const s = [...size].sort((a, b) => b - a);
    const r = s[0] / (s[2] || 1e-9);
    aspect = r > 8 ? 'rod' : s[2] / (s[0] || 1) < 0.15 ? 'plate' : 'block';
  }
  const unitDeclared = opts.unitDeclared !== false;

  const ir: Ir = {
    ir_version: '1',
    identity: {
      path: opts.path,
      name: opts.name,
      format: opts.format ?? 'SAT',
      bytes: opts.bytesLen ?? 0,
      sha256: null,
      source_hint: opts.source_hint ?? null,
    },
    parse: {
      status: 'ok',
      parser: 'acis_planar_polyhedron_v1',
      elapsed_ms: Date.now() - t0,
      truncated: false,
      sampled_ratio: 1.0,
      warnings: [
        'acis_planar_reconstruction: measured from satImport.reconstructPlanarBody (planar-faced ACIS only — curved faces have no kernel)',
      ],
      error: null,
    },
    extent: {
      units: unitDeclared ? 'mm' : null,
      units_source: unitDeclared ? 'declared' : 'unknown',
      bbox_min: m.bboxMin,
      bbox_max: m.bboxMax,
      size,
      centroid,
      aspect,
      is_2d: size[2] < 1e-6,
    },
    topology: {
      solids: m.bodyCount,
      shells: null,
      faces: null,
      edges: null,
      vertices: null,
      surface_types: null,
      curve_types: null,
      analytic_ratio: 1.0, // fully planar reconstruction
      closed: m.watertight,
    },
    features: null,
    symmetry: null,
    assembly: null,
    mesh: {
      triangles: m.triangles,
      vertices: m.vertices,
      watertight: m.watertight,
      volume_mm3: m.volume,
      volume_mm3_unit_warning: unitDeclared ? null : 'unit undeclared — volume is native-unit^3, not mm^3',
      area_mm2: m.area,
      components: m.bodyCount,
      planar_clusters: null,
      normal_histogram_peaks: null,
      curvature_bins: null,
      primitive_fit: null,
      degenerate_faces: null,
    },
    semantics: null,
    reconstruct: gradeAcis(m),
  };

  return { ok: true, ir, reason: null };
}

interface GatePart {
  fidelity?: string;
  type?: string;
  params?: { verts?: unknown; faces?: unknown } & Record<string, unknown>;
}

/** A part carrying a faithfully-reconstructed planar polyhedron (real verts + faces), not a box. */
function isFaithfulPoly(p: GatePart): p is GatePart & { params: { verts: number[][]; faces: number[][] } } {
  const v = p?.params?.verts;
  const f = p?.params?.faces;
  return (
    p?.fidelity === 'brep-polyhedron' &&
    Array.isArray(v) && v.length >= 4 &&
    Array.isArray(f) && f.length >= 4
  );
}

/**
 * WIRING — compute the reconstruction gate for an ACIS-derived (or Parasolid-derived) assembly,
 * the same contract the STEP path emits. Verdict is whole-import honest:
 *   - all bodies faithful planar polyhedra -> passthrough gate PASS/FAIL (source == candidate soup)
 *   - no faithful body (all AABB box: curved ACIS / polyface cloud) -> 'unavailable' (fallbackReason)
 *   - mixed -> 'unavailable' with a reason that credits the faithful bodies but refuses to
 *     green-check an import that is partly a box.
 * Returns undefined when the assembly carries no fidelity signal (nothing to say).
 */
export function acisReconstructionGate(
  assembly: { parts?: unknown; note?: unknown } | null | undefined,
  opts: { fallbackReason?: string; format?: CadFormat; name?: string } = {},
): AcisGateVerdict | undefined {
  const fallbackReason = opts.fallbackReason ?? 'acis_curved_no_kernel';
  const format = opts.format ?? 'SAT';
  const name = opts.name ?? 'import';
  const parts = (Array.isArray(assembly?.parts) ? (assembly as { parts: unknown[] }).parts : []) as GatePart[];
  const polyParts = parts.filter(isFaithfulPoly);
  const approxParts = parts.length - polyParts.length;

  if (polyParts.length === 0 && approxParts === 0) return undefined;

  if (polyParts.length === 0) {
    return {
      status: 'unavailable',
      reason:
        `${fallbackReason}: ${approxParts} body(ies) are AABB-box approximations with no faithful B-rep ` +
        `(planar-only reconstruction — curved ACIS / Parasolid needs a geometry kernel).`,
    };
  }

  const soup = polyParts.flatMap((p) => polyhedronToSoup(p.params.verts, p.params.faces, 1));
  const src = polyhedronToIr(soup, { path: `${name}.acis`, name: `${name}.acis`, format, unitDeclared: true });
  if (!src.ok || !src.ir) {
    return { status: 'unavailable', reason: src.reason ?? 'no_faithful_geometry' };
  }
  // Passthrough: the faithful polyhedron IS the working body, so candidate == source soup
  // (round-trip identity). A watertight planar reconstruction PASSES; a broken one FAILS.
  const g = verifyReconstruction({ kind: 'triangles', triangles: soup }, src.ir);

  if (approxParts > 0) {
    return {
      status: 'unavailable',
      reason:
        `acis_curved_partial: ${polyParts.length} planar body(ies) faithfully gated ` +
        `(${g.passed ? 'pass' : 'fail'}, match ${Math.round(g.score * 100)}%), ` +
        `${approxParts} curved/box body(ies) unverified — ${fallbackReason}.`,
    };
  }

  return {
    status: g.passed ? 'pass' : 'fail',
    score: g.score,
    stage: g.stage,
    checks: g.checks,
    feedback: g.feedback,
    mode: 'passthrough',
  };
}
