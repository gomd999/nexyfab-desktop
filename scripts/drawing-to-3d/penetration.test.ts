/**
 * 설비 관통 ↔ 구조 개구 (260729b, 계획 P1-7).
 *
 * 덕트·배관이 슬래브를 지나가면 개구를 뚫어야 한다. 종전에는 그 교차가 **간섭**으로만
 * 나왔고, 간섭은 「부딪히면 안 되는 것이 부딪혔다」로 읽힌다 — 설비 관통은 정상 설계이고
 * 필요한 것은 개구 선언이다. 둘을 구별하지 않으면 정상 설계가 오류로 읽히거나(과탐)
 * 개구 누락이 간섭 목록에 묻힌다(누락). 현장에서 개구 누락은 곧 재시공이다.
 */
import { describe, it, expect } from 'vitest';
import { penetrationCheck } from './penetration-check.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';

type R = { pass: boolean | null; labelKo: string; detail: string[] } | null;
const chk = (a: unknown) => (penetrationCheck as unknown as (x: unknown) => R)(a);

const DUCT = { id: 'duct_v', role: 'duct', type: 'box', material: 'steel',
  params: { width: 400, depth: 400, height: 1200 }, at: { tx: 1000, ty: 1000, tz: 2500 } };
const asm = (slab: Record<string, unknown>) => ({ domain: 'building', parts: [slab, DUCT] });
const PLAIN = { id: 'slab', role: 'slab', type: 'box', material: 'concrete',
  params: { width: 6000, depth: 4000, height: 200 }, at: { tx: 0, ty: 0, tz: 3000 } };
const opened = (o: Record<string, number>) => ({ id: 'slab', role: 'slab', type: 'slab_with_openings',
  material: 'concrete', params: { length: 6000, depth: 4000, thickness: 200, openings: [o] },
  at: { tx: 0, ty: 0, tz: 3000 } });

describe('관통 검출', () => {
  it('개구 없는 슬래브를 뚫으면 걸린다', () => {
    const r = chk(asm(PLAIN));
    expect(r?.pass).toBe(false);
    expect(r?.detail.join(' ')).toContain('개구가 선언되지 않았다');
    expect(r?.detail.join(' ')).toContain('400×400×200mm');   // 겹침 실측을 적는다
  });

  it('개구가 관통 단면을 덮으면 통과', () => {
    expect(chk(asm(opened({ x: 900, y: 900, w: 600, d: 600 })))?.pass).toBe(true);
  });

  it('★개구를 선언해도 검사가 꺼지지 않는다 — 어휘별 필드명이 다르다', () => {
    // `slab_with_openings` 는 length/depth/thickness 라 width/depth/height 로 읽으면
    // AABB 가 null 이 되어 **개구를 선언할수록 검사가 사라졌다**(실측). 고치라고 안내한
    // 바로 그 행동이 검사를 끄는 최악의 형태다 — partAabb 로 전 어휘를 읽는다.
    const r = chk(asm(opened({ x: 900, y: 900, w: 600, d: 600 })));
    expect(r?.labelKo).toContain('관통 1개소');     // 관통을 여전히 본다
    expect(r?.pass).not.toBeNull();
  });

  it('개구가 작아 단면을 못 덮으면 걸린다 — 부분 겹침은 덮은 것이 아니다', () => {
    const r = chk(asm(opened({ x: 1100, y: 1100, w: 200, d: 200 })));
    expect(r?.pass).toBe(false);
    expect(r?.detail.join(' ')).toContain('관통 단면을 덮지 못한다');
  });

  it('겹치지 않으면 관통이 아니다 — 천장 아래 덕트는 해당 없음', () => {
    const r = chk(asm({ ...PLAIN, at: { tx: 0, ty: 0, tz: 4000 } }));
    expect(r?.pass).toBeNull();
    expect(r?.detail.join(' ')).toContain('관통이 없다');
  });

  it('설비나 구조가 없으면 null — 해당 없음이지 통과가 아니다', () => {
    expect(chk({ domain: 'building', parts: [PLAIN] })).toBeNull();
    expect(chk({ domain: 'building', parts: [DUCT] })).toBeNull();
  });

  it('근사임을 밝힌다 — AABB 겹침이지 실형상 부울이 아니다', () => {
    expect(chk(asm(PLAIN))?.detail.join(' ')).toContain('AABB 겹침');
  });
});

describe('출하 템플릿', () => {
  it('duct_run 은 덕트가 천장 아래라 관통이 없다 — 오탐 0', () => {
    const r = chk(buildAssemblyTemplate('building', 'duct_run', {}));
    expect(r?.pass).toBeNull();
    expect(r?.detail.join(' ')).toContain('겹치지 않는다');
  });

  it('설비가 없는 건축 템플릿은 null', () => {
    for (const id of ['rc_frame', 'commercial_massing', 'gable_house']) {
      expect(chk(buildAssemblyTemplate('building', id, {})), id).toBeNull();
    }
  });
});
