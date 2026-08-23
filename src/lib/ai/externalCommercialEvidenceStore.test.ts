import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createInMemoryExternalCommercialEvidenceStore, type ExternalCommercialEvidence } from './externalCommercialEvidenceStore';

const bytes = new Uint8Array([1, 2, 3]);
const value: ExternalCommercialEvidence = { evidenceId: 'ev-1', tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1', generationRunId: 'run-1', revision: 1, modelContentHash: 'a'.repeat(64), targetSha256: 'b'.repeat(64), role: 'step', bytes, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };

describe('external commercial evidence store', () => {
  it('stores private bytes by immutable tenant/project identity and returns copies', async () => {
    const store = createInMemoryExternalCommercialEvidenceStore();
    expect(await store.put(value)).toEqual({ ok: true });
    const loaded = await store.get(value.tenantId, value.projectId, value.evidenceId);
    expect(loaded).toMatchObject({ evidenceId: value.evidenceId, sha256: value.sha256, size: 3 });
    loaded!.bytes[0] = 99;
    expect((await store.get(value.tenantId, value.projectId, value.evidenceId))!.bytes[0]).toBe(1);
    expect(await store.get('other-tenant', value.projectId, value.evidenceId)).toBeUndefined();
  });

  it('rejects forged hash/size and immutable transplant', async () => {
    const store = createInMemoryExternalCommercialEvidenceStore();
    expect(await store.put({ ...value, sha256: 'c'.repeat(64) })).toMatchObject({ ok: false, code: 'EVIDENCE_METADATA_INVALID' });
    expect(await store.put({ ...value, size: 4 })).toMatchObject({ ok: false, code: 'EVIDENCE_METADATA_INVALID' });
    expect(await store.put(value)).toEqual({ ok: true });
    expect(await store.put({ ...value, targetSha256: 'd'.repeat(64) })).toMatchObject({ ok: false, code: 'EVIDENCE_IMMUTABLE_CONFLICT' });
  });
});
