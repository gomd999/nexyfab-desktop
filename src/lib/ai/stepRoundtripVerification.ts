export interface BrepMeasurement {
  shapeType: string;
  isNull: boolean;
  bbox: { width: number; height: number; depth: number };
  volumeMm3: number;
  faceCount: number;
  solidCount: number;
}

export interface StepRoundtripComparison {
  passed: boolean;
  topologyMatched: boolean;
  dimensionsMatched: boolean;
  maxDimensionErrorMm: number;
  volumeRelativeError: number;
  errors: string[];
}

export interface BodyIntentPolicy {
  policy: "single_body" | "multi_body";
  expectedBodies: number | null;
}

export function compareStepRoundtrip(
  before: BrepMeasurement,
  after: BrepMeasurement,
  toleranceMm = 0.05,
  volumeTolerance = 1e-4,
  bodyIntent: BodyIntentPolicy = {
    policy: "single_body",
    expectedBodies: 1,
  },
): StepRoundtripComparison {
  const dimensionErrors = [
    Math.abs(before.bbox.width - after.bbox.width),
    Math.abs(before.bbox.height - after.bbox.height),
    Math.abs(before.bbox.depth - after.bbox.depth),
  ];
  const maxDimensionErrorMm = Math.max(...dimensionErrors);
  const volumeRelativeError =
    before.volumeMm3 > 0
      ? Math.abs(before.volumeMm3 - after.volumeMm3) / before.volumeMm3
      : Number.POSITIVE_INFINITY;
  const bodyIntentMatched =
    bodyIntent.policy === "single_body"
      ? before.solidCount === 1 && after.solidCount === 1
      : bodyIntent.expectedBodies === null
        ? before.solidCount >= 2 && after.solidCount >= 2
        : before.solidCount === bodyIntent.expectedBodies &&
          after.solidCount === bodyIntent.expectedBodies;
  const topologyMatched =
    !before.isNull &&
    !after.isNull &&
    before.solidCount === after.solidCount &&
    bodyIntentMatched &&
    before.faceCount === after.faceCount &&
    before.faceCount > 0;
  const dimensionsMatched =
    maxDimensionErrorMm <= toleranceMm &&
    volumeRelativeError <= volumeTolerance;
  const errors: string[] = [];
  if (before.isNull || after.isNull) errors.push("A roundtrip shape is null.");
  if (before.solidCount !== after.solidCount)
    errors.push(
      `Solid count changed: ${before.solidCount} -> ${after.solidCount}.`,
    );
  if (!bodyIntentMatched) {
    const expected =
      bodyIntent.policy === "single_body"
        ? "exactly one solid"
        : bodyIntent.expectedBodies === null
          ? "at least two solids"
          : `exactly ${bodyIntent.expectedBodies} solids`;
    errors.push(
      `Body intent requires ${expected}; measured ${before.solidCount} -> ${after.solidCount}.`,
    );
  }
  if (before.faceCount !== after.faceCount)
    errors.push(
      `Face count changed: ${before.faceCount} -> ${after.faceCount}.`,
    );
  if (maxDimensionErrorMm > toleranceMm)
    errors.push(
      `Bounding-box error ${maxDimensionErrorMm}mm exceeds ${toleranceMm}mm.`,
    );
  if (volumeRelativeError > volumeTolerance)
    errors.push(
      `Volume relative error ${volumeRelativeError} exceeds ${volumeTolerance}.`,
    );
  return {
    passed: topologyMatched && dimensionsMatched && errors.length === 0,
    topologyMatched,
    dimensionsMatched,
    maxDimensionErrorMm,
    volumeRelativeError,
    errors,
  };
}
