/**
 * domain-accuracy-validator — 캠페인 실행기의 판정 계약.
 *
 * 핵심: 정직 원칙의 기계적 강제 — 측정한 축만 pass/fail, 나머지는 not_run+사유,
 * corpus 부재·재빌드 실패는 소리내며 fail(무언의 pass 날조 불가). 해시는 후보
 * 생성기와 **같은 함수**(hashAssemblyArtifact)라 알고리즘 드리프트가 원천
 * 차단된다.
 */
import { describe, expect, it } from 'vitest';
import { validateCase } from './domain-accuracy-validator.mjs';
import { buildDomainCandidates } from './build-domain-accuracy-candidates.mjs';
import { buildDryrunCases } from './run-domain-accuracy-dryrun.mjs';
import { DOMAIN_ACCURACY_PROFILES } from '../src/lib/ai/domainAccuracyProgram';

const CIVIL_AXES = DOMAIN_ACCURACY_PROFILES.civil.requiredAxes;

function caseFor(candidate: { caseId: string; sourceHash: string; artifactHash: string }) {
  return {
    caseId: candidate.caseId,
    domain: 'civil',
    sourceHash: candidate.sourceHash,
    split: 'holdout',
    approvalReviewerIds: ['DRYRUN-virtual-reviewer-1', 'DRYRUN-virtual-reviewer-2'],
    groundTruthAssertions: CIVIL_AXES.map(axis => ({
      axis,
      tolerancePolicy: 'exact-rebuild-v1 (DRYRUN)',
      provenance: 'DRYRUN-internal-template-not-certifiable',
      artifactHashes: [candidate.artifactHash],
    })),
  };
}

describe('domain-accuracy-validator', () => {
  const candidate = buildDomainCandidates('civil', 1)[0]!;

  it('measures 4 axes on a clean rebuild and not_runs the rest with reasons', () => {
    const run = validateCase(candidate, { caseValue: caseFor(candidate), campaign: 2, repeat: 3, attempt: 1 });
    expect(run.campaign).toBe(2);
    expect(run.repeat).toBe(3);
    expect(run.usedForTuning).toBe(false);
    expect(run.requiredGatesPassed).toBe(true);
    const byAxis = new Map(run.assertions.map((item: { axis: string }) => [item.axis, item]));
    expect(byAxis.size).toBe(CIVIL_AXES.length); // 케이스 축 전량, 중복 없음
    for (const axis of ['requirements', 'dimensions', 'part_definitions', 'collision_clearance']) {
      expect(byAxis.get(axis)).toMatchObject({ status: 'pass' });
    }
    for (const axis of ['features', 'hierarchy', 'transforms', 'manufacturing', 'step_roundtrip', 'repair']) {
      expect(byAxis.get(axis)).toMatchObject({ status: 'not_run', reason: `dryrun_v1_out_of_scope:${axis}` });
    }
  });

  it('ground-truth artifact hash mismatch → dimensions fails loudly', () => {
    const tampered = { ...candidate, artifactHash: 'f'.repeat(64) };
    const run = validateCase(tampered, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 });
    const dims = run.assertions.find((item: { axis: string }) => item.axis === 'dimensions');
    expect(dims).toMatchObject({ status: 'fail' });
    expect(run.requiredGatesPassed).toBe(false);
  });

  it('missing corpus entry → measured axes all fail, never silently pass', () => {
    const run = validateCase(undefined, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 });
    for (const axis of ['requirements', 'dimensions', 'part_definitions', 'collision_clearance']) {
      expect(run.assertions.find((item: { axis: string }) => item.axis === axis)).toMatchObject({ status: 'fail' });
    }
    expect(run.requiredGatesPassed).toBe(false);
  });
});

describe('run-domain-accuracy-dryrun case builder', () => {
  it('emits DRYRUN-labeled holdout cases with complete ground-truth axes', () => {
    const candidates = buildDomainCandidates('civil', 2);
    const cases = buildDryrunCases(candidates, CIVIL_AXES);
    expect(cases).toHaveLength(2);
    for (const [index, item] of cases.entries()) {
      expect(item.caseId).toBe(`dryrun-${candidates[index]!.caseId}`);
      expect(item.split).toBe('holdout');
      // 가상 리뷰어는 이름에서부터 드릴임이 드러나야 한다
      expect(item.approvalReviewerIds.every((id: string) => id.startsWith('DRYRUN-'))).toBe(true);
      expect(item.groundTruthAssertions.map((truth: { axis: string }) => truth.axis)).toEqual([...CIVIL_AXES]);
      expect(item.groundTruthAssertions.every(
        (truth: { provenance: string }) => truth.provenance.includes('DRYRUN'),
      )).toBe(true);
    }
  });
});
