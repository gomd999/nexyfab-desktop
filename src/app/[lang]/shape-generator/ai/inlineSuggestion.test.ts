import { describe, it, expect } from 'vitest';
import { computeInlineSuggestions, getSuggestionColor } from './inlineSuggestion';
import type { FeatureInstance } from '../features/types';

const fillet = (id: string, radius: number): FeatureInstance => ({
  id, type: 'fillet', params: { radius }, enabled: true,
});
const hole = (id: string, diameter: number): FeatureInstance => ({
  id, type: 'hole', params: { diameter }, enabled: true,
});
const shell = (id: string, thickness: number): FeatureInstance => ({
  id, type: 'shell', params: { thickness }, enabled: true,
});

describe('computeInlineSuggestions', () => {
  it('returns empty for empty pipeline', () => {
    expect(computeInlineSuggestions({ features: [] })).toEqual([]);
  });

  it('flags fillet radius > 40% of bbox', () => {
    const out = computeInlineSuggestions({
      features: [fillet('f1', 20)],
      geometry: { bboxDiagMm: 30 },
    });
    expect(out.some(s => s.featureId === 'f1' && s.severity === 'warn')).toBe(true);
  });

  it('autoFix suggests 20% radius for over-filleted feature', () => {
    const out = computeInlineSuggestions({
      features: [fillet('f1', 20)],
      geometry: { bboxDiagMm: 30 },
    });
    expect(out[0]!.autoFix?.suggestedValue).toBe(6); // 30 * 0.2
  });

  it('flags hole below FDM minimum', () => {
    const out = computeInlineSuggestions({
      features: [hole('h1', 1.0)],
      process: 'fdm',
    });
    expect(out.some(s => s.featureId === 'h1' && s.source === 'dfm')).toBe(true);
  });

  it('flags shell wall below CNC minimum as block severity', () => {
    const out = computeInlineSuggestions({
      features: [shell('s1', 0.3)],
      process: 'cnc',
    });
    expect(out.some(s => s.featureId === 's1' && s.severity === 'block')).toBe(true);
  });

  it('emits cost hint when pipeline has > 3 features', () => {
    const out = computeInlineSuggestions({
      features: [
        fillet('f1', 2),
        hole('h1', 5),
        shell('s1', 2),
        fillet('f2', 3),
      ],
    });
    expect(out.some(s => s.source === 'cost')).toBe(true);
  });

  it('does NOT flag normal-sized fillet', () => {
    const out = computeInlineSuggestions({
      features: [fillet('f1', 2)],
      geometry: { bboxDiagMm: 100 },
    });
    expect(out.some(s => s.featureId === 'f1' && s.source === 'geometry')).toBe(false);
  });

  it('flags large draft angle as info', () => {
    const out = computeInlineSuggestions({
      features: [{ id: 'd1', type: 'draft', params: { angle: 15 }, enabled: true }],
    });
    expect(out.some(s => s.featureId === 'd1' && s.severity === 'info')).toBe(true);
  });

  it('respects process-specific hole minimums', () => {
    // 1.5mm hole — fine for SLA, too small for FDM.
    const sla = computeInlineSuggestions({
      features: [hole('h1', 1.5)],
      process: 'sla',
    });
    const fdm = computeInlineSuggestions({
      features: [hole('h1', 1.5)],
      process: 'fdm',
    });
    expect(sla.some(s => s.featureId === 'h1')).toBe(false);
    expect(fdm.some(s => s.featureId === 'h1')).toBe(true);
  });
});

describe('getSuggestionColor', () => {
  it('returns distinct colors per severity', () => {
    const colors = new Set([
      getSuggestionColor('info'),
      getSuggestionColor('warn'),
      getSuggestionColor('block'),
    ]);
    expect(colors.size).toBe(3);
  });
});
