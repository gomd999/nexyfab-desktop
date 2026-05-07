/**
 * PATCH /api/admin/partner-applications/[id] — Approve or reject a partner application
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { enqueueJob } from '@/lib/job-queue';

export const dynamic = 'force-dynamic';

interface PatchBody {
  action: 'approve' | 'reject';
}

interface AppRow {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  status: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json() as PatchBody;

  if (!['approve', 'reject'].includes(body.action)) {
    return NextResponse.json({ error: 'Invalid action. Use "approve" or "reject".' }, { status: 400 });
  }

  const db = getDbAdapter();

  const app = await db.queryOne<AppRow>(
    'SELECT id, company_name, contact_name, contact_email, status FROM partner_applications WHERE id = ?',
    id,
  );

  if (!app) {
    return NextResponse.json({ error: '신청을 찾을 수 없습니다.' }, { status: 404 });
  }

  const newStatus = body.action === 'approve' ? 'approved' : 'rejected';
  await db.execute(
    'UPDATE partner_applications SET status = ? WHERE id = ?',
    newStatus,
    id,
  );

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://nexyfab.com';

  if (body.action === 'approve') {
    // Send welcome email
    await enqueueJob('send_email', {
      to: app.contact_email,
      subject: '[NexyFab] 파트너 신청이 승인되었습니다',
      html: `
        <h2>파트너 신청이 승인되었습니다</h2>
        <p>안녕하세요, ${app.contact_name}님.</p>
        <p><strong>${app.company_name}</strong>의 NexyFab 파트너 신청이 승인되었습니다.</p>
        <p>담당자가 곧 파트너 포털 액세스 코드를 별도로 안내드릴 예정입니다.</p>
        <p style="margin-top:16px;">
          <a href="${baseUrl}/partner/login"
             style="background:#2563eb;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;">
            파트너 포털 바로가기
          </a>
        </p>
        <p style="margin-top:16px;color:#666;font-size:13px;">문의: <a href="mailto:partner@nexyfab.com">partner@nexyfab.com</a></p>
      `,
    }).catch(() => { /* non-blocking */ });
  } else {
    // Send rejection email
    await enqueueJob('send_email', {
      to: app.contact_email,
      subject: '[NexyFab] 파트너 신청 결과 안내',
      html: `
        <h2>파트너 신청 검토 결과</h2>
        <p>안녕하세요, ${app.contact_name}님.</p>
        <p><strong>${app.company_name}</strong>의 NexyFab 파트너 신청을 검토한 결과,<br>
        현재 기준에 부합하지 않아 승인이 어렵게 되었습니다.</p>
        <p>추후 다시 신청하시거나 문의사항이 있으시면 아래로 연락 주세요.</p>
        <p style="margin-top:16px;color:#666;font-size:13px;">문의: <a href="mailto:partner@nexyfab.com">partner@nexyfab.com</a></p>
      `,
    }).catch(() => { /* non-blocking */ });
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
