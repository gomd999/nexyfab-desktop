/**
 * 개인정보처리방침·첫 실행 마법사와 동기화할 제3자 처리 안내.
 * 실제 수집 여부는 배포 환경의 env·동의 UI(쿠키/옵트인)에 따름.
 */

export const DATA_PROCESSORS_PRIVACY_LINE: Record<'ko' | 'en', string> = {
  ko: '오류 진단·안정성: Sentry(이벤트·스택, DSN 설정 시). 제품 분석(선택 동의 시): PostHog·Google Analytics 등. 결제: Stripe·Toss·Airwallex(결제 시). 파일·계정: Cloudflare R2·자체 API(로그인·프로젝트 동기화 시). 상세는 개인정보처리방침을 참고하세요.',
  en: 'Errors & stability: Sentry (events/stack traces when DSN is configured). Product analytics (optional opt-in): PostHog, Google Analytics, etc. Payments: Stripe, Toss, Airwallex when you pay. Files & accounts: Cloudflare R2 and NexyFab APIs when you sign in or sync. See the Privacy Policy for details.',
};

/** UI 언어 코드(ko/kr → 한국어 안내, 그 외 → 영어). */
export function privacyProcessorsLine(lang: string): string {
  const l = lang.toLowerCase();
  if (l === 'ko' || l === 'kr') return DATA_PROCESSORS_PRIVACY_LINE.ko;
  return DATA_PROCESSORS_PRIVACY_LINE.en;
}
