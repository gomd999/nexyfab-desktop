/**
 * demo-session.ts — 데모 모드 세션 격리 + 가입 시 데이터 이관.
 *
 * 디자인 (project_nexyfab_demo_mode.md):
 *   - nf_sessions 글로벌 테이블의 session_id 가 단일 진실의 소스
 *   - 데모 데이터의 user_id 는 sentinel 'demo-user', 실 소유자 식별은 session_id
 *   - 가입/로그인 시 UPDATE ... WHERE session_id = ? AND user_id = 'demo-user'
 *     로 데이터 일괄 이관 (원자적, 단일 트랜잭션)
 *
 * 클라이언트 식별: httpOnly cookie `nf_demo_session` (XSS 차단).
 *   - 7일 TTL — 그 사이 가입 안 하면 데이터는 admin 쿼리에서 자동 배제
 *     (orphan 정리는 별도 cron 으로, 하루 한 번)
 */

import type { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDbAdapter } from './db-adapter';
import { getTrustedClientIpOrUndefined } from './client-ip';

export const DEMO_USER_ID = 'demo-user';
export const DEMO_COOKIE  = 'nf_demo_session';
const DEMO_TTL_SEC = 60 * 60 * 24 * 7;     // 7d
const MAX_AGE_MS   = DEMO_TTL_SEC * 1000;

export interface DemoSession {
  id:        string;
  isDemo:    boolean;
  createdAt: number;
  claimedAt: number | null;
  userId:    string | null;
}

/** Read demo session from cookie. Verifies row still exists & is not stale. */
export async function getDemoSession(req: NextRequest): Promise<DemoSession | null> {
  const sid = req.cookies.get(DEMO_COOKIE)?.value;
  if (!sid) return null;
  const db = getDbAdapter();
  const row = await db.queryOne<{
    id: string; user_id: string | null; is_demo: number | boolean;
    created_at: number; claimed_at: number | null;
  }>(
    `SELECT id, user_id, is_demo, created_at, claimed_at
       FROM nf_sessions WHERE id = ?`,
    sid,
  ).catch(() => null);
  if (!row) return null;
  // 만료 검사 — claim 안 된 채 7일 지난 세션은 무효 (admin 노이즈 방지)
  if (!row.claimed_at && Date.now() - Number(row.created_at) > MAX_AGE_MS) {
    return null;
  }
  return {
    id:        row.id,
    isDemo:    Boolean(row.is_demo) && row.is_demo !== 0,
    createdAt: Number(row.created_at),
    claimedAt: row.claimed_at ? Number(row.claimed_at) : null,
    userId:    row.user_id,
  };
}

/**
 * 데모 세션이 있으면 재사용, 없으면 새로 만들고 쿠키 설정.
 * 라우트 핸들러는 반환된 NextResponse 를 그대로 return 해야 쿠키가 클라이언트에 전달된다.
 */
export async function ensureDemoSession(
  req: NextRequest,
  res: NextResponse,
): Promise<DemoSession> {
  const existing = await getDemoSession(req);
  if (existing) return existing;

  const id = `dms-${randomUUID()}`;
  const ip = getTrustedClientIpOrUndefined(req.headers) ?? null;
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 500) || null;
  const now = Date.now();

  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_sessions (id, user_id, is_demo, ip, user_agent, created_at, claimed_at)
     VALUES (?, NULL, ?, ?, ?, ?, NULL)`,
    id,
    db.backend === 'postgres' ? true : 1,
    ip,
    ua,
    now,
  );

  res.cookies.set(DEMO_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
    maxAge:   DEMO_TTL_SEC,
  });

  return { id, isDemo: true, createdAt: now, claimedAt: null, userId: null };
}

export interface ClaimResult {
  sessionId:    string;
  dfmRows:      number;
  rfqRows:      number;
  funnelRows:   number;
  alreadyClaimed: boolean;
}

/**
 * 데모 데이터를 본 계정으로 이관.
 * 가입/로그인 직후 hook 에서 호출. 멱등 — 이미 claim 된 세션은 noop.
 *
 * 트랜잭션으로 묶어서: nf_dfm_check, nf_funnel_event, nf_rfqs 의
 * (session_id = sid AND user_id = 'demo-user') 행을 모두 새 user_id 로 변경하고
 * nf_sessions.user_id, is_demo, claimed_at 을 동시에 업데이트.
 */
export async function claimDemoSession(
  sessionId: string,
  realUserId: string,
): Promise<ClaimResult> {
  const db = getDbAdapter();
  const session = await db.queryOne<{ id: string; is_demo: number | boolean; user_id: string | null }>(
    'SELECT id, is_demo, user_id FROM nf_sessions WHERE id = ?',
    sessionId,
  );
  if (!session) {
    return { sessionId, dfmRows: 0, rfqRows: 0, funnelRows: 0, alreadyClaimed: false };
  }
  if (!Boolean(session.is_demo) || session.is_demo === 0) {
    return { sessionId, dfmRows: 0, rfqRows: 0, funnelRows: 0, alreadyClaimed: true };
  }

  return db.transaction(async (tx) => {
    const dfm = await tx.execute(
      `UPDATE nf_dfm_check SET user_id = ?
        WHERE session_id = ? AND (user_id IS NULL OR user_id = ?)`,
      realUserId, sessionId, DEMO_USER_ID,
    );
    const rfq = await tx.execute(
      `UPDATE nf_rfqs SET user_id = ?
        WHERE session_id = ? AND user_id = ?`,
      realUserId, sessionId, DEMO_USER_ID,
    );
    const fnl = await tx.execute(
      `UPDATE nf_funnel_event SET user_id = ?
        WHERE session_id = ? AND user_id = ?`,
      realUserId, sessionId, DEMO_USER_ID,
    );
    await tx.execute(
      `UPDATE nf_sessions
          SET user_id = ?,
              is_demo = ?,
              claimed_at = ?
        WHERE id = ?`,
      realUserId,
      tx.backend === 'postgres' ? false : 0,
      Date.now(),
      sessionId,
    );

    return {
      sessionId,
      dfmRows:    dfm.changes,
      rfqRows:    rfq.changes,
      funnelRows: fnl.changes,
      alreadyClaimed: false,
    };
  });
}

/** 가입/로그인 직후 쿠키 제거. claim 후엔 더 이상 demo 세션이 아님. */
export function clearDemoCookie(res: NextResponse): void {
  res.cookies.set(DEMO_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
    maxAge:   0,
  });
}

/**
 * 가입/로그인 라우트에서 인라인으로 호출.
 * 데모 쿠키가 있으면 claim 하고 쿠키 제거 → 응답에 Set-Cookie 가 포함됨.
 *
 * 멱등 + 실패 무해 — 이미 claim 된 세션, 만료된 쿠키, DB 에러 모두
 * 사용자 인증 흐름은 차단하지 않는다 (가입 자체는 성공시켜야 한다).
 */
export async function tryClaimDemoOnAuth(
  req: NextRequest,
  res: NextResponse,
  userId: string,
): Promise<ClaimResult | null> {
  const sid = req.cookies.get(DEMO_COOKIE)?.value;
  if (!sid || !userId) return null;
  try {
    const result = await claimDemoSession(sid, userId);
    clearDemoCookie(res);
    return result;
  } catch (err) {
    console.error('[demo-session] inline claim failed:', err);
    return null;
  }
}
