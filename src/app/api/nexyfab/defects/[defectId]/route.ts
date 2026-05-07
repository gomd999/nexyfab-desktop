/**
 * PATCH /api/nexyfab/defects/[defectId]   (Phase 7-5d)
 *
 * 상태 전이 + 역할별 권한.
 *   구매자: reported→rejected(철회), approved→resolved(RMA 처리 완료 확인), rejected→disputed(이의제기)
 *   공급사: reported→under_review, under_review→approved(+RMA 번호), under_review→rejected,
 *           disputed→approved|rejected (관리자 중재 전 자진 전환)
 *   관리자: 모든 전이 허용 (분쟁 조정)
 *
 * 요청 바디: { status, partnerResponse?, resolutionNote?, rmaInstructions? }
 * RMA 번호는 under_review→approved 전이 시 서버에서 자동 발급.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getPartnerAuth } from '@/lib/partner-auth';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { sanitizeText } from '@/app/lib/sanitize';
import { recordMetric } from '@/lib/partner-metrics';
import {
  ensureDefectsTable, rowToDefect, isValidTransition, generateRmaNumber,
  type DefectRow, type DefectStatus,
} from '@/lib/partner-defects';

export const dynamic = 'force-dynamic';

const BUYER_ALLOWED_TRANSITIONS: Array<{ from: DefectStatus; to: DefectStatus }> = [
  { from: 'reported', to: 'rejected' },  // 구매자 철회 → rejected 로 처리
  { from: 'approved', to: 'resolved' },
  { from: 'rejected', to: 'disputed' },
];

const PARTNER_ALLOWED_TRANSITIONS: Array<{ from: DefectStatus; to: DefectStatus }> = [
  { from: 'reported', to: 'under_review' },
  { from: 'under_review', to: 'approved' },
  { from: 'under_review', to: 'rejected' },
  { from: 'disputed', to: 'approved' },
  { from: 'disputed', to: 'rejected' },
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ defectId: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { defectId } = await params;

  const db = getDbAdapter();
  await ensureDefectsTable(db);

  const row = await db.queryOne<DefectRow>('SELECT * FROM nf_defects WHERE id = ?', defectId);
  if (!row) return NextResponse.json({ error: 'Defect not found' }, { status: 404 });

  const authUser = await getAuthUser(req);
  const partner = await getPartnerAuth(req);
  const isBuyer = authUser && authUser.email === row.reporter_email;
  const isPartner = partner && row.partner_email && partner.email === row.partner_email;
  const isAdmin = authUser?.roles?.some(r => r.role === 'super_admin' || r.role === 'org_admin');

  if (!isBuyer && !isPartner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as {
    status?: unknown;
    partnerResponse?: unknown;
    resolutionNote?: unknown;
    rmaInstructions?: unknown;
  };

  if (typeof body.status !== 'string') {
    return NextResponse.json({ error: 'status is required' }, { status: 400 });
  }
  const newStatus = body.status as DefectStatus;
  const currentStatus = row.status as DefectStatus;

  // 1) 일반 전이 유효성
  if (!isValidTransition(currentStatus, newStatus)) {
    return NextResponse.json(
      { error: `Invalid transition: ${currentStatus} → ${newStatus}` },
      { status: 400 },
    );
  }

  // 2) 역할별 전이 허용 목록 — 관리자는 bypass
  if (!isAdmin) {
    const allowList = isPartner ? PARTNER_ALLOWED_TRANSITIONS
                    : isBuyer   ? BUYER_ALLOWED_TRANSITIONS
                    : [];
    const ok = allowList.some(t => t.from === currentStatus && t.to === newStatus);
    if (!ok) {
      return NextResponse.json(
        { error: `권한으로 ${currentStatus} → ${newStatus} 전이 불가.` },
        { status: 403 },
      );
    }
  }

  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const vals: unknown[] = [newStatus, Date.now()];

  if (typeof body.partnerResponse === 'string' && isPartner) {
    sets.push('partner_response = ?');
    vals.push(sanitizeText(body.partnerResponse, 2000));
  }
  if (typeof body.resolutionNote === 'string' && (isBuyer || isAdmin)) {
    sets.push('resolution_note = ?');
    vals.push(sanitizeText(body.resolutionNote, 2000));
  }
  if (typeof body.rmaInstructions === 'string' && (isPartner || isAdmin)) {
    sets.push('rma_instructions = ?');
    vals.push(sanitizeText(body.rmaInstructions, 2000));
  }

  // approved 전이 시 RMA 번호 자동 발급 — 재발급 방지
  if (newStatus === 'approved' && !row.rma_number) {
    sets.push('rma_number = ?');
    vals.push(generateRmaNumber());
  }
  if (newStatus === 'resolved') {
    sets.push('resolved_at = ?');
    vals.push(Date.now());
  }

  vals.push(defectId);
  await db.execute(`UPDATE nf_defects SET ${sets.join(', ')} WHERE id = ?`, ...vals);

  // resolved 전이 시 metric — 해결률 차원 append-only
  if (newStatus === 'resolved' && row.partner_email) {
    void recordMetric({
      partnerEmail: row.partner_email,
      kind: 'defect_resolved',
      orderId: row.order_id,
    });
  }

  const updated = await db.queryOne<DefectRow>('SELECT * FROM nf_defects WHERE id = ?', defectId);
  return NextResponse.json({ defect: updated ? rowToDefect(updated) : null });
}
