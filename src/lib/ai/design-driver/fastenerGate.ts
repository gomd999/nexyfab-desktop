/**
 * design-driver/fastenerGate — WB-8: 나사산·규격품 게이트 (standard threads).
 *
 * Consumption vs self-implementation (보고 의무 — 명세):
 *
 *   CONSUMED — the standard-thread data + callout formatter
 *   (annotations/GDTTypes): `METRIC_COARSE_PITCHES` is the ISO 261 coarse-pitch
 *   table (real standard data, not fabricated), `formatThreadCallout` renders
 *   the ISO designation (e.g. 'M8×1.25-6H').
 *
 *   SELF-IMPLEMENTED — the derived thread geometry from the published ISO
 *   68-1/724 formulas (pitch/minor diameter, tap drill) with the basis stated,
 *   and an engagement-length SCREEN against a per-material minimum (Machinery's-
 *   Handbook-style factor × nominal diameter). A declared fastener that names a
 *   non-standard nominal, an invalid pitch, or an under-engaged thread FAILS the
 *   gate (패키지 미산출) — the same force as a declared dimension.
 *
 * 근사 명시: the minimum-engagement factor is a fastener-SELECTION screen (strip-
 * strength proxy), NOT a torqued-joint FEA; blind-hole depth vs engagement is
 * declared, not geometrically verified against the body here.
 */

import {
  METRIC_COARSE_PITCHES,
  formatThreadCallout,
  type ThreadFit,
} from '@/app/[lang]/shape-generator/annotations/GDTTypes';
import type {
  FastenerMateMaterial,
  FastenerRecord,
  FastenerSpec,
  GateResult,
  PlanPart,
} from './types';

/** Screening min-engagement as a multiple of nominal diameter, by mate material.
 *  Steel-in-steel ≈ 0.8·D (equal-strength rule of thumb); softer materials need
 *  more thread to reach bolt strength. Documented as a selection screen. */
const MIN_ENGAGEMENT_FACTOR: Record<FastenerMateMaterial, number> = {
  steel: 0.8,
  castIron: 1.25,
  brass: 1.5,
  aluminum: 2.0,
};

export interface FastenerArtifact {
  records: FastenerRecord[];
  /** Per-spec resolution/engagement failures (gate reasons). */
  failures: string[];
}

/** Resolve ONE fastener spec against the standard tables + ISO formulas. */
function resolveFastener(spec: FastenerSpec): { record: FastenerRecord } | { failure: string } {
  const d = spec.nominalDiameterMm;
  const coarse = METRIC_COARSE_PITCHES[d];
  if (coarse === undefined) {
    return {
      failure: `fastener '${spec.id}': M${d} is not a standard ISO metric size ` +
        `(known: ${Object.keys(METRIC_COARSE_PITCHES).join(', ')})`,
    };
  }
  const pitch = spec.pitchMm ?? coarse;
  if (!(pitch > 0)) {
    return { failure: `fastener '${spec.id}': pitch ${pitch} mm must be positive` };
  }
  if (!(spec.engagementMm > 0)) {
    return { failure: `fastener '${spec.id}': engagement ${spec.engagementMm} mm must be positive` };
  }

  const mate: FastenerMateMaterial = spec.mateMaterial ?? 'steel';
  const minEngagement = MIN_ENGAGEMENT_FACTOR[mate] * d;
  if (spec.engagementMm < minEngagement - 1e-9) {
    return {
      failure:
        `fastener '${spec.id}': thread engagement ${spec.engagementMm} mm < recommended ` +
        `${minEngagement.toFixed(2)} mm for ${mate} (${MIN_ENGAGEMENT_FACTOR[mate]}×D) — strip risk`,
    };
  }

  // ISO 68-1 / 724 derived dimensions (basis in notes).
  const pitchDiameterMm = d - 0.6495 * pitch;
  const minorDiameterMm =
    spec.type === 'external' ? d - 1.22687 * pitch : d - 1.08253 * pitch;
  const callout = formatThreadCallout({
    standard: 'metric',
    nominalDiameter: d,
    pitch,
    type: spec.type,
    ...(spec.fit ? { fit: spec.fit as ThreadFit } : {}),
  });

  const record: FastenerRecord = {
    id: spec.id,
    callout,
    type: spec.type,
    nominalDiameterMm: d,
    pitchMm: pitch,
    pitchDiameterMm,
    minorDiameterMm,
    engagementMm: spec.engagementMm,
    minEngagementMm: minEngagement,
    coarse: Math.abs(pitch - coarse) < 1e-9,
  };
  if (spec.type === 'internal') record.tapDrillMm = d - pitch; // standard tap-drill rule
  return { record };
}

/** Build the fastener schedule for a part. Returns null when none declared. */
export function buildFastenerArtifact(part: PlanPart): FastenerArtifact | null {
  if (!part.fasteners || part.fasteners.length === 0) return null;
  const records: FastenerRecord[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const spec of part.fasteners) {
    if (seen.has(spec.id)) {
      failures.push(`fastener '${spec.id}': duplicate id`);
      continue;
    }
    seen.add(spec.id);
    const res = resolveFastener(spec);
    if ('record' in res) records.push(res.record);
    else failures.push(res.failure);
  }
  records.sort((a, b) => a.id.localeCompare(b.id));
  return { records, failures };
}

/**
 * Fastener gate. Fails (패키지 미산출) when any declared fastener does not
 * resolve to a standard ISO thread or is under-engaged. Emits the resolved
 * schedule (callout + derived dims) as metrics/package data.
 */
export function fastenerGate(part: PlanPart, artifact: FastenerArtifact | null): GateResult {
  const id = `fastener:${part.partId}`;
  const notes: string[] = [
    'annotations/GDTTypes 소비: METRIC_COARSE_PITCHES(ISO 261 표준 피치)·formatThreadCallout(ISO 호칭)',
    'ISO 68-1/724 유도: 유효경 d2=d−0.6495·P·소경(외 d−1.2269·P/내 d−1.0825·P)·탭드릴(내)≈d−P',
    '체결길이=재료별 최소(강 0.8·D 등) 대비 스크리닝(스트립 강도 프록시) — 토크 조인트 FEA 아님·블라인드 홀 깊이 대조는 미기하검증(근사 명시)',
  ];
  const metrics: Record<string, number> = {};

  if (!part.fasteners || part.fasteners.length === 0) {
    return { id, kind: 'fastener', pass: false, metrics, reason: 'fastener gate invoked on a part with no fasteners', notes };
  }
  if (!artifact) {
    return { id, kind: 'fastener', pass: false, metrics, reason: 'fastener resolution produced no schedule (build failed)', notes };
  }

  metrics.fastenerCount = part.fasteners.length;
  metrics.resolvedCount = artifact.records.length;
  metrics.failureCount = artifact.failures.length;
  let minEngagementMarginMm = Infinity;
  for (const r of artifact.records) {
    const margin = r.engagementMm - r.minEngagementMm;
    if (margin < minEngagementMarginMm) minEngagementMarginMm = margin;
  }
  if (Number.isFinite(minEngagementMarginMm)) metrics.minEngagementMarginMm = minEngagementMarginMm;

  const pass = artifact.failures.length === 0;
  return {
    id,
    kind: 'fastener',
    pass,
    metrics,
    ...(pass ? {} : { reason: artifact.failures.join('; ') }),
    notes,
  };
}
