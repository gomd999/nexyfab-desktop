/**
 * topologyIdMap.ts — STEP entity # ↔ NexyFab persistent ID mapping.
 *
 * After import we need stable IDs that survive:
 *   1. Re-import of the same STEP file (same #N → same NexyFab ID).
 *   2. Downstream OCCT operations (fillet / chamfer / boolean).
 *   3. CRDT sync (multiple clients seeing same imported part).
 *
 * Strategy: hash the STEP entity's *content* (axis position, radius,
 * point coordinates) instead of its line number. Line numbers shift
 * across re-exports from the source CAD; content stays stable.
 *
 * The hash is a deterministic FNV-1a over the structural fields
 * that uniquely identify the entity. Two distinct STEP files that
 * happen to declare the same face will get the same persistent ID
 * — that's intentional (we WANT them to round-trip as the same
 * feature in NexyFab).
 */

export interface FaceIdInput {
  /** Surface type — plane / cylinder / cone / sphere / b-spline. */
  surfaceType: string;
  /** Surface parameters as flat number array. For planes: 4 (a,b,c,d).
   *  For cylinders: 7 (origin + axis + radius). Caller serialises. */
  surfaceParams: number[];
  /** Bounding-loop vertex positions (flat array). Order matters. */
  loopPoints: number[];
}

export interface EdgeIdInput {
  /** Curve type — line / circle / b-spline. */
  curveType: string;
  /** Endpoint positions (6 numbers). */
  endpoints: [number, number, number, number, number, number];
  /** Curve-specific parameters (radius for circles, control points
   *  for splines flattened, ...). */
  curveParams: number[];
}

/** FNV-1a 32-bit hash. Deterministic, fast, no crypto needed. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

/** Quantise a float to a fixed number of significant digits so
 *  cross-export float drift doesn't change the hash. 6 decimal digits
 *  in mm = 1 nanometre — well below any tessellation tolerance. */
function quant(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return 'X';
  return v.toFixed(digits);
}

function flatten(arr: number[]): string {
  return arr.map(v => quant(v)).join(',');
}

/** Produce a stable face id from its content. */
export function faceId(input: FaceIdInput): string {
  const payload = `${input.surfaceType}|${flatten(input.surfaceParams)}|${flatten(input.loopPoints)}`;
  return `face_${fnv1a(payload).toString(16)}`;
}

/** Produce a stable edge id from its content. */
export function edgeId(input: EdgeIdInput): string {
  // Endpoint order can flip across STEP exports — canonicalise by
  // sorting endpoints so reversed-direction edges hash the same.
  const [a0, a1, a2, b0, b1, b2] = input.endpoints;
  const aKey = `${quant(a0)},${quant(a1)},${quant(a2)}`;
  const bKey = `${quant(b0)},${quant(b1)},${quant(b2)}`;
  const sortedEnds = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
  const payload = `${input.curveType}|${sortedEnds}|${flatten(input.curveParams)}`;
  return `edge_${fnv1a(payload).toString(16)}`;
}

/** Build a one-shot map from STEP #N → persistent NexyFab id for a
 *  list of pre-parsed faces / edges. Caller resolves any clashes
 *  externally — collisions are not expected at the FNV-1a / 6-digit
 *  level for typical CAD entity counts (< 50k per file). */
export function buildIdMap(
  faces: Array<{ stepRef: number } & FaceIdInput>,
  edges: Array<{ stepRef: number } & EdgeIdInput>,
): { byStepRef: Map<number, string>; byPersistentId: Map<string, number[]> } {
  const byStepRef = new Map<number, string>();
  const byPersistentId = new Map<string, number[]>();
  const record = (ref: number, id: string): void => {
    byStepRef.set(ref, id);
    const list = byPersistentId.get(id);
    if (list) list.push(ref);
    else byPersistentId.set(id, [ref]);
  };
  for (const f of faces) record(f.stepRef, faceId(f));
  for (const e of edges) record(e.stepRef, edgeId(e));
  return { byStepRef, byPersistentId };
}

/** Detect persistent-id collisions across the import set. Returns
 *  the persistent ids that were assigned to ≥ 2 distinct STEP refs
 *  — these need extra disambiguating data added to the hash. */
export function findCollisions(
  byPersistentId: Map<string, number[]>,
): Array<{ persistentId: string; refs: number[] }> {
  const out: Array<{ persistentId: string; refs: number[] }> = [];
  for (const [id, refs] of byPersistentId) {
    if (refs.length > 1) out.push({ persistentId: id, refs });
  }
  return out;
}
