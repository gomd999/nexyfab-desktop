import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { enqueueJob } from '@/lib/job-queue';
import { createNotification } from '@/app/lib/notify';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nexyfab.com';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexyfab.com';

interface ContractRow {
  id: string; project_name: string; status: string;
  partner_email: string | null; factory_name: string | null;
  deadline: string | null; contract_amount: number | null;
  commission_rate: number | null; base_commission_rate: number | null;
  gross_commission: number | null; plan_deduction: number | null;
  final_charge: number | null; is_first_contract: number;
  first_contract_discount: number | null; commission_status: string | null;
  completed_at: string | null; completion_requested: number;
  completion_requested_at: string | null; customer_email: string | null;
  customer_contact: string | null; quote_id: string | null;
  plan: string | null; progress_percent: number; progress_notes: string | null;
  created_at: string; updated_at: string | null;
}

function rowToContract(r: ContractRow) {
  return {
    id: r.id, projectName: r.project_name, status: r.status,
    partnerEmail: r.partner_email, factoryName: r.factory_name,
    deadline: r.deadline, contractAmount: r.contract_amount,
    commissionRate: r.commission_rate != null ? Math.round(r.commission_rate * 100) : null,
    baseCommissionRate: r.base_commission_rate != null ? Math.round(r.base_commission_rate * 100) : null,
    grossCommission: r.gross_commission, planDeduction: r.plan_deduction,
    finalCharge: r.final_charge, isFirstContract: r.is_first_contract === 1,
    firstContractDiscount: r.first_contract_discount,
    commissionStatus: r.commission_status, completedAt: r.completed_at,
    completionRequested: r.completion_requested === 1,
    completionRequestedAt: r.completion_requested_at,
    customerEmail: r.customer_email,
    customerContact: r.customer_contact ? JSON.parse(r.customer_contact) : null,
    quoteId: r.quote_id, plan: r.plan, progressPercent: r.progress_percent,
    progressNotes: r.progress_notes ? JSON.parse(r.progress_notes) : [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// PATCH /api/contracts/[id] — update status, partnerEmail, deadline, customerContact, completionRequested
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const { status, partnerEmail, deadline, customerContact, completionRequested, isFirstContract } = body;

  const db = getDbAdapter();
  const existing = await db.queryOne<ContractRow>('SELECT * FROM nf_contracts WHERE id = ?', id);
  if (!existing) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });

  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const setVals: unknown[] = [now];

  if (partnerEmail !== undefined) { setClauses.push('partner_email = ?'); setVals.push(partnerEmail); }
  if (deadline !== undefined) { setClauses.push('deadline = ?'); setVals.push(deadline); }
  if (customerContact !== undefined) {
    setClauses.push('customer_contact = ?');
    setVals.push(JSON.stringify(customerContact));
  }
  if (completionRequested === true && !existing.completion_requested) {
    setClauses.push('completion_requested = 1', 'completion_requested_at = ?');
    setVals.push(now);
  }

  // Recalculate commission if isFirstContract toggled
  if (isFirstContract !== undefined) {
    const flag = !!isFirstContract;
    const baseRate = (existing.base_commission_rate ?? existing.commission_rate ?? 0) * 100;
    const discountRate = flag ? 1 : 0;
    const newRate = Math.max(3, baseRate - discountRate);
    const contractAmount = existing.contract_amount ?? 0;
    const discount = flag ? Math.round(contractAmount * discountRate / 100) : 0;
    const gross = Math.round(contractAmount * newRate / 100);
    const finalCharge = Math.max(0, gross - (existing.plan_deduction ?? 500_000));

    setClauses.push(
      'is_first_contract = ?', 'first_contract_discount = ?',
      'commission_rate = ?', 'gross_commission = ?', 'final_charge = ?',
    );
    setVals.push(flag ? 1 : 0, discount, newRate / 100, gross, finalCharge);
  }

  if (status) {
    const VALID = ['contracted', 'in_progress', 'quality_check', 'delivered', 'completed', 'cancelled'];
    if (!VALID.includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${VALID.join(', ')}` }, { status: 400 });
    }
    setClauses.push('status = ?');
    setVals.push(status);

    if (status === 'completed') {
      setClauses.push('commission_status = ?', 'completed_at = ?', 'completion_requested = 0');
      setVals.push('invoiced', now);
    }
  }

  await db.execute(
    `UPDATE nf_contracts SET ${setClauses.join(', ')} WHERE id = ?`,
    ...setVals, id,
  );

  const updated = await db.queryOne<ContractRow>('SELECT * FROM nf_contracts WHERE id = ?', id);
  const contract = rowToContract(updated!);

  // ── 완료 시 정산 항목 자동 생성 ────────────────────────────────────────────
  if (status === 'completed') {
    const existingSettlement = await db.queryOne<{ id: string }>(
      'SELECT id FROM nf_settlements WHERE contract_id = ?', id,
    ).catch(() => null);

    if (!existingSettlement) {
      await db.execute(
        `INSERT OR IGNORE INTO nf_settlements
          (id, contract_id, project_name, factory_name, contract_amount, commission_rate,
           gross_commission, plan_deduction, final_charge, is_first_contract,
           first_contract_discount, status, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending','',?)`,
        `STL-${Date.now()}`, id,
        updated!.project_name, updated!.factory_name || '',
        updated!.contract_amount ?? 0,
        updated!.commission_rate ?? 0,
        updated!.gross_commission ?? 0,
        updated!.plan_deduction ?? 0,
        updated!.final_charge ?? 0,
        updated!.is_first_contract,
        updated!.first_contract_discount ?? 0,
        now,
      );
    }

    // 고객에게 완료 + 리뷰 요청 이메일
    const customerEmail = updated!.customer_email;
    if (customerEmail) {
      const reviewLink = `${SITE_URL}/portal?tab=review&contractId=${id}`;
      await enqueueJob('send_email', {
        to: customerEmail,
        subject: '[NexyFab] 프로젝트 완료 안내 및 파트너 평가 요청',
        html: `<p>안녕하세요,</p>
<p>의뢰하신 프로젝트 <strong>${updated!.project_name}</strong>가 성공적으로 완료되었습니다.</p>
<p>NexyFab을 이용해 주셔서 감사합니다.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
<p><strong>파트너 평가에 참여해 주세요</strong></p>
<p>파트너사의 서비스 품질 향상을 위해 짧은 평가를 부탁드립니다.</p>
<p><a href="${reviewLink}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">파트너 평가하기</a></p>
<p style="color:#6b7280;font-size:12px">— NexyFab 팀</p>`,
      }).catch(() => {});

      createNotification(
        `customer:${customerEmail}`,
        'contract_completed',
        '프로젝트 완료',
        `"${updated!.project_name}" 프로젝트가 완료되었습니다. 파트너 평가에 참여해 주세요.`,
        { contractId: id },
      );
    }

    // 어드민 완료 알림
    await enqueueJob('send_email', {
      to: ADMIN_EMAIL,
      subject: `[NexyFab] 계약 완료 처리됨 - ${updated!.project_name}`,
      html: `<h2 style="color:#1a56db">계약이 완료 처리되었습니다</h2>
<p>계약 ID: ${id} / 프로젝트: ${updated!.project_name} / 최종 수수료: ${(updated!.final_charge ?? 0).toLocaleString('ko-KR')}원</p>`,
    }).catch(() => {});

    logAudit({ userId: 'admin', action: 'contract.completed', resourceId: id });
  }

  // completionRequested 어드민 알림
  if (completionRequested === true && !existing.completion_requested) {
    await enqueueJob('send_email', {
      to: ADMIN_EMAIL,
      subject: `[NexyFab] 파트너 완료 확인 요청 - ${existing.project_name}`,
      html: `<p>계약 <strong>${id}</strong> (${existing.project_name})에 대해 파트너가 완료 확인을 요청했습니다.</p>`,
    }).catch(() => {});
    createNotification('admin', 'completion_request', '완료 확인 요청',
      `"${existing.project_name}" 계약의 완료 확인을 요청받았습니다.`, { contractId: id });
  }

  return NextResponse.json({ contract });
}
