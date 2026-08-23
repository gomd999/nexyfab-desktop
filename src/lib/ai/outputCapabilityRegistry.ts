import {
  ARCHITECTURE_INTERIOR_OUTPUT_CAPABILITIES,
  canEnableArchitectureInteriorOutput,
} from './architectureInteriorOutputCapabilities';
import {
  CIVIL_LANDSCAPE_OUTPUT_CAPABILITIES,
  canEnableCivilLandscapeOutput,
} from './civilLandscapeOutputCapabilities';

export type OutputArtifactTruth =
  | 'exact_exchange'
  | 'mesh_exchange'
  | 'bounded_exchange'
  | 'structured_internal'
  | 'analysis_only'
  | 'preview'
  | 'unavailable';

export type OutputCapabilityDomain =
  | 'mechanical'
  | 'architecture'
  | 'civil'
  | 'landscape'
  | 'interior'
  | 'specialty';

export interface OutputCapability {
  id: string;
  domain: OutputCapabilityDomain;
  format: string;
  artifactTruth: OutputArtifactTruth;
  status: 'SUPPORTED' | 'PARTIAL' | 'HOLD';
  runState: 'VERIFIED' | 'NOT_RUN';
  exportAvailable: boolean;
  /** Registry metadata is never an artifact-specific release receipt. */
  releaseReady: false;
  perArtifactEvidenceRequired: true;
  mcpAdvertised: boolean;
  cliAdvertised: boolean;
  implementationPaths: readonly string[];
  evidencePaths: readonly string[];
  blocker: string;
}

const core: readonly OutputCapability[] = [
  {
    id: 'mechanical.part.step', domain: 'mechanical', format: 'STEP',
    artifactTruth: 'exact_exchange', status: 'SUPPORTED', runState: 'VERIFIED',
    exportAvailable: true, releaseReady: false, perArtifactEvidenceRequired: true,
    mcpAdvertised: true, cliAdvertised: true,
    implementationPaths: ['src/app/api/cad/v1/part-step/route.ts'],
    evidencePaths: ['src/lib/reference/partStepRoundtripEvidence.real.test.ts'],
    blocker: 'Each STEP still requires exact OCCT topology, round-trip, revision/hash, and release-gate evidence.',
  },
  {
    id: 'mechanical.part.stl', domain: 'mechanical', format: 'STL',
    artifactTruth: 'mesh_exchange', status: 'SUPPORTED', runState: 'VERIFIED',
    exportAvailable: true, releaseReady: false, perArtifactEvidenceRequired: true,
    mcpAdvertised: true, cliAdvertised: true,
    implementationPaths: ['src/app/api/cad/v1/feature-tree-mesh/route.ts'],
    evidencePaths: ['scripts/drawing-to-3d/roundtrip-bodies.test.ts'],
    blocker: 'A faceted mesh is not native or exact B-rep CAD and cannot authorize manufacturing release.',
  },
  {
    id: 'mechanical.drawing.dxf', domain: 'mechanical', format: 'DXF',
    artifactTruth: 'bounded_exchange', status: 'PARTIAL', runState: 'VERIFIED',
    exportAvailable: true, releaseReady: false, perArtifactEvidenceRequired: true,
    mcpAdvertised: false, cliAdvertised: false,
    implementationPaths: ['src/app/[lang]/shape-generator/io/dxfExporter.ts'],
    evidencePaths: ['src/app/[lang]/shape-generator/__tests__/referenceParts/part3.uchannel.refpart.test.ts'],
    blocker: 'Browser DXF generation is bounded; native CAD round-trip and drawing authority remain unverified.',
  },
  {
    id: 'mechanical.bom.internal', domain: 'mechanical', format: 'JSON/CSV',
    artifactTruth: 'structured_internal', status: 'PARTIAL', runState: 'VERIFIED',
    exportAvailable: true, releaseReady: false, perArtifactEvidenceRequired: true,
    mcpAdvertised: false, cliAdvertised: false,
    implementationPaths: ['src/lib/assembly/bomExport.ts'],
    evidencePaths: ['src/lib/assembly/bomExport.test.ts'],
    blocker: 'Internal BOM calculation is not supplier, material-certificate, or manufacturing authority.',
  },
  {
    id: 'specialty.sheet-metal.verify', domain: 'specialty', format: 'verification-json',
    artifactTruth: 'analysis_only', status: 'PARTIAL', runState: 'VERIFIED',
    exportAvailable: false, releaseReady: false, perArtifactEvidenceRequired: true,
    mcpAdvertised: true, cliAdvertised: true,
    implementationPaths: ['src/app/api/cad/v1/sheet-metal/verify/route.ts'],
    evidencePaths: ['src/app/api/cad/v1/sheet-metal/verify/route.test.ts'],
    blocker: 'Verification output is not a native flat-pattern artifact or manufacturing release.',
  },
  {
    id: 'specialty.weldment.verify', domain: 'specialty', format: 'verification-json',
    artifactTruth: 'analysis_only', status: 'PARTIAL', runState: 'VERIFIED',
    exportAvailable: false, releaseReady: false, perArtifactEvidenceRequired: true,
    mcpAdvertised: true, cliAdvertised: true,
    implementationPaths: ['src/app/api/cad/v1/weldment/verify/route.ts'],
    evidencePaths: ['src/app/api/cad/v1/weldment/verify/route.test.ts'],
    blocker: 'Verification output is not a fabrication drawing, cut list, WPS, or native weldment artifact.',
  },
  ...['mold-tooling', 'piping-hvac', 'ecad-mcad'].map((track): OutputCapability => ({
    id: `specialty.${track}.native-output`, domain: 'specialty', format: 'native-cad',
    artifactTruth: 'unavailable', status: 'HOLD', runState: 'NOT_RUN',
    exportAvailable: false, releaseReady: false, perArtifactEvidenceRequired: true,
    mcpAdvertised: false, cliAdvertised: false, implementationPaths: [], evidencePaths: [],
    blocker: `No release-qualified native ${track} output and independent round-trip evidence are available.`,
  })),
];

const architectureInterior: readonly OutputCapability[] = ARCHITECTURE_INTERIOR_OUTPUT_CAPABILITIES.map(item => ({
  id: item.id,
  domain: item.domain,
  format: item.format,
  artifactTruth: item.status === 'TARGET' || item.runState === 'NOT_RUN'
    ? 'unavailable'
    : item.kind === 'internal' || item.kind === 'generated'
      ? 'structured_internal'
      : 'bounded_exchange',
  status: item.status === 'TARGET' ? 'HOLD' : item.status,
  runState: item.runState,
  exportAvailable: canEnableArchitectureInteriorOutput(item.id),
  releaseReady: false,
  perArtifactEvidenceRequired: true,
  mcpAdvertised: false,
  cliAdvertised: false,
  implementationPaths: [item.exporterPath, item.parserPath].filter((path): path is string => Boolean(path)),
  evidencePaths: item.verifierPaths,
  blocker: item.blocker,
}));

const civilLandscape: readonly OutputCapability[] = CIVIL_LANDSCAPE_OUTPUT_CAPABILITIES.map(item => ({
  id: item.id,
  domain: item.domain,
  format: item.format,
  artifactTruth: item.status === 'TARGET' || item.runState === 'NOT_RUN'
    ? 'unavailable'
    : item.kind === 'internal'
      ? 'structured_internal'
      : item.kind === 'probe'
        ? 'preview'
        : 'bounded_exchange',
  status: item.status === 'TARGET' ? 'HOLD' : item.status,
  runState: item.runState,
  exportAvailable: canEnableCivilLandscapeOutput(item.id),
  releaseReady: false,
  perArtifactEvidenceRequired: true,
  mcpAdvertised: false,
  cliAdvertised: false,
  implementationPaths: [item.exporterPath, item.parserPath].filter((path): path is string => Boolean(path)),
  evidencePaths: item.verifierPaths,
  blocker: item.blocker ?? 'External interoperability and independent release evidence remain required.',
}));

export const OUTPUT_CAPABILITIES: readonly OutputCapability[] = Object.freeze([
  ...core,
  ...architectureInterior,
  ...civilLandscape,
]);

export function getOutputCapability(id: string): OutputCapability | null {
  return OUTPUT_CAPABILITIES.find(item => item.id === id) ?? null;
}

export function canExportOutput(id: string): boolean {
  const item = getOutputCapability(id);
  return Boolean(item?.exportAvailable && item.status !== 'HOLD' && item.runState === 'VERIFIED');
}

export function assertOutputExportable(id: string): OutputCapability {
  const item = getOutputCapability(id);
  if (!item || !canExportOutput(id)) throw new Error(`OUTPUT_EXPORT_HOLD:${id}`);
  return item;
}

export function validateOutputCapabilityRegistry(): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const item of OUTPUT_CAPABILITIES) {
    if (ids.has(item.id)) issues.push(`duplicate:${item.id}`);
    ids.add(item.id);
    if (item.releaseReady) issues.push(`${item.id}:registry_cannot_authorize_release`);
    if (item.exportAvailable && (item.status === 'HOLD' || item.runState === 'NOT_RUN')) issues.push(`${item.id}:unsafe_export`);
    if (item.artifactTruth === 'unavailable' && (item.exportAvailable || item.mcpAdvertised || item.cliAdvertised)) issues.push(`${item.id}:unavailable_advertised`);
    if ((item.mcpAdvertised || item.cliAdvertised) && item.artifactTruth === 'unavailable') issues.push(`${item.id}:hold_surface`);
  }
  return issues;
}
