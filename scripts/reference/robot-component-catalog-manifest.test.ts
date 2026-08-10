import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRobotComponentCatalogManifest } from './robot-component-catalog-manifest';

function fixture(root: string, hash: string) {
  const base = { id: 'M1', kind: 'motor', manufacturer: 'maker', model: 'model', revision: 'A', source: 'manufacturer PDF', artifactHash: hash, massKg: 1, massSource: 'confirmed', envelopeMm: { x: 10, y: 10, z: 20 }, interface: { axisRef: 'z_axis', mountingPlaneRef: 'xy_plane', shaftDiameterMm: 5 }, ratedTorqueNm: 1, peakTorqueNm: 2, maxRpm: 1000, rotorInertiaKgM2: 0.001 };
  return { schema: 'nexyfab.robot-component-catalog.v1', components: [base], artifacts: [{ path: 'evidence/motor.pdf', sha256: hash, source: 'manufacturer PDF', mediaType: 'application/pdf' }] };
}

describe('robot component catalog manifest', () => {
  it('verifies actual artifact bytes and production bindings', () => {
    const root = path.join(tmpdir(), `nexyfab-catalog-${process.pid}-${Date.now()}`); mkdirSync(path.join(root, 'evidence'), { recursive: true });
    const bytes = Buffer.from('fixture datasheet'); const hash = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(path.join(root, 'evidence', 'motor.pdf'), bytes); writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(fixture(root, hash)));
    expect(validateRobotComponentCatalogManifest(path.join(root, 'manifest.json'))).toMatchObject({ valid: true, productionEligible: true, componentCount: 1, artifacts: [{ verified: true }] });
  });
  it('fails closed on hash mismatch and path traversal', () => {
    const root = path.join(tmpdir(), `nexyfab-catalog-bad-${process.pid}-${Date.now()}`); mkdirSync(path.join(root, 'evidence'), { recursive: true });
    writeFileSync(path.join(root, 'evidence', 'motor.pdf'), 'changed'); const hash = 'a'.repeat(64);
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(fixture(root, hash)));
    expect(validateRobotComponentCatalogManifest(path.join(root, 'manifest.json'))).toMatchObject({ valid: false, productionEligible: false });
    const escaped = fixture(root, hash); escaped.artifacts[0]!.path = '../outside.pdf'; writeFileSync(path.join(root, 'escaped.json'), JSON.stringify(escaped));
    expect(validateRobotComponentCatalogManifest(path.join(root, 'escaped.json')).errors.join(' ')).toMatch(/outside\.pdf/);
  });
});
