import { randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  hashCadWorkspaceEnvelope,
  readAuthoritativeWorkspaceHead,
  readCadWorkspaceRevision,
  validateCadWorkspaceEnvelope,
  type StoredCadWorkspaceEnvelope,
} from '@/lib/cad/workspaceRevisionStore';
import {
  CanonicalCadHydrationError,
  readAuthoritativeCanonicalCadGeometryMapping as readPersistedCanonicalCadGeometryMapping,
} from '@/lib/cad/canonicalCadBrepHydration';
import { signAgentSession } from './sessionIntegrity';
import { makeInitialBudget } from './budget';
import { SCAD_AGENT_SYSTEM_PROMPT } from './systemPrompt';
import type {
  AgentSession,
  BrepEntry,
  CadSessionBootstrapBinding,
  CadSessionOwnership,
} from './types';

/** A mapping is only usable when it was emitted by an authoritative geometry store. */
export const CAD_BREP_MAPPING_SCHEMA = 'nexyfab.cad-canonical-brep-mapping.v1' as const;
export const CAD_SESSION_BOOTSTRAP_SCHEMA = 'nexyfab.cad-session-bootstrap.v1' as const;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_BREP_HANDLE = /^(?:occt|cadref):[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAX_PARTS = 500;

type OwnershipMapKey = 'featureIds' | 'sketchIds' | 'entityIds' | 'faceIds' | 'edgeIds';

export interface CanonicalCadPartBinding {
  partId: string;
  brepHandle: string;
  kind: string;
  label?: string;
  artifactId: string;
  handleProvenance: CanonicalCadHandleProvenance;
  featureIds?: string[];
  sketchIds?: string[];
  entityIds?: string[];
  faceIds?: string[];
  edgeIds?: string[];
  mateIds?: string[];
}

export interface CanonicalCadHandleProvenance {
  sourceRecordId: string;
  artifactId: string;
  artifactContentHash: string;
  artifactShapeIdentityHash: string;
  /** Stable canonical ref is signed; runtimeHandle is a worker-local cache. */
  canonicalHandle?: string;
  runtimeHandle?: string;
  runtimeIdentity?: string;
}

/**
 * Server-produced mapping from a persisted workspace geometry artifact to the
 * process-local OCCT handles it has explicitly hydrated.  The current
 * workspace/artifact stores persist this record; the runtime handle is
 * rehydrated from the immutable artifact when a process-local registry is
 * cold.
 */
export interface CanonicalCadGeometryMapping {
  schema: typeof CAD_BREP_MAPPING_SCHEMA;
  projectId: string;
  workspaceId: string;
  revision: number;
  workspaceContentHash: string;
  geometryContentHash: string;
  shapeIdentityHash: string;
  parts: CanonicalCadPartBinding[];
  sourceRecordId: string;
}

export type PrecisionCadBootstrapBinding = Pick<
  CadSessionBootstrapBinding,
  'schema' | 'projectId' | 'workspaceId' | 'workspaceRevision' | 'workspaceContentHash'
> & {
  geometryContentHash: string;
  shapeIdentityHash: string;
};

export type PrecisionCadBootstrapHoldCode =
  | 'INVALID_BOOTSTRAP_BINDING'
  | 'WORKSPACE_HEAD_NOT_FOUND'
  | 'WORKSPACE_STORE_UNAVAILABLE'
  | 'STALE_WORKSPACE_REVISION'
  | 'STALE_WORKSPACE_HASH'
  | 'WORKSPACE_REVISION_NOT_FOUND'
  | 'AUTHORITATIVE_WORKSPACE_INVALID'
  | 'CANONICAL_BREP_MAPPING_MISSING'
  | 'CANONICAL_BREP_MAPPING_INVALID'
  | 'CANONICAL_BREP_MAPPING_STORE_UNAVAILABLE'
  | 'CANONICAL_BREP_ARTIFACT_MISSING'
  | 'CANONICAL_BREP_ARTIFACT_BINDING_MISMATCH'
  | 'CANONICAL_BREP_HYDRATION_FAILED'
  | 'CANONICAL_BREP_GEOMETRY_AMBIGUOUS'
  | 'SESSION_SIGNING_UNAVAILABLE';

export type PrecisionCadBootstrapResult =
  | {
      ok: true;
      status: 'READY';
      binding: CadSessionBootstrapBinding;
      ownership: CadSessionOwnership;
      session: AgentSession;
      mapping: CanonicalCadGeometryMapping;
    }
  | {
      ok: false;
      status: 'HOLD';
      code: PrecisionCadBootstrapHoldCode;
      reason: string;
      current?: { revision: number; contentHash: string };
    };

export interface CanonicalCadGeometryMappingReaderInput {
  db: DbAdapter;
  projectId: string;
  revision: number;
  workspaceContentHash: string;
  envelope: StoredCadWorkspaceEnvelope;
}

export type CanonicalCadGeometryMappingReader = (
  input: CanonicalCadGeometryMappingReaderInput,
) => Promise<unknown | null>;

/**
 * Default production adapter.  No existing table stores the runtime-handle ↔
 * canonical-part mapping, so returning null is intentional and fail-closed.
 * A deployment may inject a reader backed by an authoritative geometry store
 * once that store is available; a client payload is never a valid reader.
 */
// The reader returns canonical refs only; worker-local OCCT hydration happens
// on a verified continuation request, never from client-supplied handles.
export const readAuthoritativeCanonicalCadGeometryMapping: CanonicalCadGeometryMappingReader = async input =>
  readPersistedCanonicalCadGeometryMapping(input);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function id(value: unknown): string | null {
  const candidate = text(value);
  return candidate && SAFE_ID.test(candidate) ? candidate : null;
}

function hash(value: unknown): string | null {
  const candidate = text(value)?.toLowerCase() ?? null;
  return candidate && SHA256.test(candidate) ? candidate : null;
}

function list(value: unknown, max = MAX_PARTS): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const values = value.map(item => id(item));
  if (values.some(item => !item)) return null;
  const unique = [...new Set(values as string[])];
  return unique.length === values.length ? unique : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return record(value) ? value : null;
}

/**
 * Validate and normalize a mapping returned by the server-side adapter.
 * Handles, ownership maps, revision, and all hashes must be explicit in that
 * record; this function never derives an id from a label, array index, or
 * hash.  It is exported for adapter and fixture tests, not for API payloads.
 */
export function normalizeCanonicalCadGeometryMapping(
  value: unknown,
  expected: {
    projectId: string;
    revision: number;
    workspaceContentHash: string;
    geometryContentHash: string;
    shapeIdentityHash: string;
  },
): CanonicalCadGeometryMapping | null {
  const raw = asRecord(value);
  if (!raw || raw.schema !== CAD_BREP_MAPPING_SCHEMA) return null;
  const projectId = id(raw.projectId);
  const workspaceId = id(raw.workspaceId);
  const revision = raw.revision;
  const workspaceContentHash = hash(raw.workspaceContentHash);
  const geometryContentHash = hash(raw.geometryContentHash);
  const shapeIdentityHash = hash(raw.shapeIdentityHash);
  const sourceRecordId = id(raw.sourceRecordId);
  if (!projectId || !workspaceId || projectId !== expected.projectId || workspaceId !== expected.projectId
    || !Number.isSafeInteger(revision) || revision !== expected.revision
    || workspaceContentHash !== expected.workspaceContentHash
    || geometryContentHash !== expected.geometryContentHash
    || shapeIdentityHash !== expected.shapeIdentityHash
    || !sourceRecordId) return null;

  const rawParts = raw.parts;
  if (!Array.isArray(rawParts) || rawParts.length === 0 || rawParts.length > MAX_PARTS) return null;
  const parts: CanonicalCadPartBinding[] = [];
  const partIds = new Set<string>();
  const handles = new Set<string>();
  for (const candidate of rawParts) {
    const part = asRecord(candidate);
    if (!part) return null;
    const partId = id(part.partId);
    const brepHandle = text(part.brepHandle);
    const kind = text(part.kind);
    const label = part.label === undefined ? undefined : text(part.label);
    const artifactId = id(part.artifactId);
    const provenance = asRecord(part.handleProvenance);
    const provenanceSourceRecordId = id(provenance?.sourceRecordId);
    const provenanceArtifactId = id(provenance?.artifactId);
    const provenanceContentHash = hash(provenance?.artifactContentHash);
    const provenanceShapeIdentityHash = hash(provenance?.artifactShapeIdentityHash);
    const provenanceCanonicalHandle = text(provenance?.canonicalHandle);
    const provenanceRuntimeHandle = text(provenance?.runtimeHandle);
    if (!partId || !brepHandle || !SAFE_BREP_HANDLE.test(brepHandle) || !kind
      || (part.label !== undefined && !label) || !artifactId
      || !provenance || provenanceSourceRecordId !== sourceRecordId
      || provenanceArtifactId !== artifactId
      || !provenanceContentHash
      || !provenanceShapeIdentityHash
      || (provenanceCanonicalHandle !== null && provenanceCanonicalHandle !== brepHandle)
      || (provenanceRuntimeHandle !== null && !SAFE_BREP_HANDLE.test(provenanceRuntimeHandle))
      || (provenanceRuntimeHandle !== null && provenanceRuntimeHandle === brepHandle && brepHandle.startsWith('cadref:'))
      || partIds.has(partId) || handles.has(brepHandle)) {
      return null;
    }
    const normalized: CanonicalCadPartBinding = {
      partId,
      brepHandle,
      kind,
      artifactId,
      handleProvenance: {
        sourceRecordId,
        artifactId,
        artifactContentHash: provenanceContentHash,
        artifactShapeIdentityHash: provenanceShapeIdentityHash,
        ...(provenanceCanonicalHandle ? { canonicalHandle: provenanceCanonicalHandle } : {}),
        ...(provenanceRuntimeHandle ? { runtimeHandle: provenanceRuntimeHandle } : {}),
        ...(id(provenance?.runtimeIdentity) ? { runtimeIdentity: id(provenance?.runtimeIdentity)! } : {}),
      },
    };
    if (label) normalized.label = label;
    for (const key of ['featureIds', 'sketchIds', 'entityIds', 'faceIds', 'edgeIds', 'mateIds'] as const) {
      if (part[key] === undefined) continue;
      const values = list(part[key]);
      if (!values) return null;
      normalized[key] = values;
    }
    partIds.add(partId);
    handles.add(brepHandle);
    parts.push(normalized);
  }
  return {
    schema: CAD_BREP_MAPPING_SCHEMA,
    projectId,
    workspaceId,
    revision,
    workspaceContentHash,
    geometryContentHash,
    shapeIdentityHash,
    parts,
    sourceRecordId,
  };
}

function ownerMap(
  parts: readonly CanonicalCadPartBinding[],
  key: OwnershipMapKey,
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const part of parts) {
    for (const reference of part[key] ?? []) {
      const previous = result[reference];
      if (previous && previous !== part.partId) return undefined;
      result[reference] = part.partId;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function mateOwners(parts: readonly CanonicalCadPartBinding[]): Record<string, string[]> | undefined {
  const result: Record<string, string[]> = {};
  for (const part of parts) {
    for (const mateId of part.mateIds ?? []) {
      const owners = result[mateId] ?? (result[mateId] = []);
      if (!owners.includes(part.partId)) owners.push(part.partId);
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export function ownershipFromCanonicalCadGeometryMapping(
  mapping: CanonicalCadGeometryMapping,
): CadSessionOwnership | null {
  const brepHandles: Record<string, string> = {};
  for (const part of mapping.parts) {
    if (brepHandles[part.brepHandle] && brepHandles[part.brepHandle] !== part.partId) return null;
    brepHandles[part.brepHandle] = part.partId;
  }
  const ownership: CadSessionOwnership = {
    schema: 'nexyfab.cad-session-ownership.v1',
    partIds: mapping.parts.map(part => part.partId),
    brepHandles,
  };
  const maps: OwnershipMapKey[] = ['featureIds', 'sketchIds', 'entityIds', 'faceIds', 'edgeIds'];
  for (const key of maps) {
    const values = ownerMap(mapping.parts, key);
    if (values === undefined && mapping.parts.some(part => (part[key] ?? []).length > 0)) return null;
    if (values) ownership[key] = values;
  }
  const mates = mateOwners(mapping.parts);
  if (mates) ownership.mateIds = mates;
  return ownership;
}

function createSession(
  binding: CadSessionBootstrapBinding,
  mapping: CanonicalCadGeometryMapping,
  ownership: CadSessionOwnership,
): AgentSession {
  const now = binding.bootstrappedAt;
  const brepEntries: BrepEntry[] = mapping.parts.map(part => ({
    handle: part.brepHandle,
    kind: part.kind,
    ...(part.label ? { label: part.label } : {}),
    partId: part.partId,
    ts: now,
  }));
  return {
    id: `agent_${randomUUID()}`,
    scadSource: '',
    modules: {},
    composition: null,
    designPlan: null,
    checkpoints: [],
    brepEntries,
    cadOwnership: ownership,
    cadBootstrap: binding,
    sketches: {},
    mates: [],
    gdtFrames: [],
    docRefs: [],
    history: [{ role: 'system', content: SCAD_AGENT_SYSTEM_PROMPT }],
    render: { ok: null, errors: [] },
    geometry: {},
    budget: makeInitialBudget(),
    status: 'idle',
  };
}

function hold(
  code: PrecisionCadBootstrapHoldCode,
  reason: string,
  current?: { revision: number; contentHash: string },
): PrecisionCadBootstrapResult {
  return { ok: false, status: 'HOLD', code, reason, ...(current ? { current } : {}) };
}

function validRequestedBinding(input: { projectId: string; revision: number; contentHash: string }): boolean {
  return id(input.projectId) === input.projectId
    && Number.isSafeInteger(input.revision) && input.revision >= 0
    && SHA256.test(input.contentHash);
}

/**
 * Load a canonical workspace revision, resolve an authoritative BREP mapping,
 * and return a signed fresh SCAD agent session.  This function performs the
 * CAS/hash checks before consulting the mapping reader.  It intentionally does
 * not accept any client ownership assertion.
 */
export async function bootstrapPrecisionCadSession(input: {
  db: DbAdapter;
  userId: string;
  projectId: string;
  revision: number;
  contentHash: string;
  now?: number;
  readMapping?: CanonicalCadGeometryMappingReader;
}): Promise<PrecisionCadBootstrapResult> {
  const requestedHash = input.contentHash.toLowerCase();
  if (!validRequestedBinding({ ...input, contentHash: requestedHash })) {
    return hold('INVALID_BOOTSTRAP_BINDING', 'project, revision, and workspace content hash are required');
  }
  let head: Awaited<ReturnType<typeof readAuthoritativeWorkspaceHead>>;
  try {
    head = await readAuthoritativeWorkspaceHead(input.db, input.projectId);
  } catch {
    return hold('WORKSPACE_STORE_UNAVAILABLE', 'authoritative workspace head could not be read');
  }
  if (!head) return hold('WORKSPACE_HEAD_NOT_FOUND', 'no authoritative workspace head exists for this project');
  const current = { revision: head.revision, contentHash: head.contentHash };
  if (head.revision !== input.revision) return hold('STALE_WORKSPACE_REVISION', 'workspace revision is stale', current);
  if (head.contentHash !== requestedHash) return hold('STALE_WORKSPACE_HASH', 'workspace content hash is stale', current);

  let envelope: StoredCadWorkspaceEnvelope | null;
  try {
    envelope = await readCadWorkspaceRevision(input.db, input.projectId, input.revision);
  } catch {
    return hold('WORKSPACE_STORE_UNAVAILABLE', 'authoritative workspace revision could not be read', current);
  }
  if (!envelope) return hold('WORKSPACE_REVISION_NOT_FOUND', 'authoritative workspace revision does not exist', current);
  const { contentHash: storedHash, ...storedInput } = envelope;
  const envelopeIssues = validateCadWorkspaceEnvelope(storedInput);
  if (storedHash !== head.contentHash || hashCadWorkspaceEnvelope(storedInput) !== storedHash
    || envelope.workspace.projectId !== input.projectId || envelope.workspace.revision !== input.revision
    || envelopeIssues.length > 0) {
    return hold('AUTHORITATIVE_WORKSPACE_INVALID', 'workspace revision failed its stored hash or envelope validation', current);
  }

  let rawMapping: unknown | null = null;
  try {
    rawMapping = await (input.readMapping ?? readAuthoritativeCanonicalCadGeometryMapping)({
      db: input.db,
      projectId: input.projectId,
      revision: input.revision,
      workspaceContentHash: head.contentHash,
      envelope,
    });
  } catch (error) {
    if (error instanceof CanonicalCadHydrationError) {
      const code: PrecisionCadBootstrapHoldCode = error.code === 'STORE_UNAVAILABLE'
        ? 'CANONICAL_BREP_MAPPING_STORE_UNAVAILABLE'
        : error.code === 'MAPPING_RECORD_INVALID'
          ? 'CANONICAL_BREP_MAPPING_INVALID'
        : error.code === 'ARTIFACT_MISSING'
          ? 'CANONICAL_BREP_ARTIFACT_MISSING'
          : error.code === 'ARTIFACT_BINDING_MISMATCH'
            ? 'CANONICAL_BREP_ARTIFACT_BINDING_MISMATCH'
            : error.code === 'AMBIGUOUS_GEOMETRY'
              ? 'CANONICAL_BREP_GEOMETRY_AMBIGUOUS'
              : 'CANONICAL_BREP_HYDRATION_FAILED';
      return hold(code, error.message, current);
    }
    return hold('CANONICAL_BREP_MAPPING_STORE_UNAVAILABLE', 'authoritative CAD geometry mapping could not be read', current);
  }
  if (!rawMapping) return hold('CANONICAL_BREP_MAPPING_MISSING', 'no authoritative workspace-to-BREP mapping exists', current);
  const mapping = normalizeCanonicalCadGeometryMapping(rawMapping, {
    projectId: input.projectId,
    revision: input.revision,
    workspaceContentHash: head.contentHash,
    geometryContentHash: envelope.geometry.contentHash,
    shapeIdentityHash: envelope.geometry.shapeIdentityHash,
  });
  if (!mapping) return hold('CANONICAL_BREP_MAPPING_INVALID', 'authoritative CAD geometry mapping is invalid or stale', current);
  const ownership = ownershipFromCanonicalCadGeometryMapping(mapping);
  if (!ownership) return hold('CANONICAL_BREP_MAPPING_INVALID', 'authoritative CAD geometry ownership is ambiguous', current);

  const now = input.now ?? Date.now();
  const binding: CadSessionBootstrapBinding = {
    schema: CAD_SESSION_BOOTSTRAP_SCHEMA,
    projectId: input.projectId,
    workspaceId: input.projectId,
    workspaceRevision: input.revision,
    workspaceContentHash: head.contentHash,
    geometryContentHash: envelope.geometry.contentHash,
    shapeIdentityHash: envelope.geometry.shapeIdentityHash,
    bootstrappedAt: now,
  };
  const session = createSession(binding, mapping, ownership);
  try {
    signAgentSession(session, input.userId);
  } catch {
    return hold('SESSION_SIGNING_UNAVAILABLE', 'SCAD session signing is not configured', current);
  }
  return { ok: true, status: 'READY', binding, ownership, session, mapping };
}

/** Short alias for route adapters and callers that prefer an explicit name. */
export const createPrecisionCadBootstrap = bootstrapPrecisionCadSession;
