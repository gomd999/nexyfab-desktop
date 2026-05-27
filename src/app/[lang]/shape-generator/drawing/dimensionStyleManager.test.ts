import { describe, it, expect } from 'vitest';
import {
  presetForStandard,
  formatNumber,
  formatDimension,
  validateStyle,
  summarize,
  type DimensionStyle,
} from './dimensionStyleManager';

describe('presetForStandard', () => {
  it('ISO uses comma separator', () => {
    expect(presetForStandard('ISO').decimalSeparator).toBe(',');
  });

  it('ANSI uses dot separator', () => {
    expect(presetForStandard('ANSI').decimalSeparator).toBe('.');
  });

  it('ANSI uses no leading zero', () => {
    expect(presetForStandard('ANSI').leadingZero).toBe(false);
  });

  it('ANSI tolerance format is limit', () => {
    expect(presetForStandard('ANSI').toleranceFormat).toBe('limit');
  });

  it('DIN uses open-triangle arrow', () => {
    expect(presetForStandard('DIN').arrowHead).toBe('open-triangle');
  });

  it('JIS uses dot separator', () => {
    expect(presetForStandard('JIS').decimalSeparator).toBe('.');
  });

  it('GB uses dot separator', () => {
    expect(presetForStandard('GB').decimalSeparator).toBe('.');
  });
});

describe('formatNumber', () => {
  it('ISO formats with comma', () => {
    expect(formatNumber(12.5, presetForStandard('ISO'))).toContain(',');
  });

  it('ANSI formats with dot', () => {
    expect(formatNumber(12.5, presetForStandard('ANSI'))).toContain('.');
  });

  it('ANSI strips leading zero (< 1)', () => {
    expect(formatNumber(0.5, presetForStandard('ANSI'))).not.toMatch(/^0/);
  });

  it('ISO keeps leading zero', () => {
    expect(formatNumber(0.5, presetForStandard('ISO'))).toMatch(/^0/);
  });

  it('precision respected', () => {
    const style: DimensionStyle = { ...presetForStandard('ISO'), precision: 4 };
    expect(formatNumber(1.23456, style)).toBe('1,2346');
  });

  it('unit suffix appended', () => {
    const style: DimensionStyle = { ...presetForStandard('ISO'), unitSuffix: 'mm' };
    expect(formatNumber(10, style)).toBe('10,00 mm');
  });
});

describe('formatDimension', () => {
  it('symmetric tolerance formats with ±', () => {
    const out = formatDimension({ nominalMm: 10, upperMm: 0.05, lowerMm: -0.05 }, presetForStandard('ISO'));
    expect(out).toContain('±');
  });

  it('limit tolerance formats upper/lower', () => {
    const out = formatDimension({ nominalMm: 10, upperMm: 0.05, lowerMm: -0.05 }, presetForStandard('ANSI'));
    expect(out).toContain('/');
  });

  it('fit-class tolerance appended', () => {
    const style: DimensionStyle = { ...presetForStandard('ISO'), toleranceFormat: 'fit-class' };
    const out = formatDimension({ nominalMm: 10, fitClass: 'H7' }, style);
    expect(out).toContain('H7');
  });

  it('no tolerance → nominal only', () => {
    const out = formatDimension({ nominalMm: 10 }, presetForStandard('ISO'));
    expect(out).toMatch(/^10[.,]00$/);
  });
});

describe('validateStyle', () => {
  it('clean ISO style has no warnings', () => {
    expect(validateStyle(presetForStandard('ISO'))).toEqual([]);
  });

  it('ANSI + comma → warning', () => {
    const bad: DimensionStyle = { ...presetForStandard('ANSI'), decimalSeparator: ',' };
    expect(validateStyle(bad).some(w => w.field === 'decimalSeparator')).toBe(true);
  });

  it('ISO + dot → warning', () => {
    const bad: DimensionStyle = { ...presetForStandard('ISO'), decimalSeparator: '.' };
    expect(validateStyle(bad).some(w => w.field === 'decimalSeparator')).toBe(true);
  });

  it('tiny text height → warning', () => {
    const bad: DimensionStyle = { ...presetForStandard('ISO'), textHeightMm: 1.0 };
    expect(validateStyle(bad).some(w => w.field === 'textHeightMm')).toBe(true);
  });

  it('precision out of range → warning', () => {
    const bad: DimensionStyle = { ...presetForStandard('ISO'), precision: 10 };
    expect(validateStyle(bad).some(w => w.field === 'precision')).toBe(true);
  });
});

describe('summarize', () => {
  it('reports standard and precision', () => {
    const s = summarize(presetForStandard('ISO'));
    expect(s.standard).toBe('ISO');
    expect(s.precision).toBe(2);
  });

  it('warningCount = validation warning length', () => {
    const bad: DimensionStyle = { ...presetForStandard('ISO'), decimalSeparator: '.', textHeightMm: 1 };
    const s = summarize(bad);
    expect(s.warningCount).toBe(2);
  });
});
