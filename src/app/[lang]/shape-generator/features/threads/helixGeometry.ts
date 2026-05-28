/**
 * helixGeometry.ts — Wave 2 Phase 2 Track D7 (W7) pure-math helix path.
 *
 * Centerline sampler for the geometric thread sweep. This is the **client-side**
 * companion to the existing `sketch3d/helix.ts` (which is a more general,
 * cone/spiral-capable helper). D7 needs a narrower contract:
 *
 *   - mm-scale numerics, +Z axis only (parent cylinder convention)
 *   - direction encoded as `'right_hand' | 'left_hand'` (matches ThreadFeature)
 *   - parametric `t ∈ [0, 1]` mapping with a fixed sampling budget
 *   - returns plain `Vec3` tuples (no Three.js dependency in this file —
 *     keeps the math testable in isolation, and so a future worker port can
 *     reuse it verbatim)
 *
 * Sampling rate (spec ambiguity resolution):
 *   - ~16 samples per turn is the visual-smoothness floor (matches §7.3
 *     "draft" quality). The geometric path uses 16 to keep per-feature
 *     latency under the 100 ms budget at all sizes.
 *   - Hard cap at 256 total samples — a thread with 16+ turns would otherwise
 *     blow the budget. Anything beyond that produces a perceptually-identical
 *     mesh anyway because the per-triangle screen footprint shrinks.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §7 (algorithm), §7.3 (frame
 * stability), §11 (perf budget).
 *
 * Out of scope:
 * - Tapered helix (NPT / BSPT) — `sketch3d/helix.ts` `taperedHelix` covers
 *   that and is wired by the worker path; D7 ships parallel-axis (cylindrical)
 *   helix only because the client-side fallback is for the common case.
 * - Frenet-frame parallel-transport — that lives inside the sweep builder
 *   (`applyThreadGeometric.ts`); this file only emits the centerline.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Plain `[x, y, z]` tuple — avoids a Three.js dependency in pure-math code. */
export type Vec3 = readonly [number, number, number];

/**
 * Right-handed thread (the default — turn the bolt CW to drive it in) winds
 * counter-clockwise when viewed from +Z looking down. Left-handed reverses
 * the sin sign so the helix winds the other way.
 */
export type HelixDirection = 'right_hand' | 'left_hand';

export interface HelixSpec {
  /** Axis direction (unit-ish). D7 only supports +Z (parent-cylinder convention). */
  axis: Vec3;
  /** Helix radius in mm. */
  radius: number;
  /** Pitch in mm — height gained per full turn. */
  pitch: number;
  /** Number of turns (can be fractional, e.g. 16.5). Must be > 0. */
  turns: number;
  /** Starting offset along the axis (mm) — applied to every z component. */
  startOffset: number;
  /** Right-hand winds CCW from +Z; left-hand winds CW. */
  direction: HelixDirection;
}

/** Optional sampling tuning. Defaults match the W7 budget. */
export interface HelixSamplingOptions {
  /** Samples per full turn. Default 16 (matches "draft" quality §7.3). */
  samplesPerTurn?: number;
  /** Hard upper bound on the returned point count. Default 256. */
  maxSamples?: number;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

/** Visual-smoothness floor — below this the sweep visibly facets. */
export const DEFAULT_SAMPLES_PER_TURN = 16;
/** Hard cap on total points — prevents very long threads from blowing perf. */
export const DEFAULT_MAX_SAMPLES = 256;

// ─── Validation ─────────────────────────────────────────────────────────────

function ensureFinite(name: string, v: number): number {
  if (!Number.isFinite(v)) {
    throw new Error(`helixGeometry: ${name} must be a finite number (got ${v})`);
  }
  return v;
}

function ensurePositive(name: string, v: number): number {
  ensureFinite(name, v);
  if (v <= 0) throw new Error(`helixGeometry: ${name} must be > 0 (got ${v})`);
  return v;
}

// ─── Path builder ───────────────────────────────────────────────────────────

/**
 * Build a helical centerline as a list of `Vec3` points.
 *
 * Parametric form (axis = +Z):
 *
 *   t ∈ [0, 1]
 *   x = r · cos(2π · n · t · dirSign)
 *   y = r · sin(2π · n · t · dirSign)
 *   z = startOffset + pitch · n · t
 *
 * where `n = turns` and `dirSign = +1` for right-hand, `-1` for left-hand.
 *
 * Right-hand convention: viewed from +Z looking down at the +XY plane, the
 * helix winds **counter-clockwise** as z increases (this matches every
 * mainstream CAD convention including SolidWorks / Onshape / Inventor).
 * Left-hand inverts the winding (negative sin) but the z-progression stays
 * positive — LH does not move "down", it moves up while winding the other way.
 *
 * Sampling:
 *   - `samplesPerTurn × turns + 1` would be the natural count (so the curve
 *     closes properly on the last sample).
 *   - Capped at `maxSamples` total.
 *
 * @throws if `turns <= 0`, `pitch <= 0`, or `radius <= 0`.
 */
export function buildHelixPath(
  spec: HelixSpec,
  options: HelixSamplingOptions = {},
): Vec3[] {
  ensurePositive('radius', spec.radius);
  ensurePositive('pitch', spec.pitch);
  ensurePositive('turns', spec.turns);
  ensureFinite('startOffset', spec.startOffset);

  // D7 only supports +Z axis; we read the axis prop for future-proofing but
  // assert the +Z assumption explicitly so future callers don't silently feed
  // an arbitrary axis and get bogus geometry.
  if (spec.axis[0] !== 0 || spec.axis[1] !== 0 || spec.axis[2] !== 1) {
    throw new Error(
      `helixGeometry: only +Z axis is supported in D7 (got [${spec.axis.join(', ')}]). ` +
        `Wave 2 worker port (task #31) lifts this restriction.`,
    );
  }

  const samplesPerTurn = Math.max(2, Math.floor(options.samplesPerTurn ?? DEFAULT_SAMPLES_PER_TURN));
  const maxSamples = Math.max(2, Math.floor(options.maxSamples ?? DEFAULT_MAX_SAMPLES));

  // Natural sample count = samplesPerTurn × turns + 1 closing sample.
  const naturalCount = Math.ceil(spec.turns * samplesPerTurn) + 1;
  const totalSamples = Math.min(naturalCount, maxSamples);

  const dirSign = spec.direction === 'right_hand' ? 1 : -1;
  const twoPiN = 2 * Math.PI * spec.turns;
  const r = spec.radius;
  const z0 = spec.startOffset;
  const dz = spec.pitch * spec.turns; // total height change along axis

  const out: Vec3[] = new Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const t = totalSamples === 1 ? 0 : i / (totalSamples - 1);
    const angle = twoPiN * t;
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle) * dirSign;
    const z = z0 + dz * t;
    out[i] = [x, y, z] as const;
  }
  return out;
}

// ─── Derived helpers ────────────────────────────────────────────────────────

/**
 * Number of turns required to cover a given thread length. Threads in CAD
 * are specified by length-along-axis, not turn count — this is the inverse
 * conversion.
 *
 * @example
 *   helixTurnsForLength(20, 1.25) // M8 × 20mm → 16 turns
 */
export function helixTurnsForLength(lengthMm: number, pitchMm: number): number {
  ensurePositive('pitchMm', pitchMm);
  ensureFinite('lengthMm', lengthMm);
  if (lengthMm <= 0) return 0;
  return lengthMm / pitchMm;
}

/**
 * Compute the (tangent, normal, binormal) frame at a given parameter `t` on
 * the helix, used by the sweep builder to orient the V-profile cross-section
 * (§7 step 4 "frenet frame keeps the V's bisector radial").
 *
 * For a circular helix on +Z axis, the analytical Frenet frame is:
 *   T = (-sin θ · 2πn, cos θ · dirSign · 2πn, pitch · n) / |·|
 *   N = (-cos θ, -sin θ · dirSign, 0)       // points radially INWARD
 *   B = T × N
 *
 * Returns unit vectors. Throws if `t` is outside `[0, 1]`.
 */
export function helixFrameAt(spec: HelixSpec, t: number): {
  tangent: Vec3;
  normal: Vec3;
  binormal: Vec3;
} {
  if (!Number.isFinite(t) || t < 0 || t > 1) {
    throw new Error(`helixGeometry.helixFrameAt: t must be in [0,1] (got ${t})`);
  }
  ensurePositive('radius', spec.radius);
  ensurePositive('pitch', spec.pitch);
  ensurePositive('turns', spec.turns);

  const dirSign = spec.direction === 'right_hand' ? 1 : -1;
  const twoPiN = 2 * Math.PI * spec.turns;
  const angle = twoPiN * t;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Tangent — derivative of p(t) wrt t, then normalised.
  // dx/dt = -r · twoPiN · sin
  // dy/dt =  r · twoPiN · cos · dirSign
  // dz/dt =  pitch · turns
  const tx = -spec.radius * twoPiN * sin;
  const ty = spec.radius * twoPiN * cos * dirSign;
  const tz = spec.pitch * spec.turns;
  const tLen = Math.hypot(tx, ty, tz);
  const tangent: Vec3 = [tx / tLen, ty / tLen, tz / tLen];

  // Normal — points radially inward (toward axis).
  const normal: Vec3 = [-cos, -sin * dirSign, 0];

  // Binormal — T × N, normalised.
  const bx = tangent[1] * normal[2] - tangent[2] * normal[1];
  const by = tangent[2] * normal[0] - tangent[0] * normal[2];
  const bz = tangent[0] * normal[1] - tangent[1] * normal[0];
  const bLen = Math.hypot(bx, by, bz);
  const binormal: Vec3 = [bx / bLen, by / bLen, bz / bLen];

  return { tangent, normal, binormal };
}

/**
 * Helper for callers that only have a `(length, pitch)` thread spec — wraps
 * `buildHelixPath` and computes turns automatically.
 */
export function buildHelixPathForThread(opts: {
  radius: number;
  pitch: number;
  lengthMm: number;
  startOffset?: number;
  direction?: HelixDirection;
  samplesPerTurn?: number;
  maxSamples?: number;
}): Vec3[] {
  return buildHelixPath(
    {
      axis: [0, 0, 1],
      radius: opts.radius,
      pitch: opts.pitch,
      turns: helixTurnsForLength(opts.lengthMm, opts.pitch),
      startOffset: opts.startOffset ?? 0,
      direction: opts.direction ?? 'right_hand',
    },
    {
      samplesPerTurn: opts.samplesPerTurn,
      maxSamples: opts.maxSamples,
    },
  );
}
