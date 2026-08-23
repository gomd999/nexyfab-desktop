import { describe, expect, it, vi } from 'vitest';
import { InMemoryImmutableArtifactStore } from './commercialWorkerArtifactSnapshot';
import { persistCommercialWorkerResult } from './commercialWorkerPersistenceCoordinator';
describe('commercial persistence coordinator', () => {
  it('holds without commercial PostgreSQL migration and performs no artifact copy', async () => {
    const put = vi.fn(); const result = await persistCommercialWorkerResult({ db: { backend: 'sqlite' } as never, artifactStore: { read: async () => new Uint8Array([1]), putImmutable: put }, receipt: {} as never, expected: {} as never, trustedWorkers: {}, metadata: [], parserReceipt: {} as never, trustedParser: {} as never });
    expect(result).toMatchObject({ ok: false, code: 'MIGRATION_REQUIRED' }); expect(put).not.toHaveBeenCalled();
  });
  it('does not treat an in-memory/local store as commercial persistence', async () => {
    const result = await persistCommercialWorkerResult({ db: { backend: 'sqlite' } as never, artifactStore: new InMemoryImmutableArtifactStore(), receipt: {} as never, expected: {} as never, trustedWorkers: {}, metadata: [], parserReceipt: {} as never, trustedParser: {} as never });
    expect(result.ok).toBe(false); expect(result.status).toBe('HOLD');
  });
});
