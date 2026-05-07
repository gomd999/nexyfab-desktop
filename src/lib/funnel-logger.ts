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
  | 'bundle_create_intent';  // 번들링 의도

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
