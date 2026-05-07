/**
 * 분기 확정 시 `quarterly_order_krw` 스냅샷을 히스토리에 밀어 넣고 Stage를 재평가한다.
 * bm-matrix §1.4 · BM_MATRIX_CODE_GAP G-M1 / G-S2.
 */

import { getDbAdapter } from './db-adapter';
import {
  evaluateStage,
  rollQuarterlyOrderKrwHistoryJson,
} from './stage-engine';

const PERIOD_RE = /^\d{4}-Q[1-4]$/;

/**
 * 서울(Asia/Seoul) 달력 기준으로, **직전에 완전히 끝난** 캘린더 분기 키 `YYYY-Qn`.
 * 예: 2026-04-01 KST → `2026-Q1` (1~3월 분기가 끝난 뒤).
 */
export function completedCalendarQuarterKeyKst(nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const mo = Number(parts.find((p) => p.type === 'month')?.value);
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return '1970-Q1';
  const currentQ = Math.ceil(mo / 3);
  let cy = y;
  let cq = currentQ - 1;
  if (cq <= 0) {
    cy -= 1;
    cq = 4;
  }
  return `${cy}-Q${cq}`;
}

export interface QuarterlyRollResult {
  periodKey: string;
  scanned:   number;
  updated:   number;
  advanced:  number;
}

/**
 * 아직 `periodKey` 분기 롤을 하지 않은 유저에 대해 히스토리를 밀고 `evaluateStage`를 호출한다.
 * 동일 `periodKey`로 재실행하면 이미 맞춘 행은 건너뛴다(idempotent).
 */
export async function runQuarterlyStageHistoryRoll(opts: {
  /** 기본: `completedCalendarQuarterKeyKst()` */
  periodKey?: string;
  /** 한 번에 처리할 최대 행 수 (크론이 여러 번 돌려도 됨) */
  limit?: number;
} = {}): Promise<QuarterlyRollResult> {
  const periodKey = opts.periodKey ?? completedCalendarQuarterKeyKst();
  if (!PERIOD_RE.test(periodKey)) {
    throw new Error(`Invalid periodKey: ${periodKey} (expected YYYY-Q1..Q4)`);
  }

  const limit = Math.min(Math.max(opts.limit ?? 2000, 1), 50_000);
  const db = getDbAdapter();

  const rows = await db.queryAll<{
    id: string;
    quarterly_order_krw: number | string | null;
    quarterly_order_krw_history: string | null;
    last_quarterly_history_roll_period: string | null;
  }>(
    `SELECT id, quarterly_order_krw, quarterly_order_krw_history, last_quarterly_history_roll_period
       FROM nf_users
      WHERE id <> 'demo-user'
        AND (last_quarterly_history_roll_period IS NULL OR last_quarterly_history_roll_period < ?)
      ORDER BY id
      LIMIT ?`,
    periodKey,
    limit,
  );

  let updated = 0;
  let advanced = 0;

  for (const r of rows) {
    try {
      const snap = Number(r.quarterly_order_krw) || 0;
      const nextHist = rollQuarterlyOrderKrwHistoryJson(
        r.quarterly_order_krw_history,
        snap,
      );
      await db.execute(
        `UPDATE nf_users
            SET quarterly_order_krw_history = ?,
                last_quarterly_history_roll_period = ?
          WHERE id = ?`,
        nextHist,
        periodKey,
        r.id,
      );
      updated++;
      const ev = await evaluateStage(r.id, 'quarterly_volume').catch(() => null);
      if (ev?.advanced) advanced++;
    } catch {
      /* 한 유저 실패가 전체 잡을 막지 않도록 */
    }
  }

  return { periodKey, scanned: rows.length, updated, advanced };
}
