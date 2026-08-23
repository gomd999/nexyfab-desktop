import {
  EDITABLE_WORKSPACE_CANDIDATE_SCHEMA,
  type EditableWorkspaceCandidate,
} from '@/lib/ai/design-driver/workspaceCandidate';
import { reconstructFeatureTree } from '../ai/programToFeatures';
import { getFeatureDefinition } from '../features';
import type { FeatureInstance, FeatureType } from '../features/types';
import type { HistoryNode } from '../useFeatureStack';

export interface ModelerWorkspaceDraft {
  sourcePlanId: string;
  baseShape: { id: string; params: Record<string, number> };
  features: FeatureInstance[];
  history: { nodes: HistoryNode[]; rootId: string; activeNodeId: string };
  reverificationRequired: true;
}

export type WorkspaceDraftResult =
  | { ok: true; draft: ModelerWorkspaceDraft }
  | { ok: false; blockers: string[] };

/**
 * The candidate crossed an HTTP boundary before reaching this adapter. Keep
 * the release/reverification flags as runtime assertions rather than trusting
 * their TypeScript literals: a stale, tampered, or incorrectly upgraded
 * payload must never be applied as an already-verified workspace revision.
 */
function candidateContractBlockers(candidate: EditableWorkspaceCandidate): string[] {
  const value = candidate as unknown as Record<string, unknown>;
  const blockers: string[] = [];
  if (value.schema !== EDITABLE_WORKSPACE_CANDIDATE_SCHEMA) blockers.push('workspace_candidate_schema_invalid');
  if (value.reverificationRequired !== true) blockers.push('workspace_candidate_reverification_required');
  if (value.inheritedVerification !== false) blockers.push('workspace_candidate_inherited_verification_forbidden');
  if (value.manufacturingReleaseReady !== false) blockers.push('workspace_candidate_release_claim_forbidden');
  return blockers;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'design';
}

function buildHistory(sourcePlanId: string, features: FeatureInstance[]): ModelerWorkspaceDraft['history'] {
  const prefix = `ai-${safeId(sourcePlanId)}`;
  const rootId = `${prefix}-root`;
  const nodes: HistoryNode[] = [{
    id: rootId,
    type: 'baseShape',
    label: 'AI workspace base',
    icon: '📦',
    params: {},
    enabled: true,
    expanded: true,
    parentId: null,
    children: features.length ? [`${prefix}-feature-1`] : [],
    editingActive: false,
    timestamp: 0,
  }];
  features.forEach((feature, index) => {
    const id = `${prefix}-feature-${index + 1}`;
    const nextId = index + 1 < features.length ? `${prefix}-feature-${index + 2}` : null;
    nodes.push({
      id,
      type: 'feature',
      label: `AI ${feature.type} ${index + 1}`,
      icon: feature.type === 'sketchExtrude' ? '✏️' : '🔧',
      featureType: feature.type,
      params: { ...feature.params },
      enabled: feature.enabled,
      expanded: true,
      parentId: index === 0 ? rootId : `${prefix}-feature-${index}`,
      children: nextId ? [nextId] : [],
      editingActive: false,
      timestamp: index + 1,
      dependsOn: [index === 0 ? rootId : `${prefix}-feature-${index}`],
      ...(feature.sketchData ? { sketchData: structuredClone(feature.sketchData) } : {}),
    });
  });
  return { nodes, rootId, activeNodeId: features.length ? `${prefix}-feature-${features.length}` : rootId };
}

/**
 * Converts a server-approved candidate into one atomic modeler state draft.
 * The caller applies baseShape + history together; no verification is carried
 * across the representation boundary.
 */
export function workspaceCandidateToModelerDraft(candidate: EditableWorkspaceCandidate): WorkspaceDraftResult {
  const contractBlockers = candidateContractBlockers(candidate);
  if (contractBlockers.length) return { ok: false, blockers: contractBlockers };
  if (!candidate.supported || !candidate.program) {
    return { ok: false, blockers: candidate.blockers.length ? [...candidate.blockers] : ['workspace_program_missing'] };
  }
  let baseShape: ModelerWorkspaceDraft['baseShape'] | null = null;
  const features: FeatureInstance[] = [];
  let sequence = 0;
  const nextId = (type: string) => `${safeId(candidate.sourcePlanId)}-${type}-${++sequence}`;

  const rebuilt = reconstructFeatureTree(candidate.program, {
    setBaseShape: (id, params) => { baseShape = { id, params: { ...params } }; },
    addSketchFeature: (profile, config, plane, operation, planeOffset = 0, constraints, dimensions, faceFrame) => {
      features.push({
        id: nextId('sketch'),
        type: 'sketchExtrude',
        params: { depth: config.depth, planeOffset },
        enabled: true,
        sketchData: { profile: structuredClone(profile), config: structuredClone(config), plane, operation, planeOffset, constraints, dimensions, faceFrame },
      });
    },
    addFeatureWithParams: (type: FeatureType, overrides: Record<string, number>) => {
      const definition = getFeatureDefinition(type);
      if (!definition) throw new Error(`unsupported modeler feature: ${type}`);
      const params = Object.fromEntries(definition.params.map(param => [param.key, param.default]));
      Object.assign(params, overrides);
      features.push({ id: nextId(type), type, params, enabled: true });
    },
  });
  if (!rebuilt.ok || rebuilt.skipped.length) {
    return { ok: false, blockers: rebuilt.skipped.length ? rebuilt.skipped.map(value => `modeler_rebuild_skipped:${value}`) : ['modeler_rebuild_failed'] };
  }
  if (!baseShape) return { ok: false, blockers: ['modeler_base_shape_missing'] };
  return {
    ok: true,
    draft: {
      sourcePlanId: candidate.sourcePlanId,
      baseShape,
      features,
      history: buildHistory(candidate.sourcePlanId, features),
      reverificationRequired: true,
    },
  };
}
