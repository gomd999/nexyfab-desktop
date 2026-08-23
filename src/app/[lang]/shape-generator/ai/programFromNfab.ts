/**
 * Precision CAD -> AI context adapter.
 *
 * The exact NFAB payload is retained in MechanicalDesignGraph. FeatureProgram
 * is only a compact read projection for chat; it is not treated as a safe way
 * to reconstruct an existing precision model.
 */
import type { FeatureProgram, ProgramFeature } from '../../studio/emitScadFromProgram';
import {
  buildMechanicalDesignGraph,
  type MechanicalDesignGraphNodeV1,
  type MechanicalDesignGraphV1,
} from '@/lib/ai/mechanicalDesignGraph';

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export interface ReverseProgramResult {
  /** Compact, mapped read projection. Never use this to replace the source model. */
  program: FeatureProgram;
  /** Active feature kinds that cannot be represented by the compact projection. */
  unmapped: string[];
  /** Exact source graph used by revision-bound, in-place AI patches. */
  designGraph: MechanicalDesignGraphV1;
  editPolicy: {
    mode: 'revision_bound_patch_only';
    wholeModelRegenerationAllowed: false;
    protectedNodeIds: string[];
  };
}

export function isReverseProgramResult(value: unknown): value is ReverseProgramResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReverseProgramResult>;
  return candidate.designGraph?.schema === 'nexyfab.mechanical-design-graph.v1'
    && /^[a-f0-9]{64}$/.test(candidate.designGraph.revisionSha256 ?? '')
    && candidate.editPolicy?.mode === 'revision_bound_patch_only'
    && candidate.editPolicy.wholeModelRegenerationAllowed === false
    && Array.isArray(candidate.editPolicy.protectedNodeIds)
    && Array.isArray(candidate.program?.features)
    && Array.isArray(candidate.unmapped);
}

function mappedFeature(node: MechanicalDesignGraphNodeV1): ProgramFeature | null {
  const p = node.params;
  if (node.kind === 'hole') {
    return {
      id: node.id,
      type: 'hole',
      diameter: num(p.diameter, 6),
      posX: num(p.posX, 0),
      posY: num(p.posZ, 0),
      holeType: num(p.holeType, 0),
    };
  }
  if (node.kind === 'fillet') return { id: node.id, type: 'fillet', radius: num(p.radius, 3) };
  if (node.kind === 'chamfer') return { id: node.id, type: 'chamfer', distance: num(p.distance, num(p.radius, 1)) };
  if (node.kind === 'shell') {
    return {
      id: node.id,
      type: 'shell',
      wallThickness: num(p.wallThickness, num(p.thickness, 2)),
      openFace: p.openFace === 2 ? 'bottom' : 'top',
    };
  }
  if (node.kind === 'rib') {
    const startX = num(p.startX, 0);
    const startZ = num(p.startZ, 0);
    const endX = num(p.endX, startX);
    const endZ = num(p.endZ, startZ);
    const dx = endX - startX;
    const dz = endZ - startZ;
    // FeatureProgram v1 can express only axis-aligned ribs.
    if (Math.abs(dx) > 1e-9 && Math.abs(dz) > 1e-9) return null;
    return {
      id: node.id,
      type: 'rib',
      width: num(p.thickness, 8),
      height: num(p.height, 40),
      length: Math.hypot(dx, dz),
      posX: (startX + endX) / 2,
      posY: (startZ + endZ) / 2,
      alongY: Math.abs(dz) > Math.abs(dx),
    };
  }
  return null;
}

function nodeRequiresProtection(node: MechanicalDesignGraphNodeV1, mapped: ProgramFeature | null): boolean {
  if (node.kind === 'baseShape') return false;
  if (!node.enabled || !mapped) return true;
  if (node.expressionKeys.length > 0 || node.hasSelectionBinding) return true;
  if (Array.isArray(node.source.dependsOn) || node.source.sketchData !== undefined) return true;
  return false;
}

export async function programFromNfab(project: unknown): Promise<ReverseProgramResult | null> {
  if (!project) return null;
  let designGraph: MechanicalDesignGraphV1;
  try {
    designGraph = await buildMechanicalDesignGraph(project);
  } catch {
    return null;
  }

  const features: ProgramFeature[] = [];
  if (designGraph.base.shapeId === 'box') {
    features.push({
      id: designGraph.rootId,
      type: 'sketchExtrude',
      shape: 'rect',
      width: num(designGraph.base.params.width, 100),
      depth: num(designGraph.base.params.depth, 80),
      height: num(designGraph.base.params.height, 8),
    });
  } else if (designGraph.base.shapeId === 'cylinder') {
    features.push({
      id: designGraph.rootId,
      type: 'sketchExtrude',
      shape: 'circle',
      width: num(designGraph.base.params.diameter, 50),
      height: num(designGraph.base.params.height, 50),
    });
  } else {
    return null;
  }

  const unmapped = new Set<string>();
  const protectedNodeIds = new Set<string>();
  for (const node of designGraph.nodes) {
    if (node.id === designGraph.rootId || node.kind === 'baseShape') continue;
    const mapped = node.enabled ? mappedFeature(node) : null;
    if (mapped) features.push(mapped);
    else if (node.enabled) unmapped.add(node.kind);
    if (nodeRequiresProtection(node, mapped)) protectedNodeIds.add(node.id);
  }

  return {
    program: { part: 'edited-model', features },
    unmapped: [...unmapped].sort(),
    designGraph,
    editPolicy: {
      mode: 'revision_bound_patch_only',
      wholeModelRegenerationAllowed: false,
      protectedNodeIds: [...protectedNodeIds].sort(),
    },
  };
}

/** Human/AI-readable context. It explicitly forbids complete regeneration. */
export function chatContextPreamble(result: ReverseProgramResult): string {
  const graphSummary = {
    schema: result.designGraph.schema,
    revisionSha256: result.designGraph.revisionSha256,
    base: result.designGraph.base,
    nodes: result.designGraph.nodes.map(node => ({
      id: node.id,
      kind: node.kind,
      enabled: node.enabled,
      params: node.params,
      expressionKeys: node.expressionKeys,
      hasSelectionBinding: node.hasSelectionBinding,
    })),
    protectedNodeIds: result.editPolicy.protectedNodeIds,
  };
  const lines = [
    '[기존 정밀 CAD 컨텍스트 — 읽기/검토용]',
    '[안전 정책: 전체 모델을 재생성하거나 기존 피처를 생략하지 말 것. 형상 변경은 base revision에 결속된 in-place patch로만 수행해야 한다.]',
    JSON.stringify(graphSummary),
  ];
  if (result.unmapped.length) {
    lines.push(`[보호된 비투영 피처: ${result.unmapped.join(', ')}]`);
  }
  return lines.join('\n');
}
