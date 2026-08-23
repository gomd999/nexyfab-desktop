import type { SpaceDesignLabDomainId } from '@/lib/ai/domainProfile';

export const SPATIAL_CAD_DOCUMENT_SCHEMA = 'nexyfab.spatial-cad-document.v1' as const;
export const SPATIAL_CAD_COMMAND_SCHEMA = 'nexyfab.spatial-cad-command.v1' as const;

export type SpatialCadDomain = SpaceDesignLabDomainId | 'coordination';
export type SpatialCadValue = string | number | boolean | null | SpatialCadValue[] | { [key: string]: SpatialCadValue };
export type SpatialCadParameters = Record<string, SpatialCadValue>;

export interface SpatialCadDocument<P extends SpatialCadParameters = SpatialCadParameters> {
  schema: typeof SPATIAL_CAD_DOCUMENT_SCHEMA;
  domain: SpatialCadDomain;
  revision: number;
  parameters: P;
  verification: 'NOT_RUN';
  updatedBy: 'human' | 'ai';
}

export type SpatialCadOperation =
  | { kind: 'set_parameter'; key: string; value: SpatialCadValue }
  | { kind: 'replace_parameters'; parameters: SpatialCadParameters };

export interface SpatialCadCommand {
  schema: typeof SPATIAL_CAD_COMMAND_SCHEMA;
  commandId: string;
  domain: SpatialCadDomain;
  baseRevision: number;
  actor: 'human' | 'ai';
  operation: SpatialCadOperation;
}

export type SpatialCadTransaction<P extends SpatialCadParameters = SpatialCadParameters> =
  | { committed: true; document: SpatialCadDocument<P>; changedPaths: string[]; issues: [] }
  | { committed: false; document: SpatialCadDocument<P>; changedPaths: []; issues: string[] };

const DOMAINS = new Set<SpatialCadDomain>(['building', 'civil', 'landscape', 'interior', 'coordination']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 12;
const MAX_KEYS = 256;

function isSafeValue(value: unknown, depth = 0, count = { value: 0 }): value is SpatialCadValue {
  if (depth > MAX_DEPTH || ++count.value > MAX_KEYS) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return typeof value !== 'string' || value.length <= 10_000;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= MAX_KEYS && value.every(item => isSafeValue(item, depth + 1, count));
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(value).every(([key, item]) => (
    key.length > 0 && key.length <= 120 && !FORBIDDEN_KEYS.has(key) && isSafeValue(item, depth + 1, count)
  ));
}

function isSafeParameters(value: unknown): value is SpatialCadParameters {
  return !!value && typeof value === 'object' && !Array.isArray(value) && isSafeValue(value);
}

function cloneParameters<P extends SpatialCadParameters>(parameters: P): P {
  return structuredClone(parameters);
}

export function createSpatialCadDocument<P extends SpatialCadParameters>(
  domain: SpatialCadDomain,
  parameters: P,
  actor: 'human' | 'ai' = 'human',
): SpatialCadDocument<P> {
  if (!DOMAINS.has(domain) || !isSafeParameters(parameters)) throw new Error('invalid_spatial_cad_document');
  return {
    schema: SPATIAL_CAD_DOCUMENT_SCHEMA,
    domain,
    revision: 0,
    parameters: cloneParameters(parameters),
    verification: 'NOT_RUN',
    updatedBy: actor,
  };
}

export function validateSpatialCadDocument(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['invalid_document'];
  const document = value as Partial<SpatialCadDocument>;
  const issues: string[] = [];
  if (document.schema !== SPATIAL_CAD_DOCUMENT_SCHEMA) issues.push('invalid_document_schema');
  if (!DOMAINS.has(document.domain as SpatialCadDomain)) issues.push('invalid_document_domain');
  if (!Number.isSafeInteger(document.revision) || (document.revision ?? -1) < 0) issues.push('invalid_document_revision');
  if (!isSafeParameters(document.parameters)) issues.push('invalid_document_parameters');
  if (document.verification !== 'NOT_RUN') issues.push('invalid_document_verification');
  if (document.updatedBy !== 'human' && document.updatedBy !== 'ai') issues.push('invalid_document_actor');
  return issues;
}

export function validateSpatialCadCommand(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['invalid_command'];
  const command = value as Partial<SpatialCadCommand>;
  const issues: string[] = [];
  if (command.schema !== SPATIAL_CAD_COMMAND_SCHEMA) issues.push('invalid_command_schema');
  if (!command.commandId?.trim() || command.commandId.length > 160) issues.push('invalid_command_id');
  if (!DOMAINS.has(command.domain as SpatialCadDomain)) issues.push('invalid_command_domain');
  if (!Number.isSafeInteger(command.baseRevision) || (command.baseRevision ?? -1) < 0) issues.push('invalid_base_revision');
  if (command.actor !== 'human' && command.actor !== 'ai') issues.push('invalid_command_actor');
  const operation = command.operation;
  if (!operation || (operation.kind !== 'set_parameter' && operation.kind !== 'replace_parameters')) {
    issues.push('invalid_command_operation');
  } else if (operation.kind === 'set_parameter') {
    if (!operation.key.trim() || operation.key.length > 120 || FORBIDDEN_KEYS.has(operation.key)) issues.push('invalid_parameter_key');
    if (!isSafeValue(operation.value)) issues.push('invalid_parameter_value');
  } else if (!isSafeParameters(operation.parameters)) {
    issues.push('invalid_replacement_parameters');
  }
  return issues;
}

export function applySpatialCadCommand<P extends SpatialCadParameters>(
  document: SpatialCadDocument<P>,
  command: SpatialCadCommand,
): SpatialCadTransaction<P> {
  const issues = [...validateSpatialCadDocument(document), ...validateSpatialCadCommand(command)];
  if (document.domain !== command.domain) issues.push('domain_mismatch');
  if (document.revision !== command.baseRevision) issues.push('stale_base_revision');
  if (issues.length) return { committed: false, document, changedPaths: [], issues: [...new Set(issues)] };

  const current = cloneParameters(document.parameters);
  let parameters: SpatialCadParameters;
  let changedPaths: string[];
  if (command.operation.kind === 'set_parameter') {
    parameters = { ...current, [command.operation.key]: structuredClone(command.operation.value) };
    changedPaths = [`parameters.${command.operation.key}`];
  } else {
    parameters = cloneParameters(command.operation.parameters);
    const keys = [...new Set([...Object.keys(current), ...Object.keys(parameters)])].sort();
    changedPaths = keys.filter(key => JSON.stringify(current[key]) !== JSON.stringify(parameters[key])).map(key => `parameters.${key}`);
  }
  if (!changedPaths.length) return { committed: false, document, changedPaths: [], issues: ['no_effect'] };

  return {
    committed: true,
    document: {
      ...document,
      revision: document.revision + 1,
      parameters: parameters as P,
      verification: 'NOT_RUN',
      updatedBy: command.actor,
    },
    changedPaths,
    issues: [],
  };
}

