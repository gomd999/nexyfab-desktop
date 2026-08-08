/**
 * M-C4 잠금해제 경로 증명(260808e) — "실제 홀드아웃+리뷰어 2인이 도착하는
 * 순간 인증이 실제로 열리는가"를 코드로 고정한다. 여기서 쓰는 후보는 스키마
 * 완전성 검증용 픽스처(TEST- 접두)일 뿐 실측정에 쓰이지 않는다 — 인증 수치는
 * 오직 실소스·실리뷰어에서만 나온다(이 파일이 그 관문의 열림/닫힘을 증명).
 *
 * 검증 체인: public-standard 후보(권리+GT 완비) → 검수 콘솔 세션 2인 →
 * promote **scoreEligible=true + benchmarkCase 방출** → evidence 계층이
 * 케이스를 유효로 수용(approvedCases=1) — 전 구간 실호출.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildReviewPacket } from '../../../scripts/build-domain-accuracy-review-packets';
import {
  promoteDomainAccuracyCandidate,
  type DomainAccuracyCandidate,
  type DomainAccuracyApproval,
} from './domainAccuracyCandidate';
import { buildDomainAccuracyEvidence } from './domainAccuracyEvidence';
import { DOMAIN_ACCURACY_PROFILES } from './domainAccuracyProgram';
import { buildApprovalsFile, type ReviewPacket } from './reviewPacketSession';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const CIVIL_AXES = DOMAIN_ACCURACY_PROFILES.civil.requiredAxes;

/** 적격 스키마의 외부 소스 후보 픽스처 — 실소스 도착 시 저작 도구가 이 형태를 만든다. */
function externalCandidate(): DomainAccuracyCandidate {
  const sourceHash = sha('TEST-external-source');
  const artifactHash = sha('TEST-generated-artifact');
  return {
    schema: 'nexyfab.domain-accuracy-candidate.v1',
    caseId: 'TEST-civil-retaining-wall-ext-01',
    domain: 'civil',
    sourceHash,
    sourceKind: 'public-standard',
    sourceRights: {
      basis: 'public-license',
      reference: 'TEST — 공공누리 제1유형 표준도(실소스 도착 시 실제 출처·조항으로 대체)',
      benchmarkingAllowed: true,
    },
    artifactHash,
    artifactSummary: {
      name: 'TEST retaining wall', partCount: 2, pipeCount: 0,
      roles: ['base', 'wall'], alignmentErrors: [], unverifiedPartCount: 0,
    },
    groundTruthAssertions: CIVIL_AXES.map(axis => ({
      axis,
      tolerancePolicy: '±1mm(치수)/전수(개수) — 실소스 공차정책으로 대체',
      provenance: 'authoritative-cad',
      artifactHashes: [artifactHash],
    })),
    split: 'candidate',
  };
}

describe('certification unlock path (M-C4)', () => {
  const candidate = externalCandidate();
  const packet = buildReviewPacket(candidate) as unknown as ReviewPacket;

  it('a rights-cleared external candidate is score-ready for review (no gate issues)', () => {
    expect(packet.scoreReadyForReview).toBe(true);
    expect(packet.issues).toEqual([]);
  });

  it('two console sessions → promote OPENS: scoreEligible=true + benchmarkCase emitted', () => {
    const decisions = new Map([[packet.caseId, { decision: 'approve' as const, checklistConfirmed: true }]]);
    const a = buildApprovalsFile([packet], decisions, 'reviewer-A', '2026-08-08T10:00:00.000Z').file!;
    const b = buildApprovalsFile([packet], decisions, 'reviewer-B', '2026-08-08T11:00:00.000Z').file!;
    const promotion = promoteDomainAccuracyCandidate(candidate, [...a.approvals, ...b.approvals] as DomainAccuracyApproval[]);
    expect(promotion.status).toBe('approved');
    expect(promotion.scoreEligible).toBe(true);      // ← 내부 템플릿과의 결정적 차이
    expect(promotion.issues).toEqual([]);
    expect(promotion.benchmarkCase).toBeTruthy();
    expect(promotion.benchmarkCase!.approvalReviewerIds).toEqual(['reviewer-A', 'reviewer-B']);
    // 방출 케이스가 evidence 계층에서 유효 케이스로 수용된다(왕복 완결)
    const evidence = buildDomainAccuracyEvidence('civil', [promotion.benchmarkCase!], []);
    expect(evidence.evidence.approvedCases).toBe(1);
    expect(evidence.evidence.independentReviewers).toBe(2);
    expect(evidence.issues.filter(issue => issue.startsWith('case_'))).toEqual([]);
  });

  it('the gate stays shut without rights or with a single reviewer (no shortcut)', () => {
    const noRights = { ...candidate, sourceRights: undefined };
    expect(buildReviewPacket(noRights).issues).toContain('benchmark_rights_required');
    const decisions = new Map([[packet.caseId, { decision: 'approve' as const, checklistConfirmed: true }]]);
    const single = buildApprovalsFile([packet], decisions, 'reviewer-A', '2026-08-08T10:00:00.000Z').file!;
    const promotion = promoteDomainAccuracyCandidate(candidate, single.approvals as DomainAccuracyApproval[]);
    expect(promotion.scoreEligible).toBe(false);
    expect(promotion.issues.join(',')).toContain('dual_approval_missing');
  });
});
