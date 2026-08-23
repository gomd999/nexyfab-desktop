import {
  validateArchitectureInteriorArtifactBundle,
  type ArchitectureInteriorArtifactBundle,
} from './architectureInteriorArtifactTransaction';

/**
 * Wave 4 truth registry for architecture/interior deliverables.
 *
 * A structured JSON artifact is not silently promoted to a native DWG/DXF/PDF
 * or an IFC round-trip.  The registry is intentionally explicit about which
 * paths are preview/internal, which have only partial semantics, and which
 * are still targets.  Every release claim remains disabled until an external
 * parser/round-trip and the applicable independent review exist.
 */
export type ArchitectureInteriorOutputDomain = 'architecture' | 'interior';
export type ArchitectureInteriorOutputKind = 'generated' | 'internal' | 'roundtrip';
export type ArchitectureInteriorOutputFormat = 'drawing' | 'schedule' | 'quantity' | 'ifc' | 'dxf' | 'pdf' | 'boq';
export type ArchitectureInteriorOutputStatus = 'SUPPORTED' | 'PARTIAL' | 'TARGET';
export type ArchitectureInteriorOutputRunState = 'VERIFIED' | 'NOT_RUN';

export interface ArchitectureInteriorOutputCapability {
  id: string;
  domain: ArchitectureInteriorOutputDomain;
  feature: string;
  format: ArchitectureInteriorOutputFormat;
  kind: ArchitectureInteriorOutputKind;
  status: ArchitectureInteriorOutputStatus;
  runState: ArchitectureInteriorOutputRunState;
  requiredArtifactKinds: readonly ('drawing' | 'quantity' | 'ifc')[];
  exporterPath?: string;
  parserPath?: string;
  verifierPaths: readonly string[];
  releaseClaimAllowed: false;
  blocker: string;
}

const drawing = 'src/lib/ai/architectureInteriorDrawingArtifact.ts';
const rcp = 'src/lib/ai/architectureInteriorRcpArtifact.ts';
const elevation = 'src/lib/ai/architectureInteriorElevationArtifact.ts';
const section = 'src/lib/ai/architectureInteriorSectionArtifact.ts';
const quantity = 'src/lib/ai/architectureInteriorQuantityArtifact.ts';
const ifc = 'src/lib/ai/architectureInteriorIfcArtifact.ts';
const drawingTest = 'src/lib/ai/architectureInteriorDrawingArtifact.test.ts';
const rcpTest = 'src/lib/ai/architectureInteriorRcpArtifact.test.ts';
const elevationTest = 'src/lib/ai/architectureInteriorElevationArtifact.test.ts';
const sectionTest = 'src/lib/ai/architectureInteriorSectionArtifact.test.ts';
const quantityTest = 'src/lib/ai/architectureInteriorQuantityArtifact.test.ts';
const ifcTest = 'src/lib/ai/architectureInteriorIfcArtifact.test.ts';
const finishScheduleExporter = 'scripts/drawing-to-3d/interior-finish-schedule-export.mjs';
const finishScheduleParser = 'scripts/drawing-to-3d/interior-finish-schedule-import.mjs';
const finishScheduleProbe = 'scripts/drawing-to-3d/interior-finish-schedule-probe.mjs';
const finishScheduleTest = 'src/lib/ai/interiorFinishSchedule.test.ts';
const ffeScheduleExporter = 'scripts/drawing-to-3d/interior-ffe-schedule-export.mjs';
const ffeScheduleParser = 'scripts/drawing-to-3d/interior-ffe-schedule-import.mjs';
const ffeScheduleProbe = 'scripts/drawing-to-3d/interior-ffe-schedule-probe.mjs';
const ffeScheduleTest = 'src/lib/ai/interiorFfeSchedule.test.ts';

export const ARCHITECTURE_INTERIOR_OUTPUT_CAPABILITIES: readonly ArchitectureInteriorOutputCapability[] = [
  {
    id: 'architecture.plan.drawing', domain: 'architecture', feature: 'plan', format: 'drawing', kind: 'generated',
    status: 'SUPPORTED', runState: 'VERIFIED', requiredArtifactKinds: ['drawing'], exporterPath: drawing,
    verifierPaths: [drawingTest], releaseClaimAllowed: false,
    blocker: 'Structured plan projection is internally reconciled; native CAD/PDF release and independent review are not present.',
  },
  {
    id: 'architecture.elevation.drawing', domain: 'architecture', feature: 'elevation', format: 'drawing', kind: 'generated',
    status: 'PARTIAL', runState: 'VERIFIED', requiredArtifactKinds: [], exporterPath: elevation, parserPath: elevation,
    verifierPaths: [elevationTest], releaseClaimAllowed: false,
    blocker: 'Deterministic structured elevation is internally parsed and source/hash reconciled. Native DWG/DXF/PDF output, external CAD interoperability, and architect/field review remain HOLD/NOT_RUN; release claim is disabled.',
  },
  {
    id: 'architecture.section.drawing', domain: 'architecture', feature: 'section', format: 'drawing', kind: 'generated',
    status: 'PARTIAL', runState: 'VERIFIED', requiredArtifactKinds: [], exporterPath: section, parserPath: section,
    verifierPaths: [sectionTest], releaseClaimAllowed: false,
    blocker: 'Deterministic structured vertical section is internally cut-reconciled and hash-bound. Native DWG/DXF/PDF output, external CAD interoperability, and architect/field review remain HOLD/NOT_RUN; release claim is disabled.',
  },
  {
    id: 'architecture.schedule.quantity', domain: 'architecture', feature: 'schedule', format: 'quantity', kind: 'internal',
    status: 'SUPPORTED', runState: 'VERIFIED', requiredArtifactKinds: ['quantity'], exporterPath: quantity,
    verifierPaths: [quantityTest], releaseClaimAllowed: false,
    blocker: 'Deterministic quantity schedules are internally reconciled; authority, pricing, and external release remain absent.',
  },
  {
    id: 'architecture.ifc.structured-semantic', domain: 'architecture', feature: 'IFC', format: 'ifc', kind: 'roundtrip',
    status: 'PARTIAL', runState: 'NOT_RUN', requiredArtifactKinds: ['ifc'], exporterPath: ifc,
    verifierPaths: [ifcTest], releaseClaimAllowed: false,
    blocker: 'Structured IFC4 semantic mapping is generated, but external parser and round-trip evidence is explicitly not run.',
  },
  {
    id: 'architecture.dxf.roundtrip', domain: 'architecture', feature: 'drawing exchange', format: 'dxf', kind: 'roundtrip',
    status: 'TARGET', runState: 'NOT_RUN', requiredArtifactKinds: [], verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No architecture-specific DXF exporter, parser, and round-trip verifier is implemented.',
  },
  {
    id: 'architecture.pdf.roundtrip', domain: 'architecture', feature: 'drawing package', format: 'pdf', kind: 'roundtrip',
    status: 'TARGET', runState: 'NOT_RUN', requiredArtifactKinds: [], verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No architecture-specific PDF renderer and visual/parser verifier is implemented.',
  },
  {
    id: 'interior.layout.drawing', domain: 'interior', feature: 'layout', format: 'drawing', kind: 'generated',
    status: 'SUPPORTED', runState: 'VERIFIED', requiredArtifactKinds: ['drawing'], exporterPath: drawing,
    verifierPaths: [drawingTest], releaseClaimAllowed: false,
    blocker: 'Furniture and finish layout is present in the internally reconciled plan; native layout exchange is not release-complete.',
  },
  {
    id: 'interior.rcp.drawing', domain: 'interior', feature: 'RCP', format: 'drawing', kind: 'generated',
    status: 'PARTIAL', runState: 'VERIFIED', requiredArtifactKinds: [], exporterPath: rcp, parserPath: rcp,
    verifierPaths: [rcpTest], releaseClaimAllowed: false,
    blocker: 'Deterministic structured RCP is internally parsed and host/hash reconciled. Native DWG/DXF/PDF export, external parser/round-trip evidence, and field review remain HOLD; the standalone artifact is not promoted through the generic bundle drawing slot.',
  },
  {
    id: 'interior.elevation.drawing', domain: 'interior', feature: 'elevation', format: 'drawing', kind: 'generated',
    status: 'TARGET', runState: 'NOT_RUN', requiredArtifactKinds: [], verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No dedicated interior elevation renderer/exporter and verifier is implemented.',
  },
  {
    id: 'interior.millwork.drawing', domain: 'interior', feature: 'millwork', format: 'drawing', kind: 'generated',
    status: 'PARTIAL', runState: 'VERIFIED', requiredArtifactKinds: ['drawing'], exporterPath: drawing,
    verifierPaths: [drawingTest], releaseClaimAllowed: false,
    blocker: 'Millwork is host-reconciled in the plan payload; dedicated detail sheets and native exchange are not implemented.',
  },
  {
    id: 'interior.finish.schedule', domain: 'interior', feature: 'finish', format: 'schedule', kind: 'internal',
    status: 'PARTIAL', runState: 'VERIFIED', requiredArtifactKinds: [], exporterPath: finishScheduleExporter, parserPath: finishScheduleParser,
    verifierPaths: [finishScheduleProbe, finishScheduleTest], releaseClaimAllowed: false,
    blocker: 'Internal JSON finish rows are exporter/parser/probe hash-reconciled only. Native or external material catalog exchange, BOQ authority, and field evidence remain HOLD/NOT_RUN; release is disabled.',
  },
  {
    id: 'interior.ffe.schedule', domain: 'interior', feature: 'FF&E', format: 'schedule', kind: 'internal',
    status: 'PARTIAL', runState: 'VERIFIED', requiredArtifactKinds: [], exporterPath: ffeScheduleExporter, parserPath: ffeScheduleParser,
    verifierPaths: [ffeScheduleProbe, ffeScheduleTest], releaseClaimAllowed: false,
    blocker: 'Deterministic internal FF&E placement rows are architecture-host/revision/hash reconciled only. Catalog provenance, price, BOQ authority, native/external interoperability, and field evidence remain HOLD/NOT_RUN; release is disabled.',
  },
  {
    id: 'interior.boq.quantity', domain: 'interior', feature: 'BOQ', format: 'boq', kind: 'internal',
    status: 'PARTIAL', runState: 'VERIFIED', requiredArtifactKinds: ['quantity'], exporterPath: quantity,
    verifierPaths: [quantityTest], releaseClaimAllowed: false,
    blocker: 'Internal quantities exist without authoritative unit rates, cost provenance, or a dedicated BOQ exchange verifier.',
  },
  {
    id: 'interior.ifc.structured-semantic', domain: 'interior', feature: 'IFC', format: 'ifc', kind: 'roundtrip',
    status: 'PARTIAL', runState: 'NOT_RUN', requiredArtifactKinds: ['ifc'], exporterPath: ifc,
    verifierPaths: [ifcTest], releaseClaimAllowed: false,
    blocker: 'Interior objects are mapped into structured IFC4 semantics, but external parser and round-trip evidence is not run.',
  },
  {
    id: 'interior.dxf.roundtrip', domain: 'interior', feature: 'drawing exchange', format: 'dxf', kind: 'roundtrip',
    status: 'TARGET', runState: 'NOT_RUN', requiredArtifactKinds: [], verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No interior-specific DXF exporter, parser, and round-trip verifier is implemented.',
  },
  {
    id: 'interior.pdf.roundtrip', domain: 'interior', feature: 'drawing package', format: 'pdf', kind: 'roundtrip',
    status: 'TARGET', runState: 'NOT_RUN', requiredArtifactKinds: [], verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No interior-specific PDF renderer and visual/parser verifier is implemented.',
  },
] as const;

export type ArchitectureInteriorOutputBindingExpectation = {
  projectId: string;
  revision: number;
  contentHash: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  architectureDocumentHash: string;
  interiorDocumentHash: string;
};

const sha256 = /^[a-f0-9]{64}$/;

export function getArchitectureInteriorOutputCapability(id: string): ArchitectureInteriorOutputCapability | null {
  return ARCHITECTURE_INTERIOR_OUTPUT_CAPABILITIES.find(item => item.id === id) ?? null;
}

export function canEnableArchitectureInteriorOutput(id: string): boolean {
  const capability = getArchitectureInteriorOutputCapability(id);
  return Boolean(capability && capability.status !== 'TARGET' && capability.runState === 'VERIFIED' && capability.requiredArtifactKinds.length > 0);
}

export function assertArchitectureInteriorOutputEnabled(id: string): ArchitectureInteriorOutputCapability {
  const capability = getArchitectureInteriorOutputCapability(id);
  if (!capability || !canEnableArchitectureInteriorOutput(id)) throw new Error(`ARCHITECTURE_INTERIOR_OUTPUT_UNAVAILABLE:${id}`);
  return capability;
}

function sourceIssues(source: ArchitectureInteriorArtifactBundle['source'] | undefined, expected?: ArchitectureInteriorOutputBindingExpectation): string[] {
  const issues: string[] = [];
  if (!source) return ['source_missing'];
  if (!sha256.test(source.contentHash) || !sha256.test(source.architectureDocumentHash) || !sha256.test(source.interiorDocumentHash)) issues.push('source_hash_invalid');
  if (expected) {
    for (const key of ['projectId', 'revision', 'contentHash', 'architectureDocumentId', 'interiorDocumentId', 'architectureDocumentHash', 'interiorDocumentHash'] as const) {
      if (source[key] !== expected[key]) issues.push(`stale_source_binding:${key}`);
    }
  }
  return issues;
}

/**
 * Re-checks the persisted bundle before a UI or release gate treats anything
 * as current.  The expected source is optional for stored-bundle integrity,
 * but should be supplied whenever a live workspace is available.
 */
export function validateArchitectureInteriorOutputBundle(
  bundle: ArchitectureInteriorArtifactBundle,
  expectedSource?: ArchitectureInteriorOutputBindingExpectation,
): string[] {
  const issues = [...validateArchitectureInteriorArtifactBundle(bundle), ...sourceIssues(bundle?.source, expectedSource)];
  const currentKinds = new Set((bundle?.artifactGraph?.artifacts ?? []).filter(item => item.state === 'current').map(item => item.kind));
  for (const artifact of bundle?.artifacts ?? []) {
    if (artifact.artifact.state !== 'current') issues.push(`stale_output_artifact:${artifact.artifact.id}`);
    if (artifact.artifact.revision !== bundle?.source?.revision) issues.push(`output_revision_mismatch:${artifact.artifact.id}`);
    if (!currentKinds.has(artifact.kind)) issues.push(`output_kind_not_current:${artifact.kind}`);
  }
  return [...new Set(issues)];
}

/**
 * A graph node is only an index/lineage record.  It does not carry the output
 * payload that a caller can inspect or download, so it must never make a
 * capability available by itself.  Availability is derived exclusively from
 * the current, exact-revision payloads included in this bundle.  The bundle
 * validator above separately re-hashes each payload and reconciles it with the
 * graph node and source document binding.
 */
function availableBundleArtifactKinds(bundle: ArchitectureInteriorArtifactBundle): Set<'drawing' | 'quantity' | 'ifc'> {
  const sourceRevision = bundle?.source?.revision;
  return new Set((bundle?.artifacts ?? [])
    .filter(item => item.artifact.state === 'current'
      && item.artifact.revision === sourceRevision
      && item.artifact.kind === item.kind
      && item.artifact.contentHash === item.contentHash)
    .map(item => item.kind));
}

export type ArchitectureInteriorOutputEvaluation = {
  bindingValid: boolean;
  releaseReady: false;
  issues: string[];
  capabilities: Array<ArchitectureInteriorOutputCapability & { artifactAvailable: boolean; enabled: boolean }>;
};

export function evaluateArchitectureInteriorOutputs(
  bundle: ArchitectureInteriorArtifactBundle,
  expectedSource?: ArchitectureInteriorOutputBindingExpectation,
): ArchitectureInteriorOutputEvaluation {
  const issues = validateArchitectureInteriorOutputBundle(bundle, expectedSource);
  const availableKinds = availableBundleArtifactKinds(bundle);
  return {
    bindingValid: issues.length === 0,
    releaseReady: false,
    issues,
    capabilities: ARCHITECTURE_INTERIOR_OUTPUT_CAPABILITIES.map(capability => {
      const artifactAvailable = capability.requiredArtifactKinds.length > 0
        && capability.requiredArtifactKinds.every(kind => availableKinds.has(kind));
      return { ...capability, artifactAvailable, enabled: issues.length === 0 && artifactAvailable && canEnableArchitectureInteriorOutput(capability.id) };
    }),
  };
}
