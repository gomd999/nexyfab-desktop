import { describe, expect, it } from 'vitest';
import { parseReferenceBaselineArgs, REFERENCE_BASELINE_LOCAL_CAPABILITY } from './reference-baseline-cli';
import { referenceBaselineErrorExit, REFERENCE_BASELINE_EXIT } from './run-cad-reference-baseline';

describe('reference baseline local CLI contract', () => {
  it('parses root/output, explicit units, shard and resume deterministically', () => {
    const result = parseReferenceBaselineArgs([
      '--root', 'corpus', '--output', 'reports', '--unit', 'in', '--tolerance', '0.001',
      '--tier', 'core-a', '--shard-index', '2', '--shard-count', '4', '--resume',
    ], 'C:/work');
    expect(result).toEqual({ ok: true, value: {
      corpusRoot: 'C:\\work\\corpus', outputDir: 'C:\\work\\reports',
      lengthUnit: { kind: 'scale-to-mm', scaleToMm: 25.4, label: 'in' },
      declaredSourceTolerance: { value: 0.001 }, tier: 'core-a', shard: { index: 2, count: 4 }, resume: true,
    } });
  });

  it.each([
    ['missing output', ['--root', 'corpus', '--unit', 'mm']],
    ['ambiguous units', ['--root', 'corpus', '--output', 'out']],
    ['partial shard', ['--root', 'corpus', '--output', 'out', '--unit', 'mm', '--shard-index', '1']],
    ['invalid shard', ['--root', 'corpus', '--output', 'out', '--unit', 'mm', '--shard-index', '3', '--shard-count', '2']],
    ['unknown option', ['--root', 'corpus', '--output', 'out', '--unit', 'mm', '--url', 'https://example.test']],
    ['overlapping output', ['--root', 'corpus', '--output', 'corpus/results', '--unit', 'mm']],
  ])('rejects %s', (_label, args) => expect(parseReferenceBaselineArgs(args, 'C:/work').ok).toBe(false));

  it('declares paths as local-only with no API, MCP, quote, or RFQ surface', () => {
    expect(REFERENCE_BASELINE_LOCAL_CAPABILITY).toMatchObject({ localOnly: true, api: null, mcp: null, acceptsLocalPaths: true, quoteOrRfqSideEffects: false });
  });

  it('parses a unique fixture isolation list', () => {
    const result = parseReferenceBaselineArgs([
      '--root', 'corpus', '--output', 'reports', '--unit', 'mm', '--fixture', 'A08,B07',
    ], 'C:/work');
    expect(result).toMatchObject({ ok: true, value: { fixtureIds: ['A08', 'B07'] } });
  });

  it.each(['A00', 'A19', 'B08', 'A01,A01', ''])('rejects invalid fixture isolation %s', fixture => {
    expect(parseReferenceBaselineArgs([
      '--root', 'corpus', '--output', 'reports', '--unit', 'mm', '--fixture', fixture,
    ], 'C:/work').ok).toBe(false);
  });

  it('maps stale checkpoints and changed sources to the analysis exit code', () => {
    expect(referenceBaselineErrorExit({ code: 'CHECKPOINT_SIGNATURE_MISMATCH' })).toBe(REFERENCE_BASELINE_EXIT.analysis);
    expect(referenceBaselineErrorExit({ code: 'SOURCE_CHANGED' })).toBe(REFERENCE_BASELINE_EXIT.analysis);
    expect(referenceBaselineErrorExit(new Error('unexpected'))).toBe(REFERENCE_BASELINE_EXIT.runtime);
  });
});
