/**
 * design-driver/volumeDecomposition — 계획이 선언한 단면 분해로부터 이론 부피를
 * **엔진이** 계산한다 (260728, §6-1).
 *
 * 여기서 지켜야 하는 불변식 하나: 이 계산은 **그린 루프를 절대 읽지 않는다.**
 * 루프에서 유도하면 geometryGate 의 expected/measured 가 같은 출처가 되어 비교가
 * 항등식이 되고, 잘못 그린 부품이 통과한다(실측 근거:
 * `__tests__/expectedVolumeIndependence.test.ts`). 분해는 브리프 치수로 쓴 **두 번째
 * 독립 진술**이고, 그래서 루프와 대조하는 것이 여전히 의미가 있다.
 *
 * 모델에게서 뺏는 것은 산술뿐이다 — 형상 의도는 여전히 모델이 말한다.
 */
import type { VolumeDecomposition, VolumeTerm } from './types';

/** 항 하나의 단면적(mm²) — 부호 미적용. */
function termAreaMm2(t: VolumeTerm, path: string): number {
  const pos = (v: number, name: string) => {
    if (!Number.isFinite(v) || v <= 0) {
      throw new RangeError(`${path}.${name}=${v} — 단면 치수는 유한한 양수여야 한다`);
    }
    return v;
  };
  switch (t.shape) {
    case 'rect':
      return pos(t.widthMm, 'widthMm') * pos(t.heightMm, 'heightMm');
    case 'circle': {
      const d = pos(t.diameterMm, 'diameterMm');
      return (Math.PI * d * d) / 4;
    }
    case 'triangle':
      return (pos(t.baseMm, 'baseMm') * pos(t.heightMm, 'heightMm')) / 2;
  }
}

/** 분해의 단면적 합(mm²) — sign=-1 은 파낸 항. */
export function decompositionAreaMm2(d: VolumeDecomposition): number {
  if (!Array.isArray(d.terms) || d.terms.length === 0) {
    throw new RangeError('decomposition.terms 가 비어 있다 — 근거 없는 부피는 받지 않는다');
  }
  let area = 0;
  d.terms.forEach((t, i) => {
    const sign = t.sign ?? 1;
    if (sign !== 1 && sign !== -1) {
      throw new RangeError(`decomposition.terms[${i}].sign=${sign} — 1 또는 -1 만 허용`);
    }
    area += sign * termAreaMm2(t, `decomposition.terms[${i}]`);
  });
  return area;
}

/**
 * 분해 → 이론 부피(mm³). 단면적이 0 이하면 거부한다 — 부호 조합을 잘못 쓴
 * 분해가 "부피 0 인 부품"으로 조용히 통과하는 것을 막는다.
 */
export function decompositionVolumeMm3(d: VolumeDecomposition): number {
  const depth = d.depthMm;
  if (!Number.isFinite(depth) || depth <= 0) {
    throw new RangeError(`decomposition.depthMm=${depth} — 유한한 양수여야 한다`);
  }
  const area = decompositionAreaMm2(d);
  if (!(area > 0)) {
    throw new RangeError(`decomposition 단면적이 ${area} mm² — 양수가 아니다(부호 조합 확인)`);
  }
  return area * depth;
}

/** 사람이 읽는 한 줄 근거 — 게이트 notes 에 실려 "왜 이 숫자인가"가 남는다. */
export function decompositionBasisLine(d: VolumeDecomposition): string {
  const parts = d.terms.map((t) => {
    const s = (t.sign ?? 1) === -1 ? '−' : '+';
    if (t.shape === 'rect') return `${s}${t.widthMm}×${t.heightMm}`;
    if (t.shape === 'circle') return `${s}π⌀${t.diameterMm}²/4`;
    return `${s}${t.baseMm}×${t.heightMm}/2`;
  });
  return `decomposition: (${parts.join(' ')}) mm² × ${d.depthMm} mm = ${decompositionVolumeMm3(d)} mm³`;
}
