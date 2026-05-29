/**
 * Phase C1 (도면 v1 게이트) — 조립 도면 최소 회귀.
 *
 * 로드맵: docs/strategy/M4_DRAWING.md §Phase C1
 *         docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase C
 *
 * Asserts the v1 entry path `generateAssemblyDrawing`:
 *  - composes per-part drawings into one DrawingResult
 *  - BOM rows ordered + indexed from 1
 *  - composite fingerprint changes when any part geometry / transform /
 *    qty changes (stale-banner parity with single-part case)
 *  - identical assemblies produce identical fingerprints
 *  - empty parts → throws
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  generateAssemblyDrawing,
  computeAssemblyFingerprint,
  type AssemblyDrawingPart,
  type AssemblyDrawingConfig,
} from '@/app/[lang]/shape-generator/analysis/assemblyDrawing';

function makeBox(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

const baseConfig: AssemblyDrawingConfig = {
  views: ['front', 'top', 'right'],
  scale: 1,
  paperSize: 'A4',
  orientation: 'landscape',
  showDimensions: true,
  showCenterlines: false,
  titleBlock: {
    partName: 'asm-baseline',
    material: '6061-T6',
    drawnBy: 'CI',
    date: '2026-05-29',
    scale: '1:1',
    revision: 'A',
  },
  perPartView: 'iso',
};

describe('M4 Phase C1 — assembly drawing', () => {
  it('composes per-part drawings and BOM', () => {
    const parts: AssemblyDrawingPart[] = [
      { id: 'plate', label: '베이스 플레이트', qty: 1, geometry: makeBox(100, 100, 10) },
      { id: 'bolt', label: 'M8 볼트', qty: 4, material: '4140', geometry: makeBox(8, 8, 30) },
    ];

    const result = generateAssemblyDrawing(parts, baseConfig);

    expect(result.bom).toHaveLength(2);
    expect(result.bom[0]).toMatchObject({ index: 1, id: 'plate', qty: 1, material: '6061-T6' });
    expect(result.bom[1]).toMatchObject({ index: 2, id: 'bolt', qty: 4, material: '4140' });
    expect(result.perPart).toHaveLength(2);
    expect(result.perPart[0].views.length).toBeGreaterThan(0);
    // primary view of overall sheet === first part's iso view
    expect(result.views.length).toBe(1);
  });

  it('throws on empty parts list', () => {
    expect(() => generateAssemblyDrawing([], baseConfig)).toThrow(/empty/);
  });

  it('composite fingerprint is stable for identical assemblies', () => {
    const a: AssemblyDrawingPart[] = [
      { id: 'p1', geometry: makeBox(10, 10, 10) },
      { id: 'p2', qty: 2, geometry: makeBox(5, 5, 5) },
    ];
    const b: AssemblyDrawingPart[] = [
      { id: 'p1', geometry: makeBox(10, 10, 10) },
      { id: 'p2', qty: 2, geometry: makeBox(5, 5, 5) },
    ];
    expect(computeAssemblyFingerprint(a)).toBe(computeAssemblyFingerprint(b));
  });

  it('fingerprint differs when a part geometry changes', () => {
    const v1: AssemblyDrawingPart[] = [
      { id: 'p1', geometry: makeBox(10, 10, 10) },
    ];
    const v2: AssemblyDrawingPart[] = [
      { id: 'p1', geometry: makeBox(11, 10, 10) },
    ];
    expect(computeAssemblyFingerprint(v1)).not.toBe(computeAssemblyFingerprint(v2));
  });

  it('fingerprint differs when transform changes (stale-banner sensitivity)', () => {
    const geom = makeBox(10, 10, 10);
    const t1 = new THREE.Matrix4().identity();
    const t2 = new THREE.Matrix4().makeTranslation(5, 0, 0);
    const v1: AssemblyDrawingPart[] = [{ id: 'p1', geometry: geom, transform: t1 }];
    const v2: AssemblyDrawingPart[] = [{ id: 'p1', geometry: geom, transform: t2 }];
    expect(computeAssemblyFingerprint(v1)).not.toBe(computeAssemblyFingerprint(v2));
  });

  it('fingerprint differs when qty changes', () => {
    const geom = makeBox(10, 10, 10);
    const v1: AssemblyDrawingPart[] = [{ id: 'p1', qty: 1, geometry: geom }];
    const v2: AssemblyDrawingPart[] = [{ id: 'p1', qty: 2, geometry: geom }];
    expect(computeAssemblyFingerprint(v1)).not.toBe(computeAssemblyFingerprint(v2));
  });

  it('title block override per part uses part label + material in BOM', () => {
    const parts: AssemblyDrawingPart[] = [
      { id: 'a', label: '브래킷', material: '5052-H32', geometry: makeBox(50, 50, 5) },
    ];
    const result = generateAssemblyDrawing(parts, baseConfig);
    expect(result.bom[0].label).toBe('브래킷');
    expect(result.bom[0].material).toBe('5052-H32');
  });
});
