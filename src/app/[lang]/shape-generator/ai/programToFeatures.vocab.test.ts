/**
 * G-0(260808g) — 어휘 마감 스윕: rib/shell 시드 매핑 + 원판 보스.
 * skipped 로 조용히 빠지던 마지막 어휘를 모델러 기존 피처로 사상한다.
 *   · rib: 선분 기반(startX/Z→endX/Z), direction 0=부품 바닥 기준 상향
 *     (SCAD 방출 translate z=0 anchor BOTTOM 과 동일 의미), 프로그램 (x,y)→
 *     모델러 (x,z) 사상은 hole 과 동일
 *   · shell: openFace 'bottom'→2, 그 외→1(상면)
 *   · boss: circle(원판→cylinder) 베이스도 상면 y=+h/2 프레임으로 안착
 */
import { describe, expect, it, vi } from 'vitest';
import { reconstructFeatureTree } from './programToFeatures';

function fakeApi() {
  return {
    setBaseShape: vi.fn(),
    addSketchFeature: vi.fn(),
    addFeatureWithParams: vi.fn(),
  };
}

const plate = { id: 'f1', type: 'sketchExtrude', shape: 'rect' as const, width: 100, depth: 60, height: 8 };

describe('reconstructFeatureTree — G-0 vocabulary sweep', () => {
  it('rib along X: line segment centred at (posX, posY→Z), bottom-up', () => {
    const api = fakeApi();
    const r = reconstructFeatureTree(
      { features: [plate, { id: 'r1', type: 'rib', width: 6, height: 30, length: 80, posX: 0, posY: 10 }] },
      api as never,
    );
    expect(r.skipped).toEqual([]);
    expect(api.addFeatureWithParams).toHaveBeenCalledWith('rib', {
      startX: -40, startZ: 10, endX: 40, endZ: 10, thickness: 6, height: 30, direction: 0,
    });
  });

  it('rib along Y: segment runs along modeler Z at x=posX', () => {
    const api = fakeApi();
    const r = reconstructFeatureTree(
      { features: [plate, { id: 'r1', type: 'rib', width: 5, height: 20, length: 50, posX: -15, posY: 0, alongY: true }] },
      api as never,
    );
    expect(r.skipped).toEqual([]);
    expect(api.addFeatureWithParams).toHaveBeenCalledWith('rib', {
      startX: -15, startZ: -25, endX: -15, endZ: 25, thickness: 5, height: 20, direction: 0,
    });
  });

  it('shell: wallThickness carried, openFace bottom→2 / default→1(top)', () => {
    const api = fakeApi();
    const r = reconstructFeatureTree(
      { features: [plate, { id: 's1', type: 'shell', wallThickness: 2.5, openFace: 'bottom' }] },
      api as never,
    );
    expect(r.skipped).toEqual([]);
    expect(api.addFeatureWithParams).toHaveBeenCalledWith('shell', { wallThickness: 2.5, openFace: 2 });

    const api2 = fakeApi();
    reconstructFeatureTree(
      { features: [plate, { id: 's1', type: 'shell', wallThickness: 3 }] },
      api2 as never,
    );
    expect(api2.addFeatureWithParams).toHaveBeenCalledWith('shell', { wallThickness: 3, openFace: 1 });
  });

  it('boss on a circle (disc) base seeds the same top-face frame at y=h/2', () => {
    const api = fakeApi();
    const r = reconstructFeatureTree(
      {
        features: [
          { id: 'f1', type: 'sketchExtrude', shape: 'circle', width: 80, height: 10 },
          { id: 'b1', type: 'boss', diameter: 20, height: 15, posX: 0, posY: 0 },
        ],
      },
      api as never,
    );
    expect(r.skipped).toEqual([]);
    expect(api.setBaseShape).toHaveBeenCalledWith('cylinder', { diameter: 80, height: 10 });
    const call = api.addSketchFeature.mock.calls[0]!;
    expect(call[7]).toMatchObject({ origin: [0, 5, 0], normal: [0, 1, 0] });
  });

  it('assemblyParts program seeds the assembly and bypasses the feature-tree path', () => {
    const api = { ...fakeApi(), setAssemblyParts: vi.fn() };
    const parts: Array<{ shapeId: string; params: Record<string, number>; position: [number, number, number]; rotation: [number, number, number] }> = [
      { shapeId: 'box', params: { width: 10, height: 10, depth: 10 }, position: [0, 5, 0], rotation: [0, 0, 0] },
      { shapeId: 'cylinder', params: { diameter: 5, height: 20 }, position: [0, 20, 0], rotation: [0, 0, 0] },
    ];
    const r = reconstructFeatureTree({ features: [], assemblyParts: parts }, api as never);
    expect(r).toEqual({ ok: true, skipped: [] });
    expect(api.setAssemblyParts).toHaveBeenCalledWith(parts);
    expect(api.setBaseShape).not.toHaveBeenCalled();
    expect(api.addSketchFeature).not.toHaveBeenCalled();
  });

  it('assemblyParts without a wired setAssemblyParts fails honestly (no silent drop)', () => {
    const api = fakeApi();
    const r = reconstructFeatureTree(
      { features: [], assemblyParts: [{ shapeId: 'box', params: {}, position: [0, 0, 0], rotation: [0, 0, 0] }] },
      api as never,
    );
    expect(r).toEqual({ ok: false, skipped: ['assembly'] });
  });

  it('boss on a polyline base stays honestly skipped (top face is not y=h/2)', () => {
    const api = fakeApi();
    const r = reconstructFeatureTree(
      {
        features: [
          { id: 'f1', type: 'sketchExtrude', profile: [[0, 0], [40, 0], [40, 40], [0, 40]], height: 10 },
          { id: 'b1', type: 'boss', diameter: 10, height: 5, posX: 20, posY: 20 },
        ],
      },
      api as never,
    );
    expect(r.skipped).toEqual(['boss']);
  });
});
