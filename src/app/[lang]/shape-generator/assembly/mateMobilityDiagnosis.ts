/**
 * mateMobilityDiagnosis — F-3(260808f): 어셈블리 메이트의 **과구속/자유도 진단**.
 *
 * #5 격차(Gauss-Seidel 배치 솔버가 과구속을 조용히 넘김)의 1단계 대응: 풀이를
 * 바꾸기 전에 **진단부터** — 검증된 야코비안 랭크 진단(kinematics.mjs
 * solveMobility, 29/29 테스트)에 메이트를 등가 운동쌍으로 사상해 넣는다.
 *
 * 정직 사상 원칙: 자유도 등가가 명확한 메이트만 넣는다 —
 *   coincident/distance(면-면) → planar(면내 2병진+법선회전)
 *   concentric               → cylindrical(축 병진+회전)
 *   hinge                    → revolute · slider → prismatic
 * 그 밖(parallel·perpendicular·angle·tangent·gear·limitDistance·limitAngle·width)은 표준 운동쌍
 * 등가가 없어 **제외 목록으로 명시 반환** — 제외분이 있으면 진단은 부분
 * 진단임을 함께 표시한다(조용한 생략 금지). 축이 없는 사상 대상 메이트도
 * 제외(축 추정은 날조).
 */

export interface MateForDiagnosis {
  id: string;
  type: string;
  partA: string;
  partB: string;
  /** 메이트 기준 축/법선(월드) — UI 배선부가 기하에서 계산해 공급 */
  axis?: [number, number, number];
  /** 메이트 앵커점(mm, 월드) — 없으면 두 부품 중점 */
  atMm?: [number, number, number];
}

export interface MobilityDiagnosis {
  status: 'ok' | 'partial' | 'not_run';
  /** 잔여 자유도(접지 기준 상대) — null 이면 계산 불가 */
  mobility: number | null;
  /** 중복(과구속) 제약 행 수 — 0 초과면 과구속 */
  redundant: number;
  overconstrained: boolean;
  /** 사상 불가로 제외된 메이트(사유 포함) — 있으면 status='partial' */
  excluded: Array<{ id: string; type: string; reason: string }>;
  note: string;
}

const EQUIV: Record<string, string> = {
  coincident: 'planar',
  distance: 'planar',
  concentric: 'cylindrical',
  hinge: 'revolute',
  slider: 'prismatic',
};

export async function diagnoseMateMobility(
  mates: ReadonlyArray<MateForDiagnosis>,
  parts: ReadonlyArray<{ id: string; grounded?: boolean; atMm?: [number, number, number] }>,
): Promise<MobilityDiagnosis> {
  const excluded: MobilityDiagnosis['excluded'] = [];
  const joints: Array<Record<string, unknown>> = [];
  for (const mate of mates) {
    const equivalent = EQUIV[mate.type];
    if (!equivalent) {
      excluded.push({ id: mate.id, type: mate.type, reason: 'no_standard_pair_equivalent' });
      continue;
    }
    if (!mate.axis || !mate.axis.some(v => Math.abs(v) > 1e-9)) {
      excluded.push({ id: mate.id, type: mate.type, reason: 'axis_unavailable' });
      continue;
    }
    joints.push({
      type: equivalent,
      between: [mate.partA, mate.partB],
      axisVec: mate.axis,
      ...(mate.atMm ? { atMm: mate.atMm } : {}),
    });
  }
  if (joints.length === 0) {
    return {
      status: 'not_run', mobility: null, redundant: 0, overconstrained: false, excluded,
      note: '사상 가능한 메이트 없음 — 진단하지 않았다(0 아님)',
    };
  }
  // kinematics.mjs 는 순수 공유 모듈(node 의존 0) — 동적 import 로 번들 분리.
  const { solveMobility } = await import('../../../../../scripts/drawing-to-3d/kinematics.mjs');
  const assembly = {
    parts: parts.map(part => ({
      id: part.id,
      role: part.grounded ? 'ground' : undefined,
      at: part.atMm ? { tx: part.atMm[0], ty: part.atMm[1], tz: part.atMm[2] } : {},
    })),
    joints,
  };
  const solved = solveMobility(assembly) as { mobility: number | null; redundant?: number; note?: string } | null;
  if (!solved || solved.mobility === null || solved.mobility === undefined) {
    return {
      status: 'not_run', mobility: null, redundant: 0, overconstrained: false, excluded,
      note: solved?.note ?? '자유도 계산 불가',
    };
  }
  const redundant = solved.redundant ?? 0;
  return {
    status: excluded.length ? 'partial' : 'ok',
    mobility: solved.mobility,
    redundant,
    overconstrained: redundant > 0,
    excluded,
    note: excluded.length
      ? `부분 진단 — 사상 불가 메이트 ${excluded.length}건 제외(과구속이 더 있을 수 있음)`
      : '전 메이트 사상 진단',
  };
}
