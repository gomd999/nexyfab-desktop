import { describe, it, expect } from 'vitest';
import {
  PmiCollection,
  pmiToInspectionInputs,
  makePositionPmi,
  makeSurfaceFinishPmi,
  validatePmi,
  type PmiGeometricTol,
  type PmiNote,
} from './mbdPmi';
import type { DrawingFeature } from '../quality/inspectionPlan';

describe('PmiCollection', () => {
  it('add + get + list', () => {
    const c = new PmiCollection();
    const pmi: PmiNote = { id: 'n1', kind: 'note', topoHashes: ['h1'], label: 'note', text: 'inspect me' };
    c.add(pmi);
    expect(c.get('n1')).toBe(pmi);
    expect(c.list()).toHaveLength(1);
  });

  it('remove by id', () => {
    const c = new PmiCollection();
    c.add({ id: 'n1', kind: 'note', topoHashes: [], label: 'x', text: 'x' });
    expect(c.remove('n1')).toBe(true);
    expect(c.list()).toHaveLength(0);
  });

  it('forTopoHash filters annotations on that face', () => {
    const c = new PmiCollection();
    c.add({ id: 'n1', kind: 'note', topoHashes: ['hA'], label: '', text: '' });
    c.add({ id: 'n2', kind: 'note', topoHashes: ['hB'], label: '', text: '' });
    c.add({ id: 'n3', kind: 'note', topoHashes: ['hA', 'hC'], label: '', text: '' });
    expect(c.forTopoHash('hA').map(p => p.id).sort()).toEqual(['n1', 'n3']);
  });

  it('byKind groups annotations', () => {
    const c = new PmiCollection();
    c.add({ id: 'n1', kind: 'note', topoHashes: [], label: '', text: '' });
    c.add(makePositionPmi('g1', 'hA', 0.1));
    expect(c.byKind('note')).toHaveLength(1);
    expect(c.byKind('geometric-tol')).toHaveLength(1);
  });

  it('toJSON / fromJSON round-trip', () => {
    const c = new PmiCollection();
    c.add(makePositionPmi('g1', 'hA', 0.1, ['A']));
    const json = c.toJSON();
    const restored = PmiCollection.fromJSON(json);
    expect(restored.list()).toHaveLength(1);
    expect(restored.get('g1')?.id).toBe('g1');
  });

  it('remapHashes updates references', () => {
    const c = new PmiCollection();
    c.add({ id: 'n1', kind: 'note', topoHashes: ['oldA', 'oldB'], label: '', text: '' });
    const renames = new Map([['oldA', 'newA']]);
    const count = c.remapHashes(renames);
    expect(count).toBe(1);
    expect(c.get('n1')!.topoHashes).toContain('newA');
    expect(c.get('n1')!.topoHashes).toContain('oldB');
  });
});

describe('makePositionPmi', () => {
  it('builds a position GD&T annotation', () => {
    const p = makePositionPmi('g1', 'hash1', 0.1, ['A', 'B']);
    expect(p.callout).toBe('position');
    expect(p.toleranceMm).toBe(0.1);
    expect(p.datumRefs).toEqual(['A', 'B']);
  });

  it('label contains tolerance + datums', () => {
    const p = makePositionPmi('g1', 'hash1', 0.05, ['A', 'B', 'C']);
    expect(p.label).toContain('0.05');
    expect(p.label).toContain('A');
  });
});

describe('makeSurfaceFinishPmi', () => {
  it('emits a surface-finish callout', () => {
    const p = makeSurfaceFinishPmi('s1', 'hash1', 0.8);
    expect(p.raMaxUm).toBe(0.8);
    expect(p.label).toContain('0.8');
  });
});

describe('pmiToInspectionInputs', () => {
  const feature1: DrawingFeature = {
    id: 'F1', name: 'Hole', type: 'hole', principalSizeMm: 8,
  };

  it('extracts GdtSpec from geometric-tol PMI', () => {
    const c = new PmiCollection();
    c.add(makePositionPmi('g1', 'h-hole', 0.1, ['A']));
    const r = pmiToInspectionInputs(c, [{ topoHash: 'h-hole', feature: feature1 }]);
    expect(r.specs).toHaveLength(1);
    expect(r.specs[0]!.featureId).toBe('F1');
    expect(r.specs[0]!.callout).toBe('position');
  });

  it('flags unresolved topology hashes', () => {
    const c = new PmiCollection();
    c.add(makePositionPmi('g1', 'h-missing', 0.1));
    const r = pmiToInspectionInputs(c, []);
    expect(r.unresolvedHashes).toContain('h-missing');
  });

  it('skips non-geometric-tol PMI', () => {
    const c = new PmiCollection();
    c.add({ id: 'n1', kind: 'note', topoHashes: ['hA'], label: '', text: '' });
    const r = pmiToInspectionInputs(c, [{ topoHash: 'hA', feature: feature1 }]);
    expect(r.specs).toHaveLength(0);
  });
});

describe('validatePmi', () => {
  it('zero orphaned when all hashes are valid', () => {
    const c = new PmiCollection();
    c.add(makePositionPmi('g1', 'h1', 0.1));
    const r = validatePmi(c, new Set(['h1']), new Set());
    expect(r.orphaned).toHaveLength(0);
  });

  it('flags orphaned annotations', () => {
    const c = new PmiCollection();
    c.add(makePositionPmi('g1', 'h-vanished', 0.1));
    const r = validatePmi(c, new Set(['h-different']), new Set());
    expect(r.orphaned).toContain('g1');
  });

  it('flags missing datum references', () => {
    const c = new PmiCollection();
    c.add(makePositionPmi('g1', 'h1', 0.1, ['A', 'Z']));
    const r = validatePmi(c, new Set(['h1']), new Set(['A']));
    expect(r.missingDatumRefs).toContain('Z');
    expect(r.missingDatumRefs).not.toContain('A');
  });

  it('counts total annotations', () => {
    const c = new PmiCollection();
    c.add({ id: 'n1', kind: 'note', topoHashes: ['h1'], label: '', text: '' });
    c.add({ id: 'n2', kind: 'note', topoHashes: ['h1'], label: '', text: '' });
    const r = validatePmi(c, new Set(['h1']), new Set());
    expect(r.totalAnnotations).toBe(2);
  });

  // Cast keeps type imports referenced.
  it('PmiGeometricTol type narrows correctly', () => {
    const p = makePositionPmi('g1', 'h1', 0.1) as PmiGeometricTol;
    expect(p.kind).toBe('geometric-tol');
  });
});
