import { describe, it, expect } from 'vitest';
import {
  preflightIfc,
  productsByType,
  checkCompatibility,
} from './ifcImport';

const MINIMAL_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('IFC export'), '2;1');
FILE_NAME('test.ifc', '2026-05-19T10:00:00', ('NexyFab'), ('NexyFab'), 'NexyFab', 'NexyFab', '');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('PROJ001',$,'Test Project',$,$,$,$,(#5),#10);
#2=IFCSITE('SITE001',$,'Test Site',$,$,$,$,$,$,$,$,$,$,$);
#3=IFCBUILDING('BLDG001',$,'Test Building',$,$,$,$,$,$,$,$,$);
#4=IFCBUILDINGSTOREY('LVL001',$,'Ground Floor',$,$,$,$,$,$,$);
#5=IFCSIUNIT($,.LENGTHUNIT.,$,.METRE.);
#100=IFCWALL('WALL001',$,'Wall 1',$,$,$,$,$,$);
#101=IFCWALL('WALL002',$,'Wall 2',$,$,$,$,$,$);
#102=IFCDOOR('DOOR001',$,'Door 1',$,$,$,$,$,$,$,$);
#103=IFCWINDOW('WIN001',$,'Window 1',$,$,$,$,$,$,$);
#104=IFCSPACE('SPACE001',$,'Living Room',$,$,$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;`;

describe('preflightIfc — header', () => {
  it('detects IFC4 schema', () => {
    const r = preflightIfc(MINIMAL_IFC);
    expect(r.header.schema).toBe('IFC4');
  });

  it('extracts file description', () => {
    const r = preflightIfc(MINIMAL_IFC);
    expect(r.header.fileDescription).toContain('IFC export');
  });

  it('detects length unit METRE', () => {
    const r = preflightIfc(MINIMAL_IFC);
    expect(r.header.lengthUnit).toBe('METRE');
  });
});

describe('entity counts', () => {
  it('counts each IFC type', () => {
    const r = preflightIfc(MINIMAL_IFC);
    const wallCount = r.entityCounts.find(c => c.type === 'IFCWALL')?.count;
    expect(wallCount).toBe(2);
  });

  it('sorted descending', () => {
    const r = preflightIfc(MINIMAL_IFC);
    for (let i = 1; i < r.entityCounts.length; i++) {
      expect(r.entityCounts[i]!.count).toBeLessThanOrEqual(r.entityCounts[i - 1]!.count);
    }
  });

  it('totalEntities sums counts', () => {
    const r = preflightIfc(MINIMAL_IFC);
    const sum = r.entityCounts.reduce((s, c) => s + c.count, 0);
    expect(r.totalEntities).toBe(sum);
  });
});

describe('products extraction', () => {
  it('finds walls / doors / windows / space', () => {
    const r = preflightIfc(MINIMAL_IFC);
    const types = new Set(r.products.map(p => p.type));
    expect(types.has('IFCWALL')).toBe(true);
    expect(types.has('IFCDOOR')).toBe(true);
    expect(types.has('IFCWINDOW')).toBe(true);
    expect(types.has('IFCSPACE')).toBe(true);
  });

  it('extracts product names', () => {
    const r = preflightIfc(MINIMAL_IFC);
    const door = r.products.find(p => p.type === 'IFCDOOR');
    expect(door?.name).toBe('Door 1');
  });

  it('extracts globalIds', () => {
    const r = preflightIfc(MINIMAL_IFC);
    const wall = r.products.find(p => p.type === 'IFCWALL');
    expect(wall?.globalId).toBe('WALL001');
  });
});

describe('spatial tree', () => {
  it('includes site / building / storey / space', () => {
    const r = preflightIfc(MINIMAL_IFC);
    const types = r.spatialTree.map(n => n.type);
    expect(types).toContain('IFCSITE');
    expect(types).toContain('IFCBUILDING');
    expect(types).toContain('IFCBUILDINGSTOREY');
    expect(types).toContain('IFCSPACE');
  });
});

describe('productsByType', () => {
  it('groups products', () => {
    const r = preflightIfc(MINIMAL_IFC);
    const grouped = productsByType(r);
    expect(grouped.get('IFCWALL')?.length).toBe(2);
  });
});

describe('checkCompatibility', () => {
  it('supported = true for IFC4', () => {
    const r = preflightIfc(MINIMAL_IFC);
    expect(checkCompatibility(r).supported).toBe(true);
  });

  it('unitsOk = true when METRE present', () => {
    const r = preflightIfc(MINIMAL_IFC);
    expect(checkCompatibility(r).unitsOk).toBe(true);
  });

  it('unknown schema → unsupported', () => {
    const bad = MINIMAL_IFC.replace('IFC4', 'IFC999');
    const r = preflightIfc(bad);
    expect(checkCompatibility(r).supported).toBe(false);
  });

  it('productCount reported', () => {
    const r = preflightIfc(MINIMAL_IFC);
    expect(checkCompatibility(r).productCount).toBe(r.products.length);
  });
});

describe('warnings', () => {
  it('empty file → warns about missing entities', () => {
    const r = preflightIfc('ISO-10303-21;\nEND-ISO-10303-21;');
    expect(r.warnings.some(w => w.includes('No IFC entity'))).toBe(true);
  });

  it('unknown schema warned', () => {
    const r = preflightIfc('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;');
    expect(r.warnings.some(w => w.includes('Schema'))).toBe(true);
  });
});
