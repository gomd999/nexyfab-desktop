import { describe, it, expect } from 'vitest';
import { EquationManager } from './equationManager';
import {
  applyDimensionEdit,
  dimensionValueOf,
  bindingMap,
  type DimensionBinding,
} from './dimensionDriver';

describe('dimensionDriver — D2 constraint-driven dimensions', () => {
  it('direct binding: editing the dimension drives the variable (drawing → model)', () => {
    const em = new EquationManager();
    em.set('width', '100');
    const b: DimensionBinding = { dimensionId: 'd1', variable: 'width' };
    expect(dimensionValueOf(em, b)).toBe(100); // forward: model → drawing

    const r = applyDimensionEdit(em, [b], 'd1', 50);
    expect(r.ok).toBe(true);
    expect(r.variable).toBe('width');
    expect(em.get('width')).toBe(50);          // reverse: drawing → model
    expect(dimensionValueOf(em, b)).toBe(50);
  });

  it('propagates through the equation DAG (dependent params re-evaluate)', () => {
    const em = new EquationManager();
    em.set('width', '40');
    em.set('len', 'width * 2'); // dependent
    expect(em.get('len')).toBe(80);

    applyDimensionEdit(em, [{ dimensionId: 'dw', variable: 'width' }], 'dw', 60);
    expect(em.get('width')).toBe(60);
    expect(em.get('len')).toBe(120); // downstream auto-updated
  });

  it('scaled binding: a diameter dimension drives a radius variable', () => {
    const em = new EquationManager();
    em.set('r', '5');
    const dia: DimensionBinding = { dimensionId: 'dia', variable: 'r', scale: 2 };
    expect(dimensionValueOf(em, dia)).toBe(10); // 2·r

    const res = applyDimensionEdit(em, [dia], 'dia', 30);
    expect(res.ok).toBe(true);
    expect(em.get('r')).toBe(15); // 30 / 2
  });

  it('affine binding with offset: overall = inner + 2·wall (offset)', () => {
    const em = new EquationManager();
    em.set('inner', '20');
    // overall measured = 1·inner + 10 (a 5mm wall each side).
    const overall: DimensionBinding = { dimensionId: 'ov', variable: 'inner', scale: 1, offset: 10 };
    expect(dimensionValueOf(em, overall)).toBe(30);

    applyDimensionEdit(em, [overall], 'ov', 45);
    expect(em.get('inner')).toBe(35); // (45 − 10) / 1
  });

  it('rejects an unbound dimension', () => {
    const em = new EquationManager();
    em.set('width', '10');
    const r = applyDimensionEdit(em, [{ dimensionId: 'd1', variable: 'width' }], 'other', 5);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not constraint-driven/);
  });

  it('rejects non-finite values and a zero scale', () => {
    const em = new EquationManager();
    em.set('w', '10');
    const bad = applyDimensionEdit(em, [{ dimensionId: 'd', variable: 'w' }], 'd', Number.NaN);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/finite/);

    const zero = applyDimensionEdit(em, [{ dimensionId: 'd', variable: 'w', scale: 0 }], 'd', 5);
    expect(zero.ok).toBe(false);
    expect(zero.error).toMatch(/scale/);
  });

  it('bindingMap dedupes by dimension id (last wins)', () => {
    const m = bindingMap([
      { dimensionId: 'd', variable: 'a' },
      { dimensionId: 'd', variable: 'b' },
    ]);
    expect(m.size).toBe(1);
    expect(m.get('d')!.variable).toBe('b');
  });
});
