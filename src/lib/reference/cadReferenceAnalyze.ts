import { createHash } from 'node:crypto';
import type { OcctBridge, OcctDetailedShapeInspection, OcctTypeHistogram } from '@/lib/occt/bridge';
import type { OcctShape } from '@/lib/occt/types';
import { createCadTolerancePolicy, type CadLengthUnit, type CadTolerancePolicy, type DeclaredSourceTolerance } from './cadTolerancePolicy';
import { deriveEvidenceStatus, validateCadEvidenceIrV2, type CadEvidenceIrV2, type EvidenceAssertionV2 } from './cadEvidenceIrV2';
import type { StepHeaderRepair } from './stepHeaderNormalizer';
import { analyzeStepAssemblyPlacements, type StepAssemblyPlacementEvidence } from './stepAssemblyEvidence';
import { importStepWithRecovery } from './stepRecoveryPipeline';
import { healImportedOcctShape } from './occtHealingPipeline';

export interface AnalyzeCadReferenceInput {
  format: 'step' | 'stp';
  source: string;
  scenarioId: string;
  lengthUnit: CadLengthUnit;
  declaredSourceTolerance?: DeclaredSourceTolerance;
}

export interface CadReferenceAnalysis {
  evidence: CadEvidenceIrV2;
  tolerancePolicy: CadTolerancePolicy | null;
}

const IDS = ['valid', 'solid-presence', 'counts', 'body-boundaries', 'product-occurrences', 'occurrence-transforms', 'world-placement', 'assembly-cycle-free', 'bbox', 'volume', 'area', 'centroid', 'inertia', 'surface-types', 'curve-types', 'face-adjacency'] as const;
const method = 'OCCT exact B-rep inspection';

function assertion(id: string, status: EvidenceAssertionV2['status'], reason: string, hash: string, measured?: string | number | boolean, unit?: string): EvidenceAssertionV2 {
  return {
    id: `geometry.${id}`, status, method,
    criterion: { description: status === 'not_run' ? 'Exact kernel measurement must be available.' : 'Record the exact kernel measurement without approximation.' },
    ...(measured === undefined ? {} : { measured }), ...(unit === undefined ? {} : { unit }),
    confidence: status === 'not_run' ? 0 : 1, reason, artifactHashes: [hash],
  };
}

function notRunAssertions(reason: string, hash: string): EvidenceAssertionV2[] {
  return IDS.map(id => assertion(id, 'not_run', reason, hash));
}

function histogramAssertion(id: 'surface-types' | 'curve-types', histogram: OcctTypeHistogram, hash: string): EvidenceAssertionV2 {
  return histogram.status === 'not_run'
    ? assertion(id, 'not_run', histogram.reason, hash)
    : assertion(id, 'pass', 'Kernel analytic-type histogram measured.', hash, JSON.stringify(histogram.counts));
}

function assemblyAssertions(assembly: StepAssemblyPlacementEvidence, hash: string): EvidenceAssertionV2[] {
  const summary = JSON.stringify({
    occurrences: assembly.sourceOccurrenceCount,
    available: assembly.availableTransformCount,
    missing: assembly.missingTransformCount,
    invalid: assembly.invalidTransformCount,
    reflections: assembly.reflectionCount,
    nonUniformScale: assembly.nonUniformScaleCount,
  });
  const transforms = assembly.sourceOccurrenceCount === 0
    ? assertion('occurrence-transforms', 'pass', 'The STEP entity graph contains zero assembly occurrences; no body count was substituted.', hash, summary)
    : assembly.invalidTransformCount > 0 || assembly.reflectionCount > 0 || assembly.nonUniformScaleCount > 0
      ? assertion('occurrence-transforms', 'fail', 'One or more occurrence transforms are invalid, reflected, or non-uniformly scaled.', hash, summary)
      : assembly.missingTransformCount > 0
        ? assertion('occurrence-transforms', 'not_run', 'One or more occurrence transforms are absent; identity was not invented for evidence.', hash, summary)
        : assertion('occurrence-transforms', 'pass', 'Every STEP occurrence has a valid rigid local-to-parent transform.', hash, summary);
  const world = assembly.sourceOccurrenceCount === 0
    ? assertion('world-placement', 'pass', 'No assembly occurrences require world placement.', hash, 0, 'count')
    : assembly.worldPlacementCount === assembly.sourceOccurrenceCount
      ? assertion('world-placement', 'pass', 'Every occurrence local-to-parent-to-world chain was resolved.', hash, assembly.worldPlacementCount, 'count')
      : assertion('world-placement', assembly.cycleFree && assembly.invalidTransformCount === 0 ? 'not_run' : 'fail', 'Not every occurrence has an unambiguous valid world placement.', hash, assembly.worldPlacementCount, 'count');
  return [
    transforms,
    world,
    assertion('assembly-cycle-free', assembly.cycleFree ? 'pass' : 'fail', assembly.cycleFree ? 'STEP occurrence definition graph is cycle-free.' : 'STEP occurrence definition graph contains a cycle.', hash, assembly.cycleFree),
  ];
}

function measurementAssertions(detail: OcctDetailedShapeInspection, hash: string, assembly: StepAssemblyPlacementEvidence): EvidenceAssertionV2[] {
  const inertia = detail.inertia.status === 'not_run'
    ? assertion('inertia', 'not_run', detail.inertia.reason, hash)
    : assertion('inertia', 'pass', 'Centroidal inertia tensor measured by the kernel.', hash, JSON.stringify(detail.inertia.matrix), detail.inertia.units);
  const bodyBoundaries = detail.shapeTypeCounts
    ? assertion('body-boundaries', 'pass', 'OCCT TopAbs topology boundaries counted. Solid/shell/compound counts are not Product, Part, or occurrence counts.', hash, JSON.stringify(detail.shapeTypeCounts), 'count')
    : assertion('body-boundaries', 'not_run', 'The bridge did not expose compound/compsolid/solid/shell topology counts.', hash);
  const productOccurrences = detail.productOccurrences?.status === 'available'
    ? assertion('product-occurrences', 'pass', 'XCAF product occurrences counted independently of body topology.', hash, detail.productOccurrences.count, 'count')
    : assertion('product-occurrences', 'pass', 'STEP Part 21 NEXT_ASSEMBLY_USAGE_OCCURRENCE entities counted independently of body topology; zero is a measured flat/no-occurrence result, not a solid-count substitution.', hash, assembly.sourceOccurrenceCount, 'count');
  const adjacency = detail.faceAdjacency.status === 'not_run'
    ? assertion('face-adjacency', 'not_run', detail.faceAdjacency.reason, hash)
    : assertion('face-adjacency', 'pass', 'Exact TopoDS face-edge-face incidence measured.', hash, JSON.stringify(detail.faceAdjacency), 'topology-count');
  return [
    assertion('valid', detail.valid ? 'pass' : 'fail', detail.valid ? 'BRepCheck reports a valid shape.' : 'BRepCheck reports an invalid shape.', hash, detail.valid),
    assertion('solid-presence', detail.solidCount > 0 ? 'pass' : 'fail', detail.solidCount > 0 ? 'At least one exact TopAbs_SOLID is present.' : 'No TopAbs_SOLID is present; a valid face or shell is not accepted as a manufacturing solid.', hash, detail.solidCount, 'count'),
    assertion('counts', 'pass', 'Kernel topology counts measured.', hash, JSON.stringify({ solids: detail.solidCount, faces: detail.faceCount, edges: detail.edgeCount, ...(detail.shapeTypeCounts ? { shapeTypes: detail.shapeTypeCounts } : {}) }), 'count'),
    bodyBoundaries,
    productOccurrences,
    ...assemblyAssertions(assembly, hash),
    assertion('bbox', 'pass', 'Kernel axis-aligned bounding box measured.', hash, JSON.stringify(detail.bbox), 'source-length-unit'),
    assertion('volume', 'pass', 'Kernel absolute volume measured.', hash, detail.absoluteVolume, 'source-length-unit^3'),
    assertion('area', 'pass', 'Kernel surface area measured.', hash, detail.surfaceArea, 'source-length-unit^2'),
    assertion('centroid', 'pass', 'Kernel volume centroid measured.', hash, JSON.stringify(detail.centroid), 'source-length-unit'),
    inertia,
    histogramAssertion('surface-types', detail.surfaceTypes, hash),
    histogramAssertion('curve-types', detail.curveTypes, hash),
    adjacency,
  ];
}

function finish(input: AnalyzeCadReferenceInput, hash: string, sizeBytes: number, assertions: EvidenceAssertionV2[], repair?: StepHeaderRepair): CadEvidenceIrV2 {
  const evidence: CadEvidenceIrV2 = {
    schemaVersion: 2, scenarioId: input.scenarioId,
    input: { sha256: hash, extension: input.format, sizeBytes },
    producer: { adapter: 'occt-reference-analysis', version: '6' },
    status: deriveEvidenceStatus(assertions), assertions,
    artifacts: [
      { sha256: hash, role: 'input', mediaType: 'model/step', sizeBytes },
      ...(repair ? [{ sha256: repair.repairedSha256, role: 'measurement' as const, mediaType: 'model/step' }] : []),
    ],
    sideEffects: { quoteCreated: false, rfqSent: false, sourceModified: false, additional: [] },
  };
  const checked = validateCadEvidenceIrV2(evidence);
  if (!checked.ok) throw new TypeError(`Internal evidence validation failed: ${checked.issues.map(item => `${item.path}: ${item.message}`).join('; ')}`);
  return checked.value;
}

export async function analyzeCadReference(input: AnalyzeCadReferenceInput, bridge: OcctBridge): Promise<CadReferenceAnalysis> {
  if (input.format !== 'step' && input.format !== 'stp') throw new TypeError(`Unsupported CAD reference format: ${String(input.format)}`);
  if (!input.scenarioId.trim()) throw new TypeError('scenarioId must be non-empty.');
  if (!input.source.trim()) throw new TypeError('STEP source must be non-empty.');
  const bytes = new TextEncoder().encode(input.source);
  const hash = createHash('sha256').update(bytes).digest('hex');
  let shape: OcctShape | undefined;
  try {
    const recovery = await importStepWithRecovery(input.source, candidate => bridge.importSTEP(candidate), candidate => bridge.release(candidate));
    const { imported, repair } = recovery;
    shape = recovery.shape;
    const repairAssertion: EvidenceAssertionV2[] = repair ? [{
      id: 'import.header-repair', status: 'pass', method: 'conservative STEP header normalizer',
      criterion: { description: 'Replace exactly one FILE_NAME final authorisation $ token while preserving DATA bytes.' },
      measured: repair.kind, confidence: 1,
      reason: 'Original import failed; one header-only in-memory repair was applied before a single retry. This assertion does not claim that geometry import succeeded.',
      artifactHashes: [repair.originalSha256, repair.repairedSha256],
    }] : [];
    if (!imported.ok || !shape) {
      const reason = imported.error ?? 'OCCT STEP import returned no shape.';
      const failure = recovery.attempts.findLast(item => item.status === 'fail')?.failure;
      const assertions = [
        ...repairAssertion,
        assertion('import', 'fail', reason, hash),
        ...(failure ? [assertion('failure-code', 'fail', 'Import failure classified by the governed CAD failure taxonomy.', hash, failure.code)] : []),
        ...notRunAssertions(`Exact inspection was not run because import failed: ${reason}`, hash),
      ];
      return { evidence: finish(input, hash, bytes.byteLength, assertions, repair), tolerancePolicy: null };
    }
    const importAssertion = assertion('import', 'pass', 'OCCT parsed and transferred the STEP B-rep.', hash, true);
    if (!bridge.inspectShapeDetailed) {
      return { evidence: finish(input, hash, bytes.byteLength, [...repairAssertion, importAssertion, ...notRunAssertions('The injected OCCT bridge does not provide inspectShapeDetailed; cached or approximate shape fields were not substituted.', hash)], repair), tolerancePolicy: null };
    }
    let detail = await bridge.inspectShapeDetailed(shape);
    const tolerancePolicy = createCadTolerancePolicy({
      bbox: {
        min: [detail.bbox.min.x, detail.bbox.min.y, detail.bbox.min.z],
        max: [detail.bbox.max.x, detail.bbox.max.y, detail.bbox.max.z],
      },
      lengthUnit: input.lengthUnit,
      ...(input.declaredSourceTolerance === undefined ? {} : { declaredSourceTolerance: input.declaredSourceTolerance }),
    });
    const healing = await healImportedOcctShape({
      bridge, shape, detail,
      workingTolerance: tolerancePolicy.linearMm.boolean,
      sewingTolerance: tolerancePolicy.linearMm.importSewing,
    });
    shape = healing.shape; detail = healing.detail;
    const healingAssertions: EvidenceAssertionV2[] = healing.status === 'not_required' ? [] : [{
      id: 'import.shape-healing', status: healing.status === 'recovered' ? 'pass' : healing.status === 'not_run' ? 'not_run' : 'fail',
      method: 'OCCT ShapeFix_Shape + BRepBuilderAPI_Sewing with governed before/after approval',
      criterion: { description: 'Recovered shape must be valid, contain solids, preserve volume, remain within tolerance growth, and keep sewing tolerance below the minimum source edge.' },
      measured: healing.status, confidence: 1,
      reason: healing.status === 'recovered' ? 'Kernel healing passed every bounded approval check; the original source bytes were never modified.' : healing.reason ?? 'Kernel healing was not accepted.',
      artifactHashes: [hash],
    }, {
      id: 'import.healing-topology-reference-safety', status: 'pass',
      method: 'fail-closed topology-reference lifecycle policy',
      criterion: { description: 'Rejected/not-run healing preserves the original references; accepted healing invalidates old face/edge references until geometric remapping and ambiguity review complete.' },
      measured: healing.topologyReferenceStatus, confidence: 1,
      reason: healing.topologyReferenceStatus === 'requires_remap' ? 'The healed B-rep is accepted, but pre-healing subshape references are explicitly barred from silent reuse.' : 'The original shape remains authoritative, so its references are preserved.',
      artifactHashes: [hash],
    }];
    const assembly = analyzeStepAssemblyPlacements(input.source);
    return { evidence: finish(input, hash, bytes.byteLength, [...repairAssertion, importAssertion, ...healingAssertions, ...measurementAssertions(detail, hash, assembly)], repair), tolerancePolicy };
  } finally {
    if (shape) bridge.release(shape);
  }
}
