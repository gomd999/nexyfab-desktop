// Portfolio page dictionary.

import type { PartnerLang } from '../partnerLang';

export interface PortfolioDict {
  pageTitle: string;
  pageSubtitle: string;
  statsCompletedCount: string;
  statsCompletedUnit: string;
  statsTotalAmount: string;
  emptyTitle: string;
  emptyHint: string;
  statusCompleted: string;
  attachmentsSuffix: string;
  loading: string;
  amountUndisclosed: string;
  amountSmall: string;
  amountMidSmall: string;
  amountMid: string;
  amountLarge: string;
  amountXLarge: string;
  /** Sidebar fallback when company is missing. */
  fallbackCompany: string;
  lightboxAlt: string;
}

const KO: PortfolioDict = {
  pageTitle: '포트폴리오',
  pageSubtitle: '완료된 프로젝트 실적 현황',
  statsCompletedCount: '완료 건수',
  statsCompletedUnit: '건',
  statsTotalAmount: '총 수주 금액',
  emptyTitle: '아직 완료된 프로젝트가 없습니다.',
  emptyHint: '프로젝트를 완료하면 여기에 표시됩니다.',
  statusCompleted: '완료',
  attachmentsSuffix: '장',
  loading: '불러오는 중...',
  amountUndisclosed: '비공개',
  amountSmall: '소형 프로젝트',
  amountMidSmall: '중소형 프로젝트',
  amountMid: '중형 프로젝트',
  amountLarge: '대형 프로젝트',
  amountXLarge: '특대형 프로젝트',
  fallbackCompany: '파트너',
  lightboxAlt: '원본 이미지',
};

const EN: PortfolioDict = {
  pageTitle: 'Portfolio',
  pageSubtitle: 'Completed project track record',
  statsCompletedCount: 'Completed projects',
  statsCompletedUnit: '',
  statsTotalAmount: 'Total contract value',
  emptyTitle: 'No completed projects yet.',
  emptyHint: 'Completed projects will appear here.',
  statusCompleted: 'Completed',
  attachmentsSuffix: ' photos',
  loading: 'Loading…',
  amountUndisclosed: 'Undisclosed',
  amountSmall: 'Small project',
  amountMidSmall: 'Small-mid project',
  amountMid: 'Mid-size project',
  amountLarge: 'Large project',
  amountXLarge: 'Enterprise project',
  fallbackCompany: 'Partner',
  lightboxAlt: 'Original image',
};

const JA: PortfolioDict = {
  pageTitle: 'ポートフォリオ',
  pageSubtitle: '完了プロジェクトの実績',
  statsCompletedCount: '完了件数',
  statsCompletedUnit: '件',
  statsTotalAmount: '受注総額',
  emptyTitle: 'まだ完了したプロジェクトがありません。',
  emptyHint: 'プロジェクトを完了するとここに表示されます。',
  statusCompleted: '完了',
  attachmentsSuffix: '枚',
  loading: '読み込み中…',
  amountUndisclosed: '非公開',
  amountSmall: '小規模プロジェクト',
  amountMidSmall: '中小規模プロジェクト',
  amountMid: '中規模プロジェクト',
  amountLarge: '大規模プロジェクト',
  amountXLarge: '超大規模プロジェクト',
  fallbackCompany: 'パートナー',
  lightboxAlt: '元画像',
};

const CN: PortfolioDict = {
  pageTitle: '作品集',
  pageSubtitle: '已完成项目业绩',
  statsCompletedCount: '完成数量',
  statsCompletedUnit: '件',
  statsTotalAmount: '总订单金额',
  emptyTitle: '尚未完成任何项目。',
  emptyHint: '完成项目后将在此处显示。',
  statusCompleted: '已完成',
  attachmentsSuffix: '张',
  loading: '加载中…',
  amountUndisclosed: '保密',
  amountSmall: '小型项目',
  amountMidSmall: '中小型项目',
  amountMid: '中型项目',
  amountLarge: '大型项目',
  amountXLarge: '特大型项目',
  fallbackCompany: '合作伙伴',
  lightboxAlt: '原图',
};

const ES: PortfolioDict = {
  pageTitle: 'Portafolio',
  pageSubtitle: 'Historial de proyectos completados',
  statsCompletedCount: 'Proyectos completados',
  statsCompletedUnit: '',
  statsTotalAmount: 'Valor total de contratos',
  emptyTitle: 'Aún no hay proyectos completados.',
  emptyHint: 'Los proyectos completados aparecerán aquí.',
  statusCompleted: 'Completado',
  attachmentsSuffix: ' fotos',
  loading: 'Cargando…',
  amountUndisclosed: 'No revelado',
  amountSmall: 'Proyecto pequeño',
  amountMidSmall: 'Proyecto pequeño-medio',
  amountMid: 'Proyecto mediano',
  amountLarge: 'Proyecto grande',
  amountXLarge: 'Proyecto empresarial',
  fallbackCompany: 'Socio',
  lightboxAlt: 'Imagen original',
};

const AR: PortfolioDict = {
  pageTitle: 'المعرض',
  pageSubtitle: 'سجل المشاريع المنجزة',
  statsCompletedCount: 'المشاريع المنجزة',
  statsCompletedUnit: '',
  statsTotalAmount: 'إجمالي قيمة العقود',
  emptyTitle: 'لا توجد مشاريع منجزة بعد.',
  emptyHint: 'ستظهر هنا المشاريع بعد إنجازها.',
  statusCompleted: 'مكتمل',
  attachmentsSuffix: ' صور',
  loading: 'جارٍ التحميل…',
  amountUndisclosed: 'غير مُعلن',
  amountSmall: 'مشروع صغير',
  amountMidSmall: 'مشروع صغير-متوسط',
  amountMid: 'مشروع متوسط',
  amountLarge: 'مشروع كبير',
  amountXLarge: 'مشروع ضخم',
  fallbackCompany: 'شريك',
  lightboxAlt: 'الصورة الأصلية',
};

export function portfolioDict(lang: PartnerLang): PortfolioDict {
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
