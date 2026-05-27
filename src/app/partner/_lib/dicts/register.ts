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

  selectPlaceholder: string;
  yearSuffix: string;
  employeeSuffix: string;

  // Step 1
  step1FieldCompanyName: string;
  step1PhCompanyName: string;
  step1FieldBizNumber: string;
  step1FieldCeoName: string;
  step1PhCeoName: string;
  step1FieldFoundedYear: string;
  step1FieldEmployeeCount: string;

  // Step 2
  step2FieldContactName: string;
  step2PhContactName: string;
  step2FieldContactEmail: string;
  step2FieldContactPhone: string;
  step2FieldContactTitle: string;
  step2PhContactTitle: string;

  // Step 3
  step3FieldProcesses: string;
  step3FieldCerts: string;
  step3FieldMonthlyCapacity: string;
  step3FieldIndustries: string;

  // Step 4
  step4FieldBio: string;
  step4PhBio: string;
  step4FieldHomepage: string;
  step4PortfolioTitle: string;
  step4PortfolioHint: string;

  // Validation
  errCompanyName: string;
  errBizNumber: string;
  errBizNumberFormat: string;
  errCeoName: string;
  errFoundedYear: string;
  errEmployeeCount: string;
  errContactName: string;
  errContactEmail: string;
  errContactEmailFormat: string;
  errContactPhone: string;
  errProcesses: string;
  errMonthlyCapacity: string;
  errIndustries: string;
  errSubmitGeneric: string;
  errServer: string;
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

  selectPlaceholder: '선택',
  yearSuffix: '년',
  employeeSuffix: '명',

  step1FieldCompanyName: '회사명',
  step1PhCompanyName: '주식회사 예시',
  step1FieldBizNumber: '사업자등록번호',
  step1FieldCeoName: '대표자명',
  step1PhCeoName: '홍길동',
  step1FieldFoundedYear: '설립연도',
  step1FieldEmployeeCount: '직원 수',

  step2FieldContactName: '담당자명',
  step2PhContactName: '김담당',
  step2FieldContactEmail: '이메일',
  step2FieldContactPhone: '전화번호',
  step2FieldContactTitle: '직책/부서',
  step2PhContactTitle: '영업팀 팀장',

  step3FieldProcesses: '주요 공정',
  step3FieldCerts: '보유 인증',
  step3FieldMonthlyCapacity: '월 생산 능력',
  step3FieldIndustries: '주요 납품 산업',

  step4FieldBio: '회사 소개',
  step4PhBio: '회사의 주요 역량, 납품 실적, 특장점 등을 자유롭게 소개해 주세요.',
  step4FieldHomepage: '홈페이지 URL',
  step4PortfolioTitle: '포트폴리오 첨부',
  step4PortfolioHint: '승인 후 파트너 포털에서 포트폴리오를 등록하실 수 있습니다.',

  errCompanyName: '회사명을 입력해 주세요.',
  errBizNumber: '사업자등록번호를 입력해 주세요.',
  errBizNumberFormat: '올바른 형식으로 입력해 주세요 (예: 123-45-67890)',
  errCeoName: '대표자명을 입력해 주세요.',
  errFoundedYear: '설립연도를 선택해 주세요.',
  errEmployeeCount: '직원 수를 선택해 주세요.',
  errContactName: '담당자명을 입력해 주세요.',
  errContactEmail: '이메일을 입력해 주세요.',
  errContactEmailFormat: '올바른 이메일을 입력해 주세요.',
  errContactPhone: '전화번호를 입력해 주세요.',
  errProcesses: '주요 공정을 1개 이상 선택해 주세요.',
  errMonthlyCapacity: '월 생산 능력을 선택해 주세요.',
  errIndustries: '주요 납품 산업을 1개 이상 선택해 주세요.',
  errSubmitGeneric: '제출에 실패했습니다. 다시 시도해 주세요.',
  errServer: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
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

  selectPlaceholder: 'Select',
  yearSuffix: '',
  employeeSuffix: '',

  step1FieldCompanyName: 'Company name',
  step1PhCompanyName: 'e.g. Example Co., Ltd',
  step1FieldBizNumber: 'Business registration #',
  step1FieldCeoName: 'CEO name',
  step1PhCeoName: 'Jane Doe',
  step1FieldFoundedYear: 'Founded',
  step1FieldEmployeeCount: 'Employees',

  step2FieldContactName: 'Contact name',
  step2PhContactName: 'Sam Park',
  step2FieldContactEmail: 'Email',
  step2FieldContactPhone: 'Phone',
  step2FieldContactTitle: 'Role / Team',
  step2PhContactTitle: 'Sales Team Lead',

  step3FieldProcesses: 'Key processes',
  step3FieldCerts: 'Certifications',
  step3FieldMonthlyCapacity: 'Monthly capacity',
  step3FieldIndustries: 'Industries served',

  step4FieldBio: 'About the company',
  step4PhBio: 'Briefly describe your capabilities, track record and strengths.',
  step4FieldHomepage: 'Website URL',
  step4PortfolioTitle: 'Portfolio upload',
  step4PortfolioHint: 'You can upload portfolio items in the partner portal after approval.',

  errCompanyName: 'Please enter the company name.',
  errBizNumber: 'Please enter the business registration number.',
  errBizNumberFormat: 'Use the correct format (e.g. 123-45-67890)',
  errCeoName: 'Please enter the CEO name.',
  errFoundedYear: 'Please select the founding year.',
  errEmployeeCount: 'Please select the employee count.',
  errContactName: 'Please enter the contact name.',
  errContactEmail: 'Please enter the email address.',
  errContactEmailFormat: 'Please enter a valid email.',
  errContactPhone: 'Please enter the phone number.',
  errProcesses: 'Please select at least one process.',
  errMonthlyCapacity: 'Please select the monthly capacity.',
  errIndustries: 'Please select at least one industry.',
  errSubmitGeneric: 'Submission failed. Please try again.',
  errServer: 'Server error. Please try again in a moment.',
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

  selectPlaceholder: '選択',
  yearSuffix: '年',
  employeeSuffix: '名',

  step1FieldCompanyName: '会社名',
  step1PhCompanyName: '例: 株式会社サンプル',
  step1FieldBizNumber: '事業者登録番号',
  step1FieldCeoName: '代表者名',
  step1PhCeoName: '山田 太郎',
  step1FieldFoundedYear: '設立年',
  step1FieldEmployeeCount: '従業員数',

  step2FieldContactName: '担当者名',
  step2PhContactName: '田中 様',
  step2FieldContactEmail: 'メール',
  step2FieldContactPhone: '電話番号',
  step2FieldContactTitle: '役職/部署',
  step2PhContactTitle: '営業部 課長',

  step3FieldProcesses: '主要工程',
  step3FieldCerts: '保有認証',
  step3FieldMonthlyCapacity: '月間生産能力',
  step3FieldIndustries: '主要納入産業',

  step4FieldBio: '会社紹介',
  step4PhBio: '会社の主要能力、納入実績、強みなどをご紹介ください。',
  step4FieldHomepage: 'ホームページ URL',
  step4PortfolioTitle: 'ポートフォリオ添付',
  step4PortfolioHint: '承認後、パートナーポータルでポートフォリオを登録できます。',

  errCompanyName: '会社名を入力してください。',
  errBizNumber: '事業者登録番号を入力してください。',
  errBizNumberFormat: '正しい形式で入力してください (例: 123-45-67890)',
  errCeoName: '代表者名を入力してください。',
  errFoundedYear: '設立年を選択してください。',
  errEmployeeCount: '従業員数を選択してください。',
  errContactName: '担当者名を入力してください。',
  errContactEmail: 'メールアドレスを入力してください。',
  errContactEmailFormat: '正しいメールアドレスを入力してください。',
  errContactPhone: '電話番号を入力してください。',
  errProcesses: '主要工程を 1 つ以上選択してください。',
  errMonthlyCapacity: '月間生産能力を選択してください。',
  errIndustries: '主要納入産業を 1 つ以上選択してください。',
  errSubmitGeneric: '送信に失敗しました。もう一度お試しください。',
  errServer: 'サーバーエラーが発生しました。しばらくしてから再度お試しください。',
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

  selectPlaceholder: '请选择',
  yearSuffix: '年',
  employeeSuffix: '人',

  step1FieldCompanyName: '公司名称',
  step1PhCompanyName: '例如：示例有限公司',
  step1FieldBizNumber: '营业执照号',
  step1FieldCeoName: '法人代表',
  step1PhCeoName: '王伟',
  step1FieldFoundedYear: '成立年份',
  step1FieldEmployeeCount: '员工人数',

  step2FieldContactName: '联系人',
  step2PhContactName: '李先生',
  step2FieldContactEmail: '邮箱',
  step2FieldContactPhone: '电话',
  step2FieldContactTitle: '职位/部门',
  step2PhContactTitle: '销售部 经理',

  step3FieldProcesses: '主要工艺',
  step3FieldCerts: '认证',
  step3FieldMonthlyCapacity: '月产能',
  step3FieldIndustries: '主要服务行业',

  step4FieldBio: '公司简介',
  step4PhBio: '请简要介绍公司的核心能力、业绩与优势。',
  step4FieldHomepage: '官网 URL',
  step4PortfolioTitle: '作品集附件',
  step4PortfolioHint: '审核通过后可在合作伙伴门户上传作品集。',

  errCompanyName: '请输入公司名称。',
  errBizNumber: '请输入营业执照号。',
  errBizNumberFormat: '请按正确格式输入 (例如：123-45-67890)',
  errCeoName: '请输入法人姓名。',
  errFoundedYear: '请选择成立年份。',
  errEmployeeCount: '请选择员工人数。',
  errContactName: '请输入联系人姓名。',
  errContactEmail: '请输入邮箱。',
  errContactEmailFormat: '请输入有效邮箱。',
  errContactPhone: '请输入电话号码。',
  errProcesses: '请选择至少一项工艺。',
  errMonthlyCapacity: '请选择月产能。',
  errIndustries: '请选择至少一个行业。',
  errSubmitGeneric: '提交失败，请重试。',
  errServer: '服务器错误，请稍后重试。',
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

  selectPlaceholder: 'Seleccionar',
  yearSuffix: '',
  employeeSuffix: '',

  step1FieldCompanyName: 'Nombre de la empresa',
  step1PhCompanyName: 'p. ej. Empresa Ejemplo S.A.',
  step1FieldBizNumber: 'Nº de registro mercantil',
  step1FieldCeoName: 'Nombre del CEO',
  step1PhCeoName: 'María Pérez',
  step1FieldFoundedYear: 'Año de fundación',
  step1FieldEmployeeCount: 'Empleados',

  step2FieldContactName: 'Nombre del contacto',
  step2PhContactName: 'Carlos López',
  step2FieldContactEmail: 'Correo electrónico',
  step2FieldContactPhone: 'Teléfono',
  step2FieldContactTitle: 'Cargo / Departamento',
  step2PhContactTitle: 'Jefe Comercial',

  step3FieldProcesses: 'Procesos clave',
  step3FieldCerts: 'Certificaciones',
  step3FieldMonthlyCapacity: 'Capacidad mensual',
  step3FieldIndustries: 'Industrias servidas',

  step4FieldBio: 'Sobre la empresa',
  step4PhBio: 'Describe brevemente capacidades, historial y fortalezas.',
  step4FieldHomepage: 'Sitio web',
  step4PortfolioTitle: 'Subir portafolio',
  step4PortfolioHint: 'Podrás subir el portafolio en el portal de socios tras la aprobación.',

  errCompanyName: 'Introduce el nombre de la empresa.',
  errBizNumber: 'Introduce el número de registro mercantil.',
  errBizNumberFormat: 'Usa el formato correcto (p. ej. 123-45-67890)',
  errCeoName: 'Introduce el nombre del CEO.',
  errFoundedYear: 'Selecciona el año de fundación.',
  errEmployeeCount: 'Selecciona el número de empleados.',
  errContactName: 'Introduce el nombre del contacto.',
  errContactEmail: 'Introduce el correo electrónico.',
  errContactEmailFormat: 'Introduce un correo válido.',
  errContactPhone: 'Introduce el teléfono.',
  errProcesses: 'Selecciona al menos un proceso.',
  errMonthlyCapacity: 'Selecciona la capacidad mensual.',
  errIndustries: 'Selecciona al menos una industria.',
  errSubmitGeneric: 'Error al enviar. Inténtalo de nuevo.',
  errServer: 'Error del servidor. Inténtalo en un momento.',
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

  selectPlaceholder: 'اختر',
  yearSuffix: '',
  employeeSuffix: '',

  step1FieldCompanyName: 'اسم الشركة',
  step1PhCompanyName: 'مثال: شركة المثال المحدودة',
  step1FieldBizNumber: 'رقم السجل التجاري',
  step1FieldCeoName: 'اسم الرئيس التنفيذي',
  step1PhCeoName: 'محمد العلي',
  step1FieldFoundedYear: 'سنة التأسيس',
  step1FieldEmployeeCount: 'عدد الموظفين',

  step2FieldContactName: 'اسم جهة الاتصال',
  step2PhContactName: 'أحمد المهيري',
  step2FieldContactEmail: 'البريد الإلكتروني',
  step2FieldContactPhone: 'الهاتف',
  step2FieldContactTitle: 'المنصب/القسم',
  step2PhContactTitle: 'مدير المبيعات',

  step3FieldProcesses: 'العمليات الرئيسية',
  step3FieldCerts: 'الشهادات',
  step3FieldMonthlyCapacity: 'الطاقة الإنتاجية الشهرية',
  step3FieldIndustries: 'الصناعات المخدومة',

  step4FieldBio: 'عن الشركة',
  step4PhBio: 'صف باختصار القدرات والإنجازات ونقاط القوة.',
  step4FieldHomepage: 'رابط الموقع',
  step4PortfolioTitle: 'إرفاق المعرض',
  step4PortfolioHint: 'يمكنك رفع المعرض في بوابة الشركاء بعد الموافقة.',

  errCompanyName: 'يرجى إدخال اسم الشركة.',
  errBizNumber: 'يرجى إدخال رقم السجل التجاري.',
  errBizNumberFormat: 'يرجى الإدخال بالصيغة الصحيحة (مثال: 123-45-67890)',
  errCeoName: 'يرجى إدخال اسم الرئيس التنفيذي.',
  errFoundedYear: 'يرجى اختيار سنة التأسيس.',
  errEmployeeCount: 'يرجى اختيار عدد الموظفين.',
  errContactName: 'يرجى إدخال اسم جهة الاتصال.',
  errContactEmail: 'يرجى إدخال البريد الإلكتروني.',
  errContactEmailFormat: 'يرجى إدخال بريد إلكتروني صالح.',
  errContactPhone: 'يرجى إدخال رقم الهاتف.',
  errProcesses: 'يرجى اختيار عملية واحدة على الأقل.',
  errMonthlyCapacity: 'يرجى اختيار الطاقة الإنتاجية الشهرية.',
  errIndustries: 'يرجى اختيار صناعة واحدة على الأقل.',
  errSubmitGeneric: 'فشل الإرسال. يرجى المحاولة مرة أخرى.',
  errServer: 'خطأ في الخادم. يرجى المحاولة بعد قليل.',
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
