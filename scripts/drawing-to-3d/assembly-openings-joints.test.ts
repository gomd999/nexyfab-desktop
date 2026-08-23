/**
 * Boolean 개구부와 명시적 접합 그래프의 fail-closed 회귀.
 * AABB가 겹친다고 모두 면제하지 않고, 설계 의도가 형상으로 입증된 쌍만 접촉으로 낮춘다.
 */
import { describe, expect, it } from 'vitest';
import { buildAssembly } from './assembly.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';

type Built = {
  designOk: boolean;
  interferences: Array<{ a: string; b: string }>;
  contacts: Array<{ a: string; b: string; note: string }>;
  collisionAudit: { declarationErrors: Array<{ code: string; a: string; b: string }>; validatedExemptions: Array<{ a: string; b: string; note: string }> };
};

describe('선언 개구 관통', () => {
  it.each([
    ['building', 'plant_room'],
    ['building', 'commercial_massing'],
  ])('%s/%s: 개구 단면 내부 관통은 접촉이고 간섭이 아니다', (domain, template) => {
    const asm = buildAssemblyTemplate(domain, template, {});
    const b = buildAssembly(asm) as Built;
    expect(b.designOk).toBe(true);
    expect(b.interferences).toHaveLength(0);
    expect(b.contacts.some((c) => /선언 개구 관통/.test(c.note))).toBe(true);
  });

  it('개구보다 큰 관통체는 면제하지 않는다', () => {
    const b = buildAssembly({ parts: [
      {
        id: 'wall', type: 'wall_with_openings', role: 'wall',
        params: { length: 1000, thickness: 200, height: 1000, openings: [{ x: 450, w: 100, sill: 450, h: 100 }] },
        at: { tx: 0, ty: 0, tz: 0 },
      },
      {
        id: 'oversized-duct', type: 'box',
        params: { width: 200, depth: 400, height: 200 },
        at: { tx: 400, ty: -100, tz: 400 },
      },
    ] }) as Built;
    expect(b.designOk).toBe(false);
    expect(b.interferences).toHaveLength(1);
  });
});

describe('명시적 접합 그래프', () => {
  const parts = [
    { id: 'a', type: 'box', params: { width: 100, depth: 100, height: 100 }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'b', type: 'box', params: { width: 100, depth: 100, height: 100 }, at: { tx: 97.5, ty: 0, tz: 0 } },
  ];

  it('이름으로 선언한 특정 쌍만 접합으로 분류한다', () => {
    const b = buildAssembly({ jointGraphProvenance: 'deterministic-template-v1', parts: [
      { ...parts[0], connectedWith: ['b'] },
      parts[1],
    ] }) as Built;
    expect(b.designOk).toBe(true);
    expect(b.interferences).toHaveLength(0);
    expect(b.collisionAudit.declarationErrors).toHaveLength(0);
    expect(b.collisionAudit.validatedExemptions).toContainEqual(expect.objectContaining({ a: 'a', b: 'b', note: expect.stringMatching(/검증된 얕은 설계 접합/) }));
  });

  it('같은 겹침이어도 접합 선언이 없으면 간섭으로 차단한다', () => {
    const b = buildAssembly({ parts }) as Built;
    expect(b.designOk).toBe(false);
    expect(b.interferences).toHaveLength(1);
    expect(b.contacts).toHaveLength(0);
  });

  it('신뢰 출처 없이 connectedWith만 써 넣어도 간섭을 면제하지 않는다', () => {
    const b = buildAssembly({ parts: [
      { ...parts[0], connectedWith: ['b'] },
      parts[1],
    ] }) as Built;
    expect(b.designOk).toBe(false);
    expect(b.interferences).toHaveLength(1);
  });

  it('신뢰 템플릿이어도 깊은 관통은 선언으로 숨기지 않는다', () => {
    const b = buildAssembly({ jointGraphProvenance: 'deterministic-template-v1', parts: [
      { ...parts[0], connectedWith: ['b'] },
      { ...parts[1], at: { tx: 50, ty: 0, tz: 0 } },
    ] }) as Built;
    expect(b.designOk).toBe(false);
    expect(b.interferences).toHaveLength(1);
    expect(b.collisionAudit.declarationErrors).toContainEqual(expect.objectContaining({ code: 'DECLARED_JOINT_GEOMETRY_MISMATCH', a: 'a', b: 'b' }));
  });
});

describe('연속 부재 인접성', () => {
  const segment = (id: string, order: number, tx: number, start: number, end: number) => ({
    id, type: 'box', continuousWith: 'run-1', continuousSegment: { order, start: [start, 0, 0], end: [end, 0, 0], startAxis: [1, 0, 0], endAxis: [1, 0, 0] },
    params: { width: 100, depth: 20, height: 20 }, at: { tx, ty: 0, tz: 0 },
  });

  it('순번과 끝점과 축이 맞는 바로 이웃 구간만 면제한다', () => {
    const b = buildAssembly({ parts: [segment('s0', 0, 0, 0, 100), segment('s1', 1, 97.5, 100, 200)] }) as Built;
    expect(b.designOk).toBe(true);
    expect(b.collisionAudit.validatedExemptions[0]?.note).toMatch(/연속 부재 인접구간 검증/);
  });

  it('같은 continuousWith 문자열이어도 비인접 구간은 차단한다', () => {
    const b = buildAssembly({ parts: [segment('s0', 0, 0, 0, 100), segment('s2', 2, 97.5, 200, 300)] }) as Built;
    expect(b.designOk).toBe(false);
    expect(b.interferences).toHaveLength(1);
    expect(b.collisionAudit.declarationErrors).toContainEqual(expect.objectContaining({ code: 'CONTINUOUS_SEGMENT_GEOMETRY_MISMATCH' }));
  });
});
