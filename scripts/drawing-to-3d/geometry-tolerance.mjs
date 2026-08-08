/**
 * geometry-tolerance.mjs — 공차 사다리 단일 소스 (linear-drawing-plan §0.1).
 * 흩어진 매직넘버(EPS·접촉 2mm·트림 여유…)를 한 곳으로. 전 모듈은 여기서만 import.
 *
 * 표기 반올림 규약(코드 주석으로 고정):
 *  - 내부 mm double 무반올림 · 반올림은 표기 시점 1회 · 표기값끼리 연산 금지
 *  - 합계·차는 원값 계산 후 반올림(자기정합 필요 시 최대잔여법)
 *  - STA 라벨=m 반올림(대조 허용오차 500mm+EPS) · 각도 표기 0.1° · 표고 0.01m
 */
export const EPS = 1e-6;                 // mm — 수치 동일성(부동소수 비교)
export const TOL_CONTACT = 2;            // mm — 접촉/체결 vs 간섭 분류(구 CONTACT_MM)
export const TOL_TRIM_RESIDUAL = 0.5;    // mm — 트림 후 잔여 겹침 허용(간섭 0 판정 여유)
export const SAG_TOL_DEFAULT = 25;       // mm — 원호→현 분할 새그 공차(파라미터화 가능)
export const CHORDS_PER_ARC_MAX = 64;    // 세그먼트당 현 상한(§A 성능 예산) — 초과 시 SAG 상향+고지
// N5(260808): 간섭·용접·보정 쌍 스캔이 그리드 브로드페이즈로 준선형화되어
// 종전 O(n²) 근거의 600 상한을 20,000으로 상향(타워 8,880부품 실측 게이트).
// STEP 방출(STEP_PARTS_MAX)·GA 등 다른 예산은 각자 유지 — 이 값은 조립 검증 예산.
export const PARTS_BUDGET = 20000;       // 어셈블리 부품 상한(§A) — 초과=정직 거부
export const STEP_PARTS_MAX = 300;       // STEP 방출 부품 상한(§A OCCT wasm OOM 예방)

/** 분절 후 최소 세그먼트 — 초단 조각 금지(§0.1). */
export const minSeg = (stemT) => Math.max(2 * (Number(stemT) > 0 ? Number(stemT) : 500), 1000);
/** 곡선 사이 최소 직선 여유(§1-1 게이트 2). */
export const minTangent = (baseW) => 2 * (Number(baseW) > 0 ? Number(baseW) : 1000);
/** STA 표기(m 반올림) 대조 허용오차. */
export const STA_LABEL_TOL = 500 + EPS;  // mm
