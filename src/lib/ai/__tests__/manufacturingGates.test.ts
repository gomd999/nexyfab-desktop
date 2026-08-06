import { describe, expect, it } from "vitest";
import {
  evaluateManufacturingGates,
  type ManufacturingGateInput,
} from "../manufacturingGates";

const passing: ManufacturingGateInput = {
  provenance: {
    traceable: true,
    privacyCompliant: true,
    refs: ["prompt:sha256:abc"],
  },
  intent: { resolved: true, unresolved: [], conflicts: [] },
  program: { valid: true, errors: [], hash: "program-abc" },
  kernel: { built: true, analytic: true, engine: "OCCT", errors: [] },
  topology: { closed: true, manifold: true, solidCount: 1, errors: [] },
  dimensions: {
    checked: 3,
    maxErrorMm: 0.01,
    toleranceMm: 0.05,
    mismatches: [],
  },
  features: { requested: 2, verified: 2, skipped: [], mismatches: [] },
  dfm: { process: "cnc", material: "al6061", passed: true, violations: [] },
  stepRoundtrip: {
    reimported: true,
    topologyMatched: true,
    dimensionsMatched: true,
    errors: [],
  },
  release: {
    artifactId: "sha256:step",
    exactArtifactVerified: true,
    authorized: true,
    reasons: [],
  },
};

describe("G0-G9 manufacturing gates", () => {
  it("passes only when all ten gates pass", () => {
    const report = evaluateManufacturingGates(passing);
    expect(report.passed).toBe(true);
    expect(report.gates).toHaveLength(10);
    expect(report.gates.every((gate) => gate.status === "passed")).toBe(true);
  });

  it("fails closed when a gate was not run", () => {
    const report = evaluateManufacturingGates({});
    expect(report.passed).toBe(false);
    expect(report.firstBlockingGate).toBe("G0");
    expect(report.gates.every((gate) => gate.status === "not_run")).toBe(true);
  });

  it("does not confuse STEP export with STEP roundtrip", () => {
    const report = evaluateManufacturingGates({
      ...passing,
      stepRoundtrip: undefined,
    });
    expect(report.passed).toBe(false);
    expect(report.firstBlockingGate).toBe("G8");
    expect(report.gates.find((gate) => gate.id === "G8")).toMatchObject({
      status: "not_run",
    });
  });

  it("blocks release when even one requested feature was skipped", () => {
    const report = evaluateManufacturingGates({
      ...passing,
      features: {
        requested: 3,
        verified: 2,
        skipped: ["fillet"],
        mismatches: [],
      },
    });
    expect(report.firstBlockingGate).toBe("G6");
    expect(report.gates.find((gate) => gate.id === "G6")?.failures).toContain(
      "Skipped: fillet",
    );
  });

  it("does not silently pass an empty 0/0 feature check", () => {
    const report = evaluateManufacturingGates({
      ...passing,
      features: { requested: 0, verified: 0, skipped: [], mismatches: [] },
    });
    expect(report.passed).toBe(false);
    expect(report.gates.find((gate) => gate.id === "G6")).toMatchObject({
      status: "not_run",
    });
  });

  it("accepts zero requested features only when not-applicable is explicit", () => {
    const report = evaluateManufacturingGates({
      ...passing,
      features: {
        requested: 0,
        verified: 0,
        skipped: [],
        mismatches: [],
        applicable: false,
      },
    });
    expect(report.gates.find((gate) => gate.id === "G6")).toMatchObject({
      status: "passed",
      evidence: ["feature-check:not-applicable"],
    });
    expect(report.passed).toBe(true);
  });

  it("accepts a governed multi-body part and rejects an unexpected fuse", () => {
    const governed = evaluateManufacturingGates({
      ...passing,
      bodyIntent: { policy: "multi_body", expectedBodies: 3 },
      topology: { closed: true, manifold: true, solidCount: 3, errors: [] },
    });
    expect(governed.gates.find((gate) => gate.id === "G4")).toMatchObject({
      status: "passed",
    });
    const fused = evaluateManufacturingGates({
      ...passing,
      bodyIntent: { policy: "multi_body", expectedBodies: 3 },
      topology: { closed: true, manifold: true, solidCount: 1, errors: [] },
    });
    expect(fused.gates.find((gate) => gate.id === "G4")?.failures).toContain(
      "Expected 3 solids, found 1.",
    );
  });
});
