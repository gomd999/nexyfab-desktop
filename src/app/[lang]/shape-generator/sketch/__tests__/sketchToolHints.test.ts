import { describe, it, expect } from 'vitest';
import { sketchRibbonFullTitle, radialCommandTitle, resolveSketchLang } from '../sketchToolHints';

describe('sketchToolHints', () => {
  it('resolveSketchLang maps kr to ko', () => {
    expect(resolveSketchLang('kr')).toBe('ko');
    expect(resolveSketchLang('en')).toBe('en');
  });

  it('ribbon title appends hint for sketch tools', () => {
    const t = sketchRibbonFullTitle('en', 'sk-line', 'Line');
    expect(t).toContain('Line');
    expect(t).toContain('—');
  });

  it('radial title includes hint for slice toggle', () => {
    const t = radialCommandTitle('en', 'sketch-toggle-slice', 'Slice');
    expect(t).toContain('Slice');
    expect(t.length).toBeGreaterThan('Slice'.length);
  });
});
