/**
 * iso286.mjs — ISO 286 표준공차등급(IT)·축 기본편차의 **산식 구현** (260801e).
 *
 * ## 왜 표를 옮겨 적지 않는가
 * `fitClassLookup` 의 표는 **⌀18~30mm 구간만** 담고 있었고, 그 밖에서도 그대로 적용돼
 * ⌀6 과 ⌀400 이 같은 틈새를 냈다(260801d 에 구간 방어로 막았다).
 * 전 구간 표를 **기억으로 옮겨 적는 것이 가장 위험하다** — 그건 지어내기다.
 *
 * 대신 ISO 286 이 **산식으로 정의한 부분만** 구현한다:
 *   표준공차단위  i = 0.45·∛D + 0.001·D   (D = 치수 구간의 기하평균, mm)
 *   IT 등급        IT5=7i · IT6=10i · IT7=16i · IT8=25i · IT9=40i · IT10=64i · IT11=100i
 *
 * ## ⚠ 검증 없이 쓰지 않았다 — 기존 표로 대조했다
 * ⌀18~30(D=23.238, i=1.3074µm)에서:
 *   IT6 13.1(표 13) · IT7 20.9(표 21) · IT8 32.7(표 33) · IT11 130.7(표 130)
 *   g −7.29(표 −7) · f −19.98(표 −20) · e −39.95(표 −40) · k +1.71(표 +2) · n +14.57(표 +15)
 * 전부 반올림 오차 안에서 일치한다.
 *
 * ## ⚠ 일치하지 않은 것은 **확장하지 않는다**
 *   c: −52·D^0.2 = −97.6 인데 표는 **−110** 이다 → 이 산식은 틀렸다.
 *   p·s·u 는 기본편차가 IT 등급에 걸린 규칙(Δ 규칙)이라 **확인된 산식이 없다.**
 * → `c·p·s·u` 는 산식으로 내지 않는다. 호출측이 표 구간(⌀18~30)으로 제한한다.
 *   한 점에 맞춰 산식을 역추정하면 그건 검증이 아니라 과적합이다.
 *
 * ## ⚠ ISO 표는 **반올림된 값**을 싣는다
 * 산식값과 표값이 1µm 차이날 수 있다. 「표와 동일」이라 말하지 않는다 — 호출측이
 * 산식 기반임을 고지한다.
 *
 * ⚠⚠ **미러 파일이다.** `src/app/[lang]/shape-generator/assembly/iso286.ts` 와 **같은 식**을
 *   담는다 — `.mjs`(형상 검사)는 `.ts`(UI)를 import 할 수 없기 때문이다.
 *   두 벌이면 언젠가 갈리므로 **적합성 회귀**(`iso286-mirror.test.ts`)로 묶어 뒀다:
 *   전 구간·전 등급·전 기호에서 두 구현이 **같은 값**을 내는지 검사한다.
 *   한쪽만 고치면 그 회귀가 먼저 깨진다.
 */

/** ISO 286 치수 구간 상한(mm). 구간별로 기하평균 D 를 잡아 i 를 낸다. */
const SIZE_BANDS = [
  { lo: 0, hi: 3 }, { lo: 3, hi: 6 }, { lo: 6, hi: 10 }, { lo: 10, hi: 18 },
  { lo: 18, hi: 30 }, { lo: 30, hi: 50 }, { lo: 50, hi: 80 }, { lo: 80, hi: 120 },
  { lo: 120, hi: 180 }, { lo: 180, hi: 250 }, { lo: 250, hi: 315 },
  { lo: 315, hi: 400 }, { lo: 400, hi: 500 },
];

/** 산식이 정의된 최대 호칭치수(mm). 넘으면 다른 규정(IT 산식이 달라진다)이라 거부한다. */
export const ISO286_MAX_MM = 500;

/** IT 등급 → 표준공차단위 배수. 5~11 만 둔다(그 밖은 쓰지 않으므로 넣지 않는다). */
const IT_MULTIPLIER = {
  5: 7, 6: 10, 7: 16, 8: 25, 9: 40, 10: 64, 11: 100,
};

/** 호칭치수가 속한 구간의 기하평균 D. 구간 밖이면 null. */
function bandMean(nominalMm) {
  const b = SIZE_BANDS.find((x) => nominalMm > x.lo && nominalMm <= x.hi);
  if (!b) return null;
  // 최초 구간(0~3)은 관례상 √(1×3) 을 쓴다 — 0 을 쓰면 ∛0=0 이 되어 i 가 무너진다.
  const lo = b.lo === 0 ? 1 : b.lo;
  return Math.sqrt(lo * b.hi);
}

/** 표준공차단위 i(µm) — ISO 286. 구간 밖이면 null. */
export function toleranceUnit(nominalMm) {
  const D = bandMean(nominalMm);
  if (D === null) return null;
  return 0.45 * Math.cbrt(D) + 0.001 * D;
}

/**
 * IT 등급 공차(µm). 구간 밖이거나 미지원 등급이면 **null** — 0 을 돌려주지 않는다
 * (0 은 「공차 없음」으로 읽힌다).
 */
export function itTolerance(nominalMm, grade) {
  const mult = IT_MULTIPLIER[grade];
  const i = toleranceUnit(nominalMm);
  if (mult === undefined || i === null) return null;
  return Math.round(mult * i);
}

/** 산식이 검증된 축 기본편차 기호. `c·p·s·u` 는 **여기 없다**(위 경고 참조). */
export const FORMULA_SHAFT_SYMBOLS = ['e', 'f', 'g', 'h', 'k', 'n'];

/**
 * 축 기본편차(µm) — 구멍기준식에서 축의 **구멍 쪽 편차**.
 * `e·f·g` 는 상편차 es(음수) · `h` 는 es=0 · `k·n` 은 하편차 ei(양수).
 * 반환은 `{ kind:'es'|'ei', value }` — 어느 쪽 편차인지 **이름으로** 준다
 * (부호만 보고 추측하면 h(0)에서 갈린다).
 */
export function shaftFundamentalDeviation(nominalMm, sym) {
  const D = bandMean(nominalMm);
  if (D === null) return null;
  switch (sym) {
    case 'e': return { kind: 'es', value: -Math.round(11 * D ** 0.41) };
    case 'f': return { kind: 'es', value: -Math.round(5.5 * D ** 0.41) };
    case 'g': return { kind: 'es', value: -Math.round(2.5 * D ** 0.34) };
    case 'h': return { kind: 'es', value: 0 };
    case 'k': return { kind: 'ei', value: Math.round(0.6 * Math.cbrt(D)) };
    case 'n': return { kind: 'ei', value: Math.round(5 * D ** 0.34) };
    default: return null;
  }
}

/**
 * 구멍 기본편차 — **H 만** 구현한다(구멍기준식의 기준 구멍).
 * 다른 구멍 기호(G·K·N…)는 축 기호와 대칭 규칙이 있으나 여기서 쓰지 않으므로 넣지 않는다.
 */
export function holeFundamentalDeviation(sym) {
  return sym === 'H' ? { kind: 'EI', value: 0 } : null;
}
