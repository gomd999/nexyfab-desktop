// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  finalizeGenerationRun,
  type PartFinalizationEvidence,
} from "./finalizeGenerationRun";
import {
  createGenerationRun,
  GENERATION_STAGES,
  recordGenerationStage,
} from "./generationRunState";

function ready() {
  let state = createGenerationRun("finalize");
  for (const stage of GENERATION_STAGES.slice(0, 7))
    state = recordGenerationStage(state, {
      stage,
      input: stage,
      output: { pass: true },
      status: "passed",
    });
  return state;
}
const measurement = {
  shapeType: "solid",
  isNull: false,
  bbox: { width: 10, height: 20, depth: 30 },
  volumeMm3: 6000,
  faceCount: 6,
  solidCount: 1,
};
function part(
  overrides: Partial<PartFinalizationEvidence["manufacturing"]> = {},
): PartFinalizationEvidence {
  return {
    partId: "p1",
    manufacturing: {
      provenance: {
        traceable: true,
        privacyCompliant: true,
        refs: ["prompt:1"],
      },
      intent: { resolved: true, unresolved: [], conflicts: [] },
      program: { valid: true, errors: [], hash: "abc" },
      kernel: { built: true, analytic: true, engine: "OCCT", errors: [] },
      topology: { closed: true, solidCount: 1, manifold: true, errors: [] },
      dimensions: {
        checked: 3,
        maxErrorMm: 0.01,
        toleranceMm: 0.05,
        mismatches: [],
      },
      features: { requested: 1, verified: 1, skipped: [], mismatches: [] },
      dfm: {
        process: "machining",
        material: "Al",
        passed: true,
        violations: [],
      },
      release: {
        artifactId: "step-sha256",
        exactArtifactVerified: true,
        authorized: true,
        reasons: [],
      },
      ...overrides,
    },
    roundtrip: {
      before: measurement,
      after: { ...measurement, bbox: { ...measurement.bbox, width: 10.001 } },
    },
  };
}

describe("finalizeGenerationRun", () => {
  it("passes explicit no-motion designs through per-part manufacturing, roundtrip and release", () => {
    const result = finalizeGenerationRun(ready(), {
      motion: { required: false },
      parts: [part()],
    });
    expect(result.stoppedAt).toBe("release");
    expect(result.commercialReleaseReady).toBe(false);
    expect(result.state.stages.motion.status).toBe("passed");
    expect(result.state.stages.manufacturing.status).toBe("passed");
    expect(result.state.stages.roundtrip.status).toBe("passed");
    expect(result.state.stages.release.status).toBe("blocked");
  });
  it("records missing required motion as not_run and does not evaluate later gates", () => {
    const result = finalizeGenerationRun(ready(), {
      motion: { required: true },
      parts: [part()],
    });
    expect(result.stoppedAt).toBe("motion");
    expect(result.state.stages.motion.status).toBe("not_run");
    expect(result.state.stages.manufacturing.status).toBe("pending");
  });
  it("stops at the affected manufacturing part with G0-G7 failures", () => {
    const result = finalizeGenerationRun(ready(), {
      motion: { required: false },
      parts: [
        part({
          dfm: {
            process: "machining",
            material: "Al",
            passed: false,
            violations: ["wall too thin"],
          },
        }),
      ],
    });
    expect(result.stoppedAt).toBe("manufacturing");
    expect(result.state.stages.manufacturing.status).toBe("failed");
    expect(result.state.stages.manufacturing.affectedPartIds).toEqual(["p1"]);
  });
  it("retries only the affected part when required STEP domain evidence is not runnable", () => {
    const evidence = part();
    evidence.referenceStep = {
      source: "",
      requirements: ["flat_pattern", "bend_table"],
    };
    const result = finalizeGenerationRun(ready(), {
      motion: { required: false },
      parts: [evidence],
    });
    expect(result.stoppedAt).toBe("manufacturing");
    expect(result.state.stages.manufacturing.errorCodes).toEqual([
      "REFERENCE_STEP_EVIDENCE_FAILED",
    ]);
    expect(result.state.stages.manufacturing.affectedPartIds).toEqual(["p1"]);
    expect(result.stepManufacturingReports.p1?.checks).toHaveLength(2);
  });
  it("server-side comparison rejects topology-changing STEP roundtrip", () => {
    const evidence = part();
    evidence.roundtrip!.after = { ...measurement, faceCount: 5 };
    const result = finalizeGenerationRun(ready(), {
      motion: { required: false },
      parts: [evidence],
    });
    expect(result.stoppedAt).toBe("roundtrip");
    expect(result.state.stages.roundtrip.errorCodes).toContain(
      "STEP_ROUNDTRIP_FAILED",
    );
  });
  it("uses one body-intent contract for manufacturing and STEP roundtrip", () => {
    const evidence = part({
      topology: { closed: true, solidCount: 3, manifold: true, errors: [] },
    });
    evidence.bodyIntent = { policy: "multi_body", expectedBodies: 3 };
    evidence.roundtrip = {
      before: {
        ...measurement,
        shapeType: "compound",
        solidCount: 3,
        faceCount: 18,
      },
      after: {
        ...measurement,
        shapeType: "compound",
        solidCount: 3,
        faceCount: 18,
      },
    };
    const result = finalizeGenerationRun(ready(), {
      motion: { required: false },
      parts: [evidence],
    });
    expect(result.stoppedAt).toBe("release");
    expect(result.commercialReleaseReady).toBe(false);
    expect(
      result.manufacturingReports.p1?.gates.find((gate) => gate.id === "G4")
        ?.status,
    ).toBe("passed");
    expect(result.roundtripComparisons.p1?.passed).toBe(true);
  });
  it("blocks release when exact-artifact authorization is missing", () => {
    const result = finalizeGenerationRun(ready(), {
      motion: { required: false },
      parts: [part({ release: undefined })],
    });
    expect(result.stoppedAt).toBe("release");
    expect(result.state.stages.release.status).toBe("blocked");
  });
});
