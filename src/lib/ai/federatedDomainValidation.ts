import { validateArchitectureDocument, validateInteriorDocument, type ArchitectureDocument, type InteriorDocument } from './architectureInteriorDocuments';
import { validateCivilDocument, type CivilDocument } from './civilDocument';
import { validateLandscapeDocument, type LandscapeDocument } from './landscapeDocument';
import type { DomainDocument, UnifiedDesignProject } from './unifiedDesignProject';

function typed<T>(document: DomainDocument | undefined, schema: string): T | undefined {
  return document?.schema === schema ? document.payload as T : undefined;
}

/** Deep validation for domain payloads and their federated, revision-pinned dependencies. */
export function validateFederatedDomainProject(project: UnifiedDesignProject): string[] {
  const issues: string[] = [];
  const documents = new Map(project.documents.map(item => [item.id, item]));
  for (const document of project.documents) {
    if (document.profileId && document.profileVersion !== 1) issues.push(`${document.id}: unsupported domain profile version.`);
    const architecture = typed<ArchitectureDocument>(document, 'nexyfab.architecture.v1');
    const civil = typed<CivilDocument>(document, 'nexyfab.civil.v1');
    const landscape = typed<LandscapeDocument>(document, 'nexyfab.landscape.v1');
    if (architecture) issues.push(...validateArchitectureDocument(architecture));
    if (civil) issues.push(...validateCivilDocument(civil));
    if (landscape) {
      issues.push(...validateLandscapeDocument(landscape));
      const civilEntry = documents.get(landscape.terrain.civilDocumentId);
      const civilModel = typed<CivilDocument>(civilEntry, 'nexyfab.civil.v1');
      if (!civilEntry || !civilModel) issues.push(`${document.id}: referenced civil terrain document is missing.`);
      else {
        if (civilEntry.coordinateSystemId !== document.coordinateSystemId) issues.push(`${document.id}: landscape and civil terrain must share a coordinate system.`);
        if (civilModel.revision !== landscape.terrain.civilRevision) issues.push(`${document.id}: civil terrain revision is stale.`);
        if (!civilModel.surfaces.some(item => item.id === landscape.terrain.surfaceId)) issues.push(`${document.id}: referenced civil surface is missing.`);
        const explicitTerrainLink = project.references.some(reference => reference.relation === 'FOLLOWS_TERRAIN' && reference.targetObjectId === landscape.terrain.surfaceId && document.objectIds.includes(reference.sourceObjectId));
        if (!explicitTerrainLink) issues.push(`${document.id}: explicit FOLLOWS_TERRAIN reference is required.`);
      }
    }
    const interior = typed<InteriorDocument>(document, 'nexyfab.interior.v1');
    if (interior) {
      const architectureEntry = documents.get(interior.architectureDocumentId);
      const architectureModel = typed<ArchitectureDocument>(architectureEntry, 'nexyfab.architecture.v1');
      if (!architectureModel) issues.push(`${document.id}: referenced architecture document is missing.`);
      else {
        issues.push(...validateInteriorDocument(interior, architectureModel));
        if (architectureEntry?.coordinateSystemId !== document.coordinateSystemId) issues.push(`${document.id}: interior and architecture host must share a coordinate system.`);
        if (interior.fieldMeasurement && interior.fieldMeasurement.architectureRevision !== architectureModel.revision) issues.push(`${document.id}: architecture host revision is stale for field measurement.`);
      }
    }
  }
  return issues;
}
