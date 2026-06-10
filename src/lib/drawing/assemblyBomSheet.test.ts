/**
 * assemblyBomSheet.test — SolidWorks-parity Phase 3.
 * Assembly overview sheet builder: 5-part assembly → 1 front viewport +
 * deduped BOM rows + one balloon per part instance, all on the Sheet IR.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAssemblyBomSheet,
  mergePolyhedra,
  type BomPartInput,
} from './assemblyBomSheet';
import { validateSheet } from './sheet';
import { viewportSheetBox } from './dxfExport';
import { BomBalloonError } from './bomBalloon';
import { featureToPolyhedron } from '@/lib/cad/featureMesh';

/** 30 mm cube instance at (x, y, z) — same convention as the drawing page. */
function cubePart(id: string, name: string, pos: { x: number; y: number; z: number }, material?: string): BomPartInput {
  return {
    id,
    name,
    material,
    bbox: {
      min: { x: pos.x - 15, y: pos.y - 15, z: pos.z },
      max: { x: pos.x + 15, y: pos.y + 15, z: pos.z + 30 },
    },
  };
}

/** Acceptance fixture: 5 part instances, 4 distinct (Bracket ×2). */
function fiveParts(): BomPartInput[] {
  return [
    cubePart('base_1', 'Base', { x: 0, y: 0, z: 0 }, 'AL6061'),
    cubePart('bracket_1', 'Bracket', { x: 50, y: 0, z: 0 }),
    cubePart('bracket_2', 'Bracket', { x: -50, y: 0, z: 0 }),
    cubePart('shaft_1', 'Shaft', { x: 0, y: 0, z: 40 }),
    cubePart('cap_1', 'Cap', { x: 0, y: 0, z: 80 }),
  ];
}

describe('buildAssemblyBomSheet — 5-part assembly', () => {
  it('builds a valid Sheet with one front viewport', () => {
    const sheet = buildAssemblyBomSheet({
      id: 'bom-sheet', name: 'BOM — demo', sourceId: 'asm-demo', parts: fiveParts(),
    });
    expect(() => validateSheet(sheet)).not.toThrow();
    expect(sheet.viewports).toHaveLength(1);
    expect(sheet.viewports[0].projection).toEqual({ kind: 'standard', view: 'front' });
    expect(sheet.paperSize).toBe('A3');
  });

  it('BOM rows dedup the duplicate Bracket (4 rows, qty 2) with material carried', () => {
    const sheet = buildAssemblyBomSheet({
      id: 'bom-sheet', name: 'BOM — demo', sourceId: 'asm-demo', parts: fiveParts(),
    });
    expect(sheet.bom).toHaveLength(4);
    const bracket = sheet.bom!.find((r) => r.name === 'Bracket')!;
    expect(bracket.qty).toBe(2);
    const base = sheet.bom!.find((r) => r.name === 'Base')!;
    expect(base.material).toBe('AL6061');
    // Deterministic numbering: ascending by name.
    expect(sheet.bom!.map((r) => r.name)).toEqual(['Base', 'Bracket', 'Cap', 'Shaft']);
    expect(sheet.bom!.map((r) => r.itemNo)).toEqual([1, 2, 3, 4]);
  });

  it('one balloon per part INSTANCE (5), each referencing its BOM row', () => {
    const sheet = buildAssemblyBomSheet({
      id: 'bom-sheet', name: 'BOM — demo', sourceId: 'asm-demo', parts: fiveParts(),
    });
    expect(sheet.balloons).toHaveLength(5);
    const itemNoByName = new Map(sheet.bom!.map((r) => [r.name, r.itemNo]));
    const byId = new Map(sheet.balloons!.map((b) => [b.id, b]));
    expect(byId.get('balloon-bracket_1')!.itemNo).toBe(itemNoByName.get('Bracket'));
    expect(byId.get('balloon-bracket_2')!.itemNo).toBe(itemNoByName.get('Bracket'));
    expect(byId.get('balloon-base_1')!.itemNo).toBe(itemNoByName.get('Base'));
  });

  it('balloon anchors land inside the viewport box; centres land outside it', () => {
    const sheet = buildAssemblyBomSheet({
      id: 'bom-sheet', name: 'BOM — demo', sourceId: 'asm-demo', parts: fiveParts(),
    });
    const box = viewportSheetBox(sheet.viewports[0]);
    for (const b of sheet.balloons!) {
      expect(b.anchor.x).toBeGreaterThanOrEqual(box.x);
      expect(b.anchor.x).toBeLessThanOrEqual(box.x + box.w);
      expect(b.anchor.y).toBeGreaterThanOrEqual(box.y);
      expect(b.anchor.y).toBeLessThanOrEqual(box.y + box.h);
      const insideBox =
        b.center.x > box.x && b.center.x < box.x + box.w
        && b.center.y > box.y && b.center.y < box.y + box.h;
      expect(insideBox).toBe(false);
    }
  });

  it('no two balloons overlap (centre distance ≥ 2·radius)', () => {
    const sheet = buildAssemblyBomSheet({
      id: 'bom-sheet', name: 'BOM — demo', sourceId: 'asm-demo', parts: fiveParts(),
    });
    const bs = sheet.balloons!;
    for (let i = 0; i < bs.length; i += 1) {
      for (let j = i + 1; j < bs.length; j += 1) {
        const d = Math.hypot(bs[i].center.x - bs[j].center.x, bs[i].center.y - bs[j].center.y);
        expect(d).toBeGreaterThanOrEqual(bs[i].radius + bs[j].radius);
      }
    }
  });

  it('is deterministic — two builds produce identical IR', () => {
    const opts = {
      id: 'bom-sheet', name: 'BOM — demo', sourceId: 'asm-demo', parts: fiveParts(),
    };
    expect(buildAssemblyBomSheet(opts)).toEqual(buildAssemblyBomSheet(opts));
  });

  it('empty parts list throws', () => {
    expect(() =>
      buildAssemblyBomSheet({ id: 's', name: 'n', sourceId: 'a', parts: [] }),
    ).toThrow(BomBalloonError);
  });
});

describe('mergePolyhedra', () => {
  const cubeFeature = {
    kind: 'extrude' as const,
    loop: [
      { x: -15, y: -15 }, { x: 15, y: -15 }, { x: 15, y: 15 }, { x: -15, y: 15 },
    ],
    depth: 30,
    direction: 'one_sided',
    mode: 'add',
  };

  it('merges two offset cubes with valid face index remapping', () => {
    const poly = featureToPolyhedron(cubeFeature)!;
    expect(poly).not.toBeNull();
    const merged = mergePolyhedra([
      { poly, offset: { x: 0, y: 0, z: 0 } },
      { poly, offset: { x: 50, y: 0, z: 0 } },
    ])!;
    expect(merged.vertices).toHaveLength(poly.vertices.length * 2);
    expect(merged.faces).toHaveLength(poly.faces.length * 2);
    // Every face index must be in range.
    for (const f of merged.faces) {
      for (const vi of f.vertices) {
        expect(vi).toBeGreaterThanOrEqual(0);
        expect(vi).toBeLessThan(merged.vertices.length);
      }
    }
    // Second cube's vertices are translated by +50 in x.
    const n = poly.vertices.length;
    expect(merged.vertices[n].x).toBeCloseTo(poly.vertices[0].x + 50, 10);
  });

  it('empty input → null', () => {
    expect(mergePolyhedra([])).toBeNull();
  });
});
