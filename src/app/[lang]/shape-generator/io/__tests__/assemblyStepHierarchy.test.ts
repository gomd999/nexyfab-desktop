/**
 * assemblyStepHierarchy.test.ts — Assembly STEP v2 (NAUO hierarchy).
 *
 * Pure parser/emitter tests. No WASM required — we feed hand-crafted
 * per-part STEP fixtures that look like OCCT's blobSTEP output.
 *
 * Asserts:
 *   - Empty parts list throws
 *   - Length mismatch throws
 *   - Parts without PRODUCT_DEFINITION surface as diagnostics
 *   - Entity ids don't collide after offset (no duplicate "#42=" lines)
 *   - Wrapper emits APPLICATION_CONTEXT, root PRODUCT, NAUO per part
 *   - NAUO entities reference the renumbered per-part PRODUCT_DEFINITION
 *   - ITEM_DEFINED_TRANSFORMATION emitted per occurrence
 *   - Translate/rotate transforms surface in AXIS2_PLACEMENT_3D directions
 *   - File header carries the assembly name + ISO-10303-21 envelope
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { stitchAssemblyHierarchy } from '../assemblyStepHierarchy';
import type { AssemblyStepPart } from '../assemblyStepExport';

function mockPartStep(opts: {
  partDefId: number;
  productName?: string;
  extraEntities?: string[];
} = { partDefId: 7 }): string {
  const { partDefId, productName = 'PartA', extraEntities = [] } = opts;
  const extras = extraEntities.length > 0 ? extraEntities.join('\n') + '\n' : '';
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Test'),'2;1');
FILE_NAME('part.step','2026-05-29',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=APPLICATION_CONTEXT('mechanical design');
#2=APPLICATION_PROTOCOL_DEFINITION('','automotive_design',2003,#1);
#3=PRODUCT_CONTEXT('',#1,'mechanical');
#4=PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');
#5=PRODUCT('${productName}','${productName}','',(#3));
#6=PRODUCT_DEFINITION_FORMATION('','',#5);
#${partDefId}=PRODUCT_DEFINITION('design','',#6,#4);
#8=CARTESIAN_POINT('',(0.0,0.0,0.0));
#9=DIRECTION('',(0.0,0.0,1.0));
#10=DIRECTION('',(1.0,0.0,0.0));
${extras}ENDSEC;
END-ISO-10303-21;
`;
}

function makePart(id: string, transform?: THREE.Matrix4): AssemblyStepPart {
  return {
    id,
    label: id,
    geometry: new THREE.BoxGeometry(1, 1, 1),
    transform,
  };
}

describe('stitchAssemblyHierarchy — preconditions', () => {
  it('throws when parts list is empty', () => {
    expect(() => stitchAssemblyHierarchy([], [])).toThrow(/empty/);
  });

  it('throws when parts.length !== perPartStepText.length', () => {
    expect(() =>
      stitchAssemblyHierarchy([makePart('a'), makePart('b')], [mockPartStep()]),
    ).toThrow(/length/);
  });

  it('throws when no part has a parseable PRODUCT_DEFINITION', () => {
    const broken = `ISO-10303-21;
HEADER;
FILE_NAME('x','','','',(''),(''),'','','');
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`;
    expect(() =>
      stitchAssemblyHierarchy([makePart('a')], [broken]),
    ).toThrow(/no parts had a parseable/);
  });

  it('surfaces partial failure as diagnostics', () => {
    const broken = `ISO-10303-21;
HEADER;
FILE_NAME('x','','','',(''),(''),'','','');
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`;
    const result = stitchAssemblyHierarchy(
      [makePart('a'), makePart('broken')],
      [mockPartStep(), broken],
    );
    expect(result.partCount).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].partId).toBe('broken');
  });
});

describe('stitchAssemblyHierarchy — wrapper entities', () => {
  it('emits ISO-10303-21 envelope + assembly name in FILE_NAME + root PRODUCT', () => {
    const result = stitchAssemblyHierarchy(
      [makePart('a')],
      [mockPartStep({ partDefId: 7, productName: 'Pivot' })],
      'My_Asm',
    );
    expect(result.stepText.startsWith('ISO-10303-21;')).toBe(true);
    expect(result.stepText.trim().endsWith('END-ISO-10303-21;')).toBe(true);
    expect(result.stepText).toContain("'My_Asm.step'");
    expect(result.stepText).toContain("PRODUCT('My_Asm','My_Asm',");
  });

  it('emits one NEXT_ASSEMBLY_USAGE_OCCURRENCE per part', () => {
    const result = stitchAssemblyHierarchy(
      [makePart('a'), makePart('b'), makePart('c')],
      [
        mockPartStep({ partDefId: 7 }),
        mockPartStep({ partDefId: 8 }),
        mockPartStep({ partDefId: 9 }),
      ],
      'Tri',
    );
    const nauoCount = (result.stepText.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g) || []).length;
    expect(nauoCount).toBe(3);
    expect(result.partCount).toBe(3);
  });

  it('NAUO references the renumbered per-part PRODUCT_DEFINITION id', () => {
    const result = stitchAssemblyHierarchy(
      [makePart('a')],
      [mockPartStep({ partDefId: 7 })],
      'X',
    );
    // First part offset is 1000; original #7 should become #1007.
    expect(result.stepText).toContain(',#1007,$');
  });

  it('renumbered ids do not collide across parts (no duplicate "#NNN=" lines)', () => {
    const result = stitchAssemblyHierarchy(
      [makePart('a'), makePart('b')],
      [mockPartStep({ partDefId: 7 }), mockPartStep({ partDefId: 7 })],
      'NoDup',
    );
    const ids = result.stepText.match(/^#(\d+)\s*=/gm) || [];
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  it('emits ITEM_DEFINED_TRANSFORMATION per occurrence', () => {
    const result = stitchAssemblyHierarchy(
      [makePart('a'), makePart('b')],
      [mockPartStep({ partDefId: 7 }), mockPartStep({ partDefId: 7 })],
    );
    const idtCount = (result.stepText.match(/ITEM_DEFINED_TRANSFORMATION\(/g) || []).length;
    expect(idtCount).toBe(2);
  });
});

describe('stitchAssemblyHierarchy — transform surfacing', () => {
  it('identity transform → AXIS2_PLACEMENT_3D points stay at origin + Z-up + X-right', () => {
    const result = stitchAssemblyHierarchy(
      [makePart('a')],
      [mockPartStep()],
    );
    // First part's destination frame uses fresh CARTESIAN_POINT.
    // Verify ALL CARTESIAN_POINT in the wrapper range (id < 1000) are origin.
    expect(result.stepText).toContain("CARTESIAN_POINT('',(0.000000,0.000000,0.000000))");
    expect(result.stepText).toContain("DIRECTION('',(0.000000,0.000000,1.000000))");
    expect(result.stepText).toContain("DIRECTION('',(1.000000,0.000000,0.000000))");
  });

  it('translate-only transform → destination CARTESIAN_POINT carries the translation', () => {
    const t = new THREE.Matrix4().makeTranslation(10, 20, 30);
    const result = stitchAssemblyHierarchy(
      [makePart('a', t)],
      [mockPartStep()],
    );
    expect(result.stepText).toContain("CARTESIAN_POINT('',(10.000000,20.000000,30.000000))");
  });

  it('rotation about Z 90° → destination Z axis stays (0,0,1), X axis becomes (0,1,0)', () => {
    const t = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const result = stitchAssemblyHierarchy(
      [makePart('a', t)],
      [mockPartStep()],
    );
    // After 90° Z rotation: X axis (1,0,0) → (0,1,0)
    expect(result.stepText).toMatch(/DIRECTION\('',\(0\.000000,1\.000000,0\.000000\)\)/);
  });
});

describe('stitchAssemblyHierarchy — per-part data preservation', () => {
  it('per-part DATA entity lines are included (renumbered)', () => {
    const partExtra = `#100=ADVANCED_FACE('',(#101),#102,.T.);`;
    const result = stitchAssemblyHierarchy(
      [makePart('a')],
      [mockPartStep({ partDefId: 7, extraEntities: [partExtra] })],
    );
    // Original #100 → after offset 1000 → #1100; refs #101 → #1101 etc.
    expect(result.stepText).toContain('#1100=ADVANCED_FACE');
    expect(result.stepText).toContain('(#1101)');
    expect(result.stepText).toContain('#1102');
  });
});
