/**
 * M4 — Order milestone uploads (partner → buyer visibility).
 *
 * GET  /api/nexyfab/orders/{id}/milestones
 *   → { milestones: [{id, step, note, attachments, createdAt, by}] }
 *
 * POST /api/nexyfab/orders/{id}/milestones
 *   body: { step, note?, attachments? }
 *   → 201 { milestone }
 *
 * `step` mirrors the order's progression: 'production_start' | 'qc' |
 * 'packing' | 'shipped' | 'note'. The buyer sees a chronological feed
 * with photos/links so "where is my order?" never has to be asked.
 *
 * Only the assigned partner can POST. Both buyer + partner can GET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { createNotification } from '@/app/lib/notify';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STEPS = new Set(['production_start', 'qc', 'packing', 'shipped', 'note']);

interface MilestoneRow {
  id: string;
  order_id: string;
  step: string;
  note: string | null;
  attachments_json: string | null;
  by_partner_email: string;
  created_at: number;
}

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_order_milestones (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      step TEXT NOT NULL,
      note TEXT,
      attachments_json TEXT,
      by_partner_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_order_milestones ON nf_order_milestones(order_id, created_at)').catch(() => {});
  tableEnsured = true;
}

async function resolveOrder(db: ReturnType<typeof getDbAdapter>, id: string): Promise<{ buyerUserId: string; partnerEmail: string | null } | null> {
  const o = await db.queryOne<{ user_id: string; partner_email: string | null }>(
    'SELECT user_id, partner_email FROM nf_orders WHERE id = ?', id,
  ).catch(() => null);
  if (!o) return null;
  return { buyerUserId: o.user_id, partnerEmail: o.partner_email };
}

function rowToMilestone(r: MilestoneRow) {
  let attachments: string[] = [];
  try { attachments = r.attachments_json ? JSON.parse(r.attachments_json) : []; } catch { /* skip */ }
  return {
    id: r.id, orderId: r.order_id, step: r.step, note: r.note,
    attachments, byPartnerEmail: r.by_partner_email, createdAt: r.created_at,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();
  await ensureTable(db);

  const order = await resolveOrder(db, id);
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 });

  const isBuyer = auth.userId === order.buyerUserId;
  const isPartner = !!order.partnerEmail && normPartnerEmail(auth.email ?? '') === normPartnerEmail(order.partnerEmail);
  if (!isBuyer && !isPartner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await db.queryAll<MilestoneRow>(
    `SELECT * FROM nf_order_milestones WHERE order_id = ? ORDER BY created_at ASC LIMIT 100`,
    id,
  ).catch((): MilestoneRow[] => []);

  return NextResponse.json({ ok: true, milestones: rows.map(rowToMilestone) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body: { step?: unknown; note?: unknown; attachments?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const step = typeof body.step === 'string' ? body.step : '';
  if (!VALID_STEPS.has(step)) {
    return NextResponse.json({ error: `step must be one of: ${Array.from(VALID_STEPS).join(', ')}` }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : null;
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .filter((a): a is string => typeof a === 'string' && /^https?:\/\//.test(a))
        .slice(0, 12)
    : [];

  if (!note && attachments.length === 0) {
    return NextResponse.json({ error: 'either note or at least one attachment is required' }, { status: 400 });
  }

  const db = getDbAdapter();
  await ensureTable(db);

  const order = await resolveOrder(db, id);
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 });

  const isPartner = !!order.partnerEmail && normPartnerEmail(auth.email ?? '') === normPartnerEmail(order.partnerEmail);
  if (!isPartner) {
    return NextResponse.json({ error: 'Only the assigned partner may post milestones' }, { status: 403 });
  }

  const milestoneId = `mil_${randomUUID()}`;
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_order_milestones
       (id, order_id, step, note, attachments_json, by_partner_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    milestoneId, id, step, note,
    attachments.length > 0 ? JSON.stringify(attachments) : null,
    normPartnerEmail(order.partnerEmail!),
    now,
  );

  // Notify the buyer.
  void createNotification(
    order.buyerUserId,
    'order.milestone',
    `Order ${id} — ${step}`,
    note ? note.slice(0, 120) : `${attachments.length} attachment(s)`,
  );

  return NextResponse.json({
    ok: true,
    milestone: {
      id: milestoneId, orderId: id, step, note, attachments,
      byPartnerEmail: normPartnerEmail(order.partnerEmail!),
      createdAt: now,
    },
  }, { status: 201 });
}
