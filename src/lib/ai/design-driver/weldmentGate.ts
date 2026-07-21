/**
 * design-driver/weldmentGate — WB-3: 웰드먼트 컷리스트 게이트 (structural frame).
 *
 * Consumption vs self-implementation (보고 의무 — 명세):
 *
 *   CONSUMED — the REAL weldment engine (welding/miterFrame + welding/
 *   cutListReport): `sectionPolygons` builds the analytic section, `computeFrameCuts`
 *   derives the angle-bisector miter plane at every 2-member corner, and
 *   `measureMember` REAL-measures each member's stock cut length (longest fibre
 *   after miters) + end-miter angles off the mitered solid. `generateCutList`
 *   aggregates them into the shop cut list (mass = linear density × length).
 *
 *   SELF-IMPLEMENTED — the gate verdict: a fabricability block on any degenerate
 *   member (zero/over-cut length) and an optional total-stock cross-check against
 *   the plan's independent hand-calc (|measured − expected| ≤ tol).
 *
 * 근사 명시 (miterFrame 문서와 동일): round sections tessellate as N-gons
 * (area/volume ≈ 0.3% below the true circle); corners with 3+ incident members
 * fall back to square butt cuts; steel density 7850 kg/m³ for linear mass.
 *
 * The weldment part's `bodies[0]` is a simple representative-stock prism meshed
 * and dimensioned by the geometry/drawing gates as usual; this gate is the
 * ADDITIONAL cut-list verification + deliverable.
 */

import {
  sectionPolygons,
  computeFrameCuts,
  measureMember,
  type FrameSegment,
  type MemberSpec,
  type SegmentCuts,
} from '@/app/[lang]/shape-generator/welding/miterFrame';
import {
  generateCutList,
  type StructuralMember as CutListMember,
} from '@/app/[lang]/shape-generator/welding/cutListReport';
import type { GateResult, PlanPart, WeldmentCutRow, WeldmentSpec } from './types';

const DEFAULT_STOCK_TOL_MM = 1e-6;
const STEEL_DENSITY_KG_M3 = 7850;

export interface WeldmentArtifact {
  members: WeldmentCutRow[];
  totalStockMm: number;
  totalMassKg: number;
  material: string;
  entryCount: number;
  sectionLabel: string;
  /** Shortest member cut length, mm — ≤ 0 signals a degenerate/over-cut member. */
  minCutLengthMm: number;
  /** True when the section is round (tessellated N-gon area, 근사 명시). */
  roundTessellated: boolean;
}

/**
 * Miter the frame and REAL-measure the cut list. Returns null when the part
 * carries no weldment spec. Never throws for well-formed segments.
 */
export function buildWeldmentArtifact(part: PlanPart): WeldmentArtifact | null {
  const spec = part.weldment;
  if (!spec) return null;

  const material = spec.material ?? 'SS400';
  const section = sectionPolygons(spec.sectionType, spec.sizeMm, spec.thicknessMm);
  const segments: FrameSegment[] = spec.segments.map((s) => ({ start: s.start, end: s.end }));
  const miter = spec.miter !== false;
  const cuts: SegmentCuts[] = miter ? computeFrameCuts(segments) : segments.map(() => ({}));

  const members: WeldmentCutRow[] = [];
  const cutMembers: CutListMember[] = [];
  let minCutLengthMm = Infinity;

  segments.forEach((seg, i) => {
    const mspec: MemberSpec = {
      start: seg.start,
      end: seg.end,
      section,
      startCut: cuts[i]?.startCut,
      endCut: cuts[i]?.endCut,
    };
    const m = measureMember(mspec);
    minCutLengthMm = Math.min(minCutLengthMm, m.cutLengthMm);
    members.push({
      memberIndex: i,
      profile: section.label,
      cutLengthMm: m.cutLengthMm,
      axisLengthMm: m.axisLengthMm,
      startMiterDeg: m.startMiterDeg,
      endMiterDeg: m.endMiterDeg,
    });
    cutMembers.push({
      id: `M${i + 1}`,
      profile: section.label,
      material,
      lengthMm: m.cutLengthMm,
      linearDensityKgPerM: section.areaMm2 * 1e-6 * STEEL_DENSITY_KG_M3,
      endMiterDeg: { start: m.startMiterDeg, end: m.endMiterDeg },
    });
  });

  const cutList = generateCutList(cutMembers);

  return {
    members,
    totalStockMm: cutList.rawLengthMm,
    totalMassKg: cutList.totalMassKg,
    material,
    entryCount: cutList.entries.length,
    sectionLabel: section.label,
    minCutLengthMm: members.length > 0 ? minCutLengthMm : 0,
    roundTessellated: spec.sectionType === 3 || spec.sectionType === 4,
  };
}

/**
 * Weldment cut-list gate. Fails (패키지 미산출) when:
 *   - the spec is present but no artifact could be built, or
 *   - the frame has no valid members / a member is degenerate (cut length ≤ 0 —
 *     coincident endpoints or an over-cut miter), or
 *   - the total stock length disagrees with the plan's independent hand-calc.
 * Cut-list numbers are the engine's real measurements, restated as metrics.
 */
export function weldmentGate(part: PlanPart, artifact: WeldmentArtifact | null): GateResult {
  const id = `weldment:${part.partId}`;
  const spec = part.weldment as WeldmentSpec | undefined;
  const notes: string[] = [
    'welding/miterFrame+cutListReport 소비: sectionPolygons→computeFrameCuts(2부재 코너 이등분 마이터)→measureMember 실측(스톡 컷길이=마이터 후 최장 섬유)→generateCutList 집계',
    '근사 명시: 원형 단면=N각형 테셀(면적 ≈0.3%↓)·3부재+ 코너=사각 버트컷·강재 밀도 7850 kg/m³',
  ];
  const metrics: Record<string, number> = {};

  if (!spec) {
    return { id, kind: 'weldment', pass: false, metrics, reason: 'weldment gate invoked on a non-weldment part', notes };
  }
  if (!artifact) {
    return { id, kind: 'weldment', pass: false, metrics, reason: 'weldment frame produced no cut list (build failed)', notes };
  }

  metrics.memberCount = artifact.members.length;
  metrics.totalStockMm = artifact.totalStockMm;
  metrics.totalMassKg = artifact.totalMassKg;
  metrics.cutListLineCount = artifact.entryCount;
  metrics.minCutLengthMm = artifact.minCutLengthMm;
  if (artifact.roundTessellated) {
    notes.push('원형 단면 테셀레이션 — 단면적/질량은 N각형 근사(진원 대비 ≈0.3% 미만)');
  }

  const reasons: string[] = [];
  if (artifact.members.length === 0) {
    reasons.push('frame has no members (all segments degenerate)');
  } else if (!Number.isFinite(artifact.minCutLengthMm) || artifact.minCutLengthMm <= 1e-9) {
    reasons.push(`a member has non-positive/degenerate cut length ${artifact.minCutLengthMm} mm (coincident endpoints or over-cut miter)`);
  }

  if (spec.expectedTotalStockMm !== undefined) {
    const tol = spec.stockTolMm ?? DEFAULT_STOCK_TOL_MM;
    const deviation = Math.abs(artifact.totalStockMm - spec.expectedTotalStockMm);
    metrics.expectedTotalStockMm = spec.expectedTotalStockMm;
    metrics.totalStockDeviationMm = deviation;
    if (deviation > tol) {
      reasons.push(
        `total stock ${artifact.totalStockMm.toFixed(4)} mm deviates from expected ` +
          `${spec.expectedTotalStockMm} mm by ${deviation.toFixed(4)} mm (> tol ${tol})`,
      );
    }
  }

  return {
    id,
    kind: 'weldment',
    pass: reasons.length === 0,
    metrics,
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    notes,
  };
}
