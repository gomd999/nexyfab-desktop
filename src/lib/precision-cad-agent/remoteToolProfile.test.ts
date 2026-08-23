import { describe, expect, it } from 'vitest';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from '@/lib/ai/designArtifactGraph';
import { createDesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import { hashCadPayload, hashCadWorkspaceEnvelope, type CadWorkspaceEnvelopeInput } from '@/lib/cad/workspaceRevisionStore';
import {
  REMOTE_TOOL_PROFILES,
  isRemoteToolProfileExposable,
  resolveRemoteToolProfile,
} from './remoteToolProfile';

const hash = (char: string) => char.repeat(64);

function envelope(domain: 'mechanical' | 'building' | 'interior' | 'civil' = 'mechanical', revision = 2): CadWorkspaceEnvelopeInput & { contentHash: string } {
  const document = { schema: domain === 'mechanical' ? 'nexyfab.product-decomposition.v1' : domain === 'building' ? 'nexyfab.architecture.v1' : domain === 'interior' ? 'nexyfab.interior.v1' : 'nexyfab.civil.v1', revision };
  const workspace = createDesignWorkspaceRevision({ projectId: 'project-1', lineageId: 'lineage-1', domain, documentHash: hashCadPayload(document), workMode: 'precision_cad' });
  workspace.revision = revision;
  workspace.history = [{ ...workspace.history[0]!, revision, documentHash: workspace.documentHash }];
  const value: CadWorkspaceEnvelopeInput = {
    schema: 'nexyfab.cad-workspace-envelope.v1', workspace,
    requirements: { contentHash: hashCadPayload({ requirementCode: 'basic' }), payload: { requirementCode: 'basic' } },
    semanticDocument: { schema: document.schema, contentHash: hashCadPayload(document), payload: document },
    geometry: { fidelity: 'exact_brep', contentHash: hash('b'), shapeIdentityHash: hash('d') },
    objectRelations: { contentHash: hashCadPayload([]), payload: [] },
    artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision, artifacts: [{
      id: 'model', kind: 'model', revision, contentHash: hash('b'), state: 'current', inputs: [],
      verification: { status: 'passed', verifierId: 'exact-kernel', evidenceHash: hash('e'), issues: [] }, staleBecause: [],
    }], dependencies: [] },
    provenance: [{ sourceId: 'source-1', kind: 'ai', contentHash: hash('9') }],
    kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('7'), wasmSha256: hash('8'), stubFallback: false },
  };
  return { ...value, contentHash: hashCadWorkspaceEnvelope(value) };
}

function authoritative(value: ReturnType<typeof envelope>) {
  return { projectId: value.workspace.projectId, revision: value.workspace.revision, contentHash: value.contentHash };
}

describe('server-authoritative remote Precision CAD profile resolver', () => {
  it('selects installer-core only from mechanical domain and exposes it', () => {
    const value = envelope('mechanical');
    const result = resolveRemoteToolProfile({ envelope: value, authoritative: authoritative(value), requestedProfile: 'installer-core', requestedDomain: 'mechanical' });
    expect(result).toMatchObject({ ok: true, profile: REMOTE_TOOL_PROFILES['installer-core'], projectId: 'project-1', revision: 2 });
    expect(isRemoteToolProfileExposable(result)).toBe(true);
  });

  it('resolves building/interior to architecture-interior but blocks exposure while execution is contract-only', () => {
    for (const domain of ['building', 'interior'] as const) {
      const value = envelope(domain);
      const result = resolveRemoteToolProfile({ envelope: value, authoritative: authoritative(value) });
      expect(result).toMatchObject({ ok: true, profile: { id: 'architecture-interior', exposable: false, adapterExecution: 'contract_only', blocker: 'ARCHITECTURE_INTERIOR_EXECUTION_CONTRACT_ONLY' } });
      expect(isRemoteToolProfileExposable(result)).toBe(false);
    }
  });

  it('rejects client profile/domain mismatches without using them to select a profile', () => {
    const value = envelope('mechanical');
    expect(resolveRemoteToolProfile({ envelope: value, authoritative: authoritative(value), requestedProfile: 'architecture-interior' })).toMatchObject({ ok: false, code: 'PROFILE_MISMATCH' });
    expect(resolveRemoteToolProfile({ envelope: value, authoritative: authoritative(value), requestedDomain: 'building' })).toMatchObject({ ok: false, code: 'DOMAIN_MISMATCH' });
  });

  it('rejects stale revision, stale content hash, project mismatch, invalid hash and missing authority', () => {
    const value = envelope();
    expect(resolveRemoteToolProfile({ envelope: value, authoritative: { ...authoritative(value), revision: 3 } })).toMatchObject({ ok: false, code: 'REVISION_STALE' });
    expect(resolveRemoteToolProfile({ envelope: value, authoritative: { ...authoritative(value), contentHash: hash('f') } })).toMatchObject({ ok: false, code: 'CONTENT_HASH_STALE' });
    expect(resolveRemoteToolProfile({ envelope: value, authoritative: { ...authoritative(value), projectId: 'other-project' } })).toMatchObject({ ok: false, code: 'PROJECT_MISMATCH' });
    expect(resolveRemoteToolProfile({ envelope: { ...value, contentHash: hash('f') }, authoritative: authoritative(value) })).toMatchObject({ ok: false, code: 'ENVELOPE_CONTENT_HASH_INVALID' });
    expect(resolveRemoteToolProfile({ envelope: value, authoritative: { projectId: '', revision: -1, contentHash: '' } })).toMatchObject({ ok: false, code: 'AUTHORITATIVE_REVISION_REQUIRED' });
  });

  it('fails closed for unsupported domains and malformed envelopes', () => {
    const civil = envelope('civil');
    expect(resolveRemoteToolProfile({ envelope: civil, authoritative: authoritative(civil) })).toMatchObject({ ok: false, code: 'DOMAIN_UNSUPPORTED' });
    expect(resolveRemoteToolProfile({ envelope: {}, authoritative: authoritative(civil) })).toMatchObject({ ok: false, code: 'ENVELOPE_CONTENT_HASH_INVALID' });
  });
});
