import { describe, expect, it } from 'vitest';
import { din625BearingCatalog, validateCatalog, validateProductionCatalog, type CatalogComponent } from './componentCatalog';
import { selectRobotDriveTrain } from './componentSelector';
import { compileMechanicalInterface } from './mechanicalInterface';

const base = { manufacturer: 'fixture', revision: 'A', source: 'verified fixture datasheet', artifactHash: 'abcdef123456', massSource: 'confirmed' as const, interface: { axisRef: 'z_axis', mountingPlaneRef: 'xy_plane', shaftDiameterMm: 20 } };
const catalog: CatalogComponent[] = [
  { ...base, id: 'M1', model: 'M1', kind: 'motor', massKg: 1, envelopeMm: { x: 60, y: 60, z: 100 }, ratedTorqueNm: 1, peakTorqueNm: 3, maxRpm: 4000, rotorInertiaKgM2: 0.001 },
  { ...base, id: 'R1', model: 'R1', kind: 'reducer', massKg: 2, envelopeMm: { x: 90, y: 90, z: 80 }, ratio: 100, ratedOutputTorqueNm: 70, peakOutputTorqueNm: 120, maxInputRpm: 5000, efficiency: 0.8, backlashArcmin: 3 },
  ...din625BearingCatalog(),
];
describe('traceable robot component selection', () => {
  it('selects a deterministic motor, reducer and DIN bearing with margins', () => {
    const result = selectRobotDriveTrain([{ joint: 1, requiredOutputTorqueNm: 30, requiredOutputRpm: 20, radialLoadN: 1000, minShaftDiameterMm: 20 }], catalog);
    expect(result.ok).toBe(true); if (result.ok) expect(result.selections[0]).toMatchObject({ motor: { id: 'M1' }, reducer: { id: 'R1' } });
  });
  it('fails instead of inventing an unavailable drive', () => {
    expect(selectRobotDriveTrain([{ joint: 1, requiredOutputTorqueNm: 1000, requiredOutputRpm: 20, radialLoadN: 1000, minShaftDiameterMm: 20 }], catalog)).toMatchObject({ ok: false });
  });
  it('rejects untraceable catalog records', () => {
    expect(validateCatalog([{ ...catalog[0]!, source: '', artifactHash: '' }])).toContainEqual({ id: 'M1', message: 'traceable source and artifact hash are required' });
  });
  it('rejects duplicate joints and non-positive engineering requirements', () => {
    const valid = { joint: 1, requiredOutputTorqueNm: 30, requiredOutputRpm: 20, radialLoadN: 1000, minShaftDiameterMm: 20 };
    expect(selectRobotDriveTrain([valid, valid], catalog)).toMatchObject({ ok: false, errors: [expect.stringContaining('duplicate')] });
    expect(selectRobotDriveTrain([{ ...valid, requiredOutputTorqueNm: 0 }], catalog)).toMatchObject({ ok: false, errors: [expect.stringContaining('requiredOutputTorqueNm')] });
  });
  it('requires full artifact binding and confirmed mass for production catalogs', () => {
    expect(validateProductionCatalog(catalog, [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'production artifactHash must be a full SHA-256' }),
      expect.objectContaining({ message: 'production artifact evidence is missing' }),
    ]));
    const hash = 'a'.repeat(64);
    const production = catalog.slice(0, 2).map(component => ({ ...component, artifactHash: hash, massSource: 'confirmed' as const }));
    expect(validateProductionCatalog(production, [{ sha256: hash, byteLength: 1024, source: 'manufacturer datasheet PDF' }])).toEqual([]);
  });
  it('compiles axis and mounting-plane constraints plus explicit press evidence', () => {
    const out = compileMechanicalInterface({ id: 'J1-motor', parentPartId: 'housing', componentPartId: 'motor', parent: base.interface, component: base.interface, fit: 'press', fitAllowanceMm: 0.02 });
    expect(out.mates.map(m => m.kind)).toEqual(['concentric', 'coincident']); expect(out.intendedContact?.justification).toContain('0.02');
  });
});
