// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import {
  createGenerationRun,
  recordGenerationStage,
} from "@/lib/ai/generationRunState";
import { createServerGenerationState, resetGenerationStateStoreForTests } from "@/lib/ai/generationStateStore";

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

describe("generation advance topology canonical response", () => {
  beforeEach(() => resetGenerationStateStoreForTests());

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
          program,
          topologyRebind: {
            assemblySolveReady: false,
            blockingMateIds: ["m1"],
            blockingInterfaceIds: ["i1"],
            confirmationRequiredIds: ["interface:i2"],
            confirmedIds: [],
          },
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
          "ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED",
          "ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED",
        ],
        unresolvedCount: 3,
        unresolvedByStage: [{ stage: "assembly_solve", count: 3 }],
        affectedPartIds: ["p1"],
        quoteOrRfqSideEffects: false,
      },
      executionPlan: {
        schema: 'nexyfab.adaptive-complex-product-execution.v1',
        objective: 'complete_manufacturing_product',
        status: 'authoritative_input_required',
        activeStage: 'assembly_solve',
        designComplete: false,
        precisionCad: { required: false },
        externalCadInstallationRequired: false,
      },
    });
    expect(body.canonical.contractHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
