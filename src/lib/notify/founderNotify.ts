/**
 * founderNotify.ts — Solo-founder funnel alerts for Phase-1 fake-door.
 *
 * Phase-1 (M1) is hand-operated: no automated escrow, no auto-quote.
 * Every signal of intent (RFQ submission, Pro signup, payment attempt)
 * needs to reach the founder in real time so they can follow up
 * within hours.
 *
 * Wraps `sendOpsAlert` rather than duplicating Slack/email plumbing.
 * The three kinds map 1:1 to the funnel stages tracked in the M3 KPI
 * gate (Pro 5명 / 응답률 3% / 발주의향 2명) — count each kind to
 * decide whether to greenlight M4 automation.
 */

import { sendOpsAlert, type AlertSeverity } from './opsAlert';

export type FounderAlertKind =
  | 'reservation'       // 결제 시도 (escrow disabled → 'reserved_awaiting_manager')
  | 'pro_signup'        // Pro plan 카드 결제 완료
  | 'rfq_inquiry'       // RFQ 작성됨 (결제 전, manager 검토 요청)
  | 'cold_email_reply'; // Cold email 응답 인입 (Mixmax webhook → 이 hook)

const KIND_LABEL: Record<FounderAlertKind, string> = {
  reservation:      '주문 예약 (담당자 협상 요청)',
  pro_signup:       'Pro 플랜 가입',
  rfq_inquiry:      'RFQ 문의',
  cold_email_reply: 'Cold email 응답',
};

const KIND_SEVERITY: Record<FounderAlertKind, AlertSeverity> = {
  reservation:      'warning',  // 24h 응답 약속 → 빠른 처리 필요
  pro_signup:       'info',
  rfq_inquiry:      'info',
  cold_email_reply: 'info',
};

export interface FounderNotifyPayload {
  kind: FounderAlertKind;
  orderId?: string;
  quoteId?: string;
  customerId?: string;
  customerEmail?: string;
  amountKrw?: number;
  note?: string;
}

/** Fire-and-forget. Caller awaits only if it needs to know channel result. */
export async function notifyFounder(payload: FounderNotifyPayload): Promise<void> {
  const label = KIND_LABEL[payload.kind];
  const severity = KIND_SEVERITY[payload.kind];

  const bodyLines: string[] = [];
  if (payload.customerEmail) bodyLines.push(`고객: ${payload.customerEmail}`);
  if (payload.amountKrw != null) bodyLines.push(`금액: ${payload.amountKrw.toLocaleString('ko-KR')} KRW`);
  if (payload.note) bodyLines.push(payload.note);

  const context: Record<string, string | number> = {};
  if (payload.orderId)    context.orderId = payload.orderId;
  if (payload.quoteId)    context.quoteId = payload.quoteId;
  if (payload.customerId) context.customerId = payload.customerId;

  try {
    await sendOpsAlert({
      severity,
      title: `[NexyFab] ${label}`,
      bodyLines: bodyLines.length > 0 ? bodyLines : ['(추가 정보 없음)'],
      context,
      source: `founder-notify:${payload.kind}`,
    });
  } catch (err) {
    // Never block the funnel on alert failure. Log only.
    console.warn('[founderNotify] alert dispatch failed:', err);
  }
}
