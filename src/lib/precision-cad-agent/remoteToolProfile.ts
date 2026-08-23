import {
  hashCadWorkspaceEnvelope,
  validateCadWorkspaceEnvelope,
  type CadWorkspaceEnvelopeInput,
  type StoredCadWorkspaceEnvelope,
} from '@/lib/cad/workspaceRevisionStore';

export const REMOTE_TOOL_PROFILE_RESOLVER_VERSION = 'nexyfab.remote-tool-profile.v1' as const;

export type RemoteToolProfileId = 'installer-core' | 'architecture-interior';
export type RemoteToolProfileBlocker = 'ARCHITECTURE_INTERIOR_EXECUTION_CONTRACT_ONLY';

export type RemoteToolProfile = {
  id: RemoteToolProfileId;
  domains: readonly ('mechanical' | 'building' | 'interior')[];
  catalogModule: string;
  adapterExecution: 'native_mcp' | 'contract_only';
  exposable: boolean;
  blocker?: RemoteToolProfileBlocker;
};

export const REMOTE_TOOL_PROFILES: Readonly<Record<RemoteToolProfileId, RemoteToolProfile>> = Object.freeze({
  'installer-core': Object.freeze({
    id: 'installer-core', domains: Object.freeze(['mechanical'] as const),
    catalogModule: 'src/lib/precision-cad-agent/remoteAgentApi.ts',
    adapterExecution: 'native_mcp', exposable: true,
  }),
  'architecture-interior': Object.freeze({
    id: 'architecture-interior', domains: Object.freeze(['building', 'interior'] as const),
    catalogModule: 'src/lib/precision-cad-agent/architectureInteriorToolCatalog.ts',
    adapterExecution: 'contract_only', exposable: false,
    blocker: 'ARCHITECTURE_INTERIOR_EXECUTION_CONTRACT_ONLY',
  }),
});

export type RemoteToolProfileResolverInput = {
  /** Stored server-side envelope, including its persisted contentHash. */
  envelope: unknown;
  /** Authoritative current head from the server's CAD revision store. */
  authoritative: { projectId: string; revision: number; contentHash: string };
  /** Never used to choose the profile; only checked for mismatch. */
  requestedProfile?: unknown;
  /** Never used to choose the profile; only checked for mismatch. */
  requestedDomain?: unknown;
};

export type RemoteToolProfileResolution =
  | { ok: true; profile: RemoteToolProfile; projectId: string; revision: number; contentHash: string }
  | {
    ok: false;
    code: 'AUTHORITATIVE_REVISION_REQUIRED' | 'INVALID_ENVELOPE' | 'ENVELOPE_CONTENT_HASH_INVALID'
      | 'PROJECT_MISMATCH' | 'REVISION_STALE' | 'CONTENT_HASH_STALE' | 'DOMAIN_UNSUPPORTED'
      | 'PROFILE_MISMATCH' | 'DOMAIN_MISMATCH';
    issues: string[];
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function authoritativeIsValid(value: RemoteToolProfileResolverInput['authoritative']): boolean {
  return Boolean(value && typeof value.projectId === 'string' && value.projectId.trim()
    && Number.isSafeInteger(value.revision) && value.revision >= 0 && isSha256(value.contentHash));
}

function profileForDomain(domain: unknown): RemoteToolProfile | null {
  if (domain === 'mechanical') return REMOTE_TOOL_PROFILES['installer-core'];
  if (domain === 'building' || domain === 'interior') return REMOTE_TOOL_PROFILES['architecture-interior'];
  return null;
}

/**
 * Resolves a profile from the server-authoritative, validated envelope only.
 * A browser-supplied profile/domain can cause a mismatch failure, but can
 * never select a more privileged catalog.
 */
export function resolveRemoteToolProfile(input: RemoteToolProfileResolverInput): RemoteToolProfileResolution {
  if (!authoritativeIsValid(input.authoritative)) return { ok: false, code: 'AUTHORITATIVE_REVISION_REQUIRED', issues: ['authoritative_project_revision_hash_required'] };
  if (!isRecord(input.envelope)) return { ok: false, code: 'INVALID_ENVELOPE', issues: ['envelope_required'] };

  const storedHash = input.envelope.contentHash;
  if (!isSha256(storedHash)) return { ok: false, code: 'ENVELOPE_CONTENT_HASH_INVALID', issues: ['envelope_content_hash_invalid'] };
  const { contentHash: _ignored, ...withoutHash } = input.envelope;
  const envelope = withoutHash as unknown as CadWorkspaceEnvelopeInput;
  const envelopeIssues = validateCadWorkspaceEnvelope(envelope);
  if (envelopeIssues.length) return { ok: false, code: 'INVALID_ENVELOPE', issues: envelopeIssues };
  if (hashCadWorkspaceEnvelope(envelope) !== storedHash) return { ok: false, code: 'ENVELOPE_CONTENT_HASH_INVALID', issues: ['envelope_content_hash_mismatch'] };

  const workspace = envelope.workspace;
  if (workspace.projectId !== input.authoritative.projectId) return { ok: false, code: 'PROJECT_MISMATCH', issues: ['project_binding_mismatch'] };
  if (workspace.revision !== input.authoritative.revision) return { ok: false, code: 'REVISION_STALE', issues: ['revision_stale'] };
  if (storedHash !== input.authoritative.contentHash) return { ok: false, code: 'CONTENT_HASH_STALE', issues: ['content_hash_stale'] };

  const profile = profileForDomain(workspace.domain);
  if (!profile) return { ok: false, code: 'DOMAIN_UNSUPPORTED', issues: [`domain_unsupported:${String(workspace.domain)}`] };
  if (input.requestedProfile !== undefined && input.requestedProfile !== profile.id) return { ok: false, code: 'PROFILE_MISMATCH', issues: ['client_profile_mismatch'] };
  if (input.requestedDomain !== undefined && input.requestedDomain !== workspace.domain) return { ok: false, code: 'DOMAIN_MISMATCH', issues: ['client_domain_mismatch'] };
  return { ok: true, profile, projectId: workspace.projectId, revision: workspace.revision, contentHash: storedHash };
}

export function isRemoteToolProfileExposable(resolution: RemoteToolProfileResolution): boolean {
  return resolution.ok && resolution.profile.exposable;
}

export type { CadWorkspaceEnvelopeInput, StoredCadWorkspaceEnvelope };
