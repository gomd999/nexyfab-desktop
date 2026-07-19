/**
 * 실단면 질량·접합선 회귀 (도그푸딩 260719b — F1·F12·F6·F13).
 *
 * 이 파일의 목적은 "코드가 자기 계약을 지키는가"가 아니라 **모듈 경계를 교차 검증**하는 것이다:
 *  - std-snap 이 붙인 발주 라벨(각관)과 structural/boq 의 질량이 같은 단면을 보는가 (F1)
 *  - 그 질량이 **공표 규격표 kg/m** 와 맞는가 (해석값 대조 — 코드끼리의 동어반복 금지)
 *  - 판재 함체가 통짜가 아닌 셸로 계산되는가 (F12)
 *  - 회전체 이음선이 사각 둘레가 아닌 원주인가 (F6)
 *  - 동일 부재가 항상 동일 표시 질량인가 (F13)
 */
import { describe, it, expect } from 'vitest';
import { partVolume, partVolumeEffective, stdHollowSection, structuralCheck, DENSITY } from './structural.mjs';
import { buildAssembly } from './assembly.mjs';
import { computeBOQ } from './boq.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';

const STEEL = DENSITY.steel / 1e9; // kg/mm³

/** 부재 1m당 질량(kg/m) — 규격표와 직접 대조 가능한 단위로 환산 */
function kgPerM(part: Record<string, unknown>) {
  const eff = partVolumeEffective(part as never);
  const h = (part.params as { height: number }).height;
  return (eff.volumeMm3 * STEEL) / (h / 1000);
}

describe('F1 — 규격 스냅 부재는 질량도 중공 단면 (라벨과 질량이 같은 소스)', () => {
  it('SQ150×150×6t: 공표 26.4 kg/m 와 5% 이내 · 중실 대비 −85%', () => {
    const leg = { id: 'leg', type: 'box', role: 'column', material: 'steel', params: { width: 150, depth: 150, height: 1519 } };
    const eff = partVolumeEffective(leg as never);
    expect(eff.basis).toBe('hollow-std');

    // 해석값 대조: KS D 3568 각형강관 150×150×6t 공표 단위질량 26.4 kg/m
    // (본 식은 코너R 미반영 직각 모서리 → 공표치보다 소폭 과대. 5% 게이트)
    expect(kgPerM(leg)).toBeGreaterThan(26.4 * 0.95);
    expect(kgPerM(leg)).toBeLessThan(26.4 * 1.05);

    // 도그푸딩 실측 재현: 중실 268.3 kg → 실단면 ~41 kg (+34% 과대가 아니라 실물)
    const solidKg = partVolume('box', leg.params) * STEEL;
    expect(solidKg).toBeGreaterThan(260);
    expect(eff.volumeMm3 * STEEL).toBeLessThan(45);
    expect(eff.volumeMm3 / partVolume('box', leg.params)).toBeLessThan(0.16); // −84% 이상
  });

  it('SQ100×100×6t: 공표 17.0 kg/m 와 5% 이내', () => {
    const col = { id: 'c', type: 'box', role: 'column', material: 'steel', params: { width: 100, depth: 100, height: 3000 } };
    expect(kgPerM(col)).toBeGreaterThan(17.0 * 0.95);
    expect(kgPerM(col)).toBeLessThan(17.0 * 1.05);
  });

  it('두께 선언(wallThk)을 존중 — SQ150×4.5t 는 6t 보다 가볍다', () => {
    const t6 = stdHollowSection({ type: 'box', role: 'column', material: 'steel', params: { width: 150, depth: 150, height: 1000 } } as never)!;
    const t45 = stdHollowSection({ type: 'box', role: 'column', material: 'steel', params: { width: 150, depth: 150, height: 1000, wallThk: 4.5 } } as never)!;
    expect(t6.thkMm).toBe(6);       // 미선언=카탈로그 최대 두께(보수)
    expect(t45.thkMm).toBe(4.5);
    expect(t45.areaMm2).toBeLessThan(t6.areaMm2);
  });

  it('날조 금지: 규격에 없거나 조건 미달이면 중실 유지 + basis 로 드러남', () => {
    // ① 근사 스냅(□145 → 규격 □150, 편차 3.3%) = 모델 형상이 규격과 다르다 → 중실
    const near = partVolumeEffective({ type: 'box', role: 'column', material: 'steel', params: { width: 145, depth: 145, height: 1000 } } as never);
    expect(near.basis).toBe('solid');
    // ② 비정사각 단면(각관 표는 정사각만) → 중실
    expect(partVolumeEffective({ type: 'box', role: 'column', material: 'steel', params: { width: 150, depth: 100, height: 1000 } } as never).basis).toBe('solid');
    // ③ 알루미늄 T슬롯: 카탈로그에 단면적이 없다 → 중실(추정 금지)
    expect(partVolumeEffective({ type: 'box', role: 'column', material: 'aluminum', params: { width: 40, depth: 40, height: 1000 } } as never).basis).toBe('solid');
    // ④ 규격 대조 대상이 아닌 역할(mount 등) → 중실
    expect(partVolumeEffective({ type: 'box', role: 'mount', material: 'steel', params: { width: 150, depth: 150, height: 1000 } } as never).basis).toBe('solid');
  });

  it('structural 과 boq 가 같은 질량을 본다 (한 페이지 자기모순 차단)', () => {
    const silo = buildAssemblyTemplate('mech', 'tank_silo', { diameter: 2743, shellH: 3048, hopper: 'yes', wallThk: 6, legH: 1219 });
    const built = buildAssembly(silo);
    const boq = computeBOQ(silo, { material: 'steel' });
    const legS = built.structural.massBreakdown.find((r: { id: string }) => r.id === 'leg_1');
    const legB = boq.items.find((r: { id: string }) => r.id === 'leg_1');
    expect(legS.basis).toBe('hollow-std');
    expect(legB.basis).toBe('hollow-std');
    expect(Math.abs(legS.exactKg - legB.massKg)).toBeLessThan(0.05);
    expect(legS.exactKg).toBeLessThan(60); // 도그푸딩 268.3 kg 재발 방지
  });
});

describe('F12 — 판재 함체는 셸 체적', () => {
  it('카운터 하부장(2400×700×910 t18): 통짜 765kg → 판재 셸 ~60kg', () => {
    const carcass = { type: 'box', role: 'cabinet', material: 'timber', params: { width: 2400, depth: 700, height: 910 } };
    const solidKg = partVolume('box', carcass.params) * DENSITY.timber / 1e9;
    const eff = partVolumeEffective(carcass as never);
    expect(solidKg).toBeGreaterThan(700);
    expect(eff.basis).toBe('panel-shell');
    const kg = eff.volumeMm3 * DENSITY.timber / 1e9;
    expect(kg).toBeGreaterThan(40);
    expect(kg).toBeLessThan(90);   // 실물 판재 함체(90~140kg, MDF 밀도 기준)의 하한 근방
  });

  it('가구 총 질량이 주거 활하중을 넘기지 않는 범위로 떨어진다', () => {
    const bar = buildAssemblyTemplate('interior', 'counter_bar', {});
    const s = structuralCheck(bar, { defaultMaterial: 'timber' });
    expect(s.totalMassKg).toBeLessThan(300);  // 종전 963.9 kg
    // 바닥 점유면적 ≈ 2.48×0.97 m → 200 kg/m² 미만(주거 활하중 180~300 kg/m² 대역 이내)
    expect(s.totalMassKg / (2.48 * 0.968)).toBeLessThan(200);
  });

  it('걸레받이는 둘레 레일 프레임 · 상판/문짝은 중실 그대로', () => {
    const bar = buildAssemblyTemplate('interior', 'counter_bar', {});
    const s = structuralCheck(bar, { defaultMaterial: 'timber' });
    const by = Object.fromEntries(s.massBreakdown.map((r: { id: string; basis?: string }) => [r.id, r])) as Record<string, { basis?: string }>;
    expect(by.plinth.basis).toBe('panel-frame');
    expect(by.carcass.basis).toBe('panel-shell');
    expect(by.countertop.basis).toBe('solid');  // 상판은 실제로 통짜 슬래브
    expect(by.door_1.basis).toBe('solid');      // 문짝은 이미 t18 판 그 자체
  });

  it('셸 판별은 role 선언에만 의존 — 미선언 box 는 중실(오판단 금지)', () => {
    expect(partVolumeEffective({ type: 'box', material: 'timber', params: { width: 2400, depth: 700, height: 910 } } as never).basis).toBe('solid');
  });
});

describe('F6 — 회전체 이음은 원주', () => {
  it('사일로 동체-지붕 이음: AABB 4D(10,972) 가 아니라 πD(8,617)', () => {
    const silo = buildAssemblyTemplate('mech', 'tank_silo', { diameter: 2743, shellH: 3048, hopper: 'yes', wallThk: 6, legH: 1219 });
    const built = buildAssembly(silo);
    const w = built.welds.find((x: { a: string; b: string }) => x.a === 'shell' && x.b === 'roof');
    expect(w.lengthMm).toBe(Math.round(Math.PI * 2743));
    expect(w.note).toContain('원주 이음');
    // 종전값(사각 둘레) 대비 −21.4% = 과대 +27.3% 의 역
    expect(w.lengthMm / (2 * (2743 + 2743))).toBeCloseTo(Math.PI / 4, 3);
  });

  it('사각 부재 이음은 종전대로 사각 둘레(과잉 일반화 금지)', () => {
    const asm = {
      name: 'plate+box', parts: [
        { id: 'plate', type: 'plate_with_holes', material: 'steel', params: { width: 400, depth: 300, thickness: 10, holes: [] }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'blk', type: 'box', material: 'steel', params: { width: 200, depth: 100, height: 50 }, at: { tx: 0, ty: 0, tz: 10 } },
      ],
    };
    const w = buildAssembly(asm).welds[0];
    expect(w.lengthMm).toBe(2 * (200 + 100));
    expect(w.note).toContain('AABB 접촉');
  });
});

describe('F13 — 보정 잔차가 부재 행에 보이지 않는다', () => {
  it('동일 서까래는 전부 동일 표시 질량 · 합계는 여전히 정합', () => {
    const pergola = buildAssemblyTemplate('landscape', 'pergola', {});
    const s = structuralCheck(pergola, { defaultMaterial: 'timber' });
    const rafters = s.massBreakdown.filter((r: { id: string }) => /^rafter\d+$/.test(r.id));
    expect(rafters.length).toBeGreaterThan(2);
    expect(new Set(rafters.map((r: { massKg: number }) => r.massKg)).size).toBe(1);
    expect(s.massSumCheck).toBe(true);
    const sum = +s.massBreakdown.reduce((a: number, r: { massKg: number }) => a + r.massKg, 0).toFixed(1);
    expect(sum).toBe(s.totalMassKg);
    // 참값은 숨기지 않는다 — 표시 총계와 참값 총계의 표류는 0.05kg×부재수 이내
    expect(Math.abs(s.totalMassKg - s.totalExactKg)).toBeLessThan(0.05 * s.massBreakdown.length + 1e-6);
  });
});
