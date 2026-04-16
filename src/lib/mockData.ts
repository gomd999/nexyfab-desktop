// ── Types ──────────────────────────────────────────────────────────────────

export type ProjectStatus = 'submitted' | 'matching' | 'rfp_sent' | 'quotes_received' | 'confirmed' | 'contracted';

export interface Project {
    id: string;
    name: string;
    category: string;
    status: ProjectStatus;
    submittedAt: string;
    updatedAt: string;
    factories: number;
    quotesReceived: number;
    estimatedAmount?: number;
    plan: 'standard' | 'premium';
}

export interface Quote {
    factoryName: string;
    country: string;
    unitPrice: number;
    moq: number;
    leadTimeDays: number;
    rating: number;
    note: string;
    selected?: boolean;
    certifications: string[];
    aiReason: string;
    scores: { quality: number; price: number; speed: number; reliability: number };
    verified: boolean;
}

export interface CommissionRecord {
    projectName: string;
    contractAmount: number;
    plan: 'standard' | 'premium';
    commissionRate: number;    // 적용 수수료율 (%)
    grossCommission: number;   // 계약금 × 수수료율 (산정 수수료)
    planDeduction: number;     // 플랜 선납 공제 (월 이용료)
    finalCharge: number;       // 추가 청구 = max(0, gross - deduction)
    status: 'pending' | 'invoiced' | 'paid';
    date: string;
}

// ── Commission helpers ─────────────────────────────────────────────────────

/** 월 이용료 = 프로젝트 착수 시 수수료에서 공제되는 최소 수수료 */
export const PLAN_MIN_FEE: Record<'standard' | 'premium', number> = {
    standard: 500_000,   // 50만원
    premium: 1_000_000,  // 100만원
};

export function getCommissionRate(amount: number): number {
    if (amount <= 20_000_000) return 7;
    if (amount <= 50_000_000) return 6;
    if (amount <= 100_000_000) return 5.5;
    if (amount <= 200_000_000) return 5;
    if (amount <= 500_000_000) return 4.5;
    return 4;
}

/** 최종 추가 청구액: 산정 수수료에서 플랜 선납분 공제. 최소 0원 */
export function getFinalCharge(amount: number, plan: 'standard' | 'premium'): number {
    const rate = getCommissionRate(amount);
    const gross = amount * rate / 100;
    const deduction = PLAN_MIN_FEE[plan];
    return Math.max(0, gross - deduction);
}

export const RATE_TIERS = [
    { label: '2,000만 이하', rate: 7 },
    { label: '5,000만 이하', rate: 6 },
    { label: '1억 이하', rate: 5.5 },
    { label: '2억 이하', rate: 5 },
    { label: '5억 이하', rate: 4.5 },
    { label: '10억 이하', rate: 4 },
];

// ── Mock data ──────────────────────────────────────────────────────────────

export const MOCK_PROJECTS: Project[] = [
    { id: 'p1', name: 'EV 배터리 케이스 외주 제조', category: '정밀 금속 가공', status: 'quotes_received', submittedAt: '2025-03-10', updatedAt: '2025-03-18', factories: 8, quotesReceived: 5, estimatedAmount: 28_000_000, plan: 'premium' },
    { id: 'p2', name: '스마트워치 하우징 1차 양산', category: '다이캐스팅', status: 'rfp_sent', submittedAt: '2025-03-20', updatedAt: '2025-03-22', factories: 6, quotesReceived: 0, estimatedAmount: 15_000_000, plan: 'standard' },
    { id: 'p3', name: '의료기기 케이스 시제품', category: '플라스틱 사출', status: 'matching', submittedAt: '2025-03-25', updatedAt: '2025-03-25', factories: 0, quotesReceived: 0, plan: 'standard' },
    { id: 'p4', name: 'IoT 모듈 PCB 조립', category: 'PCB 조립', status: 'contracted', submittedAt: '2025-02-01', updatedAt: '2025-02-28', factories: 5, quotesReceived: 4, estimatedAmount: 42_000_000, plan: 'premium' },
];

export const MOCK_QUOTES: Quote[] = [
    {
        factoryName: '선진정밀 (주)', country: '🇰🇷 한국', unitPrice: 18500, moq: 500, leadTimeDays: 21, rating: 4.8,
        note: 'ISO 9001 인증. 샘플 납기 7일 가능.', selected: true, verified: true,
        certifications: ['NexyFab Certified', 'ISO 9001', 'NDA'],
        aiReason: '품질·납기 종합 1위. 소량 시제품 → 양산 전환 실적 다수. 이 프로젝트 스펙 적합도 95%. NexyFab 추천 공장.',
        scores: { quality: 95, price: 72, speed: 88, reliability: 96 },
    },
    {
        factoryName: '대한정밀 (주)', country: '🇰🇷 한국', unitPrice: 19800, moq: 500, leadTimeDays: 25, rating: 4.6,
        note: '중간 가격. 국내 사후 지원 우수.', verified: true,
        certifications: ['NexyFab Certified', 'ISO 9001', 'NDA'],
        aiReason: '품질·납기·가격 균형형. 국내 AS 대응 필요 시 유리. 추천 공장 대비 단가 차이 미미하여 안정적 2순위.',
        scores: { quality: 88, price: 70, speed: 80, reliability: 90 },
    },
    {
        factoryName: '한국금속산업 (주)', country: '🇰🇷 한국', unitPrice: 21000, moq: 300, leadTimeDays: 18, rating: 4.7,
        note: 'MOQ 낮음. 소량 다품종에 최적.', verified: true,
        certifications: ['NexyFab Certified', 'ISO 9001'],
        aiReason: '납기 최단 18일. MOQ 300개로 초도 물량이 적은 경우 최적. 단가는 높으나 재고 리스크 최소화.',
        scores: { quality: 90, price: 62, speed: 96, reliability: 88 },
    },
    {
        factoryName: 'Dongguan HiTech Mfg', country: '🇨🇳 중국', unitPrice: 11200, moq: 1000, leadTimeDays: 35, rating: 4.5,
        note: '대량 주문 할인 협의 가능. 영문 계약서 제공.', verified: true,
        certifications: ['ISO 9001', 'NDA'],
        aiReason: '단가 절감이 최우선이라면 유력 후보. MOQ 1,000개 이상 대량 발주 기준으로 추천. 납기 35일 감안 필요.',
        scores: { quality: 82, price: 94, speed: 62, reliability: 80 },
    },
    {
        factoryName: 'Shenzhen ProFab Co.', country: '🇨🇳 중국', unitPrice: 9800, moq: 2000, leadTimeDays: 42, rating: 4.2,
        note: '최저가. 리드타임 길고 MOQ 높음.', verified: false,
        certifications: ['ISO 9001'],
        aiReason: '가격 최저이나 납기 42일, MOQ 2,000개로 초기 발주에 부적합. 대량·장기 구매 계획 시 재검토 권장.',
        scores: { quality: 74, price: 100, speed: 44, reliability: 70 },
    },
];

function makeCommission(
    projectName: string,
    contractAmount: number,
    plan: 'standard' | 'premium',
    status: CommissionRecord['status'],
    date: string,
): CommissionRecord {
    const rate = getCommissionRate(contractAmount);
    const gross = contractAmount * rate / 100;
    const deduction = PLAN_MIN_FEE[plan];
    return {
        projectName, contractAmount, plan,
        commissionRate: rate,
        grossCommission: gross,
        planDeduction: deduction,
        finalCharge: Math.max(0, gross - deduction),
        status, date,
    };
}

export const MOCK_COMMISSIONS: CommissionRecord[] = [
    makeCommission('IoT 모듈 PCB 조립', 42_000_000, 'premium', 'paid', '2025-03-05'),
    makeCommission('EV 배터리 케이스 외주 제조', 28_000_000, 'premium', 'pending', '2025-04-01'),
];
