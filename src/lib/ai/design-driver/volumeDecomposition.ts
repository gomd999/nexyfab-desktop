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

// ─── 불일치 국소화 (260728 §7-1) ────────────────────────────────────────────

/** 2D 루프의 부호 있는 면적(shoelace) — 절대값이 단면적. */
function loopAreaMm2(loop: ReadonlyArray<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i]!, q = loop[(i + 1) % n]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export interface DiscrepancySplit {
  /** 그린 루프의 실제 단면적(mm²). */
  drawnAreaMm2: number;
  /** 그린 루프의 축정렬 외곽 크기(mm) — 외곽은 맞는데 안쪽만 틀린 경우를 가려낸다. */
  drawnExtentMm: { x: number; y: number };
  /** 그린 압출 깊이(mm). */
  drawnDepthMm: number;
  /** 선언한 분해의 단면적·깊이. */
  declaredAreaMm2: number;
  declaredDepthMm: number;
  /** 깊이가 어긋났나 / 단면이 어긋났나 — 둘은 서로 다른 실수다. */
  depthMismatch: boolean;
  areaMismatch: boolean;
}

/**
 * 부피 불일치를 **깊이 축과 단면 축으로 쪼갠다** (260728 §7-1).
 *
 * 왜: 종전 게이트 메시지는 "부피 840000 이 이론 360000 과 다르다"뿐이었다. 비율만으로는
 * 깊이를 잘못 썼는지 단면을 잘못 그렸는지 알 수 없고, 실측(bench v1)에서는 **전부 단면**
 * 이었다 — 그것도 U-채널 2건이 정확히 같은 배수(7/3)로 틀리는 체계적 실수였다(안쪽 포켓
 * 높이를 '플랜지높이−벽두께' 대신 '벽두께'로 그린다). 비율 하나로는 그게 안 보인다.
 *
 * ⚠ 여기서 계산한 값은 **보고용이지 판정용이 아니다.** 합·불은 여전히 커널이 실측한 부피와
 * 모델이 독립 선언한 분해의 대조로만 정한다 — 그리지 않은 것을 그린 것처럼 고쳐주지 않는다.
 */
export function splitVolumeDiscrepancy(
  loop: ReadonlyArray<{ x: number; y: number }>,
  drawnDepthMm: number,
  d: VolumeDecomposition,
  tolRel: number,
): DiscrepancySplit | null {
  if (!Array.isArray(loop) || loop.length < 3 || !Number.isFinite(drawnDepthMm)) return null;
  let declaredAreaMm2: number;
  try { declaredAreaMm2 = decompositionAreaMm2(d); } catch { return null; }
  const drawnAreaMm2 = loopAreaMm2(loop);
  const xs = loop.map((p) => p.x), ys = loop.map((p) => p.y);
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
  return {
    drawnAreaMm2,
    drawnExtentMm: { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) },
    drawnDepthMm,
    declaredAreaMm2,
    declaredDepthMm: d.depthMm,
    depthMismatch: rel(drawnDepthMm, d.depthMm) > tolRel,
    areaMismatch: rel(drawnAreaMm2, declaredAreaMm2) > tolRel,
  };
}

/** 사람이 읽는 한 줄 — 게이트 사유에 덧붙인다. */
export function discrepancyLine(s: DiscrepancySplit): string {
  const parts: string[] = [];
  if (s.depthMismatch) {
    parts.push(`extrude depth: you drew ${s.drawnDepthMm} mm but declared ${s.declaredDepthMm} mm`);
  }
  if (s.areaMismatch) {
    parts.push(
      `cross-section area: the loop you drew encloses ${s.drawnAreaMm2} mm² but your decomposition ` +
      `implies ${s.declaredAreaMm2} mm² (drawn outer extent ${s.drawnExtentMm.x}×${s.drawnExtentMm.y} mm) — ` +
      `the loop is not the shape you described`,
    );
  }
  if (!parts.length) {
    // 깊이도 단면도 맞는데 부피가 틀리다 = 루프가 자기교차/역방향이거나 다른 body 가 섞였다.
    parts.push(
      `depth and cross-section area both match your decomposition, so the volume gap is NOT in ` +
      `either — check for a self-intersecting or reversed loop, or extra bodies in this part`,
    );
  }
  return parts.join('; ');
}

// ─── 치수 약속의 산술 (260728, §7-1 치수 축) ────────────────────────────────

import type { DimensionDerivation } from './types';

/**
 * 치수 `expected` 를 브리프 치수에서 **엔진이** 계산한다.
 *
 * 부피(§6-1)와 같은 원칙이고 같은 이유다: 모델이 못하는 것은 **산술**이지 의도가 아니다.
 * 실측(bench v1) — b-11 경사 심이 3/3 으로 `aligned` 슬랜트 길이에서 죽었고, 실측
 * 122.576(=√(120²+25²))은 **옳았는데** 모델의 약속이 매 실행마다 달랐다(125·120.208·122.066).
 *
 * ⚠ 독립성은 그대로다 — 항은 **브리프 치수**에서 오고 측정 기하에서 오지 않는다.
 * 측정값에서 expected 를 유도하면 그 순간 검사가 항등식이 된다(§6-1 에서 배격한 것).
 */
export function derivedDimensionMm(d: DimensionDerivation): number {
  const pos = (v: number, what: string) => {
    if (!Number.isFinite(v) || v <= 0) throw new RangeError(`expectedFrom.${what}=${v} — 유한한 양수여야 한다`);
    return v;
  };
  switch (d.kind) {
    case 'hypotenuse':
      return Math.hypot(pos(d.legAMm, 'legAMm'), pos(d.legBMm, 'legBMm'));
    case 'sum': {
      if (!Array.isArray(d.termsMm) || d.termsMm.length === 0) throw new RangeError('expectedFrom.termsMm 가 비어 있다');
      return d.termsMm.reduce((a, v, i) => a + pos(v, `termsMm[${i}]`), 0);
    }
    case 'difference': {
      if (!Array.isArray(d.minusMm) || d.minusMm.length === 0) throw new RangeError('expectedFrom.minusMm 가 비어 있다');
      const out = d.minusMm.reduce((a, v, i) => a - pos(v, `minusMm[${i}]`), pos(d.fromMm, 'fromMm'));
      if (!(out > 0)) throw new RangeError(`expectedFrom: ${d.fromMm} − ${d.minusMm.join('−')} = ${out} — 양수가 아니다`);
      return out;
    }
  }
}

/** 사람이 읽는 한 줄 — 게이트 notes 에 실려 "왜 이 숫자인가"가 남는다. */
export function derivationLine(d: DimensionDerivation): string {
  const v = derivedDimensionMm(d);
  if (d.kind === 'hypotenuse') return `expectedFrom: √(${d.legAMm}² + ${d.legBMm}²) = ${v}`;
  if (d.kind === 'sum') return `expectedFrom: ${d.termsMm.join(' + ')} = ${v}`;
  return `expectedFrom: ${d.fromMm} − ${d.minusMm.join(' − ')} = ${v}`;
}
