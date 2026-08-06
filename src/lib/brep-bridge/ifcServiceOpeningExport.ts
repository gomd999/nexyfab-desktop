import type { ArchitectureServiceOpening } from '@/lib/ai/architectureInteriorDocuments';
import { pseudoGuid } from './ifcExport';
import { parseEntities, type StepArg } from './stepImport';

type V3 = [number, number, number];
const stringArg = (arg: StepArg | undefined) => arg?.kind === 'string' ? arg.value : null;
const fmt = (value: number) => Number.isInteger(value) ? `${value}.` : Number(value.toPrecision(12)).toString();
const tuple = (values: readonly number[]) => `(${values.map(fmt).join(',')})`;
const normalize = (value: V3): V3 => { const length = Math.hypot(...value); if (!Number.isFinite(length) || length < 1e-12) throw new Error('invalid_opening_axis'); return value.map(item => item / length) as V3; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface IfcServiceOpeningExportInput {
  ifcSource: string;
  openings: readonly ArchitectureServiceOpening[];
  hostGuidById: Readonly<Record<string, string>>;
  fillGuidByOpeningId?: Readonly<Record<string, string>>;
  lengthScaleToIfc?: number;
}

export interface ExportedIfcServiceOpening {
  sourceOpeningId: string;
  openingGuid: string;
  voidRelationGuid: string;
  fillRelationGuid?: string;
  hostGuid: string;
  centerMm: V3;
  axis: V3;
  cutDiameterMm: number;
  depthMm: number;
}

export function exportIfcServiceOpenings(input: IfcServiceOpeningExportInput): { ifcSource: string; openings: ExportedIfcServiceOpening[] } {
  const entities = parseEntities(input.ifcSource);
  const ownerHistory = [...entities.entries()].find(([, entity]) => entity.name === 'IFCOWNERHISTORY')?.[0];
  const context = [...entities.entries()].find(([, entity]) => entity.name === 'IFCGEOMETRICREPRESENTATIONCONTEXT')?.[0];
  if (!ownerHistory || !context) throw new Error('ifc_owner_history_and_geometry_context_required');
  const productByGuid = new Map<string, number>();
  for (const [id, entity] of entities) { const guid = stringArg(entity.args[0]); if (guid) productByGuid.set(guid, id); }
  let nextId = Math.max(0, ...entities.keys()) + 1;
  const lines: string[] = [];
  const add = (body: string) => { const id = nextId++; lines.push(`#${id}=${body};`); return id; };
  const scale = input.lengthScaleToIfc ?? 0.001;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('invalid_ifc_length_scale');
  const exported: ExportedIfcServiceOpening[] = [];
  const seen = new Set<string>();

  for (const opening of [...input.openings].sort((a, b) => a.id.localeCompare(b.id))) {
    if (seen.has(opening.id)) throw new Error(`duplicate_opening:${opening.id}`);
    seen.add(opening.id);
    if (opening.shape !== 'round' || opening.centerMm.some(value => !Number.isFinite(value)) || !Number.isFinite(opening.cutDiameterMm) || opening.cutDiameterMm <= 0 || !Number.isFinite(opening.depthMm) || opening.depthMm <= 0) throw new Error(`invalid_opening:${opening.id}`);
    const hostGuid = input.hostGuidById[opening.hostId];
    const hostRef = hostGuid ? productByGuid.get(hostGuid) : undefined;
    if (!hostGuid || !hostRef) throw new Error(`missing_ifc_host:${opening.hostId}`);
    const axis = normalize(opening.axis);
    const referenceSeed: V3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const refDirection = normalize(cross(referenceSeed, axis));
    const start = opening.centerMm.map((value, index) => (value - axis[index] * opening.depthMm / 2) * scale) as V3;
    const point = add(`IFCCARTESIANPOINT(${tuple(start)})`);
    const axisDirection = add(`IFCDIRECTION(${tuple(axis)})`);
    const ref = add(`IFCDIRECTION(${tuple(refDirection)})`);
    const position = add(`IFCAXIS2PLACEMENT3D(#${point},#${axisDirection},#${ref})`);
    const profileOrigin = add('IFCCARTESIANPOINT((0.,0.))');
    const profilePosition = add(`IFCAXIS2PLACEMENT2D(#${profileOrigin},$)`);
    const profile = add(`IFCCIRCLEPROFILEDEF(.AREA.,$,#${profilePosition},${fmt(opening.cutDiameterMm * scale / 2)})`);
    const extrusionDirection = add('IFCDIRECTION((0.,0.,1.))');
    const solid = add(`IFCEXTRUDEDAREASOLID(#${profile},#${position},#${extrusionDirection},${fmt(opening.depthMm * scale)})`);
    const representation = add(`IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(#${solid}))`);
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
    const openingGuid = pseudoGuid(`service-opening:${opening.id}`);
    const openingRef = add(`IFCOPENINGELEMENT('${openingGuid}',#${ownerHistory},'${opening.id.replaceAll("'", "''")}',$,$,$,#${shape},$)`);
    const voidRelationGuid = pseudoGuid(`service-opening:void:${opening.id}:${hostGuid}`);
    add(`IFCRELVOIDSELEMENT('${voidRelationGuid}',#${ownerHistory},$,$,#${hostRef},#${openingRef})`);
    const fillGuid = input.fillGuidByOpeningId?.[opening.id];
    let fillRelationGuid: string | undefined;
    if (fillGuid) {
      const fillRef = productByGuid.get(fillGuid);
      if (!fillRef) throw new Error(`missing_ifc_fill:${opening.id}`);
      fillRelationGuid = pseudoGuid(`service-opening:fill:${opening.id}:${fillGuid}`);
      add(`IFCRELFILLSELEMENT('${fillRelationGuid}',#${ownerHistory},$,$,#${openingRef},#${fillRef})`);
    }
    exported.push({ sourceOpeningId: opening.id, openingGuid, voidRelationGuid, fillRelationGuid, hostGuid, centerMm: [...opening.centerMm] as V3, axis, cutDiameterMm: opening.cutDiameterMm, depthMm: opening.depthMm });
  }
  const marker = input.ifcSource.lastIndexOf('ENDSEC;');
  if (marker < 0) throw new Error('invalid_ifc_data_section');
  return { ifcSource: `${input.ifcSource.slice(0, marker).trimEnd()}\n${lines.join('\n')}\n${input.ifcSource.slice(marker)}`, openings: exported };
}
