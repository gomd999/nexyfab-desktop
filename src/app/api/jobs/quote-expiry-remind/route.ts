/**
 * GET/POST /api/jobs/quote-expiry-remind
 * Enqueues idempotent customer and partner reminders for quotes expiring within 24 hours.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { verifyAdmin } from '@/lib/admin-auth';
import { enqueueJob } from '@/lib/job-queue';
import { nexyfabEmailLocaleFromLanguageTag } from '@/lib/nexyfab-email';
import { buildQuoteExpiryEmail } from './quoteExpiryEmail';

export const dynamic = 'force-dynamic';

async function runRemind(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret')
    ?? req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  const isAdmin = await verifyAdmin(req);
  const isCron = !!expected && cronSecret === expected;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;

  type QuoteRow = {
    id: string; inquiry_id: string; factory_name: string; partner_email: string | null;
    estimated_amount: number; valid_until: string; status: string;
  };
  const expiringQuotes = await db.queryAll<QuoteRow>(
    `SELECT id, inquiry_id, factory_name, partner_email, estimated_amount, valid_until, status
     FROM nf_quotes
     WHERE status IN ('pending', 'responded')
       AND valid_until IS NOT NULL
       AND valid_until > datetime(?, 'unixepoch', 'milliseconds')
       AND valid_until < datetime(?, 'unixepoch', 'milliseconds')`,
    now, in24h,
  ).catch((): QuoteRow[] => []);

  let enqueued = 0;
  let skipped = 0;

  for (const quote of expiringQuotes) {
    const rfq = await db.queryOne<{ id: string; shape_name: string; user_id: string }>(
      'SELECT id, shape_name, user_id FROM nf_rfqs WHERE id = ?',
      quote.inquiry_id,
    ).catch(() => null);
    if (!rfq) continue;

    const user = await db.queryOne<{ email: string; name: string | null; language: string | null }>(
      'SELECT email, name, language FROM nf_users WHERE id = ?',
      rfq.user_id,
    ).catch(() => null);
    const partnerUser = quote.partner_email
      ? await db.queryOne<{ language: string | null }>(
        'SELECT language FROM nf_users WHERE lower(email) = lower(?) LIMIT 1',
        quote.partner_email,
      ).catch(() => null)
      : null;
    const hoursLeft = Math.max(1, Math.round((new Date(quote.valid_until).getTime() - now) / 3_600_000));

    if (user?.email) {
      const logId = `remind-cust-${quote.id}`;
      const alreadySent = await db.queryOne<{ id: string }>(
        'SELECT id FROM nf_quote_remind_log WHERE id = ?', logId,
      ).catch(() => null);

      if (!alreadySent) {
        const email = buildQuoteExpiryEmail({
          locale: nexyfabEmailLocaleFromLanguageTag(user.language),
          recipientName: user.name || user.email,
          quoteId: quote.id,
          rfqShapeName: rfq.shape_name,
          quoteAmount: quote.estimated_amount,
          validUntil: quote.valid_until,
          hoursLeft,
          rfqId: rfq.id,
          recipientType: 'customer',
        });
        await enqueueJob('send_email', { to: user.email, ...email });
        await db.execute(
          'INSERT INTO nf_quote_remind_log (id, quote_id, recipient, sent_at) VALUES (?,?,?,?)',
          logId, quote.id, user.email, now,
        ).catch(() => {});
        enqueued++;
      } else {
        skipped++;
      }
    }

    if (quote.partner_email) {
      const logId = `remind-partner-${quote.id}`;
      const alreadySent = await db.queryOne<{ id: string }>(
        'SELECT id FROM nf_quote_remind_log WHERE id = ?', logId,
      ).catch(() => null);

      if (!alreadySent) {
        const email = buildQuoteExpiryEmail({
          locale: nexyfabEmailLocaleFromLanguageTag(partnerUser?.language),
          recipientName: quote.factory_name || quote.partner_email,
          quoteId: quote.id,
          rfqShapeName: rfq.shape_name,
          quoteAmount: quote.estimated_amount,
          validUntil: quote.valid_until,
          hoursLeft,
          rfqId: rfq.id,
          recipientType: 'partner',
        });
        await enqueueJob('send_email', { to: quote.partner_email, ...email });
        await db.execute(
          'INSERT INTO nf_quote_remind_log (id, quote_id, recipient, sent_at) VALUES (?,?,?,?)',
          logId, quote.id, quote.partner_email, now,
        ).catch(() => {});
        enqueued++;
      } else {
        skipped++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    checked: expiringQuotes.length,
    enqueued,
    skipped,
    runAt: new Date(now).toISOString(),
  });
}

export async function POST(req: NextRequest) { return runRemind(req); }
export async function GET(req: NextRequest) { return runRemind(req); }
