import { describe, expect, it } from 'vitest';
import { evaluateProgramDfm, extractManufacturingContext } from '../manufacturingContext';
import type { CadFeatureProgram } from '../cadFeatureProgram';

const plate: CadFeatureProgram = {
  part: 'plate', features: [{ id: 'base', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 80, height: 3 }],
};

describe('manufacturing verification context', () => {
  it('stores a hash reference rather than the raw prompt', () => {
    const context = extractManufacturingContext('CNC AL6061 plate 100x80x3');
    expect(context.inputRef).toMatch(/^prompt:sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(context)).not.toContain('100x80x3');
    expect(context).toMatchObject({ process: 'cnc_mill', material: 'aluminum_6061', privacyCompliant: true });
  });

  it('does not fabricate process or material when absent', () => {
    expect(extractManufacturingContext('100x80x3 plate')).toMatchObject({ process: undefined, material: undefined });
    expect(evaluateProgramDfm(plate, extractManufacturingContext('100x80x3 plate'))).toBeUndefined();
  });

  it('passes an explicit compatible process/material and blocks incompatible ones', () => {
    expect(evaluateProgramDfm(plate, extractManufacturingContext('CNC AL6061 plate 100x80x3'))).toMatchObject({ passed: true });
    expect(evaluateProgramDfm(plate, extractManufacturingContext('FDM AL6061 plate 100x80x3'))).toMatchObject({
      passed: false,
      violations: ['Metal material is incompatible with the selected polymer printing process.'],
    });
  });
});
