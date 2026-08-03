/**
 * auto-fix.test.ts — **오분류는 에러가 아니라 결과로 끝난다** (260803).
 *
 * 게이트가 옳게 막아도 사용자가 원한 것은 3D 였다. 어휘 오분류는 **판단이 아니라 규칙**이라
 * LLM 왕복 없이 고쳐진다 — 이 회귀는 그 규칙이 **정확히 거기까지만** 하는지를 고정한다.
 *
 * ⚠ 가장 중요한 검사는 「고친다」가 아니라 **「안 고친다」**이다:
 *   입력 누락을 추측으로 메우면 그게 날조다.
 */

import { describe, expect, it } from 'vitest';
import { autoFixAssembly, autoFixPart, correctionsSummary, resolveAssembly } from './auto-fix.mjs';
import { gate } from './reconstruct.mjs';

type Part = { id: string; type: string; params: Record<string, unknown> };
const g = (p: Part): string[] =>
  (gate as unknown as (i: Record<string, unknown>) => string[])({ type: p.type, ...p.params });
const fixPart = autoFixPart as unknown as (p: Part) => { part: Part; correction: unknown };
const fixAsm = autoFixAssembly as unknown as (a: { parts: Part[] })
  => { assembly: { parts: Part[] }; corrections: Array<Record<string, string>> };

// 라이브 입력 그대로 (노트북 거치대 스펙)
const WASHER_AS_FLANGE: Part = { id: 'friction_washer_1', type: 'flange', params: { outerDia: 18, boreDia: 8, thickness: 1 } };
const VENT_AS_HOLE: Part = {
  id: 'laptop_plate', type: 'plate_with_holes',
  params: { width: 280, depth: 240, thickness: 4, holes: [{ x: 140, y: 120, w: 180, h: 130 }] },
};

describe('고친다 — 규칙이 명확한 오분류', () => {
  it('★볼트원 없는 flange → washer, 그리고 게이트를 실제로 통과한다', () => {
    expect(g(WASHER_AS_FLANGE).length).toBeGreaterThan(0);
    const { part, correction } = fixPart(WASHER_AS_FLANGE);
    expect(part.type).toBe('washer');
    expect(correction).toBeTruthy();
    expect(g(part)).toEqual([]);
  });

  it('치수를 그대로 옮긴다 — 값을 바꾸지 않는다', () => {
    const { part } = fixPart(WASHER_AS_FLANGE);
    expect(part.params).toEqual({ outerDia: 18, boreDia: 8, thickness: 1 });
  });

  it('★사각 개구 holes → slab_with_openings, 그리고 게이트를 통과한다', () => {
    expect(g(VENT_AS_HOLE).length).toBeGreaterThan(0);
    const { part } = fixPart(VENT_AS_HOLE);
    expect(part.type).toBe('slab_with_openings');
    expect(g(part)).toEqual([]);
  });

  it('좌표계를 환산한다 — holes 는 중심, openings 는 좌하단 모서리', () => {
    const { part } = fixPart(VENT_AS_HOLE);
    const op = (part.params.openings as Array<Record<string, number>>)[0];
    // 중심 (140,120), 크기 180×130 → 모서리 (50,55)
    expect(op).toEqual({ x: 50, y: 55, w: 180, d: 130 });
    expect(op.x + op.w).toBeLessThanOrEqual(280);
    expect(op.y + op.d).toBeLessThanOrEqual(240);
  });
});

describe('★안 고친다 — 여기가 더 중요하다', () => {
  it('진짜 flange 는 건드리지 않는다', () => {
    const p: Part = { id: 'f', type: 'flange', params: { outerDia: 150, boreDia: 50, thickness: 12, bcd: 100, boltHoleD: 14, boltCount: 4 } };
    const { part, correction } = fixPart(p);
    expect(correction).toBeNull();
    expect(part).toBe(p);
  });

  it('볼트원이 **일부만** 있으면 입력 누락 — 지어내지 않고 에러로 남긴다', () => {
    const p: Part = { id: 'f', type: 'flange', params: { outerDia: 150, boreDia: 50, thickness: 12, bcd: 100 } };
    const { part, correction } = fixPart(p);
    expect(correction).toBeNull();
    expect(part.type).toBe('flange');
    expect(g(part).length).toBeGreaterThan(0);
  });

  it('원형과 사각 구멍이 섞이면 한 어휘로 못 담는다 — 건드리지 않는다', () => {
    const p: Part = {
      id: 'p', type: 'plate_with_holes',
      params: { width: 280, depth: 240, thickness: 4, holes: [{ x: 20, y: 20, d: 5.5 }, { x: 140, y: 120, w: 180, h: 130 }] },
    };
    expect(fixPart(p).correction).toBeNull();
  });

  it('수리가 나아지게 하지 못하면 적용하지 않는다 — 판 밖으로 나가는 개구', () => {
    const p: Part = {
      id: 'p', type: 'plate_with_holes',
      params: { width: 100, depth: 100, thickness: 4, holes: [{ x: 10, y: 10, w: 180, h: 130 }] },
    };
    const { part } = fixPart(p);
    // 환산해도 개구가 판을 벗어나 게이트가 여전히 실패 → 원본 유지
    expect(part.type).toBe('plate_with_holes');
  });

  it('정상 원형 구멍 판은 건드리지 않는다', () => {
    const p: Part = {
      id: 'p', type: 'plate_with_holes',
      params: { width: 280, depth: 240, thickness: 4, holes: [{ x: 20, y: 20, d: 5.5 }] },
    };
    expect(fixPart(p).correction).toBeNull();
  });
});

describe('어셈블리 단위 — 보고와 불변성', () => {
  it('원본을 변형하지 않는다', () => {
    const asm = { parts: [{ ...WASHER_AS_FLANGE }] };
    fixAsm(asm);
    expect(asm.parts[0].type).toBe('flange');
  });

  it('교정 0건이면 입력 객체를 그대로 돌려준다 — 호출부가 값싸게 분기한다', () => {
    const asm = { parts: [{ id: 'b', type: 'box', params: { width: 10, depth: 10, height: 10 } }] };
    expect(fixAsm(asm).assembly).toBe(asm);
  });

  it('★모든 교정이 보고된다 — 조용한 수정을 만들지 않는다', () => {
    const { corrections } = fixAsm({ parts: [WASHER_AS_FLANGE, VENT_AS_HOLE] });
    expect(corrections).toHaveLength(2);
    for (const c of corrections) {
      expect(c.partId).toBeTruthy();
      expect(c.from).toBeTruthy();
      expect(c.to).toBeTruthy();
      expect(c.note).toBeTruthy();
    }
    // 좌표계 환산은 가정이므로 반드시 고지된다
    expect(corrections.find((c) => c.to === 'slab_with_openings')?.assumed).toBeTruthy();
    expect(correctionsSummary(corrections as never)).toContain('flange → washer');
  });

  it('라이브 실패 어셈블리가 게이트 에러 0 으로 끝난다', () => {
    const { assembly } = fixAsm({ parts: [WASHER_AS_FLANGE, VENT_AS_HOLE] });
    expect(assembly.parts.flatMap(g)).toEqual([]);
  });
});

describe('★부분 산출 — 한 부품이 망가져도 나머지로 결과를 낸다', () => {
  // 실측: 종전에는 이 어셈블리가 parts:0 · openscad:false 로 통째로 버려졌다.
  const IRREPARABLE = { id: 'BROKEN', type: 'flange', params: { outerDia: 150, boreDia: 50, thickness: 12, bcd: 100 } };
  const asm = () => ({
    parts: [
      { id: 'base', type: 'box', params: { width: 260, depth: 220, height: 6 } },
      { id: 'post', type: 'box', params: { width: 50, depth: 25, height: 160 } },
      { ...IRREPARABLE },
    ] as Part[],
  });
  const resolve = resolveAssembly as unknown as (a: unknown, o?: { drop?: boolean })
    => { assembly: { parts: Part[] }; dropped: Array<Record<string, unknown>>; allFailed: boolean };

  it('drop:true 면 멀쩡한 부품이 살아남는다', () => {
    const r = resolve(asm(), { drop: true });
    expect(r.assembly.parts).toHaveLength(2);
    expect(r.assembly.parts.flatMap(g)).toEqual([]);
    expect(r.allFailed).toBe(false);
  });

  it('★드롭은 기본이 아니다 — 먼저 LLM 수리에 기회를 준다', () => {
    const r = resolve(asm()); // drop 미지정
    expect(r.dropped).toEqual([]);
    expect(r.assembly.parts).toHaveLength(3);
  });

  it('무엇이 왜 빠졌는지 + **되살릴 원본 파라미터**를 보고한다', () => {
    const [d] = resolve(asm(), { drop: true }).dropped;
    expect(d.partId).toBe('BROKEN');
    expect(d.type).toBe('flange');
    expect((d.errors as string[]).length).toBeGreaterThan(0);
    // 사용자가 값을 채워 다시 넣을 수 있어야 한다 — 원본이 유실되면 되살릴 방법이 없다
    expect(d.params).toEqual(IRREPARABLE.params);
  });

  it('전부 실패해도 원본을 돌려준다 — 사유를 보고할 수 있어야 한다', () => {
    const r = resolve({ parts: [{ ...IRREPARABLE }] }, { drop: true });
    expect(r.allFailed).toBe(true);
    expect(r.assembly.parts).toHaveLength(1);
    expect(r.dropped).toHaveLength(1);
  });

  it('멀쩡한 어셈블리는 드롭이 켜져 있어도 손대지 않는다', () => {
    const ok = { parts: [{ id: 'b', type: 'box', params: { width: 10, depth: 10, height: 10 } }] as Part[] };
    const r = resolve(ok, { drop: true });
    expect(r.dropped).toEqual([]);
    expect(r.assembly).toBe(ok);
  });
});
