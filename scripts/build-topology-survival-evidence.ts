import fs from "node:fs";
import path from "node:path";
import { buildExtrudeTopo, buildRevolveTopo } from "../src/lib/cad/topoNaming";
import type { ExtrudeFeature } from "../src/lib/cad/extrudeProfile";
import type { RevolveFeature } from "../src/lib/cad/revolveProfile";
import {
  booleanEdgeTopologySnapshots,
  namedTopologySnapshots,
  revolveTopologySnapshots,
} from "../src/lib/cad/namedTopologyReferenceReconcile";
import {
  composeBooleanTopo,
  fromAnchors,
  type BooleanInput,
} from "../src/lib/cad/composedTopo";
import { evaluateTopologySurvival } from "../src/lib/cad/topologySurvivalEvidence";
import type { TopologyEntitySnapshot } from "../src/lib/cad/topologyRemap";
import { holeTopologySnapshots } from "../src/lib/cad/holeTopologySnapshots";
import { loadOcctNode } from "../src/lib/occt/nodeOcctLoader";
import { createNodeOcctBridge } from "../src/lib/occt/nodeOcctBridge";
import { patternTopologySnapshots } from "../src/lib/cad/patternTopologySnapshots";

async function main(): Promise<void> {
  const output =
    process.argv[2] ?? "docs/evidence/topology-survival-260806/run-7.json";
  const prefix = (id: string, snapshots: TopologyEntitySnapshot[]) =>
    snapshots.map((item) => ({
      ...item,
      persistentRef: `${id}:${item.persistentRef}`,
    }));

  const loop = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 25 },
    { x: 0, y: 25 },
  ];
  const extrude = (depth: number): ExtrudeFeature => ({
    kind: "extrude",
    loop,
    depth,
    direction: "one_sided",
    mode: "add",
  });
  const extrudeFixtures = Array.from({ length: 20 }, (_, index) => {
    const id = `extrude-depth-${String(index + 1).padStart(2, "0")}`;
    const before = prefix(
      id,
      namedTopologySnapshots(buildExtrudeTopo(extrude(5 + index))),
    );
    const after = prefix(
      id,
      namedTopologySnapshots(buildExtrudeTopo(extrude(30 + index * 2))),
    );
    return {
      id,
      before,
      after,
      report: evaluateTopologySurvival({ before, after, minimumSamples: 1 }),
    };
  });

  const revolve = (radius: number, height: number): RevolveFeature => ({
    kind: "revolve",
    loop: [
      { x: 0, y: 0 },
      { x: radius, y: 0 },
      { x: radius, y: height },
      { x: 0, y: height },
    ],
    angleDegrees: 360,
    mode: "add",
  });
  const revolveFixtures = Array.from({ length: 20 }, (_, index) => {
    const id = `revolve-profile-${String(index + 1).padStart(2, "0")}`;
    const before = prefix(
      id,
      revolveTopologySnapshots(
        buildRevolveTopo(revolve(8 + index, 20 + index)),
      ),
    );
    const after = prefix(
      id,
      revolveTopologySnapshots(
        buildRevolveTopo(revolve(12 + index, 35 + index * 2)),
      ),
    );
    return {
      id,
      before,
      after,
      report: evaluateTopologySurvival({ before, after, minimumSamples: 1 }),
    };
  });

  const booleanSource = (index: number, changed: boolean) => {
    const dx = changed ? 2 + index * 0.1 : 0;
    const point = (x: number) => ({ x: x + dx, y: index, z: 0 });
    const base = fromAnchors(
      new Map([
        ["e.left", point(0)],
        ["e.right", point(10)],
      ]),
    );
    const tool = fromAnchors(new Map([["e.tool", point(5)]]));
    const inputs: BooleanInput[] = [
      {
        featureId: "base",
        names: base.names(),
        anchorOf: (name) => base.anchor(name),
      },
      {
        featureId: "H0",
        names: tool.names(),
        anchorOf: (name) => tool.anchor(name),
      },
    ];
    const mids = [point(10), point(7), point(0), point(5)];
    const keys = [null, "H0/f.side.0∩base/f.cap.top", null, null];
    return composeBooleanTopo(inputs, changed ? [...mids].reverse() : mids, {
      opId: "cut.H0",
      seamKeys: changed ? [...keys].reverse() : keys,
    });
  };
  const booleanFixtures = Array.from({ length: 20 }, (_, index) => {
    const id = `boolean-history-${String(index + 1).padStart(2, "0")}`;
    const before = prefix(
      id,
      booleanEdgeTopologySnapshots(booleanSource(index, false)),
    );
    const after = prefix(
      id,
      booleanEdgeTopologySnapshots(booleanSource(index, true)),
    );
    return {
      id,
      before,
      after,
      report: evaluateTopologySurvival({ before, after, minimumSamples: 1 }),
    };
  });

  const holeFixtures = Array.from({ length: 20 }, (_, index) => {
    const id = `hole-intent-${String(index + 1).padStart(2, "0")}`;
    const make = (changed: boolean) =>
      holeTopologySnapshots(
        "H0",
        {
          kind: "hole",
          center: {
            x: (changed ? 14 : 10) + index,
            y: (changed ? 9 : 12) + index,
          },
          holeType: "drilled",
          diameter: (changed ? 6 : 4) + index * (changed ? 0.15 : 0.1),
          depth: (changed ? 10 : 5) + index * (changed ? 0.3 : 0.2),
        },
        30,
      );
    const before = prefix(id, make(false));
    const after = prefix(id, make(true));
    return {
      id,
      before,
      after,
      report: evaluateTopologySurvival({ before, after, minimumSamples: 1 }),
    };
  });

  const patternFixtures = Array.from({ length: 20 }, (_, index) => {
    const id = `pattern-occurrence-${String(index + 1).padStart(2, "0")}`;
    const seed = namedTopologySnapshots(
      buildExtrudeTopo(extrude(5 + index * 0.1)),
    );
    const beforePattern =
      index < 10
        ? {
            kind: "linear_pattern" as const,
            childScad: "",
            count: 5,
            direction: { x: 1, y: 0, z: 0 },
            spacing: 10 + index,
          }
        : {
            kind: "circular_pattern" as const,
            childScad: "",
            count: 5,
            axisOrigin: { x: 0, y: 0, z: 0 },
            axisDirection: { x: 0, y: 0, z: 1 },
            totalAngleDegrees: 360,
          };
    const afterPattern =
      index < 10
        ? {
            ...beforePattern,
            spacing: 25 + index,
            direction: { x: 0, y: 1, z: 0 },
          }
        : { ...beforePattern, totalAngleDegrees: 270 };
    const before = prefix(
      id,
      patternTopologySnapshots("P0", beforePattern, seed),
    );
    const after = prefix(
      id,
      patternTopologySnapshots("P0", afterPattern, seed),
    );
    return {
      id,
      before,
      after,
      report: evaluateTopologySurvival({ before, after, minimumSamples: 1 }),
    };
  });

  const nativeFaceSnapshots = (refs: string[]): TopologyEntitySnapshot[] =>
    refs.map((persistentRef, index) => ({
      kind: "face",
      persistentRef,
      semanticRole: persistentRef,
      centroid: [index, 0, 0],
      measure: 1,
    }));
  const circle = (cx: number, cy: number, radius: number, segments = 32) =>
    Array.from({ length: segments }, (_, i) => ({
      x: cx + radius * Math.cos((2 * Math.PI * i) / segments),
      y: cy + radius * Math.sin((2 * Math.PI * i) / segments),
    }));
  const loadedOcct = await loadOcctNode();
  const nativeHoleFixtures: typeof extrudeFixtures = [];
  const nativeFilletFixtures: typeof extrudeFixtures = [];
  const nativeChamferFixtures: typeof extrudeFixtures = [];
  const nativePatternFixtures: typeof extrudeFixtures = [];
  let nativeHoleNotRun: { status: "not_run"; reason: string } | null = null;
  let nativePatternNotRun: { status: "not_run"; reason: string } | null = null;
  if (!loadedOcct.ok || !loadedOcct.oc) {
    nativeHoleNotRun = {
      status: "not_run",
      reason: loadedOcct.reason ?? "OCCT did not load",
    };
    nativePatternNotRun = nativeHoleNotRun;
  } else {
    const bridge = createNodeOcctBridge(loadedOcct.oc);
    if (!bridge.buildPrismAt || !bridge.listFaceRefs) {
      nativeHoleNotRun = {
        status: "not_run",
        reason: "OCCT bridge lacks prism or face-reference inspection",
      };
    } else {
      const buildRefs = async (index: number, changed: boolean) => {
        const size = (changed ? 70 : 50) + index;
        const depth = (changed ? 40 : 30) + index * 0.2;
        const base = await bridge.buildFromExtrude({
          kind: "extrude",
          loop: [
            { x: 0, y: 0 },
            { x: size, y: 0 },
            { x: size, y: size },
            { x: 0, y: size },
          ],
          depth,
          direction: "one_sided",
          mode: "add",
        });
        if (!base.ok || !base.shape)
          throw new Error(base.error ?? "native hole base failed");
        const tool = await bridge.buildPrismAt!(
          circle(15 + index + (changed ? 3 : 0), 18 + index, 3 + index * 0.05),
          -0.1,
          depth + 0.2,
        );
        if (!tool.ok || !tool.shape) {
          bridge.release(base.shape);
          throw new Error(tool.error ?? "native hole tool failed");
        }
        const cut = await bridge.boolean.subtract(base.shape, tool.shape, {
          baseId: "base",
          toolId: "H0",
          opId: "cut.H0",
        });
        bridge.release(base.shape);
        bridge.release(tool.shape);
        if (!cut.ok || !cut.shape)
          throw new Error(cut.error ?? "native hole cut failed");
        try {
          return await bridge.listFaceRefs!(cut.shape);
        } finally {
          bridge.release(cut.shape);
        }
      };
      for (let index = 0; index < 20; index += 1) {
        const id = `hole-native-${String(index + 1).padStart(2, "0")}`;
        const before = prefix(
          id,
          nativeFaceSnapshots(await buildRefs(index, false)),
        );
        const after = prefix(
          id,
          nativeFaceSnapshots(await buildRefs(index, true)),
        );
        nativeHoleFixtures.push({
          id,
          before,
          after,
          report: evaluateTopologySurvival({
            before,
            after,
            minimumSamples: 1,
          }),
        });
      }

      const roundedFixtures = async (op: "fillet" | "chamfer") => {
        const fixtures: typeof extrudeFixtures = [];
        const roundedRefs = async (index: number, changed: boolean) => {
          const size = (changed ? 35 : 25) + index * 0.2;
          const base = await bridge.buildFromExtrude({
            kind: "extrude",
            loop: [
              { x: 0, y: 0 },
              { x: size, y: 0 },
              { x: size, y: size },
              { x: 0, y: size },
            ],
            depth: (changed ? 16 : 10) + index * 0.1,
            direction: "one_sided",
            mode: "add",
          });
          if (!base.ok || !base.shape)
            throw new Error(base.error ?? `${op} base failed`);
          const rounded = await bridge[op](
            base.shape,
            ["e.vert.0"],
            (changed ? 1.2 : 0.6) + index * 0.01,
          );
          bridge.release(base.shape);
          if (!rounded.ok || !rounded.shape)
            throw new Error(rounded.error ?? `${op} failed`);
          try {
            return await bridge.listFaceRefs!(rounded.shape);
          } finally {
            bridge.release(rounded.shape);
          }
        };
        for (let index = 0; index < 20; index += 1) {
          const id = `${op}-native-${String(index + 1).padStart(2, "0")}`;
          const before = prefix(
            id,
            nativeFaceSnapshots(await roundedRefs(index, false)),
          );
          const after = prefix(
            id,
            nativeFaceSnapshots(await roundedRefs(index, true)),
          );
          fixtures.push({
            id,
            before,
            after,
            report: evaluateTopologySurvival({
              before,
              after,
              minimumSamples: 1,
            }),
          });
        }
        return fixtures;
      };
      nativeFilletFixtures.push(...(await roundedFixtures("fillet")));
      nativeChamferFixtures.push(...(await roundedFixtures("chamfer")));

      const nativePatternRefs = async (
        index: number,
        changed: boolean,
      ): Promise<string[]> => {
        const linear = index < 10;
        const count = 5;
        const size = 8 + index * 0.1;
        const depth = 5 + index * 0.1;
        const spacing = changed ? 25 + index : 10 + index;
        const totalAngle = changed ? 270 : 360;
        const refs: string[] = [];
        for (let occurrence = 0; occurrence < count; occurrence += 1) {
          const angleDegrees = linear
            ? 0
            : (totalAngle === 360
                ? totalAngle / count
                : totalAngle / (count - 1)) * occurrence;
          const angle = (angleDegrees * Math.PI) / 180;
          const originX = linear ? (changed ? 0 : spacing * occurrence) : 0;
          const originY = linear ? (changed ? spacing * occurrence : 0) : 0;
          const baseLoop = [
            { x: linear ? 0 : 30, y: 0 },
            { x: (linear ? 0 : 30) + size, y: 0 },
            { x: (linear ? 0 : 30) + size, y: size },
            { x: linear ? 0 : 30, y: size },
          ];
          const loop = baseLoop.map((point) =>
            linear
              ? { x: point.x + originX, y: point.y + originY }
              : {
                  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
                  y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
                },
          );
          const shape = await bridge.buildFromExtrude({
            kind: "extrude",
            loop,
            depth,
            direction: "one_sided",
            mode: "add",
          });
          if (!shape.ok || !shape.shape)
            throw new Error(shape.error ?? "native pattern occurrence failed");
          try {
            const occurrenceRefs = await bridge.listFaceRefs!(shape.shape);
            refs.push(
              ...occurrenceRefs.map(
                (ref) => `P0/occurrence:${occurrence}/${ref}`,
              ),
            );
          } finally {
            bridge.release(shape.shape);
          }
        }
        return refs;
      };
      for (let index = 0; index < 20; index += 1) {
        const id = `pattern-native-${String(index + 1).padStart(2, "0")}`;
        const before = prefix(
          id,
          nativeFaceSnapshots(await nativePatternRefs(index, false)),
        );
        const after = prefix(
          id,
          nativeFaceSnapshots(await nativePatternRefs(index, true)),
        );
        nativePatternFixtures.push({
          id,
          before,
          after,
          report: evaluateTopologySurvival({
            before,
            after,
            minimumSamples: 1,
          }),
        });
      }
    }
  }

  const familyReport = (fixtures: typeof extrudeFixtures) =>
    evaluateTopologySurvival({
      before: fixtures.flatMap((item) => item.before),
      after: fixtures.flatMap((item) => item.after),
      targetRate: 0.95,
      minimumSamples: 20,
    });
  const extrudeReport = familyReport(extrudeFixtures);
  const revolveReport = familyReport(revolveFixtures);
  const booleanReport = familyReport(booleanFixtures);
  const holeReport = familyReport(holeFixtures);
  const patternReport = familyReport(patternFixtures);
  const nativeHoleReport = nativeHoleFixtures.length
    ? familyReport(nativeHoleFixtures)
    : null;
  const nativeFilletReport = nativeFilletFixtures.length
    ? familyReport(nativeFilletFixtures)
    : null;
  const nativeChamferReport = nativeChamferFixtures.length
    ? familyReport(nativeChamferFixtures)
    : null;
  const nativePatternReport = nativePatternFixtures.length
    ? familyReport(nativePatternFixtures)
    : null;
  const allFixtures = [
    ...extrudeFixtures,
    ...revolveFixtures,
    ...booleanFixtures,
    ...holeFixtures,
    ...patternFixtures,
    ...nativeHoleFixtures,
    ...nativeFilletFixtures,
    ...nativeChamferFixtures,
    ...nativePatternFixtures,
  ];
  const aggregate = evaluateTopologySurvival({
    before: allFixtures.flatMap((item) => item.before),
    after: allFixtures.flatMap((item) => item.after),
    targetRate: 0.95,
    minimumSamples: 20,
  });
  const artifact = {
    schema: "nexyfab.topology-survival-campaign.v8",
    generatedAt: new Date().toISOString(),
    scope:
      "Calibrated extrude, revolve, Boolean, hole, fillet, and chamfer history edits; not a complex-product 95% accuracy claim.",
    fixtureCount: allFixtures.length,
    aggregate,
    families: {
      extrude_depth: extrudeReport,
      revolve_profile: revolveReport,
      boolean_split_merge: booleanReport,
      hole: {
        method: "generative_intent",
        report: holeReport,
        native_result_faces: nativeHoleReport ?? nativeHoleNotRun,
      },
      fillet_chamfer: {
        native_fillet_faces: nativeFilletReport ?? nativeHoleNotRun,
        native_chamfer_faces: nativeChamferReport ?? nativeHoleNotRun,
      },
      pattern: {
        method: "generative_occurrence_namespace",
        report: patternReport,
        native_brep_occurrences:
          nativePatternReport ??
          nativePatternNotRun ??
          ({
            status: "not_run",
            reason: "OCCT bridge lacks native face-reference inspection",
          } as const),
      },
    },
    fixtures: allFixtures.map((item) => ({
      id: item.id,
      status: item.report.status,
      sampleCount: item.report.sampleCount,
      survivalRate: item.report.survivalRate,
    })),
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      output,
      status: aggregate.status,
      fixtures: allFixtures.length,
      samples: aggregate.sampleCount,
      survivalRate: aggregate.survivalRate,
    }),
  );
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
