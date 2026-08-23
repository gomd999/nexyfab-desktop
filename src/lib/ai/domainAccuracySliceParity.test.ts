import { describe, expect, it } from 'vitest';
import {
  DOMAIN_ACCURACY_PROFILES as legacyProfiles,
  assessDomainAccuracy as assessLegacy,
  type DomainAccuracyDomain,
  type DomainAccuracyEvidence,
} from './domainAccuracyProgram';
import {
  DOMAIN_ACCURACY_DOMAINS,
  DOMAIN_ACCURACY_PROFILES as sliceProfiles,
  assessDomainAccuracy as assessSlice,
} from '../../../capabilities/ai-design/domain-accuracy/src/contract.mjs';

function passingEvidence(domain: DomainAccuracyDomain): DomainAccuracyEvidence {
  return {
    domain,
    approvedCases: 20,
    independentReviewers: 2,
    campaigns: 3,
    minimumRepeatsPerCase: 15,
    minimumRepeatsPerCampaign: 5,
    requiredGateRuns: 3,
    requiredGatePasses: 3,
    falseVerified: 0,
    falseClear: 0,
    destructivePartMerge: 0,
    axes: legacyProfiles[domain].requiredAxes.map(axis => ({ axis, expected: 20, measured: 20, passed: 19 })),
  };
}

describe('domain-accuracy slice compatibility', () => {
  it('keeps the profile snapshot bound to the legacy registry', () => {
    for (const domain of DOMAIN_ACCURACY_DOMAINS) {
      expect(sliceProfiles[domain]).toEqual(legacyProfiles[domain]);
    }
  });

  it('matches pass and fail-closed assessments for every domain', () => {
    for (const domain of DOMAIN_ACCURACY_DOMAINS) {
      const pass = passingEvidence(domain);
      expect(assessSlice(pass)).toEqual(assessLegacy(pass));
      const missingAxis = { ...pass, axes: pass.axes.slice(1) };
      expect(assessSlice(missingAxis)).toEqual(assessLegacy(missingAxis));
    }
  });
});
