import { describe, it, expect } from 'vitest';
import { applyPartPatch, faceOfPart, faceDragPatch, faceDimOf, partOps } from './edit-part.mjs';
import { bladeRingMesh } from './gen-macros.mjs';

const asm = {
  name: 't', domain: 'mech',
  parts: [
    { id: 'bed', type: 'box', params: { width: 1000, depth: 800, height: 80 }, at: { tx: 0, ty: 0, tz: 0 }, role: 'frame', material: 'steel' },
    { id: 'noz', type: 'pipe_reducer', params: { dia1: 480, dia2: 260, length: 250, wallThk: 6 }, at: { tx: 300, ty: 400, tz: 500, ry: 90 }, role: 'mount', material: 'steel' },
  ],
};

describe('edit-part 결정론 계층', () => {
  it('params 부분 패치 → 재빌드 통과, 대상 외 부품 불변', () => {
    const r = applyPartPatch(asm, 'noz', { params: { dia2: 300 } }) as {
      ok: boolean; assembly: { parts: Array<{ id: string; params: Record<string, number> }> };
    };
    expect(r.ok).toBe(true);
    expect(r.assembly.parts[1].params.dia2).toBe(300);
    expect(r.assembly.parts[1].params.dia1).toBe(480); // 병합 — 나머지 유지
    expect(r.assembly.parts[0]).toEqual(asm.parts[0]); // 대상 외 불변
    expect((asm.parts[1].params as { dia2: number }).dia2).toBe(260); // 원본 불변
  });

  it('미지원 type·허용 외 필드·없는 부품 = 정직 거부', () => {
    expect((applyPartPatch(asm, 'noz', { type: 'warp_drive' }) as { ok: boolean }).ok).toBe(false);
    expect((applyPartPatch(asm, 'noz', { id: 'x' } as never) as { ok: boolean }).ok).toBe(false);
    expect((applyPartPatch(asm, 'ghost', {}) as { ok: boolean }).ok).toBe(false);
  });

  it('게이트 실패 패치는 오류 보고(어휘 검증 작동)', () => {
    const r = applyPartPatch(asm, 'noz', { params: { dia2: -5 } }) as { ok: boolean; gateErrors?: string[] };
    expect(r.ok).toBe(false);
    expect((r.gateErrors ?? []).length).toBeGreaterThan(0);
  });

  it('faceDragPatch — 면 푸시풀 결정론 매핑(파라메트릭 "면 드래그" 대응)', () => {
    // box z+ 면 +50 = 높이 증가만
    expect((faceDragPatch(asm.parts[0], 'z+', 50) as { patch: unknown }).patch).toEqual({ params: { height: 130 } });
    // box x- 면 +40 = 폭 증가 + 최소코너 −40 이동(면이 바깥으로)
    expect((faceDragPatch(asm.parts[0], 'x-', 40) as { patch: unknown }).patch).toEqual({ params: { width: 1040 }, at: { tx: -40 } });
    // 수평 리듀서 axis- = 길이 증가 + 시작 이동
    expect((faceDragPatch(asm.parts[1], 'axis-', 30) as { patch: unknown }).patch).toEqual({ params: { length: 280 }, at: { tx: 270 } });
    // tube radial = 외경 +2δ
    const tb = { type: 'tube', params: { outerDia: 200, innerDia: 100, length: 300 }, at: { tx: 0, ty: 0, tz: 0 } };
    expect((faceDragPatch(tb, 'radial', 10) as { patch: unknown }).patch).toEqual({ params: { outerDia: 220 } });
    // 정직 거부: 리듀서 radial(모호)·mesh(재생성 경로)·0 이하 치수
    expect((faceDragPatch(asm.parts[1], 'radial', 10) as { ok: boolean }).ok).toBe(false);
    expect((faceDragPatch({ type: 'mesh', params: {}, at: {} }, 'radial', 5) as { ok: boolean }).ok).toBe(false);
    expect((faceDragPatch(asm.parts[0], 'z+', -100) as { ok: boolean }).ok).toBe(false);
  });

  it('gen 재생성 — 블레이드 링 nB 패치가 결정론 재생성(정점 직접 수정 없음)', () => {
    const ringP = bladeRingMesh({ nB: 6, rRoot: 60, rTip: 120, chord: 30, cx: 100, cy: 0, cz: 0, pitch: 400 });
    const asm2 = {
      name: 'g', domain: 'mech',
      parts: [
        { id: 'base', type: 'box', params: { width: 400, depth: 400, height: 40 }, at: { tx: -200, ty: -200, tz: -300 }, role: 'frame', material: 'steel' },
        { id: 'ring', type: 'mesh', params: ringP, gen: { kind: 'blade_ring', params: { nB: 6, rRoot: 60, rTip: 120, chord: 30, cx: 100, cy: 0, cz: 0, pitch: 400 } }, at: { tx: 0, ty: 0, tz: 0 }, role: 'mount', material: 'steel' },
      ],
    };
    const r = applyPartPatch(asm2, 'ring', { gen: { params: { nB: 10 } } }) as {
      ok: boolean; part: { params: { triCount: number }; gen: { params: { nB: number; chord: number } } };
    };
    expect(r.ok).toBe(true);
    expect(r.part.gen.params.nB).toBe(10);
    expect(r.part.gen.params.chord).toBe(30); // 나머지 파라미터 유지(병합)
    expect(r.part.params.triCount).toBeGreaterThan(ringP.triCount); // 6→10익 재생성
    // 미등록 kind = 정직 거부
    expect((applyPartPatch(asm2, 'ring', { gen: { kind: 'nurbs_magic', params: {} } }) as { ok: boolean }).ok).toBe(false);
  });

  it('#3 회전 box — 로컬 면 명명 + 푸시풀 at 이동이 월드 방향(rz=90 벽)', () => {
    // 벽: 로컬 x=길이 3000, rz=90 → 로컬 +x 가 월드 +y
    const wall = { id: 'w', type: 'box', params: { width: 3000, depth: 200, height: 2500 }, at: { tx: 1000, ty: 0, tz: 0, rz: 90 } };
    // 월드 +y 노멀 = 로컬 +x 면
    expect(faceOfPart(wall, [0, 1, 0])?.face).toBe('x+');
    // 월드 −x 노멀 = 로컬 +y 면(rz90: 로컬 y→월드 −x)
    expect(faceOfPart(wall, [-1, 0, 0])?.face).toBe('y+');
    // 로컬 x− 면(월드 −y) 확장 50: width+50, at 는 월드 y 로 −50 (로컬 x 의 월드 방향=+y)
    const r = faceDragPatch(wall, 'x-', 50) as { ok: boolean; patch: { params: Record<string, number>; at: Record<string, number> } };
    expect(r.ok).toBe(true);
    expect(r.patch.params.width).toBe(3050);
    expect(Math.round(r.patch.at.ty)).toBe(-50);
    expect(r.patch.at.tx).toBeUndefined(); // rz90 에서 로컬 x 는 월드 x 성분 0
  });

  it('#2 faceDimOf — 면 → 현재 치수(치수 직접 입력)', () => {
    expect(faceDimOf(asm.parts[0], 'z+')).toEqual({ param: 'height', value: 80 });
    expect(faceDimOf(asm.parts[1], 'axis+')).toEqual({ param: 'length', value: 250 });
    expect(faceDimOf(asm.parts[1], 'radial')).toBeNull(); // 리듀서 반경=모호(정직)
  });

  it('#5/#7 partOps — 복제/삭제/이동/필렛 결정론 + 게이트', () => {
    const dup = partOps(asm, 'duplicate', ['noz'], { offset: [500, 0, 0] }) as { ok: boolean; assembly: { parts: Array<{ id: string; at: { tx: number } }> } };
    expect(dup.ok).toBe(true);
    expect(dup.assembly.parts.some((p) => p.id === 'noz_copy' && p.at.tx === 800)).toBe(true);
    const del = partOps(asm, 'delete', ['noz']) as { ok: boolean; assembly: { parts: unknown[] } };
    expect(del.ok).toBe(true);
    expect(del.assembly.parts.length).toBe(1);
    const mv = partOps(asm, 'translate', ['noz'], { dz: 100 }) as { ok: boolean; assembly: { parts: Array<{ id: string; at: { tz: number } }> } };
    expect(mv.ok).toBe(true);
    expect(mv.assembly.parts[1].at.tz).toBe(600);
    const fl = partOps(asm, 'fillet', ['noz'], { r: 5 }) as { ok: boolean; assembly: { parts: Array<{ id: string; filletMm?: number }> }; note: string };
    expect(fl.ok).toBe(true);
    expect(fl.assembly.parts[1].filletMm).toBe(5);
    expect(fl.note).toContain('STEP');
    expect((partOps(asm, 'delete', ['ghost']) as { ok: boolean }).ok).toBe(false);
    expect((partOps(asm, 'fillet', ['noz'], { r: 999 }) as { ok: boolean }).ok).toBe(false);
  });

  it('faceOfPart — box 6면·회전체 축단/원통면 명명', () => {
    expect(faceOfPart(asm.parts[0], [0, 0, 1])?.face).toBe('z+');
    expect(faceOfPart(asm.parts[0], [-1, 0, 0])?.face).toBe('x-');
    expect(faceOfPart(asm.parts[1], [1, 0, 0])?.face).toBe('axis+'); // ry:90 → 축=x
    expect(faceOfPart(asm.parts[1], [0, 0, -1])?.face).toBe('radial');
    // 회전 box = v1 미지원(정직 null)
    expect(faceOfPart({ type: 'box', at: { rz: 45 }, params: {} }, [1, 0, 0])).toBeNull();
  });
});
