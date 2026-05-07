/**
 * bm-matrix §1.4 — 직전 N일(기본 90) 완료·납품 주문 합계를 `nf_users.quarterly_order_krw`에 반영.
 * 분기 롤 잡(`quarterly-stage-roll`) 전에 일배치로 호출하는 것을 권장.
 */

import { getDbAdapter } from './db-adapter';
import { evaluateStaleUsers } from './stage-engine';

export interface RollingQuarterlyResult {
  /** `quarterly_order_krw`를 갱신한 유저 행 수(전체 nf_users 대상 UPDATE 1문) */
  usersTouched: number;
  /** 이후 `evaluateStaleUsers`로 스캔한 수 */
  staleScanned: number;
  staleAdvanced: number;
}

/**
 * 모든 `nf_users` 행에 대해 상관 서브쿼리로 롤링 합계를 쓴다(SQLite·Postgres 공통 `?`).
 * 주문이 없으면 0.
 */
export async function updateRollingQuarterlyOrderKrw(opts: {
  /** 기본 90일. */
  windowDays?: number;
  /** 갱신 후 최근 활동 유저 Stage 재평가(기본 on). */
  reevaluateStale?: boolean;
} = {}): Promise<RollingQuarterlyResult> {
  const days = Math.min(Math.max(opts.windowDays ?? 90, 1), 366);
  const since = Date.now() - days * 86_400_000;
  const db = getDbAdapter();

  const r = await db.execute(
    `UPDATE nf_users SET quarterly_order_krw = COALESCE((
        SELECT SUM(COALESCE(o.total_price, o.total_price_krw, 0))
          FROM nf_orders o
         WHERE o.user_id = nf_users.id
           AND o.created_at >= ?
           AND o.status IN ('delivered', 'completed')
      ), 0)`,
    since,
  );

  let staleScanned = 0;
  let staleAdvanced = 0;
  if (opts.reevaluateStale !== false) {
    const ev = await evaluateStaleUsers({
      windowMs: Math.max(days + 7, 90) * 86_400_000,
      limit: 5000,
    }).catch(() => ({ scanned: 0, advanced: 0 }));
    staleScanned = ev.scanned;
    staleAdvanced = ev.advanced;
  }

  return { usersTouched: r.changes ?? 0, staleScanned, staleAdvanced };
}
