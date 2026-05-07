import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, rfqNotificationHtml } from '@/lib/nexyfab-email';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { createNotification } from '@/app/lib/notify';
import { rowToRfq, type RFQEntry } from '../rfq-types';
import { normPartnerEmail } from '@/lib/partner-factory-access';

// ─── GET /api/nexyfab/rfq/[id] ────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDbAdapter();
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_rfqs WHERE id = ? AND user_id = ?',
    id, authUser.userId,
  );

  if (!row) {
    return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
  }

  return NextResponse.json(rowToRfq(row));
}

// ─── PATCH /api/nexyfab/rfq/[id] ─────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDbAdapter();

  const existingRow = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_rfqs WHERE id = ? AND user_id = ?',
    id, authUser.userId,
  );

  if (!existingRow) {
    return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
  }

  const body = await req.json() as {
    status?: 'accepted' | 'rejected';
    quoteAmount?: number;
    manufacturerNote?: string;
  };

  const USER_ALLOWED_STATUSES = ['accepted', 'rejected'] as const;
  if (body.status && !USER_ALLOWED_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
  }

  const previousStatus = existingRow.status as string;
  const now = Date.now();

  await db.execute(
    `UPDATE nf_rfqs SET
       status            = COALESCE(?, status),
       quote_amount      = COALESCE(?, quote_amount),
       manufacturer_note = COALESCE(?, manufacturer_note),
       updated_at        = ?
     WHERE id = ?`,
    body.status ?? null,
    body.quoteAmount ?? null,
    body.manufacturerNote ?? null,
    now,
    id,
  );

  const updatedRow = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_rfqs WHERE id = ?',
    id,
  );
  if (!updatedRow) return NextResponse.json({ error: 'RFQ not found after update' }, { status: 500 });
  const entry = rowToRfq(updatedRow);

  // ─── Status-change email notifications (fire-and-forget) ─────────────────
  if (body.status && body.status !== previousStatus) {
    const adminEmail = process.env.NEXYFAB_ADMIN_EMAIL || 'nexyfab@nexysys.com';
    const rfqEmailData = {
      rfqId: entry.rfqId,
      shapeName: entry.shapeName,
      materialId: entry.materialId,
      quantity: entry.quantity,
      volume_cm3: entry.volume_cm3,
      quoteAmount: entry.quoteAmount,
      estimatedCost: entry.costEstimates?.[0]?.unitCost,
    };

    if (body.status === 'accepted') {
      sendEmail(
        adminEmail,
        `[NexyFab] 견적 수락됨 — RFQ #${entry.rfqId.slice(0, 8).toUpperCase()}`,
        rfqNotificationHtml({
          ...rfqEmailData,
          userEmail: entry.userEmail || undefined,
        }).replace('새 견적 요청 도착', '견적이 수락되었습니다 ✓')
          .replace('새로운 RFQ가 접수되었습니다. 아래 상세 내용을 확인하고 견적을 보내주세요.', '고객이 견적을 수락했습니다. 생산 일정을 확인하고 연락해 주세요.'),
      ).catch(err => console.error('[rfq] accepted notification email failed:', err));

      // 배정된 제조사(파트너)에게 인앱 알림
      const assignedFactory = await db.queryOne<{ contact_email: string | null; partner_email: string | null }>(
        'SELECT f.contact_email, f.partner_email FROM nf_rfqs r LEFT JOIN nf_factories f ON f.id = r.assigned_factory_id WHERE r.id = ?',
        id,
      ).catch(() => null);
      const partnerNotifyEmail =
        assignedFactory?.contact_email?.trim() || assignedFactory?.partner_email?.trim() || '';
      if (partnerNotifyEmail) {
        createNotification(
          `partner:${normPartnerEmail(partnerNotifyEmail)}`,
          'quote_accepted',
          '견적 수락됨',
          `고객이 "${entry.shapeName || entry.rfqId}" 견적을 수락했습니다. 생산을 진행해 주세요.`,
          { quoteId: entry.rfqId },
        );
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  return NextResponse.json(entry);
}

// ─── DELETE /api/nexyfab/rfq/[id] ────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();

  const existing = await db.queryOne<{ status: string }>(
    'SELECT status FROM nf_rfqs WHERE id = ? AND user_id = ?',
    id, authUser.userId,
  );

  if (!existing) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

  // Only allow deletion when not in an active/accepted state
  if (existing.status === 'accepted') {
    return NextResponse.json({ error: '수락된 견적은 삭제할 수 없습니다.' }, { status: 400 });
  }

  await db.execute('DELETE FROM nf_rfqs WHERE id = ? AND user_id = ?', id, authUser.userId);

  return NextResponse.json({ ok: true });
}
