// @vitest-environment node
/**
 * F-6(260808g) — 멀티바디 어셈블리 핸드오프: drawing-to-3d 어셈블리 JSON →
 * 모델러 PlacedPart 시드. 좌표 사상은 실측 규약을 고정한다:
 *   어셈블리(Z-up): box=모서리 원점(partAabb [0,0,0]..[w,d,h]) ·
 *   cylinder/tube=축 +z 밑면 z=0 x/y 중심 · at.tx/ty/tz=이동
 *   모델러(Y-up): position=파트 중심, (x,y,z)→(x,z,y)
 */
import { describe, expect, it } from 'vitest';
import { assemblyToPartsProgram } from './chatCadHandoff';

const box = (w: number, d: number, h: number, at = {}) =>
  ({ id: 'base', type: 'box', params: { width: w, depth: d, height: h }, at });
const cyl = (dia: number, len: number, at = {}) =>
  ({ id: 'post', type: 'cylinder', params: { diameter: dia, length: len }, at });
const tube = (oD: number, iD: number, len: number, at = {}) =>
  ({ id: 'sleeve', type: 'tube', params: { outerDia: oD, innerDia: iD, length: len }, at });

describe('assemblyToPartsProgram (F-6)', () => {
  it('maps box/cylinder/tube with measured corner→center + Z-up→Y-up math', () => {
    const program = assemblyToPartsProgram({
      name: 'stand',
      parts: [
        box(100, 60, 8, { tx: -50, ty: -30, tz: 0 }),   // 중심 (0,0,4) Z-up
        cyl(20, 50, { tx: 30, ty: 10, tz: 8 }),          // 밑면 z=8 → 중심 z=33
        tube(60, 50, 200, { tx: 0, ty: 0, tz: 8 }),
      ],
    });
    expect(program).not.toBeNull();
    const parts = program!.assemblyParts!;
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({
      shapeId: 'box', params: { width: 100, height: 8, depth: 60 },
      position: [0, 4, 0], name: 'base',
    });
    expect(parts[1]).toMatchObject({
      shapeId: 'cylinder', params: { diameter: 20, height: 50 },
      position: [30, 33, 10], // (tx, tz+len/2, ty)
    });
    expect(parts[2]).toMatchObject({
      shapeId: 'pipe', params: { outerDiameter: 60, innerDiameter: 50, length: 200 },
      position: [0, 108, 0],
    });
    expect(program!.features).toEqual([]);
  });

  it('rejects: rotation(사상 미실측), 어휘 밖 타입, 파트 <2 — 부분 약속 금지', () => {
    expect(assemblyToPartsProgram({ parts: [box(10, 10, 10), cyl(5, 20, { rz: 90 })] })).toBeNull();
    expect(assemblyToPartsProgram({ parts: [box(10, 10, 10), { type: 'i_girder', params: {}, at: {} }] })).toBeNull();
    expect(assemblyToPartsProgram({ parts: [box(10, 10, 10)] })).toBeNull();
    expect(assemblyToPartsProgram(undefined)).toBeNull();
  });

  it('rejects oversize dims that the modeler shape sliders would silently clamp', () => {
    expect(assemblyToPartsProgram({ parts: [box(600, 10, 10), cyl(5, 20)] })).toBeNull(); // box>500
    expect(assemblyToPartsProgram({ parts: [box(10, 10, 10), cyl(5, 600)] })).toBeNull(); // cyl h>500
    expect(assemblyToPartsProgram({ parts: [box(10, 10, 10), tube(60, 70, 100)] })).toBeNull(); // iD≥oD
  });
});
