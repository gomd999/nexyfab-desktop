import { NextRequest, NextResponse } from 'next/server';

type Plan = 'free' | 'pro' | 'team' | 'enterprise';
const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1, team: 2, enterprise: 3 };

// ─── 월별 사용량 제한 (-1 = 무제한, -2 = Pro 전용 하드게이트) ─────────────────
export const PLAN_MONTHLY_LIMITS: Record<string, Record<string, number>> = {
  free:       { analyze_step: 5,  rfq: 3,  shape_chat: 20, ai_advisor: 5,  supplier_match: -2, cam_export: -2, dfm_insights: 5,  process_router: 5,  ai_supplier_match: 3,  cost_copilot: 5,  rfq_writer: 5,  cert_filter: 10, rfq_responder: 5,  quote_negotiator: 3,  order_priority: -2, change_detector: -2, capacity_match: -2, quote_accuracy: -2, brep_step_import: 40, openscad_render: 80 },
  pro:        { analyze_step: -1, rfq: -1, shape_chat: -1, ai_advisor: -1, supplier_match: -1, cam_export: -1, dfm_insights: -1, process_router: -1, ai_supplier_match: -1, cost_copilot: -1, rfq_writer: -1, cert_filter: -1, rfq_responder: -1, quote_negotiator: -1, order_priority: -1, change_detector: -1, capacity_match: -1, quote_accuracy: -1, brep_step_import: -1, openscad_render: -1 },
  team:       { analyze_step: -1, rfq: -1, shape_chat: -1, ai_advisor: -1, supplier_match: -1, cam_export: -1, dfm_insights: -1, process_router: -1, ai_supplier_match: -1, cost_copilot: -1, rfq_writer: -1, cert_filter: -1, rfq_responder: -1, quote_negotiator: -1, order_priority: -1, change_detector: -1, capacity_match: -1, quote_accuracy: -1, brep_step_import: -1, openscad_render: -1 },
  enterprise: { analyze_step: -1, rfq: -1, shape_chat: -1, ai_advisor: -1, supplier_match: -1, cam_export: -1, dfm_insights: -1, process_router: -1, ai_supplier_match: -1, cost_copilot: -1, rfq_writer: -1, cert_filter: -1, rfq_responder: -1, quote_negotiator: -1, order_priority: -1, change_detector: -1, capacity_match: -1, quote_accuracy: -1, brep_step_import: -1, openscad_render: -1 },
};

// ─── 공유 링크 최대 만료 시간 (시간 단위) ─────────────────────────────────────
export const PLAN_SHARE_MAX_HOURS: Record<string, number> = {
  free:       168,    // 7일
  pro:        720,    // 30일
  team:       87600,  // 10년 (사실상 영구)
  enterprise: 87600,
};

// ─── 감사 로그 조회 기간 (일 단위, -1 = 접근 불가) ───────────────────────────
export const PLAN_AUDIT_DAYS: Record<string, number> = {
  free:       -1,
  pro:        30,
  team:       365,
  enterprise: 365,
};

export async function checkMonthlyLimit(
  userId: string,
  plan: string,
  metric: string,
): Promise<{ ok: boolean; used: number; limit: number }> {
  const limits = PLAN_MONTHLY_LIMITS[plan] ?? PLAN_MONTHLY_LIMITS.free;
  const limit = limits[metric] ?? -1;
  if (limit === -1) return { ok: true, used: 0, limit: -1 };
  // -2 = Pro-only hard gate (not a monthly counter)
  if (limit === -2) return { ok: false, used: 0, limit: -2 };

  const { getDbAdapter } = await import('./db-adapter');
  const db = getDbAdapter();
  const monthStart = Date.now() - 30 * 86_400_000;
  const row = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_usage_events WHERE user_id = ? AND metric = ? AND created_at > ?`,
    userId, metric, monthStart,
  );
  const used = row?.c ?? 0;
  return { ok: used < limit, used, limit };
}

/**
 * Atomically inserts one usage row if still under the rolling monthly limit for this metric.
 * Use after successful sync work or before async enqueue so parallel requests cannot overshoot.
 */
export async function consumeMonthlyMetricSlot(
  userId: string,
  plan: string,
  metric: string,
  metadata?: Record<string, unknown>,
): Promise<{ ok: boolean; used: number; limit: number }> {
  const limits = PLAN_MONTHLY_LIMITS[plan] ?? PLAN_MONTHLY_LIMITS.free;
  const limit = limits[metric] ?? -1;
  if (limit === -1) return { ok: true, used: 0, limit: -1 };
  if (limit === -2) return { ok: false, used: 0, limit: -2 };

  const { getDbAdapter } = await import('./db-adapter');
  const db = getDbAdapter();
  const monthStart = Date.now() - 30 * 86_400_000;

  return db.transaction(async (tx) => {
    const row = await tx.queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM nf_usage_events WHERE user_id = ? AND metric = ? AND created_at > ?`,
      userId, metric, monthStart,
    );
    const used = row?.c ?? 0;
    if (used >= limit) {
      return { ok: false, used, limit };
    }
    const id = `ue-${Math.random().toString(36).slice(2)}`;
    const metaJson = metadata ? JSON.stringify(metadata) : null;
    await tx.execute(
      `INSERT INTO nf_usage_events (id, user_id, product, metric, quantity, cycle_start, metadata, created_at) VALUES (?, ?, 'nexyfab', ?, 1, 0, ?, ?)`,
      id, userId, metric, metaJson, Date.now(),
    );
    return { ok: true, used: used + 1, limit };
  });
}

/** Fire-and-forget: record one usage event (matches checkMonthlyLimit's COUNT query). */
export function recordUsageEvent(
  userId: string,
  metric: string,
  metadata?: Record<string, unknown>,
): void {
  import('./db-adapter').then(({ getDbAdapter }) => {
    const db = getDbAdapter();
    const id = `ue-${Math.random().toString(36).slice(2)}`;
    const metaJson = metadata ? JSON.stringify(metadata) : null;
    db.execute(
      `INSERT INTO nf_usage_events (id, user_id, product, metric, quantity, cycle_start, metadata, created_at) VALUES (?, ?, 'nexyfab', ?, 1, 0, ?, ?)`,
      id, userId, metric, metaJson, Date.now(),
    ).catch(() => { /* ignore */ });
  }).catch(() => { /* ignore */ });
}

export function meetsPlan(userPlan: string, required: Plan): boolean {
  return (PLAN_RANK[userPlan as Plan] ?? 0) >= PLAN_RANK[required];
}

// API route 내에서 직접 호출하는 helper
// 토큰에서 plan 추출 (jwt.ts가 없을 경우 demo-token 패턴으로 fallback)
export async function checkPlan(req: NextRequest, required: Plan): Promise<
  { ok: true; userId: string; plan: string } |
  { ok: false; response: NextResponse }
> {
  // auth-middleware.ts의 getAuthUser 시도, 없으면 inline fallback
  try {
    const { getAuthUser } = await import('./auth-middleware');
    const user = await getAuthUser(req);
    if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!meetsPlan(user.plan, required)) {
      return { ok: false, response: NextResponse.json({ error: 'Plan upgrade required', required }, { status: 403 }) };
    }
    return { ok: true, userId: user.userId, plan: user.plan };
  } catch (err) {
    console.error('[plan-guard] checkPlan error:', err);
    return { ok: false, response: NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 }) };
  }
}
