// Partner-portal dictionary. We start with ko + en — Japanese / Chinese
// / Spanish / Arabic fall back to en until copy is approved by the
// partner-ops team. Add a locale here when ready; UI already routes
// through `usePartnerLang`.

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

export function partnerDict(lang: PartnerLang): PartnerDict {
  switch (lang) {
    case 'ko': return KO;
    case 'en': return EN;
    // Other locales fall back to English until copy lands.
    default:   return EN;
  }
}
