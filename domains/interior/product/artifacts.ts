import { createHash } from 'node:crypto';
import {
  hashInteriorProductContract,
  validateInteriorProductContract,
  type InteriorProductContract,
  type InteriorRevision,
} from './contract';

/** Native, deterministic schedules derived from an interior contract. These are
 * coordination artifacts only; they are not IFC, code, survey, catalog, or
 * professional-review evidence. */
export const INTERIOR_NATIVE_ARTIFACT_SCHEMA = 'nexyfab.interior.native-artifacts.v1' as const;
export type InteriorArtifactBinding = { sourceRevision: InteriorRevision; modelSha256: string; coordinateFrameSha256: string };
export type InteriorRoomScheduleRow = { id: string; name: string; areaM2: number; targetAreaM2: number | null; deltaM2: number | null; occupants: number | null };
export type InteriorFfeScheduleRow = { id: string; spaceId: string; kind: 'ffe-envelope'; widthMm: number; depthMm: number; heightMm: number; quantity: number; footprintM2: number };
export type InteriorFinishScheduleRow = { id: string; spaceId: string; floor: string; wall: string; ceiling: string; areaM2: number };
export type InteriorMillworkScheduleRow = { id: string; spaceId: string; kind: string; widthMm: number; depthMm: number; heightMm: number; linearM: number; footprintM2: number };
export type InteriorQuantityRow = { category: 'ffe' | 'lighting' | 'millwork'; id: string; quantity: number; unit: 'ea' };
export type InteriorDrawingSnapshot = { spaces: Array<{ id: string; polygon: Array<{ x: number; y: number }> }>; walls: Array<{ id: string; start: { x: number; y: number }; end: { x: number; y: number }; thickness: number }>; openings: Array<{ id: string; hostWallId: string; center: { x: number; y: number }; width: number; sill: number; head: number; swing: string }> };
export interface InteriorNativeArtifactSet extends InteriorArtifactBinding {
  schema: typeof INTERIOR_NATIVE_ARTIFACT_SCHEMA;
  modelSha256: string;
  roomSchedule: InteriorRoomScheduleRow[];
  ffeSchedule: InteriorFfeScheduleRow[];
  finishSchedule: InteriorFinishScheduleRow[];
  millworkSchedule: InteriorMillworkScheduleRow[];
  quantitySchedule: InteriorQuantityRow[];
  drawingSnapshot: InteriorDrawingSnapshot;
  contentSha256: string;
}

const SHA = /^[a-f0-9]{64}$/;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const finiteNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value as Record<string, unknown>).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const sorted = <T extends { id: string }>(items: T[]): T[] => [...items].sort((a, b) => a.id.localeCompare(b.id));
const areaM2 = (polygon: unknown): number => {
  if (!Array.isArray(polygon) || polygon.length < 4) return Number.NaN;
  let area = 0;
  for (let i = 0; i < polygon.length - 1; i += 1) {
    const a = polygon[i] as { x?: unknown; y?: unknown }; const b = polygon[i + 1] as { x?: unknown; y?: unknown };
    if (!finite(a.x) || !finite(a.y) || !finite(b.x) || !finite(b.y)) return Number.NaN;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2_000_000;
};
const fail = (message: string): never => { throw new Error(`invalid_interior_native_artifacts:${message}`); };

export function validateInteriorNativeArtifacts(value: unknown): string[] {
  const issues: string[] = [];
  if (value === null || typeof value !== 'object') return ['artifacts:object'];
  const item = value as Partial<InteriorNativeArtifactSet>;
  if (item.schema !== INTERIOR_NATIVE_ARTIFACT_SCHEMA) issues.push('schema');
  if (!item.sourceRevision || typeof item.sourceRevision.id !== 'string' || !SHA.test(item.sourceRevision.sha256)) issues.push('sourceRevision');
  for (const key of ['modelSha256', 'coordinateFrameSha256', 'contentSha256'] as const) if (typeof item[key] !== 'string' || !SHA.test(item[key])) issues.push(key);
  const ids = new Set<string>();
  const checkRows = (rows: unknown, name: string): void => { if (!Array.isArray(rows)) { issues.push(`${name}:array`); return; } for (const row of rows) { if (row === null || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string' || ids.has((row as { id: string }).id)) issues.push(`${name}:duplicate_id`); else ids.add((row as { id: string }).id); } };
  checkRows(item.roomSchedule, 'roomSchedule'); checkRows(item.ffeSchedule, 'ffeSchedule'); checkRows(item.finishSchedule, 'finishSchedule'); checkRows(item.millworkSchedule, 'millworkSchedule');
  if (!Array.isArray(item.quantitySchedule) || !Array.isArray(item.drawingSnapshot?.spaces) || !Array.isArray(item.drawingSnapshot?.walls) || !Array.isArray(item.drawingSnapshot?.openings)) issues.push('shape');
  const payload = { ...item, contentSha256: undefined };
  if (typeof item.contentSha256 === 'string' && item.contentSha256 !== sha256(payload)) issues.push('contentSha256:mismatch');
  return [...new Set(issues)];
}

export function generateInteriorNativeArtifacts(input: unknown, expected?: Partial<InteriorArtifactBinding>): InteriorNativeArtifactSet {
  const issues = validateInteriorProductContract(input);
  if (issues.length) return fail(`contract:${issues.join(',')}`);
  const contract = input as InteriorProductContract;
  const sourceRevision: InteriorRevision = { id: contract.identity.revision, sha256: contract.hostBinding.hostRevision.sha256 };
  const modelSha256 = contract.identity.contentSha256;
  const coordinateFrameSha256 = contract.coordinateFrameSha256;
  if (expected?.modelSha256 !== undefined && expected.modelSha256 !== modelSha256) return fail('binding:model_sha256_stale');
  if (expected?.coordinateFrameSha256 !== undefined && expected.coordinateFrameSha256 !== coordinateFrameSha256) return fail('binding:coordinate_frame_stale');
  if (expected?.sourceRevision && (expected.sourceRevision.id !== sourceRevision.id || expected.sourceRevision.sha256 !== sourceRevision.sha256)) return fail('binding:revision_stale');
  if (modelSha256 !== hashInteriorProductContract(contract)) return fail('binding:model_sha256_invalid');
  const objects = contract.objects;
  const spaces = sorted(objects.filter(object => object.kind === 'space'));
  const target = new Map(contract.requirements.program.spaces.map(item => [item.spaceId, item]));
  const roomSchedule = spaces.map(object => {
    const data = object.data; const area = areaM2(data.polygon); const req = target.get(object.id);
    if (!finiteNonNegative(area)) return fail(`derived:space_area:${object.id}`);
    return { id: object.id, name: String(data.name), areaM2: area, targetAreaM2: req?.areaTargetM2 ?? null, deltaM2: req ? area - req.areaTargetM2 : null, occupants: req?.occupants ?? null };
  });
  const ffeSchedule = sorted(objects.filter(object => object.kind === 'ffe-envelope')).map(object => {
    const d = object.data; const widthMm = Number(d.width); const depthMm = Number(d.depth); const heightMm = Number(d.height); const quantity = Number(d.quantity); const footprintM2 = widthMm * depthMm / 1_000_000;
    if (![widthMm, depthMm, heightMm, quantity, footprintM2].every(finiteNonNegative) || quantity < 1 || widthMm <= 0 || depthMm <= 0 || heightMm <= 0) return fail(`derived:ffe:${object.id}`);
    return { id: object.id, spaceId: String(d.spaceId), kind: 'ffe-envelope' as const, widthMm, depthMm, heightMm, quantity, footprintM2 };
  });
  const finishSchedule = sorted(objects.filter(object => object.kind === 'finish-layer')).map(object => {
    const d = object.data; const area = roomSchedule.find(row => row.id === d.spaceId)?.areaM2;
    if (area === undefined || !finiteNonNegative(area)) return fail(`derived:finish:${object.id}`);
    return { id: object.id, spaceId: String(d.spaceId), floor: String(d.floor), wall: String(d.wall), ceiling: String(d.ceiling), areaM2: area };
  });
  const millworkSchedule = sorted(objects.filter(object => object.kind === 'millwork')).map(object => {
    const d = object.data; const widthMm = Number(d.width); const depthMm = Number(d.depth); const heightMm = Number(d.height); const footprintM2 = widthMm * depthMm / 1_000_000;
    if (![widthMm, depthMm, heightMm, footprintM2].every(finiteNonNegative) || widthMm <= 0 || depthMm <= 0 || heightMm <= 0) return fail(`derived:millwork:${object.id}`);
    return { id: object.id, spaceId: String(d.spaceId), kind: String(d.kind), widthMm, depthMm, heightMm, linearM: widthMm / 1000, footprintM2 };
  });
  const quantitySchedule: InteriorQuantityRow[] = sorted(objects.filter(object => ['ffe-envelope', 'lighting', 'millwork'].includes(object.kind))).map(object => ({ category: object.kind === 'ffe-envelope' ? 'ffe' : object.kind === 'lighting' ? 'lighting' : 'millwork', id: object.id, quantity: object.kind === 'ffe-envelope' || object.kind === 'lighting' ? Number(object.data.quantity) : 1, unit: 'ea' }));
  if (quantitySchedule.some(row => !finiteNonNegative(row.quantity) || row.quantity < 1)) return fail('derived:quantity');
  const drawingSnapshot: InteriorDrawingSnapshot = {
    spaces: spaces.map(object => ({ id: object.id, polygon: object.data.polygon as Array<{ x: number; y: number }> })),
    walls: sorted(objects.filter(object => object.kind === 'wall')).map(object => ({ id: object.id, start: object.data.start as { x: number; y: number }, end: object.data.end as { x: number; y: number }, thickness: Number(object.data.thickness) })),
    openings: sorted(objects.filter(object => object.kind === 'opening')).map(object => ({ id: object.id, hostWallId: String(object.data.hostWallId), center: object.data.center as { x: number; y: number }, width: Number(object.data.width), sill: Number(object.data.sill), head: Number(object.data.head), swing: String(object.data.swing) })),
  };
  const draft = { schema: INTERIOR_NATIVE_ARTIFACT_SCHEMA, sourceRevision, modelSha256, coordinateFrameSha256, roomSchedule, ffeSchedule, finishSchedule, millworkSchedule, quantitySchedule, drawingSnapshot, contentSha256: undefined };
  const result = { ...draft, contentSha256: sha256(draft) } as InteriorNativeArtifactSet;
  const artifactIssues = validateInteriorNativeArtifacts(result); if (artifactIssues.length) return fail(artifactIssues.join(','));
  return result;
}

export const buildInteriorNativeArtifacts = generateInteriorNativeArtifacts;
