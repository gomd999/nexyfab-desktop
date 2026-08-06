export type DesignDomain = 'mechanical' | 'architecture' | 'structure' | 'mep' | 'interior' | 'civil' | 'landscape' | 'survey_gis' | 'construction';
export type RepresentationKind = 'brep' | 'feature_tree' | 'bim' | 'surface' | 'mesh' | 'tin' | 'alignment' | 'graph' | 'gis' | 'procedural' | 'simulation';
export type CrossDomainRelation = 'HOSTED_BY' | 'CONNECTS_TO' | 'ALIGNED_WITH' | 'DEPENDS_ON_LEVEL' | 'FOLLOWS_TERRAIN' | 'PENETRATES' | 'SERVES' | 'MUST_CLEAR';
export type UpdatePolicy = 'follow' | 'notify' | 'locked';

export interface ProjectCoordinateSystem {
  id: string;
  kind: 'geographic' | 'site' | 'building' | 'local';
  parentId?: string;
  epsg?: number;
  units: 'mm' | 'm';
  origin: [number, number, number];
  rotationDeg: [number, number, number];
}

export interface DomainDocument<T = unknown> {
  id: string;
  domain: DesignDomain;
  schema: string;
  revision: number;
  coordinateSystemId: string;
  representations: RepresentationKind[];
  objectIds: string[];
  payload: T;
}

export interface CrossDomainReference {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  relation: CrossDomainRelation;
  updatePolicy: UpdatePolicy;
}

export interface UnifiedDesignProject {
  schema: 'nexyfab.unified-design-project.v1';
  id: string;
  revision: number;
  coordinateSystems: ProjectCoordinateSystem[];
  documents: DomainDocument[];
  references: CrossDomainReference[];
}

export interface DomainPackageContract {
  domain: DesignDomain;
  schemaVersions: string[];
  representations: RepresentationKind[];
  commands: string[];
  verifiers: string[];
  importFormats: string[];
  exportFormats: string[];
}

export interface ChangeImpact {
  directlyChanged: string[];
  follow: string[];
  notify: string[];
  locked: string[];
  traversedReferenceIds: string[];
}

export interface UnifiedProjectEdit {
  documentId: string;
  changedObjectIds: string[];
  apply(document: DomainDocument): DomainDocument;
}

export interface UnifiedProjectTransactionResult {
  committed: boolean;
  project: UnifiedDesignProject;
  impact: ChangeImpact;
  issues: string[];
  invalidatedDocumentIds: string[];
}

const finiteV3 = (value: [number, number, number]) => value.length === 3 && value.every(Number.isFinite);

export function validateUnifiedDesignProject(project: UnifiedDesignProject): string[] {
  const issues: string[] = [];
  if (project.schema !== 'nexyfab.unified-design-project.v1' || !project.id.trim() || !Number.isSafeInteger(project.revision) || project.revision < 0) issues.push('Invalid unified project header.');
  const coordinateIds = new Set<string>();
  for (const coordinate of project.coordinateSystems) {
    if (!coordinate.id.trim() || coordinateIds.has(coordinate.id)) issues.push(`Duplicate or empty coordinate system ${coordinate.id || '(empty)'}.`);
    coordinateIds.add(coordinate.id);
    if (!finiteV3(coordinate.origin) || !finiteV3(coordinate.rotationDeg) || (coordinate.epsg !== undefined && (!Number.isSafeInteger(coordinate.epsg) || coordinate.epsg <= 0))) issues.push(`${coordinate.id}: invalid coordinate transform.`);
  }
  for (const coordinate of project.coordinateSystems) if (coordinate.parentId && !coordinateIds.has(coordinate.parentId)) issues.push(`${coordinate.id}: unknown parent coordinate system ${coordinate.parentId}.`);
  const documentIds = new Set<string>(), objectOwners = new Map<string, string>();
  for (const document of project.documents) {
    if (!document.id.trim() || documentIds.has(document.id)) issues.push(`Duplicate or empty document ${document.id || '(empty)'}.`);
    documentIds.add(document.id);
    if (!coordinateIds.has(document.coordinateSystemId)) issues.push(`${document.id}: unknown coordinate system ${document.coordinateSystemId}.`);
    if (!document.schema.trim() || !Number.isSafeInteger(document.revision) || document.revision < 0 || document.representations.length === 0) issues.push(`${document.id}: invalid document metadata.`);
    for (const objectId of document.objectIds) {
      if (!objectId.trim() || objectOwners.has(objectId)) issues.push(`${document.id}: duplicate or empty global object id ${objectId || '(empty)'}.`);
      else objectOwners.set(objectId, document.id);
    }
  }
  const referenceIds = new Set<string>();
  for (const reference of project.references) {
    if (!reference.id.trim() || referenceIds.has(reference.id)) issues.push(`Duplicate or empty reference ${reference.id || '(empty)'}.`);
    referenceIds.add(reference.id);
    if (!objectOwners.has(reference.sourceObjectId) || !objectOwners.has(reference.targetObjectId)) issues.push(`${reference.id}: cross-domain reference endpoint is missing.`);
    if (reference.sourceObjectId === reference.targetObjectId) issues.push(`${reference.id}: self reference is not allowed.`);
  }
  return issues;
}

/** Traverse references in both directions because a host and its dependant can invalidate each other. */
export function analyzeUnifiedChangeImpact(project: UnifiedDesignProject, changedObjectIds: readonly string[]): ChangeImpact {
  const allObjects = new Set(project.documents.flatMap(document => document.objectIds));
  const missing = changedObjectIds.filter(id => !allObjects.has(id));
  if (missing.length) throw new Error(`Unknown changed objects: ${missing.join(', ')}.`);
  const direct = new Set(changedObjectIds), follow = new Set<string>(), notify = new Set<string>(), locked = new Set<string>(), traversed = new Set<string>();
  const queue = [...direct];
  while (queue.length) {
    const objectId = queue.shift()!;
    for (const reference of project.references.filter(item => item.sourceObjectId === objectId || item.targetObjectId === objectId)) {
      traversed.add(reference.id);
      const other = reference.sourceObjectId === objectId ? reference.targetObjectId : reference.sourceObjectId;
      if (reference.updatePolicy === 'locked') { locked.add(other); continue; }
      if (direct.has(other)) continue;
      if (reference.updatePolicy === 'notify') notify.add(other);
      else if (!follow.has(other)) { follow.add(other); queue.push(other); }
    }
  }
  return { directlyChanged: [...direct], follow: [...follow], notify: [...notify], locked: [...locked], traversedReferenceIds: [...traversed] };
}

/** Apply an edit atomically. Locked impacts, stale revisions, invalid output, or verifier failures preserve the input project unchanged. */
export function executeUnifiedProjectTransaction(
  project: UnifiedDesignProject,
  baseRevision: number,
  edit: UnifiedProjectEdit,
  verify: (candidate: UnifiedDesignProject, impact: ChangeImpact) => string[] = () => [],
): UnifiedProjectTransactionResult {
  const emptyImpact: ChangeImpact = { directlyChanged: [], follow: [], notify: [], locked: [], traversedReferenceIds: [] };
  const existingIssues = validateUnifiedDesignProject(project);
  if (existingIssues.length) return { committed: false, project, impact: emptyImpact, issues: existingIssues, invalidatedDocumentIds: [] };
  if (baseRevision !== project.revision) return { committed: false, project, impact: emptyImpact, issues: ['Base revision is stale.'], invalidatedDocumentIds: [] };
  const documentIndex = project.documents.findIndex(document => document.id === edit.documentId);
  if (documentIndex < 0) return { committed: false, project, impact: emptyImpact, issues: [`Unknown document ${edit.documentId}.`], invalidatedDocumentIds: [] };
  let impact: ChangeImpact;
  try { impact = analyzeUnifiedChangeImpact(project, edit.changedObjectIds); }
  catch (error) { return { committed: false, project, impact: emptyImpact, issues: [error instanceof Error ? error.message : 'Impact analysis failed.'], invalidatedDocumentIds: [] }; }
  if (impact.locked.length) return { committed: false, project, impact, issues: [`Locked dependent objects require approval: ${impact.locked.join(', ')}.`], invalidatedDocumentIds: [] };
  try {
    const documents = structuredClone(project.documents);
    const edited = edit.apply(documents[documentIndex]!);
    documents[documentIndex] = { ...edited, revision: documents[documentIndex]!.revision + 1 };
    const candidate: UnifiedDesignProject = { ...project, revision: project.revision + 1, documents };
    const issues = [...validateUnifiedDesignProject(candidate), ...verify(candidate, impact)];
    if (issues.length) return { committed: false, project, impact, issues, invalidatedDocumentIds: [] };
    const affected = new Set([...impact.directlyChanged, ...impact.follow, ...impact.notify]);
    const invalidatedDocumentIds = candidate.documents.filter(document => document.objectIds.some(id => affected.has(id))).map(document => document.id);
    return { committed: true, project: candidate, impact, issues: [], invalidatedDocumentIds };
  } catch (error) {
    return { committed: false, project, impact, issues: [error instanceof Error ? error.message : 'Edit failed.'], invalidatedDocumentIds: [] };
  }
}

/** Atomically replace multiple domain documents after a coordinated cross-domain edit. */
export function executeUnifiedProjectBatchTransaction(
  project: UnifiedDesignProject,
  baseRevision: number,
  edits: readonly UnifiedProjectEdit[],
  verify: (candidate: UnifiedDesignProject, impact: ChangeImpact) => string[] = () => [],
): UnifiedProjectTransactionResult {
  const emptyImpact: ChangeImpact = { directlyChanged: [], follow: [], notify: [], locked: [], traversedReferenceIds: [] };
  const existingIssues = validateUnifiedDesignProject(project);
  if (existingIssues.length) return { committed: false, project, impact: emptyImpact, issues: existingIssues, invalidatedDocumentIds: [] };
  if (baseRevision !== project.revision) return { committed: false, project, impact: emptyImpact, issues: ['Base revision is stale.'], invalidatedDocumentIds: [] };
  if (!edits.length) return { committed: false, project, impact: emptyImpact, issues: ['At least one domain edit is required.'], invalidatedDocumentIds: [] };
  const missingDocuments = edits.filter(edit => !project.documents.some(document => document.id === edit.documentId)).map(edit => edit.documentId);
  if (missingDocuments.length) return { committed: false, project, impact: emptyImpact, issues: [`Unknown documents: ${[...new Set(missingDocuments)].join(', ')}.`], invalidatedDocumentIds: [] };
  let impact: ChangeImpact;
  try { impact = analyzeUnifiedChangeImpact(project, [...new Set(edits.flatMap(edit => edit.changedObjectIds))]); }
  catch (error) { return { committed: false, project, impact: emptyImpact, issues: [error instanceof Error ? error.message : 'Impact analysis failed.'], invalidatedDocumentIds: [] }; }
  if (impact.locked.length) return { committed: false, project, impact, issues: [`Locked dependent objects require approval: ${impact.locked.join(', ')}.`], invalidatedDocumentIds: [] };
  try {
    const documents = structuredClone(project.documents), touched = new Set<string>();
    for (const edit of edits) {
      const index = documents.findIndex(document => document.id === edit.documentId);
      documents[index] = edit.apply(documents[index]!);
      touched.add(edit.documentId);
    }
    for (let index = 0; index < documents.length; index++) if (touched.has(documents[index]!.id)) documents[index] = { ...documents[index]!, revision: project.documents[index]!.revision + 1 };
    const candidate: UnifiedDesignProject = { ...project, revision: project.revision + 1, documents };
    const issues = [...validateUnifiedDesignProject(candidate), ...verify(candidate, impact)];
    if (issues.length) return { committed: false, project, impact, issues, invalidatedDocumentIds: [] };
    const affected = new Set([...impact.directlyChanged, ...impact.follow, ...impact.notify]);
    const invalidatedDocumentIds = candidate.documents.filter(document => touched.has(document.id) || document.objectIds.some(id => affected.has(id))).map(document => document.id);
    return { committed: true, project: candidate, impact, issues: [], invalidatedDocumentIds };
  } catch (error) {
    return { committed: false, project, impact, issues: [error instanceof Error ? error.message : 'Batch edit failed.'], invalidatedDocumentIds: [] };
  }
}
