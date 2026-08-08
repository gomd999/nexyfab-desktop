// @vitest-environment node
/**
 * F-0(260808f) — trackGeometry 의 BVH 자동 빌드는 빈 지오메트리를 건너뛴다.
 *
 * 브라우저 실측 결함의 회귀 고정: 앱은 three-setup.ts 로
 * BufferGeometry.prototype.computeBoundsTree 를 설치한다. 실측상 BVH 는
 * position 속성이 아예 없으면 던진다(TypeError reading 'count') — 'none'
 * 베이스리스의 edgeGeometry(맨 BufferGeometry — EdgesGeometry 인스턴스가
 * 아니라 BVH 분기에 들어옴)가 그 경우였고, 예외가 generate() 캐치에서 조용히
 * null 로 강등돼 lastGood 폴백이 직전 형상(기본 박스)을 화면에 남겼다.
 * 노드 기본 환경은 확장이 없어 이 경로를 못 밟는다 — 여기서 명시 설치해 재현한다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { trackGeometry } from './useGeometryGC';

describe('trackGeometry — empty geometry vs BVH auto-build (F-0)', () => {
  it('does not throw on a 0-vertex geometry with the BVH extension installed', () => {
    const proto = THREE.BufferGeometry.prototype as unknown as Record<string, unknown>;
    const prev = { compute: proto.computeBoundsTree, dispose: proto.disposeBoundsTree };
    proto.computeBoundsTree = computeBoundsTree;
    proto.disposeBoundsTree = disposeBoundsTree;
    try {
      const empty = new THREE.BufferGeometry();
      empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      empty.setIndex([]);
      expect(() => trackGeometry(empty)).not.toThrow();
      expect((empty as unknown as { boundsTree?: unknown }).boundsTree ?? null).toBeNull();

      // 정상 지오메트리는 여전히 BVH 를 받는다(가드 과확장 방지).
      const box = new THREE.BoxGeometry(10, 10, 10);
      expect(() => trackGeometry(box)).not.toThrow();
      expect((box as unknown as { boundsTree?: unknown }).boundsTree).toBeTruthy();
    } finally {
      proto.computeBoundsTree = prev.compute;
      proto.disposeBoundsTree = prev.dispose;
    }
  });
});
