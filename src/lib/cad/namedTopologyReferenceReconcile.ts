import type { NamedTopology, RevolveNamedTopology } from "./topoNaming";
import type { EdgeAnchorSource } from "./composedTopo";
import type { Dimension, GdtCallout } from "@/lib/drawing/dimension";
import {
  remapTopologyEntities,
  type TopologyEntitySnapshot,
} from "./topologyRemap";
import {
  propagateTopologyReferences,
  type PmiTopologyRecord,
  type ReferenceReviewItem,
} from "./topologyReferencePropagation";

const distance = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Convert drawing NamedTopology faces and edges into geometric remap inputs. */
export function namedTopologySnapshots(
  topo: NamedTopology,
): TopologyEntitySnapshot[] {
  const snapshots: TopologyEntitySnapshot[] = [];
  for (const [name, locator] of topo.byName) {
    if (locator.kind === "face") {
      const face = topo.poly.faces[locator.index];
      if (!face || face.vertices.length === 0) continue;
      const points = face.vertices
        .map((index) => topo.poly.vertices[index])
        .filter(Boolean);
      if (points.length === 0) continue;
      const centroid: [number, number, number] = [
        points.reduce((sum, point) => sum + point.x, 0) / points.length,
        points.reduce((sum, point) => sum + point.y, 0) / points.length,
        points.reduce((sum, point) => sum + point.z, 0) / points.length,
      ];
      let area = 0;
      const origin = points[0]!;
      for (let i = 1; i + 1 < points.length; i += 1) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const ux = a.x - origin.x;
        const uy = a.y - origin.y;
        const uz = a.z - origin.z;
        const vx = b.x - origin.x;
        const vy = b.y - origin.y;
        const vz = b.z - origin.z;
        area +=
          Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) /
          2;
      }
      snapshots.push({
        kind: "face",
        persistentRef: name,
        semanticRole: name,
        centroid,
        direction: [face.normal.x, face.normal.y, face.normal.z],
        measure: area,
      });
      continue;
    }

    const edge = topo.edges[locator.index];
    if (!edge) continue;
    const a = topo.poly.vertices[edge.a];
    const b = topo.poly.vertices[edge.b];
    if (!a || !b) continue;
    const length = distance(a, b);
    const adjacent = edge.faces.map((faceIndex) => topo.faceName(faceIndex));
    snapshots.push({
      kind: "edge",
      persistentRef: name,
      semanticRole: name,
      centroid: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2],
      direction:
        length > 0
          ? [(b.x - a.x) / length, (b.y - a.y) / length, (b.z - a.z) / length]
          : undefined,
      measure: length,
      adjacency: adjacent,
    });
  }
  return snapshots;
}

/** Convert analytic revolve provenance names into conservative remap inputs. */
export function revolveTopologySnapshots(
  topo: RevolveNamedTopology,
): TopologyEntitySnapshot[] {
  return [...topo.byName.entries()].map(([persistentRef, entity]) => ({
    kind: entity.kind === "face" ? ("face" as const) : ("edge" as const),
    persistentRef,
    semanticRole: persistentRef,
    centroid: [entity.anchor.x, entity.anchor.y, entity.anchor.z],
    // Analytic anchors do not carry complete curve/surface measures. Exact
    // provenance survives; renamed entities remain conservatively scored.
    measure: 1,
  }));
}

/** Snapshot the resolvable edge namespace of a Boolean history result. */
export function booleanEdgeTopologySnapshots(
  source: EdgeAnchorSource,
): TopologyEntitySnapshot[] {
  return source.names().flatMap((persistentRef) => {
    const anchor = source.anchor(persistentRef);
    return anchor
      ? [
          {
            kind: "edge" as const,
            persistentRef,
            semanticRole: persistentRef,
            centroid: [anchor.x, anchor.y, anchor.z] as [
              number,
              number,
              number,
            ],
            measure: 1,
          },
        ]
      : [];
  });
}

export type DrawingTopologyReconcileResult<TPmi extends PmiTopologyRecord> = {
  dimensions: Dimension[];
  reviewDimensions: Dimension[];
  gdt: GdtCallout[];
  reviewGdt: GdtCallout[];
  pmi: TPmi[];
  reviewPmi: TPmi[];
  review: ReferenceReviewItem[];
};

/** Reconcile all drawing/MBD consumers as one topology-regeneration unit. */
export function reconcileNamedTopologyReferences<
  TPmi extends PmiTopologyRecord,
>(input: {
  before: NamedTopology;
  after: NamedTopology;
  dimensions?: readonly Dimension[];
  gdt?: readonly GdtCallout[];
  pmi?: readonly TPmi[];
}): DrawingTopologyReconcileResult<TPmi> {
  const remaps = remapTopologyEntities(
    namedTopologySnapshots(input.before),
    namedTopologySnapshots(input.after),
  );
  const propagated = propagateTopologyReferences({
    remaps,
    dimensions: input.dimensions,
    gdt: input.gdt,
    pmi: input.pmi,
  });
  return {
    dimensions: propagated.activeDimensions,
    reviewDimensions: propagated.reviewDimensions,
    gdt: propagated.activeGdt,
    reviewGdt: propagated.reviewGdt,
    pmi: propagated.activePmi,
    reviewPmi: propagated.reviewPmi,
    review: propagated.review,
  };
}
