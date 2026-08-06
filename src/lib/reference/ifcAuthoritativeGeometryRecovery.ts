import { ifcToNexyfabAssembly, type IfcAuthoritativeGeometryOverride, type IfcImportResult } from '@/lib/brep-bridge/ifcImport';
import { buildIfcGeometryRecoveryRequests, type IfcGeometryRecoveryRequest } from './ifcGeometryRecoveryRequests';

export interface IfcAuthoritativeGeometryInput {
  globalId: string;
  physicalWidthMm: number;
  provenance: string;
}

export interface IfcRejectedGeometryInput {
  globalId: string | null;
  code: 'DUPLICATE_GLOBAL_ID' | 'INVALID_GLOBAL_ID' | 'INVALID_WIDTH' | 'PROVENANCE_REQUIRED' | 'OCCURRENCE_NOT_REQUESTED' | 'AMBIGUOUS_MISSING_AXIS';
}

export interface IfcAuthoritativeRecoveryResult {
  ok: boolean;
  releaseReady: boolean;
  assembly?: IfcImportResult['assembly'];
  stats?: IfcImportResult['stats'];
  applied: NonNullable<NonNullable<IfcImportResult['stats']>['appliedAuthoritativeInputs']>;
  rejected: IfcRejectedGeometryInput[];
  remainingRequests: IfcGeometryRecoveryRequest[];
  errors: string[];
}

const IFC_GUID = /^[0-9A-Za-z_$]{22}$/;

/** Validates operator-supplied dimensions against an exact occurrence request before import. */
export function recoverIfcGeometryWithAuthoritativeInputs(source: string, inputs: IfcAuthoritativeGeometryInput[]): IfcAuthoritativeRecoveryResult {
  const plan = buildIfcGeometryRecoveryRequests(source);
  const requestedByGlobalId = new Map(plan.requests.filter(request => request.globalId).map(request => [request.globalId!, request]));
  const seen = new Set<string>(), rejected: IfcRejectedGeometryInput[] = [], approved: IfcAuthoritativeGeometryOverride[] = [];

  for (const raw of inputs) {
    const globalId = typeof raw?.globalId === 'string' ? raw.globalId.trim() : '';
    if (!IFC_GUID.test(globalId)) { rejected.push({ globalId: globalId || null, code: 'INVALID_GLOBAL_ID' }); continue; }
    if (seen.has(globalId)) { rejected.push({ globalId, code: 'DUPLICATE_GLOBAL_ID' }); continue; }
    seen.add(globalId);
    if (!Number.isFinite(raw.physicalWidthMm) || raw.physicalWidthMm <= 0.5) { rejected.push({ globalId, code: 'INVALID_WIDTH' }); continue; }
    if (typeof raw.provenance !== 'string' || raw.provenance.trim().length < 3) { rejected.push({ globalId, code: 'PROVENANCE_REQUIRED' }); continue; }
    const request = requestedByGlobalId.get(globalId);
    if (!request) { rejected.push({ globalId, code: 'OCCURRENCE_NOT_REQUESTED' }); continue; }
    if (request.missingAxes.length !== 1) { rejected.push({ globalId, code: 'AMBIGUOUS_MISSING_AXIS' }); continue; }
    approved.push({ globalId, axis: request.missingAxes[0]!, valueMm: raw.physicalWidthMm, provenance: raw.provenance.trim() });
  }

  const imported = ifcToNexyfabAssembly(source, { maxParts: 20_000, authoritativeGeometryOverrides: approved });
  const applied = imported.stats?.appliedAuthoritativeInputs ?? [], appliedIds = new Set(applied.map(value => value.globalId));
  for (const override of approved) if (!appliedIds.has(override.globalId)) rejected.push({ globalId: override.globalId, code: 'OCCURRENCE_NOT_REQUESTED' });
  const remainingRequests = plan.requests.filter(request => !request.globalId || !appliedIds.has(request.globalId));
  const errors = [...plan.errors, ...(!imported.ok ? [imported.error ?? 'ifc_import_failed'] : [])];
  return { ok: rejected.length === 0 && errors.length === 0, releaseReady: imported.ok && rejected.length === 0 && remainingRequests.length === 0 && errors.length === 0, assembly: imported.assembly, stats: imported.stats, applied, rejected, remainingRequests, errors };
}
