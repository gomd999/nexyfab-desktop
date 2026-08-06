import {
  GENERATION_STAGES,
  generationArtifactHash,
  lastVerifiedCheckpoint,
  type GenerationRunStage,
  type GenerationRunState,
  type GenerationRunStatus,
} from "./generationRunState";

export type GenerationCanonicalInput = {
  state: GenerationRunState;
  stoppedAt: GenerationRunStage | "complete";
};

export interface GenerationCanonicalResponse {
  schema: "nexyfab.generation-canonical-response.v1";
  runId: string;
  revision: number;
  status: "pass" | "fail" | "not_run" | "blocked";
  stoppedAt: GenerationCanonicalInput["stoppedAt"];
  releaseReady: boolean;
  codes: string[];
  unresolvedCount: number;
  unresolvedByStage: Array<{ stage: GenerationRunStage; count: number }>;
  affectedPartIds: string[];
  verifiedPartArtifacts: Array<{
    partId: string;
    artifactHash: string;
    verifiedAtStage: string;
  }>;
  lastCheckpoint: { stage: string; checkpointHash: string } | null;
  quoteOrRfqSideEffects: false;
  contractHash: string;
}

const canonicalStatus = (
  stoppedAt: GenerationCanonicalInput["stoppedAt"],
  statuses: GenerationRunStatus[],
): GenerationCanonicalResponse["status"] => {
  if (stoppedAt === "complete") return "pass";
  if (statuses.includes("failed")) return "fail";
  if (statuses.includes("blocked")) return "blocked";
  return "not_run";
};

/** Stable cross-surface subset. Large reports and timestamps stay available in
 * the full response but cannot make Web/API/CLI/MCP parity hashes diverge. */
export function buildGenerationCanonicalResponse(
  result: GenerationCanonicalInput,
): GenerationCanonicalResponse {
  const state = result.state;
  const records = GENERATION_STAGES.map((stage) => state.stages[stage]);
  const core = {
    schema: "nexyfab.generation-canonical-response.v1" as const,
    runId: state.runId,
    revision: state.revision,
    status: canonicalStatus(
      result.stoppedAt,
      records.map((record) => record.status),
    ),
    stoppedAt: result.stoppedAt,
    releaseReady: result.stoppedAt === "complete",
    codes: [...new Set(records.flatMap((record) => record.errorCodes))].sort(),
    unresolvedCount: records.reduce(
      (sum, record) => sum + record.unresolved.length,
      0,
    ),
    unresolvedByStage: records
      .filter((record) => record.unresolved.length > 0)
      .map((record) => ({
        stage: record.stage,
        count: record.unresolved.length,
      })),
    affectedPartIds: [
      ...new Set(records.flatMap((record) => record.affectedPartIds)),
    ].sort(),
    verifiedPartArtifacts: Object.entries(state.verifiedPartArtifacts)
      .map(([partId, artifact]) => ({ partId, ...artifact }))
      .sort((a, b) => a.partId.localeCompare(b.partId)),
    lastCheckpoint: lastVerifiedCheckpoint(state) ?? null,
    quoteOrRfqSideEffects: false as const,
  };
  return { ...core, contractHash: generationArtifactHash(core) };
}
