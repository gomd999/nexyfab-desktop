/** layout-plan 폐형 테스트 — 존 검증·패킹·명시 배치·정직 오류. */
import { describe, it, expect } from 'vitest';
import { planLayout } from './layout-plan.mjs';

const AREA = { w: 1850, d: 700 };

describe('planLayout', () => {
  it('존 패킹으로 3D 좌표를 유도하고 2D 겹침 0 을 보장한다', () => {
    const r = planLayout({
      area: AREA,
      zones: [{ id: 'equip', rect: [0, 0, 1850, 700], zMin: 250, zMax: 1250 }],
      items: [
        { id: 'pump', zone: 'equip', footprint: [300, 300] },
        { id: 'filter', zone: 'equip', footprint: [200, 200] },
        { id: 'tank', zone: 'equip', footprint: [600, 600] },
      ],
    });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.placements)).toHaveLength(3);
    expect((r.placements as Record<string, { tz: number }>).pump.tz).toBe(250); // 존 높이 대역 하한
    // 2D 겹침 검증(전수)
    const rects = Object.entries(r.placements).map(([id, p]) => ({ id, p }));
    expect(r.svg).toContain('pump');
  });

  it('존 용량 초과는 정직 오류(좌표 날조 없음)', () => {
    const r = planLayout({
      area: AREA,
      zones: [{ id: 'small', rect: [0, 0, 400, 400], zMin: 0 }],
      items: [
        { id: 'big1', zone: 'small', footprint: [350, 350] },
        { id: 'big2', zone: 'small', footprint: [350, 350] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('용량 초과');
    expect((r.placements as Record<string, unknown>).big2).toBeUndefined();
  });

  it('명시 배치의 존 이탈·겹침을 검출한다', () => {
    const r = planLayout({
      area: AREA,
      zones: [{ id: 'z1', rect: [0, 0, 1000, 700], zMin: 250 }],
      items: [
        { id: 'a', zone: 'z1', footprint: [300, 300], at: [100, 100] },
        { id: 'b', zone: 'z1', footprint: [300, 300], at: [200, 200] }, // a 와 겹침
        { id: 'c', zone: 'z1', footprint: [300, 300], at: [900, 100] }, // 존 밖(x 초과)
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('평면 겹침');
    expect(r.errors.join(' ')).toContain('밖');
  });

  it('같은 평면 겹침 존도 높이 대역이 분리되면 허용(상부 랙존 패턴)', () => {
    const r = planLayout({
      area: AREA,
      zones: [
        { id: 'equip', rect: [0, 0, 1850, 700], zMin: 250, zMax: 1250 },
        { id: 'rack', rect: [500, 0, 1350, 700], zMin: 1280, zMax: 2100 },
      ],
      items: [{ id: 'tank', zone: 'equip', footprint: [600, 600] }],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toContain('높이 대역 분리로 허용');
  });
});
