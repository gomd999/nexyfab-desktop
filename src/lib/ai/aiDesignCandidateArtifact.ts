import 'server-only';
import { createHash } from 'node:crypto';

export const AI_DESIGN_CANDIDATE_ARTIFACT_SCHEMA = 'nexyfab.ai-design-candidate-artifact.v1' as const;
export type AiDesignArtifactStatus = 'published' | 'superseded' | 'invalidated';
export type AiDesignArtifactEvidenceStatus = 'verified' | 'failed' | 'unknown' | 'not_run' | 'invalidated';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const MAX = 100;

export interface AiDesignCandidateEvidenceRef {
  evidenceId: string;
  kind: string;
  status: AiDesignArtifactEvidenceStatus;
  receiptDigest?: string;
}

export interface AiDesignCandidateArtifactDependencies {
  intentNodeIds: readonly string[];
  parameterIds: readonly string[];
  gaugeIds: readonly string[];
  featureIds: readonly string[];
}

/** Server-created metadata. The browser must never be allowed to author this field. */
export interface AiDesignCandidateServerMetadata {
  generatorId: string;
  modelId: string;
  runtimeId: string;
  workerBuildDigest: string;
  generationRunId: string;
}

export interface AiDesignCandidateArtifactV1 {
  schema: typeof AI_DESIGN_CANDIDATE_ARTIFACT_SCHEMA;
  artifactId: string;
  candidateId: string;
  projectId: string;
  sessionId: string;
  baseRevision: string;
  artifactRevision: number;
  status: AiDesignArtifactStatus;
  createdAt: string;
  /** Hashes bind the artifact without putting geometry or user content in the manifest. */
  contentDigest: string;
  designDigest: string;
  previewDigest?: string;
  dependencies: AiDesignCandidateArtifactDependencies;
  evidence: readonly AiDesignCandidateEvidenceRef[];
  server: AiDesignCandidateServerMetadata;
  supersedes: string | null;
  manifestDigest: string;
}

export type CreateAiDesignCandidateArtifactInput = Omit<AiDesignCandidateArtifactV1, 'schema' | 'manifestDigest'> & {
  /** Runtime guard in addition to this module's server-only import. */
  trustedServer: true;
};

export interface AiDesignArtifactOwnershipScope { projectId: string; sessionId: string; }

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('artifact_non_finite_number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new Error('artifact_non_canonical_value');
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); }
  return value;
}
function manifestMaterial(value: Omit<AiDesignCandidateArtifactV1, 'manifestDigest'> | AiDesignCandidateArtifactV1): unknown { const { schema, manifestDigest: _manifestDigest, ...rest } = value as AiDesignCandidateArtifactV1; return { schema, ...rest }; }
function validId(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function validDigest(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }

export function createAiDesignCandidateArtifact(input: CreateAiDesignCandidateArtifactInput): AiDesignCandidateArtifactV1 {
  if (input.trustedServer !== true) throw new Error('artifact_server_authority_required');
  const { trustedServer: _trustedServer, ...rest } = input;
  const value = { schema: AI_DESIGN_CANDIDATE_ARTIFACT_SCHEMA, ...rest, manifestDigest: '' } as AiDesignCandidateArtifactV1;
  value.manifestDigest = digest(manifestMaterial(value));
  return freeze(structuredClone(value));
}

export function validateAiDesignCandidateArtifact(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['artifact_not_object'];
  const artifact = value as Partial<AiDesignCandidateArtifactV1>;
  const issues: string[] = [];
  if (artifact.schema !== AI_DESIGN_CANDIDATE_ARTIFACT_SCHEMA) issues.push('artifact_schema_invalid');
  for (const key of ['artifactId', 'candidateId', 'projectId', 'sessionId', 'baseRevision'] as const) if (!validId(artifact[key])) issues.push(`${key}_invalid`);
  if (!Number.isSafeInteger(artifact.artifactRevision) || (artifact.artifactRevision ?? 0) < 1) issues.push('artifact_revision_invalid');
  if (!['published', 'superseded', 'invalidated'].includes(artifact.status ?? '')) issues.push('artifact_status_invalid');
  if (typeof artifact.createdAt !== 'string' || Number.isNaN(Date.parse(artifact.createdAt))) issues.push('created_at_invalid');
  for (const key of ['contentDigest', 'designDigest', 'manifestDigest'] as const) if (!validDigest(artifact[key])) issues.push(`${key}_invalid`);
  if (artifact.previewDigest !== undefined && !validDigest(artifact.previewDigest)) issues.push('preview_digest_invalid');
  const dependencies = artifact.dependencies;
  if (!dependencies || !Array.isArray(dependencies.intentNodeIds) || !Array.isArray(dependencies.parameterIds) || !Array.isArray(dependencies.gaugeIds) || !Array.isArray(dependencies.featureIds)) issues.push('dependencies_invalid');
  else for (const values of Object.values(dependencies) as unknown[][]) { if (values.length > MAX || values.some((item: unknown) => !validId(item))) issues.push('dependency_id_invalid'); }
  if (!Array.isArray(artifact.evidence) || artifact.evidence.length > MAX) issues.push('evidence_invalid');
  else {
    const ids = new Set<string>();
    for (const item of artifact.evidence) {
      if (!item || !validId(item.evidenceId) || !validId(item.kind) || ids.has(item.evidenceId)) issues.push('evidence_ref_invalid');
      if (item) { ids.add(item.evidenceId); if (!['verified', 'failed', 'unknown', 'not_run', 'invalidated'].includes(item.status)) issues.push('evidence_status_invalid'); if (item.receiptDigest !== undefined && !validDigest(item.receiptDigest)) issues.push('evidence_receipt_digest_invalid'); }
    }
  }
  const server = artifact.server;
  if (!server || !validId(server.generatorId) || !validId(server.modelId) || !validId(server.runtimeId) || !validDigest(server.workerBuildDigest) || !validId(server.generationRunId)) issues.push('server_metadata_invalid');
  if (artifact.supersedes !== null && !validId(artifact.supersedes)) issues.push('supersedes_invalid');
  if (artifact.supersedes === artifact.artifactId) issues.push('artifact_cannot_supersede_itself');
  if (artifact.artifactRevision === 1 && artifact.supersedes !== null) issues.push('artifact_initial_revision_cannot_supersede');
  if ((artifact.artifactRevision ?? 0) > 1 && artifact.supersedes === null) issues.push('artifact_lineage_required');
  if (issues.length === 0 && artifact.manifestDigest !== digest(manifestMaterial(artifact as AiDesignCandidateArtifactV1))) issues.push('manifest_digest_mismatch');
  return [...new Set(issues)];
}

export function validateAiDesignCandidateArtifactOwnership(artifact: AiDesignCandidateArtifactV1, scope: AiDesignArtifactOwnershipScope): string[] {
  return [
    ...(artifact.projectId === scope.projectId ? [] : ['artifact_project_mismatch']),
    ...(artifact.sessionId === scope.sessionId ? [] : ['artifact_session_mismatch']),
  ];
}

export interface AiDesignCandidateArtifactStore {
  append(artifact: AiDesignCandidateArtifactV1): { ok: true } | { ok: false; issues: readonly string[] };
  get(artifactId: string): AiDesignCandidateArtifactV1 | undefined;
  list(scope: AiDesignArtifactOwnershipScope): readonly AiDesignCandidateArtifactV1[];
}

/** Reference store used by tests/local runtime. Production can implement the same append-only interface in Postgres/object storage. */
export class InMemoryAiDesignCandidateArtifactStore implements AiDesignCandidateArtifactStore {
  private readonly values = new Map<string, AiDesignCandidateArtifactV1>();
  append(artifact: AiDesignCandidateArtifactV1) {
    const issues = validateAiDesignCandidateArtifact(artifact);
    if (issues.length) return { ok: false as const, issues };
    const previous = this.values.get(artifact.artifactId);
    if (previous) return { ok: false as const, issues: previous.manifestDigest === artifact.manifestDigest ? ['artifact_already_appended'] : ['artifact_overwrite_forbidden'] };
    if (artifact.supersedes) {
      const prior = this.values.get(artifact.supersedes);
      if (!prior) return { ok: false as const, issues: ['superseded_artifact_not_found'] };
      if (prior.projectId !== artifact.projectId || prior.sessionId !== artifact.sessionId || prior.candidateId !== artifact.candidateId) return { ok: false as const, issues: ['artifact_lineage_scope_mismatch'] };
      if (artifact.artifactRevision !== prior.artifactRevision + 1) return { ok: false as const, issues: ['artifact_lineage_revision_mismatch'] };
    }
    this.values.set(artifact.artifactId, artifact);
    return { ok: true as const };
  }
  get(artifactId: string) { return this.values.get(artifactId); }
  list(scope: AiDesignArtifactOwnershipScope) { return [...this.values.values()].filter(item => validateAiDesignCandidateArtifactOwnership(item, scope).length === 0); }
  reset(): void { this.values.clear(); }
}

export function aiDesignCandidateArtifactManifestDigest(artifact: AiDesignCandidateArtifactV1): string { return artifact.manifestDigest; }
