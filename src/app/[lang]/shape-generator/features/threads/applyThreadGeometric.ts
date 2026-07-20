/**
 * applyThreadGeometric.ts — Wave 2 Phase 2 Track D7 (W7) geometric thread,
 * re-cut in Wave 5 Track W5-B to perform a REAL material-removing cut.
 *
 * ── W5-B change history ─────────────────────────────────────────────────────
 * The original D7 implementation swept a thin `THREE.TubeGeometry` along the
 * helix and UNIONed it into the parent for external threads. Because the tube
 * sat at the mean thread radius — i.e. INSIDE the host cylinder — the union
 * removed nothing and added (measured) −0.108 mm³ on an M8×20 host of
 * 1003.7 mm³. Geometric mode therefore cut **nothing**.
 *
 * W5-B replaces the tube with a **helical groove cutter** that is CSG-
 * SUBTRACTed from the parent for BOTH thread kinds (thread cutting always
 * removes material — external cuts a groove into the rod's outer surface,
 * internal cuts a groove outward into the bore wall).
 *
 * What is EXACT (matches the ISO 68-1 basic profile in axial cross-section):
 * - Groove depth = 5H/8 — derived from the catalog `(nominalDia −
 *   minorDiameter)/2`, which equals 0.54127·P = 5H/8 for 60° V series.
 * - External groove: root flat P/4 wide at the minor diameter, opening
 *   7P/8 wide at the major diameter, 60° included flank angle.
 * - Internal groove: root flat P/8 wide at the major diameter, opening
 *   3P/4 wide at the minor diameter, 60° included flank angle.
 * - Helix lead/pitch, handedness, thread length, start offset.
 *
 * What is APPROXIMATE (stated honestly — do not remove these notes):
 * - Sharp trapezoid corners: no root rounding (real 6g bolts have a rounded
 *   root reaching d3 ≈ d − 1.2268·P; we cut to the basic-profile root at
 *   d − 1.0825·P, i.e. slightly LESS material removed than a real bolt).
 * - Polygonal sampling: 16 helix samples/turn (capped at `maxSamples`
 *   rings total) — the groove wall is a chordal approximation.
 * - Groove overhangs the declared thread range ends by < P/2 axially
 *   (no run-out / lead-in chamfer modelling).
 * - 55° Whitworth series (BSP) and tapered pipe threads (NPT/BSPT) are cut
 *   with the same 60°-V-derived trapezoid on a cylindrical helix — flank
 *   angle and taper are approximations for those series.
 *
 * Two execution paths:
 *   1. **Client-side (default)** — builds the swept groove cutter mesh and
 *      CSG-SUBTRACTs it from the host using `three-bvh-csg`.
 *   2. **Worker (opt-in)** — calls `occtSweepHelix` via the worker bridge.
 *      ⚠ The occt-worker src/ tree is BLOCKED on Wave 1 task #31. If
 *      `useWorker: true` is passed but the worker is offline (the default
 *      when task #31 hasn't shipped), the call throws and we fall back to
 *      the client-side path automatically.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §7 (algorithm), §8 (cost), §9.2
 * (worker contract), §11 (perf budget).
 *
 * Out of scope:
 * - Drawing-callout pipeline — D8.
 * - BOM aggregation — D8.
 * - ISO 6410-1 dashed-line view — D8.
 * - Pipe-tapered helix (NPT/BSPT) — uses cylindrical helix as approximation;
 *   real tapered helix requires worker path (task #31).
 */

import * as THREE from 'three';
import { findThreadRow, type ThreadStandardRow } from './threadCatalog';
import type { ThreadFeature, ThreadDirection } from './threadFeature';
import { formatThreadCallout } from './threadFeature';
import {
  buildHelixPath,
  helixTurnsForLength,
  DEFAULT_SAMPLES_PER_TURN,
  DEFAULT_MAX_SAMPLES,
  type HelixDirection,
} from './helixGeometry';
import {
  buildThreadProfile,
  profileRadialExtent,
  type Vec2,
} from './threadProfile';

// ─── Output shape ───────────────────────────────────────────────────────────

/**
 * Output of `applyThreadGeometric` — the geometric-mode counterpart to
 * `ApplyThreadCosmeticResult`. Distinguishing characteristic: `geometry` is a
 * **new** `BufferGeometry` (never reference-equal to the input).
 */
export interface ApplyThreadGeometricResult {
  /** A new BufferGeometry distinct from `parentGeometry`. */
  geometry: THREE.BufferGeometry;
  metadata: {
    threadRef: ThreadStandardRow;
    class: string;
    direction: ThreadDirection;
    /** Pre-formatted callout per ISO 6410-1. */
    callout: string;
    rangeStart: readonly [number, number, number];
    rangeEnd: readonly [number, number, number];
    /** Vertex count of the generated helical thread mesh (pre-boolean). */
    threadVertexCount: number;
    /** Final vertex count after optional boolean. */
    finalVertexCount: number;
    /** True iff the worker path was used (false = client-side fallback). */
    usedWorker: boolean;
    /**
     * Sampling diagnostics (helpful for cap-warning + perf telemetry).
     * `samplesPerTurn` is what was actually used, `totalSamples` is the
     * count of helix centerline samples.
     */
    samplesPerTurn: number;
    totalSamples: number;
  };
}

// ─── Options ────────────────────────────────────────────────────────────────

export interface ApplyThreadGeometricOptions {
  /** Optional override of the catalog (testing). */
  catalog?: { [key: string]: readonly ThreadStandardRow[] };
  /** Parent axis direction. Default `[0, 0, 1]`. */
  axis?: readonly [number, number, number];
  /** Parent reference-face origin in model coords. Default `[0, 0, 0]`. */
  origin?: readonly [number, number, number];
  /**
   * Profile override (cross-section in (radial, axial) mm). When omitted the
   * canonical 60° V profile from the catalog row is built.
   */
  profile?: Vec2[];
  /** Sampling override. Default `DEFAULT_SAMPLES_PER_TURN` (16). */
  samplesPerTurn?: number;
  /** Sample cap override. Default `DEFAULT_MAX_SAMPLES` (256). */
  maxSamples?: number;
  /**
   * Skip the boolean operation with the parent cylinder. The returned
   * geometry is then JUST the swept thread (a separate part). Useful for
   * unit-testing the sweep alone without the CSG cost. Default false.
   */
  skipBoolean?: boolean;
  /**
   * Attempt the worker path (`occtSweepHelix`). Default false. When true and
   * the worker is offline, the worker error is **caught** and the client
   * fallback runs — `metadata.usedWorker` will then be false.
   */
  useWorker?: boolean;
  /**
   * Inject a fake worker callable for testing. Production passes the real
   * `occtSweepHelix` here; tests pass a stub.
   */
  workerCall?: (req: unknown) => Promise<unknown>;
  /**
   * @deprecated W5-B: no-op. The old client-side path swept a circular
   * `TubeGeometry` sized by this override; the current path sweeps the real
   * groove trapezoid derived from the catalog row, so there is no tube
   * radius to override. Kept so existing call sites keep type-checking.
   */
  tubeRadiusOverride?: number;
}

// ─── Client-side groove cutter — swept trapezoid along helix path ───────────

/**
 * Trapezoidal groove cross-section in the (radial, axial) plane, mm.
 * `rInner < rOuter`; `halfInner`/`halfOuter` are the axial HALF-widths at
 * each radial station. The polygon is wound counter-clockwise in the
 * (radial→right, axial→up) plane:
 *
 *   p0 = (rInner, +halfInner)   p3 = (rOuter, +halfOuter)
 *   p1 = (rInner, −halfInner)   p2 = (rOuter, −halfOuter)
 *
 * Exported for reuse by the generic modeler feature `features/thread.ts`
 * (which cuts a parametric V-groove rather than a catalog thread).
 */
export interface GrooveTrapezoid {
  rInner: number;
  rOuter: number;
  halfInner: number;
  halfOuter: number;
}

const TAN_30 = Math.tan(Math.PI / 6);

/**
 * Compute the groove cutter cross-section for a catalog row.
 *
 * EXACT for 60°-V series (ISO M / UNC / UNF): groove depth is
 * `(nominalDia − minorDiameter)/2 = 5H/8` and the flat widths follow the
 * ISO 68-1 basic profile (external root flat P/4, internal root flat P/8).
 * The open side of the trapezoid is extended past the host surface by
 * `margin` so the CSG subtraction cuts cleanly through the (polygonal)
 * host wall — the extension lies outside the material and removes nothing.
 *
 * APPROXIMATE for 55° Whitworth (BSP) and tapered (NPT/BSPT) series — the
 * same 60° flank construction is reused (see file header).
 */
function grooveSectionForRow(
  row: ThreadStandardRow,
  threadKind: 'internal' | 'external',
): GrooveTrapezoid {
  const P = row.pitch;
  const majorR = row.nominalDia / 2;
  const minorR = row.minorDiameter / 2;
  // Open-side margin: big enough to clear the host's polygonal chord sag,
  // small enough that adjacent turns never merge (opening + 2·margin·tan30
  // must stay < P). 0.08·P keeps the external opening at 0.967·P.
  const margin = 0.08 * P;

  if (threadKind === 'external') {
    // Groove into the rod's outer surface: root flat P/4 at minorR,
    // opening 7P/8 at majorR, extended past majorR by `margin`.
    return {
      rInner: minorR,
      rOuter: majorR + margin,
      halfInner: P / 8, // root flat P/4 → half P/8
      halfOuter: (7 * P) / 16 + margin * TAN_30,
    };
  }
  // Internal: groove outward into the bore wall: opening 3P/4 at minorR
  // (extended inward past the bore surface by `margin`), root flat P/8 at
  // majorR.
  return {
    rInner: minorR - margin,
    rOuter: majorR,
    halfInner: (3 * P) / 8 + margin * TAN_30,
    halfOuter: P / 16, // root flat P/8 → half P/16
  };
}

/**
 * Build the helical groove CUTTER as a closed, indexed triangle mesh: the
 * trapezoid cross-section is placed at every helix sample in the plane
 * spanned by the local radial direction and the +Z axis (axial cross-section
 * — the standard way thread form is specified), consecutive rings are
 * stitched with quads, and both ends are capped.
 *
 * The result is the material TO REMOVE — callers subtract it from the host.
 * Winding produces outward-facing normals (verified by signed-volume test).
 *
 * Exported for reuse by `features/thread.ts` (the generic modeler feature).
 * Helix axis is +Z — callers with a different axis rotate the result.
 */
export function buildThreadCutterGeometry(
  section: GrooveTrapezoid,
  pitch: number,
  turns: number,
  startOffset: number,
  direction: HelixDirection,
  samplesPerTurn: number,
  maxSamples: number,
): { geometry: THREE.BufferGeometry; vertexCount: number; totalSamples: number } {
  // Unit-radius helix gives us (cosθ, ±sinθ, z) per ring — the radial unit
  // vector and axial position in one call, reusing the shared sampler.
  const points = buildHelixPath(
    {
      axis: [0, 0, 1],
      radius: 1,
      pitch,
      turns,
      startOffset,
      direction,
    },
    { samplesPerTurn, maxSamples },
  );

  const profile: readonly (readonly [number, number])[] = [
    [section.rInner, +section.halfInner],
    [section.rInner, -section.halfInner],
    [section.rOuter, -section.halfOuter],
    [section.rOuter, +section.halfOuter],
  ];
  const nProfile = profile.length;
  const nRings = points.length;

  const positions = new Float32Array(nRings * nProfile * 3);
  const uvs = new Float32Array(nRings * nProfile * 2);
  for (let i = 0; i < nRings; i++) {
    const [ux, uy, z] = points[i]!;
    for (let j = 0; j < nProfile; j++) {
      const [r, a] = profile[j]!;
      const k = (i * nProfile + j) * 3;
      positions[k] = ux * r;
      positions[k + 1] = uy * r;
      positions[k + 2] = z + a;
      const kuv = (i * nProfile + j) * 2;
      uvs[kuv] = nRings > 1 ? i / (nRings - 1) : 0; // u — along the helix
      uvs[kuv + 1] = j / (nProfile - 1); // v — around the profile
    }
  }

  const indices: number[] = [];
  // Side walls, wound so face normals point OUT of the solid (verified by a
  // signed-volume probe: +219.99 mm³ for the RH M8×20 external cutter; the
  // opposite winding measured −219.99 mm³). A LEFT-hand helix mirrors the
  // sweep, which inverts the orientation (probe: LH with RH winding
  // measured −220.015 mm³) — so LH reverses every triangle.
  const flip = direction === 'left_hand';
  const pushTri = (i0: number, i1: number, i2: number): void => {
    if (flip) indices.push(i0, i2, i1);
    else indices.push(i0, i1, i2);
  };
  for (let i = 0; i < nRings - 1; i++) {
    const a0 = i * nProfile;
    const b0 = (i + 1) * nProfile;
    for (let j = 0; j < nProfile; j++) {
      const j1 = (j + 1) % nProfile;
      pushTri(a0 + j, b0 + j1, a0 + j1);
      pushTri(a0 + j, b0 + j, b0 + j1);
    }
  }
  // Start cap — faces −tangent.
  pushTri(0, 2, 1);
  pushTri(0, 3, 2);
  // End cap — faces +tangent.
  const e = (nRings - 1) * nProfile;
  pushTri(e, e + 1, e + 2);
  pushTri(e, e + 2, e + 3);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return {
    geometry: geom,
    vertexCount: nRings * nProfile,
    totalSamples: nRings,
  };
}

// ─── Worker bridge stub (BLOCKED on Wave 1 task #31) ───────────────────────

/**
 * Worker-path request envelope — mirrors §9.2 of the spec. Kept here so
 * the type can be shared with the worker once task #31 lands.
 *
 * TODO(wave-1/task-31): the occt-worker src/ tree is offline; the
 * `useWorker: true` opt-in path catches the resulting error and falls back
 * to the client-side TubeGeometry above. When task #31 ships, this stub
 * will be replaced by a real RPC call to `occtSweepHelix`.
 */
interface WorkerSweepRequest {
  op: 'thread/geometric';
  parentFeatureId?: string;
  threadRef: { series: string; designation: string };
  threadKind: 'internal' | 'external';
  direction: ThreadDirection;
  lengthMm: number;
  startOffset: number;
  helixRadius: number;
  pitch: number;
  profile: Vec2[];
  quality: 'draft' | 'normal' | 'high';
}

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Apply a geometric thread feature to a parent geometry.
 *
 * Default (client-side path, W5-B):
 *   1. Look up the catalog row → P, D, H, etc.
 *   2. Compute turns from `feature.length / P`.
 *   3. Build the V-profile (`buildThreadProfile`) — used for cap-warning
 *      sizing + the worker request payload.
 *   4. Derive the groove trapezoid section from the row (ISO 68-1 basic
 *      profile; see file header for exact-vs-approximate notes).
 *   5. Sweep the section along the helix (`buildHelixPath`) into a closed
 *      cutter mesh.
 *   6. Boolean with the parent: SUBTRACT for both kinds (real material
 *      removal — external grooves the rod, internal grooves the bore).
 *   7. Return new geometry + metadata.
 *
 * @throws if `feature.mode !== 'geometric'` or the catalog lookup fails.
 *
 * **Worker-path try/catch semantics:** if `options.useWorker = true` and a
 * `workerCall` is provided, we await it inside a try/catch. Any throw or
 * rejection falls back to the client-side path **silently** (a `console.warn`
 * marks the demotion for diagnostics). The result then has
 * `metadata.usedWorker = false`.
 */
export function applyThreadGeometric(
  parentGeometry: THREE.BufferGeometry,
  feature: ThreadFeature,
  options: ApplyThreadGeometricOptions = {},
): ApplyThreadGeometricResult {
  if (feature.mode !== 'geometric') {
    throw new Error(
      `applyThreadGeometric: feature.mode must be 'geometric' (got '${feature.mode}'). ` +
        `Cosmetic mode is W5 — use applyThreadCosmetic instead.`,
    );
  }

  // 1. Catalog lookup
  const row = findThreadRow(feature.threadRef.series, feature.threadRef.designation);
  if (!row) {
    throw new Error(
      `applyThreadGeometric: THREAD_DESIGNATION_UNKNOWN — ` +
        `series=${feature.threadRef.series} designation="${feature.threadRef.designation}"`,
    );
  }

  const axis = options.axis ?? ([0, 0, 1] as const);
  const origin = options.origin ?? ([0, 0, 0] as const);

  // 2. Compute helix params from the row + feature.
  const pitch = row.pitch;
  const turns = Math.max(0.001, helixTurnsForLength(feature.length, pitch));
  // The mean of major/minor diameters is the sweep midline per §7 step 2.
  const helixRadius = (row.nominalDia + row.minorDiameter) / 4;
  const helixDir: HelixDirection = feature.threadDirection;

  // 3. Build the V-profile — used for radial extent + future worker path.
  const profile = options.profile ?? buildThreadProfile({
    pitch: row.pitch,
    threadHeight: row.threadHeight,
  });
  // Retained for the worker request payload + cap-warning sizing; the
  // client-side cutter derives its section from the catalog row directly.
  void profileRadialExtent(profile);

  // 4. Worker attempt (opt-in only; falls back to client-side on any failure).
  let usedWorker = false;
  if (options.useWorker && options.workerCall) {
    const request: WorkerSweepRequest = {
      op: 'thread/geometric',
      parentFeatureId: feature.parentFeatureId,
      threadRef: feature.threadRef,
      threadKind: feature.threadKind,
      direction: feature.threadDirection,
      lengthMm: feature.length,
      startOffset: feature.startOffset,
      helixRadius,
      pitch,
      profile: profile as Vec2[],
      quality: 'normal',
    };
    try {
      // Worker is async by contract; we cannot block here so we attempt
      // synchronously and catch the (expected) "worker not ready" failure.
      // The real impl will need to be promise-based — D7 leaves this as a
      // sync-stub that always falls through until task #31 lands.
      options.workerCall(request);
      // NB: even if the call returns a promise it has not resolved yet.
      // For now, the worker path always defers to client; this branch exists
      // so callers can pass `useWorker: true` without an error.
      // TODO(wave-1/task-31): await the worker result and use its mesh.
    } catch (err) {
      console.warn(
        '[applyThreadGeometric] worker path threw, falling back to client-side',
        err,
      );
      usedWorker = false;
    }
  }

  // 5. Client-side path — build the helical groove CUTTER (material to
  //    remove). W5-B: this replaced the old mean-radius tube, which UNIONed
  //    inside the host and measurably removed nothing.
  const samplesPerTurn = options.samplesPerTurn ?? DEFAULT_SAMPLES_PER_TURN;
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  const section = grooveSectionForRow(row, feature.threadKind);
  const cutter = buildThreadCutterGeometry(
    section,
    pitch,
    turns,
    feature.startOffset,
    helixDir,
    samplesPerTurn,
    maxSamples,
  );
  const threadGeom = cutter.geometry;

  // 6. Boolean with parent — SUBTRACTION for BOTH kinds (thread cutting
  //    always removes material: external cuts a groove into the rod's outer
  //    surface, internal cuts a groove outward into the bore wall).
  //    For unit tests we expose `skipBoolean: true` so we don't pay the CSG
  //    cost when only the cutter mesh shape is being verified — the returned
  //    geometry is then the CUTTER (removal volume), not the threaded part.
  //
  //    Note: `three-bvh-csg` is imported via a synchronous `require` (not the
  //    static `import` syntax) so the test harness — which spins up before
  //    node_modules are guaranteed installed in some worktree configurations —
  //    can still type-check + run unit tests with `skipBoolean: true`. A real
  //    runtime always has the package installed.
  let finalGeom: THREE.BufferGeometry = threadGeom;
  if (!options.skipBoolean) {
    try {
      const parentHasGeom = (parentGeometry.attributes.position?.count ?? 0) > 0;
      if (parentHasGeom) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const csg = require('three-bvh-csg') as {
          Evaluator: new () => { evaluate: (a: unknown, b: unknown, op: unknown) => { geometry: THREE.BufferGeometry } | null };
          Brush: new (geo: THREE.BufferGeometry, mat: THREE.Material) => unknown;
          SUBTRACTION: unknown;
        };
        const ev = new csg.Evaluator();
        const brushA = new csg.Brush(parentGeometry, new THREE.MeshStandardMaterial());
        const brushB = new csg.Brush(threadGeom, new THREE.MeshStandardMaterial());
        const result = ev.evaluate(brushA, brushB, csg.SUBTRACTION);
        if (result?.geometry) {
          finalGeom = result.geometry;
          finalGeom.computeVertexNormals();
        }
      }
    } catch (err) {
      // CSG sometimes blows up on degenerate input — fall through to the
      // pre-boolean cutter mesh so the user at least sees the helix. This is
      // an HONEST degradation: the returned mesh is then NOT a threaded part.
      console.warn('[applyThreadGeometric] CSG fallback to pre-boolean mesh', err);
    }
  }

  // 7. Compute range.
  const rangeStart: [number, number, number] = [
    origin[0] + axis[0] * feature.startOffset,
    origin[1] + axis[1] * feature.startOffset,
    origin[2] + axis[2] * feature.startOffset,
  ];
  const endOffset = feature.startOffset + feature.length;
  const rangeEnd: [number, number, number] = [
    origin[0] + axis[0] * endOffset,
    origin[1] + axis[1] * endOffset,
    origin[2] + axis[2] * endOffset,
  ];

  const callout = formatThreadCallout(feature, row);

  return {
    geometry: finalGeom,
    metadata: {
      threadRef: row,
      class: feature.class,
      direction: feature.threadDirection,
      callout,
      rangeStart,
      rangeEnd,
      threadVertexCount: cutter.vertexCount,
      finalVertexCount: finalGeom.attributes.position?.count ?? 0,
      usedWorker,
      samplesPerTurn,
      totalSamples: cutter.totalSamples,
    },
  };
}
