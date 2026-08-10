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
  it('rejects changed object IDs owned by another domain document', () => {
    const input = project();
    const result = executeUnifiedProjectTransaction(input, 3, { documentId: 'architecture', changedObjectIds: ['light-1'], apply: document => document });
    expect(result).toMatchObject({ committed: false, project: input });
    expect(result.issues.join(' ')).toContain('not owned by architecture');
  });
  it('rejects coordinate cycles and duplicate semantic relations', () => {
    const input = project();
    input.coordinateSystems[0]!.parentId = 'project-local';
    input.references.push({ id: 'host-light-copy', sourceObjectId: 'light-1', targetObjectId: 'ceiling-1', relation: 'HOSTED_BY', updatePolicy: 'notify' });
    const issues = validateUnifiedDesignProject(input).join(' ');
    expect(issues).toContain('Coordinate system cycle');
    expect(issues).toContain('duplicate cross-domain relation');
  });
  it('traverses a 20,000-reference complex project without repeated full scans', () => {
    const count = 20_001, objectIds = Array.from({ length: count }, (_, index) => `object-${index}`);
    const input: UnifiedDesignProject = { schema: 'nexyfab.unified-design-project.v1', id: 'large', revision: 0, coordinateSystems: [{ id: 'local', kind: 'local', units: 'mm', origin: [0, 0, 0], rotationDeg: [0, 0, 0] }], documents: [{ id: 'model', domain: 'mechanical', schema: 'test.v1', revision: 0, coordinateSystemId: 'local', representations: ['graph'], objectIds, payload: {} }], references: objectIds.slice(1).map((id, index) => ({ id: `ref-${index}`, sourceObjectId: objectIds[index]!, targetObjectId: id, relation: 'CONNECTS_TO', updatePolicy: 'follow' })) };
    const started = performance.now(), result = analyzeUnifiedChangeImpact(input, ['object-0']), elapsedMs = performance.now() - started;
    expect(result.follow).toHaveLength(20_000);
    expect(result.traversedReferenceIds).toHaveLength(20_000);
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
