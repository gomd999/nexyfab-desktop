import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_DESIGN_SOURCE_MIGRATION_CHECKSUM_ENV,
  AI_DESIGN_SOURCE_MIGRATION_VERSION,
  assertAiDesignSourceArtifactSchema,
  validateAiDesignSourceFile,
} from './aiDesignSourceArtifactStore';

describe('AI design source file validation', () => {
  it('accepts real PNG signatures and returns a content hash', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    expect(validateAiDesignSourceFile({ filename: 'drawing.png', mimeType: 'image/png', kind: 'drawing_2d', bytes })).toMatchObject({ ok: true, kind: 'drawing_2d', sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it('rejects MIME spoofing and unsafe names', () => {
    expect(validateAiDesignSourceFile({ filename: 'drawing.png', mimeType: 'image/png', kind: 'image', bytes: new Uint8Array([1, 2, 3]) })).toEqual({ ok: false, code: 'SOURCE_SIGNATURE_INVALID' });
    expect(validateAiDesignSourceFile({ filename: '../drawing.png', mimeType: 'image/png', kind: 'image', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) })).toEqual({ ok: false, code: 'INVALID_FILENAME' });
  });
});

describe('AI design source schema authority', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('requires the exact versioned Postgres migration without request-time DDL', async () => {
    const checksum = 'a'.repeat(64);
    vi.stubEnv(AI_DESIGN_SOURCE_MIGRATION_CHECKSUM_ENV, checksum);
    const executeRaw = vi.fn();
    const queryOne = vi.fn().mockResolvedValue({ version: AI_DESIGN_SOURCE_MIGRATION_VERSION, checksum });
    const db = { backend: 'postgres', queryOne, executeRaw } as unknown as import('@/lib/db-adapter').DbAdapter;

    await expect(assertAiDesignSourceArtifactSchema(db)).resolves.toBeUndefined();
    expect(queryOne).toHaveBeenCalledWith(
      expect.stringContaining('nf_schema_migrations'),
      AI_DESIGN_SOURCE_MIGRATION_VERSION,
    );
    expect(executeRaw).not.toHaveBeenCalled();

    vi.stubEnv(AI_DESIGN_SOURCE_MIGRATION_CHECKSUM_ENV, 'b'.repeat(64));
    await expect(assertAiDesignSourceArtifactSchema(db)).rejects.toThrow('AI_DESIGN_SOURCE_MIGRATION_REQUIRED');
  });
});
