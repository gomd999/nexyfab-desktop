import { describe, expect, it } from 'vitest';
import { DESIGN_DOMAIN_IDS } from './domainProfile';
import { DOMAIN_PROFILES } from './domainProfileRegistry';
import {
  DOMAIN_FORMAT_SUPPORT,
  getStandaloneImportFormats,
  validateDomainFormatSupport,
} from './domainFormatSupport';

describe('domain format support truth registry', () => {
  it('covers every declared domain import exactly once', () => {
    expect(validateDomainFormatSupport()).toEqual([]);

    for (const domain of DESIGN_DOMAIN_IDS) {
      expect(DOMAIN_FORMAT_SUPPORT[domain].map(item => item.format))
        .toEqual(DOMAIN_PROFILES[domain].importFormats);
    }
  });

  it('never places an external-CAD dependency in the standalone workflow', () => {
    for (const domain of DESIGN_DOMAIN_IDS) {
      expect(getStandaloneImportFormats(domain).every(item => !item.externalCadRequired)).toBe(true);
    }
  });

  it('allows release claims only for verified paths', () => {
    for (const domain of DESIGN_DOMAIN_IDS) {
      for (const capability of DOMAIN_FORMAT_SUPPORT[domain]) {
        expect(capability.releaseClaimAllowed).toBe(capability.support === 'verified');
      }
    }
  });

  it('keeps proprietary-native and incomplete geospatial paths honest', () => {
    expect(DOMAIN_FORMAT_SUPPORT.building.find(item => item.format === 'rvt'))
      .toMatchObject({ support: 'optional_external', externalCadRequired: true });
    expect(DOMAIN_FORMAT_SUPPORT.civil.find(item => item.format === 'landxml'))
      .toMatchObject({ support: 'preview', releaseClaimAllowed: false });
    expect(DOMAIN_FORMAT_SUPPORT.civil.find(item => item.format === 'dem'))
      .toMatchObject({ support: 'unsupported', releaseClaimAllowed: false });
    expect(DOMAIN_FORMAT_SUPPORT.interior.find(item => item.format === 'skp'))
      .toMatchObject({ support: 'unsupported', releaseClaimAllowed: false });
  });
});
