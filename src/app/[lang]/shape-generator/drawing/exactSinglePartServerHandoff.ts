import { createHash } from 'node:crypto';
import {
  serializeAssemblyDrawingHandoff,
  validateAssemblyDrawingHandoff,
  type AssemblyDrawingHandoff,
  type ExactSinglePartDrawingHandoffArtifact,
} from '../assembly/drawingHandoff';
import { detectStepUnits } from '@/lib/brep-bridge/stepRead';
import { featureTreeToOcctPlan } from '@/lib/occt/featurePlan';
import { executeOcctPlan } from '@/lib/occt/planExecutor';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { loadServerReplicad } from '@/lib/occt/serverReplicad';
import { projectReplicadShapeExact } from '@/lib/drawing/replicadExactProjection';
import type { OcctDetailedShapeInspection } from '@/lib/occt/bridge';

const VIEWS = ['front', 'top', 'right'] as const;
const MAX_STEP_BYTES = 4 * 1024 * 1024;
const MAX_SVG_BYTES = 4 * 1024 * 1024;

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

function revisionBoundStepHeader(step: string, createdAt: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)) {
    throw new Error('HANDOFF_CREATED_AT_INVALID');
  }
  const pattern = /(FILE_NAME\(\s*'[^']*'\s*,\s*)'[^']*'/;
  if (!pattern.test(step)) throw new Error('STEP_FILE_NAME_HEADER_MISSING');
  return step
    .replace(pattern, `$1'${createdAt}'`)
    // OCCT appends a process-global write counter to this descriptive PRODUCT
    // label. It is not geometry, but it would otherwise make immutable retries
    // produce different bytes and defeat the revision-bound idempotency key.
    .replaceAll(/'Open CASCADE STEP translator [^']+'/g, "'NexyFab revision-bound solid'");
}

function exactInspectionProblem(detail: OcctDetailedShapeInspection): string | null {
  if (!detail.valid) return 'OCCT_TOPOLOGY_INVALID';
  if (detail.solidCount !== 1) return `OCCT_SOLID_COUNT_${detail.solidCount}`;
  if (!(detail.absoluteVolume > 0) || !Number.isFinite(detail.absoluteVolume)) return 'OCCT_VOLUME_INVALID';
  if (!(detail.surfaceArea > 0) || !Number.isFinite(detail.surfaceArea)) return 'OCCT_SURFACE_AREA_INVALID';
  if (detail.faceCount <= 0 || detail.edgeCount <= 0) return 'OCCT_TOPOLOGY_EMPTY';
  if (detail.faceAdjacency.status !== 'available') return 'OCCT_ADJACENCY_NOT_RUN';
  if (detail.faceAdjacency.boundaryEdgeCount !== 0) return `OCCT_FREE_BOUNDARY_${detail.faceAdjacency.boundaryEdgeCount}`;
  if (detail.faceAdjacency.nonManifoldEdgeCount !== 0) return `OCCT_NON_MANIFOLD_${detail.faceAdjacency.nonManifoldEdgeCount}`;
  return null;
}

function svgEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function pathEscape(value: string): string {
  if (/[^0-9A-Za-z.,+\- eEMmLlHhVvCcSsQqTtAaZz]/.test(value)) {
    throw new Error('HLR_PATH_UNSAFE');
  }
  return value;
}

function combinedSvg(views: ExactSinglePartDrawingHandoffArtifact['drawing']['views'], paths: Array<{ visible: string[]; hidden: string[] }>): string {
  const panels = views.map((view, index) => {
    const visible = paths[index]!.visible.map(d => `<path d="${pathEscape(d)}" fill="none" stroke="#111827" stroke-width="0.55"/>`).join('');
    const hidden = paths[index]!.hidden.map(d => `<path d="${pathEscape(d)}" fill="none" stroke="#64748b" stroke-width="0.3" stroke-dasharray="2 1"/>`).join('');
    return `<g transform="translate(${index * 400} 0)"><text x="12" y="24" font-family="sans-serif" font-size="14">${view.name}</text><svg x="12" y="36" width="376" height="300" viewBox="${svgEscape(view.viewBox)}">${hidden}${visible}</svg></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="350" viewBox="0 0 1200 350"><title>NexyFab revision-bound OCCT HLR</title><rect width="1200" height="350" fill="white"/>${panels.join('')}</svg>\n`;
}

export type ExactSinglePartEnrichmentResult =
  | { status: 'PASS'; handoff: AssemblyDrawingHandoff }
  | { status: 'NOT_RUN'; reason: string; handoff: AssemblyDrawingHandoff }
  | { status: 'INVALID_INPUT'; reason: string; handoff: AssemblyDrawingHandoff };

function notRun(handoff: AssemblyDrawingHandoff, reason: string): ExactSinglePartEnrichmentResult {
  const detail = `Server exact single-part regeneration NOT_RUN: ${reason}`;
  return {
    status: 'NOT_RUN',
    reason,
    handoff: {
      ...handoff,
      exactSinglePart: undefined,
      artifacts: {
        ...handoff.artifacts,
        exactBrepStep: { status: 'NOT_RUN', sha256: null, reason: detail },
        drawing: { status: 'NOT_RUN', sha256: null, reason: detail },
        bom: { status: 'NOT_RUN', sha256: null, reason: detail },
        gdtPmi: { status: 'NOT_RUN', sha256: null, reason: 'GD&T and AP242 PMI were not generated or verified.' },
        manufacturingPackage: { status: 'BLOCKED', sha256: null, reason: 'Manufacturing release is blocked until GD&T/PMI, human approval, and release gates pass.' },
      },
    },
  };
}

export async function enrichServerDrawingHandoffWithExactSinglePart(
  handoff: AssemblyDrawingHandoff,
): Promise<ExactSinglePartEnrichmentResult> {
  if (handoff.exactSinglePart
    || handoff.artifacts.exactBrepStep.status !== 'NOT_RUN'
    || handoff.artifacts.drawing.status !== 'NOT_RUN'
    || handoff.artifacts.bom.status !== 'NOT_RUN') {
    return { status: 'INVALID_INPUT', reason: 'CLIENT_DOWNSTREAM_EVIDENCE_FORBIDDEN', handoff };
  }
  const baseValidation = await validateAssemblyDrawingHandoff(handoff);
  if (!baseValidation.ok) return { status: 'INVALID_INPUT', reason: baseValidation.reason, handoff };
  if (!handoff.source.projectId || handoff.source.workspaceRevision === null
    || !handoff.source.workspaceContentSha256) return notRun(handoff, 'SERVER_REVISION_BINDING_MISSING');
  if (handoff.assembly.state.parts.length !== 1) return notRun(handoff, 'SINGLE_PART_REQUIRED');
  const part = handoff.assembly.state.parts[0]!;
  const tree = handoff.assembly.featureTrees[part.id];
  if (!tree?.nodes.length) return notRun(handoff, 'FEATURE_TREE_MISSING');
  const active = tree.nodes.filter(node => !node.suppressed);
  const consumed = new Set(active.flatMap(node => node.dependencies));
  const terminals = active.filter(node => !consumed.has(node.id));
  let plan;
  try { plan = featureTreeToOcctPlan(tree); }
  catch (error) { return notRun(handoff, `OCCT_PLAN_INVALID:${error instanceof Error ? error.message : String(error)}`); }
  if (!plan.finalResultId || plan.unsupported.length > 0) {
    return notRun(handoff, `OCCT_FEATURE_UNSUPPORTED:${plan.unsupported.map(item => `${item.resultId}:${item.kind}`).join(',') || 'NO_FINAL_SOLID'}`);
  }
  if (terminals.length !== 1 || terminals[0]!.id !== plan.finalResultId) return notRun(handoff, 'ONE_EXPLICIT_TERMINAL_SOLID_REQUIRED');
  if (plan.embeddedChildNodes.length > 0) return notRun(handoff, `EMBEDDED_CHILD_SNAPSHOT_FORBIDDEN:${plan.embeddedChildNodes.join(',')}`);

  const loaded = await loadOcctNode();
  if (!loaded.ok || !loaded.oc) return notRun(handoff, `OCCT_NODE_UNAVAILABLE:${loaded.reason ?? 'unknown'}`);
  const bridge = createNodeOcctBridge(loaded.oc);
  const executed = await executeOcctPlan(plan, bridge);
  if (!executed.ok || !executed.finalShape) return notRun(handoff, `OCCT_EXECUTION_FAILED:${executed.error ?? 'NO_FINAL_SHAPE'}`);
  let imported = undefined as typeof executed.finalShape | undefined;
  try {
    if (!bridge.inspectShapeDetailed) return notRun(handoff, 'OCCT_DETAILED_INSPECTION_UNAVAILABLE');
    const original = await bridge.inspectShapeDetailed(executed.finalShape);
    const originalProblem = exactInspectionProblem(original);
    if (originalProblem) return notRun(handoff, originalProblem);
    const step = revisionBoundStepHeader(await bridge.exportSTEP(executed.finalShape), handoff.createdAt);
    const stepBytes = byteLength(step);
    if (!step.startsWith('ISO-10303-21;') || !step.includes('END-ISO-10303-21;')) return notRun(handoff, 'STEP_ENVELOPE_INVALID');
    if (stepBytes === 0 || stepBytes > MAX_STEP_BYTES) return notRun(handoff, `STEP_SIZE_INVALID:${stepBytes}`);
    const units = detectStepUnits(step);
    if (units.unit !== 'mm' || units.confidence !== 'high') return notRun(handoff, `STEP_EXPLICIT_MM_REQUIRED:${units.unit}:${units.confidence}`);
    const importedResult = await bridge.importSTEP(step);
    if (!importedResult.ok || !importedResult.shape) return notRun(handoff, `STEP_REIMPORT_FAILED:${importedResult.error ?? 'NO_SHAPE'}`);
    imported = importedResult.shape;
    const roundTrip = await bridge.inspectShapeDetailed(imported);
    const roundTripProblem = exactInspectionProblem(roundTrip);
    if (roundTripProblem) return notRun(handoff, `STEP_${roundTripProblem}`);
    const relativeVolumeError = Math.abs(original.absoluteVolume - roundTrip.absoluteVolume)
      / Math.max(Math.abs(original.absoluteVolume), 1e-12);
    if (relativeVolumeError > 1e-9) return notRun(handoff, `STEP_VOLUME_DRIFT:${relativeVolumeError}`);

    const replicad = await loadServerReplicad();
    const drawingShape = await replicad.importSTEP(new Blob([step], { type: 'application/step' })) as { delete?: () => void };
    let drawingSvg: string;
    let views: ExactSinglePartDrawingHandoffArtifact['drawing']['views'];
    try {
      const paths: Array<{ visible: string[]; hidden: string[] }> = [];
      views = VIEWS.map(name => {
        const projection = projectReplicadShapeExact(replicad as never, drawingShape as never, name);
        const visible = projection.visible.toSVGPaths();
        const hidden = projection.hidden.toSVGPaths();
        const viewBox = projection.visible.toSVGViewBox?.(2) ?? '';
        if (visible.length === 0 || !viewBox) throw new Error(`HLR_VIEW_EMPTY:${name}`);
        paths.push({ visible, hidden });
        return { name, visiblePathCount: visible.length, hiddenPathCount: hidden.length, viewBox };
      });
      drawingSvg = combinedSvg(views, paths);
    } finally {
      try { drawingShape.delete?.(); } catch { /* best effort */ }
    }
    const drawingBytes = byteLength(drawingSvg);
    if (drawingBytes === 0 || drawingBytes > MAX_SVG_BYTES) return notRun(handoff, `HLR_SVG_SIZE_INVALID:${drawingBytes}`);
    const bboxMin: [number, number, number] = [original.bbox.min.x, original.bbox.min.y, original.bbox.min.z];
    const bboxMax: [number, number, number] = [original.bbox.max.x, original.bbox.max.y, original.bbox.max.z];
    const overall = { x: bboxMax[0] - bboxMin[0], y: bboxMax[1] - bboxMin[1], z: bboxMax[2] - bboxMin[2] };
    if (!Object.values(overall).every(value => Number.isFinite(value) && value > 0)) return notRun(handoff, 'BBOX_DIMENSIONS_INVALID');
    const dimensionReceipt = serializeAssemblyDrawingHandoff({
      schema: 'nexyfab.overall-dimension-receipt.v1',
      partRevisionId: handoff.source.revisionId,
      partId: part.id,
      sourceStepSha256: sha256(step),
      units: 'mm',
      scope: 'OVERALL_BBOX_ONLY',
      bboxMm: { min: bboxMin, max: bboxMax },
      overall,
    });
    const bomReceipt = serializeAssemblyDrawingHandoff({
      schema: 'nexyfab.single-part-bom-receipt.v1',
      partRevisionId: handoff.source.revisionId,
      sourceStepSha256: sha256(step),
      units: 'mm',
      items: [{ partId: part.id, description: part.name, quantity: 1, dimensionsMm: overall }],
    });
    const exact: ExactSinglePartDrawingHandoffArtifact = {
      schema: 'nexyfab.exact-single-part-drawing-handoff.v1',
      source: {
        handoffId: handoff.handoffId,
        revisionId: handoff.source.revisionId,
        projectId: handoff.source.projectId,
        workspaceRevision: handoff.source.workspaceRevision,
        workspaceContentSha256: handoff.source.workspaceContentSha256,
        stateSha256: handoff.source.stateSha256,
        featureTreesSha256: handoff.source.featureTreesSha256,
        partFeatureTreeSha256: sha256(serializeAssemblyDrawingHandoff(tree)),
      },
      part: { id: part.id, name: part.name, quantity: 1 },
      step: { text: step, sha256: sha256(step), bytes: stepBytes, units: 'mm' },
      verification: {
        kernel: 'OCCT_NODE', valid: true, solidCount: 1,
        faceCount: original.faceCount, edgeCount: original.edgeCount,
        volumeMm3: original.absoluteVolume, surfaceAreaMm2: original.surfaceArea,
        bboxMm: { min: bboxMin, max: bboxMax },
        stepRoundTripVolumeMm3: roundTrip.absoluteVolume,
        stepRoundTripVolumeRelError: relativeVolumeError,
        freeBoundaryEdgeCount: 0, nonManifoldEdgeCount: 0,
      },
      drawing: { method: 'OCCT_HLR', svg: drawingSvg, sha256: sha256(drawingSvg), bytes: drawingBytes, views },
      dimensions: {
        receiptJson: dimensionReceipt, sha256: sha256(dimensionReceipt), bytes: byteLength(dimensionReceipt),
        units: 'mm', overall, scope: 'OVERALL_BBOX_ONLY',
      },
      bom: {
        receiptJson: bomReceipt, sha256: sha256(bomReceipt), bytes: byteLength(bomReceipt), itemCount: 1, totalQuantity: 1,
      },
      claimBoundary: {
        drawingDimensions: 'OVERALL_BBOX_ONLY', gdt: 'NOT_RUN', pmi: 'NOT_RUN',
        humanApproval: 'NOT_RUN', manufacturingRelease: 'BLOCKED',
      },
    };
    const enriched: AssemblyDrawingHandoff = {
      ...handoff,
      exactSinglePart: exact,
      artifacts: {
        ...handoff.artifacts,
        exactBrepStep: { status: 'PASS', sha256: exact.step.sha256, reason: 'Server OCCT regenerated, exported, and re-imported one valid solid in explicit millimetres.' },
        drawing: { status: 'PASS', sha256: exact.drawing.sha256, reason: 'Server OCCT HLR produced non-empty front, top, and right views bound to the exact STEP.' },
        bom: { status: 'PASS', sha256: exact.bom.sha256, reason: 'One-part quantity and overall bbox dimensions are byte-bound to this revision.' },
        gdtPmi: { status: 'NOT_RUN', sha256: null, reason: 'No verified GD&T or AP242 PMI evidence exists for this revision.' },
        manufacturingPackage: { status: 'BLOCKED', sha256: null, reason: 'Manufacturing release remains blocked pending GD&T/PMI, human approval, and release decision.' },
      },
    };
    const validation = await validateAssemblyDrawingHandoff(enriched);
    return validation.ok
      ? { status: 'PASS', handoff: validation.handoff }
      : notRun(handoff, `ENRICHED_HANDOFF_INVALID:${validation.reason}`);
  } catch (error) {
    return notRun(handoff, error instanceof Error ? error.message : String(error));
  } finally {
    if (imported) bridge.release(imported);
    bridge.release(executed.finalShape);
  }
}
