// Helpers for building signed unsubscribe URLs used in outgoing email
// templates. Extracted from the email-preferences route because Next.js
// route files may only export route handlers.

import { createHmac, timingSafeEqual } from 'crypto';

export type EmailCategory =
  | 'transactional'
  | 'billing'
  | 'product_updates'
  | 'marketing'
  | 'collab';

export const EMAIL_CATEGORIES: EmailCategory[] = [
  'transactional',
  'billing',
  'product_updates',
  'marketing',
  'collab',
];

export function signUnsubscribeToken(userId: string, category: EmailCategory): string {
  const secret =
    process.env.EMAIL_UNSUB_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'dev-secret';
  const h = createHmac('sha256', secret);
  h.update(`${userId}:${category}`);
  return `${userId}.${category}.${h.digest('base64url').slice(0, 32)}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { userId: string; category: EmailCategory } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, category, sig] = parts;
  if (!EMAIL_CATEGORIES.includes(category as EmailCategory)) return null;
  const expected = signUnsubscribeToken(userId, category as EmailCategory).split('.')[2];
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    return timingSafeEqual(a, b)
      ? { userId, category: category as EmailCategory }
      : null;
  } catch {
    return null;
  }
}

/** Public helper: returns a signed unsubscribe URL for use in email templates. */
export function buildUnsubscribeUrl(userId: string, category: EmailCategory): string {
  const base = process.env.NEXT_PUBLIC_NEXYFAB_URL ?? 'https://nexyfab.com';
  return `${base}/kr/unsubscribe?token=${encodeURIComponent(
    signUnsubscribeToken(userId, category),
  )}&cat=${category}`;
}
