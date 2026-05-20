import { describe, it, expect } from 'vitest';
import { parseBodyTree, buildBodyManifest, importMultiBody } from './multiBodyImport';

// Minimal handcrafted STEP-ish text covering PRODUCT + PRODUCT_DEFINITION + NAUO.
const SIMPLE_MULTI_BODY = `
ISO-10303-21;
HEADER;
ENDSEC;
DATA;
#1=PRODUCT('housing','Housing','',(#3));
#2=PRODUCT('bracket','Bracket','',(#3));
#3=PRODUCT_CONTEXT('',#4,'mechanical');
ENDSEC;
END-ISO-10303-21;
`;

const ASSEMBLY = `
ISO-10303-21;
DATA;
#1=PRODUCT('root','Root','',(#9));
#2=PRODUCT('subA','SubA','',(#9));
#3=PRODUCT('partA1','PartA1','',(#9));
#4=PRODUCT('partA2','PartA2','',(#9));
#10=PRODUCT_DEFINITION('design','',#1,#20);
#11=PRODUCT_DEFINITION('design','',#2,#20);
#12=PRODUCT_DEFINITION('design','',#3,#20);
#13=PRODUCT_DEFINITION('design','',#4,#20);
#20=PRODUCT_DEFINITION_FORMATION('','',#1);
#100=NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO1','root_to_subA','',#10,#11,$);
#101=NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO2','subA_to_partA1','',#11,#12,$);
#102=NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO3','subA_to_partA2','',#11,#13,$);
ENDSEC;
END-ISO-10303-21;
`;

describe('parseBodyTree', () => {
  it('discovers all PRODUCT entities', () => {
    const tree = parseBodyTree(SIMPLE_MULTI_BODY);
    expect(tree.nodes.length).toBe(2);
    expect(tree.nodes.map(n => n.name).sort()).toEqual(['Bracket', 'Housing']);
  });

  it('multi-body (no NAUO) reports each part as its own root', () => {
    const tree = parseBodyTree(SIMPLE_MULTI_BODY);
    expect(tree.rootIndices.length).toBe(2);
    expect(tree.leafCount).toBe(2);
  });

  it('builds assembly hierarchy from NAUO', () => {
    const tree = parseBodyTree(ASSEMBLY);
    expect(tree.nodes.length).toBe(4);
    expect(tree.rootIndices.length).toBe(1);
    const root = tree.nodes[tree.rootIndices[0]!]!;
    expect(root.name).toBe('Root');
    expect(root.childIndices.length).toBe(1);
    const subA = tree.nodes[root.childIndices[0]!]!;
    expect(subA.name).toBe('SubA');
    expect(subA.childIndices.length).toBe(2);
  });

  it('counts leaf parts in assembly correctly', () => {
    const tree = parseBodyTree(ASSEMBLY);
    expect(tree.leafCount).toBe(2);
  });

  it('returns empty tree for empty input', () => {
    const tree = parseBodyTree('');
    expect(tree.nodes).toEqual([]);
    expect(tree.rootIndices).toEqual([]);
    expect(tree.leafCount).toBe(0);
  });
});

describe('buildBodyManifest', () => {
  it('produces BOM rows for each leaf occurrence', () => {
    const tree = parseBodyTree(ASSEMBLY);
    const m = buildBodyManifest(tree);
    expect(m.bomRows.length).toBe(2);
    expect(m.bomRows.map(r => r.productName).sort()).toEqual(['PartA1', 'PartA2']);
  });

  it('tracks max depth', () => {
    const tree = parseBodyTree(ASSEMBLY);
    const m = buildBodyManifest(tree);
    expect(m.maxDepth).toBe(2); // root(0) → subA(1) → leaf(2)
  });

  it('reports unique parts count', () => {
    const tree = parseBodyTree(ASSEMBLY);
    const m = buildBodyManifest(tree);
    expect(m.uniqueParts).toBe(4);
  });

  it('encodes parent path in occurrenceId', () => {
    const tree = parseBodyTree(ASSEMBLY);
    const m = buildBodyManifest(tree);
    expect(m.bomRows[0]!.occurrenceId).toContain('Root/SubA/');
    expect(m.bomRows[0]!.parentPath).toContain('Root');
  });
});

describe('importMultiBody', () => {
  it('returns tree + manifest for a valid file', () => {
    const result = importMultiBody(ASSEMBLY);
    expect('tree' in result).toBe(true);
    if ('tree' in result) {
      expect(result.tree.leafCount).toBe(2);
      expect(result.manifest.bomRows.length).toBe(2);
    }
  });

  it('aborts on pathological files exceeding maxEntities', () => {
    const big = 'PRODUCT(' + Array(50).fill('PRODUCT(').join('');
    const r = importMultiBody(big, { maxEntities: 10 });
    expect('error' in r).toBe(true);
  });

  it('handles multi-body (no NAUO) by emitting one BOM row per part', () => {
    const r = importMultiBody(SIMPLE_MULTI_BODY);
    if ('manifest' in r) {
      expect(r.manifest.bomRows.length).toBe(2);
      expect(r.manifest.maxDepth).toBe(0);
    }
  });
});
