/**
 * 클라이언트 IP (레이트 리밋·감사 로그용).
 *
 * Cloudflare 프록시 뒤에서는 `CF-Connecting-IP`를 우선합니다(일반 브라우저 요청만으로는 위조 불가).
 * 그다음 `True-Client-IP`(엔터프라이즈), `X-Real-IP`, `X-Forwarded-For`의 첫 홉 순입니다.
 *
 * 직접 오리진에 붙는 트래픽은 마지막 단계의 XFF에 의존하므로, 가능하면 오리진 앞단에서
 * 신뢰할 수 있는 프록시만 두는 것이 좋습니다.
 */
export function getTrustedClientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;

  const trueClient = headers.get('true-client-ip')?.trim();
  if (trueClient) return trueClient;

  const xReal = headers.get('x-real-ip')?.trim();
  if (xReal) {
    const hop = xReal.split(',')[0]?.trim();
    if (hop) return hop;
  }

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const hop = xff.split(',')[0]?.trim();
    if (hop) return hop;
  }

  return 'unknown';
}

/** DB/감사 로그 등 — IP를 알 수 없으면 undefined */
export function getTrustedClientIpOrUndefined(headers: Headers): string | undefined {
  const ip = getTrustedClientIp(headers);
  return ip === 'unknown' ? undefined : ip;
}
