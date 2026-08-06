import { describe, expect, it } from 'vitest';
import { analyzeUnifiedChangeImpact, executeUnifiedProjectTransaction, validateUnifiedDesignProject, type UnifiedDesignProject } from '../unifiedDesignProject';

const project = (): UnifiedDesignProject => ({
  schema: 'nexyfab.unified-design-project.v1', id: 'project-1', revision: 3,
  coordinateSystems: [{ id: 'site', kind: 'site', units: 'm', origin: [0, 0, 0], rotationDeg: [0, 0, 0] }, { id: 'project-local', kind: 'building', parentId: 'site', units: 'mm', origin: [100, 200, 0], rotationDeg: [0, 0, 0] }],
  documents: [
    { id: 'architecture', domain: 'architecture', schema: 'arch.v1', revision: 2, coordinateSystemId: 'project-local', representations: ['bim'], objectIds: ['room-1', 'ceiling-1'], payload: { value: 1 } },
    { id: 'interior', domain: 'interior', schema: 'interior.v1', revision: 1, coordinateSystemId: 'project-local', representations: ['bim', 'graph'], objectIds: ['light-1', 'chair-1'], payload: {} },
  ],
  references: [
    { id: 'host-light', sourceObjectId: 'light-1', targetObjectId: 'ceiling-1', relation: 'HOSTED_BY', updatePolicy: 'follow' },
    { id: 'clear-chair', sourceObjectId: 'chair-1', targetObjectId: 'room-1', relation: 'MUST_CLEAR', updatePolicy: 'notify' },
  ],
});

describe('unified multi-domain design project', () => {
  it('validates global IDs and follows hosted dependencies across documents', () => {
    expect(validateUnifiedDesignProject(project())).toEqual([]);
    expect(analyzeUnifiedChangeImpact(project(), ['ceiling-1'])).toMatchObject({ follow: ['light-1'] });
    expect(analyzeUnifiedChangeImpact(project(), ['room-1'])).toMatchObject({ notify: ['chair-1'] });
  });
  it('commits atomically and reports every invalidated document', () => {
    const input = project();
    const result = executeUnifiedProjectTransaction(input, 3, { documentId: 'architecture', changedObjectIds: ['ceiling-1'], apply: document => ({ ...document, payload: { value: 2 } }) });
    expect(result.committed).toBe(true);
    expect(result.project.revision).toBe(4);
    expect(result.invalidatedDocumentIds.sort()).toEqual(['architecture', 'interior']);
    expect(input.revision).toBe(3);
  });
  it('preserves the original project on stale, locked, or verifier failure', () => {
    const input = project(); input.references[0]!.updatePolicy = 'locked';
    const locked = executeUnifiedProjectTransaction(input, 3, { documentId: 'architecture', changedObjectIds: ['ceiling-1'], apply: document => document });
    expect(locked.committed).toBe(false); expect(locked.project).toBe(input);
    const stale = executeUnifiedProjectTransaction(input, 2, { documentId: 'architecture', changedObjectIds: ['room-1'], apply: document => document });
    expect(stale.committed).toBe(false);
  });
});
