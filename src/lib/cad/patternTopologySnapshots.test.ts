import { describe, expect, it } from "vitest";
import { patternTopologySnapshots } from "./patternTopologySnapshots";
import { evaluateTopologySurvival } from "./topologySurvivalEvidence";
import type { TopologyEntitySnapshot } from "./topologyRemap";

const seed: TopologyEntitySnapshot[] = [
  {
    kind: "face",
    persistentRef: "f.top",
    centroid: [1, 0, 0],
    direction: [0, 0, 1],
    measure: 10,
  },
];
const linear = (count: number, spacing: number) => ({
  kind: "linear_pattern" as const,
  childScad: "",
  count,
  spacing,
  direction: { x: 1, y: 0, z: 0 },
});

describe("pattern occurrence topology", () => {
  it("keeps occurrence identity when spacing changes", () => {
    const before = patternTopologySnapshots("P0", linear(4, 10), seed);
    const after = patternTopologySnapshots("P0", linear(4, 25), seed);
    expect(
      evaluateTopologySurvival({ before, after, minimumSamples: 1 }),
    ).toMatchObject({ status: "passed", persistentCount: 4 });
    expect(after[3]!.centroid).toEqual([76, 0, 0]);
  });

  it("marks removed occurrences broken instead of shifting their identity", () => {
    const report = evaluateTopologySurvival({
      before: patternTopologySnapshots("P0", linear(5, 10), seed),
      after: patternTopologySnapshots("P0", linear(3, 10), seed),
      minimumSamples: 1,
    });
    expect(report).toMatchObject({
      status: "failed",
      resolvedCount: 3,
      brokenCount: 2,
      survivalRate: 0.6,
    });
  });

  it("rotates circular occurrence geometry while retaining qualified ids", () => {
    const circular = {
      kind: "circular_pattern" as const,
      childScad: "",
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
      totalAngleDegrees: 360,
    };
    const snapshots = patternTopologySnapshots("C0", circular, seed);
    expect(snapshots.map((item) => item.persistentRef)).toEqual([
      "C0/occurrence:0/f.top",
      "C0/occurrence:1/f.top",
      "C0/occurrence:2/f.top",
      "C0/occurrence:3/f.top",
    ]);
    expect(snapshots[1]!.centroid[1]).toBeCloseTo(1, 9);
  });
});
