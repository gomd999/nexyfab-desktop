/**
 * Renderer-neutral contract for linking a drawing projection to a concept
 * model. This is deliberately a preview contract: AI Design may describe
 * impact, but it never commits geometry or manufacturing changes.
 */

export const AI_DESIGN_2D_3D_SYNC_SCHEMA = 'nexyfab.ai-design-2d-3d-sync.v1' as const;
export type SyncFocus = '2d' | '3d' | 'split';
export type SyncDomain = '2d' | '3d';
export type SyncStatus = 'SYNCED' | 'NEEDS_INPUT';
export type SyncRefKind = 'drawing_entity' | 'dimension' | 'structure_node' | 'feature' | 'parameter';

export interface StableSyncRef {
  kind: SyncRefKind;
  id: string;
}

export interface SyncMapping {
  source: StableSyncRef;
  targets: readonly StableSyncRef[];
}

export interface AiDesign2d3dSyncContractV1 {
  schema: typeof AI_DESIGN_2D_3D_SYNC_SCHEMA;
  projectId: string;
  revision: string;
  focus: SyncFocus;
  twoDToThreeD: readonly SyncMapping[];
  threeDToTwoD: readonly SyncMapping[];
  authority: 'ai_design_concept_preview';
  commitAllowed: false;
}

export interface SyncSelectionRequest {
  source: SyncDomain;
  refs: readonly StableSyncRef[];
}

export interface SyncSelectionResult {
  status: SyncStatus;
  source: SyncDomain;
  targets: readonly StableSyncRef[];
  unresolved: readonly { source: StableSyncRef; candidates: readonly StableSyncRef[] }[];
}

export interface SyncPreviewResult extends SyncSelectionResult {
  kind: '2d_to_3d_impact_preview' | '3d_to_2d_drawing_update_preview';
  previewOnly: true;
  authority: 'ai_design_concept_preview';
  commitAllowed: false;
  baseRevision: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TWO_D_KINDS: readonly SyncRefKind[] = ['drawing_entity', 'dimension'];
const THREE_D_KINDS: readonly SyncRefKind[] = ['structure_node', 'feature', 'parameter'];
const MAX_MAPPINGS = 10_000;
const MAX_TARGETS_PER_MAPPING = 16;
const validRef = (ref: StableSyncRef): boolean => ID.test(ref.id);
const refKey = (ref: StableSyncRef): string => `${ref.kind}:${ref.id}`;
const uniqueRefs = (refs: readonly StableSyncRef[]): StableSyncRef[] => {
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = refKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function mappingsFor(contract: AiDesign2d3dSyncContractV1, source: SyncDomain): readonly SyncMapping[] {
  return source === '2d' ? contract.twoDToThreeD : contract.threeDToTwoD;
}

function resolve(contract: AiDesign2d3dSyncContractV1, request: SyncSelectionRequest): SyncSelectionResult {
  const mappings = mappingsFor(contract, request.source);
  const targets: StableSyncRef[] = [];
  const unresolved: Array<{ source: StableSyncRef; candidates: readonly StableSyncRef[] }> = [];
  if (request.refs.length > 256) return { status: 'NEEDS_INPUT', source: request.source, targets: [], unresolved: request.refs.slice(0, 256).map(source => ({ source, candidates: [] })) };
  for (const source of uniqueRefs(request.refs)) {
    const allowedKinds = request.source === '2d' ? TWO_D_KINDS : THREE_D_KINDS;
    if (!validRef(source) || !allowedKinds.includes(source.kind)) { unresolved.push({ source, candidates: [] }); continue; }
    const candidates = uniqueRefs(mappings.filter(mapping => refKey(mapping.source) === refKey(source)).flatMap(mapping => mapping.targets));
    // Both missing and ambiguous mappings fail closed. A UI can ask the user
    // to choose a mapping instead of silently applying a guessed association.
    const [candidate] = candidates;
    if (candidate === undefined || candidates.length !== 1) unresolved.push({ source, candidates });
    else targets.push(candidate);
  }
  return { status: unresolved.length === 0 ? 'SYNCED' : 'NEEDS_INPUT', source: request.source, targets: uniqueRefs(targets), unresolved };
}

export function createAiDesign2d3dSyncContract(input: Omit<AiDesign2d3dSyncContractV1, 'schema' | 'authority' | 'commitAllowed'>): AiDesign2d3dSyncContractV1 {
  const mappings = [...input.twoDToThreeD, ...input.threeDToTwoD];
  const domainInvalid = input.twoDToThreeD.some(mapping => !TWO_D_KINDS.includes(mapping.source.kind) || mapping.targets.some(target => !THREE_D_KINDS.includes(target.kind)))
    || input.threeDToTwoD.some(mapping => !THREE_D_KINDS.includes(mapping.source.kind) || mapping.targets.some(target => !TWO_D_KINDS.includes(target.kind)));
  if (!ID.test(input.projectId) || !ID.test(input.revision) || !['2d', '3d', 'split'].includes(input.focus)
    || mappings.length > MAX_MAPPINGS || domainInvalid
    || mappings.some(mapping => !validRef(mapping.source) || mapping.targets.length < 1 || mapping.targets.length > MAX_TARGETS_PER_MAPPING || mapping.targets.some(target => !validRef(target)))) {
    throw new Error('AI_DESIGN_2D_3D_SYNC_INVALID_ID');
  }
  return { ...input, schema: AI_DESIGN_2D_3D_SYNC_SCHEMA, authority: 'ai_design_concept_preview', commitAllowed: false };
}

export function syncAiDesignSelection(contract: AiDesign2d3dSyncContractV1, request: SyncSelectionRequest): SyncSelectionResult {
  return resolve(contract, request);
}

export function preview2dTo3dImpact(contract: AiDesign2d3dSyncContractV1, changed: readonly StableSyncRef[]): SyncPreviewResult {
  return { ...resolve(contract, { source: '2d', refs: changed }), kind: '2d_to_3d_impact_preview', previewOnly: true, authority: contract.authority, commitAllowed: false, baseRevision: contract.revision };
}

export function preview3dGaugeTo2dUpdate(contract: AiDesign2d3dSyncContractV1, gauge: StableSyncRef): SyncPreviewResult {
  return { ...resolve(contract, { source: '3d', refs: [gauge] }), kind: '3d_to_2d_drawing_update_preview', previewOnly: true, authority: contract.authority, commitAllowed: false, baseRevision: contract.revision };
}
