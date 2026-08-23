import { createHash } from 'node:crypto';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';

export const CONSTRUCTION_WORK_PACKAGE_SCHEMA = 'nexyfab.construction-work-package-release.v1' as const;
export const CONSTRUCTION_WORK_PACKAGE_RECEIPT_SCHEMA = 'nexyfab.construction-work-package-release-probe.v1' as const;
export const CONSTRUCTION_WORK_PACKAGE_CAPABILITY_ID = 'construction.work-package.4d.internal' as const;
export const CONSTRUCTION_WORK_PACKAGE_LIMITS = {
  sourceArtifactBytes: 16 * 1024 * 1024,
  totalSourceArtifactBytes: 48 * 1024 * 1024,
  outputArtifactBytes: 16 * 1024 * 1024,
  parserOutputBytes: 16 * 1024 * 1024,
  verifierEvidenceBytes: 256 * 1024,
  receiptBytes: 2 * 1024 * 1024,
  workspaceRevisionBytes: 16 * 1024 * 1024,
  workspaceRevisionNodes: 100_000,
  workspaceRevisionDepth: 32,
  elements: 4_096,
  activities: 2_048,
  workPackages: 2_048,
  crews: 2_048,
  inspections: 4_096,
  elementRefsPerActivity: 256,
  predecessorsPerActivity: 256,
  activityRefsPerWorkPackage: 2_048,
  totalElementRefs: 8_192,
  totalPredecessorEdges: 8_192,
  totalPackageActivityRefs: 4_096,
} as const;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identifier = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && value.trim() === value;
const exact = (value: unknown, keys: readonly string[]) => record(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const sorted = <T extends { id: string }>(values: readonly T[]) => [...values].sort((a, b) => a.id.localeCompare(b.id));
const sortedIds = (values: readonly { id: string }[]) => values.every((item, index) => index === 0 || values[index - 1]!.id.localeCompare(item.id) < 0);

function boundedWorkspaceRevision(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (!current || nodes > CONSTRUCTION_WORK_PACKAGE_LIMITS.workspaceRevisionNodes || current.depth > CONSTRUCTION_WORK_PACKAGE_LIMITS.workspaceRevisionDepth) return false;
    if (typeof current.value === 'number' && !Number.isFinite(current.value)) return false;
    if (typeof current.value === 'string' && encoder.encode(current.value).byteLength > CONSTRUCTION_WORK_PACKAGE_LIMITS.workspaceRevisionBytes) return false;
    if (Array.isArray(current.value)) {
      if (current.value.length > CONSTRUCTION_WORK_PACKAGE_LIMITS.workspaceRevisionNodes) return false;
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
    } else if (record(current.value)) {
      const entries = Object.entries(current.value);
      if (entries.length > CONSTRUCTION_WORK_PACKAGE_LIMITS.workspaceRevisionNodes || entries.some(([key]) => ['__proto__', 'prototype', 'constructor'].includes(key))) return false;
      for (const [, item] of entries) stack.push({ value: item, depth: current.depth + 1 });
    }
  }
  return true;
}

export type ConstructionReleaseArtifact = { id: string; kind: 'federated_model' | 'quantity' | 'drawing' | 'ifc'; bytes: Uint8Array; artifactSha256?: string };
export type ConstructionReleaseElement = {
  id: string;
  kind: 'concrete' | 'rebar' | 'formwork' | 'other';
  zoneId: string;
  quantity: { value: number; unit: 'm3' | 'kg' | 'm2' | 'each' };
  sourceObjectSha256: string;
  workspaceRevisionId: string;
  workspaceContentHash: string;
  quantityArtifactSha256: string;
  drawingArtifactSha256: string;
  ifcArtifactSha256: string;
  installationToleranceMm: number;
};
export type ConstructionReleaseActivity = {
  id: string;
  workPackageId: string;
  elementIds: string[];
  crewId: string;
  zoneId: string;
  startDate: string;
  endDate: string;
  timezone: 'UTC';
  predecessors: string[];
  installationToleranceMm: number;
};
export type ConstructionReleaseWorkPackage = { id: string; activityIds: string[]; crewId: string; zoneId: string };
export type ConstructionReleaseCrew = { id: string; maxConcurrent: 1 };
export type ConstructionReleaseInspection = { id: string; activityId: string; required: true };

export type ConstructionWorkPackageReleaseInput = {
  workspaceRevisionId: string;
  expectedWorkspaceRevisionId: string;
  workspaceRevisionValue: unknown;
  expectedWorkspaceContentHash: string;
  federatedModel: ConstructionReleaseArtifact;
  quantityArtifact: ConstructionReleaseArtifact;
  drawingArtifact: ConstructionReleaseArtifact;
  ifcArtifact: ConstructionReleaseArtifact;
  elements: ConstructionReleaseElement[];
  activities: ConstructionReleaseActivity[];
  workPackages: ConstructionReleaseWorkPackage[];
  crews: ConstructionReleaseCrew[];
  inspections: ConstructionReleaseInspection[];
  artifactName?: string;
};

export type ConstructionWorkPackageReleasePayload = {
  schema: typeof CONSTRUCTION_WORK_PACKAGE_SCHEMA;
  binding: { workspaceRevisionId: string; workspaceContentHash: string; federatedModelArtifactSha256: string; quantityArtifactSha256: string; drawingArtifactSha256: string; ifcArtifactSha256: string };
  units: { length: 'mm'; tolerance: 'mm'; quantity: 'm3|kg|m2|each' };
  calendar: { dateTime: 'ISO-8601'; timezone: 'UTC'; predecessorType: 'finish_to_start' };
  artifacts: Array<{ id: string; kind: ConstructionReleaseArtifact['kind']; sha256: string; bytes: number }>;
  elements: ConstructionReleaseElement[];
  activities: ConstructionReleaseActivity[];
  workPackages: ConstructionReleaseWorkPackage[];
  crews: ConstructionReleaseCrew[];
  inspections: ConstructionReleaseInspection[];
  counts: { elements: number; activities: number; workPackages: number; crews: number; inspections: number };
  fieldProgress: 'NOT_RUN';
  safetyPermit: 'HOLD';
  surveyAsBuilt: 'NOT_RUN';
  inspectorSignature: 'HOLD';
  contractorSignature: 'HOLD';
  releaseReady: false;
};
export type ConstructionWorkPackageReleaseArtifact = { payload: ConstructionWorkPackageReleasePayload; contentHash: string; bytes: Uint8Array; artifactSha256: string; artifactName: string; artifactMime: 'application/json' };
export type ConstructionWorkPackageReleaseParseResult = { payload: ConstructionWorkPackageReleasePayload; contentHash: string; artifactSha256: string };
export type ConstructionWorkPackageReleaseVerification =
  | { status: 'passed'; verifierId: 'construction-work-package-structural.v1'; issues: [] }
  | { status: 'failed'; verifierId: 'construction-work-package-structural.v1'; issues: string[] };
export type ConstructionWorkPackageReleaseReceipt = {
  schema: typeof CONSTRUCTION_WORK_PACKAGE_RECEIPT_SCHEMA;
  capabilityId: typeof CONSTRUCTION_WORK_PACKAGE_CAPABILITY_ID;
  format: 'json';
  workspaceRevisionId: string;
  workspaceContentHash: string;
  federatedModelArtifactSha256: string;
  quantityArtifactSha256: string;
  drawingArtifactSha256: string;
  ifcArtifactSha256: string;
  artifactSha256: string;
  artifactBytes: number;
  parserResult: 'verified';
  parserOutputSha256: string;
  verifierEvidenceSha256: string;
  stableIds: { elements: string[]; activities: string[]; workPackages: string[]; crews: string[]; inspections: string[] };
  fieldProgress: 'NOT_RUN';
  safetyPermit: 'HOLD';
  surveyAsBuilt: 'NOT_RUN';
  inspectorSignature: 'HOLD';
  contractorSignature: 'HOLD';
  releaseReady: false;
};

function dateValid(value: unknown): value is string { return typeof value === 'string' && DATE.test(value) && new Date(value).toISOString() === value; }
function artifactHashes(input: Pick<ConstructionWorkPackageReleaseInput, 'federatedModel' | 'quantityArtifact' | 'drawingArtifact' | 'ifcArtifact'>): Array<{ id: string; kind: ConstructionReleaseArtifact['kind']; sha256: string; bytes: number }> {
  const artifacts = [
    { artifact: input.federatedModel, expectedKind: 'federated_model' as const },
    { artifact: input.quantityArtifact, expectedKind: 'quantity' as const },
    { artifact: input.drawingArtifact, expectedKind: 'drawing' as const },
    { artifact: input.ifcArtifact, expectedKind: 'ifc' as const },
  ];
  let totalBytes = 0;
  for (const { artifact } of artifacts) {
    if (!record(artifact) || !(artifact.bytes instanceof Uint8Array) || artifact.bytes.byteLength === 0) throw new Error('CONSTRUCTION_WORK_PACKAGE_ARTIFACT_HASH_MISMATCH');
    if (artifact.bytes.byteLength > CONSTRUCTION_WORK_PACKAGE_LIMITS.sourceArtifactBytes) throw new Error('CONSTRUCTION_WORK_PACKAGE_SOURCE_ARTIFACT_TOO_LARGE');
    totalBytes += artifact.bytes.byteLength;
    if (totalBytes > CONSTRUCTION_WORK_PACKAGE_LIMITS.totalSourceArtifactBytes) throw new Error('CONSTRUCTION_WORK_PACKAGE_SOURCE_ARTIFACT_TOTAL_TOO_LARGE');
  }
  const ids = new Set<string>(), kinds = new Set<ConstructionReleaseArtifact['kind']>();
  return artifacts.map(({ artifact, expectedKind }) => {
    if (!identifier(artifact.id) || ids.has(artifact.id) || artifact.kind !== expectedKind || kinds.has(artifact.kind) || !(artifact.bytes instanceof Uint8Array) || artifact.bytes.byteLength === 0 || (artifact.artifactSha256 !== undefined && artifact.artifactSha256 !== hash(artifact.bytes))) throw new Error('CONSTRUCTION_WORK_PACKAGE_ARTIFACT_HASH_MISMATCH');
    ids.add(artifact.id);
    kinds.add(artifact.kind);
    return { id: artifact.id, kind: artifact.kind, sha256: hash(artifact.bytes), bytes: artifact.bytes.byteLength };
  }).sort((left, right) => left.id.localeCompare(right.id));
}
function sourceArtifactHash(artifacts: readonly { kind: ConstructionReleaseArtifact['kind']; sha256: string }[], kind: ConstructionReleaseArtifact['kind']): string { const artifact = artifacts.find(item => item.kind === kind); if (!artifact) throw new Error('CONSTRUCTION_WORK_PACKAGE_ARTIFACT_KIND_MISSING'); return artifact.sha256; }

type BoundedConstructionCollections = Pick<ConstructionWorkPackageReleasePayload, 'elements' | 'activities' | 'workPackages' | 'crews' | 'inspections'>;

function collectionLimitIssues(value: Partial<BoundedConstructionCollections>): string[] {
  const issues: string[] = [];
  const collections = [
    ['elements', value.elements, CONSTRUCTION_WORK_PACKAGE_LIMITS.elements],
    ['activities', value.activities, CONSTRUCTION_WORK_PACKAGE_LIMITS.activities],
    ['workPackages', value.workPackages, CONSTRUCTION_WORK_PACKAGE_LIMITS.workPackages],
    ['crews', value.crews, CONSTRUCTION_WORK_PACKAGE_LIMITS.crews],
    ['inspections', value.inspections, CONSTRUCTION_WORK_PACKAGE_LIMITS.inspections],
  ] as const;
  for (const [name, items, limit] of collections) {
    if (!Array.isArray(items)) issues.push(`work_package_collection_invalid:${name}`);
    else if (items.length > limit) issues.push(`work_package_collection_limit_exceeded:${name}`);
  }
  if (issues.length) return issues;
  let elementRefs = 0, predecessorEdges = 0, packageActivityRefs = 0;
  for (const activity of value.activities!) {
    if (!record(activity) || !Array.isArray(activity.elementIds) || !Array.isArray(activity.predecessors)) { issues.push('work_package_activity_shape_invalid'); continue; }
    if (activity.elementIds.length > CONSTRUCTION_WORK_PACKAGE_LIMITS.elementRefsPerActivity) issues.push(`work_package_relation_limit_exceeded:activity_element_ids:${String(activity.id)}`);
    if (activity.predecessors.length > CONSTRUCTION_WORK_PACKAGE_LIMITS.predecessorsPerActivity) issues.push(`work_package_relation_limit_exceeded:activity_predecessors:${String(activity.id)}`);
    elementRefs += activity.elementIds.length;
    predecessorEdges += activity.predecessors.length;
  }
  for (const workPackage of value.workPackages!) {
    if (!record(workPackage) || !Array.isArray(workPackage.activityIds)) { issues.push('work_package_definition_shape_invalid'); continue; }
    if (workPackage.activityIds.length > CONSTRUCTION_WORK_PACKAGE_LIMITS.activityRefsPerWorkPackage) issues.push(`work_package_relation_limit_exceeded:work_package_activity_ids:${String(workPackage.id)}`);
    packageActivityRefs += workPackage.activityIds.length;
  }
  if (elementRefs > CONSTRUCTION_WORK_PACKAGE_LIMITS.totalElementRefs) issues.push('work_package_relation_limit_exceeded:total_element_refs');
  if (predecessorEdges > CONSTRUCTION_WORK_PACKAGE_LIMITS.totalPredecessorEdges) issues.push('work_package_relation_limit_exceeded:total_predecessor_edges');
  if (packageActivityRefs > CONSTRUCTION_WORK_PACKAGE_LIMITS.totalPackageActivityRefs) issues.push('work_package_relation_limit_exceeded:total_package_activity_refs');
  return [...new Set(issues)];
}

/** Iterative Kahn traversal: bounded long chains cannot exhaust the JS stack. */
export function constructionActivityDagIssues(activities: readonly ConstructionReleaseActivity[]): string[] {
  if (!Array.isArray(activities)) return ['activity_collection_invalid'];
  if (activities.length > CONSTRUCTION_WORK_PACKAGE_LIMITS.activities) return ['activity_collection_limit_exceeded'];
  const issues: string[] = [], byId = new Map<string, ConstructionReleaseActivity>();
  let edgeCount = 0;
  for (const value of activities as readonly unknown[]) {
    if (!record(value) || !identifier(value.id) || !Array.isArray(value.predecessors) || value.predecessors.length > CONSTRUCTION_WORK_PACKAGE_LIMITS.predecessorsPerActivity || value.predecessors.some(item => !identifier(item))) {
      issues.push('activity_dag_shape_invalid');
      continue;
    }
    if (byId.has(value.id)) issues.push(`activity_duplicate_id:${value.id}`);
    else byId.set(value.id, value as unknown as ConstructionReleaseActivity);
    edgeCount += value.predecessors.length;
    if (edgeCount > CONSTRUCTION_WORK_PACKAGE_LIMITS.totalPredecessorEdges) return [...new Set([...issues, 'activity_predecessor_edge_limit_exceeded'])];
  }
  if (issues.some(issue => issue === 'activity_dag_shape_invalid' || issue.startsWith('activity_duplicate_id:'))) return [...new Set(issues)];
  const indegree = new Map([...byId.keys()].map(id => [id, 0]));
  const outgoing = new Map([...byId.keys()].map(id => [id, [] as string[]]));
  for (const activity of byId.values()) {
    for (const predecessor of activity.predecessors) {
      const predecessorActivity = byId.get(predecessor);
      if (!predecessorActivity) { issues.push(`dangling_predecessor:${activity.id}:${predecessor}`); continue; }
      outgoing.get(predecessor)!.push(activity.id);
      indegree.set(activity.id, indegree.get(activity.id)! + 1);
      if (dateValid(predecessorActivity.endDate) && dateValid(activity.startDate) && new Date(predecessorActivity.endDate).getTime() > new Date(activity.startDate).getTime()) issues.push(`finish_to_start_violation:${activity.id}:${predecessor}`);
    }
  }
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let head = 0, visited = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    visited += 1;
    for (const target of outgoing.get(id)!) {
      const next = indegree.get(target)! - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (visited !== byId.size) issues.push('activity_predecessor_cycle');
  return [...new Set(issues)];
}
function validatePayload(value: unknown): string[] {
  const issues: string[] = [];
  if (!record(value) || value.schema !== CONSTRUCTION_WORK_PACKAGE_SCHEMA) return ['work_package_schema_invalid'];
  const payload = value as Partial<ConstructionWorkPackageReleasePayload>;
  if (!exact(payload, ['schema', 'binding', 'units', 'calendar', 'artifacts', 'elements', 'activities', 'workPackages', 'crews', 'inspections', 'counts', 'fieldProgress', 'safetyPermit', 'surveyAsBuilt', 'inspectorSignature', 'contractorSignature', 'releaseReady'])) issues.push('work_package_unknown_key');
  if (!exact(payload.binding, ['workspaceRevisionId', 'workspaceContentHash', 'federatedModelArtifactSha256', 'quantityArtifactSha256', 'drawingArtifactSha256', 'ifcArtifactSha256']) || !identifier(payload.binding?.workspaceRevisionId) || !SHA256.test(String(payload.binding?.workspaceContentHash)) || !SHA256.test(String(payload.binding?.federatedModelArtifactSha256)) || !SHA256.test(String(payload.binding?.quantityArtifactSha256)) || !SHA256.test(String(payload.binding?.drawingArtifactSha256)) || !SHA256.test(String(payload.binding?.ifcArtifactSha256))) issues.push('work_package_binding_invalid');
  if (!exact(payload.units, ['length', 'tolerance', 'quantity']) || payload.units?.length !== 'mm' || payload.units?.tolerance !== 'mm' || payload.units?.quantity !== 'm3|kg|m2|each') issues.push('work_package_units_invalid');
  if (!exact(payload.calendar, ['dateTime', 'timezone', 'predecessorType']) || payload.calendar?.dateTime !== 'ISO-8601' || payload.calendar?.timezone !== 'UTC' || payload.calendar?.predecessorType !== 'finish_to_start') issues.push('work_package_calendar_invalid');
  if (payload.fieldProgress !== 'NOT_RUN' || payload.safetyPermit !== 'HOLD' || payload.surveyAsBuilt !== 'NOT_RUN' || payload.inspectorSignature !== 'HOLD' || payload.contractorSignature !== 'HOLD' || payload.releaseReady !== false) issues.push('work_package_release_truth_invalid');
  if (!Array.isArray(payload.artifacts) || !Array.isArray(payload.elements) || !Array.isArray(payload.activities) || !Array.isArray(payload.workPackages) || !Array.isArray(payload.crews) || !Array.isArray(payload.inspections)) return [...new Set([...issues, 'work_package_collections_invalid'])];
  const limitIssues = collectionLimitIssues(payload as BoundedConstructionCollections);
  if (limitIssues.length) return [...new Set([...issues, ...limitIssues])];
  const allItems = [payload.artifacts, payload.elements, payload.activities, payload.workPackages, payload.crews, payload.inspections].flat();
  if (allItems.some(item => !record(item) || !identifier(item.id))) return [...new Set([...issues, 'work_package_collection_item_invalid'])];
  if (!sortedIds(payload.artifacts) || !sortedIds(payload.elements) || !sortedIds(payload.activities) || !sortedIds(payload.workPackages) || !sortedIds(payload.crews) || !sortedIds(payload.inspections)) issues.push('work_package_collections_not_sorted');
  const ids: string[] = [];
  for (const artifact of payload.artifacts) { if (!exact(artifact, ['id', 'kind', 'sha256', 'bytes']) || !identifier(artifact.id) || !['federated_model', 'quantity', 'drawing', 'ifc'].includes(String(artifact.kind)) || !SHA256.test(String(artifact.sha256)) || !Number.isSafeInteger(artifact.bytes) || Number(artifact.bytes) <= 0) issues.push('work_package_artifact_invalid'); else ids.push(artifact.id); }
  const artifactKinds = payload.artifacts.map(item => item.kind);
  if (payload.artifacts.length !== 4 || new Set(artifactKinds).size !== 4 || !['federated_model', 'quantity', 'drawing', 'ifc'].every(kind => artifactKinds.includes(kind as ConstructionReleaseArtifact['kind']))) issues.push('work_package_artifact_kinds_invalid');
  const artifactByKind = new Map(payload.artifacts.map(item => [item.kind, item]));
  if (artifactByKind.get('federated_model')?.sha256 !== payload.binding?.federatedModelArtifactSha256 || artifactByKind.get('quantity')?.sha256 !== payload.binding?.quantityArtifactSha256 || artifactByKind.get('drawing')?.sha256 !== payload.binding?.drawingArtifactSha256 || artifactByKind.get('ifc')?.sha256 !== payload.binding?.ifcArtifactSha256) issues.push('work_package_artifact_binding_mismatch');
  const elementIds = new Set<string>();
  for (const element of payload.elements) { if (!exact(element, ['id', 'kind', 'zoneId', 'quantity', 'sourceObjectSha256', 'workspaceRevisionId', 'workspaceContentHash', 'quantityArtifactSha256', 'drawingArtifactSha256', 'ifcArtifactSha256', 'installationToleranceMm']) || !identifier(element.id) || elementIds.has(element.id) || !['concrete', 'rebar', 'formwork', 'other'].includes(String(element.kind)) || !identifier(element.zoneId) || !exact(element.quantity, ['value', 'unit']) || !finite(element.quantity?.value) || Number(element.quantity?.value) <= 0 || !['m3', 'kg', 'm2', 'each'].includes(String(element.quantity?.unit)) || !SHA256.test(String(element.sourceObjectSha256)) || !identifier(element.workspaceRevisionId) || element.workspaceRevisionId !== payload.binding?.workspaceRevisionId || !SHA256.test(String(element.workspaceContentHash)) || element.workspaceContentHash !== payload.binding?.workspaceContentHash || !SHA256.test(String(element.quantityArtifactSha256)) || element.quantityArtifactSha256 !== payload.binding?.quantityArtifactSha256 || !SHA256.test(String(element.drawingArtifactSha256)) || element.drawingArtifactSha256 !== payload.binding?.drawingArtifactSha256 || !SHA256.test(String(element.ifcArtifactSha256)) || element.ifcArtifactSha256 !== payload.binding?.ifcArtifactSha256 || !finite(element.installationToleranceMm) || Number(element.installationToleranceMm) <= 0) issues.push('work_package_element_invalid'); else { elementIds.add(element.id); ids.push(element.id); } }
  const elementById = new Map(payload.elements.map(element => [element.id, element]));
  const activityIds = new Set<string>();
  const elementOwnership = new Map<string, number>();
  for (const activity of payload.activities) { if (!exact(activity, ['id', 'workPackageId', 'elementIds', 'crewId', 'zoneId', 'startDate', 'endDate', 'timezone', 'predecessors', 'installationToleranceMm']) || !identifier(activity.id) || activityIds.has(activity.id) || !identifier(activity.workPackageId) || !Array.isArray(activity.elementIds) || activity.elementIds.length === 0 || new Set(activity.elementIds).size !== activity.elementIds.length || activity.elementIds.some(id => !identifier(id) || !elementIds.has(id)) || !identifier(activity.crewId) || !identifier(activity.zoneId) || !dateValid(activity.startDate) || !dateValid(activity.endDate) || new Date(activity.endDate).getTime() <= new Date(activity.startDate).getTime() || activity.timezone !== 'UTC' || !Array.isArray(activity.predecessors) || new Set(activity.predecessors).size !== activity.predecessors.length || activity.predecessors.some(id => !identifier(id)) || !finite(activity.installationToleranceMm) || activity.installationToleranceMm <= 0) issues.push('work_package_activity_invalid'); else { activityIds.add(activity.id); ids.push(activity.id); for (const elementId of activity.elementIds) { elementOwnership.set(elementId, (elementOwnership.get(elementId) ?? 0) + 1); if (elementById.get(elementId)?.zoneId !== activity.zoneId) issues.push(`work_package_activity_element_zone_mismatch:${activity.id}:${elementId}`); } } }
  for (const elementId of elementIds) if (elementOwnership.get(elementId) !== 1) issues.push(`work_package_element_ownership_invalid:${elementId}`);
  const packageIds = new Set<string>();
  const packageActivityOwnership = new Map<string, number>();
  for (const workPackage of payload.workPackages) { if (!exact(workPackage, ['id', 'activityIds', 'crewId', 'zoneId']) || !identifier(workPackage.id) || packageIds.has(workPackage.id) || !Array.isArray(workPackage.activityIds) || workPackage.activityIds.length === 0 || new Set(workPackage.activityIds).size !== workPackage.activityIds.length || workPackage.activityIds.some(id => !identifier(id) || !activityIds.has(id)) || !identifier(workPackage.crewId) || !identifier(workPackage.zoneId)) issues.push('work_package_definition_invalid'); else { packageIds.add(workPackage.id); ids.push(workPackage.id); for (const activityId of workPackage.activityIds) packageActivityOwnership.set(activityId, (packageActivityOwnership.get(activityId) ?? 0) + 1); } }
  const crewIds = new Set<string>();
  for (const crew of payload.crews) { if (!exact(crew, ['id', 'maxConcurrent']) || !identifier(crew.id) || crewIds.has(crew.id) || crew.maxConcurrent !== 1) issues.push('work_package_crew_invalid'); else { crewIds.add(crew.id); ids.push(crew.id); } }
  for (const activity of payload.activities) { if (!crewIds.has(activity.crewId) || !packageIds.has(activity.workPackageId)) issues.push(`work_package_activity_owner_invalid:${activity.id}`); const workPackage = payload.workPackages.find(item => item.id === activity.workPackageId); if (workPackage && (workPackage.crewId !== activity.crewId || workPackage.zoneId !== activity.zoneId || !workPackage.activityIds.includes(activity.id))) issues.push(`work_package_activity_membership_invalid:${activity.id}`); if (packageActivityOwnership.get(activity.id) !== 1) issues.push(`work_package_activity_ownership_invalid:${activity.id}`); }
  for (let first = 0; first < payload.activities.length; first += 1) for (let second = first + 1; second < payload.activities.length; second += 1) { const left = payload.activities[first]!, right = payload.activities[second]!; if (left.crewId === right.crewId && new Date(left.startDate).getTime() < new Date(right.endDate).getTime() && new Date(right.startDate).getTime() < new Date(left.endDate).getTime()) issues.push(`work_package_resource_overlap:${left.crewId}`); }
  const inspectionOwnership = new Map<string, number>();
  for (const inspection of payload.inspections) { if (!exact(inspection, ['id', 'activityId', 'required']) || !identifier(inspection.id) || !activityIds.has(inspection.activityId) || inspection.required !== true) issues.push('work_package_inspection_invalid'); else { ids.push(inspection.id); inspectionOwnership.set(inspection.activityId, (inspectionOwnership.get(inspection.activityId) ?? 0) + 1); } }
  for (const activityId of activityIds) if (inspectionOwnership.get(activityId) !== 1) issues.push(`work_package_required_inspection_invalid:${activityId}`);
  issues.push(...constructionActivityDagIssues(payload.activities));
  const counts = payload.counts;
  if (!exact(counts, ['elements', 'activities', 'workPackages', 'crews', 'inspections']) || counts?.elements !== payload.elements.length || counts?.activities !== payload.activities.length || counts?.workPackages !== payload.workPackages.length || counts?.crews !== payload.crews.length || counts?.inspections !== payload.inspections.length) issues.push('work_package_counts_mismatch');
  if (new Set(ids).size !== ids.length) issues.push('work_package_duplicate_id');
  return [...new Set(issues)];
}

export function constructionWorkPackageReleaseIssues(value: unknown): string[] { return validatePayload(value); }

export function exportConstructionWorkPackageReleaseArtifact(input: ConstructionWorkPackageReleaseInput): ConstructionWorkPackageReleaseArtifact {
  if (!record(input)) throw new Error('CONSTRUCTION_WORK_PACKAGE_INPUT_INVALID');
  const inputLimitIssues = collectionLimitIssues(input);
  if (inputLimitIssues.length) throw new Error(`CONSTRUCTION_WORK_PACKAGE_INPUT_LIMIT_INVALID:${inputLimitIssues[0]}`);
  if ([input.elements, input.activities, input.workPackages, input.crews, input.inspections].flat().some(item => !record(item))) throw new Error('CONSTRUCTION_WORK_PACKAGE_INPUT_INVALID');
  if (!identifier(input.workspaceRevisionId) || input.workspaceRevisionId !== input.expectedWorkspaceRevisionId) throw new Error('CONSTRUCTION_WORK_PACKAGE_STALE_REVISION');
  if (!boundedWorkspaceRevision(input.workspaceRevisionValue)) throw new Error('CONSTRUCTION_WORK_PACKAGE_WORKSPACE_REVISION_TOO_COMPLEX');
  const workspaceRevisionCanonical = canonicalDesignJson(input.workspaceRevisionValue);
  if (encoder.encode(workspaceRevisionCanonical).byteLength > CONSTRUCTION_WORK_PACKAGE_LIMITS.workspaceRevisionBytes) throw new Error('CONSTRUCTION_WORK_PACKAGE_WORKSPACE_REVISION_TOO_LARGE');
  const workspaceContentHash = hash(workspaceRevisionCanonical); if (!SHA256.test(input.expectedWorkspaceContentHash) || workspaceContentHash !== input.expectedWorkspaceContentHash) throw new Error('CONSTRUCTION_WORK_PACKAGE_STALE_REVISION_HASH');
  const artifacts = artifactHashes(input); const modelHash = sourceArtifactHash(artifacts, 'federated_model'); const quantityHash = sourceArtifactHash(artifacts, 'quantity'); const drawingHash = sourceArtifactHash(artifacts, 'drawing'); const ifcHash = sourceArtifactHash(artifacts, 'ifc');
  if (input.elements.length === 0 || input.activities.length === 0 || input.workPackages.length === 0 || input.crews.length === 0) throw new Error('CONSTRUCTION_WORK_PACKAGE_EMPTY');
  if (constructionActivityDagIssues(input.activities).length) throw new Error('CONSTRUCTION_WORK_PACKAGE_DAG_INVALID');
  for (const element of input.elements) if (element.workspaceRevisionId !== input.workspaceRevisionId || element.workspaceContentHash !== workspaceContentHash || element.quantityArtifactSha256 !== quantityHash || element.drawingArtifactSha256 !== drawingHash || element.ifcArtifactSha256 !== ifcHash || !SHA256.test(element.sourceObjectSha256)) throw new Error(`CONSTRUCTION_WORK_PACKAGE_ELEMENT_BINDING_INVALID:${element.id}`);
  const payload: ConstructionWorkPackageReleasePayload = { schema: CONSTRUCTION_WORK_PACKAGE_SCHEMA, binding: { workspaceRevisionId: input.workspaceRevisionId, workspaceContentHash, federatedModelArtifactSha256: modelHash, quantityArtifactSha256: quantityHash, drawingArtifactSha256: drawingHash, ifcArtifactSha256: ifcHash }, units: { length: 'mm', tolerance: 'mm', quantity: 'm3|kg|m2|each' }, calendar: { dateTime: 'ISO-8601', timezone: 'UTC', predecessorType: 'finish_to_start' }, artifacts, elements: sorted(input.elements), activities: sorted(input.activities), workPackages: sorted(input.workPackages), crews: sorted(input.crews), inspections: sorted(input.inspections), counts: { elements: input.elements.length, activities: input.activities.length, workPackages: input.workPackages.length, crews: input.crews.length, inspections: input.inspections.length }, fieldProgress: 'NOT_RUN', safetyPermit: 'HOLD', surveyAsBuilt: 'NOT_RUN', inspectorSignature: 'HOLD', contractorSignature: 'HOLD', releaseReady: false };
  const issues = validatePayload(payload); if (issues.length) throw new Error(`CONSTRUCTION_WORK_PACKAGE_PAYLOAD_INVALID:${issues[0]}`);
  const contentHash = designRevisionSha256(payload); const bytes = encoder.encode(canonicalDesignJson({ payload, contentHash }));
  if (bytes.byteLength > CONSTRUCTION_WORK_PACKAGE_LIMITS.outputArtifactBytes) throw new Error('CONSTRUCTION_WORK_PACKAGE_OUTPUT_ARTIFACT_TOO_LARGE');
  const artifactName = input.artifactName ?? 'construction-work-package-release.json';
  if (typeof artifactName !== 'string' || artifactName.length < 1 || encoder.encode(artifactName).byteLength > 255) throw new Error('CONSTRUCTION_WORK_PACKAGE_ARTIFACT_NAME_INVALID');
  return { payload, contentHash, bytes, artifactSha256: hash(bytes), artifactName, artifactMime: 'application/json' };
}

export function parseConstructionWorkPackageReleaseArtifact(bytes: Uint8Array, expectedBinding?: ConstructionWorkPackageReleasePayload['binding']): ConstructionWorkPackageReleaseParseResult {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('CONSTRUCTION_WORK_PACKAGE_ARTIFACT_EMPTY');
  if (bytes.byteLength > CONSTRUCTION_WORK_PACKAGE_LIMITS.outputArtifactBytes) throw new Error('CONSTRUCTION_WORK_PACKAGE_ARTIFACT_TOO_LARGE');
  let textValue: string; try { textValue = decoder.decode(bytes); } catch { throw new Error('CONSTRUCTION_WORK_PACKAGE_INVALID_UTF8'); } let parsed: unknown; try { parsed = JSON.parse(textValue) as unknown; } catch { throw new Error('CONSTRUCTION_WORK_PACKAGE_JSON_INVALID'); }
  if (!record(parsed) || !record(parsed.payload) || typeof parsed.contentHash !== 'string' || !SHA256.test(parsed.contentHash) || !exact(parsed, ['payload', 'contentHash'])) throw new Error('CONSTRUCTION_WORK_PACKAGE_ENVELOPE_INVALID'); if (canonicalDesignJson(parsed) !== textValue) throw new Error('CONSTRUCTION_WORK_PACKAGE_NON_CANONICAL'); const issues = validatePayload(parsed.payload); if (issues.length) throw new Error(`CONSTRUCTION_WORK_PACKAGE_INVALID:${issues[0]}`); const payload = parsed.payload as ConstructionWorkPackageReleasePayload; if (designRevisionSha256(payload) !== parsed.contentHash) throw new Error('CONSTRUCTION_WORK_PACKAGE_CONTENT_HASH_MISMATCH'); if (expectedBinding && canonicalDesignJson(payload.binding) !== canonicalDesignJson(expectedBinding)) throw new Error('CONSTRUCTION_WORK_PACKAGE_STALE_BINDING'); return { payload, contentHash: parsed.contentHash, artifactSha256: hash(bytes) };
}

export function verifyConstructionWorkPackageRelease(input: { artifact: ConstructionWorkPackageReleaseParseResult; workspaceRevisionId: string; workspaceContentHash: string; federatedModelArtifactSha256: string; quantityArtifactSha256: string; drawingArtifactSha256: string; ifcArtifactSha256: string }): ConstructionWorkPackageReleaseVerification {
  const issues = [...validatePayload(input.artifact.payload)]; if (input.artifact.contentHash !== designRevisionSha256(input.artifact.payload)) issues.push('content_hash_mismatch'); const binding = input.artifact.payload.binding; if (binding.workspaceRevisionId !== input.workspaceRevisionId || binding.workspaceContentHash !== input.workspaceContentHash || binding.federatedModelArtifactSha256 !== input.federatedModelArtifactSha256 || binding.quantityArtifactSha256 !== input.quantityArtifactSha256 || binding.drawingArtifactSha256 !== input.drawingArtifactSha256 || binding.ifcArtifactSha256 !== input.ifcArtifactSha256) issues.push('stale_binding'); return issues.length ? { status: 'failed', verifierId: 'construction-work-package-structural.v1', issues: [...new Set(issues)] } : { status: 'passed', verifierId: 'construction-work-package-structural.v1', issues: [] };
}

function stablePayloadIds(payload: ConstructionWorkPackageReleasePayload): ConstructionWorkPackageReleaseReceipt['stableIds'] { return { elements: payload.elements.map(item => item.id), activities: payload.activities.map(item => item.id), workPackages: payload.workPackages.map(item => item.id), crews: payload.crews.map(item => item.id), inspections: payload.inspections.map(item => item.id) }; }
function canonicalObject(bytes: Uint8Array, errorCode: string, maxBytes: number): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error(errorCode);
  let textValue: string; let parsed: unknown;
  try { textValue = decoder.decode(bytes); parsed = JSON.parse(textValue) as unknown; } catch { throw new Error(errorCode); }
  if (canonicalDesignJson(parsed) !== textValue) throw new Error(errorCode);
  return parsed;
}
export function buildConstructionWorkPackageReleaseReceipt(input: { artifact: ConstructionWorkPackageReleaseArtifact; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): Uint8Array {
  if (!(input.artifact.bytes instanceof Uint8Array) || input.artifact.bytes.byteLength === 0 || input.artifact.bytes.byteLength > CONSTRUCTION_WORK_PACKAGE_LIMITS.outputArtifactBytes) throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_HASH_INPUT_INVALID');
  if (hash(input.artifact.bytes) !== input.artifact.artifactSha256) throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_HASH_INPUT_INVALID');
  const parsedArtifact = parseConstructionWorkPackageReleaseArtifact(input.artifact.bytes, input.artifact.payload.binding);
  if (parsedArtifact.contentHash !== input.artifact.contentHash || parsedArtifact.artifactSha256 !== input.artifact.artifactSha256 || canonicalDesignJson(parsedArtifact.payload) !== canonicalDesignJson(input.artifact.payload)) throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_ARTIFACT_BINDING_MISMATCH');
  const verification = verifyConstructionWorkPackageRelease({ artifact: parsedArtifact, ...parsedArtifact.payload.binding });
  if (verification.status !== 'passed') throw new Error(`CONSTRUCTION_WORK_PACKAGE_RECEIPT_VERIFICATION_FAILED:${verification.issues[0] ?? 'unknown'}`);
  const parserOutput = canonicalObject(input.parserOutputBytes, 'CONSTRUCTION_WORK_PACKAGE_RECEIPT_PARSER_OUTPUT_INVALID', CONSTRUCTION_WORK_PACKAGE_LIMITS.parserOutputBytes);
  if (canonicalDesignJson(parserOutput) !== canonicalDesignJson(parsedArtifact)) throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_PARSER_OUTPUT_MISMATCH');
  const verifierEvidence = canonicalObject(input.verifierEvidenceBytes, 'CONSTRUCTION_WORK_PACKAGE_RECEIPT_VERIFIER_EVIDENCE_INVALID', CONSTRUCTION_WORK_PACKAGE_LIMITS.verifierEvidenceBytes);
  const evidence = verifierEvidence as Record<string, unknown>;
  if (!exact(verifierEvidence, ['schema', 'verifierId', 'status', 'artifactSha256', 'contentHash', 'releaseReady']) || evidence.schema !== 'nexyfab.construction-work-package-verification.v1' || evidence.verifierId !== 'construction-work-package-structural.v1' || evidence.status !== 'passed' || evidence.artifactSha256 !== parsedArtifact.artifactSha256 || evidence.contentHash !== parsedArtifact.contentHash || evidence.releaseReady !== false) throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_VERIFIER_EVIDENCE_MISMATCH');
  const payload = parsedArtifact.payload; const receipt: ConstructionWorkPackageReleaseReceipt = { schema: CONSTRUCTION_WORK_PACKAGE_RECEIPT_SCHEMA, capabilityId: CONSTRUCTION_WORK_PACKAGE_CAPABILITY_ID, format: 'json', workspaceRevisionId: payload.binding.workspaceRevisionId, workspaceContentHash: payload.binding.workspaceContentHash, federatedModelArtifactSha256: payload.binding.federatedModelArtifactSha256, quantityArtifactSha256: payload.binding.quantityArtifactSha256, drawingArtifactSha256: payload.binding.drawingArtifactSha256, ifcArtifactSha256: payload.binding.ifcArtifactSha256, artifactSha256: input.artifact.artifactSha256, artifactBytes: input.artifact.bytes.byteLength, parserResult: 'verified', parserOutputSha256: hash(input.parserOutputBytes), verifierEvidenceSha256: hash(input.verifierEvidenceBytes), stableIds: stablePayloadIds(payload), fieldProgress: 'NOT_RUN', safetyPermit: 'HOLD', surveyAsBuilt: 'NOT_RUN', inspectorSignature: 'HOLD', contractorSignature: 'HOLD', releaseReady: false };
  const receiptBytes = encoder.encode(canonicalDesignJson(receipt));
  if (receiptBytes.byteLength > CONSTRUCTION_WORK_PACKAGE_LIMITS.receiptBytes) throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_TOO_LARGE');
  return receiptBytes;
}

export function claimConstructionWorkPackageReleaseReceipt(input: { artifact: ConstructionWorkPackageReleaseArtifact; receiptBytes: Uint8Array; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): ConstructionWorkPackageReleaseReceipt & { receiptSha256: string; claim: 'internal-construction-work-package-verified' } {
  if (!(input.receiptBytes instanceof Uint8Array) || input.receiptBytes.byteLength === 0 || input.receiptBytes.byteLength > CONSTRUCTION_WORK_PACKAGE_LIMITS.receiptBytes) throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_INVALID');
  let textValue: string; let receipt: ConstructionWorkPackageReleaseReceipt; try { textValue = decoder.decode(input.receiptBytes); receipt = JSON.parse(textValue) as ConstructionWorkPackageReleaseReceipt; } catch { throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_INVALID'); }
  if (!exact(receipt, ['schema', 'capabilityId', 'format', 'workspaceRevisionId', 'workspaceContentHash', 'federatedModelArtifactSha256', 'quantityArtifactSha256', 'drawingArtifactSha256', 'ifcArtifactSha256', 'artifactSha256', 'artifactBytes', 'parserResult', 'parserOutputSha256', 'verifierEvidenceSha256', 'stableIds', 'fieldProgress', 'safetyPermit', 'surveyAsBuilt', 'inspectorSignature', 'contractorSignature', 'releaseReady']) || canonicalDesignJson(receipt) !== textValue) throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_NON_CANONICAL'); const expected = JSON.parse(decoder.decode(buildConstructionWorkPackageReleaseReceipt(input))) as ConstructionWorkPackageReleaseReceipt; if (canonicalDesignJson(receipt) !== canonicalDesignJson(expected)) throw new Error('CONSTRUCTION_WORK_PACKAGE_RECEIPT_BINDING_MISMATCH'); return { ...receipt, receiptSha256: hash(input.receiptBytes), claim: 'internal-construction-work-package-verified' };
}
