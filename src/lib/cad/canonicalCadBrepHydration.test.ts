import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  readMapping: vi.fn(),
  insertMapping: vi.fn(),
  updateMapping: vi.fn(),
  readArtifact: vi.fn(),
  readHead: vi.fn(),
  readRevision: vi.fn(),
  ensureOcct: vi.fn(),
  importStep: vi.fn(),
  getShape: vi.fn(),
  evidence: vi.fn(),
}));

vi.mock('./canonicalCadBrepMappingStore', () => ({
  ensureCanonicalCadBrepMappingTables: mocks.ensure,
  readCanonicalCadBrepMapping: mocks.readMapping,
  insertCanonicalCadBrepMapping: mocks.insertMapping,
  updateCanonicalCadBrepMappingRuntime: mocks.updateMapping,
}));
vi.mock('@/lib/artifacts/directArtifactUploadStore', () => ({ readAuthoritativeCadArtifact: mocks.readArtifact }));
vi.mock('./workspaceRevisionStore', () => ({
  readAuthoritativeWorkspaceHead: mocks.readHead,
  readCadWorkspaceRevision: mocks.readRevision,
  hashCadWorkspaceEnvelope: () => workspaceHash,
  validateCadWorkspaceEnvelope: () => [],
}));
vi.mock('@/app/[lang]/shape-generator/features/occtEngine', () => ({
  ensureOcctReady: mocks.ensureOcct,
  occtImportStepText: mocks.importStep,
  getShape: mocks.getShape,
  occtRegisteredShapeEvidence: mocks.evidence,
}));

import {
  CanonicalCadHydrationError,
  hydrateAuthoritativeCanonicalCadGeometryMapping,
  hydratePrecisionCadSessionRuntime,
  persistAuthoritativeCanonicalCadGeometryMapping,
  readAuthoritativeCanonicalCadGeometryMapping,
  type CanonicalCadMappingReaderInput,
  stripPrecisionCadRuntimeForTransport,
} from './canonicalCadBrepHydration';

const stepBytes = Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n', 'utf8');
const contentHash = createHash('sha256').update(stepBytes).digest('hex');
const shapeHash = 'c'.repeat(64);
const workspaceHash = 'a'.repeat(64);
const db = { backend: 'sqlite' } as never;
const storage = { download: vi.fn(async () => stepBytes) } as never;
const artifacts = new Map<string, Record<string, unknown>>();
const handles = new Set<string>();
let sequence = 0;
let record: Record<string, unknown> | null = null;

function artifact(id: string) {
  return {
    contractVersion: 'nexyfab.artifact.v1',
    artifactId: id,
    projectId: 'project-1',
    tenantId: 'org-1',
    objectKey: `private/${id}.step`,
    mediaType: 'application/step',
    format: 'step',
    byteLength: stepBytes.length,
    contentSha256: contentHash,
    shapeIdentitySha256: shapeHash,
    producerBuildId: 'test',
    kernelIdentity: 'NOT_APPLICABLE',
    createdAt: new Date(1).toISOString(),
    immutabilityState: 'IMMUTABLE',
  };
}

function input(): CanonicalCadMappingReaderInput {
  return {
    db,
    projectId: 'project-1',
    revision: 4,
    workspaceContentHash: workspaceHash,
    envelope: {
      schema: 'nexyfab.cad-workspace-envelope.v1',
      workspace: { projectId: 'project-1', revision: 4 },
      geometry: { fidelity: 'exact_brep', contentHash, shapeIdentityHash: shapeHash },
      artifactGraph: { artifacts: [] },
    },
    storage,
  } as unknown as CanonicalCadMappingReaderInput;
}

function rowFromCandidate(candidate: Record<string, unknown>) {
  return { ...candidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  record = null;
  sequence = 0;
  handles.clear();
  artifacts.clear();
  artifacts.set('aggregate-1', artifact('aggregate-1'));
  artifacts.set('part-a', artifact('part-a'));
  artifacts.set('part-b', artifact('part-b'));
  mocks.ensure.mockResolvedValue(undefined);
  mocks.readMapping.mockImplementation(async () => record);
  mocks.insertMapping.mockImplementation(async (unusedDb: unknown, candidate: Record<string, unknown>) => {
    void unusedDb;
    if (!record) record = rowFromCandidate(candidate);
    return record;
  });
  mocks.updateMapping.mockImplementation(async (
    unusedDb: unknown,
    current: Record<string, unknown>,
    mappingJson: string,
    updatedAt: number,
  ) => {
    void unusedDb;
    if (!record || record.mappingJson !== current.mappingJson || record.updatedAt !== current.updatedAt) return null;
    record = { ...record, mappingJson, updatedAt };
    return record;
  });
  mocks.readArtifact.mockImplementation(async (unusedDb: unknown, args: { artifactId: string }) => {
    void unusedDb;
    return artifacts.get(args.artifactId) ?? null;
  });
  mocks.readHead.mockResolvedValue({ revision: 4, contentHash: workspaceHash });
  mocks.readRevision.mockImplementation(async () => ({ ...input().envelope, contentHash: workspaceHash }));
  mocks.ensureOcct.mockResolvedValue(undefined);
  mocks.importStep.mockImplementation(async () => {
    const handle = `occt:runtime-${++sequence}`;
    handles.add(handle);
    return { handle };
  });
  mocks.getShape.mockImplementation((handle: string) => handles.has(handle) ? {} : null);
  mocks.evidence.mockImplementation((handle: string) => handles.has(handle) ? { singleSolid: true } : null);
});

describe('authoritative CAD mapping and runtime hydration', () => {
  it('persists a server-built multipart manifest and bootstrap returns canonical refs only', async () => {
    const key = {
      projectId: 'project-1', workspaceId: 'project-1', revision: 4,
      workspaceContentHash: workspaceHash, geometryContentHash: contentHash, shapeIdentityHash: shapeHash,
    };
    const persisted = await persistAuthoritativeCanonicalCadGeometryMapping({
      db,
      key,
      artifactId: 'aggregate-1',
      artifactContentHash: contentHash,
      artifactShapeIdentityHash: shapeHash,
      parts: [
        { partId: 'part-a', kind: 'solid', artifactId: 'part-a', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash },
        { partId: 'part-b', kind: 'solid', artifactId: 'part-b', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash },
      ],
    });
    expect(persisted.parts).toHaveLength(2);
    const bootstrap = await readAuthoritativeCanonicalCadGeometryMapping(input());
    expect(bootstrap?.parts.map(part => part.partId)).toEqual(['part-a', 'part-b']);
    expect(bootstrap?.parts.every(part => part.brepHandle.startsWith('cadref:'))).toBe(true);
    expect(mocks.importStep).not.toHaveBeenCalled();
  });

  it('hydrates independently after restart/replica handoff and CAS-updates runtime cache', async () => {
    const key = {
      projectId: 'project-1', workspaceId: 'project-1', revision: 4,
      workspaceContentHash: workspaceHash, geometryContentHash: contentHash, shapeIdentityHash: shapeHash,
    };
    await persistAuthoritativeCanonicalCadGeometryMapping({
      db, key, artifactId: 'aggregate-1', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash,
      parts: [{ partId: 'part-a', kind: 'solid', artifactId: 'part-a', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash }],
    });
    const first = await hydrateAuthoritativeCanonicalCadGeometryMapping({ ...input(), runtimeIdentity: 'worker-a' });
    expect(first.parts[0]!.brepHandle).toBe('occt:runtime-1');
    const sameWorker = await hydrateAuthoritativeCanonicalCadGeometryMapping({ ...input(), runtimeIdentity: 'worker-a' });
    expect(sameWorker.parts[0]!.brepHandle).toBe('occt:runtime-1');
    expect(mocks.importStep).toHaveBeenCalledTimes(1);
    handles.clear();
    const second = await hydrateAuthoritativeCanonicalCadGeometryMapping({ ...input(), runtimeIdentity: 'worker-b' });
    expect(second.parts[0]!.brepHandle).toBe('occt:runtime-2');
    expect(mocks.importStep).toHaveBeenCalledTimes(2);
    expect(second.parts[0]!.handleProvenance.runtimeIdentity).toBe('worker-b');
  });

  it('does not use a competing runtime cache handle after an update race', async () => {
    const key = {
      projectId: 'project-1', workspaceId: 'project-1', revision: 4,
      workspaceContentHash: workspaceHash, geometryContentHash: contentHash, shapeIdentityHash: shapeHash,
    };
    await persistAuthoritativeCanonicalCadGeometryMapping({
      db, key, artifactId: 'aggregate-1', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash,
      parts: [{ partId: 'part-a', kind: 'solid', artifactId: 'part-a', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash }],
    });
    mocks.updateMapping.mockResolvedValueOnce(null);
    const hydrated = await hydrateAuthoritativeCanonicalCadGeometryMapping({ ...input(), runtimeIdentity: 'worker-race' });
    expect(hydrated.parts[0]!.brepHandle).toBe('occt:runtime-1');
    expect(hydrated.parts[0]!.handleProvenance.runtimeIdentity).toBe('worker-race');
  });

  it('holds when the manifest is absent or a single artifact is reused as ambiguous occurrences', async () => {
    await expect(readAuthoritativeCanonicalCadGeometryMapping(input())).resolves.toBeNull();
    const key = {
      projectId: 'project-1', workspaceId: 'project-1', revision: 4,
      workspaceContentHash: workspaceHash, geometryContentHash: contentHash, shapeIdentityHash: shapeHash,
    };
    await persistAuthoritativeCanonicalCadGeometryMapping({
      db, key, artifactId: 'aggregate-1', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash,
      parts: [{ partId: 'part-a', kind: 'solid', artifactId: 'part-a', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash }],
    });
    const original = JSON.parse(String(record!.mappingJson));
    const duplicatePart = structuredClone(original.parts[0]);
    duplicatePart.partId = 'part-b';
    duplicatePart.handleProvenance.canonicalHandle = `cadref:${original.sourceRecordId}:part-b`;
    duplicatePart.brepHandle = duplicatePart.handleProvenance.canonicalHandle;
    const duplicate = { ...original, parts: [...original.parts, duplicatePart] };
    record = { ...record!, mappingJson: JSON.stringify(duplicate) };
    await expect(hydrateAuthoritativeCanonicalCadGeometryMapping({ ...input(), runtimeIdentity: 'worker-a' }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_GEOMETRY' });
  });

  it('fails closed on artifact hash mismatch before OCCT hydration', async () => {
    const key = {
      projectId: 'project-1', workspaceId: 'project-1', revision: 4,
      workspaceContentHash: workspaceHash, geometryContentHash: contentHash, shapeIdentityHash: shapeHash,
    };
    await persistAuthoritativeCanonicalCadGeometryMapping({
      db, key, artifactId: 'aggregate-1', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash,
      parts: [{ partId: 'part-a', kind: 'solid', artifactId: 'part-a', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash }],
    });
    artifacts.set('part-a', { ...artifact('part-a'), contentSha256: 'd'.repeat(64) });
    await expect(hydrateAuthoritativeCanonicalCadGeometryMapping({ ...input(), runtimeIdentity: 'worker-a' }))
      .rejects.toBeInstanceOf(CanonicalCadHydrationError);
    expect(mocks.importStep).not.toHaveBeenCalled();
  });

  it('preserves derived BRep identity as unavailable across a two-turn worker handoff', async () => {
    const key = {
      projectId: 'project-1', workspaceId: 'project-1', revision: 4,
      workspaceContentHash: workspaceHash, geometryContentHash: contentHash, shapeIdentityHash: shapeHash,
    };
    await persistAuthoritativeCanonicalCadGeometryMapping({
      db, key, artifactId: 'aggregate-1', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash,
      parts: [{ partId: 'part-a', kind: 'solid', artifactId: 'part-a', artifactContentHash: contentHash, artifactShapeIdentityHash: shapeHash }],
    });
    const bootstrap = {
      schema: 'nexyfab.cad-session-bootstrap.v1' as const,
      projectId: 'project-1', workspaceId: 'project-1', workspaceRevision: 4,
      workspaceContentHash: workspaceHash, geometryContentHash: contentHash, shapeIdentityHash: shapeHash,
      bootstrappedAt: 1,
    };
    const first = await hydratePrecisionCadSessionRuntime({
      db,
      runtimeIdentity: 'worker-a',
      storage,
      session: {
        cadBootstrap: bootstrap,
        brepEntries: [{ handle: 'occt:derived', kind: 'derived', ts: 42 }],
        verifiedBrepHandles: { 'occt:derived': true },
        featureTree: {
          nodes: {
            derivedNode: {
              id: 'derivedNode', op: 'primitive', params: {}, parents: [],
              resultHandle: 'occt:derived', dirty: false, seq: 0,
            },
          },
          roots: ['derivedNode'], nextSeq: 1,
        },
      } as never,
    });
    expect(first.brepEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: 'part-a', runtimeAvailable: true, handle: 'occt:runtime-1' }),
      expect.objectContaining({ kind: 'derived', runtimeAvailable: false, unavailableReason: 'CAD_RUNTIME_REHYDRATION_REQUIRED' }),
    ]));
    expect(first.brepEntries.find(entry => entry.kind === 'derived')?.handle).not.toBe('occt:derived');
    const transport = stripPrecisionCadRuntimeForTransport(first);
    expect(transport.brepEntries.every(entry => !entry.handle.startsWith('occt:'))).toBe(true);
    expect(transport.verifiedBrepHandles).toEqual({});
    expect(transport.featureTree?.nodes.derivedNode?.resultHandle).toBeNull();
    const second = await hydratePrecisionCadSessionRuntime({ db, runtimeIdentity: 'worker-b', storage, session: transport });
    expect(second.brepEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: 'part-a', runtimeAvailable: true, handle: 'occt:runtime-2' }),
      expect.objectContaining({ kind: 'derived', runtimeAvailable: false, unavailableReason: 'CAD_RUNTIME_REHYDRATION_REQUIRED' }),
    ]));
    expect(second.brepEntries.find(entry => entry.kind === 'derived')?.handle).not.toBe('occt:derived');
    expect(second.brepEntries.find(entry => entry.kind === 'derived')?.handle)
      .toBe(transport.brepEntries.find(entry => entry.kind === 'derived')?.handle);
  });
});
