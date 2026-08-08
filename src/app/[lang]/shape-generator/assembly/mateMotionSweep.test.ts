// @vitest-environment node
/**
 * F-5(260808g) — 힌지 스윕 인증 브리지: 뷰포트 메이트 → Pro 솔버(runMotionSweep)
 * → 프레임별 BVH 충돌(기준자세 접촉 차등).
 *   · 장애물 없는 힌지 → pass(전 수렴·신규 충돌 없음)
 *   · 회전 경로 위 장애물 → collision + 각도 창 실측
 *   · 축 없음/지오메트리 없음 → not_run(fail-closed)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { sweepHingeMateClearance } from './mateMotionSweep';
import type { AssemblyState, Mate, MateSelection } from './matesSolver';

beforeAll(() => {
  const proto = THREE.BufferGeometry.prototype as unknown as Record<string, unknown>;
  proto.computeBoundsTree = computeBoundsTree;
  proto.disposeBoundsTree = disposeBoundsTree;
});

const sel = (bodyIndex: number, point: [number, number, number], axis: [number, number, number]): MateSelection => ({
  bodyIndex,
  type: 'axis',
  localPoint: new THREE.Vector3(...point),
  localNormal: new THREE.Vector3(...axis),
  localAxis: new THREE.Vector3(...axis),
});

const hinge = (id: string, a: MateSelection, b: MateSelection): Mate => ({
  id, type: 'hinge', selections: [a, b], enabled: true,
});

/** 접지판(±50×±50×z±2) + 팔(x 5..45, y ±4, z 2..10 — 원점 z축 힌지로 회전). */
function armAssembly(withObstacle: boolean): AssemblyState {
  const ground = new THREE.BoxGeometry(100, 100, 4);
  const arm = new THREE.BoxGeometry(40, 8, 8);
  arm.translate(25, 0, 6); // 팔은 +x 로 뻗음, 판 위(z 2..10)
  const bodies = [
    { name: 'ground', position: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(0, 0, 0), fixed: true, geometry: ground },
    { name: 'arm', position: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(0, 0, 0), fixed: false, geometry: arm },
  ];
  if (withObstacle) {
    // 장애물: +y 축상(팔이 +90° 부근을 지날 때 충돌), 판 위 z 2..12.
    const post = new THREE.BoxGeometry(8, 8, 10);
    post.translate(0, 30, 7);
    bodies.push({ name: 'post', position: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(0, 0, 0), fixed: true, geometry: post });
  }
  const mates = [hinge('m1', sel(0, [0, 0, 2], [0, 0, 1]), sel(1, [0, 0, 2], [0, 0, 1]))];
  return { bodies, mates } as unknown as AssemblyState;
}

describe('sweepHingeMateClearance (F-5)', () => {
  it('free hinge sweep 0..180° → pass, all frames converged, no new collision', () => {
    const cert = sweepHingeMateClearance(armAssembly(false), 'm1', { steps: 18 });
    expect(cert.status).toBe('pass');
    expect(cert.frames).toBe(19);
    expect(cert.convergedFrames).toBe(19);
    expect(cert.firstCollision).toBeNull();
  });

  it('obstacle in the swing path → collision reported inside the expected angle window', () => {
    const cert = sweepHingeMateClearance(armAssembly(true), 'm1', { steps: 36 });
    expect(cert.status).toBe('collision');
    expect(cert.firstCollision).not.toBeNull();
    const hit = Math.abs(cert.firstCollision!.angleDeg);
    // 팔(반폭 4)+장애물(반폭 4)이 반경 30 에서 만나는 창 — 90° 부근.
    expect(hit).toBeGreaterThan(45);
    expect(hit).toBeLessThan(135);
    expect(cert.firstCollision!.pair.sort()).toEqual(['arm', 'post']);
  });

  it('baseline contact (pin-in-boss style overlap at frame 0) is NOT a collision', () => {
    const state = armAssembly(false);
    // 팔 루트가 접지판과 프레임 0 부터 살짝 겹치게(z 1.5..9.5) — 기준자세 접촉.
    (state.bodies[1].geometry as THREE.BufferGeometry).translate(0, 0, -0.75);
    const cert = sweepHingeMateClearance(state, 'm1', { steps: 12 });
    expect(cert.status).toBe('pass');
    expect(cert.baselineContacts.map(p => p.sort().join('-'))).toContain('arm-ground');
  });

  it('missing axis → not_run (never fabricates a sweep)', () => {
    const state = armAssembly(false);
    const bare = { ...state.mates[0], selections: [
      { ...state.mates[0].selections[0], localAxis: undefined, localNormal: new THREE.Vector3(0, 0, 0) },
      state.mates[0].selections[1],
    ] } as Mate;
    const cert = sweepHingeMateClearance({ ...state, mates: [bare] } as AssemblyState, 'm1');
    expect(cert.status).toBe('not_run');
  });
});
