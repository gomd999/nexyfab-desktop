import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { ifcToNexyfabAssembly } from '../../src/lib/brep-bridge/ifcImport';
import { analyzeIfcSpatialStructure } from '../../src/lib/reference/ifcSpatialStructure';
import { analyzeIfcOccurrenceRecoveryEvidence, planIfcGeometryRecovery } from '../../src/lib/reference/ifcGeometryRecoveryPolicy';
import { snapshotIfcSemantics } from '../../src/lib/reference/ifcSemanticEvidence';
import { buildIfcAlignmentIr, buildIfcStructuralIr } from '../../src/lib/reference/ifcDomainIr';

type Status = 'pass' | 'fail' | 'not_run' | 'error';
const IFC_IMPORT_LIMIT_BYTES = 300_000_000;

async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile() && extname(item.name).toLowerCase() === '.ifc') out.push(path);
    }
  };
  await walk(root); return out.sort((a, b) => a.localeCompare(b, 'en'));
}

async function main(args = process.argv.slice(2)): Promise<number> {
  const rootAt = args.indexOf('--root'), outputAt = args.indexOf('--output');
  if (rootAt < 0 || outputAt < 0 || !args[rootAt + 1] || !args[outputAt + 1]) {
    process.stderr.write('usage: tsx scripts/reference/run-ifc-spatial-baseline.ts --root <corpus> --output <summary.json>\n'); return 2;
  }
  const root = resolve(args[rootAt + 1]!); const output = resolve(args[outputAt + 1]!);
  const selected = await files(root); const counts: Record<Status, number> = { pass: 0, fail: 0, not_run: 0, error: 0 };
  const failureCodes: Record<string, number> = {}; const unresolvedPlacementClasses: Record<string, number> = {}; const incompleteGeometryReasons: Record<string, number> = {}; const incompleteGeometryClasses: Record<string, number> = {}; const recoveryActions: Record<string, number> = {}; const results: unknown[] = [];
  const semanticTotals = { occurrences: 0, definitions: 0, propertyDefinitions: 0, quantityDefinitions: 0, materialDefinitions: 0, georeferenceEntities: 0, duplicateGlobalIds: 0, disconnectedOccurrences: 0 };
  for (const path of selected) {
    try {
      const bytes = await readFile(path); const sha256 = createHash('sha256').update(bytes).digest('hex');
      // Keep this aligned with ifcToNexyfabAssembly. The old 128 MiB gate ran
      // after readFile(), so it saved no read memory and rejected valid inputs
      // that the deterministic importer is explicitly designed to analyze.
      if (bytes.byteLength > IFC_IMPORT_LIMIT_BYTES) { counts.not_run++; failureCodes.BYTE_BUDGET_EXCEEDED = (failureCodes.BYTE_BUDGET_EXCEEDED ?? 0) + 1; results.push({ id: sha256.slice(0, 16), sha256, bytes: bytes.byteLength, status: 'not_run', failureCodes: ['BYTE_BUDGET_EXCEEDED'] }); continue; }
      const source = bytes.toString('latin1'); const spatial = analyzeIfcSpatialStructure(source); const semantics = snapshotIfcSemantics(source); const geometry = ifcToNexyfabAssembly(source, { name: sha256.slice(0, 16), maxParts: 20_000 });
      if ((geometry.stats?.authoritativeThicknessRecoveries ?? 0) > 0) recoveryActions.quantity_volume_area_thickness = (recoveryActions.quantity_volume_area_thickness ?? 0) + geometry.stats!.authoritativeThicknessRecoveries!;
      const disconnectedOccurrences = semantics.occurrences.filter(item => item.parentGlobalId === null && item.ifcClass !== 'IFCPROJECT').length;
      semanticTotals.occurrences += semantics.occurrences.length; semanticTotals.definitions += semantics.definitions.length;
      semanticTotals.propertyDefinitions += semantics.definitions.filter(item => item.kind === 'property').length;
      semanticTotals.quantityDefinitions += semantics.definitions.filter(item => item.kind === 'quantity').length;
      semanticTotals.materialDefinitions += semantics.definitions.filter(item => item.kind === 'material').length;
      semanticTotals.georeferenceEntities += semantics.georeference.length; semanticTotals.duplicateGlobalIds += semantics.duplicateGlobalIds.length; semanticTotals.disconnectedOccurrences += disconnectedOccurrences;
      for (const node of spatial.nodes.filter(item => ['missing', 'invalid', 'unsupported', 'cycle'].includes(item.placementStatus))) {
        unresolvedPlacementClasses[node.ifcClass] = (unresolvedPlacementClasses[node.ifcClass] ?? 0) + 1;
      }
      let status: Status;
      const geometryIncomplete = geometry.ok && (geometry.stats?.imported ?? 0) < (geometry.stats?.elements ?? 0);
      const specializedDomainIr = /IFCALIGNMENT\s*\(/i.test(source) ? buildIfcAlignmentIr(source) : /IFCSTRUCTURALANALYSISMODEL\s*\(/i.test(source) ? buildIfcStructuralIr(source) : null;
      const specializedDomainWithoutAdapter = spatial.elementCount === 0 && specializedDomainIr !== null && !specializedDomainIr.valid;
      if (geometryIncomplete) for (const [key, count] of Object.entries(geometry.stats?.skipByClass ?? {})) {
        const separator = key.lastIndexOf(':'); const reason = key.slice(separator + 1); const ifcClass = key.slice(0, separator);
        if (!['spatial', 'aggregate', 'placeholder', 'reference'].includes(reason)) { incompleteGeometryReasons[reason] = (incompleteGeometryReasons[reason] ?? 0) + count; incompleteGeometryClasses[ifcClass] = (incompleteGeometryClasses[ifcClass] ?? 0) + count; }
      }
      if (geometryIncomplete) {
        const dimensionEvidence = geometry.stats?.dimensionEvidence ?? []; const scoped = analyzeIfcOccurrenceRecoveryEvidence(source, dimensionEvidence.map(item => item.entityId));
        for (const item of dimensionEvidence) {
          const evidence = scoped.get(item.entityId) ?? { hasMaterialLayerUsage: false, hasProfileDefinition: false, hasTypeRelationship: false };
          const recovery = planIfcGeometryRecovery({ ifcClass: item.ifcClass, dimensions: item.dimensions, ...evidence, evidenceScopedToOccurrence: true, typeGeometryAlreadyTried: true });
          recoveryActions[recovery.action] = (recoveryActions[recovery.action] ?? 0) + 1;
        }
      }
      if (!spatial.schema || spatial.nodes.length === 0) status = 'fail';
      else if (semantics.duplicateGlobalIds.length > 0) { status = 'fail'; failureCodes.IFC_DUPLICATE_GLOBAL_ID = (failureCodes.IFC_DUPLICATE_GLOBAL_ID ?? 0) + 1; }
      else if (spatial.unresolvedPlacementCount > 0 || spatial.cycleCount > 0) status = 'not_run';
      else if (spatial.elementCount === 0 && (specializedDomainIr === null || specializedDomainIr.valid)) status = 'pass';
      else if (specializedDomainWithoutAdapter || !geometry.ok) { status = 'not_run'; failureCodes.UNSUPPORTED_ENTITY = (failureCodes.UNSUPPORTED_ENTITY ?? 0) + 1; }
      else if (geometryIncomplete) { status = 'not_run'; failureCodes.GEOMETRY_INCOMPLETE = (failureCodes.GEOMETRY_INCOMPLETE ?? 0) + 1; }
      else status = 'pass';
      counts[status]++;
      for (const code of spatial.failureCodes) failureCodes[code] = (failureCodes[code] ?? 0) + 1;
      results.push({
        id: sha256.slice(0, 16), sha256, bytes: bytes.byteLength, status, schema: spatial.schema,
        spatial: spatial.spatialCount, elements: spatial.elementCount, related: spatial.relatedCount,
        placements: { available: spatial.availablePlacementCount, unresolved: spatial.unresolvedPlacementCount, unsupported: spatial.unsupportedPlacementCount, optionalSpatialOmitted: spatial.optionalSpatialPlacementOmittedCount, cycles: spatial.cycleCount,linear:spatial.linearPlacementEvidence },
        geometry: { elements: geometry.stats?.elements ?? 0, imported: geometry.assembly?.parts.length ?? 0, exact: geometry.stats?.exact ?? 0, approx: geometry.stats?.approx ?? 0, skipped: geometry.stats?.skipped ?? 0, authoritativeThicknessRecoveries: geometry.stats?.authoritativeThicknessRecoveries ?? 0, representative: geometry.stats?.representative ?? false, definitionOnly: geometry.assembly?.definitionOnly ?? false, skipByClass: geometry.stats?.skipByClass ?? {}, dimensionSamples: geometry.stats?.dimensionSamples ?? {}, dimensionEvidenceCount: geometry.stats?.dimensionEvidence?.length ?? 0 },
        semantics: { occurrences: semantics.occurrences.length, definitions: semantics.definitions.length, byKind: { property: semantics.definitions.filter(item => item.kind === 'property').length, quantity: semantics.definitions.filter(item => item.kind === 'quantity').length, material: semantics.definitions.filter(item => item.kind === 'material').length }, georeferenceEntities: semantics.georeference.length, duplicateGlobalIds: semantics.duplicateGlobalIds.length, disconnectedOccurrences },
        specializedDomain: specializedDomainIr?.kind === 'alignment' ? { kind: specializedDomainIr.kind, valid: specializedDomainIr.valid, errors: specializedDomainIr.errors, horizontalSegments: specializedDomainIr.horizontal.length, verticalSegments: specializedDomainIr.vertical.length, cantSegments: specializedDomainIr.cant.length, continuity: specializedDomainIr.continuity, horizontalEvaluation:specializedDomainIr.horizontalEvaluation, georeferenced: specializedDomainIr.georeferenced } : specializedDomainIr ? { kind: specializedDomainIr.kind, valid: specializedDomainIr.valid, errors: specializedDomainIr.errors, nodes: specializedDomainIr.nodes.length, members: specializedDomainIr.members.length, activities: specializedDomainIr.activities, reactions: specializedDomainIr.reactions, loads: specializedDomainIr.loads, normalizedLoadRecords: specializedDomainIr.normalizedLoads.length, unresolvedLoadUnits: specializedDomainIr.normalizedLoads.filter(item => !item.normalized).length, unitFactors: specializedDomainIr.unitFactors } : null,
        failureCodes: [...spatial.failureCodes, ...(semantics.duplicateGlobalIds.length ? ['IFC_DUPLICATE_GLOBAL_ID'] : []), ...(!geometry.ok && !specializedDomainIr?.valid ? ['UNSUPPORTED_ENTITY'] : []), ...(geometryIncomplete ? ['GEOMETRY_INCOMPLETE'] : [])],
      });
    } catch { counts.error++; results.push({ id: `error-${results.length + 1}`, status: 'error', code: 'ANALYSIS_ERROR' }); }
  }
  const report = { schema: 'nexyfab.ifc-spatial-baseline.v2', selected: selected.length, counts, failureCodes, unresolvedPlacementClasses, incompleteGeometryReasons, incompleteGeometryClasses, recoveryActions, semanticTotals, results, sourceDisclosure: false, quoteOrRfqSideEffects: false };
  await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ schema: report.schema, selected: report.selected, counts, failureCodes, unresolvedPlacementClasses, incompleteGeometryReasons, incompleteGeometryClasses, recoveryActions, semanticTotals, sourceDisclosure: false, quoteOrRfqSideEffects: false })}\n`);
  return counts.error > 0 ? 6 : counts.fail > 0 ? 5 : counts.not_run > 0 ? 4 : 0;
}

void main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
