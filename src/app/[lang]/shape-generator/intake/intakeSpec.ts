/**
 * intakeSpec.ts — 아이디어 → 구조화된 설계 스펙
 *
 * 사용자가 Q&A Wizard를 통해 선택한 내용을 정규화된 IntakeSpec JSON으로 출력.
 * 이 Spec이 L2(제조방법)/L3(부품)/L4(재료)/L5(합성) 엔진의 입력이 됨.
 */

export type Category =
  | 'mechanical_part'    // 기계부품 (브라켓, 플랜지, 기어, 샤프트 등)
  | 'structural'         // 구조물 (프레임, 서포트, 베이스)
  | 'housing'            // 하우징 (케이스, 커버, 엔클로저)
  | 'jig_fixture'        // 지그·고정구
  | 'custom';            // 기타 자유 입력

export type FunctionType =
  | 'fix'          // 고정
  | 'support'      // 지지
  | 'connect'      // 연결
  | 'transmit'     // 동력 전달
  | 'protect'      // 보호 (커버)
  | 'align'        // 정렬/위치결정
  | 'mount';       // 장착

export type Environment =
  | 'indoor'
  | 'outdoor'
  | 'humid'
  | 'high_temp'
  | 'low_temp'
  | 'vibration'
  | 'corrosive'
  | 'cleanroom'
  | 'food_grade';

export type LoadType =
  | 'none'         // 정적, 하중 없음
  | 'static'       // 정적 하중 있음
  | 'dynamic'      // 동적 (회전, 왕복)
  | 'impact'       // 충격
  | 'cyclic';      // 피로 (반복)

export type SizeClass =
  | 'micro'        // < 20mm
  | 'small'        // 20~100mm
  | 'medium'       // 100~300mm
  | 'large'        // 300~1000mm
  | 'xl';          // > 1000mm

export type QuantityTier =
  | 'proto'        // 1~5 (시제품)
  | 'small'        // 10~100
  | 'mid'          // 100~1000
  | 'mass';        // 1000+

export type BudgetPriority =
  | 'cost'         // 최저가 우선
  | 'quality'      // 품질/정밀도 우선
  | 'speed'        // 납기 우선
  | 'balanced';

export type SpecialReq =
  | 'transparent'
  | 'conductive'
  | 'insulating'
  | 'waterproof'
  | 'lightweight'
  | 'high_precision'
  | 'heat_resistant'
  | 'chemical_resistant'
  | 'food_safe'
  | 'biocompatible';

export interface IntakeSpec {
  category: Category;
  subCategory?: string;         // 예: 'bracket', 'flange', 'shaft' — 카탈로그 ID
  function: FunctionType;
  environment: Environment[];
  loadType: LoadType;
  sizeClass: SizeClass;
  approxDimensions?: { w: number; h: number; d: number };  // mm, 사용자 대략 입력
  quantity: QuantityTier;
  budget: BudgetPriority;
  specialReqs: SpecialReq[];
  materialPreference?: string;  // 재료 ID (선택)
  notes?: string;               // 자유 텍스트 추가 요구사항
}

// 빈 스펙으로 Wizard 시작
export const EMPTY_SPEC: IntakeSpec = {
  category: 'mechanical_part',
  function: 'fix',
  environment: ['indoor'],
  loadType: 'static',
  sizeClass: 'small',
  quantity: 'proto',
  budget: 'balanced',
  specialReqs: [],
};

// 사이즈 클래스 → 대략적 치수 (mm)
export function sizeClassToDims(sc: SizeClass): { w: number; h: number; d: number } {
  switch (sc) {
    case 'micro': return { w: 15, h: 15, d: 15 };
    case 'small': return { w: 50, h: 50, d: 30 };
    case 'medium': return { w: 200, h: 200, d: 100 };
    case 'large': return { w: 600, h: 600, d: 200 };
    case 'xl': return { w: 1500, h: 1500, d: 500 };
  }
}

// 수량 티어 → 대표값 (스코어링용)
export function quantityTierToCount(qt: QuantityTier): number {
  switch (qt) {
    case 'proto': return 3;
    case 'small': return 50;
    case 'mid': return 500;
    case 'mass': return 5000;
  }
}
