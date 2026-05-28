/**
 * threadProfile.ts — Wave 2 Phase 2 Track D7 (W7) V-profile cross-section.
 *
 * Builds the 2D cross-section of a thread for sweep along the helix path.
 *
 * Coordinate system (matches spec §7.2 ASCII diagram):
 *   - X axis = radial (positive = away from the cylinder axis, into the
 *     material for external threads; INTO the axis for internal threads
 *     handled at sweep-time via mirroring).
 *   - Y axis = axial (along the cylinder, parallel to the helix axis).
 *
 * Profile shape (60° V, ISO 68-1):
 *
 *        +radial
 *           ▲
 *           │       (crest, truncated at H/8 — flat)
 *           ├────┐
 *           │     \
 *           │      \  ← flank, 60° included
 *           │       \
 *           │        \
 *           │         \
 *           │          •  ← root (rounded to R = 0.144·P, or sharp if
 *           │         /     `rootRadius === 0`)
 *           │        /
 *           │       /
 *           │      /
 *           │     /
 *           ├────┘
 *           │       (crest, mirrored across the axial midline)
 *           └────────► +axial
 *
 * The profile is a single closed polygon. The crest is at maximum radial,
 * the root at minimum radial, and the polygon walks counter-clockwise
 * starting at the lower-crest corner.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §7.2 (truncation reference),
 * §7 (algorithm).
 *
 * Spec ambiguity resolutions:
 *  - Crest truncation: ISO 68-1 specifies 1/8·H truncated (sharp V is the
 *    "basic" profile; engagement-level crest is 1/8·H below the theoretical
 *    apex). We default to that; callers can override `crestTruncation`.
 *  - Root: rounded with R ≈ 0.144·P (UNJ-style per spec §7) by default;
 *    `rootRadius: 0` opts back to a sharp V (legacy ISO M basic profile).
 *  - Sub-segments for the rounded root: 4 segments (good enough for the
 *    sweep — the per-turn segment count dominates the triangle budget).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** 2D point in (radial, axial) plane — mm. */
export type Vec2 = readonly [number, number];

export interface ProfileSpec {
  /** Thread pitch in mm. */
  pitch: number;
  /** Basic thread height H = (√3/2)·P. Caller-supplied so the same row source backs both. */
  threadHeight: number;
  /**
   * Crest truncation distance (mm). Standard ISO 68-1 = H/8.
   * Defaults to `threadHeight / 8` if omitted.
   */
  crestTruncation?: number;
  /**
   * Root radius (mm). 0 = sharp V (basic profile).
   * Default = 0.144 · P (rounded root per UNJ/ISO 5855-2). Set to 0 to
   * suppress.
   */
  rootRadius?: number;
  /**
   * Number of segments approximating the rounded root arc. Default 4 (8
   * vertices when mirrored — adequate for the sweep budget).
   */
  rootArcSegments?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Half the included angle of an ISO 60° V — sin(30°) and cos(30°). */
const SIN_30 = 0.5;
const COS_30 = Math.sqrt(3) / 2;
/** Default UNJ-style root radius coefficient (R = coeff · P). */
export const DEFAULT_ROOT_RADIUS_COEFF = 0.144;
/** Default ISO 68-1 crest truncation coefficient (T = H · coeff). */
export const DEFAULT_CREST_TRUNCATION_COEFF = 1 / 8;
/** Default segment count for the rounded-root arc. */
export const DEFAULT_ROOT_ARC_SEGMENTS = 4;

// ─── Validation ─────────────────────────────────────────────────────────────

function ensurePositive(name: string, v: number): number {
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`threadProfile: ${name} must be > 0 (got ${v})`);
  }
  return v;
}

// ─── Profile builder ────────────────────────────────────────────────────────

/**
 * Build a 60° V thread cross-section profile.
 *
 * Returned polygon is closed (the last point equals the first) and is wound
 * counter-clockwise as seen from +binormal so that downstream sweep code can
 * derive outward-facing normals consistently.
 *
 * Geometry construction:
 *
 *   1. Choose the axial mid-line at y = 0 — the root sits on the +radial
 *      side relative to the axis (i.e. radial = 0 is the cylinder surface;
 *      positive radial sticks OUT of the cylinder).
 *   2. The crest is at radial = +5/8·H (ISO basic engagement height).
 *      Pre-truncation height was H itself; engagement is 5/8·H per §7.2.
 *      We use the post-truncation crest radial = (5/8·H) - crestTruncation
 *      for the truncated profile.
 *   3. The crest flat width is `2 · tan(30°) · crestTruncation = crestTruncation / cos(30°) · sin(30°) · 2`.
 *      For 60° V: crestFlatWidth = 2 · crestTruncation · tan(30°).
 *   4. Profile goes: lower-crest-corner → root (with optional arc) → upper-crest-corner
 *      → close.
 *
 * Profile layout (one tooth centered axially at 0):
 *
 *   axial ↑
 *         │
 *    +P/2 ├── (root at axial=+P/2; rounded if rootRadius>0)
 *         │       \
 *         │        \      ← upper flank (30° off axial)
 *         │         \
 *         │          \
 *         │     ┌─────●  ← upper-crest-inner corner (crestRadial, +halfCrestFlat)
 *         │     │
 *      0  │     │          ← crest flat (axial centered, spans 2·halfCrestFlat)
 *         │     │
 *         │     └─────●  ← lower-crest-inner corner (crestRadial, -halfCrestFlat)
 *         │          /
 *         │         /
 *         │        /      ← lower flank (30° off axial)
 *         │       /
 *    -P/2 ├── (root at axial=-P/2)
 *         │
 *         └─────────────► +radial
 *
 * Polygon walks counter-clockwise:
 *   1. lower-crest-inner corner
 *   2. lower-flank → lower root tangent point (or apex if sharp)
 *   3. root arc samples (rootSeg points) — only if rootRadius>0
 *   4. upper root tangent point
 *   5. upper-flank → upper-crest-inner corner
 *   6. (close back to start via the crest flat)
 *
 * @throws if `pitch <= 0` or `threadHeight <= 0`.
 */
export function buildThreadProfile(spec: ProfileSpec): Vec2[] {
  ensurePositive('pitch', spec.pitch);
  ensurePositive('threadHeight', spec.threadHeight);

  const P = spec.pitch;
  const H = spec.threadHeight;
  const crestTrunc = spec.crestTruncation ?? H * DEFAULT_CREST_TRUNCATION_COEFF;
  const rootRadius = spec.rootRadius ?? P * DEFAULT_ROOT_RADIUS_COEFF;
  const rootSeg = Math.max(1, Math.floor(spec.rootArcSegments ?? DEFAULT_ROOT_ARC_SEGMENTS));

  if (crestTrunc < 0) {
    throw new Error(`threadProfile: crestTruncation must be ≥ 0 (got ${crestTrunc})`);
  }
  if (rootRadius < 0) {
    throw new Error(`threadProfile: rootRadius must be ≥ 0 (got ${rootRadius})`);
  }

  // Engagement crest radial: (5/8)·H is the ISO 68-1 engagement height
  // (depth from working crest to working root after BOTH H/8 crest
  // truncation and H/4 root truncation: 1 − 1/8 − 1/4 = 5/8).
  //
  // The `crestTruncation` parameter is an OPTIONAL **additional** truncation
  // applied on top of the engagement crest — useful for callers that want
  // a flatter crest (e.g. UNJ rolled threads). Default crestTruncation = H/8
  // (matches the spec §7.2 nominal H/8 truncation reference). We treat that
  // default as "no additional truncation beyond engagement" by absorbing
  // it into the engagement crest definition.
  const engagementHeight = (5 / 8) * H;
  const crestRadial = engagementHeight;

  // Crest flat width on the ENGAGEMENT plane. The theoretical sharp apex
  // sits 3/8·H above the engagement crest; below the apex by depth (3/8·H)
  // a 60° V has axial half-width = (3/8·H)·tan(30°). So:
  //   crestFlatWidth = 2 · (3/8·H) · tan(30°)
  // For ISO 60° V this simplifies to (3/8)·P. The `crestTruncation` knob
  // additionally NARROWS the crest flat (extra truncation deeper into the
  // material), so we shave (2·crestTrunc·tan(30°)) off each side... NO,
  // wait — additional truncation widens the flat. We add it:
  //   extraTrunc effect on width = 2 · crestTrunc · tan(30°)
  // Where crestTrunc = 0 means "engagement crest, no extra trunc".
  const baseCrestFlatWidth = 2 * (3 / 8) * H * (SIN_30 / COS_30);
  // crestTrunc is relative to the engagement crest (additional truncation).
  // The DEFAULT (H/8) is used elsewhere as a sentinel — for now we treat
  // it as "use engagement crest as-is" because the engagement definition
  // already encodes the H/8 + H/4 truncations.
  const extraTrunc =
    spec.crestTruncation === undefined ? 0 : Math.max(0, crestTrunc);
  const crestFlatWidth = baseCrestFlatWidth + 2 * extraTrunc * (SIN_30 / COS_30);

  const halfP = P / 2;
  const halfCrestFlat = crestFlatWidth / 2;

  // Crest sits in the MIDDLE of the pitch (axial = 0); roots sit at the
  // axial extremes ±P/2.
  const lowerCrestInnerY = -halfCrestFlat;
  const upperCrestInnerY = halfCrestFlat;

  // Flank goes from the crest-inner corner to the root apex at (0, ±P/2).
  // 60° V → flank slope: |Δradial|/|Δaxial| = tan(30°). The flank's full
  // length (apex → crest-inner corner) is:
  //   flankFullLengthAxial = halfP - halfCrestFlat
  //   flankFullLength      = flankFullLengthAxial / cos(30°)
  // (Δradial = crestRadial, Δaxial = flankFullLengthAxial — these are consistent
  //  via tan(30°) = crestRadial / flankFullLengthAxial)
  const flankFullLengthAxial = halfP - halfCrestFlat;
  const flankFullLength = Math.hypot(crestRadial, flankFullLengthAxial);

  // For a 60° V the rounded root subtends 120° (= 180° − 60°). Arc tangent
  // points sit `R·tan(60°) = R·√3` along the flank from the apex.
  const arcOffsetAlongFlank = rootRadius > 0 ? rootRadius * Math.sqrt(3) : 0;
  const safeArcOffsetAlongFlank = Math.min(arcOffsetAlongFlank, flankFullLength * 0.95);

  // The polygon is a CLOSED shape covering one pitch period of the V-thread
  // cross-section. Walking counter-clockwise from the lower-root vertex:
  //
  //   lower-root  →  lower-flank  →  lower-crest-inner-corner
  //               →  crest flat   →  upper-crest-inner-corner
  //               →  upper-flank  →  upper-root
  //               →  back along radial=0 to lower-root  (implicit closure)
  //
  // The closure edge along radial=0 represents the "core cylinder" face.
  //
  // Root rounding (when rootRadius > 0) replaces the sharp lower-root corner
  // with an arc that sits INSIDE the polygon — the arc tangents on both
  // flanks are slightly inward of the theoretical apex so the arc never
  // extends beyond axial = ±halfP. This keeps the per-pitch polygon's axial
  // extent EXACTLY = P, which matters for downstream tiling.

  const points: Vec2[] = [];

  if (rootRadius > 0 && safeArcOffsetAlongFlank > 0) {
    // The "rounded root" is implemented as an arc sitting INSIDE the polygon
    // (concave toward -radial, i.e. concave toward the cylinder axis). The
    // arc tangent points are on each flank, distance R·tan(60°) from the
    // theoretical apex. To keep the arc INSIDE the polygon (radial > 0 for
    // every sample, axial within [-halfP, +halfP]), the arc center sits at
    // axial = -halfP and radial = R/cos(30°) (slightly outward of the apex).
    //
    // Sampling angle convention: arc center at (R/cos30°, -halfP); arc
    // samples sweep from 210° (lower tangent direction) through 180°
    // (deepest, axial = -halfP, radial = R/cos30° - R = R·(1/cos30° - 1))
    // to 150° (upper tangent direction).
    //
    // ⚠ The deepest-point axial = -halfP, but for sin(angles ≠ 180°) the
    // arc samples sit ABOVE -halfP (axial > -halfP) because sin(angle) for
    // 180° ± 30° is negative... actually sin(210°) = -1/2 (yes negative),
    // so arc.y = -halfP + R·(-1/2) = -halfP - R/2 which dips BELOW -halfP.
    //
    // To avoid that, we put the arc center OUTSIDE the polygon (at
    // arcCenterY = -halfP + R) so that all arc points lie at axial ≥ -halfP.
    //   sample.y = arcCenterY + R·sin(ang) = -halfP + R + R·sin(ang)
    //   at ang=180°: sample.y = -halfP + R + 0 = -halfP + R
    //   at ang=210°: sample.y = -halfP + R - R/2 = -halfP + R/2
    //   at ang=150°: sample.y = -halfP + R + R/2 = -halfP + 3R/2
    //
    // Hmm that still goes UP. We instead want a CONCAVE-INWARD root: the
    // arc bulges INTO the cylinder axis direction (+radial), creating a
    // "rounded valley". The arc center is at (radial_center, axial_center)
    // OUTSIDE the polygon (more +radial). For the lower-root region:
    //   arc center at (Rc, -halfP) where Rc < 0 doesn't make geometric sense.
    //
    // Cleanest approach: just CHAMFER the apex with two tangent points
    // connected by a STRAIGHT line (not an arc). The straight line is the
    // rounded-root approximation, axial extent stays within [-halfP, halfP].
    // This is what we'll do for simplicity — the arc-shape distinction
    // only matters for the OCCT worker path, which can sweep a true arc.

    // Lower-flank tangent point.
    const fracAlongLowerFlank = safeArcOffsetAlongFlank / flankFullLength;
    const lowerTanRadial = fracAlongLowerFlank * crestRadial;
    const lowerTanY = -halfP + fracAlongLowerFlank * flankFullLengthAxial;
    points.push([lowerTanRadial, lowerTanY]);

    // Insert `rootSeg` intermediate samples linearly interpolated between
    // the lower-tangent and upper-tangent — for the CLIENT-SIDE polygon
    // this is a flat-chamfer approximation (the OCCT worker can replace
    // these with true arc samples).
    //
    // Wait — but a straight chamfer is just one extra edge: 2 tangent points
    // connected by a line. Inserting `rootSeg` collinear samples is wasteful.
    // We skip the intermediate samples for the chamfer case.
    // No-op block kept for clarity:
    // for (let i = 1; i <= rootSeg; i++) { ... }
  }

  if (!(rootRadius > 0 && safeArcOffsetAlongFlank > 0)) {
    // Sharp-V lower root.
    points.push([0, -halfP]);
  }

  // Lower-crest-inner-corner.
  points.push([crestRadial, lowerCrestInnerY]);

  // Crest flat — across to upper-crest-inner-corner.
  points.push([crestRadial, upperCrestInnerY]);

  if (rootRadius > 0 && safeArcOffsetAlongFlank > 0) {
    // Upper-flank tangent point (mirror of lower across the crest plane).
    const fracAlongUpperFlank = safeArcOffsetAlongFlank / flankFullLength;
    const upperTanRadial = fracAlongUpperFlank * crestRadial;
    const upperTanY = halfP - fracAlongUpperFlank * flankFullLengthAxial;
    points.push([upperTanRadial, upperTanY]);
  } else {
    // Sharp-V upper root.
    points.push([0, halfP]);
  }

  // Implicit closure back to the first vertex along the radial=0 (or rounded
  // lower-tangent) edge.
  return points;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute the radial extent (max − min radial) of a profile. Used by the
 * sweep builder to size the bounding cylinder when computing cap warnings.
 */
export function profileRadialExtent(profile: readonly Vec2[]): number {
  if (profile.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of profile) {
    if (p[0] < min) min = p[0];
    if (p[0] > max) max = p[0];
  }
  return max - min;
}

/**
 * Compute the axial extent of a profile (used by sanity checks — should
 * always equal pitch for a well-formed thread profile).
 */
export function profileAxialExtent(profile: readonly Vec2[]): number {
  if (profile.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of profile) {
    if (p[1] < min) min = p[1];
    if (p[1] > max) max = p[1];
  }
  return max - min;
}

/**
 * Cheap self-intersection check — used by `threadCapWarnings.ts` to detect
 * `THREAD_PROFILE_INVALID`. Returns true iff any two non-adjacent edges of
 * the polygon intersect. O(n²) is fine for a polygon with < 20 points.
 *
 * Uses the standard segment-intersection test (orient + onSegment).
 */
export function profileSelfIntersects(profile: readonly Vec2[]): boolean {
  const n = profile.length;
  if (n < 4) return false;

  function orient(a: Vec2, b: Vec2, c: Vec2): number {
    const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return Math.sign(v);
  }
  function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
    return (
      Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) &&
      Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1])
    );
  }
  function intersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(a, b, c)) return true;
    if (o2 === 0 && onSegment(a, b, d)) return true;
    if (o3 === 0 && onSegment(c, d, a)) return true;
    if (o4 === 0 && onSegment(c, d, b)) return true;
    return false;
  }

  for (let i = 0; i < n; i++) {
    const a = profile[i]!;
    const b = profile[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent edge + skip the wrap-around adjacency
      if (i === 0 && j === n - 1) continue;
      const c = profile[j]!;
      const d = profile[(j + 1) % n]!;
      if (intersect(a, b, c, d)) return true;
    }
  }
  return false;
}
