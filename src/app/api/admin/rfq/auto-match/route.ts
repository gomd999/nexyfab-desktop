/**
 * POST /api/admin/rfq/auto-match
 * Auto-match an RFQ to the best-scoring active factory.
 *
 * Scoring (0–100 total):
 *   +10 base always
 *   +40 process match (dfm_process ∈ factory.processes[])
 *   +30 rating  = (factory.rating / 5) * 30
 *   +20 price   = ((3 - factory.price_level) / 2) * 20  (lower price = better)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendEmail, rfqAssignedToFactoryHtml, rfqNotificationEmailSubject, nexyfabEmailLocaleFromLanguageTag } from '@/lib/nexyfab-email';
import { createNotification } from '@/app/lib/notify';
import { logAudit } from '@/lib/audit';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
// Helpers + types live in a sibling module: Next.js 16 forbids non-handler
// exports from a route file (only GET/POST/… + route config are allowed).
import { type RfqRow, type FactoryRow, type ScoredFactory, pickAssignedFactory } from './matchSelection';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { rfqId?: string };
  try {
    body = await readBoundedJson(req, 64 * 1024);
  } catch (error) {
    if (boundedJsonError(error)?.status === 413) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { rfqId } = body;
  if (!rfqId || typeof rfqId !== 'string') {
    return NextResponse.json({ error: 'rfqId is required' }, { status: 400 });
  }

  const db = getDbAdapter();

  // ── 1. Fetch the RFQ ──────────────────────────────────────────────────────────
  const rfq = await db.queryOne<RfqRow>(
    `SELECT id, material_id, dfm_process, volume_cm3, quantity, shape_name, status,
            preferred_factory_id
     FROM nf_rfqs
     WHERE id = ? AND user_id <> 'demo-user'`,
    rfqId,
  );

  if (!rfq) {
    return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
  }

  // ── 2. Fetch active factories ─────────────────────────────────────────────────
  const factories = await db.queryAll<FactoryRow>(
    `SELECT id, name, partner_email, contact_email, processes, rating, price_level
     FROM nf_factories
     WHERE status = 'active'`,
  );

  if (factories.length === 0) {
    return NextResponse.json({ error: 'No active factories available' }, { status: 404 });
  }

  // ── 3. Pick the factory — customer preference wins, else best score ───────────
  const picked = pickAssignedFactory(rfq, factories);
  if (!picked) {
    return NextResponse.json({ error: 'No active factories available' }, { status: 404 });
  }
  const best: ScoredFactory = { ...picked.factory, score: picked.score };
  const preferred = picked.matchedBy === 'preference';

  // ── 5. Update the RFQ ────────────────────────────────────────────────────────
  const now = Date.now();
  await db.execute(
    `UPDATE nf_rfqs
     SET assigned_factory_id = ?,
         assigned_factory_name = ?,
         status = 'assigned',
         updated_at = ?
     WHERE id = ?`,
    best.id,
    best.name,
    now,
    rfqId,
  );

  // ── 6. Send assignment email to factory ───────────────────────────────────────
  const bestEmail = best.partner_email || best.contact_email;
  if (bestEmail) {
    try {
      const html = rfqAssignedToFactoryHtml({
        factoryName: best.name,
        rfqId: rfq.id,
        shapeName: rfq.shape_name || '부품',
        materialId: rfq.material_id || '-',
        quantity: rfq.quantity,
        lang: req.headers.get('accept-language') || undefined,
      });
      await sendEmail(bestEmail, rfqNotificationEmailSubject(nexyfabEmailLocaleFromLanguageTag(req.headers.get('accept-language')), 'new_rfq', { shapeName: rfq.shape_name || rfq.id, rfqIdPrefix: rfq.id.slice(0, 8) }), html);
    } catch (err) {
      console.error('[auto-match] Failed to send assignment email:', err);
      // Non-fatal: continue
    }
  }

  // ── 7. Create notification for factory partner ────────────────────────────────
  const partnerKey = bestEmail
    ? `partner:${normPartnerEmail(bestEmail)}`
    : `factory:${best.id}`;

  createNotification(
    partnerKey,
    'rfq_assigned',
    '새 견적 요청이 배정되었습니다',
    `RFQ ${rfqId.slice(0, 8).toUpperCase()} — ${rfq.shape_name || '부품'} 견적이 귀사에 배정되었습니다.`,
    { rfqId },
  );

  // ── 8. Audit log ──────────────────────────────────────────────────────────────
  logAudit({
    userId: 'admin',
    action: 'rfq.auto_match',
    resourceId: rfqId,
    metadata: {
      factoryId: best.id,
      factoryName: best.name,
      score: best.score,
      matchedBy: preferred ? 'preference' : 'score',
    },
  });

  // ── 9. Return result ──────────────────────────────────────────────────────────
  return NextResponse.json({
    rfqId,
    factoryId: best.id,
    factoryName: best.name,
    score: best.score,
    matchedBy: preferred ? 'preference' : 'score',
    status: 'assigned',
  });
}
