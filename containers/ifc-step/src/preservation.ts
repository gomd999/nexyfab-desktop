import { createHash } from 'node:crypto';
import type { OcctDetailedShapeInspection } from '../../../src/lib/occt/bridge';
import { detectStepUnits } from '../../../src/lib/brep-bridge/stepRead';
import { probeStepStructure } from '../../../src/lib/brep-bridge/stepStructureProbe';
import { analyzeStepAssemblyPlacements } from '../../../src/lib/reference/stepAssemblyEvidence';
import { snapshotIfcDeepSemantics } from '../../../src/lib/bim/ifcDeepSemanticRoundtrip';
import {
  CAD_INTEROP_AXES,
  buildCadInteropPreservationReceipt,
  type CadInteropAxisEvidence,
  type CadInteropPreservationReceipt,
} from '../../../packages/cad-contracts/src/index';
import type { IfcImportResult } from '../../../src/lib/brep-bridge/ifcImport';

type State = CadInteropAxisEvidence['state'];

function axis(
  name: CadInteropAxisEvidence['axis'],
  required: boolean,
  state: State,
  method: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  reasons: string[] = [],
  tolerance: Record<string, number> | null = null,
): CadInteropAxisEvidence {
  return { axis: name, required, state, method, before, after, tolerance, reasons };
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function bboxValues(inspection: OcctDetailedShapeInspection): number[] {
  const { min, max } = inspection.bbox;
  return [min.x, min.y, min.z, max.x, max.y, max.z];
}

function maxDelta(left: number[], right: number[]): number {
  return left.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - right[index]!)), 0);
}

export function buildStepPreservationReceipt(input: {
  source: string;
  result: string;
  sourceContentSha256: string;
  resultContentSha256: string;
  sourceInspection: OcctDetailedShapeInspection;
  resultInspection: OcctDetailedShapeInspection;
  mode: 'OCCT_REEXPORT' | 'VERIFIED_BYTE_PRESERVING_ASSEMBLY';
}): CadInteropPreservationReceipt {
  const methodMode = input.mode === 'OCCT_REEXPORT'
    ? 'OCCT STEP reader/writer re-export'
    : 'OCCT-validated byte-preserving assembly federation';
  const sourceUnit = detectStepUnits(input.source);
  const resultUnit = detectStepUnits(input.result);
  const sourceBbox = bboxValues(input.sourceInspection);
  const resultBbox = bboxValues(input.resultInspection);
  const coordinateDeltaMm = maxDelta(sourceBbox, resultBbox);
  const coordinateToleranceMm = Math.max(1e-6, ...sourceBbox.map(value => Math.abs(value) * 1e-9));
  const volumeDeltaMm3 = Math.abs(input.sourceInspection.absoluteVolume - input.resultInspection.absoluteVolume);
  const volumeToleranceMm3 = Math.max(1e-6, input.sourceInspection.absoluteVolume * 1e-9);
  const sourceAssembly = probeStepStructure(new TextEncoder().encode(input.source).buffer as ArrayBuffer);
  const resultAssembly = probeStepStructure(new TextEncoder().encode(input.result).buffer as ArrayBuffer);
  const sourcePlacements = analyzeStepAssemblyPlacements(input.source);
  const resultPlacements = analyzeStepAssemblyPlacements(input.result);
  const assemblyRequired = sourceAssembly.isAssembly;
  const sourceAssemblyMeasurable = assemblyRequired
    && sourcePlacements.sourceOccurrenceCount > 0
    && sourcePlacements.missingTransformCount === 0
    && sourcePlacements.invalidTransformCount === 0;
  const assemblyPass = sourceAssemblyMeasurable
    && resultAssembly.isAssembly
    && sourcePlacements.sourceOccurrenceCount === resultPlacements.sourceOccurrenceCount
    && resultPlacements.missingTransformCount === 0
    && resultPlacements.invalidTransformCount === 0;
  const sourcePmi = {
    semantic: count(input.source, /\b(?:DATUM|DIMENSIONAL_(?:SIZE|LOCATION)|[A-Z_]+_TOLERANCE)\s*\(/gi),
    graphical: count(input.source, /\b(?:DRAUGHTING_CALLOUT|(?:TESSELLATED_)?ANNOTATION_OCCURRENCE)\s*\(/gi),
  };
  const resultPmi = {
    semantic: count(input.result, /\b(?:DATUM|DIMENSIONAL_(?:SIZE|LOCATION)|[A-Z_]+_TOLERANCE)\s*\(/gi),
    graphical: count(input.result, /\b(?:DRAUGHTING_CALLOUT|(?:TESSELLATED_)?ANNOTATION_OCCURRENCE)\s*\(/gi),
  };
  const pmiRequired = sourcePmi.semantic + sourcePmi.graphical > 0;
  const sourceMaterial = count(input.source, /\b(?:MATERIAL_DESIGNATION|PROPERTY_DEFINITION_REPRESENTATION)\s*\(/gi);
  const resultMaterial = count(input.result, /\b(?:MATERIAL_DESIGNATION|PROPERTY_DEFINITION_REPRESENTATION)\s*\(/gi);
  const materialRequired = sourceMaterial > 0;
  const topologyPass = input.sourceInspection.solidCount === input.resultInspection.solidCount
    && input.sourceInspection.faceCount === input.resultInspection.faceCount
    && input.sourceInspection.edgeCount === input.resultInspection.edgeCount
    && volumeDeltaMm3 <= volumeToleranceMm3;
  const axes: CadInteropAxisEvidence[] = [
    axis('units', true,
      sourceUnit.confidence === 'high' && resultUnit.confidence === 'high' ? 'PASS' : 'NOT_RUN',
      `STEP declared-unit detection plus ${methodMode} physical-size comparison`,
      { declared: sourceUnit.unit, confidence: sourceUnit.confidence },
      { declared: resultUnit.unit, confidence: resultUnit.confidence },
      sourceUnit.confidence === 'high' && resultUnit.confidence === 'high' ? [] : ['step_declared_unit_evidence_incomplete']),
    axis('coordinate', true, coordinateDeltaMm <= coordinateToleranceMm ? 'PASS' : 'FAIL',
      `${methodMode} source/result bounding coordinates`, { bboxMm: sourceBbox }, { bboxMm: resultBbox, maximumDeltaMm: coordinateDeltaMm },
      coordinateDeltaMm <= coordinateToleranceMm ? [] : ['step_coordinate_bounds_changed'], { maximumDeltaMm: coordinateToleranceMm }),
    axis('topology', true, topologyPass ? 'PASS' : 'FAIL',
      `${methodMode} exact solid/face/edge/volume re-import`,
      { solids: input.sourceInspection.solidCount, faces: input.sourceInspection.faceCount, edges: input.sourceInspection.edgeCount, volumeMm3: input.sourceInspection.absoluteVolume },
      { solids: input.resultInspection.solidCount, faces: input.resultInspection.faceCount, edges: input.resultInspection.edgeCount, volumeMm3: input.resultInspection.absoluteVolume, volumeDeltaMm3 },
      topologyPass ? [] : ['step_exact_topology_or_volume_changed'], { maximumVolumeDeltaMm3: volumeToleranceMm3 }),
    axis('assembly', assemblyRequired,
      !assemblyRequired || !sourceAssemblyMeasurable ? 'NOT_RUN' : (assemblyPass ? 'PASS' : 'FAIL'),
      `${methodMode} Part 21 NAUO hierarchy and rigid placement comparison`,
      { isAssembly: sourceAssembly.isAssembly, occurrences: sourcePlacements.sourceOccurrenceCount },
      { isAssembly: resultAssembly.isAssembly, occurrences: resultPlacements.sourceOccurrenceCount, missingTransforms: resultPlacements.missingTransformCount, invalidTransforms: resultPlacements.invalidTransformCount },
      !assemblyRequired ? ['source_contains_no_step_assembly']
        : !sourceAssemblyMeasurable ? ['source_step_assembly_placement_evidence_incomplete']
          : assemblyPass ? [] : ['step_assembly_hierarchy_or_placement_not_preserved']),
    axis('pmi', pmiRequired, pmiRequired ? (JSON.stringify(sourcePmi) === JSON.stringify(resultPmi) ? 'PASS' : 'FAIL') : 'NOT_RUN',
      `${methodMode} bounded AP242 semantic/graphical PMI entity counts`, sourcePmi, resultPmi,
      pmiRequired ? (JSON.stringify(sourcePmi) === JSON.stringify(resultPmi) ? [] : ['step_pmi_entity_counts_changed']) : ['source_contains_no_supported_pmi']),
    axis('material', materialRequired, materialRequired ? (sourceMaterial === resultMaterial ? 'PASS' : 'FAIL') : 'NOT_RUN',
      `${methodMode} bounded STEP material/property relationship counts`, { relationships: sourceMaterial }, { relationships: resultMaterial },
      materialRequired ? (sourceMaterial === resultMaterial ? [] : ['step_material_relationships_changed']) : ['source_contains_no_supported_material_relationship']),
  ];
  if (axes.map(item => item.axis).join(',') !== CAD_INTEROP_AXES.join(',')) throw new Error('step_interop_axis_order_invalid');
  return buildCadInteropPreservationReceipt({
    sourceFormat: 'STEP', resultFormat: 'STEP', sourceContentSha256: input.sourceContentSha256,
    resultContentSha256: input.resultContentSha256, axes, unsupportedReasons: [],
  });
}

export function buildIfcPreservationArtifacts(input: {
  source: string;
  sourceContentSha256: string;
  imported: IfcImportResult;
}): { irBytes: Buffer; receipt: CadInteropPreservationReceipt } {
  if (!input.imported.ok || !input.imported.assembly || !input.imported.stats) throw new Error('ifc_import_result_required');
  const snapshot = snapshotIfcDeepSemantics(input.source);
  const unitMatch = input.source.match(/IFCSIUNIT\s*\([^;]*\.LENGTHUNIT\.[^;]*\)/i);
  const partsFinite = input.imported.assembly.parts.every(part =>
    [part.at.tx, part.at.ty, part.at.tz, part.at.rz ?? 0].every(Number.isFinite));
  const ir = {
    schema: 'nexyfab.ifc-federation-ir.v1',
    sourceContentSha256: input.sourceContentSha256,
    canonicalLengthUnit: 'mm',
    sourceUnitScaleToMm: input.imported.stats.unitScale,
    semantics: snapshot,
    assembly: input.imported.assembly,
    stats: input.imported.stats,
  };
  const exactTopologyParts = input.imported.assembly.parts.filter(part =>
    part.geometryEvidence === 'exact_extrusion_box'
      || (part.geometryEvidence === 'exact_surface_mesh'
        && part.type === 'mesh'
        && part.meshVolumeExact === true
        && part.closureEvidence?.watertight === true
        && part.closureEvidence.boundaryEdges === 0
        && 'verts' in part.params
        && Array.isArray(part.params.verts)
        && 'faces' in part.params
        && Array.isArray(part.params.faces)));
  const exactTopology = input.imported.stats.imported > 0
    && exactTopologyParts.length === input.imported.assembly.parts.length;
  const coordinateMeasured = snapshot.placements.length > 0;
  const coordinatePass = coordinateMeasured && snapshot.unresolvedPlacementGlobalIds.length === 0 && partsFinite;
  const assemblyMeasured = snapshot.occurrences.length > 0;
  const assemblyPass = assemblyMeasured && snapshot.duplicateGlobalIds.length === 0;
  const materialCount = count(input.source, /\bIFC(?:RELASSOCIATESMATERIAL|MATERIAL(?:LAYERSET|PROFILESET|CONSTITUENTSET)?)\s*\(/gi);
  const axes: CadInteropAxisEvidence[] = [
    axis('units', true, unitMatch ? 'PASS' : 'NOT_RUN', 'IFC LENGTHUNIT declaration and canonical mm scale',
      unitMatch ? { declaration: unitMatch[0], scaleToMm: input.imported.stats.unitScale } : null,
      { canonicalLengthUnit: 'mm' }, unitMatch ? [] : ['ifc_length_unit_declaration_missing']),
    axis('coordinate', true, coordinateMeasured ? (coordinatePass ? 'PASS' : 'FAIL') : 'NOT_RUN',
      'IFC local placement world transforms embedded in federation IR',
      { placements: snapshot.placements.length, unresolved: snapshot.unresolvedPlacementGlobalIds },
      { embeddedPlacements: snapshot.placements.length, finiteImportedPlacements: partsFinite },
      coordinateMeasured ? (coordinatePass ? [] : ['ifc_coordinate_placement_unresolved']) : ['ifc_coordinate_placement_evidence_missing']),
    axis('topology', true, exactTopology ? 'PASS' : 'FAIL', 'IFC exact extrusion or watertight indexed-surface topology classification',
      { imported: input.imported.stats.imported, legacyExact: input.imported.stats.exact, legacyApproximate: input.imported.stats.approx },
      { exactTopologyParts: exactTopologyParts.length, totalParts: input.imported.assembly.parts.length }, exactTopology ? [] : ['ifc_topology_contains_aabb_or_open_surface_approximation']),
    axis('assembly', true, assemblyMeasured ? (assemblyPass ? 'PASS' : 'FAIL') : 'NOT_RUN',
      'IFC occurrence hierarchy snapshot embedded in federation IR',
      { occurrences: snapshot.occurrences.length, duplicateGlobalIds: snapshot.duplicateGlobalIds },
      { embeddedOccurrences: snapshot.occurrences.length }, assemblyMeasured ? (assemblyPass ? [] : ['ifc_occurrence_identity_invalid']) : ['ifc_occurrence_hierarchy_evidence_missing']),
    axis('pmi', false, 'NOT_RUN', 'IFC-to-AP242 PMI mapping', null, null, ['ifc_pmi_mapping_not_implemented']),
    axis('material', materialCount > 0, materialCount > 0 ? 'PASS' : 'NOT_RUN', 'IFC property/material definitions embedded in federation IR',
      { relationships: materialCount }, { embeddedRelationships: materialCount }, materialCount > 0 ? [] : ['ifc_material_evidence_missing']),
  ];
  const irBytes = Buffer.from(`${JSON.stringify(ir, null, 2)}\n`);
  return {
    irBytes,
    receipt: buildCadInteropPreservationReceipt({
      sourceFormat: 'IFC', resultFormat: 'NEXYFAB_IR', sourceContentSha256: input.sourceContentSha256,
      resultContentSha256: createHash('sha256').update(irBytes).digest('hex'), axes, unsupportedReasons: [],
    }),
  };
}
