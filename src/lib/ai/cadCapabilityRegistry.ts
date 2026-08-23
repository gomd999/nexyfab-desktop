/**
 * CAD capability truth layer.
 *
 * The feature catalog answers "is this a product module?" and the SCAD
 * registry answers "is there an agent tool?".  Neither answer is sufficient
 * to decide whether an AI request may execute: several tools are adapters
 * around optional OCCT/solver services, while the feature-tree addable list is
 * deliberately client-only.  This module is the small, side-effect-free
 * bridge between those contracts.
 *
 * This is intentionally fail-closed.  A missing host adapter never becomes an
 * optimistic executable result, and an unknown feature is never guessed into
 * an arbitrary tool.  Unknown prompts can still be handed to the generic
 * parametric planner, with clarification explicitly represented in the
 * result.
 */

import { isNewDesignPrompt } from './guidedDesignBrief';
import { normalizeMechanicalVocabulary } from './mechanicalVocabulary';
import { recommendDesignDomains } from './domainPromptClassifier';
import { ADDABLE_FEATURES, FACE_SELECTION_CONSUMERS, EDGE_SELECTION_CONSUMERS } from './addableFeatureTypes';
import type { AgentSession, ToolName } from './scad-agent/types';
import type { ToolHostAdapters } from './scad-agent/tools';
import { findById, type FeatureRegistryEntry } from '@/app/[lang]/shape-generator/featureCatalog/registry';

export type CadCapabilityStatus =
  | 'executable'
  | 'requires-selection'
  | 'client-only'
  | 'mock-partial'
  | 'unavailable';

/** A is a fresh design; B is a bounded edit to an existing design. */
export type CadOperationMode = 'new-design' | 'scoped-modification';

export type CadExecutionGate = 'open' | 'confirm-before-execute' | 'blocked';

export type CadHostAdapterName =
  | 'render'
  | 'geometry'
  | 'dfm'
  | 'vision'
  | 'brep'
  | 'solver'
  | 'mateSolver'
  | 'drawingStudio'
  | 'collab'
  | 'docRefs'
  | 'fea';

export type CadSelectionKind = 'face' | 'edge' | 'body' | 'sketch' | 'entity' | 'mate';

export interface CadSelectionContext {
  /** Explicit canonical part ids are evidence only when the corresponding
   * geometry/feature/mate reference is also proven by the ownership index. */
  partIds?: readonly string[];
  featureIds?: readonly string[];
  faceIds?: readonly string[];
  edgeIds?: readonly string[];
  bodyIds?: readonly string[];
  sketchIds?: readonly string[];
  entityIds?: readonly string[];
  mateIds?: readonly string[];
}

/**
 * The edit scope mirrors the identity-bearing part/mate boundary enforced by
 * repairScopeVerification.  It is intentionally only a capability input;
 * the full before/after program verifier remains the release-time authority.
 */
export interface CadMutationScope {
  partIds?: readonly string[];
  featureIds?: readonly string[];
  mateIds?: readonly string[];
  /** Assembly/product scope may span multiple affected parts, but only parts
   * present in the signed ownership index are eligible. */
  assemblyScope?: boolean;
}

export type CadOwnershipDecision =
  | 'not-checked'
  | 'not-required'
  | 'proven'
  | 'unknown'
  | 'out-of-scope'
  | 'mixed';

/** Exact reference-to-part bindings carried by a signed AgentSession. */
export interface CadSelectionOwnership {
  partIds: readonly string[];
  brepHandles?: Readonly<Record<string, string>>;
  featureIds?: Readonly<Record<string, string>>;
  sketchIds?: Readonly<Record<string, string>>;
  entityIds?: Readonly<Record<string, string>>;
  faceIds?: Readonly<Record<string, string>>;
  edgeIds?: Readonly<Record<string, string>>;
  /** Mates can legitimately span two parts, hence an owner list. */
  mateIds?: Readonly<Record<string, readonly string[]>>;
}

export interface CadOwnershipCheck {
  decision: CadOwnershipDecision;
  owners: readonly string[];
  reason?: string;
}

export interface CadCapabilityFallback {
  kind: 'none' | 'generic-parametric-planner' | 'clarification-required';
  available: boolean;
  reason: string;
}

export interface CadCapabilityDefinition {
  /** Canonical tool name, feature id, or addable feature type. */
  id: string;
  aliases?: readonly string[];
  source: 'scad-agent' | 'feature-catalog' | 'addable-feature';
  tool?: ToolName;
  catalogId?: string;
  requiredHostAdapters: readonly CadHostAdapterName[];
  requiredSelection?: CadSelectionKind;
  clientOnly?: boolean;
  /** The adapter is shape-correct but not production-grade. */
  mockPartial?: boolean;
  /** Static unsupported mode (e.g. nonlinear FEA behind a linear tool). */
  unsupportedReason?: string;
  allowedActions: readonly string[];
  description?: string;
}

export interface CadCapabilityEnvironment {
  /** Values may be booleans or the actual injected host adapter objects. */
  hostAdapters?: Partial<Record<CadHostAdapterName, unknown>>;
  /** Optional narrowed makeTools() map. An explicitly supplied map is trusted
   * only for presence, never for adapter readiness. */
  tools?: Readonly<Record<string, unknown>> | ReadonlySet<string>;
  /** Set false when the generic planner is not wired by the caller. */
  genericPlannerAvailable?: boolean;
  /** Mark injected adapters that are shape-correct mocks/stubs. */
  mockAdapters?: readonly CadHostAdapterName[];
  /** The feature-tree dispatcher is a separate client runtime, not an agent tool. */
  clientDispatcherAvailable?: boolean;
  /** Optional HMAC-bound reference ownership for governed modifications. */
  ownership?: CadSelectionOwnership;
}

export interface CadCapabilityQuery {
  feature: string;
  mode?: CadOperationMode;
  prompt?: string;
  scope?: CadMutationScope;
  selection?: CadSelectionContext;
  environment?: CadCapabilityEnvironment;
  /** Caller-provided confidence from a classifier/template resolver. */
  vocabularyConfidence?: number;
  templateAvailable?: boolean;
}

export interface CadCapabilityReport {
  feature: string;
  canonicalId: string | null;
  source: CadCapabilityDefinition['source'] | 'unknown';
  status: CadCapabilityStatus;
  reason: string;
  requiredHostAdapters: readonly CadHostAdapterName[];
  missingHostAdapters: readonly CadHostAdapterName[];
  requiredSelection: CadSelectionKind | null;
  selectionSatisfied: boolean;
  operationMode: CadOperationMode;
  mutabilityScope: CadMutationScope | null;
  scopeRequired: boolean;
  allowedActions: readonly string[];
  executionGate: CadExecutionGate;
  clarificationRequired: boolean;
  fallback: CadCapabilityFallback;
  /** Existing prompt routers can use this without changing their contracts. */
  recommendedDomains: readonly string[];
  /** Whether selected targets were proven against canonical part ownership. */
  selectionOwnership: CadOwnershipDecision;
}

type DefinitionPatch = Omit<CadCapabilityDefinition, 'id'>;

const host = (...requiredHostAdapters: CadHostAdapterName[]): DefinitionPatch => ({
  source: 'scad-agent', requiredHostAdapters, allowedActions: [],
});

const SCAD_DEFINITIONS: readonly CadCapabilityDefinition[] = [
  { id: 'brep_primitive', aliases: ['primitive', 'solid', 'brep-primitive'], ...host('brep'), allowedActions: ['create', 'verify', 'export'] },
  { id: 'brep_boolean', aliases: ['boolean', 'brep-boolean'], ...host('brep'), requiredSelection: 'body', allowedActions: ['create', 'modify', 'verify'] },
  { id: 'brep_fillet', aliases: ['brep-fillet'], ...host('brep'), requiredSelection: 'edge', allowedActions: ['create', 'modify', 'verify'] },
  { id: 'brep_chamfer', aliases: ['brep-chamfer'], ...host('brep'), requiredSelection: 'edge', allowedActions: ['create', 'modify', 'verify'] },
  { id: 'brep_shell', aliases: ['brep-shell'], ...host('brep'), requiredSelection: 'body', allowedActions: ['create', 'modify', 'verify'] },
  { id: 'brep_to_mesh', aliases: ['tessellate'], ...host('brep'), allowedActions: ['verify', 'export'] },
  { id: 'brep_export_step', aliases: ['export-step', 'step-export'], ...host('brep'), allowedActions: ['export'] },
  { id: 'brep_sweep', aliases: ['sweep'], ...host('brep'), requiredSelection: 'sketch', allowedActions: ['create', 'verify'] },
  { id: 'brep_loft', aliases: ['loft'], ...host('brep'), requiredSelection: 'sketch', allowedActions: ['create', 'verify'] },
  { id: 'brep_draft', aliases: ['draft'], ...host('brep'), requiredSelection: 'face', allowedActions: ['create', 'modify', 'verify'] },
  { id: 'brep_helix', aliases: ['helix'], ...host('brep'), allowedActions: ['create', 'verify'] },
  { id: 'sketch_create', aliases: ['sketch'], ...host(), allowedActions: ['create', 'modify', 'verify'] },
  { id: 'sketch_add_constraint', aliases: ['sketch-constraint'], ...host(), requiredSelection: 'entity', allowedActions: ['create', 'modify', 'verify'] },
  { id: 'sketch_solve', aliases: ['constraint-solve'], ...host('solver'), allowedActions: ['verify', 'modify'] },
  { id: 'sketch_to_brep_extrude', aliases: ['sketch-extrude'], ...host('brep'), requiredSelection: 'sketch', allowedActions: ['create', 'verify'] },
  { id: 'compose_assembly', aliases: ['assembly', 'assembly-compose'], ...host(), allowedActions: ['create', 'verify', 'export'] },
  { id: 'add_mate', aliases: ['mate'], ...host(), requiredSelection: 'body', allowedActions: ['create', 'modify', 'verify'] },
  { id: 'solve_mates', aliases: ['mate-solve'], ...host('mateSolver'), allowedActions: ['verify', 'modify'] },
  { id: 'brep_to_drawing', aliases: ['drawing', 'drawing-generate'], ...host('drawingStudio', 'brep'), allowedActions: ['create', 'verify', 'export'] },
  { id: 'brep_export_drawing', aliases: ['drawing-export'], ...host('drawingStudio'), allowedActions: ['export'] },
  { id: 'read_dfm', aliases: ['dfm', 'dfm-check'], ...host('dfm'), allowedActions: ['verify', 'export'] },
  { id: 'render', aliases: ['render-cad'], ...host('render'), allowedActions: ['verify', 'export'] },
  { id: 'view_render', aliases: ['vision-render'], ...host('render', 'vision'), allowedActions: ['verify'] },
  { id: 'fea_setup', aliases: ['fea'], ...host('fea'), requiredSelection: 'body', allowedActions: ['create', 'verify'] },
  { id: 'fea_solve', aliases: ['fea-solve'], ...host('fea'), allowedActions: ['verify'] },
  { id: 'fea_stress', aliases: ['fea-stress'], ...host('fea'), allowedActions: ['verify', 'export'] },
  // Simulation tools intentionally expose the built-in mocks. They are useful
  // for planning, but must never be presented as production-validated physics.
  { id: 'sim_cfd', aliases: ['cfd', 'simulation-cfd'], ...host(), mockPartial: true, allowedActions: ['verify'] },
  { id: 'sim_mbd', aliases: ['mbd', 'simulation-mbd'], ...host(), mockPartial: true, allowedActions: ['verify'] },
  { id: 'sim_cam', aliases: ['simulation-cam'], ...host(), mockPartial: true, allowedActions: ['verify'] },
  { id: 'sim_mold_fill', aliases: ['mold-fill', 'simulation-mold'], ...host(), mockPartial: true, allowedActions: ['verify'] },
  { id: 'sim_optics', aliases: ['optics', 'simulation-optics'], ...host(), mockPartial: true, allowedActions: ['verify'] },
  { id: 'sim_thermal', aliases: ['thermal', 'simulation-thermal'], ...host(), mockPartial: true, allowedActions: ['verify'] },
];

const ADDABLE_DEFINITIONS: readonly CadCapabilityDefinition[] = ADDABLE_FEATURES.map(feature => ({
  id: feature.type,
  source: 'addable-feature',
  requiredHostAdapters: [],
  requiredSelection: FACE_SELECTION_CONSUMERS.includes(feature.type) ? 'face'
    : EDGE_SELECTION_CONSUMERS.includes(feature.type) ? 'edge' : undefined,
  clientOnly: true,
  allowedActions: ['create', 'modify'],
  description: 'Validated by addableFeatureTypes and applied by the client feature dispatcher.',
}));

/** Static bridge surface for consumers that need to enumerate agent tools. */
export const CAD_CAPABILITY_REGISTRY: readonly CadCapabilityDefinition[] = [
  ...SCAD_DEFINITIONS,
  ...ADDABLE_DEFINITIONS,
];

function hasTool(tools: CadCapabilityEnvironment['tools'], tool: string): boolean {
  if (!tools) return true;
  if (typeof (tools as ReadonlySet<string>).has === 'function') return (tools as ReadonlySet<string>).has(tool);
  const map = tools as Readonly<Record<string, unknown>>;
  return Object.prototype.hasOwnProperty.call(map, tool) && map[tool] != null;
}

function adapterAvailable(adapters: CadCapabilityEnvironment['hostAdapters'], name: CadHostAdapterName): boolean {
  return Boolean(adapters && adapters[name]);
}

function selectionCount(selection: CadSelectionContext | undefined, kind: CadSelectionKind): number {
  if (!selection) return 0;
  const ids = kind === 'face' ? selection.faceIds
    : kind === 'edge' ? selection.edgeIds
      : kind === 'body' ? selection.bodyIds
        : kind === 'sketch' ? selection.sketchIds
          : kind === 'entity' ? selection.entityIds : selection.mateIds;
  return ids?.length ?? 0;
}

function hasScope(scope: CadMutationScope | undefined): boolean {
  return Boolean(scope && (scope.assemblyScope === true || Object.values(scope).some(ids =>
    Array.isArray(ids) && ids.some(id => typeof id === 'string' && id.trim().length > 0),
  )));
}

type MutableOwnerMap = Record<string, string | null>;
type MutableMateOwnerMap = Record<string, string[] | null>;

function cleanId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function uniqueIds(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(cleanId).filter((value): value is string => Boolean(value)))];
}

function mergeOwner(map: MutableOwnerMap, id: unknown, owner: unknown): void {
  const key = cleanId(id);
  const value = cleanId(owner);
  if (!key || !value) return;
  if (!(key in map)) map[key] = value;
  else if (map[key] !== value) map[key] = null;
}

function mergeMateOwners(map: MutableMateOwnerMap, id: unknown, owners: readonly string[]): void {
  const key = cleanId(id);
  const normalized = uniqueIds(owners);
  if (!key || normalized.length === 0) return;
  const existing = map[key];
  if (existing === undefined) map[key] = normalized;
  else if (existing === null || existing.length !== normalized.length || existing.some(owner => !normalized.includes(owner))) map[key] = null;
}

function copyExplicitOwners(
  map: MutableOwnerMap,
  value: Readonly<Record<string, string>> | undefined,
): void {
  if (!value || typeof value !== 'object') return;
  for (const [id, owner] of Object.entries(value)) mergeOwner(map, id, owner);
}

function ownerFromMap(map: MutableOwnerMap | undefined, id: unknown): string | null {
  const key = cleanId(id);
  if (!key || !map || !(key in map)) return null;
  return map[key] ?? null;
}

function mapWithoutConflicts(map: MutableOwnerMap): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [id, owner] of Object.entries(map)) if (typeof owner === 'string') result[id] = owner;
  return result;
}

function mateMapWithoutConflicts(map: MutableMateOwnerMap): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [id, owners] of Object.entries(map)) if (Array.isArray(owners)) result[id] = [...owners];
  return result;
}

/**
 * Build exact target ownership from the signed session. A legacy session can
 * still contribute ownership when a server-side producer stamped `partId`
 * onto a B-rep/feature/sketch; labels, handle prefixes, and prompt text are
 * deliberately ignored.
 */
export function cadSelectionOwnershipFromSession(session: Pick<AgentSession, 'cadOwnership' | 'brepEntries' | 'featureTree' | 'sketches' | 'mates'>): CadSelectionOwnership | null {
  const raw = session.cadOwnership;
  const rawIsUsable = Boolean(raw && raw.schema === 'nexyfab.cad-session-ownership.v1' && Array.isArray(raw.partIds));
  const partIds = new Set<string>(rawIsUsable ? uniqueIds(raw!.partIds) : []);
  const brepHandles: MutableOwnerMap = {};
  const featureIds: MutableOwnerMap = {};
  const sketchIds: MutableOwnerMap = {};
  const entityIds: MutableOwnerMap = {};
  const faceIds: MutableOwnerMap = {};
  const edgeIds: MutableOwnerMap = {};
  const mateIds: MutableMateOwnerMap = {};

  if (rawIsUsable) {
    for (const id of partIds) partIds.add(id);
    copyExplicitOwners(brepHandles, raw!.brepHandles);
    copyExplicitOwners(featureIds, raw!.featureIds);
    copyExplicitOwners(sketchIds, raw!.sketchIds);
    copyExplicitOwners(entityIds, raw!.entityIds);
    copyExplicitOwners(faceIds, raw!.faceIds);
    copyExplicitOwners(edgeIds, raw!.edgeIds);
    if (raw!.mateIds && typeof raw!.mateIds === 'object') {
      for (const [id, owners] of Object.entries(raw!.mateIds)) {
        if (Array.isArray(owners)) mergeMateOwners(mateIds, id, owners);
      }
    }
  }

  for (const entry of session.brepEntries ?? []) {
    // A transport session may retain an audit marker for a prior worker-local
    // handle. It is deliberately not an ownership capability until an
    // authoritative manifest hydrates it again.
    if (entry.runtimeAvailable === false || entry.unavailableReason) continue;
    const owner = cleanId(entry.partId);
    if (!owner) continue;
    partIds.add(owner);
    mergeOwner(brepHandles, entry.handle, owner);
  }

  // Feature-tree ownership is structural: an explicitly stamped node wins;
  // otherwise a node inherits one unambiguous parent owner. Mixed parents do
  // not acquire an owner and therefore cannot be used for a governed edit.
  const nodes = session.featureTree?.nodes ?? {};
  const resolving = new Set<string>();
  const resolved = new Map<string, string[] | null>();
  const resolveNodeOwners = (id: string): string[] | null => {
    if (resolved.has(id)) return resolved.get(id) ?? null;
    if (resolving.has(id)) return null;
    const node = nodes[id];
    if (!node) return null;
    resolving.add(id);
    const direct = cleanId(node.partId);
    const parentOwners = (node.parents ?? []).flatMap(parent => (
      resolveNodeOwners(parent)
      ?? (ownerFromMap(brepHandles, parent) ? [ownerFromMap(brepHandles, parent)!] : [])
    ));
    const owners = direct ? [direct] : [...new Set(parentOwners)];
    resolving.delete(id);
    const result = owners.length > 0 ? owners : null;
    resolved.set(id, result);
    if (result?.length === 1) partIds.add(result[0]!);
    return result;
  };
  for (const node of Object.values(nodes)) {
    const owners = resolveNodeOwners(node.id);
    if (owners?.length !== 1) continue;
    const owner = owners[0]!;
    mergeOwner(featureIds, node.id, owner);
    if (node.name) mergeOwner(featureIds, node.name, owner);
    if (node.resultHandle) mergeOwner(brepHandles, node.resultHandle, owner);
  }

  for (const sketch of Object.values(session.sketches ?? {})) {
    const owner = cleanId(sketch.partId);
    if (!owner) continue;
    partIds.add(owner);
    mergeOwner(sketchIds, sketch.name, owner);
    for (const entity of sketch.entities ?? []) mergeOwner(entityIds, entity.id, owner);
  }

  for (const mate of session.mates ?? []) {
    const ownerA = ownerFromMap(brepHandles, mate.handleA);
    const ownerB = ownerFromMap(brepHandles, mate.handleB);
    if (ownerA && ownerB) {
      partIds.add(ownerA); partIds.add(ownerB);
      mergeMateOwners(mateIds, mate.id, [ownerA, ownerB]);
    }
  }

  if (partIds.size === 0) return null;
  return {
    partIds: [...partIds].sort(),
    brepHandles: mapWithoutConflicts(brepHandles),
    featureIds: mapWithoutConflicts(featureIds),
    sketchIds: mapWithoutConflicts(sketchIds),
    entityIds: mapWithoutConflicts(entityIds),
    faceIds: mapWithoutConflicts(faceIds),
    edgeIds: mapWithoutConflicts(edgeIds),
    mateIds: mateMapWithoutConflicts(mateIds),
  };
}

function scopeIds(scope: CadMutationScope | undefined, key: 'partIds' | 'featureIds' | 'mateIds'): string[] {
  return uniqueIds(scope?.[key]);
}

/** Validate scope IDs against server-bound canonical ownership. */
export function checkCadMutationScopeOwnership(scope: CadMutationScope | undefined, ownership: CadSelectionOwnership | null | undefined): CadOwnershipCheck {
  if (!scope) return { decision: 'not-required', owners: [] };
  if (!ownership) return { decision: 'unknown', owners: [], reason: 'cad_target_ownership_unavailable' };
  const knownParts = new Set(uniqueIds(ownership.partIds));
  const parts = scopeIds(scope, 'partIds');
  if (parts.some(part => !knownParts.has(part))) return { decision: 'unknown', owners: [], reason: 'cad_scope_part_unknown' };
  const features = scopeIds(scope, 'featureIds');
  if (features.some(feature => {
    const owner = ownership.featureIds?.[feature];
    return typeof owner !== 'string' || !knownParts.has(owner);
  })) return { decision: 'unknown', owners: [], reason: 'cad_scope_feature_unknown' };
  const mates = scopeIds(scope, 'mateIds');
  if (mates.some(mate => {
    const owners = ownership.mateIds?.[mate];
    return !Array.isArray(owners) || owners.length === 0 || owners.some(owner => !knownParts.has(owner));
  })) return { decision: 'unknown', owners: [], reason: 'cad_scope_mate_unknown' };
  if (scope.assemblyScope && knownParts.size === 0) return { decision: 'unknown', owners: [], reason: 'cad_assembly_scope_unknown' };
  if (!scope.assemblyScope && parts.length === 0 && features.length === 0 && mates.length === 0) return { decision: 'unknown', owners: [], reason: 'cad_scope_empty' };
  return { decision: 'proven', owners: parts };
}

interface SelectedCadReference {
  kind: 'part' | 'body' | 'feature' | 'face' | 'edge' | 'sketch' | 'entity' | 'mate';
  id: string;
  owners: string[] | null;
}

/**
 * Prove selected target ownership and scope. This is intentionally separate
 * from string/schema validation: every non-part reference must resolve in an
 * exact server-bound map, and operations with two independent bodies cannot
 * silently become cross-part mutations.
 */
export function checkCadSelectionOwnership(
  selection: CadSelectionContext | undefined,
  scope: CadMutationScope | undefined,
  ownership: CadSelectionOwnership | null | undefined,
  feature?: string,
): CadOwnershipCheck {
  const refs: SelectedCadReference[] = [];
  const add = (kind: SelectedCadReference['kind'], ids: readonly string[] | undefined, map?: Readonly<Record<string, string>>, mateMap?: Readonly<Record<string, readonly string[]>>) => {
    for (const id of uniqueIds(ids)) {
      const owners = kind === 'mate'
        ? (mateMap?.[id] ? uniqueIds(mateMap[id]) : null)
        : (map?.[id] ? [map[id]!] : null);
      refs.push({ kind, id, owners });
    }
  };
  if (!selection) return { decision: ownership ? 'not-required' : 'not-checked', owners: [] };
  if (selection.partIds?.length) for (const id of uniqueIds(selection.partIds)) refs.push({ kind: 'part', id, owners: ownership?.partIds.includes(id) ? [id] : null });
  add('body', selection.bodyIds, ownership?.brepHandles);
  add('feature', selection.featureIds, ownership?.featureIds);
  add('face', selection.faceIds, ownership?.faceIds);
  add('edge', selection.edgeIds, ownership?.edgeIds);
  add('sketch', selection.sketchIds, ownership?.sketchIds);
  add('entity', selection.entityIds, ownership?.entityIds);
  add('mate', selection.mateIds, undefined, ownership?.mateIds);
  if (refs.length === 0) return { decision: ownership ? 'not-required' : 'not-checked', owners: [] };
  if (!ownership) return { decision: 'unknown', owners: [], reason: 'cad_target_ownership_unavailable' };

  // `all` is a schema-level selector for all topology on the already-bound
  // body; it is not a free-form owner hint and is only accepted with one body.
  const bodyOwners = refs.filter(ref => ref.kind === 'body').flatMap(ref => ref.owners ?? []);
  for (const ref of refs) {
    if (!ref.owners && (ref.kind === 'face' || ref.kind === 'edge') && (ref.id === 'all' || ref.id === '*') && bodyOwners.length === 1) ref.owners = [bodyOwners[0]!];
  }
  if (refs.some(ref => !ref.owners || ref.owners.length === 0)) return { decision: 'unknown', owners: [], reason: 'cad_target_ownership_unproven' };
  const knownParts = new Set(uniqueIds(ownership.partIds));
  if (refs.some(ref => (ref.owners ?? []).some(owner => !knownParts.has(owner)))) {
    return { decision: 'unknown', owners: [], reason: 'cad_target_part_unknown' };
  }
  const owners = [...new Set(refs.flatMap(ref => ref.owners ?? []))];
  const crossPartAllowed = feature === 'add_mate' || feature === 'solve_mates';
  if (owners.length > 1 && !crossPartAllowed) return { decision: 'mixed', owners, reason: 'cad_cross_part_operation' };

  const scopeCheck = checkCadMutationScopeOwnership(scope, ownership);
  if (scopeCheck.decision === 'unknown') return scopeCheck;
  if (!scope) return { decision: 'proven', owners };
  const allowedParts = new Set(scopeIds(scope, 'partIds'));
  if (scope.assemblyScope && allowedParts.size === 0) for (const part of ownership.partIds) allowedParts.add(part);
  for (const ref of refs) {
    const explicitlyScoped = (ref.kind === 'feature' && scopeIds(scope, 'featureIds').includes(ref.id))
      || (ref.kind === 'mate' && scopeIds(scope, 'mateIds').includes(ref.id));
    const allowed = (ref.owners ?? []).every(owner => allowedParts.has(owner)) || explicitlyScoped;
    if (!allowed) return { decision: 'out-of-scope', owners, reason: 'cad_target_out_of_scope' };
  }
  return { decision: owners.length > 1 ? 'proven' : 'proven', owners };
}

function catalogFallback(entry: FeatureRegistryEntry): CadCapabilityDefinition {
  return {
    id: entry.id,
    source: 'feature-catalog',
    catalogId: entry.id,
    requiredHostAdapters: [],
    unsupportedReason: 'catalog_presence_is_not_an_execution_capability',
    allowedActions: [],
    description: entry.description,
  };
}

function resolveDefinition(feature: string): CadCapabilityDefinition | null {
  const key = feature.trim().toLowerCase();
  if (!key) return null;
  const direct = CAD_CAPABILITY_REGISTRY.find(item => item.id === key || item.aliases?.includes(key));
  if (direct) return direct;
  const catalog = findById(key);
  if (catalog) {
    // The catalog's linear FEA module is the only catalog entry with a direct
    // AI FEA path today; other modules remain truthful client-only surfaces.
    if (catalog.id === 'fea.static-linear-solver') return {
      id: catalog.id, source: 'feature-catalog', catalogId: catalog.id, tool: 'fea_setup',
      requiredHostAdapters: ['fea'], requiredSelection: 'body', allowedActions: ['create', 'verify'], description: catalog.description,
    };
    if (catalog.id === 'sketch.constraint-solver') return {
      id: catalog.id, source: 'feature-catalog', catalogId: catalog.id, tool: 'sketch_solve',
      requiredHostAdapters: ['solver'], allowedActions: ['modify', 'verify'], description: catalog.description,
    };
    if (catalog.id === 'assembly.mate-dof') return {
      id: catalog.id, source: 'feature-catalog', catalogId: catalog.id, tool: 'solve_mates',
      requiredHostAdapters: ['mateSolver'], allowedActions: ['modify', 'verify'], description: catalog.description,
    };
    if (catalog.id === 'assembly.interference') return {
      id: catalog.id, source: 'feature-catalog', catalogId: catalog.id, tool: 'check_interference',
      requiredHostAdapters: [], allowedActions: ['verify'], description: catalog.description,
    };
    if (catalog.id === 'dfm.rules') return {
      id: catalog.id, source: 'feature-catalog', catalogId: catalog.id, tool: 'read_dfm',
      requiredHostAdapters: ['dfm'], allowedActions: ['verify', 'export'], description: catalog.description,
    };
    if (catalog.id === 'drawing.auto-views') return {
      id: catalog.id, source: 'feature-catalog', catalogId: catalog.id, tool: 'brep_to_drawing',
      requiredHostAdapters: ['drawingStudio', 'brep'], allowedActions: ['create', 'verify', 'export'], description: catalog.description,
    };
    return catalogFallback(catalog);
  }
  return null;
}

function deriveMode(query: CadCapabilityQuery): CadOperationMode {
  if (query.mode) return query.mode;
  return query.prompt && !isNewDesignPrompt(query.prompt) ? 'scoped-modification' : 'new-design';
}

function fallbackForUnknown(query: CadCapabilityQuery, mode: CadOperationMode): CadCapabilityFallback {
  const genericAvailable = query.environment?.genericPlannerAvailable !== false;
  if (query.prompt?.trim() && mode === 'new-design' && genericAvailable) {
    return { kind: 'generic-parametric-planner', available: true, reason: 'unknown_template_can_use_generic_parametric_planner_after_confirmation' };
  }
  return { kind: 'clarification-required', available: false, reason: 'unknown_feature_or_template_requires_clarification' };
}

function allowedActionsFor(definition: CadCapabilityDefinition, mode: CadOperationMode): readonly string[] {
  // A tool may support both creation and edits in the agent registry, but a
  // request mode must not silently widen that mutability contract.
  const filtered = definition.allowedActions.filter(action => mode === 'new-design' ? action !== 'modify' : action !== 'create');
  return filtered;
}

/** Resolve one feature/tool request into an auditable, execution-safe verdict. */
export function getCadCapability(query: CadCapabilityQuery): CadCapabilityReport {
  const operationMode = deriveMode(query);
  const definition = resolveDefinition(query.feature);
  const scope = query.scope && hasScope(query.scope) ? query.scope : null;
  const scopeOwnership = query.environment?.ownership
    ? checkCadMutationScopeOwnership(scope ?? undefined, query.environment.ownership)
    : { decision: 'not-checked' as const, owners: [] as readonly string[] };
  const selectionOwnership = checkCadSelectionOwnership(
    query.selection,
    scope ?? undefined,
    query.environment?.ownership,
    query.feature.trim().toLowerCase(),
  );
  const scopeRequired = operationMode === 'scoped-modification';
  const vocabulary = query.prompt ? normalizeMechanicalVocabulary(query.prompt) : { hits: [], ambiguities: [] };
  const recommendedDomains = query.prompt ? recommendDesignDomains(query.prompt).map(item => item.domain) : [];
  const confidence = query.vocabularyConfidence ?? (vocabulary.hits.length ? Math.min(...vocabulary.hits.map(item => item.confidence)) : 1);
  const clarificationRequired = Boolean(
    query.templateAvailable === false
    || confidence < 0.8
    || vocabulary.ambiguities.length > 0
    || !definition,
  );
  const canUseGenericPlanner = Boolean(query.prompt?.trim())
    && operationMode === 'new-design'
    && query.environment?.genericPlannerAvailable !== false;
  const fallback = clarificationRequired && canUseGenericPlanner
    ? { kind: 'generic-parametric-planner' as const, available: true, reason: 'low_confidence_or_missing_template_can_use_generic_parametric_planner_after_confirmation' }
    : definition ? { kind: clarificationRequired ? 'clarification-required' as const : 'none' as const, available: false, reason: clarificationRequired ? 'low_confidence_or_template_ambiguity' : 'not_needed' }
      : fallbackForUnknown(query, operationMode);
  const base: Omit<CadCapabilityReport, 'status' | 'reason' | 'missingHostAdapters' | 'selectionSatisfied' | 'executionGate'> = {
    feature: query.feature,
    canonicalId: definition?.id ?? null,
    source: definition?.source ?? 'unknown',
    requiredHostAdapters: definition?.requiredHostAdapters ?? [],
    requiredSelection: definition?.requiredSelection ?? null,
    operationMode,
    mutabilityScope: scope,
    scopeRequired,
    allowedActions: definition ? allowedActionsFor(definition, operationMode) : [],
    clarificationRequired,
    fallback,
    recommendedDomains,
    selectionOwnership: selectionOwnership.decision,
  };
  if (!definition) return {
    ...base, status: 'unavailable', reason: 'unknown_feature', missingHostAdapters: [], selectionSatisfied: false,
    executionGate: 'blocked', clarificationRequired: true,
  };
  if (scopeRequired && !scope) return {
    ...base, status: 'unavailable', reason: 'modification_scope_required', missingHostAdapters: [], selectionSatisfied: false,
    executionGate: 'blocked', clarificationRequired: true,
  };
  if (scopeRequired && query.environment?.ownership && scopeOwnership.decision !== 'proven') return {
    ...base, status: 'unavailable', reason: scopeOwnership.reason ?? 'cad_scope_ownership_unproven', missingHostAdapters: [], selectionSatisfied: false,
    executionGate: 'blocked', clarificationRequired: true,
  };
  if (definition.unsupportedReason) return {
    ...base, status: 'unavailable', reason: definition.unsupportedReason, missingHostAdapters: definition.requiredHostAdapters.filter(adapter => !adapterAvailable(query.environment?.hostAdapters, adapter)), selectionSatisfied: false,
    executionGate: 'blocked',
  };
  const selectionSatisfied = !definition.requiredSelection || selectionCount(query.selection, definition.requiredSelection) > 0;
  if (!selectionSatisfied) return {
    ...base, status: 'requires-selection', reason: `selection_required:${definition.requiredSelection}`, missingHostAdapters: [], selectionSatisfied: false,
    executionGate: 'blocked',
  };
  if (scopeRequired && selectionOwnership.decision !== 'not-required' && selectionOwnership.decision !== 'not-checked' && selectionOwnership.decision !== 'proven') return {
    ...base, status: 'unavailable', reason: selectionOwnership.reason ?? `cad_target_${selectionOwnership.decision}`,
    missingHostAdapters: [], selectionSatisfied, executionGate: 'blocked', clarificationRequired: true,
  };
  if (definition.clientOnly) return {
    ...base, status: 'client-only', reason: query.environment?.clientDispatcherAvailable ? 'client_dispatcher_available' : 'client_dispatcher_required', missingHostAdapters: [], selectionSatisfied,
    executionGate: !query.environment?.clientDispatcherAvailable ? 'blocked' : clarificationRequired ? 'confirm-before-execute' : 'open',
  };
  const missingHostAdapters = definition.requiredHostAdapters.filter(adapter => !adapterAvailable(query.environment?.hostAdapters, adapter));
  if (missingHostAdapters.length > 0) return {
    ...base, status: 'unavailable', reason: `required_host_adapter_missing:${missingHostAdapters.join(',')}`, missingHostAdapters, selectionSatisfied,
    executionGate: 'blocked',
  };
  const registeredTool = definition.tool ?? (definition.source === 'scad-agent' ? definition.id : undefined);
  if (registeredTool && !hasTool(query.environment?.tools, registeredTool)) return {
    ...base, status: 'unavailable', reason: `agent_tool_not_registered:${registeredTool}`, missingHostAdapters: [], selectionSatisfied,
    executionGate: 'blocked',
  };
  if (definition.mockPartial) return {
    ...base, status: 'mock-partial', reason: 'mock_adapter_only_production_solver_required', missingHostAdapters: [], selectionSatisfied,
    executionGate: clarificationRequired ? 'confirm-before-execute' : 'open',
  };
  const mockedHostAdapters = definition.requiredHostAdapters.filter(adapter => query.environment?.mockAdapters?.includes(adapter));
  if (mockedHostAdapters.length > 0) return {
    ...base, status: 'mock-partial', reason: `mock_host_adapter:${mockedHostAdapters.join(',')}`, missingHostAdapters: [], selectionSatisfied,
    executionGate: 'confirm-before-execute',
  };
  return {
    ...base, status: 'executable', reason: clarificationRequired ? 'confirmation_required_before_execution' : 'agent_tool_and_host_adapter_ready', missingHostAdapters: [], selectionSatisfied,
    executionGate: clarificationRequired ? 'confirm-before-execute' : 'open',
  };
}

/** Alias used by routing code that treats capability resolution as a lookup. */
export const resolveCadCapability = getCadCapability;

export function listCadCapabilities(): readonly CadCapabilityDefinition[] {
  return CAD_CAPABILITY_REGISTRY;
}

/** Convert the injected makeTools host shape into the truth-layer snapshot. */
export function snapshotCadHostAdapters(host: Partial<ToolHostAdapters>): Partial<Record<CadHostAdapterName, boolean>> {
  return {
    render: Boolean(host.render), geometry: Boolean(host.geometry), dfm: Boolean(host.dfm), vision: Boolean(host.vision),
    brep: Boolean(host.brep), solver: Boolean(host.solver), mateSolver: Boolean(host.mateSolver), drawingStudio: Boolean(host.drawingStudio),
    collab: Boolean(host.collab), docRefs: Boolean(host.docRefs), fea: Boolean(host.fea),
  };
}
