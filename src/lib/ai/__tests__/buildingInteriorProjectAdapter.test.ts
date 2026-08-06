import { describe, expect, it } from 'vitest';
import { buildingInteriorDocument, editBuildingInteriorProject } from '../buildingInteriorProjectAdapter';
import type { BuildingInteriorModel } from '../buildingInteriorDesign';
import type { UnifiedDesignProject } from '../unifiedDesignProject';

const model: BuildingInteriorModel = { schema: 'nexyfab.building-interior.v1', units: 'mm', revision: 0, objects: [
  { id: 'room-1', kind: 'room', name: 'Room', positionMm: [0, 0, 0], sizeMm: [4000, 3000, 2600], usage: 'office' },
  { id: 'light-1', kind: 'light', name: 'Light', positionMm: [1000, 1000, 2400], roomId: 'room-1', lumens: 2000, cctK: 4000, mountingHeightMm: 2400 },
] };

describe('building/interior unified project adapter', () => {
  it('edits one document and propagates impact to a related architecture object', () => {
    const project: UnifiedDesignProject = { schema: 'nexyfab.unified-design-project.v1', id: 'p', revision: 0, coordinateSystems: [{ id: 'project-local', kind: 'local', units: 'mm', origin: [0, 0, 0], rotationDeg: [0, 0, 0] }], documents: [buildingInteriorDocument(model, 'interior'), { id: 'architecture', domain: 'architecture', schema: 'arch.v1', revision: 0, coordinateSystemId: 'project-local', representations: ['bim'], objectIds: ['ceiling-1'], payload: {} }], references: [{ id: 'host', sourceObjectId: 'light-1', targetObjectId: 'ceiling-1', relation: 'HOSTED_BY', updatePolicy: 'follow' }] };
    const result = editBuildingInteriorProject(project, 'interior', [{ kind: 'move', objectId: 'light-1', positionMm: [1200, 900, 2400] }]);
    expect(result.committed).toBe(true);
    expect(result.invalidatedDocumentIds.sort()).toEqual(['architecture', 'interior']);
    expect((result.project.documents[0]!.payload as BuildingInteriorModel).objects[1]!.positionMm).toEqual([1200, 900, 2400]);
  });
});
