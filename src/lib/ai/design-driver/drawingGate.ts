/**
 * design-driver/drawingGate — gate (d): every planned dimension must REAL-
 * measure ok (and match its expected nominal within 1e-6 when declared).
 *
 * Consumes (수정 없음):
 *   - `standardThreeViewSheet` / `validateSheet` (src/lib/drawing/sheet)
 *     for the sheet IR (front/top/right/iso of the part's primary body;
 *     extra bodies get auxiliary standard viewports appended).
 *   - `buildExtrudeTopo` (src/lib/cad/topoNaming) — the stable-name
 *     topology `Dimension.refs` resolve against. Extrude bodies only:
 *     revolve/sweep/loft bodies have no NamedTopology builder, so dims on
 *     them come back as explicit no-measurement-context failures (근사로
 *     넘어가지 않고 게이트 fail).
 *   - `measureSheetDimension` (src/lib/drawing/associativeUpdate) — the
 *     single resolution rule for a dimension's value; `null` = no
 *     measurement context, `{ok:false}` = ran and refused with reason,
 *     `{ok:true}` = real measured number. Never fabricates.
 *
 * Sheet layout for auxiliary (non-primary) bodies is IR-valid but not
 * visually optimized (viewports may overlap the primary grid) — a WA-D
 * surface concern, recorded as a limitation.
 */

import { buildExtrudeTopo, buildRevolveMeasureTopo, type NamedTopology } from '@/lib/cad/topoNaming';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import {
  paperDimensions,
  standardThreeViewSheet,
  validateSheet,
  type Sheet,
  type Viewport,
} from '@/lib/drawing/sheet';
import { validateDimension, type Dimension } from '@/lib/drawing/dimension';
import { measureSheetDimension } from '@/lib/drawing/associativeUpdate';
import type { MeasureResult } from '@/lib/drawing/measure';
import {
  bodyKey,
  DIMENSION_MATCH_TOL,
  type DesignPlan,
  type GateResult,
  type PlanDimensionSpec,
} from './types';

// ─── artifacts ───────────────────────────────────────────────────────────

export interface PlannedMeasurement {
  spec: PlanDimensionSpec;
  /** Resolved sheet viewport id, or null when no viewport could host it. */
  viewportId: string | null;
  /** measureSheetDimension output (null = no measurement context). Absent
   *  when a structural failure prevented the measurement from running. */
  result: MeasureResult | null;
  /** Pre-measurement structural failure (unknown part/body, bad arity). */
  structural?: string;
}

export interface DrawingArtifact {
  /** partId → sheet IR (dimensions attached). */
  sheets: Map<string, Sheet>;
  /** bodyKey → NamedTopology (extrude bodies only). */
  topologies: Map<string, NamedTopology>;
  measurements: PlannedMeasurement[];
  /** Sheet-construction refusals (SheetValidationError messages). */
  buildErrors: string[];
}

// ─── sheet construction ──────────────────────────────────────────────────

const DEFAULT_PAPER = 'A3' as const;

function auxViewports(
  partId: string,
  bodyId: string,
  extraIndex: number,
  paper: { width: number; height: number },
  scale: number,
): Viewport[] {
  const w = 60;
  const x = Math.min(50 + extraIndex * 110, paper.width - 40);
  const make = (view: 'front' | 'top' | 'right', y: number): Viewport => ({
    id: `${view}@${bodyId}`,
    sourceId: bodyKey(partId, bodyId),
    projection: { kind: 'standard', view },
    centerOnSheet: { x, y: Math.min(y, paper.height - 20) },
    widthOnSheet: w,
    scale,
    label: `${view.toUpperCase()} (${bodyId})`,
  });
  return [make('front', 40), make('top', 90), make('right', 140)];
}

/**
 * Build sheets + topologies + run every planned measurement. Never throws:
 * refusals are captured into `buildErrors` / per-measurement `structural`.
 */
export function buildDrawingArtifact(plan: DesignPlan): DrawingArtifact {
  const topologies = new Map<string, NamedTopology>();
  for (const part of plan.parts) {
    for (const body of part.bodies) {
      // extrude → f.cap/f.side/e.* namespace; revolve → f.lat.{i} rim faces
      // (WB-1, buildRevolveMeasureTopo — the drawn tessellation, so a measured
      // ⌀ is the real rim). loft/sweep still have no builder → explicit gap.
      try {
        if (body.feature.kind === 'extrude') {
          topologies.set(bodyKey(part.partId, body.bodyId), buildExtrudeTopo(body.feature as ExtrudeFeature));
        } else if (body.feature.kind === 'revolve') {
          topologies.set(bodyKey(part.partId, body.bodyId), buildRevolveMeasureTopo(body.feature as RevolveFeature));
        }
      } catch {
        // Degenerate feature — the geometry gate reports the real reason;
        // dims on this body fail as no-measurement-context.
      }
    }
  }

  const sheets = new Map<string, Sheet>();
  const buildErrors: string[] = [];
  const paperSize = plan.drawing.paperSize ?? DEFAULT_PAPER;
  const scale = plan.drawing.scale ?? 1;

  for (const part of plan.parts) {
    if (part.bodies.length === 0) {
      buildErrors.push(`part '${part.partId}' has no bodies — no sheet`);
      continue;
    }
    try {
      const base = standardThreeViewSheet({
        id: `sheet_${part.partId}`,
        name: part.name,
        sourceId: bodyKey(part.partId, part.bodies[0].bodyId),
        paperSize,
        scale,
      });
      const paper = paperDimensions(paperSize);
      const viewports: Viewport[] = [...base.viewports];
      part.bodies.slice(1).forEach((body, i) => {
        viewports.push(...auxViewports(part.partId, body.bodyId, i, paper, scale));
      });
      sheets.set(part.partId, { ...base, viewports });
    } catch (err) {
      buildErrors.push(`part '${part.partId}': sheet construction failed — ${(err as Error).message}`);
    }
  }

  // Attach dimensions + measure.
  const measurements: PlannedMeasurement[] = [];
  const dimsByPart = new Map<string, Dimension[]>();
  for (const spec of plan.drawing.dimensions) {
    const part = plan.parts.find((p) => p.partId === spec.partId);
    if (!part) {
      measurements.push({ spec, viewportId: null, result: null, structural: `unknown partId '${spec.partId}'` });
      continue;
    }
    const body = part.bodies.find((b) => b.bodyId === spec.bodyId);
    if (!body) {
      measurements.push({ spec, viewportId: null, result: null, structural: `part '${spec.partId}' has no body '${spec.bodyId}'` });
      continue;
    }
    const sheet = sheets.get(spec.partId);
    if (!sheet) {
      measurements.push({ spec, viewportId: null, result: null, structural: `no sheet for part '${spec.partId}'` });
      continue;
    }
    const isPrimary = part.bodies[0].bodyId === spec.bodyId;
    const viewportId = isPrimary ? spec.view : `${spec.view}@${spec.bodyId}`;
    const dim: Dimension = {
      id: spec.id,
      viewportId,
      kind: spec.kind,
      refs: spec.refs,
      ...(spec.tolerance ? { tolerance: spec.tolerance } : {}),
    } as Dimension;
    try {
      validateDimension(dim);
    } catch (err) {
      measurements.push({ spec, viewportId, result: null, structural: (err as Error).message });
      continue;
    }
    const list = dimsByPart.get(spec.partId) ?? [];
    list.push(dim);
    dimsByPart.set(spec.partId, list);
    measurements.push({
      spec,
      viewportId,
      // spec.axis(선택)만 측정기로 넘긴다 — 기본은 종전 'auto'(대각이면 정직 실패).
      result: measureSheetDimension(dim, sheet.viewports, topologies, spec.axis ? { axis: spec.axis } : undefined),
    });
  }

  // Finalize sheets with their dimensions (re-validated whole).
  for (const [partId, dims] of dimsByPart) {
    const sheet = sheets.get(partId);
    if (!sheet) continue;
    const withDims: Sheet = { ...sheet, dimensions: dims };
    try {
      validateSheet(withDims);
      sheets.set(partId, withDims);
    } catch (err) {
      buildErrors.push(`part '${partId}': sheet+dimensions invalid — ${(err as Error).message}`);
    }
  }

  return { sheets, topologies, measurements, buildErrors };
}

// ─── gate ────────────────────────────────────────────────────────────────

export function drawingGate(plan: DesignPlan, artifact: DrawingArtifact): GateResult {
  const reasons: string[] = [...artifact.buildErrors];
  const notes: string[] = [
    'measureSheetDimension(drawing/associativeUpdate) 소비 — 표준뷰 + NamedTopology 실측만 값으로 인정, 그 외는 명시 실패',
    'buildExtrudeTopo(cad/topoNaming) 소비 — extrude 바디만 치수 측정 가능(revolve/sweep/loft topo namer 부재 = 명시 공백)',
    '보조(비주요) 바디 뷰포트 배치는 IR 유효성만 보장 — 시각 레이아웃 최적화는 WA-D',
  ];

  let okCount = 0;
  let maxDeviation = 0;
  for (const m of artifact.measurements) {
    const label = `dimension '${m.spec.id}' (${m.spec.kind} on ${m.spec.partId}:${m.spec.bodyId}/${m.spec.view})`;
    if (m.structural) {
      reasons.push(`${label}: ${m.structural}`);
      continue;
    }
    if (m.result === null) {
      reasons.push(
        `${label}: no measurement context — non-standard view or no topology for source (refs ${JSON.stringify(m.spec.refs)})`,
      );
      continue;
    }
    if (!m.result.ok) {
      reasons.push(`${label}: ${m.result.reason} — ${m.result.detail}`);
      continue;
    }
    okCount += 1;
    if (m.spec.expected !== undefined) {
      const dev = Math.abs(m.result.value - m.spec.expected);
      if (dev > maxDeviation) maxDeviation = dev;
      if (dev > DIMENSION_MATCH_TOL) {
        reasons.push(
          `${label}: measured ${m.result.value} ${m.result.unit} deviates from expected ${m.spec.expected} by ${dev} > ${DIMENSION_MATCH_TOL}`,
        );
      }
    }
  }

  return {
    id: 'drawing',
    kind: 'drawing',
    pass: reasons.length === 0,
    metrics: {
      dimensionCount: artifact.measurements.length,
      measuredOkCount: okCount,
      maxExpectedDeviation: maxDeviation,
      matchTol: DIMENSION_MATCH_TOL,
    },
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    notes,
  };
}
