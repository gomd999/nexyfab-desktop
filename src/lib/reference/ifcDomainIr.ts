import {
  parseEntities,
  type StepArg,
  type StepEntity,
} from "@/lib/brep-bridge/stepImport";

export interface IfcAlignmentIr {
  kind: "alignment";
  schema: string | null;
  valid: boolean;
  errors: string[];
  alignmentGlobalIds: string[];
  horizontal: Array<{
    entityId: number;
    startDistance: number | null;
    length: number | null;
    predefinedType: string | null;
    startPoint: [number, number] | null;
    startDirectionRad: number | null;
    startRadius: number | null;
    endRadius: number | null;
    endPoint: [number, number] | null;
    endDirectionRad: number | null;
    evaluation: "analytic" | "cubic_arc_length" | "curvature_rk4" | "not_run";
    evaluationReason: string | null;
    requiredInputs: string[];
    errorEstimateSourceUnits: number | null;
    vienneseBend: VienneseBendEvidence | null;
  }>;
  vertical: Array<{
    entityId: number;
    startDistance: number | null;
    horizontalLength: number | null;
    startHeight: number | null;
    startGradient: number | null;
    endGradient: number | null;
    radiusOfCurvature: number | null;
    predefinedType: string | null;
  }>;
  cant: Array<{
    entityId: number;
    startDistance: number | null;
    horizontalLength: number | null;
    startCantLeft: number | null;
    startCantRight: number | null;
    endCantLeft: number | null;
    endCantRight: number | null;
    predefinedType: string | null;
  }>;
  georeferenced: boolean;
  continuity: { horizontal: boolean; vertical: boolean; cant: boolean };
  horizontalEvaluation: {
    evaluated: number;
    notRun: number;
    maxErrorEstimateSourceUnits: number;
    maxJunctionPositionErrorSourceUnits: number;
    maxJunctionDirectionErrorRad: number;
  };
}
export interface IfcAlignmentBuildOptions {
  vienneseBendInputs?: Record<
    number,
    { gravityCenterHeight: number; provenance: string }
  >;
}
export interface VienneseBendEvidence {
  cantSegmentEntityId: number;
  railHeadDistance: number;
  gravityCenterHeight: number;
  gravityCenterHeightProvenance: string;
  startCantAngleRad: number;
  endCantAngleRad: number;
}
export interface IfcStructuralIr {
  kind: "structural-analysis";
  schema: string | null;
  valid: boolean;
  errors: string[];
  modelGlobalIds: string[];
  nodes: Array<{
    entityId: number;
    globalId: string | null;
    name: string | null;
    point: [number, number, number] | null;
    boundaryCondition: number | null;
  }>;
  members: Array<{
    entityId: number;
    globalId: string | null;
    name: string | null;
    endpoints: Array<[number, number, number]>;
    connectedNodeIds: number[];
  }>;
  activities: number;
  reactions: number;
  loads: number;
  normalizedLoads: Array<{
    entityId: number;
    ifcClass: string;
    name: string | null;
    values: Array<number | null>;
    canonicalUnits: string[];
    normalized: boolean;
  }>;
  unsupportedLoadEntities: Array<{ entityId: number; ifcClass: string }>;
  loadCoverage: {
    numericEntities: number;
    normalized: number;
    unitUnresolved: number;
    unsupported: number;
  };
  unitFactors: Record<string, number>;
}
export interface IfcAlignmentStationEvaluation {
  station: number;
  point: [number, number, number];
  horizontalDirectionRad: number;
  gradient: number | null;
  horizontalSegmentEntityId: number;
  verticalSegmentEntityId: number | null;
}
const number = (arg: StepArg | undefined): number | null =>
  arg?.kind === "number"
    ? arg.value
    : arg?.kind === "typed"
      ? number(arg.args[0])
      : null;
const string = (arg: StepArg | undefined): string | null =>
  arg?.kind === "string" ? arg.value : null;
const enumeration = (arg: StepArg | undefined): string | null =>
  arg?.kind === "enum" ? arg.value : null;
const ref = (arg: StepArg | undefined): number | null =>
  arg?.kind === "ref" ? arg.id : null;
const refs = (arg: StepArg | undefined): number[] =>
  arg?.kind === "ref"
    ? [arg.id]
    : arg?.kind === "list"
      ? arg.items.flatMap(refs)
      : arg?.kind === "typed"
        ? arg.args.flatMap(refs)
        : [];
const schema = (source: string) =>
  source.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? null;

export function buildIfcAlignmentIr(
  source: string,
  options: IfcAlignmentBuildOptions = {},
): IfcAlignmentIr {
  const entities = parseEntities(source),
    horizontal: IfcAlignmentIr["horizontal"] = [],
    vertical: IfcAlignmentIr["vertical"] = [],
    cant: IfcAlignmentIr["cant"] = [];
  const angleFactor = structuralUnitFactors(entities).PLANEANGLEUNIT ?? 1;
  const railHeadDistance = [...entities.values()].find(
    (entity) => entity.name === "IFCALIGNMENTCANT",
  )
    ? number(
        [...entities.values()].find(
          (entity) => entity.name === "IFCALIGNMENTCANT",
        )!.args[7],
      )
    : null;
  for (const [entityId, entity] of entities)
    if (entity.name === "IFCALIGNMENTCANTSEGMENT")
      cant.push({
        entityId,
        startDistance: number(entity.args[2]),
        horizontalLength: number(entity.args[3]),
        startCantLeft: number(entity.args[4]),
        startCantRight: number(entity.args[5]),
        endCantLeft: number(entity.args[6]),
        endCantRight: number(entity.args[7]),
        predefinedType: enumeration(entity.args[8]),
      });
  let station = 0;
  for (const [entityId, entity] of entities) {
    if (entity.name === "IFCALIGNMENTHORIZONTALSEGMENT") {
      const length = number(entity.args[6]),
        startPoint3 = pointValues(entities.get(ref(entity.args[2]) ?? -1)),
        startDirection = number(entity.args[3]),
        startRadius = number(entity.args[4]),
        endRadius = number(entity.args[5]),
        predefinedType = enumeration(entity.args[8]),
        matchedCant = cant.find(
          (item) =>
            item.startDistance !== null &&
            item.horizontalLength !== null &&
            Math.abs(item.startDistance - station) <= 1e-8 &&
            length !== null &&
            Math.abs(item.horizontalLength - length) <= 1e-8,
        ),
        viennese =
          predefinedType === "VIENNESEBEND"
            ? resolveVienneseEvidence(
                entityId,
                matchedCant,
                railHeadDistance,
                options,
              )
            : null,
        evaluated = evaluateHorizontal(
          startPoint3 ? [startPoint3[0], startPoint3[1]] : null,
          startDirection === null ? null : startDirection * angleFactor,
          startRadius,
          endRadius,
          length,
          predefinedType,
          viennese,
        );
      horizontal.push({
        entityId,
        startDistance: station,
        length,
        predefinedType,
        startPoint: startPoint3 ? [startPoint3[0], startPoint3[1]] : null,
        startDirectionRad:
          startDirection === null ? null : startDirection * angleFactor,
        startRadius,
        endRadius,
        vienneseBend: viennese,
        ...evaluated,
      });
      if (length !== null && length >= 0) station += length;
    }
    if (entity.name === "IFCALIGNMENTVERTICALSEGMENT")
      vertical.push({
        entityId,
        startDistance: number(entity.args[2]),
        horizontalLength: number(entity.args[3]),
        startHeight: number(entity.args[4]),
        startGradient: number(entity.args[5]),
        endGradient: number(entity.args[6]),
        radiusOfCurvature: number(entity.args[7]),
        predefinedType: enumeration(entity.args[8]),
      });
  }
  const alignmentGlobalIds = [...entities.values()]
    .filter((entity) => entity.name === "IFCALIGNMENT")
    .flatMap((entity) =>
      string(entity.args[0]) ? [string(entity.args[0])!] : [],
    );
  const stationContinuous = (
    segments: Array<{
      startDistance: number | null;
      horizontalLength: number | null;
    }>,
  ) =>
    segments.every((segment, index) => {
      if (
        segment.startDistance === null ||
        segment.horizontalLength === null ||
        segment.horizontalLength < 0
      )
        return false;
      const next = segments[index + 1];
      if (!next) return true;
      if (next.startDistance === null) return false;
      const expected = segment.startDistance + segment.horizontalLength;
      return (
        Math.abs(expected - next.startDistance) <=
        Math.max(1e-9, Math.abs(expected) * 1e-9)
      );
    });
  const junctions = horizontal.slice(0, -1).map((segment, index) => {
    const next = horizontal[index + 1];
    if (
      segment.endPoint === null ||
      segment.endDirectionRad === null ||
      !next ||
      next.startPoint === null ||
      next.startDirectionRad === null
    )
      return {
        available: false,
        positionError: Infinity,
        directionError: Infinity,
        tolerance: 0,
      };
    const positionError = Math.hypot(
        segment.endPoint[0] - next.startPoint[0],
        segment.endPoint[1] - next.startPoint[1],
      ),
      directionError = Math.abs(
        Math.atan2(
          Math.sin(segment.endDirectionRad - next.startDirectionRad),
          Math.cos(segment.endDirectionRad - next.startDirectionRad),
        ),
      ),
      scale = Math.max(
        1,
        ...segment.endPoint.map(Math.abs),
        ...next.startPoint.map(Math.abs),
      );
    return {
      available: true,
      positionError,
      directionError,
      tolerance: Math.max(
        1e-6,
        scale * 1e-11,
        segment.errorEstimateSourceUnits ?? 0,
      ),
    };
  });
  const horizontalContinuous = junctions.every(
    (item) =>
      item.available &&
      item.positionError <= item.tolerance &&
      item.directionError <= 1e-8,
  );
  const continuity = {
    horizontal: horizontalContinuous,
    vertical: stationContinuous(vertical),
    cant: stationContinuous(cant),
  };
  const designValuesValid =
    vertical.every((item) =>
      [item.startHeight, item.startGradient, item.endGradient].every(
        (value) => value !== null && Number.isFinite(value),
      ),
    ) &&
    cant.every((item) =>
      [
        item.startCantLeft,
        item.startCantRight,
        item.endCantLeft,
        item.endCantRight,
      ].every((value) => value !== null && Number.isFinite(value)),
    );
  const errors = [
    ...(!alignmentGlobalIds.length ? ["alignment_root_missing"] : []),
    ...(!horizontal.length && !vertical.length && !cant.length
      ? ["alignment_segments_missing"]
      : []),
    ...(horizontal.some((item) => item.length === null || item.length < 0) ||
    vertical.some(
      (item) => item.horizontalLength === null || item.horizontalLength < 0,
    ) ||
    cant.some(
      (item) => item.horizontalLength === null || item.horizontalLength < 0,
    )
      ? ["invalid_segment_length"]
      : []),
    ...(!designValuesValid ? ["alignment_design_value_missing"] : []),
    ...(horizontal.some((item) => item.evaluation === "not_run")
      ? ["horizontal_geometry_evaluation_incomplete"]
      : []),
    ...(!continuity.horizontal ? ["horizontal_geometry_discontinuity"] : []),
    ...(!continuity.vertical ? ["vertical_station_discontinuity"] : []),
    ...(!continuity.cant ? ["cant_station_discontinuity"] : []),
  ];
  const finiteMax = (values: number[]) =>
      values.length ? Math.max(...values) : 0,
    horizontalEvaluation = {
      evaluated: horizontal.filter((item) => item.evaluation !== "not_run")
        .length,
      notRun: horizontal.filter((item) => item.evaluation === "not_run").length,
      maxErrorEstimateSourceUnits: finiteMax(
        horizontal.flatMap((item) =>
          item.errorEstimateSourceUnits === null
            ? []
            : [item.errorEstimateSourceUnits],
        ),
      ),
      maxJunctionPositionErrorSourceUnits: finiteMax(
        junctions.flatMap((item) =>
          Number.isFinite(item.positionError) ? [item.positionError] : [],
        ),
      ),
      maxJunctionDirectionErrorRad: finiteMax(
        junctions.flatMap((item) =>
          Number.isFinite(item.directionError) ? [item.directionError] : [],
        ),
      ),
    };
  return {
    kind: "alignment",
    schema: schema(source),
    valid: errors.length === 0,
    errors,
    alignmentGlobalIds,
    horizontal,
    vertical,
    cant,
    georeferenced:
      [...entities.values()].some(
        (entity) => entity.name === "IFCMAPCONVERSION",
      ) &&
      [...entities.values()].some(
        (entity) => entity.name === "IFCPROJECTEDCRS",
      ),
    continuity,
    horizontalEvaluation,
  };
}

type HorizontalEvaluation = Pick<
  IfcAlignmentIr["horizontal"][number],
  | "endPoint"
  | "endDirectionRad"
  | "evaluation"
  | "evaluationReason"
  | "requiredInputs"
  | "errorEstimateSourceUnits"
>;
const notRun = (
  reason: string,
  requiredInputs: string[] = [],
): HorizontalEvaluation => ({
  endPoint: null,
  endDirectionRad: null,
  evaluation: "not_run",
  evaluationReason: reason,
  requiredInputs,
  errorEstimateSourceUnits: null,
});
function resolveVienneseEvidence(
  entityId: number,
  cant: IfcAlignmentIr["cant"][number] | undefined,
  railHeadDistance: number | null,
  options: IfcAlignmentBuildOptions,
): VienneseBendEvidence | null {
  const input = options.vienneseBendInputs?.[entityId];
  if (
    !cant ||
    railHeadDistance === null ||
    railHeadDistance <= 0 ||
    !input ||
    !Number.isFinite(input.gravityCenterHeight) ||
    input.gravityCenterHeight < 0 ||
    !input.provenance.trim()
  )
    return null;
  const values = [
    cant.startCantLeft,
    cant.startCantRight,
    cant.endCantLeft,
    cant.endCantRight,
  ];
  if (values.some((value) => value === null)) return null;
  const startDifference = cant.startCantLeft! - cant.startCantRight!,
    endDifference = cant.endCantLeft! - cant.endCantRight!;
  if (
    Math.abs(startDifference) > railHeadDistance ||
    Math.abs(endDifference) > railHeadDistance
  )
    return null;
  return {
    cantSegmentEntityId: cant.entityId,
    railHeadDistance,
    gravityCenterHeight: input.gravityCenterHeight,
    gravityCenterHeightProvenance: input.provenance,
    startCantAngleRad: Math.asin(startDifference / railHeadDistance),
    endCantAngleRad: Math.asin(endDifference / railHeadDistance),
  };
}
function evaluateHorizontal(
  startPoint: [number, number] | null,
  startDirection: number | null,
  startRadius: number | null,
  endRadius: number | null,
  length: number | null,
  type: string | null,
  viennese: VienneseBendEvidence | null = null,
): HorizontalEvaluation {
  if (
    !startPoint ||
    startDirection === null ||
    length === null ||
    length < 0 ||
    !type
  )
    return notRun("horizontal_base_input_missing", [
      "startPoint",
      "startDirection",
      "segmentLength",
      "predefinedType",
    ]);
  const curvature = (radius: number | null) =>
      radius === null ? null : Math.abs(radius) < 1e-15 ? 0 : 1 / radius,
    k0 = curvature(startRadius),
    k1 = curvature(endRadius);
  if (k0 === null || k1 === null)
    return notRun("horizontal_radius_missing", ["startRadius", "endRadius"]);
  if (type === "LINE") {
    if (Math.abs(k0) > 1e-12 || Math.abs(k1) > 1e-12)
      return notRun("line_radius_must_be_infinite");
    return {
      endPoint: [
        startPoint[0] + length * Math.cos(startDirection),
        startPoint[1] + length * Math.sin(startDirection),
      ],
      endDirectionRad: startDirection,
      evaluation: "analytic",
      evaluationReason: null,
      requiredInputs: [],
      errorEstimateSourceUnits: 0,
    };
  }
  if (type === "CIRCULARARC") {
    if (Math.abs(k0 - k1) > 1e-10 || Math.abs(k0) < 1e-15)
      return notRun("circular_arc_radius_invalid");
    const theta = startDirection + k0 * length;
    return {
      endPoint: [
        startPoint[0] + (Math.sin(theta) - Math.sin(startDirection)) / k0,
        startPoint[1] - (Math.cos(theta) - Math.cos(startDirection)) / k0,
      ],
      endDirectionRad: theta,
      evaluation: "analytic",
      evaluationReason: null,
      requiredInputs: [],
      errorEstimateSourceUnits: 0,
    };
  }
  if (type === "CUBIC") {
    const result = evaluateCubic(
      startPoint,
      startDirection,
      length,
      k0,
      k1,
      length,
    );
    return result
      ? {
          ...result,
          evaluation: "cubic_arc_length",
          evaluationReason: null,
          requiredInputs: [],
        }
      : notRun("cubic_requires_one_infinite_radius", [
          "one_zero_curvature_endpoint",
        ]);
  }
  const profile =
    type === "VIENNESEBEND" && viennese
      ? vienneseCurvature(k0, k1, length, viennese)
      : curvatureProfile(type, k0, k1);
  if (!profile)
    return type === "VIENNESEBEND"
      ? notRun("viennese_authoritative_input_missing", [
          "matchingCantSegment",
          "railHeadDistance",
          "gravityCenterHeight",
          "gravityCenterHeightProvenance",
        ])
      : notRun("horizontal_curve_type_unsupported");
  const coarse = integrateCurvature(
      startPoint,
      startDirection,
      length,
      profile,
      256,
    ),
    fine = integrateCurvature(startPoint, startDirection, length, profile, 512);
  return {
    endPoint: fine.point,
    endDirectionRad: fine.direction,
    evaluation: "curvature_rk4",
    evaluationReason: null,
    requiredInputs: [],
    errorEstimateSourceUnits: Math.hypot(
      fine.point[0] - coarse.point[0],
      fine.point[1] - coarse.point[1],
    ),
  };
}
function vienneseCurvature(
  k0: number,
  k1: number,
  length: number,
  evidence: VienneseBendEvidence,
): (u: number) => number {
  const dk = k1 - k0,
    dp = evidence.endCantAngleRad - evidence.startCantAngleRad,
    h = evidence.gravityCenterHeight;
  return (u) =>
    k0 +
    (dk * u * u * (35 - 84 * u + 70 * u * u - 20 * u * u * u) -
      ((420 * h * dp) / length ** 2) *
        (1 - 4 * u + 5 * u * u - 2 * u * u * u)) *
      u *
      u;
}
function cubicArcLength(x: number, a: number, steps = 256): number {
  const n = steps + (steps % 2),
    h = x / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const derivative = 3 * a * (i * h) ** 2;
    sum += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * Math.hypot(1, derivative);
  }
  return (sum * h) / 3;
}
function evaluateCubic(
  start: [number, number],
  direction: number,
  length: number,
  k0: number,
  k1: number,
  travel: number,
): Pick<
  HorizontalEvaluation,
  "endPoint" | "endDirectionRad" | "errorEstimateSourceUnits"
> | null {
  if (length === 0)
    return {
      endPoint: [...start],
      endDirectionRad: direction,
      errorEstimateSourceUnits: 0,
    };
  const forward = Math.abs(k0) < 1e-12 && Math.abs(k1) > 1e-15,
    reverse = Math.abs(k1) < 1e-12 && Math.abs(k0) > 1e-15;
  if (!forward && !reverse) return null;
  // Reversing traversal reverses signed curvature, so the canonical
  // line-to-arc curve needs the opposite terminal sign first.
  const target = reverse ? -k0 : k1,
    a = target / (6 * length);
  const canonicalTravel = reverse ? length - travel : travel;
  let lo = 0,
    hi = length;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (cubicArcLength(mid, a) < canonicalTravel) lo = mid;
    else hi = mid;
  }
  const x = (lo + hi) / 2,
    y = a * x ** 3,
    angle = Math.atan(3 * a * x * x);
  let localX = x,
    localY = y,
    delta = angle;
  if (reverse) {
    const fullX = (() => {
        let l = 0,
          h = length;
        for (let i = 0; i < 60; i++) {
          const m = (l + h) / 2;
          if (cubicArcLength(m, a) < length) l = m;
          else h = m;
        }
        return (l + h) / 2;
      })(),
      fullY = a * fullX ** 3,
      fullAngle = Math.atan(3 * a * fullX ** 2);
    localX = fullX - x;
    localY = fullY - y;
    delta = fullAngle - angle;
    const c = Math.cos(-fullAngle),
      s = Math.sin(-fullAngle),
      rx = localX * c - localY * s,
      ry = localX * s + localY * c;
    localX = rx;
    localY = ry;
    delta = angle - fullAngle;
  }
  const c = Math.cos(direction),
    s = Math.sin(direction);
  return {
    endPoint: [
      start[0] + localX * c - localY * s,
      start[1] + localX * s + localY * c,
    ],
    endDirectionRad: direction + delta,
    errorEstimateSourceUnits: Math.abs(
      cubicArcLength(x, a, 512) - cubicArcLength(x, a, 256),
    ),
  };
}
function curvatureProfile(
  type: string,
  k0: number,
  k1: number,
): ((u: number) => number) | null {
  const delta = k1 - k0;
  switch (type) {
    case "CLOTHOID":
      return (u) => k0 + u * delta;
    case "COSINECURVE":
      return (u) => k0 + 0.5 * (1 - Math.cos(Math.PI * u)) * delta;
    case "SINECURVE":
      return (u) =>
        k0 + (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI)) * delta;
    case "BLOSSCURVE":
      return (u) => k0 + (3 - 2 * u) * u * u * delta;
    case "HELMERTCURVE":
      return (u) =>
        k0 + (u <= 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)) * delta;
    default:
      return null;
  }
}
function integrateCurvature(
  start: [number, number],
  direction: number,
  length: number,
  curvature: (u: number) => number,
  steps: number,
): { point: [number, number]; direction: number } {
  if (length === 0) return { point: [...start], direction };
  const h = length / steps;
  let x = start[0],
    y = start[1],
    theta = direction;
  for (let i = 0; i < steps; i++) {
    const s = i * h,
      derivative = (px: number, pt: number): [number, number, number] => [
        Math.cos(pt),
        Math.sin(pt),
        curvature(px / length),
      ];
    const a = derivative(s, theta),
      b = derivative(s + h / 2, theta + (a[2] * h) / 2),
      c = derivative(s + h / 2, theta + (b[2] * h) / 2),
      d = derivative(s + h, theta + c[2] * h);
    x += (h * (a[0] + 2 * b[0] + 2 * c[0] + d[0])) / 6;
    y += (h * (a[1] + 2 * b[1] + 2 * c[1] + d[1])) / 6;
    theta += (h * (a[2] + 2 * b[2] + 2 * c[2] + d[2])) / 6;
  }
  return { point: [x, y], direction: theta };
}

export function evaluateIfcAlignmentStation(
  ir: IfcAlignmentIr,
  station: number,
): IfcAlignmentStationEvaluation | null {
  if (!Number.isFinite(station) || station < 0) return null;
  const stationTolerance = Math.max(1e-6, Math.abs(station) * 1e-8),
    segment = ir.horizontal.find(
      (item) =>
        item.length !== null &&
        station >= item.startDistance! - stationTolerance &&
        station <= item.startDistance! + item.length + stationTolerance,
    );
  if (
    !segment ||
    segment.startDistance === null ||
    segment.length === null ||
    !segment.startPoint ||
    segment.startDirectionRad === null ||
    !segment.predefinedType
  )
    return null;
  const travel = Math.max(
      0,
      Math.min(segment.length, station - segment.startDistance),
    ),
    partial = evaluateHorizontalPartial(segment, travel);
  if (!partial) return null;
  const vertical = ir.vertical.find(
    (item) =>
      item.startDistance !== null &&
      item.horizontalLength !== null &&
      station >= item.startDistance - stationTolerance &&
      station <= item.startDistance + item.horizontalLength + stationTolerance,
  );
  let z = 0,
    gradient: number | null = null;
  if (vertical) {
    const length = vertical.horizontalLength!,
      s = Math.max(0, Math.min(length, station - vertical.startDistance!)),
      g0 = vertical.startGradient,
      g1 = vertical.endGradient;
    if (vertical.startHeight === null || g0 === null || g1 === null)
      return null;
    if (
      vertical.predefinedType === "CONSTANTGRADIENT" ||
      vertical.predefinedType === "PARABOLICARC"
    ) {
      const rate = length > 0 ? (g1 - g0) / length : 0;
      z = vertical.startHeight + g0 * s + (rate * s * s) / 2;
      gradient = g0 + rate * s;
    } else if (
      vertical.predefinedType === "CIRCULARARC" &&
      vertical.radiusOfCurvature !== null &&
      Math.abs(vertical.radiusOfCurvature) > 1e-12
    ) {
      const radius = vertical.radiusOfCurvature,
        theta0 = Math.atan(g0),
        sinTheta = Math.sin(theta0) + s / radius;
      if (Math.abs(sinTheta) > 1 + 1e-12) return null;
      const theta = Math.asin(Math.max(-1, Math.min(1, sinTheta)));
      z = vertical.startHeight + radius * (Math.cos(theta0) - Math.cos(theta));
      gradient = Math.tan(theta);
    } else return null;
  }
  return {
    station,
    point: [partial.point[0], partial.point[1], z],
    horizontalDirectionRad: partial.direction,
    gradient,
    horizontalSegmentEntityId: segment.entityId,
    verticalSegmentEntityId: vertical?.entityId ?? null,
  };
}
function evaluateHorizontalPartial(
  segment: IfcAlignmentIr["horizontal"][number],
  travel: number,
): { point: [number, number]; direction: number } | null {
  const k = (r: number | null) =>
      r === null ? null : Math.abs(r) < 1e-15 ? 0 : 1 / r,
    k0 = k(segment.startRadius),
    k1 = k(segment.endRadius);
  if (
    k0 === null ||
    k1 === null ||
    !segment.startPoint ||
    segment.startDirectionRad === null ||
    segment.length === null ||
    !segment.predefinedType
  )
    return null;
  if (segment.predefinedType === "LINE")
    return {
      point: [
        segment.startPoint[0] + travel * Math.cos(segment.startDirectionRad),
        segment.startPoint[1] + travel * Math.sin(segment.startDirectionRad),
      ],
      direction: segment.startDirectionRad,
    };
  if (segment.predefinedType === "CIRCULARARC") {
    if (Math.abs(k0) < 1e-15) return null;
    const theta = segment.startDirectionRad + k0 * travel;
    return {
      point: [
        segment.startPoint[0] +
          (Math.sin(theta) - Math.sin(segment.startDirectionRad)) / k0,
        segment.startPoint[1] -
          (Math.cos(theta) - Math.cos(segment.startDirectionRad)) / k0,
      ],
      direction: theta,
    };
  }
  if (segment.predefinedType === "CUBIC") {
    const value = evaluateCubic(
      segment.startPoint,
      segment.startDirectionRad,
      segment.length,
      k0,
      k1,
      travel,
    );
    return value
      ? { point: value.endPoint!, direction: value.endDirectionRad! }
      : null;
  }
  const profile =
    segment.predefinedType === "VIENNESEBEND" && segment.vienneseBend
      ? vienneseCurvature(k0, k1, segment.length, segment.vienneseBend)
      : curvatureProfile(segment.predefinedType, k0, k1);
  if (!profile) return null;
  if (travel === 0)
    return {
      point: [...segment.startPoint],
      direction: segment.startDirectionRad,
    };
  return integrateCurvature(
    segment.startPoint,
    segment.startDirectionRad,
    travel,
    (u) => profile((u * travel) / segment.length!),
    Math.max(32, Math.ceil((512 * travel) / Math.max(segment.length!, 1e-12))),
  );
}

const pointValues = (
  entity: StepEntity | undefined,
): [number, number, number] | null => {
  const list = entity?.name === "IFCCARTESIANPOINT" ? entity.args[0] : null;
  if (list?.kind !== "list") return null;
  const values = list.items.map(number);
  if (values.length < 2 || values.some((value) => value === null)) return null;
  return [values[0]!, values[1]!, values[2] ?? 0];
};
function descendantPoints(
  start: number | null,
  entities: Map<number, StepEntity>,
): Array<[number, number, number]> {
  if (start === null) return [];
  const pending = [start],
    seen = new Set<number>(),
    out: Array<[number, number, number]> = [];
  while (pending.length && seen.size < 20_000) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const entity = entities.get(id);
    if (!entity) continue;
    const point = pointValues(entity);
    if (point) {
      if (
        !out.some((value) =>
          value.every(
            (coordinate, index) => Math.abs(coordinate - point[index]!) < 1e-12,
          ),
        )
      )
        out.push(point);
      continue;
    }
    for (const arg of entity.args) collectRefs(arg, pending);
  }
  return out;
}
function collectRefs(arg: StepArg, out: number[]): void {
  if (arg.kind === "ref") out.push(arg.id);
  else if (arg.kind === "list")
    for (const item of arg.items) collectRefs(item, out);
  else if (arg.kind === "typed")
    for (const item of arg.args) collectRefs(item, out);
}

function structuralUnitFactors(
  entities: Map<number, StepEntity>,
): Record<string, number> {
  const assigned = new Map<string, number>(),
    cache = new Map<number, number>();
  const prefix = (arg: StepArg | undefined) =>
    arg?.kind === "enum"
      ? ((
          {
            MILLI: 1e-3,
            CENTI: 1e-2,
            DECI: 1e-1,
            KILO: 1e3,
            MEGA: 1e6,
          } as Record<string, number>
        )[arg.value] ?? 1)
      : 1;
  const factor = (id: number, active = new Set<number>()): number | null => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    if (active.has(id)) return null;
    active.add(id);
    const entity = entities.get(id);
    if (!entity) return null;
    let value: number | null = null;
    if (entity.name === "IFCSIUNIT") value = prefix(entity.args[2]);
    else if (entity.name === "IFCCONVERSIONBASEDUNIT") {
      const measure = entities.get(ref(entity.args[3]) ?? -1);
      const scalar = number(measure?.args[0]),
        base = ref(measure?.args[1]);
      if (scalar !== null && base !== null) {
        const baseFactor = factor(base, active);
        if (baseFactor !== null) value = scalar * baseFactor;
      }
    } else if (entity.name === "IFCDERIVEDUNIT") {
      value = 1;
      for (const elementId of refs(entity.args[0])) {
        const element = entities.get(elementId),
          unitId = ref(element?.args[0]),
          exponent = number(element?.args[1]);
        const unitFactor = unitId === null ? null : factor(unitId, active);
        if (unitFactor === null || exponent === null) {
          value = null;
          break;
        }
        value *= unitFactor ** exponent;
      }
    }
    active.delete(id);
    if (value !== null && Number.isFinite(value) && value > 0)
      cache.set(id, value);
    return value;
  };
  for (const entity of entities.values())
    if (entity.name === "IFCUNITASSIGNMENT")
      for (const id of refs(entity.args[0])) {
        const unit = entities.get(id);
        const type =
          unit?.name === "IFCDERIVEDUNIT"
            ? enumeration(unit.args[1])
            : enumeration(unit?.args[1]);
        if (type) assigned.set(type, id);
      }
  const result: Record<string, number> = {};
  for (const [type, id] of assigned) {
    const value = factor(id);
    if (value !== null) result[type] = value;
  }
  if (result.FORCEUNIT && result.LENGTHUNIT && !result.MOMENTUNIT)
    result.MOMENTUNIT = result.FORCEUNIT * result.LENGTHUNIT;
  if (result.FORCEUNIT && result.LENGTHUNIT) {
    if (!result.LINEARFORCEUNIT)
      result.LINEARFORCEUNIT = result.FORCEUNIT / result.LENGTHUNIT;
    if (!result.LINEARMOMENTUNIT) result.LINEARMOMENTUNIT = result.FORCEUNIT;
    if (!result.PLANARFORCEUNIT)
      result.PLANARFORCEUNIT = result.FORCEUNIT / result.LENGTHUNIT ** 2;
    if (!result.CURVATUREUNIT) result.CURVATUREUNIT = 1 / result.LENGTHUNIT;
    if (!result.WARPINGMOMENTUNIT)
      result.WARPINGMOMENTUNIT = result.FORCEUNIT * result.LENGTHUNIT ** 2;
  }
  return result;
}

export function buildIfcStructuralIr(source: string): IfcStructuralIr {
  const entities = parseEntities(source),
    connectionIds = new Set<number>(),
    memberIds = new Set<number>(),
    connects = new Map<number, number[]>();
  for (const [id, entity] of entities) {
    if (entity.name === "IFCSTRUCTURALPOINTCONNECTION") connectionIds.add(id);
    if (entity.name === "IFCSTRUCTURALCURVEMEMBER") memberIds.add(id);
    if (entity.name === "IFCRELCONNECTSSTRUCTURALMEMBER") {
      const member = ref(entity.args[4]),
        node = ref(entity.args[5]);
      if (member !== null && node !== null)
        connects.set(member, [...(connects.get(member) ?? []), node]);
    }
  }
  const nodes = [...connectionIds].map((entityId) => {
    const entity = entities.get(entityId)!;
    return {
      entityId,
      globalId: string(entity.args[0]),
      name: string(entity.args[2]),
      point: descendantPoints(ref(entity.args[6]), entities)[0] ?? null,
      boundaryCondition: ref(entity.args[7]),
    };
  });
  const members = [...memberIds].map((entityId) => {
    const entity = entities.get(entityId)!;
    return {
      entityId,
      globalId: string(entity.args[0]),
      name: string(entity.args[2]),
      endpoints: descendantPoints(ref(entity.args[6]), entities).slice(0, 2),
      connectedNodeIds: [...new Set(connects.get(entityId) ?? [])].sort(
        (a, b) => a - b,
      ),
    };
  });
  const modelGlobalIds = [...entities.values()]
    .filter((entity) => entity.name === "IFCSTRUCTURALANALYSISMODEL")
    .flatMap((entity) =>
      string(entity.args[0]) ? [string(entity.args[0])!] : [],
    );
  const unitFactors = structuralUnitFactors(entities);
  const normalizedLoads: IfcStructuralIr["normalizedLoads"] = [],
    unsupportedLoadEntities: IfcStructuralIr["unsupportedLoadEntities"] = [];
  const loadContainers = new Set([
    "IFCSTRUCTURALLOADCASE",
    "IFCSTRUCTURALLOADGROUP",
    "IFCSTRUCTURALLOADCONFIGURATION",
  ]);
  for (const [entityId, entity] of entities) {
    const spec =
      entity.name === "IFCSTRUCTURALLOADSINGLEFORCE"
        ? {
            types: [
              "FORCEUNIT",
              "FORCEUNIT",
              "FORCEUNIT",
              "MOMENTUNIT",
              "MOMENTUNIT",
              "MOMENTUNIT",
            ],
            units: ["N", "N", "N", "N·m", "N·m", "N·m"],
          }
        : entity.name === "IFCSTRUCTURALLOADLINEARFORCE"
          ? {
              types: [
                "LINEARFORCEUNIT",
                "LINEARFORCEUNIT",
                "LINEARFORCEUNIT",
                "LINEARMOMENTUNIT",
                "LINEARMOMENTUNIT",
                "LINEARMOMENTUNIT",
              ],
              units: ["N/m", "N/m", "N/m", "N", "N", "N"],
            }
          : entity.name === "IFCSTRUCTURALLOADPLANARFORCE"
            ? {
                types: [
                  "PLANARFORCEUNIT",
                  "PLANARFORCEUNIT",
                  "PLANARFORCEUNIT",
                ],
                units: ["N/m²", "N/m²", "N/m²"],
              }
            : entity.name === "IFCSTRUCTURALLOADSINGLEDISPLACEMENT"
              ? {
                  types: [
                    "LENGTHUNIT",
                    "LENGTHUNIT",
                    "LENGTHUNIT",
                    "PLANEANGLEUNIT",
                    "PLANEANGLEUNIT",
                    "PLANEANGLEUNIT",
                  ],
                  units: ["m", "m", "m", "rad", "rad", "rad"],
                }
              : entity.name === "IFCSTRUCTURALLOADSINGLEDISPLACEMENTDISTORTION"
                ? {
                    types: [
                      "LENGTHUNIT",
                      "LENGTHUNIT",
                      "LENGTHUNIT",
                      "PLANEANGLEUNIT",
                      "PLANEANGLEUNIT",
                      "PLANEANGLEUNIT",
                      "CURVATUREUNIT",
                    ],
                    units: ["m", "m", "m", "rad", "rad", "rad", "1/m"],
                  }
                : entity.name === "IFCSTRUCTURALLOADSINGLEFORCEWARPING"
                  ? {
                      types: [
                        "FORCEUNIT",
                        "FORCEUNIT",
                        "FORCEUNIT",
                        "MOMENTUNIT",
                        "MOMENTUNIT",
                        "MOMENTUNIT",
                        "WARPINGMOMENTUNIT",
                      ],
                      units: ["N", "N", "N", "N·m", "N·m", "N·m", "N·m²"],
                    }
                  : entity.name === "IFCSTRUCTURALLOADTEMPERATURE"
                    ? {
                        types: [
                          "THERMODYNAMICTEMPERATUREUNIT",
                          "THERMODYNAMICTEMPERATUREUNIT",
                          "THERMODYNAMICTEMPERATUREUNIT",
                        ],
                        units: ["K", "K", "K"],
                      }
                    : null;
    if (!spec) {
      if (
        entity.name.startsWith("IFCSTRUCTURALLOAD") &&
        !loadContainers.has(entity.name)
      )
        unsupportedLoadEntities.push({ entityId, ifcClass: entity.name });
      continue;
    }
    const raw = entity.args.slice(1, 1 + spec.types.length).map(number);
    let normalized = true;
    const values = raw.map((value, index) => {
      if (value === null) return null;
      const factor = unitFactors[spec.types[index]!];
      if (!Number.isFinite(factor)) {
        normalized = false;
        return null;
      }
      const result = value * factor;
      if (!Number.isFinite(result)) normalized = false;
      return Number.isFinite(result) ? result : null;
    });
    normalizedLoads.push({
      entityId,
      ifcClass: entity.name,
      name: string(entity.args[0]),
      values,
      canonicalUnits: spec.units,
      normalized,
    });
  }
  const loadCoverage = {
    numericEntities: normalizedLoads.length,
    normalized: normalizedLoads.filter((load) => load.normalized).length,
    unitUnresolved: normalizedLoads.filter((load) => !load.normalized).length,
    unsupported: unsupportedLoadEntities.length,
  };
  const errors = [
    ...(!modelGlobalIds.length ? ["analysis_model_missing"] : []),
    ...(!nodes.length ? ["structural_nodes_missing"] : []),
    ...(!members.length ? ["structural_members_missing"] : []),
    ...(nodes.some((node) => node.point === null)
      ? ["node_geometry_unresolved"]
      : []),
    ...(members.some(
      (member) =>
        member.endpoints.length !== 2 || member.connectedNodeIds.length < 2,
    )
      ? ["member_connectivity_unresolved"]
      : []),
    ...(normalizedLoads.some((load) => !load.normalized)
      ? ["structural_load_unit_unresolved"]
      : []),
    ...(unsupportedLoadEntities.length
      ? ["structural_load_type_unsupported"]
      : []),
  ];
  return {
    kind: "structural-analysis",
    schema: schema(source),
    valid: errors.length === 0,
    errors,
    modelGlobalIds,
    nodes,
    members,
    activities: [...entities.values()].filter((entity) =>
      /STRUCTURAL(?:CURVE|POINT|SURFACE)ACTION/.test(entity.name),
    ).length,
    reactions: [...entities.values()].filter((entity) =>
      /STRUCTURAL(?:CURVE|POINT|SURFACE)REACTION/.test(entity.name),
    ).length,
    loads: [...entities.values()].filter((entity) =>
      entity.name.startsWith("IFCSTRUCTURALLOAD"),
    ).length,
    normalizedLoads,
    unsupportedLoadEntities,
    loadCoverage,
    unitFactors,
  };
}
