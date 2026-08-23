import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from './types';

const mocks = vi.hoisted(() => ({
  head: vi.fn(),
  revision: vi.fn(),
  validate: vi.fn(),
  envelopeHash: vi.fn(),
}));

vi.mock('@/lib/cad/workspaceRevisionStore', () => ({
  readAuthoritativeWorkspaceHead: mocks.head,
  readCadWorkspaceRevision: mocks.revision,
  validateCadWorkspaceEnvelope: mocks.validate,
  hashCadWorkspaceEnvelope: mocks.envelopeHash,
}));

import { verifyAgentSession } from './sessionIntegrity';
import {
  CAD_BREP_MAPPING_SCHEMA,
  bootstrapPrecisionCadSession,
  normalizeCanonicalCadGeometryMapping,
  ownershipFromCanonicalCadGeometryMapping,
} from './precisionCadSessionBootstrap';

const hash = (char: string) => char.repeat(64);

function envelope() {
  return {
    schema: 'nexyfab.cad-workspace-envelope.v1',
    workspace: { projectId: 'project-1', revision: 7 },
    geometry: { fidelity: 'exact_brep', contentHash: hash('b'), shapeIdentityHash: hash('c') },
    contentHash: hash('a'),
  } as never;
}

function mapping() {
  const sourceRecordId = 'geometry-record-1';
  const provenance = (artifactId: string, runtimeHandle: string) => ({
    sourceRecordId,
    artifactId,
    artifactContentHash: hash('b'),
    artifactShapeIdentityHash: hash('c'),
    runtimeHandle,
  });
  return {
    schema: CAD_BREP_MAPPING_SCHEMA,
    projectId: 'project-1',
    workspaceId: 'project-1',
    revision: 7,
    workspaceContentHash: hash('a'),
    geometryContentHash: hash('b'),
    shapeIdentityHash: hash('c'),
    sourceRecordId,
    parts: [{
      partId: 'part-base', brepHandle: 'occt:server-1', kind: 'persisted-solid', label: 'Base',
      artifactId: 'part-base', handleProvenance: provenance('part-base', 'occt:server-1'),
      featureIds: ['feature-hole'], faceIds: ['face-top'], mateIds: ['mate-1'],
    }, {
      partId: 'part-pin', brepHandle: 'occt:server-2', kind: 'persisted-solid',
      artifactId: 'part-pin', handleProvenance: provenance('part-pin', 'occt:server-2'),
      mateIds: ['mate-1'],
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SCAD_AGENT_SESSION_SECRET = 'test-agent-secret-at-least-32-characters';
  mocks.head.mockResolvedValue({ projectId: 'project-1', revision: 7, contentHash: hash('a') });
  mocks.revision.mockResolvedValue(envelope());
  mocks.validate.mockReturnValue([]);
  mocks.envelopeHash.mockReturnValue(hash('a'));
});

describe('precision CAD session bootstrap adapter', () => {
  it('returns HOLD when no canonical BREP mapping exists', async () => {
    const result = await bootstrapPrecisionCadSession({
      db: {} as never, userId: 'user-1', projectId: 'project-1', revision: 7, contentHash: hash('a'), now: 10,
    });
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'CANONICAL_BREP_MAPPING_MISSING' });
  });

  it('rejects stale revision and stale content hash before mapping lookup', async () => {
    mocks.head.mockResolvedValueOnce({ projectId: 'project-1', revision: 8, contentHash: hash('a') });
    const staleRevision = await bootstrapPrecisionCadSession({
      db: {} as never, userId: 'user-1', projectId: 'project-1', revision: 7, contentHash: hash('a'),
      readMapping: vi.fn(),
    });
    expect(staleRevision).toMatchObject({ ok: false, code: 'STALE_WORKSPACE_REVISION', current: { revision: 8 } });

    mocks.head.mockResolvedValueOnce({ projectId: 'project-1', revision: 7, contentHash: hash('d') });
    const staleHash = await bootstrapPrecisionCadSession({
      db: {} as never, userId: 'user-1', projectId: 'project-1', revision: 7, contentHash: hash('a'),
      readMapping: vi.fn(),
    });
    expect(staleHash).toMatchObject({ ok: false, code: 'STALE_WORKSPACE_HASH', current: { contentHash: hash('d') } });
  });

  it('does not accept a mapping whose server record is bound to another revision/hash', async () => {
    const readMapping = vi.fn().mockResolvedValue({ ...mapping(), revision: 6 });
    const result = await bootstrapPrecisionCadSession({
      db: {} as never, userId: 'user-1', projectId: 'project-1', revision: 7, contentHash: hash('a'), readMapping,
    });
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'CANONICAL_BREP_MAPPING_INVALID' });
  });

  it('creates only server-derived ownership and returns a valid HMAC-signed session', async () => {
    const readMapping = vi.fn().mockResolvedValue(mapping());
    const result = await bootstrapPrecisionCadSession({
      db: {} as never, userId: 'user-1', projectId: 'project-1', revision: 7, contentHash: hash('a'), now: 10, readMapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyAgentSession(result.session, 'user-1')).toBe(true);
    expect(result.session.cadOwnership).toEqual({
      schema: 'nexyfab.cad-session-ownership.v1',
      partIds: ['part-base', 'part-pin'],
      brepHandles: { 'occt:server-1': 'part-base', 'occt:server-2': 'part-pin' },
      featureIds: { 'feature-hole': 'part-base' },
      faceIds: { 'face-top': 'part-base' },
      mateIds: { 'mate-1': ['part-base', 'part-pin'] },
    });
    expect(result.session.brepEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ handle: 'occt:server-1', partId: 'part-base' }),
    ]));
    expect(result.session.cadBootstrap).toMatchObject({ projectId: 'project-1', workspaceRevision: 7, workspaceContentHash: hash('a') });
    expect(result.binding).toMatchObject({ schema: 'nexyfab.cad-session-bootstrap.v1' });
  });
});

describe('canonical mapping normalization', () => {
  it('never derives part ownership from a handle or label', () => {
    const raw = mapping();
    const invalid = { ...raw, parts: [{ brepHandle: 'occt:server-1', kind: 'solid', label: 'part-base' }] };
    expect(normalizeCanonicalCadGeometryMapping(invalid, {
      projectId: 'project-1', revision: 7, workspaceContentHash: hash('a'), geometryContentHash: hash('b'), shapeIdentityHash: hash('c'),
    })).toBeNull();
  });

  it('rejects ambiguous references assigned to multiple parts', () => {
    const raw = mapping();
    const invalid = { ...raw, parts: raw.parts.map(part => ({ ...part, featureIds: ['same-feature'] })) };
    const normalized = normalizeCanonicalCadGeometryMapping(invalid, {
      projectId: 'project-1', revision: 7, workspaceContentHash: hash('a'), geometryContentHash: hash('b'), shapeIdentityHash: hash('c'),
    });
    expect(normalized).not.toBeNull();
    expect(ownershipFromCanonicalCadGeometryMapping(normalized!)).toBeNull();
  });
});

// Keep the type import exercised in editors that run isolated module checks.
void (null as AgentSession | null);
