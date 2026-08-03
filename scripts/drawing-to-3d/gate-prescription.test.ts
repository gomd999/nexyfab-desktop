/**
 * gate-prescription.test.ts — **게이트는 원인이 아니라 조치를 말한다** (260803).
 *
 * ## 왜 이 파일이 있는가
 * 라이브에서 노트북 거치대 스펙(부품 20종)을 넣었을 때 사용자 화면에 이게 나갔다:
 * ```
 *   friction_washer_1: bcd invalid, boltHoleD invalid, boltCount invalid,
 *                      BCD not between bore and OD, bolt holes break bore rim, boltCount invalid
 *   … × 10 부품
 *   laptop_plate: hole[0] d invalid, hole[1] d invalid, hole[2] d invalid, hole[3] d invalid
 * ```
 * **게이트는 옳게 작동했다.** 와셔를 플랜지로 분류한 입력을 정확히 막았다.
 * 그런데 사용자가 본 것은 **빨간 벽**이었고, 정작 필요한 한 줄("이건 washer 다")은 없었다.
 * 같은 스펙을 GPT 에 넣은 사용자는 「얘가 더 못한다」고 느꼈다 — 실제로는 GPT 쪽이
 * 스펙을 여러 건 위반했는데도.
 *
 * ⚠ **검증이 강점이 되려면 판정이 조치로 끝나야 한다.** 원인만 말하는 게이트는
 *   결함으로 읽힌다. 이 회귀는 그 성질을 고정한다.
 * ⚠ 파생 오류를 쏟지 않는 것도 같은 문제다 — `d` 가 없으면 `x/y outside` 는 NaN 비교라
 *   **항상** 실패한다. 한 건이 세 건으로 부풀어 나갔다.
 */

import { describe, expect, it } from 'vitest';
import { gate } from './reconstruct.mjs';

const g = (type: string, params: Record<string, unknown>): string[] =>
  (gate as unknown as (i: Record<string, unknown>) => string[])({ type, ...params });

describe('flange ↔ washer 오분류 — 6건이 아니라 처방 1건', () => {
  // 라이브 입력 그대로: 힌지 마찰 와셔 외경 18 · 내경 8 · 두께 1
  const misclassified = { outerDia: 18, boreDia: 8, thickness: 1 };

  it('★볼트원이 통째로 없으면 washer 를 지목한다', () => {
    const e = g('flange', misclassified);
    expect(e).toHaveLength(1);
    expect(e[0]).toContain('washer');
  });

  it('지목된 정답 경로는 실제로 통과한다 — 처방이 맞는지까지 본다', () => {
    expect(g('washer', misclassified)).toEqual([]);
  });

  it('진짜 플랜지는 그대로 통과한다', () => {
    expect(g('flange', {
      outerDia: 150, boreDia: 50, thickness: 12, bcd: 100, boltHoleD: 14, boltCount: 4,
    })).toEqual([]);
  });

  it('볼트원이 **일부만** 있으면 오분류가 아니라 입력 누락 — 기존 검사를 돈다', () => {
    const e = g('flange', { outerDia: 150, boreDia: 50, thickness: 12, bcd: 100 });
    expect(e.length).toBeGreaterThan(0);
    expect(e.join(' ')).not.toContain('washer');
  });

  it('boltCount 를 두 번 세지 않는다 — 라이브 메시지에 중복으로 나갔다', () => {
    const e = g('flange', { outerDia: 150, boreDia: 50, thickness: 12, bcd: 100, boltHoleD: 14 });
    expect(e.filter((m) => m.includes('boltCount'))).toHaveLength(1);
  });
});

describe('사각 개구를 원형 홀에 밀어넣은 경우', () => {
  // 라이브 입력: 받침판 280×240×t4, 중앙 통풍구 180×130 (사각)
  const plate = { width: 280, depth: 240, thickness: 4 };

  it('★slab_with_openings 를 지목하고, 파생 오류를 쏟지 않는다', () => {
    const e = g('plate_with_holes', { ...plate, holes: [{ x: 140, y: 120, w: 180, h: 130 }] });
    expect(e).toHaveLength(1); // d 없음 1건만 — x/y outside 는 NaN 파생이라 내지 않는다
    expect(e[0]).toContain('slab_with_openings');
  });

  it('지목된 정답 경로는 실제로 통과한다', () => {
    expect(g('slab_with_openings', {
      length: 280, depth: 240, thickness: 4, openings: [{ x: 50, y: 55, w: 180, d: 130 }],
    })).toEqual([]);
  });

  it('정상 원형 구멍은 그대로 통과한다', () => {
    expect(g('plate_with_holes', {
      ...plate,
      holes: [{ x: 20, y: 20, d: 5.5 }, { x: 260, y: 20, d: 5.5 },
        { x: 20, y: 220, d: 5.5 }, { x: 260, y: 220, d: 5.5 }],
    })).toEqual([]);
  });

  it('구멍이 판보다 크면 원인과 대안을 같이 말한다', () => {
    const e = g('plate_with_holes', { ...plate, holes: [{ x: 140, y: 120, d: 300 }] });
    expect(e.join(' ')).toContain('slab_with_openings');
  });
});
