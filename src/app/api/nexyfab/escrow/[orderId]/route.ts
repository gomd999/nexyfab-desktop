/**
 * Q8 — Escrow ledger interface (PG integration deferred to ops setup).
 *
 * GET  /api/nexyfab/escrow/{orderId}
 *   → { transaction | null, history }
 *   Visible to buyer + assigned partner; admin sees more.
 *
 * POST /api/nexyfab/escrow/{orderId}
 *   body: { action: 'create'|'mark_received'|'release'|'refund', notes? }
 *   Admin-only. PG webhook callbacks would call the same actions.
 *
 * Real Toss/KG/Stripe wiring lives separately (sysadmin sets PG keys
 * and points the gateway's webhook at this endpoint with action=mark_received).
 * Until that's wired, ops can manually mark received/released here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { logFunnelEvent } from '@/lib/funnel-logger';
import { isOrderBuyerInActiveWorkspace } from '@/lib/nfOrderAccess';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ESCROW_ACTION_JSON_BYTES = 64 * 1024;

type EscrowStatus = 'pending' | 'received' | 'held' | 'released' | 'refunded' | 'disputed';

interface EscrowRow {
  id: string;
  order_id: string;
  buyer_user_id: string;
  partner_email: string;
  gross_amount_krw: number;
  commission_pct: number;
  commission_amount_krw: number;
  net_amount_krw: number;
  status: string;
  pg_provider: string | null;
  pg_transaction_id: string | null;
  received_at: number | null;
  released_at: number | null;
  refunded_at: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_escrow_transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      partner_email TEXT NOT NULL,
      gross_amount_krw BIGINT NOT NULL,
      commission_pct REAL NOT NULL,
      commission_amount_krw BIGINT NOT NULL,
      net_amount_krw BIGINT NOT NULL,
      status TEXT NOT NULL,
      pg_provider TEXT,
      pg_transaction_id TEXT,
      received_at BIGINT,
      released_at BIGINT,
      refunded_at BIGINT,
      notes TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_escrow_order ON nf_escrow_transactions(order_id)').catch(() => {});
  tableEnsured = true;
}

async function resolveOrder(db: ReturnType<typeof getDbAdapter>, orderId: string) {
  return db.queryOne<{
    user_id: string; org_id: string | null; partner_email: string | null;
    total_price_krw: number; status: string;
  }>(
    'SELECT user_id, org_id, partner_email, total_price_krw, status FROM nf_orders WHERE id = ?',
    orderId,
  ).catch(() => null);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { orderId } = await params;
  const db = getDbAdapter();
  await ensureTable(db);

  const order = await resolveOrder(db, orderId);
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 });

  const isBuyer = isOrderBuyerInActiveWorkspace(auth, order);
  const isPartner = !!order.partner_email && normPartnerEmail(auth.email ?? '') === normPartnerEmail(order.partner_email);
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isBuyer && !isPartner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const tx = await db.queryOne<EscrowRow>(
    'SELECT * FROM nf_escrow_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1',
    orderId,
  ).catch(() => null);

  return NextResponse.json({
    ok: true,
    transaction: tx ? {
      id: tx.id,
      orderId: tx.order_id,
      grossKrw: tx.gross_amount_krw,
      commissionPct: tx.commission_pct,
      commissionKrw: tx.commission_amount_krw,
      netKrw: tx.net_amount_krw,
      status: tx.status,
      pgProvider: tx.pg_provider,
      receivedAt: tx.received_at,
      releasedAt: tx.released_at,
      refundedAt: tx.refunded_at,
      notes: isAdmin ? tx.notes : null,
      createdAt: tx.created_at,
    } : null,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden — admin only (PG webhook will be wired separately)' }, { status: 403 });

  const { orderId } = await params;
  let body: { action?: unknown; notes?: unknown; commissionPct?: unknown };
  try {
    body = await readBoundedJson(req, ESCROW_ACTION_JSON_BYTES);
  } catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const action = typeof body.action === 'string' ? body.action : '';
  if (!['create', 'mark_received', 'release', 'refund', 'mark_disputed'].includes(action)) {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null;

  const db = getDbAdapter();
  await ensureTable(db);

  const order = await resolveOrder(db, orderId);
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 });
  if (!order.partner_email) {
    return NextResponse.json({ error: 'order has no assigned partner' }, { status: 400 });
  }

  const now = Date.now();

  if (action === 'create') {
    // Resolve commission rate in this priority order so escrow always
    // matches what was actually charged:
    //   1. Explicit override in request body (admin manual adjustment)
    //   2. Contract row's commission_rate (the agreed rate)
    //   3. Platform default from src/lib/commission.ts
    const { COMMISSION_PCT_DEFAULT } = await import('@/lib/commission');
    const explicitOverride = typeof body.commissionPct === 'number' && body.commissionPct >= 0 && body.commissionPct <= 30
      ? body.commissionPct : null;
    const contractRate = await db.queryOne<{ commission_rate: number | null }>(
      `SELECT commission_rate FROM nf_contracts
        WHERE quote_id IN (
          SELECT quote_id FROM nf_orders WHERE id = ? AND quote_id IS NOT NULL
          UNION
          SELECT q.id FROM nf_quotes q
            JOIN nf_orders o ON o.rfq_id = q.inquiry_id
           WHERE o.id = ? AND q.status = 'accepted'
        )
        ORDER BY created_at DESC LIMIT 1`,
      orderId, orderId,
    ).catch(() => null);
    const commissionPct = explicitOverride
      ?? contractRate?.commission_rate
      ?? COMMISSION_PCT_DEFAULT;
    const gross = order.total_price_krw;
    const commission = Math.round(gross * commissionPct / 100);
    const net = gross - commission;
    const id = `escrow_${randomUUID()}`;
    await db.execute(
      `INSERT INTO nf_escrow_transactions
         (id, order_id, buyer_user_id, partner_email, gross_amount_krw,
          commission_pct, commission_amount_krw, net_amount_krw,
          status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      id, orderId, order.user_id, order.partner_email, gross,
      commissionPct, commission, net, notes, now, now,
    );
    await logFunnelEvent(auth.userId, {
      eventType: 'escrow_created',
      contextType: 'order', contextId: orderId,
      metadata: { grossKrw: gross, commissionKrw: commission, netKrw: net },
    }).catch(() => {});
    return NextResponse.json({ ok: true, action, id, commissionKrw: commission, netKrw: net }, { status: 201 });
  }

  // For other actions, locate the latest tx.
  const tx = await db.queryOne<EscrowRow>(
    'SELECT * FROM nf_escrow_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1',
    orderId,
  ).catch(() => null);
  if (!tx) return NextResponse.json({ error: 'no escrow transaction found — call action=create first' }, { status: 404 });

  const allowedTransitions: Record<string, EscrowStatus[]> = {
    pending:   ['received', 'refunded'],
    received:  ['released', 'refunded', 'disputed'],
    held:      ['released', 'refunded', 'disputed'],
    disputed:  ['released', 'refunded'],
    released:  [],
    refunded:  [],
  };

  let nextStatus: EscrowStatus | null = null;
  let extraField: string | null = null;
  if (action === 'mark_received')  { nextStatus = 'received';  extraField = 'received_at = ?'; }
  if (action === 'release')        { nextStatus = 'released';  extraField = 'released_at = ?'; }
  if (action === 'refund')         { nextStatus = 'refunded';  extraField = 'refunded_at = ?'; }
  if (action === 'mark_disputed')  { nextStatus = 'disputed'; }

  if (!nextStatus) return NextResponse.json({ error: 'invalid transition' }, { status: 400 });

  const allowed = allowedTransitions[tx.status as EscrowStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    return NextResponse.json({ error: `cannot transition from ${tx.status} to ${nextStatus}` }, { status: 400 });
  }

  if (extraField) {
    await db.execute(
      `UPDATE nf_escrow_transactions
          SET status = ?, ${extraField}, notes = COALESCE(?, notes), updated_at = ?
        WHERE id = ?`,
      nextStatus, now, notes, now, tx.id,
    );
  } else {
    await db.execute(
      `UPDATE nf_escrow_transactions
          SET status = ?, notes = COALESCE(?, notes), updated_at = ?
        WHERE id = ?`,
      nextStatus, notes, now, tx.id,
    );
  }

  if (nextStatus === 'released') {
    await logFunnelEvent(auth.userId, {
      eventType: 'escrow_released',
      contextType: 'order', contextId: orderId,
      metadata: { netKrw: tx.net_amount_krw },
    }).catch(() => {});
    // Final 30-day Pro tail covers AS / 분쟁 window after delivery.
    try {
      const partnerUser = await db.queryOne<{ id: string }>(
        'SELECT id FROM nf_users WHERE LOWER(TRIM(email)) = ?',
        normPartnerEmail(tx.partner_email),
      );
      if (partnerUser) {
        const { extendPartnerProGrace } = await import('@/lib/partner-pro-grace');
        await extendPartnerProGrace(partnerUser.id, 'escrow_released', now);
      }
    } catch { /* non-blocking */ }

    // Proactively notify partner — without this, partners had to poll
    // /partner/settlements to discover the funds had landed, which led
    // to false "you didn't pay me" CS tickets.
    try {
      const { createNotification } = await import('@/app/lib/notify');
      // (escrow uses positional signature with `partner:email` recipient prefix)
      const { sendEmail } = await import('@/lib/email');
      const partnerEmail = tx.partner_email;
      const netKrw = tx.net_amount_krw.toLocaleString('ko-KR');
      const { esc } = await import('@/lib/html-escape');
      void createNotification(
        `partner:${normPartnerEmail(partnerEmail)}`,
        'escrow_released',
        '정산이 완료되었습니다',
        `주문 ${orderId.slice(0, 12)} 의 ${netKrw}원이 정산되었습니다. /partner/settlements 에서 확인하세요.`,
      );
      await sendEmail({
        to: partnerEmail,
        subject: `[NexyFab] 정산 완료 — ${netKrw}원`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
            <div style="font-size: 18px; font-weight: 700; margin-bottom: 12px;">💰 정산이 완료되었습니다</div>
            <p style="line-height: 1.6;">
              주문 <code>${esc(orderId)}</code> 의 정산이 완료되었습니다.<br />
              정산 금액: <b>${esc(netKrw)}원</b> (수수료 차감 후)
            </p>
            <div style="margin-top: 24px;">
              <a href="https://nexyfab.com/partner/settlements"
                 style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; border-radius: 8px; text-decoration: none; font-weight: 700;">
                정산 내역 보기 →
              </a>
            </div>
          </div>
        `,
      }).catch(() => {});
    } catch { /* non-blocking */ }
  }

  return NextResponse.json({ ok: true, action, status: nextStatus });
}
