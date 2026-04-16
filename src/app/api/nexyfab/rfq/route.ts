import { NextRequest, NextResponse } from 'next/server';
import { onRfqCreated } from '@/lib/nexyflow-triggers';
import { z } from 'zod';
import { sendEmail, rfqConfirmationHtml, rfqNotificationHtml } from '@/lib/nexyfab-email';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkPlan } from '@/lib/plan-guard';
import { getDbAdapter } from '@/lib/db-adapter';
import { logAudit } from '@/lib/audit';
import { sanitizeText } from '@/lib/sanitize';
import { checkOrigin } from '@/lib/csrf';
import { type RFQEntry, rowToRfq } from './rfq-types';
import { recordUsage } from '@/lib/billing-engine';

const rfqSchema = z.object({
  shapeId: z.string().min(1).max(100),
  shapeName: z.string().max(200).optional(),
  materialId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(100_000),
  volume_cm3: z.number().min(0).optional(),
  surface_area_cm2: z.number().min(0).optional(),
  bbox: z.object({ w: z.number(), h: z.number(), d: z.number() }).optional(),
  note: z.string().max(2000).optional(),
  shareToken: z.string().max(200).optional(),   // 3D 모델 share 토큰
  dfmScore: z.number().int().min(0).max(100).optional(),
  dfmProcess: z.string().max(50).optional(),
});

// ─── POST /api/nexyfab/rfq ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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

  const fullUser = await getAuthUser(req);
  const authUser = { userId: planCheck.userId, email: fullUser?.email ?? '', plan: planCheck.plan };

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
  const userId = authUser.userId;
  const userEmail = authUser.email || req.headers.get('x-user-email') || undefined;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0] ??
    req.headers.get('x-real-ip') ??
    undefined;

  const db = getDbAdapter();

  const dayStart = Date.now() - 86_400_000;
  const countRow = await db.queryOne<{ c: number }>(
    'SELECT COUNT(*) as c FROM nf_rfqs WHERE user_id = ? AND created_at > ?',
    userId, dayStart,
  );
  const todayCount = countRow?.c ?? 0;
  if (todayCount >= 50) {
    return NextResponse.json({ error: 'Daily RFQ limit exceeded (50/day)' }, { status: 429 });
  }
  await db.execute(
    `INSERT INTO nf_rfqs
       (id, user_id, user_email, shape_id, shape_name, material_id, quantity,
        volume_cm3, surface_area_cm2, bbox, dfm_results, cost_estimates, note,
        shape_share_token, dfm_score, dfm_process,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    rfqId,
    userId,
    userEmail ?? null,
    body.shapeId,
    body.shapeName,
    body.materialId,
    body.quantity,
    body.volume_cm3 ?? 0,
    body.surface_area_cm2 ?? 0,
    JSON.stringify(body.bbox ?? { w: 0, h: 0, d: 0 }),
    body.dfmResults ? JSON.stringify(body.dfmResults) : null,
    body.costEstimates ? JSON.stringify(body.costEstimates) : null,
    body.note ?? null,
    body.shareToken ?? null,
    body.dfmScore ?? null,
    body.dfmProcess ?? null,
    now,
    now,
  );

  // Usage billing: record RFQ submission (fire-and-forget)
  recordUsage({
    userId,
    product: 'nexyfab',
    metric: 'rfq_submission',
    metadata: JSON.stringify({ rfqId, materialId: body.materialId }),
  }).catch(() => {});

  // NexyFlow 연동: 업무 자동 생성 (fire-and-forget)
  onRfqCreated({
    userId,
    rfqId,
    partName: body.shapeName,
    quantity: body.quantity,
    material: body.materialId,
    note: body.note,
  }).catch(() => {});

  const nowIso = new Date(now).toISOString();

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

  const userEmailHeader = req.headers.get('x-user-email') ?? userEmail ?? '';
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
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;

  const userId = authUser.userId;
  const db = getDbAdapter();

  const totalRow = await db.queryOne<{ c: number }>(
    'SELECT COUNT(*) as c FROM nf_rfqs WHERE user_id = ?',
    userId,
  );
  const total = totalRow?.c ?? 0;

  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT r.*, f.name AS assigned_factory_name
     FROM nf_rfqs r
     LEFT JOIN nf_factories f ON r.assigned_factory_id = f.id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    userId, limit, offset,
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
