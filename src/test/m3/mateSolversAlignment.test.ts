/**
 * M3: 동일 coincident/distance 메이트에 대해 남은 3개(#1~#3) 솔버 구현이 같은 방향(접근)으로
 * 움직이는지 느슨하게 검증(드리프트 감지 — 한 곳 수정이 다른 곳에 전파 안 되는 다중구현
 * 부채의 근본 해결은 아니지만, 서로 어긋나는 걸 잡아낸다). 각 솔버는 데이터모델이 달라
 * (면 인덱스 vs named-selection vs analytical-ref) 정확히 같은 스펙을 줄 수 없으므로,
 * 각 솔버의 API로 "같은 물리적 시나리오"(10mm 정육면체 2개, 원점 정렬)를 표현해
 * 방향/대략적 크기만 비교한다(느슨한 허용 오차 — 자세한 근거는 각 it() 내 주석).
 *
 * #1 src/lib/assembly/api.ts(solveMates, 가장 테스트 많은 엔진 — 7,400줄+)
 * #2 shape-generator/assembly/matesSolver.ts(solveAssembly — DOF패널·드래그 백엔드)
 * #3 shape-generator/assembly/AssemblyMates.ts(solveMates — 메시 face-index, 실제 배치경로)
 *
 * ── 폐기된 #4(260723 dogfooding) ──────────────────────────────────────────
 * `src/lib/nexyfab/assemblyMateSolver.ts` (이전 #4)는 이 테스트를 작성하는 과정에서
 * 실제 발산 버그가 발견되어 삭제됐다: 위치 보정 스텝이 `vsub(f.position, correction.dPos)`
 * (빼기)로 돼있었는데 실제로는 더해야 정답(coincident/distance/concentric/limitDistance
 * 전부 — dPos를 쓰는 모든 메이트 종류). 실측: A(고정, x=0)에 coincident로 붙어야 할
 * B(x=40)가 5회 반복 후 x=303.75로 발산(수렴이 아니라 매 스텝 1.5배 폭주). 이 모듈은
 * 테스트가 하나도 없었고(이번 조사로 확인) 고유 기능도 없어(#1의 진부분집합), 유일한
 * 호출처(ShapeGeneratorInner.tsx의 반응형 재해석 effect)를 #1(solveMates)로 마이그레이션
 * 하고 파일을 삭제했다 — 아키텍처 정리이자 실사용 발산버그 수정.
 */
import { describe, it, expect } from 'vitest';
import { applyGeometryMatesToPlaced } from '@/app/[lang]/shape-generator/assembly/applyGeometryMatesToPlaced';
import { solveAssembly } from '@/app/[lang]/shape-generator/assembly';
import { placedPartsAndAssemblyMatesToSolverState } from '@/app/[lang]/shape-generator/assembly/mateSelectionMapping';
import type { PlacedPart } from '@/app/[lang]/shape-generator/assembly/PartPlacementPanel';
import type { AssemblyMate } from '@/app/[lang]/shape-generator/assembly/AssemblyMates';
import { solveMates as solveMatesApi } from '@/lib/assembly/api';

function boxPlaced(name: string, x: number): PlacedPart {
  return {
    id: `id_${name}`,
    name,
    shapeId: 'box',
    params: { width: 10, height: 10, depth: 10 },
    qty: 1,
    position: [x, 0, 0],
    rotation: [0, 0, 0],
  };
}

describe('M3 mate solvers coarse alignment', () => {
  it('#1/#2/#3 all move B toward A for a coincident mate on library boxes', () => {
    const placed: PlacedPart[] = [boxPlaced('A', 0), boxPlaced('B', 40)];
    const mates: AssemblyMate[] = [
      {
        id: 'm1',
        type: 'coincident',
        partA: 'A',
        partB: 'B',
        faceA: 0,
        faceB: 0,
        locked: false,
      },
    ];

    const afterMesh = applyGeometryMatesToPlaced(placed, mates, 20);
    const bxMesh = afterMesh[1]!.position[0];

    const state0 = placedPartsAndAssemblyMatesToSolverState(placed, mates);
    const solved = solveAssembly(state0);
    const bxSolver = solved.bodies[1]!.position.x;

    // #1 (src/lib/assembly/api.ts) — analytical, named-ref data model. A
    // coincident mate on each box's built-in `origin` point is the closest
    // analytical equivalent to "boxes meet" for two centered 10mm cubes.
    const r1 = solveMatesApi(
      [
        { partId: 'A', position: { x: 0, y: 0, z: 0 }, fixed: true },
        { partId: 'B', position: { x: 40, y: 0, z: 0 } },
      ],
      [{ id: 'm1', kind: 'coincident', a: { partId: 'A', refId: 'origin' }, b: { partId: 'B', refId: 'origin' } }],
    );
    const bxApi = r1.part('B').position.x;

    expect(bxMesh).toBeLessThan(40);
    expect(bxSolver).toBeLessThan(40);
    expect(bxApi).toBeLessThan(40);
    expect(Math.abs(bxMesh - bxSolver)).toBeLessThan(25);
    // #1 solves to an EXACT origin-coincident (both origins at the same
    // point), which is a stricter target than #2/#3's face-based approach —
    // so only the DIRECTION is compared against them, not the magnitude.
    expect(bxApi).toBeCloseTo(0, 1);
  });

  it('#1/#2/#3 all move B in the same direction for a distance mate on library boxes', () => {
    const placed: PlacedPart[] = [boxPlaced('A', 0), boxPlaced('B', 40)];
    const mates: AssemblyMate[] = [
      {
        id: 'd1',
        type: 'distance',
        partA: 'A',
        partB: 'B',
        faceA: 0,
        faceB: 0,
        value: 8,
        locked: false,
      },
    ];

    const afterMesh = applyGeometryMatesToPlaced(placed, mates, 40);
    const bxMesh = afterMesh[1]!.position[0];

    const state0 = placedPartsAndAssemblyMatesToSolverState(placed, mates);
    const solved = solveAssembly(state0);
    const bxSolver = solved.bodies[1]!.position.x;

    const r1 = solveMatesApi(
      [
        { partId: 'A', position: { x: 0, y: 0, z: 0 }, fixed: true },
        { partId: 'B', position: { x: 40, y: 0, z: 0 } },
      ],
      [{ id: 'd1', kind: 'distance', a: { partId: 'A', refId: 'origin' }, b: { partId: 'B', refId: 'origin' }, value: 8 }],
    );
    const bxApi = r1.part('B').position.x;

    expect(bxMesh).not.toBe(40);
    expect(bxSolver).not.toBe(40);
    expect(bxApi).not.toBe(40);
    expect(Math.sign(bxMesh - 40)).toBe(Math.sign(bxSolver - 40));
    // #1 pulls B toward A (origin-to-origin distance 8mm from A's origin at
    // x=0), so B ends up near x=8 — same DIRECTION (toward A) as #2/#3.
    expect(Math.sign(bxApi - 40)).toBe(Math.sign(bxMesh - 40));
    expect(bxApi).toBeCloseTo(8, 0);
  });

  // Gear/hinge mates are deliberately NOT included in this alignment check:
  // #3 (AssemblyMates.ts) explicitly aliases 'gear'/'hinge' to static
  // placement mates (solveParallel/solveConcentric) rather than real
  // kinematic coupling (documented limitation, not a bug) — a cross-solver
  // comparison against #1's REAL gear-ratio/signed-hinge-limit engine would
  // compare two different semantics, not catch drift. #1's own engine tests
  // (iterativeSolver.advanced.test.ts, lagrangianJacobian.test.ts) already
  // cover gear/hinge correctness in depth.
});
