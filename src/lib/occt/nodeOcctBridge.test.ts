// @vitest-environment node
/**
 * nodeOcctBridge — K1b-real: feature tree → plan → executeOcctPlan → REAL OCCT
 * B-rep. Skips gracefully if the wasm isn't available.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadOcctNode } from "./nodeOcctLoader";
import { createNodeOcctBridge } from "./nodeOcctBridge";
import { featureTreeToOcctPlan } from "./featurePlan";
import { executeOcctPlan } from "./planExecutor";
import type { OcctBridge } from "./bridge";
import type { FeatureTree, FeatureNode } from "@/lib/cad/featureTree";
import type { ExtrudeFeature } from "@/lib/cad/extrudeProfile";
import type { RevolveFeature } from "@/lib/cad/revolveProfile";
import { CAD_CORPUS_MANIFEST_V2 } from "@/lib/reference/cadCorpusManifestV2";
import { resolveCadCorpusFixtureV2 } from "@/lib/reference/cadCorpusManifestV2Resolver";

let okLoad = false;
let bridge: OcctBridge;

beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) {
    bridge = createNodeOcctBridge(r.oc);
    okLoad = true;
  } else console.warn(`[occt] bridge tests skipped — ${r.reason}`);
}, 60_000);

function extrudeNode(
  id: string,
  loop: Array<{ x: number; y: number }>,
  depth: number,
): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: "extrude",
    loop,
    depth,
    direction: "one_sided",
    mode: "add",
  };
  return { id, name: id, dependencies: [], payload };
}
const SQ = (a: number, b: number): Array<{ x: number; y: number }> => [
  { x: a, y: a },
  { x: b, y: a },
  { x: b, y: b },
  { x: a, y: b },
];

describe("nodeOcctBridge (real OCCT)", () => {
  it("buildFromExtrude makes a real solid with the right volume", async () => {
    if (!okLoad) return;
    const r = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    expect(r.ok).toBe(true);
    expect(r.shape?.kind).toBe("solid");
    expect(r.shape?.volume).toBeCloseTo(500, 1); // 10×10×5
    // bbox carries OCCT's small gap tolerance → compare approximately.
    expect(r.shape?.bbox).toBeDefined();
    expect(r.shape!.bbox!.max.x).toBeCloseTo(10, 1);
    expect(r.shape!.bbox!.max.y).toBeCloseTo(10, 1);
    expect(r.shape!.bbox!.max.z).toBeCloseTo(5, 1);
    expect(r.shape!.bbox!.min.x).toBeCloseTo(0, 1);
  });

  it("buildFromRevolve makes a real solid of revolution with the right volume", async () => {
    if (!okLoad) return;
    // Rectangle profile (X≥0, axis = Y) → full 360° revolve about Y = a cylinder
    // of radius 10, height 20. Volume = π·10²·20 ≈ 6283.
    const feature: RevolveFeature = {
      kind: "revolve",
      loop: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
      angleDegrees: 360,
      mode: "add",
    };
    const r = await bridge.buildFromRevolve(feature);
    expect(r.ok).toBe(true);
    expect(r.shape?.kind).toBe("solid");
    expect(r.shape?.volume).toBeCloseTo(Math.PI * 100 * 20, -1); // ≈6283, ±~5
  });

  it("buildFromRevolve at 180° yields half the full-revolve volume", async () => {
    if (!okLoad) return;
    const half: RevolveFeature = {
      kind: "revolve",
      loop: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
      angleDegrees: 180,
      mode: "add",
    };
    const r = await bridge.buildFromRevolve(half);
    expect(r.ok).toBe(true);
    expect(r.shape!.volume).toBeCloseTo((Math.PI * 100 * 20) / 2, -1); // ≈3142
  });

  it("T05/T06: detailed inspection measures an analytic box", async () => {
    if (!okLoad) return;
    const made = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const detail = await bridge.inspectShapeDetailed!(made.shape!);
    expect(detail.valid).toBe(true);
    expect(detail).toMatchObject({
      solidCount: 1,
      faceCount: 6,
      edgeCount: 12,
    });
    expect(detail.shapeTypeCounts).toEqual({
      compound: 0,
      compsolid: 0,
      solid: 1,
      shell: 1,
    });
    expect(detail.productOccurrences).toEqual({
      status: "not_run",
      reason: expect.stringContaining("topology counts are not substituted"),
    });
    expect(detail.absoluteVolume).toBeCloseTo(500, 6);
    expect(detail.surfaceArea).toBeCloseTo(400, 6);
    expect(detail.centroid.x).toBeCloseTo(5, 8);
    expect(detail.centroid.y).toBeCloseTo(5, 8);
    expect(detail.centroid.z).toBeCloseTo(2.5, 8);
    expect(detail.bbox.min.x).toBeCloseTo(0, 5);
    expect(detail.bbox.max.z).toBeCloseTo(5, 5);
    expect(detail.inertia.status).toBe("available");
    if (detail.inertia.status === "available") {
      expect(detail.inertia.matrix[0][0]).toBeCloseTo(
        (500 * (10 ** 2 + 5 ** 2)) / 12,
        5,
      );
      expect(detail.inertia.matrix[1][1]).toBeCloseTo(
        (500 * (10 ** 2 + 5 ** 2)) / 12,
        5,
      );
      expect(detail.inertia.matrix[2][2]).toBeCloseTo(
        (500 * (10 ** 2 + 10 ** 2)) / 12,
        5,
      );
    }
    expect(detail.surfaceTypes).toEqual({
      status: "available",
      counts: { plane: 6 },
    });
    expect(detail.curveTypes).toEqual({
      status: "available",
      counts: { line: 12 },
    });
    expect(detail.faceAdjacency).toEqual({
      status: "available",
      faceCount: 6,
      uniqueEdgeCount: 12,
      degeneratedEdgeCount: 0,
      boundaryEdgeCount: 0,
      manifoldEdgeCount: 12,
      nonManifoldEdgeCount: 0,
      faceDegreeHistogram: { "4": 6 },
    });
  });

  it("T05/T06: detailed inspection measures an analytic cylinder", async () => {
    if (!okLoad) return;
    const made = await bridge.buildFromRevolve({
      kind: "revolve",
      loop: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
      angleDegrees: 360,
      mode: "add",
    });
    const detail = await bridge.inspectShapeDetailed!(made.shape!);
    expect(detail.valid).toBe(true);
    expect(detail.absoluteVolume).toBeCloseTo(Math.PI * 10 ** 2 * 20, 5);
    expect(detail.surfaceArea).toBeCloseTo(
      2 * Math.PI * 10 * 20 + 2 * Math.PI * 10 ** 2,
      5,
    );
    expect(detail.centroid.x).toBeCloseTo(0, 8);
    expect(detail.centroid.y).toBeCloseTo(10, 8);
    expect(detail.centroid.z).toBeCloseTo(0, 8);
    expect(detail.surfaceTypes).toEqual({
      status: "available",
      counts: { cylinder: 1, plane: 2 },
    });
    expect(detail.curveTypes).toEqual({
      status: "available",
      counts: { circle: 2, line: 1 },
    });
    expect(detail.faceAdjacency).toEqual({
      status: "available",
      faceCount: 3,
      uniqueEdgeCount: 3,
      degeneratedEdgeCount: 0,
      boundaryEdgeCount: 0,
      manifoldEdgeCount: 3,
      nonManifoldEdgeCount: 0,
      faceDegreeHistogram: { "1": 2, "2": 1 },
    });
  });

  it("builds native horizontal and oblique cylinders and rejects invalid axis/radius/depth", async () => {
    if (!okLoad || !bridge.buildCylinderAt) return;
    for (const axis of [[1, 0, 0] as const, [0, 1, 0] as const, [Math.SQRT1_2, 0, Math.SQRT1_2] as const]) {
      const made = await bridge.buildCylinderAt([10, 20, 30], axis, 5, 40);
      expect(made.ok).toBe(true);
      expect(made.warnings).toContain('analytic OCCT cylinder built along supplied axis');
      if (!made.ok || !made.shape) continue;
      const detail = await bridge.inspectShapeDetailed!(made.shape);
      expect(detail.valid).toBe(true);
      expect(detail.solidCount).toBe(1);
      expect(detail.absoluteVolume).toBeCloseTo(Math.PI * 5 ** 2 * 40, 2);
      bridge.release(made.shape);
    }
    await expect(bridge.buildCylinderAt([0, 0, 0], [0, 0, 0], 5, 40)).resolves.toMatchObject({ ok: false });
    await expect(bridge.buildCylinderAt([0, 0, 0], [1, 0, 0], 0, 40)).resolves.toMatchObject({ ok: false });
    await expect(bridge.buildCylinderAt([0, 0, 0], [1, 0, 0], 5, 0)).resolves.toMatchObject({ ok: false });
  });

  it("T05/T06: disconnected compound preserves two exact adjacency components", async () => {
    if (!okLoad) return;
    const left = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const right = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(30, 40),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const compound = await bridge.boolean.union(left.shape!, right.shape!);
    const detail = await bridge.inspectShapeDetailed!(compound.shape!);
    expect(detail.shapeTypeCounts).toEqual({
      compound: 1,
      compsolid: 0,
      solid: 2,
      shell: 2,
    });
    expect(detail.faceAdjacency).toEqual({
      status: "available",
      faceCount: 12,
      uniqueEdgeCount: 24,
      degeneratedEdgeCount: 0,
      boundaryEdgeCount: 0,
      manifoldEdgeCount: 24,
      nonManifoldEdgeCount: 0,
      faceDegreeHistogram: { "4": 12 },
    });
  });

  it("T05/T06: analytic type histograms survive a STEP round trip", async () => {
    if (!okLoad) return;
    const made = await bridge.buildFromRevolve({
      kind: "revolve",
      loop: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
      angleDegrees: 360,
      mode: "add",
    });
    const step = await bridge.exportSTEP(made.shape!);
    const imported = await bridge.importSTEP(step);
    const detail = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(detail.surfaceTypes).toEqual({
      status: "available",
      counts: { cylinder: 1, plane: 2 },
    });
    expect(detail.curveTypes).toEqual({
      status: "available",
      counts: { circle: 2, line: 1 },
    });
    expect(detail.faceAdjacency).toEqual({
      status: "available",
      faceCount: 3,
      uniqueEdgeCount: 3,
      degeneratedEdgeCount: 0,
      boundaryEdgeCount: 0,
      manifoldEdgeCount: 3,
      nonManifoldEdgeCount: 0,
      faceDegreeHistogram: { "1": 2, "2": 1 },
    });
    bridge.release(imported.shape!);
    bridge.release(made.shape!);
  });

  it.runIf(Boolean(process.env.NEXYFAB_CAD_CORPUS_ROOT))(
    "T05/T06: imported A04 torus and B04 spline fixture types are kernel-classified",
    async () => {
      if (!okLoad) return;
      const root = process.env.NEXYFAB_CAD_CORPUS_ROOT!;
      const inspectFixture = async (fixtureId: "A04" | "B04") => {
        const fixture = CAD_CORPUS_MANIFEST_V2.fixtures.find(
          (item) => item.fixtureId === fixtureId,
        )!;
        const resolved = await resolveCadCorpusFixtureV2(root, fixture);
        const imported = await bridge.importSTEP(
          await readFile(join(root, resolved.relativePath), "utf8"),
        );
        expect(imported.ok, imported.error).toBe(true);
        const detail = await bridge.inspectShapeDetailed!(imported.shape!);
        bridge.release(imported.shape!);
        return detail;
      };
      const torus = await inspectFixture("A04");
      expect(torus.surfaceTypes).toMatchObject({ status: "available" });
      if (torus.surfaceTypes.status === "available")
        expect(torus.surfaceTypes.counts.torus).toBeGreaterThan(0);
      const spline = await inspectFixture("B04");
      expect(spline.surfaceTypes).toMatchObject({ status: "available" });
      if (spline.surfaceTypes.status === "available")
        expect(spline.surfaceTypes.counts.bsplinesurface).toBeGreaterThan(0);
    },
    120_000,
  );

  it("W3 wiring: name-based fillet works on a revolve (e.lat.* → real OCCT edge)", async () => {
    if (!okLoad) return;
    // Cylinder R=10, H=20. Off-axis vertex i=2 is (10,20) → e.lat.2 = top rim circle.
    const r = await bridge.buildFromRevolve({
      kind: "revolve",
      loop: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
      angleDegrees: 360,
      mode: "add",
    });
    expect(r.ok).toBe(true);
    const f = await bridge.fillet(r.shape!, ["e.lat.2"], 1);
    expect(f.ok).toBe(true);
    // Pappus: removed area (1−π/4)·r², centroid at R − (1 − 1/(6(1−π/4)))·r ≈ 9.7766
    // → V = 2000π − 0.214602·2π·9.77662 ≈ 6283.19 − 13.18 = 6270.00.
    expect(f.shape?.volume).toBeCloseTo(6270.0, 0);
  });

  it("real boolean subtract removes the tool volume", async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const tool = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(3, 7),
      depth: 7,
      direction: "one_sided",
      mode: "add",
    });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!);
    expect(cut.ok).toBe(true);
    expect(cut.shape?.volume).toBeCloseTo(420, 1); // 500 − 4×4×5
  });

  it("END-TO-END: feature tree → plan → executeOcctPlan → real holed solid", async () => {
    if (!okLoad) return;
    const tree: FeatureTree = {
      nodes: [
        extrudeNode("base", SQ(0, 10), 5),
        extrudeNode("tool", SQ(3, 7), 7),
        {
          id: "cut",
          name: "cut",
          dependencies: ["base", "tool"],
          payload: {
            kind: "boolean",
            op: "difference",
            bodies: ["base", "tool"],
          },
        },
      ],
    };
    const plan = featureTreeToOcctPlan(tree);
    const r = await executeOcctPlan(plan, bridge);
    expect(r.ok).toBe(true);
    expect(r.finalShape?.volume).toBeCloseTo(420, 1);
  });

  it("K3: fillet rounds the named vertical edges (stable name → real OCCT edge)", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    // The 4 vertical corner edges by their stable topoNaming names.
    const f = await bridge.fillet(
      box.shape!,
      ["e.vert.0", "e.vert.1", "e.vert.2", "e.vert.3"],
      1,
    );
    expect(f.ok).toBe(true);
    // 500 − 4 corners each losing (1 − π/4)·r²·h = (1−0.7854)·1·5 ≈ 1.073 → ≈ 495.71
    expect(f.shape?.volume).toBeCloseTo(495.71, 1);
  });

  it("K9: exact top-face selection creates a real open solid shell", async () => {
    if (!okLoad) return;
    const base = extrudeNode("shell-base", SQ(0, 10), 5);
    const tree: FeatureTree = {
      nodes: [
        base,
        {
          id: "shell1",
          name: "open top shell",
          dependencies: ["shell-base"],
          payload: {
            kind: "shell",
            childId: "shell-base",
            childExtrude: base.payload as ExtrudeFeature,
            thickness: 1,
            openTopFace: true,
          },
        },
      ],
    };
    const shellRun = await executeOcctPlan(featureTreeToOcctPlan(tree), bridge);
    expect(shellRun.ok, shellRun.error).toBe(true);
    expect(shellRun.finalShape?.kind).toBe("solid");
    expect(shellRun.finalShape?.volume).toBeCloseTo(244, 0);
    expect(shellRun.warnings.join(" ")).toMatch(/f\.cap\.top/);
  });

  it("K7: variableFillet applies a different radius per named edge", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const r = await bridge.variableFillet!(box.shape!, [
      { edgeId: "e.vert.0", radius: 1 },
      { edgeId: "e.vert.1", radius: 1.5 },
      { edgeId: "e.vert.2", radius: 0.5 },
      { edgeId: "e.vert.3", radius: 2 },
    ]);
    expect(r.ok).toBe(true);
    // mixed radii (incl. larger than 1) remove more than the uniform-1mm 495.71
    expect(r.shape!.volume).toBeLessThan(495.71);
    expect(r.shape!.volume).toBeGreaterThan(485);
  });

  it("K7: variableFillet rejects a non-positive radius and unknown edges", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const bad = await bridge.variableFillet!(box.shape!, [
      { edgeId: "e.vert.0", radius: 0 },
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/positive finite/);
    const unknown = await bridge.variableFillet!(box.shape!, [
      { edgeId: "e.nope", radius: 1 },
    ]);
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/unresolved|unknown/);
  });

  it("K7: draft tapers the side walls of a box (volume shrinks)", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const r = await bridge.draft!(box.shape!, { angleDeg: 5 }); // pull +Z, neutral z=0
    expect(r.ok).toBe(true);
    // 5° inward taper on all 4 walls removes material: 500 → ~457
    expect(r.shape!.volume).toBeLessThan(500);
    expect(r.shape!.volume).toBeGreaterThan(440);
  });

  it("K7: draft rejects an out-of-range angle", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const r = await bridge.draft!(box.shape!, { angleDeg: 120 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\(0, 90\)/);
  });

  it("K7: uniform scale is native analytic B-Rep and survives STEP roundtrip", async () => {
    if (!okLoad || !bridge.uniformScale) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    expect(box.ok).toBe(true);
    const before = await bridge.inspectShapeDetailed!(box.shape!);
    const scaled = await bridge.uniformScale(box.shape!, 2);
    expect(scaled.ok).toBe(true);
    const after = await bridge.inspectShapeDetailed!(scaled.shape!);
    expect(after.valid).toBe(true);
    expect(after.solidCount).toBe(1);
    expect(after.absoluteVolume).toBeCloseTo(before.absoluteVolume * 8, 5);
    expect(after.bbox.min.x).toBeCloseTo(before.bbox.min.x * 2, 5);
    expect(after.bbox.max.x).toBeCloseTo(before.bbox.max.x * 2, 5);
    expect(after.bbox.max.z).toBeCloseTo(before.bbox.max.z * 2, 5);
    const step = await bridge.exportSTEP!(scaled.shape!);
    expect(step).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION");
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip.absoluteVolume).toBeCloseTo(after.absoluteVolume, 5);
    expect(roundtrip.bbox.max.z).toBeCloseTo(after.bbox.max.z, 5);
  });

  it("K7: translated move-copy preserves analytic B-Rep and survives STEP roundtrip", async () => {
    if (!okLoad || !bridge.translate) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const before = await bridge.inspectShapeDetailed!(box.shape!);
    const moved = await bridge.translate(box.shape!, [25, -7, 11]);
    expect(moved.ok).toBe(true);
    const after = await bridge.inspectShapeDetailed!(moved.shape!);
    expect(after.valid).toBe(true);
    expect(after.solidCount).toBe(before.solidCount);
    expect(after.faceCount).toBe(before.faceCount);
    expect(after.edgeCount).toBe(before.edgeCount);
    expect(after.absoluteVolume).toBeCloseTo(before.absoluteVolume, 6);
    expect(after.bbox.min.x).toBeCloseTo(before.bbox.min.x + 25, 5);
    expect(after.bbox.min.y).toBeCloseTo(before.bbox.min.y - 7, 5);
    expect(after.bbox.min.z).toBeCloseTo(before.bbox.min.z + 11, 5);
    const step = await bridge.exportSTEP!(moved.shape!);
    expect(step).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION");
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip.absoluteVolume).toBeCloseTo(after.absoluteVolume, 6);
    expect(roundtrip.bbox.min.x).toBeCloseTo(after.bbox.min.x, 5);
  });

  it("K7: native Z-axis rotation preserves volume/topology and survives STEP roundtrip", async () => {
    if (!okLoad || !bridge.rotate) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude", loop: SQ(0, 10), depth: 5, direction: "one_sided", mode: "add",
    });
    expect(box.ok).toBe(true);
    const before = await bridge.inspectShapeDetailed!(box.shape!);
    const rotated = await bridge.rotate(box.shape!, [0, 0, 0], [0, 0, 1], 90);
    expect(rotated.ok).toBe(true);
    const after = await bridge.inspectShapeDetailed!(rotated.shape!);
    expect(after.valid).toBe(true);
    expect(after.solidCount).toBe(before.solidCount);
    expect(after.faceCount).toBe(before.faceCount);
    expect(after.edgeCount).toBe(before.edgeCount);
    expect(after.absoluteVolume).toBeCloseTo(before.absoluteVolume, 6);
    expect(after.bbox.min.x).toBeCloseTo(-10, 5);
    expect(after.bbox.max.x).toBeCloseTo(0, 5);
    expect(after.bbox.min.y).toBeCloseTo(0, 5);
    expect(after.bbox.max.y).toBeCloseTo(10, 5);
    expect(after.bbox.min.z).toBeCloseTo(before.bbox.min.z, 5);
    expect(after.bbox.max.z).toBeCloseTo(before.bbox.max.z, 5);
    const step = await bridge.exportSTEP!(rotated.shape!);
    expect(step).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION");
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip.solidCount).toBe(1);
    expect(roundtrip.absoluteVolume).toBeCloseTo(after.absoluteVolume, 6);
    expect(roundtrip.bbox.min.x).toBeCloseTo(after.bbox.min.x, 5);
    await expect(bridge.rotate(box.shape!, [0, 0, 0], [0, 0, 0], 90)).resolves.toMatchObject({ ok: false });
    await expect(bridge.rotate(box.shape!, [0, 0, 0], [0, 0, 1], 0)).resolves.toMatchObject({ ok: false });
    await expect(bridge.rotate(box.shape!, [0, 0, 0], [0, 0, 1], 361)).resolves.toMatchObject({ ok: false });
    await expect(bridge.rotate(box.shape!, [1_000_001, 0, 0], [0, 0, 1], 90)).resolves.toMatchObject({ ok: false });
  });

  it("K8: native convex-section loft is one closed solid and survives STEP roundtrip", async () => {
    if (!okLoad || !bridge.buildLoftSections) return;
    const loft = await bridge.buildLoftSections([
      { z: 0, loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }] },
      { z: 5, loop: [{ x: 2, y: 1 }, { x: 14, y: 1 }, { x: 14, y: 11 }, { x: 2, y: 11 }] },
      { z: 10, loop: [{ x: 4, y: 2 }, { x: 12, y: 2 }, { x: 12, y: 9 }, { x: 4, y: 9 }] },
    ]);
    expect(loft.ok, loft.error).toBe(true);
    expect(loft.shape?.kind).toBe("solid");
    const detail = await bridge.inspectShapeDetailed!(loft.shape!);
    expect(detail.valid).toBe(true);
    expect(detail.solidCount).toBe(1);
    expect(detail.absoluteVolume).toBeGreaterThan(0);
    expect(detail.bbox.min.x).toBeCloseTo(0, 5);
    expect(detail.bbox.max.x).toBeCloseTo(14, 5);
    expect(detail.bbox.min.y).toBeCloseTo(0, 5);
    expect(detail.bbox.max.y).toBeCloseTo(11, 5);
    expect(detail.bbox.min.z).toBeCloseTo(0, 5);
    expect(detail.bbox.max.z).toBeCloseTo(10, 5);
    expect(detail.faceAdjacency.status).toBe("available");
    if (detail.faceAdjacency.status === "available") {
      expect(detail.faceAdjacency.boundaryEdgeCount).toBe(0);
      expect(detail.faceAdjacency.nonManifoldEdgeCount).toBe(0);
    }
    const step = await bridge.exportSTEP!(loft.shape!);
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip.solidCount).toBe(1);
    expect(roundtrip.absoluteVolume).toBeCloseTo(detail.absoluteVolume, 5);
    expect(roundtrip.bbox.min.x).toBeCloseTo(detail.bbox.min.x, 5);
    expect(roundtrip.bbox.max.z).toBeCloseTo(detail.bbox.max.z, 5);
  });

  it("K8: loft rejects unsafe or incompatible sections", async () => {
    if (!okLoad || !bridge.buildLoftSections) return;
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const valid = (sections: Parameters<NonNullable<OcctBridge["buildLoftSections"]>>[0]) => bridge.buildLoftSections!(sections);
    await expect(valid([{ z: 0, loop: square }, { z: 0, loop: square }])).resolves.toMatchObject({ ok: false });
    await expect(valid([{ z: 0, loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 10 }] }, { z: 1, loop: square }])).resolves.toMatchObject({ ok: false });
    await expect(valid([{ z: 0, loop: square }, { z: 1, loop: [...square, { x: 3, y: 3 }] }])).resolves.toMatchObject({ ok: false });
    await expect(valid([{ z: 0, loop: square }, { z: 1, loop: [...square].reverse() }])).resolves.toMatchObject({ ok: false });
    await expect(valid([{ z: 0, loop: Array.from({ length: 33 }, (_, i) => ({ x: Math.cos(i), y: Math.sin(i) })) }, { z: 1, loop: Array.from({ length: 33 }, (_, i) => ({ x: Math.cos(i), y: Math.sin(i) })) }])).resolves.toMatchObject({ ok: false });
    await expect(valid([{ z: Number.NaN, loop: square }, { z: 1, loop: square }])).resolves.toMatchObject({ ok: false });
  });

  it("K7: plane mirror is native analytic B-Rep and survives STEP roundtrip", async () => {
    if (!okLoad || !bridge.mirror) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const before = await bridge.inspectShapeDetailed!(box.shape!);
    const mirrored = await bridge.mirror(box.shape!, [20, 0, 0], [4, 0, 0]);
    expect(mirrored.ok).toBe(true);
    const after = await bridge.inspectShapeDetailed!(mirrored.shape!);
    expect(after.valid).toBe(true);
    expect(after.solidCount).toBe(before.solidCount);
    expect(after.faceCount).toBe(before.faceCount);
    expect(after.edgeCount).toBe(before.edgeCount);
    expect(after.absoluteVolume).toBeCloseTo(before.absoluteVolume, 6);
    expect(after.bbox.min.x).toBeCloseTo(30, 5);
    expect(after.bbox.max.x).toBeCloseTo(40, 5);
    expect(after.bbox.min.y).toBeCloseTo(before.bbox.min.y, 5);
    expect(after.bbox.max.z).toBeCloseTo(before.bbox.max.z, 5);
    const step = await bridge.exportSTEP!(mirrored.shape!);
    expect(step).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION");
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip.absoluteVolume).toBeCloseTo(after.absoluteVolume, 6);
    expect(roundtrip.bbox.min.x).toBeCloseTo(after.bbox.min.x, 5);
    await expect(bridge.mirror(box.shape!, [0, 0, 0], [0, 0, 0])).resolves.toMatchObject({ ok: false });
  });

  it("K3: fillet sel:all rounds every edge", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const f = await bridge.fillet(box.shape!, ["sel:all"], 1);
    expect(f.ok).toBe(true);
    expect(f.shape!.volume).toBeLessThan(500); // material removed
    expect(f.shape!.volume).toBeGreaterThan(470);
  });

  it("K3: chamfer the named vertical edges", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const c = await bridge.chamfer(
      box.shape!,
      ["e.vert.0", "e.vert.1", "e.vert.2", "e.vert.3"],
      1,
    );
    expect(c.ok).toBe(true);
    // 45° chamfer dist 1 removes a triangular prism per corner: 0.5·1·1·5 = 2.5 → 500 − 4·2.5 = 490
    expect(c.shape?.volume).toBeCloseTo(490, 0);
  });

  it("preserves untouched edge names across fillet for a following chamfer", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude", loop: SQ(0, 12), depth: 6, direction: "one_sided", mode: "add",
    });
    expect(box.ok).toBe(true);
    const fillet = await bridge.fillet(box.shape!, ["e.vert.0", "e.vert.1"], 1);
    expect(fillet.ok).toBe(true);
    const chamfer = await bridge.chamfer(fillet.shape!, ["e.vert.2", "e.vert.3"], 1);
    expect(chamfer.ok, chamfer.error).toBe(true);
    expect(chamfer.shape?.volume).toBeGreaterThan(0);
  });

  it("K2.2: name-based fillet works on a composed (boolean) shape", async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const tool = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(3, 7),
      depth: 7,
      direction: "one_sided",
      mode: "add",
    });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!); // 420, with a 4×4 through-pocket
    // The base's outer vertical edges survived the cut → inherited as a/e.vert.*.
    const f = await bridge.fillet(cut.shape!, ["a/e.vert.0"], 1);
    expect(f.ok).toBe(true);
    expect(f.shape!.volume).toBeLessThan(420); // one corner rounded
    expect(f.shape!.volume).toBeGreaterThan(415);
  });

  it("W1-B/W3-A: boolean with ids names edges by FEATURE and seams by KERNEL HISTORY", async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const tool = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(3, 7),
      depth: 7,
      direction: "two_sided",
      mode: "cut",
    });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!, {
      baseId: "base",
      toolId: "hole",
      opId: "cut",
    });
    expect(cut.ok).toBe(true);
    // Inherited edge: feature-scoped, not positional.
    const f = await bridge.fillet(cut.shape!, ["base/e.vert.0"], 1);
    expect(f.ok).toBe(true);
    // Seam edge: named by the pair of operand faces the kernel says generated
    // it (Generated() history) — top rim segment over the hole's side.0 wall.
    const s = await bridge.fillet(
      cut.shape!,
      ["cut/seam(base/f.cap.top∩hole/f.side.0)"],
      0.5,
    );
    expect(s.ok).toBe(true);
    expect(s.shape!.volume).toBeLessThan(cut.shape!.volume!);
  });

  it("W3-A: the SAME seam name survives an upstream dimension change", async () => {
    if (!okLoad) return;
    // Rebuild with different base + tool depths: the kernel re-orders edges and
    // every midpoint moves, but the history-derived name is unchanged.
    const base = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 14),
      depth: 9,
      direction: "one_sided",
      mode: "add",
    });
    const tool = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(3, 7),
      depth: 11,
      direction: "two_sided",
      mode: "cut",
    });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!, {
      baseId: "base",
      toolId: "hole",
      opId: "cut",
    });
    expect(cut.ok).toBe(true);
    const s = await bridge.fillet(
      cut.shape!,
      ["cut/seam(base/f.cap.top∩hole/f.side.0)"],
      0.5,
    );
    expect(s.ok).toBe(true);
  });

  it("W3-A: a stale positional seam name is an explicit loss, not a guess", async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const tool = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(3, 7),
      depth: 7,
      direction: "two_sided",
      mode: "cut",
    });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!, {
      baseId: "base",
      toolId: "hole",
      opId: "cut",
    });
    const f = await bridge.fillet(cut.shape!, ["cut/seam.0"], 0.5); // pre-W3-A ordinal
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/unresolved/);
  });

  it("preserves surviving native face references after fillet and chamfer", async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 20),
      depth: 10,
      direction: "one_sided",
      mode: "add",
    });
    const fillet = await bridge.fillet(base.shape!, ["e.vert.0"], 1);
    const chamfer = await bridge.chamfer(base.shape!, ["e.vert.0"], 1);
    expect(fillet.ok).toBe(true);
    expect(chamfer.ok).toBe(true);
    expect(await bridge.listFaceRefs!(fillet.shape!)).toEqual(
      expect.arrayContaining(["f.cap.top", "f.cap.bottom"]),
    );
    expect(await bridge.listFaceRefs!(chamfer.shape!)).toEqual(
      expect.arrayContaining(["f.cap.top", "f.cap.bottom"]),
    );
  });

  it("K2.2: an unknown name on a composed shape still errors clearly", async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const tool = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(3, 7),
      depth: 7,
      direction: "one_sided",
      mode: "add",
    });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!);
    const f = await bridge.fillet(cut.shape!, ["e.vert.0"], 1); // un-prefixed → not a composed name
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/unresolved|unknown/);
  });

  it("K4: exportSTEP emits an ISO-10303-21 part", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const step = await bridge.exportSTEP(box.shape!);
    expect(step.startsWith("ISO-10303-21")).toBe(true);
    expect(step).toMatch(
      /MANIFOLD_SOLID_BREP|ADVANCED_BREP_SHAPE_REPRESENTATION|CLOSED_SHELL/,
    );
    expect(step).toContain("END-ISO-10303-21");
  });

  it("K4: STEP round-trips a real solid with volume preserved", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const step = await bridge.exportSTEP(box.shape!);
    const back = await bridge.importSTEP(step);
    expect(back.ok).toBe(true);
    expect(back.shape?.kind).toBe("solid");
    expect(back.shape?.volume).toBeCloseTo(500, 1);
  });

  it("K4: a holed solid survives the STEP round trip", async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const tool = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(3, 7),
      depth: 7,
      direction: "one_sided",
      mode: "add",
    });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!);
    const step = await bridge.exportSTEP(cut.shape!);
    const back = await bridge.importSTEP(step);
    expect(back.ok).toBe(true);
    expect(back.shape?.volume).toBeCloseTo(420, 1);
  });

  it("K4: importSTEP rejects garbage cleanly", async () => {
    if (!okLoad) return;
    const back = await bridge.importSTEP("not a step file at all");
    expect(back.ok).toBe(false);
    expect(back.error).toMatch(/importSTEP/);
  });

  it("K10: imported STEP planar face supports exact kernel push/pull", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const step = await bridge.exportSTEP(box.shape!);
    const imported = await bridge.importSTEP(step);
    expect(imported.ok).toBe(true);
    const refs = await bridge.listFaceRefs!(imported.shape!);
    expect(refs).toEqual([
      "f.import.0",
      "f.import.1",
      "f.import.2",
      "f.import.3",
      "f.import.4",
      "f.import.5",
    ]);
    const pushed = await bridge.pushPullFace!(imported.shape!, "f.import.5", 2);
    expect(pushed.ok, pushed.error).toBe(true);
    expect(pushed.shape?.volume).toBeCloseTo(600, 1);
    expect((await bridge.inspectShape!(pushed.shape!)).valid).toBe(true);
    const pulled = await bridge.pushPullFace!(
      imported.shape!,
      "f.import.5",
      -1,
    );
    expect(pulled.ok, pulled.error).toBe(true);
    expect(pulled.shape?.volume).toBeCloseTo(450, 1);
  }, 60_000);

  it("K5/K6: tessellate yields viewer buffers for a real solid", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const res = await bridge.tessellate(box.shape!);
    expect(res.ok).toBe(true);
    expect(res.mesh!.triangleCount).toBe(12);
    expect(res.mesh!.edgeCount).toBe(12);
    expect(res.mesh!.bounds.center[2]).toBeCloseTo(2.5, 6);
  });

  it("K5/K6: tessellate works on an imported STEP shape (no provenance)", async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 10),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const step = await bridge.exportSTEP(box.shape!);
    const back = await bridge.importSTEP(step);
    const res = await bridge.tessellate(back.shape!);
    expect(res.ok).toBe(true);
    expect(res.mesh!.triangleCount).toBeGreaterThanOrEqual(12);
  });

  // ── ADR-014 kernel-ceiling ops (promoted from ceilingSpike, 2026-06-08) ──

  it("K8: buildPlanarFace makes a face (surface body), not a solid", async () => {
    if (!okLoad) return;
    const face = await bridge.buildPlanarFace!(SQ(0, 10), 0);
    expect(face.ok).toBe(true);
    expect(face.shape?.kind).toBe("face");
    expect(face.shape?.volume).toBeUndefined(); // a surface has no volume
  });

  it("K8: thicken turns a surface into a solid of the expected volume (replicad cannot)", async () => {
    if (!okLoad) return;
    const face = await bridge.buildPlanarFace!(SQ(0, 10), 0); // 10×10 sheet
    const solid = await bridge.thicken!(face.shape!, 2);
    expect(solid.ok).toBe(true);
    expect(solid.shape?.kind).toBe("solid");
    expect(solid.shape?.volume).toBeCloseTo(200, 1); // 10×10×2
  });

  it("K8: thicken rejects a non-positive thickness", async () => {
    if (!okLoad) return;
    const face = await bridge.buildPlanarFace!(SQ(0, 10), 0);
    const bad = await bridge.thicken!(face.shape!, 0);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/positive finite/);
  });

  it("K8: surfaceTrim sections two crossing faces into intersection edge(s)", async () => {
    if (!okLoad) return;
    const flat = await bridge.buildPlanarFace!(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      0,
    );
    // A second face crossing the first along y=10 (built directly from a loop in
    // the z direction would need a non-XY plane; reuse a tall thin face via the
    // extrude→cut path is overkill — instead trim against a box that spans it).
    const box = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(5, 15),
      depth: 10,
      direction: "midplane",
      mode: "add",
    });
    const sec = await bridge.surfaceTrim!(flat.shape!, box.shape!);
    expect(sec.ok).toBe(true);
    expect(sec.shape?.kind).toBe("compound");
    expect(sec.warnings.join(" ")).toMatch(/intersection edge/);
  });

  it("K8: surfaceTrim reports no intersection for disjoint shapes", async () => {
    if (!okLoad) return;
    const a = await bridge.buildPlanarFace!(SQ(0, 5), 0);
    const b = await bridge.buildPlanarFace!(SQ(100, 105), 50); // far away
    const sec = await bridge.surfaceTrim!(a.shape!, b.shape!);
    expect(sec.ok).toBe(false);
    expect(sec.error).toMatch(/do not intersect/);
  });

  it("K7: a top-face rectangular rib fuses into one analytic solid and round-trips STEP", async () => {
    if (!okLoad || !bridge.buildPrismAt) return;
    const host = await bridge.buildFromExtrude({
      kind: "extrude",
      loop: SQ(0, 20),
      depth: 5,
      direction: "one_sided",
      mode: "add",
    });
    const rib = await bridge.buildPrismAt([
      { x: 5, y: 11 }, { x: 15, y: 11 }, { x: 15, y: 9 }, { x: 5, y: 9 },
    ], 5, 3);
    expect(rib.ok, rib.error).toBe(true);
    const fused = await bridge.boolean.union(host.shape!, rib.shape!, {
      baseId: "rib-host", toolId: "rib-solid", opId: "rib-test",
    });
    expect(fused.ok, fused.error).toBe(true);
    const inspection = await bridge.inspectShapeDetailed!(fused.shape!);
    expect(inspection.valid).toBe(true);
    expect(inspection.solidCount).toBe(1);
    expect(inspection.absoluteVolume).toBeCloseTo(20 * 20 * 5 + 10 * 2 * 3, 5);
    expect(inspection.bbox.min.z).toBeCloseTo(0, 5);
    expect(inspection.bbox.max.z).toBeCloseTo(8, 5);
    const step = await bridge.exportSTEP!(fused.shape!);
    expect(step).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION");
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok, imported.error).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip.solidCount).toBe(1);
    expect(roundtrip.absoluteVolume).toBeCloseTo(inspection.absoluteVolume, 5);
    expect(roundtrip.bbox.max.z).toBeCloseTo(inspection.bbox.max.z, 5);
  }, 60_000);

  it("K11: exact cylindrical helix sweep cuts a BREP thread and survives STEP export", async () => {
    if (!okLoad) return;
    expect(bridge.buildThreadHelixCutter).toBeTypeOf("function");
    const circle = Array.from({ length: 48 }, (_, i) => {
      const a = 2 * Math.PI * i / 48;
      return { x: 4 * Math.cos(a), y: 4 * Math.sin(a) };
    });
    const rod = await bridge.buildPrismAt!(circle, 0, 4);
    expect(rod.warnings).toContain("analytic circular prism promoted to OCCT cylinder");
    expect(rod.shape?.volume).toBeCloseTo(Math.PI * 4 * 4 * 4, 6);
    const cutter = await bridge.buildThreadHelixCutter!({
      center: { x: 0, y: 0 }, z0: 0.5, innerRadius: 3.3, outerRadius: 4.3,
      pitch: 1.25, lengthMm: 2.5, direction: "right_hand",
    });
    expect(cutter.ok, cutter.error).toBe(true);
    expect(cutter.shape?.kind).toBe("solid");
    expect(cutter.shape?.volume).toBeGreaterThan(0);
    expect(cutter.warnings).toContain("exact OCCT cylindrical helix sweep");
    const threaded = await bridge.boolean.subtract(rod.shape!, cutter.shape!);
    expect(threaded.ok, threaded.error).toBe(true);
    expect(threaded.shape!.volume).toBeLessThan(rod.shape!.volume!);
    const step = await bridge.exportSTEP(threaded.shape!);
    expect(step).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION");
  }, 60_000);

  it("K12: a true orthogonal polyline sweep is a closed solid and survives STEP roundtrip", async () => {
    if (!okLoad) return;
    expect(bridge.buildOrthogonalPolylineSweep).toBeTypeOf("function");
    const swept = await bridge.buildOrthogonalPolylineSweep!({
      path: [[0, 0, 0], [20, 0, 0], [20, 0, 15]],
      widthMm: 2,
      heightMm: 2,
    });
    expect(swept.ok, swept.error).toBe(true);
    expect(swept.shape?.kind).toBe("solid");
    expect(swept.warnings).toContain("exact OCCT non-straight orthogonal polyline sweep");
    const detail = await bridge.inspectShapeDetailed!(swept.shape!);
    expect(detail.valid).toBe(true);
    expect(detail.solidCount).toBe(1);
    expect(detail.absoluteVolume).toBeGreaterThan(0);
    expect(detail.faceAdjacency.status).toBe("available");
    if (detail.faceAdjacency.status === "available") {
      expect(detail.faceAdjacency.boundaryEdgeCount).toBe(0);
      expect(detail.faceAdjacency.nonManifoldEdgeCount).toBe(0);
    }
    expect(detail.bbox.min.x).toBeGreaterThanOrEqual(-1.001);
    expect(detail.bbox.max.x).toBeLessThanOrEqual(21.001);
    expect(detail.bbox.min.z).toBeGreaterThanOrEqual(-1.001);
    expect(detail.bbox.max.z).toBeLessThanOrEqual(16.001);
    const step = await bridge.exportSTEP!(swept.shape!);
    expect(step).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION");
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok, imported.error).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip.solidCount).toBe(1);
    expect(roundtrip.absoluteVolume).toBeCloseTo(detail.absoluteVolume, 6);

    await expect(bridge.buildOrthogonalPolylineSweep!({
      path: [[0, 0, 0], [20, 0, 0], [30, 0, 0]],
      widthMm: 2,
      heightMm: 2,
    })).resolves.toMatchObject({ ok: false });
    await expect(bridge.buildOrthogonalPolylineSweep!({
      path: [[0, 0, 0], [4, 0, 0], [4, 0, 4]],
      widthMm: 4,
      heightMm: 4,
    })).resolves.toMatchObject({ ok: false });
  }, 60_000);

  it("K13: an idealized constant-thickness circular sheet bend is analytic and survives STEP roundtrip", async () => {
    if (!okLoad) return;
    expect(bridge.buildSingleRectangularSheetBend).toBeTypeOf("function");
    const parameters = {
      fixedLengthMm: 20,
      straightLengthMm: 10,
      widthMm: 30,
      thicknessMm: 2,
      innerRadiusMm: 3,
      angleDeg: 90,
    } as const;
    const bent = await bridge.buildSingleRectangularSheetBend!(parameters);
    expect(bent.ok, bent.error).toBe(true);
    expect(bent.shape?.kind).toBe("solid");
    expect(bent.warnings).toContain("exact OCCT idealized constant-thickness circular sheet bend");
    const detail = await bridge.inspectShapeDetailed!(bent.shape!);
    const neutralArcLength = Math.PI / 2 * (parameters.innerRadiusMm + parameters.thicknessMm / 2);
    const expectedVolume = parameters.widthMm * parameters.thicknessMm
      * (parameters.fixedLengthMm + parameters.straightLengthMm + neutralArcLength);
    expect(detail.valid).toBe(true);
    expect(detail.solidCount).toBe(1);
    expect(detail.faceCount).toBe(10);
    expect(detail.edgeCount).toBe(24);
    expect(detail.absoluteVolume).toBeCloseTo(expectedVolume, 5);
    expect(detail.bbox.min.x).toBeCloseTo(-20, 6);
    expect(detail.bbox.min.y).toBeCloseTo(0, 6);
    expect(detail.bbox.min.z).toBeCloseTo(0, 6);
    expect(detail.bbox.max.x).toBeCloseTo(5, 6);
    expect(detail.bbox.max.y).toBeCloseTo(15, 6);
    expect(detail.bbox.max.z).toBeCloseTo(30, 6);
    expect(detail.surfaceTypes).toEqual({ status: "available", counts: { cylinder: 2, plane: 8 } });
    expect(detail.cylindricalRadii).toHaveLength(2);
    expect(detail.cylindricalRadii?.[0]).toBeCloseTo(3, 9);
    expect(detail.cylindricalRadii?.[1]).toBeCloseTo(5, 9);
    expect(detail.faceAdjacency.status).toBe("available");
    if (detail.faceAdjacency.status === "available") {
      expect(detail.faceAdjacency.boundaryEdgeCount).toBe(0);
      expect(detail.faceAdjacency.nonManifoldEdgeCount).toBe(0);
    }
    const step = await bridge.exportSTEP(bent.shape!);
    expect(step).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION");
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok, imported.error).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip.solidCount).toBe(1);
    expect(roundtrip.absoluteVolume).toBeCloseTo(detail.absoluteVolume, 6);
    expect(roundtrip.surfaceTypes).toEqual(detail.surfaceTypes);
    expect(roundtrip.cylindricalRadii).toHaveLength(2);
    expect(roundtrip.cylindricalRadii?.[0]).toBeCloseTo(3, 9);
    expect(roundtrip.cylindricalRadii?.[1]).toBeCloseTo(5, 9);

    await expect(bridge.buildSingleRectangularSheetBend!({ ...parameters, straightLengthMm: 0 }))
      .resolves.toMatchObject({ ok: false });
    await expect(bridge.buildSingleRectangularSheetBend!({ ...parameters, angleDeg: 181 }))
      .resolves.toMatchObject({ ok: false });
  }, 60_000);

  it("K14: bounded blind-hole faces are actually removed, capped, solidified, and round-tripped", async () => {
    if (!okLoad) return;
    expect(bridge.deleteBlindHoleFacesAndCap).toBeTypeOf("function");
    const hostLoop = [
      { x: 0, y: 0 }, { x: 40, y: 0 },
      { x: 40, y: 30 }, { x: 0, y: 30 },
    ] as const;
    const host = await bridge.buildFromExtrude({
      kind: "extrude", loop: hostLoop.map(point => ({ ...point })), depth: 10,
      direction: "one_sided", mode: "add",
    });
    const cutter = await bridge.buildCylinderAt!([20, 15, 4], [0, 0, 1], 3, 6);
    expect(cutter.ok, cutter.error).toBe(true);
    const holed = await bridge.boolean.subtract(host.shape!, cutter.shape!, {
      baseId: "delete-face-host", toolId: "delete-face-hole", opId: "delete-face-cut",
    });
    expect(holed.ok, holed.error).toBe(true);
    const before = await bridge.inspectShapeDetailed!(holed.shape!);
    expect(before.valid).toBe(true);
    expect(before).toMatchObject({ solidCount: 1, faceCount: 8 });
    expect(before.surfaceTypes).toEqual({ status: "available", counts: { cylinder: 1, plane: 7 } });
    expect(before.absoluteVolume).toBeCloseTo(40 * 30 * 10 - Math.PI * 3 * 3 * 6, 5);

    const repaired = await bridge.deleteBlindHoleFacesAndCap!(holed.shape!, {
      hostLoop,
      hostDepthMm: 10,
      holeCenter: [20, 15],
      holeRadiusMm: 3,
      holeDepthMm: 6,
    });
    expect(repaired.ok, repaired.error).toBe(true);
    expect(repaired.warnings).toContain(
      "exact OCCT blind-hole face removal, topology-preserving planar cap, and solidification",
    );
    const after = await bridge.inspectShapeDetailed!(repaired.shape!);
    expect(after.valid).toBe(true);
    expect(after).toMatchObject({ solidCount: 1, faceCount: 6, edgeCount: 12 });
    expect(after.absoluteVolume).toBeCloseTo(40 * 30 * 10, 5);
    expect(after.surfaceTypes).toEqual({ status: "available", counts: { plane: 6 } });
    expect(after.cylindricalRadii).toEqual([]);
    expect(after.faceAdjacency.status).toBe("available");
    if (after.faceAdjacency.status === "available") {
      expect(after.faceAdjacency.boundaryEdgeCount).toBe(0);
      expect(after.faceAdjacency.nonManifoldEdgeCount).toBe(0);
    }

    const step = await bridge.exportSTEP(repaired.shape!);
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok, imported.error).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip).toMatchObject({ solidCount: 1, faceCount: 6, edgeCount: 12 });
    expect(roundtrip.absoluteVolume).toBeCloseTo(after.absoluteVolume, 6);
    expect(roundtrip.surfaceTypes).toEqual({ status: "available", counts: { plane: 6 } });

    await expect(bridge.deleteBlindHoleFacesAndCap!(holed.shape!, {
      hostLoop, hostDepthMm: 11, holeCenter: [20, 15], holeRadiusMm: 3, holeDepthMm: 6,
    })).resolves.toMatchObject({ ok: false });
    await expect(bridge.deleteBlindHoleFacesAndCap!(holed.shape!, {
      hostLoop, hostDepthMm: 10, holeCenter: [3, 15], holeRadiusMm: 3, holeDepthMm: 6,
    })).resolves.toMatchObject({ ok: false });
    await expect(bridge.deleteBlindHoleFacesAndCap!(holed.shape!, {
      hostLoop, hostDepthMm: 10, holeCenter: [20, 15], holeRadiusMm: 4, holeDepthMm: 6,
    })).resolves.toMatchObject({ ok: false });
  }, 60_000);

  it("K15: a native compound preserves two unfused structural members through STEP", async () => {
    if (!okLoad) return;
    expect(bridge.makeCompound).toBeTypeOf("function");
    const primary = await bridge.buildPrismAt!([
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 4 }, { x: 0, y: 4 },
    ], 0, 6);
    const branch = await bridge.buildPrismAt!([
      { x: 40, y: 0 }, { x: 45, y: 0 }, { x: 45, y: 30 }, { x: 40, y: 30 },
    ], 0, 7);
    expect(primary.ok, primary.error).toBe(true);
    expect(branch.ok, branch.error).toBe(true);
    const compound = await bridge.makeCompound!([primary.shape!, branch.shape!]);
    expect(compound.ok, compound.error).toBe(true);
    expect(compound.shape?.kind).toBe("compound");
    expect(compound.warnings).toContain("exact OCCT multi-solid compound; member solids were not fused");
    const detail = await bridge.inspectShapeDetailed!(compound.shape!);
    expect(detail.valid).toBe(true);
    expect(detail).toMatchObject({ solidCount: 2, faceCount: 12, edgeCount: 24 });
    expect(detail.shapeTypeCounts).toMatchObject({ compound: 1, solid: 2, shell: 2 });
    expect(detail.absoluteVolume).toBeCloseTo(40 * 4 * 6 + 5 * 30 * 7, 6);
    expect(detail.surfaceTypes).toEqual({ status: "available", counts: { plane: 12 } });

    const step = await bridge.exportSTEP(compound.shape!);
    const imported = await bridge.importSTEP!(step);
    expect(imported.ok, imported.error).toBe(true);
    const roundtrip = await bridge.inspectShapeDetailed!(imported.shape!);
    expect(roundtrip.valid).toBe(true);
    expect(roundtrip.solidCount).toBe(2);
    expect(roundtrip.absoluteVolume).toBeCloseTo(detail.absoluteVolume, 6);
    await expect(bridge.makeCompound!([primary.shape!, primary.shape!]))
      .resolves.toMatchObject({ ok: false });
  }, 60_000);
});
