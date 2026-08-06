import { validateArchitectureDocument, type ArchitectureDocument, type ArchitectureServiceOpening } from './architectureInteriorDocuments';
import type { BuildingServiceOpening } from './mepFabricationPlanning';
import { executeUnifiedProjectBatchTransaction, type DomainDocument, type UnifiedDesignProject, type UnifiedProjectTransactionResult } from './unifiedDesignProject';

export interface ServiceOpeningSyncResult { architecture: ArchitectureDocument; addedIds: string[]; updatedIds: string[]; removedIds: string[] }
/** Replace one route's derived openings idempotently; openings from all other routes remain untouched. */
export function syncArchitectureServiceOpenings(architecture: ArchitectureDocument, routeId: string, incoming: BuildingServiceOpening[]): ServiceOpeningSyncResult {
  if (!routeId.trim() || incoming.some(item => item.sourceRouteId !== routeId)) throw new Error('Every service opening must reference the synchronized route.');
  const existing = architecture.serviceOpenings ?? [], prior = new Map(existing.filter(item => item.sourceRouteId === routeId).map(item => [item.sourceSleeveId, item])), retained = existing.filter(item => item.sourceRouteId !== routeId), nextRoute: ArchitectureServiceOpening[] = incoming.map(item => ({ ...item, centerMm: [...item.centerMm], axis: [...item.axis] }));
  if (new Set(nextRoute.map(item => item.id)).size !== nextRoute.length || new Set(nextRoute.map(item => item.sourceSleeveId)).size !== nextRoute.length) throw new Error('Service opening and sleeve IDs must be unique within a route.');
  const next: ArchitectureDocument = { ...structuredClone(architecture), revision: architecture.revision + 1, serviceOpenings: [...retained, ...nextRoute] };
  const issues = validateArchitectureDocument(next); if (issues.length) throw new Error(issues.join(' '));
  const nextSleeves = new Set(nextRoute.map(item => item.sourceSleeveId));
  return { architecture: next, addedIds: nextRoute.filter(item => !prior.has(item.sourceSleeveId)).map(item => item.id), updatedIds: nextRoute.filter(item => prior.has(item.sourceSleeveId)).map(item => item.id), removedIds: [...prior.values()].filter(item => !nextSleeves.has(item.sourceSleeveId)).map(item => item.id) };
}

export function commitServiceOpeningSync(project: UnifiedDesignProject, architectureDocumentId: string, mepDocumentId: string, routeId: string, openings: BuildingServiceOpening[], nextMepPayload: unknown): UnifiedProjectTransactionResult {
  const architectureEntry = project.documents.find(item => item.id === architectureDocumentId), mepEntry = project.documents.find(item => item.id === mepDocumentId);
  if (!architectureEntry || !mepEntry || !mepEntry.objectIds.includes(routeId)) return { committed: false, project, impact: { directlyChanged: [], follow: [], notify: [], locked: [], traversedReferenceIds: [] }, issues: ['Architecture document, MEP document, or route object is missing.'], invalidatedDocumentIds: [] };
  let synced: ServiceOpeningSyncResult;
  try { synced = syncArchitectureServiceOpenings(architectureEntry.payload as ArchitectureDocument, routeId, openings); }
  catch (error) { return { committed: false, project, impact: { directlyChanged: [], follow: [], notify: [], locked: [], traversedReferenceIds: [] }, issues: [error instanceof Error ? error.message : 'Service opening synchronization failed.'], invalidatedDocumentIds: [] }; }
  const hostIds = [...new Set(openings.map(item => item.hostId))];
  return executeUnifiedProjectBatchTransaction(project, project.revision, [
    { documentId: architectureDocumentId, changedObjectIds: hostIds, apply: (current: DomainDocument) => ({ ...current, objectIds: [...synced.architecture.storeys, ...synced.architecture.spaces, ...synced.architecture.walls, ...synced.architecture.slabs, ...synced.architecture.ceilings, ...synced.architecture.openings, ...(synced.architecture.serviceOpenings ?? [])].map(item => item.id), payload: synced.architecture }) },
    { documentId: mepDocumentId, changedObjectIds: [routeId], apply: (current: DomainDocument) => ({ ...current, payload: structuredClone(nextMepPayload) }) },
  ], candidate => { const architecture = candidate.documents.find(item => item.id === architectureDocumentId)?.payload as ArchitectureDocument | undefined; return architecture ? validateArchitectureDocument(architecture) : ['Architecture document disappeared.']; });
}
