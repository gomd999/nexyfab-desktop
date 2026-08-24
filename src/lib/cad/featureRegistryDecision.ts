import type { CadMessageCode } from './i18n/message';
import {
  FEATURE_REGISTRY_HASH,
  type FeatureExecutor,
  type FeatureFidelity,
  lookupFeature,
} from './featureRegistry';

export const FEATURE_EXECUTION_DECISION_SCHEMA = 'nexyfab.precision-cad.feature-execution-decision.v1' as const;

export type FeatureExecutionIntent = 'AUTHORITATIVE' | 'PREVIEW';
export type RuntimeExecutor = 'REAL_OCCT' | 'DOMAIN_EXACT' | 'MESH_PREVIEW' | 'STUB' | 'UNAVAILABLE';
export type FeatureExecutionDecisionStatus = 'ALLOW_EXACT' | 'ALLOW_PREVIEW' | 'BLOCK';

export interface FeatureExecutionRuntime {
  executor: RuntimeExecutor;
  identitySha256: string | null;
  stubFallback: boolean;
  handlerIds: readonly string[];
  verifierIds: readonly string[];
}

export interface FeatureExecutionRequest {
  featureId: string;
  intent: FeatureExecutionIntent;
  runtime: FeatureExecutionRuntime;
}

export interface FeatureExecutionDecision {
  schema: typeof FEATURE_EXECUTION_DECISION_SCHEMA;
  registryHash: string;
  status: FeatureExecutionDecisionStatus;
  intent: FeatureExecutionIntent | null;
  featureId: string | null;
  fidelity: FeatureFidelity | null;
  executor: FeatureExecutor | null;
  messageKey: CadMessageCode | null;
  reason:
    | 'exact_ready'
    | 'preview_ready'
    | 'invalid_request'
    | 'unknown_feature'
    | 'feature_unsupported'
    | 'preview_not_authoritative'
    | 'runtime_identity_invalid'
    | 'runtime_executor_mismatch'
    | 'stub_fallback_forbidden'
    | 'handler_unavailable'
    | 'verification_unavailable';
  missing: readonly string[];
}

const REQUEST_KEYS = ['featureId', 'intent', 'runtime'] as const;
const RUNTIME_KEYS = ['executor', 'identitySha256', 'stubFallback', 'handlerIds', 'verifierIds'] as const;
const INTENTS: readonly FeatureExecutionIntent[] = ['AUTHORITATIVE', 'PREVIEW'];
const RUNTIME_EXECUTORS: readonly RuntimeExecutor[] = ['REAL_OCCT', 'DOMAIN_EXACT', 'MESH_PREVIEW', 'STUB', 'UNAVAILABLE'];
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAX_CAPABILITIES = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return false;
  if (keys.some(key => !Object.getOwnPropertyDescriptor(value, key)?.enumerable)) return false;
  const actual = (keys as string[]).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isTokenList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_CAPABILITIES
    && value.every(item => typeof item === 'string' && SAFE_TOKEN.test(item))
    && new Set(value).size === value.length;
}

function isRequest(value: unknown): value is FeatureExecutionRequest {
  if (!isRecord(value) || !exactKeys(value, REQUEST_KEYS)) return false;
  if (typeof value.featureId !== 'string' || !SAFE_TOKEN.test(value.featureId)) return false;
  if (typeof value.intent !== 'string' || !INTENTS.includes(value.intent as FeatureExecutionIntent)) return false;
  const runtime = value.runtime;
  if (!isRecord(runtime) || !exactKeys(runtime, RUNTIME_KEYS)) return false;
  if (typeof runtime.executor !== 'string' || !RUNTIME_EXECUTORS.includes(runtime.executor as RuntimeExecutor)) return false;
  if (runtime.identitySha256 !== null && (typeof runtime.identitySha256 !== 'string' || !SHA256.test(runtime.identitySha256))) return false;
  if (typeof runtime.stubFallback !== 'boolean') return false;
  return isTokenList(runtime.handlerIds) && isTokenList(runtime.verifierIds);
}

function freezeDecision(decision: FeatureExecutionDecision): FeatureExecutionDecision {
  Object.freeze(decision.missing);
  return Object.freeze(decision);
}

function blocked(
  request: FeatureExecutionRequest | null,
  feature: { featureId: string; fidelity: FeatureFidelity; executor: FeatureExecutor; messageKey: CadMessageCode } | null,
  reason: FeatureExecutionDecision['reason'],
  missing: readonly string[] = [],
): FeatureExecutionDecision {
  return freezeDecision({
    schema: FEATURE_EXECUTION_DECISION_SCHEMA,
    registryHash: FEATURE_REGISTRY_HASH,
    status: 'BLOCK',
    intent: request?.intent ?? null,
    featureId: feature?.featureId ?? (request?.featureId ?? null),
    fidelity: feature?.fidelity ?? null,
    executor: feature?.executor ?? null,
    messageKey: feature?.messageKey ?? 'CAD_FEATURE_UNSUPPORTED',
    reason,
    missing: [...missing],
  });
}

function expectedRuntime(executor: FeatureExecutor): RuntimeExecutor | null {
  if (executor === 'OCCT_EXACT') return 'REAL_OCCT';
  if (executor === 'DOMAIN_HANDLER') return 'DOMAIN_EXACT';
  if (executor === 'MESH_PREVIEW') return 'MESH_PREVIEW';
  return null;
}

/**
 * Commercial execution gate. Registry metadata never authorizes execution by
 * itself: the live runtime must prove its exact handler, executor identity and
 * every required verifier. Authoritative requests are never downgraded.
 */
export function decideFeatureExecution(input: unknown): FeatureExecutionDecision {
  try {
    if (!isRequest(input)) return blocked(null, null, 'invalid_request');
    const request = input;
    const lookup = lookupFeature(request.featureId);
    if (!lookup.ok) return blocked(request, null, 'unknown_feature');
    const feature = lookup.feature;
    const summary = {
      featureId: feature.featureId,
      fidelity: feature.fidelity,
      executor: feature.executor,
      messageKey: feature.messageKey,
    };

    if (feature.fidelity === 'UNSUPPORTED' || feature.executor === 'UNAVAILABLE') {
      return blocked(request, summary, 'feature_unsupported');
    }
    if (request.intent === 'AUTHORITATIVE' && feature.fidelity !== 'EXACT') {
      return blocked(request, summary, 'preview_not_authoritative');
    }
    if (request.runtime.stubFallback || request.runtime.executor === 'STUB') {
      return blocked(request, summary, 'stub_fallback_forbidden');
    }
    if (!request.runtime.identitySha256 || !SHA256.test(request.runtime.identitySha256)) {
      return blocked(request, summary, 'runtime_identity_invalid', ['runtime.identitySha256']);
    }

    const runtime = expectedRuntime(feature.executor);
    if (runtime === null || request.runtime.executor !== runtime) {
      return blocked(request, summary, 'runtime_executor_mismatch', [`executor:${runtime ?? 'UNAVAILABLE'}`]);
    }

    if (feature.handlerId && !request.runtime.handlerIds.includes(feature.handlerId)) {
      return blocked(request, summary, 'handler_unavailable', [`handler:${feature.handlerId}`]);
    }
    const missingVerifiers = feature.verificationIds
      .filter(verifierId => !request.runtime.verifierIds.includes(verifierId))
      .map(verifierId => `verifier:${verifierId}`);
    if (missingVerifiers.length > 0) {
      return blocked(request, summary, 'verification_unavailable', missingVerifiers);
    }

    return freezeDecision({
      schema: FEATURE_EXECUTION_DECISION_SCHEMA,
      registryHash: FEATURE_REGISTRY_HASH,
      status: feature.fidelity === 'EXACT' ? 'ALLOW_EXACT' : 'ALLOW_PREVIEW',
      intent: request.intent,
      featureId: feature.featureId,
      fidelity: feature.fidelity,
      executor: feature.executor,
      messageKey: null,
      reason: feature.fidelity === 'EXACT' ? 'exact_ready' : 'preview_ready',
      missing: [],
    });
  } catch {
    return blocked(null, null, 'invalid_request');
  }
}
