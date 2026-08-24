import { generationArtifactHash } from './generationRunState';

export const AI_DESIGN_RUNTIME_TELEMETRY_SCHEMA = 'nexyfab.ai-design-runtime-telemetry.v1' as const;
export const AI_DESIGN_RUNTIME_TELEMETRY_TYPES = [
  'intake_adapted',
  'workflow_transition',
  'model_selected',
  'model_fallback',
  'generation_stage',
  'candidate_published',
  'candidate_selected',
  'gauge_adjusted',
  'precision_requested',
  'session_recovered',
  'runtime_error',
] as const;

export type AiDesignRuntimeTelemetryType = (typeof AI_DESIGN_RUNTIME_TELEMETRY_TYPES)[number];
export type AiDesignRuntimeTelemetryStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED' | 'NOT_RUN';
export type AiDesignRuntimeTelemetryAttributeKey =
  | 'stage'
  | 'modelId'
  | 'fromModelId'
  | 'toModelId'
  | 'fallbackReason'
  | 'workflowStatus'
  | 'deviceClass'
  | 'networkMode'
  | 'actionId'
  | 'evidenceStatus';

export interface AiDesignRuntimeTelemetryEventV1 {
  schema: typeof AI_DESIGN_RUNTIME_TELEMETRY_SCHEMA;
  eventId: string;
  type: AiDesignRuntimeTelemetryType;
  projectKey: string;
  sessionKey: string;
  runtimeRevision: number;
  status: AiDesignRuntimeTelemetryStatus;
  durationMs: number | null;
  codes: readonly string[];
  counts: Readonly<Record<string, number>>;
  attributes: Partial<Record<AiDesignRuntimeTelemetryAttributeKey, string>>;
  occurredAt: string;
  containsUserContent: false;
  containsGeometry: false;
  exactGeometryAuthority: false;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ATTRIBUTE_KEYS: readonly AiDesignRuntimeTelemetryAttributeKey[] = [
  'stage', 'modelId', 'fromModelId', 'toModelId', 'fallbackReason',
  'workflowStatus', 'deviceClass', 'networkMode', 'actionId', 'evidenceStatus',
];
const FORBIDDEN_KEY = /^(prompt|messages?|content|text|image|file|bytes|buffer|geometry|mesh|brep|stl|step|secret|password|token|authorization|api[_-]?key)$/i;

export function createAiDesignRuntimeTelemetryEvent(input: {
  eventId: string;
  type: AiDesignRuntimeTelemetryType;
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  status: AiDesignRuntimeTelemetryStatus;
  durationMs?: number | null;
  codes?: readonly string[];
  counts?: Readonly<Record<string, number>>;
  attributes?: Partial<Record<AiDesignRuntimeTelemetryAttributeKey, string>> | Record<string, unknown>;
  occurredAt?: string;
}): AiDesignRuntimeTelemetryEventV1 {
  if (!SAFE_ID.test(input.eventId) || !SAFE_ID.test(input.projectId) || !SAFE_ID.test(input.sessionId)) throw new Error('telemetry_identity_invalid');
  if (!AI_DESIGN_RUNTIME_TELEMETRY_TYPES.includes(input.type) || !Number.isSafeInteger(input.runtimeRevision) || input.runtimeRevision < 0) throw new Error('telemetry_contract_invalid');
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error('telemetry_timestamp_invalid');
  const durationMs = input.durationMs ?? null;
  if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 24 * 60 * 60 * 1_000)) throw new Error('telemetry_duration_invalid');
  const codes = [...new Set(input.codes ?? [])];
  if (codes.length > 16 || codes.some(code => !SAFE_CODE.test(code))) throw new Error('telemetry_codes_invalid');
  const counts = input.counts ?? {};
  if (Object.keys(counts).length > 16 || Object.entries(counts).some(([key, value]) => !SAFE_CODE.test(key) || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000)) throw new Error('telemetry_counts_invalid');
  const rawAttributes = input.attributes ?? {};
  if (Object.keys(rawAttributes).some(key => FORBIDDEN_KEY.test(key) || !ATTRIBUTE_KEYS.includes(key as AiDesignRuntimeTelemetryAttributeKey))) throw new Error('telemetry_attribute_forbidden');
  if (Object.values(rawAttributes).some(value => typeof value !== 'string' || value.length === 0 || value.length > 128)) throw new Error('telemetry_attribute_invalid');
  return {
    schema: AI_DESIGN_RUNTIME_TELEMETRY_SCHEMA,
    eventId: input.eventId,
    type: input.type,
    projectKey: generationArtifactHash({ projectId: input.projectId }),
    sessionKey: generationArtifactHash({ projectId: input.projectId, sessionId: input.sessionId }),
    runtimeRevision: input.runtimeRevision,
    status: input.status,
    durationMs,
    codes,
    counts: { ...counts },
    attributes: { ...rawAttributes } as Partial<Record<AiDesignRuntimeTelemetryAttributeKey, string>>,
    occurredAt,
    containsUserContent: false,
    containsGeometry: false,
    exactGeometryAuthority: false,
  };
}

export function validateAiDesignRuntimeTelemetryEvent(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['telemetry_not_object'];
  const event = value as Partial<AiDesignRuntimeTelemetryEventV1>;
  const issues: string[] = [];
  if (event.schema !== AI_DESIGN_RUNTIME_TELEMETRY_SCHEMA) issues.push('telemetry_schema_invalid');
  if (event.containsUserContent !== false || event.containsGeometry !== false || event.exactGeometryAuthority !== false) issues.push('telemetry_privacy_boundary_invalid');
  if (typeof event.projectKey !== 'string' || !/^[a-f0-9]{64}$/.test(event.projectKey) || typeof event.sessionKey !== 'string' || !/^[a-f0-9]{64}$/.test(event.sessionKey)) issues.push('telemetry_identity_digest_invalid');
  if (!event.type || !AI_DESIGN_RUNTIME_TELEMETRY_TYPES.includes(event.type)) issues.push('telemetry_type_invalid');
  return issues;
}

