import { randomUUID } from 'node:crypto';
import type { DbAdapter } from './db-adapter';
import { COMMISSION_PCT_FLOOR, getCommissionRatePct } from './commission';
import { resolveStoredManufacturingLineage } from './manufacturingLineageDb';
import { normPartnerEmail } from './partner-factory-access';

export interface AcceptedQuoteInput {
  id: string;
  inquiryId: string | null;
  projectName: string;
  factoryName: string;
  estimatedAmount: number;
  partnerEmail: string | null;
  lineageId: string | null;
  artifactId: string | null;
  artifactSha256: string | null;
  documentVersionId: string | null;
}

interface AcceptanceRfqRow {
  user_id: string | null;
  user_email: string | null;
  org_id: string | null;
  quantity: number | null;
  shape_name: string | null;
  lineage_id: string | null;
  artifact_id: string | null;
  artifact_sha256: string | null;
  document_version_id: string | null;
}

export type QuoteAcceptanceCode =
  | 'RFQ_REQUIRED'
  | 'RFQ_OWNER_MISSING'
  | 'QUOTE_RFQ_LINEAGE_MISMATCH'
  | 'LINEAGE_REFERENCE_MISSING'
  | 'LINEAGE_NOT_FOUND'
  | 'LINEAGE_NOT_AUTHORIZED'
  | 'LINEAGE_ARTIFACT_MISMATCH'
  | 'QUOTE_TRANSITION_CONFLICT'
  | 'INCOMPLETE_ACCEPTANCE';

export class QuoteAcceptanceError extends Error {
  constructor(public readonly code: QuoteAcceptanceCode, message: string) {
    super(message);
    this.name = 'QuoteAcceptanceError';
  }
}

export interface QuoteAcceptanceResult {
  orderId: string;
  contractId: string;
  idempotent: boolean;
}

function exactLineageMatch(quote: AcceptedQuoteInput, rfq: AcceptanceRfqRow): boolean {
  return quote.lineageId === rfq.lineage_id
    && quote.artifactId === rfq.artifact_id
    && quote.artifactSha256 === rfq.artifact_sha256
    && quote.documentVersionId === rfq.document_version_id;
}

/**
 * Commits the commercial handoff as one unit. A quote is never left accepted
 * without both its contract and its production order.
 */
export async function acceptQuoteAtomically(
  db: DbAdapter,
  quote: AcceptedQuoteInput,
  updatedAt = new Date().toISOString(),
): Promise<QuoteAcceptanceResult> {
  if (!quote.inquiryId) throw new QuoteAcceptanceError('RFQ_REQUIRED', 'Accepted quotes must reference an RFQ.');

  return db.transaction(async tx => {
    const rfq = await tx.queryOne<AcceptanceRfqRow>(
      `SELECT user_id, user_email, org_id, quantity, shape_name,
              lineage_id, artifact_id, artifact_sha256, document_version_id
         FROM nf_rfqs WHERE id = ?`,
      quote.inquiryId,
    );
    if (!rfq?.user_id) throw new QuoteAcceptanceError('RFQ_OWNER_MISSING', 'The RFQ has no durable owner.');
    if (!exactLineageMatch(quote, rfq)) {
      throw new QuoteAcceptanceError('QUOTE_RFQ_LINEAGE_MISMATCH', 'The quote and RFQ do not reference the same released artifact.');
    }

    const lineage = await resolveStoredManufacturingLineage(tx, rfq.user_id, {
      lineage_id: quote.lineageId,
      artifact_id: quote.artifactId,
      artifact_sha256: quote.artifactSha256,
      document_version_id: quote.documentVersionId,
    });
    if (!lineage.ok) throw new QuoteAcceptanceError(lineage.code, 'The manufacturing release is stale or revoked.');

    const transition = await tx.execute(
      `UPDATE nf_quotes SET status = 'accepted', updated_at = ?
        WHERE id = ? AND status = 'pending'`,
      updatedAt,
      quote.id,
    );
    if (transition.changes !== 1) {
      const current = await tx.queryOne<{ status: string }>('SELECT status FROM nf_quotes WHERE id = ?', quote.id);
      if (current?.status !== 'accepted') {
        throw new QuoteAcceptanceError('QUOTE_TRANSITION_CONFLICT', `Cannot accept a quote in ${current?.status ?? 'missing'} state.`);
      }
      const existingContract = await tx.queryOne<{ id: string }>('SELECT id FROM nf_contracts WHERE quote_id = ? LIMIT 1', quote.id);
      const existingOrder = await tx.queryOne<{ id: string }>('SELECT id FROM nf_orders WHERE quote_id = ? LIMIT 1', quote.id);
      if (!existingContract || !existingOrder) {
        throw new QuoteAcceptanceError('INCOMPLETE_ACCEPTANCE', 'This quote was previously accepted without a complete contract and order.');
      }
      return { contractId: existingContract.id, orderId: existingOrder.id, idempotent: true };
    }

    const buyerPlan = await tx.queryOne<{ plan: string }>('SELECT plan FROM nf_users WHERE id = ?', rfq.user_id);
    const plan = buyerPlan?.plan ?? 'standard';
    const buyerEmail = rfq.user_email?.trim() || null;
    const isFirstContract = buyerEmail
      ? ((await tx.queryOne<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM nf_contracts WHERE customer_email = ? AND status != 'cancelled'`,
          buyerEmail,
        ))?.cnt ?? 0) === 0
      : false;
    const baseRate = getCommissionRatePct(quote.estimatedAmount, plan);
    const rate = Math.max(COMMISSION_PCT_FLOOR, baseRate - (isFirstContract ? 1 : 0));
    const gross = Math.round(quote.estimatedAmount * rate / 100);
    const minimumFee: Record<string, number> = {
      standard: 500_000,
      premium: 1_000_000,
      pro: 500_000,
      team: 800_000,
      enterprise: 1_000_000,
    };
    const deduction = minimumFee[plan] ?? 500_000;
    const contractId = `CTR-${Date.now()}-${randomUUID().slice(0, 6)}`;
    await tx.execute(
      `INSERT INTO nf_contracts
        (id, project_name, status, partner_email, factory_name,
         contract_amount, commission_rate, base_commission_rate,
         gross_commission, plan_deduction, final_charge,
         is_first_contract, first_contract_discount,
         customer_email, quote_id, plan, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      contractId,
      quote.projectName,
      'contracted',
      quote.partnerEmail ? normPartnerEmail(quote.partnerEmail) : null,
      quote.factoryName || null,
      quote.estimatedAmount,
      rate,
      baseRate,
      gross,
      deduction,
      Math.max(0, gross - deduction),
      isFirstContract ? 1 : 0,
      isFirstContract ? Math.round(quote.estimatedAmount / 100) : 0,
      buyerEmail,
      quote.id,
      plan,
      updatedAt,
    );

    const orderId = `ORD-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const now = Date.now();
    const leadDays = 14;
    const day = 86_400_000;
    const steps = [
      { label: 'Order Placed', labelKo: '주문 완료', completedAt: now },
      { label: 'In Production', labelKo: '생산 중', estimatedAt: now + 2 * day },
      { label: 'QC', labelKo: '품질 검사', estimatedAt: now + (leadDays - 4) * day },
      { label: 'Shipped', labelKo: '배송 시작', estimatedAt: now + (leadDays - 2) * day },
      { label: 'Delivered', labelKo: '배송 완료', estimatedAt: now + leadDays * day },
    ];
    await tx.execute(
      `INSERT INTO nf_orders
        (id, rfq_id, quote_id, user_id, org_id, part_name, manufacturer_name, quantity,
         total_price_krw, total_price, currency, buyer_country,
         hs_code, incoterm, ship_from_country, ship_to_country,
         lineage_id, artifact_id, artifact_sha256, document_version_id,
         status, steps, created_at, estimated_delivery_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      orderId,
      quote.inquiryId,
      quote.id,
      rfq.user_id,
      rfq.org_id,
      rfq.shape_name ?? quote.projectName,
      quote.factoryName || quote.partnerEmail || '미지정',
      rfq.quantity ?? 1,
      quote.estimatedAmount,
      quote.estimatedAmount,
      'KRW',
      null,
      null,
      null,
      null,
      null,
      lineage.ref.lineageId,
      lineage.ref.artifactId,
      lineage.ref.artifactSha256,
      lineage.ref.documentVersionId,
      'placed',
      JSON.stringify(steps),
      now,
      now + leadDays * day,
    );
    return { contractId, orderId, idempotent: false };
  });
}
