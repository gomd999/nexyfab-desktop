import { toIsoLang } from './normalize';

/**
 * 날짜·숫자 포맷 — **번역이 아니라 로케일 문제다** (260802).
 *
 * ## 실측
 * `toLocaleDateString('ko-KR')` 하드코딩 **135곳**, `isKo ? 'ko-KR' : 'en-US'` **24곳**.
 * 즉 사이트가 6언어로 돌아도 **날짜와 숫자는 언어와 무관하게 한국 형식**으로 나온다.
 * 사전 커버리지 래칫으로는 이게 안 잡혔다 — 사전이 아니기 때문이다.
 *
 * ## 왜 문자열을 늘리지 않는가
 * 「2026년 5월 10일」을 언어마다 손으로 조립하면 **어순·구분자·역법이 다 달라** 곧 어긋난다.
 * `Intl` 이 그걸 안다. 앞서 상대시간(`timeAgo`)을 `Intl.RelativeTimeFormat` 에 넘긴 것과
 * 같은 판단이다 — **번역할 것과 런타임에 맡길 것을 가른다.**
 *
 * ## ⚠ 통화는 여기서 정하지 않는다
 * 금액은 **표시 언어가 아니라 거래 통화**가 정한다. 한국어 사용자가 USD 주문을 보면
 * `$` 로 보여야 한다 — 언어로 통화를 바꾸면 금액을 오독하게 만든다.
 * 그래서 `formatMoney` 는 통화 코드를 **반드시 인자로 받는다.**
 */

/** 라우트/ISO 코드 → BCP-47 로케일. */
export function bcp47(lang: string | undefined | null): string {
  switch (toIsoLang(lang)) {
    case 'ko': return 'ko-KR';
    case 'ja': return 'ja-JP';
    case 'zh': return 'zh-CN';
    case 'es': return 'es-ES';
    case 'ar': return 'ar';
    default: return 'en-US';
  }
}

/**
 * 날짜.
 * @param value epoch ms · ISO 문자열 · Date
 * ⚠ 잘못된 값이면 **빈 문자열이 아니라 `null`** 을 준다 — 빈 문자열은 「날짜 없음」으로
 *   보이지만 사실은 「값이 깨졌다」다. 호출측이 구별할 수 있어야 한다.
 */
export function formatDate(
  value: number | string | Date | null | undefined,
  lang: string | undefined | null,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(bcp47(lang), opts).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', opts).format(d);
  }
}

/** 숫자. 자릿수 구분자·소수점이 로케일마다 다르다(es 는 `1.234,5`). */
export function formatNumber(
  n: number | null | undefined,
  lang: string | undefined | null,
  opts: Intl.NumberFormatOptions = {},
): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat(bcp47(lang), opts).format(n);
  } catch {
    return new Intl.NumberFormat('en-US', opts).format(n);
  }
}

/**
 * 금액.
 * @param currency ISO 4217 (`KRW`·`USD`·`CNY`…) — **표시 언어가 아니라 거래 통화**다.
 */
export function formatMoney(
  n: number | null | undefined,
  lang: string | undefined | null,
  currency: string,
  opts: Intl.NumberFormatOptions = {},
): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const o: Intl.NumberFormatOptions = { style: 'currency', currency, ...opts };
  try {
    return new Intl.NumberFormat(bcp47(lang), o).format(n);
  } catch {
    return new Intl.NumberFormat('en-US', o).format(n);
  }
}
