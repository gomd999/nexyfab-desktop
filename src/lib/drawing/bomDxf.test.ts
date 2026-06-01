/**
 * Phase 4.3 BOM + Phase 4.4 DXF tests.
 */
import { describe, it, expect } from 'vitest';
import { extractBom, type BomMetadata } from './bom';
import { sheetToDxf, sheetsToDxf } from './dxfExport';
import { partInstance, IDENTITY_QUAT, type AssemblyState } from '../assembly/assemblyState';
import { standardThreeViewSheet, type Sheet } from './sheet';
import { vec3 } from '../sketch/sketchPlane';

function makePart(id: string, templateId: string, fixed = false) {
  return partInstance({
    id, name: id, partTemplateId: templateId,
    position: vec3(0, 0, 0), orientation: IDENTITY_QUAT, fixed,
  });
}

// ─── BOM ──────────────────────────────────────────────────────────────────

describe('extractBom', () => {
  it('counts instances by template id and sorts rows stably', () => {
    const state: AssemblyState = {
      parts: [
        makePart('p1', 'tpl_b', true),
        makePart('p2', 'tpl_a'),
        makePart('p3', 'tpl_a'),
        makePart('p4', 'tpl_b'),
      ],
      mates: [],
    };
    const bom = extractBom(state);
    expect(bom.rows.map((r) => r.partTemplateId)).toEqual(['tpl_a', 'tpl_b']);
    expect(bom.rows[0]!.quantity).toBe(2);
    expect(bom.rows[1]!.quantity).toBe(2);
    expect(bom.totalInstances).toBe(4);
  });

  it('pulls metadata via the lookup callback', () => {
    const state: AssemblyState = {
      parts: [makePart('p1', 'tpl_a', true), makePart('p2', 'tpl_a')],
      mates: [],
    };
    const meta: Record<string, BomMetadata> = {
      tpl_a: { description: 'Bracket', material: 'AL6061', mass: 0.25, vendorPartNumber: 'NF-12345' },
    };
    const bom = extractBom(state, (id) => meta[id]);
    expect(bom.rows[0]!.description).toBe('Bracket');
    expect(bom.rows[0]!.material).toBe('AL6061');
    expect(bom.rows[0]!.totalMass).toBeCloseTo(0.5, 9); // 0.25 × 2
    expect(bom.rows[0]!.vendorPartNumber).toBe('NF-12345');
    expect(bom.totalMass).toBeCloseTo(0.5, 9);
  });

  it('totalMass is undefined when any row lacks mass', () => {
    const state: AssemblyState = {
      parts: [makePart('p1', 'tpl_a', true), makePart('p2', 'tpl_b')],
      mates: [],
    };
    const bom = extractBom(state, (id) => (id === 'tpl_a' ? { mass: 1 } : {}));
    expect(bom.totalMass).toBeUndefined();
  });

  it('empty assembly: zero rows, undefined totalMass', () => {
    const bom = extractBom({ parts: [], mates: [] });
    expect(bom.rows.length).toBe(0);
    expect(bom.totalInstances).toBe(0);
    expect(bom.totalMass).toBeUndefined();
  });
});

// ─── DXF ─────────────────────────────────────────────────────────────────

describe('sheetToDxf', () => {
  it('emits HEADER + ENTITIES + EOF sections', () => {
    const sheet: Sheet = standardThreeViewSheet({
      id: 's1', name: 'Test', sourceId: 'src',
      paperSize: 'A3', scale: 1,
    });
    const dxf = sheetToDxf(sheet);
    expect(dxf).toContain('SECTION\n  2\nHEADER');
    expect(dxf).toContain('SECTION\n  2\nENTITIES');
    expect(dxf).toContain('ENDSEC');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });

  it('emits LINE entities for sheet border + each viewport border', () => {
    const sheet: Sheet = standardThreeViewSheet({
      id: 's1', name: 'T', sourceId: 'src', paperSize: 'A4', scale: 1,
    });
    const dxf = sheetToDxf(sheet);
    const lineCount = (dxf.match(/LINE\n/g) ?? []).length;
    // Sheet border (4) + 4 viewports × 4 lines each = 20.
    expect(lineCount).toBe(20);
  });

  it('emits TEXT entities for viewport labels', () => {
    const sheet: Sheet = standardThreeViewSheet({
      id: 's1', name: 'T', sourceId: 'src', paperSize: 'A4', scale: 1,
    });
    const dxf = sheetToDxf(sheet);
    expect(dxf).toContain('FRONT');
    expect(dxf).toContain('TOP');
    expect(dxf).toContain('RIGHT');
    expect(dxf).toContain('ISO');
  });

  it('uses $EXTMAX = paper dimensions', () => {
    const sheet: Sheet = standardThreeViewSheet({
      id: 's1', name: 'T', sourceId: 'src', paperSize: 'A4', scale: 1,
    });
    const dxf = sheetToDxf(sheet);
    expect(dxf).toContain('$EXTMAX');
    // A4 = 297×210
    expect(dxf).toContain('297');
    expect(dxf).toContain('210');
  });
});

describe('sheetsToDxf', () => {
  it('emits multi-sheet stream with NEXYFAB_SHEET markers', () => {
    const a = standardThreeViewSheet({ id: 'a', name: 'A', sourceId: 'src', paperSize: 'A4', scale: 1 });
    const b = standardThreeViewSheet({ id: 'b', name: 'B', sourceId: 'src', paperSize: 'A4', scale: 1 });
    const out = sheetsToDxf([a, b]);
    expect(out).toContain('NEXYFAB_SHEET:a');
    expect(out).toContain('NEXYFAB_SHEET:b');
  });
});
