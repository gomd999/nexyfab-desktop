/**
 * Versioned, deterministic tolerance policy for reference-CAD analysis.
 *
 * All returned linear tolerances are millimetres. Callers must provide an
 * unambiguous conversion to millimetres; silently treating unitless geometry
 * as mm would make an evidence report look more certain than its source.
 */

export const CAD_TOLERANCE_POLICY_VERSION = 'cad-tolerance/v1' as const;

export type CadBoundingBox = Readonly<{
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}>;

export type CadLengthUnit =
  | Readonly<{ kind: 'mm' }>
  | Readonly<{ kind: 'scale-to-mm'; scaleToMm: number; label?: string }>
  | Readonly<{ kind: 'unknown'; label?: string }>;

export type DeclaredSourceTolerance = Readonly<{
  /** Positive tolerance in source/model units. */
  value: number;
}>;

export type ToleranceClampEvidence = Readonly<{
  declaredMm: number;
  effectiveMm: number;
  minimumMm: number;
  maximumMm: number;
  clamped: boolean;
  direction: 'none' | 'raised-to-minimum' | 'lowered-to-maximum';
  reason: string | null;
}>;

export type CadTolerancePolicy = Readonly<{
  version: typeof CAD_TOLERANCE_POLICY_VERSION;
  characteristicLengthMm: number;
  sourceUnitScaleToMm: number;
  linearMm: Readonly<{
    importSewing: number;
    boolean: number;
    topologyMatch: number;
    metricComparison: number;
  }>;
  angular: Readonly<{
    radians: number;
    degrees: number;
  }>;
  declaredSourceTolerance: ToleranceClampEvidence | null;
}>;

export type CadTolerancePolicyErrorCode =
  | 'INVALID_BBOX'
  | 'DEGENERATE_BBOX'
  | 'AMBIGUOUS_UNITS'
  | 'INVALID_UNIT_SCALE'
  | 'INVALID_SOURCE_TOLERANCE';

export class CadTolerancePolicyError extends Error {
  constructor(
    public readonly code: CadTolerancePolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CadTolerancePolicyError';
  }
}

export type CreateCadTolerancePolicyInput = Readonly<{
  bbox: CadBoundingBox;
  lengthUnit: CadLengthUnit;
  declaredSourceTolerance?: DeclaredSourceTolerance;
}>;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

function unitScaleToMm(unit: CadLengthUnit): number {
  if (unit.kind === 'unknown') {
    throw new CadTolerancePolicyError(
      'AMBIGUOUS_UNITS',
      `Absolute millimetre tolerances require a known length unit${unit.label ? ` (${unit.label})` : ''}.`,
    );
  }
  if (unit.kind === 'mm') return 1;
  if (!Number.isFinite(unit.scaleToMm) || unit.scaleToMm <= 0) {
    throw new CadTolerancePolicyError('INVALID_UNIT_SCALE', 'scaleToMm must be finite and greater than zero.');
  }
  return unit.scaleToMm;
}

/** Overflow-resistant Euclidean length for three non-negative extents. */
function stableDiagonal(x: number, y: number, z: number): number {
  const largest = Math.max(x, y, z);
  if (largest === 0) return 0;
  return largest * Math.sqrt((x / largest) ** 2 + (y / largest) ** 2 + (z / largest) ** 2);
}

/** Characteristic length is the finite, positive bounding-box diagonal in mm. */
export function characteristicLengthMm(bbox: CadBoundingBox, scaleToMm = 1): number {
  if (!Number.isFinite(scaleToMm) || scaleToMm <= 0) {
    throw new CadTolerancePolicyError('INVALID_UNIT_SCALE', 'scaleToMm must be finite and greater than zero.');
  }

  const values = [...bbox.min, ...bbox.max];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new CadTolerancePolicyError('INVALID_BBOX', 'Bounding-box coordinates must all be finite.');
  }

  const extents = bbox.max.map((maximum, axis) => {
    const extent = maximum - bbox.min[axis];
    if (extent < 0) {
      throw new CadTolerancePolicyError('INVALID_BBOX', 'Bounding-box minimum must not exceed its maximum.');
    }
    return extent;
  }) as [number, number, number];

  const sourceDiagonal = stableDiagonal(...extents);
  const diagonalMm = sourceDiagonal * scaleToMm;
  if (!Number.isFinite(diagonalMm)) {
    throw new CadTolerancePolicyError('INVALID_BBOX', 'Bounding-box diagonal cannot be represented in millimetres.');
  }
  if (diagonalMm <= 0) {
    throw new CadTolerancePolicyError('DEGENERATE_BBOX', 'Bounding box must have a positive characteristic length.');
  }
  return diagonalMm;
}

/**
 * Build the v1 policy. Relative terms preserve scale sensitivity while hard
 * floors/ceilings keep kernel operations sane for micro and plant-scale CAD.
 */
export function createCadTolerancePolicy(input: CreateCadTolerancePolicyInput): CadTolerancePolicy {
  const scale = unitScaleToMm(input.lengthUnit);
  const length = characteristicLengthMm(input.bbox, scale);

  const importMinimum = 1e-7;
  const importMaximum = 5e-2;
  const baselineImport = clamp(length * 1e-7, importMinimum, importMaximum);

  let sourceEvidence: ToleranceClampEvidence | null = null;
  let importSewing = baselineImport;
  if (input.declaredSourceTolerance !== undefined) {
    const declared = input.declaredSourceTolerance.value;
    if (!Number.isFinite(declared) || declared <= 0) {
      throw new CadTolerancePolicyError(
        'INVALID_SOURCE_TOLERANCE',
        'Declared source tolerance must be finite and greater than zero.',
      );
    }
    const declaredMm = declared * scale;
    if (!Number.isFinite(declaredMm)) {
      throw new CadTolerancePolicyError('INVALID_SOURCE_TOLERANCE', 'Declared source tolerance overflows in millimetres.');
    }
    const effectiveMm = clamp(declaredMm, importMinimum, importMaximum);
    const direction = declaredMm < importMinimum
      ? 'raised-to-minimum'
      : declaredMm > importMaximum
        ? 'lowered-to-maximum'
        : 'none';
    sourceEvidence = {
      declaredMm,
      effectiveMm,
      minimumMm: importMinimum,
      maximumMm: importMaximum,
      clamped: direction !== 'none',
      direction,
      reason: direction === 'raised-to-minimum'
        ? 'Declared tolerance was below the kernel-safe minimum.'
        : direction === 'lowered-to-maximum'
          ? 'Declared tolerance exceeded the geometry-preserving maximum.'
          : null,
    };
    // Never make sewing stricter than either the scale-derived baseline or
    // the trustworthy (clamped) tolerance declared by the source file.
    importSewing = Math.max(baselineImport, effectiveMm);
  }

  const angularRadians = clamp(1e-5 * Math.sqrt(100 / length), 1e-7, 1e-3);
  return {
    version: CAD_TOLERANCE_POLICY_VERSION,
    characteristicLengthMm: length,
    sourceUnitScaleToMm: scale,
    linearMm: {
      importSewing,
      boolean: clamp(length * 5e-8, 1e-7, 2e-2),
      topologyMatch: clamp(length * 2e-6, 1e-6, 2e-1),
      metricComparison: clamp(length * 1e-5, 1e-6, 5e-1),
    },
    angular: {
      radians: angularRadians,
      degrees: angularRadians * 180 / Math.PI,
    },
    declaredSourceTolerance: sourceEvidence,
  };
}
