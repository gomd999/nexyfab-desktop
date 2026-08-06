import { describe, expect, it } from 'vitest';
import { buildCadProductBundleManifest } from './cadCorpusProductBundle';
import { validateCadNativeAssemblyEvidence, type CadNativeAssemblyEvidence } from './cadNativeAssemblyEvidence';
const bytes = (value: string) => new TextEncoder().encode(value);
describe('native assembly evidence', () => {
  const bundle = buildCadProductBundleManifest([{ relativePath: 'set/robot.snapshot.1/root.SLDASM', bytes: bytes('asm') }, { relativePath: 'set/robot.snapshot.1/link.SLDPRT', bytes: bytes('part') }]);
  const source = bundle.members.find(item => item.role === 'native_assembly')!;
  const valid: CadNativeAssemblyEvidence = { schema: 'nexyfab.native-assembly-evidence.v1', lineageId: bundle.lineageId, extractor: { name: 'sw-extractor', version: '1.0.0', cadSystem: 'SOLIDWORKS', cadVersion: '2026' }, sources: [{ relativePath: source.relativePath, sha256: source.sha256 }], definitions: [{ id: 'root', name: 'root', sourceMember: source.relativePath }, { id: 'link', name: 'link', sourceMember: bundle.members[1]!.relativePath }], occurrences: [{ id: 'root-1', definitionId: 'root', parentOccurrenceId: null, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], suppressed: false }, { id: 'link-1', definitionId: 'link', parentOccurrenceId: 'root-1', transform: [1, 0, 0, 10, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], suppressed: false }], joints: [{ id: 'j1', type: 'revolute', parentOccurrenceId: 'root-1', childOccurrenceId: 'link-1', axis: [0, 0, 1], originMm: [10, 0, 0], lowerLimit: -1, upperLimit: 1 }] };
  it('passes hash-bound hierarchy, transforms and joint frames', () => expect(validateCadNativeAssemblyEvidence(bundle, valid)).toMatchObject({ status: 'pass', releaseReady: true, errors: [] }));
  it('reports absent extraction as not_run', () => expect(validateCadNativeAssemblyEvidence(bundle)).toMatchObject({ status: 'not_run', releaseReady: false }));
  it('fails closed on source hash and transform corruption', () => { const corrupt = structuredClone(valid); corrupt.sources[0]!.sha256 = 'wrong'; corrupt.occurrences[1]!.transform = [1]; expect(validateCadNativeAssemblyEvidence(bundle, corrupt)).toMatchObject({ status: 'fail', releaseReady: false, errors: expect.arrayContaining([expect.stringContaining('hash_mismatch'), expect.stringContaining('transform_invalid')]) }); });
  it('validates v1.1 coordinate metadata and rigid transforms', () => {
    const next = structuredClone(valid); next.schema = 'nexyfab.native-assembly-evidence.v1.1'; next.coordinateSystem = { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' }; next.units = { length: 'mm', angle: 'deg' };
    next.definitions = next.definitions.map(item => ({ ...item, kind: item.id === 'root' ? 'assembly' : 'part' })); next.joints = next.joints.map(item => ({ ...item, frame: 'world' }));
    next.occurrences = next.occurrences.map(item => ({ ...item, state: { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false } }));
    expect(validateCadNativeAssemblyEvidence(bundle, next)).toMatchObject({ status: 'pass', releaseReady: true });
    next.occurrences[1]!.transform[0] = 2;
    expect(validateCadNativeAssemblyEvidence(bundle, next)).toMatchObject({ status: 'fail', errors: expect.arrayContaining([expect.stringContaining('scale_or_shear')]) });
  });
  it('rejects parent cycles even when every parent id exists', () => {
    const cyclic = structuredClone(valid); cyclic.occurrences[0]!.parentOccurrenceId = 'link-1';
    expect(validateCadNativeAssemblyEvidence(bundle, cyclic)).toMatchObject({ status: 'fail', errors: expect.arrayContaining([expect.stringContaining('parent_cycle')]) });
  });
});
