import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildFlatPatternView } from './flatPatternDrawing';
import type { FlatPatternResult } from '../features/sheetMetal';

const sample = (): FlatPatternResult => ({
  geometry: new THREE.BufferGeometry(),
  width: 100,
  length: 200,
  thickness: 1.5,
  material: 'mildSteel',
  bendTable: [
    { index: 0, position: 50,  angle: 90, radius: 1.5, direction: 'up',   bendAllowance: 3.2, bendDeduction: 1.8, kFactor: 0.42 },
    { index: 1, position: 130, angle: 45, radius: 2.0, direction: 'down', bendAllowance: 2.1, bendDeduction: 0.9, kFactor: 0.44 },
  ],
  warnings: [],
});

describe('buildFlatPatternView', () => {
  it('emits a closed outline (4 visible lines forming a rectangle)', () => {
    const v = buildFlatPatternView(sample());
    const visible = v.lines.filter(l => l.type === 'visible');
    expect(visible).toHaveLength(4);
    // Outline length should equal the perimeter.
    const totalLen = visible.reduce((s, l) => s + Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 0);
    expect(totalLen).toBeCloseTo(2 * (100 + 200), 1);
  });

  it('emits one centerline per bend at the correct Y position', () => {
    const v = buildFlatPatternView(sample());
    const center = v.lines.filter(l => l.type === 'center');
    expect(center).toHaveLength(2);
    expect(center[0].y1).toBe(50);
    expect(center[1].y1).toBe(130);
    // Bend lines span the full width.
    expect(center[0].x1).toBe(0);
    expect(center[0].x2).toBe(100);
  });

  it('emits a per-bend annotation text with angle + direction + radius', () => {
    const v = buildFlatPatternView(sample());
    expect(v.texts).toHaveLength(2);
    expect(v.texts[0].text).toContain('90');
    expect(v.texts[0].text).toContain('▲');     // up direction
    expect(v.texts[0].text).toContain('R1.5');
    expect(v.texts[1].text).toContain('45');
    expect(v.texts[1].text).toContain('▼');     // down direction
  });

  it('emits a bend table header + one row per bend', () => {
    const v = buildFlatPatternView(sample());
    // Header line + column header + 2 bend rows = 4 texts.
    expect(v.bendTableTexts).toHaveLength(4);
    expect(v.bendTableTexts[0].text).toContain('BEND TABLE');
    expect(v.bendTableTexts[0].text).toContain('mildSteel');
    expect(v.bendTableTexts[1].text).toContain('ANGLE');
    expect(v.bendTableTexts[2].text).toMatch(/^\s*1\s/);
    expect(v.bendTableTexts[3].text).toMatch(/^\s*2\s/);
  });

  it('scales geometry coordinates by the scale factor', () => {
    const at1 = buildFlatPatternView(sample(), 1);
    const at2 = buildFlatPatternView(sample(), 2);
    expect(at2.drawingWidth).toBe(at1.drawingWidth * 2);
    // Bend lines too.
    const c1 = at1.lines.find(l => l.type === 'center')!;
    const c2 = at2.lines.find(l => l.type === 'center')!;
    expect(c2.y1).toBe(c1.y1 * 2);
  });

  it('reserves room for the bend table in drawingHeight', () => {
    const v = buildFlatPatternView(sample());
    // drawingHeight = length (200) + 60mm table band.
    expect(v.drawingHeight).toBe(260);
  });

  it('handles a no-bend flat blank without crashing', () => {
    const noBend: FlatPatternResult = {
      ...sample(),
      bendTable: [],
    };
    const v = buildFlatPatternView(noBend);
    expect(v.lines.filter(l => l.type === 'center')).toHaveLength(0);
    expect(v.texts).toHaveLength(0);
    // Header + column header rows only (no data rows).
    expect(v.bendTableTexts).toHaveLength(2);
  });

  it('drawing width matches the flat blank width at 1:1 scale', () => {
    const v = buildFlatPatternView(sample(), 1);
    expect(v.drawingWidth).toBe(100);
  });
});
