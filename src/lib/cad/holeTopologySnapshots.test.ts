import { describe, expect, it } from "vitest";
import { holeTopologySnapshots } from "./holeTopologySnapshots";
import { evaluateTopologySurvival } from "./topologySurvivalEvidence";

const hole = (depth: number) => ({
  kind: "hole" as const,
  center: { x: 10, y: 20 },
  holeType: "drilled" as const,
  diameter: 6,
  depth,
});

describe("hole generative topology snapshots", () => {
  it("keeps bore/entry/bottom provenance through blind-hole edits", () => {
    const report = evaluateTopologySurvival({
      before: holeTopologySnapshots("H0", hole(5), 20),
      after: holeTopologySnapshots(
        "H0",
        { ...hole(8), diameter: 9, center: { x: 12, y: 23 } },
        20,
      ),
      minimumSamples: 1,
    });
    expect(report).toMatchObject({
      status: "passed",
      sampleCount: 4,
      persistentCount: 4,
    });
  });

  it("explicitly loses the blind bottom when the hole becomes through", () => {
    const report = evaluateTopologySurvival({
      before: holeTopologySnapshots("H0", hole(5), 20),
      after: holeTopologySnapshots("H0", hole(25), 20),
      minimumSamples: 1,
    });
    expect(report).toMatchObject({
      status: "failed",
      resolvedCount: 2,
      brokenCount: 2,
      survivalRate: 0.5,
    });
    expect(
      report.results
        .filter((item) => item.quality === "broken")
        .map((item) => item.previousRef),
    ).toEqual(["H0/f.bottom", "H0/e.bottom"]);
  });
});
