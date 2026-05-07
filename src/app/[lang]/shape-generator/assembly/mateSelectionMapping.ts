/**
 * M3: `AssemblyMate` (면 인덱스 + 라이브러리 기하) ↔ `matesSolver.Mate` (`MateSelection`) 매핑.
 * 저장·`solveMates` 경로와 뷰포트 `solveAssembly`를 한 데이터 모델로 묶는 첫 단계 — 완전 동치는
 * 모든 메이트 타입·피처 트리 기하에 대해 보장하지 않음. `docs/strategy/M3_ASSEMBLY.md` §2.
 *
 * 매핑 실패 시 UI·로그용: `classifyPlacedAssemblyMateMappingFailure` / `reportPlacedAssemblyMateMapping`
 * (배치 파트), BOM 경로는 `classifyBomAssemblyMateMappingFailure` / `reportBomAssemblyMateMapping`.
 */
import * as THREE from 'three';
import { buildShapeResult } from '../shapes';
import type { PlacedPart } from './PartPlacementPanel';
import type { AssemblyMate } from './AssemblyMates';
import type { AssemblyBody, AssemblyState, Mate, MateSelection } from './matesSolver';
import type { BomPartResult } from '../ShapePreview';

/** Why `assemblyMateToSolverMate*` returned null — for UI / diagnostics (Phase B1). */
export type MateMappingFailure =
  | 'part_a_not_found'
  | 'part_b_not_found'
  | 'geometry_a_missing'
  | 'geometry_b_missing';

export interface PlacedMateMappingReport {
  includedMateIds: string[];
  failures: { mateId: string; failure: MateMappingFailure }[];
}

export interface BomMateMappingReport {
  includedMateIds: string[];
  failures: { mateId: string; failure: MateMappingFailure }[];
}

/** `null` = 매핑 가능. */
export function classifyPlacedAssemblyMateMappingFailure(
  mate: AssemblyMate,
  placed: PlacedPart[],
): MateMappingFailure | null {
  const ia = placed.findIndex(x => x.name === mate.partA);
  if (ia < 0) return 'part_a_not_found';
  const ib = placed.findIndex(x => x.name === mate.partB);
  if (ib < 0) return 'part_b_not_found';
  const ga = buildShapeResult(placed[ia]!.shapeId, placed[ia]!.params)?.geometry;
  const gb = buildShapeResult(placed[ib]!.shapeId, placed[ib]!.params)?.geometry;
  if (!ga) return 'geometry_a_missing';
  if (!gb) return 'geometry_b_missing';
  return null;
}

export function classifyBomAssemblyMateMappingFailure(
  mate: AssemblyMate,
  bom: BomPartResult[],
): MateMappingFailure | null {
  const ia = bom.findIndex(x => x.name === mate.partA);
  if (ia < 0) return 'part_a_not_found';
  const ib = bom.findIndex(x => x.name === mate.partB);
  if (ib < 0) return 'part_b_not_found';
  const ga = bom[ia]!.result.geometry;
  const gb = bom[ib]!.result.geometry;
  if (!ga) return 'geometry_a_missing';
  if (!gb) return 'geometry_b_missing';
  return null;
}

export function reportPlacedAssemblyMateMapping(
  placed: PlacedPart[],
  mates: AssemblyMate[],
): PlacedMateMappingReport {
  const includedMateIds: string[] = [];
  const failures: { mateId: string; failure: MateMappingFailure }[] = [];
  for (const m of mates) {
    const f = classifyPlacedAssemblyMateMappingFailure(m, placed);
    if (f) failures.push({ mateId: m.id, failure: f });
    else includedMateIds.push(m.id);
  }
  return { includedMateIds, failures };
}

export function reportBomAssemblyMateMapping(
  bom: BomPartResult[],
  mates: AssemblyMate[],
): BomMateMappingReport {
  const includedMateIds: string[] = [];
  const failures: { mateId: string; failure: MateMappingFailure }[] = [];
  for (const m of mates) {
    const f = classifyBomAssemblyMateMappingFailure(m, bom);
    if (f) failures.push({ mateId: m.id, failure: f });
    else includedMateIds.push(m.id);
  }
  return { includedMateIds, failures };
}

/** World matrix for a placed library part (geometry local → world). */
export function placedPartWorldMatrix(p: PlacedPart): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const e = new THREE.Euler(
    (p.rotation[0] * Math.PI) / 180,
    (p.rotation[1] * Math.PI) / 180,
    (p.rotation[2] * Math.PI) / 180,
  );
  m.makeRotationFromEuler(e);
  m.setPosition(p.position[0], p.position[1], p.position[2]);
  return m;
}

function faceTriangleIndices(geometry: THREE.BufferGeometry, faceIndex: number): [number, number, number] {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.index;
  if (index) {
    return [
      index.getX(faceIndex * 3),
      index.getX(faceIndex * 3 + 1),
      index.getX(faceIndex * 3 + 2),
    ];
  }
  return [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];
}

/** Face centroid in geometry local space (matches `AssemblyMates` triangle indexing). */
export function faceCentroidLocal(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const [i0, i1, i2] = faceTriangleIndices(geometry, faceIndex);
  const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
  const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
  const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
  return new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3);
}

/** Outward-ish face normal in geometry local space (unnormalized cross). */
export function faceNormalLocal(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const [i0, i1, i2] = faceTriangleIndices(geometry, faceIndex);
  const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
  const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
  const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
  const e1 = new THREE.Vector3().subVectors(b, a);
  const e2 = new THREE.Vector3().subVectors(c, a);
  return new THREE.Vector3().crossVectors(e1, e2).normalize();
}

/**
 * `MateSelection` for one body: geometry-local face sample (centroid + normal).
 * Assumes `AssemblyBody` pose matches `placedPartWorldMatrix` for the same part (라이브러리 파트).
 */
export function mateSelectionFromPlacedFace(
  bodyIndex: number,
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  mateType: AssemblyMate['type'],
): MateSelection {
  const localPoint = faceCentroidLocal(geometry, faceIndex);
  const localNormal = faceNormalLocal(geometry, faceIndex);
  const base: MateSelection = {
    bodyIndex,
    type: 'face',
    localPoint,
    localNormal,
  };
  if (mateType === 'concentric') {
    return { ...base, localAxis: localNormal.clone() };
  }
  return base;
}

function assemblyBodyFromPlacedPart(p: PlacedPart, fixed: boolean): AssemblyBody {
  const sr = buildShapeResult(p.shapeId, p.params);
  return {
    name: p.name,
    position: new THREE.Vector3(p.position[0], p.position[1], p.position[2]),
    rotation: new THREE.Euler(
      (p.rotation[0] * Math.PI) / 180,
      (p.rotation[1] * Math.PI) / 180,
      (p.rotation[2] * Math.PI) / 180,
    ),
    fixed,
    geometry: sr?.geometry,
  };
}

/**
 * 단일 `AssemblyMate`를 `matesSolver`용 `Mate`로 변환. `partA`/`partB`가 `placed` 순서에 없으면 `null`.
 */
export function assemblyMateToSolverMate(mate: AssemblyMate, placed: PlacedPart[]): Mate | null {
  if (classifyPlacedAssemblyMateMappingFailure(mate, placed)) return null;
  const ia = placed.findIndex(x => x.name === mate.partA);
  const ib = placed.findIndex(x => x.name === mate.partB);
  const ga = buildShapeResult(placed[ia]!.shapeId, placed[ia]!.params)?.geometry;
  const gb = buildShapeResult(placed[ib]!.shapeId, placed[ib]!.params)?.geometry;
  if (!ga || !gb) return null;

  const fa = mate.faceA ?? 0;
  const fb = mate.faceB ?? 0;

  const selections: [MateSelection, MateSelection] = [
    mateSelectionFromPlacedFace(ia, ga, fa, mate.type),
    mateSelectionFromPlacedFace(ib, gb, fb, mate.type),
  ];

  const out: Mate = {
    id: mate.id,
    type: mate.type as Mate['type'],
    selections,
    enabled: !mate.locked,
  };
  if (mate.type === 'distance' && mate.value !== undefined) out.distance = mate.value;
  if (mate.type === 'angle' && mate.value !== undefined) out.angle = mate.value;
  return out;
}

export type PlacedToSolverStateOptions = {
  /** 기본 `true`: 인덱스 0 파트를 고정(솔버 기준). */
  fixFirstPart?: boolean;
};

/**
 * `placedParts` + `AssemblyMate[]` → `AssemblyState` (`solveAssembly` 입력).
 * `mates` 중 매핑 실패 항목은 조용히 제외.
 */
export function placedPartsAndAssemblyMatesToSolverState(
  placed: PlacedPart[],
  mates: AssemblyMate[],
  options?: PlacedToSolverStateOptions,
): AssemblyState {
  const fixFirst = options?.fixFirstPart !== false;
  const bodies = placed.map((p, i) => assemblyBodyFromPlacedPart(p, fixFirst && i === 0));
  const solverMates: Mate[] = [];
  for (const m of mates) {
    const sm = assemblyMateToSolverMate(m, placed);
    if (sm) solverMates.push(sm);
  }
  return { bodies, mates: solverMates };
}

function assemblyBodyFromBomPart(p: BomPartResult, fixed: boolean): AssemblyBody {
  const pos = p.position ?? [0, 0, 0];
  const rot = p.rotation ?? [0, 0, 0];
  return {
    name: p.name,
    position: new THREE.Vector3(pos[0], pos[1], pos[2]),
    rotation: new THREE.Euler(
      (rot[0] * Math.PI) / 180,
      (rot[1] * Math.PI) / 180,
      (rot[2] * Math.PI) / 180,
    ),
    fixed,
    geometry: p.result.geometry,
  };
}

/**
 * 멀티 바디 / 챗 BOM 등 `BomPartResult[]`의 실제 `geometry`로 `AssemblyMate` → `Mate` 변환.
 * `partA`/`partB` 이름이 `bom` 행에 없으면 `null`.
 */
export function assemblyMateToSolverMateForBom(mate: AssemblyMate, bom: BomPartResult[]): Mate | null {
  if (classifyBomAssemblyMateMappingFailure(mate, bom)) return null;
  const ia = bom.findIndex(x => x.name === mate.partA);
  const ib = bom.findIndex(x => x.name === mate.partB);
  const ga = bom[ia]!.result.geometry;
  const gb = bom[ib]!.result.geometry;
  if (!ga || !gb) return null;

  const fa = mate.faceA ?? 0;
  const fb = mate.faceB ?? 0;

  const selections: [MateSelection, MateSelection] = [
    mateSelectionFromPlacedFace(ia, ga, fa, mate.type),
    mateSelectionFromPlacedFace(ib, gb, fb, mate.type),
  ];

  const out: Mate = {
    id: mate.id,
    type: mate.type as Mate['type'],
    selections,
    enabled: !mate.locked,
  };
  if (mate.type === 'distance' && mate.value !== undefined) out.distance = mate.value;
  if (mate.type === 'angle' && mate.value !== undefined) out.angle = mate.value;
  return out;
}

/**
 * `BomPartResult[]`(실제 메시) + `AssemblyMate[]` → `AssemblyState`.
 * 배치 파트가 없을 때 Solver 탭 동기화용. 매핑 실패 메이트는 제외.
 */
export function bomPartResultsAndAssemblyMatesToSolverState(
  bom: BomPartResult[],
  mates: AssemblyMate[],
  options?: PlacedToSolverStateOptions,
): AssemblyState {
  const fixFirst = options?.fixFirstPart !== false;
  const bodies = bom.map((p, i) => assemblyBodyFromBomPart(p, fixFirst && i === 0));
  const solverMates: Mate[] = [];
  for (const m of mates) {
    const sm = assemblyMateToSolverMateForBom(m, bom);
    if (sm) solverMates.push(sm);
  }
  return { bodies, mates: solverMates };
}
