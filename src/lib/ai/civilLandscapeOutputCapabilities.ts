import { createHash } from 'node:crypto';
import { designRevisionSha256 } from '@/lib/designArtifactBinding';

/**
 * Wave 4 output truth for the civil and landscape domains.
 *
 * Domain profiles intentionally contain the product target list.  This file
 * is narrower: it records which output paths have an actual exporter,
 * importer/verifier, and executable evidence today.  A generated string is
 * never promoted to a round-trip claim by this registry.
 */
export type CivilLandscapeOutputDomain = 'civil' | 'landscape';
export type CivilLandscapeOutputKind = 'generated' | 'internal' | 'probe' | 'roundtrip';
export type CivilLandscapeOutputFormat = 'landxml' | 'dxf' | 'pdf' | 'json' | 'schedule' | 'boq';
export type CivilLandscapeOutputStatus = 'SUPPORTED' | 'PARTIAL' | 'TARGET';
export type CivilLandscapeOutputRunState = 'VERIFIED' | 'NOT_RUN';

export interface CivilLandscapeOutputCapability {
  id: string;
  domain: CivilLandscapeOutputDomain;
  feature: string;
  format: CivilLandscapeOutputFormat;
  kind: CivilLandscapeOutputKind;
  status: CivilLandscapeOutputStatus;
  runState: CivilLandscapeOutputRunState;
  exporterPath?: string;
  parserPath?: string;
  verifierPaths: readonly string[];
  releaseClaimAllowed: boolean;
  requiredArtifactKinds?: readonly string[];
  blocker?: string;
}

const path = (value: string) => value;

/**
 * The absence of a parser/verifier is deliberate.  Keep TARGET entries in
 * this table so a UI cannot infer support merely from a format name.
 */
export const CIVIL_LANDSCAPE_OUTPUT_CAPABILITIES: readonly CivilLandscapeOutputCapability[] = [
  {
    id: 'civil.alignment.landxml.roundtrip', domain: 'civil', feature: 'alignment', format: 'landxml', kind: 'roundtrip',
    status: 'PARTIAL', runState: 'VERIFIED',
    exporterPath: path('scripts/drawing-to-3d/landxml-export.mjs'),
    parserPath: path('scripts/drawing-to-3d/landxml-import.mjs'),
    verifierPaths: [path('scripts/drawing-to-3d/landxml-import.test.ts'), path('scripts/drawing-to-3d/landxml-roundtrip-probe.mjs')], releaseClaimAllowed: false,
    blocker: 'CRS/datum, terrain, corridor semantics, and all non-arc/compound curve variants are not release-complete.',
  },
  {
    id: 'civil.profile.landxml.roundtrip', domain: 'civil', feature: 'profile', format: 'landxml', kind: 'roundtrip',
    status: 'PARTIAL', runState: 'VERIFIED',
    exporterPath: path('scripts/drawing-to-3d/landxml-export.mjs'),
    parserPath: path('scripts/drawing-to-3d/landxml-import.mjs'),
    verifierPaths: [path('scripts/drawing-to-3d/landxml-import.test.ts'), path('scripts/drawing-to-3d/landxml-roundtrip-probe.mjs')], releaseClaimAllowed: false,
    blocker: 'PVI/ParaCurve exchange is covered; full profile/corridor/CRS authority and independent holdout are not.',
  },
  {
    id: 'civil.cross-section.internal', domain: 'civil', feature: 'cross-section', format: 'json', kind: 'roundtrip',
    status: 'PARTIAL', runState: 'VERIFIED',
    exporterPath: path('src/lib/ai/civilCrossSectionArtifact.ts'),
    parserPath: path('src/lib/ai/civilCrossSectionArtifact.ts'),
    verifierPaths: [path('src/lib/ai/civilCrossSectionArtifact.ts'), path('src/lib/ai/civilCrossSectionArtifact.test.ts')], releaseClaimAllowed: false,
    blocker: 'Deterministic internal alignment/cross-section artifact only; DXF/PDF/native external interoperability and field review remain HOLD/NOT_RUN.',
  },
  {
    id: 'civil.profile.internal', domain: 'civil', feature: 'profile', format: 'json', kind: 'roundtrip',
    status: 'PARTIAL', runState: 'VERIFIED', requiredArtifactKinds: [],
    exporterPath: path('scripts/drawing-to-3d/civil-profile-export.mjs'),
    parserPath: path('scripts/drawing-to-3d/civil-profile-import.mjs'),
    verifierPaths: [path('scripts/drawing-to-3d/civil-profile-probe.mjs'), path('src/lib/ai/civilProfileArtifact.test.ts')], releaseClaimAllowed: false,
    blocker: 'Deterministic internal alignment/profile JSON artifact only; native DXF/PDF/LandXML/external CAD and field authority remain HOLD/NOT_RUN.',
  },
  {
    id: 'civil.alignment.dxf.generated', domain: 'civil', feature: 'alignment', format: 'dxf', kind: 'probe',
    status: 'PARTIAL', runState: 'NOT_RUN',
    exporterPath: path('scripts/drawing-to-3d/dxf-export.mjs'),
    verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'DXF exporter exists, but the exporter self-test is not an independent focused verifier and no matching civil alignment parser/round-trip verifier exists.',
  },
  {
    id: 'civil.cross-section.dxf.roundtrip', domain: 'civil', feature: 'cross-section', format: 'dxf', kind: 'roundtrip',
    status: 'TARGET', runState: 'NOT_RUN', verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No cross-section exporter plus parser/verifier contract is implemented.',
  },
  {
    id: 'civil.earthwork.internal', domain: 'civil', feature: 'earthwork', format: 'json', kind: 'internal',
    status: 'PARTIAL', runState: 'VERIFIED', requiredArtifactKinds: [],
    exporterPath: path('scripts/drawing-to-3d/civil-earthwork-export.mjs'),
    parserPath: path('scripts/drawing-to-3d/civil-earthwork-import.mjs'),
    verifierPaths: [path('scripts/drawing-to-3d/civil-earthwork-probe.mjs'), path('src/lib/ai/civilEarthworkArtifact.test.ts')], releaseClaimAllowed: false,
    blocker: 'Sampled internal grid calculator evidence only; parser replay validates the checked-in calculator (not an independent numeric algorithm). Actual survey/CRS/datum/TIN/grading/corridor/field/contract quantities/external roundtrip remain HOLD/NOT_RUN and releaseReady is false.',
  },
  {
    id: 'civil.drainage.internal', domain: 'civil', feature: 'drainage', format: 'json', kind: 'internal',
    status: 'PARTIAL', runState: 'VERIFIED',
    exporterPath: path('scripts/engineering-core/calculators/drainage-network.mjs'),
    verifierPaths: [path('scripts/engineering-core/test/landscape-drainage.test.mjs')], releaseClaimAllowed: false,
    blocker: 'Deterministic calculator evidence exists; civil network output/authority and revision-bound artifact release are incomplete.',
  },
  {
    id: 'civil.pdf.report', domain: 'civil', feature: 'alignment/profile/cross-section', format: 'pdf', kind: 'roundtrip',
    status: 'TARGET', runState: 'NOT_RUN', verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No civil PDF renderer plus parser/visual verifier is implemented.',
  },
  {
    id: 'landscape.grading.dxf.generated', domain: 'landscape', feature: 'grading', format: 'dxf', kind: 'probe',
    status: 'PARTIAL', runState: 'NOT_RUN',
    exporterPath: path('scripts/drawing-to-3d/dxf-export.mjs'),
    verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'DXF exporter exists, but no independent focused verifier or terrain/grading round-trip semantics are implemented.',
  },
  {
    id: 'landscape.planting.internal', domain: 'landscape', feature: 'planting', format: 'json', kind: 'internal',
    status: 'PARTIAL', runState: 'VERIFIED',
    exporterPath: path('scripts/drawing-to-3d/domain-assemblies.mjs'),
    verifierPaths: [path('scripts/drawing-to-3d/landscape-accuracy-chain.test.ts')], releaseClaimAllowed: false,
    blocker: 'Plant proxy geometry and spacing checks exist; species/catalog provenance and planting schedule export do not.',
  },
  {
    id: 'landscape.planting.schedule.internal', domain: 'landscape', feature: 'planting schedule', format: 'schedule', kind: 'roundtrip',
    status: 'PARTIAL', runState: 'VERIFIED',
    exporterPath: path('scripts/drawing-to-3d/landscape-planting-schedule-export.mjs'),
    parserPath: path('scripts/drawing-to-3d/landscape-planting-schedule-import.mjs'),
    verifierPaths: [path('scripts/drawing-to-3d/landscape-planting-schedule-probe.mjs'), path('src/lib/ai/landscapePlantingSchedule.test.ts')], releaseClaimAllowed: false,
    blocker: 'Revision-bound internal JSON schedule only; plant catalog provenance, native/external roundtrip, field evidence, and release remain HOLD/NOT_RUN.',
  },
  {
    id: 'landscape.hardscape.dxf.generated', domain: 'landscape', feature: 'hardscape', format: 'dxf', kind: 'probe',
    status: 'PARTIAL', runState: 'NOT_RUN',
    exporterPath: path('scripts/drawing-to-3d/dxf-export.mjs'),
    verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'Template geometry can be emitted, but the exporter self-test is not an independent focused verifier. No hardscape parser/round-trip probe, material/detail semantics, external interoperability, or field review exists; output remains NOT_RUN/HOLD.',
  },
  {
    id: 'landscape.irrigation.internal', domain: 'landscape', feature: 'irrigation', format: 'json', kind: 'internal',
    status: 'TARGET', runState: 'NOT_RUN', verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No hydraulic network exporter or pressure-loss verifier is implemented; the bounded internal schedule output is tracked separately and is not hydraulic evidence.',
  },
  {
    id: 'landscape.irrigation.schedule.internal', domain: 'landscape', feature: 'irrigation schedule', format: 'schedule', kind: 'roundtrip',
    status: 'PARTIAL', runState: 'VERIFIED',
    exporterPath: path('scripts/drawing-to-3d/landscape-irrigation-schedule-export.mjs'),
    parserPath: path('scripts/drawing-to-3d/landscape-irrigation-schedule-import.mjs'),
    verifierPaths: [path('scripts/drawing-to-3d/landscape-irrigation-schedule-probe.mjs'), path('src/lib/ai/landscapeIrrigationSchedule.test.ts')],
    releaseClaimAllowed: false,
    blocker: 'Deterministic revision-bound internal schedule only; hydraulic, external interoperability, and field evidence remain NOT_RUN/HOLD.',
  },
  {
    id: 'landscape.drainage.internal', domain: 'landscape', feature: 'drainage', format: 'json', kind: 'internal',
    status: 'SUPPORTED', runState: 'VERIFIED',
    exporterPath: path('scripts/engineering-core/calculators/landscape-drainage.mjs'),
    verifierPaths: [path('scripts/engineering-core/test/landscape-drainage.test.mjs')], releaseClaimAllowed: false,
    blocker: 'Calculator output is supported for internal review only; it is not a construction release artifact.',
  },
  {
    id: 'landscape.schedule.csv', domain: 'landscape', feature: 'schedule', format: 'schedule', kind: 'roundtrip',
    status: 'TARGET', runState: 'NOT_RUN', verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No combined planting/irrigation schedule, external interoperability, or release verifier is implemented; the bounded irrigation-only internal schedule is tracked separately.',
  },
  {
    id: 'landscape.boq.csv', domain: 'landscape', feature: 'BOQ', format: 'boq', kind: 'roundtrip',
    status: 'TARGET', runState: 'NOT_RUN', verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'Generic BOQ helpers exist for some assemblies, but no landscape quantity provenance and round-trip contract is implemented.',
  },
  {
    id: 'landscape.pdf.report', domain: 'landscape', feature: 'grading/planting/hardscape/irrigation', format: 'pdf', kind: 'roundtrip',
    status: 'TARGET', runState: 'NOT_RUN', verifierPaths: [], releaseClaimAllowed: false,
    blocker: 'No landscape PDF renderer plus parser/visual verifier is implemented.',
  },
] as const;

export interface BoundCivilLandscapeArtifact {
  capabilityId: string;
  format: CivilLandscapeOutputFormat;
  projectId: string;
  revisionId: string;
  revisionSha256: string;
  artifactName: string;
  artifactMime: string;
  artifactBytes: number;
  artifactSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const FORMAT_MIME_PREFIX: Record<CivilLandscapeOutputFormat, readonly string[]> = {
  landxml: ['application/xml', 'text/xml'], dxf: ['application/dxf', 'application/octet-stream', 'text/plain'],
  pdf: ['application/pdf'], json: ['application/json'], schedule: ['text/csv', 'application/json'], boq: ['text/csv', 'application/json'],
};

export function getCivilLandscapeOutputCapability(id: string): CivilLandscapeOutputCapability | null {
  return CIVIL_LANDSCAPE_OUTPUT_CAPABILITIES.find(item => item.id === id) ?? null;
}

/** Preview/internal paths may be enabled; TARGET and unknown paths never are. */
export function canEnableCivilLandscapeOutput(id: string): boolean {
  const capability = getCivilLandscapeOutputCapability(id);
  return Boolean(capability && capability.status !== 'TARGET' && capability.runState === 'VERIFIED');
}

export function assertCivilLandscapeOutputEnabled(id: string): CivilLandscapeOutputCapability {
  const capability = getCivilLandscapeOutputCapability(id);
  if (!capability || !canEnableCivilLandscapeOutput(id)) {
    throw new Error(`CIVIL_LANDSCAPE_OUTPUT_UNAVAILABLE:${id}`);
  }
  return capability;
}

function validBoundArtifact(binding: BoundCivilLandscapeArtifact, capability: CivilLandscapeOutputCapability): boolean {
  return binding.capabilityId === capability.id
    && binding.format === capability.format
    && Boolean(binding.projectId.trim() && binding.revisionId.trim() && binding.artifactName.trim() && binding.artifactMime.trim())
    && Number.isSafeInteger(binding.artifactBytes) && binding.artifactBytes > 0
    && SHA256.test(binding.revisionSha256)
    && SHA256.test(binding.artifactSha256)
    && FORMAT_MIME_PREFIX[capability.format].some(prefix => binding.artifactMime.toLowerCase().startsWith(prefix));
}

export function bindCivilLandscapeArtifact(input: {
  capabilityId: string;
  projectId: string;
  revisionId: string;
  revisionValue: unknown;
  expectedRevisionId: string;
  expectedRevisionSha256: string;
  artifactName: string;
  artifactMime: string;
  bytes: Uint8Array;
}): BoundCivilLandscapeArtifact {
  const capability = assertCivilLandscapeOutputEnabled(input.capabilityId);
  if (!input.projectId.trim() || !input.revisionId.trim() || !input.artifactName.trim() || !input.artifactMime.trim() || input.bytes.byteLength === 0) {
    throw new Error('CIVIL_LANDSCAPE_ARTIFACT_INPUT_INVALID');
  }
  if (!FORMAT_MIME_PREFIX[capability.format].some(prefix => input.artifactMime.toLowerCase().startsWith(prefix))) {
    throw new Error('CIVIL_LANDSCAPE_ARTIFACT_FORMAT_MISMATCH');
  }
  if (input.revisionId !== input.expectedRevisionId) throw new Error('CIVIL_LANDSCAPE_STALE_REVISION');
  const revisionSha256 = designRevisionSha256(input.revisionValue);
  if (revisionSha256 !== input.expectedRevisionSha256 || !SHA256.test(input.expectedRevisionSha256)) {
    throw new Error('CIVIL_LANDSCAPE_STALE_REVISION_HASH');
  }
  return {
    capabilityId: input.capabilityId,
    format: capability.format,
    projectId: input.projectId,
    revisionId: input.revisionId,
    revisionSha256,
    artifactName: input.artifactName,
    artifactMime: input.artifactMime,
    artifactBytes: input.bytes.byteLength,
    artifactSha256: sha256(input.bytes),
  };
}

export interface CivilLandscapeRoundtripProbeReceipt {
  schema: 'nexyfab.civil-landscape-roundtrip-probe.v1';
  capabilityId: string;
  format: CivilLandscapeOutputFormat;
  sourceArtifactSha256: string;
  revisionId: string;
  revisionSha256: string;
  parserId: string;
  parserResult: 'verified';
  parserOutputSha256: string;
  verifierId: string;
  verifierEvidenceSha256: string;
  parsedRevisionId: string;
  parsedRevisionSha256: string;
}

export interface CivilLandscapeRoundtripProbeClaim {
  capabilityId: string;
  format: CivilLandscapeOutputFormat;
  revisionId: string;
  revisionSha256: string;
  evidenceSha256: string;
  claim: 'internal-roundtrip-probe-verified';
  releaseReady: false;
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
};

/**
 * Internal-only receipt builder. The caller must pass the result returned by
 * an actually executed parser; this function does not execute or infer one.
 * The resulting receipt is deliberately non-release and is revalidated below
 * before it can be recorded as a probe claim.
 */
export function buildCivilLandscapeRoundtripProbeReceipt(input: {
  binding: BoundCivilLandscapeArtifact;
  parserId: string;
  parserResult: {
    status: 'verified';
    sourceArtifactSha256: string;
    parsedRevisionId: string;
    parsedRevisionSha256: string;
    outputBytes: Uint8Array;
  };
  verifierId: string;
  verifierEvidenceBytes: Uint8Array;
}): Uint8Array {
  const capability = getCivilLandscapeOutputCapability(input.binding.capabilityId);
  if (!capability || capability.kind !== 'roundtrip' || !capability.exporterPath || !capability.parserPath || capability.verifierPaths.length === 0) {
    throw new Error('CIVIL_LANDSCAPE_ROUNDTRIP_VERIFIER_REQUIRED');
  }
  if (!validBoundArtifact(input.binding, capability)) throw new Error('CIVIL_LANDSCAPE_ARTIFACT_BINDING_INVALID');
  if (input.parserResult.status !== 'verified'
    || !input.parserId.trim() || input.parserId !== capability.parserPath
    || input.parserResult.sourceArtifactSha256 !== input.binding.artifactSha256
    || input.parserResult.parsedRevisionId !== input.binding.revisionId
    || input.parserResult.parsedRevisionSha256 !== input.binding.revisionSha256
    || input.parserResult.outputBytes.byteLength === 0
    || !capability.verifierPaths.includes(input.verifierId)
    || input.verifierEvidenceBytes.byteLength === 0) {
    throw new Error('CIVIL_LANDSCAPE_ROUNDTRIP_RESULT_MISMATCH');
  }
  const receipt: CivilLandscapeRoundtripProbeReceipt = {
    schema: 'nexyfab.civil-landscape-roundtrip-probe.v1',
    capabilityId: input.binding.capabilityId,
    format: input.binding.format,
    sourceArtifactSha256: input.binding.artifactSha256,
    revisionId: input.binding.revisionId,
    revisionSha256: input.binding.revisionSha256,
    parserId: input.parserId,
    parserResult: 'verified',
    parserOutputSha256: sha256(input.parserResult.outputBytes),
    verifierId: input.verifierId,
    verifierEvidenceSha256: sha256(input.verifierEvidenceBytes),
    parsedRevisionId: input.parserResult.parsedRevisionId,
    parsedRevisionSha256: input.parserResult.parsedRevisionSha256,
  };
  return new TextEncoder().encode(canonicalJson(receipt));
}

/** A generated artifact alone can never be promoted to a round-trip claim. */
export function claimCivilLandscapeRoundtrip(input: {
  binding: BoundCivilLandscapeArtifact;
  evidenceBytes: Uint8Array;
}): CivilLandscapeRoundtripProbeClaim {
  const capability = getCivilLandscapeOutputCapability(input.binding.capabilityId);
  if (!capability || capability.kind !== 'roundtrip' || !capability.exporterPath || !capability.parserPath || capability.verifierPaths.length === 0) {
    throw new Error('CIVIL_LANDSCAPE_ROUNDTRIP_VERIFIER_REQUIRED');
  }
  if (!validBoundArtifact(input.binding, capability)) throw new Error('CIVIL_LANDSCAPE_ARTIFACT_BINDING_INVALID');
  if (capability.runState !== 'VERIFIED') throw new Error('CIVIL_LANDSCAPE_ROUNDTRIP_NOT_RUN');
  let evidence: CivilLandscapeRoundtripProbeReceipt;
  try {
    evidence = JSON.parse(new TextDecoder().decode(input.evidenceBytes)) as CivilLandscapeRoundtripProbeReceipt;
  } catch {
    throw new Error('CIVIL_LANDSCAPE_ROUNDTRIP_EVIDENCE_INVALID');
  }
  if (canonicalJson(evidence) !== new TextDecoder().decode(input.evidenceBytes)) throw new Error('CIVIL_LANDSCAPE_ROUNDTRIP_EVIDENCE_NON_CANONICAL');
  if (evidence.schema !== 'nexyfab.civil-landscape-roundtrip-probe.v1' || evidence.capabilityId !== input.binding.capabilityId || evidence.format !== input.binding.format || evidence.sourceArtifactSha256 !== input.binding.artifactSha256 || evidence.parserResult !== 'verified' || !SHA256.test(evidence.sourceArtifactSha256) || !SHA256.test(evidence.revisionSha256) || !SHA256.test(evidence.parsedRevisionSha256) || !SHA256.test(evidence.parserOutputSha256) || !SHA256.test(evidence.verifierEvidenceSha256) || !capability.verifierPaths.includes(evidence.verifierId)) {
    throw new Error('CIVIL_LANDSCAPE_ROUNDTRIP_EVIDENCE_BINDING_MISMATCH');
  }
  if (evidence.revisionId !== input.binding.revisionId || evidence.revisionSha256 !== input.binding.revisionSha256 || evidence.parsedRevisionId !== input.binding.revisionId || evidence.parsedRevisionSha256 !== input.binding.revisionSha256 || evidence.parserId !== capability.parserPath) {
    throw new Error('CIVIL_LANDSCAPE_ROUNDTRIP_STALE_REVISION');
  }
  const evidenceSha256 = sha256(input.evidenceBytes);
  return {
    capabilityId: input.binding.capabilityId,
    format: input.binding.format,
    revisionId: input.binding.revisionId,
    revisionSha256: input.binding.revisionSha256,
    evidenceSha256,
    claim: 'internal-roundtrip-probe-verified',
    releaseReady: false,
  };
}
