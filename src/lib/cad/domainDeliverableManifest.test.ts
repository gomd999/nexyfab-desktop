import { describe, expect, it } from 'vitest';
import {
  canonicalDomainDeliverableManifestHash,
  createDomainDeliverableManifest,
  validateDomainDeliverableManifest,
} from './domainDeliverableManifest';

const revision = 'rev-2026-08-24-001';
const hash = 'a'.repeat(64);
const base = {
  domain: 'mechanical' as const,
  projectRevision: revision,
  modelContentHash: hash,
  generatedAt: '2026-08-24T00:00:00.000Z',
  deliverables: [
    { id: 'main-step', kind: 'step', format: 'step' as const, contentSha256: hash, byteLength: 10, sourceRevision: revision, generatedAt: '2026-08-24T00:00:00.000Z', verificationStatus: 'verified' as const },
    { id: 'drawing', kind: 'drawing', format: 'drawing' as const, contentSha256: hash, byteLength: 20, sourceRevision: revision, generatedAt: '2026-08-24T00:00:00.000Z', verificationStatus: 'verified' as const },
    { id: 'bom', kind: 'bom', format: 'bom' as const, contentSha256: hash, byteLength: 30, sourceRevision: revision, generatedAt: '2026-08-24T00:00:00.000Z', verificationStatus: 'verified' as const },
  ],
};

describe('domain deliverable manifest', () => {
  it('creates a domain-default, verified manifest and deterministic hash', () => {
    const manifest = createDomainDeliverableManifest(base);
    expect(validateDomainDeliverableManifest(manifest).valid).toBe(true);
    expect(manifest.requiredDeliverableKinds).toEqual(['step', 'drawing', 'bom']);
    expect(canonicalDomainDeliverableManifestHash(manifest)).toHaveLength(64);
    expect(canonicalDomainDeliverableManifestHash({ ...manifest, deliverables: [...manifest.deliverables].reverse() })).not.toBe(canonicalDomainDeliverableManifestHash(manifest));
  });

  it('uses the product domain id building while its owned storage scope remains architecture', () => {
    const manifest = createDomainDeliverableManifest({
      ...base,
      domain: 'building',
      deliverables: [
        { ...base.deliverables[0]!, id: 'building-ifc', kind: 'ifc', format: 'ifc' },
        { ...base.deliverables[1]!, id: 'building-drawing' },
        { ...base.deliverables[2]!, id: 'building-schedule', kind: 'schedule', format: 'schedule' },
      ],
    });
    expect(manifest.requiredDeliverableKinds).toEqual(['ifc', 'drawing', 'schedule']);
    expect(validateDomainDeliverableManifest(manifest).valid).toBe(true);
  });

  it.each([
    ['duplicate id', { id: 'drawing' }],
    ['stale revision', { sourceRevision: 'old-revision' }],
    ['not run', { verificationStatus: 'not_run' }],
    ['hold', { verificationStatus: 'hold' }],
    ['fail', { verificationStatus: 'fail' }],
  ])('blocks %s deliverables', (_name, change) => {
    const deliverables = base.deliverables.map((item, index) => index === 0 ? { ...item, ...change } : item);
    expect(validateDomainDeliverableManifest({ ...createDomainDeliverableManifest(base), deliverables }).valid).toBe(false);
  });

  it('fails closed on unknown keys and missing required kinds', () => {
    const manifest = createDomainDeliverableManifest(base);
    expect(validateDomainDeliverableManifest({ ...manifest, extra: true }).valid).toBe(false);
    expect(validateDomainDeliverableManifest({ ...manifest, deliverables: manifest.deliverables.slice(0, 2) }).valid).toBe(false);
  });
});
