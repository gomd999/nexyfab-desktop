import { describe, expect, it } from 'vitest';
import {
  captureStepSemanticIdentity,
  rebindStepSemanticIdentity,
  stepContainsSemanticIdentity,
  StepSemanticIdentityError,
} from './stepSemanticIdentity';

const document = (body: string) => `ISO-10303-21;
HEADER;
ENDSEC;
DATA;
${body}
ENDSEC;
END-ISO-10303-21;`;

const source = document(`
#1=PRODUCT('root-pn','Root Assembly','',(#90));
#2=PRODUCT_DEFINITION_FORMATION('','',#1);
#3=PRODUCT_DEFINITION('design','',#2,#91);
#10=PRODUCT('base-plate','Base Plate','source',(#90));
#11=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#10,.NOT_KNOWN.);
#12=PRODUCT_DEFINITION('design','',#11,#91);
#20=PRODUCT('mount-block','Mount Block','',(#90));
#21=PRODUCT_DEFINITION_FORMATION('','',#20);
#22=PRODUCT_DEFINITION('design','',#21,#91);
#30=NEXT_ASSEMBLY_USAGE_OCCURRENCE('occ-1','Base Plate','',#3,#12,$);
#31=NEXT_ASSEMBLY_USAGE_OCCURRENCE('occ-2','Owner''s Mount','',#3,#22,$);`);

const returned = document(`
#101 = PRODUCT('translator root','translator root','',(#190));
#102 = PRODUCT_DEFINITION_FORMATION('','',#101);
#103 = PRODUCT_DEFINITION('design','',#102,#191);
#110 = PRODUCT('translator 1',
'translator 1','',(#190));
#111 = PRODUCT_DEFINITION_FORMATION('','',#110);
#112 = PRODUCT_DEFINITION('design','',#111,#191);
#120 = PRODUCT('translator 2','translator 2','',(#190));
#121 = PRODUCT_DEFINITION_FORMATION('','',#120);
#122 = PRODUCT_DEFINITION('design','',#121,#191);
#130 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#103,#112,$);
#131 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('2','','',#103,#122,$);
#900=CARTESIAN_POINT('',(1.,2.,3.));`);

describe('STEP semantic identity rebinding', () => {
  it('rebinds root, product, part-number and occurrence identity without changing geometry entities', () => {
    const identity = captureStepSemanticIdentity(source);
    expect(identity).toEqual({
      schema: 'nexyfab.step-semantic-identity.v1',
      treeSignature: '(()())',
      root: { partNumber: 'root-pn', name: 'Root Assembly', description: '' },
      occurrences: [
        {
          id: 'occ-1',
          name: 'Base Plate',
          description: '',
          product: { partNumber: 'base-plate', name: 'Base Plate', description: 'source' },
        },
        {
          id: 'occ-2',
          name: "Owner's Mount",
          description: '',
          product: { partNumber: 'mount-block', name: 'Mount Block', description: '' },
        },
      ],
    });

    const rebound = rebindStepSemanticIdentity(returned, identity!);
    expect(captureStepSemanticIdentity(rebound)).toEqual(identity);
    expect(rebound).toContain("'Owner''s Mount'");
    expect(rebound).toContain("#900=CARTESIAN_POINT('',(1.,2.,3.));");
  });

  it('fails closed when the returned product tree differs', () => {
    const identity = captureStepSemanticIdentity(source)!;
    const missingOccurrence = returned.replace(
      "#131 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('2','','',#103,#122,$);",
      '',
    );
    expect(() => rebindStepSemanticIdentity(missingOccurrence, identity))
      .toThrowError(new StepSemanticIdentityError('STEP_SEMANTIC_TREE_MISMATCH'));
  });

  it('does not capture malformed or non-STEP text', () => {
    expect(captureStepSemanticIdentity('not step')).toBeNull();
    expect(captureStepSemanticIdentity(document("#1=PRODUCT('only','Only','',(#90));"))).toBeNull();
  });

  it('ignores fake semantic entities inside STEP comments', () => {
    const commented = source.replace(
      'DATA;',
      "DATA;\n/* #999=PRODUCT('fake','Fake','',(#1)); */",
    );
    expect(captureStepSemanticIdentity(commented)).toEqual(captureStepSemanticIdentity(source));
    expect(stepContainsSemanticIdentity(document("/* #1=PRODUCT('fake','Fake','',(#1)); */"))).toBe(false);
    expect(stepContainsSemanticIdentity(source)).toBe(true);
  });
});
