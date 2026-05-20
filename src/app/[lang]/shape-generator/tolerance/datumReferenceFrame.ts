/**
 * datumReferenceFrame.ts — 3D tolerance analysis with GD&T datum
 * reference frames (DRF).
 *
 * Stage 1 + 2 tolerance modules treat the part as a 1-D chain of
 * dimensions. SolidWorks (with CETOL or TolAnalyst) does *3D*
 * stack-up: every controlled feature is defined relative to a
 * specific datum reference frame (DRF), and the analysis projects
 * variations through the 3-D coordinate transform.
 *
 * A DRF is built from up to 3 datums (primary A → secondary B →
 * tertiary C), each one of:
 *
 *   - **Plane** — locks 3 DOF (one translation along normal + two
 *     rotations parallel to plane).
 *   - **Axis (line)** — locks 4 DOF (translation perpendicular + two
 *     rotations + one translation along axis).
 *   - **Point** — locks 3 translation DOF.
 *
 * The Y14.5 / ISO 5459 hierarchy: primary locks the most DOFs (3 for
 * a plane), secondary locks the next 2, tertiary locks the last 1.
 * Total = 6 DOF for a fully-constrained DRF.
 *
 * Once the DRF is built, geometric tolerances on features (position,
 * profile, etc.) are evaluated *in the DRF coordinates* — variations
 * in the datums propagate through to the feature.
 */

export type DatumKind = 'plane' | 'axis' | 'point';
export type DatumPrecedence = 'primary' | 'secondary' | 'tertiary';

/** DOF reduction per (kind, precedence). Primary plane = 3, secondary
 *  plane = 2, etc. */
const DOF_REDUCTION: Record<DatumKind, Record<DatumPrecedence, number>> = {
  plane: { primary: 3, secondary: 2, tertiary: 1 },
  axis:  { primary: 4, secondary: 2, tertiary: 0 },
  point: { primary: 3, secondary: 2, tertiary: 1 },
};

export interface DatumFeature {
  label: string;
  kind: DatumKind;
  /** Reference position (mm). For plane: a point on the plane.
   *  For axis: a point on the axis. For point: the point itself. */
  position: [number, number, number];
  /** Direction. For plane: outward normal. For axis: along the axis. */
  direction: [number, number, number];
  /** Form deviation budget (mm) — how flat the plane, how straight
   *  the axis, etc. */
  formToleranceMm?: number;
}

export interface DatumReferenceFrame {
  primary: DatumFeature;
  secondary?: DatumFeature;
  tertiary?: DatumFeature;
  /** Total DOFs constrained (≤ 6). */
  constrainedDof: number;
  /** True when the 3 datums together fully define the part frame. */
  fullyDefined: boolean;
  /** Warnings about ill-conditioned DRFs. */
  warnings: string[];
}

export function buildDrf(
  primary: DatumFeature,
  secondary?: DatumFeature,
  tertiary?: DatumFeature,
): DatumReferenceFrame {
  let constrainedDof = DOF_REDUCTION[primary.kind].primary;
  if (secondary) constrainedDof += DOF_REDUCTION[secondary.kind].secondary;
  if (tertiary)  constrainedDof += DOF_REDUCTION[tertiary.kind].tertiary;
  constrainedDof = Math.min(6, constrainedDof);

  const warnings: string[] = [];
  // Check orthogonality of plane-plane primaries / secondaries.
  if (primary.kind === 'plane' && secondary?.kind === 'plane') {
    const dot = primary.direction[0] * secondary.direction[0]
      + primary.direction[1] * secondary.direction[1]
      + primary.direction[2] * secondary.direction[2];
    if (Math.abs(dot) > 0.1) {
      warnings.push('Primary/Secondary planes are not orthogonal (cos > 0.1) — DRF is ill-conditioned');
    }
  }
  // Check parallelism issues for primary axis + secondary plane.
  if (primary.kind === 'axis' && secondary?.kind === 'plane') {
    const dot = primary.direction[0] * secondary.direction[0]
      + primary.direction[1] * secondary.direction[1]
      + primary.direction[2] * secondary.direction[2];
    if (Math.abs(dot) > 0.95) {
      warnings.push('Primary axis is nearly parallel to secondary plane normal — datums redundant');
    }
  }

  return {
    primary, secondary, tertiary,
    constrainedDof,
    fullyDefined: constrainedDof >= 6,
    warnings,
  };
}

// ── Coordinate transform built from DRF ──────────────────────────

export interface Transform3 {
  /** 3×3 rotation matrix (row-major). */
  rotation: number[][];
  /** Translation vector (mm). */
  translation: [number, number, number];
}

const IDENTITY: Transform3 = {
  rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  translation: [0, 0, 0],
};

/** Apply a Transform3 to a 3D point. */
export function applyTransform(t: Transform3, p: [number, number, number]): [number, number, number] {
  const r = t.rotation;
  return [
    r[0]![0]! * p[0] + r[0]![1]! * p[1] + r[0]![2]! * p[2] + t.translation[0],
    r[1]![0]! * p[0] + r[1]![1]! * p[1] + r[1]![2]! * p[2] + t.translation[1],
    r[2]![0]! * p[0] + r[2]![1]! * p[1] + r[2]![2]! * p[2] + t.translation[2],
  ];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Build the DRF's coordinate transform — maps part-coords to DRF-
 *  coords. The DRF's origin is the projection of the part's origin
 *  onto the primary datum + secondary, primary axes derived from the
 *  datum normals/axes. */
export function drfTransform(drf: DatumReferenceFrame): Transform3 {
  const primaryDir = normalize(drf.primary.direction);
  let secondaryDir: [number, number, number] = [1, 0, 0];
  if (drf.secondary) {
    secondaryDir = normalize(drf.secondary.direction);
    // Orthogonalize against primaryDir.
    const dot = primaryDir[0] * secondaryDir[0]
      + primaryDir[1] * secondaryDir[1]
      + primaryDir[2] * secondaryDir[2];
    secondaryDir = normalize([
      secondaryDir[0] - dot * primaryDir[0],
      secondaryDir[1] - dot * primaryDir[1],
      secondaryDir[2] - dot * primaryDir[2],
    ]);
  } else {
    // Pick any vector orthogonal to primaryDir.
    const axisGuess: [number, number, number] = Math.abs(primaryDir[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0];
    secondaryDir = normalize(cross(primaryDir, axisGuess));
  }
  const tertiaryDir = cross(primaryDir, secondaryDir);
  // Rows of rotation matrix = new basis vectors in old coords.
  // We typically map primary axis to local +Z, secondary to +X.
  const rotation = [
    [secondaryDir[0], secondaryDir[1], secondaryDir[2]],
    [tertiaryDir[0], tertiaryDir[1], tertiaryDir[2]],
    [primaryDir[0], primaryDir[1], primaryDir[2]],
  ];
  return { rotation, translation: [
    -drf.primary.position[0],
    -drf.primary.position[1],
    -drf.primary.position[2],
  ] };
}

// ── Feature in DRF ───────────────────────────────────────────────

export interface FeatureInDrf {
  /** Feature center (mm, in part coords). */
  centerPart: [number, number, number];
  /** Position tolerance (mm) — the GD&T position diameter. */
  positionToleranceMm: number;
  /** Material-condition modifier — MMC/LMC/RFS. */
  materialCondition?: 'MMC' | 'LMC' | 'RFS';
}

/** Compute the feature's center in DRF coordinates, plus the variation
 *  budget propagated from each datum. */
export interface FeatureDrfResult {
  centerInDrf: [number, number, number];
  /** Effective tolerance after propagating datum form errors. */
  effectiveToleranceMm: number;
  /** Per-datum contribution to the effective tolerance. */
  datumContributions: Array<{ datum: string; contributionMm: number }>;
}

export function evaluateFeatureInDrf(
  drf: DatumReferenceFrame,
  feature: FeatureInDrf,
): FeatureDrfResult {
  const transform = IDENTITY;
  // We don't actually rotate the feature center for this preview — we
  // just apply translation. Real CETOL does a 3D Monte-Carlo across
  // datum + feature variations.
  const centerInDrf: [number, number, number] = [
    feature.centerPart[0] - drf.primary.position[0],
    feature.centerPart[1] - drf.primary.position[1],
    feature.centerPart[2] - drf.primary.position[2],
  ];
  void transform;

  // Propagate datum form errors: each datum contributes its formTol
  // scaled by feature distance × DOF-relevance.
  const contributions: FeatureDrfResult['datumContributions'] = [];
  const distance = (d: DatumFeature): number => Math.hypot(
    feature.centerPart[0] - d.position[0],
    feature.centerPart[1] - d.position[1],
    feature.centerPart[2] - d.position[2],
  );
  if (drf.primary.formToleranceMm) {
    contributions.push({
      datum: drf.primary.label,
      contributionMm: drf.primary.formToleranceMm * (1 + distance(drf.primary) / 1000),
    });
  }
  if (drf.secondary?.formToleranceMm) {
    contributions.push({
      datum: drf.secondary.label,
      contributionMm: drf.secondary.formToleranceMm * (1 + distance(drf.secondary) / 1000),
    });
  }
  if (drf.tertiary?.formToleranceMm) {
    contributions.push({
      datum: drf.tertiary.label,
      contributionMm: drf.tertiary.formToleranceMm * (1 + distance(drf.tertiary) / 1000),
    });
  }
  // RSS combine.
  const datumSq = contributions.reduce((s, c) => s + c.contributionMm * c.contributionMm, 0);
  const featureSq = feature.positionToleranceMm * feature.positionToleranceMm;
  const effective = Math.sqrt(featureSq + datumSq);

  return {
    centerInDrf,
    effectiveToleranceMm: effective,
    datumContributions: contributions,
  };
}

// ── 3D stack-up ──────────────────────────────────────────────────

/** Run a 3D stack-up: given a chain of features each defined in its
 *  own DRF, compute the tolerance zone of the final feature in the
 *  global frame. */
export interface DrfChainLink {
  feature: FeatureInDrf;
  drf: DatumReferenceFrame;
}

export interface DrfStackupResult {
  /** Per-link contribution (mm). */
  contributions: Array<{ index: number; contributionMm: number }>;
  /** Total tolerance zone (RSS combined). */
  totalToleranceMm: number;
  /** Total tolerance zone (worst-case summed). */
  worstCaseToleranceMm: number;
}

export function stackup3D(chain: DrfChainLink[]): DrfStackupResult {
  let rssSq = 0;
  let worstCase = 0;
  const contributions: DrfStackupResult['contributions'] = [];
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i]!;
    const r = evaluateFeatureInDrf(link.drf, link.feature);
    rssSq += r.effectiveToleranceMm * r.effectiveToleranceMm;
    worstCase += r.effectiveToleranceMm;
    contributions.push({ index: i, contributionMm: r.effectiveToleranceMm });
  }
  return {
    contributions,
    totalToleranceMm: Math.sqrt(rssSq),
    worstCaseToleranceMm: worstCase,
  };
}
