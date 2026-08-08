/**
 * K7-S3 — 브라우저 replicad 경로의 생성-이력(System A) 이름 이중화.
 *
 * WASM 없이 검증한다: occtEdgeSignatures 는 등록 형상의 `.edges`(start/endPoint)만
 * 읽으므로 가짜 B-rep 으로 레지스트리·불리언 승계 합성·클릭 명명·명시 상실
 * 계약을 정확히 태울 수 있다. 핵심 계약:
 *   - setTopoNames/occtTopoAnchor/reset — 핸들별 이름표 수명주기
 *   - composeTopoNamesAfterBoolean — 중점 일치 승계, featureId 한정, 심 미저장
 *   - occtTopoNameAtClick — 중점이 아닌 클릭점도 선분 거리로 에지를 찾아 명명
 *   - fillet buildBestEdgeFinder — 이름표 실재+이름 소멸 = 'name_gone' 명시 상실,
 *     이름표 부재 = 기존 B안 경로(상실 아님)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  registerShape,
  resetShapeRegistry,
  setTopoNames,
  occtTopoNames,
  occtTopoAnchor,
  occtNearestTopoName,
  occtTopoNameAtClick,
  composeTopoNamesAfterBoolean,
} from './occtEngine';
import { buildBestEdgeFinder } from './fillet';
import { resolveEdgeRefDual } from './topologyEdgeFinder';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

/** 가짜 B-rep: occtEdgeSignatures 가 읽는 최소 표면(.edges) */
function fakeSolid(edges: Array<[[number, number, number], [number, number, number]]>): unknown {
  return {
    edges: edges.map(([a, b]) => ({
      startPoint: { x: a[0], y: a[1], z: a[2] },
      endPoint: { x: b[0], y: b[1], z: b[2] },
    })),
  };
}

const v = (x: number, y: number, z: number) => ({ x, y, z });

beforeEach(() => resetShapeRegistry());

describe('topo name registry (K7-S3)', () => {
  it('stores, resolves, and clears per-handle name tables', () => {
    const h = registerShape(fakeSolid([]));
    setTopoNames(h, new Map([['e.vert.0', v(0, 0, 5)]]));
    expect(occtTopoNames(h)?.size).toBe(1);
    expect(occtTopoAnchor(h, 'e.vert.0')).toEqual(v(0, 0, 5));
    expect(occtTopoAnchor(h, 'e.vert.9')).toBeNull();
    resetShapeRegistry();
    expect(occtTopoNames(h)).toBeNull();
  });

  it('occtNearestTopoName respects the tolerance radius', () => {
    const h = registerShape(fakeSolid([]));
    setTopoNames(h, new Map([['e.top.0-1', v(20, 10, 10)]]));
    expect(occtNearestTopoName(h, v(20.4, 10, 10))).toBe('e.top.0-1');
    expect(occtNearestTopoName(h, v(25, 10, 10))).toBeNull();
  });
});

describe('composeTopoNamesAfterBoolean (K7-S3)', () => {
  it('inherits surviving names by midpoint coincidence, qualifying the tool by featureId', () => {
    const host = registerShape(fakeSolid([]));
    const tool = registerShape(fakeSolid([]));
    setTopoNames(host, new Map([['e.vert.0', v(0, 0, 5)]]));
    setTopoNames(tool, new Map([['e.vert.0', v(40, 0, 5)]]));
    const result = registerShape(fakeSolid([
      [[0, 0, 0], [0, 0, 10]],     // 호스트 e.vert.0 생존(중점 0,0,5)
      [[40, 0, 0], [40, 0, 10]],   // 툴 e.vert.0 생존(중점 40,0,5)
      [[100, 100, 0], [100, 100, 10]], // 어느 쪽 이름과도 불일치 → 무명
    ]));
    composeTopoNamesAfterBoolean(result, [
      { handle: host },
      { handle: tool, featureId: 'f7' },
    ], 'f7');
    const names = occtTopoNames(result)!;
    expect(names.get('e.vert.0')).toEqual(v(0, 0, 5));       // 호스트: 무접두 통과
    expect(names.get('f7/e.vert.0')).toEqual(v(40, 0, 5));   // 툴: 피처ID 한정
    expect(names.size).toBe(2); // seam.k(위치 서수)는 저장되지 않는다
  });

  it('does nothing when no operand carries a name table', () => {
    const host = registerShape(fakeSolid([]));
    const result = registerShape(fakeSolid([[[0, 0, 0], [0, 0, 10]]]));
    composeTopoNamesAfterBoolean(result, [{ handle: host }], 'f1');
    expect(occtTopoNames(result)).toBeNull();
  });
});

describe('occtTopoNameAtClick (K7-S3)', () => {
  it('names an off-midpoint click via point-to-segment distance', () => {
    const h = registerShape(fakeSolid([
      [[0, 0, 0], [0, 0, 10]],
      [[40, 0, 0], [40, 0, 10]],
    ]));
    setTopoNames(h, new Map([
      ['e.vert.0', v(0, 0, 5)],
      ['e.vert.1', v(40, 0, 5)],
    ]));
    // 클릭점 z=8(중점 z=5에서 3mm 벗어남) — 중점 거리로는 실패, 선분 거리로 성공
    expect(occtTopoNameAtClick(h, v(0.5, 0, 8), [0, 0, 1])).toBe('e.vert.0');
    // 방향 필터: 수직 에지에 수평 방향 클릭은 배제
    expect(occtTopoNameAtClick(h, v(0.5, 0, 8), [1, 0, 0])).toBeNull();
    // 어느 에지에서도 먼 점
    expect(occtTopoNameAtClick(h, v(20, 20, 5), [0, 0, 1])).toBeNull();
  });

  it('returns null for a handle without a name table', () => {
    const h = registerShape(fakeSolid([[[0, 0, 0], [0, 0, 10]]]));
    expect(occtTopoNameAtClick(h, v(0, 0, 5), [0, 0, 1])).toBeNull();
  });
});

describe('fillet A-first resolution (K7-S3)', () => {
  function geoWithHandle(handle: string): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.userData = { occtHandle: handle };
    return g;
  }
  const sel = (topoName?: string): EdgeSelectionInfo => ({
    type: 'edge',
    position: [0, 0, 5],
    length: 10,
    normal: [1, 0, 0],
    direction: [0, 0, 1],
    ...(topoName ? { topoName } : {}),
  });

  it("stored name gone from a live name table → explicit 'name_gone' loss, never a guess", async () => {
    const h = registerShape(fakeSolid([[[0, 0, 0], [0, 0, 10]]]));
    setTopoNames(h, new Map([['e.vert.1', v(40, 0, 5)]])); // 이름표 실재, 저장 이름은 소멸
    const out = await buildBestEdgeFinder(
      { featureId: 'fx', edgeSelections: [sel('e.vert.0')] } as never,
      geoWithHandle(h),
    );
    expect(out.finder).toBeNull();
    expect(out.lost?.status).toBe('lost');
    expect(out.lost?.reason).toBe('name_gone');
  });

  it('handle without a name table falls through to the legacy path (no loss verdict)', async () => {
    const h = registerShape(fakeSolid([[[0, 0, 0], [0, 0, 10]]]));
    const out = await buildBestEdgeFinder(
      { featureId: 'fx', edgeSelections: [sel('e.vert.0')] } as never,
      geoWithHandle(h),
    );
    // 이름표가 없으면 A안은 판정하지 않는다 — B안/클릭 경로 소관(여기선 replicad
    // 미가용이라 finder 도 null이지만, '상실' 단정은 없어야 한다).
    expect(out.lost).toBeUndefined();
  });
});

describe('resolveEdgeRefDual — K7-S4 공용 이중화 해석', () => {
  const sel = (topoName?: string): EdgeSelectionInfo => ({
    type: 'edge',
    position: [0, 0, 5],
    length: 10,
    normal: [1, 0, 0],
    direction: [0, 0, 1],
    ...(topoName ? { topoName } : {}),
  });

  it("name table alive but stored name gone → 'name_gone' loss (chamfer 등 전 소비처 공통)", async () => {
    const h = registerShape(fakeSolid([[[0, 0, 0], [0, 0, 10]]]));
    setTopoNames(h, new Map([['e.vert.9', v(99, 99, 5)]]));
    const res = await resolveEdgeRefDual(sel('e.vert.0'), h, undefined, 'chamfer');
    expect(res.status).toBe('lost');
    expect(res.status === 'lost' && res.reason).toBe('name_gone');
  });

  it('no name table → plain B-path verdict, never a loss minted by A', async () => {
    const h = registerShape(fakeSolid([[[0, 0, 0], [0, 0, 10]]]));
    const res = await resolveEdgeRefDual(sel('e.vert.0'), h, undefined);
    expect(res.status).toBe('unavailable'); // replicad 미가용 환경의 B안 판정
  });

  it('name present but anchor matches no current edge → falls through to B, no name_gone', async () => {
    const h = registerShape(fakeSolid([[[0, 0, 0], [0, 0, 10]]]));
    setTopoNames(h, new Map([['e.vert.0', v(77, 77, 5)]])); // 앵커가 현재 에지와 불일치
    const res = await resolveEdgeRefDual(sel('e.vert.0'), h, undefined);
    expect(res.status).toBe('unavailable'); // 단정 없이 B안 소관
  });
});
