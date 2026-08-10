// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { advanceGenerationRun } from "./advanceGenerationRun";
import {
  createGenerationRun,
  recordGenerationStage,
} from "./generationRunState";
import type { AiAssemblyProgram } from "./aiAssemblyProgram";

function preparedRun() {
  let state = createGenerationRun("advance-test");
  for (const stage of [
    "intent",
    "decomposition",
    "interfaces",
    "part_programs",
  ] as const) {
    state = recordGenerationStage(state, {
      stage,
      input: { stage },
      output: { accepted: true },
      status: "passed",
    });
  }
  return state;
}

function program(empty = false): AiAssemblyProgram {
  return {
    version: 1,
    units: "mm",
    classification: "review_required",
    name: "box",
    unresolved: [],
    assembly: {
      parts: [
        {
          id: "p1",
          name: "box",
          partTemplateId: "p1",
          fixed: true,
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      mates: [],
    },
    parts: [
      {
        instanceId: "p1",
        metadata: {
          partNumber: "P-1",
          revision: "A",
          quantity: 1,
          source: "confirmed",
        },
        featureTree: {
          nodes: empty
            ? []
            : [
                {
                  id: "body",
                  name: "body",
                  dependencies: [],
                  payload: {
                    kind: "extrude",
                    loop: [
                      { x: 0, y: 0 },
                      { x: 10, y: 0 },
                      { x: 10, y: 10 },
                      { x: 0, y: 10 },
                    ],
                    depth: 10,
                    direction: "one_sided",
                    mode: "add",
                  },
                },
              ],
        },
      },
    ],
  };
}

describe("advanceGenerationRun", () => {
  it("records real kernel and topology evidence before an assembly certificate", async () => {
    const verifier = vi.fn(async () => ({
      ok: true,
      releaseReady: true,
      assemblyCertificate: { solver: "pass" },
      flaggedInterferences: [],
    }));
    const result = await advanceGenerationRun(
      preparedRun(),
      program(),
      verifier,
    );
    expect(result.stoppedAt).toBe("motion");
    expect(result.state.stages.kernel.status).toBe("passed");
    expect(result.state.stages.topology.status).toBe("passed");
    expect(result.state.stages.assembly_solve.status).toBe("passed");
    expect(result.state.stages.motion.status).toBe("pending");
    expect(result.state.stages.kernel.checkpointHash).toHaveLength(64);
    expect(verifier).toHaveBeenCalledOnce();
  });

  it("fails closed at kernel and does not invoke assembly verification when geometry is absent", async () => {
    const verifier = vi.fn();
    const result = await advanceGenerationRun(
      preparedRun(),
      program(true),
      verifier,
    );
    expect(result.stoppedAt).toBe("kernel");
    expect(result.state.stages.kernel.status).toBe("failed");
    expect(result.state.stages.kernel.errorCodes).toContain(
      "PART_GEOMETRY_UNAVAILABLE",
    );
    expect(result.state.stages.topology.status).toBe("pending");
    expect(verifier).not.toHaveBeenCalled();
  });

  it('blocks concept-only programs before kernel geometry instead of promoting assumptions', async () => {
    const verifier = vi.fn();
    const concept = { ...program(), classification: 'concept_only' as const, unresolved: ['authoritative shaft tolerance required'] };
    const result = await advanceGenerationRun(preparedRun(), concept, verifier);
    expect(result.stoppedAt).toBe('kernel');
    expect(result.state.stages.kernel).toMatchObject({ status: 'blocked', errorCodes: ['AUTHORITATIVE_INPUT_REQUIRED'], metrics: { unresolvedInputs: 1 } });
    expect(verifier).not.toHaveBeenCalled();
  });

  it("preserves a non-release-ready assembly verdict as a failed checkpoint", async () => {
    const result = await advanceGenerationRun(
      preparedRun(),
      program(),
      async () => ({
        ok: true,
        releaseReady: false,
        flaggedInterferences: [{ partA: "p1", partB: "p2" }],
      }),
    );
    expect(result.stoppedAt).toBe("assembly_solve");
    expect(result.state.stages.assembly_solve.status).toBe("failed");
    expect(
      result.state.stages.assembly_solve.metrics.flaggedInterferences,
    ).toBe(1);
  });

  it("blocks assembly verification when topology review or derived confirmation remains", async () => {
    const verifier = vi.fn();
    const result = await advanceGenerationRun(
      preparedRun(),
      program(),
      verifier,
      0,
      {
        assemblySolveReady: false,
        blockingMateIds: ["m-broken"],
        blockingInterfaceIds: ["i-ambiguous"],
        confirmationRequiredIds: ["interface:i-derived"],
        confirmedIds: [],
      },
    );
    expect(result.stoppedAt).toBe("assembly_solve");
    expect(result.state.stages.assembly_solve).toMatchObject({
      status: "failed",
      errorCodes: [
        "ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED",
        "ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED",
      ],
      metrics: {
        blockingMates: 1,
        blockingInterfaces: 1,
        unconfirmedDerived: 1,
      },
    });
    expect(verifier).not.toHaveBeenCalled();
  });

  it("allows verified assembly execution after every derived reference is confirmed", async () => {
    const verifier = vi.fn(async () => ({ ok: true, releaseReady: true }));
    const result = await advanceGenerationRun(
      preparedRun(),
      program(),
      verifier,
      0,
      {
        assemblySolveReady: true,
        blockingMateIds: [],
        blockingInterfaceIds: [],
        confirmationRequiredIds: ["mate:m1"],
        confirmedIds: ["mate:m1"],
      },
    );
    expect(result.stoppedAt).toBe("motion");
    expect(verifier).toHaveBeenCalledOnce();
  });
});
