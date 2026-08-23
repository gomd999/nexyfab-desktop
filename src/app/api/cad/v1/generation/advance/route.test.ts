// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import {
  bindGenerationProgram,
  createGenerationRun,
  recordGenerationStage,
} from "@/lib/ai/generationRunState";
import { createServerGenerationState, loadServerGenerationState, resetGenerationStateStoreForTests } from "@/lib/ai/generationStateStore";
import { serverEvidenceSha256 } from "@/lib/ai/serverEvidence";
import { parseGenerationTopologyLineageEvidence } from "@/lib/ai/generationTopologyLineage";
import { prepareGenerationTopologyLineage } from "@/lib/ai/advanceGenerationRun";

vi.mock("@/lib/auth-middleware", () => ({ getAuthUser: vi.fn(async () => null) }));

const prepared = () => {
  let state = createGenerationRun("advance-topology-api");
  for (const stage of [
    "intent",
    "decomposition",
    "interfaces",
    "part_programs",
  ] as const) {
    state = recordGenerationStage(state, {
      stage,
      input: stage,
      output: true,
      status: "passed",
    });
  }
  return state;
};
const program = {
  version: 1 as const,
  units: "mm" as const,
  classification: "review_required" as const,
  name: "topology gate fixture",
  unresolved: [],
  assembly: {
    parts: [
      {
        id: "p1",
        name: "Part",
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
        partNumber: "P1",
        revision: "A",
        quantity: 1,
        source: "confirmed" as const,
      },
      featureTree: {
        nodes: [
          {
            id: "body",
            name: "Body",
            dependencies: [],
            payload: {
              kind: "extrude" as const,
              loop: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
              ],
              depth: 10,
              direction: "one_sided" as const,
              mode: "add" as const,
            },
          },
        ],
      },
    },
  ],
};

const topologyReady = {
  confirmedIds: [],
};
const brokenTopologyProgram = {
  ...program,
  assembly: {
    ...program.assembly,
    parts: [
      ...program.assembly.parts,
      {
        id: "p2",
        name: "Part 2",
        partTemplateId: "p2",
        fixed: false,
        position: { x: 20, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    ],
    mates: [{
      id: "m1",
      kind: "coincident" as const,
      a: { partId: "p1", refId: "missing-face", refKind: "face" as const },
      b: { partId: "p2", refId: "missing-face-2", refKind: "face" as const },
    }],
  },
  parts: [
    ...program.parts,
    {
      ...program.parts[0],
      instanceId: "p2",
      definitionId: "p2",
      metadata: { ...program.parts[0].metadata, partNumber: "P2" },
    },
  ],
};

const advanceRequest = (state: ReturnType<typeof prepared>, overrides: Record<string, unknown> = {}) => new NextRequest(
  "http://localhost/api/cad/v1/generation/advance",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.87",
    },
    body: JSON.stringify({ state, program, topologyRebind: topologyReady, ...overrides }),
  },
);

const preparedWithServerProgram = async () => {
  let state = prepared();
  state = recordGenerationStage(state, { stage: "part_programs", input: "part_programs", output: program, status: "passed" });
  state = bindGenerationProgram(state, serverEvidenceSha256(program));
  const preparedLineage = await prepareGenerationTopologyLineage(state, program);
  if (preparedLineage.status !== "ready") throw new Error("test fixture failed to produce server topology lineage");
  return preparedLineage.state;
};

describe("generation advance topology canonical response", () => {
  beforeEach(() => resetGenerationStateStoreForTests());

  it("rejects client-supplied commercial receipt bytes/trust controls", async () => {
    const response = await POST(new NextRequest("http://localhost/api/cad/v1/generation/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commercialReceipt: { releaseReady: true }, registry: [], rawReceiptBytes: "fake" }) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "COMMERCIAL_RECEIPT_SERVER_ONLY", status: "HOLD", releaseReady: false });
  });

  it("rejects forged ready/empty-blocker topology claims", async () => {
    const state = prepared();
    await createServerGenerationState("guest:198.51.100.87", state);
    const response = await POST(advanceRequest(state, {
      topologyRebind: {
        assemblySolveReady: true,
        blockingMateIds: [],
        blockingInterfaceIds: [],
        confirmationRequiredIds: [],
        confirmedIds: [],
      },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "TOPOLOGY_CLIENT_DERIVED_FIELDS_FORBIDDEN" });
  });

  it("returns the same stable blocker subset before finalization", async () => {
    const state = prepared();
    await createServerGenerationState("guest:198.51.100.87", state);
    const request = new NextRequest(
      "http://localhost/api/cad/v1/generation/advance",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.87",
        },
        body: JSON.stringify({
          state,
          program: brokenTopologyProgram,
          topologyRebind: { confirmedIds: [] },
        }),
      },
    );
    const response = await POST(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      stoppedAt: "assembly_solve",
      canonical: {
        schema: "nexyfab.generation-canonical-response.v1",
        status: "fail",
        stoppedAt: "assembly_solve",
        releaseReady: false,
        codes: [
        "ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED",
      ],
      unresolvedCount: 1,
      unresolvedByStage: [{ stage: "assembly_solve", count: 1 }],
        affectedPartIds: ["p1", "p2"],
        quoteOrRfqSideEffects: false,
      },
      executionPlan: {
        schema: 'nexyfab.adaptive-complex-product-execution.v1',
        objective: 'complete_manufacturing_product',
        status: 'precision_cad_required',
        activeStage: 'assembly_solve',
        designComplete: false,
        precisionCad: { required: true },
        externalCadInstallationRequired: false,
      },
    });
    expect(body.canonical.contractHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("replays an identical advance without creating another canonical revision", async () => {
    const state = prepared();
    await createServerGenerationState("guest:198.51.100.87", state);
    const payload = { idempotencyKey: "advance-replay", topologyRebind: topologyReady };
    const first = await POST(advanceRequest(state, payload));
    const firstBody = await first.json();
    const replay = await POST(advanceRequest(state, payload));
    const replayBody = await replay.json();
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(firstBody.topologyEvidenceSource).toBe("preview-local");
    expect(replayBody.replayed).toBe(true);
    expect(replayBody.topologyEvidenceSource).toBe(firstBody.topologyEvidenceSource);
    expect(replayBody.state.revision).toBe(firstBody.state.revision);
    expect(replayBody.canonical).toEqual(firstBody.canonical);
  });

  it("rejects a conflicting replay for a server-owned idempotency key", async () => {
    const state = prepared();
    await createServerGenerationState("guest:198.51.100.87", state);
    const payload = { idempotencyKey: "advance-conflict", topologyRebind: topologyReady };
    const first = await POST(advanceRequest(state, payload));
    expect(first.status).toBe(200);
    const conflicting = await POST(advanceRequest(state, {
      ...payload,
      program: { ...program, name: "different-program" },
    }));
    expect(conflicting.status).toBe(409);
    await expect(conflicting.json()).resolves.toMatchObject({ code: "GENERATION_ADVANCE_IDEMPOTENCY_CONFLICT" });
  });

  it("fails closed before persistence when the mandatory topology gate is missing", async () => {
    const state = prepared();
    await createServerGenerationState("guest:198.51.100.87", state);
    const response = await POST(advanceRequest(state, { topologyRebind: undefined }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "TOPOLOGY_REBIND_GATE_REQUIRED" });
    const current = await loadServerGenerationState("guest:198.51.100.87", state.runId);
    expect(current.revision).toBe(state.revision);
  });

  it("commits a valid exact-precision advance through the canonical response", async () => {
    const state = prepared();
    await createServerGenerationState("guest:198.51.100.87", state);
    const response = await POST(advanceRequest(state, { idempotencyKey: "advance-valid" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.state.revision).toBeGreaterThan(state.revision);
    expect(body.canonical.revision).toBe(body.state.revision);
    expect(body.state.stages.kernel.status).toBe("passed");
    expect(body.state.stages.topology.status).toBe("passed");
    expect(body.state.advanceReplays).toEqual([expect.objectContaining({ idempotencyKey: "advance-valid", resultRevision: body.state.revision })]);
  });

  it("uses a bound server checkpoint instead of browser topology claims", async () => {
    const state = await preparedWithServerProgram();
    await createServerGenerationState("guest:198.51.100.87", state);
    const payload = { idempotencyKey: "server-topology" };
    const response = await POST(advanceRequest(state, payload));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.topologyEvidenceSource).toBe("server-checkpoint");
    expect(body.state.evidenceBindings.programSha256).toBe(serverEvidenceSha256(program));
    const persisted = parseGenerationTopologyLineageEvidence(body.state, program, serverEvidenceSha256(program), body.state.checkpointOutputs?.topology);
    expect(persisted?.evidence.revision).toBe(body.state.revision);

    const replay = await POST(advanceRequest(state, payload));
    const replayBody = await replay.json();
    expect(replay.status).toBe(200);
    expect(replayBody.replayed).toBe(true);
    const replayedPersisted = parseGenerationTopologyLineageEvidence(replayBody.state, program, serverEvidenceSha256(program), replayBody.state.checkpointOutputs?.topology);
    expect(replayedPersisted?.evidence.revision).toBe(replayBody.state.revision);
  });
});
