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

// ─── shared types ─────────────────────────────────────────────────────────

export interface Vec3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ─── linear ───────────────────────────────────────────────────────────────

export interface LinearPatternFeature {
  kind: 'linear_pattern';
  /** Opaque SCAD body for one instance. Pattern just translates copies. */
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

export function linearPatternToScad(f: LinearPatternFeature): string {
  // Inline form: `union() { translate(...) {child} translate(...) {child} ... }`
  // For larger counts we use `for () translate(...) child;` to keep the
  // SCAD source compact.
  const dx = f.direction.x * f.spacing;
  const dy = f.direction.y * f.spacing;
  const dz = f.direction.z * f.spacing;
  // Wrap child SCAD body in a module so we can stamp it cleanly inside the loop.
  const child = `module nexyfab_pattern_child() {\n${indent(f.childScad)}\n}`;
  const loop =
    `for (i = [0 : ${f.count - 1}])\n` +
    `  translate([${fmt(dx)} * i, ${fmt(dy)} * i, ${fmt(dz)} * i])\n` +
    `    nexyfab_pattern_child();`;
  return `${child}\n${loop}`;
}

// ─── circular ─────────────────────────────────────────────────────────────

export interface CircularPatternFeature {
  kind: 'circular_pattern';
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

export function circularPatternToScad(f: CircularPatternFeature): string {
  // If the sweep is full 360°, the last copy at angle=360 overlaps the first
  // (i=0), so we drop the closing duplicate — step = 360/count, last i = count-1.
  // For partial sweep, we keep the endpoint inclusive — step = totalAngle / (count-1).
  const step =
    f.totalAngleDegrees === 360 ? 360 / f.count : f.totalAngleDegrees / (f.count - 1);

  const child = `module nexyfab_pattern_child() {\n${indent(f.childScad)}\n}`;
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
