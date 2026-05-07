'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';

const UpgradePrompt = dynamic(() => import('../freemium/UpgradePrompt'), { ssr: false });

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict = {
  ko: {
    panelTitle: '제조사 매칭',
    volumeLabel: '부피',
    allRegions: '전체 지역',
    allProcesses: '전체 공정',
    sortLabel: '정렬:',
    sortMatch: '✦ 매칭',
    sortRating: '평점',
    sortLeadTime: '납기',
    sortPrice: '가격',
    loading: '불러오는 중...',
    proOnlyTitle: 'Pro 플랜 전용 기능',
    proOnlyDesc: '제조사 매칭으로 재질·형상에 가장 적합한 공급사를 자동 추천받고 견적 요청까지 한 번에 진행할 수 있어요.',
    upgradeBtn: 'Pro로 업그레이드',
    featureLabel: '제조사 매칭',
    errFetch: '데이터를 불러오지 못했습니다.',
    noMatches: '조건에 맞는 제조사가 없습니다.',
    topMatch: 'TOP 매칭',
    bizDays: '영업일',
    requestQuote: '견적 요청',
    selectBtn: '선택',
    quoteDone: '견적 요청 완료!',
    quoteDoneDesc: (name: string) => `${name}에 요청이 전달되었습니다.`,
    trackOrder: '주문 현황 보기 →',
    closeBtn: '닫기',
    quoteTitle: '견적 요청',
    qtyLabel: '수량 (개)',
    cancelBtn: '취소',
    submitting: '요청 중...',
    submitBtn: '견적 요청하기',
    matchSuffix: '매칭',
    matchReason: '매칭 이유 보기',
    scoreBreakdownTitle: '매칭 점수 분석',
    breakdownProcessFit: '공정 적합도',
    breakdownSizeFit: '크기 적합도',
    breakdownRating: '평점',
    breakdownLeadTime: '납기',
  },
  en: {
    panelTitle: 'Manufacturer Match',
    volumeLabel: 'Volume',
    allRegions: 'All Regions',
    allProcesses: 'All Processes',
    sortLabel: 'Sort:',
    sortMatch: '✦ Match',
    sortRating: 'Rating',
    sortLeadTime: 'Lead Time',
    sortPrice: 'Price',
    loading: 'Loading...',
    proOnlyTitle: 'Pro Plan Feature',
    proOnlyDesc: 'Manufacturer Match auto-ranks suppliers for your material and geometry, then sends quote requests in one click.',
    upgradeBtn: 'Upgrade to Pro',
    featureLabel: 'Manufacturer Match',
    errFetch: 'Failed to load manufacturers.',
    noMatches: 'No manufacturers match your filters.',
    topMatch: 'TOP MATCH',
    bizDays: 'biz days',
    requestQuote: 'Request Quote',
    selectBtn: 'Select',
    quoteDone: 'Quote Requested!',
    quoteDoneDesc: (name: string) => `Your request was sent to ${name}.`,
    trackOrder: 'Track Order →',
    closeBtn: 'Close',
    quoteTitle: 'Request Quote',
    qtyLabel: 'Quantity (pcs)',
    cancelBtn: 'Cancel',
    submitting: 'Submitting...',
    submitBtn: 'Submit Request',
    matchSuffix: 'match',
    matchReason: 'View match breakdown',
    scoreBreakdownTitle: 'Score Breakdown',
    breakdownProcessFit: 'Process fit',
    breakdownSizeFit: 'Size fit',
    breakdownRating: 'Rating',
    breakdownLeadTime: 'Lead time',
  },
  ja: {
    panelTitle: 'メーカーマッチング',
    volumeLabel: '体積',
    allRegions: '全地域',
    allProcesses: '全工程',
    sortLabel: '並び替え:',
    sortMatch: '✦ マッチ',
    sortRating: '評価',
    sortLeadTime: '納期',
    sortPrice: '価格',
    loading: '読み込み中...',
    proOnlyTitle: 'Proプラン専用機能',
    proOnlyDesc: 'メーカーマッチングで素材や形状に最適なサプライヤーを自動推薦し、見積依頼まで一括で進められます。',
    upgradeBtn: 'Proにアップグレード',
    featureLabel: 'メーカーマッチング',
    errFetch: 'データを読み込めませんでした。',
    noMatches: '条件に合うメーカーがありません。',
    topMatch: 'TOP マッチ',
    bizDays: '営業日',
    requestQuote: '見積依頼',
    selectBtn: '選択',
    quoteDone: '見積依頼完了!',
    quoteDoneDesc: (name: string) => `${name}に依頼を送信しました。`,
    trackOrder: '注文状況を見る →',
    closeBtn: '閉じる',
    quoteTitle: '見積依頼',
    qtyLabel: '数量 (個)',
    cancelBtn: 'キャンセル',
    submitting: '送信中...',
    submitBtn: '見積を依頼',
    matchSuffix: 'マッチ',
    matchReason: 'マッチング理由を見る',
    scoreBreakdownTitle: 'マッチングスコア分析',
    breakdownProcessFit: '工程適合度',
    breakdownSizeFit: 'サイズ適合度',
    breakdownRating: '評価',
    breakdownLeadTime: '納期',
  },
  zh: {
    panelTitle: '工厂匹配',
    volumeLabel: '体积',
    allRegions: '所有地区',
    allProcesses: '所有工艺',
    sortLabel: '排序:',
    sortMatch: '✦ 匹配',
    sortRating: '评分',
    sortLeadTime: '交期',
    sortPrice: '价格',
    loading: '加载中...',
    proOnlyTitle: 'Pro 套餐专属功能',
    proOnlyDesc: '工厂匹配可根据材质和几何形状自动排序供应商,并一键发送报价请求。',
    upgradeBtn: '升级到 Pro',
    featureLabel: '工厂匹配',
    errFetch: '加载工厂失败。',
    noMatches: '没有符合条件的工厂。',
    topMatch: '最佳匹配',
    bizDays: '工作日',
    requestQuote: '请求报价',
    selectBtn: '选择',
    quoteDone: '报价请求已提交!',
    quoteDoneDesc: (name: string) => `请求已发送至 ${name}。`,
    trackOrder: '查看订单状态 →',
    closeBtn: '关闭',
    quoteTitle: '请求报价',
    qtyLabel: '数量 (件)',
    cancelBtn: '取消',
    submitting: '提交中...',
    submitBtn: '提交请求',
    matchSuffix: '匹配',
    matchReason: '查看匹配详情',
    scoreBreakdownTitle: '匹配分数分析',
    breakdownProcessFit: '工艺适配度',
    breakdownSizeFit: '尺寸适配度',
    breakdownRating: '评分',
    breakdownLeadTime: '交期',
  },
  es: {
    panelTitle: 'Emparejamiento de fabricantes',
    volumeLabel: 'Volumen',
    allRegions: 'Todas las regiones',
    allProcesses: 'Todos los procesos',
    sortLabel: 'Ordenar:',
    sortMatch: '✦ Coincidencia',
    sortRating: 'Valoración',
    sortLeadTime: 'Plazo',
    sortPrice: 'Precio',
    loading: 'Cargando...',
    proOnlyTitle: 'Función del plan Pro',
    proOnlyDesc: 'El emparejamiento clasifica automáticamente proveedores según tu material y geometría, y envía solicitudes de presupuesto en un clic.',
    upgradeBtn: 'Actualizar a Pro',
    featureLabel: 'Emparejamiento de fabricantes',
    errFetch: 'Error al cargar fabricantes.',
    noMatches: 'Ningún fabricante coincide con los filtros.',
    topMatch: 'MEJOR COINCIDENCIA',
    bizDays: 'días hábiles',
    requestQuote: 'Solicitar presupuesto',
    selectBtn: 'Seleccionar',
    quoteDone: '¡Presupuesto solicitado!',
    quoteDoneDesc: (name: string) => `Su solicitud fue enviada a ${name}.`,
    trackOrder: 'Seguir pedido →',
    closeBtn: 'Cerrar',
    quoteTitle: 'Solicitar presupuesto',
    qtyLabel: 'Cantidad (uds)',
    cancelBtn: 'Cancelar',
    submitting: 'Enviando...',
    submitBtn: 'Enviar solicitud',
    matchSuffix: 'coincidencia',
    matchReason: 'Ver desglose de coincidencia',
    scoreBreakdownTitle: 'Desglose de puntuación',
    breakdownProcessFit: 'Ajuste de proceso',
    breakdownSizeFit: 'Ajuste de tamaño',
    breakdownRating: 'Valoración',
    breakdownLeadTime: 'Plazo de entrega',
  },
  ar: {
    panelTitle: 'مطابقة المصنع',
    volumeLabel: 'الحجم',
    allRegions: 'جميع المناطق',
    allProcesses: 'جميع العمليات',
    sortLabel: 'الترتيب:',
    sortMatch: '✦ التطابق',
    sortRating: 'التقييم',
    sortLeadTime: 'وقت التسليم',
    sortPrice: 'السعر',
    loading: 'جارٍ التحميل...',
    proOnlyTitle: 'ميزة خطة Pro',
    proOnlyDesc: 'تقوم مطابقة المصنع بترتيب الموردين تلقائيًا حسب المادة والهندسة، ثم إرسال طلبات عروض الأسعار بنقرة واحدة.',
    upgradeBtn: 'الترقية إلى Pro',
    featureLabel: 'مطابقة المصنع',
    errFetch: 'فشل تحميل المصنعين.',
    noMatches: 'لا يوجد مصنعون يطابقون عوامل التصفية.',
    topMatch: 'أفضل تطابق',
    bizDays: 'أيام عمل',
    requestQuote: 'طلب عرض سعر',
    selectBtn: 'اختيار',
    quoteDone: 'تم طلب عرض السعر!',
    quoteDoneDesc: (name: string) => `تم إرسال طلبك إلى ${name}.`,
    trackOrder: 'تتبع الطلب →',
    closeBtn: 'إغلاق',
    quoteTitle: 'طلب عرض سعر',
    qtyLabel: 'الكمية (قطعة)',
    cancelBtn: 'إلغاء',
    submitting: 'جارٍ الإرسال...',
    submitBtn: 'إرسال الطلب',
    matchSuffix: 'تطابق',
    matchReason: 'عرض تفاصيل التطابق',
    scoreBreakdownTitle: 'تحليل نقاط التطابق',
    breakdownProcessFit: 'ملاءمة العملية',
    breakdownSizeFit: 'ملاءمة الحجم',
    breakdownRating: 'التقييم',
    breakdownLeadTime: 'وقت التسليم',
  },
} as const;

function resolveLang(seg: string | undefined): Lang {
  const map: Record<string, Lang> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  return map[seg ?? ''] ?? 'en';
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Manufacturer {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  processes: string[];
  minLeadTime: number;
  maxLeadTime: number;
  rating: number;
  reviewCount: number;
  priceLevel: 'low' | 'medium' | 'high';
  certifications: string[];
  description: string;
  descriptionKo: string;
  /** /partner/metrics-batch 다차원 지표 조회 키. 파트너 미등록 공장은 null. */
  partnerEmail?: string | null;
}

interface ManufacturerMatchProps {
  process?: string;
  volume_cm3?: number;
  materialId?: string;
  bbox?: { w: number; h: number; d: number };
  lang?: string;
  partName?: string;
  /** Approximate triangle count — a complexity signal (organic shapes favor 3D printing). */
  triangleCount?: number;
  /** Whether the design has overhangs/undercuts that would be impossible on CNC. */
  hasUndercuts?: boolean;
  onSelectManufacturer: (m: Manufacturer) => void;
}

interface QuoteState {
  manufacturer: Manufacturer;
  quantity: number;
  submitting: boolean;
  orderId?: string;  // set on success
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  textMuted: '#6e7681',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
};

const REGION_FLAGS: Record<string, string> = {
  KR: '🇰🇷',
  US: '🇺🇸',
  DE: '🇩🇪',
  CN: '🇨🇳',
  JP: '🇯🇵',
};

const REGION_LABELS: Record<string, Record<Lang, string>> = {
  KR: { en: 'Korea',    ko: '한국',   ja: '韓国',   zh: '韩国',   es: 'Corea',    ar: 'كوريا' },
  US: { en: 'USA',      ko: '미국',   ja: 'アメリカ', zh: '美国',   es: 'EE. UU.',  ar: 'الولايات المتحدة' },
  DE: { en: 'Germany',  ko: '독일',   ja: 'ドイツ',  zh: '德国',   es: 'Alemania', ar: 'ألمانيا' },
  CN: { en: 'China',    ko: '중국',   ja: '中国',   zh: '中国',   es: 'China',    ar: 'الصين' },
  JP: { en: 'Japan',    ko: '일본',   ja: '日本',   zh: '日本',   es: 'Japón',    ar: 'اليابان' },
};

const PROCESS_LABELS: Record<string, Record<Lang, string>> = {
  cnc_milling:       { en: 'CNC Milling',       ko: 'CNC 밀링',   ja: 'CNCフライス加工', zh: 'CNC铣削',      es: 'Fresado CNC',        ar: 'فرز CNC' },
  cnc_turning:       { en: 'CNC Turning',        ko: 'CNC 선반',   ja: 'CNC旋盤',        zh: 'CNC车削',      es: 'Torneado CNC',       ar: 'خراطة CNC' },
  injection_molding: { en: 'Injection Molding',  ko: '사출 성형',   ja: '射出成形',       zh: '注塑成型',      es: 'Moldeo por inyección', ar: 'حقن بالقولبة' },
  sheet_metal:       { en: 'Sheet Metal',        ko: '판금 가공',   ja: '板金',           zh: '钣金',          es: 'Chapa metálica',     ar: 'صفائح معدنية' },
  casting:           { en: 'Casting',            ko: '주조',        ja: '鋳造',           zh: '铸造',          es: 'Fundición',          ar: 'الصب' },
  '3d_printing':     { en: '3D Printing',        ko: '3D 프린팅',   ja: '3Dプリンティング', zh: '3D打印',       es: 'Impresión 3D',       ar: 'طباعة ثلاثية الأبعاد' },
};

const PRICE_META: Record<string, { labels: Record<Lang, string>; color: string }> = {
  low:    { color: '#3fb950', labels: { en: 'Low',    ko: '저가', ja: '低価格', zh: '低价', es: 'Bajo',   ar: 'منخفض' } },
  medium: { color: '#d29922', labels: { en: 'Medium', ko: '중가', ja: '中価格', zh: '中价', es: 'Medio',  ar: 'متوسط' } },
  high:   { color: '#f0883e', labels: { en: 'High',   ko: '고가', ja: '高価格', zh: '高价', es: 'Alto',   ar: 'مرتفع' } },
};

// Rough KRW-per-cm³ for a finished part, covering material + machining + margin.
// Order-of-magnitude only — real quotes come from the mfr after RFQ review.
const MATERIAL_BASE_KRW_PER_CM3: Record<string, number> = {
  aluminum:        350,
  steel:           280,
  stainless_steel: 520,
  titanium:        1800,
  copper:          900,
  brass:           750,
  abs:             120,
  pla:             90,
  nylon:           180,
  pc:              220,
  resin:           260,
  wood:            80,
  default:         300,
};

const PRICE_LEVEL_MULT: Record<'low' | 'medium' | 'high', number> = {
  low:    0.8,
  medium: 1.0,
  high:   1.35,
};

const MIN_ORDER_KRW = 30_000;

function estimateOrderTotalKRW(
  volume_cm3: number | undefined,
  materialId: string | undefined,
  priceLevel: 'low' | 'medium' | 'high',
  quantity: number,
): number {
  const vol = volume_cm3 && volume_cm3 > 0 ? volume_cm3 : 10;
  const base = MATERIAL_BASE_KRW_PER_CM3[materialId ?? ''] ?? MATERIAL_BASE_KRW_PER_CM3.default;
  const unit = vol * base * PRICE_LEVEL_MULT[priceLevel];
  return Math.max(MIN_ORDER_KRW, Math.round(unit * Math.max(1, quantity)));
}

type SortKey = 'match' | 'lead_time' | 'rating' | 'price';

const ALL_REGIONS = ['KR', 'US', 'DE', 'CN', 'JP'];
const ALL_PROCESSES = Object.keys(PROCESS_LABELS);

// ─── Material → best processes ───────────────────────────────────────────────

const MATERIAL_PROCESS_AFFINITY: Record<string, string[]> = {
  aluminum:        ['cnc_milling', 'cnc_turning', 'sheet_metal', '3d_printing'],
  steel:           ['cnc_milling', 'cnc_turning', 'casting', 'sheet_metal'],
  stainless_steel: ['cnc_milling', 'cnc_turning', '3d_printing'],
  titanium:        ['3d_printing', 'cnc_milling', 'cnc_turning'],
  copper:          ['cnc_milling', 'cnc_turning', 'casting'],
  brass:           ['cnc_milling', 'cnc_turning'],
  abs:             ['3d_printing', 'injection_molding'],
  pla:             ['3d_printing'],
  nylon:           ['3d_printing', 'injection_molding'],
  pc:              ['3d_printing', 'injection_molding'],
  resin:           ['3d_printing'],
  wood:            ['cnc_milling'],
  default:         ['cnc_milling', 'cnc_turning', '3d_printing'],
};

// Materials where 3D printing is a viable / often-preferred route
const PRINTABLE_MATERIALS = new Set([
  'abs', 'pla', 'nylon', 'pc', 'resin', 'aluminum', 'titanium', 'stainless_steel',
]);

interface ScoreBreakdown {
  processAffinity: number;
  sizeFit: number;
  rating: number;
  leadTime: number;
  total: number;
}

/**
 * Compute a 0-100 match score for a manufacturer given the current shape context.
 * Returns both total score and per-category breakdown for UI display.
 */
function computeMatchScore(
  m: Manufacturer,
  materialId: string | undefined,
  bbox: { w: number; h: number; d: number } | undefined,
  ctx?: { triangleCount?: number; hasUndercuts?: boolean },
): { score: number; breakdown: ScoreBreakdown } {
  const maxDim = bbox ? Math.max(bbox.w, bbox.h, bbox.d) : 150;
  const isPrintable = PRINTABLE_MATERIALS.has(materialId ?? '');
  const triCount = ctx?.triangleCount ?? 0;
  const isComplex = triCount > 5000;
  const isVeryComplex = triCount > 20000;
  const isSmall = maxDim < 100;
  const hasUndercuts = ctx?.hasUndercuts ?? false;

  let printPreferenceScore = 0;
  if (isPrintable)    printPreferenceScore += 1;
  if (isSmall)        printPreferenceScore += 1;
  if (isComplex)      printPreferenceScore += 1;
  if (isVeryComplex)  printPreferenceScore += 1;
  if (hasUndercuts)   printPreferenceScore += 2;
  const prefersPrinting = printPreferenceScore >= 2;

  // ── Process affinity (0–45 pts) ──
  const affinities = MATERIAL_PROCESS_AFFINITY[materialId ?? ''] ?? MATERIAL_PROCESS_AFFINITY.default;
  const hasAffinity = m.processes.some(p => affinities.includes(p));
  const primaryMatch = m.processes[0] && affinities[0] && m.processes[0] === affinities[0];
  const offers3DPrinting = m.processes.includes('3d_printing');

  let affinityScore = hasAffinity ? (primaryMatch ? 40 : 28) : 8;
  if (prefersPrinting && offers3DPrinting) {
    affinityScore = Math.max(affinityScore, 40) + Math.min(5, printPreferenceScore);
  }
  if (hasUndercuts && !offers3DPrinting) affinityScore -= 10;
  const processAffinity = Math.max(0, Math.min(45, affinityScore));

  // ── Size fit (0–25 pts) ──
  const baseSize = maxDim < 50 ? (m.minLeadTime <= 5 ? 25 : 18) : maxDim < 300 ? 25 : maxDim < 600 ? 20 : 12;
  const sizeFit = Math.min(28, isSmall && offers3DPrinting ? baseSize + 3 : baseSize);

  // ── Rating (0–20 pts) ──
  const rating = Math.round((m.rating / 5) * 20);

  // ── Lead time (0–15 pts) ──
  const leadTime = m.minLeadTime <= 5 ? 15 : m.minLeadTime <= 10 ? 10 : m.minLeadTime <= 20 ? 5 : 2;

  const total = Math.min(100, Math.round(processAffinity + sizeFit + rating + leadTime));
  return { score: total, breakdown: { processAffinity, sizeFit, rating, leadTime, total } };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderStars(rating: number) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span style={{ color: '#d29922', fontSize: 12 }}>
      {'★'.repeat(full)}
      {half ? '½' : ''}
      {'☆'.repeat(5 - full - (half ? 1 : 0))}
      <span style={{ color: C.textMuted, marginLeft: 4 }}>{rating.toFixed(1)}</span>
    </span>
  );
}

function priceLevelSort(p: 'low' | 'medium' | 'high'): number {
  return p === 'low' ? 0 : p === 'medium' ? 1 : 2;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManufacturerMatch({
  process: initialProcess,
  volume_cm3,
  materialId,
  bbox,
  lang = 'ko',
  partName,
  triangleCount,
  hasUndercuts,
  onSelectManufacturer,
}: ManufacturerMatchProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const L = resolveLang(seg);
  const t = dict[L];
  const isKo = L === 'ko' || isKorean(lang ?? 'en');

  const [all, setAll] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPro, setRequiresPro] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null);

  // Filters
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [processFilter, setProcessFilter] = useState<string>(initialProcess ?? '');
  const [sortBy, setSortBy] = useState<SortKey>('match');

  // Fetch manufacturers — Pro-gated; surface upgrade CTA on 403 instead of dead-end error.
  const fetchManufacturers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRequiresPro(false);

    const url = new URL('/api/nexyfab/manufacturers', window.location.origin);
    if (processFilter) url.searchParams.set('process', processFilter);
    if (regionFilter) url.searchParams.set('region', regionFilter);

    try {
      const res = await fetch(url.toString());
      if (res.status === 403) {
        const body = await res.json().catch(() => ({} as { requiresPro?: boolean }));
        if (body?.requiresPro) {
          setRequiresPro(true);
          setAll([]);
          return;
        }
      }
      if (!res.ok) {
        setError(t.errFetch);
        return;
      }
      const data = await res.json() as { manufacturers?: Manufacturer[] };
      setAll(data.manufacturers ?? []);
    } catch {
      setError(t.errFetch);
    } finally {
      setLoading(false);
    }
  }, [processFilter, regionFilter, t]);

  useEffect(() => {
    fetchManufacturers();
  }, [fetchManufacturers]);

  // Attach match scores — only recompute when data or shape context changes, NOT on sort change
  const scored = useMemo(
    () => all.map(m => {
      const { score, breakdown } = computeMatchScore(m, materialId, bbox, { triangleCount, hasUndercuts });
      return { ...m, matchScore: score, scoreBreakdown: breakdown };
    }),
    [all, materialId, bbox, triangleCount, hasUndercuts],
  );

  // Sort — recompute only when scored list or sort key changes
  const sorted = useMemo(() => {
    return [...scored].sort((a, b) => {
      if (sortBy === 'match')     return b.matchScore - a.matchScore;
      if (sortBy === 'lead_time') return a.minLeadTime - b.minLeadTime;
      if (sortBy === 'rating')    return b.rating - a.rating;
      if (sortBy === 'price')     return priceLevelSort(a.priceLevel) - priceLevelSort(b.priceLevel);
      return 0;
    });
  }, [scored, sortBy]);

  const topScore = sorted[0]?.matchScore ?? 0;

  // ── Quote request ───────────────────────────────────────────────────────────

  const handleOpenQuote = useCallback((m: Manufacturer) => {
    setQuoteState({ manufacturer: m, quantity: 1, submitting: false });
  }, []);

  const handleSubmitQuote = useCallback(async () => {
    if (!quoteState) return;
    setQuoteState(s => s ? { ...s, submitting: true, error: undefined } : s);
    try {
      const mfr = quoteState.manufacturer;
      const totalPriceKRW = estimateOrderTotalKRW(
        volume_cm3,
        materialId,
        mfr.priceLevel,
        quoteState.quantity,
      );
      const res = await fetch('/api/nexyfab/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partName: partName ?? 'Custom Part',
          manufacturerName: isKo ? mfr.nameKo : mfr.name,
          quantity: quoteState.quantity,
          totalPriceKRW,
          estimatedLeadDays: mfr.minLeadTime,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setQuoteState(s => s ? { ...s, submitting: false, orderId: data.order?.id ?? 'new' } : s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setQuoteState(s => s ? { ...s, submitting: false, error: msg } : s);
    }
  }, [quoteState, partName, materialId, volume_cm3, isKo]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: C.text,
      position: 'relative',
    }}>

      {/* ── Quote request modal ── */}
      {quoteState && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          background: 'rgba(13,17,23,0.88)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 12,
        }}>
          <div style={{
            background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
            padding: '24px 28px', width: 320, boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          }}>
            {quoteState.orderId ? (
              /* ── Success state ── */
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#3fb950', marginBottom: 6 }}>
                  {t.quoteDone}
                </p>
                <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 20, lineHeight: 1.5 }}>
                  {t.quoteDoneDesc(isKo ? quoteState.manufacturer.nameKo : quoteState.manufacturer.name)}
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <a
                    href={`/${lang}/nexyfab/orders`}
                    style={{
                      display: 'block', padding: '8px 20px', borderRadius: 8,
                      background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                      color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                    }}
                  >
                    {t.trackOrder}
                  </a>
                  <button
                    onClick={() => setQuoteState(null)}
                    style={{
                      padding: '8px 14px', borderRadius: 8, border: '1px solid #30363d',
                      background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {t.closeBtn}
                  </button>
                </div>
              </div>
            ) : (
              /* ── Form state ── */
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>
                  {t.quoteTitle}
                </div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 18 }}>
                  {isKo ? quoteState.manufacturer.nameKo : quoteState.manufacturer.name}
                  {partName && <> · {partName}</>}
                </div>

                <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 6 }}>
                  {t.qtyLabel}
                </label>
                <input
                  type="number"
                  min={1}
                  value={quoteState.quantity}
                  onChange={e => setQuoteState(s => s ? { ...s, quantity: Math.max(1, parseInt(e.target.value) || 1) } : s)}
                  style={{
                    width: '100%', padding: '7px 10px', borderRadius: 6,
                    border: '1px solid #30363d', background: '#0d1117',
                    color: '#e6edf3', fontSize: 13, outline: 'none',
                    boxSizing: 'border-box', marginBottom: 16,
                  }}
                />

                {quoteState.error && (
                  <p style={{ fontSize: 11, color: '#f85149', marginBottom: 12 }}>
                    {quoteState.error}
                  </p>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setQuoteState(null)}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #30363d',
                      background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {t.cancelBtn}
                  </button>
                  <button
                    onClick={handleSubmitQuote}
                    disabled={quoteState.submitting}
                    style={{
                      flex: 2, padding: '8px 0', borderRadius: 8, border: 'none',
                      background: quoteState.submitting ? '#388bfd88' : 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                      color: '#fff', fontSize: 12, fontWeight: 700, cursor: quoteState.submitting ? 'default' : 'pointer',
                    }}
                  >
                    {quoteState.submitting ? t.submitting : t.submitBtn}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Panel header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>🏭</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>
          {t.panelTitle}
        </span>
        {volume_cm3 !== undefined && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: C.textMuted,
          }}>
            {`${t.volumeLabel}: ${volume_cm3.toFixed(1)} cm³`}
          </span>
        )}
      </div>

      {/* Filter / Sort row */}
      <div style={{
        padding: '10px 18px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
      }}>
        {/* Region selector */}
        <select
          value={regionFilter}
          onChange={e => setRegionFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="">{t.allRegions}</option>
          {ALL_REGIONS.map(r => (
            <option key={r} value={r}>
              {REGION_FLAGS[r]} {REGION_LABELS[r]?.[L] ?? r}
            </option>
          ))}
        </select>

        {/* Process selector */}
        <select
          value={processFilter}
          onChange={e => setProcessFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="">{t.allProcesses}</option>
          {ALL_PROCESSES.map(p => (
            <option key={p} value={p}>
              {PROCESS_LABELS[p]?.[L] ?? p}
            </option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        {/* Sort */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: C.textMuted }}>
            {t.sortLabel}
          </span>
          {(['match', 'rating', 'lead_time', 'price'] as SortKey[]).map(key => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: `1px solid ${sortBy === key ? C.accent : C.border}`,
                background: sortBy === key ? `${C.accent}20` : 'transparent',
                color: sortBy === key ? C.accent : C.textDim,
                fontSize: 11,
                cursor: 'pointer',
                fontWeight: sortBy === key ? 700 : 400,
              }}
            >
              {key === 'match'     ? t.sortMatch
               : key === 'rating'    ? t.sortRating
               : key === 'lead_time' ? t.sortLeadTime
               : t.sortPrice}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ maxHeight: 460, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.textMuted }}>
            {t.loading}
          </div>
        ) : requiresPro ? (
          <div style={{ padding: '36px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', margin: '0 0 6px' }}>
              {t.proOnlyTitle}
            </p>
            <p style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6, margin: '0 0 18px', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
              {t.proOnlyDesc}
            </p>
            <button
              onClick={() => setShowUpgradeModal(true)}
              style={{
                padding: '9px 20px', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ⚡ {t.upgradeBtn}
            </button>
            <UpgradePrompt
              open={showUpgradeModal}
              onClose={() => setShowUpgradeModal(false)}
              feature="Manufacturer Match"
              featureKo="제조사 매칭"
              requiredPlan="pro"
              lang={lang}
            />
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#f85149' }}>
            {error}
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.textMuted }}>
            {t.noMatches}
          </div>
        ) : (
          sorted.map((m, idx) => (
            <ManufacturerCard
              key={m.id}
              manufacturer={m}
              matchScore={m.matchScore}
              scoreBreakdown={m.scoreBreakdown}
              isTopMatch={idx === 0 && m.matchScore >= 70 && m.matchScore === topScore}
              isKo={isKo}
              L={L}
              t={t}
              onSelect={() => onSelectManufacturer(m)}
              onRequestQuote={() => handleOpenQuote(m)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── ManufacturerCard ─────────────────────────────────────────────────────────

interface ManufacturerCardProps {
  manufacturer: Manufacturer;
  matchScore: number;
  scoreBreakdown?: ScoreBreakdown;
  isTopMatch: boolean;
  isKo: boolean;
  L: Lang;
  t: typeof dict[Lang];
  onSelect: () => void;
  onRequestQuote: () => void;
}

function ManufacturerCard({ manufacturer: m, matchScore, scoreBreakdown, isTopMatch, isKo, L, t, onSelect, onRequestQuote }: ManufacturerCardProps) {
  const [hovered, setHovered] = useState(false);
  const price = PRICE_META[m.priceLevel];
  const flag = REGION_FLAGS[m.region] ?? '🌐';
  const scoreColor = matchScore >= 85 ? '#3fb950' : matchScore >= 65 ? '#d29922' : '#8b949e';

  return (
    <div
      style={{
        padding: '14px 18px',
        borderBottom: `1px solid ${C.border}`,
        background: hovered ? C.card : 'transparent',
        transition: 'background 0.12s',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
    >
      {/* Flag + region */}
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: '#0d1117',
        border: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        flexShrink: 0,
      }}>
        {flag}
      </div>

      {/* Main info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
            {isKo ? m.nameKo : m.name}
          </span>
          {isTopMatch && (
            <span style={{
              fontSize: 9, padding: '2px 7px', borderRadius: 10,
              background: 'linear-gradient(90deg,#388bfd,#8b5cf6)', color: '#fff', fontWeight: 800,
            }}>
              ✦ {t.topMatch}
            </span>
          )}
          <span style={{
            fontSize: 9,
            padding: '2px 6px',
            borderRadius: 4,
            background: `${price.color}20`,
            color: price.color,
            fontWeight: 700,
          }}>
            {price.labels[L]}
          </span>
        </div>

        {/* Stars + review count */}
        <div style={{ marginBottom: 6 }}>
          {renderStars(m.rating)}
          <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 4 }}>
            ({m.reviewCount.toLocaleString()})
          </span>
        </div>

        {/* Processes */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {m.processes.map(p => (
            <span key={p} style={{
              fontSize: 10,
              padding: '2px 7px',
              borderRadius: 4,
              background: '#388bfd18',
              color: C.accent,
              border: `1px solid #388bfd30`,
            }}>
              {PROCESS_LABELS[p]?.[L] ?? p}
            </span>
          ))}
        </div>

        {/* Description */}
        <p style={{ margin: 0, fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
          {isKo ? m.descriptionKo : m.description}
        </p>

        {/* Certs */}
        {m.certifications.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            {m.certifications.map(c => (
              <span key={c} style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 3,
                background: '#3fb95015',
                color: C.green,
                border: `1px solid #3fb95030`,
              }}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Match score + lead time + select button */}
      <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        {/* Match score meter — multi-dim breakdown always visible */}
        <div style={{ textAlign: 'right', width: 120 }}>
          <div style={{ fontSize: 10, color: scoreColor, fontWeight: 700, marginBottom: 3, textAlign: 'right' }}>
            {matchScore}% {t.matchSuffix}
          </div>
          <div style={{ width: '100%', height: 4, background: '#21262d', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{
              width: `${matchScore}%`, height: '100%', borderRadius: 3,
              background: matchScore >= 85 ? '#3fb950' : matchScore >= 65 ? '#d29922' : '#8b949e',
              transition: 'width 0.4s ease',
            }} />
          </div>
          {scoreBreakdown && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {([
                { key: 'processAffinity', labelKey: 'breakdownProcessFit' as const, max: 45 },
                { key: 'sizeFit',         labelKey: 'breakdownSizeFit' as const,    max: 28 },
                { key: 'rating',          labelKey: 'breakdownRating' as const,     max: 20 },
                { key: 'leadTime',        labelKey: 'breakdownLeadTime' as const,   max: 15 },
              ] as const).map(({ key, labelKey, max }) => {
                const val = scoreBreakdown[key];
                const pct = Math.round((val / max) * 100);
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
                    <span style={{ color: '#8b949e', flex: '0 0 auto', minWidth: 40, textAlign: 'left' }}>{t[labelKey]}</span>
                    <div style={{ flex: 1, height: 3, background: '#21262d', borderRadius: 2 }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: pct >= 80 ? '#3fb950' : pct >= 50 ? '#d29922' : '#8b949e' }} />
                    </div>
                    <span style={{ color: '#c9d1d9', flex: '0 0 auto', minWidth: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: C.text }}>
            {m.minLeadTime}–{m.maxLeadTime}
          </p>
          <p style={{ margin: 0, fontSize: 10, color: C.textMuted }}>
            {t.bizDays}
          </p>
        </div>

        <button
          onClick={e => { e.stopPropagation(); onRequestQuote(); }}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: 'none',
            background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t.requestQuote}
        </button>
        <button
          onClick={e => { e.stopPropagation(); onSelect(); }}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            background: 'transparent',
            color: C.textDim,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'border-color 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {t.selectBtn}
        </button>
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: `1px solid ${C.border}`,
  background: '#0d1117',
  color: C.text,
  fontSize: 12,
  outline: 'none',
  cursor: 'pointer',
};
