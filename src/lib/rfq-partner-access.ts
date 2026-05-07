import { getDbAdapter } from '@/lib/db-adapter';
import type { AuthUser } from '@/lib/auth-middleware';
import { normPartnerEmail, partnerOwnsAssignedFactory } from '@/lib/partner-factory-access';

export type RfqAccessRole = 'owner' | 'partner';

/** RFQ 소유자 또는 견적/배정 공장 기준으로 접근 가능한 파트너 */
export async function getRfqAccessForUser(
  rfqId: string,
  authUser: AuthUser,
): Promise<{ role: RfqAccessRole; rfqUserId: string } | null> {
  const db = getDbAdapter();
  const rfq = await db.queryOne<{ user_id: string }>(
    'SELECT user_id FROM nf_rfqs WHERE id = ?',
    rfqId,
  );
  if (!rfq) return null;
  if (rfq.user_id === authUser.userId) {
    return { role: 'owner', rfqUserId: rfq.user_id };
  }

  const quote = await db.queryOne<{ id: string }>(
    `SELECT id FROM nf_quotes
     WHERE inquiry_id = ?
       AND partner_email IS NOT NULL
       AND LOWER(TRIM(partner_email)) = ?`,
    rfqId,
    normPartnerEmail(authUser.email),
  ).catch(() => null);
  if (quote) return { role: 'partner', rfqUserId: rfq.user_id };

  const isPartner = authUser.roles.some(r => r.product === 'nexyfab' && r.role === 'partner');
  if (isPartner) {
    const row = await db.queryOne<{ af: string | null }>(
      'SELECT assigned_factory_id AS af FROM nf_rfqs WHERE id = ?',
      rfqId,
    ).catch(() => null);
    if (row?.af) {
      const ok = await partnerOwnsAssignedFactory(row.af, {
        partnerId: authUser.userId,
        userId: authUser.userId,
        email: authUser.email,
        company: '',
      });
      if (ok) return { role: 'partner', rfqUserId: rfq.user_id };
    }
  }
  return null;
}
