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
import type { HoleSpec as SheetHoleSpec } from '@/lib/drawing/holeTable';
import { measureSheetDimension } from '@/lib/drawing/associativeUpdate';
import { describeRefSpan, refSpanLine } from './refGeometry';
import { derivationLine, derivedDimensionMm } from './volumeDecomposition';
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
      // WB-9: 구멍 일람표를 시트에 싣는다. 도면 계층엔 이미 holeTable(태그 A1·데이텀
      // 상대좌표·⌀·THRU/↧깊이·동일치수 그룹핑) 렌더러가 있으므로 **선언을 그 IR로 옮기기만**
      // 하면 된다 — featureMesh에 내부 루프를 넣는 공사(ADR-017 면 이름·매니폴드 전제를
      // 건드림)를 하지 않고도 shop이 쓰는 표가 도면에 실린다.
      // 검증 관계: 이 표는 선언에서 만들지만, 패키지는 hole 게이트가 통과해야만 산출된다
      // (커널이 그 지름/깊이만큼 실제로 깎았음을 부피로 확인). 즉 "그려졌는데 검증 안 된"
      // 구멍은 패키지에 존재할 수 없다. 다만 **중심 좌표는 선언값**이라는 한계는 그대로다.
      // 사각 컷아웃은 ⌀ 개념이 없어 이 표에 넣지 않는다(패키지의 schedule에는 실려 있다).
      const roundHoles = (part.holes ?? []).filter((h) => h.shape !== 'rect');
      const holeRows: SheetHoleSpec[] = roundHoles.map((h) => ({
        id: h.id,
        x: h.at.x,
        y: h.at.y,
        diameter: h.diameterMm as number,
        ...(h.kind === 'blind' && h.depthMm !== undefined ? { depth: h.depthMm } : {}),
      }));
      // 260728: 표에 더해 **뷰 안에도** 구멍 원을 그린다. 260727 §5-5 는 이것을 featureMesh
      // 내부 루프 공사로 보고 사용자 결정으로 남겼는데, 실제로는 메시가 필요 없다 —
      // 지름·존재·(블라인드) 깊이는 hole 게이트가 커널 부피로 **이미 검증**했고, 검증된 값을
      // 도면에 표기하는 데에는 투영 기하가 필요하지 않다. 주석 레이어로 내면 ADR-017 면
      // 이름·매니폴드 전제·expectedVolume gross 계약을 전부 건드리지 않는다.
      //
      // 'top' 뷰에만 붙인다: extrude 프로파일 루프는 XY 평면에 있고 top = X×Y 이므로
      // 구멍 중심 (x,y)가 그대로 보이는 유일한 표준 뷰다(front 는 Y, right 는 X 가 소멸).
      // 사각 컷아웃은 원이 아니므로 제외(표와 같은 기준).
      const holeMarks = roundHoles.map((h) => ({
        viewportId: 'top',
        xMm: h.at.x,
        yMm: h.at.y,
        diameterMm: h.diameterMm as number,
        tag: h.id,
      }));
      sheets.set(part.partId, {
        ...base, viewports,
        ...(holeRows.length ? { holes: holeRows } : {}),
        ...(holeMarks.length ? { holeMarks } : {}),
      });
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
    // 약속의 산술은 엔진이 한다 — 모델이 틀리는 부분이 정확히 이것이다(260728, §6-1 의 치수 판).
    // 항은 브리프 치수에서 오므로 measured 와 여전히 독립이다.
    let authority = m.spec.expected;
    if (m.spec.expectedFrom) {
      let computed: number;
      try {
        computed = derivedDimensionMm(m.spec.expectedFrom);
      } catch (e) {
        reasons.push(`${label}: expectedFrom invalid — ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      notes.push(`${m.spec.id}: ${derivationLine(m.spec.expectedFrom)}`);
      // 모델이 숫자도 함께 적었다면 자기 유도식과 맞는지 본다. 산술 오류는 측정 불일치와
      // **다른 문장**으로 보고한다 — 섞으면 어디를 고쳐야 하는지 알 수 없다(§6-1 과 동일).
      if (m.spec.expected !== undefined && Math.abs(m.spec.expected - computed) > DIMENSION_MATCH_TOL) {
        reasons.push(
          `${label}: expected ${m.spec.expected} disagrees with your own expectedFrom (${computed}) — ` +
            `arithmetic error in the stated promise, not a measurement disagreement ` +
            `(the geometry was not consulted for either number)`,
        );
        continue;
      }
      authority = computed;
    }
    if (authority !== undefined) {
      const dev = Math.abs(m.result.value - authority);
      if (dev > maxDeviation) maxDeviation = dev;
      if (dev > DIMENSION_MATCH_TOL) {
        // 숫자만 말하지 않는다 — 고른 두 ref 가 **실제로** 어떻게 떨어져 있는지 함께 말한다
        // (260728 §7-1). 실측(bench v1)에서 L-브래킷이 3회 전부 이 실패를 냈고 원인은 값이
        // 아니라 ref 선택이었다: 40 을 재려다 벽두께 8 을 가르는 쌍을 골랐다. 게이트가
        // 아는 것을 침묵할 이유가 없다.
        // ⚠ 어떤 ref 를 골랐어야 하는지는 **제안하지 않는다** — 숫자를 맞추려고 의미가 다른
        //   엣지를 고르게 만들면 게이트는 통과하고 도면은 틀린다(§6-1 과 같은 종류의 자기충족).
        let span = '';
        if (m.spec.refs.length === 2) {
          const topo = artifact.topologies.get(bodyKey(m.spec.partId, m.spec.bodyId));
          const rep = topo ? describeRefSpan(topo, m.spec.view, m.spec.refs[0]!, m.spec.refs[1]!) : null;
          if (rep) span = ` — ${refSpanLine(m.spec.refs[0]!, m.spec.refs[1]!, m.spec.view, rep)}`;
        }
        reasons.push(
          `${label}: measured ${m.result.value} ${m.result.unit} deviates from expected ${authority} by ${dev} > ${DIMENSION_MATCH_TOL}${span}`,
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
