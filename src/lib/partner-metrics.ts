/**
 * partner-metrics.ts — Multi-dimensional partner performance metrics.
 *
 * Decision (2026-04-23): NEVER collapse partner performance into a single
 * "credit score". Every dimension is stored, displayed, and queried separately
 * so partners know exactly which axis to improve.
 *
 * Dimensions:
 *  - on_time_rate          납기 준수율  (delivered_at <= estimated_delivery_at)
 *  - lead_time_days        평균 리드타임 (created_at → delivered_at)
 *  - response_minutes      견적 회신 속도 (rfq.created_at → quote.responded_at)
 *  - quality_avg           품질 평점     (review.quality_rating)
 *  - communication_avg     소통 평점     (review.communication_rating)
 *  - reorder_rate          재주문률     (same user_id placing 2+ orders with same partner)
 *
 * Storage: `nf_partner_metric_events` is append-only. Aggregations are computed
 * on read so there's no recalculation step to keep in sync.
 */
import { getDbAdapter } from './db-adapter';
import { normPartnerEmail } from './partner-factory-access';

export type MetricKind =
  | 'order_delivered_on_time'
  | 'order_delivered_late'
  | 'quote_responded'
  | 'review_received'
  | 'defect_reported'
  | 'defect_resolved';

export interface MetricEvent {
  partnerEmail: string;
  kind: MetricKind;
  orderId?: string;
  quoteId?: string;
  reviewId?: string;
  /** Numeric payload — meaning depends on kind. */
  value?: number;
  /** Days late (positive) or early (negative) for delivery events. */
  daysLate?: number;
  /** Lead time in days (created_at → delivered_at). */
  leadTimeDays?: number;
  /** Quote response time in minutes (rfq.created_at → quote.responded_at). */
  responseMinutes?: number;
  /** 1-5 star rating for review events. */
  rating?: number;
  /** Distinct sub-rating columns for reviews. */
  qualityRating?: number;
  communicationRating?: number;
  deadlineRating?: number;
}

let ensured = false;

async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_partner_metric_events (
      id TEXT PRIMARY KEY,
      partner_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      order_id TEXT,
      quote_id TEXT,
      review_id TEXT,
      value REAL,
      days_late REAL,
      lead_time_days REAL,
      response_minutes REAL,
      rating REAL,
      quality_rating REAL,
      communication_rating REAL,
      deadline_rating REAL,
      created_at INTEGER NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_pme_partner ON nf_partner_metric_events(partner_email, created_at DESC)').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_pme_kind    ON nf_partner_metric_events(partner_email, kind)').catch(() => {});
  ensured = true;
}

/** Record one metric event. Fire-and-forget; never throws. */
export async function recordMetric(ev: MetricEvent): Promise<void> {
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    const id = `pme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(
      `INSERT INTO nf_partner_metric_events
        (id, partner_email, kind, order_id, quote_id, review_id,
         value, days_late, lead_time_days, response_minutes,
         rating, quality_rating, communication_rating, deadline_rating,
         created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, normPartnerEmail(ev.partnerEmail), ev.kind,
      ev.orderId ?? null, ev.quoteId ?? null, ev.reviewId ?? null,
      ev.value ?? null, ev.daysLate ?? null,
      ev.leadTimeDays ?? null, ev.responseMinutes ?? null,
      ev.rating ?? null,
      ev.qualityRating ?? null, ev.communicationRating ?? null, ev.deadlineRating ?? null,
      Date.now(),
    );
  } catch (err) {
    console.error('[recordMetric] failed:', err);
  }
}

export interface PartnerMetricsSummary {
  partnerEmail: string;
  windowDays: number;
  // 납기 준수율 — 0~100. null = no delivery data yet
  onTimeRate: number | null;
  onTimeCount: number;
  lateCount: number;
  // 평균 리드타임 일수
  avgLeadTimeDays: number | null;
  // 평균 응답 시간 (분)
  avgResponseMinutes: number | null;
  responseSamples: number;
  // 품질/소통 평점 — 1~5
  qualityAvg: number | null;
  communicationAvg: number | null;
  deadlineRatingAvg: number | null;
  reviewCount: number;
  // 재주문 (해당 윈도우 내 동일 사용자 2회 이상 주문)
  reorderRate: number | null;
  // 불량 제기·해결 — 해결률은 별도 차원, 단일 신용점수로 collapse 하지 않음
  defectCount: number;
  defectResolvedCount: number;
  defectResolutionRate: number | null;  // 0~100
}

/** Aggregate all dimensions for a single partner over the last N days. */
export async function getPartnerMetrics(
  partnerEmail: string,
  windowDays = 90,
): Promise<PartnerMetricsSummary> {
  const db = getDbAdapter();
  await ensureTable(db);

  const since = Date.now() - windowDays * 86_400_000;
  const emailKey = normPartnerEmail(partnerEmail);

  const onTime = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_partner_metric_events
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
         AND kind = 'order_delivered_on_time' AND created_at >= ?`,
    emailKey, since,
  );
  const late = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_partner_metric_events
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
         AND kind = 'order_delivered_late' AND created_at >= ?`,
    emailKey, since,
  );
  const onTimeCount = onTime?.c ?? 0;
  const lateCount = late?.c ?? 0;
  const totalDeliveries = onTimeCount + lateCount;
  const onTimeRate = totalDeliveries > 0
    ? Math.round((onTimeCount / totalDeliveries) * 1000) / 10
    : null;

  const leadStats = await db.queryOne<{ avg: number | null }>(
    `SELECT AVG(lead_time_days) as avg FROM nf_partner_metric_events
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
         AND lead_time_days IS NOT NULL AND created_at >= ?`,
    emailKey, since,
  );

  const respStats = await db.queryOne<{ avg: number | null; c: number }>(
    `SELECT AVG(response_minutes) as avg, COUNT(*) as c FROM nf_partner_metric_events
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
         AND kind = 'quote_responded' AND response_minutes IS NOT NULL AND created_at >= ?`,
    emailKey, since,
  );

  const reviewStats = await db.queryOne<{
    qa: number | null; ca: number | null; da: number | null; c: number;
  }>(
    `SELECT AVG(quality_rating) as qa,
            AVG(communication_rating) as ca,
            AVG(deadline_rating) as da,
            COUNT(*) as c
       FROM nf_partner_metric_events
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
         AND kind = 'review_received' AND created_at >= ?`,
    emailKey, since,
  );

  // Re-order rate — distinct users vs total deliveries
  const userStats = await db.queryOne<{ users: number; orders: number }>(
    `SELECT COUNT(DISTINCT o.user_id) as users, COUNT(*) as orders
       FROM nf_orders o
       WHERE o.partner_email IS NOT NULL AND LOWER(TRIM(o.partner_email)) = ?
         AND o.created_at >= ?`,
    emailKey, since,
  );
  const reorderRate = userStats && userStats.orders > 0 && userStats.users > 0
    ? Math.round(((userStats.orders - userStats.users) / userStats.orders) * 1000) / 10
    : null;

  // 불량·RMA 차원 — 단일 신용점수 collapse 금지, 제기 건수 + 해결률 별도 노출
  const defectRep = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_partner_metric_events
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
         AND kind = 'defect_reported' AND created_at >= ?`,
    emailKey, since,
  );
  const defectRes = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_partner_metric_events
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
         AND kind = 'defect_resolved' AND created_at >= ?`,
    emailKey, since,
  );
  const defectCount = defectRep?.c ?? 0;
  const defectResolvedCount = defectRes?.c ?? 0;
  const defectResolutionRate = defectCount > 0
    ? Math.round((defectResolvedCount / defectCount) * 1000) / 10
    : null;

  return {
    partnerEmail: emailKey || partnerEmail,
    windowDays,
    onTimeRate,
    onTimeCount,
    lateCount,
    avgLeadTimeDays: leadStats?.avg != null ? Math.round((leadStats.avg) * 10) / 10 : null,
    avgResponseMinutes: respStats?.avg != null ? Math.round(respStats.avg) : null,
    responseSamples: respStats?.c ?? 0,
    qualityAvg: reviewStats?.qa != null ? Math.round(reviewStats.qa * 10) / 10 : null,
    communicationAvg: reviewStats?.ca != null ? Math.round(reviewStats.ca * 10) / 10 : null,
    deadlineRatingAvg: reviewStats?.da != null ? Math.round(reviewStats.da * 10) / 10 : null,
    reviewCount: reviewStats?.c ?? 0,
    reorderRate,
    defectCount,
    defectResolvedCount,
    defectResolutionRate,
  };
}
