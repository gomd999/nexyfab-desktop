// Partner-portal dictionary. All 6 locales (ko / en / ja / cn / es / ar)
// shipped. UI routes through `usePartnerLang`. Treat copy below as the
// first cut — partner-ops team can refine before each market launch.

import type { PartnerLang } from './partnerLang';

export interface PartnerDict {
  /** Brand subtitle below the NexyFab logo */
  brandSubtitle: string;
  hubTitle: string;
  hubSubtitle: string;
  /** Nav labels */
  navHub: string;
  navDashboard: string;
  navProjects: string;
  navQuotes: string;
  navOrders: string;
  navRma: string;
  navSettlements: string;
  navPortfolio: string;
  navProfile: string;
  navLogout: string;

  /** Hub cards */
  cardTodayRfqTitle: string;
  cardTodayRfqDesc: string;
  cardSettlementTitle: string;
  cardSettlementDesc: string;
  cardPortfolioTitle: string;
  cardPortfolioDesc: string;

  /** Onboarding funnel */
  funnelHeader: string;
  funnelStep1: string;
  funnelStep2: string;
  funnelStep3: string;
  funnelStep4: string;

  emptyTodayRfq: string;
  loadingLabel: string;
  goBackToCustomerSurface: string;
}

const KO: PartnerDict = {
  brandSubtitle: '파트너 포털',
  hubTitle: '안녕하세요',
  hubSubtitle: '오늘의 견적 요청과 정산 현황입니다.',
  navHub: '홈',
  navDashboard: '대시보드',
  navProjects: '프로젝트',
  navQuotes: '견적',
  navOrders: '주문',
  navRma: 'RMA·불량',
  navSettlements: '정산',
  navPortfolio: '포트폴리오',
  navProfile: '프로필',
  navLogout: '로그아웃',

  cardTodayRfqTitle: '오늘의 RFQ',
  cardTodayRfqDesc: '응답 대기 중인 신규 견적 요청',
  cardSettlementTitle: '정산 예정',
  cardSettlementDesc: '다음 정산일까지 누적 금액',
  cardPortfolioTitle: '포트폴리오 조회',
  cardPortfolioDesc: '지난 7일간 고객사 조회수',

  funnelHeader: '입점 진행 상황',
  funnelStep1: '계정 생성',
  funnelStep2: '프로필 작성',
  funnelStep3: '포트폴리오 등록',
  funnelStep4: '첫 RFQ 응답',

  emptyTodayRfq: '응답 대기 중인 신규 RFQ가 없습니다.',
  loadingLabel: '불러오는 중…',
  goBackToCustomerSurface: '고객사 화면으로',
};

const EN: PartnerDict = {
  brandSubtitle: 'Partner portal',
  hubTitle: 'Welcome back',
  hubSubtitle: "Today's RFQs and settlement summary.",
  navHub: 'Hub',
  navDashboard: 'Dashboard',
  navProjects: 'Projects',
  navQuotes: 'Quotes',
  navOrders: 'Orders',
  navRma: 'RMA · Defects',
  navSettlements: 'Settlements',
  navPortfolio: 'Portfolio',
  navProfile: 'Profile',
  navLogout: 'Log out',

  cardTodayRfqTitle: "Today's RFQs",
  cardTodayRfqDesc: 'New quote requests awaiting your response',
  cardSettlementTitle: 'Upcoming settlement',
  cardSettlementDesc: 'Accrued amount until the next payout',
  cardPortfolioTitle: 'Portfolio views',
  cardPortfolioDesc: 'Customer views in the last 7 days',

  funnelHeader: 'Onboarding progress',
  funnelStep1: 'Create account',
  funnelStep2: 'Complete profile',
  funnelStep3: 'Upload portfolio',
  funnelStep4: 'Respond to first RFQ',

  emptyTodayRfq: 'No new RFQs awaiting your response right now.',
  loadingLabel: 'Loading…',
  goBackToCustomerSurface: 'Back to customer site',
};

const JA: PartnerDict = {
  brandSubtitle: 'パートナーポータル',
  hubTitle: 'おかえりなさい',
  hubSubtitle: '本日のRFQと精算サマリーです。',
  navHub: 'ホーム',
  navDashboard: 'ダッシュボード',
  navProjects: 'プロジェクト',
  navQuotes: '見積もり',
  navOrders: '注文',
  navRma: 'RMA・不良',
  navSettlements: '精算',
  navPortfolio: 'ポートフォリオ',
  navProfile: 'プロフィール',
  navLogout: 'ログアウト',

  cardTodayRfqTitle: '本日のRFQ',
  cardTodayRfqDesc: '回答待ちの新規見積依頼',
  cardSettlementTitle: '精算予定',
  cardSettlementDesc: '次回精算日までの累計金額',
  cardPortfolioTitle: 'ポートフォリオ閲覧',
  cardPortfolioDesc: '過去7日間の顧客閲覧数',

  funnelHeader: 'オンボーディング進捗',
  funnelStep1: 'アカウント作成',
  funnelStep2: 'プロフィール入力',
  funnelStep3: 'ポートフォリオ登録',
  funnelStep4: '初回RFQに回答',

  emptyTodayRfq: '回答待ちの新規RFQはありません。',
  loadingLabel: '読み込み中…',
  goBackToCustomerSurface: '顧客サイトに戻る',
};

const CN: PartnerDict = {
  brandSubtitle: '合作伙伴门户',
  hubTitle: '欢迎回来',
  hubSubtitle: '今日的RFQ和结算摘要。',
  navHub: '首页',
  navDashboard: '仪表板',
  navProjects: '项目',
  navQuotes: '报价',
  navOrders: '订单',
  navRma: 'RMA·不良品',
  navSettlements: '结算',
  navPortfolio: '作品集',
  navProfile: '资料',
  navLogout: '退出',

  cardTodayRfqTitle: '今日RFQ',
  cardTodayRfqDesc: '等待您回应的新报价请求',
  cardSettlementTitle: '即将结算',
  cardSettlementDesc: '截至下次结算日的累计金额',
  cardPortfolioTitle: '作品集浏览',
  cardPortfolioDesc: '过去7天客户浏览次数',

  funnelHeader: '入驻进度',
  funnelStep1: '创建账户',
  funnelStep2: '完善资料',
  funnelStep3: '上传作品集',
  funnelStep4: '回应首个RFQ',

  emptyTodayRfq: '当前没有等待回应的新RFQ。',
  loadingLabel: '加载中…',
  goBackToCustomerSurface: '返回客户站点',
};

const ES: PartnerDict = {
  brandSubtitle: 'Portal de socios',
  hubTitle: 'Bienvenido de nuevo',
  hubSubtitle: 'Resumen de RFQs y liquidaciones de hoy.',
  navHub: 'Inicio',
  navDashboard: 'Panel',
  navProjects: 'Proyectos',
  navQuotes: 'Cotizaciones',
  navOrders: 'Pedidos',
  navRma: 'RMA · Defectos',
  navSettlements: 'Liquidaciones',
  navPortfolio: 'Portafolio',
  navProfile: 'Perfil',
  navLogout: 'Cerrar sesión',

  cardTodayRfqTitle: 'RFQs de hoy',
  cardTodayRfqDesc: 'Nuevas solicitudes pendientes de tu respuesta',
  cardSettlementTitle: 'Próxima liquidación',
  cardSettlementDesc: 'Importe acumulado hasta la próxima fecha de pago',
  cardPortfolioTitle: 'Vistas de portafolio',
  cardPortfolioDesc: 'Vistas de clientes en los últimos 7 días',

  funnelHeader: 'Progreso de incorporación',
  funnelStep1: 'Crear cuenta',
  funnelStep2: 'Completar perfil',
  funnelStep3: 'Subir portafolio',
  funnelStep4: 'Responder primera RFQ',

  emptyTodayRfq: 'No hay RFQs nuevas pendientes de respuesta ahora mismo.',
  loadingLabel: 'Cargando…',
  goBackToCustomerSurface: 'Volver al sitio del cliente',
};

const AR: PartnerDict = {
  brandSubtitle: 'بوابة الشركاء',
  hubTitle: 'مرحبًا بعودتك',
  hubSubtitle: 'ملخص طلبات اليوم والتسويات.',
  navHub: 'الرئيسية',
  navDashboard: 'لوحة التحكم',
  navProjects: 'المشاريع',
  navQuotes: 'عروض الأسعار',
  navOrders: 'الطلبات',
  navRma: 'RMA · المرتجعات',
  navSettlements: 'التسويات',
  navPortfolio: 'المعرض',
  navProfile: 'الملف الشخصي',
  navLogout: 'تسجيل الخروج',

  cardTodayRfqTitle: 'طلبات اليوم',
  cardTodayRfqDesc: 'طلبات عروض أسعار جديدة بانتظار ردك',
  cardSettlementTitle: 'التسوية القادمة',
  cardSettlementDesc: 'المبلغ المتراكم حتى موعد الصرف القادم',
  cardPortfolioTitle: 'مشاهدات المعرض',
  cardPortfolioDesc: 'مشاهدات العملاء خلال آخر 7 أيام',

  funnelHeader: 'تقدم الإعداد',
  funnelStep1: 'إنشاء الحساب',
  funnelStep2: 'إكمال الملف الشخصي',
  funnelStep3: 'رفع المعرض',
  funnelStep4: 'الرد على أول طلب',

  emptyTodayRfq: 'لا توجد طلبات جديدة بانتظار ردك حاليًا.',
  loadingLabel: 'جارٍ التحميل…',
  goBackToCustomerSurface: 'العودة إلى موقع العميل',
};

export function partnerDict(lang: PartnerLang): PartnerDict {
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
