/**
 * boundaryFunction — **표·함수로 정의된 경계조건** (260801, 격차 항목 P7).
 *
 * 기존 `boundaryConditions.ts` 는 **프리셋**(고정·롤러·핀·등분포…)만 있었다 — 값이 상수다.
 * 실무 하중은 시간에 따라 변하고(램프·사이클·계단), 공간에 따라 변한다(수압·온도 분포).
 * 이 모듈은 그 「변하는 값」을 정의하고 **안전하게 평가**한다.
 *
 * ## ⚠ 이 모듈이 지키는 한 가지 — **표 밖을 외삽하지 않는다**
 * 표로 준 하중을 범위 밖에서 이어 그리면 **없는 데이터를 만드는 것**이다.
 * 시험 데이터가 0~100 °C 인데 300 °C 값을 직선으로 늘려 쓰면, 그 숫자는 측정도 계산도
 * 아니다. 그래서 기본 동작은 **거부**이고, 「끝값 유지(clamp)」는 **호출측이 명시적으로**
 * 골라야 한다 — 고르는 순간 그건 사용자의 판단이 된다.
 *
 * ```
 *   'reject'  범위 밖 → 값 없음 + 이유 (기본)
 *   'clamp'   범위 밖 → 끝값 유지 (명시적 선택. 「그렇게 하기로 했다」가 기록된다)
 * ```
 * ⚠ `'extrapolate'` 는 **제공하지 않는다.** 있으면 기본값처럼 쓰이고, 그게 이 모듈이
 *   막으려는 바로 그 일이다.
 */

export type OutOfRange = 'reject' | 'clamp';

/** (x, y) 표. x 는 시간(s)·좌표(mm)·온도(°C) 등 무엇이든 되지만 **오름차순**이어야 한다. */
export interface TableSpec {
  kind: 'table';
  points: Array<[number, number]>;
  /** 범위 밖 처리. 기본 `'reject'`. */
  outOfRange?: OutOfRange;
}

/** y = y0 + (y1−y0)·(x−x0)/(x1−x0), 구간 밖은 `outOfRange` 규칙. */
export interface RampSpec {
  kind: 'ramp';
  x0: number; y0: number; x1: number; y1: number;
  outOfRange?: OutOfRange;
}

/** y = mean + amplitude·sin(2π·freq·x + phase). 정의역 제한 없음(해석 함수). */
export interface SineSpec {
  kind: 'sine';
  amplitude: number; freq: number; phase?: number; mean?: number;
}

/** x < at → before, x ≥ at → after. */
export interface StepSpec {
  kind: 'step';
  at: number; before: number; after: number;
}

export type BcFunctionSpec = TableSpec | RampSpec | SineSpec | StepSpec;

export type BcEval =
  | { ok: true; value: number; note?: string }
  | { ok: false; reason: string };

/** 표가 쓸 수 있는 형태인지 — **평가 전에** 검사한다. */
export function validateTable(t: TableSpec): string | null {
  if (!Array.isArray(t.points) || t.points.length === 0) return '표가 비어 있다';
  if (t.points.length === 1) return '표에 점이 하나뿐이다 — 보간할 구간이 없다';
  for (let i = 0; i < t.points.length; i++) {
    const p = t.points[i];
    if (!p || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return `${i + 1}번째 점이 유효한 (x, y) 쌍이 아니다`;
    }
    // ⚠ 정렬해 주지 않는다. 사용자가 순서를 틀린 것인지 x 가 되감기는 이력인지 우리는 모른다.
    if (i > 0 && p[0] <= t.points[i - 1]![0]) {
      return `x 가 오름차순이 아니다(${i}번째 ${t.points[i - 1]![0]} → ${i + 1}번째 ${p[0]}) — 정렬해 주지 않는다`;
    }
  }
  return null;
}

/**
 * 경계조건 함수를 x 에서 평가한다.
 *
 * ⚠ 실패는 **0 을 돌려주지 않는다.** 0 은 「하중이 없다」는 값이고, 그건 「모른다」와 다르다.
 */
export function evaluateBcFunction(spec: BcFunctionSpec, x: number): BcEval {
  if (!Number.isFinite(x)) return { ok: false, reason: `평가점 x 가 유한하지 않다(${x})` };

  switch (spec.kind) {
    case 'sine': {
      const v = (spec.mean ?? 0) + spec.amplitude * Math.sin(2 * Math.PI * spec.freq * x + (spec.phase ?? 0));
      return { ok: true, value: v };
    }
    case 'step':
      return { ok: true, value: x < spec.at ? spec.before : spec.after };

    case 'ramp': {
      const { x0, x1, y0, y1 } = spec;
      if (!(x1 > x0)) return { ok: false, reason: `램프 구간이 뒤집혔다(x0=${x0}, x1=${x1})` };
      if (x < x0 || x > x1) return outside(x, x0, x1, x < x0 ? y0 : y1, spec.outOfRange ?? 'reject');
      return { ok: true, value: y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) };
    }

    case 'table': {
      const err = validateTable(spec);
      if (err) return { ok: false, reason: err };
      const p = spec.points;
      const lo = p[0]![0], hi = p[p.length - 1]![0];
      if (x < lo) return outside(x, lo, hi, p[0]![1], spec.outOfRange ?? 'reject');
      if (x > hi) return outside(x, lo, hi, p[p.length - 1]![1], spec.outOfRange ?? 'reject');
      // 구간 이분 탐색 후 선형 보간
      let a = 0, b = p.length - 1;
      while (b - a > 1) {
        const m = (a + b) >> 1;
        if (p[m]![0] <= x) a = m; else b = m;
      }
      const [xa, ya] = p[a]!, [xb, yb] = p[b]!;
      const t = xb === xa ? 0 : (x - xa) / (xb - xa);
      return { ok: true, value: ya + t * (yb - ya) };
    }
  }
}

function outside(x: number, lo: number, hi: number, edge: number, mode: OutOfRange): BcEval {
  if (mode === 'clamp') {
    // ⚠ 끝값을 유지했다는 **사실을 남긴다.** 조용히 하면 사용자는 표 안의 값으로 오해한다.
    return { ok: true, value: edge, note: `x=${x} 가 정의 범위(${lo}~${hi}) 밖이라 끝값 ${edge} 로 유지했다(clamp — 명시 선택)` };
  }
  return {
    ok: false,
    reason: `x=${x} 가 정의 범위(${lo}~${hi}) 밖이다 — 외삽하지 않는다. `
      + '범위를 넓히거나, 끝값 유지가 타당하면 outOfRange:"clamp" 를 명시하라.',
  };
}

export interface BcSeriesResult {
  /** 평가에 성공한 (x, y). 실패한 점은 **빠져 있다** — 0 으로 채우지 않는다. */
  values: Array<{ x: number; y: number }>;
  /** 평가하지 못한 점과 이유. 비어 있지 않으면 시계열에 **구멍이 있다**. */
  failures: Array<{ x: number; reason: string }>;
  /** clamp 로 끝값을 유지한 점들의 안내(있으면 그 구간은 표의 값이 아니다). */
  notes: string[];
}

/**
 * 시간(또는 좌표) 배열 전체에 대해 평가한다.
 *
 * ⚠ 실패한 점을 **0 으로 채우지 않는다.** 하중 이력에 0 을 끼워 넣으면 그 순간 하중이
 *   사라진 것처럼 해석되고, 응답이 조용히 작아진다. 빠뜨리고 **빠뜨렸다고 알린다.**
 */
export function evaluateBcSeries(spec: BcFunctionSpec, xs: number[]): BcSeriesResult {
  const values: BcSeriesResult['values'] = [];
  const failures: BcSeriesResult['failures'] = [];
  const notes: string[] = [];
  for (const x of xs) {
    const r = evaluateBcFunction(spec, x);
    if (r.ok) {
      values.push({ x, y: r.value });
      if (r.note) notes.push(r.note);
    } else failures.push({ x, reason: r.reason });
  }
  return { values, failures, notes };
}
