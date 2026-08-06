import {
  importStepAssembly,
  type StepAssemblyImportResult,
} from "@/lib/brep-bridge/stepAssemblyImport";
import type { StepAnalyticArc2D } from "@/lib/brep-bridge/stepImport";
type V3 = [number, number, number];
export interface StepCylinderEvidence {
  entityId: number;
  origin: V3;
  direction: V3;
  radius: number;
  angularSpanDeg?: number;
}
export interface StepBendEvidence {
  partId: string;
  innerSurfaceId: number;
  outerSurfaceId: number;
  innerRadius: number;
  outerRadius: number;
  thickness: number;
  axisOrigin: V3;
  axisDirection: V3;
  angleDeg?: number;
}
export interface StepFlatPatternEvidence {
  partId: string;
  outline: Array<[number, number]>;
  outerArcs: StepAnalyticArc2D[];
  holes: Array<{ center: [number, number]; radius: number }>;
  area: number;
  thickness: number;
  sourceFeatureId: string;
}
export interface StepPanelEvidence {
  partId: string;
  partName: string;
  thicknessAxis: "x" | "y" | "z";
  thickness: number;
  inPlane: [number, number];
  throughCylinderCount: number;
  bends: StepBendEvidence[];
}
export interface StepSheetMetalEvidence {
  status: "pass" | "fail" | "not_run";
  panels: StepPanelEvidence[];
  thicknessHistogram: Array<{ thickness: number; count: number }>;
  flatPattern: {
    status: "pass" | "not_run";
    patterns: StepFlatPatternEvidence[];
    unresolved: Array<{
      partId: string;
      code:
        | "classification_failed"
        | "multiple_features"
        | "inner_loops_unrepresented"
        | "outer_arcs_approximated"
        | "invalid_outline";
      detail: string;
      remediation: string;
    }>;
    reason?: string;
  };
  bendTable: {
    status: "pass" | "not_run";
    rows: StepBendEvidence[];
    reason?: string;
  };
  warnings: string[];
}
export function classifyStepPanels(
  items: Array<{
    partId: string;
    partName: string;
    size: [number, number, number];
    cylinderDirections?: Array<[number, number, number]>;
    cylinders?: StepCylinderEvidence[];
  }>,
  options: { maximumThickness?: number; minimumAspect?: number } = {},
): StepPanelEvidence[] {
  const maximumThickness = options.maximumThickness ?? 5,
    minimumAspect = options.minimumAspect ?? 5;
  if (
    !Number.isFinite(maximumThickness) ||
    maximumThickness <= 0 ||
    !Number.isFinite(minimumAspect) ||
    minimumAspect <= 1
  )
    throw new Error("positive panel classification limits required");
  return items.flatMap((item) => {
    if (item.size.some((value) => !Number.isFinite(value) || value <= 1e-8))
      return [];
    const axisIndex = item.size.indexOf(Math.min(...item.size)),
      thickness = item.size[axisIndex]!,
      inPlane = item.size
        .filter((_, index) => index !== axisIndex)
        .sort((a, b) => a - b) as [number, number];
    if (thickness > maximumThickness || inPlane[0] / thickness < minimumAspect)
      return [];
    const throughCylinderCount = (item.cylinderDirections ?? []).filter(
      (direction) => Math.abs(direction[axisIndex]!) >= 1 - 1e-6,
    ).length;
    const bends = classifyStepBends(
      item.partId,
      thickness,
      axisIndex,
      item.cylinders ?? [],
    );
    return [
      {
        partId: item.partId,
        partName: item.partName,
        thicknessAxis: (["x", "y", "z"] as const)[axisIndex]!,
        thickness,
        inPlane,
        throughCylinderCount,
        bends,
      },
    ];
  });
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3) => Math.hypot(...a);
/** A sheet bend is accepted only when two analytic cylinder surfaces are
 * coaxial, their radius delta equals the measured sheet thickness, and the
 * bend axis lies in the sheet plane. A lone cylinder remains a hole/round. */
export function classifyStepBends(
  partId: string,
  thickness: number,
  thicknessAxisIndex: number,
  cylinders: StepCylinderEvidence[],
  tolerance = 1e-4,
): StepBendEvidence[] {
  if (
    !Number.isFinite(thickness) ||
    thickness <= 0 ||
    ![0, 1, 2].includes(thicknessAxisIndex)
  )
    throw new Error("valid sheet thickness and thickness axis required");
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("positive bend tolerance required");
  const result: StepBendEvidence[] = [];
  for (let i = 0; i < cylinders.length; i++)
    for (let j = i + 1; j < cylinders.length; j++) {
      const a = cylinders[i]!,
        b = cylinders[j]!,
        directionDot = Math.abs(dot(a.direction, b.direction)),
        axisDistance = norm(
          cross(
            [
              b.origin[0] - a.origin[0],
              b.origin[1] - a.origin[1],
              b.origin[2] - a.origin[2],
            ],
            a.direction,
          ),
        );
      if (
        1 - directionDot > tolerance ||
        axisDistance > tolerance ||
        Math.abs(Math.abs(a.radius - b.radius) - thickness) > tolerance ||
        Math.abs(a.direction[thicknessAxisIndex]!) > tolerance
      )
        continue;
      const [inner, outer] = a.radius <= b.radius ? [a, b] : [b, a],
        spans = [inner.angularSpanDeg, outer.angularSpanDeg].filter(
          (value): value is number =>
            value !== undefined && Number.isFinite(value),
        ),
        angleDeg =
          spans.length === 2 && Math.abs(spans[0]! - spans[1]!) <= 1e-3
            ? (spans[0]! + spans[1]!) / 2
            : undefined;
      result.push({
        partId,
        innerSurfaceId: inner.entityId,
        outerSurfaceId: outer.entityId,
        innerRadius: inner.radius,
        outerRadius: outer.radius,
        thickness,
        axisOrigin: inner.origin,
        axisDirection: inner.direction,
        angleDeg,
      });
    }
  return result;
}
export function analyzeStepSheetMetalEvidence(
  source: string,
  existing?: StepAssemblyImportResult,
): StepSheetMetalEvidence {
  const imported =
      existing ??
      importStepAssembly(source, {
        maxClassifyParts: 0,
        collectBounds: true,
      }),
    panels = classifyStepPanels(
      imported.state.parts.flatMap((part) => {
        const bounds = imported.bounds?.[part.id];
        return bounds
          ? [
              {
                partId: part.id,
                partName: part.name,
                size: bounds.max.map(
                  (value, index) => value - bounds.min[index]!,
                ) as [number, number, number],
                cylinderDirections: imported.cylinderAxes?.[part.id]?.map(
                  (axis) => axis.direction,
                ),
                cylinders: imported.cylinderAxes?.[part.id],
              },
            ]
          : [];
      }),
    ),
    counts = new Map<number, number>();
  for (const panel of panels) {
    const key = Number(panel.thickness.toPrecision(9));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const classified = panels.length
      ? importStepAssembly(source, {
          maxClassifyParts: panels.length,
          classifyPartsFor: new Set(panels.map((panel) => panel.partId)),
        })
      : undefined,
    unresolvedFlat: StepSheetMetalEvidence["flatPattern"]["unresolved"] = [],
    flatPatterns = panels.flatMap((panel): StepFlatPatternEvidence[] => {
      const tree = classified?.featureTrees[panel.partId],
        node = tree?.nodes.length === 1 ? tree.nodes[0] : undefined,
        retained = classified?.flatPatterns?.[panel.partId],
        innerLoopsMissing = classified!.warnings.some(
          (warning) =>
            warning.includes(`part_${panel.partId}:`) &&
            warning.includes("inner_loops_unrepresented"),
        ),
        outerArcsApproximated = classified!.warnings.some(
          (warning) =>
            warning.includes(`part_${panel.partId}:`) &&
            warning.includes("outer_arcs_chord_approximated"),
        ),
        diagnostics = classified!.unsupported.filter((item) =>
          item.includes(`part_${panel.partId}:`),
        );
      if (retained?.length === 1) {
        const profile = retained[0]!,
          area = profile.area;
        if (area > 0)
          return [
            {
              partId: panel.partId,
              outline: profile.outline,
              outerArcs: profile.outerArcs,
              holes: profile.holes,
              area,
              thickness: profile.thickness,
              sourceFeatureId: node?.id ?? `${panel.partId}:retained_profile`,
            },
          ];
      }
      if (outerArcsApproximated) {
        unresolvedFlat.push({
          partId: panel.partId,
          code: "outer_arcs_approximated",
          detail:
            "One or more outer-loop arcs were converted to chords, so the outline is not exact.",
          remediation:
            "Preserve CIRCLE/TRIMMED_CURVE edges analytically in the flat-profile IR.",
        });
        return [];
      }
      if (innerLoopsMissing) {
        unresolvedFlat.push({
          partId: panel.partId,
          code: "inner_loops_unrepresented",
          detail:
            "The source face contains inner loops absent from the current profile IR.",
          remediation:
            "Recover FACE_BOUND inner loops as hole profiles before unfolding.",
        });
        return [];
      }
      if (!node || node.payload.kind !== "extrude") {
        const multiple = (tree?.nodes.length ?? 0) > 1;
        unresolvedFlat.push({
          partId: panel.partId,
          code: multiple ? "multiple_features" : "classification_failed",
          detail:
            diagnostics.join(" | ") ||
            "No single planar extrude feature was reconstructed.",
          remediation: multiple
            ? "Resolve the panel multi-solid/body boundary before flattening."
            : "Route this part through exact OCCT face-loop recovery.",
        });
        return [];
      }
      const outline = node.payload.loop.map(
        (point) => [point.x, point.y] as [number, number],
      );
      if (outline.length < 3) {
        unresolvedFlat.push({
          partId: panel.partId,
          code: "invalid_outline",
          detail: "The recovered outer loop has fewer than three vertices.",
          remediation:
            "Heal and re-order the face edge loop, then retry classification.",
        });
        return [];
      }
      const signedDoubleArea = outline.reduce((sum, point, index) => {
        const next = outline[(index + 1) % outline.length]!;
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0);
      const area = Math.abs(signedDoubleArea) / 2;
      if (!(area > 0)) {
        unresolvedFlat.push({
          partId: panel.partId,
          code: "invalid_outline",
          detail: "The recovered outer loop has zero or invalid area.",
          remediation:
            "Heal and re-order the face edge loop, then retry classification.",
        });
        return [];
      }
      return [
        {
          partId: panel.partId,
          outline,
          outerArcs: [],
          holes: [],
          area,
          thickness: panel.thickness,
          sourceFeatureId: node.id,
        },
      ];
    });
  return {
    status:
      panels.length >= 2
        ? "pass"
        : imported.state.parts.length
          ? "fail"
          : "not_run",
    panels,
    thicknessHistogram: [...counts]
      .map(([thickness, count]) => ({ thickness, count }))
      .sort((a, b) => b.count - a.count),
    flatPattern:
      panels.length > 0 && flatPatterns.length === panels.length
        ? { status: "pass", patterns: flatPatterns, unresolved: [] }
        : {
            status: "not_run",
            patterns: flatPatterns,
            unresolved: unresolvedFlat,
            reason: panels.length
              ? `Not every panel has one exact planar extrude outline with all inner loops represented (${unresolvedFlat.map((item) => `${item.partId}:${item.code}`).join(", ")}).`
              : "No constant-thickness panel is available for flat-pattern recovery.",
          },
    bendTable:
      panels.length > 0 &&
      flatPatterns.length === panels.length &&
      panels.every((panel) => panel.bends.length === 0)
        ? {
            status: "pass",
            rows: [],
            reason:
              "Authoritative empty bend table: every panel is an exact planar extrude and no in-plane coaxial bend surfaces exist.",
          }
        : panels.some((panel) =>
              panel.bends.some((bend) => bend.angleDeg !== undefined),
            )
          ? {
              status: "pass",
              rows: panels
                .flatMap((panel) => panel.bends)
                .filter((bend) => bend.angleDeg !== undefined),
            }
          : {
              status: "not_run",
              rows: panels.flatMap((panel) => panel.bends),
              reason: panels.some((panel) => panel.bends.length)
                ? "Coaxial inner/outer bend surfaces are proven, but trimmed angular bounds are unavailable."
                : "No coaxial inner/outer cylinder pair has a radius delta equal to sheet thickness, and planar completeness is not proven.",
            },
    warnings: imported.warnings,
  };
}
