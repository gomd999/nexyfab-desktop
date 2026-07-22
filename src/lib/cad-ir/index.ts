/**
 * cad-ir — CAD → text IR → verifiable parametric reconstruction, with a deterministic GATE.
 *
 * The wedge: don't just open a drawing — reconstruct editable parametric intent AND prove the
 * reconstruction matches the source (bbox / genus / watertight). The gate accepts ONLY on pass,
 * and its operative metric (per LLM_METHODOLOGY.md) is the count of WRONG reconstructions caught.
 *
 * Pipeline position (this module = the verify stage):
 *
 *   CAD file ──ingest──▶ IR (schema.ts, ingestStl.ts / fixtures)
 *   one sentence ──LLM plan──▶ intent
 *   intent ──deterministic build──▶ SCAD (openscad-render/intentToScad) or scad-agent output
 *   SCAD/mesh ──▶ [ verifyReconstruction(candidate, ir) ]  ◀── THE GATE
 *                     └─ pass → accept · fail → feedback → repair loop
 */

export * from './schema';
// Re-export meshAnalysis without `Vec3` (already exported by schema) to avoid an ambiguous name.
export {
  analyzeIndexed,
  analyzeTriangles,
  trianglesToIndexed,
  solidBox,
  frameBox,
  type IndexedMesh,
  type TriangleSoup,
  type MeshMeasurement,
} from './meshAnalysis';
export * from './gate';
export { parseStl, stlToIr } from './ingestStl';
export { stepToIr, type StepToIrResult, type StepToIrMeta } from './ingestStep';

import { normalizeIr, type Ir } from './schema';
import { parseStl } from './ingestStl';
import { verifyReconstruction, type Candidate, type GateResult } from './gate';

/** Load a `.ir.json` object (already JSON-parsed) into a normalized, honesty-enforced IR. */
export function loadIr(raw: unknown): Ir {
  return normalizeIr(raw);
}

/**
 * WIRING — gate a SCAD reconstruction. `intentToScad` / `runScadAgent` produce SCAD text; the
 * existing openscad-render endpoint (src/lib/openscad-render/renderStl.ts) renders it to STL
 * bytes. Feed those bytes here to close the loop against the source IR without adding any new
 * renderer. Pure function of (STL bytes, IR) → GateResult, so it needs no server context.
 */
export function gateScadStl(stlBytes: Uint8Array, ir: Ir): GateResult {
  const { triangles } = parseStl(stlBytes);
  const candidate: Candidate = { kind: 'triangles', triangles };
  return verifyReconstruction(candidate, ir);
}

/**
 * WIRING — gate an intent-assembly reconstruction. The runtime tessellator lives in
 * scripts/drawing-to-3d/render-preview.mjs (`assemblyTriangles`). In a Node route load it via a
 * webpackIgnore dynamic import (per repo convention) and pass its triangle output here:
 *
 *   const { assemblyTriangles } = await import(/* webpackIgnore: true *\/ '.../render-preview.mjs');
 *   const result = gateIntentTriangles(assemblyTriangles(asm), ir);
 */
export function gateIntentTriangles(triangles: [number, number, number][][], ir: Ir): GateResult {
  return verifyReconstruction({ kind: 'triangles', triangles }, ir);
}
