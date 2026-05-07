// ─── Interference Detection ──────────────────────────────────────────────────
// World `transform` per part should match assembly BOM placement (M3-P2: bomPartWorldMatrixFromBom).
// 성능: 월드 AABB는 파트당 1회만 계산. n이 크면 X축 sweep-and-prune으로 AABB 후보만 좁힌 뒤 narrow-phase(웹·워커 공통).
import * as THREE from 'three';
import { INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT } from '@/lib/assemblyLoadPolicy';

export interface InterferenceResult {
  partA: string;
  partB: string;
  volume: number; // cm³ (estimated)
  boundingBox: THREE.Box3;
}

export interface PartInput {
  id: string;
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
}

// ─── Broad-phase: AABB overlap ──────────────────────────────────────────────

/** 각 파트당 한 번만 호출 — 쌍 루프에서 `computeBoundingBox`를 반복하지 않는다. */
function computeWorldBoundingBoxOnce(part: PartInput): THREE.Box3 {
  part.geometry.computeBoundingBox();
  const box = part.geometry.boundingBox!.clone();
  box.applyMatrix4(part.transform);
  return box;
}

/**
 * X축 sweep-and-prune: min.x 순으로 정렬한 뒤, 매 스텝에서 활성을 제자리 압축(max.x ≥ 현재 min.x만 유지)하고 전체 AABB 교차 검사.
 * 3D 겹침 후보만 남는다(이후 `runPair`에서도 `intersectsBox`로 재확인).
 */
function collectSweepAndPruneAABBCandidates(worldBoxes: THREE.Box3[]): [number, number][] {
  const n = worldBoxes.length;
  if (n < 2) return [];

  const ord = Array.from({ length: n }, (_, i) => i);
  ord.sort((a, b) => worldBoxes[a].min.x - worldBoxes[b].min.x);

  const active: number[] = [];
  const seen = new Set<string>();
  const pairs: [number, number][] = [];
  const addPair = (i: number, j: number) => {
    const lo = i < j ? i : j;
    const hi = i < j ? j : i;
    if (lo === hi) return;
    const key = `${lo}|${hi}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([lo, hi]);
  };

  for (const idx of ord) {
    const bxMin = worldBoxes[idx].min.x;
    let write = 0;
    for (let h = 0; h < active.length; h++) {
      const a = active[h];
      if (worldBoxes[a].max.x >= bxMin) {
        active[write++] = a;
      }
    }
    active.length = write;

    const bi = worldBoxes[idx];
    for (let h = 0; h < active.length; h++) {
      const a = active[h];
      if (worldBoxes[a].intersectsBox(bi)) {
        addPair(a, idx);
      }
    }
    active.push(idx);
  }

  return pairs;
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Interference detection aborted', 'AbortError');
  }
}

// ─── Narrow-phase: triangle–triangle intersection ───────────────────────────

/** Get triangle vertices in world space */
function getTriangle(geometry: THREE.BufferGeometry, transform: THREE.Matrix4, triIndex: number): THREE.Triangle {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.index;

  let i0: number, i1: number, i2: number;
  if (index) {
    i0 = index.getX(triIndex * 3);
    i1 = index.getX(triIndex * 3 + 1);
    i2 = index.getX(triIndex * 3 + 2);
  } else {
    i0 = triIndex * 3;
    i1 = triIndex * 3 + 1;
    i2 = triIndex * 3 + 2;
  }

  const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0).applyMatrix4(transform);
  const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1).applyMatrix4(transform);
  const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2).applyMatrix4(transform);

  return new THREE.Triangle(a, b, c);
}

function getTriangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  const pos = geometry.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}

/** Separating Axis Theorem for triangle–triangle intersection test */
function trianglesIntersect(t1: THREE.Triangle, t2: THREE.Triangle): boolean {
  // Quick AABB pre-check for each triangle
  const box1 = new THREE.Box3().setFromPoints([t1.a, t1.b, t1.c]);
  const box2 = new THREE.Box3().setFromPoints([t2.a, t2.b, t2.c]);
  if (!box1.intersectsBox(box2)) return false;

  // Moller–Trumbore-style SAT test using edge cross products + face normals
  const edges1 = [
    new THREE.Vector3().subVectors(t1.b, t1.a),
    new THREE.Vector3().subVectors(t1.c, t1.b),
    new THREE.Vector3().subVectors(t1.a, t1.c),
  ];
  const edges2 = [
    new THREE.Vector3().subVectors(t2.b, t2.a),
    new THREE.Vector3().subVectors(t2.c, t2.b),
    new THREE.Vector3().subVectors(t2.a, t2.c),
  ];

  const n1 = new THREE.Vector3().crossVectors(edges1[0], edges1[1]);
  const n2 = new THREE.Vector3().crossVectors(edges2[0], edges2[1]);

  const axes: THREE.Vector3[] = [n1, n2];
  for (const e1 of edges1) {
    for (const e2 of edges2) {
      const cross = new THREE.Vector3().crossVectors(e1, e2);
      if (cross.lengthSq() > 1e-10) axes.push(cross);
    }
  }

  const verts1 = [t1.a, t1.b, t1.c];
  const verts2 = [t2.a, t2.b, t2.c];

  for (const axis of axes) {
    if (axis.lengthSq() < 1e-10) continue;

    let min1 = Infinity, max1 = -Infinity;
    let min2 = Infinity, max2 = -Infinity;

    for (const v of verts1) {
      const d = v.dot(axis);
      if (d < min1) min1 = d;
      if (d > max1) max1 = d;
    }
    for (const v of verts2) {
      const d = v.dot(axis);
      if (d < min2) min2 = d;
      if (d > max2) max2 = d;
    }

    if (max1 < min2 || max2 < min1) return false; // separating axis found
  }

  return true; // no separating axis → intersection
}

function narrowPhaseInterference(
  parts: PartInput[],
  i: number,
  j: number,
  boxA: THREE.Box3,
  boxB: THREE.Box3,
  maxTriPairsPerCheck: number,
): { found: boolean; overlapBox: THREE.Box3 } {
  const overlapBox = boxA.clone().intersect(boxB);
  if (overlapBox.isEmpty()) return { found: false, overlapBox };

  const triCountA = getTriangleCount(parts[i].geometry);
  const triCountB = getTriangleCount(parts[j].geometry);

  let intersectionFound = false;
  let checked = 0;

  const stepA = Math.max(1, Math.floor(triCountA / Math.sqrt(maxTriPairsPerCheck)));
  const stepB = Math.max(1, Math.floor(triCountB / Math.sqrt(maxTriPairsPerCheck)));

  for (let a = 0; a < triCountA && !intersectionFound; a += stepA) {
    const triA = getTriangle(parts[i].geometry, parts[i].transform, a);
    const triABox = new THREE.Box3().setFromPoints([triA.a, triA.b, triA.c]);
    if (!triABox.intersectsBox(overlapBox)) continue;

    for (let b = 0; b < triCountB && !intersectionFound; b += stepB) {
      checked++;
      if (checked > maxTriPairsPerCheck) {
        intersectionFound = true;
        break;
      }

      const triB = getTriangle(parts[j].geometry, parts[j].transform, b);
      const triBBox = new THREE.Box3().setFromPoints([triB.a, triB.b, triB.c]);
      if (!triBBox.intersectsBox(overlapBox)) continue;

      if (trianglesIntersect(triA, triB)) {
        intersectionFound = true;
      }
    }
  }

  return { found: intersectionFound, overlapBox };
}

/**
 * cooperative 전용 — 로직은 `narrowPhaseInterference`와 동일, 삼각형 예산 루프마다 idle 양보.
 * (`triYieldStride` ≤ 0이면 narrow 안에서는 양보하지 않음.)
 */
async function narrowPhaseInterferenceAsync(
  parts: PartInput[],
  i: number,
  j: number,
  boxA: THREE.Box3,
  boxB: THREE.Box3,
  maxTriPairsPerCheck: number,
  triYieldStride: number,
  signal?: AbortSignal,
): Promise<{ found: boolean; overlapBox: THREE.Box3 }> {
  throwIfAborted(signal);
  const overlapBox = boxA.clone().intersect(boxB);
  if (overlapBox.isEmpty()) return { found: false, overlapBox };

  const triCountA = getTriangleCount(parts[i].geometry);
  const triCountB = getTriangleCount(parts[j].geometry);

  let intersectionFound = false;
  let checked = 0;

  const stepA = Math.max(1, Math.floor(triCountA / Math.sqrt(maxTriPairsPerCheck)));
  const stepB = Math.max(1, Math.floor(triCountB / Math.sqrt(maxTriPairsPerCheck)));

  for (let a = 0; a < triCountA && !intersectionFound; a += stepA) {
    const triA = getTriangle(parts[i].geometry, parts[i].transform, a);
    const triABox = new THREE.Box3().setFromPoints([triA.a, triA.b, triA.c]);
    if (!triABox.intersectsBox(overlapBox)) continue;

    for (let b = 0; b < triCountB && !intersectionFound; b += stepB) {
      checked++;
      if (triYieldStride > 0 && checked % triYieldStride === 0) {
        await yieldToBrowser();
        throwIfAborted(signal);
      }
      if (checked > maxTriPairsPerCheck) {
        intersectionFound = true;
        break;
      }

      const triB = getTriangle(parts[j].geometry, parts[j].transform, b);
      const triBBox = new THREE.Box3().setFromPoints([triB.a, triB.b, triB.c]);
      if (!triBBox.intersectsBox(overlapBox)) continue;

      if (trianglesIntersect(triA, triB)) {
        intersectionFound = true;
      }
    }
  }

  return { found: intersectionFound, overlapBox };
}

// ─── Main Detection ─────────────────────────────────────────────────────────

/**
 * Detect interference between all pairs of parts.
 * Broad phase: 월드 AABB + (n≥`INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT`일 때) X축 sweep-and-prune 후보만.
 * Narrow phase: triangle-level intersection (capped to limit performance).
 * Returns list of interfering pairs with estimated overlap volume.
 */
export function detectInterference(
  parts: PartInput[],
  maxTriPairsPerCheck: number = 50000,
): InterferenceResult[] {
  const results: InterferenceResult[] = [];
  const worldBoxes = parts.map(p => computeWorldBoundingBoxOnce(p));
  const n = parts.length;

  const runPair = (i: number, j: number) => {
    const boxA = worldBoxes[i];
    const boxB = worldBoxes[j];
    if (!boxA.intersectsBox(boxB)) return;

    const { found, overlapBox } = narrowPhaseInterference(
      parts, i, j, boxA, boxB, maxTriPairsPerCheck,
    );
    if (!found) return;

    const overlapSize = overlapBox.getSize(new THREE.Vector3());
    const volumeMM3 = overlapSize.x * overlapSize.y * overlapSize.z;
    const volumeCM3 = volumeMM3 / 1000;

    results.push({
      partA: parts[i].id,
      partB: parts[j].id,
      volume: volumeCM3,
      boundingBox: overlapBox,
    });
  };

  if (n >= INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT) {
    const candidates = collectSweepAndPruneAABBCandidates(worldBoxes);
    for (const [i, j] of candidates) {
      runPair(i, j);
    }
  } else {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        runPair(i, j);
      }
    }
  }

  return results;
}

export interface DetectInterferenceCooperativeOptions {
  /** broad-phase 후보(또는 소형 n의 전 쌍)를 이 횟수마다 처리한 뒤 메인 스레드에 양보 */
  candidateYieldStride?: number;
  /** narrow-phase 삼각형 예산 카운트(`checked`)를 이 횟수마다 idle 양보 — 한 쌍이 무거울 때 UI 응답 유지 */
  triCheckYieldStride?: number;
  /** 취소 시 `AbortError` — `useInterferenceWorker` 폴백·패널 취소 버튼과 연동 */
  signal?: AbortSignal;
}

/**
 * `detectInterference`와 동일 결과를 목표로 하되, 메인 스레드 폴백 시 UI 멈춤을 줄이기 위해 후보·narrow 삼각 루프에서 idle 양보.
 * 워커 스레드에서는 `detectInterference`를 그대로 쓰는 것이 낫다.
 */
export async function detectInterferenceCooperative(
  parts: PartInput[],
  maxTriPairsPerCheck: number = 50000,
  options?: DetectInterferenceCooperativeOptions,
): Promise<InterferenceResult[]> {
  throwIfAborted(options?.signal);
  const results: InterferenceResult[] = [];
  const worldBoxes = parts.map(p => computeWorldBoundingBoxOnce(p));
  const n = parts.length;
  const stride = Math.max(1, options?.candidateYieldStride ?? 8);
  const triStride = options?.triCheckYieldStride ?? 32;
  const signal = options?.signal;

  const runPair = async (i: number, j: number) => {
    throwIfAborted(signal);
    const boxA = worldBoxes[i];
    const boxB = worldBoxes[j];
    if (!boxA.intersectsBox(boxB)) return;

    const { found, overlapBox } = await narrowPhaseInterferenceAsync(
      parts, i, j, boxA, boxB, maxTriPairsPerCheck, triStride, signal,
    );
    if (!found) return;

    const overlapSize = overlapBox.getSize(new THREE.Vector3());
    const volumeMM3 = overlapSize.x * overlapSize.y * overlapSize.z;
    const volumeCM3 = volumeMM3 / 1000;

    results.push({
      partA: parts[i].id,
      partB: parts[j].id,
      volume: volumeCM3,
      boundingBox: overlapBox,
    });
  };

  let processed = 0;
  const step = async () => {
    processed++;
    if (processed % stride === 0) {
      await yieldToBrowser();
      throwIfAborted(signal);
    }
  };

  if (n >= INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT) {
    const candidates = collectSweepAndPruneAABBCandidates(worldBoxes);
    for (const [i, j] of candidates) {
      await runPair(i, j);
      await step();
    }
  } else {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        await runPair(i, j);
        await step();
      }
    }
  }

  return results;
}
