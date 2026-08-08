// @vitest-environment node
/**
 * F-0/F-1(260808f) — 파이프라인 커널 계약 테스트(메시 경로):
 *   · F-0 베이스리스: 빈 업스트림('none' 베이스)에서 첫 sketchExtrude 가
 *     병합 없이 그대로 첫 바디가 된다 — mergeGeometries 가 빈 지오메트리에서
 *     null 을 돌려주고 직전 형상이 화면에 남던 실측 결함의 고정.
 *   · F-1 면 스케치 압출: faceFrame 압출은 면에서 법선 한쪽(0..depth)이다 —
 *     중심대칭(±d/2) 메시 압출이 보스를 절반만 올리던 실측 결함(11.5≠19)의 고정.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyFeaturePipelineDetailed } from './index';
import type { FeatureInstance } from './types';
import type { SketchProfile, SketchConfig } from '../sketch/types';

function emptyBaseGeo(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  geometry.setIndex([]);
  return geometry;
}

const linesProfile = (pts: [number, number][]): SketchProfile => ({
  closed: true,
  segments: pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { type: 'line', points: [{ x: p[0], y: p[1] }, { x: q[0], y: q[1] }] };
  }),
} as SketchProfile);

const circleProfile = (cx: number, cy: number, r: number): SketchProfile => ({
  closed: true,
  segments: [{ type: 'circle', points: [{ x: cx, y: cy }, { x: cx + r, y: cy }] }],
} as SketchProfile);

function sketchFeat(
  profile: SketchProfile,
  config: SketchConfig,
  extra: Partial<NonNullable<FeatureInstance['sketchData']>> = {},
): FeatureInstance {
  return {
    id: 'f1', type: 'sketchExtrude', params: {}, enabled: true,
    sketchData: { profile, config, plane: 'xy', planeOffset: 0, operation: 'add', ...extra },
  } as FeatureInstance;
}

const bbox = (geo: THREE.BufferGeometry) => {
  geo.computeBoundingBox();
  return geo.boundingBox!;
};

describe('F-0 — baseless first sketch on empty upstream', () => {
  it('L-profile polyline becomes the first body (no merge failure, no remnant)', () => {
    const profile = linesProfile([[0, 0], [80, 0], [80, 8], [8, 8], [8, 60], [0, 60]]);
    const res = applyFeaturePipelineDetailed(
      emptyBaseGeo(),
      [sketchFeat(profile, { mode: 'extrude', depth: 40 } as SketchConfig)],
    );
    expect(res.errors).toEqual({});
    const bb = bbox(res.geometry);
    // 스케치 (x,y) → 월드 (x,y), z 는 중심대칭 압출(±20) — 프로브 실측 사상.
    expect(bb.min.x).toBeCloseTo(0, 3);
    expect(bb.max.x).toBeCloseTo(80, 3);
    expect(bb.min.y).toBeCloseTo(0, 3);
    expect(bb.max.y).toBeCloseTo(60, 3);
    expect(bb.max.z - bb.min.z).toBeCloseTo(40, 3);
  });

  it('subtract on empty upstream stays an honest error (no fabricated body)', () => {
    const profile = linesProfile([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const res = applyFeaturePipelineDetailed(
      emptyBaseGeo(),
      [sketchFeat(profile, { mode: 'extrude', depth: 5 } as SketchConfig, { operation: 'subtract' })],
    );
    expect(Object.keys(res.errors)).toContain('f1');
  });
});

describe('F-1 — face-frame sketch extrudes one-sided off the face', () => {
  it('boss on a plate top face raises the top by the FULL boss height', () => {
    // 판 100×8×60(y=두께, ±4) + 상면(y=+4) 프레임 보스 Ø20 h15 → y-max 19.
    const plate = new THREE.BoxGeometry(100, 8, 60).toNonIndexed();
    const res = applyFeaturePipelineDetailed(plate, [
      sketchFeat(circleProfile(-20, 0, 10), { mode: 'extrude', depth: 15 } as SketchConfig, {
        faceFrame: { origin: [0, 4, 0], normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1] },
      }),
    ]);
    expect(res.errors).toEqual({});
    const bb = bbox(res.geometry);
    expect(bb.max.y).toBeCloseTo(19, 3);   // 4 + 15 (절반 11.5 가 아니라)
    expect(bb.min.y).toBeCloseTo(-4, 3);   // 판 아래로 관통하지 않음
  });
});
