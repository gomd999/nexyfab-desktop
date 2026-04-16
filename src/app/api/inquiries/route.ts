import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { sendNotificationEmail } from '@/app/lib/mailer';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { enqueueJob } from '@/lib/job-queue';

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nexyfab.com';

interface InquiryRow {
  id: string;
  action: string;
  name: string;
  email: string;
  project_name: string;
  budget: string | null;
  message: string;
  phone: string | null;
  status: string;
  admin_note: string | null;
  rfq_id: string | null;
  shape_id: string | null;
  material_id: string | null;
  volume_cm3: number | null;
  created_at: string;
  updated_at: string | null;
}

function rowToInquiry(r: InquiryRow) {
  return {
    id: r.id,
    action: r.action,
    name: r.name,
    email: r.email,
    projectName: r.project_name,
    budget: r.budget,
    message: r.message,
    phone: r.phone,
    status: r.status,
    adminNote: r.admin_note,
    rfqId: r.rfq_id,
    shapeId: r.shape_id,
    materialId: r.material_id,
    volume_cm3: r.volume_cm3,
    date: r.created_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// GET /api/inquiries — admin only
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const customerEmail = searchParams.get('customerEmail');
  const status = searchParams.get('status');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '50', 10));
  const offset = (page - 1) * limit;

  const conditions: string[] = ["action != 'send_partner_register'"];
  const vals: unknown[] = [];

  if (customerEmail) {
    conditions.push('email = ?');
    vals.push(customerEmail.trim().toLowerCase());
  }
  if (status) {
    conditions.push('status = ?');
    vals.push(status);
  }

  const where = conditions.join(' AND ');

  const countRow = await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM nf_inquiries WHERE ${where}`,
    ...vals,
  );
  const total = countRow?.cnt ?? 0;

  const rows = await db.queryAll<InquiryRow>(
    `SELECT * FROM nf_inquiries WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...vals, limit, offset,
  );

  return NextResponse.json({
    inquiries: rows.map(rowToInquiry),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'contacted', 'closed']),
  note: z.string().max(2000).optional(),
});

// PATCH /api/inquiries — update status and/or adminNote (admin only)
export async function PATCH(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값 오류' }, { status: 400 });
  }
  const { id, status, note } = parsed.data;

  const db = getDbAdapter();
  const row = await db.queryOne<InquiryRow>('SELECT * FROM nf_inquiries WHERE id = ?', id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const vals: unknown[] = [status, now];

  if (note !== undefined) {
    sets.push('admin_note = ?');
    vals.push(note);
  }
  vals.push(id);

  await db.execute(`UPDATE nf_inquiries SET ${sets.join(', ')} WHERE id = ?`, ...vals);

  // 고객 이메일 알림
  const email = row.email;
  const name = row.name || '고객';
  if (email) {
    if (status === 'contacted') {
      enqueueJob('send_email', {
        to: email,
        subject: '[NexyFab] 담당자 연락 예정 안내',
        html: `<p>안녕하세요, ${name}님.</p>
<p>NexyFab 담당자가 곧 연락을 드릴 예정입니다.</p>
<p>문의해 주셔서 감사합니다.</p>
<br/><p>— NexyFab 팀</p>`,
      });
    } else if (status === 'closed') {
      enqueueJob('send_email', {
        to: email,
        subject: '[NexyFab] 문의 종료 안내',
        html: `<p>안녕하세요, ${name}님.</p>
<p>접수하신 문의가 종료 처리되었습니다.</p>
<p>추가 문의사항이 있으시면 언제든지 연락해 주세요.</p>
<br/><p>— NexyFab 팀</p>`,
      });
    }
  }

  const updated = await db.queryOne<InquiryRow>('SELECT * FROM nf_inquiries WHERE id = ?', id);
  return NextResponse.json({ inquiry: rowToInquiry(updated!) });
}

const inquirySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(254),
  projectName: z.string().min(1).max(200),
  budget: z.string().regex(/^[\d,.\s~\-+₩$¥€원만억]*$/).max(100).optional(),
  message: z.string().max(3000).optional(),
  phone: z.string().regex(/^[+\d\s\-().]{0,30}$/).max(30).optional(),
  rfqId: z.string().max(100).optional(),
  shapeId: z.string().max(100).optional(),
  materialId: z.string().max(100).optional(),
  volume_cm3: z.number().nonnegative().max(1_000_000).optional(),
});

// POST /api/inquiries — 새 문의 접수
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!rateLimit(`inquiries:${ip}`, 5, 60 * 60_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 1시간 후 다시 시도하세요.' }, { status: 429 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = inquirySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' },
      { status: 400 },
    );
  }

  const { name, email, projectName, budget, message, phone, rfqId, shapeId, materialId, volume_cm3 } = parsed.data;

  const id = `INQ-${Date.now()}`;
  const now = new Date().toISOString();

  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_inquiries
      (id, action, name, email, project_name, budget, message, phone,
       status, rfq_id, shape_id, material_id, volume_cm3, created_at)
     VALUES (?, 'send_contact', ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    id, name, email.trim().toLowerCase(), projectName,
    budget ?? null, message ?? '', phone ?? null,
    rfqId ?? null, shapeId ?? null, materialId ?? null,
    volume_cm3 ?? null, now,
  );

  // 어드민 알림 이메일 — fire-and-forget
  sendNotificationEmail(
    ADMIN_EMAIL,
    `[NexyFab] 새 제조 문의 접수 - ${projectName}`,
    `<h2 style="color:#1a56db">새 제조 문의가 접수되었습니다</h2>
<table style="border-collapse:collapse;width:100%;font-size:14px">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb;width:120px">문의자명</td><td style="padding:8px;border:1px solid #e5e7eb">${name}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb">이메일</td><td style="padding:8px;border:1px solid #e5e7eb">${email}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb">프로젝트명</td><td style="padding:8px;border:1px solid #e5e7eb">${projectName}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb">예산</td><td style="padding:8px;border:1px solid #e5e7eb">${budget || '미기입'}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb">접수 시각</td><td style="padding:8px;border:1px solid #e5e7eb">${new Date().toLocaleString('ko-KR')}</td></tr>
</table>
<p style="margin-top:16px;color:#6b7280;font-size:12px">— NexyFab 어드민 자동 알림</p>`,
  ).catch(e => console.error('[inquiries POST] 어드민 알림 발송 실패:', e));

  return NextResponse.json({ inquiry: { id, name, email, projectName, budget, message, phone, status: 'pending', createdAt: now } }, { status: 201 });
}
