/**
 * methods.ts — 제조 방법 카탈로그 (L2)
 *
 * 산업 현장에서 실제로 쓰이는 주요 제조법의 특성, 장단점, 적합 기준을 정규화.
 * L5 Composition Agent 가 IntakeSpec + Parts 와 매칭해 최적 제조법을 스코어링한다.
 */

export type MethodCategory =
  | 'additive'       // 적층 (3D 프린팅)
  | 'subtractive'    // 절삭 (CNC, 밀링, 선반)
  | 'forming'        // 성형 (시트메탈, 다이캐스팅)
  | 'molding'        // 몰딩 (사출, 블로우)
  | 'joining'        // 접합 (용접, 납땜)
  | 'cutting';       // 절단 (레이저, 워터젯)

export interface ManufacturingMethod {
  id: string;
  nameKo: string;
  nameEn: string;
  category: MethodCategory;
  description: string;

  // 물리적 제약
  maxSize: number;              // mm, 단변 최대 (없으면 9999)
  minFeature: number;           // mm, 최소 디테일
  toleranceMm: number;          // ±mm 표준 공차
  surfaceRoughnessUm: number;   // Ra μm (낮을수록 매끈)

  // 재료 호환 (category)
  compatibleMaterials: string[];  // plastic | metal-soft | metal-hard | composite | ceramic

  // 경제적 특성
  setupCostTier: 1 | 2 | 3 | 4 | 5;   // 1=저 (툴링 없음) 5=고 (몰드 제작)
  unitCostTier: 1 | 2 | 3 | 4 | 5;    // 1=저 (저렴) 5=고
  leadTimeDays: [number, number];      // [최소, 최대]

  // 수량 적합 (0~100)
  qtyFit: {
    proto: number;   // 1~5
    small: number;   // 10~100
    mid: number;     // 100~1000
    mass: number;    // 1000+
  };

  // 기능 적합
  strengthScore: number;     // 0~100, 구조 강도
  precisionScore: number;    // 0~100, 정밀도
  complexityScore: number;   // 0~100, 복잡 형상 허용

  // 제약
  limitations: string[];
  bestFor: string[];
}

export const METHODS: ManufacturingMethod[] = [
  // ── 3D 프린팅 (Additive) ──
  {
    id: 'fdm',
    nameKo: 'FDM 3D 프린팅',
    nameEn: 'FDM 3D Printing',
    category: 'additive',
    description: 'PLA/ABS/PETG 필라멘트를 녹여 적층. 가장 저렴한 시제품 방법.',
    maxSize: 400,
    minFeature: 0.4,
    toleranceMm: 0.3,
    surfaceRoughnessUm: 25,
    compatibleMaterials: ['plastic'],
    setupCostTier: 1,
    unitCostTier: 2,
    leadTimeDays: [1, 3],
    qtyFit: { proto: 95, small: 60, mid: 15, mass: 5 },
    strengthScore: 50,
    precisionScore: 50,
    complexityScore: 85,
    limitations: ['레이어 계단 자국', '수평 방향 강도 약함', '고온 불가'],
    bestFor: ['시제품', '기능 확인 모델', '지그'],
  },
  {
    id: 'sla',
    nameKo: 'SLA 3D 프린팅',
    nameEn: 'SLA / Resin 3D Printing',
    category: 'additive',
    description: '레진 광경화. 고정밀 표면, 작은 디테일 표현 우수.',
    maxSize: 300,
    minFeature: 0.05,
    toleranceMm: 0.1,
    surfaceRoughnessUm: 5,
    compatibleMaterials: ['plastic'],
    setupCostTier: 1,
    unitCostTier: 3,
    leadTimeDays: [1, 4],
    qtyFit: { proto: 90, small: 50, mid: 10, mass: 2 },
    strengthScore: 40,
    precisionScore: 85,
    complexityScore: 95,
    limitations: ['자외선 취성', '후처리 필수', '장기 내구성 낮음'],
    bestFor: ['주얼리 마스터', '피규어', '고정밀 시제품'],
  },
  {
    id: 'sls',
    nameKo: 'SLS 3D 프린팅',
    nameEn: 'SLS 3D Printing',
    category: 'additive',
    description: '나일론 파우더 레이저 소결. 서포트 불필요, 기능성 부품 양산 가능.',
    maxSize: 350,
    minFeature: 0.5,
    toleranceMm: 0.2,
    surfaceRoughnessUm: 12,
    compatibleMaterials: ['plastic'],
    setupCostTier: 2,
    unitCostTier: 3,
    leadTimeDays: [3, 7],
    qtyFit: { proto: 80, small: 85, mid: 50, mass: 15 },
    strengthScore: 75,
    precisionScore: 70,
    complexityScore: 95,
    limitations: ['표면 거침', '흰색/회색 제한', '후처리 필요'],
    bestFor: ['기능성 부품', '소량 생산', '복잡 형상'],
  },
  {
    id: 'mjf',
    nameKo: 'MJF 3D 프린팅',
    nameEn: 'Multi Jet Fusion',
    category: 'additive',
    description: 'HP MJF. SLS 대비 빠르고 균일한 나일론 양산.',
    maxSize: 380,
    minFeature: 0.5,
    toleranceMm: 0.15,
    surfaceRoughnessUm: 10,
    compatibleMaterials: ['plastic'],
    setupCostTier: 2,
    unitCostTier: 3,
    leadTimeDays: [3, 7],
    qtyFit: { proto: 75, small: 90, mid: 70, mass: 25 },
    strengthScore: 80,
    precisionScore: 75,
    complexityScore: 95,
    limitations: ['회색 한정 (염색 가능)', '대형 제한'],
    bestFor: ['기능성 양산 시제품', '엔지니어링 부품'],
  },
  {
    id: 'dmls',
    nameKo: '금속 3D 프린팅 (DMLS/SLM)',
    nameEn: 'DMLS / SLM Metal 3D',
    category: 'additive',
    description: '금속 분말 레이저 용융. 항공우주/의료 고부가가치 부품.',
    maxSize: 300,
    minFeature: 0.2,
    toleranceMm: 0.1,
    surfaceRoughnessUm: 10,
    compatibleMaterials: ['metal-soft', 'metal-hard'],
    setupCostTier: 3,
    unitCostTier: 5,
    leadTimeDays: [5, 14],
    qtyFit: { proto: 70, small: 70, mid: 30, mass: 5 },
    strengthScore: 90,
    precisionScore: 80,
    complexityScore: 95,
    limitations: ['고가', '후처리 (열처리/가공) 필요', '서포트 제거'],
    bestFor: ['복잡 내부 채널', '경량화 부품', '소량 금속 부품'],
  },

  // ── CNC / 절삭 (Subtractive) ──
  {
    id: 'cnc-mill-3ax',
    nameKo: 'CNC 밀링 (3축)',
    nameEn: 'CNC Milling 3-Axis',
    category: 'subtractive',
    description: '범용 절삭. 블록/판재에서 형상 가공. 표준 산업 방법.',
    maxSize: 1500,
    minFeature: 0.5,
    toleranceMm: 0.05,
    surfaceRoughnessUm: 1.6,
    compatibleMaterials: ['plastic', 'metal-soft', 'metal-hard', 'composite'],
    setupCostTier: 2,
    unitCostTier: 3,
    leadTimeDays: [3, 10],
    qtyFit: { proto: 85, small: 90, mid: 70, mass: 30 },
    strengthScore: 95,
    precisionScore: 90,
    complexityScore: 70,
    limitations: ['언더컷 제한', '깊은 포켓 어려움', '재료 낭비'],
    bestFor: ['금속 부품', '하우징', '지그 고정구'],
  },
  {
    id: 'cnc-mill-5ax',
    nameKo: 'CNC 밀링 (5축)',
    nameEn: 'CNC Milling 5-Axis',
    category: 'subtractive',
    description: '복잡 형상, 한 번에 다면 가공. 고정밀 항공/의료 부품.',
    maxSize: 1200,
    minFeature: 0.3,
    toleranceMm: 0.02,
    surfaceRoughnessUm: 0.8,
    compatibleMaterials: ['plastic', 'metal-soft', 'metal-hard', 'composite'],
    setupCostTier: 3,
    unitCostTier: 4,
    leadTimeDays: [5, 14],
    qtyFit: { proto: 70, small: 85, mid: 80, mass: 40 },
    strengthScore: 98,
    precisionScore: 98,
    complexityScore: 90,
    limitations: ['고가', '전문 인력 필요'],
    bestFor: ['임펠러', '임플란트', '복잡 금속 부품'],
  },
  {
    id: 'cnc-turning',
    nameKo: 'CNC 선반',
    nameEn: 'CNC Turning',
    category: 'subtractive',
    description: '회전 대칭 축물 가공. 샤프트/부싱/핀.',
    maxSize: 800,
    minFeature: 0.3,
    toleranceMm: 0.02,
    surfaceRoughnessUm: 0.8,
    compatibleMaterials: ['plastic', 'metal-soft', 'metal-hard'],
    setupCostTier: 2,
    unitCostTier: 2,
    leadTimeDays: [2, 7],
    qtyFit: { proto: 85, small: 95, mid: 85, mass: 60 },
    strengthScore: 95,
    precisionScore: 95,
    complexityScore: 40,
    limitations: ['회전 대칭만 가능', '후가공으로 홀/키 필요'],
    bestFor: ['샤프트', '부싱', '커넥터 핀'],
  },

  // ── 시트메탈 / 포밍 ──
  {
    id: 'sheet-metal',
    nameKo: '시트메탈 (벤딩/타공)',
    nameEn: 'Sheet Metal',
    category: 'forming',
    description: '얇은 판재를 절단, 타공, 벤딩. 캐비닛/브래킷 표준.',
    maxSize: 2500,
    minFeature: 1.0,
    toleranceMm: 0.2,
    surfaceRoughnessUm: 3.2,
    compatibleMaterials: ['metal-soft', 'metal-hard'],
    setupCostTier: 2,
    unitCostTier: 2,
    leadTimeDays: [3, 10],
    qtyFit: { proto: 70, small: 95, mid: 95, mass: 90 },
    strengthScore: 70,
    precisionScore: 75,
    complexityScore: 50,
    limitations: ['두께 균일', '깊은 드로잉 제한', 'R 각 제약'],
    bestFor: ['캐비닛', '브래킷', '전자 케이스'],
  },
  {
    id: 'stamping',
    nameKo: '프레스 스탬핑',
    nameEn: 'Press Stamping',
    category: 'forming',
    description: '금형으로 판재를 타공/성형. 대량 생산 최강.',
    maxSize: 500,
    minFeature: 0.5,
    toleranceMm: 0.1,
    surfaceRoughnessUm: 3.2,
    compatibleMaterials: ['metal-soft', 'metal-hard'],
    setupCostTier: 5,
    unitCostTier: 1,
    leadTimeDays: [30, 60],
    qtyFit: { proto: 5, small: 20, mid: 80, mass: 99 },
    strengthScore: 80,
    precisionScore: 80,
    complexityScore: 55,
    limitations: ['금형비 고가', '설계 변경 어려움', '시제품 부적합'],
    bestFor: ['수천개+ 판재 부품', '자동차 부품'],
  },
  {
    id: 'die-casting',
    nameKo: '다이캐스팅',
    nameEn: 'Die Casting',
    category: 'forming',
    description: '고압 금형으로 용융 금속 주입. 알루미늄/아연 대량 생산.',
    maxSize: 600,
    minFeature: 0.8,
    toleranceMm: 0.1,
    surfaceRoughnessUm: 1.6,
    compatibleMaterials: ['metal-soft'],
    setupCostTier: 5,
    unitCostTier: 1,
    leadTimeDays: [45, 90],
    qtyFit: { proto: 2, small: 10, mid: 70, mass: 99 },
    strengthScore: 85,
    precisionScore: 85,
    complexityScore: 80,
    limitations: ['금형비 초고가', '제한된 재료', '대량에만 적합'],
    bestFor: ['자동차 엔진 부품', '가전 하우징'],
  },

  // ── 사출 성형 ──
  {
    id: 'injection-mold',
    nameKo: '플라스틱 사출 성형',
    nameEn: 'Plastic Injection Molding',
    category: 'molding',
    description: '금형에 용융 플라스틱 주입. 플라스틱 대량 생산의 표준.',
    maxSize: 1000,
    minFeature: 0.5,
    toleranceMm: 0.1,
    surfaceRoughnessUm: 0.8,
    compatibleMaterials: ['plastic'],
    setupCostTier: 5,
    unitCostTier: 1,
    leadTimeDays: [30, 75],
    qtyFit: { proto: 3, small: 15, mid: 75, mass: 99 },
    strengthScore: 70,
    precisionScore: 85,
    complexityScore: 80,
    limitations: ['금형비 $5k~$50k+', '시제품 부적합', '언더컷 복잡'],
    bestFor: ['전자제품 외장', '소비재 플라스틱 대량'],
  },

  // ── 접합 ──
  {
    id: 'tig-welding',
    nameKo: 'TIG 용접',
    nameEn: 'TIG Welding',
    category: 'joining',
    description: '정밀 아크 용접. 스테인리스/알루미늄 구조물.',
    maxSize: 9999,
    minFeature: 2.0,
    toleranceMm: 1.0,
    surfaceRoughnessUm: 12,
    compatibleMaterials: ['metal-soft', 'metal-hard'],
    setupCostTier: 1,
    unitCostTier: 3,
    leadTimeDays: [2, 10],
    qtyFit: { proto: 80, small: 80, mid: 50, mass: 20 },
    strengthScore: 85,
    precisionScore: 60,
    complexityScore: 60,
    limitations: ['수작업 숙련도', '열변형', '용접 자국'],
    bestFor: ['프레임 구조', '배관', '난간'],
  },

  // ── 절단 ──
  {
    id: 'laser-cut',
    nameKo: '레이저 컷팅',
    nameEn: 'Laser Cutting',
    category: 'cutting',
    description: '평판 정밀 절단. 2D 프로파일 전용.',
    maxSize: 3000,
    minFeature: 0.3,
    toleranceMm: 0.1,
    surfaceRoughnessUm: 3.2,
    compatibleMaterials: ['plastic', 'metal-soft', 'metal-hard'],
    setupCostTier: 1,
    unitCostTier: 2,
    leadTimeDays: [1, 5],
    qtyFit: { proto: 85, small: 95, mid: 90, mass: 80 },
    strengthScore: 75,
    precisionScore: 85,
    complexityScore: 45,
    limitations: ['2D만 가능', '두께 제한 (~20mm)', '열영향부'],
    bestFor: ['판재 프로파일', '아크릴 레이저', '전자 섀시'],
  },
  {
    id: 'waterjet',
    nameKo: '워터젯 절단',
    nameEn: 'Waterjet Cutting',
    category: 'cutting',
    description: '고압 물+연마재로 절단. 두꺼운 소재, 열변형 제로.',
    maxSize: 4000,
    minFeature: 1.0,
    toleranceMm: 0.2,
    surfaceRoughnessUm: 6.3,
    compatibleMaterials: ['plastic', 'metal-soft', 'metal-hard', 'composite', 'ceramic'],
    setupCostTier: 2,
    unitCostTier: 3,
    leadTimeDays: [2, 7],
    qtyFit: { proto: 80, small: 90, mid: 80, mass: 60 },
    strengthScore: 80,
    precisionScore: 75,
    complexityScore: 40,
    limitations: ['2D만', '후처리 필요 (거친 단면)'],
    bestFor: ['두꺼운 금속', '석재', '복합재'],
  },
];

export const METHODS_BY_ID: Record<string, ManufacturingMethod> = Object.fromEntries(
  METHODS.map((m) => [m.id, m])
);

/** LLM 프롬프트용 제조법 요약 */
export function methodsCatalogSummary(): string {
  return METHODS.map((m) => {
    return `- ${m.id} (${m.nameKo}): ${m.description} | 최대 ${m.maxSize}mm, 공차 ±${m.toleranceMm}mm, 수량 적합: proto${m.qtyFit.proto}/small${m.qtyFit.small}/mid${m.qtyFit.mid}/mass${m.qtyFit.mass}`;
  }).join('\n');
}
