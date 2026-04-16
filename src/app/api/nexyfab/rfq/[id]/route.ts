import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, rfqNotificationHtml } from '@/lib/nexyfab-email';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { createNotification } from '@/app/lib/notify';
import { rowToRfq, type RFQEntry } from '../rfq-types';

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
    status?: 'pending' | 'quoted' | 'accepted' | 'rejected';
    quoteAmount?: number;
    manufacturerNote?: string;
  };

  const VALID_STATUSES = ['pending', 'quoted', 'accepted', 'rejected'] as const;
  if (body.status && !VALID_STATUSES.includes(body.status)) {
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
  const entry = rowToRfq(updatedRow!);

  // ─── Status-change email notifications (fire-and-forget) ─────────────────
  if (body.status && body.status !== previousStatus) {
    const adminEmail = process.env.NEXYFAB_ADMIN_EMAIL || 'admin@nexyfab.com';
    const userEmailHeader = req.headers.get('x-user-email') ?? '';
    const rfqEmailData = {
      rfqId: entry.rfqId,
      shapeName: entry.shapeName,
      materialId: entry.materialId,
      quantity: entry.quantity,
      volume_cm3: entry.volume_cm3,
      quoteAmount: entry.quoteAmount,
      estimatedCost: entry.costEstimates?.[0]?.unitCost,
    };

    if (body.status === 'quoted') {
      const toEmail = userEmailHeader || entry.userEmail || '';
      if (toEmail) {
        const baseUrl = process.env.NEXTAUTH_URL || 'https://nexyfab.com';
        const rfqUrl = `${baseUrl}/ko/nexyfab/rfq/${entry.rfqId}`;
        const quoteAmountText =
          entry.quoteAmount != null ? `$${entry.quoteAmount.toFixed(2)}` : '(확인 필요)';

        sendEmail(
          toEmail,
          `[NexyFab] 견적이 도착했습니다 — ${entry.shapeName}`,
          (() => {
            const content = `
              <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#3fb950;">견적이 도착했습니다!</h2>
              <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
                <strong style="color:#e6edf3;">${entry.shapeName}</strong>에 대한 견적이 준비되었습니다.<br>
                견적 금액: <strong style="color:#388bfd;font-size:18px;">${quoteAmountText}</strong>
              </p>
              <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
                <tr style="border-bottom:1px solid #21262d;">
                  <td style="padding:6px 0;color:#8b949e;font-size:13px;">RFQ 번호</td>
                  <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;font-family:monospace;">${entry.rfqId.slice(0, 8).toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#8b949e;font-size:13px;">부품명</td>
                  <td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${entry.shapeName}</td>
                </tr>
              </table>
              <a href="${rfqUrl}" style="display:inline-block;padding:12px 24px;background:#3fb950;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
                견적 확인 및 수락하기
              </a>`;
            return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:16px;background:#161b22;"><div style="background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px;border-radius:12px;border:1px solid #30363d;"><h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#388bfd;">NexyFab</h1>${content}<hr style="border:none;border-top:1px solid #21262d;margin:32px 0 16px;"><p style="color:#6e7681;font-size:11px;margin:0;">NexyFab &middot; <a href="https://nexyfab.com" style="color:#6e7681;">nexyfab.com</a> &middot; <a href="https://nexyfab.com/unsubscribe" style="color:#6e7681;">수신 거부</a></p></div></body></html>`;
          })(),
        ).catch(err => console.error('[rfq] quote notification email failed:', err));
      }
    }

    if (body.status === 'accepted') {
      sendEmail(
        adminEmail,
        `[NexyFab] 견적 수락됨 — RFQ #${entry.rfqId.slice(0, 8).toUpperCase()}`,
        rfqNotificationHtml({
          ...rfqEmailData,
          userEmail: userEmailHeader || entry.userEmail || undefined,
        }).replace('새 견적 요청 도착', '견적이 수락되었습니다 ✓')
          .replace('새로운 RFQ가 접수되었습니다. 아래 상세 내용을 확인하고 견적을 보내주세요.', '고객이 견적을 수락했습니다. 생산 일정을 확인하고 연락해 주세요.'),
      ).catch(err => console.error('[rfq] accepted notification email failed:', err));

      // 배정된 제조사(파트너)에게 인앱 알림
      const assignedFactory = await db.queryOne<{ contact_email: string | null }>(
        'SELECT f.contact_email FROM nf_rfqs r LEFT JOIN nf_factories f ON f.id = r.assigned_factory_id WHERE r.id = ?',
        id,
      ).catch(() => null);
      if (assignedFactory?.contact_email) {
        createNotification(
          `partner:${assignedFactory.contact_email}`,
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
