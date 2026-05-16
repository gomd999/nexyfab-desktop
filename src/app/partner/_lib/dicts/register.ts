// Partner application form (multi-step register page) dictionary.
// Form-internal validation messages and field hints stay KR-canonical
// for now — the catalog options (PROCESS_OPTIONS, INDUSTRY_OPTIONS, …)
// reference Korean industry vocabulary and will be migrated together.

import type { PartnerLang } from '../partnerLang';

export interface RegisterDict {
  pageBack: string;
  pageTitle: string;
  pageSubtitle: string;
  stepCounter: (cur: number, total: number) => string;
  step1Label: string;
  step2Label: string;
  step3Label: string;
  step4Label: string;
  btnBack: string;
  btnNext: string;
  btnSubmit: string;
  btnSubmitting: string;
  submitErrorTitle: string;
  successHeading: string;
  successBody: (email: string) => string;
  successBackToLogin: string;
  haveAccountPrefix: string;
  haveAccountLink: string;
}

const KO: RegisterDict = {
  pageBack: '← 돌아가기',
  pageTitle: '파트너 신청',
  pageSubtitle: '제조 파트너로 NexyFab 에 입점하기',
  stepCounter: (c, total) => `${c} / ${total}`,
  step1Label: '회사 정보',
  step2Label: '담당자 정보',
  step3Label: '제조 역량',
  step4Label: '포트폴리오/소개',
  btnBack: '이전',
  btnNext: '다음',
  btnSubmit: '신청서 제출',
  btnSubmitting: '제출 중...',
  submitErrorTitle: '제출 오류',
  successHeading: '신청이 접수되었습니다',
  successBody: (email) => `영업일 기준 2-3일 내 검토 후 안내드립니다.\n담당자 이메일(${email})로 결과를 보내드립니다.`,
  successBackToLogin: '파트너 로그인으로 돌아가기',
  haveAccountPrefix: '이미 계정이 있으신가요?',
  haveAccountLink: '파트너 로그인',
};

const EN: RegisterDict = {
  pageBack: '← Back',
  pageTitle: 'Partner application',
  pageSubtitle: 'Apply to onboard with NexyFab as a manufacturing partner.',
  stepCounter: (c, total) => `${c} / ${total}`,
  step1Label: 'Company',
  step2Label: 'Contact',
  step3Label: 'Capability',
  step4Label: 'Portfolio / Bio',
  btnBack: 'Back',
  btnNext: 'Next',
  btnSubmit: 'Submit application',
  btnSubmitting: 'Submitting…',
  submitErrorTitle: 'Submission error',
  successHeading: 'Application received',
  successBody: (email) => `We will review within 2-3 business days and reply to ${email}.`,
  successBackToLogin: 'Back to partner login',
  haveAccountPrefix: 'Already have an account?',
  haveAccountLink: 'Partner login',
};

const JA: RegisterDict = {
  pageBack: '← 戻る',
  pageTitle: 'パートナー申請',
  pageSubtitle: '製造パートナーとして NexyFab に申請する',
  stepCounter: (c, total) => `${c} / ${total}`,
  step1Label: '会社情報',
  step2Label: '担当者情報',
  step3Label: '製造能力',
  step4Label: 'ポートフォリオ・紹介',
  btnBack: '戻る',
  btnNext: '次へ',
  btnSubmit: '申請書を送信',
  btnSubmitting: '送信中…',
  submitErrorTitle: '送信エラー',
  successHeading: '申請を受領しました',
  successBody: (email) => `営業日 2-3 日以内に審査し、${email} に結果をお送りします。`,
  successBackToLogin: 'パートナーログインに戻る',
  haveAccountPrefix: 'すでにアカウントをお持ちですか？',
  haveAccountLink: 'パートナーログイン',
};

const CN: RegisterDict = {
  pageBack: '← 返回',
  pageTitle: '合作伙伴申请',
  pageSubtitle: '作为制造合作伙伴申请入驻 NexyFab。',
  stepCounter: (c, total) => `${c} / ${total}`,
  step1Label: '公司信息',
  step2Label: '联系人信息',
  step3Label: '制造能力',
  step4Label: '作品集 / 简介',
  btnBack: '上一步',
  btnNext: '下一步',
  btnSubmit: '提交申请',
  btnSubmitting: '提交中…',
  submitErrorTitle: '提交错误',
  successHeading: '申请已收到',
  successBody: (email) => `我们将在 2-3 个工作日内审核，并将结果发送至 ${email}。`,
  successBackToLogin: '返回合作伙伴登录',
  haveAccountPrefix: '已有账户？',
  haveAccountLink: '合作伙伴登录',
};

const ES: RegisterDict = {
  pageBack: '← Volver',
  pageTitle: 'Solicitud de socio',
  pageSubtitle: 'Solicita unirte a NexyFab como socio de manufactura.',
  stepCounter: (c, total) => `${c} / ${total}`,
  step1Label: 'Empresa',
  step2Label: 'Contacto',
  step3Label: 'Capacidades',
  step4Label: 'Portafolio / Bio',
  btnBack: 'Atrás',
  btnNext: 'Siguiente',
  btnSubmit: 'Enviar solicitud',
  btnSubmitting: 'Enviando…',
  submitErrorTitle: 'Error al enviar',
  successHeading: 'Solicitud recibida',
  successBody: (email) => `Revisaremos en 2-3 días hábiles y enviaremos el resultado a ${email}.`,
  successBackToLogin: 'Volver al inicio de sesión',
  haveAccountPrefix: '¿Ya tienes cuenta?',
  haveAccountLink: 'Inicio de sesión',
};

const AR: RegisterDict = {
  pageBack: '← الرجوع',
  pageTitle: 'طلب شراكة',
  pageSubtitle: 'قدّم طلبًا للانضمام إلى NexyFab كشريك تصنيع.',
  stepCounter: (c, total) => `${c} / ${total}`,
  step1Label: 'الشركة',
  step2Label: 'جهة الاتصال',
  step3Label: 'القدرات',
  step4Label: 'المعرض / النبذة',
  btnBack: 'السابق',
  btnNext: 'التالي',
  btnSubmit: 'إرسال الطلب',
  btnSubmitting: 'جارٍ الإرسال…',
  submitErrorTitle: 'خطأ في الإرسال',
  successHeading: 'تم استلام الطلب',
  successBody: (email) => `سنراجعه خلال 2-3 أيام عمل ونرسل النتيجة إلى ${email}.`,
  successBackToLogin: 'العودة إلى تسجيل دخول الشركاء',
  haveAccountPrefix: 'لديك حساب بالفعل؟',
  haveAccountLink: 'تسجيل دخول الشركاء',
};

export function registerDict(lang: PartnerLang): RegisterDict {
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
