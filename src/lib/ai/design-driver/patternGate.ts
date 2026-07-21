/**
 * design-driver/patternGate — WB-7: 피처 패턴·기어 사이징 게이트.
 *
 * Consumption vs self-implementation (보고 의무 — 명세):
 *
 *   CONSUMED (convention) — the circular-pattern angular-step convention from
 *   features/circularPattern (step = totalAngle / count, rotation about +Y in
 *   the XZ plane). The driver reproduces the SAME layout so a planned pattern
 *   matches what the modeler would build.
 *
 *   SELF-IMPLEMENTED — the instance transforms (positions/angles), a non-overlap
 *   screen (adjacent-instance spacing ≥ seed footprint), and spur-gear sizing
 *   consistency (pitch diameter = module × teeth; circular pitch = π × module;
 *   pitch-circle arc spacing = circular pitch).
 *
 * 근사 명시 (⑥ '부분' 경계): this gate verifies the pattern LAYOUT — instance
 * count, spacing, non-overlap, and gear PITCH sizing. It does NOT generate the
 * involute tooth PROFILE nor a CSG union of the meshed instances; those are the
 * excluded remainder (stated, not faked).
 */

import type {
  GateResult,
  PatternInstance,
  PatternRecord,
  PatternSpec,
  PlanPart,
} from './types';

const DEG = Math.PI / 180;

function unit(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [1, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export interface PatternArtifact {
  records: PatternRecord[];
  /** Per-spec layout failures (gate reasons). */
  failures: string[];
}

/** Build the instance layout for ONE pattern spec, or return a failure reason. */
function resolvePattern(spec: PatternSpec): { record: PatternRecord; failure?: string } | { failure: string } {
  if (!(spec.count >= 2) || !Number.isInteger(spec.count)) {
    return { failure: `pattern '${spec.id}': count ${spec.count} must be an integer ≥ 2` };
  }
  const seed = spec.seedSizeMm ?? 0;
  const instances: PatternInstance[] = [];

  if (spec.kind === 'linear') {
    const pitch = spec.pitchMm;
    if (pitch === undefined || !(pitch > 0)) {
      return { failure: `pattern '${spec.id}': linear pattern needs a positive pitchMm` };
    }
    const ax = unit(spec.axis ?? [1, 0, 0]);
    for (let i = 0; i < spec.count; i++) {
      instances.push({ index: i, position: [ax[0] * pitch * i, ax[1] * pitch * i, ax[2] * pitch * i] });
    }
    const record: PatternRecord = { id: spec.id, kind: 'linear', count: spec.count, instances, linearSpanMm: pitch * (spec.count - 1) };
    if (seed > 0 && pitch < seed - 1e-9) {
      return { record, failure: `pattern '${spec.id}': linear pitch ${pitch} mm < seed size ${seed} mm — instances overlap` };
    }
    return { record };
  }

  // circular — angular pitch = angle / count (features/circularPattern convention).
  const angle = spec.angleDeg ?? 360;
  const radius = spec.radiusMm ?? 0;
  const stepDeg = angle / spec.count;
  for (let i = 0; i < spec.count; i++) {
    const th = i * stepDeg * DEG;
    // Rotation about +Y in the XZ plane (Matrix4.makeRotationY convention).
    instances.push({
      index: i,
      position: [radius * Math.cos(th), 0, -radius * Math.sin(th)],
      angleDeg: i * stepDeg,
    });
  }
  const arcSpacingMm = radius > 0 ? radius * stepDeg * DEG : 0;
  const record: PatternRecord = {
    id: spec.id,
    kind: 'circular',
    count: spec.count,
    instances,
    angularPitchDeg: stepDeg,
    arcSpacingMm,
  };

  if (spec.gear) {
    const { moduleMm, teeth } = spec.gear;
    if (!(moduleMm > 0) || !Number.isInteger(teeth) || teeth < 2) {
      return { record, failure: `pattern '${spec.id}': gear needs moduleMm > 0 and integer teeth ≥ 2` };
    }
    const pitchDiameterMm = moduleMm * teeth;
    const circularPitchMm = Math.PI * moduleMm;
    record.gear = { moduleMm, teeth, pitchDiameterMm, circularPitchMm };
    if (spec.count !== teeth) {
      return { record, failure: `pattern '${spec.id}': circular count ${spec.count} ≠ gear teeth ${teeth}` };
    }
    if (radius > 0 && Math.abs(radius - pitchDiameterMm / 2) > 1e-6) {
      return {
        record,
        failure: `pattern '${spec.id}': radius ${radius} mm ≠ pitch radius ${(pitchDiameterMm / 2).toFixed(4)} mm (module ${moduleMm} × teeth ${teeth})`,
      };
    }
  }

  if (seed > 0 && arcSpacingMm > 0 && arcSpacingMm < seed - 1e-9) {
    return { record, failure: `pattern '${spec.id}': arc spacing ${arcSpacingMm.toFixed(3)} mm < seed size ${seed} mm — instances overlap` };
  }
  return { record };
}

export function buildPatternArtifact(part: PlanPart): PatternArtifact | null {
  if (!part.patterns || part.patterns.length === 0) return null;
  const records: PatternRecord[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const spec of part.patterns) {
    if (seen.has(spec.id)) {
      failures.push(`pattern '${spec.id}': duplicate id`);
      continue;
    }
    seen.add(spec.id);
    const res = resolvePattern(spec);
    if ('record' in res && res.record) records.push(res.record);
    if (res.failure) failures.push(res.failure);
    if (spec.expectedInstances !== undefined && 'record' in res && res.record) {
      if (res.record.instances.length !== spec.expectedInstances) {
        failures.push(`pattern '${spec.id}': ${res.record.instances.length} instances ≠ expected ${spec.expectedInstances}`);
      }
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id));
  return { records, failures };
}

/**
 * Pattern gate. Fails (패키지 미산출) when any declared pattern is invalid
 * (count, overlap, gear inconsistency, or instance-count mismatch). Emits the
 * real instance layout + gear sizing.
 */
export function patternGate(part: PlanPart, artifact: PatternArtifact | null): GateResult {
  const id = `pattern:${part.partId}`;
  const notes: string[] = [
    'features/circularPattern 각도 관례 소비(step=totalAngle/count, +Y 회전) — 인스턴스 변환 실계산',
    '검증 범위=레이아웃(인스턴스 수·간격·비겹침·기어 피치 사이징) — 인벌류트 치형·인스턴스 CSG 합집합은 미생성(⑥ 부분 경계·근사 명시)',
  ];
  const metrics: Record<string, number> = {};

  if (!part.patterns || part.patterns.length === 0) {
    return { id, kind: 'pattern', pass: false, metrics, reason: 'pattern gate invoked on a part with no patterns', notes };
  }
  if (!artifact) {
    return { id, kind: 'pattern', pass: false, metrics, reason: 'pattern resolution produced no layout (build failed)', notes };
  }

  metrics.patternCount = part.patterns.length;
  metrics.resolvedCount = artifact.records.length;
  metrics.failureCount = artifact.failures.length;
  metrics.totalInstances = artifact.records.reduce((s, r) => s + r.instances.length, 0);

  const pass = artifact.failures.length === 0;
  return {
    id,
    kind: 'pattern',
    pass,
    metrics,
    ...(pass ? {} : { reason: artifact.failures.join('; ') }),
    notes,
  };
}
