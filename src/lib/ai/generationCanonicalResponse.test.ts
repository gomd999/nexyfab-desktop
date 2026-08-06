import { describe, expect, it } from "vitest";
import {
  createGenerationRun,
  type GenerationRunState,
} from "./generationRunState";
import { buildGenerationCanonicalResponse } from "./generationCanonicalResponse";

const result = (state: GenerationRunState) => ({
  state,
  stoppedAt: "manufacturing" as const,
  manufacturingReports: {},
  roundtripComparisons: {},
  stepManufacturingReports: {},
});

describe("buildGenerationCanonicalResponse", () => {
  it("sorts codes, parts and artifacts into a deterministic parity hash", () => {
    const a = createGenerationRun("run-parity");
    a.stages.manufacturing = {
      ...a.stages.manufacturing,
      status: "failed",
      errorCodes: ["Z_CODE", "A_CODE"],
      unresolved: ["missing"],
      affectedPartIds: ["part-b", "part-a"],
    };
    a.verifiedPartArtifacts = {
      "part-b": { artifactHash: "b", verifiedAtStage: "kernel" },
      "part-a": { artifactHash: "a", verifiedAtStage: "kernel" },
    };
    const b = structuredClone(a);
    b.stages.manufacturing.errorCodes.reverse();
    b.stages.manufacturing.affectedPartIds.reverse();
    b.verifiedPartArtifacts = {
      "part-a": b.verifiedPartArtifacts["part-a"]!,
      "part-b": b.verifiedPartArtifacts["part-b"]!,
    };
    const left = buildGenerationCanonicalResponse(result(a)),
      right = buildGenerationCanonicalResponse(result(b));
    expect(left).toEqual(right);
    expect(left.status).toBe("fail");
    expect(left.codes).toEqual(["A_CODE", "Z_CODE"]);
    expect(left.contractHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not include timestamps or full source evidence in the canonical subset", () => {
    const value = buildGenerationCanonicalResponse(
      result(createGenerationRun("safe-run")),
    );
    expect(JSON.stringify(value)).not.toContain("startedAt");
    expect(value.quoteOrRfqSideEffects).toBe(false);
  });

  it("exposes topology assembly blockers without embedding unstable messages", () => {
    const state = createGenerationRun("topology-blocked");
    state.stages.assembly_solve = {
      ...state.stages.assembly_solve,
      status: "failed",
      errorCodes: [
        "ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED",
        "ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED",
      ],
      unresolved: [
        "mate topology review required: m1",
        "derived topology confirmation required: interface:i1",
      ],
      affectedPartIds: ["shaft-1"],
    };
    const value = buildGenerationCanonicalResponse({
      state,
      stoppedAt: "assembly_solve",
    });
    expect(value).toMatchObject({
      status: "fail",
      stoppedAt: "assembly_solve",
      releaseReady: false,
      codes: [
        "ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED",
        "ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED",
      ],
      unresolvedCount: 2,
      unresolvedByStage: [{ stage: "assembly_solve", count: 2 }],
      affectedPartIds: ["shaft-1"],
    });
    expect(JSON.stringify(value)).not.toContain(
      "mate topology review required",
    );
  });
});
