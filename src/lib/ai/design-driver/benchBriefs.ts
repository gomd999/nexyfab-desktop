/**
 * design-driver/benchBriefs — **동결된** 실 LLM 측정 세트 (260728, §7-2).
 *
 * 왜 있는가: 260727·260728 두 세션 모두 측정 브리프를 레포 루트의 임시 `.ts` 에 새로 써서
 * 돌리고 지웠다. 그 결과 260727 의 "완주 10/12" 와 260728 의 "완주 1/6" 은 **같은 자로 잰
 * 수치가 아니고**, 개선이 실제로 개선인지 브리프가 쉬워/어려워진 것인지 구별할 방법이 없었다.
 * 측정 대상(엔진·프롬프트)은 바뀌어야 하지만 **자(브리프)는 고정돼야 한다.**
 *
 * 규약
 *  - 이 세트는 **동결**이다. 브리프 문구를 고치면 이전 세션 수치와의 비교가 깨진다.
 *    바꿔야 한다면 `BENCH_VERSION` 을 올리고 **새 버전으로 다시 기준선을 잡아라**
 *    (옛 수치를 새 세트에 갖다 붙이지 말 것). `benchBriefs.test.ts` 가 id·개수·버전을
 *    고정하고 있어 실수로 바뀌면 시끄럽게 깨진다.
 *  - `requires` 는 그 브리프를 **정직하게** 풀려면 필요한 기능이다. §5-4 의 지표
 *    ("완주율이 아니라 그 기능을 실제로 고르는가")를 자동으로 집계하기 위한 것.
 *  - ⚠ 이 v1 은 260727 의 a4 세트를 **복원한 것이 아니다**(그 파일은 남아있지 않다).
 *    새 기준선이고, 260727 의 10/12 와 직접 비교해서는 안 된다.
 */

import type { DesignBrief } from './types';

export const BENCH_VERSION = 'v1-260728';

/** 그 브리프를 정직하게 풀려면 계획이 써야 하는 기능. */
export type BenchCapability =
  | 'holes.round'
  | 'holes.rect'
  | 'holes.blind'
  | 'dim.aligned'
  | 'dim.axis'
  | 'volume.nonRect';

export interface BenchBrief {
  brief: DesignBrief;
  /** 사람이 읽는 한 줄. */
  label: string;
  /** 정직한 해법이 반드시 써야 하는 기능(없으면 순수 직사각 기준선). */
  requires: BenchCapability[];
}

const b = (id: string, label: string, text: string, requires: BenchCapability[] = []): BenchBrief => ({
  brief: { id, text },
  label,
  requires,
});

/**
 * 12브리프. 축이 겹치지 않게 골랐다 — 기준선(직사각) 2 · 비직사각 단면 4 ·
 * 구멍 3종 3 · 치수 축 2 · 복합 1.
 */
export const BENCH_BRIEFS: readonly BenchBrief[] = [
  // ── 기준선: 여기서 실패하면 개선이 아니라 회귀다 ──────────────────────────
  b('b-01', '평판',
    'A flat rectangular plate 150 mm wide, 90 mm deep and 12 mm thick, in SS400. Dimension the width, the depth and the thickness.'),
  b('b-02', '리브 붙은 평판(2 body)',
    'A 200 x 100 x 10 mm SS400 base plate with a 200 x 40 x 8 mm vertical rib standing on its centre line. Dimension the plate width, the plate depth and the rib height.'),

  // ── 비직사각 단면: 부피 산술이 어려운 축(§6-1) ────────────────────────────
  b('b-03', 'L-브래킷',
    'An L-profile bracket in AL6061: one leg 60 mm long, the other 40 mm long, wall thickness 8 mm throughout, extruded 20 mm deep. Dimension both leg lengths and the wall thickness.',
    ['volume.nonRect']),
  b('b-04', 'U-채널',
    'A U-channel in SS400: web 100 mm wide, two flanges 50 mm tall, wall 10 mm throughout, 200 mm long. Dimension the web width, the flange height and the wall thickness.',
    ['volume.nonRect']),
  b('b-05', 'T-형강',
    'A T-section in SS400, 150 mm long: flange 80 mm wide and 12 mm thick, web 60 mm tall and 10 mm thick. Dimension the flange width, the overall height and both thicknesses.',
    ['volume.nonRect']),
  b('b-06', '거셋 삼각판',
    'A right-triangle gusset plate in SS400 with legs 120 mm and 90 mm, 10 mm thick. Dimension both legs and the hypotenuse.',
    ['volume.nonRect', 'dim.aligned']),

  // ── 구멍 3종 ───────────────────────────────────────────────────────────
  b('b-07', '4구멍 플레이트',
    'An AL6061 plate 120 mm x 80 mm x 10 mm with four 10 mm diameter through holes, each 20 mm in from the corners. Dimension the plate width and depth.',
    ['holes.round']),
  b('b-08', '각파이프',
    'A square tube in SS400: 60 mm x 60 mm outside, 5 mm wall, 300 mm long. Dimension the outside size and the wall thickness.',
    ['holes.rect', 'volume.nonRect']),
  b('b-09', '블라인드 포켓 2개',
    'An AL6061 block 100 mm x 60 mm x 25 mm with two 16 mm diameter blind pockets 6 mm deep, on the top face, 30 mm apart. Dimension the block width, depth and height.',
    ['holes.blind']),

  // ── 치수 축(§5-3 대각) ──────────────────────────────────────────────────
  b('b-10', '45° 챔퍼 블록',
    'An SS400 block 80 mm x 80 mm x 15 mm with one corner cut off by a 45 degree chamfer whose legs are 20 mm each. Dimension the block width and the 20 mm chamfer leg (the leg, not the slant).',
    ['dim.axis', 'volume.nonRect']),
  b('b-11', '경사 심(shim)',
    'A tapered SS400 shim 10 mm thick: 120 mm long, 40 mm tall at one end and 15 mm tall at the other, the top edge sloping straight between them. Dimension both end heights and the true length of the sloping edge.',
    ['dim.aligned', 'volume.nonRect']),

  // ── 복합 ───────────────────────────────────────────────────────────────
  b('b-12', '구멍 뚫린 채널',
    'A U-channel in SS400, web 80 mm wide, flanges 40 mm tall, wall 8 mm, 250 mm long, with three 12 mm diameter through holes along the web on a 70 mm pitch. Dimension the web width, the flange height and the wall thickness.',
    ['volume.nonRect', 'holes.round']),
] as const;

/** 이 세트가 요구하는 기능의 합집합 — 커버리지 표를 만들 때 쓴다. */
export function benchCapabilities(): BenchCapability[] {
  const s = new Set<BenchCapability>();
  for (const x of BENCH_BRIEFS) for (const c of x.requires) s.add(c);
  return [...s].sort();
}
