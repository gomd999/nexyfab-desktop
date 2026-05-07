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

export async function createNotification(
  recipient: string,
  type: string,
  title: string,
  message: string,
  meta?: { contractId?: string; quoteId?: string }
) {
  try {
    const db = getDbAdapter();
    const id = `NTF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const link = meta?.contractId
      ? `/admin/contracts/${encodeURIComponent(meta.contractId)}`
      : meta?.quoteId
        ? `/admin/quotes/${encodeURIComponent(meta.quoteId)}`
        : null;

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
