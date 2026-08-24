import { createHash } from 'node:crypto';
import {
  hashBuildingProductContract,
  validateBuildingProductContract,
  type BuildingPoint,
  type BuildingProductContract,
  type BuildingRevision,
} from './contract';
import { hashBuildingCoordinateAuthority } from './verify';

/** Native schedules and drawing data derived from the building contract. No
 * IFC, survey, code, catalog, engineering, or professional-review evidence is
 * produced by this module. */
export const BUILDING_NATIVE_ARTIFACT_SCHEMA = 'nexyfab.building.native-artifacts.v1' as const;
export type BuildingArtifactBinding = { sourceRevision: BuildingRevision; modelSha256: string; coordinateFrameSha256: string };
export type BuildingLevelScheduleRow = { id: string; name: string; elevationMm: number; heightMm: number };
export type BuildingSpaceScheduleRow = { id: string; levelId: string; name: string; use: string; areaM2: number; targetAreaM2: number | null; occupancy: number | null };
export type BuildingOpeningScheduleRow = { id: string; kind: 'door' | 'window'; levelId: string; hostWallId: string; widthMm: number; heightMm: number; sillMm: number; areaM2: number };
export type BuildingMaterialQuantityRow = { id: string; materialRef: string; layerKind: string; hostCount: number; areaM2: number; volumeM3: number };
export type BuildingPlanSnapshot = { levels: Array<{ id: string; elevationMm: number }>; spaces: Array<{ id: string; levelId: string; boundary: BuildingPoint[] }>; walls: Array<{ id: string; levelId: string; start: BuildingPoint; end: BuildingPoint; thicknessMm: number }>; openings: Array<{ id: string; levelId: string; hostWallId: string; center: BuildingPoint; widthMm: number; heightMm: number; kind: 'door' | 'window' }>; grids: Array<{ id: string; axis: 'X' | 'Y'; label: string; start: BuildingPoint; end: BuildingPoint }> };
export interface BuildingNativeArtifactSet extends BuildingArtifactBinding {
  schema: typeof BUILDING_NATIVE_ARTIFACT_SCHEMA;
  levelSchedule: BuildingLevelScheduleRow[];
  spaceSchedule: BuildingSpaceScheduleRow[];
  openingSchedule: BuildingOpeningScheduleRow[];
  materialQuantitySchedule: BuildingMaterialQuantityRow[];
  planSnapshot: BuildingPlanSnapshot;
  contentSha256: string;
}

const SHA = /^[a-f0-9]{64}$/;
const finiteNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value as Record<string, unknown>).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const sorted = <T extends { id: string }>(items: T[]): T[] => [...items].sort((a, b) => a.id.localeCompare(b.id));
const polygonAreaM2 = (polygon: BuildingPoint[]): number => {
  let area = 0;
  for (let i = 0; i < polygon.length - 1; i += 1) area += polygon[i]!.x * polygon[i + 1]!.y - polygon[i + 1]!.x * polygon[i]!.y;
  return Math.abs(area) / 2_000_000;
};
const fail = (message: string): never => { throw new Error(`invalid_building_native_artifacts:${message}`); };

export function validateBuildingNativeArtifacts(value: unknown): string[] {
  const issues: string[] = [];
  if (value === null || typeof value !== 'object') return ['artifacts:object'];
  const item = value as Partial<BuildingNativeArtifactSet>;
  if (item.schema !== BUILDING_NATIVE_ARTIFACT_SCHEMA) issues.push('schema');
  if (!item.sourceRevision || typeof item.sourceRevision.id !== 'string' || !SHA.test(item.sourceRevision.sha256)) issues.push('sourceRevision');
  for (const key of ['modelSha256', 'coordinateFrameSha256', 'contentSha256'] as const) if (typeof item[key] !== 'string' || !SHA.test(item[key])) issues.push(key);
  const ids = new Set<string>();
  const checkRows = (rows: unknown, name: string): void => { if (!Array.isArray(rows)) { issues.push(`${name}:array`); return; } for (const row of rows) { if (row === null || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string' || ids.has((row as { id: string }).id)) issues.push(`${name}:duplicate_id`); else ids.add((row as { id: string }).id); } };
  checkRows(item.levelSchedule, 'levelSchedule'); checkRows(item.spaceSchedule, 'spaceSchedule'); checkRows(item.openingSchedule, 'openingSchedule'); checkRows(item.materialQuantitySchedule, 'materialQuantitySchedule');
  if (!item.planSnapshot || !Array.isArray(item.planSnapshot.levels) || !Array.isArray(item.planSnapshot.spaces) || !Array.isArray(item.planSnapshot.walls) || !Array.isArray(item.planSnapshot.openings) || !Array.isArray(item.planSnapshot.grids)) issues.push('shape');
  const payload = { ...item, contentSha256: undefined };
  if (typeof item.contentSha256 === 'string' && item.contentSha256 !== sha256(payload)) issues.push('contentSha256:mismatch');
  return [...new Set(issues)];
}

export function generateBuildingNativeArtifacts(input: unknown, expected?: Partial<BuildingArtifactBinding>): BuildingNativeArtifactSet {
  const issues = validateBuildingProductContract(input);
  if (issues.length) return fail(`contract:${issues.join(',')}`);
  const contract = input as BuildingProductContract;
  const sourceRevision = contract.identity.revision;
  const modelSha256 = contract.identity.contentSha256;
  const coordinateFrameSha256 = hashBuildingCoordinateAuthority(contract);
  if (expected?.modelSha256 !== undefined && expected.modelSha256 !== modelSha256) return fail('binding:model_sha256_stale');
  if (expected?.coordinateFrameSha256 !== undefined && expected.coordinateFrameSha256 !== coordinateFrameSha256) return fail('binding:coordinate_frame_stale');
  if (expected?.sourceRevision && (expected.sourceRevision.id !== sourceRevision.id || expected.sourceRevision.sha256 !== sourceRevision.sha256)) return fail('binding:revision_stale');
  if (modelSha256 !== hashBuildingProductContract(contract)) return fail('binding:model_sha256_invalid');
  const target = new Map(contract.requirements.program.spaces.map(item => [item.spaceId, item]));
  const levelSchedule = sorted(contract.levels).map(level => ({ id: level.id, name: level.name, elevationMm: level.elevationMm, heightMm: level.heightMm }));
  const spaceSchedule = sorted(contract.spaces).map(space => {
    const area = polygonAreaM2(space.boundary); const req = target.get(space.id);
    if (!finiteNonNegative(area) || !finiteNonNegative(space.areaM2)) return fail(`derived:space_area:${space.id}`);
    return { id: space.id, levelId: space.levelId, name: space.name, use: space.use, areaM2: area, targetAreaM2: req?.areaTargetM2 ?? null, occupancy: req?.occupancy ?? null };
  });
  const openingSchedule = sorted([...contract.doors.map(item => ({ ...item, kind: 'door' as const })), ...contract.windows.map(item => ({ ...item, kind: 'window' as const }))]).map(opening => {
    const areaM2 = opening.widthMm * opening.heightMm / 1_000_000;
    if (![opening.widthMm, opening.heightMm, opening.sillMm, areaM2].every(finiteNonNegative) || opening.widthMm <= 0 || opening.heightMm <= 0) return fail(`derived:opening:${opening.id}`);
    return { id: opening.id, kind: opening.kind, levelId: opening.levelId, hostWallId: opening.hostWallId, widthMm: opening.widthMm, heightMm: opening.heightMm, sillMm: opening.sillMm, areaM2 };
  });
  const wallMap = new Map(contract.walls.map(wall => [wall.id, wall]));
  const slabMap = new Map(contract.slabs.map(slab => [slab.id, slab]));
  const materialGroups = new Map<string, { materialRef: string; layerKind: string; hostCount: number; areaM2: number; volumeM3: number }>();
  for (const layer of contract.envelopeLayers) {
    const wall = wallMap.get(layer.hostId); const slab = slabMap.get(layer.hostId); const roof = contract.roof.id === layer.hostId ? contract.roof : undefined;
    const grossAreaM2 = wall
      ? Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) * wall.heightMm / 1_000_000
      : slab ? polygonAreaM2(slab.boundary) : roof ? polygonAreaM2(roof.boundary) : Number.NaN;
    const hostedOpeningAreaM2 = wall ? [...contract.doors, ...contract.windows].filter(opening => opening.hostWallId === wall.id).reduce((sum, opening) => sum + opening.widthMm * opening.heightMm / 1_000_000, 0) : 0;
    const areaM2 = grossAreaM2 - hostedOpeningAreaM2;
    const volumeM3 = areaM2 * layer.thicknessMm / 1000;
    if (![grossAreaM2, hostedOpeningAreaM2, areaM2, volumeM3, layer.thicknessMm].every(finiteNonNegative)) return fail(`derived:material:${layer.id}`);
    const key = `${layer.layerKind}|${layer.materialRef}`; const current = materialGroups.get(key);
    if (current) { current.hostCount += 1; current.areaM2 += areaM2; current.volumeM3 += volumeM3; } else materialGroups.set(key, { materialRef: layer.materialRef, layerKind: layer.layerKind, hostCount: 1, areaM2, volumeM3 });
  }
  const materialQuantitySchedule = [...materialGroups.values()].sort((a, b) => `${a.layerKind}|${a.materialRef}`.localeCompare(`${b.layerKind}|${b.materialRef}`)).map((row, index) => ({ id: `material-${index + 1}`, ...row }));
  const planSnapshot: BuildingPlanSnapshot = {
    levels: levelSchedule.map(level => ({ id: level.id, elevationMm: level.elevationMm })),
    spaces: sorted(contract.spaces).map(space => ({ id: space.id, levelId: space.levelId, boundary: space.boundary })),
    walls: sorted(contract.walls).map(wall => ({ id: wall.id, levelId: wall.levelId, start: wall.start, end: wall.end, thicknessMm: wall.thicknessMm })),
    openings: openingSchedule.map(opening => ({ id: opening.id, levelId: opening.levelId, hostWallId: opening.hostWallId, center: (contract.doors.find(item => item.id === opening.id) ?? contract.windows.find(item => item.id === opening.id))!.center, widthMm: opening.widthMm, heightMm: opening.heightMm, kind: opening.kind })),
    grids: sorted(contract.grids).map(grid => ({ id: grid.id, axis: grid.axis, label: grid.label, start: grid.start, end: grid.end })),
  };
  const draft = { schema: BUILDING_NATIVE_ARTIFACT_SCHEMA, sourceRevision, modelSha256, coordinateFrameSha256, levelSchedule, spaceSchedule, openingSchedule, materialQuantitySchedule, planSnapshot, contentSha256: undefined };
  const result = { ...draft, contentSha256: sha256(draft) } as BuildingNativeArtifactSet;
  const artifactIssues = validateBuildingNativeArtifacts(result); if (artifactIssues.length) return fail(artifactIssues.join(','));
  return result;
}

export const buildBuildingNativeArtifacts = generateBuildingNativeArtifacts;
