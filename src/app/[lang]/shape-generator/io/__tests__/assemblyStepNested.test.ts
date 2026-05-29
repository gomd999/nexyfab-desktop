/**
 * assemblyStepNested.test.ts — Assembly STEP v2.1 nested sub-assemblies.
 *
 * Verifies recursive root → sub-asm → (sub-asm | leaf) trees produce
 * valid STEP with one PRODUCT per node + NAUO per child edge + IDT per
 * occurrence transform. Self-consistency checks (no dangling refs,
 * no duplicate ids, NAUO count == edge count) cover the regression.
 *
 * No WASM.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  stitchNestedAssemblyHierarchy,
  type AssemblySubNode,
} from '../assemblyStepHierarchy';

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

function leaf(partId: string, transform?: THREE.Matrix4): AssemblySubNode {
  return { kind: 'part', partId, label: partId, transform, stepText: mockPartStep(7, partId) };
}

function sub(subAsmId: string, children: AssemblySubNode[], transform?: THREE.Matrix4): AssemblySubNode {
  return { kind: 'subAssembly', subAsmId, label: subAsmId, transform, children };
}

function definedIds(step: string): Set<number> {
  const out = new Set<number>();
  for (const m of step.matchAll(/^#(\d+)\s*=/gm)) out.add(Number(m[1]));
  return out;
}

function nauoEdges(step: string): Array<{ parent: number; child: number; name: string }> {
  const rx = /NEXT_ASSEMBLY_USAGE_OCCURRENCE\(\s*'([^']*)'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)/g;
  const out: Array<{ parent: number; child: number; name: string }> = [];
  for (const m of step.matchAll(rx)) {
    out.push({ name: m[1], parent: Number(m[2]), child: Number(m[3]) });
  }
  return out;
}

describe('stitchNestedAssemblyHierarchy — preconditions', () => {
  it('throws when root is a leaf part (caller should use flat stitcher)', () => {
    expect(() => stitchNestedAssemblyHierarchy(leaf('only'))).toThrow(/must be a sub-assembly/);
  });

  it('throws when root sub-asm has no children', () => {
    expect(() => stitchNestedAssemblyHierarchy(sub('empty', []))).toThrow(/no children/);
  });

  it('throws when all children fail to plan (no parseable leaves)', () => {
    const brokenLeaf: AssemblySubNode = {
      kind: 'part', partId: 'bad', label: 'bad', stepText: 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;',
    };
    expect(() =>
      stitchNestedAssemblyHierarchy(sub('rootbad', [brokenLeaf])),
    ).toThrow(/could not be planned/);
  });
});

describe('stitchNestedAssemblyHierarchy — flat root → 3 leaves (same as v2)', () => {
  it('produces 3 NAUO edges from single root_def to 3 leaves', () => {
    const tree = sub('Root', [leaf('A'), leaf('B'), leaf('C')]);
    const r = stitchNestedAssemblyHierarchy(tree);
    const edges = nauoEdges(r.stepText);
    expect(edges.length).toBe(3);
    const uniqueParents = new Set(edges.map((e) => e.parent));
    expect(uniqueParents.size).toBe(1);
    expect(r.partCount).toBe(3);
    expect(r.subAssemblyCount).toBe(0); // root excluded from count
    expect(r.maxDepth).toBe(1);
  });
});

describe('stitchNestedAssemblyHierarchy — 2-level nested (root → sub → leaves)', () => {
  it('emits 2 sub-asm PRODUCTs (root + sub) + correct NAUO topology', () => {
    const tree = sub('Root', [
      sub('SubA', [leaf('a1'), leaf('a2')]),
      leaf('topLeaf'),
    ]);
    const r = stitchNestedAssemblyHierarchy(tree);

    // 4 PRODUCT entities = root + SubA + 3 leaves (a1, a2, topLeaf)
    const products = (r.stepText.match(/^#(\d+)=PRODUCT\(/gm) || []);
    expect(products.length).toBe(5); // Root, SubA, a1, a2, topLeaf

    const edges = nauoEdges(r.stepText);
    // Edges: Root → SubA, Root → topLeaf, SubA → a1, SubA → a2 = 4 total
    expect(edges.length).toBe(4);

    expect(r.partCount).toBe(3); // 3 leaves
    expect(r.subAssemblyCount).toBe(1); // SubA (root excluded)
    expect(r.maxDepth).toBe(2);
  });

  it('SubA edges share one parent_def; Root edges share a different parent_def', () => {
    const tree = sub('Root', [
      sub('SubA', [leaf('a1'), leaf('a2')]),
      leaf('topLeaf'),
    ]);
    const r = stitchNestedAssemblyHierarchy(tree);
    const edges = nauoEdges(r.stepText);

    // Group edges by parent_def
    const parentGroups = new Map<number, Array<{ name: string }>>();
    for (const e of edges) {
      if (!parentGroups.has(e.parent)) parentGroups.set(e.parent, []);
      parentGroups.get(e.parent)!.push({ name: e.name });
    }
    // Two distinct parents: one with 2 children (SubA → 2 leaves),
    // one with 2 children (Root → SubA + topLeaf).
    expect(parentGroups.size).toBe(2);
    const sizes = Array.from(parentGroups.values()).map((g) => g.length).sort();
    expect(sizes).toEqual([2, 2]);
  });
});

describe('stitchNestedAssemblyHierarchy — 3-level nested', () => {
  it('handles Root → MidA → SubB → leaf (depth 3)', () => {
    const tree = sub('Root', [
      sub('MidA', [
        sub('SubB', [leaf('deep1'), leaf('deep2')]),
        leaf('midOnly'),
      ]),
    ]);
    const r = stitchNestedAssemblyHierarchy(tree);
    expect(r.maxDepth).toBe(3);
    expect(r.partCount).toBe(3); // deep1, deep2, midOnly
    expect(r.subAssemblyCount).toBe(2); // MidA + SubB (root excluded)

    const edges = nauoEdges(r.stepText);
    // Root→MidA, MidA→SubB, MidA→midOnly, SubB→deep1, SubB→deep2 = 5
    expect(edges.length).toBe(5);
  });
});

describe('stitchNestedAssemblyHierarchy — entity-graph integrity', () => {
  it('all NAUO refs (parent + child defs) resolve to defined entities', () => {
    const tree = sub('Root', [
      sub('SubA', [leaf('a1'), leaf('a2')]),
      leaf('topLeaf'),
    ]);
    const r = stitchNestedAssemblyHierarchy(tree);
    const ids = definedIds(r.stepText);
    const edges = nauoEdges(r.stepText);
    for (const e of edges) {
      expect(ids.has(e.parent), `parent #${e.parent} undefined`).toBe(true);
      expect(ids.has(e.child), `child #${e.child} undefined`).toBe(true);
    }
  });

  it('no duplicate entity ids (offsets prevent collisions)', () => {
    const tree = sub('Root', [
      sub('SubA', [leaf('a1'), leaf('a2')]),
      sub('SubB', [leaf('b1'), leaf('b2')]),
    ]);
    const r = stitchNestedAssemblyHierarchy(tree);
    const allIds = r.stepText.match(/^#(\d+)\s*=/gm) || [];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('ITEM_DEFINED_TRANSFORMATION count == NAUO count (one IDT per occurrence)', () => {
    const tree = sub('Root', [
      sub('SubA', [leaf('a1'), leaf('a2', new THREE.Matrix4().makeTranslation(5, 0, 0))]),
      leaf('topLeaf', new THREE.Matrix4().makeRotationZ(Math.PI / 4)),
    ]);
    const r = stitchNestedAssemblyHierarchy(tree);
    const nauoCount = (r.stepText.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || []).length;
    const idtCount = (r.stepText.match(/ITEM_DEFINED_TRANSFORMATION/g) || []).length;
    expect(idtCount).toBe(nauoCount);
  });
});

describe('stitchNestedAssemblyHierarchy — transform surfacing', () => {
  it('per-occurrence transform applies (translate on a leaf inside a sub-asm)', () => {
    const tree = sub('Root', [
      sub('SubA', [leaf('moved', new THREE.Matrix4().makeTranslation(7, 8, 9))]),
    ]);
    const r = stitchNestedAssemblyHierarchy(tree);
    expect(r.stepText).toContain("CARTESIAN_POINT('',(7.000000,8.000000,9.000000))");
  });

  it('sub-asm transform also surfaces (not just leaves)', () => {
    const tree = sub('Root', [
      sub('movedSub', [leaf('inner')], new THREE.Matrix4().makeTranslation(11, 22, 33)),
    ]);
    const r = stitchNestedAssemblyHierarchy(tree);
    expect(r.stepText).toContain("CARTESIAN_POINT('',(11.000000,22.000000,33.000000))");
  });
});

describe('stitchNestedAssemblyHierarchy — partial failure', () => {
  it('surfaces broken leaf as diagnostic; sibling parts still ship', () => {
    const brokenLeaf: AssemblySubNode = {
      kind: 'part', partId: 'corrupted', label: 'corrupted', stepText: 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;',
    };
    const tree = sub('Root', [leaf('good'), brokenLeaf, leaf('alsoGood')]);
    const r = stitchNestedAssemblyHierarchy(tree);
    expect(r.diagnostics.some((d) => d.partId === 'corrupted')).toBe(true);
    expect(r.partCount).toBe(2);
  });
});
