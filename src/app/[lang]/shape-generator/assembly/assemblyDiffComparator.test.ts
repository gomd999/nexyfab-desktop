import { describe, it, expect } from 'vitest';
import {
  compareAssemblies,
  classifySeverity,
  summarize,
  type BodyState,
} from './assemblyDiffComparator';

function body(id: string, x: number = 0, y: number = 0, z: number = 0, overrides: Partial<BodyState> = {}): BodyState {
  return {
    id,
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

describe('compareAssemblies', () => {
  it('empty inputs → empty diff', () => {
    const r = compareAssemblies([], []);
    expect(r.addedIds).toEqual([]);
    expect(r.removedIds).toEqual([]);
  });

  it('detects added body', () => {
    const r = compareAssemblies([body('A')], [body('A'), body('B')]);
    expect(r.addedIds).toEqual(['B']);
  });

  it('detects removed body', () => {
    const r = compareAssemblies([body('A'), body('B')], [body('A')]);
    expect(r.removedIds).toEqual(['B']);
  });

  it('detects moved body when above tolerance', () => {
    const r = compareAssemblies([body('A', 0, 0, 0)], [body('A', 10, 0, 0)]);
    expect(r.movedBodies).toHaveLength(1);
    expect(r.movedBodies[0]!.translationMagnitude).toBe(10);
  });

  it('within tolerance → unchanged', () => {
    const r = compareAssemblies(
      [body('A', 0, 0, 0)],
      [body('A', 0.0001, 0, 0)],
      { positionToleranceMm: 0.01 },
    );
    expect(r.unchangedIds).toContain('A');
  });

  it('rotation delta also triggers move', () => {
    const r = compareAssemblies(
      [body('A', 0, 0, 0, { rotation: { x: 0, y: 0, z: 0 } })],
      [body('A', 0, 0, 0, { rotation: { x: 0.5, y: 0, z: 0 } })],
    );
    expect(r.movedBodies).toHaveLength(1);
    expect(r.movedBodies[0]!.rotationMagnitude).toBeCloseTo(0.5, 5);
  });

  it('material change recorded', () => {
    const r = compareAssemblies(
      [body('A', 0, 0, 0, { material: 'steel' })],
      [body('A', 0, 0, 0, { material: 'aluminum' })],
    );
    const matChange = r.propertyChanges.find(p => p.field === 'material');
    expect(matChange).toBeDefined();
    expect(matChange!.before).toBe('steel');
    expect(matChange!.after).toBe('aluminum');
  });

  it('color change recorded', () => {
    const r = compareAssemblies(
      [body('A', 0, 0, 0, { color: 0xff0000 })],
      [body('A', 0, 0, 0, { color: 0x00ff00 })],
    );
    expect(r.propertyChanges.some(p => p.field === 'color')).toBe(true);
  });

  it('hidden state change recorded', () => {
    const r = compareAssemblies(
      [body('A', 0, 0, 0, { hidden: false })],
      [body('A', 0, 0, 0, { hidden: true })],
    );
    expect(r.propertyChanges.some(p => p.field === 'hidden')).toBe(true);
  });

  it('name change recorded', () => {
    const r = compareAssemblies(
      [body('A', 0, 0, 0, { name: 'old' })],
      [body('A', 0, 0, 0, { name: 'new' })],
    );
    expect(r.propertyChanges.some(p => p.field === 'name')).toBe(true);
  });
});

describe('classifySeverity', () => {
  it('no changes → none', () => {
    expect(classifySeverity({ addedIds: [], removedIds: [], unchangedIds: ['A'], movedBodies: [], propertyChanges: [] })).toBe('none');
  });

  it('removed body → breaking', () => {
    expect(classifySeverity({ addedIds: [], removedIds: ['X'], unchangedIds: [], movedBodies: [], propertyChanges: [] })).toBe('breaking');
  });

  it('only property change → minor', () => {
    expect(classifySeverity({
      addedIds: [], removedIds: [], unchangedIds: [],
      movedBodies: [],
      propertyChanges: [{ id: 'A', field: 'material', before: 'a', after: 'b' }],
    })).toBe('minor');
  });

  it('many moves → major', () => {
    const moved = Array.from({ length: 10 }, (_, i) => ({
      id: `B${i}`, deltaPosition: { x: 1, y: 0, z: 0 }, deltaRotationRad: { x: 0, y: 0, z: 0 },
      translationMagnitude: 1, rotationMagnitude: 0,
    }));
    expect(classifySeverity({ addedIds: [], removedIds: [], unchangedIds: [], movedBodies: moved, propertyChanges: [] })).toBe('major');
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = compareAssemblies([body('A')], [body('A', 5, 0, 0)]);
    const s = summarize(r);
    expect(s.movedCount).toBe(1);
    expect(s.totalDisplacementMm).toBe(5);
  });

  it('severity reflected', () => {
    const r = compareAssemblies([body('A'), body('B')], [body('A')]);
    const s = summarize(r);
    expect(s.severity).toBe('breaking');
  });

  it('empty → severity none', () => {
    const r = compareAssemblies([body('A')], [body('A')]);
    const s = summarize(r);
    expect(s.severity).toBe('none');
  });
});
