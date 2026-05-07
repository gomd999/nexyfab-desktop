/**
 * /api/nexyfab/orders/[id]/defects  (Phase 7-5d)
 *
 *   GET  — 해당 주문의 불량·RMA 목록 (구매자 본인 또는 공급사 파트너만)
 *   POST — 구매자가 불량 제기. 배송 완료 후 30일 이내 + 주문당 미해결 이슈 최대 3건.
 *
 * Design note:
 *   리뷰와 달리 defect 는 "사건" 차원이므로 리뷰 작성 여부와 무관하게 제기 가능.
 *   단일 신용점수로 collapse 금지 — 별도 metric 이벤트로 append-only 기록.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getPartnerAuth } from '@/lib/partner-auth';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeText } from '@/app/lib/sanitize';
import { recordMetric } from '@/lib/partner-metrics';
import {
  ensureDefectsTable, rowToDefect, VALID_KINDS, VALID_SEVERITIES,
  type DefectRow, type DefectKind, type DefectSeverity,
} from '@/lib/partner-defects';

export const dynamic = 'force-dynamic';

const OPEN_MAX_PER_ORDER = 3;
const REPORT_WINDOW_DAYS = 30;

interface OrderRow {
  id: string;
  user_id: string;
  partner_email: string | null;
  status: string;
  estimated_delivery_at: number;
  manufacturer_id: string | null;
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;
  const db = getDbAdapter();
  await ensureDefectsTable(db);

  const order = await db.queryOne<OrderRow>(
    'SELECT id, user_id, partner_email, status, estimated_delivery_at, manufacturer_id FROM nf_orders WHERE id = ?',
    orderId,
  );
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  // 접근 권한: 구매자 본인 또는 공급사 파트너
  const authUser = await getAuthUser(req);
  const partner = await getPartnerAuth(req);

  const isBuyer = authUser && order.user_id === authUser.userId;
  const isPartner = partner && order.partner_email && partner.email === order.partner_email;
  const isOps = authUser?.roles?.some(r => r.role === 'super_admin' || r.role === 'org_admin');

  if (!isBuyer && !isPartner && !isOps) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await db.queryAll<DefectRow>(
    'SELECT * FROM nf_defects WHERE order_id = ? ORDER BY created_at DESC',
    orderId,
  ).catch((): DefectRow[] => []);

  return NextResponse.json({ defects: rows.map(rowToDefect) });
}

// ── POST ────────────────────────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 스팸 방지 — IP + user 기준
  if (!rateLimit(`defect-post:${authUser.userId}`, 5, 60 * 60_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
  }

  const { id: orderId } = await params;
  const db = getDbAdapter();
  await ensureDefectsTable(db);

  const order = await db.queryOne<OrderRow>(
    'SELECT id, user_id, partner_email, status, estimated_delivery_at, manufacturer_id FROM nf_orders WHERE id = ?',
    orderId,
  );
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.user_id !== authUser.userId) {
    return NextResponse.json({ error: '본인 주문만 불량 제기가 가능합니다.' }, { status: 403 });
  }
  if (order.status !== 'delivered') {
    return NextResponse.json({ error: '배송 완료된 주문만 불량 제기가 가능합니다.' }, { status: 400 });
  }

  // 30일 제한 — delivered 전이 시점이 없으므로 estimated_delivery_at 기준
  const daysSinceDelivery = (Date.now() - order.estimated_delivery_at) / 86_400_000;
  if (daysSinceDelivery > REPORT_WINDOW_DAYS) {
    return NextResponse.json(
      { error: `배송 후 ${REPORT_WINDOW_DAYS}일 이내에만 불량 제기가 가능합니다.` },
      { status: 400 },
    );
  }

  // 미해결 이슈 한도
  const openCountRow = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_defects
       WHERE order_id = ? AND status NOT IN ('resolved', 'rejected')`,
    orderId,
  );
  if ((openCountRow?.c ?? 0) >= OPEN_MAX_PER_ORDER) {
    return NextResponse.json(
      { error: `이 주문에 미해결 불량이 이미 ${OPEN_MAX_PER_ORDER}건 등록되어 있습니다.` },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({})) as {
    kind?: unknown;
    severity?: unknown;
    description?: unknown;
    photoKeys?: unknown;
  };

  const kind = typeof body.kind === 'string' && (VALID_KINDS as readonly string[]).includes(body.kind)
    ? body.kind as DefectKind : null;
  const severity = typeof body.severity === 'string' && (VALID_SEVERITIES as readonly string[]).includes(body.severity)
    ? body.severity as DefectSeverity : null;
  const descriptionRaw = typeof body.description === 'string' ? body.description.trim() : '';

  if (!kind)     return NextResponse.json({ error: 'kind 가 유효하지 않습니다.', field: 'kind' }, { status: 400 });
  if (!severity) return NextResponse.json({ error: 'severity 가 유효하지 않습니다.', field: 'severity' }, { status: 400 });
  if (descriptionRaw.length < 10) {
    return NextResponse.json({ error: '설명은 최소 10자 이상이어야 합니다.', field: 'description' }, { status: 400 });
  }
  if (descriptionRaw.length > 4000) {
    return NextResponse.json({ error: '설명이 너무 깁니다 (최대 4000자).', field: 'description' }, { status: 400 });
  }

  const description = sanitizeText(descriptionRaw, 4000);

  // photoKeys 는 R2 업로드된 key 만 허용 (화이트리스트 prefix)
  let photoKeys: string[] = [];
  if (Array.isArray(body.photoKeys)) {
    photoKeys = body.photoKeys
      .filter((k): k is string => typeof k === 'string' && k.startsWith('defects/') && k.length < 256)
      .slice(0, 8);
  }

  const id = `DEF-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_defects
      (id, order_id, reporter_email, partner_email,
       status, severity, kind, description, photo_keys,
       rma_number, rma_instructions, partner_response, resolution_note, resolved_at,
       created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, orderId, authUser.email, order.partner_email,
    'reported', severity, kind, description, photoKeys.length > 0 ? JSON.stringify(photoKeys) : null,
    null, null, null, null, null,
    now, now,
  );

  // 파트너 지표 로깅 — 부정 신호지만 별도 차원으로 저장 (단일 점수 collapse 금지)
  if (order.partner_email) {
    void recordMetric({
      partnerEmail: order.partner_email,
      kind: 'defect_reported',
      orderId,
      value: severity === 'critical' ? 3 : severity === 'major' ? 2 : 1,
    });
  }

  const row = await db.queryOne<DefectRow>('SELECT * FROM nf_defects WHERE id = ?', id);
  return NextResponse.json({ defect: row ? rowToDefect(row) : null }, { status: 201 });
}
