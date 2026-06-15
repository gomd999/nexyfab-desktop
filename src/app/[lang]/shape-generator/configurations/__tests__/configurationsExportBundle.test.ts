/**
 * configurationsExportBundle.test.ts — C7 configurations bundle.
 *
 * Verifies:
 *  - empty configs throws
 *  - happy path: 3 configs → 3 STEP entries + manifest.json
 *  - per-config exporter failure → status:'failed' diagnostic, bundle
 *    still ships
 *  - exporter returning null is a failure (not a crash)
 *  - drawing SVG is bundled alongside STEP when supplied
 *  - manifest content matches input order + counts
 *  - slug sanitization handles spaces / Korean / special chars
 *  - bundleInputsFromConfigEntries maps ConfigEntry → BundleConfigInput
 */

import { describe, it, expect, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  buildConfigurationsBundle,
  bundleInputsFromConfigEntries,
  type BundleConfigInput,
} from '../configurationsExportBundle';
import type { ConfigEntry } from '../types';

const fakeStep = (name: string) => `ISO-10303-21;
HEADER;
FILE_NAME('${name}.step','2026-05-29',(''),(''),'','','');
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;
`;

describe('buildConfigurationsBundle — preconditions', () => {
  it('throws when configs is empty', async () => {
    await expect(
      buildConfigurationsBundle({
        partName: 'p',
        configs: [],
        exportConfigStep: async () => fakeStep('x'),
      }),
    ).rejects.toThrow(/empty/);
  });
});

describe('buildConfigurationsBundle — happy path', () => {
  it('3 configs → manifest + 3 STEP entries in zip', async () => {
    const configs: BundleConfigInput[] = [
      { id: 'c1', name: 'baseline' },
      { id: 'c2', name: 'tall' },
      { id: 'c3', name: 'short' },
    ];
    const result = await buildConfigurationsBundle({
      partName: 'bracket',
      configs,
      exportConfigStep: async (id) => fakeStep(id),
      nowIsoOverride: '2026-05-29T00:00:00.000Z',
    });

    expect(result.manifest.configCount).toBe(3);
    expect(result.manifest.entries.length).toBe(3);
    expect(result.diagnostics).toEqual([]);

    const files = unzipSync(result.zipBytes);
    expect(Object.keys(files).sort()).toEqual([
      'bracket/baseline/baseline.step',
      'bracket/manifest.json',
      'bracket/short/short.step',
      'bracket/tall/tall.step',
    ].sort());
  });

  it('manifest.json content matches the manifest object', async () => {
    const result = await buildConfigurationsBundle({
      partName: 'bracket',
      configs: [{ id: 'c1', name: 'baseline' }],
      exportConfigStep: async () => fakeStep('c1'),
      nowIsoOverride: '2026-05-29T00:00:00.000Z',
    });
    const files = unzipSync(result.zipBytes);
    const manifestJson = JSON.parse(strFromU8(files['bracket/manifest.json']));
    expect(manifestJson.partName).toBe('bracket');
    expect(manifestJson.generatedAt).toBe('2026-05-29T00:00:00.000Z');
    expect(manifestJson.entries[0]).toMatchObject({
      configId: 'c1',
      configName: 'baseline',
      status: 'ok',
      stepPath: 'bracket/baseline/baseline.step',
    });
  });

  it('drawings bundled alongside STEP when supplied', async () => {
    const result = await buildConfigurationsBundle({
      partName: 'bracket',
      configs: [
        { id: 'c1', name: 'baseline', drawingSvg: '<svg/>' },
        { id: 'c2', name: 'tall' }, // no drawing
      ],
      exportConfigStep: async (id) => fakeStep(id),
    });
    const files = unzipSync(result.zipBytes);
    expect(files['bracket/baseline/baseline.svg']).toBeDefined();
    expect(files['bracket/tall/tall.svg']).toBeUndefined();
    expect(result.manifest.entries[0].drawingPath).toBe('bracket/baseline/baseline.svg');
    expect(result.manifest.entries[1].drawingPath).toBeUndefined();
  });
});

describe('buildConfigurationsBundle — partial failure', () => {
  it('per-config exporter throw → manifest status:failed, others still ship', async () => {
    const exportConfigStep = vi.fn(async (id: string) => {
      if (id === 'broken') throw new Error('OCCT bridge timeout');
      return fakeStep(id);
    });
    const result = await buildConfigurationsBundle({
      partName: 'mix',
      configs: [
        { id: 'good1', name: 'a' },
        { id: 'broken', name: 'b' },
        { id: 'good2', name: 'c' },
      ],
      exportConfigStep,
    });
    expect(result.manifest.configCount).toBe(3);
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]).toMatchObject({
      configId: 'broken',
      status: 'failed',
      failureReason: 'OCCT bridge timeout',
    });
    const files = unzipSync(result.zipBytes);
    // Good configs shipped; failed one absent.
    expect(files['mix/a/a.step']).toBeDefined();
    expect(files['mix/c/c.step']).toBeDefined();
    expect(files['mix/b/b.step']).toBeUndefined();
  });

  it('exporter returning null is treated as a failure', async () => {
    const result = await buildConfigurationsBundle({
      partName: 'nul',
      configs: [{ id: 'c1', name: 'x' }],
      exportConfigStep: async () => null,
    });
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].failureReason).toMatch(/null/);
  });
});

describe('buildConfigurationsBundle — slug sanitization', () => {
  it('slugifies spaces, Korean, special chars', async () => {
    const result = await buildConfigurationsBundle({
      partName: '브라켓 / v2',
      configs: [
        { id: 'c1', name: '베이스라인 (default)' },
        { id: 'c2', name: 'tall + thin' },
      ],
      exportConfigStep: async (id) => fakeStep(id),
    });
    const paths = Object.keys(unzipSync(result.zipBytes));
    // All paths use the [\w.-]+ slug — no spaces / non-word chars.
    for (const p of paths) {
      // path separator '/' is allowed; check each segment.
      for (const seg of p.split('/')) {
        expect(seg).toMatch(/^[\w.-]+$/);
      }
    }
  });
});

describe('bundleInputsFromConfigEntries — adapter', () => {
  it('maps ConfigEntry[] → BundleConfigInput[] (id + name only)', () => {
    const configs: ConfigEntry[] = [
      { id: 'c1', name: 'baseline', overrides: {}, expressionVars: {} },
      { id: 'c2', name: 'tall', overrides: {}, expressionVars: {} },
    ];
    const inputs = bundleInputsFromConfigEntries(configs);
    expect(inputs).toEqual([
      { id: 'c1', name: 'baseline', drawingSvg: undefined },
      { id: 'c2', name: 'tall', drawingSvg: undefined },
    ]);
  });

  it('layers drawing SVGs from the optional map', () => {
    const configs: ConfigEntry[] = [
      { id: 'c1', name: 'baseline', overrides: {}, expressionVars: {} },
    ];
    const inputs = bundleInputsFromConfigEntries(configs, { c1: '<svg/>' });
    expect(inputs[0].drawingSvg).toBe('<svg/>');
  });
});
