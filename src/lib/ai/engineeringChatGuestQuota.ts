import type { NextRequest } from 'next/server';
import { rateLimitAsync, type RateLimitResult } from '@/lib/rate-limit';

export const GUEST_ENGINEERING_CHAT_DAILY_LIMIT = 3;
const DAY_MS = 86_400_000;

export function engineeringChatGuestQuotaKey(sessionId: string | null, ip: string): string {
  return `eng-chat-guest-day:${sessionId?.trim() || 'ip'}:${ip}`;
}

export function guestEngineeringQuotaMustFailClosed(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.NODE_ENV === 'production' || environment.NEXYFAB_CAD_INDEPENDENT_MODE === '1';
}

/**
 * One server-side guest quota shared by the conversational and action routes.
 * A new client thread therefore cannot reset usage. Redis backs this in
 * production when configured; the IP remains part of the key if no governed
 * demo session exists.
 */
export async function consumeEngineeringChatGuestQuota(
  req: NextRequest,
  ip: string,
): Promise<RateLimitResult> {
  let sessionId: string | null = null;
  try {
    const { getDemoSession } = await import('@/lib/demo-session');
    sessionId = (await getDemoSession(req))?.id ?? null;
  } catch {
    // DB/session lookup failures still retain the IP quota boundary.
  }
  return rateLimitAsync(
    engineeringChatGuestQuotaKey(sessionId, ip),
    GUEST_ENGINEERING_CHAT_DAILY_LIMIT,
    DAY_MS,
    { failClosed: guestEngineeringQuotaMustFailClosed() },
  );
}
