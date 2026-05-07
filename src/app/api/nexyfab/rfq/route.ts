import { NextRequest, NextResponse } from 'next/server';
import { onRfqCreated } from '@/lib/nexyflow-triggers';
import { z } from 'zod';
import { sendEmail, rfqConfirmationHtml, rfqNotificationHtml, partnerRfqNotificationHtml } from '@/lib/nexyfab-email';
import { createNotification } from '@/app/lib/notify';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkPlan } from '@/lib/plan-guard';
import { getDbAdapter } from '@/lib/db-adapter';
import { logAudit } from '@/lib/audit';
import { sanitizeText } from '@/lib/sanitize';
import { checkOrigin } from '@/lib/csrf';
import { type RFQEntry, rowToRfq } from './rfq-types';
import { recordUsage } from '@/lib/billing-engine';
import { logFunnelEvent } from '@/lib/funnel-logger';
import { getDemoSession, DEMO_USER_ID } from '@/lib/demo-session';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { normPartnerEmail } from '@/lib/partner-factory-access';

// 데모 RFQ 일일 한도 — IP 별. 본 계정의 50/일 과 별개.
const DEMO_DAILY_LIMIT_PER_IP = 5;

const rfqSchema = z.object({
  shapeId: z.string().min(1).max(100).optional(),
  shapeName: z.string().max(200).optional(),
  materialId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(100_000),
  deadline: z.string().max(20).optional(),
  preferredFactoryId: z.string().max(100).optional(),
  volume_cm3: z.number().min(0).optional(),
  surface_area_cm2: z.number().min(0).optional(),
  bbox: z.object({ w: z.number(), h: z.number(), d: z.number() }).optional(),
  note: z.string().max(2000).optional(),
  shareToken: z.string().max(200).optional(),
  dfmScore: z.number().int().min(0).max(100).optional(),
  dfmProcess: z.string().max(50).optional(),
  // Phase B-2: 사용자가 DFM 검증 결과 페이지에서 "매칭 의뢰" 로 진입한 경우
  // 해당 검증 ID 를 같이 보낸다. AI 매칭 엔진이 PASS/WARN/FAIL 컨텍스트를
  // 즉시 활용할 수 있게 nf_rfqs.dfm_check_id FK 로 영속화.
  dfmCheckId: z.string().max(100).optional(),
});

// ─── POST /api/nexyfab/rfq ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 데모 모드 분기 — auth 가 없으면 데모 세션 쿠키를 확인.
  // 데모 RFQ 는 plan-guard / monthly-limit / email-verified 우회 (체험이므로),
  // 단 IP 별 일일 한도와 partner-side 비활성을 통해 스팸/오염을 막는다.
  const preAuth = await getAuthUser(req);
  const demoSession = preAuth ? null : await getDemoSession(req);
  const isDemo = !preAuth && !!demoSession;

  let userId: string;
  let userEmail: string | undefined;

  if (isDemo) {
    userId    = DEMO_USER_ID;
    userEmail = undefined;
  } else {
    const planCheck = await checkPlan(req, 'free');
    if (!planCheck.ok) return planCheck.response;

    const { checkMonthlyLimit } = await import('@/lib/plan-guard');
    const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'rfq');
    if (!usageCheck.ok) {
      return NextResponse.json(
        { error: `Free plan limit reached (${usageCheck.limit}/month). Upgrade to Pro for unlimited RFQ.` },
        { status: 429 },
      );
    }

    if (preAuth && !preAuth.emailVerified) {
      return NextResponse.json({ error: '이메일 인증 후 견적 요청이 가능합니다.', code: 'EMAIL_UNVERIFIED' }, { status: 403 });
    }
    userId    = planCheck.userId;
    userEmail = preAuth?.email ?? '';
  }

  const rawBody = await req.json() as Record<string, unknown>;

  const parsed = rfqSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const body = {
    ...parsed.data,
    shapeName: sanitizeText(parsed.data.shapeName ?? ''),
    note: parsed.data.note != null ? sanitizeText(parsed.data.note) : undefined,
    dfmResults: (rawBody.dfmResults as RFQEntry['dfmResults']) ?? undefined,
    costEstimates: (rawBody.costEstimates as RFQEntry['costEstimates']) ?? undefined,
  };

  const rfqId = `rfq-${crypto.randomUUID()}`;
  const now = Date.now();
  const ip = getTrustedClientIpOrUndefined(req.headers);

  const db = getDbAdapter();

  const dayStart = Date.now() - 86_400_000;
  if (isDemo) {
    // 데모: IP 별 일일 한도. 본 계정과 별개 카운트.
    if (ip) {
      const ipCountRow = await db.queryOne<{ c: number }>(
        `SELECT COUNT(*) as c FROM nf_rfqs r
           JOIN nf_sessions s ON r.session_id = s.id
          WHERE s.ip = ? AND r.created_at > ?`,
        ip, dayStart,
      );
      if ((ipCountRow?.c ?? 0) >= DEMO_DAILY_LIMIT_PER_IP) {
        return NextResponse.json(
          { error: `Demo limit reached (${DEMO_DAILY_LIMIT_PER_IP}/day). Sign up for unlimited.`, code: 'DEMO_LIMIT' },
          { status: 429 },
        );
      }
    }
  } else {
    const countRow = await db.queryOne<{ c: number }>(
      'SELECT COUNT(*) as c FROM nf_rfqs WHERE user_id = ? AND created_at > ?',
      userId, dayStart,
    );
    const todayCount = countRow?.c ?? 0;
    if (todayCount >= 50) {
      return NextResponse.json({ error: 'Daily RFQ limit exceeded (50/day)' }, { status: 429 });
    }
  }

  // dfmCheckId 는 본인(or 같은 데모 세션) 소유일 때만 채택. 위조 방지.
  let resolvedDfmCheckId: string | null = null;
  let dfmContextSnapshot: { issues: number; warnings: number } | null = null;
  if (parsed.data.dfmCheckId) {
    const ownRow = isDemo
      ? await db.queryOne<{ id: string; issues: number; warnings: number }>(
          'SELECT id, issues, warnings FROM nf_dfm_check WHERE id = ? AND session_id = ?',
          parsed.data.dfmCheckId, demoSession!.id,
        ).catch(() => null)
      : await db.queryOne<{ id: string; issues: number; warnings: number }>(
          'SELECT id, issues, warnings FROM nf_dfm_check WHERE id = ? AND user_id = ?',
          parsed.data.dfmCheckId, userId,
        ).catch(() => null);
    if (ownRow) {
      resolvedDfmCheckId = ownRow.id;
      dfmContextSnapshot = {
        issues:   Number(ownRow.issues)   || 0,
        warnings: Number(ownRow.warnings) || 0,
      };
    }
  }

  await db.execute(
    `INSERT INTO nf_rfqs
       (id, user_id, user_email, shape_id, shape_name, material_id, quantity,
        volume_cm3, surface_area_cm2, bbox, dfm_results, cost_estimates, note,
        deadline, preferred_factory_id, shape_share_token, dfm_score, dfm_process,
        dfm_check_id, status, created_at, updated_at, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    rfqId,
    userId,
    userEmail ?? null,
    body.shapeId ?? null,
    body.shapeName ?? null,
    body.materialId,
    body.quantity,
    body.volume_cm3 ?? 0,
    body.surface_area_cm2 ?? 0,
    JSON.stringify(body.bbox ?? { w: 0, h: 0, d: 0 }),
    body.dfmResults ? JSON.stringify(body.dfmResults) : null,
    body.costEstimates ? JSON.stringify(body.costEstimates) : null,
    body.note ?? null,
    body.deadline ?? null,
    body.preferredFactoryId ?? null,
    body.shareToken ?? null,
    body.dfmScore ?? null,
    body.dfmProcess ?? null,
    resolvedDfmCheckId,
    now,
    now,
    isDemo ? demoSession!.id : null,
  );

  // Funnel: rfq_submitted. dfm_context_used 가 true 인 경우만이 "DFM → 매칭"
  // 풀 펀넬을 통과한 사용자 — 이 코호트의 전환율이 광고 소재의 진짜 ROI 지표.
  // 데모 세션은 sessionId 와 함께 기록 — 가입 시 본 user_id 로 일괄 이관됨.
  logFunnelEvent(userId, {
    eventType:   'rfq_submitted',
    contextType: 'rfq',
    contextId:   rfqId,
    metadata: {
      dfmContextUsed: !!resolvedDfmCheckId,
      dfmCheckId:     resolvedDfmCheckId,
      issues:         dfmContextSnapshot?.issues   ?? null,
      warnings:       dfmContextSnapshot?.warnings ?? null,
      materialId:     body.materialId,
      quantity:       body.quantity,
      isDemo,
    },
    sessionId: isDemo ? demoSession!.id : null,
  }).catch(() => {});

  // 데모 RFQ 는 결제/알림/협력사 통보 없이 격리. 가입 후 데이터 이관 시점에서야
  // 실제 워크플로우(빌링/NexyFlow 트리거)에 합류시킬지 별도 결정.
  if (!isDemo) {
    recordUsage({
      userId,
      product: 'nexyfab',
      metric: 'rfq_submission',
      metadata: JSON.stringify({ rfqId, materialId: body.materialId }),
    }).catch(() => {});

    onRfqCreated({
      userId,
      rfqId,
      partName: body.shapeName,
      quantity: body.quantity,
      material: body.materialId,
      note: body.note,
    }).catch(() => {});
  }

  const nowIso = new Date(now).toISOString();

  // 데모 RFQ 는 협력사/관리자/사용자 이메일 모두 차단 — 스팸/오염 방지.
  if (isDemo) {
    return NextResponse.json(
      {
        rfqId,
        status: 'pending',
        createdAt: nowIso,
        estimatedResponseTime: '24-48h',
        demo: true,
      },
      { status: 201 },
    );
  }

  // ─── Email notifications (fire-and-forget) ───────────────────────────────
  const adminEmail = process.env.NEXYFAB_ADMIN_EMAIL || 'admin@nexyfab.com';
  const rfqEmailData = {
    rfqId,
    shapeName: body.shapeName,
    materialId: body.materialId,
    quantity: body.quantity,
    volume_cm3: body.volume_cm3 ?? 0,
    dfmScore: body.dfmResults?.[0]?.score,
    estimatedCost: body.costEstimates?.[0]?.unitCost,
  };

  const userEmailHeader = userEmail ?? '';
  const userNameHeader = req.headers.get('x-user-name') ?? '';

  if (userEmailHeader) {
    sendEmail(
      userEmailHeader,
      '[NexyFab] 견적 요청이 접수되었습니다',
      rfqConfirmationHtml(
        { ...rfqEmailData, userEmail: userEmailHeader, userName: userNameHeader || undefined },
        'ko'
      ),
    ).catch(err => console.error('[rfq] confirmation email failed:', err));
  }

  sendEmail(
    adminEmail,
    `[NexyFab] 새 RFQ #${rfqId.slice(0, 8).toUpperCase()} — ${body.shapeName}`,
    rfqNotificationHtml({ ...rfqEmailData, userEmail: userEmailHeader || undefined }),
  ).catch(err => console.error('[rfq] admin notification email failed:', err));
  // ────────────────────────────────────────────────────────────────────────────

  // ─── 파트너 신규 RFQ 이메일/인앱 알림 (fire-and-forget) ────────────────────
  {
    const processKeyword = body.dfmProcess ?? '';
    const processPattern = processKeyword ? `%"${processKeyword}"%` : '%';
    db.queryAll<{ contact_email: string | null; partner_email: string | null; name: string }>(
      `SELECT contact_email, partner_email, name FROM nf_factories WHERE status = 'active' AND processes LIKE ?`,
      processPattern,
    ).then(factories => {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://nexyfab.com';
      factories.forEach(f => {
        const rawEmail = f.contact_email || f.partner_email;
        if (!rawEmail) return;
        const email = rawEmail.trim();
        const notifUserId = `partner:${normPartnerEmail(email)}`;
        sendEmail(
          email,
          `[NexyFab] 새 견적 요청 — ${body.shapeName || rfqId.slice(0, 8).toUpperCase()}`,
          partnerRfqNotificationHtml({
            rfqId,
            shapeName: body.shapeName,
            materialId: body.materialId,
            quantity: body.quantity,
            dfmProcess: body.dfmProcess,
            note: body.note,
            partnerDashUrl: `${baseUrl}/partner/quotes`,
          }),
        ).catch(() => {});
        createNotification(
          notifUserId,
          'new_rfq',
          '새 견적 요청',
          `"${body.shapeName || rfqId.slice(0, 8)}" — 수량 ${body.quantity}개 RFQ가 접수됐습니다.`,
          { quoteId: rfqId },
        );
      });
    }).catch(() => {});
  }
  // ────────────────────────────────────────────────────────────────────────────

  logAudit({ userId, action: 'rfq.create', resourceId: rfqId, ip });

  return NextResponse.json(
    {
      rfqId,
      status: 'pending',
      createdAt: nowIso,
      estimatedResponseTime: '24-48h',
    },
    { status: 201 }
  );
}

// ─── GET /api/nexyfab/rfq ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  const demoSession = authUser ? null : await getDemoSession(req);
  if (!authUser && !demoSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;
  const VALID_STATUSES = ['pending', 'assigned', 'quoted', 'accepted', 'rejected'];
  const statusFilter = req.nextUrl.searchParams.get('status') ?? '';
  const useStatusFilter = VALID_STATUSES.includes(statusFilter);

  const db = getDbAdapter();

  // 데모: session_id 로 자기 RFQ 만 조회. 본 계정: user_id 로.
  const ownerClause = authUser ? 'r.user_id = ?' : 'r.session_id = ?';
  const ownerArg    = authUser ? authUser.userId : demoSession!.id;

  const statusClause = useStatusFilter ? ' AND r.status = ?' : '';
  const countArgs: unknown[] = useStatusFilter ? [ownerArg, statusFilter] : [ownerArg];
  const totalRow = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_rfqs r WHERE ${ownerClause}${statusClause}`,
    ...countArgs,
  );
  const total = totalRow?.c ?? 0;

  const rowArgs: unknown[] = useStatusFilter ? [ownerArg, statusFilter, limit, offset] : [ownerArg, limit, offset];
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT r.*, f.name AS assigned_factory_name
     FROM nf_rfqs r
     LEFT JOIN nf_factories f ON r.assigned_factory_id = f.id
     WHERE ${ownerClause}${statusClause}
     ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    ...rowArgs,
  );

  return NextResponse.json({
    rfqs: rows.map(rowToRfq),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
}
