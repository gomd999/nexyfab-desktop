import { NextRequest, NextResponse } from 'next/server';
import { sendNotificationEmail } from '@/app/lib/mailer';
import { createNotification } from '@/app/lib/notify';
import { verifyAdmin } from '@/lib/admin-auth';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { enqueueJob } from '@/lib/job-queue';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

interface FactoryRow {
  id: string; name: string; partner_email: string | null;
  contact_email: string | null; contact_phone: string | null;
  tech_exp: string | null; match_field: string | null;
  capacity_amount: string | null; partner_type: string | null;
  description: string | null; region: string;
  status: string; created_at: number; updated_at: number;
}

// GET /api/partners — list partners with ratings (admin only)
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const db = getDbAdapter();

  const factories = await db.queryAll<FactoryRow>(
    `SELECT id, name, partner_email, contact_email, contact_phone,
            tech_exp, match_field, capacity_amount, partner_type,
            description, region, status, created_at, updated_at
     FROM nf_factories
     WHERE partner_email IS NOT NULL
     ORDER BY created_at DESC`,
  );

  if (factories.length === 0) {
    return NextResponse.json({ partners: [] });
  }

  // Build per-partner rating map from nf_reviews
  const partnerEmails = factories.map(f => f.partner_email).filter(Boolean) as string[];
  const placeholders = partnerEmails.map(() => '?').join(', ');
  const reviewRows = await db.queryAll<{ partner_email: string; rating: number }>(
    `SELECT partner_email, rating FROM nf_reviews WHERE partner_email IN (${placeholders})`,
    ...partnerEmails,
  ).catch(() => [] as { partner_email: string; rating: number }[]);

  const ratingMap: Record<string, { sum: number; count: number }> = {};
  for (const r of reviewRows) {
    if (!ratingMap[r.partner_email]) ratingMap[r.partner_email] = { sum: 0, count: 0 };
    ratingMap[r.partner_email].sum += r.rating;
    ratingMap[r.partner_email].count += 1;
  }

  const partners = factories.map(f => {
    const rm = f.partner_email ? ratingMap[f.partner_email] : null;
    return {
      id: f.id,
      email: f.partner_email,
      company: f.name,
      name: f.name,
      phone: f.contact_phone,
      tech_exp: f.tech_exp,
      match_field: f.match_field,
      amount: f.capacity_amount,
      partner_type: f.partner_type,
      region: f.region,
      description: f.description,
      partnerStatus: f.status,
      date: new Date(f.created_at).toISOString(),
      avgRating: rm ? Math.round((rm.sum / rm.count) * 10) / 10 : 0,
      reviewCount: rm?.count ?? 0,
    };
  });

  return NextResponse.json({ partners });
}

// PATCH /api/partners — update partner status (admin only)
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { id, status, note } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });

  const db = getDbAdapter();
  const factory = await db.queryOne<{ id: string; partner_email: string | null; name: string }>(
    'SELECT id, partner_email, name FROM nf_factories WHERE id = ?', id,
  );
  if (!factory) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });

  await db.execute(
    'UPDATE nf_factories SET status = ?, updated_at = ? WHERE id = ?',
    status, Date.now(), id,
  );

  logAudit({
    userId: 'admin',
    action: 'partner.status_update',
    resourceId: id,
    metadata: { status, note, partnerEmail: factory.partner_email },
  });

  // 이메일 + 인앱 알림
  const email = factory.partner_email;
  const name = factory.name || email || '파트너';

  if (email && (status === 'approved' || status === 'rejected')) {
    if (status === 'approved') {
      enqueueJob('send_email', {
        to: email,
        subject: '[NexyFab] 파트너 등록 승인 안내',
        html: `<p>안녕하세요, ${name}님.</p>
<p>NexyFab 파트너 등록 신청이 <strong>승인</strong>되었습니다.</p>
<p>파트너로서 함께 성장해 나가겠습니다. 감사합니다.</p>
<br/><p>— NexyFab 팀</p>`,
      });
      createNotification(
        `partner:${email}`,
        'partner_approved',
        '파트너 등록이 승인되었습니다',
        'NexyFab 파트너로 등록이 승인되었습니다. 파트너 포털에서 활동을 시작하세요.',
      );
    } else {
      enqueueJob('send_email', {
        to: email,
        subject: '[NexyFab] 파트너 등록 반려 안내',
        html: `<p>안녕하세요, ${name}님.</p>
<p>NexyFab 파트너 등록 신청이 <strong>반려</strong>되었습니다.</p>
${note ? `<p>사유: ${note}</p>` : ''}
<p>추가 문의사항이 있으시면 언제든지 연락해 주세요.</p>
<br/><p>— NexyFab 팀</p>`,
      });
      createNotification(
        `partner:${email}`,
        'partner_rejected',
        '파트너 등록이 반려되었습니다',
        `NexyFab 파트너 등록 신청이 반려되었습니다.${note ? ` 사유: ${note}` : ''}`,
      );
    }
  }

  return NextResponse.json({ ok: true });
}
