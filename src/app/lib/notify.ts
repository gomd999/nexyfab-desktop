/**
 * notify.ts — 인앱 알림 생성 헬퍼
 * recipientKey: 'admin' | 'partner:{email}' | 'customer:{email}' | user id
 *
 * All app notifications are stored in the main adapter-backed nf_notifications
 * table. Do not write to the legacy app/lib/db notifications table here.
 */

import { getDbAdapter } from '@/lib/db-adapter';

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  contractId?: string;
  quoteId?: string;
  createdAt: string;
  read: boolean;
}

/** Meta for deep-linking in-app notifications (role-aware paths). */
export type NotificationMeta = {
  /** nf_contracts / escrow contract id */
  contractId?: string;
  /** nf_quotes.id */
  quoteId?: string;
  /** nf_rfqs.id — do not pass RFQ ids in quoteId */
  rfqId?: string;
  /** If set, overrides computed link (`''` = no link). */
  href?: string | null;
};

function normalizeRecipientKey(recipient: string): string {
  const trimmed = recipient.trim();
  const prefixMatch = trimmed.match(/^([^:]+):(.+)$/);
  if (!prefixMatch) return trimmed;

  const [, prefix, value] = prefixMatch;
  const normalizedPrefix = prefix.toLowerCase();
  const normalizedValue = ['partner', 'customer', 'user', 'factory'].includes(normalizedPrefix)
    ? value.trim().toLowerCase()
    : value.trim();
  return `${normalizedPrefix}:${normalizedValue}`;
}

/**
 * Computes an app-relative URL for the notification bell / dashboard.
 * Admin vs partner vs end-user paths differ; RFQ ids must use `rfqId`, not `quoteId`.
 */
export function notificationLinkFor(recipient: string, meta?: NotificationMeta): string | null {
  if (!meta) return null;
  if (meta.href !== undefined) {
    return meta.href === '' || meta.href === null ? null : meta.href;
  }

  const r = normalizeRecipientKey(recipient);
  const isPartnerLike = r.startsWith('partner:') || r.startsWith('factory:');
  const isAdmin = r === 'admin';

  if (meta.contractId) {
    if (isAdmin) return `/admin/contracts/${encodeURIComponent(meta.contractId)}`;
    if (isPartnerLike) return `/partner/orders`;
    return `/ko/nexyfab/orders`;
  }

  if (meta.quoteId) {
    if (isAdmin) return `/admin/quotes/${encodeURIComponent(meta.quoteId)}`;
    if (isPartnerLike) return `/partner/quotes`;
    return `/ko/nexyfab/rfq`;
  }

  if (meta.rfqId) {
    if (isAdmin) return `/admin/rfq`;
    if (isPartnerLike) return `/partner/quotes`;
    return `/ko/nexyfab/rfq`;
  }

  return null;
}

export async function createNotification(
  recipient: string,
  type: string,
  title: string,
  message: string,
  meta?: NotificationMeta,
) {
  try {
    const db = getDbAdapter();
    const id = `NTF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const link = notificationLinkFor(recipient, meta);

    await db.execute(
      `INSERT INTO nf_notifications (id, user_id, type, title, body, link, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      id,
      normalizeRecipientKey(recipient),
      type,
      title,
      message,
      link,
      Date.now(),
    );
  } catch (e) {
    console.error('[notify] createNotification 실패:', e);
  }
}
