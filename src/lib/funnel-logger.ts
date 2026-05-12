/**
 * funnel-logger.ts — 결제 전 의도성 행동 기록기.
 *
 * Stage(결제 기반) 와 의도적으로 분리된 레이어. computeStage 는 이 데이터를
 * 절대 참조하지 않는다. 사용처:
 *   - admin/stage-overview 의 Funnel Insights 섹션 (DFM→매칭 전환율 등)
 *   - #7 AI 매칭 엔진의 "고의도 유저" 사전 필터
 *   - 추후 코호트 분석 / 광고 카피 튜닝
 *
 * Append-only. 실패 시 swallow — 마케팅 시그널이 사용자 플로우를
 * 절대 막지 않는다.
 */

import { getDbAdapter } from './db-adapter';
import { randomUUID } from 'crypto';

/**
 * 알려진 funnel 이벤트 타입. 신규 추가 시 여기에 등록하고 admin 대시보드의
 * 코호트 카드도 함께 갱신한다.
 */
export type FunnelEventType =
  | 'dfm_pass_to_match'      // DFM PASS → 매칭 페이지로 진입
  | 'dfm_request_expert'     // DFM 결과를 보고 전문가 수정 요청
  | 'dfm_revise'             // 직접 수정 후 재검증 의사
  | 'match_view'             // 매칭 페이지 진입
  | 'match_partner_select'   // 매칭 결과에서 파트너 선택
  | 'rfq_submitted'          // 매칭 의뢰서(RFQ) 제출 — DFM 컨텍스트 동반 여부는 metadata.dfmContextUsed 로 구분
  | 'bundle_create_intent'   // 번들링 의도
  // ── 온보딩/전환 깔때기 (광고 후 이탈 분석용) ──
  | 'signup_complete'                // 회원가입 완료
  | 'shape_generator_first_open'     // 가입 후 처음 3D 툴 진입
  | 'first_shape_created'            // 첫 도형 추가 (라이브러리 또는 AI)
  | 'first_save'                     // 첫 cloud save 성공
  | 'paywall_shown'                  // 2번째 프로젝트 시도 시 paywall 노출
  | 'paywall_upgrade_clicked'        // paywall에서 업그레이드 CTA 클릭
  | 'upgrade_completed'              // 결제 완료 후 tier 변경
  | 'subscription_cancelled'         // 사용자가 구독 취소 (period_end 까지는 유지)
  | 'subscription_payment_failed'    // 결제 실패 (카드 거절 등)
  | 'subscription_grace_expired'     // grace period 끝나서 자동 free 다운그레이드
  // ── 컨시어지 매칭 깔때기 (운영팀 수동 매칭 흐름) ──
  | 'concierge_recommended'          // 운영팀이 RFQ에 공장을 추천 추가
  | 'concierge_contacted'            // 운영팀이 공장에 연락 시작
  | 'concierge_factory_responded'    // 공장이 견적 작성 의사 응답
  | 'concierge_quote_received'       // 공장이 견적서 제출 (전환 신호)
  | 'concierge_partner_signup'       // 공장이 매직 링크로 NexyFab 가입
  | 'partner_invitation_viewed'      // 파트너가 invitations 페이지 진입
  | 'escrow_created'                 // 에스크로 트랜잭션 생성
  | 'escrow_released'                // 에스크로 정산 완료
  | 'escrow_disputed';               // 고객이 분쟁 신청 (V8)

export interface FunnelEventInput {
  eventType:    FunnelEventType;
  /** ex: 'dfm_check', 'rfq', 'order' — 컨텍스트 행의 종류. */
  contextType?: string;
  /** 컨텍스트 행의 PK (nf_dfm_check.id 등). */
  contextId?:   string;
  /** 보조 메타데이터(JSON 직렬화). 너무 크지 않게 유지. */
  metadata?:    Record<string, unknown>;
  /**
   * 데모 세션 ID. 비어 있으면 본 계정 funnel.
   * 데모 데이터는 user_id = 'demo-user' + session_id = 이 값으로 격리되며,
   * 가입 시 claimDemoSession 으로 본 user_id 로 일괄 이관됨.
   */
  sessionId?:   string | null;
}

export async function logFunnelEvent(
  userId: string,
  input: FunnelEventInput,
): Promise<void> {
  if (!userId || !input.eventType) return;
  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_funnel_event
       (id, user_id, event_type, context_type, context_id, metadata, created_at, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    `fnl-${randomUUID()}`,
    userId,
    input.eventType,
    input.contextType ?? null,
    input.contextId   ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    Date.now(),
    input.sessionId ?? null,
  ).catch(err => console.error('[funnel-logger]', err));
}

/**
 * Onboarding 깔때기 단계별 집계 — /admin/funnel 대시보드용.
 *
 * 사이클:
 *   signup_complete → shape_generator_first_open → first_shape_created
 *   → first_save → (paywall_shown → paywall_upgrade_clicked → upgrade_completed)
 *
 * Conversion %는 step n 의 unique user count / step n-1 의 unique user count.
 * 시간 윈도우는 호출자가 sinceMs/untilMs 로 지정한다 (기본 30일).
 */
export interface OnboardingFunnelStep {
  eventType: FunnelEventType;
  uniqueUsers: number;
  totalEvents: number;
  /** Conversion from previous step (0..1). null on the first step. */
  conversionFromPrev: number | null;
}

const ONBOARDING_STEPS: FunnelEventType[] = [
  'signup_complete',
  'shape_generator_first_open',
  'first_shape_created',
  'first_save',
  'paywall_shown',
  'paywall_upgrade_clicked',
  'upgrade_completed',
];

/**
 * Top UTM sources by signup count within a window. Drives the /admin/funnel
 * "by source" split — ad ROI math = signup_complete count grouped by
 * metadata.utm.source.
 */
export async function getTopUtmSources(opts: {
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
} = {}): Promise<Array<{ source: string; signups: number }>> {
  const since = opts.sinceMs ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
  const until = opts.untilMs ?? Date.now();
  const limit = Math.max(1, Math.min(50, opts.limit ?? 10));
  const db = getDbAdapter();
  // Pull just the metadata for signup_complete events in window — small table,
  // simple SUM-by-key-after-parse beats inventing a JSON-extract layer.
  const rows = await db
    .queryAll<{ metadata: string | null }>(
      `SELECT metadata FROM nf_funnel_event
        WHERE event_type = 'signup_complete'
          AND created_at >= ? AND created_at <= ?`,
      since, until,
    )
    .catch(() => [] as { metadata: string | null }[]);
  const byBucket = new Map<string, number>();
  for (const r of rows) {
    let source = '(direct)';
    if (r.metadata) {
      try {
        const m = JSON.parse(r.metadata) as { utm?: { source?: string } };
        const s = m?.utm?.source;
        if (typeof s === 'string' && s.trim()) source = s.trim().slice(0, 60);
      } catch { /* leave as direct */ }
    }
    byBucket.set(source, (byBucket.get(source) ?? 0) + 1);
  }
  return Array.from(byBucket.entries())
    .map(([source, signups]) => ({ source, signups }))
    .sort((a, b) => b.signups - a.signups)
    .slice(0, limit);
}

/**
 * Per-source onboarding funnel — same 7 steps as getOnboardingFunnel but
 * filtered to users whose signup_complete event was tagged with the given
 * UTM source.
 *
 * Why we attach to signup_complete instead of every event:
 *   - First-touch attribution: the source that brought the user in stays
 *     constant. Tagging downstream events too (paywall_shown, etc.) with
 *     UTM would double-count if we ever introduced last-touch logic later.
 *   - signup_complete already carries metadata.utm.source from the signup
 *     route, so the join target is well-defined.
 *
 * Implementation: pull the user_id list whose signup row matches the source,
 * then count events of each step type whose user_id is in that set. Two
 * round-trips, both indexed.
 */
export async function getOnboardingFunnelBySource(
  source: string,
  opts: { sinceMs?: number; untilMs?: number } = {},
): Promise<OnboardingFunnelStep[]> {
  const since = opts.sinceMs ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
  const until = opts.untilMs ?? Date.now();
  const db = getDbAdapter();

  // Step 1 — find signup_complete rows matching the source (or '(direct)' for null UTM).
  const isDirect = source === '(direct)' || source.trim() === '';
  const signups = await db
    .queryAll<{ user_id: string; metadata: string | null }>(
      `SELECT user_id, metadata FROM nf_funnel_event
        WHERE event_type = 'signup_complete'
          AND created_at >= ? AND created_at <= ?`,
      since, until,
    )
    .catch(() => [] as { user_id: string; metadata: string | null }[]);

  const userIds = new Set<string>();
  for (const r of signups) {
    let s = '';
    if (r.metadata) {
      try {
        const m = JSON.parse(r.metadata) as { utm?: { source?: string } };
        s = (m?.utm?.source ?? '').trim();
      } catch { /* treat as direct */ }
    }
    if (isDirect ? !s : s === source) userIds.add(r.user_id);
  }

  if (userIds.size === 0) {
    // Empty cohort — return zero rows for every step, prev=null on first.
    return ONBOARDING_STEPS.map((eventType, i) => ({
      eventType, uniqueUsers: 0, totalEvents: 0,
      conversionFromPrev: i === 0 ? null : 0,
    }));
  }

  // Step 2 — count events per step type, restricted to this cohort.
  // SQLite doesn't support array params directly; we build an IN list. The
  // cohort size is bounded (per-source signups in window), so this is safe.
  const ids = Array.from(userIds);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db
    .queryAll<{ event_type: string; unique_users: number; total_events: number }>(
      `SELECT event_type,
              COUNT(DISTINCT user_id) AS unique_users,
              COUNT(*)                AS total_events
         FROM nf_funnel_event
        WHERE created_at >= ? AND created_at <= ?
          AND user_id IN (${placeholders})
        GROUP BY event_type`,
      since, until, ...ids,
    )
    .catch(() => [] as { event_type: string; unique_users: number; total_events: number }[]);

  const byType = new Map(rows.map(r => [r.event_type, r]));
  const out: OnboardingFunnelStep[] = [];
  let prev: number | null = null;
  for (const step of ONBOARDING_STEPS) {
    const r = byType.get(step);
    const uniq = r ? Number(r.unique_users) : 0;
    const total = r ? Number(r.total_events) : 0;
    const conv = prev === null ? null : prev === 0 ? 0 : uniq / prev;
    out.push({ eventType: step, uniqueUsers: uniq, totalEvents: total, conversionFromPrev: conv });
    prev = uniq;
  }
  return out;
}

export async function getOnboardingFunnel(opts: {
  sinceMs?: number;
  untilMs?: number;
} = {}): Promise<OnboardingFunnelStep[]> {
  const since = opts.sinceMs ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
  const until = opts.untilMs ?? Date.now();
  const db = getDbAdapter();
  const rows = await db
    .queryAll<{ event_type: string; unique_users: number; total_events: number }>(
      `SELECT event_type,
              COUNT(DISTINCT user_id) AS unique_users,
              COUNT(*)                AS total_events
         FROM nf_funnel_event
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY event_type`,
      since, until,
    )
    .catch(() => [] as { event_type: string; unique_users: number; total_events: number }[]);

  const byType = new Map(rows.map(r => [r.event_type, r]));
  const out: OnboardingFunnelStep[] = [];
  let prev: number | null = null;
  for (const step of ONBOARDING_STEPS) {
    const r = byType.get(step);
    const uniq = r ? Number(r.unique_users) : 0;
    const total = r ? Number(r.total_events) : 0;
    const conv = prev === null ? null : prev === 0 ? 0 : uniq / prev;
    out.push({ eventType: step, uniqueUsers: uniq, totalEvents: total, conversionFromPrev: conv });
    prev = uniq;
  }
  return out;
}
