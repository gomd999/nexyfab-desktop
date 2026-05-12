/**
 * GET /api/cron/anti-poach-signals
 *
 * Weekly sweep for patterns that may indicate off-platform settlement
 * (a violation of partner agreement v1.0 §6 — 24mo / 50% damages).
 *
 * Signals checked:
 *   1. Orders > 7 days old with no escrow transaction → settlement may be
 *      happening off-platform (every order should escrow per contract).
 *   2. Buyer↔partner pairs that hit `quote_received` 3+ times in last 90d
 *      with no resulting escrow → repeat contact without conversion may
 *      indicate they took the relationship off-platform after intro.
 *   3. RFQs that reached `quote_received` then got cancelled within 48h
 *      with no escrow → classic "got the quote, contacted directly".
 *
 * No auto-action — ops manually reviews flagged entries. Each flagged
 * pair is recorded in a separate audit table so we keep evidence for
 * any subsequent dispute / arbitration.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendOpsAlert } from '@/lib/notify/opsAlert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

interface OrphanOrderRow { id: string; user_id: string; partner_email: string | null; created_at: number; total_price_krw: number }
interface RepeatPairRow { user_id: string; partner_email: string; pair_count: number }
interface QuickCancelRow { rfq_id: string; user_id: string; status: string; quoted_at: number; cancelled_at: number }

let auditTableEnsured = false;
async function ensureAuditTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (auditTableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_anti_poach_signals (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,        -- 'orphan_order' | 'repeat_pair' | 'quick_cancel'
      buyer_id     TEXT,
      partner_email TEXT,
      ref_id       TEXT,                 -- order_id / rfq_id
      severity     TEXT NOT NULL,        -- 'low' | 'medium' | 'high'
      details      TEXT,
      detected_at  BIGINT NOT NULL,
      reviewed_at  BIGINT,
      reviewed_by  TEXT,
      verdict      TEXT                  -- 'false_positive' | 'warning_sent' | 'enforcement_initiated'
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_antipoach_kind ON nf_anti_poach_signals(kind, detected_at DESC)').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_antipoach_pair ON nf_anti_poach_signals(buyer_id, partner_email)').catch(() => {});
  auditTableEnsured = true;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const db = getDbAdapter();
  await ensureAuditTable(db);

  // ── Signal 1: orders > 7d old without escrow tx ──────────────────────
  const orphanCutoff = now - 7 * DAY_MS;
  const orphans = await db.queryAll<OrphanOrderRow>(
    `SELECT o.id, o.user_id, o.partner_email, o.created_at, o.total_price_krw
       FROM nf_orders o
       LEFT JOIN nf_escrow_transactions e ON e.order_id = o.id
      WHERE o.created_at < ?
        AND o.partner_email IS NOT NULL
        AND o.status NOT IN ('cancelled', 'refunded')
        AND e.id IS NULL
      ORDER BY o.created_at ASC
      LIMIT 30`,
    orphanCutoff,
  ).catch((): OrphanOrderRow[] => []);

  // ── Signal 2: repeat buyer↔partner pairs (3+ quote_received, no escrow) in 90d ──
  const ninetyDayCutoff = now - 90 * DAY_MS;
  const repeats = await db.queryAll<RepeatPairRow>(
    `SELECT r.user_id, f.partner_email, COUNT(*) AS pair_count
       FROM nf_concierge_status cs
       JOIN nf_rfqs r ON r.id = cs.rfq_id
       JOIN nf_factories f ON f.id = cs.factory_id
       LEFT JOIN nf_orders o ON o.user_id = r.user_id
                            AND LOWER(TRIM(o.partner_email)) = LOWER(TRIM(f.partner_email))
       LEFT JOIN nf_escrow_transactions e ON e.order_id = o.id
      WHERE cs.status IN ('quote_received', 'partner_signup')
        AND cs.last_action_at >= ?
        AND f.partner_email IS NOT NULL
        AND e.id IS NULL
      GROUP BY r.user_id, f.partner_email
      HAVING COUNT(*) >= 3
      LIMIT 20`,
    ninetyDayCutoff,
  ).catch((): RepeatPairRow[] => []);

  // ── Signal 3: RFQ reached quote_received, cancelled within 48h, no escrow ──
  const quickCancels = await db.queryAll<QuickCancelRow>(
    `SELECT r.id AS rfq_id, r.user_id, r.status,
            cs.last_action_at AS quoted_at,
            r.updated_at AS cancelled_at
       FROM nf_rfqs r
       JOIN nf_concierge_status cs ON cs.rfq_id = r.id AND cs.status = 'quote_received'
       LEFT JOIN nf_orders o ON o.id IN (
         SELECT id FROM nf_orders WHERE user_id = r.user_id LIMIT 1
       )
      WHERE r.status = 'rejected'
        AND r.updated_at - cs.last_action_at < ?
        AND r.updated_at >= ?
        AND o.id IS NULL
      ORDER BY r.updated_at DESC
      LIMIT 20`,
    2 * DAY_MS, now - 30 * DAY_MS,
  ).catch((): QuickCancelRow[] => []);

  // Persist new signals (skip pairs already flagged in last 30d to avoid
  // re-alerting on the same item).
  const dedupeCutoff = now - 30 * DAY_MS;
  const writes: Array<Promise<unknown>> = [];

  for (const o of orphans) {
    const exists = await db.queryOne<{ id: string }>(
      `SELECT id FROM nf_anti_poach_signals WHERE kind = 'orphan_order' AND ref_id = ? AND detected_at > ?`,
      o.id, dedupeCutoff,
    ).catch(() => null);
    if (!exists) {
      writes.push(db.execute(
        `INSERT INTO nf_anti_poach_signals (id, kind, buyer_id, partner_email, ref_id, severity, details, detected_at)
         VALUES (?, 'orphan_order', ?, ?, ?, 'high', ?, ?)`,
        `aps_${randomUUID()}`, o.user_id, o.partner_email, o.id,
        JSON.stringify({ totalKrw: o.total_price_krw, ageHours: Math.round((now - o.created_at) / (60 * 60 * 1000)) }),
        now,
      ).catch(() => undefined));
    }
  }

  for (const p of repeats) {
    const exists = await db.queryOne<{ id: string }>(
      `SELECT id FROM nf_anti_poach_signals WHERE kind = 'repeat_pair' AND buyer_id = ? AND partner_email = ? AND detected_at > ?`,
      p.user_id, p.partner_email, dedupeCutoff,
    ).catch(() => null);
    if (!exists) {
      writes.push(db.execute(
        `INSERT INTO nf_anti_poach_signals (id, kind, buyer_id, partner_email, ref_id, severity, details, detected_at)
         VALUES (?, 'repeat_pair', ?, ?, NULL, 'medium', ?, ?)`,
        `aps_${randomUUID()}`, p.user_id, p.partner_email,
        JSON.stringify({ pairCount: p.pair_count, windowDays: 90 }),
        now,
      ).catch(() => undefined));
    }
  }

  for (const q of quickCancels) {
    const exists = await db.queryOne<{ id: string }>(
      `SELECT id FROM nf_anti_poach_signals WHERE kind = 'quick_cancel' AND ref_id = ? AND detected_at > ?`,
      q.rfq_id, dedupeCutoff,
    ).catch(() => null);
    if (!exists) {
      writes.push(db.execute(
        `INSERT INTO nf_anti_poach_signals (id, kind, buyer_id, partner_email, ref_id, severity, details, detected_at)
         VALUES (?, 'quick_cancel', ?, NULL, ?, 'medium', ?, ?)`,
        `aps_${randomUUID()}`, q.user_id, q.rfq_id,
        JSON.stringify({ minutesBetween: Math.round((q.cancelled_at - q.quoted_at) / 60_000) }),
        now,
      ).catch(() => undefined));
    }
  }

  await Promise.all(writes);

  const totalSignals = orphans.length + repeats.length + quickCancels.length;
  if (totalSignals === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'no anti-poach signals' });
  }

  const bodyLines: string[] = [
    `Window: 90d for repeats / 30d for cancels / 7d+ for orphans`,
    '',
    `🚨 약관 §6 위반 의심 시그널`,
    `• Orphan orders (에스크로 누락):     ${orphans.length}`,
    `• Repeat pairs (반복 노출, 미체결):    ${repeats.length}`,
    `• Quick cancels (견적 후 즉시 취소):   ${quickCancels.length}`,
    '',
    '→ 각 항목 검토 후 verdict 입력: false_positive / warning_sent / enforcement_initiated',
    `→ 검토 페이지: ${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://nexyfab.com'}/admin/anti-poach`,
  ];

  if (orphans.length > 0) {
    bodyLines.push('', '— Orphan orders —');
    for (const o of orphans.slice(0, 10)) {
      bodyLines.push(`  ${o.id} · buyer=${o.user_id.slice(0, 8)} · partner=${o.partner_email} · ${o.total_price_krw.toLocaleString('ko-KR')}원`);
    }
  }
  if (repeats.length > 0) {
    bodyLines.push('', '— Repeat pairs —');
    for (const p of repeats.slice(0, 10)) {
      bodyLines.push(`  buyer=${p.user_id.slice(0, 8)} ↔ ${p.partner_email} · ${p.pair_count}건`);
    }
  }
  if (quickCancels.length > 0) {
    bodyLines.push('', '— Quick cancels —');
    for (const q of quickCancels.slice(0, 10)) {
      const minutes = Math.round((q.cancelled_at - q.quoted_at) / 60_000);
      bodyLines.push(`  ${q.rfq_id} · cancelled ${minutes}분 후 견적 도착`);
    }
  }

  await sendOpsAlert({
    severity: orphans.length > 0 ? 'warning' : 'info',
    title: `NexyFab anti-poach signals — ${totalSignals}건 감지`,
    bodyLines,
    source: 'cron:anti-poach-signals',
  }).catch(err => console.warn('[anti-poach] alert send failed:', err));

  return NextResponse.json({
    ok: true,
    sent: true,
    counts: { orphans: orphans.length, repeats: repeats.length, quickCancels: quickCancels.length },
  });
}
