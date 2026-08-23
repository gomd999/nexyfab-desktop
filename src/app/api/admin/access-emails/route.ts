import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';
import { getAdminIdentity, verifyAdmin } from '@/lib/admin-auth';
import {
  addAdminAccessEmail,
  listAdminAccessEmails,
  normalizeAdminEmail,
  setAdminAccessEmailActive,
} from '@/lib/admin-email-auth';
import { recordAdminAudit } from '@/lib/admin-audit';
import { sendEmail } from '@/lib/email';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private' };

async function actor(req: NextRequest): Promise<string | null> {
  if (!(await verifyAdmin(req))) return null;
  const identity = await getAdminIdentity(req);
  return identity && identity !== 'automation' ? identity : null;
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  const status = code === 'INVALID_EMAIL' ? 400
    : code === 'ADMIN_EMAIL_NOT_FOUND' ? 404
      : code.startsWith('CANNOT_') ? 409
        : 500;
  const message = code === 'INVALID_EMAIL' ? '올바른 이메일 주소를 입력해 주세요.'
    : code === 'CANNOT_DISABLE_CURRENT_ADMIN' ? '현재 로그인한 관리자 이메일은 비활성화할 수 없습니다.'
      : code === 'CANNOT_DISABLE_LAST_ADMIN' ? '마지막 활성 관리자 이메일은 비활성화할 수 없습니다.'
        : code === 'ADMIN_EMAIL_NOT_FOUND' ? '관리자 이메일을 찾을 수 없습니다.'
          : '관리자 이메일 설정을 변경하지 못했습니다.';
  return NextResponse.json({ error: message, code }, { status, headers: PRIVATE_HEADERS });
}

export async function GET(req: NextRequest) {
  const currentEmail = await actor(req);
  if (!currentEmail) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: PRIVATE_HEADERS });
  return NextResponse.json({ ok: true, currentEmail, emails: await listAdminAccessEmails() }, { headers: PRIVATE_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req) || req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const currentEmail = await actor(req);
  if (!currentEmail) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: PRIVATE_HEADERS });
  let body: { email?: unknown };
  try { body = await readBoundedJson(req, 64 * 1024); }
  catch (error) {
    if (boundedJsonError(error)?.status === 413) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: PRIVATE_HEADERS });
    body = {};
  }
  const email = normalizeAdminEmail(body.email);
  if (!email) return errorResponse(new Error('INVALID_EMAIL'));
  try {
    const entry = await addAdminAccessEmail(email, currentEmail);
    void recordAdminAudit(req, {
      adminUserId: currentEmail,
      action: 'admin.access_email.add',
      target: email,
    });
    if (email !== currentEmail) {
      void sendEmail({
        to: email,
        subject: '[NexyFab] 관리자 이메일로 등록되었습니다',
        text: `${currentEmail} 관리자가 이 이메일을 NexyFab 관리자 로그인 허용 목록에 추가했습니다. 본인이 예상하지 않은 변경이면 nexyfab@nexysys.com으로 문의해 주세요.`,
        html: `<p><b>${currentEmail}</b> 관리자가 이 이메일을 NexyFab 관리자 로그인 허용 목록에 추가했습니다.</p><p>본인이 예상하지 않은 변경이면 <a href="mailto:nexyfab@nexysys.com">nexyfab@nexysys.com</a>으로 문의해 주세요.</p>`,
      }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, entry }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req) || req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const currentEmail = await actor(req);
  if (!currentEmail) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: PRIVATE_HEADERS });
  let body: { email?: unknown; active?: unknown };
  try { body = await readBoundedJson(req, 64 * 1024); }
  catch (error) {
    if (boundedJsonError(error)?.status === 413) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: PRIVATE_HEADERS });
    body = {};
  }
  const email = normalizeAdminEmail(body.email);
  if (!email || typeof body.active !== 'boolean') {
    return NextResponse.json({ error: '이메일과 활성 상태가 필요합니다.' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  try {
    await setAdminAccessEmailActive(email, body.active, currentEmail);
    void recordAdminAudit(req, {
      adminUserId: currentEmail,
      action: body.active ? 'admin.access_email.enable' : 'admin.access_email.disable',
      target: email,
    });
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
