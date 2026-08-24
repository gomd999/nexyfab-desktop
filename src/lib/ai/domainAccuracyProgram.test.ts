import { describe, expect, it } from 'vitest';
import {
  DOMAIN_ACCURACY_DOMAINS,
  DOMAIN_ACCURACY_PROFILES,
  assessDomainAccuracy,
  type DomainAccuracyDomain,
  type DomainAccuracyEvidence,
} from './domainAccuracyProgram';
import { DEFAULT_COMPLEX_BENCHMARK_POLICY_V2 } from './complexProductBenchmarkV2';

function passingEvidence(domain: DomainAccuracyDomain): DomainAccuracyEvidence {
  return {
    domain,
    approvedCases: 20,
    independentReviewers: 2,
    campaigns: 3,
    minimumRepeatsPerCase: 15,
    minimumRepeatsPerCampaign: 5,
    requiredGateRuns: 300,
    requiredGatePasses: 300,
    falseVerified: 0,
    falseClear: 0,
    destructivePartMerge: 0,
    axes: DOMAIN_ACCURACY_PROFILES[domain].requiredAxes.map(axis => ({
      axis,
      expected: 300,
      measured: 300,
      passed: 285,
    })),
  };
}

describe('parallel domain accuracy release contract', () => {
  it.each(DOMAIN_ACCURACY_DOMAINS)('%s accepts complete 95% evidence', domain => {
    expect(assessDomainAccuracy(passingEvidence(domain))).toMatchObject({
      domain,
      eligible: true,
      blockers: [],
    });
  });

  it('fails closed when an interior door-swing axis is missing', () => {
    const evidence = passingEvidence('interior');
    evidence.axes = evidence.axes.filter(item => item.axis !== 'door_swing');
    expect(assessDomainAccuracy(evidence)).toMatchObject({
      eligible: false,
      blockers: expect.arrayContaining(['accuracy:door_swing', 'coverage:door_swing']),
    });
  });

  it('separates accuracy from coverage', () => {
    const evidence = passingEvidence('mechanical');
    evidence.axes = evidence.axes.map(item => item.axis === 'features'
      ? { ...item, measured: 150, passed: 150 }
      : item);
    expect(assessDomainAccuracy(evidence).blockers).toContain('coverage:features');
    expect(assessDomainAccuracy(evidence).blockers).not.toContain('accuracy:features');
  });

  it('rejects insufficient review, campaigns, repeats, or gate passes', () => {
    const evidence = passingEvidence('civil');
    Object.assign(evidence, {
      approvedCases: 19,
      independentReviewers: 1,
      campaigns: 2,
      minimumRepeatsPerCase: 14,
      minimumRepeatsPerCampaign: 4,
      requiredGatePasses: 299,
    });
    expect(assessDomainAccuracy(evidence).blockers).toEqual(expect.arrayContaining([
      'approved_cases:19/20',
      'independent_reviewers:minimum_2',
      'campaigns:2/3',
      'repeats:14/15',
      'campaign_repeats:4/5',
      'required_gate_pass_rate',
    ]));
  });

  it('rejects unsafe success claims even when numeric accuracy passes', () => {
    const evidence = passingEvidence('landscape');
    evidence.falseVerified = 1;
    evidence.falseClear = 1;
    evidence.destructivePartMerge = 1;
    expect(assessDomainAccuracy(evidence).blockers).toEqual(expect.arrayContaining([
      'false_verified', 'false_clear', 'destructive_part_merge',
    ]));
  });

  it('rejects inconsistent evidence counts', () => {
    const evidence = passingEvidence('building');
    evidence.axes = evidence.axes.map(item => item.axis === 'storeys_grids'
      ? { ...item, expected: 10, measured: 11, passed: 12 }
      : item);
    expect(assessDomainAccuracy(evidence).blockers).toContain('counts_invalid:storeys_grids');
  });

  it('rejects missing, coerced, negative, duplicate, or out-of-scope evidence', () => {
    const evidence = passingEvidence('mechanical');
    const invalid = [
      [{ ...evidence, approvedCases: undefined }, 'approvedCases'],
      [{ ...evidence, approvedCases: '20' }, 'approvedCases'],
      [{ ...evidence, falseVerified: -1 }, 'falseVerified'],
      [{ ...evidence, axes: [...evidence.axes, evidence.axes[0]] }, 'axis_duplicate'],
      [{ ...evidence, axes: [{ ...evidence.axes[0], axis: 'unknown_axis' }] }, 'axis'],
      [{ ...evidence, axes: [{ ...evidence.axes[0], measured: -1 }] }, 'measured'],
    ] as const;

    for (const [value, path] of invalid) {
      expect(() => assessDomainAccuracy(value as unknown as DomainAccuracyEvidence))
        .toThrow(`DOMAIN_ACCURACY_EVIDENCE_INVALID:`);
      expect(() => assessDomainAccuracy(value as unknown as DomainAccuracyEvidence))
        .toThrow(path);
    }
  });

  it('rejects policies that could weaken the governed release contract', () => {
    const evidence = passingEvidence('interior');
    const invalidPolicies = [
      { ...DEFAULT_COMPLEX_BENCHMARK_POLICY_V2, minimumCasesPerFamily: 0 },
      { ...DEFAULT_COMPLEX_BENCHMARK_POLICY_V2, minimumAccuracy: Number.NaN },
      { ...DEFAULT_COMPLEX_BENCHMARK_POLICY_V2, minimumCoverage: 1.1 },
      { ...DEFAULT_COMPLEX_BENCHMARK_POLICY_V2, requiredGatePassRate: 0.95 },
    ];
    for (const policy of invalidPolicies) {
      expect(() => assessDomainAccuracy(evidence, policy as typeof DEFAULT_COMPLEX_BENCHMARK_POLICY_V2))
        .toThrow('DOMAIN_ACCURACY_POLICY_INVALID:');
    }
  });
});
