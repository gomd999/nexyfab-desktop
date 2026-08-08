/**
 * reviewPacketSession — B-7/E3(260808d): 리뷰어 검수 세션의 순수 코어.
 *
 * 입력=검토 패킷 파일(build-domain-accuracy-review-packets 출력), 출력=승인
 * 레코드 파일(promote-domain-accuracy-candidates 입력) — CLI 파이프라인의
 * 정확한 중간을 UI 로 메운다. 서명 대상 해시(signedTarget)는 패킷이 이미
 * 계산해 왔으므로 이 모듈은 **재계산하지 않고 그대로 서명**한다(리뷰어가
 * 보는 것과 서명하는 것의 일치 — 재계산하면 표류 여지가 생긴다).
 *
 * 정직 규칙: scoreReadyForReview=false(내부 템플릿·권리/GT 결손) 패킷도
 * 검수 연습(드릴)은 허용하되 산출 파일에 경고 목록을 동봉하고, 승격 계층이
 * 최종 거부권을 갖는다(이 도구는 방출 초크가 아니다 — promote 가 초크).
 */

export interface ReviewPacket {
  schema: string;
  caseId: string;
  domain: string;
  scoreReadyForReview: boolean;
  issues: string[];
  signedTarget: { sourceHash: string; artifactHash: string; groundTruthHash: string };
  sourceRights: { benchmarkingAllowed?: boolean; reference?: string } | null;
  assertions: ReadonlyArray<{ axis: string; tolerancePolicy?: string; provenance?: string }>;
  checklist: string[];
  approvalTemplate: {
    schema: 'nexyfab.domain-accuracy-approval.v1';
    caseId: string;
    sourceHash: string;
    artifactHash: string;
    groundTruthHash: string;
    reviewerId: string;
    reviewedAt: string;
    decision: 'approve' | 'reject';
    independent: boolean;
  };
}

export interface ReviewDecision {
  decision: 'approve' | 'reject';
  /** 리뷰어가 체크리스트 전 항목을 확인했는가(승인 전 필수). */
  checklistConfirmed: boolean;
  note?: string;
}

export function parsePacketsFile(raw: string): { packets: ReviewPacket[]; error?: string } {
  try {
    const parsed = JSON.parse(raw) as { packets?: unknown } | unknown[];
    const list = Array.isArray(parsed) ? parsed : (parsed as { packets?: unknown }).packets;
    if (!Array.isArray(list) || list.length === 0) return { packets: [], error: 'packets[] 가 비어있거나 없음' };
    for (const item of list as ReviewPacket[]) {
      if (!item?.caseId || !item?.signedTarget?.groundTruthHash === undefined || !item?.approvalTemplate) {
        return { packets: [], error: `패킷 형식 불일치: ${JSON.stringify(item)?.slice(0, 80)}` };
      }
    }
    return { packets: list as ReviewPacket[] };
  } catch (error) {
    return { packets: [], error: `JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 결정 1건 → 승인 레코드. 승인은 체크리스트 확인이 선행돼야 한다(거부는 즉시 가능). */
export function buildApproval(
  packet: ReviewPacket,
  reviewerId: string,
  decision: ReviewDecision,
  reviewedAt: string,
): { approval?: ReviewPacket['approvalTemplate']; error?: string } {
  if (!reviewerId.trim()) return { error: 'reviewerId 필요' };
  if (!Number.isFinite(Date.parse(reviewedAt))) return { error: 'reviewedAt 형식 오류' };
  if (decision.decision === 'approve' && !decision.checklistConfirmed) {
    return { error: '승인 전 체크리스트 전 항목 확인 필요' };
  }
  return {
    approval: {
      ...packet.approvalTemplate,
      reviewerId: reviewerId.trim(),
      reviewedAt,
      decision: decision.decision,
      independent: true,
    },
  };
}

export interface ApprovalsFile {
  schema: 'nexyfab.domain-accuracy-approvals-session.v1';
  reviewerId: string;
  exportedAt: string;
  /** promote CLI 가 그대로 소비하는 배열(파일의 `approvals` 만 넘겨도 됨). */
  approvals: ReviewPacket['approvalTemplate'][];
  /** 정직 동봉: 인증 부적격 패킷에 내린 결정(드릴 연습 등)의 경고 목록. */
  warnings: string[];
  /** 세션 메모(케이스별 노트 — 승인 레코드 스키마 밖이라 별도 동봉). */
  notes: Record<string, string>;
}

export function buildApprovalsFile(
  packets: ReviewPacket[],
  decisions: Map<string, ReviewDecision>,
  reviewerId: string,
  exportedAt: string,
): { file?: ApprovalsFile; errors: string[] } {
  const errors: string[] = [];
  const approvals: ReviewPacket['approvalTemplate'][] = [];
  const warnings: string[] = [];
  const notes: Record<string, string> = {};
  for (const packet of packets) {
    const decision = decisions.get(packet.caseId);
    if (!decision) continue; // 미결정 케이스는 산출에서 제외(부분 세션 허용)
    const built = buildApproval(packet, reviewerId, decision, exportedAt);
    if (built.error) { errors.push(`${packet.caseId}: ${built.error}`); continue; }
    approvals.push(built.approval!);
    if (!packet.scoreReadyForReview) {
      warnings.push(`${packet.caseId}: 인증 부적격 패킷에 대한 결정(${decision.decision}) — ${packet.issues.join(', ')}`);
    }
    if (decision.note?.trim()) notes[packet.caseId] = decision.note.trim();
  }
  if (errors.length) return { errors };
  if (approvals.length === 0) return { errors: ['결정된 케이스가 없음'] };
  return {
    file: {
      schema: 'nexyfab.domain-accuracy-approvals-session.v1',
      reviewerId: reviewerId.trim(),
      exportedAt,
      approvals,
      warnings,
      notes,
    },
    errors: [],
  };
}
