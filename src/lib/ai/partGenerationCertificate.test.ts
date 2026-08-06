import { describe, expect, it } from 'vitest';
import { buildPartGenerationCertificate, type PartGenerationEvidence, type PartGenerationIntent } from './partGenerationCertificate';

const intent = (): PartGenerationIntent => ({
  partId: 'shaft', intent: 'turned', bodyPolicy: 'single_body', expectedBodies: 1,
  dimensions: [{ id: 'diameter', expected: 20, tolerance: 0.01, unit: 'mm' }],
  features: [{ id: 'keyway', kind: 'slot', expectedCount: 1 }],
});
const evidence = (): PartGenerationEvidence => ({
  kernel: { available: true, valid: true, source: 'native_brep', artifactHash: 'a'.repeat(64) },
  topology: { solidCount: 1, watertight: true, nonManifoldEdges: 0, degenerateFaces: 0 },
  dimensions: [{ id: 'diameter', actual: 20.005, source: 'native_measurement' }],
  features: [{ id: 'keyway', kind: 'slot', actualCount: 1, source: 'native_topology' }],
});

describe('part generation certificate', () => {
  it('passes only when kernel, topology, dimensions and features are evidenced', () => {
    expect(buildPartGenerationCertificate(intent(), evidence())).toMatchObject({ status: 'pass', releaseReady: true, gates: [{ status: 'pass' }, { status: 'pass' }, { status: 'pass' }, { status: 'pass' }] });
  });
  it('fails a body policy or dimensional contradiction', () => {
    const value = evidence(); value.topology!.solidCount = 2; value.dimensions![0]!.actual = 20.02;
    const certificate = buildPartGenerationCertificate(intent(), value);
    expect(certificate).toMatchObject({ status: 'fail', releaseReady: false });
    expect(certificate.gates.flatMap(gate => gate.codes)).toEqual(expect.arrayContaining(['PART_SINGLE_BODY_POLICY_VIOLATION', 'PART_DIMENSION_OUT_OF_TOLERANCE:diameter']));
  });
  it('keeps absent native evidence as not_run instead of a guessed pass', () => {
    expect(buildPartGenerationCertificate(intent(), {})).toMatchObject({ status: 'not_run', releaseReady: false });
  });
  it('does not require empty dimension and feature axes', () => {
    const value = intent(); value.dimensions = []; value.features = [];
    expect(buildPartGenerationCertificate(value, evidence())).toMatchObject({ status: 'pass' });
  });
  it('does not release mesh-only evidence for manufacturing', () => {
    const value = evidence();
    value.kernel = { available: true, valid: true, source: 'native_mesh', artifactClass: 'mesh_manufacturing', artifactHash: 'b'.repeat(64) };
    const certificate = buildPartGenerationCertificate(intent(), value);
    expect(certificate).toMatchObject({ status: 'not_run', releaseReady: false, releaseTarget: 'manufacturing', artifactClass: 'mesh_manufacturing' });
    expect(certificate.gates[0]?.codes).toContain('PART_KERNEL_ARTIFACT_CLASS_INSUFFICIENT_FOR_MANUFACTURING');
  });
  it('allows valid mesh evidence only for an explicit preview target', () => {
    const target = intent(); target.releaseTarget = 'preview';
    const value = evidence(); value.kernel = { available: true, valid: true, source: 'native_mesh', artifactClass: 'mesh_preview', artifactHash: 'c'.repeat(64) };
    expect(buildPartGenerationCertificate(target, value)).toMatchObject({ status: 'pass', releaseReady: true, releaseTarget: 'preview' });
  });
  it('rejects artifact class spoofing across mesh and B-rep sources', () => {
    const value = evidence(); value.kernel = { available: true, valid: true, source: 'native_mesh', artifactClass: 'analytic_brep', artifactHash: 'd'.repeat(64) };
    expect(buildPartGenerationCertificate(intent(), value).gates[0]).toMatchObject({ status: 'fail', codes: ['PART_KERNEL_ARTIFACT_CLASS_SOURCE_MISMATCH'] });
  });
});
