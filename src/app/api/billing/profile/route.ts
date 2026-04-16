/**
 * GET  /api/billing/profile  — 결제 프로필 조회 (국가, 통화, 사업자 정보)
 * PUT  /api/billing/profile  — 결제 프로필 저장
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import {
  detectCountryFromRequest,
  getCurrencyForCountry,
  getPaymentMethodsForCountry,
  getTaxConfig,
  type CountryCode,
} from '@/lib/country-pricing';
import { z } from 'zod';

const profileSchema = z.object({
  country:    z.string().length(2).toUpperCase(),
  currency:   z.string().min(3).max(3).optional(),
  bizRegNo:   z.string().regex(/^\d{10}$/).optional().or(z.literal('')),
  corpName:   z.string().max(100).optional(),
  ceoName:    z.string().max(50).optional(),
  bizAddress: z.string().max(200).optional(),
  bizEmail:   z.string().email().optional().or(z.literal('')),
  taxExempt:  z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const profile = await db.queryOne<{
    country: string; currency: string;
    biz_reg_no: string | null; corp_name: string | null;
    ceo_name: string | null; biz_address: string | null;
    biz_email: string | null; tax_exempt: number;
  }>(
    'SELECT * FROM nf_user_billing_profile WHERE user_id = ?',
    authUser.userId,
  );

  // Auto-detect country from request if no profile
  const detectedCountry = detectCountryFromRequest(req.headers) as CountryCode;
  const country   = (profile?.country ?? detectedCountry) as CountryCode;
  const currency  = profile?.currency ?? getCurrencyForCountry(country);
  const taxCfg    = getTaxConfig(country);
  const methods   = getPaymentMethodsForCountry(country);

  return NextResponse.json({
    country,
    currency,
    detectedCountry,
    bizRegNo:   profile?.biz_reg_no ?? null,
    corpName:   profile?.corp_name ?? null,
    ceoName:    profile?.ceo_name ?? null,
    bizAddress: profile?.biz_address ?? null,
    bizEmail:   profile?.biz_email ?? null,
    taxExempt:  profile?.tax_exempt === 1,
    tax:        taxCfg,
    paymentMethods: methods.map(m => ({
      id: m.id, label: m.label, labelEn: m.labelEn, icon: m.icon, provider: m.provider,
    })),
  });
}

export async function PUT(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const db  = getDbAdapter();
  const now = Date.now();
  const country  = parsed.data.country as CountryCode;
  const currency = parsed.data.currency ?? getCurrencyForCountry(country);

  await db.execute(
    `INSERT INTO nf_user_billing_profile
       (user_id, country, currency, biz_reg_no, corp_name, ceo_name,
        biz_address, biz_email, tax_exempt, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE
       SET country     = excluded.country,
           currency    = excluded.currency,
           biz_reg_no  = excluded.biz_reg_no,
           corp_name   = excluded.corp_name,
           ceo_name    = excluded.ceo_name,
           biz_address = excluded.biz_address,
           biz_email   = excluded.biz_email,
           tax_exempt  = excluded.tax_exempt,
           updated_at  = excluded.updated_at`,
    authUser.userId,
    country,
    currency,
    parsed.data.bizRegNo || null,
    parsed.data.corpName || null,
    parsed.data.ceoName  || null,
    parsed.data.bizAddress || null,
    parsed.data.bizEmail || null,
    parsed.data.taxExempt ? 1 : 0,
    now,
  );

  return NextResponse.json({ saved: true, country, currency });
}
