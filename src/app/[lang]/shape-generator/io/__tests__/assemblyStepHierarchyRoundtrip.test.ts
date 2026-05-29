/**
 * assemblyStepHierarchyRoundtrip.test.ts — v2 STEP self-consistency.
 *
 * Verifies the stitched hierarchy is self-consistent: the entity ids
 * referenced from NAUO actually exist in the document, the root PRODUCT
 * count is 1, and the leaf PRODUCT count matches the input.
 *
 * The existing `parseBodyTree` (multiBodyImport.ts) assumes
 * PRODUCT_DEFINITION references PRODUCT directly, but standard STEP
 * goes via PRODUCT_DEFINITION_FORMATION — so we can't reuse that
 * parser for round-trip. Instead we assert the entity graph here
 * with targeted regex.
 *
 * No WASM required.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { stitchAssemblyHierarchy } from '../assemblyStepHierarchy';
import type { AssemblyStepPart } from '../assemblyStepExport';

function mockPartStep(partDefId: number, productName: string): string {
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Test'),'2;1');
FILE_NAME('part.step','2026-05-29',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=APPLICATION_CONTEXT('mechanical design');
#3=PRODUCT_CONTEXT('',#1,'mechanical');
#5=PRODUCT('${productName}','${productName}','',(#3));
#6=PRODUCT_DEFINITION_FORMATION('','',#5);
#${partDefId}=PRODUCT_DEFINITION('design','',#6,#3);
ENDSEC;
END-ISO-10303-21;
`;
}

function makePart(id: string, label: string): AssemblyStepPart {
  return { id, label, geometry: new THREE.BoxGeometry(1, 1, 1) };
}

/** Extract all unique entity ids defined in the document. */
function definedIds(step: string): Set<number> {
  const out = new Set<number>();
  for (const m of step.matchAll(/^#(\d+)\s*=/gm)) {
    out.add(Number(m[1]));
  }
  return out;
}

/** Extract NAUO entries: `(name, label, '', parentRef, childRef, ...)`. */
function nauoEdges(step: string): Array<{ parent: number; child: number; name: string }> {
  const rx = /NEXT_ASSEMBLY_USAGE_OCCURRENCE\(\s*'([^']*)'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)/g;
  const out: Array<{ parent: number; child: number; name: string }> = [];
  for (const m of step.matchAll(rx)) {
    out.push({ name: m[1], parent: Number(m[2]), child: Number(m[3]) });
  }
  return out;
}

describe('Assembly STEP v2 self-consistency', () => {
  it('3-part assembly: 1 root + 3 NAUO edges, all refs defined', () => {
    const stitched = stitchAssemblyHierarchy(
      [makePart('a', 'Bracket'), makePart('b', 'Bolt'), makePart('c', 'Plate')],
      [mockPartStep(7, 'Bracket'), mockPartStep(7, 'Bolt'), mockPartStep(7, 'Plate')],
      'TestAsm',
    );

    const ids = definedIds(stitched.stepText);
    const edges = nauoEdges(stitched.stepText);

    expect(edges.length).toBe(3);
    // All NAUO parent + child refs must resolve to defined entities.
    for (const e of edges) {
      expect(ids.has(e.parent), `NAUO parent #${e.parent} undefined`).toBe(true);
      expect(ids.has(e.child), `NAUO child #${e.child} undefined`).toBe(true);
    }
    // All 3 NAUO edges should share the SAME parent (single-root flat hierarchy).
    const uniqueParents = new Set(edges.map((e) => e.parent));
    expect(uniqueParents.size).toBe(1);
    // 3 unique children (no duplicate occurrences pointing at the same leaf).
    const uniqueChildren = new Set(edges.map((e) => e.child));
    expect(uniqueChildren.size).toBe(3);
  });

  it('single-part assembly: 1 NAUO edge (degenerate root + leaf)', () => {
    const stitched = stitchAssemblyHierarchy(
      [makePart('only', 'OnlyOne')],
      [mockPartStep(7, 'OnlyOne')],
      'SingleAsm',
    );
    const edges = nauoEdges(stitched.stepText);
    expect(edges.length).toBe(1);
    expect(edges[0].name).toMatch(/^SingleAsm_1$/);
  });

  it('4-part assembly: NAUO count == partCount; ITEM_DEFINED_TRANSFORMATION count == partCount', () => {
    const stitched = stitchAssemblyHierarchy(
      [makePart('a', 'A'), makePart('b', 'B'), makePart('c', 'C'), makePart('d', 'D')],
      [mockPartStep(7, 'A'), mockPartStep(7, 'B'), mockPartStep(7, 'C'), mockPartStep(7, 'D')],
      'Quad',
    );
    const nauoCount = (stitched.stepText.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || []).length;
    const idtCount = (stitched.stepText.match(/ITEM_DEFINED_TRANSFORMATION/g) || []).length;
    expect(nauoCount).toBe(4);
    expect(idtCount).toBe(4);
    expect(stitched.partCount).toBe(4);
  });

  it('root PRODUCT name matches assembly name (top of hierarchy)', () => {
    const stitched = stitchAssemblyHierarchy(
      [makePart('a', 'Inner')],
      [mockPartStep(7, 'Inner')],
      'OuterAsm_2',
    );
    // Root PRODUCT lives in the wrapper id range (1..999).
    const rootProductMatch = stitched.stepText.match(/^#(\d+)=PRODUCT\('OuterAsm_2','OuterAsm_2'/m);
    expect(rootProductMatch).not.toBeNull();
    const rootId = Number(rootProductMatch![1]);
    expect(rootId).toBeLessThan(1000);
  });

  it('per-part PRODUCT entities are renumbered (no collision with wrapper ids)', () => {
    const stitched = stitchAssemblyHierarchy(
      [makePart('a', 'PartA'), makePart('b', 'PartB')],
      [mockPartStep(7, 'PartA'), mockPartStep(7, 'PartB')],
      'NoCol',
    );
    // The original part PRODUCT was #5 in each mock — after per-part offset
    // (≥1000), it must be renumbered.
    const wrapperProductIds = Array.from(
      stitched.stepText.matchAll(/^#(\d+)=PRODUCT\('([^']*)'/gm),
    );
    // 1 wrapper root + 2 per-part PRODUCTs = 3 PRODUCT entities total.
    expect(wrapperProductIds.length).toBe(3);
    const ids = wrapperProductIds.map((m) => Number(m[1]));
    expect(new Set(ids).size).toBe(3);
    // Per-part PRODUCT ids must be ≥1000 (renumbered above the wrapper range).
    const partIds = ids.filter((n) => n >= 1000);
    expect(partIds.length).toBe(2);
  });
});
