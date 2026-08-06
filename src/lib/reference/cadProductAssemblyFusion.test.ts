import { describe, expect, it } from 'vitest';
import { buildCadProductBundleManifest } from './cadCorpusProductBundle';
import { buildCadProductAssemblyFusion } from './cadProductAssemblyFusion';
const bytes = (value: string) => new TextEncoder().encode(value);

describe('CAD product assembly fusion IR', () => {
  const bundle = buildCadProductBundleManifest([
    { relativePath: 'set/mearm.snapshot.10/Final.x_t', bytes: bytes('xt') },
    { relativePath: 'set/mearm.snapshot.10/Assembly.SLDASM', bytes: bytes('asm') },
    { relativePath: 'set/mearm.snapshot.10/parts/Arm.SLDPRT', bytes: bytes('part') },
    { relativePath: 'set/mearm.snapshot.10/stl/Part 9 - Final Assembly - Arm-1.STL', bytes: bytes('mesh1') },
    { relativePath: 'set/mearm.snapshot.10/stl/Part 9 - Final Assembly - Arm-2.STL', bytes: bytes('mesh2') },
  ]);
  it('groups mesh instances under a part definition without inventing transforms', () => {
    const result = buildCadProductAssemblyFusion({ bundle, authoritativeBodyCount: 2 });
    expect(result).toMatchObject({ status: 'not_run', releaseReady: false, mappedMeshOccurrenceCount: 2, unmatchedAuthoritativeBodyCount: 0, nativeAssemblyMemberCount: 1, nativeAssemblyExtractionStatus: 'not_run', nativeOccurrenceCount: 0, nativeJointCount: 0, meshEvidenceStatus: 'not_run' });
    expect(result.definitions.find(item => item.displayName === 'Arm')).toMatchObject({ occurrenceCount: 2, nativePartMembers: [expect.stringContaining('Arm.SLDPRT')] });
    expect(result.occurrences.every(item => item.transformStatus === 'not_run')).toBe(true);
  });
  it('does not mistake a multi-body part for an occurrence mismatch', () => {
    expect(buildCadProductAssemblyFusion({ bundle, authoritativeBodyCount: 3 })).toMatchObject({ status: 'not_run', releaseReady: false, bodyMembershipStatus: 'not_run', unmatchedAuthoritativeBodyCount: 1, warnings: expect.arrayContaining(['compound_part_body_membership_not_run:3/2']) });
  });
  it('fails closed when there are fewer kernel bodies than mesh occurrences', () => {
    expect(buildCadProductAssemblyFusion({ bundle, authoritativeBodyCount: 1 })).toMatchObject({ status: 'fail', bodyMembershipStatus: 'fail', errors: expect.arrayContaining(['authoritative_body_count_insufficient:1/2']) });
  });
  it('binds every mesh measurement to its manifest hash and fails closed on mismatch', () => {
    const records = bundle.members.filter(item => item.role === 'mesh_part').map(item => ({ relativePath: item.relativePath, sourceSha256: item.sha256, status: 'pass' as const, fidelity: 'mesh-exact' }));
    const valid = buildCadProductAssemblyFusion({ bundle, authoritativeBodyCount: 2, meshEvidence: { schema: 'nexyfab.cad-mesh-occurrence-evidence.v1', lineageId: bundle.lineageId, records } });
    expect(valid).toMatchObject({ meshEvidenceStatus: 'pass' });
    records[0]!.sourceSha256 = 'wrong';
    expect(buildCadProductAssemblyFusion({ bundle, authoritativeBodyCount: 2, meshEvidence: { schema: 'nexyfab.cad-mesh-occurrence-evidence.v1', lineageId: bundle.lineageId, records } })).toMatchObject({ status: 'fail', meshEvidenceStatus: 'fail', errors: expect.arrayContaining(['mesh_occurrence_evidence_failed']) });
  });
});
