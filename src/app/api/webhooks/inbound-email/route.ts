/**
 * M5 — Inbound email → thread message webhook.
 *
 * Resend Inbound, SendGrid Inbound Parse, Mailgun, Postmark — they all
 * POST a parsed JSON when an email arrives at a configured address. We
 * accept the common shape (envelope.to, from, subject, text/html) and
 * route the message into the matching RFQ/Order thread.
 *
 * Address convention:
 *   thread+rfq-{rfqId}@inbox.<your-domain>
 *   thread+order-{orderId}@inbox.<your-domain>
 *
 * NexyFab outbound notifications set this address as `Reply-To`; partner
 * replies bounce back here automatically. No app login required for the
 * partner.
 *
 * Setup (sysadmin):
 *   1. DNS MX record pointing inbox subdomain to your provider
 *   2. Provider rule: forward to {APP_URL}/api/webhooks/inbound-email
 *   3. Set INBOUND_EMAIL_SHARED_SECRET if your provider supports auth header
 *
 * Security: when INBOUND_EMAIL_SHARED_SECRET is set, requests must include
 * `x-inbound-secret: <value>` header. Without that env var, the endpoint
 * accepts unauthenticated POSTs (intended for local dev only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { getDbAdapter } from '@/lib/db-adapter';
import { createNotification } from '@/app/lib/notify';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADDRESS_PATTERN = /^thread\+(?:(rfq|order))-([a-zA-Z0-9_-]+)@/;
const MAX_INBOUND_BODY_BYTES = 1024 * 1024;

function secretsEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

interface InboundPayload {
  // Resend / Postmark
  from?: string | { email?: string };
  to?: string | Array<string | { email?: string }>;
  subject?: string;
  text?: string;
  html?: string;
  // SendGrid Inbound Parse
  envelope?: { from?: string; to?: string | string[] };
}

function extractEmail(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  // Match the first email in the string (handles "Name <foo@bar.com>" too).
  // Case is preserved — thread+{kind}-{id}@... IDs can be mixed case
  // ("O42" stays "O42"). Sender email comparison is normalized later
  // via normPartnerEmail so case differences in domains don't bite.
  const m = s.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : null;
}

function pickRecipient(p: InboundPayload): string | null {
  if (Array.isArray(p.to)) {
    for (const item of p.to) {
      const e = extractEmail(typeof item === 'string' ? item : item?.email ?? '');
      if (e && ADDRESS_PATTERN.test(e)) return e;
    }
  }
  if (typeof p.to === 'string') {
    const e = extractEmail(p.to);
    if (e && ADDRESS_PATTERN.test(e)) return e;
  }
  // SendGrid format
  const env = p.envelope?.to;
  if (Array.isArray(env)) {
    for (const item of env) {
      const e = extractEmail(item);
      if (e && ADDRESS_PATTERN.test(e)) return e;
    }
  } else if (typeof env === 'string') {
    const e = extractEmail(env);
    if (e && ADDRESS_PATTERN.test(e)) return e;
  }
  return null;
}

function pickFrom(p: InboundPayload): string | null {
  if (typeof p.from === 'string') return extractEmail(p.from);
  if (p.from && typeof p.from === 'object') return extractEmail(p.from.email);
  if (typeof p.envelope?.from === 'string') return extractEmail(p.envelope.from);
  return null;
}

/** Strip HTML to plain text (very conservative — keeps structure
 *  for line breaks, drops scripts/styles). */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strip the typical reply quote block ("> ...", "On X wrote:") so the
 *  thread doesn't accumulate the entire conversation history per message. */
function stripQuoted(text: string): string {
  return text
    .split('\n')
    .reduce<{ kept: string[]; stop: boolean }>((acc, line) => {
      if (acc.stop) return acc;
      // "On Mon, Jan 1, 2026 at 10:00 X wrote:" or Korean "X님이 ... 작성:"
      if (/^On .{0,80}wrote:/i.test(line.trim()) || /작성[:\s]/.test(line)) {
        acc.stop = true;
        return acc;
      }
      // Quote lines starting with ">"
      if (line.trimStart().startsWith('>')) {
        acc.stop = true;
        return acc;
      }
      acc.kept.push(line);
      return acc;
    }, { kept: [], stop: false })
    .kept.join('\n').trim();
}

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  // Reuse the M1 thread messages table.
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
  tableEnsured = true;
}

export async function POST(req: NextRequest) {
  // P2 — rate limit per source IP (provider IP if behind webhook).
  // 1000/hour is generous for any real provider's volume.
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`inbound-email:${ip}`, 1000, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // Production is fail-closed. Development may omit the secret for local fixtures.
  const expected = process.env.INBOUND_EMAIL_SHARED_SECRET;
  if (!expected && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Inbound email secret is not configured' }, { status: 503 });
  }
  if (expected) {
    const got = req.headers.get('x-inbound-secret') ?? '';
    if (!secretsEqual(got, expected)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let raw: string;
  try {
    const rawBytes = await readBoundedRawBody(req, MAX_INBOUND_BODY_BYTES);
    raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch (error) {
    const bodyError = boundedRawBodyError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'payload too large' }, { status: bodyError.status });
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  let payload: InboundPayload;
  try {
    payload = JSON.parse(raw) as InboundPayload;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // 1) figure out which thread this email belongs to
  const recipient = pickRecipient(payload);
  if (!recipient) {
    return NextResponse.json({ error: 'no thread+ recipient address found' }, { status: 400 });
  }
  const m = ADDRESS_PATTERN.exec(recipient);
  if (!m) {
    return NextResponse.json({ error: 'recipient address did not match thread pattern' }, { status: 400 });
  }
  const threadKind = m[1] as 'rfq' | 'order';
  const threadId = m[2];

  // 2) figure out who sent it + verify they're the assigned partner
  const fromEmail = pickFrom(payload);
  if (!fromEmail) {
    return NextResponse.json({ error: 'no from address' }, { status: 400 });
  }
  const senderNorm = normPartnerEmail(fromEmail);

  const db = getDbAdapter();
  await ensureTable(db);

  // Lookup the thread's authorized partner.
  let buyerUserId: string;
  let partnerEmail: string | null;
  if (threadKind === 'rfq') {
    const rfq = await db.queryOne<{ user_id: string; preferred_factory_id: string | null }>(
      'SELECT user_id, preferred_factory_id FROM nf_rfqs WHERE id = ?', threadId,
    ).catch(() => null);
    if (!rfq) return NextResponse.json({ error: 'thread not found' }, { status: 404 });
    const accepted = await db.queryOne<{ partner_email: string | null }>(
      `SELECT partner_email FROM nf_quotes WHERE inquiry_id = ? AND status = 'accepted' LIMIT 1`, threadId,
    ).catch(() => null);
    partnerEmail = accepted?.partner_email ?? null;
    if (!partnerEmail && rfq.preferred_factory_id) {
      const f = await db.queryOne<{ partner_email: string | null }>(
        'SELECT partner_email FROM nf_factories WHERE id = ?', rfq.preferred_factory_id,
      ).catch(() => null);
      partnerEmail = f?.partner_email ?? null;
    }
    buyerUserId = rfq.user_id;
  } else {
    const order = await db.queryOne<{ user_id: string; partner_email: string | null }>(
      'SELECT user_id, partner_email FROM nf_orders WHERE id = ?', threadId,
    ).catch(() => null);
    if (!order) return NextResponse.json({ error: 'thread not found' }, { status: 404 });
    partnerEmail = order.partner_email;
    buyerUserId = order.user_id;
  }

  if (!partnerEmail || normPartnerEmail(partnerEmail) !== senderNorm) {
    // We could relax this to allow the buyer's email too, but for V1
    // we treat inbound mail as partner-only (matches the typical
    // "partner replies from their inbox" scenario).
    return NextResponse.json({ error: 'sender does not match thread partner' }, { status: 403 });
  }

  // 3) build the body — prefer text, fall back to HTML stripped.
  const rawText = typeof payload.text === 'string' && payload.text.trim().length > 0
    ? payload.text
    : (typeof payload.html === 'string' ? htmlToText(payload.html) : '');
  const body = stripQuoted(rawText).slice(0, 5000);
  if (!body) {
    return NextResponse.json({ error: 'empty body after quote strip' }, { status: 400 });
  }

  // 4) insert as a message
  const msgId = `msg_${randomUUID()}`;
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_thread_messages
       (id, thread_kind, thread_id, sender_user_id, sender_partner_email, sender_type, body, attachments_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'partner', ?, NULL, ?)`,
    msgId, threadKind, threadId, null, senderNorm, body, now,
  );

  // 5) notify the buyer
  void createNotification(
    buyerUserId,
    'message.new',
    `Partner reply on ${threadKind === 'rfq' ? 'RFQ' : 'order'} ${threadId}`,
    body.slice(0, 120),
  );

  return NextResponse.json({ ok: true, messageId: msgId, threadKind, threadId }, { status: 201 });
}
