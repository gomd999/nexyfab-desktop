import type { HoleFeature } from "./holeProfile";
import type { TopologyEntitySnapshot } from "./topologyRemap";

/** Stable generative topology for hole intent. This is not kernel extraction. */
export function holeTopologySnapshots(
  featureId: string,
  hole: HoleFeature,
  hostThicknessMm?: number,
): TopologyEntitySnapshot[] {
  if (!featureId.trim()) throw new Error("hole featureId is required");
  if (!(hole.diameter > 0) || !(hole.depth > 0))
    throw new Error("hole dimensions must be positive");
  const { x, y } = hole.center;
  const radius = hole.diameter / 2;
  const through =
    hostThicknessMm !== undefined && hole.depth >= hostThicknessMm;
  const prefix = `${featureId}/`;
  const out: TopologyEntitySnapshot[] = [
    {
      kind: "face",
      persistentRef: `${prefix}f.bore`,
      featureId,
      semanticRole: "hole_bore",
      centroid: [x, y, -hole.depth / 2],
      direction: [0, 0, 1],
      measure: Math.PI * hole.diameter * hole.depth,
    },
    {
      kind: "edge",
      persistentRef: `${prefix}e.entry`,
      featureId,
      semanticRole: "hole_entry_rim",
      centroid: [x + radius, y, 0],
      direction: [0, 1, 0],
      measure: Math.PI * hole.diameter,
    },
  ];
  if (through) {
    out.push({
      kind: "edge",
      persistentRef: `${prefix}e.exit`,
      featureId,
      semanticRole: "hole_exit_rim",
      centroid: [x + radius, y, -hostThicknessMm!],
      direction: [0, 1, 0],
      measure: Math.PI * hole.diameter,
    });
  } else {
    out.push(
      {
        kind: "face",
        persistentRef: `${prefix}f.bottom`,
        featureId,
        semanticRole: "blind_hole_bottom",
        centroid: [x, y, -hole.depth],
        direction: [0, 0, 1],
        measure: Math.PI * radius * radius,
      },
      {
        kind: "edge",
        persistentRef: `${prefix}e.bottom`,
        featureId,
        semanticRole: "blind_hole_bottom_rim",
        centroid: [x + radius, y, -hole.depth],
        direction: [0, 1, 0],
        measure: Math.PI * hole.diameter,
      },
    );
  }
  if (hole.holeType === "counterbore") {
    const d = hole.counterboreDiameter;
    const depth = hole.counterboreDepth;
    if (!(d && depth))
      throw new Error("counterbore topology requires diameter and depth");
    out.push(
      {
        kind: "face",
        persistentRef: `${prefix}f.counterbore`,
        featureId,
        semanticRole: "counterbore_wall",
        centroid: [x, y, -depth / 2],
        direction: [0, 0, 1],
        measure: Math.PI * d * depth,
      },
      {
        kind: "edge",
        persistentRef: `${prefix}e.counterbore-step`,
        featureId,
        semanticRole: "counterbore_step_rim",
        centroid: [x + d / 2, y, -depth],
        direction: [0, 1, 0],
        measure: Math.PI * d,
      },
    );
  }
  if (hole.holeType === "countersink") {
    const depth = hole.countersinkDepth;
    if (!depth) throw new Error("countersink topology requires depth");
    out.push({
      kind: "face",
      persistentRef: `${prefix}f.countersink`,
      featureId,
      semanticRole: "countersink_cone",
      centroid: [x, y, -depth / 2],
      direction: [0, 0, 1],
      measure: Math.PI * radius * depth,
    });
  }
  return out;
}
