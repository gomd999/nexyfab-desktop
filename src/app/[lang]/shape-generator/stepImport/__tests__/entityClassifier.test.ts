/**
 * entityClassifier.test.ts — AP242 BIM whitelist regression.
 *
 * Covers:
 *  - schema extraction from FILE_SCHEMA header
 *  - per-category counting (core / tessellated / pmi / units / style / bim / unknown)
 *  - unknown / bim type lists sorted + deduped
 *  - importable predicate (core > 0 AND bim == 0)
 *  - empty / malformed DATA section → safe defaults
 *  - formatClassifySummary 1-line shape
 *  - whitespace variants in entity header
 */

import { describe, it, expect } from 'vitest';
import {
  categorizeEntityType,
  classifyStepEntities,
  formatClassifySummary,
} from '../entityClassifier';

const headerAp214 = (extra = '') => `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('test'),'2;1');
FILE_NAME('x.step','2026-05-29',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
${extra}ENDSEC;
END-ISO-10303-21;`;

describe('categorizeEntityType — direct lookup', () => {
  it('classifies core geometry as core', () => {
    expect(categorizeEntityType('CARTESIAN_POINT')).toBe('core');
    expect(categorizeEntityType('ADVANCED_FACE')).toBe('core');
    expect(categorizeEntityType('MANIFOLD_SOLID_BREP')).toBe('core');
  });

  it('classifies AP242 tessellated as tessellated', () => {
    expect(categorizeEntityType('TRIANGULATED_FACE')).toBe('tessellated');
    expect(categorizeEntityType('COORDINATES_LIST')).toBe('tessellated');
  });

  it('classifies PMI by prefix', () => {
    expect(categorizeEntityType('GEOMETRIC_TOLERANCE')).toBe('pmi');
    expect(categorizeEntityType('DIMENSIONAL_LOCATION')).toBe('pmi');
    expect(categorizeEntityType('DATUM_REFERENCE')).toBe('pmi');
  });

  it('classifies BIM/IFC by prefix', () => {
    expect(categorizeEntityType('IFC_WALL')).toBe('bim');
    expect(categorizeEntityType('IFCBEAM')).toBe('bim');
    expect(categorizeEntityType('BUILDING_ELEMENT_PROXY')).toBe('bim');
    expect(categorizeEntityType('RAILING')).toBe('bim');
    expect(categorizeEntityType('SPATIAL_STRUCTURE_ELEMENT')).toBe('bim');
  });

  it('classifies units + style', () => {
    expect(categorizeEntityType('SI_UNIT')).toBe('units');
    expect(categorizeEntityType('LENGTH_UNIT')).toBe('units');
    expect(categorizeEntityType('COLOUR_RGB')).toBe('style');
    expect(categorizeEntityType('STYLED_ITEM')).toBe('style');
  });

  it('case-insensitive lookup', () => {
    expect(categorizeEntityType('cartesian_point')).toBe('core');
    expect(categorizeEntityType('Ifc_Wall')).toBe('bim');
  });

  it('unknown entity types fall through to "unknown"', () => {
    expect(categorizeEntityType('TOTALLY_FAKE_ENTITY')).toBe('unknown');
    expect(categorizeEntityType('SOMETHING_NEW_IN_2099')).toBe('unknown');
  });
});

describe('classifyStepEntities — schema + counts', () => {
  it('extracts AP214 schema token from FILE_SCHEMA', () => {
    const r = classifyStepEntities(headerAp214());
    expect(r.schema).toContain('AUTOMOTIVE_DESIGN');
    expect(r.schema).toContain('214');
  });

  it('returns null schema when FILE_SCHEMA missing', () => {
    const r = classifyStepEntities('DATA;\nENDSEC;\nEND-ISO-10303-21;');
    expect(r.schema).toBeNull();
  });

  it('totalEntities + per-category counts add up across one core, one bim, one tessellated', () => {
    const body = `#1=CARTESIAN_POINT('',(0.0,0.0,0.0));
#2=ADVANCED_FACE('',(#3),#4,.T.);
#3=TRIANGULATED_FACE('',#1,$,$);
#4=IFC_WALL('','wall1',$,$);
`;
    const r = classifyStepEntities(headerAp214(body));
    expect(r.totalEntities).toBe(4);
    expect(r.byCategory.core).toBe(2);
    expect(r.byCategory.tessellated).toBe(1);
    expect(r.byCategory.bim).toBe(1);
    expect(r.byCategory.unknown).toBe(0);
  });

  it('byType is sorted by count desc then type asc', () => {
    const body = `#1=CARTESIAN_POINT('',(0.0,0.0,0.0));
#2=CARTESIAN_POINT('',(1.0,0.0,0.0));
#3=CARTESIAN_POINT('',(2.0,0.0,0.0));
#4=DIRECTION('',(1.0,0.0,0.0));
#5=DIRECTION('',(0.0,1.0,0.0));
#6=PLANE('',#1);
`;
    const r = classifyStepEntities(headerAp214(body));
    expect(r.byType[0]).toEqual({ category: 'core', entityType: 'CARTESIAN_POINT', count: 3 });
    expect(r.byType[1]).toEqual({ category: 'core', entityType: 'DIRECTION', count: 2 });
    expect(r.byType[2]).toEqual({ category: 'core', entityType: 'PLANE', count: 1 });
  });
});

describe('classifyStepEntities — unknown + bim aggregation', () => {
  it('collects unknown type names sorted unique', () => {
    const body = `#1=WIDGET_THING('a');
#2=GIZMO_KIND('b');
#3=WIDGET_THING('c');
#4=CARTESIAN_POINT('',(0.0,0.0,0.0));
`;
    const r = classifyStepEntities(headerAp214(body));
    expect(r.unknownTypes).toEqual(['GIZMO_KIND', 'WIDGET_THING']);
    expect(r.byCategory.unknown).toBe(3);
  });

  it('collects bim type names sorted unique', () => {
    const body = `#1=IFC_WALL('a');
#2=IFC_BEAM('b');
#3=IFC_WALL('c');
#4=BUILDING_STOREY('floor1');
`;
    const r = classifyStepEntities(headerAp214(body));
    expect(r.bimTypes).toEqual(['BUILDING_STOREY', 'IFC_BEAM', 'IFC_WALL']);
    expect(r.byCategory.bim).toBe(4);
  });
});

describe('classifyStepEntities — importable predicate', () => {
  it('importable = true when core > 0 and no bim', () => {
    const body = `#1=CARTESIAN_POINT('',(0.0,0.0,0.0));
#2=ADVANCED_FACE('',(#3),#4,.T.);
`;
    const r = classifyStepEntities(headerAp214(body));
    expect(r.importable).toBe(true);
  });

  it('importable = false when bim entities present (blocks import)', () => {
    const body = `#1=CARTESIAN_POINT('',(0.0,0.0,0.0));
#2=IFC_WALL('','wall1',$,$);
`;
    const r = classifyStepEntities(headerAp214(body));
    expect(r.importable).toBe(false);
  });

  it('importable = false when no core geometry (only structure)', () => {
    const body = `#1=APPLICATION_CONTEXT('mech');
#2=PRODUCT('P','P','',(#3));
`;
    const r = classifyStepEntities(headerAp214(body));
    expect(r.importable).toBe(false);
  });
});

describe('classifyStepEntities — robustness', () => {
  it('empty DATA section → 0 totals + not importable', () => {
    const r = classifyStepEntities(headerAp214());
    expect(r.totalEntities).toBe(0);
    expect(r.importable).toBe(false);
    expect(r.byType).toEqual([]);
  });

  it('missing DATA section → safe defaults', () => {
    const r = classifyStepEntities('ISO-10303-21;\nHEADER;\nENDSEC;');
    expect(r.totalEntities).toBe(0);
    expect(r.importable).toBe(false);
  });

  it('whitespace variants in entity header', () => {
    const body = `#1 = CARTESIAN_POINT ('',(0.0,0.0,0.0));
#2=ADVANCED_FACE('',(#3),#4,.T.);
#3   =   DIRECTION   ('',(1.0,0.0,0.0));
`;
    const r = classifyStepEntities(headerAp214(body));
    expect(r.totalEntities).toBe(3);
    expect(r.byCategory.core).toBe(3);
  });

  it('comment-like lines are ignored', () => {
    const body = `/* this is a comment line */
#1=CARTESIAN_POINT('',(0.0,0.0,0.0));
/* another comment with #99=FAKE() */
`;
    const r = classifyStepEntities(headerAp214(body));
    expect(r.totalEntities).toBe(1);
  });
});

describe('formatClassifySummary', () => {
  it('renders all 5 segments (schema · entities · core% · unknown · verdict)', () => {
    const body = `#1=CARTESIAN_POINT('',(0.0,0.0,0.0));
#2=ADVANCED_FACE('',(#3),#4,.T.);
`;
    const r = classifyStepEntities(headerAp214(body));
    const line = formatClassifySummary(r);
    expect(line).toContain('AUTOMOTIVE_DESIGN');
    expect(line).toContain('2 entities');
    expect(line).toContain('100% core');
    expect(line).toContain('0 unknown');
    expect(line).toContain('ok to import');
  });

  it('renders BIM-blocked verdict', () => {
    const body = `#1=CARTESIAN_POINT('',(0.0,0.0,0.0));
#2=IFC_WALL('','w',$,$);
`;
    const r = classifyStepEntities(headerAp214(body));
    const line = formatClassifySummary(r);
    expect(line).toContain('1 BIM entities');
    expect(line).toContain('not importable');
  });

  it('renders no-geometry verdict', () => {
    const r = classifyStepEntities(headerAp214());
    const line = formatClassifySummary(r);
    expect(line).toContain('no core geometry');
  });
});
