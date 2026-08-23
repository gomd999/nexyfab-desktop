/**
 * 코호트 프로비저닝 — **명단을 받아 Pro 로 만들고 기간을 맞춘다** (260801).
 *
 * 옆의 `/api/admin/cohort` 는 「기간 조정 + 비밀번호 재설정」만 한다. 없는 계정을 만들지도,
 * 플랜을 바꾸지도 못한다. 실제 운영 요청(「이 명단을 PRO 로 넣고 기존 회원은 기간만 조정」)은
 * 그 둘이 다 필요해서 여기에 둔다.
 *
 * ## ⚠ 비밀번호는 기존 계정에서 **절대** 건드리지 않는다
 * 운영 요청의 제약은 「PW 가 1234 가 아닌 경우 변경하지 말 것」이었다. 저장된 것은 해시라
 * 「1234 인가」는 비교로만 알 수 있는데 —
 *   · 1234 **이면** 1234 로 덮는 것은 아무 변화가 없다(무의미한 쓰기)
 *   · 1234 **가 아니면** 덮는 것이 금지돼 있다
 * 두 경우 모두 답이 「쓰지 않는다」다. 그래서 **기존 계정의 해시는 읽기만 한다.**
 * 대신 명단에 적힌 비밀번호가 실제와 맞는지 `listedPasswordMatches` 로 **알려만 준다** —
 * 명단이 현실과 다르다는 사실 자체가 운영자에게 필요한 정보다.
 *
 * ## ⚠ `subscription_ends_at` 은 건드리지 않는다
 * 그 컬럼은 **로그인 자체를 막는다**(만료 3일 후 · `auth/login`). 「Pro 기간」과는 다른 것이다.
 * Pro 자격을 지배하는 것은 `plan_expires_at` + `plan_fallback`(`auth-middleware` →
 * `resolveEffectivePlan`)이고, 여기서 쓰는 것도 그쪽뿐이다. 기간이 끝나면 **free 로 내려갈 뿐
 * 계정이 잠기지 않는다.**
 *
 * Body: { members: [{ email, password?, expiresAt }], plan?: 'pro', dryRun?: boolean }
 *   expiresAt : ISO 문자열. **미래여야 한다** — 과거를 넣으면 즉시 강등이라 실수와 구별할 수 없다.
 *   password  : **신규 생성 시에만** 쓰인다. 기존 계정에는 적용되지 않는다.
 *   dryRun    : 아무것도 쓰지 않고 무엇이 바뀔지만 돌려준다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_PLANS = new Set(['free', 'pro', 'team', 'enterprise']);

interface MemberIn { email?: string; password?: string; expiresAt?: string }

export interface ProvisionRow {
  email: string;
  /** created=신규 생성 · updated=기존 계정 조정 · unchanged=바꿀 것 없음 · error */
  action: 'created' | 'updated' | 'unchanged' | 'error';
  planBefore: string | null;
  planAfter: string | null;
  expiresBefore: number | null;
  expiresAfter: number | null;
  /** 기존 계정에서는 항상 'untouched'. 신규에서만 'set'. */
  password: 'set' | 'untouched';
  /**
   * 명단에 적힌 비밀번호가 실제 저장된 것과 맞는가.
   * `true`=맞음 · `false`=**다름(명단이 틀렸다)** · `null`=대조 불가(비번 미제출·OAuth 전용 계정).
   * ⚠ `null` 을 「맞음」으로 읽지 말 것 — 확인하지 못했다는 뜻이다.
   */
  listedPasswordMatches: boolean | null;
  note?: string;
}

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: { members?: MemberIn[]; plan?: string; dryRun?: boolean } | null;
  try { body = await readBoundedJson(req, 2 * 1024 * 1024); }
  catch (error) {
    if (boundedJsonError(error)?.status === 413) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    body = null;
  }
  if (!Array.isArray(body?.members) || !body.members.length) {
    return NextResponse.json({ error: 'invalid_request', hint: 'members[] 가 필요합니다' }, { status: 400 });
  }
  const plan = body.plan ?? 'pro';
  if (!VALID_PLANS.has(plan)) return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });
  const dryRun = body.dryRun === true;

  const db = getDbAdapter();
  const now = Date.now();
  const rows: ProvisionRow[] = [];

  for (const m of body.members) {
    const email = String(m?.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      rows.push({ email: String(m?.email ?? ''), action: 'error', planBefore: null, planAfter: null, expiresBefore: null, expiresAfter: null, password: 'untouched', listedPasswordMatches: null, note: '이메일 형식 아님' });
      continue;
    }
    const expMs = m?.expiresAt ? Date.parse(m.expiresAt) : NaN;
    if (!Number.isFinite(expMs)) {
      rows.push({ email, action: 'error', planBefore: null, planAfter: null, expiresBefore: null, expiresAfter: null, password: 'untouched', listedPasswordMatches: null, note: 'expiresAt 을 읽을 수 없음' });
      continue;
    }
    if (expMs <= now) {
      // 과거 만료는 부여하자마자 강등이다 — 오타인지 의도인지 구별할 수 없으므로 거부한다.
      rows.push({ email, action: 'error', planBefore: null, planAfter: null, expiresBefore: null, expiresAfter: expMs, password: 'untouched', listedPasswordMatches: null, note: '만료 시각이 과거입니다' });
      continue;
    }

    try {
      const existing = await db.queryOne<{ id: string; plan: string | null; password_hash: string | null; plan_expires_at: number | null }>(
        'SELECT id, plan, password_hash, plan_expires_at FROM nf_users WHERE email = ?', email,
      );

      if (!existing) {
        if (!m?.password) {
          rows.push({ email, action: 'error', planBefore: null, planAfter: null, expiresBefore: null, expiresAfter: expMs, password: 'untouched', listedPasswordMatches: null, note: '신규 계정인데 비밀번호가 없습니다' });
          continue;
        }
        if (!dryRun) {
          const id = crypto.randomUUID();
          const hash = await bcrypt.hash(m.password, 12);
          await db.execute(
            `INSERT INTO nf_users (id, email, name, password_hash, plan, plan_expires_at, plan_fallback,
               email_verified, project_count, created_at, signup_source, services, signup_service,
               nexyfab_plan, nexyflow_plan, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'free', TRUE, 0, ?, 'admin_cohort', '["nexyfab"]', 'nexyfab', ?, 'free', ?)`,
            id, email, email.split('@')[0], hash, plan, expMs, now, plan, now,
          );
        }
        rows.push({ email, action: 'created', planBefore: null, planAfter: plan, expiresBefore: null, expiresAfter: expMs, password: 'set', listedPasswordMatches: true });
        continue;
      }

      /**
       * 기존 계정 — 해시는 **읽기만** 한다. 명단의 비밀번호가 실제와 맞는지 알려 주되
       * 어느 쪽이든 쓰지 않는다(모듈 상단 주석 참조).
       */
      let matches: boolean | null = null;
      if (m?.password && existing.password_hash) {
        matches = await bcrypt.compare(m.password, existing.password_hash).catch(() => null);
      }

      const planBefore = existing.plan ?? null;
      const expBefore = existing.plan_expires_at == null ? null : Number(existing.plan_expires_at);
      const noChange = planBefore === plan && expBefore === expMs;
      if (!dryRun && !noChange) {
        await db.execute(
          'UPDATE nf_users SET plan = ?, plan_expires_at = ?, plan_fallback = ?, nexyfab_plan = ?, updated_at = ? WHERE id = ?',
          plan, expMs, 'free', plan, now, existing.id,
        );
      }
      rows.push({
        email, action: noChange ? 'unchanged' : 'updated',
        planBefore, planAfter: plan, expiresBefore: expBefore, expiresAfter: expMs,
        password: 'untouched', listedPasswordMatches: matches,
        ...(matches === false ? { note: '명단의 비밀번호가 실제와 다릅니다 — 변경하지 않았습니다' } : {}),
        ...(matches === null && m?.password ? { note: '비밀번호 대조 불가(저장된 해시 없음 — OAuth 전용일 수 있음)' } : {}),
      });
    } catch (e) {
      rows.push({ email, action: 'error', planBefore: null, planAfter: null, expiresBefore: null, expiresAfter: expMs, password: 'untouched', listedPasswordMatches: null, note: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  /** ⚠ 성공 수만 세지 않는다 — 실패와 「대조 못 함」을 따로 낸다. */
  const summary = {
    created: rows.filter(r => r.action === 'created').length,
    updated: rows.filter(r => r.action === 'updated').length,
    unchanged: rows.filter(r => r.action === 'unchanged').length,
    errors: rows.filter(r => r.action === 'error').length,
    passwordMismatch: rows.filter(r => r.listedPasswordMatches === false).length,
    passwordUnverified: rows.filter(r => r.listedPasswordMatches === null && r.action !== 'error').length,
  };
  return NextResponse.json({ ok: summary.errors === 0, dryRun, plan, summary, rows });
}
