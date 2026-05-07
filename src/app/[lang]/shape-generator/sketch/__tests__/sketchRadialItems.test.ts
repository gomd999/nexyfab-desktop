import { describe, it, expect } from 'vitest';
import { getSketchRadialMainItems, getSketchRadialInnerItems, getSketchRadialLinearItems } from '../sketchRadialItems';

describe('sketch radial items', () => {
  it('main ring has 8 commands with stable ids', () => {
    const main = getSketchRadialMainItems('en');
    expect(main).toHaveLength(8);
    expect(main.map(i => i.id)).toEqual([
      'finish-sketch',
      'cancel-sketch',
      'sketch-undo',
      'sketch-tool-line',
      'sketch-tool-circle',
      'sketch-tool-rect',
      'sketch-tool-trim',
      'measure',
    ]);
    expect(main.every(i => i.title && i.title.length > i.label.length)).toBe(true);
  });

  it('inner ring has 6 commands', () => {
    const inner = getSketchRadialInnerItems('ko');
    expect(inner).toHaveLength(6);
    expect(inner.map(i => i.id)).toEqual([
      'sketch-tool-offset',
      'sketch-tool-polygon',
      'sketch-radial-dimension',
      'sketch-clear',
      'sketch-insert-canvas',
      'sketch-toggle-slice',
    ]);
  });

  it('linear hybrid column has 4 commands with shortcuts', () => {
    const lin = getSketchRadialLinearItems('en');
    expect(lin).toHaveLength(4);
    expect(lin[0].shortcut).toBe('↵');
    expect(lin.map(i => i.id)).toContain('marking-find-browser');
  });
});
