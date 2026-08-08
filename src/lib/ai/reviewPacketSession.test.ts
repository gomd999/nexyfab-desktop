/**
 * B-7/E3 — 검수 세션 왕복 계약: 패킷 파일→결정→승인 파일이 promote 계층의
 * 이중 승인 검증을 **실제로 통과**해야 한다(형식 흉내가 아니라 실왕복).
 * 승인 전 체크리스트 강제·부적격 패킷 경고 동봉·서명 해시 무재계산도 핀.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { buildReviewPacket } from '../../../scripts/build-domain-accuracy-review-packets';
import { promoteDomainAccuracyCandidate, type DomainAccuracyCandidate, type DomainAccuracyApproval } from './domainAccuracyCandidate';
import { parsePacketsFile, buildApproval, buildApprovalsFile, type ReviewPacket } from './reviewPacketSession';

function drillCandidate(): DomainAccuracyCandidate {
  const raw = execFileSync(process.execPath, ['scripts/build-domain-accuracy-candidates.mjs', '--domain', 'civil', '--count', '1'], { encoding: 'utf8', cwd: process.cwd() });
  return (JSON.parse(raw) as DomainAccuracyCandidate[])[0]!;
}

describe('reviewPacketSession (B-7/E3)', () => {
  const candidate = drillCandidate();
  const packet = buildReviewPacket(candidate) as unknown as ReviewPacket;

  it('round-trips packet → decisions → approvals that promote accepts as dual approval', () => {
    const decisions = new Map([[packet.caseId, { decision: 'approve' as const, checklistConfirmed: true, note: '드릴' }]]);
    const r1 = buildApprovalsFile([packet], decisions, 'reviewer-A', '2026-08-08T10:00:00.000Z');
    const r2 = buildApprovalsFile([packet], decisions, 'reviewer-B', '2026-08-08T11:00:00.000Z');
    expect(r1.errors).toEqual([]);
    expect(r2.errors).toEqual([]);
    const approvals = [...r1.file!.approvals, ...r2.file!.approvals] as DomainAccuracyApproval[];
    const promotion = promoteDomainAccuracyCandidate(candidate, approvals);
    // 이중 승인 성립(dual_approval_missing 없어야) — 내부 템플릿이라 scoreEligible=false 는 설계
    expect(promotion.issues.join(',')).not.toContain('dual_approval_missing');
    expect(promotion.issues.join(',')).not.toContain('hash_mismatch');
    expect(promotion.status).toBe('approved');
    expect(promotion.scoreEligible).toBe(false); // 방출 초크는 promote — 도구가 아님
    // 부적격 패킷 결정엔 경고 동봉(정직)
    expect(r1.file!.warnings.length).toBeGreaterThan(0);
    expect(r1.file!.notes[packet.caseId]).toBe('드릴');
  });

  it('approve requires checklist confirmation; reject does not', () => {
    expect(buildApproval(packet, 'reviewer-A', { decision: 'approve', checklistConfirmed: false }, '2026-08-08T10:00:00.000Z').error)
      .toContain('체크리스트');
    expect(buildApproval(packet, 'reviewer-A', { decision: 'reject', checklistConfirmed: false }, '2026-08-08T10:00:00.000Z').approval?.decision)
      .toBe('reject');
  });

  it('signs the packet hashes verbatim (no recomputation drift)', () => {
    const built = buildApproval(packet, 'reviewer-A', { decision: 'approve', checklistConfirmed: true }, '2026-08-08T10:00:00.000Z').approval!;
    expect(built.groundTruthHash).toBe(packet.signedTarget.groundTruthHash);
    expect(built.sourceHash).toBe(packet.signedTarget.sourceHash);
    expect(built.artifactHash).toBe(packet.signedTarget.artifactHash);
  });

  it('parsePacketsFile accepts both bare arrays and {packets} envelopes, rejects garbage', () => {
    expect(parsePacketsFile(JSON.stringify({ packets: [packet] })).packets).toHaveLength(1);
    expect(parsePacketsFile(JSON.stringify([packet])).packets).toHaveLength(1);
    expect(parsePacketsFile('not json').error).toBeTruthy();
    expect(parsePacketsFile('{}').error).toBeTruthy();
  });
});
