import { describe, it, expect, beforeAll } from 'vitest';
import { FEATURE_REGISTRY } from './registry';
import {
  registerAllFeatureLoaders,
  wiredFeatureIds,
  INSPECTION_GDT_LOADERS,
} from './featureLoaders';
import { FEATURE_EXAMPLES } from './featureExamples';
import {
  launchFeature,
  runFeature,
  runWithExample,
  summarizeResult,
  resolveEntryFunction,
} from './featureLauncher';

beforeAll(() => {
  registerAllFeatureLoaders();
});

describe('featureLoaders wiring', () => {
  it('every wired id exists in the registry', () => {
    const ids = new Set(FEATURE_REGISTRY.map(e => e.id));
    const orphans = wiredFeatureIds().filter(id => !ids.has(id));
    expect(orphans, `Wired ids not in registry:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('wires the full inspection GD&T family', () => {
    expect(Object.keys(INSPECTION_GDT_LOADERS)).toHaveLength(12);
  });

  it('every wired loader imports a real module with callable exports', async () => {
    const ids = wiredFeatureIds();
    expect(ids.length).toBeGreaterThan(100); // inspection + mold + cam
    const broken: string[] = [];
    for (const id of ids) {
      try {
        const launched = await launchFeature(id);
        if (launched.functionExports.length === 0) broken.push(`${id} (no callable exports)`);
      } catch (e) {
        broken.push(`${id} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    expect(broken, `Loaders that failed to import:\n${broken.join('\n')}`).toEqual([]);
  });
});

describe('launchFeature (real dynamic import)', () => {
  it.each(Object.keys(INSPECTION_GDT_LOADERS))(
    'loads %s and resolves a callable entry function',
    async (id) => {
      const launched = await launchFeature(id);
      expect(launched.module).toBeTypeOf('object');
      expect(launched.functionExports.length).toBeGreaterThan(0);
      expect(launched.entryFunctionName).not.toBeNull();
      expect(typeof launched.module[launched.entryFunctionName!]).toBe('function');
    },
  );

  it('flatness resolves evaluateFlatness as its entry', async () => {
    const launched = await launchFeature('inspection.flatness-tolerance');
    expect(launched.entryFunctionName).toBe('evaluateFlatness');
  });

  it('most evaluators resolve plain `evaluate`', async () => {
    const launched = await launchFeature('inspection.angularity');
    expect(launched.entryFunctionName).toBe('evaluate');
  });

  it('straightness (no plain evaluate) resolves evaluateLine', async () => {
    const launched = await launchFeature('inspection.straightness');
    expect(launched.entryFunctionName).toBe('evaluateLine');
  });

  it('exposes summarize availability', async () => {
    const launched = await launchFeature('inspection.cylindricity');
    expect(launched.hasSummarize).toBe(true);
  });

  it('throws for an unregistered id', async () => {
    await expect(launchFeature('inspection.flatness-tolerance.nope')).rejects.toThrow();
  });
});

describe('runFeature end-to-end (click → execute)', () => {
  it('runs circular runout on a real section and summarizes', async () => {
    const launched = await launchFeature('inspection.circular-runout');
    const sections = [{
      axialPositionMm: 0,
      readings: Array.from({ length: 12 }, (_, i) => ({ angleDeg: (i * 360) / 12, radiusMm: 10 })),
    }];
    const result = runFeature(launched, { sections, toleranceMm: 0.05 });
    const summary = summarizeResult(launched, result) as { passed: boolean };
    expect(summary.passed).toBe(true);
  });

  it('runs angularity and gets a pass on ideal points', async () => {
    const launched = await launchFeature('inspection.angularity');
    const t = 30 * Math.PI / 180;
    const points = Array.from({ length: 9 }, (_, i) => {
      const x = (i % 3) * 10;
      const y = Math.floor(i / 3) * 10;
      return { x, y, z: y * Math.tan(t) };
    });
    const result = runFeature(launched, {
      points,
      datumNormal: { x: 0, y: 0, z: 1 },
      basicAngleDeg: 30,
      rotationAxis: { x: 1, y: 0, z: 0 },
      toleranceMm: 0.05,
    }) as { passed: boolean };
    expect(result.passed).toBe(true);
  });

  it.each(Object.keys(INSPECTION_GDT_LOADERS))(
    'runs the registered demo example for %s',
    async (id) => {
      const launched = await launchFeature(id);
      expect(launched.hasExample).toBe(true);
      const result = runWithExample(launched);
      expect(result).toBeTypeOf('object');
      expect(result).not.toBeNull();
    },
  );

  it.each(Object.keys(FEATURE_EXAMPLES))(
    'every registered example runs without throwing for %s',
    async (id) => {
      const launched = await launchFeature(id);
      expect(launched.hasExample).toBe(true);
      const result = runWithExample(launched);
      expect(result).not.toBeUndefined();
      expect(result).not.toBeNull();
    },
  );

  it('runFeature throws when no entry function', () => {
    const fake = {
      id: 'x', name: 'x', entryHint: '', module: {},
      functionExports: [], entryFunctionName: null, hasSummarize: false, hasExample: false,
    };
    expect(() => runFeature(fake)).toThrow();
  });
});

describe('resolveEntryFunction convention', () => {
  it('prefers evaluate over helpers', () => {
    const mod = { summarize: () => {}, helper: () => {}, evaluate: () => {} };
    expect(resolveEntryFunction(mod)).toBe('evaluate');
  });

  it('skips summarize when picking a fallback', () => {
    const mod = { summarize: () => {}, doThing: () => {} };
    expect(resolveEntryFunction(mod)).toBe('doThing');
  });

  it('null when no callable exports', () => {
    expect(resolveEntryFunction({ x: 1 } as Record<string, unknown>)).toBeNull();
  });
});
