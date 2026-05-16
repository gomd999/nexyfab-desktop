// Public partner onboarding (magic-link) page dictionary.

import type { PartnerLang } from '../partnerLang';

export interface OnboardDict {
  title: string;
  subtitle: string;
  noToken: string;
  contactOps: string;
  loading: string;
  headerError: string;
  email: string;
  contactName: string;
  company: string;
  phone: string;
  bizRegNo: string;
  bizRegHint: string;
  password: string;
  needAgree: string;
  pwTooShort: string;
  agreeText: string;
  agreeShow: string;
  agreeHide: string;
  rule1Title: string;
  rule1Body: string;
  rule2Title: string;
  rule2Body: string;
  rule3Title: string;
  rule3Body: string;
  rule4Title: string;
  rule4Body: string;
  fullAgreement: string;
  submitting: string;
  submit: string;
  footer: string;
  inquiry: string;
}

const KO: OnboardDict = {
  title: 'NexyFab 파트너 가입',
  subtitle: '1분만에 가입 완료 — 견적 작성 즉시 가능',
  noToken: '초청 토큰이 없습니다.',
  contactOps: '운영팀에 다시 문의해주세요',
  loading: '로딩 중…',
  headerError: '파트너 가입',
  email: '회사 이메일 *',
  contactName: '담당자 이름 *',
  company: '회사명 *',
  phone: '담당자 번호 * (휴대폰 또는 회사 직통)',
  bizRegNo: '사업자 등록 번호 * (10자리)',
  bizRegHint: '국세청 등록 번호 — 가입 즉시 검증됩니다.',
  password: '비밀번호 * (10자 이상)',
  needAgree: '파트너 약관에 동의해주세요.',
  pwTooShort: '비밀번호는 10자 이상이어야 합니다.',
  agreeText: '에 동의합니다.',
  agreeShow: '전문 보기',
  agreeHide: '약관 접기',
  rule1Title: '거래 우회 금지',
  rule1Body: 'NexyFab 통해 알게 된 고객과 24개월간 직접 거래 금지 (위약금 거래액 50%)',
  rule2Title: '안전거래(에스크로)',
  rule2Body: '모든 거래는 NexyFab 플랫폼 결제 의무',
  rule3Title: 'NexyFab 수수료',
  rule3Body: '거래액의 8% (정산 시 자동 공제)',
  rule4Title: '분쟁',
  rule4Body: '1단계 자율 협의 → 2단계 NexyFab 중재 → 3단계 대한상사중재원',
  fullAgreement: '📄 파트너 약관 전문',
  submitting: '가입 중…',
  submit: '✓ 약관 동의 + 가입 완료',
  footer: '가입 후 견적 작성 페이지로 이동합니다.',
  inquiry: '문의',
};

const EN: OnboardDict = {
  title: 'NexyFab Partner Sign-Up',
  subtitle: 'One-minute onboarding — start quoting immediately',
  noToken: 'Invitation token missing.',
  contactOps: 'Please contact ops',
  loading: 'Loading…',
  headerError: 'Partner Sign-Up',
  email: 'Company email *',
  contactName: 'Contact name *',
  company: 'Company name *',
  phone: 'Contact phone * (mobile or direct line)',
  bizRegNo: 'Business registration number * (10 digits)',
  bizRegHint: 'Korean tax registration — verified at sign-up.',
  password: 'Password * (10+ chars)',
  needAgree: 'Please accept the partner agreement.',
  pwTooShort: 'Password must be at least 10 characters.',
  agreeText: ' (I accept)',
  agreeShow: 'Show full text',
  agreeHide: 'Hide',
  rule1Title: 'No off-platform circumvention',
  rule1Body: '24-month direct-deal ban with introduced clients (50% liquidated damages)',
  rule2Title: 'Mandatory escrow',
  rule2Body: 'All settlements via NexyFab platform',
  rule3Title: 'NexyFab commission',
  rule3Body: '8% of deal value (auto-deducted at settlement)',
  rule4Title: 'Disputes',
  rule4Body: 'Self-resolution → NexyFab mediation → KCAB arbitration',
  fullAgreement: '📄 Full partner agreement',
  submitting: 'Submitting…',
  submit: '✓ Accept agreement & sign up',
  footer: 'You will be redirected to the quote workspace after sign-up.',
  inquiry: 'Inquiries',
};

const JA: OnboardDict = {
  title: 'NexyFab パートナー登録',
  subtitle: '1分で登録完了 — すぐに見積もり作成可能',
  noToken: '招待トークンがありません。',
  contactOps: '運営チームにご連絡ください',
  loading: '読み込み中…',
  headerError: 'パートナー登録',
  email: '会社メールアドレス *',
  contactName: 'ご担当者名 *',
  company: '会社名 *',
  phone: '担当者連絡先 * (携帯または会社直通)',
  bizRegNo: '事業者登録番号 * (10桁)',
  bizRegHint: '韓国国税庁の登録番号 — 登録時に検証されます。',
  password: 'パスワード * (10文字以上)',
  needAgree: 'パートナー規約に同意してください。',
  pwTooShort: 'パスワードは10文字以上必要です。',
  agreeText: 'に同意します。',
  agreeShow: '全文を表示',
  agreeHide: '閉じる',
  rule1Title: 'プラットフォーム外取引の禁止',
  rule1Body: 'NexyFab で紹介された顧客との直接取引を24ヶ月間禁止 (違約金: 取引額の50%)',
  rule2Title: 'エスクロー必須',
  rule2Body: 'すべての決済は NexyFab プラットフォーム経由',
  rule3Title: 'NexyFab 手数料',
  rule3Body: '取引額の8% (精算時に自動控除)',
  rule4Title: '紛争解決',
  rule4Body: '当事者協議 → NexyFab 仲介 → 韓国商事仲裁院',
  fullAgreement: '📄 パートナー規約全文',
  submitting: '送信中…',
  submit: '✓ 規約に同意して登録',
  footer: '登録完了後、見積もり画面に移動します。',
  inquiry: 'お問い合わせ',
};

const CN: OnboardDict = {
  title: 'NexyFab 合作伙伴注册',
  subtitle: '一分钟完成注册 — 立即开始报价',
  noToken: '缺少邀请令牌。',
  contactOps: '请联系运营团队',
  loading: '加载中…',
  headerError: '合作伙伴注册',
  email: '公司邮箱 *',
  contactName: '联系人姓名 *',
  company: '公司名称 *',
  phone: '联系人电话 * (手机或公司直拨)',
  bizRegNo: '营业执照号码 * (10位)',
  bizRegHint: '韩国国税局登记号 — 注册时即时验证。',
  password: '密码 * (至少10位)',
  needAgree: '请同意合作伙伴协议。',
  pwTooShort: '密码至少需要10个字符。',
  agreeText: '我同意。',
  agreeShow: '查看全文',
  agreeHide: '收起',
  rule1Title: '禁止平台外交易',
  rule1Body: '与通过 NexyFab 介绍的客户在24个月内禁止直接交易 (违约金为交易额的50%)',
  rule2Title: '必须使用托管支付',
  rule2Body: '所有结算需通过 NexyFab 平台',
  rule3Title: 'NexyFab 佣金',
  rule3Body: '交易额的8% (结算时自动扣除)',
  rule4Title: '争议解决',
  rule4Body: '当事人协商 → NexyFab 调解 → 大韩商事仲裁院',
  fullAgreement: '📄 合作伙伴协议全文',
  submitting: '提交中…',
  submit: '✓ 同意并完成注册',
  footer: '注册完成后将跳转到报价工作区。',
  inquiry: '咨询',
};

const ES: OnboardDict = {
  title: 'Registro de socio NexyFab',
  subtitle: 'Registro en un minuto — empieza a cotizar al instante',
  noToken: 'Falta el token de invitación.',
  contactOps: 'Por favor contacta con el equipo de operaciones',
  loading: 'Cargando…',
  headerError: 'Registro de socio',
  email: 'Correo corporativo *',
  contactName: 'Nombre del contacto *',
  company: 'Nombre de la empresa *',
  phone: 'Teléfono del contacto * (móvil o directo)',
  bizRegNo: 'Número de registro mercantil * (10 dígitos)',
  bizRegHint: 'Registro fiscal coreano — verificado al registrarse.',
  password: 'Contraseña * (10+ caracteres)',
  needAgree: 'Por favor acepta el acuerdo de socio.',
  pwTooShort: 'La contraseña debe tener al menos 10 caracteres.',
  agreeText: ' (acepto)',
  agreeShow: 'Mostrar texto completo',
  agreeHide: 'Ocultar',
  rule1Title: 'Sin acuerdos fuera de plataforma',
  rule1Body: 'Prohibido contratar directamente con clientes presentados durante 24 meses (penalización: 50% del valor de la operación)',
  rule2Title: 'Custodia obligatoria',
  rule2Body: 'Todos los pagos se realizan a través de NexyFab',
  rule3Title: 'Comisión de NexyFab',
  rule3Body: '8% del valor del acuerdo (descontado en la liquidación)',
  rule4Title: 'Disputas',
  rule4Body: 'Autorresolución → mediación de NexyFab → arbitraje KCAB',
  fullAgreement: '📄 Acuerdo de socio completo',
  submitting: 'Enviando…',
  submit: '✓ Aceptar acuerdo y registrarse',
  footer: 'Serás redirigido al espacio de cotización tras registrarte.',
  inquiry: 'Consultas',
};

const AR: OnboardDict = {
  title: 'تسجيل شريك NexyFab',
  subtitle: 'تسجيل بدقيقة واحدة — وابدأ تقديم العروض فورًا',
  noToken: 'رمز الدعوة مفقود.',
  contactOps: 'يرجى التواصل مع فريق التشغيل',
  loading: 'جارٍ التحميل…',
  headerError: 'تسجيل الشريك',
  email: 'البريد الإلكتروني للشركة *',
  contactName: 'اسم جهة الاتصال *',
  company: 'اسم الشركة *',
  phone: 'هاتف جهة الاتصال * (جوال أو خط مباشر)',
  bizRegNo: 'رقم السجل التجاري * (10 أرقام)',
  bizRegHint: 'سجل ضريبي كوري — يُتحقق منه عند التسجيل.',
  password: 'كلمة المرور * (10 خانات فأكثر)',
  needAgree: 'يرجى قبول اتفاقية الشراكة.',
  pwTooShort: 'يجب أن تتكون كلمة المرور من 10 خانات على الأقل.',
  agreeText: ' (أوافق)',
  agreeShow: 'عرض النص كاملًا',
  agreeHide: 'إخفاء',
  rule1Title: 'منع التعامل خارج المنصة',
  rule1Body: 'منع التعامل المباشر مع العملاء المُحالين لمدة 24 شهرًا (غرامة: 50٪ من قيمة الصفقة)',
  rule2Title: 'الضمان إلزامي',
  rule2Body: 'تتم جميع المدفوعات عبر منصة NexyFab',
  rule3Title: 'عمولة NexyFab',
  rule3Body: '8٪ من قيمة الصفقة (تُخصم تلقائيًا عند التسوية)',
  rule4Title: 'النزاعات',
  rule4Body: 'تسوية ذاتية → وساطة NexyFab → تحكيم KCAB',
  fullAgreement: '📄 اتفاقية الشراكة الكاملة',
  submitting: 'جارٍ الإرسال…',
  submit: '✓ قبول الاتفاقية والتسجيل',
  footer: 'سيتم تحويلك إلى مساحة عروض الأسعار بعد التسجيل.',
  inquiry: 'الاستفسارات',
};

export function onboardDict(lang: PartnerLang): OnboardDict {
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
