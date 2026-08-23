import { describe, expect, it } from 'vitest';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from '@/lib/ai/designArtifactGraph';
import {
  hashArchitectureInteriorEvidenceV2,
  hashArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
} from '@/lib/ai/architectureInteriorWorkspace';
import type { ArchitectureDocument, InteriorDocument } from '@/lib/ai/architectureInteriorDocuments';
import {
  executeArchitectureInteriorBrowserTool,
  hashArchitectureInteriorBrowserApproval,
  type ArchitectureInteriorBrowserSession,
} from './architectureInteriorBrowserGateway';

const architecture: ArchitectureDocument = {
  schema: 'nexyfab.architecture.v1', revision: 1,
  storeys: [{ id: 'st', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
  walls: [
    { id: 'w1', kind: 'line', storeyId: 'st', startMm: [0, 0], endMm: [100, 0], thicknessMm: 10, heightMm: 3000 },
    { id: 'w2', kind: 'line', storeyId: 'st', startMm: [100, 0], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 },
    { id: 'w3', kind: 'line', storeyId: 'st', startMm: [100, 100], endMm: [0, 0], thicknessMm: 10, heightMm: 3000 },
  ],
  slabs: [{ id: 'sl', storeyId: 'st', spaceId: 'sp', boundaryMm: [[0, 0], [100, 0], [100, 100]], thicknessMm: 10 }],
  ceilings: [{ id: 'ce', storeyId: 'st', spaceId: 'sp', boundaryMm: [[0, 0], [100, 0], [100, 100]], elevationMm: 2800 }],
  spaces: [{ id: 'sp', storeyId: 'st', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [100, 0], [100, 100]], wallIds: ['w1', 'w2', 'w3'], slabId: 'sl', ceilingId: 'ce' }],
  openings: [],
};
const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'arch', lights: [], furniture: [], finishes: [] };
const frame = (id: string, kind: 'project' | 'site' | 'building' | 'storey' | 'object', parentId?: string, objectId?: string) => ({ id, kind, ...(parentId ? { parentId } : {}), ...(objectId ? { objectId, documentId: 'arch' } : {}), ...(kind === 'storey' ? { storeyId: 'st' } : {}), originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] });

function workspace(): ArchitectureInteriorWorkspaceV2 {
  const evidence = { revision: 1 };
  const draft = {
    schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'p',
    workspace: { projectId: 'p', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const },
    contentHash: '', units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const },
    coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey', 'storey', 'building'), ...['st', 'w1', 'w2', 'w3', 'sl', 'ce', 'sp'].map(id => frame(`obj-${id}`, 'object', 'storey', id))],
    architecture: { documentId: 'arch', document: architecture, geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'test', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'test', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] },
    interior: { documentId: 'int', document: interior, geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'test', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'test', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'b', kind: 'user' as const, contentHash: 'b'.repeat(64) }] },
    artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'p', revision: 1, artifacts: [], dependencies: [] },
  } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}
function stairWorkspace(): ArchitectureInteriorWorkspaceV2 {
  const value = workspace();
  value.architecture.document = structuredClone(value.architecture.document);
  value.architecture.document.storeys.push({ id: 'st2', name: 'Upper', elevationMm: 3000, heightMm: 3000 });
  value.coordinates.push({ id: 'storey-st2', kind: 'storey', parentId: 'building', storeyId: 'st2', originMm: [0, 0, 3000], rotationDeg: [0, 0, 0] }, { id: 'obj-st2', kind: 'object', parentId: 'storey-st2', objectId: 'st2', documentId: 'arch', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
  const contentHash = hashArchitectureInteriorWorkspaceV2(value);
  return { ...value, contentHash, workspace: { ...value.workspace, contentHash } };
}

function session(value = workspace()): ArchitectureInteriorBrowserSession {
  return { sessionId: 'session-01', userId: 'user-01', role: 'editor', projectId: 'p', revision: value.workspace.revision, contentHash: value.contentHash, workspace: value };
}

describe('architecture/interior browser gateway', () => {
  it('selects the server profile and executes a bound read', () => {
    const value = workspace();
    const result = executeArchitectureInteriorBrowserTool({ session: session(value), call: { tool: 'verify_architecture', requestedDomain: 'building', requestedProfile: 'architecture-interior', arguments: { revision: 1, documentId: 'arch', checkCode: 'basic' } } });
    expect(result).toMatchObject({ ok: true, profile: 'architecture-interior', domain: 'architecture-interior', result: { pass: true }, audit: { status: 'completed' } });
  });

  it('rejects spoofed client domain/profile and all contract-only tools', () => {
    const value = workspace();
    const base = { session: session(value), call: { tool: 'verify_architecture', arguments: { revision: 1, documentId: 'arch', checkCode: 'basic' } } };
    expect(executeArchitectureInteriorBrowserTool({ ...base, call: { ...base.call, requestedDomain: 'mechanical' } })).toMatchObject({ ok: false, code: 'DOMAIN_MISMATCH' });
    expect(executeArchitectureInteriorBrowserTool({ ...base, call: { ...base.call, requestedProfile: 'installer-core' } })).toMatchObject({ ok: false, code: 'PROFILE_MISMATCH' });
    expect(executeArchitectureInteriorBrowserTool({ session: session(value), call: { tool: 'render_plan', arguments: { revision: 1, documentId: 'arch', viewCode: 'plan' } } })).toMatchObject({ ok: false, code: 'CONTRACT_ONLY_TOOL' });
  });

  it('requires a server-bound approval receipt for concept edits', () => {
    const value = workspace();
    const call = { tool: 'edit_wall', arguments: { revision: 1, documentId: 'arch', objectId: 'w1', parameterPaths: ['kind', 'startMm', 'endMm'], patch: { kind: 'line', startMm: [0, 0], endMm: [120, 0] } } };
    const current = session(value);
    expect(executeArchitectureInteriorBrowserTool({ session: current, call })).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const receiptHash = hashArchitectureInteriorBrowserApproval({ sessionId: current.sessionId, userId: current.userId, projectId: current.projectId, revision: current.revision, contentHash: current.contentHash, tool: call.tool, arguments: call.arguments });
    expect(executeArchitectureInteriorBrowserTool({ session: current, call: { ...call, approval: { approved: true, receiptHash } } })).toMatchObject({ ok: false, code: 'APPROVAL_INVALID' });
    const result = executeArchitectureInteriorBrowserTool({ session: { ...current, approvedActionHashes: [receiptHash] }, call: { ...call, approval: { approved: true, receiptHash } } });
    expect(result).toMatchObject({ ok: true, workspace: { workspace: { revision: 2 } }, audit: { status: 'completed' } });
    if (result.ok && result.workspace) expect(result.audit.resultHash).toBe(hashArchitectureInteriorEvidenceV2({ result: result.result, outputWorkspaceHash: result.workspace.contentHash }));
  });

  it('applies a new wall only with an exact approval hash and returns a new revision receipt', () => {
    const value = workspace();
    const call = { tool: 'create_wall', arguments: { revision: 1, documentId: 'arch', objectId: 'w4', parameterPaths: ['storeyId', 'kind', 'startMm', 'endMm', 'thicknessMm', 'heightMm'], patch: { storeyId: 'st', kind: 'line', startMm: [0, 100], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 } } };
    const current = session(value);
    const receiptHash = hashArchitectureInteriorBrowserApproval({ sessionId: current.sessionId, userId: current.userId, projectId: current.projectId, revision: current.revision, contentHash: current.contentHash, tool: call.tool, arguments: call.arguments });
    const result = executeArchitectureInteriorBrowserTool({ session: { ...current, approvedActionHashes: [receiptHash] }, call: { ...call, approval: { approved: true, receiptHash } } });
    expect(result).toMatchObject({ ok: true, tool: 'create_wall', workspace: { workspace: { revision: 2 } }, audit: { status: 'completed' } });
    if (result.ok && result.workspace) expect(result.workspace.architecture.document.walls.some(wall => wall.id === 'w4')).toBe(true);
  });

  it('keeps interior placement behind the same server-bound approval gate', () => {
    const value = workspace();
    const call = { tool: 'create_furniture', arguments: { revision: 1, documentId: 'int', objectId: 'chair-1', parameterPaths: ['spaceId', 'positionMm', 'sizeMm', 'clearanceMm'], patch: { spaceId: 'sp', positionMm: [65, 25, 1], sizeMm: [10, 10, 10], clearanceMm: 1 } } };
    const current = session(value);
    const receiptHash = hashArchitectureInteriorBrowserApproval({ sessionId: current.sessionId, userId: current.userId, projectId: current.projectId, revision: current.revision, contentHash: current.contentHash, tool: call.tool, arguments: call.arguments });
    const result = executeArchitectureInteriorBrowserTool({ session: { ...current, approvedActionHashes: [receiptHash] }, call: { ...call, approval: { approved: true, receiptHash } } });
    expect(result).toMatchObject({ ok: true, tool: 'create_furniture', workspace: { workspace: { revision: 2 } }, audit: { status: 'completed' } });
  });

  it('binds audit receipt hashes to the exact call and rejects tampered session heads', () => {
    const value = workspace();
    const result = executeArchitectureInteriorBrowserTool({ session: session(value), call: { tool: 'verify_architecture', arguments: { revision: 1, documentId: 'arch', checkCode: 'basic' } } });
    if (!result.ok) throw new Error('expected success');
    expect(result.audit.receiptHash).toBe(hashArchitectureInteriorEvidenceV2({ ...result.audit, receiptHash: undefined, auditId: undefined }));
    expect(executeArchitectureInteriorBrowserTool({ session: { ...session(value), contentHash: 'f'.repeat(64) }, call: { tool: 'verify_architecture', arguments: { revision: 1, documentId: 'arch', checkCode: 'basic' } } })).toMatchObject({ ok: false, code: 'CONTENT_HASH_MISMATCH' });
  });
  it('executes an approved stair create through the browser CAS and receipt path', () => {
    const value = stairWorkspace();
    const current = session(value);
    const call = { tool: 'create_stair', arguments: { revision: 1, documentId: 'arch', objectId: 'stair-1', parameterPaths: ['fromStoreyId', 'toStoreyId', 'widthMm', 'riserCount', 'treadDepthMm', 'pathMm'], patch: { fromStoreyId: 'st', toStoreyId: 'st2', widthMm: 1200, riserCount: 18, treadDepthMm: 280, pathMm: [[0, 0, 0], [0, 100, 3000]] } } };
    const receiptHash = hashArchitectureInteriorBrowserApproval({ sessionId: current.sessionId, userId: current.userId, projectId: current.projectId, revision: current.revision, contentHash: current.contentHash, tool: call.tool, arguments: call.arguments });
    const result = executeArchitectureInteriorBrowserTool({ session: { ...current, approvedActionHashes: [receiptHash] }, call: { ...call, approval: { approved: true, receiptHash } } });
    expect(result).toMatchObject({ ok: true, tool: 'create_stair', workspace: { workspace: { revision: 2 } }, audit: { status: 'completed' } });
    if (result.ok && result.workspace) {
      expect(result.workspace.architecture.document.stairs?.[0]).toMatchObject({ id: 'stair-1', fromStoreyId: 'st', toStoreyId: 'st2' });
      expect(result.workspace.coordinates.some(item => item.objectId === 'stair-1' && item.parentId === 'storey')).toBe(true);
    }
  });
  it('executes an approved concept shaft through the browser CAS and receipt path', () => {
    const value = stairWorkspace();
    const current = session(value);
    const call = { tool: 'create_shaft', arguments: { revision: 1, documentId: 'arch', objectId: 'shaft-1', parameterPaths: ['fromStoreyId', 'toStoreyId', 'boundaryMm', 'hostSpaceIds'], patch: { fromStoreyId: 'st', toStoreyId: 'st2', boundaryMm: [[10, 10], [40, 10], [40, 40], [10, 40]], hostSpaceIds: ['sp'] } } };
    const receiptHash = hashArchitectureInteriorBrowserApproval({ sessionId: current.sessionId, userId: current.userId, projectId: current.projectId, revision: current.revision, contentHash: current.contentHash, tool: call.tool, arguments: call.arguments });
    expect(executeArchitectureInteriorBrowserTool({ session: current, call })).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const result = executeArchitectureInteriorBrowserTool({ session: { ...current, approvedActionHashes: [receiptHash] }, call: { ...call, approval: { approved: true, receiptHash } } });
    expect(result).toMatchObject({ ok: true, tool: 'create_shaft', workspace: { workspace: { revision: 2 } }, audit: { status: 'completed' } });
    if (result.ok && result.workspace) expect(result.workspace.architecture.document.shafts?.[0]?.hostSpaceIds).toEqual(['sp']);
  });
  it('executes an approved concept elevator through the browser CAS and receipt path', () => {
    const value = stairWorkspace();
    value.architecture.document.shafts = [{ id: 'shaft-e', fromStoreyId: 'st', toStoreyId: 'st2', boundaryMm: [[10, 10], [40, 10], [40, 40], [10, 40]], hostSpaceIds: ['sp'] }];
    value.coordinates.push({ id: 'obj-shaft-e', kind: 'object', parentId: 'storey', objectId: 'shaft-e', documentId: 'arch', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    const valueHash = hashArchitectureInteriorWorkspaceV2(value); value.contentHash = valueHash; value.workspace.contentHash = valueHash;
    const current = session(value);
    const call = { tool: 'create_elevator', arguments: { revision: 1, documentId: 'arch', objectId: 'elevator-1', parameterPaths: ['shaftId', 'servedStoreyIds'], patch: { shaftId: 'shaft-e', servedStoreyIds: ['st', 'st2'] } } };
    const receiptHash = hashArchitectureInteriorBrowserApproval({ sessionId: current.sessionId, userId: current.userId, projectId: current.projectId, revision: current.revision, contentHash: current.contentHash, tool: call.tool, arguments: call.arguments });
    expect(executeArchitectureInteriorBrowserTool({ session: current, call })).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const result = executeArchitectureInteriorBrowserTool({ session: { ...current, approvedActionHashes: [receiptHash] }, call: { ...call, approval: { approved: true, receiptHash } } });
    expect(result).toMatchObject({ ok: true, tool: 'create_elevator', workspace: { workspace: { revision: 2 } }, audit: { status: 'completed' } });
    if (result.ok && result.workspace) expect(result.workspace.architecture.document.elevators?.[0]?.servedStoreyIds).toEqual(['st', 'st2']);
  });
  it('executes an approved service opening through the browser CAS and receipt path', () => {
    const value = workspace();
    const current = session(value);
    const call = { tool: 'create_service_opening', arguments: { revision: 1, documentId: 'arch', objectId: 'svc-1', parameterPaths: ['hostId', 'sourceRouteId', 'sourceSleeveId', 'shape', 'centerMm', 'axis', 'cutDiameterMm', 'depthMm', 'firestopAnnulusMm'], patch: { hostId: 'w1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', shape: 'round', centerMm: [20, 0, 1500], axis: [1, 0, 0], cutDiameterMm: 100, depthMm: 200, firestopAnnulusMm: 25 } } };
    const receiptHash = hashArchitectureInteriorBrowserApproval({ sessionId: current.sessionId, userId: current.userId, projectId: current.projectId, revision: current.revision, contentHash: current.contentHash, tool: call.tool, arguments: call.arguments });
    expect(executeArchitectureInteriorBrowserTool({ session: current, call })).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const result = executeArchitectureInteriorBrowserTool({ session: { ...current, approvedActionHashes: [receiptHash] }, call: { ...call, approval: { approved: true, receiptHash } } });
    expect(result).toMatchObject({ ok: true, tool: 'create_service_opening', workspace: { workspace: { revision: 2 } }, audit: { status: 'completed' } });
    if (result.ok && result.workspace) expect(result.workspace.architecture.document.serviceOpenings?.[0]?.sourceRouteId).toBe('route-1');
  });
  it('executes an approved stable-ID grid edit through the browser receipt path', () => {
    const value = workspace();
    value.architecture.document.grids = [{ id: 'grid-a', name: 'A', axis: 'x', startMm: [0, 0], endMm: [100, 0] }];
    value.coordinates.push({ id: 'obj-grid-a', kind: 'object', parentId: 'building', objectId: 'grid-a', documentId: 'arch', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    const valueHash = hashArchitectureInteriorWorkspaceV2(value);
    value.contentHash = valueHash; value.workspace.contentHash = valueHash;
    const current = session(value);
    const call = { tool: 'edit_grid', arguments: { revision: 1, documentId: 'arch', objectId: 'grid-a', parameterPaths: ['name', 'endMm'], patch: { name: 'A1', endMm: [120, 0] } } };
    const receiptHash = hashArchitectureInteriorBrowserApproval({ sessionId: current.sessionId, userId: current.userId, projectId: current.projectId, revision: current.revision, contentHash: current.contentHash, tool: call.tool, arguments: call.arguments });
    expect(executeArchitectureInteriorBrowserTool({ session: current, call })).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const result = executeArchitectureInteriorBrowserTool({ session: { ...current, approvedActionHashes: [receiptHash] }, call: { ...call, approval: { approved: true, receiptHash } } });
    expect(result).toMatchObject({ ok: true, tool: 'edit_grid', workspace: { workspace: { revision: 2 } }, audit: { status: 'completed' } });
    if (result.ok && result.workspace) expect(result.workspace.architecture.document.grids).toEqual([{ id: 'grid-a', name: 'A1', axis: 'x', startMm: [0, 0], endMm: [120, 0] }]);
  });
});
