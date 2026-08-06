import { describe, expect, it } from 'vitest';
import { analyzeAp242Pmi } from './ap242PmiEvidence';

const STEP = `ISO-10303-21;
HEADER;FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));ENDSEC;
DATA;
#1=ADVANCED_FACE('',(),#2,.T.);
#2=PLANE('',#3);
#10=SHAPE_ASPECT('target','',#20,.T.);
#11=GEOMETRIC_ITEM_SPECIFIC_USAGE('bind','',#10,#20,(#1));
#20=PRODUCT_DEFINITION_SHAPE('','',#21);
#30=DATUM('',$,#10,.F.,'A');
#31=DATUM_FEATURE('datum feature',$,#10,.T.);
#40=DIMENSIONAL_SIZE(#10,'diameter');
#50=(LENGTH_MEASURE_WITH_UNIT() MEASURE_WITH_UNIT(LENGTH_MEASURE(0.1),#60) REPRESENTATION_ITEM(''));
#51=FLATNESS_TOLERANCE('flat','',#50,#10);
#70=DRAUGHTING_CALLOUT('',(#71));
#71=TESSELLATED_ANNOTATION_OCCURRENCE('',#72);
ENDSEC;END-ISO-10303-21;`;

describe('AP242 PMI evidence', () => {
  it('separates semantic PMI, graphical PMI, and bounded face linkage', async () => {
    const result = await analyzeAp242Pmi(STEP);
    expect(result.schema).toBe('AP242');
    expect(result.semantic).toMatchObject({ datums: 1, datumFeatures: 1, dimensions: 1, geometricTolerances: 1, total: 3 });
    expect(result.graphical).toMatchObject({ draughtingCallouts: 1, annotationOccurrences: 1, total: 2 });
    expect(result.topology.semanticRoots).toBeGreaterThan(0);
    expect(result.topology.rootsReachingAdvancedFace).toBeGreaterThan(0);
  });

  it('returns zero evidence instead of inventing PMI', async () => {
    const result = await analyzeAp242Pmi("ISO-10303-21;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;");
    expect(result.semantic.total).toBe(0);
    expect(result.graphical.total).toBe(0);
    expect(result.topology.coverage).toBe(0);
  });
});

