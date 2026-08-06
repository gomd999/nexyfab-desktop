import { parseEntities } from "@/lib/brep-bridge/stepImport";
import {
  multiplyStepMatrices,
  readStepNauoTransform,
  type Matrix4,
} from "@/lib/brep-bridge/stepAssemblyImport";
import { healStepSource } from "@/lib/brep-bridge/stepRead";

export interface StepAssemblyStructureEvidence {
  occurrences: number;
  maxDepth: number;
  repeatedDefinitions: number;
  transformedOccurrences: number;
  shaftNamedDefinitions: number;
  bearingNamedDefinitions: number;
}

export interface StepOccurrencePlacementEvidence {
  occurrenceId: string;
  entityId: number;
  parentDefinitionId: number;
  childDefinitionId: number;
  parentOccurrenceId: string | null;
  localToParent:
    | { status: "available"; matrix: Matrix4 }
    | { status: "missing" | "invalid"; reason: string };
  worldPlacement:
    | { status: "available"; matrix: Matrix4 }
    | { status: "not_run"; reason: string };
  determinant: number | null;
  reflection: boolean | null;
  nonUniformScale: boolean | null;
}

export interface StepAssemblyPlacementEvidence {
  sourceOccurrenceCount: number;
  cycleFree: boolean;
  occurrences: StepOccurrencePlacementEvidence[];
  availableTransformCount: number;
  missingTransformCount: number;
  invalidTransformCount: number;
  worldPlacementCount: number;
  reflectionCount: number;
  nonUniformScaleCount: number;
}
export interface StepPatternGroupEvidence {
  childDefinitionId: number;
  occurrenceIds: string[];
  status: "pass" | "fail" | "not_run";
  kind: "linear" | "circular" | "unknown";
  pitch: number | null;
  maxDeviation: number | null;
  reason: string;
}
export interface StepPatternFidelityEvidence {
  status: "pass" | "fail" | "not_run";
  groups: StepPatternGroupEvidence[];
  regularGroups: number;
  irregularGroups: number;
  unresolvedGroups: number;
  tolerance: number;
}

const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function validateStepOccurrenceMatrix(matrix: Matrix4): {
  valid: boolean;
  determinant: number | null;
  reflection: boolean | null;
  nonUniformScale: boolean | null;
  reason?: string;
} {
  if (
    !matrix.every(Number.isFinite) ||
    Math.abs(matrix[12]) > 1e-9 ||
    Math.abs(matrix[13]) > 1e-9 ||
    Math.abs(matrix[14]) > 1e-9 ||
    Math.abs(matrix[15] - 1) > 1e-9
  ) {
    return {
      valid: false,
      determinant: null,
      reflection: null,
      nonUniformScale: null,
      reason: "Transform is not a finite affine 4x4 matrix.",
    };
  }
  const a = matrix[0],
    b = matrix[1],
    c = matrix[2],
    d = matrix[4],
    e = matrix[5],
    f = matrix[6],
    g = matrix[8],
    h = matrix[9],
    i = matrix[10];
  const determinant =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const scales = [
    Math.hypot(a, d, g),
    Math.hypot(b, e, h),
    Math.hypot(c, f, i),
  ];
  const maxScale = Math.max(...scales);
  const nonUniformScale =
    maxScale > 0 &&
    Math.max(...scales) - Math.min(...scales) > Math.max(1e-9, maxScale * 1e-9);
  if (
    Math.abs(determinant) <= 1e-12 ||
    scales.some((scale) => scale <= 1e-12)
  ) {
    return {
      valid: false,
      determinant,
      reflection: null,
      nonUniformScale,
      reason: "Transform basis is singular.",
    };
  }
  return {
    valid: true,
    determinant,
    reflection: determinant < 0,
    nonUniformScale,
  };
}

/** Occurrence evidence is deliberately independent of solid/body topology. */
export function analyzeStepAssemblyPlacements(
  source: string,
): StepAssemblyPlacementEvidence {
  const healed = healStepSource(source).healed;
  const data = healed.search(/\bDATA\s*;/i);
  const end = healed.indexOf("END-ISO-10303-21");
  const entities =
    data < 0
      ? new Map()
      : parseEntities(healed.slice(data, end >= 0 ? end : undefined));
  const edges = [...entities.entries()]
    .flatMap(([entityId, entity]) => {
      if (entity.name !== "NEXT_ASSEMBLY_USAGE_OCCURRENCE") return [];
      const parent = entity.args[3];
      const child = entity.args[4];
      return parent?.kind === "ref" && child?.kind === "ref"
        ? [
            {
              entityId,
              parentDefinitionId: parent.id,
              childDefinitionId: child.id,
            },
          ]
        : [];
    })
    .sort((left, right) => left.entityId - right.entityId);
  const outgoing = new Map<number, typeof edges>();
  const incoming = new Map<number, typeof edges>();
  for (const edge of edges) {
    outgoing.set(edge.parentDefinitionId, [
      ...(outgoing.get(edge.parentDefinitionId) ?? []),
      edge,
    ]);
    incoming.set(edge.childDefinitionId, [
      ...(incoming.get(edge.childDefinitionId) ?? []),
      edge,
    ]);
  }
  let cycleFree = true;
  const visit = (
    definitionId: number,
    visiting: Set<number>,
    visited: Set<number>,
  ): void => {
    if (visiting.has(definitionId)) {
      cycleFree = false;
      return;
    }
    if (visited.has(definitionId)) return;
    const next = new Set(visiting);
    next.add(definitionId);
    for (const edge of outgoing.get(definitionId) ?? [])
      visit(edge.childDefinitionId, next, visited);
    visited.add(definitionId);
  };
  const visited = new Set<number>();
  for (const definitionId of new Set(
    edges.flatMap((edge) => [edge.parentDefinitionId, edge.childDefinitionId]),
  ))
    visit(definitionId, new Set(), visited);

  const memo = new Map<
    number,
    StepOccurrencePlacementEvidence["worldPlacement"]
  >();
  const resolveWorld = (
    edge: (typeof edges)[number],
    stack: Set<number>,
  ): StepOccurrencePlacementEvidence["worldPlacement"] => {
    const cached = memo.get(edge.entityId);
    if (cached) return cached;
    if (stack.has(edge.entityId))
      return {
        status: "not_run",
        reason: "Occurrence cycle prevents world placement.",
      };
    const local = readStepNauoTransform(edge.entityId, entities);
    if (local.status !== "available")
      return {
        status: "not_run",
        reason: `Local transform is ${local.status}.`,
      };
    const checked = validateStepOccurrenceMatrix(local.matrix);
    if (!checked.valid || checked.reflection || checked.nonUniformScale)
      return {
        status: "not_run",
        reason:
          checked.reason ?? "Transform is not a supported rigid placement.",
      };
    const parents = incoming.get(edge.parentDefinitionId) ?? [];
    if (parents.length > 1)
      return {
        status: "not_run",
        reason:
          "Parent definition has multiple occurrence contexts; one world frame cannot be inferred for this NAUO entity.",
      };
    if (parents.length === 0) {
      const result = {
        status: "available" as const,
        matrix: multiplyStepMatrices(IDENTITY, local.matrix),
      };
      memo.set(edge.entityId, result);
      return result;
    }
    const parentWorld = resolveWorld(
      parents[0]!,
      new Set(stack).add(edge.entityId),
    );
    const result =
      parentWorld.status === "available"
        ? {
            status: "available" as const,
            matrix: multiplyStepMatrices(parentWorld.matrix, local.matrix),
          }
        : {
            status: "not_run" as const,
            reason: `Parent world placement unavailable: ${parentWorld.reason}`,
          };
    memo.set(edge.entityId, result);
    return result;
  };

  const occurrences = edges.map((edge) => {
    let localToParent = readStepNauoTransform(edge.entityId, entities);
    const checked =
      localToParent.status === "available"
        ? validateStepOccurrenceMatrix(localToParent.matrix)
        : null;
    if (localToParent.status === "available" && checked && !checked.valid)
      localToParent = {
        status: "invalid",
        reason: checked.reason ?? "Invalid transform.",
      };
    const parents = incoming.get(edge.parentDefinitionId) ?? [];
    return {
      occurrenceId: `#${edge.entityId}`,
      entityId: edge.entityId,
      parentDefinitionId: edge.parentDefinitionId,
      childDefinitionId: edge.childDefinitionId,
      parentOccurrenceId:
        parents.length === 1 ? `#${parents[0]!.entityId}` : null,
      localToParent,
      worldPlacement: cycleFree
        ? resolveWorld(edge, new Set())
        : {
            status: "not_run" as const,
            reason: "Assembly definition graph contains a cycle.",
          },
      determinant: checked?.determinant ?? null,
      reflection: checked?.reflection ?? null,
      nonUniformScale: checked?.nonUniformScale ?? null,
    } satisfies StepOccurrencePlacementEvidence;
  });
  return {
    sourceOccurrenceCount: edges.length,
    cycleFree,
    occurrences,
    availableTransformCount: occurrences.filter(
      (item) => item.localToParent.status === "available",
    ).length,
    missingTransformCount: occurrences.filter(
      (item) => item.localToParent.status === "missing",
    ).length,
    invalidTransformCount: occurrences.filter(
      (item) => item.localToParent.status === "invalid",
    ).length,
    worldPlacementCount: occurrences.filter(
      (item) => item.worldPlacement.status === "available",
    ).length,
    reflectionCount: occurrences.filter((item) => item.reflection === true)
      .length,
    nonUniformScaleCount: occurrences.filter(
      (item) => item.nonUniformScale === true,
    ).length,
  };
}

export function classifyStepOccurrencePattern(
  points: Array<[number, number, number]>,
  tolerance = 1e-4,
): Omit<StepPatternGroupEvidence, "childDefinitionId" | "occurrenceIds"> {
  if (points.length < 3)
    return {
      status: "not_run",
      kind: "unknown",
      pitch: null,
      maxDeviation: null,
      reason: "At least three occurrence placements are required.",
    };
  const distance = (a: [number, number, number], b: [number, number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let ai = 0,
    bi = 1,
    maxDistance = 0;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const d = distance(points[i]!, points[j]!);
      if (d > maxDistance) {
        maxDistance = d;
        ai = i;
        bi = j;
      }
    }
  if (maxDistance <= tolerance)
    return {
      status: "fail",
      kind: "unknown",
      pitch: null,
      maxDeviation: 0,
      reason: "Repeated occurrences collapse onto one placement.",
    };
  const a = points[ai]!,
    b = points[bi]!,
    axis: [number, number, number] = [
      (b[0] - a[0]) / maxDistance,
      (b[1] - a[1]) / maxDistance,
      (b[2] - a[2]) / maxDistance,
    ],
    project = (p: [number, number, number]) =>
      (p[0] - a[0]) * axis[0] +
      (p[1] - a[1]) * axis[1] +
      (p[2] - a[2]) * axis[2],
    lineDeviation = (p: [number, number, number]) => {
      const t = project(p);
      return distance(p, [
        a[0] + t * axis[0],
        a[1] + t * axis[1],
        a[2] + t * axis[2],
      ]);
    },
    lineMax = Math.max(...points.map(lineDeviation));
  if (lineMax <= tolerance) {
    const stations = points.map(project).sort((x, y) => x - y),
      gaps = stations.slice(1).map((value, index) => value - stations[index]!),
      pitch = gaps.reduce((sum, value) => sum + value, 0) / gaps.length,
      maxDeviation = Math.max(...gaps.map((value) => Math.abs(value - pitch)));
    return maxDeviation <= Math.max(tolerance, Math.abs(pitch) * 1e-6)
      ? {
          status: "pass",
          kind: "linear",
          pitch,
          maxDeviation,
          reason: "Occurrence origins form a regular linear pitch.",
        }
      : {
          status: "fail",
          kind: "linear",
          pitch,
          maxDeviation,
          reason: "Collinear occurrence origins have irregular pitch.",
        };
  }
  if (points.length < 4)
    return {
      status: "not_run",
      kind: "unknown",
      pitch: null,
      maxDeviation: lineMax,
      reason:
        "Three non-collinear placements do not prove a governed circular pattern.",
    };
  const centroid = points.reduce<[number, number, number]>(
      (sum, p) => [
        sum[0] + p[0] / points.length,
        sum[1] + p[1] / points.length,
        sum[2] + p[2] / points.length,
      ],
      [0, 0, 0],
    ),
    radii = points.map((p) => distance(p, centroid)),
    radius = radii.reduce((sum, value) => sum + value, 0) / radii.length,
    radialDeviation = Math.max(
      ...radii.map((value) => Math.abs(value - radius)),
    );
  if (radialDeviation > Math.max(tolerance, radius * 1e-6))
    return {
      status: "fail",
      kind: "unknown",
      pitch: null,
      maxDeviation: radialDeviation,
      reason:
        "Repeated occurrence origins are neither regular linear nor centroidal circular.",
    };
  const u: [number, number, number] = [
      (points[0]![0] - centroid[0]) / radius,
      (points[0]![1] - centroid[1]) / radius,
      (points[0]![2] - centroid[2]) / radius,
    ],
    rawNormal = [...Array(3)] as [number, number, number];
  const v0 = [
    points[1]![0] - centroid[0],
    points[1]![1] - centroid[1],
    points[1]![2] - centroid[2],
  ] as [number, number, number];
  rawNormal[0] = u[1] * v0[2] - u[2] * v0[1];
  rawNormal[1] = u[2] * v0[0] - u[0] * v0[2];
  rawNormal[2] = u[0] * v0[1] - u[1] * v0[0];
  const nn = Math.hypot(...rawNormal);
  if (nn <= 1e-12)
    return {
      status: "fail",
      kind: "unknown",
      pitch: null,
      maxDeviation: radialDeviation,
      reason: "Circular pattern plane is degenerate.",
    };
  const n = rawNormal.map((value) => value / nn) as [number, number, number],
    v: [number, number, number] = [
      n[1] * u[2] - n[2] * u[1],
      n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0],
    ],
    angles = points
      .map((p) => {
        const d = [p[0] - centroid[0], p[1] - centroid[1], p[2] - centroid[2]];
        return Math.atan2(
          d[0] * v[0] + d[1] * v[1] + d[2] * v[2],
          d[0] * u[0] + d[1] * u[1] + d[2] * u[2],
        );
      })
      .sort((x, y) => x - y),
    gaps = angles.map((angle, index) =>
      index === angles.length - 1
        ? angles[0]! + 2 * Math.PI - angle
        : angles[index + 1]! - angle,
    ),
    pitch = gaps.reduce((sum, value) => sum + value, 0) / gaps.length,
    maxDeviation = Math.max(
      radialDeviation,
      ...gaps.map((value) => radius * Math.abs(value - pitch)),
    );
  return maxDeviation <= Math.max(tolerance, radius * 1e-6)
    ? {
        status: "pass",
        kind: "circular",
        pitch,
        maxDeviation,
        reason: "Occurrence origins form a regular circular angular pitch.",
      }
    : {
        status: "fail",
        kind: "circular",
        pitch,
        maxDeviation,
        reason: "Centroidal circular occurrences have irregular angular pitch.",
      };
}

export function analyzeStepPatternFidelity(
  source: string,
  tolerance = 1e-4,
): StepPatternFidelityEvidence {
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("positive finite pattern tolerance required");
  const placement = analyzeStepAssemblyPlacements(source),
    groupsByDefinition = new Map<number, StepOccurrencePlacementEvidence[]>();
  for (const occurrence of placement.occurrences)
    groupsByDefinition.set(occurrence.childDefinitionId, [
      ...(groupsByDefinition.get(occurrence.childDefinitionId) ?? []),
      occurrence,
    ]);
  const groups: StepPatternGroupEvidence[] = [];
  for (const [childDefinitionId, items] of groupsByDefinition) {
    if (items.length < 3) continue;
    const available = items.filter(
      (item) => item.worldPlacement.status === "available",
    );
    if (available.length !== items.length) {
      groups.push({
        childDefinitionId,
        occurrenceIds: items.map((item) => item.occurrenceId),
        status: "not_run",
        kind: "unknown",
        pitch: null,
        maxDeviation: null,
        reason:
          "One or more repeated occurrences has no authoritative world placement.",
      });
      continue;
    }
    const classified = classifyStepOccurrencePattern(
      available.map((item) => {
        const matrix = (
          item.worldPlacement as { status: "available"; matrix: Matrix4 }
        ).matrix;
        return [matrix[3], matrix[7], matrix[11]];
      }),
      tolerance,
    );
    groups.push({
      childDefinitionId,
      occurrenceIds: items.map((item) => item.occurrenceId),
      ...classified,
    });
  }
  const regularGroups = groups.filter(
      (group) => group.status === "pass",
    ).length,
    irregularGroups = groups.filter((group) => group.status === "fail").length,
    unresolvedGroups = groups.filter(
      (group) => group.status === "not_run",
    ).length,
    status = irregularGroups
      ? "fail"
      : unresolvedGroups
        ? "not_run"
        : regularGroups
          ? "pass"
          : "not_run";
  return {
    status,
    groups,
    regularGroups,
    irregularGroups,
    unresolvedGroups,
    tolerance,
  };
}

/** Structural evidence only: this never invents mates from STEP placements. */
export function analyzeStepAssemblyStructure(
  source: string,
): StepAssemblyStructureEvidence {
  const healed = healStepSource(source).healed;
  const data = healed.search(/\bDATA\s*;/i);
  const end = healed.indexOf("END-ISO-10303-21");
  const entities =
    data < 0
      ? new Map()
      : parseEntities(healed.slice(data, end >= 0 ? end : undefined));
  const children = new Map<number, number[]>();
  const childUse = new Map<number, number>();
  let occurrences = 0;
  for (const entity of entities.values()) {
    if (entity.name !== "NEXT_ASSEMBLY_USAGE_OCCURRENCE") continue;
    const parent = entity.args[3];
    const child = entity.args[4];
    if (parent?.kind !== "ref" || child?.kind !== "ref") continue;
    occurrences++;
    children.set(parent.id, [...(children.get(parent.id) ?? []), child.id]);
    childUse.set(child.id, (childUse.get(child.id) ?? 0) + 1);
  }
  const allChildren = new Set([...children.values()].flat());
  const roots = [...children.keys()].filter((id) => !allChildren.has(id));
  const depth = (id: number, seen = new Set<number>()): number => {
    if (seen.has(id)) return 0;
    const next = new Set(seen);
    next.add(id);
    const kids = children.get(id) ?? [];
    return kids.length
      ? 1 + Math.max(...kids.map((kid) => depth(kid, next)))
      : 0;
  };
  const productText = [...entities.values()]
    .filter((entity) => entity.name === "PRODUCT")
    .map((entity) => JSON.stringify(entity.args).toLowerCase());
  const transformedOccurrences = [...entities.values()].filter(
    (entity) =>
      entity.name === "ITEM_DEFINED_TRANSFORMATION" ||
      entity.name === "CARTESIAN_TRANSFORMATION_OPERATOR_3D",
  ).length;
  return {
    occurrences,
    maxDepth: roots.length ? Math.max(...roots.map((root) => depth(root))) : 0,
    repeatedDefinitions: [...childUse.values()].filter((count) => count > 1)
      .length,
    transformedOccurrences,
    shaftNamedDefinitions: productText.filter((text) =>
      /shaft|spindle|axle/.test(text),
    ).length,
    bearingNamedDefinitions: productText.filter((text) =>
      /bearing|bushing|bush/.test(text),
    ).length,
  };
}
