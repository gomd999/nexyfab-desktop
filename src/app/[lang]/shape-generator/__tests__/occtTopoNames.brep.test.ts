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
  occtBoxBooleanWithPrimitive,
  occtBooleanSolids,
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
    // e.vert.1 = 프로파일 정점 (40,0)의 수직 에지 → 중점 (40,0,0)
    // (260808g 중심대칭 정렬 — 측면 에지 z ±d/2, 중점은 스케치 평면)
    expect(names.get('e.vert.1')).toEqual({ x: 40, y: 0, z: 0 });
    // 앵커가 커널이 보는 실제 에지와 일치(1e-2mm)
    const sigs = occtEdgeSignatures(handle);
    for (const [, m] of names) {
      const hit = sigs.some(sg =>
        Math.hypot(sg.mid[0] - m.x, sg.mid[1] - m.y, sg.mid[2] - m.z) <= 1e-2);
      expect(hit).toBe(true);
    }
    // 중점에서 벗어난 클릭(z=3 — 에지 스팬 ±5 안)도 선분 거리로 명명된다
    expect(occtTopoNameAtClick(handle, { x: 40, y: 0, z: 3 }, [0, 0, 1])).toBe('e.vert.1');
  });

  it('치수 변경 리빌드: 같은 이름이 이동한 에지를 따라가고 A안이 matched 를 준다', async () => {
    resetShapeRegistry();
    // 원본에서 e.vert.1 을 클릭했다고 저장(중점 40,0,5) → depth 10→14 리빌드
    const rebuilt = occtExtrudeProfile(RECT, 14);
    const moved = occtTopoAnchor(rebuilt.handle, 'e.vert.1');
    // 중심대칭 정렬 후 측면 에지 중점은 깊이와 무관하게 스케치 평면(z=0) —
    // 이 테스트의 실신호는 아래 A안 matched(낡은 클릭 좌표의 재해결)다.
    expect(moved).toEqual({ x: 40, y: 0, z: 0 });
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
    expect(names.get('e.vert.1')).toEqual({ x: 40, y: 0, z: 0 });      // 호스트 통과
    expect(names.get('f2/e.vert.0')).toEqual({ x: 60, y: 0, z: 0 });   // 툴 한정
    // 승계된 모든 앵커는 결과 B-rep 의 실제 에지 중점
    const sigs = occtEdgeSignatures(fused);
    for (const [, m] of names) {
      const hit = sigs.some(sg =>
        Math.hypot(sg.mid[0] - m.x, sg.mid[1] - m.y, sg.mid[2] - m.z) <= 1e-2);
      expect(hit).toBe(true);
    }
  });
});

describeMaybe('K7 확대 — 프리미티브/솔리드 불리언 이름 승계(WASM)', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 120_000);

  it('중앙 관통구멍 절삭 후에도 외곽 에지 이름이 전부 생존한다(hole 경로)', async () => {
    resetShapeRegistry();
    const base = occtExtrudeProfile(RECT, 10);
    const before = occtTopoNames(base.handle)!.size;
    const res = occtBoxBooleanWithPrimitive(
      'subtract',
      { w: 40, h: 20, d: 10, cx: 20, cy: 10, cz: 5 },
      { shape: 'cylinder', w: 6, h: 30, d: 6, cx: 20, cy: 10, cz: 5, rx: 90, ry: 0, rz: 0 },
      undefined,
      base.handle,
    );
    expect(res.handle).toBeTruthy();
    const names = occtTopoNames(res.handle)!;
    // 중앙 z축 관통(수직 원통)은 캡 면만 뚫는다 → 외곽 12 에지 전부 생존
    expect(names.size).toBe(before);
    expect(names.get('e.vert.1')).toEqual({ x: 40, y: 0, z: 0 });
    // 승계 앵커 전수 실재 + 리빌드 저장 이름이 새 핸들에서 A안 matched
    const stored = selAt([40, 0, 5], [0, 0, 1], 10, 'e.vert.1');
    const r = await resolveEdgeRefDual(stored, res.handle!, undefined, 'test');
    expect(r.status).toBe('matched');
  });

  it('솔리드-솔리드 union: 무한정 동명 이름은 양쪽 다 명시 거부된다(ambiguous)', () => {
    resetShapeRegistry();
    const a = occtExtrudeProfile(RECT, 10);
    const B = [
      { x: 60, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 60, y: 20 },
    ];
    const b = occtExtrudeProfile(B, 10);
    const res = occtBooleanSolids('union', a.handle, b.handle);
    // 두 이름표가 전 이름을 동명(무접두)으로 주장 → 전부 명시 거부되어 빈
    // 이름표가 되고, 빈 이름표는 저장하지 않는다(무표=B안 경로, null이 정직).
    expect(occtTopoNames(res.handle)).toBeNull();
  });
});
