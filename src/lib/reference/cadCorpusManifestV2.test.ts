import { describe, expect, it } from 'vitest';
import {
  CAD_CORPUS_MANIFEST_V2,
  validateCadCorpusManifestV2,
  type CadCorpusManifestV2,
} from './cadCorpusManifestV2';

function copyManifest(): CadCorpusManifestV2 {
  return structuredClone(CAD_CORPUS_MANIFEST_V2);
}

describe('CAD corpus manifest v2', () => {
  it('declares the metadata-only Core A18 and Challenge B7 sets', () => {
    expect(validateCadCorpusManifestV2(CAD_CORPUS_MANIFEST_V2)).toEqual([]);
    expect(CAD_CORPUS_MANIFEST_V2.fixtures.filter(item => item.tier === 'core-a')).toHaveLength(18);
    expect(CAD_CORPUS_MANIFEST_V2.fixtures.filter(item => item.tier === 'challenge-b')).toHaveLength(7);
    expect(CAD_CORPUS_MANIFEST_V2.fixtures.every(item => item.sha256 === undefined)).toBe(true);
    expect(JSON.stringify(CAD_CORPUS_MANIFEST_V2)).not.toMatch(/[A-Za-z]:\\|\/Users\//);
  });

  it('rejects duplicate ids and malformed hashes', () => {
    const manifest = copyManifest();
    manifest.fixtures[1]!.fixtureId = manifest.fixtures[0]!.fixtureId;
    manifest.fixtures[0]!.sha256 = 'ABC123';

    const codes = validateCadCorpusManifestV2(manifest).map(issue => issue.code);
    expect(codes).toContain('duplicate_fixture_id');
    expect(codes).toContain('invalid_hash');
  });

  it('requires hash and observed bytes only when freezing', () => {
    const manifest = copyManifest();
    manifest.lifecycle = 'frozen';
    const issues = validateCadCorpusManifestV2(manifest);
    expect(issues.filter(issue => issue.code === 'freeze_incomplete').length).toBe(50);

    for (const item of manifest.fixtures) {
      item.sha256 = 'a'.repeat(64);
      item.bytes = 1024;
    }
    expect(validateCadCorpusManifestV2(manifest)).toEqual([]);
  });

  it('rejects absolute/traversing locators and invalid policy or budgets', () => {
    const manifest = copyManifest();
    manifest.fixtures[0]!.locator.fragments = ['C:', '..', 'secret.step'];
    manifest.fixtures[0]!.byteBudget = -1;
    manifest.fixtures[0]!.usage.promptExample = true as false;

    const codes = validateCadCorpusManifestV2(manifest).map(issue => issue.code);
    expect(codes).toContain('unsafe_locator');
    expect(codes).toContain('invalid_byte_budget');
    expect(codes).toContain('invalid_fixture');
  });

  it('detects product-level holdout leakage across data splits', () => {
    const manifest = copyManifest();
    manifest.fixtures[1]!.holdoutGroup = manifest.fixtures[0]!.holdoutGroup;
    manifest.fixtures[1]!.split = 'example';

    expect(validateCadCorpusManifestV2(manifest)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'holdout_leakage' }),
    ]));
  });

  it('rejects invalid enum fields, duplicate assertions, and oversized fixtures', () => {
    const manifest = copyManifest();
    const item = manifest.fixtures[0]!;
    item.grade = 'C' as 'A';
    item.assertions = ['volume', 'volume'];
    item.bytes = item.byteBudget + 1;

    const codes = validateCadCorpusManifestV2(manifest).map(issue => issue.code);
    expect(codes).toContain('invalid_fixture');
    expect(codes).toContain('invalid_assertions');
    expect(codes).toContain('invalid_byte_budget');
  });
});
