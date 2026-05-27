import { describe, it, expect } from 'vitest';
import {
  exportPmi,
  roundTripJson,
  summarize,
  type PmiAnnotation,
} from './pmiMachineReadableExport';

function dim(id: string, nominal: number, plus: number = 0.1, minus: number = 0.1): PmiAnnotation {
  return { id, kind: 'dimension', nominal, plus, minus, featureId: `feat-${id}` };
}

function gdt(id: string, sym: string, datums: string[]): PmiAnnotation {
  return { id, kind: 'gdt', text: sym, datums, featureId: `feat-${id}` };
}

describe('exportPmi', () => {
  it('empty → trivial JSON', () => {
    const r = exportPmi([]);
    expect(r.format).toBe('json');
    expect(r.content).toContain('"annotationCount": 0');
  });

  it('json round-trips', () => {
    const r = exportPmi([dim('d1', 10), gdt('g1', 'pos', ['A', 'B'])]);
    const rt = roundTripJson(r);
    expect(rt.ok).toBe(true);
    expect(rt.parsedCount).toBe(2);
  });

  it('step-text emits header', () => {
    const r = exportPmi([dim('d1', 10)], { format: 'step-text', pretty: true, includeFeatureRefs: true });
    expect(r.content).toContain('BEGIN PMI');
  });

  it('qif-xml emits QIF root', () => {
    const r = exportPmi([dim('d1', 10)], { format: 'qif-xml', pretty: true, includeFeatureRefs: true });
    expect(r.content).toContain('<QIF');
  });

  it('warning when dimension missing nominal', () => {
    const r = exportPmi([{ id: 'd1', kind: 'dimension' }]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('includeFeatureRefs=false drops featureId', () => {
    const r = exportPmi([dim('d1', 10)], { format: 'json', pretty: true, includeFeatureRefs: false });
    expect(r.content).not.toContain('featureId');
  });

  it('byteCount matches content length', () => {
    const r = exportPmi([dim('d1', 10)]);
    expect(r.byteCount).toBe(r.content.length);
  });

  it('XML escapes special chars', () => {
    const r = exportPmi([{ id: 'n1', kind: 'note', text: '<bracket & "thing">' }], { format: 'qif-xml', pretty: true, includeFeatureRefs: true });
    expect(r.content).toContain('&lt;');
    expect(r.content).toContain('&amp;');
  });

  it('STEP body includes datum chain for GD&T', () => {
    const r = exportPmi([gdt('g1', 'pos', ['A', 'B', 'C'])], { format: 'step-text', pretty: true, includeFeatureRefs: true });
    expect(r.content).toContain('A,B,C');
  });
});

describe('roundTripJson', () => {
  it('handles parse failure', () => {
    const fake = { format: 'json' as const, content: 'not valid', byteCount: 9, warnings: [] };
    expect(roundTripJson(fake).ok).toBe(false);
  });

  it('not-json returns false', () => {
    const fake = { format: 'step-text' as const, content: '', byteCount: 0, warnings: [] };
    expect(roundTripJson(fake).ok).toBe(false);
  });
});

describe('summarize', () => {
  it('counts annotations + warnings', () => {
    const annotations = [dim('d1', 10)];
    const r = exportPmi(annotations);
    const s = summarize(annotations, r);
    expect(s.annotationCount).toBe(1);
    expect(s.byteCount).toBe(r.byteCount);
  });
});
