/**
 * inertia.test.ts — **관성 텐서** (260803).
 *
 * 갭 매트릭스가 지목한 빈칸 ①. 동역학·모달·기울임 응답의 전제인데 종전 `structural` 은
 * 질량·CG·반력·전도까지만 있었다.
 *
 * ## 이 파일이 지키는 것
 * ① **폐형과 대조한다.** 「값이 나온다」는 검사가 아니다 — 균질 직육면체·원기둥·구는
 *    손으로 풀 수 있으므로 그것과 맞는지 본다.
 * ② **근사를 근사라고 말하는지** 확인한다. 관성값만 주고 근거를 안 적으면 폐형인 줄 안다.
 * ③ **평행축 정리**가 걸렸는지 — 떨어져 있는 두 덩어리는 각자 관성의 합보다 훨씬 크다.
 */

import { describe, expect, it } from 'vitest';
import { buildAssembly } from './assembly.mjs';

type Inertia = {
  Ixx: number; Iyy: number; Izz: number; Ixy: number; Ixz: number; Iyz: number;
  aboutCgMm: number[]; basis: string; exactCount: number; approxCount: number;
};
type Built = { structural: { totalExactKg: number; inertia: Inertia | null } };
const build = buildAssembly as unknown as (a: unknown) => Built;
const one = (type: string, params: Record<string, number>, at: Record<string, number> = { tx: 0, ty: 0, tz: 0 }) =>
  build({ name: 't', parts: [{ id: 'p', type, material: 'steel', params, at }] });

describe('★① 폐형과 대조 — 「값이 나온다」는 검사가 아니다', () => {
  it('균질 직육면체 100×200×300 = m(b²+c²)/12', () => {
    const b = one('box', { width: 100, depth: 200, height: 300 });
    const m = b.structural.totalExactKg;
    const I = b.structural.inertia!;
    expect(I.Ixx).toBeCloseTo(m * (200 ** 2 + 300 ** 2) / 12, 0);
    expect(I.Iyy).toBeCloseTo(m * (100 ** 2 + 300 ** 2) / 12, 0);
    expect(I.Izz).toBeCloseTo(m * (100 ** 2 + 200 ** 2) / 12, 0);
  });

  it('속찬 원기둥 축방향 = mr²/2 · 횡방향 = m(3r²+h²)/12', () => {
    const b = one('cylinder', { diameter: 100, length: 400 });
    const m = b.structural.totalExactKg;
    const I = b.structural.inertia!;
    expect(I.Izz / (m * 50 * 50 / 2)).toBeCloseTo(1, 3);
    expect(I.Ixx / (m * (3 * 50 * 50 + 400 ** 2) / 12)).toBeCloseTo(1, 3);
  });

  it('속찬 구 = 2mr²/5 (세 축 동일)', () => {
    const b = one('sphere', { diameter: 200 });
    const m = b.structural.totalExactKg;
    const I = b.structural.inertia!;
    expect(I.Ixx / (2 * m * 100 * 100 / 5)).toBeCloseTo(1, 3);
    expect(I.Ixx).toBeCloseTo(I.Iyy, 3);
    expect(I.Iyy).toBeCloseTo(I.Izz, 3);
  });

  it('★대칭 형상은 관성곱이 0 이다 — 축 정렬이 틀리면 여기서 드러난다', () => {
    const I = one('box', { width: 100, depth: 100, height: 100 }).structural.inertia!;
    for (const v of [I.Ixy, I.Ixz, I.Iyz]) expect(Math.abs(v)).toBeLessThan(1e-6);
  });
});

describe('★② 평행축 정리 — 떨어진 덩어리는 훨씬 무겁게 돈다', () => {
  it('같은 블록 2개를 x 로 벌리면 Izz 가 m·d² 만큼 는다', () => {
    const d = 1000;
    const two = build({
      name: 't',
      parts: [
        { id: 'a', type: 'box', material: 'steel', params: { width: 100, depth: 100, height: 100 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'b', type: 'box', material: 'steel', params: { width: 100, depth: 100, height: 100 }, at: { tx: d, ty: 0, tz: 0 } },
      ],
    });
    const M = two.structural.totalExactKg;      // 두 블록 합
    const I = two.structural.inertia!;
    // 각 블록이 CG 에서 d/2 떨어져 있다 → 2 × (m/2)(d/2)² = M d²/4
    const own = M * (100 ** 2 + 100 ** 2) / 12; // 두 블록 자기 관성 합
    expect(I.Izz).toBeCloseTo(own + M * d * d / 4, 0);
    // ⚠ 부품 로컬 원점은 **모서리**다(width/2=50 이 CG). 두 CG 는 0+50 과 1000+50 → 평균 550.
    expect(I.aboutCgMm[0]).toBeCloseTo(d / 2 + 50, 1);
  });
});

describe('★③ 근사를 근사라고 말한다', () => {
  it('원기둥·구만 있으면 폐형이라고 밝힌다', () => {
    const I = one('cylinder', { diameter: 100, length: 400 }).structural.inertia!;
    expect(I.approxCount).toBe(0);
    expect(I.basis).toMatch(/폐형/);
  });

  it('★AABB 근사를 쓴 부재 수와 그 한계를 적는다 — 안 적으면 폐형인 줄 안다', () => {
    const I = one('h_section', { H: 300, B: 300, tw: 10, tf: 15, length: 6000 }).structural.inertia!;
    expect(I.approxCount).toBeGreaterThan(0);
    expect(I.basis).toMatch(/근사/);
    expect(I.basis, '어느 방향으로 틀리는지까지 적어야 쓸모가 있다').toMatch(/과대/);
  });

  it('빈 어셈블리에서는 null 을 준다 — 0 을 주면 「관성이 0」으로 읽힌다', () => {
    const b = build({ name: 't', parts: [{ id: 'x', type: 'box', params: { width: 0, depth: 0, height: 0 }, at: {} }] });
    expect(b.structural?.inertia ?? null).toBeNull();
  });
});
