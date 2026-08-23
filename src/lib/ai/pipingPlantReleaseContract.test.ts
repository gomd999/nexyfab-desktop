import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assessPipingPlantRelease,
  PIPING_PLANT_EXCHANGE_SCHEMA,
  parsePipingPlantOutput,
  type PipingPlantReleaseInputV1,
  validatePipingPlantRelease,
  verifyPipingPlantReadback,
} from './pipingPlantReleaseContract';

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

function fixture(): PipingPlantReleaseInputV1 {
  const revisionSha256 = hash('plant-revision-7');
  const input: PipingPlantReleaseInputV1 = {
    schema: 'nexyfab.piping-plant-release.v1',
    units: 'mm-MPa-C',
    revision: 7,
    source: {
      projectId: 'project-plant-1', modelId: 'model-plant-1', brepPath: 'models/plant.brep', brepBytes: 4096,
      brepSha256: hash('plant-brep'), contentHash: hash('plant-content'), revisionSha256, revision: 7,
    },
    provenance: {
      designCode: 'ASME B31.3', fluidId: 'cooling-water', fluidState: 'liquid', materialId: 'carbon-steel',
      materialGrade: 'A106 Gr.B', pipingClass: 'CS150', sourceId: 'plant-design-db', sourceRef: 'plant/job-7',
      capturedAt: '2026-08-22T00:00:00Z', revisionSha256,
    },
    ports: [
      { id: 'port-a', ownerType: 'line', ownerId: 'line-1', nominalSizeMm: 50, ratingMPa: 1.6, positionMm: { xMm: 0, yMm: 0, zMm: 0 } },
      { id: 'port-eq', ownerType: 'equipment', ownerId: 'equipment-1', nominalSizeMm: 50, ratingMPa: 1.6, positionMm: { xMm: 100, yMm: 0, zMm: 0 } },
    ],
    lines: [{ id: 'line-1', fluidId: 'cooling-water', nominalSizeMm: 50, schedule: 'STD', ratingMPa: 1.6, portIds: ['port-a', 'port-eq'], segmentIds: ['segment-1'], maximumSupportSpacingMm: 1000 }],
    segments: [{ id: 'segment-1', lineId: 'line-1', startPortId: 'port-a', endPortId: 'port-eq', pointsMm: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 100, yMm: 0, zMm: 0 }], lengthMm: 100, slopePercent: 0, bendRadiusMm: 75 }],
    fittings: [{ id: 'fitting-1', lineId: 'line-1', type: 'flange', portIds: ['port-a'], nominalSizeMm: 50, ratingMPa: 1.6 }],
    valves: [{ id: 'valve-1', lineId: 'line-1', portIds: ['port-eq'], nominalSizeMm: 50, ratingMPa: 1.6 }],
    equipment: [{ id: 'equipment-1', equipmentType: 'pump', portIds: ['port-eq'] }],
    nozzles: [{ id: 'nozzle-1', equipmentId: 'equipment-1', portId: 'port-eq', nominalSizeMm: 50, ratingMPa: 1.6 }],
    supports: [{ id: 'support-1', segmentId: 'segment-1', positionAlongMm: 50, spacingMm: 500, supportType: 'shoe' }],
    welds: [{ id: 'weld-1', segmentId: 'segment-1', lengthMm: 100, process: 'GTAW', wpsReference: 'WPS-PLANT-001' }],
    bom: [
      { id: 'bom-line', itemId: 'line-1', itemType: 'line', quantity: 1 },
      { id: 'bom-segment', itemId: 'segment-1', itemType: 'segment', quantity: 1 },
      { id: 'bom-fitting', itemId: 'fitting-1', itemType: 'fitting', quantity: 1 },
      { id: 'bom-valve', itemId: 'valve-1', itemType: 'valve', quantity: 1 },
      { id: 'bom-equipment', itemId: 'equipment-1', itemType: 'equipment', quantity: 1 },
      { id: 'bom-nozzle', itemId: 'nozzle-1', itemType: 'nozzle', quantity: 1 },
      { id: 'bom-support', itemId: 'support-1', itemType: 'support', quantity: 1 },
      { id: 'bom-weld', itemId: 'weld-1', itemType: 'weld', quantity: 1 },
    ],
    isometricSchedule: [{ id: 'iso-1', lineId: 'line-1', segmentIds: ['segment-1'], totalLengthMm: 100 }],
    output: { format: 'json', revision: 7, content: '', bytes: 0, sha256: '' },
  };
  const outputContent = JSON.stringify({
    schema: PIPING_PLANT_EXCHANGE_SCHEMA,
    source: { projectId: input.source.projectId, modelId: input.source.modelId, brepSha256: input.source.brepSha256, contentHash: input.source.contentHash },
    revision: input.revision,
    ids: { lines: input.lines.map(item => item.id), segments: input.segments.map(item => item.id), fittings: input.fittings.map(item => item.id), valves: input.valves.map(item => item.id), equipment: input.equipment.map(item => item.id), nozzles: input.nozzles.map(item => item.id), supports: input.supports.map(item => item.id), welds: input.welds.map(item => item.id) },
  });
  input.output = { format: 'json', revision: 7, content: outputContent, bytes: Buffer.byteLength(outputContent, 'utf8'), sha256: hash(outputContent) };
  return input;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('piping plant release contract', () => {
  it('validates stable identity, connectivity, engineering fields, and schedules', () => {
    const input = fixture();
    expect(validatePipingPlantRelease(input)).toEqual({ valid: true, issues: [] });
    const readback = parsePipingPlantOutput(input);
    expect(verifyPipingPlantReadback(input, readback)).toEqual({ valid: true, issues: [] });
    const assessment = assessPipingPlantRelease(input, readback);
    expect(assessment.releaseReady).toBe(false);
    expect(assessment.status).toBe('HOLD');
    expect(assessment.blockers).toEqual(expect.arrayContaining(['stress_flexibility_analysis_not_run', 'surge_transient_analysis_not_run', 'design_code_authority_not_verified']));
  });

  it('fails closed for stale, disconnected, zero-length, size/rating, and schedule changes', () => {
    const stale = clone(fixture());
    stale.revision = 8;
    expect(validatePipingPlantRelease(stale).issues).toContain('stale_source_revision');

    const broken = clone(fixture());
    broken.segments[0]!.pointsMm = [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 0, yMm: 0, zMm: 0 }];
    broken.segments[0]!.lengthMm = 0;
    broken.valves[0]!.nominalSizeMm = 40;
    broken.supports[0]!.spacingMm = 2000;
    broken.isometricSchedule[0]!.totalLengthMm = 99;
    broken.lines[0]!.segmentIds = ['missing-segment'];
    const result = validatePipingPlantRelease(broken);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(['segment_invalid:segment-1', 'valve_ownership_or_rating_invalid:valve-1', 'support_invalid:support-1', 'isometric_schedule_invalid:iso-1', 'line_segment_ownership_invalid:line-1']));

    const disconnected = fixture();
    disconnected.ports = [...disconnected.ports,
      { id: 'port-c', ownerType: 'line', ownerId: 'line-1', nominalSizeMm: 50, ratingMPa: 1.6, positionMm: { xMm: 500, yMm: 0, zMm: 0 } },
      { id: 'port-d', ownerType: 'line', ownerId: 'line-1', nominalSizeMm: 50, ratingMPa: 1.6, positionMm: { xMm: 600, yMm: 0, zMm: 0 } }];
    disconnected.lines[0]!.portIds = ['port-a', 'port-eq', 'port-c', 'port-d'];
    disconnected.lines[0]!.segmentIds = ['segment-1', 'segment-2'];
    disconnected.segments = [...disconnected.segments, { id: 'segment-2', lineId: 'line-1', startPortId: 'port-c', endPortId: 'port-d', pointsMm: [{ xMm: 500, yMm: 0, zMm: 0 }, { xMm: 600, yMm: 0, zMm: 0 }], lengthMm: 100, slopePercent: 0, bendRadiusMm: 75 }];
    disconnected.bom = [...disconnected.bom, { id: 'bom-segment-2', itemId: 'segment-2', itemType: 'segment', quantity: 1 }];
    disconnected.isometricSchedule[0]!.segmentIds = ['segment-1', 'segment-2'];
    disconnected.isometricSchedule[0]!.totalLengthMm = 200;
    expect(validatePipingPlantRelease(disconnected).issues).toContain('line_disconnected:line-1');
  });

  it('binds output readback to independent parser, source, revision, and output bytes', () => {
    const input = fixture();
    const readback = parsePipingPlantOutput(input);
    const tampered = clone(readback);
    tampered.outputSha256 = hash('tampered-output');
    expect(verifyPipingPlantReadback(input, tampered).valid).toBe(false);
    const outputTampered = clone(input);
    outputTampered.output.content += 'tampered';
    expect(validatePipingPlantRelease(outputTampered).issues).toContain('output_binding_invalid');
    const forgedExchange = fixture();
    const parsedOutput = JSON.parse(forgedExchange.output.content) as { ids: { segments: string[] } };
    parsedOutput.ids.segments = [];
    forgedExchange.output.content = JSON.stringify(parsedOutput);
    forgedExchange.output.bytes = Buffer.byteLength(forgedExchange.output.content, 'utf8');
    forgedExchange.output.sha256 = hash(forgedExchange.output.content);
    expect(verifyPipingPlantReadback(forgedExchange, parsePipingPlantOutput(forgedExchange)).issues).toContain('readback_segmentIds_mismatch');
  });

  it('does not throw on malformed collection input', () => {
    const malformed = clone(fixture()) as unknown as Record<string, unknown>;
    malformed.ports = null; malformed.lines = null; malformed.segments = null; malformed.bom = null;
    expect(() => validatePipingPlantRelease(malformed as unknown as PipingPlantReleaseInputV1)).not.toThrow();
    expect(validatePipingPlantRelease(malformed as unknown as PipingPlantReleaseInputV1).valid).toBe(false);
  });
});
