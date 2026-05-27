// Profile page dictionary.
// Note: PRESET_PROCESSES + partner_type values reference Korean industry
// vocabulary today; only the surrounding UI chrome is translated here.
// Translation of the catalog itself is deferred until partner-ops decides
// whether to localise the catalog or keep KR-canonical labels.

import type { PartnerLang } from '../partnerLang';

export interface ProfileDict {
  pageTitle: string;
  pageSubtitle: string;
  loading: string;

  tabProfile: string;
  tabPriceBook: string;
  tabCapability: string;

  reviewTitle: string;
  reviewCountSuffix: (n: number) => string;
  reviewAvgLabel: string;
  reviewLabelDeadline: string;
  reviewLabelQuality: string;
  reviewLabelCommunication: string;
  reviewEmpty: string;

  cardTitle: string;
  cardEdit: string;
  cardEditTitle: string;
  cardCancel: string;
  emptyProfileTitle: string;
  emptyProfileCta: string;

  contactPersonPrefix: string;
  sectionProcesses: string;
  sectionCerts: string;
  sectionBio: string;

  editTitle: string;
  logoAreaTitle: string;
  logoAreaHint: string;
  logoChangeLabel: string;
  fieldCompany: string;
  fieldCompanyPlaceholder: string;
  fieldContact: string;
  fieldContactPlaceholder: string;
  fieldEmail: string;
  fieldPhone: string;
  fieldPhonePlaceholder: string;
  fieldHomepage: string;
  fieldBio: string;
  fieldBioPlaceholder: string;
  inputAddPlaceholder: string;
  btnAdd: string;
  btnCancel: string;
  btnSave: string;
  btnSaving: string;
  fallbackPartnerName: string;

  toastImageTooBig: string;
  toastLogoSaved: string;
  toastLogoFailed: string;
  toastLogoError: string;
  toastProfileSaved: string;
  toastProfileFailed: string;
  toastDemoPricebook: string;
  toastDemoCapability: string;
  toastPricebookSaved: string;
  toastPricebookFailed: string;
  toastPricebookValidationPrefix: string;
  toastCapabilitySaved: string;
  toastCapabilityFailed: string;
  toastCapabilityValidationPrefix: string;
}

const KO: ProfileDict = {
  pageTitle: '프로필',
  pageSubtitle: '공장/파트너사 정보 관리',
  loading: '불러오는 중...',

  tabProfile: '회사 정보',
  tabPriceBook: '단가표',
  tabCapability: '공정 능력',

  reviewTitle: '내 평점',
  reviewCountSuffix: (n) => `리뷰 ${n}건`,
  reviewAvgLabel: '평균 별점',
  reviewLabelDeadline: '납기 준수',
  reviewLabelQuality: '품질',
  reviewLabelCommunication: '소통',
  reviewEmpty: '아직 받은 평가가 없습니다.',

  cardTitle: '회사 프로필',
  cardEdit: '편집',
  cardEditTitle: '편집',
  cardCancel: '취소',
  emptyProfileTitle: '프로필 정보가 없습니다.',
  emptyProfileCta: '프로필 작성하기',

  contactPersonPrefix: '담당자:',
  sectionProcesses: '주요 공정',
  sectionCerts: '보유 인증',
  sectionBio: '회사 소개',

  editTitle: '프로필 편집',
  logoAreaTitle: '회사 로고',
  logoAreaHint: '클릭하여 이미지 업로드 (JPG, PNG, 최대 2MB)',
  logoChangeLabel: '변경',
  fieldCompany: '회사명',
  fieldCompanyPlaceholder: '회사명',
  fieldContact: '담당자명',
  fieldContactPlaceholder: '홍길동',
  fieldEmail: '이메일',
  fieldPhone: '전화번호',
  fieldPhonePlaceholder: '010-0000-0000',
  fieldHomepage: '홈페이지 URL',
  fieldBio: '회사 소개',
  fieldBioPlaceholder: '보유 기술, 설비, 경험 등을 간략히 기술해 주세요.',
  inputAddPlaceholder: '직접 입력 후 Enter',
  btnAdd: '추가',
  btnCancel: '취소',
  btnSave: '변경사항 저장',
  btnSaving: '저장 중...',
  fallbackPartnerName: '파트너',

  toastImageTooBig: '이미지 크기는 2MB 이하여야 합니다.',
  toastLogoSaved: '로고가 업데이트되었습니다.',
  toastLogoFailed: '로고 업로드에 실패했습니다.',
  toastLogoError: '로고 업로드 중 오류가 발생했습니다.',
  toastProfileSaved: '프로필이 저장되었습니다.',
  toastProfileFailed: '저장에 실패했습니다.',
  toastDemoPricebook: '데모 모드: 단가표 저장 시뮬레이션 완료',
  toastDemoCapability: '데모 모드: 공정 능력표 저장 시뮬레이션 완료',
  toastPricebookSaved: '단가표가 저장되었습니다.',
  toastPricebookFailed: '단가표 저장에 실패했습니다.',
  toastPricebookValidationPrefix: '단가표 검증 실패',
  toastCapabilitySaved: '공정 능력표가 저장되었습니다.',
  toastCapabilityFailed: '공정 능력표 저장에 실패했습니다.',
  toastCapabilityValidationPrefix: '공정 능력표 검증 실패',
};

const EN: ProfileDict = {
  pageTitle: 'Profile',
  pageSubtitle: 'Manage your factory/partner profile.',
  loading: 'Loading…',

  tabProfile: 'Company',
  tabPriceBook: 'Price book',
  tabCapability: 'Process capability',

  reviewTitle: 'Your ratings',
  reviewCountSuffix: (n) => `${n} reviews`,
  reviewAvgLabel: 'Average rating',
  reviewLabelDeadline: 'On-time',
  reviewLabelQuality: 'Quality',
  reviewLabelCommunication: 'Communication',
  reviewEmpty: 'No reviews yet.',

  cardTitle: 'Company profile',
  cardEdit: 'Edit',
  cardEditTitle: 'Edit',
  cardCancel: 'Cancel',
  emptyProfileTitle: 'No profile information yet.',
  emptyProfileCta: 'Create profile',

  contactPersonPrefix: 'Contact:',
  sectionProcesses: 'Key processes',
  sectionCerts: 'Certifications',
  sectionBio: 'About the company',

  editTitle: 'Edit profile',
  logoAreaTitle: 'Company logo',
  logoAreaHint: 'Click to upload (JPG / PNG, up to 2MB)',
  logoChangeLabel: 'Change',
  fieldCompany: 'Company name',
  fieldCompanyPlaceholder: 'Company name',
  fieldContact: 'Contact name',
  fieldContactPlaceholder: 'Jane Doe',
  fieldEmail: 'Email',
  fieldPhone: 'Phone',
  fieldPhonePlaceholder: '+82 10-0000-0000',
  fieldHomepage: 'Website URL',
  fieldBio: 'About the company',
  fieldBioPlaceholder: 'Briefly describe your skills, equipment and experience.',
  inputAddPlaceholder: 'Type and press Enter',
  btnAdd: 'Add',
  btnCancel: 'Cancel',
  btnSave: 'Save changes',
  btnSaving: 'Saving…',
  fallbackPartnerName: 'Partner',

  toastImageTooBig: 'Image must be 2 MB or smaller.',
  toastLogoSaved: 'Logo updated.',
  toastLogoFailed: 'Logo upload failed.',
  toastLogoError: 'Error uploading the logo.',
  toastProfileSaved: 'Profile saved.',
  toastProfileFailed: 'Could not save.',
  toastDemoPricebook: 'Demo mode: price-book save simulated.',
  toastDemoCapability: 'Demo mode: capability sheet save simulated.',
  toastPricebookSaved: 'Price book saved.',
  toastPricebookFailed: 'Could not save the price book.',
  toastPricebookValidationPrefix: 'Price-book validation failed',
  toastCapabilitySaved: 'Capability sheet saved.',
  toastCapabilityFailed: 'Could not save the capability sheet.',
  toastCapabilityValidationPrefix: 'Capability-sheet validation failed',
};

const JA: ProfileDict = {
  pageTitle: 'プロフィール',
  pageSubtitle: '工場・パートナー情報を管理します。',
  loading: '読み込み中…',

  tabProfile: '会社情報',
  tabPriceBook: '単価表',
  tabCapability: '工程能力',

  reviewTitle: '評価',
  reviewCountSuffix: (n) => `レビュー ${n}件`,
  reviewAvgLabel: '平均評価',
  reviewLabelDeadline: '納期遵守',
  reviewLabelQuality: '品質',
  reviewLabelCommunication: 'コミュニケーション',
  reviewEmpty: 'まだ評価はありません。',

  cardTitle: '会社プロフィール',
  cardEdit: '編集',
  cardEditTitle: '編集',
  cardCancel: 'キャンセル',
  emptyProfileTitle: 'プロフィール情報がありません。',
  emptyProfileCta: 'プロフィールを作成',

  contactPersonPrefix: '担当者:',
  sectionProcesses: '主要工程',
  sectionCerts: '保有認証',
  sectionBio: '会社紹介',

  editTitle: 'プロフィール編集',
  logoAreaTitle: '会社ロゴ',
  logoAreaHint: 'クリックして画像をアップロード (JPG/PNG、最大 2MB)',
  logoChangeLabel: '変更',
  fieldCompany: '会社名',
  fieldCompanyPlaceholder: '会社名',
  fieldContact: '担当者名',
  fieldContactPlaceholder: '山田 太郎',
  fieldEmail: 'メール',
  fieldPhone: '電話番号',
  fieldPhonePlaceholder: '03-0000-0000',
  fieldHomepage: 'ホームページ URL',
  fieldBio: '会社紹介',
  fieldBioPlaceholder: '技術、設備、経験などを簡潔にご記入ください。',
  inputAddPlaceholder: '直接入力後 Enter',
  btnAdd: '追加',
  btnCancel: 'キャンセル',
  btnSave: '変更を保存',
  btnSaving: '保存中…',
  fallbackPartnerName: 'パートナー',

  toastImageTooBig: '画像サイズは 2MB 以下にしてください。',
  toastLogoSaved: 'ロゴを更新しました。',
  toastLogoFailed: 'ロゴのアップロードに失敗しました。',
  toastLogoError: 'ロゴのアップロード中にエラーが発生しました。',
  toastProfileSaved: 'プロフィールを保存しました。',
  toastProfileFailed: '保存に失敗しました。',
  toastDemoPricebook: 'デモモード: 単価表保存のシミュレーション完了',
  toastDemoCapability: 'デモモード: 工程能力表保存のシミュレーション完了',
  toastPricebookSaved: '単価表を保存しました。',
  toastPricebookFailed: '単価表の保存に失敗しました。',
  toastPricebookValidationPrefix: '単価表の検証に失敗',
  toastCapabilitySaved: '工程能力表を保存しました。',
  toastCapabilityFailed: '工程能力表の保存に失敗しました。',
  toastCapabilityValidationPrefix: '工程能力表の検証に失敗',
};

const CN: ProfileDict = {
  pageTitle: '资料',
  pageSubtitle: '管理工厂/合作伙伴信息。',
  loading: '加载中…',

  tabProfile: '公司信息',
  tabPriceBook: '价格表',
  tabCapability: '工艺能力',

  reviewTitle: '我的评分',
  reviewCountSuffix: (n) => `${n} 条评论`,
  reviewAvgLabel: '平均评分',
  reviewLabelDeadline: '准时交付',
  reviewLabelQuality: '质量',
  reviewLabelCommunication: '沟通',
  reviewEmpty: '尚未收到评价。',

  cardTitle: '公司资料',
  cardEdit: '编辑',
  cardEditTitle: '编辑',
  cardCancel: '取消',
  emptyProfileTitle: '尚无资料信息。',
  emptyProfileCta: '创建资料',

  contactPersonPrefix: '联系人:',
  sectionProcesses: '主要工艺',
  sectionCerts: '认证',
  sectionBio: '公司简介',

  editTitle: '编辑资料',
  logoAreaTitle: '公司 Logo',
  logoAreaHint: '点击上传图片 (JPG/PNG，最大 2MB)',
  logoChangeLabel: '更换',
  fieldCompany: '公司名称',
  fieldCompanyPlaceholder: '公司名称',
  fieldContact: '联系人',
  fieldContactPlaceholder: '王伟',
  fieldEmail: '邮箱',
  fieldPhone: '电话',
  fieldPhonePlaceholder: '+86 138-0000-0000',
  fieldHomepage: '官网 URL',
  fieldBio: '公司简介',
  fieldBioPlaceholder: '请简要介绍贵公司的技术、设备和经验。',
  inputAddPlaceholder: '输入后按 Enter',
  btnAdd: '添加',
  btnCancel: '取消',
  btnSave: '保存修改',
  btnSaving: '保存中…',
  fallbackPartnerName: '合作伙伴',

  toastImageTooBig: '图片大小不能超过 2MB。',
  toastLogoSaved: 'Logo 已更新。',
  toastLogoFailed: 'Logo 上传失败。',
  toastLogoError: '上传 Logo 时出错。',
  toastProfileSaved: '资料已保存。',
  toastProfileFailed: '保存失败。',
  toastDemoPricebook: '演示模式: 价格表保存模拟完成',
  toastDemoCapability: '演示模式: 工艺能力表保存模拟完成',
  toastPricebookSaved: '价格表已保存。',
  toastPricebookFailed: '保存价格表失败。',
  toastPricebookValidationPrefix: '价格表校验失败',
  toastCapabilitySaved: '工艺能力表已保存。',
  toastCapabilityFailed: '保存工艺能力表失败。',
  toastCapabilityValidationPrefix: '工艺能力表校验失败',
};

const ES: ProfileDict = {
  pageTitle: 'Perfil',
  pageSubtitle: 'Gestiona la información de la fábrica/socio.',
  loading: 'Cargando…',

  tabProfile: 'Empresa',
  tabPriceBook: 'Lista de precios',
  tabCapability: 'Capacidades',

  reviewTitle: 'Tu valoración',
  reviewCountSuffix: (n) => `${n} reseñas`,
  reviewAvgLabel: 'Promedio',
  reviewLabelDeadline: 'Puntualidad',
  reviewLabelQuality: 'Calidad',
  reviewLabelCommunication: 'Comunicación',
  reviewEmpty: 'Aún no tienes reseñas.',

  cardTitle: 'Perfil de empresa',
  cardEdit: 'Editar',
  cardEditTitle: 'Editar',
  cardCancel: 'Cancelar',
  emptyProfileTitle: 'No hay información de perfil aún.',
  emptyProfileCta: 'Crear perfil',

  contactPersonPrefix: 'Contacto:',
  sectionProcesses: 'Procesos clave',
  sectionCerts: 'Certificaciones',
  sectionBio: 'Sobre la empresa',

  editTitle: 'Editar perfil',
  logoAreaTitle: 'Logotipo de empresa',
  logoAreaHint: 'Haz clic para subir imagen (JPG/PNG, hasta 2 MB)',
  logoChangeLabel: 'Cambiar',
  fieldCompany: 'Nombre de la empresa',
  fieldCompanyPlaceholder: 'Nombre de la empresa',
  fieldContact: 'Nombre del contacto',
  fieldContactPlaceholder: 'María Pérez',
  fieldEmail: 'Correo',
  fieldPhone: 'Teléfono',
  fieldPhonePlaceholder: '+34 600 000 000',
  fieldHomepage: 'Sitio web',
  fieldBio: 'Sobre la empresa',
  fieldBioPlaceholder: 'Describe brevemente capacidades, equipo y experiencia.',
  inputAddPlaceholder: 'Escribe y pulsa Enter',
  btnAdd: 'Añadir',
  btnCancel: 'Cancelar',
  btnSave: 'Guardar cambios',
  btnSaving: 'Guardando…',
  fallbackPartnerName: 'Socio',

  toastImageTooBig: 'La imagen debe pesar 2 MB o menos.',
  toastLogoSaved: 'Logotipo actualizado.',
  toastLogoFailed: 'No se pudo subir el logotipo.',
  toastLogoError: 'Error al subir el logotipo.',
  toastProfileSaved: 'Perfil guardado.',
  toastProfileFailed: 'No se pudo guardar.',
  toastDemoPricebook: 'Modo demo: simulación de guardado de la lista de precios.',
  toastDemoCapability: 'Modo demo: simulación de guardado de capacidades.',
  toastPricebookSaved: 'Lista de precios guardada.',
  toastPricebookFailed: 'No se pudo guardar la lista de precios.',
  toastPricebookValidationPrefix: 'Validación de lista de precios fallida',
  toastCapabilitySaved: 'Capacidades guardadas.',
  toastCapabilityFailed: 'No se pudieron guardar las capacidades.',
  toastCapabilityValidationPrefix: 'Validación de capacidades fallida',
};

const AR: ProfileDict = {
  pageTitle: 'الملف الشخصي',
  pageSubtitle: 'إدارة معلومات المصنع/الشريك.',
  loading: 'جارٍ التحميل…',

  tabProfile: 'بيانات الشركة',
  tabPriceBook: 'قائمة الأسعار',
  tabCapability: 'قدرات العمليات',

  reviewTitle: 'تقييمي',
  reviewCountSuffix: (n) => `${n} مراجعة`,
  reviewAvgLabel: 'المتوسط',
  reviewLabelDeadline: 'الالتزام بالمواعيد',
  reviewLabelQuality: 'الجودة',
  reviewLabelCommunication: 'التواصل',
  reviewEmpty: 'لا توجد مراجعات بعد.',

  cardTitle: 'ملف الشركة',
  cardEdit: 'تحرير',
  cardEditTitle: 'تحرير',
  cardCancel: 'إلغاء',
  emptyProfileTitle: 'لا توجد معلومات الملف الشخصي بعد.',
  emptyProfileCta: 'إنشاء ملف شخصي',

  contactPersonPrefix: 'جهة الاتصال:',
  sectionProcesses: 'العمليات الرئيسية',
  sectionCerts: 'الشهادات',
  sectionBio: 'عن الشركة',

  editTitle: 'تحرير الملف الشخصي',
  logoAreaTitle: 'شعار الشركة',
  logoAreaHint: 'اضغط لتحميل صورة (JPG/PNG، حتى 2 ميغابايت)',
  logoChangeLabel: 'تغيير',
  fieldCompany: 'اسم الشركة',
  fieldCompanyPlaceholder: 'اسم الشركة',
  fieldContact: 'اسم جهة الاتصال',
  fieldContactPlaceholder: 'مثال: محمد العلي',
  fieldEmail: 'البريد الإلكتروني',
  fieldPhone: 'الهاتف',
  fieldPhonePlaceholder: '+966 5x-xxx-xxxx',
  fieldHomepage: 'رابط الموقع',
  fieldBio: 'عن الشركة',
  fieldBioPlaceholder: 'صف باختصار المهارات والمعدات والخبرات.',
  inputAddPlaceholder: 'اكتب ثم اضغط Enter',
  btnAdd: 'إضافة',
  btnCancel: 'إلغاء',
  btnSave: 'حفظ التغييرات',
  btnSaving: 'جارٍ الحفظ…',
  fallbackPartnerName: 'شريك',

  toastImageTooBig: 'يجب ألا يتجاوز حجم الصورة 2 ميغابايت.',
  toastLogoSaved: 'تم تحديث الشعار.',
  toastLogoFailed: 'فشل تحميل الشعار.',
  toastLogoError: 'حدث خطأ أثناء تحميل الشعار.',
  toastProfileSaved: 'تم حفظ الملف الشخصي.',
  toastProfileFailed: 'تعذّر الحفظ.',
  toastDemoPricebook: 'وضع تجريبي: محاكاة حفظ قائمة الأسعار.',
  toastDemoCapability: 'وضع تجريبي: محاكاة حفظ جدول قدرات العمليات.',
  toastPricebookSaved: 'تم حفظ قائمة الأسعار.',
  toastPricebookFailed: 'تعذّر حفظ قائمة الأسعار.',
  toastPricebookValidationPrefix: 'فشل التحقق من قائمة الأسعار',
  toastCapabilitySaved: 'تم حفظ جدول قدرات العمليات.',
  toastCapabilityFailed: 'تعذّر حفظ جدول قدرات العمليات.',
  toastCapabilityValidationPrefix: 'فشل التحقق من جدول قدرات العمليات',
};

export function profileDict(lang: PartnerLang): ProfileDict {
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
