// Profile sub-editors dictionary (PriceBookEditor + CapabilityEditor).

import type { PartnerLang } from '../partnerLang';

export interface ProfileEditorsDict {
  // Common
  saveBtn: string;
  savingBtn: string;
  addBtn: string;
  deleteTitle: string;
  hours: string;

  // PriceBookEditor
  pbTitle: string;
  pbSubtitle: string;
  pbCommonSection: string;
  pbSetupFee: string;
  pbMinOrder: string;
  pbExpressMultiplier: string;
  pbProcessSection: string;
  pbHourly: string;
  pbSetup: string;
  pbMaterialSection: string;
  pbMaterialPrice: string;
  pbMaterialMargin: string;
  pbAddMaterialPlaceholder: string;
  pbVolumeSection: string;
  pbMinQty: string;
  pbDiscount: string;
  pbAddTier: string;
  pbMat_aluminum: string;
  pbMat_steel: string;
  pbMat_titanium: string;
  pbMat_copper: string;
  pbMat_abs_white: string;
  pbMat_nylon: string;

  // CapabilityEditor
  capTitle: string;
  capSubtitle: string;
  capMaterialsSection: string;
  capMaterialsSubtitle: string;
  capTolerancesSection: string;
  capTolerancesSubtitle: string;
  capDimensionsSection: string;
  capMinHole: string;
  capMaxBboxX: string;
  capMaxBboxY: string;
  capMaxBboxZ: string;
  capWeightSection: string;
  capMinWeight: string;
  capMaxWeight: string;

  capMaxBboxTitle: string;
  capMinWall: string;
  capMinTolerance: string;
  capSurfaceFinish: string;
  capLeadTime: string;
  capLeadTimeUnit: string;
  capNotes: string;
  capNotesPh: string;
}

const KO: ProfileEditorsDict = {
  saveBtn: '저장',
  savingBtn: '저장 중...',
  addBtn: '추가',
  deleteTitle: '삭제',
  hours: '시간',

  pbTitle: '단가표',
  pbSubtitle: '고객 견적 자동 산출에 사용됩니다.',
  pbCommonSection: '공통 설정',
  pbSetupFee: '셋업 비용 (₩)',
  pbMinOrder: '최소 주문 (₩)',
  pbExpressMultiplier: '긴급 배수 (×)',
  pbProcessSection: '공정별 시간당 단가',
  pbHourly: '시간당',
  pbSetup: '셋업',
  pbMaterialSection: '재질별 단가 (kg)',
  pbMaterialPrice: '단가',
  pbMaterialMargin: '마진',
  pbAddMaterialPlaceholder: '+ 재질 추가',
  pbVolumeSection: '수량 할인 구간',
  pbMinQty: '최소수량',
  pbDiscount: '할인',
  pbAddTier: '+ 할인 구간 추가',
  pbMat_aluminum: '알루미늄',
  pbMat_steel: '강철',
  pbMat_titanium: '티타늄',
  pbMat_copper: '구리',
  pbMat_abs_white: 'ABS',
  pbMat_nylon: '나일론',

  capTitle: '공정 능력',
  capSubtitle: '자동 견적이 RFQ 적합도를 판단할 때 사용됩니다.',
  capMaterialsSection: '대응 재질',
  capMaterialsSubtitle: '대응 가능한 재질을 쉼표로 구분해 입력하세요',
  capTolerancesSection: '공차 범위 (mm)',
  capTolerancesSubtitle: '최소-최대 공차',
  capDimensionsSection: '치수 한계',
  capMinHole: '최소 홀 크기 (mm)',
  capMaxBboxX: '최대 X (mm)',
  capMaxBboxY: '최대 Y (mm)',
  capMaxBboxZ: '최대 Z (mm)',
  capWeightSection: '중량 범위',
  capMinWeight: '최소 중량 (g)',
  capMaxWeight: '최대 중량 (kg)',

  capMaxBboxTitle: '최대 가공 크기 (mm)',
  capMinWall: '최소 두께 (mm)',
  capMinTolerance: '최소 공차 (±mm)',
  capSurfaceFinish: '표면조도 옵션 (Ra)',
  capLeadTime: '리드타임 (영업일)',
  capLeadTimeUnit: '일',
  capNotes: '메모',
  capNotesPh: '특수 옵션, 제약 등',
};

const EN: ProfileEditorsDict = {
  saveBtn: 'Save',
  savingBtn: 'Saving…',
  addBtn: 'Add',
  deleteTitle: 'Delete',
  hours: 'h',

  pbTitle: 'Price book',
  pbSubtitle: 'Used by the auto-quote engine.',
  pbCommonSection: 'Common settings',
  pbSetupFee: 'Setup fee (₩)',
  pbMinOrder: 'Min order (₩)',
  pbExpressMultiplier: 'Express multiplier (×)',
  pbProcessSection: 'Hourly rate per process',
  pbHourly: 'Hourly',
  pbSetup: 'Setup',
  pbMaterialSection: 'Material price (per kg)',
  pbMaterialPrice: 'Price',
  pbMaterialMargin: 'Markup',
  pbAddMaterialPlaceholder: '+ Add material',
  pbVolumeSection: 'Volume discount tiers',
  pbMinQty: 'Min qty',
  pbDiscount: 'Discount',
  pbAddTier: '+ Add tier',
  pbMat_aluminum: 'Aluminum',
  pbMat_steel: 'Steel',
  pbMat_titanium: 'Titanium',
  pbMat_copper: 'Copper',
  pbMat_abs_white: 'ABS',
  pbMat_nylon: 'Nylon',

  capTitle: 'Process capability',
  capSubtitle: 'Used by the auto-quote engine to judge RFQ fit.',
  capMaterialsSection: 'Supported materials',
  capMaterialsSubtitle: 'Comma-separated list of materials you support',
  capTolerancesSection: 'Tolerance range (mm)',
  capTolerancesSubtitle: 'Min-max tolerance',
  capDimensionsSection: 'Dimension limits',
  capMinHole: 'Min hole size (mm)',
  capMaxBboxX: 'Max X (mm)',
  capMaxBboxY: 'Max Y (mm)',
  capMaxBboxZ: 'Max Z (mm)',
  capWeightSection: 'Weight range',
  capMinWeight: 'Min weight (g)',
  capMaxWeight: 'Max weight (kg)',

  capMaxBboxTitle: 'Max work envelope (mm)',
  capMinWall: 'Min wall (mm)',
  capMinTolerance: 'Min tolerance (±mm)',
  capSurfaceFinish: 'Surface finish (Ra)',
  capLeadTime: 'Lead time (business days)',
  capLeadTimeUnit: 'd',
  capNotes: 'Notes',
  capNotesPh: 'Special options, constraints, etc.',
};

const JA: ProfileEditorsDict = {
  ...EN,
  saveBtn: '保存',
  savingBtn: '保存中…',
  addBtn: '追加',
  deleteTitle: '削除',
  hours: '時間',
  pbTitle: '単価表',
  pbSubtitle: '自動見積もりに使用されます。',
  pbCommonSection: '共通設定',
  pbSetupFee: 'セットアップ費 (₩)',
  pbMinOrder: '最小発注額 (₩)',
  pbExpressMultiplier: '緊急倍率 (×)',
  pbProcessSection: '工程別 時給単価',
  pbHourly: '時給',
  pbSetup: 'セットアップ',
  pbMaterialSection: '材料単価 (kg当)',
  pbMaterialPrice: '単価',
  pbMaterialMargin: 'マージン',
  pbAddMaterialPlaceholder: '+ 材料追加',
  pbVolumeSection: '数量割引区分',
  pbMinQty: '最小数量',
  pbDiscount: '割引',
  pbAddTier: '+ 区分追加',
  pbMat_aluminum: 'アルミニウム',
  pbMat_steel: '鋼',
  pbMat_titanium: 'チタン',
  pbMat_copper: '銅',
  pbMat_nylon: 'ナイロン',
  capTitle: '工程能力',
  capSubtitle: '自動見積もりでRFQ適合性判定に使用されます。',
  capMaterialsSection: '対応材料',
  capMaterialsSubtitle: '対応可能な材料をカンマ区切りで入力',
  capTolerancesSection: '公差範囲 (mm)',
  capTolerancesSubtitle: '最小-最大公差',
  capDimensionsSection: '寸法制限',
  capMinHole: '最小穴径 (mm)',
  capMaxBboxX: '最大 X (mm)',
  capMaxBboxY: '最大 Y (mm)',
  capMaxBboxZ: '最大 Z (mm)',
  capWeightSection: '重量範囲',
  capMinWeight: '最小重量 (g)',
  capMaxWeight: '最大重量 (kg)',
};

const CN: ProfileEditorsDict = {
  ...EN,
  saveBtn: '保存',
  savingBtn: '保存中…',
  addBtn: '添加',
  deleteTitle: '删除',
  hours: '小时',
  pbTitle: '价格表',
  pbSubtitle: '用于自动报价。',
  pbCommonSection: '通用设置',
  pbSetupFee: '调机费 (₩)',
  pbMinOrder: '起订金额 (₩)',
  pbExpressMultiplier: '加急倍数 (×)',
  pbProcessSection: '工序时薪',
  pbHourly: '时薪',
  pbSetup: '调机',
  pbMaterialSection: '材料价格 (每 kg)',
  pbMaterialPrice: '价格',
  pbMaterialMargin: '加价',
  pbAddMaterialPlaceholder: '+ 添加材料',
  pbVolumeSection: '数量折扣阶梯',
  pbMinQty: '最少数量',
  pbDiscount: '折扣',
  pbAddTier: '+ 添加阶梯',
  pbMat_aluminum: '铝',
  pbMat_steel: '钢',
  pbMat_titanium: '钛',
  pbMat_copper: '铜',
  pbMat_nylon: '尼龙',
  capTitle: '工艺能力',
  capSubtitle: '自动报价用其判断 RFQ 匹配。',
  capMaterialsSection: '支持材料',
  capMaterialsSubtitle: '逗号分隔列出支持的材料',
  capTolerancesSection: '公差范围 (mm)',
  capTolerancesSubtitle: '最小-最大公差',
  capDimensionsSection: '尺寸限制',
  capMinHole: '最小孔径 (mm)',
  capMaxBboxX: '最大 X (mm)',
  capMaxBboxY: '最大 Y (mm)',
  capMaxBboxZ: '最大 Z (mm)',
  capWeightSection: '重量范围',
  capMinWeight: '最小重量 (g)',
  capMaxWeight: '最大重量 (kg)',
};

const ES: ProfileEditorsDict = {
  ...EN,
  saveBtn: 'Guardar',
  savingBtn: 'Guardando…',
  addBtn: 'Añadir',
  deleteTitle: 'Eliminar',
  hours: 'h',
  pbTitle: 'Lista de precios',
  pbSubtitle: 'La usa el motor de cotización automática.',
  pbCommonSection: 'Configuración común',
  pbSetupFee: 'Coste de setup (₩)',
  pbMinOrder: 'Pedido mínimo (₩)',
  pbExpressMultiplier: 'Multiplicador urgente (×)',
  pbProcessSection: 'Tarifa por hora (proceso)',
  pbHourly: 'Por hora',
  pbSetup: 'Setup',
  pbMaterialSection: 'Precio de material (por kg)',
  pbMaterialPrice: 'Precio',
  pbMaterialMargin: 'Margen',
  pbAddMaterialPlaceholder: '+ Añadir material',
  pbVolumeSection: 'Descuentos por volumen',
  pbMinQty: 'Cant. mín.',
  pbDiscount: 'Descuento',
  pbAddTier: '+ Añadir tramo',
  pbMat_aluminum: 'Aluminio',
  pbMat_steel: 'Acero',
  pbMat_titanium: 'Titanio',
  pbMat_copper: 'Cobre',
  pbMat_nylon: 'Nailon',
  capTitle: 'Capacidades',
  capSubtitle: 'Lo usa el motor de cotización para evaluar el encaje del RFQ.',
  capMaterialsSection: 'Materiales soportados',
  capMaterialsSubtitle: 'Lista de materiales separados por comas',
  capTolerancesSection: 'Tolerancias (mm)',
  capTolerancesSubtitle: 'Tolerancia min-max',
  capDimensionsSection: 'Dimensiones límite',
  capMinHole: 'Agujero mín. (mm)',
  capMaxBboxX: 'X máx. (mm)',
  capMaxBboxY: 'Y máx. (mm)',
  capMaxBboxZ: 'Z máx. (mm)',
  capWeightSection: 'Rango de peso',
  capMinWeight: 'Peso mín. (g)',
  capMaxWeight: 'Peso máx. (kg)',
};

const AR: ProfileEditorsDict = {
  ...EN,
  saveBtn: 'حفظ',
  savingBtn: 'جارٍ الحفظ…',
  addBtn: 'إضافة',
  deleteTitle: 'حذف',
  hours: 'س',
  pbTitle: 'قائمة الأسعار',
  pbSubtitle: 'يستخدمها محرك التسعير التلقائي.',
  pbCommonSection: 'الإعدادات العامة',
  pbSetupFee: 'تكلفة الإعداد (₩)',
  pbMinOrder: 'الحد الأدنى للطلب (₩)',
  pbExpressMultiplier: 'مضاعف العاجل (×)',
  pbProcessSection: 'الأجر بالساعة لكل عملية',
  pbHourly: 'بالساعة',
  pbSetup: 'الإعداد',
  pbMaterialSection: 'سعر المواد (لكل كغ)',
  pbMaterialPrice: 'السعر',
  pbMaterialMargin: 'الهامش',
  pbAddMaterialPlaceholder: '+ إضافة مادة',
  pbVolumeSection: 'فئات الخصم بالكمية',
  pbMinQty: 'الحد الأدنى',
  pbDiscount: 'الخصم',
  pbAddTier: '+ إضافة فئة',
  pbMat_aluminum: 'ألومنيوم',
  pbMat_steel: 'فولاذ',
  pbMat_titanium: 'تيتانيوم',
  pbMat_copper: 'نحاس',
  pbMat_nylon: 'نايلون',
  capTitle: 'قدرة العمليات',
  capSubtitle: 'يستخدمها محرك التسعير لتقييم مدى ملاءمة RFQ.',
  capMaterialsSection: 'المواد المدعومة',
  capMaterialsSubtitle: 'قائمة المواد المدعومة مفصولة بفواصل',
  capTolerancesSection: 'نطاق التفاوت (مم)',
  capTolerancesSubtitle: 'الحد الأدنى - الأقصى',
  capDimensionsSection: 'حدود الأبعاد',
  capMinHole: 'أصغر ثقب (مم)',
  capMaxBboxX: 'الحد الأقصى X (مم)',
  capMaxBboxY: 'الحد الأقصى Y (مم)',
  capMaxBboxZ: 'الحد الأقصى Z (مم)',
  capWeightSection: 'نطاق الوزن',
  capMinWeight: 'الحد الأدنى للوزن (غ)',
  capMaxWeight: 'الحد الأقصى للوزن (كغ)',
};

export function profileEditorsDict(lang: PartnerLang): ProfileEditorsDict {
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
