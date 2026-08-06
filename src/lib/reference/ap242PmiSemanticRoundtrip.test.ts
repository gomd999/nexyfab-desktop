import { describe, expect, it } from 'vitest';
import { attachCanonicalAp242Pmi, attachCanonicalAp242PmiWithFaceLinks, emitCanonicalAp242Pmi, extractAp242PmiSemanticSnapshot, verifyAp242PmiSemanticRoundtrip, type PmiSemanticSnapshot } from './ap242PmiSemanticRoundtrip';
import { analyzeAp242Pmi } from './ap242PmiEvidence';

describe('AP242 semantic PMI roundtrip', () => {
  it('preserves datum, dimension tolerance, and geometric tolerance semantics', async () => {
    const source: PmiSemanticSnapshot = {
      datums: ['A', 'B'],
      dimensions: [{ kind: 'size', name: 'diameter', value: 35, lower: -0.2, upper: 0 }],
      geometricTolerances: [{ kind: 'PERPENDICULARITY_TOLERANCE', magnitudeMm: 1.5, datums: ['A'], modifiers: [] }],
    };
    const result = await verifyAp242PmiSemanticRoundtrip(emitCanonicalAp242Pmi(source));
    expect(result.pass).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.before).toEqual(result.after);
    expect(result.scope).toBe('semantic-pmi-only');
  });

  it('does not pass an empty PMI document', async () => {
    const result = await verifyAp242PmiSemanticRoundtrip("ISO-10303-21;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;");
    expect(result.pass).toBe(false);
  });

  it('attaches semantic PMI after existing geometry ids without replacing geometry', async () => {
    const source: PmiSemanticSnapshot = {
      datums: ['A'],
      dimensions: [{ kind: 'size', name: 'width', value: 20, lower: -0.1, upper: 0.1 }],
      geometricTolerances: [],
    };
    const geometry = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('x'),'2;1');\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\n#50=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n`;
    const attached = attachCanonicalAp242Pmi(geometry, source);
    expect(attached).toContain("#50=CARTESIAN_POINT('',(0.,0.,0.));");
    expect(attached).toContain('#51=PRODUCT_DEFINITION_SHAPE');
    expect(attached).toContain('NEXYFAB_NORMALIZED_SEMANTIC_PMI');
    expect(await extractAp242PmiSemanticSnapshot(attached)).toEqual(source);
  });

  it('reattaches a semantic root to the corresponding exported face ordinal', async () => {
    const geometry = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('x'),'2;1');\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\n#50=ADVANCED_FACE('',(),$,.T.);\nENDSEC;\nEND-ISO-10303-21;\n`;
    const source = `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\n#1=ADVANCED_FACE('',(),$,.T.);\n#2=PRODUCT_DEFINITION_SHAPE('','',$);\n#3=SHAPE_ASPECT('target','',#2,.T.);\n#4=DATUM('',$,#3,.F.,'A');\n#5=GEOMETRIC_ITEM_SPECIFIC_USAGE('bind','',#4,#3,(#1));\nENDSEC;\nEND-ISO-10303-21;\n`;
    const result = await attachCanonicalAp242PmiWithFaceLinks(geometry, source);
    expect(result.mapped).toBe(1);
    expect(result.source).toContain('NEXYFAB_SEMANTIC_FACE_BINDINGS');
    const evidence = await analyzeAp242Pmi(result.source);
    expect(evidence.topology.coverage).toBe(1);
  });
});
