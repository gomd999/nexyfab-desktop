import { describe, expect, it } from 'vitest';
import { architectureDomainDocument } from '../architectureInteriorProjectAdapter';
import { serviceOpeningsFromSleeves } from '../mepFabricationPlanning';
import { commitServiceOpeningSync, syncArchitectureServiceOpenings } from '../serviceOpeningIntegration';
import type { ArchitectureDocument } from '../architectureInteriorDocuments';
import type { UnifiedDesignProject } from '../unifiedDesignProject';

const architecture = (): ArchitectureDocument => ({ schema: 'nexyfab.architecture.v1', revision: 0, storeys: [{ id: 'l1', name: 'L1', elevationMm: 0, heightMm: 3000 }], spaces: [{ id: 'room', storeyId: 'l1', name: 'R', usage: 'service', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: ['w1', 'w2', 'w3', 'w4'], slabId: 'slab', ceilingId: 'ceiling' }], walls: [{ id: 'w1', kind: 'line', storeyId: 'l1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 }, { id: 'w2', kind: 'line', storeyId: 'l1', startMm: [4000, 0], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 }, { id: 'w3', kind: 'line', storeyId: 'l1', startMm: [4000, 3000], endMm: [0, 3000], thicknessMm: 200, heightMm: 3000 }, { id: 'w4', kind: 'line', storeyId: 'l1', startMm: [0, 3000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 }], slabs: [{ id: 'slab', storeyId: 'l1', spaceId: 'room', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], thicknessMm: 180 }], ceilings: [{ id: 'ceiling', storeyId: 'l1', spaceId: 'room', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], elevationMm: 2600 }], openings: [] });
const derived = () => serviceOpeningsFromSleeves([{ id: 'sleeve-1', routeId: 'route-1', hostId: 'w1', centerMm: [1000, 0, 500], axis: [0, 1, 0], lengthMm: 200, insideDiameterMm: 60 }], 3, 10);

describe('service opening BIM synchronization', () => {
  it('adds, updates, and removes only the selected route derivations', () => {
    const added = syncArchitectureServiceOpenings(architecture(), 'route-1', derived()); expect(added.addedIds).toEqual(['opening:sleeve-1']);
    const moved = derived(); moved[0]!.centerMm = [1200, 0, 500]; const updated = syncArchitectureServiceOpenings(added.architecture, 'route-1', moved); expect(updated.updatedIds).toEqual(['opening:sleeve-1']); expect(updated.architecture.serviceOpenings![0]!.centerMm[0]).toBe(1200);
    const removed = syncArchitectureServiceOpenings(updated.architecture, 'route-1', []); expect(removed.removedIds).toEqual(['opening:sleeve-1']); expect(removed.architecture.serviceOpenings).toEqual([]);
  });
  it('commits architecture and MEP payload atomically', () => {
    const project: UnifiedDesignProject = { schema: 'nexyfab.unified-design-project.v1', id: 'p', revision: 0, coordinateSystems: [{ id: 'project-local', kind: 'building', units: 'mm', origin: [0, 0, 0], rotationDeg: [0, 0, 0] }], documents: [architectureDomainDocument(architecture()), { id: 'mep', domain: 'mep', schema: 'mep.v1', revision: 0, coordinateSystemId: 'project-local', representations: ['graph'], objectIds: ['route-1'], payload: { revision: 0 } }], references: [{ id: 'penetrates', sourceObjectId: 'route-1', targetObjectId: 'w1', relation: 'PENETRATES', updatePolicy: 'follow' }] };
    const result = commitServiceOpeningSync(project, 'architecture', 'mep', 'route-1', derived(), { revision: 1 });
    expect(result.committed).toBe(true); expect(result.invalidatedDocumentIds.sort()).toEqual(['architecture', 'mep']); expect((result.project.documents[0]!.payload as ArchitectureDocument).serviceOpenings).toHaveLength(1);
  });
  it('rejects an opening whose host is absent', () => { const invalid = derived(); invalid[0]!.hostId = 'missing'; expect(() => syncArchitectureServiceOpenings(architecture(), 'route-1', invalid)).toThrow('unknown'); });
});
