/**
 * K7 완주 기준 검증 — 브라우저 replicad 경로 하네스에서 A안(생성-이력 이름)
 * 이중화의 스파이크 시나리오 재현(실 WASM):
 *   1. extrude 가 이름표를 실제 B-rep 에지와 일치하는 앵커로 생산한다
 *   2. 치수 변경 리빌드 후에도 같은 이름이 이동한 에지를 따라가고,
 *      resolveEdgeRefDual 이 A안으로 matched 를 돌려준다
 *   3. 위상 변경(정점 소거)으로 이름이 소멸하면 name_gone 명시 상실 —
 *      추측 적용이 아니라 재선택 요구
 *   4. 체인 불리언(fuse) 승계: 호스트 이름 통과 + 툴 이름 피처ID 한정,
 *      승계 앵커가 결과 B-rep 의 실제 에지 중점과 일치
 *
 * Skipped when RUN_OCCT_FEASIBILITY=0 (sibling과 동일 관례).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  ensureOcctReady,
  resetShapeRegistry,
  occtExtrudeProfile,
  occtTopoNames,
  occtTopoAnchor,
  occtTopoNameAtClick,
  occtEdgeSignatures,
  composeTopoNamesAfterBoolean,
  getShape,
  registerShape,
} from '../features/occtEngine';
import { resolveEdgeRefDual } from '../features/topologyEdgeFinder';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

const RECT = [
  { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 },
];

function selAt(
  position: [number, number, number],
  direction: [number, number, number],
  length: number,
  topoName: string,
): EdgeSelectionInfo {
  return { type: 'edge', position, direction, length, normal: [1, 0, 0], topoName };
}

describeMaybe('K7 — 브라우저 경로 A안 이름 실증(WASM)', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 120_000);

  it('extrude 이름표의 앵커가 실제 B-rep 에지 중점과 일치하고, 클릭 명명이 동작한다', () => {
    resetShapeRegistry();
    const { handle } = occtExtrudeProfile(RECT, 10);
    expect(handle).toBeTruthy();
    const names = occtTopoNames(handle)!;
    expect(names.size).toBeGreaterThan(0);
    // e.vert.1 = 프로파일 정점 (40,0)의 수직 에지 → 중점 (40,0,5)
    expect(names.get('e.vert.1')).toEqual({ x: 40, y: 0, z: 5 });
    // 앵커가 커널이 보는 실제 에지와 일치(1e-2mm)
    const sigs = occtEdgeSignatures(handle);
    for (const [, m] of names) {
      const hit = sigs.some(sg =>
        Math.hypot(sg.mid[0] - m.x, sg.mid[1] - m.y, sg.mid[2] - m.z) <= 1e-2);
      expect(hit).toBe(true);
    }
    // 중점에서 벗어난 클릭(z=8)도 선분 거리로 명명된다
    expect(occtTopoNameAtClick(handle, { x: 40, y: 0, z: 8 }, [0, 0, 1])).toBe('e.vert.1');
  });

  it('치수 변경 리빌드: 같은 이름이 이동한 에지를 따라가고 A안이 matched 를 준다', async () => {
    resetShapeRegistry();
    // 원본에서 e.vert.1 을 클릭했다고 저장(중점 40,0,5) → depth 10→14 리빌드
    const rebuilt = occtExtrudeProfile(RECT, 14);
    const moved = occtTopoAnchor(rebuilt.handle, 'e.vert.1');
    expect(moved).toEqual({ x: 40, y: 0, z: 7 }); // 이름은 그대로, 앵커는 이동
    const stored = selAt([40, 0, 5], [0, 0, 1], 10, 'e.vert.1'); // 낡은 클릭 좌표
    const res = await resolveEdgeRefDual(stored, rebuilt.handle!, undefined, 'test');
    expect(res.status).toBe('matched');
  });

  it('위상 변경으로 이름이 소멸하면 name_gone 명시 상실 — 추측 적용 금지', async () => {
    resetShapeRegistry();
    // 사각 → 삼각: 정점 3(0,20)이 사라져 e.vert.3 이 존재하지 않는 위상
    const tri = occtExtrudeProfile(RECT.slice(0, 3), 10);
    expect(occtTopoNames(tri.handle)?.has('e.vert.3')).toBe(false);
    const stored = selAt([0, 20, 5], [0, 0, 1], 10, 'e.vert.3');
    const res = await resolveEdgeRefDual(stored, tri.handle!, undefined, 'test');
    expect(res.status).toBe('lost');
    expect(res.status === 'lost' && res.reason).toBe('name_gone');
  });

  it('체인 fuse 승계: 호스트 무접두 통과 + 툴 f2/ 한정, 앵커가 결과 에지와 실일치', () => {
    resetShapeRegistry();
    const host = occtExtrudeProfile(RECT, 10);
    // 겹치지 않는 이웃 블록(멀티바디 fuse) — 생존 에지가 명확
    const TOOL = [
      { x: 60, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 20 }, { x: 60, y: 20 },
    ];
    const tool = occtExtrudeProfile(TOOL, 10);
    const h = getShape(host.handle) as { fuse: (o: unknown) => unknown };
    const fused = registerShape(h.fuse(getShape(tool.handle)));
    composeTopoNamesAfterBoolean(fused, [
      { handle: host.handle },
      { handle: tool.handle, featureId: 'f2' },
    ], 'f2');
    const names = occtTopoNames(fused)!;
    expect(names.get('e.vert.1')).toEqual({ x: 40, y: 0, z: 5 });      // 호스트 통과
    expect(names.get('f2/e.vert.0')).toEqual({ x: 60, y: 0, z: 5 });   // 툴 한정
    // 승계된 모든 앵커는 결과 B-rep 의 실제 에지 중점
    const sigs = occtEdgeSignatures(fused);
    for (const [, m] of names) {
      const hit = sigs.some(sg =>
        Math.hypot(sg.mid[0] - m.x, sg.mid[1] - m.y, sg.mid[2] - m.z) <= 1e-2);
      expect(hit).toBe(true);
    }
  });
});
