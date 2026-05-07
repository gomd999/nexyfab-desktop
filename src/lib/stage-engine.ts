/**
 * stage-engine.ts — NexyFab user lifecycle Stage A→F engine.
 *
 * See `docs/strategy/bm-matrix.md` §1 for the canonical Stage definitions
 * and rollback policy. Two cardinal rules:
 *
 *   1. **High-Water Mark**: a user's `stage` never decreases. computeStage
 *      gives the *minimum* stage warranted by current metrics; if it's
 *      lower than the user's current stage we keep current. Demotion only
 *      happens via explicit `manual_override` / `compliance_demotion`.
 *
 *   2. **Idempotency**: evaluateStage is safe to call any number of times
 *      from any number of callers (webhooks, order delivery, daily batch).
 *      Duplicate calls produce zero outbox events.
 *
 * Outbox pattern: every transition writes to `nf_stage_event`. A separate
 * worker (Phase BM-3) reads `processed_at IS NULL` rows and triggers UI
 * flag updates / upsell emails. This decouples evaluation from side effects
 * and lets us replay history if the rules change.
 */

import { getDbAdapter } from './db-adapter';
import { randomUUID } from 'crypto';
import type { Stage } from './userStage';

export type { Stage } from './userStage';
export { parseUserStageColumn } from './userStage';

export type StageTrigger =
  | 'first_order'
  | 'cumulative_krw'
  | 'order_count'
  | 'org_promotion'
  | 'quarterly_volume'
  | 'enterprise_contract'
  | 'manual_override'
  | 'compliance_demotion';

export interface UserStageMetrics {
  cumulativeOrderKrw:  number;
  orderCountSuccess:   number;
  quarterlyOrderKrw:   number;
  orgSize:             number;
  /** 맞춤 기업 계약(Stage F). DB `nf_users.enterprise_contract`. */
  enterpriseContract:  boolean;
  /** ERP 연동 계약 체결 — bm-matrix §1.1 E→F OR 경로. */
  erpIntegrationContract: boolean;
  /** bm-matrix §1.1 D→E: 법인(또는 팀원≥2). `account_type=business` 또는 사업자등록번호가 있으면 법인으로 간주. */
  isBusinessAccount:   boolean;
  /**
   * 직전 3개 **완료된** 분기(또는 일배치가 확정한 구간) 발주 합계 KRW, 시계순 [t-2, t-1, t].
   * E→F 볼륨 경로: 세 값 모두 ≥ `STAGE_QUARTERLY_VOLUME_F_KRW` 이고 E 기준 충족 시 F.
   */
  quarterlyWindowKrwHistory: readonly [number, number, number];
}

/** bm-matrix §1.1 — 분기(확정 구간) 발주 ≥ 1억 × 3연속 시 E→F 볼륨 경로. */
export const STAGE_QUARTERLY_VOLUME_F_KRW = 100_000_000;

const STAGE_ORDER: Stage[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const stageRank = (s: Stage): number => STAGE_ORDER.indexOf(s);

/** Pick the higher of two stages (high-water mark). */
function maxStage(a: Stage, b: Stage): Stage {
  return stageRank(a) >= stageRank(b) ? a : b;
}

/** Parse `nf_users.quarterly_order_krw_history` JSON (length-3 number array). */
export function parseQuarterlyOrderKrwHistoryJson(
  raw: string | null | undefined,
): [number, number, number] {
  const zero: [number, number, number] = [0, 0, 0];
  if (raw == null || raw === '') return zero;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v) || v.length < 3) return zero;
    return [
      Math.max(0, Number(v[0]) || 0),
      Math.max(0, Number(v[1]) || 0),
      Math.max(0, Number(v[2]) || 0),
    ];
  } catch {
    return zero;
  }
}

/**
 * 분기(또는 배치가 확정한 구간)이 끝날 때 호출: 히스토리를 한 칸 밀고 방금 끝난 구간 합계를 맨 뒤에 넣는다.
 * `completedWindowKrw`는 통상 직전 구간의 `quarterly_order_krw` 스냅샷.
 */
export function rollQuarterlyOrderKrwHistoryJson(
  prev: string | null | undefined,
  completedWindowKrw: number,
): string {
  const [, b, c] = parseQuarterlyOrderKrwHistoryJson(prev);
  const n = Math.max(0, completedWindowKrw);
  return JSON.stringify([b, c, n]);
}

function rowDbBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    return s === '1' || s === 'true' || s === 't';
  }
  return false;
}

/**
 * Pure function: given a user's current metrics, compute the *minimum*
 * stage warranted. Stage B (transient "checkout in progress") is set
 * explicitly during payment flows, never produced here.
 *
 * Thresholds match bm-matrix.md §1.1 — change them in lockstep.
 */
export function computeStage(m: UserStageMetrics): Stage {
  const orgConditionForE = m.orgSize >= 2 || m.isBusinessAccount;
  const atLeastE =
    m.cumulativeOrderKrw >= 100_000_000 && orgConditionForE;
  const [q0, q1, q2] = m.quarterlyWindowKrwHistory;
  const thr = STAGE_QUARTERLY_VOLUME_F_KRW;
  const volumeF = atLeastE && q0 >= thr && q1 >= thr && q2 >= thr;

  if (m.enterpriseContract || m.erpIntegrationContract || volumeF) return 'F';
  if (m.cumulativeOrderKrw >= 100_000_000 && orgConditionForE) return 'E';
  if (m.orderCountSuccess >= 2 || m.cumulativeOrderKrw >= 50_000_000) return 'D';
  if (m.orderCountSuccess >= 1) return 'C';
  return 'A';
}

interface UserRow {
  id:                           string;
  stage:                        Stage;
  cumulative_order_krw:         number;
  order_count_success:          number;
  quarterly_order_krw:          number;
  org_size:                     number;
  account_type:                 string | null;
  business_reg_number:          string | null;
  quarterly_order_krw_history: string | null;
  enterprise_contract:          unknown;
  erp_integration_contract:     unknown;
}

function rowIsBusinessAccount(u: Pick<UserRow, 'account_type' | 'business_reg_number'>): boolean {
  const t = (u.account_type ?? '').toLowerCase();
  if (t === 'business') return true;
  const br = u.business_reg_number;
  return typeof br === 'string' && br.trim().length > 0;
}

/**
 * Re-evaluate one user's stage from current DB metrics, write an outbox
 * event if the stage advanced. Safe to call from any path. Errors are
 * logged but never thrown — stage promotion must not break the calling
 * business flow.
 *
 * @param userId      target user
 * @param triggerHint caller's hint about what just changed (used for the
 *                    outbox row's `trigger_type`). Defaults to `cumulative_krw`.
 */
export async function evaluateStage(
  userId: string,
  triggerHint: StageTrigger = 'cumulative_krw',
): Promise<{ from: Stage; to: Stage; advanced: boolean }> {
  const db = getDbAdapter();

  const user = await db.queryOne<UserRow>(
    `SELECT id, stage, cumulative_order_krw, order_count_success,
            quarterly_order_krw, org_size,
            account_type, business_reg_number,
            quarterly_order_krw_history, enterprise_contract, erp_integration_contract
       FROM nf_users WHERE id = ?`,
    userId,
  );
  if (!user) {
    return { from: 'A', to: 'A', advanced: false };
  }

  const quarterlyWindowKrwHistory = parseQuarterlyOrderKrwHistoryJson(
    user.quarterly_order_krw_history,
  );

  const computed = computeStage({
    cumulativeOrderKrw: Number(user.cumulative_order_krw) || 0,
    orderCountSuccess:  user.order_count_success || 0,
    quarterlyOrderKrw:  Number(user.quarterly_order_krw) || 0,
    orgSize:            user.org_size || 1,
    enterpriseContract: rowDbBool(user.enterprise_contract),
    erpIntegrationContract: rowDbBool(user.erp_integration_contract),
    isBusinessAccount:  rowIsBusinessAccount(user),
    quarterlyWindowKrwHistory,
  });

  const current = user.stage ?? 'A';
  const next = maxStage(current, computed);

  if (next === current) {
    return { from: current, to: next, advanced: false };
  }

  // Idempotency guard: if an unprocessed event already moves the user
  // to the same target stage, don't write a second one.
  const pending = await db.queryOne<{ to_stage: Stage }>(
    `SELECT to_stage FROM nf_stage_event
      WHERE user_id = ? AND processed_at IS NULL
      ORDER BY occurred_at DESC LIMIT 1`,
    userId,
  ).catch(() => null);
  if (pending?.to_stage === next) {
    return { from: current, to: next, advanced: false };
  }

  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_stage_event
       (id, user_id, from_stage, to_stage, trigger_type, trigger_value, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `stg-${randomUUID()}`,
    userId, current, next, triggerHint,
    JSON.stringify({
      cumulative: user.cumulative_order_krw,
      orderCount: user.order_count_success,
      quarterly:  user.quarterly_order_krw,
      orgSize:    user.org_size,
      isBusinessAccount: rowIsBusinessAccount(user),
      enterpriseContract: rowDbBool(user.enterprise_contract),
      erpIntegrationContract: rowDbBool(user.erp_integration_contract),
      quarterlyWindowKrwHistory,
    }),
    now,
  );

  // Update user's stage immediately so subsequent reads see the new
  // stage even before the outbox worker fires (worker handles email/UI).
  await db.execute(
    'UPDATE nf_users SET stage = ?, stage_since = ? WHERE id = ?',
    next, now, userId,
  );

  return { from: current, to: next, advanced: true };
}

/**
 * Atomically bump a user's order metrics and re-evaluate stage in one call.
 * Call this from payment/delivery handlers — never update the metric
 * columns directly so we keep one canonical mutation path.
 */
export async function recordOrderCompletion(
  userId: string,
  orderKrw: number,
): Promise<void> {
  if (!userId || orderKrw <= 0) return;
  const db = getDbAdapter();
  const now = Date.now();

  await db.execute(
    `UPDATE nf_users
        SET cumulative_order_krw = COALESCE(cumulative_order_krw, 0) + ?,
            order_count_success  = COALESCE(order_count_success, 0) + 1,
            last_order_at        = ?
      WHERE id = ?`,
    orderKrw, now, userId,
  );

  // Trigger hint = order_count when this is the user's first or second
  // success; cumulative_krw otherwise. Cheap heuristic — the worker can
  // refine later by inspecting trigger_value JSON.
  const after = await db.queryOne<{ order_count_success: number }>(
    'SELECT order_count_success FROM nf_users WHERE id = ?', userId,
  ).catch(() => null);
  const hint: StageTrigger =
    (after?.order_count_success ?? 0) === 1 ? 'first_order' :
    (after?.order_count_success ?? 0) === 2 ? 'order_count' :
    'cumulative_krw';

  await evaluateStage(userId, hint).catch(err => {
    console.error('[stage-engine] evaluateStage failed:', err);
  });
}

/**
 * Batch entry point — re-evaluate stages for a window of recently active
 * users. Call from a daily cron once traffic grows; until then the
 * per-event path covers everything.
 */
export async function evaluateStaleUsers(opts: {
  /** Look back this many ms for activity. Default 48h. */
  windowMs?: number;
  /** Hard cap to keep a single batch bounded. Default 1000. */
  limit?:    number;
} = {}): Promise<{ scanned: number; advanced: number }> {
  const db = getDbAdapter();
  const since = Date.now() - (opts.windowMs ?? 48 * 3600 * 1000);
  const limit = opts.limit ?? 1000;

  const rows = await db.queryAll<{ id: string }>(
    `SELECT id FROM nf_users
      WHERE last_order_at IS NOT NULL AND last_order_at >= ?
      ORDER BY last_order_at DESC LIMIT ?`,
    since, limit,
  );

  let advanced = 0;
  for (const r of rows) {
    const res = await evaluateStage(r.id, 'cumulative_krw').catch(() => null);
    if (res?.advanced) advanced++;
  }
  return { scanned: rows.length, advanced };
}
