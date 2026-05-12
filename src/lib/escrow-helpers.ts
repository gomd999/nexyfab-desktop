/**
 * Escrow ledger helpers — shared between the admin escrow route and the
 * Toss payment-confirm webhook. Without this shared layer, the payment
 * route would either need to call the admin route (auth gymnastics) or
 * duplicate the create+receive transition logic inline.
 *
 * The admin route (POST /api/nexyfab/escrow/[orderId]) still exists for
 * manual ops adjustments; this module just lets the auto-flow piggyback
 * on the same business logic.
 */

import { randomUUID } from 'crypto';
import type { getDbAdapter } from './db-adapter';

type Db = ReturnType<typeof getDbAdapter>;

interface OrderRow {
  user_id: string;
  partner_email: string | null;
  total_price_krw: number;
  status: string;
}

/**
 * Idempotent: if an escrow tx already exists for this order, returns it
 * without creating a duplicate. Otherwise creates a 'pending' row with
 * commission rate resolved from contract → default fallback.
 */
export async function createEscrowForOrder(
  db: Db,
  orderId: string,
  options: { commissionPctOverride?: number } = {},
): Promise<{ created: boolean; escrowId: string; grossKrw: number; commissionKrw: number; netKrw: number } | null> {
  const order = await db.queryOne<OrderRow>(
    'SELECT user_id, partner_email, total_price_krw, status FROM nf_orders WHERE id = ?',
    orderId,
  ).catch(() => null);
  if (!order) return null;
  if (!order.partner_email) return null;

  const existing = await db.queryOne<{
    id: string; gross_amount_krw: number; commission_amount_krw: number; net_amount_krw: number;
  }>(
    'SELECT id, gross_amount_krw, commission_amount_krw, net_amount_krw FROM nf_escrow_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1',
    orderId,
  ).catch(() => null);
  if (existing) {
    return {
      created: false, escrowId: existing.id,
      grossKrw: existing.gross_amount_krw,
      commissionKrw: existing.commission_amount_krw,
      netKrw: existing.net_amount_krw,
    };
  }

  // Resolve commission: explicit override > contract row > platform default.
  // Two paths to the contract: direct quote_id (v83+) or via rfq_id chain
  // (legacy, when an order didn't store its source quote). The accepted
  // quote per RFQ is unique because /api/quotes PATCH auto-rejects others
  // when one is accepted.
  const { COMMISSION_PCT_DEFAULT } = await import('./commission');
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
  const commissionPct = options.commissionPctOverride
    ?? contractRate?.commission_rate
    ?? COMMISSION_PCT_DEFAULT;

  const gross = order.total_price_krw;
  const commission = Math.round(gross * commissionPct / 100);
  const net = gross - commission;
  const id = `escrow_${randomUUID()}`;
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_escrow_transactions
       (id, order_id, buyer_user_id, partner_email, gross_amount_krw,
        commission_pct, commission_amount_krw, net_amount_krw,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id, orderId, order.user_id, order.partner_email, gross,
    commissionPct, commission, net, now, now,
  );

  return { created: true, escrowId: id, grossKrw: gross, commissionKrw: commission, netKrw: net };
}

/**
 * Mark the latest escrow row for an order as 'received'. Called by the
 * Toss payment-confirm path right after status flips to 'paid'.
 */
export async function markEscrowReceived(db: Db, orderId: string): Promise<boolean> {
  const tx = await db.queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM nf_escrow_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1',
    orderId,
  ).catch(() => null);
  if (!tx) return false;
  if (tx.status !== 'pending') return false;
  const now = Date.now();
  await db.execute(
    `UPDATE nf_escrow_transactions
        SET status = 'received', received_at = ?, updated_at = ?
      WHERE id = ?`,
    now, now, tx.id,
  );
  return true;
}
