import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assessEcadMcadRelease, ECAD_MCAD_EXCHANGE_SCHEMA, parseEcadMcadOutput, type EcadMcadReleaseInputV1, validateEcadMcadRelease, verifyEcadMcadReadback } from './ecadMcadReleaseContract';

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
function fixture(): EcadMcadReleaseInputV1 {
  const revisionSha256 = hash('ecad-revision-4');
  const provenance = { librarySource: 'vendor-lib', libraryRevision: '2026.08', partSource: 'vendor-parts', footprintSource: 'company-footprints', capturedAt: '2026-08-22T00:00:00Z', revisionSha256 } as const;
  const outputContent = JSON.stringify({ schema: ECAD_MCAD_EXCHANGE_SCHEMA, revision: 4, sourceSchematicSha256: hash('schematic'), sourceNetlistSha256: hash('netlist'), sourceBoardModelSha256: hash('board'), sourceContentHash: hash('ecad-content'), componentIds: ['component-u1', 'component-j1'], pinIds: ['pin-u1-1', 'pin-j1-1', 'pin-u1-2', 'pin-j1-2'], netIds: ['net-1', 'net-2'], footprintIds: ['footprint-u1', 'footprint-j1'], mountingHoleIds: ['hole-1'], keepoutIds: ['keepout-1'], connectorIds: ['connector-j1', 'connector-j2'], cableIds: ['cable-1'] });
  return {
    schema: 'nexyfab.ecad-mcad-release.v1', units: 'mm-V-A', revision: 4,
    source: { schematicPath: 'ecad/schematic.sch', schematicSha256: hash('schematic'), netlistPath: 'ecad/netlist.xml', netlistSha256: hash('netlist'), boardModelPath: 'mcad/board.step', boardModelSha256: hash('board'), contentHash: hash('ecad-content'), revisionSha256, revision: 4 },
    board: { id: 'board-1', widthMm: 100, heightMm: 80, thicknessMm: 1.6, enclosureClearanceMm: 3 },
    components: [
      { id: 'component-u1', referenceDesignator: 'U1', value: 'controller', partNumber: 'MCU-1', footprintId: 'footprint-u1', positionMm: { xMm: 10, yMm: 10 }, rotationDeg: 0, pinIds: ['pin-u1-1', 'pin-u1-2'], maxVoltageV: 5, maxCurrentA: 1 },
      { id: 'component-j1', referenceDesignator: 'J1', value: 'connector', partNumber: 'HDR-2', footprintId: 'footprint-j1', positionMm: { xMm: 50, yMm: 10 }, rotationDeg: 0, pinIds: ['pin-j1-1', 'pin-j1-2'], maxVoltageV: 24, maxCurrentA: 2 },
    ].map(component => ({ ...component, provenance })),
    pins: [
      { id: 'pin-u1-1', componentId: 'component-u1', number: '1', netId: 'net-1', positionMm: { xMm: 10, yMm: 10 }, electricalType: 'output' },
      { id: 'pin-j1-1', componentId: 'component-j1', number: '1', netId: 'net-1', positionMm: { xMm: 50, yMm: 10 }, electricalType: 'input' },
      { id: 'pin-u1-2', componentId: 'component-u1', number: '2', netId: 'net-2', positionMm: { xMm: 10, yMm: 11 }, electricalType: 'power' },
      { id: 'pin-j1-2', componentId: 'component-j1', number: '2', netId: 'net-2', positionMm: { xMm: 50, yMm: 11 }, electricalType: 'passive' },
    ],
    nets: [
      { id: 'net-1', name: 'DATA', pinIds: ['pin-u1-1', 'pin-j1-1'], voltageV: 3.3, currentA: 0.1, kind: 'signal' },
      { id: 'net-2', name: 'VCC', pinIds: ['pin-u1-2', 'pin-j1-2'], voltageV: 5, currentA: 0.5, kind: 'power' },
    ],
    footprints: [
      { id: 'footprint-u1', componentId: 'component-u1', widthMm: 10, heightMm: 8, positionMm: { xMm: 10, yMm: 10 }, librarySource: 'vendor-footprints', libraryRevision: '2026.08' },
      { id: 'footprint-j1', componentId: 'component-j1', widthMm: 8, heightMm: 6, positionMm: { xMm: 50, yMm: 10 }, librarySource: 'vendor-footprints', libraryRevision: '2026.08' },
    ],
    mountingHoles: [{ id: 'hole-1', positionMm: { xMm: 5, yMm: 5 }, diameterMm: 3 }],
    keepouts: [{ id: 'keepout-1', ownerId: 'board-1', xMm: 80, yMm: 60, widthMm: 10, heightMm: 10 }],
    connectors: [
      { id: 'connector-j1', componentId: 'component-j1', footprintId: 'footprint-j1', positionMm: { xMm: 50, yMm: 10 }, clearanceMm: 3 },
      { id: 'connector-j2', componentId: 'component-u1', footprintId: 'footprint-u1', positionMm: { xMm: 10, yMm: 10 }, clearanceMm: 3 },
    ],
    cables: [{ id: 'cable-1', connectorAId: 'connector-j1', connectorBId: 'connector-j2', pinCount: 2, voltageRatingV: 24, currentRatingA: 2 }],
    output: { format: 'nexyfab-exchange-json', targetFormat: 'ipc-2581', revision: 4, content: outputContent, bytes: Buffer.byteLength(outputContent, 'utf8'), sha256: hash(outputContent) },
  };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('ECAD-MCAD release contract', () => {
  it('validates canonical source identity, schematic connectivity, and MCAD placement', () => {
    const input = fixture();
    expect(validateEcadMcadRelease(input)).toEqual({ valid: true, issues: [] });
    const readback = parseEcadMcadOutput(input);
    expect(verifyEcadMcadReadback(input, readback)).toEqual({ valid: true, issues: [] });
    const assessment = assessEcadMcadRelease(input, readback);
    expect(assessment.releaseReady).toBe(false);
    expect(assessment.status).toBe('HOLD');
    expect(assessment.blockers).toEqual(expect.arrayContaining(['si_pi_emc_thermal_analysis_not_run', 'erc_drc_authority_not_verified']));
  });

  it('fails closed for stale, duplicate, dangling, open/short, rating, placement, and clearance mutations', () => {
    const stale = clone(fixture()); stale.revision = 5;
    expect(validateEcadMcadRelease(stale).issues).toContain('stale_source_revision');
    const broken = clone(fixture());
    broken.components[1]!.referenceDesignator = 'U1';
    broken.pins[0]!.netId = 'net-missing';
    broken.nets[0]!.shortCircuit = true;
    broken.nets[1]!.pinIds = ['pin-u1-2'];
    broken.components[0]!.positionMm = { xMm: 101, yMm: 81 };
    broken.connectors[0]!.clearanceMm = 60;
    const result = validateEcadMcadRelease(broken);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(['component_invalid:component-j1', 'pin_invalid:pin-u1-1', 'net_invalid_or_open:net-1', 'net_invalid_or_open:net-2', 'component_out_of_board:component-u1', 'connector_placement_or_clearance_invalid:connector-j1']));
  });

  it('binds independent parser output to source and bytes, rejecting tamper', () => {
    const input = fixture(); const readback = parseEcadMcadOutput(input); const tampered = clone(readback);
    tampered.outputSha256 = hash('tampered');
    expect(verifyEcadMcadReadback(input, tampered).valid).toBe(false);
    const changed = clone(input); changed.output.content += 'tamper';
    expect(validateEcadMcadRelease(changed).issues).toContain('output_binding_invalid');
    const forged = clone(input); const payload = JSON.parse(forged.output.content) as { componentIds: string[] }; payload.componentIds = ['forged-component']; forged.output.content = JSON.stringify(payload); forged.output.bytes = Buffer.byteLength(forged.output.content, 'utf8'); forged.output.sha256 = hash(forged.output.content);
    expect(validateEcadMcadRelease(forged).issues).toContain('output_readback_invalid');
  });

  it('accepts zero ground and negative rails but rejects cable ratings below connected equipment', () => { const ground = clone(fixture()); ground.nets[0]!.kind = 'ground'; ground.nets[0]!.name = 'GND'; ground.nets[0]!.voltageV = 0; expect(validateEcadMcadRelease(ground).issues).not.toContain('net_invalid_or_open:net-1'); const negative = clone(fixture()); negative.nets[0]!.voltageV = -3.3; expect(validateEcadMcadRelease(negative).issues).not.toContain('net_invalid_or_open:net-1'); const underRated = clone(fixture()); underRated.cables[0]!.currentRatingA = 1; expect(validateEcadMcadRelease(underRated).issues).toContain('cable_connectivity_invalid:cable-1'); const assessment = assessEcadMcadRelease(fixture(), parseEcadMcadOutput(fixture())); expect(assessment.internalParserVerified).toBe(true); expect(assessment.independentAttestationVerified).toBe(false); expect(assessment.parserVerified).toBe(false); });
  it('rejects exact pin ownership and orphan footprint/cable pin-count spoofing', () => { const pin = clone(fixture()); pin.components[0]!.pinIds = ['pin-u1-1', 'pin-j1-1']; expect(validateEcadMcadRelease(pin).issues).toContain('component_pin_ownership_invalid:component-u1'); const footprint = clone(fixture()); footprint.footprints = [...footprint.footprints, { id: 'footprint-orphan', componentId: 'component-u1', widthMm: 1, heightMm: 1, positionMm: { xMm: 70, yMm: 70 }, librarySource: 'vendor', libraryRevision: '1' }]; expect(validateEcadMcadRelease(footprint).issues).toContain('footprint_orphan_invalid:footprint-orphan'); const cable = clone(fixture()); cable.cables[0]!.pinCount = 1; expect(validateEcadMcadRelease(cable).issues).toContain('cable_connectivity_invalid:cable-1'); });
  it('rejects duplicate net pin ownership even when hashes and references are valid', () => { const input = clone(fixture()); input.nets[0]!.pinIds = ['pin-u1-1', 'pin-u1-1']; expect(validateEcadMcadRelease(input).issues).toContain('net_invalid_or_open:net-1'); });

  it('does not throw on malformed collection fields', () => {
    const malformed = clone(fixture()) as unknown as Record<string, unknown>;
    malformed.components = null; malformed.pins = null; malformed.nets = null; malformed.keepouts = null;
    expect(() => validateEcadMcadRelease(malformed as unknown as EcadMcadReleaseInputV1)).not.toThrow();
    expect(validateEcadMcadRelease(malformed as unknown as EcadMcadReleaseInputV1).valid).toBe(false);
  });
});
