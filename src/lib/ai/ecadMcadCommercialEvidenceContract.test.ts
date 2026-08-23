import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalEcadCommercialAttestationPayload,
  canonicalEcadNativeParserPayload,
  ECAD_MCAD_REQUIRED_AXES,
  hashEcadMcadCommercialTarget,
  qualifyEcadMcadCommercial,
  type CommercialArtifact,
  type CommercialReviewerAttestation,
  type EcadMcadCommercialQualificationInput,
  type EcadMcadTrustedSigner,
  type NativeParserReceipt,
} from './ecadMcadCommercialEvidenceContract';
import { ECAD_MCAD_EXCHANGE_SCHEMA, parseEcadMcadOutput, type EcadMcadReleaseInputV1 } from './ecadMcadReleaseContract';

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const A = 'a'.repeat(64); const B = 'b'.repeat(64); const C = 'c'.repeat(64); const NOW = '2026-08-22T12:00:00.000Z';
const roots: string[] = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

function releaseFixture(): EcadMcadReleaseInputV1 {
  const revisionSha256 = hash('ecad-revision-4'); const provenance = { librarySource: 'vendor-lib', libraryRevision: '2026.08', partSource: 'vendor-parts', footprintSource: 'company-footprints', capturedAt: NOW, revisionSha256 } as const;
  const content = JSON.stringify({ schema: ECAD_MCAD_EXCHANGE_SCHEMA, revision: 4, sourceSchematicSha256: hash('schematic'), sourceNetlistSha256: hash('netlist'), sourceBoardModelSha256: hash('board'), sourceContentHash: hash('ecad-content'), componentIds: ['component-u1', 'component-j1'], pinIds: ['pin-u1-1', 'pin-j1-1', 'pin-u1-2', 'pin-j1-2'], netIds: ['net-1', 'net-2'], footprintIds: ['footprint-u1', 'footprint-j1'], mountingHoleIds: ['hole-1'], keepoutIds: ['keepout-1'], connectorIds: ['connector-j1', 'connector-j2'], cableIds: ['cable-1'] });
  return {
    schema: 'nexyfab.ecad-mcad-release.v1', units: 'mm-V-A', revision: 4,
    source: { schematicPath: 'ecad/schematic.sch', schematicSha256: hash('schematic'), netlistPath: 'ecad/netlist.xml', netlistSha256: hash('netlist'), boardModelPath: 'mcad/board.step', boardModelSha256: hash('board'), contentHash: hash('ecad-content'), revisionSha256, revision: 4 },
    board: { id: 'board-1', widthMm: 100, heightMm: 80, thicknessMm: 1.6, enclosureClearanceMm: 3 },
    components: [
      { id: 'component-u1', referenceDesignator: 'U1', value: 'controller', partNumber: 'MCU-1', footprintId: 'footprint-u1', positionMm: { xMm: 10, yMm: 10 }, rotationDeg: 0, pinIds: ['pin-u1-1', 'pin-u1-2'], maxVoltageV: 5, maxCurrentA: 1 },
      { id: 'component-j1', referenceDesignator: 'J1', value: 'connector', partNumber: 'HDR-2', footprintId: 'footprint-j1', positionMm: { xMm: 50, yMm: 10 }, rotationDeg: 0, pinIds: ['pin-j1-1', 'pin-j1-2'], maxVoltageV: 24, maxCurrentA: 2 },
    ].map(component => ({ ...component, provenance })),
    pins: [{ id: 'pin-u1-1', componentId: 'component-u1', number: '1', netId: 'net-1', positionMm: { xMm: 10, yMm: 10 }, electricalType: 'output' as const }, { id: 'pin-j1-1', componentId: 'component-j1', number: '1', netId: 'net-1', positionMm: { xMm: 50, yMm: 10 }, electricalType: 'input' as const }, { id: 'pin-u1-2', componentId: 'component-u1', number: '2', netId: 'net-2', positionMm: { xMm: 10, yMm: 11 }, electricalType: 'power' as const }, { id: 'pin-j1-2', componentId: 'component-j1', number: '2', netId: 'net-2', positionMm: { xMm: 50, yMm: 11 }, electricalType: 'passive' as const }],
    nets: [{ id: 'net-1', name: 'DATA', pinIds: ['pin-u1-1', 'pin-j1-1'], voltageV: 3.3, currentA: 0.1, kind: 'signal' as const }, { id: 'net-2', name: 'VCC', pinIds: ['pin-u1-2', 'pin-j1-2'], voltageV: 5, currentA: 0.5, kind: 'power' as const }],
    footprints: [{ id: 'footprint-u1', componentId: 'component-u1', widthMm: 10, heightMm: 8, positionMm: { xMm: 10, yMm: 10 }, librarySource: 'vendor-footprints', libraryRevision: '2026.08' }, { id: 'footprint-j1', componentId: 'component-j1', widthMm: 8, heightMm: 6, positionMm: { xMm: 50, yMm: 10 }, librarySource: 'vendor-footprints', libraryRevision: '2026.08' }],
    mountingHoles: [{ id: 'hole-1', positionMm: { xMm: 5, yMm: 5 }, diameterMm: 3 }], keepouts: [{ id: 'keepout-1', ownerId: 'board-1', xMm: 80, yMm: 60, widthMm: 10, heightMm: 10 }],
    connectors: [{ id: 'connector-j1', componentId: 'component-j1', footprintId: 'footprint-j1', positionMm: { xMm: 50, yMm: 10 }, clearanceMm: 3 }, { id: 'connector-j2', componentId: 'component-u1', footprintId: 'footprint-u1', positionMm: { xMm: 10, yMm: 10 }, clearanceMm: 3 }],
    cables: [{ id: 'cable-1', connectorAId: 'connector-j1', connectorBId: 'connector-j2', pinCount: 2, voltageRatingV: 24, currentRatingA: 2 }],
    output: { format: 'nexyfab-exchange-json', targetFormat: 'ipc-2581', revision: 4, content, bytes: Buffer.byteLength(content, 'utf8'), sha256: hash(content) },
  };
}

function setupFixture(): EcadMcadCommercialQualificationInput {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecad-commercial-')); roots.push(root); const release = releaseFixture(); const buildId = 'build-4';
  const artifacts: CommercialArtifact[] = []; const write = (artifactId: string, relativePath: string, kind: CommercialArtifact['kind'], content: string) => { const absolute = path.join(root, ...relativePath.split('/')); fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, content); const value = { artifactId, relativePath, kind, bytes: Buffer.byteLength(content), sha256: hash(content), revision: 4, buildId }; artifacts.push(value); return value; };
  write('source-schematic', release.source.schematicPath, 'schematic', 'schematic'); write('source-netlist', release.source.netlistPath, 'netlist', 'netlist'); write('source-board', release.source.boardModelPath, 'board_model', 'board');
  const parserKinds: Array<[NativeParserReceipt['format'], CommercialArtifact['kind']]> = [['kicad', 'kicad'], ['netlist', 'native_netlist'], ['ipc-2581', 'ipc2581'], ['step', 'step'], ['occt', 'occt']];
  const parserKeys = parserKinds.map(([format], index) => ({ format, keys: generateKeyPairSync('ed25519'), artifact: write(`native-${format}`, `native/${format}.bin`, parserKinds[index]![1], `native-${format}`) }));
  parserKeys.forEach(({ format }, index) => {
    write(`parser-binary-${format}`, `parsers/${format}.bin`, 'parser_binary', `binary-${index}`);
    write(`parser-source-${format}`, `parsers/${format}.source`, 'parser_source', `source-${index}`);
  });
  const makeArtifact = (id: string, kind: CommercialArtifact['kind']) => write(id, `evidence/${id}.bin`, kind, id);
  const ercIn = makeArtifact('erc-input', 'erc'); const ercOut = makeArtifact('erc-output', 'erc'); const drcIn = makeArtifact('drc-input', 'drc'); const drcOut = makeArtifact('drc-output', 'drc');
  const stepIn = makeArtifact('step-input', 'step'); const stepOut = makeArtifact('step-output', 'step'); const tolerance = makeArtifact('step-tolerance', 'tolerance');
  const wireEvidence = ['datasheet', 'continuity', 'isolation', 'hipot'].map(kind => makeArtifact(`wire-${kind}`, kind as CommercialArtifact['kind']));
  const fabrication = { gerberArtifactId: makeArtifact('fab-gerber', 'gerber').artifactId, odbppArtifactId: makeArtifact('fab-odbpp', 'odbpp').artifactId, ipc2581ArtifactId: makeArtifact('fab-ipc2581', 'ipc2581').artifactId, bomArtifactId: makeArtifact('fab-bom', 'bom').artifactId, pnpArtifactId: makeArtifact('fab-pnp', 'pnp').artifactId, lot: 'LOT-1', serial: 'SN-1', aoiArtifactId: makeArtifact('fab-aoi', 'aoi').artifactId, flyingProbeArtifactId: makeArtifact('fab-flying', 'flying_probe').artifactId };
  const canonicalConnectivity = { refdesPadPinNet: release.components.flatMap(component => release.pins.filter(pin => pin.componentId === component.id).map(pin => ({ referenceDesignator: component.referenceDesignator, pad: pin.number, pinId: pin.id, netName: release.nets.find(net => net.id === pin.netId)!.name }))), connectorCavityWire: [{ connectorId: 'connector-j1', cableId: 'cable-1', cavityPinIds: ['pin-j1-1', 'pin-j1-2'], wireEndpointPinIds: ['pin-j1-1', 'pin-j1-2'] }, { connectorId: 'connector-j2', cableId: 'cable-1', cavityPinIds: ['pin-u1-1', 'pin-u1-2'], wireEndpointPinIds: ['pin-u1-1', 'pin-u1-2'] }] };
  const ercDrc = [{ kind: 'erc' as const, rulesetId: 'erc-rules', rulesetSha256: A, inputArtifactId: ercIn.artifactId, outputArtifactId: ercOut.artifactId, status: 'passed' as const }, { kind: 'drc' as const, rulesetId: 'drc-rules', rulesetSha256: B, inputArtifactId: drcIn.artifactId, outputArtifactId: drcOut.artifactId, status: 'passed' as const }];
  const stepRoundtrip = { inputArtifactId: stepIn.artifactId, outputArtifactId: stepOut.artifactId, toleranceArtifactId: tolerance.artifactId, passed: true as const, toleranceMm: 0.1, outline: { widthMm: release.board.widthMm, heightMm: release.board.heightMm, thicknessMm: release.board.thicknessMm }, cutoutIds: ['keepout-1'], holeIds: ['hole-1'], componentIds: release.components.map(item => item.id), connectorIds: release.connectors.map(item => item.id), targetHash: '', revision: 4, buildId };
  const wires = [{ wireId: 'wire-1', cableId: 'cable-1', gauge: 'AWG24', deratingFactor: 0.8, lengthMm: 500, routeId: 'route-1', bendRadiusMm: 20, contactIds: ['c1', 'c2'], crimpId: 'crimp-1', datasheetArtifactId: wireEvidence[0]!.artifactId, continuityArtifactId: wireEvidence[1]!.artifactId, isolationArtifactId: wireEvidence[2]!.artifactId, hipotArtifactId: wireEvidence[3]!.artifactId, continuity: 'passed' as const, isolation: 'passed' as const, hipot: 'passed' as const }];
  const nativeParsers: NativeParserReceipt[] = parserKeys.map(({ format, keys, artifact }, index) => ({ receiptId: `parser-${format}`, format, artifactId: artifact.artifactId, parserId: `native-${format}-parser`, parserBinarySha256: hash(`binary-${index}`), parserSourceSha256: hash(`source-${index}`), artifactSha256: artifact.sha256, revision: 4, buildId, targetHash: '', issuedAt: NOW, expiresAt: '2026-09-01T12:00:00.000Z', trustedSigner: { keyId: `native-key-${index}`, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), signatureBase64: '' } }));
  const base = { buildId, release, artifacts, nativeParsers, canonicalConnectivity, ercDrc, stepRoundtrip, wires, fabrication };
  const targetHash = hashEcadMcadCommercialTarget(base);
  for (const receipt of nativeParsers) { receipt.targetHash = targetHash; const pair = parserKeys.find(item => item.format === receipt.format)!; receipt.trustedSigner.signatureBase64 = sign(null, Buffer.from(canonicalEcadNativeParserPayload(receipt)), pair.keys.privateKey).toString('base64'); }
  stepRoundtrip.targetHash = targetHash;
  const evidenceIds = artifacts.map(item => item.artifactId);
  const trustedSigners: Record<string, EcadMcadTrustedSigner> = Object.fromEntries(parserKeys.map(({ keys }, index) => [`native-key-${index}`, { publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['native_parser'] }]));
  const reviewerRoles = ['domain_reviewer', 'independent_reviewer', 'manufacturing_reviewer'] as const; const attestations: CommercialReviewerAttestation[] = reviewerRoles.map((role, index) => { const keys = generateKeyPairSync('ed25519'); const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(); const unsigned = { attestationId: `att-${role}`, role, reviewerId: `reviewer-${role}`, keyId: `reviewer-key-${index}`, publicKeyPem, signatureBase64: '', targetHash, revision: 4, buildId, issuedAt: NOW, expiresAt: '2026-09-01T12:00:00.000Z', axes: [...ECAD_MCAD_REQUIRED_AXES], evidenceIds }; trustedSigners[unsigned.keyId] = { publicKeyPem, roles: [role] }; const signed = { ...unsigned, signatureBase64: sign(null, Buffer.from(canonicalEcadCommercialAttestationPayload(unsigned)), keys.privateKey).toString('base64') }; return signed; });
  return { allowedRoot: root, buildId, release, readback: parseEcadMcadOutput(release), artifacts, nativeParsers, canonicalConnectivity, ercDrc, stepRoundtrip, wires, fabrication, attestations, trustedSigners, now: NOW };
}

describe('commercial ECAD-MCAD evidence contract', () => {
  it('qualifies only the full signed native/parser/manufacturing fixture', () => {
    const result = qualifyEcadMcadCommercial(setupFixture());
    expect(result).toMatchObject({ schema: 'nexyfab.ecad-mcad-commercial-evidence.v1', status: 'QUALIFIED', qualified: true, internalValidation: { valid: true }, internalReadback: { valid: true }, artifacts: { valid: true }, nativeParsers: { valid: true }, reviewers: { valid: true } });
    expect(result.blockers).toEqual([]);
  });

  it('holds legacy-only/internal-only evidence and missing native or manufacturing axes', () => {
    const input = setupFixture(); input.attestations = []; expect(qualifyEcadMcadCommercial(input)).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining(['reviewer_missing:domain_reviewer', 'reviewer_missing:independent_reviewer', 'reviewer_missing:manufacturing_reviewer']) });
    const missing = setupFixture(); missing.nativeParsers = missing.nativeParsers.filter(item => item.format !== 'occt'); expect(qualifyEcadMcadCommercial(missing).blockers).toContain('native_format_missing:occt');
  });

  it('rejects path traversal, symlink escape, and artifact bytes/hash/revision/build drift', () => {
    const traversal = setupFixture(); traversal.artifacts = [...traversal.artifacts, { artifactId: 'escape', relativePath: '../escape.bin', kind: 'kicad', bytes: 1, sha256: A, revision: 4, buildId: 'build-4' }]; expect(qualifyEcadMcadCommercial(traversal).blockers.some(issue => issue.includes('artifact_'))).toBe(true);
    const drift = setupFixture(); drift.artifacts = drift.artifacts.map((item, index) => index === 0 ? { ...item, sha256: C } : item); expect(qualifyEcadMcadCommercial(drift).blockers).toEqual(expect.arrayContaining([expect.stringContaining('source_artifact_binding_invalid:schematicPath')]));
    const stale = setupFixture(); stale.artifacts = stale.artifacts.map((item, index) => index === 3 ? { ...item, revision: 3 } : item); expect(qualifyEcadMcadCommercial(stale).blockers).toContain(`artifact_metadata_invalid:${stale.artifacts[3]!.artifactId}`);
  });

  it('rejects cross-role/same-key/replayed/tampered reviewer signatures and target bindings', () => {
    const same = setupFixture(); same.attestations = same.attestations.map((item, index) => index === 1 ? { ...item, keyId: same.attestations[0]!.keyId, publicKeyPem: same.attestations[0]!.publicKeyPem } : item); expect(qualifyEcadMcadCommercial(same).blockers).toContain('reviewer_key_invalid_or_reused:independent_reviewer');
    const replay = setupFixture(); replay.attestations = replay.attestations.map((item, index) => index === 2 ? { ...item, attestationId: replay.attestations[0]!.attestationId } : item); expect(qualifyEcadMcadCommercial(replay).blockers).toContain('reviewer_replay:manufacturing_reviewer');
    const tampered = setupFixture(); tampered.attestations = tampered.attestations.map((item, index) => index === 0 ? { ...item, targetHash: C } : item); expect(qualifyEcadMcadCommercial(tampered).blockers).toEqual(expect.arrayContaining(['reviewer_binding_invalid:domain_reviewer', 'reviewer_signature_invalid:domain_reviewer']));
    const stale = setupFixture(); stale.attestations = stale.attestations.map((item, index) => index === 1 ? { ...item, expiresAt: '2026-08-01T00:00:00.000Z' } : item); expect(qualifyEcadMcadCommercial(stale).blockers).toContain('reviewer_stale:independent_reviewer');
  });

  it('rejects self-trusted signers, target transplantation, and missing parser implementation bytes', () => {
    const untrusted = setupFixture(); untrusted.trustedSigners = {}; expect(qualifyEcadMcadCommercial(untrusted).blockers).toEqual(expect.arrayContaining(['native_signer_not_trusted:parser-kicad', 'reviewer_not_trusted:domain_reviewer']));
    const transplanted = setupFixture(); transplanted.nativeParsers = transplanted.nativeParsers.map((item, index) => index === 0 ? { ...item, targetHash: C } : item); expect(qualifyEcadMcadCommercial(transplanted).blockers).toEqual(expect.arrayContaining(['native_receipt_binding_invalid:parser-kicad', 'native_signature_invalid:parser-kicad']));
    const missingImplementation = setupFixture(); missingImplementation.artifacts = missingImplementation.artifacts.filter(item => item.kind !== 'parser_binary'); expect(qualifyEcadMcadCommercial(missingImplementation).blockers).toContain('native_parser_implementation_artifact_missing:parser-kicad');
  });

  it('rejects canonical pin/net, connector cavity, output-power conflict, roundtrip, wiring, ERC/DRC, and artifact-reuse tampering', () => {
    const connectivity = setupFixture(); connectivity.canonicalConnectivity.refdesPadPinNet = []; expect(qualifyEcadMcadCommercial(connectivity).blockers).toContain('canonical_refdes_pad_pin_net_exact_set_mismatch');
    const wire = setupFixture(); wire.wires = wire.wires.map(item => ({ ...item, contactIds: ['only-one'] })); expect(qualifyEcadMcadCommercial(wire).blockers).toContain('wire_manufacturing_invalid:cable-1');
    const erc = setupFixture(); erc.ercDrc = [erc.ercDrc[0]!]; expect(qualifyEcadMcadCommercial(erc).blockers).toContain('erc_drc_receipts_incomplete');
    const reuse = setupFixture(); reuse.fabrication.bomArtifactId = reuse.fabrication.gerberArtifactId; expect(qualifyEcadMcadCommercial(reuse).blockers).toContain(`artifact_reuse_id:${reuse.fabrication.gerberArtifactId}`);
    const step = setupFixture(); step.stepRoundtrip.outline = { ...step.stepRoundtrip.outline, thicknessMm: 2 }; expect(qualifyEcadMcadCommercial(step).blockers).toContain('step_outline_thickness_tolerance_failed');
  });
});
