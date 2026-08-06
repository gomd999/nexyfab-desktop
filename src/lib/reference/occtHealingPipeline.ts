import type { OcctBridge, OcctDetailedShapeInspection } from '@/lib/occt/bridge';
import type { OcctShape } from '@/lib/occt/types';
import { evaluateCadHealing, type CadHealingDecision, type CadHealingMeasurement } from './cadHealingPolicy';

export interface OcctHealingResult {
  status: 'not_required' | 'recovered' | 'rejected' | 'not_run';
  shape: OcctShape;
  detail: OcctDetailedShapeInspection;
  before: CadHealingMeasurement;
  after?: CadHealingMeasurement;
  decision?: CadHealingDecision;
  reason?: string;
  /** Healing may split/merge subshapes. Old face/edge references must not be reused until reconciled. */
  topologyReferenceStatus: 'preserved_original' | 'requires_remap';
}

function measurement(detail: OcctDetailedShapeInspection): CadHealingMeasurement {
  return {
    valid: detail.valid, solidCount: detail.solidCount, absoluteVolume: detail.absoluteVolume,
    faceCount: detail.faceCount, edgeCount: detail.edgeCount,
    maxTolerance: detail.maxTolerance ?? Number.POSITIVE_INFINITY,
    minEdgeLength: detail.minEdgeLength ?? Number.POSITIVE_INFINITY,
  };
}

/** Executes real kernel healing only for invalid/zero-solid imports, then approves it with exact before/after measurements. */
export async function healImportedOcctShape(input: {
  bridge: OcctBridge; shape: OcctShape; detail: OcctDetailedShapeInspection;
  workingTolerance: number; sewingTolerance: number; maxRelativeVolumeChange?: number;
}): Promise<OcctHealingResult> {
  const before = measurement(input.detail);
  if (before.valid && before.solidCount > 0) return { status: 'not_required', shape: input.shape, detail: input.detail, before, topologyReferenceStatus: 'preserved_original' };
  if (!input.bridge.healShape || !input.bridge.inspectShapeDetailed) return { status: 'not_run', shape: input.shape, detail: input.detail, before, reason: 'Exact OCCT healing/inspection adapter is unavailable.', topologyReferenceStatus: 'preserved_original' };
  const healed = await input.bridge.healShape(input.shape, { workingTolerance: input.workingTolerance, sewingTolerance: input.sewingTolerance, maxTolerance: input.workingTolerance * 10 });
  if (!healed.ok || !healed.shape) return { status: 'rejected', shape: input.shape, detail: input.detail, before, reason: healed.error ?? 'OCCT healing returned no shape.', topologyReferenceStatus: 'preserved_original' };
  const afterDetail = await input.bridge.inspectShapeDetailed(healed.shape);
  const after = measurement(afterDetail);
  const decision = evaluateCadHealing({ before, after, workingTolerance: input.workingTolerance, sewingTolerance: input.sewingTolerance, maxRelativeVolumeChange: input.maxRelativeVolumeChange });
  if (!decision.accepted) { input.bridge.release(healed.shape); return { status: 'rejected', shape: input.shape, detail: input.detail, before, after, decision, reason: 'Healed shape exceeded the governed tolerance/topology policy.', topologyReferenceStatus: 'preserved_original' }; }
  input.bridge.release(input.shape);
  return { status: 'recovered', shape: healed.shape, detail: afterDetail, before, after, decision, topologyReferenceStatus: 'requires_remap' };
}
