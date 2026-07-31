/**
 * 개인정보처리방침·첫 실행 마법사와 동기화할 제3자 처리 안내.
 * 실제 수집 여부는 배포 환경의 env·동의 UI(쿠키/옵트인)에 따름.
 */

export const DATA_PROCESSORS_PRIVACY_LINE: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', string> = {
  ko: '오류 진단·안정성: Sentry(이벤트·스택, DSN 설정 시). 제품 분석(선택 동의 시): PostHog·Google Analytics 등. 결제: Stripe·Toss·Airwallex(결제 시). 파일·계정: Cloudflare R2·자체 API(로그인·프로젝트 동기화 시). 상세는 개인정보처리방침을 참고하세요.',
  en: 'Errors & stability: Sentry (events/stack traces when DSN is configured). Product analytics (optional opt-in): PostHog, Google Analytics, etc. Payments: Stripe, Toss, Airwallex when you pay. Files & accounts: Cloudflare R2 and NexyFab APIs when you sign in or sync. See the Privacy Policy for details.',
  /**
   * ⚠ 260802: 여기가 ko/en 만이었다. 개인정보처리방침은 6언어인데 **같은 내용을 말하는
   *   이 안내가 2언어**면, 스페인어·아랍어 사용자는 정책은 자기 언어로 읽고 수탁사
   *   고지는 영어로 받는다. 법적 문서는 갈리면 안 된다.
   */
  ja: 'エラー診断・安定性: Sentry(イベント・スタック、DSN 設定時)。プロダクト分析(任意のオプトイン時): PostHog・Google Analytics など。決済: Stripe・Toss・Airwallex(決済時)。ファイル・アカウント: Cloudflare R2・自社 API(ログイン・プロジェクト同期時)。詳細はプライバシーポリシーをご覧ください。',
  zh: '错误诊断与稳定性：Sentry（事件与堆栈，配置 DSN 时）。产品分析（选择性同意时）：PostHog、Google Analytics 等。支付：Stripe、Toss、Airwallex（付款时）。文件与账户：Cloudflare R2 及自有 API（登录或同步项目时）。详情请参阅隐私政策。',
  es: 'Errores y estabilidad: Sentry (eventos y trazas cuando se configura el DSN). Analítica de producto (con consentimiento opcional): PostHog, Google Analytics, etc. Pagos: Stripe, Toss y Airwallex cuando usted paga. Archivos y cuentas: Cloudflare R2 y las API de NexyFab al iniciar sesión o sincronizar. Consulte la Política de privacidad para más detalles.',
  ar: 'تشخيص الأخطاء والاستقرار: Sentry (الأحداث وتتبّع الاستدعاءات عند ضبط DSN). تحليلات المنتج (بموافقة اختيارية): PostHog وGoogle Analytics وغيرها. المدفوعات: Stripe وToss وAirwallex عند الدفع. الملفات والحسابات: Cloudflare R2 وواجهات NexyFab عند تسجيل الدخول أو المزامنة. للاطلاع على التفاصيل، يُرجى مراجعة سياسة الخصوصية.',
};

/**
 * UI 언어 코드 → 안내 문구. 라우트 표기(kr·cn)와 ISO 표기(ko·zh)를 **둘 다** 받는다.
 *
 * ⚠ 260802: 여기가 ko/en 만 돌려줬다 — 사전에 4언어를 넣어도 **선택될 수 없었다.**
 *   사전을 채우는 것과 고르는 곳을 고치는 것은 다르다.
 */
export function privacyProcessorsLine(lang: string): string {
  const l = lang.toLowerCase().split(/[-_]/)[0];
  if (l === 'ko' || l === 'kr') return DATA_PROCESSORS_PRIVACY_LINE.ko;
  if (l === 'ja') return DATA_PROCESSORS_PRIVACY_LINE.ja;
  if (l === 'zh' || l === 'cn') return DATA_PROCESSORS_PRIVACY_LINE.zh;
  if (l === 'es') return DATA_PROCESSORS_PRIVACY_LINE.es;
  if (l === 'ar') return DATA_PROCESSORS_PRIVACY_LINE.ar;
  return DATA_PROCESSORS_PRIVACY_LINE.en;
}
