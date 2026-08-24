import { Sha256 } from '@aws-crypto/sha256-js';
import {
  canonicalCadConsumerDraftJson,
  type CanonicalCadDomain,
  type CanonicalCadResourceBudget,
  type CanonicalCadRiskClass,
} from './canonicalCadV2ConsumerDraft';

export const AGENTIC_CAD_TOOL_REGISTRY_SCHEMA =
  'nexyfab.precision-cad.agent-tool-registry-consumer-draft.v1' as const;
export const AGENTIC_CAD_TOOL_REGISTRY_VERSION = 1 as const;

export const AGENTIC_CAD_TOOL_IDS = [
  'project.inspect',
  'document.query',
  'object.select',
  'requirements.validate',
  'feature.preview',
  'feature.commit',
  'sketch.solve.preview',
  'sketch.commit',
  'assembly.mate.preview',
  'assembly.mate.commit',
  'spatial.object.preview',
  'spatial.object.commit',
  'drawing.generate',
  'analysis.run',
  'domain.verify',
  'exchange.generate',
  'exchange.verify',
  'qualification.evaluate',
] as const;

export type AgenticCadToolId = typeof AGENTIC_CAD_TOOL_IDS[number];
export type AgenticCadToolPermission =
  | 'VIEW_DOCUMENT'
  | 'EDIT_DOCUMENT'
  | 'GENERATE_ARTIFACT'
  | 'VERIFY_DOCUMENT';
export type AgenticCadToolExecutionMode = 'QUERY' | 'SANDBOX' | 'AUTHORITATIVE';
export type AgenticCadToolSideEffect = 'NONE' | 'CANONICAL_MUTATION' | 'ARTIFACT_WRITE';
export type AgenticCadApprovalPolicy = 'NONE' | 'HUMAN_REQUIRED' | 'GOVERNED_ONLY';

export interface AgenticCadToolDescriptor {
  toolId: AgenticCadToolId;
  version: 1;
  domains: readonly CanonicalCadDomain[];
  inputSchema: string;
  outputSchema: string;
  permission: AgenticCadToolPermission;
  riskClass: CanonicalCadRiskClass;
  executionMode: AgenticCadToolExecutionMode;
  sideEffect: AgenticCadToolSideEffect;
  idempotency: 'REQUIRED' | 'NOT_APPLICABLE';
  resourceBudget: CanonicalCadResourceBudget;
  previewSupported: boolean;
  approvalPolicy: AgenticCadApprovalPolicy;
  verifierIds: readonly string[];
  compensation: 'NONE' | 'CANONICAL_COMMAND';
}

export interface AgenticCadToolRegistryDocument {
  schema: typeof AGENTIC_CAD_TOOL_REGISTRY_SCHEMA;
  version: typeof AGENTIC_CAD_TOOL_REGISTRY_VERSION;
  entries: readonly AgenticCadToolDescriptor[];
  registryHash: string;
}

const ALL_DOMAINS: readonly CanonicalCadDomain[] = [
  'mechanical', 'building', 'interior', 'civil', 'landscape', 'coordination',
];
const SPATIAL_DOMAINS: readonly CanonicalCadDomain[] = [
  'building', 'interior', 'civil', 'landscape', 'coordination',
];
const READ_BUDGET: CanonicalCadResourceBudget = {
  timeoutMs: 5_000, memoryMb: 128, maxIterations: 1, maxRetries: 0,
};
const SANDBOX_BUDGET: CanonicalCadResourceBudget = {
  timeoutMs: 30_000, memoryMb: 1_024, maxIterations: 64, maxRetries: 1,
};
const AUTHORITATIVE_BUDGET: CanonicalCadResourceBudget = {
  timeoutMs: 60_000, memoryMb: 2_048, maxIterations: 128, maxRetries: 0,
};

const schema = (name: string, kind: 'input' | 'output') =>
  `nexyfab.precision-cad.agent-tool.${name}.${kind}.consumer-draft.v1`;

function query(toolId: AgenticCadToolId, permission: AgenticCadToolPermission = 'VIEW_DOCUMENT'): AgenticCadToolDescriptor {
  return {
    toolId, version: 1, domains: ALL_DOMAINS,
    inputSchema: schema(toolId, 'input'), outputSchema: schema(toolId, 'output'),
    permission, riskClass: 'R0', executionMode: 'QUERY', sideEffect: 'NONE',
    idempotency: 'NOT_APPLICABLE', resourceBudget: READ_BUDGET,
    previewSupported: false, approvalPolicy: 'NONE', verifierIds: [], compensation: 'NONE',
  };
}

function sandbox(
  toolId: AgenticCadToolId,
  domains: readonly CanonicalCadDomain[] = ALL_DOMAINS,
  permission: AgenticCadToolPermission = 'VIEW_DOCUMENT',
  verifierIds: readonly string[] = [],
): AgenticCadToolDescriptor {
  return {
    toolId, version: 1, domains,
    inputSchema: schema(toolId, 'input'), outputSchema: schema(toolId, 'output'),
    permission, riskClass: 'R1', executionMode: 'SANDBOX', sideEffect: 'NONE',
    idempotency: 'REQUIRED', resourceBudget: SANDBOX_BUDGET,
    previewSupported: true, approvalPolicy: 'NONE', verifierIds, compensation: 'NONE',
  };
}

function authoritative(
  toolId: AgenticCadToolId,
  domains: readonly CanonicalCadDomain[] = ALL_DOMAINS,
  sideEffect: AgenticCadToolSideEffect = 'CANONICAL_MUTATION',
  permission: AgenticCadToolPermission = 'EDIT_DOCUMENT',
  verifierIds: readonly string[] = ['canonical-structure'],
): AgenticCadToolDescriptor {
  return {
    toolId, version: 1, domains,
    inputSchema: schema(toolId, 'input'), outputSchema: schema(toolId, 'output'),
    permission, riskClass: 'R3', executionMode: 'AUTHORITATIVE', sideEffect,
    idempotency: 'REQUIRED', resourceBudget: AUTHORITATIVE_BUDGET,
    previewSupported: true, approvalPolicy: 'HUMAN_REQUIRED', verifierIds,
    compensation: sideEffect === 'CANONICAL_MUTATION' ? 'CANONICAL_COMMAND' : 'NONE',
  };
}

const registryEntries: readonly AgenticCadToolDescriptor[] = [
  query('project.inspect'),
  query('document.query'),
  query('object.select'),
  sandbox('requirements.validate', ALL_DOMAINS, 'VERIFY_DOCUMENT', ['requirements-schema']),
  sandbox('feature.preview', ['mechanical'], 'EDIT_DOCUMENT', ['feature-preflight']),
  authoritative('feature.commit', ['mechanical'], 'CANONICAL_MUTATION', 'EDIT_DOCUMENT', ['feature-preflight', 'part-exact-brep']),
  sandbox('sketch.solve.preview', ['mechanical'], 'EDIT_DOCUMENT', ['sketch-constraints']),
  authoritative('sketch.commit', ['mechanical'], 'CANONICAL_MUTATION', 'EDIT_DOCUMENT', ['sketch-constraints', 'canonical-structure']),
  sandbox('assembly.mate.preview', ['mechanical'], 'EDIT_DOCUMENT', ['assembly-constraints']),
  authoritative('assembly.mate.commit', ['mechanical'], 'CANONICAL_MUTATION', 'EDIT_DOCUMENT', ['assembly-constraints', 'canonical-structure']),
  sandbox('spatial.object.preview', SPATIAL_DOMAINS, 'EDIT_DOCUMENT', ['spatial-schema']),
  authoritative('spatial.object.commit', SPATIAL_DOMAINS, 'CANONICAL_MUTATION', 'EDIT_DOCUMENT', ['spatial-schema', 'canonical-structure']),
  authoritative('drawing.generate', ALL_DOMAINS, 'ARTIFACT_WRITE', 'GENERATE_ARTIFACT', ['drawing-revision-binding']),
  sandbox('analysis.run', ALL_DOMAINS, 'VERIFY_DOCUMENT', ['analysis-input-binding']),
  sandbox('domain.verify', ALL_DOMAINS, 'VERIFY_DOCUMENT', ['domain-policy']),
  authoritative('exchange.generate', ALL_DOMAINS, 'ARTIFACT_WRITE', 'GENERATE_ARTIFACT', ['exchange-revision-binding']),
  sandbox('exchange.verify', ALL_DOMAINS, 'VERIFY_DOCUMENT', ['exchange-roundtrip']),
  sandbox('qualification.evaluate', ALL_DOMAINS, 'VERIFY_DOCUMENT', ['qualification-policy']),
];

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SCHEMA_ID = /^nexyfab\.precision-cad\.[a-z0-9._-]{1,190}$/;
const DESCRIPTOR_KEYS = [
  'toolId', 'version', 'domains', 'inputSchema', 'outputSchema', 'permission',
  'riskClass', 'executionMode', 'sideEffect', 'idempotency', 'resourceBudget',
  'previewSupported', 'approvalPolicy', 'verifierIds', 'compensation',
] as const;
const REGISTRY_KEYS = ['schema', 'version', 'entries', 'registryHash'] as const;
const BUDGET_KEYS = ['timeoutMs', 'memoryMb', 'maxIterations', 'maxRetries'] as const;
const TOOL_IDS = new Set<string>(AGENTIC_CAD_TOOL_IDS);
const DOMAINS = new Set<string>(ALL_DOMAINS);
const PERMISSIONS = new Set<string>(['VIEW_DOCUMENT', 'EDIT_DOCUMENT', 'GENERATE_ARTIFACT', 'VERIFY_DOCUMENT']);
const FORBIDDEN_AGENT_TOOLS = new Set(['release.publish', 'quote.create', 'rfq.send', 'purchase.send', 'construction.approve']);

function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor?.enumerable && 'value' in descriptor);
  });
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isDataArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) return false;
  return Reflect.ownKeys(value).every(key => {
    if (key === 'length') return true;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor?.enumerable && 'value' in descriptor);
  });
}

function validateBudget(value: unknown, path: string, issues: string[]): void {
  if (!isDataRecord(value) || !exactKeys(value, BUDGET_KEYS)) {
    issues.push(`${path}:keys`);
    return;
  }
  const bounds: Record<string, readonly [number, number]> = {
    timeoutMs: [1, 300_000], memoryMb: [16, 8_192], maxIterations: [1, 10_000], maxRetries: [0, 5],
  };
  for (const [key, [minimum, maximum]] of Object.entries(bounds)) {
    const candidate = value[key];
    if (!Number.isSafeInteger(candidate) || Number(candidate) < minimum || Number(candidate) > maximum) issues.push(`${path}:${key}`);
  }
}

function validateDescriptor(value: unknown, index: number, issues: string[]): void {
  const path = `entries[${index}]`;
  if (!isDataRecord(value) || !exactKeys(value, DESCRIPTOR_KEYS)) {
    issues.push(`${path}:keys`);
    return;
  }
  if (!TOOL_IDS.has(String(value.toolId)) || FORBIDDEN_AGENT_TOOLS.has(String(value.toolId))) issues.push(`${path}:toolId`);
  if (value.version !== 1) issues.push(`${path}:version`);
  if (!isDataArray(value.domains, ALL_DOMAINS.length) || value.domains.length === 0
    || value.domains.some(domain => !DOMAINS.has(String(domain)))
    || new Set(value.domains).size !== value.domains.length) issues.push(`${path}:domains`);
  if (typeof value.inputSchema !== 'string' || !SCHEMA_ID.test(value.inputSchema)
    || typeof value.outputSchema !== 'string' || !SCHEMA_ID.test(value.outputSchema)) issues.push(`${path}:schema`);
  if (!PERMISSIONS.has(String(value.permission))) issues.push(`${path}:permission`);
  if (!['R0', 'R1', 'R2', 'R3', 'R4'].includes(String(value.riskClass))) issues.push(`${path}:riskClass`);
  if (!['QUERY', 'SANDBOX', 'AUTHORITATIVE'].includes(String(value.executionMode))) issues.push(`${path}:executionMode`);
  if (!['NONE', 'CANONICAL_MUTATION', 'ARTIFACT_WRITE'].includes(String(value.sideEffect))) issues.push(`${path}:sideEffect`);
  if (!['REQUIRED', 'NOT_APPLICABLE'].includes(String(value.idempotency))) issues.push(`${path}:idempotency`);
  validateBudget(value.resourceBudget, `${path}:resourceBudget`, issues);
  if (typeof value.previewSupported !== 'boolean') issues.push(`${path}:previewSupported`);
  if (!['NONE', 'HUMAN_REQUIRED', 'GOVERNED_ONLY'].includes(String(value.approvalPolicy))) issues.push(`${path}:approvalPolicy`);
  if (!isDataArray(value.verifierIds, 32) || value.verifierIds.some(id => typeof id !== 'string' || !ID.test(id))
    || new Set(value.verifierIds).size !== value.verifierIds.length) issues.push(`${path}:verifierIds`);
  if (!['NONE', 'CANONICAL_COMMAND'].includes(String(value.compensation))) issues.push(`${path}:compensation`);

  if (value.executionMode === 'QUERY' && (value.riskClass !== 'R0' || value.sideEffect !== 'NONE' || value.approvalPolicy !== 'NONE')) issues.push(`${path}:queryPolicy`);
  if (value.executionMode === 'SANDBOX' && (value.riskClass !== 'R1' || value.sideEffect !== 'NONE' || value.approvalPolicy !== 'NONE')) issues.push(`${path}:sandboxPolicy`);
  if (value.executionMode === 'AUTHORITATIVE' && (value.riskClass !== 'R3' || value.sideEffect === 'NONE' || value.approvalPolicy !== 'HUMAN_REQUIRED')) issues.push(`${path}:authoritativePolicy`);
  if (value.riskClass === 'R4' || value.approvalPolicy === 'GOVERNED_ONLY') issues.push(`${path}:governedToolForbidden`);
}

function sha256(value: string): string {
  const hash = new Sha256();
  hash.update(value);
  return Array.from(hash.digestSync(), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function hashAgenticCadToolRegistry(entries: readonly AgenticCadToolDescriptor[]): string {
  return sha256(`nexyfab.precision-cad.agent-tool-registry.sha256.v1\n${canonicalCadConsumerDraftJson({
    schema: AGENTIC_CAD_TOOL_REGISTRY_SCHEMA,
    version: AGENTIC_CAD_TOOL_REGISTRY_VERSION,
    entries,
  })}`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const frozenEntries = deepFreeze(structuredClone(registryEntries)) as readonly AgenticCadToolDescriptor[];
export const AGENTIC_CAD_TOOL_REGISTRY_HASH = hashAgenticCadToolRegistry(frozenEntries);
export const AGENTIC_CAD_TOOL_REGISTRY: AgenticCadToolRegistryDocument = deepFreeze({
  schema: AGENTIC_CAD_TOOL_REGISTRY_SCHEMA,
  version: AGENTIC_CAD_TOOL_REGISTRY_VERSION,
  entries: frozenEntries,
  registryHash: AGENTIC_CAD_TOOL_REGISTRY_HASH,
});

export function validateAgenticCadToolRegistry(input: unknown): string[] {
  const issues: string[] = [];
  try {
    if (!isDataRecord(input) || !exactKeys(input, REGISTRY_KEYS)) return ['registry:keys'];
    if (input.schema !== AGENTIC_CAD_TOOL_REGISTRY_SCHEMA) issues.push('registry:schema');
    if (input.version !== AGENTIC_CAD_TOOL_REGISTRY_VERSION) issues.push('registry:version');
    if (!isDataArray(input.entries, AGENTIC_CAD_TOOL_IDS.length)) issues.push('registry:entries');
    else {
      input.entries.forEach((entry, index) => validateDescriptor(entry, index, issues));
      const ids = input.entries.flatMap(entry => isDataRecord(entry) && typeof entry.toolId === 'string' ? [entry.toolId] : []);
      if (new Set(ids).size !== ids.length) issues.push('registry:duplicateToolId');
      const missing = AGENTIC_CAD_TOOL_IDS.filter(id => !ids.includes(id));
      if (missing.length) issues.push(...missing.map(id => `registry:missing:${id}`));
    }
    if (typeof input.registryHash !== 'string' || !SHA256.test(input.registryHash)) issues.push('registry:hash');
    else if (isDataArray(input.entries, AGENTIC_CAD_TOOL_IDS.length)) {
      try {
        if (input.registryHash !== hashAgenticCadToolRegistry(input.entries as unknown as AgenticCadToolDescriptor[])) issues.push('registry:hashMismatch');
      } catch {
        issues.push('registry:hashMismatch');
      }
    }
  } catch {
    return ['registry:unreadable'];
  }
  return [...new Set(issues)].slice(0, 128);
}

export function getAgenticCadToolDescriptor(toolId: string): AgenticCadToolDescriptor | null {
  if (!TOOL_IDS.has(toolId)) return null;
  const descriptor = frozenEntries.find(entry => entry.toolId === toolId);
  return descriptor ? structuredClone(descriptor) : null;
}
