/**
 * GET /api/partner/hub-summary
 *
 * Lightweight summary for the partner Hub landing page. Returns the
 * three at-a-glance numbers (today's RFQs, upcoming settlement amount,
 * portfolio views in last 7 days) plus the onboarding-funnel state.
 *
 * Falls back to all-zero / all-false when unauthenticated so the Hub
 * page can render a preview shell for first-time visitors who arrived
 * from the customer sidebar without a partner session yet.
 *
 * Schema notes
 *   • RFQs awaiting partner response → `nf_quotes` where status is
 *     `created`/`pending` and `partner_email` matches.
 *   • Upcoming settlement → completed `nf_contracts` rows for the
 *     partner that have not yet been paid out. Mirrors
 *     `/api/partner/settlements` aggregation.
 *   • Portfolio views & dedicated profile/portfolio tables don't exist
 *     yet (factory record substitutes for profile completion); those
 *     fields stay zero/false here and are TODO-flagged for the
 *     factories-schema follow-up.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { findFactoryForPartnerEmail, normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

interface FunnelFlags {
  step1: boolean; // account exists (authenticated = true)
  step2: boolean; // factory profile filled
  step3: boolean; // portfolio uploaded — not yet tracked in schema
  step4: boolean; // first RFQ response submitted
}

const EMPTY = {
  todayRfqCount: 0,
  upcomingSettlementKrw: 0,
  portfolioViews7d: 0,
  funnel: { step1: false, step2: false, step3: false, step4: false } satisfies FunnelFlags,
  company: null as string | null,
};

export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) {
    // Hub renders a guest preview using these zeros — DO NOT 401, the
    // Hub page is the entrypoint for unauthenticated visitors coming
    // from the customer side.
    return NextResponse.json(EMPTY);
  }

  const db = getDbAdapter();
  const partnerEmail = normPartnerEmail(partner.email);

  try {
    const factory = await findFactoryForPartnerEmail(partner.email, { activeOnly: true });

    // ── 1) RFQ awaiting partner response (nf_quotes) ─────────────────────────
    const rfqRow = await db.queryOne<{ n: number }>(
      `SELECT COUNT(*) as n FROM nf_quotes
         WHERE LOWER(TRIM(partner_email)) = ?
           AND status IN ('created', 'pending')`,
      partnerEmail,
    ).catch(() => null);

    // ── 2) Upcoming settlement — completed contracts not yet paid out ─────────
    const settleRow = await db.queryOne<{ total: number | null }>(
      `SELECT COALESCE(SUM(
          COALESCE(contract_amount, 0)
            - COALESCE(gross_commission,
                       CAST(COALESCE(contract_amount, 0) * COALESCE(commission_rate, 5) / 100 AS INTEGER))
       ), 0) as total
       FROM nf_contracts
        WHERE status = 'completed'
          AND LOWER(TRIM(partner_email)) = ?`,
      partnerEmail,
    ).catch(() => null);

    // ── 3) Portfolio views — not yet tracked; placeholder 0 ──────────────────
    const portfolioViews7d = 0;

    // ── 4) Funnel flags ──────────────────────────────────────────────────────
    const firstQuoteRow = await db.queryOne<{ n: number }>(
      `SELECT COUNT(*) as n FROM nf_quotes
         WHERE LOWER(TRIM(partner_email)) = ?
           AND status NOT IN ('created', 'pending')`,
      partnerEmail,
    ).catch(() => null);

    const funnel: FunnelFlags = {
      step1: true,
      step2: !!(factory && factory.name && factory.name.trim().length > 0),
      step3: false,
      step4: (firstQuoteRow?.n ?? 0) > 0,
    };

    return NextResponse.json({
      todayRfqCount: rfqRow?.n ?? 0,
      upcomingSettlementKrw: settleRow?.total ?? 0,
      portfolioViews7d,
      funnel,
      company: factory?.name ?? null,
    });
  } catch {
    return NextResponse.json(EMPTY);
  }
}
