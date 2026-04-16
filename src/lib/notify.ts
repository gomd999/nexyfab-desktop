import { getDbAdapter } from './db-adapter';

export type NotificationType =
  | 'team.invite_accepted'
  | 'team.member_joined'
  | 'rfq.quoted'
  | 'rfq.accepted'
  | 'contract.completed'
  | 'payment.success'
  | 'payment.failed';

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  const db = getDbAdapter();
  const id = `notif-${crypto.randomUUID()}`;
  await db.execute(
    'INSERT INTO nf_notifications (id, user_id, type, title, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    id, params.userId, params.type, params.title, params.body ?? null, params.link ?? null, Date.now(),
  ).catch(() => {}); // silent fail — don't break main flow
}
