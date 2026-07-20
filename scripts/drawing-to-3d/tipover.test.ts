/**
 * 전도(tip-over) 판정 회귀 — supports 미지정 폴백의 지지 기반 (260720 수리).
 *
 * 결함: 종전 폴백은 "부품 CG 점들의 XY 스팬"을 지지로 썼다. 동축 배치(판+기둥)는 모든
 * CG 가 한 점이라 지지폭이 0 으로 붕괴 → 명백히 안정한 받침대가 staticAngleDeg 0°(과탐).
 * 반대로 공중 부품(크레인 지브)의 CG 도 지지로 계상해 실제 베이스보다 넓은 스팬(미탐 방향).
 *
 * 수리: 접지 부품(z≈최저면, 접촉 공차 1mm)들의 배치 AABB 합집합 = footprint. 전도축은
 * 그 경계, 팔길이는 CG 최근접 경계까지의 수평거리(편심 CG 에서 baseShort/2 보다 보수적).
 * 강체 전도 개산 — 앵커·마찰·동적 하중 미고려(structural.mjs 주석 참조).
 */
import { describe, it, expect } from 'vitest';
import { structuralCheck } from './structural.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';

// 300×300 판 + 중앙 기둥 — 명백히 안정한 받침대(easy-summary OK_ASM 과 동일 형상)
const PEDESTAL = {
  name: '받침대',
  parts: [
    { id: 'base', type: 'plate_with_holes', material: 'SS400', params: { width: 300, depth: 300, thickness: 20, holes: [{ x: 40, y: 40, d: 10 }] }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'post', type: 'box', material: 'SS400', params: { width: 60, depth: 60, height: 400 }, at: { tx: 120, ty: 120, tz: 20 } },
  ],
};

describe('전도 폴백 — 접지 footprint', () => {
  it('판+기둥 받침대: 지지폭 0 붕괴(과탐)가 아니라 판 footprint 로 안정 판정', () => {
    const s = structuralCheck(PEDESTAL, {});
    // 손계산: 판(300×300×20, 홀 1개 공제)+기둥(60×60×400), 밀도 7980(STS316 폴백)
    //   판 14.35kg@z10 + 기둥 11.49kg@z220 → cgZ = 103.4mm, CG XY = (150,150) 중앙
    //   footprint = 판 AABB 0..300 → 전도 팔길이 = 150mm
    //   전도각 = atan(150/103.4) = 55.4° · 0.5g FS = 150/(0.5×103.4) = 2.90
    expect(s.tipover.supportBasis).toBe('ground-footprint');
    expect(s.tipover.edgeDistMm).toBe(150);
    expect(s.tipover.staticAngleDeg).toBeCloseTo(55.4, 1);
    expect(s.tipover.seismicFS).toBeCloseTo(2.9, 2);
    expect(s.supports.map((x: { pos: number[] }) => x.pos)).toEqual([[0, 0], [300, 0], [0, 300], [300, 300]]);
    expect(s.warnings.filter((w: string) => w.includes('전도'))).toEqual([]);
  });

  it('타워크레인: 지지 기반은 접지 베이스 블록뿐 — 여전히 위험 판정(F2 의존)', () => {
    const s = structuralCheck(buildAssemblyTemplate('mech', 'tower_crane', {}), {});
    // 접지 부품 = base_block(3520×3520 @ x/y −960..2560)만. 지브·마스트 CG 는 지지가 아니다.
    expect(s.tipover.supportBasis).toBe('ground-footprint');
    expect(s.supports.map((x: { pos: number[] }) => x.pos[0])).not.toContain(29732.5); // 종전 CG 스팬 잔재 금지
    expect(s.tipover.seismicFS).toBeLessThan(1.5);
    expect(s.tipover.staticAngleDeg).toBeLessThan(15);
    expect(s.ok).toBe(false);
    expect(s.warnings.some((w: string) => w.includes('전도'))).toBe(true);
  });

  it('전도축은 footprint 경계 — 팔길이는 CG 최근접 경계까지(전면 걸레받이 후퇴 반영)', () => {
    // counter_bar 기본값: 접지 부품 = plinth(y 60..700)만. 전면 전도축 y=60, CG y=223.4
    //   → 팔길이 163.4mm(종전 CG 스팬+중앙가정 = 527mm 는 접지 아닌 브래킷 CG 포함 — 과대)
    const s = structuralCheck(buildAssemblyTemplate('interior', 'counter_bar', {}), {});
    expect(s.tipover.supportBasis).toBe('ground-footprint');
    expect(s.tipover.edgeDistMm).toBeCloseTo(163.4, 0);
    expect(s.tipover.seismicFS).toBeLessThan(1.5); // 자립 바 카운터 0.5g = 앵커 필요(경고가 맞다)
  });

  it('supports 명시 시 폴백을 쓰지 않는다(선언 우선) — 편심 CG 는 최근접 경계 팔길이', () => {
    const s = structuralCheck(PEDESTAL, { supports: [[0, 0], [200, 0], [0, 300], [200, 300]] });
    expect(s.tipover.supportBasis).toBe('declared');
    // CG x=150, 지지 x 0..200 → 팔길이 = min(150, 50, 150, 150) = 50 (baseShort/2=100 이 아니라)
    expect(s.tipover.edgeDistMm).toBe(50);
  });
});
