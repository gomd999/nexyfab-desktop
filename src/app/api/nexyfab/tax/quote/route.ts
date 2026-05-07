/**
 * POST /api/nexyfab/tax/quote
 *
 * Returns a tax breakdown for a prospective order — the frontend calls
 * this on the checkout step so the buyer sees subtotal/VAT/total before
 * confirming, and so any reverse-charge note is surfaced upfront.
 *
 * The caller must be authenticated (no anonymous tax lookups — we treat
 * this as a billing operation and log per-user). VAT ID validation is
 * best-effort (fail-open in the engine); the id is always recorded.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { calculateTax, validateVatId } from '@/lib/tax-engine';
import type { CountryCode, CurrencyCode } from '@/lib/country-pricing';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    amount?:        number;
    currency?:      string;
    sellerCountry?: string;
    buyerCountry?:  string;
    buyerTaxId?:    string | null;
    isB2B?:         boolean;
  };

  const amount   = Number(body.amount);
  const currency = (body.currency ?? 'KRW').toUpperCase() as CurrencyCode;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount > 0 required' }, { status: 400 });
  }
  if (!body.buyerCountry) {
    return NextResponse.json({ error: 'buyerCountry required' }, { status: 400 });
  }

  const vatCheck = body.buyerTaxId
    ? await validateVatId(body.buyerCountry as CountryCode, body.buyerTaxId)
    : null;

  const breakdown = calculateTax(
    { value: amount, currency },
    {
      sellerCountry: (body.sellerCountry ?? 'KR') as CountryCode,
      buyerCountry:  body.buyerCountry as CountryCode,
      buyerTaxId:    vatCheck?.valid ? vatCheck.id : body.buyerTaxId ?? null,
      isB2B:         body.isB2B ?? Boolean(body.buyerTaxId),
    },
  );

  return NextResponse.json({ ok: true, breakdown, vatCheck });
}
