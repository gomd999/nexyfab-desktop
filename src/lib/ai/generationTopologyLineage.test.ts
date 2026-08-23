// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import type { AiAssemblyProgram } from "./aiAssemblyProgram";
import {
  advanceGenerationRun,
  prepareGenerationTopologyLineage,
  resolveGenerationTopologyRebind,
} from "./advanceGenerationRun";
import {
  bindGenerationProgram,
  createGenerationRun,
  recordGenerationStage,
} from "./generationRunState";
import { buildGenerationTopologyLineageEvidence, parseGenerationTopologyLineageEvidence, parseGenerationTopologyHistory } from "./generationTopologyLineage";
import { createServerGenerationState, loadServerGenerationState, resetGenerationStateStoreForTests, saveServerGenerationState } from "./generationStateStore";
import { serverEvidenceSha256 } from "./serverEvidence";

const tree = {
  nodes: [{
    id: "body",
    name: "Body",
    dependencies: [],
    payload: {
      kind: "extrude" as const,
      loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      depth: 10,
      direction: "one_sided" as const,
      mode: "add" as const,
    },
  }],
};

const program: AiAssemblyProgram = {
  version: 1,
  units: "mm",
  classification: "review_required",
  name: "server topology lineage fixture",
  unresolved: [],
  assembly: {
    parts: [
      { id: "p1", name: "Part 1", partTemplateId: "p1", fixed: true, position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      { id: "p2", name: "Part 2", partTemplateId: "p2", fixed: false, position: { x: 20, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    ],
    mates: [{
      id: "m1",
      kind: "coincident",
      a: { partId: "p1", refId: "f.cap.top", refKind: "plane" },
      b: { partId: "p2", refId: "f.cap.top", refKind: "plane" },
    }],
  },
  parts: [
    { instanceId: "p1", metadata: { partNumber: "P1", revision: "A", quantity: 1, source: "confirmed" }, featureTree: tree },
    { instanceId: "p2", metadata: { partNumber: "P2", revision: "A", quantity: 1, source: "confirmed" }, featureTree: tree },
  ],
};

function preparedState(candidate: AiAssemblyProgram = program): ReturnType<typeof createGenerationRun> {
  let state = createGenerationRun("topology-lineage-e2e");
  for (const stage of ["intent", "decomposition", "interfaces"] as const) {
    state = recordGenerationStage(state, { stage, input: stage, output: true, status: "passed" });
  }
  state = recordGenerationStage(state, { stage: "part_programs", input: "part_programs", output: candidate, status: "passed" });
  return bindGenerationProgram(state, serverEvidenceSha256(candidate));
}

describe("server topology lineage writer", () => {
  beforeEach(() => resetGenerationStateStoreForTests());

  it("writes a no-regeneration sidecar from exact server kernel evidence and advances after CAS persistence", async () => {
    const noConsumerProgram = { ...program, assembly: { ...program.assembly, mates: [] } };
    const state = preparedState(noConsumerProgram);
    await createServerGenerationState("owner:topology-lineage", state);
    const prepared = await prepareGenerationTopologyLineage(state, noConsumerProgram);
    expect(prepared.status).toBe("ready");
    expect(prepared.lineage).toMatchObject({ source: "no-regeneration", noRegeneration: true });
    const persisted = await saveServerGenerationState("owner:topology-lineage", prepared.state, state.revision);
    const loaded = await loadServerGenerationState("owner:topology-lineage", persisted.runId);
    const resolved = resolveGenerationTopologyRebind(loaded, noConsumerProgram, { confirmedIds: [] }, { commercial: true, serverEvidenceSha256 });
    expect(resolved.source).toBe("server-checkpoint");
    const advanced = await advanceGenerationRun(loaded, noConsumerProgram, async () => ({ ok: false, releaseReady: false, code: "EXPECTED_TEST_HOLD" }), 0, resolved.gate);
    expect(advanced.state.stages.kernel.status).toBe("passed");
    expect(parseGenerationTopologyLineageEvidence(loaded, noConsumerProgram, serverEvidenceSha256(noConsumerProgram), loaded.checkpointOutputs?.topology)?.source).toBe("no-regeneration");
  });

  it("persists a kernel-history baseline, then reconciles it into a server-derived gate", async () => {
    let state = preparedState();
    await createServerGenerationState("owner:topology-history", state);
    const baseline = await prepareGenerationTopologyLineage(state, program);
    expect(baseline.status).toBe("baseline-recorded");
    state = await saveServerGenerationState("owner:topology-history", baseline.state, state.revision);
    expect(parseGenerationTopologyHistory(state.serverTopologyHistory)).toMatchObject({ schema: "nexyfab.generation-topology-history.v1" });

    const reconciled = await prepareGenerationTopologyLineage(state, program);
    expect(reconciled.status).toBe("ready");
    expect(reconciled.lineage).toMatchObject({ source: "server-reconcile" });
    state = await saveServerGenerationState("owner:topology-history", reconciled.state, state.revision);
    const resolved = resolveGenerationTopologyRebind(state, program, { confirmedIds: [] }, { commercial: true, serverEvidenceSha256 });
    expect(resolved.source).toBe("server-checkpoint");
    expect(resolved.gate).toMatchObject({ assemblySolveReady: true, blockingMateIds: [], blockingInterfaceIds: [], confirmationRequiredIds: [] });
  });

  it("rejects tampered, stale, and partial server lineage before gate derivation", async () => {
    const state = preparedState();
    const prepared = await prepareGenerationTopologyLineage(state, program);
    expect(prepared.status).toBe("baseline-recorded");
    const tampered = structuredClone(prepared.state);
    const history = tampered.serverTopologyHistory as Record<string, unknown>;
    tampered.serverTopologyHistory = { ...history, historySha256: "a".repeat(64) };
    await expect(prepareGenerationTopologyLineage(tampered, program)).rejects.toThrow("GENERATION_TOPOLOGY_HISTORY_INVALID");

    const stale = structuredClone(prepared.state);
    const staleUnsigned = {
      ...Object.fromEntries(Object.entries(stale.serverTopologyHistory as Record<string, unknown>).filter(([key]) => key !== "historySha256")),
      programSha256: "b".repeat(64),
    };
    const staleHistory = { ...staleUnsigned, historySha256: serverEvidenceSha256(staleUnsigned) };
    stale.serverTopologyHistory = staleHistory;
    await expect(prepareGenerationTopologyLineage(stale, program)).rejects.toThrow("GENERATION_TOPOLOGY_HISTORY_STALE");

    const reconciled = await prepareGenerationTopologyLineage(prepared.state, program);
    expect(reconciled.status).toBe("ready");
    const staleCurrent = structuredClone(reconciled.state);
    staleCurrent.checkpointOutputs = {
      ...staleCurrent.checkpointOutputs,
      topology: buildGenerationTopologyLineageEvidence({
        state: staleCurrent,
        program,
        programSha256: serverEvidenceSha256(program),
        remaps: reconciled.lineage!.remaps,
        source: "server-reconcile",
        historySha256: reconciled.lineage!.historySha256,
        currentHistorySha256: "b".repeat(64),
      }),
    };
    expect(() => resolveGenerationTopologyRebind(staleCurrent, program, { confirmedIds: [] }, { commercial: true, serverEvidenceSha256 })).toThrow("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
    const partial = structuredClone(reconciled.state);
    const sidecar = structuredClone(reconciled.lineage!);
    const { interface: _interface, ...coverage } = sidecar.consumerCoverage;
    void _interface;
    sidecar.consumerCoverage = coverage as typeof sidecar.consumerCoverage;
    partial.checkpointOutputs = { ...partial.checkpointOutputs, topology: sidecar };
    expect(() => resolveGenerationTopologyRebind(partial, program, { confirmedIds: [] }, { commercial: true, serverEvidenceSha256 })).toThrow("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  });
});
