/**
 * pattern — feature-agnostic linear and circular patterns.
 *
 * Phase 2.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Patterns are transforms applied to an already-built child feature.
 * Because the child can be ANY feature (extrude/revolve/sweep/loft/etc.),
 * the IR carries the child's serialized SCAD body as opaque string —
 * the pattern just wraps it in `for() translate(...)` or
 * `for() rotate(...)`.
 *
 * IR-first: an OCCT backend would receive `(childIR, transformList)`
 * instead of strings; the IR fields already model both options.
 *
 * Scope (Phase 2.4 minimal):
 *   - Linear pattern: N copies along a 3D direction, fixed spacing.
 *   - Circular pattern: N copies around a 3D axis, even angular step,
 *     total sweep ∈ (0°, 360°].
 *
 * Out of scope (later):
 *   - Sketch-driven pattern (positions from a sketch curve)
 *   - Variable spacing / non-uniform step
 *   - Skip-instances (mask out specific copies)
 *   - 2D rectangular grid as a single op (use 2 nested linear patterns)
 */

import type { EmitContext } from './featureTree';

// ─── shared types ─────────────────────────────────────────────────────────

export interface Vec3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ─── upstream resolution (W2-A) ───────────────────────────────────────────

/**
 * Resolve the SCAD body of the single instance this pattern stamps.
 *
 * Patterns differ from fillet/chamfer in WHICH accessor they need
 * (docs/design/w2-downstream-regen.md §2.2). Fillet reads the upstream's
 * geometric PARAMETERS (`loop`, `depth`) to compute a minkowski inset, so
 * it needs `requirePayload`. A pattern only replicates the upstream body
 * rigidly — it never inspects its geometry — so the already-rendered SCAD
 * is sufficient, and `requireScad` is the right accessor.
 *
 * That distinction also makes patterns strictly MORE general than
 * fillet/chamfer here: `requirePayload` pins the upstream to one kind
 * (`extrude`), whereas `requireScad` is kind-agnostic, so a pattern can
 * stamp a revolve, a loft, a boolean, or another pattern. This preserves
 * the pattern feature's founding promise ("the child can be ANY feature")
 * which the old `childScad: string` field delivered only by going stale.
 *
 * Two modes, chosen by the presence of `childId` — never by heuristics:
 *
 *   ref mode    (`childId` set): the LIVE rendered body from the replay in
 *                progress. A missing context is a hard error, never a
 *                silent fallback to the stale `childScad` text (ADR-017 D1).
 *   legacy mode (`childId` absent): the embedded `childScad` snapshot,
 *                byte-identical to pre-W2-A behaviour.
 */
export function resolvePatternChildScad(
  feature: { childId?: string; childScad: string },
  ctx: EmitContext | undefined,
  selfId: string,
  label: 'linear pattern' | 'circular pattern',
): string {
  if (feature.childId === undefined) return feature.childScad;
  if (!ctx) {
    throw new Error(
      `${label} '${selfId}' references upstream body '${feature.childId}' but was emitted ` +
        `without a tree context. Emit it via replayTree/incrementalReplay, or pass an ` +
        `EmitContext to the pattern serializer. (Refusing to fall back to the stale ` +
        `childScad snapshot.)`,
    );
  }
  return ctx.requireScad(feature.childId, selfId);
}

function assertChildId(childId: string, label: string): void {
  if (typeof childId !== 'string' || childId.length === 0) {
    throw new Error(`${label} childId must be a non-empty string, got: ${childId}`);
  }
}

// ─── linear ───────────────────────────────────────────────────────────────

export interface LinearPatternFeature {
  kind: 'linear_pattern';
  /**
   * W2-A — id of the upstream feature node supplying the body to replicate.
   * When present, emission resolves it via `EmitContext.requireScad` against
   * the tree being replayed and `childScad` is never read.
   */
  childId?: string;
  /**
   * Opaque SCAD body for one instance. Pattern just translates copies.
   *
   * @deprecated as an emission source once `childId` is set. This field is
   * ALREADY-RENDERED TEXT, so it is strictly worse than fillet's structured
   * `childExtrude` snapshot: it goes stale on any upstream edit and cannot
   * be re-parsed back into parameters. Kept only so legacy payloads keep
   * emitting unchanged during the incremental conversion.
   */
  childScad: string;
  /** Total copies including the original (so count=1 is a no-op). */
  count: number;
  /** Unit direction vector (not validated to be unit length; built-in normalize step). */
  direction: Vec3D;
  /** Distance between consecutive copies along `direction`. */
  spacing: number;
}

export interface LinearPatternOptions {
  childScad: string;
  count: number;
  direction: Vec3D;
  spacing: number;
}

export function buildLinearPattern(opts: LinearPatternOptions): LinearPatternFeature {
  if (!Number.isInteger(opts.count) || opts.count < 1) {
    throw new Error(`linear pattern count must be a positive integer, got ${opts.count}`);
  }
  if (opts.count > 1000) {
    throw new Error(`linear pattern count ${opts.count} exceeds 1000 (perf safety)`);
  }
  if (!Number.isFinite(opts.spacing) || opts.spacing <= 0) {
    throw new Error(`linear pattern spacing must be positive, got ${opts.spacing}`);
  }
  const dLen = Math.hypot(opts.direction.x, opts.direction.y, opts.direction.z);
  if (dLen < 1e-9) {
    throw new Error('linear pattern direction is zero-length');
  }
  const unit: Vec3D = {
    x: opts.direction.x / dLen,
    y: opts.direction.y / dLen,
    z: opts.direction.z / dLen,
  };
  return {
    kind: 'linear_pattern',
    childScad: opts.childScad,
    count: opts.count,
    direction: unit,
    spacing: opts.spacing,
  };
}

/**
 * W2-A — build a linear pattern that REFERENCES its seed body by node id.
 *
 * `childScadSnapshot` is the seed's rendered SCAD at build time, stored in
 * `childScad` purely for consumers not yet migrated off the embedded field.
 * Emission always re-resolves `childId` against the live tree.
 */
export function buildLinearPatternRef(
  childId: string,
  opts: LinearPatternOptions,
): LinearPatternFeature {
  assertChildId(childId, 'linear pattern');
  return { ...buildLinearPattern(opts), childId };
}

export function linearPatternToScad(
  f: LinearPatternFeature,
  ctx?: EmitContext,
  selfId = 'linear_pattern',
): string {
  // Inline form: `union() { translate(...) {child} translate(...) {child} ... }`
  // For larger counts we use `for () translate(...) child;` to keep the
  // SCAD source compact.
  const childScad = resolvePatternChildScad(f, ctx, selfId, 'linear pattern');
  const dx = f.direction.x * f.spacing;
  const dy = f.direction.y * f.spacing;
  const dz = f.direction.z * f.spacing;
  // Wrap child SCAD body in a module so we can stamp it cleanly inside the loop.
  const child = `module nexyfab_pattern_child() {\n${indent(childScad)}\n}`;
  const loop =
    `for (i = [0 : ${f.count - 1}])\n` +
    `  translate([${fmt(dx)} * i, ${fmt(dy)} * i, ${fmt(dz)} * i])\n` +
    `    nexyfab_pattern_child();`;
  return `${child}\n${loop}`;
}

// ─── circular ─────────────────────────────────────────────────────────────

export interface CircularPatternFeature {
  kind: 'circular_pattern';
  /**
   * W2-A — id of the upstream feature node supplying the body to replicate.
   * See `LinearPatternFeature.childId`.
   */
  childId?: string;
  /** @deprecated as an emission source once `childId` is set — see
   *  `LinearPatternFeature.childScad`. */
  childScad: string;
  count: number;
  axisOrigin: Vec3D;
  /** Axis direction, normalized internally. */
  axisDirection: Vec3D;
  /** Total angular sweep in degrees. count-1 spacings fit in this sweep. */
  totalAngleDegrees: number;
}

export interface CircularPatternOptions {
  childScad: string;
  count: number;
  axisOrigin: Vec3D;
  axisDirection: Vec3D;
  totalAngleDegrees?: number; // default 360 (full circle)
}

export function buildCircularPattern(opts: CircularPatternOptions): CircularPatternFeature {
  if (!Number.isInteger(opts.count) || opts.count < 2) {
    throw new Error(`circular pattern count must be ≥ 2, got ${opts.count}`);
  }
  if (opts.count > 1000) {
    throw new Error(`circular pattern count ${opts.count} exceeds 1000 (perf safety)`);
  }
  const angle = opts.totalAngleDegrees ?? 360;
  if (angle <= 0 || angle > 360 || !Number.isFinite(angle)) {
    throw new Error(`circular pattern angle must be in (0, 360], got ${angle}`);
  }
  const dLen = Math.hypot(opts.axisDirection.x, opts.axisDirection.y, opts.axisDirection.z);
  if (dLen < 1e-9) {
    throw new Error('circular pattern axis direction is zero-length');
  }
  const axisDirection: Vec3D = {
    x: opts.axisDirection.x / dLen,
    y: opts.axisDirection.y / dLen,
    z: opts.axisDirection.z / dLen,
  };
  return {
    kind: 'circular_pattern',
    childScad: opts.childScad,
    count: opts.count,
    axisOrigin: opts.axisOrigin,
    axisDirection,
    totalAngleDegrees: angle,
  };
}

/**
 * W2-A — build a circular pattern that REFERENCES its seed body by node id.
 * See `buildLinearPatternRef`.
 */
export function buildCircularPatternRef(
  childId: string,
  opts: CircularPatternOptions,
): CircularPatternFeature {
  assertChildId(childId, 'circular pattern');
  return { ...buildCircularPattern(opts), childId };
}

export function circularPatternToScad(
  f: CircularPatternFeature,
  ctx?: EmitContext,
  selfId = 'circular_pattern',
): string {
  // If the sweep is full 360°, the last copy at angle=360 overlaps the first
  // (i=0), so we drop the closing duplicate — step = 360/count, last i = count-1.
  // For partial sweep, we keep the endpoint inclusive — step = totalAngle / (count-1).
  const step =
    f.totalAngleDegrees === 360 ? 360 / f.count : f.totalAngleDegrees / (f.count - 1);

  const childScad = resolvePatternChildScad(f, ctx, selfId, 'circular pattern');
  const child = `module nexyfab_pattern_child() {\n${indent(childScad)}\n}`;
  // SCAD rotation around an arbitrary axis through a non-origin point:
  // translate(O) rotate(a=θ, v=axis) translate(-O) child;
  const ox = f.axisOrigin;
  const ad = f.axisDirection;
  const loop =
    `for (i = [0 : ${f.count - 1}])\n` +
    `  translate([${fmt(ox.x)}, ${fmt(ox.y)}, ${fmt(ox.z)}])\n` +
    `    rotate(a = i * ${fmt(step)}, v = [${fmt(ad.x)}, ${fmt(ad.y)}, ${fmt(ad.z)}])\n` +
    `      translate([${fmt(-ox.x)}, ${fmt(-ox.y)}, ${fmt(-ox.z)}])\n` +
    `        nexyfab_pattern_child();`;
  return `${child}\n${loop}`;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`pattern: non-finite number ${n}`);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}

function indent(s: string, prefix: string = '  '): string {
  return s
    .split('\n')
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join('\n');
}
