import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, rfqNotificationHtml, nexyfabAdminEmailLocale, rfqNotificationEmailSubject, getNexyfabAdminEmail } from '@/lib/nexyfab-email';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { createNotification } from '@/app/lib/notify';
import { rowToRfq, type RFQEntry as _RFQEntry } from '../rfq-types';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const RFQ_UPDATE_JSON_BYTES = 64 * 1024;

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

  let body: {
    status?: 'accepted' | 'rejected';
    quoteAmount?: number;
    manufacturerNote?: string;
  } = {};
  try {
    body = await readBoundedJson(req, RFQ_UPDATE_JSON_BYTES);
  } catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

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
    const adminEmail = getNexyfabAdminEmail();
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
      const adminLocale = nexyfabAdminEmailLocale();
      sendEmail(
        adminEmail,
        rfqNotificationEmailSubject(adminLocale, 'quote_accepted', {
          shapeName: entry.shapeName,
          rfqIdPrefix: entry.rfqId.slice(0, 8),
        }),
        rfqNotificationHtml(
          {
            ...rfqEmailData,
            userEmail: entry.userEmail || undefined,
          },
          adminLocale,
          'quote_accepted',
        ),
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
          { rfqId: entry.rfqId },
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

  // Before deleting, notify any partners who were already engaged on this
  // RFQ — they may have started drafting a quote and deserve to know it's
  // off the table. Pull from concierge_status (operator-recommended) and
  // nf_quotes (already drafted).
  let notifyTargets: string[] = [];
  try {
    const csRows = await db.queryAll<{ partner_email: string | null }>(
      `SELECT DISTINCT f.partner_email FROM nf_concierge_status cs
        JOIN nf_factories f ON f.id = cs.factory_id
        WHERE cs.rfq_id = ?
          AND cs.status IN ('contacted','responded','quote_drafting','quote_received')
          AND f.partner_email IS NOT NULL`,
      id,
    ).catch((): Array<{ partner_email: string | null }> => []);
    const quoteRows = await db.queryAll<{ partner_email: string | null }>(
      `SELECT DISTINCT partner_email FROM nf_quotes WHERE inquiry_id = ? AND partner_email IS NOT NULL`,
      id,
    ).catch((): Array<{ partner_email: string | null }> => []);
    const set = new Set<string>();
    for (const r of [...csRows, ...quoteRows]) {
      if (r.partner_email) set.add(r.partner_email.trim().toLowerCase());
    }
    notifyTargets = Array.from(set);
  } catch { /* non-blocking */ }

  await db.execute('DELETE FROM nf_rfqs WHERE id = ? AND user_id = ?', id, authUser.userId);

  // Fire notifications after delete so a DB error doesn't leave half-state.
  if (notifyTargets.length > 0) {
    try {
      const { createNotification } = await import('@/app/lib/notify');
      for (const email of notifyTargets) {
        void createNotification(
          `partner:${email}`,
          'rfq_cancelled',
          '발주처에서 RFQ를 취소했습니다',
          `참여 중이던 RFQ ${id.slice(0, 12)} 가 발주처에 의해 취소되었습니다. 작업 중이셨다면 운영팀으로 연락 주세요.`,
          { rfqId: id },
        );
      }
    } catch { /* non-blocking */ }
  }

  return NextResponse.json({ ok: true, notifiedPartners: notifyTargets.length });
}
