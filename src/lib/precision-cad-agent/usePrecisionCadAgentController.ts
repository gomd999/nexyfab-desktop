'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import {
  approveToolCall,
  beginRevalidation,
  cancelRun,
  completeRun,
  createAgentRun,
  failRun,
  planRun,
  recordToolResult,
  rejectToolCall,
  requestToolCall,
  resumeRun,
  retryRun,
  type AgentRun,
  type AgentRunRequest,
  type AgentToolCall,
  type AgentToolScope,
} from './runState';
import {
  type AgentToolCatalog,
  type AiAgentInputItem,
  type AiAgentTurnOutput,
  type NormalizedToolCall,
  type ProviderState,
  type TauriInvoke,
} from './tauriBridge';
import {
  createDefaultPrecisionCadExecutor,
  type PrecisionCadAgentExecutor,
  type PrecisionCadExecutionContext,
} from './executor';
import type { RemotePrecisionCadProjectBinding } from './remoteCadContract';
import { validateToolArguments } from './toolArgumentsValidator';

export type AgentControllerErrorCode =
  | 'CATALOG_NOT_READY'
  | 'CATALOG_LOAD_FAILED'
  | 'CATALOG_INVALID'
  | 'TURN_FAILED'
  | 'TOOL_NOT_IN_CATALOG'
  | 'PARALLEL_TOOL_CALLS_UNSUPPORTED'
  | 'TOOL_FAILED'
  | 'INVALID_TOOL_ARGUMENTS'
  | 'BOUNDS_EXCEEDED'
  | 'INVALID_APPROVAL_TOKEN'
  | 'APPROVAL_REJECTED'
  | 'INVALID_RESUME'
  | 'INVALID_RETRY'
  | 'CANCELLED'
  | 'VALIDATION_REQUIRED';

export type AgentControllerError = { code: AgentControllerErrorCode };

export type PrecisionCadAgentControllerOptions = {
  projectRoot?: string;
  binding?: RemotePrecisionCadProjectBinding;
  provider: Exclude<AgentRunRequest['provider'], 'local'>;
  model: string;
  lang: string;
  invoke?: TauriInvoke;
  executor?: PrecisionCadAgentExecutor;
  autoLoadCatalog?: boolean;
};

export type PrecisionCadAgentController = {
  run: AgentRun;
  catalog: AgentToolCatalog;
  loadingCatalog: boolean;
  locale: IsoLang;
  error?: AgentControllerError;
  loadCatalog: () => Promise<void>;
  start: (request: string) => Promise<void>;
  approve: (token: string) => Promise<void>;
  reject: () => void;
  cancel: () => void;
  resume: () => Promise<void>;
  retry: () => Promise<void>;
};

const INSTRUCTIONS = 'Use exactly one NexyFab CAD tool at a time. Never assume approval. Return a deterministic validation result before completion.';
const VALID_SCOPES: readonly AgentToolScope[] = ['read', 'propose', 'apply', 'export'];
const VALIDATION_TOOLS = new Set(['analyze_dfm', 'resolve_constraints']);
const INSTALLER_CORE_TOOLS = [
  'list_domains',
  'build_assembly',
  'analyze_dfm',
  'fab_estimate',
  'resolve_constraints',
  'render_preview',
  'blade_ring',
  'loft_part',
] as const;

function stableCatalog(value: unknown): value is AgentToolCatalog {
  if (!Array.isArray(value) || value.length !== INSTALLER_CORE_TOOLS.length) return false;
  const names = new Set<string>();
  const valid = value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.name !== 'string' || names.has(candidate.name)) return false;
    names.add(candidate.name);
    const schema = candidate.parameters as Record<string, unknown> | null;
    return INSTALLER_CORE_TOOLS.includes(candidate.name as (typeof INSTALLER_CORE_TOOLS)[number])
      && typeof candidate.description === 'string'
      && schema !== null
      && typeof schema === 'object'
      && !Array.isArray(schema)
      && schema.type === 'object'
      && typeof candidate.scope === 'string'
      && VALID_SCOPES.includes(candidate.scope as AgentToolScope);
  });
  return valid && INSTALLER_CORE_TOOLS.every((name) => names.has(name));
}

function normalizedCall(call: NormalizedToolCall): call is NormalizedToolCall {
  return Boolean(call && typeof call.call_id === 'string' && call.call_id && typeof call.name === 'string' && call.name && call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments));
}

function resultSucceeded(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true;
  const candidate = result as Record<string, unknown>;
  return candidate.ok !== false && candidate.pass !== false;
}

function stableCode(error: unknown): AgentControllerErrorCode {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const code = (error as { code: string }).code;
    if (code === 'MAX_STEPS_EXCEEDED' || code === 'MAX_TOOL_CALLS_EXCEEDED') return 'BOUNDS_EXCEEDED';
    if (code === 'INVALID_APPROVAL_TOKEN') return 'INVALID_APPROVAL_TOKEN';
  }
  return 'TURN_FAILED';
}

export function usePrecisionCadAgentController(options: PrecisionCadAgentControllerOptions): PrecisionCadAgentController {
  const { projectRoot, binding, provider, model, lang, invoke, executor: providedExecutor, autoLoadCatalog = true } = options;
  const executor = useMemo(
    () => providedExecutor ?? createDefaultPrecisionCadExecutor({ projectRoot, binding, invoke }),
    [providedExecutor, binding, projectRoot, invoke],
  );
  const executionContext = useMemo<PrecisionCadExecutionContext>(() => ({
    ...(binding ? { binding } : {}),
    ...(projectRoot?.trim() ? { projectRoot: projectRoot.trim() } : {}),
    locale: toIsoLang(lang),
  }), [binding, lang, projectRoot]);
  const locale = toIsoLang(lang);
  const initialRequest: AgentRunRequest = { request: '', provider, model };
  const [run, setRun] = useState<AgentRun>(() => createAgentRun(initialRequest));
  const [catalog, setCatalog] = useState<AgentToolCatalog>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [error, setError] = useState<AgentControllerError>();
  const catalogRef = useRef<AgentToolCatalog>([]);
  const generationRef = useRef(0);
  const catalogRequestRef = useRef(0);
  const inputRef = useRef<readonly AiAgentInputItem[]>([]);
  const providerStateRef = useRef<ProviderState | undefined>(undefined);
  const executedToolsRef = useRef(0);
  const validationSucceededRef = useRef(false);
  const lastToolResultRef = useRef<unknown>(undefined);

  const isFresh = useCallback((generation: number) => generationRef.current === generation, []);

  const setStableFailure = useCallback((current: AgentRun, code: AgentControllerErrorCode, generation?: number) => {
    if (generation !== undefined && !isFresh(generation)) return;
    const next = failRun(current, code);
    if (next.ok) setRun(next.run);
    setError({ code });
  }, [isFresh]);

  const loadCatalog = useCallback(async () => {
    const requestId = ++catalogRequestRef.current;
    setLoadingCatalog(true);
    setError(undefined);
    catalogRef.current = [];
    setCatalog([]);
    try {
      const loaded = await executor.catalog(executionContext);
      if (catalogRequestRef.current !== requestId) return;
      if (!stableCatalog(loaded)) {
        catalogRef.current = [];
        setCatalog([]);
        setError({ code: 'CATALOG_INVALID' });
        return;
      }
      const frozen = Object.freeze(loaded.map((item) => Object.freeze({ ...item, parameters: Object.freeze({ ...item.parameters }) })));
      catalogRef.current = frozen;
      setCatalog(frozen);
    } catch {
      if (catalogRequestRef.current === requestId) {
        catalogRef.current = [];
        setCatalog([]);
        setError({ code: 'CATALOG_LOAD_FAILED' });
      }
    } finally {
      if (catalogRequestRef.current === requestId) setLoadingCatalog(false);
    }
  }, [executionContext, executor]);

  useEffect(() => {
    if (autoLoadCatalog && (executionContext.binding || executionContext.projectRoot?.trim())) void loadCatalog();
  }, [autoLoadCatalog, executionContext, loadCatalog]);

  const finishIfValid = useCallback((current: AgentRun, generation: number, assistantText: string) => {
    if (!isFresh(generation)) return;
    if (executedToolsRef.current < 1 || !validationSucceededRef.current) {
      setStableFailure(current, 'VALIDATION_REQUIRED', generation);
      return;
    }
    const validating = beginRevalidation(current);
    if (!validating.ok) {
      setStableFailure(current, 'VALIDATION_REQUIRED', generation);
      return;
    }
    const completed = completeRun(validating.run, {
      validation: 'deterministic',
      assistantText,
      ...(lastToolResultRef.current === undefined ? {} : { toolResult: lastToolResultRef.current }),
    });
    if (completed.ok) setRun(completed.run);
    else setStableFailure(current, 'VALIDATION_REQUIRED', generation);
  }, [isFresh, setStableFailure]);

  const runTurn = useCallback(async (generation: number, current: AgentRun) => {
    if (!isFresh(generation) || current.state === 'cancelled') return;
    const turnInput = {
      provider,
      model,
      instructions: INSTRUCTIONS,
      input: inputRef.current,
      tools: catalogRef.current,
      ...(providerStateRef.current ? { prior_provider_state: providerStateRef.current } : {}),
    };
    let output: AiAgentTurnOutput;
    try {
      output = await executor.turn(turnInput, { ...executionContext, runId: current.runId });
    } catch {
      setStableFailure(current, 'TURN_FAILED', generation);
      return;
    }
    if (!isFresh(generation)) return;
    if (output.provider_state && (typeof output.provider_state !== 'object' || typeof output.provider_state.handle !== 'string' || !output.provider_state.handle)) {
      setStableFailure(current, 'TURN_FAILED', generation);
      return;
    }
    // Store only the opaque native handle; response history remains native.
    providerStateRef.current = output.provider_state;
    inputRef.current = [];
    if (!Array.isArray(output.tool_calls)) {
      setStableFailure(current, 'TURN_FAILED', generation);
      return;
    }
    if (output.tool_calls.length > 1) {
      setStableFailure(current, 'PARALLEL_TOOL_CALLS_UNSUPPORTED', generation);
      return;
    }
    if (output.tool_calls.length === 0) {
      if (output.finish_status !== 'completed') {
        setStableFailure(current, 'TURN_FAILED', generation);
        return;
      }
      finishIfValid(current, generation, output.assistant_text);
      return;
    }
    if (!output.provider_state) {
      setStableFailure(current, 'TURN_FAILED', generation);
      return;
    }
    const candidate = output.tool_calls[0];
    if (!normalizedCall(candidate)) {
      setStableFailure(current, 'TURN_FAILED', generation);
      return;
    }
    const definition = catalogRef.current.find((item) => item.name === candidate.name);
    if (!definition) {
      setStableFailure(current, 'TOOL_NOT_IN_CATALOG', generation);
      return;
    }
    const elevatedScope: AgentToolScope = candidate.name === 'render_preview' && typeof candidate.arguments.outDir === 'string' && candidate.arguments.outDir.trim() ? 'export' : definition.scope;
    const call: AgentToolCall = { callId: candidate.call_id, toolName: candidate.name, arguments: candidate.arguments, scope: elevatedScope };
    const requested = requestToolCall(current, call);
    if (!requested.ok) {
      setStableFailure(current, stableCode(requested.error), generation);
      return;
    }
    setRun(requested.run);
    if (requested.run.state === 'awaiting_approval') return;
    await executeTool(generation, requested.run, call);
  // executeTool is assigned below; this callback is intentionally declared in the hook's stable async flow.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, executionContext, executor, finishIfValid, isFresh, model, provider, setStableFailure]);

  const executeTool = useCallback(async (generation: number, current: AgentRun, call: AgentToolCall, approvalToken?: string) => {
    if (!isFresh(generation) || current.state === 'cancelled') return;
    const definition = catalogRef.current.find((item) => item.name === call.toolName);
    if (!definition || !validateToolArguments(definition.parameters, call.arguments).ok) {
      setStableFailure(current, 'INVALID_TOOL_ARGUMENTS', generation);
      return;
    }
    let nativeResult;
    try {
      nativeResult = await executor.tool(
        { runId: current.runId, call, projectRoot: executionContext.projectRoot ?? '', locale: executionContext.locale, ...(approvalToken ? { approvalBinding: approvalToken } : {}) },
        { ...executionContext, runId: current.runId, ...(providerStateRef.current?.handle ? { continuationId: providerStateRef.current.handle } : {}) },
      );
    } catch {
      setStableFailure(current, 'TOOL_FAILED', generation);
      return;
    }
    if (!isFresh(generation)) return;
    executedToolsRef.current += 1;
    lastToolResultRef.current = nativeResult.ok ? nativeResult.result : { ok: false, error: 'TOOL_FAILED' };
    if (VALIDATION_TOOLS.has(call.toolName) && nativeResult.ok && resultSucceeded(nativeResult.result)) validationSucceededRef.current = true;
    const recorded = recordToolResult(current, nativeResult.ok ? nativeResult.result : { ok: false, error: 'TOOL_FAILED' });
    if (!recorded.ok) {
      setStableFailure(current, 'TOOL_FAILED', generation);
      return;
    }
    setRun(recorded.run);
    const content = nativeResult.ok ? JSON.stringify(nativeResult.result ?? null) : JSON.stringify({ ok: false, error: 'TOOL_FAILED' });
    inputRef.current = [{ role: 'tool', content, call_id: call.callId, name: call.toolName, is_error: !nativeResult.ok }];
    await runTurn(generation, recorded.run);
  }, [executionContext, executor, isFresh, runTurn, setStableFailure]);

  const start = useCallback(async (request: string) => {
    if (!request.trim()) {
      setError({ code: 'TURN_FAILED' });
      return;
    }
    if (!catalogRef.current.length) {
      setError({ code: 'CATALOG_NOT_READY' });
      return;
    }
    const generation = ++generationRef.current;
    providerStateRef.current = undefined;
    inputRef.current = [{ role: 'user', content: request }];
    executedToolsRef.current = 0;
    validationSucceededRef.current = false;
    lastToolResultRef.current = undefined;
    setError(undefined);
    const created = createAgentRun({ request, provider, model }, `run-${generation}-${Date.now().toString(36)}`);
    const planned = planRun(created);
    if (!planned.ok) {
      setStableFailure(created, 'TURN_FAILED', generation);
      return;
    }
    setRun(planned.run);
    await runTurn(generation, planned.run);
  }, [model, provider, runTurn, setStableFailure]);

  const approve = useCallback(async (token: string) => {
    const generation = generationRef.current;
    const pending = run.pendingApproval;
    if (!pending) {
      setError({ code: 'INVALID_APPROVAL_TOKEN' });
      return;
    }
    const approved = approveToolCall(run, token);
    if (!approved.ok) {
      setError({ code: 'INVALID_APPROVAL_TOKEN' });
      return;
    }
    setRun(approved.run);
    await executeTool(generation, approved.run, pending.call, token);
  }, [executeTool, run]);

  const reject = useCallback(() => {
    // Rejection is intentionally terminal; no implicit retry or auto-approval.
    const rejected = rejectToolCall(run);
    if (rejected.ok) setRun(rejected.run);
    setError({ code: 'APPROVAL_REJECTED' });
  }, [run]);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    const cancelled = cancelRun(run);
    if (cancelled.ok) setRun(cancelled.run);
    setError({ code: 'CANCELLED' });
  }, [run]);

  const resume = useCallback(async () => {
    if (run.state !== 'cancelled') {
      setError({ code: 'INVALID_RESUME' });
      return;
    }
    const resumed = resumeRun(run);
    if (!resumed.ok) {
      setError({ code: 'INVALID_RESUME' });
      return;
    }
    const generation = ++generationRef.current;
    providerStateRef.current = undefined;
    inputRef.current = [{ role: 'user', content: run.request.request }];
    executedToolsRef.current = 0;
    validationSucceededRef.current = false;
    lastToolResultRef.current = undefined;
    setError(undefined);
    setRun(resumed.run);
    await runTurn(generation, resumed.run);
  }, [run, runTurn]);

  const retry = useCallback(async () => {
    if (run.state !== 'failed') {
      setError({ code: 'INVALID_RETRY' });
      return;
    }
    const retried = retryRun(run);
    if (!retried.ok) {
      setError({ code: 'INVALID_RETRY' });
      return;
    }
    const generation = ++generationRef.current;
    providerStateRef.current = undefined;
    inputRef.current = [{ role: 'user', content: run.request.request }];
    executedToolsRef.current = 0;
    validationSucceededRef.current = false;
    lastToolResultRef.current = undefined;
    setError(undefined);
    setRun(retried.run);
    await runTurn(generation, retried.run);
  }, [run, runTurn]);

  return { run, catalog, loadingCatalog, locale, error, loadCatalog, start, approve, reject, cancel, resume, retry };
}
