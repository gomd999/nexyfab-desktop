import { applyArchitectureInteriorEdit, validateArchitectureDocument, validateInteriorDocument, type ArchitectureDocument, type ArchitectureEdit, type InteriorDocument } from './architectureInteriorDocuments';
import { executeUnifiedProjectBatchTransaction, type DomainDocument, type UnifiedDesignProject, type UnifiedProjectTransactionResult } from './unifiedDesignProject';

export function architectureDomainDocument(model: ArchitectureDocument, id = 'architecture'): DomainDocument<ArchitectureDocument> {
  return { id, domain: 'architecture', schema: model.schema, revision: model.revision, coordinateSystemId: 'project-local', representations: ['bim', 'surface', 'graph'], objectIds: [...model.storeys, ...model.spaces, ...model.walls, ...model.slabs, ...model.ceilings, ...model.openings, ...(model.serviceOpenings ?? [])].map(item => item.id), payload: structuredClone(model) };
}
export function interiorDomainDocument(model: InteriorDocument, id = 'interior'): DomainDocument<InteriorDocument> {
  return { id, domain: 'interior', schema: model.schema, revision: model.revision, coordinateSystemId: 'project-local', representations: ['bim', 'graph', 'procedural'], objectIds: [...model.lights, ...model.furniture, ...model.finishes].map(item => item.id), payload: structuredClone(model) };
}

export function editArchitectureInteriorProject(project: UnifiedDesignProject, architectureDocumentId: string, interiorDocumentId: string, edit: ArchitectureEdit): UnifiedProjectTransactionResult {
  const architectureEntry = project.documents.find(item => item.id === architectureDocumentId), interiorEntry = project.documents.find(item => item.id === interiorDocumentId);
  if (!architectureEntry || !interiorEntry) return executeUnifiedProjectBatchTransaction(project, project.revision, [], () => [`Architecture or interior document is missing.`]);
  const architecture = architectureEntry.payload as ArchitectureDocument, interior = interiorEntry.payload as InteriorDocument;
  let result;
  try { result = applyArchitectureInteriorEdit(architecture, interior, edit); }
  catch (error) { return { committed: false, project, impact: { directlyChanged: [], follow: [], notify: [], locked: [], traversedReferenceIds: [] }, issues: [error instanceof Error ? error.message : 'Architecture/interior edit failed.'], invalidatedDocumentIds: [] }; }
  const architectureChanged = result.affectedObjectIds.filter(id => architectureEntry.objectIds.includes(id));
  const interiorChanged = result.affectedObjectIds.filter(id => interiorEntry.objectIds.includes(id));
  const edits = [
    ...(architectureChanged.length ? [{ documentId: architectureDocumentId, changedObjectIds: architectureChanged, apply: (current: DomainDocument) => ({ ...current, objectIds: architectureDomainDocument(result.architecture, current.id).objectIds, payload: result.architecture }) }] : []),
    ...(interiorChanged.length ? [{ documentId: interiorDocumentId, changedObjectIds: interiorChanged, apply: (current: DomainDocument) => ({ ...current, objectIds: interiorDomainDocument(result.interior, current.id).objectIds, payload: result.interior }) }] : []),
  ];
  return executeUnifiedProjectBatchTransaction(project, project.revision, edits, candidate => {
    const nextArchitecture = candidate.documents.find(item => item.id === architectureDocumentId)?.payload as ArchitectureDocument | undefined;
    const nextInterior = candidate.documents.find(item => item.id === interiorDocumentId)?.payload as InteriorDocument | undefined;
    return !nextArchitecture || !nextInterior ? ['Architecture or interior document disappeared.'] : [...validateArchitectureDocument(nextArchitecture), ...validateInteriorDocument(nextInterior, nextArchitecture)];
  });
}
