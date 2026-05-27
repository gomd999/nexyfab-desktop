/**
 * coolingInterferenceCheck.ts — Detect interference between cooling
 * channels and other mold features (cavities, ejector pins, slides).
 *
 * Cooling channels can cross paths with:
 *
 *   - Cavity walls (must stay back ≥ 1.5·D).
 *   - Ejector pins (no crossing allowed).
 *   - Other cooling channels (≥ 1·D spacing).
 *   - Mold base bolts.
 *
 * Module:
 *   - AABB / line-segment vs cylinder collision tests.
 *   - Reports each interference + clearance violation.
 *   - Suggests routing alternatives.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface CoolingChannel {
  id: string;
  start: Vec3;
  end: Vec3;
  diameterMm: number;
}

export interface SolidFeature {
  id: string;
  /** Cylinder centre line. */
  centreLineStart: Vec3;
  centreLineEnd: Vec3;
  radiusMm: number;
  /** Kind tags for severity. */
  kind: 'cavity' | 'ejector-pin' | 'cooling-channel' | 'bolt';
}

export interface InterferenceOptions {
  /** Distance from channel surface to cavity surface (mm) — typical 1.5·D. */
  cavityClearanceMm: number;
  /** Minimum spacing between cooling channels (mm). */
  channelChannelMinMm: number;
}

export const DEFAULT_OPTIONS: InterferenceOptions = {
  cavityClearanceMm: 15,
  channelChannelMinMm: 10,
};

export type Severity = 'critical' | 'warn' | 'info';

export interface Interference {
  channelId: string;
  featureId: string;
  featureKind: SolidFeature['kind'];
  minDistanceMm: number;
  severity: Severity;
  recommendation: string;
}

export interface CheckResult {
  interferences: Interference[];
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function checkInterferences(
  channels: CoolingChannel[],
  features: SolidFeature[],
  options: Partial<InterferenceOptions> = {},
): CheckResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const interferences: Interference[] = [];
  const warnings: string[] = [];

  // Channel-to-feature.
  for (const ch of channels) {
    for (const f of features) {
      const dist = lineToLineDistance(ch.start, ch.end, f.centreLineStart, f.centreLineEnd);
      const surfaceDist = dist - ch.diameterMm / 2 - f.radiusMm;
      const required = requiredClearance(f.kind, opts, ch.diameterMm);
      if (surfaceDist < required) {
        interferences.push({
          channelId: ch.id,
          featureId: f.id,
          featureKind: f.kind,
          minDistanceMm: surfaceDist,
          severity: classifySeverity(f.kind, surfaceDist, required),
          recommendation: buildRecommendation(f.kind, ch.id, surfaceDist, required),
        });
      }
    }
  }

  // Channel-to-channel.
  for (let i = 0; i < channels.length; i++) {
    for (let j = i + 1; j < channels.length; j++) {
      const a = channels[i]!;
      const b = channels[j]!;
      const dist = lineToLineDistance(a.start, a.end, b.start, b.end);
      const surfaceDist = dist - a.diameterMm / 2 - b.diameterMm / 2;
      if (surfaceDist < opts.channelChannelMinMm) {
        interferences.push({
          channelId: a.id,
          featureId: b.id,
          featureKind: 'cooling-channel',
          minDistanceMm: surfaceDist,
          severity: 'critical',
          recommendation: `Re-route channel ${a.id} or ${b.id} to maintain ≥${opts.channelChannelMinMm} mm.`,
        });
      }
    }
  }

  return { interferences, warnings };
}

// ── Distance helpers ─────────────────────────────────────────

function lineToLineDistance(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): number {
  const u = sub(a1, a0);
  const v = sub(b1, b0);
  const w = sub(a0, b0);
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w);
  const e = dot(v, w);
  const D = a * c - b * b;
  let sc: number, tc: number;
  if (D < 1e-9) {
    sc = 0;
    tc = b > c ? d / b : e / c;
  } else {
    sc = (b * e - c * d) / D;
    tc = (a * e - b * d) / D;
  }
  sc = Math.max(0, Math.min(1, sc));
  tc = Math.max(0, Math.min(1, tc));
  const cp = sub(add(a0, mul(u, sc)), add(b0, mul(v, tc)));
  return Math.hypot(cp.x, cp.y, cp.z);
}

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function mul(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }

function requiredClearance(kind: SolidFeature['kind'], opts: InterferenceOptions, channelDia: number): number {
  switch (kind) {
    case 'cavity': return opts.cavityClearanceMm;
    case 'ejector-pin': return channelDia;
    case 'cooling-channel': return opts.channelChannelMinMm;
    case 'bolt': return 2;
  }
}

function classifySeverity(kind: SolidFeature['kind'], dist: number, required: number): Severity {
  if (dist < 0) return 'critical';
  if (kind === 'cavity' && dist < required) return 'critical';
  if (dist < required * 0.5) return 'critical';
  return 'warn';
}

function buildRecommendation(kind: SolidFeature['kind'], channelId: string, dist: number, required: number): string {
  const gap = required - dist;
  switch (kind) {
    case 'cavity':
      return `Channel ${channelId} ${gap.toFixed(2)} mm too close to cavity; route deeper or relocate.`;
    case 'ejector-pin':
      return `Channel ${channelId} interferes with ejector pin; relocate channel.`;
    case 'cooling-channel':
      return `Channel ${channelId} too close to other channel.`;
    case 'bolt':
      return `Channel ${channelId} crosses bolt hole; move pin or channel.`;
  }
}

// ── Aggregate ────────────────────────────────────────────────

export interface InterferenceStats {
  totalCount: number;
  criticalCount: number;
  byFeatureKind: Record<SolidFeature['kind'], number>;
}

export function aggregate(result: CheckResult): InterferenceStats {
  const byKind: Record<SolidFeature['kind'], number> = { cavity: 0, 'ejector-pin': 0, 'cooling-channel': 0, bolt: 0 };
  let critical = 0;
  for (const i of result.interferences) {
    byKind[i.featureKind]++;
    if (i.severity === 'critical') critical++;
  }
  return { totalCount: result.interferences.length, criticalCount: critical, byFeatureKind: byKind };
}

// ── Summary ────────────────────────────────────────────────────

export interface CheckSummary {
  interferenceCount: number;
  criticalCount: number;
  warningCount: number;
}

export function summarize(result: CheckResult): CheckSummary {
  const agg = aggregate(result);
  return {
    interferenceCount: result.interferences.length,
    criticalCount: agg.criticalCount,
    warningCount: result.warnings.length,
  };
}
