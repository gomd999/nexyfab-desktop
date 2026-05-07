/**
 * stage-worker.ts — nf_stage_event 아웃박스 처리 워커.
 *
 * 동작 순서:
 *   1. processed_at IS NULL && retry_count < MAX_RETRIES 인 이벤트를
 *      occurred_at ASC로 N건 픽업
 *   2. 각 이벤트에 대해 dispatchStageNotification 호출
 *   3. 성공: processed_at = now, last_error = NULL
 *   4. 실패: retry_count++, last_error 기록, processed_at은 NULL 유지
 *           → 다음 워커 사이클에 다시 시도됨
 *   5. retry_count == MAX_RETRIES 도달: 더 이상 안 잡히고 dead-letter로 남음
 *      (운영자가 admin overview에서 확인 후 수동 재시도/포기 결정)
 *
 * 호출 경로:
 *   - 운영용: POST /api/admin/stage-worker (수동 트리거, 추후 Railway cron)
 *   - 테스트: 단위 테스트가 직접 processStageEvents 호출
 *
 * UI 노출과의 정렬: 클라이언트는 `bm-matrix-stage-ui` + `mergePlanLimitsWithBmStage`
 * (`BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS`). 워커는 DB 아웃박스·이메일만 처리한다 — **클라이언트 uiStore에 직접 쓰지 않음**(G-U3).
 * 세션의 `nexyfabStage`는 `/api/auth/session`·`/api/auth/refresh`·JWT 갱신 경로로 반영되며,
 * 알림 링크 후 재방문·hydrator가 최신 Stage를 태운다(실시간 푸시 플래그는 비목표).
 *
 * 동시 실행 안전성: SELECT … LIMIT 으로 픽업한 직후 retry_count++ UPDATE를
 * 먼저 수행해 같은 이벤트가 두 워커에 중복 픽업되어도 한 쪽은 실패한다.
 * (정확한 한 번 보장이 아니라 "in-flight 표시" 수준 — 단일 워커 가정.)
 */

import { getDbAdapter } from './db-adapter';
import { dispatchStageNotification, type NotificationTarget } from './stage-notifications';
import type { Stage } from './stage-engine';

const MAX_RETRIES = 5;

interface StageEventRow {
  id:           string;
  user_id:      string;
  from_stage:   Stage;
  to_stage:     Stage;
  trigger_type: string;
  trigger_value: string | null;
  occurred_at:  number;
  retry_count:  number;
}

interface UserRow {
  id:                   string;
  email:                string;
  name:                 string;
  cumulative_order_krw: number;
}

export interface ProcessOptions {
  /** 한 번에 처리할 최대 이벤트 수. 기본 50. */
  limit?: number;
  /** 알림 링크 절대 URL의 기준. 기본 https://nexyfab.com */
  baseUrl?: string;
}

export interface ProcessResult {
  scanned:    number;
  delivered:  number;
  skipped:    number;
  failed:     number;
  /** 처리한 이벤트 ID (감사 로그/디버깅용). */
  eventIds:   string[];
}

/**
 * Stage→업셀 페이지 매핑. 정의되지 않은 Stage는 메인 대시보드로 떨어뜨림.
 * 실제 라우트가 추가되면 여기만 갱신.
 */
function upsellLinkFor(stage: Stage, baseUrl: string): string {
  const path: Record<Stage, string> = {
    A: '/dashboard',
    B: '/checkout',
    C: '/orders/bundle',
    D: '/dashboard/insights',
    E: '/contact?topic=enterprise',
    F: '/contact?topic=enterprise',
  };
  return `${baseUrl}${path[stage] ?? '/dashboard'}`;
}

export async function processStageEvents(opts: ProcessOptions = {}): Promise<ProcessResult> {
  const db    = getDbAdapter();
  const limit = opts.limit   ?? 50;
  const base  = opts.baseUrl ?? process.env.PUBLIC_BASE_URL ?? 'https://nexyfab.com';

  const events = await db.queryAll<StageEventRow>(
    `SELECT id, user_id, from_stage, to_stage, trigger_type,
            trigger_value, occurred_at, retry_count
       FROM nf_stage_event
      WHERE processed_at IS NULL AND retry_count < ?
      ORDER BY occurred_at ASC
      LIMIT ?`,
    MAX_RETRIES, limit,
  );

  const result: ProcessResult = {
    scanned: events.length, delivered: 0, skipped: 0, failed: 0, eventIds: [],
  };
  if (events.length === 0) return result;

  for (const ev of events) {
    result.eventIds.push(ev.id);
    const now = Date.now();

    // In-flight 마커 — 동시 실행 시 한 워커만 진행하도록 먼저 점유.
    // retry_count는 +1 하지 않고 last_attempt_at만 갱신하면 무한 루프 위험이
    // 있으므로, 점유 시점에 함께 +1 하고 성공 시 -1 한다(원자적이진 않지만
    // 단일 워커 + 적은 트래픽 가정에서는 충분).
    const claim = await db.execute(
      `UPDATE nf_stage_event
          SET retry_count = retry_count + 1, last_attempt_at = ?
        WHERE id = ? AND processed_at IS NULL AND retry_count = ?`,
      now, ev.id, ev.retry_count,
    );
    if ((claim.changes ?? 0) === 0) {
      result.skipped++;
      continue;
    }

    const user = await db.queryOne<UserRow>(
      'SELECT id, email, name, cumulative_order_krw FROM nf_users WHERE id = ?',
      ev.user_id,
    ).catch(() => null);

    if (!user) {
      // 유저가 사라진 이벤트는 영구 처리(processed_at 기록, 재시도 중단).
      await db.execute(
        `UPDATE nf_stage_event SET processed_at = ?, last_error = ? WHERE id = ?`,
        now, 'user_not_found', ev.id,
      ).catch(() => {});
      result.skipped++;
      continue;
    }

    const target: NotificationTarget = {
      userId: user.id, email: user.email, name: user.name,
    };
    const dispatch = await dispatchStageNotification(target, {
      fromStage: ev.from_stage,
      toStage:   ev.to_stage,
      vars: {
        userName:      user.name,
        currentStage:  ev.to_stage,
        previousStage: ev.from_stage,
        upsellLink:    upsellLinkFor(ev.to_stage, base),
        cumulativeKrw: Number(user.cumulative_order_krw) || 0,
      },
    }).catch(err => ({
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }));

    if (dispatch.ok) {
      await db.execute(
        `UPDATE nf_stage_event SET processed_at = ?, last_error = NULL WHERE id = ?`,
        now, ev.id,
      ).catch(() => {});
      result.delivered++;
      if (dispatch.reason && dispatch.reason !== 'no_template') {
        // 'no_email' 등 의도적 skip은 delivered가 아닌 skipped로 계상.
        result.delivered--;
        result.skipped++;
      }
    } else {
      await db.execute(
        `UPDATE nf_stage_event SET last_error = ? WHERE id = ?`,
        (dispatch.reason ?? 'unknown').slice(0, 500), ev.id,
      ).catch(() => {});
      result.failed++;
    }
  }

  return result;
}
