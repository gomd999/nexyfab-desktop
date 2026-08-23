import type { IsoLang } from './normalize';

export type AdminLocale = IsoLang;

type NavKey =
  | 'dashboard' | 'users' | 'subscriptions' | 'billing' | 'refundQueue' | 'analytics'
  | 'rfq' | 'factories' | 'quotes' | 'contracts' | 'inquiries'
  | 'partners' | 'partnerApplications' | 'partnerKpi' | 'partnerCutover' | 'settlements'
  | 'templates' | 'sla' | 'manufacturingKpi' | 'releases' | 'jobs'
  | 'funnel' | 'costOvershoot' | 'aiUsage' | 'promptStats' | 'promptCompare'
  | 'promptCompareHistory' | 'disabledVariants' | 'emailLogs' | 'auditLegacy'
  | 'auditActions' | 'webhooks' | 'search' | 'logs' | 'concierge' | 'antiPoach'
  | 'apiHealth' | 'cadWorkers' | 'cadReview' | 'settings' | 'accessEmails' | 'security';

export type AdminCopy = {
  language: string;
  languageLabel: string;
  admin: string;
  partnerPortal: string;
  site: string;
  emailLabel: string;
  emailPlaceholder: string;
  codeLabel: string;
  codePlaceholder: string;
  loginDescription: string;
  codeSent: string;
  requestCode: string;
  resendCode: string;
  changeEmail: string;
  login: string;
  loggingIn: string;
  loggingOut: string;
  logout: string;
  usersTitle?: string;
  usersExport?: string;
  refresh?: string;
  accessTitle?: string;
  accessDescription?: string;
  accessAdd?: string;
  accessList?: string;
  securityTitle?: string;
  securityDescription?: string;
  securityAlerts?: string;
  loginHistory?: string;
  pageTitles: Record<string, string>;
  nav: Record<NavKey, string>;
};

const NAV_KEYS: NavKey[] = [
  'dashboard', 'users', 'subscriptions', 'billing', 'refundQueue', 'analytics', 'rfq',
  'factories', 'quotes', 'contracts', 'inquiries', 'partners', 'partnerApplications',
  'partnerKpi', 'partnerCutover', 'settlements', 'templates', 'sla', 'manufacturingKpi',
  'releases', 'jobs', 'funnel', 'costOvershoot', 'aiUsage', 'promptStats', 'promptCompare',
  'promptCompareHistory', 'disabledVariants', 'emailLogs', 'auditLegacy', 'auditActions',
  'webhooks', 'search', 'logs', 'concierge', 'antiPoach', 'apiHealth', 'cadWorkers',
  'cadReview', 'settings', 'accessEmails', 'security',
];

const koNav: Record<NavKey, string> = {
  dashboard: '대시보드', users: '회원 관리', subscriptions: '구독 관리', billing: '청구 관리',
  refundQueue: '환불 큐', analytics: '매출 분석', rfq: 'RFQ 관리', factories: '제조사 관리',
  quotes: '견적 관리', contracts: '계약 관리', inquiries: '문의 관리', partners: '파트너 관리',
  partnerApplications: '파트너 신청', partnerKpi: '파트너 KPI', partnerCutover: '파트너 SSO 컷오버',
  settlements: '정산 관리', templates: '템플릿 관리', sla: 'SLA 모니터링', manufacturingKpi: '제조 KPI',
  releases: '릴리즈 관리', jobs: 'Job Queue', funnel: '깔때기', costOvershoot: 'AI 비용', aiUsage: 'AI 시계열',
  promptStats: 'Prompt 통계', promptCompare: 'Prompt 비교', promptCompareHistory: 'Prompt 비교 기록',
  disabledVariants: 'Variant Kill Switch', emailLogs: '이메일 로그', auditLegacy: '감사 로그 (legacy)',
  auditActions: '감사 로그 (admin actions)', webhooks: '웹훅 이벤트', search: '검색', logs: '로그',
  concierge: 'Concierge 매칭', antiPoach: '거래우회 감시', apiHealth: '🔌 API Health', cadWorkers: 'CAD Workers',
  cadReview: 'CAD Review', settings: '🔐 Settings', accessEmails: '관리자 이메일', security: '보안',
};

const enNav: Record<NavKey, string> = {
  dashboard: 'Dashboard', users: 'Users', subscriptions: 'Subscriptions', billing: 'Billing',
  refundQueue: 'Refund queue', analytics: 'Revenue analytics', rfq: 'RFQ', factories: 'Manufacturers',
  quotes: 'Quotes', contracts: 'Contracts', inquiries: 'Inquiries', partners: 'Partners',
  partnerApplications: 'Partner applications', partnerKpi: 'Partner KPI', partnerCutover: 'Partner SSO cutover',
  settlements: 'Settlements', templates: 'Templates', sla: 'SLA monitoring', manufacturingKpi: 'Manufacturing KPI',
  releases: 'Releases', jobs: 'Job Queue', funnel: 'Funnel', costOvershoot: 'AI cost', aiUsage: 'AI time series',
  promptStats: 'Prompt stats', promptCompare: 'Prompt comparison', promptCompareHistory: 'Prompt history',
  disabledVariants: 'Variant Kill Switch', emailLogs: 'Email logs', auditLegacy: 'Audit log (legacy)',
  auditActions: 'Audit log (admin actions)', webhooks: 'Webhook events', search: 'Search', logs: 'Logs',
  concierge: 'Concierge matching', antiPoach: 'Transaction bypass watch', apiHealth: '🔌 API Health', cadWorkers: 'CAD Workers',
  cadReview: 'CAD Review', settings: '🔐 Settings', accessEmails: 'Admin emails', security: 'Security',
};

const overrides: Partial<Record<AdminLocale, Partial<AdminCopy>>> = {
  ja: { language: '言語', languageLabel: '日本語', admin: '管理', partnerPortal: 'パートナーポータル', site: 'サイトへ', emailLabel: '管理者メール', codeLabel: 'メール認証コード', login: '管理者ログイン', logout: 'ログアウト', usersTitle: 'ユーザー管理', usersExport: 'CSVを書き出す', refresh: '更新', accessTitle: '管理者メール', accessDescription: '許可されたメールのみワンタイムコードを要求できます。', accessAdd: '許可メールを追加', accessList: '許可リスト', securityTitle: 'セキュリティ監視', securityDescription: 'ログイン異常の検知とセキュリティ通知', securityAlerts: 'セキュリティ通知', loginHistory: 'ログイン履歴', pageTitles: { subscriptions: 'サブスクリプション管理', billing: '請求管理', refundQueue: '返金キュー', rfq: 'RFQ管理', quotes: '見積管理', factories: 'メーカー管理', contracts: '契約管理' }, nav: { ...enNav, dashboard: 'ダッシュボード', users: 'ユーザー管理', subscriptions: 'サブスクリプション', billing: '請求管理', security: 'セキュリティ' } },
  zh: { language: '语言', languageLabel: '中文', admin: '管理', partnerPortal: '合作伙伴门户', site: '返回网站', emailLabel: '管理员邮箱', codeLabel: '邮箱验证码', login: '管理员登录', logout: '退出登录', usersTitle: '用户管理', usersExport: '导出 CSV', refresh: '刷新', accessTitle: '管理员邮箱', accessDescription: '只有获准的邮箱可以请求一次性验证码。', accessAdd: '添加允许的邮箱', accessList: '允许列表', securityTitle: '安全监控', securityDescription: '登录异常检测和安全提醒', securityAlerts: '安全提醒', loginHistory: '登录历史', pageTitles: { subscriptions: '订阅管理', billing: '账单管理', refundQueue: '退款队列', rfq: 'RFQ管理', quotes: '报价管理', factories: '制造商管理', contracts: '合同管理' }, nav: { ...enNav, dashboard: '仪表盘', users: '用户管理', subscriptions: '订阅管理', billing: '账单管理', security: '安全' } },
  es: { language: 'Idioma', languageLabel: 'Español', admin: 'Administración', partnerPortal: 'Portal de socios', site: 'Ir al sitio', emailLabel: 'Correo del administrador', codeLabel: 'Código de verificación', login: 'Iniciar sesión de administrador', logout: 'Cerrar sesión', usersTitle: 'Gestión de usuarios', usersExport: 'Exportar CSV', refresh: 'Actualizar', accessTitle: 'Correos de administradores', accessDescription: 'Solo los correos permitidos pueden solicitar un código de un solo uso.', accessAdd: 'Añadir correo permitido', accessList: 'Lista permitida', securityTitle: 'Monitorización de seguridad', securityDescription: 'Detección de anomalías de inicio de sesión y alertas', securityAlerts: 'Alertas de seguridad', loginHistory: 'Historial de inicios de sesión', pageTitles: { subscriptions: 'Gestión de suscripciones', billing: 'Gestión de facturación', refundQueue: 'Cola de reembolsos', rfq: 'Gestión de RFQ', quotes: 'Gestión de cotizaciones', factories: 'Gestión de fabricantes', contracts: 'Gestión de contratos' }, nav: { ...enNav, dashboard: 'Panel', users: 'Usuarios', subscriptions: 'Suscripciones', billing: 'Facturación', security: 'Seguridad' } },
  ar: { language: 'اللغة', languageLabel: 'العربية', admin: 'الإدارة', partnerPortal: 'بوابة الشركاء', site: 'إلى الموقع', emailLabel: 'بريد المسؤول', codeLabel: 'رمز التحقق بالبريد', login: 'تسجيل دخول المسؤول', logout: 'تسجيل الخروج', usersTitle: 'إدارة المستخدمين', usersExport: 'تصدير CSV', refresh: 'تحديث', accessTitle: 'بريد المسؤولين', accessDescription: 'يمكن للبريد المسموح فقط طلب رمز لمرة واحدة.', accessAdd: 'إضافة بريد مسموح', accessList: 'القائمة المسموحة', securityTitle: 'مراقبة الأمان', securityDescription: 'اكتشاف محاولات الدخول غير المعتادة والتنبيهات الأمنية', securityAlerts: 'التنبيهات الأمنية', loginHistory: 'سجل تسجيل الدخول', pageTitles: { subscriptions: 'إدارة الاشتراكات', billing: 'إدارة الفوترة', refundQueue: 'قائمة المبالغ المستردة', rfq: 'إدارة RFQ', quotes: 'إدارة عروض الأسعار', factories: 'إدارة المصنّعين', contracts: 'إدارة العقود' }, nav: { ...enNav, dashboard: 'لوحة التحكم', users: 'إدارة المستخدمين', subscriptions: 'الاشتراكات', billing: 'الفوترة', security: 'الأمان' } },
};

const base: AdminCopy = {
  language: 'Language', languageLabel: 'English', admin: 'Admin', partnerPortal: 'Partner portal', site: 'Go to site',
  emailLabel: 'Admin email', emailPlaceholder: 'name@example.com', codeLabel: 'Email verification code', codePlaceholder: '000000', usersTitle: 'User management', usersExport: 'Export CSV', refresh: 'Refresh', accessTitle: 'Admin emails', accessDescription: 'Only allowed emails can request a one-time code for the administrator console.', accessAdd: 'Add allowed email', accessList: 'Allowed emails', securityTitle: 'Security monitoring', securityDescription: 'Login anomaly detection and security alerts', securityAlerts: 'Security alerts', loginHistory: 'Login history', pageTitles: { subscriptions: 'Subscription management', billing: 'Billing management', refundQueue: 'Refund queue', rfq: 'RFQ management', quotes: 'Quote management', factories: 'Manufacturer management', contracts: 'Contract management', aiUsage: 'AI usage timeseries', costOvershoot: 'AI cost overshoot', apiHealth: 'API health', promptStats: 'Prompt statistics', promptCompare: 'Prompt comparison', promptHistory: 'Prompt comparison history', providerChain: 'AI provider chain', partners: 'Partner management', partnerApplications: 'Partner applications', partnerKpi: 'Partner KPI', settlements: 'Settlements', sla: 'SLA monitoring', releases: 'Release management', templates: 'Template management' },
  loginDescription: 'Request a one-time code using an allowed administrator email.', codeSent: 'A 6-digit verification code was sent to',
  requestCode: 'Request code', resendCode: 'Request again', changeEmail: 'Change email', login: 'Admin login', loggingIn: 'Verifying…', loggingOut: 'Signing out…', logout: 'Sign out', nav: enNav,
};

const ko: AdminCopy = { ...base, language: '언어', languageLabel: '한국어', admin: '관리자', partnerPortal: '파트너 포털', site: '사이트로', emailLabel: '관리자 이메일', codeLabel: '이메일 인증 코드', loginDescription: '허용된 관리자 이메일로 일회용 인증 코드를 받아 로그인합니다.', codeSent: '로 보낸 6자리 코드를 입력하세요.', requestCode: '인증 코드 요청', resendCode: '코드 다시 요청', changeEmail: '이메일 변경', login: '관리자 로그인', loggingIn: '확인 중…', loggingOut: '종료 중…', logout: '로그아웃', usersTitle: '회원 관리', usersExport: 'CSV 내보내기', refresh: '새로고침', accessTitle: '관리자 이메일', accessDescription: '허용된 이메일만 일회용 인증 코드를 요청하고 관리자 콘솔에 로그인할 수 있습니다.', accessAdd: '허용 이메일 추가', accessList: '허용 목록', securityTitle: '보안 모니터링', securityDescription: '로그인 이상 탐지 및 보안 알림', securityAlerts: '보안 알림', loginHistory: '로그인 이력', pageTitles: { subscriptions: '구독 관리', billing: '청구 관리', refundQueue: '환불 큐', rfq: 'RFQ 관리', quotes: '견적 관리', factories: '제조사 관리', contracts: '계약 관리', aiUsage: 'AI 사용량 시계열', costOvershoot: 'AI 비용 초과', apiHealth: 'API 상태', promptStats: '프롬프트 통계', promptCompare: '프롬프트 비교', promptHistory: '프롬프트 비교 기록', providerChain: 'AI Provider 체인', partners: '파트너 관리', partnerApplications: '파트너 신청', partnerKpi: '파트너 KPI', settlements: '정산 관리', sla: 'SLA 모니터링', releases: '릴리즈 관리', templates: '템플릿 관리' }, nav: koNav };

export const ADMIN_COPY: Record<AdminLocale, AdminCopy> = {
  ko,
  en: base,
  ja: { ...base, ...overrides.ja },
  zh: { ...base, ...overrides.zh },
  es: { ...base, ...overrides.es },
  ar: { ...base, ...overrides.ar },
};

export function resolveAdminLocale(value?: string | null): AdminLocale {
  if (value === 'kr' || value === 'ko') return 'ko';
  if (value === 'cn' || value === 'zh') return 'zh';
  if (value === 'en' || value === 'ja' || value === 'es' || value === 'ar') return value;
  return 'ko';
}

export function adminCopy(locale: AdminLocale): AdminCopy { return ADMIN_COPY[locale]; }
export const ADMIN_NAV_KEYS = NAV_KEYS;
