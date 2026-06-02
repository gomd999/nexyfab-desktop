/**
 * occt/types — OCCT shape interface types.
 *
 * Phase 4 of NexyFab Pro own-CAD (ADR-013). Interface scaffolding only; the
 * real OCCT WASM binding lands in `bridge.ts` `createWasmBridge` (currently
 * stubbed).
 *
 * Design notes
 * ------------
 * `OcctShape.id` is an OPAQUE handle string the consumer must NOT parse. The
 * stub bridge uses `stub_<n>`; the WASM bridge will use `occt_<n>`. The id is
 * the only durable reference — `bbox`, `volume`, `area`, and `centerOfMass`
 * are cached snapshots from the moment the shape was constructed/returned by
 * a kernel call. If you mutate a shape via boolean / fillet / chamfer, the
 * RESULT shape gets a fresh id and fresh cached metrics; the input shapes are
 * unchanged (immutable in the JS view, even though the underlying OCCT
 * TopoDS_Shape may share data).
 *
 * `OcctShapeKind` mirrors OCCT's `TopAbs_ShapeEnum` minus `SHAPE` (used as a
 * fallback / when the kernel hasn't classified yet). `compound` represents a
 * heterogeneous bag (TopAbs_COMPOUND) — typically the result of a boolean
 * operation that produced disconnected pieces.
 *
 * `Vec3` is local — most other modules in this codebase define their own
 * `Vec3` ad-hoc (`{ x, y, z }`). We follow that pattern rather than reaching
 * for a not-yet-extracted shared type. If/when a centralised Vec3 lands,
 * collapse this into the import.
 */

// ─── Vec3 ─────────────────────────────────────────────────────────────────

/**
 * 3-component vector. Matches the `{ x, y, z }` convention used by sibling
 * modules (e.g. `shape-generator/assembly/centerOfMassCalculator.ts`).
 * Coordinates are in millimetres unless the call site documents otherwise.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ─── shape kinds ──────────────────────────────────────────────────────────

/**
 * Topological class of an OCCT shape. Mirrors `TopAbs_ShapeEnum`:
 *   - `shape`     — fallback / unclassified (rare).
 *   - `solid`     — closed, manifold volume (TopAbs_SOLID).
 *   - `shell`     — connected face set, may be open (TopAbs_SHELL).
 *   - `face`      — bounded patch of a surface (TopAbs_FACE).
 *   - `edge`      — bounded segment of a curve (TopAbs_EDGE).
 *   - `vertex`    — 0-dimensional point (TopAbs_VERTEX).
 *   - `wire`      — connected edge sequence (TopAbs_WIRE).
 *   - `compound`  — heterogeneous bag (TopAbs_COMPOUND).
 */
export type OcctShapeKind =
  | 'shape'
  | 'solid'
  | 'shell'
  | 'face'
  | 'edge'
  | 'vertex'
  | 'wire'
  | 'compound';

// ─── shape handle ─────────────────────────────────────────────────────────

/**
 * Opaque handle for an OCCT shape held in the kernel. Treat as immutable
 * from JS; never mutate the cached metrics — the bridge will recompute them
 * for the result shape of any kernel op.
 */
export interface OcctShape {
  /** Opaque kernel handle. Stub: `stub_<n>`. WASM: `occt_<n>`. */
  readonly id: string;
  readonly kind: OcctShapeKind;
  /** Axis-aligned bounding box in world coords (mm). */
  readonly bbox?: { min: Vec3; max: Vec3 };
  /** Volume in mm^3 for solids; undefined for lower-dim shapes. */
  readonly volume?: number;
  /** Surface area in mm^2 (for shells/faces/solids). */
  readonly area?: number;
  /** Center of mass (mm). Computed assuming uniform density. */
  readonly centerOfMass?: Vec3;
}

// ─── operation envelope ───────────────────────────────────────────────────

/**
 * Uniform return envelope for every OCCT bridge operation.
 *
 * Why an envelope (vs. throwing)?
 *   - OCCT kernel ops have recoverable failure modes that are not exceptions
 *     in the JS sense — e.g. "fillet radius too large for edge length", "boolean
 *     produced empty result", "STEP file had 3 unsupported entities". Wrapping
 *     the outcome lets the UI surface partial successes + a warning list
 *     without try/catch noise at every call site.
 *   - The bridge still throws for misuse (calling with a released handle,
 *     non-finite radius, etc). Reserve `ok=false` for kernel-level failures.
 */
export interface OcctOperationResult {
  ok: boolean;
  shape?: OcctShape;
  /** Human-readable error string when `ok=false`. */
  error?: string;
  /** Non-fatal advisories (e.g. "stub: no actual fillet"). Always present. */
  warnings: string[];
}
