/**
 * POST /api/nexyfab/orders/[id]/dispute
 *
 * Buyer-triggered escrow dispute. Flips the latest escrow row to
 * 'disputed' and notifies ops + partner so the conflict can be resolved
 * before funds are released.
 *
 * Without this endpoint, only admins could call mark_disputed — buyers
 * had no UI path to raise a complaint, which would have forced every
 * dispute through email/CS and delayed resolution.
 *
 * Body: { reason: string, evidence?: string[] }
 *   - reason: required, ≤500 chars, describes what's wrong
 *   - evidence: optional file URLs (photos/docs), stored as JSON in notes
 *
 * Auth: order.user_id must match. Open only while escrow status ∈
 * { 'received', 'held' } — once 'released' or 'refunded', dispute window
 * has closed and operator must intervene manually.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DISPUTABLE_STATUSES = new Set(['received', 'held']);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: orderId } = await params;

  let body: { reason?: unknown; evidence?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!reason) {
    return NextResponse.json({ error: 'reason required (max 500 chars)' }, { status: 400 });
  }
  const evidence = Array.isArray(body.evidence)
    ? body.evidence.filter((u): u is string => typeof u === 'string').slice(0, 10)
    : [];

  const db = getDbAdapter();

  const order = await db.queryOne<{
    user_id: string; partner_email: string | null;
  }>(
    'SELECT user_id, partner_email FROM nf_orders WHERE id = ?',
    orderId,
  );
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.user_id !== auth.userId) {
    return NextResponse.json({ error: 'Forbidden — only the buyer can open a dispute' }, { status: 403 });
  }

  const tx = await db.queryOne<{ id: string; status: string; notes: string | null }>(
    'SELECT id, status, notes FROM nf_escrow_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1',
    orderId,
  );
  if (!tx) {
    return NextResponse.json({
      error: 'No escrow transaction yet — payment may not have completed',
    }, { status: 404 });
  }
  if (!DISPUTABLE_STATUSES.has(tx.status)) {
    return NextResponse.json({
      error: `Cannot dispute escrow in '${tx.status}' state. Contact ops if you believe this is in error.`,
    }, { status: 400 });
  }

  const now = Date.now();
  // Append the dispute reason into the notes field as a structured entry.
  // Operator-set notes (admin via /admin/escrow) coexist with buyer disputes.
  let notesObj: Record<string, unknown> = {};
  try { notesObj = tx.notes ? JSON.parse(tx.notes) : {}; } catch { notesObj = { legacy: tx.notes }; }
  notesObj.disputeOpenedAt = now;
  notesObj.disputeReason = reason;
  notesObj.disputeEvidence = evidence;
  notesObj.disputeOpenedBy = auth.userId;

  await db.execute(
    `UPDATE nf_escrow_transactions
        SET status = 'disputed', notes = ?, updated_at = ?
      WHERE id = ?`,
    JSON.stringify(notesObj), now, tx.id,
  );

  // Notify ops + partner so they're aware before any release attempt.
  try {
    const { createNotification } = await import('@/app/lib/notify');
    void createNotification(
      'admin',
      'escrow_disputed',
      `🚨 분쟁 발생 — 주문 ${orderId.slice(0, 12)}`,
      `${reason.slice(0, 100)} (${evidence.length}개 증거 첨부)`,
    );
    if (order.partner_email) {
      const { normPartnerEmail } = await import('@/lib/partner-factory-access');
      void createNotification(
        `partner:${normPartnerEmail(order.partner_email)}`,
        'escrow_disputed',
        '발주처에서 이의를 제기했습니다',
        `주문 ${orderId.slice(0, 12)} 정산이 보류됩니다. 운영팀이 곧 연락드립니다.`,
      );
    }
  } catch { /* non-blocking */ }

  // Funnel signal — disputes are a critical metric for operations.
  try {
    const { logFunnelEvent } = await import('@/lib/funnel-logger');
    await logFunnelEvent(auth.userId, {
      eventType: 'escrow_disputed',
      contextType: 'order', contextId: orderId,
      metadata: { reason: reason.slice(0, 100), evidenceCount: evidence.length },
    });
  } catch { /* non-blocking */ }

  return NextResponse.json({
    ok: true,
    orderId,
    escrowStatus: 'disputed',
    nextSteps: '운영팀이 1-2영업일 내 양측에 연락하여 합의를 시도합니다. 합의 실패 시 KCAB 중재 절차로 진행합니다.',
  });
}
