/**
 * dimensionLegibility — **치수선이 다시 읽히는 크기인가** (260731).
 *
 * ## 어디서 나온 값인가 — 지어낸 임계가 아니다
 * 2D→3D 평가셋 50장 실측(`scripts/drawing-to-3d/run-e2e.mjs`, 260731):
 * ```
 *   주기 방식      치수선 길이   두께 판독
 *   치수선          9.6 px        0/6    ← 전부 미판독
 *   치수선         14.4 px 이상   4/4    ← 전부 판독
 *   텍스트 "t=4"   (해당 없음)   10/10   ← 1.5mm 두께도 100%
 * ```
 * 같은 판독기·같은 도면 양식에서 **주기 방식만 다른데 0% 대 100%** 로 갈렸다.
 * `l_bracket` 의 두께는 6/6 미판독이었고 원인은 모델이 아니라 **9.6px 짜리 치수선**이었다.
 *
 * ## 왜 세 상태인가 — 「모른다」를 「통과」로 바꾸지 않는다
 * 실측한 것은 **9.6 과 14.4 두 점**뿐이다. 그 사이 어디서 갈리는지는 **재지 않았다.**
 * 그래서 그 구간을 `legible` 로도 `illegible` 로도 말하지 않는다 — `unverified` 다.
 * ⚠ 임계를 하나로 뭉개면 「10.0px 는 읽힌다」는, 근거 없는 주장을 코드가 하게 된다.
 *
 * ## 무엇에 쓰나
 * 도면을 **내보내기 전에** 짧은 치수를 찾아 지시선 주기(`t=4` 형태)로 바꾸도록 신호한다.
 * 우리가 만든 도면을 우리 판독기가 못 읽으면 왕복(도면→3D→도면)이 그 지점에서 끊긴다.
 */

/** 실측 하한 — 이 이하는 **판독 0%** 로 관측됐다(6/6 미판독). */
export const DIM_SPAN_ILLEGIBLE_PX = 9.6;
/** 실측 상한 — 이 이상은 **판독 100%** 로 관측됐다(4/4 판독). */
export const DIM_SPAN_LEGIBLE_PX = 14.4;

export type DimLegibility = 'legible' | 'unverified' | 'illegible';

export interface DimLegibilityResult {
  status: DimLegibility;
  spanPx: number;
  /** 지시선 주기로 바꾸기를 권하는가. `unverified` 도 권한다 — 확인되지 않은 채 내보내지 않는다. */
  recommendLeaderNote: boolean;
  reason: string;
}

/**
 * 치수선의 렌더 길이(px)로 재판독 가능성을 판정한다.
 *
 * ⚠ `unverified` 에서도 지시선을 **권한다.** 근거 없이 통과시키는 것보다, 확실히 읽히는
 *   방식으로 바꾸는 편이 싸다(주기는 1.5mm 두께도 10/10 읽혔다).
 * ⚠ 유한하지 않은 값은 판정하지 않는다 — 0 이나 NaN 을 「짧다」로 처리하면
 *   **계산 실패가 도면 문제로 둔갑**한다.
 */
export function assessDimensionLegibility(spanPx: number): DimLegibilityResult {
  if (!Number.isFinite(spanPx) || spanPx < 0) {
    return {
      status: 'unverified',
      spanPx,
      recommendLeaderNote: true,
      reason: `치수선 길이를 알 수 없다(${spanPx}) — 판정하지 않는다. 계산 실패를 도면 문제로 바꾸지 않기 위해 「불명」으로 둔다.`,
    };
  }
  if (spanPx <= DIM_SPAN_ILLEGIBLE_PX) {
    return {
      status: 'illegible',
      spanPx,
      recommendLeaderNote: true,
      reason: `치수선 ${spanPx.toFixed(1)}px ≤ ${DIM_SPAN_ILLEGIBLE_PX}px — 실측에서 이 길이는 6/6 미판독이었다. 지시선 주기로 표기하라.`,
    };
  }
  if (spanPx >= DIM_SPAN_LEGIBLE_PX) {
    return {
      status: 'legible',
      spanPx,
      recommendLeaderNote: false,
      reason: `치수선 ${spanPx.toFixed(1)}px ≥ ${DIM_SPAN_LEGIBLE_PX}px — 실측에서 이 길이는 4/4 판독됐다.`,
    };
  }
  return {
    status: 'unverified',
    spanPx,
    recommendLeaderNote: true,
    reason: `치수선 ${spanPx.toFixed(1)}px 는 실측 구간(${DIM_SPAN_ILLEGIBLE_PX}~${DIM_SPAN_LEGIBLE_PX}px) 사이다 — **이 길이는 측정한 적이 없다.** 읽힌다고 주장하지 않는다.`,
  };
}

/**
 * 도면 한 장의 치수들을 훑어 **주기로 바꿔야 할 것**을 모은다.
 * @param spansPx 각 치수선의 렌더 길이(px)
 * @returns 권고 대상 인덱스와 요약. 전부 안전하면 빈 목록.
 */
export function findIllegibleDimensions(spansPx: readonly number[]): {
  flagged: Array<{ index: number } & DimLegibilityResult>;
  summary: string;
} {
  const flagged = spansPx
    .map((s, index) => ({ index, ...assessDimensionLegibility(s) }))
    .filter((r) => r.recommendLeaderNote);
  const illegible = flagged.filter((f) => f.status === 'illegible').length;
  const unverified = flagged.length - illegible;
  return {
    flagged,
    summary: flagged.length
      // ⚠ 두 수를 합쳐 하나로 보고하지 않는다 — 「못 읽는다」와 「모른다」는 대응이 다르다.
      ? `치수 ${spansPx.length}개 중 ${flagged.length}개 지시선 권고 (판독 불가 ${illegible} · 미검증 ${unverified})`
      : `치수 ${spansPx.length}개 전부 실측 판독 구간 이상`,
  };
}
