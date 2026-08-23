import { createHmac, timingSafeEqual } from 'node:crypto';

interface CadJobAuthorizationPayload {
  jobId: string;
  messageSha256: string;
  expiresAt: number;
}

export function createCadJobAuthorizationToken(
  jobId: string,
  messageSha256: string,
  secret: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(JSON.stringify({
    jobId,
    messageSha256,
    expiresAt: now + 15 * 60_000,
  } satisfies CadJobAuthorizationPayload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyCadJobAuthorizationToken(
  token: string,
  jobId: string,
  messageSha256: string,
  secret: string,
  now = Date.now(),
): boolean {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return false;
  const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url');
  const left = Buffer.from(expectedSignature);
  const right = Buffer.from(suppliedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<CadJobAuthorizationPayload>;
    return decoded.jobId === jobId
      && decoded.messageSha256 === messageSha256
      && Number.isSafeInteger(decoded.expiresAt)
      && Number(decoded.expiresAt) >= now;
  } catch { return false; }
}
