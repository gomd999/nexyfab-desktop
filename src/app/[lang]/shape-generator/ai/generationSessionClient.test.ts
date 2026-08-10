import { describe, expect, it, vi } from "vitest";
import {
  advanceGenerationSession,
  finalizeGenerationSession,
  GENERATION_CANONICAL_KEY,
  GENERATION_SESSION_KEY,
  recordGenerationSessionStages,
  refineGenerationSession,
  updateGenerationSessionForEdit,
} from "./generationSessionClient";
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
};
describe("browser generation session state", () => {
  it("initializes, invalidates the selected part, and persists the returned revision", async () => {
    const store = storage();
    const initial = {
      schema: "nexyfab.generation-run.v1",
      runId: "web",
      revision: 0,
      stages: {},
      verifiedPartArtifacts: {},
    };
    const changed = { ...initial, revision: 1 };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, state: initial }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, state: changed }), {
          status: 200,
        }),
      );
    await expect(
      updateGenerationSessionForEdit(
        [{ kind: "update_param", featureId: "f", paramKey: "depth", value: 8 }],
        {
          version: 1,
          projectRevision: "r",
          assemblyPath: ["main"],
          partInstanceId: "part-7",
          topology: [],
          sketchEntityIds: [],
          mateIds: [],
          coordinateFrame: "world",
          units: "mm",
        },
        { fetcher, storage: store, runId: "web" },
      ),
    ).resolves.toMatchObject({ revision: 1 });
    const invalidate = JSON.parse(
      String((fetcher.mock.calls[1]![1] as RequestInit).body),
    );
    expect(invalidate).toMatchObject({
      action: "invalidate_edit",
      transaction: {
        operations: [{ kind: "set_feature_parameter" }],
        affected: { parts: ["part-7"] },
      },
    });
    expect(JSON.parse(store.values.get(GENERATION_SESSION_KEY)!)).toMatchObject(
      { revision: 1 },
    );
  });
  it("maps destructive whole-model edits to decomposition invalidation", async () => {
    const store = storage();
    const state = {
      schema: "nexyfab.generation-run.v1",
      runId: "web",
      revision: 2,
      stages: {},
      verifiedPartArtifacts: {},
    };
    store.setItem(GENERATION_SESSION_KEY, JSON.stringify(state));
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, state: { ...state, revision: 3 } }),
          { status: 200 },
        ),
      );
    await updateGenerationSessionForEdit([{ kind: "clear_all" }], undefined, {
      fetcher,
      storage: store,
    });
    const request = JSON.parse(
      String((fetcher.mock.calls[0]![1] as RequestInit).body),
    );
    expect(request.transaction.operations).toEqual([
      { kind: "set_part_suppressed" },
    ]);
  });
  it("refuses browser-authored generation pass checkpoints", async () => {
    const store = storage();
    const states = [0, 1, 2].map((revision) => ({
      schema: "nexyfab.generation-run.v1",
      runId: "build",
      revision,
      stages: {},
      verifiedPartArtifacts: {},
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, state: states[0] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, state: states[1] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, state: states[2] }), {
          status: 200,
        }),
      );
    await expect(recordGenerationSessionStages(
      [
        { stage: "intent", input: "motor", output: {}, status: "passed" },
        {
          stage: "decomposition",
          input: {},
          output: { parts: 2 },
          status: "passed",
        },
      ],
      { fetcher, storage: store, runId: "build" },
    )).rejects.toThrow("SERVER_STAGE_EXECUTOR_REQUIRED");
    expect(store.values.has(GENERATION_SESSION_KEY)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("persists server-certified geometry advancement", async () => {
    const store = storage();
    const state = {
      schema: "nexyfab.generation-run.v1",
      runId: "r",
      revision: 4,
      stages: {},
      verifiedPartArtifacts: {},
    };
    const advanced = { ...state, revision: 7 };
    store.setItem(GENERATION_SESSION_KEY, JSON.stringify(state));
    const canonical = {
      schema: "nexyfab.generation-canonical-response.v1",
      runId: "r",
      revision: 7,
      status: "fail",
      stoppedAt: "assembly_solve",
      releaseReady: false,
      codes: ["ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED"],
      unresolvedCount: 1,
      unresolvedByStage: [{ stage: "assembly_solve", count: 1 }],
      affectedPartIds: ["p1"],
      verifiedPartArtifacts: [],
      lastCheckpoint: null,
      quoteOrRfqSideEffects: false,
      contractHash: "d".repeat(64),
    };
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, state: advanced, canonical }), {
          status: 200,
        }),
      );
    const program = {
      version: 1,
      units: "mm",
      classification: "review_required",
      name: "x",
      assembly: { parts: [], mates: [] },
      parts: [],
      unresolved: [],
    } as never;
    const result = await advanceGenerationSession(program, {
      fetcher,
      storage: store,
    });
    expect(result.revision).toBe(7);
    expect(JSON.parse(store.values.get(GENERATION_SESSION_KEY)!).revision).toBe(
      7,
    );
    expect(JSON.parse(store.values.get(GENERATION_CANONICAL_KEY)!)).toEqual(
      canonical,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/cad/v1/generation/advance",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("persists server-side finalization through the shared web contract", async () => {
    const store = storage();
    const state = {
      schema: "nexyfab.generation-run.v1",
      runId: "r",
      revision: 7,
      stages: {},
      verifiedPartArtifacts: {},
    };
    const finalized = { ...state, revision: 11 };
    const canonical = {
      schema: "nexyfab.generation-canonical-response.v1",
      runId: "r",
      revision: 11,
      status: "pass",
      stoppedAt: "complete",
      releaseReady: true,
      codes: [],
      unresolvedCount: 0,
      unresolvedByStage: [],
      affectedPartIds: [],
      verifiedPartArtifacts: [],
      lastCheckpoint: null,
      quoteOrRfqSideEffects: false,
      contractHash: "c".repeat(64),
    };
    store.setItem(GENERATION_SESSION_KEY, JSON.stringify(state));
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, state: finalized, canonical }),
          { status: 200 },
        ),
      );
    const program = { version: 1 } as never;
    const evidence = {
      motion: { required: false },
      parts: [
        {
          partId: "panel-1",
          manufacturing: {},
          referenceStep: {
            source: "ISO-10303-21;DATA;ENDSEC;END-ISO-10303-21;",
            requirements: ["flat_pattern", "bend_table"] as (
              "flat_pattern" | "bend_table"
            )[],
          },
        },
      ],
    };
    await expect(
      finalizeGenerationSession(program, evidence, { fetcher, storage: store }),
    ).resolves.toMatchObject({ revision: 11 });
    expect(JSON.parse(store.values.get(GENERATION_CANONICAL_KEY)!)).toEqual(
      canonical,
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/generation/finalize",
    );
    const request = JSON.parse(
      String((fetcher.mock.calls[0]![1] as RequestInit).body),
    );
    expect(request.parts).toEqual(evidence.parts);
  });
  it("runs four server refinement stages and returns only a compiled final program", async () => {
    const store = storage();
    const stages = ["intent", "decomposition", "interfaces", "part_programs"];
    let revision = 0;
    const state = () => ({
      schema: "nexyfab.generation-run.v1",
      runId: "multi",
      revision,
      stages: Object.fromEntries(
        stages.map((stage) => [
          stage,
          {
            status: revision > stages.indexOf(stage) ? "passed" : "pending",
            ...(revision > stages.indexOf(stage)
              ? { checkpointHash: "a".repeat(64) }
              : {}),
          },
        ]),
      ),
      verifiedPartArtifacts: {},
    });
    const program = {
      version: 1,
      units: "mm",
      classification: "review_required",
      name: "robot",
      assembly: { parts: [], mates: [] },
      parts: [],
      unresolved: [],
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, state: state() }), {
          status: 200,
        }),
      );
    stages.forEach((stage, index) =>
      fetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            state: (++revision, state()),
            draft: { output: { stage }, evidenceRefs: [`e:${stage}`] },
            decision: { disposition: "advance", reasons: [] },
            ...(index === 3 ? { program } : {}),
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      refineGenerationSession("robot", {
        fetcher,
        storage: store,
        runId: "multi",
      }),
    ).resolves.toMatchObject({ status: "ready", program });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(JSON.parse(store.values.get(GENERATION_SESSION_KEY)!)).toMatchObject(
      { revision: 4 },
    );
  });
});
