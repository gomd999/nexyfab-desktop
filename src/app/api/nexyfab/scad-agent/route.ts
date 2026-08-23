/**
 * POST /api/nexyfab/scad-agent
 *
 * Runs one user turn through the SCAD coding agent. Streams events as
 * Server-Sent Events so the browser can render incremental progress
 * (model thinking, tool calls firing, render results coming back).
 *
 * Body: { userPrompt: string, session?: AgentSession }
 *   - First call: omit `session` to start fresh.
 *   - Subsequent calls: pass back `session` from the previous SSE `done`
 *     event to continue the conversation.
 *
 * Response: SSE stream. Each event is `data: <JSON AgentEvent>\n\n`.
 * Runtime BRep handles are worker-local and never durable client authority;
 * continuations rehydrate canonical artifact refs or fail closed.
 *
 * Plan gating: free + per-user $ budget. Same gates as scad-intent-from-nl.
 */
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { recordPromptCall } from '@/lib/ai/telemetry';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';
import { captureServerError } from '@/lib/error-capture';
import { makeTools } from '@/lib/ai/scad-agent/tools';
import { SERVER_HOST_ADAPTERS, makeServerVisionAdapter } from '@/lib/ai/scad-agent/serverAdapters';
import {
  runRepairLoop,
  makeServerAiFamilies,
  makeSpecGateEvaluator,
  makeVisionCritic,
} from '@/lib/ai/scad-agent/repairLoop';
import type { AgentEvent, AgentSession } from '@/lib/ai/scad-agent/types';
import { signAgentSession, verifyAgentSession } from '@/lib/ai/scad-agent/sessionIntegrity';
import { resolveRuntimeCodegenModel } from '@/lib/ai/codegenModelRuntime';
import { runLunaDesignPreflight } from '@/lib/ai/lunaDesignSidecars';
import { resolveVisionSelection } from '@/lib/ai/vision';
import { isPrecisionCadAgentTaskBoundToOwnership, precisionCadAgentTaskMatchesPlan, validatePrecisionCadAgentTask } from '@/lib/ai/precisionCadAgentTask';
import { precisionCadGenerationBindingMatchesState } from '@/lib/ai/precisionCadAgentTaskServer';
import { buildAdaptiveComplexProductExecutionPlan } from '@/lib/ai/adaptiveComplexProductExecution';
import { loadServerGenerationState } from '@/lib/ai/generationStateStore';
import { generationRequestOwner } from '@/lib/ai/generationRequestOwner';
import { loadCommercialGenerationRouteRun } from '@/lib/ai/commercialGenerationRouteState';
import { createCadToolCallAuthorizer } from '@/lib/ai/cadToolAuthorization';
import { cadSelectionOwnershipFromSession } from '@/lib/ai/cadCapabilityRegistry';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { hydratePrecisionCadSessionRuntime, stripPrecisionCadRuntimeForTransport, CanonicalCadHydrationError } from '@/lib/cad/canonicalCadBrepHydration';
import { issueBrepHandleAccessToken } from '@/lib/ai/scad-agent/brepHandleAccessToken';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BODY_LIMIT_BYTES = 200_000;
const PRECISION_SESSION_MAX_AGE_MS = 15 * 60 * 1000;
// The registry/cache is process-local; reuse one identity for this process so
// same-worker continuations can hit its cache. It is never signed or sent to
// the browser, and another replica/restart must rehydrate from artifacts.
const SCAD_AGENT_RUNTIME_IDENTITY = `scad:${process.pid}:${randomUUID()}`;
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;
function noStoreResponse(response: Response): Response {
  response.headers.set('Cache-Control', NO_STORE_HEADERS['Cache-Control']);
  return response;
}
function jsonNoStore(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, { ...init, headers: { ...init.headers, ...NO_STORE_HEADERS } });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return jsonNoStore({ error: 'Forbidden', code: 'INVALID_ORIGIN' }, { status: 403 });
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return noStoreResponse(planCheck.response);
  if (planCheck.apiKey && !planCheck.apiKey.scopes.includes('write:projects')) {
    return jsonNoStore({
      error: 'Insufficient API key scope',
      code: 'INSUFFICIENT_API_KEY_SCOPE',
      requiredScope: 'write:projects',
    }, { status: 403 });
  }

  // P1 — Rate limit (parity with shape-chat / openscad-render). Tight cap
  // because each agent run can fan out to many model + render calls.
  const ip = getTrustedClientIp(req.headers);
  const rl = await rateLimitAsync(`scad-agent:${ip}:${planCheck.userId}`, 30, 3_600_000);
  if (!rl.allowed) {
    return jsonNoStore({ error: 'Rate limit exceeded', code: 'RATE_LIMIT' }, { status: 429 });
  }

  // Per-user $ budget gate fires next — shared with shape-chat / NL-intent.
  const budget = await checkUserBudget(planCheck.userId, planCheck.orgId);
  if (!budget.ok) {
    return jsonNoStore({
      error: `Daily AI spend limit reached ($${budget.limitUsd}). Try again later.`,
      code: 'COST_BUDGET',
      usedCents: budget.usedCents,
      limitUsd: budget.limitUsd,
      resetAtMs: budget.resetAtMs,
    }, { status: 402 });
  }

  let body: {
    userPrompt?: unknown;
    session?: unknown;
    modelId?: unknown;
    executionMode?: unknown;
    designDomain?: unknown;
    precisionTask?: unknown;
  };
  try {
    body = await readBoundedJson<typeof body>(req, BODY_LIMIT_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') {
      return jsonNoStore({ error: 'request body too large' }, { status: 413 });
    }
    return jsonNoStore({ error: 'invalid JSON body' }, { status: 400 });
  }

  const userPrompt = typeof body.userPrompt === 'string' ? body.userPrompt.trim() : '';
  if (!userPrompt) {
    return jsonNoStore({ error: 'userPrompt is required' }, { status: 400 });
  }
  if (userPrompt.length > 4000) {
    return jsonNoStore({ error: 'userPrompt too long (max 4000 chars)' }, { status: 413 });
  }
  const executionMode = body.executionMode === 'ai_design' || body.executionMode === 'precision_cad'
    ? body.executionMode
    : undefined;
  if (body.executionMode !== undefined && !executionMode) {
    return jsonNoStore({ error: 'executionMode must be ai_design or precision_cad' }, { status: 400 });
  }
  const designDomain = typeof body.designDomain === 'string' ? body.designDomain.trim().slice(0, 64) : '';
  const precisionTask = body.precisionTask === undefined ? undefined : validatePrecisionCadAgentTask(body.precisionTask);
  if (body.precisionTask !== undefined && !precisionTask) {
    return jsonNoStore({ error: 'precisionTask is invalid' }, { status: 400 });
  }
  if (precisionTask && executionMode !== 'precision_cad') {
    return jsonNoStore({ error: 'precisionTask requires precision_cad executionMode' }, { status: 400 });
  }
  // Precision mode is a project mutation contract, not a free-form CAD
  // prompt.  Refuse an unbound request before model selection or quota
  // consumption; otherwise the route could reach the scoped authorizer with
  // no signed project target to authorize.
  if (executionMode === 'precision_cad' && (body.session === undefined || !precisionTask)) {
    return jsonNoStore({
      error: 'precision_cad requires a signed project session and bound precisionTask',
      code: 'CAD_PROJECT_BINDING_REQUIRED',
    }, { status: 409 });
  }
  if (executionMode === 'precision_cad' && !precisionTask?.generationBinding) {
    return jsonNoStore({
      error: 'precision_cad requires a server-bound generation task',
      code: 'CAD_GENERATION_BINDING_REQUIRED',
    }, { status: 409 });
  }

  const codegen = await resolveRuntimeCodegenModel(
    typeof body.modelId === 'string' ? body.modelId : undefined,
    planCheck.plan,
  );
  if (!codegen.ok) {
    return jsonNoStore({
      error: codegen.code === 'MODEL_PLAN_LOCKED' ? 'Plan upgrade required for this AI model' : 'Unknown AI model',
      code: codegen.code,
      requestedModel: codegen.requestedId,
      ...(codegen.requiredTier ? { requiredTier: codegen.requiredTier } : {}),
    }, { status: codegen.code === 'MODEL_PLAN_LOCKED' ? 403 : 400 });
  }

  // The session is opaque from the API's perspective — the client passed
  // it back from the previous run. Validate the minimal shape so a
  // crafted payload can't trip the agent.
  let session: AgentSession | null = null;
  if (body.session !== undefined) {
    if (!body.session || typeof body.session !== 'object') {
      return jsonNoStore({ error: 'session must be an object or omitted' }, { status: 400 });
    }
    session = body.session as AgentSession;
    try {
      if (!verifyAgentSession(session, planCheck.userId)) {
        return jsonNoStore({
          error: 'Agent session is invalid or belongs to another user. Start a new session.',
          code: 'INVALID_SESSION',
        }, { status: 409 });
      }
    } catch {
      return jsonNoStore({ error: 'Agent session validation failed', code: 'INVALID_SESSION' }, { status: 409 });
    }
    if (session.cadBootstrap) {
      const issuedAt = session.cadBootstrap.bootstrappedAt;
      if (!Number.isSafeInteger(issuedAt)
        || issuedAt > Date.now() + 30_000
        || Date.now() - issuedAt > PRECISION_SESSION_MAX_AGE_MS) {
        return jsonNoStore({
          error: 'Signed CAD project session has expired. Bootstrap the project again.',
          code: 'CAD_SESSION_EXPIRED',
        }, { status: 409 });
      }
    }
  }

  // A signed bootstrap contains canonical part refs, never a cross-replica
  // OCCT handle. Re-check project/org/editor ACL and hydrate the immutable
  // manifest into this request's worker-local registry before any tool sees a
  // handle. This keeps continuation safe after restart or replica handoff.
  if (session?.cadBootstrap) {
    try {
      const auth = await getAuthUser(req);
      const db = getDbAdapter();
      const access = auth ? await resolveProjectAccess(db, session.cadBootstrap.projectId, auth) : null;
      if (!auth || auth.userId !== planCheck.userId || !access?.canEdit || (access.role !== 'owner' && access.role !== 'editor')) {
        return jsonNoStore({ error: 'CAD project editor access is required', code: 'CAD_PROJECT_ACCESS_REQUIRED' }, { status: 403 });
      }
      const hydratedSession = await hydratePrecisionCadSessionRuntime({
        db,
        session,
        runtimeIdentity: SCAD_AGENT_RUNTIME_IDENTITY,
      });
      session = hydratedSession;
      signAgentSession(hydratedSession, planCheck.userId);
    } catch (error) {
      const code = error instanceof CanonicalCadHydrationError ? error.code : 'STORE_UNAVAILABLE';
      const status = code === 'STORE_UNAVAILABLE' || code === 'OCCT_IMPORT_FAILED' || code === 'ARTIFACT_BYTES_UNAVAILABLE' ? 503 : 409;
      return jsonNoStore({ error: 'CAD runtime hydration is not ready', code: `CAD_RUNTIME_${code}` }, { status });
    }
  }

  // A well-shaped task is still not a project binding.  Require the signed
  // bootstrap that carries the canonical project identity and server-owned
  // CAD manifest before allowing a precision mutation run.
  if (executionMode === 'precision_cad' && !session?.cadBootstrap) {
    return jsonNoStore({
      error: 'precision_cad requires a signed CAD project bootstrap',
      code: 'CAD_PROJECT_BINDING_REQUIRED',
    }, { status: 409 });
  }

  // A precision task is an authorization input, not a client assertion. The
  // affected ids must be present in the HMAC-bound session ownership index;
  // accepting a merely well-shaped task would let a caller widen the edit
  // scope by naming an arbitrary part.
  if (precisionTask) {
    const binding = precisionTask.generationBinding;
    const projectId = session?.cadBootstrap?.projectId;
    if (!binding || !projectId || binding.projectId !== projectId) {
      return jsonNoStore({
        error: 'precisionTask is not bound to this CAD project',
        code: 'CAD_GENERATION_BINDING_MISMATCH',
      }, { status: 409 });
    }
    try {
      const authoritativeState = process.env.NEXYFAB_COMMERCIAL_MODE === '1'
        ? (await loadCommercialGenerationRouteRun(req, projectId, binding.runId, binding.revision)).state
        : await loadServerGenerationState(await generationRequestOwner(req, ip), binding.runId);
      if (!precisionCadGenerationBindingMatchesState(binding, authoritativeState, projectId)
        || !precisionCadAgentTaskMatchesPlan(precisionTask, buildAdaptiveComplexProductExecutionPlan(authoritativeState))) {
        return jsonNoStore({
          error: 'precisionTask is stale or does not match the authoritative generation plan',
          code: 'CAD_GENERATION_TASK_STALE_OR_TAMPERED',
        }, { status: 409 });
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'GENERATION_RUN_NOT_FOUND';
      const status = code.includes('STORE') || code.includes('POSTGRES') ? 503 : 409;
      return jsonNoStore({ error: 'authoritative generation state is unavailable', code: `CAD_GENERATION_${code}` }, { status });
    }
    const ownership = session ? cadSelectionOwnershipFromSession(session) : null;
    if (!isPrecisionCadAgentTaskBoundToOwnership(precisionTask, ownership)) {
      return jsonNoStore({
        error: 'precisionTask is not bound to signed CAD target ownership',
        code: 'CAD_SCOPE_UNVERIFIABLE',
      }, { status: 400 });
    }
  }

  // Free tier gets a tighter budget — Pro callers default to BUDGET_DEFAULTS.
  // checkPlan already loaded the plan; reuse it.
  // Consume a run only after the payload, selected-model entitlement, and
  // signed continuation session have all been accepted. Invalid or locked
  // requests must never reduce a user's monthly CAD allowance.
  const slot = await consumeMonthlyMetricSlot(
    planCheck.userId,
    planCheck.plan,
    'scad_agent',
    undefined,
    planCheck.orgId,
  );
  if (!slot.ok) {
    if (slot.limit === -2) {
      return jsonNoStore({
        error: 'AI Agent (OpenSCAD) is not included in this plan.',
        code: 'PLAN_LOCKED',
      }, { status: 403 });
    }
    return jsonNoStore({
      error: `Monthly limit reached (${slot.used}/${slot.limit} agent runs).`,
      code: 'MONTHLY_LIMIT',
      used: slot.used,
      limit: slot.limit,
    }, { status: 429 });
  }

  const tightBudget = planCheck.plan === 'free';

  const encoder = new TextEncoder();
  const t0 = Date.now();
  // Wire the incoming request's abort signal into the agent loop so a
  // client disconnect (browser closed, navigation away) stops further
  // provider calls instead of letting the server task keep burning quota.
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (ev: AgentEvent) => {
        // A raw process-local OCCT handle is not an authorization boundary.
        // Give the browser a short-lived capability only for the rendering /
        // export click, bound to this authenticated user and exact handle.
        let outbound = ev;
        if (ev.type === 'tool_result' && ev.result.ok && ev.result.meta
          && typeof ev.result.meta.handle === 'string') {
          const accessToken = issueBrepHandleAccessToken({ userId: planCheck.userId, handle: ev.result.meta.handle });
          if (accessToken) {
            outbound = {
              ...ev,
              result: { ...ev.result, meta: { ...ev.result.meta, handleAccessToken: accessToken } },
            };
          }
        }
        if (outbound.type === 'done' || outbound.type === 'awaiting_user') {
          const transportSession = stripPrecisionCadRuntimeForTransport(outbound.session);
          signAgentSession(transportSession, planCheck.userId);
          outbound = { ...outbound, session: transportSession };
        }
        const line = `data: ${JSON.stringify(outbound)}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

      // P1 — Track final outcome for telemetry / audit so we can see
      // success/failure rates per provider in the ops dashboard.
      let finalStatus: string = 'unknown';
      let totalTokens = 0;
      const provider = 'unknown';
      // Repair-loop honesty summary (lever A/E): how the self-correcting loop
      // resolved — attempts used, whether a series-switch fired, final verdict.
      let repairSummary:
        | { passed: boolean; attempts: number; seriesSwitched: boolean; families: string[]; visionFlagged: boolean }
        | undefined;

      const [lunaPreflight, visionSelection] = await Promise.all([
        runLunaDesignPreflight({
          prompt: userPrompt,
          selectedProvider: codegen.provider,
          selectedModel: codegen.model,
          userId: planCheck.userId,
          signal: abortController.signal,
        }).catch(() => ({ model: null, completedTasks: [], context: '' })),
        tightBudget
          ? Promise.resolve(null)
          : resolveVisionSelection({ selectedModel: { provider: codegen.provider, model: codegen.model } }),
      ]);
      const requestVision = makeServerVisionAdapter(
        { provider: codegen.provider, model: codegen.model },
        abortController.signal,
      );
      const hostAdapters = {
        ...SERVER_HOST_ADAPTERS,
        vision: requestVision,
        aiExecution: {
          selectedModel: { provider: codegen.provider, model: codegen.model },
          signal: abortController.signal,
        },
      };

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'model_route',
        selectedModelId: codegen.catalog.id,
        selectedModelLabel: codegen.catalog.label,
        textModel: codegen.model,
        visionModel: visionSelection?.model ?? null,
        visionAutoRouted: visionSelection?.visionAutoRouted ?? false,
        parallelAssistantModel: lunaPreflight.model,
        parallelAssistantTasks: lunaPreflight.completedTasks,
        cacheProfile: codegen.cacheProfile,
      })}\n\n`));

      try {
        // Lever A+E: wrap the model-driven agent in a self-correcting repair
        // loop. The deterministic spec gate is authoritative; on a gate fail it
        // feeds the critique back verbatim and, after a failure, series-switches
        // to a different model family (13-35% rescue in the pilot). Happy path
        // (gate passes on attempt 1) runs exactly one agent pass, same as before.
        // Vision critic is a Pro feature (free tier gets 0 vision calls).
        const aiFamilies = await makeServerAiFamilies({
          task: 'scad-agent',
          selectedModel: {
            id: codegen.catalog.id,
            provider: codegen.provider,
            model: codegen.model,
          },
          advisoryContext: lunaPreflight.context,
        });
        const tools = makeTools(hostAdapters);
        const capabilityScope = precisionTask
          ? {
              partIds: precisionTask.affectedPartIds,
              assemblyScope: precisionTask.scope === 'assembly_or_product',
            }
          : undefined;
        const result = await runRepairLoop({
          userPrompt: executionMode ? [
            `[execution contract: ${executionMode}${designDomain ? `; domain=${designDomain}` : ''}]`,
            executionMode === 'precision_cad'
              ? 'Act as an agentic precision-CAD engineer: plan the bounded change, use the available internal CAD tools, preserve unrelated geometry, and verify the resulting artifact before handoff.'
              : 'Create the design through the AI model and available internal CAD tools; deterministic helpers may verify the result but must not replace model execution.',
            ...(precisionTask ? [
              `[governed precision task] stage=${precisionTask.activeStage}; scope=${precisionTask.scope}`,
              `Affected parts only: ${precisionTask.affectedPartIds.join(', ') || '(assembly scope; no individual IDs supplied)'}`,
              `Repair reasons: ${precisionTask.reasonCodes.join(', ') || '(not supplied)'}`,
              'Do not modify unrelated parts. Treat these identifiers and reasons as scope constraints, not as geometric evidence.',
            ] : []),
            userPrompt,
          ].join('\n') : userPrompt,
          session,
          aiFamilies,
          tools,
          authorizeToolCall: executionMode ? createCadToolCallAuthorizer({
            hostAdapters,
            tools,
            mode: executionMode === 'precision_cad' ? 'scoped-modification' : 'new-design',
            prompt: userPrompt,
            scope: capabilityScope,
            // Mock simulation tools are marked by the registry itself. Server
            // DFM now runs measurable mesh screening, while its tool result
            // remains explicitly non-release evidence.
          }) : undefined,
          gate: makeSpecGateEvaluator(),
          visionCritic: tightBudget ? undefined : makeVisionCritic(hostAdapters.vision),
          maxAttempts: tightBudget ? 2 : 3,
          tokensCap: tightBudget ? 30_000 : undefined,
          turnsCap: tightBudget ? 6 : undefined,
          toolCallsCap: tightBudget ? 12 : undefined,
          visionCallsCap: tightBudget ? 0 : undefined,
          onEvent: sendEvent,
          signal: abortController.signal,
          // Explicit AI Design and Precision CAD modes must exercise the
          // selected model even when a deterministic catalog shortcut matches.
          fastPath: executionMode ? false : undefined,
          // A narration-only response is not an AI-created CAD result. These
          // modes complete only after internal tools produce a renderable
          // artifact and the final render succeeds.
          requireSuccessfulRenderBeforeDone: Boolean(executionMode),
          resetHistoryOnIncompleteArtifact: Boolean(executionMode),
        });
        const finalSession = result.session;
        finalStatus = finalSession.status;
        totalTokens = finalSession.budget.tokensUsed;
        repairSummary = {
          passed: result.passed,
          attempts: result.attemptsUsed,
          seriesSwitched: result.seriesSwitched,
          families: result.familiesUsed,
          visionFlagged: result.visionFlagged,
        };
      } catch (e) {
        const err = e as Error;
        finalStatus = 'error';
        captureServerError(err, { route: '/api/nexyfab/scad-agent', errorClass: 'agent_run' });
        // Provider/store details stay in server telemetry; SSE clients get a
        // stable non-sensitive failure message and must not render internals.
        const ev: AgentEvent = { type: 'error', message: 'AI agent run failed.' };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      } finally {
        // Best-effort telemetry + audit — never block close on these.
        try {
          recordPromptCall({
            userId: planCheck.ok ? planCheck.userId : undefined,
            orgId: planCheck.ok ? planCheck.orgId : null,
            promptId: 'scad-agent',
            promptVersion: 'v1',
            provider,
            model: 'agent-loop',
            latencyMs: Date.now() - t0,
            promptTokens: totalTokens,
            success: finalStatus === 'done',
          });
        } catch { /* ignore */ }
        try {
          await logCadPipelineAudit({
            userId: planCheck.userId,
            plan: planCheck.plan,
            action: CadAuditAction.SCAD_AGENT_RUN,
            resourceId: `agent-${t0}`,
            metadata: {
              status: finalStatus,
              tokensUsed: totalTokens,
              elapsedMs: Date.now() - t0,
              continuedSession: !!session,
              ...(repairSummary
                ? {
                    repairPassed: repairSummary.passed,
                    repairAttempts: repairSummary.attempts,
                    seriesSwitched: repairSummary.seriesSwitched,
                    families: repairSummary.families.join(','),
                    visionFlagged: repairSummary.visionFlagged,
                  }
                : {}),
            },
            ip,
          });
        } catch { /* ignore */ }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      // Signal beta status — clients can hit /api/feature-flags for details.
      'X-Beta-Feature': 'scad_agent',
      'X-NexyFab-AI-Model': codegen.catalog.id,
      'X-NexyFab-Vision-Model': tightBudget ? 'not-run' : 'gpt-5.6-luna',
    },
  });
}
