import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { issueAiDesignServerEvidenceReceipt } from './aiDesignServerEvidenceReceipt';
import { InMemoryAiDesignServerRuntimeArtifacts } from './aiDesignServerRuntimeArtifacts';

const hash = (char: string) => char.repeat(64);

describe('AI Design server runtime artifact repository', () => {
  it('allows content-identical replay and rejects immutable receipt overwrite', async () => {
    const store = new InMemoryAiDesignServerRuntimeArtifacts();
    const receipt = issueAiDesignServerEvidenceReceipt({ projectId: 'p1', sessionId: 's1', commandId: 'c1', checkpointId: 'cp1', checkpointDigest: hash('a'), runtimeRevision: 0, generationRevision: null, stage: 'understanding', outcome: 'PASS', inputDigest: hash('a'), outputDigest: hash('a'), source: 'ai-design-worker-v2', codes: [] }, 'ai-design-server-evidence-secret-at-least-32-bytes', new Date('2026-08-24T00:00:00.000Z'));
    await store.putImmutable(receipt);
    await store.putImmutable(structuredClone(receipt));
    await expect(store.putImmutable({ ...receipt, codes: ['mutated'] })).rejects.toThrow('OVERWRITE_FORBIDDEN');
    expect(store.getReceipt(receipt.receiptId)).toEqual(receipt);
  });
});
