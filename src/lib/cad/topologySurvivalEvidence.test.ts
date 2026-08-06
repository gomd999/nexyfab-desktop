import { describe, expect, it } from "vitest";
import type { TopologyEntitySnapshot } from "./topologyRemap";
import { evaluateTopologySurvival } from "./topologySurvivalEvidence";

const face = (ref: string, x = 0): TopologyEntitySnapshot => ({
  kind: "face",
  persistentRef: ref,
  featureId: "base",
  semanticRole: ref,
  centroid: [x, 0, 0],
  direction: [0, 0, 1],
  measure: 100,
});

describe("topology survival evidence", () => {
  it("passes only when the declared sample floor and target are met", () => {
    const before = Array.from({ length: 20 }, (_, i) => face(`face-${i}`, i));
    const report = evaluateTopologySurvival({
      before,
      after: before,
      minimumSamples: 20,
    });
    expect(report).toMatchObject({
      status: "passed",
      sampleCount: 20,
      persistentCount: 20,
      survivalRate: 1,
    });
  });

  it("reports not_run instead of claiming accuracy from a tiny sample", () => {
    expect(
      evaluateTopologySurvival({ before: [face("top")], after: [face("top")] }),
    ).toMatchObject({ status: "not_run", sampleCount: 1 });
  });

  it("fails below target and keeps ambiguous/broken references unresolved", () => {
    const before = Array.from({ length: 20 }, (_, i) =>
      face(`old-${i}`, i * 100),
    );
    const after = before.slice(0, 18).map((item) => ({ ...item }));
    const report = evaluateTopologySurvival({ before, after });
    expect(report).toMatchObject({
      status: "failed",
      resolvedCount: 18,
      brokenCount: 2,
      survivalRate: 0.9,
    });
  });

  it("counts a critical reference missing from the before snapshot as broken", () => {
    const report = evaluateTopologySurvival({
      before: [face("top")],
      after: [face("top")],
      criticalRefs: ["top", "missing"],
      minimumSamples: 2,
    });
    expect(report).toMatchObject({
      status: "failed",
      sampleCount: 2,
      brokenCount: 1,
      survivalRate: 0.5,
    });
  });
});
