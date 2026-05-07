'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

const dict = {
  ko: {
    catCncLabel: 'CNC 가공',
    catCncDesc: '정밀 금속/플라스틱 절삭',
    catSheetLabel: '판금',
    catSheetDesc: '절곡·레이저 절단·용접',
    catPrint3dLabel: '3D 프린팅',
    catPrint3dDesc: '시제품·복잡 형상 제작',
    catInjectLabel: '사출 성형',
    catInjectDesc: '플라스틱 대량 생산',
    catCastingLabel: '주조',
    catCastingDesc: '금속 복잡 형상 양산',
    catOtherLabel: '기타',
    catOtherDesc: '용도에 맞는 공정 추천',
    matAluminum: '알루미늄 (Al)',
    matSteel: '철강 (Steel)',
    matStainless: '스테인리스 (SUS)',
    matTitanium: '티타늄 (Ti)',
    matCopper: '구리 (Cu)',
    matBrass: '황동 (Brass)',
    matAbs: 'ABS 수지',
    matPla: 'PLA',
    matNylon: '나일론 (PA)',
    matPc: '폴리카보네이트 (PC)',
    groupMetal: '금속',
    groupPlastic: '플라스틱',
    stepProcess: '공정 선택',
    stepDim: '기본 치수',
    stepRequest: '견적 요청',
    title: '🚀 빠른 견적 요청',
    subtitle: '3단계로 빠르게 제조 견적을 받으세요',
    step1Prompt: '어떤 제조 공정이 필요하세요?',
    btnNext: '다음 →',
    btnBack: '이전',
    step2Prompt: '부품의 기본 치수와 소재를 입력하세요.',
    labelMaterial: '소재',
    labelWidth: '너비 (W)',
    labelHeight: '높이 (H)',
    labelDepth: '깊이 (D)',
    labelQty: '수량',
    unitPcs: '개',
    step3Prompt: '입력 정보를 확인하고 견적을 요청하세요.',
    sumProcess: '공정',
    sumMaterial: '소재',
    sumWidth: '너비',
    sumHeight: '높이',
    sumDepth: '깊이',
    sumQty: '수량',
    sumVol: '예상 부피',
    instantEstimate: '실시간 예상 견적',
    calculating: '계산 중...',
    estimateFailed: '견적 계산 실패',
    noEstimate: '해당 조합에 적합한 견적 없음',
    best: '최저가',
    confidence: '신뢰도',
    totalLabel: '총',
    note: '💡 위 가격은 참고용 예상치입니다. 정식 견적은 파트너사 확인 후 1-2일 내로 제공됩니다.',
    btnQuoteOnly: '견적만 요청',
    btnQuoteMatch: '견적 + 제조사 매칭',
  },
  en: {
    catCncLabel: 'CNC Machining',
    catCncDesc: 'Precision metal/plastic cutting',
    catSheetLabel: 'Sheet Metal',
    catSheetDesc: 'Bending · laser cutting · welding',
    catPrint3dLabel: '3D Printing',
    catPrint3dDesc: 'Prototypes · complex shapes',
    catInjectLabel: 'Injection Molding',
    catInjectDesc: 'Plastic mass production',
    catCastingLabel: 'Casting',
    catCastingDesc: 'Complex metal part production',
    catOtherLabel: 'Other',
    catOtherDesc: 'Process recommendation by use',
    matAluminum: 'Aluminum (Al)',
    matSteel: 'Steel',
    matStainless: 'Stainless (SUS)',
    matTitanium: 'Titanium (Ti)',
    matCopper: 'Copper (Cu)',
    matBrass: 'Brass',
    matAbs: 'ABS Resin',
    matPla: 'PLA',
    matNylon: 'Nylon (PA)',
    matPc: 'Polycarbonate (PC)',
    groupMetal: 'Metal',
    groupPlastic: 'Plastic',
    stepProcess: 'Process',
    stepDim: 'Dimensions',
    stepRequest: 'Request',
    title: '🚀 Quick Quote',
    subtitle: 'Get a manufacturing quote in 3 steps',
    step1Prompt: 'Which manufacturing process do you need?',
    btnNext: 'Next →',
    btnBack: 'Back',
    step2Prompt: 'Enter basic dimensions and material.',
    labelMaterial: 'Material',
    labelWidth: 'Width (W)',
    labelHeight: 'Height (H)',
    labelDepth: 'Depth (D)',
    labelQty: 'Quantity',
    unitPcs: 'pcs',
    step3Prompt: 'Review your information and request a quote.',
    sumProcess: 'Process',
    sumMaterial: 'Material',
    sumWidth: 'Width',
    sumHeight: 'Height',
    sumDepth: 'Depth',
    sumQty: 'Qty',
    sumVol: 'Est. Volume',
    instantEstimate: 'Instant Estimate',
    calculating: 'Calculating...',
    estimateFailed: 'Estimate failed',
    noEstimate: 'No estimate available',
    best: 'Best',
    confidence: 'confidence',
    totalLabel: 'total',
    note: '💡 Prices above are estimates. Formal quotes from partners arrive within 1-2 business days.',
    btnQuoteOnly: 'Quote only',
    btnQuoteMatch: 'Quote + Match Factory',
  },
  ja: {
    catCncLabel: 'CNC加工',
    catCncDesc: '精密な金属/プラスチック切削',
    catSheetLabel: '板金',
    catSheetDesc: '曲げ・レーザー切断・溶接',
    catPrint3dLabel: '3Dプリンティング',
    catPrint3dDesc: '試作品・複雑形状の製作',
    catInjectLabel: '射出成形',
    catInjectDesc: 'プラスチック量産',
    catCastingLabel: '鋳造',
    catCastingDesc: '金属複雑形状の量産',
    catOtherLabel: 'その他',
    catOtherDesc: '用途に合った工程を推薦',
    matAluminum: 'アルミニウム (Al)',
    matSteel: '鉄鋼 (Steel)',
    matStainless: 'ステンレス (SUS)',
    matTitanium: 'チタン (Ti)',
    matCopper: '銅 (Cu)',
    matBrass: '真鍮 (Brass)',
    matAbs: 'ABS樹脂',
    matPla: 'PLA',
    matNylon: 'ナイロン (PA)',
    matPc: 'ポリカーボネート (PC)',
    groupMetal: '金属',
    groupPlastic: 'プラスチック',
    stepProcess: '工程選択',
    stepDim: '基本寸法',
    stepRequest: '見積依頼',
    title: '🚀 クイック見積',
    subtitle: '3ステップで製造見積を取得',
    step1Prompt: 'どの製造工程が必要ですか?',
    btnNext: '次へ →',
    btnBack: '戻る',
    step2Prompt: '部品の基本寸法と素材を入力してください。',
    labelMaterial: '素材',
    labelWidth: '幅 (W)',
    labelHeight: '高さ (H)',
    labelDepth: '奥行 (D)',
    labelQty: '数量',
    unitPcs: '個',
    step3Prompt: '入力内容を確認して見積を依頼してください。',
    sumProcess: '工程',
    sumMaterial: '素材',
    sumWidth: '幅',
    sumHeight: '高さ',
    sumDepth: '奥行',
    sumQty: '数量',
    sumVol: '推定体積',
    instantEstimate: 'リアルタイム見積',
    calculating: '計算中...',
    estimateFailed: '見積計算失敗',
    noEstimate: 'この組合せに適合する見積なし',
    best: '最安値',
    confidence: '信頼度',
    totalLabel: '合計',
    note: '💡 上記価格は参考値です。正式見積はパートナー確認後1-2営業日以内に提供されます。',
    btnQuoteOnly: '見積のみ依頼',
    btnQuoteMatch: '見積 + メーカーマッチング',
  },
  zh: {
    catCncLabel: 'CNC加工',
    catCncDesc: '精密金属/塑料切削',
    catSheetLabel: '钣金',
    catSheetDesc: '折弯·激光切割·焊接',
    catPrint3dLabel: '3D打印',
    catPrint3dDesc: '样品·复杂形状制作',
    catInjectLabel: '注塑成型',
    catInjectDesc: '塑料大批量生产',
    catCastingLabel: '铸造',
    catCastingDesc: '金属复杂形状量产',
    catOtherLabel: '其他',
    catOtherDesc: '按用途推荐工艺',
    matAluminum: '铝 (Al)',
    matSteel: '钢 (Steel)',
    matStainless: '不锈钢 (SUS)',
    matTitanium: '钛 (Ti)',
    matCopper: '铜 (Cu)',
    matBrass: '黄铜 (Brass)',
    matAbs: 'ABS树脂',
    matPla: 'PLA',
    matNylon: '尼龙 (PA)',
    matPc: '聚碳酸酯 (PC)',
    groupMetal: '金属',
    groupPlastic: '塑料',
    stepProcess: '选择工艺',
    stepDim: '基本尺寸',
    stepRequest: '请求报价',
    title: '🚀 快速报价',
    subtitle: '三步快速获取制造报价',
    step1Prompt: '您需要哪种制造工艺?',
    btnNext: '下一步 →',
    btnBack: '上一步',
    step2Prompt: '请输入零件的基本尺寸和材料。',
    labelMaterial: '材料',
    labelWidth: '宽度 (W)',
    labelHeight: '高度 (H)',
    labelDepth: '深度 (D)',
    labelQty: '数量',
    unitPcs: '件',
    step3Prompt: '确认输入信息并请求报价。',
    sumProcess: '工艺',
    sumMaterial: '材料',
    sumWidth: '宽度',
    sumHeight: '高度',
    sumDepth: '深度',
    sumQty: '数量',
    sumVol: '预估体积',
    instantEstimate: '实时预估报价',
    calculating: '计算中...',
    estimateFailed: '报价计算失败',
    noEstimate: '该组合无可用报价',
    best: '最低价',
    confidence: '置信度',
    totalLabel: '总计',
    note: '💡 以上价格为参考预估值。正式报价将在合作方确认后1-2个工作日内提供。',
    btnQuoteOnly: '仅请求报价',
    btnQuoteMatch: '报价 + 工厂匹配',
  },
  es: {
    catCncLabel: 'Mecanizado CNC',
    catCncDesc: 'Corte preciso de metal/plástico',
    catSheetLabel: 'Chapa metálica',
    catSheetDesc: 'Plegado · corte láser · soldadura',
    catPrint3dLabel: 'Impresión 3D',
    catPrint3dDesc: 'Prototipos · formas complejas',
    catInjectLabel: 'Moldeo por inyección',
    catInjectDesc: 'Producción masiva de plástico',
    catCastingLabel: 'Fundición',
    catCastingDesc: 'Producción de piezas metálicas complejas',
    catOtherLabel: 'Otros',
    catOtherDesc: 'Recomendación de proceso por uso',
    matAluminum: 'Aluminio (Al)',
    matSteel: 'Acero (Steel)',
    matStainless: 'Inoxidable (SUS)',
    matTitanium: 'Titanio (Ti)',
    matCopper: 'Cobre (Cu)',
    matBrass: 'Latón (Brass)',
    matAbs: 'Resina ABS',
    matPla: 'PLA',
    matNylon: 'Nailon (PA)',
    matPc: 'Policarbonato (PC)',
    groupMetal: 'Metal',
    groupPlastic: 'Plástico',
    stepProcess: 'Proceso',
    stepDim: 'Dimensiones',
    stepRequest: 'Solicitud',
    title: '🚀 Presupuesto rápido',
    subtitle: 'Obtenga un presupuesto de fabricación en 3 pasos',
    step1Prompt: '¿Qué proceso de fabricación necesita?',
    btnNext: 'Siguiente →',
    btnBack: 'Atrás',
    step2Prompt: 'Introduzca las dimensiones básicas y el material.',
    labelMaterial: 'Material',
    labelWidth: 'Ancho (W)',
    labelHeight: 'Alto (H)',
    labelDepth: 'Profundidad (D)',
    labelQty: 'Cantidad',
    unitPcs: 'uds',
    step3Prompt: 'Revise su información y solicite un presupuesto.',
    sumProcess: 'Proceso',
    sumMaterial: 'Material',
    sumWidth: 'Ancho',
    sumHeight: 'Alto',
    sumDepth: 'Profundidad',
    sumQty: 'Cant.',
    sumVol: 'Volumen est.',
    instantEstimate: 'Presupuesto instantáneo',
    calculating: 'Calculando...',
    estimateFailed: 'Error de presupuesto',
    noEstimate: 'Sin presupuesto disponible',
    best: 'Mejor',
    confidence: 'confianza',
    totalLabel: 'total',
    note: '💡 Los precios anteriores son estimaciones. Los presupuestos formales de los socios llegan en 1-2 días hábiles.',
    btnQuoteOnly: 'Solo presupuesto',
    btnQuoteMatch: 'Presupuesto + Emparejar fábrica',
  },
  ar: {
    catCncLabel: 'تصنيع CNC',
    catCncDesc: 'قطع دقيق للمعدن/البلاستيك',
    catSheetLabel: 'صفائح معدنية',
    catSheetDesc: 'الثني · القطع بالليزر · اللحام',
    catPrint3dLabel: 'طباعة ثلاثية الأبعاد',
    catPrint3dDesc: 'نماذج أولية · أشكال معقدة',
    catInjectLabel: 'الحقن بالقولبة',
    catInjectDesc: 'إنتاج بلاستيك بكميات كبيرة',
    catCastingLabel: 'الصب',
    catCastingDesc: 'إنتاج أشكال معدنية معقدة',
    catOtherLabel: 'أخرى',
    catOtherDesc: 'توصية العملية حسب الاستخدام',
    matAluminum: 'الألومنيوم (Al)',
    matSteel: 'الفولاذ (Steel)',
    matStainless: 'الستانلس (SUS)',
    matTitanium: 'التيتانيوم (Ti)',
    matCopper: 'النحاس (Cu)',
    matBrass: 'النحاس الأصفر (Brass)',
    matAbs: 'راتنج ABS',
    matPla: 'PLA',
    matNylon: 'النايلون (PA)',
    matPc: 'البولي كربونات (PC)',
    groupMetal: 'معدن',
    groupPlastic: 'بلاستيك',
    stepProcess: 'العملية',
    stepDim: 'الأبعاد',
    stepRequest: 'الطلب',
    title: '🚀 عرض سعر سريع',
    subtitle: 'احصل على عرض سعر تصنيع في 3 خطوات',
    step1Prompt: 'ما عملية التصنيع التي تحتاجها؟',
    btnNext: 'التالي →',
    btnBack: 'رجوع',
    step2Prompt: 'أدخل الأبعاد الأساسية والمادة.',
    labelMaterial: 'المادة',
    labelWidth: 'العرض (W)',
    labelHeight: 'الارتفاع (H)',
    labelDepth: 'العمق (D)',
    labelQty: 'الكمية',
    unitPcs: 'قطعة',
    step3Prompt: 'راجع معلوماتك واطلب عرض سعر.',
    sumProcess: 'العملية',
    sumMaterial: 'المادة',
    sumWidth: 'العرض',
    sumHeight: 'الارتفاع',
    sumDepth: 'العمق',
    sumQty: 'الكمية',
    sumVol: 'الحجم التقديري',
    instantEstimate: 'عرض سعر فوري',
    calculating: 'جارٍ الحساب...',
    estimateFailed: 'فشل حساب السعر',
    noEstimate: 'لا يوجد عرض سعر متاح',
    best: 'الأفضل',
    confidence: 'الثقة',
    totalLabel: 'الإجمالي',
    note: '💡 الأسعار أعلاه تقديرية. تصل عروض الأسعار الرسمية من الشركاء خلال 1-2 يوم عمل.',
    btnQuoteOnly: 'عرض سعر فقط',
    btnQuoteMatch: 'عرض سعر + مطابقة المصنع',
  },
} as const;

interface QuoteWizardProps {
  lang: string;
  onClose: () => void;
  onGetQuote: (opts: { category: string; materialId: string; w: number; h: number; d: number; qty: number }) => void;
  initialMaterialId?: string;
  /** 견적 요청 완료 후 제조사 매칭 패널을 열 콜백 */
  onMatchManufacturer?: () => void;
}

type CategoryDef = {
  id: string;
  labelKey: keyof typeof dict.en;
  icon: string;
  descKey: keyof typeof dict.en;
};

const CATEGORIES: CategoryDef[] = [
  { id: 'cnc',      labelKey: 'catCncLabel',     icon: '🔧', descKey: 'catCncDesc' },
  { id: 'sheet',    labelKey: 'catSheetLabel',   icon: '📄', descKey: 'catSheetDesc' },
  { id: 'print3d',  labelKey: 'catPrint3dLabel', icon: '🖨️', descKey: 'catPrint3dDesc' },
  { id: 'inject',   labelKey: 'catInjectLabel',  icon: '💧', descKey: 'catInjectDesc' },
  { id: 'casting',  labelKey: 'catCastingLabel', icon: '🏭', descKey: 'catCastingDesc' },
  { id: 'other',    labelKey: 'catOtherLabel',   icon: '📦', descKey: 'catOtherDesc' },
];

type MaterialGroup = 'metal' | 'plastic';
type MaterialDef = { id: string; labelKey: keyof typeof dict.en; group: MaterialGroup };

const MATERIALS: MaterialDef[] = [
  { id: 'aluminum',       labelKey: 'matAluminum',  group: 'metal' },
  { id: 'steel',          labelKey: 'matSteel',     group: 'metal' },
  { id: 'stainless_steel',labelKey: 'matStainless', group: 'metal' },
  { id: 'titanium',       labelKey: 'matTitanium',  group: 'metal' },
  { id: 'copper',         labelKey: 'matCopper',    group: 'metal' },
  { id: 'brass',          labelKey: 'matBrass',     group: 'metal' },
  { id: 'abs',            labelKey: 'matAbs',       group: 'plastic' },
  { id: 'pla',            labelKey: 'matPla',       group: 'plastic' },
  { id: 'nylon',          labelKey: 'matNylon',     group: 'plastic' },
  { id: 'pc',             labelKey: 'matPc',        group: 'plastic' },
];

const MATERIAL_GROUPS: { key: MaterialGroup; labelKey: keyof typeof dict.en }[] = [
  { key: 'metal',   labelKey: 'groupMetal' },
  { key: 'plastic', labelKey: 'groupPlastic' },
];

// QuoteWizard materialId → /api/nexyfab/estimate materialId 매핑
const MATERIAL_TO_API: Record<string, string> = {
  aluminum: 'aluminum_6061',
  steel: 'steel_s45c',
  stainless_steel: 'stainless_304',
  titanium: 'titanium',
  copper: 'brass',
  brass: 'brass',
  abs: 'abs_plastic',
  pla: 'abs_plastic',
  nylon: 'pom',
  pc: 'pc',
};

// QuoteWizard category → estimate processes
const CATEGORY_TO_PROCESSES: Record<string, string[]> = {
  cnc: ['cnc_milling', 'cnc_turning'],
  sheet: ['sheet_metal'],
  print3d: ['3d_printing'],
  inject: ['injection_molding'],
  casting: ['die_casting'],
  other: ['cnc', 'sheet_metal', '3d_printing'],
};

interface EstimateRow {
  process: string;
  unitCost: number;
  totalCost: number;
  leadTime: string;
  confidence: 'high' | 'medium' | 'low';
}

export default function QuoteWizard({ lang, onClose, onGetQuote, initialMaterialId = 'aluminum', onMatchManufacturer }: QuoteWizardProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState('');
  const [materialId, setMaterialId] = useState(initialMaterialId);
  const [w, setW] = useState(50);
  const [h, setH] = useState(30);
  const [d, setD] = useState(20);
  const [qty, setQty] = useState(1);
  const [estimates, setEstimates] = useState<EstimateRow[] | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  // Step 3 진입 또는 입력 변경 시 실제 견적 API 호출
  useEffect(() => {
    if (step !== 3) return;
    let aborted = false;
    const volume_cm3 = (w * h * d) / 1000;
    const apiMaterial = MATERIAL_TO_API[materialId] ?? 'aluminum_6061';
    const processes = CATEGORY_TO_PROCESSES[category] ?? ['cnc'];

    setEstimateLoading(true);
    setEstimateError(null);
    fetch('/api/nexyfab/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        materialId: apiMaterial,
        volume_cm3,
        complexity: 5,
        quantity: qty,
        processes,
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (aborted) return;
        setEstimates(data.estimates ?? []);
      })
      .catch((err) => {
        if (aborted) return;
        setEstimateError(err instanceof Error ? err.message : 'failed');
        setEstimates(null);
      })
      .finally(() => {
        if (!aborted) setEstimateLoading(false);
      });

    return () => {
      aborted = true;
    };
  }, [step, category, materialId, w, h, d, qty]);

  const stepLabel = (n: number) => {
    return [t.stepProcess, t.stepDim, t.stepRequest][n - 1];
  };

  const handleSubmit = () => {
    onGetQuote({ category, materialId, w, h, d, qty });
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 16,
        width: 520, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, sans-serif',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #30363d',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: 18 }}>
              {t.title}
            </div>
            <div style={{ color: '#8b949e', fontSize: 13, marginTop: 2 }}>
              {t.subtitle}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 20, cursor: 'pointer', padding: 4 }}
          >×</button>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '16px 24px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
          {[1, 2, 3].map((n) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: n < 3 ? 1 : 'none' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: step > n ? '#238636' : step === n ? '#1f6feb' : '#21262d',
                border: `2px solid ${step > n ? '#238636' : step === n ? '#388bfd' : '#30363d'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: step >= n ? '#fff' : '#8b949e', fontSize: 12, fontWeight: 700,
                flexShrink: 0, transition: 'all 0.2s',
              }}>
                {step > n ? '✓' : n}
              </div>
              <span style={{ color: step === n ? '#f0f6fc' : '#8b949e', fontSize: 12, fontWeight: step === n ? 600 : 400, whiteSpace: 'nowrap' }}>
                {stepLabel(n)}
              </span>
              {n < 3 && <div style={{ flex: 1, height: 1, background: step > n ? '#238636' : '#30363d', transition: 'background 0.2s' }} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div style={{ padding: '20px 24px 24px' }}>

          {/* ── STEP 1: Category ── */}
          {step === 1 && (
            <div>
              <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>
                {t.step1Prompt}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    style={{
                      background: category === c.id ? 'rgba(31,111,235,0.15)' : '#21262d',
                      border: `2px solid ${category === c.id ? '#388bfd' : '#30363d'}`,
                      borderRadius: 10, padding: '14px 12px', cursor: 'pointer',
                      textAlign: 'left', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{c.icon}</div>
                    <div style={{ color: '#f0f6fc', fontWeight: 600, fontSize: 14 }}>{t[c.labelKey]}</div>
                    <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>{t[c.descKey]}</div>
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => category && setStep(2)}
                  disabled={!category}
                  style={{
                    background: category ? '#1f6feb' : '#21262d',
                    border: 'none', borderRadius: 8, padding: '10px 24px',
                    color: category ? '#fff' : '#8b949e', fontWeight: 600, fontSize: 14,
                    cursor: category ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
                  }}
                >
                  {t.btnNext}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Dimensions ── */}
          {step === 2 && (
            <div>
              <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 20 }}>
                {t.step2Prompt}
              </div>

              {/* Material picker */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ color: '#8b949e', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                  {t.labelMaterial}
                </label>
                {MATERIAL_GROUPS.map(group => (
                  <div key={group.key} style={{ marginBottom: 10 }}>
                    <div style={{ color: '#6e7681', fontSize: 11, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t[group.labelKey]}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {MATERIALS.filter(m => m.group === group.key).map(m => (
                        <button
                          key={m.id}
                          onClick={() => setMaterialId(m.id)}
                          style={{
                            background: materialId === m.id ? 'rgba(31,111,235,0.2)' : '#21262d',
                            border: `1px solid ${materialId === m.id ? '#388bfd' : '#30363d'}`,
                            borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                            color: materialId === m.id ? '#79c0ff' : '#c9d1d9', fontSize: 12,
                            transition: 'all 0.15s',
                          }}
                        >
                          {t[m.labelKey]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Dimension sliders */}
              {([
                { key: 'w' as const, label: t.labelWidth, val: w, set: setW },
                { key: 'h' as const, label: t.labelHeight, val: h, set: setH },
                { key: 'd' as const, label: t.labelDepth, val: d, set: setD },
              ]).map(({ label, val, set }) => (
                <div key={label} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ color: '#8b949e', fontSize: 12, fontWeight: 600 }}>{label}</label>
                    <span style={{ color: '#f0f6fc', fontSize: 13, fontWeight: 700 }}>{val} mm</span>
                  </div>
                  <input
                    type="range" min={1} max={500} value={val}
                    onChange={e => set(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#388bfd' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6e7681', fontSize: 10 }}>
                    <span>1mm</span><span>500mm</span>
                  </div>
                </div>
              ))}

              {/* Quantity */}
              <div style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ color: '#8b949e', fontSize: 12, fontWeight: 600 }}>{t.labelQty}</label>
                  <span style={{ color: '#f0f6fc', fontSize: 13, fontWeight: 700 }}>{qty} {t.unitPcs}</span>
                </div>
                <input
                  type="range" min={1} max={10000} value={qty}
                  onChange={e => setQty(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#388bfd' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6e7681', fontSize: 10 }}>
                  <span>1</span><span>10,000</span>
                </div>
              </div>

              <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setStep(1)}
                  style={{
                    background: '#21262d', border: '1px solid #30363d', borderRadius: 8,
                    padding: '10px 20px', color: '#c9d1d9', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >← {t.btnBack}</button>
                <button
                  onClick={() => setStep(3)}
                  style={{
                    background: '#1f6feb', border: 'none', borderRadius: 8,
                    padding: '10px 24px', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >{t.btnNext}</button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Summary & submit ── */}
          {step === 3 && (
            <div>
              <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 20 }}>
                {t.step3Prompt}
              </div>

              {/* Summary card */}
              <div style={{
                background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
                padding: '16px 20px', marginBottom: 20,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                  {[
                    { label: t.sumProcess,  value: (() => { const c = CATEGORIES.find(c => c.id === category); return c ? t[c.labelKey] : category; })() },
                    { label: t.sumMaterial, value: (() => { const m = MATERIALS.find(m => m.id === materialId); return m ? t[m.labelKey] : materialId; })() },
                    { label: t.sumWidth,    value: `${w} mm` },
                    { label: t.sumHeight,   value: `${h} mm` },
                    { label: t.sumDepth,    value: `${d} mm` },
                    { label: t.sumQty,      value: `${qty.toLocaleString()} ${t.unitPcs}` },
                    {
                      label: t.sumVol,
                      value: `${((w * h * d) / 1000).toFixed(1)} cm³`,
                    },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ color: '#6e7681', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                      <div style={{ color: '#f0f6fc', fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Real-time price preview */}
              <div style={{
                background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
                padding: '14px 18px', marginBottom: 14,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ color: '#8b949e', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t.instantEstimate}
                  </div>
                  {estimateLoading && (
                    <span style={{ color: '#8b949e', fontSize: 11 }}>
                      {t.calculating}
                    </span>
                  )}
                </div>
                {estimateError && (
                  <div style={{ color: '#f85149', fontSize: 12 }}>
                    {t.estimateFailed}: {estimateError}
                  </div>
                )}
                {!estimateError && estimates && estimates.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {estimates.slice(0, 3).map((est, i) => (
                      <div key={est.process} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 10px', borderRadius: 6,
                        background: i === 0 ? 'rgba(46,160,67,0.1)' : '#161b22',
                        border: `1px solid ${i === 0 ? '#2ea043' : '#30363d'}`,
                      }}>
                        <div>
                          <div style={{ color: '#f0f6fc', fontSize: 13, fontWeight: 600 }}>
                            {est.process}
                            {i === 0 && <span style={{ marginLeft: 6, color: '#2ea043', fontSize: 10 }}>
                              {t.best}
                            </span>}
                          </div>
                          <div style={{ color: '#8b949e', fontSize: 11 }}>
                            {est.leadTime} · {t.confidence} {est.confidence}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: 14 }}>
                            ₩{est.unitCost.toLocaleString()}
                          </div>
                          <div style={{ color: '#8b949e', fontSize: 11 }}>
                            {t.totalLabel} ₩{est.totalCost.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!estimateError && !estimateLoading && estimates && estimates.length === 0 && (
                  <div style={{ color: '#8b949e', fontSize: 12 }}>
                    {t.noEstimate}
                  </div>
                )}
              </div>

              {/* Note */}
              <div style={{
                background: 'rgba(56,139,253,0.1)', border: '1px solid rgba(56,139,253,0.3)',
                borderRadius: 8, padding: '10px 14px', marginBottom: 20,
                color: '#79c0ff', fontSize: 12, lineHeight: 1.5,
              }}>
                {t.note}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setStep(2)}
                  style={{
                    background: '#21262d', border: '1px solid #30363d', borderRadius: 8,
                    padding: '10px 20px', color: '#c9d1d9', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >← {t.btnBack}</button>
                <button
                  onClick={handleSubmit}
                  style={{
                    background: 'linear-gradient(135deg, #21262d, #30363d)',
                    border: '1px solid #30363d', borderRadius: 8, padding: '10px 20px',
                    color: '#c9d1d9', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  {t.btnQuoteOnly}
                </button>
                <button
                  onClick={() => {
                    handleSubmit();
                    if (onMatchManufacturer) {
                      setTimeout(onMatchManufacturer, 300);
                    }
                  }}
                  style={{
                    background: 'linear-gradient(135deg, #238636, #2ea043)',
                    border: 'none', borderRadius: 8, padding: '10px 28px',
                    color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(46,160,67,0.4)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  🚀 {t.btnQuoteMatch}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
