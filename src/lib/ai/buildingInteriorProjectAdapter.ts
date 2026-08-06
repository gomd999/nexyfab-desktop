import { applyBuildingInteriorEdits, validateBuildingInteriorModel, type BuildingInteriorEdit, type BuildingInteriorModel } from './buildingInteriorDesign';
import { executeUnifiedProjectTransaction, type DomainDocument, type UnifiedDesignProject, type UnifiedProjectTransactionResult } from './unifiedDesignProject';

export function buildingInteriorDocument(model: BuildingInteriorModel, documentId = 'architecture-interior'): DomainDocument<BuildingInteriorModel> {
  return { id: documentId, domain: 'interior', schema: model.schema, revision: model.revision, coordinateSystemId: 'project-local', representations: ['bim', 'graph'], objectIds: model.objects.map(object => object.id), payload: structuredClone(model) };
}

export function editBuildingInteriorProject(project: UnifiedDesignProject, documentId: string, edits: BuildingInteriorEdit[]): UnifiedProjectTransactionResult {
  const document = project.documents.find(item => item.id === documentId);
  if (!document) return executeUnifiedProjectTransaction(project, project.revision, { documentId, changedObjectIds: [], apply: item => item });
  const changedObjectIds = edits.map(edit => edit.objectId);
  return executeUnifiedProjectTransaction(project, project.revision, {
    documentId,
    changedObjectIds,
    apply(current) {
      const result = applyBuildingInteriorEdits(current.payload as BuildingInteriorModel, edits);
      return { ...current, objectIds: result.model.objects.map(object => object.id), payload: result.model };
    },
  }, candidate => {
    const updated = candidate.documents.find(item => item.id === documentId);
    return updated ? validateBuildingInteriorModel(updated.payload as BuildingInteriorModel) : [`Document ${documentId} disappeared.`];
  });
}
