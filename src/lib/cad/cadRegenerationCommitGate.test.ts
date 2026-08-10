import { describe, expect, it, vi } from 'vitest';
import { commitAfterCadRegenerationGate, gateCadRegenerationCommit } from './cadRegenerationCommitGate';
import type { TopologyRemapResult } from './topologyRemap';

const hash = (char: string) => char.repeat(64);
const kernel = { status: 'success' as const, geometryContentHash: hash('a'), shapeIdentityHash: hash('b') };
const remap = (quality: TopologyRemapResult['quality']): TopologyRemapResult => ({
  previousRef: 'face:mount', mappedRef: quality === 'broken' || quality === 'ambiguous' ? undefined : 'face:mount-v2',
  quality, score: quality === 'persistent' ? 1 : 0.8, reason: `fixture:${quality}`,
});

describe('CAD regeneration commit gate', () => {
  it('commits when persistent names survive', async () => {
    const gate = gateCadRegenerationCommit({ kernel, remaps: [remap('persistent')] });
    const commit = vi.fn(async () => 'revision-2');
    expect(gate).toMatchObject({ status: 'committable', committable: true, preserveBaseRevision: false });
    await expect(commitAfterCadRegenerationGate(gate, commit)).resolves.toEqual({ committed: true, value: 'revision-2' });
    expect(commit).toHaveBeenCalledOnce();
  });

  it('requires explicit confirmation for a derived match', () => {
    expect(gateCadRegenerationCommit({ kernel, remaps: [remap('derived')] })).toMatchObject({
      status: 'confirmation_required', committable: false, preserveBaseRevision: true,
      confirmationRequiredRefs: ['face:mount'], geometryContentHash: null,
    });
    expect(gateCadRegenerationCommit({ kernel, remaps: [remap('derived')], confirmedDerivedRefs: ['face:mount'] }))
      .toMatchObject({ status: 'committable', confirmedDerivedRefs: ['face:mount'] });
  });

  it.each(['broken', 'ambiguous'] as const)('surfaces %s as reference_lost without partial commit', async quality => {
    const gate = gateCadRegenerationCommit({ kernel, remaps: [remap(quality)] });
    const commit = vi.fn(async () => 'must-not-run');
    expect(gate).toMatchObject({ status: 'reference_lost', committable: false, preserveBaseRevision: true });
    expect(await commitAfterCadRegenerationGate(gate, commit)).toMatchObject({ committed: false });
    expect(commit).not.toHaveBeenCalled();
  });

  it('preserves the base revision when the exact kernel operation fails', () => {
    expect(gateCadRegenerationCommit({
      kernel: { status: 'failed', errorCode: 'OCCT_BOOLEAN_FAILED' }, remaps: [],
    })).toMatchObject({
      status: 'kernel_failed', committable: false, preserveBaseRevision: true,
      geometryContentHash: null, shapeIdentityHash: null,
    });
  });

  it('rejects duplicate remap evidence and fabricated confirmations', () => {
    expect(gateCadRegenerationCommit({
      kernel, remaps: [remap('persistent'), remap('persistent')], confirmedDerivedRefs: ['face:other'],
    })).toMatchObject({ status: 'invalid_evidence', committable: false });
  });
});
