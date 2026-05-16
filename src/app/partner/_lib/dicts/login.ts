// Login page dictionary. Per-page split keeps the shared partnerDict
// nav-only and makes per-page i18n PRs easier to review.

import type { PartnerLang } from '../partnerLang';

export interface LoginDict {
  pageTitle: string;
  pageSubtitle: string;
  emailLabel: string;
  emailPlaceholder: string;
  codeLabel: string;
  codePlaceholder: string;
  submit: string;
  submitting: string;
  noCode: string;
  contactStaff: string;
  noAccount: string;
  applyAsPartner: string;
  errLogin: string;
  errServer: string;
  ssoCardKicker: string;
  ssoCardBtn: string;
  ssoCardHint: string;
  legacyHint: string;
  demoKicker: string;
  demoBtn: string;
  demoNote: string;
  inquiryLine: string;
  unifiedLoginPrefix: string;
  unifiedLoginLink: string;
  unifiedLoginSuffix: string;
}

const KO: LoginDict = {
  pageTitle: '파트너 포털',
  pageSubtitle: '파트너 전용 관리 포털입니다',
  emailLabel: '이메일 주소',
  emailPlaceholder: 'partner@example.com',
  codeLabel: '액세스 코드 (6자리)',
  codePlaceholder: '123456',
  submit: '로그인',
  submitting: '로그인 중...',
  noCode: '코드가 없으신가요?',
  contactStaff: '담당자에게 문의하세요.',
  noAccount: '아직 파트너가 아니신가요?',
  applyAsPartner: '파트너 신청하기 →',
  errLogin: '로그인에 실패했습니다.',
  errServer: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  ssoCardKicker: '권장 로그인 · NexySys 통합 계정',
  ssoCardBtn: 'NexySys 계정으로 로그인',
  ssoCardHint: '고객사 SaaS와 동일 계정으로 로그인합니다. 별도 액세스 코드가 필요 없습니다.',
  legacyHint: '기존 액세스 코드 로그인 (점진 폐지 중)',
  demoKicker: '파트너 포털 체험',
  demoBtn: '🔧 파트너사 데모로 체험하기',
  demoNote: '데모 계정은 읽기 전용이며 실제 데이터에 영향을 주지 않습니다.',
  inquiryLine: '파트너 등록 문의:',
  unifiedLoginPrefix: '',
  unifiedLoginLink: 'Nexysys 통합 로그인',
  unifiedLoginSuffix: '으로 돌아가기',
};

const EN: LoginDict = {
  pageTitle: 'Partner Portal',
  pageSubtitle: 'Management portal for NexyFab partners',
  emailLabel: 'Email address',
  emailPlaceholder: 'partner@example.com',
  codeLabel: 'Access code (6 digits)',
  codePlaceholder: '123456',
  submit: 'Log in',
  submitting: 'Logging in…',
  noCode: "Don't have a code?",
  contactStaff: 'Contact your account manager.',
  noAccount: 'Not a partner yet?',
  applyAsPartner: 'Apply as a partner →',
  errLogin: 'Login failed.',
  errServer: 'Server error. Please try again in a moment.',
  ssoCardKicker: 'Recommended · NexySys unified account',
  ssoCardBtn: 'Log in with NexySys',
  ssoCardHint: 'Use the same account as the customer SaaS. No access code required.',
  legacyHint: 'Legacy access-code login (being phased out)',
  demoKicker: 'Try the partner portal',
  demoBtn: '🔧 Explore as a demo partner',
  demoNote: 'The demo account is read-only and does not affect real data.',
  inquiryLine: 'Partner inquiries:',
  unifiedLoginPrefix: 'Back to ',
  unifiedLoginLink: 'NexySys unified login',
  unifiedLoginSuffix: '',
};

const JA: LoginDict = {
  pageTitle: 'パートナーポータル',
  pageSubtitle: 'NexyFab パートナー専用管理ポータル',
  emailLabel: 'メールアドレス',
  emailPlaceholder: 'partner@example.com',
  codeLabel: 'アクセスコード (6桁)',
  codePlaceholder: '123456',
  submit: 'ログイン',
  submitting: 'ログイン中…',
  noCode: 'コードがありませんか？',
  contactStaff: '担当者までお問い合わせください。',
  noAccount: 'まだパートナーではありませんか？',
  applyAsPartner: 'パートナー申請する →',
  errLogin: 'ログインに失敗しました。',
  errServer: 'サーバーエラーが発生しました。しばらくしてから再度お試しください。',
  ssoCardKicker: '推奨ログイン · NexySys 統合アカウント',
  ssoCardBtn: 'NexySys アカウントでログイン',
  ssoCardHint: '顧客サイトと同じアカウントでログインします。アクセスコードは不要です。',
  legacyHint: '従来のアクセスコードログイン (段階的に廃止)',
  demoKicker: 'パートナーポータル体験',
  demoBtn: '🔧 デモパートナーとして試す',
  demoNote: 'デモアカウントは読み取り専用で、実データには影響しません。',
  inquiryLine: 'パートナー登録のお問い合わせ:',
  unifiedLoginPrefix: '',
  unifiedLoginLink: 'NexySys 統合ログイン',
  unifiedLoginSuffix: ' に戻る',
};

const CN: LoginDict = {
  pageTitle: '合作伙伴门户',
  pageSubtitle: 'NexyFab 合作伙伴专用管理门户',
  emailLabel: '电子邮箱',
  emailPlaceholder: 'partner@example.com',
  codeLabel: '访问码（6位）',
  codePlaceholder: '123456',
  submit: '登录',
  submitting: '登录中…',
  noCode: '没有访问码？',
  contactStaff: '请联系您的客户经理。',
  noAccount: '尚未成为合作伙伴？',
  applyAsPartner: '申请成为合作伙伴 →',
  errLogin: '登录失败。',
  errServer: '服务器错误，请稍后重试。',
  ssoCardKicker: '推荐登录 · NexySys 统一账户',
  ssoCardBtn: '使用 NexySys 账户登录',
  ssoCardHint: '使用与客户站点相同的账户登录。无需访问码。',
  legacyHint: '旧版访问码登录（即将停用）',
  demoKicker: '体验合作伙伴门户',
  demoBtn: '🔧 以演示合作伙伴身份体验',
  demoNote: '演示账户为只读，不会影响真实数据。',
  inquiryLine: '合作伙伴注册咨询:',
  unifiedLoginPrefix: '返回 ',
  unifiedLoginLink: 'NexySys 统一登录',
  unifiedLoginSuffix: '',
};

const ES: LoginDict = {
  pageTitle: 'Portal de socios',
  pageSubtitle: 'Portal de gestión exclusivo para socios de NexyFab',
  emailLabel: 'Correo electrónico',
  emailPlaceholder: 'partner@example.com',
  codeLabel: 'Código de acceso (6 dígitos)',
  codePlaceholder: '123456',
  submit: 'Iniciar sesión',
  submitting: 'Iniciando sesión…',
  noCode: '¿No tienes un código?',
  contactStaff: 'Contacta a tu responsable de cuenta.',
  noAccount: '¿Aún no eres socio?',
  applyAsPartner: 'Solicitar ser socio →',
  errLogin: 'Error al iniciar sesión.',
  errServer: 'Error del servidor. Inténtalo de nuevo en un momento.',
  ssoCardKicker: 'Recomendado · Cuenta unificada NexySys',
  ssoCardBtn: 'Iniciar sesión con NexySys',
  ssoCardHint: 'Usa la misma cuenta que el SaaS de clientes. Sin código de acceso.',
  legacyHint: 'Inicio de sesión heredado (en desuso)',
  demoKicker: 'Prueba el portal de socios',
  demoBtn: '🔧 Explorar como socio demo',
  demoNote: 'La cuenta demo es de solo lectura y no afecta a datos reales.',
  inquiryLine: 'Consultas para socios:',
  unifiedLoginPrefix: 'Volver a ',
  unifiedLoginLink: 'inicio de sesión unificado de NexySys',
  unifiedLoginSuffix: '',
};

const AR: LoginDict = {
  pageTitle: 'بوابة الشركاء',
  pageSubtitle: 'بوابة الإدارة المخصصة لشركاء NexyFab',
  emailLabel: 'البريد الإلكتروني',
  emailPlaceholder: 'partner@example.com',
  codeLabel: 'رمز الوصول (6 أرقام)',
  codePlaceholder: '123456',
  submit: 'تسجيل الدخول',
  submitting: 'جارٍ تسجيل الدخول…',
  noCode: 'ليس لديك رمز؟',
  contactStaff: 'يرجى التواصل مع مدير حسابك.',
  noAccount: 'لست شريكًا بعد؟',
  applyAsPartner: 'التقديم كشريك →',
  errLogin: 'فشل تسجيل الدخول.',
  errServer: 'خطأ في الخادم. يرجى المحاولة بعد قليل.',
  ssoCardKicker: 'الموصى به · حساب NexySys الموحد',
  ssoCardBtn: 'تسجيل الدخول عبر NexySys',
  ssoCardHint: 'استخدم نفس حساب موقع العملاء. لا حاجة لرمز وصول.',
  legacyHint: 'تسجيل الدخول القديم برمز الوصول (قيد الإيقاف)',
  demoKicker: 'تجربة بوابة الشركاء',
  demoBtn: '🔧 التجربة كشريك تجريبي',
  demoNote: 'الحساب التجريبي للقراءة فقط ولا يؤثر على البيانات الفعلية.',
  inquiryLine: 'استفسارات الشراكة:',
  unifiedLoginPrefix: 'العودة إلى ',
  unifiedLoginLink: 'تسجيل الدخول الموحد لـ NexySys',
  unifiedLoginSuffix: '',
};

export function loginDict(lang: PartnerLang): LoginDict {
  switch (lang) {
    case 'ko': return KO;
    case 'en': return EN;
    case 'ja': return JA;
    case 'cn': return CN;
    case 'es': return ES;
    case 'ar': return AR;
    default:   return EN;
  }
}
