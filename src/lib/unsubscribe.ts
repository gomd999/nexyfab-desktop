/**
 * 이메일 수신거부 헬퍼
 * route.ts 외부에서 import할 때 사용
 */
import { createHmac } from 'crypto';
import { getDbAdapter } from '@/lib/db-adapter';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://nexyfab.com';

function getSecret(): string {
  return process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'nexyfab-unsub-secret';
}

export function buildUnsubscribeUrl(email: string): string {
  const token = createHmac('sha256', getSecret()).update(email.toLowerCase()).digest('hex');
  return `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

export async function isUnsubscribed(email: string): Promise<boolean> {
  const db = getDbAdapter();
  try {
    const row = await db.queryOne<{ email: string }>(
      'SELECT email FROM nf_email_unsubscribe WHERE email = ?',
      email.toLowerCase(),
    );
    return !!row;
  } catch {
    return false;
  }
}
