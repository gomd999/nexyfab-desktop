import { describe, expect, it } from 'vitest';
import { snapshotIfcOpeningRelationships } from '@/lib/reference/ifcOpeningRelationshipEvidence';
import { exportIfcServiceOpenings } from './ifcServiceOpeningExport';

const base = `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCOWNERHISTORY($,$,$,$,$,$,$,0);\n#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,$,$);\n#3=IFCWALL('wall-guid',#1,'Wall',$,$,$,$,$,$);\n#4=IFCDOOR('door-guid',#1,'Door',$,$,$,$,$,$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;`;
const opening = { id: 'opening-1', hostId: 'wall-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', shape: 'round' as const, centerMm: [1000, 200, 2500] as [number, number, number], axis: [1, 0, 0] as [number, number, number], cutDiameterMm: 160, depthMm: 240, firestopAnnulusMm: 10 };

describe('IFC service opening export', () => {
  it('writes a round swept solid and void/fill relations', () => {
    const result = exportIfcServiceOpenings({ ifcSource: base, openings: [opening], hostGuidById: { 'wall-1': 'wall-guid' }, fillGuidByOpeningId: { 'opening-1': 'door-guid' } });
    expect(result.ifcSource).toContain('IFCCIRCLEPROFILEDEF(.AREA.');
    expect(result.ifcSource).toContain('IFCEXTRUDEDAREASOLID');
    const relationships = snapshotIfcOpeningRelationships(result.ifcSource);
    expect(relationships.errors).toEqual([]);
    expect(relationships.voids).toEqual([{ relationGuid: result.openings[0].voidRelationGuid, hostGuid: 'wall-guid', openingGuid: result.openings[0].openingGuid }]);
    expect(relationships.fills[0]).toMatchObject({ openingGuid: result.openings[0].openingGuid, fillGuid: 'door-guid' });
  });

  it('fails closed when the host occurrence cannot be resolved', () => {
    expect(() => exportIfcServiceOpenings({ ifcSource: base, openings: [opening], hostGuidById: {} })).toThrow('missing_ifc_host');
  });
});
