/**
 * M1 — In-app message thread for RFQ or Order.
 *
 *   GET  /api/nexyfab/threads/{kind}/{id}/messages
 *     → { messages: [{id, sender, senderType, body, attachments, createdAt, readAt}] }
 *
 *   POST /api/nexyfab/threads/{kind}/{id}/messages
 *     body: { body, attachments? }
 *     → 201 { message }
 *
 * `kind` ∈ 'rfq' | 'order'. Both buyer (rfq.user_id / order.user_id) and
 * the assigned partner (factory.partner_email) can read + write.
 *
 * The buyer ↔ partner conversation that was previously stuck in email
 * now lives here so timestamps, ordering, and attachment links are
 * permanent + searchable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { createNotification } from '@/app/lib/notify';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ThreadKind = 'rfq' | 'order';

const VALID_KINDS = new Set<ThreadKind>(['rfq', 'order']);

interface MessageRow {
  id: string;
  thread_kind: string;
  thread_id: string;
  sender_user_id: string | null;
  sender_partner_email: string | null;
  sender_type: string;       // 'buyer' | 'partner' | 'admin' | 'system'
  body: string;
  attachments_json: string | null;
  read_at: number | null;
  created_at: number;
}

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_thread_messages (
      id TEXT PRIMARY KEY,
      thread_kind TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      sender_user_id TEXT,
      sender_partner_email TEXT,
      sender_type TEXT NOT NULL,
      body TEXT NOT NULL,
      attachments_json TEXT,
      read_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_thread_msgs ON nf_thread_messages(thread_kind, thread_id, created_at)').catch(() => {});
  tableEnsured = true;
}

/** Resolve who's allowed to read/write this thread. Returns {buyerUserId,
 *  partnerEmail} if the kind+id resolves to a real RFQ/order, else null. */
async function resolveThreadParties(
  db: ReturnType<typeof getDbAdapter>,
  kind: ThreadKind,
  id: string,
): Promise<{ buyerUserId: string; partnerEmail: string | null } | null> {
  if (kind === 'rfq') {
    const r = await db.queryOne<{ user_id: string; preferred_factory_id: string | null; status: string }>(
      'SELECT user_id, preferred_factory_id, status FROM nf_rfqs WHERE id = ?', id,
    ).catch(() => null);
    if (!r) return null;
    // Look up partner email via the accepted quote (if any) or preferred factory.
    let partnerEmail: string | null = null;
    const acceptedQuote = await db.queryOne<{ partner_email: string | null }>(
      `SELECT partner_email FROM nf_quotes WHERE inquiry_id = ? AND status = 'accepted' LIMIT 1`, id,
    ).catch(() => null);
    if (acceptedQuote?.partner_email) {
      partnerEmail = acceptedQuote.partner_email;
    } else if (r.preferred_factory_id) {
      const f = await db.queryOne<{ partner_email: string | null }>(
        'SELECT partner_email FROM nf_factories WHERE id = ?', r.preferred_factory_id,
      ).catch(() => null);
      partnerEmail = f?.partner_email ?? null;
    }
    return { buyerUserId: r.user_id, partnerEmail };
  }
  // order
  const o = await db.queryOne<{ user_id: string; partner_email: string | null }>(
    'SELECT user_id, partner_email FROM nf_orders WHERE id = ?', id,
  ).catch(() => null);
  if (!o) return null;
  return { buyerUserId: o.user_id, partnerEmail: o.partner_email };
}

function rowToMessage(r: MessageRow) {
  let attachments: string[] = [];
  try { attachments = r.attachments_json ? JSON.parse(r.attachments_json) : []; } catch { /* skip */ }
  return {
    id: r.id,
    threadKind: r.thread_kind,
    threadId: r.thread_id,
    senderUserId: r.sender_user_id,
    senderPartnerEmail: r.sender_partner_email,
    senderType: r.sender_type,
    body: r.body,
    attachments,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { kind, id } = await params;
  if (!VALID_KINDS.has(kind as ThreadKind)) {
    return NextResponse.json({ error: 'kind must be rfq or order' }, { status: 400 });
  }
  const db = getDbAdapter();
  await ensureTable(db);

  const parties = await resolveThreadParties(db, kind as ThreadKind, id);
  if (!parties) return NextResponse.json({ error: 'thread not found' }, { status: 404 });

  // Access: only the buyer or the partner can read.
  const isBuyer = auth.userId === parties.buyerUserId;
  const isPartner = !!parties.partnerEmail && normPartnerEmail(auth.email ?? '') === normPartnerEmail(parties.partnerEmail);
  if (!isBuyer && !isPartner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await db.queryAll<MessageRow>(
    `SELECT * FROM nf_thread_messages
       WHERE thread_kind = ? AND thread_id = ?
    ORDER BY created_at ASC LIMIT 500`,
    kind, id,
  ).catch((): MessageRow[] => []);

  // Mark-as-read for the recipient: messages I didn't send and don't yet have read_at.
  const recipientType = isBuyer ? 'buyer' : 'partner';
  const otherSenderType = isBuyer ? 'partner' : 'buyer';
  const now = Date.now();
  for (const r of rows) {
    if (r.sender_type === otherSenderType && r.read_at === null) {
      await db.execute('UPDATE nf_thread_messages SET read_at = ? WHERE id = ?', now, r.id).catch(() => {});
      r.read_at = now;
    }
  }
  void recipientType;

  return NextResponse.json({ ok: true, messages: rows.map(rowToMessage) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // P2 — rate limit: 60 messages per user per 5 minutes is more than
  // enough for human conversation; blocks spam loops.
  const rl = rateLimit(`thread-msg:${auth.userId}`, 60, 5 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT' }, { status: 429 });
  }

  const { kind, id } = await params;
  if (!VALID_KINDS.has(kind as ThreadKind)) {
    return NextResponse.json({ error: 'kind must be rfq or order' }, { status: 400 });
  }

  let body: { body?: unknown; attachments?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 5000) : '';
  if (!text) return NextResponse.json({ error: 'body is required (≤5000 chars)' }, { status: 400 });
  // Restrict attachments to http(s) URLs — defense-in-depth against
  // javascript:/data: vectors that could surface as clickable links in
  // the thread UI.
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .filter((a): a is string => typeof a === 'string' && /^https?:\/\//.test(a))
        .slice(0, 10)
    : [];

  const db = getDbAdapter();
  await ensureTable(db);

  const parties = await resolveThreadParties(db, kind as ThreadKind, id);
  if (!parties) return NextResponse.json({ error: 'thread not found' }, { status: 404 });

  const isBuyer = auth.userId === parties.buyerUserId;
  const isPartner = !!parties.partnerEmail && normPartnerEmail(auth.email ?? '') === normPartnerEmail(parties.partnerEmail);
  if (!isBuyer && !isPartner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const senderType = isBuyer ? 'buyer' : 'partner';
  const msgId = `msg_${randomUUID()}`;
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_thread_messages
       (id, thread_kind, thread_id, sender_user_id, sender_partner_email, sender_type, body, attachments_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    msgId, kind, id,
    isBuyer ? auth.userId : null,
    isBuyer ? null : (parties.partnerEmail ?? auth.email ?? ''),
    senderType,
    text,
    attachments.length > 0 ? JSON.stringify(attachments) : null,
    now,
  );

  // Notify the other side (fire-and-forget). Currently only delivers to
  // the buyer's user account — partner notifications go via createNotification
  // when a partner-user account exists; the email path (M5) covers partners
  // who haven't claimed an account yet.
  if (isPartner) {
    void createNotification(
      parties.buyerUserId,
      'message.new',
      `Partner reply on ${kind === 'rfq' ? 'RFQ' : 'order'} ${id}`,
      text.slice(0, 120),
    );
  }
  // Buyer→partner notification: partner-side notification system uses a
  // separate dispatch (email + partner inbox) which is out of scope for M1.
  // M5 (inbound email) is the matching outbound path.

  return NextResponse.json({
    ok: true,
    message: {
      id: msgId,
      threadKind: kind,
      threadId: id,
      senderType,
      body: text,
      attachments,
      readAt: null,
      createdAt: now,
    },
  }, { status: 201 });
}
