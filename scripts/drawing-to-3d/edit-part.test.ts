import { describe, it, expect } from 'vitest';
import { applyPartPatch, faceOfPart } from './edit-part.mjs';

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

  it('faceOfPart — box 6면·회전체 축단/원통면 명명', () => {
    expect(faceOfPart(asm.parts[0], [0, 0, 1])?.face).toBe('z+');
    expect(faceOfPart(asm.parts[0], [-1, 0, 0])?.face).toBe('x-');
    expect(faceOfPart(asm.parts[1], [1, 0, 0])?.face).toBe('axis+'); // ry:90 → 축=x
    expect(faceOfPart(asm.parts[1], [0, 0, -1])?.face).toBe('radial');
    // 회전 box = v1 미지원(정직 null)
    expect(faceOfPart({ type: 'box', at: { rz: 45 }, params: {} }, [1, 0, 0])).toBeNull();
  });
});
