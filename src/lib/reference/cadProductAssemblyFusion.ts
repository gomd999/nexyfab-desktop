import path from 'node:path';
import type { CadProductBundleManifest, CadProductBundleMember } from './cadCorpusProductBundle';
import { validateCadNativeAssemblyEvidence, type CadNativeAssemblyEvidence } from './cadNativeAssemblyEvidence';

export interface CadAssemblyFusionDefinition { id: string; displayName: string; meshMembers: string[]; nativePartMembers: string[]; occurrenceCount: number; }
export interface CadMeshOccurrenceEvidenceRecord { relativePath: string; sourceSha256?: string; status: 'pass' | 'fail' | 'not_run'; fidelity?: string; triangleCount?: number; volumeMm3?: number; areaMm2?: number; aabbMm?: unknown; centroidMm?: number[]; error?: string; }
export interface CadMeshOccurrenceEvidence { schema: 'nexyfab.cad-mesh-occurrence-evidence.v1'; lineageId: string; records: CadMeshOccurrenceEvidenceRecord[]; }
export interface CadAssemblyFusionOccurrence { id: string; definitionId: string; sourceMember: string; sourceOccurrenceOrdinal: number | null; transformStatus: 'not_run'; geometryEvidenceStatus: 'pass' | 'fail' | 'not_run'; geometryFidelity: string | null; }
export interface CadProductAssemblyFusionResult {
  schema: 'nexyfab.cad-assembly-fusion.v1'; status: 'pass' | 'fail' | 'not_run'; releaseReady: false;
  lineageId: string; definitions: CadAssemblyFusionDefinition[]; occurrences: CadAssemblyFusionOccurrence[];
  authoritativeBodyCount: number | null; mappedMeshOccurrenceCount: number; unmatchedAuthoritativeBodyCount: number | null;
  bodyMembershipStatus: 'pass' | 'fail' | 'not_run'; nativeAssemblyMemberCount: number; nativeAssemblyExtractionStatus: 'pass' | 'fail' | 'not_run'; nativeOccurrenceCount: number; nativeJointCount: number; meshEvidenceStatus: 'pass' | 'fail' | 'not_run'; errors: string[]; warnings: string[];
}

const stem = (member: CadProductBundleMember) => path.basename(member.relativePath, path.extname(member.relativePath));
function semanticName(value: string): { key: string; displayName: string; ordinal: number | null } {
  let name = value.replace(/^part\s+\d+\s*-\s*final assembly\s*-\s*/i, '').trim();
  const ordinalMatch = name.match(/(?:[-.]|\s)(\d+)$/);
  const ordinal = ordinalMatch ? Number(ordinalMatch[1]) : null;
  if (ordinalMatch) name = name.slice(0, ordinalMatch.index).trim();
  name = name.replace(/\s+/g, ' ').trim();
  const key = name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim();
  return { key: key || 'unnamed', displayName: name || value, ordinal };
}

export function buildCadProductAssemblyFusion(input: { bundle: CadProductBundleManifest; authoritativeBodyCount?: number; meshEvidence?: CadMeshOccurrenceEvidence; nativeAssemblyEvidence?: CadNativeAssemblyEvidence }): CadProductAssemblyFusionResult {
  const bodyCount = input.authoritativeBodyCount;
  if (bodyCount !== undefined && (!Number.isInteger(bodyCount) || bodyCount < 0)) throw new Error('invalid_authoritative_body_count');
  const meshes = input.bundle.members.filter(member => member.role === 'mesh_part');
  const nativeParts = input.bundle.members.filter(member => member.role === 'native_part');
  const nativeAssemblies = input.bundle.members.filter(member => member.role === 'native_assembly');
  const groups = new Map<string, { displayName: string; meshes: Array<{ member: CadProductBundleMember; ordinal: number | null }>; nativeParts: CadProductBundleMember[] }>();
  for (const member of meshes) { const parsed = semanticName(stem(member)); const group = groups.get(parsed.key) ?? { displayName: parsed.displayName, meshes: [], nativeParts: [] }; group.meshes.push({ member, ordinal: parsed.ordinal }); groups.set(parsed.key, group); }
  for (const member of nativeParts) { const parsed = semanticName(stem(member)); const group = groups.get(parsed.key) ?? { displayName: parsed.displayName, meshes: [], nativeParts: [] }; group.nativeParts.push(member); groups.set(parsed.key, group); }
  const evidenceByPath = new Map(input.meshEvidence?.records.map(record => [record.relativePath, record]) ?? []);
  const definitions: CadAssemblyFusionDefinition[] = [], occurrences: CadAssemblyFusionOccurrence[] = [];
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const id = `definition:${key.replaceAll(' ', '-')}`;
    const orderedMeshes = [...group.meshes].sort((a, b) => a.member.relativePath.localeCompare(b.member.relativePath));
    definitions.push({ id, displayName: group.displayName, meshMembers: orderedMeshes.map(item => item.member.relativePath), nativePartMembers: group.nativeParts.map(member => member.relativePath).sort(), occurrenceCount: orderedMeshes.length });
    for (let index = 0; index < orderedMeshes.length; index++) {
      const member = orderedMeshes[index]!.member, evidence = evidenceByPath.get(member.relativePath);
      const geometryEvidenceStatus = !evidence ? 'not_run' : evidence.sourceSha256 !== member.sha256 ? 'fail' : evidence.status;
      occurrences.push({ id: `occurrence:${id.slice(11)}:${index + 1}`, definitionId: id, sourceMember: member.relativePath, sourceOccurrenceOrdinal: orderedMeshes[index]!.ordinal, transformStatus: 'not_run', geometryEvidenceStatus, geometryFidelity: evidence?.fidelity ?? null });
    }
  }
  const unmatched = bodyCount === undefined ? null : Math.max(0, bodyCount - occurrences.length);
  const errors: string[] = [], warnings: string[] = [];
  const nativeValidation = validateCadNativeAssemblyEvidence(input.bundle, input.nativeAssemblyEvidence);
  if (!meshes.length) errors.push('mesh_occurrences_missing');
  if (!nativeAssemblies.length) errors.push('native_assembly_missing');
  else if (nativeValidation.status === 'not_run') errors.push('native_assembly_extractor_not_run');
  else if (nativeValidation.status === 'fail') errors.push(...nativeValidation.errors);
  warnings.push(...nativeValidation.warnings);
  if (input.meshEvidence && input.meshEvidence.lineageId !== input.bundle.lineageId) errors.push('mesh_evidence_lineage_mismatch');
  const meshEvidenceStatus = occurrences.some(item => item.geometryEvidenceStatus === 'fail') ? 'fail' : occurrences.length > 0 && occurrences.every(item => item.geometryEvidenceStatus === 'pass') ? 'pass' : 'not_run';
  if (!input.meshEvidence) errors.push('mesh_occurrence_evidence_not_run');
  else if (meshEvidenceStatus === 'fail') errors.push('mesh_occurrence_evidence_failed');
  else if (meshEvidenceStatus === 'not_run') warnings.push('mesh_occurrence_evidence_incomplete');
  const bodyMembershipStatus = bodyCount === undefined || bodyCount > occurrences.length ? 'not_run' : bodyCount < occurrences.length ? 'fail' : 'pass';
  if (bodyCount !== undefined && bodyCount > occurrences.length) warnings.push(`compound_part_body_membership_not_run:${bodyCount}/${occurrences.length}`);
  if (bodyCount !== undefined && bodyCount < occurrences.length) errors.push(`authoritative_body_count_insufficient:${bodyCount}/${occurrences.length}`);
  if (definitions.some(definition => !definition.meshMembers.length || !definition.nativePartMembers.length)) warnings.push('definition_source_pairing_incomplete');
  warnings.push('mesh_occurrence_transforms_not_authoritative');
  const hardFailure = bodyMembershipStatus === 'fail' || meshEvidenceStatus === 'fail' || nativeValidation.status === 'fail' || errors.some(error => error.includes('lineage_mismatch') || error === 'mesh_occurrences_missing');
  return { schema: 'nexyfab.cad-assembly-fusion.v1', status: hardFailure ? 'fail' : 'not_run', releaseReady: false, lineageId: input.bundle.lineageId, definitions, occurrences, authoritativeBodyCount: bodyCount ?? null, mappedMeshOccurrenceCount: occurrences.length, unmatchedAuthoritativeBodyCount: unmatched, bodyMembershipStatus, nativeAssemblyMemberCount: nativeAssemblies.length, nativeAssemblyExtractionStatus: nativeValidation.status, nativeOccurrenceCount: input.nativeAssemblyEvidence?.occurrences.length ?? 0, nativeJointCount: input.nativeAssemblyEvidence?.joints.length ?? 0, meshEvidenceStatus, errors, warnings };
}
