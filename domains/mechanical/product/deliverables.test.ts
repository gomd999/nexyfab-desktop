import { describe, expect, it } from 'vitest';
import {
  createMechanicalDriveModuleDeliverableManifest,
  MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS,
  validateMechanicalDriveModuleDeliverableManifest,
} from './deliverables';
import type { DeliverableManifestFormat } from '../../../src/lib/cad/domainDeliverableManifest';

const revision = 'drive-rev-001';
const hash = 'a'.repeat(64);
const now = '2026-08-24T00:00:00.000Z';
const format: Record<string, DeliverableManifestFormat> = {
  'native-project': 'json', step: 'step', 'part-drawings': 'drawing',
  'assembly-drawing': 'drawing', bom: 'bom', 'tolerance-inspection-report': 'pdf',
  'dfm-report': 'pdf', 'assembly-verification-receipt': 'json',
};

function validInput() {
  return {
    projectRevision: revision,
    modelContentHash: hash,
    generatedAt: now,
    deliverables: MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS.map((kind) => ({
      id: `drive-${kind}`,
      kind,
      format: format[kind],
      contentSha256: hash,
      byteLength: 100,
      sourceRevision: revision,
      generatedAt: now,
      verificationStatus: 'verified' as const,
    })),
  };
}

describe('mechanical drive-module deliverables', () => {
  it('creates and validates the exact commercial deliverable set', () => {
    const manifest = createMechanicalDriveModuleDeliverableManifest(validInput());
    expect(manifest.requiredDeliverableKinds).toEqual([...MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS]);
    expect(validateMechanicalDriveModuleDeliverableManifest(manifest, { projectRevision: revision, modelContentHash: hash })).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ['source revision', { sourceRevision: 'old-revision' }],
    ['verification hold', { verificationStatus: 'hold' }],
    ['unknown substitution', { kind: 'mesh-preview' }],
    ['format substitution', { format: 'pdf' }],
  ])('fails closed for %s', (_name, change) => {
    const manifest = createMechanicalDriveModuleDeliverableManifest(validInput());
    const deliverables = manifest.deliverables.map((item, index) => index === 0 ? { ...item, ...change } : item);
    const result = validateMechanicalDriveModuleDeliverableManifest({ ...manifest, deliverables });
    expect(result.valid).toBe(false);
  });

  it('rejects missing and altered required-kind declarations', () => {
    const manifest = createMechanicalDriveModuleDeliverableManifest(validInput());
    expect(validateMechanicalDriveModuleDeliverableManifest({ ...manifest, requiredDeliverableKinds: ['step', 'drawing', 'bom'] }).valid).toBe(false);
    expect(validateMechanicalDriveModuleDeliverableManifest({ ...manifest, deliverables: manifest.deliverables.slice(1) }).valid).toBe(false);
  });

  it('rejects stale external expectations', () => {
    const manifest = createMechanicalDriveModuleDeliverableManifest(validInput());
    expect(validateMechanicalDriveModuleDeliverableManifest(manifest, { projectRevision: 'other-revision' }).valid).toBe(false);
    expect(validateMechanicalDriveModuleDeliverableManifest(manifest, { modelContentHash: 'b'.repeat(64) }).valid).toBe(false);
  });
});
