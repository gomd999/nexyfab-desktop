import { getDbAdapter } from './db-adapter';
import type { PartnerInfo } from './partner-auth';

/** Lowercased trim — use for partner vs DB email comparisons. */
export function normPartnerEmail(e: string | null | undefined): string {
  return (e ?? '').trim().toLowerCase();
}

/**
 * True if this partner may act for the factory identified by `assignedFactoryId`.
 * - Legacy: `partner.partnerId` equals factory id (opaque session / ops convention).
 * - Normal: login email matches `nf_factories.partner_email` or `contact_email`
 *   (same addresses used for RFQ emails / `partner:${email}` notifications).
 */
export async function partnerOwnsAssignedFactory(
  assignedFactoryId: string,
  partner: PartnerInfo,
): Promise<boolean> {
  if (partner.partnerId === assignedFactoryId) return true;

  const db = getDbAdapter();
  const row = await db.queryOne<{ partner_email: string | null; contact_email: string | null }>(
    'SELECT partner_email, contact_email FROM nf_factories WHERE id = ?',
    assignedFactoryId,
  ).catch(() => null);

  if (!row) return false;

  const login = normPartnerEmail(partner.email);
  if (!login) return false;

  const pe = normPartnerEmail(row.partner_email);
  const ce = normPartnerEmail(row.contact_email);
  return (pe.length > 0 && login === pe) || (ce.length > 0 && login === ce);
}

/**
 * Resolve the primary `nf_factories` row for a partner login (dashboards, KPIs).
 */
export async function findFactoryForPartnerEmail(
  partnerEmail: string,
  opts?: { activeOnly?: boolean },
): Promise<{ id: string; name: string; region?: string; status?: string } | null> {
  const db = getDbAdapter();
  const activeOnly = opts?.activeOnly !== false;
  const statusClause = activeOnly ? "AND status = 'active'" : '';

  const row = await db.queryOne<{ id: string; name: string; region: string; status: string }>(
    `SELECT id, name, region, status FROM nf_factories
     WHERE (partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?)
        OR (contact_email IS NOT NULL AND LOWER(TRIM(contact_email)) = ?)
       ${statusClause}
     LIMIT 1`,
    normPartnerEmail(partnerEmail),
    normPartnerEmail(partnerEmail),
  ).catch(() => null);

  return row ?? null;
}
