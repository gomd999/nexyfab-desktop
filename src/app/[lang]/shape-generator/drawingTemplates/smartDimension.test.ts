import { describe, it, expect } from 'vitest';
import {
  previewSmartDimension,
  detectCenterlines,
  suggestGdt,
  optimizeChain,
  generateHoleTable,
  type SelectionEntity,
  type FaceForGdt,
  type DimensionPoint,
} from './smartDimension';

describe('previewSmartDimension', () => {
  it('empty selection → none', () => {
    expect(previewSmartDimension([]).kind).toBe('none');
  });

  it('single circle → diameter', () => {
    const sel: SelectionEntity[] = [
      { kind: 'circle', position: [10, 10], radiusMm: 5 },
    ];
    const r = previewSmartDimension(sel);
    expect(r.kind).toBe('diameter');
    expect(r.value).toBe(10);
    expect(r.label).toContain('⌀');
  });

  it('single arc → radial', () => {
    const sel: SelectionEntity[] = [
      { kind: 'arc', position: [0, 0], radiusMm: 8 },
    ];
    expect(previewSmartDimension(sel).kind).toBe('radial');
  });

  it('single line → linear length', () => {
    const sel: SelectionEntity[] = [
      { kind: 'line', position: [0, 0], lengthMm: 25 },
    ];
    const r = previewSmartDimension(sel);
    expect(r.kind).toBe('linear');
    expect(r.value).toBe(25);
  });

  it('two perpendicular lines → angular 90°', () => {
    const sel: SelectionEntity[] = [
      { kind: 'line', position: [0, 0], direction: [1, 0], lengthMm: 10 },
      { kind: 'line', position: [0, 0], direction: [0, 1], lengthMm: 10 },
    ];
    const r = previewSmartDimension(sel);
    expect(r.kind).toBe('angular');
    expect(r.value).toBeCloseTo(90, 4);
  });

  it('two points → linear distance', () => {
    const sel: SelectionEntity[] = [
      { kind: 'point', position: [0, 0] },
      { kind: 'point', position: [3, 4] },
    ];
    const r = previewSmartDimension(sel);
    expect(r.kind).toBe('linear');
    expect(r.value).toBeCloseTo(5, 5);
  });

  it('3-entity selection → none', () => {
    const sel: SelectionEntity[] = [
      { kind: 'point', position: [0, 0] },
      { kind: 'point', position: [1, 0] },
      { kind: 'point', position: [2, 0] },
    ];
    expect(previewSmartDimension(sel).kind).toBe('none');
  });
});

describe('detectCenterlines', () => {
  it('finds Y-axis-symmetric hole pair', () => {
    const r = detectCenterlines([
      { id: 'h1', position: [-10, 5] },
      { id: 'h2', position: [10, 5] },
    ]);
    expect(r).toHaveLength(1);
  });

  it('finds X-axis-symmetric hole pair', () => {
    const r = detectCenterlines([
      { id: 'h1', position: [5, -10] },
      { id: 'h2', position: [5, 10] },
    ]);
    expect(r).toHaveLength(1);
  });

  it('no symmetry → no centerlines', () => {
    const r = detectCenterlines([
      { id: 'h1', position: [3, 4] },
      { id: 'h2', position: [7, 9] },
    ]);
    expect(r).toHaveLength(0);
  });
});

describe('suggestGdt', () => {
  it('cylindrical face → cylindricity', () => {
    const faces: FaceForGdt[] = [
      { id: 'f1', kind: 'cylindrical', areaMm2: 500, direction: [0, 0, 1] },
    ];
    const r = suggestGdt(faces);
    expect(r[0]!.callout).toBe('cylindricity');
  });

  it('planar face perpendicular to datum → perpendicularity', () => {
    const faces: FaceForGdt[] = [
      { id: 'datum-A', kind: 'planar', areaMm2: 1000, isDatum: true, direction: [0, 0, 1] },
      { id: 'face-2', kind: 'planar', areaMm2: 500, direction: [1, 0, 0] },
    ];
    const r = suggestGdt(faces);
    expect(r[0]!.callout).toBe('perpendicularity');
  });

  it('planar face parallel to datum → parallelism', () => {
    const faces: FaceForGdt[] = [
      { id: 'datum-A', kind: 'planar', areaMm2: 1000, isDatum: true, direction: [0, 0, 1] },
      { id: 'face-2', kind: 'planar', areaMm2: 500, direction: [0, 0, -1] },
    ];
    expect(suggestGdt(faces)[0]!.callout).toBe('parallelism');
  });

  it('freeform face → profile-surface', () => {
    const faces: FaceForGdt[] = [
      { id: 'f1', kind: 'freeform', areaMm2: 500, direction: [0, 0, 1] },
    ];
    expect(suggestGdt(faces)[0]!.callout).toBe('profile-surface');
  });

  it('datums are skipped (no GDT for themselves)', () => {
    const faces: FaceForGdt[] = [
      { id: 'datum-A', kind: 'planar', areaMm2: 1000, isDatum: true, direction: [0, 0, 1] },
    ];
    expect(suggestGdt(faces)).toHaveLength(0);
  });
});

describe('optimizeChain', () => {
  it('few dims with loose tol → chain', () => {
    const dims: DimensionPoint[] = [
      { positionMm: 0, toleranceMm: 0.05 },
      { positionMm: 10, toleranceMm: 0.05 },
      { positionMm: 20, toleranceMm: 0.05 },
    ];
    expect(optimizeChain(dims, 0.5).strategy).toBe('chain');
  });

  it('accumulated > limit → mixed or baseline + breakers', () => {
    const dims: DimensionPoint[] = [];
    for (let i = 0; i < 20; i++) dims.push({ positionMm: i * 5, toleranceMm: 0.2 });
    const r = optimizeChain(dims, 0.5);
    expect(r.recommendedBreakerCount).toBeGreaterThan(0);
  });

  it('single dim → baseline strategy', () => {
    expect(optimizeChain([{ positionMm: 0, toleranceMm: 0.1 }]).strategy).toBe('baseline');
  });
});

describe('generateHoleTable', () => {
  it('rows = hole count', () => {
    const r = generateHoleTable([
      { id: 'h1', positionMm: [0, 0], diameterMm: 5 },
      { id: 'h2', positionMm: [10, 0], diameterMm: 5 },
      { id: 'h3', positionMm: [20, 0], diameterMm: 8 },
    ]);
    expect(r.rows).toHaveLength(3);
  });

  it('groups by diameter (same letter prefix)', () => {
    const r = generateHoleTable([
      { id: 'h1', positionMm: [0, 0], diameterMm: 5 },
      { id: 'h2', positionMm: [10, 0], diameterMm: 5 },
      { id: 'h3', positionMm: [20, 0], diameterMm: 8 },
    ]);
    // First 2 share letter A, third gets letter B.
    expect(r.rows[0]!.label).toBe('A1');
    expect(r.rows[1]!.label).toBe('A2');
    expect(r.rows[2]!.label).toBe('B1');
  });

  it('thread + depth appear in notes', () => {
    const r = generateHoleTable([
      { id: 'h1', positionMm: [0, 0], diameterMm: 6, depthMm: 10, threadId: 'M6' },
    ]);
    expect(r.rows[0]!.notes).toContain('M6');
    expect(r.rows[0]!.notes).toContain('▽');
  });
});
