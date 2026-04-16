/**
 * notify.ts — 인앱 알림 생성 헬퍼 (SQLite 기반)
 * recipientKey: 'admin' | 'partner:{email}' | 'customer:{email}'
 */

import { dbInsertNotification, type DbNotification } from '@/app/lib/db';

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

export function createNotification(
  recipient: string,
  type: string,
  title: string,
  message: string,
  meta?: { contractId?: string; quoteId?: string }
) {
  try {
    const notification: DbNotification = {
      id: `NTF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      title,
      message,
      contractId: meta?.contractId,
      quoteId: meta?.quoteId,
      createdAt: new Date().toISOString(),
      read: false,
    };
    dbInsertNotification(recipient, notification);
  } catch (e) {
    console.error('[notify] createNotification 실패:', e);
  }
}
