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
    // ⚠ 260729c: commercial_massing 을 뺐다 — 계단실·PS 개구와 함께 **입상관(ps_riser)** 을
    //   넣어 관통 검사가 출하 템플릿에서 실제로 돌게 했다(어휘를 만들고 출하 경로가 없으면
    //   실사용에서 뭐가 깨지는지 알 수 없다).
    for (const id of ['rc_frame', 'gable_house']) {
      expect(chk(buildAssemblyTemplate('building', id, {})), id).toBeNull();
    }
  });

  it('★commercial_massing 은 관통이 개구로 덮인다 — 출하 템플릿 실사용', () => {
    const r = chk(buildAssemblyTemplate('building', 'commercial_massing', {}));
    expect(r?.pass).toBe(true);
    expect(r?.labelKo).toContain('관통 3개소');
    // 입상관 시작 z 를 200 으로 뒀다가 기초 슬래브(0~250)를 50mm 파고들어 오탐이 났다 —
    // 검사가 바로 잡았고, 시작 z 를 슬래브 상단으로 고쳤다.
    expect(r?.detail.join(' ')).not.toContain('slab_0');
  });
});

describe('벽 관통 — 슬래브와 좌표 규약이 다르다 (260729c)', () => {
  const DUCT = { id: 'd', role: 'duct', type: 'box', material: 'steel',
    params: { width: 400, depth: 600, height: 400 }, at: { tx: 1000, ty: -200, tz: 2000 } };
  const wA = (parts: unknown[]) => ({ domain: 'building', parts });
  const PLAIN = { id: 'w', role: 'wall', type: 'box', material: 'concrete',
    params: { width: 6000, depth: 200, height: 3000 }, at: { tx: 0, ty: 0, tz: 0 } };
  const wallOpen = (o: Record<string, number>, at: Record<string, number> = { tx: 0, ty: 0, tz: 0 }) => ({
    id: 'w', role: 'wall', type: 'wall_with_openings', material: 'concrete',
    params: { length: 6000, thickness: 200, height: 3000, openings: [o] }, at });

  it('개구 없는 벽을 뚫으면 걸린다', () => {
    const r = chk(wA([PLAIN, DUCT]));
    expect(r?.pass).toBe(false);
    expect(r?.detail.join(' ')).toContain('wall_with_openings');   // 벽 어휘를 안내한다
  });

  it('(x, sill) 로 대조한다 — 슬래브의 (x, y) 를 들이대면 엉뚱한 자리를 본다', () => {
    // 덕트는 x=1000~1400, z=2000~2400 을 지난다. 개구 x=900 w=600 · sill=1900 h=600 이 덮는다.
    expect(chk(wA([wallOpen({ x: 900, w: 600, h: 600, sill: 1900 }), DUCT]))?.pass).toBe(true);
  });

  it('sill 이 어긋나면 걸린다 — 높이를 안 보면 통과해 버린다', () => {
    // x 범위는 같고 sill 만 100 → 개구가 바닥 쪽이라 덕트를 못 덮는다.
    const r = chk(wA([wallOpen({ x: 900, w: 600, h: 600, sill: 100 }), DUCT]));
    expect(r?.pass).toBe(false);
    expect(r?.detail.join(' ')).toContain('덮지 못한다');
  });

  it('개구가 작으면 걸린다', () => {
    expect(chk(wA([wallOpen({ x: 900, w: 200, h: 200, sill: 1900 }), DUCT]))?.pass).toBe(false);
  });

  it('회전 벽(rz=90)도 대조한다 — 개구 x 는 **벽 로컬** 좌표다', () => {
    // rz=90 이면 벽 길이방향이 월드 Y. 개구 x=900 은 월드 y 900 자리를 뜻한다.
    const wall = wallOpen({ x: 900, w: 600, h: 600, sill: 1900 }, { tx: 0, ty: 0, tz: 0, rz: 90 });
    const duct = { ...DUCT, params: { width: 600, depth: 400, height: 400 }, at: { tx: -200, ty: 1000, tz: 2000 } };
    expect(chk(wA([wall, duct]))?.pass).toBe(true);
  });

  it('미선언과 부족을 구별해 적는다 — 조치가 다르다', () => {
    expect(chk(wA([PLAIN, DUCT]))?.detail.join(' ')).toContain('개구가 선언되지 않았다');
    expect(chk(wA([wallOpen({ x: 900, w: 200, h: 200, sill: 1900 }), DUCT]))?.detail.join(' '))
      .toContain('관통 단면을 덮지 못한다');
  });
});

describe('plant_room — 벽 관통이 설계의 본질인 출하 템플릿 (260729c)', () => {
  const asm = () => buildAssemblyTemplate('building', 'plant_room', {});

  it('급기·배기 덕트와 냉수 배관이 벽 3개소를 관통하고 전부 개구가 있다', () => {
    const r = chk(asm());
    expect(r?.labelKo).toContain('관통 3개소');
    expect(r?.pass).toBe(true);
    expect(r?.detail.join(' ')).toContain('개구가 확인된 관통 3개소');
  });

  it('★수평 배관(ry 회전)이 검사에 들어간다 — 종전엔 통째로 빠졌다', () => {
    // `cylinder` 는 길이가 Z축이라 **수평 배관은 반드시 ry 회전**이 붙는다. 직접 짠
    // 축정렬 계산이 rx/ry 를 제외해 실무에서 가장 흔한 벽 관통이 검사 밖에 있었다
    // (실측: 3개소 중 2개소만 잡힘). placedAabb 로 바꿔 전 회전을 다룬다.
    const pipe = (asm() as { parts: { id: string; at: { ry?: number } }[] })
      .parts.find((p) => p.id === 'pipe_chilled');
    expect(pipe?.at.ry).toBe(90);
    const r = chk(asm());
    expect(r?.detail.join(' ')).not.toContain('판정 불가');
  });

  it('개구를 지우면 걸린다 — 검사가 실제로 작동함을 확인', () => {
    const a = asm() as { parts: { id: string; params: Record<string, unknown> }[] };
    const w = a.parts.find((p) => p.id === 'wall_left')!;
    w.params.openings = [];
    const r = chk(a);
    expect(r?.pass).toBe(false);
    expect(r?.detail.join(' ')).toContain('wall_left');
  });

  it('게이트를 통과한다 — 형상이 성립하는 실무 구성', async () => {
    const { buildAssembly } = await import('./assembly.mjs');
    const b = (buildAssembly as unknown as (a: unknown) => { ok: boolean })(asm());
    expect(b.ok).toBe(true);
  });
});
