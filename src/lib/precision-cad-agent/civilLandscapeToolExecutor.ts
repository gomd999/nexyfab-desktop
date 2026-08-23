import { createHash } from 'node:crypto';
import { validateCivilDocument, type CivilDocument } from '@/lib/ai/civilDocument';
import { validateLandscapeDocument, type LandscapeDocument } from '@/lib/ai/landscapeDocument';
import {
  CIVIL_LANDSCAPE_TOOL_CATALOG_VERSION,
  getCivilLandscapeTool,
  validateCivilLandscapeToolArguments,
  validateCivilLandscapeToolCatalog,
  type CivilLandscapeDomain,
} from './civilLandscapeToolCatalog';

export const CIVIL_LANDSCAPE_WORKSPACE_SCHEMA = 'nexyfab.precision-cad.civil-landscape-workspace.v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_COORDINATE = 1_000_000_000;
type RecordValue = Record<string, unknown>;

export type CivilLandscapeArtifact = {
  id: string;
  documentId: string;
  revision: number;
  state: 'current' | 'stale';
  contentHash: string;
};

export type CivilLandscapeDocumentEnvelope = {
  documentId: string;
  domain: CivilLandscapeDomain;
  document: CivilDocument | LandscapeDocument;
};

export type CivilLandscapeAgentWorkspace = {
  schema: typeof CIVIL_LANDSCAPE_WORKSPACE_SCHEMA;
  projectId: string;
  revision: number;
  contentHash: string;
  coordinateSystemIds: string[];
  documents: CivilLandscapeDocumentEnvelope[];
  artifacts: CivilLandscapeArtifact[];
};

export type CivilLandscapeToolPlan = {
  schema: typeof CIVIL_LANDSCAPE_TOOL_CATALOG_VERSION;
  planHash: string;
  projectId: string;
  documentId: string;
  domain: CivilLandscapeDomain;
  tool: string;
  arguments: RecordValue;
  baseRevision: number;
  baseContentHash: string;
  status: 'planned';
};

export type CivilLandscapeToolChallenge = {
  schema: typeof CIVIL_LANDSCAPE_TOOL_CATALOG_VERSION;
  challengeHash: string;
  planHash: string;
  commandHash: string;
  checks: readonly string[];
  status: 'challenged';
};

export type CivilLandscapeApproval = {
  approved: true;
  approvalId: string;
  actorId: string;
  challengeHash: string;
  commandHash: string;
};

export type CivilLandscapeTransactionReceipt = {
  schema: 'nexyfab.precision-cad.civil-landscape-receipt.v1';
  status: 'committed';
  projectId: string;
  documentId: string;
  domain: CivilLandscapeDomain;
  tool: string;
  commandHash: string;
  challengeHash: string;
  approvalId: string;
  actorId: string;
  beforeRevision: number;
  afterRevision: number;
  beforeContentHash: string;
  afterContentHash: string;
  affectedObjectIds: readonly string[];
  invalidatedArtifactIds: readonly string[];
};

export type CivilLandscapeToolExecutionResult =
  | { committed: true; workspace: CivilLandscapeAgentWorkspace; receipt: CivilLandscapeTransactionReceipt }
  | { committed: false; workspace: CivilLandscapeAgentWorkspace; code: 'workspace_invalid' | 'binding_mismatch' | 'approval_required' | 'challenge_invalid' | 'tool_not_executable' | 'validation_failed' | 'edit_failed' };

function isRecord(value: unknown): value is RecordValue { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) { if (ancestors.has(value)) throw new Error('cycle'); const next = new Set(ancestors).add(value); return `[${value.map(item => canonical(item, next)).join(',')}]`; }
  if (value && typeof value === 'object') { if (ancestors.has(value)) throw new Error('cycle'); const next = new Set(ancestors).add(value); return `{${Object.keys(value as RecordValue).filter(key => (value as RecordValue)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as RecordValue)[key], next)}`).join(',')}}`; }
  return 'null';
}
function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function clone<T>(value: T): T { return structuredClone(value); }
function stringValue(args: RecordValue, key: string): string | null { return typeof args[key] === 'string' && String(args[key]).trim() ? String(args[key]) : null; }
function numericValue(args: RecordValue, key: string): number | null { return typeof args[key] === 'number' && Number.isFinite(args[key]) ? args[key] as number : null; }
function bounded(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
  if (Array.isArray(value)) return value.every(bounded);
  return !value || typeof value !== 'object' || Object.values(value as RecordValue).every(bounded);
}
const SENSITIVE_KEY = /(?:^|_)(?:path|url|uri|secret|token|password|credential|api[_-]?key)(?:$|_)/i;
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;
function safeArguments(value: unknown, key = '', ancestors = new Set<object>()): boolean {
  if (SENSITIVE_KEY.test(key)) return false;
  if (typeof value === 'string') return value.length <= 10_000 && !CONTROL_CHAR.test(value);
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
  if (value === null || typeof value === 'boolean') return true;
  if (!value || typeof value !== 'object' || ancestors.has(value)) return false;
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) return value.length <= 100_000 && value.every(item => safeArguments(item, key, next));
  return Object.entries(value as RecordValue).every(([childKey, child]) => safeArguments(child, childKey, next));
}
function documentsById(workspace: CivilLandscapeAgentWorkspace): Map<string, CivilLandscapeDocumentEnvelope> { return new Map(workspace.documents.map(item => [item.documentId, item])); }

export function hashCivilLandscapeWorkspace(workspace: CivilLandscapeAgentWorkspace): string {
  const copy = clone(workspace); copy.contentHash = ''; return hash(copy);
}

export function validateCivilLandscapeWorkspace(value: unknown): string[] {
  if (!isRecord(value)) return ['workspace_invalid'];
  const workspace = value as unknown as CivilLandscapeAgentWorkspace, issues: string[] = [];
  if (workspace.schema !== CIVIL_LANDSCAPE_WORKSPACE_SCHEMA || !workspace.projectId?.trim() || !Number.isSafeInteger(workspace.revision) || workspace.revision < 0 || !SHA256.test(workspace.contentHash)) issues.push('workspace_header_invalid');
  if (!Array.isArray(workspace.coordinateSystemIds) || workspace.coordinateSystemIds.length === 0 || workspace.coordinateSystemIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(workspace.coordinateSystemIds).size !== workspace.coordinateSystemIds.length) issues.push('coordinate_system_invalid');
  const envelopes = Array.isArray(workspace.documents) ? workspace.documents : [];
  if (envelopes.length === 0) issues.push('document_envelope_missing');
  const ids = new Set<string>();
  for (const envelope of envelopes) {
    if (!envelope || !envelope.documentId?.trim() || ids.has(envelope.documentId) || !['civil', 'landscape'].includes(envelope.domain)) { issues.push('document_binding_invalid'); continue; }
    ids.add(envelope.documentId);
    if (!envelope.document || envelope.document.revision !== workspace.revision || !workspace.coordinateSystemIds.includes(envelope.document.coordinateSystemId)) issues.push(`document_revision_or_coordinate_invalid:${envelope.documentId}`);
    try {
      const documentIssues = envelope.domain === 'civil' ? validateCivilDocument(envelope.document as CivilDocument) : validateLandscapeDocument(envelope.document as LandscapeDocument);
      if (documentIssues.length) issues.push(`document_invalid:${envelope.documentId}`);
    } catch { issues.push(`document_invalid:${envelope.documentId}`); }
  }
  const artifacts = Array.isArray(workspace.artifacts) ? workspace.artifacts : [];
  if (!Array.isArray(workspace.artifacts)) issues.push('artifact_binding_invalid');
  for (const artifact of artifacts) if (!artifact?.id?.trim() || !ids.has(artifact.documentId) || !Number.isSafeInteger(artifact.revision) || !['current', 'stale'].includes(artifact.state) || !SHA256.test(artifact.contentHash)) issues.push('artifact_binding_invalid');
  const civil = envelopes.find(item => item.domain === 'civil');
  const landscape = envelopes.find(item => item.domain === 'landscape');
  if (civil && landscape) {
    const civilModel = civil.document as CivilDocument, model = landscape.document as LandscapeDocument;
    if (model.terrain?.civilDocumentId !== civil.documentId || model.terrain?.civilRevision !== civilModel.revision || !civilModel.surfaces?.some(surface => surface.id === model.terrain?.surfaceId)) issues.push('landscape_civil_binding_invalid');
  }
  try { if (SHA256.test(workspace.contentHash) && hashCivilLandscapeWorkspace(workspace) !== workspace.contentHash) issues.push('workspace_content_hash_mismatch'); } catch { issues.push('workspace_hash_invalid'); }
  return [...new Set(issues)];
}

function baseBinding(args: RecordValue, workspace: CivilLandscapeAgentWorkspace, envelope: CivilLandscapeDocumentEnvelope): boolean {
  return stringValue(args, 'projectId') === workspace.projectId && stringValue(args, 'documentId') === envelope.documentId && numericValue(args, 'revision') === workspace.revision && stringValue(args, 'contentHash') === workspace.contentHash;
}

function ensureObjectId(args: RecordValue): string | null { return stringValue(args, 'objectId'); }
function existingIds(document: CivilDocument | LandscapeDocument): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isRecord(value)) return;
    if (typeof value.id === 'string') ids.add(value.id);
    Object.values(value).forEach(visit);
  };
  visit(document);
  return ids;
}
function mutateDocument(envelope: CivilLandscapeDocumentEnvelope, tool: string, args: RecordValue): { document: CivilDocument | LandscapeDocument; affectedObjectIds: string[] } | null {
  const document = clone(envelope.document) as CivilDocument | LandscapeDocument, id = ensureObjectId(args), ids = existingIds(document);
  if (!id || !bounded(args)) return null;
  if (tool === 'edit_profile_point') {
    if (envelope.domain !== 'civil') return null;
    const profileId = stringValue(args, 'profileId');
    const model = document as CivilDocument;
    const profile = profileId ? model.profiles.find(item => item.id === profileId) : undefined;
    const index = profile?.points.findIndex(point => point.id === id) ?? -1;
    if (!profile || index < 0) return null;
    const current = profile.points[index]!;
    const stationM = args.stationM === undefined ? current.stationM : numericValue(args, 'stationM');
    const elevationM = args.elevationM === undefined ? current.elevationM : numericValue(args, 'elevationM');
    if (stationM === null || elevationM === null) return null;
    const updated = { ...current, stationM, elevationM };
    if (canonical(current) === canonical(updated)) return null;
    profile.points[index] = updated;
    return { document, affectedObjectIds: [profile.id, id] };
  }
  const field = tool.replace(/^(create|edit)_/, '');
  const collectionMap: Record<string, string> = { survey_control: 'surveyControls', point: 'points', surface: 'surfaces', alignment: 'alignments', profile: 'profiles', vertical_curve: 'verticalCurves', superelevation_region: 'superelevations', corridor_target: 'corridorTargets', corridor: 'corridors', cross_section: 'crossSections', drainage_node: 'drainageNodes', drainage_link: 'drainageLinks', catchment: 'catchments', structure: 'structures', plant: 'plants', soil_volume: 'soilVolumes', planting_zone: 'plantingZones', hardscape: 'hardscapes', irrigation_node: 'irrigationNodes', irrigation_pipe: 'irrigationPipes', irrigation_zone: 'irrigationZones', drainage_path: 'drainagePaths', maintenance_zone: 'maintenanceZones', terrain_modifier: 'terrainModifiers' };
  const collection = collectionMap[field];
  if (!collection) return null;
  const record = document as unknown as RecordValue;
  // Optional collections are materialized only when their executable create
  // tool is invoked; legacy documents remain valid without them.
  if (!Array.isArray(record[collection])) {
    if (collection !== 'terrainModifiers' && collection !== 'verticalCurves' && collection !== 'superelevations' && collection !== 'corridorTargets') return null;
    record[collection] = [];
  }
  const target = record[collection] as unknown[];
  const isEdit = tool.startsWith('edit_'), index = target.findIndex(item => isRecord(item) && item.id === id);
  if (isEdit && index < 0) return null;
  if (!isEdit && ids.has(id)) return null;
  const omitBase = (key: string) => !['projectId', 'documentId', 'revision', 'contentHash', 'objectId'].includes(key);
  if (isEdit) {
    const current = target[index] as RecordValue;
    if (tool === 'edit_profile' && Array.isArray(current.points) && current.points.some(point => isRecord(point) && typeof point.id === 'string') && args.points !== undefined) {
      if (!Array.isArray(args.points)) return null;
      const currentIds = current.points.map(point => isRecord(point) && typeof point.id === 'string' ? point.id : null);
      const nextIds = args.points.map(point => isRecord(point) && typeof point.id === 'string' ? point.id : null);
      if (currentIds.some(value => value === null) || nextIds.some(value => value === null) || canonical([...currentIds].sort()) !== canonical([...nextIds].sort())) return null;
    }
    const updated = { ...current, ...Object.fromEntries(Object.entries(args).filter(([key]) => omitBase(key))) };
    if (field === 'corridor_target') {
      const kind = updated.kind;
      // A target role owns exactly one optional value/reference family. Clear
      // inherited fields when an edit changes kind, while rejecting explicit
      // contradictory fields so edits remain fail-closed.
      if (kind === 'surface' || kind === 'alignment') {
        if (args.offsetM !== undefined || args.elevationM !== undefined) return null;
        delete updated.offsetM;
        delete updated.elevationM;
      } else if (kind === 'offset') {
        if (args.targetObjectId !== undefined || args.elevationM !== undefined) return null;
        delete updated.targetObjectId;
        delete updated.elevationM;
      } else if (kind === 'elevation') {
        if (args.targetObjectId !== undefined || args.offsetM !== undefined) return null;
        delete updated.targetObjectId;
        delete updated.offsetM;
      }
    }
    if (canonical(current) === canonical(updated)) return null;
    target[index] = updated;
  } else target.push({ id, ...Object.fromEntries(Object.entries(args).filter(([key]) => omitBase(key))) });
  return { document, affectedObjectIds: [id] };
}

function artifactHash(artifact: CivilLandscapeArtifact): string { return hash({ id: artifact.id, documentId: artifact.documentId, revision: artifact.revision, state: artifact.state }); }
function invalidateArtifacts(workspace: CivilLandscapeAgentWorkspace, _documentId: string, nextRevision: number): { artifacts: CivilLandscapeArtifact[]; invalidated: string[] } {
  const invalidated: string[] = [];
  // This workspace has one shared revision but no dependency graph between
  // artifact kinds yet.  Conservatively stale every current artifact on any
  // domain edit; leaving a sibling artifact current would falsely advertise
  // that it was rebuilt against the new shared revision.
  const artifacts = workspace.artifacts.map(artifact => {
    if (artifact.state === 'stale') return clone(artifact);
    invalidated.push(artifact.id);
    const stale = { ...clone(artifact), revision: nextRevision, state: 'stale' as const };
    return { ...stale, contentHash: artifactHash(stale) };
  });
  return { artifacts, invalidated };
}

export function planCivilLandscapeTool(input: { workspace: CivilLandscapeAgentWorkspace; tool: string; arguments: unknown }): CivilLandscapeToolPlan | null {
  if (validateCivilLandscapeWorkspace(input.workspace).length || !isRecord(input.arguments)) return null;
  const definition = getCivilLandscapeTool(input.tool), args = input.arguments;
  if (!definition || definition.execution !== 'executable' || definition.scope !== 'apply' || validateCivilLandscapeToolArguments(input.tool, args).length || !bounded(args) || !safeArguments(args)) return null;
  const envelope = documentsById(input.workspace).get(stringValue(args, 'documentId') ?? '');
  if (!envelope || envelope.domain !== definition.domain || !baseBinding(args, input.workspace, envelope)) return null;
  const base = { schema: CIVIL_LANDSCAPE_TOOL_CATALOG_VERSION, projectId: input.workspace.projectId, documentId: envelope.documentId, domain: envelope.domain, tool: input.tool, arguments: clone(args), baseRevision: input.workspace.revision, baseContentHash: input.workspace.contentHash, status: 'planned' as const };
  return { ...base, planHash: hash(base) };
}

export function challengeCivilLandscapeTool(plan: CivilLandscapeToolPlan): CivilLandscapeToolChallenge {
  const commandHash = hash({ schema: CIVIL_LANDSCAPE_TOOL_CATALOG_VERSION, purpose: 'command', planHash: plan.planHash, tool: plan.tool, arguments: plan.arguments, baseRevision: plan.baseRevision, baseContentHash: plan.baseContentHash });
  const base = { schema: CIVIL_LANDSCAPE_TOOL_CATALOG_VERSION, planHash: plan.planHash, commandHash, checks: ['project_document_binding', 'revision_content_hash_binding', 'finite_coordinate_bounds', 'domain_document_validation', 'vertical_curve_profile_pvi_binding', 'superelevation_alignment_station_binding', 'corridor_target_ownership_station_binding', 'atomic_revision_commit'], status: 'challenged' as const };
  return { ...base, challengeHash: hash(base) };
}

export function executeCivilLandscapeTool(input: { workspace: CivilLandscapeAgentWorkspace; plan: CivilLandscapeToolPlan; challenge: CivilLandscapeToolChallenge; approval?: CivilLandscapeApproval }): CivilLandscapeToolExecutionResult {
  const original = input.workspace;
  if (validateCivilLandscapeWorkspace(original).length) return { committed: false, workspace: original, code: 'workspace_invalid' };
  const args = input.plan.arguments, envelope = documentsById(original).get(input.plan.documentId), definition = getCivilLandscapeTool(input.plan.tool);
  if (!envelope || !definition || definition.execution !== 'executable' || definition.domain !== envelope.domain || !baseBinding(args, original, envelope) || input.plan.baseRevision !== original.revision || input.plan.baseContentHash !== original.contentHash) return { committed: false, workspace: original, code: 'binding_mismatch' };
  const expectedPlan = planCivilLandscapeTool({ workspace: original, tool: input.plan.tool, arguments: args });
  const expectedChallenge = expectedPlan ? challengeCivilLandscapeTool(expectedPlan) : null;
  if (!expectedPlan || expectedPlan.planHash !== input.plan.planHash || !expectedChallenge || expectedChallenge.challengeHash !== input.challenge.challengeHash || expectedChallenge.commandHash !== input.challenge.commandHash || input.challenge.planHash !== input.plan.planHash) return { committed: false, workspace: original, code: 'challenge_invalid' };
  const approval = input.approval;
  // Treat malformed/forged approval payloads as a normal fail-closed refusal;
  // never invoke string methods on untrusted runtime values.
  if (approval?.approved !== true
    || typeof approval.approvalId !== 'string'
    || !approval.approvalId.trim()
    || typeof approval.actorId !== 'string'
    || !approval.actorId.trim()
    || approval.challengeHash !== input.challenge.challengeHash
    || approval.commandHash !== input.challenge.commandHash) return { committed: false, workspace: original, code: 'approval_required' };
  const changed = mutateDocument(envelope, input.plan.tool, args);
  if (!changed) return { committed: false, workspace: original, code: 'edit_failed' };
  const nextRevision = original.revision + 1, candidate = clone(original), target = candidate.documents.find(item => item.documentId === envelope.documentId)!;
  target.document = { ...changed.document, revision: nextRevision } as CivilDocument | LandscapeDocument;
  // A workspace revision is shared by all loaded domain envelopes. Unchanged
  // envelopes advance their revision marker atomically as well, so a stale
  // sibling can never be combined with a new civil/landscape command.
  candidate.documents = candidate.documents.map(item => {
    const document = { ...item.document, revision: nextRevision } as CivilDocument | LandscapeDocument;
    if (item.domain === 'landscape') {
      const landscape = document as LandscapeDocument;
      if (landscape.terrain?.civilDocumentId === candidate.documents.find(candidateItem => candidateItem.domain === 'civil')?.documentId) landscape.terrain = { ...landscape.terrain, civilRevision: nextRevision };
    }
    return { ...item, document };
  });
  candidate.revision = nextRevision;
  const invalidation = invalidateArtifacts(candidate, envelope.documentId, nextRevision);
  candidate.artifacts = invalidation.artifacts;
  candidate.contentHash = '';
  candidate.contentHash = hashCivilLandscapeWorkspace(candidate);
  if (validateCivilLandscapeWorkspace(candidate).length) return { committed: false, workspace: original, code: 'validation_failed' };
  const receipt: CivilLandscapeTransactionReceipt = { schema: 'nexyfab.precision-cad.civil-landscape-receipt.v1', status: 'committed', projectId: original.projectId, documentId: envelope.documentId, domain: envelope.domain, tool: input.plan.tool, commandHash: input.challenge.commandHash, challengeHash: input.challenge.challengeHash, approvalId: approval.approvalId, actorId: approval.actorId, beforeRevision: original.revision, afterRevision: nextRevision, beforeContentHash: original.contentHash, afterContentHash: candidate.contentHash, affectedObjectIds: changed.affectedObjectIds, invalidatedArtifactIds: invalidation.invalidated };
  return { committed: true, workspace: candidate, receipt };
}

export function validateCivilLandscapeExecutorSetup(): string[] { return validateCivilLandscapeToolCatalog(); }
