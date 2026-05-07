/**
 * GET  /api/admin/rfq  — RFQ 목록 조회 (관리자)
 * POST /api/admin/rfq  — RFQ에 제조사 배정 + 이메일 발송
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendEmail, rfqAssignedToFactoryHtml } from '@/lib/nexyfab-email';
import { enqueueJob } from '@/lib/job-queue';
import { createNotification } from '@/app/lib/notify';
import { logAudit } from '@/lib/audit';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

interface RfqRow {
  id: string;
  user_id: string;
  user_email: string | null;
  shape_name: string | null;
  material_id: string | null;
  quantity: number;
  volume_cm3: number | null;
  dfm_score: number | null;
  dfm_process: string | null;
  note: string | null;
  status: string;
  quote_amount: number | null;
  manufacturer_note: string | null;
  assigned_factory_id: string | null;
  assigned_factory_name: string | null;
  created_at: number;
  updated_at: number;
  // joined
  user_name: string | null;
  factory_name: string | null;
  factory_email: string | null;
}

export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status') || 'all';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '30', 10));
  const offset = (page - 1) * limit;

  // 데모 격리: nf_sessions.is_demo=true 에 연결된 RFQ 와 user_id='demo-user'
  // sentinel 둘 다 제외. FK 없는 레거시 행도 sentinel 로 커버됨.
  let where = "r.user_id <> 'demo-user'";
  const args: (string | number)[] = [];

  if (status !== 'all') {
    where += ' AND r.status = ?';
    args.push(status);
  }

  const countRow = await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM nf_rfqs r WHERE ${where}`,
    ...args,
  );
  const total = countRow?.cnt ?? 0;

  const rows = await db.queryAll<RfqRow>(
    `SELECT
       r.*,
       u.name  AS user_name,
       f.name  AS factory_name,
       f.contact_email AS factory_email
     FROM nf_rfqs r
     LEFT JOIN nf_users u ON u.id = r.user_id
     LEFT JOIN nf_factories f ON f.id = r.assigned_factory_id
     WHERE ${where}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    ...args, limit, offset,
  );

  return NextResponse.json({
    rfqs: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as {
    rfqId: string;
    factoryId: string;
    adminNote?: string;
  };

  if (!body.rfqId || !body.factoryId) {
    return NextResponse.json({ error: 'rfqId, factoryId는 필수입니다.' }, { status: 400 });
  }

  const db = getDbAdapter();

  const rfq = await db.queryOne<{
    id: string; user_id: string; user_email: string | null;
    shape_name: string | null; material_id: string | null; quantity: number; note: string | null;
  }>('SELECT * FROM nf_rfqs WHERE id = ?', body.rfqId);

  if (!rfq) return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });

  const factory = await db.queryOne<{
    id: string; name: string; name_ko: string | null; contact_email: string | null; partner_email: string | null;
  }>('SELECT id, name, name_ko, contact_email, partner_email FROM nf_factories WHERE id = ?', body.factoryId);

  if (!factory) return NextResponse.json({ error: '제조사를 찾을 수 없습니다.' }, { status: 404 });

  const now = Date.now();
  await db.execute(
    `UPDATE nf_rfqs
     SET status = 'assigned',
         assigned_factory_id = ?,
         assigned_at = ?,
         manufacturer_note = ?,
         updated_at = ?
     WHERE id = ?`,
    factory.id,
    now,
    body.adminNote || null,
    now,
    rfq.id,
  );

  const html = rfqAssignedToFactoryHtml({
    factoryName: factory.name_ko || factory.name,
    rfqId: rfq.id,
    shapeName: rfq.shape_name || '(미입력)',
    materialId: rfq.material_id || '(미입력)',
    quantity: rfq.quantity,
    note: rfq.note || undefined,
  });
  const mailSubject = `[NexyFab] 새 견적 요청 — ${rfq.shape_name || rfq.id}`;

  // 제조사 이메일(담당·연락처) — 서로 다르면 둘 다 발송
  const mailTo = new Set<string>();
  const ce = factory.contact_email?.trim();
  const pe = factory.partner_email?.trim();
  if (ce) mailTo.add(ce);
  if (pe && pe.toLowerCase() !== (ce ?? '').toLowerCase()) mailTo.add(pe);
  for (const to of mailTo) {
    await enqueueJob('send_email', { to, subject: mailSubject, html });
  }

  // 파트너 인앱 알림 — 수신 이메일별로 정규화된 user_id (중복 키 병합)
  const notifKeys = new Set<string>();
  if (ce) notifKeys.add(`partner:${normPartnerEmail(ce)}`);
  if (pe) notifKeys.add(`partner:${normPartnerEmail(pe)}`);
  for (const userId of notifKeys) {
    createNotification(
      userId,
      'quote_received',
      '새 견적 요청 배정',
      `${rfq.shape_name || rfq.id} (${rfq.material_id || '소재 미정'}, ${rfq.quantity}개) RFQ가 배정되었습니다.`,
    );
  }

  // 관리자 알림 발송은 기존 rfqNotificationHtml 재사용
  const adminEmail = process.env.ADMIN_EMAIL;
  const sendTo = process.env.SEND_MAIL_RECIPIENTS || adminEmail;
  if (sendTo) {
    await enqueueJob('send_email', {
      to: sendTo,
      subject: `[NexyFab Admin] RFQ ${rfq.id} → ${factory.name} 배정 완료`,
      html: `<p>RFQ <strong>${rfq.id}</strong>이 <strong>${factory.name}</strong>에 배정되었습니다.</p>`,
    });
  }

  logAudit({
    userId: 'admin',
    action: 'rfq.assign',
    resourceId: rfq.id,
    metadata: { factoryId: factory.id, factoryName: factory.name },
  });

  return NextResponse.json({
    ok: true,
    rfqId: rfq.id,
    factoryId: factory.id,
    factoryName: factory.name,
    emailSent: !!factory.contact_email,
  });
}
