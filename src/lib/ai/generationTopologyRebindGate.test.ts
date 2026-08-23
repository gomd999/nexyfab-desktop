// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  resolveGenerationTopologyRebind,
} from "./advanceGenerationRun";
import {
  bindGenerationProgram,
  createGenerationRun,
  recordGenerationStage,
} from "./generationRunState";
import { serverEvidenceSha256 } from "./serverEvidence";
import type { AiAssemblyProgram } from "./aiAssemblyProgram";
import { buildGenerationTopologyHistory, buildGenerationTopologyLineageEvidence } from "./generationTopologyLineage";

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
  name: "bound topology fixture",
  unresolved: [],
  assembly: {
    parts: [
      { id: "p1", name: "Part 1", partTemplateId: "p1", fixed: true, position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      { id: "p2", name: "Part 2", partTemplateId: "p2", fixed: false, position: { x: 20, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    ],
    mates: [{
      id: "m1",
      kind: "coincident",
      a: { partId: "p1", refId: "old-top", refKind: "plane" },
      b: { partId: "p2", refId: "f.cap.top", refKind: "plane" },
    }],
  },
  parts: [
    { instanceId: "p1", metadata: { partNumber: "P1", revision: "A", quantity: 1, source: "confirmed" }, featureTree: tree },
    { instanceId: "p2", metadata: { partNumber: "P2", revision: "A", quantity: 1, source: "confirmed" }, featureTree: tree },
  ],
};

function boundState() {
  let state = createGenerationRun("topology-evidence");
  for (const stage of ["intent", "decomposition", "interfaces"] as const) {
    state = recordGenerationStage(state, { stage, input: stage, output: true, status: "passed" });
  }
  state = recordGenerationStage(state, { stage: "part_programs", input: "part_programs", output: program, status: "passed" });
  state = bindGenerationProgram(state, serverEvidenceSha256(program));
  state = recordGenerationStage(state, { stage: "kernel", input: "kernel", output: true, status: "passed" });
  state = recordGenerationStage(state, { stage: "topology", input: "topology", output: true, status: "passed" });
  const history = buildGenerationTopologyHistory({
    state,
    programSha256: serverEvidenceSha256(program),
    parts: [],
    previousHistorySha256: "a".repeat(64),
  });
  state.serverTopologyHistory = history;
  const topologyEvidence = buildGenerationTopologyLineageEvidence({
    state,
    program,
    programSha256: serverEvidenceSha256(program),
    remaps: [
      { previousRef: "p1:old-top", mappedRef: "f.cap.top", quality: "derived", score: 0.91, reason: "persisted topology remap" },
      { previousRef: "p2:f.cap.top", mappedRef: "f.cap.top", quality: "persistent", score: 1, reason: "persisted topology remap" },
    ],
    source: "server-reconcile",
    historySha256: "a".repeat(64),
    currentHistorySha256: history.historySha256,
  });
  state.checkpointOutputs = {
    ...state.checkpointOutputs,
    topology: topologyEvidence,
  };
  return state;
}

const options = { commercial: true, serverEvidenceSha256 };

describe("server-derived generation topology rebind gate", () => {
  it("rejects forged readiness and blocker claims before consulting them", () => {
    expect(() => resolveGenerationTopologyRebind(boundState(), program, {
      assemblySolveReady: true,
      blockingMateIds: [],
      blockingInterfaceIds: [],
      confirmationRequiredIds: [],
      confirmedIds: ["mate:m1"],
    }, options)).toThrow("TOPOLOGY_CLIENT_DERIVED_FIELDS_FORBIDDEN");
  });

  it("holds commercial advancement when the persisted program evidence is missing", () => {
    const state = boundState();
    delete state.checkpointOutputs?.part_programs;
    delete state.checkpointOutputs?.topology;
    state.evidenceBindings = {};
    expect(() => resolveGenerationTopologyRebind(state, program, { confirmedIds: [] }, options))
      .toThrow("GENERATION_TOPOLOGY_SERVER_EVIDENCE_REQUIRED");
  });

  it("does not promote a bare current-reference remap to commercial evidence", () => {
    const state = boundState();
    state.checkpointOutputs = {
      ...state.checkpointOutputs,
      topology: {
        remaps: [{ previousRef: "p1:old-top", mappedRef: "f.cap.top", quality: "persistent", score: 1 }],
      },
    };
    expect(() => resolveGenerationTopologyRebind(state, program, { confirmedIds: [] }, options))
      .toThrow("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  });

  it("derives the remap and requires the matching explicit confirmation", () => {
    const result = resolveGenerationTopologyRebind(boundState(), program, { confirmedIds: ["mate:m1"] }, options);
    expect(result.source).toBe("server-checkpoint");
    expect(result.gate).toMatchObject({
      assemblySolveReady: true,
      blockingMateIds: [],
      blockingInterfaceIds: [],
      confirmationRequiredIds: ["mate:m1"],
      confirmedIds: ["mate:m1"],
    });
  });

  it("rejects a confirmation for an id the server did not derive", () => {
    expect(() => resolveGenerationTopologyRebind(boundState(), program, { confirmedIds: ["mate:other"] }, options))
      .toThrow("TOPOLOGY_CONFIRMATION_MISMATCH");
  });
});
