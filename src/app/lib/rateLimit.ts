// 메모리 기반 간단한 Rate Limiter
// 서버리스 환경에서는 단일 인스턴스 내에서만 작동합니다.
const requestCounts = new Map<string, { count: number; resetAt: number }>();

/**
 * Rate limit 확인
 * @param key 식별 키 (IP 주소 등)
 * @param maxRequests 허용 최대 요청 수
 * @param windowMs 시간 윈도우 (밀리초)
 * @returns 허용 시 true, 초과 시 false
 */
export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const record = requestCounts.get(key);

  if (!record || record.resetAt < now) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) return false;

  record.count++;
  return true;
}
