/**
 * GET    /api/admin/users  — 회원 목록 (필터: plan, role, q, sort, verified)
 * PATCH  /api/admin/users  — 회원 정보 수정 { userId, plan?, role?, locked?, enterpriseContract?, erpIntegrationContract?, … }
 * DELETE /api/admin/users  — 회원 삭제 { userId }
 */
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { evaluateStage } from '@/lib/stage-engine';
import { SERVICE_NAME } from '@/lib/service-config';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const sp   = req.nextUrl.searchParams;
  const plan = sp.get('plan') ?? '';
  const role = sp.get('role') ?? '';
  const q    = sp.get('q') ?? '';
  const verified = sp.get('verified') ?? '';
  const country = sp.get('country') ?? '';
  const source = sp.get('source') ?? '';
  const service = sp.get('service') ?? '';
  const sort = sp.get('sort') ?? 'created_at_desc';
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit  = 50;
  const offset = (page - 1) * limit;

  const db = getDbAdapter();

  // 데모 격리: sentinel 'demo-user' 는 관리자 목록에서 숨김
  const conditions: string[] = ["u.id <> 'demo-user'"];
  const params: unknown[]    = [];

  if (plan) { conditions.push('u.plan = ?'); params.push(plan); }
  if (role) { conditions.push('u.role = ?'); params.push(role); }
  if (verified === '1') { conditions.push('u.email_verified = 1'); }
  if (verified === '0') { conditions.push('u.email_verified = 0'); }
  if (country) { conditions.push('u.country = ?'); params.push(country); }
  if (source) { conditions.push('u.signup_source = ?'); params.push(source); }
  if (service) { conditions.push("u.services LIKE ?"); params.push(`%"${service}"%`); }
  if (q) {
    conditions.push('(u.email LIKE ? OR u.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const orderMap: Record<string, string> = {
    created_at_desc:   'u.created_at DESC',
    created_at_asc:    'u.created_at ASC',
    name_asc:          'u.name ASC',
    name_desc:         'u.name DESC',
    email_asc:         'u.email ASC',
    last_login_desc:   'u.last_login_at DESC',
    login_count_desc:  'u.login_count DESC',
  };
  const orderBy = orderMap[sort] ?? 'u.created_at DESC';

  const [users, countRow, stats] = await Promise.all([
    db.queryAll<{
      id: string; email: string; name: string; plan: string; role: string;
      email_verified: number; avatar_url: string | null;
      created_at: number; locked_until: number | null;
      totp_enabled: number; project_count: number;
      language: string | null; country: string | null; timezone: string | null;
      phone: string | null; company: string | null; job_title: string | null;
      signup_source: string | null; last_login_at: number | null; login_count: number;
      signup_ip: string | null; last_login_ip: string | null;
      services: string | null; signup_service: string | null;
      nexyfab_plan: string | null; nexyflow_plan: string | null;
      oauth_provider: string | null;
    }>(
      `SELECT u.id, u.email, u.name, u.plan, u.role,
              u.email_verified, u.avatar_url,
              u.created_at, u.locked_until,
              u.totp_enabled, u.project_count,
              u.language, u.country, u.timezone,
              u.phone, u.company, u.job_title,
              u.signup_source, u.last_login_at, u.login_count,
              u.signup_ip, u.last_login_ip,
              u.services, u.signup_service,
              u.nexyfab_plan, u.nexyflow_plan,
              u.oauth_provider
       FROM nf_users u
       ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    ),
    db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM nf_users u ${where}`,
      ...params,
    ),
    db.queryAll<{ plan: string; count: number }>(
      `SELECT plan, COUNT(*) AS count FROM nf_users WHERE id <> 'demo-user' GROUP BY plan`,
    ),
  ]);

  // 각 유저의 제품별 역할 조회
  const userIds = users.map(u => u.id);
  const rolesMap: Record<string, { product: string; role: string }[]> = {};
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(',');
    const roles = await db.queryAll<{ user_id: string; product: string; role: string }>(
      `SELECT user_id, product, role FROM nf_user_roles WHERE user_id IN (${placeholders})`,
      ...userIds,
    );
    for (const r of roles) {
      if (!rolesMap[r.user_id]) rolesMap[r.user_id] = [];
      rolesMap[r.user_id].push({ product: r.product, role: r.role });
    }
  }

  // 각 유저의 조직 정보 조회
  const orgsMap: Record<string, { org_id: string; org_name: string; role: string }[]> = {};
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(',');
    const orgs = await db.queryAll<{ user_id: string; org_id: string; org_name: string; role: string }>(
      `SELECT m.user_id, m.org_id, o.name AS org_name, m.role
       FROM nf_org_members m
       LEFT JOIN nf_orgs o ON o.id = m.org_id
       WHERE m.user_id IN (${placeholders})`,
      ...userIds,
    );
    for (const o of orgs) {
      if (!orgsMap[o.user_id]) orgsMap[o.user_id] = [];
      orgsMap[o.user_id].push({ org_id: o.org_id, org_name: o.org_name, role: o.role });
    }
  }

  const enriched = users.map(u => ({
    ...u,
    productRoles: rolesMap[u.id] ?? [],
    orgs: orgsMap[u.id] ?? [],
  }));

  return NextResponse.json({
    users: enriched,
    total: countRow?.total ?? 0,
    page,
    limit,
    stats,
  });
}

export async function PATCH(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const body = await req.json() as {
    userId?: string;
    plan?: string;
    role?: string;
    locked?: boolean;
    name?: string;
    language?: string;
    country?: string;
    timezone?: string;
    phone?: string;
    company?: string;
    job_title?: string;
    enterpriseContract?: boolean;
    erpIntegrationContract?: boolean;
    /**
     * 플랜 만료(epoch ms). `null` 을 주면 만료를 없앤다(영구).
     * ⚠ 260802: 종전엔 `plan` 만 바꿀 수 있어 **관리자가 Pro 를 주면 영구**였다.
     */
    planExpiresAt?: number | null;
    /** 만료 후 되돌아갈 플랜. 미지정 시 `'free'`. */
    planFallback?: string | null;
  };

  if (!body.userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  const db = getDbAdapter();
  const user = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_users WHERE id = ?', body.userId,
  );
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (body.plan) {
    const validPlans = ['free', 'pro', 'team', 'enterprise'];
    if (!validPlans.includes(body.plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    await db.execute('UPDATE nf_users SET plan = ? WHERE id = ?', body.plan, body.userId);
  }

  /**
   * 플랜 기간.
   * ⚠ `planExpiresAt` 을 **명시적으로 보냈을 때만** 건드린다 — `undefined`(미전송)와
   *   `null`(만료 해제)은 다르다. 뭉치면 다른 필드만 고치려던 요청이 기간을 지운다.
   */
  if ('planExpiresAt' in body) {
    const exp = body.planExpiresAt;
    if (exp != null && (!Number.isFinite(exp) || exp <= Date.now())) {
      // 과거 시각을 만료로 넣으면 그 즉시 강등된다 — 실수인지 의도인지 구별할 수 없으므로 막는다.
      return NextResponse.json({ error: '만료 시각은 현재보다 미래여야 합니다(해제하려면 null).' }, { status: 400 });
    }
    const fb = body.planFallback ?? 'free';
    if (!['free', 'pro', 'team', 'enterprise'].includes(fb)) {
      return NextResponse.json({ error: 'Invalid planFallback' }, { status: 400 });
    }
    await db.execute(
      'UPDATE nf_users SET plan_expires_at = ?, plan_fallback = ? WHERE id = ?',
      exp ?? null, exp == null ? null : fb, body.userId,
    );
  }

  if (body.role) {
    const validRoles = ['user', 'super_admin'];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    await db.execute('UPDATE nf_users SET role = ? WHERE id = ?', body.role, body.userId);
  }

  if (typeof body.locked === 'boolean') {
    if (body.locked) {
      // 24시간 잠금
      await db.execute(
        'UPDATE nf_users SET locked_until = ?, failed_login_attempts = 999 WHERE id = ?',
        Date.now() + 24 * 3600_000, body.userId,
      );
    } else {
      await db.execute(
        'UPDATE nf_users SET locked_until = NULL, failed_login_attempts = 0 WHERE id = ?',
        body.userId,
      );
    }
  }

  if (body.name) {
    await db.execute('UPDATE nf_users SET name = ? WHERE id = ?', body.name, body.userId);
  }

  // 프로필 필드 업데이트 (화이트리스트로 SQL injection 방지)
  const SAFE_FIELDS = new Set(['language', 'country', 'timezone', 'phone', 'company', 'job_title']);
  const profileUpdates: Array<[string, unknown]> = [];
  if (body.language !== undefined) profileUpdates.push(['language', body.language]);
  if (body.country !== undefined) profileUpdates.push(['country', body.country]);
  if (body.timezone !== undefined) profileUpdates.push(['timezone', body.timezone]);
  if (body.phone !== undefined) profileUpdates.push(['phone', body.phone]);
  if (body.company !== undefined) profileUpdates.push(['company', body.company]);
  if (body.job_title !== undefined) profileUpdates.push(['job_title', body.job_title]);

  for (const [field, value] of profileUpdates) {
    if (!SAFE_FIELDS.has(field)) continue;
    await db.execute(`UPDATE nf_users SET ${field} = ? WHERE id = ?`, value || null, body.userId);
  }

  let stageReeval = false;
  if (typeof body.enterpriseContract === 'boolean') {
    await db.execute(
      'UPDATE nf_users SET enterprise_contract = ? WHERE id = ?',
      body.enterpriseContract ? 1 : 0,
      body.userId,
    );
    stageReeval = true;
  }
  if (typeof body.erpIntegrationContract === 'boolean') {
    await db.execute(
      'UPDATE nf_users SET erp_integration_contract = ? WHERE id = ?',
      body.erpIntegrationContract ? 1 : 0,
      body.userId,
    );
    stageReeval = true;
  }
  if (stageReeval) {
    await evaluateStage(body.userId, 'enterprise_contract').catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return unauthorized();

  const { userId } = await req.json() as { userId?: string };
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const db = getDbAdapter();
  const user = await db.queryOne<{ id: string; role: string }>(
    'SELECT id, role FROM nf_users WHERE id = ?', userId,
  );
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // super_admin은 삭제 불가
  if (user.role === 'super_admin') {
    return NextResponse.json({ error: 'Cannot delete super_admin' }, { status: 403 });
  }

  // 관련 데이터 정리
  await db.execute('DELETE FROM nf_refresh_tokens WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_user_roles WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_org_members WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_users WHERE id = ?', userId);

  return NextResponse.json({ ok: true });
}

/**
 * POST /api/admin/users — admin provisions a new account (public sign-up is
 * invite-only). { email, password, name?, plan? } → bcrypt + pre-verified user
 * that can log in immediately. No welcome email / JWT here.
 */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return unauthorized();

  const body = await req.json().catch(() => ({})) as { email?: string; password?: string; name?: string; plan?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: '유효한 이메일을 입력하세요.' }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
  const plan = ['free', 'pro', 'team'].includes(body.plan ?? '') ? body.plan! : 'free';

  const db = getDbAdapter();
  const existing = await db.queryOne<{ id: string }>('SELECT id FROM nf_users WHERE email = ?', email);
  if (existing) return NextResponse.json({ error: '이미 존재하는 이메일입니다.' }, { status: 409 });

  const passwordHash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();
  const now = Date.now();
  const displayName = (body.name?.trim() || email.split('@')[0]).slice(0, 100);

  try {
    await db.execute(
      `INSERT INTO nf_users (id, email, name, password_hash, plan, email_verified, project_count, created_at,
        signup_source, language, login_count, services, signup_service, ${SERVICE_NAME}_plan, updated_at,
        terms_agreed_at, privacy_agreed_at, age_confirmed)
       VALUES (?, ?, ?, ?, ?, TRUE, 0, ?,
        'admin', 'en', 0, ?, ?, ?, ?,
        ?, ?, TRUE)`,
      id, email, displayName, passwordHash, plan, now,
      JSON.stringify([SERVICE_NAME]), SERVICE_NAME, plan, now,
      now, now,
    );
  } catch (e) {
    return NextResponse.json({ error: 'DB insert failed', detail: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user: { id, email, name: displayName, plan } }, { status: 201 });
}
