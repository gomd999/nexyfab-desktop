import { describe, expect, it } from 'vitest';
import { hashArchitectureInteriorEvidenceV2, validateArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { CompiledArchitectureInteriorConcept } from './architectureInteriorAiDesignProposal';
import { bootstrapArchitectureInteriorAiCandidateWorkspace } from './architectureInteriorAiCandidateWorkspace';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';

function candidate(): CompiledArchitectureInteriorConcept {
  const architecture: ArchitectureDocument = {
    schema: 'nexyfab.architecture.v1' as const, revision: 0,
    storeys: [{ id: 'storey-1', name: 'Ground', elevationMm: 100, heightMm: 3000 }],
    spaces: [{ id: 'space-1', storeyId: 'storey-1', name: 'Office', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: ['wall-1', 'wall-2', 'wall-3', 'wall-4'], slabId: 'slab-1', ceilingId: 'ceiling-1' }],
    walls: [
      { id: 'wall-1', kind: 'line' as const, storeyId: 'storey-1', startMm: [0, 0] as [number, number], endMm: [4000, 0] as [number, number], thicknessMm: 150, heightMm: 3000 },
      { id: 'wall-2', kind: 'line' as const, storeyId: 'storey-1', startMm: [4000, 0] as [number, number], endMm: [4000, 3000] as [number, number], thicknessMm: 150, heightMm: 3000 },
      { id: 'wall-3', kind: 'line' as const, storeyId: 'storey-1', startMm: [4000, 3000] as [number, number], endMm: [0, 3000] as [number, number], thicknessMm: 150, heightMm: 3000 },
      { id: 'wall-4', kind: 'line' as const, storeyId: 'storey-1', startMm: [0, 3000] as [number, number], endMm: [0, 0] as [number, number], thicknessMm: 150, heightMm: 3000 },
    ],
    slabs: [{ id: 'slab-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], thicknessMm: 200 }],
    ceilings: [{ id: 'ceiling-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], elevationMm: 3100, thicknessMm: 100 }],
    openings: [{ id: 'door-1', kind: 'door' as const, hostWallId: 'wall-1', offsetMm: 500, widthMm: 900, heightMm: 2100, sillMm: 0, positionMm: [500, 0, 0] as [number, number, number] }],
  };
  const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 0, architectureDocumentId: 'architecture:project-1:proposal-1', lights: [{ id: 'light-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', positionMm: [2000, 1500, 3000] as [number, number, number], suspensionMm: 100, lumens: 1200, cctK: 4000 }], furniture: [{ id: 'desk-1', spaceId: 'space-1', positionMm: [1000, 1000, 0] as [number, number, number], sizeMm: [1200, 600, 750] as [number, number, number], clearanceMm: 600 }], finishes: [{ id: 'finish-1', spaceId: 'space-1', hostId: 'slab-1', surface: 'floor' as const, material: 'oak' }] };
  const proposalHash = 'a'.repeat(64);
  return { architecture, interior, coordinateFrame: { id: 'frame-project', originMm: [123, 456, 0], rotationDeg: [0, 0, 12] }, provenance: { architecture: [{ sourceId: `proposal:${proposalHash}`, kind: 'ai', contentHash: proposalHash }], interior: [{ sourceId: `proposal:${proposalHash}`, kind: 'ai', contentHash: proposalHash }] }, hashes: { proposal: proposalHash, architecture: hashArchitectureInteriorEvidenceV2(architecture), interior: hashArchitectureInteriorEvidenceV2(interior) }, compilerVersion: 'concept-compiler.v1', warnings: ['concept_only_no_exact_or_release_evidence', 'code_compliance_not_evaluated'] };
}

const approval = { projectId: 'project-1', proposalId: 'proposal-1', proposalHash: 'a'.repeat(64), actorId: 'user-1', scope: 'architecture_interior_concept' as const };

describe('AI candidate workspace bootstrap', () => {
  it('creates a revision-zero concept workspace with valid graph and truthfully unverified geometry', () => {
    const result = bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: candidate(), approval });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateArchitectureInteriorWorkspaceV2(result.workspace)).toEqual([]);
    expect(result.workspace.workspace).toMatchObject({ revision: 0, track: 'ai_design', maturity: 'concept' });
    expect(result.workspace.architecture.geometry.verification.status).toBe('not_run');
    expect(result.workspace.interior.geometry.verification.status).toBe('not_run');
    expect(result.workspace.artifactGraph.artifacts.map(item => item.kind)).toEqual(['model', 'model']);
    expect(result.workspace.artifactGraph.artifacts.every(item => item.state === 'current' && item.verification.status === 'passed')).toBe(true);
  });

  it('accepts platform UUID actor identifiers that begin with a digit', () => {
    const result = bootstrapArchitectureInteriorAiCandidateWorkspace({
      candidate: candidate(),
      approval: { ...approval, actorId: '1b7e9f2c-2ee6-4cb7-b64e-b4a22a692c31' },
    });
    expect(result.ok).toBe(true);
  });

  it('preserves the candidate project frame and creates all storey/object frames', () => {
    const result = bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: candidate(), approval });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.workspace.coordinates.find(frame => frame.kind === 'project');
    expect(project).toMatchObject({ id: 'frame-project', originMm: [123, 456, 0], rotationDeg: [0, 0, 12] });
    const objectIds = result.workspace.coordinates.filter(frame => frame.kind === 'object').map(frame => frame.objectId);
    expect(objectIds).toEqual(expect.arrayContaining(['storey-1', 'space-1', 'wall-1', 'door-1', 'slab-1', 'ceiling-1', 'light-1', 'desk-1', 'finish-1']));
  });

  it('keeps multi-storey child origins local while preserving composed elevation', () => {
    const twoStorey = candidate();
    twoStorey.architecture.storeys.push({ id: 'storey-2', name: 'Upper', elevationMm: 5000, heightMm: 2800 });
    twoStorey.architecture.spaces.push({ id: 'space-2', storeyId: 'storey-2', name: 'Upper office', usage: 'office', boundaryMm: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]], wallIds: ['wall-5', 'wall-6', 'wall-7', 'wall-8'], slabId: 'slab-2', ceilingId: 'ceiling-2' });
    twoStorey.architecture.walls.push(
      { id: 'wall-5', kind: 'line', storeyId: 'storey-2', startMm: [0, 0], endMm: [2000, 0], thicknessMm: 150, heightMm: 2800 },
      { id: 'wall-6', kind: 'line', storeyId: 'storey-2', startMm: [2000, 0], endMm: [2000, 2000], thicknessMm: 150, heightMm: 2800 },
      { id: 'wall-7', kind: 'line', storeyId: 'storey-2', startMm: [2000, 2000], endMm: [0, 2000], thicknessMm: 150, heightMm: 2800 },
      { id: 'wall-8', kind: 'line', storeyId: 'storey-2', startMm: [0, 2000], endMm: [0, 0], thicknessMm: 150, heightMm: 2800 },
    );
    twoStorey.architecture.slabs.push({ id: 'slab-2', storeyId: 'storey-2', spaceId: 'space-2', boundaryMm: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]], thicknessMm: 200 });
    twoStorey.architecture.ceilings.push({ id: 'ceiling-2', storeyId: 'storey-2', spaceId: 'space-2', boundaryMm: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]], elevationMm: 7800, thicknessMm: 100 });
    twoStorey.hashes.architecture = hashArchitectureInteriorEvidenceV2(twoStorey.architecture);
    const result = bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: twoStorey, approval });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storey = result.workspace.coordinates.find(frame => frame.kind === 'storey' && frame.storeyId === 'storey-2');
    const wall = result.workspace.coordinates.find(frame => frame.kind === 'object' && frame.objectId === 'wall-5');
    expect(storey?.originMm).toEqual([0, 0, 5000]);
    expect(wall?.parentId).toBe(storey?.id);
    expect(wall?.originMm).toEqual([0, 0, 0]);
  });

  it('rejects project, proposal, approval, hash, and unsafe candidate mismatches', () => {
    expect(bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: candidate(), approval: { ...approval, projectId: 'other-project' } })).toMatchObject({ ok: false, code: 'project_mismatch' });
    expect(bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: candidate(), approval: { ...approval, proposalHash: 'b'.repeat(64) } })).toMatchObject({ ok: false, code: 'proposal_mismatch' });
    const forged = candidate(); forged.hashes.architecture = 'b'.repeat(64);
    expect(bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: forged, approval })).toMatchObject({ ok: false, code: 'candidate_hash_mismatch' });
    const unsafe = candidate(); (unsafe.architecture as unknown as { siteCoordinateSystemId: string }).siteCoordinateSystemId = 'https://unsafe.invalid';
    expect(bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: unsafe, approval })).toMatchObject({ ok: false, code: 'candidate_unsafe' });
    const malformed = candidate() as unknown as { coordinateFrame: null };
    malformed.coordinateFrame = null;
    expect(() => bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: malformed as never, approval })).not.toThrow();
    expect(bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: malformed as never, approval })).toMatchObject({ ok: false, code: 'candidate_invalid' });
  });
});
