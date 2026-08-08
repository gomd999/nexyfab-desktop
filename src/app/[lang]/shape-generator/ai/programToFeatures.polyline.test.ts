/**
 * P-1b(260808b) — 폴리라인 프로파일 시드: 프리미티브 베이스 대신 진짜 스케치
 * 피처(addSketchFeature)로 들어가고, 점 좌표는 intent 폴리곤 공간 그대로
 * (중심화 없음 — SCAD/STEP 경로와 좌표 정합)여야 한다.
 */
import { describe, expect, it, vi } from 'vitest';
import { reconstructFeatureTree } from './programToFeatures';

const L = [[0, 0], [80, 0], [80, 8], [8, 8], [8, 60], [0, 60]] as [number, number][];

function fakeApi() {
  return {
    setBaseShape: vi.fn(),
    addSketchFeature: vi.fn(),
    addFeatureWithParams: vi.fn(),
  };
}

describe('reconstructFeatureTree — polyline base (P-1b)', () => {
  it('seeds a closed line-segment sketch, not a primitive, with verbatim coordinates', () => {
    const api = fakeApi();
    const r = reconstructFeatureTree(
      { part: 'L', features: [{ id: 'f1', type: 'sketchExtrude', profile: L, height: 40 }] },
      api as never,
    );
    expect(r.ok).toBe(true);
    expect(api.setBaseShape).not.toHaveBeenCalled();
    expect(api.addSketchFeature).toHaveBeenCalledTimes(1);
    const [profile, config, plane, operation] = api.addSketchFeature.mock.calls[0]!;
    expect(plane).toBe('xy');
    expect(operation).toBe('add');
    expect(config.depth).toBe(40);
    expect(profile.closed).toBe(true);
    expect(profile.segments).toHaveLength(6);
    // 좌표 원문 유지 + 폐루프(마지막 세그먼트가 시작점으로 복귀)
    expect(profile.segments[0].points[0]).toMatchObject({ x: 0, y: 0 });
    expect(profile.segments[1].points[0]).toMatchObject({ x: 80, y: 0 });
    expect(profile.segments[5].points[1]).toMatchObject({ x: 0, y: 0 });
  });

  it('rect base still uses the primitive path (no regression)', () => {
    const api = fakeApi();
    const r = reconstructFeatureTree(
      { part: 'p', features: [{ id: 'f1', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 60, height: 8 }] },
      api as never,
    );
    expect(r.ok).toBe(true);
    expect(api.setBaseShape).toHaveBeenCalledWith('box', { width: 100, height: 8, depth: 60 });
    expect(api.addSketchFeature).not.toHaveBeenCalled();
  });
});
