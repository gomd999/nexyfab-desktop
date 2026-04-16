import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, rfqNotificationHtml } from '@/lib/nexyfab-email';
import { checkOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { getDbAdapter } from '@/lib/db-adapter';
import { rowToRfq } from '../../../rfq/rfq-types';
import { MANUFACTURERS } from '../../manufacturers-data';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ─── POST /api/nexyfab/manufacturers/[id]/contact ─────────────────────────────
// Body: { rfqId: string, message?: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: manufacturerId } = await params;

  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!rateLimit(`mfr-contact:${ip}`, 10, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await req.json() as {
    rfqId?: string;
    message?: string;
  };

  if (!body.rfqId) {
    return NextResponse.json({ error: 'rfqId is required' }, { status: 400 });
  }

  const db = getDbAdapter();
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_rfqs WHERE id = ?',
    body.rfqId,
  );
  if (!row) {
    return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
  }
  const rfq = rowToRfq(row);

  // Look up manufacturer name from static data; fall back to admin email
  const manufacturer = MANUFACTURERS.find(m => m.id === manufacturerId);
  const manufacturerName = manufacturer?.name ?? manufacturerId;
  const manufacturerEmail = process.env.ADMIN_EMAIL ?? 'rfq@nexyfab.com';

  const rfqEmailData = {
    rfqId: rfq.rfqId,
    shapeName: rfq.shapeName,
    materialId: rfq.materialId,
    quantity: rfq.quantity,
    volume_cm3: rfq.volume_cm3,
    dfmScore: rfq.dfmResults?.[0]?.score,
    estimatedCost: rfq.costEstimates?.[0]?.unitCost,
  };

  const customMessage = body.message
    ? `<p style="background:#161b22;border-left:3px solid #388bfd;padding:12px 16px;border-radius:4px;color:#e6edf3;font-size:13px;margin:16px 0;">${escapeHtml(body.message)}</p>`
    : '';

  // Build notification HTML by injecting custom message after the header paragraph
  const baseHtml = rfqNotificationHtml(rfqEmailData);
  const htmlWithMessage = customMessage
    ? baseHtml.replace(
        '새로운 RFQ가 접수되었습니다. 아래 상세 내용을 확인하고 견적을 보내주세요.',
        `새로운 RFQ가 접수되었습니다. 아래 상세 내용을 확인하고 견적을 보내주세요.${customMessage}`,
      )
    : baseHtml;

  // Fire-and-forget
  sendEmail(
    manufacturerEmail,
    `[NexyFab] 견적 요청 — ${rfq.shapeName} → ${manufacturerName} (RFQ #${rfq.rfqId.slice(0, 8).toUpperCase()})`,
    htmlWithMessage,
  ).catch(err => console.error('[manufacturer-contact] email failed:', err));

  return NextResponse.json({ sent: true, manufacturerId });
}
