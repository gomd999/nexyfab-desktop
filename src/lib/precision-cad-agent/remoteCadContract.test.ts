import { describe, expect, it } from 'vitest';
import {
  REMOTE_PRECISION_CAD_CONTRACT_VERSION,
  REMOTE_PRECISION_CAD_TOOL_SCOPES,
  compareRemotePrecisionCadBinding,
  normalizeRemotePrecisionCadError,
  validateRemotePrecisionCadApply,
  validateRemotePrecisionCadBinding,
  validateRemotePrecisionCadToolCall,
  validateRemotePrecisionCadToolDefinitions,
  validateRemotePrecisionCadTurnResult,
} from './remoteCadContract';

const binding = { projectId: 'project-1', revision: 4, updatedAt: 1_700_000_000_000 } as const;
const catalog = Object.entries(REMOTE_PRECISION_CAD_TOOL_SCOPES).map(([name, scope]) => ({
  name, scope, description: `${name} tool`, parameters: { type: 'object', properties: {} },
}));

const artifact = {
  artifactId: 'artifact-1', projectId: binding.projectId, revision: binding.revision,
  kind: 'preview', objectKey: 'private/artifacts/personal-user/projects/project-1/jobs/job-1/artifact-1/preview.glb',
  filename: 'preview.glb', mediaType: 'model/gltf-binary', format: 'glb', byteLength: 10,
  contentSha256: 'a'.repeat(64), immutabilityState: 'IMMUTABLE',
};

describe('remote Precision CAD contract', () => {
  it('binds a turn to both the CAD revision and nf_projects updatedAt token', () => {
    expect(validateRemotePrecisionCadBinding(binding)).toEqual([]);
    expect(compareRemotePrecisionCadBinding(binding, { ...binding, updatedAt: binding.updatedAt + 1 })).toEqual(['updated_at_stale']);
    expect(compareRemotePrecisionCadBinding(binding, { ...binding, revision: 5 })).toEqual(['revision_stale']);
  });

  it('rejects traversal, malformed IDs, and invalid revision tokens', () => {
    expect(validateRemotePrecisionCadBinding({ ...binding, projectId: '../other' })).toContain('project_id_invalid');
    expect(validateRemotePrecisionCadBinding({ ...binding, revision: -1 })).toContain('revision_invalid');
    expect(validateRemotePrecisionCadBinding({ ...binding, updatedAt: Number.MAX_SAFE_INTEGER + 1 })).toContain('updated_at_invalid');
  });

  it('allows only canonical tools and derives export scope for preview output', () => {
    expect(validateRemotePrecisionCadToolCall({ callId: 'call-1', name: 'render_preview', arguments: { outDir: 'exports' }, scope: 'export' })).toEqual([]);
    expect(validateRemotePrecisionCadToolCall({ callId: 'call-1', name: 'render_preview', arguments: { outDir: 'exports' }, scope: 'propose' })).toContain('export_scope_required');
    expect(validateRemotePrecisionCadToolCall({ callId: 'call-1', name: 'shell', arguments: {}, scope: 'read' })).toContain('tool_not_allowed');
    expect(validateRemotePrecisionCadToolDefinitions(catalog)).toEqual([]);
    expect(validateRemotePrecisionCadToolDefinitions(catalog.map(item => item.name === 'build_assembly' ? { ...item, scope: 'read' } : item))).toContain('catalog_scope_mismatch');
  });

  it('accepts only immutable project-bound artifacts and validates results', () => {
    const result = {
      contractVersion: REMOTE_PRECISION_CAD_CONTRACT_VERSION, runId: 'run-1', binding,
      assistantText: 'Preview is ready.', toolCalls: [], artifacts: [artifact], previewArtifactId: artifact.artifactId,
      finishStatus: 'completed',
    };
    expect(validateRemotePrecisionCadTurnResult(result, { runId: 'run-1', binding })).toEqual([]);
    expect(validateRemotePrecisionCadTurnResult({ ...result, artifacts: [{ ...artifact, objectKey: 'private/projects/project-1/../secret.glb' }] }, { runId: 'run-1', binding })).toContain('artifact_object_key_invalid');
    expect(validateRemotePrecisionCadTurnResult({ ...result, artifacts: [{ ...artifact, projectId: 'other-project' }] }, { runId: 'run-1', binding })).toContain('artifact_project_mismatch');
  });

  it('fails apply closed when the live project binding changed', () => {
    const result = {
      contractVersion: REMOTE_PRECISION_CAD_CONTRACT_VERSION, runId: 'run-1', binding,
      assistantText: '', toolCalls: [], artifacts: [artifact], previewArtifactId: artifact.artifactId,
      finishStatus: 'completed',
    };
    expect(validateRemotePrecisionCadApply({ binding, current: { ...binding, updatedAt: binding.updatedAt + 1 }, scope: 'apply', result })).toContain('updated_at_stale');
    expect(validateRemotePrecisionCadApply({ binding, current: binding, scope: 'read', result })).toContain('apply_scope_not_allowed');
  });

  it('normalizes unknown worker failures without exposing raw internals', () => {
    expect(normalizeRemotePrecisionCadError({ code: 'QUEUE_UNAVAILABLE', message: 'secret' })).toEqual({ code: 'QUEUE_UNAVAILABLE', retryable: true });
    expect(normalizeRemotePrecisionCadError({ code: 'database password=secret' })).toEqual({ code: 'REMOTE_EXECUTION_FAILED', retryable: true });
  });
});

