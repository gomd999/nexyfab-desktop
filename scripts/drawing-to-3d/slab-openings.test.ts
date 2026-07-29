/**
 * 슬래브 관통 개구부 어휘 (260729).
 *
 * 계단·승강로·덕트 관통은 건물에서 필수인데 **낼 어휘가 없었다.**
 * `wall_with_openings` 는 수직면용이라 개구가 (x, sill) 로 나고, 슬래브는 수평면이라
 * 개구가 평면 (x, y) 로 난다 — 다른 어휘가 필요하다.
 *
 * 근거: buildingSMART IFC 4.3 공식 커버리지 샘플의 `slab-openings`.
 * ⚠ 코퍼스 **키워드 빈도로 고른 것이 아니다** — 상위 3개 기증자가 57.4%(역청 살포기
 * 276 · 타이거 전차 모형 249 · MeArm 95)라 빈도는 한 기증자에 과적합된다.
 * IFC 공식 샘플 46건만이 편향 없는 부분집합이다.
 */
import { describe, it, expect } from 'vitest';
import { gate, partAabb } from './reconstruct.mjs';
import { partVolume } from './structural.mjs';
import { buildProxyInventory } from './proxy-inventory.mjs';

const g = (p: Record<string, unknown>) =>
  (gate as unknown as (i: unknown) => string[])({ type: 'slab_with_openings', ...p });
const SLAB = { length: 6000, depth: 4000, thickness: 200, openings: [{ x: 1000, y: 1000, w: 1200, d: 2400 }] };

describe('부피는 폐형 — 관통이라 두께 전체가 빠진다', () => {
  it('L×D×T − Σ(w×d×T)', () => {
    const v = (partVolume as unknown as (t: string, p: unknown) => number)('slab_with_openings', SLAB);
    expect(v).toBe(6000 * 4000 * 200 - 1200 * 2400 * 200);
    expect(v).toBe(4_224_000_000);
  });

  it('개구가 없으면 통짜', () => {
    expect((partVolume as unknown as (t: string, p: unknown) => number)(
      'slab_with_openings', { ...SLAB, openings: [] })).toBe(4_800_000_000);
  });

  it('AABB 는 슬래브 외곽 — 개구는 내부라 영향 없다', () => {
    const a = (partAabb as unknown as (p: unknown) => { min: number[]; max: number[] })({ type: 'slab_with_openings', ...SLAB });
    expect(a.max).toEqual([6000, 4000, 200]);
  });
});

describe('게이트 — 형상이 성립하지 않는 입력을 잡는다', () => {
  it('정상은 통과', () => expect(g(SLAB)).toEqual([]));

  it.each([
    ['x 범위 밖', { ...SLAB, openings: [{ x: 5500, y: 1000, w: 1200, d: 2400 }] }, 'x 범위 밖'],
    ['y 범위 밖', { ...SLAB, openings: [{ x: 100, y: 3000, w: 1200, d: 2400 }] }, 'y 범위 밖'],
    ['개구가 슬래브 전체', { ...SLAB, openings: [{ x: 0, y: 0, w: 6000, d: 4000 }] }, '슬래브 전체'],
    ['두께 음수', { ...SLAB, thickness: -1 }, 'thickness invalid'],
  ])('%s → 걸린다', (_l, p, want) => {
    expect(g(p).join(' ')).toContain(want);
  });

  it('평면 겹침을 잡는다 — 벽체는 X구간만 보면 되지만 슬래브는 2D 다', () => {
    const overlap = { ...SLAB, openings: [{ x: 0, y: 0, w: 2000, d: 2000 }, { x: 1000, y: 1000, w: 2000, d: 2000 }] };
    expect(g(overlap).join(' ')).toContain('평면 겹침');
  });

  it('겹치지 않는 개구 2개는 통과 — 과탐 금지', () => {
    // X 구간만 봤다면 이 둘은 겹친 것으로 오판된다(둘 다 x=0~1000 · 2000~3000 아님).
    const ok = { ...SLAB, openings: [{ x: 0, y: 0, w: 1000, d: 1000 }, { x: 500, y: 2000, w: 1000, d: 1000 }] };
    expect(g(ok)).toEqual([]);
  });
});

describe('3열 부피 일치 — analytic·SCAD·STEP', () => {
  it('EXACT (프록시가 아니다)', async () => {
    const inv = await (buildProxyInventory as unknown as (o: unknown) => Promise<{ rows: { type: string; verdict: string }[] }>)(
      { types: ['slab_with_openings'] });
    expect(inv.rows[0].verdict).toBe('EXACT');
  }, 600_000);
});
