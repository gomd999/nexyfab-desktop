import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FEATURE_REGISTRY } from './registry';
import {
  entryHintToRelativeSpecifier,
  entryHintForId,
  registerLoader,
  registerLoaders,
  loadModule,
  hasLoader,
  unwiredFeatureIds,
  loaderCoverage,
} from './moduleResolver';

const here = dirname(fileURLToPath(import.meta.url)); // featureCatalog/

/** Resolve an entryHint to candidate absolute source files. */
function candidatePaths(entryHint: string): string[] {
  const spec = entryHintToRelativeSpecifier(entryHint); // '../<hint>'
  const baseAbs = resolve(here, spec);
  return [`${baseAbs}.ts`, `${baseAbs}.tsx`, resolve(baseAbs, 'index.ts')];
}

describe('registry entryHint integrity', () => {
  it('every entryHint resolves to a real source file', () => {
    const broken: string[] = [];
    for (const entry of FEATURE_REGISTRY) {
      const ok = candidatePaths(entry.entryHint).some(p => existsSync(p));
      if (!ok) broken.push(`${entry.id} → ${entry.entryHint}`);
    }
    expect(broken, `Broken entryHints:\n${broken.join('\n')}`).toEqual([]);
  });

  it('all ids are unique', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of FEATURE_REGISTRY) {
      if (seen.has(e.id)) dupes.push(e.id);
      seen.add(e.id);
    }
    expect(dupes).toEqual([]);
  });

  it('shared entryHints are limited to the known intentional set', () => {
    // A single implementation can legitimately be surfaced under more than
    // one catalog entry (e.g. the 1D tolerance stack-up appears under both
    // the 'tolerance' and 'quality' families). New unexpected sharing is a
    // copy-paste smell, so we pin the allowed set.
    const ALLOWED_SHARED = new Set<string>(['tolerance/toleranceStackup']);
    const seen = new Set<string>();
    const unexpected: string[] = [];
    for (const e of FEATURE_REGISTRY) {
      if (seen.has(e.entryHint) && !ALLOWED_SHARED.has(e.entryHint)) {
        unexpected.push(e.entryHint);
      }
      seen.add(e.entryHint);
    }
    expect(unexpected, `Unexpected shared entryHints:\n${unexpected.join('\n')}`).toEqual([]);
  });

  it('registry is non-trivial (sanity)', () => {
    expect(FEATURE_REGISTRY.length).toBeGreaterThan(500);
  });
});

describe('entryHintToRelativeSpecifier', () => {
  it('prepends one ../ for the featureCatalog → shape-generator hop', () => {
    expect(entryHintToRelativeSpecifier('cam/turningToolpath')).toBe('../cam/turningToolpath');
  });

  it('preserves escaping hints (lib path)', () => {
    expect(entryHintToRelativeSpecifier('../../../lib/ai/prompts/promptEvaluation'))
      .toBe('../../../../lib/ai/prompts/promptEvaluation');
  });
});

describe('entryHintForId', () => {
  it('returns the hint for a known id', () => {
    const e = FEATURE_REGISTRY[0]!;
    expect(entryHintForId(e.id)).toBe(e.entryHint);
  });

  it('null for unknown id', () => {
    expect(entryHintForId('does.not.exist')).toBeNull();
  });
});

describe('loader registry', () => {
  it('loadModule throws a helpful error when no loader registered', async () => {
    await expect(loadModule('totally.unknown.id')).rejects.toThrow(/unknown feature id/);
  });

  it('registerLoader + loadModule round-trips', async () => {
    const sentinel = { hello: 'world' };
    registerLoader('test.loader.one', async () => sentinel);
    expect(hasLoader('test.loader.one')).toBe(true);
    await expect(loadModule('test.loader.one')).resolves.toBe(sentinel);
  });

  it('registerLoaders registers a batch', async () => {
    registerLoaders({
      'test.loader.two': async () => ({ a: 1 }),
      'test.loader.three': async () => ({ b: 2 }),
    });
    expect(hasLoader('test.loader.two')).toBe(true);
    expect(hasLoader('test.loader.three')).toBe(true);
  });

  it('unwired ids exclude registered loaders', () => {
    // a registered real-id loader should drop out of the unwired list
    const realId = FEATURE_REGISTRY[0]!.id;
    registerLoader(realId, async () => ({}));
    expect(unwiredFeatureIds()).not.toContain(realId);
  });

  it('coverage fraction is between 0 and 1', () => {
    const c = loaderCoverage();
    expect(c.fraction).toBeGreaterThanOrEqual(0);
    expect(c.fraction).toBeLessThanOrEqual(1);
    expect(c.total).toBe(FEATURE_REGISTRY.length);
  });
});
