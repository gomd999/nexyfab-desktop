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

  it('measures 5 axes on a clean rebuild (W1-3: +transforms) and not_runs the rest with honest reasons', async () => {
    const run = await validateCase(candidate, { caseValue: caseFor(candidate), campaign: 2, repeat: 3, attempt: 1 });
    expect(run.campaign).toBe(2);
    expect(run.repeat).toBe(3);
    expect(run.usedForTuning).toBe(false);
    expect(run.requiredGatesPassed).toBe(true);
    const byAxis = new Map(run.assertions.map((item: { axis: string }) => [item.axis, item]));
    expect(byAxis.size).toBe(CIVIL_AXES.length); // 케이스 축 전량, 중복 없음
    for (const axis of ['requirements', 'dimensions', 'part_definitions', 'collision_clearance', 'transforms']) {
      expect(byAxis.get(axis)).toMatchObject({ status: 'pass' });
    }
    // W1-3 — 측정 대상이 자명하게 없는 축은 사유 있는 not_run(0==0 부풀리기 금지)
    expect(byAxis.get('features')).toMatchObject({ status: 'not_run', reason: 'no_feature_vocabulary_in_template' });
    expect(byAxis.get('hierarchy')).toMatchObject({ status: 'not_run', reason: 'template_without_hierarchy' });
    for (const axis of ['manufacturing', 'repair']) {
      expect(byAxis.get(axis)).toMatchObject({ status: 'not_run', reason: `dryrun_v1_out_of_scope:${axis}` });
    }
  });

  it('ground-truth artifact hash mismatch → dimensions fails loudly', async () => {
    const tampered = { ...candidate, artifactHash: 'f'.repeat(64) };
    const run = await validateCase(tampered, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 });
    const dims = run.assertions.find((item: { axis: string }) => item.axis === 'dimensions');
    expect(dims).toMatchObject({ status: 'fail' });
    expect(run.requiredGatesPassed).toBe(false);
  });

  it('missing corpus entry → measured axes all fail, never silently pass', async () => {
    const run = await validateCase(undefined, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 });
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

describe('W1-1: AI-subject mode', () => {
  const candidate = buildDomainCandidates('civil', 1)[0]!;
  const byAxis = (run: { assertions: Array<{ axis: string; status: string; reason: string }> }) =>
    new Map(run.assertions.map(item => [item.axis, item]));

  it('judges via the injected generator: requirements/part_defs/collision measured, dimensions honestly not_run', async () => {
    const generate = async () => ({
      assembly: {
        parts: Array.from({ length: candidate.artifactSummary.partCount }, (_v, i) => ({
          id: `p${i}`, role: candidate.artifactSummary.roles[i % candidate.artifactSummary.roles.length],
        })),
        alignmentErrors: [],
      },
      gateErrors: [], dropped: [], allFailed: false,
    });
    const run = await validateCase({ ...candidate, sourceSpec: '옹벽 3m' }, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 }, { subject: 'ai', generate });
    const axes = byAxis(run);
    expect(axes.get('requirements')).toMatchObject({ status: 'pass' });
    expect(axes.get('part_definitions')).toMatchObject({ status: 'pass' });
    expect(axes.get('collision_clearance')).toMatchObject({ status: 'pass' });
    expect(axes.get('dimensions')).toMatchObject({ status: 'not_run', reason: 'ai_subject_dimension_gt_requires_holdout_assertions' });
  });

  it('missing sourceSpec → loud fail, never a fabricated generation', async () => {
    const run = await validateCase(candidate, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 }, { subject: 'ai', generate: async () => { throw new Error('must not be called'); } });
    expect(byAxis(run).get('requirements')).toMatchObject({ status: 'fail' });
    expect(byAxis(run).get('requirements')!.reason).toContain('source_spec_missing');
    expect(run.requiredGatesPassed).toBe(false);
  });

  it('degraded generation (dropped parts) fails requirements — no silent acceptance', async () => {
    const generate = async () => ({
      assembly: { parts: [{ id: 'p0', role: 'wall' }], alignmentErrors: [] },
      gateErrors: [], dropped: ['p1'], allFailed: false, degraded: true,
    });
    const run = await validateCase({ ...candidate, sourceSpec: '옹벽 3m' }, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 }, { subject: 'ai', generate });
    expect(byAxis(run).get('requirements')).toMatchObject({ status: 'fail' });
  });
});

describe('W1-2: step_roundtrip axis', () => {
  const candidate = buildDomainCandidates('civil', 1)[0]!;
  const axisOf = (run: { assertions: Array<{ axis: string; status: string; reason: string }> }, axis: string) =>
    run.assertions.find(item => item.axis === axis)!;

  it('opt-in roundtrip measures the axis with a real STEP emit+reimport', async () => {
    const run = await validateCase(candidate, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 }, { roundtrip: true });
    const rt = axisOf(run, 'step_roundtrip');
    expect(rt.status).toBe('pass');
    expect(rt.reason).toContain('reimport_ok_volume_');
  }, 120_000);

  it('default (no flag) keeps the axis honestly not_run', async () => {
    const run = await validateCase(candidate, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 });
    expect(axisOf(run, 'step_roundtrip')).toMatchObject({ status: 'not_run' });
  });
});

describe('W1-4: repair axis (defect-injection drill)', () => {
  const candidate = buildDomainCandidates('civil', 1)[0]!;
  const axisOf = (run: { assertions: Array<{ axis: string; status: string; reason: string }> }, axis: string) =>
    run.assertions.find(item => item.axis === axis)!;

  it('injected overlap (tx/ty/tz convention) is detected — repair pass, falseClear stays 0', async () => {
    const run = await validateCase(candidate, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 }, { repair: true });
    expect(axisOf(run, 'repair')).toMatchObject({ status: 'pass' });
    expect(axisOf(run, 'repair').reason).toContain('injected_overlap_detected');
    expect(run.falseClear).toBe(false);
  });

  it('default (no flag) keeps repair honestly not_run', async () => {
    const run = await validateCase(candidate, { caseValue: caseFor(candidate), campaign: 1, repeat: 1, attempt: 1 });
    expect(axisOf(run, 'repair')).toMatchObject({ status: 'not_run' });
  });
});
