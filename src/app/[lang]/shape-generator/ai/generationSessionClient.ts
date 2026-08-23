import type {
  GenerationRunState,
  StageCompletion,
} from "@/lib/ai/generationRunState";
import type { AiAssemblyProgram } from "@/lib/ai/aiAssemblyProgram";
import type { PartFinalizationEvidence } from "@/lib/ai/finalizeGenerationRun";
import type { AssemblyAnimation } from "@/lib/assembly/assemblyAnimation";
import type { SelectionContext } from "@/lib/ai/selectionContext";
import type { FeatureEditIntent } from "./featureEditDispatcher";
import {
  REFINEMENT_STAGES,
  type RefinementStage,
} from "@/lib/ai/multiStageRefinement";
import type { GenerationCanonicalResponse } from "@/lib/ai/generationCanonicalResponse";
import type { GenerationTopologyRebindConfirmation } from "@/lib/ai/advanceGenerationRun";
import type { AdaptiveComplexProductExecutionPlan } from "@/lib/ai/adaptiveComplexProductExecution";
import type { JointEvidenceClaim } from "@/lib/reference/jointEvidenceReleaseGate";

export const GENERATION_SESSION_KEY = "nexyfab:ai-generation-state:v1";
export const GENERATION_CANONICAL_KEY = "nexyfab:ai-generation-canonical:v1";
export const GENERATION_EXECUTION_PLAN_KEY = "nexyfab:ai-complex-execution-plan:v1";
export const REFINEMENT_SESSION_KEY = "nexyfab:ai-refinement-session:v1";
type FetchLike = typeof fetch;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
let transitionQueue: Promise<unknown> = Promise.resolve();

function persistCanonical(
  storage: StorageLike,
  canonical: GenerationCanonicalResponse | undefined,
  context: string,
): void {
  if (
    !canonical ||
    canonical.schema !== "nexyfab.generation-canonical-response.v1" ||
    !/^[a-f0-9]{64}$/.test(canonical.contractHash)
  ) {
    throw new Error(`${context} returned no valid canonical parity contract.`);
  }
  storage.setItem(GENERATION_CANONICAL_KEY, JSON.stringify(canonical));
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("nexyfab:generation-canonical", { detail: canonical }),
    );
}

function persistExecutionPlan(storage: StorageLike, executionPlan: AdaptiveComplexProductExecutionPlan | undefined): void {
  if (!executionPlan) return;
  if (executionPlan.schema !== 'nexyfab.adaptive-complex-product-execution.v1' || executionPlan.objective !== 'complete_manufacturing_product') {
    throw new Error('Generation returned an invalid complex-product execution plan.');
  }
  storage.setItem(GENERATION_EXECUTION_PLAN_KEY, JSON.stringify(executionPlan));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexyfab:complex-execution-plan', { detail: executionPlan }));
}

export type BrowserRefinementResult =
  | { status: "ready"; state: GenerationRunState; program: AiAssemblyProgram }
  | {
      status: "needs_input" | "manual_review" | "stopped";
      state: GenerationRunState;
      stage: RefinementStage;
      reasons: string[];
    };

/** Runs one short server AI call per refinement attempt and checkpoints every response. */
export async function refineGenerationSession(
  request: string,
  options: {
    fetcher?: FetchLike;
    storage?: StorageLike;
    runId?: string;
    /** @deprecated Refinement attempts are fixed by the server release policy. */
    maxAttemptsPerStage?: number;
  } = {},
): Promise<BrowserRefinementResult> {
  const fetcher = options.fetcher ?? fetch,
    storage = options.storage ?? window.sessionStorage;
  const initialized = await post(fetcher, {
    action: "initialize",
    runId: options.runId ?? `web-refine-${crypto.randomUUID()}`,
  });
  if (!initialized.state)
    throw new Error("Refinement state initialization returned no state.");
  let state = initialized.state;
  const priorOutputs: Partial<Record<RefinementStage, unknown>> = {};
  const immutableEvidence = new Set<string>();
  const maxAttempts = 3;
  for (const stage of REFINEMENT_STAGES) {
    let feedback: string[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const priorCheckpointHashes = Object.fromEntries(
        REFINEMENT_STAGES.flatMap((item) =>
          state.stages[item].checkpointHash
            ? [[item, state.stages[item].checkpointHash!]]
            : [],
        ),
      );
      const response = await fetcher("/api/cad/v1/generation/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state,
          context: {
            request,
            stage,
            attempt,
            priorOutputs,
            priorCheckpointHashes,
            feedback,
            immutableEvidenceRefs: [...immutableEvidence].sort(),
          },
        }),
      });
      const json = (await response.json()) as {
        ok?: boolean;
        state?: GenerationRunState;
        draft?: { output?: unknown; evidenceRefs?: string[] };
        decision?: { disposition?: string; reasons?: string[] };
        program?: AiAssemblyProgram;
        message?: string;
      };
      if (!response.ok || !json.ok || !json.state || !json.decision)
        throw new Error(
          json.message ?? `Refinement ${stage} failed (${response.status}).`,
        );
      state = json.state;
      storage.setItem(GENERATION_SESSION_KEY, JSON.stringify(state));
      storage.setItem(
        REFINEMENT_SESSION_KEY,
        JSON.stringify({
          request,
          stage,
          attempt,
          priorOutputs,
          stateRevision: state.revision,
        }),
      );
      if (typeof window !== "undefined")
        window.dispatchEvent(
          new CustomEvent("nexyfab:generation-state", { detail: state }),
        );
      const disposition = json.decision.disposition,
        reasons = json.decision.reasons ?? [];
      if (disposition === "advance") {
        priorOutputs[stage] = json.draft?.output;
        json.draft?.evidenceRefs?.forEach((ref) => immutableEvidence.add(ref));
        if (stage === "part_programs") {
          if (!json.program)
            throw new Error(
              "Final refinement did not return a compiled assembly program.",
            );
          return { status: "ready", state, program: json.program };
        }
        break;
      }
      if (disposition === "refine_same_stage") {
        feedback = reasons;
        continue;
      }
      return {
        status:
          disposition === "request_input"
            ? "needs_input"
            : disposition === "manual_review"
              ? "manual_review"
              : "stopped",
        state,
        stage,
        reasons,
      };
    }
    if (state.stages[stage].status !== "passed")
      return {
        status: "stopped",
        state,
        stage,
        reasons: ["Refinement attempt budget was exhausted."],
      };
  }
  return {
    status: "stopped",
    state,
    stage: "part_programs",
    reasons: ["No compiled program was produced."],
  };
}

const operationKind = (intent: FeatureEditIntent): string =>
  intent.kind === "set_assembly_parts" ||
  intent.kind === "clear_all" ||
  intent.kind === "replace_pipeline"
    ? "set_part_suppressed"
    : "set_feature_parameter";

async function post(
  fetcher: FetchLike,
  body: unknown,
): Promise<{ ok?: boolean; state?: GenerationRunState; message?: string }> {
  const projectId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('project') : null;
  const requestBody = body && typeof body === 'object' && !Array.isArray(body) && projectId
    ? { ...(body as Record<string, unknown>), projectId }
    : body;
  const response = await fetcher("/api/cad/v1/generation/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const json = (await response.json()) as {
    ok?: boolean;
    state?: GenerationRunState;
    message?: string;
  };
  if (!response.ok || !json.ok)
    throw new Error(
      json.message ??
        `Generation state transition failed (${response.status}).`,
    );
  return json;
}

/** Serializes browser edit-state transitions so concurrent chat submissions cannot overwrite a newer revision. */
export function updateGenerationSessionForEdit(
  intents: FeatureEditIntent[],
  selection: SelectionContext | undefined,
  options: { fetcher?: FetchLike; storage?: StorageLike; runId?: string } = {},
): Promise<GenerationRunState> {
  const task = async () => {
    const fetcher = options.fetcher ?? fetch;
    const storage = options.storage ?? window.sessionStorage;
    let state: GenerationRunState | undefined;
    const stored = storage.getItem(GENERATION_SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as GenerationRunState;
        if (parsed.schema === "nexyfab.generation-run.v1") state = parsed;
      } catch {
        /* initialize below */
      }
    }
    if (!state)
      state = (
        await post(fetcher, {
          action: "initialize",
          runId: options.runId ?? `web-${crypto.randomUUID()}`,
        })
      ).state;
    if (!state)
      throw new Error("Generation state initialization returned no state.");
    const affectedPart =
      selection?.partInstanceId ?? selection?.bodyId ?? "main";
    const transitioned = await post(fetcher, {
      action: "invalidate_edit",
      state,
      transaction: {
        operations: intents.map((intent) => ({ kind: operationKind(intent) })),
        affected: { parts: [affectedPart] },
      },
    });
    if (!transitioned.state)
      throw new Error("Generation edit invalidation returned no state.");
    storage.setItem(GENERATION_SESSION_KEY, JSON.stringify(transitioned.state));
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent("nexyfab:generation-state", {
          detail: transitioned.state,
        }),
      );
    return transitioned.state;
  };
  const result = transitionQueue.then(task, task);
  transitionQueue = result.catch(() => undefined);
  return result;
}

/** Browser-authored pass records are forbidden. Initial stages must be
 * produced by refineGenerationSession so the server owns every checkpoint. */
export function recordGenerationSessionStages(
  completions: StageCompletion[],
  options: { fetcher?: FetchLike; storage?: StorageLike; runId?: string } = {},
): Promise<GenerationRunState> {
  const task = async () => {
    void completions;
    void options;
    throw new Error("SERVER_STAGE_EXECUTOR_REQUIRED");
  };
  const result = transitionQueue.then(task, task);
  transitionQueue = result.catch(() => undefined);
  return result;
}

/** Persists kernel, topology and assembly evidence produced by an applied AI product. */
export function advanceGenerationSession(
  program: AiAssemblyProgram,
  options: {
    fetcher?: FetchLike;
    storage?: StorageLike;
    allowedDoF?: number;
    topologyRebind?: GenerationTopologyRebindConfirmation;
  } = {},
): Promise<GenerationRunState> {
  const task = async () => {
    const fetcher = options.fetcher ?? fetch;
    const storage = options.storage ?? window.sessionStorage;
    const stored = storage.getItem(GENERATION_SESSION_KEY);
    if (!stored)
      throw new Error(
        "Generation state is missing; regenerate the product before applying it.",
      );
    const state = JSON.parse(stored) as GenerationRunState;
    if (state.schema !== "nexyfab.generation-run.v1")
      throw new Error("Stored generation state has an unsupported schema.");
    const response = await fetcher("/api/cad/v1/generation/advance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state,
        program,
        allowedDoF: options.allowedDoF ?? 0,
        ...(options.topologyRebind
          ? { topologyRebind: options.topologyRebind }
          : {}),
      }),
    });
    const json = (await response.json()) as {
      ok?: boolean;
      state?: GenerationRunState;
      canonical?: GenerationCanonicalResponse;
      executionPlan?: AdaptiveComplexProductExecutionPlan;
      message?: string;
    };
    if (!response.ok || !json.ok || !json.state) {
      if (json.state) storage.setItem(GENERATION_SESSION_KEY, JSON.stringify(json.state));
      throw new Error(
        json.message ?? `Generation advancement failed (${response.status}).`,
      );
    }
    storage.setItem(GENERATION_SESSION_KEY, JSON.stringify(json.state));
    persistCanonical(storage, json.canonical, "Generation advancement");
    persistExecutionPlan(storage, json.executionPlan);
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent("nexyfab:generation-state", { detail: json.state }),
      );
    return json.state;
  };
  const result = transitionQueue.then(task, task);
  transitionQueue = result.catch(() => undefined);
  return result;
}

/** Uses the same server-side motion/G0-G9/roundtrip finalizer as CLI and MCP. */
export function finalizeGenerationSession(
  program: AiAssemblyProgram,
  evidence: {
    motion: {
      required: boolean;
      animation?: AssemblyAnimation;
      frameStep?: number;
      jointEvidence?: JointEvidenceClaim;
    };
    parts: PartFinalizationEvidence[];
  },
  options: { fetcher?: FetchLike; storage?: StorageLike } = {},
): Promise<GenerationRunState> {
  const task = async () => {
    const fetcher = options.fetcher ?? fetch;
    const storage = options.storage ?? window.sessionStorage;
    const stored = storage.getItem(GENERATION_SESSION_KEY);
    if (!stored) throw new Error("Generation state is missing.");
    const state = JSON.parse(stored) as GenerationRunState;
    const response = await fetcher("/api/cad/v1/generation/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, program, ...evidence }),
    });
    const json = (await response.json()) as {
      ok?: boolean;
      state?: GenerationRunState;
      canonical?: GenerationCanonicalResponse;
      executionPlan?: AdaptiveComplexProductExecutionPlan;
      message?: string;
    };
    if (!response.ok || !json.ok || !json.state)
      throw new Error(
        json.message ?? `Generation finalization failed (${response.status}).`,
      );
    persistCanonical(storage, json.canonical, "Generation finalization");
    persistExecutionPlan(storage, json.executionPlan);
    storage.setItem(GENERATION_SESSION_KEY, JSON.stringify(json.state));
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent("nexyfab:generation-state", { detail: json.state }),
      );
    return json.state;
  };
  const result = transitionQueue.then(task, task);
  transitionQueue = result.catch(() => undefined);
  return result;
}
