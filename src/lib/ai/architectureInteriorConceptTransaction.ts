import {
  applyArchitectureInteriorEdit,
  type ArchitectureEdit,
  type ArchitectureDocument,
  type InteriorDocument,
} from './architectureInteriorDocuments';
import {
  hashArchitectureInteriorEvidenceV2,
  hashArchitectureInteriorWorkspaceV2,
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
  type WorkspaceDomainEnvelopeV2,
  type WorkspaceProvenanceV2,
} from './architectureInteriorWorkspace';

export type ConceptTransactionCode =
  | 'invalid_workspace' | 'concept_track_required' | 'unsupported_maturity'
  | 'unsupported_edit' | 'locked_artifact_requires_approval' | 'identity_change_rejected' | 'edit_failed' | 'validation_failed';

export type ConceptTransactionResult =
  | { committed: true; workspace: ArchitectureInteriorWorkspaceV2; commandHash: string; affectedObjectIds: string[]; invalidatedChecks: string[] }
  | { committed: false; workspace: ArchitectureInteriorWorkspaceV2; code: ConceptTransactionCode };

export type ArchitectureInteriorConceptTransactionInput = {
  workspace: ArchitectureInteriorWorkspaceV2;
  edit: ArchitectureEdit;
  actorSource?: 'user' | 'ai' | 'import' | 'catalog' | 'expert';
};

const supportedEditKinds = new Set<ArchitectureEdit['kind']>(['create_storey', 'edit_storey', 'create_wall', 'create_space', 'edit_space', 'create_opening', 'create_stair', 'create_shaft', 'create_elevator', 'create_service_opening', 'create_grid', 'edit_grid', 'create_furniture', 'create_light', 'create_finish', 'create_millwork', 'create_ceiling_system', 'set_space_boundary', 'move_line_wall', 'resize_wall', 'set_arc_wall', 'set_ceiling_elevation', 'edit_slab', 'edit_opening', 'edit_stair', 'edit_shaft', 'edit_elevator', 'edit_service_opening', 'edit_ceiling', 'edit_furniture', 'edit_light', 'edit_finish', 'edit_millwork', 'edit_ceiling_system']);

function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('concept_command_cycle');
    const next = new Set(ancestors).add(value);
    return `[${value.map(item => canonical(item, next)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) throw new Error('concept_command_cycle');
    const next = new Set(ancestors).add(value);
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], next)}`).join(',')}}`;
  }
  return 'null';
}

function objectIdentity(workspace: ArchitectureInteriorWorkspaceV2): string {
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  const ids = [
    ...architecture.storeys, ...architecture.spaces, ...architecture.walls, ...architecture.slabs,
    ...architecture.ceilings, ...architecture.openings, ...(architecture.serviceOpenings ?? []),
    ...(architecture.grids ?? []), ...(architecture.roofs ?? []), ...(architecture.stairs ?? []), ...(architecture.shafts ?? []), ...(architecture.elevators ?? []), ...(architecture.zones ?? []),
    ...interior.lights, ...interior.furniture, ...interior.finishes, ...(interior.millwork ?? []),
    ...(interior.ceilingSystems ?? []), ...(interior.acousticZones ?? []),
  ].map(item => item.id).sort();
  const frames = workspace.coordinates.map(frame => `${frame.id}|${frame.kind}|${frame.parentId ?? ''}|${frame.objectId ?? ''}|${frame.documentId ?? ''}`).sort();
  return canonical({ ids, frames });
}

function objectIds(workspace: ArchitectureInteriorWorkspaceV2): string[] {
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  return [
    ...architecture.storeys, ...architecture.spaces, ...architecture.walls, ...architecture.slabs,
    ...architecture.ceilings, ...architecture.openings, ...(architecture.serviceOpenings ?? []),
    ...(architecture.grids ?? []), ...(architecture.roofs ?? []), ...(architecture.stairs ?? []), ...(architecture.shafts ?? []), ...(architecture.elevators ?? []), ...(architecture.zones ?? []),
    ...interior.lights, ...interior.furniture, ...interior.finishes, ...(interior.millwork ?? []),
    ...(interior.ceilingSystems ?? []), ...(interior.acousticZones ?? []),
  ].map(item => item.id).sort();
}

function addCreateFrame(workspace: ArchitectureInteriorWorkspaceV2, edit: ArchitectureEdit): void {
  if (!edit.kind.startsWith('create_')) return;
  const architecture = workspace.architecture.document;
  const frameId = (kind: 'storey' | 'object', id: string) => `architecture-interior:${kind}:${id}`;
  if (edit.kind === 'create_storey') {
    const building = workspace.coordinates.find(frame => frame.kind === 'building');
    if (!building) throw new Error('building_coordinate_missing');
    const storeyFrameId = frameId('storey', edit.storey.id);
    workspace.coordinates.push({ id: storeyFrameId, kind: 'storey', parentId: building.id, storeyId: edit.storey.id, originMm: [0, 0, edit.storey.elevationMm], rotationDeg: [0, 0, 0] });
    workspace.coordinates.push({ id: frameId('object', edit.storey.id), kind: 'object', parentId: storeyFrameId, objectId: edit.storey.id, documentId: workspace.architecture.documentId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    return;
  }
  if (edit.kind === 'create_space') {
    const parent = workspace.coordinates.find(frame => frame.kind === 'storey' && frame.storeyId === edit.space.storeyId) ?? workspace.coordinates.find(frame => frame.kind === 'building');
    if (!parent) throw new Error('object_coordinate_parent_missing');
    for (const id of [edit.space.id, edit.slab.id, edit.ceiling.id]) workspace.coordinates.push({ id: frameId('object', id), kind: 'object', parentId: parent.id, objectId: id, documentId: workspace.architecture.documentId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    return;
  }
  if (edit.kind === 'create_furniture' || edit.kind === 'create_light' || edit.kind === 'create_finish' || edit.kind === 'create_millwork' || edit.kind === 'create_ceiling_system') {
    const object = edit.kind === 'create_furniture' ? edit.furniture : edit.kind === 'create_light' ? edit.light : edit.kind === 'create_finish' ? edit.finish : edit.kind === 'create_millwork' ? edit.millwork : edit.ceilingSystem;
    const spaceId = object.spaceId;
    const space = architecture.spaces.find(item => item.id === spaceId);
    if (!space) throw new Error('interior_object_space_missing');
    const parent = workspace.coordinates.find(frame => frame.kind === 'storey' && frame.storeyId === space.storeyId) ?? workspace.coordinates.find(frame => frame.kind === 'building');
    if (!parent) throw new Error('object_coordinate_parent_missing');
    workspace.coordinates.push({ id: frameId('object', object.id), kind: 'object', parentId: parent.id, objectId: object.id, documentId: workspace.interior.documentId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    return;
  }
  if (edit.kind === 'create_grid') {
    const building = workspace.coordinates.find(frame => frame.kind === 'building');
    if (!building) throw new Error('building_coordinate_missing');
    const object = edit.grid;
    workspace.coordinates.push({ id: frameId('object', object.id), kind: 'object', parentId: building.id, objectId: object.id, documentId: workspace.architecture.documentId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    return;
  }
  if (edit.kind === 'create_stair') {
    const parent = workspace.coordinates.find(frame => frame.kind === 'storey' && frame.storeyId === edit.stair.fromStoreyId);
    if (!parent || !architecture.storeys.some(storey => storey.id === edit.stair.fromStoreyId) || !architecture.storeys.some(storey => storey.id === edit.stair.toStoreyId)) throw new Error('stair_coordinate_storey_missing');
    workspace.coordinates.push({ id: frameId('object', edit.stair.id), kind: 'object', parentId: parent.id, objectId: edit.stair.id, documentId: workspace.architecture.documentId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    return;
  }
  if (edit.kind === 'create_shaft') {
    const parent = workspace.coordinates.find(frame => frame.kind === 'storey' && frame.storeyId === edit.shaft.fromStoreyId);
    if (!parent || !architecture.storeys.some(storey => storey.id === edit.shaft.fromStoreyId) || !architecture.storeys.some(storey => storey.id === edit.shaft.toStoreyId)) throw new Error('shaft_coordinate_storey_missing');
    if (!edit.shaft.hostSpaceIds.length || edit.shaft.hostSpaceIds.some(spaceId => !architecture.spaces.some(space => space.id === spaceId))) throw new Error('shaft_host_space_missing');
    workspace.coordinates.push({ id: frameId('object', edit.shaft.id), kind: 'object', parentId: parent.id, objectId: edit.shaft.id, documentId: workspace.architecture.documentId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    return;
  }
  if (edit.kind === 'create_elevator') {
    const parent = workspace.coordinates.find(frame => frame.kind === 'storey' && frame.storeyId === edit.elevator.servedStoreyIds[0]);
    if (!parent || !edit.elevator.servedStoreyIds.length || !architecture.storeys.some(storey => storey.id === edit.elevator.servedStoreyIds[0]) || !architecture.shafts?.some(shaft => shaft.id === edit.elevator.shaftId)) throw new Error('elevator_coordinate_host_missing');
    workspace.coordinates.push({ id: frameId('object', edit.elevator.id), kind: 'object', parentId: parent.id, objectId: edit.elevator.id, documentId: workspace.architecture.documentId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    return;
  }
  if (edit.kind === 'create_service_opening') {
    const host = architecture.walls.find(item => item.id === edit.serviceOpening.hostId) ?? architecture.slabs.find(item => item.id === edit.serviceOpening.hostId);
    const storeyId = host?.storeyId;
    const parent = workspace.coordinates.find(frame => frame.kind === 'storey' && frame.storeyId === storeyId) ?? workspace.coordinates.find(frame => frame.kind === 'building');
    if (!parent || !storeyId) throw new Error('service_opening_coordinate_host_missing');
    workspace.coordinates.push({ id: frameId('object', edit.serviceOpening.id), kind: 'object', parentId: parent.id, objectId: edit.serviceOpening.id, documentId: workspace.architecture.documentId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    return;
  }
  if (edit.kind !== 'create_wall' && edit.kind !== 'create_opening') return;
  const object = edit.kind === 'create_wall' ? edit.wall : edit.opening;
  const storeyId = edit.kind === 'create_wall' ? edit.wall.storeyId : architecture.walls.find(wall => wall.id === edit.opening.hostWallId)?.storeyId;
  if (!storeyId || !architecture.storeys.some(storey => storey.id === storeyId)) throw new Error('object_coordinate_storey_missing');
  const parent = workspace.coordinates.find(frame => frame.kind === 'storey' && frame.storeyId === storeyId) ?? workspace.coordinates.find(frame => frame.kind === 'building');
  if (!parent) throw new Error('object_coordinate_parent_missing');
  workspace.coordinates.push({ id: frameId('object', object.id), kind: 'object', parentId: parent.id, objectId: object.id, documentId: workspace.architecture.documentId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
}

function rebindEditedStairFrame(workspace: ArchitectureInteriorWorkspaceV2, edit: ArchitectureEdit): void {
  if (edit.kind !== 'edit_stair') return;
  const objectFrames = workspace.coordinates.filter(frame => frame.kind === 'object' && frame.objectId === edit.stairId && frame.documentId === workspace.architecture.documentId);
  if (objectFrames.length !== 1) throw new Error('stair_coordinate_object_binding_invalid');
  const stair = workspace.architecture.document.stairs?.find(item => item.id === edit.stairId);
  const parentFrames = stair ? workspace.coordinates.filter(frame => frame.kind === 'storey' && frame.storeyId === stair.fromStoreyId) : [];
  if (parentFrames.length !== 1) throw new Error('stair_coordinate_storey_binding_invalid');
  objectFrames[0]!.parentId = parentFrames[0]!.id;
}

function rebindEditedShaftFrame(workspace: ArchitectureInteriorWorkspaceV2, edit: ArchitectureEdit): void {
  if (edit.kind !== 'edit_shaft') return;
  const objectFrames = workspace.coordinates.filter(frame => frame.kind === 'object' && frame.objectId === edit.shaftId && frame.documentId === workspace.architecture.documentId);
  if (objectFrames.length !== 1) throw new Error('shaft_coordinate_object_binding_invalid');
  const shaft = workspace.architecture.document.shafts?.find(item => item.id === edit.shaftId);
  const parentFrames = shaft ? workspace.coordinates.filter(frame => frame.kind === 'storey' && frame.storeyId === shaft.fromStoreyId) : [];
  if (parentFrames.length !== 1) throw new Error('shaft_coordinate_storey_binding_invalid');
  objectFrames[0]!.parentId = parentFrames[0]!.id;
}

function rebindEditedElevatorFrame(workspace: ArchitectureInteriorWorkspaceV2, edit: ArchitectureEdit): void {
  if (edit.kind !== 'edit_elevator') return;
  const objectFrames = workspace.coordinates.filter(frame => frame.kind === 'object' && frame.objectId === edit.elevatorId && frame.documentId === workspace.architecture.documentId);
  if (objectFrames.length !== 1) throw new Error('elevator_coordinate_object_binding_invalid');
  const elevator = workspace.architecture.document.elevators?.find(item => item.id === edit.elevatorId);
  const parentFrames = elevator ? workspace.coordinates.filter(frame => frame.kind === 'storey' && frame.storeyId === elevator.servedStoreyIds[0]) : [];
  if (parentFrames.length !== 1) throw new Error('elevator_coordinate_storey_binding_invalid');
  objectFrames[0]!.parentId = parentFrames[0]!.id;
}

function rebindEditedServiceOpeningFrame(workspace: ArchitectureInteriorWorkspaceV2, edit: ArchitectureEdit): void {
  if (edit.kind !== 'edit_service_opening') return;
  const objectFrames = workspace.coordinates.filter(frame => frame.kind === 'object' && frame.objectId === edit.serviceOpeningId && frame.documentId === workspace.architecture.documentId);
  if (objectFrames.length !== 1) throw new Error('service_opening_coordinate_object_binding_invalid');
  const opening = workspace.architecture.document.serviceOpenings?.find(item => item.id === edit.serviceOpeningId);
  const host = opening ? workspace.architecture.document.walls.find(item => item.id === opening.hostId) ?? workspace.architecture.document.slabs.find(item => item.id === opening.hostId) : undefined;
  const parentFrames = host ? workspace.coordinates.filter(frame => frame.kind === 'storey' && frame.storeyId === host.storeyId) : [];
  if (parentFrames.length !== 1) throw new Error('service_opening_coordinate_storey_binding_invalid');
  objectFrames[0]!.parentId = parentFrames[0]!.id;
}

function rebindEditedStoreyFrame(workspace: ArchitectureInteriorWorkspaceV2, edit: ArchitectureEdit): void {
  if (edit.kind !== 'edit_storey') return;
  const storey = workspace.architecture.document.storeys.find(item => item.id === edit.storeyId);
  const frames = workspace.coordinates.filter(frame => frame.kind === 'storey' && frame.storeyId === edit.storeyId);
  if (!storey || frames.length !== 1) throw new Error('storey_coordinate_binding_invalid');
  const frame = frames[0]!;
  frame.originMm = [frame.originMm[0], frame.originMm[1], storey.elevationMm];
}

function rebindEditedSpaceFrames(workspace: ArchitectureInteriorWorkspaceV2, edit: ArchitectureEdit): void {
  if (edit.kind !== 'edit_space') return;
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  const space = architecture.spaces.find(item => item.id === edit.spaceId);
  if (!space) throw new Error('space_coordinate_object_binding_invalid');
  const storeyFrame = workspace.coordinates.filter(frame => frame.kind === 'storey' && frame.storeyId === space.storeyId);
  if (storeyFrame.length !== 1) throw new Error('space_coordinate_storey_binding_invalid');
  const architectureIds = new Set<string>([space.id, space.slabId, space.ceilingId, ...space.wallIds]);
    for (const opening of architecture.openings) if (space.wallIds.includes(opening.hostWallId)) architectureIds.add(opening.id);
  for (const opening of architecture.serviceOpenings ?? []) if (architectureIds.has(opening.hostId)) architectureIds.add(opening.id);
  const interiorIds = new Set<string>();
  for (const item of interior.lights) if (item.spaceId === space.id) interiorIds.add(item.id);
  for (const item of interior.furniture) if (item.spaceId === space.id) interiorIds.add(item.id);
  for (const item of interior.finishes) if (item.spaceId === space.id) interiorIds.add(item.id);
  for (const item of interior.millwork ?? []) if (item.spaceId === space.id) interiorIds.add(item.id);
  for (const item of interior.ceilingSystems ?? []) if (item.spaceId === space.id) interiorIds.add(item.id);
  for (const item of interior.acousticZones ?? []) if (item.spaceId === space.id) interiorIds.add(item.id);
  const rebind = (objectId: string, documentId: string) => {
    const frames = workspace.coordinates.filter(frame => frame.kind === 'object' && frame.objectId === objectId && frame.documentId === documentId);
    if (frames.length !== 1) throw new Error('space_coordinate_object_binding_invalid');
    frames[0]!.parentId = storeyFrame[0]!.id;
  };
  architectureIds.forEach(id => rebind(id, workspace.architecture.documentId));
  interiorIds.forEach(id => rebind(id, workspace.interior.documentId));
}

function conceptualArchitectureGeometry(document: ArchitectureDocument): unknown {
  return {
    schema: 'nexyfab.conceptual-architecture-geometry.v2', documentSchema: document.schema, revision: document.revision,
    storeys: document.storeys.map(({ id, elevationMm, heightMm }) => ({ id, elevationMm, heightMm })),
    walls: document.walls, spaces: document.spaces.map(({ id, storeyId, boundaryMm, wallIds, slabId, ceilingId }) => ({ id, storeyId, boundaryMm, wallIds, slabId, ceilingId })),
    slabs: document.slabs, ceilings: document.ceilings, openings: document.openings, serviceOpenings: document.serviceOpenings ?? [], grids: document.grids ?? [], stairs: document.stairs ?? [], shafts: document.shafts ?? [], elevators: document.elevators ?? [],
  };
}

function conceptualInteriorGeometry(document: InteriorDocument): unknown {
  return {
    schema: 'nexyfab.conceptual-interior-geometry.v2', documentSchema: document.schema, revision: document.revision,
    lights: document.lights, furniture: document.furniture, finishes: document.finishes,
    millwork: document.millwork ?? [], ceilingSystems: document.ceilingSystems ?? [], acousticZones: document.acousticZones ?? [],
  };
}

function semanticPayload(document: ArchitectureDocument | InteriorDocument): unknown {
  return { schema: `${document.schema}.semantic.v2`, document: structuredClone(document) };
}

function provenance(
  existing: readonly WorkspaceProvenanceV2[],
  commandHash: string,
  actorSource: NonNullable<ArchitectureInteriorConceptTransactionInput['actorSource']>,
): WorkspaceProvenanceV2[] {
  const actorId = `actor:${actorSource}:${commandHash.slice(0, 16)}`;
  return [
    ...structuredClone(existing),
    { sourceId: `command:${commandHash}`, kind: actorSource, contentHash: commandHash },
    { sourceId: actorId, kind: actorSource, contentHash: hashArchitectureInteriorEvidenceV2({ actorSource, commandHash }) },
  ];
}

function conceptGeometry(document: ArchitectureDocument | InteriorDocument, architecture: boolean) {
  const payload = architecture ? conceptualArchitectureGeometry(document as ArchitectureDocument) : conceptualInteriorGeometry(document as InteriorDocument);
  return {
    representation: architecture ? 'bim' as const : 'procedural' as const,
    units: 'mm' as const,
    fidelity: 'conceptual' as const,
    verification: { status: 'not_run' as const, verifierId: 'concept-transaction.v2', issues: ['exact_geometry_verification_not_run'] },
    contentHash: hashArchitectureInteriorEvidenceV2(payload),
    payload,
  };
}

function regenerateDomain<T>(
  domain: WorkspaceDomainEnvelopeV2<T>,
  document: T & (ArchitectureDocument | InteriorDocument),
  architecture: boolean,
  commandHash: string,
  actorSource: NonNullable<ArchitectureInteriorConceptTransactionInput['actorSource']>,
): WorkspaceDomainEnvelopeV2<T> {
  const semantic = semanticPayload(document);
  return {
    ...structuredClone(domain),
    document: structuredClone(document),
    geometry: conceptGeometry(document, architecture),
    semantic: { schema: `${document.schema}.semantic.v2`, contentHash: hashArchitectureInteriorEvidenceV2(semantic), payload: semantic },
    provenance: provenance(domain.provenance, commandHash, actorSource),
  };
}

function invalidateArtifactGraph(workspace: ArchitectureInteriorWorkspaceV2, commandHash: string): ArchitectureInteriorWorkspaceV2['artifactGraph'] {
  return {
    ...structuredClone(workspace.artifactGraph),
    revision: workspace.workspace.revision + 1,
    artifacts: workspace.artifactGraph.artifacts.map(artifact => ({
      ...structuredClone(artifact),
      state: 'stale' as const,
      verification: { ...structuredClone(artifact.verification), status: 'not_run' as const, evidenceHash: undefined, issues: ['concept_geometry_changed'] },
      staleBecause: [...new Set([...artifact.staleBecause, commandHash])],
    })),
  };
}

export function executeArchitectureInteriorConceptTransaction(input: ArchitectureInteriorConceptTransactionInput): ConceptTransactionResult {
  const original = input.workspace;
  if (validateArchitectureInteriorWorkspaceV2(original).length) return { committed: false, workspace: original, code: 'invalid_workspace' };
  if (original.workspace.track !== 'ai_design') return { committed: false, workspace: original, code: 'concept_track_required' };
  if (original.workspace.maturity !== 'concept') return { committed: false, workspace: original, code: 'unsupported_maturity' };
  if (!supportedEditKinds.has(input.edit?.kind)) return { committed: false, workspace: original, code: 'unsupported_edit' };
  if (original.artifactGraph.dependencies.some(dependency => dependency.policy === 'locked')) return { committed: false, workspace: original, code: 'locked_artifact_requires_approval' };
  const beforeIdentity = objectIdentity(original);
  const actorSource = input.actorSource ?? 'user';
  let commandHash: string;
  try { commandHash = hashArchitectureInteriorEvidenceV2({ schema: 'nexyfab.architecture-interior-concept-command.v2', baseContentHash: original.contentHash, baseRevision: original.workspace.revision, edit: input.edit, actorSource }); }
  catch { return { committed: false, workspace: original, code: 'edit_failed' }; }
  try {
    const edited = applyArchitectureInteriorEdit(original.architecture.document, original.interior.document, input.edit);
    const candidate = structuredClone(original);
    addCreateFrame(candidate, input.edit);
    const nextRevision = original.workspace.revision + 1;
    candidate.architecture = regenerateDomain(original.architecture, { ...edited.architecture, revision: nextRevision }, true, commandHash, actorSource);
    candidate.interior = regenerateDomain(original.interior, { ...edited.interior, revision: nextRevision, architectureDocumentId: original.architecture.documentId }, false, commandHash, actorSource);
    candidate.workspace = { ...candidate.workspace, revision: nextRevision };
    candidate.artifactGraph = invalidateArtifactGraph(original, commandHash);
    const beforeIds = new Set(objectIds(original));
    const afterIds = new Set(objectIds(candidate));
    if ([...beforeIds].some(id => !afterIds.has(id))) return { committed: false, workspace: original, code: 'identity_change_rejected' };
    if (!input.edit.kind.startsWith('create_') && objectIdentity(candidate) !== beforeIdentity) return { committed: false, workspace: original, code: 'identity_change_rejected' };
    rebindEditedStairFrame(candidate, input.edit);
    rebindEditedShaftFrame(candidate, input.edit);
    rebindEditedElevatorFrame(candidate, input.edit);
    rebindEditedServiceOpeningFrame(candidate, input.edit);
    rebindEditedStoreyFrame(candidate, input.edit);
    rebindEditedSpaceFrames(candidate, input.edit);
    candidate.contentHash = '';
    candidate.workspace.contentHash = '';
    const contentHash = hashArchitectureInteriorWorkspaceV2(candidate);
    candidate.contentHash = contentHash;
    candidate.workspace.contentHash = contentHash;
    if (validateArchitectureInteriorWorkspaceV2(candidate).length) return { committed: false, workspace: original, code: 'validation_failed' };
    return { committed: true, workspace: candidate, commandHash, affectedObjectIds: edited.affectedObjectIds, invalidatedChecks: edited.invalidatedChecks };
  } catch {
    return { committed: false, workspace: original, code: 'edit_failed' };
  }
}
