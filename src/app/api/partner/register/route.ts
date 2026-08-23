/**
 * POST /api/partner/register — Submit partner application
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { enqueueJob } from '@/lib/job-queue';
import { randomUUID, createHash } from 'crypto';
import { checkOrigin } from '@/lib/csrf';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { verifyRecaptchaV3 } from '@/lib/recaptcha';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_PARTNER_REGISTER_BODY_BYTES = 64 * 1024;

export const dynamic = 'force-dynamic';

interface RegisterBody {
  recaptcha_token?: string;
  company_name: string;
  biz_number: string;
  ceo_name: string;
  founded_year?: number;
  employee_count?: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_title?: string;
  processes?: string[];
  certifications?: string[];
  monthly_capacity?: string;
  industries?: string[];
  bio?: string;
  homepage?: string;
}

async function ensureTable(): Promise<void> {
  const db = getDbAdapter();
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS partner_applications (
      id               TEXT PRIMARY KEY,
      company_name     TEXT NOT NULL,
      biz_number       TEXT NOT NULL,
      ceo_name         TEXT NOT NULL,
      founded_year     INTEGER,
      employee_count   TEXT,
      contact_name     TEXT NOT NULL,
      contact_email    TEXT NOT NULL,
      contact_phone    TEXT NOT NULL,
      contact_title    TEXT,
      processes        TEXT,
      certifications   TEXT,
      monthly_capacity TEXT,
      industries       TEXT,
      bio              TEXT,
      homepage         TEXT,
      active_key       TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      created_at       BIGINT NOT NULL
    )
  `);
  await db.execute('ALTER TABLE partner_applications ADD COLUMN active_key TEXT').catch(() => {});
  await db.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_partner_applications_active_key ON partner_applications(active_key)',
  );
}

export async function POST(req: NextRequest) {
  try {
    if (!checkOrigin(req)) {
      return NextResponse.json({ error: 'forbidden origin' }, { status: 403 });
    }
    const ip = getTrustedClientIp(req.headers);
    const limit = await rateLimitAsync(`partner-register:${ip}`, 5, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'too many applications' },
        { status: 429, headers: rateLimitHeaders(limit, 5) },
      );
    }
    let body: RegisterBody;
    try { body = await readBoundedJson<RegisterBody>(req, MAX_PARTNER_REGISTER_BODY_BYTES); }
    catch (error) {
      if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
      throw error;
    }

    if (!process.env.RECAPTCHA_SECRET_KEY?.trim()) {
      return NextResponse.json({ error: 'registration verification unavailable' }, { status: 503 });
    }
    if (!await verifyRecaptchaV3(body.recaptcha_token ?? '', { action: 'partner_register', remoteIp: ip })) {
      return NextResponse.json({ error: 'registration verification failed' }, { status: 403 });
    }

    const boundedStrings: Array<[unknown, number]> = [
      [body.company_name, 120], [body.biz_number, 20], [body.ceo_name, 80],
      [body.contact_name, 80], [body.contact_email, 254], [body.contact_phone, 30],
      [body.contact_title, 80], [body.employee_count, 40], [body.monthly_capacity, 120],
      [body.bio, 4000], [body.homepage, 500],
    ];
    if (boundedStrings.some(([value, max]) => typeof value === 'string' && value.length > max)
        || (body.processes?.length ?? 0) > 50 || (body.certifications?.length ?? 0) > 50
        || (body.industries?.length ?? 0) > 50) {
      return NextResponse.json({ error: 'input too long' }, { status: 400 });
    }
    if (boundedStrings.some(([value]) => typeof value === 'string' && /[<>\r\n]/.test(value))) {
      return NextResponse.json({ error: 'invalid characters' }, { status: 400 });
    }
    const lists = [body.processes, body.certifications, body.industries];
    if (lists.some((list) => list && list.some(
      (value) => typeof value !== 'string' || value.length > 100 || /[<>\r\n]/.test(value),
    ))) {
      return NextResponse.json({ error: 'invalid list value' }, { status: 400 });
    }
    if (body.homepage?.trim()) {
      try {
        const homepage = new URL(body.homepage.trim());
        if (!['http:', 'https:'].includes(homepage.protocol)) throw new Error('invalid protocol');
      } catch {
        return NextResponse.json({ error: 'invalid homepage URL' }, { status: 400 });
      }
    }

    // Basic validation
    if (!body.company_name?.trim()) {
      return NextResponse.json({ error: '회사명은 필수입니다.' }, { status: 400 });
    }
    if (!body.biz_number?.trim()) {
      return NextResponse.json({ error: '사업자등록번호는 필수입니다.' }, { status: 400 });
    }
    if (!/^\d{3}-\d{2}-\d{5}$/.test(body.biz_number.trim())) {
      return NextResponse.json({ error: '올바른 사업자등록번호 형식이 아닙니다.' }, { status: 400 });
    }
    if (!body.contact_name?.trim()) {
      return NextResponse.json({ error: '담당자명은 필수입니다.' }, { status: 400 });
    }
    if (!body.contact_email?.trim()) {
      return NextResponse.json({ error: '이메일은 필수입니다.' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contact_email.trim())) {
      return NextResponse.json({ error: '올바른 이메일 형식이 아닙니다.' }, { status: 400 });
    }
    if (!body.contact_phone?.trim()) {
      return NextResponse.json({ error: '전화번호는 필수입니다.' }, { status: 400 });
    }

    await ensureTable();

    const db = getDbAdapter();
    const id = `pa-${randomUUID().slice(0, 12)}`;
    const now = Date.now();

    const facId = `FAC-${now}-${id.slice(-6)}`;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const code = String(100000 + (buf[0] % 900000));
    const tokenHash = createHash('sha256').update(code).digest('hex');
    const tokenId = `PT-${now}-${randomUUID().slice(0, 8)}`;

    const created = await db.transaction(async (tx) => {
      const existing = await tx.queryOne<{ id: string }>(
        `SELECT id FROM partner_applications WHERE LOWER(contact_email) = ? AND status = 'pending'`,
        body.contact_email.trim().toLowerCase(),
      );
      if (existing) return false;

      await tx.execute(
      `INSERT INTO partner_applications
        (id, company_name, biz_number, ceo_name, founded_year, employee_count,
         contact_name, contact_email, contact_phone, contact_title,
         processes, certifications, monthly_capacity, industries,
         bio, homepage, active_key, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`,
      id,
      body.company_name.trim(),
      body.biz_number.trim(),
      body.ceo_name.trim(),
      body.founded_year ?? null,
      body.employee_count ?? null,
      body.contact_name.trim(),
      body.contact_email.trim(),
      body.contact_phone.trim(),
      body.contact_title?.trim() ?? null,
      JSON.stringify(body.processes ?? []),
      JSON.stringify(body.certifications ?? []),
      body.monthly_capacity ?? null,
      JSON.stringify(body.industries ?? []),
      body.bio?.trim() ?? null,
      body.homepage?.trim() ?? null,
      body.contact_email.trim().toLowerCase(),
      now,
    );

    // ── 1. 파트너 factory 레코드 즉시 생성 (status='pending_approval') ──
      await tx.execute(
      `INSERT INTO nf_factories
         (id, name, region, processes, certifications, description,
          contact_email, contact_phone, partner_email, website,
          status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      facId,
      body.company_name.trim(),
      'KR',
      JSON.stringify(body.processes ?? []),
      JSON.stringify(body.certifications ?? []),
      body.bio?.trim() ?? null,
      body.contact_email.trim(),
      body.contact_phone.trim(),
      body.contact_email.trim(),
      body.homepage?.trim() ?? null,
      'pending_approval',
      now,
      now,
      );

    // ── 2. OTP 토큰 생성 → 파트너에게 환영 이메일 발송 ──
      await tx.execute(
      `INSERT INTO nf_partner_tokens
         (id, partner_id, email, company, token_hash, expires_at, used, created_at)
       VALUES (?,?,?,?,?,?,FALSE,?)`,
      tokenId, facId,
      body.contact_email.trim(),
      body.company_name.trim(),
      tokenHash,
      now + 7 * 86_400_000,
      now,
      );
      return true;
    });
    if (!created) {
      return NextResponse.json({ error: '동일 이메일로 이미 신청이 접수되어 있습니다.' }, { status: 409 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nexyfab.com';
    const { sendEmail } = await import('@/lib/nexyfab-email');
    sendEmail(
      body.contact_email.trim(),
      '[NexyFab] 파트너 신청이 접수되었습니다 — 임시 접속 코드',
      `<!DOCTYPE html><html lang="ko"><body style="font-family:system-ui;background:#f3f4f6;padding:24px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px #00000018">
        <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;padding:28px 32px">
          <div style="font-size:22px;font-weight:900">NexyFab</div>
          <div style="font-size:13px;opacity:0.8;margin-top:4px">파트너 포털</div>
        </div>
        <div style="padding:28px 32px">
          <h2 style="margin:0 0 12px;font-size:18px;color:#111">신청이 접수되었습니다!</h2>
          <p style="color:#4b5563;font-size:14px;line-height:1.7">
            안녕하세요, <strong>${body.company_name.trim()}</strong>님.<br>
            파트너 신청이 정상적으로 접수되었습니다. 검토 후 최종 승인이 완료되며, 그 전에도 아래 코드로 파트너 포털에 먼저 접속하실 수 있습니다.
          </p>
          <div style="background:#f0f4ff;border:1px solid #c7d7fe;border-radius:10px;padding:20px;text-align:center;margin:20px 0">
            <div style="font-size:12px;color:#6b7280;margin-bottom:6px">임시 접속 코드 (7일 유효)</div>
            <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#2563eb">${code}</div>
          </div>
          <a href="${baseUrl}/partner/login"
             style="display:block;text-align:center;padding:13px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
            파트너 포털 접속하기
          </a>
          <p style="font-size:12px;color:#6b7280;margin-top:16px;line-height:1.6">
            신청 번호: <strong>${id}</strong><br>
            이메일: ${body.contact_email.trim()}
          </p>
          <p style="font-size:11px;color:#9ca3af;margin-top:8px">
            검토는 영업일 기준 1-3일 소요됩니다. 최종 승인 시 별도 안내 메일이 발송됩니다.
          </p>
        </div>
      </div>
      </body></html>`,
    ).catch(() => {});

    // ── 3. 관리자 알림 ──
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@nexyfab.com';
    const processesStr = (body.processes ?? []).join(', ') || '—';
    await enqueueJob('send_email', {
      to: adminEmail,
      subject: `[NexyFab] 새 파트너 신청: ${body.company_name.trim()}`,
      html: `
        <h2>새 파트너 등록 신청이 접수되었습니다</h2>
        <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
          <tr><th>항목</th><th>내용</th></tr>
          <tr><td>회사명</td><td>${body.company_name.trim()}</td></tr>
          <tr><td>사업자등록번호</td><td>${body.biz_number.trim()}</td></tr>
          <tr><td>대표자</td><td>${body.ceo_name.trim()}</td></tr>
          <tr><td>담당자</td><td>${body.contact_name.trim()} (${body.contact_title?.trim() || '—'})</td></tr>
          <tr><td>이메일</td><td>${body.contact_email.trim()}</td></tr>
          <tr><td>전화</td><td>${body.contact_phone.trim()}</td></tr>
          <tr><td>직원 수</td><td>${body.employee_count ?? '—'}</td></tr>
          <tr><td>주요 공정</td><td>${processesStr}</td></tr>
          <tr><td>월 생산 능력</td><td>${body.monthly_capacity ?? '—'}</td></tr>
        </table>
        <p style="margin-top:16px;">
          <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://nexyfab.com'}/nexyfab/admin"
             style="background:#2563eb;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;">
            관리자 대시보드에서 검토하기
          </a>
        </p>
      `,
    }).catch(() => { /* non-blocking */ });

    return NextResponse.json({ ok: true, id, facId }, { status: 201 });
  } catch (err) {
    const dbError = err as { code?: string; message?: string };
    if (dbError.code === '23505' || dbError.code === 'SQLITE_CONSTRAINT_UNIQUE'
        || dbError.message?.includes('partner_applications.active_key')) {
      return NextResponse.json({ error: '동일 이메일로 이미 신청이 접수되어 있습니다.' }, { status: 409 });
    }
    console.error('[partner/register] POST error:', err);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
