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
      boundaryEdgeCount: 0,
      manifoldEdgeCount: 3,
      nonManifoldEdgeCount: 0,
      faceDegreeHistogram: { "1": 2, "2": 1 },
    });
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
});
