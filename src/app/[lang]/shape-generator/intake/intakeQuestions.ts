/**
 * intakeQuestions.ts — Q&A Wizard 질문 트리
 */
import type { Category, FunctionType, Environment, LoadType, SizeClass, QuantityTier, BudgetPriority, SpecialReq } from './intakeSpec';

export interface QuestionOption<V = string> {
  value: V;
  label: string;
  description?: string;
  icon?: string;
}

export interface Question {
  id: string;
  title: string;
  subtitle?: string;
  type: 'single' | 'multi' | 'dimensions' | 'text';
  field: string;                        // IntakeSpec의 필드 이름
  options?: QuestionOption[];           // single/multi
  optional?: boolean;
  skipIf?: (spec: any) => boolean;     // 이전 답변에 따라 건너뛰기
}

export const QUESTIONS: Question[] = [
  // 1. 카테고리
  {
    id: 'category',
    title: '어떤 종류의 제품을 설계하고 싶으세요?',
    subtitle: '대분류를 먼저 선택해주세요',
    type: 'single',
    field: 'category',
    options: [
      { value: 'mechanical_part', label: '기계 부품', description: '브라켓 · 플랜지 · 기어 · 샤프트 등', icon: '⚙' },
      { value: 'structural', label: '구조물', description: '프레임 · 서포트 · 베이스', icon: '🏗' },
      { value: 'housing', label: '하우징 · 케이스', description: '전자 장비 케이스 · 커버 · 엔클로저', icon: '📦' },
      { value: 'jig_fixture', label: '지그 · 고정구', description: '작업용 고정 장치', icon: '🔧' },
      { value: 'custom', label: '기타 / 직접 설명', description: '위에 없는 제품', icon: '💭' },
    ],
  },

  // 2. 서브 카테고리 (기계 부품만)
  {
    id: 'subCategory',
    title: '어떤 기계 부품인가요?',
    type: 'single',
    field: 'subCategory',
    optional: true,
    skipIf: (s) => s.category !== 'mechanical_part',
    options: [
      { value: 'bracket-l', label: 'L 브라켓', icon: '⌐' },
      { value: 'bracket-flat', label: '평 브라켓', icon: '▭' },
      { value: 'flange-round', label: '원형 플랜지', icon: '◉' },
      { value: 'shaft-cylindrical', label: '축 (샤프트)', icon: '|' },
      { value: 'coupling-rigid', label: '커플링', icon: '⊜' },
      { value: 'standoff', label: '스탠드오프 / 스페이서', icon: '⋮' },
      { value: 'gear-spur', label: '평 기어', icon: '⚙' },
      { value: 'plate-with-holes', label: '타공 플레이트', icon: '⊞' },
      { value: 'cover-plate', label: '커버 플레이트', icon: '▢' },
      { value: 'bearing-seat', label: '베어링 시트', icon: '⊙' },
      { value: 'housing-box', label: '박스 하우징', icon: '☐' },
    ],
  },

  // 3. 주 기능
  {
    id: 'function',
    title: '이 부품의 주된 역할은?',
    type: 'single',
    field: 'function',
    options: [
      { value: 'fix', label: '고정', description: '다른 부품을 제자리에 고정' },
      { value: 'support', label: '지지', description: '하중을 받치는 구조' },
      { value: 'connect', label: '연결', description: '두 부품을 결합' },
      { value: 'transmit', label: '동력 전달', description: '회전/힘 전달' },
      { value: 'protect', label: '보호', description: '내부 부품을 감싸는 커버' },
      { value: 'align', label: '정렬 / 위치 결정', description: '위치를 정확히 잡음' },
      { value: 'mount', label: '장착', description: '벽/기구에 부착' },
    ],
  },

  // 4. 사용 환경
  {
    id: 'environment',
    title: '어떤 환경에서 사용되나요?',
    subtitle: '해당되는 것을 모두 선택 (복수 선택)',
    type: 'multi',
    field: 'environment',
    options: [
      { value: 'indoor', label: '실내' },
      { value: 'outdoor', label: '실외' },
      { value: 'humid', label: '습기 · 물' },
      { value: 'high_temp', label: '고온 (>80°C)' },
      { value: 'low_temp', label: '저온 (<0°C)' },
      { value: 'vibration', label: '진동' },
      { value: 'corrosive', label: '부식 환경 (산/염)' },
      { value: 'cleanroom', label: '클린룸' },
      { value: 'food_grade', label: '식품 접촉' },
    ],
  },

  // 5. 하중 유형
  {
    id: 'loadType',
    title: '하중 조건은?',
    type: 'single',
    field: 'loadType',
    options: [
      { value: 'none', label: '하중 없음', description: '장식/정렬 등' },
      { value: 'static', label: '정적 하중', description: '고정된 힘을 받음' },
      { value: 'dynamic', label: '동적 하중', description: '회전/왕복 운동' },
      { value: 'impact', label: '충격', description: '순간적인 큰 힘' },
      { value: 'cyclic', label: '반복 피로', description: '진동/반복 응력' },
    ],
  },

  // 6. 크기 클래스
  {
    id: 'sizeClass',
    title: '대략적인 크기는?',
    type: 'single',
    field: 'sizeClass',
    options: [
      { value: 'micro', label: '초소형', description: '20mm 이하' },
      { value: 'small', label: '소형', description: '20~100mm' },
      { value: 'medium', label: '중형', description: '100~300mm' },
      { value: 'large', label: '대형', description: '300~1000mm' },
      { value: 'xl', label: '초대형', description: '1m 이상' },
    ],
  },

  // 7. 정확한 치수 (선택)
  {
    id: 'approxDimensions',
    title: '대략적인 치수를 아시면 입력해주세요',
    subtitle: '모르면 건너뛰기 — 크기 클래스 기준값이 적용됩니다',
    type: 'dimensions',
    field: 'approxDimensions',
    optional: true,
  },

  // 8. 수량
  {
    id: 'quantity',
    title: '몇 개나 필요하세요?',
    type: 'single',
    field: 'quantity',
    options: [
      { value: 'proto', label: '시제품', description: '1~5개' },
      { value: 'small', label: '소량 생산', description: '10~100개' },
      { value: 'mid', label: '중량 생산', description: '100~1000개' },
      { value: 'mass', label: '대량 생산', description: '1000개 이상' },
    ],
  },

  // 9. 예산/우선순위
  {
    id: 'budget',
    title: '가장 중요한 우선순위는?',
    type: 'single',
    field: 'budget',
    options: [
      { value: 'cost', label: '🪙 최저가', description: '비용을 최대한 낮춤' },
      { value: 'quality', label: '💎 품질 · 정밀도', description: '정확도와 내구성 우선' },
      { value: 'speed', label: '⚡ 빠른 납기', description: '최대한 빨리' },
      { value: 'balanced', label: '⚖ 균형', description: '셋 다 적당히' },
    ],
  },

  // 10. 특수 요구사항
  {
    id: 'specialReqs',
    title: '특별히 필요한 특성이 있나요?',
    subtitle: '선택사항 (복수 선택 가능)',
    type: 'multi',
    field: 'specialReqs',
    optional: true,
    options: [
      { value: 'transparent', label: '투명' },
      { value: 'conductive', label: '전도성' },
      { value: 'insulating', label: '절연' },
      { value: 'waterproof', label: '방수' },
      { value: 'lightweight', label: '경량' },
      { value: 'high_precision', label: '고정밀 (IT6 이상)' },
      { value: 'heat_resistant', label: '내열' },
      { value: 'chemical_resistant', label: '내화학성' },
      { value: 'food_safe', label: '식품 안전' },
      { value: 'biocompatible', label: '생체적합' },
    ],
  },

  // 11. 자유 텍스트
  {
    id: 'notes',
    title: '추가로 전달하고 싶은 내용이 있으신가요?',
    subtitle: '선택사항 — 자유롭게 적어주세요',
    type: 'text',
    field: 'notes',
    optional: true,
  },
];
