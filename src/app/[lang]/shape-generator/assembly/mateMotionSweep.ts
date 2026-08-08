/**
 * mateMotionSweep — F-5(260808g): 뷰포트 힌지 메이트를 **Pro own-CAD 솔버
 * 스택**(lib/assembly — iterativeSolve/runMotionSweep, ADR-013)으로 컴파일해
 * 계획 범위를 스윕하고 프레임별 충돌을 판정하는 **병렬 채널**.
 *
 * Gauss-Seidel 뷰포트 솔버의 대체가 아니라 검증 채널이다(K6 사다리의
 * 브라우저측 대응): 스윕 각도마다 재수렴한 자세로 부품쌍 충돌을 실측한다.
 *
 * fail-closed 원칙(K6 인증서와 동일):
 *  - 축/기하가 없으면 not_run(추정 날조 금지)
 *  - 비수렴 프레임이 있으면 pass 주장 불가 → not_run(사유 표기)
 *  - 충돌 엔진(three-mesh-bvh) 부재 시 not_run — AABB 근사로 pass 를
 *    지어내지 않는다
 *  - **기준자세 접촉 차등**: 힌지 핀-보스처럼 프레임 0 부터 접촉인 쌍은
 *    baselineContacts 로 명시 분리하고, 스윕 중 **새로 생긴** 충돌만
 *    collision 으로 판정한다(초기 접촉을 실패로 오판하지도, 새 충돌을
 *    접촉이라 덮지도 않는다).
 */
import * as THREE from 'three';
import { runMotionSweep } from '@/lib/assembly/motionStudy';
import type { AssemblyState as ProAssemblyState, PartInstance } from '@/lib/assembly/assemblyState';
import type { HingeMate, MateRef } from '@/lib/assembly/mate';
import type { GeometryResolver, ResolvedGeometry } from '@/lib/assembly/iterativeSolver';
import type { AssemblyState as ViewportAssemblyState, Mate as ViewportMate, MateSelection } from './matesSolver';

export interface MotionSweepCertificate {
  status: 'pass' | 'collision' | 'not_run';
  mateId: string;
  fromDeg: number;
  toDeg: number;
  frames: number;
  convergedFrames: number;
  /** 프레임 0 부터 접촉인 부품쌍(힌지 핀-보스 등) — 실패가 아니라 명시 분리. */
  baselineContacts: Array<[string, string]>;
  /** 스윕 중 새로 생긴 첫 충돌. */
  firstCollision: { frame: number; angleDeg: number; pair: [string, string] } | null;
  note: string;
}

interface SweepOptions {
  fromDeg?: number;
  toDeg?: number;
  steps?: number;
}

type BvhGeometry = THREE.BufferGeometry & {
  boundsTree?: { intersectsGeometry: (other: THREE.BufferGeometry, matrix: THREE.Matrix4) => boolean };
  computeBoundsTree?: () => void;
};

const quatFromEuler = (e: THREE.Euler): { x: number; y: number; z: number; w: number } => {
  const q = new THREE.Quaternion().setFromEuler(e);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
};

const worldDir = (sel: MateSelection, rot: THREE.Euler): THREE.Vector3 | null => {
  const local = sel.localAxis ?? sel.localNormal;
  if (!local || local.lengthSq() < 1e-12) return null;
  return local.clone().normalize().applyEuler(rot);
};

/** 임의의 단위벡터에 수직인 단위벡터(안정적 선택). */
const anyPerpendicular = (v: THREE.Vector3): THREE.Vector3 => {
  const helper = Math.abs(v.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3().crossVectors(v, helper).normalize();
};

const placementMatrix = (p: PartInstance): THREE.Matrix4 => {
  const q = new THREE.Quaternion(p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(p.position.x, p.position.y, p.position.z),
    q,
    new THREE.Vector3(1, 1, 1),
  );
};

/**
 * 뷰포트 어셈블리의 힌지 메이트 1개를 스윕 인증한다.
 * 요구: 메이트 양쪽 셀렉션에 축(localAxis|localNormal), 양쪽 바디에 geometry.
 */
export function sweepHingeMateClearance(
  view: ViewportAssemblyState,
  mateId: string,
  options: SweepOptions = {},
): MotionSweepCertificate {
  const fromDeg = options.fromDeg ?? 0;
  const toDeg = options.toDeg ?? 180;
  const steps = Math.max(1, Math.round(options.steps ?? 24));
  const notRun = (note: string): MotionSweepCertificate => ({
    status: 'not_run', mateId, fromDeg, toDeg, frames: 0, convergedFrames: 0,
    baselineContacts: [], firstCollision: null, note,
  });

  const mate = view.mates.find(m => m.id === mateId);
  if (!mate || mate.type !== 'hinge') return notRun('힌지 메이트가 아니거나 없음');
  const [selA, selB] = mate.selections;
  const bodyA = view.bodies[selA.bodyIndex];
  const bodyB = view.bodies[selB.bodyIndex];
  if (!bodyA || !bodyB) return notRun('메이트가 가리키는 바디 없음');

  const axisWorldA = worldDir(selA, bodyA.rotation);
  const axisWorldB = worldDir(selB, bodyB.rotation);
  if (!axisWorldA || !axisWorldB) return notRun('축 없음 — 추정하지 않는다');

  // 충돌 엔진 가용성(fail-closed): 지오메트리+BVH 없이는 인증하지 않는다.
  const geos = view.bodies.map(b => b.geometry as BvhGeometry | undefined);
  if (geos.some(g => !g || (g.attributes.position?.count ?? 0) === 0)) {
    return notRun('바디 지오메트리 없음 — 충돌 판정 불가');
  }
  for (const g of geos) {
    if (!g!.boundsTree) {
      if (typeof g!.computeBoundsTree !== 'function') return notRun('충돌 엔진(BVH) 없음');
      g!.computeBoundsTree();
    }
  }

  // ── 뷰포트 → Pro 솔버 컴파일 ─────────────────────────────────────────
  const parts: PartInstance[] = view.bodies.map((b, i) => ({
    id: `b${i}`,
    name: b.name || `b${i}`,
    partTemplateId: `b${i}`,
    position: { x: b.position.x, y: b.position.y, z: b.position.z },
    orientation: quatFromEuler(b.rotation),
    fixed: b.fixed,
  }));
  let groundedNote = '';
  if (!parts.some(p => p.fixed)) {
    // 접지 없는 스윕은 무한 자유도 — 메이트 A측 바디를 접지로 명시 지정.
    parts[selA.bodyIndex] = { ...parts[selA.bodyIndex], fixed: true };
    groundedNote = ` · 접지 없음→b${selA.bodyIndex}(${bodyA.name || 'A'}) 임시 접지(명시)`;
  }

  // 로컬 축/점 레지스트리 — GeometryResolver 가 배치 변화마다 월드로 사상.
  const localRefs = new Map<string, { point: THREE.Vector3; dir: THREE.Vector3 }>();
  const refFor = (sel: MateSelection, tag: string): MateRef | null => {
    const local = sel.localAxis ?? sel.localNormal;
    if (!local) return null;
    localRefs.set(`b${sel.bodyIndex}:${tag}`, {
      point: sel.localPoint.clone(),
      dir: local.clone().normalize(),
    });
    return { partId: `b${sel.bodyIndex}`, refId: tag, refKind: 'axis' };
  };
  const refA = refFor(selA, 'hinge-a');
  const refB = refFor(selB, 'hinge-b');
  if (!refA || !refB) return notRun('축 없음 — 추정하지 않는다');

  const resolve: GeometryResolver = (ref, part): ResolvedGeometry | null => {
    const local = localRefs.get(`${ref.partId}:${ref.refId}`);
    if (!local) return null;
    const q = new THREE.Quaternion(part.orientation.x, part.orientation.y, part.orientation.z, part.orientation.w);
    const origin = local.point.clone().applyQuaternion(q)
      .add(new THREE.Vector3(part.position.x, part.position.y, part.position.z));
    const dir = local.dir.clone().applyQuaternion(q);
    return {
      kind: 'axis',
      world: {
        origin: { x: origin.x, y: origin.y, z: origin.z },
        direction: { x: dir.x, y: dir.y, z: dir.z },
      },
    };
  };

  // zeroAngleRef: 현재 자세를 각도 0 으로 — 월드 공통 수직벡터를 두 바디
  // 프레임으로 되사상(두 바디에서 같은 월드벡터 = 현재 상대각 0 정의).
  const wPerp = anyPerpendicular(axisWorldA);
  const invQA = new THREE.Quaternion().setFromEuler(bodyA.rotation).invert();
  const invQB = new THREE.Quaternion().setFromEuler(bodyB.rotation).invert();
  const toVec3 = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
  const proMate: HingeMate = {
    id: mate.id,
    kind: 'hinge',
    a: refA,
    b: refB,
    zeroAngleRef: {
      a: toVec3(wPerp.clone().applyQuaternion(invQA)),
      b: toVec3(wPerp.clone().applyQuaternion(invQB)),
      axisA: toVec3((selA.localAxis ?? selA.localNormal)!.clone().normalize()),
      axisB: toVec3((selB.localAxis ?? selB.localNormal)!.clone().normalize()),
    },
  };
  const proState: ProAssemblyState = { parts, mates: [proMate] };

  let result;
  try {
    result = runMotionSweep(proState, resolve, { mateId: mate.id, fromValue: fromDeg, toValue: toDeg, steps });
  } catch (err) {
    return notRun(`스윕 실행 불가: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 프레임별 충돌(기준자세 접촉 차등) ────────────────────────────────
  const pairKey = (i: number, j: number) => `${i}-${j}`;
  const collideAt = (state: ProAssemblyState, i: number, j: number): boolean => {
    const pi = state.parts[i], pj = state.parts[j];
    const gi = geos[i]!, gj = geos[j]!;
    const rel = placementMatrix(pi).invert().multiply(placementMatrix(pj));
    return gi.boundsTree!.intersectsGeometry(gj, rel);
  };
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < view.bodies.length; i++) {
    for (let j = i + 1; j < view.bodies.length; j++) pairs.push([i, j]);
  }
  const baseline = new Set<string>();
  const frame0 = result.frames[0];
  for (const [i, j] of pairs) {
    if (collideAt(frame0.solve.state, i, j)) baseline.add(pairKey(i, j));
  }
  const nameOf = (i: number) => view.bodies[i].name || `b${i}`;

  let firstCollision: MotionSweepCertificate['firstCollision'] = null;
  for (const frame of result.frames) {
    if (frame.index === 0) continue;
    for (const [i, j] of pairs) {
      if (baseline.has(pairKey(i, j))) continue;
      if (collideAt(frame.solve.state, i, j)) {
        firstCollision = { frame: frame.index, angleDeg: frame.parameterValue, pair: [nameOf(i), nameOf(j)] };
        break;
      }
    }
    if (firstCollision) break;
  }

  const converged = result.frames.filter(f => f.solve.success).length;
  const baselineContacts = [...baseline].map(k => {
    const [i, j] = k.split('-').map(Number);
    return [nameOf(i), nameOf(j)] as [string, string];
  });

  if (firstCollision) {
    return {
      status: 'collision', mateId, fromDeg, toDeg, frames: result.frames.length,
      convergedFrames: converged, baselineContacts, firstCollision,
      note: `${firstCollision.angleDeg.toFixed(1)}°에서 ${firstCollision.pair[0]}↔${firstCollision.pair[1]} 신규 충돌${groundedNote}`,
    };
  }
  if (!result.allConverged) {
    return {
      status: 'not_run', mateId, fromDeg, toDeg, frames: result.frames.length,
      convergedFrames: converged, baselineContacts, firstCollision: null,
      note: `비수렴 프레임 ${result.frames.length - converged}개 — 무충돌을 주장하지 않는다(첫 실패 #${result.firstFailureFrame})${groundedNote}`,
    };
  }
  return {
    status: 'pass', mateId, fromDeg, toDeg, frames: result.frames.length,
    convergedFrames: converged, baselineContacts, firstCollision: null,
    note: `${fromDeg}°..${toDeg}° ${result.frames.length}프레임 전 수렴·신규 충돌 없음${groundedNote}`,
  };
}
