import { describe, expect, it } from 'vitest';
import { architectureDomainDocument, editArchitectureInteriorProject, interiorDomainDocument } from '../architectureInteriorProjectAdapter';
import type { ArchitectureDocument, InteriorDocument } from '../architectureInteriorDocuments';
import type { UnifiedDesignProject } from '../unifiedDesignProject';
import { validateFederatedDomainProject } from '../federatedDomainValidation';

const architecture: ArchitectureDocument = { schema: 'nexyfab.architecture.v1', revision: 0, storeys: [{ id: 'l1', name: 'L1', elevationMm: 0, heightMm: 3000 }], spaces: [{ id: 'r1', storeyId: 'l1', name: 'R1', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: ['w1', 'w2', 'w3', 'w4'], slabId: 's1', ceilingId: 'c1' }], walls: [{ id: 'w1', kind: 'line', storeyId: 'l1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 }, { id: 'w2', kind: 'line', storeyId: 'l1', startMm: [4000, 0], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 }, { id: 'w3', kind: 'line', storeyId: 'l1', startMm: [4000, 3000], endMm: [0, 3000], thicknessMm: 200, heightMm: 3000 }, { id: 'w4', kind: 'line', storeyId: 'l1', startMm: [0, 3000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 }], slabs: [{ id: 's1', storeyId: 'l1', spaceId: 'r1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], thicknessMm: 180 }], ceilings: [{ id: 'c1', storeyId: 'l1', spaceId: 'r1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], elevationMm: 2600 }], openings: [] };
const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 0, architectureDocumentId: 'architecture', lights: [{ id: 'light1', spaceId: 'r1', hostCeilingId: 'c1', positionMm: [2000, 1500, 2500], suspensionMm: 100, lumens: 3000, cctK: 4000 }], furniture: [], finishes: [] };
const project = (): UnifiedDesignProject => ({ schema: 'nexyfab.unified-design-project.v1', id: 'p1', revision: 0, coordinateSystems: [{ id: 'project-local', kind: 'building', units: 'mm', origin: [0, 0, 0], rotationDeg: [0, 0, 0] }], documents: [architectureDomainDocument(architecture), interiorDomainDocument(interior)], references: [{ id: 'light-host', sourceObjectId: 'light1', targetObjectId: 'c1', relation: 'HOSTED_BY', updatePolicy: 'follow' }] });

describe('architecture/interior coordinated project transaction', () => {
  it('commits ceiling and hosted light changes in one revision', () => {
    const result = editArchitectureInteriorProject(project(), 'architecture', 'interior', { kind: 'set_ceiling_elevation', ceilingId: 'c1', elevationMm: 2800 });
    expect(result.committed).toBe(true);
    expect(result.project.revision).toBe(1);
    expect(result.invalidatedDocumentIds.sort()).toEqual(['architecture', 'interior']);
    expect(((result.project.documents.find(item => item.id === 'interior')!.payload) as InteriorDocument).lights[0]!.positionMm[2]).toBe(2700);
  });
  it('rolls back both documents when the hosted light is locked', () => {
    const input = project(); input.references[0]!.updatePolicy = 'locked';
    const result = editArchitectureInteriorProject(input, 'architecture', 'interior', { kind: 'set_ceiling_elevation', ceilingId: 'c1', elevationMm: 2800 });
    expect(result.committed).toBe(false); expect(result.project).toBe(input); expect(result.issues[0]).toContain('Locked');
  });
  it('rejects field measurements pinned to a stale architecture revision', () => {
    const input = project();
    const fitout = input.documents.find(item => item.id === 'interior')!.payload as InteriorDocument;
    fitout.fieldMeasurement = { sourceRef: 'scan:verified', measuredAt: '2026-08-09T00:00:00Z', architectureRevision: 0, toleranceMm: 5 };
    (input.documents.find(item => item.id === 'architecture')!.payload as ArchitectureDocument).revision = 1;
    expect(validateFederatedDomainProject(input).join(' ')).toContain('architecture host revision is stale');
  });
});
