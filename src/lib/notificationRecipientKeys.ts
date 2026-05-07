/**
 * Normalized recipient keys for `nf_notifications.user_id`.
 * Matches legacy inserts (`customer:email`, bare email) with UUID-based auth users.
 */

import { normPartnerEmail } from './partner-factory-access';

/** Partner portal — inserts use `partner:{email}`; some paths may use bare email or `nf_users.id`. */
export function partnerNotificationRecipientKeys(partner: { userId: string; email: string }): string[] {
  const keys = new Set<string>();
  const emailKey = normPartnerEmail(partner.email);
  if (emailKey) {
    keys.add(`partner:${emailKey}`);
    keys.add(emailKey);
  }
  if (partner.userId) {
    keys.add(partner.userId);
    keys.add(`user:${partner.userId}`);
  }
  return [...keys];
}

export function notificationRecipientKeys(authUser: {
  userId: string;
  email: string;
  globalRole: string;
}): string[] {
  const keys = new Set<string>([authUser.userId, `user:${authUser.userId}`]);
  const email = authUser.email?.trim().toLowerCase();
  if (email) {
    keys.add(email);
    keys.add(`customer:${email}`);
  }
  if (authUser.globalRole === 'super_admin') keys.add('admin');
  return [...keys];
}

export function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
