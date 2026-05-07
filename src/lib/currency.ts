/** USD → KRW 환율 상수. 환율 변경 시 이 파일만 수정하세요. */
export const KRW_PER_USD = 1_350;

/** USD 금액을 KRW 문자열로 포맷 (₩1,234,000) */
export function fmtKRW(usd: number): string {
  return `₩${Math.round(usd * KRW_PER_USD).toLocaleString('ko-KR')}`;
}

/** USD를 KRW 정수로 변환 */
export function toKRW(usd: number): number {
  return Math.round(usd * KRW_PER_USD);
}
