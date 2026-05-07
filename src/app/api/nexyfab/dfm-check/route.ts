/**
 * POST /api/nexyfab/dfm-check
 *
 * Body: { params: Record<string, number>, fileId?: string }
 *   - 하위 호환: 평면 Record<string, number> 도 그대로 받는다 (랜딩 데모용).
 *
 * Auth: optional.
 *   - 로그인 시: nf_dfm_check 에 본 계정 user_id 로 영속화.
 *   - 비로그인 시: ensureDemoSession 으로 httpOnly 쿠키 기반 demo 세션을
 *     발급/재사용하고 user_id='demo-user' + session_id 로 저장 →
 *     가입 직후 claimDemoSession 훅이 자동으로 real user_id 로 이관.
 *
 * Design (2026-04-23):
 *   이전에는 비로그인 DFM 결과를 아예 저장하지 않아 "DFM→가입→결과 유실"
 *   누수가 있었다. nf_sessions FK 격리로 admin KPI 오염 없이 영속화 가능.
 *
 * 응답: { id?, issues, warnings, items } — 영속화된 경우 id가 포함됨.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { runDfmChecks, type DfmCheckResult } from '@/lib/dfm-rules';
import { logCadAccess } from '@/lib/shadow-logger';
import { ensureDemoSession, DEMO_USER_ID } from '@/lib/demo-session';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';

export interface DfmCheckResponse extends DfmCheckResult {
  /** 영속화 ID — DB 저장 실패 시 undefined. */
  id?: string;
}

interface RequestBody {
  params?: Record<string, number>;
  fileId?: string;
  /** 하위 호환: 평면 객체로도 받음. */
  [key: string]: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse<DfmCheckResponse>> {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ issues: 0, warnings: 0, items: [] });
  }

  // 새 스키마 우선, 없으면 평면 객체 전체를 params로 간주.
  const params = (body.params && typeof body.params === 'object')
    ? body.params
    : Object.fromEntries(
        Object.entries(body)
          .filter(([k, v]) => k !== 'fileId' && typeof v === 'number'),
      ) as Record<string, number>;

  const fileId = typeof body.fileId === 'string' && body.fileId.trim()
    ? body.fileId.trim()
    : undefined;

  const result = runDfmChecks(params);
  const auth = await getAuthUser(req).catch(() => null);

  const id  = `dfm-${randomUUID()}`;
  const now = Date.now();
  const db  = getDbAdapter();

  // 응답 객체를 미리 준비 — demo 세션 발급 시 Set-Cookie 가 여기에 붙는다.
  const res = NextResponse.json<DfmCheckResponse>({ id, ...result });

  // 로그인 유저는 session_id NULL (demo 아님).
  // 비로그인은 demo 세션 id 를 세팅하고 sentinel user_id 로 삽입.
  let userId: string;
  let sessionId: string | null;
  if (auth) {
    userId = auth.userId;
    sessionId = null;
  } else {
    const demo = await ensureDemoSession(req, res).catch(() => null);
    if (!demo) {
      // 세션 발급 실패 — 결과만 주고 영속화 포기 (기존 익명 동작과 동일)
      return NextResponse.json(result);
    }
    userId = DEMO_USER_ID;
    sessionId = demo.id;
  }

  try {
    await db.execute(
      `INSERT INTO nf_dfm_check
         (id, user_id, session_id, file_id, input_params, issues, warnings, items, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, userId, sessionId, fileId ?? null,
      JSON.stringify(params),
      result.issues, result.warnings,
      JSON.stringify(result.items),
      now,
    );
  } catch (err) {
    // 저장 실패해도 사용자 결과는 막지 않는다 (Shadow logging 정책).
    // session_id 컬럼 없는 레거시 DB 를 위한 폴백:
    console.error('[dfm-check] persist failed, retrying without session_id:', err);
    try {
      await db.execute(
        `INSERT INTO nf_dfm_check
           (id, user_id, file_id, input_params, issues, warnings, items, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, userId, fileId ?? null,
        JSON.stringify(params),
        result.issues, result.warnings,
        JSON.stringify(result.items),
        now,
      );
    } catch (err2) {
      console.error('[dfm-check] fallback persist also failed:', err2);
      // 응답 자체는 이미 NextResponse 에 담겨 있음 — id 유지해도 DB 미반영
    }
  }

  // CAD 파일을 함께 검증한 경우 접근 로그 (로그인 사용자만 — 익명 view 로그는 노이즈).
  if (fileId && auth) {
    const ip = getTrustedClientIpOrUndefined(req.headers);
    const userAgent = req.headers.get('user-agent') ?? undefined;
    await logCadAccess(fileId, {
      userId:     auth.userId,
      accessType: 'view',
      ip,
      userAgent,
    });
  }

  return res;
}
