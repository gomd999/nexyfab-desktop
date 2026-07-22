/**
 * eng-domain/codecheck/rules.ts — DETERMINISTIC 코드체크 / 감리(design-review) 룰셋.
 *
 * WHAT MAKES THIS DIFFERENT (차별화):
 *  경쟁사의 학습모델(learned-model) 감리는 "닮은 사례"로 지적한다. 여기서는 각 룰이
 *  실제 공개 법령/공표기준(법령 = 퍼블릭도메인, ingest-OK)의 조항을 인용하는 결정론
 *  규칙이다. 입력 = 측정된 설계/도면 피처, 출력 = 룰별 PASS/FAIL/NA + 인용 조항 +
 *  실측값 vs 요구값. 숫자는 절대 지어내지 않는다 — 모든 임계값이 인용 출처로 추적된다.
 *
 * HONESTY CONTRACT (성역):
 *  - 이 도구는 NON-STATUTORY 감리 보조(감리 補助)이며, 면허 감리/기술사를 대체하지 않는다.
 *    (DISCLAIMER 상수를 출력에 반드시 동봉한다.)
 *  - 피처가 제공되지 않으면 NA — 준수로 가정하지 않는다(honesty invariant).
 *  - FAIL 시 정확한 actual vs required + 인용 조항을 함께 반환한다.
 *  - 모든 임계값은 `source`(법령명·조항)로 추적 가능해야 한다. 검증 못한 숫자는 넣지 않는다.
 *  - 순수/결정론 함수: I/O·OCCT·THREE 없음. Node/브라우저 무관, 단위테스트 가능.
 *
 * UNIT CONVENTIONS (호출자가 은연중 오입력하지 못하도록 명시):
 *  - 길이: m. 기울기/경사: 무차원 비(rise/run). 예: 1/12 ≈ 0.0833, 1/50 = 0.02, 17% = 0.17.
 */

// ── output shapes ────────────────────────────────────────────────────────────
export type RuleStatus = 'pass' | 'fail' | 'na';

export interface RuleResult {
  /** stable rule id, e.g. 'parking-disabled-stall-width' */
  id: string;
  /** category grouping, e.g. '주차'·'경사로'·'계단'·'난간'·'복도'·'출입구'·'위생' */
  category: string;
  /** cited clause (법령명·조항), e.g. '장애인·노인·임산부등편의증진보장법 시행규칙 별표1' */
  clause: string;
  /** authoritative source (공표기관·URL 등) */
  source: string;
  /** verdict */
  status: RuleStatus;
  /** measured value backing the verdict (present iff a numeric feature was supplied) */
  actual?: number;
  /** human-readable requirement string, e.g. '≥ 3.3 m' */
  required: string;
  /** why — actual vs required (FAIL), the citation (PASS), or the missing feature (NA) */
  message: string;
}

/**
 * Normalized MEASURED-features object. Every field is OPTIONAL: a rule whose feature
 * is absent returns NA (never assumes compliance). Lengths in metres, slopes as ratio.
 * These are SEMANTIC features — the design/drawing must be labelled (which dimension is
 * the stall width). Raw DWG-2D IR gives a POOL of measurements (see runCodeCheck helper);
 * assigning them to these semantic slots is the user's call, not a guess.
 */
export interface CodeCheckFeatures {
  // 장애인전용 주차구역 (직각주차 기준)
  parkingDisabledStallWidth_m?: number;
  parkingDisabledStallLength_m?: number;
  /** 주차면 바닥 기울기 (rise/run) */
  parkingDisabledStallSlope?: number;

  // 경사로 (연석경사로 / 장애인용 경사로)
  rampEffectiveWidth_m?: number;
  /** 경사로 종단경사 (rise/run) */
  rampSlope?: number;
  /** 경사로 측면(가장자리) 경사 (rise/run) */
  rampSideSlope?: number;

  // 주차장 진입 램프 (자동차)
  /** 직선 램프 종단경사 (rise/run) */
  parkingRampSlopeStraight?: number;
  /** 곡선 램프 종단경사 (rise/run) */
  parkingRampSlopeCurved?: number;

  // 계단 (건축물의 피난·방화구조 규칙 제15조 — 용도별 상이)
  stairCategory?: 'elementary' | 'secondary' | 'assembly' | 'other';
  stairEffectiveWidth_m?: number;
  /** 단높이 */
  stairRiser_m?: number;
  /** 단너비(디딤판) */
  stairTread_m?: number;

  // 난간 (건축법 시행령 제40조 — 옥상광장·노대 등)
  railingHeight_m?: number;

  // 복도 (건축물의 피난·방화구조 규칙 제15조의2)
  corridorCategory?: 'school' | 'residential' | 'general';
  /** 양옆에 거실이 있는 복도인지 */
  corridorBothSidesRooms?: boolean;
  corridorWidth_m?: number;

  // 출입구 (장애인등편의법 시행규칙 별표1 — 통과유효폭)
  doorEffectiveWidth_m?: number;

  // 장애인 화장실 대변기 활동공간 (장애인등편의법 시행규칙 별표1)
  disabledToiletActivityWidth_m?: number;
  disabledToiletActivityDepth_m?: number;

  // 접근로 연석 경계 (장애인편의시설 매뉴얼 / 별표1) — 벽면 0.3m 지점 경계 높이
  curbBoundaryHeight_m?: number;
}

/** A deterministic, pure, unit-testable rule that cites a real public clause. */
export interface Rule {
  id: string;
  category: string;
  clause: string;
  source: string;
  /** machine-and-human requirement summary, e.g. '≥ 3.3 m' */
  requirement: string;
  check(features: CodeCheckFeatures): RuleResult;
}

// ── NON-STATUTORY disclaimer (성역: 출력에 반드시 동봉) ─────────────────────────
export const CODECHECK_DISCLAIMER =
  '본 코드체크는 공개 법령/공표기준 조항을 인용하는 결정론적 감리 보조(비법정)입니다. ' +
  '면허 감리자·기술사의 법정 감리/검토를 대체하지 않으며, 최종 적법성 판단은 관계 전문가와 ' +
  '허가권자에게 있습니다. 각 지적은 인용 조항의 원문으로 직접 확인하십시오.';

// ── comparator helpers (round to avoid FP noise in the verdict) ───────────────
const EPS = 1e-9;
function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
function fmtRatio(x: number): string {
  // present a ratio as 1:N (and %) for readability
  if (x <= 0) return String(x);
  const n = 1 / x;
  return `1:${Math.round(n * 10) / 10} (${(x * 100).toFixed(1)}%)`;
}

interface Cmp {
  ok: boolean;
  msg: string;
}
function atLeast(actual: number, min: number, unit: string): Cmp {
  const ok = actual >= min - EPS;
  return {
    ok,
    msg: `실측 ${r3(actual)} ${unit} ${ok ? '≥' : '<'} 요구 ${min} ${unit}`,
  };
}
function atMost(actual: number, max: number, unit: string): Cmp {
  const ok = actual <= max + EPS;
  return {
    ok,
    msg: `실측 ${r3(actual)} ${unit} ${ok ? '≤' : '>'} 허용 ${max} ${unit}`,
  };
}
function slopeAtMost(actual: number, max: number): Cmp {
  const ok = actual <= max + EPS;
  return {
    ok,
    msg: `실측 경사 ${fmtRatio(actual)} ${ok ? '≤' : '>'} 허용 ${fmtRatio(max)}`,
  };
}
function between(actual: number, lo: number, hi: number, unit: string): Cmp {
  const ok = actual >= lo - EPS && actual <= hi + EPS;
  return {
    ok,
    msg: `실측 ${r3(actual)} ${unit} ${ok ? '∈' : '∉'} 허용범위 ${lo}~${hi} ${unit}`,
  };
}

/** Build an NA result (feature not provided — never assume compliance). */
function na(rule: Omit<Rule, 'check'>, note = '해당 피처 미제공 — 준수로 가정하지 않음(NA).'): RuleResult {
  return {
    id: rule.id,
    category: rule.category,
    clause: rule.clause,
    source: rule.source,
    status: 'na',
    required: rule.requirement,
    message: note,
  };
}
/** Build a pass/fail result from a comparator. */
function verdict(rule: Omit<Rule, 'check'>, actual: number, cmp: Cmp): RuleResult {
  return {
    id: rule.id,
    category: rule.category,
    clause: rule.clause,
    source: rule.source,
    status: cmp.ok ? 'pass' : 'fail',
    actual: r3(actual),
    required: rule.requirement,
    message: `${cmp.msg} — ${rule.clause}`,
  };
}

// ── sources (법령명 + 공표 링크; 법령 = 퍼블릭도메인) ───────────────────────────
const SRC_BARRIER =
  '국가법령정보센터 law.go.kr — 장애인·노인·임산부 등의 편의증진 보장에 관한 법률 시행규칙 [별표1]';
const SRC_PARKING = '국가법령정보센터 law.go.kr — 주차장법 시행규칙 제6조(노외주차장의 구조·설비기준)';
const SRC_FIREESC = '국가법령정보센터 law.go.kr — 건축물의 피난·방화구조 등의 기준에 관한 규칙';
const SRC_ENFORCE = '국가법령정보센터 law.go.kr — 건축법 시행령';
const SRC_MANUAL = '보건복지부 — 장애인편의시설 설치 매뉴얼(별표1 근거)';

// 계단 용도별 임계값(제15조) — 검증된 값만 인코딩, 미규정 용도는 NA로 정직 처리.
const STAIR_WIDTH_MIN: Record<NonNullable<CodeCheckFeatures['stairCategory']>, number> = {
  elementary: 1.5, // 초등학교: 유효너비 150cm 이상
  secondary: 1.5, // 중·고등학교: 유효너비 150cm 이상
  assembly: 1.2, // 문화·집회·판매 등 주계단: 유효너비 120cm 이상
  other: 0.6, // 그 밖의 계단: 유효너비 60cm 이상
};
// 단높이 상한(단위 m): 학교급만 제15조에 명시 — 그 외는 이 규칙에 고정 상한 없음 → NA.
const STAIR_RISER_MAX: Partial<Record<NonNullable<CodeCheckFeatures['stairCategory']>, number>> = {
  elementary: 0.16, // 단높이 16cm 이하
  secondary: 0.18, // 단높이 18cm 이하
};
// 단너비(디딤판) 하한(m): 학교급 26cm 이상.
const STAIR_TREAD_MIN: Partial<Record<NonNullable<CodeCheckFeatures['stairCategory']>, number>> = {
  elementary: 0.26,
  secondary: 0.26,
};
// 복도 유효너비(m): 제15조의2 표 — [양옆거실, 그밖].
const CORRIDOR_WIDTH_MIN: Record<NonNullable<CodeCheckFeatures['corridorCategory']>, [number, number]> = {
  school: [2.4, 1.8], // 유치원·초·중·고
  residential: [1.8, 1.2], // 공동주택·오피스텔
  general: [1.5, 1.2], // 해당층 거실 바닥면적 합계 200㎡(지하 300㎡) 이상인 경우
};

// ─────────────────────────────────────────────────────────────────────────────
// RULES
// ─────────────────────────────────────────────────────────────────────────────
export const CODECHECK_RULES: Rule[] = [
  // ── 장애인전용 주차구역 (직각) ──────────────────────────────────────────────
  {
    id: 'parking-disabled-stall-width',
    category: '주차',
    clause: '장애인·노인·임산부등편의증진보장법 시행규칙 [별표1] 주차장(직각 3.3m 이상)',
    source: SRC_BARRIER,
    requirement: '폭 ≥ 3.3 m (직각주차)',
    check(f) {
      if (f.parkingDisabledStallWidth_m === undefined) return na(this);
      return verdict(this, f.parkingDisabledStallWidth_m, atLeast(f.parkingDisabledStallWidth_m, 3.3, 'm'));
    },
  },
  {
    id: 'parking-disabled-stall-length',
    category: '주차',
    clause: '장애인·노인·임산부등편의증진보장법 시행규칙 [별표1] 주차장(길이 5.0m 이상)',
    source: SRC_BARRIER,
    requirement: '길이 ≥ 5.0 m (직각주차)',
    check(f) {
      if (f.parkingDisabledStallLength_m === undefined) return na(this);
      return verdict(this, f.parkingDisabledStallLength_m, atLeast(f.parkingDisabledStallLength_m, 5.0, 'm'));
    },
  },
  {
    id: 'parking-disabled-stall-slope',
    category: '주차',
    clause: '장애인·노인·임산부등편의증진보장법 시행규칙 [별표1] 주차장(바닥 기울기 1/50 이하)',
    source: SRC_BARRIER,
    requirement: '바닥 기울기 ≤ 1:50 (2%)',
    check(f) {
      if (f.parkingDisabledStallSlope === undefined) return na(this);
      return verdict(this, f.parkingDisabledStallSlope, slopeAtMost(f.parkingDisabledStallSlope, 1 / 50));
    },
  },

  // ── 경사로 (연석경사로 / 장애인용) ──────────────────────────────────────────
  {
    id: 'ramp-effective-width',
    category: '경사로',
    clause: '장애인·노인·임산부등편의증진보장법 시행규칙 [별표1] 경사로(유효폭 1.2m 이상)',
    source: SRC_BARRIER,
    requirement: '유효폭 ≥ 1.2 m',
    check(f) {
      if (f.rampEffectiveWidth_m === undefined) return na(this);
      return verdict(this, f.rampEffectiveWidth_m, atLeast(f.rampEffectiveWidth_m, 1.2, 'm'));
    },
  },
  {
    id: 'ramp-slope',
    category: '경사로',
    clause: '장애인·노인·임산부등편의증진보장법 시행규칙 [별표1] 경사로(기울기 1/12 이하)',
    source: SRC_BARRIER,
    requirement: '종단경사 ≤ 1:12 (8.33%)',
    check(f) {
      if (f.rampSlope === undefined) return na(this);
      return verdict(this, f.rampSlope, slopeAtMost(f.rampSlope, 1 / 12));
    },
  },
  {
    id: 'ramp-side-slope',
    category: '경사로',
    clause: '장애인편의시설 매뉴얼 — 경사로 측면 기울기 1/10 이하(별표1 근거)',
    source: SRC_MANUAL,
    requirement: '측면 경사 ≤ 1:10 (10%)',
    check(f) {
      if (f.rampSideSlope === undefined) return na(this);
      return verdict(this, f.rampSideSlope, slopeAtMost(f.rampSideSlope, 1 / 10));
    },
  },

  // ── 주차장 진입 램프 (자동차) ───────────────────────────────────────────────
  {
    id: 'parking-ramp-slope-straight',
    category: '주차',
    clause: '주차장법 시행규칙 제6조 — 경사로 종단경사(직선 17% 이하)',
    source: SRC_PARKING,
    requirement: '직선 램프 종단경사 ≤ 17%',
    check(f) {
      if (f.parkingRampSlopeStraight === undefined) return na(this);
      return verdict(this, f.parkingRampSlopeStraight, slopeAtMost(f.parkingRampSlopeStraight, 0.17));
    },
  },
  {
    id: 'parking-ramp-slope-curved',
    category: '주차',
    clause: '주차장법 시행규칙 제6조 — 경사로 종단경사(곡선 14% 이하)',
    source: SRC_PARKING,
    requirement: '곡선 램프 종단경사 ≤ 14%',
    check(f) {
      if (f.parkingRampSlopeCurved === undefined) return na(this);
      return verdict(this, f.parkingRampSlopeCurved, slopeAtMost(f.parkingRampSlopeCurved, 0.14));
    },
  },

  // ── 계단 (제15조 — 용도별) ──────────────────────────────────────────────────
  {
    id: 'stair-effective-width',
    category: '계단',
    clause: '건축물의 피난·방화구조 등의 기준에 관한 규칙 제15조 — 계단 유효너비',
    source: SRC_FIREESC,
    requirement: '용도별: 학교 ≥1.5m / 집회·판매 ≥1.2m / 그밖 ≥0.6m',
    check(f) {
      if (f.stairEffectiveWidth_m === undefined) return na(this);
      const cat = f.stairCategory ?? 'other';
      const min = STAIR_WIDTH_MIN[cat];
      return verdict(
        { ...this, requirement: `${cat}: 유효너비 ≥ ${min} m` },
        f.stairEffectiveWidth_m,
        atLeast(f.stairEffectiveWidth_m, min, 'm'),
      );
    },
  },
  {
    id: 'stair-riser-height',
    category: '계단',
    clause: '건축물의 피난·방화구조 등의 기준에 관한 규칙 제15조 — 단높이',
    source: SRC_FIREESC,
    requirement: '학교급만 규정: 초등 ≤0.16m / 중고 ≤0.18m (그밖 용도는 이 규칙에 고정 상한 없음)',
    check(f) {
      if (f.stairRiser_m === undefined) return na(this);
      const cat = f.stairCategory ?? 'other';
      const max = STAIR_RISER_MAX[cat];
      if (max === undefined) {
        return na(this, `용도 '${cat}'는 제15조에 단높이 고정 상한이 명시되지 않음 — 이 규칙으로 판정하지 않음(NA).`);
      }
      return verdict({ ...this, requirement: `${cat}: 단높이 ≤ ${max} m` }, f.stairRiser_m, atMost(f.stairRiser_m, max, 'm'));
    },
  },
  {
    id: 'stair-tread-depth',
    category: '계단',
    clause: '건축물의 피난·방화구조 등의 기준에 관한 규칙 제15조 — 단너비',
    source: SRC_FIREESC,
    requirement: '학교급만 규정: 초등·중고 단너비 ≥ 0.26m (그밖 용도는 이 규칙에 고정 하한 없음)',
    check(f) {
      if (f.stairTread_m === undefined) return na(this);
      const cat = f.stairCategory ?? 'other';
      const min = STAIR_TREAD_MIN[cat];
      if (min === undefined) {
        return na(this, `용도 '${cat}'는 제15조에 단너비 고정 하한이 명시되지 않음 — 이 규칙으로 판정하지 않음(NA).`);
      }
      return verdict({ ...this, requirement: `${cat}: 단너비 ≥ ${min} m` }, f.stairTread_m, atLeast(f.stairTread_m, min, 'm'));
    },
  },

  // ── 난간 (건축법 시행령 제40조) ─────────────────────────────────────────────
  {
    id: 'railing-height',
    category: '난간',
    clause: '건축법 시행령 제40조 — 옥상광장·노대 등 주위 난간 1.2m 이상',
    source: SRC_ENFORCE,
    requirement: '난간 높이 ≥ 1.2 m',
    check(f) {
      if (f.railingHeight_m === undefined) return na(this);
      return verdict(this, f.railingHeight_m, atLeast(f.railingHeight_m, 1.2, 'm'));
    },
  },

  // ── 복도 (제15조의2) ────────────────────────────────────────────────────────
  {
    id: 'corridor-effective-width',
    category: '복도',
    clause: '건축물의 피난·방화구조 등의 기준에 관한 규칙 제15조의2 — 복도 유효너비',
    source: SRC_FIREESC,
    requirement: '용도·배치별: 학교 2.4/1.8m · 공동주택 1.8/1.2m · 일반(면적조건) 1.5/1.2m [양옆거실/그밖]',
    check(f) {
      if (f.corridorWidth_m === undefined) return na(this);
      const cat = f.corridorCategory ?? 'general';
      const [both, other] = CORRIDOR_WIDTH_MIN[cat];
      const min = f.corridorBothSidesRooms ? both : other;
      const layout = f.corridorBothSidesRooms ? '양옆거실' : '편복도/그밖';
      return verdict(
        { ...this, requirement: `${cat}·${layout}: 유효너비 ≥ ${min} m` },
        f.corridorWidth_m,
        atLeast(f.corridorWidth_m, min, 'm'),
      );
    },
  },

  // ── 출입구 통과유효폭 (장애인등편의법 별표1) ────────────────────────────────
  {
    id: 'door-effective-width',
    category: '출입구',
    clause: '장애인·노인·임산부등편의증진보장법 시행규칙 [별표1] — 출입구 통과유효폭 0.8m 이상',
    source: SRC_BARRIER,
    requirement: '통과유효폭 ≥ 0.8 m',
    check(f) {
      if (f.doorEffectiveWidth_m === undefined) return na(this);
      return verdict(this, f.doorEffectiveWidth_m, atLeast(f.doorEffectiveWidth_m, 0.8, 'm'));
    },
  },

  // ── 장애인 화장실 대변기 활동공간 (별표1) ───────────────────────────────────
  {
    id: 'disabled-toilet-activity-width',
    category: '위생',
    clause: '장애인·노인·임산부등편의증진보장법 시행규칙 [별표1] — 대변기 활동공간 폭 1.4m 이상',
    source: SRC_BARRIER,
    requirement: '활동공간 폭 ≥ 1.4 m',
    check(f) {
      if (f.disabledToiletActivityWidth_m === undefined) return na(this);
      return verdict(this, f.disabledToiletActivityWidth_m, atLeast(f.disabledToiletActivityWidth_m, 1.4, 'm'));
    },
  },
  {
    id: 'disabled-toilet-activity-depth',
    category: '위생',
    clause: '장애인·노인·임산부등편의증진보장법 시행규칙 [별표1] — 대변기 활동공간 깊이 1.8m 이상',
    source: SRC_BARRIER,
    requirement: '활동공간 깊이 ≥ 1.8 m',
    check(f) {
      if (f.disabledToiletActivityDepth_m === undefined) return na(this);
      return verdict(this, f.disabledToiletActivityDepth_m, atLeast(f.disabledToiletActivityDepth_m, 1.8, 'm'));
    },
  },

  // ── 접근로 연석 경계 높이 (매뉴얼/별표1) ────────────────────────────────────
  {
    id: 'curb-boundary-height',
    category: '접근로',
    clause: '장애인편의시설 매뉴얼 — 접근로 경계 연석/난간 벽면 0.3m 지점 높이 0.10~0.15m(별표1 근거)',
    source: SRC_MANUAL,
    requirement: '경계 높이 0.10 ~ 0.15 m',
    check(f) {
      if (f.curbBoundaryHeight_m === undefined) return na(this);
      return verdict(this, f.curbBoundaryHeight_m, between(f.curbBoundaryHeight_m, 0.1, 0.15, 'm'));
    },
  },
];

/** id → rule (traceability / single-rule invocation). */
export const CODECHECK_RULES_BY_ID: Record<string, Rule> = Object.fromEntries(
  CODECHECK_RULES.map((r) => [r.id, r]),
);
