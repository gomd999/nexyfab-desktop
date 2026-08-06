export type BuildingInteriorKind = 'room' | 'window' | 'balcony' | 'stair' | 'corridor' | 'curved_facade' | 'light';
type V3 = [number, number, number];
interface BaseObject { id: string; kind: BuildingInteriorKind; name: string; positionMm: V3 }
export type BuildingInteriorObject =
  | BaseObject & { kind: 'room'; sizeMm: V3; usage: string }
  | BaseObject & { kind: 'window'; hostId: string; widthMm: number; heightMm: number; sillMm: number }
  | BaseObject & { kind: 'balcony'; sizeMm: V3; railingHeightMm: number }
  | BaseObject & { kind: 'stair'; widthMm: number; totalRiseMm: number; treadMm: number; riserMm: number; steps: number; flights: number }
  | BaseObject & { kind: 'corridor'; pathMm: V3[]; widthMm: number; clearHeightMm: number }
  | BaseObject & { kind: 'curved_facade'; radiusMm: number; angleDeg: number; heightMm: number; thicknessMm: number }
  | BaseObject & { kind: 'light'; roomId: string; lumens: number; cctK: number; mountingHeightMm: number };
export interface BuildingInteriorModel { schema: 'nexyfab.building-interior.v1'; units: 'mm'; revision: number; objects: BuildingInteriorObject[] }
export type BuildingInteriorEdit =
  | { kind: 'move'; objectId: string; positionMm: V3 }
  | { kind: 'set_property'; objectId: string; property: string; value: number | string }
  | { kind: 'duplicate'; objectId: string; newId: string; positionMm: V3 }
  | { kind: 'remove'; objectId: string };
export interface BuildingInteriorEditResult { model: BuildingInteriorModel; affectedObjectIds: string[]; invalidatedChecks: string[] }

const finite = (value: number) => Number.isFinite(value), positive = (value: number) => finite(value) && value > 0;
export function validateBuildingInteriorModel(model: BuildingInteriorModel): string[] {
  const issues: string[] = [], ids = new Set<string>();
  if (model.schema !== 'nexyfab.building-interior.v1' || model.units !== 'mm' || !Number.isSafeInteger(model.revision) || model.revision < 0) issues.push('Invalid model header.');
  for (const item of model.objects) {
    if (!item.id.trim() || ids.has(item.id)) issues.push(`Duplicate or empty object id ${item.id || '(empty)'}.`); ids.add(item.id);
    if (!item.name.trim() || item.positionMm.length !== 3 || !item.positionMm.every(finite)) issues.push(`${item.id}: invalid name or position.`);
    if ((item.kind === 'room' || item.kind === 'balcony') && !item.sizeMm.every(positive)) issues.push(`${item.id}: size must be positive.`);
    if (item.kind === 'window' && (![item.widthMm, item.heightMm].every(positive) || !finite(item.sillMm) || item.sillMm < 0)) issues.push(`${item.id}: invalid window dimensions.`);
    if (item.kind === 'balcony' && !positive(item.railingHeightMm)) issues.push(`${item.id}: invalid railing height.`);
    if (item.kind === 'stair' && (![item.widthMm, item.totalRiseMm, item.treadMm, item.riserMm].every(positive) || !Number.isSafeInteger(item.steps) || item.steps < 1 || ![1, 2].includes(item.flights) || Math.abs(item.steps * item.riserMm - item.totalRiseMm) > Math.max(2, item.totalRiseMm * 0.005))) issues.push(`${item.id}: stair rise, step count, or flights are inconsistent.`);
    if (item.kind === 'corridor' && (item.pathMm.length < 2 || item.pathMm.some(point => point.length !== 3 || !point.every(finite)) || !positive(item.widthMm) || !positive(item.clearHeightMm))) issues.push(`${item.id}: invalid corridor path or clearance.`);
    if (item.kind === 'curved_facade' && (![item.radiusMm, item.heightMm, item.thicknessMm].every(positive) || !finite(item.angleDeg) || Math.abs(item.angleDeg) <= 0 || Math.abs(item.angleDeg) > 360)) issues.push(`${item.id}: invalid curved facade.`);
    if (item.kind === 'light' && (!positive(item.lumens) || !positive(item.cctK) || !positive(item.mountingHeightMm))) issues.push(`${item.id}: invalid lighting properties.`);
  }
  for (const item of model.objects) {
    if (item.kind === 'window' && !ids.has(item.hostId)) issues.push(`${item.id}: unknown window host ${item.hostId}.`);
    if (item.kind === 'light' && (!ids.has(item.roomId) || model.objects.find(object => object.id === item.roomId)?.kind !== 'room')) issues.push(`${item.id}: light must reference an existing room.`);
  }
  return issues;
}

const editable: Record<BuildingInteriorKind, string[]> = {
  room: ['name', 'usage', 'sizeMm.0', 'sizeMm.1', 'sizeMm.2'], window: ['name', 'widthMm', 'heightMm', 'sillMm'], balcony: ['name', 'sizeMm.0', 'sizeMm.1', 'sizeMm.2', 'railingHeightMm'],
  stair: ['name', 'widthMm', 'totalRiseMm', 'treadMm', 'riserMm', 'steps', 'flights'], corridor: ['name', 'widthMm', 'clearHeightMm'], curved_facade: ['name', 'radiusMm', 'angleDeg', 'heightMm', 'thicknessMm'], light: ['name', 'lumens', 'cctK', 'mountingHeightMm'],
};
function setProperty(item: BuildingInteriorObject, property: string, value: number | string): BuildingInteriorObject {
  if (!editable[item.kind].includes(property)) throw new Error(`${property} is not editable for ${item.kind}.`);
  const next = structuredClone(item) as BuildingInteriorObject, segments = property.split('.'); let target: unknown = next;
  for (let index = 0; index < segments.length - 1; index++) target = (target as Record<string, unknown>)[segments[index]!];
  (target as Record<string, unknown>)[segments.at(-1)!] = value; return next;
}
/** Apply selection-scoped edits without regenerating unrelated rooms or building objects. */
export function applyBuildingInteriorEdits(model: BuildingInteriorModel, edits: readonly BuildingInteriorEdit[]): BuildingInteriorEditResult {
  const objects = structuredClone(model.objects), affected: string[] = [];
  const affectedKinds = new Set<BuildingInteriorKind>();
  for (const edit of edits) {
    const index = objects.findIndex(item => item.id === edit.objectId); if (index < 0) throw new Error(`Unknown object ${edit.objectId}.`);
    const current = objects[index]!;
    affectedKinds.add(current.kind);
    if (edit.kind === 'move') objects[index] = { ...current, positionMm: [...edit.positionMm] as V3 };
    else if (edit.kind === 'set_property') objects[index] = setProperty(current, edit.property, edit.value);
    else if (edit.kind === 'duplicate') { if (objects.some(item => item.id === edit.newId)) throw new Error(`Duplicate object id ${edit.newId}.`); objects.push({ ...structuredClone(current), id: edit.newId, positionMm: [...edit.positionMm] as V3 }); affected.push(edit.newId); }
    else {
      const dependants = objects.filter(item => (item.kind === 'window' && item.hostId === current.id) || (item.kind === 'light' && item.roomId === current.id));
      if (dependants.length) throw new Error(`Cannot remove ${current.id}; referenced by ${dependants.map(item => item.id).join(', ')}.`);
      objects.splice(index, 1);
    }
    affected.push(edit.objectId);
  }
  const next = { ...model, revision: model.revision + 1, objects };
  const issues = validateBuildingInteriorModel(next); if (issues.length) throw new Error(issues.join(' '));
  const invalidated = new Set<string>(['placement', 'ifc_roundtrip']);
  if ([...affectedKinds].some(kind => ['room', 'corridor', 'window', 'balcony', 'stair', 'curved_facade'].includes(kind))) ['space_boundary', 'egress', 'door_swing', 'interference'].forEach(item => invalidated.add(item));
  if (affectedKinds.has('light') || affectedKinds.has('room')) invalidated.add('lighting');
  return { model: next, affectedObjectIds: [...new Set(affected)], invalidatedChecks: [...invalidated] };
}
