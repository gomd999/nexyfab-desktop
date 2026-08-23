import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOrigin } from '@/lib/csrf';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { enqueueJob } from '@/lib/job-queue';
import { contractAdminSummaryEmail, contractSignedEmailSubject, contractSignedHtml, nexyfabEmailLocaleFromLanguageTag } from '@/lib/nexyfab-email';
import { getDbAdapter } from '@/lib/db-adapter';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_CONTRACT_CREATE_BODY_BYTES = 64 * 1024;

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nexyfab.com';

// GET /api/contracts — admin은 전체, 일반 사용자는 본인 계약만
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const isAdmin = await verifyAdmin(req);
  const db = getDbAdapter();
  const contracts = isAdmin
    ? await db.queryAll('SELECT * FROM nf_contracts ORDER BY created_at DESC')
    : await db.queryAll(
        'SELECT * FROM nf_contracts WHERE customer_email = ? ORDER BY created_at DESC',
        authUser.email,
      );
  return NextResponse.json({ contracts });
}

const contractSchema = z.object({
  projectName: z.string().min(1).max(200),
  factoryName: z.string().max(200).optional(),
  contractAmount: z.number().int().positive().max(10_000_000_000),
  plan: z.enum(['standard', 'premium']).optional(),
  quoteId: z.string().max(100).optional(),
  templateId: z.string().max(100).optional(),
  customerEmail: z.string().email().max(254).optional(),
  customerName: z.string().max(100).optional(),
  partnerEmail: z.string().email().max(254).optional(),
  deadline: z.string().max(20).optional(),
  lang: z.string().max(5).optional(),
});

// POST /api/contracts — create contract from accepted quote
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let raw: unknown = {};
  try { raw = await readBoundedJson(req, MAX_CONTRACT_CREATE_BODY_BYTES); }
  catch (error) { if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 }); }
  const parsed = contractSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' },
      { status: 400 },
    );
  }
  const { projectName, factoryName, contractAmount, plan, quoteId, templateId, customerEmail, customerName, partnerEmail, deadline, lang } = parsed.data;

  const db = getDbAdapter();
  const id = `CTR-${Date.now()}`;
  const now = new Date().toISOString().slice(0, 10);

  const existingRow = customerEmail
    ? await db.queryOne<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM nf_contracts WHERE customer_email = ? AND status != 'cancelled'",
        customerEmail,
      )
    : null;
  const isFirstContract = customerEmail ? (existingRow?.cnt ?? 0) === 0 : false;

  // Commission rate now centralized in src/lib/commission.ts so escrow,
  // settlements, and contracts agree on what was actually charged.
  const { getCommissionRatePct, COMMISSION_PCT_FLOOR } = await import('@/lib/commission');
  const baseRate = getCommissionRatePct(contractAmount, plan ?? 'standard');
  const discountRate = isFirstContract ? 1 : 0;
  const rate = Math.max(COMMISSION_PCT_FLOOR, baseRate - discountRate);
  const firstContractDiscount = isFirstContract ? Math.round(contractAmount * discountRate / 100) : 0;

  const MIN_FEE: Record<string, number> = { standard: 500_000, premium: 1_000_000 };
  const gross = Math.round(contractAmount * rate / 100);
  const deduction = MIN_FEE[plan ?? 'standard'] ?? 500_000;
  const finalCharge = Math.max(0, gross - deduction);

  const contract = {
    id,
    projectName,
    factoryName: factoryName || '',
    contractAmount,
    plan: plan || 'standard',
    status: 'contracted',
    customerEmail: customerEmail || null,
    baseCommissionRate: baseRate,
    commissionRate: rate,
    isFirstContract,
    firstContractDiscount,
    grossCommission: gross,
    planDeduction: deduction,
    finalCharge,
    quoteId: quoteId || null,
    templateId: templateId || null,
    contractDate: now,
    createdAt: new Date().toISOString(),
  };

  const nowIso = new Date().toISOString();
  await db.execute(
    `INSERT OR IGNORE INTO nf_contracts
      (id, project_name, status, partner_email, factory_name, deadline,
       contract_amount, commission_rate, base_commission_rate,
       gross_commission, plan_deduction, final_charge,
       is_first_contract, first_contract_discount,
       customer_email, quote_id, plan, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, projectName, 'contracted',
    partnerEmail ?? null,
    factoryName ?? null,
    deadline ?? null,
    contractAmount,
    rate / 100,
    baseRate / 100,
    gross,
    deduction,
    finalCharge,
    isFirstContract ? 1 : 0,
    firstContractDiscount,
    customerEmail ?? null,
    quoteId ?? null,
    plan ?? 'standard',
    nowIso,
  );

  // ── 양측 이메일 자동 발송 ──────────────────────────────────────────────────
  const resolvedLang = nexyfabEmailLocaleFromLanguageTag(lang);

  if (customerEmail) {
    enqueueJob('send_email', {
      to: customerEmail,
      subject: contractSignedEmailSubject(resolvedLang, projectName),
      html: contractSignedHtml({
        recipientName: customerName || customerEmail,
        recipientType: 'customer',
        lang: resolvedLang,
        contractId: id,
        projectName,
        factoryName: factoryName || '제조사',
        contractAmount,
        deadline: deadline ?? undefined,
      }),
    }).catch(e => console.error('[contracts POST] 고객 이메일 발송 실패:', e));
  }

  if (partnerEmail) {
    enqueueJob('send_email', {
      to: partnerEmail,
      subject: contractSignedEmailSubject(resolvedLang, projectName),
      html: contractSignedHtml({
        recipientName: factoryName || partnerEmail,
        recipientType: 'factory',
        lang: resolvedLang,
        contractId: id,
        projectName,
        factoryName: factoryName || '제조사',
        contractAmount,
        deadline: deadline ?? undefined,
      }),
    }).catch(e => console.error('[contracts POST] 파트너 이메일 발송 실패:', e));
  }

  const adminSummary = contractAdminSummaryEmail(resolvedLang, {
    contractId: id,
    projectName,
    factoryName,
    contractAmount,
    feeRate: rate,
    finalCharge,
    isFirstContract,
  });
  await enqueueJob('send_email', {
    to: ADMIN_EMAIL,
    subject: adminSummary.subject,
    html: adminSummary.html,
  }).catch(e => console.error('[contracts POST] 어드민 알림 발송 실패:', e));

  return NextResponse.json({ contract }, { status: 201 });
}
