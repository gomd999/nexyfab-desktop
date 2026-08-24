import { describe, expect, it } from 'vitest';
import { validateMechanicalProductAuthority } from './authority';
import { createMotorGearboxDriveModuleContract } from './contract';

const hash = 'a'.repeat(64);
const provenance = (id: string) => ({ sourceId: id, sourceRef: `rights-cleared://${id}`, contentSha256: hash, rightsReceiptSha256: hash, origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const contract = createMotorGearboxDriveModuleContract({
  schema: 'nexyfab.mechanical.motor-gearbox-drive-module.v1', authoritative: true,
  identity: { id: 'drive-001', revision: 'r1' },
  units: { length: 'mm', force: 'N', torque: 'N.m', speed: 'rpm', time: 'h', angle: 'deg', mass: 'kg', stress: 'MPa' },
  requirements: { ratedTorqueNm: 10, ratedSpeedRpm: 1000, duty: 'continuous', serviceFactor: 1.2, designLifeHours: 1000, alignmentToleranceMm: .1 },
  parts: ['base','shaft','bearing-a','bearing-b','coupling','fasteners','guard'].map((id, i) => ({ id, role: (['base','shaft','bearing-support','bearing-support','coupling','fastener','guard'] as const)[i]!, material: provenance(`${id}-m`), process: provenance(`${id}-p`), procurement: { mode: 'MAKE' as const, source: provenance(`${id}-q`) }, geometryHash: hash, sourceRevision: 'r1' })),
  datums: [{ id: 'd1', partId: 'base', axis: 'Z', description: 'datum', sourceRevision: 'r1' }],
  interfaces: [{ id: 'i1', fromPartId: 'shaft', toPartId: 'coupling', kind: 'coupling', nominal: 10, tolerance: .1, unit: 'mm', sourceRevision: 'r1' }],
  criticalDimensions: [{ id: 'x1', partId: 'base', datumId: 'd1', nominal: 10, plusTolerance: .1, minusTolerance: .1, unit: 'mm', inspectionMethod: 'cmm', sourceRevision: 'r1' }],
});
const manifest = (kind: any, id: string) => ({ id, kind, sourceRef: `rights-cleared://${id}`, contentSha256: hash, capturedAt: '2026-08-24T00:00:00Z', reviewedAt: '2026-08-24T00:00:00Z', status: 'APPROVED', rights: { status: 'APPROVED', receiptSha256: hash } });

describe('mechanical product authority adapter', () => {
  it('fails closed when revision or linked provenance is absent', () => {
    const result = validateMechanicalProductAuthority({ schemaVersion: 'nexyfab.cad.domain-authority-manifest.v1', domain: 'mechanical', projectId: 'p', projectRevision: { id: 'r1', sha256: hash }, sourceRevision: { id: 'requirements-r1', sha256: hash }, authorities: [] }, contract, { projectId: 'p', projectRevisionSha256: hash, sourceRevisionSha256: hash });
    expect(result.status).toBe('HOLD');
    expect(result.issues).toContain('manifest:authorities:invalid_count');
  });
  it('never treats a missing professional review as commercial PASS', () => {
    const entries = [...['base','shaft','bearing-a','bearing-b','coupling','fasteners','guard'].flatMap(id => [manifest('catalog', `${id}-m`), manifest('catalog', `${id}-p`), manifest('manufacturer', `${id}-q`)]), manifest('client', 'client-1'), manifest('standard', 'standard-1')];
    const result = validateMechanicalProductAuthority({ schemaVersion: 'nexyfab.cad.domain-authority-manifest.v1', domain: 'mechanical', projectId: 'p', projectRevision: { id: 'r1', sha256: hash }, sourceRevision: { id: 'requirements-r1', sha256: hash }, authorities: entries }, contract, { projectId: 'p', projectRevisionSha256: hash, sourceRevisionSha256: hash });
    expect(result.status).toBe('HOLD');
    expect(result.issues).toContain('authority:professional_review:HOLD');
  });
});
