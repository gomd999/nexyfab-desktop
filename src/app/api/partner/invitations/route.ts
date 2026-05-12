/**
 * OP1 — Partner-side "incoming RFQ invitations" endpoint.
 *
 * GET /api/partner/invitations
 *   → { invitations: [{ rfqId, shapeName, materialId, quantity,
 *                       conciergeStatus, contactedAt }] }
 *
 * Returns RFQs where:
 *   - This partner's email is on a nf_concierge_status row
 *   - Status is contacted / responded / quote_drafting
 *   - No quote yet from this partner for this RFQ
 *
 * The flip side of /admin/concierge — what the partner sees when they
 * land on /partner/quotes after accepting an invite.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { logFunnelEvent } from '@/lib/funnel-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InvitationRow {
  rfq_id: string;
  shape_name: string | null;
  material_id: string;
  quantity: number;
  volume_cm3: number;
  surface_area_cm2: number;
  bbox: string;
  note: string | null;
  deadline: string | null;
  rfq_status: string;
  rfq_created_at: number;
  concierge_status: string;
  concierge_last_action: number;
  factory_id: string;
}

export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!partner.email) return NextResponse.json({ error: 'no email on partner' }, { status: 400 });

  const partnerEmail = normPartnerEmail(partner.email);
  const db = getDbAdapter();

  // Resolve this partner's factory id(s) — the concierge table keys by
  // factory_id, so we need to bridge through nf_factories.partner_email.
  const factoryRows = await db.queryAll<{ id: string }>(
    `SELECT id FROM nf_factories
       WHERE LOWER(TRIM(partner_email)) = ? OR LOWER(TRIM(contact_email)) = ?`,
    partnerEmail, partnerEmail,
  ).catch((): Array<{ id: string }> => []);
  const factoryIds = factoryRows.map(r => r.id);
  if (factoryIds.length === 0) {
    // J fix: explicit state so the partner page can show actionable guidance
    // ("Your account isn't linked to a factory yet — contact ops") instead
    // of a confusing empty invitation list.
    return NextResponse.json({
      ok: true,
      invitations: [],
      state: 'no_factory_linked',
      hint: '운영팀에 등록된 공장과 본 계정이 아직 연결되지 않았습니다. nexyfab@nexysys.com 으로 사업자 등록 번호와 함께 연결 요청 주세요.',
    });
  }

  const placeholders = factoryIds.map(() => '?').join(', ');
  const rows = await db.queryAll<InvitationRow>(
    `SELECT
       cs.rfq_id, cs.factory_id, cs.status AS concierge_status,
       cs.last_action_at AS concierge_last_action,
       r.shape_name, r.material_id, r.quantity,
       r.volume_cm3, r.surface_area_cm2, r.bbox,
       r.note, r.deadline,
       r.status AS rfq_status, r.created_at AS rfq_created_at
     FROM nf_concierge_status cs
     JOIN nf_rfqs r ON r.id = cs.rfq_id
     WHERE cs.factory_id IN (${placeholders})
       AND cs.status IN ('contacted', 'responded', 'quote_drafting', 'recommended')
       AND r.status NOT IN ('accepted', 'rejected')
       AND NOT EXISTS (
         SELECT 1 FROM nf_quotes q
         WHERE q.inquiry_id = cs.rfq_id
           AND LOWER(TRIM(q.partner_email)) = ?
       )
     ORDER BY cs.last_action_at DESC
     LIMIT 50`,
    ...factoryIds, partnerEmail,
  ).catch((): InvitationRow[] => []);

  // Funnel — log a single "viewed" event per call so we can track how
  // often invited partners actually open the dashboard (vs ignore).
  // Light dedup: only log if at least one invitation exists, to avoid
  // counting empty polls.
  if (rows.length > 0) {
    await logFunnelEvent(partner.userId, {
      eventType: 'partner_invitation_viewed',
      contextType: 'partner',
      contextId: partner.userId,
      metadata: { count: rows.length },
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    invitations: rows.map(r => {
      let bbox: { w: number; h: number; d: number } = { w: 0, h: 0, d: 0 };
      try { bbox = JSON.parse(r.bbox); } catch { /* ignore */ }
      return {
        rfqId: r.rfq_id,
        shapeName: r.shape_name,
        materialId: r.material_id,
        quantity: r.quantity,
        volumeCm3: r.volume_cm3,
        surfaceAreaCm2: r.surface_area_cm2,
        bbox,
        note: r.note,
        deadline: r.deadline,
        rfqStatus: r.rfq_status,
        rfqCreatedAt: r.rfq_created_at,
        conciergeStatus: r.concierge_status,
        conciergeLastAction: r.concierge_last_action,
      };
    }),
  });
}
