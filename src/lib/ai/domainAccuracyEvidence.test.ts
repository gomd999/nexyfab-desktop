import { describe, expect, it } from 'vitest';
import { DOMAIN_ACCURACY_DOMAINS, DOMAIN_ACCURACY_PROFILES, type DomainAccuracyDomain } from './domainAccuracyProgram';
import { buildDomainAccuracyEvidence, type DomainAccuracyCase, type DomainAccuracyRun } from './domainAccuracyEvidence';

const hash = (value: number) => value.toString(16).padStart(64, '0');

function campaign(domain: DomainAccuracyDomain) {
  const cases: DomainAccuracyCase[] = Array.from({ length: 20 }, (_, index) => ({
    caseId: `${domain}-${index + 1}`,
    domain,
    sourceHash: hash(index + 1),
    split: 'holdout',
    approvalReviewerIds: [`${domain}-reviewer-a`, `${domain}-reviewer-b`],
    groundTruthAssertions: DOMAIN_ACCURACY_PROFILES[domain].requiredAxes.map((axis, axisIndex) => ({
      axis, tolerancePolicy: 'exact-or-reviewed-domain-tolerance', provenance: 'independent-expert-review', artifactHashes: [hash(1000 + index * 20 + axisIndex)],
    })),
  }));
  const runs: DomainAccuracyRun[] = cases.flatMap(item =>
    Array.from({ length: 3 }, (_, campaignIndex) =>
      Array.from({ length: 5 }, (_, repeatIndex) => ({
        caseId: item.caseId,
        domain,
        campaign: campaignIndex + 1,
        repeat: repeatIndex + 1,
        usedForTuning: false as const,
        sourceHash: item.sourceHash,
        requiredGatesPassed: true,
        falseVerified: false,
        falseClear: false,
        destructivePartMerge: false,
        assertions: DOMAIN_ACCURACY_PROFILES[domain].requiredAxes.map(axis => ({ axis, status: 'pass' as const, reason: 'measured by domain validator' })),
      })),
    ).flat(),
  );
  return { cases, runs };
}

describe('domain accuracy evidence adapter', () => {
  it.each(DOMAIN_ACCURACY_DOMAINS)('%s aggregates a complete 300-run campaign', domain => {
    const input = campaign(domain);
    const result = buildDomainAccuracyEvidence(domain, input.cases, input.runs);
    expect(result).toMatchObject({
      issues: [],
      evidence: { approvedCases: 20, campaigns: 3, minimumRepeatsPerCase: 15, minimumRepeatsPerCampaign: 5, requiredGateRuns: 300 },
      assessment: { eligible: true, blockers: [] },
    });
  });

  it('does not score an unapproved case or its runs', () => {
    const input = campaign('civil');
    input.cases[0] = { ...input.cases[0]!, approvalReviewerIds: ['same-reviewer'] };
    const result = buildDomainAccuracyEvidence('civil', input.cases, input.runs);
    expect(result.evidence).toMatchObject({ approvedCases: 19, requiredGateRuns: 285 });
    expect(result.issues).toEqual(expect.arrayContaining([
      'case_approval_incomplete:civil-1',
      'run_case_not_approved:civil-1:1:1',
    ]));
    expect(result.assessment).toMatchObject({ eligible: false, blockers: expect.arrayContaining(['evidence_integrity']) });
  });

  it('turns not_run into missing coverage rather than a pass', () => {
    const input = campaign('interior');
    for (const run of input.runs.slice(0, 16)) {
      run.assertions = run.assertions.map(item => item.axis === 'door_swing'
        ? { ...item, status: 'not_run', reason: 'door operation geometry missing' }
        : item);
    }
    const result = buildDomainAccuracyEvidence('interior', input.cases, input.runs);
    const metric = result.assessment.axes.find(item => item.axis === 'door_swing');
    expect(metric).toMatchObject({ expected: 300, measured: 284, passed: 284 });
    expect(result.assessment.blockers).toContain('coverage:door_swing');
  });

  it('rejects duplicate runs and out-of-scope assertions', () => {
    const input = campaign('civil');
    input.runs.push({
      ...input.runs[0]!,
      assertions: [...input.runs[0]!.assertions, { axis: 'joints', status: 'pass', reason: 'not a civil release axis' }],
    });
    const result = buildDomainAccuracyEvidence('civil', input.cases, input.runs);
    expect(result.issues).toEqual(expect.arrayContaining([
      'run_duplicate:civil-1:1:1',
      'run_axis_out_of_scope:civil-1:1:1:joints',
    ]));
    expect(result.assessment.eligible).toBe(false);
  });

  it('requires five repeats inside every campaign instead of only fifteen total', () => {
    const input = campaign('mechanical');
    input.runs = input.runs.filter(run => !(
      run.caseId === 'mechanical-1' && run.campaign === 3 && run.repeat > 1
    ));
    input.runs.push(...Array.from({ length: 4 }, (_, index) => ({
      ...input.runs.find(run => run.caseId === 'mechanical-1' && run.campaign === 1)!,
      repeat: index + 6,
    })));
    const result = buildDomainAccuracyEvidence('mechanical', input.cases, input.runs);
    expect(result.evidence).toMatchObject({
      campaigns: 3,
      minimumRepeatsPerCase: 15,
      minimumRepeatsPerCampaign: 1,
    });
    expect(result.assessment.blockers).toContain('campaign_repeats:1/5');
  });

  it('rejects runs against changed sources and cases without hashed ground truth', () => {
    const input = campaign('civil');
    input.runs[0] = { ...input.runs[0]!, sourceHash: hash(9999) };
    input.cases[1] = { ...input.cases[1]!, groundTruthAssertions: [] };
    const result = buildDomainAccuracyEvidence('civil', input.cases, input.runs);
    expect(result.issues).toEqual(expect.arrayContaining([
      'run_source_hash_mismatch:civil-1:1:1',
      'case_ground_truth_incomplete:civil-2',
    ]));
    expect(result.assessment.eligible).toBe(false);
  });
});
