/**
 * Q — Concierge status API.
 *
 * GET  /api/nexyfab/concierge/{rfqId}
 *   → { entries: [...], rfq: { ownerId, status } }
 *   Buyer view: only public-visible fields.
 *   Admin view: includes private notes.
 *
 * POST /api/nexyfab/concierge/{rfqId}
 *   body: { factoryId, status, note?, publicNote? }
 *   Admin only — adds or updates a concierge entry for a (rfq, factory) pair.
 *
 * Status flow: recommended → contacted → responded → quote_drafting →
 *              quote_received → partner_signup
 *              (or → declined at any point)
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { logFunnelEvent, type FunnelEventType } from '@/lib/funnel-logger';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_CONCIERGE_BODY_BYTES = 16 * 1024;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Status =
  | 'recommended' | 'contacted' | 'responded'
  | 'quote_drafting' | 'quote_received'
  | 'partner_signup' | 'declined';

const VALID_STATUSES = new Set<Status>([
  'recommended', 'contacted', 'responded',
  'quote_drafting', 'quote_received',
  'partner_signup', 'declined',
]);

interface ConciergeRow {
  id: string;
  rfq_id: string;
  factory_id: string;
  status: string;
  last_note: string | null;
  public_note: boolean;
  last_action_at: number;
  last_action_by: string | null;
  created_at: number;
  updated_at: number;
}

interface FactoryRow {
  id: string;
  name: string;
  region: string | null;
  partner_email: string | null;
  contact_email: string | null;
}

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_concierge_status (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL,
      factory_id TEXT NOT NULL,
      status TEXT NOT NULL,
      last_note TEXT,
      public_note BOOLEAN NOT NULL DEFAULT FALSE,
      last_action_at BIGINT NOT NULL,
      last_action_by TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS uq_concierge_pair ON nf_concierge_status(rfq_id, factory_id)').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_concierge_rfq ON nf_concierge_status(rfq_id, last_action_at DESC)').catch(() => {});
  tableEnsured = true;
}

/** Mask a Korean / English company name keeping the prefix visible. */
function maskName(name: string): string {
  if (!name) return '○○○';
  // Korean common prefixes: (주), (유), (재)
  const corpPrefixMatch = name.match(/^(\(주\)|\(유\)|\(재\)|\(사\))/);
  const prefix = corpPrefixMatch?.[0] ?? '';
  const rest = corpPrefixMatch ? name.slice(prefix.length) : name;
  // Keep first 1-2 chars + mask the rest with circles.
  const visibleCount = Math.min(2, Math.max(1, Math.floor(rest.length / 3)));
  const visible = rest.slice(0, visibleCount);
  const maskedCount = Math.max(2, rest.length - visibleCount);
  return `${prefix}${visible}${'○'.repeat(maskedCount)}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ rfqId: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rfqId } = await params;
  const db = getDbAdapter();
  await ensureTable(db);

  // Verify the user owns this RFQ OR is admin.
  const rfq = await db.queryOne<{ user_id: string; status: string; shape_name: string | null }>(
    'SELECT user_id, status, shape_name FROM nf_rfqs WHERE id = ?', rfqId,
  ).catch(() => null);
  if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

  const isOwner = rfq.user_id === auth.userId;
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await db.queryAll<ConciergeRow>(
    'SELECT * FROM nf_concierge_status WHERE rfq_id = ? ORDER BY last_action_at DESC',
    rfqId,
  ).catch((): ConciergeRow[] => []);

  // Pull factory metadata in one batch.
  const factoryIds = rows.map(r => r.factory_id);
  const factoriesById = new Map<string, FactoryRow>();
  if (factoryIds.length > 0) {
    const placeholders = factoryIds.map(() => '?').join(', ');
    const factories = await db.queryAll<FactoryRow>(
      `SELECT id, name, region, partner_email, contact_email
         FROM nf_factories WHERE id IN (${placeholders})`,
      ...factoryIds,
    ).catch((): FactoryRow[] => []);
    for (const f of factories) factoriesById.set(f.id, f);
  }

  const entries = rows.map(r => {
    const f = factoriesById.get(r.factory_id);
    const showFullName = r.status === 'quote_received' || r.status === 'partner_signup';
    return {
      id: r.id,
      factoryId: r.factory_id,
      displayName: f
        ? (showFullName ? f.name : maskName(f.name))
        : '○○○',
      region: f?.region ?? null,
      status: r.status,
      // Admin sees notes always; buyer sees only when public_note=true.
      note: (isAdmin || r.public_note) ? r.last_note : null,
      publicNote: r.public_note,
      lastActionAt: r.last_action_at,
      lastActionBy: isAdmin ? r.last_action_by : null,
      // Reveal partner email only on signup (then buyer can directly reach out).
      partnerEmail: showFullName ? (f?.partner_email ?? f?.contact_email ?? null) : null,
    };
  });

  return NextResponse.json({
    ok: true,
    rfq: { id: rfqId, status: rfq.status, shapeName: rfq.shape_name },
    entries,
    isAdmin,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ rfqId: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  const { rfqId } = await params;
  let body: { factoryId?: unknown; status?: unknown; note?: unknown; publicNote?: unknown };
  try {
    body = await readBoundedJson(req, MAX_CONCIERGE_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const factoryId = typeof body.factoryId === 'string' ? body.factoryId : '';
  const status = typeof body.status === 'string' ? body.status as Status : 'recommended';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
  const publicNote = body.publicNote === true;

  if (!factoryId) return NextResponse.json({ error: 'factoryId required' }, { status: 400 });
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: `status must be one of: ${Array.from(VALID_STATUSES).join(', ')}` }, { status: 400 });
  }

  const db = getDbAdapter();
  await ensureTable(db);

  const now = Date.now();
  // Upsert by (rfq_id, factory_id) pair.
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_concierge_status WHERE rfq_id = ? AND factory_id = ?',
    rfqId, factoryId,
  ).catch(() => null);

  // Map status → funnel event so /admin/funnel can plot deal velocity by stage.
  const STATUS_FUNNEL: Partial<Record<Status, FunnelEventType>> = {
    recommended:    'concierge_recommended',
    contacted:      'concierge_contacted',
    responded:      'concierge_factory_responded',
    quote_received: 'concierge_quote_received',
    partner_signup: 'concierge_partner_signup',
  };

  if (existing) {
    await db.execute(
      `UPDATE nf_concierge_status
          SET status = ?, last_note = ?, public_note = ?,
              last_action_at = ?, last_action_by = ?, updated_at = ?
        WHERE id = ?`,
      status, note, publicNote, now, auth.userId, now, existing.id,
    );
    const evt = STATUS_FUNNEL[status];
    if (evt) await logFunnelEvent(auth.userId, {
      eventType: evt, contextType: 'rfq', contextId: rfqId,
      metadata: { factoryId, transition: 'update' },
    }).catch(() => {});
    return NextResponse.json({ ok: true, id: existing.id, status });
  }
  const id = `concierge_${randomUUID()}`;
  await db.execute(
    `INSERT INTO nf_concierge_status
       (id, rfq_id, factory_id, status, last_note, public_note,
        last_action_at, last_action_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, rfqId, factoryId, status, note, publicNote, now, auth.userId, now, now,
  );
  const evt = STATUS_FUNNEL[status];
  if (evt) await logFunnelEvent(auth.userId, {
    eventType: evt, contextType: 'rfq', contextId: rfqId,
    metadata: { factoryId, transition: 'insert' },
  }).catch(() => {});
  return NextResponse.json({ ok: true, id, status }, { status: 201 });
}
