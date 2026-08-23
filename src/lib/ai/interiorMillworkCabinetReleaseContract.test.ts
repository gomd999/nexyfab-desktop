import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assessInteriorMillworkRelease, INTERIOR_MILLWORK_EXCHANGE_SCHEMA, parseInteriorMillworkOutput, type InteriorMillworkReleaseInputV1, validateInteriorMillworkRelease, verifyInteriorMillworkReadback } from './interiorMillworkCabinetReleaseContract';

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
function fixture(): InteriorMillworkReleaseInputV1 {
  const revisionSha256 = hash('millwork-revision-2');
  const material = { materialId: 'mdf-18', materialName: 'Moisture resistant MDF', supplierSource: 'material-library', capturedAt: '2026-08-22T00:00:00Z', revisionSha256 } as const;
  const outputContent = JSON.stringify({ schema: INTERIOR_MILLWORK_EXCHANGE_SCHEMA, revision: 2, sourceAssemblyId: 'assembly-cabinet-1', sourceModelSha256: hash('cabinet-model'), sourceContentHash: hash('cabinet-content'), cabinetIds: ['cabinet-1'], partIds: ['part-left', 'part-right', 'part-bottom', 'part-top'], jointIds: ['joint-left-bottom', 'joint-right-bottom'], machiningIds: ['drill-left', 'edge-band-top'], bomIds: ['bom-left', 'bom-right', 'bom-bottom', 'bom-top'] });
  return {
    schema: 'nexyfab.interior-millwork-release.v1', units: 'mm-N', revision: 2,
    source: { assemblyId: 'assembly-cabinet-1', modelPath: 'models/cabinet.step', modelSha256: hash('cabinet-model'), contentHash: hash('cabinet-content'), revisionSha256, revision: 2 },
    cabinets: [{ id: 'cabinet-1', widthMm: 600, depthMm: 400, heightMm: 800, clearanceToleranceMm: 1, partIds: ['part-left', 'part-right', 'part-bottom', 'part-top'], jointIds: ['joint-left-bottom', 'joint-right-bottom'] }],
    parts: [
      { id: 'part-left', cabinetId: 'cabinet-1', kind: 'panel', materialId: 'mdf-18', thicknessMm: 18, widthMm: 18, depthMm: 400, heightMm: 800, originMm: { xMm: 0, yMm: 0, zMm: 0 }, toleranceMm: 0.5, provenance: material },
      { id: 'part-right', cabinetId: 'cabinet-1', kind: 'panel', materialId: 'mdf-18', thicknessMm: 18, widthMm: 18, depthMm: 400, heightMm: 800, originMm: { xMm: 582, yMm: 0, zMm: 0 }, toleranceMm: 0.5, provenance: material },
      { id: 'part-bottom', cabinetId: 'cabinet-1', kind: 'shelf', materialId: 'mdf-18', thicknessMm: 18, widthMm: 564, depthMm: 400, heightMm: 18, originMm: { xMm: 18, yMm: 0, zMm: 0 }, toleranceMm: 0.5, provenance: material },
      { id: 'part-top', cabinetId: 'cabinet-1', kind: 'panel', materialId: 'mdf-18', thicknessMm: 18, widthMm: 564, depthMm: 400, heightMm: 18, originMm: { xMm: 18, yMm: 0, zMm: 782 }, toleranceMm: 0.5, provenance: material },
    ],
    joints: [
      { id: 'joint-left-bottom', cabinetId: 'cabinet-1', partAId: 'part-left', partBId: 'part-bottom', type: 'dado', positionMm: { xMm: 18, yMm: 200, zMm: 9 }, lengthMm: 300, widthMm: 18, depthMm: 6, toleranceMm: 0.5 },
      { id: 'joint-right-bottom', cabinetId: 'cabinet-1', partAId: 'part-right', partBId: 'part-bottom', type: 'dado', positionMm: { xMm: 582, yMm: 200, zMm: 9 }, lengthMm: 300, widthMm: 18, depthMm: 6, toleranceMm: 0.5 },
    ],
    machining: [
      { id: 'drill-left', partId: 'part-left', kind: 'drill', positionMm: { xMm: 9, yMm: 200, zMm: 400 }, lengthMm: 3, widthMm: 3, depthMm: 6, diameterMm: 5, toolReference: 'drill-5mm' },
      { id: 'edge-band-top', partId: 'part-top', kind: 'edge_band', positionMm: { xMm: 300, yMm: 0, zMm: 790 }, lengthMm: 564, widthMm: 1, depthMm: 1, edge: 'front', toolReference: 'edge-band-1mm' },
    ],
    bom: [
      { id: 'bom-left', partId: 'part-left', quantity: 1 }, { id: 'bom-right', partId: 'part-right', quantity: 1 }, { id: 'bom-bottom', partId: 'part-bottom', quantity: 1 }, { id: 'bom-top', partId: 'part-top', quantity: 1 },
    ],
    output: { format: 'nexyfab-exchange-json', targetFormat: 'step', revision: 2, content: outputContent, bytes: Buffer.byteLength(outputContent, 'utf8'), sha256: hash(outputContent) },
  };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('interior millwork cabinet release contract', () => {
  it('validates exact parametric parts, joints, machining, BOM, and readback identity', () => {
    const input = fixture(); expect(validateInteriorMillworkRelease(input)).toEqual({ valid: true, issues: [] });
    const readback = parseInteriorMillworkOutput(input); expect(verifyInteriorMillworkReadback(input, readback)).toEqual({ valid: true, issues: [] });
    const assessment = assessInteriorMillworkRelease(input, readback); expect(assessment.releaseReady).toBe(false); expect(assessment.status).toBe('HOLD'); expect(assessment.blockers).toEqual(expect.arrayContaining(['cnc_postprocessor_and_machine_qualification_not_run', 'site_measurement_not_verified']));
  });

  it('fails closed for stale, duplicate, dangling, clash, tolerance, machining, and BOM mutations', () => {
    const stale = clone(fixture()); stale.revision = 3; expect(validateInteriorMillworkRelease(stale).issues).toContain('stale_source_revision');
    const broken = clone(fixture());
    broken.parts[1]!.id = 'part-left';
    broken.parts[2]!.originMm = { xMm: 10, yMm: 0, zMm: 0 };
    broken.joints[0]!.partBId = 'part-missing';
    broken.machining[0]!.depthMm = 30;
    broken.bom = broken.bom.slice(0, -1);
    const result = validateInteriorMillworkRelease(broken);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(['part_id_invalid:part-left', 'part_clash:part-left:part-bottom', 'joint_invalid_or_dangling:joint-left-bottom', 'machining_invalid_or_out_of_part:drill-left', 'bom_missing:part-top']));
  });

  it('rejects tampered canonical output bytes and parser readback', () => {
    const input = fixture(); const readback = parseInteriorMillworkOutput(input); const tampered = clone(readback); tampered.outputSha256 = hash('tampered'); expect(verifyInteriorMillworkReadback(input, tampered).valid).toBe(false);
    const changed = clone(input); changed.output.content += 'tampered'; expect(validateInteriorMillworkRelease(changed).issues).toContain('output_binding_invalid');
    const forged = clone(input); const payload = JSON.parse(forged.output.content) as { partIds: string[] }; payload.partIds = ['forged-part']; forged.output.content = JSON.stringify(payload); forged.output.bytes = Buffer.byteLength(forged.output.content, 'utf8'); forged.output.sha256 = hash(forged.output.content); expect(validateInteriorMillworkRelease(forged).issues).toContain('output_readback_invalid');
  });

  it('rejects machining extents and joint tolerances that exceed the fabrication envelope', () => { const outside = clone(fixture()); outside.machining[1]!.positionMm = { xMm: 580, yMm: 390, zMm: 790 }; expect(validateInteriorMillworkRelease(outside).issues).toContain('machining_invalid_or_out_of_part:edge-band-top'); const tolerance = clone(fixture()); tolerance.joints[0]!.toleranceMm = 2; expect(validateInteriorMillworkRelease(tolerance).issues).toContain('joint_invalid_or_dangling:joint-left-bottom'); });
  it('rejects a joint whose declared full extent cannot reach both owned parts', () => { const input = clone(fixture()); input.joints[0]!.lengthMm = 1000; expect(validateInteriorMillworkRelease(input).issues).toContain('joint_invalid_or_dangling:joint-left-bottom'); });

  it('does not throw on malformed collection fields', () => {
    const malformed = clone(fixture()) as unknown as Record<string, unknown>; malformed.parts = null; malformed.joints = null; malformed.machining = null; malformed.bom = null;
    expect(() => validateInteriorMillworkRelease(malformed as unknown as InteriorMillworkReleaseInputV1)).not.toThrow(); expect(validateInteriorMillworkRelease(malformed as unknown as InteriorMillworkReleaseInputV1).valid).toBe(false);
  });
});
