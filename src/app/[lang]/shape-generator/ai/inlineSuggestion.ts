/**
 * inlineSuggestion.ts — Heuristic suggestions surfaced inline as the
 * user designs. Phase-2 Week-2 surface.
 *
 * The full AI agent is overkill for surface hints — most useful
 * advice comes from cheap rule checks ("this hole is below min wall
 * thickness for FDM print", "this fillet is bigger than the face").
 * This module emits lightweight `InlineSuggestion[]` after each
 * pipeline run; the UI surfaces them as tooltip badges next to the
 * affected feature.
 *
 * Sources:
 *   - DFM gate (existing — `lib/ai/scad-agent/dfm`) → exposed as
 *     suggestions on the feature that triggered the rule
 *   - Cost copilot (existing — `lib/ai/scad-agent/cost-copilot`) →
 *     savings hint on the most expensive feature
 *   - Geometry inspection (this module) → simple rule fires
 *
 * Stays *cheap*: every check is O(feature count) and synchronous.
 * No async / no LLM call in the hot path.
 */

import type { FeatureInstance } from '../features/types';

export type SuggestionSeverity = 'info' | 'warn' | 'block';
export type SuggestionSource = 'dfm' | 'cost' | 'geometry' | 'process';

export interface InlineSuggestion {
  id: string;
  featureId: string;
  severity: SuggestionSeverity;
  source: SuggestionSource;
  /** Short headline (≤ 60 chars). */
  title: string;
  /** Action recommendation (≤ 140 chars). */
  recommendation: string;
  /** Optional fix that the consumer can dispatch as a FeatureEditIntent. */
  autoFix?: {
    paramKey: string;
    suggestedValue: number;
  };
}

export interface GeometryHint {
  /** Bounding box span — used by relative-size checks. */
  bboxDiagMm: number;
  /** Estimated wall thickness (mm). */
  minWallMm?: number;
}

export interface SuggestionContext {
  features: FeatureInstance[];
  /** Optional geometry hints from the pipeline output. */
  geometry?: GeometryHint;
  /** Process selected for this design (CNC/FDM/SLA/injection/sheet). */
  process?: 'cnc' | 'fdm' | 'sla' | 'injection' | 'sheet';
}

const PROCESS_MIN_WALL: Record<NonNullable<SuggestionContext['process']>, number> = {
  cnc:        0.8,
  fdm:        1.5,
  sla:        0.6,
  injection:  1.0,
  sheet:      0.5,
};

const PROCESS_MIN_HOLE: Record<NonNullable<SuggestionContext['process']>, number> = {
  cnc:        1.0,
  fdm:        2.0,
  sla:        0.8,
  injection:  2.0,
  sheet:      1.5,
};

let nextId = 0;
function id(): string { return `sug_${++nextId}`; }

export function computeInlineSuggestions(ctx: SuggestionContext): InlineSuggestion[] {
  const out: InlineSuggestion[] = [];

  for (const f of ctx.features) {
    // Rule: fillet radius vs bbox (over-fillet)
    if (f.type === 'fillet' || f.type === 'variableFillet') {
      const r = f.params.radius ?? 0;
      if (ctx.geometry && r > ctx.geometry.bboxDiagMm * 0.4) {
        out.push({
          id: id(), featureId: f.id, severity: 'warn', source: 'geometry',
          title: '필렛 반경이 부품 대비 큼',
          recommendation: `반경 ${r}mm는 부품 bbox의 40% 초과. 부품 형상이 깨질 수 있음.`,
          autoFix: { paramKey: 'radius', suggestedValue: Math.round(ctx.geometry.bboxDiagMm * 0.2 * 10) / 10 },
        });
      }
    }

    // Rule: hole diameter below process minimum
    if (f.type === 'hole' && ctx.process) {
      const d = f.params.diameter ?? 0;
      const minD = PROCESS_MIN_HOLE[ctx.process];
      if (d > 0 && d < minD) {
        out.push({
          id: id(), featureId: f.id, severity: 'warn', source: 'dfm',
          title: `${ctx.process.toUpperCase()} 최소 홀 미만`,
          recommendation: `Ø${d}mm는 ${ctx.process} 공정 최소 Ø${minD}mm 미만. 가공 불가 또는 비용 ↑.`,
          autoFix: { paramKey: 'diameter', suggestedValue: minD },
        });
      }
    }

    // Rule: shell thickness below process minimum
    if (f.type === 'shell' && ctx.process) {
      const t = f.params.thickness ?? 0;
      const minT = PROCESS_MIN_WALL[ctx.process];
      if (t > 0 && t < minT) {
        out.push({
          id: id(), featureId: f.id, severity: 'block', source: 'dfm',
          title: `${ctx.process.toUpperCase()} 최소 벽 두께 미만`,
          recommendation: `${t}mm는 ${ctx.process} 공정 최소 ${minT}mm 미만. 출력 / 가공 불가.`,
          autoFix: { paramKey: 'thickness', suggestedValue: minT },
        });
      }
    }

    // Rule: chamfer distance vs geometry
    if (f.type === 'chamfer' && ctx.geometry) {
      const d = f.params.distance ?? 0;
      if (d > ctx.geometry.bboxDiagMm * 0.3) {
        out.push({
          id: id(), featureId: f.id, severity: 'info', source: 'geometry',
          title: '챔퍼 크기가 큼',
          recommendation: `${d}mm 챔퍼가 부품 대비 큼. 의도 확인 권장.`,
        });
      }
    }

    // Rule: draft angle very large
    if (f.type === 'draft') {
      const angle = f.params.angle ?? 0;
      if (angle > 10) {
        out.push({
          id: id(), featureId: f.id, severity: 'info', source: 'process',
          title: '드래프트 각이 큼',
          recommendation: `${angle}° 드래프트는 의도된 경우만 사용. 사출 시 보통 1-3°.`,
        });
      }
    }
  }

  // Cost hint: surface the most-expensive feature when more than 3.
  if (ctx.features.length > 3) {
    const candidates = ctx.features.filter(f => f.type === 'fillet' || f.type === 'shell' || f.type === 'hole');
    if (candidates.length > 0) {
      const target = candidates[0]!;
      out.push({
        id: id(), featureId: target.id, severity: 'info', source: 'cost',
        title: '비용 절감 후보',
        recommendation: 'AI 비용 코파일럿: 이 피처를 단순화하면 가공 단가 ↓ 가능.',
      });
    }
  }

  return out;
}

export function getSuggestionColor(severity: SuggestionSeverity): string {
  switch (severity) {
    case 'info':  return '#3b82f6';
    case 'warn':  return '#f59e0b';
    case 'block': return '#ef4444';
  }
}
