import { describe, expect, it } from 'vitest';
import {
  applyFeatureProgramCustomizerValue,
  emitScadFromProgram,
  type FeatureProgram,
} from './emitScadFromProgram';

const program = (): FeatureProgram => ({
  part: 'manual hybrid part',
  features: [
    { id: 'base', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 80, height: 8 },
    { id: 'hole', type: 'hole', diameter: 6, posX: 20, posY: 0 },
    { id: 'pattern', type: 'circularPattern', feature: 'hole', count: 4, pcd: 40 },
  ],
});

describe('AI Studio manual parameter handoff', () => {
  it('writes an exact manual dimension back to the structured feature program', () => {
    const changed = applyFeatureProgramCustomizerValue(program(), 'base_length', 125);
    expect(changed.updated).toBe(true);
    expect(changed.program.features[0]?.width).toBe(125);
    expect(emitScadFromProgram(changed.program)).toContain('base_length = 125;');
  });

  it('preserves customizer semantics when the displayed value is derived', () => {
    const changed = applyFeatureProgramCustomizerValue(program(), 'bolt_circle_radius', 30);
    expect(changed.updated).toBe(true);
    expect(changed.program.features[2]?.pcd).toBe(60);
    expect(emitScadFromProgram(changed.program)).toContain('bolt_circle_radius = 30;');
  });

  it('does not mutate the source or guess an unknown parameter binding', () => {
    const source = program();
    const changed = applyFeatureProgramCustomizerValue(source, 'unknown_dimension', 9);
    expect(changed.updated).toBe(false);
    expect(changed.program).toEqual(source);
    expect(changed.program).not.toBe(source);
  });
});
