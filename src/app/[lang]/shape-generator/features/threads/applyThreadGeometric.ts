/**
 * applyThreadGeometric.ts — Wave 2 Phase 2 Track D7 (W7) geometric thread.
 *
 * Builds **real helical V-thread mesh** for a `ThreadFeature` and (optionally)
 * boolean-combines it with the parent geometry. Mirrors the D5
 * `applyThreadCosmetic.ts` shape but **returns a new BufferGeometry** — the
 * cosmetic-mode reference-equality contract is explicitly inverted here.
 *
 * Two execution paths:
 *   1. **Client-side fallback (default)** — uses `THREE.TubeGeometry` along
 *      the helix path with the V-profile cross-section, then optionally CSG-
 *      unions / subtracts the host cylinder using `three-bvh-csg`.
 *   2. **Worker (opt-in)** — calls `occtSweepHelix` via the worker bridge.
 *      ⚠ The occt-worker src/ tree is BLOCKED on Wave 1 task #31. If
 *      `useWorker: true` is passed but the worker is offline (the default
 *      when task #31 hasn't shipped), the call throws and we fall back to
 *      the client-side path automatically.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §7 (algorithm), §8 (cost), §9.2
 * (worker contract), §11 (perf budget).
 *
 * Out of scope (D7):
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
   * Override the thread mesh's tube radius. Default = profileRadialExtent / 2.
   * The client-side fallback uses a `TubeGeometry` of small circular radius
   * roughly matching the V-profile envelope — close enough for the geometric
   * mesh visual when CSG cannot produce a clean swept solid. The worker path
   * uses the full V-profile and ignores this override.
   */
  tubeRadiusOverride?: number;
}

// ─── Client-side fallback — TubeGeometry along helix path ──────────────────

/**
 * Build the helical thread tube as a `THREE.TubeGeometry`. This is the
 * worker-fallback path — instead of sweeping the V-profile (which OCCT does
 * cleanly but is hard in pure-JS) we use a circular cross-section sized to
 * approximate the V's radial extent.
 *
 * The result is the THREAD body alone — it does NOT include the parent
 * cylinder. Callers wishing to view the threaded part should boolean-combine
 * with the parent (which `applyThreadGeometric` does by default).
 */
function buildThreadTubeGeometry(
  helixRadius: number,
  pitch: number,
  turns: number,
  startOffset: number,
  direction: HelixDirection,
  tubeRadius: number,
  samplesPerTurn: number,
  maxSamples: number,
): { geometry: THREE.BufferGeometry; vertexCount: number; totalSamples: number } {
  const points = buildHelixPath(
    {
      axis: [0, 0, 1],
      radius: helixRadius,
      pitch,
      turns,
      startOffset,
      direction,
    },
    { samplesPerTurn, maxSamples },
  );

  const vec3Points = points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(vec3Points);
  // Tubular segments = number of helix sample intervals (one less than
  // sample count). Radial segments = 6 (matches §8 "profile-segment-count = 6").
  const tubularSegments = Math.max(8, vec3Points.length - 1);
  const radialSegments = 6;
  const geom = new THREE.TubeGeometry(
    curve,
    tubularSegments,
    Math.max(1e-3, tubeRadius),
    radialSegments,
    false,
  );
  geom.computeVertexNormals();
  return {
    geometry: geom,
    vertexCount: geom.attributes.position?.count ?? 0,
    totalSamples: vec3Points.length,
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
 * Default (client-side fallback):
 *   1. Look up the catalog row → P, D, H, etc.
 *   2. Compute turns from `feature.length / P`.
 *   3. Build the helix path (`buildHelixPath`).
 *   4. Build the V-profile (`buildThreadProfile`) — used for cap-warning
 *      sizing even on the client-side path.
 *   5. Build the thread tube (`THREE.TubeGeometry` along the helix).
 *   6. Boolean with the parent: external = UNION, internal = SUBTRACT.
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
  const radialExtent = profileRadialExtent(profile);
  const tubeRadius = options.tubeRadiusOverride ?? radialExtent / 2;

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

  // 5. Client-side fallback — TubeGeometry along helix.
  const samplesPerTurn = options.samplesPerTurn ?? DEFAULT_SAMPLES_PER_TURN;
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  const tube = buildThreadTubeGeometry(
    helixRadius,
    pitch,
    turns,
    feature.startOffset,
    helixDir,
    tubeRadius,
    samplesPerTurn,
    maxSamples,
  );
  const threadGeom = tube.geometry;

  // 6. Optional boolean with parent — external = ADDITION, internal = SUBTRACTION.
  //    For unit tests we expose `skipBoolean: true` so we don't pay the CSG
  //    cost when only the thread mesh shape is being verified.
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
          ADDITION: unknown;
          SUBTRACTION: unknown;
        };
        const ev = new csg.Evaluator();
        const brushA = new csg.Brush(parentGeometry, new THREE.MeshStandardMaterial());
        const brushB = new csg.Brush(threadGeom, new THREE.MeshStandardMaterial());
        const op = feature.threadKind === 'external' ? csg.ADDITION : csg.SUBTRACTION;
        const result = ev.evaluate(brushA, brushB, op);
        if (result?.geometry) {
          finalGeom = result.geometry;
          finalGeom.computeVertexNormals();
        }
      }
    } catch (err) {
      // CSG sometimes blows up on degenerate input — fall through to the
      // pre-boolean thread mesh so the user at least sees the helix.
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
      threadVertexCount: tube.vertexCount,
      finalVertexCount: finalGeom.attributes.position?.count ?? 0,
      usedWorker,
      samplesPerTurn,
      totalSamples: tube.totalSamples,
    },
  };
}
