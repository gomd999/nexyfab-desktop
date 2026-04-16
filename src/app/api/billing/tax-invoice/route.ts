/**
 * GET  /api/billing/tax-invoice      — 세금계산서 목록
 * POST /api/billing/tax-invoice      — 세금계산서 발행 요청
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { issueTaxInvoiceKR, calcKoreanVAT } from '@/lib/tax-invoice-kr';
import { z } from 'zod';

const issueSchema = z.object({
  invoiceId:     z.string().min(1),
  buyerBizRegNo: z.string().regex(/^\d{10}$/, '사업자등록번호는 10자리 숫자입니다'),
  buyerCorpName: z.string().min(1).max(100),
  buyerCeoName:  z.string().min(1).max(50),
  buyerAddress:  z.string().max(200).optional(),
  buyerEmail:    z.string().email(),
});

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const invoices = await db.queryAll<{
    id: string; invoice_id: string; mgt_key: string;
    buyer_corp_name: string; supply_amount_krw: number;
    tax_amount_krw: number; total_amount_krw: number;
    status: string; nts_send_dt: string | null; created_at: number;
  }>(
    'SELECT * FROM nf_tax_invoices_kr WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    authUser.userId,
  );

  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = issueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const db = getDbAdapter();

  // Get invoice
  const invoice = await db.queryOne<{
    user_id: string; total_amount_krw: number; currency: string; description: string; created_at: number;
  }>('SELECT * FROM nf_aw_invoices WHERE id = ?', parsed.data.invoiceId);

  if (!invoice || invoice.user_id !== authUser.userId) {
    return NextResponse.json({ error: '인보이스를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (invoice.currency !== 'KRW') {
    return NextResponse.json({ error: '한국 세금계산서는 원화(KRW) 인보이스에만 발행 가능합니다.' }, { status: 400 });
  }

  // Check if already issued
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_tax_invoices_kr WHERE invoice_id = ? AND status != ?',
    parsed.data.invoiceId, 'failed',
  );
  if (existing) {
    return NextResponse.json({ error: '이미 세금계산서가 발행된 인보이스입니다.' }, { status: 409 });
  }

  const { supplyAmount, taxAmount, total } = calcKoreanVAT(invoice.total_amount_krw);
  const issueDate = new Date(invoice.created_at).toISOString().slice(0, 10).replace(/-/g, '');

  const result = await issueTaxInvoiceKR({
    invoiceId:       parsed.data.invoiceId,
    userId:          authUser.userId,
    buyerBizRegNo:   parsed.data.buyerBizRegNo,
    buyerCorpName:   parsed.data.buyerCorpName,
    buyerCeoName:    parsed.data.buyerCeoName,
    buyerAddress:    parsed.data.buyerAddress,
    buyerEmail:      parsed.data.buyerEmail,
    supplyAmountKrw: supplyAmount,
    taxAmountKrw:    taxAmount,
    totalAmountKrw:  total,
    itemName:        invoice.description ?? 'Nexysys 구독 서비스',
    issueDate,
  });

  if (result.status === 'failed') {
    return NextResponse.json(
      { error: '세금계산서 발행 실패: ' + (result.message ?? '알 수 없는 오류') },
      { status: 502 },
    );
  }

  return NextResponse.json({ result }, { status: 201 });
}
