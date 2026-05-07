/**
 * POST /api/partner/quotes/auto
 * Returns a suggested price based on the partner's saved pricebook + capability,
 * for a quote (and its underlying RFQ) the partner has been invited to respond to.
 *
 * Body: { quoteId: string, processOverride?: ProcessCode, isRush?: boolean }
 * Resp: AutoQuoteResult — partner can apply/override before POSTing /respond.
 *
 * Authorization: quote.partner_email must match the calling partner.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { findFactoryForPartnerEmail, normPartnerEmail } from '@/lib/partner-factory-access';
import {
  autoQuote, isPriceBook, isProcessCapability, DEFAULT_PRICEBOOK,
  type PriceBook, type ProcessCapability, type ProcessCode,
} from '@/lib/partner-pricebook';

export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: string; partner_email: string | null; inquiry_id: string | null;
}

interface RfqRow {
  material_id: string | null; quantity: number | null;
  volume_cm3: number | null; bbox: string | null;
  dfm_process: string | null;
}

interface FactoryRow {
  price_book: string | null; process_capability: string | null;
}

const DFM_TO_PROCESS: Record<string, ProcessCode> = {
  cnc: 'cnc_milling',
  cnc_milling: 'cnc_milling',
  cnc_turning: 'cnc_turning',
  fdm: 'fdm', sla: 'sla', sls: 'sls',
  sheetmetal: 'sheetmetal_laser',
  injection: 'injection',
  casting: 'casting',
  welding: 'welding',
};

function inferProcess(dfmProcess: string | null | undefined): ProcessCode {
  if (!dfmProcess) return 'cnc_milling';
  const key = dfmProcess.toLowerCase();
  return DFM_TO_PROCESS[key] || 'cnc_milling';
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { quoteId, processOverride, isRush } = body as {
    quoteId?: string; processOverride?: ProcessCode; isRush?: boolean;
  };
  if (!quoteId) {
    return NextResponse.json({ error: 'quoteId가 필요합니다.' }, { status: 400 });
  }

  const db = getDbAdapter();

  const quote = await db.queryOne<QuoteRow>(
    'SELECT id, partner_email, inquiry_id FROM nf_quotes WHERE id = ?',
    quoteId,
  );
  if (!quote) return NextResponse.json({ error: '견적을 찾을 수 없습니다.' }, { status: 404 });
  if (normPartnerEmail(quote.partner_email) !== normPartnerEmail(partner.email)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }
  if (!quote.inquiry_id) {
    return NextResponse.json({ error: '연결된 RFQ가 없습니다.' }, { status: 400 });
  }

  const rfq = await db.queryOne<RfqRow>(
    `SELECT material_id, quantity, volume_cm3, bbox, dfm_process
       FROM nf_rfqs WHERE id = ?`,
    quote.inquiry_id,
  );
  if (!rfq) return NextResponse.json({ error: 'RFQ 데이터를 찾을 수 없습니다.' }, { status: 404 });

  const facRef = await findFactoryForPartnerEmail(partner.email, { activeOnly: false });
  const factory = facRef
    ? await db.queryOne<FactoryRow>(
        'SELECT price_book, process_capability FROM nf_factories WHERE id = ? LIMIT 1',
        facRef.id,
      )
    : null;

  let priceBook: PriceBook = DEFAULT_PRICEBOOK;
  try {
    const parsed = factory?.price_book ? JSON.parse(factory.price_book) : null;
    if (isPriceBook(parsed)) priceBook = parsed;
  } catch { /* ignore */ }

  let capability: ProcessCapability | undefined;
  try {
    const parsed = factory?.process_capability ? JSON.parse(factory.process_capability) : null;
    if (isProcessCapability(parsed)) capability = parsed as ProcessCapability;
  } catch { /* ignore */ }

  let bbox: { w: number; h: number; d: number } | undefined;
  try { bbox = rfq.bbox ? JSON.parse(rfq.bbox) : undefined; } catch { /* ignore */ }

  const result = autoQuote(
    {
      process: processOverride ?? inferProcess(rfq.dfm_process),
      materialId: rfq.material_id ?? 'aluminum',
      quantity: rfq.quantity ?? 1,
      volume_cm3: rfq.volume_cm3 ?? 0,
      bbox,
      isRush: !!isRush,
    },
    priceBook,
    capability,
  );

  return NextResponse.json({ ok: true, quote: result });
}
