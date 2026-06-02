/**
 * holeProfile — Phase 2.7 of NexyFab Pro own-CAD (ADR-013).
 *
 * Standardized hole feature placed at a sketch point. A hole is modelled
 * as a `difference()` against the parent body: a translated cylinder (or
 * a small stack of cylinders for counterbore / countersink) is subtracted
 * from whatever solid is wrapped by the host pipeline at the
 * `// NEXYFAB:HOLE_CUT` marker.
 *
 * Why a dedicated IR (instead of re-using ExtrudeFeature with `mode:'cut'`)?
 *   - Holes carry standards metadata (ISO/ANSI tap-drill tables) the UI
 *     wizards depend on; a thin wrapper keeps that contract explicit.
 *   - Multi-step holes (counterbore + drill, countersink + drill) need a
 *     small stack of cylinders, not a single linear extrude.
 *   - Future Phase 2.7.x can extend this IR with threading metadata
 *     (callouts, thread relief grooves) without disturbing extrudeProfile.
 *
 * Scope (Phase 2.7 minimal):
 *   - 3 hole types: drilled / counterbore / countersink.
 *   - Single placement (a single (x,y) center).
 *   - Cylinder cuts only — no thread modelling, no chamfer at the drill
 *     entry, no bottom angle for the drill tip.
 *
 * Out of scope (Phase 2.7.x+):
 *   - Threaded holes (helix or visual thread modifier).
 *   - Tap-drill depth derived from thread pitch.
 *   - Through-hole detection (caller passes a depth ≥ parent thickness).
 */

// ─── IR ───────────────────────────────────────────────────────────────────

export type HoleType = 'drilled' | 'counterbore' | 'countersink';

export interface HoleFeature {
  kind: 'hole';
  /** (x,y) in sketch units (mm). Z is implicit: hole drills down from
   *  the top of the parent body. */
  center: { x: number; y: number };
  holeType: HoleType;
  /** Main bore diameter, mm. > 0. */
  diameter: number;
  /** Main bore depth, mm. > 0. */
  depth: number;
  /** Counterbore (cbore) larger top diameter — required when holeType is
   *  'counterbore'. > diameter. */
  counterboreDiameter?: number;
  /** Counterbore depth, mm — required for 'counterbore'. > 0. */
  counterboreDepth?: number;
  /** Countersink (csink) included angle in degrees — required when
   *  holeType is 'countersink'. ISO 7721 standard is 90°; ANSI 100°.
   *  Allowed range [82, 135] covers the common machine-screw chart. */
  countersinkAngleDegrees?: number;
  /** Countersink head depth (the chamfered cone height), mm — required
   *  for 'countersink'. > 0. */
  countersinkDepth?: number;
}

// ─── builders ─────────────────────────────────────────────────────────────

export interface HoleOptions {
  center: { x: number; y: number };
  holeType: HoleType;
  diameter: number;
  depth: number;
  counterboreDiameter?: number;
  counterboreDepth?: number;
  countersinkAngleDegrees?: number;
  countersinkDepth?: number;
}

const COUNTERSINK_MIN_ANGLE = 82;
const COUNTERSINK_MAX_ANGLE = 135;

/**
 * Build a HoleFeature from raw options. Validates dimensions; throws Error
 * with a specific message on first violation (mirrors buildExtrudeFromLoop).
 */
export function buildHoleFeature(opts: HoleOptions): HoleFeature {
  if (!opts.center || !Number.isFinite(opts.center.x) || !Number.isFinite(opts.center.y)) {
    throw new Error('hole center must have finite x,y coordinates');
  }
  if (!Number.isFinite(opts.diameter) || opts.diameter <= 0) {
    throw new Error(`hole diameter must be positive, got: ${opts.diameter}`);
  }
  if (!Number.isFinite(opts.depth) || opts.depth <= 0) {
    throw new Error(`hole depth must be positive, got: ${opts.depth}`);
  }
  if (opts.holeType === 'counterbore') {
    if (!Number.isFinite(opts.counterboreDiameter) || (opts.counterboreDiameter ?? 0) <= 0) {
      throw new Error('counterbore requires counterboreDiameter > 0');
    }
    if ((opts.counterboreDiameter ?? 0) <= opts.diameter) {
      throw new Error(
        `counterbore diameter (${opts.counterboreDiameter}) must be greater than bore diameter (${opts.diameter})`,
      );
    }
    if (!Number.isFinite(opts.counterboreDepth) || (opts.counterboreDepth ?? 0) <= 0) {
      throw new Error('counterbore requires counterboreDepth > 0');
    }
  }
  if (opts.holeType === 'countersink') {
    const a = opts.countersinkAngleDegrees;
    if (!Number.isFinite(a) || (a as number) < COUNTERSINK_MIN_ANGLE || (a as number) > COUNTERSINK_MAX_ANGLE) {
      throw new Error(
        `countersink angle must be in [${COUNTERSINK_MIN_ANGLE}, ${COUNTERSINK_MAX_ANGLE}] degrees, got: ${a}`,
      );
    }
    if (!Number.isFinite(opts.countersinkDepth) || (opts.countersinkDepth ?? 0) <= 0) {
      throw new Error('countersink requires countersinkDepth > 0');
    }
  }
  return {
    kind: 'hole',
    center: { x: opts.center.x, y: opts.center.y },
    holeType: opts.holeType,
    diameter: opts.diameter,
    depth: opts.depth,
    counterboreDiameter: opts.counterboreDiameter,
    counterboreDepth: opts.counterboreDepth,
    countersinkAngleDegrees: opts.countersinkAngleDegrees,
    countersinkDepth: opts.countersinkDepth,
  };
}

// ─── ISO/ANSI standards table ─────────────────────────────────────────────

/**
 * Standard thread specs accepted by `tapDrillDiameter`. ISO metric (M*)
 * plus the most common UNC inch sizes (1/4-20, 5/16-18, 3/8-16, 1/2-13).
 *
 * Values are the recommended **tap drill** diameter (the hole drilled
 * before tapping the thread), in mm. Sourced from:
 *   - ISO 2306:1972 (metric coarse): M3=2.5, M4=3.3, M5=4.2, M6=5.0,
 *     M8=6.8, M10=8.5, M12=10.2.
 *   - ANSI/ASME B1.1 (UNC inch, converted to mm):
 *       1/4-20 → #7 drill = 5.105 mm
 *       5/16-18 → F drill = 6.527 mm
 *       3/8-16 → 5/16" drill = 7.938 mm
 *       1/2-13 → 27/64" drill = 10.716 mm
 */
export type ThreadSpec =
  | 'M3' | 'M4' | 'M5' | 'M6' | 'M8' | 'M10' | 'M12'
  | '1/4-20' | '5/16-18' | '3/8-16' | '1/2-13';

const TAP_DRILL_TABLE: Record<ThreadSpec, number> = {
  // ISO metric coarse (mm).
  M3: 2.5,
  M4: 3.3,
  M5: 4.2,
  M6: 5.0,
  M8: 6.8,
  M10: 8.5,
  M12: 10.2,
  // ANSI UNC inch, converted to mm to keep the IR units consistent.
  '1/4-20': 5.105,
  '5/16-18': 6.527,
  '3/8-16': 7.938,
  '1/2-13': 10.716,
};

export function tapDrillDiameter(threadSpec: ThreadSpec): number {
  const d = TAP_DRILL_TABLE[threadSpec];
  if (d === undefined) {
    throw new Error(`unknown thread spec: ${threadSpec}`);
  }
  return d;
}

/** Enumeration helper for UI dropdowns. */
export const TAP_DRILL_SPECS: ReadonlyArray<ThreadSpec> = Object.freeze([
  'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12',
  '1/4-20', '5/16-18', '3/8-16', '1/2-13',
]);

// ─── SCAD serializer ──────────────────────────────────────────────────────

/**
 * Convert a HoleFeature to an OpenSCAD source string. The output is a
 * `translate([cx, cy, ...]) { cylinder(...); }` block wrapped with a
 * sentinel `// NEXYFAB:HOLE_CUT` marker — the host pipeline pattern-matches
 * the marker to splice this into a `difference(parent_body, hole)` call.
 *
 * The hole cylinders are oriented so their top sits at z=0 (the parent
 * body's top face) and they extend downward (negative Z). A small "ε"
 * overshoot (0.01 mm) on top + bottom prevents zero-thickness shell faces
 * in OpenSCAD's CGAL pipeline.
 */
export function holeToScad(feature: HoleFeature): string {
  const cx = formatNum(feature.center.x);
  const cy = formatNum(feature.center.y);
  const epsilon = 0.01;

  const bores: string[] = [];

  // Main bore (always present).
  const boreD = formatNum(feature.diameter);
  const boreH = formatNum(feature.depth + epsilon);
  // translate Z so cylinder top is at z=+epsilon (poke up above parent's
  // top face) and bottom sits at z=-(depth).
  bores.push(
    `translate([0, 0, -${formatNum(feature.depth)}]) cylinder(h=${boreH}, d=${boreD}, $fn=64);`,
  );

  if (feature.holeType === 'counterbore') {
    const cbD = formatNum(feature.counterboreDiameter!);
    const cbH = formatNum(feature.counterboreDepth! + epsilon);
    // Counterbore sits flush with the top face, depth downward.
    bores.push(
      `translate([0, 0, -${formatNum(feature.counterboreDepth!)}]) cylinder(h=${cbH}, d=${cbD}, $fn=64);`,
    );
  }

  if (feature.holeType === 'countersink') {
    // Countersink cone: bottom diameter = bore d, top diameter = bore d +
    // 2 * csinkDepth * tan(angle/2).  cylinder(h=csinkDepth, d1=bore_d,
    // d2=top_d). Top sits at z=0 (parent top face), bottom at z=-csinkDepth.
    const angle = feature.countersinkAngleDegrees!;
    const csinkDepth = feature.countersinkDepth!;
    const halfAngleRad = (angle / 2) * (Math.PI / 180);
    const topD = feature.diameter + 2 * csinkDepth * Math.tan(halfAngleRad);
    const d1 = formatNum(feature.diameter);
    const d2 = formatNum(topD);
    const csinkH = formatNum(csinkDepth + epsilon);
    bores.push(
      `translate([0, 0, -${formatNum(csinkDepth)}]) cylinder(h=${csinkH}, d1=${d1}, d2=${d2}, $fn=64);`,
    );
  }

  const inner = bores.map((b) => `  ${b}`).join('\n');
  return `// NEXYFAB:HOLE_CUT\ntranslate([${cx}, ${cy}, 0]) {\n${inner}\n}`;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`hole: non-finite number ${n}`);
  // 4-decimal precision matches extrudeProfile.formatNum for diff-friendly
  // determinism across all CAD modules.
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}
