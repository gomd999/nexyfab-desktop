import { describe, expect, it } from 'vitest';
import { analyzeAp242Pmi } from './ap242PmiEvidence';
import { transplantAp242GraphicalPmi } from './ap242GraphicalPmi';

describe('AP242 graphical PMI transplant', () => {
  it('rebases a real callout dependency graph without colliding with target ids', async () => {
    const target = `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\n#50=ADVANCED_FACE('',(),$,.T.);\nENDSEC;\nEND-ISO-10303-21;\n`;
    const source = `ISO-10303-21;\nDATA;\n#1=TESSELLATED_GEOMETRIC_SET('glyph');\n#2=TESSELLATED_ANNOTATION_OCCURRENCE('note',(#1),$);\n#3=DRAUGHTING_CALLOUT('note',(#2));\nENDSEC;\nEND-ISO-10303-21;\n`;
    const result = transplantAp242GraphicalPmi(target, source);
    expect(result.unresolvedReferences).toEqual([]);
    expect(result.source).toContain('#53=DRAUGHTING_CALLOUT');
    const evidence = await analyzeAp242Pmi(result.source);
    expect(evidence.graphical).toEqual({ draughtingCallouts: 1, annotationOccurrences: 1, total: 2 });
  });
});
