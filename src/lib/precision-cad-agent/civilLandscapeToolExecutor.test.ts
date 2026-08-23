import { describe, expect, it } from 'vitest';
import { type CivilDocument } from '@/lib/ai/civilDocument';
import { type LandscapeDocument } from '@/lib/ai/landscapeDocument';
import {
  challengeCivilLandscapeTool,
  executeCivilLandscapeTool,
  hashCivilLandscapeWorkspace,
  planCivilLandscapeTool,
  validateCivilLandscapeWorkspace,
  type CivilLandscapeAgentWorkspace,
  type CivilLandscapeToolChallenge,
} from './civilLandscapeToolExecutor';
import { validateCivilLandscapeToolCatalog } from './civilLandscapeToolCatalog';

const civil = (): CivilDocument => ({
  schema: 'nexyfab.civil.v1', revision: 0, coordinateSystemId: 'site',
  crs: { epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'KVD2002', units: 'm' },
  sourceEvidence: [{ id: 'survey', kind: 'survey', sourceRef: 'survey:internal', capturedAt: '2026-08-01T00:00:00Z' }],
  surveyControls: [], points: [{ id: 'p1', positionM: [0, 0, 0], evidenceId: 'survey' }, { id: 'p2', positionM: [10, 0, 0], evidenceId: 'survey' }, { id: 'p3', positionM: [0, 10, 0], evidenceId: 'survey' }],
  surfaces: [{ id: 'eg', kind: 'existing', pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], sourceEvidenceIds: ['survey'] }],
  alignments: [], profiles: [], crossSections: [], corridors: [], drainageNodes: [], drainageLinks: [], catchments: [], structures: [], stages: [],
});

const landscape = (): LandscapeDocument => ({
  schema: 'nexyfab.landscape.v1', revision: 0, coordinateSystemId: 'site', terrain: { civilDocumentId: 'civil-doc', surfaceId: 'eg', civilRevision: 0 }, sourceEvidence: [], siteBoundaryM: [[0, 0], [100, 0], [0, 100]], plants: [], plantingZones: [], hardscapes: [], soilVolumes: [], irrigationNodes: [], irrigationPipes: [], irrigationZones: [], drainagePaths: [], maintenanceZones: [],
});

function workspace(): CivilLandscapeAgentWorkspace {
  const value: CivilLandscapeAgentWorkspace = { schema: 'nexyfab.precision-cad.civil-landscape-workspace.v1', projectId: 'project-1', revision: 0, contentHash: '', coordinateSystemIds: ['site'], documents: [{ documentId: 'civil-doc', domain: 'civil', document: civil() }, { documentId: 'land-doc', domain: 'landscape', document: landscape() }], artifacts: [{ id: 'tin-preview', documentId: 'civil-doc', revision: 0, state: 'current', contentHash: '0'.repeat(64) }, { id: 'planting-preview', documentId: 'land-doc', revision: 0, state: 'current', contentHash: '1'.repeat(64) }] };
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

function maintenanceWorkspace(): CivilLandscapeAgentWorkspace {
  const value = workspace();
  const document = value.documents[1]!.document as LandscapeDocument;
  document.maintenanceZones = [{ id: 'maintenance-zone-1', boundaryM: [[10, 10], [30, 10], [10, 30]], accessWidthM: 2, taskCodes: ['PRUNE', 'INSPECT'] }];
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

function approval(challenge: CivilLandscapeToolChallenge) {
  return { approved: true as const, approvalId: 'approval-1', actorId: 'reviewer-1', challengeHash: challenge.challengeHash, commandHash: challenge.commandHash };
}

function drainageWorkspace(): CivilLandscapeAgentWorkspace {
  const value = workspace();
  const document = value.documents[0]!.document as CivilDocument;
  document.drainageNodes = [
    { id: 'inlet-1', kind: 'inlet', positionM: [2, 2, 0], invertElevationM: -1, rimElevationM: 0 },
    { id: 'outfall-1', kind: 'outfall', positionM: [8, 8, 0], invertElevationM: -2, rimElevationM: -1 },
  ];
  document.drainageLinks = [{ id: 'pipe-1', fromNodeId: 'inlet-1', toNodeId: 'outfall-1', diameterMm: 300, lengthM: 12, material: 'PVC' }];
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

function irrigationWorkspace(): CivilLandscapeAgentWorkspace {
  const value = workspace();
  const document = value.documents[1]!.document as LandscapeDocument;
  document.irrigationNodes = [
    { id: 'source-1', kind: 'source', positionM: [5, 5, 0], pressureKpa: 300, flowLpm: 40 },
    { id: 'valve-1', kind: 'valve', positionM: [20, 20, 0] },
    { id: 'emitter-1', kind: 'emitter', positionM: [40, 40, 0] },
  ];
  document.irrigationPipes = [{ id: 'irrigation-pipe-1', fromNodeId: 'source-1', toNodeId: 'valve-1', diameterMm: 25, lengthM: 20 }];
  document.irrigationZones = [{ id: 'zone-1', valveNodeId: 'valve-1', emitterNodeIds: ['emitter-1'], plantingZoneIds: [], designFlowLpm: 10 }];
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

function profileCorridorWorkspace(): CivilLandscapeAgentWorkspace {
  const value = workspace();
  const document = value.documents[0]!.document as CivilDocument;
  document.alignments = [{ id: 'alignment-1', name: 'Main Road', segments: [{ id: 'alignment-1-segment-1', kind: 'line', startM: [0, 0], endM: [100, 0], startStationM: 0 }] }];
  document.profiles = [{ id: 'profile-1', alignmentId: 'alignment-1', kind: 'proposed', points: [{ id: 'pvi-1', stationM: 0, elevationM: 10 }, { id: 'pvi-middle', stationM: 50, elevationM: 11 }, { id: 'pvi-2', stationM: 100, elevationM: 12 }] }];
  document.corridors = [{ id: 'corridor-1', alignmentId: 'alignment-1', profileId: 'profile-1', assemblyCode: 'ROAD-2L', targetSurfaceIds: ['eg'], startStationM: 0, endStationM: 100 }];
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

function plantingIrrigationZoneWorkspace(): CivilLandscapeAgentWorkspace {
  const value = workspace();
  const document = value.documents[1]!.document as LandscapeDocument;
  document.plants = [
    { id: 'plant-1', speciesCode: 'TREE-A', positionM: [10, 10, 0], installedHeightM: 2, matureCanopyDiameterM: 4, rootZoneDiameterM: 1, spacingM: 3, evidenceIds: [] },
    { id: 'plant-2', speciesCode: 'TREE-B', positionM: [20, 10, 0], installedHeightM: 2, matureCanopyDiameterM: 4, rootZoneDiameterM: 1, spacingM: 3, evidenceIds: [] },
  ];
  document.soilVolumes = [{ id: 'soil-1', boundaryM: [[5, 5], [30, 5], [5, 30]], depthM: 1, soilType: 'loam', drainageClass: 'well-drained' }];
  document.plantingZones = [{ id: 'planting-zone-1', boundaryM: [[5, 5], [30, 5], [5, 30]], plantIds: ['plant-1'], soilVolumeId: 'soil-1', targetCoveragePercent: 40 }];
  document.irrigationNodes = [
    { id: 'source-1', kind: 'source', positionM: [2, 2, 0], pressureKpa: 300, flowLpm: 100 },
    { id: 'valve-1', kind: 'valve', positionM: [10, 5, 0] },
    { id: 'emitter-1', kind: 'emitter', positionM: [15, 10, 0] },
  ];
  document.irrigationZones = [{ id: 'irrigation-zone-1', valveNodeId: 'valve-1', emitterNodeIds: ['emitter-1'], plantingZoneIds: ['planting-zone-1'], designFlowLpm: 10 }];
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

function hardscapeSoilWorkspace(): CivilLandscapeAgentWorkspace {
  const value = workspace();
  const document = value.documents[1]!.document as LandscapeDocument;
  document.soilVolumes = [{ id: 'soil-1', boundaryM: [[5, 5], [30, 5], [5, 30]], depthM: 1, soilType: 'loam', drainageClass: 'well-drained' }];
  document.hardscapes = [{ id: 'path-1', kind: 'path', boundaryM: [[10, 10], [30, 10], [30, 12], [10, 12]], material: 'paver', slopePercent: 1, accessible: true }];
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

function surveyDrainageWorkspace(): CivilLandscapeAgentWorkspace {
  const value = workspace();
  const document = value.documents[0]!.document as CivilDocument;
  document.surveyControls = [{ id: 'control-1', name: 'CP-1', positionM: [2, 2, 0], order: 'combined', evidenceId: 'survey' }];
  document.drainageNodes = [
    { id: 'node-1', kind: 'inlet', positionM: [10, 10, 0], invertElevationM: -1, rimElevationM: 0 },
    { id: 'node-2', kind: 'outfall', positionM: [20, 20, 0], invertElevationM: -2, rimElevationM: -1 },
  ];
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

function drainagePathWorkspace(): CivilLandscapeAgentWorkspace {
  const value = workspace();
  const document = value.documents[1]!.document as LandscapeDocument;
  document.drainagePaths = [{ id: 'swale-1', pointsM: [[10, 10, 0], [20, 10, -1]], outletObjectId: 'civil:outfall-1', minimumSlopePercent: 5 }];
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

function civilResidualWorkspace(): CivilLandscapeAgentWorkspace {
  const value = workspace();
  const document = value.documents[0]!.document as CivilDocument;
  document.alignments = [{ id: 'road-a', name: 'Road A', segments: [{ id: 'road-a-segment-1', kind: 'line', startM: [0, 0], endM: [100, 0], startStationM: 0 }] }];
  document.crossSections = [{ id: 'xs-1', alignmentId: 'road-a', stationM: 10, points: [{ offsetM: -5, elevationM: 10, code: 'ETW' }, { offsetM: 0, elevationM: 10.2, code: 'CL' }, { offsetM: 5, elevationM: 10, code: 'ETW' }] }];
  document.drainageNodes = [{ id: 'outfall-1', kind: 'outfall', positionM: [20, 20, 0], invertElevationM: -2, rimElevationM: -1 }];
  document.catchments = [{ id: 'catchment-1', boundaryM: [[5, 5], [25, 5], [5, 25]], outletNodeId: 'outfall-1', runoffCoefficient: 0.5 }];
  document.structures = [{ id: 'structure-1', kind: 'retaining_wall', alignmentId: 'road-a', stationM: 20, sourceEvidenceIds: ['survey'] }];
  value.contentHash = hashCivilLandscapeWorkspace(value);
  return value;
}

describe('civil/landscape precision CAD tools', () => {
  it('has a valid catalog and performs approved atomic point creation with receipt', () => {
    expect(validateCivilLandscapeToolCatalog()).toEqual([]);
    const before = workspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'p4', positionM: [20, 20, 1], evidenceId: 'survey' };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'create_point', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result.committed).toBe(true);
    if (result.committed) {
      expect(result.receipt.afterRevision).toBe(1);
      expect(result.receipt.invalidatedArtifactIds).toEqual(['tin-preview', 'planting-preview']);
      expect(result.receipt).toMatchObject({ approvalId: 'approval-1', actorId: 'reviewer-1' });
      expect(result.workspace.documents[0]!.document).toMatchObject({ revision: 1, points: expect.arrayContaining([expect.objectContaining({ id: 'p4' })]) });
      expect((result.workspace.documents[1]!.document as LandscapeDocument).terrain.civilRevision).toBe(1);
      expect(result.workspace.contentHash).not.toBe(before.contentHash);
    }
    expect(before.revision).toBe(0);
    expect((before.documents[0]!.document as CivilDocument).points).toHaveLength(3);
  });

  it('rejects stale bindings, missing approval, invalid hosts, and unsupported terrain modifiers', () => {
    const before = workspace();
    const staleArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 9, contentHash: before.contentHash, objectId: 'p4', positionM: [20, 20, 1], evidenceId: 'survey' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'create_point', arguments: staleArgs })).toBeNull();
    const args = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'plant-1', speciesCode: 'ACER', positionM: [2, 2, 0], installedHeightM: 2, matureCanopyDiameterM: 4, rootZoneDiameterM: 1, spacingM: 3, evidenceIds: [] };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'create_plant', arguments: args })!;
    const challenge = challengeCivilLandscapeTool(plan);
    expect(executeCivilLandscapeTool({ workspace: before, plan, challenge })).toMatchObject({ committed: false, code: 'approval_required' });
    expect(executeCivilLandscapeTool({ workspace: before, plan, challenge, approval: { ...approval(challenge), commandHash: '0'.repeat(64) } })).toMatchObject({ committed: false, code: 'approval_required' });
    const bad = { ...args, objectId: 'plant-2', evidenceIds: ['missing'] };
    const badPlan = planCivilLandscapeTool({ workspace: before, tool: 'create_plant', arguments: bad });
    expect(badPlan).not.toBeNull();
    const badChallenge = challengeCivilLandscapeTool(badPlan!);
    const badResult = executeCivilLandscapeTool({ workspace: before, plan: badPlan!, challenge: badChallenge, approval: approval(badChallenge) });
    expect(badResult).toMatchObject({ committed: false, code: 'validation_failed' });
    const targetArgs = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'modifier', boundaryM: [[0, 0], [1, 0], [0, 1]], deltaM: 1 };
    const modifierPlan = planCivilLandscapeTool({ workspace: before, tool: 'create_terrain_modifier', arguments: targetArgs });
    expect(modifierPlan).not.toBeNull();
    const modifierChallenge = challengeCivilLandscapeTool(modifierPlan!);
    const modifierResult = executeCivilLandscapeTool({ workspace: before, plan: modifierPlan!, challenge: modifierChallenge, approval: approval(modifierChallenge) });
    expect(modifierResult).toMatchObject({ committed: true, receipt: { tool: 'create_terrain_modifier', afterRevision: 1 } });
    if (modifierResult.committed) {
      expect((modifierResult.workspace.documents[1]!.document as LandscapeDocument).terrainModifiers).toEqual([
        { id: 'modifier', boundaryM: [[0, 0], [1, 0], [0, 1]], deltaM: 1 },
      ]);
    }
  });

  it('keeps terrain modifier edits fail-closed when outside the site boundary', () => {
    const before = workspace();
    const args = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'outside', boundaryM: [[99, 99], [100, 99], [99, 100]], deltaM: 1 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'create_terrain_modifier', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
  });

  it('fails closed for malformed nested geometry, sensitive keys, and broken cross-domain terrain binding', () => {
    const before = workspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'surface-2', kind: 'proposed', pointIds: ['p1', 'p2', 'p3'], sourceEvidenceIds: ['survey'] };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'create_surface', arguments: { ...base, triangles: [['p1', 'p2']] } })).toBeNull();
    expect(planCivilLandscapeTool({ workspace: before, tool: 'create_surface', arguments: { ...base, triangles: [['p1', 'p2', 'p3']], breaklines: [['p1', 'p2']], sourcePath: 'C:\\private' } })).toBeNull();

    const malformed = structuredClone(before) as unknown as Record<string, unknown>;
    const documents = malformed.documents as Array<Record<string, unknown>>;
    documents[0]!.document = { schema: 'nexyfab.civil.v1', revision: 0, coordinateSystemId: 'site' };
    expect(() => validateCivilLandscapeWorkspace(malformed)).not.toThrow();
    expect(validateCivilLandscapeWorkspace(malformed)).toContain('document_invalid:civil-doc');

    const broken = workspace();
    (broken.documents[1]!.document as LandscapeDocument).terrain.surfaceId = 'missing';
    broken.contentHash = hashCivilLandscapeWorkspace(broken);
    expect(validateCivilLandscapeWorkspace(broken)).toContain('landscape_civil_binding_invalid');
  });

  it('resizes a drainage pipe by stable object id and invalidates all current artifacts', () => {
    const before = drainageWorkspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: before.revision, contentHash: before.contentHash, objectId: 'pipe-1', diameterMm: 450, lengthM: 14, material: 'HDPE' };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_link', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_drainage_link', affectedObjectIds: ['pipe-1'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (result.committed) {
      const document = result.workspace.documents[0]!.document as CivilDocument;
      expect(document.drainageLinks).toEqual([{ id: 'pipe-1', fromNodeId: 'inlet-1', toNodeId: 'outfall-1', diameterMm: 450, lengthM: 14, material: 'HDPE' }]);
      expect(result.workspace.artifacts.every(artifact => artifact.state === 'stale' && artifact.revision === 1)).toBe(true);
      expect(result.receipt.afterContentHash).toBe(result.workspace.contentHash);
    }
  });

  it('rejects a drainage edit when its expected revision or content hash is stale', () => {
    const before = drainageWorkspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'pipe-1', diameterMm: 450 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_link', arguments: args })!;
    const challenge = challengeCivilLandscapeTool(plan);
    const committed = executeCivilLandscapeTool({ workspace: before, plan, challenge, approval: approval(challenge) });
    expect(committed.committed).toBe(true);
    if (!committed.committed) return;
    expect(executeCivilLandscapeTool({ workspace: committed.workspace, plan, challenge, approval: approval(challenge) })).toMatchObject({ committed: false, code: 'binding_mismatch' });
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_link', arguments: { ...args, contentHash: 'f'.repeat(64) } })).toBeNull();
  });

  it('rejects forged or malformed drainage approvals without a receipt', () => {
    const before = drainageWorkspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'pipe-1', diameterMm: 450 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_link', arguments: args })!;
    const challenge = challengeCivilLandscapeTool(plan);
    expect(executeCivilLandscapeTool({ workspace: before, plan, challenge, approval: { ...approval(challenge), challengeHash: '0'.repeat(64) } })).toMatchObject({ committed: false, code: 'approval_required' });
    expect(executeCivilLandscapeTool({ workspace: before, plan, challenge, approval: { ...approval(challenge), approvalId: 42 as unknown as string } })).toMatchObject({ committed: false, code: 'approval_required' });
  });

  it('fails closed for invalid drainage geometry, host references, and selected ids', () => {
    const before = drainageWorkspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'pipe-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_link', arguments: { ...base, diameterMm: 0 } })).toBeNull();
    const missingHostPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_link', arguments: { ...base, fromNodeId: 'missing-node', diameterMm: 450 } });
    expect(missingHostPlan).not.toBeNull();
    const missingHostChallenge = challengeCivilLandscapeTool(missingHostPlan!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: missingHostPlan!, challenge: missingHostChallenge, approval: approval(missingHostChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    const unknownSelection = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_link', arguments: { ...base, objectId: 'pipe-missing', diameterMm: 450 } });
    expect(unknownSelection).not.toBeNull();
    const unknownChallenge = challengeCivilLandscapeTool(unknownSelection!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: unknownSelection!, challenge: unknownChallenge, approval: approval(unknownChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
  });

  it('does not create a new revision or receipt for a drainage no-op', () => {
    const before = drainageWorkspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'pipe-1', diameterMm: 300, lengthM: 12, material: 'PVC' };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_link', arguments: args })!;
    const challenge = challengeCivilLandscapeTool(plan);
    const result = executeCivilLandscapeTool({ workspace: before, plan, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: false, code: 'edit_failed', workspace: { revision: 0, contentHash: before.contentHash } });
  });

  it('resizes and reroutes an irrigation pipe by stable object id, staling shared artifacts', () => {
    const before = irrigationWorkspace();
    const args = {
      projectId: 'project-1', documentId: 'land-doc', revision: before.revision,
      contentHash: before.contentHash, objectId: 'irrigation-pipe-1', fromNodeId: 'valve-1',
      toNodeId: 'emitter-1', diameterMm: 32, lengthM: 24,
    };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_pipe', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_irrigation_pipe', affectedObjectIds: ['irrigation-pipe-1'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (result.committed) {
      const document = result.workspace.documents[1]!.document as LandscapeDocument;
      expect(document.irrigationPipes).toEqual([{ id: 'irrigation-pipe-1', fromNodeId: 'valve-1', toNodeId: 'emitter-1', diameterMm: 32, lengthM: 24 }]);
      expect(result.workspace.artifacts.every(artifact => artifact.state === 'stale' && artifact.revision === 1)).toBe(true);
      expect(result.receipt.afterContentHash).toBe(result.workspace.contentHash);
    }
  });

  it('rejects stale irrigation CAS, missing approval, unknown targets, invalid references, and no-ops', () => {
    const before = irrigationWorkspace();
    const base = { projectId: 'project-1', documentId: 'land-doc', revision: before.revision, contentHash: before.contentHash, objectId: 'irrigation-pipe-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_pipe', arguments: { ...base, revision: 4, diameterMm: 32 } })).toBeNull();
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_pipe', arguments: { ...base, contentHash: 'f'.repeat(64), diameterMm: 32 } })).toBeNull();
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_pipe', arguments: { ...base, diameterMm: 25, lengthM: 20 } })!;
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    const missingApprovalPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_pipe', arguments: { ...base, diameterMm: 32 } })!;
    const missingApprovalChallenge = challengeCivilLandscapeTool(missingApprovalPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: missingApprovalPlan, challenge: missingApprovalChallenge })).toMatchObject({ committed: false, code: 'approval_required' });
    const unknownPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_pipe', arguments: { ...base, objectId: 'missing-pipe', diameterMm: 32 } })!;
    const unknownChallenge = challengeCivilLandscapeTool(unknownPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: unknownPlan, challenge: unknownChallenge, approval: approval(unknownChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
    const invalidReferencePlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_pipe', arguments: { ...base, toNodeId: 'missing-node', diameterMm: 32 } })!;
    const invalidReferenceChallenge = challengeCivilLandscapeTool(invalidReferencePlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: invalidReferencePlan, challenge: invalidReferenceChallenge, approval: approval(invalidReferenceChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
  });

  it('edits a profile by stable id, preserves unrelated civil objects, and propagates shared artifact staleness', () => {
    const before = profileCorridorWorkspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'profile-1', points: [{ id: 'pvi-1', stationM: 0, elevationM: 10 }, { id: 'pvi-middle', stationM: 50, elevationM: 11 }, { id: 'pvi-2', stationM: 100, elevationM: 13 }] };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_profile', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_profile', affectedObjectIds: ['profile-1'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (result.committed) {
      const document = result.workspace.documents[0]!.document as CivilDocument;
      expect(document.profiles).toEqual([{ id: 'profile-1', alignmentId: 'alignment-1', kind: 'proposed', points: args.points }]);
      expect(document.alignments).toEqual((before.documents[0]!.document as CivilDocument).alignments);
      expect(document.corridors).toEqual((before.documents[0]!.document as CivilDocument).corridors);
      expect(result.workspace.artifacts.every(artifact => artifact.state === 'stale' && artifact.revision === 1)).toBe(true);
    }
  });

  it('edits one stable profile PVI with approval and preserves profile ownership', () => {
    const before = profileCorridorWorkspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'pvi-middle', profileId: 'profile-1' };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_profile_point', arguments: { ...base, stationM: 60, elevationM: 11.5 } });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_profile_point', affectedObjectIds: ['profile-1', 'pvi-middle'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (result.committed) {
      const profile = (result.workspace.documents[0]!.document as CivilDocument).profiles[0]!;
      expect(profile.points).toEqual([{ id: 'pvi-1', stationM: 0, elevationM: 10 }, { id: 'pvi-middle', stationM: 60, elevationM: 11.5 }, { id: 'pvi-2', stationM: 100, elevationM: 12 }]);
      expect((result.workspace.documents[0]!.document as CivilDocument).corridors).toEqual((before.documents[0]!.document as CivilDocument).corridors);
      expect(result.workspace.revision).toBe(1);
    }
  });

  it('rejects PVI no-op, wrong ownership, missing stable id, invalid station order, stale CAS, and missing approval', () => {
    const before = profileCorridorWorkspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'pvi-middle', profileId: 'profile-1' };
    const run = (arguments_: Record<string, unknown>, approve = true) => {
      const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_profile_point', arguments: arguments_ })!;
      expect(plan).not.toBeNull();
      const challenge = challengeCivilLandscapeTool(plan);
      return executeCivilLandscapeTool({ workspace: before, plan, challenge, ...(approve ? { approval: approval(challenge) } : {}) });
    };
    expect(run(base)).toMatchObject({ committed: false, code: 'edit_failed' });
    expect(run({ ...base, profileId: 'missing-profile', elevationM: 13 })).toMatchObject({ committed: false, code: 'edit_failed' });
    expect(run({ ...base, objectId: 'missing-pvi', elevationM: 13 })).toMatchObject({ committed: false, code: 'edit_failed' });
    expect(run({ ...base, stationM: -1 })).toMatchObject({ committed: false, code: 'validation_failed' });
    expect(run({ ...base, elevationM: 13 }, false)).toMatchObject({ committed: false, code: 'approval_required' });
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_profile_point', arguments: { ...base, revision: 1, elevationM: 13 } })).toBeNull();
    const profileBase = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'profile-1' };
    const identityDropPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_profile', arguments: { ...profileBase, points: [{ stationM: 0, elevationM: 10 }, { stationM: 100, elevationM: 12 }] } })!;
    const identityDropChallenge = challengeCivilLandscapeTool(identityDropPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: identityDropPlan, challenge: identityDropChallenge, approval: approval(identityDropChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
  });

  it('rejects profile no-op, stale CAS, missing alignment, and non-increasing stations', () => {
    const before = profileCorridorWorkspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'profile-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_profile', arguments: { ...base, objectId: undefined, points: [{ stationM: 0, elevationM: 11 }, { stationM: 100, elevationM: 13 }] } })).toBeNull();
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_profile', arguments: base });
    expect(noOpPlan).not.toBeNull();
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan!, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    const invalidStations = planCivilLandscapeTool({ workspace: before, tool: 'edit_profile', arguments: { ...base, points: [{ id: 'pvi-1', stationM: 100, elevationM: 12 }, { id: 'pvi-middle', stationM: 50, elevationM: 11 }, { id: 'pvi-2', stationM: 0, elevationM: 10 }] } });
    expect(invalidStations).not.toBeNull();
    const invalidChallenge = challengeCivilLandscapeTool(invalidStations!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: invalidStations!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    const missingAlignment = planCivilLandscapeTool({ workspace: before, tool: 'edit_profile', arguments: { ...base, alignmentId: 'missing-alignment' } });
    expect(missingAlignment).not.toBeNull();
    const missingChallenge = challengeCivilLandscapeTool(missingAlignment!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: missingAlignment!, challenge: missingChallenge, approval: approval(missingChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    const commitPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_profile', arguments: { ...base, points: [{ id: 'pvi-1', stationM: 0, elevationM: 11 }, { id: 'pvi-middle', stationM: 50, elevationM: 12 }, { id: 'pvi-2', stationM: 100, elevationM: 13 }] } })!;
    const commitChallenge = challengeCivilLandscapeTool(commitPlan);
    const committed = executeCivilLandscapeTool({ workspace: before, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) });
    expect(committed.committed).toBe(true);
    if (committed.committed) expect(executeCivilLandscapeTool({ workspace: committed.workspace, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) })).toMatchObject({ committed: false, code: 'binding_mismatch' });
  });

  it('edits corridor range and references by stable id, while rejecting no-op and invalid range/reference', () => {
    const before = profileCorridorWorkspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'corridor-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_corridor', arguments: { ...base, objectId: undefined, startStationM: 10, endStationM: 90 } })).toBeNull();
    const args = { ...base, assemblyCode: 'ROAD-4L', startStationM: 10, endStationM: 90 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_corridor', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_corridor', affectedObjectIds: ['corridor-1'] } });
    if (result.committed) expect((result.workspace.documents[0]!.document as CivilDocument).corridors).toEqual([{ id: 'corridor-1', alignmentId: 'alignment-1', profileId: 'profile-1', assemblyCode: 'ROAD-4L', targetSurfaceIds: ['eg'], startStationM: 10, endStationM: 90 }]);
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_corridor', arguments: base })!;
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
    const invalidRange = planCivilLandscapeTool({ workspace: before, tool: 'edit_corridor', arguments: { ...base, startStationM: 90, endStationM: 10 } })!;
    const invalidRangeChallenge = challengeCivilLandscapeTool(invalidRange);
    expect(executeCivilLandscapeTool({ workspace: before, plan: invalidRange, challenge: invalidRangeChallenge, approval: approval(invalidRangeChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    const invalidReference = planCivilLandscapeTool({ workspace: before, tool: 'edit_corridor', arguments: { ...base, profileId: 'missing-profile', startStationM: 10, endStationM: 90 } })!;
    const invalidReferenceChallenge = challengeCivilLandscapeTool(invalidReference);
    expect(executeCivilLandscapeTool({ workspace: before, plan: invalidReference, challenge: invalidReferenceChallenge, approval: approval(invalidReferenceChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    const outsideProfile = planCivilLandscapeTool({ workspace: before, tool: 'edit_corridor', arguments: { ...base, startStationM: -1, endStationM: 101 } })!;
    const outsideProfileChallenge = challengeCivilLandscapeTool(outsideProfile);
    expect(executeCivilLandscapeTool({ workspace: before, plan: outsideProfile, challenge: outsideProfileChallenge, approval: approval(outsideProfileChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    const mismatched = profileCorridorWorkspace();
    const mismatchedDocument = mismatched.documents[0]!.document as CivilDocument;
    mismatchedDocument.alignments.push({ id: 'alignment-2', name: 'Branch', segments: [{ id: 'alignment-2-segment-1', kind: 'line', startM: [0, 10], endM: [100, 10], startStationM: 0 }] });
    mismatchedDocument.profiles.push({ id: 'profile-2', alignmentId: 'alignment-2', kind: 'proposed', points: [{ stationM: 0, elevationM: 9 }, { stationM: 100, elevationM: 10 }] });
    mismatched.contentHash = hashCivilLandscapeWorkspace(mismatched);
    const mismatchBase = { ...base, contentHash: mismatched.contentHash };
    const mismatchedProfile = planCivilLandscapeTool({ workspace: mismatched, tool: 'edit_corridor', arguments: { ...mismatchBase, profileId: 'profile-2' } })!;
    const mismatchedProfileChallenge = challengeCivilLandscapeTool(mismatchedProfile);
    expect(executeCivilLandscapeTool({ workspace: mismatched, plan: mismatchedProfile, challenge: mismatchedProfileChallenge, approval: approval(mismatchedProfileChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
  });

  it('edits planting-zone boundary, coverage, and members by stable id while preserving unrelated irrigation data', () => {
    const before = plantingIrrigationZoneWorkspace();
    const args = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'planting-zone-1', boundaryM: [[5, 5], [35, 5], [5, 35]], plantIds: ['plant-1', 'plant-2'], targetCoveragePercent: 65 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_planting_zone', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_planting_zone', affectedObjectIds: ['planting-zone-1'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (result.committed) {
      const document = result.workspace.documents[1]!.document as LandscapeDocument;
      expect(document.plantingZones).toEqual([{ id: 'planting-zone-1', boundaryM: args.boundaryM, plantIds: args.plantIds, soilVolumeId: 'soil-1', targetCoveragePercent: 65 }]);
      expect(document.irrigationZones).toEqual((before.documents[1]!.document as LandscapeDocument).irrigationZones);
      expect(result.workspace.artifacts.every(artifact => artifact.state === 'stale' && artifact.revision === 1)).toBe(true);
    }
  });

  it('edits maintenance-zone optional fields by stable id, with approval, CAS, and atomic validation', () => {
    const before = maintenanceWorkspace();
    const base = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'maintenance-zone-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_maintenance_zone', arguments: { ...base, objectId: undefined, accessWidthM: 3 } })).toBeNull();
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_maintenance_zone', arguments: base })!;
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
    const args = { ...base, accessWidthM: 3, taskCodes: ['PRUNE', 'INSPECT', 'CLEAR'] };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_maintenance_zone', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge })).toMatchObject({ committed: false, code: 'approval_required' });
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_maintenance_zone', affectedObjectIds: ['maintenance-zone-1'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (result.committed) {
      const document = result.workspace.documents[1]!.document as LandscapeDocument;
      expect(document.maintenanceZones).toEqual([{ id: 'maintenance-zone-1', boundaryM: [[10, 10], [30, 10], [10, 30]], accessWidthM: 3, taskCodes: ['PRUNE', 'INSPECT', 'CLEAR'] }]);
      expect(result.workspace.documents[0]!.document).toEqual({ ...before.documents[0]!.document, revision: 1 });
      expect(result.workspace.artifacts.every(artifact => artifact.state === 'stale' && artifact.revision === 1)).toBe(true);
      expect(executeCivilLandscapeTool({ workspace: result.workspace, plan: plan!, challenge, approval: approval(challenge) })).toMatchObject({ committed: false, code: 'binding_mismatch' });
    }
    for (const fields of [
      { boundaryM: [[90, 90], [100, 90], [90, 100]] },
      { boundaryM: [[10, 10], [20, 10], [30, 10]] },
      { taskCodes: [] },
      { taskCodes: ['PRUNE', 'PRUNE'] },
      { taskCodes: [' '] },
    ]) {
      const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_maintenance_zone', arguments: { ...base, ...fields } });
      expect(invalidPlan).not.toBeNull();
      const invalidChallenge = challengeCivilLandscapeTool(invalidPlan!);
      expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    }
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_maintenance_zone', arguments: { ...base, accessWidthM: 0 } })).toBeNull();
  });

  it('rejects planting-zone no-op, missing object id, outside boundary, invalid coverage, duplicate members, and stale CAS', () => {
    const before = plantingIrrigationZoneWorkspace();
    const base = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'planting-zone-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_planting_zone', arguments: { ...base, objectId: undefined, targetCoveragePercent: 60 } })).toBeNull();
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_planting_zone', arguments: base })!;
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
    for (const fields of [
      { boundaryM: [[90, 90], [101, 90], [90, 101]] },
      { targetCoveragePercent: 101 },
      { plantIds: ['plant-1', 'plant-1'] },
      { plantIds: ['missing-plant'] },
      { soilVolumeId: 'missing-soil' },
    ]) {
      const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_planting_zone', arguments: { ...base, ...fields } });
      expect(invalidPlan).not.toBeNull();
      const invalidChallenge = challengeCivilLandscapeTool(invalidPlan!);
      expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    }
    const commitPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_planting_zone', arguments: { ...base, targetCoveragePercent: 55 } })!;
    const commitChallenge = challengeCivilLandscapeTool(commitPlan);
    const committed = executeCivilLandscapeTool({ workspace: before, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) });
    expect(committed.committed).toBe(true);
    if (committed.committed) expect(executeCivilLandscapeTool({ workspace: committed.workspace, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) })).toMatchObject({ committed: false, code: 'binding_mismatch' });
  });

  it('edits irrigation-zone membership and design flow by stable id with atomic rollback on invalid members', () => {
    const before = plantingIrrigationZoneWorkspace();
    const args = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'irrigation-zone-1', emitterNodeIds: ['emitter-1'], plantingZoneIds: ['planting-zone-1'], designFlowLpm: 20 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_zone', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_irrigation_zone', affectedObjectIds: ['irrigation-zone-1'] } });
    if (result.committed) expect((result.workspace.documents[1]!.document as LandscapeDocument).irrigationZones).toEqual([{ id: 'irrigation-zone-1', valveNodeId: 'valve-1', emitterNodeIds: ['emitter-1'], plantingZoneIds: ['planting-zone-1'], designFlowLpm: 20 }]);
    const invalid = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_zone', arguments: { ...args, emitterNodeIds: ['missing-emitter'] } })!;
    const invalidChallenge = challengeCivilLandscapeTool(invalid);
    const rejected = executeCivilLandscapeTool({ workspace: before, plan: invalid, challenge: invalidChallenge, approval: approval(invalidChallenge) });
    expect(rejected).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    const duplicate = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_zone', arguments: { ...args, emitterNodeIds: ['emitter-1', 'emitter-1'] } })!;
    const duplicateChallenge = challengeCivilLandscapeTool(duplicate);
    expect(executeCivilLandscapeTool({ workspace: before, plan: duplicate, challenge: duplicateChallenge, approval: approval(duplicateChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    for (const fields of [
      { valveNodeId: 'source-1' },
      { plantingZoneIds: ['planting-zone-1', 'planting-zone-1'] },
      { plantingZoneIds: ['missing-planting-zone'] },
    ]) {
      const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_zone', arguments: { ...args, ...fields } })!;
      const challenge = challengeCivilLandscapeTool(invalidPlan);
      expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan, challenge, approval: approval(challenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    }
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_zone', arguments: { ...args, designFlowLpm: 0 } })).toBeNull();
  });

  it('edits hardscape geometry/material/slope by stable id and preserves unrelated soil data', () => {
    const before = hardscapeSoilWorkspace();
    const args = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'path-1', boundaryM: [[12, 12], [32, 12], [32, 15], [12, 15]], material: 'concrete', slopePercent: 4, accessible: false };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_hardscape', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_hardscape', affectedObjectIds: ['path-1'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (result.committed) {
      const document = result.workspace.documents[1]!.document as LandscapeDocument;
      expect(document.hardscapes).toEqual([{ id: 'path-1', kind: 'path', boundaryM: args.boundaryM, material: 'concrete', slopePercent: 4, accessible: false }]);
      expect(document.soilVolumes).toEqual((before.documents[1]!.document as LandscapeDocument).soilVolumes);
      expect(result.workspace.artifacts.every(artifact => artifact.state === 'stale' && artifact.revision === 1)).toBe(true);
    }
  });

  it('rejects hardscape no-op, missing object id, outside/degenerate boundary, excessive slope, and stale CAS', () => {
    const before = hardscapeSoilWorkspace();
    const base = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'path-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_hardscape', arguments: { ...base, objectId: undefined, slopePercent: 2 } })).toBeNull();
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_hardscape', arguments: base })!;
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
    for (const fields of [
      { boundaryM: [[90, 90], [101, 90], [90, 101]] },
      { boundaryM: [[10, 10], [20, 10], [30, 10]] },
      { slopePercent: 50.1 },
    ]) {
      const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_hardscape', arguments: { ...base, ...fields } });
      expect(invalidPlan).not.toBeNull();
      const invalidChallenge = challengeCivilLandscapeTool(invalidPlan!);
      expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    }
    const commitPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_hardscape', arguments: { ...base, material: 'stone' } })!;
    const commitChallenge = challengeCivilLandscapeTool(commitPlan);
    const committed = executeCivilLandscapeTool({ workspace: before, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) });
    expect(committed.committed).toBe(true);
    if (committed.committed) expect(executeCivilLandscapeTool({ workspace: committed.workspace, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) })).toMatchObject({ committed: false, code: 'binding_mismatch' });
  });

  it('edits soil-volume boundary/depth/material by stable id and rolls back invalid edits atomically', () => {
    const before = hardscapeSoilWorkspace();
    const args = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'soil-1', boundaryM: [[6, 6], [32, 6], [6, 32]], depthM: 1.5, soilType: 'sandy-loam', drainageClass: 'moderate' };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_soil_volume', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_soil_volume', affectedObjectIds: ['soil-1'] } });
    if (result.committed) {
      const document = result.workspace.documents[1]!.document as LandscapeDocument;
      expect(document.soilVolumes).toEqual([{ id: 'soil-1', boundaryM: args.boundaryM, depthM: 1.5, soilType: 'sandy-loam', drainageClass: 'moderate' }]);
      expect(document.hardscapes).toEqual((before.documents[1]!.document as LandscapeDocument).hardscapes);
    }
    const invalid = planCivilLandscapeTool({ workspace: before, tool: 'edit_soil_volume', arguments: { ...args, boundaryM: [[90, 90], [101, 90], [90, 101]] } })!;
    const invalidChallenge = challengeCivilLandscapeTool(invalid);
    const rejected = executeCivilLandscapeTool({ workspace: before, plan: invalid, challenge: invalidChallenge, approval: approval(invalidChallenge) });
    expect(rejected).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    const degenerate = planCivilLandscapeTool({ workspace: before, tool: 'edit_soil_volume', arguments: { ...args, boundaryM: [[10, 10], [20, 10], [30, 10]] } })!;
    const degenerateChallenge = challengeCivilLandscapeTool(degenerate);
    expect(executeCivilLandscapeTool({ workspace: before, plan: degenerate, challenge: degenerateChallenge, approval: approval(degenerateChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_soil_volume', arguments: { ...args, objectId: undefined } })).toBeNull();
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_soil_volume', arguments: { ...args, depthM: 0 } })).toBeNull();
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_soil_volume', arguments: { ...args, soilType: '' } })).toBeNull();
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_soil_volume', arguments: { ...args, drainageClass: '' } })).toBeNull();
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_soil_volume', arguments: { projectId: args.projectId, documentId: args.documentId, revision: args.revision, contentHash: args.contentHash, objectId: args.objectId } });
    expect(noOpPlan).not.toBeNull();
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan!, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
  });

  it('edits a semantic surface by stable id, preserves unrelated documents, and stales shared artifacts', () => {
    const before = workspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'eg', kind: 'proposed', pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], breaklines: [['p1', 'p2']], sourceEvidenceIds: ['survey'] };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_surface', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_surface', affectedObjectIds: ['eg'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (result.committed) {
      const document = result.workspace.documents[0]!.document as CivilDocument;
      expect(document.surfaces).toEqual([{ id: 'eg', kind: 'proposed', pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], breaklines: [['p1', 'p2']], sourceEvidenceIds: ['survey'] }]);
      const expectedLandscape = structuredClone(before.documents[1]!.document) as LandscapeDocument;
      expectedLandscape.revision = 1;
      expectedLandscape.terrain.civilRevision = 1;
      expect(result.workspace.documents[1]!.document).toEqual(expectedLandscape);
      expect(result.workspace.artifacts.every(artifact => artifact.state === 'stale' && artifact.revision === 1)).toBe(true);
    }
  });

  it('fails closed for surface no-op, missing object id, duplicate/missing members, degenerate triangles, malformed breaklines, evidence refs, and stale CAS', () => {
    const before = workspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'eg' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_surface', arguments: { ...base, objectId: undefined, kind: 'proposed' } })).toBeNull();
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_surface', arguments: base })!;
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    const invalidFields = [
      { pointIds: ['p1', 'p1', 'p3'], triangles: [['p1', 'p1', 'p3']] },
      { pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'missing']] },
      { pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3'], ['p3', 'p1', 'p2']] },
      { pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], breaklines: [['p1']] },
      { pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], breaklines: [['p1', 'missing']] },
      { pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], breaklines: [['p1', 'p1']] },
      { pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], breaklines: [['p1', 'p2'], ['p2', 'p1']] },
      { pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], sourceEvidenceIds: ['missing-evidence'] },
      { pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], sourceEvidenceIds: ['survey', 'survey'] },
    ];
    for (const fields of invalidFields) {
      const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_surface', arguments: { ...base, ...fields } });
      expect(invalidPlan).not.toBeNull();
      const invalidChallenge = challengeCivilLandscapeTool(invalidPlan!);
      expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    }
    const degenerate = workspace();
    const degenerateDocument = degenerate.documents[0]!.document as CivilDocument;
    degenerateDocument.points.push({ id: 'p4', positionM: [20, 0, 0], evidenceId: 'survey' });
    degenerate.contentHash = hashCivilLandscapeWorkspace(degenerate);
    const degenerateArgs = { ...base, contentHash: degenerate.contentHash, pointIds: ['p1', 'p2', 'p4'], triangles: [['p1', 'p2', 'p4']] };
    const degeneratePlan = planCivilLandscapeTool({ workspace: degenerate, tool: 'edit_surface', arguments: degenerateArgs })!;
    const degenerateChallenge = challengeCivilLandscapeTool(degeneratePlan);
    expect(executeCivilLandscapeTool({ workspace: degenerate, plan: degeneratePlan, challenge: degenerateChallenge, approval: approval(degenerateChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    const commitPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_surface', arguments: { ...base, kind: 'proposed' } })!;
    const commitChallenge = challengeCivilLandscapeTool(commitPlan);
    const committed = executeCivilLandscapeTool({ workspace: before, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) });
    expect(committed.committed).toBe(true);
    if (committed.committed) expect(executeCivilLandscapeTool({ workspace: committed.workspace, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) })).toMatchObject({ committed: false, code: 'binding_mismatch' });
  });

  it('edits survey control and drainage node by stable id while preserving unrelated objects and staling artifacts', () => {
    const before = surveyDrainageWorkspace();
    const controlArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'control-1', name: 'CP-1A', positionM: [3, 3, 1], order: 'horizontal', evidenceId: 'survey' };
    const controlPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_survey_control', arguments: controlArgs });
    expect(controlPlan).not.toBeNull();
    const controlChallenge = challengeCivilLandscapeTool(controlPlan!);
    const controlResult = executeCivilLandscapeTool({ workspace: before, plan: controlPlan!, challenge: controlChallenge, approval: approval(controlChallenge) });
    expect(controlResult).toMatchObject({ committed: true, receipt: { tool: 'edit_survey_control', affectedObjectIds: ['control-1'] } });
    if (!controlResult.committed) return;
    const nodeArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 1, contentHash: controlResult.workspace.contentHash, objectId: 'node-1', kind: 'manhole', positionM: [12, 12, 0], invertElevationM: -2, rimElevationM: 1 };
    const nodePlan = planCivilLandscapeTool({ workspace: controlResult.workspace, tool: 'edit_drainage_node', arguments: nodeArgs });
    expect(nodePlan).not.toBeNull();
    const nodeChallenge = challengeCivilLandscapeTool(nodePlan!);
    const nodeResult = executeCivilLandscapeTool({ workspace: controlResult.workspace, plan: nodePlan!, challenge: nodeChallenge, approval: approval(nodeChallenge) });
    expect(nodeResult).toMatchObject({ committed: true, receipt: { tool: 'edit_drainage_node', affectedObjectIds: ['node-1'] } });
    if (nodeResult.committed) {
      const document = nodeResult.workspace.documents[0]!.document as CivilDocument;
      expect(document.surveyControls[0]).toEqual({ id: 'control-1', name: 'CP-1A', positionM: [3, 3, 1], order: 'horizontal', evidenceId: 'survey' });
      expect(document.drainageNodes[0]).toEqual({ id: 'node-1', kind: 'manhole', positionM: [12, 12, 0], invertElevationM: -2, rimElevationM: 1 });
      expect(document.drainageNodes[1]).toEqual((before.documents[0]!.document as CivilDocument).drainageNodes[1]);
      expect(nodeResult.workspace.documents[1]!.document.revision).toBe(2);
      expect(nodeResult.workspace.artifacts.every(artifact => artifact.state === 'stale')).toBe(true);
    }
  });

  it('rejects survey/drainage no-op, missing object id, invalid evidence/elevations, approval, and stale CAS atomically', () => {
    const before = surveyDrainageWorkspace();
    const controlBase = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'control-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_survey_control', arguments: { ...controlBase, objectId: undefined, name: 'CP-new' } })).toBeNull();
    const controlNoOp = planCivilLandscapeTool({ workspace: before, tool: 'edit_survey_control', arguments: controlBase })!;
    const controlNoOpChallenge = challengeCivilLandscapeTool(controlNoOp);
    expect(executeCivilLandscapeTool({ workspace: before, plan: controlNoOp, challenge: controlNoOpChallenge, approval: approval(controlNoOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
    const missingEvidence = planCivilLandscapeTool({ workspace: before, tool: 'edit_survey_control', arguments: { ...controlBase, evidenceId: 'missing-evidence' } })!;
    const missingEvidenceChallenge = challengeCivilLandscapeTool(missingEvidence);
    expect(executeCivilLandscapeTool({ workspace: before, plan: missingEvidence, challenge: missingEvidenceChallenge, approval: approval(missingEvidenceChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    const nodeBase = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'node-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_node', arguments: { ...nodeBase, objectId: undefined, rimElevationM: 2 } })).toBeNull();
    const invalidElevation = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_node', arguments: { ...nodeBase, invertElevationM: 2, rimElevationM: 1 } })!;
    const invalidElevationChallenge = challengeCivilLandscapeTool(invalidElevation);
    expect(executeCivilLandscapeTool({ workspace: before, plan: invalidElevation, challenge: invalidElevationChallenge, approval: approval(invalidElevationChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    const missingApproval = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_node', arguments: { ...nodeBase, rimElevationM: 1 } })!;
    const missingApprovalChallenge = challengeCivilLandscapeTool(missingApproval);
    expect(executeCivilLandscapeTool({ workspace: before, plan: missingApproval, challenge: missingApprovalChallenge })).toMatchObject({ committed: false, code: 'approval_required' });
    const commitPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_node', arguments: { ...nodeBase, rimElevationM: 1 } })!;
    const commitChallenge = challengeCivilLandscapeTool(commitPlan);
    const committed = executeCivilLandscapeTool({ workspace: before, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) });
    expect(committed.committed).toBe(true);
    if (committed.committed) expect(executeCivilLandscapeTool({ workspace: committed.workspace, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) })).toMatchObject({ committed: false, code: 'binding_mismatch' });
  });

  it('edits irrigation node by stable id with optional capacity merge and preserves unrelated pipe data', () => {
    const before = irrigationWorkspace();
    const args = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'valve-1', positionM: [22, 22, 0], pressureKpa: 240, flowLpm: 18 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_node', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_irrigation_node', affectedObjectIds: ['valve-1'] } });
    if (result.committed) {
      const document = result.workspace.documents[1]!.document as LandscapeDocument;
      expect(document.irrigationNodes.find(node => node.id === 'valve-1')).toEqual({ id: 'valve-1', kind: 'valve', positionM: [22, 22, 0], pressureKpa: 240, flowLpm: 18 });
      expect(document.irrigationPipes).toEqual((before.documents[1]!.document as LandscapeDocument).irrigationPipes);
      expect(result.workspace.artifacts.every(artifact => artifact.state === 'stale')).toBe(true);
    }
  });

  it('rejects irrigation-node no-op, missing object id, outside position, invalid capacity/source capacity, and stale CAS', () => {
    const before = irrigationWorkspace();
    const base = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'valve-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_node', arguments: { ...base, objectId: undefined, positionM: [21, 21, 0] } })).toBeNull();
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_node', arguments: base })!;
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
    const outside = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_node', arguments: { ...base, positionM: [101, 101, 0] } })!;
    const outsideChallenge = challengeCivilLandscapeTool(outside);
    expect(executeCivilLandscapeTool({ workspace: before, plan: outside, challenge: outsideChallenge, approval: approval(outsideChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_node', arguments: { ...base, pressureKpa: 0 } })).toBeNull();
    const sourceCapacity = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_node', arguments: { ...base, kind: 'source' } })!;
    const sourceCapacityChallenge = challengeCivilLandscapeTool(sourceCapacity);
    expect(executeCivilLandscapeTool({ workspace: before, plan: sourceCapacity, challenge: sourceCapacityChallenge, approval: approval(sourceCapacityChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    const commitPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_irrigation_node', arguments: { ...base, positionM: [21, 21, 0] } })!;
    const commitChallenge = challengeCivilLandscapeTool(commitPlan);
    const committed = executeCivilLandscapeTool({ workspace: before, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) });
    expect(committed.committed).toBe(true);
    if (committed.committed) expect(executeCivilLandscapeTool({ workspace: committed.workspace, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) })).toMatchObject({ committed: false, code: 'binding_mismatch' });
  });

  it('edits drainage path points/outlet/slope by stable id and rejects invalid geometry atomically', () => {
    const before = drainagePathWorkspace();
    const args = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'swale-1', pointsM: [[10, 10, 0], [20, 10, -2], [30, 10, -3]], outletObjectId: 'civil:outfall-2', minimumSlopePercent: 4 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_path', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    const result = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(result).toMatchObject({ committed: true, receipt: { tool: 'edit_drainage_path', affectedObjectIds: ['swale-1'] } });
    if (result.committed) {
      const document = result.workspace.documents[1]!.document as LandscapeDocument;
      expect(document.drainagePaths).toEqual([{ id: 'swale-1', pointsM: args.pointsM, outletObjectId: 'civil:outfall-2', minimumSlopePercent: 4 }]);
      expect(document.irrigationNodes).toEqual((before.documents[1]!.document as LandscapeDocument).irrigationNodes);
      expect(result.workspace.artifacts.every(artifact => artifact.state === 'stale' && artifact.revision === 1)).toBe(true);
    }
    const base = { projectId: 'project-1', documentId: 'land-doc', revision: 0, contentHash: before.contentHash, objectId: 'swale-1' };
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_path', arguments: { ...base, objectId: undefined, minimumSlopePercent: 4 } })).toBeNull();
    const noOpPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_path', arguments: base })!;
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: noOpPlan, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
    const invalidFields = [
      { pointsM: [[10, 10, 0]] },
      { pointsM: [[10, 10, 0], [10, 10, -1]] },
      { pointsM: [[10, 10, 0], [20, 10, 1]] },
      { pointsM: [[90, 90, 0], [101, 90, -1]] },
    ];
    for (const fields of invalidFields) {
      const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_path', arguments: { ...base, ...fields, minimumSlopePercent: 5 } });
      expect(invalidPlan).not.toBeNull();
      const invalidChallenge = challengeCivilLandscapeTool(invalidPlan!);
      expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    }
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_drainage_path', arguments: { ...base, minimumSlopePercent: 0 } })).toBeNull();
  });

  it('edits cross-section, catchment, and structure by stable id while preserving unrelated civil objects', () => {
    const before = civilResidualWorkspace();
    const crossArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'xs-1', stationM: 15, points: [{ offsetM: -6, elevationM: 10, code: 'ETW' }, { offsetM: 0, elevationM: 10.3, code: 'CL' }, { offsetM: 6, elevationM: 10, code: 'ETW' }] };
    const crossPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_cross_section', arguments: crossArgs });
    expect(crossPlan).not.toBeNull();
    const crossChallenge = challengeCivilLandscapeTool(crossPlan!);
    const crossResult = executeCivilLandscapeTool({ workspace: before, plan: crossPlan!, challenge: crossChallenge, approval: approval(crossChallenge) });
    expect(crossResult).toMatchObject({ committed: true, receipt: { tool: 'edit_cross_section', affectedObjectIds: ['xs-1'] } });
    if (!crossResult.committed) return;
    const catchArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 1, contentHash: crossResult.workspace.contentHash, objectId: 'catchment-1', boundaryM: [[6, 6], [28, 6], [6, 28]], runoffCoefficient: 0.65 };
    const catchPlan = planCivilLandscapeTool({ workspace: crossResult.workspace, tool: 'edit_catchment', arguments: catchArgs });
    expect(catchPlan).not.toBeNull();
    const catchChallenge = challengeCivilLandscapeTool(catchPlan!);
    const catchResult = executeCivilLandscapeTool({ workspace: crossResult.workspace, plan: catchPlan!, challenge: catchChallenge, approval: approval(catchChallenge) });
    expect(catchResult).toMatchObject({ committed: true, receipt: { tool: 'edit_catchment', affectedObjectIds: ['catchment-1'] } });
    if (!catchResult.committed) return;
    const structureArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 2, contentHash: catchResult.workspace.contentHash, objectId: 'structure-1', kind: 'bridge', stationM: 30 };
    const structurePlan = planCivilLandscapeTool({ workspace: catchResult.workspace, tool: 'edit_structure', arguments: structureArgs });
    expect(structurePlan).not.toBeNull();
    const structureChallenge = challengeCivilLandscapeTool(structurePlan!);
    const structureResult = executeCivilLandscapeTool({ workspace: catchResult.workspace, plan: structurePlan!, challenge: structureChallenge, approval: approval(structureChallenge) });
    expect(structureResult).toMatchObject({ committed: true, receipt: { tool: 'edit_structure', affectedObjectIds: ['structure-1'] } });
    if (structureResult.committed) {
      const document = structureResult.workspace.documents[0]!.document as CivilDocument;
      expect(document.crossSections[0]).toEqual({ id: 'xs-1', alignmentId: 'road-a', stationM: 15, points: crossArgs.points });
      expect(document.catchments[0]).toEqual({ id: 'catchment-1', boundaryM: catchArgs.boundaryM, outletNodeId: 'outfall-1', runoffCoefficient: 0.65 });
      expect(document.structures[0]).toEqual({ id: 'structure-1', kind: 'bridge', alignmentId: 'road-a', stationM: 30, sourceEvidenceIds: ['survey'] });
      expect(structureResult.workspace.artifacts.every(artifact => artifact.state === 'stale')).toBe(true);
    }
  });

  it('rejects cross-section/catchment/structure no-ops, invalid refs/geometry, approval, and stale CAS', () => {
    const before = civilResidualWorkspace();
    expect(planCivilLandscapeTool({ workspace: before, tool: 'edit_cross_section', arguments: { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, stationM: 15 } })).toBeNull();
    const crossBase = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'xs-1' };
    const crossNoOp = planCivilLandscapeTool({ workspace: before, tool: 'edit_cross_section', arguments: crossBase })!;
    const crossNoOpChallenge = challengeCivilLandscapeTool(crossNoOp);
    expect(executeCivilLandscapeTool({ workspace: before, plan: crossNoOp, challenge: crossNoOpChallenge, approval: approval(crossNoOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
    const crossInvalids = [
      { points: [{ offsetM: 0, elevationM: 10, code: 'CL' }, { offsetM: 0, elevationM: 10, code: 'CL' }] },
      { points: [{ offsetM: 5, elevationM: 10, code: 'ETW' }, { offsetM: -5, elevationM: 10, code: 'ETW' }] },
      { alignmentId: 'missing-alignment' },
    ];
    for (const fields of crossInvalids) {
      const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_cross_section', arguments: { ...crossBase, ...fields } });
      expect(invalidPlan).not.toBeNull();
      const invalidChallenge = challengeCivilLandscapeTool(invalidPlan!);
      expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    }
    const catchBase = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'catchment-1' };
    for (const fields of [{ boundaryM: [[5, 5], [15, 5], [25, 5]] }, { outletNodeId: 'missing-node' }, { runoffCoefficient: 1.1 }]) {
      const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_catchment', arguments: { ...catchBase, ...fields } });
      expect(invalidPlan).not.toBeNull();
      const invalidChallenge = challengeCivilLandscapeTool(invalidPlan!);
      expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    }
    const structureBase = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'structure-1' };
    for (const fields of [{ alignmentId: 'missing-alignment' }, { sourceEvidenceIds: ['missing-evidence'] }, { sourceEvidenceIds: ['survey', 'survey'] }]) {
      const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_structure', arguments: { ...structureBase, ...fields } });
      expect(invalidPlan).not.toBeNull();
      const invalidChallenge = challengeCivilLandscapeTool(invalidPlan!);
      expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    }
    const commitPlan = planCivilLandscapeTool({ workspace: before, tool: 'edit_structure', arguments: { ...structureBase, stationM: 25 } })!;
    const commitChallenge = challengeCivilLandscapeTool(commitPlan);
    expect(executeCivilLandscapeTool({ workspace: before, plan: commitPlan, challenge: commitChallenge })).toMatchObject({ committed: false, code: 'approval_required' });
    const committed = executeCivilLandscapeTool({ workspace: before, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) });
    expect(committed.committed).toBe(true);
    if (committed.committed) expect(executeCivilLandscapeTool({ workspace: committed.workspace, plan: commitPlan, challenge: commitChallenge, approval: approval(commitChallenge) })).toMatchObject({ committed: false, code: 'binding_mismatch' });
  });

  it('creates and edits a profile-owned vertical curve with stable PVI binding', () => {
    const before = profileCorridorWorkspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'vc-1', profileId: 'profile-1', pviId: 'pvi-middle', startStationM: 25, endStationM: 75, lengthM: 50 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'create_vertical_curve', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    expect(challenge.checks).toContain('vertical_curve_profile_pvi_binding');
    const created = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(created).toMatchObject({ committed: true, receipt: { tool: 'create_vertical_curve', affectedObjectIds: ['vc-1'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (!created.committed) return;
    const document = created.workspace.documents[0]!.document as CivilDocument;
    expect(document.verticalCurves).toEqual([expect.objectContaining({ id: 'vc-1', profileId: 'profile-1', pviId: 'pvi-middle', lengthM: 50 })]);
    expect(document.corridors).toEqual((before.documents[0]!.document as CivilDocument).corridors);
    expect(created.workspace.artifacts.every(artifact => artifact.state === 'stale')).toBe(true);

    const editArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 1, contentHash: created.workspace.contentHash, objectId: 'vc-1', lengthM: 60, startStationM: 20, endStationM: 80 };
    const editPlan = planCivilLandscapeTool({ workspace: created.workspace, tool: 'edit_vertical_curve', arguments: editArgs });
    expect(editPlan).not.toBeNull();
    const editChallenge = challengeCivilLandscapeTool(editPlan!);
    const edited = executeCivilLandscapeTool({ workspace: created.workspace, plan: editPlan!, challenge: editChallenge, approval: approval(editChallenge) });
    expect(edited).toMatchObject({ committed: true, receipt: { tool: 'edit_vertical_curve', affectedObjectIds: ['vc-1'] } });
    if (!edited.committed) return;
    expect((edited.workspace.documents[0]!.document as CivilDocument).verticalCurves?.[0]).toMatchObject({ startStationM: 20, endStationM: 80, lengthM: 60 });

    const noOpPlan = planCivilLandscapeTool({ workspace: created.workspace, tool: 'edit_vertical_curve', arguments: { ...editArgs, lengthM: 50, startStationM: 25, endStationM: 75 } });
    expect(noOpPlan).not.toBeNull();
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan!);
    expect(executeCivilLandscapeTool({ workspace: created.workspace, plan: noOpPlan!, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
  });

  it('rejects vertical curves with invalid ownership, PVI, range, overlap, or length atomically', () => {
    const before = profileCorridorWorkspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'vc-invalid', profileId: 'profile-1', pviId: 'pvi-middle', startStationM: 25, endStationM: 75, lengthM: 49 };
    const invalidPlan = planCivilLandscapeTool({ workspace: before, tool: 'create_vertical_curve', arguments: base });
    expect(invalidPlan).not.toBeNull();
    const invalidChallenge = challengeCivilLandscapeTool(invalidPlan!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: invalidPlan!, challenge: invalidChallenge, approval: approval(invalidChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });
    const missingPvi = planCivilLandscapeTool({ workspace: before, tool: 'create_vertical_curve', arguments: { ...base, objectId: 'vc-missing-pvi', pviId: 'missing-pvi', lengthM: 50 } });
    expect(missingPvi).not.toBeNull();
    const missingChallenge = challengeCivilLandscapeTool(missingPvi!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: missingPvi!, challenge: missingChallenge, approval: approval(missingChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
  });

  it('creates and edits alignment-owned superelevation regions with CAS and stale artifacts', () => {
    const before = profileCorridorWorkspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'se-1', alignmentId: 'alignment-1', startStationM: 10, endStationM: 40, leftCrossSlopePercent: 2.5, rightCrossSlopePercent: -2.5 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'create_superelevation_region', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    expect(challenge.checks).toContain('superelevation_alignment_station_binding');
    const created = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(created).toMatchObject({ committed: true, receipt: { tool: 'create_superelevation_region', affectedObjectIds: ['se-1'] } });
    if (!created.committed) return;
    const document = created.workspace.documents[0]!.document as CivilDocument;
    expect(document.superelevations).toEqual([expect.objectContaining({ id: 'se-1', alignmentId: 'alignment-1', leftCrossSlopePercent: 2.5 })]);
    expect(document.profiles).toEqual((before.documents[0]!.document as CivilDocument).profiles);
    expect(created.workspace.artifacts.every(artifact => artifact.state === 'stale')).toBe(true);

    const editArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 1, contentHash: created.workspace.contentHash, objectId: 'se-1', startStationM: 15, endStationM: 45, leftCrossSlopePercent: 3, rightCrossSlopePercent: -3 };
    const editPlan = planCivilLandscapeTool({ workspace: created.workspace, tool: 'edit_superelevation_region', arguments: editArgs });
    expect(editPlan).not.toBeNull();
    const editChallenge = challengeCivilLandscapeTool(editPlan!);
    const edited = executeCivilLandscapeTool({ workspace: created.workspace, plan: editPlan!, challenge: editChallenge, approval: approval(editChallenge) });
    expect(edited).toMatchObject({ committed: true, receipt: { tool: 'edit_superelevation_region', affectedObjectIds: ['se-1'] } });
    if (!edited.committed) return;
    expect((edited.workspace.documents[0]!.document as CivilDocument).superelevations?.[0]).toMatchObject({ startStationM: 15, endStationM: 45, leftCrossSlopePercent: 3 });

    const noOpPlan = planCivilLandscapeTool({ workspace: created.workspace, tool: 'edit_superelevation_region', arguments: { ...args, revision: 1, contentHash: created.workspace.contentHash, objectId: 'se-1' } });
    expect(noOpPlan).not.toBeNull();
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan!);
    expect(executeCivilLandscapeTool({ workspace: created.workspace, plan: noOpPlan!, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
  });

  it('rejects superelevation ownership, station, slope, and overlap violations atomically', () => {
    const before = profileCorridorWorkspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'se-invalid', alignmentId: 'alignment-1', startStationM: 10, endStationM: 40, leftCrossSlopePercent: 2, rightCrossSlopePercent: -2 };
    const invalidSlope = planCivilLandscapeTool({ workspace: before, tool: 'create_superelevation_region', arguments: { ...base, leftCrossSlopePercent: 101 } });
    expect(invalidSlope).not.toBeNull();
    const invalidSlopeChallenge = challengeCivilLandscapeTool(invalidSlope!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: invalidSlope!, challenge: invalidSlopeChallenge, approval: approval(invalidSlopeChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
    const missingAlignment = planCivilLandscapeTool({ workspace: before, tool: 'create_superelevation_region', arguments: { ...base, objectId: 'se-missing', alignmentId: 'missing-alignment' } });
    expect(missingAlignment).not.toBeNull();
    const missingChallenge = challengeCivilLandscapeTool(missingAlignment!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: missingAlignment!, challenge: missingChallenge, approval: approval(missingChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });
  });

  it('creates and edits stable corridor targets with approval, CAS, no-op, and stale artifacts', () => {
    const before = profileCorridorWorkspace();
    const args = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'target-1', corridorId: 'corridor-1', kind: 'surface' as const, targetObjectId: 'eg', startStationM: 10, endStationM: 40 };
    const plan = planCivilLandscapeTool({ workspace: before, tool: 'create_corridor_target', arguments: args });
    expect(plan).not.toBeNull();
    const challenge = challengeCivilLandscapeTool(plan!);
    expect(challenge.checks).toContain('corridor_target_ownership_station_binding');
    expect(executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: { ...approval(challenge), commandHash: '0'.repeat(64) } })).toMatchObject({ committed: false, code: 'approval_required' });
    const created = executeCivilLandscapeTool({ workspace: before, plan: plan!, challenge, approval: approval(challenge) });
    expect(created).toMatchObject({ committed: true, receipt: { tool: 'create_corridor_target', affectedObjectIds: ['target-1'], invalidatedArtifactIds: ['tin-preview', 'planting-preview'] } });
    if (!created.committed) return;
    const document = created.workspace.documents[0]!.document as CivilDocument;
    expect(document.corridorTargets).toEqual([expect.objectContaining({ id: 'target-1', corridorId: 'corridor-1', kind: 'surface', targetObjectId: 'eg' })]);
    expect(document.corridors).toEqual((before.documents[0]!.document as CivilDocument).corridors);
    expect(created.workspace.artifacts.every(artifact => artifact.state === 'stale')).toBe(true);

    const editArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 1, contentHash: created.workspace.contentHash, objectId: 'target-1', corridorId: 'corridor-1', kind: 'offset' as const, startStationM: 20, endStationM: 50, offsetM: 4 };
    const editPlan = planCivilLandscapeTool({ workspace: created.workspace, tool: 'edit_corridor_target', arguments: editArgs });
    expect(editPlan).not.toBeNull();
    const editChallenge = challengeCivilLandscapeTool(editPlan!);
    const edited = executeCivilLandscapeTool({ workspace: created.workspace, plan: editPlan!, challenge: editChallenge, approval: approval(editChallenge) });
    expect(edited).toMatchObject({ committed: true, receipt: { tool: 'edit_corridor_target', affectedObjectIds: ['target-1'] } });
    if (!edited.committed) return;
    expect((edited.workspace.documents[0]!.document as CivilDocument).corridorTargets?.[0]).toMatchObject({ kind: 'offset', startStationM: 20, endStationM: 50, offsetM: 4 });

    const reverseArgs = { projectId: 'project-1', documentId: 'civil-doc', revision: 2, contentHash: edited.workspace.contentHash, objectId: 'target-1', corridorId: 'corridor-1', kind: 'surface' as const, targetObjectId: 'eg', startStationM: 25, endStationM: 55 };
    const reversePlan = planCivilLandscapeTool({ workspace: edited.workspace, tool: 'edit_corridor_target', arguments: reverseArgs });
    expect(reversePlan).not.toBeNull();
    const reverseChallenge = challengeCivilLandscapeTool(reversePlan!);
    const reversed = executeCivilLandscapeTool({ workspace: edited.workspace, plan: reversePlan!, challenge: reverseChallenge, approval: approval(reverseChallenge) });
    expect(reversed).toMatchObject({ committed: true, receipt: { tool: 'edit_corridor_target', affectedObjectIds: ['target-1'] } });
    if (reversed.committed) expect((reversed.workspace.documents[0]!.document as CivilDocument).corridorTargets?.[0]).toEqual({ id: 'target-1', corridorId: 'corridor-1', kind: 'surface', targetObjectId: 'eg', startStationM: 25, endStationM: 55 });

    const noOpPlan = planCivilLandscapeTool({ workspace: created.workspace, tool: 'edit_corridor_target', arguments: { ...args, revision: 1, contentHash: created.workspace.contentHash, objectId: 'target-1' } });
    expect(noOpPlan).not.toBeNull();
    const noOpChallenge = challengeCivilLandscapeTool(noOpPlan!);
    expect(executeCivilLandscapeTool({ workspace: created.workspace, plan: noOpPlan!, challenge: noOpChallenge, approval: approval(noOpChallenge) })).toMatchObject({ committed: false, code: 'edit_failed' });
  });

  it('rejects corridor target ownership, kind, range, and overlap violations atomically', () => {
    const before = profileCorridorWorkspace();
    const base = { projectId: 'project-1', documentId: 'civil-doc', revision: 0, contentHash: before.contentHash, objectId: 'target-invalid', corridorId: 'corridor-1', kind: 'surface' as const, targetObjectId: 'missing-surface', startStationM: 10, endStationM: 40 };
    const missingSurface = planCivilLandscapeTool({ workspace: before, tool: 'create_corridor_target', arguments: base });
    expect(missingSurface).not.toBeNull();
    const missingSurfaceChallenge = challengeCivilLandscapeTool(missingSurface!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: missingSurface!, challenge: missingSurfaceChallenge, approval: approval(missingSurfaceChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 0, contentHash: before.contentHash } });

    const wrongKind = planCivilLandscapeTool({ workspace: before, tool: 'create_corridor_target', arguments: { ...base, objectId: 'target-wrong-kind', kind: 'alignment', targetObjectId: 'other-alignment' } });
    expect(wrongKind).not.toBeNull();
    const wrongKindChallenge = challengeCivilLandscapeTool(wrongKind!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: wrongKind!, challenge: wrongKindChallenge, approval: approval(wrongKindChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });

    const outOfRange = planCivilLandscapeTool({ workspace: before, tool: 'create_corridor_target', arguments: { ...base, objectId: 'target-out-of-range', startStationM: 90, endStationM: 101 } });
    expect(outOfRange).not.toBeNull();
    const outOfRangeChallenge = challengeCivilLandscapeTool(outOfRange!);
    expect(executeCivilLandscapeTool({ workspace: before, plan: outOfRange!, challenge: outOfRangeChallenge, approval: approval(outOfRangeChallenge) })).toMatchObject({ committed: false, code: 'validation_failed' });

    const valid = planCivilLandscapeTool({ workspace: before, tool: 'create_corridor_target', arguments: { ...base, objectId: 'target-valid', targetObjectId: 'eg' } });
    expect(valid).not.toBeNull();
    const validChallenge = challengeCivilLandscapeTool(valid!);
    const validResult = executeCivilLandscapeTool({ workspace: before, plan: valid!, challenge: validChallenge, approval: approval(validChallenge) });
    expect(validResult).toMatchObject({ committed: true });
    if (!validResult.committed) return;

    const overlap = planCivilLandscapeTool({ workspace: validResult.workspace, tool: 'create_corridor_target', arguments: { ...base, revision: 1, contentHash: validResult.workspace.contentHash, objectId: 'target-overlap', targetObjectId: 'eg', startStationM: 30, endStationM: 50 } });
    expect(overlap).not.toBeNull();
    const overlapChallenge = challengeCivilLandscapeTool(overlap!);
    expect(executeCivilLandscapeTool({ workspace: validResult.workspace, plan: overlap!, challenge: overlapChallenge, approval: approval(overlapChallenge) })).toMatchObject({ committed: false, code: 'validation_failed', workspace: { revision: 1, contentHash: validResult.workspace.contentHash } });

    const stale = executeCivilLandscapeTool({ workspace: validResult.workspace, plan: valid!, challenge: validChallenge, approval: approval(validChallenge) });
    expect(stale).toMatchObject({ committed: false, code: 'binding_mismatch' });
  });
});
