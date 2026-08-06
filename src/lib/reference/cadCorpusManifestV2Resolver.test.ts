import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAD_CORPUS_MANIFEST_V2,
  type CadCorpusFixtureV2,
  type CadCorpusManifestV2,
} from './cadCorpusManifestV2';
import {
  CadCorpusResolveError,
  freezeCadCorpusManifestV2,
  resolveCadCorpusFixtureV2,
} from './cadCorpusManifestV2Resolver';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function fixture(id: string, filename: string, budget = 1024): CadCorpusFixtureV2 {
  return {
    fixtureId: id,
    locator: { kind: 'path-fragments', fragments: ['product', filename] },
    format: 'step',
    grade: 'A',
    tier: 'core-a',
    split: 'evaluation',
    assertions: ['closed_solid'],
    usage: { storage: 'local-only', redistribution: 'forbidden-until-proven', promptExample: false },
    holdoutGroup: `product-${id.toLowerCase()}`,
    byteBudget: budget,
  };
}

function manifest(fixtures: CadCorpusFixtureV2[], runBudget = 4096): CadCorpusManifestV2 {
  return {
    schema: 'nexyfab.cad-corpus-manifest.v2',
    lifecycle: 'draft',
    byteBudget: { maxFixtureBytes: 2048, maxRunBytes: runBudget },
    fixtures,
  };
}

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'nexyfab-corpus-v2-'));
  roots.push(root);
  return root;
}

async function put(root: string, branch: string, filename: string, data: string) {
  const directory = join(root, branch, 'product');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), data);
}

describe('CAD corpus Manifest v2 resolver/freezer', () => {
  it.runIf(Boolean(process.env.NEXYFAB_CAD_CORPUS_ROOT))(
    'uniquely resolves and freezes all declared real-corpus fixtures',
    async () => {
      const frozen = await freezeCadCorpusManifestV2(
        CAD_CORPUS_MANIFEST_V2,
        process.env.NEXYFAB_CAD_CORPUS_ROOT!,
      );
      expect(frozen.fixtures).toHaveLength(25);
      expect(frozen.fixtures.every(item => item.sha256?.length === 64 && (item.bytes ?? 0) > 0)).toBe(true);
      expect(JSON.stringify(frozen)).not.toContain(process.env.NEXYFAB_CAD_CORPUS_ROOT!);
    },
    120_000,
  );

  it('resolves ordered fragments and returns only a relative path and fingerprint', async () => {
    const root = await tempRoot();
    const directory = join(root, 'vendor', 'my-PRODUCT-files');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'PART.STEP'), 'STEP-DATA');

    const result = await resolveCadCorpusFixtureV2(root, fixture('A01', 'part.step'));
    expect(result).toEqual({
      fixtureId: 'A01',
      relativePath: 'vendor/my-PRODUCT-files/PART.STEP',
      bytes: 9,
      sha256: createHash('sha256').update('STEP-DATA').digest('hex'),
    });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).not.toContain('STEP-DATA');
  });

  it('rejects zero and multiple locator matches deterministically', async () => {
    const root = await tempRoot();
    const target = fixture('A01', 'part.step');
    await expect(resolveCadCorpusFixtureV2(root, target)).rejects.toMatchObject({ code: 'LOCATOR_NOT_FOUND' });

    await put(root, 'one', 'part.step', 'one');
    await put(root, 'two', 'part.step', 'two');
    await expect(resolveCadCorpusFixtureV2(root, target)).rejects.toMatchObject({ code: 'LOCATOR_AMBIGUOUS' });
  });

  it('enforces per-fixture and run-wide byte budgets', async () => {
    const root = await tempRoot();
    await put(root, 'one', 'large.step', '12345');
    await expect(resolveCadCorpusFixtureV2(root, fixture('A01', 'large.step', 4))).rejects.toMatchObject({
      code: 'BYTE_BUDGET_EXCEEDED',
    });

    await put(root, 'two', 'other.step', '67890');
    await expect(freezeCadCorpusManifestV2(manifest([
      fixture('A01', 'large.step'),
      fixture('A02', 'other.step'),
    ], 9), root)).rejects.toBeInstanceOf(CadCorpusResolveError);
  });

  it('freezes a cloned manifest without mutating or leaking source paths or bytes', async () => {
    const root = await tempRoot();
    await put(root, 'one', 'first.step', 'CAD-BYTES-ONE');
    await put(root, 'two', 'second.step', 'CAD-BYTES-TWO');
    const draft = manifest([fixture('A01', 'first.step'), fixture('A02', 'second.step')]);
    const before = structuredClone(draft);

    const frozen = await freezeCadCorpusManifestV2(draft, root);

    expect(draft).toEqual(before);
    expect(frozen).not.toBe(draft);
    expect(frozen.lifecycle).toBe('frozen');
    expect(frozen.fixtures.every(item => item.sha256?.length === 64 && (item.bytes ?? 0) > 0)).toBe(true);
    expect(JSON.stringify(frozen)).not.toContain(root);
    expect(JSON.stringify(frozen)).not.toContain('CAD-BYTES-ONE');
    expect(frozen.fixtures[0]!.locator.fragments).toEqual(['product', 'first.step']);
  });

  it('rejects an invalid root and refuses to re-freeze a snapshot', async () => {
    const root = await tempRoot();
    await put(root, 'one', 'part.step', 'data');
    const frozen = await freezeCadCorpusManifestV2(manifest([fixture('A01', 'part.step')]), root);

    await expect(resolveCadCorpusFixtureV2(join(root, 'missing'), fixture('A01', 'part.step')))
      .rejects.toMatchObject({ code: 'INVALID_ROOT' });
    await expect(freezeCadCorpusManifestV2(frozen, root))
      .rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
  });
});
