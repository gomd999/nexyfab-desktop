import { describe, expect, it } from 'vitest';
import { exportIfcServiceOpenings } from '@/lib/brep-bridge/ifcServiceOpeningExport';
import { verifyIfcServiceOpeningRelease } from './ifcServiceOpeningReleaseGate';

const base = `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCOWNERHISTORY($,$,$,$,$,$,$,0);\n#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,$,$);\n#3=IFCWALL('wall-guid',#1,'Wall',$,$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;`;
const serviceOpening = { id: 'o1', hostId: 'w1', sourceRouteId: 'r1', sourceSleeveId: 's1', shape: 'round' as const, centerMm: [10, 20, 30] as [number, number, number], axis: [0, 1, 0] as [number, number, number], cutDiameterMm: 100, depthMm: 200, firestopAnnulusMm: 5 };
const exported = exportIfcServiceOpenings({ ifcSource: base, openings: [serviceOpening], hostGuidById: { w1: 'wall-guid' } });
const measurement = { openingGuid: exported.openings[0].openingGuid, centerMm: [10, 20, 30] as [number, number, number], axis: [0, 1, 0] as [number, number, number], cutDiameterMm: 100, depthMm: 200 };

describe('IFC service opening release gate', () => {
  it('passes only combined geometry, axis, host, and relationship evidence', () => {
    expect(verifyIfcServiceOpeningRelease({ expected: exported.openings, exportedIfc: exported.ifcSource, reimportedIfc: exported.ifcSource, measurements: [measurement] })).toMatchObject({ status: 'pass', releaseReady: true, checks: { geometry: true, axis: true, hostRelations: true, relationshipRoundtrip: true } });
  });
  it('fails a dimensional or directional regression', () => {
    const result = verifyIfcServiceOpeningRelease({ expected: exported.openings, exportedIfc: exported.ifcSource, reimportedIfc: exported.ifcSource, measurements: [{ ...measurement, cutDiameterMm: 101, axis: [0, -1, 0] }] });
    expect(result).toMatchObject({ status: 'fail', releaseReady: false, checks: { geometry: false, axis: false } });
  });
  it('does not turn absent reimport execution into a failure or pass', () => {
    expect(verifyIfcServiceOpeningRelease({ expected: exported.openings, exportedIfc: exported.ifcSource })).toMatchObject({ status: 'not_run', releaseReady: false });
  });
});
