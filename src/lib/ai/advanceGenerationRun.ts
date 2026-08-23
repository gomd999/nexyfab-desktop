import type { AiAssemblyProgram } from "./aiAssemblyProgram";
import { validateAiAssemblyProgram } from "./aiAssemblyProgram";
import {
  recordGenerationStage,
  invalidateGenerationFrom,
  type GenerationRunState,
  type StageCompletion,
} from "./generationRunState";
import { compileProductDecomposition, type ProductDecompositionPlan } from "./productDecomposition";
import { collisionGeometryFromFeatureTree } from "@/lib/assembly/featureTreePreciseInterference";
import type { FeatureTreeCollisionGeometry } from "@/lib/assembly/featureTreePreciseInterference";
import { listPartRefs } from "@/lib/assembly/geometryResolver";
import { propagateTopologyReferences } from "@/lib/cad/topologyReferencePropagation";
import type { TopologyRemapResult } from "@/lib/cad/topologyRemap";
import {
  parseGenerationTopologyLineageEvidence,
  buildGenerationTopologyHistory,
  buildGenerationTopologyLineageEvidence,
  lineageRemapsFromHistory,
  parseGenerationTopologyHistory,
  topologyConsumerInventory,
  topologyHistoryPartsFromKernelOutput,
  topologyInterfacesForProgram,
  type GenerationTopologyEvidenceSource,
  type GenerationTopologyHistory,
  type GenerationTopologyLineageEvidence,
} from "./generationTopologyLineage";
import { serverEvidenceSha256 } from "./serverEvidence";
import {
  verifyAgenticCommercialQualificationReceipt,
  type AgenticCommercialQualificationReceipt,
  type AgenticCommercialQualificationVerification,
  type AgenticCommercialQualificationVerificationContext,
} from './agenticCommercialQualificationReceipt';

export type AssemblyVerificationResult = {
  ok?: boolean;
  releaseReady?: boolean;
  assemblyCertificate?: unknown;
  preciseInterference?: unknown;
  flaggedInterferences?: unknown[];
  verificationUnavailable?: string[];
  commercialReceipt?: AgenticCommercialQualificationReceipt;
  commercialReceiptVerification?: AgenticCommercialQualificationVerification;
  code?: string;
  message?: string;
};

export type GenerationAdvanceResult = {
  state: GenerationRunState;
  stoppedAt: "kernel" | "topology" | "assembly_solve" | "motion";
  assemblyVerification?: AssemblyVerificationResult;
  commercialReleaseReady: boolean;
  commercialReceiptVerification?: AgenticCommercialQualificationVerification;
  /** Route-level provenance; preview-local is never commercial evidence. */
  topologyEvidenceSource?: GenerationTopologyRebindEvidenceSource;
};

export type AssemblyVerifier = (input: {
  state: AiAssemblyProgram["assembly"];
  featureTrees: Record<
    string,
    AiAssemblyProgram["parts"][number]["featureTree"]
  >;
  localBoxes: Record<
    string,
    {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    }
  >;
  allowedDoF: number;
  preciseInterference: true;
}) => Promise<AssemblyVerificationResult>;

export type GenerationTopologyRebindGate = {
  assemblySolveReady: boolean;
  blockingMateIds: string[];
  blockingInterfaceIds: string[];
  confirmationRequiredIds: string[];
  confirmedIds?: string[];
};
/** The only topology value accepted from a browser request.  Readiness and
 * blocker lists are always reconstructed from server-owned evidence. */
export type GenerationTopologyRebindConfirmation = {
  confirmedIds?: string[];
};
export type GenerationTopologyRebindEvidenceSource =
  | "server-checkpoint"
  | "preview-local";
export type GenerationTopologyRebindResolution = {
  gate: GenerationTopologyRebindGate;
  program: AiAssemblyProgram;
  programSha256: string;
  source: GenerationTopologyRebindEvidenceSource;
  checkpointHash?: string;
  lineage?: GenerationTopologyLineageEvidence;
};
export type GenerationAdvanceOptions = { diagnosticOnly?: boolean; commercialReceiptContext?: AgenticCommercialQualificationVerificationContext };

const SAFE_GATE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_TOPOLOGY_GATE_IDS = 512;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isAiAssemblyProgram(value: unknown): value is AiAssemblyProgram {
  const candidate = objectRecord(value);
  if (!candidate || candidate.version !== 1 || candidate.units !== "mm" ||
      typeof candidate.name !== "string" || !Array.isArray(candidate.parts) ||
      !candidate.assembly || typeof candidate.assembly !== "object" ||
      !Array.isArray(candidate.unresolved)) return false;
  try {
    return validateAiAssemblyProgram(candidate as unknown as AiAssemblyProgram).length === 0;
  } catch {
    return false;
  }
}

function isProductDecompositionPlan(value: unknown): value is ProductDecompositionPlan {
  const candidate = objectRecord(value);
  return Boolean(candidate && candidate.version === 1 && candidate.units === "mm" &&
    typeof candidate.productName === "string" && Array.isArray(candidate.definitions) &&
    Array.isArray(candidate.instances) && Array.isArray(candidate.mates) &&
    Array.isArray(candidate.requirements) && Array.isArray(candidate.subassemblies) &&
    Array.isArray(candidate.observations) && Array.isArray(candidate.assumptions) &&
    Array.isArray(candidate.unresolved));
}

function checkpointProgramCandidates(state: GenerationRunState): unknown[] {
  const output = state.checkpointOutputs?.part_programs;
  const input = state.checkpointInputs?.part_programs;
  const candidates = [output, objectRecord(output)?.program, input, objectRecord(input)?.program];
  return candidates.filter((candidate, index) => candidate !== undefined && candidates.indexOf(candidate) === index);
}

function persistedProgram(state: GenerationRunState): AiAssemblyProgram | undefined {
  for (const candidate of checkpointProgramCandidates(state)) {
    if (isAiAssemblyProgram(candidate)) return structuredClone(candidate);
    if (isProductDecompositionPlan(candidate)) {
      const compiled = compileProductDecomposition(candidate);
      if (compiled.ok && isAiAssemblyProgram(compiled.program)) return structuredClone(compiled.program);
    }
  }
  return undefined;
}

function confirmedIdsFrom(value: unknown): { confirmedIds: string[]; issues: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { confirmedIds: [], issues: ["TOPOLOGY_REBIND_GATE_REQUIRED"] };
  }
  const record = value as Record<string, unknown>;
  const forbidden = ["assemblySolveReady", "blockingMateIds", "blockingInterfaceIds", "confirmationRequiredIds"]
    .filter((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (forbidden.length) return { confirmedIds: [], issues: ["TOPOLOGY_CLIENT_DERIVED_FIELDS_FORBIDDEN"] };
  const unknown = Object.keys(record).filter((key) => key !== "confirmedIds");
  if (unknown.length) return { confirmedIds: [], issues: ["TOPOLOGY_CLIENT_FIELDS_INVALID"] };
  if (record.confirmedIds === undefined) return { confirmedIds: [], issues: [] };
  if (!Array.isArray(record.confirmedIds) || record.confirmedIds.length > MAX_TOPOLOGY_GATE_IDS ||
      record.confirmedIds.some((id) => typeof id !== "string" || !SAFE_GATE_ID.test(id)) ||
      new Set(record.confirmedIds).size !== record.confirmedIds.length) {
    return { confirmedIds: [], issues: ["TOPOLOGY_CONFIRMED_IDS_INVALID"] };
  }
  return { confirmedIds: [...record.confirmedIds].sort(), issues: [] };
}

/** Validate the deliberately narrow browser-facing topology payload. */
export function validateGenerationTopologyRebindConfirmation(value: unknown): string[] {
  return confirmedIdsFrom(value).issues;
}

function topologyRefsByPart(program: AiAssemblyProgram): Map<string, ReadonlySet<string>> {
  const assemblyParts = new Map(program.assembly.parts.map((part) => [part.id, part]));
  return new Map(program.parts.map((part) => {
    const assemblyPart = assemblyParts.get(part.instanceId);
    return [part.instanceId, new Set(listPartRefs(part.featureTree, assemblyPart?.refs))] as const;
  }));
}

function remapsForProgram(program: AiAssemblyProgram): TopologyRemapResult[] {
  const refsByPart = topologyRefsByPart(program);
  const remaps = new Map<string, TopologyRemapResult>();
  const refs: Array<{ partId: string; refId: string }> = program.assembly.mates.flatMap((mate) => [mate.a, mate.b]);
  for (const item of topologyInterfacesForProgram(program)) {
    refs.push({ partId: item.occurrenceA, refId: item.datumA }, { partId: item.occurrenceB, refId: item.datumB });
  }
  for (const ref of refs) {
      const previousRef = `${ref.partId}:${ref.refId}`;
      if (remaps.has(previousRef)) continue;
      const available = refsByPart.get(ref.partId)?.has(ref.refId) === true;
      remaps.set(previousRef, available
        ? { previousRef, mappedRef: ref.refId, quality: "derived", score: 1, reason: "preview-local reference exists in the submitted feature-tree registry" }
        : { previousRef, quality: "broken", score: 0, reason: "preview-local reference is absent from the submitted feature-tree registry" });
  }
  return [...remaps.values()];
}

function persistedTopologyEvidence(
  state: GenerationRunState,
  program: AiAssemblyProgram,
  programSha256: string,
): { remaps: TopologyRemapResult[]; source: GenerationTopologyEvidenceSource; evidence: GenerationTopologyLineageEvidence } | undefined {
  return parseGenerationTopologyLineageEvidence(state, program, programSha256, state.checkpointOutputs?.topology);
}

function deriveTopologyGate(program: AiAssemblyProgram, confirmedIds: readonly string[], persistedRemaps?: readonly TopologyRemapResult[]): GenerationTopologyRebindGate {
  if (program.parts.length > MAX_TOPOLOGY_GATE_IDS || program.assembly.parts.length > MAX_TOPOLOGY_GATE_IDS ||
      program.assembly.mates.length > MAX_TOPOLOGY_GATE_IDS) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const interfaces = topologyInterfacesForProgram(program);
  if (interfaces.length > MAX_TOPOLOGY_GATE_IDS) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const propagated = propagateTopologyReferences({
    remaps: persistedRemaps ?? remapsForProgram(program),
    mates: program.assembly.mates,
    interfaces,
  });
  const gate: GenerationTopologyRebindGate = {
    assemblySolveReady: propagated.assemblySolveReady,
    blockingMateIds: propagated.blockingMateIds,
    blockingInterfaceIds: propagated.blockingInterfaceIds,
    confirmationRequiredIds: propagated.confirmationRequiredIds,
    confirmedIds: [...confirmedIds],
  };
  if ((gate.confirmedIds ?? []).some((id) => !gate.confirmationRequiredIds.includes(id))) {
    throw new Error("TOPOLOGY_CONFIRMATION_MISMATCH");
  }
  return gate;
}

/**
 * Reconstruct the topology gate from the accepted part-program checkpoint.
 * A browser may acknowledge a derived reference, but it cannot assert that
 * the reference is safe or that any blocker list is empty.  The local fallback
 * is intentionally labelled preview-only and is never eligible as commercial
 * evidence.
 */
export function resolveGenerationTopologyRebind(
  state: GenerationRunState,
  submittedProgram: AiAssemblyProgram,
  confirmation: unknown,
  options: { commercial: boolean; serverEvidenceSha256: (value: unknown) => string },
): GenerationTopologyRebindResolution {
  const parsed = confirmedIdsFrom(confirmation);
  if (parsed.issues.length) throw new Error(parsed.issues[0]);
  const submittedSha256 = options.serverEvidenceSha256(submittedProgram);
  const boundSha256 = state.evidenceBindings?.programSha256;
  if (boundSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(boundSha256) || boundSha256 !== submittedSha256)) {
    throw new Error("GENERATION_PROGRAM_BINDING_MISMATCH");
  }

  const checkpoint = persistedProgram(state);
  const checkpointHash = state.stages.part_programs.checkpointHash;
  const hasCheckpointEvidence = state.stages.part_programs.status === "passed" && checkpoint !== undefined &&
    typeof checkpointHash === "string" && /^[a-f0-9]{64}$/.test(checkpointHash);
  if (checkpoint) {
    const checkpointSha256 = options.serverEvidenceSha256(checkpoint);
    if (checkpointSha256 !== submittedSha256) throw new Error("GENERATION_PROGRAM_BINDING_MISMATCH");
    if (boundSha256 !== undefined && boundSha256 !== checkpointSha256) throw new Error("GENERATION_PROGRAM_EVIDENCE_INVALID");
  }
  if (options.commercial && (!hasCheckpointEvidence || boundSha256 === undefined)) {
    throw new Error("GENERATION_TOPOLOGY_SERVER_EVIDENCE_REQUIRED");
  }
  const program = checkpoint ?? submittedProgram;
  const source: GenerationTopologyRebindEvidenceSource = hasCheckpointEvidence && boundSha256 !== undefined
    ? "server-checkpoint"
    : "preview-local";
  const topologyEvidence = persistedTopologyEvidence(state, program, checkpoint ? options.serverEvidenceSha256(program) : submittedSha256);
  if (options.commercial && !topologyEvidence) throw new Error("GENERATION_TOPOLOGY_SERVER_EVIDENCE_REQUIRED");
  const gate = deriveTopologyGate(program, parsed.confirmedIds, topologyEvidence?.remaps);
  return { gate, program, programSha256: checkpoint ? options.serverEvidenceSha256(program) : submittedSha256, source: topologyEvidence && source === "server-checkpoint" ? "server-checkpoint" : "preview-local", ...(hasCheckpointEvidence ? { checkpointHash } : {}), ...(topologyEvidence ? { lineage: topologyEvidence.evidence } : {}) };
}

export type GenerationTopologyPreparationResult = {
  state: GenerationRunState;
  status: "ready" | "baseline-recorded" | "unavailable";
  lineage?: GenerationTopologyLineageEvidence;
};

function topologyConsumerCount(program: AiAssemblyProgram): number {
  return Object.values(topologyConsumerInventory(program)).reduce((count, items) => count + items.length, 0);
}

/**
 * Server regeneration preflight. It runs the same exact OCCT kernel/topology
 * path as advanceGenerationRun, persists a kernel history baseline on the
 * first pass, and writes a rebind sidecar only after a previous baseline can
 * be reconciled. No browser-supplied snapshots or remaps enter this path.
 */
export async function prepareGenerationTopologyLineage(
  initial: GenerationRunState,
  program: AiAssemblyProgram,
): Promise<GenerationTopologyPreparationResult> {
  const programSha256 = serverEvidenceSha256(program);
  let previousHistory: GenerationTopologyHistory | undefined;
  try {
    previousHistory = parseGenerationTopologyHistory(initial.serverTopologyHistory);
  } catch (error) {
    if (error instanceof Error && error.message === "GENERATION_TOPOLOGY_HISTORY_INVALID") throw error;
    throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
  }
  if (previousHistory) {
    if (previousHistory.runId !== initial.runId || previousHistory.programSha256 !== programSha256 ||
        previousHistory.revision !== initial.revision ||
        previousHistory.programCheckpointHash !== initial.stages.part_programs.checkpointHash ||
        previousHistory.kernelCheckpointHash !== initial.stages.kernel.checkpointHash ||
        previousHistory.topologyCheckpointHash !== initial.stages.topology.checkpointHash) {
      throw new Error("GENERATION_TOPOLOGY_HISTORY_STALE");
    }
  }

  const preflight = await advanceGenerationRun(
    initial,
    program,
    async () => ({ ok: false, releaseReady: false, code: "TOPOLOGY_PREFLIGHT_ONLY" }),
    0,
    {
      assemblySolveReady: false,
      blockingMateIds: ["server-topology-preflight"],
      blockingInterfaceIds: [],
      confirmationRequiredIds: [],
      confirmedIds: [],
    },
  );
  if (preflight.state.stages.kernel.status !== "passed" || preflight.state.stages.topology.status !== "passed") {
    return { state: preflight.state, status: "unavailable" };
  }
  const staged = invalidateGenerationFrom(preflight.state, "assembly_solve");
  const currentParts = topologyHistoryPartsFromKernelOutput(staged.checkpointOutputs?.kernel);
  const currentHistory = buildGenerationTopologyHistory({
    state: staged,
    programSha256,
    parts: currentParts,
    ...(previousHistory ? { previousHistorySha256: previousHistory.historySha256 } : {}),
    revision: staged.revision + 1,
  });
  let source: GenerationTopologyEvidenceSource | undefined;
  let remaps: TopologyRemapResult[] = [];
  if (previousHistory) {
    remaps = lineageRemapsFromHistory(previousHistory, currentParts);
    source = "server-reconcile";
  } else if (topologyConsumerCount(program) === 0) {
    source = "no-regeneration";
  }

  const nextRevision = staged.revision + 1;
  const next = structuredClone(staged);
  next.revision = nextRevision;
  next.serverTopologyHistory = currentHistory;
  if (!source) return { state: next, status: "baseline-recorded" };
  const lineage = buildGenerationTopologyLineageEvidence({
    state: staged,
    program,
    programSha256,
    remaps,
    source,
    historySha256: previousHistory?.historySha256 ?? currentHistory.historySha256,
    currentHistorySha256: currentHistory.historySha256,
    revision: nextRevision,
  });
  next.checkpointOutputs = { ...next.checkpointOutputs, topology: lineage };
  return { state: next, status: "ready", lineage };
}

/** Rebind a persisted sidecar to the final CAS revision after advance stages. */
export function refreshGenerationTopologyLineage(
  state: GenerationRunState,
  program: AiAssemblyProgram,
  lineage: GenerationTopologyLineageEvidence,
): GenerationRunState {
  const validationState = structuredClone(state);
  validationState.revision = lineage.revision;
  validationState.stages.part_programs.checkpointHash = lineage.programCheckpointHash;
  validationState.stages.kernel.checkpointHash = lineage.kernelCheckpointHash;
  validationState.stages.topology.checkpointHash = lineage.topologyCheckpointHash;
  const parsed = parseGenerationTopologyLineageEvidence(validationState, program, lineage.programSha256, lineage);
  if (!parsed) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const refreshed = buildGenerationTopologyLineageEvidence({
    state,
    program,
    programSha256: lineage.programSha256,
    remaps: parsed.remaps,
    source: parsed.source,
    historySha256: lineage.historySha256,
    currentHistorySha256: lineage.currentHistorySha256,
    revision: state.revision,
  });
  const next = structuredClone(state);
  next.checkpointOutputs = { ...next.checkpointOutputs, topology: refreshed };
  return next;
}

/** Validate the server-side topology/reference gate before doing any work. */
export function validateGenerationTopologyRebindGate(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['TOPOLOGY_REBIND_GATE_REQUIRED'];
  const gate = value as Partial<GenerationTopologyRebindGate>;
  const issues: string[] = [];
  if (typeof gate.assemblySolveReady !== 'boolean') issues.push('TOPOLOGY_ASSEMBLY_SOLVE_READINESS_REQUIRED');
  for (const key of ['blockingMateIds', 'blockingInterfaceIds', 'confirmationRequiredIds'] as const) {
    const ids = gate[key];
    if (!Array.isArray(ids) || ids.length > MAX_TOPOLOGY_GATE_IDS || ids.some(id => typeof id !== 'string' || !SAFE_GATE_ID.test(id)) || (Array.isArray(ids) && new Set(ids).size !== ids.length)) issues.push(`TOPOLOGY_${key.replace(/Ids$/, '').toUpperCase()}_IDS_INVALID`);
  }
  if (gate.confirmedIds !== undefined && (!Array.isArray(gate.confirmedIds) || gate.confirmedIds.length > MAX_TOPOLOGY_GATE_IDS || gate.confirmedIds.some(id => typeof id !== 'string' || !SAFE_GATE_ID.test(id)) || new Set(gate.confirmedIds).size !== gate.confirmedIds.length)) issues.push('TOPOLOGY_CONFIRMED_IDS_INVALID');
  const required = Array.isArray(gate.confirmationRequiredIds) ? gate.confirmationRequiredIds : [];
  const confirmed = new Set(Array.isArray(gate.confirmedIds) ? gate.confirmedIds : []);
  for (const id of confirmed) if (!required.includes(id)) issues.push('TOPOLOGY_CONFIRMED_ID_NOT_REQUIRED');
  return [...new Set(issues)];
}

/** Exact BRep/STEP evidence is the precision gate; preview meshes cannot be
 * promoted by an advance request even when their mesh happens to be watertight. */
function exactPrecisionGatePassed(collision: FeatureTreeCollisionGeometry): boolean {
  const exact = collision.exactCad;
  return collision.available === true
    && collision.source === 'occt-exact'
    && exact?.kernel === 'OCCT'
    && exact.valid === true
    && exact.solidCount === 1
    && exact.freeBoundaryEdgeCount === 0
    && exact.nonManifoldEdgeCount === 0
    && exact.stepRoundTripFreeBoundaryEdgeCount === 0
    && exact.stepRoundTripNonManifoldEdgeCount === 0
    && /^[a-f0-9]{64}$/.test(exact.stepSha256)
    && Number.isFinite(exact.stepRoundTripVolumeRelError);
}

/**
 * Advances an AI generation run using real tessellated/OCCT part evidence.
 * Optional downstream gates are intentionally not guessed: motion remains
 * pending until the design supplies a governed motion study.
 */
export async function advanceGenerationRun(
  initial: GenerationRunState,
  program: AiAssemblyProgram,
  verifyAssembly: AssemblyVerifier,
  allowedDoF = 0,
  topologyRebind?: GenerationTopologyRebindGate,
  options: GenerationAdvanceOptions = {},
): Promise<GenerationAdvanceResult> {
  if (initial.stages.part_programs.status !== "passed") {
    throw new Error("part_programs must pass before geometry advancement.");
  }
  const issues = validateAiAssemblyProgram(program);
  if (issues.length) {
    const completion: StageCompletion = {
      stage: "kernel",
      input: program.parts.map((part) => part.featureTree),
      status: "failed",
      errorCodes: ["INVALID_AI_ASSEMBLY_PROGRAM"],
      unresolved: issues.map((issue) => `${issue.path}: ${issue.message}`),
      affectedPartIds: program.parts.map((part) => part.instanceId),
    };
    return {
      state: recordGenerationStage(initial, completion),
      stoppedAt: "kernel",
      commercialReleaseReady: false,
    };
  }

  if ((program.classification !== 'review_required' || program.unresolved.length > 0) && options.diagnosticOnly !== true) {
    const unresolved = program.unresolved.length ? program.unresolved : ['Authoritative product inputs are required before exact geometry generation.'];
    return {
      state: recordGenerationStage(initial, {
        stage: 'kernel',
        input: { classification: program.classification, unresolved: program.unresolved },
        output: { geometryStarted: false },
        status: 'blocked',
        errorCodes: ['AUTHORITATIVE_INPUT_REQUIRED'],
        unresolved,
        affectedPartIds: program.parts.filter(part => part.metadata.source === 'assumed').map(part => part.instanceId),
        metrics: { unresolvedInputs: unresolved.length },
      }),
      stoppedAt: 'kernel',
      commercialReleaseReady: false,
    };
  }

  const built = await Promise.all(
    program.parts.map(async (part) => ({
      part,
      collision: await collisionGeometryFromFeatureTree(
        part.instanceId,
        part.featureTree,
        { requireExact: true },
      ),
    })),
  );
  const unavailable = built.filter((item) => !item.collision.available);
  // Keep ordinary geometry-unavailable failures on their existing contract;
  // the precision code is reserved for a mesh that was available but lacked
  // the required OCCT/STEP proof.
  const precisionUnavailable = built.filter((item) => item.collision.available && !exactPrecisionGatePassed(item.collision));
  const affectedKernelParts = [...new Set([
    ...unavailable.map((item) => item.part.instanceId),
    ...precisionUnavailable.map((item) => item.part.instanceId),
  ])];
  const kernelOutput = built.map(({ part, collision }) => ({
    partId: part.instanceId,
    available: collision.available,
    source: collision.source,
    reason: collision.reason,
    exactCad: collision.exactCad ?? null,
    bodies: collision.geometry.bodies.map((body) => ({
      bodyId: body.bodyId,
      volumeMm3: body.volumeMm3,
    })),
    totalVolumeMm3: collision.geometry.totalVolumeMm3,
  }));
  let state = recordGenerationStage(initial, {
    stage: "kernel",
    input: program.parts.map((part) => ({
      partId: part.instanceId,
      tree: part.featureTree,
    })),
    output: kernelOutput,
    status: unavailable.length || precisionUnavailable.length ? "failed" : "passed",
    errorCodes: [
      ...(unavailable.length ? ["PART_GEOMETRY_UNAVAILABLE"] : []),
      ...(precisionUnavailable.length ? ["EXACT_GEOMETRY_REQUIRED"] : []),
    ],
    unresolved: built.filter(item => unavailable.includes(item) || precisionUnavailable.includes(item)).map(
      (item) => item.collision.reason ?? `${item.part.instanceId}: exact OCCT/STEP precision evidence unavailable`,
    ),
    affectedPartIds: affectedKernelParts,
    metrics: {
      parts: built.length,
      availableParts: built.length - unavailable.length,
      exactPrecisionParts: built.length - precisionUnavailable.length,
      diagnosticOnly: options.diagnosticOnly === true ? 1 : 0,
    },
    warnings: options.diagnosticOnly === true ? ['Concept geometry was evaluated for diagnostics only and is not production evidence.'] : [],
  });
  if (unavailable.length || precisionUnavailable.length) return { state, stoppedAt: "kernel", commercialReleaseReady: false };

  const invalidTopology = built.filter(
    ({ collision }) =>
      !collision.geometry.bbox ||
      !exactPrecisionGatePassed(collision) ||
      collision.geometry.bodies.some(
        (body) =>
          !body.poly ||
          !body.watertight ||
          body.nonManifoldEdges > 0 ||
          body.poly.faces.length === 0,
      ),
  );
  const topologyOutput = built.map(({ part, collision }) => ({
    partId: part.instanceId,
    exactStepSha256: collision.exactCad ? collision.exactCad.stepSha256 : null,
    bodies: collision.geometry.bodies.map((body) => ({
      bodyId: body.bodyId,
      watertight: body.watertight,
      nonManifoldEdges: body.nonManifoldEdges,
      flippedFaces: body.flippedFaces,
      vertices: body.poly?.vertices.length ?? 0,
      faces: body.poly?.faces.length ?? 0,
    })),
  }));
  state = recordGenerationStage(state, {
    stage: "topology",
    input: kernelOutput,
    output: topologyOutput,
    status: invalidTopology.length ? "failed" : "passed",
    errorCodes: invalidTopology.length ? ["INVALID_BODY_TOPOLOGY"] : [],
    affectedPartIds: invalidTopology.map((item) => item.part.instanceId),
    metrics: {
      bodies: built.reduce(
        (sum, item) => sum + item.collision.geometry.bodies.length,
        0,
      ),
    },
  });
  if (invalidTopology.length) return { state, stoppedAt: "topology", commercialReleaseReady: false };

  if (topologyRebind) {
    const confirmed = new Set(topologyRebind.confirmedIds ?? []);
    const unconfirmed = topologyRebind.confirmationRequiredIds.filter(
      (id) => !confirmed.has(id),
    );
    if (!topologyRebind.assemblySolveReady || topologyRebind.blockingMateIds.length || topologyRebind.blockingInterfaceIds.length || unconfirmed.length) {
      const errorCodes = [
        ...(!topologyRebind.assemblySolveReady
          ? ["ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED"]
          : []),
        ...(unconfirmed.length
          ? ["ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED"]
          : []),
      ];
      state = recordGenerationStage(state, {
        stage: "assembly_solve",
        input: { assembly: program.assembly, allowedDoF, topologyRebind },
        output: {
          blocked: true,
          blockingMateIds: topologyRebind.blockingMateIds,
          blockingInterfaceIds: topologyRebind.blockingInterfaceIds,
          unconfirmed,
        },
        status: "failed",
        errorCodes,
        unresolved: [
          ...topologyRebind.blockingMateIds.map(
            (id) => `mate topology review required: ${id}`,
          ),
          ...topologyRebind.blockingInterfaceIds.map(
            (id) => `interface topology review required: ${id}`,
          ),
          ...unconfirmed.map(
            (id) => `derived topology confirmation required: ${id}`,
          ),
        ],
        affectedPartIds: program.parts.map((part) => part.instanceId),
        metrics: {
          blockingMates: topologyRebind.blockingMateIds.length,
          blockingInterfaces: topologyRebind.blockingInterfaceIds.length,
          unconfirmedDerived: unconfirmed.length,
        },
      });
      return { state, stoppedAt: "assembly_solve", commercialReleaseReady: false };
    }
  }

  const featureTrees = Object.fromEntries(
    program.parts.map((part) => [part.instanceId, part.featureTree]),
  );
  const localBoxes = Object.fromEntries(
    built.map(({ part, collision }) => {
      const bbox = collision.geometry.bbox!;
      const [min, max] = [bbox.min, bbox.max];
      return [
        part.instanceId,
        {
          min: { x: min[0], y: min[1], z: min[2] },
          max: { x: max[0], y: max[1], z: max[2] },
        },
      ];
    }),
  );
  const verification = await verifyAssembly({
    state: program.assembly,
    featureTrees,
    localBoxes,
    allowedDoF,
    preciseInterference: true,
  });
  const commercialReceiptVerification = options.commercialReceiptContext
    ? verifyAgenticCommercialQualificationReceipt(verification.commercialReceipt, options.commercialReceiptContext)
    : { ok: false, releaseReady: false, status: 'HOLD' as const, targetSha256: '', issues: ['commercial_receipt_context_missing'] };
  const assemblyPassed =
    verification.ok === true && verification.releaseReady === true;
  state = recordGenerationStage(state, {
    stage: "assembly_solve",
    input: { assembly: program.assembly, allowedDoF },
    output: verification,
    status: assemblyPassed ? "passed" : "failed",
    errorCodes: assemblyPassed
      ? []
      : [verification.code ?? "ASSEMBLY_NOT_RELEASE_READY"],
    unresolved: assemblyPassed
      ? []
      : [
          verification.message ??
            "Assembly certificate did not reach release-ready status.",
        ],
    affectedPartIds: assemblyPassed
      ? []
      : program.parts.map((part) => part.instanceId),
    metrics: {
      flaggedInterferences: verification.flaggedInterferences?.length ?? 0,
    },
  });
  return {
    state,
    stoppedAt: assemblyPassed ? "motion" : "assembly_solve",
    assemblyVerification: verification,
    commercialReleaseReady: assemblyPassed && commercialReceiptVerification.releaseReady,
    commercialReceiptVerification,
  };
}
