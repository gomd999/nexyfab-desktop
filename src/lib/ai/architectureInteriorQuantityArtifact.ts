import type { ArtifactDependencyEdge, ArtifactInputBinding, DesignArtifactNode } from './designArtifactGraph';
import {
  hashArchitectureInteriorEvidenceV2,
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
} from './architectureInteriorWorkspace';

export const ARCHITECTURE_INTERIOR_QUANTITY_SCHEMA = 'nexyfab.architecture-interior-quantity.v1' as const;

type QuantityBinding = {
  projectId: string;
  revision: number;
  workspaceContentHash: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  architectureDocumentHash: string;
  interiorDocumentHash: string;
};

export type ArchitectureInteriorQuantityPayload = {
  schema: typeof ARCHITECTURE_INTERIOR_QUANTITY_SCHEMA;
  binding: QuantityBinding;
  units: { length: 'm'; area: 'm2'; volume: 'm3'; count: 'ea' };
  schedules: {
    spaces: Array<{ id: string; storeyId: string; usageCode: string; areaM2: number }>;
    walls: Array<{ id: string; storeyId: string; lengthM: number; heightM: number; thicknessM: number; grossAreaM2: number; openingAreaM2: number; netAreaM2: number; volumeM3: number }>;
    openings: Array<{ id: string; kindCode: 'door' | 'window'; hostWallId: string; widthM: number; heightM: number; areaM2: number }>;
    slabs: Array<{ id: string; storeyId: string; spaceId: string; areaM2: number; thicknessM: number; volumeM3: number }>;
    ceilings: Array<{ id: string; storeyId: string; spaceId: string; areaM2: number; elevationM: number; thicknessM: number | null }>;
    furniture: Array<{ id: string; spaceId: string; countEa: 1; envelopeVolumeM3: number; clearanceM: number }>;
    finishes: Array<{ id: string; spaceId: string; hostId: string; surfaceCode: 'floor' | 'wall' | 'ceiling'; materialCode: string; areaM2: number }>;
    millwork: Array<{ id: string; spaceId: string; materialCode: string; envelopeVolumeM3: number; clearanceM: number }>;
    lights: Array<{ id: string; spaceId: string; hostCeilingId: string; countEa: 1; lumens: number; cctK: number }>;
  };
  totals: {
    spaceAreaM2: number;
    wallNetAreaM2: number;
    slabVolumeM3: number;
    ceilingAreaM2: number;
    openingCountEa: number;
    furnitureCountEa: number;
    lightCountEa: number;
  };
  reconciliation: {
    status: 'passed';
    checks: readonly ['source_object_coverage', 'host_binding', 'finite_nonnegative_quantities', 'workspace_revision_binding'];
  };
  pricing: { status: 'not_run'; reasonCode: 'authoritative_unit_rates_required' };
};

export type ArchitectureInteriorQuantityArtifact = {
  payload: ArchitectureInteriorQuantityPayload;
  contentHash: string;
  verification: { status: 'passed'; verifierId: 'architecture-interior-quantity.v1'; evidenceHash: string; issues: [] };
  artifact: DesignArtifactNode;
  dependencies: ArtifactDependencyEdge[];
};

export type ArchitectureInteriorQuantityResult =
  | { ok: true; result: ArchitectureInteriorQuantityArtifact }
  | { ok: false; code: 'invalid_workspace' | 'quantity_reconciliation_failed'; issues: string[] };

type V2 = readonly [number, number];
const round = (value: number) => Number(value.toFixed(6));
const sum = (values: readonly number[]) => round(values.reduce((total, value) => total + value, 0));

function polygonAreaMm2(points: readonly V2[]): number {
  return Math.abs(points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return total + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

function wallLengthMm(wall: ArchitectureInteriorWorkspaceV2['architecture']['document']['walls'][number]): number {
  return wall.kind === 'line'
    ? Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1])
    : Math.abs(wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180 * wall.radiusMm;
}

export function buildArchitectureInteriorQuantityArtifact(workspace: ArchitectureInteriorWorkspaceV2, modelInputs?: readonly ArtifactInputBinding[]): ArchitectureInteriorQuantityResult {
  const workspaceIssues = validateArchitectureInteriorWorkspaceV2(workspace);
  if (workspaceIssues.length) return { ok: false, code: 'invalid_workspace', issues: workspaceIssues };
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  if ((architecture.serviceOpenings?.length ?? 0) || (architecture.grids?.length ?? 0) || (architecture.roofs?.length ?? 0) || (architecture.stairs?.length ?? 0) || (architecture.shafts?.length ?? 0) || (architecture.zones?.length ?? 0) || (interior.ceilingSystems?.length ?? 0) || (interior.acousticZones?.length ?? 0)) return { ok: false, code: 'quantity_reconciliation_failed', issues: ['unsupported_schedule_object_kind'] };
  const architectureDocumentHash = hashArchitectureInteriorEvidenceV2(architecture);
  const interiorDocumentHash = hashArchitectureInteriorEvidenceV2(interior);
  const binding: QuantityBinding = {
    projectId: workspace.projectId,
    revision: workspace.workspace.revision,
    workspaceContentHash: workspace.contentHash,
    architectureDocumentId: workspace.architecture.documentId,
    interiorDocumentId: workspace.interior.documentId,
    architectureDocumentHash,
    interiorDocumentHash,
  };
  const spaces = architecture.spaces.map(space => ({ id: space.id, storeyId: space.storeyId, usageCode: space.usage, areaM2: round(polygonAreaMm2(space.boundaryMm) / 1_000_000) }));
  const openingAreaByWall = new Map<string, number>();
  const openings = architecture.openings.map(opening => {
    const areaM2 = round(opening.widthMm * opening.heightMm / 1_000_000);
    openingAreaByWall.set(opening.hostWallId, round((openingAreaByWall.get(opening.hostWallId) ?? 0) + areaM2));
    return { id: opening.id, kindCode: opening.kind, hostWallId: opening.hostWallId, widthM: round(opening.widthMm / 1000), heightM: round(opening.heightMm / 1000), areaM2 };
  });
  const walls = architecture.walls.map(wall => {
    const lengthM = round(wallLengthMm(wall) / 1000);
    const heightM = round(wall.heightMm / 1000);
    const thicknessM = round(wall.thicknessMm / 1000);
    const grossAreaM2 = round(lengthM * heightM);
    const openingAreaM2 = openingAreaByWall.get(wall.id) ?? 0;
    const netAreaM2 = round(grossAreaM2 - openingAreaM2);
    return { id: wall.id, storeyId: wall.storeyId, lengthM, heightM, thicknessM, grossAreaM2, openingAreaM2, netAreaM2, volumeM3: round(netAreaM2 * thicknessM) };
  });
  const slabs = architecture.slabs.map(slab => {
    const areaM2 = round(polygonAreaMm2(slab.boundaryMm) / 1_000_000);
    const thicknessM = round(slab.thicknessMm / 1000);
    return { id: slab.id, storeyId: slab.storeyId, spaceId: slab.spaceId, areaM2, thicknessM, volumeM3: round(areaM2 * thicknessM) };
  });
  const ceilings = architecture.ceilings.map(ceiling => ({ id: ceiling.id, storeyId: ceiling.storeyId, spaceId: ceiling.spaceId, areaM2: round(polygonAreaMm2(ceiling.boundaryMm) / 1_000_000), elevationM: round(ceiling.elevationMm / 1000), thicknessM: ceiling.thicknessMm === undefined ? null : round(ceiling.thicknessMm / 1000) }));
  const furniture = interior.furniture.map(item => ({ id: item.id, spaceId: item.spaceId, countEa: 1 as const, envelopeVolumeM3: round(item.sizeMm[0] * item.sizeMm[1] * item.sizeMm[2] / 1_000_000_000), clearanceM: round(item.clearanceMm / 1000) }));
  const wallById = new Map(walls.map(item => [item.id, item]));
  const slabById = new Map(slabs.map(item => [item.id, item]));
  const ceilingById = new Map(ceilings.map(item => [item.id, item]));
  const finishHostMismatch = interior.finishes.some(item => item.surface === 'wall'
    ? !wallById.has(item.hostId)
    : item.surface === 'floor'
      ? !slabById.has(item.hostId)
      : !ceilingById.has(item.hostId));
  const finishes = interior.finishes.map(item => ({ id: item.id, spaceId: item.spaceId, hostId: item.hostId, surfaceCode: item.surface, materialCode: item.material, areaM2: item.surface === 'wall' ? wallById.get(item.hostId)?.netAreaM2 ?? 0 : item.surface === 'floor' ? slabById.get(item.hostId)?.areaM2 ?? 0 : ceilingById.get(item.hostId)?.areaM2 ?? 0 }));
  const millwork = (interior.millwork ?? []).map(item => ({ id: item.id, spaceId: item.spaceId, materialCode: item.material, envelopeVolumeM3: round(item.sizeMm[0] * item.sizeMm[1] * item.sizeMm[2] / 1_000_000_000), clearanceM: round(item.clearanceMm / 1000) }));
  const lights = interior.lights.map(item => ({ id: item.id, spaceId: item.spaceId, hostCeilingId: item.hostCeilingId, countEa: 1 as const, lumens: item.lumens, cctK: item.cctK }));
  const payload: ArchitectureInteriorQuantityPayload = {
    schema: ARCHITECTURE_INTERIOR_QUANTITY_SCHEMA,
    binding,
    units: { length: 'm', area: 'm2', volume: 'm3', count: 'ea' },
    schedules: { spaces, walls, openings, slabs, ceilings, furniture, finishes, millwork, lights },
    totals: {
      spaceAreaM2: sum(spaces.map(item => item.areaM2)),
      wallNetAreaM2: sum(walls.map(item => item.netAreaM2)),
      slabVolumeM3: sum(slabs.map(item => item.volumeM3)),
      ceilingAreaM2: sum(ceilings.map(item => item.areaM2)),
      openingCountEa: openings.length,
      furnitureCountEa: furniture.length,
      lightCountEa: lights.length,
    },
    reconciliation: { status: 'passed', checks: ['source_object_coverage', 'host_binding', 'finite_nonnegative_quantities', 'workspace_revision_binding'] },
    pricing: { status: 'not_run', reasonCode: 'authoritative_unit_rates_required' },
  };
  const numericValues = [
    ...spaces.flatMap(item => [item.areaM2]),
    ...walls.flatMap(item => [item.lengthM, item.heightM, item.thicknessM, item.grossAreaM2, item.openingAreaM2, item.netAreaM2, item.volumeM3]),
    ...openings.flatMap(item => [item.widthM, item.heightM, item.areaM2]),
    ...slabs.flatMap(item => [item.areaM2, item.thicknessM, item.volumeM3]),
    ...ceilings.flatMap(item => [item.areaM2, item.elevationM, ...(item.thicknessM === null ? [] : [item.thicknessM])]),
    ...furniture.flatMap(item => [item.countEa, item.envelopeVolumeM3, item.clearanceM]),
    ...finishes.flatMap(item => [item.areaM2]),
    ...millwork.flatMap(item => [item.envelopeVolumeM3, item.clearanceM]),
    ...lights.flatMap(item => [item.countEa, item.lumens, item.cctK]),
    ...Object.values(payload.totals),
  ];
  const sourceCountsMatch = spaces.length === architecture.spaces.length && walls.length === architecture.walls.length && openings.length === architecture.openings.length && slabs.length === architecture.slabs.length && ceilings.length === architecture.ceilings.length && furniture.length === interior.furniture.length && finishes.length === interior.finishes.length && millwork.length === (interior.millwork ?? []).length && lights.length === interior.lights.length;
  const degenerateArea = spaces.some(item => item.areaM2 <= 0) || slabs.some(item => item.areaM2 <= 0) || ceilings.some(item => item.areaM2 <= 0);
  const openingOverflow = walls.some(item => item.openingAreaM2 > item.grossAreaM2);
  if (!sourceCountsMatch || finishHostMismatch || degenerateArea || openingOverflow || numericValues.some(value => !Number.isFinite(value)) || [...walls.map(item => item.netAreaM2), ...slabs.map(item => item.volumeM3), ...ceilings.map(item => item.areaM2), ...furniture.map(item => item.envelopeVolumeM3), ...finishes.map(item => item.areaM2), ...millwork.map(item => item.envelopeVolumeM3)].some(value => value < 0)) return { ok: false, code: 'quantity_reconciliation_failed', issues: [finishHostMismatch ? 'finish_surface_host_mismatch' : openingOverflow ? 'opening_area_exceeds_wall' : degenerateArea ? 'degenerate_quantity_boundary' : 'quantity_source_or_numeric_mismatch'] };
  const contentHash = hashArchitectureInteriorEvidenceV2(payload);
  const evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: 'nexyfab.architecture-interior-quantity-verification.v1', binding, contentHash, sourceCounts: { architecture: architecture.storeys.length + architecture.spaces.length + architecture.walls.length + architecture.slabs.length + architecture.ceilings.length + architecture.openings.length, interior: interior.lights.length + interior.furniture.length + interior.finishes.length + (interior.millwork ?? []).length }, totals: payload.totals });
  const inputs: ArtifactInputBinding[] = modelInputs
    ? [...modelInputs]
    : workspace.artifactGraph.artifacts.filter(item => item.kind === 'model' && item.state === 'current').map(item => ({ artifactId: item.id, revision: item.revision, contentHash: item.contentHash }));
  const verification = { status: 'passed' as const, verifierId: 'architecture-interior-quantity.v1' as const, evidenceHash, issues: [] as [] };
  const artifact: DesignArtifactNode = { id: `quantity:architecture-interior:${workspace.workspace.revision}`, kind: 'quantity', revision: workspace.workspace.revision, contentHash, state: 'current', inputs, verification, staleBecause: [] };
  const dependencies: ArtifactDependencyEdge[] = inputs.map(input => ({ id: `dependency:${input.artifactId}:${artifact.id}`, sourceId: input.artifactId, targetId: artifact.id, policy: 'invalidate' }));
  return { ok: true, result: { payload, contentHash, verification, artifact, dependencies } };
}
