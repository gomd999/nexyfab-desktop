import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_ARTIFACT_ROLES,
  commercialArtifactManifestSha256,
  commercialCanonicalBytes,
  commercialParserBindingSha256,
  commercialSha256,
  commercialSignaturePayload,
  commercialTargetSha256,
  qualifyArchitectureInteriorCommercial,
  type ArchitectureInteriorCommercialQualificationInput,
  type CommercialArtifact,
  type CommercialDisciplineInput,
  type TrustedCommercialIdentity,
} from './architectureInteriorCommercialQualification';
import { buildBuildingReleaseCertificate, type BoundBuildingEvidence, type BuildingAxisEvidence, type BuildingDeliverableEvidence, type BuildingRegistryPolicyEvidence, type BuildingReleaseCertificate, type BuildingReleaseCertificateInput, type BuildingSiteCoordinateEvidence } from './buildingReleaseCertificate';
import { buildInteriorReleaseCertificate, type BoundInteriorEvidence, type InteriorAxisEvidence, type InteriorDeliverableEvidence, type InteriorHostAuthorityEvidence, type InteriorReleaseCertificate, type InteriorReleaseCertificateInput } from './interiorReleaseCertificate';
import { verifyCrossDomainDesign } from './crossDomainVerification';
import { createDesignWorkspaceRevision } from './designWorkspaceRevision';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from './designArtifactGraph';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import type { IfcDeepSemanticRoundtripReport, IfcDeepSemanticSnapshot } from '@/lib/bim/ifcDeepSemanticRoundtrip';
import { CAD_WORKSPACE_ENVELOPE_SCHEMA, hashCadPayload, type CadWorkspaceEnvelopeInput } from '@/lib/cad/workspaceRevisionStore';

const hash = (value: string) => value.repeat(64);
const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'utf8'));

function emptyTrack<C, I>(certificate: C, internalInput: I, domain: 'building' | 'interior'): CommercialDisciplineInput<C, I> {
  const workspace = {
    schema: 'nexyfab.cad-workspace-envelope.v1',
    workspace: { projectId: `${domain}-project`, revision: 0, domain, documentHash: hash('d') },
    geometry: { fidelity: 'exact_brep', contentHash: hash('g'), shapeIdentityHash: hash('s') },
  } as unknown as CommercialDisciplineInput<C, I>['workspace'];
  return {
    workspace,
    identity: { workspaceId: `${domain}-project`, revision: 0, modelContentHash: hash('g'), hostIdentity: `${domain}-host` },
    internalInput,
    certificate,
    certificateBytes: bytes('{}'),
    certificateSha256: hash('z'),
    artifacts: [],
    parserReceipt: {
      reviewerId: 'parser', role: 'native_parser', keyFingerprintSha256: hash('p'),
      parserBinaryBytes: bytes('binary'), parserBinarySha256: hash('b'), parserSourceBytes: bytes('source'), parserSourceBytesSha256: hash('s'),
      parserId: 'external-native-parser', nativeFormat: 'step-ifc-drawing-set', externalNative: true, parsedArtifactRoles: [], parserOutputBytes: bytes('output'), parserOutputSha256: hash('o'), parserOutputSize: 6, result: 'verified',
      artifactManifestSha256: hash('a'), revision: 0, buildId: 'build', targetSha256: hash('t'), signatureBase64: 'invalid',
    },
    approvals: [],
  };
}

function malformedInput(mode: 'fixture' | 'runtime' = 'fixture'): ArchitectureInteriorCommercialQualificationInput {
  return {
    mode,
    building: emptyTrack({ releaseReady: true, status: 'pass', workspaceRevision: 0, modelContentHash: hash('g') } as unknown as BuildingReleaseCertificate, undefined as unknown as BuildingReleaseCertificateInput, 'building'),
    interior: emptyTrack({ releaseReady: true, status: 'pass', workspaceRevision: 0, modelContentHash: hash('g') } as unknown as InteriorReleaseCertificate, undefined as unknown as InteriorReleaseCertificateInput, 'interior'),
    trustedRegistry: [],
  };
}

function buildingDocument(): ArchitectureDocument {
  const boundary: [number, number][] = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]];
  return {
    schema: 'nexyfab.architecture.v1', revision: 0, siteCoordinateSystemId: 'EPSG:5186', projectNorthDeg: 12,
    storeys: [{ id: 'l1', name: 'L1', elevationMm: 0, heightMm: 3000 }], grids: [{ id: 'g1', name: 'A', axis: 'x', startMm: [0, 0], endMm: [4000, 0] }],
    spaces: [{ id: 'r1', storeyId: 'l1', name: 'Office', usage: 'office', boundaryMm: boundary, wallIds: ['w1', 'w2', 'w3', 'w4'], slabId: 's1', ceilingId: 'c1' }],
    walls: [
      { id: 'w1', kind: 'line', storeyId: 'l1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 }, { id: 'w2', kind: 'line', storeyId: 'l1', startMm: [4000, 0], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 },
      { id: 'w3', kind: 'line', storeyId: 'l1', startMm: [4000, 3000], endMm: [0, 3000], thicknessMm: 200, heightMm: 3000 }, { id: 'w4', kind: 'line', storeyId: 'l1', startMm: [0, 3000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 },
    ],
    slabs: [{ id: 's1', storeyId: 'l1', spaceId: 'r1', boundaryMm: boundary, thicknessMm: 180 }], ceilings: [{ id: 'c1', storeyId: 'l1', spaceId: 'r1', boundaryMm: boundary, elevationMm: 2600 }],
    openings: [{ id: 'd1', kind: 'door', hostWallId: 'w1', offsetMm: 2000, widthMm: 900, heightMm: 2100, sillMm: 0, positionMm: [2000, 0, 0], connectsSpaceIds: ['r1'], isExit: true }],
  };
}

function artifactGraph(projectId: string): DesignArtifactGraph {
  return { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId, revision: 0, artifacts: ([['model', 'model', 'b'], ['drawing', 'drawing', 'c'], ['quantity', 'quantity', 'd'], ['ifc', 'ifc', 'e']] as const).map(([id, kind, content]) => ({ id, kind, revision: 0, contentHash: hash(content), state: 'current', inputs: [], staleBecause: [], verification: { status: 'passed', verifierId: `${id}-verifier`, evidenceHash: hash('f'), issues: [] } })), dependencies: [] };
}

function buildingWorkspace(): CadWorkspaceEnvelopeInput {
  const document = buildingDocument(); const requirements = { programme: 'office', occupancy: 10 }; const relations = [{ from: 'd1', to: 'w1', type: 'hosted_by' }];
  return { schema: CAD_WORKSPACE_ENVELOPE_SCHEMA, workspace: createDesignWorkspaceRevision({ projectId: 'building-project', lineageId: 'building-lineage', domain: 'building', documentHash: hashCadPayload(document) }), requirements: { contentHash: hashCadPayload(requirements), payload: requirements }, semanticDocument: { schema: document.schema, contentHash: hashCadPayload(document), payload: document }, geometry: { fidelity: 'exact_brep', contentHash: hash('b'), shapeIdentityHash: hash('1') }, objectRelations: { contentHash: hashCadPayload(relations), payload: relations }, artifactGraph: artifactGraph('building-project'), provenance: [{ sourceId: 'architect-input', kind: 'expert', contentHash: hash('2') }], kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('3'), wasmSha256: hash('4'), stubFallback: false } };
}

const buildingAxis = (): BuildingAxisEvidence => ({ status: 'pass', expected: 4, checked: 4, issues: [], artifactHashes: [hash('5')] });
function completeBuildingInput(): BuildingReleaseCertificateInput {
  const workspace = buildingWorkspace();
  const bound = <T>(payload: T): BoundBuildingEvidence<T> => ({ workspaceRevision: 0, modelContentHash: hash('b'), contentHash: hashCadPayload(payload), payload });
  const site: BuildingSiteCoordinateEvidence = { status: 'pass', linearUnit: 'mm', angularUnit: 'deg', crsId: 'EPSG:5186', verticalDatumId: 'KVD2002', projectNorthDeg: 12, projectToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1000, 2000, 30, 1], issues: [], artifactHashes: [hash('6')] };
  const deliverables: BuildingDeliverableEvidence = { ...buildingAxis(), requiredDrawings: 4, verifiedDrawings: 4, expectedScheduleRows: 8, verifiedScheduleRows: 8, expectedQuantityItems: 6, verifiedQuantityItems: 6 };
  const registry: BuildingRegistryPolicyEvidence = { status: 'quarantined', usedForRelease: false, sourceIssueCount: 2303, issues: ['source_workbooks_not_authoritative'], artifactHashes: [hash('7')] };
  const snapshot: IfcDeepSemanticSnapshot = { schema: 'IFC4', occurrences: [{ globalId: 'wall-guid', ifcClass: 'IFCWALL', parentGlobalId: 'storey-guid' }], placements: [{ globalId: 'wall-guid', status: 'available', worldTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }], propertySets: [{ occurrenceGlobalId: 'wall-guid', psetGlobalId: 'pset-guid', name: 'Pset_WallCommon', values: [{ name: 'IsExternal', ifcClass: 'IFCPROPERTYSINGLEVALUE', value: '.T.', unit: null }] }], classifications: [{ occurrenceGlobalId: 'wall-guid', relationGlobalId: 'rel-guid', scheme: 'Uniclass', code: 'EF_25', name: 'Walls', reference: 'EF_25' }], quantities: [{ occurrenceGlobalId: 'wall-guid', setGlobalId: 'q-guid', setName: 'Qto_WallBaseQuantities', name: 'NetArea', ifcClass: 'IFCQUANTITYAREA', value: '12', unit: 'm2' }], georeference: ['IFCPROJECTEDCRS(EPSG:5186)', 'IFCMAPCONVERSION(1000,2000)'], duplicateGlobalIds: [], unresolvedPlacementGlobalIds: [] };
  const ifc: IfcDeepSemanticRoundtripReport = { schema: 'nexyfab.ifc-deep-semantic-roundtrip.v1', passed: true, requirements: { occurrences: true, hierarchy: true, placements: true, propertySets: true, classifications: true, quantities: true, georeference: true }, before: snapshot, after: structuredClone(snapshot), errors: [], changes: { occurrenceIds: [], hierarchyIds: [], placementIds: [], propertySetKeys: [], classificationKeys: [], quantityKeys: [] } };
  return { workspace, siteCoordinates: bound(site), accessibility: bound(buildingAxis()), envelopeContinuity: bound(buildingAxis()), crossDomain: bound(verifyCrossDomainDesign({ structure: { valid: true }, placement: { required: 7, resolved: 7, invalid: 0 }, interior: { applicable: true, spaceBoundary: { ran: true, openBoundaries: 0, conservative: true }, egress: { ran: true, passed: true, conservative: true }, doorSwing: { ran: true, clear: true, conservative: true }, mepInterference: { ran: true, collisions: 0, missingGeometry: 0, conservative: true } } })), ifcRoundtrip: bound(ifc), deliverables: bound(deliverables), repair: bound(buildingAxis()), registryPolicy: bound(registry) };
}

function interiorDocument(): InteriorDocument { return { schema: 'nexyfab.interior.v1', revision: 0, architectureDocumentId: 'architecture', fieldMeasurement: { sourceRef: 'scan:verified', measuredAt: '2026-08-09T00:00:00Z', architectureRevision: 0, toleranceMm: 5 }, lights: [{ id: 'light', spaceId: 'r1', hostCeilingId: 'c1', positionMm: [2000, 1500, 2500], suspensionMm: 100, lumens: 5000, cctK: 4000, iesProfileId: 'ies:verified' }], furniture: [{ id: 'desk', spaceId: 'r1', positionMm: [2000, 1500, 0], sizeMm: [1200, 600, 750], clearanceMm: 400 }], finishes: [{ id: 'finish', spaceId: 'r1', hostId: 's1', surface: 'floor', material: 'oak' }], millwork: [{ id: 'casework', spaceId: 'r1', hostWallId: 'w3', positionMm: [2000, 2900, 0], sizeMm: [1200, 400, 900], material: 'plywood', clearanceMm: 300 }], ceilingSystems: [{ id: 'grid', spaceId: 'r1', hostCeilingId: 'c1', kind: 'grid', elevationMm: 2600, moduleMm: [600, 600] }], acousticZones: [{ id: 'acoustic', spaceId: 'r1', targetRt60Sec: 0.6, absorptionClass: 'A' }] }; }
function interiorWorkspace(): CadWorkspaceEnvelopeInput { const document = interiorDocument(); const requirements = { occupancy: 'office' }; const relations: unknown[] = []; return { schema: CAD_WORKSPACE_ENVELOPE_SCHEMA, workspace: createDesignWorkspaceRevision({ projectId: 'interior-project', lineageId: 'interior-lineage', domain: 'interior', documentHash: hashCadPayload(document) }), requirements: { contentHash: hashCadPayload(requirements), payload: requirements }, semanticDocument: { schema: document.schema, contentHash: hashCadPayload(document), payload: document }, geometry: { fidelity: 'exact_brep', contentHash: hash('b'), shapeIdentityHash: hash('1') }, objectRelations: { contentHash: hashCadPayload(relations), payload: relations }, artifactGraph: artifactGraph('interior-project'), provenance: [{ sourceId: 'scan', kind: 'import', contentHash: hash('2') }], kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('3'), wasmSha256: hash('4'), stubFallback: false } }; }
const interiorAxis = (): InteriorAxisEvidence => ({ status: 'pass', expected: 3, checked: 3, issues: [], artifactHashes: [hash('5')] });
function completeInteriorInput(): InteriorReleaseCertificateInput {
  const workspace = interiorWorkspace(); const architecture = buildingDocument(); architecture.revision = 0;
  const bound = <T>(payload: T): BoundInteriorEvidence<T> => ({ workspaceRevision: 0, modelContentHash: hash('b'), contentHash: hashCadPayload(payload), payload });
  const host: InteriorHostAuthorityEvidence = { ...interiorAxis(), architectureDocumentId: 'architecture', architectureContentHash: hashCadPayload(architecture), coordinateSystemId: 'project-local', architecture, federatedValidationIssues: [] };
  const deliverables: InteriorDeliverableEvidence = { ...interiorAxis(), requiredDrawings: 5, verifiedDrawings: 5, expectedScheduleRows: 7, verifiedScheduleRows: 7, expectedQuantityItems: 8, verifiedQuantityItems: 8 };
  return { workspace, hostAuthority: bound(host), spatial: bound(interiorAxis()), ceilingMep: bound(interiorAxis()), finishes: bound(interiorAxis()), millwork: bound(interiorAxis()), lighting: bound(interiorAxis()), acoustics: bound(interiorAxis()), ifcRoundtrip: bound(interiorAxis()), deliverables: bound(deliverables), repair: bound(interiorAxis()) };
}

type KeyPair = ReturnType<typeof generateKeyPairSync>;
function identity(reviewerId: string, role: TrustedCommercialIdentity['role'], keys: KeyPair): TrustedCommercialIdentity { const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(); const fingerprintSha256 = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'); return { reviewerId, role, publicKeyPem, fingerprintSha256 }; }
function signedTrack<C, I>(discipline: 'building' | 'interior', internalInput: I, certificate: C, hostIdentity: string): { track: CommercialDisciplineInput<C, I>; registry: TrustedCommercialIdentity[] } {
  const workspace = (internalInput as { workspace: CadWorkspaceEnvelopeInput }).workspace; const certificateBytes = commercialCanonicalBytes(certificate); const certificateSha256 = commercialSha256(certificateBytes); const buildId = `${discipline}-build`;
  const artifacts: CommercialArtifact[] = COMMERCIAL_ARTIFACT_ROLES.map(role => { const artifactBytes = bytes(`${discipline}-${role}`); return { artifactId: `${discipline}-${role}`, role, bytes: artifactBytes, sha256: commercialSha256(artifactBytes), size: artifactBytes.length, revision: workspace.workspace.revision, buildId, evidenceOrigin: 'external' }; });
  const manifest = commercialArtifactManifestSha256(artifacts); const parserKeys = generateKeyPairSync('ed25519'); const architectKeys = generateKeyPairSync('ed25519'); const cadKeys = generateKeyPairSync('ed25519');
  const registry = [identity(`${discipline}-parser`, 'native_parser', parserKeys), identity(`${discipline}-architect`, 'architect', architectKeys), identity(`${discipline}-cad-reviewer`, 'independent_cad_bim_reviewer', cadKeys)];
  const parserOutputBytes = bytes(`${discipline}-native-output`); const parserBinaryBytes = bytes(`${discipline}-native-binary`); const parserSourceBytes = bytes(`${discipline}-native-source`);
  const parserReceipt = { reviewerId: registry[0]!.reviewerId, role: 'native_parser' as const, keyFingerprintSha256: registry[0]!.fingerprintSha256, parserBinaryBytes, parserBinarySha256: commercialSha256(parserBinaryBytes), parserSourceBytes, parserSourceBytesSha256: commercialSha256(parserSourceBytes), parserId: `${discipline}-external-native`, nativeFormat: 'step-ifc-drawing-set' as const, externalNative: true as const, parsedArtifactRoles: [...COMMERCIAL_ARTIFACT_ROLES], parserOutputBytes, parserOutputSha256: commercialSha256(parserOutputBytes), parserOutputSize: parserOutputBytes.length, result: 'verified' as const, artifactManifestSha256: manifest, revision: workspace.workspace.revision, buildId, targetSha256: '', signatureBase64: '' };
  const workspaceIdentity = { workspaceId: workspace.workspace.projectId, revision: workspace.workspace.revision, modelContentHash: workspace.geometry.contentHash, hostIdentity };
  parserReceipt.targetSha256 = commercialTargetSha256(discipline, workspaceIdentity, certificateSha256, manifest, commercialParserBindingSha256(parserReceipt));
  parserReceipt.signatureBase64 = sign(null, commercialSignaturePayload({ discipline, targetSha256: parserReceipt.targetSha256, reviewerId: parserReceipt.reviewerId, role: parserReceipt.role, keyFingerprintSha256: parserReceipt.keyFingerprintSha256 }), parserKeys.privateKey).toString('base64');
  const approvals = ([['architect', registry[1]!, architectKeys], ['independent_cad_bim_reviewer', registry[2]!, cadKeys]] as const).map(([role, reviewer, keys]) => { const approval = { reviewerId: reviewer.reviewerId, role, keyFingerprintSha256: reviewer.fingerprintSha256, reviewedAt: '2026-08-20T00:00:00.000Z', targetSha256: parserReceipt.targetSha256, artifactManifestSha256: manifest, artifactRoles: [...COMMERCIAL_ARTIFACT_ROLES], signatureBase64: '' }; approval.signatureBase64 = sign(null, commercialSignaturePayload({ discipline, targetSha256: approval.targetSha256, reviewerId: approval.reviewerId, role: approval.role, keyFingerprintSha256: approval.keyFingerprintSha256, reviewedAt: approval.reviewedAt, artifactManifestSha256: approval.artifactManifestSha256, artifactRoles: [...approval.artifactRoles].sort() }), keys.privateKey).toString('base64'); return approval; });
  return { track: { workspace, identity: workspaceIdentity, internalInput, certificate, certificateBytes, certificateSha256, artifacts, parserReceipt, approvals }, registry };
}

function signedQualificationFixture(): { input: ArchitectureInteriorCommercialQualificationInput; registry: TrustedCommercialIdentity[] } {
  const buildingInput = completeBuildingInput(); const interiorInput = completeInteriorInput(); const building = signedTrack('building', buildingInput, buildBuildingReleaseCertificate(buildingInput), 'building-authority'); const interior = signedTrack('interior', interiorInput, buildInteriorReleaseCertificate(interiorInput), 'architecture'); const registry = [...building.registry, ...interior.registry];
  return { input: { mode: 'runtime', building: building.track, interior: interior.track, trustedRegistry: registry }, registry };
}

describe('architecture/interior commercial qualification boundary', () => {
  it('uses canonical bytes and exact SHA-256 helpers', () => {
    const canonical = commercialCanonicalBytes({ z: 1, a: 'x' });
    expect(Buffer.from(canonical).toString('utf8')).toBe('{"a":"x","z":1}');
    expect(commercialSha256(canonical)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('qualifies complete independently signed runtime building and interior tracks', () => {
    const fixture = signedQualificationFixture();
    const result = qualifyArchitectureInteriorCommercial(fixture.input, new Date('2026-08-22T00:00:00.000Z'), { mode: 'runtime', trustedRegistry: fixture.registry });
    expect(result.blockers).toEqual([]);
    expect(result).toMatchObject({ status: 'QUALIFIED', releaseReady: true, building: { status: 'QUALIFIED' }, interior: { status: 'QUALIFIED' } });
  });

  it('holds when parser output is mutated and rehashed without re-signing its target', () => {
    const fixture = signedQualificationFixture();
    const output = bytes('mutated-parser-output');
    fixture.input.building.parserReceipt.parserOutputBytes = output;
    fixture.input.building.parserReceipt.parserOutputSize = output.length;
    fixture.input.building.parserReceipt.parserOutputSha256 = commercialSha256(output);
    const result = qualifyArchitectureInteriorCommercial(fixture.input, new Date('2026-08-22T00:00:00.000Z'), { mode: 'runtime', trustedRegistry: fixture.registry });
    expect(result.status).toBe('HOLD');
    expect(result.building.blockers.join('|')).toMatch(/parser_receipt_target_binding_mismatch|parser_signature_invalid/);
  });

  it('does not accept claimant-supplied trust roots without verifier context', () => {
    const fixture = signedQualificationFixture();
    const result = qualifyArchitectureInteriorCommercial(fixture.input, new Date('2026-08-22T00:00:00.000Z'));
    expect(result.status).toBe('HOLD');
    expect(result.blockers.join('|')).toContain('trust_registry_collection_invalid');
  });

  it('rejects a certificate mutated and canonically rehashed after internal reconstruction', () => {
    const fixture = signedQualificationFixture();
    fixture.input.building.certificate = { ...fixture.input.building.certificate, internalReady: false };
    fixture.input.building.certificateBytes = commercialCanonicalBytes(fixture.input.building.certificate);
    fixture.input.building.certificateSha256 = commercialSha256(fixture.input.building.certificateBytes);
    const result = qualifyArchitectureInteriorCommercial(fixture.input, new Date('2026-08-22T00:00:00.000Z'), { mode: 'runtime', trustedRegistry: fixture.registry });
    expect(result.status).toBe('HOLD');
    expect(result.building.blockers).toContain('building:internal_readiness_certificate_mismatch');
  });

  it('requires exact interior host identity and one artifact build identity', () => {
    const fixture = signedQualificationFixture();
    fixture.input.interior.identity.hostIdentity = 'prefix-architecture-suffix';
    fixture.input.building.artifacts = fixture.input.building.artifacts.map((artifact, index) => index === 0 ? { ...artifact, buildId: 'mixed-build' } : artifact);
    const result = qualifyArchitectureInteriorCommercial(fixture.input, new Date('2026-08-22T00:00:00.000Z'), { mode: 'runtime', trustedRegistry: fixture.registry });
    expect(result.interior.blockers).toContain('interior:architecture_host_identity_not_bound');
    expect(result.building.blockers).toContain('building:artifact_build_id_set_invalid');
  });

  it('holds synthetic legacy certificates even when their flags claim release readiness', () => {
    const result = qualifyArchitectureInteriorCommercial(malformedInput());
    expect(result.status).toBe('HOLD');
    expect(result.releaseReady).toBe(false);
    expect(result.blockers.join('|')).toContain('synthetic_or_missing_internal_certificate');
  });

  it('fails closed for oversized/malformed certificate and artifact inputs', () => {
    const input = malformedInput('runtime');
    input.building.certificateBytes = new Uint8Array(2 * 1024 * 1024 + 1);
    input.interior.artifacts = [{
      artifactId: 'fake', role: 'step', bytes: bytes('x'), size: 1, sha256: hash('x'), revision: 0, buildId: 'build', evidenceOrigin: 'fixture',
    } as CommercialArtifact];
    const result = qualifyArchitectureInteriorCommercial(input);
    expect(result.status).toBe('HOLD');
    expect(result.blockers.join('|')).toMatch(/certificate_bytes_invalid_or_oversized|exact_artifact_set_required/);
    expect(result.blockers.join('|')).toContain('runtime_external_evidence_required');
  });

  it('does not allow a caller-controlled future clock to make an old approval fresh', () => {
    const result = qualifyArchitectureInteriorCommercial(malformedInput(), new Date('2026-08-22T00:00:00.000Z'));
    expect(result.building.runtimeEvidenceBoundary.externalEvidenceRequired).toBe(true);
    expect(result.interior.runtimeEvidenceBoundary.externalEvidenceRequired).toBe(true);
    expect(result.status).toBe('HOLD');
  });
});
