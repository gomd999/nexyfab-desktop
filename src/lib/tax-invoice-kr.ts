/**
 * 한국 전자세금계산서 발행 (바로빌 API)
 * Docs: https://dev.barobit.com/taxinvoice
 *
 * 바로빌 또는 아이유넷을 써도 동일한 패턴.
 * 환경변수:
 *   TAX_INVOICE_PROVIDER  — 'barobit' | 'iuplus' | 'mock' (default: mock)
 *   BAROBIT_API_KEY       — 바로빌 API 키
 *   BAROBIT_LINKNID       — 연동 ID
 *   COMPANY_BIZ_REG_NO    — 공급자 사업자등록번호 (e.g. '1234567890')
 *   COMPANY_NAME          — 공급자 상호명
 *   COMPANY_CEO           — 대표자명
 *   COMPANY_ADDRESS       — 공급자 주소
 *   COMPANY_BIZ_TYPE      — 업태
 *   COMPANY_BIZ_CLASS     — 종목
 *   COMPANY_EMAIL         — 공급자 이메일
 */

import { getDbAdapter } from './db-adapter';

export interface TaxInvoiceIssueParams {
  invoiceId:       string;   // our nf_aw_invoices.id
  userId:          string;
  // 공급받는 자 (buyer) — 법인/개인사업자
  buyerBizRegNo:   string;   // 사업자등록번호 10자리
  buyerCorpName:   string;   // 상호명
  buyerCeoName:    string;   // 대표자명
  buyerAddress?:   string;
  buyerEmail:      string;
  // 공급 금액
  supplyAmountKrw: number;   // 공급가액 (VAT 제외)
  taxAmountKrw:    number;   // 세액 (10%)
  totalAmountKrw:  number;   // 합계금액
  itemName:        string;   // 품목 (e.g. 'NexyFab Pro 구독 - 2026년 04월')
  issueDate:       string;   // YYYYMMDD
}

export interface TaxInvoiceResult {
  mgtKey:    string;   // 관리번호 (our system key)
  ntssendDt?: string;  // 국세청 전송일시
  status:    'issued' | 'sent' | 'failed';
  message?:  string;
}

// ─── Provider abstraction ─────────────────────────────────────────────────────

async function issueMock(params: TaxInvoiceIssueParams): Promise<TaxInvoiceResult> {
  // Mock for dev/staging — just generate a key
  const mgtKey = `MOCK-${params.invoiceId.slice(0, 8).toUpperCase()}-${Date.now()}`;
  console.log('[tax-invoice] MOCK issue:', mgtKey, params.buyerCorpName, params.totalAmountKrw);
  return { mgtKey, status: 'issued', message: 'Mock issue (no real NTS submission)' };
}

async function issueBarobit(params: TaxInvoiceIssueParams): Promise<TaxInvoiceResult> {
  const apiKey   = process.env.BAROBIT_API_KEY ?? '';
  const linkNId  = process.env.BAROBIT_LINKNID ?? '';
  const baseUrl  = 'https://api.barobit.com';

  const mgtKey = `NF-${params.invoiceId.slice(0, 8).toUpperCase()}-${Date.now()}`;

  const body = {
    MgtKey:        mgtKey,
    WriteDate:     params.issueDate,
    TaxType:       '01',                    // 01=과세
    InvoiceKind:   '01',                    // 01=세금계산서
    // 공급자 (seller)
    CorpNum:       process.env.COMPANY_BIZ_REG_NO ?? '',
    CorpName:      process.env.COMPANY_NAME ?? 'Nexysys',
    CEOName:       process.env.COMPANY_CEO ?? '',
    Addr:          process.env.COMPANY_ADDRESS ?? '',
    BizType:       process.env.COMPANY_BIZ_TYPE ?? '서비스업',
    BizClass:      process.env.COMPANY_BIZ_CLASS ?? '소프트웨어',
    ContactEmail:  process.env.COMPANY_EMAIL ?? '',
    // 공급받는 자 (buyer)
    BuyerCorpNum:  params.buyerBizRegNo,
    BuyerCorpName: params.buyerCorpName,
    BuyerCEOName:  params.buyerCeoName,
    BuyerAddr:     params.buyerAddress ?? '',
    BuyerEmail:    params.buyerEmail,
    // 금액
    SupplyCostTotal: String(params.supplyAmountKrw),
    TaxTotal:        String(params.taxAmountKrw),
    TotalAmount:     String(params.totalAmountKrw),
    // 품목
    ItemList: [{
      Seq:        '1',
      ItemName:   params.itemName,
      Qty:        '1',
      UnitCost:   String(params.supplyAmountKrw),
      SupplyCost: String(params.supplyAmountKrw),
      Tax:        String(params.taxAmountKrw),
    }],
  };

  const res = await fetch(`${baseUrl}/taxinvoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-LinkNId': linkNId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const data = await res.json() as { Code: number; Message: string; Data?: { NtsSendDt?: string } };

  if (data.Code !== 1) {
    return { mgtKey, status: 'failed', message: data.Message };
  }

  return {
    mgtKey,
    ntssendDt: data.Data?.NtsSendDt,
    status: data.Data?.NtsSendDt ? 'sent' : 'issued',
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function issueTaxInvoiceKR(params: TaxInvoiceIssueParams): Promise<TaxInvoiceResult> {
  const provider = process.env.TAX_INVOICE_PROVIDER ?? 'mock';

  let result: TaxInvoiceResult;
  if (provider === 'barobit') {
    result = await issueBarobit(params);
  } else {
    result = await issueMock(params);
  }

  // Persist to DB
  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_tax_invoices_kr
       (id, invoice_id, user_id, mgt_key, buyer_biz_reg_no, buyer_corp_name,
        supply_amount_krw, tax_amount_krw, total_amount_krw, status, nts_send_dt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `tivkr-${crypto.randomUUID()}`,
    params.invoiceId,
    params.userId,
    result.mgtKey,
    params.buyerBizRegNo,
    params.buyerCorpName,
    params.supplyAmountKrw,
    params.taxAmountKrw,
    params.totalAmountKrw,
    result.status,
    result.ntssendDt ?? null,
    Date.now(),
  ).catch(err => console.error('[tax-invoice] DB save failed:', err));

  return result;
}

/** Calculate Korean VAT: supply + 10% tax */
export function calcKoreanVAT(totalWithVAT: number): {
  supplyAmount: number;
  taxAmount: number;
  total: number;
} {
  const supplyAmount = Math.round(totalWithVAT / 1.1);
  const taxAmount    = totalWithVAT - supplyAmount;
  return { supplyAmount, taxAmount, total: totalWithVAT };
}
