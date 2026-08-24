import { describe, expect, it } from 'vitest';
import { smallOfficeFitoutFixture } from './smallOfficeFitout';

const ids = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(ids);
  const record = value as Record<string, unknown>;
  return [typeof record.id === 'string' ? record.id : '', ...Object.values(record).flatMap(ids)].filter(Boolean);
};

describe('small office fit-out synthetic fixture', () => {
  it('has stable unique IDs and every relationship points to the host or a declared object', () => {
    const allIds = ids(smallOfficeFitoutFixture);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(smallOfficeFitoutFixture.host.polygon).toHaveLength(4);
    expect(smallOfficeFitoutFixture.host.walls.every((wall) => wall.hostRef === smallOfficeFitoutFixture.host.id)).toBe(true);
    const spaceIds = new Set(smallOfficeFitoutFixture.spaces.map((space) => space.id));
    expect(smallOfficeFitoutFixture.program.every((item) => spaceIds.has(item.spaceId))).toBe(true);
    expect(smallOfficeFitoutFixture.furnitureEnvelopes.every((item) => spaceIds.has(item.spaceRef))).toBe(true);
    expect(smallOfficeFitoutFixture.mepZones.every((item) => spaceIds.has(item.spaceRef))).toBe(true);
  });

  it('declares original rights-cleared provenance and no external source material', () => {
    expect(smallOfficeFitoutFixture.provenance.origin).toBe('ORIGINAL_SYNTHETIC');
    expect(smallOfficeFitoutFixture.provenance.rightsStatus).toBe('RIGHTS_CLEARED');
    expect(smallOfficeFitoutFixture.provenance.externalSourcesUsed).toHaveLength(0);
    expect(smallOfficeFitoutFixture.provenance.surveyedHost).toBe(false);
  });

  it('keeps construction, code, catalogue, photometric, MEP, exchange, and pilot gates unrun', () => {
    expect(smallOfficeFitoutFixture.constructionApproval.approved).toBe(false);
    expect(Object.values(smallOfficeFitoutFixture.verificationStatus).every((status) => status === 'NOT_RUN')).toBe(true);
    expect(smallOfficeFitoutFixture.millwork.every((item) => item.catalogStatus === 'NOT_RUN' && item.constructionApproval === false)).toBe(true);
    expect(smallOfficeFitoutFixture.lightingPlaceholders.every((item) => item.photometricStatus === 'NOT_RUN')).toBe(true);
    expect(smallOfficeFitoutFixture.designBasis.numericalBasis).toMatch(/Synthetic test values/);
  });
});
