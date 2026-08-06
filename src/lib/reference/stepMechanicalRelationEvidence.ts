import { importStepAssembly } from "@/lib/brep-bridge/stepAssemblyImport";
import type { PartInstance, Quat } from "@/lib/assembly/assemblyState";
import {
  analyzeStepPatternFidelity,
  type StepPatternFidelityEvidence,
} from "./stepAssemblyEvidence";
import {
  analyzeStepWeldmentEvidence,
  type StepWeldmentEvidence,
} from "./stepWeldmentEvidence";
import {
  analyzeStepSheetMetalEvidence,
  type StepSheetMetalEvidence,
} from "./stepSheetMetalEvidence";

type V3 = [number, number, number];
export interface StepWorldCylinderAxis {
  partId: string;
  partName: string;
  partTemplateId: string;
  surfaceEntityId: number;
  origin: V3;
  direction: V3;
  radius: number;
}
export interface StepCoaxialPair {
  partA: string;
  partB: string;
  surfaceA: number;
  surfaceB: number;
  angularErrorRad: number;
  axisDistance: number;
  radiusDelta: number;
}
export interface StepMechanicalRelationEvidence {
  axes: StepWorldCylinderAxis[];
  coaxialPairs: StepCoaxialPair[];
  shaftBearingPairs: StepCoaxialPair[];
  pattern: StepPatternFidelityEvidence;
  weldment: StepWeldmentEvidence;
  sheetMetal: StepSheetMetalEvidence;
  tolerance: { angularRad: number; linear: number };
  warnings: string[];
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3) => Math.hypot(...a);
const unit = (a: V3): V3 => {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 1];
};
const rotate = (v: V3, q: Quat): V3 => {
  const u: V3 = [q.x, q.y, q.z],
    uv = cross(u, v),
    uuv = cross(u, uv);
  return [
    v[0] + 2 * (q.w * uv[0] + uuv[0]),
    v[1] + 2 * (q.w * uv[1] + uuv[1]),
    v[2] + 2 * (q.w * uv[2] + uuv[2]),
  ];
};
const worldPoint = (p: V3, part: PartInstance): V3 =>
  add(rotate(p, part.orientation), [
    part.position.x,
    part.position.y,
    part.position.z,
  ]);

export function analyzeStepMechanicalRelations(
  source: string,
  options: { angularToleranceRad?: number; linearTolerance?: number } = {},
): StepMechanicalRelationEvidence {
  const angularRad = options.angularToleranceRad ?? 1e-5,
    linear = options.linearTolerance ?? 1e-4;
  if (
    !Number.isFinite(angularRad) ||
    angularRad <= 0 ||
    !Number.isFinite(linear) ||
    linear <= 0
  )
    throw new Error(
      "positive finite mechanical-relation tolerances are required",
    );
  const imported = importStepAssembly(source, {
      maxClassifyParts: 0,
      collectBounds: true,
    }),
    parts = new Map(imported.state.parts.map((part) => [part.id, part]));
  const axes: StepWorldCylinderAxis[] = [];
  for (const [partId, localAxes] of Object.entries(
    imported.cylinderAxes ?? {},
  )) {
    const part = parts.get(partId);
    if (!part) continue;
    for (const axis of localAxes)
      axes.push({
        partId,
        partName: part.name,
        partTemplateId: part.partTemplateId,
        surfaceEntityId: axis.entityId,
        origin: worldPoint(axis.origin, part),
        direction: unit(rotate(axis.direction, part.orientation)),
        radius: axis.radius,
      });
  }
  const coaxialPairs: StepCoaxialPair[] = [];
  for (let i = 0; i < axes.length; i++)
    for (let j = i + 1; j < axes.length; j++) {
      const a = axes[i]!,
        b = axes[j]!;
      if (a.partId === b.partId) continue;
      const cosine = Math.min(1, Math.abs(dot(a.direction, b.direction))),
        angularErrorRad = Math.acos(cosine),
        axisDistance = norm(cross(sub(b.origin, a.origin), a.direction));
      if (angularErrorRad <= angularRad && axisDistance <= linear)
        coaxialPairs.push({
          partA: a.partId,
          partB: b.partId,
          surfaceA: a.surfaceEntityId,
          surfaceB: b.surfaceEntityId,
          angularErrorRad,
          axisDistance,
          radiusDelta: Math.abs(a.radius - b.radius),
        });
    }
  const role = (name: string) =>
    /shaft|spindle|axle|축/i.test(name)
      ? "shaft"
      : /bearing|bushing|bush|베어링/i.test(name)
        ? "bearing"
        : "other";
  const byId = new Map(axes.map((axis) => [axis.partId, axis]));
  const shaftBearingPairs = coaxialPairs.filter((pair) => {
    const a = role(byId.get(pair.partA)?.partName ?? ""),
      b = role(byId.get(pair.partB)?.partName ?? "");
    return (
      (a === "shaft" && b === "bearing") || (a === "bearing" && b === "shaft")
    );
  });
  return {
    axes,
    coaxialPairs,
    shaftBearingPairs,
    pattern: analyzeStepPatternFidelity(source, linear),
    weldment: analyzeStepWeldmentEvidence(source),
    sheetMetal: analyzeStepSheetMetalEvidence(source, imported),
    tolerance: { angularRad, linear },
    warnings: imported.warnings,
  };
}
