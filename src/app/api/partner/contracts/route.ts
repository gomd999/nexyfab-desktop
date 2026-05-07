import { NextRequest, NextResponse } from 'next/server';
import { createNotification } from '@/app/lib/notify';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { enqueueJob } from '@/lib/job-queue';
import { logAudit } from '@/lib/audit';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

interface ContractRow {
  id: string;
  project_name: string;
  status: string;
  partner_email: string | null;
  factory_name: string | null;
  deadline: string | null;
  contract_amount: number | null;
  commission_rate: number | null;
  commission_status: string | null;
  completed_at: string | null;
  completion_requested: number;
  completion_requested_at: string | null;
  customer_email: string | null;
  customer_contact: string | null;
  quote_id: string | null;
  plan: string | null;
  progress_percent: number;
  progress_notes: string | null;
  attachments: string | null;
  created_at: string;
  updated_at: string | null;
}

function parseContract(row: ContractRow) {
  return {
    ...row,
    contractAmount: row.contract_amount ?? 0,
    completedAt: row.completed_at,
    factoryName: row.factory_name,
    projectName: row.project_name,
    completionRequested: row.completion_requested === 1,
    progressNotes: row.progress_notes ? JSON.parse(row.progress_notes) : [],
    customerContact: row.customer_contact ? JSON.parse(row.customer_contact) : null,
    attachments: row.attachments ? JSON.parse(row.attachments) : [],
  };
}

// ─── GET /api/partner/contracts ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '20', 10));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?'];
  const vals: unknown[] = [normPartnerEmail(partner.email)];
  if (status) { conditions.push('status = ?'); vals.push(status); }

  const where = conditions.join(' AND ');
  const countRow = await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM nf_contracts WHERE ${where}`, ...vals,
  );
  const total = countRow?.cnt ?? 0;

  const rows = await db.queryAll<ContractRow>(
    `SELECT * FROM nf_contracts WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...vals, limit, offset,
  );

  return NextResponse.json({
    contracts: rows.map(parseContract),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// ─── PATCH /api/partner/contracts ──────────────────────────────────────────

const PARTNER_ALLOWED_STATUSES = ['in_progress', 'quality_check', 'delivered'];

export async function PATCH(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const { id, status, note, completionRequested, progressPercent } = await req.json();
  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  }
  if (status && !PARTNER_ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `파트너가 변경 가능한 상태: ${PARTNER_ALLOWED_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  const db = getDbAdapter();
  const found = await db.queryOne<ContractRow>(
    `SELECT * FROM nf_contracts WHERE id = ?
       AND partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?`,
    id,
    normPartnerEmail(partner.email),
  );
  if (!found) {
    return NextResponse.json({ error: '계약을 찾을 수 없습니다.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const nowMs = Date.now();

  // Build dynamic UPDATE
  const setClauses: string[] = ['updated_at = ?'];
  const setVals: unknown[] = [now];

  if (status) {
    setClauses.push('status = ?');
    setVals.push(status);
  }

  if (typeof progressPercent === 'number') {
    const pct = Math.min(100, Math.max(0, Math.round(progressPercent)));
    setClauses.push('progress_percent = ?');
    setVals.push(pct);
  }

  if (note) {
    const existing: Array<{ date: string; note: string; updatedBy: string }> =
      found.progress_notes ? JSON.parse(found.progress_notes) : [];
    existing.push({ date: now, note, updatedBy: partner.company || partner.email });
    setClauses.push('progress_notes = ?');
    setVals.push(JSON.stringify(existing));
  }

  if (completionRequested === true && !found.completion_requested) {
    setClauses.push('completion_requested = 1');
    setClauses.push('completion_requested_at = ?');
    setVals.push(now);
  }

  await db.execute(
    `UPDATE nf_contracts SET ${setClauses.join(', ')} WHERE id = ?`,
    ...setVals, id,
  );

  // Fetch updated row
  const updated = await db.queryOne<ContractRow>('SELECT * FROM nf_contracts WHERE id = ?', id);
  const contract = parseContract(updated!);

  // ── Notifications ──────────────────────────────────────────────────────────

  if (status) {
    const statusLabel: Record<string, string> = {
      in_progress: '진행 중',
      quality_check: '품질 검수',
      delivered: '납품 완료',
    };
    const label = statusLabel[status] || status;

    createNotification(
      'admin',
      'contract_status',
      '계약 상태 변경',
      `${partner.company || partner.email}이(가) "${found.project_name}" 계약을 "${label}"(으)로 변경했습니다.`,
      { contractId: id },
    );

    const customerEmail = found.customer_email ?? '';
    if (customerEmail) {
      createNotification(
        `customer:${customerEmail}`,
        'contract_status',
        '계약 상태가 변경되었습니다',
        `"${found.project_name}" 프로젝트가 "${label}" 단계로 변경되었습니다.`,
        { contractId: id },
      );
      await enqueueJob('send_email', {
        to: customerEmail,
        subject: `[NexyFab] "${found.project_name}" 계약 상태 업데이트`,
        html: `<p>안녕하세요,<br><br>"${found.project_name}" 프로젝트의 제조 상태가 <strong>${label}</strong>(으)로 변경되었습니다.<br><br>자세한 내용은 대시보드에서 확인하세요.</p>`,
      });
    }

    logAudit({
      userId: `partner:${normPartnerEmail(partner.email)}`,
      action: `contract.status.${status}`,
      resourceId: id,
      metadata: { projectName: found.project_name },
    });
  }

  if (typeof progressPercent === 'number' && found.customer_email) {
    const pct = Math.min(100, Math.max(0, Math.round(progressPercent)));
    createNotification(
      `customer:${found.customer_email}`,
      'progress_update',
      '제조 진행률 업데이트',
      `"${found.project_name}" 프로젝트 진행률이 ${pct}%로 업데이트되었습니다.`,
      { contractId: id },
    );
  }

  if (completionRequested === true && !found.completion_requested) {
    createNotification(
      'admin',
      'completion_request',
      '완료 확인 요청',
      `${partner.company || partner.email}이(가) "${found.project_name}" 계약의 완료 확인을 요청했습니다.`,
      { contractId: id },
    );
    logAudit({
      userId: `partner:${normPartnerEmail(partner.email)}`,
      action: 'contract.completion_requested',
      resourceId: id,
      metadata: { projectName: found.project_name },
    });
  }

  return NextResponse.json({ contract });
}
