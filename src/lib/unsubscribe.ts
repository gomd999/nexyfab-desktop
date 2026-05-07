/**
 * 이메일 수신거부 헬퍼
 * route.ts 외부에서 import할 때 사용
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getDbAdapter } from '@/lib/db-adapter';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://nexyfab.com';

function getSecret(): string {
  const fromEnv = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'UNSUBSCRIBE_SECRET or JWT_SECRET must be set in production (unsubscribe token signing).',
    );
  }
  return 'nexyfab-unsub-dev-only-not-for-production';
}

export function buildUnsubscribeUrl(email: string): string {
  const token = createHmac('sha256', getSecret()).update(email.toLowerCase()).digest('hex');
  return `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

/** 이메일 수신거부 링크의 token 검증 (타이밍 안전 비교) */
export function verifyUnsubscribeEmailToken(email: string, token: string): boolean {
  const expected = createHmac('sha256', getSecret()).update(email.toLowerCase()).digest('hex');
  if (expected.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
  } catch {
    return false;
  }
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
