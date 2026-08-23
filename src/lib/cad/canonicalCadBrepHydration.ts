import { createHash, randomUUID } from 'node:crypto';
import type { StorageAdapter } from '@/lib/storage';
import { getStorage } from '@/lib/storage';
import { readAuthoritativeCadArtifact } from '@/lib/artifacts/directArtifactUploadStore';
import type { CadArtifact } from '../../../packages/artifact-contracts/src/index';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  hashCadWorkspaceEnvelope,
  readAuthoritativeWorkspaceHead,
  readCadWorkspaceRevision,
  validateCadWorkspaceEnvelope,
  type StoredCadWorkspaceEnvelope,
} from './workspaceRevisionStore';
import {
  ensureCanonicalCadBrepMappingTables,
  insertCanonicalCadBrepMapping,
  readCanonicalCadBrepMapping,
  updateCanonicalCadBrepMappingRuntime,
  type CanonicalCadBrepMappingStoreKey,
  type CanonicalCadBrepMappingStoreRecord,
} from './canonicalCadBrepMappingStore';
import type {
  CanonicalCadGeometryMapping,
  CanonicalCadHandleProvenance,
  CanonicalCadPartBinding,
} from '@/lib/ai/scad-agent/precisionCadSessionBootstrap';
import type { AgentSession } from '@/lib/ai/scad-agent/types';

const CAD_BREP_MAPPING_SCHEMA = 'nexyfab.cad-canonical-brep-mapping.v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_RUNTIME_HANDLE = /^occt:[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STEP_FORMATS = new Set(['step', 'stp']);

export type CanonicalCadHydrationErrorCode =
  | 'STORE_UNAVAILABLE'
  | 'MAPPING_MISSING'
  | 'ARTIFACT_MISSING'
  | 'ARTIFACT_BINDING_MISMATCH'
  | 'ARTIFACT_BYTES_UNAVAILABLE'
  | 'OCCT_IMPORT_FAILED'
  | 'AMBIGUOUS_GEOMETRY'
  | 'MAPPING_RECORD_INVALID'
  | 'STALE_WORKSPACE';

/** Typed failure lets bootstrap and continuation routes fail closed. */
export class CanonicalCadHydrationError extends Error {
  readonly code: CanonicalCadHydrationErrorCode;

  constructor(code: CanonicalCadHydrationErrorCode, message: string) {
    super(message);
    this.name = 'CanonicalCadHydrationError';
    this.code = code;
  }
}

export interface CanonicalCadMappingReaderInput {
  db: DbAdapter;
  projectId: string;
  revision: number;
  workspaceContentHash: string;
  envelope: StoredCadWorkspaceEnvelope;
  /** Optional test seam; production uses configured private object storage. */
  storage?: StorageAdapter;
}

export interface CanonicalCadRuntimeHydrationInput extends CanonicalCadMappingReaderInput {
  /** Per-request worker/runtime identity. Never supplied by the client. */
  runtimeIdentity: string;
}

export interface AuthoritativeCadPartManifest {
  partId: string;
  kind: string;
  artifactId: string;
  artifactContentHash: string;
  artifactShapeIdentityHash: string;
  label?: string;
  featureIds?: string[];
  sketchIds?: string[];
  entityIds?: string[];
  faceIds?: string[];
  edgeIds?: string[];
  mateIds?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hash(value: unknown): string | null {
  const candidate = text(value)?.toLowerCase() ?? null;
  return candidate && SHA256.test(candidate) ? candidate : null;
}

function id(value: unknown): string | null {
  const candidate = text(value);
  return candidate && SAFE_ID.test(candidate) ? candidate : null;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectedKey(input: CanonicalCadMappingReaderInput): CanonicalCadBrepMappingStoreKey {
  return {
    projectId: input.projectId,
    workspaceId: input.projectId,
    revision: input.revision,
    workspaceContentHash: input.workspaceContentHash,
    geometryContentHash: input.envelope.geometry.contentHash,
    shapeIdentityHash: input.envelope.geometry.shapeIdentityHash,
  };
}

async function ensureStore(db: DbAdapter): Promise<void> {
  try {
    await ensureCanonicalCadBrepMappingTables(db);
  } catch (error) {
    if (!db || (db as Partial<DbAdapter>).backend === undefined) return;
    throw new CanonicalCadHydrationError('STORE_UNAVAILABLE', error instanceof Error ? error.message : 'mapping store unavailable');
  }
}

async function readMappingRecord(
  input: CanonicalCadMappingReaderInput,
): Promise<{ key: CanonicalCadBrepMappingStoreKey; record: CanonicalCadBrepMappingStoreRecord }> {
  const key = expectedKey(input);
  await ensureStore(input.db);
  let record: CanonicalCadBrepMappingStoreRecord | null;
  try {
    record = await readCanonicalCadBrepMapping(input.db, key);
  } catch (error) {
    throw new CanonicalCadHydrationError('STORE_UNAVAILABLE', error instanceof Error ? error.message : 'mapping record could not be read');
  }
  if (!record) throw new CanonicalCadHydrationError('MAPPING_MISSING', 'no authoritative canonical part manifest exists');
  return { key, record };
}

function parseMappingRecord(
  record: CanonicalCadBrepMappingStoreRecord,
  key: CanonicalCadBrepMappingStoreKey,
): CanonicalCadGeometryMapping {
  let raw: unknown;
  try {
    raw = JSON.parse(record.mappingJson) as unknown;
  } catch {
    throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'stored canonical mapping JSON is invalid');
  }
  if (!isRecord(raw)
    || raw.schema !== CAD_BREP_MAPPING_SCHEMA
    || raw.projectId !== key.projectId
    || raw.workspaceId !== key.workspaceId
    || raw.revision !== key.revision
    || raw.workspaceContentHash !== key.workspaceContentHash
    || raw.geometryContentHash !== key.geometryContentHash
    || raw.shapeIdentityHash !== key.shapeIdentityHash
    || raw.sourceRecordId !== record.sourceRecordId
    || record.projectId !== key.projectId
    || record.workspaceId !== key.workspaceId
    || record.revision !== key.revision
    || record.workspaceContentHash !== key.workspaceContentHash
    || record.geometryContentHash !== key.geometryContentHash
    || record.shapeIdentityHash !== key.shapeIdentityHash
    || record.artifactContentHash !== key.geometryContentHash
    || record.artifactShapeIdentityHash !== key.shapeIdentityHash
    || !SHA256.test(record.artifactContentHash)
    || !SHA256.test(record.artifactShapeIdentityHash)) {
    throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'stored canonical mapping identity is stale or ambiguous');
  }
  const sourceRecordId = id(raw.sourceRecordId);
  if (!sourceRecordId || !Array.isArray(raw.parts) || raw.parts.length === 0) {
    throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'canonical part manifest is empty or lacks source provenance');
  }
  const parts: CanonicalCadPartBinding[] = [];
  const partIds = new Set<string>();
  const handles = new Set<string>();
  for (const candidate of raw.parts) {
    if (!isRecord(candidate)) throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'canonical part manifest entry is invalid');
    const partId = id(candidate.partId);
    const artifactId = id(candidate.artifactId);
    const kind = text(candidate.kind);
    const handle = text(candidate.brepHandle);
    const provenance = isRecord(candidate.handleProvenance) ? candidate.handleProvenance : null;
    const provenanceSource = id(provenance?.sourceRecordId);
    const provenanceArtifact = id(provenance?.artifactId);
    const provenanceContent = hash(provenance?.artifactContentHash);
    const provenanceShape = hash(provenance?.artifactShapeIdentityHash);
    const canonicalHandle = text(provenance?.canonicalHandle) ?? handle;
    const runtimeHandle = text(provenance?.runtimeHandle);
    const runtimeIdentity = id(provenance?.runtimeIdentity);
    if (!partId || !artifactId || !kind || !handle || !provenance
      || !canonicalHandle || !SAFE_ID.test(canonicalHandle)
      || provenanceSource !== sourceRecordId || provenanceArtifact !== artifactId
      || !provenanceContent || !provenanceShape
      || (provenance.canonicalHandle !== undefined && provenance.canonicalHandle !== canonicalHandle)
      || (provenance.runtimeHandle !== undefined && (!runtimeHandle || !SAFE_RUNTIME_HANDLE.test(runtimeHandle)))
      || (provenance.runtimeIdentity !== undefined && !runtimeIdentity)
      || partIds.has(partId) || handles.has(canonicalHandle)) {
      throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'canonical part/handle provenance is invalid or ambiguous');
    }
    const normalized: CanonicalCadPartBinding = {
      partId,
      brepHandle: canonicalHandle,
      kind,
      artifactId,
      handleProvenance: {
        sourceRecordId,
        artifactId,
        artifactContentHash: provenanceContent,
        artifactShapeIdentityHash: provenanceShape,
        canonicalHandle,
        ...(runtimeHandle ? { runtimeHandle } : {}),
        ...(runtimeIdentity ? { runtimeIdentity } : {}),
      },
    };
    if (candidate.label !== undefined && text(candidate.label)) normalized.label = text(candidate.label)!;
    for (const keyName of ['featureIds', 'sketchIds', 'entityIds', 'faceIds', 'edgeIds', 'mateIds'] as const) {
      if (candidate[keyName] === undefined) continue;
      if (!Array.isArray(candidate[keyName]) || candidate[keyName].some(value => !id(value))) {
        throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', `canonical ${keyName} provenance is invalid`);
      }
      normalized[keyName] = [...new Set(candidate[keyName] as string[])];
      if (normalized[keyName]!.length !== (candidate[keyName] as unknown[]).length) {
        throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', `canonical ${keyName} provenance is ambiguous`);
      }
    }
    partIds.add(partId);
    handles.add(canonicalHandle);
    parts.push(normalized);
  }
  return {
    schema: CAD_BREP_MAPPING_SCHEMA,
    projectId: key.projectId,
    workspaceId: key.workspaceId,
    revision: key.revision,
    workspaceContentHash: key.workspaceContentHash,
    geometryContentHash: key.geometryContentHash,
    shapeIdentityHash: key.shapeIdentityHash,
    sourceRecordId,
    parts,
  };
}

function canonicalRef(sourceRecordId: string, partId: string): string {
  const ref = `cadref:${sourceRecordId}:${partId}`;
  if (!SAFE_ID.test(ref)) throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'canonical part reference is too long');
  return ref;
}

function canonicalize(mapping: CanonicalCadGeometryMapping, preserveRuntime = false): CanonicalCadGeometryMapping {
  return {
    ...mapping,
    parts: mapping.parts.map(part => {
      const canonicalHandle = canonicalRef(mapping.sourceRecordId, part.partId);
      return {
        ...part,
        brepHandle: canonicalHandle,
        handleProvenance: {
          ...part.handleProvenance,
          canonicalHandle,
          ...(preserveRuntime && part.handleProvenance.runtimeHandle
            ? { runtimeHandle: part.handleProvenance.runtimeHandle }
            : { runtimeHandle: undefined }),
          ...(preserveRuntime && part.handleProvenance.runtimeIdentity
            ? { runtimeIdentity: part.handleProvenance.runtimeIdentity }
            : { runtimeIdentity: undefined }),
        },
      };
    }),
  };
}

/**
 * Fresh bootstrap reads only the persistent part manifest and returns stable
 * canonical refs. It never imports OCCT or returns a process-local handle.
 */
export async function readAuthoritativeCanonicalCadGeometryMapping(
  input: CanonicalCadMappingReaderInput,
): Promise<CanonicalCadGeometryMapping | null> {
  if (!input.db || (input.db as Partial<DbAdapter>).backend === undefined) return null;
  try {
    const { key, record } = await readMappingRecord(input);
    const mapping = canonicalize(parseMappingRecord(record, key));
    for (const part of mapping.parts) await assertPartArtifactMetadata(input, part);
    return mapping;
  } catch (error) {
    if (error instanceof CanonicalCadHydrationError && error.code === 'MAPPING_MISSING') return null;
    throw error;
  }
}

async function assertPartArtifactMetadata(
  input: CanonicalCadMappingReaderInput,
  part: CanonicalCadPartBinding,
): Promise<CadArtifact> {
  let artifact: Awaited<ReturnType<typeof readAuthoritativeCadArtifact>>;
  try {
    artifact = await readAuthoritativeCadArtifact(input.db, { projectId: input.projectId, artifactId: part.artifactId });
  } catch (error) {
    throw new CanonicalCadHydrationError('STORE_UNAVAILABLE', error instanceof Error ? error.message : 'artifact store unavailable');
  }
  const provenance = part.handleProvenance;
  if (!artifact) throw new CanonicalCadHydrationError('ARTIFACT_MISSING', `authoritative artifact ${part.artifactId} is missing`);
  if (!STEP_FORMATS.has(artifact.format.toLowerCase())
    || artifact.projectId !== input.projectId
    || artifact.contentSha256.toLowerCase() !== provenance.artifactContentHash
    || artifact.shapeIdentitySha256?.toLowerCase() !== provenance.artifactShapeIdentityHash) {
    throw new CanonicalCadHydrationError('ARTIFACT_BINDING_MISMATCH', `artifact ${part.artifactId} failed part hash CAS`);
  }
  return artifact;
}

async function downloadStep(storage: StorageAdapter, artifact: CadArtifact): Promise<string> {
  if (typeof storage.download !== 'function') throw new CanonicalCadHydrationError('ARTIFACT_BYTES_UNAVAILABLE', 'authoritative artifact download is unavailable');
  let bytes: Buffer;
  try {
    bytes = await storage.download(artifact.objectKey);
  } catch {
    throw new CanonicalCadHydrationError('ARTIFACT_BYTES_UNAVAILABLE', 'authoritative artifact bytes could not be read');
  }
  if (bytes.length !== artifact.byteLength || hashBytes(bytes) !== artifact.contentSha256.toLowerCase()) {
    throw new CanonicalCadHydrationError('ARTIFACT_BINDING_MISMATCH', 'stored artifact bytes failed content hash CAS');
  }
  const text = bytes.toString('utf8');
  if (!text.includes('ISO-10303-21')) throw new CanonicalCadHydrationError('ARTIFACT_BINDING_MISMATCH', 'part artifact is not a STEP document');
  return text;
}

async function importSingleSolid(stepText: string): Promise<string> {
  try {
    const engine = await import('@/app/[lang]/shape-generator/features/occtEngine');
    await engine.ensureOcctReady();
    const imported = await engine.occtImportStepText(stepText);
    if (!imported.handle) throw new Error('STEP import returned no OCCT handle');
    const evidence = engine.occtRegisteredShapeEvidence(imported.handle);
    if (!evidence?.singleSolid) throw new CanonicalCadHydrationError('AMBIGUOUS_GEOMETRY', 'part artifact did not hydrate to one solid');
    return imported.handle;
  } catch (error) {
    if (error instanceof CanonicalCadHydrationError) throw error;
    throw new CanonicalCadHydrationError('OCCT_IMPORT_FAILED', error instanceof Error ? error.message : 'OCCT hydration failed');
  }
}

async function liveSingleSolid(handle: string): Promise<boolean> {
  try {
    const engine = await import('@/app/[lang]/shape-generator/features/occtEngine');
    return Boolean(engine.getShape(handle) && engine.occtRegisteredShapeEvidence(handle)?.singleSolid);
  } catch {
    return false;
  }
}

/**
 * Hydrate the authoritative manifest for one worker/runtime. Runtime handles
 * are returned only to that worker and are never the signed bootstrap source.
 * A stale cache update uses mapping_json+updated_at CAS; a race leaves the
 * other runtime's cache untouched and this call keeps its own live handles.
 */
export async function hydrateAuthoritativeCanonicalCadGeometryMapping(
  input: CanonicalCadRuntimeHydrationInput,
): Promise<CanonicalCadGeometryMapping> {
  if (!id(input.runtimeIdentity)) throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'runtime identity is required');
  const { key, record } = await readMappingRecord(input);
  const persisted = parseMappingRecord(record, key);
  const canonical = canonicalize(persisted, true);
  const artifactIds = new Set<string>();
  const storage = input.storage ?? getStorage();
  const hydratedParts: CanonicalCadPartBinding[] = [];
  for (const part of canonical.parts) {
    if (artifactIds.has(part.artifactId)) {
      throw new CanonicalCadHydrationError('AMBIGUOUS_GEOMETRY', 'part manifest reuses one artifact without an occurrence subset');
    }
    artifactIds.add(part.artifactId);
    let handle: string;
    const prior = part.handleProvenance;
    if (prior.runtimeIdentity === input.runtimeIdentity && prior.runtimeHandle && await liveSingleSolid(prior.runtimeHandle)) {
      handle = prior.runtimeHandle;
    } else {
      const artifact = await assertPartArtifactMetadata(input, part);
      handle = await importSingleSolid(await downloadStep(storage, artifact));
    }
    hydratedParts.push({
      ...part,
      brepHandle: handle,
      handleProvenance: { ...prior, canonicalHandle: part.brepHandle, runtimeHandle: handle, runtimeIdentity: input.runtimeIdentity },
    });
  }
  const hydrated: CanonicalCadGeometryMapping = { ...canonical, parts: hydratedParts };
  const serialized = JSON.stringify(hydrated);
  try {
    const updated = await updateCanonicalCadBrepMappingRuntime(input.db, record, serialized, Date.now());
    // A competing runtime may have won the cache write. Its handles are not
    // usable here; this worker continues with its own verified hydration.
    void updated;
  } catch (error) {
    throw new CanonicalCadHydrationError('STORE_UNAVAILABLE', error instanceof Error ? error.message : 'runtime mapping CAS failed');
  }
  return hydrated;
}

/** Server-only writer for an authoritative part/occurrence manifest. */
export async function persistAuthoritativeCanonicalCadGeometryMapping(input: {
  db: DbAdapter;
  key: CanonicalCadBrepMappingStoreKey;
  artifactId: string;
  artifactContentHash: string;
  artifactShapeIdentityHash: string;
  parts: readonly AuthoritativeCadPartManifest[];
  sourceRecordId?: string;
  now?: number;
}): Promise<CanonicalCadGeometryMapping> {
  const sourceRecordId = id(input.sourceRecordId) ?? randomUUID();
  if (!id(input.artifactId) || !SHA256.test(input.artifactContentHash) || !SHA256.test(input.artifactShapeIdentityHash)
    || input.parts.length === 0) throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'authoritative part manifest identity is invalid');
  const aggregateArtifact = await readAuthoritativeCadArtifact(input.db, {
    projectId: input.key.projectId,
    artifactId: input.artifactId,
  });
  if (!aggregateArtifact
    || aggregateArtifact.contentSha256 !== input.artifactContentHash
    || aggregateArtifact.shapeIdentitySha256 !== input.artifactShapeIdentityHash) {
    throw new CanonicalCadHydrationError('ARTIFACT_BINDING_MISMATCH', 'authoritative aggregate artifact does not match workspace CAS');
  }
  const partIds = new Set<string>();
  const artifactIds = new Set<string>();
  const parts: CanonicalCadPartBinding[] = input.parts.map(manifest => {
    const partId = id(manifest.partId);
    const artifactId = id(manifest.artifactId);
    const kind = text(manifest.kind);
    if (!partId || !artifactId || !kind || partIds.has(partId) || artifactIds.has(artifactId)
      || !SHA256.test(manifest.artifactContentHash) || !SHA256.test(manifest.artifactShapeIdentityHash)) {
      throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'authoritative part occurrence manifest is invalid or ambiguous');
    }
    partIds.add(partId); artifactIds.add(artifactId);
    const canonicalHandle = canonicalRef(sourceRecordId, partId);
    const provenance: CanonicalCadHandleProvenance = {
      sourceRecordId,
      artifactId,
      artifactContentHash: manifest.artifactContentHash,
      artifactShapeIdentityHash: manifest.artifactShapeIdentityHash,
      canonicalHandle,
    };
    return {
      partId,
      brepHandle: canonicalHandle,
      kind,
      artifactId,
      handleProvenance: provenance,
      ...(manifest.label ? { label: manifest.label } : {}),
      ...Object.fromEntries(['featureIds', 'sketchIds', 'entityIds', 'faceIds', 'edgeIds', 'mateIds']
        .flatMap(name => Array.isArray(manifest[name as keyof AuthoritativeCadPartManifest])
          ? [[name, manifest[name as keyof AuthoritativeCadPartManifest]]] : [])),
    } as CanonicalCadPartBinding;
  });
  for (const part of parts) {
    const partArtifact = await readAuthoritativeCadArtifact(input.db, {
      projectId: input.key.projectId,
      artifactId: part.artifactId,
    });
    if (!partArtifact
      || partArtifact.contentSha256 !== part.handleProvenance.artifactContentHash
      || partArtifact.shapeIdentitySha256 !== part.handleProvenance.artifactShapeIdentityHash) {
      throw new CanonicalCadHydrationError('ARTIFACT_BINDING_MISMATCH', `part artifact ${part.artifactId} is not an authoritative hash match`);
    }
  }
  const mapping: CanonicalCadGeometryMapping = {
    schema: CAD_BREP_MAPPING_SCHEMA,
    projectId: input.key.projectId,
    workspaceId: input.key.workspaceId,
    revision: input.key.revision,
    workspaceContentHash: input.key.workspaceContentHash,
    geometryContentHash: input.key.geometryContentHash,
    shapeIdentityHash: input.key.shapeIdentityHash,
    sourceRecordId,
    parts,
  };
  await ensureStore(input.db);
  const now = input.now ?? Date.now();
  const candidate: CanonicalCadBrepMappingStoreRecord = {
    id: randomUUID(),
    sourceRecordId,
    ...input.key,
    artifactId: input.artifactId,
    artifactContentHash: input.artifactContentHash,
    artifactShapeIdentityHash: input.artifactShapeIdentityHash,
    mappingJson: JSON.stringify(mapping),
    createdAt: now,
    updatedAt: now,
  };
  const persisted = await insertCanonicalCadBrepMapping(input.db, candidate);
  return parseMappingRecord(persisted, input.key);
}

/**
 * Re-check the workspace CAS and hydrate a verified continuation session on
 * the current worker. The route performs project/org/editor ACL before this
 * helper; the helper deliberately accepts no client mapping or handle.
 */
export async function hydratePrecisionCadSessionRuntime(input: {
  db: DbAdapter;
  session: AgentSession;
  runtimeIdentity: string;
  storage?: StorageAdapter;
}): Promise<AgentSession> {
  const binding = input.session.cadBootstrap;
  if (!binding) return input.session;
  const head = await readAuthoritativeWorkspaceHead(input.db, binding.projectId);
  if (!head || head.revision !== binding.workspaceRevision || head.contentHash !== binding.workspaceContentHash) {
    throw new CanonicalCadHydrationError('STALE_WORKSPACE', 'signed CAD session workspace binding is stale');
  }
  const envelope = await readCadWorkspaceRevision(input.db, binding.projectId, binding.workspaceRevision);
  if (!envelope) throw new CanonicalCadHydrationError('STALE_WORKSPACE', 'signed CAD workspace revision is missing');
  const { contentHash, ...payload } = envelope;
  if (contentHash !== binding.workspaceContentHash || hashCadWorkspaceEnvelope(payload) !== contentHash
    || validateCadWorkspaceEnvelope(payload).length > 0
    || envelope.geometry.contentHash !== binding.geometryContentHash
    || envelope.geometry.shapeIdentityHash !== binding.shapeIdentityHash) {
    throw new CanonicalCadHydrationError('STALE_WORKSPACE', 'signed CAD workspace envelope failed CAS');
  }
  const mapping = await hydrateAuthoritativeCanonicalCadGeometryMapping({
    db: input.db,
    projectId: binding.projectId,
    revision: binding.workspaceRevision,
    workspaceContentHash: binding.workspaceContentHash,
    envelope,
    runtimeIdentity: input.runtimeIdentity,
    ...(input.storage ? { storage: input.storage } : {}),
  });
  const precision = await import('@/lib/ai/scad-agent/precisionCadSessionBootstrap');
  const ownership = precision.ownershipFromCanonicalCadGeometryMapping(mapping);
  if (!ownership) throw new CanonicalCadHydrationError('MAPPING_RECORD_INVALID', 'hydrated canonical ownership is ambiguous');
  const previousEntries = input.session.brepEntries ?? [];
  const canonicalPartIds = new Set(mapping.parts.map(part => part.partId));
  const previousByPart = new Map(previousEntries.flatMap(entry => entry.partId ? [[entry.partId, entry] as const] : []));
  const unavailableDerived = previousEntries
    .filter(entry => !entry.partId || !canonicalPartIds.has(entry.partId))
    .map(entry => {
      const digest = /^[a-f0-9]{64}$/.test(entry.runtimeHandleDigest ?? '')
        ? entry.runtimeHandleDigest!
        : createHash('sha256').update(entry.handle).digest('hex');
      return {
        handle: `cad-unavailable:${digest.slice(0, 48)}`,
        kind: entry.kind,
        ...(entry.label ? { label: entry.label } : {}),
        ...(entry.partId ? { partId: entry.partId } : {}),
        ts: entry.ts,
        runtimeAvailable: false as const,
        runtimeHandleDigest: digest,
        unavailableReason: 'CAD_RUNTIME_REHYDRATION_REQUIRED' as const,
      };
    });
  const uniqueUnavailable = [...new Map(unavailableDerived.map(entry => [entry.handle, entry])).values()];
  return {
    ...input.session,
    // Canonical parts are rehydrated into this request's OCCT registry. Any
    // prior derived entry without an authoritative part/artifact is retained
    // as an unavailable audit marker instead of silently disappearing or
    // leaking its old process-local handle into the signed continuation.
    brepEntries: [
      ...mapping.parts.map(part => ({
        handle: part.brepHandle,
        kind: part.kind,
        ...(part.label ? { label: part.label } : {}),
        partId: part.partId,
        ts: previousByPart.get(part.partId)?.ts ?? Date.now(),
        runtimeAvailable: true as const,
      })),
      ...uniqueUnavailable,
    ],
    cadOwnership: ownership,
  };
}

/**
 * Signed SCAD sessions are browser transport state, not a durable OCCT
 * registry. Strip every runtime handle before a `done`/`awaiting_user` event
 * is signed. The next precision-CAD continuation rehydrates canonical parts;
 * derived entries remain explicit unavailable markers for audit continuity.
 */
export function stripPrecisionCadRuntimeForTransport(session: AgentSession): AgentSession {
  const next = structuredClone(session);
  next.brepEntries = (next.brepEntries ?? []).map(entry => {
    if (!SAFE_RUNTIME_HANDLE.test(entry.handle)) return entry;
    const digest = createHash('sha256').update(entry.handle).digest('hex');
    return {
      ...entry,
      handle: `cad-unavailable:${digest.slice(0, 48)}`,
      runtimeAvailable: false,
      runtimeHandleDigest: digest,
      unavailableReason: 'CAD_RUNTIME_REHYDRATION_REQUIRED' as const,
    };
  });
  // Canonical ownership is reconstructed from the persistent manifest during
  // the next continuation. Legacy ownership may retain part IDs for scope
  // checks, but no process-local handle keys survive transport.
  if (next.cadBootstrap) next.cadOwnership = undefined;
  else if (next.cadOwnership) {
    const { brepHandles: _brepHandles, ...safeOwnership } = next.cadOwnership;
    next.cadOwnership = safeOwnership;
  }
  next.verifiedBrepHandles = {};
  for (const node of Object.values(next.featureTree?.nodes ?? {})) {
    if (node.resultHandle && SAFE_RUNTIME_HANDLE.test(node.resultHandle)) {
      // Keep the feature node itself for audit continuity, but never carry a
      // process-local handle (or an unavailable marker that the capability
      // registry could mistake for an owner key) into the next request.
      node.resultHandle = null;
    }
  }
  return next;
}
