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
import { sendEmail, rfqAssignedToFactoryHtml } from '@/lib/nexyfab-email';
import { createNotification } from '@/app/lib/notify';
import { logAudit } from '@/lib/audit';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

interface RfqRow {
  id: string;
  material_id: string | null;
  dfm_process: string | null;
  volume_cm3: number | null;
  quantity: number;
  shape_name: string | null;
  status: string;
}

interface FactoryRow {
  id: string;
  name: string;
  partner_email: string | null;
  contact_email: string | null;
  processes: string | null; // JSON text array
  rating: number | null;
  price_level: number | null;
}

interface ScoredFactory extends FactoryRow {
  score: number;
}

function scoreFactory(rfq: RfqRow, factory: FactoryRow): number {
  let score = 10; // base

  // Process match: +40
  if (rfq.dfm_process && factory.processes) {
    try {
      const procs: string[] = JSON.parse(factory.processes);
      if (Array.isArray(procs) && procs.includes(rfq.dfm_process)) {
        score += 40;
      }
    } catch {
      // malformed JSON — skip process score
    }
  }

  // Rating: (rating / 5) * 30 — clamped [0, 30]
  const rating = typeof factory.rating === 'number' ? factory.rating : 0;
  const ratingScore = (Math.min(5, Math.max(0, rating)) / 5) * 30;
  score += ratingScore;

  // Price level: lower price_level = higher score
  // price_level expected range: 1–3
  // (3 - price_level) / 2 * 20 → price_level=1 → 20, price_level=2 → 10, price_level=3 → 0
  const priceLevel = typeof factory.price_level === 'number' ? factory.price_level : 3;
  const clamped = Math.min(3, Math.max(1, priceLevel));
  const priceScore = ((3 - clamped) / 2) * 20;
  score += priceScore;

  return Math.round(score * 100) / 100;
}

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { rfqId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { rfqId } = body;
  if (!rfqId || typeof rfqId !== 'string') {
    return NextResponse.json({ error: 'rfqId is required' }, { status: 400 });
  }

  const db = getDbAdapter();

  // ── 1. Fetch the RFQ ──────────────────────────────────────────────────────────
  const rfq = await db.queryOne<RfqRow>(
    `SELECT id, material_id, dfm_process, volume_cm3, quantity, shape_name, status
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

  // ── 3. Score each factory ─────────────────────────────────────────────────────
  const scored: ScoredFactory[] = factories.map((f) => ({
    ...f,
    score: scoreFactory(rfq, f),
  }));

  // ── 4. Sort by score descending, pick top ─────────────────────────────────────
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

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
      });
      await sendEmail(bestEmail, '새 견적 요청이 배정되었습니다', html);
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
    { quoteId: rfqId },
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
    },
  });

  // ── 9. Return result ──────────────────────────────────────────────────────────
  return NextResponse.json({
    rfqId,
    factoryId: best.id,
    factoryName: best.name,
    score: best.score,
    status: 'assigned',
  });
}
