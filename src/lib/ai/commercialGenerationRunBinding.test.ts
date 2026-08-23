import { describe, expect, it } from 'vitest';
import { buildCommercialGenerationRunBinding, validateCommercialGenerationRunBinding } from './commercialGenerationRunBinding';

const hashes = { programSha256: 'a'.repeat(64), workspaceHeadSha256: 'b'.repeat(64), previousHeadSha256: 'c'.repeat(64), previousStateSha256: 'f'.repeat(64), stateSha256: 'd'.repeat(64) };
describe('commercial generation run binding', () => {
  it('requires server tenant/project/workspace identity and append-only revision chain', () => {
    const value = buildCommercialGenerationRunBinding({ tenantId: 'tenant-1', projectId: 'project-1', workspaceId: 'workspace-1', workspaceRevision: 7, runId: 'run-1', revision: 1, previousRevision: 0, ...hashes });
    expect(value.generationProgramSha256).toBe(hashes.programSha256);
    expect(validateCommercialGenerationRunBinding(value)).toEqual([]);
    expect(validateCommercialGenerationRunBinding({ ...value, revision: 2, previousRevision: 2 })).toContain('revision_chain_invalid');
    expect(validateCommercialGenerationRunBinding({ ...value, revision: 4, previousRevision: 1 })).toEqual([]);
    expect(validateCommercialGenerationRunBinding({ ...value, generationProgramSha256: 'e'.repeat(64) })).toContain('program_hash_alias_mismatch');
    expect(validateCommercialGenerationRunBinding({ ...value, projectId: '../other' })).toContain('projectId_invalid');
  });
  it('rejects non-finite hashes/numbers before persistence', () => { expect(() => buildCommercialGenerationRunBinding({ tenantId: 't', projectId: 'p', workspaceId: 'w', workspaceRevision: 0, runId: 'r', revision: Number.NaN, previousRevision: 0, ...hashes })).toThrow('COMMERCIAL_GENERATION_BINDING_INVALID'); });
  it('requires the genesis zero predecessor and allows a jump only from an earlier persisted state', () => { const genesis = buildCommercialGenerationRunBinding({ tenantId: 't', projectId: 'p', workspaceId: 'w', workspaceRevision: 0, runId: 'r', revision: 0, previousRevision: -1, previousHeadSha256: '0'.repeat(64), previousStateSha256: '0'.repeat(64), workspaceHeadSha256: 'b'.repeat(64), stateSha256: 'd'.repeat(64), programSha256: '0'.repeat(64) }); expect(validateCommercialGenerationRunBinding(genesis)).toEqual([]); expect(validateCommercialGenerationRunBinding({ ...genesis, previousStateSha256: 'e'.repeat(64) })).toContain('revision_chain_invalid'); expect(validateCommercialGenerationRunBinding({ ...genesis, revision: 5, previousRevision: 2, previousHeadSha256: 'b'.repeat(64), previousStateSha256: 'e'.repeat(64) })).toEqual([]); });
});
