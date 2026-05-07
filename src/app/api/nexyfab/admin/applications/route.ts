import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

interface AppRow {
  id: string; company_name: string; biz_number: string; ceo_name: string;
  contact_name: string; contact_email: string; contact_phone: string;
  processes: string | null; certifications: string | null;
  bio: string | null; homepage: string | null; status: string; created_at: number;
}

async function requireAdmin(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return null;
  const isAdmin = authUser.globalRole === 'super_admin' || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  return isAdmin ? authUser : null;
}

// GET /api/nexyfab/admin/applications
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const status = req.nextUrl.searchParams.get('status') ?? 'pending';

  const rows = await db.queryAll<AppRow>(
    `SELECT * FROM partner_applications WHERE status = ? ORDER BY created_at DESC LIMIT 50`,
    status,
  ).catch((): AppRow[] => []);

  const apps = rows.map(r => ({
    id: r.id,
    companyName: r.company_name,
    bizNumber: r.biz_number,
    ceoName: r.ceo_name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    processes: JSON.parse(r.processes ?? '[]') as string[],
    certifications: JSON.parse(r.certifications ?? '[]') as string[],
    bio: r.bio,
    homepage: r.homepage,
    status: r.status,
    createdAt: r.created_at,
  }));

  return NextResponse.json({ applications: apps });
}

// PATCH /api/nexyfab/admin/applications  — 승인 또는 거절
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as { id: string; action: 'approve' | 'reject'; note?: string };
  if (!body.id || !['approve', 'reject'].includes(body.action)) {
    return NextResponse.json({ error: 'id and action (approve|reject) required' }, { status: 400 });
  }

  const db = getDbAdapter();
  const app = await db.queryOne<AppRow>(
    'SELECT * FROM partner_applications WHERE id = ?', body.id,
  );
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  if (app.status !== 'pending') {
    return NextResponse.json({ error: '이미 처리된 신청입니다.' }, { status: 409 });
  }

  const now = Date.now();
  const newStatus = body.action === 'approve' ? 'approved' : 'rejected';
  await db.execute(
    'UPDATE partner_applications SET status = ?, updated_at = ? WHERE id = ?',
    newStatus, now, body.id,
  ).catch(async () => {
    await db.execute('ALTER TABLE partner_applications ADD COLUMN updated_at INTEGER').catch(() => {});
    await db.execute('UPDATE partner_applications SET status = ? WHERE id = ?', newStatus, body.id);
  });

  if (body.action === 'approve') {
    // nf_factories 레코드 생성 (없으면)
    const facId = `FAC-${now}`;
    const processes = JSON.parse(app.processes ?? '[]') as string[];
    const certs = JSON.parse(app.certifications ?? '[]') as string[];
    await db.execute(
      `INSERT OR IGNORE INTO nf_factories
         (id, name, region, processes, certifications, description, contact_email,
          contact_phone, partner_email, website, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      facId, app.company_name, 'KR',
      JSON.stringify(processes), JSON.stringify(certs),
      app.bio ?? null, app.contact_email, app.contact_phone,
      app.contact_email, app.homepage ?? null,
      'active', now, now,
    );

    // 파트너 로그인 토큰 발송 (fire-and-forget)
    const { sendEmail } = await import('@/lib/nexyfab-email');
    const { createHash } = await import('crypto');
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const code = String(100000 + (buf[0] % 900000));
    const tokenHash = createHash('sha256').update(code).digest('hex');
    const tokenId = `PT-${now}-${Math.random().toString(36).slice(2, 8)}`;

    await db.execute(
      `INSERT INTO nf_partner_tokens (id, partner_id, email, company, token_hash, expires_at, used, created_at)
       VALUES (?,?,?,?,?,?,0,?)`,
      tokenId, facId, app.contact_email, app.company_name, tokenHash, now + 7 * 86400000, now,
    ).catch(() => {});

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nexyfab.com';
    sendEmail(
      app.contact_email,
      '[NexyFab] 파트너 신청이 승인되었습니다',
      `<!DOCTYPE html><html lang="ko"><body style="font-family:system-ui;background:#f3f4f6;padding:24px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px #00000018">
        <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;padding:28px 32px">
          <div style="font-size:22px;font-weight:900">NexyFab</div>
          <div style="font-size:13px;opacity:0.8;margin-top:4px">파트너 포털</div>
        </div>
        <div style="padding:28px 32px">
          <h2 style="margin:0 0 12px;font-size:18px;color:#111">🎉 파트너 신청이 승인되었습니다!</h2>
          <p style="color:#4b5563;font-size:14px;line-height:1.7">
            안녕하세요, <strong>${app.company_name}</strong>님.<br>
            NexyFab 파트너로 승인되셨습니다. 아래 코드로 파트너 포털에 로그인하세요.
          </p>
          <div style="background:#f0f4ff;border:1px solid #c7d7fe;border-radius:10px;padding:20px;text-align:center;margin:20px 0">
            <div style="font-size:12px;color:#6b7280;margin-bottom:6px">접속 코드 (7일 유효)</div>
            <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#2563eb">${code}</div>
          </div>
          <a href="${baseUrl}/partner/login"
             style="display:block;text-align:center;padding:13px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
            파트너 포털 접속하기
          </a>
          <p style="font-size:11px;color:#9ca3af;margin-top:16px">이메일: ${app.contact_email}</p>
        </div>
      </div>
      </body></html>`,
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
