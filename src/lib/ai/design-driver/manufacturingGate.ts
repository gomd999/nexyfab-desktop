/**
 * design-driver/manufacturingGate — gate (c): DFM screening.
 *
 * Consumption vs self-implementation (보고 의무 — 명세):
 *
 *   CONSUMED — `runDfmGate` (src/lib/ai/scad-agent/dfmGate): executed on a
 *   box-shaped `IntentInput` derived from the part's MEASURED composite
 *   AABB (width/depth/height from the real mesh, not from claims). This
 *   reuses dfmGate's per-process aspect-ratio rule + severity semantics
 *   (manufacturable ⇔ no error-severity issues). dfmGate's wall/hole/draft
 *   checks need intent features our feature-IR parts don't carry, so they
 *   are inert on this input — stated, not hidden.
 *
 *   SELF-IMPLEMENTED — minimum-thickness screening: the part's smallest
 *   AABB dimension must be ≥ the process minimum wall. The limits MIRROR
 *   dfmGate's documented `minWall` table (FDM 0.8 / SLA 0.4 / CNC 1.0 /
 *   injection 0.8 / sheet metal 0.5 mm — dfmGate.ts rule sources); they
 *   are duplicated here because dfmGate does not export its LIMITS table
 *   and the module is consume-only for WA-A.
 *
 * 근사 명시: the AABB minimum dimension is a SCREENING PROXY for wall
 * thickness — it catches globally-thin parts but NOT thin internal ribs /
 * local walls inside a larger bounding box. True local-thickness analysis
 * (medial axis / ray casting) is out of WA-A scope and is recorded as a
 * limitation in the verification report.
 */

import { runDfmGate, type DfmProcess } from '@/lib/ai/scad-agent/dfmGate';
import type { IntentInput } from '@/lib/openscad-render/intentToScad';
import type { PartGeometry } from './geometryGate';
import type { GateResult, PlanPart } from './types';

/** Mirrors dfmGate.ts LIMITS.minWall (table not exported there). */
const MIN_THICKNESS_MM: Record<DfmProcess, number> = {
  fdm: 0.8,
  sla: 0.4,
  cnc: 1.0,
  injection: 0.8,
  sheetMetal: 0.5,
};

export function manufacturingGate(part: PlanPart, geo: PartGeometry): GateResult {
  const process: DfmProcess = part.process ?? 'cnc';
  const reasons: string[] = [];
  const notes: string[] = [
    `runDfmGate(scad-agent) 소비: 실측 AABB→box 인텐트로 종횡비 규칙 실행(프로세스 '${process}')`,
    '최소두께=자체 스크리닝(AABB 최소 치수 ≥ 공정 minWall) — 내부 리브/국부 벽두께 미검출(근사 명시)',
  ];
  const metrics: Record<string, number> = {};

  if (!geo.bbox) {
    return {
      id: `dfm:${part.partId}`,
      kind: 'dfm',
      pass: false,
      metrics,
      reason: 'no meshed geometry — DFM screening requires a built mesh (geometry gate failed upstream)',
      notes,
    };
  }

  const dx = geo.bbox.max[0] - geo.bbox.min[0];
  const dy = geo.bbox.max[1] - geo.bbox.min[1];
  const dz = geo.bbox.max[2] - geo.bbox.min[2];
  const minDim = Math.min(dx, dy, dz);
  const maxDim = Math.max(dx, dy, dz);
  metrics.bboxXMm = dx;
  metrics.bboxYMm = dy;
  metrics.bboxZMm = dz;
  metrics.minDimMm = minDim;
  metrics.aspectRatio = minDim > 0 ? maxDim / minDim : Infinity;

  // ── consumed: dfmGate on the measured-AABB box intent ──────────────────
  const intent: IntentInput = {
    shapeId: 'box',
    params: { width_mm: dx, depth_mm: dy, height_mm: dz },
  };
  const report = runDfmGate(intent, process);
  metrics.dfmErrorCount = report.issues.filter((i) => i.severity === 'error').length;
  metrics.dfmWarningCount = report.issues.filter((i) => i.severity === 'warning').length;
  if (!report.manufacturable) {
    for (const issue of report.issues) {
      if (issue.severity === 'error') reasons.push(`dfmGate ${issue.code}: ${issue.message}`);
    }
  }
  for (const issue of report.issues) {
    if (issue.severity === 'warning') notes.push(`dfmGate warning ${issue.code}: ${issue.message}`);
  }

  // ── self-implemented: minimum-thickness screening proxy ────────────────
  const minThickness = MIN_THICKNESS_MM[process];
  metrics.minThicknessLimitMm = minThickness;
  if (minDim < minThickness) {
    reasons.push(
      `AABB minimum dimension ${minDim} mm < ${process} minimum wall ${minThickness} mm (스크리닝 프록시)`,
    );
  }

  return {
    id: `dfm:${part.partId}`,
    kind: 'dfm',
    pass: reasons.length === 0,
    metrics,
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    notes,
  };
}
