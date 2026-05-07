import { describe, it, expect } from 'vitest';
import { bumpDrawingRevision } from '@/app/[lang]/shape-generator/analysis/drawingRevisionPolicy';

describe('bumpDrawingRevision', () => {
  it('increments single letter', () => {
    expect(bumpDrawingRevision('A')).toBe('B');
    expect(bumpDrawingRevision('a')).toBe('B');
    expect(bumpDrawingRevision('z')).toBe('AA');
  });
  it('rolls Z to AA', () => {
    expect(bumpDrawingRevision('Z')).toBe('AA');
  });
  it('increments multi-letter', () => {
    expect(bumpDrawingRevision('AA')).toBe('AB');
    expect(bumpDrawingRevision('AZ')).toBe('BA');
    expect(bumpDrawingRevision('ZZ')).toBe('AAA');
  });
  it('increments numeric string', () => {
    expect(bumpDrawingRevision('0')).toBe('1');
    expect(bumpDrawingRevision('9')).toBe('10');
    expect(bumpDrawingRevision('99')).toBe('100');
  });
});
