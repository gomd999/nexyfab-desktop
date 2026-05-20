import { describe, it, expect } from 'vitest';
import { discoverStep } from './stepEntityParser';

const minimalStep = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Test file'), '2;1');
FILE_NAME('test.step',
  '2026-05-18T12:00:00',
  ('Alice','Bob'),
  ('Acme','Globex'),
  'NexyFab Test',
  'NexyFab Test',
  '');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=PRODUCT('PART-001','PART-001','',(#2));
#2=PRODUCT_CONTEXT('',#3,'mechanical');
#3=APPLICATION_CONTEXT('automotive');
#10=MANIFOLD_SOLID_BREP('Body1',#11);
#11=CLOSED_SHELL('',(#20,#21));
#20=ADVANCED_FACE('Face1',(#30),#40,.T.);
#21=ADVANCED_FACE('Face2',(#31),#41,.T.);
#30=FACE_OUTER_BOUND('',#50,.T.);
#31=FACE_OUTER_BOUND('',#51,.T.);
#50=EDGE_LOOP('',(#60));
#51=EDGE_LOOP('',(#61));
#60=ORIENTED_EDGE('',*,*,#70,.T.);
#61=ORIENTED_EDGE('',*,*,#71,.T.);
#70=EDGE_CURVE('',#80,#81,#90,.T.);
#71=EDGE_CURVE('',#82,#83,#91,.T.);
#100=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
ENDSEC;
END-ISO-10303-21;`;

const ap242Step = minimalStep.replace(
  'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }',
  'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }',
);

const inchStep = minimalStep.replace(
  '( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )',
  `CONVERSION_BASED_UNIT('INCH', #200)`,
);

const assemblyStep = minimalStep + `
DATA;
#500=NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO1','','',#1,#2,$);
#501=NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO2','','',#1,#2,$);
ENDSEC;`;

describe('discoverStep · header parsing', () => {
  it('extracts file name + timestamp', () => {
    const d = discoverStep(minimalStep);
    expect(d.header.fileName).toBe('test.step');
    expect(d.header.timestamp).toBe('2026-05-18T12:00:00');
  });

  it('parses author + organisation lists', () => {
    const d = discoverStep(minimalStep);
    expect(d.header.author).toEqual(['Alice', 'Bob']);
    expect(d.header.organisation).toEqual(['Acme', 'Globex']);
  });

  it('detects AP214 schema', () => {
    const d = discoverStep(minimalStep);
    expect(d.header.schema).toBe('AP214');
  });

  it('detects AP242 schema', () => {
    const d = discoverStep(ap242Step);
    expect(d.header.schema).toBe('AP242');
  });

  it('returns "unknown" for schema we do not classify', () => {
    const src = minimalStep.replace(
      "AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }",
      'SOME_OTHER_SCHEMA',
    );
    expect(discoverStep(src).header.schema).toBe('unknown');
  });

  it('returns empty header for malformed input', () => {
    const d = discoverStep('NOT A STEP FILE');
    expect(d.header.fileName).toBe('');
    expect(d.header.schema).toBe('unknown');
  });
});

describe('discoverStep · entity counting', () => {
  it('counts the major structural entities', () => {
    const d = discoverStep(minimalStep);
    expect(d.entities.products).toBe(1);
    expect(d.entities.solids).toBe(1);
    expect(d.entities.faces).toBe(2);
    expect(d.entities.edges).toBe(4); // 2 ORIENTED_EDGE + 2 EDGE_CURVE
  });

  it('total reflects every #N=ENTITY entry', () => {
    const d = discoverStep(minimalStep);
    expect(d.entities.total).toBeGreaterThan(10);
  });

  it('byType has the named entity buckets', () => {
    const d = discoverStep(minimalStep);
    expect(d.entities.byType['PRODUCT']).toBe(1);
    expect(d.entities.byType['ADVANCED_FACE']).toBe(2);
  });
});

describe('discoverStep · flags', () => {
  it('hasSolidGeometry true when MANIFOLD_SOLID_BREP present', () => {
    expect(discoverStep(minimalStep).hasSolidGeometry).toBe(true);
  });

  it('hasSolidGeometry false on header-only file', () => {
    const headerOnly = `ISO-10303-21;
HEADER;
FILE_NAME('empty.step','','','','','','');
FILE_SCHEMA((''));
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`;
    expect(discoverStep(headerOnly).hasSolidGeometry).toBe(false);
  });

  it('isAssembly true when NEXT_ASSEMBLY_USAGE_OCCURRENCE present', () => {
    expect(discoverStep(assemblyStep).isAssembly).toBe(true);
  });

  it('isAssembly false on single-part file', () => {
    expect(discoverStep(minimalStep).isAssembly).toBe(false);
  });
});

describe('discoverStep · unit detection', () => {
  it('detects millimetre SI_UNIT', () => {
    expect(discoverStep(minimalStep).unitsHint).toBe('mm');
  });

  it('detects inch via CONVERSION_BASED_UNIT', () => {
    expect(discoverStep(inchStep).unitsHint).toBe('inch');
  });

  it('returns unknown when no recognisable unit', () => {
    const noUnit = minimalStep.replace(
      '( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )',
      '/* no unit info */',
    );
    expect(discoverStep(noUnit).unitsHint).toBe('unknown');
  });
});
